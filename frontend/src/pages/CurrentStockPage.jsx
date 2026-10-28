import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { ActionIcon, Box, Group, Loader, Pagination, Paper, Select, Stack, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconX } from '@tabler/icons-react';
import ResizableVirtualTable from '../components/common/ResizableVirtualTable';
import ErpBreadcrumb from '../components/common/ErpBreadcrumb';
import useErpPageRibbon from '../components/common/useErpPageRibbon';
import sharedClasses from '../styles/pages/ManagementShared.module.css';
import classes from '../styles/pages/InboundSearch.module.css';

const PAGE_OPTIONS = [{ value: '15', label: '15개씩' }, { value: '50', label: '50개씩' }, { value: '100', label: '100개씩' }, { value: '200', label: '200개씩' }];
const createDefaultFilters = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const pad = (value) => String(value).padStart(2, '0');
  return {
    sourcetype: '', customname: '', item_search: '', product_search: '', warehouse_search: '',
    date_from: `${year}-${pad(month + 1)}-01`,
    date_to: `${year}-${pad(month + 1)}-${pad(new Date(year, month + 1, 0).getDate())}`,
  };
};
const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });
const numberText = (value) => value === null || value === undefined ? '' : Number(value).toLocaleString(undefined, { maximumFractionDigits: 3 });
const sourceName = (value) => value === 'OPENING' ? '기초' : value === 'INBOUND' ? '입고' : '';
const timestampText = (value) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
};
export default function CurrentStockPage() {
  const [inputs, setInputs] = useState(createDefaultFilters);
  const [filters, setFilters] = useState(createDefaultFilters);
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [includeZero, setIncludeZero] = useState(false);
  const [filterOpen, setFilterOpen] = useState(true);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      const params = { page, page_size: pageSize, include_zero: includeZero, ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value)) };
      const { data } = await axios.get('/api/current-stock/items', { ...authConfig(), params });
      if (id !== requestId.current) return;
      setItems(data.items || []);
      setTotal(data.total || 0);
    } catch (error) {
      if (id === requestId.current) notifications.show({ title: '현재고 조회 실패', message: error.response?.data?.detail || '현재고를 조회하지 못했습니다.', color: 'red' });
    } finally { if (id === requestId.current) setLoading(false); }
  }, [page, pageSize, filters, includeZero]);

  useEffect(() => { void load(); }, [load]);
  const search = () => { setFilters(Object.fromEntries(Object.entries(inputs).map(([key, value]) => [key, value.trim()]))); setPage(1); };
  const exportExcel = async () => {
    if (!total || exporting) return;
    setExporting(true);
    try {
      const params = { include_zero: includeZero, ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value)) };
      const { data } = await axios.get('/api/current-stock/items/export', { ...authConfig(), params, responseType: 'blob' });
      const url = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = url; link.download = `현재고_${new Date().toISOString().slice(0, 10).replaceAll('-', '')}.xlsx`;
      document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { notifications.show({ title: '엑셀 다운로드 실패', message: '현재고를 엑셀로 저장하지 못했습니다.', color: 'red' }); }
    finally { setExporting(false); }
  };

  useErpPageRibbon({ onSearch: search, onExcel: exportExcel, showPrint: false, useSaveColor: false });

  return <Box className={`${sharedClasses.pageShell} ${classes.page}`}>
    <ErpBreadcrumb parent="재고관리" current="현재고현황" filterOpen={filterOpen} onOpenFilters={() => setFilterOpen(true)} />
    <Box className={classes.inboundWorkspace}>
    {filterOpen && <Paper component="aside" className={classes.filterSidebar} withBorder>
      <Group className={classes.filterHeader} justify="space-between">
        <Text fw={700}>조회조건</Text>
        <ActionIcon variant="subtle" color="gray" size="sm" aria-label="조회조건 닫기" onClick={() => setFilterOpen(false)}><IconX size={15} /></ActionIcon>
      </Group>
      <Stack className={classes.filterFields} gap="sm">
        <Select label="재고구분" data={[{ value: 'ALL', label: '전체' }, { value: 'OPENING', label: '기초' }, { value: 'INBOUND', label: '입고' }]} value={inputs.sourcetype || 'ALL'} onChange={(value) => setInputs((current) => ({ ...current, sourcetype: value === 'ALL' ? '' : value || '' }))} />
        <Box>
          <Text size="xs" fw={700} mb={5}>재고기간</Text>
          <Stack gap={6}>
            <TextInput type="date" aria-label="재고기간 시작일" value={inputs.date_from} onChange={(event) => setInputs((current) => ({ ...current, date_from: event.currentTarget.value }))} onKeyDown={(event) => event.key === 'Enter' && search()} />
            <TextInput type="date" aria-label="재고기간 종료일" value={inputs.date_to} onChange={(event) => setInputs((current) => ({ ...current, date_to: event.currentTarget.value }))} onKeyDown={(event) => event.key === 'Enter' && search()} />
          </Stack>
        </Box>
        <TextInput label="거래처명" placeholder="거래처명 검색" value={inputs.customname} onChange={(event) => setInputs((current) => ({ ...current, customname: event.currentTarget.value }))} onKeyDown={(event) => event.key === 'Enter' && search()} />
        <TextInput label="품목" placeholder="품목코드 또는 품목명" value={inputs.item_search} onChange={(event) => setInputs((current) => ({ ...current, item_search: event.currentTarget.value }))} onKeyDown={(event) => event.key === 'Enter' && search()} />
        <TextInput label="제품번호" placeholder="제품번호 검색" value={inputs.product_search} onChange={(event) => setInputs((current) => ({ ...current, product_search: event.currentTarget.value }))} onKeyDown={(event) => event.key === 'Enter' && search()} />
        <TextInput label="창고" placeholder="창고코드 또는 창고명" value={inputs.warehouse_search} onChange={(event) => setInputs((current) => ({ ...current, warehouse_search: event.currentTarget.value }))} onKeyDown={(event) => event.key === 'Enter' && search()} />
        <Select label="잔량 0 표시" data={[{ value: 'N', label: '제외' }, { value: 'Y', label: '포함' }]} value={includeZero ? 'Y' : 'N'} onChange={(value) => { setIncludeZero(value === 'Y'); setPage(1); }} />
      </Stack>
    </Paper>}
    <Paper className={`${sharedClasses.panel} ${classes.resultsPanel}`} withBorder>
      <Group className={classes.resultsToolbar} justify="space-between"><Text fw={700}>현재고 내역</Text></Group>
      <Box className={classes.tableWrap}>
        {loading && <Box className={classes.loadingOverlay}><Loader color="red" size="sm" /></Box>}
        {items.length ? <ResizableVirtualTable data={items} computeItemKey={(_index, item) => item.sourcetype ? `${item.sourcetype}:${item.sourceno}:${item.sourceline}` : `${item.itemcode}:${item.thickness}:${item.width}:${item.length}:${item.warehousecode}:${item.qtyunit}`} rowOffset={(page - 1) * pageSize} minTableWidth={0} columns={[
          { key: 'no', label: 'No.', width: 48, minWidth: 45, render: (_item, index) => index + 1 },
          { key: 'sourcetype', label: '재고구분', width: 70, minWidth: 60, render: (item) => sourceName(item.sourcetype) },
          { key: 'receiptdate', label: '입고일자', width: 100, minWidth: 90, render: (item) => item.receiptdate?.slice(0, 10) || '' },
          { key: 'customname', label: '거래처', width: 125, minWidth: 105, render: (item) => item.customname || '' },
          { key: 'sourceno', label: '원천전표', width: 140, minWidth: 120, render: (item) => item.sourceno || '' },
          { key: 'sourceline', label: '원천순번', width: 55, minWidth: 48, render: (item) => item.sourceline ?? '' },
          { key: 'warehousecodename', label: '창고명', width: 110, minWidth: 95, render: (item) => item.warehousecodename || '' },
          { key: 'itemname', label: '품명', width: 120, minWidth: 102, render: (item) => item.itemname || '' },
          { key: 'productname', label: '제품번호', width: 105, minWidth: 90, render: (item) => item.productname || '' },
          { key: 'materialname', label: '강종', width: 85, minWidth: 72, render: (item) => item.materialname || '' },
          { key: 'surfacename', label: '표면', width: 75, minWidth: 65, render: (item) => item.surfacename || '' },
          { key: 'myrtle', label: '도금량(g/㎡)', width: 100, minWidth: 90, render: (item) => numberText(item.myrtle) },
          { key: 'manager', label: '담당자', width: 80, minWidth: 68, render: (item) => item.manager || '' },
          { key: 'thickness', label: '두께', width: 75, minWidth: 65, render: (item) => numberText(item.thickness) },
          { key: 'width', label: '폭', width: 75, minWidth: 65, render: (item) => numberText(item.width) },
          { key: 'length', label: '길이', width: 75, minWidth: 65, render: (item) => numberText(item.length) },
          { key: 'originalqty', label: '최초수량', width: 80, minWidth: 68, render: (item) => numberText(item.originalqty) },
          { key: 'qty', label: '현재수량', width: 80, minWidth: 68, render: (item) => numberText(item.qty) },
          { key: 'originalweight', label: '최초중량(KG)', width: 100, minWidth: 88, render: (item) => numberText(item.originalweight) },
          { key: 'weight', label: '현재중량', width: 90, minWidth: 78, render: (item) => numberText(item.weight) },
          { key: 'unitprice', label: '매입단가', width: 90, minWidth: 78, render: (item) => numberText(item.unitprice) },
          { key: 'qtyunit', label: '수량단위', width: 75, minWidth: 65, render: (item) => item.qtyunit || '' },
          { key: 'unit', label: '단가기준', width: 75, minWidth: 65, render: (item) => item.unit || '' },
          { key: 'created_at', label: '등록일자', width: 145, minWidth: 130, render: (item) => timestampText(item.created_at) },
          { key: 'updated_at', label: '수정일자', width: 145, minWidth: 130, render: (item) => timestampText(item.updated_at) },
        ]} /> : <Box className={classes.emptyState}>조회된 현재고가 없습니다.</Box>}
      </Box>
      <Group className={classes.paginationBar} justify="space-between" wrap="wrap"><Group gap="xs"><Text size="xs" c="dimmed">총 {total.toLocaleString()}건</Text><Select size="xs" w={105} data={PAGE_OPTIONS} value={String(pageSize)} onChange={(value) => { setPageSize(Number(value)); setPage(1); }} /></Group><Pagination size="sm" color="red" value={page} onChange={setPage} total={Math.max(1, Math.ceil(total / pageSize))} withEdges /></Group>
    </Paper>
    </Box>
  </Box>;
}
