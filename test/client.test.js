// Unit tests for the browser half's pure machinery: source preparation (soft
// breaks, fences, wire links), content splitting, chip-aware markdown
// composition, and the seat registration contract. The rendered DOM is
// verified against the running instance by tools/verify-live-ui.mjs; this file
// runs without a browser.
//
//   node --test "test/*.test.js"
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// --- materialize the browser bundle in Node ---------------------------------

let registration
globalThis.window = {
  __ModuleLoader__: {
    load: (value) => {
      registration = value
    },
  },
}
await import('../src/client.js')

const HOST_HALF = await import('../src/index.js')
const PACKAGE = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const SOURCE = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')

// --- stubs -------------------------------------------------------------------

/** A React stub carrying only what the factory touches. */
function reactStub() {
  const Fragment = Symbol('Fragment')
  class Component {
    constructor(props) {
      this.props = props
    }
  }
  const createElement = (type, props, ...children) => ({
    __element: true,
    type,
    props: { ...(props ?? {}), children: children.length <= 1 ? children[0] : children },
  })
  return {
    Fragment,
    Component,
    createElement,
    isValidElement: (value) => typeof value === 'object' && value !== null && value.__element === true,
    memo: (component) => component,
    useCallback: (fn) => fn,
    useEffect: () => {},
    useMemo: (factory) => factory(),
    useRef: (value) => ({ current: value ?? null }),
    useState: (value) => [value, () => {}],
  }
}

/** The class a fenced-code toolbar carries inside MarkdownText: it ends in the _actions suffix. */
const CODE_CARD_TOOLBAR = '_actions_1pq26_43'

/**
 * A primitives stub; only the projection, MarkdownText and the strip pieces are
 * reached. Tooltip renders its child in place because the real one adds no
 * wrapper element: on the running instance the copy button is a DIRECT child of
 * the action strip, which is what dsh-edit-turn's lastPlatformAction(bar) reads
 * when it parks its pencil. MarkdownText renders the host wrapper
 * (div.markdown); with options.codeCard it also renders a fenced-code toolbar
 * whose class carries the same _actions suffix, so a test can show that the
 * sibling lookup never lands on it.
 * @param projectUserText - the host projection stub.
 * @param options - codeCard: true puts an _actions toolbar inside the bubble.
 * @param react - the react stub the stub elements are built with.
 * @returns the primitives module stub.
 */
function primitivesStub(projectUserText, options, react) {
  const codeCard = options?.codeCard === true
  const markdownBody = (props) => [
    react.createElement('p', null, props.text),
    ...(codeCard
      ? [react.createElement('div', { className: CODE_CARD_TOOLBAR }, react.createElement('button', { type: 'button', className: '_action_1pq26_9' }, 'copy'))]
      : []),
  ]
  return {
    projectUserText,
    MarkdownText: (props) => react.createElement('div', { className: 'markdown' }, markdownBody(props)),
    JsonBlock: function JsonBlock() {},
    Tooltip: (props) => props.children,
    FileTypeIcon: function FileTypeIcon() {},
    IconCheckOutlineRegular: function IconCheckOutlineRegular() {},
    IconCopyOutlineRegular: function IconCopyOutlineRegular() {},
    fileExtension: () => 'txt',
    fileSizeText: () => '1 KB',
    writeClipboard: () => Promise.resolve(true),
  }
}

/**
 * Run the registered factory with stub modules.
 * @param makeProjection - (react) => the projectUserText stub. Defaults to a
 * chip-free projection rendering the whole text in one plain run.
 * @param options - forwarded to the primitives stub (see {@link primitivesStub}).
 * @returns the plugin exports and the react stub.
 */
function materialize(makeProjection, options) {
  assert.ok(registration !== undefined, 'the bundle registered its factory')
  assert.equal(registration.id, 'dsh-markdown-bubble')
  const react = reactStub()
  const projectUserText =
    makeProjection === undefined
      ? (text) => react.createElement('span', { className: 'plainRun' }, text)
      : makeProjection(react)
  const primitives = primitivesStub(projectUserText, options, react)
  const require = (spec) => {
    if (spec === 'react') return react
    if (spec === '@deepseek-ai/dsh-client-ui-primitives') return primitives
    throw new Error(`unexpected require(${JSON.stringify(spec)})`)
  }
  return { exports: registration.factory(require), react }
}

/** A projection stub of the shape the host returns when chips are present. */
function chipProjection(splitAt, chipProps, chipLabel) {
  return (react) => (text) =>
    react.createElement(react.Fragment, null, [
      react.createElement('span', { className: 'plainRun' }, text.slice(0, splitAt)),
      react.createElement('button', chipProps, chipLabel),
      react.createElement('span', { className: 'plainRun' }, text.slice(splitAt)),
    ])
}

/** The projection of two file chips joined by a whitespace-only plain run. */
function chipPairProjection(gap) {
  return (react) => () =>
    react.createElement(react.Fragment, null, [
      react.createElement('button', { 'data-ref-chip': 'file', key: 'a' }, '@a'),
      react.createElement('span', { className: 'plainRun', key: 'gap' }, gap),
      react.createElement('button', { 'data-ref-chip': 'file', key: 'b' }, '@b'),
    ])
}

// --- the rendered structure --------------------------------------------------

/**
 * Materialize the element tree a component returns into a DOM-shaped tree, so
 * structure assertions read like DOM queries: fragments splice, function
 * components render in place (the stubs' Tooltip adds no wrapper, exactly like
 * the real one), class components render through their instance, host elements
 * become { tag, className, props, kids } nodes, and text and the icon stubs
 * materialize to nothing.
 * @param node - an element, an array of them, or a leaf.
 * @param react - the react stub the tree was built with.
 * @returns the flattened child list.
 */
function renderTree(node, react) {
  if (node === null || node === undefined || typeof node === 'boolean') return []
  if (Array.isArray(node)) return node.flatMap((kid) => renderTree(kid, react))
  if (typeof node === 'string' || typeof node === 'number') return []
  if (node.__element !== true) return []
  const { type, props } = node
  if (type === react.Fragment) return renderTree(props.children, react)
  if (typeof type === 'string') {
    return [
      {
        tag: type,
        className: typeof props.className === 'string' ? props.className : '',
        props,
        kids: renderTree(props.children, react),
      },
    ]
  }
  if (typeof type === 'function') {
    if (Object.getPrototypeOf(type) === react.Component) {
      const instance = new type(props)
      return renderTree(instance.render(), react)
    }
    return renderTree(type(props), react)
  }
  return []
}

/** Every node of a tree, pre-order: the document order a selector walks. */
function flatten(nodes) {
  return nodes.flatMap((node) => [node, ...flatten(node.kids)])
}

/** The first node in document order matching a predicate: querySelector. */
function querySelector(nodes, predicate) {
  return flatten(nodes).find(predicate) ?? null
}

/** The props a keyed conversation.chat.node seat receives for a user row. */
function seatProps(overrides) {
  return {
    node: {
      data: {
        content: [{ type: 'text', text: 'hello **world**' }],
        time: Date.UTC(2026, 0, 2, 3, 4),
        referenceLabels: [],
        skillNames: [],
      },
    },
    renderMessageImages: () => null,
    openFile: () => {},
    openSkill: () => {},
    t: (key) => key,
    ...overrides,
  }
}

/** A document stub carrying only what the style half touches. */
function documentStub() {
  const created = []
  const head = {
    children: [],
    appendChild(node) {
      this.children.push(node)
    },
  }
  return {
    created,
    head,
    createElement(tag) {
      created.push(tag)
      return {
        tagName: tag.toUpperCase(),
        dataset: {},
        textContent: '',
        remove() {
          const index = head.children.indexOf(this)
          if (index >= 0) head.children.splice(index, 1)
        },
      }
    },
    querySelector(selector) {
      const match = /^style\[data-plugin-css=(.*)\]$/.exec(selector)
      if (match === null) return null
      return head.children.find((node) => node.tagName === 'STYLE' && node.dataset.pluginCss === JSON.parse(match[1])) ?? null
    },
  }
}

/** The client context surface apply() uses. */
function fakeContext() {
  const effects = []
  return {
    effects,
    slots: { inject: () => {}, register: () => () => {} },
    effect: (factory) => {
      const dispose = factory()
      if (typeof dispose === 'function') effects.push(dispose)
    },
  }
}

// --- preserveHardBreaks ------------------------------------------------------

const { preserveHardBreaks, toMarkdown, unwrapSessionReferences } = materialize().exports

test('a single newline inside a paragraph becomes a hard break', () => {
  assert.equal(preserveHardBreaks('first\nsecond'), 'first  \nsecond')
})

test('a blank line ends the paragraph; no hard break is added', () => {
  assert.equal(preserveHardBreaks('first\n\nsecond'), 'first\n\nsecond')
})

test('a trailing newline adds nothing to the last line', () => {
  assert.equal(preserveHardBreaks('first\nsecond\n'), 'first  \nsecond\n')
})

test('single-line text is returned untouched', () => {
  assert.equal(preserveHardBreaks('no newline here'), 'no newline here')
})

test('fenced code keeps every byte, including blank and indented lines', () => {
  const source = 'before\n```js\nconst a = 1\n\n    indented\n```\nafter'
  assert.equal(preserveHardBreaks(source), 'before  \n```js\nconst a = 1\n\n    indented\n```\nafter')
})

test('tilde fences are tracked the same way', () => {
  const source = '~~~\na\n~~~\nb'
  assert.equal(preserveHardBreaks(source), '~~~\na\n~~~\nb')
})

test('a longer fence is not closed by a shorter same-character run', () => {
  const source = '````\n```\n````\nb'
  assert.equal(preserveHardBreaks(source), '````\n```\n````\nb')
})

test('indented code lines do not receive hard breaks', () => {
  assert.equal(preserveHardBreaks('text\n    code line'), 'text  \n    code line')
})

test('table rows keep their structure (trailing spaces are trimmed by the parser)', () => {
  assert.equal(preserveHardBreaks('| a | b |\n| --- | --- |\n| 1 | 2 |'), '| a | b |  \n| --- | --- |  \n| 1 | 2 |')
})

test('an unclosed fence protects the remainder', () => {
  assert.equal(preserveHardBreaks('```\na\nb'), '```\na\nb')
})

// --- toMarkdown --------------------------------------------------------------

test('CRLF is normalized before the break pass', () => {
  assert.equal(toMarkdown('first\r\nsecond'), 'first  \nsecond')
})

test('session-recall wire links collapse to their display label', () => {
  assert.equal(unwrapSessionReferences('ask @[词评](dsh-session:abc-123) now'), 'ask 词评 now')
  assert.equal(toMarkdown('@[词评](dsh-session:abc-123)\nsecond'), '词评  \nsecond')
})

test('a wire link inside fenced code is not rewritten', () => {
  const source = '```\n@[x](dsh-session:y)\n```'
  assert.equal(toMarkdown(source), source)
})

// --- contentParts ------------------------------------------------------------

test('content blocks split into text, attachments and rest like the host', () => {
  const { exports } = materialize()
  const { text, attachments, rest } = exports.contentParts([
    { type: 'text', text: 'hello ' },
    { type: 'image', attachment: { id: 'i1' } },
    { type: 'file', attachment: { name: 'a.txt', bytes: 3 } },
    { type: 'text', text: 'world' },
    { type: 'mystery' },
  ])
  assert.equal(text, 'hello world')
  assert.deepEqual(attachments, [
    { type: 'image', image: { attachment: { id: 'i1' } } },
    { type: 'file', file: { name: 'a.txt', bytes: 3 } },
  ])
  assert.deepEqual(rest, [{ type: 'mystery' }])
})

test('a block without an attachment falls through to rest', () => {
  const { exports } = materialize()
  const { attachments, rest } = exports.contentParts([{ type: 'image' }, { type: 'file' }])
  assert.equal(attachments.length, 0)
  assert.equal(rest.length, 2)
})

// --- composeUserMarkdown -----------------------------------------------------

test('a message without chips becomes one markdown block', () => {
  const { exports } = materialize()
  const body = exports.composeUserMarkdown('line one\nline two', {}, [], [], undefined)
  assert.equal(body.props['data-dshmb-md'], '1')
  assert.equal(body.props.children.props.text, 'line one  \nline two')
})

test('chips stay chips and plain runs become markdown blocks around them', () => {
  const { exports } = materialize(chipProjection(2, { 'data-ref-chip': 'file' }, 'file.ts'))
  const body = exports.composeUserMarkdown('abFILEcd', {}, [], [], undefined)
  const children = body.props.children
  assert.equal(children.length, 3)
  assert.equal(children[0].props['data-dshmb-md'], '1')
  assert.equal(children[1].props.children.props['data-ref-chip'], 'file')
  assert.equal(children[2].props['data-dshmb-md'], '1')
})

test('a whitespace-only run keeps its gap instead of becoming an empty block', () => {
  const { exports } = materialize(chipProjection(3, { 'data-ref-chip': 'skill' }, 'skill'))
  const body = exports.composeUserMarkdown('   x', {}, [], [], undefined)
  // Composition is [gap, chip, md]: the blank run is the host's own pre-wrap
  // plain run, never an emptied-out markdown block.
  const children = body.props.children
  assert.equal(children.length, 3)
  assert.equal(children[0].props['data-dshmb-gap'], '1')
  assert.equal(children[0].props.className, 'dshmb-plain')
  assert.equal(children[0].props.children, '   ')
  assert.equal(children[1].props.children.props['data-ref-chip'], 'skill')
  assert.equal(children[2].props['data-dshmb-md'], '1')
})

test('the whitespace between two chips survives: chips are not glued together', () => {
  const { exports } = materialize(chipPairProjection(' '))
  const body = exports.composeUserMarkdown('@a @b', {}, [], [], undefined)
  const children = body.props.children
  assert.equal(children.length, 3)
  // Each chip is wrapped in a keyed fragment; the gap is this plugin's own node.
  assert.equal(children[0].props.children.props['data-ref-chip'], 'file')
  assert.equal(children[1].props['data-dshmb-gap'], '1')
  assert.equal(children[1].props.children, ' ')
  assert.equal(children[2].props.children.props['data-ref-chip'], 'file')
})

test('a newline between two chips stays a line break, as the host pre-wrap bubble shows it', () => {
  const { exports } = materialize(chipPairProjection('\n'))
  const body = exports.composeUserMarkdown('@a\n@b', {}, [], [], undefined)
  const gap = body.props.children[1]
  assert.equal(gap.props['data-dshmb-gap'], '1')
  assert.equal(gap.props.className, 'dshmb-plain')
  assert.equal(gap.props.children, '\n')
})

test('empty text composes to nothing', () => {
  const { exports } = materialize()
  assert.equal(exports.composeUserMarkdown('', {}, [], [], undefined), null)
})

// --- registration ------------------------------------------------------------

test('apply shadows both sent-message seats at a lower priority', () => {
  const { exports } = materialize()
  assert.equal(exports.inject[0], 'slots')
  assert.deepEqual(exports.SEATS, ['user', 'steering'])
  assert.ok(exports.SEAT_PRIORITY < 0)

  const injections = []
  const disposers = []
  const ctx = {
    slots: {
      inject: (key, callback) => {
        injections.push({ key, callback })
      },
      register: () => () => {},
    },
    effect: (factory) => {
      const dispose = factory()
      if (typeof dispose === 'function') disposers.push(dispose)
    },
  }
  exports.apply(ctx)

  assert.equal(injections.length, 2)
  const registrations = []
  ctx.slots.register = (options, component) => {
    registrations.push({ options, component })
    return () => {}
  }
  for (const injection of injections) {
    assert.equal(injection.key, 'conversation.chat.node')
    injection.callback()
  }
  assert.deepEqual(
    registrations.map((entry) => entry.options.key),
    ['user', 'steering'],
  )
  for (const entry of registrations) {
    assert.equal(entry.options.name, 'conversation.chat.node')
    assert.equal(entry.options.priority, -1)
    assert.equal(entry.options.locale, 'chat')
    assert.equal(entry.component, exports.MarkdownBubbleSeat)
  }
  assert.equal(globalThis.__DSH_MARKDOWN_BUBBLE__.version, exports.PLUGIN_VERSION)
  assert.deepEqual(globalThis.__DSH_MARKDOWN_BUBBLE__.seats, ['user', 'steering'])

  for (const dispose of disposers.reverse()) dispose()
})

// --- action-strip anchors (dsh-edit-turn / dsh-delete-turn / dsh-rerun-turn) --

test('the rendered row keeps every anchor the sibling plugins search for', () => {
  const { exports, react } = materialize(undefined, { codeCard: true })
  const tree = renderTree(exports.MarkdownBubbleSeat(seatProps()), react)
  const row = querySelector(tree, (node) => node.className.includes('dshmb-row'))
  assert.ok(row !== null, 'the row renders')
  assert.equal(row.props['data-dshmb-row'], '1')
  assert.equal(row.kids.length, 2)

  // dsh-edit-turn/lib/client.js:810/898/927/1088, dsh-delete-turn/src/client.js:565
  // and dsh-rerun-turn/lib/client.js:686 all take
  // row.querySelector('[class*="_actions"]') — the first match in document
  // order. A markdown code card carries the same suffix inside the bubble, so
  // the strip has to lead the row's DOM order for that lookup to land on the
  // bar instead of a code-card toolbar.
  const strip = querySelector(row.kids, (node) => node.className.includes('_actions'))
  assert.equal(strip.className, 'dshmb_actions')
  assert.equal(strip.props['data-dshmb-actions'], '1')
  assert.equal(row.kids[0], strip, 'the strip is the first child in DOM order')

  // The code-card toolbar lives inside the bubble, which is what makes the
  // assertion above load-bearing rather than vacuous.
  const toolbar = querySelector(row.kids, (node) => node.className === CODE_CARD_TOOLBAR)
  assert.ok(toolbar !== null, 'the markdown code card renders its own _actions toolbar inside the bubble')
  assert.notEqual(toolbar, strip)

  // The strip's direct children mirror the host's own MessageIconActions
  // (client.js:1157-1172): the clock first, then the copy button whose class
  // matches /_action\b/ as a DIRECT child — what dsh-edit-turn's
  // lastPlatformAction(bar) (lib/client.js:1120-1128) scans for, and what
  // dsh-rerun-turn's bar.querySelectorAll('button') (lib/client.js:691) picks up
  // as its insertion point.
  const clock = strip.kids[0]
  assert.ok(clock.className.includes('timeStart'))
  assert.equal(strip.props['data-clock'], 'start')
  const copy = strip.kids[strip.kids.length - 1]
  assert.equal(copy.tag, 'button')
  assert.ok(/_action\b/.test(copy.className), 'the copy class ends in _action')
  assert.equal(copy.props['data-dshmb-action'], '1')
  assert.equal(copy.props['aria-label'], 'copy')
  assert.equal(copy.props.type, 'button')
  assert.equal(strip.kids.filter((node) => node.tag === 'button').length, 1, 'the strip seeds exactly one button')

  // The hierarchy the collapse walk climbs: row > stack > bubble > markdown.
  const stack = querySelector(row.kids, (node) => node.className.includes('dshmb-stack'))
  const bubble = querySelector(stack.kids, (node) => node.className.includes('dshmb-bubble'))
  const markdownBlock = querySelector(bubble.kids, (node) => node.className.includes('dshmb-md'))
  assert.equal(markdownBlock.props['data-dshmb-md'], '1')
  assert.equal(markdownBlock.kids[0].className, 'markdown', 'the host MarkdownText wrapper stays inside the markdown block')
})

test('a chip-bearing message keeps the chip as a button between its markdown blocks', () => {
  const { exports, react } = materialize(chipProjection(5, { 'data-ref-chip': 'file' }, 'file.ts'))
  const props = seatProps()
  props.node.data.content = [{ type: 'text', text: 'open FILE now' }]
  const nodes = flatten(renderTree(exports.MarkdownBubbleSeat(props), react))
  const chips = nodes.filter((node) => node.props['data-ref-chip'] !== undefined)
  assert.equal(chips.length, 1)
  assert.equal(chips[0].tag, 'button')
  const blocks = nodes.filter((node) => node.props['data-dshmb-md'] === '1')
  assert.equal(blocks.length, 2, 'the plain runs on both sides of the chip became markdown blocks')
  assert.ok(nodes.indexOf(blocks[0]) < nodes.indexOf(chips[0]))
  assert.ok(nodes.indexOf(chips[0]) < nodes.indexOf(blocks[1]))
})

test('a hostile host shape cannot retire the seat', () => {
  // A throw while the seat itself renders is not caught by MarkdownBoundary (a
  // boundary catches descendants, not the parent render that creates it). It
  // escapes to the slot machinery, which retires the entry and hands the row
  // back to the host's raw renderer — the exact symptom of "the plugin stopped
  // rendering". The seat must therefore never throw, whatever the host shape.
  const explodingProjection = (react) => () => {
    throw new Error('projection exploded')
  }
  const explodingTranslate = () => {
    throw new Error('locale exploded')
  }

  const cases = [
    { label: 'a projection that throws', make: explodingProjection, overrides: {}, bubble: true },
    { label: 'a translator that throws', make: undefined, overrides: { t: explodingTranslate }, bubble: true },
    { label: 'no translator at all', make: undefined, overrides: { t: undefined }, bubble: true },
    { label: 'content that is not an array', make: undefined, overrides: { node: { data: { content: undefined, time: 1 } } }, bubble: false },
  ]

  for (const testCase of cases) {
    const { exports, react } = materialize(testCase.make, { codeCard: true })
    let tree
    assert.doesNotThrow(() => {
      tree = renderTree(exports.MarkdownBubbleSeat(seatProps(testCase.overrides)), react)
    }, testCase.label)
    const row = querySelector(tree, (node) => node.className.includes('dshmb-row'))
    assert.ok(row !== null, `${testCase.label}: the row still renders`)
    assert.ok(
      querySelector(row.kids, (node) => node.className.includes('_actions')) !== null,
      `${testCase.label}: the action strip still renders`,
    )
    if (testCase.bubble) {
      assert.ok(
        querySelector(row.kids, (node) => node.className.includes('dshmb-bubble')) !== null,
        `${testCase.label}: the bubble still renders`,
      )
    }
  }
})

// --- I3 / I4: pure projection, no row hiding ---------------------------------

test('the renderer is a pure projection: no inline styles and no hidden markers', () => {
  const { exports, react } = materialize(undefined, { codeCard: true })
  const nodes = flatten(renderTree(exports.MarkdownBubbleSeat(seatProps()), react))
  assert.ok(nodes.length > 4, 'the seat renders a real tree')
  for (const node of nodes) {
    assert.equal(node.props.style, undefined, 'no node carries an inline style')
    for (const name of Object.keys(node.props)) {
      assert.ok(!/^data-(dshdt|dshet|dsrr)-/.test(name), 'no node writes a sibling namespace')
      assert.ok(!/hidden/i.test(name), 'no node writes a hidden marker')
    }
  }
})

test('the plugin never hides a row, so it needs no HIDE_OWNERS guard', () => {
  assert.ok(!/data-dshdt-hidden|data-dshet-hidden|data-dsrr-hidden/.test(SOURCE))
  assert.ok(!/style\.display/.test(SOURCE))
  assert.ok(!/foreignHideOn|HIDE_OWNERS/.test(SOURCE))
  const withoutStyleTag = SOURCE.replace(/tag\.remove\(\)/g, '')
  assert.ok(!/\.remove\(\)/.test(withoutStyleTag), 'the only node removal is the plugin own style tag')
})

// --- I6: web / desktop parity ------------------------------------------------

test('the browser half depends on no sibling package and no web-only global', () => {
  assert.ok(!/require\(\s*['"](dsh-edit-turn|dsh-delete-turn|dsh-rerun-turn|dsh-as-aistudio)/.test(SOURCE))
  assert.ok(!/from\s+['"](dsh-edit-turn|dsh-delete-turn|dsh-rerun-turn|dsh-as-aistudio)/.test(SOURCE))
  for (const banned of ['__DSH_BOOT__', 'location.origin', 'location.port', 'navigator.userAgent', 'showDirectoryPicker', 'window.open', '<dialog', 'popover']) {
    assert.ok(!SOURCE.includes(banned), 'src/client.js must not reference ' + banned)
  }
  // The host's client-module scanner accepts exactly one platform string
  // (@deepseek-ai/dsh-client-modules/lib/index.js:714) and the desktop shell
  // loads the same web bundle.
  assert.equal(PACKAGE.dsh.client.platform, 'web')
  for (const field of ['dependencies', 'peerDependencies', 'devDependencies']) {
    for (const name of Object.keys(PACKAGE[field] ?? {})) {
      assert.ok(!/^dsh-(edit-turn|delete-turn|rerun-turn|as-aistudio)$/.test(name), field + ' must not name ' + name)
    }
  }
})

test('apply injects one stylesheet, is idempotent, and dispose removes it', () => {
  const { exports } = materialize()
  const doc = documentStub()
  globalThis.document = doc
  try {
    const first = fakeContext()
    exports.apply(first)
    assert.deepEqual(doc.created, ['style'], 'the style tag is the only node the plugin creates')
    assert.equal(doc.head.children.length, 1)
    assert.equal(doc.head.children[0].dataset.plugin, 'dsh-markdown-bubble')
    assert.equal(doc.head.children[0].dataset.pluginCss, 'dsh-markdown-bubble/markdown-bubble.css')
    const css = doc.head.children[0].textContent
    // The strip leads the row's DOM order and flex order restores the visual
    // order; the anchor test above asserts the DOM half of that pair.
    assert.ok(css.includes('.dshmb-stack{order:1'))
    assert.ok(css.includes('.dshmb_actions{order:2'))
    assert.ok(css.includes('.dshmb-plain{white-space:pre-wrap'))

    // A second apply (HMR or a re-mount) reuses the sheet instead of adding one.
    exports.apply(fakeContext())
    assert.equal(doc.head.children.length, 1)

    for (const dispose of first.effects) dispose()
    assert.equal(doc.head.children.length, 0, 'dispose removes the stylesheet')
    assert.equal(globalThis.__DSH_MARKDOWN_BUBBLE__, undefined, 'dispose clears the presence marker')
  } finally {
    delete globalThis.document
  }
})

// --- I9: version and identity sync -------------------------------------------

test('package.json, the host half and the bundle agree on the version', () => {
  const { exports } = materialize()
  assert.equal(HOST_HALF.PLUGIN_ID, 'dsh-markdown-bubble')
  assert.equal(PACKAGE.name, HOST_HALF.PLUGIN_ID)
  assert.equal(HOST_HALF.PLUGIN_VERSION, PACKAGE.version)
  assert.equal(exports.PLUGIN_VERSION, PACKAGE.version)
  assert.equal(typeof PACKAGE.dsh.engines.dsh, 'string')
})
// --- the seat never throws, whatever the host hands it ------------------------

test('no host shape can throw out of the seat render', () => {
  // The invariant the plugin lives by: a throw inside the SEAT'S OWN render is
  // not caught by MarkdownBoundary (a boundary catches its descendants, not the
  // render that creates it). It escapes to the slot machinery, which retires the
  // whole entry and hands the row back to the host's raw renderer — on screen,
  // "the bubble went back to raw markdown", the exact report this round fixes.
  //
  // safeMarkdownBody guards composition and plainProjection guards the host
  // projection; the shapes below are the ones that still threw when this test
  // was written, each reproduced against the real bundle first:
  //   - node absent          -> node.data
  //   - props absent         -> the destructuring itself
  //   - a time the Date constructor refuses (Symbol, BigInt, a valueOf that throws)
  //   - a host image renderer that throws
  const explodingProjection = (react) => () => {
    throw new Error('projection exploded')
  }
  const throwingValue = { valueOf() { throw new Error('valueOf exploded') } }
  const shapes = [
    ['node undefined', { node: undefined }],
    ['node null', { node: null }],
    ['no props at all', undefined],
    ['time is a Symbol', { node: { data: { content: [{ type: 'text', text: 'x' }], time: Symbol('t') } } }],
    ['time is a BigInt', { node: { data: { content: [{ type: 'text', text: 'x' }], time: 10n } } }],
    ['time is a throwing object', { node: { data: { content: [{ type: 'text', text: 'x' }], time: throwingValue } } }],
    ['renderMessageImages throws', { node: { data: { content: [{ type: 'image', attachment: { id: 'a' } }] } }, renderMessageImages: () => { throw new Error('images exploded') } }],
    ['a projection that throws', undefined, explodingProjection],
  ]

  for (const [label, overrides, makeProjection] of shapes) {
    const { exports, react } = materialize(makeProjection)
    let tree
    assert.doesNotThrow(() => {
      tree = renderTree(exports.MarkdownBubbleSeat(seatProps(overrides)), react)
    }, label)

    // The row survives AND keeps the anchors the three sibling plugins search
    // for: without the strip on this row, edit / delete / rerun lose their
    // insertion point and their own buttons vanish from a message that is still
    // perfectly readable.
    const row = querySelector(tree, (node) => node.className.includes('dshmb-row'))
    assert.ok(row !== null, label + ': the row still renders')
    const strip = querySelector(row.kids, (node) => node.className.includes('_actions'))
    assert.ok(strip !== null, label + ': the action strip still renders')
    assert.equal(strip.props['data-dshmb-actions'], '1', label + ': the strip keeps its namespace')
    assert.equal(row.kids[0], strip, label + ': the strip still leads the row in DOM order')
  }
})

test('a degraded row shows the raw text instead of nothing', () => {
  // The last-resort net returns plain text rather than an empty row: losing the
  // markdown is survivable, losing the message is not.
  const { exports, react } = materialize()
  const props = seatProps()
  // Force the seat body to throw after the text is already known: a throwing
  // translator is the cheapest way in (the strip and the reference summary both
  // call it).
  props.t = () => {
    throw new Error('locale exploded')
  }
  const tree = renderTree(exports.MarkdownBubbleSeat(props), react)
  const row = querySelector(tree, (node) => node.className.includes('dshmb-row'))
  assert.ok(row !== null, 'the row renders')
  assert.ok(querySelector(row.kids, (node) => node.className.includes('_actions')) !== null, 'the strip renders')
  assert.ok(querySelector(row.kids, (node) => node.className.includes('dshmb-bubble')) !== null, 'the text still shows')
})

// --- one degradation function, by construction ---------------------------------

test('there is exactly one place that projects, and one that builds the raw text', () => {
  // The reviewer's rule: the ways this plugin degrades must answer ONE function,
  // so they cannot drift apart. Composition failure, a boundary catch and the
  // last-resort net all show the same thing; a second copy of the fallback is
  // how they stop doing so.
  const source = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
  const code = source.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

  const projections = [...code.matchAll(/primitives\.projectUserText\(/g)]
  assert.equal(projections.length, 1, 'the host projection is called in exactly one place (degradedBody)')

  // The raw-text span is constructed once too. gapSpan (the whitespace between
  // two chips) is a *composition* piece, not a degradation, so it is allowed.
  const rawText = [...code.matchAll(/h\('span', \{ className: 'dshmb-plain' \}, text\)/g)]
  assert.equal(rawText.length, 1, 'the degraded raw-text span is built in exactly one place')

  // And every degradation caller goes through it.
  const calls = [...code.matchAll(/degradedBody\(/g)]
  assert.ok(calls.length >= 4, 'degradation (composition, boundary fallback, last resort) shares one function')
})
