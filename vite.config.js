import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		proxy: {
			'/watcher': {
				target: 'http://localhost:4242',
				rewrite: (path) => path.replace(/^\/watcher/, ''),
				changeOrigin: true
			}
		}
	}
});
