// Share links: the whole deck inside the URL, so a talk can be passed around with no server.
//
//   <public site root>/#/view?d=<data>
//   data = base64url(deflate-raw(JSON {format, title, width, height, document, slides}))
//
// `slides` is the slide index without its per-element entries (the document holds them; the
// viewer needs only each slide's id, hidden flag and step count). The viewer (src/present/
// SharedView.tsx) decodes the link and presents it in that one window.
import { DECK_FORMAT, type Deck, type SlideIndex } from './types'
import { audienceSnapshot } from '../../../../../shared/tl/audience'

/** Links longer than this are cut by some chat apps. */
export const LINK_WARN_BYTES = 60_000
/** Links longer than this are refused: browsers and servers start to drop them. */
export const LINK_MAX_BYTES = 2_000_000

export interface SharedDeck {
	format: typeof DECK_FORMAT
	title: string
	width: number
	height: number
	document: Deck['document']
	slides: SlideIndex[]
}

export function sharedDeckOf(deck: Deck): SharedDeck {
	return {
		format: DECK_FORMAT,
		title: deck.title,
		width: deck.width,
		height: deck.height,
		...audienceSnapshot(deck.document, deck.slides),
	}
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
	const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream)
	return new Uint8Array(await new Response(out).arrayBuffer())
}

function toBase64url(bytes: Uint8Array): string {
	let bin = ''
	for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
	return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64url(s: string): Uint8Array {
	const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
	const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
	const out = new Uint8Array(bin.length)
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
	return out
}

export async function encodeDeck(deck: SharedDeck): Promise<string> {
	return toBase64url(await pipe(new TextEncoder().encode(JSON.stringify(deck)), new CompressionStream('deflate-raw')))
}

/** Thrown for a link that is not a Razzle deck (cut short, garbled, or another format). */
export class BadLinkError extends Error {}

export async function decodeDeck(data: string): Promise<SharedDeck> {
	if (!/^[A-Za-z0-9_-]+$/.test(data)) throw new BadLinkError('the link holds no deck')
	let deck: any
	try {
		const json = await pipe(fromBase64url(data), new DecompressionStream('deflate-raw'))
		deck = JSON.parse(new TextDecoder().decode(json))
	} catch {
		throw new BadLinkError('the link is incomplete or garbled')
	}
	return readSharedDeck(deck)
}

function readSharedDeck(deck: any): SharedDeck {
	if (!deck || typeof deck !== 'object' || deck.format !== DECK_FORMAT) throw new BadLinkError('the link holds no Razzle deck')
	const doc = deck.document
	if (!doc || typeof doc !== 'object' || typeof doc.store !== 'object' || typeof doc.schema !== 'object' || !Array.isArray(deck.slides))
		throw new BadLinkError('the deck in the link is incomplete')
	const ok = (s: any) => s && typeof s === 'object' && typeof s.id === 'string'
	if (!deck.slides.every(ok)) throw new BadLinkError('the deck in the link is incomplete')
	return {
		format: DECK_FORMAT,
		title: typeof deck.title === 'string' ? deck.title : 'Shared talk',
		width: Number(deck.width) || 1000,
		height: Number(deck.height) || 562.5,
		document: doc,
		slides: deck.slides,
	}
}

/** The public site's root (a link made behind /private/ still points at the public studio). */
export const shareUrl = (data: string) => `${location.origin}/#/view?d=${data}`

export const publishedShareUrl = (id: string) => `${location.origin}/#/view?s=${encodeURIComponent(id)}`

export async function loadSharedDeck(query: string, signal?: AbortSignal): Promise<SharedDeck> {
	const params = new URLSearchParams(query)
	const id = params.get('s')
	if (id === null) return decodeDeck(params.get('d') ?? '')
	if (!/^[A-Za-z0-9_-]{24}$/.test(id)) throw new BadLinkError('the link is incomplete')
	const response = await fetch(`/api/shared/${id}`, { credentials: 'omit', signal })
	if (response.status === 404) throw new BadLinkError('this link has been removed or does not exist')
	if (!response.ok) throw new BadLinkError('the presentation could not be loaded; try again later')
	return readSharedDeck(await response.json())
}
