import { useRef, useState } from 'react'
import { TLShape, TLShapeId, useEditor, useValue } from 'tldraw'
import { slideShapes } from '../model/slides'
import { EFFECT_LABEL, insertBuildStep, moveBuilds, ownBuild, setBuild, shapeLabel } from './builds'
import { $previewStep } from './state'

const CELL = 36

export function BuildTimeline({ slide, steps }: { slide: TLShape; steps: number }) {
	const editor = useEditor()
	const selected = useValue('timeline selection', () => editor.getSelectedShapeIds(), [editor])
	const rows = useValue(
		'timeline rows',
		() =>
			slideShapes(editor, slide)
				.filter(
					(shape) => ownBuild(shape) || (selected.includes(shape.id) && shape.type !== 'frame')
				)
				.map((shape) => ({
					id: shape.id,
					label: shapeLabel(editor, shape),
					build: ownBuild(shape),
				})),
		[editor, slide, selected]
	)
	const preview = useValue($previewStep)
	const [drag, setDrag] = useState<{ ids: TLShapeId[]; delta: number } | null>(null)
	const gesture = useRef<{ ids: TLShapeId[]; x: number; min: number; delta: number } | null>(null)
	const animated = rows.filter((row) => selected.includes(row.id) && row.build)
	const selectedIds = rows.filter((row) => selected.includes(row.id)).map((row) => row.id)
	const nudge = (delta: number) => {
		moveBuilds(
			editor,
			animated.map((r) => r.id),
			delta
		)
		$previewStep.set(null)
	}
	const columns = Array.from({ length: steps + 1 }, (_, step) => step)
	const select = (id: TLShapeId, shift: boolean) => {
		if (shift)
			editor.setSelectedShapes(
				selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]
			)
		else editor.select(id)
	}
	const assign = (id: TLShapeId, step: number) => {
		const shape = editor.getShape(id)
		if (!shape) return
		const build = ownBuild(shape)
		const ids = selected.includes(id) ? selectedIds : [id]
		if (build) moveBuilds(editor, ids, step - build.step)
		else {
			editor.markHistoryStoppingPoint('assign build')
			setBuild(editor, [id], { step, effect: 'appear' })
		}
		if ($previewStep.get() !== null) $previewStep.set(null)
	}

	return (
		<>
			<p className="rz-hint">
				Shift-click to select several builds, then drag them together. Use + to insert a step for the selection and shift later builds.
			</p>
			<div className="rz-timeline-actions">
				<button
					className="rz-seg"
					disabled={!animated.length || animated.some((r) => r.build!.step <= 1)}
					onClick={() => nudge(-1)}
				>
					← Earlier
				</button>
				<button className="rz-seg" disabled={!animated.length} onClick={() => nudge(1)}>
					Later →
				</button>
			</div>
			<div className="rz-build-timeline" onKeyDown={(e) => {
				if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'Enter', 'Escape'].includes(e.key)) e.stopPropagation()
			}}>
				<div
					className="rz-timeline-grid"
					style={{ gridTemplateColumns: `104px repeat(${columns.length}, ${CELL}px)` }}
				>
					<div className="rz-timeline-label rz-timeline-heading">Object / step</div>
					{columns.map((step) => (
						<div
							key={`head-${step}`}
							className="rz-timeline-heading"
							data-preview={preview === step}
						>
							<button
								className="rz-timeline-step"
								disabled={step === steps}
								onClick={() => $previewStep.set(preview === step ? null : step)}
								title={`Preview step ${step}`}
							>
								{step}
							</button>
							{step > 0 && (
								<button
									className="rz-timeline-insert"
									title={`Insert step ${step}${selectedIds.length ? ' for selected objects' : ''}; shift later builds`}
									onClick={() => {
										insertBuildStep(editor, slide, step, selectedIds)
										$previewStep.set(null)
									}}
								>
									+
								</button>
							)}
						</div>
					))}
					{rows.map((row) => {
						const offset = drag?.ids.includes(row.id) ? drag.delta : 0
						const step = row.build ? row.build.step + offset : undefined
						const until = row.build?.until === undefined ? undefined : row.build.until + offset
						return (
							<div
								key={row.id}
								className="rz-timeline-row"
								data-selected={selected.includes(row.id)}
							>
								<button
									className="rz-timeline-label"
									title={row.label}
									onClick={(e) => select(row.id, e.shiftKey)}
								>
									{row.label}
								</button>
								{columns.map((column) => (
									<div
										key={column}
										className="rz-timeline-cell"
										data-preview={preview === column}
										data-span={
											step !== undefined && until !== undefined && column > step && column < until
										}
									>
										{column > 0 ? (
											<button
												className="rz-timeline-slot"
												title={`Set ${row.label} to step ${column}`}
												onClick={() => assign(row.id, column)}
											>
												{column === until ? '│' : ''}
											</button>
										) : null}
									</div>
								))}
								{row.build && (
									<button
										className="rz-timeline-build"
										data-effect={row.build!.effect}
										style={{ left: 104 + (step ?? 0) * CELL }}
										title={`${row.label}: ${EFFECT_LABEL[row.build!.effect]} at step ${step}${until === undefined ? '' : `, ends at ${until}`}. Drag or use arrow keys.`}
										onPointerDown={(e) => {
											if (e.button !== 0) return
											if (e.shiftKey) {
												select(row.id, true)
												return
											}
											const ids = selected.includes(row.id) ? animated.map((r) => r.id) : [row.id]
											if (!selected.includes(row.id)) editor.select(row.id)
											const min = Math.min(...ids.map((id) => ownBuild(editor.getShape(id)!)!.step))
											gesture.current = { ids, x: e.clientX, min, delta: 0 }
											e.currentTarget.setPointerCapture(e.pointerId)
										}}
										onPointerMove={(e) => {
											const g = gesture.current
											if (!g) return
											const delta = Math.max(1 - g.min, Math.round((e.clientX - g.x) / CELL))
											if (delta !== g.delta) {
												g.delta = delta
												setDrag({ ids: g.ids, delta })
											}
										}}
										onPointerUp={() => {
											const g = gesture.current
											gesture.current = null
											setDrag(null)
											if (g?.delta) {
												moveBuilds(editor, g.ids, g.delta)
												$previewStep.set(null)
											}
										}}
										onLostPointerCapture={() => {
											gesture.current = null
											setDrag(null)
										}}
										onPointerCancel={() => {
											gesture.current = null
											setDrag(null)
										}}
										onKeyDown={(e) => {
											if (e.key === 'Escape') {
												gesture.current = null
												setDrag(null)
												return
											}
											if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
											e.preventDefault()
											moveBuilds(
												editor,
												selected.includes(row.id) ? animated.map((r) => r.id) : [row.id],
												e.key === 'ArrowLeft' ? -1 : 1
											)
											$previewStep.set(null)
										}}
									>
										{row.build!.effect === 'disappear' ? '−' : '●'}
									</button>
								)}
							</div>
						)
					})}
				</div>
			</div>
			{!rows.length && (
				<p className="rz-hint">Select an object, then click a step to add its first build.</p>
			)}
		</>
	)
}
