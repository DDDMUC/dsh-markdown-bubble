// dsh-markdown-bubble — browser half.
//
// What this does
// --------------
// The chat view draws a durable sent message through the keyed
// `conversation.chat.node` seats `user` and `steering` (one host component
// serves both), which project the raw logged text with `projectUserText` and
// paint it under `white-space: pre-wrap` — markdown shown as typed. This
// plugin shadows those two seats at a lower priority and re-renders the same
// bubble with the host's own markdown pipeline, `MarkdownText`.
//
// The replacement keeps what the host keeps:
//
// - Reference chips stay chips. The host projection is called (it is frozen,
//   not replaceable, but perfectly callable) and its pieces are split into
//   chips and plain runs; chips render unchanged, plain runs go through
//   MarkdownText. A chip inside a running paragraph splits that paragraph
//   into blocks around it — boundary chips are the common case.
// - The action strip survives. The host's own bar (clock + copy) is rebuilt
//   from exported primitives, and its container keeps the `_actions` /
//   `_action` class suffixes and the `data-clock` attribute that sibling
//   plugins (dsh-edit-turn, dsh-delete-turn, dsh-rerun-turn) anchor their
//   injected buttons on — verified against their sources.
// - Attachments, the reference summary and `JsonBlock` extras render as the
//   host renders them, from the same node data and the same owner callbacks.
//
// The pending steering bubble and the local submission echo do not pass
// through these seats (they are not chat nodes yet), so they keep the host's
// plain projection. Queue previews and the goal panel keep it too.
//
// Soft line breaks are preserved: GFM would join "line one\nline two" into one
// paragraph, but a chat box Enter is a line break. Plain runs are prepared
// with two-space hard breaks outside fenced code before they reach the
// renderer.
//
// The bundle follows the client-modules contract: it registers a factory with
// `window.__ModuleLoader__.load` and returns the plugin exports.
window.__ModuleLoader__.load({
  id: 'dsh-markdown-bubble',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const react = require('react')
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')

    /** Plugin identity and diagnostics key. */
    const NS = 'dsh-markdown-bubble'

    /** Keep in sync with package.json and src/index.js. */
    const PLUGIN_VERSION = '0.1.2'

    /** Presence marker the live verifier reads. */
    const DEBUG_KEY = '__DSH_MARKDOWN_BUBBLE__'

    /** Style tag id claimed by this plugin (HMR and dispose remove it by id). */
    const CSS_TAG = NS + '/markdown-bubble.css'

    /** Chat-node seats this renderer replaces; the host serves both with one view. */
    const SEATS = ['user', 'steering']

    // Seat priority: the host's default is 0, the plugin sits below it, and it
    // must not merely be different — the same key at the same priority is not a
    // shadow, it is an error.
    //
    // Evidence (verified against the installed host, DSH 0.2.0-rc.1):
    // - the host registers these two keys with no priority field at all
    //   (@deepseek-ai/dsh-client-ui-chat/lib/client.js:6830-6839), so its entry
    //   carries the default;
    // - @deepseek-ai/dsh-client-ui-slots/lib/index.js reads
    //   options.priority ?? 0 (:167), keeps the ledger sorted by priority
    //   ascending (:221) and answers a keyed cell with the FIRST live entry of
    //   that key (:278-293) — the lowest priority renders;
    // - the same key at the same priority throws instead of shadowing
    //   (:177-178), so 0 would break the page, and a positive value would lose
    //   the seat to the host.
    // -1 is therefore the smallest step that shadows the host and stays clear
    // of it.
    const SEAT_PRIORITY = -1

    const { createElement: h, Fragment } = react

    // --- source preparation ---------------------------------------------------

    /** Session recalls log the wire form `@[label](dsh-session:...)`; the label alone is what a chip shows. */
    const SESSION_WIRE_RE = /@\[([^\]\n]+)\]\(dsh-session:[^)\s]+\)/gu

    /**
     * A fenced-code opening line: up to three spaces and a run of three or
     * more backticks or tildes. Returns the fence descriptor, or null.
     * @param line - one source line.
     * @returns the fence descriptor or null.
     */
    function openingFence(line) {
      const match = /^ {0,3}(`{3,}|~{3,})/.exec(line)
      return match === null ? null : { char: match[1][0], length: match[1].length }
    }

    /**
     * A fenced-code closing line for one fence: the same character, a run at
     * least as long as the opening one, and nothing but trailing whitespace
     * after it (CommonMark forbids a closing info string).
     * @param line - one source line.
     * @param fence - the opening fence descriptor.
     * @returns whether this line closes the fence.
     */
    function isClosingFence(line, fence) {
      const match = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line)
      return match !== null && match[1][0] === fence.char && match[1].length >= fence.length
    }

    /**
     * Walk the source line by line, rewriting only lines that sit outside a
     * fenced code block. Fenced code is left byte-for-byte alone — its
     * whitespace is the point — and its opening and closing lines are never
     * rewritten either.
     * @param text - message text.
     * @param visit - (line, nextLine | undefined) => replacement line.
     * @returns the rewritten source.
     */
    function walkOutsideFences(text, visit) {
      if (!text.includes('\n')) return visit(text, undefined)
      const lines = text.split('\n')
      let fence = null
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index]
        if (fence !== null) {
          if (isClosingFence(line, fence)) fence = null
          continue
        }
        const opener = openingFence(line)
        if (opener !== null) {
          fence = opener
          continue
        }
        lines[index] = visit(line, lines[index + 1])
      }
      return lines.join('\n')
    }

    /**
     * The two-space GFM hard break a line needs when a soft break would
     * otherwise join it to the next: applied only to content lines that
     * continue (blank lines end the paragraph), and never to indented code
     * (which preserves its own line structure).
     * @param line - current line.
     * @param next - the following line, absent on the last line.
     * @returns the line with its hard-break suffix when it needs one.
     */
    function hardBreakLine(line, next) {
      if (line === '' || next === undefined || next.trim() === '') return line
      if (/^ {4}/.test(line) || line.startsWith('\t')) return line
      return line + '  '
    }

    /**
     * Preserve the single line breaks a reader typed.
     *
     * GFM treats one newline inside a paragraph as a soft break (a space), but
     * this bubble renders what a person typed into a chat box, where Enter is
     * a line break. Blanket `pre-wrap` is not an option: it would also expose
     * the source whitespace markdown ignores (list indentation, continuation
     * spacing). So the source itself is prepared for the renderer.
     * @param text - newline-normalized message text.
     * @returns the source with soft breaks promoted to hard breaks.
     */
    function preserveHardBreaks(text) {
      return walkOutsideFences(text, hardBreakLine)
    }

    /**
     * Replace a session-recall wire link with its display label. The markdown
     * renderer only allows http(s)/mailto destinations, so an untranslated
     * `dsh-session:` link would lose its anchor anyway — this just makes the
     * plain-text fallback identical to what the chip showed. Fenced code is
     * left alone: a pasted wire link there is code, not a recall.
     * @param text - raw logged message text.
     * @returns the text with wire links unwrapped.
     */
    function unwrapSessionReferences(text) {
      return walkOutsideFences(text, (line) => line.replace(SESSION_WIRE_RE, '$1'))
    }

    /**
     * The message text as markdown source: CRLF normalized, session wire
     * links unwrapped, soft breaks promoted to hard breaks — each applied
     * only outside fenced code.
     * @param text - raw logged message text.
     * @returns markdown source for the renderer.
     */
    function toMarkdown(text) {
      const normalized = text.replace(/\r\n?/gu, '\n')
      return walkOutsideFences(normalized, (line, next) => hardBreakLine(line.replace(SESSION_WIRE_RE, '$1'), next))
    }

    // --- content projection ----------------------------------------------------

    /**
     * Split content blocks exactly as the host's UserStyleBubble does: joined
     * text, image/file attachments, and the remainder.
     * @param content - the node's content blocks.
     * @returns text, attachments and rest blocks.
     */
    function contentParts(content) {
      const texts = []
      const attachments = []
      const rest = []
      for (const block of content) {
        if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
          texts.push(block.text)
        } else if (block !== null && typeof block === 'object' && block.type === 'image' && block.attachment !== undefined) {
          attachments.push({ type: 'image', image: { attachment: block.attachment } })
        } else if (block !== null && typeof block === 'object' && block.type === 'file' && block.attachment !== undefined) {
          attachments.push({ type: 'file', file: block.attachment })
        } else {
          rest.push(block)
        }
      }
      return { text: texts.join(''), attachments, rest }
    }

    /** Is this projected piece a reference chip (vs a plain text run)? */
    function isChip(piece) {
      return react.isValidElement(piece) && piece.props !== null && piece.props['data-ref-chip'] !== undefined
    }

    /** Plain-run text sits directly inside the projection's run spans. */
    function runText(piece) {
      return react.isValidElement(piece) && typeof piece.props.children === 'string' ? piece.props.children : ''
    }

    /**
     * A copy lookup that cannot take the seat down. The framework injects a
     * `t` for the declared `chat` namespace, but a host-shape mismatch (a
     * locale service that was never bound, a renamed key) must fall back to
     * the key rather than throw during render.
     * @param t - the injected chat translator, possibly not callable.
     * @param key - the dictionary key.
     * @param params - template parameters.
     * @returns the translated string, or the key.
     */
    function safeTranslate(t, key, params) {
      if (typeof t !== 'function') return key
      try {
        return t(key, params)
      } catch {
        return key
      }
    }

    /** The host projection, called in a guard: it is the fallback of last resort. */
    function plainProjection(text, referenceLabels, skillNames, references) {
      try {
        return primitives.projectUserText(text, referenceLabels, skillNames, 'skill', references)
      } catch (error) {
        console.warn('[' + NS + '] the host user-text projection failed; showing raw text', error)
        return h('span', { className: 'dshmb-plain' }, text)
      }
    }

    /**
     * Compose the markdown body without ever throwing.
     *
     * `composeUserMarkdown` runs while the seat component renders, so a throw
     * here does NOT reach {@link MarkdownBoundary} — a boundary catches its
     * descendants, not the parent render that creates it. It would escape to
     * the slot machinery, which answers by retiring the whole entry and handing
     * the row back to the host's raw renderer; on screen that is
     * indistinguishable from "the plugin stopped working". A host-shape
     * mismatch (an unexpected node shape, an unrecognised projection result)
     * therefore falls back to the plain projection right here, inside our own
     * render, so the bubble keeps its shell, its actions and the sibling
     * plugins' injection anchors.
     * @param text - the message text.
     * @param t - the injected chat translator.
     * @param referenceLabels - session recall labels.
     * @param skillNames - skill names.
     * @param references - file/skill open callbacks.
     * @returns the composed body, or null when markdown cannot be produced.
     */
    function safeMarkdownBody(text, t, referenceLabels, skillNames, references) {
      try {
        const labels = buildMarkdownLabels(t)
        return composeUserMarkdown(text, labels, referenceLabels, skillNames, references)
      } catch (error) {
        console.warn('[' + NS + '] markdown composition failed; showing the plain projection', error)
        return null
      }
    }

    /**
     * A whitespace-only plain run: the gap between two chips, or the leading /
     * trailing padding the host's own pre-wrap bubble shows. It carries no
     * markdown, so it is never a markdown block, but it is not nothing either —
     * see the flush() comment in composeUserMarkdown.
     * @param text - the run's whitespace.
     * @param key - react key.
     * @returns the gap span.
     */
    function gapSpan(text, key) {
      return h('span', { className: 'dshmb-plain', 'data-dshmb-gap': '1', key }, text)
    }

    /** One markdown block for one contiguous plain run. */
    function markdownBlock(source, labels, key) {
      return h(
        'div',
        { className: 'dshmb-md', 'data-dshmb-md': '1', key },
        h(primitives.MarkdownText, { text: source, labels }),
      )
    }

    /**
     * Compose the bubble body: reference chips stay chips, each contiguous
     * plain run becomes a markdown block — except a whitespace-only run, which
     * stays a pre-wrap text node so two chips never glue together. A chip inside
     * a running paragraph splits that paragraph around the chip; boundary chips
     * read seamlessly.
     * @param text - the message text.
     * @param labels - markdown chrome labels.
     * @param referenceLabels - session recall labels the host associates with the message.
     * @param skillNames - skill names the host loaded for the message.
     * @param references - file/skill open callbacks for clickable chips.
     * @returns the composed body, or null for empty text.
     */
    function composeUserMarkdown(text, labels, referenceLabels, skillNames, references) {
      if (typeof text !== 'string' || text === '') return null
      const projected = plainProjection(text, referenceLabels, skillNames, references)
      const pieces =
        react.isValidElement(projected) && projected.type === Fragment && Array.isArray(projected.props.children)
          ? projected.props.children
          : [projected]
      if (!pieces.some(isChip)) return markdownBlock(toMarkdown(text), labels, 'md')

      const out = []
      let run = []
      const flush = () => {
        if (run.length === 0) return
        const raw = run.join('')
        const source = toMarkdown(raw)
        if (source.trim() === '') {
          // Whitespace is not markdown, so it never becomes a block — but it is
          // not nothing either. Between two chips it is the only thing keeping
          // them apart: dropping it renders "@a@b" where the host shows
          // "@a @b", and a newline between two chips (a real line break in the
          // host's pre-wrap bubble) would collapse onto one line. The host
          // projection keeps that run as a plain span with the same whitespace;
          // this renderer keeps it as the pre-wrap stand-in instead of deleting
          // it.
          const gap = raw.replace(/\r\n?/gu, '\n')
          if (gap !== '') out.push(gapSpan(gap, 'gap' + out.length))
        } else {
          out.push(markdownBlock(source, labels, 'md' + out.length))
        }
        run = []
      }
      for (const piece of pieces) {
        if (isChip(piece)) {
          flush()
          out.push(h(Fragment, { key: 'chip' + out.length }, piece))
        } else {
          run.push(runText(piece))
        }
      }
      flush()
      if (out.length === 0) return null
      return out.length === 1 ? out[0] : h(Fragment, null, out)
    }

    // --- markdown chrome --------------------------------------------------------

    /**
     * Markdown chrome labels from the chat translator, matching the host's own
     * `markdownLabels` wiring so fence cards carry identical copy.
     * @param t - the chat locale seat.
     * @returns labels for code fences and footnotes.
     */
    function buildMarkdownLabels(t) {
      return {
        code: {
          copyLabel: safeTranslate(t, 'copy'),
          copiedLabel: safeTranslate(t, 'copied'),
          toolbarLabels: {
            codeLabel: safeTranslate(t, 'codeBlock.title'),
            wrapLabel: safeTranslate(t, 'codeBlock.wrap'),
            unwrapLabel: safeTranslate(t, 'codeBlock.unwrap'),
          },
        },
        footnotes: safeTranslate(t, 'markdown.footnotes'),
      }
    }

    // --- clock ------------------------------------------------------------------

    /** @param value - non-negative integer. @returns two-digit string. */
    function pad2(value) {
      return String(value).padStart(2, '0')
    }

    /**
     * Midnight epoch of the current local day.
     * @param now - epoch milliseconds.
     * @returns the day's local start.
     */
    function startOfLocalDay(now) {
      const date = new Date(now)
      date.setHours(0, 0, 0, 0)
      return date.getTime()
    }

    /**
     * Milliseconds until the next local midnight.
     * @param now - epoch milliseconds.
     * @returns the remaining interval.
     */
    function msUntilNextLocalMidnight(now) {
      const next = new Date(startOfLocalDay(now))
      next.setDate(next.getDate() + 1)
      return Math.max(1, next.getTime() - now)
    }

    /**
     * Local calendar-day epoch that advances at each local midnight, so a
     * message clock flips from `HH:mm` to a date without a re-render trigger.
     * @returns midnight ms for the current local day.
     */
    function useLocalDay() {
      const [day, setDay] = react.useState(() => startOfLocalDay(Date.now()))
      react.useEffect(() => {
        const timer = setTimeout(() => setDay(startOfLocalDay(Date.now())), msUntilNextLocalMidnight(Date.now()))
        return () => clearTimeout(timer)
      }, [day])
      return day
    }

    /**
     * The host's message clock: `HH:mm` for today, the `clock.md` date plus
     * the clock earlier this year, the `clock.ymd` form for other years.
     * @param time - message time in epoch milliseconds.
     * @param t - the chat locale seat.
     * @param now - current epoch milliseconds (already local-day bucketed by the caller).
     * @returns the display string.
     */
    function formatMessageClock(time, t, now) {
      const date = new Date(time)
      const reference = new Date(now)
      const clock = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
      if (date.getFullYear() === reference.getFullYear() && date.getMonth() === reference.getMonth() && date.getDate() === reference.getDate()) return clock
      const params = { y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() }
      return `${date.getFullYear() === reference.getFullYear() ? safeTranslate(t, 'clock.md', params) : safeTranslate(t, 'clock.ymd', params)} ${clock}`
    }

    // --- pieces -----------------------------------------------------------------

    /**
     * Contain a renderer crash to one message: the bubble falls back to the
     * host's plain projection instead of crashing the seat, which the slot
     * machinery would answer by retiring the whole renderer.
     */
    class MarkdownBoundary extends react.Component {
      constructor(props) {
        super(props)
        this.state = { failed: false }
      }

      static getDerivedStateFromError() {
        return { failed: true }
      }

      componentDidCatch(error) {
        console.warn('[' + NS + '] markdown rendering failed; falling back to the plain projection', error)
      }

      render() {
        return this.state.failed ? this.props.fallback : this.props.children
      }
    }

    /**
     * The host's action strip for a sent message: clock + copy. The container
     * keeps the `_actions` class suffix and the `data-clock` attribute that
     * dsh-edit-turn / dsh-delete-turn / dsh-rerun-turn search for when they
     * inject their own buttons, and the copy button keeps the `_action`
     * suffix their ordering heuristic reads.
     * @param props - message text, time, and the chat translator.
     * @returns the action strip.
     */
    // Anchor fidelity, live-verified on the running instance: this strip is the
    // row's first DOM child, its direct children are [clock span, copy button]
    // exactly like the host's own MessageIconActions
    // (@deepseek-ai/dsh-client-ui-chat/lib/client.js:1157-1172), the copy button
    // keeps the _action suffix on a direct child (the host's Tooltip adds no
    // wrapper box) and data-clock stays "start". dsh-edit-turn, dsh-delete-turn
    // and dsh-rerun-turn therefore find the bar with
    // row.querySelector('[class*="_actions"]') and their insertion point with
    // bar.querySelectorAll('button') without knowing a single class hash of the
    // host's.
    function MessageActions({ text, time, t }) {
      const day = useLocalDay()
      const [copied, setCopied] = react.useState(false)
      const pending = react.useRef(false)
      const timer = react.useRef(null)

      react.useEffect(
        () => () => {
          pending.current = false
          if (timer.current !== null) clearTimeout(timer.current)
        },
        [],
      )

      const onCopy = react.useCallback(() => {
        if (copied || pending.current) return
        pending.current = true
        primitives.writeClipboard(text).then((ok) => {
          pending.current = false
          if (!ok) return
          setCopied(true)
          timer.current = window.setTimeout(() => {
            timer.current = null
            setCopied(false)
          }, 1000)
        })
      }, [copied, text])

      const clock =
        time === undefined ? null : h('span', { className: 'dshmb-timeStart' }, formatMessageClock(time, t, day))
      const label = copied ? safeTranslate(t, 'copied') : safeTranslate(t, 'copy')

      return h(
        'div',
        { className: 'dshmb_actions', 'data-clock': 'start', 'data-dshmb-actions': '1' },
        clock,
        h(
          primitives.Tooltip,
          { label, side: 'bottom' },
          h(
            'button',
            { type: 'button', className: 'dshmb_action', 'aria-label': label, 'data-dshmb-action': '1', onClick: onCopy },
            copied ? h(primitives.IconCheckOutlineRegular, {}) : h(primitives.IconCopyOutlineRegular, {}),
          ),
        ),
      )
    }

    /**
     * One attachment row entry: an image goes through the host's durable
     * image renderer, a file renders as the host's file card.
     * @param props - the attachment entry and the owner's image renderer.
     * @returns the row entry.
     */
    function AttachmentEntry({ attachment, renderMessageImages, compactImages }) {
      if (attachment.type === 'image') {
        return h(Fragment, null, renderMessageImages({ images: [attachment.image], align: 'end', compact: compactImages }))
      }
      const file = attachment.file ?? {}
      const name = typeof file.name === 'string' ? file.name : ''
      const meta = [primitives.fileExtension(name).toUpperCase().slice(0, 8), primitives.fileSizeText(file.bytes)]
        .filter(Boolean)
        .join(' ')
      return h(
        'span',
        { className: 'dshmb-fileCard', title: name },
        h(primitives.FileTypeIcon, { path: name, className: 'dshmb-fileIcon' }),
        h(
          'span',
          { className: 'dshmb-fileContent' },
          h('span', { className: 'dshmb-fileName' }, name),
          h('span', { className: 'dshmb-fileMeta' }, meta),
        ),
      )
    }

    /**
     * The markdown-rendered user message bubble — the keyed `user`/`steering`
     * seat replacement. The host serves both keys with one identical view and
     * so does this component.
     * @param props - keyed chat renderer seat for the `user`/`steering` kinds.
     * @returns the right-aligned bubble with attachments, markdown, chips and actions.
     */
    const MarkdownBubbleSeat = react.memo(function MarkdownBubbleSeat({
      node,
      renderMessageImages,
      openFile,
      openSkill,
      t,
    }) {
      const data = node.data ?? {}
      const { text, attachments, rest } = contentParts(Array.isArray(data.content) ? data.content : [])
      const referenceLabels = Array.isArray(data.referenceLabels) ? data.referenceLabels : []
      const skillNames = Array.isArray(data.skillNames) ? data.skillNames : []
      const references = react.useMemo(() => ({ openFile, openSkill }), [openFile, openSkill])
      const compactImages = attachments.length > 1
      const showBubble = text !== '' || rest.length > 0

      // Never let composition throw out of this render — see safeMarkdownBody.
      const body = safeMarkdownBody(text, t, referenceLabels, skillNames, references)
      const fallback = plainProjection(text, referenceLabels, skillNames, references)

      // The action strip leads the row in DOM order and is pushed below the
      // bubble by flex `order`. Sibling plugins pick their bar with
      // `row.querySelector('[class*="_actions"]')` — first match in document
      // order — and a markdown bubble can contain a code card whose own
      // toolbar carries an `_actions` class (`_actions_1pq26_43`). With the
      // strip first, that lookup always lands on the message bar, the way it
      // did before markdown put code cards inside the row.
      return h(
        'div',
        { className: 'dshmb-row', 'data-dshmb-row': '1' },
        h(MessageActions, { text, time: data.time, t }),
        h(
          'div',
          { className: 'dshmb-stack' },
          attachments.length > 0 &&
            h(
              'div',
              { className: 'dshmb-attachments', 'data-message-attachments': true },
              attachments.map((attachment, index) =>
                h(AttachmentEntry, {
                  key: `${attachment.type}:${index}`,
                  attachment,
                  renderMessageImages,
                  compactImages,
                }),
              ),
            ),
          showBubble &&
            h(
              'div',
              { className: 'dshmb-bubble' },
              h(MarkdownBoundary, { key: text, fallback }, body === null ? fallback : body),
              rest.map((block, index) =>
                h(primitives.JsonBlock, {
                  key: 'rest' + index,
                  label: safeTranslate(t, 'message.extraBlock'),
                  payload: block,
                  truncatedLabel: (total) => safeTranslate(t, 'json.truncated', { total }),
                }),
              ),
            ),
          referenceLabels.length > 0 &&
            h(
              'div',
              { className: 'dshmb-referenceSummary' },
              safeTranslate(t, 'message.referenceSummary', {
                labels: referenceLabels.join(safeTranslate(t, 'message.referenceSeparator')),
              }),
            ),
        ),
      )
    })

    // --- style ------------------------------------------------------------------

    // Metrics are copied from the host's own sheets (MessageItem.module.css,
    // MessageIconActions.module.css) so the bubble is the same bubble, but the
    // classes are this plugin's own — no CSS-module hash to chase between
    // builds. Colors stay theme tokens; the two class suffixes sibling plugins
    // search for (`_actions`, `_action`) are preserved on the strip and its
    // buttons on purpose.
    const CSS = [
      '.dshmb-row{flex-direction:column;align-items:flex-end;gap:6px;display:flex}',
      // The strip leads the row's DOM order so sibling plugins' `_actions`
      // lookup finds it before any code-card toolbar inside the bubble;
      // `order` restores the visual order (bubble above, actions below).
      '.dshmb-stack{order:1;min-width:0;max-width:min(calc(var(--dsh-chat-content-width,748px) * .702), 82%);flex-direction:column;align-items:flex-end;gap:8px;display:flex}',
      '.dshmb-bubble{background:var(--dsw-specific-bubble);border-radius:var(--dsw-radius-xl);max-width:100%;font-size:var(--dsh-content-font-size,14px);line-height:calc(22px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-primary);word-break:break-word;padding:10px 16px}',
      '.dshmb-referenceSummary{color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(18px + var(--dsh-content-font-delta-secondary,0px))}',
      '.dshmb-attachments{flex-wrap:wrap;justify-content:flex-end;gap:8px;max-width:100%;display:flex}',
      '.dshmb-fileCard{border:.5px solid var(--dsw-alias-border-l2,#0000001f);border-radius:var(--dsw-radius-xl);background:var(--dsw-specific-input-major,transparent);box-sizing:border-box;flex:0 0 240px;align-items:center;gap:10px;width:240px;min-height:64px;padding:8px 12px;display:inline-flex}',
      '.dshmb-fileIcon{flex:none;width:28px;height:28px}',
      '.dshmb-fileContent{flex-direction:column;flex:1;min-width:0;display:flex}',
      '.dshmb-fileName{white-space:nowrap;text-overflow:ellipsis;color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:22px;overflow:hidden}',
      '.dshmb-fileMeta{white-space:nowrap;text-overflow:ellipsis;color:var(--dsw-alias-label-tertiary,#00000073);font-size:12px;line-height:15px;overflow:hidden}',
      // The bubble wraps with `pre-wrap`; markdown brings its own line
      // structure, so the markdown container returns to the normal policy.
      '.dshmb-md{white-space:normal;word-break:normal;overflow-wrap:anywhere;min-width:0;max-width:100%}',
      // MarkdownText's document spacing is tuned for a full transcript column;
      // inside a bubble those margins read as gaps. The host sheet's
      // first/last-child collapse is kept.
      '.dshmb-md > div > :first-child{margin-top:0!important}',
      '.dshmb-md > div > :last-child{margin-bottom:0!important}',
      '.dshmb-md > div p{margin:8px 0}',
      '.dshmb-md > div :where(h1,h2,h3){margin:16px 0 8px}',
      '.dshmb-md > div :where(h4,h5,h6){margin:12px 0 6px}',
      '.dshmb-md > div :where(ul,ol){margin:8px 0}',
      '.dshmb-md > div blockquote{margin:8px 0 0}',
      '.dshmb-md > div hr{margin:16px 0}',
      '.dshmb-md > div pre{margin:12px 0}',
      '.dshmb-plain{white-space:pre-wrap;word-break:break-word}',
      // Action strip metrics from the host's MessageIconActions.module.css.
      '.dshmb_actions{order:2;height:calc(28px + var(--dsh-content-font-delta,0px));align-items:center;gap:8px;display:flex}',
      '.dshmb-timeStart{font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(24px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-tertiary);white-space:nowrap;padding-right:12px}',
      '.dshmb_action{width:calc(28px + var(--dsh-content-font-delta,0px));height:calc(28px + var(--dsh-content-font-delta,0px));border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:none;justify-content:center;align-items:center;padding:6px;display:inline-flex}',
      '.dshmb_action svg{width:calc(15px + var(--dsh-content-font-delta,0px));height:calc(15px + var(--dsh-content-font-delta,0px))}',
      '.dshmb_action:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}',
      '.dshmb_action:focus-visible{outline:2px solid var(--dsw-alias-button-primary-fill,var(--dsw-alias-state-business-primary));outline-offset:2px}',
      // Host parity: every sent message but the latest hides its strip until
      // hover or focus, and the `data-actions-reveal` shell preference does
      // the same globally.
      '@media (hover:hover){',
      '[data-actions-reveal=hover] .dshmb_actions,',
      ':is([data-chat-flow-kind=user],[data-chat-flow-kind=steering]):has(~:is([data-chat-flow-kind=user],[data-chat-flow-kind=steering])) .dshmb_actions{opacity:0;transition:opacity 80ms}',
      '[data-actions-reveal=hover]:hover .dshmb_actions,',
      '[data-actions-reveal=hover]:focus-within .dshmb_actions,',
      ':is([data-chat-flow-kind=user],[data-chat-flow-kind=steering]):has(~:is([data-chat-flow-kind=user],[data-chat-flow-kind=steering])):hover .dshmb_actions,',
      ':is([data-chat-flow-kind=user],[data-chat-flow-kind=steering]):has(~:is([data-chat-flow-kind=user],[data-chat-flow-kind=steering])):focus-within .dshmb_actions{opacity:1}',
      '}',
    ].join('')

    /**
     * Inject the plugin's stylesheet once. Runs at apply time; the loader's
     * HMR sweep removes it by `data-plugin`, dispose by tag id.
     */
    function injectStyles() {
      if (typeof document === 'undefined') return
      if (document.querySelector('style[data-plugin-css=' + JSON.stringify(CSS_TAG) + ']') !== null) return
      const tag = document.createElement('style')
      tag.dataset.plugin = NS
      tag.dataset.pluginCss = CSS_TAG
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    /** Remove the stylesheet this plugin injected, if still present. */
    function removeStyles() {
      if (typeof document === 'undefined') return
      const tag = document.querySelector('style[data-plugin-css=' + JSON.stringify(CSS_TAG) + ']')
      if (tag !== null) tag.remove()
    }

    // --- plugin -----------------------------------------------------------------

    /**
     * Browser plugin body: inject the stylesheet and shadow the two sent-text
     * chat seats for as long as this fiber lives. Disposal (or an uninstall)
     * restores the host's own renderers.
     * @param ctx - client cordis context (slots and locale by injection).
     */
    function apply(ctx) {
      injectStyles()
      for (const key of SEATS) {
        ctx.slots.inject('conversation.chat.node', () =>
          ctx.slots.register(
            {
              name: 'conversation.chat.node',
              key,
              priority: SEAT_PRIORITY,
              locale: 'chat',
            },
            MarkdownBubbleSeat,
          ),
        )
      }

      globalThis[DEBUG_KEY] = { version: PLUGIN_VERSION, seats: SEATS.slice() }

      ctx.effect(
        () => () => {
          delete globalThis[DEBUG_KEY]
          removeStyles()
        },
        NS + ': lifecycle',
      )
    }

    exports.apply = apply
    exports.inject = ['slots', 'locale']
    exports.PLUGIN_VERSION = PLUGIN_VERSION
    exports.SEATS = SEATS
    exports.SEAT_PRIORITY = SEAT_PRIORITY
    exports.toMarkdown = toMarkdown
    exports.preserveHardBreaks = preserveHardBreaks
    exports.unwrapSessionReferences = unwrapSessionReferences
    exports.contentParts = contentParts
    exports.composeUserMarkdown = composeUserMarkdown
    exports.MarkdownBubbleSeat = MarkdownBubbleSeat
    return module.exports
  },
})
