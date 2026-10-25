// Razzle server: decks, presentation state, the /ws hub, audio + whisper, record mode,
// cue matching, hidden-slide insertion, notes generation. See docs/DESIGN.md.
//
// Decks are Razzle v2 (`format: 'razzle-tldraw/1'`, a tldraw document + a derived slide
// index); PPTist decks (format absent) are still served and navigated.
//
// Env: RAZZLE_PORT (7878), RAZZLE_DECKS_DIR (<repo>/decks), RAZZLE_STATIC (the static site,
// default tldraw/apps/razzle/dist, the studio build), RAZZLE_AUDIO_FILE (stream a
// wav instead of the mic), RAZZLE_MIC (avfoundation audio device, 0), RAZZLE_NO_LAUNCH=1
// (/api/present does not open windows), RAZZLE_QUIET=1, RAZZLE_AUDIO (local: this machine's mic
// through ffmpeg + whisper-server, the default; browser: a studio page transcribes and sends
// `asr` messages), RAZZLE_MODELS_DIR (<repo>/models, served at /models/ for the browser ASR).

import http from 'node:http'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { WebSocketServer, WebSocket } from 'ws'
import { AudioPipeline, cleanText } from './audio.ts'
import { BrowserMic, type AsrEvent } from './mic.ts'
import { createAuth } from './auth.ts'
import { CueTracker, type Cue } from './cues.ts'
import {
  applyNav, initialState, newClock, stepCountOf,
  type Workflow, type Mode, type NavRequest, type PresState, type AgentStatus, type NavSource,
} from './state.ts'
import { deliveryPatches } from './delivery.ts'
import { publishShare, listShares, SHARE_ID } from './shares.ts'
import { codexJSON } from './codex.ts'
import { noteItems, notePatches, noteBaseline, NOTES_PROMPT, NOTES_SCHEMA, type Utterance, type Take } from './notes.ts'
import { escapeHtml, expandLibraryRefs, libraryEntries, validateSlide, newId, type Json } from './slides.ts'
import { appendSlide, insertSlide, isDeckV2, refreshSlides, updateSlideMeta } from '../shared/tl/convert.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const PORT = Number(process.env.RAZZLE_PORT ?? 7878)
// your own decks live in the private companion checkout (private/decks) when it is there
const DECKS = path.resolve(process.env.RAZZLE_DECKS_DIR ?? (fs.existsSync(path.join(ROOT, 'private', 'decks')) ? path.join(ROOT, 'private', 'decks') : path.join(ROOT, 'decks')))
const DIST = path.resolve(process.env.RAZZLE_STATIC ?? path.join(ROOT, 'tldraw', 'apps', 'razzle', 'dist'))
const SHARED = path.join(ROOT, 'shared')
const MODELS_DIR = path.resolve(process.env.RAZZLE_MODELS_DIR ?? path.join(ROOT, 'models'))
const AUDIO_SOURCE: 'local' | 'browser' = process.env.RAZZLE_AUDIO === 'browser' ? 'browser' : 'local'
const PRESENTER_APP = path.join(ROOT, 'presenter', 'build', 'Razzle Presenter.app')
const QUIET = process.env.RAZZLE_QUIET === '1'

function log(...a: unknown[]) {
  if (!QUIET) console.log(new Date().toISOString().slice(11, 23), ...a)
}

// ---------------------------------------------------------------- storage

type Deck = Json & { id: string, title: string, slides: Json[], updatedAt?: number }

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/
const validId = (id: string) => ID_RE.test(id) && !id.includes('..')

async function writeAtomic(file: string, data: unknown) {
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${newId(6)}.tmp`
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2))
  await fsp.rename(tmp, file)
}

const deckFile = (id: string) => path.join(DECKS, `${id}.json`)
const SHARES = process.env.RAZZLE_SHARES_DIR ?? path.join(DECKS, 'shares')
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

let state: PresState = { ...initialState(), mic: { source: AUDIO_SOURCE, active: false } }
const clock = newClock()
let cues = new CueTracker()
let deck: Deck | null = null // the deck being presented/recorded (state.deckId)
// local: capture + whisper on this machine; browser: `asr` messages from the client holding the mic
const audio = new AudioPipeline()
let audioStartedAt: number | null = null
const openTakes = new Map<string, Take>()
const takeWrites = new Map<string, Promise<void>>()
function saveTake(take: Take) {
  const snapshot = structuredClone(take)
  const pending = (takeWrites.get(take.id) ?? Promise.resolve()).catch(() => {}).then(() =>
    writeAtomic(path.join(takeDir(take.deckId), `${take.id}.json`), snapshot))
  takeWrites.set(take.id, pending)
  void pending.finally(() => { if (takeWrites.get(take.id) === pending) takeWrites.delete(take.id) }).catch(() => {})
  return pending
}
const segInfo = new Map<number, { slideId: string, slideIndex: number, step: number, takeId: string | null, recordedAt: number, visitAt: number, session: number }>()

interface Client { ws: WebSocket, role: string, deckId?: string }
const clients = new Set<Client>()
const mic = new BrowserMic<Client>()

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

let enteredAt = Date.now()
let sessionNumber = 0

function nav(req: NavRequest): { accepted: boolean, reason?: string } {
  if (!deck) return { accepted: false, reason: 'no deck' }
  if (req.source !== 'human' && (state.workflow !== 'present' || !state.auto)) return { accepted: false, reason: 'auto is off' }
  const before = state
  const r = applyNav(state, slides() as any, req, clock, Date.now(), stepsAt)
  if (!r.accepted) {
    log(`nav ${req.action} (${req.source}) dropped: ${r.reason}`)
    return { accepted: false, reason: r.reason }
  }
  const take = before.takeId ? openTakes.get(before.takeId) : null
  if (take?.workflow === 'rehearse' && req.source === 'human' && req.action === 'next') {
    const s = slides()[before.slideIndex]
    ;(take.transitions ??= []).push({ slideId: s.id, step: before.step, enteredAt, at: Date.now(), script: s.razzle?.script?.[before.step] ?? '', steps: stepsAt(before.slideIndex) })
    void saveTake(take).catch(e => log('take transition:', e.message))
  }
  enteredAt = Date.now()
  state = r.state
  cues.onNav()
  log(`nav ${req.action} (${req.source}) ${before.slideIndex}.${before.step} -> ${state.slideIndex}.${state.step}`)
  broadcastState()
  return { accepted: true }
}

async function setMode(mode: Mode, opts: { auto?: boolean, deckId?: string, workflow?: Workflow, recording?: boolean } = {}) {
  if (!['idle', 'record', 'present'].includes(mode)) throw new Error('invalid mode')
  if (opts.workflow !== undefined && !['draft', 'rehearse', 'present'].includes(opts.workflow)) throw new Error('invalid workflow')
  const changingDeck = !!opts.deckId && opts.deckId !== state.deckId
  const workflow = opts.workflow ?? (state.mode !== 'idle' && !changingDeck ? state.workflow : mode === 'record' ? 'draft' : 'present') ?? 'present'
  const recording = workflow !== 'present' || (opts.recording ?? (state.mode !== 'idle' && !changingDeck && state.workflow === workflow ? !!state.takeId : false))
  const newSession = state.mode === 'idle' || changingDeck || workflow !== state.workflow || (mode !== 'idle' && recording !== !!state.takeId)
  if (state.takeId && (mode === 'idle' || newSession)) closeTake()
  if (opts.deckId && changingDeck) await setDeck(opts.deckId)
  if (mode !== 'idle' && !deck) throw new Error('no deck selected (pass deckId)')
  const startingPresentation = mode === 'present' && (state.mode !== 'present' || opts.workflow !== undefined)
  state = { ...state, mode, workflow, black: mode === 'idle' || newSession || startingPresentation ? false : state.black,
    auto: workflow === 'present' && (opts.auto ?? (newSession ? true : state.auto)) }
  if (newSession || mode === 'idle') {
    sessionNumber++
    enteredAt = Date.now()
    state = { ...state, takeId: null }
  }
  if (mode !== 'idle' && newSession && recording) {
    const take: Take = { id: `${new Date().toISOString().replace(/[:.]/g, '-')}-${newId(4)}`, deckId: deck!.id, startedAt: Date.now(), workflow, utterances: [] }
    openTakes.set(take.id, take)
    state = { ...state, takeId: take.id }
    await saveTake(take)
    log(`record: take ${take.id}`)
  }
  broadcastState()
  if (AUDIO_SOURCE !== 'local') return
  if (mode === 'idle') { if (audio.running) audio.stop() }
  else if (!audio.running) audio.start().catch(e => log('audio start failed:', e.message))
}

/** Resolves once no segment begun during `takeId` is waiting for its final (browser mode:
 *  the mic holder closes its open segment when recording stops), or after `ms`. */
function segmentsDone(takeId: string, ms = 120000): Promise<void> {
  const t = Date.now()
  return new Promise(res => {
    const tick = () => {
      if (![...segInfo.values()].some(s => s.takeId === takeId) || Date.now() - t > ms) res()
      else setTimeout(tick, 100)
    }
    tick()
  })
}

function closeTake() {
  const id = state.takeId
  const take = id ? openTakes.get(id) : null
  if (!take) return
  // finals still in flight belong to this take; save once they land
  let drained: Promise<void>
  if (AUDIO_SOURCE === 'local') { audio.stop(); drained = audio.drain() } else drained = segmentsDone(take.id)
  drained.then(async () => {
    take.endedAt = Date.now()
    await saveTake(take)
    openTakes.delete(take.id)
    log(`record: take ${take.id} closed, ${take.utterances.length} utterances`)
    if (take.utterances.length && take.workflow !== 'present') void generateNotes(take.deckId, take.workflow).catch(e => log('notes:', e.message))
  }).catch(e => {
    log('take close failed:', e.message)
    broadcast({ t: 'error', message: `Could not save recording: ${e.message}` })
  })
}

function currentCues(): Cue[] {
  const s = slides()[state.slideIndex]
  return Array.isArray(s?.razzle?.cues) ? s.razzle.cues : []
}

function onTranscript(segId: number, text: string, isFinal: boolean) {
  if (!deck || state.mode === 'idle' || state.workflow !== 'present' || !state.auto) return
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

/** Every speech event, from either audio source (mic.ts lists them), comes through here. */
function ingest(ev: AsrEvent) {
  const { segId } = ev
  const current = segInfo.get(segId)?.session === sessionNumber && state.mode !== 'idle'
  switch (ev.kind) {
    case 'segment-start': {
      const s = slides()[state.slideIndex]
      broadcast({ t: 'speech-start', segId })
      segInfo.set(segId, { slideId: s?.id ?? '', slideIndex: state.slideIndex, step: state.step, takeId: state.takeId, recordedAt: Date.now(), visitAt: enteredAt, session: sessionNumber })
      break
    }
    case 'partial':
      if (!current) break
      broadcast({ t: 'transcript', partial: ev.text })
      onTranscript(segId, ev.text, false)
      break
    case 'late-partial':
      if (!current) break
      onTranscript(segId, ev.text, false)
      break
    case 'pause': {
      if (!current) break
      // the speaker paused: the closed segment's fast text, tagged with where it began
      const info = segInfo.get(segId)
      broadcast({ t: 'transcript', segId, pause: { text: ev.text, t1: ev.t1 ?? Date.now(), slideIndex: info?.slideIndex ?? state.slideIndex, step: info?.step ?? state.step } })
      break
    }
    case 'final': {
      const { text, t0, t1 } = ev
      const info = segInfo.get(segId)
      segInfo.delete(segId)
      if (!text) { if (current) onTranscript(segId, '', true); return }
      const s = slides()[state.slideIndex]
      const u: Utterance = {
        text, t0, t1, recordedAt: info?.recordedAt, visitAt: info?.visitAt,
        slideId: info?.slideId ?? s?.id ?? '', slideIndex: info?.slideIndex ?? state.slideIndex, step: info?.step ?? state.step,
      }
      log(`final [${u.slideIndex}.${u.step}] ${text}`)
      if (current) {
        broadcast({ t: 'transcript', segId, final: u })
        onTranscript(segId, text, true)
      }
      const take = info?.takeId ? openTakes.get(info.takeId) : null
      if (take) {
        take.utterances.push(u)
        saveTake(take).catch(e => log('take write failed:', e.message))
      }
      break
    }
  }
}

audio.on('log', (s: string) => log(s))
audio.on('error', (e: Error) => log('audio error:', e.message))
audio.on('started', ({ at }: { at: number }) => { audioStartedAt = at; setMicActive(true) })
audio.on('stopped', () => setMicActive(false))
audio.on('source-ended', () => setMicActive(false))
audio.on('segment-start', ({ segId, t0 }: { segId: number, t0: number }) => ingest({ kind: 'segment-start', segId, t0 }))
for (const kind of ['partial', 'late-partial', 'pause'] as const) {
  audio.on(kind, ({ segId, text, t1 }: { segId: number, text: string, t1?: number }) => ingest({ kind, segId, text, t1 }))
}
audio.on('final', ({ segId, text, t0, t1 }: { segId: number, text: string, t0: number, t1: number }) => ingest({ kind: 'final', segId, text, t0, t1 }))

function setMicActive(active: boolean) {
  if (state.mic.active === active) return
  state = { ...state, mic: { ...state.mic, active } }
  broadcastState()
}

// browser mode: the client holding the mic sends {t:'asr'}; the latest {t:'mic', on:true} wins
function micClaim(c: Client, on: boolean) {
  if (AUDIO_SOURCE !== 'browser') { send(c, { t: 'error', message: 'mic: this server captures audio itself (RAZZLE_AUDIO=local)' }); return }
  if (on) {
    if (c.role === 'audience') { send(c, { t: 'mic', held: false, message: 'the audience view does not capture' }); return }
    const { previous, ended } = mic.claim(c)
    ended.forEach(ingest)
    if (previous) send(previous, { t: 'mic', held: false, message: 'another screen took the mic' })
    send(c, { t: 'mic', held: true })
    log(`mic: claimed by ${c.role} (claim ${mic.claims})`)
  } else {
    const { released, ended } = mic.release(c)
    ended.forEach(ingest)
    if (released) log(`mic: released by ${c.role}`)
    send(c, { t: 'mic', held: false })
  }
  setMicActive(mic.active)
}

function micAsr(c: Client, msg: any) {
  if (AUDIO_SOURCE !== 'browser') return
  const ev = mic.translate(c, msg, state.mode !== 'idle' && !!deck)
  if (!ev) return
  if (ev.kind !== 'segment-start') {
    ev.text = cleanText(ev.text)
    if ((ev.kind === 'partial' || ev.kind === 'late-partial') && !ev.text) return
  }
  ingest(ev)
}

// ---------------------------------------------------------------- hidden slides

async function insertHidden(after: number, slide: Json, prompt: string): Promise<{ ok: boolean, error?: string, slideIndex?: number }> {
  if (!deck) return { ok: false, error: 'no deck' }
  const errs = validateSlide(slide, { width: deck.width ?? 1000, height: deck.height ?? 562.5 })
  if (errs.length) return { ok: false, error: errs.slice(0, 5).join('; ') }
  const id = deck.id
  return withDeckLock(id, async () => {
    const d = deck && deck.id === id ? deck : await readDeck(id)
    if (!d) return { ok: false, error: 'deck vanished' }
    const razzle = { ...(slide.razzle ?? {}), hidden: true, generated: slide.razzle?.generated ?? { by: 'director', prompt, at: Date.now() } }
    let at: number
    if (isDeckV2(d)) {
      // converted into a new frame in the backstage row (below every slide, last in reading order)
      try {
        const r = insertSlide(d, { ...slide, razzle }, {})
        at = r.slideIndex
        if (r.warnings.length) log(`hidden slide conversion: ${[...new Set(r.warnings)].slice(0, 3).join('; ')}`)
      } catch (e) {
        return { ok: false, error: `conversion failed: ${(e as Error).message}` }
      }
    } else {
      at = Math.min(Math.max(Math.trunc(after) + 1, 0), d.slides.length)
      const s: Json = { ...slide, razzle }
      if (d.slides.some(x => x.id === s.id)) s.id = newId()
      d.slides.splice(at, 0, s)
    }
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

async function addSlide(id: string, raw: unknown, opts: { hidden: boolean }): Promise<{ ok: boolean, error?: string, slideIndex?: number, frameId?: string, warnings?: string[] }> {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'body needs {slide}' }
  let lib: ReturnType<typeof libraryEntries> = []
  try { lib = libraryEntries(JSON.parse(await fsp.readFile(path.join(SHARED, 'library.json'), 'utf8'))) } catch { /* no library: refs fail below */ }
  const { slide, errors } = expandLibraryRefs(raw as Json, lib)
  if (errors.length) return { ok: false, error: errors.slice(0, 5).join('; ') }
  const errs = validateSlide(slide)
  if (errs.length) return { ok: false, error: errs.slice(0, 5).join('; ') }
  if (opts.hidden) slide.razzle = { ...(slide.razzle ?? {}), hidden: true }
  return withDeckLock(id, async () => {
    const d = await readDeck(id)
    if (!d) return { ok: false, error: 'no such deck' }
    let at: number, frameId: string | undefined, warnings: string[] = []
    if (isDeckV2(d)) ({ slideIndex: at, frameId, warnings } = appendSlide(d, slide))
    else { if (d.slides.some(x => x.id === slide.id)) slide.id = newId(); at = d.slides.push(slide) - 1 }
    d.updatedAt = Date.now()
    await writeAtomic(deckFile(id), d)
    if (deck && deck.id === id) { deck = d; refreshFromDeck(); broadcastState() }
    broadcast({ t: 'deck-updated', deckId: id, updatedAt: d.updatedAt })
    return { ok: true, slideIndex: at, frameId, warnings: [...new Set(warnings)] }
  })
}

// ---------------------------------------------------------------- notes

const noteJobs = new Map<string, Promise<Deck>>()
const noteStatus = new Map<string, { t: 'notes-status', deckId: string, status: 'writing' | 'saved' | 'error', message: string }>()
function publishNotes(id: string, status: 'writing' | 'saved' | 'error', message: string) {
  const event = { t: 'notes-status' as const, deckId: id, status, message }
  noteStatus.set(id, event)
  broadcast(event)
}

function generateNotes(id: string, workflow?: Workflow): Promise<Deck> {
  const previous = noteJobs.get(id) ?? Promise.resolve()
  const job = previous.catch(() => {}).then(async () => {
    publishNotes(id, 'writing', 'Processing draft notes and rehearsal timing…')
    try {
      const result = await writeNotes(id, workflow)
      publishNotes(id, 'saved', 'Draft notes and rehearsal timing saved')
      return result
    } catch (e) {
      publishNotes(id, 'error', 'Recording saved. Notes failed: ' + (e as Error).message)
      throw e
    }
  })
  noteJobs.set(id, job)
  void job.finally(() => { if (noteJobs.get(id) === job) noteJobs.delete(id) }).catch(() => {})
  return job
}

async function writeNotes(id: string, workflow?: Workflow): Promise<Deck> {
  const d = await readDeck(id)
  if (!d) throw new Error('no such deck')
  const takes = await listTakes(id)
  const items = workflow === 'rehearse' ? [] : noteItems(d.slides, takes)
  const timing = deliveryPatches(d.slides, takes)
  if (!items.length && !timing.size) {
    if (!takes.some(t => t.endedAt && t.utterances.length)) throw new Error('No finished recording yet. Stop the run first.')
    return d
  }
  const out = items.length ? await codexJSON(NOTES_PROMPT + '\nDeck: ' + d.title + '\n' + JSON.stringify(items.map(({ baseline, takeIds, ...item }) => item)), NOTES_SCHEMA) : { slides: [] }
  const patches = notePatches(items, out)
  for (const [slideId, patch] of timing) patches.set(slideId, { ...patches.get(slideId), ...patch })
  return withDeckLock(id, async () => {
    const fresh = await readDeck(id)
    if (!fresh) throw new Error('deck was removed')
    // Typing in the speaker view while Codex runs must never be overwritten by its older snapshot.
    for (const item of items) {
      const s = fresh.slides.find(x => x.id === item.id)
      if (s && noteBaseline(s) !== item.baseline) throw new Error('Notes were edited while Codex was working. Your edits are kept; retry Notes to merge them.')
    }
    await writeAtomic(path.join(DECKS, id, 'notes-history', Date.now() + '-' + newId(4) + '.json'), {
      at: Date.now(), slides: fresh.slides.filter(s => patches.has(s.id)).map(s => ({ id: s.id, razzle: s.razzle, remark: s.remark })),
    })
    for (const s of fresh.slides) {
      const patch = patches.get(s.id)
      if (!patch) continue
      // Drop timing learned against an older script while this job was running.
      if (patch.delivery && JSON.stringify(s.razzle?.script) !== JSON.stringify(d.slides.find(x => x.id === s.id)?.razzle?.script)) delete patch.delivery
      if (isDeckV2(fresh)) updateSlideMeta(fresh, s.id, patch)
      else { if (patch.notes !== undefined) s.remark = patch.notes; s.razzle = { ...(s.razzle ?? {}), ...patch } }
    }
    if (isDeckV2(fresh)) fresh.slides = refreshSlides(fresh)
    fresh.updatedAt = Math.max(Date.now(), (fresh.updatedAt ?? 0) + 1)
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
  '.onnx': 'application/octet-stream',
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

async function serveShared(res: http.ServerResponse, rel: string) {
  const file = path.join(SHARED, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''))
  if (!file.startsWith(SHARED + path.sep)) { res.writeHead(403); res.end(); return }
  try {
    const data = await fsp.readFile(file)
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
    res.end(data)
  } catch { res.writeHead(404); res.end() }
}

// Speech-model files for the browser ASR (RAZZLE_MODELS_DIR; filled by server/fetch-models.sh).
// A missing file is a plain 404, so the studio falls back to the Hugging Face hub.
const missingModels = new Set<string>()
async function serveModel(req: http.IncomingMessage, res: http.ServerResponse, rel: string) {
  const file = path.join(MODELS_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''))
  if (!file.startsWith(MODELS_DIR + path.sep)) { res.writeHead(403); res.end(); return }
  const st = await fsp.stat(file).catch(() => null)
  if (!st?.isFile()) {
    if (!missingModels.has(rel)) { missingModels.add(rel); log(`models: ${rel} is not in ${MODELS_DIR} (the studio falls back to the hub; server/fetch-models.sh)`) }
    res.writeHead(404, { 'cache-control': 'no-store' }); res.end(); return
  }
  const type = MIME[path.extname(file)] ?? 'application/octet-stream'
  // no-store: the studio keeps the files in its own Cache Storage. (A cacheable response here lets
  // transformers.js's size probe, a GET it never reads, hold Chrome's cache lock on the file and
  // stall the real download for ~20 s.)
  res.writeHead(200, { 'content-type': type, 'content-length': st.size, 'cache-control': 'no-store', 'last-modified': st.mtime.toUTCString() })
  if (req.method === 'HEAD') { res.end(); return }
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res)
}

async function serveStatic(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://x')
  let rel = decodeURIComponent(url.pathname)
  // shared/ (library.tldraw.json, fonts) as the studio's dev server serves it
  if (rel.startsWith('/razzle-shared/')) return serveShared(res, rel.slice('/razzle-shared/'.length))
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
<h1>Razzle server</h1><p>The studio is not built yet (<code>${escapeHtml(path.relative(ROOT, DIST) || DIST)}</code> is missing: <code>cd tldraw/apps/razzle && npx vite build</code>).</p>
<p>API: <a href="/api/decks">/api/decks</a> · <a href="/api/state">/api/state</a></p></body>`)
  }
}

async function api(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const p = url.pathname.replace(/\/+$/, '')
  const m = req.method ?? 'GET'
  const deckMatch = p.match(/^\/api\/decks\/([^/]+)(?:\/(takes|notes|slides|speech))?$/)

  if (p === '/api/shares' && m === 'POST') {
    try { return json(res, 201, await publishShare(SHARES, await body(req))) }
    catch (e) { return json(res, 400, { error: (e as Error).message }) }
  }
  if (p === '/api/shares' && m === 'GET') return json(res, 200, await listShares(SHARES, url.searchParams.get('deck') ?? ''))
  const shareId = p.match(/^\/api\/shares\/([A-Za-z0-9_-]+)$/)?.[1]
  if (shareId && SHARE_ID.test(shareId) && m === 'DELETE') {
    await fsp.rm(path.join(SHARES, shareId), { recursive: true, force: true })
    return json(res, 200, { ok: true })
  }

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
      // A deck that carries `updatedAt` was edited from that version; refuse it if the stored
      // deck has moved on since (e.g. the director inserted a hidden slide), so the writer merges.
      const updatedAt = await withDeckLock(id, async () => {
        const cur = await readDeck(id)
        if (typeof d.updatedAt === 'number' && cur?.updatedAt && cur.updatedAt > d.updatedAt) return null
        const out = { width: 1000, height: 562.5, title: id, ...d, id, updatedAt: Math.max(Date.now(), (cur?.updatedAt ?? 0) + 1) }
        await writeAtomic(deckFile(id), out)
        if (state.deckId === id) { deck = out; stepOverrides.clear(); refreshFromDeck(); broadcastState() }
        return out.updatedAt
      })
      if (updatedAt === null) return json(res, 409, { error: 'deck changed since this version; reload and merge' })
      broadcast({ t: 'deck-updated', deckId: id, updatedAt })
      return json(res, 200, { ok: true, updatedAt })
    }
    if (sub === 'slides' && m === 'POST') {
      // add one slide authored as PPTist-style JSON (library refs allowed; see skills/razzle)
      const b = await body(req)
      const r = await addSlide(id, b?.slide, { hidden: !!b?.hidden })
      return r.ok ? json(res, 200, r) : json(res, 400, { error: r.error })
    }
    if (sub === 'takes' && m === 'GET') return json(res, 200, await listTakes(id))
    if (sub === 'speech' && m === 'PATCH') {
      const b = await body(req)
      if (typeof b.slideId !== 'string' || typeof b.notes !== 'string' || typeof b.expectedNotes !== 'string' || b.notes.length > 100000) {
        return json(res, 400, { error: 'slideId, notes and expectedNotes are required' })
      }
      const result = await withDeckLock(id, async () => {
        const d = await readDeck(id)
        const s = d?.slides.find(s => s.id === b.slideId)
        if (!d || !s) return { code: 404, body: { error: 'no such slide' } }
        if ((s.razzle?.notes ?? s.remark ?? '') !== b.expectedNotes) return { code: 409, body: { error: 'Notes changed elsewhere. Your draft is kept; reload the notes before saving.' } }
        const patch = { notes: b.notes, notesEditedAt: Date.now() }
        if (isDeckV2(d)) { updateSlideMeta(d, s.id, patch); d.slides = refreshSlides(d) }
        else { s.remark = b.notes; s.razzle = { ...(s.razzle ?? {}), ...patch } }
        d.updatedAt = Math.max(Date.now(), (d.updatedAt ?? 0) + 1)
        await writeAtomic(deckFile(id), d)
        if (deck?.id === id) { deck = d; refreshFromDeck() }
        broadcast({ t: 'deck-updated', deckId: id, updatedAt: d.updatedAt })
        return { code: 200, body: d }
      })
      return json(res, result.code, result.body)
    }
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
    try { await setMode(b.mode, { auto: b.auto, deckId: b.deckId, workflow: b.workflow, recording: b.recording }) } catch (e) { return json(res, 400, { error: (e as Error).message }) }
    return json(res, 200, { ok: true, state })
  }
  if (p === '/api/redo' && m === 'POST') {
    const b = await body(req)
    const take = state.takeId ? openTakes.get(state.takeId) : null
    const slide = slides()[state.slideIndex]
    if (state.workflow !== 'draft' || !take || b.slideId !== slide?.id) return json(res, 409, { error: 'Start a draft on this slide before redoing its narration.' })
    ;(take.resets ??= []).push({ slideId: slide.id, at: Date.now() })
    if (AUDIO_SOURCE === 'local') audio.flush()
    broadcast({ t: 'redo', slideId: slide.id })
    nav({ action: 'goto', slide: state.slideIndex, step: 0, source: 'human' })
    await saveTake(take)
    return json(res, 200, { ok: true })
  }
  if (p === '/api/present' && m === 'POST') {
    const b = await body(req)
    const id = String(b.deckId ?? state.deckId ?? '')
    if (!validId(id) || !(await readDeck(id))) return json(res, 404, { error: 'no such deck' })
    await setMode('present', { deckId: id, workflow: b.workflow ?? 'present', recording: b.recording })
    if (typeof b.slide === 'number') {
      const moved = applyNav(state, slides() as any, { action: 'goto', slide: b.slide, source: 'human' }, clock, Date.now(), stepsAt)
      state = moved.state
    }
    broadcastState()
    const how = launchPresenter(id)
    return json(res, 200, { ok: true, launched: how, state })
  }
  if (p === '/api/library' && m === 'GET') {
    // ?format=tldraw: the studio's library (shapes); default: the PPTist library the director uses
    const file = url.searchParams.get('format') === 'tldraw' ? 'library.tldraw.json' : 'library.json'
    try { return json(res, 200, JSON.parse(await fsp.readFile(path.join(SHARED, file), 'utf8'))) } catch { return json(res, 200, []) }
  }
  if (p === '/api/debug' && m === 'GET') {
    const at = url.searchParams.get('arrival')
    return json(res, 200, { arrival: at ? audio.arrivalOf(Number(at)) : undefined, audioStartedAt, audioRunning: audio.running, clients: [...clients].map(c => c.role), whisper: { fast: audio.fast.port, final: audio.final.port }, audioSource: AUDIO_SOURCE, mic: { active: mic.active, holder: mic.holder?.role ?? null, claims: mic.claims } })
  }
  json(res, 404, { error: `no route ${m} ${p}` })
}

// Sign-in, on a hosted server only (RAZZLE_HTPASSWD; auth.ts)
const auth = process.env.RAZZLE_HTPASSWD
  ? createAuth({
    htpasswd: process.env.RAZZLE_HTPASSWD,
    secretFile: process.env.RAZZLE_SESSION_KEY_FILE ?? path.join(DECKS, '..', 'session.key'),
    cookiePath: process.env.RAZZLE_COOKIE_PATH ?? '/',
    internalToken: process.env.RAZZLE_INTERNAL_TOKEN,
  })
  : null

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  try {
    // Only published snapshots bypass sign-in; editing, discovery and AI remain private.
    const shared = url.pathname.match(/^\/api\/shared\/([A-Za-z0-9_-]+)$/)?.[1]
    if (shared && SHARE_ID.test(shared) && (req.method === 'GET' || req.method === 'HEAD')) {
      const file = path.join(SHARES, shared, 'deck.json')
      const data = await (req.method === 'HEAD' ? fsp.stat(file) : fsp.readFile(file)).catch(() => null)
      if (!data) return json(res, 404, { error: 'This presentation was removed or the link is incorrect.' })
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' })
      res.end(Buffer.isBuffer(data) ? data : undefined)
      return
    }
    if (auth && !await auth.gate(req, res, url.pathname)) return
    if (url.pathname.startsWith('/api/')) await api(req, res, url)
    else if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname.startsWith('/models/')) await serveModel(req, res, decodeURIComponent(url.pathname.slice('/models/'.length)))
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
  if (auth && !auth.allowUpgrade(req)) { socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n'); return }
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
  let incoming = Promise.resolve()
  ws.on('message', raw => { incoming = incoming.then(async () => {
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
          if (c.deckId && noteStatus.has(c.deckId)) send(c, noteStatus.get(c.deckId))
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
          try { await setMode(msg.mode, { auto: msg.auto, deckId: msg.deckId, workflow: msg.workflow, recording: msg.recording }) } catch (e) { send(c, { t: 'error', message: (e as Error).message }) }
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
        case 'mic':
          micClaim(c, !!msg.on)
          break
        case 'asr':
          micAsr(c, msg)
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
  }) })
  ws.on('close', () => {
    clients.delete(c)
    countScreens()
    if (mic.holder === c) {
      mic.release(c).ended.forEach(ingest)
      log(`mic: holder (${c.role}) disconnected`)
      setMicActive(false)
    }
    if (c.role === 'director' && ![...clients].some(x => x.role === 'director')) {
      log('director disconnected')
      setAgent('offline')
    }
    if (c.role === 'speaker') {
      const session = sessionNumber
      setTimeout(() => {
        if (session === sessionNumber && state.mode === 'present' && ![...clients].some(x => x.role === 'speaker')) {
          void setMode('idle').catch(e => log('presenter close:', e.message))
        }
      }, 5000).unref()
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
  log(`razzle server on http://localhost:${PORT} (decks: ${DECKS}, audio: ${AUDIO_SOURCE})`)
  if (process.env.RAZZLE_WARM === '1' && AUDIO_SOURCE === 'local') audio.warm().catch(e => log('warm failed:', e.message))
})
server.on('error', e => { console.error(`server: ${e.message}`); process.exit(1) })
