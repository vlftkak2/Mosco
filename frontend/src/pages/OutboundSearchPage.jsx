import { forwardRef, useCallback, useContext, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import {
  ActionIcon, Badge, Box, Button, Group, Loader, Pagination, Paper, Select, Stack,
  Table, Text, TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconCopy, IconDeviceFloppy, IconFileSpreadsheet, IconFilter, IconPlus,
  IconPrinter, IconSearch, IconTrash, IconX,
} from '@tabler/icons-react';
import { TableVirtuoso } from 'react-virtuoso';
import { PageRibbonContext } from '../components/layout/MainLayout';
import sharedClasses from '../styles/pages/ManagementShared.module.css';
import classes from '../styles/pages/InboundSearch.module.css';

const PAGE_SIZE_OPTIONS = [
  { value: '15', label: '15개씩' },
  { value: '50', label: '50개씩' },
  { value: '100', label: '100개씩' },
  { value: '200', label: '200개씩' },
];
const EMPTY_SUMMARY = { receipt_count: 0, total_qty: 0, detail_count: 0, total_weight: 0, total_amount: 0 };

const makeDefaultFilters = () => {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const pad = (value) => String(value).padStart(2, '0');
  return {
    date_from: `${year}-${pad(month + 1)}-01`,
    date_to: `${year}-${pad(month + 1)}-${pad(new Date(year, month + 1, 0).getDate())}`,
    receiptno: '', customcode: '', customname: '', itemcode: '', itemname: '',
  };
};

const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });
const HorizontalScroller = forwardRef(function HorizontalScroller({ style, ...props }, ref) {
  return <div {...props} ref={ref} className={classes.inboundSearchScroller} style={{ ...style, overflowX: 'auto' }} />;
});
const virtuosoComponents = {
  Scroller: HorizontalScroller,
  Table: ({ style, ...props }) => (
    <Table {...props} className={classes.statusTable} withTableBorder withColumnBorders highlightOnHover
      style={{ ...style, width: 'max(100%, 2500px)', minWidth: 2500, tableLayout: 'fixed' }} />
  ),
  TableHead: Table.Thead,
  TableBody: Table.Tbody,
  TableRow: Table.Tr,
};
const displayDate = (value) => value ? String(value).slice(0, 10) : '';
const displayDateTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
};
const displayNumber = (value, maximumFractionDigits = 3) => {
  if (value === null || value === undefined || value === '') return '';
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString(undefined, { maximumFractionDigits }) : value;
};

const FILTERS = [
  { key: 'receiptno', label: '출고전표번호', placeholder: '출고전표번호' },
  { key: 'customcode', label: '거래처코드', placeholder: '거래처코드' },
  { key: 'customname', label: '거래처명', placeholder: '거래처명' },
  { key: 'itemcode', label: '품목코드', placeholder: '품목코드' },
  { key: 'itemname', label: '품목명', placeholder: '품목명' },
];

export default function OutboundSearchPage() {
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
  const resizingColumnRef = useRef(null);

  const startColumnResize = (event, key, minWidth) => {
    event.preventDefault();
    event.stopPropagation();
    resizingColumnRef.current = {
      key,
      minWidth,
      startX: event.clientX,
      startWidth: event.currentTarget.parentElement.getBoundingClientRect().width,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveColumnResize = (event) => {
    const resizing = resizingColumnRef.current;
    if (!resizing) return;
    const width = Math.max(resizing.minWidth, resizing.startWidth + event.clientX - resizing.startX);
    setColumnWidths((current) => ({ ...current, [resizing.key]: width }));
  };

  const endColumnResize = () => {
    resizingColumnRef.current = null;
  };

  const renderHeader = (label, key, defaultWidth, minWidth = 80) => (
    <Table.Th key={key} style={{ width: columnWidths[key] || defaultWidth }}>
      {label}
      <span
        className={classes.columnResizeHandle}
        role="separator"
        aria-label={`${label} 열 너비 조절`}
        onPointerDown={(event) => startColumnResize(event, key, minWidth)}
        onPointerMove={moveColumnResize}
        onPointerUp={endColumnResize}
        onPointerCancel={endColumnResize}
      />
    </Table.Th>
  );

  const loadItems = useCallback(async (requestedPage, requestedFilters, requestedPageSize) => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const params = { page: requestedPage, page_size: requestedPageSize };
      Object.entries(requestedFilters).forEach(([key, value]) => {
        if (String(value || '').trim()) params[key] = String(value).trim();
      });
      const { data } = await axios.get('/api/outbound-search/details', { ...authConfig(), params });
      if (requestId !== requestIdRef.current) return;
      setItems(data.items || []);
      setTotal(data.total || 0);
      setSummary(data.summary || EMPTY_SUMMARY);
    } catch (error) {
      if (requestId === requestIdRef.current) {
        notifications.show({
          title: '출고현황 조회 실패',
          message: error.response?.data?.detail || '출고 내역을 불러오지 못했습니다.',
          color: 'red',
        });
      }
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

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

  const handleFilterKeyDown = useCallback((event) => {
    if (event.key === 'Enter') runSearch();
  }, [runSearch]);

  const exportExcel = useCallback(async () => {
    if (!total || exporting) return;
    setExporting(true);
    try {
      const params = Object.fromEntries(
        Object.entries(filters).filter(([, value]) => String(value || '').trim()),
      );
      const { data } = await axios.get('/api/outbound-search/details/export', {
        ...authConfig(),
        params,
        responseType: 'blob',
      });
      const downloadUrl = URL.createObjectURL(data);
      const link = document.createElement('a');
      const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
      link.href = downloadUrl;
      link.download = `출고현황_${date}.xlsx`;
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
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconFileSpreadsheet size={15} />} onClick={exportExcel} loading={exporting} disabled={!total || loading}>EXCEL</Button>
        <Button className={`${classes.ribbonTool} ${classes.ribbonSave}`} variant="subtle" size="sm" leftSection={<IconDeviceFloppy size={15} />} disabled>저장</Button>
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconTrash size={15} />} disabled>삭제</Button>
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconPrinter size={15} />} onClick={() => window.print()}>인쇄</Button>
        <span className={classes.ribbonSeparator} />
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconX size={15} />} onClick={closeActivePage}>닫기</Button>
      </Group>,
    );
    return () => registerPageRibbon(null);
  }, [registerPageRibbon, closeActivePage, runSearch, loading, exportExcel, exporting, total]);

  return (
    <Box className={`${sharedClasses.pageShell} ${classes.page}`}>
      <Box component="nav" aria-label="현재 위치" className={classes.pageBreadcrumb}>
        <Group className={classes.breadcrumbTrail} gap={7}>
          <Text component="span" className={classes.breadcrumbParent}>출고관리</Text>
          <Text component="span" className={classes.breadcrumbChevron}>›</Text>
          <Text component="span" className={classes.breadcrumbCurrent}>출고현황</Text>
        </Group>
        {!filterOpen && <Button className={classes.filterToggle} variant="subtle" size="xs" leftSection={<IconFilter size={15} />} onClick={() => setFilterOpen(true)}>조회조건</Button>}
      </Box>

      <Box className={classes.summaryGrid} aria-label="출고현황 요약">
        <Paper className={classes.summaryCard} withBorder>
          <Text className={classes.summaryLabel}>출고전표 수</Text>
          <Text className={classes.summaryValue}>{displayNumber(summary.receipt_count, 0)}건</Text>
        </Paper>
        <Paper className={classes.summaryCard} withBorder>
          <Text className={classes.summaryLabel}>총 출고수량</Text>
          <Text className={classes.summaryValue}>{displayNumber(summary.total_qty)}</Text>
        </Paper>
        <Paper className={classes.summaryCard} withBorder>
          <Text className={classes.summaryLabel}>총 출고중량</Text>
          <Text className={classes.summaryValue}>{displayNumber(summary.total_weight)} KG</Text>
        </Paper>
        <Paper className={classes.summaryCard} withBorder>
          <Text className={classes.summaryLabel}>총 출고금액</Text>
          <Text className={classes.summaryValue}>{displayNumber(summary.total_amount, 0)} 원</Text>
        </Paper>
      </Box>

      <Box className={classes.inboundWorkspace}>

      <Paper className={`${sharedClasses.panel} ${classes.resultsPanel}`} withBorder>
        <Group className={classes.resultsToolbar} justify="space-between" wrap="wrap">
          <Group gap={8}>
            <Text className={classes.sectionTitle} fw={700}>출고현황</Text>
            <Badge color="gray" variant="light">{total.toLocaleString()}건</Badge>
          </Group>
        </Group>

        <Box className={classes.tableWrap}>
          {loading && <Box className={classes.loadingOverlay}><Loader color="red" size="sm" /></Box>}
          {items.length ? (
            <TableVirtuoso
              data={items}
              style={{ height: '100%', width: '100%' }}
              components={virtuosoComponents}
              computeItemKey={(_index, item) => `${item.receiptno}:${item.lineno}`}
              defaultItemHeight={40}
              increaseViewportBy={{ top: 160, bottom: 320 }}
              fixedHeaderContent={() => (
                <Table.Tr>
                  <Table.Th>No.</Table.Th>
                  <Table.Th>출고일자</Table.Th>
                  {renderHeader('출고전표번호', 'receiptno', 175, 130)}
                  {renderHeader('거래처코드', 'customcode', 115, 90)}
                  {renderHeader('거래처명', 'customname', 170, 120)}
                  <Table.Th>품목코드</Table.Th>
                  <Table.Th>품목명</Table.Th>
                  <Table.Th>규격</Table.Th>
                  <Table.Th>수량</Table.Th>
                  <Table.Th>수량단위</Table.Th>
                  <Table.Th>창고코드</Table.Th>
                  <Table.Th>창고명</Table.Th>
                  <Table.Th>출고중량</Table.Th>
                  <Table.Th>단가기준</Table.Th>
                  <Table.Th>판매단가</Table.Th>
                  <Table.Th>출고금액</Table.Th>
                  <Table.Th>비고</Table.Th>
                  {renderHeader('상세 등록일자', 'created_at', 210, 150)}
                  {renderHeader('상세 수정일자', 'updated_at', 210, 150)}
                </Table.Tr>
              )}
              itemContent={(index, item) => (
                <>
                  <Table.Td ta="center">{(page - 1) * pageSize + index + 1}</Table.Td>
                  <Table.Td>{displayDate(item.receptdate)}</Table.Td><Table.Td>{item.receiptno}</Table.Td>
                  <Table.Td>{item.customcode}</Table.Td><Table.Td>{item.customname}</Table.Td>
                  <Table.Td>{item.itemcode}</Table.Td><Table.Td>{item.itemname}</Table.Td><Table.Td>{item.size}</Table.Td>
                  <Table.Td ta="right">{displayNumber(item.qty)}</Table.Td><Table.Td>{item.qtyunit}</Table.Td>
                  <Table.Td>{item.warehousecode}</Table.Td><Table.Td>{item.warehousecodename}</Table.Td>
                  <Table.Td ta="right">{displayNumber(item.weight)}</Table.Td><Table.Td>{item.unit}</Table.Td>
                  <Table.Td ta="right">{displayNumber(item.unitprice, 2)}</Table.Td><Table.Td ta="right">{displayNumber(item.unitamt, 2)}</Table.Td>
                  <Table.Td>{item.description}</Table.Td>
                  <Table.Td>{displayDateTime(item.created_at)}</Table.Td>
                  <Table.Td>{displayDateTime(item.updated_at)}</Table.Td>
                </>
              )}
            />
          ) : !loading && <Box className={classes.emptyState}>표시할 출고 상세 내역이 없습니다.</Box>}
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
            <Text size="xs" fw={700} mb={5}>출고기간</Text>
            <Stack gap={6}>
              <TextInput aria-label="출고 시작일" type="date" value={filterInputs.date_from}
                onChange={(event) => setFilterInputs((current) => ({ ...current, date_from: event.currentTarget.value }))}
                onKeyDown={handleFilterKeyDown} />
              <TextInput aria-label="출고 종료일" type="date" value={filterInputs.date_to}
                onChange={(event) => setFilterInputs((current) => ({ ...current, date_to: event.currentTarget.value }))}
                onKeyDown={handleFilterKeyDown} />
            </Stack>
          </Box>
          {FILTERS.map(({ key, label, placeholder }) => (
            <TextInput key={key} label={label} placeholder={`${placeholder} 검색`} value={filterInputs[key]}
              onChange={(event) => setFilterInputs((current) => ({ ...current, [key]: event.currentTarget.value }))}
              onKeyDown={handleFilterKeyDown} />
          ))}
        </Stack>
      </Paper>}
      </Box>
    </Box>
  );
}
