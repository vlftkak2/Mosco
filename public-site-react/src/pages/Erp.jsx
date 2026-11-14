import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Showcase from '../components/Showcase';
import { LazyPanel, Panel } from '../components/Panels';
import { fmt, useInView, usePageMeta } from '../hooks';

// 1) 주문서 → AI 추출 결과 시연. 보이면 한 번 재생, [다시 보기]로 다시 재생 (key 를 바꿔 새로 붙이면 CSS 애니메이션이 처음부터 돈다)
function AiDemo() {
  const ref = useRef(null);
  const inView = useInView(ref, 0.4);
  const [round, setRound] = useState(0);
  return (
    <>
      <div className={`ai-demo${inView ? ' is-run' : ''}`} id="ai-demo" ref={ref} key={round}>
        <div className="doc">
          <span className="scanline" />
          <h4>주 문 서</h4>
          <div className="meta"><span className="mark" style={{ '--d': .6 }}>발주처 · (주)샘플건설</span><span className="mark" style={{ '--d': .8 }}>수신처 · (주)모스코</span><span className="mark" style={{ '--d': 1 }}>발주일 · 2026-11-12</span><span className="mark" style={{ '--d': 1.2 }}>납기일 · 2026-11-19</span></div>
          <table>
            <thead><tr><th>품명</th><th>강종/표면</th><th>규격(mm)</th><th>수량</th><th>중량</th></tr></thead>
            <tbody>
              <tr><td className="mark" style={{ '--d': 1.5 }}>EGI 코일</td><td>KS-SECC / 인산염</td><td className="mark" style={{ '--d': 1.6 }}>1.0 × 160</td><td>1 EA</td><td>277</td></tr>
              <tr><td className="mark" style={{ '--d': 1.8 }}>HGI 코일</td><td>KS-SGHC</td><td className="mark" style={{ '--d': 1.9 }}>3.2 × 135.8</td><td>1 EA</td><td>239</td></tr>
              <tr><td className="mark" style={{ '--d': 2.1 }}>각관</td><td>SPSR400</td><td className="mark" style={{ '--d': 2.2 }}>50×50×2.3×6000</td><td>20 본</td><td /></tr>
              <tr><td className="mark" style={{ '--d': 2.4 }}>STS 판재</td><td>STS304 / 2B</td><td className="mark" style={{ '--d': 2.5 }}>2.0×1219×2438</td><td>5 매</td><td /></tr>
            </tbody>
          </table>
          <p style={{ marginTop: 12, fontSize: 12, color: 'var(--ink-3)' }}>※ EGI 코일은 188mm 폭으로 슬리팅 요청</p>
        </div>
        <div className="extract">
          <div className="extract-head"><span>AI 추출 결과 · 주문서관리로 전달</span><b data-step="" style={{ '--d': 2.8 }}>● 분석 완료</b></div>
          <dl className="kv">
            <dt data-step="" style={{ '--d': .9 }}>발주처</dt><dd data-step="" style={{ '--d': .9 }}>(주)샘플건설</dd>
            <dt data-step="" style={{ '--d': 1.1 }}>발주일</dt><dd data-step="" style={{ '--d': 1.1 }}>2026-11-12</dd>
            <dt data-step="" style={{ '--d': 1.3 }}>납기일</dt><dd data-step="" style={{ '--d': 1.3 }}>2026-11-19</dd>
          </dl>
          <table>
            <thead><tr><th>품명</th><th>두께</th><th>폭</th><th>길이</th><th>수량</th><th style={{ textAlign: 'right' }}>중량(kg)</th><th /></tr></thead>
            <tbody>
              <tr data-step="" style={{ '--d': 1.7 }}><td>EGI</td><td>1.0</td><td>160</td><td>—</td><td>1 EA</td><td className="w">277</td><td><span className="ok">OK</span></td></tr>
              <tr data-step="" style={{ '--d': 2.0 }}><td>HGI</td><td>3.2</td><td>135.8</td><td>—</td><td>1 EA</td><td className="w">239</td><td><span className="ok">OK</span></td></tr>
              <tr data-step="" style={{ '--d': 2.3 }}><td>각관</td><td>2.3</td><td>50×50</td><td>6000</td><td>20 본</td><td className="w">—</td><td><span className="chk">확인 필요</span></td></tr>
              <tr data-step="" style={{ '--d': 2.6 }}><td>STS304</td><td>2.0</td><td>1219</td><td>2438</td><td>5 매</td><td className="w">—</td><td><span className="chk">확인 필요</span></td></tr>
            </tbody>
          </table>
          <p data-step="" style={{ '--d': 3, marginTop: 12, fontSize: 12, color: '#8d97b5' }}>확인 필요 사유: 중량 미기재 → 담당자가 검토 후 저장</p>
        </div>
      </div>
      <div className="demo-ctrl"><button className="btn btn-ghost btn-sm" id="ai-demo-replay" type="button" onClick={() => setRound((r) => r + 1)}>↻ 다시 보기</button></div>
    </>
  );
}

// 2) 업로드 → AI 분석 → 추출 3단계를 반복. 단계 글자를 누르면 그 단계부터.
const STAGE_MS = { 1: 2800, 2: 3400, 3: 7500 };

function AiSequence() {
  const ref = useRef(null);
  const inView = useInView(ref, 0.35);
  const [run, setRun] = useState({ stage: 1, n: 0 }); // n: 같은 단계를 다시 눌러도 애니메이션을 처음부터 돌리기 위한 번호
  const [panelKey, setPanelKey] = useState(0);

  const go = (stage) => {
    setRun((r) => ({ stage, n: r.n + 1 }));
    if (stage === 3) setPanelKey((k) => k + 1);
  };

  // 단계가 바뀌면 data-stage 를 잠깐 0 으로 돌렸다가 다시 넣어 CSS 애니메이션을 처음부터 재생한다
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || run.n === 0) return;
    el.dataset.stage = '0';
    void el.offsetWidth;
    el.dataset.stage = String(run.stage);
  }, [run]);

  // 처음 화면에 보이면 1단계부터 시작
  if (inView && run.n === 0) setRun({ stage: 1, n: 1 });

  useEffect(() => {
    if (run.n === 0) return undefined;
    const timer = setTimeout(() => go((run.stage % 3) + 1), STAGE_MS[run.stage]);
    return () => clearTimeout(timer);
  }, [run]);

  const steps = [[1, '01', '발주서 업로드'], [2, '02', 'AI 분석'], [3, '03', '필요 정보 추출']];
  return (
    <div className="ai-seq" id="ai-seq" data-stage={run.stage} ref={ref}>
      <ol className="seq-steps">
        {steps.map(([s, num, label]) => <li key={s} data-s={s} onClick={() => go(s)}><b>{num}</b>{label}</li>)}
      </ol>
      <div className="browser">
        <div className="browser-bar"><i /><i /><i /><span>steel119-erp / ai-order</span></div>
        <div className="seq-view has-panel">
          <div className="seq s1"><div className="drop"><div className="drop-doc"><img src="/assets/sample-order.png" alt="" /></div><p><b>sample-order.png</b> 업로드</p><div className="drop-bar"><i /></div></div></div>
          <div className="seq s2"><div className="scan-doc"><img src="/assets/sample-order.png" alt="" /><span className="scanline" /><span className="pick p1" /><span className="pick p2" /><span className="pick p3" /></div><div className="scan-info"><span className="spin" /><b>AI 분석 중</b><ul><li>스캔 기울기 보정</li><li>헤더 · 품목표 영역 확대</li><li>품명 · 규격 · 수량 추출</li><li>원본 대조 검증</li></ul></div></div>
          <div className="seq s3"><div className="panel-host" id="seq-panel">{panelKey > 0 && <Panel key={panelKey} name="ai" />}</div></div>
        </div>
      </div>
    </div>
  );
}

// 3) 가공 추천조합 카드 — 보이면 슬리팅 애니메이션
function OptCard() {
  const ref = useRef(null);
  const inView = useInView(ref, 0.4);
  return (
    // is-in 도 같이 넣는다: className 이 바뀔 때 스크롤 등장 효과(is-in)가 지워지지 않도록
    <div className={`opt-card reveal${inView ? ' is-in run' : ''}`} id="opt-card" ref={ref}>
      <div className="opt-head"><b>가공 추천조합</b><span>선택안 · A안 단독가공</span><em>수율 <strong>92.84</strong>%</em></div>
      <div className="opt-cands">
        <div className="cand on"><i>1순위</i><span>연결 원자재 · TIN PLATE <b>0.6 × 810 × C</b></span><small>투입 4,160kg</small><em>92.84%</em></div>
        <div className="cand"><i>2순위</i><span>현재고 · TIN PLATE <b>0.6 × 914 × C</b></span><small>투입 5,690kg</small><em>82.28%</em></div>
      </div>
      <div className="coil-label"><span>원코일 폭 810mm</span><span>188mm × 4칼</span></div>
      <div className="slit"><span>188</span><span>188</span><span>188</span><span>188</span><span className="rest">58</span></div>
      <div className="coil-label sub"><span>사용폭 752mm</span><span>잔여폭 58mm</span></div>
      <dl className="opt-kv"><div><dt>가공 투입중량</dt><dd>4,160kg</dd></div><div><dt>188mm 생산</dt><dd>3,862.1kg</dd></div><div><dt>예상 로스</dt><dd>297.9kg</dd></div></dl>
      <p className="opt-note">실제 대기 주문(0.6 × 188mm, 500kg)으로 계산한 결과를 재구성했습니다. 수율은 조건에 따라 달라집니다.</p>
    </div>
  );
}

// 4) 요금 계산기: 월 200,000원 + 1인당 5,000원 (VAT 별도)
const BASE = 200000, PER = 5000;
const clampUsers = (value) => Math.max(1, Math.min(999, parseInt(value, 10) || 1));

function PriceCalc() {
  const [users, setUsers] = useState(5);
  return (
    <>
      <div className="calc">
        <div>
          <label htmlFor="user-count">사용 인원</label>
          <div className="stepper">
            <button type="button" id="user-minus" aria-label="1명 줄이기" onClick={() => setUsers((n) => clampUsers(n - 1))}>−</button>
            <input id="user-count" type="number" min="1" max="999" value={users} inputMode="numeric" onChange={(e) => setUsers(clampUsers(e.target.value))} />
            <span>명</span>
            <button type="button" id="user-plus" aria-label="1명 늘리기" onClick={() => setUsers((n) => clampUsers(n + 1))}>+</button>
          </div>
        </div>
        <div className="calc-out"><small>예상 월 요금</small><output id="monthly-total" htmlFor="user-count" aria-live="polite">{fmt(BASE + PER * users)}원</output></div>
      </div>
      <p id="price-breakdown" className="calc-note">기본 {fmt(BASE)}원 + 사용자 {users}명 × {fmt(PER)}원 (월, VAT 별도)</p>
    </>
  );
}

export default function Erp() {
  usePageMeta('AI ERP · 요금 | 스틸119', '철강 회사를 위한 AI ERP. 월 기본 200,000원 + 사용자 1인당 5,000원.');

  return (
    <>
      {/* HERO */}
      <section className="hero2 on-dark">
        <div className="wrap">
          <div className="hero2-grid">
            <div className="hero-in">
              <span className="hero-badge"><i />AI ERP 시스템 STEEL119</span>
              <h1 style={{ marginTop: 24 }}>주문서 인식부터 가공·원가까지,<br />철강 회사를 위한<br /><em className="hl">AI ERP</em></h1>
              <p className="hero-lead">철강 유통·가공 현장에서 직접 쓰며 만든 ERP입니다.<br />주문서는 AI가 읽고, 재고·가공·원장은 한 흐름으로.</p>
              <div className="hero-cta"><a className="btn btn-red btn-lg" href="#ai-order">AI 인식 보기 <span className="ar">→</span></a><a className="btn btn-line-light btn-lg" href="#pricing">요금 안내</a></div>
            </div>
            <div className="orbit" aria-hidden="true">
              <svg viewBox="0 0 560 510">
                <defs><linearGradient id="trailGrad" x1="0" x2="1"><stop offset="0" stopColor="#8fa3ff" stopOpacity="0" /><stop offset="1" stopColor="#8fa3ff" /></linearGradient></defs>
                <path className="o-path" d="M30 420 C 120 470, 360 400, 540 70" />
                <path className="o-path o2" d="M10 380 C 160 300, 300 420, 530 120" />
                <path className="o-trail" d="M30 420 C 120 470, 360 400, 540 70" />
                <circle cx="470" cy="185" r="4" fill="#8fa3ff" /><circle className="o-ring" cx="470" cy="185" r="6" strokeWidth="2" />
              </svg>
              <div className="o-card c1"><small>STEP 01</small><b>주문서 업로드</b><div className="o-ico"><svg viewBox="0 0 24 24"><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5M12 18v-6M9.5 14.5L12 12l2.5 2.5" /></svg><i /></div></div>
              <div className="o-card c2"><small>STEP 02</small><b>AI 인식</b><div className="o-ico"><svg viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="3" /><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3M9.5 9.5h5v5h-5z" /></svg><i /></div></div>
              <div className="o-card c3"><small>STEP 03</small><b>재고 매칭</b><div className="o-ico"><svg viewBox="0 0 24 24"><path d="M3 9l9-5 9 5v11H3z" /><path d="M8 20v-6h8v6" /></svg><i /></div></div>
              <div className="o-card c4"><small>STEP 04</small><b>가공 · 출고</b><div className="o-ico"><svg viewBox="0 0 24 24"><path d="M2 6h12v10H2zM14 10h4l4 4v2h-8" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="18" r="2" /></svg><i /></div></div>
              <div className="o-chip"><i />AI가 주문서를 인식했습니다</div>
            </div>
          </div>
          <div className="stat-cards reveal-group">
            <div className="stat-card"><b>20<small>만원</small></b><p>월 기본료 (VAT 별도)</p></div>
            <div className="stat-card"><b>5,000<small>원</small></b><p>사용자 1인당 / 월</p></div>
            <div className="stat-card"><b>10<small>p</small></b><p>PDF 주문서 한 번에 인식</p></div>
            <div className="stat-card"><b>A·B·C<small>안</small></b><p>가공 추천조합 자동 비교</p></div>
          </div>
        </div>
      </section>

      {/* AI ORDER DEMO */}
      <section className="sec" id="ai-order">
        <div className="wrap">
          <div className="center reveal">
            <span className="kicker">AI Order Recognition</span>
            <h2 className="sec-title">주문서 한 장을 올리면,<br />이렇게 데이터가 됩니다.</h2>
            <p className="sec-desc">PDF·사진·스캔본으로 받은 철강 주문서에서 발주처·납기·품목을 추출합니다. 값이 애매한 행은 <strong>확인 필요</strong>로 표시해 사람이 최종 검토합니다.</p>
          </div>
          <AiDemo />
          <p className="demo-note">위 화면은 시연용 샘플 주문서로 재구성한 예시입니다.</p>
          <div className="real-demo reveal">
            <div className="real-head"><span className="kicker">Real Screen</span><h3>발주서를 넣으면, AI가 필요한 정보를 가져옵니다</h3><p>시연용 샘플 주문서를 실제 ERP에서 분석한 결과를 바탕으로 재구성했습니다.</p></div>
            <AiSequence />
          </div>

          <div className="feat-grid reveal-group" style={{ marginTop: 64 }}>
            <article className="feat"><div className="ico"><svg viewBox="0 0 24 24"><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5" /></svg></div><h3>PDF · 이미지 6종 지원</h3><p>PDF, JPG, PNG, HEIC, TIFF 주문서를 올리세요. 팩스는 스캔본으로 인식합니다. (최대 30MB · PDF 10페이지)</p></article>
            <article className="feat"><div className="ico"><svg viewBox="0 0 24 24"><path d="M4 20l16-16M4 4h6M14 20h6" /></svg></div><h3>스캔 기울기 자동 보정</h3><p>삐뚤게 스캔된 주문서도 페이지를 바로 세우고, 품목표 영역을 확대해 함께 인식합니다.</p></article>
            <article className="feat"><div className="ico"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M21 21l-5-5M8 11l2 2 4-4" /></svg></div><h3>원본 대조 검증</h3><p>추출한 값을 원본에서 다시 찾아 근거 위치를 확인합니다. 애매한 행은 사유와 함께 표시합니다.</p></article>
            <article className="feat"><div className="ico"><svg viewBox="0 0 24 24"><path d="M3 9l9-5 9 5v11H3z" /><path d="M8 20v-6h8v6" /></svg></div><h3>재고 매칭 · 재고 보호</h3><p>품목별 현재고 후보를 찾아 연결하고, 연결된 재고는 다른 주문에서 쓰지 못하게 보호합니다.</p></article>
            <article className="feat"><div className="ico"><svg viewBox="0 0 24 24"><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /><circle cx="12" cy="12" r="5" /></svg></div><h3>같은 파일은 재분석 없이</h3><p>이미 분석한 파일은 저장된 결과를 바로 불러옵니다. 불필요한 AI 비용이 들지 않습니다.</p></article>
            <article className="feat"><div className="ico"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 10h10M7 14h6" /></svg></div><h3>사용량 · 예산 관리</h3><p>사용자·회사별 일일 횟수와 월 예산 한도를 두고, 사용량과 이력을 기록합니다.</p></article>
          </div>
        </div>
      </section>

      {/* PROCESSING */}
      <section className="sec sec-tint">
        <div className="wrap">
          <div className="show">
            <div className="show-copy reveal"><span className="kicker">AI Processing</span><h3>코일 슬리팅 · 시트 절단,<br />로스를 줄이는 추천조합.</h3><p>필요량에서 선가공 재고를 빼고, 원자재 후보를 비교해 A·B·C안을 제시합니다. 같은 소재의 다른 대기 품목을 섞는 혼합 조합(최대 6개 폭)으로 수율을 높입니다.</p><ul className="check-list"><li>연결 원자재 → 현재고 → 과거 매입 규격 순 후보 탐색</li><li>코일: 투입·생산중량, 로스, 수율 · 최대 60칼 계산</li><li>시트: 원판 매수 · 로스 면적 · 2D 배치도</li><li>계획 확정 시 원자재 재고 예약</li></ul></div>
            <OptCard />
          </div>
        </div>
      </section>

      {/* SHOWCASE TABS */}
      <section className="sec">
        <div className="wrap">
          <div className="center reveal">
            <span className="kicker">Everyday ERP</span>
            <h2 className="sec-title">데이터로 연결되는,<br />철강 업무의 모든 흐름</h2>
          </div>
          <Showcase />
        </div>
      </section>

      {/* MORE SCREENS */}
      <section className="sec sec-tint">
        <div className="wrap">
          <div className="show">
            <div className="show-copy reveal"><span className="kicker">Customer Balance</span><h3>미수금 · 미지급금,<br />거래처별로 한눈에.</h3><p>전월말 대비 증감과 12개월 추이, 거래처 TOP 10과 미수금 경과 기간을 보여줍니다. 거래처를 누르면 원장으로 바로 이동합니다.</p><ul className="check-list"><li>이월 잔액부터 전표별 잔액 누계 원장</li><li>받을어음 · 지급어음 · 배서 · 부도 상태 관리</li><li>숫자 기반 핵심 요약 자동 생성</li></ul></div>
            <div className="panel-card reveal"><LazyPanel name="balance" /></div>
          </div>
          <div className="show rev">
            <div className="show-copy reveal"><span className="kicker">Stock · Documents</span><h3>재고와 출고 문서까지,<br />철강 단위 그대로.</h3><p>두께·폭·길이와 중량(kg) 단위로 재고를 관리하고, 거래명세서와 납품송장을 바로 출력하거나 PDF로 저장합니다.</p><ul className="check-list"><li>현재고 · 기초재고 · 재고이동 · 재고가공</li><li>가공비 · 입고 부대비용을 원가에 반영</li><li>약 25개 화면 엑셀 내보내기 · 기초자료 일괄등록</li></ul></div>
            <div className="panel-card reveal"><LazyPanel name="stock" /></div>
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section className="sec" id="pricing">
        <div className="wrap">
          <div className="reveal center">
            <span className="kicker">Simple Pricing</span>
            <h2 className="sec-title">쓰는 인원만큼, 명확하게.</h2>
            <p className="sec-desc">월 기본료에 사용자 수만큼 더하는 단순한 요금 구조입니다.</p>
          </div>
          <div className="plans">
            <div className="plan main reveal">
              <span className="badge">STANDARD</span>
              <h3>STEEL119 AI ERP</h3>
              <p>모든 기능 포함 · 월 단위 이용</p>
              <div className="formula">
                <div><small>기본료</small><strong>200,000<span>원 / 월</span></strong></div>
                <span className="plus">+</span>
                <div><small>사용자</small><strong>5,000<span>원 / 인 · 월</span></strong></div>
              </div>
              <PriceCalc />
              <Link className="btn btn-red btn-lg" to="/inquiry#erp">도입 상담 신청 <span className="ar">→</span></Link>
            </div>
            <div className="plan side reveal">
              <h3>모든 요금에 포함</h3>
              <ul className="check-list" style={{ marginTop: 22 }}>
                <li>AI 주문서 인식 · 주문서관리 · 재고 매칭</li>
                <li>AI 가공 최적화 (코일 슬리팅 · 시트 절단)</li>
                <li>매입 · 매출 · 재고 · 재고가공</li>
                <li>수금 · 지급 · 거래처 원장 · 어음 관리</li>
                <li>대시보드 · 매출이익 · 거래처 잔액 분석</li>
                <li>거래명세서 · 납품송장 출력</li>
                <li>사용자별 메뉴 권한 · 엑셀 일괄등록</li>
              </ul>
            </div>
          </div>
          <div className="table-wrap reveal">
            <table className="price-table">
              <thead><tr><th>사용 인원</th><th>기본료</th><th>사용자 요금</th><th>월 합계</th></tr></thead>
              <tbody>
                {[3, 5, 10, 20].map((n) => (
                  <tr key={n}><td>{n}명</td><td>{fmt(BASE)}원</td><td>{fmt(PER * n)}원</td><td>{fmt(BASE + PER * n)}원</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="vat reveal">※ 표시 요금은 VAT 별도입니다. 데스크톱 웹 브라우저 기준이며, 세부 계약 조건은 도입 상담 시 안내해드립니다.</p>
        </div>
      </section>

      {/* SUPPORT */}
      <section className="sec sec-tint">
        <div className="wrap support">
          <div className="reveal">
            <span className="kicker">Onboarding</span>
            <h2 style={{ marginTop: 12 }}>도입 지원</h2>
            <p>철강 회사의 업무 방식을 아는 팀이 ERP 도입과 데이터 이관을 함께합니다.</p>
            <ul className="check-list dark">
              <li>품목 · 거래처 · 기초재고 · 기초잔액 엑셀 일괄 등록</li>
              <li>사업장 정보 · 원장 시작일 · 사용자 메뉴 권한 설정</li>
              <li>도입 후 상담게시판으로 문의 응대</li>
            </ul>
            <Link className="btn btn-navy" style={{ marginTop: 28 }} to="/inquiry#erp">도입 상담하기 <span className="ar">→</span></Link>
          </div>
          <div className="panel-card reveal"><LazyPanel name="profit" /></div>
        </div>
      </section>

      <section className="cta on-dark">
        <div className="wrap reveal">
          <span className="kicker light">Let&apos;s Build Your Workflow</span>
          <h2>철강 업무에 맞는 ERP,<br />스틸119과 이야기하세요.</h2>
          <div className="hero-cta"><Link className="btn btn-red btn-lg" to="/inquiry#erp">도입 상담하기 <span className="ar">→</span></Link><a className="btn btn-line-light btn-lg" href="tel:16002579">전화 1600-2579</a></div>
        </div>
      </section>
    </>
  );
}
