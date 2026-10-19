#!/usr/bin/env node
// Open pages of a running Razzle server in headless Chrome, report console errors and
// exceptions, and screenshot them: a load check of decks in the real studio and screens.
//   node shared/tl/dev/parity/page.mjs --out <dir> [--size 1400x900] [--wait 6000] <url> [<url> ...]
// Exits 1 if any page logs an error or throws.
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../../../..')
const WebSocket = createRequire(path.join(repo, 'server/package.json'))('ws')
const args = process.argv.slice(2)
const opt = (k, d) => { const i = args.indexOf(k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v }
const out = path.resolve(opt('--out', path.join(repo, 'server/.tmp/pages')))
const [W, H] = opt('--size', '1400x900').split('x').map(Number)
const wait = Number(opt('--wait', '6000'))
const CPORT = Number(opt('--cdp', '9555'))
const urls = args
mkdirSync(out, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const profile = path.join(out, '.chrome')
rmSync(profile, { recursive: true, force: true })
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${CPORT}`, `--user-data-dir=${profile}`, '--hide-scrollbars', '--no-first-run', 'about:blank'], { stdio: 'ignore' })
process.on('exit', () => chrome.kill('SIGTERM'))
let bad = 0
try {
	for (let i = 0; i < 100; i++) { try { await fetch(`http://127.0.0.1:${CPORT}/json/version`); break } catch { await sleep(100) } }
	for (const [k, url] of urls.entries()) {
		const t = await (await fetch(`http://127.0.0.1:${CPORT}/json/new?about:blank`, { method: 'PUT' })).json()
		const ws = new WebSocket(t.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 })
		await new Promise((r) => ws.once('open', r))
		let id = 0
		const pending = new Map(), errors = []
		ws.on('message', (d) => {
			const m = JSON.parse(d)
			if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m); pending.delete(m.id) }
			if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'assert')) errors.push('console: ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300))
			if (m.method === 'Runtime.exceptionThrown') errors.push('exception: ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 300))
			if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push('log: ' + m.params.entry.text.slice(0, 300) + ' ' + (m.params.entry.url ?? ''))
		})
		const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })) })
		await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false })
		await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable')
		await send('Page.navigate', { url })
		await sleep(wait)
		const shot = await send('Page.captureScreenshot', { format: 'png' })
		const file = path.join(out, `page-${k}.png`)
		writeFileSync(file, Buffer.from(shot.data, 'base64'))
		console.log(`${errors.length ? 'FAIL' : 'ok  '} ${url} → ${file}`)
		for (const e of errors) console.log('    ', e)
		bad += errors.length
		ws.close()
	}
} finally { chrome.kill('SIGTERM') }
process.exit(bad ? 1 : 0)
