// The Razzle palette as tldraw colour names: the same names and hexes as the studio theme
// (tldraw/apps/razzle/src/theme, RAZZLE_COLORS; shared/STYLE.md). Kept here as plain data so
// the converter runs without tldraw; dev/validate.ts checks the two agree. The converter
// picks the nearest name for a PPTist hex and keeps the exact hex in `meta.exact`.

export const PALETTE: Record<string, string> = {
	black: '#000000', // titles, labels inside boxes
	grey: '#595959', // body text, gray annotations, connectors
	faded: '#cccccc', // "not yet" text
	teal: '#4fafc3', // agent
	blue: '#4285f4', // second agent, blue annotation, highlighted layer
	orange: '#ffab40', // human
	aqua: '#77c7d0', // verified artefact (top layer)
	neutral: '#eeeeee', // neutral box / layer
	runtime: '#cd8484', // runtime, where the bug was
	stage: '#bde4e8', // pipeline stage
	'end-stage': '#aac8fa', // pipeline end stage
	'bubble-teal': '#b8e2e6',
	'bubble-blue': '#a8c7f9',
	'frame-blue': '#4a86e8', // dashed group frame
	'teal-ink': '#0097a7', // teal numbers and annotations
	bug: '#980000', // bugs, failures, the TCB bracket
	panel: '#dcf0f2', // result panel
	code: '#f3f3f3', // code background
	cream: '#efe8db', // Basis Blog boxes
	'cream-dark': '#e0d4c1',
	terracotta: '#dd7954',
	edge: '#ababab', // network edges
	paper: '#ffffff', // white in the picker (tldraw hides its own 'white')
	white: '#ffffff',
}

/** tldraw's base sizes in the Razzle theme (tldraw defaults; the studio theme keeps them). */
export const THEME_FONT_SIZE = 16
export const THEME_STROKE_WIDTH = 2
/** tldraw FONT_SIZES / STROKE_SIZES multipliers. */
export const FONT_SIZE_MULT = { s: 1.125, m: 1.5, l: 2.25, xl: 2.75 } as const
export const STROKE_SIZE_MULT = { s: 1, m: 1.75, l: 2.5, xl: 5 } as const
export type SizeStyle = keyof typeof FONT_SIZE_MULT

export interface Rgba {
	r: number
	g: number
	b: number
	a: number
}

const NAMED: Record<string, string> = { black: '#000000', white: '#ffffff', transparent: '#00000000' }

/** Parse #rgb, #rrggbb, #rrggbbaa, rgb(), rgba(). Null when unparseable. */
export function parseColor(c: string | undefined | null): Rgba | null {
	if (!c) return null
	let s = c.trim().toLowerCase()
	if (NAMED[s]) s = NAMED[s]
	let m = /^#([0-9a-f]{3,8})$/.exec(s)
	if (m) {
		let h = m[1]
		if (h.length === 3 || h.length === 4) h = [...h].map((x) => x + x).join('')
		if (h.length !== 6 && h.length !== 8) return null
		const n = (i: number) => parseInt(h.slice(i, i + 2), 16)
		return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 }
	}
	m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s)
	if (m) {
		const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])
		return { r: +m[1], g: +m[2], b: +m[3], a }
	}
	return null
}

export function toHex({ r, g, b }: Rgba): string {
	return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')
}

/** CSS colour → lowercase #rrggbb (alpha dropped), or null. */
export function hexOf(c: string | undefined | null): string | null {
	const p = parseColor(c)
	return p ? toHex(p) : null
}

/** True when the colour is absent or fully transparent. */
export function isClear(c: string | undefined | null): boolean {
	if (!c || c === 'none' || c === 'transparent') return true
	const p = parseColor(c)
	return !!p && p.a === 0
}

// Perceptual-ish distance (redmean), good enough to pick among a small palette.
function dist(a: Rgba, b: Rgba) {
	const rm = (a.r + b.r) / 2
	const dr = a.r - b.r, dg = a.g - b.g, db = a.b - b.b
	return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db)
}

/** The palette name nearest to a CSS colour (black when unparseable). */
export function nearestColorName(c: string | undefined | null, palette: Record<string, string> = PALETTE): string {
	const p = parseColor(c)
	if (!p) return 'black'
	let best = 'black', bd = Infinity
	for (const [name, hex] of Object.entries(palette)) {
		const d = dist(p, parseColor(hex)!)
		if (d < bd) { bd = d; best = name }
	}
	return best
}

/** Resolve a palette name or CSS colour to #rrggbb (null for 'none'/transparent). */
export function resolveColor(c: string | undefined | null, palette: Record<string, string> = PALETTE): string | null {
	if (!c || c === 'none') return null
	if (palette[c]) return palette[c]
	return isClear(c) ? null : hexOf(c)
}
