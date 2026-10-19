// End-to-end: real server, real ffmpeg + whisper-servers, speech generated with `say`.
//   node test/e2e.ts
// Present run: partial + final transcripts arrive, the spoken cue "sinks" advances the
// slide, a human `next` 500 ms later is dropped, a human `prev` is not.
// Record run: a take file holds utterances tagged with the slide showing when each began.

import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { convertDeck } from '../../shared/tl/convert.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TMP = path.join(HERE, '..', '.tmp', 'e2e')
const PORT = 7979
const BASE = `http://127.0.0.1:${PORT}`

const SENTENCES = [
  'Welcome everyone. Today I will show you how the little boat takes on water, and then it sinks.',
  'On this second slide we look at the results in a bit more detail.',
  'And that is everything I wanted to say about boats today.',
]

let failures = 0
function check(ok: boolean, what: string) {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}`)
  if (!ok) failures++
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function sh(cmd: string, args: string[]) { execFileSync(cmd, args, { stdio: 'ignore' }) }

/** Speech wavs: one per sentence plus 1.5 s of silence between them. Returns the
 *  time (ms from the start of the file) at which the first sentence's speech ends. */
function makeAudio(): { file: string, cueEndMs: number } {
  fs.mkdirSync(TMP, { recursive: true })
  const parts: string[] = []
  SENTENCES.forEach((s, i) => {
    const aiff = path.join(TMP, `s${i}.aiff`), wav = path.join(TMP, `s${i}.wav`)
    sh('say', ['-o', aiff, s])
    sh('ffmpeg', ['-y', '-loglevel', 'error', '-i', aiff, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav])
    parts.push(wav)
  })
  const sil = path.join(TMP, 'sil.wav')
  sh('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', '1.5', '-c:a', 'pcm_s16le', sil])
  const list = path.join(TMP, 'list.txt')
  fs.writeFileSync(list, [sil, parts[0], sil, parts[1], sil, parts[2], sil].map(p => `file '${p}'`).join('\n'))
  const file = path.join(TMP, 'talk.wav')
  sh('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c:a', 'pcm_s16le', file])
  // end of speech in sentence 0: last sample above -40 dBFS
  const buf = fs.readFileSync(parts[0])
  const data = buf.subarray(44)
  let last = 0
  for (let i = 0; i + 1 < data.length; i += 2) if (Math.abs(data.readInt16LE(i)) > 330) last = i / 2
  return { file, cueEndMs: 1500 + (last / 16000) * 1000 }
}

// PPTist slides converted to a Razzle v2 deck (frame ids are `shape:<slide id>`)
const deck = (id: string, cue: boolean) => convertDeck({
  id, title: `E2E ${id}`, width: 1000, height: 562.5,
  theme: { backgroundColor: '#fff', themeColors: ['#000'], fontColor: '#000', fontName: 'Inter', outline: {}, shadow: { h: 0, v: 0, blur: 0, color: '#000' } },
  slides: [0, 1, 2].map(i => ({
    id: `${id}-s${i}`,
    elements: [{ id: `${id}-t${i}`, type: 'text', left: 60, top: 60, width: 800, height: 80, rotate: 0, content: `<p>Slide ${i}</p>`, defaultFontName: 'Inter', defaultColor: '#000' }],
    ...(i === 0 && cue ? { razzle: { cues: [{ id: 'cue-sinks', phrase: 'sinks', action: 'next' }] } } : {}),
  })),
})
const sid = (id: string) => `shape:${id}`

async function api(method: string, p: string, body?: unknown): Promise<any> {
  const r = await fetch(BASE + p, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  return r.json()
}

interface Seen { at: number, msg: any }

async function main() {
  const { file, cueEndMs } = makeAudio()
  const decks = path.join(TMP, 'decks')
  fs.rmSync(decks, { recursive: true, force: true })
  console.log(`audio: ${file} (cue word ends at ${(cueEndMs / 1000).toFixed(2)} s)`)

  const server: ChildProcess = spawn(process.execPath, [path.join(HERE, '..', 'server.ts')], {
    env: { ...process.env, RAZZLE_PORT: String(PORT), RAZZLE_DECKS_DIR: decks, RAZZLE_AUDIO_FILE: file, RAZZLE_NO_LAUNCH: '1',
      RAZZLE_WHISPER_FAST_PORT: '8731', RAZZLE_WHISPER_FINAL_PORT: '8732' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const serverLog: string[] = []
  server.stdout!.on('data', d => serverLog.push(...d.toString().trimEnd().split('\n')))
  server.stderr!.on('data', d => serverLog.push(...d.toString().trimEnd().split('\n')))

  try {
    for (let i = 0; i < 50; i++) { try { await api('GET', '/api/state'); break } catch { await sleep(100) } }
    await api('PUT', '/api/decks/e2e', deck('e2e', true))
    await api('PUT', '/api/decks/e2e-rec', deck('e2e-rec', false))

    // ---------- present ----------
    console.log('present run')
    const seen: Seen[] = []
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`)
    await new Promise(r => ws.once('open', r))
    ws.on('message', d => seen.push({ at: Date.now(), msg: JSON.parse(d.toString()) }))
    ws.send(JSON.stringify({ t: 'hello', role: 'audience', deckId: 'e2e' }))
    await api('POST', '/api/mode', { mode: 'present', deckId: 'e2e', auto: false })

    const waitFor = async (pred: (s: Seen) => boolean, ms: number) => {
      const t = Date.now()
      while (Date.now() - t < ms) { const hit = seen.find(pred); if (hit) return hit; await sleep(20) }
      return null
    }
    const advanced = await waitFor(s => s.msg.t === 'state' && s.msg.state.slideIndex === 1, 90000)
    check(Boolean(advanced), 'cue "sinks" advanced to slide 1')
    check(advanced?.msg.state.lastNav?.source === 'cue', `advance came from the cue (lastNav.source = ${advanced?.msg.state.lastNav?.source})`)
    const dbg = await api('GET', `/api/debug?arrival=${cueEndMs}`)
    const cueHeardAt: number = dbg.arrival ?? (dbg.audioStartedAt + cueEndMs)
    if (advanced) console.log(`  latency: end of the word "sinks" reaching the server -> state change = ${advanced.at - cueHeardAt} ms`)
    // the human presses next for the same transition, 500 ms after the cue's advance
    await sleep(Math.max(0, (advanced?.at ?? Date.now()) + 500 - Date.now()))
    ws.send(JSON.stringify({ t: 'nav', action: 'next', source: 'human' }))
    await sleep(400)
    let st = await api('GET', '/api/state')
    check(st.slideIndex === 1, `human next 500 ms after the cue was dropped (slide ${st.slideIndex})`)
    ws.send(JSON.stringify({ t: 'nav', action: 'prev', source: 'human' }))
    await sleep(300)
    st = await api('GET', '/api/state')
    check(st.slideIndex === 0 && st.lastNav?.source === 'human', `human prev was accepted (slide ${st.slideIndex})`)

    const partials = seen.filter(s => s.msg.t === 'transcript' && s.msg.partial)
    const firstFinal = await waitFor(s => s.msg.t === 'transcript' && s.msg.final, 20000)
    check(partials.length > 0, `partial transcripts arrived (${partials.length}), e.g. "${partials[0]?.msg.partial ?? ''}"`)
    check(Boolean(firstFinal), `final transcript arrived: "${firstFinal?.msg.final?.text ?? ''}"`)
    check(firstFinal?.msg.final?.slideId === sid('e2e-s0') && firstFinal?.msg.final?.slideIndex === 0, 'first final is tagged with slide 0')
    const sinksFinal = await waitFor(s => s.msg.t === 'transcript' && /sinks/i.test(s.msg.final?.text ?? ''), 20000)
    if (sinksFinal) console.log(`  final latency: end of that sentence -> its final transcript = ${sinksFinal.at - cueHeardAt} ms`)
    const firstPartial = partials[0]
    if (firstPartial) console.log(`  first partial at ${((firstPartial.at - dbg.audioStartedAt) / 1000).toFixed(2)} s into the audio (speech starts at 1.50 s)`)

    // let the file finish, then go idle
    for (let i = 0; i < 300; i++) { if (!(await api('GET', '/api/debug')).audioRunning) break; await sleep(100) }
    await api('POST', '/api/mode', { mode: 'idle' })
    ws.close()

    // ---------- record ----------
    console.log('record run')
    const seen2: Seen[] = []
    const ws2 = new WebSocket(`ws://127.0.0.1:${PORT}/ws`)
    await new Promise(r => ws2.once('open', r))
    ws2.on('message', d => seen2.push({ at: Date.now(), msg: JSON.parse(d.toString()) }))
    ws2.send(JSON.stringify({ t: 'hello', role: 'speaker', deckId: 'e2e-rec' }))
    const r = await api('POST', '/api/mode', { mode: 'record', deckId: 'e2e-rec' })
    const takeId = r.state?.takeId
    check(Boolean(takeId), `record mode opened take ${takeId}`)
    // move to slide 1 once the first sentence has finished (the speaker clicks while pausing)
    const t0 = Date.now()
    while (Date.now() - t0 < 60000) {
      const d = await api('GET', '/api/debug')
      if (d.audioStartedAt && Date.now() > d.audioStartedAt + cueEndMs + 300) break
      await sleep(50)
    }
    ws2.send(JSON.stringify({ t: 'nav', action: 'next', source: 'human' }))
    for (let i = 0; i < 300; i++) { if (!(await api('GET', '/api/debug')).audioRunning) break; await sleep(100) }
    await api('POST', '/api/mode', { mode: 'idle' })
    const takeFile = path.join(decks, 'e2e-rec', 'takes', `${takeId}.json`)
    let take: any = null
    for (let i = 0; i < 100; i++) {
      try { take = JSON.parse(fs.readFileSync(takeFile, 'utf8')); if (take.endedAt) break } catch { /* not yet */ }
      await sleep(100)
    }
    check(Boolean(take?.endedAt), `take file written and closed: ${path.relative(process.cwd(), takeFile)}`)
    const us = take?.utterances ?? []
    for (const u of us) console.log(`    [slide ${u.slideIndex} ${u.slideId} step ${u.step}] ${u.text}`)
    check(us.length >= 3, `take holds ${us.length} utterances`)
    const first = us.filter((u: any) => /welcome|sinks/i.test(u.text)), rest = us.filter((u: any) => !/welcome|sinks/i.test(u.text))
    check(first.length > 0 && first.every((u: any) => u.slideId === sid('e2e-rec-s0') && u.slideIndex === 0), 'sentence 1 (before the click) tagged with slide 0')
    check(rest.length > 0 && rest.every((u: any) => u.slideId === sid('e2e-rec-s1') && u.slideIndex === 1), 'sentences 2-3 (after the click) tagged with slide 1')
    const takes = await api('GET', '/api/decks/e2e-rec/takes')
    check(Array.isArray(takes) && takes.some((t: any) => t.id === takeId), 'GET /api/decks/:id/takes lists the take')
    ws2.close()
  } finally {
    server.kill('SIGTERM')
    await new Promise(r => server.once('exit', r))
    await sleep(300)
    let leftover = ''
    try { leftover = execFileSync('pgrep', ['-fl', 'whisper-server.*873[12]|ffmpeg.*talk.wav']).toString().trim() } catch { /* none */ }
    check(!leftover, `no whisper-server/ffmpeg left behind${leftover ? ': ' + leftover : ''}`)
    if (failures || process.env.E2E_VERBOSE) console.log('--- server log ---\n' + serverLog.join('\n'))
  }
  console.log(failures ? `${failures} check(s) failed` : 'all checks passed')
  process.exit(failures ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
