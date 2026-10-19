// Presentation state machine: navigation over slides/build steps and the
// human/agent debounce rules from docs/DESIGN.md. Pure: no I/O, time is passed in.

export type NavSource = 'human' | 'agent' | 'cue'
export type NavAction = 'next' | 'prev' | 'goto'
export type Mode = 'idle' | 'record' | 'present'
export type AgentStatus = 'offline' | 'listening' | 'thinking' | 'acting' | 'ready'

export interface PresState {
  deckId: string | null
  slideIndex: number
  step: number
  stepCount: number
  mode: Mode
  auto: boolean
  agent: AgentStatus
  takeId: string | null
  lastNav: { at: number, source: NavSource, action: string } | null
  /** Text of the director's latest `agent` message, so late joiners see it. */
  agentMessage: string
  /** Connected screens by role; the audience shows the orb when no speaker screen is up. */
  screens: { audience: number, speaker: number }
  /** Audience screen blacked out (`b` in either view). */
  black: boolean
}

export interface NavRequest { action: NavAction, slide?: number, step?: number, source: NavSource }

// Minimal structural view of a PPTist slide that navigation needs.
export interface NavSlide {
  id: string
  elements?: { id: string }[]
  animations?: { elId: string, trigger: string }[]
  razzle?: { hidden?: boolean }
}

export const DEBOUNCE = {
  agentAfterHumanMs: 2500, // agent/cue nav dropped within this of a human nav
  humanNextAfterAgentMs: 1200, // human next dropped within this of an agent/cue next
  agentMinIntervalMs: 1500, // at most one agent/cue nav per this interval
}

export function initialState(): PresState {
  return {
    deckId: null, slideIndex: 0, step: 0, stepCount: 1, mode: 'idle', auto: true,
    agent: 'offline', takeId: null, lastNav: null,
    agentMessage: '', screens: { audience: 0, speaker: 0 }, black: false,
  }
}

/** Build steps of a slide: 1 + the number of click-triggered animation groups
 *  (mirrors PPTist's `formatedAnimations`: a group starts at each `click`, and a
 *  leading non-click group plays automatically, so it is not a step). */
export function stepCountOf(slide: NavSlide | undefined): number {
  if (!slide?.animations?.length) return 1
  const ids = new Set((slide.elements ?? []).map(e => e.id))
  let clicks = 0
  for (const a of slide.animations) if (ids.has(a.elId) && a.trigger === 'click') clicks++
  return 1 + clicks
}

/** Timing memory that the debounce rules consult. */
export interface NavClock {
  lastHumanAt: number | null // any human nav attempt, accepted or not: the human is driving
  lastAgentAt: number | null // last accepted agent/cue nav of any action
  lastAgentNextAt: number | null // last accepted agent/cue `next`
}

export function newClock(): NavClock {
  return { lastHumanAt: null, lastAgentAt: null, lastAgentNextAt: null }
}

export type NavResult =
  | { accepted: true, state: PresState }
  | { accepted: false, reason: string, state: PresState }

/** Apply the debounce rules only. Returns a drop reason or null. Updates the clock for human attempts. */
export function debounce(req: NavRequest, clock: NavClock, now: number): string | null {
  if (req.source === 'human') {
    const drop = req.action === 'next' && clock.lastAgentNextAt !== null &&
      now - clock.lastAgentNextAt < DEBOUNCE.humanNextAfterAgentMs
    clock.lastHumanAt = now
    return drop ? 'human next duplicates a recent agent advance' : null
  }
  if (clock.lastHumanAt !== null && now - clock.lastHumanAt < DEBOUNCE.agentAfterHumanMs) {
    return 'human is driving'
  }
  if (clock.lastAgentAt !== null && now - clock.lastAgentAt < DEBOUNCE.agentMinIntervalMs) {
    return 'agent rate limit'
  }
  return null
}

function nextVisible(slides: NavSlide[], from: number, dir: 1 | -1): number {
  for (let i = from + dir; i >= 0 && i < slides.length; i += dir) {
    if (!slides[i]?.razzle?.hidden) return i
  }
  return -1
}

/** Move within the deck (no debounce). Returns null when the move goes nowhere. */
export function move(state: PresState, slides: NavSlide[], req: NavRequest,
  stepCounts: (i: number) => number = i => stepCountOf(slides[i])): PresState | null {
  const n = slides.length
  if (n === 0) return null
  let { slideIndex, step } = state
  const cur = Math.min(Math.max(slideIndex, 0), n - 1)
  if (req.action === 'next') {
    if (step < stepCounts(cur) - 1) { slideIndex = cur; step = step + 1 }
    else {
      const i = nextVisible(slides, cur, 1)
      if (i < 0) return null
      slideIndex = i; step = 0
    }
  } else if (req.action === 'prev') {
    if (step > 0) { slideIndex = cur; step = step - 1 }
    else {
      const i = nextVisible(slides, cur, -1)
      if (i < 0) return null
      slideIndex = i; step = stepCounts(i) - 1
    }
  } else {
    if (typeof req.slide !== 'number' || !Number.isFinite(req.slide)) return null
    slideIndex = Math.min(Math.max(Math.trunc(req.slide), 0), n - 1)
    const sc = stepCounts(slideIndex)
    step = Math.min(Math.max(Math.trunc(req.step ?? 0), 0), sc - 1)
  }
  return { ...state, slideIndex, step, stepCount: stepCounts(slideIndex) }
}

/** Debounce, then move. On acceptance the clock and `lastNav` advance. */
export function applyNav(state: PresState, slides: NavSlide[], req: NavRequest, clock: NavClock,
  now: number, stepCounts?: (i: number) => number): NavResult {
  const reason = debounce(req, clock, now)
  if (reason) return { accepted: false, reason, state }
  const moved = move(state, slides, req, stepCounts)
  if (!moved) return { accepted: false, reason: 'no move (deck edge or bad target)', state }
  if (req.source !== 'human') {
    clock.lastAgentAt = now
    if (req.action === 'next') clock.lastAgentNextAt = now
  }
  return { accepted: true, state: { ...moved, lastNav: { at: now, source: req.source, action: req.action } } }
}
