import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import axios from 'axios';
import usePageReactivated from '../../components/common/usePageReactivated';
import ErpDateInput from '../../components/common/ErpDateInput';
import { ActionIcon, Box, Group, Loader, Pagination, Paper, Select, Stack, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconArrowsExchange, IconCalendar, IconX } from '@tabler/icons-react';
import ResizableVirtualTable from '../../components/common/ResizableVirtualTable';
import ErpBreadcrumb from '../../components/common/ErpBreadcrumb';
import useErpPageRibbon from '../../components/common/useErpPageRibbon';
import sharedClasses from '../../styles/pages/ManagementShared.module.css';
import simpleTheme from '../../styles/pages/SimpleTheme.module.css';
import classes from '../../styles/pages/InboundSearch.module.css';
import { cachedDateFormat } from '../../utils/dateFormat';

const PAGE_OPTIONS = ['15', '50', '100', '200'].map((value) => ({ value, label: `${value}개씩` }));
const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });
const numberText = (value) => value === null || value === undefined ? '' : Number(value).toLocaleString(undefined, { maximumFractionDigits: 3 });
// Same date-time format as 현재고현황.
const timestampText = (value) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : cachedDateFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
};
const sourceName = (value) => ({ OPENING: '기초', INBOUND: '입고', PROCESS: '가공', MOVE: '이동' }[value] || value || '');
// 칸 표시: 숫자 오른쪽 정렬, 글자는 넘치면 … + 마우스를 올리면 전체 표시
const num = (value) => <span className={classes.cellNum}>{value}</span>;
const center = (value) => <span className={classes.cellCenter}>{value}</span>;
const text = (value) => (value === '' || value === null || value === undefined ? '' : <span className={classes.cellText} title={String(value)}>{value}</span>);
const SOURCE_BADGE = { OPENING: classes.typeOpening, INBOUND: classes.typeInbound, PROCESS: classes.typeProcess, MOVE: classes.typeMove };
const sourceBadge = (value) => {
  const name = sourceName(value);
  return name ? center(<span className={`${classes.typeBadge} ${SOURCE_BADGE[value] || ''}`}>{name}</span>) : '';
};
const periodText = (from, to) => (from || to ? `${from || '처음'} ~ ${to || '끝'}` : '전체 기간');
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

  return <Box className={`${simpleTheme.simple} ${sharedClasses.pageShell} ${classes.page}`}>
    <ErpBreadcrumb parent="재고이동" current="재고이동현황" filterOpen={filterOpen} onOpenFilters={() => setFilterOpen(true)} />
    <Box className={classes.inboundWorkspace}>
      {filterOpen && <Paper component="aside" className={classes.filterSidebar} withBorder>
        <Group className={classes.filterHeader} justify="space-between">
          <Text fw={700}>조회조건</Text>
          <ActionIcon variant="subtle" color="gray" size="sm" aria-label="조회조건 닫기" onClick={() => setFilterOpen(false)}><IconX size={15} /></ActionIcon>
        </Group>
        <Stack className={classes.filterFields} gap="sm">
          <Box>
            <Text className={classes.filterGroupLabel}>이전기간</Text>
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
        <Group className={classes.resultsToolbar} justify="space-between" wrap="wrap">
          <Box className={classes.toolbarTitle}>
            <Text className={classes.sectionTitle} fw={700}>재고이전 내역</Text>
            <span className={classes.countBadge}>{total.toLocaleString()}건</span>
            <span className={classes.toolbarMeta} title="조회 기간 (재고이전일자)"><IconCalendar size={13} />{periodText(filters.date_from, filters.date_to)}</span>
          </Box>
        </Group>
        <Box className={classes.tableWrap}>
          {loading && <Box className={classes.loadingOverlay}><Loader color="red" size="sm" /></Box>}
          {items.length ? <ResizableVirtualTable
            data={items}
            computeItemKey={(_index, item) => `${item.receiptno}:${item.lineno}`}
            rowOffset={(page - 1) * pageSize}
            minTableWidth={0}
            columns={[
              { key: 'no', label: 'No.', width: 48, minWidth: 45, render: (_item, index) => center(index + 1) },
              { key: 'receptdate', label: '재고이전일자', width: 105, minWidth: 95, render: (item) => center(String(item.receptdate || '').slice(0, 10)) },
              { key: 'fromwarehousename', label: '출고 창고', width: 120, minWidth: 100, render: (item) => text(item.fromwarehousename || '') },
              { key: 'towarehousename', label: '입고 창고', width: 120, minWidth: 100, render: (item) => text(item.towarehousename || '') },
              { key: 'itemname', label: '품명', width: 125, minWidth: 105, render: (item) => text(item.itemname || '') },
              { key: 'productname', label: '제품번호', width: 155, minWidth: 125, render: (item) => text(item.productname || '') },
              { key: 'materialname', label: '강종', width: 90, minWidth: 75, render: (item) => text(item.materialname || '') },
              { key: 'surfacename', label: '표면', width: 95, minWidth: 80, render: (item) => text(item.surfacename || '') },
              { key: 'thickness', label: '두께', width: 72, minWidth: 62, align: 'right', render: (item) => num(numberText(item.thickness)) },
              { key: 'width', label: '폭', width: 72, minWidth: 62, align: 'right', render: (item) => num(numberText(item.width)) },
              { key: 'length', label: '길이', width: 72, minWidth: 62, align: 'right', render: (item) => num(numberText(item.length)) },
              { key: 'qty', label: '이전수량', width: 88, minWidth: 75, align: 'right', render: (item) => num(numberText(item.qty)) },
              { key: 'qtyunit', label: '단위', width: 65, minWidth: 55, render: (item) => center(item.qtyunit || '') },
              { key: 'weight', label: '이전중량(KG)', width: 105, minWidth: 90, align: 'right', render: (item) => num(numberText(item.weight)) },
              { key: 'customname', label: '매입처', width: 145, minWidth: 120, render: (item) => text(item.customname || '') },
              { key: 'stock_receiptdate', label: '재고입고일자', width: 110, minWidth: 95, render: (item) => center(String(item.stock_receiptdate || '').slice(0, 10)) },
              { key: 'stocksourcetype', label: '재고구분', width: 75, minWidth: 65, render: (item) => sourceBadge(item.stocksourcetype) },
              { key: 'stocksourceno', label: '원천전표', width: 160, minWidth: 140, render: (item) => text(item.stocksourceno || '') },
              { key: 'stocksourceline', label: '원천순번', width: 78, minWidth: 65, align: 'right', render: (item) => num(item.stocksourceline ?? '') },
              { key: 'receiptno', label: '재고이전전표', width: 160, minWidth: 140, render: (item) => text(item.receiptno || '') },
              { key: 'manager', label: '담당자', width: 95, minWidth: 80, render: (item) => text(item.manager || '') },
              { key: 'description', label: '비고', width: 150, minWidth: 110, render: (item) => text(item.description || '') },
              { key: 'created_at', label: '등록일자', width: 145, minWidth: 130, render: (item) => center(timestampText(item.created_at)) },
              { key: 'updated_at', label: '수정일자', width: 145, minWidth: 130, render: (item) => center(timestampText(item.updated_at)) },
              { key: 'created_by', label: '등록자', width: 90, minWidth: 70, render: (item) => text(item.created_by || '') },
              { key: 'updated_by', label: '수정자', width: 90, minWidth: 70, render: (item) => text(item.updated_by || '') },
            ]}
          /> : <Box className={classes.emptyState}>
            <span className={classes.emptyIcon}><IconArrowsExchange size={22} stroke={1.6} /></span>
            <span className={classes.emptyTitle}>{loading ? '조회 중입니다.' : '조회된 재고이전 내역이 없습니다.'}</span>
            {!loading && <span>이전기간이나 조회조건을 바꿔 다시 조회해 보세요.</span>}
          </Box>}
        </Box>
        <Group className={classes.paginationBar} justify="space-between" wrap="wrap">
          <Group gap="xs"><Text size="xs" c="dimmed">총 {total.toLocaleString()}건</Text><Select size="xs" w={105} data={PAGE_OPTIONS} value={String(pageSize)} onChange={(value) => { if (!value) return; const size = Number(value); setPageSize(size); setPage(1); void load(1, filters, size); }} /></Group>
          <Pagination size="sm" color="red" value={page} onChange={(value) => void load(value)} total={Math.max(1, Math.ceil(total / pageSize))} withEdges disabled={loading || !total} />
        </Group>
      </Paper>
    </Box>
  </Box>;
}
