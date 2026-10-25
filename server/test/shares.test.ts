import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { convertDeck } from '../../shared/tl/convert.ts'
import { audienceSnapshot } from '../../shared/tl/audience.ts'
import { schemaErrors } from './v2check.ts'
const demo = JSON.parse(await readFile(new URL('../../shared/tools/demo.pptist.json', import.meta.url), 'utf8'))

test('audience snapshot strips private content and retains builds and assets', () => {
  const deck = convertDeck(demo)
  const store = deck.document.store as Record<string, any>
  const frame = store[deck.slides[0].id]
  frame.meta.razzle = { notes: 'PRIVATE NOTES', script: ['PRIVATE SCRIPT'], cues: [{phrase:'PRIVATE CUE'}], buildSteps: 12 }
  const hidden = deck.slides.find(s => s.razzle.hidden)!
  store['shape:loose'] = { ...frame, id: 'shape:loose', type: 'text', meta: {}, props: { text: 'OFF SLIDE' } }
  store['shape:image'] = { id: 'shape:image', typeName: 'shape', parentId: frame.id, props: { assetId: 'asset:used' }, meta: { build: { step: 2, effect: 'appear' } } }
  store['asset:used'] = { id: 'asset:used', typeName: 'asset', meta: {} }
  store['asset:unused'] = { id: 'asset:unused', typeName: 'asset', meta: {} }
  store['binding:private'] = { id: 'binding:private', typeName: 'binding', fromId: frame.id, toId: hidden.id, meta: {} }
  const before = JSON.stringify(deck)
  const shared = audienceSnapshot(deck.document, deck.slides)
  assert.equal(JSON.stringify(deck), before)
  assert.ok(!shared.slides.some(s => s.id === hidden.id))
  const data = JSON.stringify(shared)
  for (const secret of ['PRIVATE NOTES', 'PRIVATE SCRIPT', 'PRIVATE CUE', 'OFF SLIDE']) assert.ok(!data.includes(secret), secret)
  assert.equal(shared.document.store[frame.id].meta.razzle.buildSteps, 12)
  assert.ok(shared.document.store['asset:used'])
  assert.ok(!shared.document.store['asset:unused'])
  assert.ok(!shared.document.store['binding:private'])
  assert.deepEqual(shared.document.store['shape:image'].meta.build, { step: 2, effect: 'appear' })
  for (const record of Object.values(shared.document.store)) assert.notEqual(record.parentId, hidden.id)
  const clean = convertDeck(demo)
  assert.deepEqual(schemaErrors({ ...clean, ...audienceSnapshot(clean.document, clean.slides) }), [])
})

test('public reads require a published token; publication and removal require auth', { timeout: 15000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'razzle-shares-'))
  const port = 18000 + Math.floor(Math.random() * 20000)
  const url = `http://127.0.0.1:${port}`
  await writeFile(path.join(dir, 'users'), '')
  const child = spawn(process.execPath, ['server.ts'], { cwd: path.resolve(import.meta.dirname, '..'), env: {
    ...process.env, RAZZLE_PORT: String(port), RAZZLE_DECKS_DIR: dir, RAZZLE_SHARES_DIR: path.join(dir, 'shares'),
    RAZZLE_AUDIO: 'browser', RAZZLE_NO_LAUNCH: '1', RAZZLE_QUIET: '1', RAZZLE_HTPASSWD: path.join(dir, 'users'),
    RAZZLE_SESSION_KEY_FILE: path.join(dir, 'key'), RAZZLE_INTERNAL_TOKEN: 'test-only-token',
  }, stdio: ['ignore', 'ignore', 'pipe'] })
  let logs = ''
  child.stderr.on('data', d => { logs += d })
  const api = (p: string, method = 'GET', data?: unknown, auth = false) => fetch(url + p, {
    method, headers: { 'content-type': 'application/json', ...(auth ? { authorization: 'Bearer test-only-token' } : {}) },
    body: data === undefined ? undefined : JSON.stringify(data),
  })
  try {
    let ready = false
    for (let i = 0; i < 150; i++) {
      try { ready = (await api('/api/state')).status === 401 } catch {}
      if (ready) break
      await new Promise(r => setTimeout(r, 30))
    }
    assert.ok(ready, logs)
    const deck = convertDeck(demo)
    assert.equal((await api('/api/shares', 'POST', deck)).status, 401)
    assert.equal((await api('/api/shares', 'POST', { deckId: deck.id }, true)).status, 400)
    await writeFile(path.join(dir, deck.id + '.json'), JSON.stringify(deck))
    const created = await api('/api/shares', 'POST', { deckId: deck.id }, true)
    assert.equal(created.status, 201)
    const meta = await created.json() as any
    assert.match(meta.id, /^[A-Za-z0-9_-]{24}$/)
    const route = `/api/shared/${meta.id}`
    const response = await api(route)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    const snapshot = await response.json() as any
    assert.equal(snapshot.title, deck.title)
    assert.ok(snapshot.slides.length < deck.slides.length)
    assert.ok(!snapshot.slides.some((s: any) => s.razzle.notes || s.razzle.script || s.razzle.hidden))
    assert.equal((await api(route, 'HEAD')).status, 200)
    for (const p of ['/api/shares?deck=' + deck.id, '/api/decks/' + deck.id, '/api/shared/']) assert.equal((await api(p)).status, 401)
    assert.equal((await api(route, 'PUT', deck)).status, 401)
    deck.title = 'Changed original'
    await writeFile(path.join(dir, deck.id + '.json'), JSON.stringify(deck))
    assert.equal((await (await api(route)).json() as any).title, 'Changed original')
    const oldId = 'a'.repeat(24)
    await mkdir(path.join(dir, 'shares', oldId))
    await writeFile(path.join(dir, 'shares', oldId, 'meta.json'), JSON.stringify({ ...meta, id: oldId }))
    await writeFile(path.join(dir, 'shares', oldId, 'deck.json'), JSON.stringify(snapshot))
    assert.equal((await (await api('/api/shared/' + oldId)).json() as any).title, 'Changed original')
    const first = deck.slides[0].id
    ;(deck.document.store[first] as any).meta.razzle = { hidden: true, notes: 'NEW PRIVATE NOTES' }
    await writeFile(path.join(dir, deck.id + '.json'), JSON.stringify(deck))
    const updated = await (await api(route)).json() as any
    assert.ok(!updated.document.store[first])
    assert.ok(!JSON.stringify(updated).includes('NEW PRIVATE NOTES'))
    assert.equal(updated.slides.length, snapshot.slides.length - 1)
    const listing = await (await api('/api/shares?deck=' + deck.id, 'GET', undefined, true)).json() as any[]
    assert.ok(listing.some(s => s.id === meta.id))
    assert.equal((await api('/api/shares/' + meta.id, 'DELETE')).status, 401)
    assert.equal((await api('/api/shares/' + meta.id, 'DELETE', undefined, true)).status, 200)
    assert.equal((await api(route)).status, 404)
    await rm(path.join(dir, deck.id + '.json'))
    assert.equal((await api('/api/shared/' + oldId)).status, 404, 'deleted deck never falls back to frozen content')
    const allHidden = convertDeck(demo)
    for (const s of allHidden.slides) (allHidden.document.store[s.id] as any).meta.razzle = { hidden: true }
    await writeFile(path.join(dir, allHidden.id + '.json'), JSON.stringify(allHidden))
    assert.equal((await api('/api/shares', 'POST', allHidden, true)).status, 400)
    assert.equal((await api('/api/shared/' + oldId)).status, 404, 'all-hidden deck never falls back to frozen content')
  } finally {
    const exited = once(child, 'exit')
    child.kill('SIGTERM')
    await exited
    await rm(dir, { recursive: true, force: true })
  }
})
