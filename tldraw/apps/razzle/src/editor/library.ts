// The shape library (shared/library.tldraw.json, made by the PPTist converter): loading,
// and turning an item into fresh shapes on a slide.
import { Editor, TLBindingId, TLShapeId, TLShapePartial, createBindingId, createShapeId } from 'tldraw'
import { slideOf } from './slideOps'

export interface LibraryItem {
	id: string
	name: string
	category: string
	description?: string
	width: number
	height: number
	/** Parentless shapes positioned from (0, 0); groups via parent ids within the item. */
	shapes: TLShapePartial[]
	bindings?: { id: string; type: string; fromId: string; toId: string; props?: Record<string, unknown>; meta?: Record<string, unknown> }[]
}

const SOURCES = ['/razzle-shared/library.tldraw.json', '/api/library?format=tldraw']

let cached: Promise<LibraryItem[]> | null = null

/** The library items (empty until the converter has produced the file). */
export function loadLibrary(): Promise<LibraryItem[]> {
	cached ??= (async () => {
		for (const url of SOURCES) {
			try {
				const r = await fetch(url)
				if (!r.ok) continue
				const data = await r.json()
				const items = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : null
				if (items?.length && Array.isArray(items[0].shapes)) return items as LibraryItem[]
			} catch {
				/* try the next source */
			}
		}
		cached = null // look again next time the drawer opens
		return []
	})()
	return cached
}

/** Category order: cue glyphs first, then as they appear in the file. */
export function groupByCategory(items: LibraryItem[]): [string, LibraryItem[]][] {
	const groups = new Map<string, LibraryItem[]>()
	for (const it of items) groups.set(it.category, [...(groups.get(it.category) ?? []), it])
	const rank = (c: string) => (/glyph|cue/i.test(c) ? 0 : 1)
	return [...groups].sort((a, b) => rank(a[0]) - rank(b[0]))
}

/**
 * Fresh shapes for an item: new ids, internal parents remapped, top-level shapes parented to
 * `parentId` and offset by (x, y) in that parent's space. Parents come before children and
 * siblings keep their stacking order.
 */
export function instantiate(item: LibraryItem, parentId: TLShapePartial['parentId'], x: number, y: number) {
	const ids = new Map<string, TLShapeId>()
	for (const s of item.shapes) ids.set(String(s.id), createShapeId())
	const byParent = new Map<string, TLShapePartial[]>()
	for (const s of item.shapes) {
		const p = s.parentId && ids.has(String(s.parentId)) ? String(s.parentId) : ''
		byParent.set(p, [...(byParent.get(p) ?? []), s])
	}
	const out: TLShapePartial[] = []
	const visit = (p: string) => {
		const kids = [...(byParent.get(p) ?? [])].sort((a, b) => ((a.index ?? '') < (b.index ?? '') ? -1 : (a.index ?? '') > (b.index ?? '') ? 1 : 0))
		for (const s of kids) {
			const top = p === ''
			const { index: _index, ...rest } = s as TLShapePartial & { index?: string }
			out.push({
				...rest,
				id: ids.get(String(s.id))!,
				parentId: top ? parentId : ids.get(p)!,
				x: (s.x ?? 0) + (top ? x : 0),
				y: (s.y ?? 0) + (top ? y : 0),
			} as TLShapePartial)
			visit(String(s.id))
		}
	}
	visit('')
	const bindings = (item.bindings ?? [])
		.filter((b) => ids.has(b.fromId) && ids.has(b.toId))
		.map((b) => ({ ...b, id: createBindingId() as TLBindingId, fromId: ids.get(b.fromId)!, toId: ids.get(b.toId)! }))
	const top = out.filter((s) => s.parentId === parentId).map((s) => s.id)
	return { shapes: out, bindings, top }
}

/**
 * Put an item on the canvas centred at `pagePoint` (default: the centre of the view if it is
 * on the current slide, else the slide's centre). It goes into the slide under that point.
 */
export function insertLibraryItem(editor: Editor, item: LibraryItem, pagePoint?: { x: number; y: number }, slideId?: TLShapeId) {
	let point = pagePoint
	let slide = slideId ? editor.getShape(slideId) : undefined
	if (!point) {
		const vc = editor.getViewportPageBounds().center
		const sb = slide && editor.getShapePageBounds(slide.id)
		point = sb && !sb.containsPoint(vc) ? sb.center : vc
	}
	if (pagePoint || !slide) {
		const hit = editor.getShapeAtPoint(point, { hitInside: true, hitFrameInside: true, filter: (s) => s.type === 'frame' })
		slide = (hit && slideOf(editor, hit)) ?? slide
	}
	const parentId = slide?.id ?? editor.getCurrentPageId()
	const origin = slide ? editor.getShapePageTransform(slide.id)!.clone().invert().applyToPoint(point) : point
	const { shapes, bindings, top } = instantiate(item, parentId, origin.x - item.width / 2, origin.y - item.height / 2)
	editor.markHistoryStoppingPoint('insert from library')
	editor.run(() => {
		editor.createShapes(shapes)
		if (bindings.length) editor.createBindings(bindings as any)
		editor.select(...(top as TLShapeId[]))
	})
}
