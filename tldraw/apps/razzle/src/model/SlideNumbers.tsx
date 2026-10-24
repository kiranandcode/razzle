import { useEditor, useValue } from 'tldraw'
import { getSlides } from './slides'

export const SLIDE_NUMBER = { inset: 20, size: 14, color: '#777777', font: 'Arial' }

export function slideNumberSvg(number: number, width: number, height: number) {
	const { inset, size, color, font } = SLIDE_NUMBER
	return `<text x="${width - inset}" y="${height - inset}" text-anchor="end" font-family="${font}" font-size="${size}" fill="${color}">${number}</text>`
}

export function SlideNumbers() {
	const editor = useEditor()
	const slides = useValue(
		'slide numbers',
		() =>
			getSlides(editor).flatMap((frame, index) => {
				if (editor.isShapeHidden(frame)) return []
				return [
					{
						id: frame.id,
						number: index + 1,
						width: frame.props.w,
						height: frame.props.h,
						transform: editor.getShapePageTransform(frame).toCssString(),
					},
				]
			}),
		[editor]
	)
	return (
		<>
			{slides.map((slide) => (
				<svg
					key={slide.id}
					className="rz-slide-number"
					aria-label={`Slide ${slide.number}`}
					width={slide.width}
					height={slide.height}
					style={{
						position: 'absolute',
						top: 0,
						left: 0,
						transformOrigin: '0 0',
						transform: slide.transform,
						pointerEvents: 'none',
						zIndex: 2147483647,
					}}
					dangerouslySetInnerHTML={{
						__html: slideNumberSvg(slide.number, slide.width, slide.height),
					}}
				/>
			))}
		</>
	)
}
