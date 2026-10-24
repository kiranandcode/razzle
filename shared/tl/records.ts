// Minimal, validated tldraw record builders (no tldraw import: runs in the server, in
// build scripts and in the browser). Every builder fills all the fields tldraw's
// validators require; shared/tl/dev/validate.ts checks the result against the real
// schema of the fork, and the parity harness loads it into a real editor.
import { TL_SCHEMA } from './schema.ts'

export type Json = Record<string, any>

export interface SerializedSchema {
	schemaVersion: number
	sequences: Record<string, number>
}

export interface TLRecord extends Json {
	id: string
	typeName: string
}

export interface ShapeRecord extends TLRecord {
	typeName: 'shape'
	type: string
	parentId: string
	index: string
	x: number
	y: number
	rotation: number
	isLocked: boolean
	opacity: number
	props: Json
	meta: Json
}

export interface StoreSnapshot {
	store: Record<string, TLRecord>
	schema: SerializedSchema
}

export const PAGE_ID = 'page:page'
export const DOCUMENT_ID = 'document:document'

// ---------------------------------------------------------------- fractional indices
// A port of the fractional-indexing key scheme tldraw uses (base 62, integer part with a
// length head 'a'..'z', optional fraction without trailing zeros).

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const ZERO = 'a0'

function intLen(head: string): number {
	if (head >= 'a' && head <= 'z') return head.charCodeAt(0) - 'a'.charCodeAt(0) + 2
	if (head >= 'A' && head <= 'Z') return 'Z'.charCodeAt(0) - head.charCodeAt(0) + 2
	throw new Error(`invalid index key head: ${head}`)
}
function intPart(key: string): string {
	const n = intLen(key[0])
	if (n > key.length) throw new Error(`invalid index key: ${key}`)
	return key.slice(0, n)
}
function incrementInt(x: string): string | null {
	const [head, ...digs] = x.split('')
	let carry = true
	for (let i = digs.length - 1; carry && i >= 0; i--) {
		const d = DIGITS.indexOf(digs[i]) + 1
		if (d === DIGITS.length) digs[i] = '0'
		else { digs[i] = DIGITS[d]; carry = false }
	}
	if (carry) {
		if (head === 'Z') return 'a0'
		if (head === 'z') return null
		const h = String.fromCharCode(head.charCodeAt(0) + 1)
		if (h > 'a') digs.push('0')
		else digs.pop()
		return h + digs.join('')
	}
	return head + digs.join('')
}
function midpoint(a: string, b: string | null): string {
	// a < b, both fraction digit strings (no trailing zeros)
	if (b !== null && a >= b) throw new Error(`${a} >= ${b}`)
	if (b) {
		let n = 0
		while ((a[n] || '0') === b[n]) n++
		if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n))
	}
	const da = a ? DIGITS.indexOf(a[0]) : 0
	const db = b !== null ? DIGITS.indexOf(b[0]) : DIGITS.length
	if (db - da > 1) return DIGITS[Math.round(0.5 * (da + db))]
	if (b && b.length > 1) return b.slice(0, 1)
	return DIGITS[da] + midpoint(a.slice(1), null)
}

/** A key strictly between a and b (either may be null = open end). */
export function indexBetween(a: string | null, b: string | null): string {
	if (a !== null && b !== null && a >= b) throw new Error(`${a} >= ${b}`)
	if (a === null) {
		if (b === null) return ZERO
		const ib = intPart(b), fb = b.slice(ib.length)
		if (ib === 'A' + '0'.repeat(26)) return ib + midpoint('', fb)
		if (ib < b) return ib
		// decrement integer
		const [head, ...digs] = ib.split('')
		let borrow = true
		for (let i = digs.length - 1; borrow && i >= 0; i--) {
			const d = DIGITS.indexOf(digs[i]) - 1
			if (d === -1) digs[i] = DIGITS[DIGITS.length - 1]
			else { digs[i] = DIGITS[d]; borrow = false }
		}
		if (borrow) {
			if (head === 'a') return 'Z' + DIGITS[DIGITS.length - 1]
			const h = String.fromCharCode(head.charCodeAt(0) - 1)
			if (h < 'Z') digs.push(DIGITS[DIGITS.length - 1])
			else digs.pop()
			return h + digs.join('')
		}
		return head + digs.join('')
	}
	if (b === null) {
		const ia = intPart(a), fa = a.slice(ia.length)
		const inc = incrementInt(ia)
		return inc === null ? ia + midpoint(fa, null) : inc
	}
	const ia = intPart(a), fa = a.slice(ia.length)
	const ib = intPart(b), fb = b.slice(ib.length)
	if (ia === ib) return ia + midpoint(fa, fb)
	const inc = incrementInt(ia)
	if (inc === null) throw new Error('cannot increment')
	if (inc < b) return inc
	return ia + midpoint(fa, null)
}

/** n increasing keys after `after` (null = from the start: a1, a2, …). */
export function indicesAfter(after: string | null, n: number): string[] {
	const out: string[] = []
	let k = after ?? ZERO
	for (let i = 0; i < n; i++) { k = indexBetween(k, null); out.push(k) }
	return out
}

// ---------------------------------------------------------------- ids

/** tldraw ids allow any string after the prefix; keep them readable and safe. */
export function safeIdPart(s: string): string {
	return String(s).replace(/[^A-Za-z0-9_.-]+/g, '_')
}
export const shapeId = (s: string) => `shape:${safeIdPart(s)}`
export const assetId = (s: string) => `asset:${safeIdPart(s)}`

// ---------------------------------------------------------------- records

export function makeDocument(name = ''): TLRecord {
	return { id: DOCUMENT_ID, typeName: 'document', gridSize: 10, name, meta: {} }
}

export function makePage(id = PAGE_ID, name = 'Page 1', index = 'a1'): TLRecord {
	return { id, typeName: 'page', name, index, meta: {} }
}

interface BaseOpts {
	id: string
	parentId: string
	index: string
	x?: number
	y?: number
	rotation?: number
	opacity?: number
	isLocked?: boolean
	meta?: Json
}

export function makeShape(type: string, o: BaseOpts, props: Json): ShapeRecord {
	return {
		id: o.id,
		typeName: 'shape',
		type,
		parentId: o.parentId,
		index: o.index,
		x: o.x ?? 0,
		y: o.y ?? 0,
		rotation: o.rotation ?? 0,
		isLocked: o.isLocked ?? false,
		opacity: o.opacity ?? 1,
		props,
		meta: o.meta ?? {},
	}
}

export function makeFrame(o: BaseOpts & { w: number; h: number; name: string; color?: string }): ShapeRecord {
	return makeShape('frame', o, { w: o.w, h: o.h, name: o.name, color: o.color ?? 'black' })
}

export function makeGroup(o: BaseOpts): ShapeRecord {
	return makeShape('group', o, {})
}

export interface TextProps {
	richText: Json
	color: string
	size: 's' | 'm' | 'l' | 'xl'
	font: 'draw' | 'sans' | 'serif' | 'mono'
	textAlign: 'start' | 'middle' | 'end'
	w: number
	scale: number
	autoSize: boolean
}
export function makeText(o: BaseOpts, p: TextProps): ShapeRecord {
	return makeShape('text', o, {
		color: p.color, size: p.size, font: p.font, textAlign: p.textAlign,
		w: p.w, richText: p.richText, scale: p.scale, autoSize: p.autoSize,
	})
}

export interface RazzlePathRecordProps {
	w: number
	h: number
	path: string
	viewW: number
	viewH: number
	fill: string
	stroke: string
	strokeWidth: number
	dash: string
	richText: Json
	font: string
	fontSize: number
	labelColor: string
	align: 'start' | 'middle' | 'end'
	verticalAlign: 'start' | 'middle' | 'end'
	lineHeight: number
	padding: number[]
}
export const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] }
export function makeRazzlePath(o: BaseOpts, p: Partial<RazzlePathRecordProps> & Pick<RazzlePathRecordProps, 'w' | 'h' | 'path' | 'viewW' | 'viewH'>): ShapeRecord {
	return makeShape('razzle-path', o, {
		fill: 'none', stroke: 'none', strokeWidth: 0, dash: 'solid',
		richText: EMPTY_DOC, font: 'serif', fontSize: 19, labelColor: '#000000',
		align: 'middle', verticalAlign: 'middle', lineHeight: 1.3, padding: [10, 10, 10, 10],
		...p,
		w: Math.max(p.w, 0.01), h: Math.max(p.h, 0.01), viewW: Math.max(p.viewW, 0.01), viewH: Math.max(p.viewH, 0.01),
	})
}

/** `razzle-code` (tldraw/apps/razzle/src/shapes/razzleCodeSchema.ts): a highlighted code block. */
export type CodeLanguage = 'c' | 'python' | 'lean' | 'ocaml' | 'js' | 'ts' | 'rust' | 'bash' | 'json' | 'text'
export const CODE_LANGUAGES: readonly CodeLanguage[] = ['c', 'python', 'lean', 'ocaml', 'js', 'ts', 'rust', 'bash', 'json', 'text']
export interface RazzleCodeRecordProps {
	w: number
	h: number
	code: string
	language: CodeLanguage
	size: number
	background: boolean
}
const LANGUAGE_ALIASES: Record<string, CodeLanguage> = {
	javascript: 'js', typescript: 'ts', lean4: 'lean', py: 'python', sh: 'bash', shell: 'bash', shellscript: 'bash', ml: 'ocaml', rs: 'rust', plain: 'text', plaintext: 'text', while: 'js',
}
/** A language name or common alias → a razzle-code language ('text' when unknown). */
export function codeLanguage(l: unknown): CodeLanguage {
	const k = String(l ?? '').toLowerCase()
	return (CODE_LANGUAGES as readonly string[]).includes(k) ? (k as CodeLanguage) : LANGUAGE_ALIASES[k] ?? 'text'
}
export function makeRazzleCode(o: BaseOpts, p: Omit<RazzleCodeRecordProps, 'language'> & { language: string }): ShapeRecord {
	return makeShape('razzle-code', o, {
		w: Math.max(p.w, 0.01), h: Math.max(p.h, 0.01), code: p.code,
		language: codeLanguage(p.language),
		size: p.size > 0 ? p.size : 15, background: !!p.background,
	})
}

export interface StrokeStyle {
	color: string
	dash: 'draw' | 'solid' | 'dashed' | 'dotted'
	size: 's' | 'm' | 'l' | 'xl'
	scale: number
}

/** A `line` shape through points given relative to (x, y). */
export function makeLine(o: BaseOpts, s: StrokeStyle, points: [number, number][], spline: 'line' | 'cubic' = 'line'): ShapeRecord {
	const keys = indicesAfter(null, points.length)
	const pts: Json = {}
	points.forEach(([px, py], i) => { pts[keys[i]] = { id: keys[i], index: keys[i], x: px, y: py } })
	return makeShape('line', o, { color: s.color, dash: s.dash, size: s.size, spline, points: pts, scale: s.scale })
}

export type Arrowhead = 'arrow' | 'triangle' | 'square' | 'dot' | 'pipe' | 'diamond' | 'inverted' | 'bar' | 'none'
export function makeArrow(o: BaseOpts, s: StrokeStyle, a: {
	start: [number, number]; end: [number, number]; bend?: number
	arrowheadStart?: Arrowhead; arrowheadEnd?: Arrowhead; kind?: 'arc' | 'elbow'
}): ShapeRecord {
	return makeShape('arrow', o, {
		kind: a.kind ?? 'arc', labelColor: 'black', color: s.color, fill: 'none', dash: s.dash, size: s.size,
		arrowheadStart: a.arrowheadStart ?? 'none', arrowheadEnd: a.arrowheadEnd ?? 'arrow', font: 'serif',
		start: { x: a.start[0], y: a.start[1] }, end: { x: a.end[0], y: a.end[1] }, bend: a.bend ?? 0,
		richText: EMPTY_DOC, labelPosition: 0.5, scale: s.scale, elbowMidPoint: 0.5,
	})
}

export function makeImageAsset(id: string, src: string, w: number, h: number, name = 'image'): TLRecord {
	const mime = /^data:([^;,]+)/.exec(src)?.[1] ?? (/\.(png|jpe?g|gif|webp|svg)(\?|$)/i.exec(src)?.[1] ? `image/${/\.(png|jpe?g|gif|webp|svg)/i.exec(src)![1].toLowerCase().replace('jpg', 'jpeg').replace('svg', 'svg+xml')}` : null)
	return {
		id, typeName: 'asset', type: 'image',
		props: { w, h, name, isAnimated: mime === 'image/gif', mimeType: mime, src },
		meta: {},
	}
}

export function makeImage(o: BaseOpts, p: { w: number; h: number; assetId: string; flipX?: boolean; flipY?: boolean; altText?: string }): ShapeRecord {
	return makeShape('image', o, {
		w: p.w, h: p.h, playing: true, url: '', assetId: p.assetId, crop: null,
		flipX: !!p.flipX, flipY: !!p.flipY, altText: p.altText ?? '',
	})
}

// ---------------------------------------------------------------- snapshots

export function snapshotOf(records: TLRecord[], schema: SerializedSchema = TL_SCHEMA): StoreSnapshot {
	const store: Record<string, TLRecord> = {}
	for (const r of records) store[r.id] = r
	return { store, schema }
}

export function emptySnapshot(): StoreSnapshot {
	return snapshotOf([makeDocument(), makePage()])
}
