// A fixed deck exercising every export path: native text/geo/line/arrow, image fallbacks,
// builds (appear / fade / disappear, on a shape and on a group), a hidden slide, notes.
import { Editor, TLShapeId, createShapeId, toRichText } from 'tldraw'
import { SLIDE_H, SLIDE_W } from '../../model/types'

const rt = (...paras: { text: string; marks?: string[] }[][]) => ({
	type: 'doc',
	content: paras.map((runs) => ({
		type: 'paragraph',
		content: runs.map((r) => ({ type: 'text', text: r.text, ...(r.marks ? { marks: r.marks.map((type) => ({ type })) } : {}) })),
	})),
})

export function buildTestDeck(editor: Editor) {
	const frame = (name: string, y: number, meta: object = {}) => {
		const id = createShapeId()
		editor.createShape({ id, type: 'frame', x: 0, y, props: { w: SLIDE_W, h: SLIDE_H, name }, meta: { razzle: meta as any } })
		return id
	}
	const add = (parent: TLShapeId, s: any) => {
		const id = s.id ?? createShapeId()
		editor.createShape({ ...s, id, parentId: parent })
		return id
	}
	const build = (step: number, effect: 'appear' | 'fade' | 'disappear') => ({ build: { step, effect } })

	// Slide 1 -----------------------------------------------------------------------
	const s1 = frame('Builds and native shapes', 0, {
		script: ['Here is the system.', 'The agent appears.', 'Now the runtime comes into focus.'],
	})
	add(s1, {
		type: 'text',
		x: 44,
		y: 40,
		props: { richText: toRichText('Who watches the watchers?'), font: 'serif', size: 'l', color: 'black' },
	})
	add(s1, {
		type: 'text',
		x: 44,
		y: 110,
		props: {
			richText: rt(
				[{ text: 'Plain, ' }, { text: 'bold', marks: ['bold'] }, { text: ' and ' }, { text: 'italic', marks: ['italic'] }, { text: ' runs' }],
				[{ text: 'second line, ' }, { text: 'code()', marks: ['code'] }]
			),
			font: 'serif',
			size: 'm',
			color: 'grey',
		},
	})
	const agent = add(s1, {
		type: 'geo',
		x: 60,
		y: 260,
		props: { geo: 'rectangle', w: 220, h: 110, fill: 'fill', color: 'stage', labelColor: 'black', richText: toRichText('Agent'), font: 'serif', size: 'm', dash: 'solid' },
		meta: build(1, 'appear'),
	})
	const runtime = add(s1, {
		type: 'geo',
		x: 560,
		y: 260,
		props: { geo: 'rectangle', w: 240, h: 110, fill: 'fill', color: 'runtime', labelColor: 'black', richText: toRichText('Runtime'), font: 'serif', size: 'm', dash: 'solid' },
		meta: build(2, 'fade'),
	})
	add(s1, {
		type: 'geo',
		x: 860,
		y: 60,
		props: { geo: 'ellipse', w: 90, h: 90, fill: 'solid', color: 'teal', dash: 'solid', size: 'm' },
		meta: build(2, 'disappear'),
	})
	add(s1, {
		type: 'geo',
		x: 860,
		y: 180,
		props: { geo: 'triangle', w: 90, h: 80, fill: 'none', color: 'orange', dash: 'dashed', size: 'm' },
	})
	// straight arrow bound to both boxes
	const arrow = createShapeId()
	add(s1, {
		id: arrow,
		type: 'arrow',
		x: 300,
		y: 315,
		props: { start: { x: 0, y: 0 }, end: { x: 240, y: 0 }, color: 'grey', size: 'm', arrowheadEnd: 'arrow', dash: 'solid' },
		meta: build(1, 'appear'),
	})
	editor.createBindings([
		{ type: 'arrow', fromId: arrow, toId: agent, props: { terminal: 'start', normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false } },
		{ type: 'arrow', fromId: arrow, toId: runtime, props: { terminal: 'end', normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false } },
	])
	add(s1, {
		type: 'line',
		x: 44,
		y: 470,
		props: {
			color: 'grey',
			size: 'm',
			dash: 'dotted',
			points: { a1: { id: 'a1', index: 'a1', x: 0, y: 0 }, a2: { id: 'a2', index: 'a2', x: 900, y: 0 } },
		},
	})
	// curved arrow + labelled arrow: image fallback
	add(s1, {
		type: 'arrow',
		x: 170,
		y: 390,
		props: { start: { x: 0, y: 0 }, end: { x: 500, y: 0 }, bend: -40, color: 'blue', arrowheadEnd: 'triangle', size: 'm' },
		meta: build(2, 'fade'),
	})
	add(s1, {
		type: 'arrow',
		x: 600,
		y: 520,
		props: { start: { x: 0, y: 0 }, end: { x: 300, y: 0 }, color: 'bug', richText: toRichText('label'), arrowheadEnd: 'arrow', size: 's', font: 'serif' },
	})

	// Slide 2 (hidden) ---------------------------------------------------------------
	const s2 = frame('A hidden slide', 700, { hidden: true, script: ['Only reached by goto.'] })
	add(s2, { type: 'text', x: 44, y: 40, props: { richText: toRichText('Hidden slide'), font: 'serif', size: 'l' } })

	// Slide 3 ------------------------------------------------------------------------
	const s3 = frame('Fallbacks and groups', 1400, {
		notes: '<p>Speaker notes in <b>HTML</b>.</p><ul><li>first point</li><li>second point</li></ul>',
	})
	add(s3, { type: 'text', x: 44, y: 40, props: { richText: toRichText('Images where needed'), font: 'serif', size: 'l' } })
	add(s3, {
		type: 'text',
		x: 44,
		y: 110,
		props: { richText: toRichText('let x = eval(e)\nin x + 1'), font: 'mono', size: 's', color: 'black' },
	})
	add(s3, {
		type: 'text',
		x: 600,
		y: 110,
		props: { richText: toRichText('Centred, fixed width text that wraps over lines'), font: 'sans', size: 'm', textAlign: 'middle', autoSize: false, w: 300 },
	})
	add(s3, {
		type: 'geo',
		x: 80,
		y: 220,
		rotation: 0.3,
		props: { geo: 'rectangle', w: 160, h: 80, fill: 'solid', color: 'blue', dash: 'solid', size: 'm' },
	})
	add(s3, { type: 'geo', x: 300, y: 220, props: { geo: 'star', w: 110, h: 110, fill: 'fill', color: 'orange', size: 'm' } })
	add(s3, { type: 'geo', x: 450, y: 220, props: { geo: 'cloud', w: 140, h: 100, fill: 'pattern', color: 'teal', size: 'm' } })
	add(s3, { type: 'note', x: 640, y: 220, props: { richText: toRichText('a sticky note'), color: 'orange' } })
	// nested frame
	const inner = add(s3, { type: 'frame', x: 60, y: 380, props: { w: 300, h: 150, name: 'inner' } })
	add(inner, { type: 'geo', x: 20, y: 30, props: { geo: 'ellipse', w: 80, h: 80, fill: 'fill', color: 'aqua', size: 'm' } })
	// exact library glyph (razzle-path), faded until step 1
	if (editor.getShapeUtil('razzle-path' as any)) {
		add(s3, {
			type: 'razzle-path',
			x: 820,
			y: 400,
			props: {
				w: 120, h: 120, viewW: 100, viewH: 100,
				path: 'M50 5 L95 50 L50 95 L5 50 Z M50 25 A25 25 0 1 0 50.01 25',
				fill: '#4fafc3', stroke: '#000000', strokeWidth: 2, dash: 'solid',
			},
			meta: { build: { step: 1, effect: 'fade' } },
		})
	}
	// a group that fades in at step 1
	const g1 = add(s3, { type: 'geo', x: 450, y: 400, props: { geo: 'rectangle', w: 120, h: 70, fill: 'fill', color: 'neutral', richText: toRichText('A'), size: 'm', font: 'serif' } })
	const g2 = add(s3, { type: 'geo', x: 600, y: 400, props: { geo: 'rectangle', w: 120, h: 70, fill: 'fill', color: 'neutral', richText: toRichText('B'), size: 'm', font: 'serif' } })
	const groupId = createShapeId()
	editor.groupShapes([g1, g2], { groupId, select: false })
	editor.updateShape({ id: groupId, type: 'group', meta: { build: { step: 1, effect: 'fade' } } })
	editor.selectNone()
	editor.zoomToFit()
}
