import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Box, Button, Group, Loader, Pagination, Paper, Select, Table, Text, TextInput, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconDownload, IconRefresh, IconSearch } from '@tabler/icons-react';
import { TableVirtuoso } from 'react-virtuoso';
import sharedClasses from '../styles/pages/ManagementShared.module.css';
import dashboardClasses from '../styles/pages/HomePage.module.css';
import classes from '../styles/pages/InboundSearch.module.css';

const monthFilters = () => { const now = new Date(); const y = now.getFullYear(); const m = now.getMonth(); const pad = (v) => String(v).padStart(2, '0'); return { date_from: `${y}-${pad(m + 1)}-01`, date_to: `${y}-${pad(m + 1)}-${pad(new Date(y, m + 1, 0).getDate())}`, iniotype: '', receiptno: '', itemcode: '', itemname: '', size: '', warehousecode: '', warehousecodename: '', qtyunit: '' }; };
const PAGE_OPTIONS = [{ value: '15', label: '15개씩' }, { value: '50', label: '50개씩' }, { value: '100', label: '100개씩' }, { value: '200', label: '200개씩' }];
const TYPE_OPTIONS = [{ value: '', label: '전체' }, { value: 'ST', label: '기초' }, { value: 'IN', label: '입고' }, { value: 'OUT', label: '출고' }];
const TYPE_NAMES = { ST: '기초', IN: '입고', OUT: '출고' };
const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });
const numberText = (value) => value === null || value === undefined ? '' : Number(value).toLocaleString(undefined, { maximumFractionDigits: 3 });
const timestampText = (value) => { if (!value) return ''; const d = new Date(value); return Number.isNaN(d.getTime()) ? String(value) : new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d); };
const components = { Table: ({ style, ...props }) => <Table {...props} className={classes.statusTable} withTableBorder withColumnBorders highlightOnHover style={{ ...style, width: '100%', minWidth: 1700, tableLayout: 'fixed' }} />, TableHead: Table.Thead, TableBody: Table.Tbody, TableRow: Table.Tr };

export default function IniopStockPage() {
  const [inputs, setInputs] = useState(monthFilters);
  const [filters, setFilters] = useState(monthFilters);
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const requestId = useRef(0);
  const load = useCallback(async () => { const id = ++requestId.current; setLoading(true); try { const params = { page, page_size: pageSize, ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value)) }; const { data } = await axios.get('/api/iniop-stock/items', { ...authConfig(), params }); if (id !== requestId.current) return; setItems(data.items || []); setTotal(data.total || 0); } catch (error) { if (id === requestId.current) notifications.show({ title: '수불장 조회 실패', message: error.response?.data?.detail || '수불 내역을 조회하지 못했습니다.', color: 'red' }); } finally { if (id === requestId.current) setLoading(false); } }, [page, pageSize, filters]);
  useEffect(() => { void load(); }, [load]);
  const search = () => { if (inputs.date_from && inputs.date_to && inputs.date_from > inputs.date_to) { notifications.show({ title: '조회 조건 확인', message: '수불 시작일은 종료일보다 뒤일 수 없습니다.', color: 'orange' }); return; } setFilters(Object.fromEntries(Object.entries(inputs).map(([key, value]) => [key, String(value || '').trim()]))); setPage(1); };
  const reset = () => { const defaults = monthFilters(); setInputs(defaults); setFilters(defaults); setPage(1); };
  const exportExcel = async () => { if (!total || exporting) return; setExporting(true); try { const params = Object.fromEntries(Object.entries(filters).filter(([, value]) => value)); const { data } = await axios.get('/api/iniop-stock/items/export', { ...authConfig(), params, responseType: 'blob' }); const url = URL.createObjectURL(data); const link = document.createElement('a'); link.href = url; link.download = `수불장_${new Date().toISOString().slice(0, 10).replaceAll('-', '')}.xlsx`; document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); } catch { notifications.show({ title: '엑셀 다운로드 실패', message: '수불장을 엑셀로 저장하지 못했습니다.', color: 'red' }); } finally { setExporting(false); } };
  const fields = [['receiptno', '수불전표'], ['itemcode', '품목코드'], ['itemname', '품목명'], ['size', '규격'], ['warehousecode', '창고코드'], ['warehousecodename', '창고명'], ['qtyunit', '수량단위']];

  return <Box className={`${sharedClasses.pageShell} ${classes.page}`}>
    <Paper className={dashboardClasses.dashboardHeader}><Box className={dashboardClasses.headerCopy}><Text className={sharedClasses.breadcrumb}>재고 관리 <span>›</span> 수불장</Text><Title order={1} className={`${dashboardClasses.pageTitle} ${classes.pageTitle}`}>수불장 <span>조회</span></Title><Text className={dashboardClasses.pageSubtitle}>기초·입고·출고의 회사별 재고 증감 내역을 조회합니다.</Text><Group className={dashboardClasses.sampleNotice} gap={8}><span className={dashboardClasses.statusDot} /><Text size="xs">Company Scoped</Text></Group></Box></Paper>
    <Paper className={`${sharedClasses.panel} ${classes.filterPanel}`} withBorder><Group className={classes.filterGrid} align="end" gap="sm">
      <Select label="수불유형" data={TYPE_OPTIONS} value={inputs.iniotype} onChange={(value) => setInputs((current) => ({ ...current, iniotype: value || '' }))} />
      {fields.map(([key, label]) => <TextInput key={key} label={label} placeholder={`${label} 검색`} value={inputs[key]} onChange={(event) => setInputs((current) => ({ ...current, [key]: event.currentTarget.value }))} onKeyDown={(event) => event.key === 'Enter' && search()} />)}
      <Box className={classes.dateFilterGroup}><Box className={classes.dateFilterInputs}><TextInput label="수불 시작일" type="date" value={inputs.date_from} onChange={(event) => setInputs((current) => ({ ...current, date_from: event.currentTarget.value }))} /><Text className={classes.dateRangeSeparator}>~</Text><TextInput label="수불 종료일" type="date" value={inputs.date_to} onChange={(event) => setInputs((current) => ({ ...current, date_to: event.currentTarget.value }))} /></Box></Box>
      <Group className={classes.filterActions} gap={8}><Button variant="default" leftSection={<IconRefresh size={15} />} onClick={reset}>초기화</Button><Button color="red" leftSection={<IconSearch size={15} />} onClick={search} loading={loading}>조회</Button></Group>
    </Group></Paper>
    <Paper className={`${sharedClasses.panel} ${classes.resultsPanel}`} withBorder><Group className={classes.resultsToolbar} justify="space-between"><Text fw={700}>수불 내역</Text><Button size="xs" variant="light" color="red" leftSection={<IconDownload size={14} />} onClick={exportExcel} loading={exporting} disabled={!total || loading}>엑셀 다운로드</Button></Group>
      <Box className={classes.tableWrap}>{loading && <Box className={classes.loadingOverlay}><Loader color="red" size="sm" /></Box>}{items.length ? <TableVirtuoso data={items} style={{ height: '100%', width: '100%' }} components={components} computeItemKey={(_index, item) => `${item.iniotype}:${item.receiptno}:${item.lineno}`} fixedHeaderContent={() => <Table.Tr><Table.Th>No.</Table.Th><Table.Th>수불일자</Table.Th><Table.Th>유형</Table.Th><Table.Th>수불전표</Table.Th><Table.Th>라인</Table.Th><Table.Th>품목코드</Table.Th><Table.Th>품목명</Table.Th><Table.Th>규격</Table.Th><Table.Th>수량</Table.Th><Table.Th>수량단위</Table.Th><Table.Th>중량</Table.Th><Table.Th>창고코드</Table.Th><Table.Th>창고명</Table.Th><Table.Th>등록일자</Table.Th><Table.Th>수정일자</Table.Th></Table.Tr>} itemContent={(index, item) => <><Table.Td>{(page - 1) * pageSize + index + 1}</Table.Td><Table.Td>{String(item.iniodate || '').slice(0, 10)}</Table.Td><Table.Td>{TYPE_NAMES[item.iniotype] || item.iniotype}</Table.Td><Table.Td>{item.receiptno}</Table.Td><Table.Td>{item.lineno}</Table.Td><Table.Td>{item.itemcode}</Table.Td><Table.Td>{item.itemname}</Table.Td><Table.Td>{item.size}</Table.Td><Table.Td>{numberText(item.qty)}</Table.Td><Table.Td>{item.qtyunit}</Table.Td><Table.Td>{numberText(item.weight)}</Table.Td><Table.Td>{item.warehousecode}</Table.Td><Table.Td>{item.warehousecodename}</Table.Td><Table.Td>{timestampText(item.created_at)}</Table.Td><Table.Td>{timestampText(item.updated_at)}</Table.Td></>} /> : <Box className={classes.emptyState}>조회된 수불 내역이 없습니다.</Box>}</Box>
      <Group className={classes.paginationBar} justify="space-between"><Text size="xs" c="dimmed">총 {total.toLocaleString()}건</Text><Group><Select size="xs" w={105} data={PAGE_OPTIONS} value={String(pageSize)} onChange={(value) => { setPageSize(Number(value)); setPage(1); }} /><Pagination size="sm" color="red" value={page} onChange={setPage} total={Math.max(1, Math.ceil(total / pageSize))} withEdges /></Group></Group>
    </Paper>
  </Box>;
}
