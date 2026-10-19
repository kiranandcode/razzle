import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
	plugins: [react()],
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
