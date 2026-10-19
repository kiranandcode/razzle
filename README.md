# Razzle

A WYSIWYG slide editor with a speech-driven presenter.

- **Editor** (`editor/`): a fork of [PPTist](https://github.com/pipipi-pikachu/PPTist)
  (AGPL-3.0) with an English UI, the Razzle visual language as the default theme, a
  shape/diagram/cue-glyph library, hidden slides, and per-step speech scripts and cue words.
  It exports PPTX (which Google Slides imports) and reveal.js HTML.
- **Server** (`server/`): decks, presentation state, mic capture, local whisper
  transcription, record mode, cue words, speaker-note generation.
- **Director** (`server/director.ts`): the live agent. It advances once you've covered a
  slide, fires transition words, circles what you refer to, and makes hidden slides on request.
- **Presenter** (`presenter/`): a Swift app. It puts the audience view on the projector and
  the speaker view on the laptop.

Slides change instantly: there are no transitions, no vertical stacks and no corner navigator.

## Setup

```
cd editor && npm install && npx vite build     # the server serves editor/dist
cd ../server && npm install
cd ../presenter && ./build.sh                  # Razzle Presenter.app
```

Requirements: Node ≥ 23, `ffmpeg`, `whisper-server` (whisper.cpp) with the models named in
`docs/DESIGN.md`, and `ANTHROPIC_API_KEY`. `TYPESAFE_API_KEY` is optional; it enables Jev.

## Use

```
bin/razzle open demo          # editor on the Cove board (or --no-cove)
bin/razzle record demo        # rehearse: what you say is stored per slide and step
bin/razzle stop
bin/razzle notes demo         # speaker notes + per-step script from the rehearsal
bin/razzle present demo       # present
bin/razzle director           # the live agent, in its own termling
```

For editor development, run `npx vite` in `editor/` (port 5173, proxied to the server)
with `bin/razzle serve`.

Agents use `skills/razzle/SKILL.md`. The visual language is in `shared/STYLE.md`, and
the protocol and design are in `docs/DESIGN.md`.

Tests: `cd server && npm test` (unit + end-to-end with real whisper);
`node --experimental-strip-types editor/src/razzle/__tests__/steps.test.ts`.
