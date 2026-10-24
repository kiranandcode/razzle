// `razzle-code`: a syntax-highlighted code block. Roboto Mono, Razzle code colours
// (codeHighlight.ts), no wrapping (overflow clipped), optional #f3f3f3 background.
// Double-click edits the source in a monospace textarea (Tab inserts two spaces; Escape or a
// click away ends editing; the whole edit is one undo step). The canvas shows plain text until
// the language's grammar has loaded; exports wait for it and draw the tokens as SVG text.
import { useEffect, useRef } from 'react'
import {
	HTMLContainer,
	Rectangle2d,
	ShapeUtil,
	getPointerInfo,
	resizeBox,
	useValue,
	type SafeId,
	type SvgExportContext,
	type TLFontFace,
	type TLResizeInfo,
} from 'tldraw'
import { CODE_COLORS, tokens, useCodeTokens, type CodeLines } from './codeHighlight'
import {
	CODE_LINE_HEIGHT,
	RAZZLE_CODE_TYPE,
	codePadding,
	defaultRazzleCodeProps,
	razzleCodeProps,
	type RazzleCodeShape,
} from './razzleCodeSchema'

const MONO = "'Roboto Mono', ui-monospace, monospace"
/** Roboto Mono's ascent and descent (em): puts SVG baselines where CSS lines put them. */
const ASCENT = 1.048
const DESCENT = 0.271

function monoFamily(util: ShapeUtil<RazzleCodeShape>) {
	return (util.editor.getCurrentTheme().fonts as any)?.mono?.fontFamily ?? MONO
}

export class RazzleCodeShapeUtil extends ShapeUtil<RazzleCodeShape> {
	static override type = RAZZLE_CODE_TYPE
	static override props = razzleCodeProps

	override getDefaultProps(): RazzleCodeShape['props'] {
		return defaultRazzleCodeProps()
	}

	override canEdit() {
		return true
	}
	override canResize() {
		return true
	}
	override isAspectRatioLocked() {
		return false
	}

	override getGeometry(shape: RazzleCodeShape) {
		return new Rectangle2d({ width: Math.max(1, shape.props.w), height: Math.max(1, shape.props.h), isFilled: true })
	}

	override getText(shape: RazzleCodeShape) {
		return shape.props.code
	}

	override getFontFaces(): TLFontFace[] {
		const f = (this.editor.getCurrentTheme().fonts as any)?.mono as { faces?: TLFontFace[] } | undefined
		return f?.faces ?? []
	}

	override onResize(shape: RazzleCodeShape, info: TLResizeInfo<RazzleCodeShape>) {
		return resizeBox(shape, info)
	}

	component(shape: RazzleCodeShape) {
		const editor = this.editor
		const isEditing = useValue('razzle-code editing', () => editor.getEditingShapeId() === shape.id, [editor, shape.id])
		const p = shape.props
		const pad = codePadding(p.size)
		const box = {
			width: p.w,
			height: p.h,
			overflow: 'hidden',
			boxSizing: 'border-box' as const,
			padding: `${pad.y}px ${pad.x}px`,
			background: p.background ? CODE_COLORS.background : 'transparent',
			fontFamily: monoFamily(this),
			fontSize: p.size,
			lineHeight: CODE_LINE_HEIGHT,
			color: CODE_COLORS.text,
			whiteSpace: 'pre' as const,
			textAlign: 'left' as const,
		}
		return (
			<HTMLContainer style={{ width: p.w, height: p.h, pointerEvents: isEditing ? 'all' : undefined }}>
				{isEditing ? <CodeEditor shape={shape} util={this} style={box} /> : <CodeView shape={shape} style={box} />}
			</HTMLContainer>
		)
	}

	override getIndicatorPath(shape: RazzleCodeShape) {
		const p = new Path2D()
		p.rect(0, 0, shape.props.w, shape.props.h)
		return p
	}

	override async toSvg(shape: RazzleCodeShape, ctx: SvgExportContext) {
		const p = shape.props
		const lines = await tokens(p.code, p.language)
		const pad = codePadding(p.size)
		const lh = p.size * CODE_LINE_HEIGHT
		// baseline inside a CSS line box: half-leading + ascent
		const base = (lh - (ASCENT + DESCENT) * p.size) / 2 + ASCENT * p.size
		const clip = `rzcode-${shape.id.replace(/[^A-Za-z0-9_-]/g, '_')}` as SafeId
		ctx.addExportDef({
			key: clip,
			getElement: () => (
				<clipPath id={clip}>
					<rect width={p.w} height={p.h} />
				</clipPath>
			),
		})
		const family = monoFamily(this)
		return (
			<g clipPath={`url(#${clip})`}>
				{p.background && <rect width={p.w} height={p.h} fill={CODE_COLORS.background} />}
				{lines.map((line, i) =>
					line.length ? (
						<text
							key={i}
							x={pad.x}
							y={pad.y + i * lh + base}
							fontFamily={family}
							fontSize={p.size}
							fill={CODE_COLORS.text}
							xmlSpace="preserve"
							style={{ whiteSpace: 'pre' }}
						>
							{line.map((t, j) => (
								<tspan
									key={j}
									fill={t.color}
									fontStyle={t.italic ? 'italic' : undefined}
									fontWeight={t.bold ? 'bold' : undefined}
								>
									{t.text}
								</tspan>
							))}
						</text>
					) : null
				)}
			</g>
		)
	}
}

function CodeView({ shape, style }: { shape: RazzleCodeShape; style: React.CSSProperties }) {
	const lines = useCodeTokens(shape.props.code, shape.props.language)
	return <div style={style}>{renderLines(lines)}</div>
}

function renderLines(lines: CodeLines) {
	return lines.map((line, i) => (
		<div key={i} style={{ minHeight: `${CODE_LINE_HEIGHT}em` }}>
			{line.length
				? line.map((t, j) => (
						<span
							key={j}
							style={{
								color: t.color,
								fontStyle: t.italic ? 'italic' : undefined,
								fontWeight: t.bold ? 'bold' : undefined,
							}}
						>
							{t.text}
						</span>
					))
				: '​'}
		</div>
	))
}

function CodeEditor({
	shape,
	util,
	style,
}: {
	shape: RazzleCodeShape
	util: RazzleCodeShapeUtil
	style: React.CSSProperties
}) {
	const editor = util.editor
	const ref = useRef<HTMLTextAreaElement>(null)
	useEffect(() => {
		const el = ref.current
		if (!el) return
		el.focus()
		el.setSelectionRange(el.value.length, el.value.length)
		el.scrollTop = 0
		el.scrollLeft = 0
	}, [])
	// Each keystroke updates the shape (growing it to fit new lines; lines never wrap, long ones
	// are clipped); entering the edit marked a history stopping point, so undo reverts the whole
	// edit at once.
	const set = (code: string) => {
		const cur = editor.getShape<RazzleCodeShape>(shape.id)
		if (!cur || editor.getEditingShapeId() !== shape.id) return
		const need = Math.ceil(code.split('\n').length * cur.props.size * CODE_LINE_HEIGHT + 2 * codePadding(cur.props.size).y)
		editor.updateShape({ id: shape.id, type: RAZZLE_CODE_TYPE, props: { code, ...(need > cur.props.h ? { h: need } : {}) } })
	}
	return (
		<textarea
			ref={ref}
			className="rz-code-input"
			defaultValue={shape.props.code}
			wrap="off"
			spellCheck={false}
			autoComplete="off"
			autoCapitalize="off"
			autoCorrect="off"
			style={{ ...style, display: 'block', border: 'none', outline: 'none', resize: 'none', margin: 0, overflow: 'hidden' }}
			onChange={(e) => set(e.target.value)}
			onKeyDown={(e) => {
				if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey) {
					e.preventDefault()
					e.stopPropagation()
					const el = e.currentTarget
					el.setRangeText('  ', el.selectionStart, el.selectionEnd, 'end')
					set(el.value)
				} else if (e.key === 'Escape') {
					e.preventDefault()
					e.stopPropagation()
					editor.complete()
					editor.setEditingShape(null)
					editor.getContainer().focus()
				} else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
					editor.complete()
				}
			}}
			onPointerDown={(e) => {
				editor.dispatch({ ...getPointerInfo(editor, e), type: 'pointer', name: 'pointer_down', target: 'shape', shape })
				e.stopPropagation()
			}}
			onDoubleClick={editor.markEventAsHandled}
			onContextMenu={(e) => e.stopPropagation()}
			onWheel={(e) => e.stopPropagation()}
		/>
	)
}
