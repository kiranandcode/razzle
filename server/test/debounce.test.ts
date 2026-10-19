import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyNav, initialState, newClock, stepCountOf, type PresState, type NavRequest } from '../state.ts'

const slides = [
  { id: 'a', elements: [{ id: 'x' }, { id: 'y' }], animations: [
    { elId: 'x', trigger: 'click' }, { elId: 'y', trigger: 'meantime' }, { elId: 'y', trigger: 'click' }] },
  { id: 'b', elements: [] },
  { id: 'h', elements: [], razzle: { hidden: true } },
  { id: 'c', elements: [] },
]

function run(steps: [number, NavRequest][], start?: Partial<PresState>) {
  let s: PresState = { ...initialState(), deckId: 'd', stepCount: stepCountOf(slides[0]), ...start }
  const clock = newClock()
  const out: { accepted: boolean, reason?: string, at: string }[] = []
  for (const [t, req] of steps) {
    const r = applyNav(s, slides, req, clock, t)
    s = r.state
    out.push({ accepted: r.accepted, reason: r.accepted ? undefined : r.reason, at: `${s.slideIndex}.${s.step}` })
  }
  return out
}

test('step counts follow PPTist click groups', () => {
  assert.equal(stepCountOf(slides[0]), 3)
  assert.equal(stepCountOf(slides[1]), 1)
  assert.equal(stepCountOf({ id: 'z', elements: [{ id: 'q' }], animations: [{ elId: 'q', trigger: 'auto' }, { elId: 'gone', trigger: 'click' }] }), 1)
})

test('next walks build steps, then slides, skipping hidden; prev lands on last step', () => {
  const r = run([[0, { action: 'next', source: 'human' }], [10, { action: 'next', source: 'human' }],
    [20, { action: 'next', source: 'human' }], [30, { action: 'next', source: 'human' }],
    [40, { action: 'next', source: 'human' }], [50, { action: 'prev', source: 'human' }], [60, { action: 'prev', source: 'human' }]])
  assert.deepEqual(r.map(x => x.at), ['0.1', '0.2', '1.0', '3.0', '3.0', '1.0', '0.2'])
  assert.equal(r[4].accepted, false) // end of deck
})

test('goto reaches hidden slides; next from a hidden slide continues past it', () => {
  const r = run([[0, { action: 'goto', slide: 2, source: 'human' }], [10, { action: 'next', source: 'human' }]])
  assert.deepEqual(r.map(x => x.at), ['2.0', '3.0'])
})

test('human next within 1200 ms of an agent/cue next is dropped; prev is not', () => {
  const r = run([[0, { action: 'goto', slide: 1, source: 'human' }],
    [5000, { action: 'next', source: 'cue' }],
    [5500, { action: 'next', source: 'human' }],
    [5700, { action: 'prev', source: 'human' }]])
  assert.deepEqual(r.map(x => [x.accepted, x.at]), [[true, '1.0'], [true, '3.0'], [false, '3.0'], [true, '1.0']])
})

test('human next after 1200 ms is accepted', () => {
  const r = run([[0, { action: 'next', source: 'agent' }], [1300, { action: 'next', source: 'human' }]])
  assert.deepEqual(r.map(x => x.accepted), [true, true])
})

test('agent/cue nav within 2500 ms of any human nav is dropped', () => {
  const r = run([[0, { action: 'next', source: 'human' }], [2400, { action: 'next', source: 'agent' }],
    [2450, { action: 'next', source: 'cue' }], [2600, { action: 'next', source: 'agent' }]])
  assert.deepEqual(r.map(x => x.accepted), [true, false, false, true])
  assert.equal(r[1].reason, 'human is driving')
})

test('a dropped human next still counts as the human driving', () => {
  const r = run([[0, { action: 'next', source: 'agent' }], [500, { action: 'next', source: 'human' }],
    [2000, { action: 'next', source: 'agent' }], [3100, { action: 'next', source: 'agent' }]])
  assert.deepEqual(r.map(x => x.accepted), [true, false, false, true])
})

test('at most one agent/cue nav per 1500 ms', () => {
  const r = run([[0, { action: 'next', source: 'cue' }], [1000, { action: 'next', source: 'agent' }],
    [1499, { action: 'next', source: 'cue' }], [1500, { action: 'next', source: 'cue' }]])
  assert.deepEqual(r.map(x => x.accepted), [true, false, false, true])
})

test('a dropped nav does not change state or lastNav', () => {
  const r = run([[0, { action: 'next', source: 'human' }], [100, { action: 'next', source: 'agent' }]])
  assert.equal(r[1].at, '0.1')
})
