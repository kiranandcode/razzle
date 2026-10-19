// razzle: command-line front end for the Razzle server.
//
//   razzle serve                  run the server in the foreground
//   razzle director [--dry]       run the live agent (foreground; meant for its own termling)
//   razzle open <deck> [--no-cove] start the server if needed, open the editor in Vibefox on the Cove board
//   razzle present <deck> [N]     launch the presenter (or browser windows) at slide N
//   razzle decks                  list decks
//   razzle deck get <id>          print a deck's JSON
//   razzle deck put <id> < f.json write a deck from stdin
//   razzle slide add <id> [--hidden] < slide.json   append a slide (PPTist-style JSON, library refs allowed)
//   razzle record <deck>          start record mode (mic -> takes)
//   razzle stop                   back to idle (closes the take)
//   razzle notes <deck>           write speaker notes + per-step script from the takes
//   razzle nav next|prev|goto N [step]
//   razzle state                  print the presentation state

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.RAZZLE_PORT ?? 7878)
const BASE = `http://127.0.0.1:${PORT}`
const PUBLIC = `http://localhost:${PORT}`

function die(msg: string): never { console.error(`razzle: ${msg}`); process.exit(1) }

async function call(method: string, p: string, body?: unknown): Promise<any> {
  let r: Response
  try {
    r = await fetch(BASE + p, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  } catch { die(`no server at ${BASE} (run \`razzle serve\`)`) }
  const text = await r.text()
  let j: any
  try { j = JSON.parse(text) } catch { j = text }
  if (!r.ok) die(`${method} ${p}: ${j?.error ?? r.status}`)
  return j
}

// One request/response on Vibefox's line-based control socket (protocol: vibefox/cove-bridge/vibefox_mcp.py).
function vibefox(cmd: string, args: Record<string, unknown>): Promise<any> {
  const sock = process.env.VIBEFOX_SOCKET ?? '/tmp/vibefox/control.sock'
  const pane = Number(process.env.KITTY_WINDOW_ID)
  const who = process.env.COVE_SESSION || process.env.KITTY_WINDOW_ID
    ? { session: process.env.COVE_SESSION ?? '', pane: Number.isInteger(pane) ? pane : null, cwd: process.cwd() }
    : null
  return new Promise((resolve, reject) => {
    const s = net.createConnection(sock)
    let buf = ''
    s.setTimeout(15000, () => { s.destroy(); reject(new Error('timeout')) })
    s.on('error', reject)
    s.on('connect', () => s.write(JSON.stringify({ id: 1, cmd, args, who, pid: process.pid }) + '\n'))
    s.on('data', d => {
      buf += d
      const nl = buf.indexOf('\n')
      if (nl < 0) return
      s.end()
      try {
        const rep = JSON.parse(buf.slice(0, nl))
        if (rep.ok) resolve(rep.result)
        else reject(new Error(rep.error ?? 'error'))
      } catch (e) { reject(e) }
    })
  })
}

async function up(): Promise<boolean> {
  try { return (await fetch(`${BASE}/api/state`)).ok } catch { return false }
}

async function ensureServer() {
  if (await up()) return
  const logDir = path.join(HERE, '.tmp')
  fs.mkdirSync(logDir, { recursive: true })
  const out = fs.openSync(path.join(logDir, 'server.log'), 'a')
  const child = spawn(process.execPath, [path.join(HERE, 'server.ts')], { detached: true, stdio: ['ignore', out, out], env: process.env })
  child.unref()
  for (let i = 0; i < 100; i++) {
    await new Promise(r => setTimeout(r, 100))
    if (await up()) { console.error(`razzle: server started (pid ${child.pid}, log server/.tmp/server.log)`); return }
  }
  die('server did not start; see server/.tmp/server.log')
}

async function stdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const c of process.stdin) chunks.push(c as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

const print = (x: unknown) => console.log(typeof x === 'string' ? x : JSON.stringify(x, null, 2))

async function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  switch (cmd) {
    case 'serve':
      await import('./server.ts')
      return
    case 'director':
      process.argv = [process.argv[0], path.join(HERE, 'director.ts'), ...rest]
      await import('./director.ts')
      return
    case 'open': {
      const id = rest[0] ?? die('usage: razzle open <deckId>')
      await ensureServer()
      const url = `${PUBLIC}/#/?deck=${encodeURIComponent(id)}`
      if (rest.includes('--no-cove')) {
        spawn('open', ['-a', 'Vibefox', url], { stdio: 'ignore', detached: true }).unref()
        print(url)
        return
      }
      // Open the tab in Vibefox and walk it onto the Cove board as a page critter,
      // placed next to the termling that ran us.
      try {
        const tab = await vibefox('tabs_open', { url, background: true })
        const tabId = tab?.id ?? tab?.tab ?? tab?.tabId
        await vibefox('critter_add', tabId === undefined ? {} : { tab: tabId })
        print(`${url} (on the Cove board)`)
      } catch (e) {
        console.error(`razzle: Vibefox/Cove unavailable (${(e as Error).message}); opening normally`)
        spawn('open', ['-a', 'Vibefox', url], { stdio: 'ignore', detached: true }).unref()
        print(url)
      }
      return
    }
    case 'present': {
      const id = rest[0] ?? die('usage: razzle present <deckId> [slide]')
      await ensureServer()
      const r = await call('POST', '/api/present', { deckId: id, slide: rest[1] !== undefined ? Number(rest[1]) : undefined })
      print(`presenting ${id} (${r.launched})`)
      return
    }
    case 'decks': {
      const ds = await call('GET', '/api/decks')
      for (const d of ds) console.log(`${d.id.padEnd(28)} ${String(d.slideCount).padStart(3)} slides  ${new Date(d.updatedAt).toISOString().slice(0, 16).replace('T', ' ')}  ${d.title}`)
      return
    }
    case 'deck': {
      const [sub, id] = rest
      if (!id) die('usage: razzle deck get|put <id>')
      if (sub === 'get') return print(await call('GET', `/api/decks/${encodeURIComponent(id)}`))
      if (sub === 'put') {
        const raw = await stdin()
        let deck: any
        try { deck = JSON.parse(raw) } catch (e) { die(`stdin is not JSON: ${(e as Error).message}`) }
        const r = await call('PUT', `/api/decks/${encodeURIComponent(id)}`, deck)
        return print(`saved ${id} (${deck.slides?.length ?? 0} slides, updatedAt ${r.updatedAt})`)
      }
      return die('usage: razzle deck get|put <id>')
    }
    case 'slide': {
      // razzle slide add <deck> [--hidden] < slide.json
      const [verb, id] = rest
      if (verb !== 'add' || !id) die('usage: razzle slide add <deckId> [--hidden] < slide.json')
      await ensureServer()
      const slide = JSON.parse(fs.readFileSync(0, 'utf8'))
      const r = await call('POST', `/api/decks/${encodeURIComponent(id)}/slides`, { slide, hidden: rest.includes('--hidden') })
      print(`added slide ${r.slideIndex + 1}${r.frameId ? ` (${r.frameId})` : ''}${r.warnings?.length ? `; ${r.warnings.join('; ')}` : ''}`)
      return
    }
    case 'record': {
      const id = rest[0] ?? die('usage: razzle record <deckId>')
      await ensureServer()
      const r = await call('POST', '/api/mode', { mode: 'record', deckId: id })
      return print(`recording ${id}: take ${r.state.takeId} (razzle stop to finish)`)
    }
    case 'stop': {
      const r = await call('POST', '/api/mode', { mode: 'idle' })
      return print(`idle (deck ${r.state.deckId ?? '-'})`)
    }
    case 'notes': {
      const id = rest[0] ?? die('usage: razzle notes <deckId>')
      console.error('razzle: writing notes (Claude)…')
      const d = await call('POST', `/api/decks/${encodeURIComponent(id)}/notes`)
      for (const [i, s] of d.slides.entries()) {
        const script: string[] = s.razzle?.script ?? []
        if (!script.some(Boolean)) continue
        console.log(`— slide ${i}`)
        script.forEach((l, k) => l && console.log(`  [${k}] ${l}`))
      }
      return
    }
    case 'nav': {
      const [action, n, step] = rest
      if (!['next', 'prev', 'goto'].includes(action)) die('usage: razzle nav next|prev|goto N [step]')
      if (action === 'goto' && n === undefined) die('usage: razzle nav goto N [step]')
      const r = await call('POST', '/api/nav', { action, slide: n !== undefined ? Number(n) : undefined, step: step !== undefined ? Number(step) : undefined, source: 'human' })
      return print(r.accepted ? `slide ${r.state.slideIndex} step ${r.state.step}` : `not moved: ${r.reason}`)
    }
    case 'state':
      return print(await call('GET', '/api/state'))
    default:
      console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter(l => l.startsWith('//')).slice(2).map(l => l.slice(3)).join('\n'))
      if (cmd && cmd !== 'help' && cmd !== '--help') process.exit(1)
  }
}

main()
