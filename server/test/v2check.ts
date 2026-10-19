// Checks of Razzle v2 decks for the tests: structure here, and the fork's real tldraw schema
// (validators + migrations) through shared/tl/dev/validate.ts, run with tldraw's tsx.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const TSX = path.join(ROOT, 'tldraw', 'node_modules', '.bin', 'tsx')

/** Run the headless schema validator on a deck. Null when tldraw's tooling is not installed. */
export function schemaErrors(deck: unknown): string[] | null {
  if (!fs.existsSync(TSX)) return null
  const dir = path.join(HERE, '..', '.tmp', 'v2check')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `deck-${process.pid}-${Date.now()}.json`)
  fs.writeFileSync(file, JSON.stringify(deck))
  try {
    const r = spawnSync(TSX, ['--tsconfig', path.join(ROOT, 'shared/tl/dev/tsconfig.json'), path.join(ROOT, 'shared/tl/dev/validate.ts'), file], { encoding: 'utf8' })
    if (r.status === 0) return []
    return (r.stdout + r.stderr).split('\n').filter(l => l.startsWith('    ') || /Error/.test(l)).map(l => l.trim()).filter(Boolean)
  } finally { fs.rmSync(file, { force: true }) }
}

/** Problems with one slide (frame) of a v2 deck, including the whole deck's schema check. */
export function checkV2Slide(deck: any, frameId: string): string[] {
  const errs: string[] = []
  const f = deck?.document?.store?.[frameId]
  if (!f || f.type !== 'frame') return [`no frame ${frameId}`]
  const kids = Object.values(deck.document.store).filter((r: any) => r.parentId === frameId)
  if (!kids.length) errs.push('frame is empty')
  const s = deck.slides.find((x: any) => x.id === frameId)
  if (!s) errs.push('not in slides')
  else if (!s.elements.length) errs.push('slide index has no elements')
  errs.push(...(schemaErrors(deck) ?? []))
  return errs
}
