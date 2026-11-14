import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react()],
    server: {
      proxy: {
        // Resco Cloud (basic auth); kept separate from /api, which is our own backend
        '/resco': {
          target: env.VITE_RESCO_BASE_URL,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/resco/, '/odata/v4'),
        },
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
  }
})
