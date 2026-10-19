// Cue glyphs: tiny pictures that prompt the next sentence of a talk.
// Each glyph is drawn in an 80 x 80 frame from PPTist shapes and lines:
// flat palette fills, 2px black outline (the agent-triangle style).
import { P, pathShape, shape, circle, rect, line, text, F, polygonPoints, humanNode, agent, FORMULAS } from './kit.mjs'

const K = P.ink
const S = 2 // outline width
const ps = (d, fill, o = {}) => pathShape(d, { fill, stroke: o.noStroke ? undefined : (o.stroke || K), sw: o.sw || S, ...o })
const poly = (pts) => 'M ' + pts.map(p => p.map(v => Math.round(v * 100) / 100).join(' ')).join(' L ') + ' Z'

export const GLYPHS = [
  {
    id: 'network', name: 'Network (pentagon)', cue: 'a distributed system, many parties',
    draw: () => {
      const pts = polygonPoints(5, 40, 42, 30)
      const els = []
      for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) els.push(line(pts[i], pts[j], { color: P.line, width: 1.5 }))
      for (const [x, y] of pts) els.push(circle({ cx: x, cy: y, r: 7, fill: P.teal, stroke: K, sw: S }))
      return els
    },
  },
  {
    id: 'boat-sinking', name: 'Sinking boat', cue: 'it sinks, it fails',
    draw: () => [
      line([34, 40], [50, 6], { color: K, width: 2.5 }),
      ps('M 51 9 L 66 38 L 40 36 Z', P.white),
      ps('M 6 26 L 72 54 L 60 68 L 12 44 Z', P.orange),
      ps('M 0 52 Q 10 46 20 52 Q 30 58 40 52 Q 50 46 60 52 Q 70 58 80 52 L 80 80 L 0 80 Z', P.bubbleBlue, { stroke: P.blue }),
      circle({ cx: 70, cy: 44, r: 2.5, fill: P.white, stroke: P.blue, sw: 1.5 }),
      circle({ cx: 76, cy: 36, r: 2, fill: P.white, stroke: P.blue, sw: 1.5 }),
    ],
  },
  {
    id: 'lock', name: 'Lock', cue: 'private, secret, sealed',
    draw: () => [
      ps('M 22 38 L 22 26 A 18 18 0 0 1 58 26 L 58 38 L 50 38 L 50 26 A 10 10 0 0 0 30 26 L 30 38 Z', '#cccccc'),
      rect({ x: 14, y: 36, w: 52, h: 38, fill: P.orange, stroke: K, sw: S }),
      circle({ cx: 40, cy: 51, r: 5, fill: K }),
      rect({ x: 38, y: 53, w: 4, h: 12, fill: K }),
    ],
  },
  {
    id: 'key', name: 'Key', cue: 'credentials, access',
    draw: () => [
      ps('M 34 36 L 74 36 L 74 46 L 68 46 L 68 54 L 60 54 L 60 46 L 54 46 L 54 52 L 46 52 L 46 46 L 34 46 Z', P.orange),
      circle({ cx: 22, cy: 41, r: 16, fill: P.orange, stroke: K, sw: S }),
      circle({ cx: 18, cy: 41, r: 5, fill: P.white, stroke: K, sw: S }),
    ],
  },
  {
    id: 'scale', name: 'Scale (trade-off)', cue: 'a trade-off, weighing options',
    draw: () => [
      rect({ x: 38, y: 16, w: 4, h: 52, fill: K }),
      ps('M 24 76 L 56 76 L 50 68 L 30 68 Z', P.body),
      rect({ x: 8, y: 20, w: 64, h: 4, fill: K, rotate: -10 }),
      line([11, 27], [5, 48], { color: K, width: 1.5 }), line([11, 27], [21, 48], { color: K, width: 1.5 }),
      line([69, 15], [61, 36], { color: K, width: 1.5 }), line([69, 15], [77, 36], { color: K, width: 1.5 }),
      ps('M 1 48 A 12 8 0 0 0 25 48 Z', P.teal),
      ps('M 57 36 A 12 8 0 0 0 81 36 Z', P.blue),
    ],
  },
  {
    id: 'magnifier', name: 'Magnifier', cue: 'look closer, inspect, search',
    draw: () => [
      rect({ x: 44, y: 54, w: 34, h: 10, fill: P.body, stroke: K, sw: S, rotate: 45 }),
      circle({ cx: 34, cy: 34, r: 24, fill: P.bubbleBlue, stroke: K, sw: 4 }),
      ps('M 22 28 A 14 14 0 0 1 34 18', P.clear, { stroke: P.white, sw: 3 }),
    ],
  },
  {
    id: 'bug', name: 'Bug', cue: 'a bug, a defect',
    draw: () => {
      const legs = []
      for (const y of [36, 48, 60]) {
        legs.push(line([26, y], [10, y - 6 + (y - 48) / 2], { color: K, width: 2.5 }))
        legs.push(line([54, y], [70, y - 6 + (y - 48) / 2], { color: K, width: 2.5 }))
      }
      return [
        ...legs,
        line([34, 20], [26, 6], { color: K, width: 2 }), line([46, 20], [54, 6], { color: K, width: 2 }),
        circle({ cx: 40, cy: 24, r: 10, fill: K }),
        shape({ x: 22, y: 28, w: 36, h: 46, vb: [200, 200], path: 'M 100 0 A 100 100 0 1 1 100 200 A 100 100 0 1 1 100 0 Z', fill: P.bug, stroke: K, sw: S }),
        line([40, 30], [40, 74], { color: K, width: 2 }),
      ]
    },
  },
  {
    id: 'shield', name: 'Shield', cue: 'protection, safety guarantee',
    draw: () => [
      ps('M 40 4 L 70 14 L 70 38 C 70 56 58 68 40 77 C 22 68 10 56 10 38 L 10 14 Z', P.teal),
      ps('M 25 40 L 31 34 L 37 40 L 52 25 L 58 31 L 37 52 Z', P.white),
    ],
  },
  {
    id: 'check', name: 'Check', cue: 'done, verified, correct',
    draw: () => [ps('M 8 42 L 20 30 L 32 42 L 60 12 L 72 24 L 32 66 Z', P.stat, { noStroke: true })],
  },
  {
    id: 'cross', name: 'Cross', cue: 'wrong, rejected, fails',
    draw: () => [ps('M 14 4 L 40 30 L 66 4 L 76 14 L 50 40 L 76 66 L 66 76 L 40 50 L 14 76 L 4 66 L 30 40 L 4 14 Z', P.bug, { noStroke: true })],
  },
  {
    id: 'clock', name: 'Clock', cue: 'time, latency, deadline',
    draw: () => {
      const ticks = polygonPoints(12, 40, 40, 29).map((p, i) => {
        const q = polygonPoints(12, 40, 40, i % 3 === 0 ? 23 : 26)[i]
        return line(p, q, { color: K, width: i % 3 === 0 ? 2.5 : 1.5 })
      })
      return [
        circle({ cx: 40, cy: 40, r: 36, fill: P.white, stroke: K, sw: 3 }),
        ...ticks,
        line([40, 40], [40, 18], { color: K, width: 3 }),
        line([40, 40], [56, 48], { color: P.bug, width: 2.5 }),
        circle({ cx: 40, cy: 40, r: 3, fill: K }),
      ]
    },
  },
  {
    id: 'database', name: 'Database', cue: 'data, storage, state',
    draw: () => [
      ps('M 12 16 A 28 10 0 0 1 68 16 L 68 64 A 28 10 0 0 1 12 64 Z', P.tealLayer),
      ps('M 12 32 A 28 10 0 0 0 68 32', P.clear),
      ps('M 12 48 A 28 10 0 0 0 68 48', P.clear),
      ps('M 12 16 A 28 10 0 0 0 68 16 A 28 10 0 0 0 12 16 Z', P.bubbleTeal),
    ],
  },
  {
    id: 'server', name: 'Server', cue: 'a machine, the backend',
    draw: () => [0, 1, 2].flatMap(i => [
      rect({ x: 10, y: 6 + i * 24, w: 60, h: 20, fill: P.gray, stroke: K, sw: S }),
      circle({ cx: 20, cy: 16 + i * 24, r: 3, fill: i === 2 ? P.bug : P.stat }),
      line([44, 16 + i * 24], [62, 16 + i * 24], { color: P.body, width: 2 }),
    ]),
  },
  {
    id: 'document', name: 'Document', cue: 'a spec, a paper, a file',
    draw: () => [
      ps('M 14 4 L 50 4 L 66 20 L 66 76 L 14 76 Z', P.white),
      ps('M 50 4 L 50 20 L 66 20 Z', P.gray),
      ...[30, 40, 50, 60].map((y, i) => line([22, y], [i === 3 ? 44 : 58, y], { color: P.line, width: 2.5 })),
    ],
  },
  {
    id: 'gear', name: 'Gear', cue: 'machinery, a process, automation',
    draw: () => {
      const pts = []
      const n = 8
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * 2 * Math.PI, step = (2 * Math.PI) / n
        for (const [f, rad] of [[0, 26], [0.12, 36], [0.38, 36], [0.5, 26]]) pts.push(a0 + f * step, rad)
      }
      const xy = []
      for (let i = 0; i < pts.length; i += 2) xy.push([40 + pts[i + 1] * Math.cos(pts[i]), 40 + pts[i + 1] * Math.sin(pts[i])])
      return [ps(poly(xy), '#b7b7b7'), circle({ cx: 40, cy: 40, r: 11, fill: P.white, stroke: K, sw: S })]
    },
  },
  {
    id: 'lightning', name: 'Lightning', cue: 'fast, sudden, power',
    draw: () => [ps('M 46 2 L 14 46 L 36 46 L 28 78 L 66 30 L 44 30 L 54 2 Z', P.orange)],
  },
  {
    id: 'cloud', name: 'Cloud', cue: 'the cloud, someone else\'s computer',
    draw: () => [ps('M 20 62 A 14 14 0 0 1 16 35 A 18 18 0 0 1 46 22 A 16 16 0 0 1 66 38 A 12 12 0 0 1 64 62 Z', P.bubbleBlue)],
  },
  {
    id: 'person', name: 'Person', cue: 'a user, a human',
    draw: () => [
      ps('M 12 78 C 12 56 24 46 40 46 C 56 46 68 56 68 78 Z', P.blue),
      circle({ cx: 40, cy: 24, r: 15, fill: P.blue, stroke: K, sw: S }),
    ],
  },
  {
    id: 'warning', name: 'Warning', cue: 'careful, a risk',
    draw: () => [
      shape({ x: 4, y: 6, w: 72, h: 66, formula: 'triangle', keypoints: [0.5], fill: P.orange, stroke: K, sw: S }),
      rect({ x: 37, y: 28, w: 6, h: 24, fill: K }),
      circle({ cx: 40, cy: 61, r: 3.5, fill: K }),
    ],
  },
  {
    id: 'cycle', name: 'Cycle', cue: 'a loop, iterate, feedback',
    draw: () => [
      line([14, 46], [62, 26], { color: P.stat, width: 5, arrow: 'end', cubic: [[10, 18], [44, 6]] }),
      line([66, 34], [18, 54], { color: P.stat, width: 5, arrow: 'end', cubic: [[70, 62], [36, 74]] }),
    ],
  },
  {
    id: 'funnel', name: 'Funnel', cue: 'filter, narrow down',
    draw: () => [
      circle({ cx: 22, cy: 6, r: 4, fill: P.teal, stroke: K, sw: 1.5 }),
      circle({ cx: 40, cy: 4, r: 4, fill: P.blue, stroke: K, sw: 1.5 }),
      circle({ cx: 58, cy: 7, r: 4, fill: P.orange, stroke: K, sw: 1.5 }),
      ps('M 6 16 L 74 16 L 46 46 L 46 72 L 34 78 L 34 46 Z', P.tealLayer),
    ],
  },
  {
    id: 'lightbulb', name: 'Light bulb', cue: 'an idea, insight',
    draw: () => [
      ps('M 30 56 C 30 46 16 40 16 26 A 24 24 0 0 1 64 26 C 64 40 50 46 50 56 Z', '#ffe599'),
      rect({ x: 30, y: 58, w: 20, h: 7, fill: P.line, stroke: K, sw: S }),
      rect({ x: 32, y: 67, w: 16, h: 7, fill: P.line, stroke: K, sw: S }),
      ps('M 34 46 L 34 34 L 40 40 L 46 34 L 46 46', P.clear, { sw: 1.5 }),
    ],
  },
  {
    id: 'hourglass', name: 'Hourglass', cue: 'waiting, it takes time',
    draw: () => [
      ps('M 18 8 L 62 8 L 62 14 C 62 28 46 34 46 40 C 46 46 62 52 62 66 L 62 72 L 18 72 L 18 66 C 18 52 34 46 34 40 C 34 34 18 28 18 14 Z', P.white),
      ps('M 26 64 C 30 56 36 52 40 50 C 44 52 50 56 54 64 Z', P.orange, { noStroke: true }),
      ps('M 28 20 L 52 20 C 50 26 44 30 40 32 C 36 30 30 26 28 20 Z', P.orange, { noStroke: true }),
      rect({ x: 12, y: 4, w: 56, h: 6, fill: P.body, stroke: K, sw: S }),
      rect({ x: 12, y: 70, w: 56, h: 6, fill: P.body, stroke: K, sw: S }),
    ],
  },
  {
    id: 'target', name: 'Target', cue: 'the goal, precisely',
    draw: () => [
      circle({ cx: 40, cy: 40, r: 36, fill: P.white, stroke: K, sw: S }),
      circle({ cx: 40, cy: 40, r: 26, fill: P.runtime, stroke: K, sw: S }),
      circle({ cx: 40, cy: 40, r: 16, fill: P.white, stroke: K, sw: S }),
      circle({ cx: 40, cy: 40, r: 7, fill: P.bug, stroke: K, sw: S }),
    ],
  },
  {
    id: 'flag', name: 'Flag', cue: 'a milestone, we got there',
    draw: () => [
      ps('M 22 8 L 66 8 L 56 24 L 66 40 L 22 40 Z', P.teal),
      line([20, 4], [20, 78], { color: K, width: 4 }),
    ],
  },
  {
    id: 'eye', name: 'Eye', cue: 'who watches, observe, audit',
    draw: () => [
      ps('M 2 40 Q 40 2 78 40 Q 40 78 2 40 Z', P.white),
      circle({ cx: 40, cy: 40, r: 13, fill: P.teal, stroke: K, sw: S }),
      circle({ cx: 40, cy: 40, r: 5, fill: K }),
    ],
  },
  {
    id: 'layers', name: 'Layers', cue: 'a stack, abstraction layers',
    draw: () => [56, 40, 24].map((y, i) => ps(`M 40 ${y - 14} L 76 ${y} L 40 ${y + 14} L 4 ${y} Z`, [P.gray, P.tealLayer, P.blue][i])),
  },
  {
    id: 'globe', name: 'Globe', cue: 'the internet, everywhere',
    draw: () => [
      circle({ cx: 40, cy: 40, r: 34, fill: P.bubbleTeal, stroke: K, sw: S }),
      ps('M 40 6 A 14 34 0 0 0 40 74 A 14 34 0 0 0 40 6 Z', P.clear, { sw: 1.5 }),
      line([6, 40], [74, 40], { color: K, width: 1.5 }),
      ps('M 11 24 Q 40 32 69 24', P.clear, { sw: 1.5 }),
      ps('M 11 56 Q 40 48 69 56', P.clear, { sw: 1.5 }),
    ],
  },
  {
    id: 'exchange', name: 'Exchange', cue: 'a protocol, back and forth',
    draw: () => [
      line([8, 28], [72, 28], { color: P.teal, width: 5, arrow: 'end' }),
      line([72, 52], [8, 52], { color: P.blue, width: 5, arrow: 'end' }),
    ],
  },
  {
    id: 'chat', name: 'Chat', cue: 'a conversation, negotiation',
    draw: () => [
      shape({ x: 2, y: 6, w: 48, h: 36, formula: 'message', keypoints: [0.15, 0.28], fill: P.bubbleTeal, stroke: K, sw: S }),
      shape({ x: 30, y: 38, w: 48, h: 36, formula: 'message', keypoints: [0.15, 0.28], fill: P.bubbleBlue, stroke: K, sw: S, flipH: true }),
    ],
  },
  {
    id: 'agents', name: 'Two agents', cue: 'agents, parties',
    draw: () => [...agent({ x: 2, y: 30, size: 40, color: P.teal }), ...agent({ x: 38, y: 30, size: 40, color: P.blue })],
  },
  {
    id: 'human-agent', name: 'Human with agent', cue: 'a person and their agent',
    draw: () => humanNode({ x: 8, y: 12, size: 64 }),
  },
  {
    id: 'rocket', name: 'Rocket', cue: 'launch, ship it',
    draw: () => [
      ps('M 30 60 L 18 74 L 22 54 Z', P.bug),
      ps('M 50 60 L 62 74 L 58 54 Z', P.bug),
      ps('M 34 64 L 40 78 L 46 64 Z', P.orange),
      ps('M 40 2 C 54 14 56 36 50 64 L 30 64 C 24 36 26 14 40 2 Z', P.white),
      circle({ cx: 40, cy: 30, r: 7, fill: P.bubbleBlue, stroke: K, sw: S }),
    ],
  },
  {
    id: 'trend-up', name: 'Trend up', cue: 'it grows, it scales',
    draw: () => [
      line([6, 6], [6, 74], { color: K, width: 2 }), line([6, 74], [76, 74], { color: K, width: 2 }),
      line([12, 62], [30, 44], { color: P.stat, width: 4 }),
      line([30, 44], [44, 52], { color: P.stat, width: 4 }),
      line([44, 52], [72, 14], { color: P.stat, width: 4, arrow: 'end' }),
    ],
  },
  {
    id: 'crab', name: 'Fuzzer crab', cue: 'the fuzzer, throwing random input',
    draw: () => {
      const c = P.crab
      const px = (x, y, w, h, fill = c) => rect({ x, y, w, h, fill })
      return [
        px(16, 22, 48, 28), px(8, 30, 8, 8), px(64, 30, 8, 8),
        px(20, 50, 6, 10), px(30, 50, 6, 10), px(46, 50, 6, 10), px(56, 50, 6, 10),
        px(28, 30, 4, 8, K), px(48, 30, 4, 8, K),
      ]
    },
  },
]
void text; void F; void FORMULAS
