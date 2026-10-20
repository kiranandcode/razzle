// The Razzle theme (palette + fonts) every editor instance registers (studio, screens, export).
// See docs/DESIGN.md "Studio" and shared/STYLE.md.
//
//   <Tldraw {...tldrawThemeProps} ... />      registers the colours/fonts with the store
//   applyRazzleDefaults(editor)                light mode + Razzle styles for new shapes
//
// Colour names (shape `color` / `labelColor` props):
//
//   black #000000  titles, labels in boxes        grey #595959       body text, connectors
//   blue #4285f4   second agent, blue notes       orange #ffab40     human
//   faded #cccccc  "not yet" text                 teal #4fafc3       agent
//   aqua #77c7d0   verified layer                 teal-ink #0097a7   teal numbers / notes
//   frame-blue #4a86e8  dashed group frame        bubble-blue #a8c7f9  right bubble, highlight
//   end-stage #aac8fa   pipeline end stage        bubble-teal #b8e2e6  left bubble
//   stage #bde4e8  pipeline stage                 panel #dcf0f2      result panel
//   neutral #eeeeee neutral box / layer           code #f3f3f3       code background
//   runtime #cd8484 runtime, where the bug was    bug #980000        bugs, failures
//   terracotta #dd7954 Basis conclusion box       cream #efe8db, cream-dark #e0d4c1  Basis boxes
//   edge #ababab   network edges                  paper #ffffff      white (in the picker)
//   white #ffffff  tldraw's built-in white (kept; tldraw hides it from the picker)
//
// Fills: `fill: 'fill'` paints the exact hex. `fill: 'solid'` paints the colour's light tint
// (`semi`): for the saturated colours that is the faded variant of the talks (teal → #d4ebf0,
// orange → #ffead1, runtime → the runtime bar #e4bebe); for the pastels it is the colour itself.
//
// Sizes (tldraw's bases, fontSize 16 and strokeWidth 2, which the PPTist converter in shared/tl
// also assumes): text s 18, m 24 (body 25), l 36 (slide title 35), xl 44 (title slide 46);
// strokes s 2 (the talks' outlines), m 3.5, l 5, xl 10.
import {
	DEFAULT_THEME,
	DefaultColorStyle,
	DefaultDashStyle,
	DefaultFillStyle,
	DefaultFontStyle,
	DefaultSizeStyle,
	Editor,
	TLDefaultColor,
	TLShape,
	TLTheme,
	TLThemeFont,
	TLThemes,
	TLUiAssetUrlOverrides,
	TLUiOverrides,
} from 'tldraw'
import { getAssetUrlsByImport } from '@tldraw/assets/imports.vite'
import { RAZZLE_ICONS } from './icons'

declare module 'tldraw' {
	interface TLThemeDefaultColors {
		faded: TLDefaultColor
		teal: TLDefaultColor
		aqua: TLDefaultColor
		'teal-ink': TLDefaultColor
		'frame-blue': TLDefaultColor
		'bubble-blue': TLDefaultColor
		'end-stage': TLDefaultColor
		'bubble-teal': TLDefaultColor
		stage: TLDefaultColor
		panel: TLDefaultColor
		neutral: TLDefaultColor
		code: TLDefaultColor
		runtime: TLDefaultColor
		bug: TLDefaultColor
		terracotta: TLDefaultColor
		cream: TLDefaultColor
		'cream-dark': TLDefaultColor
		edge: TLDefaultColor
		paper: TLDefaultColor
	}
	interface TLRemovedDefaultThemeColors {
		'light-violet': true
		violet: true
		'light-blue': true
		yellow: true
		green: true
		'light-green': true
		'light-red': true
		red: true
	}
}

/** [name, hex, light tint for `fill: 'solid'`, label]. Order = order in the style panel. */
const PALETTE: [string, string, string, string][] = [
	// tldraw lists its own colours first: black, grey, blue, orange
	['black', '#000000', '#e8e8e8', 'Black'],
	['grey', '#595959', '#eeeeee', 'Grey'],
	['blue', '#4285f4', '#dbe7fd', 'Blue (second agent)'],
	['orange', '#ffab40', '#ffead1', 'Orange (human)'],
	['faded', '#cccccc', '#f0f0f0', 'Faded (not yet)'],
	['teal', '#4fafc3', '#d4ebf0', 'Teal (agent)'],
	['aqua', '#77c7d0', '#dcf0f2', 'Aqua (verified)'],
	['teal-ink', '#0097a7', '#ccecef', 'Teal ink'],
	['frame-blue', '#4a86e8', '#dbe6fa', 'Frame blue'],
	['bubble-blue', '#a8c7f9', '#a8c7f9', 'Bubble blue'],
	['end-stage', '#aac8fa', '#aac8fa', 'End stage'],
	['bubble-teal', '#b8e2e6', '#b8e2e6', 'Bubble teal'],
	['stage', '#bde4e8', '#bde4e8', 'Stage'],
	['panel', '#dcf0f2', '#dcf0f2', 'Result panel'],
	['neutral', '#eeeeee', '#eeeeee', 'Neutral'],
	['code', '#f3f3f3', '#f3f3f3', 'Code'],
	['runtime', '#cd8484', '#e4bebe', 'Runtime'],
	['bug', '#980000', '#f2d6d6', 'Bug'],
	['terracotta', '#dd7954', '#f6d9cc', 'Terracotta'],
	['cream', '#efe8db', '#efe8db', 'Cream'],
	['cream-dark', '#e0d4c1', '#e0d4c1', 'Cream dark'],
	['edge', '#ababab', '#e3e5e8', 'Network edge'],
	['paper', '#ffffff', '#ffffff', 'White'],
	['white', '#ffffff', '#ffffff', 'White'],
]

/** Every Razzle colour name → its hex. */
export const RAZZLE_COLORS: Record<string, string> = Object.fromEntries(PALETTE.map(([n, hex]) => [n, hex]))

/** The colour name whose hex is nearest to `hex` (for converting PPTist colours). */
export function nearestRazzleColor(hex: string): string {
	const rgb = (h: string) => {
		const m = h.replace('#', '')
		const v = m.length === 3 ? m.split('').map((c) => c + c).join('') : m.slice(0, 6)
		return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16))
	}
	const [r, g, b] = rgb(hex)
	let best = 'black'
	let bestD = Infinity
	for (const [name, h] of PALETTE) {
		if (name === 'white') continue
		const [r2, g2, b2] = rgb(h)
		const d = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2
		if (d < bestD) {
			bestD = d
			best = name
		}
	}
	return best
}

function makeColor(solid: string, semi: string): TLDefaultColor {
	return {
		solid,
		semi,
		pattern: solid,
		fill: solid,
		linedFill: semi,
		frameHeadingStroke: solid,
		frameHeadingFill: semi,
		frameStroke: solid,
		frameFill: semi,
		frameText: solid,
		noteFill: semi,
		noteText: '#000000',
		highlightSrgb: semi,
		highlightP3: semi,
	}
}

const fontUrl = (file: string) => `${import.meta.env.BASE_URL}fonts/${file}`
const face = (family: string, file: string, weight: string, style = 'normal') => ({
	family,
	src: { url: fontUrl(file), format: 'woff2' },
	weight,
	style,
})

const serif: TLThemeFont = {
	fontFamily: "'Libre Baskerville', Georgia, serif",
	icon: 'font-serif',
	faces: [
		face('Libre Baskerville', 'LibreBaskerville-Regular.woff2', 'normal'),
		face('Libre Baskerville', 'LibreBaskerville-Bold.woff2', 'bold'),
		face('Libre Baskerville', 'LibreBaskerville-Italic.woff2', 'normal', 'italic'),
		face('Libre Baskerville', 'LibreBaskerville-BoldItalic.woff2', 'bold', 'italic'),
	],
}

const mono: TLThemeFont = {
	fontFamily: "'Roboto Mono', ui-monospace, monospace",
	icon: 'font-mono',
	faces: [face('Roboto Mono', 'RobotoMono-Regular.woff2', 'normal'), face('Roboto Mono', 'RobotoMono-Bold.woff2', 'bold')],
}

const sans: TLThemeFont = {
	fontFamily: "'Inter', system-ui, sans-serif",
	icon: 'font-sans',
	faces: [face('Inter', 'Inter-Regular.woff2', 'normal'), face('Inter', 'Inter-SemiBold.woff2', 'bold')],
}

function palette(base: TLTheme['colors']['light']): TLTheme['colors']['light'] {
	const colors: Record<string, unknown> = {}
	for (const [k, v] of Object.entries(base)) if (typeof v === 'string') colors[k] = v
	for (const [name, hex, tint] of PALETTE) colors[name] = makeColor(hex, tint)
	// Slides are white paper: frames are white with a quiet outline and a grey name.
	colors.black = {
		...(colors.black as TLDefaultColor),
		frameFill: '#ffffff',
		frameStroke: '#c9ccd1',
		frameHeadingFill: '#ffffff',
		frameHeadingStroke: '#c9ccd1',
		frameText: '#595959',
	}
	colors.text = '#000000'
	// Slide paper: frame exports and screens paint `solid` / `background` behind a slide.
	colors.solid = '#ffffff'
	colors.background = '#ffffff'
	return colors as TLTheme['colors']['light']
}

const lightColors = palette(DEFAULT_THEME.colors.light)

/** The Razzle theme, registered as tldraw's `default` theme. */
export const RAZZLE_THEME: TLTheme = {
	id: 'default',
	fontSize: 16,
	lineHeight: 1.35,
	strokeWidth: 2,
	fonts: { draw: DEFAULT_THEME.fonts.draw, sans, serif, mono },
	// Slides are always light; the dark palette is the same so a dark preference can't recolour them.
	colors: { light: lightColors, dark: lightColors },
}

export const razzleThemes: Partial<TLThemes> = { default: RAZZLE_THEME }

/** Names the style panel shows for the Razzle colours and fonts (pass in `overrides`). */
export const razzleThemeOverrides: TLUiOverrides = {
	translations: {
		en: {
			...Object.fromEntries(PALETTE.map(([n, , , label]) => [`color-style.${n}`, label])),
			'font-style.serif': 'Libre Baskerville',
			'font-style.sans': 'Inter',
			'font-style.mono': 'Roboto Mono',
			'font-style.draw': 'Hand-drawn',
		},
	},
}

const bundled = getAssetUrlsByImport()

/** tldraw's assets (icons, draw font, translations) bundled locally, plus the Razzle icons. */
export const razzleAssetUrls: TLUiAssetUrlOverrides = {
	...bundled,
	icons: { ...bundled.icons, ...RAZZLE_ICONS },
}

/**
 * Spread into every <Tldraw/> (studio, screens, export): the Razzle theme and locally bundled
 * assets (no CDN at a venue). A stable module-level object.
 */
export const tldrawThemeProps = { themes: razzleThemes, assetUrls: razzleAssetUrls } as const

/**
 * Razzle defaults on an editor: light mode, and new shapes in Libre Baskerville, solid, size m,
 * black (arrows and lines drawn with the default black start grey, the talks' connector colour).
 * Returns a disposer for the side effect it registers.
 */
const SNAP_DEFAULTED = 'razzle.snapDefaulted'

export function applyRazzleDefaults(editor: Editor): () => void {
	if (editor.user.getUserPreferences().colorScheme !== 'light') {
		editor.user.updateUserPreferences({ colorScheme: 'light' })
	}
	// Snap like Google Slides: while dragging or resizing, edges and centres align to other
	// shapes and to the slide's edges and centre, with guide lines (hold Ctrl to move freely).
	// Turned on once; after that the Preferences "Always snap" toggle is the user's.
	try {
		if (!localStorage.getItem(SNAP_DEFAULTED)) {
			editor.user.updateUserPreferences({ isSnapMode: true })
			localStorage.setItem(SNAP_DEFAULTED, '1')
		}
	} catch {
		editor.user.updateUserPreferences({ isSnapMode: true })
	}
	editor.run(
		() => {
			editor.setStyleForNextShapes(DefaultFontStyle, 'serif')
			editor.setStyleForNextShapes(DefaultDashStyle, 'solid')
			editor.setStyleForNextShapes(DefaultFillStyle, 'solid')
			editor.setStyleForNextShapes(DefaultSizeStyle, 'm')
			editor.setStyleForNextShapes(DefaultColorStyle, 'black')
		},
		{ history: 'ignore' }
	)
	// A slide (a frame at the root of the page) is never translucent: tldraw would otherwise give
	// a new frame the opacity last picked for new shapes, and every shape on the slide is
	// multiplied by its frame's opacity.
	const isSlide = (shape: TLShape) => shape.type === 'frame' && shape.parentId === editor.getCurrentPageId()
	const opaque = <T extends TLShape>(shape: T): T => (isSlide(shape) && shape.opacity !== 1 ? { ...shape, opacity: 1 } : shape)
	const translucent = editor.getCurrentPageShapes().filter((s) => isSlide(s) && s.opacity !== 1)
	if (translucent.length) {
		editor.run(() => editor.updateShapes(translucent.map((s) => ({ id: s.id, type: s.type, opacity: 1 }))), { history: 'ignore' })
	}
	const undoCreate = editor.sideEffects.registerBeforeCreateHandler('shape', (shape, source) => {
		shape = opaque(shape)
		if (source !== 'user') return shape
		if ((shape.type === 'arrow' || shape.type === 'line') && (shape.props as any).color === 'black') {
			const next = editor.getInstanceState().stylesForNextShape[DefaultColorStyle.id]
			if (next === undefined || next === 'black') {
				return { ...shape, props: { ...shape.props, color: 'grey' } } as typeof shape
			}
		}
		return shape
	})
	const undoChange = editor.sideEffects.registerBeforeChangeHandler('shape', (_prev, next) => opaque(next))
	return () => {
		undoCreate()
		undoChange()
	}
}
