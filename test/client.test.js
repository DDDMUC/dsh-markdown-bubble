// Unit tests for the browser half's pure machinery: source preparation (soft
// breaks, fences, wire links), content splitting, chip-aware markdown
// composition, and the seat registration contract. The rendered DOM is
// verified against the running instance by tools/verify-live-ui.mjs; this file
// runs without a browser.
//
//   node --test "test/*.test.js"
import assert from 'node:assert/strict'
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

/** A primitives stub; only the projection and MarkdownText are reached. */
function primitivesStub(projectUserText) {
  return {
    projectUserText,
    MarkdownText: function MarkdownText() {},
    JsonBlock: function JsonBlock() {},
    Tooltip: function Tooltip() {},
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
 * @returns the plugin exports and the react stub.
 */
function materialize(makeProjection) {
  assert.ok(registration !== undefined, 'the bundle registered its factory')
  assert.equal(registration.id, 'dsh-markdown-bubble')
  const react = reactStub()
  const projectUserText =
    makeProjection === undefined
      ? (text) => react.createElement('span', { className: 'plainRun' }, text)
      : makeProjection(react)
  const primitives = primitivesStub(projectUserText)
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

test('a whitespace-only run is dropped, not rendered as an empty block', () => {
  const { exports } = materialize(chipProjection(3, { 'data-ref-chip': 'skill' }, 'skill'))
  const body = exports.composeUserMarkdown('   x', {}, [], [], undefined)
  // Composition is [chip, md] — the leading blank run never became a block.
  const children = body.props.children
  assert.equal(children.length, 2)
  assert.equal(children[0].props.children.props['data-ref-chip'], 'skill')
  assert.equal(children[1].props['data-dshmb-md'], '1')
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
