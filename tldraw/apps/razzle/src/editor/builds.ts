// Build steps on the current slide: who changes at which step, and descriptions of each step.
import { Editor, TLShape, TLShapeId } from 'tldraw'
import { buildOf, slideShapes, stepCount } from '../model/slides'
import { BuildMeta } from '../model/types'

export const EFFECT_LABEL: Record<BuildMeta['effect'], string> = {
	appear: 'Appear',
	fade: 'Fade in',
	disappear: 'Disappear',
}

const EFFECT_VERB: Record<BuildMeta['effect'], [string, string]> = {
	appear: ['appears', 'appear'],
	fade: ['comes into colour', 'come into colour'],
	disappear: ['goes away', 'go away'],
}

/** The build a shape carries itself (not inherited from a group). */
export function ownBuild(shape: TLShape): BuildMeta | undefined {
	const b = (shape.meta as any)?.build as BuildMeta | undefined
	return b && Number.isInteger(b.step) && b.step >= 1 ? b : undefined
}

/** Shapes on a slide that carry their own build at `step`. */
export function shapesAtStep(editor: Editor, frame: TLShape, step: number): TLShape[] {
	return slideShapes(editor, frame).filter((s) => ownBuild(s)?.step === step)
}

/** A short name for a shape: its text, or the texts inside a group, or its kind. */
export function shapeLabel(editor: Editor, shape: TLShape): string {
	const own = editor.getShapeUtil(shape).getText(shape)?.trim()
	if (own) return clip(own)
	if (shape.type === 'group') {
		const texts = [...editor.getShapeAndDescendantIds([shape.id])]
			.map((id) => editor.getShape(id))
			.map((s) => (s ? editor.getShapeUtil(s).getText(s)?.trim() : ''))
			.filter(Boolean) as string[]
		if (texts.length) return clip(texts.join(' '))
		return 'a group'
	}
	if (shape.type === 'geo') return `a ${(shape.props as any).geo ?? 'shape'}`
	return `a ${shape.type.replace(/^razzle-/, '')}`
}

const clip = (s: string, n = 26) => {
	const one = s.replace(/\s+/g, ' ')
	return one.length > n ? one.slice(0, n - 1) + '…' : one
}

/** "fades in: Agent, Human" — what happens at a step (step 0: the slide appears). */
export function describeStep(editor: Editor, frame: TLShape, step: number): string {
	if (step === 0) return 'the slide appears'
	const shapes = shapesAtStep(editor, frame, step)
	if (!shapes.length) return 'nothing changes'
	const byEffect = new Map<BuildMeta['effect'], TLShape[]>()
	for (const s of shapes) {
		const e = ownBuild(s)!.effect
		byEffect.set(e, [...(byEffect.get(e) ?? []), s])
	}
	return [...byEffect]
		.map(([effect, list]) => {
			// "a triangle", "a triangle" → "2 triangles"
			const counts = new Map<string, number>()
			for (const s of list) {
				const l = shapeLabel(editor, s)
				counts.set(l, (counts.get(l) ?? 0) + 1)
			}
			const names = [...counts].map(([l, n]) => (n > 1 && l.startsWith('a ') ? `${n} ${l.slice(2)}s` : n > 1 ? `${l} ×${n}` : l))
			const shown = names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3}` : '')
			return `${shown} ${EFFECT_VERB[effect][list.length > 1 ? 1 : 0]}`
		})
		.join('; ')
}

/** Set (or clear, with null) the build of the selected shapes; frames are skipped. */
export function setBuild(editor: Editor, ids: TLShapeId[], build: BuildMeta | null) {
	const shapes = ids.map((id) => editor.getShape(id)).filter((s): s is TLShape => !!s && s.type !== 'frame')
	if (!shapes.length) return
	editor.updateShapes(
		shapes.map((s) => {
			const meta = { ...(s.meta as Record<string, unknown>) }
			if (build) meta.build = { ...build }
			else delete meta.build
			return { id: s.id, type: s.type, meta: meta as any }
		})
	)
}

export { buildOf, stepCount }
