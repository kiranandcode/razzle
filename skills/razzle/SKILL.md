---
name: razzle
description: Make, edit, rehearse and present slide decks with Razzle (~/Documents/code/razzle), the tldraw-based slide editor with a speech-driven presenter. Use when asked to start/open a presentation ("prezzi", deck, slides, talk), author slides in Kiran's style, record a rehearsal, generate speaker notes, present with the live agent, or run the director termling.
---

# Razzle

`~/Documents/code/razzle/bin/razzle` (add it to PATH or call it by path). The server
starts on demand at `http://localhost:7878`. Design and protocol: `docs/DESIGN.md`.

## Open a deck on the Cove board

```
razzle decks                 # list
razzle open <deck>           # studio tab in Vibefox, mirrored next to your termling
```

The user edits in that critter. It is tldraw: slides are frames on one canvas. Double-clicking
empty canvas outside the slides presents.

## Author slides

Write one slide at a time as PPTist-style JSON on a 1000 × 562.5 canvas. The server converts it
to tldraw and appends it after the last slide:

```
razzle slide add <deck> [--hidden] < slide.json
```

```json
{"id": "locks", "elements": [
  {"type": "text", "id": "t", "left": 34, "top": 22, "width": 900, "height": 62, "rotate": 0,
   "content": "<p><span style=\"font-size: 35px;\">Locks and keys</span></p>",
   "defaultFontName": "Libre Baskerville", "defaultColor": "#000000", "lineHeight": 1.2},
  {"type": "library", "ref": "glyph-lock", "left": 300, "top": 250}
 ],
 "animations": [{"id": "a1", "elId": "t", "effect": "fadeIn", "type": "in", "duration": 0, "trigger": "click"}],
 "razzle": {"script": ["Line for step 0.", "Line for step 1."],
            "cues": [{"id": "c1", "phrase": "sinks", "action": "next"}]}}
```

Before writing slides, read `shared/STYLE.md`. Build from the library (`shared/library.json`;
refer to an item with `{"type": "library", "ref": <id>, "left", "top", "texts"?}`). Rules:

- Code goes in a code element, highlighted in the studio:
  `{"type": "code", "id", "left", "top", "width", "height", "rotate": 0, "code": "line 1\nline 2",
  "language": "c" | "python" | "lean" | "ocaml" | "js" | "ts" | "rust" | "bash" | "json" | "text",
  "size": 15, "background": true}`. It does not wrap; height = lines × size × 1.6 + 1.6 × size.
- Few words. Put one cue glyph on screen per sentence of the talk, revealed one per build step.
- Click-triggered animations become build steps. `razzle.script[step]` is the line for each step,
  `razzle.cues` are the transition words, and `hidden` marks backup slides.

Check the result: `razzle present <deck> <n>`, or validate it with
`tldraw/node_modules/.bin/tsx --tsconfig shared/tl/dev/tsconfig.json shared/tl/dev/validate.ts decks/<deck>.json`.
Whole decks (`razzle deck get/put`) are tldraw documents. Edit those only with care, and keep
`slides` consistent (the studio re-derives it on every save).

## Rehearse, then present

```
razzle record <deck>     # mic → whisper; every sentence is stored against its slide and step
razzle stop
razzle notes <deck>      # Claude turns the takes into speaker notes + per-step script
razzle present <deck> [slide]   # Razzle Presenter: audience on the projector, speaker view on the laptop
```

Run the live agent in its own termling next to the deck. It advances at the speaker's pause
once a step's line is said, fires cue words, circles what the speaker refers to, and makes
hidden slides on request (speaker view `h`, then `g` to show one):

```
razzle director
```

Slides change instantly; a click or →/Space advances, and right-click or ← goes back. In the
speaker view, `a` toggles auto-advance, `b` blacks out the audience screen and `?` lists the
keys. A human press within 1.2 s of an agent advance counts as the same advance.

## Environment

`ANTHROPIC_API_KEY` (notes, judgements, hidden slides). `TYPESAFE_API_KEY` enables Jev
for the fast live judgements; without it Claude Haiku is used. `RAZZLE_MIC` selects the
avfoundation audio device (default 0). With `RAZZLE_AUDIO=browser` the server has no mic: the
studio page that holds the mic (speaker view while presenting, studio while recording)
transcribes in the browser and sends the transcript.
