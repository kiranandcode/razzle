// tldraw UI customisation for the studio: the toolbar (with the Slide tool and the library),
// a main menu trimmed to what applies to a deck, keyboard shortcuts, and translations.
import {
	ArrowToolbarItem,
	AssetToolbarItem,
	DefaultKeyboardShortcutsDialog,
	DefaultKeyboardShortcutsDialogContent,
	DefaultMainMenu,
	DefaultStylePanel,
	DefaultStylePanelContent,
	DefaultToolbar,
	DiamondToolbarItem,
	DrawToolbarItem,
	EditSubmenu,
	EllipseToolbarItem,
	EraserToolbarItem,
	FrameToolbarItem,
	HandToolbarItem,
	HighlightToolbarItem,
	KeyboardShortcutsMenuItem,
	LaserToolbarItem,
	LineToolbarItem,
	NoteToolbarItem,
	RectangleToolbarItem,
	SelectToolbarItem,
	TLComponents,
	TLUiKeyboardShortcutsDialogProps,
	TLUiStylePanelProps,
	TLUiOverrides,
	TextToolbarItem,
	TldrawUiMenuActionItem,
	TldrawUiMenuGroup,
	TldrawUiMenuItem,
	TldrawUiMenuSubmenu,
	TldrawUiMenuToolItem,
	ToggleEdgeScrollingItem,
	ToggleFocusModeItem,
	ToggleGridItem,
	TogglePasteAtCursorItem,
	ToggleSnapModeItem,
	ToggleToolLockItem,
	ToggleWrapModeItem,
	TriangleToolbarItem,
	ViewSubmenu,
	useActions,
	useEditor,
	useIsToolSelected,
	useTools,
	useValue,
} from 'tldraw'
import { razzleThemeOverrides } from '../theme'
import { BuildBadges, BuildPreviewStyle } from './BuildsPanel'
import { SlideNumbers } from '../model/SlideNumbers'
import { CodeStylePanel, insertCodeBlock, useCodeSelected } from './CodeStylePanel'
import { addSlide, zoomToSlide } from './slideOps'
import { $libraryOpen } from './state'
import { RazzleMenuPanel, RazzleSharePanel, RecordingCaption } from './TopControls'

/** Actions the studio adds; `run` hooks are filled in by the studio (they need the deck). */
export const studioHooks: {
	openDecks?: () => void
	exportPptx?: () => void
	exportReveal?: () => void
	exportPdf?: () => void
	presentHere?: () => void
	share?: () => void
} = {}

const LABELS: Record<string, string> = {
	'tool.slide': 'Slide',
	'action.razzle.library': 'Library',
	'action.razzle.code': 'Code block',
	'action.razzle.decks': 'All decks',
	'action.razzle.export-pptx': 'PowerPoint (.pptx)',
	'action.razzle.export-reveal': 'reveal.js (.html)',
	'action.razzle.export-pdf': 'PDF (print)',
	'action.razzle.present-here': 'Present in this browser',
	'action.razzle.share': 'Copy a link to this talk',
	'menu.razzle.export': 'Export deck',
}

export const studioOverrides: TLUiOverrides[] = [
	razzleThemeOverrides,
	{
		translations: { en: LABELS },
		tools(editor, tools) {
			tools.slide = {
				id: 'slide',
				icon: 'rz-slide',
				label: 'tool.slide',
				kbd: 's',
				onSelect() {
					editor.markHistoryStoppingPoint('add slide')
					const id = addSlide(editor)
					zoomToSlide(editor, id)
					editor.setCurrentTool('select')
				},
			}
			// `L` opens the library; the line tool moves to shift+L.
			if (tools.line) tools.line = { ...tools.line, kbd: 'shift+l' }
			return tools
		},
		actions(editor, actions) {
			const add = (id: string, kbd: string | undefined, onSelect: () => void, icon?: string) => {
				actions[`razzle.${id}`] = { id: `razzle.${id}`, label: `action.razzle.${id}`, kbd, icon, readonlyOk: true, onSelect }
			}
			add('library', 'l', () => $libraryOpen.set(!$libraryOpen.get()), 'rz-library')
			add('code', undefined, () => insertCodeBlock(editor), 'rz-code')
			actions['razzle.code'].readonlyOk = false
			add('decks', undefined, () => studioHooks.openDecks?.(), 'rz-decks')
			add('export-pptx', undefined, () => studioHooks.exportPptx?.())
			add('export-reveal', undefined, () => studioHooks.exportReveal?.())
			add('export-pdf', undefined, () => studioHooks.exportPdf?.())
			add('present-here', undefined, () => studioHooks.presentHere?.(), 'rz-present')
			add('share', undefined, () => studioHooks.share?.(), 'link')
			return actions
		},
	},
]

function RazzleToolbar() {
	const tools = useTools()
	const slideSelected = useIsToolSelected(tools['slide'])
	return (
		<DefaultToolbar>
			<SelectToolbarItem />
			<HandToolbarItem />
			<TldrawUiMenuToolItem toolId="slide" isSelected={slideSelected} />
			<LibraryToolbarItem />
			<TextToolbarItem />
			<CodeToolbarItem />
			<ArrowToolbarItem />
			<LineToolbarItem />
			<RectangleToolbarItem />
			<EllipseToolbarItem />
			<TriangleToolbarItem />
			<DiamondToolbarItem />
			<DrawToolbarItem />
			<EraserToolbarItem />
			<AssetToolbarItem />
			<NoteToolbarItem />
			<HighlightToolbarItem />
			<LaserToolbarItem />
			<FrameToolbarItem />
		</DefaultToolbar>
	)
}

function LibraryToolbarItem() {
	const actions = useActions()
	const open = useValue($libraryOpen)
	const action = actions['razzle.library']
	if (!action) return null
	return <TldrawUiMenuItem {...(action as any)} isSelected={open} />
}

function CodeToolbarItem() {
	const actions = useActions()
	const action = actions['razzle.code']
	if (!action) return null
	return <TldrawUiMenuItem {...(action as any)} />
}

function RazzleMainMenu() {
	return (
		<DefaultMainMenu>
			<TldrawUiMenuGroup id="razzle-deck">
				<TldrawUiMenuActionItem actionId="razzle.decks" />
			</TldrawUiMenuGroup>
			<TldrawUiMenuGroup id="basic">
				<EditSubmenu />
				<ViewSubmenu />
				<TldrawUiMenuSubmenu id="razzle-export" label="menu.razzle.export">
					<TldrawUiMenuGroup id="razzle-export-group">
						<TldrawUiMenuActionItem actionId="razzle.export-pptx" />
						<TldrawUiMenuActionItem actionId="razzle.export-reveal" />
						<TldrawUiMenuActionItem actionId="razzle.export-pdf" />
					</TldrawUiMenuGroup>
					<TldrawUiMenuGroup id="razzle-export-images">
						<TldrawUiMenuActionItem actionId="export-all-as-svg" />
						<TldrawUiMenuActionItem actionId="export-all-as-png" />
					</TldrawUiMenuGroup>
				</TldrawUiMenuSubmenu>
				<TldrawUiMenuActionItem actionId="insert-media" />
				<TldrawUiMenuActionItem actionId="razzle.present-here" />
				<TldrawUiMenuActionItem actionId="razzle.share" />
			</TldrawUiMenuGroup>
			<TldrawUiMenuGroup id="preferences">
				<TldrawUiMenuSubmenu id="preferences" label="menu.preferences">
					<TldrawUiMenuGroup id="preferences-actions">
						<ToggleSnapModeItem />
						<ToggleToolLockItem />
						<ToggleGridItem />
						<ToggleWrapModeItem />
						<ToggleFocusModeItem />
						<ToggleEdgeScrollingItem />
						<TogglePasteAtCursorItem />
					</TldrawUiMenuGroup>
				</TldrawUiMenuSubmenu>
				<KeyboardShortcutsMenuItem />
			</TldrawUiMenuGroup>
		</DefaultMainMenu>
	)
}

function RazzleShortcuts(props: TLUiKeyboardShortcutsDialogProps) {
	const tools = useTools()
	const actions = useActions()
	return (
		<DefaultKeyboardShortcutsDialog {...props}>
			<TldrawUiMenuGroup label="Slides" id="razzle-shortcuts">
				{tools['slide'] && <TldrawUiMenuItem {...tools['slide']} />}
				{actions['razzle.library'] && <TldrawUiMenuItem {...(actions['razzle.library'] as any)} />}
				<TldrawUiMenuItem id="rz-next" label="Next slide" kbd="pagedown" onSelect={() => {}} />
				<TldrawUiMenuItem id="rz-prev" label="Previous slide" kbd="pageup" onSelect={() => {}} />
			</TldrawUiMenuGroup>
			<DefaultKeyboardShortcutsDialogContent />
		</DefaultKeyboardShortcutsDialog>
	)
}

/** The style panel, shown while something is selected or a drawing tool is active. */
function RazzleStylePanel(props: TLUiStylePanelProps) {
	const editor = useEditor()
	const show = useValue('show style panel', () => editor.getSelectedShapeIds().length > 0 || !editor.isIn('select'), [editor])
	const code = useCodeSelected()
	if (!show) return null
	if (!code) return <DefaultStylePanel {...props} />
	return (
		<DefaultStylePanel {...props}>
			<DefaultStylePanelContent />
			<CodeStylePanel />
		</DefaultStylePanel>
	)
}

function InFront() {
	return (
		<>
			<BuildPreviewStyle />
			<BuildBadges />
		</>
	)
}

export const studioComponents: TLComponents = {
	MenuPanel: RazzleMenuPanel,
	SharePanel: RazzleSharePanel,
	TopPanel: RecordingCaption,
	MainMenu: RazzleMainMenu,
	StylePanel: RazzleStylePanel,
	PageMenu: null,
	Toolbar: RazzleToolbar,
	KeyboardShortcutsDialog: RazzleShortcuts,
	InFrontOfTheCanvas: InFront,
	OnTheCanvas: SlideNumbers,
	DebugPanel: null,
	DebugMenu: null,
	Minimap: null,
}
