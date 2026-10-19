#!/usr/bin/env node
// Render a Razzle deck (or shared/library.json) to a standalone HTML page that approximates
// PPTist's renderer (BaseShapeElement / BaseLineElement / BaseTextElement), then optionally
// screenshot it with headless Chrome.
//
//   node shared/tools/render_preview.mjs decks/demo.json out.html [--steps] [--png out.png]
//   node shared/tools/render_preview.mjs shared/library.json lib.html --library [--png lib.png]
//
// --steps renders every build step of every slide (step 0 = slide as it first appears).
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const flag = (f) => args.includes(f)
const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined }
const VALUED = ['--png', '--height', '--width']
const [inPath, outPath] = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && VALUED.includes(args[i - 1])))
if (!inPath || !outPath) { console.error('usage: render_preview.mjs <deck.json|library.json> <out.html> [--steps] [--library] [--png out.png]'); process.exit(1) }

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// ---------------------------------------------------------------- elements

function dashArrayShape(o) {
  const size = o?.width ?? 0, style = o?.style || 'solid'
  if (style === 'dashed') return size <= 6 ? `${size * 4.5} ${size * 2}` : `${size * 4} ${size * 1.5}`
  if (style === 'dotted') return size <= 6 ? `${size * 1.8} ${size * 1.6}` : `${size * 1.5} ${size * 1.2}`
  return '0 0'
}
function dashArrayLine(el) {
  const size = el.width
  if (el.style === 'dashed') return size <= 8 ? `${size * 5} ${size * 2.5}` : `${size * 5} ${size * 1.5}`
  if (el.style === 'dotted') return size <= 8 ? `${size * 1.8} ${size * 1.6}` : `${size * 1.5} ${size * 1.2}`
  return '0 0'
}

function renderShape(el, theme) {
  const t = el.text || { content: '', align: 'middle', defaultFontName: theme.fontName, defaultColor: theme.fontColor }
  const inset = t.inset || [10, 10, 10, 10]
  const flip = [el.flipH ? 'rotateY(180deg)' : '', el.flipV ? 'rotateX(180deg)' : ''].join(' ').trim()
  const o = el.outline
  const shadow = el.shadow ? `filter: drop-shadow(${el.shadow.h}px ${el.shadow.v}px ${el.shadow.blur}px ${el.shadow.color});` : ''
  const justify = { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[t.align || 'middle']
  return `<div class="el" style="left:${el.left}px;top:${el.top}px;width:${el.width}px;height:${el.height}px;">
  <div style="width:100%;height:100%;transform:rotate(${el.rotate || 0}deg)">
  <div style="width:100%;height:100%;position:relative;opacity:${el.opacity ?? 1};${shadow}${flip ? `transform:${flip};` : ''}color:${t.defaultColor};font-family:${t.defaultFontName || theme.fontName}">
    <svg overflow="visible" width="${el.width}" height="${el.height}" style="display:block;overflow:visible">
      <g transform="scale(${el.width / el.viewBox[0]}, ${el.height / el.viewBox[1]})">
        <path vector-effect="non-scaling-stroke" stroke-linecap="butt" stroke-miterlimit="8" d="${el.path}" fill="${el.fill || 'none'}"
          stroke="${o?.color || '#d14424'}" stroke-width="${o?.width ?? 0}" stroke-dasharray="${dashArrayShape(o)}"></path>
      </g>
    </svg>
    <div class="shape-text" style="justify-content:${justify};line-height:${t.lineHeight ?? 1.5};letter-spacing:${t.wordSpace || 0}px;padding:${inset.map(v => v + 'px').join(' ')};--paragraphSpace:${t.paragraphSpace ?? 5}px;${flip ? `transform:${flip};` : ''}">
      <div class="pm">${t.content || ''}</div>
    </div>
  </div></div></div>`
}

function renderText(el) {
  const inset = el.inset || [10, 10, 10, 10]
  const o = el.outline
  const outline = o && o.width ? `<svg style="position:absolute;left:0;top:0;overflow:visible" width="${el.width}" height="${el.height}"><path d="M0,0 L${el.width},0 L${el.width},${el.height} L0,${el.height} Z" fill="none" stroke="${o.color}" stroke-width="${o.width}" stroke-dasharray="${dashArrayShape(o)}"/></svg>` : ''
  const fixed = el.fixedHeight
  const justify = { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[el.vAlign || 'top']
  return `<div class="el" style="left:${el.left}px;top:${el.top}px;width:${el.width}px;height:${el.height}px;">
  <div style="width:100%;height:100%;transform:rotate(${el.rotate || 0}deg)">
  <div class="text-content" style="width:${el.width}px;height:${fixed ? el.height + 'px' : 'auto'};background-color:${el.fill || 'transparent'};opacity:${el.opacity ?? 1};line-height:${el.lineHeight ?? 1.5};letter-spacing:${el.wordSpace || 0}px;color:${el.defaultColor};font-family:${el.defaultFontName};padding:${inset.map(v => v + 'px').join(' ')};${fixed ? `display:flex;flex-direction:column;justify-content:${justify};` : ''}--paragraphSpace:${el.paragraphSpace ?? 5}px;">
    ${outline}<div class="pm" style="position:relative">${el.content}</div>
  </div></div></div>`
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])
const along = (p, q, off) => { const d = dist(p, q) || 1; return [p[0] + (q[0] - p[0]) * off / d, p[1] + (q[1] - p[1]) * off / d] }
function linePath(el, retract) {
  let s = el.start, e = el.end
  const turns = el.broken ? [el.broken] : el.curve ? [el.curve] : el.cubic ? el.cubic : []
  if (retract) {
    const off = (pt) => pt === 'arrow' ? Math.max(el.width, 2) : pt === 'dot' ? Math.max(el.width, 2) / 2 : 0
    const so = off(el.points[0]), eo = off(el.points[1])
    if (so) { const n = turns[0] || el.end; s = along(el.start, n, Math.min(so, dist(el.start, n) / 2)) }
    if (eo) { const p = turns[turns.length - 1] || el.start; e = along(el.end, p, Math.min(eo, dist(p, el.end) / 2)) }
  }
  const S = s.join(','), E = e.join(',')
  if (el.broken) return `M${S} L${el.broken.join(',')} L${E}`
  if (el.broken2) return `M${S} L${el.broken2[0]},${el.start[1]} L${el.broken2[0]},${el.end[1]} ${E}`
  if (el.curve) return `M${S} Q${el.curve.join(',')} ${E}`
  if (el.cubic) return `M${S} C${el.cubic[0].join(',')} ${el.cubic[1].join(',')} ${E}`
  return `M${S} L${E}`
}
function marker(el, pos, type) {
  const size = Math.max(el.width, 2)
  const path = type === 'dot' ? 'm0 5a5 5 0 1 0 10 0a5 5 0 1 0 -10 0z' : 'M0,0 L10,5 0,10 Z'
  const rot = type === 'arrow' && pos === 'start' ? 180 : 0
  const refX = pos === 'start' ? 0 : size * 3
  return `<marker id="${el.id}-${type}-${pos}" markerUnits="userSpaceOnUse" orient="auto" markerWidth="${size * 3}" markerHeight="${size * 3}" refX="${refX}" refY="${size * 1.5}">
    <path d="${path}" fill="${el.color}" transform="scale(${size * 0.3}, ${size * 0.3}) rotate(${rot}, 5, 5)"></path></marker>`
}
function renderLine(el) {
  const w = Math.max(Math.abs(el.start[0] - el.end[0]), 24), h = Math.max(Math.abs(el.start[1] - el.end[1]), 24)
  const [ps, pe] = el.points
  return `<div class="el" style="left:${el.left}px;top:${el.top}px;">
    <svg overflow="visible" width="${w}" height="${h}" style="overflow:visible;display:block">
      <defs>${ps ? marker(el, 'start', ps) : ''}${pe ? marker(el, 'end', pe) : ''}</defs>
      <path d="${linePath(el, true)}" stroke="${el.color}" stroke-width="${el.width}" stroke-dasharray="${dashArrayLine(el)}" fill="none"></path>
      <path d="${linePath(el, false)}" stroke="transparent" stroke-width="${el.width}" fill="none"
        ${ps ? `marker-start="url(#${el.id}-${ps}-start)"` : ''} ${pe ? `marker-end="url(#${el.id}-${pe}-end)"` : ''}></path>
    </svg></div>`
}

function renderEl(el, theme) {
  if (el.type === 'shape') return renderShape(el, theme)
  if (el.type === 'text') return renderText(el)
  if (el.type === 'line') return renderLine(el)
  if (el.type === 'image') return `<img class="el" src="${esc(el.src)}" style="left:${el.left}px;top:${el.top}px;width:${el.width}px;height:${el.height}px">`
  return `<div class="el" style="left:${el.left}px;top:${el.top}px;width:${el.width}px;height:${el.height}px;outline:1px dashed red;font:11px sans-serif">${el.type}</div>`
}

// ---------------------------------------------------------------- build steps

// Click groups: each 'click' animation opens a new step; 'meantime'/'auto' join the open one.
export function stepGroups(slide) {
  const groups = []
  for (const a of slide.animations || []) {
    if (a.trigger === 'click' || groups.length === 0) groups.push([])
    groups[groups.length - 1].push(a)
  }
  return groups
}
function visibleAt(slide, step) {
  const groups = stepGroups(slide)
  const hidden = new Set()
  const firstIn = new Map(), outs = new Map()
  groups.forEach((g, i) => g.forEach(a => {
    if (a.type === 'in' && !firstIn.has(a.elId)) firstIn.set(a.elId, i + 1)
    if (a.type === 'out') outs.set(a.elId, i + 1)
  }))
  for (const el of slide.elements) {
    const fi = firstIn.get(el.id), fo = outs.get(el.id)
    if (fi !== undefined && step < fi) hidden.add(el.id)
    if (fo !== undefined && step >= fo && (fi === undefined || fo >= fi)) hidden.add(el.id)
  }
  return hidden
}

// ---------------------------------------------------------------- page

const css = `
@import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400;1,700&family=Roboto+Mono:wght@400;700&family=Inter:wght@400;500;600&display=swap');
@import url('${pathToFileURL(resolve(here, '../fonts/fonts.css')).href}');
body { margin: 0; padding: 16px; background: #d9d9d9; font-family: Inter, sans-serif; }
.label { font: 12px Inter, sans-serif; color: #333; margin: 10px 0 4px; }
.slide { position: relative; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,.25); }
.el { position: absolute; }
.text-content { position: relative; word-break: break-word; }
.shape-text { position: absolute; left: 0; top: 0; right: 0; bottom: 0; display: flex; flex-direction: column; word-break: break-word; }
.pm { font-size: 16px; overflow-wrap: break-word; white-space: normal; }
.pm p { margin: 0; margin-top: var(--paragraphSpace); }
.pm p:first-child { margin-top: 0; }
.pm ul, .pm ol, .pm li { margin: 0; margin-top: var(--paragraphSpace); }
.pm ul, .pm ol { padding-inline-start: 1.25em; }
.grid { display: flex; flex-wrap: wrap; gap: 12px; }
.cell { background: #fff; width: 230px; height: 214px; position: relative; overflow: hidden; }
.cell .cap { position: absolute; left: 6px; right: 6px; bottom: 4px; font: 10.5px/1.25 Inter, sans-serif; color: #333; }
.cell .cap b { font-weight: 600 }
.cat { font: 600 14px Inter, sans-serif; margin: 18px 0 6px; width: 100%; }
`

function slideHtml(slide, theme, W, H, hidden = new Set()) {
  const bg = slide.background?.type === 'solid' ? slide.background.color : theme.backgroundColor
  return `<div class="slide" style="width:${W}px;height:${H}px;background:${bg}">${slide.elements.filter(e => !hidden.has(e.id)).map(e => renderEl(e, theme)).join('\n')}</div>`
}

const data = JSON.parse(readFileSync(inPath, 'utf8'))
let body = ''
if (flag('--library')) {
  const theme = { fontName: 'Libre Baskerville', fontColor: '#595959', backgroundColor: '#ffffff' }
  let cat = ''
  body += '<div class="grid">'
  for (const item of data) {
    if (item.category !== cat) { cat = item.category; body += `<div class="cat">${esc(cat)}</div>` }
    const xs = [], ys = []
    for (const e of item.elements) {
      if (e.type === 'line') { for (const p of [e.start, e.end]) { xs.push(e.left + p[0]); ys.push(e.top + p[1]) } }
      else { xs.push(e.left, e.left + e.width); ys.push(e.top, e.top + e.height) }
    }
    const w = Math.max(...xs), h = Math.max(...ys)
    const s = Math.min(210 / w, 160 / h, 2.2)
    const ox = (230 - w * s) / 2, oy = 8 + (166 - h * s) / 2
    body += `<div class="cell"><div style="position:absolute;left:${ox}px;top:${oy}px;transform:scale(${s});transform-origin:0 0;width:${w}px;height:${h}px">${item.elements.map(e => renderEl(e, theme)).join('')}</div>
      <div class="cap"><b>${esc(item.name)}</b> <span style="color:#888">${esc(item.id)}</span></div></div>`
  }
  body += '</div>'
} else {
  const W = data.width || 1000, H = data.height || 562.5
  data.slides.forEach((slide, i) => {
    const n = stepGroups(slide).length
    const steps = flag('--steps') ? [...Array(n + 1).keys()] : [n]
    for (const st of steps) {
      const meta = slide.razzle || {}
      const tag = [`slide ${i + 1}`, flag('--steps') ? `step ${st}/${n}` : `${n} steps (final)`, meta.hidden ? 'HIDDEN' : '', meta.cues?.length ? `cues: ${meta.cues.map(c => `"${c.phrase}"→${c.action}`).join(', ')}` : '']
      body += `<div class="label">${esc(tag.filter(Boolean).join(' · '))}</div>` + slideHtml(slide, data.theme, W, H, visibleAt(slide, st))
    }
  })
}

writeFileSync(outPath, `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${body}</body></html>`)
console.log('wrote', outPath)

const png = opt('--png')
if (png) {
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  const height = Number(opt('--height') || 4000)
  const width = Number(opt('--width') || 1040)
  execFileSync(chrome, ['--headless', '--disable-gpu', '--hide-scrollbars', '--virtual-time-budget=4000', `--screenshot=${resolve(png)}`, `--window-size=${width},${height}`, pathToFileURL(resolve(outPath)).href], { stdio: 'ignore' })
  console.log('wrote', png)
}
