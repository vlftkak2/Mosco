import { useMemo, useState } from 'react';
import {
  IconArrowRight,
  IconBuildingFactory2,
  IconCalendar,
  IconChartBar,
  IconChartDonut,
  IconCrane,
  IconMessageCircleQuestion,
  IconNews,
  IconShip,
  IconShoppingCart,
  IconTarget,
  IconTrendingUp,
  IconTruckDelivery,
} from '@tabler/icons-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import classes from '../styles/pages/HomePage.module.css';

const incoming = [
  { date: '03.31', item: 'H-Beam 300×300', weight: '25,000', amount: '31,250,000', customer: '한성철강', status: '입고완료' },
  { date: '03.30', item: '철판 SS400 12T', weight: '12,800', amount: '16,384,000', customer: '동국제강', status: '입고완료' },
  { date: '03.29', item: '배관용 강관 100A', weight: '8,200', amount: '10,660,000', customer: '유성스틸', status: '입고완료' },
  { date: '03.28', item: '앵글 50×50×5T', weight: '6,500', amount: '8,450,000', customer: '대한강재', status: '입고완료' },
];
const outgoing = [
  { date: '03.31', item: 'H-Beam 300×300', weight: '18,000', amount: '25,200,000', customer: '현대건설', status: '출고완료' },
  { date: '03.30', item: '철판 6T', weight: '9,600', amount: '13,920,000', customer: '삼성물산', status: '출고완료' },
  { date: '03.29', item: '배관용 강관 100A', weight: '6,200', amount: '8,680,000', customer: '포스코건설', status: '출고완료' },
  { date: '03.28', item: '평철 12T', weight: '4,800', amount: '7,200,000', customer: '한국중공업', status: '출고완료' },
];
const monthly = [
  { month: '10월', volume: 340, profit: 18 }, { month: '11월', volume: 365, profit: 21 },
  { month: '12월', volume: 305, profit: 17 }, { month: '1월', volume: 390, profit: 25 },
  { month: '2월', volume: 325, profit: 20 }, { month: '3월', volume: 412, profit: 29 },
];
const aging = [
  { name: '3년 이상', value: 18.6, amount: '232.4 Ton', color: '#e5444b' },
  { name: '2년 이상', value: 39.9, amount: '498.2 Ton', color: '#293747' },
  { name: '1년 이상', value: 28.5, amount: '356.1 Ton', color: '#4585f4' },
  { name: '1년 미만', value: 13, amount: '161.8 Ton', color: '#f7a512' },
];
const news = [
  { icon: IconBuildingFactory2, title: '국내 철강 시장, 공급 및 수요 동향 점검… 유통가 관망세 지속', description: '열연·후판·형강 등 주요 품목의 가격 흐름과 수요 반등 가능성을 점검합니다.', category: '시장 동향', date: '2026-03-31', featured: true },
  { icon: IconChartBar, title: '철강 제품별 시황과 가격 전망… 건설향 수요와 재고 흐름 주목', description: '품목별 가격 변동과 재고 수준, 현장 출고량 변화를 살펴봅니다.', category: '제품 시황', date: '2026-03-30', featured: true, tone: 'slate' },
  { icon: IconShip, title: '글로벌 철강 수출입 시장 주요 이슈', description: '국가별 교역과 운임 변동 관련 소식입니다.', category: '수출입', date: '2026-03-29', tone: 'blue' },
  { icon: IconChartBar, title: '철강 가공 및 생산 기술 트렌드', description: '슬리팅·절단·가공설비 자동화 동향입니다.', category: '가공 기술', date: '2026-03-28', tone: 'sand' },
  { icon: IconCrane, title: '건설향 철강 수요 회복 기대감 확대', description: '건설·플랜트 프로젝트 수요 관련 소식입니다.', category: '건설 수요', date: '2026-03-27', tone: 'tan' },
  { icon: IconTrendingUp, title: '원자재 가격과 철강 유통단가 변화 추이', description: '원재료 가격 변화에 따른 유통가 흐름입니다.', category: '가격 동향', date: '2026-03-26', tone: 'gray' },
];

export default function HomePage() {
  const [from, setFrom] = useState('2026-03-01');
  const [to, setTo] = useState('2026-03-31');
  const [period, setPeriod] = useState('month');
  const [search, setSearch] = useState('');
  const [inquirySent, setInquirySent] = useState(false);
  const rows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const filter = (items) => items.filter((row) => !query || Object.values(row).some((value) => String(value).toLocaleLowerCase().includes(query)));
    return [filter(incoming), filter(outgoing)];
  }, [search]);

  const choosePeriod = (value) => {
    const now = new Date();
    const today = localDate(now);
    setPeriod(value);
    setTo(today);
    setFrom(value === 'today' ? today : `${today.slice(0, 7)}-01`);
  };

  return (
    <main className={`${classes.root} ${classes.dashboardExample}`}>
      <div className={classes.exampleToolbar}>
        <div className={classes.exampleFilters}>
          <span className={classes.exampleFilterLabel}><IconCalendar size={16} /> 조회기간</span>
          <input aria-label="시작일" type="date" value={from} max={to} onChange={(event) => { setFrom(event.target.value); setPeriod('custom'); }} />
          <span className={classes.exampleMuted}>~</span>
          <input aria-label="종료일" type="date" value={to} min={from} onChange={(event) => { setTo(event.target.value); setPeriod('custom'); }} />
          <button type="button" className={period === 'today' ? classes.examplePeriodActive : classes.examplePeriod} onClick={() => choosePeriod('today')}>오늘</button>
          <button type="button" className={period === 'month' ? classes.examplePeriodActive : classes.examplePeriod} onClick={() => choosePeriod('month')}>이번달</button>
        </div>
        <span className={classes.exampleDemo}>예시 데이터 · 실제 ERP 연동 전</span>
      </div>

      <section className={classes.exampleKpis} aria-label="주요 실적">
        <Kpi icon={IconChartBar} title="금일 매출" value="127,985,000" detailLabel="매출중량" detail="12,790 KG" trend="▲ 12.5%" />
        <Kpi icon={IconShoppingCart} title="금일 매입" value="98,430,000" detailLabel="매입중량" detail="9,850 KG" trend="▲ 8.3%" muted />
        <Kpi icon={IconChartBar} title="금일 매출이익" value="29,555,000" detailLabel="매출이익률" detail="23.1%" trend="▲ 2.1%p" blue />
        <div className={`${classes.exampleCard} ${classes.exampleKpi} ${classes.exampleGoal}`}>
          <div className={classes.exampleKpiHead}><span>당월 매출 목표 달성률</span><span className={`${classes.exampleIcon} ${classes.iconGold}`}><IconTarget size={19} /></span></div>
          <div className={classes.exampleGoalTrack}><div><strong>84.2%</strong></div></div>
          <div className={classes.exampleGoalFoot}><span>누적 실적<strong>842,000,000원</strong></span><span>월 목표<strong>1,000,000,000원</strong></span></div>
        </div>
      </section>

      <section className={`${classes.exampleCard} ${classes.exampleTransactions}`}>
        <div className={classes.exampleSectionHead}>
          <div className={classes.exampleHeading}><IconTruckDelivery size={19} /> 최근 입고 / 출고 현황</div>
          <input aria-label="입출고 내역 검색" className={classes.exampleSearch} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="거래처명, 품목, 규격 검색..." />
        </div>
        <div className={classes.exampleTables}>
          <TransactionTable title="최근 입고 현황" rows={rows[0]} />
          <TransactionTable title="최근 출고 현황" rows={rows[1]} outbound />
        </div>
        <p className={classes.exampleNote}>중량·매입금액·매출금액은 디자인 검토용 예시 데이터입니다.</p>
      </section>

      <div className={classes.exampleMiddle}>
        <section className={`${classes.exampleCard} ${classes.examplePanel}`}>
          <div className={classes.examplePanelHead}>
            <div className={classes.exampleHeading}><IconChartBar size={18} /> 월별 판매량 및 매출이익</div>
            <div className={classes.exampleLegend}><span><i />판매량</span><span><i />매출이익</span></div>
          </div>
          <div className={classes.exampleChart}>
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={{ width: 640, height: 205 }}>
              <BarChart data={monthly} margin={{ top: 8, right: 8, left: -18, bottom: 0 }} barCategoryGap="35%">
                <CartesianGrid vertical={false} stroke="#edf0f4" />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#738198', fontSize: 11 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#8a96a8', fontSize: 10 }} />
                <Tooltip formatter={(value, name) => [`${value} ${name === '판매량' ? 'Ton' : '백만원'}`, name]} />
                <Bar dataKey="volume" name="판매량" fill="#e5444b" radius={[3, 3, 0, 0]} />
                <Bar dataKey="profit" name="매출이익" fill="#293747" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className={classes.exampleChartSummary}><span>당월 판매량<strong>412.5 Ton</strong></span><span>당월 매출이익률<strong>23.1%</strong></span><span>당월 매출금액<strong>842,000,000원</strong></span></div>
        </section>

        <section className={`${classes.exampleCard} ${classes.examplePanel} ${classes.exampleInventory}`}>
          <div className={classes.examplePanelHead}><div className={classes.exampleHeading}><IconChartDonut size={18} /> 장기재고 비중</div><span className={classes.exampleMuted}>총 재고 1,248.5 Ton</span></div>
          <div className={classes.exampleDonutArea}>
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={{ width: 260, height: 170 }}>
              <PieChart><Pie data={aging} dataKey="value" innerRadius={46} outerRadius={64} paddingAngle={2} stroke="none">{aging.map((entry) => <Cell key={entry.name} fill={entry.color} />)}</Pie><Tooltip formatter={(value) => [`${value}%`, '재고 비중']} /></PieChart>
            </ResponsiveContainer>
            <div className={classes.exampleDonutCenter}><span>3년 이상 재고</span><strong>18.6%</strong></div>
          </div>
          <div className={classes.exampleAgingList}>{aging.map((entry) => <div key={entry.name}><span><i style={{ background: entry.color }} />{entry.name}</span><strong>{entry.amount} ({entry.value}%)</strong></div>)}</div>
        </section>

        <section className={`${classes.exampleCard} ${classes.examplePanel} ${classes.exampleInquiry}`}>
          <div className={classes.exampleInquiryHead}><div className={classes.exampleHeading}><IconMessageCircleQuestion size={18} /> 문의 남기기</div><span>제품 규격과 요청사항을 남겨주세요.</span></div>
          {inquirySent ? <div className={classes.exampleInquiryDone}>문의 등록은 화면 시안입니다.</div> : <form className={classes.exampleInquiryForm} onSubmit={(event) => { event.preventDefault(); setInquirySent(true); }}>
            <input aria-label="회사명" placeholder="회사명" />
            <input aria-label="담당자명" placeholder="담당자명" />
            <input aria-label="연락처" placeholder="연락처" />
            <input aria-label="제품" placeholder="제품" />
            <input aria-label="두께" placeholder="두께" />
            <input aria-label="폭" placeholder="폭" />
            <input aria-label="길이" placeholder="길이" />
            <input aria-label="수량 또는 중량" placeholder="수량 또는 중량" />
            <textarea aria-label="요청사항" placeholder="요청사항" />
            <button type="submit">문의 간편 등록 <IconArrowRight size={15} /></button>
          </form>}
        </section>
      </div>

      <section className={`${classes.exampleCard} ${classes.exampleNews}`}>
        <div className={classes.examplePanelHead}>
          <div><div className={classes.exampleHeading}><IconNews size={19} /> 철강 뉴스</div><div className={classes.exampleMuted}>연동 시 실제 기사 이미지와 제목·요약이 표시됩니다.</div></div>
          <button type="button" className={classes.exampleNewsMore}>전체보기 ›</button>
        </div>
        <div className={classes.exampleNewsGrid}>{news.map((item) => <NewsCard key={item.title} item={item} />)}</div>
      </section>
    </main>
  );
}

function Kpi({ icon: Icon, title, value, detailLabel, detail, trend, muted, blue }) {
  return <div className={`${classes.exampleCard} ${classes.exampleKpi}`}>
    <div className={classes.exampleKpiHead}><span>{title}</span><span className={`${classes.exampleIcon} ${blue ? classes.iconBlue : muted ? classes.iconSlate : classes.iconRed}`}><Icon size={19} /></span></div>
    <div className={classes.exampleAmount}>{value}<small>원</small></div>
    <div className={classes.exampleKpiFoot}><span>{detailLabel}<strong>{detail}</strong></span><b className={blue ? classes.trendBlue : muted ? classes.trendMuted : ''}>{trend}</b></div>
  </div>;
}

function TransactionTable({ title, rows, outbound = false }) {
  return <div className={classes.exampleTableWrap}>
    <h3 className={outbound ? classes.exampleOutboundTitle : ''}>{title}</h3>
    <div className={classes.exampleTableScroll}><table><thead><tr><th>일자</th><th>품목 및 규격</th><th>{outbound ? '출고' : '입고'}중량(KG)</th><th>{outbound ? '매출' : '매입'}금액(원)</th><th>거래처</th><th>상태</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={`${row.date}-${row.item}`}><td>{row.date}</td><td>{row.item}</td><td>{row.weight}</td><td>{row.amount}</td><td>{row.customer}</td><td><span className={`${classes.exampleStatus} ${outbound ? classes.statusOutbound : ''}`}>{row.status}</span></td></tr>)}{rows.length === 0 && <tr><td colSpan="6" className={classes.exampleNoRows}>검색 결과가 없습니다.</td></tr>}</tbody>
    </table></div>
  </div>;
}

function NewsCard({ item }) {
  const Icon = item.icon;
  return <article className={`${classes.exampleNewsItem} ${item.featured ? classes.newsFeatured : ''}`}>
    <div className={`${classes.exampleNewsThumb} ${item.tone ? classes[`newsTone_${item.tone}`] : ''}`}><Icon size={item.featured ? 27 : 22} /></div>
    <div className={classes.exampleNewsCopy}><div className={classes.exampleNewsTitle}>{item.title}</div><p>{item.description}</p><div className={classes.exampleNewsMeta}>{item.category} · {item.date}</div></div>
  </article>;
}

function localDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
