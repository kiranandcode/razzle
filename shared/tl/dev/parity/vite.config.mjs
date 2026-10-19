// Vite config for the parity / load-check page (see run.mjs). Resolves the studio's
// tldraw fork, React and shape utils from tldraw/apps/razzle.
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../../../..')
const app = path.join(repo, 'tldraw/apps/razzle')
const react = (await import(pathToFileURL(path.join(app, 'node_modules/@vitejs/plugin-react/dist/index.js')).href)).default

export default {
	root: here,
	publicDir: path.join(app, 'public'),
	plugins: [react()],
	resolve: {
		alias: {
			tldraw: path.join(app, 'node_modules/tldraw'),
			react: path.join(app, 'node_modules/react'),
			'react-dom': path.join(app, 'node_modules/react-dom'),
		},
		dedupe: ['react', 'react-dom'],
	},
	server: { host: '127.0.0.1', strictPort: true, fs: { strict: false } },
	define: { __RAZZLE_FONTS__: JSON.stringify('/@fs' + path.join(repo, 'shared/fonts') + '/') },
	logLevel: 'warn',
}
