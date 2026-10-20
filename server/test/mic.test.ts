// The browser mic (RAZZLE_AUDIO=browser): who may send `asr`, and segment id namespacing.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BrowserMic } from '../mic.ts'

const A = { name: 'a' }, B = { name: 'b' }

test('only the holder is heard; the latest claim wins', () => {
  const m = new BrowserMic<object>()
  assert.equal(m.translate(A, { kind: 'segment-start', segId: 1 }, true), null)
  assert.equal(m.claim(A).previous, null)
  const s = m.translate(A, { kind: 'segment-start', segId: 1, t0: Date.now() }, true)
  assert.equal(s?.kind, 'segment-start')
  assert.equal(m.translate(B, { kind: 'partial', segId: 1, text: 'hi' }, true), null)
  const { previous, ended } = m.claim(B)
  assert.equal(previous, A)
  // A's open segment is closed with an empty final
  assert.deepEqual(ended.map(e => [e.kind, e.segId, (e as any).text]), [['final', s!.segId, '']])
  assert.equal(m.translate(A, { kind: 'partial', segId: 1, text: 'late' }, true), null)
  assert.equal(m.release(A).released, false)
  assert.equal(m.release(B).released, true)
  assert.equal(m.active, false)
})

test('client segment ids map to fresh server ids per claim', () => {
  const m = new BrowserMic<object>()
  m.claim(A)
  const s1 = m.translate(A, { kind: 'segment-start', segId: 1 }, true)!
  const f1 = m.translate(A, { kind: 'final', segId: 1, text: 'one' }, true)!
  assert.equal(f1.segId, s1.segId)
  m.release(A)
  m.claim(A) // a reconnect: the client starts counting from 1 again
  const s2 = m.translate(A, { kind: 'segment-start', segId: 1 }, true)!
  assert.ok(s2.segId > s1.segId)
  assert.equal(m.translate(A, { kind: 'segment-start', segId: 1 }, true), null, 'a second start of the same segment is dropped')
})

test('partial, pause, late partial, final', () => {
  const m = new BrowserMic<object>()
  m.claim(A)
  m.translate(A, { kind: 'segment-start', segId: 'x7' }, true)
  assert.equal(m.translate(A, { kind: 'partial', segId: 'x7', text: 'the boat' }, true)?.kind, 'partial')
  assert.equal(m.translate(A, { kind: 'pause', segId: 'x7', text: 'the boat sinks' }, true)?.kind, 'pause')
  assert.equal(m.translate(A, { kind: 'partial', segId: 'x7', text: 'the boat sin' }, true)?.kind, 'late-partial')
  const f = m.translate(A, { kind: 'final', segId: 'x7', text: 'the boat sinks', t0: 'bad', t1: 1e20 }, true)
  assert.equal(f?.kind, 'final')
  assert.ok(f && f.kind === 'final' && Math.abs(f.t1 - Date.now()) < 1000, 'implausible times are replaced')
  assert.equal(m.translate(A, { kind: 'final', segId: 'x7', text: 'again' }, true), null)
  assert.equal(m.translate(A, { kind: 'bogus', segId: 'x8' }, true), null)
})

test('nothing starts while not accepting (idle), but open segments can still finish', () => {
  const m = new BrowserMic<object>()
  m.claim(A)
  m.translate(A, { kind: 'segment-start', segId: 1 }, true)
  assert.equal(m.translate(A, { kind: 'segment-start', segId: 2 }, false), null)
  assert.equal(m.translate(A, { kind: 'final', segId: 2, text: 'x' }, false), null)
  assert.equal(m.translate(A, { kind: 'final', segId: 1, text: 'done' }, false)?.kind, 'final')
})
