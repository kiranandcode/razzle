// Inspector tab: what is said on the current slide. Script per build step, spoken cues, hidden
// and auto-advance switches. Everything lives in the frame's `meta.razzle` (undoable edits).
import { useEffect, useRef, useState } from 'react'
import { TLFrameShape, TldrawUiButton, TldrawUiButtonIcon, TldrawUiButtonLabel, uniqueId, useEditor, useValue } from 'tldraw'
import { slideMeta, stepCount } from '../model/slides'
import { RazzleCue } from '../model/types'
import { notesHtml, notesText } from '../model/noteText'
import { describeStep } from './builds'
import { currentSlide, slideIndexOf, updateSlideMeta } from './slideOps'

/** A text field that commits on blur and shortly after typing stops, and follows outside changes. */
function useCommitted(value: string, commit: (v: string) => void, delay = 600) {
	const [local, setLocal] = useState(value)
	const focused = useRef(false)
	const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
	const latest = useRef(commit)
	latest.current = commit
	useEffect(() => {
		if (!focused.current) setLocal(value)
	}, [value])
	useEffect(() => () => clearTimeout(timer.current), [])
	return {
		value: local,
		onFocus: () => (focused.current = true),
		onChange: (e: { target: { value: string } }) => {
			const v = e.target.value
			setLocal(v)
			clearTimeout(timer.current)
			timer.current = setTimeout(() => latest.current(v), delay)
		},
		onBlur: () => {
			focused.current = false
			clearTimeout(timer.current)
			if (local !== value) latest.current(local)
		},
		// Keys typed here are for the field, not the canvas.
		onKeyDown: (e: React.KeyboardEvent) => e.stopPropagation(),
	}
}

function TextArea({ value, onCommit, placeholder, rows = 2 }: { value: string; onCommit(v: string): void; placeholder?: string; rows?: number }) {
	const f = useCommitted(value, onCommit)
	const ref = useRef<HTMLTextAreaElement>(null)
	useEffect(() => {
		const el = ref.current
		if (!el) return
		el.style.height = 'auto'
		el.style.height = `${el.scrollHeight + 2}px`
	}, [f.value])
	return <textarea ref={ref} className="rz-textarea" rows={rows} placeholder={placeholder} {...f} />
}

function TextInput({ value, onCommit, placeholder, className }: { value: string; onCommit(v: string): void; placeholder?: string; className?: string }) {
	const f = useCommitted(value, onCommit, 500)
	return <input className={className ?? 'rz-input'} placeholder={placeholder} {...f} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
}

function Switch({ on, onChange, label, hint }: { on: boolean; onChange(v: boolean): void; label: string; hint?: string }) {
	return (
		<label className="rz-switch" title={hint}>
			<input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
			<span className="rz-switch-track" />
			<span>{label}</span>
		</label>
	)
}

export function SpeechPanel() {
	const editor = useEditor()
	const slide = useValue('current slide', () => currentSlide(editor), [editor]) as TLFrameShape | undefined
	const steps = useValue('steps', () => (slide ? stepCount(editor, slide) : 1), [editor, slide])
	const labels = useValue('step labels', () => (slide ? Array.from({ length: steps }, (_, k) => describeStep(editor, slide, k)) : []), [editor, slide, steps])
	if (!slide) return <div className="rz-empty">Add a slide to write what you say on it.</div>

	const meta = slideMeta(slide)
	const script = meta.script ?? []
	const cues = meta.cues ?? []
	const index = slideIndexOf(editor, slide.id)

	const update = (patch: Parameters<typeof updateSlideMeta>[2], mark = 'edit speech') => {
		editor.markHistoryStoppingPoint(mark)
		updateSlideMeta(editor, slide.id, patch)
	}
	const setScript = (k: number, text: string) => {
		const next = [...(slideMeta(editor.getShape(slide.id)!).script ?? [])]
		while (next.length <= k) next.push('')
		next[k] = text
		while (next.length && !next[next.length - 1]) next.pop()
		update({ script: next.length ? next : undefined })
	}
	const setCues = (next: RazzleCue[]) => update({ cues: next.length ? next : undefined }, 'edit cues')

	return (
		<div className="rz-inspector-body">
			<section className="rz-section">
				<div className="rz-section-head">
					<span>Slide {index + 1}</span>
				</div>
				<TextInput
					className="rz-input rz-title-input"
					value={slide.props.name}
					placeholder="Slide title"
					onCommit={(name) => {
						editor.markHistoryStoppingPoint('rename slide')
						editor.updateShape({ id: slide.id, type: 'frame', props: { name } })
					}}
				/>
				<div className="rz-switches">
					<Switch on={!!meta.hidden} onChange={(v) => update({ hidden: v || undefined })} label="Hidden slide" hint="Skipped by next/prev; reached by a jump (speaker view or the agent)." />
					<Switch
						on={meta.autoAdvance !== false}
						onChange={(v) => update({ autoAdvance: v ? undefined : false })}
						label="Auto-advance"
						hint="In auto-present, move on once the script for the last step has been said."
					/>
				</div>
				{meta.generated && (
					<div className="rz-generated">
						<div className="rz-field-label">Made by {meta.generated.by} during the talk</div>
						<div className="rz-generated-prompt">{meta.generated.prompt}</div>
					</div>
				)}
			</section>

			<section className="rz-section">
				<div className="rz-section-head"><span>Speaker notes</span></div>
				<TextArea key={slide.id} value={notesText(meta.notes ?? '')} onCommit={(text) => update({ notes: notesHtml(text), notesEditedAt: Date.now() }, 'edit notes')} placeholder="What you want to say on this slide" rows={4} />
			</section>

			<section className="rz-section">
				<div className="rz-section-head">
					<span>Script</span>
					<span className="rz-muted">one line per step</span>
				</div>
				{labels.map((label, k) => (
					<div key={k} className="rz-script-step">
						<div className="rz-field-label">
							<span className="rz-step-num">{k}</span> {label}
						</div>
						<TextArea value={script[k] ?? ''} onCommit={(v) => setScript(k, v)} placeholder={k === 0 ? 'What you say when the slide comes up' : 'What you say at this step'} />
					</div>
				))}
				{script.length > steps && (
					<p className="rz-hint">
						{script.length - steps} more script {script.length - steps === 1 ? 'line is' : 'lines are'} kept for steps this slide no longer has.
					</p>
				)}
			</section>

			<section className="rz-section">
				<div className="rz-section-head">
					<span>Cues</span>
					<span className="rz-muted">spoken phrases that advance</span>
				</div>
				{cues.length === 0 && <p className="rz-hint">Say a phrase to move on, e.g. “let’s see how” → next step.</p>}
				{cues.map((c, i) => (
					<div key={c.id} className="rz-cue">
						<TextInput value={c.phrase} placeholder="phrase" onCommit={(phrase) => setCues(cues.map((x, j) => (j === i ? { ...x, phrase } : x)))} />
						<select
							className="rz-select"
							value={c.action}
							onChange={(e) => setCues(cues.map((x, j) => (j === i ? { ...x, action: e.target.value as RazzleCue['action'] } : x)))}
						>
							<option value="step">next step</option>
							<option value="next">next slide</option>
						</select>
						<select
							className="rz-select"
							value={c.atStep ?? ''}
							title="Only armed at this step"
							onChange={(e) => {
								const v = e.target.value
								setCues(cues.map((x, j) => (j === i ? { ...x, atStep: v === '' ? undefined : Number(v) } : x)))
							}}
						>
							<option value="">any step</option>
							{Array.from({ length: steps }, (_, k) => (
								<option key={k} value={k}>
									at step {k}
								</option>
							))}
						</select>
						<TldrawUiButton type="icon" title="Remove cue" onClick={() => setCues(cues.filter((_, j) => j !== i))}>
							<TldrawUiButtonIcon icon="cross-2" small />
						</TldrawUiButton>
					</div>
				))}
				<TldrawUiButton type="low" className="rz-add" onClick={() => setCues([...cues, { id: uniqueId(), phrase: '', action: steps > 1 ? 'step' : 'next' }])}>
					<TldrawUiButtonIcon icon="plus" small />
					<TldrawUiButtonLabel>Add cue</TldrawUiButtonLabel>
				</TldrawUiButton>
			</section>
		</div>
	)
}
