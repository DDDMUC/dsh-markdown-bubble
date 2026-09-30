// Verify what the browser is actually RENDERING of this plugin, over CDP.
//
// The unit tests see the source against stubs; the token client checker sees
// the served bytes. Neither sees the mounted page — whether the projection
// patch really took, whether a sent bubble really switched to markdown, and
// whether the queue previews were left alone. This drives a real tab and reads
// its DOM.
//
//   node tools/verify-live-ui.mjs
//   node tools/verify-live-ui.mjs --reload          # reload the page first
//   CDP_URL=http://127.0.0.1:9333 DSH_URL=http://127.0.0.1:3080 node tools/verify-live-ui.mjs
//
// Requirements: a Chrome/Chromium started with --remote-debugging-port (9333
// by default) that has the DSH instance open. Without --reload it is
// read-only; with --reload it reloads the page (cache-busted) to mount the
// current bundle.
import { PLUGIN_ID, PLUGIN_VERSION } from '../src/index.js'

const CDP_URL = (process.env.CDP_URL || 'http://127.0.0.1:9333').replace(/\/$/, '')
const APP_URL = (process.env.DSH_URL || 'http://127.0.0.1:3080').replace(/\/$/, '')
const RELOAD = process.argv.includes('--reload')

let failures = 0
function check(label, condition, detail) {
  if (condition) console.log(`  ✓ ${label}`)
  else {
    failures += 1
    console.log(`  ✗ ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}
function note(label, detail) {
  console.log(`  · ${label}${detail === undefined ? '' : ` — ${detail}`}`)
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// --- the wire ----------------------------------------------------------------

async function attach() {
  const targets = await (await fetch(`${CDP_URL}/json/list`)).json()
  const pages = targets.filter((target) => target.type === 'page')
  if (pages.length === 0) {
    throw new Error(`no page target on ${CDP_URL}; start Chrome with --remote-debugging-port`)
  }
  const page = pages.find((target) => target.url.startsWith(APP_URL)) ?? pages[0]
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })

  let nextId = 0
  const pending = new Map()
  const listeners = new Set()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id !== undefined && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) reject(new Error(JSON.stringify(message.error)))
      else resolve(message.result)
      return
    }
    for (const listener of listeners) listener(message)
  })

  const send = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++nextId
      pending.set(id, { resolve, reject })
      socket.send(JSON.stringify({ id, method, params }))
    })

  return {
    page,
    send,
    on: (listener) => listeners.add(listener),
    close: () => socket.close(),
  }
}

// --- read helpers ------------------------------------------------------------

async function evaluate(wire, expression) {
  const result = await wire.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (result.exceptionDetails !== undefined) {
    throw new Error(`page evaluation failed: ${result.exceptionDetails.text}`)
  }
  return result.result?.value
}

async function waitFor(wire, expression, timeoutMs, stepMs = 250) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if (await evaluate(wire, expression)) return true
    } catch {
      // The page is mid-navigation; retry until the deadline.
    }
    await sleep(stepMs)
  }
  return false
}

// The DOM probe: everything the checks assert, in one round trip.
const PROBE = `(() => {
  const SEAT = '[data-chat-flow-kind="user"], [data-chat-flow-kind="steering"]'
  const markdown = [...document.querySelectorAll('.dshmb-md')]
  const rows = [...document.querySelectorAll(SEAT + ' .dshmb-row')]
  const bubble = document.querySelector(SEAT + ' .dshmb-md')
  return {
    marker: window.__DSH_MARKDOWN_BUBBLE__ ?? null,
    userRows: document.querySelectorAll('[data-chat-flow-kind="user"]').length,
    seatRows: rows.length,
    markdownInsideSeats: rows.filter((row) => row.querySelector('.dshmb-md') !== null).length,
    markdownOutsideSeats: markdown.filter((el) => el.closest(SEAT) === null).length,
    renderedParagraphs: [...document.querySelectorAll(SEAT + ' .dshmb-md p')].length,
    actionStrips: [...document.querySelectorAll(SEAT + ' [class*="_actions"]')].length,
    copyButtons: [...document.querySelectorAll(SEAT + ' [class*="_actions"] button[aria-label]')].length,
    actionButtons: [...document.querySelectorAll(SEAT + ' [class*="_action"]')].length,
    // Sibling plugins pick the bar with querySelector — first match in document
    // order. It must be the message strip, never a code-card toolbar.
    firstStripIsMessageBar: rows.filter((row) => {
      const strip = row.querySelector('[class*="_actions"]')
      return strip !== null && strip.className.includes('dshmb_actions')
    }).length,
    markdownWhiteSpace: bubble === null ? null : getComputedStyle(bubble).whiteSpace,
    markdownVariant: bubble === null ? null : bubble.getAttribute('style'),
  }
})()`

// --- run ---------------------------------------------------------------------

console.log(`1. attach to the DSH page on ${CDP_URL}`)
const wire = await attach()
console.log(`  · target: ${wire.page.title} — ${wire.page.url}`)

const errors = []
wire.on((message) => {
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    const text = (message.params.args ?? []).map((arg) => arg.value ?? arg.description ?? '').join(' ')
    if (text.includes(PLUGIN_ID)) errors.push(text)
  }
  if (message.method === 'Runtime.exceptionThrown') {
    const text = message.params.exceptionDetails?.text ?? ''
    if (text.includes(PLUGIN_ID)) errors.push(text)
  }
})
await wire.send('Runtime.enable', {})

if (RELOAD) {
  console.log('\n2. reload the page (cache-busted) and wait for the app')
  await wire.send('Page.enable', {})
  await wire.send('Page.reload', { ignoreCache: true })
  const mounted = await waitFor(wire, `window.__DSH_MARKDOWN_BUBBLE__ !== undefined`, 30_000)
  if (!mounted) {
    check('the plugin mounted after reload', false, 'the presence marker never appeared')
    wire.close()
    process.exit(1)
  }
  await waitFor(wire, `document.querySelectorAll('.dshmb-row').length > 0`, 30_000)
  await sleep(500)
} else {
  console.log('\n2. no reload requested; checking the live page as-is')
}

console.log('\n3. the plugin is mounted and shadowing the seats')
const probe = await evaluate(wire, PROBE)
check('window.__DSH_MARKDOWN_BUBBLE__ exists', probe.marker !== null)
if (probe.marker !== null) {
  check('the marker reports the current version', probe.marker.version === PLUGIN_VERSION, String(probe.marker.version))
  check('the marker lists both seats', Array.isArray(probe.marker.seats) && probe.marker.seats.length === 2, JSON.stringify(probe.marker.seats))
}

console.log('\n4. sent bubbles render markdown')
check('the page renders user message rows', probe.userRows > 0, `${probe.userRows} row(s)`)
check('every sent-message row is the plugin seat', probe.seatRows > 0 && probe.seatRows === probe.userRows, `${probe.seatRows}/${probe.userRows}`)
check('every seat row carries a markdown container', probe.seatRows > 0 && probe.markdownInsideSeats === probe.seatRows, `${probe.markdownInsideSeats}/${probe.seatRows}`)
check('the markdown rendered a block (paragraph) inside a bubble', probe.renderedParagraphs > 0, `${probe.renderedParagraphs} paragraph(s)`)
check('the markdown container restores normal white-space', probe.markdownWhiteSpace === 'normal', String(probe.markdownWhiteSpace))

console.log('\n5. the host action strip contract survives (sibling plugin anchors)')
check('every seat row has an action strip matching the `_actions` suffix', probe.actionStrips >= probe.seatRows, `${probe.actionStrips} strip(s)`)
check('the copy action matches the `_action` suffix', probe.actionButtons >= probe.seatRows, `${probe.actionButtons} button(s)`)
check('the copy button is wired to its text', probe.copyButtons >= probe.seatRows, `${probe.copyButtons} labelled button(s)`)
check(
  'the first `_actions` match in every row is the message bar (not a code-card toolbar)',
  probe.firstStripIsMessageBar >= probe.seatRows,
  `${probe.firstStripIsMessageBar}/${probe.seatRows}`,
)

console.log('\n6. nothing outside a sent-message seat was converted')
check('no queue preview / goal row carries a markdown container', probe.markdownOutsideSeats === 0, `${probe.markdownOutsideSeats} stray container(s)`)

console.log('\n7. no plugin-attributed console errors during this session')
check('no console error mentions the plugin', errors.length === 0, errors.join(' | '))

wire.close()
if (failures > 0) {
  console.log(`\n${failures} check(s) failed.`)
  process.exit(1)
}
console.log('\nAll checks passed: sent bubbles render as markdown.')
