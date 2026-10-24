import {
	ArrangeMenuSubmenu,
	CutMenuItem,
	CopyMenuItem,
	PasteMenuItem,
	DefaultContextMenu,
	DeleteMenuItem,
	DuplicateMenuItem,
	GroupMenuItem,
	ReorderMenuSubmenu,
	ToggleLockMenuItem,
	TldrawUiMenuGroup,
	TldrawUiMenuItem,
	TldrawUiMenuSubmenu,
	UngroupMenuItem,
	useEditor,
	useValue,
	type TLUiContextMenuProps,
} from 'tldraw'
import { isHidden, stepCount } from '../model/slides'
import { insertBuildStep, moveBuilds, ownBuild, setBuild } from './builds'
import {
	addSlide,
	currentSlide,
	deleteSlide,
	duplicateSlide,
	setSlideHidden,
	zoomToSlide,
} from './slideOps'
import { $inspector, $previewStep } from './state'

export function RazzleContextMenu(props: TLUiContextMenuProps) {
	return (
		<DefaultContextMenu {...props}>
			<RazzleContextMenuContent />
		</DefaultContextMenu>
	)
}

function RazzleContextMenuContent() {
	const editor = useEditor()
	const selected = useValue('context selection', () => editor.getSelectedShapes(), [editor])
	const slide = useValue('context slide', () => currentSlide(editor), [editor])
	const shapes = selected.filter((s) => s.type !== 'frame')
	const animated = shapes.filter((s) => ownBuild(s))
	const ids = shapes.map((s) => s.id)
	const selectedSlide = selected.length === 1 && selected[0].id === slide?.id
	const at = Math.min(
		slide ? stepCount(editor, slide) : 1,
		Math.max(
			1,
			animated.length
				? Math.min(...animated.map((s) => ownBuild(s)!.step))
				: ($previewStep.get() ?? 1)
		)
	)
	const editSlide = (label: string, action: () => void) => {
		editor.markHistoryStoppingPoint(label)
		action()
	}
	const nudge = (delta: number) => {
		moveBuilds(editor, ids, delta)
		$previewStep.set(null)
	}

	return (
		<>
			<TldrawUiMenuGroup id="razzle-clipboard">
				<CutMenuItem />
				<CopyMenuItem />
				<PasteMenuItem />
			</TldrawUiMenuGroup>
			{!selectedSlide && (
				<TldrawUiMenuGroup id="razzle-object">
					<DuplicateMenuItem />
					<DeleteMenuItem />
					<GroupMenuItem />
					<UngroupMenuItem />
				</TldrawUiMenuGroup>
			)}
			<TldrawUiMenuGroup id="razzle-arrange">
				<ToggleLockMenuItem />
				<ArrangeMenuSubmenu />
				<ReorderMenuSubmenu />
			</TldrawUiMenuGroup>
			<TldrawUiMenuGroup id="razzle-builds">
				<TldrawUiMenuItem
					id="razzle-timeline"
					label="Build timeline"
					onSelect={() => { $inspector.set('builds') }}
				/>
				{!!shapes.length && (
					<TldrawUiMenuSubmenu id="razzle-build-timing" label="Build timing" size="small">
						<TldrawUiMenuItem
							id="razzle-earlier"
							label="Move selection one step earlier"
							disabled={!animated.length || animated.some((s) => ownBuild(s)!.step <= 1)}
							onSelect={() => nudge(-1)}
						/>
						<TldrawUiMenuItem
							id="razzle-later"
							label="Move selection one step later"
							disabled={!animated.length}
							onSelect={() => nudge(1)}
						/>
						{slide && (
							<TldrawUiMenuItem
								id="razzle-insert-build"
								label={`Insert step ${at} for selection`}
								onSelect={() => {
									insertBuildStep(editor, slide, at, ids)
									$previewStep.set(null)
									$inspector.set('builds')
								}}
							/>
						)}
						<TldrawUiMenuItem
							id="razzle-clear-build"
							label="Remove build timing"
							disabled={!animated.length}
							onSelect={() => {
								editor.markHistoryStoppingPoint('remove builds')
							editor.run(() => setBuild(editor, ids, null), { ignoreShapeLock: true })
								$previewStep.set(null)
							}}
						/>
					</TldrawUiMenuSubmenu>
				)}
			</TldrawUiMenuGroup>
			<TldrawUiMenuGroup id="razzle-slide-actions">
				<TldrawUiMenuItem
					id="razzle-new-slide"
					label="New slide after this"
					onSelect={() => editSlide('add slide', () => zoomToSlide(editor, addSlide(editor)))}
				/>
				{slide && (
					<TldrawUiMenuSubmenu id="razzle-slide" label="Slide" size="small">
						<TldrawUiMenuItem
							id="razzle-duplicate-slide"
							label="Duplicate slide"
							onSelect={() =>
								editSlide('duplicate slide', () => {
									const id = duplicateSlide(editor, slide.id)
									if (id) zoomToSlide(editor, id)
								})
							}
						/>
						<TldrawUiMenuItem
							id="razzle-hide-slide"
							label={isHidden(slide) ? 'Show slide in presentation' : 'Skip slide in presentation'}
							onSelect={() =>
								editSlide('hide slide', () => setSlideHidden(editor, slide.id, !isHidden(slide)))
							}
						/>
						<TldrawUiMenuItem
							id="razzle-delete-slide"
							label="Delete slide"
							onSelect={() => editSlide('delete slide', () => deleteSlide(editor, slide.id))}
						/>
					</TldrawUiMenuSubmenu>
				)}
			</TldrawUiMenuGroup>
		</>
	)
}
