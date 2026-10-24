// The studio's tldraw schema, headless: tldraw's default shapes + razzle-path + razzle-code, with the
// Razzle palette registered as colour style values (as the studio theme does).
import {
	DefaultColorStyle,
	createTLSchema,
	defaultBindingSchemas,
	defaultShapeSchemas,
} from 'tldraw'
import { RAZZLE_PATH_TYPE, razzlePathProps } from '../../../tldraw/apps/razzle/src/shapes/razzlePathSchema.ts'
import { RAZZLE_CODE_TYPE, razzleCodeProps } from '../../../tldraw/apps/razzle/src/shapes/razzleCodeSchema.ts'
import { PALETTE } from '../palette.ts'

DefaultColorStyle.addValues(...(Object.keys(PALETTE) as any[]))

export const schema = createTLSchema({
	shapes: { ...defaultShapeSchemas, [RAZZLE_PATH_TYPE]: { props: razzlePathProps }, [RAZZLE_CODE_TYPE]: { props: razzleCodeProps } },
	bindings: defaultBindingSchemas,
})
