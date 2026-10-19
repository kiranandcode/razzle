// Left drawer: the shape library, grouped by category (cue glyphs first), with SVG previews.
// Click puts an item on the current slide; drag drops it where you let go.
import { useEffect, useMemo, useState } from 'react'
import { Editor, Tldraw, TldrawUiButton, TldrawUiButtonIcon, atom, useEditor, useValue } from 'tldraw'
import { editorShapeUtils } from '../shapes'
import { tldrawThemeProps } from '../theme'
import { LibraryItem, groupByCategory, insertLibraryItem, instantiate, loadLibrary } from './library'
import { currentSlide } from './slideOps'
import { $libraryOpen } from './state'

export const LIBRARY_DRAG_TYPE = 'application/x-razzle-library'

/** item id → preview blob URL (kept for the whole session). */
const $previews = atom<Record<string, string>>('library previews', {})
let byId = new Map<string, LibraryItem>()

export function libraryItem(id: string) {
	return byId.get(id)
}

export function LibraryPanel() {
	const editor = useEditor()
	const [items, setItems] = useState<LibraryItem[] | null>(null)
	const [query, setQuery] = useState('')
	useEffect(() => {
		let live = true
		loadLibrary().then((it) => {
			if (!live) return
			byId = new Map(it.map((x) => [x.id, x]))
			setItems(it)
		})
		return () => {
			live = false
		}
	}, [])
	const previews = useValue($previews)

	const groups = useMemo(() => {
		if (!items) return []
		const q = query.trim().toLowerCase()
		const hit = (it: LibraryItem) => !q || `${it.name} ${it.category} ${it.description ?? ''}`.toLowerCase().includes(q)
		return groupByCategory(items.filter(hit))
	}, [items, query])

	const missing = useMemo(() => (items ?? []).filter((it) => !previews[it.id]), [items, previews])

	return (
		<div className="rz-library" onPointerDown={(e) => e.stopPropagation()}>
			<div className="rz-panel-head">
				<span className="rz-panel-title">Library</span>
				<span className="rz-panel-count">{items?.length ?? ''}</span>
				<TldrawUiButton type="icon" title="Close (L)" onClick={() => $libraryOpen.set(false)}>
					<TldrawUiButtonIcon icon="cross-2" small />
				</TldrawUiButton>
			</div>
			<div className="rz-library-search">
				<input className="rz-input" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
			</div>
			<div className="rz-library-list">
				{items === null && <div className="rz-empty">Loading…</div>}
				{items?.length === 0 && (
					<div className="rz-empty">
						The library is empty. It appears here once <code>shared/library.tldraw.json</code> exists.
					</div>
				)}
				{groups.map(([category, list]) => (
					<div key={category} className="rz-library-group">
						<div className="rz-library-cat">{category}</div>
						<div className="rz-library-grid">
							{list.map((it) => (
								<button
									key={it.id}
									className="rz-library-item"
									title={it.description ? `${it.name}: ${it.description}` : it.name}
									draggable
									onDragStart={(e) => {
										e.dataTransfer.setData(LIBRARY_DRAG_TYPE, it.id)
										e.dataTransfer.effectAllowed = 'copy'
									}}
									onClick={() => insertLibraryItem(editor, it, undefined, currentSlide(editor)?.id)}
								>
									<div className="rz-library-preview">{previews[it.id] ? <img src={previews[it.id]} alt="" draggable={false} /> : null}</div>
									<div className="rz-library-name">{it.name}</div>
								</button>
							))}
						</div>
					</div>
				))}
			</div>
			{missing.length > 0 && <PreviewRenderer items={missing} />}
		</div>
	)
}

/** A hidden editor that renders each item once to SVG. */
function PreviewRenderer({ items }: { items: LibraryItem[] }) {
	const [editor, setEditor] = useState<Editor | null>(null)
	useEffect(() => {
		if (!editor) return
		let live = true
		;(async () => {
			for (const it of items) {
				if (!live) return
				if ($previews.get()[it.id]) continue
				try {
					const { shapes, top } = instantiate(it, editor.getCurrentPageId(), 0, 0)
					editor.run(() => editor.createShapes(shapes), { history: 'ignore' })
					const out = await editor.getSvgString(top, { padding: 4, background: false })
					editor.run(() => editor.deleteShapes(top), { history: 'ignore' })
					if (out && live) {
						const url = URL.createObjectURL(new Blob([out.svg], { type: 'image/svg+xml' }))
						$previews.set({ ...$previews.get(), [it.id]: url })
					}
				} catch {
					/* skip this item */
				}
			}
		})()
		return () => {
			live = false
		}
	}, [editor, items])
	return (
		<div className="rz-hidden-editor" aria-hidden>
			<Tldraw hideUi autoFocus={false} shapeUtils={editorShapeUtils} {...tldrawThemeProps} onMount={setEditor} />
		</div>
	)
}
