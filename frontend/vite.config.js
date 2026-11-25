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
    // 개발 서버는 이 PC에서만 (2026-11-25: 외부 · 터널로 열려 있다가 원격 실행 공격 요청이 들어와 막음)
    // 다른 PC · 외부 시연은 빌드한 결과를 vite preview(아래)나 정식 서버로 띄운다.
    host: '127.0.0.1',
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
  // vite preview(시연용 빌드 서버)도 터널 호스트 허용 + API 프록시
  preview: {
    host: '0.0.0.0',
    allowedHosts: ['.trycloudflare.com'],
    proxy: {
      '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/passwordapi': { target: 'http://127.0.0.1:8000', changeOrigin: true },
    },
  },
  plugins: [react(), appVersionPlugin()],
})
