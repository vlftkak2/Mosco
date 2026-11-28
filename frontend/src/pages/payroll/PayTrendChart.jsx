// 월별 추이 막대 차트 (내 급여현황) — 1~12월, 한 가지 값(실지급액 · 지급액 · 공제)만 그린다 (계열 1개라 범례 없음, 제목이 이름).
// 막대: 위쪽만 4px 둥글게 · 막대 사이 간격 · 고른 달은 진하게. 마우스를 올리면 그달 지급 · 공제 · 실지급 풍선.
// 막대를 누르면 그달을 고른다 (onPick).
import { useEffect, useRef, useState } from 'react';
import pc from '../../styles/pages/Payroll.module.css';
import { won } from './payrollCommon';

const MIN_H = 200;   // 카드 높이에 맞춰 늘어난다 (아래 여백 없이)
const PAD = { top: 14, right: 12, bottom: 26, left: 52 };
const BAR = '#e0434b';

// 눈금: 0부터 깔끔한 단위 (만원 단위로 표시)
const niceStep = (max) => {
  const raw = max / 4;
  const power = 10 ** Math.floor(Math.log10(raw || 1));
  return [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw) || power * 10;
};
const manwon = (v) => (v === 0 ? '0' : `${Math.round(v / 10000).toLocaleString('ko-KR')}만`);

export default function PayTrendChart({ year, months, measure, measureLabel, picked, onPick }) {
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(560);
  const [H, setH] = useState(MIN_H);
  const [hover, setHover] = useState(null);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => {
      setWidth(Math.max(320, Math.floor(entry.contentRect.width)));
      setH(Math.max(MIN_H, Math.floor(entry.contentRect.height)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const values = months.map((m) => (m ? Number(m[measure] || 0) : 0));
  const max = Math.max(...values, 0);
  const step = niceStep(max || 1_000_000);
  const top = Math.max(step, Math.ceil(max / step) * step);
  const plotW = width - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const slot = plotW / 12;
  const barW = Math.min(36, slot - 6);
  const y = (v) => PAD.top + plotH - (Math.max(0, v) / top) * plotH;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);

  const tip = hover != null && months[hover] ? months[hover] : null;
  const tipLeft = hover != null ? Math.min(Math.max(PAD.left + slot * hover + slot / 2, 90), width - 90) : 0;

  return <div ref={wrapRef} className={pc.chartWrap}>
    <svg className={pc.chartSvg} width={width} height={H} role="img" aria-label={`${year}년 월별 ${measureLabel}`}>
      {ticks.map((t) => <g key={t}>
        <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? '#c9ced6' : '#eef0f3'} strokeWidth="1" />
        <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" className={pc.chartAxis}>{manwon(t)}</text>
      </g>)}
      {values.map((v, i) => {
        const x = PAD.left + slot * i + (slot - barW) / 2;
        const has = Boolean(months[i]);
        const h = Math.max(0, y(0) - y(v));
        const r = Math.min(4, h);
        const on = picked === i;
        return <g key={i}>
          {has && h > 0 && <path
            d={`M${x},${y(0)} V${y(v) + r} Q${x},${y(v)} ${x + r},${y(v)} H${x + barW - r} Q${x + barW},${y(v)} ${x + barW},${y(v) + r} V${y(0)} Z`}
            fill={BAR} opacity={picked == null || on ? 1 : 0.42} />}
          <text x={PAD.left + slot * i + slot / 2} y={H - 8} textAnchor="middle" className={`${pc.chartAxis} ${on ? pc.chartAxisOn : ''}`}>{i + 1}월</text>
          {/* 누르기 · 올리기 영역은 막대보다 넓게 (칸 전체) */}
          <rect x={PAD.left + slot * i} y={PAD.top} width={slot} height={plotH + 4} fill="transparent" style={{ cursor: has ? 'pointer' : 'default' }}
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => has && onPick(i)} />
        </g>;
      })}
    </svg>
    {tip && <div className={pc.chartTip} style={{ left: tipLeft, top: Math.max(4, y(values[hover]) - 78) }}>
      <b>{year}년 {hover + 1}월</b>
      <span><i>지급</i>{won(tip.pay_total)}원</span>
      <span><i>공제</i>{won(tip.ded_total)}원</span>
      <span className={pc.chartTipNet}><i>실지급</i>{won(tip.net_pay)}원</span>
    </div>}
    {hover != null && !months[hover] && <div className={pc.chartTip} style={{ left: tipLeft, top: PAD.top + plotH / 2 - 20 }}><b>{year}년 {hover + 1}월</b><span>급여 없음</span></div>}
  </div>;
}
