// Syntax highlighting for `razzle-code`: Shiki core with the JavaScript regex engine (no
// WASM). The core and each grammar are separate chunks, loaded on first use and cached, so
// the studio's startup bundle carries none of them.
import { useEffect, useState } from 'react'
import type { CodeLanguage } from './razzleCodeSchema'

export interface CodeToken {
	text: string
	color: string
	italic: boolean
	bold: boolean
}
/** One array of tokens per line. */
export type CodeLines = CodeToken[][]

export const CODE_COLORS = {
	text: '#333333',
	keyword: '#4285f4',
	string: '#0097a7',
	number: '#b85c39',
	comment: '#999999',
	fn: '#000000',
	background: '#f3f3f3',
}

const C = CODE_COLORS

/** The Razzle light code theme (shared/STYLE.md palette). */
const RAZZLE_CODE_THEME = {
	name: 'razzle',
	type: 'light',
	colors: { 'editor.foreground': C.text, 'editor.background': C.background },
	settings: [
		{ settings: { foreground: C.text, background: C.background } },
		{ scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: C.comment, fontStyle: 'italic' } },
		{ scope: ['string', 'punctuation.definition.string', 'constant.character.escape'], settings: { foreground: C.string } },
		{
			scope: ['constant.numeric', 'constant.language', 'constant.character', 'constant.other', 'support.constant', 'variable.language.this', 'variable.language.self'],
			settings: { foreground: C.number },
		},
		{
			scope: ['keyword', 'storage', 'storage.type', 'storage.modifier', 'entity.name.type', 'entity.name.class', 'support.type', 'support.class', 'entity.other.inherited-class'],
			settings: { foreground: C.keyword },
		},
		{ scope: ['keyword.operator', 'punctuation', 'meta.brace'], settings: { foreground: C.text } },
		{ scope: ['keyword.operator.word', 'keyword.operator.logical.python', 'keyword.operator.new', 'keyword.operator.sizeof'], settings: { foreground: C.keyword } },
		{ scope: ['entity.name.function', 'support.function', 'meta.function-call.generic', 'entity.name.function.macro'], settings: { foreground: C.fn } },
		{ scope: ['support.type.property-name', 'variable.parameter'], settings: { foreground: C.text } },
		// The OCaml grammar borrows markup scopes; map its pieces back onto the palette.
		{ scope: ['source.ocaml string.regexp'], settings: { foreground: C.keyword } },
		{ scope: ['source.ocaml variable.parameter', 'source.ocaml comment constant.regexp'], settings: { foreground: C.text, fontStyle: '' } },
	],
}

type Loader = () => Promise<{ default: unknown }>

/** Shiki grammar per Razzle language (one chunk each). */
const GRAMMARS: Record<Exclude<CodeLanguage, 'text'>, { id: string; load: Loader }> = {
	c: { id: 'c', load: () => import('shiki/langs/c.mjs') },
	python: { id: 'python', load: () => import('shiki/langs/python.mjs') },
	lean: { id: 'lean4', load: () => import('shiki/langs/lean4.mjs') },
	ocaml: { id: 'ocaml', load: () => import('shiki/langs/ocaml.mjs') },
	js: { id: 'javascript', load: () => import('shiki/langs/javascript.mjs') },
	ts: { id: 'typescript', load: () => import('shiki/langs/typescript.mjs') },
	rust: { id: 'rust', load: () => import('shiki/langs/rust.mjs') },
	bash: { id: 'shellscript', load: () => import('shiki/langs/shellscript.mjs') },
	json: { id: 'json', load: () => import('shiki/langs/json.mjs') },
}

type Highlighter = Awaited<ReturnType<typeof import('shiki/core').createHighlighterCore>>

let highlighter: Promise<Highlighter> | null = null
let ready: Highlighter | null = null
const loading = new Map<string, Promise<void>>()
const loaded = new Set<string>()
const listeners = new Set<() => void>()

function getHighlighter(): Promise<Highlighter> {
	highlighter ??= (async () => {
		const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
			import('shiki/core'),
			import('shiki/engine/javascript'),
		])
		const h = await createHighlighterCore({
			themes: [RAZZLE_CODE_THEME as any],
			langs: [],
			engine: createJavaScriptRegexEngine({ forgiving: true }),
		})
		ready = h
		return h
	})()
	return highlighter
}

/** Load a language's grammar (and the highlighter). Resolves once it can highlight. */
export function loadLanguage(lang: CodeLanguage): Promise<void> {
	if (lang === 'text' || loaded.has(lang)) return Promise.resolve()
	let p = loading.get(lang)
	if (!p) {
		p = (async () => {
			const g = GRAMMARS[lang]
			const [h, mod] = await Promise.all([getHighlighter(), g.load()])
			await h.loadLanguage(mod.default as any)
			loaded.add(lang)
			for (const f of listeners) f()
		})()
		p.catch(() => loading.delete(lang))
		loading.set(lang, p)
	}
	return p
}

function plainLines(code: string): CodeLines {
	return code.split('\n').map((l) => (l ? [{ text: l, color: C.text, italic: false, bold: false }] : []))
}

const cache = new Map<string, CodeLines>()

/** Highlighted lines if the grammar is loaded, else null (start loading with `loadLanguage`). */
export function tokensNow(code: string, lang: CodeLanguage): CodeLines | null {
	if (lang === 'text') return plainLines(code)
	if (!ready || !loaded.has(lang)) return null
	const key = `${lang}\u0000${code}`
	let out = cache.get(key)
	if (!out) {
		try {
			const raw = ready.codeToTokensBase(code, { lang: GRAMMARS[lang].id, theme: 'razzle' })
			out = raw.map((line) =>
				line.map((t) => ({
					text: t.content,
					color: (t.color ?? C.text).toLowerCase(),
					italic: !!((t.fontStyle ?? 0) & 1),
					bold: !!((t.fontStyle ?? 0) & 2),
				}))
			)
		} catch {
			out = plainLines(code)
		}
		if (cache.size > 500) cache.clear()
		cache.set(key, out)
	}
	return out
}

/** Highlighted lines, loading the grammar first (plain lines if it fails to load). */
export async function tokens(code: string, lang: CodeLanguage): Promise<CodeLines> {
	try {
		await loadLanguage(lang)
	} catch {
		return plainLines(code)
	}
	return tokensNow(code, lang) ?? plainLines(code)
}

/** Lines to render now: highlighted once the grammar is in, plain text until then. */
export function useCodeTokens(code: string, lang: CodeLanguage): CodeLines {
	const [, bump] = useState(0)
	const now = tokensNow(code, lang)
	useEffect(() => {
		if (now) return
		let live = true
		const f = () => live && bump((n) => n + 1)
		listeners.add(f)
		loadLanguage(lang).then(f, () => {})
		return () => {
			live = false
			listeners.delete(f)
		}
	}, [lang, now === null])
	return now ?? plainLines(code)
}
