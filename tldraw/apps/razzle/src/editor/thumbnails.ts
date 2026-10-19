// Slide thumbnails for the slides panel: each slide exported to SVG once, then re-exported
// (debounced) only when something on that slide changes. Kept as blob URLs.
import { Editor, TLRecord, TLShape, TLShapeId, atom } from 'tldraw'
import { getSlides } from '../model/slides'
import { slideOf } from './slideOps'

export class SlideThumbnails {
	/** frame id → blob URL of its current thumbnail. */
	readonly $urls = atom<Record<string, string>>('slide thumbnails', {})
	private dirty = new Set<TLShapeId>()
	private timer: ReturnType<typeof setTimeout> | undefined
	private running = false
	private disposed = false
	private unlisten: () => void

	constructor(private editor: Editor) {
		for (const s of getSlides(editor)) this.dirty.add(s.id)
		this.unlisten = editor.store.listen(
			({ changes }) => {
				const touch = (r: TLRecord) => {
					if (r.typeName !== 'shape') return
					const shape = r as TLShape
					const slide = slideOf(editor, shape.id) ?? slideOf(editor, shape.parentId as TLShapeId)
					if (slide) this.dirty.add(slide.id)
					else if (shape.type === 'frame') this.dirty.add(shape.id)
				}
				Object.values(changes.added).forEach(touch)
				Object.values(changes.updated).forEach(([from, to]) => {
					// A slide that only moved keeps its picture.
					if (from.typeName === 'shape' && (from as TLShape).type === 'frame' && onlyMoved(from as TLShape, to as TLShape)) return
					touch(from)
					touch(to)
				})
				Object.values(changes.removed).forEach(touch)
				this.schedule()
			},
			{ scope: 'document' }
		)
		this.schedule(50)
	}

	private schedule(ms = 450) {
		clearTimeout(this.timer)
		this.timer = setTimeout(() => void this.run(), ms)
	}

	private async run() {
		if (this.running || this.disposed) return
		this.running = true
		try {
			while (this.dirty.size && !this.disposed) {
				const [id] = this.dirty
				this.dirty.delete(id)
				const urls = { ...this.$urls.get() }
				if (!this.editor.getShape(id)) {
					if (urls[id]) URL.revokeObjectURL(urls[id])
					delete urls[id]
					this.$urls.set(urls)
					continue
				}
				let url: string | undefined
				try {
					const out = await this.editor.getSvgString([id], { padding: 0, background: true })
					if (out) url = URL.createObjectURL(new Blob([out.svg], { type: 'image/svg+xml' }))
				} catch {
					/* leave the old picture */
				}
				if (this.disposed) {
					if (url) URL.revokeObjectURL(url)
					return
				}
				if (url) {
					const next = { ...this.$urls.get() }
					if (next[id]) URL.revokeObjectURL(next[id])
					next[id] = url
					this.$urls.set(next)
				}
				// Let the canvas breathe between exports.
				await new Promise((r) => setTimeout(r, 16))
			}
		} finally {
			this.running = false
		}
		if (this.dirty.size && !this.disposed) this.schedule()
	}

	dispose() {
		this.disposed = true
		clearTimeout(this.timer)
		this.unlisten()
		Object.values(this.$urls.get()).forEach((u) => URL.revokeObjectURL(u))
	}
}

function onlyMoved(a: TLShape, b: TLShape) {
	return a.props === b.props && a.meta === b.meta && a.opacity === b.opacity && a.rotation === b.rotation
}
