import react from '@vitejs/plugin-react'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'

// The repo's shared/ folder (library made by the PPTist converter), served at /razzle-shared/
// in dev and copied into the build when present.
const SHARED = resolve(import.meta.dirname, '../../../shared')
const SHARED_FILES = ['library.tldraw.json']

function razzleShared(): Plugin {
	return {
		name: 'razzle-shared',
		configureServer(server) {
			server.middlewares.use('/razzle-shared', (req, res, next) => {
				const name = (req.url ?? '').replace(/^\//, '').split('?')[0]
				const file = resolve(SHARED, name)
				if (!SHARED_FILES.includes(name) || !existsSync(file)) return next()
				res.setHeader('Content-Type', 'application/json')
				res.setHeader('Cache-Control', 'no-cache')
				res.end(readFileSync(file))
			})
		},
		generateBundle() {
			for (const name of SHARED_FILES) {
				const file = resolve(SHARED, name)
				if (existsSync(file)) this.emitFile({ type: 'asset', fileName: `razzle-shared/${name}`, source: readFileSync(file) })
			}
		},
	}
}

export default defineConfig({
	plugins: [react(), razzleShared()],
	server: {
		host: '127.0.0.1',
		port: 5174,
		proxy: {
			// Razzle server (server/server.ts)
			'/api': { target: 'http://127.0.0.1:7878', changeOrigin: true },
			'/ws': { target: 'ws://127.0.0.1:7878', ws: true },
		},
	},
})
