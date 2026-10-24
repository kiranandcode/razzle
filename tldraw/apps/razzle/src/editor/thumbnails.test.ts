import type { Editor } from 'tldraw'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SlideThumbnails } from './thumbnails'

vi.mock('tldraw', () => ({
	atom: (_name: string, initial: unknown) => {
		let value = initial
		return {
			get: () => value,
			set: (next: unknown) => {
				value = next
			},
		}
	},
}))
vi.mock('../model/slides', () => ({ getSlides: () => [{ id: 'shape:a' }, { id: 'shape:b' }] }))
vi.mock('./slideOps', () => ({ slideOf: () => ({ id: 'shape:a' }) }))

let thumbnails: SlideThumbnails
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
	thumbnails?.dispose()
	vi.useRealTimers()
})

function setup() {
	const editor = {
		on: vi.fn(),
		off: vi.fn(),
		store: { listen: vi.fn(() => vi.fn()) },
		getShape: vi.fn(() => ({})),
		getEditingShapeId: vi.fn((): string | null => null),
		inputs: { getIsPointing: vi.fn(() => false) },
		getSvgString: vi.fn(async () => ({ svg: '<svg/>' })),
	}
	thumbnails = new SlideThumbnails(editor as unknown as Editor)
	return editor
}

it('waits until text editing and dragging finish', async () => {
	const editor = setup()
	editor.getEditingShapeId.mockReturnValue('shape:text')
	await vi.advanceTimersByTimeAsync(1000)
	expect(editor.getSvgString).not.toHaveBeenCalled()
	editor.getEditingShapeId.mockReturnValue(null)
	editor.inputs.getIsPointing.mockReturnValue(true)
	await vi.advanceTimersByTimeAsync(1000)
	expect(editor.getSvgString).not.toHaveBeenCalled()
	editor.inputs.getIsPointing.mockReturnValue(false)
	await vi.advanceTimersByTimeAsync(1000)
	expect(editor.getSvgString).toHaveBeenCalledTimes(2)
})

it('pauses the remaining queue when input arrives during an export', async () => {
	const editor = setup()
	let finish!: (value: { svg: string }) => void
	editor.getSvgString.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = resolve
			})
	)
	await vi.advanceTimersByTimeAsync(50)
	expect(editor.getSvgString).toHaveBeenCalledTimes(1)
	editor.on.mock.calls[0][1]()
	finish({ svg: '<svg/>' })
	await vi.advanceTimersByTimeAsync(100)
	expect(editor.getSvgString).toHaveBeenCalledTimes(1)
	await vi.advanceTimersByTimeAsync(500)
	expect(editor.getSvgString).toHaveBeenCalledTimes(2)
})

it('cancels pending work and removes its input listener on disposal', async () => {
	const editor = setup()
	thumbnails.dispose()
	await vi.advanceTimersByTimeAsync(1000)
	expect(editor.getSvgString).not.toHaveBeenCalled()
	expect(editor.off).toHaveBeenCalledWith('event', editor.on.mock.calls[0][1])
})
