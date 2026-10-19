// The v2 deck path: PPTist → tldraw conversion, server-side hidden-slide insertion, notes
// meta, and navigation over a v2 slide index. Converted documents are checked against the
// fork's real tldraw schema (shared/tl/dev/validate.ts) when tldraw's tooling is installed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { convertDeck, framesInOrder, insertSlide, refreshSlides, updateSlideMeta, isDeckV2 } from '../../shared/tl/convert.ts'
import { stepCountOf, move, initialState, type PresState } from '../state.ts'
import { elementText, slideText, freshIds } from '../slides.ts'
import { schemaErrors, checkV2Slide } from './v2check.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ppt = JSON.parse(fs.readFileSync(path.join(HERE, '../../shared/tools/demo.pptist.json'), 'utf8'))

test('demo deck converts to a valid v2 deck', () => {
  const d = convertDeck(ppt)
  assert.ok(isDeckV2(d))
  assert.equal(d.slides.length, ppt.slides.length)
  // visible slides first in reading order, the hidden backup last
  assert.deepEqual(d.slides.map(s => s.id), framesInOrder(d.document).map(f => f.id))
  assert.equal(d.slides.at(-1)!.razzle.hidden, true)
  // step counts match the PPTist click groups
  for (const s of ppt.slides) {
    const v = d.slides.find(x => x.id === `shape:${s.id}`)!
    assert.equal(v.stepCount, stepCountOf(s), s.id)
    assert.equal(stepCountOf(v), v.stepCount)
  }
  const errs = schemaErrors(d)
  if (errs) assert.deepEqual(errs, [])
})

test('builds: fade pairs merge, in-then-out becomes until', () => {
  const d = convertDeck(ppt)
  const store = d.document.store as Record<string, any>
  // recipe: the grey "2. Projection" under a black copy that comes in at step 4 → one shape fading in
  const proj = Object.values(store).filter((r: any) => r.type === 'text' && JSON.stringify(r.props.richText).includes('2. Projection'))
  assert.equal(proj.length, 1)
  assert.deepEqual(proj[0].meta.build, { step: 4, effect: 'fade' })
  // protocols: "Bartering…" is dark only at step 2
  const bart = Object.values(store).filter((r: any) => r.type === 'text' && JSON.stringify(r.props.richText).includes('Bartering'))
  assert.equal(bart.length, 1)
  assert.deepEqual(bart[0].meta.build, { step: 2, effect: 'fade', until: 3 })
  // glyphs: each later glyph group appears as a whole
  const groups = Object.values(store).filter((r: any) => r.type === 'group' && r.parentId === 'shape:glyphs' && r.meta.build)
  assert.deepEqual(groups.map((g: any) => g.meta.build.step).sort(), [1, 2, 3, 4])
})

test('slide index elements carry tldraw ids and text', () => {
  const d = convertDeck(ppt)
  const watchers = d.slides.find(s => s.id === 'shape:watchers')!
  const kernel = watchers.elements.find(e => e.text === 'Kernel')!
  assert.match(kernel.id, /^shape:watchers-/)
  assert.ok(d.document.store[kernel.id])
  assert.equal(elementText(kernel), 'Kernel')
  assert.match(slideText(watchers), /Who watches the watchers\?/)
})

test('a generated PPTist slide is added as a hidden frame in the backstage row', () => {
  const d = convertDeck(ppt)
  const n = d.slides.length
  const slide = freshIds({ id: 'gen', elements: [
    { id: 't', type: 'text', left: 34, top: 48, width: 900, height: 60, rotate: 0, content: '<p><span style="font-size: 35px;">Run queue</span></p>', defaultFontName: 'Libre Baskerville', defaultColor: '#000000' },
    { id: 'b', type: 'shape', left: 100, top: 200, width: 200, height: 50, rotate: 0, viewBox: [200, 50], path: 'M 0 0 L 200 0 L 200 50 L 0 50 Z', fixedRatio: false, fill: '#eeeeee',
      text: { content: '<p style="text-align: center;">Thread A</p>', defaultFontName: 'Libre Baskerville', defaultColor: '#000000', align: 'middle' } },
  ] })
  const meta = { hidden: true, generated: { by: 'director', prompt: 'run queue', at: 1 } }
  const a = insertSlide(d, { ...slide, razzle: meta })
  assert.equal(a.slideIndex, n)
  assert.equal(d.slides[n].title, 'Run queue')
  assert.equal(d.slides[n].razzle.hidden, true)
  const f1 = d.document.store[a.frameId] as any
  const bottom = Math.max(...framesInOrder(d.document).filter(f => f.id !== a.frameId).map(f => f.y + f.props.h))
  assert.ok(f1.y > bottom, 'below every slide')
  // a second one goes to the right in the same row
  const b = insertSlide(d, { ...freshIds(slide), razzle: { ...meta, generated: { ...meta.generated, at: 2 } } })
  const f2 = d.document.store[b.frameId] as any
  assert.equal(f2.y, f1.y)
  assert.ok(f2.x > f1.x)
  assert.equal(b.slideIndex, n + 1)
  assert.deepEqual(checkV2Slide(d, b.frameId), [])
})

test('notes and script go into the frame meta and refresh the index', () => {
  const d = convertDeck(ppt)
  assert.ok(updateSlideMeta(d, 'shape:vision', { script: ['a', 'b'], notes: '<p>n</p>' }))
  d.slides = refreshSlides(d)
  const s = d.slides.find(x => x.id === 'shape:vision')!
  assert.deepEqual(s.razzle.script, ['a', 'b'])
  assert.equal(s.razzle.notes, '<p>n</p>')
  assert.equal(s.stepCount, 2)
  assert.ok(s.elements.length > 0)
})

test('navigation over a v2 index skips the hidden slide', () => {
  const d = convertDeck(ppt)
  let st: PresState = { ...initialState(), deckId: 'demo', stepCount: d.slides[0].stepCount }
  const seen: string[] = []
  for (let i = 0; i < 60; i++) {
    const n = move(st, d.slides, { action: 'next', source: 'human' })
    if (!n) break
    st = n
    seen.push(`${st.slideIndex}.${st.step}`)
  }
  const total = d.slides.filter(s => !s.razzle.hidden).reduce((k, s) => k + s.stepCount, 0)
  assert.equal(seen.length, total - 1)
  assert.ok(!seen.some(p => p.startsWith(`${d.slides.length - 1}.`)))
})
