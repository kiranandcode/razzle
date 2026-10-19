// CSS colour → hex for formats (PPTX) that take plain sRGB hex.

export interface Rgba {
	hex: string // 'RRGGBB', no '#'
	alpha: number // 0..1
}

let ctx: CanvasRenderingContext2D | null = null
const cache = new Map<string, Rgba | null>()

/** Resolve any CSS colour (hex, rgb(), oklch(), named …) to sRGB hex + alpha; null if transparent/invalid. */
export function cssToRgba(css: string | undefined | null): Rgba | null {
	if (!css || css === 'transparent' || css === 'none') return null
	const hit = cache.get(css)
	if (hit !== undefined) return hit
	let out: Rgba | null = null
	const m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(css.trim())
	if (m) {
		let h = m[1]
		if (h.length === 3) h = [...h].map((c) => c + c).join('')
		out = { hex: h.slice(0, 6).toUpperCase(), alpha: h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1 }
	} else {
		ctx ??= Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', {
			willReadFrequently: true,
		})
		if (ctx) {
			ctx.clearRect(0, 0, 1, 1)
			ctx.fillStyle = '#000'
			ctx.fillStyle = css
			ctx.fillRect(0, 0, 1, 1)
			const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
			if (a > 0) {
				// getImageData is premultiplied-free (straight alpha) in Chrome; round-trip is exact for a=255.
				out = { hex: [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase(), alpha: a / 255 }
			}
		}
	}
	cache.set(css, out)
	return out
}

/** `fg` at `alpha` over the opaque `bg`, as hex. */
export function blendHex(fg: string, bg: string, alpha: number): string {
	if (alpha >= 1) return fg
	const p = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16)
	return [0, 2, 4]
		.map((i) => Math.round(p(fg, i) * alpha + p(bg, i) * (1 - alpha)))
		.map((v) => v.toString(16).padStart(2, '0'))
		.join('')
		.toUpperCase()
}

/** PPTX transparency percentage (0 opaque … 100 clear) for an alpha. */
export const transparencyOf = (alpha: number) => Math.round(Math.max(0, Math.min(1, 1 - alpha)) * 100)
