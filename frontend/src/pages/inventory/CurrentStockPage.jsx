import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import usePageReactivated from '../../components/common/usePageReactivated';
import ErpDateInput from '../../components/common/ErpDateInput';
import { ActionIcon, Box, Group, Loader, Pagination, Paper, Select, Stack, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCalendar, IconPackages, IconX } from '@tabler/icons-react';
import ResizableVirtualTable from '../../components/common/ResizableVirtualTable';
import ErpBreadcrumb from '../../components/common/ErpBreadcrumb';
import useErpPageRibbon from '../../components/common/useErpPageRibbon';
import sharedClasses from '../../styles/pages/ManagementShared.module.css';
import simpleTheme from '../../styles/pages/SimpleTheme.module.css';
import classes from '../../styles/pages/InboundSearch.module.css';
import { cachedDateFormat } from '../../utils/dateFormat';

const PAGE_OPTIONS = [{ value: '15', label: '15개씩' }, { value: '50', label: '50개씩' }, { value: '100', label: '100개씩' }, { value: '200', label: '200개씩' }];
const createDefaultFilters = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const pad = (value) => String(value).padStart(2, '0');
  return {
    sourcetype: '', customname: '', item_search: '', product_search: '', warehouse_search: '', receipt_search: '',
    date_from: `${year}-${pad(month + 1)}-01`,
    date_to: `${year}-${pad(month + 1)}-${pad(new Date(year, month + 1, 0).getDate())}`,
  };
};
const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });
const numberText = (value) => value === null || value === undefined ? '' : Number(value).toLocaleString(undefined, { maximumFractionDigits: 3 });
const sourceName = (value) => value === 'OPENING' ? '기초' : value === 'INBOUND' ? '입고' : value === 'PROCESS' ? '가공' : '';
const timestampText = (value) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : cachedDateFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
};
// 칸 표시: 숫자 오른쪽 정렬, 글자는 넘치면 … + 마우스를 올리면 전체 표시
const num = (value) => <span className={classes.cellNum}>{value}</span>;
const center = (value) => <span className={classes.cellCenter}>{value}</span>;
const text = (value) => (value === '' || value === null || value === undefined ? '' : <span className={classes.cellText} title={String(value)}>{value}</span>);
const SOURCE_BADGE = { OPENING: classes.typeOpening, INBOUND: classes.typeInbound, PROCESS: classes.typeProcess };
const sourceBadge = (value) => {
  const name = sourceName(value);
  return name ? center(<span className={`${classes.typeBadge} ${SOURCE_BADGE[value] || ''}`}>{name}</span>) : '';
};
const periodText = (from, to) => (from || to ? `${from || '처음'} ~ ${to || '끝'}` : '전체 기간');
// 표 칸 정의는 화면 밖에 둔다 (매번 새로 만들면 표가 다시 그려진다)
const STOCK_COLUMNS = [
    { key: 'no', label: 'No.', width: 48, minWidth: 45, render: (_item, index) => center(index + 1) },
    { key: 'sourcetype', label: '재고구분', width: 70, minWidth: 60, render: (item) => sourceBadge(item.sourcetype) },
    { key: 'receiptdate', label: '입고일자', width: 100, minWidth: 90, render: (item) => center(item.receiptdate?.slice(0, 10) || '') },
    { key: 'customname', label: '거래처', width: 125, minWidth: 105, render: (item) => text(item.customname || '') },
    { key: 'sourceno', label: '원천전표', width: 160, minWidth: 140, render: (item) => text(item.sourceno || '') },
    { key: 'sourceline', label: '원천순번', width: 55, minWidth: 48, render: (item) => num(item.sourceline ?? '') },
    { key: 'warehousecodename', label: '창고명', width: 110, minWidth: 95, render: (item) => text(item.warehousecodename || '') },
    { key: 'itemname', label: '품명', width: 120, minWidth: 102, render: (item) => text(item.itemname || '') },
    { key: 'productname', label: '제품번호', width: 105, minWidth: 90, render: (item) => text(item.productname || '') },
    { key: 'materialname', label: '강종', width: 85, minWidth: 72, render: (item) => text(item.materialname || '') },
    { key: 'surfacename', label: '표면', width: 75, minWidth: 65, render: (item) => text(item.surfacename || '') },
    { key: 'myrtle', label: '도금량(g/㎡)', width: 100, minWidth: 90, render: (item) => num(numberText(item.myrtle)) },
    { key: 'manager', label: '담당자', width: 80, minWidth: 68, render: (item) => text(item.manager || '') },
    { key: 'thickness', label: '두께', width: 75, minWidth: 65, render: (item) => num(numberText(item.thickness)) },
    { key: 'width', label: '폭', width: 75, minWidth: 65, render: (item) => num(numberText(item.width)) },
    { key: 'length', label: '길이', width: 75, minWidth: 65, render: (item) => num(numberText(item.length)) },
    { key: 'originalqty', label: '최초수량', width: 80, minWidth: 68, render: (item) => num(numberText(item.originalqty)) },
    { key: 'qty', label: '현재수량', width: 80, minWidth: 68, render: (item) => num(numberText(item.qty)) },
    { key: 'originalweight', label: '최초중량(KG)', width: 100, minWidth: 88, render: (item) => num(numberText(item.originalweight)) },
    { key: 'weight', label: '현재중량', width: 90, minWidth: 78, render: (item) => num(numberText(item.weight)) },
    { key: 'unitprice', label: '매입단가', width: 90, minWidth: 78, render: (item) => num(numberText(item.unitprice)) },
    { key: 'qtyunit', label: '수량단위', width: 75, minWidth: 65, render: (item) => center(item.qtyunit || '') },
    { key: 'unit', label: '단가기준', width: 75, minWidth: 65, render: (item) => center(item.unit || '') },
    { key: 'created_at', label: '등록일자', width: 145, minWidth: 130, render: (item) => center(timestampText(item.created_at)) },
    { key: 'updated_at', label: '수정일자', width: 145, minWidth: 130, render: (item) => center(timestampText(item.updated_at)) },
    { key: 'created_by', label: '등록자', width: 90, minWidth: 70, render: (item) => text(item.created_by || '') },
    { key: 'updated_by', label: '수정자', width: 90, minWidth: 70, render: (item) => text(item.updated_by || '') },
  ];
const stockRowKey = (_index, item) => item.sourcetype ? `${item.sourcetype}:${item.sourceno}:${item.sourceline}` : `${item.itemcode}:${item.thickness}:${item.width}:${item.length}:${item.warehousecode}:${item.qtyunit}`;
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

  // 탭에 돌아오면 지금 조건 그대로 다시 불러온다 (다른 탭에서 데이터가 바뀌었을 수 있음)
  usePageReactivated(() => { void load(); });
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
      link.href = url; link.download = `현재고현황_${new Date().toISOString().slice(0, 10).replaceAll('-', '')}.xlsx`;
      document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { notifications.show({ title: '엑셀 다운로드 실패', message: '현재고를 엑셀로 저장하지 못했습니다.', color: 'red' }); }
    finally { setExporting(false); }
  };

  useErpPageRibbon({ onSearch: search, onExcel: exportExcel, showPrint: false, useSaveColor: false });

  return <Box className={`${simpleTheme.simple} ${sharedClasses.pageShell} ${classes.page}`}>
    <ErpBreadcrumb parent="재고관리" current="현재고현황" filterOpen={filterOpen} onOpenFilters={() => setFilterOpen(true)} />
    <Box className={classes.inboundWorkspace}>
    {filterOpen && <Paper component="aside" className={classes.filterSidebar} withBorder>
      <Group className={classes.filterHeader} justify="space-between">
        <Text fw={700}>조회조건</Text>
        <ActionIcon variant="subtle" color="gray" size="sm" aria-label="조회조건 닫기" onClick={() => setFilterOpen(false)}><IconX size={15} /></ActionIcon>
      </Group>
      <Stack className={classes.filterFields} gap="sm">
        <Select label="재고구분" data={[{ value: 'ALL', label: '전체' }, { value: 'OPENING', label: '기초' }, { value: 'INBOUND', label: '입고' }, { value: 'PROCESS', label: '가공' }]} value={inputs.sourcetype || 'ALL'} onChange={(value) => setInputs((current) => ({ ...current, sourcetype: value === 'ALL' ? '' : value || '' }))} />
        <Box>
          <Text className={classes.filterGroupLabel}>재고기간</Text>
          <Stack gap={6}>
            <ErpDateInput type="date" aria-label="재고기간 시작일" value={inputs.date_from} onChange={(event) => { const { value: nextValue } = event.currentTarget; setInputs((current) => ({ ...current, date_from: nextValue })); }} />
            <ErpDateInput type="date" aria-label="재고기간 종료일" value={inputs.date_to} onChange={(event) => { const { value: nextValue } = event.currentTarget; setInputs((current) => ({ ...current, date_to: nextValue })); }} />
          </Stack>
        </Box>
        <TextInput label="거래처명" placeholder="거래처명 검색" value={inputs.customname} onChange={(event) => { const { value: nextValue } = event.currentTarget; setInputs((current) => ({ ...current, customname: nextValue })); }} onKeyDown={(event) => event.key === 'Enter' && search()} />
        <TextInput label="품목" placeholder="품목코드 또는 품목명" value={inputs.item_search} onChange={(event) => { const { value: nextValue } = event.currentTarget; setInputs((current) => ({ ...current, item_search: nextValue })); }} onKeyDown={(event) => event.key === 'Enter' && search()} />
        <TextInput label="제품번호" placeholder="제품번호 검색" value={inputs.product_search} onChange={(event) => { const { value: nextValue } = event.currentTarget; setInputs((current) => ({ ...current, product_search: nextValue })); }} onKeyDown={(event) => event.key === 'Enter' && search()} />
        <TextInput label="창고" placeholder="창고코드 또는 창고명" value={inputs.warehouse_search} onChange={(event) => { const { value: nextValue } = event.currentTarget; setInputs((current) => ({ ...current, warehouse_search: nextValue })); }} onKeyDown={(event) => event.key === 'Enter' && search()} />
        <TextInput label="전표" placeholder="전표번호" value={inputs.receipt_search} onChange={(event) => { const { value: nextValue } = event.currentTarget; setInputs((current) => ({ ...current, receipt_search: nextValue })); }} onKeyDown={(event) => event.key === 'Enter' && search()} />
        <Select label="잔량 0 표시" data={[{ value: 'N', label: '제외' }, { value: 'Y', label: '포함' }]} value={includeZero ? 'Y' : 'N'} onChange={(value) => { setIncludeZero(value === 'Y'); setPage(1); }} />
      </Stack>
    </Paper>}
    <Paper className={`${sharedClasses.panel} ${classes.resultsPanel}`} withBorder>
      <Group className={classes.resultsToolbar} justify="space-between" wrap="wrap">
        <Box className={classes.toolbarTitle}>
          <Text className={classes.sectionTitle} fw={700}>현재고 내역</Text>
          <span className={classes.countBadge}>{total.toLocaleString()}건</span>
          <span className={classes.toolbarMeta} title="조회 기간 (재고기간)"><IconCalendar size={13} />{periodText(filters.date_from, filters.date_to)}{includeZero ? ' · 잔량 0 포함' : ''}</span>
        </Box>
      </Group>
      <Box className={classes.tableWrap}>
        {loading && <Box className={classes.loadingOverlay}><Loader color="red" size="sm" /></Box>}
        {items.length ? <ResizableVirtualTable data={items} computeItemKey={stockRowKey} rowOffset={(page - 1) * pageSize} minTableWidth={0} columns={STOCK_COLUMNS} /> : <Box className={classes.emptyState}>
          <span className={classes.emptyIcon}><IconPackages size={22} stroke={1.6} /></span>
          <span className={classes.emptyTitle}>조회된 현재고가 없습니다.</span>
          <span>재고기간이나 조회조건을 바꿔 다시 조회해 보세요.</span>
        </Box>}
      </Box>
      <Group className={classes.paginationBar} justify="space-between" wrap="wrap"><Group gap="xs"><Text size="xs" c="dimmed">총 {total.toLocaleString()}건</Text><Select size="xs" w={105} data={PAGE_OPTIONS} value={String(pageSize)} onChange={(value) => { setPageSize(Number(value)); setPage(1); }} /></Group><Pagination size="sm" color="red" value={page} onChange={setPage} total={Math.max(1, Math.ceil(total / pageSize))} withEdges /></Group>
    </Paper>
    </Box>
  </Box>;
}
