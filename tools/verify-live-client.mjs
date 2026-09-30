// Verify the browser half of a RUNNING DSH instance.
//
// The unit tests prove the source is sound; this proves the bytes the browser
// will actually download carry this plugin. It answers the question a
// screenshot answers badly: is my plugin in the client module graph, and is
// the code being served the current code?
//
// How it works: an authenticated boot page carries one `<link rel="preload">`
// per client module group, and the group URL lists every member, e.g.
//   /plugins/??dsh-edit-turn/client.js,dsh-markdown-bubble/client.js&rev=<hash>
// The rev is a content hash, so a changed file changes the URL the browser
// fetches. Fetching that URL and asserting the plugin's own markers are
// present is a direct check on the served artifact.
//
// Auth is the token DSH prints on boot: `GET /?token=<t>` answers 303 with an
// auth cookie, which the follow-up request needs.
//
//   node tools/verify-live-client.mjs --token <token>
//   node tools/verify-live-client.mjs --token-file ~/.dsh/logs/web-restart-*.log
//   DSH_URL=http://127.0.0.1:3080 node tools/verify-live-client.mjs --token <t>
//
// Read-only: it never writes to the instance it inspects.
import { readFileSync } from 'node:fs'
import { PLUGIN_ID, PLUGIN_VERSION } from '../src/index.js'

// Markers that must appear in the served bundle, each tied to something real:
// the module id, the two shadowed seats, the host projection the composition
// calls, the action-strip suffixes sibling plugins search for, and the
// presence marker the live UI verifier reads.
const MARKERS = [
  { needle: PLUGIN_ID, what: 'the module id' },
  { needle: PLUGIN_VERSION, what: 'the client version constant' },
  { needle: "['user', 'steering']", what: 'the shadowed seats' },
  { needle: 'conversation.chat.node', what: 'the keyed seat slot' },
  { needle: 'projectUserText', what: 'the host projection the composition calls' },
  { needle: 'preserveHardBreaks', what: 'the soft-break promotion pass' },
  { needle: 'dshmb-md', what: 'the markdown container class' },
  { needle: 'dshmb_actions', what: 'the action strip sibling plugins inject into' },
  { needle: '__DSH_MARKDOWN_BUBBLE__', what: 'the presence marker the UI verifier reads' },
]

function arg(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

let failures = 0
function check(label, condition, detail) {
  if (condition) console.log(`  ✓ ${label}`)
  else {
    failures += 1
    console.log(`  ✗ ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

const base = (process.env.DSH_URL || 'http://127.0.0.1:3080').replace(/\/$/, '')
let token = arg('token')
const tokenFile = arg('token-file')
if (token === undefined && tokenFile !== undefined) {
  // DSH prints one URL per launch and appends to the log, so the LAST one is
  // the live token.
  const matches = [...readFileSync(tokenFile, 'utf8').matchAll(/[?&]token=([A-Za-z0-9_-]+)/g)]
  token = matches.length > 0 ? matches[matches.length - 1][1] : undefined
}
if (token === undefined) {
  console.error('usage: node tools/verify-live-client.mjs --token <token> | --token-file <log>')
  process.exit(2)
}

console.log(`1. authenticate against ${base}`)
const handshake = await fetch(`${base}/?token=${encodeURIComponent(token)}`, { redirect: 'manual' })
check('the token is accepted', handshake.status === 303 || handshake.status === 200, `HTTP ${handshake.status}`)
const cookie = (handshake.headers.getSetCookie?.() ?? []).map((value) => value.split(';')[0]).join('; ')
check('an auth cookie was issued', cookie !== '')
const withCookie = cookie === '' ? {} : { cookie }

const page = await fetch(`${base}/`, { headers: withCookie })
const html = (await page.text()).replace(/&amp;/g, '&')
check('the boot page was served', page.status === 200 && html.length > 1000, `HTTP ${page.status}, ${html.length} bytes`)

console.log('\n2. find this plugin in the client module graph')
const groups = [...new Set([...html.matchAll(/href="((?:\/|\.{1,2}\/)?plugins\/[^"]+)"/g)].map((match) => match[1]))].map(
  (href) => `/${href.replace(/^(\.\/|\/)+/, '')}`,
)
check('the boot page lists client module groups', groups.length > 0, `${groups.length} groups`)
const group = groups.find((href) => href.includes(`${PLUGIN_ID}/client.js`))
check(
  `"${PLUGIN_ID}/client.js" is in the module graph`,
  group !== undefined,
  group === undefined ? 'the plugin is not part of this instance' : undefined,
)
if (group === undefined) {
  console.log(`\n${failures} check(s) failed.`)
  process.exit(1)
}
const rev = /[?&]rev=([0-9a-f]+)/.exec(group)?.[1]
console.log(`  · group rev ${rev ?? '(none)'} with ${group.split(',').length} member(s)`)

console.log('\n3. download the served bundle and assert its contents')
const bundle = await fetch(`${base}${group}`, { headers: withCookie })
const code = await bundle.text()
check('the bundle was served', bundle.status === 200 && code.includes(PLUGIN_ID), `HTTP ${bundle.status}, ${code.length} bytes`)

// The group is the concatenation of many plugins, so markers must be checked
// in this plugin's own module; anchoring on the module registration and
// cutting at the next one is exact.
const idAt = code.lastIndexOf(`id: '${PLUGIN_ID}'`)
check(`the module registers under "${PLUGIN_ID}"`, idAt !== -1)
const loadAt = idAt === -1 ? -1 : code.lastIndexOf('__ModuleLoader__.load(', idAt)
const nextLoad = idAt === -1 ? -1 : code.indexOf('__ModuleLoader__.load(', idAt)
const slice = loadAt === -1 || nextLoad === -1 ? code : code.slice(loadAt, nextLoad)
for (const marker of MARKERS) {
  check(`the served bundle carries ${marker.what}`, slice.includes(marker.needle))
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed.`)
  process.exit(1)
}
console.log('\nAll checks passed: the running instance serves this plugin\'s current browser half.')
