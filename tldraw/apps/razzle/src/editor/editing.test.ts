import { Editor, TLContent, createShapeId, defaultHandleExternalTldrawContent } from 'tldraw'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { putPastedExternalContent } from '../../../../packages/tldraw/src/lib/ui/hooks/clipboard/putPastedContent'
import { TestEditor } from '../../../../packages/tldraw/src/test/TestEditor'
import { getSlides } from '../model/slides'
import { planSlides } from '../export/exportEditor'
import { renderDeckSvgs } from '../export/svg'
import { SLIDE_H, SLIDE_W } from '../model/types'
import { clipboardOptions } from './clipboard'
import { addSlide, currentSlide, zoomToSlide } from './slideOps'
import { $focusSlide } from './state'

let editor: TestEditor
const first = createShapeId('first')
const second = createShapeId('second')
const item = createShapeId('item')

beforeEach(() => {
	$focusSlide.set(null)
	editor = new TestEditor({ options: clipboardOptions })
	editor.registerExternalContentHandler('tldraw', (content) =>
		defaultHandleExternalTldrawContent(editor, content)
	)
	editor.createShapes([
		{ id: first, type: 'frame', x: 0, y: 0, props: { w: SLIDE_W, h: SLIDE_H, name: 'First' } },
		{
			id: second,
			type: 'frame',
			x: SLIDE_W + 120,
			y: 0,
			props: { w: SLIDE_W, h: SLIDE_H, name: 'Second' },
		},
		{ id: item, type: 'geo', parentId: first, x: 70, y: 90, props: { w: 80, h: 40 } },
	])
	editor.select(item)
})
afterEach(() => {
	vi.restoreAllMocks()
	editor.dispose()
	$focusSlide.set(null)
})

async function copy(operation: 'copy' | 'cut' = 'copy') {
	const content = editor.getContentFromCurrentPage(editor.getSelectedShapeIds())!
	await clipboardOptions.onBeforeCopyToClipboard!({ editor, content, operation, source: 'native' })
	return content
}
async function paste(content: TLContent, point?: { x: number; y: number }) {
	await putPastedExternalContent(
		editor,
		{ type: 'tldraw', content, point },
		{ source: 'native-event', point }
	)
}

it('offsets copies from their original position and cascades repeated pastes', async () => {
	const content = await copy()
	await paste(content)
	expect(editor.getOnlySelectedShape()).toMatchObject({ parentId: first, x: 86, y: 106 })
	await paste(content)
	expect(editor.getOnlySelectedShape()).toMatchObject({ parentId: first, x: 102, y: 122 })
})

it('uses the copied position even when the original moves afterward', async () => {
	const content = await copy()
	editor.updateShape({ id: item, type: 'geo', x: 300, y: 300 })
	await paste(content)
	expect(editor.getOnlySelectedShape()).toMatchObject({ parentId: first, x: 86, y: 106 })
})

it('preserves relative placement when pasting onto another slide', async () => {
	const content = await copy()
	zoomToSlide(editor, second, false)
	expect(currentSlide(editor)?.id).toBe(second)
	await paste(content)
	expect(editor.getOnlySelectedShape()).toMatchObject({ parentId: second, x: 86, y: 106 })
})

it('offsets a multi-selection as a unit', async () => {
	const other = createShapeId('other')
	editor.createShape({
		id: other,
		type: 'geo',
		parentId: first,
		x: 200,
		y: 150,
		props: { w: 60, h: 60 },
	})
	editor.select(item, other)
	const content = await copy()
	await paste(content)
	expect(editor.getSelectionPageBounds()).toMatchObject({ x: 86, y: 106, w: 190, h: 120 })
})

it('keeps an explicit paste point', async () => {
	await paste(await copy(), { x: 400, y: 300 })
	expect(editor.getSelectionPageBounds()?.center).toMatchObject({ x: 400, y: 300 })
})

it('keeps the first cut-and-paste at the original position', async () => {
	const content = await copy('cut')
	editor.deleteShapes([item])
	await paste(content)
	expect(editor.getOnlySelectedShape()).toMatchObject({ parentId: first, x: 70, y: 90 })
})

it('inserts after the current slide and restores order with undo', () => {
	editor.markHistoryStoppingPoint('add slide')
	const added = addSlide(editor)
	zoomToSlide(editor, added, false)
	expect(getSlides(editor).map((s) => s.id)).toEqual([first, added, second])
	expect(editor.getShape(second)).toMatchObject({ x: 2 * (SLIDE_W + 120), y: 0 })
	expect(currentSlide(editor)?.id).toBe(added)
	editor.undo()
	expect(getSlides(editor).map((s) => s.id)).toEqual([first, second])
	expect(editor.getShape(second)).toMatchObject({ x: SLIDE_W + 120, y: 0 })
})

it('inserts into the next row without changing the order of following slides', () => {
	const rest = Array.from({ length: 4 }, (_, i) => createShapeId(`slide-${i}`))
	editor.createShapes(
		rest.map((id, i) => ({
			id,
			type: 'frame',
			x: i < 3 ? (i + 2) * (SLIDE_W + 120) : 0,
			y: i < 3 ? 0 : SLIDE_H + 160,
			props: { w: SLIDE_W, h: SLIDE_H },
		}))
	)
	zoomToSlide(editor, rest[2], false)
	const added = addSlide(editor)
	expect(getSlides(editor).map((s) => s.id)).toEqual([
		first,
		second,
		...rest.slice(0, 3),
		added,
		rest[3],
	])
	expect(editor.getShape(added)).toMatchObject({ x: 0, y: SLIDE_H + 160 })
	expect(editor.getShape(rest[3])).toMatchObject({ x: SLIDE_W + 120, y: SLIDE_H + 160 })
})

it('appends after the last slide and handles an empty deck', () => {
	zoomToSlide(editor, second, false)
	const added = addSlide(editor)
	expect(getSlides(editor).map((s) => s.id)).toEqual([first, second, added])
	editor.deleteShapes(editor.getCurrentPageShapeIdsSorted())
	const only = addSlide(editor)
	expect(getSlides(editor).map((s) => s.id)).toEqual([only])
	expect(editor.getShape(only)).toMatchObject({ x: 0, y: 0 })
})

it('makes room even when the following slide is locked', () => {
	editor.updateShape({ id: second, type: 'frame', isLocked: true })
	const added = addSlide(editor)
	expect(getSlides(editor).map((s) => s.id)).toEqual([first, added, second])
	expect(editor.getShape(second)).toMatchObject({ x: 2 * (SLIDE_W + 120), isLocked: true })
})

it('creates a root slide while editing inside a group', () => {
	const other = createShapeId('other')
	const groupId = createShapeId('group')
	editor.createShape({ id: other, type: 'geo', parentId: first, x: 200, y: 150 })
	editor.groupShapes([item, other], { groupId })
	editor.setFocusedGroup(groupId).select(item)
	const added = addSlide(editor)
	zoomToSlide(editor, added, false)
	expect(getSlides(editor).map((s) => s.id)).toEqual([first, added, second])
	expect(editor.getShape(added)?.parentId).toBe(editor.getCurrentPageId())
	expect(editor.getFocusedGroupId()).toBe(editor.getCurrentPageId())
})

it('exports slide numbers at the frame position in reading order', async () => {
	vi.spyOn(Editor.prototype, 'getSvgString').mockResolvedValue({
		svg: '<svg xmlns="http://www.w3.org/2000/svg"><svg><rect width="10" height="10"/></svg></svg>',
		width: SLIDE_W, height: SLIDE_H, trimPadding: 0,
	})
	const result = await renderDeckSvgs(editor, planSlides(editor, { builds: 'final' }))
	const svg = new DOMParser().parseFromString(result.slides[1].steps[0].svg, 'image/svg+xml')
	const footer = svg.documentElement.lastElementChild!
	expect(footer.getAttribute('transform')).toBe(`matrix(1, 0, 0, 1, ${SLIDE_W + 120}, 0)`)
	expect(footer.textContent).toBe('2')
	expect(footer.firstElementChild?.getAttribute('x')).toBe(String(SLIDE_W - 20))
})
