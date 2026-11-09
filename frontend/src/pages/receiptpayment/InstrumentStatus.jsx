// 수표/어음 현황 (메뉴: INSTRUMENT_STATUS) - 어음·수표·외상매출채권, 현재 상태 기준
// 받을 채권 = 수금·타수 (받은 증권), 지급 채무 = 지급·자수 (우리가 발행한 증권)
// 요약 카드(누르면 목록이 그 조건으로 걸러짐) + 만기 구간 차트/표(막대·행을 누르면 그 구간으로 걸러짐) + 증권 목록.
import { memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import usePageReactivated from '../../components/common/usePageReactivated';
import XLSX from 'xlsx-js-style';
import { ActionIcon, Badge, Box, Button, Group, Loader, Pagination, Paper, Select, Stack, Table, Text, TextInput, UnstyledButton } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconAlertTriangle, IconCalendarDue, IconCashBanknote, IconCopy, IconDeviceFloppy, IconFileInvoice, IconFileSpreadsheet,
  IconFilter, IconPlus, IconRefresh, IconSearch, IconTrash, IconX,
} from '@tabler/icons-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import ErpDateInput from '../../components/common/ErpDateInput';
import { PageRibbonContext } from '../../components/layout/MainLayout';
import sharedClasses from '../../styles/pages/ManagementShared.module.css';
import classes from '../../styles/pages/InboundSearch.module.css';
import pageClasses from '../../styles/pages/InstrumentStatus.module.css';
import { applyExcelHeaderStyle } from '../../utils/excelHeaderStyle';
import { INSTRUMENT_TYPE_OPTIONS, instrumentLabel } from '../../utils/instrumentCodes';

const KIND_LABELS = {
  RECEIVABLE: '받을 채권', PAYABLE: '지급 채무', ENDORSED_OUT: '배서양도', RETURNED_OWN: '자수어음 회수', UNSPECIFIED: '미분류',
};
// 구분 설명 (목록에서 마우스를 올리면 보임)
const KIND_HINTS = {
  RECEIVABLE: '수금 · 타수: 받은 증권 (받을 돈)', PAYABLE: '지급 · 자수: 우리가 발행한 증권 (줄 돈)',
  ENDORSED_OUT: '지급 · 타수 직접 입력: 받은 어음을 넘겨 지급함', RETURNED_OWN: '수금 · 자수: 우리가 발행한 어음이 돌아옴',
  UNSPECIFIED: '발행구분이 비어 있습니다 (자수·타수를 입력하면 분류됩니다)',
};
const KIND_OPTIONS = [{ value: '', label: '전체' }, ...Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label }))];
const STATUS_LABELS = { HELD: '보관', UNPAID: '출금 예정', ENDORSED: '배서', SETTLED: '결제', DISCOUNTED: '할인', DISHONORED: '부도' };
// 상태 배지 색: 결제=완료(초록), 출금 예정=주의(주황), 부도=위험(빨강), 할인=파랑, 보관·배서=중립
const STATUS_BADGE = { HELD: 'gray', UNPAID: 'orange', ENDORSED: 'gray', SETTLED: 'teal', DISCOUNTED: 'blue', DISHONORED: 'red' };
const STATUS_OPTIONS = [
  { value: '', label: '전체' }, { value: 'OPEN', label: '진행 중' }, // 기본값은 진행 중
  ...Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })),
];
const BUCKETS = [
  { key: 'overdue', label: '만기 경과' }, { key: 'd0_30', label: '30일 이내' }, { key: 'd31_60', label: '31–60일' },
  { key: 'd61_90', label: '61–90일' }, { key: 'd91', label: '91일 이후' }, { key: 'none', label: '만기 없음' },
];
const BUCKET_LABELS = Object.fromEntries(BUCKETS.map((bucket) => [bucket.key, bucket.label]));
const BUCKET_OPTIONS = [{ value: '', label: '전체' }, ...BUCKETS.map((bucket) => ({ value: bucket.key, label: bucket.label }))];
// 차트 2계열 (검증된 범주 팔레트 1·2번: 파랑·주황)
const SERIES = [
  { key: 'RECEIVABLE', label: '받을 채권', color: '#2a78d6' },
  { key: 'PAYABLE', label: '지급 채무', color: '#eb6834' },
];
const SERIES_COLOR = Object.fromEntries(SERIES.map((series) => [series.key, series.color]));
const PAGE_SIZE_OPTIONS = [50, 100, 200].map((value) => ({ value: String(value), label: `${value}개씩` }));
const COLUMNS = [
  ['maturitydate', '만기일', 92], ['dday', 'D-day', 72], ['kind', '구분', 100], ['status', '상태', 84],
  ['instrumenttype', '종류', 88], ['instrumentno', '번호', 120], ['instrumentamt', '금액', 115],
  ['customname', '거래처', 140], ['issuercompany', '발행회사', 120], ['issuedate', '발행일', 90],
  ['custodybank', '보관은행', 85], ['receiptdate', '수금/지급일', 92], ['receiptno', '전표번호', 140],
  ['used_receiptno', '연결 전표', 125], ['processdate', '처리일', 90], ['discountfee', '할인료', 85], ['processmemo', '처리메모', 180],
].map(([key, label, width]) => ({ key, label, width }));

const pad = (value) => String(value).padStart(2, '0');
const dateString = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const addDays = (days) => { const date = new Date(); date.setDate(date.getDate() + days); return dateString(date); };
const makeFilters = () => ({ kind: '', status: 'OPEN', bucket: '', maturity_from: '', maturity_to: '', customer: '', instrumenttype: '', keyword: '' });
const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });
const displayDate = (value) => (value ? String(value).slice(0, 10) : '');
const formatNumber = (value) => {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toLocaleString('ko-KR', { maximumFractionDigits: 3 }) : String(value);
};
// 축·표용 짧은 금액 (억/만)
const compactWon = (value) => {
  const number = Number(value || 0);
  if (!number) return '0';
  if (Math.abs(number) >= 100000000) return `${(number / 100000000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}억`;
  if (Math.abs(number) >= 10000) return `${Math.round(number / 10000).toLocaleString('ko-KR')}만`;
  return number.toLocaleString('ko-KR');
};
const statusText = (item) => (item.status === 'DISHONORED' && (item.used_receiptno || item.kind === 'ENDORSED_OUT') ? '부도(배서)' : STATUS_LABELS[item.status] || '');
const isOpen = (item) => (item.kind === 'RECEIVABLE' && item.status === 'HELD') || (item.kind === 'PAYABLE' && item.status === 'UNPAID');
const ddayText = (item) => {
  if (item.days_to_maturity === null || item.days_to_maturity === undefined) return '';
  const days = Number(item.days_to_maturity);
  if (days === 0) return 'D-Day';
  return days > 0 ? `D-${days}` : `D+${-days}`;
};
// 카드 → 목록 조건
const CARD_PRESETS = {
  held: { kind: 'RECEIVABLE', status: 'HELD', bucket: '', maturity_from: '', maturity_to: '' },
  due30: { kind: '', status: 'OPEN', bucket: '', maturity_from: '', maturity_to: addDays(30) },
  unpaid: { kind: 'PAYABLE', status: 'UNPAID', bucket: '', maturity_from: '', maturity_to: '' },
  dishonored: { kind: '', status: 'DISHONORED', bucket: '', maturity_from: '', maturity_to: '' },
};
const matchesPreset = (filters, preset) => Object.entries(preset).every(([key, value]) => (filters[key] || '') === value);
// 현재 걸린 조건을 사람이 읽는 말로
const describeFilters = (filters) => {
  const parts = [];
  if (filters.kind) parts.push(KIND_LABELS[filters.kind]);
  parts.push(STATUS_OPTIONS.find((option) => option.value === filters.status)?.label || '전체 상태');
  if (filters.bucket) parts.push(`만기 ${BUCKET_LABELS[filters.bucket]}`);
  if (filters.maturity_from || filters.maturity_to) parts.push(`만기 ${filters.maturity_from || '…'} ~ ${filters.maturity_to || '…'}`);
  if (filters.customer) parts.push(`거래처 "${filters.customer}"`);
  if (filters.instrumenttype) parts.push(instrumentLabel('instrumenttype', filters.instrumenttype));
  if (filters.keyword) parts.push(`"${filters.keyword}"`);
  return parts;
};

function AgingTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return <Paper className={pageClasses.chartTooltip} shadow="sm" withBorder>
    <Text size="xs" fw={700} mb={6}>{label}</Text>
    {payload.map((entry) => <Group key={entry.dataKey} gap={6} wrap="nowrap" mb={2}>
      <span className={pageClasses.legendSwatch} style={{ background: entry.color }} />
      <Text size="xs" w={56}>{entry.name}</Text>
      <Text size="xs" fw={700} ml="auto">{formatNumber(entry.value)}원</Text>
      <Text size="xs" c="dimmed" w={34} ta="right">{entry.payload[`${entry.dataKey}_count`]}건</Text>
    </Group>)}
    <Text size="10px" c="dimmed" mt={6}>누르면 목록이 이 구간으로 걸러집니다</Text>
  </Paper>;
}

// ---- 목록 행: Mantine Table.Td 대신 같은 스타일의 일반 td (50행 × 17칸을 빠르게 그림)
const TD_CLASS = 'm_4e7aa4ef mantine-Table-td';
const TR_CLASS = 'm_4e7aa4fd mantine-Table-tr';
const ALIGN = { instrumentamt: 'right', discountfee: 'right', dday: 'center', status: 'center' };
const renderInstrumentCell = (item, key) => {
  if (['maturitydate', 'issuedate', 'receiptdate', 'processdate'].includes(key)) return displayDate(item[key]);
  if (key === 'dday') {
    const text = ddayText(item);
    if (!text) return '';
    const days = Number(item.days_to_maturity);
    const tone = !isOpen(item) ? pageClasses.ddayMuted : days < 0 ? pageClasses.ddayOverdue : days <= 7 ? pageClasses.ddaySoon : pageClasses.ddayNormal;
    return <span className={`${pageClasses.ddayPill} ${tone}`}>{text}</span>;
  }
  if (key === 'kind') {
    return <span className={pageClasses.kindCell} title={KIND_HINTS[item.kind]}>
      {SERIES_COLOR[item.kind] && <span className={pageClasses.legendSwatch} style={{ background: SERIES_COLOR[item.kind] }} />}{KIND_LABELS[item.kind] || ''}</span>;
  }
  if (key === 'status') return item.status ? <span className={`${pageClasses.statusBadge} ${pageClasses[`badge_${STATUS_BADGE[item.status] || 'gray'}`]}`}>{statusText(item)}</span> : '';
  if (key === 'instrumenttype') return instrumentLabel('instrumenttype', item.instrumenttype);
  if (key === 'instrumentamt') return <span className={pageClasses.amountCell}>{formatNumber(item.instrumentamt)}</span>;
  if (key === 'discountfee') return Number(item.discountfee || 0) > 0 ? formatNumber(item.discountfee) : '';
  if (key === 'receiptno') return `${item.receiptno}-${item.lineno}`;
  return item[key] ?? '';
};
const InstrumentRow = memo(function InstrumentRow({ item }) {
  return <tr className={`${TR_CLASS}${isOpen(item) && Number(item.days_to_maturity) < 0 ? ` ${pageClasses.overdueRow}` : ''}`} data-with-row-border="true" data-hover="true">
    {COLUMNS.map((column) => <td key={column.key} className={TD_CLASS} data-with-column-border="true"
      style={ALIGN[column.key] ? { textAlign: ALIGN[column.key] } : undefined}>{renderInstrumentCell(item, column.key)}</td>)}
  </tr>;
});

// ---- 만기 구간 차트 + 표: 데이터가 같으면 다시 그리지 않음
const AgingSection = memo(function AgingSection({ chartData, agingTotals, showLoader, activeBucket, onPickBucket }) {
  const hasAging = chartData.some((row) => row.RECEIVABLE || row.PAYABLE);
  return <Box className={pageClasses.agingBody}>
    <Box className={pageClasses.agingChart} role="img" aria-label={`만기 구간별 금액: ${chartData.map((row) => `${row.label} 받을 채권 ${formatNumber(row.RECEIVABLE)}원, 지급 채무 ${formatNumber(row.PAYABLE)}원`).join('; ')}`}>
      {hasAging ? <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 10, right: 8, bottom: 0, left: 0 }} barGap={2} barCategoryGap="30%">
          <CartesianGrid vertical={false} stroke="#eef1f5" />
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: '#d5dbe3' }} tick={{ fontSize: 11, fill: '#52514e' }} />
          <YAxis tickFormatter={compactWon} tickLine={false} axisLine={false} width={48} tick={{ fontSize: 10, fill: '#8b95a3' }} />
          <Tooltip content={<AgingTooltip />} cursor={{ fill: '#f3f6fa' }} />
          {SERIES.map((series) => <Bar key={series.key} dataKey={series.key} name={series.label} fill={series.color} maxBarSize={22} radius={[4, 4, 0, 0]}
            isAnimationActive={false} cursor="pointer" onClick={(entry) => onPickBucket(entry.bucket ?? entry.payload?.bucket, series.key)} />)}
        </BarChart>
      </ResponsiveContainer> : <Box className={pageClasses.agingEmpty}>{showLoader ? <Loader size="sm" color="red" /> : '진행 중인 채권·채무가 없습니다.'}</Box>}
    </Box>
    {/* 같은 숫자를 표로도 (행을 누르면 그 구간의 받을 채권+지급 채무) */}
    <table className={pageClasses.agingTable}>
      <thead><tr><th>만기 구간</th><th>받을 채권</th><th>지급 채무</th></tr></thead>
      <tbody>{chartData.map((row) => <tr key={row.bucket} className={activeBucket === row.bucket ? pageClasses.agingRowActive : undefined}
        onClick={() => onPickBucket(row.bucket, '')} title="누르면 목록이 이 구간으로 걸러집니다">
        <td className={row.bucket === 'overdue' && (row.RECEIVABLE || row.PAYABLE) ? pageClasses.agingOverdue : undefined}>{row.label}</td>
        <td>{row.RECEIVABLE ? compactWon(row.RECEIVABLE) : '–'}<small>{row.RECEIVABLE_count ? ` ${row.RECEIVABLE_count}건` : ''}</small></td>
        <td>{row.PAYABLE ? compactWon(row.PAYABLE) : '–'}<small>{row.PAYABLE_count ? ` ${row.PAYABLE_count}건` : ''}</small></td>
      </tr>)}</tbody>
      <tfoot><tr><td>합계</td><td>{compactWon(agingTotals.RECEIVABLE)}</td><td>{compactWon(agingTotals.PAYABLE)}</td></tr></tfoot>
    </table>
  </Box>;
});

export default function InstrumentStatus() {
  const ribbon = useContext(PageRibbonContext);
  const registerRibbon = ribbon?.registerPageRibbon;
  const closePage = ribbon?.closeActivePage;
  const [filterOpen, setFilterOpen] = useState(true);
  const closeFilter = useCallback(() => setFilterOpen(false), []);
  const [filterInputs, setFilterInputs] = useState(makeFilters);
  const [filters, setFilters] = useState(makeFilters);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [data, setData] = useState({ items: [], total: 0, total_amount: 0, summary: null, aging: [] });
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);

  const load = useCallback(async (requestedFilters, requestedPage, requestedPageSize) => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const params = { page: requestedPage, page_size: requestedPageSize, status: requestedFilters.status };
      Object.entries(requestedFilters).forEach(([key, value]) => { if (key !== 'status' && String(value || '').trim()) params[key] = String(value).trim(); });
      const response = await axios.get('/api/instrument-status/instruments', { ...authConfig(), params });
      if (requestId !== requestIdRef.current) return;
      setData({ items: response.data.items || [], total: response.data.total || 0, total_amount: response.data.total_amount || 0, summary: response.data.summary || null, aging: response.data.aging || [] });
    } catch (error) {
      if (requestId === requestIdRef.current) notifications.show({ title: '수표/어음 현황 조회 실패', message: error.response?.data?.detail || '수표/어음 현황을 불러오지 못했습니다.', color: 'red' });
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);
  // 탭을 열 때마다 현재 기준으로 다시 조회
  // 탭에 돌아오면 지금 조건 그대로 다시 불러온다 (다른 탭에서 데이터가 바뀌었을 수 있음)
  usePageReactivated(() => { void load(filters, page, pageSize); });
  useEffect(() => { void load(filters, page, pageSize); }, [load, filters, page, pageSize]);
  const hasItems = data.items.length > 0;

  const applyFilters = useCallback((next) => {
    if (next.maturity_from && next.maturity_to && next.maturity_from > next.maturity_to) {
      notifications.show({ title: '조회 조건 확인', message: '만기 시작일은 종료일보다 뒤일 수 없습니다.', color: 'orange' });
      return;
    }
    setFilterInputs(next); setFilters(next); setPage(1);
  }, []);
  const search = useCallback(() => applyFilters({ ...filterInputs }), [applyFilters, filterInputs]);
  const applyPreset = useCallback((preset) => applyFilters({ ...filterInputs, ...preset }), [applyFilters, filterInputs]);
  const pickBucket = useCallback((bucket, kind) => applyFilters({ ...filterInputs, kind, status: 'OPEN', bucket, maturity_from: '', maturity_to: '' }), [applyFilters, filterInputs]);
  const resetFilters = useCallback(() => applyFilters(makeFilters()), [applyFilters]);
  const onFilterKey = (event) => { if (event.key === 'Enter') search(); };

  const exportExcel = useCallback(async () => {
    try {
      const rows = [];
      for (let pageNumber = 1; pageNumber <= 50; pageNumber += 1) {
        const params = { page: pageNumber, page_size: 500, status: filters.status };
        Object.entries(filters).forEach(([key, value]) => { if (key !== 'status' && String(value || '').trim()) params[key] = String(value).trim(); });
        const response = await axios.get('/api/instrument-status/instruments', { ...authConfig(), params });
        rows.push(...(response.data.items || []));
        if (rows.length >= (response.data.total || 0) || !(response.data.items || []).length) break;
      }
      if (!rows.length) { notifications.show({ title: '엑셀 데이터 없음', message: '다운로드할 데이터가 없습니다.', color: 'orange' }); return; }
      const sheetRows = rows.map((item) => ({
        만기일: displayDate(item.maturitydate), 'D-day': ddayText(item), 구분: KIND_LABELS[item.kind] || '', 상태: statusText(item),
        종류: instrumentLabel('instrumenttype', item.instrumenttype), 번호: item.instrumentno || '', 금액: Number(item.instrumentamt || 0),
        거래처: item.customname || '', 발행회사: item.issuercompany || '', 발행일: displayDate(item.issuedate), 보관은행: item.custodybank || '',
        '수금/지급일': displayDate(item.receiptdate), 전표번호: `${item.receiptno}-${item.lineno}`, '연결 전표': item.used_receiptno || '',
        처리일: displayDate(item.processdate), 할인료: Number(item.discountfee || 0) || '', 처리메모: item.processmemo || '',
      }));
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet(sheetRows);
      applyExcelHeaderStyle(worksheet, Object.keys(sheetRows[0]).length);
      XLSX.utils.book_append_sheet(workbook, worksheet, '수표어음현황');
      XLSX.writeFile(workbook, `수표어음현황_${dateString(new Date()).replaceAll('-', '')}.xlsx`);
    } catch (error) {
      notifications.show({ title: '엑셀 다운로드 실패', message: error.response?.data?.detail || '수표/어음 현황을 파일로 저장하지 못했습니다.', color: 'red' });
    }
  }, [filters]);
  // 리본: 최신 핸들러는 ref로 호출, 엑셀 버튼 사용 가능 여부가 바뀔 때만 다시 등록
  const ribbonActions = useRef({});
  useLayoutEffect(() => { ribbonActions.current = { search, exportExcel }; });
  useEffect(() => {
    if (!registerRibbon) return undefined;
    registerRibbon(
      <Group className={classes.commandRibbon} justify="flex-start" wrap="nowrap" gap={2}>
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconSearch size={15} />} onClick={() => ribbonActions.current.search()}>조회</Button>
        <span className={classes.ribbonSeparator} />
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconPlus size={15} />} disabled>추가</Button>
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconCopy size={15} />} disabled>복사</Button>
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconFileSpreadsheet size={15} />} onClick={() => void ribbonActions.current.exportExcel()} disabled={!hasItems}>엑셀</Button>
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconDeviceFloppy size={15} />} disabled>저장</Button>
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconTrash size={15} />} disabled>삭제</Button>
        <span className={classes.ribbonSeparator} />
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconX size={15} />} onClick={closePage}>닫기</Button>
      </Group>,
    );
    return () => registerRibbon(null);
  }, [registerRibbon, closePage, hasItems]);

  const agingKey = JSON.stringify(data.aging);
  const chartData = useMemo(() => {
    const aging = JSON.parse(agingKey);
    return BUCKETS.map((bucket) => {
      const row = { bucket: bucket.key, label: bucket.label };
      SERIES.forEach((series) => {
        const found = aging.find((entry) => entry.kind === series.key && entry.bucket === bucket.key);
        row[series.key] = Number(found?.amount || 0);
        row[`${series.key}_count`] = Number(found?.count || 0);
      });
      return row;
    });
  }, [agingKey]);
  const agingTotals = useMemo(() => Object.fromEntries(SERIES.map((series) => [series.key, chartData.reduce((sum, row) => sum + row[series.key], 0)])), [chartData]);
  const hasAging = chartData.some((row) => row.RECEIVABLE || row.PAYABLE);
  // 차트·표 클릭 핸들러는 항상 같은 함수 (AgingSection 이 다시 그려지지 않도록)
  const actionsRef = useRef({});
  useLayoutEffect(() => { actionsRef.current = { pickBucket }; });
  const onPickBucket = useCallback((bucket, kind) => actionsRef.current.pickBucket?.(bucket, kind), []);
  const summary = data.summary;
  // 카드 문구: 사용자가 바로 읽는 말 (마우스를 올리면 자세한 설명)
  const overdueCount = summary?.due_30?.overdue_count || 0;
  const cards = [
    { id: 'held', label: '받을 돈 (보유 어음·수표)', icon: IconFileInvoice, value: summary?.held_receivable,
      hint: '수금으로 받아 아직 결제·할인·지급에 쓰지 않은 증권입니다. 누르면 목록이 걸러집니다.' },
    { id: 'unpaid', label: '나갈 돈 (발행 어음·수표)', icon: IconCashBanknote, value: summary?.unpaid_payable,
      hint: '우리가 발행해서 준 증권 중 아직 결제되지 않은 금액입니다. 누르면 목록이 걸러집니다.' },
    { id: 'due30', label: '만기 도래 (30일 이내)', icon: IconCalendarDue, value: summary?.due_30,
      hint: `오늘부터 30일 안에 만기가 오는 받을 돈과 나갈 돈입니다. 만기가 지났는데 결제 처리하지 않은 건${overdueCount ? `(${overdueCount}건)` : ''}도 포함합니다.` },
    { id: 'dishonored', label: '부도', icon: IconAlertTriangle, value: summary?.dishonored,
      hint: '부도 처리된 증권입니다. 넘겨준 어음이 부도나 상환청구를 받은 건(부도(배서))도 포함합니다.' },
  ];
  const filterParts = describeFilters(filters);
  const isDefaultFilter = JSON.stringify(filters) === JSON.stringify(makeFilters());

  const tableWidth = COLUMNS.reduce((sum, column) => sum + column.width, 0);

  return <Box className={`${sharedClasses.pageShell} ${classes.page} ${pageClasses.page}`}>
    <Box component="nav" aria-label="현재 위치" className={classes.pageBreadcrumb}>
      <Group className={classes.breadcrumbTrail} gap={7}>
        <Text component="span" className={classes.breadcrumbParent}>수금/지급관리</Text>
        <Text component="span" className={classes.breadcrumbChevron}>›</Text>
        <Text component="span" className={classes.breadcrumbCurrent}>수표/어음 현황</Text>
      </Group>
      {!filterOpen && <Button className={classes.filterToggle} variant="subtle" size="xs" leftSection={<IconFilter size={15} />} onClick={() => setFilterOpen(true)}>조회조건</Button>}
    </Box>
    <Box className={pageClasses.content}>
    <Box className={pageClasses.cardGrid} aria-label="수표/어음 현황 카드">
      {cards.map((card) => {
        const selected = matchesPreset(filters, CARD_PRESETS[card.id]);
        const Icon = card.icon;
        return <UnstyledButton key={card.id} className={`${pageClasses.statCard} ${selected ? pageClasses.statCardActive : ''}`}
          onClick={() => applyPreset(CARD_PRESETS[card.id])} aria-pressed={selected} title={card.hint}>
          <Group justify="space-between" wrap="nowrap" align="flex-start">
            <Text className={pageClasses.statLabel}>{card.label}</Text>
            <span className={`${pageClasses.statIcon} ${card.id === 'dishonored' && card.value?.count ? pageClasses.statIconDanger : ''}`}><Icon size={16} stroke={1.8} /></span>
          </Group>
          <Group gap={8} align="baseline" wrap="nowrap" mt={4}>
            <Text className={pageClasses.statValue}>{formatNumber(card.value?.amount)}<span className={pageClasses.statUnit}>원</span></Text>
            <span className={pageClasses.statCount}>{Number(card.value?.count || 0).toLocaleString()}건</span>
          </Group>
        </UnstyledButton>;
      })}
    </Box>

    <Box className={classes.inboundWorkspace}>
      <Box className={pageClasses.instrumentMain}>
        <Paper className={`${sharedClasses.panel} ${pageClasses.agingPanel}`} withBorder>
          <Group justify="space-between" wrap="nowrap" className={pageClasses.panelHeader}>
            <Group gap={8} wrap="nowrap"><Text className={classes.sectionTitle} fw={700}>만기 구간별 금액</Text><Text size="xs" c="dimmed">진행 중인 받을 채권·지급 채무 · 전체 기간, 오늘 기준</Text></Group>
            <Group gap={14} wrap="nowrap">{SERIES.map((series) => <Group key={series.key} gap={6} wrap="nowrap">
              <span className={pageClasses.legendSwatch} style={{ background: series.color }} /><Text size="xs" c="#52514e">{series.label}</Text></Group>)}</Group>
          </Group>
          <AgingSection chartData={chartData} agingTotals={agingTotals} showLoader={loading && !hasAging} activeBucket={filters.bucket} onPickBucket={onPickBucket} />
        </Paper>

        <Paper className={`${sharedClasses.panel} ${classes.resultsPanel} ${pageClasses.instrumentList}`} withBorder>
          <Group className={pageClasses.panelHeader} justify="space-between" wrap="nowrap">
            <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
              <Text className={classes.sectionTitle} fw={700}>채권/채무 목록</Text>
              <Badge color="gray" variant="light">{data.total.toLocaleString()}건</Badge>
              <Text size="xs" fw={700} c="#25334a">{formatNumber(data.total_amount)}원</Text>
              <Group gap={4} wrap="nowrap" className={pageClasses.filterChips}>{filterParts.map((part) => <span key={part} className={pageClasses.filterChip}>{part}</span>)}</Group>
            </Group>
            <Button size="xs" variant="subtle" color="gray" leftSection={<IconRefresh size={13} />} disabled={isDefaultFilter} onClick={resetFilters}>조건 초기화</Button>
          </Group>
          <Box className={classes.tableWrap}>
            {loading && <Box className={classes.loadingOverlay}><Loader color="red" size="sm" /></Box>}
            <Box className={classes.inboundSearchScroller} style={{ height: '100%', width: '100%' }}>
              <Table className={`${classes.statusTable} ${pageClasses.instrumentTable}`} withTableBorder withColumnBorders highlightOnHover style={{ width: tableWidth, minWidth: tableWidth, tableLayout: 'fixed' }}>
                <colgroup>{COLUMNS.map((column) => <col key={column.key} style={{ width: `${column.width}px` }} />)}</colgroup>
                <Table.Thead><Table.Tr>{COLUMNS.map((column) => <Table.Th key={column.key} style={{ position: 'sticky', top: 0, zIndex: 3 }}
                  ta={['instrumentamt', 'discountfee'].includes(column.key) ? 'right' : ['dday', 'status'].includes(column.key) ? 'center' : undefined}>{column.label}</Table.Th>)}</Table.Tr></Table.Thead>
                <Table.Tbody>{data.items.length ? data.items.map((item) => <InstrumentRow key={`${item.receiptno}:${item.lineno}`} item={item} />) : !loading && <Table.Tr><Table.Td colSpan={COLUMNS.length} style={{ height: 140, textAlign: 'center', color: '#7c899b' }}>조건에 맞는 채권/채무가 없습니다.</Table.Td></Table.Tr>}</Table.Tbody>
              </Table>
            </Box>
          </Box>
          <Group className={classes.paginationBar} justify="space-between" wrap="wrap">
            <Group gap="xs"><Text size="xs" c="dimmed">총 {data.total.toLocaleString()}건 · 만기일 빠른 순</Text><Select aria-label="페이지당 표시 건수" data={PAGE_SIZE_OPTIONS} value={String(pageSize)} w={100} size="xs" onChange={(value) => { if (value) { setPageSize(Number(value)); setPage(1); } }} /></Group>
            <Pagination size="sm" total={Math.max(1, Math.ceil(data.total / pageSize))} value={page} onChange={setPage} withEdges color="red" disabled={loading || !data.total} />
          </Group>
        </Paper>
      </Box>

      {filterOpen && <Paper component="aside" className={classes.filterSidebar} withBorder>
        <Group className={classes.filterHeader} justify="space-between" align="center"><Text fw={700}>조회조건</Text><ActionIcon variant="subtle" color="gray" aria-label="조회조건 닫기" onClick={closeFilter}><IconX size={16} /></ActionIcon></Group>
        <Stack gap="sm" className={classes.filterFields}>
          <Select label="구분" data={KIND_OPTIONS} value={filterInputs.kind} onChange={(value) => setFilterInputs((current) => ({ ...current, kind: value || '' }))} />
          <Select label="상태" data={STATUS_OPTIONS} value={filterInputs.status} onChange={(value) => setFilterInputs((current) => ({ ...current, status: value ?? 'OPEN' }))} />
          <Select label="만기 구간" data={BUCKET_OPTIONS} value={filterInputs.bucket} onChange={(value) => setFilterInputs((current) => ({ ...current, bucket: value || '' }))} />
          <Box><Text size="xs" fw={700} mb={5}>만기일 기간</Text><Stack gap={6}>
            <ErpDateInput aria-label="만기 시작일" type="date" value={filterInputs.maturity_from} onChange={(event) => { const { value: nextValue } = event.currentTarget; setFilterInputs((current) => ({ ...current, maturity_from: nextValue })); }} />
            <ErpDateInput aria-label="만기 종료일" type="date" value={filterInputs.maturity_to} onChange={(event) => { const { value: nextValue } = event.currentTarget; setFilterInputs((current) => ({ ...current, maturity_to: nextValue })); }} />
          </Stack></Box>
          <TextInput label="거래처" placeholder="거래처코드 또는 거래처명" value={filterInputs.customer} onChange={(event) => { const { value: nextValue } = event.currentTarget; setFilterInputs((current) => ({ ...current, customer: nextValue })); }} onKeyDown={onFilterKey} />
          <Select label="종류" data={[{ value: '', label: '전체' }, ...INSTRUMENT_TYPE_OPTIONS]} value={filterInputs.instrumenttype} onChange={(value) => setFilterInputs((current) => ({ ...current, instrumenttype: value || '' }))} />
          <TextInput label="번호·발행회사·전표" placeholder="어음번호, 발행회사, 전표번호" value={filterInputs.keyword} onChange={(event) => { const { value: nextValue } = event.currentTarget; setFilterInputs((current) => ({ ...current, keyword: nextValue })); }} onKeyDown={onFilterKey} />
        </Stack>
      </Paper>}
    </Box>
    </Box>
  </Box>;
}
