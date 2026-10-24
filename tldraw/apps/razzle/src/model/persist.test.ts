import { createShapeId } from 'tldraw'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TestEditor } from '../../../../packages/tldraw/src/test/TestEditor'
import { readLocalDeck, startDeckSync, type DeckSync } from './persist'
import { DECK_FORMAT, type Deck } from './types'

const api = vi.hoisted(() => ({ save: vi.fn(), load: vi.fn() }))
vi.mock('./deck', () => ({
	saveDeck: api.save,
	loadDeck: api.load,
	StaleDeckError: class extends Error {},
}))
vi.mock('./client', () => ({ on: () => () => {} }))

let editor: TestEditor
let sync: DeckSync
let deck: Deck
const frame = createShapeId('slide')

beforeEach(() => {
	vi.useFakeTimers()
	api.save.mockReset().mockResolvedValue({ updatedAt: 2 })
	api.load.mockReset()
	editor = new TestEditor()
	editor.createShape({ id: frame, type: 'frame', props: { name: 'Original' } })
	deck = {
		id: 'test',
		title: 'Test',
		format: DECK_FORMAT,
		width: 1000,
		height: 562.5,
		document: editor.store.getStoreSnapshot('document'),
		slides: [],
		updatedAt: 1,
	}
	sync = startDeckSync(editor, deck, { base: 1 })
})

afterEach(() => {
	sync.dispose()
	editor.dispose()
	vi.useRealTimers()
	localStorage.clear()
})

it('marks API edits immediately and flushes without an animation frame or title change', async () => {
	editor.updateShape({ id: frame, type: 'frame', props: { name: 'Edited' } })
	expect(sync.$status.get()).toBe('edited')
	await sync.flush()
	expect(api.save).toHaveBeenCalledTimes(1)
	expect(api.save.mock.calls[0][0].document.store[frame].props.name).toBe('Edited')
	expect(sync.$status.get()).toBe('saved')
	await sync.flush()
	expect(api.save).toHaveBeenCalledTimes(1)
})

it('flush checks records even when programmatic writes used a remote transaction', async () => {
	editor.store.mergeRemoteChanges(() => editor.updateShape({ id: frame, type: 'frame', x: 180 }))
	await sync.flush()
	expect(api.save.mock.calls[0][0].document.store[frame].x).toBe(180)
})

it('flush waits for edits made while a save is in flight', async () => {
	let finish!: (value: { updatedAt: number }) => void
	api.save.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = resolve
			})
	)
	editor.updateShape({ id: frame, type: 'frame', x: 10 })
	const flushing = sync.flush()
	editor.updateShape({ id: frame, type: 'frame', x: 20 })
	finish({ updatedAt: 2 })
	await flushing
	expect(api.save).toHaveBeenCalledTimes(2)
	expect(api.save.mock.calls[1][0].document.store[frame].x).toBe(20)
	expect(sync.$status.get()).toBe('saved')
})

it('merges server changes without echo saves or dropping pending local edits', async () => {
	const remote = structuredClone(deck)
	;(remote.document.store[frame] as any).x = 100
	remote.updatedAt = 2
	sync.applyServerDeck(remote)
	await sync.flush()
	expect(api.save).not.toHaveBeenCalled()
	editor.updateShape({ id: frame, type: 'frame', x: 200 })
	const newer = structuredClone(remote)
	;(newer.document.store[frame] as any).x = 300
	newer.updatedAt = 3
	sync.applyServerDeck(newer)
	await sync.flush()
	expect(api.save.mock.calls[0][0].document.store[frame].x).toBe(200)
	expect(api.save.mock.calls[0][0].updatedAt).toBe(3)
})

it('failed flush stays marked local instead of claiming a server save', async () => {
	api.save.mockRejectedValue(new Error('offline'))
	editor.updateShape({ id: frame, type: 'frame', x: 100 })
	await sync.flush()
	expect(api.save).toHaveBeenCalledTimes(1)
	expect(sync.$status.get()).toBe('local')
	expect(sync.$error.get()).toBe('offline')
})

it('failed in-flight saves keep the latest edits in local storage before flush resolves', async () => {
	let fail!: (error: Error) => void
	api.save.mockImplementationOnce(
		() =>
			new Promise((_resolve, reject) => {
				fail = reject
			})
	)
	editor.updateShape({ id: frame, type: 'frame', x: 10 })
	const flushing = sync.flush()
	editor.updateShape({ id: frame, type: 'frame', x: 20 })
	fail(new Error('offline'))
	await flushing
	expect(sync.$status.get()).toBe('local')
	expect((readLocalDeck(deck.id)!.deck.document.store[frame] as any).x).toBe(20)
})
