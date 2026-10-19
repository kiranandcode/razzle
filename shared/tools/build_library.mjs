#!/usr/bin/env node
// Builds shared/library.json (the Razzle shape/diagram library) and shared/themes.json.
//   node shared/tools/build_library.mjs
import { writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  P, B, F, T, scope, group, normalise, text, run, para, shape, rect, circle, line, box, layerStack, pipeline,
  agent, humanNode, network, polygonPoints, EDGES, dashedFrame, highlightRegion, docFrame, docPage, boundary, bracket,
  bubble, pendingBox, title, annotation, stat, code, shapeText, FADE_NODE,
} from './kit.mjs'
import { GLYPHS } from './glyphs.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const items = []

function add(id, name, category, description, build) {
  scope(id)
  const els = build()
  if (els.length > 1) group(els)
  normalise(els)
  items.push({ id, name, category, description, elements: els })
}

const label = (x, y, w, t, o = {}) => text({ x, y, w, lines: [t], size: o.size || T.small + 2, color: o.color || P.body, align: 'center', italic: o.italic, font: o.font })

// ---------------------------------------------------------------- agents

for (const [c, nm, col] of [['teal', 'Agent (teal)', P.teal], ['blue', 'Agent (blue)', P.blue], ['orange', 'Human (orange)', P.orange]]) {
  add(`agent-${c}`, nm, 'agents', `Filled triangle with a 2px black outline. ${c === 'orange' ? 'A person.' : 'An autonomous agent.'} Label below in body gray.`, () => [
    ...agent({ x: 10, y: 0, size: 60, color: col }),
    label(0, 56, 80, c === 'orange' ? 'Human' : 'Agent'),
  ])
}
add('agent-teal-bare', 'Agent triangle (no label)', 'agents', 'One teal agent, 50px wide. Recolour fill to P.blue for the counterpart.', () => agent({ size: 50 }))
add('human-node', 'Human with agent', 'agents', 'Teal triangle with an orange triangle inside: a person represented by their agent. The node of the TEE marketplace network.', () => humanNode({ size: 50 }))
add('human-node-faded', 'Human with agent (faded)', 'agents', 'Low-contrast node for parties not yet in focus; place the full node on top and fade it in.', () => humanNode({ size: 50, ...FADE_NODE }))
add('agent-legend', 'Legend: agent / human', 'agents', 'Vertical legend from the TEE vision slide.', () => [
  ...agent({ x: 10, y: 0, size: 70, color: P.teal }), label(0, 66, 90, 'Agent'),
  ...agent({ x: 22, y: 128, size: 46, color: P.orange }), label(0, 172, 90, 'Human'),
])
add('agent-pair', 'Two agents facing', 'agents', 'Teal agent (left) and blue agent (right) 300px apart, the frame for a conversation; bubbles go between them.', () => [
  ...agent({ x: 0, y: 0, size: 54, color: P.teal }), ...agent({ x: 300, y: 0, size: 54, color: P.blue }),
])

// ---------------------------------------------------------------- networks

const net = (n, rad, edges, o = {}) => network({ points: polygonPoints(n, rad + 30, rad + 30, rad, o.rot ?? -90), edges, size: o.size || 40, node: o.node || 'human', fade: o.fade }).els
add('network-pentagon', 'Network: pentagon', 'networks', 'Five agents, fully connected. "A distributed system".', () => net(5, 90, EDGES.complete(5)))
add('network-hexagon', 'Network: hexagon marketplace', 'networks', 'The TEE marketplace: six human+agent nodes, ring plus cross edges.', () => net(6, 120, EDGES.tee(), { size: 46 }))
add('network-hexagon-faded', 'Network: hexagon (faded)', 'networks', 'The marketplace in faded colours; bring parties into focus by fading full-colour nodes and dark edges in on top.', () => net(6, 120, EDGES.tee(), { size: 46, fade: true }))
add('network-star', 'Network: star', 'networks', 'One hub agent connected to five spokes (a coordinator / server).', () => {
  const pts = [[150, 150], ...polygonPoints(5, 150, 150, 110)]
  return network({ points: pts, edges: EDGES.star(6), node: 'agent', size: 40 }).els
})
add('network-line', 'Network: line', 'networks', 'Four agents in a chain (a pipeline of parties).', () => network({ points: [[30, 40], [150, 40], [270, 40], [390, 40]], edges: EDGES.path(4), node: 'agent', size: 40 }).els)
add('network-ring-dots', 'Network: ring of dots', 'networks', 'Six round nodes on a ring. Abstract graph without the agent metaphor.', () => net(6, 80, EDGES.ring(6), { node: 'dot', size: 22 }))
add('network-highlight', 'Network with highlighted pair', 'networks', 'Two nodes of the marketplace in a dashed blue region, with a blue italic annotation (TEE "Ad-hoc protocols").', () => {
  const pts = polygonPoints(6, 150, 150, 120)
  const els = network({ points: pts, edges: EDGES.tee(), size: 46, fade: true }).els
  els.push(...highlightRegion({ x: 25, y: 60, w: 300, h: 70 }))
  els.push(line(pts[5], pts[1], { color: P.body, width: 2 }))
  els.push(...humanNode({ x: pts[5][0] - 23, y: pts[5][1] - 24, size: 46 }), ...humanNode({ x: pts[1][0] - 23, y: pts[1][1] - 24, size: 46 }))
  els.push(...annotation({ x: 220, y: 20, w: 220, t: 'Ad-hoc protocols', color: P.blue, align: 'right' }))
  return els
})

// ---------------------------------------------------------------- boxes

const boxes = [
  ['box-gray', 'Box: gray', P.gray, 'Neutral component / layer.'],
  ['box-teal', 'Box: verified (teal)', P.tealLayer, 'The verified artefact, the top of a stack ("Lean-Zip").'],
  ['box-stage', 'Box: pipeline stage', P.stageTeal, 'A stage in a pipeline (Parser, Expander).'],
  ['box-blue', 'Box: highlighted (blue)', P.blue, 'The component under discussion (Kernel).'],
  ['box-blue-light', 'Box: end stage (light blue)', P.stageBlue, 'Last stage of a pipeline.'],
  ['box-runtime', 'Box: runtime (red)', P.runtime, 'Where the bug was (Runtime).'],
  ['box-pink', 'Box: runtime bar (pink)', P.stagePink, 'Long bar under a pipeline (C++ Runtime).'],
]
for (const [id, nm, fill, d] of boxes) add(id, nm, 'boxes', `Cut-corner box (cutRectDiagonal, keypoint 0.18), no outline, black serif label. ${d}`, () => box({ w: 200, h: 50, fill, label: nm.replace(/^Box: /, '').replace(/ \(.*\)$/, '') }))
add('layer-stack-3', 'Layer stack (3)', 'boxes', 'Three layers, verified on top. Gap 22px.', () => layerStack({ w: 480, rows: [{ label: 'Lean-Zip', fill: P.tealLayer }, { label: 'Elaborator' }, { label: 'Kernel' }] }))
add('layer-stack-4', 'Layer stack (4, split base)', 'boxes', 'Who-watches-the-watchers stack: Lean-Zip / Macro Expander / Elaborator / Kernel + Runtime.', () => layerStack({ w: 480, h: 52, gap: 24, rows: [{ label: 'Lean-Zip', fill: P.tealLayer }, { label: 'Macro Expander' }, { label: 'Elaborator' }, [{ label: 'Kernel', frac: 1.2 }, { label: 'Runtime' }]] }))
add('layer-stack-highlighted', 'Layer stack, highlighted layers', 'boxes', 'Same stack with the Kernel in blue and the Runtime in red: the parts the argument is about.', () => layerStack({ w: 480, h: 52, gap: 24, rows: [{ label: 'Lean-Zip', fill: P.tealLayer }, { label: 'Macro Expander' }, { label: 'Elaborator' }, [{ label: 'Kernel', fill: P.blue, frac: 1.2 }, { label: 'Runtime', fill: P.runtime }]] }))
add('layer-stack-boundary', 'Layer stack with proof boundary', 'boxes', 'The full "Who watches the watchers?" diagram: stack, dashed proof boundary, red TCB bracket.', () => [
  ...layerStack({ x: 150, y: 0, w: 480, h: 52, gap: 24, rows: [{ label: 'Lean-Zip', fill: P.tealLayer }] }),
  ...boundary({ x: 0, y: 92, w: 760 }),
  ...layerStack({ x: 150, y: 120, w: 480, h: 52, gap: 24, rows: [{ label: 'Macro Expander' }, { label: 'Elaborator' }, [{ label: 'Kernel', frac: 1.2 }, { label: 'Runtime' }]] }),
  ...bracket({ x: 125, y: 130, h: 210 }),
])
add('pipeline', 'Pipeline (5 stages)', 'boxes', 'Source → Parser → Expander → Elaborator → Kernel, joined by 2px gray arrows.', () => pipeline({ stages: [{ label: 'Source', fill: P.stageGray, w: 92 }, { label: 'Parser', w: 92 }, { label: 'Expander', w: 112 }, { label: 'Elaborator', w: 112 }, { label: 'Kernel', fill: P.stageBlue, w: 112 }], gap: 80 }))
add('pipeline-runtime', 'Pipeline over a runtime', 'boxes', 'Pipeline with a long pink runtime bar beneath the stages it serves.', () => [
  ...pipeline({ stages: [{ label: 'Source', fill: P.stageGray, w: 92 }, { label: 'Parser', w: 92 }, { label: 'Expander', w: 112 }, { label: 'Elaborator', w: 112 }, { label: 'Kernel', fill: P.stageBlue, w: 112 }], gap: 80 }),
  ...box({ x: 172, y: 112, w: 668, h: 54, fill: P.stagePink, label: 'C++ Runtime', size: 15 }),
])
add('result-panel', 'Result panel (teal)', 'boxes', 'Large cut-corner panel: bold teal heading, big number, subline, small print.', () => [
  ...box({ w: 400, h: 240, fill: P.panelTeal, cut: 0.18 }),
  text({ x: 0, y: 20, w: 400, lines: [{ t: 'Verified Application Code', bold: true }], size: 19, color: P.stat, align: 'center' }),
  text({ x: 0, y: 66, w: 400, lines: [{ t: '0', bold: true }], size: 44, color: P.stat, align: 'center', lh: 1.1 }),
  text({ x: 0, y: 122, w: 400, lines: ['memory safety bugs'], size: 20, color: P.stat, align: 'center' }),
  text({ x: 40, y: 180, w: 320, lines: ['Zero heap overflows, zero use-after-free, zero undefined behaviour'], size: 12, color: P.body, align: 'center', lh: 1.4 }),
])
add('result-panel-gray', 'Result panel (gray)', 'boxes', 'Companion panel in gray with a bold black heading and a bold-italic gray verdict.', () => [
  ...box({ w: 400, h: 240, fill: P.gray, cut: 0.18 }),
  text({ x: 0, y: 20, w: 400, lines: [{ t: 'Every bug found', bold: true }], size: 19, color: P.ink, align: 'center' }),
  text({ x: 40, y: 110, w: 320, lines: [{ t: 'outside the proof boundary', bold: true, italic: true }], size: 22, color: P.body, align: 'center', lh: 1.25 }),
])

// ---------------------------------------------------------------- arrows / connectors

add('arrow-right', 'Arrow (right)', 'arrows', 'Thin 2px dark-gray arrow, the pipeline connector.', () => [line([0, 10], [120, 10], { color: P.body, width: 2, arrow: 'end' })])
add('arrow-down', 'Arrow (down)', 'arrows', 'Vertical connector.', () => [line([10, 0], [10, 100], { color: P.body, width: 2, arrow: 'end' })])
add('arrow-light', 'Arrow (light gray)', 'arrows', 'Lighter connector for background flows.', () => [line([0, 10], [160, 10], { color: P.line, width: 2, arrow: 'end' })])
add('arrow-labelled', 'Arrow with label', 'arrows', 'Arrow with a small gray serif label above it.', () => [
  text({ x: 0, y: 0, w: 160, lines: ['compiles to'], size: 14, color: P.body, align: 'center' }),
  line([0, 36], [160, 36], { color: P.body, width: 2, arrow: 'end' }),
])
add('arrow-curved', 'Arrow (curved)', 'arrows', 'Quadratic curve arrow for feedback or "goes back to".', () => [line([0, 80], [200, 80], { color: P.body, width: 2, arrow: 'end', curve: [100, 0] })])
add('arrow-elbow', 'Arrow (elbow)', 'arrows', 'Broken (one-bend) connector.', () => [line([0, 0], [140, 90], { color: P.body, width: 2, arrow: 'end', broken: [0, 90] })])
add('arrow-dashed', 'Arrow (dashed)', 'arrows', 'Dashed arrow: a planned / hypothetical / indirect flow.', () => [line([0, 10], [160, 10], { color: P.body, width: 2, arrow: 'end', dash: true })])
add('arrow-both', 'Arrow (two-way)', 'arrows', 'Exchange between two parties.', () => [line([0, 10], [160, 10], { color: P.body, width: 2, arrow: 'both' })])
add('drop-line-callout', 'Dashed drop line with callout', 'arrows', 'Dashed vertical from a stage down to a gray "Bug here ⇒" and a dark-red consequence (Lean pipeline slide).', () => [
  line([80, 0], [80, 150], { color: P.body, width: 1.5, dash: true }),
  text({ x: 0, y: 154, w: 160, lines: ['Bug here ⇒', { t: 'wrong program', color: P.bug }], size: 16, color: P.body, align: 'center', lh: 1.3 }),
])

// ---------------------------------------------------------------- frames

add('frame-dashed-blue', 'Dashed group frame', 'frames', 'Dashed blue (#4a86e8) rounded frame grouping a region; transparent fill.', () => dashedFrame({ w: 320, h: 180 }))
add('frame-highlight', 'Highlight region', 'frames', 'Translucent blue region with a dashed blue border; put it BEHIND the highlighted items.', () => highlightRegion({ w: 320, h: 80 }))
add('frame-document', 'Dashed document frame', 'frames', 'Cut-corner dashed teal frame with a title and an inner gray box (the "Lean-Zip / Code" artefact).', () => docFrame({ w: 200, h: 100 }))
add('frame-document-split', 'Document frame (two parts)', 'frames', 'Artefact with two components side by side (Theorems | Code), first one emphasised in teal.', () => [
  ...docFrame({ w: 220, h: 100, inner: null }),
  ...box({ x: 11, y: 48, w: 92, h: 34, fill: P.tealLayer, label: 'Theorems', size: 12 }),
  ...box({ x: 115, y: 48, w: 92, h: 34, fill: P.gray, label: 'Code', size: 12 }),
])
add('doc-page', 'Document page', 'frames', 'Folded-corner page outline: a spec, a paper, a file.', () => docPage({ w: 66, h: 84 }))
add('doc-page-dashed', 'Document page (dashed)', 'frames', 'Dashed variant: a document that does not exist yet / is generated.', () => docPage({ w: 66, h: 84, dash: true, stroke: P.frameBlue }))
add('boundary-line', 'Boundary line', 'frames', 'Heavy dashed horizontal line with an italic gray label at the right ("Proof boundary").', () => boundary({ w: 760 }))
add('tcb-bracket', 'Bracket: trusted computing base', 'frames', 'Dark-red vertical rule with an italic gray label to its left.', () => bracket({ x: 130, y: 0, h: 200 }))
add('rule-thin', 'Thin rule', 'frames', 'Light gray 1px separator.', () => [line([0, 0], [600, 0], { color: '#d9d9d9', width: 1 })])

// ---------------------------------------------------------------- bubbles

add('bubble-teal', 'Speech bubble (teal, from left)', 'bubbles', 'Message shape, tail down-left: said by the teal agent on the left.', () => bubble({ w: 160, h: 36, label: 'Thursday?' }))
add('bubble-blue', 'Speech bubble (blue, from right)', 'bubbles', 'Message shape mirrored (flipH), tail down-right: said by the blue agent on the right.', () => bubble({ w: 160, h: 36, label: '9:00am?', fill: P.bubbleBlue, tail: 'right' }))
add('bubble-annotation', 'Thought bubble (italic blue)', 'bubbles', 'A thought rendered as italic blue text above a party, no shape ("Let\'s schedule a meeting").', () => annotation({ w: 240, t: "Let's schedule a meeting", color: P.blue }))
add('chat-exchange', 'Chat exchange', 'bubbles', 'Two agents with four alternating bubbles between them (the protocol-synthesis conversation). Build: fade bubbles in one per click.', () => {
  const els = [...agent({ x: 0, y: 70, size: 54, color: P.teal }), ...agent({ x: 280, y: 70, size: 54, color: P.blue })]
  const msgs = [['Thursday?', P.bubbleTeal, 'left'], ['9:00am?', P.bubbleBlue, 'right'], ['20 minutes?', P.bubbleTeal, 'left'], ['ok!', P.bubbleBlue, 'right']]
  msgs.forEach(([t, f, tail], i) => els.push(...bubble({ x: 80, y: i * 44, w: 176, h: 36, label: t, fill: f, tail })))
  return els
})
add('pending-box', 'Pending state box', 'bubbles', 'Pale gray rounded box for a projected local state: "[Wait for day]".', () => pendingBox())
add('projection-pair', 'Projection: local protocols', 'bubbles', 'Each party\'s projected local steps: teal "Propose day" bubble over a pending box, and the counterpart.', () => [
  ...bubble({ x: 0, y: 0, w: 158, h: 30, label: 'Propose day', size: 12 }),
  ...pendingBox({ x: 0, y: 36, label: '[Wait for start time]' }),
  ...pendingBox({ x: 182, y: 0, label: '[Wait for day]' }),
  ...bubble({ x: 182, y: 30, w: 158, h: 30, label: 'Propose time', fill: P.bubbleBlue, tail: 'right', size: 12 }),
])

// ---------------------------------------------------------------- text

add('text-title', 'Slide title', 'text', 'Libre Baskerville 30px, black, top-left: element at (34, 22), text ink at x=44.', () => title({ t: 'Examples of protocols between agents' }))
add('text-title-slide', 'Title slide block', 'text', 'Centred 40px title with a small gray byline.', () => [
  text({ x: 0, y: 0, w: 520, lines: ['Who watches the', 'watchers?'], size: T.hero, color: P.ink, align: 'center', lh: 1.2 }),
  text({ x: 0, y: 110, w: 520, lines: ['Fuzzing Lean\'s Trusted Computing Base'], size: 14, color: P.body, align: 'center' }),
  text({ x: 0, y: 150, w: 520, lines: ['Basis Research Institute', 'Kiran Gopinathan'], size: 11, color: P.body, align: 'center', lh: 1.4 }),
])
add('text-question', 'Centred question', 'text', 'A whole slide that is one question, centred, 22px; optional italic lead-in above.', () => [
  text({ x: 0, y: 0, w: 500, lines: [{ t: 'In the face of these challenges,', italic: true }], size: 16, color: P.body, align: 'center' }),
  text({ x: 0, y: 30, w: 500, lines: ['How can agents coordinate?'], size: 22, color: P.ink, align: 'center' }),
])
add('annotation-blue', 'Annotation (blue italic)', 'text', 'Italic 18px #4285f4. Points at a diagram region; no arrow needed when placed next to it.', () => annotation({ t: 'Ad-hoc protocols', color: P.blue }))
add('annotation-teal', 'Annotation (teal italic)', 'text', 'Italic 18px #0097a7. A claim about the diagram ("Formally verified.").', () => annotation({ t: 'Formally verified. But what are we trusting?', color: P.stat, w: 420 }))
add('annotation-gray', 'Annotation (gray italic)', 'text', 'Italic 18px #595959. Labels and asides ("Proof boundary", "Each stage is an attack surface.").', () => annotation({ t: 'Each stage is an attack surface.', color: P.body }))
add('annotation-bug', 'Callout (dark red italic)', 'text', 'Italic 18px #980000. The punchline about a failure ("There was a bug!").', () => annotation({ t: 'There was a bug!', color: P.bug, w: 200 }))
add('annotation-pair', 'Annotation pair (stacked, offset)', 'text', 'Two small gray italic notes stacked and offset, attached to a step ("Economic objectives / Rationality").', () => [
  text({ x: 0, y: 0, w: 220, lines: [{ t: 'Economic objectives', italic: true }], size: 15, color: P.body }),
  text({ x: 28, y: 24, w: 220, lines: [{ t: 'Rationality', italic: true }], size: 15, color: P.body }),
])
add('faded-list', 'Faded list', 'text', 'Dash-bulleted list, 20px, one item per text element. Current item #595959, the rest #cccccc. Build: fade a #595959 copy in over each item.', () => {
  const items = ['Schedule a meeting', 'Bartering cost of an item', 'Making an insurance claim', 'Negotiating refund for a good', 'Organising a joint purchase']
  return items.map((t, i) => text({ x: 0, y: i * 46, w: 480, lines: [`-\u00a0\u00a0\u00a0\u00a0${t}`], size: T.body, color: i === 0 ? P.body : P.faded }))
})
add('numbered-steps', 'Numbered steps', 'text', 'Bold 20px numbered steps spaced 76px apart; step 1 black, later steps #cccccc until reached.', () =>
  ['1. Protocol Synthesis', '2. Projection', '3. Execution'].map((t, i) => text({ x: 0, y: i * 127, w: 330, lines: [{ t, bold: true }], size: T.step, color: i === 0 ? P.ink : P.faded })))
add('outline-checks', 'Outline with checks', 'text', 'Numbered outline where finished items turn gray and get a teal check.', () => {
  const els = []
  ;['Fuzzing lean-zip', 'What we found', 'Building Trust in Verification'].forEach((t, i) => {
    els.push(text({ x: 0, y: i * 34, w: 320, lines: [`${i + 1}.   ${t}`], size: 15, color: i < 2 ? P.faded : P.body }))
    if (i < 2) els.push(shape({ x: 196 - (i === 1 ? 26 : 0), y: i * 34 + 12, w: 16, h: 14, vb: [80, 70], path: 'M 0 36 L 12 24 L 26 38 L 66 0 L 78 12 L 26 64 Z', fill: P.stat }))
  })
  return els
})
add('stat-big', 'Big number (teal)', 'text', '44px teal number with a 17px gray subline.', () => stat({}))
add('stat-bug', 'Big number (dark red)', 'text', '44px dark-red count of failures ("2 bugs found").', () => [text({ x: 0, y: 0, w: 420, lines: ['2 bugs found'], size: T.stat, color: P.bug, align: 'center', lh: 1.2 })])
add('code-block', 'Code block', 'text', 'Roboto Mono 13px on #f3f3f3, 12/16px padding, keyword in blue.', () => [text({
  x: 0, y: 0, w: 520, size: T.code, color: '#333333', font: F.mono, fill: P.code, lh: 1.6, inset: [12, 16, 12, 16], name: 'code',
  html: [
    [run('theorem', { color: P.blue }), ' zlib_decompress_compress'],
    ['  (data : ByteArray) (level : UInt8)'],
    ['  (hsize : data.size < 1024 * 1024 * 1024) :'],
    ['  Zlib.decompress (Zlib.compress data level) = .ok data'],
  ].map(l => para(l.map(x => x.startsWith('<') ? x : run(x)).join(''))).join(''),
  lines: ['', '', '', ''],
})])
add('inline-code-sentence', 'Sentence with inline code', 'text', 'Gray body sentence with a Roboto Mono span on a #f3f3f3 background.', () => [text({
  x: 0, y: 0, w: 560, size: 16, color: P.body,
  html: para(run('For any byte array, ') + run('decompress(compress(data)) = data', { font: F.mono, bg: P.code, color: P.stat }) + run('.')),
})])
add('caption', 'Caption (gray)', 'text', 'Small gray caption under or beside a diagram, 16px, right-aligned when at the right edge.', () => [text({ x: 0, y: 0, w: 260, lines: ['A marketplace of', 'autonomous agents'], size: 16, color: P.body, align: 'center', lh: 1.3 })])
add('venn-labels', 'Field triangle (three words + plus signs)', 'text', 'Three discipline names arranged in a triangle with gray plus signs; fade them up one at a time.', () => [
  text({ x: 0, y: 0, w: 200, lines: ['Distributed', 'Systems'], size: 20, color: P.body, align: 'center', lh: 1.2 }),
  text({ x: 300, y: 0, w: 200, lines: ['Game', 'Theory'], size: 20, color: P.body, align: 'center', lh: 1.2 }),
  text({ x: 150, y: 120, w: 200, lines: ['Cryptography'], size: 20, color: P.body, align: 'center' }),
  text({ x: 230, y: 70, w: 40, lines: ['+'], size: 16, color: P.line, align: 'center' }),
])

// ---------------------------------------------------------------- cue glyphs

for (const g of GLYPHS) add(`glyph-${g.id}`, `Glyph: ${g.name}`, 'glyphs', `80x80 cue glyph. Cues: ${g.cue}.`, g.draw)

// ---------------------------------------------------------------- Basis blog

const bbox2 = (o) => {
  const { x = 0, y = 0, w = 240, h = 110, fill = B.cream, stroke = B.ink, t = 'ELF binary', sub = '25,336 RV64 instructions', tc = B.ink } = o
  return [shape({
    x, y, w, h, vb: [w, h], path: `M 0 0 L ${w} 0 L ${w} ${h} L 0 ${h} Z`, fill, stroke, sw: 1.5,
    text: { content: para(run(t, { size: 20, bold: true, color: tc }), 'center') + (sub ? para(run(sub, { size: 14, font: F.sans, color: tc === B.ink ? B.muted : tc }), 'center') : ''), defaultFontName: F.serif, defaultColor: tc, align: 'middle', lineHeight: 1.3, paragraphSpace: 4 },
  })]
}
add('basis-box', 'Basis: cream box', 'basis', 'Square cream box (#efe8db) with a 1.5px ink (#311317) outline; bold serif name, sans muted (#6e5d57) detail.', () => bbox2({}))
add('basis-box-dark', 'Basis: dark cream box', 'basis', 'Fixed / given inputs: darker cream #e0d4c1.', () => bbox2({ fill: B.creamDark, t: 'Sail RISC-V model', sub: '59,967 lines of generated Lean' }))
add('basis-highlight', 'Basis: terracotta highlight box', 'basis', 'The conclusion box: terracotta #dd7954 fill, #b85c39 outline, ink text, italic serif formula line.', () => [shape({
  x: 0, y: 0, w: 560, h: 100, vb: [560, 100], path: 'M 0 0 L 560 0 L 560 100 L 0 100 Z', fill: B.terracotta, stroke: B.terracottaDark, sw: 1.5,
  text: { content: para(run('refinement theorem', { size: 20, bold: true }), 'center') + para(run('Loaded p c ⇒ (BigStep p out ⇔ Halts c out 0)', { size: 17, italic: true }), 'center'), defaultFontName: F.serif, defaultColor: B.ink, align: 'middle', lineHeight: 1.4, paragraphSpace: 6 },
})])
add('basis-section', 'Basis: section frame', 'basis', 'Thin #d8c9b4 frame with a letter-spaced sans small-caps heading at top-left.', () => [
  shape({ x: 0, y: 0, w: 600, h: 180, vb: [600, 180], path: 'M 0 0 L 600 0 L 600 180 L 0 180 Z', fill: B.bg, stroke: B.rule, sw: 1.5 }),
  { ...text({ x: 14, y: 10, w: 300, lines: [{ t: 'WRITTEN BY LLMS', bold: true }], size: 14, color: B.ink, font: F.sans }), wordSpace: 2 },
])
add('basis-title', 'Basis: figure title', 'basis', 'Serif ink title with a #d8c9b4 rule below it.', () => [
  text({ x: 0, y: 0, w: 640, lines: ['From a C interpreter to a refinement theorem'], size: 26, color: B.ink, lh: 1.2 }),
  line([10, 52], [650, 52], { color: B.rule, width: 1.5 }),
])
add('basis-arrow', 'Basis: labelled arrow', 'basis', 'Ink 1.5px arrow with a sans muted label above.', () => [
  text({ x: 0, y: 0, w: 140, lines: ['gcc -O2'], size: 14, color: B.muted, font: F.sans, align: 'center' }),
  line([0, 34], [140, 34], { color: B.ink, width: 1.5, arrow: 'end' }),
])
add('basis-annotation', 'Basis: terracotta note', 'basis', 'Sans note in ink beside a dashed terracotta arrow ("failed proof obligation → rule corrected").', () => [
  line([0, 70], [120, 10], { color: B.terracotta, width: 2, dash: true, arrow: 'end', curve: [110, 80] }),
  text({ x: 140, y: 0, w: 220, lines: ['failed proof obligation', '→ rule corrected'], size: 16, color: B.ink, font: F.sans, lh: 1.35 }),
])
add('basis-refinement-square', 'Basis: refinement square', 'basis', 'Commuting square: p —BigStep→ out over c —Halts…0→ out, dashed Loaded on the left, triple bar on the right, dashed terracotta feedback arc.', () => {
  const it = (x, y, t, o = {}) => text({ x, y, w: o.w || 60, lines: [{ t, italic: true }], size: o.size || 26, color: B.ink, align: o.align || 'center', lh: 1.1 })
  const sub = (x, y, w, t, o = {}) => text({ x, y, w, lines: Array.isArray(t) ? t : [t], size: o.size || 15, color: B.muted, font: F.sans, align: o.align || 'center', lh: 1.3 })
  return [
    it(150, 40, 'p'), it(430, 40, 'out', { w: 80 }), it(150, 248, 'c'), it(430, 248, 'out', { w: 80 }),
    line([205, 62], [425, 62], { color: B.ink, width: 1.5, arrow: 'end' }),
    line([205, 270], [425, 270], { color: B.ink, width: 1.5, arrow: 'end' }),
    it(250, 18, 'BigStep', { w: 130, size: 18 }), sub(200, 70, 230, 'semantics written by LLMs', { size: 13 }),
    it(240, 226, 'Halts … 0', { w: 150, size: 18 }), sub(200, 278, 230, 'the binary on the RISC-V model', { size: 13 }),
    line([180, 90], [180, 244], { color: B.ink, width: 1.5, dash: true }),
    text({ x: 50, y: 130, w: 120, lines: [{ t: 'Loaded', italic: true }], size: 18, color: B.ink, align: 'right' }),
    sub(20, 160, 150, ['the machine holds p'], { size: 13, align: 'right' }),
    line([462, 92], [462, 242], { color: B.ink, width: 1.5 }), line([467, 92], [467, 242], { color: B.ink, width: 1.5 }), line([472, 92], [472, 242], { color: B.ink, width: 1.5 }),
    sub(486, 158, 110, 'same output', { size: 13, align: 'left' }),
    line([492, 256], [520, 52], { color: B.terracotta, width: 2, dash: true, arrow: 'end', cubic: [[640, 260], [640, 40]] }),
    text({ x: 230, y: 150, w: 170, lines: [{ t: 'for every p and c', italic: true }], size: 14, color: B.muted, align: 'center' }),
  ]
})

// ---------------------------------------------------------------- write

for (const it of items) {
  const b = { w: 0, h: 0 }
  for (const e of it.elements) {
    if (e.type === 'line') for (const p of [e.start, e.end]) { b.w = Math.max(b.w, e.left + p[0]); b.h = Math.max(b.h, e.top + p[1]) }
    else { b.w = Math.max(b.w, e.left + e.width); b.h = Math.max(b.h, e.top + e.height) }
  }
  it.width = Math.round(b.w); it.height = Math.round(b.h)
}
writeFileSync(resolve(here, '../library.json'), JSON.stringify(items, null, 1) + '\n')

const counts = {}
for (const it of items) counts[it.category] = (counts[it.category] || 0) + 1
console.log('library.json:', items.length, 'items', counts)

// ---------------------------------------------------------------- themes

const themes = [
  {
    id: 'razzle',
    name: 'Razzle (default)',
    theme: {
      backgroundColor: '#ffffff',
      themeColors: [P.teal, P.blue, P.orange, P.tealLayer, P.runtime, P.gray],
      fontColor: P.body,
      fontName: F.serif,
      outline: { style: 'solid', width: 2, color: P.ink },
      shadow: { h: 0, v: 0, blur: 0, color: 'rgba(0,0,0,0)' },
    },
    fonts: { serif: F.serif, mono: F.mono, sans: F.sans },
    titleColor: P.ink,
    palette: P,
  },
  {
    id: 'basis-blog',
    name: 'Basis Blog',
    theme: {
      backgroundColor: B.bg,
      themeColors: [B.terracotta, B.cream, B.creamDark, B.ink, B.muted, B.rule],
      fontColor: B.ink,
      fontName: F.serif,
      outline: { style: 'solid', width: 1.5, color: B.ink },
      shadow: { h: 0, v: 0, blur: 0, color: 'rgba(0,0,0,0)' },
    },
    fonts: { serif: F.serif, mono: F.mono, sans: F.sans },
    titleColor: B.ink,
    palette: B,
  },
]
writeFileSync(resolve(here, '../themes.json'), JSON.stringify(themes, null, 2) + '\n')
console.log('themes.json:', themes.map(t => t.name).join(', '))
void rect; void circle; void shapeText
