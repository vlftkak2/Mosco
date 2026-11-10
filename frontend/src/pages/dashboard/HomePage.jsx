// 대시보드 (메뉴: HOME) - 실제 전표 기준.
// 숫자는 각 전용 화면과 같은 계산 (backend/services/dashboard/HomeOverview.py):
//   매출 · 매출이익 · 월별 추이 = 매출이익 현황, 미수금 = 거래처 잔액 현황, 매입 = 매입 전표 공급가액,
//   장기재고 = 현재고의 입고일 · 기초재고일부터 오늘까지 경과일.
// 매출이익 · 미수금은 그 메뉴 권한이 있는 사용자에게만 보인다.
import { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { Loader, Paper, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconBox, IconChartBar, IconChevronRight, IconCloud, IconCloudFog,
  IconCloudRain, IconCloudStorm, IconCoins, IconDroplet, IconExternalLink, IconNews, IconSearch, IconShoppingCart, IconSnowflake,
  IconSun, IconSunHigh, IconTrendingUp, IconUmbrella,
} from '@tabler/icons-react';
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import ErpDateInput from '../../components/common/ErpDateInput';
import { DashboardHeader, FilterBox, FilterTilde, KPI_PALETTE, KpiCard, KpiGrid, PillNote, SubSep, TrendPill } from '../../components/common/DashboardKit';
import useErpPageRibbon from '../../components/common/useErpPageRibbon';
import usePageReactivated from '../../components/common/usePageReactivated';
import { MenuAccessContext } from '../../components/layout/MainLayout';
import sharedClasses from '../../styles/pages/ManagementShared.module.css';
import searchClasses from '../../styles/pages/InboundSearch.module.css';
import classes from '../../styles/pages/HomeDashboard.module.css';

// 검증된 범주 팔레트 (순서 고정) · 장기재고는 파랑 한 가지 색의 밝음→어두움 (오래될수록 진하게)
const KPI_COLOR = { sales: KPI_PALETTE.blue, purchase: KPI_PALETTE.orange, profit: KPI_PALETTE.green, recv: KPI_PALETTE.amber, stock: KPI_PALETTE.slate };
const COST_COLOR = { past: '#dbe3ee', current: '#9fb1c8' };
const PROFIT_COLOR = { past: '#a9e0c9', current: '#1baf7a' };
const SALES_COLOR = { past: '#bcd6f3', current: '#2a78d6' };
const AGING_COLORS = { m6: '#cfe1f7', y1: '#9cc2ee', y2: '#5f9be0', y3: '#2a78d6', over3: '#1a4f94', unknown: '#c3cad4' };
const AXIS_TICK = { fontSize: 11, fill: '#5d6b80' };

const pad = (value) => String(value).padStart(2, '0');
const toDate = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const thisMonth = () => { const now = new Date(); return { date_from: toDate(new Date(now.getFullYear(), now.getMonth(), 1)), date_to: toDate(now) }; };
const todayLabel = () => new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });
const toNumber = (value) => Number(value || 0);
const won = (value) => `${Math.round(toNumber(value)).toLocaleString('ko-KR')}원`;
const compact = (value) => {
  const number = toNumber(value);
  const abs = Math.abs(number);
  if (abs >= 100000000) return `${(number / 100000000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}억`;
  if (abs >= 10000) return `${Math.round(number / 10000).toLocaleString('ko-KR')}만`;
  return Math.round(number).toLocaleString('ko-KR');
};
const tons = (kg) => `${(toNumber(kg) / 1000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}톤`;
const kgText = (kg) => toNumber(kg).toLocaleString('ko-KR', { maximumFractionDigits: 1 });
const pctText = (value) => (value === null || value === undefined ? '–' : `${toNumber(value).toFixed(1)}%`);
const dateText = (value) => String(value || '').slice(0, 10);
const shortDate = (value) => dateText(value).slice(5).replace('-', '.');
const monthLabel = (month) => `${Number(String(month).slice(5, 7))}월`;
const ageText = (days) => (days >= 365 ? `${(days / 365).toFixed(1)}년` : `${Math.round(days / 30)}개월`);
const specText = (row) => [row.thickness, row.width, row.length].map(toNumber).filter((value) => value > 0)
  .map((value) => value.toLocaleString('ko-KR', { maximumFractionDigits: 3, useGrouping: false })).join('×');

// 전월 같은 기간 대비 알약 (공통 부품) · unit '%p' 이면 마진율처럼 %p 차이
const Trend = ({ unit = '%', ...props }) => (unit === '%p'
  ? <TrendPill {...props} mode="point" note="전월 대비" />
  : <TrendPill {...props} mode="rate" note="전월 같은 기간 대비" emptyText="전월 같은 기간 실적 없음" />);
const Kpi = ({ tone, ...props }) => <KpiCard palette={KPI_COLOR[tone]} {...props} />;

function Panel({ title, sub, action, children, className = '' }) {
  return <Paper className={`${classes.panel} ${className}`} withBorder>
    <div className={classes.panelHead}>
      <div className={classes.panelTitleWrap}><Text className={classes.panelTitle}>{title}</Text>{sub && <Text className={classes.panelSub}>{sub}</Text>}</div>
      {action}
    </div>
    <div className={classes.panelBody}>{children}</div>
  </Paper>;
}
const Empty = ({ loading, text = '데이터가 없습니다.' }) => <div className={classes.empty}>{loading ? <Loader size="sm" color="red" /> : text}</div>;
const MoreLink = ({ onClick, children = '전체보기' }) => (onClick
  ? <button type="button" className={classes.moreLink} onClick={onClick}>{children}<IconChevronRight size={13} /></button> : null);

// 월별 매출 = 비용 + 매출이익 (쌓은 막대, 금액 축 하나) · 조회한 달은 진하게, 막대 위에 매출 합계
const MonthlyChart = memo(function MonthlyChart({ data, showProfit }) {
  const last = data.length - 1;
  return <ResponsiveContainer width="100%" height={240}>
    <BarChart data={data} margin={{ top: 20, right: 8, bottom: 0, left: 0 }} barCategoryGap="28%">
      <CartesianGrid vertical={false} stroke="#eef1f5" />
      <XAxis dataKey="name" tick={AXIS_TICK} axisLine={{ stroke: '#d5dbe3' }} tickLine={false} />
      <YAxis tickFormatter={compact} width={52} tick={{ fontSize: 10, fill: '#8b95a3' }} axisLine={false} tickLine={false} />
      <Tooltip cursor={{ fill: '#f3f6fa' }} content={({ active, payload }) => {
        if (!active || !payload?.length) return null;
        const row = payload[0].payload;
        return <Paper className={classes.tooltip} withBorder shadow="sm">
          <Text size="xs" fw={700} mb={4}>{row.month}</Text>
          {showProfit ? <>
            <div className={classes.tooltipRow}><span className={classes.swatch} style={{ background: PROFIT_COLOR.current }} />매출이익<b>{won(row.profit)}</b></div>
            <div className={classes.tooltipRow}><span className={classes.swatch} style={{ background: COST_COLOR.current }} />비용<b>{won(row.cost)}</b></div>
            <div className={`${classes.tooltipRow} ${classes.tooltipTotal}`}><span className={classes.swatch} style={{ background: 'transparent' }} />매출<b>{won(row.sales)}</b></div>
            <div className={classes.tooltipRow}><span className={classes.swatch} style={{ background: 'transparent' }} />마진율<b>{pctText(row.margin)}</b></div>
          </> : <div className={classes.tooltipRow}><span className={classes.swatch} style={{ background: SALES_COLOR.current }} />매출<b>{won(row.sales)}</b></div>}
          <div className={classes.tooltipRow}><span className={classes.swatch} style={{ background: 'transparent' }} />판매중량<b>{tons(row.weight)}</b></div>
        </Paper>;
      }} />
      {showProfit ? <>
        <Bar dataKey="costPart" stackId="sales" name="비용" maxBarSize={30} isAnimationActive={false}>
          {data.map((row, index) => <Cell key={row.month} fill={index === last ? COST_COLOR.current : COST_COLOR.past} />)}
        </Bar>
        <Bar dataKey="profitPart" stackId="sales" name="매출이익" maxBarSize={30} radius={[4, 4, 0, 0]} isAnimationActive={false}>
          {data.map((row, index) => <Cell key={row.month} fill={index === last ? PROFIT_COLOR.current : PROFIT_COLOR.past} />)}
          <LabelList dataKey="label" position="top" style={{ fontSize: 10.5, fill: '#33425a', fontWeight: 700 }} />
        </Bar>
      </> : <Bar dataKey="sales" name="매출" maxBarSize={30} radius={[4, 4, 0, 0]} isAnimationActive={false}>
        {data.map((row, index) => <Cell key={row.month} fill={index === last ? SALES_COLOR.current : SALES_COLOR.past} />)}
        <LabelList dataKey="label" position="top" style={{ fontSize: 10.5, fill: '#33425a', fontWeight: 700 }} />
      </Bar>}
    </BarChart>
  </ResponsiveContainer>;
});

// 최근 매입 / 매출 전표 (전표 한 장 = 한 줄)
function RecentTable({ title, rows, kind, onMore, loading }) {
  return <Panel title={title} sub={`조회기간 · 최근 ${rows.length}건`} action={<MoreLink onClick={onMore} />} className={classes.tablePanel}>
    {rows.length ? <div className={classes.tableScroll}>
      <table className={classes.table}>
        <thead><tr><th>일자</th><th>거래처</th><th>품목 · 규격</th><th className={classes.num}>중량(kg)</th><th className={classes.num}>{kind === 'in' ? '매입' : '매출'}금액</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.receiptno} title={row.receiptno}>
          <td className={classes.dateCell}>{shortDate(row.receptdate)}</td>
          <td className={classes.nameCell}>{row.customname || '-'}</td>
          <td className={classes.itemCell}>{row.itemname || '-'}{row.spec ? <span className={classes.spec}> {row.spec}</span> : null}
            {row.line_count > 1 && <span className={classes.more}> 외 {row.line_count - 1}건</span>}</td>
          <td className={classes.num}>{kgText(row.weight)}</td>
          <td className={`${classes.num} ${classes.strong}`}>{toNumber(row.amount).toLocaleString('ko-KR')}</td>
        </tr>)}</tbody>
      </table>
    </div> : <Empty loading={loading} text="조회기간에 전표가 없습니다." />}
  </Panel>;
}

// 장기재고: 경과 기간별 비율 막대 + 구간별 중량 · 금액
function StockAging({ stock }) {
  const total = toNumber(stock.total_weight);
  if (!total) return <Empty text="남은 재고가 없습니다." />;
  const parts = stock.buckets.filter((row) => toNumber(row.weight) > 0);
  return <div className={classes.aging}>
    <div className={classes.agingHead}>
      <div><span className={classes.agingBig}>{((toNumber(stock.long_weight) / total) * 100).toFixed(1)}%</span><span className={classes.agingBigLabel}>1년 넘은 재고 비중</span></div>
      <div className={classes.agingTotals}>총 재고 <b>{tons(total)}</b> · 재고금액 <b>{compact(stock.total_amount)}원</b></div>
    </div>
    <div className={classes.agingBar} role="img" aria-label="재고 경과 기간 비율">
      {parts.map((row) => {
        const share = (toNumber(row.weight) / total) * 100;
        return <div key={row.key} className={classes.agingPart} style={{ flexGrow: share, background: AGING_COLORS[row.key] }} title={`${row.label} ${tons(row.weight)} (${share.toFixed(1)}%)`}>
          {share >= 9 && <span className={['m6', 'y1', 'unknown'].includes(row.key) ? classes.agingTextDark : classes.agingText}>{share.toFixed(0)}%</span>}
        </div>;
      })}
    </div>
    <div className={classes.agingLegend}>
      {stock.buckets.map((row) => <div key={row.key} className={classes.agingRow}>
        <span className={classes.swatch} style={{ background: AGING_COLORS[row.key] }} />
        <span className={classes.agingName}>{row.label}</span>
        <span className={classes.agingWeight}>{tons(row.weight)}</span>
        <span className={classes.agingPct}>{((toNumber(row.weight) / total) * 100).toFixed(1)}%</span>
        <span className={classes.agingAmount}>{compact(row.amount)}원</span>
      </div>)}
    </div>
  </div>;
}

// 오늘: 시계 (1초마다, 이 칸만 다시 그림)
function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const hours = now.getHours();
  return <div className={classes.clock}>
    <span className={classes.clockAmpm}>{hours < 12 ? '오전' : '오후'}</span>
    <span className={classes.clockTime}>{(hours % 12) || 12}:{pad(now.getMinutes())}<small>{pad(now.getSeconds())}</small></span>
    <span className={classes.clockDate}>{now.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' })}</span>
  </div>;
}

const WEATHER_ICON_PROPS = { size: 34, stroke: 1.6, className: classes.weatherIcon };
const weatherIcon = (condition = '') => {
  if (condition.includes('뇌우')) return <IconCloudStorm {...WEATHER_ICON_PROPS} />;
  if (condition.includes('눈')) return <IconSnowflake {...WEATHER_ICON_PROPS} />;
  if (condition.includes('비') || condition.includes('소나기')) return <IconCloudRain {...WEATHER_ICON_PROPS} />;
  if (condition.includes('안개')) return <IconCloudFog {...WEATHER_ICON_PROPS} />;
  if (condition.includes('흐림') || condition.includes('구름')) return <IconCloud {...WEATHER_ICON_PROPS} />;
  if (condition === '맑음') return <IconSunHigh {...WEATHER_ICON_PROPS} />;
  return <IconSun {...WEATHER_ICON_PROPS} />;
};
const agoText = (value) => {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return '';
  const minutes = Math.max(Math.round((Date.now() - time) / 60000), 0);
  if (minutes < 60) return `${minutes || 1}분 전`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}시간 전`;
  return `${Math.round(minutes / (60 * 24))}일 전`;
};

// 오늘: 시계 · 서울 날씨 · 철강 이슈 (서버가 30분씩 캐시, 외부 연결이 안 되면 그 칸만 비움)
function TodayPanel() {
  const [today, setToday] = useState(null);
  const [failed, setFailed] = useState(false);
  const [refresh, setRefresh] = useState(0);
  // 탭에 돌아오면 다시 받아온다 (서버 캐시라 빠름)
  usePageReactivated(() => setRefresh((value) => value + 1));
  useEffect(() => {
    let alive = true;
    const fetchToday = () => axios.get('/api/dashboard/today', authConfig())
      .then((response) => { if (alive) { setToday(response.data); setFailed(false); } })
      .catch(() => { if (alive) setFailed(true); });
    void fetchToday();
    const timer = window.setInterval(() => { void fetchToday(); }, 30 * 60 * 1000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [refresh]);

  const weather = today?.weather;
  const news = (today?.news || []).slice(0, 5);
  return <Paper className={`${classes.panel} ${classes.todayPanel}`} withBorder>
    <div className={classes.todayTop}>
      <Clock />
      <div className={classes.weather}>
        {weather ? <>
          <div className={classes.weatherMain}>
            {weatherIcon(weather.condition)}
            <span className={classes.weatherTemp}>{weather.temperature}°</span>
          </div>
          <span className={classes.weatherCondition}>{weather.location} · {weather.condition}</span>
          <span className={classes.weatherRange}>최고 <b className={classes.high}>{weather.todayHigh}°</b> · 최저 <b className={classes.low}>{weather.todayLow}°</b></span>
          <span className={classes.weatherMeta}>
            <span title="강수확률"><IconUmbrella size={12} />{weather.rainProbability ?? 0}%</span>
            <span title="습도"><IconDroplet size={12} />{weather.humidity ?? '–'}%</span>
          </span>
        </> : <span className={classes.weatherEmpty}>{failed || today ? '날씨 정보를 불러오지 못했습니다' : '날씨 불러오는 중…'}</span>}
      </div>
    </div>
    <div className={classes.newsHead}>
      <span className={classes.newsTitle}><IconNews size={16} stroke={1.9} />철강 이슈</span>
      <span className={classes.newsSub}>최신 기사 · 누르면 새 창</span>
    </div>
    <div className={classes.newsList}>
      {news.length ? news.map((item, index) => <a key={item.url} className={classes.newsItem} href={item.url} target="_blank" rel="noopener noreferrer">
        <span className={classes.newsRank}>{index + 1}</span>
        <span className={classes.newsBody}>
          <span className={classes.newsText}>{item.title}</span>
          <span className={classes.newsMeta}>{item.source}{item.published_at ? ` · ${agoText(item.published_at)}` : ''}</span>
        </span>
        <IconExternalLink size={13} className={classes.newsLink} />
      </a>) : <div className={classes.newsEmpty}>{today || failed ? '지금은 철강 기사를 불러올 수 없습니다.' : <Loader size="sm" color="red" />}</div>}
    </div>
  </Paper>;
}

export default function HomePage() {
  const navigate = useNavigate();
  const access = useContext(MenuAccessContext);
  const canOpen = useCallback((menuid) => (access.companyid === '001' && access.authority === 'MASTER') || (access.menuids || []).includes(menuid), [access]);
  const go = useCallback((menuid, path) => (canOpen(menuid) ? () => navigate(path) : undefined), [canOpen, navigate]);

  const [inputs, setInputs] = useState(thisMonth);
  const [period, setPeriod] = useState(thisMonth);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const requestId = useRef(0);

  const load = useCallback(async (requested) => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      const response = await axios.get('/api/dashboard/overview', { ...authConfig(), params: requested });
      if (id === requestId.current) setData(response.data);
    } catch (error) {
      if (id === requestId.current) notifications.show({ title: '대시보드 조회 실패', message: error.response?.data?.detail || '대시보드를 불러오지 못했습니다.', color: 'red' });
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);
  useEffect(() => { void load(period); }, [load, period]);
  // 탭에 돌아오면 지금 조건 그대로 다시 불러온다 (다른 화면에서 전표가 바뀌었을 수 있음)
  usePageReactivated(() => { void load(period); });

  const search = useCallback(() => {
    if (!inputs.date_from || !inputs.date_to || inputs.date_from > inputs.date_to) {
      notifications.show({ title: '조회 조건 확인', message: '기간을 올바르게 입력해 주세요.', color: 'orange' });
      return;
    }
    setPeriod({ ...inputs });
  }, [inputs]);
  useErpPageRibbon({ onSearch: search, showPrint: false, useSaveColor: false, disableClose: true });

  const sales = data?.sales;
  const purchase = data?.purchase;
  const profit = data?.profit;
  const balance = data?.balance;
  const stock = data?.stock;

  const monthly = useMemo(() => (sales?.trend || []).map((row, index) => {
    const p = profit?.trend?.[index];
    const total = toNumber(row.sales);
    const profitAmount = toNumber(p?.profit);
    return {
      name: monthLabel(row.month), month: row.month, sales: total, weight: toNumber(row.weight),
      profit: profitAmount, cost: toNumber(p?.cost), margin: p?.margin_rate,
      // 쌓은 막대: 이익이 손실이면 매출 전체를 비용으로 그린다
      profitPart: Math.max(profitAmount, 0), costPart: Math.max(total - Math.max(profitAmount, 0), 0),
      label: total > 0 ? compact(total) : '',
    };
  }), [sales, profit]);

  const filterRows = useCallback((rows) => {
    const query = keyword.trim().toLocaleLowerCase();
    if (!query) return rows || [];
    return (rows || []).filter((row) => [row.receiptno, row.customname, row.itemname, row.spec].some((value) => String(value || '').toLocaleLowerCase().includes(query)));
  }, [keyword]);
  const recentIn = useMemo(() => filterRows(data?.recent_inbound), [data, filterRows]);
  const recentOut = useMemo(() => filterRows(data?.recent_outbound), [data, filterRows]);

  const kpis = [];
  if (data) {
    kpis.push({ key: 'sales', tone: 'sales', icon: IconChartBar, label: '매출', basis: '조회기간 · 공급가액', value: Math.round(toNumber(sales.total.sales)).toLocaleString('ko-KR'),
      trend: <Trend current={sales.total.sales} previous={sales.prev.sales} />, bars: sales.trend.map((row) => row.sales),
      stats: [{ label: '판매중량', value: tons(sales.total.weight) }, { label: '매출 전표', value: `${toNumber(sales.total.slips)}장` }],
      onClick: go('OUTBOUND_SEARCH', '/OutboundSearchPage') });
    kpis.push({ key: 'purchase', tone: 'purchase', icon: IconShoppingCart, label: '매입', basis: '조회기간 · 공급가액', value: Math.round(toNumber(purchase.total.amount)).toLocaleString('ko-KR'),
      trend: <Trend current={purchase.total.amount} previous={purchase.prev.amount} neutral />, bars: (purchase.trend || []).map((row) => row.amount),
      stats: [{ label: '매입중량', value: tons(purchase.total.weight) }, { label: '매입 전표', value: `${toNumber(purchase.total.count)}장` }],
      onClick: go('INBOUND_SEARCH', '/InboundSearchPage') });
    if (profit) kpis.push({ key: 'profit', tone: 'profit', icon: IconTrendingUp, label: '매출이익', basis: '조회기간 · 매출 − 비용', value: Math.round(toNumber(profit.total.profit)).toLocaleString('ko-KR'),
      trend: <Trend current={profit.total.profit} previous={profit.prev.profit} />, bars: profit.trend.map((row) => row.profit),
      stats: [{ label: '매출이익률', value: pctText(profit.total.margin_rate) }, { label: '톤당 이익', value: toNumber(sales.total.weight) > 0 ? `${compact((toNumber(profit.total.profit) / toNumber(sales.total.weight)) * 1000)}원` : '–' }],
      onClick: go('GROSS_PROFIT_DASHBOARD', '/GrossProfitDashboard') });
    if (balance) kpis.push({ key: 'recv', tone: 'recv', icon: IconCoins, label: '미수금', basis: '오늘 기준 · 받을 금액', value: Math.round(toNumber(balance.receivable)).toLocaleString('ko-KR'),
      trend: <PillNote>{balance.receivable_customers}곳에 남아 있음</PillNote>, bars: (balance.trend || []).map((row) => row.recv),
      stats: [{ label: '30일 넘은 미수금', value: toNumber(balance.late) > 0 ? `${compact(balance.late)}원` : '없음', warn: toNumber(balance.late) > 0 }, { label: '미지급금', value: `${compact(balance.payable)}원` }],
      onClick: go('CUSTOMER_BALANCE_DASHBOARD', '/CustomerBalanceDashboard') });
    kpis.push({ key: 'stock', tone: 'stock', icon: IconBox, label: '현재고', basis: '오늘 기준 · 중량', value: (toNumber(stock.total_weight) / 1000).toLocaleString('ko-KR', { maximumFractionDigits: 1 }), unit: '톤',
      trend: <PillNote>재고금액 {compact(stock.total_amount)}원</PillNote>, bars: stock.buckets.filter((row) => row.key !== 'unknown').map((row) => row.weight),
      stats: [{ label: '1년 넘은 재고', value: tons(stock.long_weight), warn: toNumber(stock.long_weight) > 0 }, { label: '장기재고 비중', value: toNumber(stock.total_weight) ? `${((toNumber(stock.long_weight) / toNumber(stock.total_weight)) * 100).toFixed(1)}%` : '–' }],
      onClick: go('STOCK_CURRENT', '/CurrentStockPage') });
  }

  const salesTotal = sales?.total;
  const marginPrev = profit?.prev?.margin_rate;

  return (
    <div className={`${sharedClasses.pageShell} ${searchClasses.page} ${classes.page}`}>
      <DashboardHeader title="대시보드" subtitle={<>{todayLabel()}{data ? <><SubSep />비교 기준: 전월 같은 기간 ({shortDate(data.period.prev_from)} ~ {shortDate(data.period.prev_to)}) · 미수금 · 재고는 오늘 기준</> : null}</>}>
        <FilterBox onSearch={search} loading={loading}>
          <ErpDateInput aria-label="시작일" type="date" value={inputs.date_from} onChange={(event) => { const { value } = event.currentTarget; setInputs((current) => ({ ...current, date_from: value })); }} />
          <FilterTilde />
          <ErpDateInput aria-label="종료일" type="date" value={inputs.date_to} onChange={(event) => { const { value } = event.currentTarget; setInputs((current) => ({ ...current, date_to: value })); }} />
        </FilterBox>
      </DashboardHeader>

      <div className={classes.scroll}>
        {data ? <KpiGrid count={kpis.length}>
          {kpis.map(({ key, ...kpi }) => <Kpi key={key} {...kpi} />)}
        </KpiGrid> : <Empty loading={loading} />}

        <div className={classes.row2_1}>
          <Panel title={profit ? '월별 매출 · 매출이익' : '월별 매출'} sub={profit ? '최근 12개월 · 막대 전체 = 매출 (비용 + 매출이익) · 진한 막대 = 조회한 달' : '최근 12개월 · 진한 막대 = 조회한 달'}
            action={<MoreLink onClick={go('GROSS_PROFIT_DASHBOARD', '/GrossProfitDashboard')}>매출이익 현황</MoreLink>}>
            {data ? <>
              <div className={classes.monthSummary}>
                <div className={classes.monthStat}><span className={classes.monthStatLabel}>기간 매출</span><span className={classes.monthStatValue}>{compact(salesTotal.sales)}원</span><span className={classes.statTrend}><Trend current={salesTotal.sales} previous={sales.prev.sales} /></span></div>
                {profit && <div className={classes.monthStat}><span className={classes.monthStatLabel}>매출이익</span><span className={`${classes.monthStatValue} ${classes.profitText}`}>{compact(profit.total.profit)}원</span><span className={classes.statTrend}><Trend current={profit.total.profit} previous={profit.prev.profit} /></span></div>}
                {profit && <div className={classes.monthStat}><span className={classes.monthStatLabel}>매출이익률</span><span className={classes.monthStatValue}>{pctText(profit.total.margin_rate)}</span><span className={classes.statTrend}><Trend current={profit.total.margin_rate} previous={marginPrev} unit="%p" /></span></div>}
                <div className={classes.monthStat}><span className={classes.monthStatLabel}>판매중량</span><span className={classes.monthStatValue}>{tons(salesTotal.weight)}</span><span className={classes.statTrend}><Trend current={salesTotal.weight} previous={sales.prev.weight} /></span></div>
              </div>
              <div className={classes.monthLegend}>
                {profit ? <>
                  <span><i className={classes.swatch} style={{ background: PROFIT_COLOR.current }} />매출이익</span>
                  <span><i className={classes.swatch} style={{ background: COST_COLOR.current }} />비용</span>
                </> : <span><i className={classes.swatch} style={{ background: SALES_COLOR.current }} />매출</span>}
                <span className={classes.current}>{monthly.length ? `${monthly[monthly.length - 1].name} = 조회한 달` : ''}</span>
              </div>
              <MonthlyChart data={monthly} showProfit={Boolean(profit)} />
            </> : <Empty loading={loading} />}
          </Panel>
          <TodayPanel />
        </div>

        <div className={classes.tableHead}>
          <Text className={classes.sectionTitle}>최근 매입 · 매출 전표</Text>
          <TextInput size="xs" className={classes.tableSearch} leftSection={<IconSearch size={13} />} placeholder="거래처, 품목, 규격, 전표번호 검색"
            value={keyword} onChange={(event) => setKeyword(event.currentTarget.value)} aria-label="최근 전표 검색" />
        </div>
        <div className={classes.row1_1}>
          <RecentTable title="최근 매입" kind="in" rows={recentIn} loading={loading} onMore={go('INBOUND_SEARCH', '/InboundSearchPage')} />
          <RecentTable title="최근 매출" kind="out" rows={recentOut} loading={loading} onMore={go('OUTBOUND_SEARCH', '/OutboundSearchPage')} />
        </div>

        <div className={classes.row1_1}>
          <Panel title="장기재고" sub="입고일 · 기초재고일부터 오늘까지 경과 기간 (중량 기준)" action={<MoreLink onClick={go('STOCK_CURRENT', '/CurrentStockPage')}>현재고 현황</MoreLink>}>
            {stock ? <StockAging stock={stock} /> : <Empty loading={loading} />}
          </Panel>
          <Panel title="오래된 재고" sub="1년 넘은 재고 · 오래된 순 · 재고이동한 재고는 처음 입고일 기준" className={classes.tablePanel}>
            {stock?.oldest?.length ? <div className={classes.tableScroll}>
              <table className={classes.table}>
                <thead><tr><th>입고일</th><th className={classes.num}>경과</th><th>품목 · 규격</th><th>창고</th><th className={classes.num}>중량(kg)</th></tr></thead>
                <tbody>{stock.oldest.map((row, index) => <tr key={index}>
                  <td className={classes.dateCell}>{dateText(row.agedate)}{row.kind === 'OPENING' && <span className={classes.kindTag}>기초</span>}</td>
                  <td className={`${classes.num} ${row.days >= 1096 ? classes.oldText : ''}`}>{ageText(row.days)}</td>
                  <td className={classes.itemCell}>{row.itemname || '-'}<span className={classes.spec}> {specText(row)}</span></td>
                  <td>{row.warehousecodename || '-'}</td>
                  <td className={`${classes.num} ${classes.strong}`}>{kgText(row.weight)}</td>
                </tr>)}</tbody>
              </table>
            </div> : <Empty loading={loading} text="1년 넘은 재고가 없습니다." />}
          </Panel>
        </div>
      </div>
    </div>
  );
}
