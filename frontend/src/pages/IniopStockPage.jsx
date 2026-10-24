import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { ActionIcon, Box, Button, Group, Loader, Pagination, Paper, Select, Stack, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconDownload, IconX } from '@tabler/icons-react';
import ResizableVirtualTable from '../components/common/ResizableVirtualTable';
import ErpBreadcrumb from '../components/common/ErpBreadcrumb';
import useErpPageRibbon from '../components/common/useErpPageRibbon';
import sharedClasses from '../styles/pages/ManagementShared.module.css';
import classes from '../styles/pages/InboundSearch.module.css';

const monthFilters = () => {
  const now = new Date(); const y = now.getFullYear(); const m = now.getMonth(); const pad = (v) => String(v).padStart(2, '0');
  return { date_from: `${y}-${pad(m + 1)}-01`, date_to: `${y}-${pad(m + 1)}-${pad(new Date(y, m + 1, 0).getDate())}`, iniotype: "", customname: "", item_search: "", warehouse_search: "" };
};
const PAGE_OPTIONS = [{ value: '15', label: '15개씩' }, { value: '50', label: '50개씩' }, { value: '100', label: '100개씩' }, { value: '200', label: '200개씩' }];
const TYPE_OPTIONS = [{ value: "ALL", label: "전체" }, { value: "ST", label: "기초" }, { value: "IN", label: "입고" }, { value: "OUT", label: "출고" }];
const TYPE_NAMES = { ST: "기초", IN: "입고", OUT: "출고" };
const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });
const numberText = (value) => value === null || value === undefined ? '' : Number(value).toLocaleString(undefined, { maximumFractionDigits: 3 });
const timestampText = (value) => { if (!value) return ''; const d = new Date(value); return Number.isNaN(d.getTime()) ? String(value) : new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d); };
export default function IniopStockPage() {
  const [inputs, setInputs] = useState(monthFilters);
  const [filters, setFilters] = useState(monthFilters);
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [filterOpen, setFilterOpen] = useState(true);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const requestId = useRef(0);
  const load = useCallback(async () => { const id = ++requestId.current; setLoading(true); try { const params = { page, page_size: pageSize, ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value)) }; const { data } = await axios.get('/api/iniop-stock/items', { ...authConfig(), params }); if (id !== requestId.current) return; setItems(data.items || []); setTotal(data.total || 0); } catch (error) { if (id === requestId.current) notifications.show({ title: '수불장 조회 실패', message: error.response?.data?.detail || '수불 내역을 조회하지 못했습니다.', color: 'red' }); } finally { if (id === requestId.current) setLoading(false); } }, [page, pageSize, filters]);
  useEffect(() => { void load(); }, [load]);
  const search = () => { if (inputs.date_from && inputs.date_to && inputs.date_from > inputs.date_to) { notifications.show({ title: "조회 조건 확인", message: "수불 시작일은 종료일보다 뒤일 수 없습니다.", color: "orange" }); return; } setFilters(Object.fromEntries(Object.entries(inputs).map(([key, value]) => [key, String(value || "").trim()]))); setPage(1); };
  const exportExcel = async () => { if (!total || exporting) return; setExporting(true); try { const params = Object.fromEntries(Object.entries(filters).filter(([, value]) => value)); const { data } = await axios.get('/api/iniop-stock/items/export', { ...authConfig(), params, responseType: 'blob' }); const url = URL.createObjectURL(data); const link = document.createElement('a'); link.href = url; link.download = `수불장_${new Date().toISOString().slice(0, 10).replaceAll('-', '')}.xlsx`; document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); } catch { notifications.show({ title: '엑셀 다운로드 실패', message: '수불장을 엑셀로 저장하지 못했습니다.', color: 'red' }); } finally { setExporting(false); } };
  const fields = [["customname", "거래처명"], ["item_search", "품목"], ["warehouse_search", "창고"]];

  useErpPageRibbon({ onSearch: search, onExcel: exportExcel, showPrint: false, useSaveColor: false });

  return <Box className={`${sharedClasses.pageShell} ${classes.page}`}>
    <ErpBreadcrumb parent="재고관리" current="재고수불현황" filterOpen={filterOpen} onOpenFilters={() => setFilterOpen(true)} />
    <Box className={classes.inboundWorkspace}>
    {filterOpen && <Paper component="aside" className={classes.filterSidebar} withBorder>
      <Group className={classes.filterHeader} justify="space-between" align="center">
        <Text fw={700}>조회조건</Text>
        <ActionIcon variant="subtle" color="gray" size="sm" aria-label="조회조건 닫기" onClick={() => setFilterOpen(false)}><IconX size={15} /></ActionIcon>
      </Group>
      <Stack className={classes.filterFields} gap="sm">
        <Select label="재고구분" data={TYPE_OPTIONS} value={inputs.iniotype || "ALL"} onChange={(value) => setInputs((current) => ({ ...current, iniotype: value === "ALL" ? "" : value || "" }))} />
        <Box>
          <Text size="xs" fw={700} mb={5}>재고기간</Text>
          <Stack gap={6}>
            <TextInput aria-label="재고기간 시작일" type="date" value={inputs.date_from} onChange={(event) => setInputs((current) => ({ ...current, date_from: event.currentTarget.value }))} onKeyDown={(event) => event.key === "Enter" && search()} />
            <TextInput aria-label="재고기간 종료일" type="date" value={inputs.date_to} onChange={(event) => setInputs((current) => ({ ...current, date_to: event.currentTarget.value }))} onKeyDown={(event) => event.key === "Enter" && search()} />
          </Stack>
        </Box>
        {fields.map(([key, label]) => <TextInput key={key} label={label} placeholder={key === "customname" ? "거래처명 검색" : key === "item_search" ? "품목코드 또는 품목명" : "창고코드 또는 창고명"} value={inputs[key] || ""} onChange={(event) => setInputs((current) => ({ ...current, [key]: event.currentTarget.value }))} onKeyDown={(event) => event.key === "Enter" && search()} />)}
      </Stack>
    </Paper>}
    <Paper className={`${sharedClasses.panel} ${classes.resultsPanel}`} withBorder><Group className={classes.resultsToolbar} justify="space-between"><Text fw={700}>재고수불현황</Text><Button size="xs" variant="light" color="red" leftSection={<IconDownload size={14} />} onClick={exportExcel} loading={exporting} disabled={!total || loading}>엑셀 다운로드</Button></Group>
      <Box className={classes.tableWrap}>{loading && <Box className={classes.loadingOverlay}><Loader color="red" size="sm" /></Box>}{items.length ? <ResizableVirtualTable data={items} computeItemKey={(_index, item) => `${item.iniotype}:${item.receiptno}:${item.lineno}`} rowOffset={(page - 1) * pageSize} minTableWidth={2400} columns={[
          { key: 'no', label: 'No.', width: 56, minWidth: 45, render: (_item, index) => index + 1 },
          { key: 'iniodate', label: '수불일자', width: 125, minWidth: 90, render: (item) => String(item.iniodate || '').slice(0, 10) },
          { key: 'iniotype', label: '유형', width: 90, minWidth: 65, render: (item) => TYPE_NAMES[item.iniotype] || item.iniotype },
          { key: 'receiptno', label: '수불전표', width: 270, minWidth: 165, render: (item) => item.receiptno },
          { key: 'customcode', label: '거래처코드', width: 140, minWidth: 90, render: (item) => item.customcode },
          { key: 'customname', label: '거래처명', width: 190, minWidth: 110, render: (item) => item.customname },
          { key: 'lineno', label: '라인', width: 75, minWidth: 55, render: (item) => item.lineno },
          { key: 'itemcode', label: '품목코드', width: 145, minWidth: 95, render: (item) => item.itemcode },
          { key: 'itemname', label: '품목명', width: 190, minWidth: 110, render: (item) => item.itemname },
          { key: 'productname', label: '\uC81C\uD488\uBC88\uD638', width: 130, minWidth: 90, render: (item) => item.productname || '' },
          { key: 'materialname', label: '강판', width: 130, minWidth: 90, render: (item) => item.materialname || '' },
          { key: 'surfacename', label: '표면', width: 120, minWidth: 85, render: (item) => item.surfacename || '' },
          { key: 'myrtle', label: '도금량(g/㎡)', width: 120, minWidth: 90, render: (item) => numberText(item.myrtle) },
          { key: 'manager', label: '담당자', width: 120, minWidth: 85, render: (item) => item.manager || '' },
          { key: 'thickness', label: '두께', width: 90, minWidth: 65, render: (item) => numberText(item.thickness) },
          { key: 'width', label: '폭', width: 90, minWidth: 65, render: (item) => numberText(item.width) },
          { key: 'length', label: '길이', width: 90, minWidth: 65, render: (item) => numberText(item.length) },
          { key: 'qty', label: '수량', width: 125, minWidth: 85, render: (item) => numberText(item.qty) },
          { key: 'qtyunit', label: '수량단위', width: 115, minWidth: 80, render: (item) => item.qtyunit },
          { key: 'weight', label: '중량', width: 125, minWidth: 85, render: (item) => numberText(item.weight) },
          { key: 'warehousecode', label: '창고코드', width: 140, minWidth: 95, render: (item) => item.warehousecode },
          { key: 'warehousecodename', label: '창고명', width: 175, minWidth: 100, render: (item) => item.warehousecodename },
          { key: 'created_at', label: '등록일자', width: 215, minWidth: 150, render: (item) => timestampText(item.created_at) },
          { key: 'updated_at', label: '수정일자', width: 215, minWidth: 150, render: (item) => timestampText(item.updated_at) },
        ]} /> : <Box className={classes.emptyState}>조회된 수불 내역이 없습니다.</Box>}</Box>
      <Group className={classes.paginationBar} justify="space-between" wrap="wrap"><Group gap="xs"><Text size="xs" c="dimmed">총 {total.toLocaleString()}건</Text><Select size="xs" w={105} data={PAGE_OPTIONS} value={String(pageSize)} onChange={(value) => { setPageSize(Number(value)); setPage(1); }} /></Group><Pagination size="sm" color="red" value={page} onChange={setPage} total={Math.max(1, Math.ceil(total / pageSize))} withEdges /></Group>
    </Paper>
    </Box>
  </Box>;
}
