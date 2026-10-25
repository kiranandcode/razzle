import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { audienceSnapshot } from '../shared/tl/audience.ts'
import { isDeckV2, refreshSlides } from '../shared/tl/convert.ts'

export const SHARE_ID = /^[A-Za-z0-9_-]{24}$/

export async function publishShare(dir: string, input: unknown) {
  if (!isDeckV2(input) || !input.document.schema || !Array.isArray(input.slides)) throw new Error('A Razzle deck is required')
  const snapshot = audienceSnapshot(input.document, refreshSlides(input))
  if (!snapshot.slides.length) throw new Error('There are no visible slides to share')
  const deck = { format: input.format, title: input.title, width: input.width, height: input.height, ...snapshot }
  const data = JSON.stringify(deck)
  if (Buffer.byteLength(data) > 20_000_000) throw new Error('This presentation exceeds the 20 MB sharing limit')
  const id = crypto.randomBytes(18).toString('base64url')
  const meta = { id, deckId: input.id, title: input.title, createdAt: Date.now() }
  const folder = path.join(dir, id)
  await fs.mkdir(folder, { recursive: true })
  await fs.writeFile(path.join(folder, 'deck.json'), data)
  await fs.writeFile(path.join(folder, 'meta.json'), JSON.stringify(meta))
  return meta
}

export async function listShares(dir: string, deckId: string) {
  const entries = await fs.readdir(dir).catch(() => [])
  const shares = await Promise.all(entries.filter(id => SHARE_ID.test(id)).map(async id => {
    try { return JSON.parse(await fs.readFile(path.join(dir, id, 'meta.json'), 'utf8')) } catch { return null }
  }))
  return shares.filter(s => s?.deckId === deckId).sort((a, b) => b.createdAt - a.createdAt)
}
