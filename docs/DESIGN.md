# Razzle design

Razzle is a WYSIWYG slide editor and a speech-driven presenter.

```
tldraw/      fork of tldraw (tldraw licence); apps/razzle is the studio: editing, audience view, speaker view, export
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

`http://localhost:7878`. Serves the built studio (`tldraw/apps/razzle/dist`, override `RAZZLE_STATIC`) at `/`, `shared/` at `/razzle-shared/`, the browser speech models (`RAZZLE_MODELS_DIR`, default `<repo>/models`) at `/models/`, the API at `/api`, and a WebSocket at `/ws`.

### HTTP

| method | path | body / result |
|---|---|---|
| GET | `/api/decks` | `[{id, title, updatedAt, slideCount}]` |
| GET | `/api/decks/:id` | `Deck` |
| PUT | `/api/decks/:id` | `Deck` → `{ok, updatedAt}`; broadcasts `deck-updated` |
| POST | `/api/decks/:id/slides` | `{slide, hidden?}`: append one slide written as PPTist-style JSON (library refs `{type:'library', ref, left, top, texts?}` allowed), converted to a tldraw frame in the next grid cell → `{slideIndex, frameId}` |
| GET | `/api/decks/:id/takes` | `[Take]` |
| POST | `/api/decks/:id/notes` | refine draft notes + `razzle.script` with Codex; save rehearsal transition examples; returns the new `Deck` |
| GET | `/api/state` | `PresState` |
| POST | `/api/nav` | `{action, slide?, step?, source}` (same as the `nav` message) → `{ok, accepted, reason?, state}` |
| POST | `/api/mode` | `{mode, auto?, deckId?}` → `{ok, state}` |
| POST | `/api/present` | `{deckId, slide?, workflow?, recording?}`: launches the presenter app (or opens browser windows) |
| GET | `/api/library` | `shared/library.json`; `?format=tldraw` gives `shared/library.tldraw.json` |
| GET | `/models/<repo>/<file>` | a browser speech-model file from `RAZZLE_MODELS_DIR`; 404 when absent (the studio then uses the hub) |

```ts
// Current decks: format 'razzle-tldraw/1' (see "Studio (tldraw)"): {id, title, format, width, height,
// document, slides: SlideIndex[], updatedAt}. Older PPTist decks are still read:
interface Deck {
  id: string
  title: string
  width: number            // canvas px, 1000
  height: number           // 562.5 for 16:9
  theme: SlideTheme        // PPTist
  slides: Slide[]          // PPTist Slide (github.com/pipipi-pikachu/PPTist, src/types/slides.ts), with an optional `razzle` field
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
{ t: 'mode', mode: 'idle' | 'record' | 'present', auto?: boolean, deckId?: string, workflow?: 'draft' | 'rehearse' | 'present', recording?: boolean }
{ t: 'steps', slideIndex: number, stepCount: number }            // optional: a screen's step count overrides the server's
{ t: 'request', kind: 'hidden-slide', prompt?: string }          // speaker's covert request (key `h` in speaker view)
{ t: 'highlight', slideIndex: number, elId?: string, rect?: [x, y, w, h], ms?: number }   // director → screens
{ t: 'agent', status: AgentStatus, message?: string }            // director → everyone (drives the orb)
{ t: 'insert-hidden', after: number, slide: Slide, prompt: string }  // director → server: add a generated hidden slide
{ t: 'mic', on: boolean }                                        // browser audio: take / let go of the mic (see "Audio")
{ t: 'asr', kind: 'segment-start' | 'partial' | 'pause' | 'final', segId: number | string, text?: string, t0?: number, t1?: number }
```

Server → client

```ts
{ t: 'state', state: PresState }
{ t: 'transcript', partial?: string, final?: Utterance, pause?: { text: string, slideIndex: number, step: number } }
{ t: 'agent', status: AgentStatus, message?: string }
{ t: 'highlight', ... }                       // relayed as sent
{ t: 'deck-updated', deckId: string, updatedAt: number }
{ t: 'hidden-ready', slideIndex: number, prompt: string }    // a generated hidden slide exists; speaker view offers it
{ t: 'error', message: string }               // to the sender of a rejected `mode` / `insert-hidden`
{ t: 'mic', held: boolean, message?: string } // browser audio: to a client that claimed or released the mic, or lost it to another
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
  mic: { source: 'local' | 'browser', active: boolean }   // RAZZLE_AUDIO, and whether speech is being captured now
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
  Cues fire only in the present workflow with `auto` on; a `step` cue with no steps left does nothing.

### Audio

Speech comes from one of two sources, chosen when the server starts (`RAZZLE_AUDIO`, shown to
screens as `state.mic.source`). Both produce the same events, which the server ingests on one path
(`ingest` in `server/server.ts`; the event list is in `server/mic.ts`):

| event | meaning | server |
|---|---|---|
| `segment-start` | speech began | tags the segment with the slide and step showing (and the take) |
| `partial` | newest text of the open segment | `transcript.partial`, cue matching |
| `late-partial` | text of a segment that has closed | cue matching |
| `pause` | the closed segment's fast text | `transcript.pause` (with `segId`), cue matching |
| `final` | the finished segment | `transcript.final` (an `Utterance` tagged from `segment-start`), cue matching, the take |

Segmentation is the same in both: energy VAD (adaptive noise floor), a segment opens after 60 ms
over the threshold with 200 ms of pre-roll and closes at ≥ 500 ms of silence or 12 s; segments
under 250 ms are dropped; a partial of the open window every ~600 ms.

**`local`** (the default). The server captures the default mic with
`ffmpeg -f avfoundation -i ":<RAZZLE_MIC or 0>" -ac 1 -ar 16000 -f s16le -`
whenever mode is `record` or `present`, and runs two `whisper-server` processes:

- fast: `ggml-base.en.bin`: partials of the open window, and the closed segment's `pause` text
  (~0.6 s after the pause, also fed to cue matching);
- final: `ggml-large-v3-turbo-q5_0.bin`: the `final` of each closed segment.

**`browser`**. No ffmpeg or whisper on the server (the hosted studio): a studio page transcribes
(`tldraw/apps/razzle/src/asr/`, private build only, loaded on demand) and sends what it hears.

- The page holding the mic sends `{t:'mic', on:true}`; the latest claim wins, the previous holder
  gets `{t:'mic', held:false}` and stops. `{t:'mic', on:false}` or disconnecting lets go. The
  audience view never claims; Record (studio) and presenting (speaker view) claim automatically,
  and the mic switch in the studio top bar and the speaker view does it by hand.
- It then sends `{t:'asr', kind, segId, text?, t0?, t1?}` per event above (no `late-partial`: a
  `partial` after its segment's `pause` is treated as one). Its `segId`s are its own; the server
  maps them to fresh numeric ids per claim, so they never collide across reconnects. `asr` from
  any other client is dropped, as are new segments while the mode is `idle` (segments already
  open may still finish, so a take gets its last sentence). Text is cleaned as whisper.cpp's is.
- In the page: `getUserMedia` (echo cancellation, noise suppression) → an AudioWorklet that
  downmixes and resamples to 16 kHz → the segmenter (`src/asr/segmenter.ts`, checked against the
  server's in `server/test/segmenter.test.ts`) → Whisper in a Web Worker (transformers.js, ONNX
  Runtime Web). One model does everything, so `final` repeats the `pause` text. A partial is
  skipped once the speaker has been quiet for 200 ms, so the pause does not queue behind it. With WebGPU:
  `whisper-base.en` (fp16 encoder where the GPU has f16 shaders, else fp32; 4-bit decoder),
  ~0.4 s a partial and ~0.6 s a pause on an M4. Without WebGPU: `whisper-tiny.en`, 8-bit, on
  the CPU, ~1.7 s a call (single-threaded: the page is not cross-origin isolated).
- Model files load from `/models/` (`server/fetch-models.sh` fills `RAZZLE_MODELS_DIR`), falling
  back to the Hugging Face hub per missing file; the browser keeps them in Cache Storage. The ONNX
  Runtime WebAssembly binary is an asset of the studio build. `localStorage['razzle-asr'] =
  '{"device":"wasm"}'` forces the CPU path (other knobs: `AsrOverrides` in `src/asr/worker.ts`).

In record mode every final utterance is appended to the current take.

Cue matching runs in the server on partials, pauses and finals: a cue whose phrase appears in
the newest words since the last nav fires its action with `source: 'cue'`.

## Director (the live agent)

`node server/director.ts` connects as `role: 'director'`. It can run in a Cove termling;
it prints a quiet log and reports status through `agent` messages (the orb).

Decisions run when the speaker pauses (a speech segment closed and the server sends
`{t:'transcript', segId, pause:{text, slideIndex, step}}` with the fast text, ~0.6 s after
the pause) and when a final utterance lands, never mid-sentence. Speech that began before
the last nav does not count toward the new position.

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
   `insert-hidden`. The server converts it (`shared/tl/convert.ts`) into a hidden frame in the
   backstage row below every slide (so it comes last in reading order) and broadcasts `hidden-ready`. The main flow is never interrupted: the slide only shows
   when the speaker jumps to it (speaker view key `g`, or saying so).

## Screens

- Audience (`/#/present?view=audience`): the slide, fullscreen, nothing else, plus the
  orb in a corner only when no speaker screen is connected.
- Speaker (`/#/present?view=speaker`): current + next slide, notes, script for the
  current step, live transcript, cue list, timer, orb, and the hidden slides list. With browser
  audio, a mic switch (off / loading with progress / listening with a level meter / error); it
  takes the mic while presenting. The studio's top bar has the same switch next to Record.
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

## Studio (tldraw)

`tldraw/apps/razzle` (React + the forked tldraw packages, compiled from source).
Dev: `cd tldraw/apps/razzle && npx vite` (port 5174, proxies `/api`, `/ws` and `/models` to the
server on `RAZZLE_PORT`, default 7878). The public build (`VITE_RAZZLE_PUBLIC=1`) resolves
`src/asr/` to a stub (`vite.config.ts`), so it carries no speech code.
Types: `../../node_modules/.bin/tsc -b` (TypeScript 7).

Model (`src/model/types.ts`, `src/model/slides.ts`):

- A deck is one tldraw document. Every `frame` at the root of the page is a slide,
  1000 × 562.5, ordered by reading position (top to bottom, then left to right).
  The frame's name is the slide title.
- `frame.meta.razzle: RazzleSlideMeta`: hidden, script per build step, cues, autoAdvance, generated.
- `shape.meta.build: {step, effect: 'appear' | 'fade' | 'disappear'}`; on a group it applies to
  all members. Step count = 1 + the highest `step` on the slide. `fade` is the "not yet" grey of the
  talks (opacity 0.22 before its step).
- Deck file (`decks/<id>.json`, `format: 'razzle-tldraw/1'`): `{id, title, format, width, height,
  document, slides, updatedAt}`. `document` is `getSnapshot(store).document` and is the source of
  truth; `slides: SlideIndex[]` is derived on every save (`buildSlideIndex`) for the server and
  director: per slide its frame id, title, razzle meta, stepCount, and every shape's text and box in
  slide coordinates. Director highlights name tldraw shape ids.
- Registered everywhere an editor is created (studio, screens, export): `src/shapes` (custom shape
  utils, incl. `razzle-path` for exact library shapes and `razzle-code` for highlighted code) and
  `src/theme` (Razzle palette and fonts:
  serif = Libre Baskerville, mono = Roboto Mono, sans = Inter).
- Screens render a slide with a read-only tldraw editor on the same document, camera fitted to the
  frame, with build opacities applied in memory (never saved).
- `razzle-code` (`src/shapes/RazzleCodeShapeUtil.tsx`): props `{w, h, code, language, size,
  background}`, Roboto Mono at line height 1.6, no wrapping (clipped to the box). Highlighting is
  Shiki core with the JavaScript regex engine; the core and each grammar are lazy chunks
  (`codeHighlight.ts`), and the canvas shows plain text until they load. `toSvg` draws the
  tokens as SVG text, so exports, thumbnails and reveal/PDF are highlighted; PPTX writes a native
  text box with one coloured run per token. The style panel's Code section sets language, size and
  background; double-click edits the source. A PPTist-side `{type: 'code', code, language, size,
  background?}` element (`shared/tools/kit.mjs` `code()`) converts to it.

## Narration workflow

The Present menu starts Draft, Rehearse, Present, or Present & record in the presenter app or this browser. The studio’s Draft button records while editing. Every presentation listens for speech; only Draft, Rehearse, and Present & record retain a take. Stopping or closing the speaker view ends the take.

- Draft keeps transcripts and uses Codex after stopping to refine speaker notes. Later corrections replace the corresponding passage; untouched material remains. Redo narration resets the current slide’s narration from that point. Earlier takes and note history remain on disk. A reset with no new speech leaves existing notes intact.
- Rehearse preserves notes and records manual next-step/slide transitions with stable slide IDs, speech examples and the pause before each click. Backtracking and silent clicks do not train transitions.
- Present uses Whisper transcripts and Jev (Haiku fallback) to judge completion against rehearsal endings. Filler or a pause alone is insufficient. Learned pauses account for transcription latency; resumed speech cancels a pending advance. Changed scripts or step counts invalidate their old examples. Without examples, script coverage remains the fallback. Manual navigation always takes priority.
- Present & record additionally saves the live transcript. It does not rewrite notes or train transitions.

POST /api/redo requires an active draft and {slideId} matching the current slide. Recording here means a saved transcript, not an audio/video file.
