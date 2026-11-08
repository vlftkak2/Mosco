import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { ActionIcon, Badge, Box, Button, Group, Loader, Pagination, Paper, Select, Stack, Table, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCopy, IconDeviceFloppy, IconFileSpreadsheet, IconFilter, IconPlus, IconSearch, IconTrash, IconX } from '@tabler/icons-react';
import ErpDateInput from '../components/common/ErpDateInput';
import { PageRibbonContext } from '../components/layout/MainLayout';
import sharedClasses from '../styles/pages/ManagementShared.module.css';
import classes from '../styles/pages/InboundSearch.module.css';
import paymentClasses from '../styles/pages/ReceiptPaymentSearch.module.css';
import { INSTRUMENT_OPTIONS_BY_FIELD, instrumentLabel } from '../utils/instrumentCodes';

const PAGE_SIZE_OPTIONS = [15, 50, 100, 200].map((value) => ({ value: String(value), label: `${value}개씩` }));
const COLUMNS = [
  ['receiptdate', '수금/지급일', 100], ['transactiontype', '구분', 75], ['customname', '거래처', 100],
  ['cashamt', '현금', 90], ['instrumenttype', '수표/어음 종류', 90], ['instrumentno', '수표/어음 번호', 90],
  ['issuercompany', '발행회사', 100], ['issuekind', '발행구분', 90], ['maturitydate', '만기일', 80],
  ['instrumentstatus', '어음처리상태', 90], ['bankamt', '은행예금', 70], ['cardamt', '카드', 70],
  ['offsetamt', '상계', 70], ['lossamt', '잡손실', 70], ['chargeamt', '과금', 70], ['totalamt', '합계', 80],
  ['detail_description', '비고', 130], ['receiptno', '전표번호', 110], ['lineno', '전표순번', 70],
  ['created_at', '등록일자', 110], ['updated_at', '수정일자', 110],
  ['created_by', '등록자', 80], ['updated_by', '수정자', 80],
].map(([key, label, width]) => ({ key, label, width, minWidth: Math.min(width, 65) }));
const NUMERIC_COLUMNS = new Set(['cashamt', 'instrumentamt', 'bankamt', 'cardamt', 'offsetamt', 'lossamt', 'chargeamt', 'totalamt']);

const makeDefaultFilters = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const pad = (value) => String(value).padStart(2, '0');
  return {
    date_from: `${year}-${pad(month + 1)}-01`,
    date_to: `${year}-${pad(month + 1)}-${pad(new Date(year, month + 1, 0).getDate())}`,
    transactiontype: '', customer: '', receiptno: '',
  };
};
const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });
const displayDate = (value) => value ? String(value).slice(0, 10) : '';
const displayDateTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
};
const formatNumber = (value) => {
  if (value === null || value === undefined || value === '') return '';
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString('ko-KR', { maximumFractionDigits: 3 }) : String(value);
};
const formatWon = (value) => `${formatNumber(value || 0)}원`;

export default function ReceiptPaymentSearch() {
  const ribbon = useContext(PageRibbonContext);
  const registerRibbon = ribbon?.registerPageRibbon;
  const closePage = ribbon?.closeActivePage;
  const [filterInputs, setFilterInputs] = useState(makeDefaultFilters);
  const [filters, setFilters] = useState(makeDefaultFilters);
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState({ receipt_count: 0, detail_count: 0, receipt_total: 0, payment_total: 0 });
  const [filterOpen, setFilterOpen] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [columnWidths, setColumnWidths] = useState({});
  const tableWidth = COLUMNS.reduce((sum, column) => sum + (columnWidths[column.key] ?? column.width), 0);
  const requestIdRef = useRef(0);

  const resizeColumn = (event, column) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = columnWidths[column.key] ?? column.width;
    const table = event.currentTarget.closest('table');
    const col = [...(table?.querySelectorAll('col[data-column-key]') || [])].find((element) => element.dataset.columnKey === column.key);
    let nextWidth = startWidth;
    let animationFrame = 0;
    const applyWidth = () => {
      const nextTableWidth = tableWidth + nextWidth - startWidth;
      if (col) col.style.width = `${nextWidth}px`;
      if (table) { table.style.width = `${nextTableWidth}px`; table.style.minWidth = `${nextTableWidth}px`; }
    };
    const move = (pointerEvent) => {
      nextWidth = Math.max(column.minWidth, Math.min(1200, startWidth + pointerEvent.clientX - startX));
      if (!animationFrame) animationFrame = window.requestAnimationFrame(() => { animationFrame = 0; applyWidth(); });
    };
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      applyWidth();
      setColumnWidths((current) => ({ ...current, [column.key]: nextWidth }));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  };

  const loadItems = useCallback(async (requestedPage, requestedFilters, requestedPageSize) => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const params = { page: requestedPage, page_size: requestedPageSize };
      Object.entries(requestedFilters).forEach(([key, value]) => { if (String(value || '').trim()) params[key] = String(value).trim(); });
      const { data } = await axios.get('/api/receipt-payment-search/details', { ...authConfig(), params });
      if (requestId !== requestIdRef.current) return;
      setItems(data.items || []);
      setTotal(data.total || 0);
      setSummary(data.summary || { receipt_count: 0, detail_count: 0, receipt_total: 0, payment_total: 0 });
    } catch (error) {
      if (requestId === requestIdRef.current) notifications.show({ title: '수금/지급 현황 조회 실패', message: error.response?.data?.detail || '수금/지급 내역을 불러오지 못했습니다.', color: 'red' });
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => { void loadItems(page, filters, pageSize); }, [loadItems, page, filters, pageSize]);

  const runSearch = useCallback(() => {
    if (filterInputs.date_from && filterInputs.date_to && filterInputs.date_from > filterInputs.date_to) {
      notifications.show({ title: '조회 조건 확인', message: '시작일은 종료일보다 뒤일 수 없습니다.', color: 'orange' });
      return;
    }
    setFilters(Object.fromEntries(Object.entries(filterInputs).map(([key, value]) => [key, String(value || '').trim()])));
    setPage(1);
  }, [filterInputs]);
  const handleFilterKeyDown = useCallback((event) => { if (event.key === 'Enter') runSearch(); }, [runSearch]);

  const exportExcel = useCallback(async () => {
    if (!items.length || exporting) return;
    setExporting(true);
    try {
      const header = COLUMNS.map((column) => column.label);
      const rows = items.map((item, index) => COLUMNS.map((column) => {
        if (column.key === 'no') return (page - 1) * pageSize + index + 1;
        if (column.key === 'transactiontype') return item.transactiontype === 'PAYMENT' ? '지급' : '수금';
        if (['receiptdate', 'issuedate', 'maturitydate'].includes(column.key)) return displayDate(item[column.key]);
        if (['header_created_at', 'header_updated_at', 'created_at', 'updated_at'].includes(column.key)) return displayDateTime(item[column.key]);
        if (INSTRUMENT_OPTIONS_BY_FIELD[column.key]) return instrumentLabel(column.key, item[column.key]);
        return item[column.key] ?? '';
      }));
      const csv = [header, ...rows].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
      const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `수금지급현황_${new Date().toISOString().slice(0, 10).replaceAll('-', '')}.csv`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      notifications.show({ title: '엑셀 다운로드 실패', message: '현재 조회한 내역을 파일로 저장하지 못했습니다.', color: 'red' });
    } finally { setExporting(false); }
  }, [items, exporting, page, pageSize]);

  useEffect(() => {
    if (!registerRibbon) return undefined;
    registerRibbon(
      <Group className={classes.commandRibbon} justify="flex-start" wrap="nowrap" gap={2}>
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconSearch size={15} />} onClick={runSearch} loading={loading}>조회</Button>
        <span className={classes.ribbonSeparator} />
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconPlus size={15} />} disabled>추가</Button>
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconCopy size={15} />} disabled>복사</Button>
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconFileSpreadsheet size={15} />} onClick={exportExcel} loading={exporting} disabled={!items.length || loading}>엑셀</Button>
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconDeviceFloppy size={15} />} disabled>저장</Button>
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconTrash size={15} />} disabled>삭제</Button>
        <span className={classes.ribbonSeparator} />
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconX size={15} />} onClick={closePage}>닫기</Button>
      </Group>,
    );
    return () => registerRibbon(null);
  }, [registerRibbon, closePage, runSearch, loading, exportExcel, exporting, items.length]);

  const renderCell = (item, column, index) => {
    const key = column.key;
    if (key === 'no') return (page - 1) * pageSize + index + 1;
    if (key === 'transactiontype') return <Badge className={item.transactiontype === 'PAYMENT' ? paymentClasses.paymentBadge : paymentClasses.receiptBadge} variant="light">{item.transactiontype === 'PAYMENT' ? '지급' : '수금'}</Badge>;
    if (['receiptdate', 'issuedate', 'maturitydate'].includes(key)) return displayDate(item[key]);
    if (['header_created_at', 'header_updated_at', 'created_at', 'updated_at'].includes(key)) return displayDateTime(item[key]);
    if (NUMERIC_COLUMNS.has(key)) return formatNumber(item[key]);
    if (INSTRUMENT_OPTIONS_BY_FIELD[key]) return instrumentLabel(key, item[key]);
    return item[key] ?? '';
  };

  return (
    <Box className={`${sharedClasses.pageShell} ${classes.page}`}>
      <Box component="nav" aria-label="현재 위치" className={classes.pageBreadcrumb}>
        <Group className={classes.breadcrumbTrail} gap={7}>
          <Text component="span" className={classes.breadcrumbParent}>수금/지급관리</Text>
          <Text component="span" className={classes.breadcrumbChevron}>›</Text>
          <Text component="span" className={classes.breadcrumbCurrent}>수금/지급 현황</Text>
        </Group>
        {!filterOpen && <Button className={classes.filterToggle} variant="subtle" size="xs" leftSection={<IconFilter size={15} />} onClick={() => setFilterOpen(true)}>조회조건</Button>}
      </Box>

      <Box className={classes.summaryGrid} aria-label="수금/지급 현황 요약">
        <Paper className={classes.summaryCard} withBorder><Text className={classes.summaryLabel}>수금/지급 전표 수</Text><Text className={classes.summaryValue}>{Number(summary.receipt_count || 0).toLocaleString()}건</Text></Paper>
        <Paper className={classes.summaryCard} withBorder><Text className={classes.summaryLabel}>상세 건수</Text><Text className={classes.summaryValue}>{Number(summary.detail_count || 0).toLocaleString()}건</Text></Paper>
        <Paper className={classes.summaryCard} withBorder><Text className={classes.summaryLabel}>총 수금액</Text><Text className={classes.summaryValue}>{formatWon(summary.receipt_total)}</Text></Paper>
        <Paper className={classes.summaryCard} withBorder><Text className={classes.summaryLabel}>총 지급액</Text><Text className={classes.summaryValue}>{formatWon(summary.payment_total)}</Text></Paper>
      </Box>

      <Box className={classes.inboundWorkspace}>
        <Paper className={`${sharedClasses.panel} ${classes.resultsPanel}`} withBorder>
          <Group className={classes.resultsToolbar} justify="space-between" wrap="wrap">
            <Group gap={8}><Text className={classes.sectionTitle} fw={700}>수금/지급 현황</Text><Badge color="gray" variant="light">{total.toLocaleString()}건</Badge></Group>
          </Group>
          <Box className={classes.tableWrap}>
            {loading && <Box className={classes.loadingOverlay}><Loader color="red" size="sm" /></Box>}
            <Box className={classes.inboundSearchScroller} style={{ height: '100%', width: '100%' }}>
              <Table className={classes.statusTable} withTableBorder withColumnBorders highlightOnHover style={{ width: tableWidth, minWidth: tableWidth, tableLayout: 'fixed' }}>
                <colgroup>{COLUMNS.map((column) => <col key={column.key} data-column-key={column.key} style={{ width: `${columnWidths[column.key] ?? column.width}px` }} />)}</colgroup>
                <Table.Thead><Table.Tr>{COLUMNS.map((column) => <Table.Th key={column.key} style={{ width: columnWidths[column.key] ?? column.width, position: 'sticky', top: 0, zIndex: 3 }}>
                  <span>{column.label}</span><span className={classes.columnResizeHandle} role="separator" aria-label={`${column.label} 열 너비 조절`} onPointerDown={(event) => resizeColumn(event, column)} />
                </Table.Th>)}</Table.Tr></Table.Thead>
                <Table.Tbody>{items.length ? items.map((item, index) => <Table.Tr key={`${item.receiptno}:${item.lineno ?? 'empty'}`}>
                  {COLUMNS.map((column) => <Table.Td key={column.key} ta={column.key === 'no' ? 'center' : NUMERIC_COLUMNS.has(column.key) || column.key === 'lineno' ? 'right' : undefined}>{renderCell(item, column, index)}</Table.Td>)}
                </Table.Tr>) : !loading && <Table.Tr><Table.Td colSpan={COLUMNS.length} style={{ height: 180, textAlign: 'center', color: '#7c899b' }}>표시할 수금/지급 내역이 없습니다.</Table.Td></Table.Tr>}</Table.Tbody>
              </Table>
            </Box>
          </Box>
          <Group className={classes.paginationBar} justify="space-between" wrap="wrap">
            <Group gap="xs"><Text size="xs" c="dimmed">총 {total.toLocaleString()}건</Text><Select aria-label="페이지당 표시 건수" data={PAGE_SIZE_OPTIONS} value={String(pageSize)} w={100} size="xs" onChange={(value) => { if (value) { setPageSize(Number(value)); setPage(1); } }} /></Group>
            <Pagination size="sm" total={Math.max(1, Math.ceil(total / pageSize))} value={page} onChange={setPage} withEdges color="red" disabled={loading || !total} />
          </Group>
        </Paper>

        {filterOpen && <Paper component="aside" className={classes.filterSidebar} withBorder>
          <Group className={classes.filterHeader} justify="space-between" align="center"><Text fw={700}>조회조건</Text><ActionIcon variant="subtle" color="gray" aria-label="조회조건 닫기" onClick={() => setFilterOpen(false)}><IconX size={16} /></ActionIcon></Group>
          <Stack gap="sm" className={classes.filterFields}>
            <Box><Text size="xs" fw={700} mb={5}>수금/지급 기간</Text><Stack gap={6}>
              <ErpDateInput aria-label="수금/지급 시작일" type="date" value={filterInputs.date_from} onChange={(event) => setFilterInputs((current) => ({ ...current, date_from: event.currentTarget.value }))} />
              <ErpDateInput aria-label="수금/지급 종료일" type="date" value={filterInputs.date_to} onChange={(event) => setFilterInputs((current) => ({ ...current, date_to: event.currentTarget.value }))} />
            </Stack></Box>
            <Select label="구분" data={[{ value: '', label: '전체' }, { value: 'RECEIPT', label: '수금' }, { value: 'PAYMENT', label: '지급' }]} value={filterInputs.transactiontype} onChange={(value) => setFilterInputs((current) => ({ ...current, transactiontype: value || '' }))} />
            <TextInput label="거래처" placeholder="거래처코드 또는 거래처명" value={filterInputs.customer} onChange={(event) => setFilterInputs((current) => ({ ...current, customer: event.currentTarget.value }))} onKeyDown={handleFilterKeyDown} />
            <TextInput label="전표번호" placeholder="전표번호" value={filterInputs.receiptno} onChange={(event) => setFilterInputs((current) => ({ ...current, receiptno: event.currentTarget.value }))} onKeyDown={handleFilterKeyDown} />
          </Stack>
        </Paper>}
      </Box>
    </Box>
  );
}
