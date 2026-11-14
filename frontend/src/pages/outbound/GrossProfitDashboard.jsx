// 매출이익 현황판 (메뉴: GROSS_PROFIT_DASHBOARD) - 경영자용
// 거래처별 매출 / 비용 / 순이익, 전월·전년 동월 대비, 톤당 이익, 이익률 하락 거래처, 최근 12개월 추이.
// 세로 스크롤 · 세로 막대 · 원형(도넛) 차트.
// 숫자는 매출이익분석과 같은 계산 (backend/services/outbound/GrossProfitDashboard.py).
import { memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import usePageReactivated from '../../components/common/usePageReactivated';
import XLSX from 'xlsx-js-style';
import { useNavigate } from 'react-router-dom';
import { Box, Button, Group, Loader, Paper, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconAlertTriangle, IconBulb, IconCash, IconChevronRight, IconPercentage, IconReceipt, IconScale, IconTrendingUp, IconCopy, IconDeviceFloppy,
  IconFileSpreadsheet, IconPlus, IconSearch, IconTrash, IconX,
} from '@tabler/icons-react';
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import ErpDateInput from '../../components/common/ErpDateInput';
import { DashboardHeader, FilterBox, FilterTilde, KPI_PALETTE, KpiCard, KpiGrid, TrendPill } from '../../components/common/DashboardKit';
import { PageRibbonContext } from '../../components/layout/MainLayout';
import sharedClasses from '../../styles/pages/ManagementShared.module.css';
import simpleTheme from '../../styles/pages/SimpleTheme.module.css';
import classes from '../../styles/pages/InboundSearch.module.css';
import pageClasses from '../../styles/pages/GrossProfitDashboard.module.css';
import { applyExcelHeaderStyle } from '../../utils/excelHeaderStyle';

// 검증된 범주 팔레트 (순서 고정) · 기타 = 회색 · 손실 = 상태색 critical
const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'];
const OTHER = '#aab6c4';
const COLOR = { sales: PALETTE[0], cost: PALETTE[1], profit: PALETTE[2], loss: '#d03b3b' };
const TOP_N = 10;
const RANK_N = 12;
const AXIS_TICK = { fontSize: 11, fill: '#52514e' };

const pad = (value) => String(value).padStart(2, '0');
const toDate = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const monthRange = (offset) => {
  const now = new Date();
  return { date_from: toDate(new Date(now.getFullYear(), now.getMonth() + offset, 1)), date_to: toDate(new Date(now.getFullYear(), now.getMonth() + offset + 1, 0)) };
};
const PRESETS = {
  this: () => monthRange(0),
  last: () => monthRange(-1),
  quarter: () => { const now = new Date(); return { date_from: toDate(new Date(now.getFullYear(), now.getMonth() - 2, 1)), date_to: toDate(new Date(now.getFullYear(), now.getMonth() + 1, 0)) }; },
  year: () => { const now = new Date(); return { date_from: `${now.getFullYear()}-01-01`, date_to: toDate(new Date(now.getFullYear(), now.getMonth() + 1, 0)) }; },
};
const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });
const won = (value) => `${Math.round(Number(value || 0)).toLocaleString('ko-KR')}원`;
const compact = (value) => {
  const number = Number(value || 0);
  const abs = Math.abs(number);
  if (abs >= 100000000) return `${(number / 100000000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}억`;
  if (abs >= 10000) return `${Math.round(number / 10000).toLocaleString('ko-KR')}만`;
  return Math.round(number).toLocaleString('ko-KR');
};
const pct = (value) => (value === null || value === undefined ? '–' : `${Number(value).toFixed(1)}%`);
const shortName = (name, max = 7) => (String(name || '').length > max ? `${String(name).slice(0, max)}…` : String(name || ''));
const changeRate = (current, previous) => (previous ? ((current - previous) / Math.abs(previous)) * 100 : null);

function Panel({ title, sub, children, className = '', action }) {
  return <Paper className={`${pageClasses.panel} ${className}`} withBorder>
    <div className={pageClasses.panelHeader}>
      <div className={pageClasses.panelTitleWrap}><Text className={pageClasses.panelTitle}>{title}</Text>{sub && <Text className={pageClasses.panelSub}>{sub}</Text>}</div>
      {action}
    </div>
    <Box className={pageClasses.panelBody}>{children}</Box>
  </Paper>;
}

const Empty = ({ loading }) => <Box className={pageClasses.empty}>{loading ? <Loader size="sm" color="red" /> : '데이터가 없습니다.'}</Box>;

// 한눈에 보는 요점: 고정 규칙 + 조회한 숫자로 문장을 만든다
function buildInsights(total, prev, yoy, customers, marginDrops) {
  const items = [];
  const profitDiff = prev ? total.profit - prev.profit : null;
  items.push({ tone: total.profit < 0 ? 'bad' : 'info', text: <>순이익 <b>{won(total.profit)}</b>, 마진율 <b>{pct(total.margin_rate)}</b>
    {profitDiff !== null && prev?.sales ? <> — 전월보다 순이익이 <b>{compact(Math.abs(profitDiff))}원</b> {profitDiff >= 0 ? '늘었습니다' : '줄었습니다'}.</> : '입니다.'}</> });
  if (yoy?.sales) {
    const rate = changeRate(total.sales, yoy.sales);
    items.push({ tone: rate >= 0 ? 'good' : 'warn', text: <>전년 같은 기간보다 매출이 <b>{rate >= 0 ? '+' : '−'}{Math.abs(rate).toFixed(1)}%</b> {rate >= 0 ? '늘었습니다' : '줄었습니다'}.</> });
  }
  const best = [...customers].filter((row) => row.profit > 0).sort((x, y) => y.profit - x.profit)[0];
  if (best && total.profit > 0) items.push({ tone: 'good', text: <>순이익이 가장 큰 거래처는 <b>{best.customname}</b>({compact(best.profit)}원, 전체 순이익의 <b>{((best.profit / total.profit) * 100).toFixed(0)}%</b>)입니다.</> });
  if (total.sales > 0 && customers.length > 3) {
    const top3 = customers.slice(0, 3);
    const share = (top3.reduce((sum, row) => sum + row.sales, 0) / total.sales) * 100;
    items.push({ tone: share >= 70 ? 'warn' : 'info', text: <>매출의 <b>{share.toFixed(0)}%</b>가 상위 3곳({top3.map((row) => row.customname).join(', ')})에서 나옵니다.</> });
  }
  if (total.loss_customer_count > 0) {
    const losers = customers.filter((row) => row.profit < 0).sort((x, y) => x.profit - y.profit);
    items.push({ tone: 'bad', text: <>손해 본 거래처가 <b>{total.loss_customer_count}곳</b>, 손실 합계 <b>{won(Math.abs(total.loss_amount))}</b>입니다 ({losers.slice(0, 3).map((row) => row.customname).join(', ')}{losers.length > 3 ? ` 외 ${losers.length - 3}곳` : ''}).</> });
  }
  if (marginDrops.length) {
    const worst = marginDrops[0];
    items.push({ tone: 'warn', text: <><b>{worst.fullName}</b> 마진율이 전월 {pct(worst.prev)} → {pct(worst.margin)}로 <b>{Math.abs(worst.drop).toFixed(1)}%p</b> 떨어졌습니다{marginDrops.length > 1 ? ` (하락 거래처 ${marginDrops.length}곳)` : ''}.</> });
  }
  return items;
}

// 최근 12개월: 막대 하나 = 매출 (비용 + 순이익 쌓음) · 조회한 달(마지막)만 진하게, 막대 위에 매출 합계 · 작년 같은 달은 툴팁
const TREND_SOFT = { cost: '#dbe3ee', profit: '#a9e0c9' };
const TREND_STRONG = { cost: '#9fb1c8', profit: COLOR.profit };
const TrendChart = memo(function TrendChart({ months }) {
  const last = months.length - 1;
  const data = months.map((row) => {
    const profitPart = Math.max(row.profit, 0);
    return {
      name: `${Number(row.month.slice(5))}월`, fullName: row.month, sales: row.sales, profit: row.profit, cost: row.cost, margin: row.margin_rate,
      lySales: row.ly_sales, lyProfit: row.ly_profit, weight: row.weight,
      profitPart, costPart: Math.max(row.sales - profitPart, 0), label: row.sales > 0 ? compact(row.sales) : '',
    };
  });
  return <ResponsiveContainer width="100%" height={236}>
    <BarChart data={data} margin={{ top: 20, right: 8, bottom: 0, left: 0 }} barCategoryGap="28%">
      <CartesianGrid vertical={false} stroke="#eef1f5" />
      <XAxis dataKey="name" tick={AXIS_TICK} axisLine={{ stroke: '#d5dbe3' }} tickLine={false} />
      <YAxis tickFormatter={compact} width={52} tick={{ fontSize: 10, fill: '#8b95a3' }} axisLine={false} tickLine={false} />
      <Tooltip cursor={{ fill: '#f3f6fa' }} content={({ active, payload }) => {
        if (!active || !payload?.length) return null;
        const row = payload[0].payload;
        return <Paper className={pageClasses.tooltip} shadow="sm" withBorder>
          <Text size="xs" fw={700} mb={5}>{row.fullName}</Text>
          <div className={pageClasses.tooltipRow}><span className={pageClasses.swatch} style={{ background: TREND_STRONG.profit }} />순이익<b className={row.profit < 0 ? pageClasses.kpiLoss : ''}>{won(row.profit)}</b></div>
          <div className={pageClasses.tooltipRow}><span className={pageClasses.swatch} style={{ background: TREND_STRONG.cost }} />비용<b>{won(row.cost)}</b></div>
          <div className={`${pageClasses.tooltipRow} ${pageClasses.tooltipTotal}`}><span className={pageClasses.swatch} />매출<b>{won(row.sales)}</b></div>
          <div className={pageClasses.tooltipRow}><span className={pageClasses.swatch} />마진율<b>{pct(row.margin)}</b></div>
          <div className={pageClasses.tooltipRow}><span className={pageClasses.swatch} />작년 같은 달 매출<b>{won(row.lySales)}</b></div>
          <div className={pageClasses.tooltipRow}><span className={pageClasses.swatch} />작년 같은 달 순이익<b>{won(row.lyProfit)}</b></div>
        </Paper>;
      }} />
      <Bar dataKey="costPart" stackId="sales" name="비용" maxBarSize={30} isAnimationActive={false}>
        {data.map((row, index) => <Cell key={row.fullName} fill={index === last ? TREND_STRONG.cost : TREND_SOFT.cost} />)}
      </Bar>
      <Bar dataKey="profitPart" stackId="sales" name="순이익" maxBarSize={30} radius={[4, 4, 0, 0]} isAnimationActive={false}>
        {data.map((row, index) => <Cell key={row.fullName} fill={index === last ? TREND_STRONG.profit : TREND_SOFT.profit} />)}
        <LabelList dataKey="label" position="top" style={{ fontSize: 10.5, fill: '#33425a', fontWeight: 700 }} />
      </Bar>
    </BarChart>
  </ResponsiveContainer>;
});

const tonFormat = (value) => (value === null || value === undefined ? '–' : `${compact(value)}원`);

// 비율 막대 + 목록 (거래처 잔액 현황의 '미수금 경과 기간'과 같은 방식)
function ShareBar({ slices, total, base }) {
  if (!total) return <div className={pageClasses.empty}>데이터가 없습니다.</div>;
  return <div className={pageClasses.share}>
    <div className={pageClasses.shareBar} role="img" aria-label="비율">
      {slices.filter((slice) => slice.value > 0).map((slice) => {
        const share = (slice.value / total) * 100;
        return <div key={slice.name} className={pageClasses.sharePart} style={{ flexGrow: share, background: slice.color }} title={`${slice.name} ${won(slice.value)} (${share.toFixed(1)}%)`}>
          {share >= 10 && <span className={slice.dark ? pageClasses.shareTextDark : pageClasses.shareText}>{share.toFixed(0)}%</span>}
        </div>;
      })}
    </div>
    <div className={pageClasses.shareLegend}>
      {slices.map((slice) => <div key={slice.name} className={pageClasses.shareRow} title={slice.name}>
        <span className={pageClasses.swatch} style={{ background: slice.color }} />
        <span className={pageClasses.shareName}>{slice.name}</span>
        <span className={pageClasses.sharePct}>{((Math.max(slice.value, 0) / total) * 100).toFixed(1)}%</span>
        <span className={pageClasses.shareValue}>{compact(slice.value)}원</span>
        {base && <span className={pageClasses.shareBase}>매출의 {base ? ((slice.value / base) * 100).toFixed(1) : '–'}%</span>}
      </div>)}
    </div>
  </div>;
}

// 거래처별 손익 순위: 매출 막대(전체 대비 비중) · 순이익 · 마진율 · 전월 대비 순이익. 줄을 누르면 매출이익 분석
function CustomerRanking({ rows, totalSales, avgMargin, onPick }) {
  const max = Math.max(...rows.map((row) => row.sales), 1);
  const marginTone = (rate) => (rate === null || rate === undefined ? pageClasses.marginFlat : rate < 0 ? pageClasses.marginBad : rate >= avgMargin ? pageClasses.marginGood : pageClasses.marginFlat);
  return <div className={pageClasses.rankScroll}>
    <table className={pageClasses.rankTable}>
      <thead><tr><th className={pageClasses.rankNo}>#</th><th>거래처</th><th>매출 · 비중</th><th className={pageClasses.num}>순이익</th><th className={pageClasses.num}>마진율</th><th>전월 대비 순이익</th></tr></thead>
      <tbody>{rows.map((row, index) => <tr key={row.customname || index} tabIndex={0} onClick={() => onPick(row.customname)}
        onKeyDown={(event) => { if (event.key === 'Enter') onPick(row.customname); }} title="누르면 매출이익 분석">
        <td className={pageClasses.rankNo}><span className={index < 3 ? pageClasses.rankTop : pageClasses.rankBadge}>{index + 1}</span></td>
        <td className={pageClasses.rankName}>{row.customname || '(거래처 없음)'}</td>
        <td className={pageClasses.rankSales}>
          <span className={pageClasses.rankTrack}><span style={{ width: `${(row.sales / max) * 100}%` }} /></span>
          <b>{compact(row.sales)}</b><small>{totalSales ? `${((row.sales / totalSales) * 100).toFixed(0)}%` : ''}</small>
        </td>
        <td className={`${pageClasses.num} ${row.profit < 0 ? pageClasses.kpiLoss : pageClasses.strong}`}>{compact(row.profit)}</td>
        <td className={pageClasses.num}><span className={`${pageClasses.marginPill} ${marginTone(row.margin_rate)}`}>{pct(row.margin_rate)}</span></td>
        <td><TrendPill current={row.profit} previous={row.prev_profit || null} note="" emptyText="전월 거래 없음" /></td>
      </tr>)}</tbody>
    </table>
  </div>;
}

// 이익률 하락 거래처: 전월 → 이번 마진율과 하락폭
function MarginDrops({ rows, onPick }) {
  return <div className={pageClasses.dropList}>
    {rows.map((row) => <button key={row.fullName} type="button" className={pageClasses.dropRow} onClick={() => onPick(row.fullName)} title="누르면 매출이익 분석">
      <span className={pageClasses.dropName}>{row.fullName}</span>
      <span className={pageClasses.dropRates}>{pct(row.prev)}<span className={pageClasses.dropArrow}>→</span><b className={row.margin < 0 ? pageClasses.kpiLoss : ''}>{pct(row.margin)}</b></span>
      <span className={pageClasses.dropPill}>▼ {Math.abs(row.drop).toFixed(1)}%p</span>
    </button>)}
  </div>;
}

// 월별 톤당 매출 · 톤당 이익 (원/톤, 같은 축) · 조회한 달만 진하게, 톤당 이익 위에 금액
const PerTonChart = memo(function PerTonChart({ months }) {
  const last = months.length - 1;
  const data = months.map((row, index) => ({
    name: `${Number(row.month.slice(5))}월`, fullName: row.month, sales: row.sales_per_ton, profit: row.profit_per_ton, ton: Number(row.weight || 0) / 1000,
    label: index === last && row.profit_per_ton !== null ? compact(row.profit_per_ton) : '',
  }));
  return <ResponsiveContainer width="100%" height={240}>
    <BarChart data={data} margin={{ top: 20, right: 8, bottom: 0, left: 0 }} barGap={2} barCategoryGap="26%">
      <CartesianGrid vertical={false} stroke="#eef1f5" />
      <XAxis dataKey="name" tick={AXIS_TICK} axisLine={{ stroke: '#d5dbe3' }} tickLine={false} />
      <YAxis tickFormatter={compact} width={52} tick={{ fontSize: 10, fill: '#8b95a3' }} axisLine={false} tickLine={false} />
      <Tooltip cursor={{ fill: '#f3f6fa' }} content={({ active, payload }) => {
        if (!active || !payload?.length) return null;
        const row = payload[0].payload;
        return <Paper className={pageClasses.tooltip} shadow="sm" withBorder>
          <Text size="xs" fw={700} mb={5}>{row.fullName}</Text>
          <div className={pageClasses.tooltipRow}><span className={pageClasses.swatch} style={{ background: COLOR.sales }} />톤당 매출<b>{tonFormat(row.sales)}</b></div>
          <div className={pageClasses.tooltipRow}><span className={pageClasses.swatch} style={{ background: COLOR.profit }} />톤당 이익<b>{tonFormat(row.profit)}</b></div>
          <div className={`${pageClasses.tooltipRow} ${pageClasses.tooltipTotal}`}><span className={pageClasses.swatch} />판매<b>{row.ton.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}톤</b></div>
        </Paper>;
      }} />
      <Bar dataKey="sales" name="톤당 매출" maxBarSize={16} radius={[4, 4, 0, 0]} isAnimationActive={false}>
        {data.map((row, index) => <Cell key={row.fullName} fill={index === last ? COLOR.sales : '#bcd6f3'} />)}
      </Bar>
      <Bar dataKey="profit" name="톤당 이익" maxBarSize={16} radius={[4, 4, 0, 0]} isAnimationActive={false}>
        {data.map((row, index) => <Cell key={row.fullName} fill={(row.profit ?? 0) < 0 ? COLOR.loss : index === last ? COLOR.profit : '#a9e0c9'} />)}
      </Bar>
    </BarChart>
  </ResponsiveContainer>;
});

const topSlices = (rows, valueKey, nameKey) => {
  const positive = rows.filter((row) => row[valueKey] > 0);
  const top = positive.slice(0, 5).map((row, index) => ({ name: row[nameKey] || '(없음)', value: row[valueKey], color: PALETTE[index] }));
  const rest = positive.slice(5).reduce((sum, row) => sum + row[valueKey], 0);
  return rest > 0 ? [...top, { name: `기타 ${positive.length - 5}곳`, value: rest, color: OTHER, dark: true }] : top;
};

export default function GrossProfitDashboard() {
  const ribbon = useContext(PageRibbonContext);
  const registerRibbon = ribbon?.registerPageRibbon;
  const closePage = ribbon?.closeActivePage;
  const navigate = useNavigate();
  const [inputs, setInputs] = useState(() => PRESETS.this());
  const [period, setPeriod] = useState(() => PRESETS.this());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);

  const load = useCallback(async (requested) => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      const response = await axios.get('/api/gross-profit-dashboard/summary', { ...authConfig(), params: requested });
      if (id === requestId.current) setData(response.data);
    } catch (error) {
      if (id === requestId.current) notifications.show({ title: '매출이익 현황판 조회 실패', message: error.response?.data?.detail || '현황판을 불러오지 못했습니다.', color: 'red' });
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);
  // 탭에 돌아오면 지금 조건 그대로 다시 불러온다 (다른 탭에서 데이터가 바뀌었을 수 있음)
  usePageReactivated(() => { void load(period); });
  useEffect(() => { void load(period); }, [load, period]);

  const search = useCallback(() => {
    if (!inputs.date_from || !inputs.date_to || inputs.date_from > inputs.date_to) {
      notifications.show({ title: '조회 조건 확인', message: '기간을 올바르게 입력해 주세요.', color: 'orange' });
      return;
    }
    setPeriod({ ...inputs });
  }, [inputs]);
  // 거래처를 누르면 매출이익분석으로 (같은 기간 · 그 거래처)
  const openDetail = useCallback((customer) => {
    const query = new URLSearchParams({ date_from: period.date_from, date_to: period.date_to, ...(customer ? { customer } : {}) });
    navigate(`/GrossProfit?${query.toString()}`);
  }, [navigate, period]);

  const exportExcel = useCallback(() => {
    if (!data?.customers?.length) { notifications.show({ title: '엑셀 데이터 없음', message: '다운로드할 데이터가 없습니다.', color: 'orange' }); return; }
    const sheetRows = data.customers.map((row) => ({
      거래처: row.customname, 매출: Math.round(row.sales), 매입원가: Math.round(row.cost_of_goods), 판매비용: Math.round(row.selling_cost),
      비용합계: Math.round(row.cost), 순이익: Math.round(row.profit), '마진율(%)': row.margin_rate, '매출비중(%)': row.share,
      전월매출: Math.round(row.prev_sales), '매출 전월대비(%)': changeRate(row.sales, row.prev_sales) === null ? '' : Number(changeRate(row.sales, row.prev_sales).toFixed(1)),
      전월순이익: Math.round(row.prev_profit), '전월 마진율(%)': row.prev_margin_rate ?? '',
      '톤당 매출(원)': row.sales_per_ton ?? '', '톤당 이익(원)': row.profit_per_ton ?? '',
    }));
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(sheetRows);
    applyExcelHeaderStyle(worksheet, Object.keys(sheetRows[0]).length);
    XLSX.utils.book_append_sheet(workbook, worksheet, '거래처별 매출이익');
    XLSX.writeFile(workbook, `매출이익현황_${period.date_from.replaceAll('-', '')}_${period.date_to.replaceAll('-', '')}.xlsx`);
  }, [data, period]);

  const hasData = Boolean(data?.customers?.length);
  const actions = useRef({});
  useLayoutEffect(() => { actions.current = { search, exportExcel }; });
  useEffect(() => {
    if (!registerRibbon) return undefined;
    registerRibbon(
      <Group className={classes.commandRibbon} justify="flex-start" wrap="nowrap" gap={2}>
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconSearch size={15} />} onClick={() => actions.current.search()}>조회</Button>
        <span className={classes.ribbonSeparator} />
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconPlus size={15} />} disabled>추가</Button>
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconCopy size={15} />} disabled>복사</Button>
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconFileSpreadsheet size={15} />} onClick={() => actions.current.exportExcel()} disabled={!hasData}>엑셀</Button>
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconDeviceFloppy size={15} />} disabled>저장</Button>
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconTrash size={15} />} disabled>삭제</Button>
        <span className={classes.ribbonSeparator} />
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconX size={15} />} onClick={closePage}>닫기</Button>
      </Group>,
    );
    return () => registerRibbon(null);
  }, [registerRibbon, closePage, hasData]);

  const total = data?.total;
  const prev = data?.prev_total;
  const yoy = data?.yoy_total;
  const salesSlices = useMemo(() => topSlices(data?.customers || [], 'sales', 'customname'), [data]);
  const costSlices = useMemo(() => (total ? [
    { name: '매입금액', value: total.purchase_amt, color: PALETTE[0] },
    { name: '매입비용', value: total.purchase_cost, color: PALETTE[1] },
    { name: '가공비', value: total.process_amt, color: PALETTE[2] },
    { name: '원자재원가', value: total.material_amt, color: PALETTE[4] },
    { name: '판매비용', value: total.selling_cost, color: PALETTE[3] },
  ].filter((slice) => slice.value > 0) : []), [total]);
  const marginDrops = useMemo(() => (data?.customers || [])
    .filter((row) => row.margin_rate !== null && row.prev_margin_rate !== null && row.prev_margin_rate !== undefined && row.margin_rate < row.prev_margin_rate)
    .map((row) => ({ name: shortName(row.customname, 6), fullName: row.customname, prev: row.prev_margin_rate, margin: row.margin_rate, drop: row.margin_rate - row.prev_margin_rate }))
    .sort((a, b) => a.drop - b.drop).slice(0, TOP_N), [data]);
  const hasPrevMargins = useMemo(() => (data?.customers || []).some((row) => row.prev_margin_rate !== null && row.prev_margin_rate !== undefined), [data]);

  const tons = (Number(total?.weight || 0) / 1000).toLocaleString('ko-KR', { maximumFractionDigits: 1 });
  const yoyText = (key, unit = '%') => {
    if (!yoy) return '–';
    if (unit === '%p') return yoy[key] === null || yoy[key] === undefined || total[key] === null ? '–' : `${total[key] - yoy[key] >= 0 ? '+' : '−'}${Math.abs(total[key] - yoy[key]).toFixed(1)}%p`;
    const rate = changeRate(total[key], yoy[key]);
    return rate === null ? '–' : `${rate >= 0 ? '+' : '−'}${Math.abs(rate).toFixed(1)}%`;
  };
  const amount = (value) => Math.round(Number(value || 0)).toLocaleString('ko-KR');
  const kpis = total ? [
    { key: 'sales', palette: KPI_PALETTE.blue, icon: IconCash, label: '매출', basis: '판매 + 매출비용(+)', value: amount(total.sales),
      trend: <TrendPill current={total.sales} previous={prev?.sales} />,
      stats: [{ label: '판매중량', value: `${tons}톤` }, { label: '전년 동월 대비', value: yoyText('sales') }] },
    { key: 'cost', palette: KPI_PALETTE.orange, icon: IconReceipt, label: '비용', basis: '매입원가 + 판매비용', value: amount(total.cost),
      trend: <TrendPill current={total.cost} previous={prev?.cost} goodWhenUp={false} />,
      stats: [{ label: '매입원가', value: `${compact(total.cost_of_goods)}원` }, { label: '판매비용', value: `${compact(total.selling_cost)}원` }] },
    { key: 'profit', palette: KPI_PALETTE.green, icon: IconTrendingUp, label: '순이익', basis: '매출 − 비용', value: amount(total.profit), negative: total.profit < 0,
      trend: <TrendPill current={total.profit} previous={prev?.profit} />,
      stats: [{ label: '손해 본 거래처', value: total.loss_customer_count ? `${total.loss_customer_count}곳` : '없음', warn: total.loss_customer_count > 0 }, { label: '전년 동월 대비', value: yoyText('profit') }] },
    { key: 'margin', palette: KPI_PALETTE.slate, icon: IconPercentage, label: '마진율', basis: '순이익 ÷ 매출', value: total.margin_rate === null ? '–' : Number(total.margin_rate).toFixed(1), unit: total.margin_rate === null ? '' : '%', negative: total.profit < 0,
      trend: <TrendPill mode="point" current={total.margin_rate} previous={prev?.margin_rate} />,
      stats: [{ label: '전월 마진율', value: pct(prev?.margin_rate) }, { label: '전년 동월 대비', value: yoyText('margin_rate', '%p') }] },
    { key: 'perton', palette: KPI_PALETTE.amber, icon: IconScale, label: '톤당 이익', basis: '순이익 ÷ 판매중량', value: total.profit_per_ton === null ? '–' : amount(total.profit_per_ton), unit: total.profit_per_ton === null ? '' : '원', negative: (total.profit_per_ton ?? 0) < 0,
      trend: <TrendPill current={total.profit_per_ton} previous={prev?.profit_per_ton} />,
      stats: [{ label: '톤당 매출', value: tonFormat(total.sales_per_ton) }, { label: '판매 건수', value: `${Number(total.line_count || 0).toLocaleString('ko-KR')}줄` }] },
  ] : [];
  const insights = total ? buildInsights(total, prev, yoy, data.customers || [], marginDrops) : [];

  return (
    <Box className={`${sharedClasses.pageShell} ${classes.page} ${pageClasses.page} ${simpleTheme.simple}`}>
      <DashboardHeader parent="매출관리" title="매출이익 현황">
        <FilterBox onSearch={search} loading={loading}>
          <ErpDateInput aria-label="시작일" type="date" value={inputs.date_from} onChange={(event) => { const { value } = event.currentTarget; setInputs((current) => ({ ...current, date_from: value })); }} />
          <FilterTilde />
          <ErpDateInput aria-label="종료일" type="date" value={inputs.date_to} onChange={(event) => { const { value } = event.currentTarget; setInputs((current) => ({ ...current, date_to: value })); }} />
        </FilterBox>
      </DashboardHeader>

      <Box className={pageClasses.scroll}>
        {total ? <KpiGrid count={kpis.length}>
          {kpis.map(({ key, ...kpi }) => <KpiCard key={key} {...kpi} />)}
        </KpiGrid> : <Box className={pageClasses.kpiEmpty}><Empty loading={loading} /></Box>}

        <Box className={pageClasses.row2_1}>
          <Panel title="최근 12개월 추이" sub="막대 전체 = 매출 (비용 + 순이익) · 진한 막대 = 조회한 달 · 작년 같은 달은 막대에 마우스">
            {data ? <>
              <div className={pageClasses.monthSummary}>
                <div className={pageClasses.monthStat}><span className={pageClasses.monthStatLabel}>기간 매출</span><span className={pageClasses.monthStatValue}>{compact(total.sales)}원</span><span className={pageClasses.statTrend}><TrendPill current={total.sales} previous={prev?.sales} /></span></div>
                <div className={pageClasses.monthStat}><span className={pageClasses.monthStatLabel}>순이익</span><span className={`${pageClasses.monthStatValue} ${total.profit < 0 ? pageClasses.kpiLoss : pageClasses.profitText}`}>{compact(total.profit)}원</span><span className={pageClasses.statTrend}><TrendPill current={total.profit} previous={prev?.profit} /></span></div>
                <div className={pageClasses.monthStat}><span className={pageClasses.monthStatLabel}>마진율</span><span className={pageClasses.monthStatValue}>{pct(total.margin_rate)}</span><span className={pageClasses.statTrend}><TrendPill mode="point" current={total.margin_rate} previous={prev?.margin_rate} /></span></div>
                <div className={pageClasses.monthStat}><span className={pageClasses.monthStatLabel}>판매중량</span><span className={pageClasses.monthStatValue}>{tons}톤</span><span className={pageClasses.statTrend}><TrendPill current={total.weight} previous={prev?.weight} /></span></div>
              </div>
              <div className={pageClasses.monthLegend}>
                <span><i className={pageClasses.swatch} style={{ background: TREND_STRONG.profit }} />순이익</span>
                <span><i className={pageClasses.swatch} style={{ background: TREND_STRONG.cost }} />비용</span>
              </div>
              <TrendChart months={data.trend} />
            </> : <Empty loading={loading} />}
          </Panel>
          <Paper className={`${pageClasses.panel} ${pageClasses.flowPanel}`} withBorder>
            <div className={pageClasses.flowTop}>
              <span className={pageClasses.flowTitle}>조회기간 손익</span>
              {total ? <>
                <div className={pageClasses.flowRow}><span>매출</span><b className={pageClasses.flowIn}>+{compact(total.sales)}원</b></div>
                <div className={pageClasses.flowRow}><span>비용 <small>매입원가 + 판매비용</small></span><b className={pageClasses.flowOut}>−{compact(total.cost)}원</b></div>
                <div className={`${pageClasses.flowRow} ${pageClasses.flowNet}`}><span>순이익 <small>마진율 {pct(total.margin_rate)}</small></span><b>{total.profit < 0 ? '−' : '+'}{compact(Math.abs(total.profit))}원</b></div>
              </> : <span className={pageClasses.flowEmpty}>{loading ? '불러오는 중…' : '데이터가 없습니다.'}</span>}
            </div>
            <div className={pageClasses.pointHead}><span className={pageClasses.pointTitle}><IconBulb size={16} stroke={1.9} />한눈에 보는 요점</span><span className={pageClasses.pointSub}>이 화면의 숫자로 자동 작성</span></div>
            {insights.length
              ? <ol className={pageClasses.points}>{insights.map((item, index) => <li key={index} className={pageClasses[`point_${item.tone}`]}>
                <span className={pageClasses.pointRank}>{item.tone === 'bad' || item.tone === 'warn' ? <IconAlertTriangle size={12} stroke={2.2} /> : index + 1}</span>
                <span className={pageClasses.pointText}>{item.text}</span>
              </li>)}</ol>
              : <Empty loading={loading} />}
          </Paper>
        </Box>

        <Box className={pageClasses.row2_1}>
          <Panel title="거래처별 손익 순위" sub={`매출 상위 ${Math.min(RANK_N, data?.customers?.length || 0)}곳 · 줄을 누르면 매출이익 분석`}
            action={hasData ? <button type="button" className={pageClasses.moreLink} onClick={() => openDetail('')}>거래처별 상세 보기 (전체 {data.customers.length}곳)<IconChevronRight size={13} /></button> : null}
            className={pageClasses.tablePanel}>
            {hasData ? <CustomerRanking rows={data.customers.slice(0, RANK_N)} totalSales={total.sales} avgMargin={total.margin_rate ?? 0} onPick={openDetail} /> : <Empty loading={loading} />}
          </Panel>
          <Panel title="매출 · 비용 구성" sub="비율 막대 · 금액">
            {hasData ? <>
              <div className={pageClasses.sectionLabel}>매출 비중 <small>거래처 상위 5곳 + 기타</small></div>
              <ShareBar slices={salesSlices} total={salesSlices.reduce((sum, slice) => sum + Math.max(slice.value, 0), 0)} />
              <div className={`${pageClasses.sectionLabel} ${pageClasses.sectionGap}`}>비용 구성 <small>총 {compact(total.cost)}원</small></div>
              <ShareBar slices={costSlices} total={costSlices.reduce((sum, slice) => sum + Math.max(slice.value, 0), 0)} base={total.sales} />
            </> : <Empty loading={loading} />}
          </Panel>
        </Box>

        <Box className={pageClasses.row1_1}>
          <Panel title="이익률 하락 거래처" sub="전월보다 마진율이 떨어진 곳 · 하락폭 큰 순 · 누르면 매출이익 분석">
            {marginDrops.length ? <MarginDrops rows={marginDrops} onPick={openDetail} />
              : hasData ? <Box className={pageClasses.empty}>{hasPrevMargins ? '전월보다 이익률이 떨어진 거래처가 없습니다.' : '전월 거래가 없어 비교할 수 없습니다.'}</Box>
                : <Empty loading={loading} />}
          </Panel>
          <Panel title="톤당 매출 · 톤당 이익" sub="월별 · 원/톤 (판매중량 기준) · 진한 막대 = 조회한 달">
            {data ? <>
              <div className={pageClasses.monthLegend}>
                <span><i className={pageClasses.swatch} style={{ background: COLOR.sales }} />톤당 매출</span>
                <span><i className={pageClasses.swatch} style={{ background: COLOR.profit }} />톤당 이익</span>
              </div>
              <PerTonChart months={data.trend} />
            </> : <Empty loading={loading} />}
          </Panel>
        </Box>

      </Box>
    </Box>
  );
}
