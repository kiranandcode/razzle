import { Box, Editor, TLContent, TldrawOptions, Vec } from 'tldraw'
import { currentSlide, slideOf } from './slideOps'

const PASTE_OFFSET = 16
type CopiedPosition = {
	key: string
	centre: Vec
	slideOrigin?: Vec
	target?: string
	count: number
	cut: boolean
}
const copiedPositions = new WeakMap<Editor, CopiedPosition>()

function copiedPosition(editor: Editor, content: TLContent): CopiedPosition | undefined {
	const shapes = content.rootShapeIds.map((id) => editor.getShape(id))
	if (!shapes.length || shapes.some((shape) => !shape || shape.type === 'frame')) return
	const bounds = shapes.map((shape) => editor.getShapePageBounds(shape!))
	if (bounds.some((b) => !b)) return
	const slides = shapes.map((shape) => slideOf(editor, shape))
	const slide = slides[0]
	return {
		key: content.rootShapeIds.join(','),
		centre: Box.Common(bounds as Box[]).center,
		slideOrigin:
			slide && slides.every((s) => s?.id === slide.id)
				? editor.getShapePageTransform(slide.id).point()
				: undefined,
		count: 0,
		cut: false,
	}
}

export const clipboardOptions: Pick<
	TldrawOptions,
	'onBeforeCopyToClipboard' | 'onBeforePasteFromClipboard'
> = {
	onBeforeCopyToClipboard({ editor, content, operation }) {
		const position = copiedPosition(editor, content)
		if (position) copiedPositions.set(editor, { ...position, cut: operation === 'cut' })
		else copiedPositions.delete(editor)
	},
	onBeforePasteFromClipboard({ editor, content, point }) {
		if (content.type !== 'tldraw' || point) return
		const key = content.content.rootShapeIds.join(',')
		let position = copiedPositions.get(editor)
		if (position?.key !== key) position = copiedPosition(editor, content.content)
		if (!position) return
		const slide = currentSlide(editor)
		if (position.target !== slide?.id) position.count = 0
		position.target = slide?.id
		const target = position.centre.clone()
		if (slide && position.slideOrigin) {
			target.add(editor.getShapePageTransform(slide.id).point()).sub(position.slideOrigin)
		}
		const offset = PASTE_OFFSET * (position.count++ + (position.cut ? 0 : 1))
		target.add(new Vec(offset, offset))
		copiedPositions.set(editor, position)
		return { ...content, point: target }
	},
}
