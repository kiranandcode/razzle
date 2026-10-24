import { createShapeId } from 'tldraw'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { TestEditor } from '../../../../packages/tldraw/src/test/TestEditor'
import { buildOpacity, slideMeta, stepCount } from '../model/slides'
import { insertBuildStep, moveBuilds, ownBuild, setBuildEnd } from './builds'

let editor: TestEditor
const frame = createShapeId('slide')
const a = createShapeId('a')
const b = createShapeId('b')
const fresh = createShapeId('new')

beforeEach(() => {
	editor = new TestEditor()
	editor.createShapes([
		{
			id: frame,
			type: 'frame',
			props: { w: 1000, h: 562.5 },
			meta: {
				razzle: {
					script: ['intro', 'one', 'two', 'three', 'four'],
					cues: [
						{ id: 'c', phrase: 'next', action: 'step', atStep: 2 },
						{ id: 'always', phrase: 'go', action: 'step' },
					],
				},
			},
		},
		{
			id: a,
			type: 'geo',
			parentId: frame,
			meta: { build: { step: 1, effect: 'appear', until: 3 }, other: 'kept' },
		},
		{
			id: b,
			type: 'geo',
			parentId: frame,
			x: 100,
			meta: { build: { step: 2, effect: 'fade', until: 4 } },
			isLocked: true,
		},
		{ id: fresh, type: 'geo', parentId: frame, x: 200 },
	])
})
afterEach(() => editor.dispose())

it('shows an appear build for one step and hides it on the next', () => {
	setBuildEnd(editor, [a, b], 'next')
	const build = ownBuild(editor.getShape(a)!)!
	expect([0, 1, 2, 3].map((step) => buildOpacity(build, step))).toEqual([0, 1, 0, 0])
	expect(ownBuild(editor.getShape(b)!)?.until).toBe(3)
	setBuildEnd(editor, [a], null)
	expect(buildOpacity(ownBuild(editor.getShape(a)!), 3)).toBe(1)
	editor.undo()
	expect(buildOpacity(ownBuild(editor.getShape(a)!), 3)).toBe(0)
})

it('keeps empty inserted steps and shifted final scripts reachable', () => {
	editor.run(() => editor.deleteShapes([b]), { ignoreShapeLock: true })
	editor.updateShape({ id: a, type: 'geo', meta: { build: { step: 1, effect: 'appear' } } })
	editor.updateShape({
		id: frame,
		type: 'frame',
		meta: {
			razzle: {
				script: ['intro', 'line'],
				cues: [{ id: 'c', phrase: 'next', action: 'step', atStep: 1 }],
			},
		},
	})
	insertBuildStep(editor, editor.getShape(frame)!, 1, [a])
	expect(stepCount(editor, editor.getShape(frame)!)).toBe(3)
	expect(slideMeta(editor.getShape(frame)!).script).toEqual(['intro', '', 'line'])
	expect(slideMeta(editor.getShape(frame)!).cues?.[0].atStep).toBe(2)
	insertBuildStep(editor, editor.getShape(frame)!, 3)
	expect(stepCount(editor, editor.getShape(frame)!)).toBe(4)
})

it('inserts a selected object and shifts starts, ends, scripts and cues as one undo', () => {
	insertBuildStep(editor, editor.getShape(frame)!, 2, [fresh])
	expect(ownBuild(editor.getShape(fresh)!)).toEqual({ step: 2, effect: 'appear' })
	expect(ownBuild(editor.getShape(a)!)).toEqual({ step: 1, effect: 'appear', until: 4 })
	expect(ownBuild(editor.getShape(b)!)).toEqual({ step: 3, effect: 'fade', until: 5 })
	expect(editor.getShape(a)?.meta.other).toBe('kept')
	expect(slideMeta(editor.getShape(frame)!)).toMatchObject({
		script: ['intro', 'one', '', 'two', 'three', 'four'],
		cues: [{ atStep: 3 }, { id: 'always' }],
	})
	editor.undo()
	expect(ownBuild(editor.getShape(fresh)!)).toBeUndefined()
	expect(ownBuild(editor.getShape(b)!)?.step).toBe(2)
	expect(slideMeta(editor.getShape(frame)!).script).toEqual([
		'intro',
		'one',
		'two',
		'three',
		'four',
	])
})

it('moves selected builds together, preserving duration and clamping the first step', () => {
	moveBuilds(editor, [a, b], 2)
	expect(ownBuild(editor.getShape(a)!)).toEqual({ step: 3, effect: 'appear', until: 5 })
	expect(ownBuild(editor.getShape(b)!)).toEqual({ step: 4, effect: 'fade', until: 6 })
	moveBuilds(editor, [a, b], -20)
	expect(ownBuild(editor.getShape(a)!)?.step).toBe(1)
	expect(ownBuild(editor.getShape(b)!)?.step).toBe(2)
	expect(slideMeta(editor.getShape(frame)!).script?.[2]).toBe('two')
})

it('keeps insertion scoped to the slide and shifts group-owned builds', () => {
	const group = createShapeId('group')
	const other = createShapeId('outside')
	editor.groupShapes([a, fresh], { groupId: group })
	editor.updateShape({ id: group, type: 'group', meta: { build: { step: 2, effect: 'appear' } } })
	editor.createShape({
		id: other,
		type: 'geo',
		x: 2000,
		meta: { build: { step: 2, effect: 'disappear' } },
	})
	insertBuildStep(editor, editor.getShape(frame)!, 1, [other])
	expect(ownBuild(editor.getShape(group)!)?.step).toBe(3)
	expect(ownBuild(editor.getShape(a)!)?.step).toBe(2)
	expect(ownBuild(editor.getShape(other)!)?.step).toBe(2)
})
