// Razzle server: decks, presentation state, the /ws hub, audio + whisper, record mode,
// cue matching, hidden-slide insertion, notes generation. See docs/DESIGN.md.
//
// Env: RAZZLE_PORT (7878), RAZZLE_DECKS_DIR (<repo>/decks), RAZZLE_AUDIO_FILE (stream a
// wav instead of the mic), RAZZLE_MIC (avfoundation audio device, 0), RAZZLE_NO_LAUNCH=1
// (/api/present does not open windows), RAZZLE_QUIET=1.

import http from 'node:http'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { WebSocketServer, WebSocket } from 'ws'
import { AudioPipeline } from './audio.ts'
import { CueTracker, type Cue } from './cues.ts'
import {
  applyNav, initialState, newClock, stepCountOf,
  type Mode, type NavRequest, type PresState, type AgentStatus, type NavSource,
} from './state.ts'
import { claudeJSON, hasClaude, MODELS } from './llm.ts'
import { escapeHtml, slideText, validateSlide, newId, type Json } from './slides.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const PORT = Number(process.env.RAZZLE_PORT ?? 7878)
const DECKS = path.resolve(process.env.RAZZLE_DECKS_DIR ?? path.join(ROOT, 'decks'))
const DIST = path.join(ROOT, 'editor', 'dist')
const SHARED = path.join(ROOT, 'shared')
const PRESENTER_APP = path.join(ROOT, 'presenter', 'build', 'Razzle Presenter.app')
const QUIET = process.env.RAZZLE_QUIET === '1'

function log(...a: unknown[]) {
  if (!QUIET) console.log(new Date().toISOString().slice(11, 23), ...a)
}

// ---------------------------------------------------------------- storage

type Deck = Json & { id: string, title: string, slides: Json[], updatedAt?: number }
interface Utterance { text: string, t0: number, t1: number, slideId: string, slideIndex: number, step: number }
interface Take { id: string, deckId: string, startedAt: number, endedAt?: number, utterances: Utterance[] }

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/
const validId = (id: string) => ID_RE.test(id) && !id.includes('..')

async function writeAtomic(file: string, data: unknown) {
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${newId(6)}.tmp`
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2))
  await fsp.rename(tmp, file)
}

const deckFile = (id: string) => path.join(DECKS, `${id}.json`)
const takeDir = (id: string) => path.join(DECKS, id, 'takes')

async function readDeck(id: string): Promise<Deck | null> {
  if (!validId(id)) return null
  try { return JSON.parse(await fsp.readFile(deckFile(id), 'utf8')) } catch { return null }
}

async function listDecks() {
  await fsp.mkdir(DECKS, { recursive: true })
  const out = []
  for (const f of await fsp.readdir(DECKS)) {
    if (!f.endsWith('.json')) continue
    try {
      const d = JSON.parse(await fsp.readFile(path.join(DECKS, f), 'utf8'))
      out.push({ id: d.id ?? f.slice(0, -5), title: d.title ?? '', updatedAt: d.updatedAt ?? 0, slideCount: d.slides?.length ?? 0 })
    } catch { /* skip unreadable */ }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt)
}

async function listTakes(id: string): Promise<Take[]> {
  try {
    const files = (await fsp.readdir(takeDir(id))).filter(f => f.endsWith('.json'))
    const takes = await Promise.all(files.map(async f => JSON.parse(await fsp.readFile(path.join(takeDir(id), f), 'utf8')) as Take))
    return takes.sort((a, b) => a.startedAt - b.startedAt)
  } catch { return [] }
}

// serialise writes per deck so concurrent PUT / insert-hidden / notes do not interleave
const deckLocks = new Map<string, Promise<unknown>>()
function withDeckLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = deckLocks.get(id) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  deckLocks.set(id, next.catch(() => {}))
  return next
}

// ---------------------------------------------------------------- live state

let state: PresState = initialState()
const clock = newClock()
let cues = new CueTracker()
let deck: Deck | null = null // the deck being presented/recorded (state.deckId)
const audio = new AudioPipeline()
let audioStartedAt: number | null = null
const openTakes = new Map<string, Take>()
const segInfo = new Map<number, { slideId: string, slideIndex: number, step: number, takeId: string | null }>()

interface Client { ws: WebSocket, role: string, deckId?: string }
const clients = new Set<Client>()

function send(c: Client, msg: unknown) {
  if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(msg))
}
function broadcast(msg: unknown, except?: Client) {
  const s = JSON.stringify(msg)
  for (const c of clients) if (c !== except && c.ws.readyState === WebSocket.OPEN) c.ws.send(s)
}
function broadcastState() { broadcast({ t: 'state', state }) }

function slides(): Json[] { return deck?.slides ?? [] }

// build-step counts reported by screens ({t:'steps'}), keyed by slide id; cleared when the deck changes
const stepOverrides = new Map<string, number>()
function stepsAt(i: number): number {
  const s = slides()[i]
  return (s && stepOverrides.get(s.id)) ?? stepCountOf(s as any)
}

async function setDeck(id: string | null) {
  if (id === state.deckId && (deck || !id)) return
  deck = id ? await readDeck(id) : null
  stepOverrides.clear()
  state = { ...state, deckId: deck ? deck.id : null, slideIndex: 0, step: 0, stepCount: stepsAt(0) }
  cues = new CueTracker()
}

function refreshFromDeck() {
  const n = slides().length
  const slideIndex = n ? Math.min(state.slideIndex, n - 1) : 0
  const stepCount = stepsAt(slideIndex)
  state = { ...state, slideIndex, stepCount, step: Math.min(state.step, stepCount - 1) }
}

function nav(req: NavRequest): { accepted: boolean, reason?: string } {
  if (!deck) return { accepted: false, reason: 'no deck' }
  if (req.source === 'agent' && req.action !== 'goto' && !state.auto) return { accepted: false, reason: 'auto is off' }
  const before = state
  const r = applyNav(state, slides() as any, req, clock, Date.now(), stepsAt)
  if (!r.accepted) {
    log(`nav ${req.action} (${req.source}) dropped: ${r.reason}`)
    return { accepted: false, reason: r.reason }
  }
  state = r.state
  cues.onNav()
  log(`nav ${req.action} (${req.source}) ${before.slideIndex}.${before.step} -> ${state.slideIndex}.${state.step}`)
  broadcastState()
  return { accepted: true }
}

async function setMode(mode: Mode, opts: { auto?: boolean, deckId?: string } = {}) {
  if (opts.deckId && opts.deckId !== state.deckId) await setDeck(opts.deckId)
  if (typeof opts.auto === 'boolean') state = { ...state, auto: opts.auto }
  const prev = state.mode
  if (mode !== 'idle' && !deck) throw new Error('no deck selected (pass deckId)')
  if (prev === 'record' && mode !== 'record') closeTake()
  state = { ...state, mode }
  if (mode === 'record' && prev !== 'record') {
    const take: Take = { id: `${new Date().toISOString().replace(/[:.]/g, '-')}-${newId(4)}`, deckId: deck!.id, startedAt: Date.now(), utterances: [] }
    openTakes.set(take.id, take)
    state = { ...state, takeId: take.id }
    await writeAtomic(path.join(takeDir(deck!.id), `${take.id}.json`), take)
    log(`record: take ${take.id}`)
  }
  if (mode !== 'record') state = { ...state, takeId: null }
  broadcastState()
  if (mode === 'idle') { if (audio.running) audio.stop() }
  else if (!audio.running) audio.start().catch(e => log('audio start failed:', e.message))
}

function closeTake() {
  const id = state.takeId
  const take = id ? openTakes.get(id) : null
  if (!take) return
  // finals still in flight belong to this take; save once they land
  audio.stop()
  audio.drain().then(async () => {
    take.endedAt = Date.now()
    await writeAtomic(path.join(takeDir(take.deckId), `${take.id}.json`), take)
    openTakes.delete(take.id)
    log(`record: take ${take.id} closed, ${take.utterances.length} utterances`)
  })
}

function currentCues(): Cue[] {
  const s = slides()[state.slideIndex]
  return Array.isArray(s?.razzle?.cues) ? s.razzle.cues : []
}

function onTranscript(segId: number, text: string, isFinal: boolean) {
  if (!deck || state.mode === 'idle') return
  const hit = cues.feed(segId, text, isFinal, currentCues(), state.step)
  if (!hit) return
  const { cue } = hit
  if (cue.action === 'step' && state.step >= state.stepCount - 1) {
    log(`cue "${cue.phrase}" (step) ignored: no more steps`)
    return
  }
  log(`cue "${cue.phrase}" heard -> ${cue.action}`)
  if (nav({ action: 'next', source: 'cue' }).accepted) broadcast({ t: 'cue-fired', id: cue.id, phrase: cue.phrase })
}

audio.on('log', (s: string) => log(s))
audio.on('error', (e: Error) => log('audio error:', e.message))
audio.on('started', ({ at }: { at: number }) => { audioStartedAt = at })
audio.on('segment-start', ({ segId }: { segId: number }) => {
  const s = slides()[state.slideIndex]
  segInfo.set(segId, { slideId: s?.id ?? '', slideIndex: state.slideIndex, step: state.step, takeId: state.takeId })
})
audio.on('partial', ({ segId, text }: { segId: number, text: string }) => {
  broadcast({ t: 'transcript', partial: text })
  onTranscript(segId, text, false)
})
audio.on('late-partial', ({ segId, text }: { segId: number, text: string }) => {
  onTranscript(segId, text, false)
})
audio.on('final', ({ segId, text, t0, t1 }: { segId: number, text: string, t0: number, t1: number }) => {
  const info = segInfo.get(segId)
  segInfo.delete(segId)
  if (!text) { onTranscript(segId, '', true); return }
  const s = slides()[state.slideIndex]
  const u: Utterance = {
    text, t0, t1,
    slideId: info?.slideId ?? s?.id ?? '', slideIndex: info?.slideIndex ?? state.slideIndex, step: info?.step ?? state.step,
  }
  log(`final [${u.slideIndex}.${u.step}] ${text}`)
  broadcast({ t: 'transcript', final: u })
  onTranscript(segId, text, true)
  const take = info?.takeId ? openTakes.get(info.takeId) : null
  if (take) {
    take.utterances.push(u)
    writeAtomic(path.join(takeDir(take.deckId), `${take.id}.json`), take).catch(e => log('take write failed:', e.message))
  }
})

// ---------------------------------------------------------------- hidden slides

async function insertHidden(after: number, slide: Json, prompt: string): Promise<{ ok: boolean, error?: string, slideIndex?: number }> {
  if (!deck) return { ok: false, error: 'no deck' }
  const errs = validateSlide(slide, { width: deck.width ?? 1000, height: deck.height ?? 562.5 })
  if (errs.length) return { ok: false, error: errs.slice(0, 5).join('; ') }
  const id = deck.id
  return withDeckLock(id, async () => {
    const d = deck && deck.id === id ? deck : await readDeck(id)
    if (!d) return { ok: false, error: 'deck vanished' }
    const at = Math.min(Math.max(Math.trunc(after) + 1, 0), d.slides.length)
    const s: Json = { ...slide, razzle: { ...(slide.razzle ?? {}), hidden: true, generated: slide.razzle?.generated ?? { by: 'director', prompt, at: Date.now() } } }
    if (d.slides.some(x => x.id === s.id)) s.id = newId()
    d.slides.splice(at, 0, s)
    d.updatedAt = Date.now()
    await writeAtomic(deckFile(id), d)
    if (deck && deck.id === id) {
      deck = d
      if (at <= state.slideIndex) state = { ...state, slideIndex: state.slideIndex + 1 }
      refreshFromDeck()
    }
    log(`hidden slide inserted at ${at}: ${prompt.slice(0, 60)}`)
    broadcast({ t: 'deck-updated', deckId: id, updatedAt: d.updatedAt })
    broadcast({ t: 'hidden-ready', slideIndex: at, prompt })
    broadcastState()
    return { ok: true, slideIndex: at }
  })
}

// ---------------------------------------------------------------- notes

const NOTES_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['slides'],
  properties: {
    slides: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'notes', 'script'],
        properties: {
          id: { type: 'string' },
          notes: { type: 'array', items: { type: 'string' } },
          script: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
}

async function generateNotes(id: string): Promise<Deck> {
  const d = await readDeck(id)
  if (!d) throw new Error('no such deck')
  const takes = await listTakes(id)
  // per slide, the most recent take that has speech on it wins
  const bySlide = new Map<string, Utterance[]>()
  for (const take of takes) {
    const seen = new Map<string, Utterance[]>()
    for (const u of take.utterances) {
      if (!seen.has(u.slideId)) seen.set(u.slideId, [])
      seen.get(u.slideId)!.push(u)
    }
    for (const [sid, us] of seen) bySlide.set(sid, us)
  }
  const items = d.slides.map((s, i) => {
    const steps = stepCountOf(s as any)
    const us = bySlide.get(s.id) ?? []
    const perStep = Array.from({ length: steps }, (_, k) => us.filter(u => Math.min(u.step, steps - 1) === k).map(u => u.text).join(' '))
    return { index: i, id: s.id, hidden: Boolean(s.razzle?.hidden), steps, slideText: slideText(s).slice(0, 1500), spoken: perStep }
  }).filter(x => x.spoken.some(Boolean))
  if (!items.length) throw new Error('no recorded speech for this deck (record a take first)')
  if (!hasClaude()) throw new Error('ANTHROPIC_API_KEY is not set')
  const system = `You turn a researcher's spoken rehearsal of a talk into speaker notes and a per-build-step script.
Rules:
- Keep the speaker's own words and phrasing. Do not rewrite her voice into formal prose.
- Condense: prompts, not paragraphs. Each script entry is 1-3 short lines she can glance at: the key phrases she said, in her wording, in her order.
- notes: 1-4 short paragraphs per slide (each a single string) capturing the points she made on that slide, again in her words. Drop filler (um, so, you know), false starts and repeats.
- script must have exactly "steps" entries for each slide (index = build step). If nothing was said at a step, use "".
- Return JSON: {"slides":[{"id","notes":[...],"script":[...]}]} covering every slide given, nothing else.`
  const user = `Deck: ${d.title}\n\n` + JSON.stringify(items, null, 1)
  const out = await claudeJSON<{ slides: { id: string, notes: string[], script: string[] }[] }>({
    model: MODELS.sonnet, system, user, schema: NOTES_SCHEMA, maxTokens: 16000, stream: true,
  })
  return withDeckLock(id, async () => {
    const fresh = (await readDeck(id)) ?? d
    for (const r of out.slides ?? []) {
      const s = fresh.slides.find(x => x.id === r.id)
      if (!s) continue
      const steps = stepCountOf(s as any)
      const script = Array.from({ length: steps }, (_, k) => String(r.script?.[k] ?? ''))
      s.remark = (r.notes ?? []).filter(Boolean).map(p => `<p>${escapeHtml(String(p))}</p>`).join('')
      s.razzle = { ...(s.razzle ?? {}), script }
    }
    fresh.updatedAt = Date.now()
    await writeAtomic(deckFile(id), fresh)
    if (deck?.id === id) { deck = fresh; refreshFromDeck() }
    broadcast({ t: 'deck-updated', deckId: id, updatedAt: fresh.updatedAt })
    return fresh
  })
}

// ---------------------------------------------------------------- present

function launchPresenter(deckId: string) {
  if (process.env.RAZZLE_NO_LAUNCH === '1') return 'none'
  const base = `http://localhost:${PORT}`
  const opts = { detached: true, stdio: 'ignore' as const }
  if (fs.existsSync(PRESENTER_APP)) {
    spawn('open', ['-n', '-a', PRESENTER_APP, '--args', '--url', base, '--deck', deckId], opts).unref()
    return 'app'
  }
  for (const view of ['speaker', 'audience']) {
    const url = `${base}/#/present?view=${view}&deck=${encodeURIComponent(deckId)}`
    spawn('open', ['-na', 'Google Chrome', '--args', '--new-window', url], opts).unref()
  }
  return 'chrome'
}

// ---------------------------------------------------------------- HTTP

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.wasm': 'application/wasm', '.txt': 'text/plain',
}

function json(res: http.ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

async function body(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []
  let n = 0
  for await (const c of req) { n += c.length; if (n > 100e6) throw new Error('body too large'); chunks.push(c) }
  const s = Buffer.concat(chunks).toString('utf8')
  return s ? JSON.parse(s) : {}
}

async function serveStatic(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://x')
  let rel = decodeURIComponent(url.pathname)
  const file = path.join(DIST, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''))
  if (!file.startsWith(DIST)) { res.writeHead(403); res.end(); return }
  let target = file
  try {
    const st = await fsp.stat(target)
    if (st.isDirectory()) target = path.join(target, 'index.html')
    await fsp.access(target)
  } catch {
    target = path.join(DIST, 'index.html') // SPA fallback
    rel = '/index.html'
  }
  try {
    const data = await fsp.readFile(target)
    res.writeHead(200, { 'content-type': MIME[path.extname(target)] ?? 'application/octet-stream' })
    res.end(data)
  } catch {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(`<!doctype html><title>Razzle</title><body style="font:16px system-ui;padding:2em">
<h1>Razzle server</h1><p>The editor is not built yet (<code>editor/dist</code> is missing).</p>
<p>API: <a href="/api/decks">/api/decks</a> · <a href="/api/state">/api/state</a></p></body>`)
  }
}

async function api(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const p = url.pathname.replace(/\/+$/, '')
  const m = req.method ?? 'GET'
  const deckMatch = p.match(/^\/api\/decks\/([^/]+)(?:\/(takes|notes))?$/)

  if (p === '/api/decks' && m === 'GET') return json(res, 200, await listDecks())
  if (deckMatch) {
    const id = decodeURIComponent(deckMatch[1])
    if (!validId(id)) return json(res, 400, { error: 'bad deck id' })
    const sub = deckMatch[2]
    if (!sub && m === 'GET') {
      const d = await readDeck(id)
      return d ? json(res, 200, d) : json(res, 404, { error: 'no such deck' })
    }
    if (!sub && m === 'PUT') {
      const d = await body(req)
      if (!d || typeof d !== 'object' || !Array.isArray(d.slides)) return json(res, 400, { error: 'Deck needs slides[]' })
      const updatedAt = await withDeckLock(id, async () => {
        const out = { width: 1000, height: 562.5, title: id, ...d, id, updatedAt: Date.now() }
        await writeAtomic(deckFile(id), out)
        if (state.deckId === id) { deck = out; stepOverrides.clear(); refreshFromDeck(); broadcastState() }
        return out.updatedAt
      })
      broadcast({ t: 'deck-updated', deckId: id, updatedAt })
      return json(res, 200, { ok: true, updatedAt })
    }
    if (sub === 'takes' && m === 'GET') return json(res, 200, await listTakes(id))
    if (sub === 'notes' && m === 'POST') {
      try { return json(res, 200, await generateNotes(id)) } catch (e) { return json(res, 500, { error: (e as Error).message }) }
    }
  }
  if (p === '/api/state' && m === 'GET') return json(res, 200, state)
  if (p === '/api/nav' && m === 'POST') {
    const b = await body(req)
    const r = nav({ action: b.action, slide: b.slide, step: b.step, source: (b.source ?? 'human') as NavSource })
    return json(res, 200, { ok: true, ...r, state })
  }
  if (p === '/api/mode' && m === 'POST') {
    const b = await body(req)
    if (!['idle', 'record', 'present'].includes(b.mode)) return json(res, 400, { error: 'mode must be idle|record|present' })
    try { await setMode(b.mode, { auto: b.auto, deckId: b.deckId }) } catch (e) { return json(res, 400, { error: (e as Error).message }) }
    return json(res, 200, { ok: true, state })
  }
  if (p === '/api/present' && m === 'POST') {
    const b = await body(req)
    const id = String(b.deckId ?? state.deckId ?? '')
    if (!validId(id) || !(await readDeck(id))) return json(res, 404, { error: 'no such deck' })
    await setDeck(id)
    if (typeof b.slide === 'number') {
      const moved = applyNav(state, slides() as any, { action: 'goto', slide: b.slide, source: 'human' }, clock, Date.now(), stepsAt)
      state = moved.state
    }
    await setMode('present', { deckId: id })
    const how = launchPresenter(id)
    return json(res, 200, { ok: true, launched: how, state })
  }
  if (p === '/api/library' && m === 'GET') {
    try { return json(res, 200, JSON.parse(await fsp.readFile(path.join(SHARED, 'library.json'), 'utf8'))) } catch { return json(res, 200, []) }
  }
  if (p === '/api/debug' && m === 'GET') {
    const at = url.searchParams.get('arrival')
    return json(res, 200, { arrival: at ? audio.arrivalOf(Number(at)) : undefined, audioStartedAt, audioRunning: audio.running, clients: [...clients].map(c => c.role), whisper: { fast: audio.fast.port, final: audio.final.port } })
  }
  json(res, 404, { error: `no route ${m} ${p}` })
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  try {
    if (url.pathname.startsWith('/api/')) await api(req, res, url)
    else if (req.method === 'GET' || req.method === 'HEAD') await serveStatic(req, res)
    else { res.writeHead(405); res.end() }
  } catch (e) {
    if (!res.headersSent) json(res, 500, { error: (e as Error).message })
  }
})

// ---------------------------------------------------------------- WebSocket

const wss = new WebSocketServer({ noServer: true })
server.on('upgrade', (req, socket, head) => {
  if (new URL(req.url ?? '/', 'http://x').pathname !== '/ws') { socket.destroy(); return }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req))
})

function setAgent(status: AgentStatus, message?: string, from?: Client) {
  const changed = state.agent !== status
  state = { ...state, agent: status, agentMessage: message ?? '' }
  broadcast({ t: 'agent', status, message }, from)
  if (changed) broadcastState()
}

function countScreens() {
  const n = (role: string) => [...clients].filter(c => c.role === role).length
  const screens = { audience: n('audience'), speaker: n('speaker') }
  if (screens.audience === state.screens.audience && screens.speaker === state.screens.speaker) return
  state = { ...state, screens }
  broadcastState()
}

wss.on('connection', (ws: WebSocket) => {
  const c: Client = { ws, role: 'unknown' }
  clients.add(c)
  ws.on('message', async raw => {
    let msg: any
    try { msg = JSON.parse(raw.toString()) } catch { return }
    try {
      switch (msg.t) {
        case 'hello':
          c.role = String(msg.role ?? 'unknown')
          c.deckId = msg.deckId
          if (msg.deckId && state.mode === 'idle' && ['audience', 'speaker'].includes(c.role) && msg.deckId !== state.deckId) await setDeck(msg.deckId)
          if (c.role === 'director') log('director connected')
          send(c, { t: 'state', state })
          countScreens()
          break
        case 'black':
          state = { ...state, black: !!msg.on }
          broadcastState()
          break
        case 'nav': {
          const r = nav({ action: msg.action, slide: msg.slide, step: msg.step, source: msg.source ?? (c.role === 'director' ? 'agent' : 'human') })
          if (!r.accepted) send(c, { t: 'state', state })
          break
        }
        case 'mode':
          try { await setMode(msg.mode, { auto: msg.auto, deckId: msg.deckId }) } catch (e) { send(c, { t: 'error', message: (e as Error).message }) }
          break
        case 'steps': {
          // a screen's own count of build steps; ignored unless it names a real slide and a sane count
          const i = msg.slideIndex, n = msg.stepCount
          const s = slides()[i]
          if (s && Number.isInteger(n) && n >= 1 && n <= 200) {
            stepOverrides.set(s.id, n)
            if (i === state.slideIndex && n !== state.stepCount) {
              state = { ...state, stepCount: n, step: Math.min(state.step, n - 1) }
              broadcastState()
            }
          }
          break
        }
        case 'request':
          // the speaker's covert request goes to the director(s) only
          for (const d of clients) if (d.role === 'director') send(d, msg)
          break
        case 'highlight':
          broadcast(msg, c)
          break
        case 'agent':
          setAgent(msg.status, msg.message, c)
          break
        case 'insert-hidden': {
          const r = await insertHidden(msg.after ?? state.slideIndex, msg.slide, String(msg.prompt ?? ''))
          if (!r.ok) { log('insert-hidden rejected:', r.error); send(c, { t: 'error', message: `insert-hidden: ${r.error}` }) }
          break
        }
      }
    } catch (e) {
      log('ws message error:', (e as Error).message)
    }
  })
  ws.on('close', () => {
    clients.delete(c)
    countScreens()
    if (c.role === 'director' && ![...clients].some(x => x.role === 'director')) {
      log('director disconnected')
      setAgent('offline')
    }
  })
})

// ---------------------------------------------------------------- lifecycle

let shuttingDown = false
function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  audio.shutdown()
  for (const c of clients) c.ws.terminate()
  server.close()
  setTimeout(() => process.exit(code), 100).unref()
}
process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
process.on('SIGHUP', () => shutdown(0))
process.on('exit', () => audio.shutdown())
process.on('uncaughtException', e => { console.error(e); shutdown(1) })

server.listen(PORT, '127.0.0.1', () => {
  log(`razzle server on http://localhost:${PORT} (decks: ${DECKS})`)
  if (process.env.RAZZLE_WARM === '1') audio.warm().catch(e => log('warm failed:', e.message))
})
server.on('error', e => { console.error(`server: ${e.message}`); process.exit(1) })
