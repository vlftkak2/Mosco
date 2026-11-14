import { useEffect, useRef } from 'react';
import { reduceMotion } from '../hooks';

// 메인 히어로의 한반도 도트맵 (캔버스). 거점 사이로 물류 흐름이 움직인다.
const POLY = [[124.3,39.9],[125.1,39.6],[125.4,38.9],[125.0,38.5],[124.7,38.1],[125.6,37.8],[126.1,37.7],[126.6,37.4],[126.8,36.9],[126.3,36.6],[126.5,36.0],[126.6,35.5],[126.3,35.0],[126.3,34.5],[126.9,34.4],[127.5,34.6],[128.4,34.8],[129.0,35.1],[129.4,35.5],[129.5,36.0],[129.4,36.8],[129.3,37.4],[128.8,38.0],[128.4,38.6],[127.6,39.2],[127.5,39.8],[128.3,40.0],[129.0,40.7],[129.7,41.0],[129.9,41.8],[130.6,42.4],[129.6,42.4],[128.9,42.0],[128.0,42.0],[127.0,41.7],[126.3,41.6],[125.3,40.6]];
const HUBS = [
  { n: 'SEOUL', p: [126.98, 37.57], side: 'r' },
  { n: 'INCHEON', p: [126.62, 37.45], side: 'l' },
  { n: 'DANGJIN', p: [126.63, 36.89], side: 'l' },
  { n: 'POHANG', p: [129.36, 36.02], side: 'r' },
  { n: '', p: [129.31, 35.54], side: 'r' },
  { n: 'BUSAN', p: [129.07, 35.18], side: 'r' },
  { n: 'GWANGYANG', p: [127.70, 34.94], side: 'l' },
];
const ROUTES = [[3, 0], [6, 0], [2, 1], [4, 5], [3, 2], [6, 5], [1, 0]];

const inPoly = (x, y) => {
  let c = false;
  for (let i = 0, j = POLY.length - 1; i < POLY.length; j = i++) {
    const [xi, yi] = POLY[i], [xj, yj] = POLY[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
};
const inJeju = (x, y) => ((x - 126.55) / 0.36) ** 2 + ((y - 33.38) / 0.17) ** 2 <= 1;

export default function KoreaMap() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const cv = canvasRef.current;
    const ctx = cv.getContext('2d');
    let W, H, dpr, dots = [], frame;
    const t0 = performance.now();
    const proj = ([lon, lat]) => {
      const cx = 129.4, cy = 37.6, s = H / 12.5;
      return [W / 2 + (lon - cx) * s * 0.8, H / 2 - (lat - cy) * s];
    };
    const build = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      const r = cv.getBoundingClientRect(); W = r.width; H = r.height || r.width;
      cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      dots = [];
      const step = Math.max(6, W / 64);
      for (let y = step / 2; y < H; y += step) for (let x = step / 2; x < W; x += step) {
        const dx = x - W / 2, dy = y - H / 2; const rr = Math.hypot(dx, dy) / (W / 2);
        if (rr > 0.98) continue;
        const cx = 129.4, cy = 37.6, s = H / 12.5;
        const lon = cx + dx / (s * 0.8), lat = cy - dy / s;
        dots.push({ x, y, land: inPoly(lon, lat) || inJeju(lon, lat), edge: rr, ph: Math.random() * 6.28 });
      }
    };
    const arc = (a, b) => {
      const [x1, y1] = proj(HUBS[a].p), [x2, y2] = proj(HUBS[b].p);
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 - Math.hypot(x2 - x1, y2 - y1) * 0.35;
      return { x1, y1, x2, y2, mx, my, at: (t) => [(1 - t) ** 2 * x1 + 2 * (1 - t) * t * mx + t * t * x2, (1 - t) ** 2 * y1 + 2 * (1 - t) * t * my + t * t * y2] };
    };
    const draw = (now) => {
      // 첫 프레임의 시각이 t0 보다 조금 이를 수 있어 0 아래로는 내려가지 않게 한다 (음수면 원 반지름이 음수가 되어 오류)
      const t = Math.max(0, (now - t0) / 1000);
      ctx.clearRect(0, 0, W, H);
      for (const d of dots) {
        if (d.land) {
          const tw = 0.55 + 0.45 * Math.sin(t * 1.4 + d.ph);
          ctx.fillStyle = `rgba(170,190,255,${0.55 + 0.4 * tw})`;
          ctx.beginPath(); ctx.arc(d.x, d.y, 1.6, 0, 6.283); ctx.fill();
        } else {
          ctx.fillStyle = `rgba(120,140,220,${0.12 * (1 - d.edge * 0.7)})`;
          ctx.fillRect(d.x - .6, d.y - .6, 1.2, 1.2);
        }
      }
      ROUTES.forEach(([a, b], i) => {
        const A = arc(a, b);
        ctx.strokeStyle = 'rgba(143,163,255,.28)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(A.x1, A.y1); ctx.quadraticCurveTo(A.mx, A.my, A.x2, A.y2); ctx.stroke();
        const p = ((t * 0.35 + i * 0.23) % 1);
        for (let k = 0; k < 10; k++) {
          const tt = p - k * 0.012; if (tt < 0) continue;
          const [x, y] = A.at(tt);
          ctx.fillStyle = `rgba(190,205,255,${0.9 - k * 0.09})`;
          ctx.beginPath(); ctx.arc(x, y, 2.2 - k * 0.15, 0, 6.283); ctx.fill();
        }
      });
      HUBS.forEach((h, i) => {
        const [x, y] = proj(h.p); const main = i === 0;
        const pr = ((t * 0.6 + i * 0.3) % 1);
        ctx.strokeStyle = `rgba(143,163,255,${1 - pr})`; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, 4 + pr * (main ? 22 : 14), 0, 6.283); ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, main ? 5 : 3.2, 0, 6.283); ctx.fill();
        if (main) { ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 9, 0, 6.283); ctx.stroke(); }
        ctx.font = `${main ? 800 : 700} ${main ? 12.5 : 11}px Pretendard, sans-serif`;
        ctx.fillStyle = main ? '#fff' : 'rgba(200,212,255,.75)';
        const left = h.side === 'l';
        ctx.textAlign = left ? 'right' : 'left';
        if (h.n) ctx.fillText(h.n, x + (left ? -12 : 12), y + 4);
      });
      if (!reduceMotion) frame = requestAnimationFrame(draw);
    };
    const onResize = () => { build(); if (reduceMotion) frame = requestAnimationFrame(draw); };
    build();
    frame = requestAnimationFrame(draw);
    window.addEventListener('resize', onResize);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', onResize); };
  }, []);

  return <canvas id="korea-map" ref={canvasRef} />;
}
