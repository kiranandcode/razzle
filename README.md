# Razzle

A slide editor built on tldraw, with a speech-driven presenter.

- **Studio** (`tldraw/apps/razzle`): the editor, on a fork of [tldraw](https://github.com/tldraw/tldraw)
  (`tldraw/`, tldraw licence). Slides are frames on one canvas, edited with tldraw's own
  controls. The Razzle palette and fonts (Libre Baskerville, Roboto Mono, Inter) are in the style
  panel. It has a slides panel, a library of diagram pieces and cue glyphs, build steps
  (appear / fade / disappear), and per-step speech scripts and cue words. It exports PPTX
  (which Google Slides imports), reveal.js HTML and PDF.
- **Screens** (same app): the audience and speaker views. Slides change instantly on a click or a
  key; there are no transitions.
- **Server** (`server/`): decks, presentation state, mic capture, local whisper transcription,
  record mode, cue words, speaker-note generation.
- **Director** (`server/director.ts`): the live agent. It advances at your pause once you've said a
  step's line, fires transition words, circles what you refer to, and makes hidden slides on request.
- **Presenter** (`presenter/`): a Swift app that puts the audience view on the projector and
  the speaker view on the laptop.
- `editor/` is the earlier PPTist-based editor, kept for reference.

## Setup

```
cd tldraw && npx -y pnpm@12.4.2 install --ignore-scripts && npx -y pnpm@12.4.2 refresh-assets
cd apps/razzle && npx vite build           # the server serves this build
cd ../../../server && npm install
cd ../presenter && ./build.sh              # Razzle Presenter.app
```

Requirements: Node ≥ 23, `ffmpeg`, `whisper-server` (whisper.cpp) with the models named in
`docs/DESIGN.md`, and `ANTHROPIC_API_KEY`. `TYPESAFE_API_KEY` is optional; it enables Jev.
Without a tldraw licence key, tldraw shows a small "Get a license for production" mark.

## Use

```
bin/razzle open demo          # studio on the Cove board (or --no-cove)
bin/razzle record demo        # rehearse: what you say is stored per slide and step
bin/razzle stop
bin/razzle notes demo         # speaker notes + per-step script from the rehearsal
bin/razzle present demo       # present
bin/razzle director           # the live agent, in its own termling
bin/razzle slide add demo < slide.json   # append a slide (how agents author)
```

Studio development: `cd tldraw/apps/razzle && npx vite` (port 5174, proxied to the server) with
`bin/razzle serve`. Types: `../../node_modules/.bin/tsc -b`.

Agents use `skills/razzle/SKILL.md`. The visual language is in `shared/STYLE.md`, and
the protocol and design are in `docs/DESIGN.md`.

Tests:
- `cd server && npm test`: unit tests, plus end to end with real whisper.
- `npm run test:director`: the director, against real models.
- `tldraw/node_modules/.bin/tsx --tsconfig shared/tl/dev/tsconfig.json shared/tl/dev/validate.ts decks/demo.json`:
  checks a deck against tldraw's schema.

## Licences

`tldraw/` is a fork of tldraw and stays under the tldraw licence (`tldraw/LICENSE.md`); a
production deployment needs a tldraw licence key. `editor/` is a fork of PPTist and stays under
AGPL-3.0 (`editor/LICENSE`). The example talks the style was derived from are not in the repository.
