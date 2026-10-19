// Validate converted tldraw data against the fork's real schema (validators + migrations),
// headless. Accepts a Razzle v2 deck (decks/*.json) or shared/library.tldraw.json.
//
//   tldraw/node_modules/.bin/tsx --tsconfig shared/tl/dev/tsconfig.json shared/tl/dev/validate.ts decks/demo.json [...]
//
// Checks: snapshot migrates; every record passes its type's validator; parents exist;
// sibling indices are valid and unique; groups have ≥ 2 children; frames sit on the page;
// the derived `slides` match the frames (ids, order, step counts).
import { readFileSync } from 'node:fs'
import { schema } from './schema.ts'
import { framesInOrder } from '../convert.ts'
import { PALETTE } from '../palette.ts'

/** shared/tl/palette.ts must name the same colours, with the same hexes, as the studio theme. */
export function checkPalette(): string[] {
	const src = readFileSync(new URL('../../../tldraw/apps/razzle/src/theme/index.ts', import.meta.url), 'utf8')
	const theme = new Map([...src.matchAll(/\['([a-z-]+)', '(#[0-9a-f]{6})'/g)].map((m) => [m[1], m[2]]))
	const errs: string[] = []
	for (const [k, v] of Object.entries(PALETTE)) if (theme.get(k) !== v) errs.push(`palette: ${k} ${v} != theme ${theme.get(k) ?? '(missing)'}`)
	for (const k of theme.keys()) if (!(k in PALETTE)) errs.push(`palette: theme colour ${k} missing from shared/tl/palette.ts`)
	return errs
}

type R = Record<string, any>

export function validateSnapshot(snap: R, label = 'snapshot'): string[] {
	const errs: string[] = []
	const res = schema.migrateStoreSnapshot(snap as any)
	if (res.type === 'error') return [`${label}: migration failed: ${res.reason}`]
	const store = res.value as Record<string, R>
	for (const rec of Object.values(store)) {
		const t = (schema.types as R)[rec.typeName]
		if (!t) { errs.push(`${label}: ${rec.id}: unknown typeName ${rec.typeName}`); continue }
		try { t.validate(rec) } catch (e) { errs.push(`${label}: ${rec.id} (${rec.type ?? rec.typeName}): ${(e as Error).message}`) }
	}
	const kids = new Map<string, R[]>()
	for (const rec of Object.values(store)) {
		if (rec.typeName !== 'shape') continue
		if (!store[rec.parentId]) errs.push(`${label}: ${rec.id}: parent ${rec.parentId} missing`)
		if (!kids.has(rec.parentId)) kids.set(rec.parentId, [])
		kids.get(rec.parentId)!.push(rec)
		if (rec.type === 'image' && rec.props.assetId && !store[rec.props.assetId]) errs.push(`${label}: ${rec.id}: asset ${rec.props.assetId} missing`)
	}
	for (const [pid, cs] of kids) {
		const idx = cs.map((c) => c.index)
		if (new Set(idx).size !== idx.length) errs.push(`${label}: duplicate sibling indices under ${pid}`)
		const p = store[pid]
		if (p?.type === 'group' && cs.length < 2) errs.push(`${label}: group ${pid} has ${cs.length} child`)
	}
	for (const rec of Object.values(store)) {
		if (rec.type === 'group' && !(kids.get(rec.id)?.length)) errs.push(`${label}: group ${rec.id} is empty`)
	}
	return errs
}

export function validateDeck(deck: R, label: string): string[] {
	const errs = validateSnapshot(deck.document, label)
	if (deck.format !== 'razzle-tldraw/1') errs.push(`${label}: format is ${deck.format}`)
	const frames = framesInOrder(deck.document)
	const ids = frames.map((f) => f.id)
	const sids = (deck.slides ?? []).map((s: R) => s.id)
	if (JSON.stringify(ids) !== JSON.stringify(sids)) errs.push(`${label}: slides order ${sids.join(',')} != frames ${ids.join(',')}`)
	for (const s of deck.slides ?? []) {
		const f = deck.document.store[s.id]
		if (!f) continue
		// step count from the document
		let max = 0
		const under = new Set([f.id])
		let grew = true
		while (grew) {
			grew = false
			for (const r of Object.values(deck.document.store) as R[]) {
				if (r.typeName === 'shape' && under.has(r.parentId) && !under.has(r.id)) { under.add(r.id); grew = true }
			}
		}
		for (const id of under) {
			const b = deck.document.store[id]?.meta?.build
			if (b) max = Math.max(max, b.step, b.until ?? 0)
		}
		if (s.stepCount !== max + 1) errs.push(`${label}: slide ${s.id} stepCount ${s.stepCount} != ${max + 1}`)
		for (const e of s.elements ?? []) if (!under.has(e.id)) errs.push(`${label}: slide ${s.id} element ${e.id} not in its frame`)
		if (JSON.stringify(s.razzle ?? {}) !== JSON.stringify(f.meta?.razzle ?? {})) errs.push(`${label}: slide ${s.id} razzle differs from frame meta`)
	}
	return errs
}

export function validateLibrary(items: R[]): string[] {
	const errs: string[] = []
	for (const it of items) {
		const records: R[] = [
			{ id: 'document:document', typeName: 'document', gridSize: 10, name: '', meta: {} },
			{ id: 'page:page', typeName: 'page', name: 'Page 1', index: 'a1', meta: {} },
			...(it.assets ?? []),
			...it.shapes.map((s: R) => ({ typeName: 'shape', parentId: 'page:page', ...s })),
		]
		const store: R = {}
		for (const r of records) store[r.id] = r
		errs.push(...validateSnapshot({ store, schema: schema.serialize() }, `library ${it.id}`))
	}
	return errs
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) {
	let bad = 0
	const pal = checkPalette()
	console.log(`${pal.length ? 'FAIL' : 'ok  '} palette matches the studio theme`)
	for (const e of pal) console.log('   ', e)
	bad += pal.length
	for (const f of process.argv.slice(2)) {
		const data = JSON.parse(readFileSync(f, 'utf8'))
		const errs = Array.isArray(data) ? validateLibrary(data) : validateDeck(data, f)
		const n = Array.isArray(data) ? `${data.length} items` : `${Object.keys(data.document.store).length} records, ${data.slides.length} slides`
		console.log(`${errs.length ? 'FAIL' : 'ok  '} ${f} (${n})`)
		for (const e of errs.slice(0, 40)) console.log('   ', e)
		if (errs.length > 40) console.log(`    … ${errs.length - 40} more`)
		bad += errs.length
	}
	process.exit(bad ? 1 : 0)
}
