// 가공 최적화 3D 보기 (three.js · 마우스로 돌리기 / 휠로 확대). [3D] 버튼을 누를 때만 이 파일과 three.js 를 받는다 (React.lazy).
//  - 같은 계산 결과(plan)로 그린다: 코일 = 폭별로 잘린 롤, 시트 = 원판 위 절단 조각.
//  - 치수 글자는 HTML 표(CSS2D)로 붙여 돌려도 항상 똑바로 읽힌다. 롤 지름 · 판 두께는 표시용.
//  - 성능: 그리기 장치는 한 번만 만들고 계획이 바뀌면 모형만 교체. 움직일 때만 다시 그리고, 화면을 닫으면 GPU 메모리를 돌려준다.
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import classes from '../../styles/pages/AIOrderOptimization.module.css';

const fmt = (value, digits = 1) => (value === null || value === undefined || value === '' ? '-'
  : Number(value).toLocaleString('ko-KR', { maximumFractionDigits: digits }));
// 3D 코일 롤 색: 2D 와 같은 파스텔 계열 (조명 그늘을 감안해 한 톤만 진하게 · 금속감 낮게)
const COIL3D = ['#a6c8ec', '#a9d8bf', '#eed48f', '#c9b9ee'];
// 3D 시트 조각 색: 2D 와 같은 색 순서 · 코일 3D 처럼 한 톤 또렷하게 (밝은 배경에서 흐려 보이지 않게)
const SHEET3D = ['#b4d0ef', '#b5dcc6', '#f0d995', '#d2c4f1'];
const SHEET3D_EXTRA = ['#f0c6bf', '#bfd5f1', '#d3e2b1'];
const sheetColor = (key) => (typeof key === 'number' ? SHEET3D[key % SHEET3D.length] : SHEET3D_EXTRA[(Number(String(key).slice(1)) || 0) % SHEET3D_EXTRA.length]);

// 끝면 무늬: 감긴 강판 결 (동심원)
function ringTexture(color) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const g = canvas.getContext('2d');
  g.fillStyle = color; g.fillRect(0, 0, size, size);
  g.strokeStyle = 'rgba(30, 41, 59, .13)';
  for (let r = size * 0.18; r < size * 0.5; r += 5) { g.lineWidth = 1; g.beginPath(); g.arc(size / 2, size / 2, r, 0, Math.PI * 2); g.stroke(); }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
// 판 더미 옆면: 얇은 판이 겹친 줄무늬
function layerTexture(color, height, tone) {
  const canvas = document.createElement('canvas');
  canvas.width = 8; canvas.height = 64;
  const g = canvas.getContext('2d');
  g.fillStyle = `#${new THREE.Color(color).multiplyScalar(tone).getHexString()}`; g.fillRect(0, 0, 8, 64);
  g.fillStyle = 'rgba(255, 255, 255, .55)';
  for (let y = 0; y < 64; y += 8) g.fillRect(0, y, 8, 1.5);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, Math.max(1, Math.round(height * 3)));
  return texture;
}
const label = (text, kind = '') => {
  const el = document.createElement('div');
  el.className = `${classes.gl3dLabel} ${kind === 'muted' ? classes.gl3dLabelMuted : ''}`;
  el.textContent = text;
  return new CSS2DObject(el);
};

// 코일: 원코일이 칼 자리에서 갈라져 롤들이 벌어지는 모양 (열 때 0.6초). 축 = 코일 폭 방향(x)
// 글자는 아래 치수선만 (2D 와 같은 '폭 × 롤 수 = 합 · 로스')
function buildCoil(group, plan, rawWidth) {
  const run = plan.runs?.[0] || {};
  const pieces = run.pieces || plan.pieces.filter((piece) => piece.cuts > 0);
  const used = run.used_width ?? plan.used_width;
  const remain = run.remain_width ?? plan.remain_width;
  const total = (used || 0) + (remain || 0) || Number(rawWidth) || 1;
  const order = plan.pieces.map((piece) => piece.width);
  const rolls = pieces.flatMap((piece) => Array.from({ length: piece.cuts }, () => ({ width: piece.width, color: piece.extra ? '#dfe5ec' : COIL3D[Math.max(0, order.indexOf(piece.width)) % COIL3D.length] })));
  if (remain > 0.001) rolls.push({ width: remain, loss: true, color: '#cfd6dc' });
  const R = 1.1;
  const r = 0.36;
  const gap = 0.1;
  const scale = Math.min(6.2 / total, 0.016);   // 좁은 코일이 파이프처럼 늘어나지 않게
  const packed = total * scale;                    // 갈라지기 전 (원코일)
  const length = packed + gap * (rolls.length - 1);
  const ringMat = new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9 });
  const circle = (radius) => new THREE.BufferGeometry().setFromPoints(Array.from({ length: 65 }, (_, i) => {
    const a = (i / 64) * Math.PI * 2;
    return new THREE.Vector3(0, Math.cos(a) * radius, Math.sin(a) * radius);
  }));
  const anims = [];
  const groupsOut = [];
  rolls.reduce((acc, roll, i) => {
    const w = Math.max(0.02, roll.width * scale);
    const finalX = -length / 2 + acc.spread + w / 2;
    const startX = -packed / 2 + acc.packed + w / 2;
    const color = roll.color;
    const body = new THREE.MeshStandardMaterial({ color, metalness: roll.loss ? 0.05 : 0.04, roughness: roll.loss ? 0.8 : 0.6, emissive: color, emissiveIntensity: roll.loss ? 0 : 0.3, transparent: Boolean(roll.loss), opacity: roll.loss ? 0.7 : 1 });
    const outer = new THREE.Mesh(new THREE.CylinderGeometry(R, R, w, 72, 1, true), body);
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 36, 1, true), new THREE.MeshStandardMaterial({ color: '#dfe5ec', side: THREE.BackSide, roughness: 0.7 }));
    const face = new THREE.MeshStandardMaterial({ map: roll.loss ? null : ringTexture(color), color: roll.loss ? color : '#ffffff', roughness: 0.55, metalness: 0.2, side: THREE.DoubleSide });
    const capA = new THREE.Mesh(new THREE.RingGeometry(r, R, 72), face);
    const capB = new THREE.Mesh(new THREE.RingGeometry(r, R, 72), face);
    capA.position.y = w / 2; capA.rotation.x = -Math.PI / 2;
    capB.position.y = -w / 2; capB.rotation.x = Math.PI / 2;
    const cyl = new THREE.Group();
    cyl.add(outer, inner, capA, capB);
    cyl.rotation.z = Math.PI / 2;   // 축을 x 방향으로
    const roller = new THREE.Group();
    roller.add(cyl);
    // 롤 양 끝 테두리 (또렷하게)
    [-w / 2, w / 2].forEach((dx) => {
      const ring = new THREE.Line(circle(R * 1.002), ringMat);
      ring.position.x = dx;
      roller.add(ring);
    });
    roller.position.x = startX;
    group.add(roller);
    anims.push({ apply: (d) => { roller.position.x = startX + (finalX - startX) * d; } });
    const last = groupsOut[groupsOut.length - 1];
    if (last && !roll.loss && !last.loss && last.width === roll.width) { last.count += 1; last.x1 = finalX + w / 2; }
    else groupsOut.push({ width: roll.width, loss: roll.loss, count: 1, x0: finalX - w / 2, x1: finalX + w / 2 });
    return { spread: acc.spread + w + gap, packed: acc.packed + w, i };
  }, { spread: 0, packed: 0 });
  // 아래: 2D 와 같은 치수선 (묶음별). 원코일 전체 폭은 그림 위 제목줄에 있어 3D 안에는 두지 않는다 (글자 줄이기)
  groupsOut.forEach((g) => {
    const text = g.loss ? `로스 ${fmt(g.width)}` : g.count > 1 ? `${fmt(g.width)} × ${g.count} = ${fmt(g.width * g.count)}` : fmt(g.width);
    dimLine(group, new THREE.Vector3(g.x0, -R, R), new THREE.Vector3(g.x1, -R, R), text, new THREE.Vector3(0, -0.18, 0.25));
  });
  return { size: Math.max(length, R * 2), floor: -R, anims };
}

// 남는 구간 빗금 (원판 윗면)
function hatchTexture(repeatX, repeatY) {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const g = canvas.getContext('2d');
  g.fillStyle = '#e6ebf0'; g.fillRect(0, 0, size, size);
  g.strokeStyle = '#ccd4dd'; g.lineWidth = 6;
  for (let i = -size; i < size * 2; i += 16) { g.beginPath(); g.moveTo(i, size); g.lineTo(i + size, 0); g.stroke(); }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping; texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  return texture;
}
// 도면식 치수선 (양 끝 눈금 + 가운데 글자)
function dimLine(group, from, to, text, offset) {
  const pts = [from.clone().add(offset), to.clone().add(offset)];
  const tick = offset.clone().normalize().multiplyScalar(0.12);
  const geo = new THREE.BufferGeometry().setFromPoints([
    pts[0], pts[1],
    pts[0].clone().sub(tick), pts[0].clone().add(tick),
    pts[1].clone().sub(tick), pts[1].clone().add(tick),
  ]);
  group.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#94a3b8' })));
  const tag = label(text, 'muted');
  tag.position.copy(pts[0].clone().add(pts[1]).multiplyScalar(0.5));
  group.add(tag);
}

// 시트: 강판 원판(남는 구간 빗금) 위에 절단 조각을 띄워 올림. x = 원판 길이, z = 원판 폭
function buildSheet(group, plan, rawWidth, rawLength, patIdx) {
  const pats = plan?.sheet_patterns || [];
  const sp = pats.length ? pats[Math.min(Math.max(0, patIdx || 0), pats.length - 1)] : null;
  if (!sp) return { size: 1, floor: 0, lift: [] };
  const normal = plan.orientation !== 'ROTATED';
  const scale = 7 / Math.max(rawLength, rawWidth);
  const L = rawLength * scale;
  const Wd = rawWidth * scale;
  const T = 0.1;
  const plateMats = [
    new THREE.MeshStandardMaterial({ color: '#c8d1db', metalness: 0.4, roughness: 0.4 }),   // 옆면 (강판 단면)
    new THREE.MeshStandardMaterial({ color: '#c8d1db', metalness: 0.4, roughness: 0.4 }),
    new THREE.MeshStandardMaterial({ map: hatchTexture(L * 2.2, Wd * 2.2), metalness: 0.1, roughness: 0.7 }),   // 윗면 = 남는 구간 빗금
    new THREE.MeshStandardMaterial({ color: '#9aa6b3' }),
    new THREE.MeshStandardMaterial({ color: '#c8d1db', metalness: 0.4, roughness: 0.4 }),
    new THREE.MeshStandardMaterial({ color: '#c8d1db', metalness: 0.4, roughness: 0.4 }),
  ];
  const plate = new THREE.Mesh(new THREE.BoxGeometry(L, T, Wd), plateMats);
  plate.position.y = -T / 2;
  group.add(plate);
  const plateEdges = new THREE.LineSegments(new THREE.EdgesGeometry(plate.geometry), new THREE.LineBasicMaterial({ color: '#8b97a5' }));
  plateEdges.position.copy(plate.position);
  group.add(plateEdges);
  const inset = Math.min(L, Wd) * 0.007;
  const lift = [];   // 떠오르는 움직임 대상 (조각 + 이름표)
  const labeled = new Set();   // 같은 규격은 이름표 한 번만 (글자가 많으면 오히려 안 읽힘)
  sp.columns.reduce((start, col) => {
    col.pieces.reduce((along, [key, len]) => {
      const u0 = (normal ? along : start) * scale;
      const v0 = (normal ? start : along) * scale;
      const du = (normal ? len : col.cw) * scale;
      const dv = (normal ? col.cw : len) * scale;
      const color = sheetColor(key);
      const geo = new THREE.BoxGeometry(Math.max(0.01, du - inset * 2), T * 0.85, Math.max(0.01, dv - inset * 2));
      const piece = new THREE.Group();
      // 윗면 = 2D 와 똑같은 색 (조명 영향 없음) · 옆면 = 조금 어둡게 (입체감)
      const side = new THREE.MeshLambertMaterial({ color: new THREE.Color(color).multiplyScalar(0.86) });
      piece.add(new THREE.Mesh(geo, [side, side, new THREE.MeshBasicMaterial({ color }), side, side, side]));
      piece.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85 })));
      piece.position.set(-L / 2 + u0 + du / 2, 0, -Wd / 2 + v0 + dv / 2);
      group.add(piece);
      // 조각 아래 옅은 그림자 (떠 있는 느낌)
      const shade = new THREE.Mesh(new THREE.PlaneGeometry(du - inset * 2, dv - inset * 2), new THREE.MeshBasicMaterial({ color: '#0f172a', transparent: true, opacity: 0.0 }));
      shade.rotation.x = -Math.PI / 2; shade.position.set(piece.position.x + 0.05, 0.002, piece.position.z + 0.05);
      group.add(shade);
      lift.push({ obj: piece, to: 0.2 + T * 0.85 / 2, from: T * 0.85 / 2, shade });
      const size = (plan.pieces || []).find((item) => item.key === key);
      if (!labeled.has(key) && du > 0.5 && dv > 0.3) {
        labeled.add(key);
        const full = size ? `${fmt(size.width)} × ${fmt(size.length)}` : `${fmt(col.cw)} × ${fmt(len)}`;
        const tag = label(du > 1.6 ? full : fmt(size ? size.length : len));
        tag.position.set(0, T * 0.85 / 2 + 0.02, 0);
        piece.add(tag);
      }
      return along + len;
    }, 0);
    return start + col.cw;
  }, 0);
  dimLine(group, new THREE.Vector3(-L / 2, 0, Wd / 2), new THREE.Vector3(L / 2, 0, Wd / 2), `원판 길이 ${fmt(rawLength)}mm`, new THREE.Vector3(0, 0, 0.55));
  dimLine(group, new THREE.Vector3(L / 2, 0, -Wd / 2), new THREE.Vector3(L / 2, 0, Wd / 2), `폭 ${fmt(rawWidth)}mm`, new THREE.Vector3(0.55, 0, 0));
  return { size: Math.max(L, Wd), floor: -T, lift };
}


// 코일 길이 절단: 왼쪽 코일(축 = z) + 오른쪽 규격별 시트 더미 (높이 = 매수 비례, 표시용)
function buildShear(group, plan) {
  const pieces = (plan.pieces || []).filter((piece) => (piece.produced_qty || 0) > 0);
  const R = 1.3;
  const coil = new THREE.Group();
  // 입체 보기처럼 밝게: 몸통 = 옅은 회청색 · 끝면 = 감긴 결(동심원)이 보이는 흰 회색 (조명에 어두워지지 않게)
  const body = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 1.3, 64, 1, true), new THREE.MeshLambertMaterial({ color: '#dde4ec', side: THREE.DoubleSide }));
  const face = new THREE.MeshBasicMaterial({ map: ringTexture('#f1f4f8'), side: THREE.DoubleSide });
  const capA = new THREE.Mesh(new THREE.RingGeometry(0.45, R, 64), face);
  const capB = new THREE.Mesh(new THREE.RingGeometry(0.45, R, 64), face);
  capA.position.y = 0.65; capA.rotation.x = -Math.PI / 2;
  capB.position.y = -0.65; capB.rotation.x = Math.PI / 2;
  coil.add(body, capA, capB);
  coil.rotation.x = Math.PI / 2;   // 축 = z (끝면이 앞)
  coil.position.set(-4.2, R, 0);
  group.add(coil);
  const strip = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.03, 1.25), new THREE.MeshLambertMaterial({ color: '#e3e9f0' }));
  strip.position.set(-2.4, 0.02, 0);
  group.add(strip);
  const coilTag = label(`코일 ${fmt(plan.total_m)}m · ${fmt(plan.coil_weight)}kg`);
  coilTag.position.set(-4.2, R * 2 + 0.4, 0);
  group.add(coilTag);
  const maxQty = Math.max(1, ...pieces.map((piece) => piece.produced_qty));
  const maxLen = Math.max(1, ...pieces.map((piece) => Number(piece.length) || 1));
  const startX = -0.6;
  const span = 6;
  const step = span / Math.max(1, pieces.length);
  pieces.forEach((piece, i) => {
    const len = 0.9 + ((Number(piece.length) || 0) / maxLen) * 0.9;
    const h = 0.25 + (piece.produced_qty / maxQty) * 1.6;
    const color = sheetColor(typeof piece.key === 'number' ? piece.key : i);
    const geo = new THREE.BoxGeometry(len, h, 1.2);
    // 윗면 = 시트 3D 와 같은 색 그대로 · 옆면 = 조금 어둡게 + 겹친 판 줄무늬 (입체 보기와 같은 느낌)
    const right = new THREE.MeshBasicMaterial({ map: layerTexture(color, h, 0.8) });
    const front = new THREE.MeshBasicMaterial({ map: layerTexture(color, h, 0.9) });
    const pile = new THREE.Mesh(geo, [right, right, new THREE.MeshBasicMaterial({ color }), right, front, front]);
    pile.position.set(startX + step * i + step / 2, h / 2, 0);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8 }));
    edges.position.copy(pile.position);
    group.add(pile, edges);
    const top = label(`${fmt(piece.produced_qty, 0)}매${piece.over_qty > 0 ? ` · ▲${fmt(piece.over_qty, 0)} 초과` : ''}`);
    top.position.set(pile.position.x, h + 0.35, 0);
    const name = label(`${fmt(piece.width)} × ${fmt(piece.length)}`, 'muted');
    name.position.set(pile.position.x, -0.25, 0.9);
    group.add(top, name);
  });
  return { size: 8.5, floor: 0, lift: [] };
}

// 지난 모형 정리 (GPU 메모리 돌려주기 + 이름표 HTML 지우기)
function disposeGroup(group) {
  group.traverse((obj) => {
    if (obj.isCSS2DObject) obj.element?.remove();
    obj.geometry?.dispose?.();
    const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
    mats.forEach((mat) => { mat.map?.dispose?.(); mat.dispose?.(); });
  });
  group.parent?.remove(group);
}
const HEIGHT = 340;
const homeOf = (kind, size) => (kind === 'COIL' ? new THREE.Vector3(-size * 0.42, size * 0.42, size * 1.12)
  : kind === 'SHEAR' ? new THREE.Vector3(-0.6, 4.8, 11.5) : new THREE.Vector3(size * 0.3, size * 0.78, size * 0.98));
const targetOf = (kind) => (kind === 'SHEAR' ? new THREE.Vector3(-0.2, 0.8, 0) : new THREE.Vector3(0, 0, 0));

// 그리기 장치(WebGL)는 한 번만 만들고, 계획(단독 ↔ 혼합 · 패턴)이 바뀌면 안의 모형만 바꿔 끼운다 → 바로 바뀜
export default function Viz3DGL({ material, plan, rawWidth, rawLength, patIdx = 0, active = true }) {
  const hostRef = useRef(null);
  const ctxRef = useRef(null);
  const resetRef = useRef(null);
  // ① 장치: 처음 한 번
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const width = host.clientWidth || 640;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, width / HEIGHT, 0.1, 200);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, HEIGHT);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);
    const labels = new CSS2DRenderer();
    labels.setSize(width, HEIGHT);
    labels.domElement.className = classes.gl3dLabels;
    host.appendChild(labels.domElement);
    scene.add(new THREE.HemisphereLight('#ffffff', '#94a3b8', 1.15));
    const sun = new THREE.DirectionalLight('#ffffff', 1.6);
    sun.position.set(4, 8, 6);
    const fill = new THREE.DirectionalLight('#dbeafe', 0.55);
    fill.position.set(-6, 3, -4);
    scene.add(sun, fill);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    // 그릴 때마다 겹치는 이름표는 숨긴다 (먼저 붙인 이름표 우선 · 돌려서 겹쳐도 깔끔하게)
    const declutter = () => {
      const shown = [];
      labels.domElement.querySelectorAll(`.${classes.gl3dLabel}`).forEach((el) => {
        el.style.visibility = '';
        if (el.style.display === 'none') return;
        const box = el.getBoundingClientRect();
        if (shown.some((b) => box.left < b.right + 4 && box.right > b.left - 4 && box.top < b.bottom + 2 && box.bottom > b.top - 2)) el.style.visibility = 'hidden';
        else shown.push(box);
      });
    };
    const render = () => { renderer.render(scene, camera); labels.render(scene, camera); declutter(); };
    controls.addEventListener('change', render);
    const ctx = { host, scene, camera, renderer, labels, controls, render, group: null, shadow: null, kind: '', home: null, target0: new THREE.Vector3(), anim: 0 };
    ctx.fit = (w) => ctx.home.clone().sub(ctx.target0).multiplyScalar(Math.max(1, (640 / HEIGHT) / (w / HEIGHT))).add(ctx.target0);
    ctxRef.current = ctx;
    resetRef.current = () => { if (!ctx.home) return; camera.position.copy(ctx.fit(host.clientWidth || width)); controls.target.copy(ctx.target0); controls.update(); render(); };
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      if (!w || !ctx.home) return;   // 숨겨져 있으면(2D 보는 중) 건너뜀
      camera.aspect = w / HEIGHT; camera.updateProjectionMatrix();
      if (camera.position.distanceTo(controls.target) < ctx.fit(w).distanceTo(ctx.target0) - 0.01) camera.position.copy(ctx.fit(w));
      renderer.setSize(w, HEIGHT); labels.setSize(w, HEIGHT); render();
    });
    ro.observe(host);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(ctx.anim);
      controls.dispose();
      if (ctx.group) disposeGroup(ctx.group);
      if (ctx.shadow) disposeGroup(ctx.shadow);
      renderer.dispose();
      renderer.forceContextLoss?.();
      host.replaceChildren();
      ctxRef.current = null;
      resetRef.current = null;
    };
  }, []);
  // ② 모형: 계획이 바뀔 때만 (장치는 그대로)
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx || !plan) return;
    cancelAnimationFrame(ctx.anim);
    if (ctx.group) disposeGroup(ctx.group);
    if (ctx.shadow) disposeGroup(ctx.shadow);
    const group = new THREE.Group();
    ctx.scene.add(group);
    const kind = material;
    const info = kind === 'COIL' ? buildCoil(group, plan, rawWidth) : kind === 'SHEAR' ? buildShear(group, plan) : buildSheet(group, plan, rawWidth, rawLength, patIdx);
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(info.size * 0.62, 48), new THREE.MeshBasicMaterial({ color: '#0f172a', transparent: true, opacity: 0.07 }));
    shadow.rotation.x = -Math.PI / 2; shadow.scale.set(1, 0.45, 1); shadow.position.y = info.floor - 0.02;
    ctx.scene.add(shadow);
    ctx.group = group; ctx.shadow = shadow;
    const { camera, controls, host } = ctx;
    controls.minDistance = info.size * 0.5;
    controls.maxDistance = info.size * 3;
    // 종류가 바뀔 때만 처음 각도로 (같은 종류에서 단독 ↔ 혼합 · 패턴만 바꾸면 보던 각도 그대로)
    if (ctx.kind !== kind) {
      ctx.kind = kind;
      ctx.home = homeOf(kind, info.size);
      ctx.target0 = targetOf(kind);
      camera.position.copy(ctx.fit(host.clientWidth || 640));
      controls.target.copy(ctx.target0);
    }
    controls.update();
    // 짧은 움직임 (끝나면 다시 그리지 않음): 시트 = 조각이 원판에서 떠오름 · 코일 = 원코일이 칼 자리에서 갈라짐
    const anims = [...(info.anims || []), ...(info.lift || []).map((item) => ({ apply: (d) => {
      item.obj.position.y = item.from + (item.to - item.from) * d;
      item.shade.material.opacity = 0.1 * d;
    } }))];
    if (!anims.length || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      anims.forEach((item) => item.apply(1));
      ctx.render();
      return;
    }
    anims.forEach((item) => item.apply(0));
    const t0 = performance.now();
    const duration = kind === 'COIL' ? 650 : 520;
    const step = (now) => {
      const k = Math.min(1, (now - t0) / duration);
      const e = 1 - (1 - k) ** 3;
      anims.forEach((item, i) => item.apply(kind === 'COIL' ? e : Math.min(1, Math.max(0, e * 1.15 - (i / Math.max(1, anims.length)) * 0.15))));
      ctx.render();
      if (k < 1) ctx.anim = requestAnimationFrame(step);
    };
    ctx.anim = requestAnimationFrame(step);
  }, [material, plan, rawWidth, rawLength, patIdx]);
  // 숨겨졌다가(2D · 입체) 다시 보일 때: 크기 맞추고 한 번 그리기
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!active || !ctx) return;
    const w = ctx.host.clientWidth;
    if (w) { ctx.camera.aspect = w / HEIGHT; ctx.camera.updateProjectionMatrix(); ctx.renderer.setSize(w, HEIGHT); ctx.labels.setSize(w, HEIGHT); }
    ctx.render();
  }, [active]);
  return <div className={classes.gl3dWrap}>
    <div ref={hostRef} className={classes.gl3dHost} role="img" aria-label="3D 배치 (마우스로 돌리기 · 휠로 확대)" />
    <div className={classes.gl3dBar}>
      <span>마우스 끌기 = 돌리기 · 휠 = 확대 · 오른쪽 끌기 = 옮기기 · 롤 지름 · 두께는 표시용</span>
      <button type="button" onClick={() => resetRef.current?.()}>처음 각도</button>
    </div>
  </div>;
}
