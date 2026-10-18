import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Box, Button, Group, Loader, Pagination, Paper, Select, Table, Text, TextInput, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconDownload, IconRefresh, IconSearch } from '@tabler/icons-react';
import { TableVirtuoso } from 'react-virtuoso';
import sharedClasses from '../styles/pages/ManagementShared.module.css';
import dashboardClasses from '../styles/pages/HomePage.module.css';
import classes from '../styles/pages/InboundSearch.module.css';

const PAGE_OPTIONS = [{ value: '15', label: '15개씩' }, { value: '50', label: '50개씩' }, { value: '100', label: '100개씩' }, { value: '200', label: '200개씩' }];
const EMPTY_FILTERS = { itemcode: '', itemname: '', size: '', warehousecode: '', warehousecodename: '', qtyunit: '' };
const FILTERS = [
  ['itemcode', '품목코드'], ['itemname', '품목명'], ['size', '규격'],
  ['warehousecode', '창고코드'], ['warehousecodename', '창고명'], ['qtyunit', '수량단위'],
];
const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });
const numberText = (value) => value === null || value === undefined ? '' : Number(value).toLocaleString(undefined, { maximumFractionDigits: 3 });
const timestampText = (value) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
};
const components = {
  Table: ({ style, ...props }) => <Table {...props} className={classes.statusTable} withTableBorder withColumnBorders highlightOnHover style={{ ...style, width: '100%', minWidth: 1320, tableLayout: 'fixed' }} />,
  TableHead: Table.Thead, TableBody: Table.Tbody, TableRow: Table.Tr,
};

export default function CurrentStockPage() {
  const [inputs, setInputs] = useState(EMPTY_FILTERS);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      const params = { page, page_size: pageSize, ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value)) };
      const { data } = await axios.get('/api/current-stock/items', { ...authConfig(), params });
      if (id !== requestId.current) return;
      setItems(data.items || []);
      setTotal(data.total || 0);
    } catch (error) {
      if (id === requestId.current) notifications.show({ title: '현재고 조회 실패', message: error.response?.data?.detail || '현재고를 조회하지 못했습니다.', color: 'red' });
    } finally { if (id === requestId.current) setLoading(false); }
  }, [page, pageSize, filters]);

  useEffect(() => { void load(); }, [load]);
  const search = () => { setFilters(Object.fromEntries(Object.entries(inputs).map(([key, value]) => [key, value.trim()]))); setPage(1); };
  const reset = () => { setInputs(EMPTY_FILTERS); setFilters(EMPTY_FILTERS); setPage(1); };
  const exportExcel = async () => {
    if (!total || exporting) return;
    setExporting(true);
    try {
      const params = Object.fromEntries(Object.entries(filters).filter(([, value]) => value));
      const { data } = await axios.get('/api/current-stock/items/export', { ...authConfig(), params, responseType: 'blob' });
      const url = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = url; link.download = `현재고_${new Date().toISOString().slice(0, 10).replaceAll('-', '')}.xlsx`;
      document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { notifications.show({ title: '엑셀 다운로드 실패', message: '현재고를 엑셀로 저장하지 못했습니다.', color: 'red' }); }
    finally { setExporting(false); }
  };

  return <Box className={`${sharedClasses.pageShell} ${classes.page}`}>
    <Paper className={dashboardClasses.dashboardHeader}><Box className={dashboardClasses.headerCopy}>
      <Text className={sharedClasses.breadcrumb}>재고 관리 <span>›</span> 현재고</Text>
      <Title order={1} className={`${dashboardClasses.pageTitle} ${classes.pageTitle}`}>현재고 <span>조회</span></Title>
      <Text className={dashboardClasses.pageSubtitle}>회사별 품목·규격·창고·수량단위 기준의 현재 재고를 조회합니다.</Text>
      <Group className={dashboardClasses.sampleNotice} gap={8}><span className={dashboardClasses.statusDot} /><Text size="xs">Company Scoped</Text></Group>
    </Box></Paper>
    <Paper className={`${sharedClasses.panel} ${classes.filterPanel}`} withBorder>
      <Group className={classes.filterGrid} align="end" gap="sm">
        {FILTERS.map(([key, label]) => <TextInput key={key} label={label} placeholder={`${label} 검색`} value={inputs[key]} onChange={(event) => setInputs((current) => ({ ...current, [key]: event.currentTarget.value }))} onKeyDown={(event) => event.key === 'Enter' && search()} />)}
        <Group className={classes.filterActions} gap={8}><Button variant="default" leftSection={<IconRefresh size={15} />} onClick={reset}>초기화</Button><Button color="red" leftSection={<IconSearch size={15} />} onClick={search} loading={loading}>조회</Button></Group>
      </Group>
    </Paper>
    <Paper className={`${sharedClasses.panel} ${classes.resultsPanel}`} withBorder>
      <Group className={classes.resultsToolbar} justify="space-between"><Text fw={700}>현재고 내역</Text><Button size="xs" variant="light" color="red" leftSection={<IconDownload size={14} />} onClick={exportExcel} loading={exporting} disabled={!total || loading}>엑셀 다운로드</Button></Group>
      <Box className={classes.tableWrap}>
        {loading && <Box className={classes.loadingOverlay}><Loader color="red" size="sm" /></Box>}
        {items.length ? <TableVirtuoso data={items} style={{ height: '100%', width: '100%' }} components={components} computeItemKey={(_index, item) => `${item.itemcode}:${item.size}:${item.warehousecode}:${item.qtyunit}`} fixedHeaderContent={() => <Table.Tr><Table.Th>No.</Table.Th><Table.Th>품목코드</Table.Th><Table.Th>품목명</Table.Th><Table.Th>규격</Table.Th><Table.Th>현재수량</Table.Th><Table.Th>수량단위</Table.Th><Table.Th>현재중량</Table.Th><Table.Th>창고코드</Table.Th><Table.Th>창고명</Table.Th><Table.Th>등록일자</Table.Th><Table.Th>수정일자</Table.Th></Table.Tr>} itemContent={(index, item) => <><Table.Td>{(page - 1) * pageSize + index + 1}</Table.Td><Table.Td>{item.itemcode}</Table.Td><Table.Td>{item.itemname}</Table.Td><Table.Td>{item.size}</Table.Td><Table.Td>{numberText(item.qty)}</Table.Td><Table.Td>{item.qtyunit}</Table.Td><Table.Td>{numberText(item.weight)}</Table.Td><Table.Td>{item.warehousecode}</Table.Td><Table.Td>{item.warehousecodename}</Table.Td><Table.Td>{timestampText(item.created_at)}</Table.Td><Table.Td>{timestampText(item.updated_at)}</Table.Td></>} /> : <Box className={classes.emptyState}>조회된 현재고가 없습니다.</Box>}
      </Box>
      <Group className={classes.paginationBar} justify="space-between"><Text size="xs" c="dimmed">총 {total.toLocaleString()}건</Text><Group><Select size="xs" w={105} data={PAGE_OPTIONS} value={String(pageSize)} onChange={(value) => { setPageSize(Number(value)); setPage(1); }} /><Pagination size="sm" color="red" value={page} onChange={setPage} total={Math.max(1, Math.ceil(total / pageSize))} withEdges /></Group></Group>
    </Paper>
  </Box>;
}
