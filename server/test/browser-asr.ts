// End-to-end for the browser mic (RAZZLE_AUDIO=browser): headless Chrome with a fake microphone
// playing speech made with `say`, the studio dev server, a server in browser mode and the director.
//
//   node test/browser-asr.ts [--device webgpu|wasm] [--keep]
//
// Needs Google Chrome, ffmpeg, `say`, and the model files in RAZZLE_MODELS_DIR (default
// <repo>/models; server/fetch-models.sh), else they come from the Hugging Face hub.
// Ports: BASR_PORT (server, 7811), BASR_VITE (5291), BASR_CDP (9811). BASR_STATIC=<dir>: test a
// studio build served by the server instead of the dev server.
//
// 1. The speaker view (presenting demo, slide 8 step 1) takes the mic by itself; partial, pause and
//    final transcripts reach the server; the cue "private" moves the slide to its next step.
// 2. The director runs (local coverage only, no model keys); on slide 2 with auto on, saying the
//    step's script makes the agent advance.
import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const TMP = path.join(HERE, '..', '.tmp', 'browser-asr')
const PORT = Number(process.env.BASR_PORT ?? 7811)
const VITE = Number(process.env.BASR_VITE ?? 5291)
const CDP = Number(process.env.BASR_CDP ?? 9811)
const BASE = `http://127.0.0.1:${PORT}`
const args = process.argv.slice(2)
const DEVICE = args.includes('--device') ? args[args.indexOf('--device') + 1] : 'webgpu'
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const MODELS = process.env.RAZZLE_MODELS_DIR ?? path.join(ROOT, 'models')
const STATIC = process.env.BASR_STATIC ? path.resolve(process.env.BASR_STATIC) : null
const STUDIO = STATIC ? BASE : `http://127.0.0.1:${VITE}`

const SENTENCES = [
  'A modern system is distributed, and it holds private data.', // cue "private" on slide 8, step 1
  'Our vision is a marketplace of autonomous agents, each acting for a person.', // slide 2, step 1's script
]

let failures = 0
function check(ok: boolean, what: string) {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}`)
  if (!ok) failures++
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const sh = (cmd: string, a: string[]) => execFileSync(cmd, a, { stdio: 'ignore' })

/** 48 kHz mono wav: 2 s silence, sentence 0, 4 s, sentence 1, 4 s. Chrome loops it. */
function makeAudio(): string {
  fs.mkdirSync(TMP, { recursive: true })
  const parts = SENTENCES.map((s, i) => {
    const aiff = path.join(TMP, `s${i}.aiff`), wav = path.join(TMP, `s${i}.wav`)
    sh('say', ['-o', aiff, s])
    sh('ffmpeg', ['-y', '-loglevel', 'error', '-i', aiff, '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', wav])
    return wav
  })
  const sil = (t: number) => {
    const f = path.join(TMP, `sil${t}.wav`)
    sh('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', String(t), '-c:a', 'pcm_s16le', f])
    return f
  }
  const list = path.join(TMP, 'list.txt')
  fs.writeFileSync(list, [sil(2), parts[0], sil(4), parts[1], sil(4)].map(p => `file '${p}'`).join('\n'))
  const out = path.join(TMP, 'talk.wav')
  sh('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c:a', 'pcm_s16le', out])
  return out
}

const procs: ChildProcess[] = []
function start(name: string, cmd: string, a: string[], opts: { cwd?: string, env?: NodeJS.ProcessEnv } = {}) {
  const p = spawn(cmd, a, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
  const logFile = fs.createWriteStream(path.join(TMP, `${name}.log`))
  p.stdout!.pipe(logFile); p.stderr!.pipe(logFile)
  procs.push(p)
  return p
}
function stopAll() {
  for (const p of procs) {
    try { if (p.pid && p.exitCode === null) process.kill(-p.pid, 'SIGTERM') } catch { /* gone */ }
  }
}
process.on('exit', stopAll)
process.on('SIGINT', () => { stopAll(); process.exit(130) })

async function api(method: string, p: string, body?: unknown): Promise<any> {
  const r = await fetch(BASE + p, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  return r.json()
}
async function waitHttp(url: string, ms: number) {
  const t = Date.now()
  while (Date.now() - t < ms) { try { if ((await fetch(url)).status < 500) return } catch { /* not up */ } await sleep(200) }
  throw new Error(`${url} did not come up`)
}

// ---------- a minimal CDP client

class Cdp {
  ws: WebSocket
  id = 0
  waiting = new Map<number, (r: any) => void>()
  events: ((m: any) => void)[] = []
  constructor(ws: WebSocket) {
    this.ws = ws
    ws.on('message', d => {
      const m = JSON.parse(d.toString())
      if (m.id && this.waiting.has(m.id)) { this.waiting.get(m.id)!(m); this.waiting.delete(m.id) } else this.events.forEach(f => f(m))
    })
  }
  call(method: string, params: any = {}, sessionId?: string): Promise<any> {
    const id = ++this.id
    this.ws.send(JSON.stringify({ id, method, params, sessionId }))
    return new Promise((res, rej) => this.waiting.set(id, m => m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)))
  }
}

interface Seen { at: number, msg: any }

async function main() {
  const wav = makeAudio()
  const decks = path.join(TMP, 'decks')
  fs.rmSync(decks, { recursive: true, force: true })
  fs.mkdirSync(decks, { recursive: true })
  fs.copyFileSync(path.join(ROOT, 'decks', 'demo.json'), path.join(decks, 'demo.json'))
  console.log(`device ${DEVICE}; studio ${STATIC ?? 'dev server'}; audio ${wav}; models ${MODELS}${fs.existsSync(MODELS) ? '' : ' (missing: the hub will be used)'}`)

  start('server', process.execPath, [path.join(ROOT, 'server', 'server.ts')], {
    env: { RAZZLE_AUDIO: 'browser', RAZZLE_PORT: String(PORT), RAZZLE_DECKS_DIR: decks, RAZZLE_NO_LAUNCH: '1', RAZZLE_MODELS_DIR: MODELS, ...(STATIC ? { RAZZLE_STATIC: STATIC } : {}) },
  })
  if (!STATIC) start('vite', 'npx', ['vite', '--port', String(VITE), '--strictPort'], { cwd: path.join(ROOT, 'tldraw', 'apps', 'razzle'), env: { RAZZLE_PORT: String(PORT) } })
  await waitHttp(`${BASE}/api/state`, 15000)
  await waitHttp(`${STUDIO}/`, 30000)

  const seen: Seen[] = []
  const obs = new WebSocket(`ws://127.0.0.1:${PORT}/ws`)
  await new Promise(r => obs.once('open', r))
  obs.on('message', d => seen.push({ at: Date.now(), msg: JSON.parse(d.toString()) }))
  obs.send(JSON.stringify({ t: 'hello', role: 'cli' }))
  const waitFor = async (pred: (s: Seen) => boolean, ms: number, from = 0) => {
    const t = Date.now()
    while (Date.now() - t < ms) { const hit = seen.slice(from).find(pred); if (hit) return hit; await sleep(50) }
    return null
  }

  // presenting slide 8 (index 7) at its first step, agent off
  await api('POST', '/api/mode', { mode: 'present', deckId: 'demo', auto: false })
  await api('POST', '/api/nav', { action: 'goto', slide: 7, step: 0, source: 'human' })

  const profile = path.join(TMP, 'chrome-profile')
  fs.rmSync(profile, { recursive: true, force: true })
  start('chrome', CHROME, [
    // --no-sandbox: the sandboxed audio service cannot read the fake-capture file otherwise
    '--headless=new', '--no-sandbox', `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`,
    '--enable-unsafe-webgpu', '--window-size=1400,900', 'about:blank',
  ])
  await waitHttp(`http://127.0.0.1:${CDP}/json/version`, 20000)
  const ver = await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json() as any
  const cdp = new Cdp(new WebSocket(ver.webSocketDebuggerUrl))
  await new Promise(r => cdp.ws.once('open', r))
  const { targetId } = await cdp.call('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await cdp.call('Target.attachToTarget', { targetId, flatten: true })
  const consoleLines: string[] = []
  const external = new Set<string>()
  const names = new Map<string, string>()
  cdp.events.push(m => {
    if (m.method === 'Network.requestWillBeSent') {
      const u = new URL(m.params.request.url)
      // model files and the ONNX runtime should come from the server and the build, not a hub or CDN
      if (/huggingface|hf\.co|jsdelivr|unpkg/.test(u.hostname)) external.add(`${names.get(m.sessionId) ?? m.sessionId}: ${u.hostname}${u.pathname.slice(0, 60)}`)
    }
    if (m.method === 'Runtime.consoleAPICalled') consoleLines.push(`${m.params.type}: ${m.params.args.map((a: any) => a.value ?? a.description ?? '').join(' ')}`)
    if (m.method === 'Runtime.exceptionThrown') consoleLines.push(`exception: ${m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text}`)
  })
  await cdp.call('Runtime.enable', {}, sessionId)
  await cdp.call('Page.enable', {}, sessionId)
  await cdp.call('Network.enable', {}, sessionId)
  // the speech worker's own requests (model files, the runtime) belong to a worker target
  cdp.events.push(m => {
    if (m.method === 'Target.attachedToTarget') names.set(m.params.sessionId, `${m.params.targetInfo.type} ${m.params.targetInfo.url.slice(-40)}`)
    if (m.method === 'Target.attachedToTarget') void cdp.call('Network.enable', {}, m.params.sessionId).catch(() => {})
  })
  await cdp.call('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sessionId)
  if (DEVICE === 'wasm') await cdp.call('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('razzle-asr', JSON.stringify({ device: 'wasm' })) } catch {}` }, sessionId)
  const evaluate = async (expr: string) => (await cdp.call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId)).result?.value
  const t0 = Date.now()
  await cdp.call('Page.navigate', { url: `${STUDIO}/#/present?view=speaker&deck=demo` }, sessionId)

  try {
    console.log('speaker view takes the mic')
    const gpu = await evaluate(`(async () => { const a = navigator.gpu && await navigator.gpu.requestAdapter(); return a ? JSON.stringify({ vendor: a.info?.vendor, arch: a.info?.architecture, desc: a.info?.description, f16: a.features.has('shader-f16') }) : null })()`)
    console.log(`  WebGPU adapter in this Chrome: ${gpu}`)
    const claimed = await waitFor(s => s.msg.t === 'state' && s.msg.state.mic?.active, 300000)
    check(Boolean(claimed), `mic claimed by the speaker view (${claimed ? ((claimed.at - t0) / 1000).toFixed(1) + ' s after load, model included' : 'timed out'})`)
    if (!claimed) throw new Error('no mic')
    await sleep(3000)
    const stats0 = await evaluate('window.__razzleAsr')
    console.log(`  after 3 s: ${stats0?.samples} samples (peak rms ${stats0?.peak?.toFixed(4)}), ${stats0?.segments} segments`)
    console.log(`  ${stats0?.model} on ${stats0?.device}, ready in ${stats0?.loadMs} ms`)
    check(stats0?.device === DEVICE, `transcribing on ${DEVICE}`)

    console.log('cue')
    const cue = await waitFor(s => s.msg.t === 'state' && s.msg.state.slideIndex === 7 && s.msg.state.step === 1, 90000)
    check(Boolean(cue) && cue!.msg.state.lastNav?.source === 'cue', `cue "private" moved slide 8 to step 2 (lastNav.source = ${cue?.msg.state.lastNav?.source})`)
    const cueFired = await waitFor(s => s.msg.t === 'cue-fired', 2000)
    check(cueFired?.msg.id === 'glyphs-cue-1', `cue-fired ${cueFired?.msg.id}`)
    await waitFor(s => s.msg.t === 'transcript' && /private/i.test(s.msg.final?.text ?? ''), 20000)
    const partials = seen.filter(s => s.msg.t === 'transcript' && s.msg.partial)
    const pauses = seen.filter(s => s.msg.t === 'transcript' && s.msg.pause)
    const finals = seen.filter(s => s.msg.t === 'transcript' && s.msg.final)
    check(partials.length > 0, `partials (${partials.length}), e.g. "${partials[partials.length - 1]?.msg.partial ?? ''}"`)
    check(pauses.length > 0 && typeof pauses[0].msg.segId === 'number', `pauses with segIds (${pauses.length}), e.g. "${pauses[0]?.msg.pause.text ?? ''}" seg ${pauses[0]?.msg.segId}`)
    const fin = finals.find(s => /private/i.test(s.msg.final.text))
    check(Boolean(fin) && fin!.msg.final.slideIndex === 7, `final tagged with slide 8: "${fin?.msg.final.text ?? ''}"`)
    // latency: end of the kept audio (<= 200 ms after the last word) -> the pause reaching the server
    const lat: number[] = []
    for (const p of pauses) {
      const f = finals.find(x => x.msg.segId === p.msg.segId)
      if (f) lat.push(p.at - f.msg.final.t1)
    }
    if (lat.length) console.log(`  segment end -> pause at the server: ${lat.map(x => x + ' ms').join(', ')} (includes the 500 ms of silence that closes a segment)`)
    if (cue && fin) console.log(`  cue fired ${cue.at - fin.msg.final.t1} ms after the end of its segment (the word "private" ends ~0.6 s before it)`)

    console.log('director')
    start('director', process.execPath, [path.join(ROOT, 'server', 'director.ts'), '--url', BASE], { env: { ANTHROPIC_API_KEY: '', TYPESAFE_API_KEY: '' } })
    const dir = await waitFor(s => s.msg.t === 'state' && s.msg.state.agent !== 'offline', 15000)
    check(Boolean(dir), 'director connected')
    const mark = seen.length
    await api('POST', '/api/mode', { mode: 'present', auto: true })
    await api('POST', '/api/nav', { action: 'goto', slide: 1, step: 0, source: 'human' })
    const adv = await waitFor(s => s.msg.t === 'state' && s.msg.state.slideIndex === 1 && s.msg.state.step === 1, 90000, mark)
    check(Boolean(adv) && adv!.msg.state.lastNav?.source === 'agent', `agent advanced slide 2 to step 2 from browser transcripts (lastNav.source = ${adv?.msg.state.lastNav?.source})`)
    if (adv) {
      const pz = seen.slice(mark).filter(s => s.msg.t === 'transcript' && (s.msg.pause || s.msg.final) && s.at <= adv.at).pop()
      if (pz) console.log(`  advanced ${adv.at - pz.at} ms after the ${pz.msg.pause ? 'pause' : 'final'} "${(pz.msg.pause ?? pz.msg.final).text}"`)
    }

    const stats = await evaluate('window.__razzleAsr')
    const med = (a: number[]) => a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : NaN
    console.log(`  transcription (${stats.device}): partial median ${med(stats.partial)} ms (n=${stats.partial.length}, max ${Math.max(...stats.partial)}), pause median ${med(stats.pause)} ms (n=${stats.pause.length}, max ${Math.max(...stats.pause)})`)

    // the speaker view lets go of the mic when the talk ends
    let mark2 = seen.length
    await api('POST', '/api/mode', { mode: 'idle' })
    const released = await waitFor(s => s.msg.t === 'state' && s.msg.state.mode === 'idle' && !s.msg.state.mic?.active, 15000, mark2)
    check(Boolean(released), 'mic released when presenting stopped')

    console.log('record from the studio')
    const { targetId: studioId } = await cdp.call('Target.createTarget', { url: `${STUDIO}/#/?deck=demo` })
    const { sessionId: studio } = await cdp.call('Target.attachToTarget', { targetId: studioId, flatten: true })
    await cdp.call('Runtime.enable', {}, studio)
    const inStudio = async (expr: string) => (await cdp.call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, studio)).result?.value
    let ready = false
    for (let i = 0; i < 150 && !ready; i++) { ready = !!(await inStudio(`(() => { const b = document.querySelector('.rz-record-btn'); return !!b && !b.disabled && !!document.querySelector('.rz-mic-studio') })()`)); if (!ready) await sleep(200) }
    check(ready, 'studio shows Record and the mic switch')
    mark2 = seen.length
    await inStudio(`document.querySelector('.rz-record-btn').click()`)
    const rec = await waitFor(s => s.msg.t === 'state' && s.msg.state.mode === 'record' && s.msg.state.mic?.active, 60000, mark2)
    check(Boolean(rec), 'Record took the mic')
    const takeId = rec?.msg.state.takeId
    const recFinal = await waitFor(s => s.msg.t === 'transcript' && s.msg.final?.text, 60000, mark2)
    check(Boolean(recFinal), `a final while recording: "${recFinal?.msg.final?.text ?? ''}"`)
    mark2 = seen.length
    await inStudio(`document.querySelector('.rz-recording')?.click()`)
    const stopped = await waitFor(s => s.msg.t === 'state' && s.msg.state.mode === 'idle' && !s.msg.state.mic?.active, 20000, mark2)
    check(Boolean(stopped), 'Stop released the mic')
    let take: any = null
    for (let i = 0; i < 60; i++) {
      const takes = await api('GET', '/api/decks/demo/takes')
      take = takes.find((t: any) => t.id === takeId)
      if (take?.endedAt) break
      await sleep(250)
    }
    check(Boolean(take?.endedAt) && take.utterances.length > 0, `take ${takeId} closed with ${take?.utterances?.length ?? 0} utterance(s), e.g. "${take?.utterances?.[0]?.text ?? ''}"`)
    // a denied permission is reported on the switch
    // (the fake-UI flag grants every request, so the browser's refusal is simulated)
    await inStudio(`navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'))`)
    await inStudio(`document.querySelector('.rz-mic-studio .rz-mic-btn').click()`)
    let denied: any = null
    for (let i = 0; i < 50 && !denied?.status?.includes('error'); i++) { await sleep(200); denied = await inStudio(`({ status: document.querySelector('.rz-mic-studio')?.dataset.status, msg: document.querySelector('.rz-mic-studio .rz-mic-msg')?.textContent })`) }
    check(denied?.status === 'error' && /permission/i.test(denied?.msg ?? ''), `permission denied shows on the switch: ${denied?.status} "${denied?.msg ?? ''}"`)

    if (fs.existsSync(MODELS)) check(external.size === 0, `models and the ONNX runtime came from the server, not the hub or a CDN${external.size ? ': ' + [...external].slice(0, 5).join(', ') : ''}`)
    const speakerMic = await evaluate(`document.querySelector('.rz-mic')?.dataset.status`)
    check(speakerMic === 'off', `the speaker view's mic is off (${speakerMic})`)
  } finally {
    const asrLines = consoleLines.filter(l => /razzle asr|exception|error/i.test(l))
    if (asrLines.length) console.log('page console:\n  ' + asrLines.slice(0, 20).join('\n  '))
    obs.close()
    cdp.ws.close()
    if (!args.includes('--keep')) stopAll()
  }
  console.log(failures ? `${failures} failure(s); logs in ${TMP}` : 'all ok')
  process.exit(failures ? 1 : 0)
}

main().catch(e => { console.error(e); stopAll(); process.exit(1) })
