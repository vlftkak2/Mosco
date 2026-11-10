// 매출이익분석 (메뉴: GROSS_PROFIT)
// 출고(매출) 행마다 원가(매입금액·매입비용·가공비)와 매출비용을 붙여 이익·마진율을 보여 준다. 매출처별 그룹·소계·총계.
// 계산식은 backend/services/outbound/GrossProfit.py 상단 설명 참고.
import { memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import usePageReactivated from '../../components/common/usePageReactivated';
import XLSX from 'xlsx-js-style';
import { ActionIcon, Box, Button, Group, Loader, Paper, Select, Stack, Table, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconCalendar, IconChartBar, IconChevronDown, IconChevronRight, IconCoin, IconCopy, IconDeviceFloppy, IconFileSpreadsheet,
  IconFilter, IconPercentage, IconPlus, IconSearch, IconShoppingCart, IconTrash, IconTrendingUp, IconTruckDelivery, IconX,
} from '@tabler/icons-react';
import { useLocation } from 'react-router-dom';
import ErpDateInput from '../../components/common/ErpDateInput';
import { PageRibbonContext } from '../../components/layout/MainLayout';
import sharedClasses from '../../styles/pages/ManagementShared.module.css';
import classes from '../../styles/pages/InboundSearch.module.css';
import pageClasses from '../../styles/pages/GrossProfit.module.css';
import { applyExcelHeaderStyle } from '../../utils/excelHeaderStyle';

const ORIGIN_LABELS = { INBOUND: '입고', OPENING: '기초재고', PROCESS: '가공', UNKNOWN: '확인 필요' };
const PROFIT_OPTIONS = [{ value: '', label: '전체' }, { value: 'GAIN', label: '이익' }, { value: 'LOSS', label: '손실' }];
// 옛 프로그램과 같은 순서: 이익금액 → 매입금액 → 매입비용 → 가공비 → 매출금액 → 매출비용(+/−) → 마진율
const COLUMNS = [
  { key: 'no', label: 'NO', width: 46, align: 'center' },
  { key: 'receptdate', label: '매출일자', width: 92 },
  { key: 'customname', label: '매출처', width: 140 },
  { key: 'sales_amt', label: '매출금액', width: 108, type: 'money' },
  { key: 'sales_plus', label: '매출비용(+)', width: 92, type: 'money' },
  { key: 'sales_minus', label: '매출비용(−)', width: 92, type: 'money' },
  { key: 'purchase_amt', label: '매입금액', width: 105, type: 'money' },
  { key: 'purchase_cost', label: '매입비용', width: 88, type: 'money' },
  { key: 'process_amt', label: '가공비', width: 88, type: 'money' },
  { key: 'profit_amt', label: '이익금액', width: 105, type: 'money' },
  { key: 'margin_rate', label: '마진율(%)', width: 88, type: 'margin' },
  { key: 'productname', label: '품명', width: 110 },
  { key: 'itemname', label: '품목', width: 120 },
  { key: 'materialname', label: '강종', width: 80 },
  { key: 'surfacename', label: '표면', width: 72 },
  { key: 'myrtle', label: '도금량', width: 72 },
  { key: 'thickness', label: '두께', width: 62, type: 'decimal' },
  { key: 'width', label: '폭', width: 66, type: 'decimal' },
  { key: 'length', label: '길이', width: 66, type: 'decimal' },
  { key: 'qty', label: '수량', width: 60, type: 'decimal' },
  { key: 'weight', label: '중량', width: 82, type: 'decimal' },
  { key: 'sales_price', label: '매출단가', width: 86, type: 'decimal' },
  { key: 'purchase_price', label: '매입단가', width: 86, type: 'decimal' },
  { key: 'origin_kind', label: '원가구분', width: 74, align: 'center' },
  { key: 'origin_no', label: '원천번호', width: 140 },
  { key: 'warehousecodename', label: '창고', width: 100 },
  { key: 'receiptno', label: '출고번호', width: 140 },
];
// 행이 이보다 많으면 매출처별 소계만 먼저 보여 주고, 매출처를 눌러 펼친다 (수천 행을 한 번에 그리지 않도록)
const AUTO_COLLAPSE_ROWS = 300;
const TABLE_WIDTH = COLUMNS.reduce((sum, column) => sum + column.width, 0);
const TD = 'm_4e7aa4ef mantine-Table-td';
const TR = 'm_4e7aa4fd mantine-Table-tr';

const pad = (value) => String(value).padStart(2, '0');
const toDateString = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const makeFilters = () => {
  const now = new Date();
  return {
    date_from: toDateString(new Date(now.getFullYear(), now.getMonth(), 1)),
    date_to: toDateString(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
    customer: '', keyword: '', material: '', warehouse: '', profit: '',
  };
};
const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });
const money = (value) => Math.round(Number(value || 0)).toLocaleString('ko-KR');
const decimal = (value) => (value === null || value === undefined || value === '' ? '' : Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 3 }));
const marginText = (value) => (value === null || value === undefined ? '–' : Number(value).toFixed(2));
const groupKey = (entry) => `${entry.customcode || ''}|${entry.customname || ''}`;
const costTotal = (entry) => Number(entry?.purchase_amt || 0) + Number(entry?.purchase_cost || 0) + Number(entry?.process_amt || 0);

function MarginCell({ value, profit }) {
  if (value === null || value === undefined) return <span className={pageClasses.marginNone}>–</span>;
  const up = Number(profit) >= 0;
  return <span className={up ? pageClasses.marginUp : pageClasses.marginDown}>{up ? '▲' : '▼'} {marginText(value)}</span>;
}

const renderCell = (row, column, index) => {
  const value = row[column.key];
  if (column.key === 'no') return index;
  if (column.key === 'receptdate') return value ? String(value).slice(0, 10) : '';
  if (column.key === 'origin_kind') return ORIGIN_LABELS[value] || value || '';
  if (column.type === 'money') return money(value);
  if (column.type === 'decimal') return decimal(value);
  if (column.type === 'margin') return <MarginCell value={value} profit={row.profit_amt} />;
  return value ?? '';
};
const cellStyle = (column) => ({ textAlign: column.align || (column.type ? 'right' : undefined) });
// 이익금액: 이익은 빨강, 손실은 파랑 (마진율 ▲/▼ 와 같은 색)
const profitClass = (value) => `${pageClasses.profitCell} ${Number(value) < 0 ? pageClasses.profitDown : pageClasses.profitUp}`;

// 출고 행 (가벼운 일반 td)
const ProfitRow = memo(function ProfitRow({ row, index }) {
  const loss = Number(row.profit_amt) < 0;
  return <tr className={`${TR}${loss ? ` ${pageClasses.lossRow}` : ''}`} data-with-row-border="true" data-hover="true">
    {COLUMNS.map((column) => <td key={column.key} className={`${TD}${column.key === 'profit_amt' ? ` ${profitClass(row.profit_amt)}` : ''}`}
      data-with-column-border="true" style={cellStyle(column)}>{renderCell(row, column, index)}</td>)}
  </tr>;
});

// 소계·총계 행: 금액·수량·중량·마진율만 표시
const SummaryCells = ({ entry, label }) => COLUMNS.map((column, columnIndex) => {
  let content = '';
  if (columnIndex === 1) content = label;
  else if (column.type === 'money') content = money(entry[column.key]);
  else if (column.type === 'margin') content = <MarginCell value={entry.margin_rate} profit={entry.profit_amt} />;
  else if (column.key === 'qty' || column.key === 'weight') content = decimal(entry[column.key]);
  return <td key={column.key} className={`${TD}${column.key === 'profit_amt' ? ` ${profitClass(entry.profit_amt)}` : ''}`} data-with-column-border="true" style={cellStyle(column)}>{content}</td>;
});

const GroupBlock = memo(function GroupBlock({ group, rows, startIndex, collapsed, onToggle }) {
  const key = groupKey(group);
  return <>
    <tr className={`${TR} ${pageClasses.groupRow}`} data-with-row-border="true" onClick={() => onToggle(key)}>
      <td className={TD} colSpan={COLUMNS.length} data-with-column-border="true">
        <span className={pageClasses.groupTitle}>
          {collapsed ? <IconChevronRight size={14} /> : <IconChevronDown size={14} />}
          매출처 : <b>{group.customname || '(거래처 없음)'}</b>
          <span className={pageClasses.groupMeta}>{Number(group.line_count).toLocaleString()}건 · 이익 {money(group.profit_amt)}원 · 마진 {marginText(group.margin_rate)}%</span>
        </span>
      </td>
    </tr>
    {!collapsed && rows.map((row, offset) => <ProfitRow key={`${row.receiptno}:${row.lineno}`} row={row} index={startIndex + offset + 1} />)}
    <tr className={`${TR} ${pageClasses.subtotalRow}`} data-with-row-border="true"><SummaryCells entry={group} label="소계" /></tr>
  </>;
});

// 조회조건 (입력이 바뀔 때만 다시 그림)
const FilterSidebar = memo(function FilterSidebar({ inputs, setInputs, onSearch, onClose }) {
  const onKey = (event) => { if (event.key === 'Enter') onSearch(); };
  const text = (key, label, placeholder) => <TextInput label={label} placeholder={placeholder} value={inputs[key]} onKeyDown={onKey}
    onChange={(event) => { const { value } = event.currentTarget; setInputs((current) => ({ ...current, [key]: value })); }} />;
  return <Paper component="aside" className={classes.filterSidebar} withBorder>
    <Group className={classes.filterHeader} justify="space-between" align="center"><Text fw={700}>조회조건</Text>
      <ActionIcon variant="subtle" color="gray" aria-label="조회조건 닫기" onClick={onClose}><IconX size={16} /></ActionIcon></Group>
    <Stack gap="sm" className={classes.filterFields}>
      <Box><Text className={classes.filterGroupLabel}>매출(출고) 기간</Text><Stack gap={6}>
        <ErpDateInput aria-label="매출 시작일" type="date" value={inputs.date_from} onChange={(event) => { const { value } = event.currentTarget; setInputs((current) => ({ ...current, date_from: value })); }} />
        <ErpDateInput aria-label="매출 종료일" type="date" value={inputs.date_to} onChange={(event) => { const { value } = event.currentTarget; setInputs((current) => ({ ...current, date_to: value })); }} />
      </Stack></Box>
      {text('customer', '매출처', '거래처코드 또는 거래처명')}
      {text('keyword', '품명·품목·출고번호', '품명, 품목, 출고번호')}
      {text('material', '강종', '강종')}
      {text('warehouse', '창고', '창고코드 또는 창고명')}
      <Select label="손익" data={PROFIT_OPTIONS} value={inputs.profit} onChange={(value) => setInputs((current) => ({ ...current, profit: value || '' }))} />
    </Stack>
  </Paper>;
});

export default function GrossProfit() {
  const ribbon = useContext(PageRibbonContext);
  const registerRibbon = ribbon?.registerPageRibbon;
  const closePage = ribbon?.closeActivePage;
  const [filterOpen, setFilterOpen] = useState(true);
  const [inputs, setInputs] = useState(makeFilters);
  const [filters, setFilters] = useState(makeFilters);
  const [data, setData] = useState({ items: [], groups: [], total: null, truncated: false, max_rows: 0 });
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [autoCollapsed, setAutoCollapsed] = useState(false);
  const requestId = useRef(0);
  const closeFilter = useCallback(() => setFilterOpen(false), []);
  // 현황판에서 넘어온 조건 (?customer=&date_from=&date_to=) 적용
  const location = useLocation();
  const [appliedSearch, setAppliedSearch] = useState('');
  // 탭이 숨어 있는 동안 다른 화면 주소를 읽지 않도록 자기 경로일 때만 적용
  if (location.pathname.toLowerCase() === '/grossprofit' && location.search && location.search !== appliedSearch) {
    setAppliedSearch(location.search);
    const query = new URLSearchParams(location.search);
    const next = { ...makeFilters() };
    ['date_from', 'date_to', 'customer'].forEach((key) => { if (query.get(key)) next[key] = query.get(key); });
    setInputs(next);
    setFilters(next);
  }

  const load = useCallback(async (requested) => {
    const id = ++requestId.current;
    const params = Object.fromEntries(Object.entries(requested).filter(([, value]) => String(value || '').trim()));
    setLoading(true);
    try {
      const response = await axios.get('/api/gross-profit/analysis', { ...authConfig(), params });
      if (id !== requestId.current) return;
      setData(response.data);
      const many = (response.data.items || []).length > AUTO_COLLAPSE_ROWS;
      setCollapsed(many ? new Set((response.data.groups || []).map(groupKey)) : new Set());
      setAutoCollapsed(many);
    } catch (error) {
      if (id === requestId.current) notifications.show({ title: '매출이익분석 조회 실패', message: error.response?.data?.detail || '매출이익분석을 불러오지 못했습니다.', color: 'red' });
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);
  // 탭에 돌아오면 지금 조건 그대로 다시 불러온다 (다른 탭에서 데이터가 바뀌었을 수 있음)
  usePageReactivated(() => { void load(filters); });
  useEffect(() => { void load(filters); }, [load, filters]);

  const search = useCallback(() => {
    if (!inputs.date_from || !inputs.date_to) { notifications.show({ title: '조회 조건 확인', message: '매출 기간을 입력해 주세요.', color: 'orange' }); return; }
    if (inputs.date_from > inputs.date_to) { notifications.show({ title: '조회 조건 확인', message: '시작일은 종료일보다 뒤일 수 없습니다.', color: 'orange' }); return; }
    setFilters({ ...inputs });
  }, [inputs]);
  const toggleGroup = useCallback((key) => setCollapsed((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  }), []);

  // 행을 매출처별로 묶기 (소계는 서버가 조건 전체 기준으로 계산)
  const blocks = useMemo(() => {
    const byGroup = new Map();
    data.items.forEach((row) => {
      const key = groupKey(row);
      if (!byGroup.has(key)) byGroup.set(key, []);
      byGroup.get(key).push(row);
    });
    const result = [];
    data.groups.forEach((group) => {
      const rows = byGroup.get(groupKey(group)) || [];
      const startIndex = result.length ? result[result.length - 1].startIndex + result[result.length - 1].rows.length : 0;
      result.push({ group, rows, startIndex });
    });
    return result;
  }, [data]);
  const total = data.total;

  const exportExcel = useCallback(() => {
    if (!data.items.length) { notifications.show({ title: '엑셀 데이터 없음', message: '다운로드할 데이터가 없습니다.', color: 'orange' }); return; }
    const toRow = (row, index) => Object.fromEntries(COLUMNS.map((column) => {
      if (column.key === 'no') return [column.label, index];
      if (column.key === 'origin_kind') return [column.label, ORIGIN_LABELS[row.origin_kind] || ''];
      if (column.key === 'receptdate') return [column.label, row.receptdate ? String(row.receptdate).slice(0, 10) : ''];
      if (column.type === 'money') return [column.label, Math.round(Number(row[column.key] || 0))];
      if (column.type === 'margin') return [column.label, row.margin_rate === null ? '' : Number(row.margin_rate)];
      if (column.type === 'decimal') return [column.label, row[column.key] === null || row[column.key] === undefined ? '' : Number(row[column.key])];
      return [column.label, row[column.key] ?? ''];
    }));
    const summaryRow = (entry, label) => Object.fromEntries(COLUMNS.map((column, index) => {
      if (index === 1) return [column.label, label];
      if (column.type === 'money') return [column.label, Math.round(Number(entry[column.key] || 0))];
      if (column.type === 'margin') return [column.label, entry.margin_rate === null ? '' : Number(entry.margin_rate)];
      if (column.key === 'qty' || column.key === 'weight') return [column.label, Number(entry[column.key] || 0)];
      return [column.label, ''];
    }));
    const sheetRows = [];
    blocks.forEach(({ group, rows, startIndex }) => {
      rows.forEach((row, offset) => sheetRows.push(toRow(row, startIndex + offset + 1)));
      sheetRows.push(summaryRow(group, `소계 (${group.customname || ''})`));
    });
    if (total) sheetRows.push(summaryRow(total, '합계'));
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(sheetRows);
    applyExcelHeaderStyle(worksheet, COLUMNS.length);
    XLSX.utils.book_append_sheet(workbook, worksheet, '매출이익분석');
    XLSX.writeFile(workbook, `매출이익분석_${filters.date_from.replaceAll('-', '')}_${filters.date_to.replaceAll('-', '')}.xlsx`);
  }, [blocks, data.items.length, filters, total]);

  // 리본: 최신 핸들러는 ref로, 엑셀 사용 가능 여부가 바뀔 때만 다시 등록
  const hasItems = data.items.length > 0;
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
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconFileSpreadsheet size={15} />} onClick={() => actions.current.exportExcel()} disabled={!hasItems}>엑셀</Button>
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconDeviceFloppy size={15} />} disabled>저장</Button>
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconTrash size={15} />} disabled>삭제</Button>
        <span className={classes.ribbonSeparator} />
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconX size={15} />} onClick={closePage}>닫기</Button>
      </Group>,
    );
    return () => registerRibbon(null);
  }, [registerRibbon, closePage, hasItems]);

  const salesTotal = Number(total?.sales_amt || 0) + Number(total?.sales_plus || 0); // 매출비용(+)도 매출
  const cards = [
    { label: '매출금액', value: `${money(Number(total?.sales_amt || 0) + Number(total?.sales_plus || 0))}원`, hint: `판매 ${money(total?.sales_amt)} + 매출비용(+) ${money(total?.sales_plus)}`, accent: pageClasses.statSales, icon: IconChartBar },
    { label: '매입원가', value: `${money(costTotal(total))}원`, hint: `매입금액 ${money(total?.purchase_amt)} + 매입비용 ${money(total?.purchase_cost)} + 가공비 ${money(total?.process_amt)}`, accent: pageClasses.statCost, icon: IconShoppingCart },
    { label: '판매비용', value: `${money(total?.sales_minus)}원`, hint: "출고 기타비용 중 비용여부 '예' (운반비 등 우리가 부담한 비용)", accent: pageClasses.statExpense, icon: IconTruckDelivery },
    { label: '이익금액', value: `${money(total?.profit_amt)}원`, hint: '매출금액(매출비용(+) 포함) − 매입원가 − 판매비용', tone: Number(total?.profit_amt || 0) < 0 ? 'loss' : 'gain', accent: pageClasses.statProfit, icon: IconCoin },
    { label: '마진율', value: salesTotal ? `${marginText(total?.margin_rate)}%` : '–', hint: '이익금액 ÷ (매출금액 + 매출비용(+))', tone: Number(total?.profit_amt || 0) < 0 ? 'loss' : 'gain', accent: pageClasses.statMargin, icon: IconPercentage },
  ];

  return (
    <Box className={`${sharedClasses.pageShell} ${classes.page} ${pageClasses.page}`}>
      <Box component="nav" aria-label="현재 위치" className={classes.pageBreadcrumb}>
        <Group className={classes.breadcrumbTrail} gap={7}>
          <Text component="span" className={classes.breadcrumbParent}>매출관리</Text>
          <Text component="span" className={classes.breadcrumbChevron}>›</Text>
          <Text component="span" className={classes.breadcrumbCurrent}>매출이익 분석</Text>
        </Group>
        {!filterOpen && <Button className={classes.filterToggle} variant="subtle" size="xs" leftSection={<IconFilter size={15} />} onClick={() => setFilterOpen(true)}>조회조건</Button>}
      </Box>

      <Box className={pageClasses.cardGrid} aria-label="매출이익 요약">
        {cards.map((card) => <Paper key={card.label} className={`${pageClasses.statCard} ${card.accent}`} withBorder title={card.hint}>
          <Box className={pageClasses.statHead}>
            <Text className={pageClasses.statLabel}>{card.label}</Text>
            <span className={pageClasses.statIcon}><card.icon size={16} stroke={1.8} /></span>
          </Box>
          <Text className={`${pageClasses.statValue} ${card.tone === 'loss' ? pageClasses.toneLoss : card.tone === 'gain' ? pageClasses.toneGain : ''}`}>{card.value}</Text>
        </Paper>)}
      </Box>

      <Box className={classes.inboundWorkspace}>
        <Paper className={`${sharedClasses.panel} ${classes.resultsPanel}`} withBorder>
          <Group className={classes.resultsToolbar} justify="space-between" wrap="nowrap">
            <Group gap={8} wrap="nowrap" className={pageClasses.toolbarLeft}>
              <Text className={classes.sectionTitle} fw={700}>매출처별 매출이익</Text>
              <span className={classes.countBadge}>{Number(total?.line_count || 0).toLocaleString()}건</span>
              <span className={classes.toolbarMeta} title="조회 기간 (매출일자)"><IconCalendar size={13} />{filters.date_from} ~ {filters.date_to}</span>
              {autoCollapsed && !data.truncated && <Text size="xs" c="dimmed">행이 많아 매출처별 소계만 먼저 보여 줍니다. 매출처를 누르면 펼쳐집니다.</Text>}
              {data.truncated && <Text size="xs" c="orange.8" fw={600}>행이 많아 앞의 {data.max_rows.toLocaleString()}건만 표시합니다 (소계·합계는 전체 기준). 기간이나 조건을 좁혀 주세요.</Text>}
            </Group>
            <Group gap={6} wrap="nowrap">
              <Button size="xs" variant="subtle" color="gray" onClick={() => setCollapsed(new Set())}>모두 펼치기</Button>
              <Button size="xs" variant="subtle" color="gray" onClick={() => setCollapsed(new Set(data.groups.map(groupKey)))}>모두 접기</Button>
            </Group>
          </Group>
          <Box className={classes.tableWrap}>
            {loading && <Box className={classes.loadingOverlay}><Loader color="red" size="sm" /></Box>}
            <Box className={classes.inboundSearchScroller} style={{ height: '100%', width: '100%' }}>
              <Table className={`${classes.statusTable} ${pageClasses.profitTable}`} withTableBorder withColumnBorders style={{ width: TABLE_WIDTH, minWidth: TABLE_WIDTH, tableLayout: 'fixed' }}>
                <colgroup>{COLUMNS.map((column) => <col key={column.key} style={{ width: `${column.width}px` }} />)}</colgroup>
                <Table.Thead><Table.Tr>{COLUMNS.map((column) => <Table.Th key={column.key} style={{ position: 'sticky', top: 0, zIndex: 3 }}>{column.label}</Table.Th>)}</Table.Tr></Table.Thead>
                <tbody>
                  {blocks.length ? blocks.map((block) => <GroupBlock key={groupKey(block.group)} group={block.group} rows={block.rows} startIndex={block.startIndex}
                    collapsed={collapsed.has(groupKey(block.group))} onToggle={toggleGroup} />)
                    : !loading && <tr><td colSpan={COLUMNS.length} className={`${pageClasses.emptyCell} ${classes.emptyCell}`}>
                      <Box className={classes.emptyState}>
                        <span className={classes.emptyIcon}><IconTrendingUp size={22} stroke={1.6} /></span>
                        <span className={classes.emptyTitle}>조회된 매출이 없습니다.</span>
                        <span>기간과 조건을 확인해 주세요.</span>
                      </Box>
                    </td></tr>}
                </tbody>
                {total && blocks.length > 0 ? <tfoot><tr className={`${TR} ${pageClasses.totalRow}`}><SummaryCells entry={total} label="합계" /></tr></tfoot> : null}
              </Table>
            </Box>
          </Box>
        </Paper>

        {filterOpen && <FilterSidebar inputs={inputs} setInputs={setInputs} onSearch={search} onClose={closeFilter} />}
      </Box>
    </Box>
  );
}
