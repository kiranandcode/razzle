import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CueTracker, tokens, findPhrase } from '../cues.ts'

const sinks = [{ id: 'c1', phrase: 'sinks', action: 'next' as const }]

test('tokens strip punctuation and whisper annotations', () => {
  assert.deepEqual(tokens("And then it SINKS. [BLANK_AUDIO] It's (music) done"), ['and', 'then', 'it', 'sinks', 'its', 'done'])
  assert.equal(findPhrase(tokens('the water sinks fast'), tokens('Sinks fast')), 4)
  assert.equal(findPhrase(tokens('the water sinking'), tokens('sinks')), -1)
})

test('a cue fires once per segment across partials and its final', () => {
  const t = new CueTracker()
  assert.equal(t.feed(1, 'the water', false, sinks, 0), null)
  assert.equal(t.feed(1, 'the water sinks', false, sinks, 0)?.cue.id, 'c1')
  t.onNav()
  assert.equal(t.feed(1, 'the water sinks and', false, sinks, 0), null)
  assert.equal(t.feed(1, 'The water sinks and then', true, sinks, 0), null)
  assert.equal(t.feed(2, 'it sinks again', false, sinks, 0)?.cue.id, 'c1')
})

test('words heard before a nav do not fire the next slide\'s cues', () => {
  const t = new CueTracker()
  t.feed(1, 'it sinks', false, [], 0) // slide without cues
  t.onNav() // human moves to a slide whose cue is "sinks"
  assert.equal(t.feed(1, 'it sinks', false, sinks, 0), null)
  assert.equal(t.feed(1, 'it sinks and then it sinks', false, sinks, 0)?.cue.id, 'c1')
})

test('atStep arms a cue only at that build step', () => {
  const t = new CueTracker()
  const c = [{ id: 's', phrase: 'next point', action: 'step' as const, atStep: 1 }]
  assert.equal(t.feed(1, 'my next point', false, c, 0), null)
  assert.equal(t.feed(2, 'my next point', false, c, 1)?.cue.id, 's')
})
