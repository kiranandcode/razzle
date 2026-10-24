// Razzle element kit: constructors for valid PPTist elements in the Razzle visual language.
// Used by build_library.mjs (shared/library.json) and build_demo.mjs (decks/demo.json).
// Canvas: 1000 x 562.5. All geometry in canvas px.

// ---------------------------------------------------------------- palettes

export const P = {
  // text
  ink: '#000000',        // titles, labels inside boxes
  body: '#595959',       // body text, gray annotations, dark connectors
  faded: '#cccccc',      // "not yet" text in a fading build
  muted: '#666666',      // secondary captions
  // agents
  teal: '#4fafc3',       // agent
  blue: '#4285f4',       // second agent, accent annotation, highlighted layer
  orange: '#ffab40',     // human
  // layers / boxes
  tealLayer: '#77c7d0',  // the verified artefact (top layer)
  gray: '#eeeeee',       // neutral layer / box
  runtime: '#cd8484',    // runtime / the place the bug was
  stageTeal: '#bde4e8',  // pipeline stage
  stageBlue: '#aac8fa',  // pipeline end stage (kernel)
  stageGray: '#e3e5e8',  // pipeline source
  stagePink: '#e4bebe',  // pipeline runtime bar
  panelTeal: '#dcf0f2',  // result panel
  // bubbles
  bubbleTeal: '#b8e2e6',
  bubbleBlue: '#a8c7f9',
  pending: '#f6f8f9',    // "[Wait for day]" placeholder box
  // frames, emphasis
  frameBlue: '#4a86e8',  // dashed region frame
  frameTeal: '#59bbc5',  // dashed document frame
  highlight: '#a8c7f9',  // translucent region fill
  line: '#ababab',       // network edges, thin connectors
  stat: '#0097a7',       // teal big numbers and teal annotations
  bug: '#980000',        // dark red: bugs, the TCB bracket
  code: '#f3f3f3',       // code background
  crab: '#e08b6a',
  white: '#ffffff',
  clear: 'rgba(255,255,255,0)',
}

// "Basis Blog" palette (from the Ship Your Interpreter figures)
export const B = {
  ink: '#311317',
  muted: '#6e5d57',
  bg: '#fffcfc',
  cream: '#efe8db',
  creamDark: '#e0d4c1',
  rule: '#d8c9b4',
  terracotta: '#dd7954',
  terracottaDark: '#b85c39',
}

export const F = {
  serif: 'Libre Baskerville',
  mono: 'Roboto Mono',
  sans: 'Inter',
}

// type scale at the 1000 x 562.5 canvas
export const T = {
  // measured from the example decks (Google Slides 720pt pages scaled to 1000px)
  title: 35,      // slide title (24pt)
  hero: 46,       // title-slide title
  body: 25,       // list items, body sentences (18pt)
  step: 24,       // bold numbered steps
  label: 19,      // text inside layer boxes
  small: 16,      // legend labels, node names, small captions
  annot: 22,      // italic annotations
  stat: 48,       // big number
  sub: 22,        // line under a big number
  bubble: 15,     // text in speech bubbles
  code: 15,
}

export const L = {
  W: 1000,
  H: 562.5,
  margin: 44,     // left ink edge
  inset: 10,      // PPTist default text inset
}

// ---------------------------------------------------------------- ids

let _scope = 'el'
let _n = 0
export function scope(s) { _scope = s; _n = 0 }
export const nid = () => `${_scope}-${++_n}`

const r2 = (x) => Math.round(x * 100) / 100

// ---------------------------------------------------------------- path utils

// Tokenise an absolute SVG path (M L H V Q C A Z, uppercase only).
function tokens(d) {
  return d.match(/[MLHVQCAZ]|-?\d*\.?\d+(?:e-?\d+)?/g)
}

function arcPoints(x1, y1, rx, ry, phi, fa, fs, x2, y2) {
  // endpoint -> centre parameterisation (SVG 1.1 F.6.5), sampled
  const rad = (phi * Math.PI) / 180
  const cos = Math.cos(rad), sin = Math.sin(rad)
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2
  const x1p = cos * dx + sin * dy, y1p = -sin * dx + cos * dy
  rx = Math.abs(rx); ry = Math.abs(ry)
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam) }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p
  let co = Math.sqrt(Math.max(0, num / den))
  if (fa === fs) co = -co
  const cxp = (co * rx * y1p) / ry, cyp = (-co * ry * x1p) / rx
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2
  const ang = (ux, uy, vx, vy) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
    return a
  }
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
  if (!fs && dt > 0) dt -= 2 * Math.PI
  if (fs && dt < 0) dt += 2 * Math.PI
  const pts = []
  for (let i = 0; i <= 48; i++) {
    const t = t1 + (dt * i) / 48
    pts.push([cos * rx * Math.cos(t) - sin * ry * Math.sin(t) + cx, sin * rx * Math.cos(t) + cos * ry * Math.sin(t) + cy])
  }
  return pts
}

// Bounding box of an absolute path; returns {x,y,w,h}.
export function pathBBox(d) {
  const t = tokens(d)
  let i = 0, cmd = 'M', cx = 0, cy = 0
  const pts = []
  const num = () => parseFloat(t[i++])
  while (i < t.length) {
    if (/[A-Z]/.test(t[i])) cmd = t[i++]
    if (cmd === 'Z') continue
    if (cmd === 'M' || cmd === 'L') { cx = num(); cy = num(); pts.push([cx, cy]) }
    else if (cmd === 'H') { cx = num(); pts.push([cx, cy]) }
    else if (cmd === 'V') { cy = num(); pts.push([cx, cy]) }
    else if (cmd === 'Q') { const a = [num(), num()]; cx = num(); cy = num(); pts.push(a, [cx, cy]) }
    else if (cmd === 'C') { const a = [num(), num()], b = [num(), num()]; cx = num(); cy = num(); pts.push(a, b, [cx, cy]) }
    else if (cmd === 'A') {
      const rx = num(), ry = num(), phi = num(), fa = num(), fs = num(), x = num(), y = num()
      pts.push(...arcPoints(cx, cy, rx, ry, phi, fa, fs, x, y)); cx = x; cy = y
    }
  }
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1])
  const x = Math.min(...xs), y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

// Translate an absolute path by (dx, dy).
export function shiftPath(d, dx, dy) {
  const t = tokens(d)
  const out = []
  let i = 0, cmd = 'M'
  const n = () => parseFloat(t[i++])
  while (i < t.length) {
    if (/[A-Z]/.test(t[i])) { cmd = t[i++]; out.push(cmd); if (cmd === 'Z') continue }
    if (cmd === 'M' || cmd === 'L') out.push(r2(n() + dx), r2(n() + dy))
    else if (cmd === 'H') out.push(r2(n() + dx))
    else if (cmd === 'V') out.push(r2(n() + dy))
    else if (cmd === 'Q') out.push(r2(n() + dx), r2(n() + dy), r2(n() + dx), r2(n() + dy))
    else if (cmd === 'C') out.push(r2(n() + dx), r2(n() + dy), r2(n() + dx), r2(n() + dy), r2(n() + dx), r2(n() + dy))
    else if (cmd === 'A') out.push(n(), n(), n(), n(), n(), r2(n() + dx), r2(n() + dy))
    else if (cmd === 'Z') {}
  }
  return out.join(' ')
}

// PPTist path formulas used here (copied from editor/src/configs/shapes.ts).
export const FORMULAS = {
  cutRectDiagonal: (w, h, [k]) => { const r = Math.min(w, h) * k; return `M 0 ${h - r} L 0 0 L ${w - r} 0 L ${w} ${r} L ${w} ${h} L ${r} ${h} Z` },
  cutRectSingle: (w, h, [k]) => { const r = Math.min(w, h) * k; return `M 0 ${h} L 0 0 L ${w - r} 0 L ${w} ${r} L ${w} ${h} Z` },
  roundRect: (w, h, [k]) => { const r = Math.min(w, h) * k; return `M ${r} 0 L ${w - r} 0 Q ${w} 0 ${w} ${r} L ${w} ${h - r} Q ${w} ${h} ${w - r} ${h} L ${r} ${h} Q 0 ${h} 0 ${h - r} L 0 ${r} Q 0 0 ${r} 0 Z` },
  message: (w, h, [p, ah]) => { const pt = w * p, aw = w * 0.2, a = h * ah; return `M 0 0 L ${w} 0 L ${w} ${h - a} L ${pt + aw} ${h - a} L ${pt} ${h} L ${pt} ${h - a} L 0 ${h - a} Z` },
  triangle: (w, h, [k]) => `M ${w * k} 0 L 0 ${h} L ${w} ${h} Z`,
}

const SPECIAL = /[^MLQCAZ\d\s.,\-e]/

// ---------------------------------------------------------------- primitives

// Generic shape. Either {path, vb} in local coords, or {formula, keypoints}.
export function shape(o) {
  const { x = 0, y = 0, w, h, fill = P.gray, stroke, sw = 2, dash, opacity, rotate = 0, flipH, flipV, text, formula, keypoints, name, fixedRatio = false } = o
  let path = o.path, vb = o.vb
  if (formula) { path = FORMULAS[formula](w, h, keypoints); vb = [w, h] }
  const el = { type: 'shape', id: nid(), left: r2(x), top: r2(y), width: r2(w), height: r2(h), rotate, viewBox: vb, path, fixedRatio, fill }
  if (formula) { el.pathFormula = formula; el.keypoints = keypoints }
  if (stroke) el.outline = { style: dash ? 'dashed' : 'solid', width: sw, color: stroke }
  if (opacity !== undefined) el.opacity = opacity
  if (flipH) el.flipH = true
  if (flipV) el.flipV = true
  if (SPECIAL.test(path)) el.special = true
  if (text) el.text = text
  if (name) el.name = name
  return el
}

// Shape from an absolute path drawn in some local frame; bbox computed, then placed at (ox,oy) offset.
export function pathShape(d, o = {}) {
  const bb = pathBBox(d)
  const w = Math.max(bb.w, 0.5), h = Math.max(bb.h, 0.5)
  return shape({ ...o, x: (o.ox || 0) + bb.x, y: (o.oy || 0) + bb.y, w, h, vb: [r2(w), r2(h)], path: shiftPath(d, -bb.x, -bb.y) })
}

export const rectPath = (w, h) => `M 0 0 L ${w} 0 L ${w} ${h} L 0 ${h} Z`
export const ellipsePath = (w, h) => `M ${w / 2} 0 A ${w / 2} ${h / 2} 0 1 1 ${w / 2} ${h} A ${w / 2} ${h / 2} 0 1 1 ${w / 2} 0 Z`

export const rect = (o) => shape({ ...o, vb: [o.w, o.h], path: rectPath(o.w, o.h) })
export const ellipse = (o) => shape({ ...o, vb: [200, 200], path: ellipsePath(200, 200) })
export const circle = ({ cx, cy, r, ...o }) => ellipse({ ...o, x: cx - r, y: cy - r, w: 2 * r, h: 2 * r })

// ---------------------------------------------------------------- text

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// One run of text with inline marks (PPTist ProseMirror mark spans, one style per span).
export function run(t, { size, color, bold, italic, font, bg, raw } = {}) {
  // ProseMirror-static collapses white space: keep runs of spaces (code indentation) as no-break spaces
  let s = raw ? t : esc(t).replace(/^ /, '\u00a0').replace(/ (?= )/g, '\u00a0')
  if (bg) s = `<span style="background-color: ${bg};">${s}</span>`
  if (font) s = `<span style="font-family: ${font};">${s}</span>`
  if (color) s = `<span style="color: ${color};">${s}</span>`
  if (size) s = `<span style="font-size: ${size}px;">${s}</span>`
  if (italic) s = `<em>${s}</em>`
  if (bold) s = `<strong>${s}</strong>`
  return s
}
export const para = (content, align = 'left') => `<p style="text-align: ${align};">${content}</p>`

// Text element. `lines` = array of paragraphs, each a string or array of runs (already formatted) or {t, ...marks}.
export function text(o) {
  const { x = 0, y = 0, w, size = T.body, color = P.body, font = F.serif, lh = 1.5, align = 'left', bold, italic, fill, opacity, ps = 0, name, inset, h, textType, vAlign } = o
  const lines = Array.isArray(o.lines) ? o.lines : [o.lines]
  const html = o.html || lines.map(l => {
    if (typeof l === 'string') return para(run(l, { size, bold, italic }), align)
    if (Array.isArray(l)) return para(l.map(x => typeof x === 'string' ? run(x, { size, bold, italic }) : run(x.t, { size, ...x })).join(''), align)
    return para(run(l.t, { size, bold, italic, ...l }), l.align || align)
  }).join('')
  const ins = inset || [L.inset, L.inset, L.inset, L.inset]
  const el = {
    type: 'text', id: nid(), left: r2(x), top: r2(y), width: r2(w),
    height: r2(h ?? (lines.length * size * lh + (lines.length - 1) * ps + ins[0] + ins[2])),
    rotate: 0, content: html, defaultFontName: font, defaultColor: color, lineHeight: lh, paragraphSpace: ps,
  }
  if (inset) el.inset = inset
  if (fill) el.fill = fill
  if (opacity !== undefined) el.opacity = opacity
  if (textType) el.textType = textType
  if (name) el.name = name
  if (h !== undefined) { el.fixedHeight = true; el.vAlign = vAlign || 'top' }
  return el
}

// Text inside a shape.
export function shapeText(label, { size = T.label, color = P.ink, font = F.serif, align = 'middle', bold, italic, lh = 1.3, halign = 'center', inset, html } = {}) {
  const content = html || (Array.isArray(label) ? label : [label]).map(l => typeof l === 'string'
    ? para(run(l, { size, bold, italic }), halign)
    : para(run(l.t, { size, bold, italic, ...l }), l.align || halign)).join('')
  const t = { content, defaultFontName: font, defaultColor: color, align, lineHeight: lh, paragraphSpace: 2 }
  if (inset) t.inset = inset
  return t
}

// ---------------------------------------------------------------- lines

// Line from absolute p1 to p2. arrow: 'end' | 'start' | 'both' | 'dot-end' ...
export function line(p1, p2, o = {}) {
  const { color = P.line, width = 2, dash, dotted, arrow, curve, broken, cubic, name } = o
  const all = [p1, p2]
  const left = Math.min(p1[0], p2[0]), top = Math.min(p1[1], p2[1])
  const rel = (p) => [r2(p[0] - left), r2(p[1] - top)]
  const pts = ['', '']
  if (arrow === 'end' || arrow === 'both') pts[1] = 'arrow'
  if (arrow === 'start' || arrow === 'both') pts[0] = 'arrow'
  if (arrow === 'dot') pts[1] = 'dot'
  const el = { type: 'line', id: nid(), left: r2(left), top: r2(top), width, start: rel(p1), end: rel(p2), style: dash ? 'dashed' : dotted ? 'dotted' : 'solid', color, points: pts }
  if (curve) el.curve = rel(curve)
  if (broken) el.broken = rel(broken)
  if (cubic) el.cubic = [rel(cubic[0]), rel(cubic[1])]
  if (name) el.name = name
  void all
  return el
}

// ---------------------------------------------------------------- element utils

export function move(els, dx, dy) {
  for (const e of els) { e.left = r2(e.left + dx); e.top = r2(e.top + dy) }
  return els
}

export function group(els) {
  const g = nid().replace(/-(\d+)$/, '-g$1')
  for (const e of els) e.groupId = g
  return els
}

// Bounding box of elements (lines use start/end, rotation ignored).
export function bbox(els) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const e of els) {
    if (e.type === 'line') {
      for (const p of [e.start, e.end, e.curve, e.broken].filter(Boolean)) {
        x0 = Math.min(x0, e.left + p[0]); y0 = Math.min(y0, e.top + p[1])
        x1 = Math.max(x1, e.left + p[0]); y1 = Math.max(y1, e.top + p[1])
      }
    } else {
      x0 = Math.min(x0, e.left); y0 = Math.min(y0, e.top)
      x1 = Math.max(x1, e.left + e.width); y1 = Math.max(y1, e.top + e.height)
    }
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

// Normalise so the bbox starts at (0,0).
export function normalise(els) {
  const b = bbox(els)
  move(els, -b.x, -b.y)
  return els
}

export function clone(els, { opacity, idSuffix = '' } = {}) {
  return els.map(e => {
    const c = JSON.parse(JSON.stringify(e))
    c.id = nid()
    if (opacity !== undefined) c.opacity = opacity
    return c
  })
}

// ---------------------------------------------------------------- composites: agents

// Agent: filled triangle with a black outline; (x,y) = top-left of the bbox.
export function agent({ x = 0, y = 0, size = 50, color = P.teal, opacity } = {}) {
  const h = size * 0.86
  return [shape({ x, y, w: size, h, formula: 'triangle', keypoints: [0.5], fill: color, stroke: P.ink, sw: 2, opacity, name: 'agent' })]
}

// Human-with-agent node from the TEE network: teal triangle with an orange triangle inside.
export function humanNode({ x = 0, y = 0, size = 46, outer = P.teal, inner = P.orange, opacity, stroke = P.ink } = {}) {
  const h = size * 0.86
  const iw = size * 0.66, ih = h * 0.66
  return [
    shape({ x, y, w: size, h, formula: 'triangle', keypoints: [0.5], fill: outer, stroke, sw: 2, opacity }),
    shape({ x: x + (size - iw) / 2 + size * 0.04, y: y + h - ih, w: iw, h: ih, formula: 'triangle', keypoints: [0.5], fill: inner, stroke, sw: 2, opacity }),
  ]
}

// Faded variants: the same node at low contrast (for "not yet" nodes).
export const FADE_NODE = { outer: '#d4ebf0', inner: '#ffead1', stroke: '#c2c2c2' }

// Regular polygon points, first vertex at the top.
export function polygonPoints(n, cx, cy, rad, rot = -90) {
  return Array.from({ length: n }, (_, i) => {
    const a = ((rot + (360 * i) / n) * Math.PI) / 180
    return [cx + rad * Math.cos(a), cy + rad * Math.sin(a)]
  })
}

// Network: nodes at points, edges below nodes.
export function network({ points, edges, node = 'human', size = 46, edgeColor = P.line, edgeWidth = 2, fade = false }) {
  const els = []
  for (const [a, b] of edges) els.push(line(points[a], points[b], { color: fade ? '#d0d0d0' : edgeColor, width: edgeWidth }))
  const nodes = []
  for (const [px, py] of points) {
    const h = size * 0.86
    const x = px - size / 2, y = py - h * 0.6
    let n
    if (node === 'human') n = humanNode({ x, y, size, ...(fade ? FADE_NODE : {}) })
    else if (node === 'dot') n = [circle({ cx: px, cy: py, r: size / 2, fill: fade ? '#d4ebf0' : P.teal, stroke: fade ? '#c2c2c2' : P.ink, sw: 2 })]
    else n = agent({ x, y, size, color: node === 'blue' ? P.blue : node === 'orange' ? P.orange : P.teal })
    nodes.push(n)
    els.push(...n)
  }
  return { els, nodes }
}

export const EDGES = {
  ring: (n) => Array.from({ length: n }, (_, i) => [i, (i + 1) % n]),
  complete: (n) => { const e = []; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) e.push([i, j]); return e },
  star: (n) => Array.from({ length: n - 1 }, (_, i) => [0, i + 1]),
  path: (n) => Array.from({ length: n - 1 }, (_, i) => [i, i + 1]),
  // the TEE marketplace hexagon: ring + long diagonals + the two triangles' cross edges
  tee: () => [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0], [0, 3], [1, 4], [2, 5], [1, 5], [2, 4], [1, 3], [5, 3]],
}

// ---------------------------------------------------------------- composites: boxes

// The signature box: flat fill, top-right and bottom-left corners cut.
export function box({ x = 0, y = 0, w = 160, h = 44, fill = P.gray, label, size = T.label, color = P.ink, font = F.serif, bold, italic, stroke, sw = 1, dash, cut = 0.18, opacity, align, halign } = {}) {
  return [shape({
    x, y, w, h, formula: 'cutRectDiagonal', keypoints: [cut], fill, stroke, sw, dash, opacity,
    text: label !== undefined ? shapeText(label, { size, color, font, bold, italic, align, halign }) : undefined,
    name: typeof label === 'string' ? label : undefined,
  })]
}

// Vertical stack of layer boxes; rows: [{label, fill, w?} | [{label, fill, w}, ...]] (array = side-by-side row).
export function layerStack({ x = 0, y = 0, w = 480, h = 54, gap = 22, rows }) {
  const els = []
  rows.forEach((row, i) => {
    const yy = y + i * (h + gap)
    if (Array.isArray(row)) {
      const g = 24, tot = row.reduce((s, c) => s + (c.frac || 1), 0)
      let xx = x
      for (const c of row) {
        const cw = (w - g * (row.length - 1)) * (c.frac || 1) / tot
        els.push(...box({ x: xx, y: yy, w: cw, h, fill: c.fill || P.gray, label: c.label, size: c.size || T.label }))
        xx += cw + g
      }
    } else {
      els.push(...box({ x, y: yy, w: row.w || w, h, fill: row.fill || P.gray, label: row.label, size: row.size || T.label }))
    }
  })
  return els
}

// Horizontal pipeline: stages connected by gray arrows.
export function pipeline({ x = 0, y = 0, h = 50, gap = 72, stages }) {
  const els = []
  let xx = x
  stages.forEach((s, i) => {
    const w = s.w || 100
    els.push(...box({ x: xx, y, w, h, fill: s.fill || P.stageTeal, label: s.label, size: s.size || 17 }))
    if (i < stages.length - 1) els.push(line([xx + w, y + h / 2], [xx + w + gap, y + h / 2], { color: P.body, width: 2, arrow: 'end' }))
    xx += w + gap
  })
  return els
}

// ---------------------------------------------------------------- composites: frames

export function dashedFrame({ x = 0, y = 0, w = 300, h = 100, color = P.frameBlue, fill = P.clear, sw = 2, round = 0.08, opacity } = {}) {
  return [shape({ x, y, w, h, formula: 'roundRect', keypoints: [round], fill, stroke: color, sw, dash: true, opacity, name: 'frame' })]
}

// Highlight region: translucent blue fill with a dashed blue border (TEE "Ad-hoc protocols").
export function highlightRegion({ x = 0, y = 0, w = 400, h = 90 } = {}) {
  return [shape({ x, y, w, h, vb: [w, h], path: rectPath(w, h), fill: P.highlight, opacity: 0.85, stroke: P.blue, sw: 2.5, dash: true, name: 'highlight' })]
}

// Dashed document frame: cut-corner dashed outline with a label (www "Lean-Zip" frame).
export function docFrame({ x = 0, y = 0, w = 200, h = 100, color = P.frameTeal, label = 'Lean-Zip', inner = 'Code', size = 18 } = {}) {
  const els = [shape({ x, y, w, h, formula: 'cutRectDiagonal', keypoints: [0.14], fill: P.clear, stroke: color, sw: 1, dash: true, name: 'document frame' })]
  els.push(text({ x, y: y + 4, w, lines: [label], size, color: P.body, align: 'center' }))
  if (inner) els.push(...box({ x: x + 11, y: y + h * 0.45, w: w - 22, h: h * 0.38, fill: P.gray, label: inner, size: 14 }))
  return els
}

// Folded-corner document page (outline only), for "a spec", "a paper".
export function docPage({ x = 0, y = 0, w = 60, h = 76, fill = P.white, stroke = P.ink, sw = 2, dash = false } = {}) {
  const f = w * 0.28
  return [
    shape({ x, y, w, h, vb: [w, h], path: `M 0 0 L ${w - f} 0 L ${w} ${f} L ${w} ${h} L 0 ${h} Z`, fill, stroke, sw, dash }),
    shape({ x: x + w - f, y, w: f, h: f, vb: [f, f], path: `M 0 0 L 0 ${f} L ${f} ${f} Z`, fill: P.gray, stroke, sw, dash }),
  ]
}

// Dashed horizontal boundary with an italic label above its right end.
export function boundary({ x = 0, y = 0, w = 760, label = 'Proof boundary', color = P.body, labelColor = P.body } = {}) {
  return [
    line([x, y], [x + w, y], { color, width: 3, dash: true }),
    text({ x: x + w - 260, y: y - 38, w: 260, lines: [{ t: label, italic: true }], size: T.annot, color: labelColor, align: 'right', lh: 1.3 }),
  ]
}

// Vertical bracket (dark red rule) with an italic label to its left: "Trusted Computing Base".
export function bracket({ x = 0, y = 0, h = 200, label = 'Trusted Computing Base', color = P.bug } = {}) {
  return [
    line([x, y], [x, y + h], { color, width: 3 }),
    text({ x: x - 140, y: y + h / 2 - 45, w: 128, lines: label.split(' '), size: 18, color: P.body, italic: true, align: 'center', lh: 1.25 }),
  ]
}

// ---------------------------------------------------------------- composites: bubbles

// Speech bubble: flat rectangle with a tail at the bottom; tail 'left' (speaker on the left) or 'right'.
export function bubble({ x = 0, y = 0, w = 160, h = 34, label = 'Thursday?', fill = P.bubbleTeal, tail = 'left', size = T.bubble, opacity } = {}) {
  return [shape({
    x, y, w, h, formula: 'message', keypoints: [0.12, 0.28], fill, flipH: tail === 'right', opacity,
    text: shapeText(label, { size, color: P.ink, inset: [2, 10, h * 0.28 + 2, 10] }), name: 'bubble',
  })]
}

// Placeholder "state" box from the projection step: "[Wait for day]".
export function pendingBox({ x = 0, y = 0, w = 175, h = 27, label = '[Wait for day]', fill = P.pending, size = 13 } = {}) {
  return [shape({ x, y, w, h, formula: 'roundRect', keypoints: [0.15], fill, text: shapeText(label, { size, color: P.ink, inset: [0, 6, 0, 6] }) })]
}

// ---------------------------------------------------------------- composites: text idioms

export const title = ({ x = L.margin - L.inset, y = 48, w = 900, t = 'Slide title', size = T.title, color = P.ink, font = F.serif } = {}) =>
  [text({ x, y, w, lines: [t], size, color, font, lh: 1.2, textType: 'title', name: 'title' })]

export const annotation = ({ x = 0, y = 0, w = 300, t = 'Formally verified.', color = P.blue, size = T.annot, align = 'left' } = {}) =>
  [text({ x, y, w, lines: [{ t, italic: true }], size, color, align, lh: 1.3, name: 'annotation' })]

export const stat = ({ x = 0, y = 0, w = 420, t = '105,823,818', sub = 'fuzzing executions over 19 hours', color = P.stat, size = T.stat } = {}) => {
  const els = [text({ x, y, w, lines: [t], size, color, align: 'center', lh: 1.2, name: 'stat' })]
  if (sub) els.push(text({ x, y: y + size * 1.2 + 8, w, lines: [sub], size: T.sub, color: P.body, align: 'center' }))
  return els
}

// Code block: a Razzle `code` element (converted to a highlighted `razzle-code` shape). Roboto Mono
// on #f3f3f3, line height 1.6, padding 12/16 at 15px (scaled with the size). `w` defaults to the
// width that fits the longest line; `h` to the height of the lines.
export const CODE_LANGUAGES = ['c', 'python', 'lean', 'ocaml', 'js', 'ts', 'rust', 'bash', 'json', 'text']
export const codePadding = (size) => ({ x: Math.round(size * 16 / 15), y: Math.round(size * 12 / 15) })
export const code = ({ x = 0, y = 0, w, h, lines = ['theorem zlib_decompress_compress', '  (data : ByteArray) :', '  decompress (compress data) = data'], language = 'text', size = T.code, background = true, name, opacity } = {}) => {
  const src = (Array.isArray(lines) ? lines : [lines]).map(l => String(l).replace(/\u00a0/g, ' ')).join('\n')
  const rows = src.split('\n')
  const pad = codePadding(size)
  const fitW = Math.ceil(Math.max(1, ...rows.map(l => [...l].length)) * size * 0.6 + 2 * pad.x)
  const el = {
    type: 'code', id: nid(), left: r2(x), top: r2(y), width: r2(w ?? fitW), height: r2(h ?? Math.ceil(rows.length * size * 1.6 + 2 * pad.y)),
    rotate: 0, code: src, language: CODE_LANGUAGES.includes(language) ? language : 'text', size, background,
  }
  if (name) el.name = name
  if (opacity !== undefined) el.opacity = opacity
  return [el]
}

// A translucent band over lines [from, to] (0-based) of a code element, for emphasis without
// colouring the code. Put it behind the code: give the code `background: false` and put a
// `codeBackground(codeEl)` under both.
export const codeLineRect = (el, from, to = from, { fill = 'rgba(152,0,0,0.12)', bleed = 0 } = {}) => {
  const lh = el.size * 1.6, pad = codePadding(el.size)
  return rect({ x: el.left - bleed, y: el.top + pad.y + from * lh, w: el.width + 2 * bleed, h: (to - from + 1) * lh, fill })
}
export const codeBackground = (el) => rect({ x: el.left, y: el.top, w: el.width, h: el.height, fill: P.code })
