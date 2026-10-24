import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deliveryPatches, deliveryFor, cadenceDelay } from '../delivery.ts'
import type { Take } from '../notes.ts'

test('learns the latest completed visit, preserving click cadence and ignoring silent navigation', () => {
  const slide = { id: 'a', stepCount: 2, razzle: { script: ['Point', 'Next'] } }
  const take: Take = {
    id: 'r', deckId: 'd', workflow: 'rehearse', startedAt: 100, endedAt: 10000,
    utterances: [
      { slideId: 'a', slideIndex: 0, step: 0, t0: 200, t1: 500, text: 'Earlier attempt' },
      { slideId: 'a', slideIndex: 0, step: 0, t0: 2200, t1: 2900, text: 'This is the point um' },
    ],
    transitions: [
      { slideId: 'a', step: 0, enteredAt: 2000, at: 3500, script: 'Point', steps: 2 },
      { slideId: 'a', step: 1, enteredAt: 3500, at: 4000, script: 'Next', steps: 2 },
    ],
  }
  const patch = deliveryPatches([slide], [take]).get('a')!
  assert.equal(patch.delivery[0].examples[0].text, 'This is the point um')
  assert.equal(patch.delivery[0].examples[0].ending, 'This is the point')
  assert.equal(patch.delivery[0].examples[0].pauseMs, 600)
  assert.equal(patch.delivery[1], undefined)
  const learned = { ...slide, razzle: { ...slide.razzle, ...patch } }
  assert.equal(cadenceDelay(deliveryFor(learned, 0), 10000, 10200), 400)
  assert.equal(cadenceDelay(deliveryFor(learned, 0), 10000, 12000), 0, 'ASR latency already consumed the pause')
  assert.equal(deliveryFor({ ...learned, stepCount: 3 }, 0), undefined)
  assert.equal(deliveryFor({ ...learned, razzle: { ...learned.razzle, script: ['Changed'] } }, 0), undefined)
  assert.equal(deliveryPatches([slide], [{ ...take, workflow: 'present' }]).size, 0)
})
