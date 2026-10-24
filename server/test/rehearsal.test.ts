import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import WebSocket from 'ws'

test('presentations save takes, update notes across runs, and preserve concurrent edits', { timeout: 25000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'razzle-rehearsal-test-'))
  const port = 18000 + Math.floor(Math.random() * 20000)
  const url = `http://127.0.0.1:${port}`
  const runner = path.join(dir, 'codex-test')
  await writeFile(runner, `#!${process.execPath}
import fs from 'node:fs'
let prompt = ''
for await (const chunk of process.stdin) prompt += chunk
const items = JSON.parse(prompt.slice(prompt.lastIndexOf('\\n') + 1))
if (prompt.includes('A third run')) while (!fs.existsSync(${JSON.stringify(path.join(dir, 'continue'))})) await new Promise(r => setTimeout(r, 20))
await new Promise(r => setTimeout(r, 50))
const slides = items.map(i => ({id:i.id, notes:[i.spoken.at(-1).steps.filter(Boolean).join(' ')], script:i.spoken.at(-1).steps}))
fs.writeFileSync(process.argv[process.argv.indexOf('--output-last-message') + 1], JSON.stringify({slides}))
`, { mode: 0o700 })
  await writeFile(path.join(dir, 'demo.json'), JSON.stringify({ id: 'demo', title: 'Test', slides: [
    { id: 'a', stepCount: 2, elements: [], razzle: { notes: '<p>Initial draft</p>', script: ['bad', 'bad'] } },
    { id: 'b', elements: [], razzle: { notes: '<p>Untouched</p>' } },
  ] }))
  const child = spawn(process.execPath, ['server.ts'], { cwd: path.resolve(import.meta.dirname, '..'), env: {
    ...process.env, RAZZLE_PORT: String(port), RAZZLE_DECKS_DIR: dir, RAZZLE_AUDIO: 'browser', RAZZLE_NO_LAUNCH: '1',
    RAZZLE_CODEX_BIN: runner, RAZZLE_HTPASSWD: '', RAZZLE_QUIET: '1',
  }, stdio: ['ignore', 'pipe', 'pipe'] })
  let logs = ''
  child.stderr.on('data', d => { logs += d })
  let ws: WebSocket | undefined
  const wait = async (predicate: () => Promise<boolean> | boolean) => {
    const until = Date.now() + 8000
    while (Date.now() < until) {
      if (await predicate()) return
      await new Promise(r => setTimeout(r, 25))
    }
    throw new Error('Timed out: ' + logs)
  }
  const api = async (p: string, method = 'GET', data?: unknown) => {
    const r = await fetch(url + p, { method, headers: { 'content-type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) })
    return { status: r.status, body: await r.json() as any }
  }
  try {
    await wait(async () => { try { return (await fetch(url + '/api/state')).ok } catch { return false } })
    ws = new WebSocket(url.replace('http:', 'ws:') + '/ws')
    await once(ws, 'open')
    const events: any[] = []
    ws.on('message', raw => events.push(JSON.parse(String(raw))))
    const send = (m: object) => ws!.send(JSON.stringify(m))
    send({ t: 'hello', role: 'speaker', deckId: 'demo' })
    const run = async (text: string, step: number, segId: number) => {
      const r = await api('/api/mode', 'POST', { mode: 'present', workflow: 'draft', deckId: 'demo', auto: false })
      assert.ok(r.body.state.takeId, 'present starts a take')
      await api('/api/nav', 'POST', { action: 'goto', slide: 0, step })
      send({ t: 'mic', on: true })
      send({ t: 'asr', kind: 'segment-start', segId, t0: Date.now() })
      send({ t: 'asr', kind: 'final', segId, text, t0: Date.now(), t1: Date.now() })
      await wait(() => events.some(e => e.t === 'transcript' && e.final?.text === text))
      return r.body.state.takeId
    }
    await run('My first phrasing', 0, 1)
    await api('/api/mode', 'POST', { mode: 'idle' })
    await wait(() => events.some(e => e.t === 'notes-status' && e.status === 'saved'))
    let d = (await api('/api/decks/demo')).body
    assert.equal(d.slides[0].razzle.notes, '<p>My first phrasing</p>')
    assert.deepEqual(d.slides[0].razzle.script, ['My first phrasing', ''])
    assert.equal(d.slides[1].razzle.notes, '<p>Untouched</p>')
    const takes = (await api('/api/decks/demo/takes')).body
    assert.equal(takes[0].utterances[0].slideId, 'a')
    assert.ok(takes[0].endedAt)

    events.length = 0
    await run('The next step', 1, 2)
    await api('/api/mode', 'POST', { mode: 'idle' })
    await wait(() => events.some(e => e.t === 'notes-status' && e.status === 'saved'))
    d = (await api('/api/decks/demo')).body
    assert.deepEqual(d.slides[0].razzle.script, ['My first phrasing', 'The next step'])
    assert.equal(d.slides[0].razzle.rehearsal.takeIds.length, 2)

    // Rehearsing learns a manual transition without changing the settled notes.
    events.length = 0
    const rehearsal = await api('/api/mode', 'POST', { mode: 'present', workflow: 'rehearse', deckId: 'demo' })
    assert.equal(rehearsal.body.state.auto, false)
    await api('/api/nav', 'POST', { action: 'goto', slide: 0, step: 0 })
    send({ t: 'asr', kind: 'segment-start', segId: 20, t0: Date.now() })
    send({ t: 'asr', kind: 'final', segId: 20, text: 'That is my first phrasing', t0: Date.now(), t1: Date.now() })
    await wait(() => events.some(e => e.final?.text === 'That is my first phrasing'))
    const blocked = await api('/api/nav', 'POST', { action: 'next', source: 'agent' })
    assert.equal(blocked.body.accepted, false)
    await api('/api/nav', 'POST', { action: 'next', source: 'human' })
    await api('/api/mode', 'POST', { mode: 'idle' })
    await wait(() => events.some(e => e.t === 'notes-status' && e.status === 'saved'))
    let rehearsed = (await api('/api/decks/demo')).body
    assert.equal(rehearsed.slides[0].razzle.notes, d.slides[0].razzle.notes)
    assert.equal(rehearsed.slides[0].razzle.delivery[0].examples[0].ending, 'That is my first phrasing')

    const live = await api('/api/mode', 'POST', { mode: 'present', workflow: 'present', deckId: 'demo', recording: false })
    assert.equal(live.body.state.takeId, null)
    assert.equal(live.body.state.auto, true)
    await api('/api/mode', 'POST', { mode: 'idle' })
    const liveRecord = await api('/api/mode', 'POST', { mode: 'present', workflow: 'present', deckId: 'demo', recording: true })
    assert.ok(liveRecord.body.state.takeId)
    send({ t: 'asr', kind: 'segment-start', segId: 21, t0: Date.now() })
    send({ t: 'asr', kind: 'final', segId: 21, text: 'Live ad lib must not replace notes', t0: Date.now(), t1: Date.now() })
    await wait(() => events.some(e => e.final?.text === 'Live ad lib must not replace notes'))
    await api('/api/mode', 'POST', { mode: 'idle' })
    await wait(async () => (await api('/api/decks/demo/takes')).body.some((t: any) => t.id === liveRecord.body.state.takeId && t.endedAt))
    rehearsed = (await api('/api/decks/demo')).body
    assert.equal(rehearsed.slides[0].razzle.notes, d.slides[0].razzle.notes)

    events.length = 0
    await run('A third run', 1, 3)
    await api('/api/mode', 'POST', { mode: 'idle' })
    await wait(() => events.some(e => e.t === 'notes-status' && e.status === 'writing'))
    await new Promise(r => setTimeout(r, 75))
    const edit = await api('/api/decks/demo/speech', 'PATCH', { slideId: 'a', notes: '<p>My correction</p>', expectedNotes: d.slides[0].razzle.notes })
    assert.equal(edit.status, 200)
    await writeFile(path.join(dir, 'continue'), '')
    await wait(() => events.some(e => e.t === 'notes-status' && e.status === 'error'))
    d = (await api('/api/decks/demo')).body
    assert.equal(d.slides[0].razzle.notes, '<p>My correction</p>')
    const stale = await api('/api/decks/demo/speech', 'PATCH', { slideId: 'a', notes: '<p>Stale edit</p>', expectedNotes: '' })
    assert.equal(stale.status, 409)
    assert.equal(d.slides[0].razzle.rehearsal.takeIds.length, 2, 'failed summary stays retryable')

    events.length = 0
    await run('Discard this attempt', 0, 30)
    assert.equal((await api('/api/redo', 'POST', { slideId: 'b' })).status, 409)
    assert.equal((await api('/api/redo', 'POST', { slideId: 'a' })).status, 200)
    send({ t: 'asr', kind: 'segment-start', segId: 31, t0: Date.now() })
    send({ t: 'asr', kind: 'final', segId: 31, text: 'Fresh narration', t0: Date.now(), t1: Date.now() })
    await wait(() => events.some(e => e.final?.text === 'Fresh narration'))
    await api('/api/mode', 'POST', { mode: 'idle' })
    await wait(() => events.some(e => e.t === 'notes-status' && e.status === 'saved'))
    d = (await api('/api/decks/demo')).body
    assert.equal(d.slides[0].razzle.notes, '<p>Fresh narration</p>')
    assert.deepEqual(d.slides[0].razzle.script, ['Fresh narration', ''])

    // A late final is retained in its old take, but cannot control the new session.
    events.length = 0
    const oldLive = await api('/api/mode', 'POST', { mode: 'present', workflow: 'present', recording: true })
    send({ t: 'asr', kind: 'segment-start', segId: 40, t0: Date.now() })
    await wait(() => events.some(e => e.t === 'speech-start'))
    await api('/api/mode', 'POST', { mode: 'present', workflow: 'rehearse' })
    send({ t: 'asr', kind: 'final', segId: 40, text: 'Old session final', t0: Date.now(), t1: Date.now() })
    await wait(async () => (await api('/api/decks/demo/takes')).body.some((t: any) => t.id === oldLive.body.state.takeId && t.endedAt && t.utterances.some((u: any) => u.text === 'Old session final')))
    assert.equal(events.some(e => e.final?.text === 'Old session final'), false)
    await api('/api/mode', 'POST', { mode: 'idle' })
  } finally {
    ws?.terminate()
    child.kill('SIGTERM')
    if (child.exitCode === null) await once(child, 'exit')
    await rm(dir, { recursive: true, force: true })
  }
})
