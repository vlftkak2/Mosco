// 가공 최적화 입체 보기 (라이브러리 없이 SVG). 2D 그림과 같은 계산 결과(plan)를 비스듬한 입체로 그린다.
//  - 코일: 폭별로 잘린 롤(원통)을 칼 순서대로 나란히. 끝 로스(기본 로스 + 잔여폭)는 빗금 롤.
//  - 시트: 원판 위에 잘린 제품 조각을 살짝 띄워 올린 모양. 남는 구간은 원판 빗금.
//  - 두께 · 롤 지름은 실제 비율로 그리면 보이지 않아 '표시용'으로 과장해 그린다 (치수 숫자는 모두 실제 값).
import { useId, useState } from 'react';
import classes from '../../styles/pages/AIOrderOptimization.module.css';

const fmt = (value, digits = 1) => (value === null || value === undefined || value === '' ? '-'
  : Number(value).toLocaleString('ko-KR', { maximumFractionDigits: digits }));
// 색 어둡게 (옆면 · 앞면 그늘)
const shade = (hex, amount) => {
  const n = parseInt(String(hex).replace('#', ''), 16);
  const ch = (shift) => Math.max(0, Math.round(((n >> shift) & 255) * (1 - amount)));
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
};
const COIL_COLORS = ['#b6d1ee', '#b5ddc7', '#f1da9c', '#d4c6f1'];   // 입체: 투명해 보이지 않게 2D 보다 한 톤 진한 파스텔
const COIL_EXTRA = '#eef1f4';
const INK = '#1f3550';   // 시트 조각 안 글자 (파스텔 바탕 위라 테마와 관계없이 진하게)

// [2D | 입체] 전환 (이 브라우저에 기억)
const VIEW_KEY = 'steel119-opt-view';
export function useVizView() {
  const [view, setView] = useState(() => { try { const saved = localStorage.getItem(VIEW_KEY); return saved === 'iso' || saved === '3d' ? saved : '2d'; } catch { return '2d'; } });
  const change = (next) => { setView(next); try { localStorage.setItem(VIEW_KEY, next); } catch { /* 기억 못 해도 지금은 바뀜 */ } };
  return [view, change];
}
export function VizSwitch({ view, onChange, onWarm3D }) {
  return <div className={classes.vizSwitch} role="tablist" aria-label="배치 보기 방식">
    {[['2d', '2D'], ['iso', '입체'], ['3d', '3D']].map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={view === key}
      className={view === key ? classes.vizSwitchOn : ''} onClick={() => onChange(key)}
      onMouseEnter={key === '3d' ? onWarm3D : undefined} onFocus={key === '3d' ? onWarm3D : undefined}>{label}</button>)}
  </div>;
}

// ── 코일: 폭별 롤 ─────────────────────────────────────────────────────────────
export function CoilIso({ plan, rawWidth }) {
  const hatchId = `coilIsoHatch${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  if (!plan) return null;
  const order = plan.pieces.map((piece) => piece.width);
  const colorOf = (piece) => (piece.extra ? COIL_EXTRA : COIL_COLORS[Math.max(0, order.indexOf(piece.width)) % COIL_COLORS.length]);
  const runs = (plan.runs?.length ? plan.runs : [{ weight: plan.input_weight }]).map((run) => ({
    ...run,
    pieces: run.pieces || plan.pieces.filter((piece) => piece.cuts > 0),
    used: run.used_width ?? plan.used_width,
    remain: run.remain_width ?? plan.remain_width,
  }));
  return <div className={classes.isoWrap}>
    {runs.map((run, index) => <CoilRun key={index} run={run} index={index} count={runs.length} rawWidth={rawWidth} colorOf={colorOf} hatchId={`${hatchId}r${index}`} />)}
    <p className={classes.isoNote}>입체 보기 · 롤 지름은 표시용 · 폭 치수(mm)는 실제 값 · 빨간 점선 = 칼 자리 · 빗금 롤 = 기본 로스 + 잔여폭</p>
  </div>;
}

// 글자 폭 어림 (12.5px 굵은 글씨: 한글 12.6px · 숫자/영문 7.4px)
const textWidth = (text) => [...String(text)].reduce((sum, ch) => sum + (/[가-힣]/.test(ch) ? 12.6 : ch === ' ' ? 3.6 : 7.4), 0);

// 차수 하나 (처음 보는 사람도 바로 알게): 위 = 원코일 한 덩어리 + 칼 위치 → 가운데 = '칼 N개로 슬리팅' →
// 아래 = 같은 자리에서 갈라진 롤들. 글자는 2D 그림과 같은 치수선 방식 (위 = 원코일 전체, 아래 = 폭 × 롤 수 = 합)
function CoilRun({ run, index, count, rawWidth, colorOf, hatchId }) {
  const total = (run.used || 0) + (run.remain || 0) || Number(rawWidth) || 1;
  const rolls = run.pieces.flatMap((piece) => Array.from({ length: piece.cuts }, () => ({ width: piece.width, color: colorOf(piece) })));
  if (run.remain > 0.001) rolls.push({ width: run.remain, loss: true });
  const knives = run.pieces.reduce((sum, piece) => sum + piece.cuts, 0);
  const W = 680;
  const R = 44;            // 롤 반지름 (표시용)
  const ex = R * 0.4;      // 끝면 타원 가로 반지름 (비스듬히 본 정도)
  const gap = 8;           // 잘린 롤 사이
  const usable = W - 2 * (28 + ex) - gap * (rolls.length - 1);
  const scale = Math.min(usable / total, 0.9);   // 좁은 코일이 파이프처럼 늘어나지 않게 상한 · 가운데 정렬
  const drawn = total * scale + gap * (rolls.length - 1);
  const left = (W - drawn) / 2 + ex / 2;
  const shapes = rolls.reduce((list, roll, i) => {
    const prev = list[list.length - 1];
    const x0 = prev ? prev.x0 + prev.w + gap : left;
    return [...list, { i, x0, w: Math.max(2.5, roll.width * scale), roll }];
  }, []);
  const lastShape = shapes[shapes.length - 1];
  const right = lastShape ? lastShape.x0 + lastShape.w : left;
  // 같은 폭 연속 = 한 묶음 (아래 치수 구간)
  const groups = [];
  shapes.forEach((shape) => {
    const last = groups[groups.length - 1];
    if (last && !shape.roll.loss && !last.loss && last.width === shape.roll.width) { last.count += 1; last.x1 = shape.x0 + shape.w; }
    else groups.push({ width: shape.roll.width, loss: shape.roll.loss, color: shape.roll.color, count: 1, x0: shape.x0, x1: shape.x0 + shape.w });
  });
  // 세로 배치
  const topDimY = 26;                 // 원코일 전체 치수선
  const motherCy = topDimY + 22 + R;  // 원코일
  const arrowY = motherCy + R + 30;   // 슬리팅 화살표
  const slitCy = arrowY + 30 + R;     // 잘린 롤
  const groupDimY = slitCy + R + 22;  // 묶음 치수선
  const H = groupDimY + 44;
  const cutXs = shapes.slice(0, -1).map((s) => s.x0 + s.w + gap / 2);   // 원코일 위 칼 자리 (롤 사이 가운데)
  const roll3d = (s, cy, key, body) => {
    const c = s.roll.color;
    return <g key={key}>
      <rect x={s.x0} y={cy - R} width={s.w} height={R * 2} fill={body} />
      <path d={`M ${s.x0 + s.w} ${cy - R} A ${ex} ${R} 0 0 1 ${s.x0 + s.w} ${cy + R}`} fill={s.roll.loss ? '#cfd6dc' : shade(c, 0.14)} />
      <ellipse cx={s.x0} cy={cy} rx={ex} ry={R} fill={s.roll.loss ? '#e8ecf0' : shade(c, 0.02)} stroke="#ffffff" strokeWidth="1.2" />
      {!s.roll.loss && [0.86, 0.72, 0.58].map((k) => <ellipse key={k} cx={s.x0} cy={cy} rx={ex * k} ry={R * k} fill="none" stroke={shade(c, 0.08)} strokeWidth="0.7" />)}
      <ellipse cx={s.x0} cy={cy} rx={ex * 0.36} ry={R * 0.36} fill={s.roll.loss ? '#d5dbe1' : `url(#${hatchId}-bore)`} stroke={s.roll.loss ? '#b8c1ca' : shade(c, 0.18)} strokeWidth="1" />
    </g>;
  };
  const dimTicks = (x0, x1, y) => <>
    <line x1={x0} y1={y} x2={x1} y2={y} className={classes.isoDimLine} />
    <line x1={x0} y1={y - 5} x2={x0} y2={y + 5} className={classes.isoDimLine} />
    <line x1={x1} y1={y - 5} x2={x1} y2={y + 5} className={classes.isoDimLine} />
  </>;
  return <div className={classes.isoRun}>
    <div className={classes.cvRunHead}><b>{run.label || (count > 1 ? `${index + 1}차 가공` : '가공')}</b>
      <span>투입 {fmt(run.weight)}kg · {knives}칼</span></div>
    <svg className={classes.isoSvg} viewBox={`0 0 ${W} ${H}`} role="img"
      aria-label={`원코일 ${fmt(total)}mm 를 칼 ${knives}개로 슬리팅: ${run.pieces.map((piece) => `${piece.width}mm ${piece.cuts}롤`).join(', ')}${run.remain > 0.001 ? `, 로스 ${fmt(run.remain)}mm` : ''}`}>
      <defs>
        <pattern id={hatchId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#e8ecf0" /><rect width="2" height="6" fill="#cfd6dc" /></pattern>
        {shapes.filter((s) => !s.roll.loss).map((s) => <linearGradient key={s.i} id={`${hatchId}-g${s.i}`} x1="0" y1="0" x2="0" y2="1">
          {/* 무광 파스텔 (시트 입체처럼): 광택 없이 색 그대로 · 아래쪽만 살짝 어둡게 */}
          <stop offset="0" stopColor={s.roll.color} /><stop offset="0.6" stopColor={s.roll.color} />
          <stop offset="1" stopColor={shade(s.roll.color, 0.1)} />
        </linearGradient>)}
        <linearGradient id={`${hatchId}-mother`} x1="0" y1="0" x2="0" y2="1">
          {/* 원코일: 꽉 찬 무광 파스텔 회청색 (광택 없음) */}
          <stop offset="0" stopColor="#c9d7e6" /><stop offset="0.6" stopColor="#c9d7e6" /><stop offset="1" stopColor="#b3c3d6" />
        </linearGradient>
        <radialGradient id={`${hatchId}-bore`} cx="0.6" cy="0.55" r="0.6"><stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor="#dfe5ec" /></radialGradient>
      </defs>

      {/* ① 위: 원코일 전체 치수 */}
      {dimTicks(left, right, topDimY)}
      <text x={(left + right) / 2} y={topDimY - 8} textAnchor="middle" fontSize="13" fontWeight="800" className={classes.isoDim}>원코일 {fmt(total)}mm
        <tspan fontSize="12" fontWeight="600" className={classes.isoDimMuted}>{`  ·  투입 ${fmt(run.weight)}kg`}</tspan></text>

      {/* ② 원코일 한 덩어리 + 칼 자리 */}
      <ellipse cx={(left + right) / 2} cy={motherCy + R + 6} rx={(right - left) / 2 + ex} ry="5" fill="#0f172a" opacity="0.07" />
      {roll3d({ x0: left, w: right - left, roll: { color: '#c9d7e6' } }, motherCy, 'mother', `url(#${hatchId}-mother)`)}
      {cutXs.map((cx, i) => <g key={`cut${i}`}>
        <line x1={cx} y1={motherCy - R + 2} x2={cx} y2={motherCy + R - 2} stroke="#f08a90" strokeWidth="1.2" strokeDasharray="3 3" opacity="0.75" />
        <path d={`M ${cx - 4} ${motherCy - R - 9} L ${cx + 4} ${motherCy - R - 9} L ${cx} ${motherCy - R - 2} Z`} fill="#f07b82" />
      </g>)}

      {/* ③ 슬리팅 화살표 */}
      <g>
        <line x1={W / 2} y1={arrowY - 18} x2={W / 2} y2={arrowY + 14} stroke="#cbd5e1" strokeWidth="1.5" />
        <path d={`M ${W / 2 - 5} ${arrowY + 9} L ${W / 2 + 5} ${arrowY + 9} L ${W / 2} ${arrowY + 17} Z`} fill="#cbd5e1" />
        <rect x={W / 2 - 74} y={arrowY - 12} width="148" height="24" rx="12" className={classes.isoChip} />
        <text x={W / 2} y={arrowY + 4.5} textAnchor="middle" fontSize="12.5" fontWeight="800" fill="#e0434b">칼 {knives}개로 슬리팅</text>
      </g>

      {/* ④ 같은 자리에서 갈라진 롤들 (오른쪽부터 그려 왼쪽 끝면이 위에 오게) */}
      <ellipse cx={(left + right) / 2} cy={slitCy + R + 6} rx={(right - left) / 2 + ex} ry="5" fill="#0f172a" opacity="0.08" />
      {[...shapes].reverse().map((s) => roll3d(s, slitCy, s.i, s.roll.loss ? `url(#${hatchId})` : `url(#${hatchId}-g${s.i})`))}

      {/* ⑤ 아래: 묶음 치수 (2D 와 같은 글자: 폭 × 롤 수 = 합) */}
      {groups.map((g, i) => {
        const text = g.loss ? `로스 ${fmt(g.width)}` : g.count > 1 ? `${fmt(g.width)} × ${g.count} = ${fmt(g.width * g.count)}` : fmt(g.width);
        const cx = (g.x0 + g.x1) / 2 + ex * 0.2;
        const narrow = textWidth(text) > g.x1 - g.x0 + 8;
        return <g key={`dim${i}`}>
          {dimTicks(g.x0 + ex * 0.2, g.x1 + ex * 0.2, groupDimY)}
          <text x={narrow && i === groups.length - 1 ? g.x1 + ex * 0.2 : cx} y={groupDimY + 18} textAnchor={narrow && i === groups.length - 1 ? 'end' : 'middle'}
            fontSize="12.5" fontWeight="700" className={g.loss ? classes.isoDimMuted : classes.isoDim}>{text}</text>
        </g>;
      })}
    </svg>
  </div>;
}

// ── 시트: 원판 위 절단 조각 ─────────────────────────────────────────────────────
const SHEET_COLORS = ['#cfe3f5', '#cfe9dd', '#f7e7bb', '#e6dbf6'];
const SHEET_EXTRA_COLORS = ['#f6d7d2', '#d4e4f7', '#e2ecc9'];
const sheetColor = (key) => (typeof key === 'number' ? SHEET_COLORS[key % SHEET_COLORS.length]
  : SHEET_EXTRA_COLORS[(Number(String(key).slice(1)) || 0) % SHEET_EXTRA_COLORS.length]);

export function SheetIso({ plan, rawWidth, rawLength, patIdx = 0, onPattern }) {
  const hatchId = `sheetIsoHatch${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const pats = plan?.sheet_patterns || [];
  const sp = pats.length ? pats[Math.min(Math.max(0, patIdx || 0), pats.length - 1)] : null;
  if (!sp || !rawWidth || !rawLength) return null;
  const index = pats.indexOf(sp);
  const normal = plan.orientation !== 'ROTATED';
  // 원판 좌표 (mm): u = 길이 방향(오른쪽), v = 폭 방향(뒤쪽으로 비스듬히)
  const pieces = [];
  sp.columns.reduce((start, col) => {
    col.pieces.reduce((along, [key, len]) => {
      const u0 = normal ? along : start;
      const v0 = normal ? start : along;
      const du = normal ? len : col.cw;
      const dv = normal ? col.cw : len;
      const size = (plan.pieces || []).find((item) => item.key === key);
      pieces.push({ key, u0, v0, du, dv, label: size ? `${fmt(size.width)} × ${fmt(size.length)}` : `${fmt(col.cw)} × ${fmt(len)}`, short: fmt(size ? size.length : len) });
      return along + len;
    }, 0);
    return start + col.cw;
  }, 0);
  // 투영: 길이 방향은 그대로, 폭 방향은 위-오른쪽으로 비스듬히 (깊이 비율 k)
  const W = 660;
  const k = 0.5;
  const c = Math.cos(Math.PI / 6) * k;
  const s = Math.sin(Math.PI / 6) * k;
  const T = 9;      // 원판 두께 (표시용 과장)
  const lift = 7;   // 조각을 원판 위로 띄운 높이 (잘린 모양)
  const scale = Math.min((W - 40) / (rawLength + rawWidth * c), 230 / (rawWidth * s + 1));
  const ox = 20;
  const oy = 16 + rawWidth * s * scale + lift;
  const P = (u, v, h = 0) => [ox + (u + v * c) * scale, oy - v * s * scale - h];
  const poly = (pts) => pts.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
  const H = Math.ceil(oy + T + 30);
  // 판 (위 · 앞 · 오른쪽 면)
  const plate = {
    top: poly([P(0, 0), P(rawLength, 0), P(rawLength, rawWidth), P(0, rawWidth)]),
    front: poly([P(0, 0), P(rawLength, 0), P(rawLength, 0, -T), P(0, 0, -T)]),
    right: poly([P(rawLength, 0), P(rawLength, rawWidth), P(rawLength, rawWidth, -T), P(rawLength, 0, -T)]),
  };
  // 조각: 조금씩 안쪽으로 줄여 틈을 보이게. 뒤(폭 큰 쪽) → 앞, 왼쪽 → 오른쪽 순서로 그려 겹침이 맞게
  const inset = Math.min(rawLength, rawWidth) * 0.006;
  const blocks = [...pieces].sort((a, b) => (b.v0 - a.v0) || (a.u0 - b.u0)).map((pc, i) => {
    const u0 = pc.u0 + inset; const u1 = pc.u0 + pc.du - inset;
    const v0 = pc.v0 + inset; const v1 = pc.v0 + pc.dv - inset;
    const color = sheetColor(pc.key);
    const top = poly([P(u0, v0, lift), P(u1, v0, lift), P(u1, v1, lift), P(u0, v1, lift)]);
    const front = poly([P(u0, v0, lift), P(u1, v0, lift), P(u1, v0, lift - T * 0.7), P(u0, v0, lift - T * 0.7)]);
    const right = poly([P(u1, v0, lift), P(u1, v1, lift), P(u1, v1, lift - T * 0.7), P(u1, v0, lift - T * 0.7)]);
    const [cx, cy] = P((u0 + u1) / 2, (v0 + v1) / 2, lift);
    const wPx = (u1 - u0) * scale;
    const hPx = (v1 - v0) * s * scale;
    const text = wPx >= pc.label.length * 6.4 + 8 && hPx >= 13 ? pc.label : wPx >= pc.short.length * 6.4 + 6 && hPx >= 13 ? pc.short : '';
    return <g key={i}>
      <polygon points={front} fill={shade(color, 0.22)} />
      <polygon points={right} fill={shade(color, 0.32)} />
      <polygon points={top} fill={color} stroke="#ffffff" strokeWidth="0.8" />
      {text && <text x={cx} y={cy + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill={INK}>{text}</text>}
    </g>;
  });
  const perTotal = pieces.length;
  return <div className={classes.isoWrap}>
    <div className={classes.sheetMeta}>원판 {fmt(rawWidth)} × {fmt(rawLength)}mm · 원판 1장당 제품 {perTotal}장 · {normal ? '기본 방향' : '90도 회전'}</div>
    {pats.length > 1 && onPattern && <div className={classes.patTabs}>{pats.map((item, i) => <button key={i} type="button" className={`${classes.patTab} ${i === index ? classes.patTabOn : ''}`}
      onClick={() => onPattern?.(i)}>패턴 {i + 1}{plan.pattern_lengths?.[i] ? ` · ${fmt(plan.pattern_lengths[i])}` : ''} · {fmt(item.sheets, 0)}매</button>)}</div>}
    <svg className={classes.isoSvg} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`원판 입체: ${pieces.map((pc) => pc.label).join(', ')}`}>
      <defs><pattern id={hatchId} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="#e5e9ed" /><rect width="2" height="7" fill="#cfd6dc" /></pattern></defs>
      <polygon points={poly([P(0, 0, -T - 4), P(rawLength, 0, -T - 4), P(rawLength, rawWidth, -T - 4), P(0, rawWidth, -T - 4)])} fill="#0f172a" opacity="0.05" />
      <polygon points={plate.front} fill="#c9d1da" />
      <polygon points={plate.right} fill="#b8c1ca" />
      <polygon points={plate.top} fill={`url(#${hatchId})`} stroke="#c5d1df" strokeWidth="1" />
      {blocks}
      {/* 치수: 앞 모서리 = 원판 길이, 오른쪽 모서리 = 원판 폭 */}
      {(() => {
        const [ax, ay] = P(0, 0, -T); const [bx] = P(rawLength, 0, -T);
        const [rx, ry] = P(rawLength, 0, -T); const [qx, qy] = P(rawLength, rawWidth, -T);
        return <>
          <text x={(ax + bx) / 2} y={ay + 18} textAnchor="middle" fontSize="11.5" fontWeight="700" className={classes.isoDimMuted}>원판 길이 {fmt(rawLength)}</text>
          <text x={(rx + qx) / 2 + 10} y={(ry + qy) / 2 + 4} fontSize="11.5" fontWeight="700" className={classes.isoDimMuted}>폭 {fmt(rawWidth)}</text>
        </>;
      })()}
    </svg>
    <p className={classes.isoNote}>입체 보기 · 두께는 표시용 · 조각 숫자는 제품 폭 × 길이(mm) · 빗금 = 남는 구간 · {pats.length > 1 ? `패턴 ${index + 1}/${pats.length} : 원판 ${fmt(sp.sheets, 0)}매` : `원판 ${fmt(sp.sheets, 0)}매 모두 동일 패턴`}</p>
  </div>;
}

// ── 코일 길이 절단 (시트 주문을 코일 재고에서): 코일을 풀어 → 길이대로 잘라 → 규격별 시트 더미 ─────────────
const SHEAR_COLORS = ['#cfe3f5', '#cfe9dd', '#f7e7bb', '#e6dbf6'];
const shearColor = (key) => (typeof key === 'number' ? SHEAR_COLORS[key % SHEAR_COLORS.length] : '#f6d7d2');
export function CoilShearIso({ plan }) {
  const gid = `shearIso${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const pieces = (plan?.pieces || []).filter((piece) => (piece.produced_qty || 0) > 0);
  if (!pieces.length) return null;
  const W = 680;
  const H = 250;
  // 왼쪽: 코일 (축 = 화면 안쪽, 끝면이 보이게)
  const R = 58;
  const cx = 92;
  const cy = 128;
  // 오른쪽: 규격별 시트 더미 (높이 = 매수에 비례, 너무 크거나 작지 않게)
  const maxQty = Math.max(...pieces.map((piece) => piece.produced_qty));
  const maxLen = Math.max(...pieces.map((piece) => Number(piece.length) || 1));
  const area0 = 236;
  const slot = (W - area0 - 20) / pieces.length;
  const piles = pieces.map((piece, i) => {
    const bw = Math.min(slot - 46, 70 + ((Number(piece.length) || 0) / maxLen) * 60);
    const depth = 26;
    const h = 14 + (piece.produced_qty / maxQty) * 70;
    const x = area0 + slot * i + (slot - bw - depth) / 2;
    const base = 186;
    return { piece, bw, depth, h, x, base, color: shearColor(piece.extra ? `x${i}` : piece.key) };
  });
  return <div className={classes.isoWrap}>
    <svg className={classes.isoSvg} viewBox={`0 0 ${W} ${H}`} role="img"
      aria-label={`코일 ${fmt(plan.total_m)}m 를 풀어 길이로 절단: ${pieces.map((piece) => `${fmt(piece.width)}×${fmt(piece.length)} ${fmt(piece.produced_qty, 0)}매`).join(', ')}`}>
      <defs>
        <linearGradient id={`${gid}-body`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#8a97a8" /><stop offset="0.3" stopColor="#dfe5ec" /><stop offset="0.5" stopColor="#ffffff" /><stop offset="0.8" stopColor="#b5c0cc" /><stop offset="1" stopColor="#8a97a8" />
        </linearGradient>
        <radialGradient id={`${gid}-bore`} cx="0.6" cy="0.55" r="0.6"><stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor="#dfe5ec" /></radialGradient>
      </defs>
      {/* 코일 + 풀려 나가는 띠 */}
      <ellipse cx={cx + 6} cy={cy + R + 8} rx={R + 10} ry="6" fill="#0f172a" opacity="0.07" />
      <path d={`M ${cx} ${cy + R} L ${area0 - 14} ${cy + R + 4} L ${area0 - 14} ${cy + R + 9} L ${cx} ${cy + R + 5} Z`} fill="#c9d2dc" />
      <rect x={cx - R * 0.42} y={cy - R} width={R * 0.42} height={R * 2} fill={`url(#${gid}-body)`} />
      <ellipse cx={cx} cy={cy} rx={R * 0.42} ry={R} fill="#cdd5de" />
      <ellipse cx={cx - R * 0.42} cy={cy} rx={R * 0.42} ry={R} fill="#e3e8ee" stroke="#ffffff" strokeWidth="1.2" />
      {[0.84, 0.68, 0.52].map((k) => <ellipse key={k} cx={cx - R * 0.42} cy={cy} rx={R * 0.42 * k} ry={R * k} fill="none" stroke="#b8c2cd" strokeWidth="0.7" />)}
      <ellipse cx={cx - R * 0.42} cy={cy} rx={R * 0.42 * 0.36} ry={R * 0.36} fill={`url(#${gid}-bore)`} stroke="#9aa6b3" strokeWidth="1" />
      <text x={cx - 8} y={cy - R - 26} textAnchor="middle" fontSize="13" fontWeight="800" className={classes.isoDim}>코일 {fmt(plan.total_m)}m</text>
      <text x={cx - 8} y={cy - R - 10} textAnchor="middle" fontSize="12" fontWeight="600" className={classes.isoDimMuted}>{fmt(plan.coil_weight)}kg</text>
      {/* 화살표 */}
      <rect x={area0 - 92} y={cy - 40} width="84" height="24" rx="12" className={classes.isoChip} />
      <text x={area0 - 50} y={cy - 23.5} textAnchor="middle" fontSize="12" fontWeight="800" fill="#e0434b">풀어서 절단</text>
      <path d={`M ${area0 - 30} ${cy - 4} L ${area0 - 14} ${cy - 4}`} stroke="#cbd5e1" strokeWidth="1.5" />
      <path d={`M ${area0 - 16} ${cy - 9} L ${area0 - 8} ${cy - 4} L ${area0 - 16} ${cy + 1} Z`} fill="#cbd5e1" />
      {/* 규격별 시트 더미 */}
      {piles.map(({ piece, bw, depth, h, x, base, color }, i) => {
        const top = base - h;
        const over = piece.over_qty > 0;
        return <g key={i}>
          <ellipse cx={x + (bw + depth) / 2} cy={base + 6} rx={(bw + depth) / 2 + 4} ry="5" fill="#0f172a" opacity="0.07" />
          <polygon points={`${x},${base} ${x + bw},${base} ${x + bw},${top} ${x},${top}`} fill={shade(color, 0.12)} />
          <polygon points={`${x + bw},${base} ${x + bw + depth},${base - depth * 0.5} ${x + bw + depth},${top - depth * 0.5} ${x + bw},${top}`} fill={shade(color, 0.26)} />
          <polygon points={`${x},${top} ${x + bw},${top} ${x + bw + depth},${top - depth * 0.5} ${x + depth},${top - depth * 0.5}`} fill={color} stroke="#ffffff" strokeWidth="1" />
          {/* 쌓인 결 */}
          {Array.from({ length: Math.min(8, Math.floor(h / 9)) }, (_, k) => <line key={k} x1={x} y1={base - (k + 1) * (h / (Math.min(8, Math.floor(h / 9)) + 1))} x2={x + bw} y2={base - (k + 1) * (h / (Math.min(8, Math.floor(h / 9)) + 1))} stroke="#ffffff" strokeOpacity="0.55" strokeWidth="1" />)}
          <text x={x + (bw + depth) / 2} y={top - depth * 0.5 - 12} textAnchor="middle" fontSize="13" fontWeight="800" className={classes.isoDim}>{fmt(piece.produced_qty, 0)}매</text>
          <text x={x + bw / 2} y={base + 24} textAnchor="middle" fontSize="12.5" fontWeight="700" className={classes.isoDim}>{fmt(piece.width)} × {fmt(piece.length)}</text>
          <text x={x + bw / 2} y={base + 40} textAnchor="middle" fontSize="11.5" fontWeight="600" className={over ? classes.isoOver : classes.isoDimMuted}>
            {over ? `발주 ${fmt(piece.need_qty, 0)} · ▲${fmt(piece.over_qty, 0)}매 초과` : piece.extra ? '가공 후보' : `발주 ${fmt(piece.need_qty, 0)}매`}</text>
        </g>;
      })}
    </svg>
    <p className={classes.isoNote}>입체 보기 · 코일을 풀어 발주 순서대로 길이로 자른 결과 · 더미 높이는 매수에 비례(표시용){plan.keep_m > 0 ? ` · 남는 코일 ${fmt(plan.keep_m)}m 보관` : ''}</p>
  </div>;
}
