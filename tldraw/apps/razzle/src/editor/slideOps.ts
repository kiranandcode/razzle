// Slide operations on the canvas: where a new slide goes, navigating, reordering by swapping
// canvas positions (reading order = position), duplicate, delete, hide.
import { Editor, TLFrameShape, TLShape, TLShapeId, createShapeId, toRichText } from 'tldraw'
import { getSlides, slideMeta } from '../model/slides'
import { RazzleSlideMeta, SLIDE_H, SLIDE_W } from '../model/types'
import { $focusSlide } from './state'

const ROW_TOLERANCE = 40
const GAP_X = 120
const GAP_Y = 160
const MIN_PER_ROW = 5

/** The slide (root frame) a shape sits on, or the frame itself. */
export function slideOf(editor: Editor, shape: TLShape | TLShapeId | undefined): TLFrameShape | undefined {
	let s = typeof shape === 'string' ? editor.getShape(shape) : shape
	while (s) {
		if (s.type === 'frame' && s.parentId === editor.getCurrentPageId()) return s as TLFrameShape
		s = editor.getShape(s.parentId as TLShapeId)
	}
	return undefined
}

/**
 * The slide being worked on: the one holding the selection, else the one the slides panel last
 * went to while it is still in view, else the one nearest the viewport centre.
 */
export function currentSlide(editor: Editor): TLFrameShape | undefined {
	const slides = getSlides(editor)
	if (!slides.length) return undefined
	for (const id of editor.getSelectedShapeIds()) {
		const s = slideOf(editor, id)
		if (s) return s
	}
	const vp = editor.getViewportPageBounds()
	const focus = $focusSlide.get()
	if (focus) {
		const f = slides.find((s) => s.id === focus)
		const b = f && editor.getShapePageBounds(f.id)
		if (f && b && b.collides(vp)) return f
	}
	return nearestSlide(editor, slides)
}

/** The slide nearest the viewport centre. */
export function nearestSlide(editor: Editor, slides = getSlides(editor)): TLFrameShape | undefined {
	const c = editor.getViewportPageBounds().center
	let best: TLFrameShape | undefined
	let bestD = Infinity
	for (const s of slides) {
		const b = editor.getShapePageBounds(s.id)
		if (!b) continue
		const dx = Math.max(b.minX - c.x, 0, c.x - b.maxX)
		const dy = Math.max(b.minY - c.y, 0, c.y - b.maxY)
		const d = dx * dx + dy * dy - (b.containsPoint(c) ? 1e12 : 0) + Math.hypot(b.center.x - c.x, b.center.y - c.y)
		if (d < bestD) {
			bestD = d
			best = s
		}
	}
	return best
}

/** Where the next slide in reading order goes: right of the last slide, or a new row. */
export function nextSlidePosition(editor: Editor): { x: number; y: number } {
	const slides = getSlides(editor)
	if (!slides.length) return { x: 0, y: 0 }
	const rows: TLFrameShape[][] = []
	for (const s of slides) {
		const row = rows[rows.length - 1]
		if (row && Math.abs(row[0].y - s.y) <= ROW_TOLERANCE) row.push(s)
		else rows.push([s])
	}
	const perRow = Math.max(MIN_PER_ROW, ...rows.map((r) => r.length))
	const last = rows[rows.length - 1]
	const tail = last[last.length - 1]
	if (last.length < perRow) return { x: tail.x + tail.props.w + GAP_X, y: tail.y }
	const bottom = Math.max(...last.map((s) => s.y + s.props.h))
	return { x: rows[0][0].x, y: bottom + GAP_Y }
}

/** Fit a slide in the viewport (instantly, or with a very short glide). */
export function zoomToSlide(editor: Editor, frame: TLFrameShape | TLShapeId, animate = true) {
	const id = typeof frame === 'string' ? frame : frame.id
	const b = editor.getShapePageBounds(id)
	if (!b) return
	$focusSlide.set(id)
	editor.stopCameraAnimation()
	editor.zoomToBounds(b, { inset: 56, animation: animate ? { duration: 140 } : undefined })
}

export function slideNumberLabel(index: number) {
	return String(index + 1)
}

/** Make a new slide at the next reading position, with a title text. Returns its id. */
export function addSlide(editor: Editor, opts: { title?: string; at?: { x: number; y: number } } = {}): TLShapeId {
	const id = createShapeId()
	const pos = opts.at ?? nextSlidePosition(editor)
	const n = getSlides(editor).length + 1
	editor.run(() => {
		editor.createShape<TLFrameShape>({
			id,
			type: 'frame',
			x: pos.x,
			y: pos.y,
			props: { w: SLIDE_W, h: SLIDE_H, name: opts.title ?? `Slide ${n}` },
		})
		editor.createShape({
			type: 'text',
			parentId: id,
			x: 44,
			y: 22,
			props: { richText: toRichText(opts.title ?? 'Title'), size: 'l', font: 'serif', color: 'black', textAlign: 'start' },
		})
	})
	return id
}

/** Move the slide at `from` to reading position `to` by rotating canvas positions. */
export function moveSlide(editor: Editor, from: number, to: number) {
	const slides = getSlides(editor)
	if (from === to || !slides[from] || to < 0 || to >= slides.length) return
	const pos = slides.map((s) => ({ x: s.x, y: s.y }))
	const order = [...slides]
	const [m] = order.splice(from, 1)
	order.splice(to, 0, m)
	editor.run(() => {
		editor.updateShapes(order.map((s, i) => ({ id: s.id, type: 'frame' as const, x: pos[i].x, y: pos[i].y })))
	})
}

/** Duplicate a slide (with everything on it) right after itself. Returns the copy's id. */
export function duplicateSlide(editor: Editor, frameId: TLShapeId): TLShapeId | undefined {
	const slides = getSlides(editor)
	const i = slides.findIndex((s) => s.id === frameId)
	if (i < 0) return
	const pos = [...slides.map((s) => ({ x: s.x, y: s.y })), nextSlidePosition(editor)]
	let copyId: TLShapeId | undefined
	editor.run(() => {
		const before = new Set(editor.getCurrentPageShapeIds())
		editor.duplicateShapes([frameId], { x: 0, y: 0 })
		copyId = [...editor.getCurrentPageShapeIds()].find((id) => !before.has(id) && editor.getShape(id)?.parentId === editor.getCurrentPageId())
		if (!copyId) return
		const order: TLShapeId[] = slides.map((s) => s.id)
		order.splice(i + 1, 0, copyId)
		editor.updateShapes(order.map((id, k) => ({ id, type: 'frame' as const, x: pos[k].x, y: pos[k].y })))
		editor.selectNone()
	})
	return copyId
}

/** Delete a slide and close the gap (later slides move up one position). */
export function deleteSlide(editor: Editor, frameId: TLShapeId) {
	const slides = getSlides(editor)
	const i = slides.findIndex((s) => s.id === frameId)
	if (i < 0) return
	const pos = slides.map((s) => ({ x: s.x, y: s.y }))
	editor.run(() => {
		editor.deleteShapes([frameId])
		const rest = slides.filter((s) => s.id !== frameId)
		editor.updateShapes(rest.slice(i).map((s, k) => ({ id: s.id, type: 'frame' as const, x: pos[i + k].x, y: pos[i + k].y })))
	})
}

/** Merge a patch into a slide's `meta.razzle` (one undoable change). */
export function updateSlideMeta(editor: Editor, frameId: TLShapeId, patch: Partial<RazzleSlideMeta>) {
	const frame = editor.getShape(frameId)
	if (!frame) return
	const razzle = { ...slideMeta(frame), ...patch }
	for (const k of Object.keys(razzle) as (keyof RazzleSlideMeta)[]) if (razzle[k] === undefined) delete razzle[k]
	editor.updateShape({ id: frameId, type: 'frame', meta: { ...frame.meta, razzle: razzle as any } })
}

export function setSlideHidden(editor: Editor, frameId: TLShapeId, hidden: boolean) {
	updateSlideMeta(editor, frameId, { hidden: hidden || undefined })
}

/** Reading-order index of a slide among all slides (hidden included). */
export function slideIndexOf(editor: Editor, frameId: TLShapeId | undefined): number {
	if (!frameId) return 0
	return Math.max(0, getSlides(editor).findIndex((s) => s.id === frameId))
}
