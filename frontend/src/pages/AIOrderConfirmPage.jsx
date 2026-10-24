import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { useSearchParams } from 'react-router-dom';
import { Badge, Box, Button, Group, Loader, Modal, Pagination, Paper, ScrollArea, Select, SimpleGrid, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconRefresh, IconTrash } from '@tabler/icons-react';
import sharedClasses from '../styles/pages/ManagementShared.module.css';
import useErpPageRibbon from '../components/common/useErpPageRibbon';
import ErpBreadcrumb from '../components/common/ErpBreadcrumb';
import dashboardClasses from '../styles/pages/HomePage.module.css';
import classes from '../styles/pages/AIOrderConfirm.module.css';

const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });
const dateText = (value) => value ? String(value).slice(0, 10) : '—';
const numberText = (value) => value === null || value === undefined ? '—' : Number(value).toLocaleString('ko-KR');
const LIST_COLUMNS = [
  { key: 'orderid', label: '확정번호', width: 155 },
  { key: 'buyer', label: '발주처', width: 120 },
  { key: 'recipient', label: '수신처', width: 105 },
  { key: 'orderdate', label: '발주일', width: 90 },
  { key: 'duedate', label: '납기일', width: 90 },
  { key: 'deliverylocation', label: '납품장소', width: 170 },
  { key: 'item_count', label: '품목 수', width: 65 },
  { key: 'username', label: '확정 사용자', width: 105 },
  { key: 'created_at', label: '확정일시', width: 145 },
];
const DETAIL_COLUMNS = [
  { key: 'lineno', label: '순번', width: 65 },
  { key: 'itemname', label: '품명', width: 145 },
  { key: 'steelgrade', label: '강종', width: 100 },
  { key: 'size', label: '규격 원문', width: 165 },
  { key: 'thickness', label: '두께', width: 90 },
  { key: 'width', label: '폭', width: 90 },
  { key: 'length', label: '길이', width: 90 },
  { key: 'quantity', label: '수량', width: 100 },
  { key: 'quantity_unit', label: '단위', width: 85 },
  { key: 'weight_kg', label: '중량(KG)', width: 110 },
  { key: 'notes', label: '비고', width: 180 },
  { key: 'stock', label: '재고', width: 105 },
];
export default function AIOrderConfirmPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialOrderId = searchParams.get('orderid') || '';
  const [filters, setFilters] = useState({ start_date: '', end_date: '', buyer: '', orderid: '' });
  const [applied, setApplied] = useState({ start_date: '', end_date: '', buyer: '', orderid: initialOrderId });
  const [page, setPage] = useState(1);
  const [list, setList] = useState({ items: [], total: 0 });
  const [selectedId, setSelectedId] = useState(initialOrderId);
  const [order, setOrder] = useState(null);
  const [selectedLine, setSelectedLine] = useState(null);
  const [candidates, setCandidates] = useState(null);
  const [matchError, setMatchError] = useState('');
  const [loadingList, setLoadingList] = useState(false);
  const [loadingMatch, setLoadingMatch] = useState(false);
  const listRequestRef = useRef(0);
  const matchRequestRef = useRef(0);
  const resizeCleanupRef = useRef(null);
  const [cancelTarget, setCancelTarget] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [detailPage, setDetailPage] = useState(1);
  const [detailPageSize, setDetailPageSize] = useState(10);
  const [detailColumnWidths, setDetailColumnWidths] = useState({});
  const [listColumnWidths, setListColumnWidths] = useState({});
  const filteredDetails = useMemo(() => order?.items || [], [order]);
  const visibleDetails = useMemo(() => filteredDetails.slice((detailPage - 1) * detailPageSize, detailPage * detailPageSize), [filteredDetails, detailPage, detailPageSize]);
  const detailTableWidth = DETAIL_COLUMNS.reduce((total, column) => total + (detailColumnWidths[column.key] ?? column.width), 0);
  const listTableWidth = LIST_COLUMNS.reduce((total, column) => total + (listColumnWidths[column.key] ?? column.width), 0);
  const matchedLine = order?.items?.find((line) => line.lineno === selectedLine);

  useEffect(() => () => resizeCleanupRef.current?.(), []);

  const resizeColumn = (event, column, widths, setWidths) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = widths[column.key] ?? column.width;
    const move = (pointerEvent) => setWidths((current) => ({ ...current, [column.key]: Math.max(65, Math.min(700, startWidth + pointerEvent.clientX - startX)) }));
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  };

  const resizeListColumn = (event, column) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    resizeCleanupRef.current?.();
    const table = event.currentTarget.closest('table');
    if (!table) return;
    const headers = Array.from(table.querySelectorAll('thead th'));
    const cols = Array.from(table.querySelectorAll('colgroup col'));
    const widths = Object.fromEntries(LIST_COLUMNS.map((item, index) => [item.key, Math.round(headers[index]?.getBoundingClientRect().width || item.width)]));
    const columnIndex = LIST_COLUMNS.findIndex((item) => item.key === column.key);
    const startWidth = widths[column.key];
    const startX = event.clientX;
    const pointerId = event.pointerId;
    const totalWidth = Object.values(widths).reduce((sum, width) => sum + width, 0);
    let nextWidth = startWidth;
    cols.forEach((col, index) => { col.style.width = `${widths[LIST_COLUMNS[index].key]}px`; });
    table.style.minWidth = '0';
    table.style.width = `${totalWidth}px`;
    const move = (pointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) return;
      nextWidth = Math.max(70, Math.min(700, startWidth + pointerEvent.clientX - startX));
      cols[columnIndex].style.width = `${nextWidth}px`;
      headers[columnIndex].style.width = `${nextWidth}px`;
      table.style.width = `${totalWidth + nextWidth - startWidth}px`;
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      resizeCleanupRef.current = null;
    };
    const stop = (pointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) return;
      cleanup();
      setListColumnWidths({ ...widths, [column.key]: nextWidth });
    };
    resizeCleanupRef.current = cleanup;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  };

  const loadList = useCallback(async () => {
    const requestId = ++listRequestRef.current;
    setLoadingList(true);
    try {
      const params = Object.fromEntries(Object.entries(applied).filter(([, value]) => value));
      const { data } = await axios.get('/api/ai-order/confirmed', { ...authConfig(), params: { ...params, page, page_size: 30 } });
      if (requestId !== listRequestRef.current) return;
      setList(data);
      setSelectedId((current) => data.items.some((row) => row.orderid === current) ? current : (data.items[0]?.orderid || ''));
    } catch (error) {
      if (requestId === listRequestRef.current) notifications.show({ title: '확정 주문 조회 실패', message: error.response?.data?.detail || '다시 조회해주세요.', color: 'red' });
    } finally {
      if (requestId === listRequestRef.current) setLoadingList(false);
    }
  }, [applied, page]);

  const submitSearch = (event) => {
    event.preventDefault();
    if (filters.start_date && filters.end_date && filters.start_date > filters.end_date) {
      notifications.show({ title: '발주일자 확인', message: '시작일은 종료일보다 늦을 수 없습니다.', color: 'orange' });
      return;
    }
    setPage(1);
    setSelectedId('');
    setApplied({ ...filters, buyer: filters.buyer.trim(), orderid: filters.orderid.trim() });
    if (searchParams.has('orderid')) setSearchParams({}, { replace: true });
  };

  useEffect(() => { void loadList(); }, [loadList, refreshKey]);
  useEffect(() => {
    if (!selectedId) { setOrder(null); return; }
    let active = true;
    matchRequestRef.current += 1;
    setOrder(null); setSelectedLine(null); setCandidates(null); setMatchError('');
    axios.get(`/api/ai-order/confirmed/${encodeURIComponent(selectedId)}`, authConfig())
      .then(({ data }) => { if (active) setOrder(data); })
      .catch((error) => { if (active) notifications.show({ title: '주문 상세 조회 실패', message: error.response?.data?.detail || '다시 선택해주세요.', color: 'red' }); });
    return () => { active = false; };
  }, [selectedId]);
  useEffect(() => { setDetailPage(1); }, [selectedId]);

  const matchStock = async (line) => {
    const requestId = ++matchRequestRef.current;
    setSelectedLine(line.lineno); setCandidates(null); setMatchError(''); setLoadingMatch(true);
    try {
      const { data } = await axios.get(`/api/ai-order/confirmed/${encodeURIComponent(selectedId)}/items/${line.lineno}/stock-candidates`, authConfig());
      if (requestId === matchRequestRef.current) setCandidates(data);
    } catch (error) {
      if (requestId === matchRequestRef.current) setMatchError(error.response?.data?.detail || '재고 후보를 조회하지 못했습니다. 다시 조회해주세요.');
    } finally {
      if (requestId === matchRequestRef.current) setLoadingMatch(false);
    }
  };

  const closeMatch = () => {
    matchRequestRef.current += 1;
    setSelectedLine(null); setCandidates(null); setMatchError(''); setLoadingMatch(false);
  };

  const cancelConfirmation = async () => {
    if (!cancelTarget || cancelling) return;
    setCancelling(true);
    try {
      const cancelledId = cancelTarget;
      await axios.delete(`/api/ai-order/confirmed/${encodeURIComponent(cancelledId)}`, authConfig());
      notifications.show({ title: '주문확정 취소 완료', message: `${cancelledId} 주문과 상세 내역을 삭제했습니다.`, color: 'teal' });
      setCancelTarget('');
      if (selectedId === cancelledId) {
        setSelectedId(''); setOrder(null); setSelectedLine(null); setCandidates(null);
      }
      if (searchParams.get('orderid') === cancelledId) setSearchParams({});
      setFilters((current) => current.orderid === cancelledId ? { ...current, orderid: '' } : current);
      setApplied((current) => current.orderid === cancelledId ? { ...current, orderid: '' } : current);
      setPage(1);
      setRefreshKey((current) => current + 1);
    } catch (error) {
      notifications.show({ title: '주문확정 취소 실패', message: error.response?.data?.detail || '다시 시도해주세요.', color: 'red' });
    } finally { setCancelling(false); }
  };

  useErpPageRibbon({
    onSearch: () => submitSearch({ preventDefault() {} }),
    onDelete: () => selectedId && list.items.some((row) => row.orderid === selectedId) && setCancelTarget(selectedId),
    onPrint: () => window.print(),
  });

  return <Box className={`${sharedClasses.pageShell} ${classes.page}`}>
    <ErpBreadcrumb parent="가공관리" current="주문서 확정" />

    <Paper withBorder className={`${sharedClasses.panel} ${classes.searchPanel}`}>
      <Box component="form" onSubmit={submitSearch}>
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="sm">
          <TextInput label="발주일 시작" type="date" value={filters.start_date} onChange={(event) => { const value = event.currentTarget.value; setFilters((current) => ({ ...current, start_date: value })); }} />
          <TextInput label="발주일 종료" type="date" value={filters.end_date} onChange={(event) => { const value = event.currentTarget.value; setFilters((current) => ({ ...current, end_date: value })); }} />
          <TextInput label="발주처" placeholder="발주처 검색" value={filters.buyer} onChange={(event) => { const value = event.currentTarget.value; setFilters((current) => ({ ...current, buyer: value })); }} />
          <TextInput label="확정 주문번호" placeholder="확정번호 검색" value={filters.orderid} onChange={(event) => { const value = event.currentTarget.value; setFilters((current) => ({ ...current, orderid: value })); }} />
        </SimpleGrid>
        <Group justify="flex-end" mt="sm"><Button color="red" type="submit" loading={loadingList}>조회</Button></Group>
      </Box>
    </Paper>

    <Paper withBorder className={`${sharedClasses.panel} ${classes.listPanel}`}>
      <Group justify="space-between" mb="sm" gap="sm"><Group gap="xs"><Text fw={700}>주문서 확정 목록</Text><Badge variant="light" color="gray">{numberText(list.total)}건</Badge>{loadingList && <Loader size="xs" />}</Group><Group gap="sm">{selectedId && <Text size="xs" c="dimmed">선택: {selectedId}</Text>}<Button size="sm" color="red" leftSection={<IconTrash size={16} />} disabled={!selectedId || !list.items.some((row) => row.orderid === selectedId)} onClick={() => setCancelTarget(selectedId)}>주문확정 취소</Button></Group></Group>
      <ScrollArea type="auto" scrollbarSize={7}>
        <Table striped highlightOnHover className={`${classes.table} ${classes.resizableTable}`} style={{ width: `max(100%, ${listTableWidth}px)` }}>
          <colgroup>{LIST_COLUMNS.map((column) => <col key={column.key} style={{ width: listColumnWidths[column.key] ?? column.width }} />)}</colgroup>
          <Table.Thead><Table.Tr>{LIST_COLUMNS.map((column) => <Table.Th key={column.key} className={classes.resizableHeader} style={{ width: listColumnWidths[column.key] ?? column.width }}>{column.label}<span className={classes.resizeHandle} onPointerDown={(event) => resizeListColumn(event, column)} role="separator" aria-label={`${column.label} 열 너비 조절`} /></Table.Th>)}</Table.Tr></Table.Thead>
          <Table.Tbody>{list.items.map((row) => <Table.Tr key={row.orderid} onClick={() => setSelectedId(row.orderid)} className={selectedId === row.orderid ? classes.selected : ''}>
            <Table.Td>{row.orderid}</Table.Td><Table.Td>{row.buyer || '—'}</Table.Td><Table.Td>{row.recipient || '—'}</Table.Td><Table.Td>{dateText(row.orderdate)}</Table.Td><Table.Td>{dateText(row.duedate)}</Table.Td><Table.Td>{row.deliverylocation || '—'}</Table.Td><Table.Td>{numberText(row.item_count)}</Table.Td><Table.Td>{row.username || row.useremail}</Table.Td><Table.Td>{row.created_at ? new Date(row.created_at).toLocaleString('ko-KR') : '—'}</Table.Td>
          </Table.Tr>)}</Table.Tbody>
        </Table>
      </ScrollArea>
      {!list.items.length && !loadingList && <Text ta="center" c="dimmed" p="lg">조회된 확정 주문이 없습니다.</Text>}
      {list.total > 30 && <Group justify="flex-end" mt="sm"><Pagination total={Math.ceil(list.total / 30)} value={page} onChange={setPage} size="sm" /></Group>}
    </Paper>

    <Paper withBorder className={`${sharedClasses.panel} ${classes.detailPanel}`}>
      <Group className={classes.detailToolbar} justify="space-between" gap="sm" wrap="wrap">
        <Group gap="xs"><Text fw={700}>주문 상세</Text>{order?.header?.orderid && <Badge variant="light" color="blue">{order.header.orderid}</Badge>}</Group>
        {order?.header && <Text className={classes.deliverySummary} size="xs" c="dimmed" lineClamp={1}>납품 장소: {order.header.deliverylocation || '미기재'}</Text>}
      </Group>
      <Box className={classes.detailTableWrap}>
        {!order ? <Box className={classes.detailEmpty}>확정 주문을 선택하면 상세 품목이 표시됩니다.</Box>
          : !filteredDetails.length ? <Box className={classes.detailEmpty}>상세 품목이 없습니다.</Box>
            : <ScrollArea className={classes.detailScroll} type="auto" scrollbarSize={7}>
              <Table highlightOnHover className={`${classes.table} ${classes.detailTable}`} style={{ width: `max(100%, ${detailTableWidth}px)` }}>
                <colgroup>{DETAIL_COLUMNS.map((column) => <col key={column.key} style={{ width: detailColumnWidths[column.key] ?? column.width }} />)}</colgroup>
                <Table.Thead><Table.Tr>{DETAIL_COLUMNS.map((column) => <Table.Th key={column.key} className={classes.resizableHeader} style={{ width: detailColumnWidths[column.key] ?? column.width }}>{column.label}<span className={classes.resizeHandle} onPointerDown={(event) => resizeColumn(event, column, detailColumnWidths, setDetailColumnWidths)} role="separator" aria-label={`${column.label} 열 너비 조절`} /></Table.Th>)}</Table.Tr></Table.Thead>
                <Table.Tbody>{visibleDetails.map((line) => <Table.Tr key={line.lineno} className={selectedLine === line.lineno ? classes.selected : ''}>
                  <Table.Td ta="center">{line.lineno}</Table.Td><Table.Td>{line.itemname || '—'}</Table.Td><Table.Td>{line.steelgrade || '—'}</Table.Td><Table.Td>{line.size || '—'}</Table.Td><Table.Td ta="right">{numberText(line.thickness)}</Table.Td><Table.Td ta="right">{numberText(line.width)}</Table.Td><Table.Td ta="right">{numberText(line.length)}</Table.Td><Table.Td ta="right">{line.quantity === null ? (line.quantity_raw || '—') : numberText(line.quantity)}</Table.Td><Table.Td>{line.quantity_unit || '—'}</Table.Td><Table.Td ta="right">{line.weight_kg === null ? (line.weight_raw || '—') : numberText(line.weight_kg)}</Table.Td><Table.Td>{line.notes || '—'}</Table.Td><Table.Td ta="center"><Button size="xs" variant="light" color="red" onClick={() => void matchStock(line)}>재고매칭</Button></Table.Td>
                </Table.Tr>)}</Table.Tbody>
              </Table>
            </ScrollArea>}
      </Box>
      <Group className={classes.detailPagination} justify="space-between" gap="sm" wrap="wrap">
        <Group gap="xs"><Text size="xs" c="dimmed">총 {filteredDetails.length.toLocaleString()}행</Text><Select size="xs" w={100} aria-label="상세 품목 페이지 행 수" value={String(detailPageSize)} data={['10', '20', '50', '100'].map((value) => ({ value, label: `${value}개씩` }))} onChange={(value) => { setDetailPageSize(Number(value || 10)); setDetailPage(1); }} disabled={!order} /></Group>
        <Pagination size="sm" color="red" withEdges total={Math.max(1, Math.ceil(filteredDetails.length / detailPageSize))} value={detailPage} onChange={setDetailPage} disabled={!filteredDetails.length} />
      </Group>
    </Paper>

    <Modal
      opened={selectedLine !== null}
      onClose={closeMatch}
      title={<Group gap="xs"><Text fw={700}>현재 재고 및 가공 검토 후보</Text>{selectedLine !== null && <Badge variant="light" color="red">{selectedLine}번 품목</Badge>}</Group>}
      size={1120}
      centered
      radius="md"
      overlayProps={{ backgroundOpacity: 0.5, blur: 2 }}
      classNames={{ content: classes.matchModal, body: classes.matchModalBody }}
    >
      <Stack gap="md">
        <Box className={classes.matchSummary}>
          <Text size="xs" c="dimmed" fw={700}>확정 주문 품목</Text>
          <Text fw={700} size="md" mt={4}>{matchedLine?.itemname || '품명 미기재'}</Text>
          <Text size="sm" c="dimmed" mt={3}>강종 {matchedLine?.steelgrade || '—'} · 규격 {matchedLine?.size || '—'} · 수량 {matchedLine?.quantity === null ? (matchedLine?.quantity_raw || '—') : numberText(matchedLine?.quantity)} {matchedLine?.quantity_unit || ''}</Text>
        </Box>
        <Group justify="space-between" align="center" gap="sm" wrap="wrap">
          <Group gap="xs">
            <Text size="sm" fw={700}>재고 후보</Text>
            {candidates && <Badge variant="light" color="gray">{numberText(candidates.total_candidates)}건</Badge>}
            {candidates && [
              { priority: 1, label: '동일 규격', color: 'teal' },
              { priority: 2, label: '가공 검토', color: 'blue' },
              { priority: 3, label: '대체 검토', color: 'gray' },
            ].map(({ priority, label, color }) => <Badge key={priority} variant="light" color={color}>{label} {candidates.candidates.filter((row) => row.priority === priority).length}</Badge>)}
          </Group>
          {matchedLine && <Button size="xs" variant="default" leftSection={<IconRefresh size={15} />} onClick={() => void matchStock(matchedLine)} loading={loadingMatch}>다시 조회</Button>}
        </Group>
        {loadingMatch ? <Stack align="center" gap="xs" py="xl"><Loader color="red" /><Text size="sm" c="dimmed">현재고에서 후보를 조회하고 있습니다.</Text></Stack>
          : matchError ? <Text className={classes.matchEmpty} c="red">{matchError}</Text>
            : candidates?.candidates.length ? <ScrollArea className={classes.matchScroll} type="auto" scrollbarSize={7}>
              <Table striped highlightOnHover className={`${classes.table} ${classes.matchTable}`} miw={980}>
                <Table.Thead><Table.Tr>{['우선순위', '판단 근거', '품목코드', '품명', '재고 규격', '재고수량', '단위', '창고'].map((label) => <Table.Th key={label}>{label}</Table.Th>)}</Table.Tr></Table.Thead>
                <Table.Tbody>{candidates.candidates.map((row, index) => <Table.Tr key={`${row.itemcode}-${row.warehousecode}-${index}`}><Table.Td><Badge variant="light" color={row.priority === 1 ? 'teal' : row.priority === 2 ? 'blue' : 'gray'}>{row.category}</Badge></Table.Td><Table.Td className={classes.matchReason}>{row.reason}</Table.Td><Table.Td>{row.itemcode}</Table.Td><Table.Td>{row.itemname}</Table.Td><Table.Td>{row.size || '규격 미등록'}</Table.Td><Table.Td>{numberText(row.qty)}</Table.Td><Table.Td>{row.qtyunit || '—'}</Table.Td><Table.Td>{row.warehousecodename || row.warehousecode || '—'}</Table.Td></Table.Tr>)}</Table.Tbody>
              </Table>
            </ScrollArea>
              : <Text className={classes.matchEmpty} c="dimmed">확인 가능한 재고 후보가 없습니다. 품목 마스터와 현재고 규격을 확인해주세요.</Text>}
        {candidates?.notice && <Text size="xs" c="dimmed" className={classes.matchNotice}>{candidates.notice}</Text>}
      </Stack>
    </Modal>
    <Modal opened={Boolean(cancelTarget)} onClose={() => !cancelling && setCancelTarget('')} title="주문확정 취소" centered size="sm">
      <Stack gap="md">
        <Box className={classes.cancelSummary}><Text size="xs" c="dimmed">취소할 확정번호</Text><Text size="sm" fw={700}>{cancelTarget}</Text></Box>
        <Text size="sm" c="dimmed">이 주문의 헤더와 상세 품목을 모두 삭제합니다. 삭제한 확정 주문은 복구할 수 없습니다. 원본 AI 분석 결과와 현재고는 유지됩니다.</Text>
        <Group justify="flex-end"><Button variant="default" onClick={() => setCancelTarget('')} disabled={cancelling}>돌아가기</Button><Button color="red" leftSection={<IconTrash size={15} />} onClick={cancelConfirmation} loading={cancelling}>주문확정 취소</Button></Group>
      </Stack>
    </Modal>
  </Box>;
}
