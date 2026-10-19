// SVG path data utilities for razzle-path shapes and the PPTist converter.
// Pure (no DOM, no tldraw): imported by the studio and by shared/tl in Node.
//
// Paths are normalised to absolute M L C Q A Z commands; H/V become L, S/T become C/Q.

export type PathSeg =
	| { c: 'M' | 'L'; p: [number, number] }
	| { c: 'C'; p: [number, number, number, number, number, number] }
	| { c: 'Q'; p: [number, number, number, number] }
	| { c: 'A'; p: [number, number, number, number, number, number, number] } // rx ry phi large sweep x y
	| { c: 'Z'; p: [] }

const ARITY: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 }

function tokenize(d: string): (string | number)[] {
	const out: (string | number)[] = []
	const re = /([MLHVCSQTAZmlhvcsqtaz])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g
	let m: RegExpExecArray | null
	while ((m = re.exec(d))) out.push(m[1] ?? parseFloat(m[2]))
	return out
}

/** Parse path data into absolute segments. Unknown input yields what could be read. */
export function parsePath(d: string): PathSeg[] {
	const t = tokenize(d || '')
	const segs: PathSeg[] = []
	let i = 0
	let cmd = ''
	let x = 0, y = 0, sx = 0, sy = 0
	let lastC: [number, number] | null = null // last cubic control (for S)
	let lastQ: [number, number] | null = null // last quadratic control (for T)
	const num = () => {
		const v = t[i++]
		return typeof v === 'number' ? v : NaN
	}
	while (i < t.length) {
		if (typeof t[i] === 'string') cmd = t[i++] as string
		else if (!cmd) { i++; continue }
		const C = cmd.toUpperCase()
		const rel = cmd !== C
		if (C === 'Z') {
			segs.push({ c: 'Z', p: [] })
			x = sx; y = sy
			lastC = lastQ = null
			continue
		}
		if (i + ARITY[C] > t.length || t.slice(i, i + ARITY[C]).some((v) => typeof v !== 'number')) break
		const ox = rel ? x : 0, oy = rel ? y : 0
		switch (C) {
			case 'M': {
				x = ox + num(); y = oy + num()
				sx = x; sy = y
				segs.push({ c: 'M', p: [x, y] })
				cmd = rel ? 'l' : 'L' // implicit lineto after moveto
				lastC = lastQ = null
				break
			}
			case 'L': x = ox + num(); y = oy + num(); segs.push({ c: 'L', p: [x, y] }); lastC = lastQ = null; break
			case 'H': x = ox + num(); segs.push({ c: 'L', p: [x, y] }); lastC = lastQ = null; break
			case 'V': y = oy + num(); segs.push({ c: 'L', p: [x, y] }); lastC = lastQ = null; break
			case 'C': {
				const a = [ox + num(), oy + num(), ox + num(), oy + num(), ox + num(), oy + num()] as [number, number, number, number, number, number]
				segs.push({ c: 'C', p: a })
				lastC = [a[2], a[3]]; lastQ = null
				x = a[4]; y = a[5]
				break
			}
			case 'S': {
				const c1: [number, number] = lastC ? [2 * x - lastC[0], 2 * y - lastC[1]] : [x, y]
				const a = [c1[0], c1[1], ox + num(), oy + num(), ox + num(), oy + num()] as [number, number, number, number, number, number]
				segs.push({ c: 'C', p: a })
				lastC = [a[2], a[3]]; lastQ = null
				x = a[4]; y = a[5]
				break
			}
			case 'Q': {
				const a = [ox + num(), oy + num(), ox + num(), oy + num()] as [number, number, number, number]
				segs.push({ c: 'Q', p: a })
				lastQ = [a[0], a[1]]; lastC = null
				x = a[2]; y = a[3]
				break
			}
			case 'T': {
				const c1: [number, number] = lastQ ? [2 * x - lastQ[0], 2 * y - lastQ[1]] : [x, y]
				const a = [c1[0], c1[1], ox + num(), oy + num()] as [number, number, number, number]
				segs.push({ c: 'Q', p: a })
				lastQ = c1; lastC = null
				x = a[2]; y = a[3]
				break
			}
			case 'A': {
				const a = [num(), num(), num(), num(), num(), ox + num(), oy + num()] as [number, number, number, number, number, number, number]
				segs.push({ c: 'A', p: a })
				lastC = lastQ = null
				x = a[5]; y = a[6]
				break
			}
		}
	}
	return segs
}

const fmt = (v: number) => {
	const r = Math.round(v * 1000) / 1000
	return Object.is(r, -0) ? '0' : String(r)
}

export function serializePath(segs: PathSeg[]): string {
	return segs.map((s) => (s.c === 'Z' ? 'Z' : `${s.c} ${s.p.map(fmt).join(' ')}`)).join(' ')
}

/** Apply x' = ax*x + bx, y' = ay*y + by (scale, translate, flip) to a path. */
export function mapPath(segs: PathSeg[], ax: number, bx: number, ay: number, by: number): PathSeg[] {
	const X = (v: number) => ax * v + bx
	const Y = (v: number) => ay * v + by
	const mirror = ax * ay < 0
	return segs.map((s): PathSeg => {
		switch (s.c) {
			case 'M':
			case 'L':
				return { c: s.c, p: [X(s.p[0]), Y(s.p[1])] }
			case 'C':
				return { c: 'C', p: [X(s.p[0]), Y(s.p[1]), X(s.p[2]), Y(s.p[3]), X(s.p[4]), Y(s.p[5])] }
			case 'Q':
				return { c: 'Q', p: [X(s.p[0]), Y(s.p[1]), X(s.p[2]), Y(s.p[3])] }
			case 'A': {
				const [rx, ry, phi, large, sweep, x, y] = s.p
				const nphi = mirror ? -phi : phi
				return { c: 'A', p: [rx * Math.abs(ax), ry * Math.abs(ay), nphi, large, mirror ? 1 - sweep : sweep, X(x), Y(y)] }
			}
			case 'Z':
				return s
		}
	})
}

/** Scale path data from a viewBox of viewW × viewH to w × h (the PPTist shape rendering). */
export function scalePathData(d: string, viewW: number, viewH: number, w: number, h: number): string {
	const sx = viewW > 0 ? w / viewW : 1
	const sy = viewH > 0 ? h / viewH : 1
	return serializePath(mapPath(parsePath(d), sx, 0, sy, 0))
}

function arcPoints(x1: number, y1: number, rx: number, ry: number, phi: number, fa: number, fs: number, x2: number, y2: number, n = 32): [number, number][] {
	// endpoint -> centre parameterisation (SVG 1.1 F.6.5), sampled
	if (rx === 0 || ry === 0) return [[x2, y2]]
	const rad = (phi * Math.PI) / 180
	const cos = Math.cos(rad), sin = Math.sin(rad)
	const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2
	const x1p = cos * dx + sin * dy, y1p = -sin * dx + cos * dy
	rx = Math.abs(rx); ry = Math.abs(ry)
	const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
	if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam) }
	const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p
	const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p
	let co = den === 0 ? 0 : Math.sqrt(Math.max(0, num / den))
	if (fa === fs) co = -co
	const cxp = (co * rx * y1p) / ry, cyp = (-co * ry * x1p) / rx
	const cx = cos * cxp - sin * cyp + (x1 + x2) / 2
	const cy = sin * cxp + cos * cyp + (y1 + y2) / 2
	const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
	const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
	let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
	if (!fs && dt > 0) dt -= 2 * Math.PI
	if (fs && dt < 0) dt += 2 * Math.PI
	const pts: [number, number][] = []
	for (let i = 1; i <= n; i++) {
		const t = t1 + (dt * i) / n
		pts.push([cos * rx * Math.cos(t) - sin * ry * Math.sin(t) + cx, sin * rx * Math.cos(t) + cos * ry * Math.sin(t) + cy])
	}
	return pts
}

/** Points along the path (curves sampled), for bounds. */
export function pathPoints(segs: PathSeg[]): [number, number][] {
	const pts: [number, number][] = []
	let x = 0, y = 0, sx = 0, sy = 0
	for (const s of segs) {
		switch (s.c) {
			case 'M': x = sx = s.p[0]; y = sy = s.p[1]; pts.push([x, y]); break
			case 'L': x = s.p[0]; y = s.p[1]; pts.push([x, y]); break
			case 'C': {
				const [a, b, c, d, e, f] = s.p
				for (let i = 1; i <= 16; i++) {
					const t = i / 16, u = 1 - t
					pts.push([u * u * u * x + 3 * u * u * t * a + 3 * u * t * t * c + t * t * t * e, u * u * u * y + 3 * u * u * t * b + 3 * u * t * t * d + t * t * t * f])
				}
				x = e; y = f
				break
			}
			case 'Q': {
				const [a, b, c, d] = s.p
				for (let i = 1; i <= 16; i++) {
					const t = i / 16, u = 1 - t
					pts.push([u * u * x + 2 * u * t * a + t * t * c, u * u * y + 2 * u * t * b + t * t * d])
				}
				x = c; y = d
				break
			}
			case 'A': {
				const [rx, ry, phi, fa, fs, ex, ey] = s.p
				pts.push(...arcPoints(x, y, rx, ry, phi, fa, fs, ex, ey))
				x = ex; y = ey
				break
			}
			case 'Z': x = sx; y = sy; break
		}
	}
	return pts
}

export function pathBounds(segs: PathSeg[]): { x: number; y: number; w: number; h: number } {
	const pts = pathPoints(segs)
	if (!pts.length) return { x: 0, y: 0, w: 0, h: 0 }
	let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
	for (const [px, py] of pts) {
		if (px < x0) x0 = px
		if (py < y0) y0 = py
		if (px > x1) x1 = px
		if (py > y1) y1 = py
	}
	return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** PPTist's dash arrays for shape outlines (BaseShapeElement), by outline width. */
export function shapeDashArray(dash: string, width: number): string | undefined {
	if (!dash || dash === 'solid') return undefined
	if (dash === 'dashed') return width <= 6 ? `${width * 4.5} ${width * 2}` : `${width * 4} ${width * 1.5}`
	if (dash === 'dotted') return width <= 6 ? `${width * 1.8} ${width * 1.6}` : `${width * 1.5} ${width * 1.2}`
	return dash // an explicit dasharray
}
