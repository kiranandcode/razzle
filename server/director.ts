// The Razzle director: the live agent. Connects to the server's /ws as `director`,
// listens to the transcript, and decides, one line of log per decision:
//   coverage  -> nav next (source 'agent') when the step's script has been said
//   intent    -> next / back / show_hidden / make_hidden
//   highlight -> an element of the current slide the speaker refers to
//   hidden    -> a new hidden slide (Opus) on request or make_hidden intent
//
//   node director.ts [--url http://localhost:7878] [--dry]
//
// Decks: Razzle v2 (tldraw document + `slides` index: element ids are tldraw shape ids, so a
// highlight names a shape) or PPTist. Hidden slides are written as PPTist JSON either way; the
// server converts them into a new frame of a v2 deck.
//
// Judgements use Jev when TYPESAFE_API_KEY is set, else Claude Haiku. All LLM calls are
// async and latest-wins: a newer utterance or a slide change aborts the older call.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { claudeJSON, hasClaude, hasJev, jev, noulYes, MODELS } from './llm.ts'
import { tokens } from './cues.ts'
import { elementText, entryLabels, expandLibraryRefs, freshIds, libraryEntries, slideText, validateSlide, type Json, type LibraryEntry } from './slides.ts'
import { move, type PresState, type AgentStatus } from './state.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SHARED = path.join(HERE, '..', 'shared')
const args = process.argv.slice(2)
const argVal = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined }
const BASE = (argVal('--url') ?? process.env.RAZZLE_URL ?? `http://127.0.0.1:${process.env.RAZZLE_PORT ?? 7878}`).replace(/\/$/, '')
// a hosted server with sign-in lets same-box processes through with this token (auth.ts)
const AUTH: Record<string, string> = process.env.RAZZLE_INTERNAL_TOKEN ? { authorization: `Bearer ${process.env.RAZZLE_INTERNAL_TOKEN}` } : {}
const DRY = args.includes('--dry')

const TUNING = {
  coveredLocal: 0.75, // token overlap at which the step counts as covered without asking a model
  coveredAtPause: 0.6, // the same, when the speaker has just paused (a sentence boundary)
  movedOn: 0.6, // overlap of the latest utterance with the NEXT position's script that means the speaker moved on
  askModelAbove: 0.3, // below this the step is clearly not covered yet
  intentConfidence: { next: 0.8, back: 0.8, show_hidden: 0.75, make_hidden: 0.7 },
  targetConfidence: 0.5, // Jev's confidence needed to circle the element it picked
  highlightMs: 2600,
  highlightRepeatMs: 8000,
  makeHiddenRepeatMs: 60000,
}

// ---------------------------------------------------------------- log

const tty = process.stdout.isTTY
const col = (n: number) => (s: string) => (tty ? `\x1b[${n}m${s}\x1b[0m` : s)
const dim = col(2), green = col(32), yellow = col(33), red = col(31), cyan = col(36), magenta = col(35)
function line(tag: string, msg: string) {
  const t = new Date().toTimeString().slice(0, 8)
  console.log(`${dim(t)}  ${tag}  ${msg}`)
}
const short = (s: string, n = 70) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

// ---------------------------------------------------------------- state

let ws: WebSocket | null = null
let state: PresState | null = null
let deck: Json | null = null
let heard = '' // finals since the last nav
let navKey = '' // identifies the current slide/step + last nav, so stale results are dropped
let judge: AbortController | null = null
const recent: { at: number, text: string }[] = [] // finals, for hidden-slide context
const lastHighlight = new Map<string, number>()
let lastMakeHidden = 0

const slide = (): Json | undefined => deck?.slides?.[state?.slideIndex ?? -1]
/** The script line for the position `next` would move to. */
function nextScript(): string | undefined {
  if (!state || !deck?.slides) return undefined
  const to = move(state, deck.slides, { action: 'next', source: 'agent' })
  return to ? deck.slides[to.slideIndex]?.razzle?.script?.[to.step] : undefined
}

function keyOf(s: PresState | null) { return s ? `${s.deckId}|${s.slideIndex}|${s.step}|${s.lastNav?.at ?? 0}` : '' }

// ---------------------------------------------------------------- status (the orb)

let inflight = 0
let actingUntil = 0
let readyUntil = 0
let reported: AgentStatus | null = null
function baseStatus(): AgentStatus { return state?.mode === 'present' ? 'listening' : 'ready' }
function refreshStatus(message?: string) {
  const now = Date.now()
  const s: AgentStatus = now < actingUntil ? 'acting' : inflight > 0 ? 'thinking' : now < readyUntil ? 'ready' : baseStatus()
  if (s !== reported || message) {
    reported = s
    sendWs({ t: 'agent', status: s, message })
  }
}
setInterval(() => refreshStatus(), 250).unref()
function acting() { actingUntil = Date.now() + 700; refreshStatus() }
async function thinking<T>(fn: () => Promise<T>): Promise<T> {
  inflight++; refreshStatus()
  try { return await fn() } finally { inflight--; refreshStatus() }
}

function sendWs(msg: unknown) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
}

// ---------------------------------------------------------------- server I/O

async function loadDeck(id: string | null) {
  if (!id) { deck = null; return }
  try {
    const r = await fetch(`${BASE}/api/decks/${encodeURIComponent(id)}`, { headers: AUTH })
    deck = r.ok ? await r.json() as Json : null
    if (deck) line(dim('deck'), `${deck.title ?? id} · ${deck.slides?.length ?? 0} slides`)
  } catch (e) { line(red('error'), `deck load: ${(e as Error).message}`) }
}

async function nav(action: 'next' | 'prev' | 'goto', why: string, slideIdx?: number) {
  if (DRY) { line(green('act  '), `${action}${slideIdx !== undefined ? ' ' + slideIdx : ''} ${dim('(dry run) ' + why)}`); return }
  acting()
  try {
    const r = await fetch(`${BASE}/api/nav`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...AUTH },
      body: JSON.stringify({ action, slide: slideIdx, source: 'agent' }),
    })
    const j = await r.json() as { accepted?: boolean, reason?: string, state?: PresState }
    if (j.accepted) line(green('act  '), `${action} → ${j.state?.slideIndex}.${j.state?.step}  ${dim(why)}`)
    else line(yellow('held '), `${action} not taken: ${j.reason}  ${dim(why)}`)
  } catch (e) { line(red('error'), `nav: ${(e as Error).message}`) }
}

// ---------------------------------------------------------------- coverage

const STOP = new Set(('a an the and or but so of to in on at for with by from as is are was were be been being it its this that these those ' +
  'i we you they he she my our your their me us them here there then than just very really also can could will would should ' +
  'do does did have has had not no yes if when what which who how why where all any some more most into over about up down out ' +
  'let lets say said like um uh okay ok well now going gonna want get got one two').split(' '))

function stem(w: string) { return w.replace(/(ing|ed|es|s)$/, '') || w }
function content(text: string) { return tokens(text).filter(w => w.length > 1 && !STOP.has(w)).map(stem) }

/** Fraction of the script's content words that have been said. */
export function coverage(script: string, said: string): number {
  const want = [...new Set(content(script))]
  if (!want.length) return 0
  const have = new Set(content(said))
  return want.filter(w => have.has(w)).length / want.length
}

// ---------------------------------------------------------------- highlight (local fast path)

const DEICTIC = /\b(this|these|here|that one|look at|notice|see the|over there|the (box|arrow|line|diagram|graph|chart|table|figure|picture|equation|bit|part))\b/i

function localHighlight(utterance: string): { elId: string, why: string } | null {
  const s = slide()
  if (!s || !DEICTIC.test(utterance)) return null
  const words = new Set(content(utterance).filter(w => w.length >= 4))
  const hits: { id: string, n: number }[] = []
  for (const el of s.elements ?? []) {
    const t = new Set(content(elementText(el)))
    const n = [...words].filter(w => t.has(w)).length
    if (n) hits.push({ id: el.id, n })
  }
  hits.sort((a, b) => b.n - a.n)
  if (hits.length === 1 || (hits.length > 1 && hits[0].n > hits[1].n)) return { elId: hits[0].id, why: 'word match' }
  return null
}

function highlight(elId: string, why: string) {
  const s = slide()
  if (!s || !state || !(s.elements ?? []).some((e: Json) => e.id === elId)) return
  const k = `${s.id}:${elId}`
  if (Date.now() - (lastHighlight.get(k) ?? 0) < TUNING.highlightRepeatMs) return
  lastHighlight.set(k, Date.now())
  const el = s.elements.find((e: Json) => e.id === elId)
  line(cyan('mark '), `“${short(elementText(el) || el.type, 40)}”  ${dim(why)}`)
  if (DRY) return
  acting()
  sendWs({ t: 'highlight', slideIndex: state.slideIndex, elId, ms: TUNING.highlightMs })
}

// ---------------------------------------------------------------- judgement (Jev or Haiku)

type Intent = 'continue' | 'next' | 'back' | 'show_hidden' | 'make_hidden'
interface Judgement { covered: boolean | null, intent: Intent, confidence: number, highlight: string | null, hiddenPrompt: string | null, via: string }

const INTENTS: Record<Intent, string> = {
  continue: 'keep talking about the current slide (the default)',
  next: 'the speaker wants the next slide now ("next slide", "moving on", "let\'s go on")',
  back: 'the speaker wants the previous slide ("go back", "as I showed before, back one")',
  show_hidden: 'the speaker wants to show a backup/hidden slide that already exists ("let me show you that slide", "I have a slide on that")',
  make_hidden: 'detail is wanted that no slide covers: the speaker offers to show more ("I can show you that on a slide"), or answers an audience question asking for detail',
}

function judgementContext(utterance: string) {
  const s = slide()!
  const step = state!.step
  const elements = (s.elements ?? []).map((e: Json) => ({ id: e.id, type: e.type, text: short(elementText(e), 120) })).filter((e: Json) => e.text || e.type !== 'text')
  const hidden = (deck?.slides ?? []).map((x: Json, i: number) => ({ i, x })).filter(({ x }: Json) => x.razzle?.hidden)
    .map(({ i, x }: Json) => ({ index: i, about: short(x.razzle?.generated?.prompt ?? slideText(x), 80) }))
  return {
    slide: { index: state!.slideIndex, step, steps: state!.stepCount, text: short(slideText(s), 800), script: s.razzle?.script?.[step] ?? null, elements },
    hiddenSlides: hidden,
    heardOnThisStep: short(heard, 1500),
    latest: utterance,
  }
}

async function judgeHaiku(utterance: string, wantCoverage: boolean, signal: AbortSignal): Promise<Judgement> {
  const ctx = judgementContext(utterance)
  const system = `You are the live director of a research talk. You read the speaker's words as they are transcribed and judge, for the latest utterance:
1. covered: ${wantCoverage ? 'has the speaker now said the substance of the script for the current build step (judge the gist: paraphrase and different wording count; covered once the main point has been made, even if minor words differ; if the speaker has moved on to new material, it is covered)?' : 'always null'}
2. intent: one of ${Object.entries(INTENTS).map(([k, v]) => `"${k}" = ${v}`).join('; ')}. Use "continue" unless the latest utterance clearly signals another intent.
3. confidence: 0..1 for the intent.
4. highlight: if the latest utterance refers to a specific element on the slide ("this box", "the kernel here"), its id from slide.elements; else null.
5. hiddenPrompt: when intent is make_hidden, one sentence describing what the new slide should show; else null.
Reply with JSON only: {"covered": true|false|null, "intent": "...", "confidence": 0.0, "highlight": "id"|null, "hiddenPrompt": "..."|null}`
  const schema = {
    type: 'object', additionalProperties: false, required: ['covered', 'intent', 'confidence', 'highlight', 'hiddenPrompt'],
    properties: {
      covered: { type: ['boolean', 'null'] },
      intent: { type: 'string', enum: Object.keys(INTENTS) },
      confidence: { type: 'number' },
      highlight: { type: ['string', 'null'] },
      hiddenPrompt: { type: ['string', 'null'] },
    },
  }
  const j = await claudeJSON<Json>({ model: MODELS.haiku, system, user: JSON.stringify(ctx, null, 1), schema, maxTokens: 300, signal })
  return {
    covered: typeof j.covered === 'boolean' ? j.covered : null,
    intent: (j.intent in INTENTS ? j.intent : 'continue') as Intent,
    confidence: Number(j.confidence) || 0,
    highlight: typeof j.highlight === 'string' ? j.highlight : null,
    hiddenPrompt: typeof j.hiddenPrompt === 'string' ? j.hiddenPrompt : null,
    via: 'haiku',
  }
}

async function judgeJev(utterance: string, wantCoverage: boolean, signal: AbortSignal): Promise<Judgement> {
  const ctx = judgementContext(utterance)
  const questions: Record<string, any> = {
    intent: {
      type: 'choice',
      instructions: 'What does the speaker want to happen, judging by the latest utterance? Default to continue.',
      criteria: INTENTS,
    },
  }
  if (wantCoverage) questions.covered = {
    type: 'noul',
    instructions: 'Has the speaker now said the substance of `slide.script` (the plan for the current build step), judging by `heardOnThisStep`? Paraphrase counts.',
    criteria: {
      true: 'every point of the script has been made, in any wording',
      false: 'some point of the script has not been said yet',
    },
  }
  // which element "this box here" means: a choice over the slide's elements, in the same call
  const targets = DEICTIC.test(utterance) ? ctx.slide.elements.filter((e: Json) => e.text).slice(0, 200) : []
  if (targets.length) questions.target = {
    type: 'choice',
    instructions: 'Which element of the slide is the speaker pointing at or naming in `latest`?',
    criteria: { none: 'no particular element', ...Object.fromEntries(targets.map((e: Json) => [e.id, `${e.type}: ${e.text}`])) },
  }
  const a = await jev(ctx, questions, signal)
  const intent = a.intent && a.intent.type === 'choice' && a.intent.choice in INTENTS ? a.intent.choice as Intent : 'continue'
  const conf = a.intent && a.intent.type === 'choice' ? (a.intent.confidence ?? a.intent.probabilities?.[intent] ?? 0) : 0
  const t = a.target && a.target.type === 'choice' ? a.target : null
  const hl = t && t.choice !== 'none' && (t.confidence ?? 0) >= TUNING.targetConfidence ? t.choice : null
  return {
    covered: a.covered ? noulYes((a.covered as any).noul) : null,
    intent, confidence: Number(conf) || 0, highlight: hl,
    hiddenPrompt: intent === 'make_hidden' ? `Detail for: ${utterance}` : null, via: 'jev',
  }
}

// ---------------------------------------------------------------- decisions

function autoAdvanceOn(): boolean {
  return Boolean(state?.auto && state.mode === 'present' && slide()?.razzle?.autoAdvance !== false)
}

/** Did this piece of speech begin at the position now showing? Speech that began
 *  before a nav belongs to the previous step and must not cover the new one. */
function atCurrent(p: { slideIndex: number, step: number }, segId: number) {
  if (ownedFrom !== null && segId >= ownedFrom) return true
  return !!state && p.slideIndex === state.slideIndex && p.step === state.step
}
// After the agent advances on speech segment N, segments after N belong to the new
// position even if they began before the slide changed (the judgement can lag the pause).
let advancingOn: number | null = null
let ownedFrom: number | null = null

// Coverage is judged only when the speaker pauses (the server closed a speech
// segment) or a final transcript lands, so the slide never moves mid-sentence.
async function decide(utterance: string, kind: 'pause' | 'final', segId: number) {
  if (!state || state.mode !== 'present' || !slide()) return
  const isFinal = kind === 'final'
  const s = slide()!
  const script: string | undefined = s.razzle?.script?.[state.step]
  const said = isFinal ? heard : `${heard} ${utterance}`
  const key = navKey

  // 1. coverage, local fast path; or the speaker has already started on the next position
  let wantCoverage = false
  if (script && autoAdvanceOn()) {
    const c = coverage(script, said)
    const ahead = nextScript()
    if (ahead && c >= TUNING.askModelAbove && coverage(ahead, utterance) >= TUNING.movedOn) {
      line(yellow('cover'), `${state.slideIndex}.${state.step} moved on ${dim(`next-script ${coverage(ahead, utterance).toFixed(2)}`)}`)
      judge?.abort()
      advancingOn = segId - 1 // this utterance belongs to the new position
      await nav('next', 'speaker moved on')
      return
    }
    if (c >= (isFinal ? TUNING.coveredLocal : TUNING.coveredAtPause)) {
      line(yellow('cover'), `${state.slideIndex}.${state.step} covered ${dim(`local ${c.toFixed(2)}`)}`)
      judge?.abort()
      advancingOn = segId
      await nav('next', 'script covered')
      return
    }
    wantCoverage = c >= TUNING.askModelAbove
  }

  // 2-3. local highlight
  if (isFinal) {
    const h = localHighlight(utterance)
    if (h) highlight(h.elId, h.why)
  }
  if (!isFinal && !wantCoverage) return
  if (!utterance.trim()) return
  if (!hasJev() && !hasClaude()) return

  // model judgement, latest-wins
  judge?.abort()
  const ac = new AbortController()
  judge = ac
  let j: Judgement
  try {
    j = await thinking(() => hasJev() ? judgeJev(utterance, wantCoverage, ac.signal) : judgeHaiku(utterance, wantCoverage, ac.signal))
  } catch (e) {
    if (!ac.signal.aborted) line(red('error'), `judge: ${short((e as Error).message, 100)}`)
    return
  } finally {
    if (judge === ac) judge = null
  }
  if (ac.signal.aborted || key !== navKey) return // superseded or the slide moved meanwhile

  if (wantCoverage && j.covered) {
    line(yellow('cover'), `${state.slideIndex}.${state.step} covered ${dim(j.via)}`)
    advancingOn = segId
    await nav('next', 'script covered')
    return
  }
  if (!isFinal) return
  if (j.highlight && DEICTIC.test(utterance)) highlight(j.highlight, j.via)
  const need = TUNING.intentConfidence[j.intent as Exclude<Intent, 'continue'>]
  if (j.intent === 'continue' || need === undefined) return
  if (j.confidence < need) { line(dim('think'), dim(`${j.intent}? ${j.confidence.toFixed(2)} < ${need} · “${short(utterance, 50)}”`)); return }
  line(magenta('want '), `${j.intent} ${dim(`${j.via} ${j.confidence.toFixed(2)} · “${short(utterance, 50)}”`)}`)
  switch (j.intent) {
    case 'next': if (state.auto) await nav('next', 'asked for next'); break
    case 'back': if (state.auto) await nav('prev', 'asked to go back'); break
    case 'show_hidden': {
      const i = findHidden()
      if (i >= 0) await nav('goto', 'show hidden slide', i)
      else line(dim('think'), dim('no hidden slide to show'))
      break
    }
    case 'make_hidden':
      if (Date.now() - lastMakeHidden < TUNING.makeHiddenRepeatMs) break
      lastMakeHidden = Date.now()
      void makeHidden(j.hiddenPrompt ?? utterance, 'intent')
      break
  }
}

/** The hidden slide to show: the one directly after the current slide (where insert-hidden
 *  puts new ones), else the most recently generated, else the first hidden slide. */
function findHidden(): number {
  const slides: Json[] = deck?.slides ?? []
  const cur = state?.slideIndex ?? 0
  if (slides[cur + 1]?.razzle?.hidden) return cur + 1
  let best = -1, at = -1
  slides.forEach((x, i) => { const g = x.razzle?.generated?.at ?? -1; if (x.razzle?.hidden && g > at) { best = i; at = g } })
  return best >= 0 ? best : slides.findIndex(x => x.razzle?.hidden)
}

// ---------------------------------------------------------------- hidden slides (Opus)

function readShared(name: string, max = 40000): string | null {
  try { const s = fs.readFileSync(path.join(SHARED, name), 'utf8'); return s.length > max ? s.slice(0, max) + '\n…(truncated)' : s } catch { return null }
}

function loadLibrary(): LibraryEntry[] {
  try { return libraryEntries(JSON.parse(fs.readFileSync(path.join(SHARED, 'library.json'), 'utf8'))) } catch { return [] }
}

/** The library as the model sees it: a catalogue (id, size, description, labels) plus a few
 *  entries in full as exemplars of the element JSON. */
function libraryPrompt(lib: LibraryEntry[]): string {
  if (!lib.length) return ''
  const cat = lib.map(e => `- ${e.id} [${e.category ?? ''}] ${Math.round(e.width ?? 0)}x${Math.round(e.height ?? 0)}: ${e.description ?? e.name ?? ''}` +
    (entryLabels(e).length ? ` · labels: ${entryLabels(e).map(l => JSON.stringify(short(l.replace(/\n/g, ' '), 30))).join(', ')}` : '')).join('\n')
  const pick = ['box-teal', 'arrow-right', 'annotation-blue', 'text-title', 'numbered-steps']
  const ex = lib.filter(e => pick.includes(e.id)).concat(lib.filter(e => !pick.includes(e.id)).slice(0, Math.max(0, 3 - pick.length)))
  return `

Library (shared/library.json): reusable pieces drawn in the deck's style. Place one with a pseudo-element
  {"type":"library","ref":"<id>","left":x,"top":y,"texts":["label 1","label 2",...]}
which expands to the entry's elements translated to (left, top) at their native size, with its text labels replaced in order (omit texts to keep them).
Prefer library pieces over hand-drawn shapes. You may also write raw elements copying their colours, fonts and outline conventions.
Catalogue:
${cat}

Exemplars (full JSON):
${ex.map(e => JSON.stringify(e)).join('\n')}`
}

/** The deck's theme for the prompt: a PPTist deck's own, else the Razzle theme (shared/themes.json). */
function deckTheme(): Json | undefined {
  if (deck?.theme) return deck.theme
  try { return JSON.parse(fs.readFileSync(path.join(SHARED, 'themes.json'), 'utf8')).find((t: Json) => t.id === 'razzle')?.theme } catch { return undefined }
}

/** The current slide for the prompt: PPTist JSON (as an exemplar), or for a v2 deck the
 *  slide index entry (title, step count and each element's text and box). */
function slideForPrompt(s: Json): Json {
  if (deck?.format === 'razzle-tldraw/1') {
    return { title: s?.title, steps: s?.stepCount, elements: (s?.elements ?? []).map((e: Json) => ({ type: e.type, text: e.text, box: [e.left, e.top, e.width, e.height].map((v: number) => Math.round(v)) })) }
  }
  return trimSlide(s)
}

function trimSlide(s: Json): Json {
  // drop large inline payloads (data: URLs) so the exemplar stays small
  return JSON.parse(JSON.stringify(s, (k, v) => (typeof v === 'string' && v.startsWith('data:') && v.length > 200 ? 'data:…' : v)))
}

let hiddenChain: Promise<void> = Promise.resolve()

function makeHidden(prompt: string, why: string): Promise<void> {
  hiddenChain = hiddenChain.then(() => makeHiddenNow(prompt, why)).catch(e => line(red('error'), `hidden: ${short((e as Error).message, 120)}`))
  return hiddenChain
}

async function makeHiddenNow(prompt: string, why: string) {
  if (!deck || !state) return
  if (!hasClaude()) { line(red('error'), 'hidden slide needs Claude (an API key or a logged-in claude CLI)'); return }
  const after = state.slideIndex
  const cur = deck.slides[after]
  const style = readShared('STYLE.md')
  const lib = loadLibrary()
  const talk = recent.filter(r => Date.now() - r.at < 120000).map(r => r.text).join(' ')
  line(magenta('make '), `hidden slide after ${after} ${dim(`(${why}) ${short(prompt, 60)}`)}`)
  const system = `You design one slide for a research talk, as PPTist slide JSON. The speaker will jump to it during the talk to answer a question in more depth, so it must be clear at a glance, correct, and in the same visual language as the rest of the deck.

Output: ONE JSON object, a PPTist Slide, and nothing else:
{"id": string, "elements": PPTElement[], "background"?: {"type":"solid","color":string}, "remark"?: string}
Canvas: ${deck.width ?? 1000} x ${deck.height ?? 562.5} px. Every element must lie inside the canvas.
Element shapes (all need id, left, top, width, height, rotate:0):
- text: {"type":"text","content":"<p>HTML</p>","defaultFontName":string,"defaultColor":string, "lineHeight"?:number, "fill"?:string}
  content is HTML: <p>, <span style="font-size: 28px; color: #...">, <strong>, <em>, <ul><li><p>…</p></li></ul>.
- shape: {"type":"shape","viewBox":[w,h],"path":"SVG path in viewBox units","fixedRatio":false,"fill":string, "outline"?:{"style":"solid","width":2,"color":string}, "text"?:{"content":"<p>..</p>","defaultFontName":string,"defaultColor":string,"align":"middle"}}
  e.g. a rectangle: "viewBox":[200,200],"path":"M 0 0 L 200 0 L 200 200 L 0 200 Z"
- line: {"type":"line","start":[x,y],"end":[x,y],"width":2,"style":"solid","color":string,"points":["","arrow"], plus left/top (origin) and width; no height/rotate}
  start/end are relative to (left, top).
- code: {"type":"code","code":"line 1\\nline 2","language":"c"|"python"|"lean"|"ocaml"|"js"|"ts"|"rust"|"bash"|"json"|"text","size":15} (a syntax-highlighted Roboto Mono block on #f3f3f3; height ≈ lines × size × 1.6 + 2 × 0.8 × size; it does not wrap)
- latex: avoid unless essential (needs a precomputed SVG path).
No images unless the library provides a usable src. No animations.
Prefer few, large elements: a title, then a diagram or 3-5 short points. Use the deck's fonts and colours.${style ? '\n\nThe Razzle visual style (shared/STYLE.md):\n' + style : ''}${libraryPrompt(lib)}`
  const user = JSON.stringify({
    request: prompt,
    whatTheSpeakerJustSaid: short(talk, 3000),
    deck: { title: deck.title, theme: deckTheme(), width: deck.width, height: deck.height },
    currentSlide: { index: after, text: slideText(cur), layout: slideForPrompt(cur) },
    neighbours: [deck.slides[after - 1], deck.slides[after + 1]].filter(Boolean).map((x: Json) => short(slideText(x), 300)),
  }, null, 1)

  const canvas = { width: deck.width ?? 1000, height: deck.height ?? 562.5 }
  let slideJson: Json | null = null
  let feedback = ''
  for (let attempt = 0; attempt < 2 && !slideJson; attempt++) {
    const t0 = Date.now()
    const out = await thinking(() => claudeJSON<Json>({
      model: MODELS.opus, system, user: user + feedback, maxTokens: 16000, stream: true, effort: 'medium',
    }))
    const raw = out && typeof out === 'object' && !Array.isArray(out) && (out as Json).slide ? (out as Json).slide : out
    const expanded = raw && Array.isArray((raw as Json).elements) ? expandLibraryRefs(raw as Json, lib) : { slide: raw as Json, errors: [] as string[] }
    const cand = expanded.slide
    const errs = [...expanded.errors, ...validateSlide(cand, canvas)]
    if (errs.length) {
      line(yellow('retry'), `hidden slide invalid (${errs.length}): ${short(errs[0], 80)}`)
      feedback = `\n\nYour previous slide JSON was invalid:\n- ${errs.slice(0, 12).join('\n- ')}\nReturn a corrected slide.`
      continue
    }
    line(dim('think'), dim(`opus drafted ${cand.elements.length} elements in ${((Date.now() - t0) / 1000).toFixed(1)} s`))
    slideJson = cand
  }
  if (!slideJson) { line(red('error'), 'hidden slide: no valid slide after 2 attempts'); return }
  const fresh = freshIds(slideJson)
  fresh.razzle = { hidden: true, generated: { by: 'director', prompt, at: Date.now() } }
  if (DRY) { line(green('act  '), `hidden slide ready ${dim('(dry run, not inserted)')}`); return }
  acting()
  readyUntil = Date.now() + 4000
  sendWs({ t: 'insert-hidden', after, slide: fresh, prompt })
  line(green('act  '), `hidden slide inserted after ${after}: ${short(slideText(fresh).replace(/\n/g, ' · '), 60)}`)
  refreshStatus('hidden slide ready')
}

// ---------------------------------------------------------------- wiring

async function onState(s: PresState) {
  const prev = state
  state = s
  if (!prev || prev.deckId !== s.deckId) await loadDeck(s.deckId)
  const k = keyOf(s)
  if (k !== navKey) {
    ownedFrom = s.lastNav?.source === 'agent' && advancingOn !== null ? advancingOn + 1 : null
    advancingOn = null
    navKey = k
    heard = ''
    judge?.abort()
    if (prev && (prev.slideIndex !== s.slideIndex || prev.step !== s.step)) {
      line(dim('slide'), dim(`${s.slideIndex}.${s.step}${s.lastNav ? ` by ${s.lastNav.source}` : ''}`))
    }
  }
  if (!prev || prev.mode !== s.mode || prev.auto !== s.auto) line(dim('mode '), `${s.mode}${s.mode === 'present' ? (s.auto ? ' · auto' : ' · manual') : ''}`)
  refreshStatus()
}

function onMessage(msg: Json) {
  switch (msg.t) {
    case 'state': void onState(msg.state); break
    case 'deck-updated': if (msg.deckId === state?.deckId) void loadDeck(msg.deckId); break
    case 'transcript':
      if (msg.final) {
        const text: string = msg.final.text
        recent.push({ at: Date.now(), text }); while (recent.length > 60) recent.shift()
        if (state?.mode === 'present') line(dim('heard'), dim(short(text, 90)))
        if (!atCurrent(msg.final, msg.segId ?? -1)) break
        heard = `${heard} ${text}`.trim()
        void decide(text, 'final', msg.segId ?? -1)
      } else if (msg.pause) {
        if (atCurrent(msg.pause, msg.segId ?? -1)) void decide(msg.pause.text ?? '', 'pause', msg.segId ?? -1)
      }
      break
    case 'request':
      if (msg.kind === 'hidden-slide') {
        const p = (msg.prompt as string | undefined)?.trim() || `Go deeper on what the speaker was just talking about: ${short(recent.slice(-4).map(r => r.text).join(' '), 400)}`
        void makeHidden(p, 'speaker request')
      }
      break
  }
}

let connectedOnce = false
let warned = false
function connect() {
  const url = BASE.replace(/^http/, 'ws') + '/ws'
  const sock = new WebSocket(url, { headers: AUTH })
  sock.on('open', () => {
    ws = sock; reported = null; warned = false
    sock.send(JSON.stringify({ t: 'hello', role: 'director' }))
    line(green('on   '), `connected to ${BASE} · judge: ${hasJev() ? 'jev' : hasClaude() ? 'haiku' : 'none (local only)'}${DRY ? ' · dry run' : ''}`)
    connectedOnce = true
    refreshStatus()
  })
  sock.on('message', d => { try { onMessage(JSON.parse(d.toString())) } catch (e) { line(red('error'), (e as Error).message) } })
  sock.on('close', () => {
    if (ws === sock) { ws = null; if (connectedOnce) line(yellow('off  '), 'server connection lost, retrying') }
    setTimeout(connect, 2000)
  })
  sock.on('error', () => { if (!warned && !connectedOnce) { warned = true; line(yellow('wait '), `no server at ${BASE} yet`) } })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  connect()
  const bye = () => { sendWs({ t: 'agent', status: 'offline' }); setTimeout(() => process.exit(0), 50) }
  process.on('SIGINT', bye)
  process.on('SIGTERM', bye)
}
