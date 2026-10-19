# Razzle design

Razzle is a WYSIWYG slide editor and a speech-driven presenter.

```
editor/      fork of PPTist (Vue 3 + TS, AGPL-3.0): editing, audience view, speaker view
server/      Node (>= 23, runs .ts directly): decks, presentation state, mic + whisper, record mode
director/    (inside server/) the live agent: reads the transcript, moves slides, highlights, makes hidden slides
presenter/   Swift app: one WKWebView per screen (audience fullscreen on the external display, speaker on the laptop)
shared/      library.json (shape/diagram library), STYLE.md (visual language)
decks/       <deckId>.json  (+ <deckId>/takes/*.json recordings)
```

## Presenting model

- No slide transitions. A slide or build step replaces the previous one instantly
  (the editor's default `turningMode` is `'no'`; transitions stay available but are opt-in).
- Linear only: next / prev / goto. No vertical stacks, no overview grid, no corner navigator.
- Build steps: step 0 is the slide as it first appears; each click-triggered
  animation group is one more step. "next" plays the next step, or moves to the
  next non-hidden slide when the steps run out.
- Hidden slides (`slide.razzle.hidden`) are skipped by next/prev and reached by goto.

## Server

`http://localhost:7878`. Serves the built editor at `/`, the API at `/api`, and a WebSocket at `/ws`.

### HTTP

| method | path | body / result |
|---|---|---|
| GET | `/api/decks` | `[{id, title, updatedAt, slideCount}]` |
| GET | `/api/decks/:id` | `Deck` |
| PUT | `/api/decks/:id` | `Deck` → `{ok, updatedAt}`; broadcasts `deck-updated` |
| GET | `/api/decks/:id/takes` | `[Take]` |
| POST | `/api/decks/:id/notes` | generate speaker notes + `razzle.script` from the takes (Claude); returns the new `Deck` |
| GET | `/api/state` | `PresState` |
| POST | `/api/nav` | `{action, slide?, step?, source}` (same as the `nav` message) → `{ok, accepted, reason?, state}` |
| POST | `/api/mode` | `{mode, auto?, deckId?}` → `{ok, state}` |
| POST | `/api/present` | `{deckId, slide?}`: launches the presenter app (or opens browser windows) |
| GET | `/api/library` | contents of `shared/library.json` |

```ts
interface Deck {
  id: string
  title: string
  width: number            // canvas px, 1000 by default (PPTist viewport)
  height: number           // 562.5 for 16:9
  theme: SlideTheme        // PPTist
  slides: Slide[]          // PPTist Slide, with the optional `razzle` field (editor/src/types/slides.ts)
  updatedAt?: number
}

interface Utterance { text: string, t0: number, t1: number, slideId: string, slideIndex: number, step: number }
interface Take { id: string, deckId: string, startedAt: number, endedAt?: number, utterances: Utterance[] }
```

### WebSocket `/ws`

Every message is one JSON object with a `t` field. The first client message is `hello`.

Client → server

```ts
{ t: 'hello', role: 'editor' | 'audience' | 'speaker' | 'director' | 'cli', deckId?: string }
{ t: 'nav', action: 'next' | 'prev' | 'goto', slide?: number, step?: number, source: 'human' | 'agent' | 'cue' }
{ t: 'mode', mode: 'idle' | 'record' | 'present', auto?: boolean, deckId?: string }
{ t: 'steps', slideIndex: number, stepCount: number }            // optional: a screen's step count overrides the server's
{ t: 'request', kind: 'hidden-slide', prompt?: string }          // speaker's covert request (key `h` in speaker view)
{ t: 'highlight', slideIndex: number, elId?: string, rect?: [x, y, w, h], ms?: number }   // director → screens
{ t: 'agent', status: AgentStatus, message?: string }            // director → everyone (drives the orb)
{ t: 'insert-hidden', after: number, slide: Slide, prompt: string }  // director → server: add a generated hidden slide
```

Server → client

```ts
{ t: 'state', state: PresState }
{ t: 'transcript', partial?: string, final?: Utterance }
{ t: 'agent', status: AgentStatus, message?: string }
{ t: 'highlight', ... }                       // relayed as sent
{ t: 'deck-updated', deckId: string, updatedAt: number }
{ t: 'hidden-ready', slideIndex: number, prompt: string }    // a generated hidden slide exists; speaker view offers it
{ t: 'error', message: string }               // to the sender of a rejected `mode` / `insert-hidden`
```

```ts
type AgentStatus = 'offline' | 'listening' | 'thinking' | 'acting' | 'ready'
// offline: no director; listening: presenting, nothing in flight; thinking: a model call is running;
// acting: just sent a nav/highlight/insert; ready: connected while idle/recording, or briefly after a hidden slide lands
interface PresState {
  deckId: string | null
  slideIndex: number
  step: number
  stepCount: number           // build steps on the current slide, computed by the server from the deck (optional client override: {t:'steps', slideIndex, stepCount})
  mode: 'idle' | 'record' | 'present'
  auto: boolean               // agent may advance
  agent: AgentStatus
  takeId: string | null
  lastNav: { at: number, source: 'human' | 'agent' | 'cue', action: string } | null
}
```

The server is authoritative for `slideIndex`/`step`. Screens render the state they
receive; they never advance on their own. The speaker view and the audience view
send `nav` with `source: 'human'` for keyboard/clicker input.

### Debouncing human and agent navigation

- An agent or cue `nav` within 2500 ms of a human `nav` is dropped (the human is driving).
- A human `next` within 1200 ms of an agent/cue `next` is dropped (the human pressed
  for the same transition the agent already made). `prev` is never dropped.
- At most one agent/cue advance per 1500 ms.
- Agent `next`/`prev` need `auto`; agent `goto` (showing a hidden slide the speaker asked for) does not.
  Cues fire in record and present mode whether or not `auto` is on; a `step` cue with no steps left does nothing.

### Audio

The server captures the default mic with
`ffmpeg -f avfoundation -i ":<RAZZLE_MIC or 0>" -ac 1 -ar 16000 -f s16le -`
whenever mode is `record` or `present`, and runs two `whisper-server` processes:

- fast: `ggml-base.en.bin`: every ~600 ms transcribes the open (unfinalised) window → `transcript.partial`
  and feeds the cue matcher (trigger words fire within ~1 s);
- final: `ggml-large-v3-turbo-q5_0.bin`: when energy-VAD sees ≥ 500 ms of silence (or the
  window passes 12 s) the segment is finalised → `transcript.final` (an `Utterance` tagged
  with the slide and step that were showing when it began).

In record mode every final utterance is appended to the current take.

Cue matching runs in the server on partials and finals: a cue whose phrase appears in
the newest words since the last nav fires its action with `source: 'cue'`.

## Director (the live agent)

`node server/director.ts` connects as `role: 'director'`. It can run in a Cove termling;
it prints a quiet log and reports status through `agent` messages (the orb).

Each final utterance (and a throttled partial) drives one decision:

1. Coverage: has the speaker covered this step's `script` entry? Fast path is local
   (token overlap with the script). The judgement uses Jev (`TYPESAFE_API_KEY`,
   `POST https://api.typesafe.ai/v1/systemone`, a `noul` + a `choice` in one call) when
   available, else Claude Haiku. Covered + auto → `nav next` with `source: 'agent'`.
2. Intent: a `choice` over `{continue, next, back, show_hidden, make_hidden}`: the
   speaker saying "I can show you that on a hidden slide" or answering an audience
   question that asks for detail.
3. Highlight: when the speaker refers to an element ("this box here", "the kernel"), Haiku
   picks the element id from the slide's text content → `highlight`.
4. Hidden slides: on `request` (speaker key `h`) or a `make_hidden` intent, Claude
   (Opus) writes one PPTist slide in the Razzle style using `shared/library.json`, sent as
   `insert-hidden`. The server inserts it after the current slide with `razzle.hidden = true`
   and broadcasts `hidden-ready`. The main flow is never interrupted: the slide only shows
   when the speaker jumps to it (speaker view key `g`, or saying so).

## Screens

- Audience (`/#/present?view=audience`): the slide, fullscreen, nothing else, plus the
  orb in a corner only when no speaker screen is connected.
- Speaker (`/#/present?view=speaker`): current + next slide, notes, script for the
  current step, live transcript, cue list, timer, orb, and the hidden slides list.
- The orb: a ~10 px softly glowing dot. Colour/pulse follows `AgentStatus`. Visible if
  you look for it, not otherwise.
- Highlight: an animated hand-drawn-style ellipse drawn around the element, fading out.

## Presenter app (Swift)

`presenter/` builds `Razzle Presenter.app`. Args: `--url http://localhost:7878 --deck <id>`.
With two or more screens: the audience view is fullscreen on the first non-main screen and
the speaker view is on the main screen. With one screen: the audience view is fullscreen.
`Esc` exits. The server's `/api/present` launches it.

## Cove

`razzle open <deck>` starts the server if needed and opens the editor in Vibefox, then
sends the tab to the Cove board (a page critter). Double-clicking the slide canvas
outside edit mode calls `/api/present`. `razzle director` is meant to run in its own
termling next to the page critter.
