import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Panel } from './Panels';
import { reduceMotion } from '../hooks';

// ERP 기능 소개 — 5초마다 다음 탭으로 넘어간다 (마우스를 올리면 멈춤). 홈과 AI ERP 페이지에서 같이 쓴다.
const DATA = [
  { k: '01 / Dashboard', t: ['오늘의 철강 업무,', '한 화면에서.'], p: '매출·매입·매출이익·미수금을 전월 같은 기간과 비교하고, 월별 이익 추이와 장기재고까지 한눈에 확인합니다.', l: ['전월 동기간 대비 증감 자동 비교', '월별 매출 · 이익 누적 차트', '입고 경과 기간별 장기재고 현황'], panel: 'dashboard', url: 'steel119-erp / dashboard' },
  { k: '02 / AI Order', t: ['주문서 한 장을', 'AI가 읽습니다.'], p: '발주서를 올리면 원본 옆에 AI 추출 결과가 바로 나옵니다. 발주처·납기·납품장소와 품명·강종·두께·폭·길이·수량·중량을 뽑아 주문서관리로 넘깁니다.', l: ['스캔 기울기 자동 보정 · 품목표 확대 인식', '원본 대조로 근거 위치 검증 · 확인 필요 표시', '주문별 현재고 후보 매칭 · 연결 재고 보호'], panel: 'ai', url: 'steel119-erp / ai-order' },
  { k: '03 / Processing', t: ['코일 슬리팅·시트 절단,', '로스를 줄이는 조합.'], p: '필요량과 원자재 후보를 비교해 A·B·C안 추천조합을 제시합니다. 같은 소재의 다른 대기 품목을 섞는 혼합 조합으로 수율을 높입니다.', l: ['연결 원자재 → 현재고 → 과거 매입 규격 순 후보 탐색', '수율 · 로스 · 생산중량 자동 계산', '슬리팅 배치 · 시트 2D 배치도 시각화'], panel: 'opt', url: 'steel119-erp / optimization' },
  { k: '04 / Profit', t: ['출고 한 건까지', '원가를 추적합니다.'], p: '출고 품목의 원래 출처(입고·기초재고·가공)까지 거슬러 매입단가를 붙이고, 가공비·부대비용을 반영해 실제 이익과 마진율을 계산합니다.', l: ['거래처별 손익 순위 · 전년 동월 비교', '톤당 매출 · 톤당 이익 분석', '숫자 기반 핵심 요약 문장 자동 생성'], panel: 'profit', url: 'steel119-erp / gross-profit' },
];

const TABS = [
  { label: '대시보드', icon: <path d="M3 20V10M9 20V4M15 20v-7M21 20V8" /> },
  { label: 'AI 주문서', icon: <><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5" /></> },
  { label: '가공 최적화', icon: <><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M8.5 7.5L20 18M8.5 16.5L20 6" /></> },
  { label: '매출이익', icon: <path d="M3 17l6-6 4 4 8-8M15 7h6v6" /> },
];

// 화면 패널의 움직임: out = 왼쪽으로 빠짐, enter = 오른쪽에서 대기(전환 없이), idle = 제자리로 들어옴
const PANEL_STYLE = {
  out: { transform: 'translateX(-60px)', opacity: 0 },
  enter: { transition: 'none', transform: 'translateX(60px)', opacity: 0 },
  idle: {},
};

export default function Showcase() {
  const [cur, setCur] = useState(0);
  const [phase, setPhase] = useState('enter');
  const [paused, setPaused] = useState(false);
  const [round, setRound] = useState(0); // 탭을 누를 때마다 자동 넘김 시간을 다시 센다
  const panelRef = useRef(null);
  const swapTimer = useRef();

  const go = (i) => {
    setPhase('out');
    clearTimeout(swapTimer.current);
    swapTimer.current = setTimeout(() => { setCur(i); setPhase('enter'); }, 350);
  };

  // 오른쪽 대기 위치를 화면에 한 번 그린 뒤(다음 프레임) 제자리로 미끄러져 들어오게 한다
  useLayoutEffect(() => {
    if (phase !== 'enter') return undefined;
    void panelRef.current?.offsetWidth;
    const frame = requestAnimationFrame(() => setPhase('idle'));
    return () => cancelAnimationFrame(frame);
  }, [phase]);

  useEffect(() => () => clearTimeout(swapTimer.current), []);

  useEffect(() => {
    if (paused || reduceMotion) return undefined;
    const timer = setTimeout(() => go((cur + 1) % DATA.length), 5000);
    return () => clearTimeout(timer);
  }, [cur, paused, round]);

  const d = DATA[cur];
  return (
    <>
      <div className="showcase" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
        <div className={`showcase-copy fade-swap${phase === 'out' ? ' is-out' : ''}`}>
          <span className="kicker">{d.k}</span>
          <h3>{d.t[0]}<br />{d.t[1]}</h3>
          <p>{d.p}</p>
          <ul className="check-list">{d.l.map((x) => <li key={x}>{x}</li>)}</ul>
          <Link className="btn btn-red" to="/erp">AI ERP 자세히 보기 <span className="ar">→</span></Link>
        </div>
        <div className="browser reveal">
          <div className="browser-bar"><i /><i /><i /><span>{d.url}</span></div>
          <div className="browser-view live">
            <div className="panel-host" ref={panelRef} style={PANEL_STYLE[phase]}>
              <Panel key={cur} name={d.panel} />
            </div>
          </div>
        </div>
      </div>
      <div className={`showtabs${paused ? ' paused' : ''}`} role="tablist" aria-label="ERP 기능">
        {TABS.map((tab, i) => (
          <button
            key={tab.label}
            role="tab"
            type="button"
            aria-selected={i === cur}
            tabIndex={i === cur ? 0 : -1}
            onClick={() => { go(i); setRound((r) => r + 1); }}
          >
            <svg viewBox="0 0 24 24">{tab.icon}</svg>{tab.label}
          </button>
        ))}
      </div>
    </>
  );
}
