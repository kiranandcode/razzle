// Slide helpers shared by the server and the director: text extraction (v2 slide index
// and PPTist), PPTist validation (the director still writes PPTist slides), and fresh ids.

import { randomBytes } from 'node:crypto'

export type Json = Record<string, any>

export function stripHtml(html: string): string {
  return String(html ?? '')
    .replace(/<(br|\/p|\/div|\/li|\/h\d)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*/g, '\n').trim()
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Visible text of an element: a v2 slide-index element (`text` string, tldraw shape id),
 *  or a PPTist element (text boxes, shape text, table cells, chart labels, latex). */
export function elementText(el: Json): string {
  if (typeof el?.text === 'string') return el.text
  switch (el?.type) {
    case 'text': return stripHtml(el.content)
    case 'shape': return el.text?.content ? stripHtml(el.text.content) : ''
    case 'table': return (el.data ?? []).map((row: Json[]) => row.map(c => stripHtml(c?.text ?? '')).join(' | ')).join('\n')
    case 'chart': return [...(el.data?.labels ?? []), ...(el.data?.legends ?? [])].join(', ')
    case 'latex': return el.latex ?? ''
    default: return el?.name ?? ''
  }
}

export function slideText(slide: Json): string {
  return (slide?.elements ?? []).map(elementText).filter(Boolean).join('\n')
}

export function newId(n = 10): string {
  const a = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const b = randomBytes(n)
  let s = ''
  for (let i = 0; i < n; i++) s += a[b[i] % a.length]
  return s
}

const ELEMENT_TYPES = new Set(['text', 'image', 'shape', 'line', 'chart', 'table', 'latex', 'video', 'audio'])
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
const pair = (v: unknown) => Array.isArray(v) && v.length === 2 && v.every(num)

/** Structural check of a PPTist Slide. Returns a list of problems (empty = valid). */
export function validateSlide(s: unknown, canvas = { width: 1000, height: 562.5 }): string[] {
  const errs: string[] = []
  if (!s || typeof s !== 'object' || Array.isArray(s)) return ['slide is not an object']
  const slide = s as Json
  if (typeof slide.id !== 'string' || !slide.id) errs.push('slide.id must be a non-empty string')
  if (!Array.isArray(slide.elements)) return [...errs, 'slide.elements must be an array']
  if (slide.elements.length === 0) errs.push('slide.elements is empty')
  const ids = new Set<string>()
  slide.elements.forEach((el: Json, i: number) => {
    const at = `elements[${i}]`
    if (!el || typeof el !== 'object') { errs.push(`${at} is not an object`); return }
    if (!ELEMENT_TYPES.has(el.type)) errs.push(`${at}.type "${el.type}" is not a PPTist element type`)
    if (typeof el.id !== 'string' || !el.id) errs.push(`${at}.id missing`)
    else if (ids.has(el.id)) errs.push(`${at}.id duplicated`)
    else ids.add(el.id)
    for (const k of ['left', 'top', 'width']) if (!num(el[k])) errs.push(`${at}.${k} must be a number`)
    if (el.type !== 'line') {
      if (!num(el.height)) errs.push(`${at}.height must be a number`)
      if (!num(el.rotate)) errs.push(`${at}.rotate must be a number`)
    }
    if (num(el.left) && num(el.width) && (el.left > canvas.width || el.left + el.width < 0)) errs.push(`${at} is off the canvas horizontally`)
    if (num(el.top) && (el.top > canvas.height)) errs.push(`${at} is off the canvas vertically`)
    switch (el.type) {
      case 'text':
        if (typeof el.content !== 'string') errs.push(`${at}.content must be an HTML string`)
        if (typeof el.defaultFontName !== 'string') errs.push(`${at}.defaultFontName must be a string`)
        if (typeof el.defaultColor !== 'string') errs.push(`${at}.defaultColor must be a string`)
        break
      case 'shape':
        if (!pair(el.viewBox)) errs.push(`${at}.viewBox must be [w, h]`)
        if (typeof el.path !== 'string' || !el.path) errs.push(`${at}.path must be an SVG path string`)
        if (typeof el.fill !== 'string') errs.push(`${at}.fill must be a string`)
        if (typeof el.fixedRatio !== 'boolean') errs.push(`${at}.fixedRatio must be a boolean`)
        if (el.text !== undefined) {
          const t = el.text
          if (typeof t?.content !== 'string' || typeof t?.defaultFontName !== 'string' || typeof t?.defaultColor !== 'string' || !['top', 'middle', 'bottom'].includes(t?.align)) {
            errs.push(`${at}.text needs content, defaultFontName, defaultColor, align ('top'|'middle'|'bottom')`)
          }
        }
        break
      case 'line':
        if (!pair(el.start) || !pair(el.end)) errs.push(`${at}.start/end must be [x, y]`)
        if (!Array.isArray(el.points) || el.points.length !== 2) errs.push(`${at}.points must be [start, end] markers ('' | 'arrow' | 'dot')`)
        if (typeof el.color !== 'string') errs.push(`${at}.color must be a string`)
        if (!['solid', 'dashed', 'dotted'].includes(el.style)) errs.push(`${at}.style must be solid|dashed|dotted`)
        break
      case 'image':
        if (typeof el.src !== 'string' || !el.src) errs.push(`${at}.src missing`)
        if (typeof el.fixedRatio !== 'boolean') errs.push(`${at}.fixedRatio must be a boolean`)
        break
      case 'table':
        if (!Array.isArray(el.data) || !Array.isArray(el.colWidths)) errs.push(`${at} table needs data and colWidths`)
        if (!el.outline || typeof el.outline !== 'object') errs.push(`${at}.outline missing`)
        if (!num(el.cellMinHeight)) errs.push(`${at}.cellMinHeight must be a number`)
        break
      case 'latex':
        if (typeof el.latex !== 'string' || typeof el.path !== 'string' || !pair(el.viewBox)) errs.push(`${at} latex needs latex, path, viewBox`)
        break
      case 'chart':
        if (!el.data || !Array.isArray(el.data.labels) || !Array.isArray(el.data.series)) errs.push(`${at} chart needs data {labels, legends, series}`)
        break
    }
  })
  if (slide.animations !== undefined) {
    if (!Array.isArray(slide.animations)) errs.push('slide.animations must be an array')
    else slide.animations.forEach((a: Json, i: number) => {
      if (!ids.has(a?.elId)) errs.push(`animations[${i}].elId does not name an element`)
      if (!['click', 'meantime', 'auto'].includes(a?.trigger)) errs.push(`animations[${i}].trigger invalid`)
    })
  }
  if (slide.background !== undefined && !['solid', 'image', 'gradient'].includes(slide.background?.type)) errs.push('slide.background.type invalid')
  return errs
}

/** Give the slide, its elements, and its animations fresh ids (remapping references). */
export function freshIds(slide: Json): Json {
  const map = new Map<string, string>()
  const groups = new Map<string, string>()
  const elements = (slide.elements ?? []).map((el: Json) => {
    const id = newId()
    map.set(el.id, id)
    const out: Json = { ...el, id }
    if (el.groupId) {
      if (!groups.has(el.groupId)) groups.set(el.groupId, newId())
      out.groupId = groups.get(el.groupId)
    }
    return out
  })
  const animations = (slide.animations ?? []).filter((a: Json) => map.has(a.elId))
    .map((a: Json) => ({ ...a, id: newId(), elId: map.get(a.elId) }))
  const out: Json = { ...slide, id: newId(), elements }
  if (animations.length) out.animations = animations; else delete out.animations
  return out
}

// ---------- shared/library.json references ----------

export interface LibraryEntry { id: string, name?: string, category?: string, description?: string, elements: Json[], width?: number, height?: number }

export function libraryEntries(lib: unknown): LibraryEntry[] {
  const arr = Array.isArray(lib) ? lib : (lib as Json)?.items ?? (lib as Json)?.entries ?? []
  return (Array.isArray(arr) ? arr : []).filter((e: Json) => e && typeof e.id === 'string' && Array.isArray(e.elements))
}

/** Text labels of an entry, in element order (text boxes and shape text). */
export function entryLabels(e: LibraryEntry): string[] {
  return e.elements.map(el => (el.type === 'text' ? stripHtml(el.content) : el.type === 'shape' && el.text ? stripHtml(el.text.content) : null))
    .filter((x): x is string => x !== null)
}

function relabel(html: string, label: string): string {
  // put the label in the first text node, keeping its markup; drop the remaining text
  let done = false
  const out = html.replace(/>([^<]*)</g, (m, t: string) => {
    if (!t.trim()) return m
    if (done) return '><'
    done = true
    return `>${escapeHtml(label)}<`
  })
  return done ? out.replace(/<p[^>]*>(<span[^>]*>)?(<\/span>)?<\/p>/g, '') : html
}

/** Expand `{type:'library', ref, left, top, texts?}` pseudo-elements into the entry's elements,
 *  translated to (left, top), with labels replaced in order. Unknown refs are reported. */
export function expandLibraryRefs(slide: Json, lib: LibraryEntry[]): { slide: Json, errors: string[] } {
  const byId = new Map(lib.map(e => [e.id, e]))
  const errors: string[] = []
  const elements: Json[] = []
  let n = 0
  for (const el of slide.elements ?? []) {
    if (el?.type !== 'library') { elements.push(el); continue }
    const entry = byId.get(el.ref)
    if (!entry) { errors.push(`library ref "${el.ref}" does not exist`); continue }
    const dx = Number(el.left) || 0, dy = Number(el.top) || 0
    const texts: string[] = Array.isArray(el.texts) ? el.texts.map(String) : []
    let ti = 0
    const group = `lib-${n++}-${entry.id}`
    for (const src of entry.elements) {
      const c: Json = JSON.parse(JSON.stringify(src))
      c.id = `${group}-${c.id}`
      c.left = (Number(c.left) || 0) + dx
      c.top = (Number(c.top) || 0) + dy
      if (entry.elements.length > 1) c.groupId = group
      if (c.type === 'text') { if (ti < texts.length) c.content = relabel(c.content, texts[ti]); ti++ }
      else if (c.type === 'shape' && c.text) { if (ti < texts.length) c.text = { ...c.text, content: relabel(c.text.content, texts[ti]) }; ti++ }
      elements.push(c)
    }
  }
  return { slide: { ...slide, elements }, errors }
}
