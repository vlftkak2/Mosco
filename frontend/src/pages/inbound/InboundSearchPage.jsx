import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import usePageReactivated from '../../components/common/usePageReactivated';
import ErpDateInput from '../../components/common/ErpDateInput';
import {
  ActionIcon, Box, Button, Checkbox, Group, Loader, Pagination, Paper, Select, Stack, Table, Text, TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconCalendar, IconCoin, IconCopy, IconDeviceFloppy, IconFileSpreadsheet, IconFilter, IconInbox,
  IconPlus, IconReceipt, IconScale, IconSearch, IconStack2, IconTrash, IconX,
} from '@tabler/icons-react';
import { PageRibbonContext } from '../../components/layout/MainLayout';
import sharedClasses from '../../styles/pages/ManagementShared.module.css';
import simpleTheme from '../../styles/pages/SimpleTheme.module.css';
import classes from '../../styles/pages/InboundSearch.module.css';
import { cachedDateFormat } from '../../utils/dateFormat';

const PAGE_SIZE_OPTIONS = [
  { value: '15', label: '15개씩' },
  { value: '50', label: '50개씩' },
  { value: '100', label: '100개씩' },
  { value: '200', label: '200개씩' },
];
const EMPTY_SUMMARY = { receipt_count: 0, detail_count: 0, total_qty: 0, total_weight: 0, total_amount: 0 };
const TABLE_COLUMN_WIDTHS = {
  no: 45, receptdate: 100, receiptno: 160, customname: 125, warehousecodename: 110,
  productname: 105, itemname: 125, materialname: 85, surfacename: 75, myrtle: 100,
  thickness: 60, width: 50, length: 60, qty: 70, weight: 80, unitprice: 90,
  supplyamt: 90, vat: 80, unitamt: 95, kind_label: 75, qtyunit: 75, unit: 75, manager: 80,
  description: 120, lineno: 55, created_at: 145, updated_at: 145, created_by: 90, updated_by: 90,
};
const TABLE_COLUMNS = [
  ['no', 'No.'], ['receptdate', '입고일자'], ['customname', '매입처'], ['itemname', '품명'], ['materialname', '강종'],
  ['surfacename', '표면'], ['myrtle', '도금량(g/㎡)'], ['thickness', '두께'], ['width', '폭'], ['length', '길이'],
  ['qty', '수량'], ['weight', '중량'], ['supplyamt', '공급가'], ['vat', '부가세'], ['unitamt', '합계금액'],
  ['warehousecodename', '창고'], ['productname', '제품번호'], ['kind_label', '구분'],
  ['unitprice', '매입단가'], ['qtyunit', '수량단위'], ['unit', '단가기준'], ['manager', '담당자'], ['description', '비고'],
  ['receiptno', '입고전표'], ['lineno', '순번'],
  ['created_at', '등록일자'], ['created_by', '등록자'], ['updated_at', '수정일자'], ['updated_by', '수정자'],
].map(([key, label]) => ({ key, label, width: TABLE_COLUMN_WIDTHS[key], minWidth: Math.min(TABLE_COLUMN_WIDTHS[key], 72) }));

// 표 칸 내용 (key → 칸). 순서는 TABLE_COLUMNS 를 따른다 → 머리글과 내용 순서가 항상 같음
const NUMBER_KEYS = new Set(['myrtle', 'thickness', 'width', 'length', 'qty', 'weight', 'lineno']);
const MONEY_KEYS = new Set(['supplyamt', 'vat', 'unitamt', 'unitprice']);
const renderCell = (key, item) => {
  if (key === 'receptdate') return <Table.Td key={key} ta="center">{displayDate(item.receptdate)}</Table.Td>;
  if (key === 'created_at' || key === 'updated_at') return <Table.Td key={key} ta="center">{displayDateTime(item[key])}</Table.Td>;
  if (NUMBER_KEYS.has(key)) return <Table.Td key={key} ta="right">{displayNumber(item[key])}</Table.Td>;
  if (MONEY_KEYS.has(key)) return <Table.Td key={key} ta="right">{displayNumber(item[key], 2)}</Table.Td>;
  if (key === 'kind_label') return <Table.Td key={key} ta="center">{item.kind_label}</Table.Td>;
  return <Table.Td key={key} title={item[key] || undefined}>{item[key]}</Table.Td>;
};

const makeDefaultFilters = () => {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const pad = (value) => String(value).padStart(2, '0');
  return {
    date_from: `${year}-${pad(month + 1)}-01`,
    date_to: `${year}-${pad(month + 1)}-${pad(new Date(year, month + 1, 0).getDate())}`,
    receiptno: '', customer: '', warehouse: '', iteminfo: '', thickness: '', width: '', length: '',
    include_sales_cost: '', include_process_cost: '',
  };
};

const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });
const displayDate = (value) => value ? String(value).slice(0, 10) : '';
const displayDateTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const parts = cachedDateFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
};
const displayNumber = (value, maximumFractionDigits = 3) => {
  if (value === null || value === undefined || value === '') return '';
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString(undefined, { maximumFractionDigits }) : value;
};

const FILTERS = [
  { key: 'customer', label: '매입처', placeholder: '매입처코드 또는 매입처명' },
  { key: 'warehouse', label: '창고', placeholder: '창고코드 또는 창고명' },
  { key: 'receiptno', label: '입고전표번호', placeholder: '전표번호' },
  { key: 'iteminfo', label: '품목정보', placeholder: '품목코드 또는 품목명' },
  { key: 'thickness', label: '두께', placeholder: '두께 검색' },
  { key: 'width', label: '폭', placeholder: '폭 검색' },
  { key: 'length', label: '길이', placeholder: '길이 검색' },
];

// 조회조건 '비용 포함': 매입 기타비용은 항상 보이고, 아래는 켜면 함께 보인다
const COST_TOGGLES = [
  { key: 'include_sales_cost', label: '매출 비용 포함', description: "매출 기타비용 중 비용여부 '예'" },
  { key: 'include_process_cost', label: '가공 비용 포함', description: '가공전표별 총 가공금액' },
];

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

export default function InboundSearchPage() {
  const pageLayout = useContext(PageRibbonContext);
  const registerPageRibbon = pageLayout?.registerPageRibbon;
  const closeActivePage = pageLayout?.closeActivePage;
  const [filterInputs, setFilterInputs] = useState(makeDefaultFilters);
  const [filters, setFilters] = useState(makeDefaultFilters);
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [filterOpen, setFilterOpen] = useState(true);
  const [columnWidths, setColumnWidths] = useState({});
  const tableWidth = TABLE_COLUMNS.reduce((sum, column) => sum + (columnWidths[column.key] ?? column.width), 0);
  const requestIdRef = useRef(0);

  const resizeColumn = (event, column) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = columnWidths[column.key] ?? column.width;
    const table = event.currentTarget.closest('table');
    const col = [...(table?.querySelectorAll('col[data-column-key]') || [])]
      .find((element) => element.dataset.columnKey === column.key);
    const baseTableWidth = tableWidth;
    let nextWidth = startWidth;
    let animationFrame = 0;
    const applyWidth = () => {
      const nextTableWidth = baseTableWidth + nextWidth - startWidth;
      if (col) col.style.width = `${nextWidth}px`;
      if (table) {
        table.style.width = `${nextTableWidth}px`;
        table.style.minWidth = `${nextTableWidth}px`;
      }
    };
    const move = (pointerEvent) => {
      nextWidth = Math.max(column.minWidth, Math.min(1600, startWidth + pointerEvent.clientX - startX));
      if (!animationFrame) {
        animationFrame = window.requestAnimationFrame(() => {
          animationFrame = 0;
          applyWidth();
        });
      }
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

  const renderHeader = (column) => (
    <Table.Th key={column.key} style={{ width: columnWidths[column.key] ?? column.width, position: 'sticky', top: 0, zIndex: 3 }}>
      <span>{column.label}</span>
      <span
        className={classes.columnResizeHandle}
        role="separator"
        aria-label={`${column.label} 열 너비 조절`}
        onPointerDown={(event) => resizeColumn(event, column)}
      />
    </Table.Th>
  );

  // 요약(건수·합계)은 조회조건이 바뀌었을 때(또는 탭 복귀 등 force)만 서버에 계산을 요청한다. 쪽 넘김은 행만 가져온다.
  const summaryKeyRef = useRef('');
  const loadItems = useCallback(async (requestedPage, requestedFilters, requestedPageSize, force = false) => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    const summaryKey = JSON.stringify(requestedFilters);
    const withSummary = force || summaryKey !== summaryKeyRef.current;
    try {
      const params = { page: requestedPage, page_size: requestedPageSize, summary: withSummary };
      Object.entries(requestedFilters).forEach(([key, value]) => {
        if (String(value || '').trim()) params[key] = String(value).trim();
      });
      const { data } = await axios.get('/api/inbound-search/details', { ...authConfig(), params });
      if (requestId !== requestIdRef.current) return;
      setItems(data.items || []);
      if (data.summary) {
        setTotal(data.total || 0);
        setSummary(data.summary);
        summaryKeyRef.current = summaryKey;
      }
    } catch (error) {
      if (requestId === requestIdRef.current) {
        summaryKeyRef.current = '';
        notifications.show({
          title: '입고현황 조회 실패',
          message: error.response?.data?.detail || '입고 내역을 불러오지 못했습니다.',
          color: 'red',
        });
      }
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  // 탭에 돌아오면 지금 조건 그대로 다시 불러온다 (다른 탭에서 데이터가 바뀌었을 수 있음)
  usePageReactivated(() => { void loadItems(page, filters, pageSize, true); });
  useEffect(() => {
    void loadItems(page, filters, pageSize);
  }, [loadItems, page, filters, pageSize]);

  const runSearch = useCallback(() => {
    if (filterInputs.date_from && filterInputs.date_to && filterInputs.date_from > filterInputs.date_to) {
      notifications.show({ title: '조회 조건 확인', message: '시작일은 종료일보다 뒤일 수 없습니다.', color: 'orange' });
      return;
    }
    setFilters(Object.fromEntries(Object.entries(filterInputs).map(([key, value]) => [key, String(value || '').trim()])));
    setPage(1);
  }, [filterInputs]);

  const handleFilterKeyDown = (event) => {
    if (event.key === 'Enter') runSearch();
  };

  const exportExcel = useCallback(async () => {
    if (!total || exporting) return;
    setExporting(true);
    try {
      const params = Object.fromEntries(
        Object.entries(filters).filter(([, value]) => String(value || '').trim()),
      );
      const { data } = await axios.get('/api/inbound-search/details/export', {
        ...authConfig(),
        params,
        responseType: 'blob',
      });
      const downloadUrl = URL.createObjectURL(data);
      const link = document.createElement('a');
      const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
      link.href = downloadUrl;
      link.download = `매입현황_${date}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    } catch (error) {
      notifications.show({
        title: '엑셀 다운로드 실패',
        message: '조회 결과를 엑셀 파일로 다운로드하지 못했습니다.',
        color: 'red',
      });
    } finally {
      setExporting(false);
    }
  }, [total, exporting, filters]);

  useEffect(() => {
    if (!registerPageRibbon) return undefined;
    registerPageRibbon(
      <Group className={classes.commandRibbon} justify="flex-start" wrap="nowrap" gap={2}>
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconSearch size={15} />} onClick={runSearch} loading={loading}>조회</Button>
        <span className={classes.ribbonSeparator} />
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconPlus size={15} />} disabled>추가</Button>
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconCopy size={15} />} disabled>복사</Button>
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconDeviceFloppy size={15} />} disabled>저장</Button>
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconTrash size={15} />} disabled>삭제</Button>
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconFileSpreadsheet size={15} />} onClick={exportExcel} loading={exporting} disabled={!total || loading}>엑셀</Button>
        <span className={classes.ribbonSeparator} />
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconX size={15} />} onClick={closeActivePage}>닫기</Button>
      </Group>,
    );
    return () => registerPageRibbon(null);
  }, [registerPageRibbon, closeActivePage, runSearch, loading, exportExcel, exporting, total]);

  return (
    <Box className={`${sharedClasses.pageShell} ${classes.page} ${simpleTheme.simple}`}>
      <Box component="nav" aria-label="현재 위치" className={classes.pageBreadcrumb}>
        <Group className={classes.breadcrumbTrail} gap={7}>
          <Text component="span" className={classes.breadcrumbParent}>매입관리</Text>
          <Text component="span" className={classes.breadcrumbChevron}>›</Text>
          <Text component="span" className={classes.breadcrumbCurrent}>매입현황</Text>
        </Group>
        {!filterOpen && <Button className={classes.filterToggle} variant="subtle" size="xs" leftSection={<IconFilter size={15} />} onClick={() => setFilterOpen(true)}>조회조건</Button>}
      </Box>

      <Box className={classes.summaryGrid} aria-label="입고현황 요약">
        <SummaryCard label="입고전표 수" value={displayNumber(summary.receipt_count, 0)} unit="건" icon={IconReceipt} accent={classes.accentSlate} />
        <SummaryCard label="총 입고수량" value={displayNumber(summary.total_qty)} icon={IconStack2} accent={classes.accentBlue} />
        <SummaryCard label="총 입고중량" value={displayNumber(summary.total_weight)} unit="KG" icon={IconScale} accent={classes.accentAmber} />
        <SummaryCard label="총 입고금액" value={displayNumber(summary.total_amount, 0)} unit="원" icon={IconCoin} accent={classes.accentOrange} />
      </Box>

      <Box className={classes.inboundWorkspace}>
      <Paper className={`${sharedClasses.panel} ${classes.resultsPanel}`} withBorder>
        <Group className={classes.resultsToolbar} justify="space-between" wrap="wrap">
          <Box className={classes.toolbarTitle}>
            <Text className={classes.sectionTitle} fw={700}>매입현황</Text>
            <span className={classes.countBadge}>{total.toLocaleString()}건</span>
            <span className={classes.toolbarMeta} title="조회 기간 (입고일자)"><IconCalendar size={13} />{periodText(filters.date_from, filters.date_to)}</span>
          </Box>
        </Group>

        <Box className={classes.tableWrap}>
          {loading && <Box className={classes.loadingOverlay}><Loader color="red" size="sm" /></Box>}
          <Box className={classes.inboundSearchScroller} style={{ height: '100%', width: '100%' }}>
            <Table className={classes.statusTable} withTableBorder withColumnBorders highlightOnHover
              style={{ width: tableWidth, minWidth: tableWidth, tableLayout: 'fixed' }}>
              <colgroup>{TABLE_COLUMNS.map((column) => <col key={column.key} data-column-key={column.key} style={{ width: `${columnWidths[column.key] ?? column.width}px` }} />)}</colgroup>
              <Table.Thead><Table.Tr>{TABLE_COLUMNS.map(renderHeader)}</Table.Tr></Table.Thead>
              <Table.Tbody>{items.length ? items.map((item, index) => <Table.Tr key={`${item.kind}:${item.receiptno}:${item.lineno}`}>
                  <Table.Td ta="center">{(page - 1) * pageSize + index + 1}</Table.Td>
                  {TABLE_COLUMNS.slice(1).map((column) => renderCell(column.key, item))}
                </Table.Tr>) : !loading && <Table.Tr><Table.Td colSpan={TABLE_COLUMNS.length} className={classes.emptyCell}>
                  <Box className={classes.emptyState}>
                    <span className={classes.emptyIcon}><IconInbox size={22} stroke={1.6} /></span>
                    <span className={classes.emptyTitle}>표시할 입고 상세 내역이 없습니다.</span>
                    <span>입고기간이나 조회조건을 바꿔 다시 조회해 보세요.</span>
                  </Box>
                </Table.Td></Table.Tr>}</Table.Tbody>
            </Table>
          </Box>
        </Box>

        <Group className={classes.paginationBar} justify="space-between" wrap="wrap">
          <Group gap="xs">
            <Text size="xs" c="dimmed">{`총 ${total.toLocaleString()}건`}</Text>
            <Select aria-label={'페이지당 표시 건수'} data={PAGE_SIZE_OPTIONS} value={String(pageSize)} w={100} size="xs"
              onChange={(value) => { if (value) { setPageSize(Number(value)); setPage(1); } }} />
          </Group>
          <Pagination size="sm" total={Math.max(1, Math.ceil(total / pageSize))} value={page} onChange={setPage} withEdges color="red" disabled={loading || !total} />
        </Group>
      </Paper>
      {filterOpen && <Paper component="aside" className={classes.filterSidebar} withBorder>
        <Group className={classes.filterHeader} justify="space-between" align="center">
          <Text fw={700}>조회조건</Text>
          <ActionIcon variant="subtle" color="gray" aria-label="조회조건 닫기" onClick={() => setFilterOpen(false)}><IconX size={16} /></ActionIcon>
        </Group>
        <Stack gap="sm" className={classes.filterFields}>
          <Box>
            <Text className={classes.filterGroupLabel}>입고기간</Text>
            <Stack gap={6}>
              <ErpDateInput aria-label="입고 시작일" type="date" value={filterInputs.date_from}
                onChange={(event) => { const { value: nextValue } = event.currentTarget; setFilterInputs((current) => ({ ...current, date_from: nextValue })); }} />
              <ErpDateInput aria-label="입고 종료일" type="date" value={filterInputs.date_to}
                onChange={(event) => { const { value: nextValue } = event.currentTarget; setFilterInputs((current) => ({ ...current, date_to: nextValue })); }} />
            </Stack>
          </Box>
          {FILTERS.map(({ key, label, placeholder }) => (
            <TextInput key={key} label={label} placeholder={placeholder} value={filterInputs[key]}
              onChange={(event) => { const { value: nextValue } = event.currentTarget; setFilterInputs((current) => ({ ...current, [key]: nextValue })); }}
              onKeyDown={handleFilterKeyDown} />
          ))}
          {/* 기타비용(매입 전표)은 항상 포함. 아래 두 가지는 켜서 함께 본다 */}
          <Box>
            <Text className={classes.filterGroupLabel}>비용 포함</Text>
            <Box className={classes.costCheckList}>
              {COST_TOGGLES.map(({ key, label, description }) => (
                <label key={key} className={`${classes.costCheckRow} ${filterInputs[key] ? classes.costCheckRowOn : ''}`} title={description}>
                  <Checkbox size="xs" color="red" checked={Boolean(filterInputs[key])}
                    onChange={(event) => { const { checked } = event.currentTarget; setFilterInputs((current) => ({ ...current, [key]: checked ? '1' : '' })); }} />
                  <span className={classes.costCheckLabel}>{label}</span>
                </label>
              ))}
            </Box>
          </Box>
        </Stack>
      </Paper>}
      </Box>
    </Box>
  );
}
