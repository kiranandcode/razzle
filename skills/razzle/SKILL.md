---
name: razzle
description: Make, edit, rehearse and present slide decks with Razzle (~/Documents/code/razzle), the WYSIWYG slide editor with a speech-driven presenter. Use when asked to start/open a presentation ("prezzi", deck, slides, talk), author slides in Kiran's style, record a rehearsal, generate speaker notes, present with the live agent, or run the director termling.
---

# Razzle

`~/Documents/code/razzle/bin/razzle` (add it to PATH or call it by path). The server
starts on demand at `http://localhost:7878`. Design and protocol: `docs/DESIGN.md`.

## Open a deck on the Cove board

```
razzle decks                 # list
razzle open <deck>           # editor tab in Vibefox, mirrored next to your termling
```

The user edits in that critter. Double-clicking the canvas background presents.

## Author or change a deck

Decks are PPTist JSON in `decks/<id>.json`, on a 1000 × 562.5 canvas.

```
razzle deck get <id> > /tmp/d.json      # edit, then
razzle deck put <id> < /tmp/d.json      # open editors reload
```

Before writing slides, read `shared/STYLE.md`. Build from `shared/library.json`: copy an
item's `elements`, offset `left`/`top`, and give every element a fresh `id` (and a fresh
shared `groupId` per group). Rules:

- Few words. Put one cue glyph on screen per sentence of the talk, revealed one per build step.
- Builds use PPTist `animations` with `trigger: 'click'`. Every slide has `turningMode: 'no'`.
- Per-slide speech goes in `slide.razzle`: `script[step]` holds the line for each build step;
  `cues: [{id, phrase, action: 'next'|'step', atStep?}]` hold the transition words;
  `hidden: true` marks backup slides.

Check a deck by rendering it with `node shared/tools/render_preview.mjs`
(see its header for usage) and reading the PNG.

## Rehearse, then present

```
razzle record <deck>     # mic → whisper; every sentence is stored against its slide and step
razzle stop
razzle notes <deck>      # Claude turns the takes into speaker notes + per-step script
razzle present <deck> [slide]   # Razzle Presenter: audience on the projector, speaker view on the laptop
```

Run the live agent in its own termling next to the deck. It advances once a step's
script is covered, fires cue words, circles what the speaker refers to, and makes
hidden slides on request (speaker view `h`, then `g` to show one):

```
razzle director
```

In the speaker view, `a` toggles auto-advance, `b` blacks out the audience screen and
`?` lists the keys. The human can always press next. A press within 1.2 s of an agent
advance is treated as the same advance.

## Environment

`ANTHROPIC_API_KEY` (notes, judgements, hidden slides). `TYPESAFE_API_KEY` enables Jev
for the fast live judgements; without it Claude Haiku is used. `RAZZLE_MIC` selects the
avfoundation audio device (default 0).
