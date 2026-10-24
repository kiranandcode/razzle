// Record shape of `razzle-code`: a syntax-highlighted code block (Roboto Mono, no wrapping,
// clipped to its box). Kept apart from the util so headless tools can validate records
// without React or the highlighter.
import { T, type RecordProps, type TLShape } from 'tldraw'

export const RAZZLE_CODE_TYPE = 'razzle-code'

export const CODE_LANGUAGES = ['c', 'python', 'lean', 'ocaml', 'js', 'ts', 'rust', 'bash', 'json', 'text'] as const
export type CodeLanguage = (typeof CODE_LANGUAGES)[number]

export const CODE_LANGUAGE_NAMES: Record<CodeLanguage, string> = {
	c: 'C',
	python: 'Python',
	lean: 'Lean',
	ocaml: 'OCaml',
	js: 'JavaScript',
	ts: 'TypeScript',
	rust: 'Rust',
	bash: 'Bash',
	json: 'JSON',
	text: 'Plain text',
}

export interface RazzleCodeProps {
	w: number
	h: number
	/** The source text ('\n' between lines). */
	code: string
	language: CodeLanguage
	/** Font size in canvas px. */
	size: number
	/** Paint the #f3f3f3 code background. */
	background: boolean
}

declare module 'tldraw' {
	export interface TLGlobalShapePropsMap {
		[RAZZLE_CODE_TYPE]: RazzleCodeProps
	}
}

export type RazzleCodeShape = TLShape<typeof RAZZLE_CODE_TYPE>

export const razzleCodeProps: RecordProps<RazzleCodeShape> = {
	w: T.positiveNumber,
	h: T.positiveNumber,
	code: T.string,
	language: T.literalEnum(...CODE_LANGUAGES),
	size: T.positiveNumber,
	background: T.boolean,
}

/** Line height (multiple of the font size) and padding, shared by the shape, kit.mjs and the converter. */
export const CODE_LINE_HEIGHT = 1.6
export const codePadding = (size: number) => ({ x: Math.round((size * 16) / 15), y: Math.round((size * 12) / 15) })

/** The box that fits `code` at `size` without clipping (Roboto Mono advance ≈ 0.6 em). */
export function codeBoxSize(code: string, size: number): { w: number; h: number } {
	const lines = code.split('\n')
	const pad = codePadding(size)
	const cols = Math.max(1, ...lines.map((l) => [...l].length))
	return { w: Math.ceil(cols * size * 0.6 + 2 * pad.x), h: Math.ceil(lines.length * size * CODE_LINE_HEIGHT + 2 * pad.y) }
}

export function defaultRazzleCodeProps(): RazzleCodeProps {
	const code = 'def invite(email, cc=[]):\n    cc.append("security@corp.com")\n    send(email, cc)'
	return { ...codeBoxSize(code, 15), code, language: 'python', size: 15, background: true }
}
