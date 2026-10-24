// Style-panel section for selected code blocks (`razzle-code`): language, font size and the
// code background. Also the "Code" toolbar action that puts a new block on the current slide.
import { Editor, StylePanelSection, StylePanelSubheading, useEditor, useValue } from 'tldraw'
import {
	CODE_LANGUAGES,
	CODE_LANGUAGE_NAMES,
	RAZZLE_CODE_TYPE,
	codeBoxSize,
	type CodeLanguage,
	type RazzleCodeShape,
} from '../shapes'
import { insertLibraryItem } from './library'
import { currentSlide } from './slideOps'

const SIZES = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 24, 28, 32]

function selectedCode(editor: Editor): RazzleCodeShape[] {
	return editor.getSelectedShapes().filter((s): s is RazzleCodeShape => s.type === RAZZLE_CODE_TYPE)
}

/** True while at least one code block is selected. */
export function useCodeSelected() {
	const editor = useEditor()
	return useValue('code selected', () => selectedCode(editor).length > 0, [editor])
}

export function CodeStylePanel() {
	const editor = useEditor()
	const shapes = useValue('selected code', () => selectedCode(editor), [editor])
	if (!shapes.length) return null
	const same = <T,>(f: (s: RazzleCodeShape) => T): T | '' => (shapes.every((s) => f(s) === f(shapes[0])) ? f(shapes[0]) : '')
	const language = same((s) => s.props.language)
	const size = same((s) => s.props.size)
	const background = shapes.every((s) => s.props.background)
	const update = (label: string, f: (s: RazzleCodeShape) => Partial<RazzleCodeShape['props']>) => {
		editor.markHistoryStoppingPoint(label)
		editor.updateShapes(shapes.map((s) => ({ id: s.id, type: RAZZLE_CODE_TYPE, props: f(s) })))
	}
	return (
		<StylePanelSection>
			<StylePanelSubheading>Code</StylePanelSubheading>
			<div className="rz-code-style" onKeyDown={(e) => e.stopPropagation()}>
				<label className="rz-code-style-row">
					<span>Language</span>
					<select
						className="rz-select"
						value={language}
						onChange={(e) => update('code language', () => ({ language: e.target.value as CodeLanguage }))}
					>
						{language === '' && <option value="">Mixed</option>}
						{CODE_LANGUAGES.map((l) => (
							<option key={l} value={l}>
								{CODE_LANGUAGE_NAMES[l]}
							</option>
						))}
					</select>
				</label>
				<label className="rz-code-style-row">
					<span>Size</span>
					<select
						className="rz-select"
						value={size === '' ? '' : String(size)}
						onChange={(e) => {
							const next = Number(e.target.value)
							if (!next) return
							// grow or shrink the box with the text
							update('code size', (s) => ({
								size: next,
								w: Math.max(1, Math.round((s.props.w * next) / s.props.size)),
								h: Math.max(1, Math.round((s.props.h * next) / s.props.size)),
							}))
						}}
					>
						{size === '' && <option value="">Mixed</option>}
						{[...new Set([...SIZES, ...(typeof size === 'number' ? [size] : [])])]
							.sort((a, b) => a - b)
							.map((n) => (
								<option key={n} value={n}>
									{n}px
								</option>
							))}
					</select>
				</label>
				<label className="rz-code-style-check">
					<input
						type="checkbox"
						checked={background}
						onChange={(e) => update('code background', () => ({ background: e.target.checked }))}
					/>
					<span>Grey background</span>
				</label>
				<button
					className="rz-code-fit"
					type="button"
					title="Resize the box to fit the code"
					onClick={() => update('fit code', (s) => codeBoxSize(s.props.code, s.props.size))}
				>
					Fit box to code
				</button>
			</div>
		</StylePanelSection>
	)
}

/** Put a new code block on the current slide (centred in the view) and select it. */
export function insertCodeBlock(editor: Editor) {
	const code = 'def invite(email, cc=[]):\n    cc.append("security@corp.com")\n    send(email, cc)'
	const props = { ...codeBoxSize(code, 15), code, language: 'python' as CodeLanguage, size: 15, background: true }
	insertLibraryItem(
		editor,
		{ id: 'code', name: 'Code', category: 'text', width: props.w, height: props.h, shapes: [{ id: 'code' as any, type: RAZZLE_CODE_TYPE, x: 0, y: 0, props }] },
		undefined,
		currentSlide(editor)?.id
	)
}
