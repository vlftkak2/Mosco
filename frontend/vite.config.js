import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const appVersion = new Date().toISOString()

function appVersionPlugin() {
  return {
    name: 'app-version',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ version: appVersion }, null, 2),
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  server: {
    host: '0.0.0.0', // 타 PC에서 접근 가능하도록 허용
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000', // FastAPI backend (backend/main.py)
        changeOrigin: true,
      },
      '/passwordapi': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  plugins: [react(), appVersionPlugin()],
})
