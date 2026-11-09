import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import usePageReactivated from '../../components/common/usePageReactivated';
import ErpDateInput from '../../components/common/ErpDateInput';
import {
  ActionIcon, Badge, Box, Button, Group, Loader, Pagination, Paper, Select, Stack,
  Table, Text, TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCopy, IconDeviceFloppy, IconFileSpreadsheet, IconFilter, IconPlus, IconSearch, IconTrash, IconX } from '@tabler/icons-react';
import { PageRibbonContext } from '../../components/layout/MainLayout';
import sharedClasses from '../../styles/pages/ManagementShared.module.css';
import classes from '../../styles/pages/ItemProcessSearch.module.css';

const PAGE_SIZE_OPTIONS = [
  { value: '15', label: '15개씩' },
  { value: '50', label: '50개씩' },
  { value: '100', label: '100개씩' },
  { value: '200', label: '200개씩' },
];
const EMPTY_SUMMARY = {
  process_count: 0, detail_count: 0, total_qty: 0, total_weight: 0,
  supplyamt: 0, vat: 0, total_amount: 0,
};
const COLUMNS = [
  ['no', 'No.', 48], ['processdate', '가공일자', 105], ['customname', '가공처', 150],
  ['warehousecodename', '창고', 120], ['detail_count', '상세건수', 86], ['qty', '수량', 90],
  ['weight', '중량(KG)', 100], ['supplyamt', '공급가', 115], ['vat', '부가세', 105],
  ['unitamt', '합계금액', 120], ['processno', '가공전표', 160],
  ['manager', '담당자', 100], ['description', '비고', 180],
  ['createdat', '등록일자', 145], ['updatedat', '수정일자', 145],
  ['created_by', '등록자', 90], ['updated_by', '수정자', 90],
].map(([key, label, width]) => ({ key, label, width, minWidth: Math.min(width, 68) }));

const makeDefaultFilters = () => {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const pad = (value) => String(value).padStart(2, '0');
  return {
    date_from: `${year}-${pad(month + 1)}-01`,
    date_to: `${year}-${pad(month + 1)}-${pad(new Date(year, month + 1, 0).getDate())}`,
    customer: '', warehouse: '', processno: '', iteminfo: '', processmethod: '',
  };
};
const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });
const displayNumber = (value, maximumFractionDigits = 3) => {
  if (value === null || value === undefined || value === '') return '';
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString(undefined, { maximumFractionDigits }) : value;
};
const displayDate = (value) => value ? String(value).slice(0, 10) : '';
const displayDateTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
};
const FILTERS = [
  { key: 'customer', label: '가공처', placeholder: '가공처명' },
  { key: 'warehouse', label: '창고', placeholder: '창고명' },
  { key: 'processno', label: '가공전표번호', placeholder: '전표번호' },
  { key: 'iteminfo', label: '품목정보', placeholder: '품목코드, 품명 또는 제품명' },
  { key: 'processmethod', label: '가공방법', placeholder: '가공방법' },
];

export default function ItemProcessSearch() {
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
  const requestIdRef = useRef(0);
  const tableWidth = COLUMNS.reduce((sum, column) => sum + (columnWidths[column.key] ?? column.width), 0);

  const resizeColumn = (event, column) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = columnWidths[column.key] ?? column.width;
    const table = event.currentTarget.closest('table');
    const col = [...(table?.querySelectorAll('col[data-column-key]') || [])]
      .find((element) => element.dataset.columnKey === column.key);
    let nextWidth = startWidth;
    let animationFrame = 0;
    const applyWidth = () => {
      const nextTableWidth = tableWidth + nextWidth - startWidth;
      if (col) col.style.width = `${nextWidth}px`;
      if (table) {
        table.style.width = `${nextTableWidth}px`;
        table.style.minWidth = `${nextTableWidth}px`;
      }
    };
    const move = (pointerEvent) => {
      nextWidth = Math.max(column.minWidth, Math.min(1600, startWidth + pointerEvent.clientX - startX));
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
      Object.entries(requestedFilters).forEach(([key, value]) => {
        if (String(value || '').trim()) params[key] = String(value).trim();
      });
      const { data } = await axios.get('/api/item-process-search/documents', { ...authConfig(), params });
      if (requestId !== requestIdRef.current) return;
      setItems(data.items || []);
      setTotal(data.total || 0);
      setSummary(data.summary || EMPTY_SUMMARY);
    } catch (error) {
      if (requestId === requestIdRef.current) {
        notifications.show({
          title: '가공현황 조회 실패',
          message: error.response?.data?.detail || '가공 내역을 불러오지 못했습니다.',
          color: 'red',
        });
      }
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

  const exportExcel = useCallback(async () => {
    if (!total || exporting || loading) return;
    setExporting(true);
    try {
      const params = Object.fromEntries(Object.entries(filters).filter(([, value]) => String(value || '').trim()));
      const { data } = await axios.get('/api/item-process-search/documents/export', {
        ...authConfig(), params, responseType: 'blob',
      });
      const downloadUrl = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `가공현황_${new Date().toISOString().slice(0, 10).replaceAll('-', '')}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    } catch {
      notifications.show({ title: '엑셀 다운로드 실패', message: '가공현황을 엑셀 파일로 다운로드하지 못했습니다.', color: 'red' });
    } finally {
      setExporting(false);
    }
  }, [total, exporting, loading, filters]);

  useEffect(() => {
    if (!registerPageRibbon) return undefined;
    registerPageRibbon(
      <Group className={classes.commandRibbon} justify="flex-start" wrap="nowrap" gap={2}>
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconSearch size={15} />} onClick={runSearch} loading={loading}>조회</Button>
        <span className={classes.ribbonSeparator} />
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconPlus size={15} />} disabled>추가</Button>
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconCopy size={15} />} disabled>복사</Button>
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconFileSpreadsheet size={15} />} onClick={exportExcel} loading={exporting} disabled={!total || loading}>엑셀</Button>
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconDeviceFloppy size={15} />} disabled>저장</Button>
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconTrash size={15} />} disabled>삭제</Button>
        <span className={classes.ribbonSeparator} />
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconX size={15} />} onClick={closeActivePage}>닫기</Button>
      </Group>,
    );
    return () => registerPageRibbon(null);
  }, [registerPageRibbon, closeActivePage, runSearch, loading, exportExcel, exporting, total]);

  const renderHeader = (column) => (
    <Table.Th key={column.key} style={{ width: columnWidths[column.key] ?? column.width }}>
      <span>{column.label}</span>
      <span className={classes.columnResizeHandle} role="separator" aria-label={`${column.label} 열 너비 조절`}
        onPointerDown={(event) => resizeColumn(event, column)} />
    </Table.Th>
  );
  const setFilter = (key, value) => setFilterInputs((current) => ({ ...current, [key]: value }));

  return (
    <Box className={`${sharedClasses.pageShell} ${classes.page}`}>
      <Box component="nav" aria-label="현재 위치" className={classes.pageBreadcrumb}>
        <Group gap={7}>
          <Text component="span" className={classes.breadcrumbParent}>가공 관리</Text>
          <Text component="span" className={classes.breadcrumbChevron}>›</Text>
          <Text component="span" className={classes.breadcrumbCurrent}>가공현황</Text>
        </Group>
        {!filterOpen && <Button className={classes.filterToggle} variant="subtle" size="xs" leftSection={<IconFilter size={15} />} onClick={() => setFilterOpen(true)}>조회조건</Button>}
      </Box>

      <Box className={classes.summaryGrid} aria-label="가공현황 요약">
        {[
          ['가공전표 수', `${displayNumber(summary.process_count, 0)}건`],
          ['상세건수', `${displayNumber(summary.detail_count, 0)}건`],
          ['총 가공수량', displayNumber(summary.total_qty)],
          ['총 가공중량', `${displayNumber(summary.total_weight)} KG`],
          ['총 가공금액', `${displayNumber(summary.total_amount, 0)} 원`],
        ].map(([label, value]) => <Paper className={classes.summaryCard} withBorder key={label}>
          <Text className={classes.summaryLabel}>{label}</Text><Text className={classes.summaryValue}>{value}</Text>
        </Paper>)}
      </Box>

      <Box className={classes.workspace}>
        <Paper className={`${sharedClasses.panel} ${classes.resultsPanel}`} withBorder>
          <Group className={classes.resultsToolbar} justify="space-between">
            <Group gap={8}><Text className={classes.sectionTitle} fw={700}>가공현황</Text><Badge color="gray" variant="light">{total.toLocaleString()}건</Badge></Group>
          </Group>
          <Box className={classes.tableWrap}>
            {loading && <Box className={classes.loadingOverlay}><Loader color="red" size="sm" /></Box>}
            {items.length ? <Box className={classes.tableScroller}>
              <Table className={classes.statusTable} withTableBorder withColumnBorders
                style={{ width: tableWidth, minWidth: tableWidth, tableLayout: 'fixed' }}>
                <colgroup>{COLUMNS.map((column) => <col key={column.key} data-column-key={column.key} style={{ width: `${columnWidths[column.key] ?? column.width}px` }} />)}</colgroup>
                <Table.Thead><Table.Tr>{COLUMNS.map(renderHeader)}</Table.Tr></Table.Thead>
                <Table.Tbody>{items.map((item, index) => <Table.Tr key={item.processno}>
                  <Table.Td ta="center">{(page - 1) * pageSize + index + 1}</Table.Td>
                  <Table.Td>{displayDate(item.processdate)}</Table.Td>
                  <Table.Td>{item.customname}</Table.Td><Table.Td>{item.warehousecodename}</Table.Td>
                  <Table.Td ta="right">{displayNumber(item.detail_count, 0)}</Table.Td>
                  <Table.Td ta="right">{displayNumber(item.qty)}</Table.Td>
                  <Table.Td ta="right">{displayNumber(item.weight)}</Table.Td>
                  <Table.Td ta="right">{displayNumber(item.supplyamt, 0)}</Table.Td>
                  <Table.Td ta="right">{displayNumber(item.vat, 0)}</Table.Td>
                  <Table.Td ta="right" fw={600}>{displayNumber(item.unitamt, 0)}</Table.Td>
                  <Table.Td>{item.processno}</Table.Td>
                  <Table.Td>{item.manager}</Table.Td><Table.Td>{item.description}</Table.Td>
                  <Table.Td>{displayDateTime(item.createdat)}</Table.Td><Table.Td>{displayDateTime(item.updatedat)}</Table.Td>
                  <Table.Td>{item.created_by || ''}</Table.Td><Table.Td>{item.updated_by || ''}</Table.Td>
                </Table.Tr>)}</Table.Tbody>
              </Table>
            </Box> : !loading && <Box className={classes.emptyState}>조회된 가공 내역이 없습니다.</Box>}
          </Box>
          <Group className={classes.paginationBar} justify="space-between" wrap="wrap">
            <Group gap="xs"><Text size="xs" c="dimmed">총 {total.toLocaleString()}건</Text>
              <Select aria-label="페이지당 표시 건수" data={PAGE_SIZE_OPTIONS} value={String(pageSize)} w={100} size="xs"
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
            <Box><Text size="xs" fw={700} mb={5}>가공기간</Text><Stack gap={6}>
              <ErpDateInput aria-label="가공 시작일" type="date" value={filterInputs.date_from} onChange={(event) => setFilter('date_from', event.currentTarget.value)} />
              <ErpDateInput aria-label="가공 종료일" type="date" value={filterInputs.date_to} onChange={(event) => setFilter('date_to', event.currentTarget.value)} />
            </Stack></Box>
            {FILTERS.map(({ key, label, placeholder }) => <TextInput key={key} label={label} placeholder={placeholder} value={filterInputs[key]}
              onChange={(event) => setFilter(key, event.currentTarget.value)} onKeyDown={(event) => event.key === 'Enter' && runSearch()} />)}
          </Stack>
        </Paper>}
      </Box>
    </Box>
  );
}
