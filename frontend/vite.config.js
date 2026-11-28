import process from 'node:process'
import { defineConfig, loadEnv } from 'vite'
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

// 허용한 IP 말고는 연결 자체를 바로 끊는다 (요청 내용을 읽기 전에 → 원격 실행 공격 요청이 vite 까지 오지 못함).
// 2026-11-25: 이 PC 는 공인 IP 라 --host 로 열면 인터넷 전체에 열리고, 실제로 원격 실행 공격이 들어왔다.
function ipAllowlistPlugin(allowedIps) {
  const allowed = new Set(['127.0.0.1', '::1', ...allowedIps])
  const reported = new Set()   // 막은 IP 는 한 번씩만 화면에 남긴다 (앞 PC 가 안 열릴 때 IP 확인용)
  const guard = (httpServer) => {
    httpServer?.on('connection', (socket) => {
      const ip = String(socket.remoteAddress || '').replace(/^::ffff:/, '')
      if (allowed.has(ip)) return
      socket.destroy()
      if (!reported.has(ip) && reported.size < 50) {
        reported.add(ip)
        console.warn(`[ip-allowlist] 허용하지 않은 IP 접속을 막았습니다: ${ip}`)
      }
    })
  }
  return {
    name: 'ip-allowlist',
    configureServer(server) { guard(server.httpServer) },
    configurePreviewServer(server) { guard(server.httpServer) },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // 다른 PC 에 보여 줄 때: frontend/.env.local 에 SHARE_IPS=앞PC IP (여러 대면 쉼표로) → npm run dev
  // 비워 두면 이 PC 에서만 열린다 (--host 를 붙여도 허용 IP 가 없으면 이 PC 만).
  const env = loadEnv(mode, process.cwd(), '')
  // 항상 허용할 PC (IP 만, 포트는 붙이지 않는다) + .env.local 의 SHARE_IPS
  const FIXED_SHARE_IPS = ['192.168.0.3', '218.146.45.13']   // 앞 PC (사내 주소 · 공유기 바깥 주소)
  const shareIps = [...new Set([...FIXED_SHARE_IPS, ...String(env.SHARE_IPS || '').split(',').map((ip) => ip.trim()).filter(Boolean)])]
  const host = shareIps.length ? '0.0.0.0' : '127.0.0.1'
  const proxy = {
    '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true }, // FastAPI backend (backend/main.py)
    '/passwordapi': { target: 'http://127.0.0.1:8000', changeOrigin: true },
  }
  return {
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
    },
    server: { host, proxy },
    // 3D 보기(three.js): 개발 서버가 처음부터 준비해 둔다 (켜진 채 처음 불러오면 504 'Outdated Optimize Dep' 로 화면이 깨지던 것 방지)
    optimizeDeps: { include: ['three', 'three/examples/jsm/controls/OrbitControls.js', 'three/examples/jsm/renderers/CSS2DRenderer.js'] },
    // vite preview(빌드 결과 시연 서버)도 같은 규칙: 허용 IP 만
    preview: { host, proxy },
    plugins: [react(), appVersionPlugin(), ipAllowlistPlugin(shareIps)],
    build: {
      rollupOptions: {
        output: {
          // 라이브러리를 묶음별로 나눈다: 앱 코드만 바뀐 배포에서는 브라우저가 라이브러리 파일을 다시 받지 않고,
          // 차트 · PDF · 엑셀은 그 화면(기능)을 쓸 때만 받는다.
          manualChunks(id) {
            // CommonJS 변환 도우미는 모든 묶음이 같이 쓰므로 처음부터 받는 react 묶음에 둔다 (차트 묶음에 들어가면 첫 화면에서 차트까지 받는다)
            if (id.includes('commonjsHelpers')) return 'vendor-react';
            if (!id.includes('node_modules')) return undefined;
            const path = id.replace(/\\/g, '/');
            if (path.includes('/node_modules/xlsx-js-style/')) return 'vendor-xlsx';
            if (path.includes('/node_modules/pdfjs-dist/')) return 'vendor-pdf';
            if (path.includes('/node_modules/three/')) return 'vendor-three';   // 3D 보기를 열 때만 받는다
            // 차트: recharts 와 그것만 쓰는 라이브러리 (redux · immer 등 함께 쓰는 것은 rollup 이 알아서 나눈다)
            if (/\/node_modules\/(recharts|victory-vendor|d3-[^/]+|internmap|decimal\.js-light)\//.test(path)) return 'vendor-charts';
            // react 묶음: 첫 화면에 늘 필요한 것 (clsx 는 Mantine · 차트가 같이 써서 여기 둔다 — 차트 묶음에 들어가면 첫 화면에서 차트까지 받는다)
            if (/\/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom|cookie|set-cookie-parser|clsx)\//.test(path)) return 'vendor-react';
            // Mantine 은 따로 묶지 않는다: 한 묶음으로 만들면 일부 화면에서만 쓰는 부품(NumberInput 등)까지 첫 화면에 받게 된다
            return undefined;
          },
        },
      },
    },
  }
})
