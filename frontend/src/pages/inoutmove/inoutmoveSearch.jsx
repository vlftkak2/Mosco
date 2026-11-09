import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import axios from 'axios';
import usePageReactivated from '../../components/common/usePageReactivated';
import ErpDateInput from '../../components/common/ErpDateInput';
import { ActionIcon, Box, Group, Loader, Pagination, Paper, Select, Stack, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconX } from '@tabler/icons-react';
import ResizableVirtualTable from '../../components/common/ResizableVirtualTable';
import ErpBreadcrumb from '../../components/common/ErpBreadcrumb';
import useErpPageRibbon from '../../components/common/useErpPageRibbon';
import sharedClasses from '../../styles/pages/ManagementShared.module.css';
import classes from '../../styles/pages/InboundSearch.module.css';

const PAGE_OPTIONS = ['15', '50', '100', '200'].map((value) => ({ value, label: `${value}개씩` }));
const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });
const numberText = (value) => value === null || value === undefined ? '' : Number(value).toLocaleString(undefined, { maximumFractionDigits: 3 });
// Same date-time format as 현재고현황.
const timestampText = (value) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
};
const sourceName = (value) => ({ OPENING: '기초', INBOUND: '입고', PROCESS: '가공', MOVE: '이동' }[value] || value || '');
const createDefaultFilters = () => {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return {
    date_from: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`,
    date_to: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate())}`,
    receiptno: '', fromwarehouse: '', towarehouse: '', iteminfo: '', productinfo: '',
  };
};

export default function InoutmoveSearch() {
  const [inputs, setInputs] = useState(createDefaultFilters);
  const [filters, setFilters] = useState(createDefaultFilters);
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [filterOpen, setFilterOpen] = useState(true);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const requestId = useRef(0);

  const load = useCallback(async (nextPage = page, nextFilters = filters, nextPageSize = pageSize) => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      const params = {
        page: nextPage,
        page_size: nextPageSize,
        ...Object.fromEntries(Object.entries(nextFilters).filter(([, value]) => value)),
      };
      const { data } = await axios.get('/api/inoutmove-search/details', { ...authConfig(), params });
      if (id !== requestId.current) return;
      setItems(data.items || []);
      setTotal(data.total || 0);
      setPage(nextPage);
    } catch (error) {
      if (id === requestId.current) {
        setItems([]);
        setTotal(0);
        notifications.show({ title: '재고이전현황 조회 실패', message: error.response?.data?.detail || '재고이전 내역을 조회하지 못했습니다.', color: 'red' });
      }
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [filters, page, pageSize]);

  const loadInitial = useEffectEvent(() => { void load(1, filters, pageSize); });
  // 탭에 돌아오면 지금 조건 그대로 다시 불러온다 (다른 탭에서 데이터가 바뀌었을 수 있음)
  usePageReactivated(() => { void load(page, filters, pageSize); });
  useEffect(() => { loadInitial(); }, []);

  const search = useCallback(() => {
    if (inputs.date_from && inputs.date_to && inputs.date_from > inputs.date_to) {
      notifications.show({ title: '조회조건 확인', message: '시작일은 종료일보다 늦을 수 없습니다.', color: 'orange' });
      return;
    }
    const nextFilters = Object.fromEntries(Object.entries(inputs).map(([key, value]) => [key, String(value || '').trim()]));
    setFilters(nextFilters);
    setPage(1);
    void load(1, nextFilters, pageSize);
  }, [inputs, load, pageSize]);

  const exportExcel = useCallback(async () => {
    if (!total || exporting) return;
    setExporting(true);
    try {
      const params = Object.fromEntries(Object.entries(filters).filter(([, value]) => value));
      const { data } = await axios.get('/api/inoutmove-search/details/export', { ...authConfig(), params, responseType: 'blob' });
      const url = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = url;
      // Local (KST) date: toISOString() is UTC and gave the previous day before 09:00.
      const now = new Date();
      link.download = `재고이동현황_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      notifications.show({ title: '엑셀 다운로드 실패', message: '조회 결과를 다운로드하지 못했습니다.', color: 'red' });
    } finally { setExporting(false); }
  }, [exporting, filters, total]);

  useErpPageRibbon({ onSearch: search, onExcel: exportExcel, showPrint: false, useSaveColor: false });

  const updateInput = (key, value) => setInputs((current) => ({ ...current, [key]: value }));
  const searchOnEnter = (event) => { if (event.key === 'Enter') search(); };

  return <Box className={`${sharedClasses.pageShell} ${classes.page}`}>
    <ErpBreadcrumb parent="재고관리" current="재고이동 현황" filterOpen={filterOpen} onOpenFilters={() => setFilterOpen(true)} />
    <Box className={classes.inboundWorkspace}>
      {filterOpen && <Paper component="aside" className={classes.filterSidebar} withBorder>
        <Group className={classes.filterHeader} justify="space-between">
          <Text fw={700}>조회조건</Text>
          <ActionIcon variant="subtle" color="gray" size="sm" aria-label="조회조건 닫기" onClick={() => setFilterOpen(false)}><IconX size={15} /></ActionIcon>
        </Group>
        <Stack className={classes.filterFields} gap="sm">
          <Box>
            <Text size="xs" fw={700} mb={5}>이전기간</Text>
            <Stack gap={6}>
              <ErpDateInput type="date" aria-label="이전기간 시작일" value={inputs.date_from} onChange={(event) => updateInput('date_from', event.currentTarget.value)} />
              <ErpDateInput type="date" aria-label="이전기간 종료일" value={inputs.date_to} onChange={(event) => updateInput('date_to', event.currentTarget.value)} />
            </Stack>
          </Box>
          {[
            ['receiptno', '재고이전전표', '전표번호'],
            ['fromwarehouse', '출고 창고', '창고코드 또는 창고명'],
            ['towarehouse', '입고 창고', '창고코드 또는 창고명'],
            ['iteminfo', '품목정보', '품목코드 또는 품명'],
            ['productinfo', '제품정보', '제품번호'],
          ].map(([key, label, placeholder]) => <TextInput key={key} label={label} placeholder={placeholder} value={inputs[key]} onChange={(event) => updateInput(key, event.currentTarget.value)} onKeyDown={searchOnEnter} />)}
        </Stack>
      </Paper>}

      <Paper className={`${sharedClasses.panel} ${classes.resultsPanel}`} withBorder>
        <Group className={classes.resultsToolbar} justify="space-between">
          <Text className={classes.sectionTitle} fw={700}>재고이전 내역</Text>
          <Text size="xs" c="dimmed">{total.toLocaleString()}건</Text>
        </Group>
        <Box className={classes.tableWrap}>
          {loading && <Box className={classes.loadingOverlay}><Loader color="red" size="sm" /></Box>}
          {items.length ? <ResizableVirtualTable
            data={items}
            computeItemKey={(_index, item) => `${item.receiptno}:${item.lineno}`}
            rowOffset={(page - 1) * pageSize}
            minTableWidth={0}
            columns={[
              { key: 'no', label: 'No.', width: 48, minWidth: 45, render: (_item, index) => index + 1 },
              { key: 'receptdate', label: '재고이전일자', width: 105, minWidth: 95, render: (item) => String(item.receptdate || '').slice(0, 10) },
              { key: 'fromwarehousename', label: '출고 창고', width: 120, minWidth: 100, render: (item) => item.fromwarehousename || '' },
              { key: 'towarehousename', label: '입고 창고', width: 120, minWidth: 100, render: (item) => item.towarehousename || '' },
              { key: 'itemname', label: '품명', width: 125, minWidth: 105, render: (item) => item.itemname || '' },
              { key: 'productname', label: '제품번호', width: 155, minWidth: 125, render: (item) => item.productname || '' },
              { key: 'materialname', label: '강종', width: 90, minWidth: 75, render: (item) => item.materialname || '' },
              { key: 'surfacename', label: '표면', width: 95, minWidth: 80, render: (item) => item.surfacename || '' },
              { key: 'thickness', label: '두께', width: 72, minWidth: 62, align: 'right', render: (item) => numberText(item.thickness) },
              { key: 'width', label: '폭', width: 72, minWidth: 62, align: 'right', render: (item) => numberText(item.width) },
              { key: 'length', label: '길이', width: 72, minWidth: 62, align: 'right', render: (item) => numberText(item.length) },
              { key: 'qty', label: '이전수량', width: 88, minWidth: 75, align: 'right', render: (item) => numberText(item.qty) },
              { key: 'qtyunit', label: '단위', width: 65, minWidth: 55, render: (item) => item.qtyunit || '' },
              { key: 'weight', label: '이전중량(KG)', width: 105, minWidth: 90, align: 'right', render: (item) => numberText(item.weight) },
              { key: 'customname', label: '매입처', width: 145, minWidth: 120, render: (item) => item.customname || '' },
              { key: 'stock_receiptdate', label: '재고입고일자', width: 110, minWidth: 95, render: (item) => String(item.stock_receiptdate || '').slice(0, 10) },
              { key: 'stocksourcetype', label: '재고구분', width: 75, minWidth: 65, render: (item) => sourceName(item.stocksourcetype) },
              { key: 'stocksourceno', label: '원천전표', width: 145, minWidth: 120, render: (item) => item.stocksourceno || '' },
              { key: 'stocksourceline', label: '원천순번', width: 78, minWidth: 65, align: 'right', render: (item) => item.stocksourceline ?? '' },
              { key: 'receiptno', label: '재고이전전표', width: 150, minWidth: 125, render: (item) => item.receiptno || '' },
              { key: 'manager', label: '담당자', width: 95, minWidth: 80, render: (item) => item.manager || '' },
              { key: 'description', label: '비고', width: 150, minWidth: 110, render: (item) => item.description || '' },
              { key: 'created_at', label: '등록일자', width: 145, minWidth: 130, render: (item) => timestampText(item.created_at) },
              { key: 'updated_at', label: '수정일자', width: 145, minWidth: 130, render: (item) => timestampText(item.updated_at) },
              { key: 'created_by', label: '등록자', width: 90, minWidth: 70, render: (item) => item.created_by || '' },
              { key: 'updated_by', label: '수정자', width: 90, minWidth: 70, render: (item) => item.updated_by || '' },
            ]}
          /> : <Box className={classes.emptyState}>{loading ? '조회 중입니다.' : '조회된 재고이전 내역이 없습니다.'}</Box>}
        </Box>
        <Group className={classes.paginationBar} justify="space-between" wrap="wrap">
          <Group gap="xs"><Text size="xs" c="dimmed">총 {total.toLocaleString()}건</Text><Select size="xs" w={105} data={PAGE_OPTIONS} value={String(pageSize)} onChange={(value) => { if (!value) return; const size = Number(value); setPageSize(size); setPage(1); void load(1, filters, size); }} /></Group>
          <Pagination size="sm" color="red" value={page} onChange={(value) => void load(value)} total={Math.max(1, Math.ceil(total / pageSize))} withEdges disabled={loading || !total} />
        </Group>
      </Paper>
    </Box>
  </Box>;
}
