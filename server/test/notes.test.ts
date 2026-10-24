import { test } from 'node:test'
import assert from 'node:assert/strict'
import { noteItems, notePatches, type Take } from '../notes.ts'

const speech = (slideId: string, step: number, text: string) => ({ slideId, step, text, t0: 0, t1: 1, slideIndex: 0 })
const take = (id: string, utterances: Take['utterances'], startedAt = 1): Take => ({ id, deckId: 'demo', startedAt, endedAt: startedAt + 1, utterances })
const slide = { id: 'a', stepCount: 2, elements: [], razzle: { notes: '<p>Discard this draft</p>', script: ['invented', 'also invented'] } }

test('first rehearsal replaces draft notes; only rehearsed slides are included', () => {
  const items = noteItems([slide, { ...slide, id: 'b' }], [take('first', [speech('a', 0, 'My own words')])])
  assert.equal(items.length, 1)
  assert.equal(items[0].previous, null)
  assert.deepEqual(items[0].spoken, [{ takeId: 'first', steps: ['My own words', ''] }])
  const patch = notePatches(items, { slides: [{ id: 'a', notes: ['My <own> words'], script: ['My own words', 'invented'] }] }).get('a')!
  assert.deepEqual(patch.script, ['My own words', ''])
  assert.equal(patch.notes, '<p>My &lt;own&gt; words</p>')
  assert.deepEqual(patch.rehearsal.takeIds, ['first'])
})

test('later partial runs keep untouched steps and include manual notes edits', () => {
  const previous = { ...slide, razzle: { notes: '<p>My manual edit</p>', script: ['Keep this', 'Old phrasing'], rehearsal: { takeIds: ['first'] } } }
  const takes = [take('second', [speech('a', 1, 'New phrasing')], 5), take('first', [speech('a', 0, 'Already used')])]
  const items = noteItems([previous], takes)
  assert.equal(items[0].previous?.notes, '<p>My manual edit</p>')
  assert.deepEqual(items[0].spoken, [{ takeId: 'second', steps: ['', 'New phrasing'] }])
  const patch = notePatches(items, { slides: [{ id: 'a', notes: ['My manual edit', 'New phrasing'], script: ['', 'New phrasing'] }] }).get('a')!
  assert.deepEqual(patch.script, ['Keep this', 'New phrasing'])
  assert.deepEqual(noteItems([{ ...previous, razzle: patch }], takes), [])
})

test('manual notes from the first run survive while old generated scripts are discarded', () => {
  const edited = { ...slide, razzle: { ...slide.razzle, notes: '<p>My correction</p>', notesEditedAt: 10 } }
  const items = noteItems([edited], [take('first', [speech('a', 0, 'My words')])])
  assert.deepEqual(items[0].previous, { notes: '<p>My correction</p>', script: [] })
})

test('stable slide ids survive insertion and reordering; active takes stay out', () => {
  const running = { ...take('running', [speech('b', 0, 'Not finished')]), endedAt: undefined }
  const items = noteItems([{ ...slide, id: 'new' }, { ...slide, id: 'b' }, slide], [running, take('done', [speech('a', 0, 'A')])])
  assert.deepEqual(items.map(i => i.id), ['a'])
})

test('malformed, duplicate, and unrequested slide outputs are rejected before writes', () => {
  const items = noteItems([slide], [take('done', [speech('a', 0, 'A')])])
  for (const out of [null, { slides: [] }, { slides: [{ id: 'other', notes: [], script: ['', ''] }] },
    { slides: [{ id: 'a', notes: [5], script: ['', ''] }] }, { slides: [{ id: 'a', notes: [], script: [''] }] }]) {
    assert.throws(() => notePatches(items, out))
  }
})

test('redo discards only the current slide before its reset; live and rehearsal takes never write notes', () => {
  const old = take('old', [speech('a', 0, 'Discard'), speech('b', 0, 'Keep')])
  const redo: Take = { ...take('redo', [
    { ...speech('a', 0, 'False start'), t0: 10 },
    { ...speech('a', 0, 'Fresh narration'), t0: 30 },
  ], 10), workflow: 'draft', resets: [{ slideId: 'a', at: 20 }] }
  const extra = ['present', 'rehearse'].map((workflow, i) => ({ ...take('ignore' + i, [speech('a', 0, 'Ignore')]), workflow })) as Take[]
  const items = noteItems([slide, { ...slide, id: 'b' }], [old, redo, ...extra])
  assert.deepEqual(items[0].spoken, [{ takeId: 'redo', steps: ['Fresh narration', ''] }])
  assert.equal(items[0].previous, null)
  assert.deepEqual(items[0].takeIds, ['old', 'redo'])
  assert.equal(items[1].spoken[0].steps[0], 'Keep')
  const patch = notePatches(items, { slides: items.map(i => ({ id: i.id, notes: ['Fresh'], script: ['Fresh', ''] })) }).get('a')!
  assert.deepEqual(noteItems([{ ...slide, razzle: patch }], [old, redo, ...extra]), [])
})

test('corrections follow speech order even when ASR finishes out of order', () => {
  const items = noteItems([slide], [take('r', [
    { ...speech('a', 0, 'Actually the new wording'), t0: 20 },
    { ...speech('a', 0, 'Earlier wording'), t0: 10 },
  ])])
  assert.equal(items[0].spoken[0].steps[0], 'Earlier wording Actually the new wording')
})
