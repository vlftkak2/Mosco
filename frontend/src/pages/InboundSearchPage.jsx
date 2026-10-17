import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import {
  Box, Button, Group, Loader, Pagination, Paper, Select,
  Table, Text, TextInput, Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconDownload, IconRefresh, IconSearch } from '@tabler/icons-react';
import { TableVirtuoso } from 'react-virtuoso';
import sharedClasses from '../styles/pages/ManagementShared.module.css';
import dashboardClasses from '../styles/pages/HomePage.module.css';
import classes from '../styles/pages/InboundSearch.module.css';

const PAGE_SIZE_OPTIONS = [
  { value: '15', label: '15개씩' },
  { value: '50', label: '50개씩' },
  { value: '100', label: '100개씩' },
  { value: '200', label: '200개씩' },
];

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
const virtuosoComponents = {
  Table: ({ style, ...props }) => (
    <Table {...props} className={classes.statusTable} withTableBorder withColumnBorders highlightOnHover
      style={{ ...style, width: '100%', tableLayout: 'fixed' }} />
  ),
  TableHead: Table.Thead,
  TableBody: Table.Tbody,
  TableRow: Table.Tr,
};
const displayDate = (value) => value ? String(value).slice(0, 10) : '';
const displayNumber = (value, maximumFractionDigits = 3) => {
  if (value === null || value === undefined || value === '') return '';
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString(undefined, { maximumFractionDigits }) : value;
};

const FILTERS = [
  { key: 'receiptno', label: '입고전표번호', placeholder: '입고전표번호' },
  { key: 'customcode', label: '거래처코드', placeholder: '거래처코드' },
  { key: 'customname', label: '거래처명', placeholder: '거래처명' },
  { key: 'itemcode', label: '품목코드', placeholder: '품목코드' },
  { key: 'itemname', label: '품목명', placeholder: '품목명' },
];

export default function InboundSearchPage() {
  const [filterInputs, setFilterInputs] = useState(makeDefaultFilters);
  const [filters, setFilters] = useState(makeDefaultFilters);
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
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
      const { data } = await axios.get('/api/inbound-search/details', { ...authConfig(), params });
      if (requestId !== requestIdRef.current) return;
      setItems(data.items || []);
      setTotal(data.total || 0);
    } catch (error) {
      if (requestId === requestIdRef.current) {
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

  useEffect(() => {
    void loadItems(page, filters, pageSize);
  }, [loadItems, page, filters, pageSize]);

  const runSearch = () => {
    if (filterInputs.date_from && filterInputs.date_to && filterInputs.date_from > filterInputs.date_to) {
      notifications.show({ title: '조회 조건 확인', message: '시작일은 종료일보다 뒤일 수 없습니다.', color: 'orange' });
      return;
    }
    setFilters(Object.fromEntries(Object.entries(filterInputs).map(([key, value]) => [key, String(value || '').trim()])));
    setPage(1);
  };

  const resetFilters = () => {
    const defaults = makeDefaultFilters();
    setFilterInputs(defaults);
    setFilters(defaults);
    setPage(1);
  };

  const handleFilterKeyDown = (event) => {
    if (event.key === 'Enter') runSearch();
  };

  const exportExcel = async () => {
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
      link.download = `입고현황_${date}.xlsx`;
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
  };

  return (
    <Box className={`${sharedClasses.pageShell} ${classes.page}`}>
      <Paper className={dashboardClasses.dashboardHeader}>
        <Box className={dashboardClasses.headerCopy}>
          <Text className={sharedClasses.breadcrumb}>매입 관리 <span>›</span> 입고현황</Text>
          <Title order={1} className={`${dashboardClasses.pageTitle} ${classes.pageTitle}`}>입고 현황 <span>조회</span></Title>
          <Text className={dashboardClasses.pageSubtitle}>회사별 입고전표와 품목 상세 내역을 조회합니다.</Text>
          <Group className={dashboardClasses.sampleNotice} gap={8}><span className={dashboardClasses.statusDot} /><Text size="xs">System Active</Text></Group>
        </Box>
      </Paper>

      <Paper className={`${sharedClasses.panel} ${classes.filterPanel}`} withBorder>
        <Group className={classes.filterGrid} align="end" gap="sm">
          {FILTERS.map(({ key, label, placeholder }) => (
            <TextInput key={key} label={label} placeholder={`${placeholder} 검색`} value={filterInputs[key]}
              onChange={(event) => setFilterInputs((current) => ({ ...current, [key]: event.currentTarget.value }))}
              onKeyDown={handleFilterKeyDown} />
          ))}
          <Box className={classes.dateFilterGroup}>
            <Box className={classes.dateFilterInputs}>
              <TextInput label={'입고 시작일'} type="date" value={filterInputs.date_from}
                onChange={(event) => setFilterInputs((current) => ({ ...current, date_from: event.currentTarget.value }))} />
              <Text className={classes.dateRangeSeparator}>~</Text>
              <TextInput label={'입고 종료일'} type="date" value={filterInputs.date_to}
                onChange={(event) => setFilterInputs((current) => ({ ...current, date_to: event.currentTarget.value }))} />
            </Box>
          </Box>
          <Group className={classes.filterActions} gap={8}>
            <Button variant="default" leftSection={<IconRefresh size={15} />} onClick={resetFilters} disabled={loading}>초기화</Button>
            <Button color="red" leftSection={<IconSearch size={15} />} onClick={runSearch} loading={loading}>조회</Button>
          </Group>
        </Group>
      </Paper>

      <Paper className={`${sharedClasses.panel} ${classes.resultsPanel}`} withBorder>
        <Group className={classes.resultsToolbar} justify="space-between" wrap="wrap">
          <Group gap={8}>
            <Text fw={700}>{'입고 상세 내역'}</Text>
          </Group>
          <Button size="xs" variant="light" color="red" leftSection={<IconDownload size={14} />} onClick={exportExcel} loading={exporting} disabled={!total || loading}>{'엑셀 다운로드'}</Button>
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
                  <Table.Th>입고일자</Table.Th>
                  {renderHeader('입고전표번호', 'receiptno', 175, 130)}
                  {renderHeader('거래처코드', 'customcode', 115, 90)}
                  {renderHeader('거래처명', 'customname', 170, 120)}
                  <Table.Th>품목코드</Table.Th>
                  <Table.Th>품목명</Table.Th>
                  <Table.Th>규격</Table.Th>
                  <Table.Th>수량</Table.Th>
                  <Table.Th>수량단위</Table.Th>
                  <Table.Th>창고코드</Table.Th>
                  <Table.Th>창고명</Table.Th>
                  <Table.Th>입고중량</Table.Th>
                  <Table.Th>단가기준</Table.Th>
                  <Table.Th>매입단가</Table.Th>
                  <Table.Th>금액</Table.Th>
                  <Table.Th>비고</Table.Th>
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
                </>
              )}
            />
          ) : !loading && <Box className={classes.emptyState}>표시할 입고 상세 내역이 없습니다.</Box>}
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
    </Box>
  );
}
