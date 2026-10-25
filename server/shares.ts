import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { audienceSnapshot } from '../shared/tl/audience.ts'
import { isDeckV2, refreshSlides, type DeckV2 } from '../shared/tl/convert.ts'

export const SHARE_ID = /^[A-Za-z0-9_-]{24}$/

function shareData(input: DeckV2) {
  if (!input.document.schema || !Array.isArray(input.slides)) throw new Error('A Razzle deck is required')
  const snapshot = audienceSnapshot(input.document, refreshSlides(input))
  if (!snapshot.slides.length) throw new Error('There are no visible slides to share')
  const deck = { format: input.format, title: input.title, width: input.width, height: input.height, ...snapshot }
  const data = JSON.stringify(deck)
  if (Buffer.byteLength(data) > 20_000_000) throw new Error('This presentation exceeds the 20 MB sharing limit')
  return data
}

export async function publishShare(dir: string, input: unknown) {
  if (!isDeckV2(input)) throw new Error('Save the deck before sharing it')
  shareData(input)
  const id = crypto.randomBytes(18).toString('base64url')
  const meta = { id, deckId: input.id, title: input.title, createdAt: Date.now() }
  const folder = path.join(dir, id)
  await fs.mkdir(folder, { recursive: true })
  await fs.writeFile(path.join(folder, 'meta.json'), JSON.stringify(meta))
  return meta
}

/** Existing snapshot links already have deckId metadata, so they follow saved edits too. */
export async function readShare(dir: string, id: string, readDeck: (id: string) => Promise<unknown>) {
  if (!SHARE_ID.test(id)) return null
  let meta: { deckId?: string }
  try { meta = JSON.parse(await fs.readFile(path.join(dir, id, 'meta.json'), 'utf8')) }
  catch { return null }
  if (typeof meta?.deckId !== 'string') return null
  const deck = await readDeck(meta.deckId)
  if (!isDeckV2(deck)) return null
  // Never fall back to an old snapshot: hidden or deleted content must disappear.
  try { return shareData(deck) } catch { return null }
}

export async function listShares(dir: string, deckId: string) {
  const entries = await fs.readdir(dir).catch(() => [])
  const shares = await Promise.all(entries.filter(id => SHARE_ID.test(id)).map(async id => {
    try { return JSON.parse(await fs.readFile(path.join(dir, id, 'meta.json'), 'utf8')) } catch { return null }
  }))
  return shares.filter(s => s?.deckId === deckId).sort((a, b) => b.createdAt - a.createdAt)
}
