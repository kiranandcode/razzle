// Director run against a real server and real models (needs ANTHROPIC_API_KEY; costs a few calls).
//   node test/director.ts
// Checks: the script for slide 0 is covered -> agent advance; "look at this box, the scheduler"
// -> highlight of the scheduler element; the orb gets status updates; a speaker `request`
// -> a valid hidden slide is inserted after the current slide and `hidden-ready` is broadcast.

import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { validateSlide } from '../slides.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TMP = path.join(HERE, '..', '.tmp', 'director')
const PORT = 7980
const BASE = `http://127.0.0.1:${PORT}`
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
let failures = 0
const check = (ok: boolean, what: string) => { console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}`); if (!ok) failures++ }

const SENTENCES = [
  'So the reason a boat floats is that the water pushes up on the hull with buoyancy.',
  'Now look at this box here, the scheduler. It decides which thread runs next on the kernel.',
  'And that is the whole story of the scheduler.',
]

function makeAudio(): string {
  fs.mkdirSync(TMP, { recursive: true })
  const parts = SENTENCES.map((s, i) => {
    const aiff = path.join(TMP, `s${i}.aiff`), wav = path.join(TMP, `s${i}.wav`)
    execFileSync('say', ['-o', aiff, s])
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', aiff, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav])
    return wav
  })
  const sil = path.join(TMP, 'sil.wav')
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', '3', '-c:a', 'pcm_s16le', sil])
  const list = path.join(TMP, 'list.txt')
  fs.writeFileSync(list, [sil, parts[0], sil, parts[1], sil, parts[2], sil].map(p => `file '${p}'`).join('\n'))
  const file = path.join(TMP, 'talk.wav')
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c:a', 'pcm_s16le', file])
  return file
}

const text = (id: string, left: number, top: number, w: number, h: number, html: string) =>
  ({ id, type: 'text', left, top, width: w, height: h, rotate: 0, content: html, defaultFontName: 'Inter', defaultColor: '#222' })
const box = (id: string, left: number, label: string) => ({
  id, type: 'shape', left, top: 200, width: 220, height: 120, rotate: 0, viewBox: [200, 200], path: 'M 0 0 L 200 0 L 200 200 L 0 200 Z',
  fixedRatio: false, fill: '#eef', outline: { style: 'solid', width: 2, color: '#334' },
  text: { content: `<p style="text-align:center">${label}</p>`, defaultFontName: 'Inter', defaultColor: '#222', align: 'middle' },
})
const deck = {
  id: 'dir', title: 'Director test', width: 1000, height: 562.5,
  theme: { backgroundColor: '#fff', themeColors: ['#335'], fontColor: '#222', fontName: 'Inter', outline: {}, shadow: { h: 0, v: 0, blur: 0, color: '#000' } },
  slides: [
    { id: 'b0', elements: [text('t0', 60, 40, 880, 80, '<p><strong>Why boats float</strong></p>')], razzle: { script: ['boat floats: water pushes up on the hull, buoyancy'] } },
    { id: 'b1', elements: [text('t1', 60, 40, 880, 80, '<p><strong>Inside the kernel</strong></p>'), box('k1', 100, 'Interrupts'), box('k2', 390, 'Scheduler'), box('k3', 680, 'Memory')] },
    { id: 'b2', elements: [text('t2', 60, 40, 880, 80, '<p>Thanks</p>')] },
  ],
}

async function main() {
  const file = makeAudio()
  const decks = path.join(TMP, 'decks')
  fs.rmSync(decks, { recursive: true, force: true })
  const env = { ...process.env, RAZZLE_PORT: String(PORT), RAZZLE_DECKS_DIR: decks, RAZZLE_AUDIO_FILE: file, RAZZLE_NO_LAUNCH: '1', RAZZLE_WHISPER_FAST_PORT: '8741', RAZZLE_WHISPER_FINAL_PORT: '8742' }
  const server: ChildProcess = spawn(process.execPath, [path.join(HERE, '..', 'server.ts')], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  const slog: string[] = []
  server.stdout!.on('data', d => slog.push(d.toString()))
  server.stderr!.on('data', d => slog.push(d.toString()))
  let director: ChildProcess | null = null
  const dlog: string[] = []
  try {
    for (let i = 0; i < 50; i++) { try { await fetch(`${BASE}/api/state`); break } catch { await sleep(100) } }
    await fetch(`${BASE}/api/decks/dir`, { method: 'PUT', body: JSON.stringify(deck) })
    director = spawn(process.execPath, [path.join(HERE, '..', 'director.ts')], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    director.stdout!.on('data', d => { process.stdout.write('    director| ' + d.toString().trimEnd().replace(/\n/g, '\n    director| ') + '\n'); dlog.push(d.toString()) })
    director.stderr!.on('data', d => dlog.push(d.toString()))
    const seen: { at: number, msg: any }[] = []
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`)
    await new Promise(r => ws.once('open', r))
    ws.on('message', d => seen.push({ at: Date.now(), msg: JSON.parse(d.toString()) }))
    ws.send(JSON.stringify({ t: 'hello', role: 'speaker', deckId: 'dir' }))
    await sleep(800)
    await fetch(`${BASE}/api/mode`, { method: 'POST', body: JSON.stringify({ mode: 'present', deckId: 'dir', auto: true }) })
    const waitFor = async (pred: (m: any) => boolean, ms: number) => {
      const t = Date.now()
      while (Date.now() - t < ms) { const h = seen.find(s => pred(s.msg)); if (h) return h; await sleep(50) }
      return null
    }
    const adv = await waitFor(m => m.t === 'state' && m.state.slideIndex === 1 && m.state.lastNav?.source === 'agent', 60000)
    check(Boolean(adv), 'director advanced slide 0 -> 1 when its script was covered')
    const hl = await waitFor(m => m.t === 'highlight', 30000)
    check(hl?.msg.elId === 'k2', `highlight of the scheduler box (got ${hl?.msg.elId})`)
    const statuses = [...new Set(seen.filter(s => s.msg.t === 'agent').map(s => s.msg.status))]
    check(statuses.includes('listening') && statuses.includes('acting'), `orb statuses seen: ${statuses.join(', ')}`)

    ws.send(JSON.stringify({ t: 'request', kind: 'hidden-slide', prompt: 'A diagram of how the scheduler picks the next thread from the run queue' }))
    const t0 = Date.now()
    const ready = await waitFor(m => m.t === 'hidden-ready', 180000)
    check(Boolean(ready), `hidden-ready broadcast after ${((Date.now() - t0) / 1000).toFixed(1)} s`)
    const d = await (await fetch(`${BASE}/api/decks/dir`)).json()
    const hs = d.slides[ready?.msg.slideIndex ?? -1]
    check(Boolean(hs?.razzle?.hidden) && ready?.msg.slideIndex === 2, `hidden slide inserted directly after slide 1 (index ${ready?.msg.slideIndex})`)
    check(hs && validateSlide(hs).length === 0, `inserted slide validates (${hs ? validateSlide(hs).join('; ') || 'no problems' : 'missing'}), ${hs?.elements?.length} elements`)
    fs.writeFileSync(path.join(TMP, 'hidden-slide.json'), JSON.stringify(hs, null, 2))
    const st = await (await fetch(`${BASE}/api/state`)).json()
    check(st.slideIndex === 1, 'the main flow was not interrupted (still on slide 1)')
    ws.close()
  } finally {
    director?.kill('SIGTERM')
    server.kill('SIGTERM')
    await new Promise(r => server.once('exit', r))
    if (failures) console.log('--- server ---\n' + slog.join(''))
  }
  console.log(failures ? `${failures} check(s) failed` : 'all checks passed')
  process.exit(failures ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
