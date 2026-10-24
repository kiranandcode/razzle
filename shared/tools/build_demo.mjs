#!/usr/bin/env node
// Builds shared/tools/demo.pptist.json (PPTist) and decks/demo.json (the same deck converted to
// the tldraw v2 format by shared/tl/convert.ts): slides recreated from the TEE and "Who watches the watchers" talks
// in the Razzle visual language, with click builds, a cue-glyph slide, and a hidden slide.
//   node shared/tools/build_demo.mjs
import { writeFileSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  P, F, T, L, scope, nid, text, run, para, line, box, agent, humanNode, network, polygonPoints, EDGES, FADE_NODE,
  highlightRegion, docFrame, bubble, pendingBox, title, annotation, move, normalise, group, code, codeLineRect, codeBackground,
} from './kit.mjs'
import { GLYPHS } from './glyphs.mjs'
import { convertDeck } from '../tl/convert.ts'

const here = dirname(fileURLToPath(import.meta.url))
const themes = JSON.parse(readFileSync(resolve(here, '../themes.json'), 'utf8'))

// ---------------------------------------------------------------- slide builder

function slide(id) {
  scope(id)
  const s = { id, els: [], anims: [], razzle: {} }
  s.add = (...els) => { s.els.push(...els.flat()); return els.flat() }
  // One build step: entries are [elements, 'in' | 'out'].
  s.step = (...entries) => {
    let first = true
    for (const [els, kind] of entries) for (const e of els.flat()) {
      s.anims.push({ id: nid().replace(/-(\d+)$/, '-a$1'), elId: e.id, effect: kind === 'out' ? 'fadeOut' : 'fadeIn', type: kind === 'out' ? 'out' : 'in', duration: 300, trigger: first ? 'click' : 'meantime' })
      first = false
    }
  }
  s.done = () => {
    const out = { id: s.id, elements: s.els, background: { type: 'solid', color: '#ffffff' }, animations: s.anims, turningMode: 'no' }
    if (Object.keys(s.razzle).length) out.razzle = s.razzle
    return out
  }
  return s
}

const TITLE_Y = 48
const ttl = (t) => title({ t, y: TITLE_Y })
const label = (x, y, w, t, o = {}) => text({ x, y, w, lines: [t], size: o.size || T.small, color: o.color || P.body, align: o.align || 'center', lh: 1.25, italic: o.italic })
// place a ready-made group at (x,y)
const at = (els, x, y) => move(normalise(els), x, y)

const slides = []

// ---------------------------------------------------------------- 1. title

{
  const s = slide('title')
  const pts = polygonPoints(6, 230, 285, 150)
  s.add(network({ points: pts, edges: EDGES.tee(), size: 52 }).els)
  s.add(text({ x: 450, y: 170, w: 520, lines: ['Trust Everything', 'Everywhere'], size: T.hero, color: P.ink, align: 'center', lh: 1.2 }))
  s.add(text({ x: 450, y: 300, w: 520, lines: ['A Razzle demo deck'], size: 18, color: P.body, align: 'center' }))
  s.add(text({ x: 450, y: 350, w: 520, lines: ['Basis Research Institute', 'Kiran Gopinathan'], size: 14, color: P.body, align: 'center', lh: 1.4 }))
  slides.push(s.done())
}

// ---------------------------------------------------------------- 2. vision (network + ad-hoc protocols)

{
  const s = slide('vision')
  s.add(ttl('Vision'))
  // legend
  s.add(agent({ x: 63, y: 188, size: 88, color: P.teal }), label(48, 268, 118, 'Agent', { size: 19 }))
  s.add(agent({ x: 76, y: 348, size: 62, color: P.orange }), label(48, 412, 118, 'Human', { size: 19 }))
  const pts = polygonPoints(6, 500, 300, 165)
  // faded copy underneath, full network on top
  s.add(network({ points: pts, edges: EDGES.tee(), size: 72, fade: true }).els)
  const region = s.add(highlightRegion({ x: 280, y: 152, w: 445, h: 98 }))
  const full = network({ points: pts, edges: EDGES.tee(), size: 72 })
  s.add(full.els)
  const pairEdge = s.add(line(pts[5], pts[1], { color: P.body, width: 2.5 }))
  const pair = s.add(humanNode({ x: pts[5][0] - 36, y: pts[5][1] - 37, size: 72 }), humanNode({ x: pts[1][0] - 36, y: pts[1][1] - 37, size: 72 }))
  const note = s.add(annotation({ x: 690, y: 88, w: 270, t: 'Ad-hoc protocols', color: P.blue, size: T.annot, align: 'right' }))
  s.add(text({ x: 740, y: 470, w: 250, lines: ['A marketplace of', 'autonomous agents'], size: 19, color: P.body, align: 'center', lh: 1.25 }))
  // step 0: the marketplace; step 1: everything but one pair fades, the pair's protocol is highlighted
  s.step([full.els, 'out'], [region, 'in'], [pairEdge, 'in'], [pair, 'in'], [note, 'in'])
  s.razzle.script = [
    'Our vision is a marketplace of autonomous agents, each acting for a person.',
    'Today, any two of them that want to cooperate have to invent an ad-hoc protocol.',
  ]
  slides.push(s.done())
}

// ---------------------------------------------------------------- 3. examples of protocols (faded list build)

{
  const s = slide('protocols')
  s.add(ttl('Examples of protocols between agents'))
  const pts = polygonPoints(6, 244, 316, 136)
  s.add(network({ points: pts, edges: EDGES.tee(), size: 58, fade: true }).els)

  const items = ['Schedule a meeting', 'Bartering cost of an item', 'Making an insurance claim', 'Negotiating refund for a good', 'Organising a joint purchase']
  const listX = 488, listY = 118, dy = 60
  const itemText = (t, i, color) => text({ x: listX, y: listY + i * dy, w: 480, lines: [`-    ${t}`], size: T.body, color })
  items.forEach((t, i) => s.add(itemText(t, i, P.faded)))

  // one "scene" per item: its dark list item, its parties in full colour, their edges, labels, a note
  const node = (i) => humanNode({ x: pts[i][0] - 29, y: pts[i][1] - 30, size: 58 })
  const scene = (i, parties, edges, labels, note) => {
    const els = []
    els.push(itemText(items[i], i, P.body))
    for (const [a, b] of edges) els.push(line(pts[a], pts[b], { color: P.body, width: 2 }))
    for (const p of parties) els.push(...node(p))
    for (const [x, y, t, al, w] of labels) els.push(label(x, y, w || 160, t, { size: 17, align: al || 'center' }))
    if (note) els.push(...annotation({ x: note[0], y: note[1], w: 200, t: note[2], color: P.blue, size: 15 }))
    return s.add(els)
  }
  const s1 = scene(0, [0, 1], [[0, 1]], [[110, 128, 'Alex'], [282, 180, 'Kiran']], [300, 132, 'Private calendars'])
  const s2 = scene(1, [5, 1], [[5, 1]], [[46, 180, 'Vendor'], [282, 180, 'Kiran']], [20, 140, 'Conflicting objectives'])
  const s3 = scene(2, [4, 2, 1], [[4, 1], [4, 2], [1, 2]], [[-24, 296, 'Insurance Company', 'right', 126], [282, 180, 'Kiran'], [258, 316, 'Hospital']], [20, 420, 'Sensitive information'])
  const s3note = s3.slice(-1)
  const s1note = s1.slice(-1)
  // step 0 shows scene 1 without its note
  s.step([s1note, 'in'])
  s.step([s1, 'out'], [s2, 'in'])
  s.step([s2, 'out'], [s3.slice(0, -1), 'in'])
  s.step([s3note, 'in'])
  // scene 1 (minus its note) is visible from step 0: drop the "in" entries that would hide it
  s.anims = s.anims.filter(a => !(a.type === 'in' && s1.slice(0, -1).some(e => e.id === a.elId)))
  s.razzle.script = [
    'Take scheduling a meeting between Alex and me.',
    'Our calendars are private, so neither agent can just read the other one.',
    'Bartering with a vendor: our objectives conflict.',
    'An insurance claim involves three parties, the insurer, the hospital and me,',
    'and the information they exchange is sensitive.',
  ]
  slides.push(s.done())
}

// ---------------------------------------------------------------- 4. a three step recipe (steps + bubbles)

{
  const s = slide('recipe')
  s.add(ttl('A three step recipe for coordination'))
  const steps = ['1. Protocol Synthesis', '2. Projection', '3. Execution']
  const ys = [156, 283, 410]
  const stepText = (t, i, color) => text({ x: 79, y: ys[i], w: 340, lines: [{ t, bold: true }], size: T.step, color })
  steps.forEach((t, i) => s.add(stepText(t, i, i === 0 ? P.ink : P.faded)))
  const dark2 = s.add(stepText(steps[1], 1, P.ink)), dark3 = s.add(stepText(steps[2], 2, P.ink))

  s.add(agent({ x: 556, y: 180, size: 58, color: P.teal }), agent({ x: 860, y: 182, size: 58, color: P.blue }))
  const msgs = [['Thursday?', P.bubbleTeal, 'left'], ['9:00am?', P.bubbleBlue, 'right'], ['20 minutes?', P.bubbleTeal, 'left'], ['ok!', P.bubbleBlue, 'right']]
  const bubbles = msgs.map(([t, f, tail], i) => s.add(bubble({ x: 636, y: 116 + i * 44, w: 176, h: 36, label: t, fill: f, tail })))

  const proj = s.add(
    bubble({ x: 488, y: 330, w: 176, h: 31, label: 'Propose day', size: 13 }),
    pendingBox({ x: 488, y: 368, label: '[Wait for start time]' }),
    pendingBox({ x: 691, y: 330, label: '[Wait for day]' }),
    bubble({ x: 691, y: 362, w: 176, h: 31, label: 'Propose time', fill: P.bubbleBlue, tail: 'right', size: 13 }),
  )
  const exec = s.add(agent({ x: 410, y: 395, size: 58, color: P.teal }), agent({ x: 893, y: 388, size: 58, color: P.blue }))

  s.step([bubbles[0], 'in'])
  s.step([bubbles[1], 'in'])
  s.step([bubbles[2], 'in'], [bubbles[3], 'in'])
  s.step([dark2, 'in'], [proj, 'in'])
  s.step([dark3, 'in'], [exec, 'in'])
  s.razzle.script = [
    'Here is how humans coordinate, as a three step recipe. First, protocol synthesis: two parties agree on how to talk.',
    'One proposes Thursday,',
    'the other asks for nine,',
    'twenty minutes, and they settle.',
    'Second, projection: each party gets its own local part of the protocol.',
    'Third, execution: each agent runs its part, and together they coordinate.',
  ]
  s.razzle.cues = [
    { id: 'recipe-cue-1', phrase: 'projection', action: 'step', atStep: 3 },
    { id: 'recipe-cue-2', phrase: 'execution', action: 'step', atStep: 4 },
  ]
  slides.push(s.done())
}

// ---------------------------------------------------------------- 5. who watches the watchers (layer stack + boundary)

{
  const s = slide('watchers')
  s.add(ttl('Who watches the watchers?'))
  const lab = (t) => t
  s.add(box({ x: 229, y: 129, w: 542, h: 61, fill: P.tealLayer, label: lab('Lean-Zip'), size: T.label }))
  const verified = s.add(annotation({ x: 220, y: 196, w: 560, t: 'Formally verified. But what are we trusting?', color: P.stat, size: 19 }))
  const lower = s.add(
    box({ x: 229, y: 260, w: 542, h: 61, label: 'Macro Expander', size: T.label }),
    box({ x: 229, y: 349, w: 542, h: 61, label: 'Elaborator', size: T.label }),
    box({ x: 229, y: 437, w: 293, h: 61, label: 'Kernel', size: T.label }),
    box({ x: 549, y: 437, w: 222, h: 61, label: 'Runtime', size: T.label }),
  )
  const bound = s.add(
    line([78, 232], [922, 232], { color: P.body, width: 3, dash: true }),
    text({ x: 660, y: 180, w: 262, lines: [{ t: 'Proof boundary', italic: true }], size: T.annot, color: P.body, align: 'right', lh: 1.3 }),
    line([198, 269], [198, 489], { color: P.bug, width: 3.5 }),
    text({ x: 52, y: 330, w: 130, lines: ['Trusted', 'Computing', 'Base'], italic: true, size: 18, color: P.body, align: 'center', lh: 1.25 }),
  )
  const kernel = s.add(box({ x: 229, y: 437, w: 293, h: 61, fill: P.blue, label: 'Kernel', size: T.label }))
  const runtime = s.add(box({ x: 549, y: 437, w: 222, h: 61, fill: P.runtime, label: 'Runtime', size: T.label }))
  const bug = s.add(annotation({ x: 600, y: 504, w: 290, t: 'There was a bug!', color: P.bug, size: T.annot, align: 'right' }))

  s.step([verified, 'out'], [lower, 'in'])
  s.step([bound, 'in'])
  s.step([kernel, 'in'])
  s.step([runtime, 'in'], [bug, 'in'])
  s.razzle.script = [
    'Lean-Zip is formally verified. But what are we trusting?',
    'The proof is checked by Lean: a macro expander, an elaborator, a kernel and a runtime.',
    'Everything below this line is outside the proof: the trusted computing base.',
    'The kernel is small and has been studied hard.',
    'The runtime is not. And there was a bug.',
  ]
  slides.push(s.done())
}

// ---------------------------------------------------------------- 6. fuzzing results (doc frame + big numbers)

{
  const s = slide('fuzzing')
  s.add(ttl('Fuzzing Setup'))
  s.add(at(docFrame({ w: 224, h: 109 }), 326, 126))
  // the fuzzer crab glyph, scaled up
  const crab = GLYPHS.find(g => g.id === 'crab').draw()
  for (const e of crab) { e.left = e.left * 1.05; e.top = e.top * 1.05; e.width *= 1.05; e.height *= 1.05 }
  s.add(at(crab, 598, 152))
  const n = s.add(text({ x: 250, y: 285, w: 500, lines: ['105,823,818'], size: T.stat, color: P.stat, align: 'center', lh: 1.2 }))
  const sub = s.add(text({ x: 250, y: 360, w: 500, lines: ['fuzzing executions over 19 hours'], size: T.sub, color: P.body, align: 'center' }))
  const bugs = s.add(text({ x: 250, y: 425, w: 500, lines: ['2 bugs found'], size: T.stat, color: P.bug, align: 'center', lh: 1.2 }))
  s.step([n, 'in'], [sub, 'in'])
  s.step([bugs, 'in'])
  s.razzle.script = [
    'We pointed a fuzzer at Lean-Zip.',
    'A hundred and five million executions over nineteen hours,',
    'and two bugs.',
  ]
  slides.push(s.done())
}

// ---------------------------------------------------------------- 7. the Lean pipeline

{
  const s = slide('pipeline')
  s.add(ttl('The Lean Pipeline'))
  const st = [['Source', 36, 101, P.stageGray], ['Parser', 226, 102, P.stageTeal], ['Expander', 417, 124, P.stageTeal], ['Elaborator', 630, 123, P.stageTeal], ['Kernel', 842, 125, P.stageBlue]]
  st.forEach(([t, x, w, fill], i) => {
    s.add(box({ x, y: 169, w, h: 62, fill, label: t, size: 17 }))
    if (i < st.length - 1) s.add(line([x + w, 200], [st[i + 1][1], 200], { color: P.body, width: 2.5, arrow: 'end' }))
  })
  const rt = s.add(box({ x: 226, y: 293, w: 741, h: 61, fill: P.stagePink, label: 'C++ Runtime', size: 17 }))
  const note = s.add(annotation({ x: 37, y: 400, w: 420, t: 'Each stage is an attack surface.', color: P.body, size: T.body }))
  const drop = (x, what) => [
    line([x, 231], [x, 392], { color: P.body, width: 1.5, dash: true }),
    line([x, 440], [x, 478], { color: P.body, width: 1.5, dash: true }),
    text({ x: x - 100, y: 476, w: 200, lines: ['Bug here ⇒', { t: what, color: P.bug }], size: 19, color: P.body, align: 'center', lh: 1.25 }),
  ]
  const d1 = s.add(drop(277, 'wrong program')), d2 = s.add(drop(479, 'wrong expansion'))
  s.step([rt, 'in'])
  s.step([note, 'in'])
  s.step([d1, 'in'])
  s.step([d2, 'in'])
  slides.push(s.done())
}

// ---------------------------------------------------------------- 8. cue glyphs: a glyph per sentence

{
  const s = slide('glyphs')
  s.add(ttl('Why verified systems still sink'))
  const picks = [['network', 'distributed'], ['lock', 'private'], ['scale', 'trade-off'], ['bug', 'a bug'], ['boat-sinking', 'sinks']]
  const groups = picks.map(([id, word], i) => {
    const g = at(GLYPHS.find(x => x.id === id).draw(), 0, 0)
    // scale 80 -> 112
    for (const e of g) {
      const k = 1.4
      e.left *= k; e.top *= k
      if (e.type === 'line') { e.start = e.start.map(v => v * k); e.end = e.end.map(v => v * k); if (e.curve) e.curve = e.curve.map(v => v * k); if (e.cubic) e.cubic = e.cubic.map(p => p.map(v => v * k)); e.width *= 1.2 }
      else { e.width *= k; e.height *= k; if (e.outline) e.outline.width = Math.min(3, e.outline.width * 1.2) }
    }
    const x = 70 + i * 182
    move(g, x, 236)
    if (g.length > 1) group(g)
    const cap = label(x - 24, 366, 160, word, { size: 20, italic: true })
    return s.add(g, cap)
  })
  groups.slice(1).forEach(g => s.step([g, 'in']))
  s.razzle.script = [
    'A modern system is distributed,',
    'it holds private data,',
    'and every design is a trade-off.',
    'Verification shrinks the space for bugs,',
    'but one bug outside the proof and the whole thing sinks.',
  ]
  s.razzle.cues = [
    { id: 'glyphs-cue-1', phrase: 'private', action: 'step', atStep: 0 },
    { id: 'glyphs-cue-2', phrase: 'trade-off', action: 'step', atStep: 1 },
    { id: 'glyphs-cue-3', phrase: 'bugs', action: 'step', atStep: 2 },
    { id: 'glyphs-cue-4', phrase: 'outside the proof', action: 'step', atStep: 3 },
    { id: 'glyphs-cue-5', phrase: 'sinks', action: 'next', atStep: 4 },
  ]
  slides.push(s.done())
}

// ---------------------------------------------------------------- 9. hidden backup slide

{
  const s = slide('backup-overflow')
  s.add(ttl('Heap buffer overflow in the Lean runtime'))
  const [src] = s.add(code({
    x: 200, y: 128, w: 600, language: 'c', background: false,
    lines: [
      '// src/include/lean/lean.h',
      'static inline lean_obj_res lean_alloc_sarray(',
      '    unsigned elem_size, size_t size, size_t capacity) {',
      '  lean_sarray_object * o = (lean_sarray_object*)',
      '    lean_alloc_object(sizeof(lean_sarray_object)',
      '                      + elem_size * capacity);',
      '  ...',
      '}',
    ],
  }))
  // the faulty line on a dark-red band, behind the code
  s.els.splice(s.els.indexOf(src), 0, codeBackground(src), codeLineRect(src, 5))
  s.add(annotation({ x: 340, y: 372, w: 460, t: 'integer overflow when capacity is near SIZE_MAX', color: P.bug, size: 17, align: 'right' }))
  s.add(text({ x: 190, y: 440, w: 560, lines: ['Affects every version of Lean 4.'], size: 20, color: P.body }))
  s.razzle.hidden = true
  s.razzle.script = ['If anyone asks: the overflow is in the allocation size computation for scalar arrays.']
  slides.push(s.done())
}

// ---------------------------------------------------------------- write

const deck = {
  id: 'demo',
  title: 'Razzle demo: Trust Everything Everywhere',
  width: L.W,
  height: L.H,
  theme: themes.find(t => t.id === 'razzle').theme,
  slides,
}
// the PPTist original (render_preview.mjs, parity checks) and the studio deck (tldraw v2)
writeFileSync(resolve(here, 'demo.pptist.json'), JSON.stringify(deck, null, 1) + '\n')
const v2 = convertDeck({ ...deck, updatedAt: 0 })
delete v2.warnings
v2.updatedAt = Date.now()
writeFileSync(resolve(here, '../../decks/demo.json'), JSON.stringify(v2, null, 1) + '\n')
console.log('shared/tools/demo.pptist.json + decks/demo.json (v2):', slides.length, 'slides;', slides.map(s => `${s.id}(${new Set(s.animations.filter(a => a.trigger === 'click').map(a => a.id)).size} steps)`).join(' '))
void nid; void FADE_NODE
