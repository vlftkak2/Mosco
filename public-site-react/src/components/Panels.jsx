import { useRef } from 'react';
import { fmt, useCountUp, useInView } from '../hooks';

// ERP 화면을 HTML 로 다시 그린 예시 패널들 (예시 데이터).
// 패널이 새로 붙을 때 CSS 애니메이션이 돈다 — 다시 보여주려면 key 를 바꿔 새로 붙인다.

const Up = ({ v }) => <span className="pd up">▲ {v}</span>;
const Down = ({ v }) => <span className="pd dn">▼ {v}</span>;
const Note = ({ v }) => <span className="pd">{v}</span>;

function Count({ to }) {
  return fmt(useCountUp(to, true, 1100));
}

function Head({ title, sub }) {
  return <div className="pn-head"><b>{title}</b><span>{sub}</span><em>화면 재구성 · 예시 데이터</em></div>;
}

function Kpi({ label, value, unit, delta, i, tone = '' }) {
  return (
    <div className={`pn-kpi ${tone}`} style={{ '--i': i }}>
      <small>{label}</small><strong><Count to={value} />{unit}</strong>{delta}
    </div>
  );
}

function Dashboard() {
  const months = [['12월', 3080, 520], ['1월', 2946, 480], ['2월', 2325, 400], ['3월', 3002, 560], ['4월', 2590, 450], ['5월', 2372, 410], ['6월', 3396, 640], ['7월', 2379, 420], ['8월', 3514, 690], ['9월', 4036, 760], ['10월', 2476, 470], ['11월', 5729, 1090]];
  const max = 6000;
  return (
    <div className="pn">
      <Head title="대시보드" sub="조회기간 2026-11-01 ~ 11-12 · 전월 같은 기간 대비" />
      <div className="pn-kpis">
        <Kpi label="매출" value={57293271} unit="원" delta={<Up v="131.3%" />} i={0} tone="c1" />
        <Kpi label="매입" value={45707580} unit="원" delta={<Up v="23.4%" />} i={1} tone="c2" />
        <Kpi label="매출이익" value={10902131} unit="원" delta={<Up v="262.1%" />} i={2} tone="c3" />
        <Kpi label="미수금" value={600000} unit="원" delta={<Note v="1곳 · 30일 경과 없음" />} i={3} tone="c4" />
      </div>
      <div className="pn-box">
        <div className="pn-sub"><b>월별 매출 · 매출이익</b><span><i className="lg l1" />비용 <i className="lg l2" />매출이익 (만원)</span></div>
        <div className="bars">
          {months.map(([m, s, p], i) => (
            <div className="bar" style={{ '--i': i }} key={m}>
              <em>{fmt(s)}</em>
              <div className="stack" style={{ height: `${(s / max) * 100}%` }}>
                <span className="cost" style={{ flex: s - p }} /><span className="profit" style={{ flex: p }} />
              </div>
              <small>{m}</small>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AiOrder() {
  const rows = [['EGI 코일', 'KS-SECC', '인산염', '1.0', '160', '—', '1 EA', '277', 1], ['HGI 코일', 'KS-SGHC', '', '3.2', '135.8', '—', '1 EA', '239', 1], ['각관', 'SPSR400', '', '2.3', '50×50', '6,000', '20 본', '—', 0], ['STS 판재', 'STS304', '2B', '2.0', '1,219', '2,438', '5 매', '—', 0], ['냉연강판', 'SPCC', '', '1.2', '914', '1,829', '10 매', '—', 0]];
  const fields = [['발주처', '(주)샘플건설'], ['수신처', '(주)모스코 (스틸119)'], ['발주일자', '2026-11-12'], ['납기일자', '2026-11-19'], ['납품 장소', '경기도 화성시 샘플로 123 (현장)', 'w']];
  return (
    <div className="pn pn-ai">
      <Head title="AI 주문서인식" sub="sample-order.png · 분석 완료" />
      <div className="ai-split">
        <div className="ai-doc"><img src="/assets/sample-order.png" alt="샘플 주문서" /><span className="scanline" /></div>
        <div className="ai-out">
          <div className="ai-fields">
            {fields.map(([label, value, cls], i) => (
              <div className={cls} style={{ '--i': i }} key={label}><small>{label} <i>AI 추출</i></small><b>{value}</b></div>
            ))}
          </div>
          <table className="pn-table">
            <thead><tr><th>품명</th><th>강종</th><th>표면</th><th>두께</th><th>폭</th><th>길이</th><th>수량</th><th>중량</th><th /></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr style={{ '--i': i + 5 }} key={r[0]}>
                  <td><b>{r[0]}</b></td>
                  {r.slice(1, 8).map((c, k) => <td key={k}>{c}</td>)}
                  <td>{r[8] ? <span className="tg ok">OK</span> : <span className="tg chk">확인 필요</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Optimization() {
  return (
    <div className="pn">
      <Head title="가공최적화" sub="0.6 × 188mm · 필요 500kg · 원자재 후보 비교" />
      <table className="pn-table big">
        <thead><tr><th>순위</th><th>구분</th><th>후보 규격</th><th>투입</th><th>생산</th><th>로스</th><th>수율</th></tr></thead>
        <tbody>
          <tr className="on" style={{ '--i': 0 }}><td><b>1순위</b></td><td>연결 원자재</td><td><b>0.6 × 810 × C</b></td><td>4,160kg</td><td>3,862.1kg</td><td>297.9kg</td><td><b className="hl">92.84%</b></td></tr>
          <tr style={{ '--i': 1 }}><td>2순위</td><td>현재고</td><td>0.6 × 914 × C</td><td>5,690kg</td><td>4,681.5kg</td><td>1,008.5kg</td><td>82.28%</td></tr>
        </tbody>
      </table>
      <div className="pn-box">
        <div className="pn-sub"><b>A안 · 단독가공 · 188mm × 4칼</b><span>원코일 810mm</span></div>
        <div className="slit run"><span>188</span><span>188</span><span>188</span><span>188</span><span className="rest">58</span></div>
        <div className="coil-label sub"><span>사용폭 752mm</span><span>잔여폭 58mm · 로스 297.9kg</span></div>
      </div>
    </div>
  );
}

function Profit() {
  const cs = [['A스틸', 18.2, 21.4], ['B철강', 12.6, 18.9], ['C메탈', 9.8, 16.2], ['D산업', 7.1, 22.8], ['E금속', 4.3, 12.5]];
  return (
    <div className="pn">
      <Head title="매출이익 현황" sub="출고 건별 원가 추적 · 전년 동월 대비" />
      <div className="pn-kpis">
        <Kpi label="매출" value={57293271} unit="원" delta={<Up v="131.3%" />} i={0} tone="c1" />
        <Kpi label="비용" value={46391140} unit="원" delta={<Up v="113.3%" />} i={1} tone="c2" />
        <Kpi label="순이익" value={10902131} unit="원" delta={<Up v="262.1%" />} i={2} tone="c3" />
        <div className="pn-kpi c4" style={{ '--i': 3 }}><small>마진율</small><strong>19.0%</strong><span className="pd up">▲ 6.9%p</span></div>
      </div>
      <div className="pn-2">
        <div className="pn-box">
          <div className="pn-sub"><b>거래처별 매출 · 이익률</b><span>백만원</span></div>
          {cs.map(([n, v, m], i) => (
            <div className="hbar" style={{ '--i': i }} key={n}><span>{n}</span><div><i style={{ width: `${(v / 20) * 100}%` }} /></div><b>{v}</b><em>{m}%</em></div>
          ))}
        </div>
        <div className="pn-box insight">
          <div className="pn-sub"><b>한눈에 보는 요점</b></div>
          <p style={{ '--i': 0 }}><b>1</b>순이익이 전월 대비 <strong>+262.1%</strong> 늘었습니다.</p>
          <p style={{ '--i': 1 }}><b>2</b>톤당 이익이 가장 높은 거래처는 <strong>D산업</strong>입니다.</p>
          <p style={{ '--i': 2 }}><b>3</b>이익률이 떨어진 거래처 <strong>1곳</strong>을 확인하세요.</p>
        </div>
      </div>
    </div>
  );
}

function Balance() {
  const top = [['A스틸', 42], ['B철강', 26], ['C메탈', 15], ['D산업', 10], ['E금속', 7]];
  const aging = [['30일 이내', 72], ['31~60일', 18], ['61~90일', 7], ['90일 초과', 3]];
  return (
    <div className="pn">
      <Head title="거래처 잔액 현황" sub="기준일 2026-11-12 · 전월말 대비" />
      <div className="pn-kpis k3">
        <Kpi label="미수금" value={600000} unit="원" delta={<Note v="거래처 1곳" />} i={0} tone="c1" />
        <Kpi label="미지급금" value={50000000} unit="원" delta={<Note v="거래처 1곳" />} i={1} tone="c2" />
        <div className="pn-kpi c3" style={{ '--i': 2 }}><small>순잔액</small><strong>−49,400,000원</strong><span className="pd dn">미지급이 더 큼</span></div>
      </div>
      <div className="pn-2">
        <div className="pn-box">
          <div className="pn-sub"><b>미수금 상위 거래처</b><span>비중 %</span></div>
          {top.map(([n, v], i) => (
            <div className="hbar" style={{ '--i': i }} key={n}><span>{n}</span><div><i style={{ width: `${v * 2.2}%` }} /></div><b>{v}%</b></div>
          ))}
        </div>
        <div className="pn-box">
          <div className="pn-sub"><b>미수금 경과 기간</b></div>
          <div className="aging">
            {aging.map(([n, v], i) => (
              <div style={{ '--i': i }} key={n}><div className="col"><i style={{ height: `${v}%` }} /></div><b>{v}%</b><small>{n}</small></div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stock() {
  const rows = [['2026-11-02', '입고', 'A스틸', 'EGI SHEET', 'KS-SECC', '1.0 × 1219 × 2438', '1,240'], ['2026-11-03', '입고', 'B철강', 'EGI COIL', 'KS-SECC', '1.0 × 160 × C', '277'], ['2026-11-03', '입고', 'C메탈', 'EGI COIL', 'KS-SECC', '1.18 × 139 × C', '312'], ['2026-11-05', '가공', '자사', 'EGI COIL', 'KS-SECC', '0.6 × 188 × C', '965'], ['2026-11-08', '기초', '자사', 'AL COIL', 'A5052', '2.0 × 1000 × C', '820'], ['2026-11-09', '입고', 'D산업', '포스맥1.5', 'KS-SGMCC', '1.5 × 1219 × C', '2,410'], ['2026-11-10', '입고', 'E금속', 'HGI COIL', 'KS-SGHC', '3.2 × 135.8 × C', '239']];
  const tagClass = { 입고: 'in', 가공: 'pr' };
  return (
    <div className="pn">
      <Head title="현재고 현황" sub="창고 전체 · 17건 · 단위 kg" />
      <table className="pn-table">
        <thead><tr><th>입고일자</th><th>구분</th><th>거래처</th><th>품명</th><th>강종</th><th>규격 (T × W × L)</th><th style={{ textAlign: 'right' }}>중량(kg)</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr style={{ '--i': i }} key={i}>
              <td>{r[0]}</td><td><span className={`tg ${tagClass[r[1]] || 'bs'}`}>{r[1]}</span></td><td>{r[2]}</td><td><b>{r[3]}</b></td><td>{r[4]}</td><td>{r[5]}</td><td style={{ textAlign: 'right' }}><b>{r[6]}</b></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pn-foot"><span>현재고 합계</span><b><Count to={1075800} />kg</b></div>
    </div>
  );
}

const PANELS = { dashboard: Dashboard, ai: AiOrder, opt: Optimization, profit: Profit, balance: Balance, stock: Stock };

export function Panel({ name }) {
  const Component = PANELS[name];
  return Component ? <Component /> : null;
}

// 스크롤해서 보일 때 처음 그려지는 패널 자리
export function LazyPanel({ name }) {
  const ref = useRef(null);
  const visible = useInView(ref, 0.3);
  return <div className="panel-host" ref={ref}>{visible && <Panel name={name} />}</div>;
}
