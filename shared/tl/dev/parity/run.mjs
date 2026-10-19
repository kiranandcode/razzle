#!/usr/bin/env node
// Load a converted deck into the real tldraw fork in headless Chrome and check it, and
// optionally render every slide/step next to the PPTist original for a visual parity check.
//
//   node shared/tl/dev/parity/run.mjs --deck decks/demo.json [--ppt shared/tools/demo.pptist.json] --out <dir> [--steps] [--utils default]
//   (--only 2,3 limits the slides; --eval <expr> --slide i --step s prints a value from the page)
//   node shared/tl/dev/parity/run.mjs --library shared/library.tldraw.json --out <dir>
//
// Writes <out>/tl-<slide>-<step>.png (the tldraw canvas, camera fitted to the frame),
// with --ppt also <out>/ppt-<slide>-<step>.png (shared/tools/render_preview.mjs) and
// <out>/cmp-<slide>-<step>.png (PPTist left, tldraw right). Exits 1 when the document
// fails to load or the page logs errors. Needs Google Chrome; uses `ws` from server/.
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../../../..')
const require = createRequire(path.join(repo, 'server/package.json'))
const WebSocket = require('ws')

const args = process.argv.slice(2)
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined }
const flag = (k) => args.includes(k)
const out = path.resolve(opt('--out') ?? path.join(repo, 'server/.tmp/parity'))
const deck = opt('--deck') && path.resolve(opt('--deck'))
const library = opt('--library') && path.resolve(opt('--library'))
const ppt = opt('--ppt') && path.resolve(opt('--ppt'))
const VPORT = Number(opt('--port') ?? 5191), CPORT = Number(opt('--cdp') ?? 9341)
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
mkdirSync(out, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const procs = []
function stopAll() { for (const p of procs) { try { p.kill('SIGTERM') } catch {} } }
process.on('exit', stopAll)
process.on('SIGINT', () => { stopAll(); process.exit(130) })

async function waitHttp(url, ms = 30000) {
	const t = Date.now()
	while (Date.now() - t < ms) { try { const r = await fetch(url); if (r.ok) return r } catch {} await sleep(150) }
	throw new Error(`timeout waiting for ${url}`)
}

class Cdp {
	constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result) } }) }
	send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((res, rej) => this.pending.set(id, { res, rej })) }
	async eval(expr) {
		const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
		if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
		return r.result.value
	}
	async shot(file, clip) {
		const r = await this.send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 }, captureBeyondViewport: true })
		writeFileSync(file, Buffer.from(r.data, 'base64'))
	}
}

async function openPage(url, w, h) {
	const t = await (await fetch(`http://127.0.0.1:${CPORT}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' })).json()
	const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 512 * 1024 * 1024 })
	await new Promise((r, j) => { ws.once('open', r); ws.once('error', j) })
	const c = new Cdp(ws)
	await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
	await c.send('Page.enable')
	await c.send('Runtime.enable')
	await c.send('Page.navigate', { url })
	return c
}

// PPTist | tldraw | difference (red where any channel differs by more than 48)
const CMP_HTML = (a, b) => `<body style="margin:0;background:#888;display:flex;gap:8px">
<img id="a" src="${a}" width="1000"><img id="b" src="${b}" width="1000"><canvas id="c" width="1000" height="562"></canvas>
<script>
Promise.all([...document.images].map(i => i.decode())).then(() => {
	const get = (img) => { const c = document.createElement('canvas'); c.width = 1000; c.height = 562; const x = c.getContext('2d'); x.drawImage(img, 0, 0, 1000, 562); return x.getImageData(0, 0, 1000, 562).data }
	const A = get(document.getElementById('a')), B = get(document.getElementById('b'))
	const c = document.getElementById('c').getContext('2d'), out = c.createImageData(1000, 562)
	let n = 0
	for (let i = 0; i < A.length; i += 4) {
		const d = Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2]))
		const g = 255 - (255 - (A[i] + A[i + 1] + A[i + 2]) / 3) * 0.25
		if (d > 48) { n++; out.data.set([220, 30, 30, 255], i) } else out.data.set([g, g, g, 255], i)
	}
	c.putImageData(out, 0, 0)
	window.__diff = { frac: n / (A.length / 4) }
})
</script></body>`

async function main() {
	const vite = spawn(path.join(repo, 'tldraw/apps/razzle/node_modules/.bin/vite'), ['--config', path.join(here, 'vite.config.mjs'), '--port', String(VPORT)], { stdio: ['ignore', 'pipe', 'pipe'], cwd: here })
	procs.push(vite)
	vite.stderr.on('data', (d) => process.stderr.write('vite| ' + d))
	const profile = path.join(out, '.chrome')
	rmSync(profile, { recursive: true, force: true })
	const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CPORT}`, `--user-data-dir=${profile}`, '--hide-scrollbars', '--disable-gpu', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' })
	procs.push(chrome)
	await waitHttp(`http://127.0.0.1:${VPORT}/index.html`, 60000)
	await waitHttp(`http://127.0.0.1:${CPORT}/json/version`)

	const target = deck ? `deck=${encodeURIComponent('/@fs' + deck)}` : `library=${encodeURIComponent('/@fs' + library)}`
	const url = `http://127.0.0.1:${VPORT}/index.html?${target}${opt('--utils') ? `&utils=${opt('--utils')}` : ''}`
	const W = 1000, H = library ? 1400 : 563
	const page = await openPage(url, library ? 1800 : W, H)
	const t0 = Date.now()
	while (!(await page.eval('!!window.__ready').catch(() => false))) { if (Date.now() - t0 > 60000) throw new Error('page did not become ready'); await sleep(200) }
	await page.eval('document.fonts.ready.then(() => true)')
	console.log('theme:', await page.eval('window.__themeSource'))
	let failed = false
	const report = (errs) => {
		const real = errs.filter((e) => !/Download the React DevTools/.test(e))
		if (real.length) { failed = true; console.log('page errors:'); for (const e of real.slice(0, 30)) console.log('  ', e) }
		else console.log('loaded without errors')
	}
	if (library) {
		await page.eval('window.__fitAll()')
		await sleep(500)
		await page.shot(path.join(out, 'library.png'), { x: 0, y: 0, width: 1800, height: H })
		report(await page.eval('window.__errors'))
		console.log('wrote', path.join(out, 'library.png'))
		return failed
	}
	if (opt('--eval')) {
		// debugging: show one slide and print an expression's value
		await page.eval(`window.__show(${Number(opt('--slide') ?? 0)}, ${Number(opt('--step') ?? 0)})`)
		console.log(JSON.stringify(await page.eval(opt('--eval')), null, 1))
		return false
	}
	const v2 = JSON.parse(readFileSync(deck, 'utf8'))
	const slides = await page.eval('window.__slides()')
	console.log(`${slides.length} slides:`, slides.map((s) => s.name).join(' | '))
	const shots = []
	for (let i = 0; i < slides.length; i++) {
		if (opt('--only') !== undefined && !opt('--only').split(',').map(Number).includes(i)) continue
		const n = v2.slides[i]?.stepCount ?? 1
		const steps = flag('--steps') ? [...Array(n).keys()] : [n - 1]
		for (const s of steps) {
			await page.eval(`window.__show(${i}, ${s})`)
			await sleep(120)
			const f = path.join(out, `tl-${i}-${s}.png`)
			await page.shot(f, { x: 0, y: 0, width: 1000, height: 562.5 })
			shots.push({ i, s, f })
		}
	}
	report(await page.eval('window.__errors'))
	console.log(`wrote ${shots.length} tldraw renders to ${out}`)

	if (ppt) {
		// PPTist reference renders: render_preview's HTML, one .slide element per (slide, step)
		const html = path.join(out, 'ppt.html')
		await new Promise((res, rej) => spawn(process.execPath, [path.join(repo, 'shared/tools/render_preview.mjs'), ppt, html, '--steps'], { stdio: 'ignore' }).on('exit', (c) => (c ? rej(new Error('render_preview failed')) : res())))
		// serve it over http with the local font files (file:// pages cannot load file:// fonts),
		// so both sides use the same Libre Baskerville / Roboto Mono / Inter as the studio
		let page0 = readFileSync(html, 'utf8')
		page0 = page0.replace(/@import url\('https:\/\/fonts.googleapis[^)]*\);/, '').replace(pathToFileURL(path.join(repo, 'shared/fonts/fonts.css')).href, '/@fs' + path.join(repo, 'shared/fonts/fonts.css'))
		// PPTist's text boxes are border-box (editor/src/assets/styles/global.scss); render_preview's are not
		// 3D flips render unreliably in headless screenshots of a tall page; 2D mirrors are identical
		page0 = page0.replaceAll('rotateY(180deg)', 'scaleX(-1)').replaceAll('rotateX(180deg)', 'scaleY(-1)')
		page0 = page0.replace('</style>', '.text-content { box-sizing: border-box; }</style>')
		writeFileSync(html, page0)
		const pp = await openPage(`http://127.0.0.1:${VPORT}/@fs${html}`, 1040, 800)
		await sleep(1500)
		await pp.eval('document.fonts.ready.then(() => true)')
		const diffs = []
		const pptSlides = JSON.parse(readFileSync(ppt, 'utf8')).slides
		// render_preview lists slides in deck order; the v2 deck orders visible then hidden
		const order = [...pptSlides.map((s, k) => ({ s, k })).filter((x) => !x.s.razzle?.hidden), ...pptSlides.map((s, k) => ({ s, k })).filter((x) => x.s.razzle?.hidden)]
		const rects = await pp.eval(`[...document.querySelectorAll('.slide')].map(e => { const r = e.getBoundingClientRect(); return { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height } })`)
		const labels = await pp.eval(`[...document.querySelectorAll('.label')].map(e => e.textContent)`)
		const byKey = new Map()
		labels.forEach((l, j) => { const m = /slide (\d+) · step (\d+)/.exec(l); if (m) byKey.set(`${+m[1] - 1}-${m[2]}`, rects[j]) })
		for (const { i, s, f } of shots) {
			const k = order[i]?.k
			const r = byKey.get(`${k}-${s}`)
			if (!r) continue
			const pf = path.join(out, `ppt-${i}-${s}.png`)
			await pp.shot(pf, { x: r.x, y: r.y, width: r.w, height: r.h })
			const cmp = path.join(out, `cmp-${i}-${s}.html`)
			writeFileSync(cmp, CMP_HTML('/@fs' + pf, '/@fs' + f))
			const cp = await openPage(`http://127.0.0.1:${VPORT}/@fs${cmp}`, 3016, 563)
			let d = null
			for (let k = 0; k < 50 && !d; k++) { await sleep(100); d = await cp.eval('window.__diff') }
			await cp.shot(path.join(out, `cmp-${i}-${s}.png`), { x: 0, y: 0, width: 3016, height: 562.5 })
			cp.ws.close()
			diffs.push({ slide: i, step: s, ...d })
		}
		console.log('wrote PPTist renders and cmp-*.png (PPTist | tldraw | difference in red)')
		console.log('pixels differing (> 48/255 in any channel), per slide-step:')
		for (const d of diffs) console.log(`  ${d.slide}-${d.step}  ${(d.frac * 100).toFixed(2)}%`)
		writeFileSync(path.join(out, 'diff.json'), JSON.stringify(diffs, null, 1))
	}
	return failed
}

main().then((failed) => { stopAll(); process.exit(failed ? 1 : 0) }, (e) => { console.error(e); stopAll(); process.exit(1) })
