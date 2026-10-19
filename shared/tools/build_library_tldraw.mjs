#!/usr/bin/env node
// Builds shared/library.tldraw.json (the studio's shape library) from shared/library.json via
// the PPTist converter (shared/tl/convert.ts). Run after build_library.mjs.
//   node shared/tools/build_library_tldraw.mjs
//
// Item: {id, name, category, description, width, height, shapes, assets?}. `shapes` are tldraw
// shape partials positioned from (0, 0): top-level shapes carry no parentId; group members
// name their group as parentId; `index` gives the stacking order. Ids are placeholders the
// studio regenerates (tldraw/apps/razzle/src/editor/library.ts).
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { convertElements } from '../tl/convert.ts'

const here = dirname(fileURLToPath(import.meta.url))
const lib = JSON.parse(readFileSync(resolve(here, '../library.json'), 'utf8'))
const TOP = 'page:page'
const warnings = []
const items = lib.map((it) => {
	const c = convertElements(it.elements, undefined, TOP, { prefix: `${it.id}-`, warnings })
	const shapes = c.shapes.map(({ typeName, parentId, ...s }) => (parentId === TOP ? s : { ...s, parentId }))
	const out = { id: it.id, name: it.name, category: it.category, description: it.description, width: it.width, height: it.height, shapes }
	if (c.assets.length) out.assets = c.assets
	return out
})
writeFileSync(resolve(here, '../library.tldraw.json'), JSON.stringify(items, null, 1) + '\n')
console.log('library.tldraw.json:', items.length, 'items,', items.reduce((n, it) => n + it.shapes.length, 0), 'shapes')
for (const w of new Set(warnings)) console.log('  warning:', w)
