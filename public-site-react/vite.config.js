import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 홈페이지(스틸119) 개발 서버. ERP(frontend)가 5173 을 쓰므로 5174 로 띄운다 — 둘을 동시에 켜도 겹치지 않는다.
export default defineConfig({
  plugins: [react()],
  server: { host: '0.0.0.0', port: 5174, strictPort: true },
  preview: { port: 4174, strictPort: true },
})
