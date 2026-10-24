import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { WebSocketServer, type WebSocket } from 'ws'
import { initialState } from '../state.ts'

test('rehearsed advances require completion, respect cadence, and cancel when speech resumes', { timeout: 20000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'razzle-director-workflow-'))
  const runner = path.join(dir, 'judge')
  await writeFile(runner, `#!${process.execPath}
if (process.argv.includes('--version')) process.exit(0)
let input = ''
for await (const chunk of process.stdin) input += chunk
const context = JSON.parse(input)
console.log(JSON.stringify({structured_output:{covered:context.latest.includes('finished'),intent:'continue',confidence:1,highlight:null,hiddenPrompt:null}}))
`, { mode: 0o700 })
  const deck = { id: 'd', slides: [{ id: 'a', stepCount: 1, razzle: {
    script: ['The point'], delivery: { 0: { script: 'The point', steps: 1, examples: [{ text: 'The point is finished', ending: 'finished', pauseMs: 900, takeId: 'r' }] } },
  } }, { id: 'b' }] }
  const advances: number[] = []
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    if (req.url?.startsWith('/api/decks')) res.end(JSON.stringify(deck))
    else { advances.push(Date.now()); res.end(JSON.stringify({ accepted: true })) }
  })
  const wss = new WebSocketServer({ server })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = (server.address() as { port: number }).port
  let socket: WebSocket | undefined
  let logs = ''
  const connected = once(wss, 'connection').then(([s]) => { socket = s })
  const child = spawn(process.execPath, ['director.ts', '--url', `http://127.0.0.1:${port}`], {
    cwd: path.resolve(import.meta.dirname, '..'), env: { ...process.env, TYPESAFE_API_KEY: '', JEV_API_KEY: '', RAZZLE_LLM: 'cli', RAZZLE_CLAUDE_BIN: runner }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', d => { logs += d })
  child.stderr.on('data', d => { logs += d })
  const send = (message: object) => socket!.send(JSON.stringify(message))
  const wait = async (condition: () => boolean) => {
    const end = Date.now() + 5000
    while (!condition()) {
      if (Date.now() > end) throw new Error('Timed out: ' + logs)
      await new Promise(r => setTimeout(r, 20))
    }
  }
  const state = { ...initialState(), deckId: 'd', mode: 'present' as const, workflow: 'present' as const, auto: true }
  const speech = (segId: number, text: string, t1 = Date.now()) => {
    send({ t: 'speech-start', segId })
    send({ t: 'transcript', segId, final: { slideIndex: 0, step: 0, text, t0: t1 - 500, t1 } })
  }
  try {
    await connected
    send({ t: 'state', state })
    await wait(() => logs.includes('2 slides'))
    speech(1, 'The point, um I am thinking')
    await new Promise(r => setTimeout(r, 1100))
    assert.equal(advances.length, 0, 'topic coverage and a pause are insufficient')
    speech(2, 'The point is finished')
    await wait(() => logs.includes('covered'))
    send({ t: 'speech-start', segId: 3 })
    await new Promise(r => setTimeout(r, 1100))
    assert.equal(advances.length, 0, 'new speech cancels a pending advance')
    logs = ''
    send({ t: 'speech-start', segId: 4 })
    send({ t: 'transcript', segId: 4, pause: { slideIndex: 0, step: 0, text: 'finished', t1: Date.now() } })
    await wait(() => logs.includes('covered'))
    send({ t: 'transcript', segId: 4, final: { slideIndex: 0, step: 0, text: 'Actually still thinking', t0: Date.now() - 500, t1: Date.now() } })
    await new Promise(r => setTimeout(r, 1100))
    assert.equal(advances.length, 0, 'a corrected final cancels the pause judgement')
    const ended = Date.now()
    speech(5, 'Now finished', ended)
    await wait(() => advances.length === 1)
    assert.ok(advances[0] - ended >= 850, 'waits for the demonstrated cadence')
    send({ t: 'state', state: { ...state, workflow: 'rehearse', auto: false } })
    speech(6, 'The point is finished')
    await new Promise(r => setTimeout(r, 1100))
    assert.equal(advances.length, 1, 'rehearsal stays manual')
  } finally {
    child.kill('SIGTERM')
    if (child.exitCode === null) await once(child, 'exit')
    socket?.terminate()
    wss.close()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await rm(dir, { recursive: true, force: true })
  }
})
