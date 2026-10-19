// Live highlight (docs/DESIGN.md, "Screens"): a hand-drawn ellipse drawn on
// around a shape (tldraw shape id) or a rect in slide coordinates, held for
// `ms` (default 2500), then faded. Drawn in slide coordinates over the stage's
// fitted slide, so it scales exactly like the slide.
import { useEffect, useRef, useState } from 'react'
import type { Editor, TLShapeId } from 'tldraw'
import { on, type Highlight as HighlightMsg } from '../model/client'
import { getSlides } from '../model/slides'
import type { FitRect } from './Stage'

const COLOR = '#e07a52'
const FADE_MS = 600

interface Mark {
	key: number
	target: string
	slideIndex: number
	paths: string[]
	fading: boolean
}

/** Deterministic pseudo-random numbers so a mark is stable while it is on screen. */
const rng = (seed: number) => () => {
	seed = (seed * 1664525 + 1013904223) % 4294967296
	return seed / 4294967296
}

/** One hand-drawn loop: starts a little off, wobbles, overshoots its start. */
function handEllipse(cx: number, cy: number, rx: number, ry: number, seed: number, turns: number) {
	const r = rng(seed)
	const start = -Math.PI / 2 - 0.5 + r() * 0.6
	const sweep = Math.PI * 2 * turns + r() * 0.25
	const p1 = r() * Math.PI * 2
	const p2 = r() * Math.PI * 2
	const tilt = (r() - 0.5) * 0.1
	const n = Math.round(96 * turns)
	const pts: string[] = []
	for (let i = 0; i <= n; i++) {
		const t = i / n
		const a = start + sweep * t
		const wobble = 1 + 0.025 * Math.sin(3 * a + p1) + 0.015 * Math.sin(5 * a + p2)
		const spiral = 1 + 0.06 * (0.5 - t) // ends a touch inside where it began
		const x0 = Math.cos(a) * rx * wobble * spiral
		const y0 = Math.sin(a) * ry * wobble * spiral
		const x = cx + x0 * Math.cos(tilt) - y0 * Math.sin(tilt)
		const y = cy + x0 * Math.sin(tilt) + y0 * Math.cos(tilt)
		pts.push(`${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`)
	}
	return pts.join(' ')
}

/** Box of a shape in slide coordinates (frame top-left = 0,0). */
function shapeBox(editor: Editor, slideIndex: number, elId: string) {
	const frame = getSlides(editor)[slideIndex]
	if (!frame) return null
	const id = (elId.startsWith('shape:') ? elId : `shape:${elId}`) as TLShapeId
	const b = editor.getShapePageBounds(id)
	const fb = editor.getShapePageBounds(frame.id)
	if (!b || !fb) return null
	return { x: b.x - fb.x, y: b.y - fb.y, w: b.w, h: b.h }
}

export function Highlights({
	editor,
	slideIndex,
	fit,
	slideW,
}: {
	editor: Editor | null
	slideIndex: number
	fit: FitRect | null
	slideW: number
}) {
	const [marks, setMarks] = useState<Mark[]>([])
	const seq = useRef(0)
	const live = useRef({ editor, slideW })
	live.current = { editor, slideW }

	useEffect(() => {
		const timers = new Set<ReturnType<typeof setTimeout>>()
		const later = (fn: () => void, ms: number) => {
			const t = setTimeout(() => {
				timers.delete(t)
				fn()
			}, ms)
			timers.add(t)
		}
		const show = (msg: HighlightMsg) => {
			const { editor, slideW } = live.current
			const box = msg.elId
				? editor && shapeBox(editor, msg.slideIndex, msg.elId)
				: msg.rect
					? { x: msg.rect[0], y: msg.rect[1], w: msg.rect[2], h: msg.rect[3] }
					: null
			if (!box) return
			const pad = 0.012 * slideW
			const cx = box.x + box.w / 2
			const cy = box.y + box.h / 2
			// Between the inscribed ellipse (w/2) and the one through the corners (w/√2):
			// loose, like a hand circling the thing, corners just inside.
			const rx = Math.max(box.w * 0.66 + pad, 22)
			const ry = Math.max(box.h * 0.64 + pad, 18)
			const key = ++seq.current
			const seed = key * 7919 + Math.round(cx)
			const target = msg.elId ?? msg.rect!.join(',')
			const mark: Mark = {
				key,
				target,
				slideIndex: msg.slideIndex,
				paths: [
					handEllipse(cx, cy, rx, ry, seed, 1.06),
					handEllipse(cx, cy, rx * 1.025, ry * 0.975, seed + 31, 1.0),
				],
				fading: false,
			}
			// A repeated highlight of the same target replaces the one on screen.
			setMarks((ms) => [...ms.filter((m) => m.target !== target || m.slideIndex !== msg.slideIndex), mark])
			const hold = msg.ms ?? 2500
			later(() => setMarks((ms) => ms.map((m) => (m.key === key ? { ...m, fading: true } : m))), hold)
			later(() => setMarks((ms) => ms.filter((m) => m.key !== key)), hold + FADE_MS)
		}
		const off = on('highlight', show)
		return () => {
			off()
			timers.forEach(clearTimeout)
		}
	}, [])

	// A slide change drops marks meant for other slides.
	useEffect(() => {
		setMarks((ms) => (ms.some((m) => m.slideIndex !== slideIndex) ? ms.filter((m) => m.slideIndex === slideIndex) : ms))
	}, [slideIndex])

	const visible = marks.filter((m) => m.slideIndex === slideIndex)
	if (!fit || !visible.length) return null
	const w = fit.width / fit.z
	const h = fit.height / fit.z
	const sw = 4 / fit.z
	return (
		<svg
			className="rz-highlight"
			style={{ left: fit.left, top: fit.top, width: fit.width, height: fit.height }}
			viewBox={`0 0 ${w} ${h}`}
			aria-hidden="true"
		>
			{visible.map((m) => (
				<g key={m.key} className={`rz-mark${m.fading ? ' rz-fading' : ''}`}>
					<path d={m.paths[0]} pathLength={1} fill="none" stroke={COLOR} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
					<path
						className="rz-second"
						d={m.paths[1]}
						pathLength={1}
						fill="none"
						stroke={COLOR}
						strokeWidth={sw * 0.55}
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</g>
			))}
		</svg>
	)
}
