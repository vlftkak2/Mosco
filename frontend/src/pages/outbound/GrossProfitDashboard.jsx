// 매출이익 현황판 (메뉴: GROSS_PROFIT_DASHBOARD) - 경영자용
// 거래처별 매출 / 비용 / 순이익, 전월·전년 동월 대비, 톤당 이익, 이익률 하락 거래처, 최근 12개월 추이.
// 세로 스크롤 · 세로 막대 · 원형(도넛) 차트.
// 숫자는 매출이익분석과 같은 계산 (backend/services/outbound/GrossProfitDashboard.py).
import { memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import usePageReactivated from '../../components/common/usePageReactivated';
import XLSX from 'xlsx-js-style';
import { useNavigate } from 'react-router-dom';
import { Box, Button, Group, Loader, Paper, SegmentedControl, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconArrowDownRight, IconArrowUpRight, IconCash, IconChevronRight, IconCopy, IconDeviceFloppy,
  IconFileSpreadsheet, IconPercentage, IconPlus, IconReceipt, IconScale, IconSearch, IconTrash, IconTrendingUp, IconX,
} from '@tabler/icons-react';
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, LabelList, Legend, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import ErpDateInput from '../../components/common/ErpDateInput';
import { PageRibbonContext } from '../../components/layout/MainLayout';
import sharedClasses from '../../styles/pages/ManagementShared.module.css';
import classes from '../../styles/pages/InboundSearch.module.css';
import pageClasses from '../../styles/pages/GrossProfitDashboard.module.css';
import { applyExcelHeaderStyle } from '../../utils/excelHeaderStyle';

// 검증된 범주 팔레트 (순서 고정) · 기타 = 회색 · 손실 = 상태색 critical
const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'];
const OTHER = '#aab6c4';
const COLOR = { sales: PALETTE[0], cost: PALETTE[1], profit: PALETTE[2], loss: '#d03b3b' };
const TOP_N = 10;
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

function Delta({ current, previous, unit = '%', lowerIsBetter = false, label = '전월' }) {
  const diff = unit === '%p' ? (current === null || current === undefined || previous === null || previous === undefined ? null : current - previous) : changeRate(current, previous);
  // 비교할 기간 데이터가 없으면 아무것도 표시하지 않는다
  if (diff === null || diff === undefined || !Number.isFinite(diff)) return null;
  const up = diff > 0;
  const good = lowerIsBetter ? !up : up;
  const Icon = up ? IconArrowUpRight : IconArrowDownRight;
  return <span className={`${pageClasses.delta} ${diff === 0 ? pageClasses.deltaFlat : good ? pageClasses.deltaGood : pageClasses.deltaBad}`}>
    {diff !== 0 && <Icon size={13} stroke={2.4} />}{label} 대비 {up ? '+' : ''}{diff.toFixed(1)}{unit}
  </span>;
}

function ChartTooltip({ active, payload, label, extra }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return <Paper className={pageClasses.tooltip} shadow="sm" withBorder>
    <Text size="xs" fw={700} mb={5}>{row.fullName || label}</Text>
    {payload.map((entry) => <Group key={entry.dataKey} gap={6} wrap="nowrap" mb={2}>
      <span className={pageClasses.swatch} style={{ background: entry.color }} />
      <Text size="xs" w={48}>{entry.name}</Text>
      <Text size="xs" fw={700} ml="auto">{won(entry.value)}</Text>
    </Group>)}
    {extra && <Text size="xs" c="dimmed" mt={4}>{extra(row)}</Text>}
  </Paper>;
}

function Panel({ title, sub, children, className = '', action }) {
  return <Paper className={`${pageClasses.panel} ${className}`} withBorder>
    <Group className={pageClasses.panelHeader} justify="space-between" wrap="nowrap">
      <Group gap={8} wrap="nowrap"><Text className={pageClasses.panelTitle}>{title}</Text>{sub && <Text className={pageClasses.panelSub}>{sub}</Text>}</Group>
      {action}
    </Group>
    <Box className={pageClasses.panelBody}>{children}</Box>
  </Paper>;
}

const Empty = ({ loading }) => <Box className={pageClasses.empty}>{loading ? <Loader size="sm" color="red" /> : '데이터가 없습니다.'}</Box>;

// 마진율 반원 게이지 (0 ~ 50% 구간, 손실이면 빨강)
function MarginGauge({ value }) {
  const rate = Number(value || 0);
  const ratio = Math.max(0, Math.min(rate, 50)) / 50;
  const angle = Math.PI * (1 - ratio);
  const x = 50 + 40 * Math.cos(angle);
  const y = 50 - 40 * Math.sin(angle);
  const color = rate < 0 ? COLOR.loss : COLOR.profit;
  return <svg viewBox="0 0 100 56" className={pageClasses.gauge} role="img" aria-label={`마진율 ${pct(value)}`}>
    <path d="M10 50 A40 40 0 0 1 90 50" fill="none" stroke="#eef1f5" strokeWidth="9" strokeLinecap="round" />
    {ratio > 0 && <path d={`M10 50 A40 40 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)}`} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" />}
  </svg>;
}

// 원형(도넛): 가운데 합계, 옆에 이름·금액·비율 (색만으로 구분하지 않도록)
const Donut = memo(function Donut({ slices, centerLabel, centerValue }) {
  const total = slices.reduce((sum, slice) => sum + Math.max(slice.value, 0), 0);
  if (!total) return <Empty />;
  return <Box className={pageClasses.donutWrap}>
    <Box className={pageClasses.donutChart}>
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie data={slices} dataKey="value" nameKey="name" innerRadius={58} outerRadius={88} paddingAngle={1.5} stroke="#fff" strokeWidth={2} isAnimationActive={false}>
            {slices.map((slice) => <Cell key={slice.name} fill={slice.color} />)}
          </Pie>
          <Tooltip formatter={(value, name) => [`${won(value)} (${((value / total) * 100).toFixed(1)}%)`, name]} />
        </PieChart>
      </ResponsiveContainer>
      <Box className={pageClasses.donutCenter}><Text className={pageClasses.donutCenterLabel}>{centerLabel}</Text><Text className={pageClasses.donutCenterValue}>{centerValue}</Text></Box>
    </Box>
    <Box className={pageClasses.donutLegend}>
      {slices.map((slice) => <Box key={slice.name} className={pageClasses.legendRow} title={`${slice.name} ${won(slice.value)}`}>
        <span className={pageClasses.swatch} style={{ background: slice.color }} />
        <Text className={pageClasses.legendName}>{slice.name}</Text>
        <Text className={pageClasses.legendPct}>{((Math.max(slice.value, 0) / total) * 100).toFixed(1)}%</Text>
        <Text className={pageClasses.legendValue}>{compact(slice.value)}</Text>
      </Box>)}
    </Box>
  </Box>;
});

// 거래처별 매출·비용·순이익 (세로 막대)
const CustomerChart = memo(function CustomerChart({ rows, onPick }) {
  const data = rows.slice(0, TOP_N).map((row) => ({ name: shortName(row.customname || '(거래처 없음)'), fullName: row.customname, sales: row.sales, cost: row.cost, profit: row.profit, margin: row.margin_rate }));
  return <ResponsiveContainer width="100%" height={300}>
    <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 0 }} barGap={2} barCategoryGap="24%">
      <CartesianGrid vertical={false} stroke="#eef1f5" />
      <XAxis dataKey="name" tick={AXIS_TICK} axisLine={{ stroke: '#d5dbe3' }} tickLine={false} interval={0} />
      <YAxis tickFormatter={compact} width={52} tick={{ fontSize: 10, fill: '#8b95a3' }} axisLine={false} tickLine={false} />
      <Tooltip content={<ChartTooltip extra={(row) => `마진율 ${pct(row.margin)} · 누르면 상세 보기`} />} cursor={{ fill: '#f3f6fa' }} />
      <Legend verticalAlign="top" align="right" height={26} iconType="square" iconSize={9} wrapperStyle={{ fontSize: 11 }} />
      {[['sales', '매출'], ['cost', '비용'], ['profit', '순이익']].map(([key, label]) => <Bar key={key} dataKey={key} name={label} fill={COLOR[key]}
        maxBarSize={18} radius={[4, 4, 0, 0]} isAnimationActive={false} cursor="pointer" onClick={(entry) => onPick(entry.payload?.fullName ?? entry.fullName)}>
        {key === 'profit' && data.map((row) => <Cell key={row.fullName} fill={row.profit < 0 ? COLOR.loss : COLOR.profit} />)}
      </Bar>)}
    </BarChart>
  </ResponsiveContainer>;
});

// 최근 12개월 (매출 막대 + 순이익 선, 같은 금액 축 하나) · 회색 = 전년 같은 달
const TrendChart = memo(function TrendChart({ months }) {
  const data = months.map((row) => ({ name: `${row.month.slice(2, 4)}.${row.month.slice(5)}`, fullName: row.month, sales: row.sales, profit: row.profit, lySales: row.ly_sales, lyProfit: row.ly_profit, margin: row.margin_rate }));
  return <ResponsiveContainer width="100%" height={260}>
    <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
      <CartesianGrid vertical={false} stroke="#eef1f5" />
      <XAxis dataKey="name" tick={AXIS_TICK} axisLine={{ stroke: '#d5dbe3' }} tickLine={false} />
      <YAxis tickFormatter={compact} width={52} tick={{ fontSize: 10, fill: '#8b95a3' }} axisLine={false} tickLine={false} />
      <Tooltip content={<ChartTooltip extra={(row) => `마진율 ${pct(row.margin)}`} />} cursor={{ fill: '#f3f6fa' }} />
      <Legend verticalAlign="top" align="right" height={26} iconSize={9} wrapperStyle={{ fontSize: 11 }} />
      <Bar dataKey="lySales" name="작년 매출" fill={OTHER} maxBarSize={14} radius={[4, 4, 0, 0]} isAnimationActive={false} />
      <Bar dataKey="sales" name="매출" fill={COLOR.sales} maxBarSize={14} radius={[4, 4, 0, 0]} isAnimationActive={false} />
      <Line dataKey="lyProfit" name="작년 순이익" stroke="#8b95a3" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
      <Line dataKey="profit" name="순이익" stroke={COLOR.profit} strokeWidth={2} dot={{ r: 4, fill: COLOR.profit, strokeWidth: 0 }} isAnimationActive={false} />
    </ComposedChart>
  </ResponsiveContainer>;
});

// 세로 막대 하나 (마진율 / 품목별 순이익) · 손실은 빨강, 값은 막대 위에
const ColumnChart = memo(function ColumnChart({ data, valueKey, format, label }) {
  return <ResponsiveContainer width="100%" height={250}>
    <BarChart data={data} margin={{ top: 22, right: 8, bottom: 4, left: 0 }} barCategoryGap="30%">
      <CartesianGrid vertical={false} stroke="#eef1f5" />
      <XAxis dataKey="name" tick={AXIS_TICK} axisLine={{ stroke: '#d5dbe3' }} tickLine={false} interval={0} />
      <YAxis tickFormatter={format} width={48} tick={{ fontSize: 10, fill: '#8b95a3' }} axisLine={false} tickLine={false} />
      <Tooltip formatter={(value) => [format(value), label]} labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName || ''} cursor={{ fill: '#f3f6fa' }} />
      <Bar dataKey={valueKey} name={label} maxBarSize={26} radius={[4, 4, 0, 0]} isAnimationActive={false}>
        {data.map((row) => <Cell key={row.fullName} fill={row[valueKey] < 0 ? COLOR.loss : COLOR.sales} />)}
        <LabelList dataKey={valueKey} position="top" formatter={format} style={{ fontSize: 10, fill: '#25334a' }} />
      </Bar>
    </BarChart>
  </ResponsiveContainer>;
});

// 전월 대비 순이익 (거래처 매출 상위 10곳: 이번 기간 vs 전월)
const PrevCompareChart = memo(function PrevCompareChart({ rows }) {
  const data = rows.slice(0, TOP_N).map((row) => ({ name: shortName(row.customname, 6), fullName: row.customname, profit: row.profit, prev: row.prev_profit }));
  return <ResponsiveContainer width="100%" height={250}>
    <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 0 }} barGap={2} barCategoryGap="26%">
      <CartesianGrid vertical={false} stroke="#eef1f5" />
      <XAxis dataKey="name" tick={AXIS_TICK} axisLine={{ stroke: '#d5dbe3' }} tickLine={false} interval={0} />
      <YAxis tickFormatter={compact} width={52} tick={{ fontSize: 10, fill: '#8b95a3' }} axisLine={false} tickLine={false} />
      <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f3f6fa' }} />
      <Legend verticalAlign="top" align="right" height={26} iconType="square" iconSize={9} wrapperStyle={{ fontSize: 11 }} />
      <Bar dataKey="prev" name="전월" fill={OTHER} maxBarSize={16} radius={[4, 4, 0, 0]} isAnimationActive={false} />
      <Bar dataKey="profit" name="이번 기간" fill={COLOR.profit} maxBarSize={16} radius={[4, 4, 0, 0]} isAnimationActive={false}>
        {data.map((row) => <Cell key={row.fullName} fill={row.profit < 0 ? COLOR.loss : COLOR.profit} />)}
      </Bar>
    </BarChart>
  </ResponsiveContainer>;
});

// 월별 톤당 매출(막대) · 톤당 이익(선), 원/톤. 중량 없는 달은 비움
const tonFormat = (value) => (value === null || value === undefined ? '–' : `${compact(value)}원`);
const PerTonChart = memo(function PerTonChart({ months }) {
  const data = months.map((row) => ({ name: `${row.month.slice(2, 4)}.${row.month.slice(5)}`, fullName: row.month, sales: row.sales_per_ton, profit: row.profit_per_ton, ton: Number(row.weight || 0) / 1000 }));
  return <ResponsiveContainer width="100%" height={250}>
    <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
      <CartesianGrid vertical={false} stroke="#eef1f5" />
      <XAxis dataKey="name" tick={AXIS_TICK} axisLine={{ stroke: '#d5dbe3' }} tickLine={false} />
      <YAxis tickFormatter={compact} width={52} tick={{ fontSize: 10, fill: '#8b95a3' }} axisLine={false} tickLine={false} />
      <Tooltip content={<ChartTooltip extra={(row) => `판매 ${row.ton.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}톤`} />} cursor={{ fill: '#f3f6fa' }} />
      <Legend verticalAlign="top" align="right" height={26} iconSize={9} wrapperStyle={{ fontSize: 11 }} />
      <Bar dataKey="sales" name="톤당 매출" fill={COLOR.sales} maxBarSize={22} radius={[4, 4, 0, 0]} isAnimationActive={false} />
      <Line dataKey="profit" name="톤당 이익" stroke={COLOR.profit} strokeWidth={2} dot={{ r: 4, fill: COLOR.profit, strokeWidth: 0 }} connectNulls isAnimationActive={false} />
    </ComposedChart>
  </ResponsiveContainer>;
});

// 전월보다 이익률이 떨어진 거래처 (하락폭 큰 순) · 회색 = 전월, 주황 = 이번 기간
const MarginDropChart = memo(function MarginDropChart({ data }) {
  return <ResponsiveContainer width="100%" height={250}>
    <BarChart data={data} margin={{ top: 22, right: 8, bottom: 4, left: 0 }} barGap={2} barCategoryGap="26%">
      <CartesianGrid vertical={false} stroke="#eef1f5" />
      <XAxis dataKey="name" tick={AXIS_TICK} axisLine={{ stroke: '#d5dbe3' }} tickLine={false} interval={0} />
      <YAxis tickFormatter={pct} width={48} tick={{ fontSize: 10, fill: '#8b95a3' }} axisLine={false} tickLine={false} />
      <Tooltip formatter={(value, name) => [pct(value), name]} labelFormatter={(_, payload) => {
        const row = payload?.[0]?.payload;
        return row ? `${row.fullName} · ${row.drop.toFixed(1)}%p` : '';
      }} cursor={{ fill: '#f3f6fa' }} />
      <Legend verticalAlign="top" align="right" height={26} iconType="square" iconSize={9} wrapperStyle={{ fontSize: 11 }} />
      <Bar dataKey="prev" name="전월 마진율" fill={OTHER} maxBarSize={16} radius={[4, 4, 0, 0]} isAnimationActive={false} />
      <Bar dataKey="margin" name="이번 마진율" fill={COLOR.cost} maxBarSize={16} radius={[4, 4, 0, 0]} isAnimationActive={false}>
        {data.map((row) => <Cell key={row.fullName} fill={row.margin < 0 ? COLOR.loss : COLOR.cost} />)}
        <LabelList dataKey="drop" position="top" formatter={(value) => `${Number(value).toFixed(1)}%p`} style={{ fontSize: 10, fill: '#b42323', fontWeight: 700 }} />
      </Bar>
    </BarChart>
  </ResponsiveContainer>;
});

const topSlices = (rows, valueKey, nameKey) => {
  const positive = rows.filter((row) => row[valueKey] > 0);
  const top = positive.slice(0, 5).map((row, index) => ({ name: row[nameKey] || '(없음)', value: row[valueKey], color: PALETTE[index] }));
  const rest = positive.slice(5).reduce((sum, row) => sum + row[valueKey], 0);
  return rest > 0 ? [...top, { name: `기타 ${positive.length - 5}`, value: rest, color: OTHER }] : top;
};

export default function GrossProfitDashboard() {
  const ribbon = useContext(PageRibbonContext);
  const registerRibbon = ribbon?.registerPageRibbon;
  const closePage = ribbon?.closeActivePage;
  const navigate = useNavigate();
  const [preset, setPreset] = useState('this');
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
  const choosePreset = (value) => {
    setPreset(value);
    if (PRESETS[value]) { const range = PRESETS[value](); setInputs(range); setPeriod(range); }
  };
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
    { name: '판매비용', value: total.selling_cost, color: PALETTE[3] },
  ].filter((slice) => slice.value > 0) : []), [total]);
  const marginData = useMemo(() => (data?.customers || []).filter((row) => row.margin_rate !== null).slice(0, TOP_N)
    .map((row) => ({ name: shortName(row.customname, 6), fullName: row.customname, margin: row.margin_rate })).sort((a, b) => b.margin - a.margin), [data]);
  const marginDrops = useMemo(() => (data?.customers || [])
    .filter((row) => row.margin_rate !== null && row.prev_margin_rate !== null && row.prev_margin_rate !== undefined && row.margin_rate < row.prev_margin_rate)
    .map((row) => ({ name: shortName(row.customname, 6), fullName: row.customname, prev: row.prev_margin_rate, margin: row.margin_rate, drop: row.margin_rate - row.prev_margin_rate }))
    .sort((a, b) => a.drop - b.drop).slice(0, TOP_N), [data]);
  const hasPrevMargins = useMemo(() => (data?.customers || []).some((row) => row.prev_margin_rate !== null && row.prev_margin_rate !== undefined), [data]);

  const deltas = (key, options = {}) => [
    <Delta key="m" current={total[key]} previous={prev[key]} {...options} />,
    <Delta key="y" current={total[key]} previous={yoy?.[key]} label="전년 동월" {...options} />,
  ];
  const tons = (Number(total?.weight || 0) / 1000).toLocaleString('ko-KR', { maximumFractionDigits: 1 });
  const kpis = total ? [
    { key: 'sales', label: '매출', icon: IconCash, value: won(total.sales), deltas: deltas('sales'), hint: `판매 ${won(total.sales_goods)} + 매출비용(+) ${won(total.sales_plus)}` },
    { key: 'cost', label: '비용', icon: IconReceipt, value: won(total.cost), deltas: deltas('cost', { lowerIsBetter: true }), hint: `매입원가 ${won(total.cost_of_goods)} + 판매비용 ${won(total.selling_cost)}` },
    { key: 'profit', label: '순이익', icon: IconTrendingUp, value: won(total.profit), deltas: deltas('profit'), hint: '매출 − 비용', loss: total.profit < 0 },
    { key: 'margin', label: '마진율', icon: IconPercentage, value: pct(total.margin_rate), deltas: deltas('margin_rate', { unit: '%p' }), hint: '순이익 ÷ 매출', loss: total.profit < 0, gauge: true },
    { key: 'perton', label: '톤당 이익', icon: IconScale, value: total.profit_per_ton === null ? '–' : won(total.profit_per_ton), deltas: deltas('profit_per_ton'),
      hint: `순이익 ÷ 판매중량 · 톤당 매출 ${tonFormat(total.sales_per_ton)}`, loss: (total.profit_per_ton ?? 0) < 0,
      story: Number(total.weight) > 0 ? <>판매 <b>{tons}톤</b> · 순이익 <b className={total.profit < 0 ? pageClasses.kpiLoss : pageClasses.storyProfit}>{compact(total.profit)}원</b></> : null },
  ] : [];

  return (
    <Box className={`${sharedClasses.pageShell} ${classes.page} ${pageClasses.page}`}>
      <Box component="nav" aria-label="현재 위치" className={classes.pageBreadcrumb}>
        <Group className={classes.breadcrumbTrail} gap={7}>
          <Text component="span" className={classes.breadcrumbParent}>매출관리</Text>
          <Text component="span" className={classes.breadcrumbChevron}>›</Text>
          <Text component="span" className={classes.breadcrumbCurrent}>매출이익 현황</Text>
        </Group>
      </Box>

      <Paper className={pageClasses.filterBar} withBorder>
        <Group className={pageClasses.filterMain} gap={10} wrap="wrap">
          <SegmentedControl size="xs" value={preset} onChange={choosePreset} color="red"
            data={[{ value: 'this', label: '이번 달' }, { value: 'last', label: '지난달' }, { value: 'quarter', label: '최근 3개월' }, { value: 'year', label: '올해' }, { value: 'custom', label: '직접 입력' }]} />
          <Group gap={6} wrap="nowrap">
            <ErpDateInput aria-label="시작일" type="date" value={inputs.date_from} onChange={(event) => { const { value } = event.currentTarget; setPreset('custom'); setInputs((current) => ({ ...current, date_from: value })); }} />
            <Text size="xs" c="dimmed">~</Text>
            <ErpDateInput aria-label="종료일" type="date" value={inputs.date_to} onChange={(event) => { const { value } = event.currentTarget; setPreset('custom'); setInputs((current) => ({ ...current, date_to: value })); }} />
            <Button className={pageClasses.filterButton} size="xs" color="red" leftSection={<IconSearch size={14} />} onClick={search}>조회</Button>
          </Group>
          {data && <Text className={pageClasses.compareNote}>비교: 전월 {String(data.period.prev_from).slice(0, 10)} ~ {String(data.period.prev_to).slice(0, 10)}
            {' · '}전년 동월 {String(data.period.yoy_from).slice(0, 10)} ~ {String(data.period.yoy_to).slice(0, 10)}</Text>}
        </Group>
        <Button className={pageClasses.detailButton} size="xs" variant="default" rightSection={<IconChevronRight size={14} />} onClick={() => openDetail('')}>거래처별 상세 보기</Button>
      </Paper>

      <Box className={pageClasses.scroll}>
        <Box className={pageClasses.kpiGrid} aria-label="핵심 지표">
          {kpis.map((kpi) => {
            const Icon = kpi.icon;
            return <Paper key={kpi.key} className={`${pageClasses.kpi} ${pageClasses[`kpi_${kpi.key}`]}`} withBorder title={kpi.hint}>
              <Group justify="space-between" wrap="nowrap" align="flex-start">
                <Box style={{ minWidth: 0 }}>
                  <Text className={pageClasses.kpiLabel}>{kpi.label}</Text>
                  <Text className={`${pageClasses.kpiValue} ${kpi.loss ? pageClasses.kpiLoss : ''}`}>{kpi.value}</Text>
                  {kpi.story && <Text className={pageClasses.kpiStory}>{kpi.story}</Text>}
                </Box>
                {kpi.gauge ? <MarginGauge value={total.margin_rate} /> : <span className={pageClasses.kpiIcon}><Icon size={20} stroke={1.8} /></span>}
              </Group>
              <Box className={pageClasses.kpiDeltas}>{kpi.deltas}</Box>
            </Paper>;
          })}
          {!total && <Box className={pageClasses.kpiEmpty}><Empty loading={loading} /></Box>}
        </Box>

        <Box className={pageClasses.row2_1}>
          <Panel title="거래처별 매출 · 비용 · 순이익" sub={`매출 상위 ${TOP_N}곳 · 막대를 누르면 상세`}>
            {hasData ? <CustomerChart rows={data.customers} onPick={openDetail} /> : <Empty loading={loading} />}
          </Panel>
          <Panel title="매출 비중" sub="거래처 상위 5곳 + 기타">
            {hasData ? <Donut slices={salesSlices} centerLabel="총 매출" centerValue={compact(total.sales)} /> : <Empty loading={loading} />}
          </Panel>
        </Box>

        <Box className={pageClasses.row2_1}>
          <Panel title="최근 12개월 추이" sub="매출(막대) · 순이익(선) · 회색 = 작년 같은 달">
            {data ? <TrendChart months={data.trend} /> : <Empty loading={loading} />}
          </Panel>
          <Panel title="비용 구성" sub="어디에 돈이 들었나">
            {costSlices.length ? <Donut slices={costSlices} centerLabel="총 비용" centerValue={compact(total.cost)} /> : <Empty loading={loading} />}
          </Panel>
        </Box>

        <Box className={pageClasses.row1_1}>
          <Panel title="톤당 매출 · 톤당 이익" sub="월별 · 원/톤 (판매중량 기준)">
            {data ? <PerTonChart months={data.trend} /> : <Empty loading={loading} />}
          </Panel>
          <Panel title="이익률 하락 거래처" sub={`전월보다 마진율이 떨어진 곳 · 하락폭 큰 순 ${TOP_N}곳`}>
            {marginDrops.length ? <MarginDropChart data={marginDrops} />
              : hasData ? <Box className={pageClasses.empty}>{hasPrevMargins ? '전월보다 이익률이 떨어진 거래처가 없습니다.' : '전월 거래가 없어 비교할 수 없습니다.'}</Box>
                : <Empty loading={loading} />}
          </Panel>
        </Box>

        <Box className={pageClasses.row1_1}>
          <Panel title="거래처별 마진율" sub={`매출 상위 ${TOP_N}곳 · 손실은 빨강`}>
            {marginData.length ? <ColumnChart data={marginData} valueKey="margin" format={pct} label="마진율" /> : <Empty loading={loading} />}
          </Panel>
          <Panel title="전월 대비 순이익" sub={`매출 상위 ${TOP_N}곳`}>
            {hasData && prev?.sales ? <PrevCompareChart rows={data.customers} /> : hasData ? <Box className={pageClasses.empty}>전월 매출이 없어 비교할 수 없습니다.</Box> : <Empty loading={loading} />}
          </Panel>
        </Box>

      </Box>
    </Box>
  );
}
