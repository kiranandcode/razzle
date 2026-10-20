// Deck persistence for the studio: autosave to the server, merge other writers' changes,
// fall back to the browser when the server is away.
//
// The server keeps one version per deck (`updatedAt`). Every save says which version its edits
// build on; the server refuses (409) a save built on an older version than it holds. The studio
// never overwrites a newer server deck: it fetches it, merges three ways against the version the
// local edits started from (`base`), and saves the merge.
//
//   record changed only locally      → local
//   record changed only on the server → server
//   changed on both                   → local
//   new on either side                → kept
//   deleted on one side, untouched on the other → deleted
import { Editor, TLRecord, TLStoreSnapshot, atom } from 'tldraw'
import { PUBLIC } from './base'
import { on } from './client'
import { StaleDeckError, loadDeck, saveDeck } from './deck'
import { LOCAL_PREFIX, readLocalDeck, writeLocalDeck } from './localStore'
import { buildSlideIndex } from './slides'
import { DECK_FORMAT, Deck, SLIDE_H, SLIDE_W } from './types'

export { listLocalDecks, readLocalDeck } from './localStore'

export type SaveStatus = 'saved' | 'saving' | 'edited' | 'local' | 'error'

const AUTOSAVE_MS = 800

export type OpenedDeck =
	| { kind: 'server'; deck: Deck; localEdits?: Deck }
	| { kind: 'local'; deck: Deck; base?: number }
	| { kind: 'missing' }
	| { kind: 'unsupported'; deck: Deck }

/**
 * Fetch a deck for editing. Unsynced edits kept in the browser come back as `localEdits`
 * (they are merged in once the editor exists); with no server, the browser copy is used.
 */
export async function openDeck(id: string): Promise<OpenedDeck> {
	const local = readLocalDeck(id)
	let deck: Deck
	try {
		deck = await loadDeck(id)
	} catch (e) {
		if (e instanceof Error && /^404/.test(e.message)) return local ? { kind: 'local', deck: local.deck, base: local.base } : { kind: 'missing' }
		if (local) return { kind: 'local', deck: local.deck, base: local.base }
		throw e
	}
	if ((deck as any).format !== DECK_FORMAT || !deck.document) return { kind: 'unsupported', deck }
	// Browser-kept edits count only when they build on the version the server still holds
	// (a newer server version already contains them, or supersedes them).
	const pending = local?.unsynced && (local.base === undefined || local.base === deck.updatedAt)
	return { kind: 'server', deck, localEdits: pending ? local!.deck : undefined }
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b)

function recordsOf(editor: Editor, doc: TLStoreSnapshot): Map<string, TLRecord> {
	const migrated = editor.store.schema.migrateStoreSnapshot(doc)
	if (migrated.type !== 'success') throw new Error('cannot migrate the server document: ' + migrated.reason)
	return new Map(Object.entries(migrated.value) as [string, TLRecord][])
}

const isDocumentRecord = (r: TLRecord) => editor_scope.has(r.typeName)
const editor_scope = new Set(['document', 'page', 'shape', 'binding', 'asset'])

export interface DeckSync {
	readonly deckId: string
	readonly $status: ReturnType<typeof atom<SaveStatus>>
	readonly $title: ReturnType<typeof atom<string>>
	readonly $error: ReturnType<typeof atom<string>>
	setTitle(title: string): void
	/** Save now (skips the debounce). */
	flush(): Promise<void>
	/** Fold a deck the server produced (e.g. generated notes) into the editor. */
	applyServerDeck(deck: Deck): void
	dispose(): void
}

/**
 * Start syncing `editor` (already holding `deck.document`) with the server.
 * `base` is the server version the editor's document builds on (undefined for a new deck).
 * `startDirty`: the editor holds edits the server lacks (new deck, browser copy).
 */
export function startDeckSync(
	editor: Editor,
	deck: Deck,
	opts: { base?: number; startDirty?: boolean; offline?: boolean } = {}
): DeckSync {
	const id = deck.id
	const $status = atom<SaveStatus>('save status', opts.offline ? 'local' : 'saved')
	const $title = atom('deck title', deck.title)
	const $error = atom('save error', '')

	let base: Map<string, TLRecord> = opts.base === undefined ? new Map() : currentRecords()
	let baseVersion = opts.base
	let dirty = !!opts.startDirty
	let titleDirty = false
	let saving: Promise<void> | null = null
	let timer: ReturnType<typeof setTimeout> | undefined
	let remoteVersion = 0
	let disposed = false

	function currentRecords(): Map<string, TLRecord> {
		const snap = editor.store.getStoreSnapshot('document')
		return new Map(Object.entries(snap.store) as [string, TLRecord][])
	}

	const schedule = (ms = AUTOSAVE_MS) => {
		clearTimeout(timer)
		timer = setTimeout(() => void save(), ms)
	}

	const markEdited = () => {
		dirty = true
		if ($status.get() !== 'saving') $status.set('edited')
		schedule()
	}

	const unlisten = editor.store.listen(markEdited, { scope: 'document', source: 'user' })

	/** Three-way merge of a server document into the editor. */
	function mergeServer(server: Deck) {
		const S = recordsOf(editor, server.document)
		const L = currentRecords()
		const B = base
		const put: TLRecord[] = []
		const remove: TLRecord['id'][] = []
		if (!dirty) {
			// Nothing local to keep: take the server's document.
			for (const [rid, s] of S) if (!same(L.get(rid), s)) put.push(s)
			for (const [rid, l] of L) if (!S.has(rid)) remove.push(l.id)
		} else {
			for (const [rid, s] of S) {
				const l = L.get(rid)
				const b = B.get(rid)
				if (!l) {
					if (!b) put.push(s) // new on the server; otherwise deleted here and stays deleted
				} else if (b && same(l, b) && !same(s, b)) {
					put.push(s) // changed only on the server
				}
			}
			for (const [rid, l] of L) {
				if (S.has(rid)) continue
				const b = B.get(rid)
				if (b && same(l, b)) remove.push(l.id) // deleted on the server, untouched here
			}
		}
		if (put.length || remove.length) {
			editor.store.mergeRemoteChanges(() => {
				if (put.length) editor.store.put(put)
				if (remove.length) editor.store.remove(remove)
			})
		}
		base = S
		baseVersion = server.updatedAt
		if (!titleDirty && server.title) $title.set(server.title)
	}

	function snapshotDeck(): Deck {
		return {
			id,
			title: $title.get(),
			format: DECK_FORMAT,
			width: deck.width ?? SLIDE_W,
			height: deck.height ?? SLIDE_H,
			document: editor.store.getStoreSnapshot('document'),
			slides: buildSlideIndex(editor),
			updatedAt: baseVersion,
		}
	}

	async function save(): Promise<void> {
		if (disposed) return
		clearTimeout(timer)
		if (saving) {
			await saving
			if (dirty || titleDirty) return save()
			return
		}
		if (!dirty && !titleDirty) return
		saving = (async () => {
			for (let attempt = 0; attempt < 4; attempt++) {
				const out = snapshotDeck()
				const sent = new Map(Object.entries(out.document.store) as [string, TLRecord][])
				dirty = false
				titleDirty = false
				$status.set('saving')
				try {
					const r = await saveDeck(out)
					base = sent
					baseVersion = r.updatedAt
					try {
						localStorage.removeItem(LOCAL_PREFIX + id)
					} catch {
						/* ignore */
					}
					$error.set('')
					$status.set(dirty ? 'edited' : 'saved')
					return
				} catch (e) {
					if (e instanceof StaleDeckError) {
						// Someone else saved first: fold their version in and try again.
						dirty = true
						const server = await loadDeck(id)
						mergeServer(server)
						continue
					}
					// No server (or it failed): keep the edits in this browser.
					const ok = writeLocalDeck({ deck: { ...out, updatedAt: undefined }, base: baseVersion, unsynced: true, savedAt: Date.now() })
					$error.set(e instanceof Error ? e.message : String(e))
					$status.set(ok ? 'local' : 'error')
					return
				}
			}
			$status.set('error')
			$error.set('the deck kept changing on the server')
		})()
		try {
			await saving
		} finally {
			saving = null
		}
		if (dirty || titleDirty) schedule()
	}

	async function onRemote(version: number) {
		remoteVersion = Math.max(remoteVersion, version)
		if (saving) await saving
		if (disposed || baseVersion === undefined || remoteVersion <= baseVersion) return
		try {
			const server = await loadDeck(id)
			if (baseVersion !== undefined && (server.updatedAt ?? 0) <= baseVersion) return
			const hadEdits = dirty
			mergeServer(server)
			if (hadEdits) void save()
		} catch {
			/* server went away; the next save handles it */
		}
	}

	const offDeckUpdated = on('deck-updated', (msg) => {
		if (msg.deckId === id) void onRemote(msg.updatedAt)
	})

	// After an offline spell, push browser-kept edits once the server answers again
	// (the public build has no server: its `state` comes from the in-browser presenter).
	const offState = on('state', () => {
		if (PUBLIC) return
		if ($status.get() === 'local' && !saving) {
			dirty = true
			schedule(200)
		}
	})

	const onUnload = () => {
		if (dirty || titleDirty) {
			writeLocalDeck({ deck: { ...snapshotDeck(), updatedAt: undefined }, base: baseVersion, unsynced: true, savedAt: Date.now() })
		}
	}
	window.addEventListener('beforeunload', onUnload)

	if (dirty) schedule(50)

	return {
		deckId: id,
		$status,
		$title,
		$error,
		setTitle(title: string) {
			if (title === $title.get()) return
			$title.set(title)
			titleDirty = true
			$status.set('edited')
			schedule()
		},
		flush: () => save(),
		applyServerDeck(server: Deck) {
			if (server.document) mergeServer(server)
		},
		dispose() {
			clearTimeout(timer)
			disposed = true
			unlisten()
			offDeckUpdated()
			offState()
			window.removeEventListener('beforeunload', onUnload)
			if (dirty || titleDirty) {
				// Leaving with unsaved edits: keep them in the browser and send them on the way out.
				try {
					const out = snapshotDeck()
					writeLocalDeck({ deck: { ...out, updatedAt: undefined }, base: baseVersion, unsynced: true, savedAt: Date.now() })
					saveDeck(out)
						.then(() => localStorage.removeItem(LOCAL_PREFIX + id))
						.catch(() => {})
				} catch {
					/* editor already gone */
				}
			}
		},
	}
}

/** Fold records only the browser copy has (and its changes to records) into the editor, as local edits. */
export function mergeLocalEdits(editor: Editor, local: Deck) {
	const migrated = editor.store.schema.migrateStoreSnapshot(local.document)
	if (migrated.type !== 'success') return
	const put = (Object.values(migrated.value) as TLRecord[]).filter((r) => isDocumentRecord(r))
	if (put.length) editor.store.put(put)
}
