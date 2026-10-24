import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
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
				if (existsSync(file))
					this.emitFile({
						type: 'asset',
						fileName: `razzle-shared/${name}`,
						source: readFileSync(file),
					})
			}
		},
	}
}

// The public build has no server and no browser mic: every module of src/asr/ that the studio
// imports resolves to a stub there, so no speech code (or transformers.js) reaches dist-public.
const PUBLIC_BUILD = process.env.VITE_RAZZLE_PUBLIC === '1'
const ASR_STUB = resolve(import.meta.dirname, 'src/asr/publicStub.ts')

function razzlePublicAsr(): Plugin {
	return {
		name: 'razzle-public-asr',
		enforce: 'pre',
		resolveId(id, importer) {
			if (!PUBLIC_BUILD || !importer) return null
			if (
				/(^|\/)asr\/(mic|MicToggle|RedoNarration|engine|worker)(\.tsx?)?$/.test(id) &&
				!importer.includes('/src/asr/')
			)
				return ASR_STUB
			return null
		},
	}
}

// Razzle server the dev server proxies to (RAZZLE_PORT, as the server reads it)
const SERVER = `127.0.0.1:${process.env.RAZZLE_PORT ?? 7878}`

export default defineConfig({
	// relative asset URLs: the same build works at / and behind a prefix such as /private/
	base: './',
	plugins: [razzlePublicAsr(), react(), razzleShared()],
	// the speech worker (src/asr/worker.ts) code-splits transformers.js
	worker: { format: 'es' },
	server: {
		host: '127.0.0.1',
		port: 5174,
		proxy: {
			// Razzle server (server/server.ts)
			'/api': { target: `http://${SERVER}`, changeOrigin: true },
			'/ws': { target: `ws://${SERVER}`, ws: true },
			// speech-model files for the browser mic (server/fetch-models.sh)
			'/models': { target: `http://${SERVER}`, changeOrigin: true },
		},
	},
})
