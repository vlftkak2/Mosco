import { memo, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import axios from 'axios';
import usePageReactivated from '../../components/common/usePageReactivated';
import XLSX from 'xlsx-js-style';
import { ActionIcon, Badge, Box, Button, Group, Loader, Pagination, Paper, Select, Stack, Table, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconArrowDownLeft, IconArrowUpRight, IconCalendar, IconCopy, IconDeviceFloppy, IconFileSpreadsheet, IconFilter, IconInbox, IconListDetails, IconPlus, IconReceipt, IconSearch, IconTrash, IconX,
} from '@tabler/icons-react';
import ErpDateInput from '../../components/common/ErpDateInput';
import { PageRibbonContext } from '../../components/layout/MainLayout';
import sharedClasses from '../../styles/pages/ManagementShared.module.css';
import classes from '../../styles/pages/InboundSearch.module.css';
import paymentClasses from '../../styles/pages/ReceiptPaymentSearch.module.css';
import { applyExcelHeaderStyle } from '../../utils/excelHeaderStyle';
import { INSTRUMENT_OPTIONS_BY_FIELD, INSTRUMENT_TYPE_OPTIONS, instrumentLabel } from '../../utils/instrumentCodes';

const PAGE_SIZE_OPTIONS = [15, 50, 100, 200].map((value) => ({ value: String(value), label: `${value}개씩` }));
const COLUMNS = [
  ['receiptdate', '수금/지급일', 100], ['transactiontype', '구분', 75], ['customname', '거래처', 100],
  ['cashamt', '현금', 90], ['instrumenttype', '수표/어음 종류', 90], ['instrumentno', '수표/어음 번호', 90],
  ['instrumentamt', '수표·어음', 95],
  ['issuercompany', '발행회사', 100], ['issuekind', '발행구분', 90], ['maturitydate', '만기일', 80],
  ['instrumentstatus', '어음처리상태', 90], ['processdate', '처리일', 90], ['discountfee', '할인료', 80], ['processmemo', '처리메모', 130],
  ['bankamt', '은행예금', 70], ['cardamt', '카드', 70],
  ['offsetamt', '상계', 70], ['lossamt', '잡손실', 70], ['chargeamt', '과금', 70], ['totalamt', '합계', 80],
  ['detail_description', '비고', 130], ['receiptno', '전표번호', 110], ['lineno', '전표순번', 70],
  ['linked_receiptno', '연결 전표', 115],
  ['created_at', '등록일자', 110], ['updated_at', '수정일자', 110],
  ['created_by', '등록자', 80], ['updated_by', '수정자', 80],
].map(([key, label, width]) => ({ key, label, width, minWidth: Math.min(width, 65) }));
const NUMERIC_COLUMNS = new Set(['cashamt', 'instrumentamt', 'bankamt', 'cardamt', 'offsetamt', 'lossamt', 'chargeamt', 'totalamt', 'discountfee']);
const DATE_COLUMNS = ['receiptdate', 'issuedate', 'maturitydate', 'processdate'];
// 발행한 어음(지급·자수)은 처리 전 상태를 '출금 예정'(만기에 통장에서 나갈 돈)으로 보여 준다 (수금/지급 등록과 같음).
const statusText = (item) => {
  if (item.transactiontype === 'PAYMENT' && String(item.issuekind || '').toUpperCase() === 'OWN' && !item.instrumentstatus && Number(item.instrumentamt || 0) > 0) return '출금 예정';
  if (item.instrumentstatus === 'DISHONORED' && (item.source_receiptno || item.linked_receiptno
    || (item.transactiontype === 'PAYMENT' && String(item.issuekind || '').toUpperCase() === 'OTHER'))) return '부도(배서)'; // 넘겨준 어음의 부도
  return instrumentLabel('instrumentstatus', item.instrumentstatus);
};

const makeDefaultFilters = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const pad = (value) => String(value).padStart(2, '0');
  return {
    date_from: `${year}-${pad(month + 1)}-01`,
    date_to: `${year}-${pad(month + 1)}-${pad(new Date(year, month + 1, 0).getDate())}`,
    transactiontype: '', customer: '', receiptno: '',
    instrumentstatus: '', instrumenttype: '', issuekind: '',
  };
};
// 내역 탭 증권 조건
const DETAIL_STATUS_OPTIONS = [
  { value: '', label: '전체' }, { value: 'HELD', label: '보관' }, { value: 'UNPAID', label: '출금 예정' }, { value: 'ENDORSED', label: '배서' },
  { value: 'SETTLED', label: '결제' }, { value: 'DISCOUNTED', label: '할인' }, { value: 'DISHONORED', label: '부도' },
];
const TRANSACTION_FILTER_OPTIONS = [{ value: '', label: '전체' }, { value: 'RECEIPT', label: '수금' }, { value: 'PAYMENT', label: '지급' }];
const INSTRUMENT_TYPE_FILTER_OPTIONS = [{ value: '', label: '전체' }, ...INSTRUMENT_TYPE_OPTIONS];
const ISSUE_KIND_FILTER_OPTIONS = [{ value: '', label: '전체' }, { value: 'OTHER', label: '타수' }, { value: 'OWN', label: '자수' }, { value: 'NONE', label: '빈값' }];
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

// 내역 행: Mantine Table.Td 대신 같은 스타일의 일반 td (페이지 이동이 가볍게)
const renderDetailCell = (item, key) => {
  if (key === 'transactiontype') return <Badge className={item.transactiontype === 'PAYMENT' ? paymentClasses.paymentBadge : paymentClasses.receiptBadge} variant="light">{item.transactiontype === 'PAYMENT' ? '지급' : '수금'}</Badge>;
  if (DATE_COLUMNS.includes(key)) return displayDate(item[key]);
  if (['header_created_at', 'header_updated_at', 'created_at', 'updated_at'].includes(key)) return displayDateTime(item[key]);
  if (key === 'instrumentstatus') return statusText(item);
  if (key === 'discountfee') return Number(item.discountfee || 0) > 0 ? formatNumber(item.discountfee) : '';
  if (NUMERIC_COLUMNS.has(key)) return formatNumber(item[key]);
  if (INSTRUMENT_OPTIONS_BY_FIELD[key]) return instrumentLabel(key, item[key]);
  return item[key] ?? '';
};
// 칸 정렬: 숫자 오른쪽, 날짜·구분 가운데. 글자가 긴 칸은 넘치면 … (마우스를 올리면 전체 표시)
const CENTER_COLUMNS = new Set(['transactiontype', ...DATE_COLUMNS, 'created_at', 'updated_at']);
const TITLE_COLUMNS = new Set(['customname', 'instrumentno', 'issuercompany', 'processmemo', 'detail_description', 'receiptno', 'linked_receiptno']);
const cellAlign = (key) => {
  if (NUMERIC_COLUMNS.has(key) || key === 'lineno') return { textAlign: 'right' };
  if (CENTER_COLUMNS.has(key)) return { textAlign: 'center' };
  return undefined;
};
const DetailRow = memo(function DetailRow({ item }) {
  return <tr className="m_4e7aa4fd mantine-Table-tr" data-with-row-border="true" data-hover="true">
    {COLUMNS.map((column) => <td key={column.key} className="m_4e7aa4ef mantine-Table-td" data-with-column-border="true"
      title={TITLE_COLUMNS.has(column.key) && item[column.key] ? String(item[column.key]) : undefined}
      style={cellAlign(column.key)}>{renderDetailCell(item, column.key)}</td>)}
  </tr>;
});

const periodText = (from, to) => (from || to ? `${from || '처음'} ~ ${to || '끝'}` : '전체 기간');
function SummaryCard({ label, value, unit, icon: Icon, accent }) {
  return (
    <Paper className={`${classes.summaryCard} ${classes.summaryCardRow} ${accent}`} withBorder>
      <Box className={classes.summaryText}>
        <Text className={classes.summaryLabel}>{label}</Text>
        <Text className={classes.summaryValue} title={`${value} ${unit}`.trim()}>{value}{unit && <span className={classes.summaryUnit}>{unit}</span>}</Text>
      </Box>
      <span className={classes.summaryIcon}><Icon size={18} stroke={1.8} /></span>
    </Paper>
  );
}

// 표 머리글: 열 너비가 바뀔 때만 다시 그림
const DetailTableHead = memo(function DetailTableHead({ columnWidths, onResize }) {
  return <Table.Thead><Table.Tr>{COLUMNS.map((column) => <Table.Th key={column.key} style={{ width: columnWidths[column.key] ?? column.width, position: 'sticky', top: 0, zIndex: 3 }}>
    <span>{column.label}</span><span className={classes.columnResizeHandle} role="separator" aria-label={`${column.label} 열 너비 조절`} onPointerDown={(event) => onResize(event, column)} />
  </Table.Th>)}</Table.Tr></Table.Thead>;
});

// 조회조건 패널: 입력값이 바뀔 때만 다시 그림 (페이지 이동 때는 그대로)
const DetailFilterSidebar = memo(function DetailFilterSidebar({ filterInputs, setFilterInputs, onKeyDown, onClose }) {
  return <Paper component="aside" className={classes.filterSidebar} withBorder>
    <Group className={classes.filterHeader} justify="space-between" align="center"><Text fw={700}>조회조건</Text><ActionIcon variant="subtle" color="gray" aria-label="조회조건 닫기" onClick={onClose}><IconX size={16} /></ActionIcon></Group>
    <Stack gap="sm" className={classes.filterFields}>
      <Box><Text className={classes.filterGroupLabel}>수금/지급 기간</Text><Stack gap={6}>
        <ErpDateInput aria-label="수금/지급 시작일" type="date" value={filterInputs.date_from} onChange={(event) => { const { value: nextValue } = event.currentTarget; setFilterInputs((current) => ({ ...current, date_from: nextValue })); }} />
        <ErpDateInput aria-label="수금/지급 종료일" type="date" value={filterInputs.date_to} onChange={(event) => { const { value: nextValue } = event.currentTarget; setFilterInputs((current) => ({ ...current, date_to: nextValue })); }} />
      </Stack></Box>
      <Select label="구분" data={TRANSACTION_FILTER_OPTIONS} value={filterInputs.transactiontype} onChange={(value) => setFilterInputs((current) => ({ ...current, transactiontype: value || '' }))} />
      <TextInput label="거래처" placeholder="거래처코드 또는 거래처명" value={filterInputs.customer} onChange={(event) => { const { value: nextValue } = event.currentTarget; setFilterInputs((current) => ({ ...current, customer: nextValue })); }} onKeyDown={onKeyDown} />
      <TextInput label="전표번호" placeholder="전표번호" value={filterInputs.receiptno} onChange={(event) => { const { value: nextValue } = event.currentTarget; setFilterInputs((current) => ({ ...current, receiptno: nextValue })); }} onKeyDown={onKeyDown} />
      <Select label="증권 상태" data={DETAIL_STATUS_OPTIONS} value={filterInputs.instrumentstatus} onChange={(value) => setFilterInputs((current) => ({ ...current, instrumentstatus: value || '' }))} />
      <Select label="수표/어음 종류" data={INSTRUMENT_TYPE_FILTER_OPTIONS} value={filterInputs.instrumenttype} onChange={(value) => setFilterInputs((current) => ({ ...current, instrumenttype: value || '' }))} />
      <Select label="발행구분" data={ISSUE_KIND_FILTER_OPTIONS} value={filterInputs.issuekind} onChange={(value) => setFilterInputs((current) => ({ ...current, issuekind: value || '' }))} />
    </Stack>
  </Paper>;
});

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
  const closeFilter = useCallback(() => setFilterOpen(false), []);

  const resizeColumnNow = (event, column) => {
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

  const resizeRef = useRef(null);
  useLayoutEffect(() => { resizeRef.current = resizeColumnNow; });
  const resizeColumn = useCallback((event, column) => resizeRef.current?.(event, column), []);

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

  // 탭에 돌아오면 지금 조건 그대로 다시 불러온다 (다른 탭에서 데이터가 바뀌었을 수 있음)
  usePageReactivated(() => { void loadItems(page, filters, pageSize); });
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
      const rows = items.map((item, index) => Object.fromEntries(COLUMNS.map((column) => [column.label, (() => {
        if (column.key === 'no') return (page - 1) * pageSize + index + 1;
        if (column.key === 'transactiontype') return item.transactiontype === 'PAYMENT' ? '지급' : '수금';
        if (DATE_COLUMNS.includes(column.key)) return displayDate(item[column.key]);
        if (['header_created_at', 'header_updated_at', 'created_at', 'updated_at'].includes(column.key)) return displayDateTime(item[column.key]);
        if (column.key === 'instrumentstatus') return statusText(item);
        if (column.key === 'discountfee') return Number(item.discountfee || 0) > 0 ? item.discountfee : '';
        if (INSTRUMENT_OPTIONS_BY_FIELD[column.key]) return instrumentLabel(column.key, item[column.key]);
        if (NUMERIC_COLUMNS.has(column.key)) return Number(item[column.key] || 0);
        return item[column.key] ?? '';
      })()])));
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet(rows);
      applyExcelHeaderStyle(worksheet, COLUMNS.length);
      XLSX.utils.book_append_sheet(workbook, worksheet, '수금지급현황');
      const today = new Date();
      XLSX.writeFile(workbook, `수금지급현황_${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}.xlsx`);
    } catch {
      notifications.show({ title: '엑셀 다운로드 실패', message: '현재 조회한 내역을 파일로 저장하지 못했습니다.', color: 'red' });
    } finally { setExporting(false); }
  }, [items, exporting, page, pageSize]);

  // 리본: 최신 핸들러는 ref로 호출 → 페이지 이동·조회 중 표시 때문에 리본(레이아웃 전체)을 다시 등록하지 않는다.
  const ribbonActions = useRef({});
  useLayoutEffect(() => {
    ribbonActions.current = {
      search: () => runSearch(),
      excel: () => void exportExcel(),
    };
  });
  const excelDisabled = items.length === 0;
  useEffect(() => {
    if (!registerRibbon) return undefined;
    registerRibbon(
      <Group className={classes.commandRibbon} justify="flex-start" wrap="nowrap" gap={2}>
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconSearch size={15} />} onClick={() => ribbonActions.current.search()}>조회</Button>
        <span className={classes.ribbonSeparator} />
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconPlus size={15} />} disabled>추가</Button>
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconCopy size={15} />} disabled>복사</Button>
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconFileSpreadsheet size={15} />}
          onClick={() => ribbonActions.current.excel()} loading={exporting} disabled={excelDisabled}>엑셀</Button>
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconDeviceFloppy size={15} />} disabled>저장</Button>
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconTrash size={15} />} disabled>삭제</Button>
        <span className={classes.ribbonSeparator} />
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconX size={15} />} onClick={closePage}>닫기</Button>
      </Group>,
    );
    return () => registerRibbon(null);
  }, [registerRibbon, closePage, exporting, excelDisabled]);


  return (
    <Box className={`${sharedClasses.pageShell} ${classes.page}`}>
      <Box component="nav" aria-label="현재 위치" className={classes.pageBreadcrumb}>
        <Group className={classes.breadcrumbTrail} gap={7}>
          <Text component="span" className={classes.breadcrumbParent}>수금·지급</Text>
          <Text component="span" className={classes.breadcrumbChevron}>›</Text>
          <Text component="span" className={classes.breadcrumbCurrent}>수금·지급 현황</Text>
        </Group>
        {!filterOpen && <Button className={classes.filterToggle} variant="subtle" size="xs" leftSection={<IconFilter size={15} />} onClick={() => setFilterOpen(true)}>조회조건</Button>}
      </Box>

      <Box className={classes.summaryGrid} aria-label="수금/지급 현황 요약">
        <SummaryCard label="수금/지급 전표 수" value={Number(summary.receipt_count || 0).toLocaleString()} unit="건" icon={IconReceipt} accent={classes.accentSlate} />
        <SummaryCard label="상세 건수" value={Number(summary.detail_count || 0).toLocaleString()} unit="건" icon={IconListDetails} accent={classes.accentBlue} />
        <SummaryCard label="총 수금액" value={formatNumber(summary.receipt_total || 0)} unit="원" icon={IconArrowDownLeft} accent={classes.accentGreen} />
        <SummaryCard label="총 지급액" value={formatNumber(summary.payment_total || 0)} unit="원" icon={IconArrowUpRight} accent={classes.accentOrange} />
      </Box>

      <Box className={classes.inboundWorkspace}>
        <Paper className={`${sharedClasses.panel} ${classes.resultsPanel}`} withBorder>
          <Group className={classes.resultsToolbar} justify="space-between" wrap="wrap">
            <Box className={classes.toolbarTitle}><Text className={classes.sectionTitle} fw={700}>수금/지급 현황</Text><span className={classes.countBadge}>{total.toLocaleString()}건</span></Box>
            <span className={classes.toolbarMeta} title="조회 기간 (수금/지급일)"><IconCalendar size={13} />{periodText(filters.date_from, filters.date_to)}</span>
          </Group>
          <Box className={classes.tableWrap}>
            {loading && <Box className={classes.loadingOverlay}><Loader color="red" size="sm" /></Box>}
            <Box className={classes.inboundSearchScroller} style={{ height: '100%', width: '100%' }}>
              <Table className={classes.statusTable} withTableBorder withColumnBorders highlightOnHover style={{ width: tableWidth, minWidth: tableWidth, tableLayout: 'fixed' }}>
                <colgroup>{COLUMNS.map((column) => <col key={column.key} data-column-key={column.key} style={{ width: `${columnWidths[column.key] ?? column.width}px` }} />)}</colgroup>
                <DetailTableHead columnWidths={columnWidths} onResize={resizeColumn} />
                <Table.Tbody>{items.length ? items.map((item) => <DetailRow key={`${item.receiptno}:${item.lineno ?? 'empty'}`} item={item} />) : !loading && <Table.Tr><Table.Td colSpan={COLUMNS.length} className={classes.emptyCell}>
                  <Box className={classes.emptyState}>
                    <span className={classes.emptyIcon}><IconInbox size={22} stroke={1.6} /></span>
                    <span className={classes.emptyTitle}>표시할 수금/지급 내역이 없습니다.</span>
                    <span>수금/지급 기간이나 조회조건을 바꿔 다시 조회해 보세요.</span>
                  </Box>
                </Table.Td></Table.Tr>}</Table.Tbody>
              </Table>
            </Box>
          </Box>
          <Group className={classes.paginationBar} justify="space-between" wrap="wrap">
            <Group gap="xs"><Text size="xs" c="dimmed">총 {total.toLocaleString()}건</Text><Select aria-label="페이지당 표시 건수" data={PAGE_SIZE_OPTIONS} value={String(pageSize)} w={100} size="xs" onChange={(value) => { if (value) { setPageSize(Number(value)); setPage(1); } }} /></Group>
            <Pagination size="sm" total={Math.max(1, Math.ceil(total / pageSize))} value={page} onChange={setPage} withEdges color="red" disabled={loading || !total} />
          </Group>
        </Paper>

        {filterOpen && <DetailFilterSidebar filterInputs={filterInputs} setFilterInputs={setFilterInputs} onKeyDown={handleFilterKeyDown} onClose={closeFilter} />}
      </Box>
    </Box>
  );
}
