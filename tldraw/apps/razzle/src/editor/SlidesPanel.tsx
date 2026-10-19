// Left panel: the slides in reading order, with thumbnails. Click to go to a slide; drag to
// reorder (swaps canvas positions); hover for hide / duplicate / delete.
import { useEffect, useRef, useState } from 'react'
import { TLShapeId, TldrawUiButton, TldrawUiButtonIcon, useEditor, useValue } from 'tldraw'
import { getSlides, isHidden } from '../model/slides'
import { addSlide, currentSlide, deleteSlide, duplicateSlide, moveSlide, setSlideHidden, zoomToSlide } from './slideOps'
import { SlideThumbnails } from './thumbnails'

export function SlidesPanel() {
	const editor = useEditor()
	const [thumbs, setThumbs] = useState<SlideThumbnails | null>(null)
	useEffect(() => {
		const t = new SlideThumbnails(editor)
		setThumbs(t)
		return () => t.dispose()
	}, [editor])

	const slides = useValue(
		'slides',
		() => getSlides(editor).map((s) => ({ id: s.id, name: s.props.name, hidden: isHidden(s) })),
		[editor]
	)
	const current = useValue('current slide', () => currentSlide(editor)?.id, [editor])
	const urls = useValue('thumbs', () => thumbs?.$urls.get() ?? {}, [thumbs])

	const [drag, setDrag] = useState<{ from: number; over: number } | null>(null)
	const listRef = useRef<HTMLDivElement>(null)

	// Keep the current slide in view in the list.
	useEffect(() => {
		const el = listRef.current?.querySelector(`[data-slide-id="${current}"]`)
		el?.scrollIntoView({ block: 'nearest' })
	}, [current])

	let visible = 0
	return (
		<div className="rz-slides" onPointerDown={(e) => e.stopPropagation()}>
			<div className="rz-panel-head">
				<span className="rz-panel-title">Slides</span>
				<span className="rz-panel-count">{slides.length}</span>
				<TldrawUiButton
					type="icon"
					title="New slide (S)"
					onClick={() => {
						editor.markHistoryStoppingPoint('add slide')
						const id = addSlide(editor)
						zoomToSlide(editor, id)
					}}
				>
					<TldrawUiButtonIcon icon="plus" small />
				</TldrawUiButton>
			</div>
			<div
				className="rz-slides-list"
				ref={listRef}
				onDragOver={(e) => {
					if (!drag) return
					e.preventDefault()
					e.dataTransfer.dropEffect = 'move'
				}}
				onDrop={(e) => {
					if (!drag) return
					e.preventDefault()
					const to = drag.over > drag.from ? drag.over - 1 : drag.over
					if (to !== drag.from) {
						editor.markHistoryStoppingPoint('reorder slides')
						moveSlide(editor, drag.from, to)
					}
					setDrag(null)
				}}
			>
				{slides.map((s, i) => {
					const label = s.hidden ? '' : String(++visible)
					const dropBefore = drag && drag.over === i && drag.from !== i && drag.from !== i - 1
					const dropAfter = drag && i === slides.length - 1 && drag.over === slides.length && drag.from !== i
					return (
						<div
							key={s.id}
							data-slide-id={s.id}
							className="rz-slide-item"
							data-current={current === s.id}
							data-hidden={s.hidden}
							data-drop-before={!!dropBefore}
							data-drop-after={!!dropAfter}
							draggable
							onDragStart={(e) => {
								e.dataTransfer.effectAllowed = 'move'
								e.dataTransfer.setData('application/x-razzle-slide', s.id)
								setDrag({ from: i, over: i })
							}}
							onDragEnd={() => setDrag(null)}
							onDragOver={(e) => {
								if (!drag) return
								const r = e.currentTarget.getBoundingClientRect()
								const over = e.clientY < r.top + r.height / 2 ? i : i + 1
								if (over !== drag.over) setDrag({ ...drag, over })
							}}
							onClick={() => zoomToSlide(editor, s.id as TLShapeId)}
						>
							<div className="rz-slide-num" title={s.hidden ? 'Hidden slide: skipped by next/prev' : undefined}>
								{s.hidden ? <TldrawUiButtonIcon icon="rz-eye-off" small /> : label}
							</div>
							<div className="rz-slide-thumb">
								{urls[s.id] ? <img src={urls[s.id]} alt="" draggable={false} /> : <div className="rz-thumb-blank" />}
								<div className="rz-slide-actions">
									<TldrawUiButton
										type="icon"
										title={s.hidden ? 'Show in the talk' : 'Hide (skip in the talk)'}
										onClick={(e) => {
											e.stopPropagation()
											editor.markHistoryStoppingPoint('hide slide')
											setSlideHidden(editor, s.id as TLShapeId, !s.hidden)
										}}
									>
										<TldrawUiButtonIcon icon={s.hidden ? 'rz-eye' : 'rz-eye-off'} small />
									</TldrawUiButton>
									<TldrawUiButton
										type="icon"
										title="Duplicate"
										onClick={(e) => {
											e.stopPropagation()
											editor.markHistoryStoppingPoint('duplicate slide')
											const id = duplicateSlide(editor, s.id as TLShapeId)
											if (id) zoomToSlide(editor, id)
										}}
									>
										<TldrawUiButtonIcon icon="duplicate" small />
									</TldrawUiButton>
									<TldrawUiButton
										type="icon"
										title="Delete"
										onClick={(e) => {
											e.stopPropagation()
											editor.markHistoryStoppingPoint('delete slide')
											deleteSlide(editor, s.id as TLShapeId)
										}}
									>
										<TldrawUiButtonIcon icon="trash" small />
									</TldrawUiButton>
								</div>
							</div>
						</div>
					)
				})}
				{slides.length === 0 && <div className="rz-empty">No slides yet. Press S or + to add one.</div>}
			</div>
		</div>
	)
}

/** All slide frames' ids in reading order (for keyboard navigation). */
export function slideIds(editor: ReturnType<typeof useEditor>) {
	return getSlides(editor).map((s) => s.id)
}
