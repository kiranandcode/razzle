// Inspector tab: build steps for the selected shapes, the steps of the current slide, and an
// in-memory preview of any step (opacity applied with CSS, never written to the document).
import { useEffect, useState } from 'react'
import { TLShape, TLShapeId, TldrawUiButton, TldrawUiButtonIcon, TldrawUiButtonLabel, useEditor, useValue } from 'tldraw'
import { buildOpacity, slideShapes, stepCount } from '../model/slides'
import { BuildMeta } from '../model/types'
import { EFFECT_LABEL, buildOf, describeStep, ownBuild, setBuild, setBuildEnd, shapesAtStep } from './builds'
import { currentSlide, slideIndexOf } from './slideOps'
import { $inspector, $previewStep } from './state'
import { BuildTimeline } from './BuildTimeline'

const EFFECTS: BuildMeta['effect'][] = ['appear', 'fade', 'disappear']

export function BuildsPanel() {
	const editor = useEditor()
	const [view, setView] = useState<'timeline' | 'list'>('timeline')
	const slide = useValue('current slide', () => currentSlide(editor), [editor])
	const steps = useValue('step count', () => (slide ? stepCount(editor, slide) : 1), [editor, slide])
	const preview = useValue($previewStep)
	const selection = useValue(
		'build selection',
		() => editor.getSelectedShapes().filter((s) => s.type !== 'frame' || s.parentId !== editor.getCurrentPageId()),
		[editor]
	)

	// Leave the preview when the slide changes or the panel closes.
	useEffect(() => {
		$previewStep.set(null)
	}, [slide?.id])
	useEffect(() => () => void $previewStep.set(null), [])

	if (!slide) return <div className="rz-empty">Add a slide to give its shapes build steps.</div>

	const builds = selection.map((s) => ownBuild(s))
	const first = builds[0]
	const allSameStep = !!first && builds.every((b) => b?.step === first.step)
	const noneHaveStep = builds.every((b) => !b)
	const allSameEffect = !!first && builds.every((b) => b?.effect === first.effect)
	const inherited = selection.length === 1 && !first ? buildOf(editor, selection[0]) : undefined
	const maxStep = steps - 1
	const timedBuilds = builds.filter((b): b is BuildMeta => !!b)
	const sameEnd = timedBuilds.every((b) => b.until === timedBuilds[0]?.until)
	const endValue = sameEnd ? String(timedBuilds[0]?.until ?? 'none') : 'mixed'
	const firstEnd = Math.max(1, ...timedBuilds.map((b) => b.step)) + 1
	const changeEnd = (end: number | 'next' | null) => {
		setBuildEnd(editor, selection.map((s) => s.id), end)
		$previewStep.set(null)
	}

	const apply = (patch: Partial<BuildMeta> | null) => {
		editor.markHistoryStoppingPoint('set build')
		if (patch === null) return setBuild(editor, selection.map((s) => s.id), null)
		for (const s of selection) {
			const b = ownBuild(s)
			const step = patch.step ?? b?.step ?? 1
			setBuild(editor, [s.id], { ...b, step, effect: patch.effect ?? b?.effect ?? 'fade', ...(b?.until === undefined ? {} : { until: b.until + step - b.step }) })
		}
	}

	return (
		<div className="rz-inspector-body">
			<section className="rz-section">
				<div className="rz-section-head">
					<span>Preview</span>
					<span className="rz-muted">
						slide {slideIndexOf(editor, slide.id) + 1} · {steps} {steps === 1 ? 'step' : 'steps'}
					</span>
				</div>
				<div className="rz-stepper">
					<TldrawUiButton
						type="icon"
						title="Previous step"
						disabled={preview === null || preview <= 0}
						onClick={() => $previewStep.set(Math.max(0, (preview ?? 0) - 1))}
					>
						<TldrawUiButtonIcon icon="chevron-left" small />
					</TldrawUiButton>
					<TldrawUiButton
						type={preview === null ? 'normal' : 'primary'}
						className="rz-stepper-label"
						onClick={() => $previewStep.set(preview === null ? 0 : null)}
						title={preview === null ? 'Show the slide as it looks at a step' : 'Stop previewing'}
					>
						<TldrawUiButtonLabel>{preview === null ? 'Preview steps' : `Step ${preview} of ${maxStep}`}</TldrawUiButtonLabel>
					</TldrawUiButton>
					<TldrawUiButton
						type="icon"
						title="Next step"
						disabled={preview !== null && preview >= maxStep}
						onClick={() => $previewStep.set(Math.min(maxStep, (preview ?? -1) + 1))}
					>
						<TldrawUiButtonIcon icon="chevron-right" small />
					</TldrawUiButton>
				</div>
			</section>

			<section className="rz-section">
				<div className="rz-section-head">
					<span>Builds on this slide</span>
					<div className="rz-segments">
						<button className="rz-seg" data-active={view === 'timeline'} onClick={() => setView('timeline')}>Timeline</button>
						<button className="rz-seg" data-active={view === 'list'} onClick={() => setView('list')}>List</button>
					</div>
				</div>
				{view === 'timeline' ? <BuildTimeline key={slide.id} slide={slide} steps={steps} /> : <StepList slide={slide} steps={steps} />}
			</section>

			<section className="rz-section">
				<div className="rz-section-head">
					<span>Selected</span>
					<span className="rz-muted">{selection.length ? `${selection.length} ${selection.length === 1 ? 'shape' : 'shapes'}` : ''}</span>
				</div>
				{selection.length === 0 ? (
					<p className="rz-hint">Select shapes on the slide to give them a build step. A step on a group applies to everything in it.</p>
				) : (
					<>
						<div className="rz-field-label">Step</div>
						<div className="rz-segments">
							<button className="rz-seg" data-active={noneHaveStep} onClick={() => apply(null)}>
								None
							</button>
							{Array.from({ length: maxStep + 1 }, (_, i) => i + 1).map((k) => (
								<button
									key={k}
									className="rz-seg"
									data-active={allSameStep && first?.step === k}
									data-new={k === maxStep + 1}
									title={k === maxStep + 1 ? 'A new step at the end' : `Step ${k}`}
									onClick={() => apply({ step: k })}
								>
									{k === maxStep + 1 ? `${k} +` : k}
								</button>
							))}
						</div>
						{!noneHaveStep && (
							<>
								<div className="rz-field-label">Effect</div>
								<div className="rz-segments">
									{EFFECTS.map((e) => (
										<button key={e} className="rz-seg" data-active={allSameEffect && first?.effect === e} onClick={() => apply({ effect: e })}>
											{EFFECT_LABEL[e]}
										</button>
									))}
								</div>
								<p className="rz-hint">
									{allSameEffect && first?.effect === 'fade' && 'Faded (the grey “not yet”) until its step, then full colour.'}
									{allSameEffect && first?.effect === 'appear' && 'Hidden until its step.'}
									{allSameEffect && first?.effect === 'disappear' && 'Shown until its step, then gone.'}
								</p>
								<label className="rz-field-label" htmlFor="rz-build-end">End at step</label>
								<select id="rz-build-end" className="rz-select" value={endValue} onChange={(e) => changeEnd(e.target.value === 'none' ? null : Number(e.target.value))}>
									{!sameEnd && <option value="mixed" disabled>Mixed</option>}
									<option value="none">No end</option>
									{Array.from({ length: Math.max(maxStep + 1, firstEnd) - firstEnd + 1 }, (_, i) => firstEnd + i).map((k) => <option key={k} value={k}>Step {k}</option>)}
								</select>
								<button className="rz-seg" style={{ marginTop: 6 }} onClick={() => changeEnd('next')}>One step only</button>
								<p className="rz-hint">
									{allSameEffect && first?.effect === 'appear' ? 'Hidden again from the end step. Choose One step only to appear now and disappear on the next click.' : 'At the end step, the object returns to its state before this effect.'}
								</p>
							</>
						)}
						{inherited && (
							<p className="rz-hint">
								Inherits step {inherited.step} ({EFFECT_LABEL[inherited.effect].toLowerCase()}) from its group.
							</p>
						)}
					</>
				)}
			</section>

		</div>
	)
}

function StepList({ slide, steps }: { slide: TLShape; steps: number }) {
	const editor = useEditor()
	const rows = useValue(
		'step rows',
		() => Array.from({ length: steps }, (_, k) => ({ k, text: describeStep(editor, slide, k), ids: k ? shapesAtStep(editor, slide, k).map((s) => s.id) : [] })),
		[editor, slide, steps]
	)
	const preview = useValue($previewStep)
	return (
		<ol className="rz-steps">
			{rows.map((r) => (
				<li
					key={r.k}
					data-active={preview === r.k}
					onClick={() => {
						if (r.ids.length) editor.select(...(r.ids as TLShapeId[]))
						if (preview !== null) $previewStep.set(r.k)
					}}
				>
					<span className="rz-step-num">{r.k}</span>
					<span className="rz-step-text">{r.text}</span>
				</li>
			))}
		</ol>
	)
}

/** On-canvas step badges for the current slide's shapes (while the Builds tab is open). */
export function BuildBadges() {
	const editor = useEditor()
	const open = useValue('builds open', () => $inspector.get() === 'builds', [])
	const badges = useValue(
		'build badges',
		() => {
			if (!open) return []
			const slide = currentSlide(editor)
			if (!slide) return []
			const step = $previewStep.get()
			const out: { id: string; x: number; y: number; build: BuildMeta; off: boolean }[] = []
			for (const s of slideShapes(editor, slide)) {
				const b = ownBuild(s)
				if (!b) continue
				const bounds = editor.getShapePageBounds(s.id)
				if (!bounds) continue
				const p = editor.pageToViewport({ x: bounds.minX, y: bounds.minY })
				out.push({ id: s.id, x: p.x, y: p.y, build: b, off: step !== null && buildOpacity(buildOf(editor, s), step) === 0 })
			}
			return out
		},
		[editor, open]
	)
	if (!badges.length) return null
	return (
		<div className="rz-badges">
			{badges.map((b) => (
				<div
					key={b.id}
					className="rz-badge"
					data-effect={b.build.effect}
					data-off={b.off}
					style={{ transform: `translate(${b.x - 15}px, ${b.y - 13}px)` }}
					title={`Step ${b.build.step}: ${EFFECT_LABEL[b.build.effect].toLowerCase()}`}
				>
					{b.build.step}
				</div>
			))}
		</div>
	)
}

/** Applies the previewed step's opacities with CSS (filter multiplies the shape's own opacity). */
export function BuildPreviewStyle() {
	const editor = useEditor()
	const css = useValue(
		'build preview css',
		() => {
			const step = $previewStep.get()
			if (step === null) return ''
			const slide = currentSlide(editor)
			if (!slide) return ''
			const rules: string[] = []
			for (const s of slideShapes(editor, slide)) {
				const o = buildOpacity(buildOf(editor, s), step)
				if (o === 1) continue
				rules.push(`.tl-shape[data-shape-id="${s.id}"]{filter:opacity(${o});${o === 0 ? 'pointer-events:none;' : ''}}`)
			}
			return rules.join('\n')
		},
		[editor]
	)
	return css ? <style>{css}</style> : null
}
