import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Box, Button, Group, Loader, Modal, Pagination, Select, Stack, Table, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconSearch } from '@tabler/icons-react';
import classes from '../styles/pages/OutboundRegister.module.css';

const PAGE_SIZE = 50;
const PAGE_OPTIONS = [{ value: '25', label: '25개씩' }, { value: '50', label: '50개씩' }, { value: '100', label: '100개씩' }];
const createDefaultFilters = () => {
  const today = new Date();
  const formatDate = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return {
    item_search: '',
    warehouse_search: '',
    customname: '',
    date_from: formatDate(new Date(today.getFullYear(), today.getMonth(), 1)),
    date_to: formatDate(today),
    sourcetype: '',
  };
};
const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });
const sourceKey = (stock) => [stock.sourcetype || stock.stocksourcetype, stock.sourceno || stock.stocksourceno, stock.sourceline ?? stock.stocksourceline].join('\u001f');
const num = (value) => Number(value) || 0;
const numberText = (value) => num(value).toLocaleString(undefined, { maximumFractionDigits: 3 });
const cleanDraftNumber = (value) => String(value ?? '').replace(/,/g, '').replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1');
const draftNumberText = (value) => {
  const raw = cleanDraftNumber(value);
  if (!raw) return '';
  const [integer, ...decimal] = raw.split('.');
  const grouped = (integer || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return decimal.length ? `${grouped}.${decimal.join('')}` : grouped;
};
const dimensionText = (stock) => [stock.thickness, stock.width, stock.length]
  .filter((value) => value !== null && value !== undefined && String(value).trim() !== '')
  .map(numberText)
  .join(' × ');
const sourceName = (value) => value === 'OPENING' ? '기초' : value === 'INBOUND' ? '입고' : value;

export default function OutboundStockPickerModal({ opened, receiptno = '', existingRows = [], onClose, onApply }) {
  const [filterInputs, setFilterInputs] = useState(createDefaultFilters);
  const [filters, setFilters] = useState(createDefaultFilters);
  const [stocks, setStocks] = useState([]);
  const [selected, setSelected] = useState({});
  const [drafts, setDrafts] = useState({});
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);
  const draftInputRefs = useRef(new Map());
  const existingKeys = useMemo(() => new Set(existingRows.map(sourceKey)), [existingRows]);

  const load = useCallback(async (nextPage, nextFilters, nextPageSize) => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      const { data } = await axios.get('/api/outbound-register/available-stock', {
        ...authConfig(),
        params: {
          page: nextPage, page_size: nextPageSize,
          ...Object.fromEntries(Object.entries(nextFilters).filter(([, value]) => value)),
          receiptno: receiptno || undefined,
        },
      });
      if (id !== requestId.current) return;
      setStocks(data.items || []);
      setTotal(data.total || 0);
      setPage(nextPage);
    } catch (error) {
      if (id === requestId.current) {
        const message = error.response?.data?.detail || '출고 가능한 현재고를 조회하지 못했습니다.';
        setStocks([]);
        setTotal(0);
        notifications.show({ title: '현재고 조회 실패', message, color: 'red' });
      }
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [receiptno]);

  useEffect(() => {
    if (!opened) return undefined;
    const defaults = createDefaultFilters();
    setFilterInputs(defaults);
    setFilters(defaults);
    setSelected({});
    setDrafts({});
    setPage(1);
    setPageSize(PAGE_SIZE);
    void load(1, defaults, PAGE_SIZE);
    return () => { requestId.current += 1; };
  }, [opened, load]);

  const runSearch = () => {
    if (filterInputs.date_from && filterInputs.date_to && filterInputs.date_from > filterInputs.date_to) {
      notifications.show({ title: '조회 기간 확인', message: '시작일은 종료일보다 늦을 수 없습니다.', color: 'orange' });
      return;
    }
    const nextFilters = Object.fromEntries(Object.entries(filterInputs).map(([key, value]) => [key, String(value || '').trim()]));
    setFilters(nextFilters);
    setPage(1);
    void load(1, nextFilters, pageSize);
  };

  const remaining = (stock) => {
    return {
      qty: Math.max(0, num(stock.available_qty)),
      weight: Math.max(0, num(stock.available_weight)),
    };
  };

  const updateDraft = (stock, field, value) => {
    const key = sourceKey(stock);
    const limit = remaining(stock);
    const nextValue = Math.max(0, num(cleanDraftNumber(value)));
    setDrafts((current) => {
      const previous = current[key] || {
        qty: String(Math.min(1, limit.qty)),
        weight: String(limit.qty > 0 ? Math.min(limit.weight, num(stock.available_weight) / Math.max(num(stock.available_qty), 1)) : 0),
        unitprice: '',
      };
      if (field === 'qty') {
        const qty = Math.min(nextValue, limit.qty);
        const ratio = num(stock.available_qty) > 0 ? num(stock.available_weight) / num(stock.available_qty) : 0;
        return { ...current, [key]: { ...previous, qty: String(qty), weight: String(Math.min(limit.weight, qty * ratio)) } };
      }
      return { ...current, [key]: { ...previous, weight: String(Math.min(nextValue, limit.weight)) } };
    });
  };

  const updateUnitPriceDraft = (stock, value) => {
    const key = sourceKey(stock);
    setDrafts((current) => ({
      ...current,
      [key]: { ...(current[key] || getDraft(stock)), unitprice: cleanDraftNumber(value) },
    }));
  };

  const getDraft = (stock) => {
    const key = sourceKey(stock);
    if (drafts[key]) return drafts[key];
    const limit = remaining(stock);
    const qty = Math.min(1, limit.qty);
    const weight = num(stock.available_qty) > 0 ? Math.min(limit.weight, num(stock.available_weight) * qty / num(stock.available_qty)) : 0;
    return { qty: String(qty), weight: String(weight), unitprice: '' };
  };

  const toggle = (stock, checked) => {
    const key = sourceKey(stock);
    setSelected((current) => ({ ...current, [key]: checked }));
    if (checked && !drafts[key]) setDrafts((current) => ({ ...current, [key]: getDraft(stock) }));
  };

  const focusNextDraftInput = (stock, field, event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const currentIndex = stocks.findIndex((item) => sourceKey(item) === sourceKey(stock));
    for (let index = currentIndex + 1; index < stocks.length; index += 1) {
      const next = stocks[index];
      if (existingKeys.has(sourceKey(next))) continue;
      const input = draftInputRefs.current.get(`${sourceKey(next)}:${field}`);
      if (input && !input.disabled) {
        input.focus();
        input.select();
        break;
      }
    }
  };

  const selectedCount = Object.values(selected).filter(Boolean).length;
  const apply = () => {
    const chosen = stocks.filter((stock) => selected[sourceKey(stock)]);
    const result = [];
    for (const stock of chosen) {
      const draft = drafts[sourceKey(stock)] || getDraft(stock);
      const qty = num(draft.qty);
      const weight = num(draft.weight);
      const unitpriceText = String(draft.unitprice ?? '').trim();
      const unitprice = Number(unitpriceText);
      const limit = remaining(stock);
      if (qty <= 0 || weight <= 0 || qty > limit.qty || weight > limit.weight) {
        notifications.show({ title: '출고량 확인', message: `${stock.itemname}: 출고 수량 또는 중량이 잔량을 초과했습니다.`, color: 'orange' });
        return;
      }
      if (!unitpriceText || !Number.isFinite(unitprice) || unitprice < 0) {
        notifications.show({ title: '출고단가 확인', message: `${stock.itemname}: 출고단가를 입력해 주세요.`, color: 'orange' });
        return;
      }
      result.push({ ...stock, qty: String(qty), weight: String(weight), unitprice: String(unitprice) });
    }
    if (!result.length) return;
    onApply(result);
  };

  return <Modal opened={opened} onClose={onClose} title="출고 재고 선택" centered size="95%" classNames={{ content: classes.receiptFinderModalContent, header: classes.receiptFinderModalHeader }}>
    <Stack gap="sm" pt={8}>
      <Box className={classes.modalHint}>기초·입고 원천 재고에서 출고할 행을 선택하고 수량과 중량을 입력하세요. 출고처는 상단 전표의 거래처와 별도로 유지됩니다.</Box>
      <Group align="end" gap="xs" wrap="wrap">
        <TextInput label="기준일 시작" type="date" value={filterInputs.date_from} onChange={(event) => setFilterInputs((current) => ({ ...current, date_from: event.currentTarget.value }))} />
        <TextInput label="기준일 종료" type="date" value={filterInputs.date_to} onChange={(event) => setFilterInputs((current) => ({ ...current, date_to: event.currentTarget.value }))} />
        <TextInput label="품목" placeholder="품목코드·품명·제품번호" value={filterInputs.item_search} onChange={(event) => setFilterInputs((current) => ({ ...current, item_search: event.currentTarget.value }))} onKeyDown={(event) => event.key === 'Enter' && runSearch()} />
        <TextInput label="창고" placeholder="창고코드 또는 창고명" value={filterInputs.warehouse_search} onChange={(event) => setFilterInputs((current) => ({ ...current, warehouse_search: event.currentTarget.value }))} onKeyDown={(event) => event.key === 'Enter' && runSearch()} />
        <TextInput label="매입처" placeholder="원천 거래처명" value={filterInputs.customname} onChange={(event) => setFilterInputs((current) => ({ ...current, customname: event.currentTarget.value }))} onKeyDown={(event) => event.key === 'Enter' && runSearch()} />
        <Select label="재고구분" data={[{ value: '', label: '전체' }, { value: 'OPENING', label: '기초' }, { value: 'INBOUND', label: '입고' }]} value={filterInputs.sourcetype} onChange={(value) => setFilterInputs((current) => ({ ...current, sourcetype: value || '' }))} />
        <Button color="red" leftSection={<IconSearch size={15} />} onClick={runSearch}>조회</Button>
      </Group>
      <Box pos="relative" className={classes.pickerResults}>
        {loading && <Loader className={classes.pickerLoader} size="sm" color="red" />}
        <Box style={{ overflow: 'auto', height: '100%' }}>
          <Table className={classes.stockPickerTable} stickyHeader highlightOnHover withTableBorder withColumnBorders>
                        <Table.Thead><Table.Tr>
              <Table.Th style={{ width: 42 }} />
              <Table.Th style={{ width: 90 }}>구분</Table.Th>
              <Table.Th style={{ width: 100 }}>입고일자</Table.Th>
              <Table.Th style={{ width: 120 }}>입고처</Table.Th>
              <Table.Th style={{ width: 120 }}>품명</Table.Th>
              <Table.Th style={{ width: 145 }}>규격</Table.Th>
              <Table.Th style={{ width: 115 }}>창고</Table.Th>
              <Table.Th style={{ width: 100 }}>현재고수량</Table.Th>
              <Table.Th style={{ width: 125 }}>현재고중량(kg)</Table.Th>
              <Table.Th style={{ width: 130 }}>&#xCD9C;&#xACE0;&#xB2E8;&#xAC00;</Table.Th>
              <Table.Th style={{ width: 100 }}>출고수량</Table.Th>
              <Table.Th style={{ width: 125 }}>출고중량(kg)</Table.Th>
              <Table.Th style={{ width: 120 }}>제품번호</Table.Th>
            </Table.Tr></Table.Thead>
            <Table.Tbody>
              {stocks.map((stock) => {
                const key = sourceKey(stock);
                const available = remaining(stock);
                const draft = getDraft(stock);
                const alreadyAdded = existingKeys.has(key);
                return <Table.Tr key={key}>
                  <Table.Td><input type="checkbox" checked={Boolean(selected[key])} disabled={alreadyAdded || loading || available.qty <= 0 || available.weight <= 0} onChange={(event) => toggle(stock, event.currentTarget.checked)} aria-label={`${stock.itemname} 재고 선택`} /></Table.Td>
                                    <Table.Td>{sourceName(stock.sourcetype)}</Table.Td>
                  <Table.Td>{String(stock.receiptdate || '').slice(0, 10)}</Table.Td>
                  <Table.Td>{stock.customname || '자체재고'}</Table.Td>
                  <Table.Td>{stock.itemname}</Table.Td>
                  <Table.Td>{dimensionText(stock)}</Table.Td>
                  <Table.Td>{stock.warehousecodename || stock.warehousecode}</Table.Td>
                  <Table.Td ta="right">{numberText(stock.current_qty)}</Table.Td>
                  <Table.Td ta="right">{numberText(stock.current_weight)}</Table.Td>
                  <Table.Td><input ref={(element) => { const inputKey = `${key}:unitprice`; if (element) draftInputRefs.current.set(inputKey, element); else draftInputRefs.current.delete(inputKey); }} className={classes.stockDraftInput} type="text" inputMode="decimal" value={draftNumberText(draft.unitprice)} disabled={alreadyAdded} onChange={(event) => updateUnitPriceDraft(stock, event.currentTarget.value)} onKeyDown={(event) => focusNextDraftInput(stock, 'unitprice', event)} /></Table.Td>
                  <Table.Td><input ref={(element) => { const inputKey = `${key}:qty`; if (element) draftInputRefs.current.set(inputKey, element); else draftInputRefs.current.delete(inputKey); }} className={classes.stockDraftInput} type="text" inputMode="decimal" value={draftNumberText(draft.qty)} disabled={alreadyAdded} onChange={(event) => updateDraft(stock, 'qty', event.currentTarget.value)} onKeyDown={(event) => focusNextDraftInput(stock, 'qty', event)} /></Table.Td>
                  <Table.Td><input ref={(element) => { const inputKey = `${key}:weight`; if (element) draftInputRefs.current.set(inputKey, element); else draftInputRefs.current.delete(inputKey); }} className={classes.stockDraftInput} type="text" inputMode="decimal" value={draftNumberText(draft.weight)} disabled={alreadyAdded} onChange={(event) => updateDraft(stock, 'weight', event.currentTarget.value)} onKeyDown={(event) => focusNextDraftInput(stock, 'weight', event)} /></Table.Td>
                  <Table.Td>{stock.productname || ''}</Table.Td>
                </Table.Tr>;
              })}
              {!stocks.length && <Table.Tr><Table.Td colSpan={13} className={classes.customerEmpty}>{loading ? '현재고를 조회하고 있습니다.' : '출고 가능한 재고가 없습니다.'}</Table.Td></Table.Tr>}
            </Table.Tbody>
          </Table>
        </Box>
      </Box>
      <Group justify="space-between" align="center">
        <Group gap="xs"><Text size="xs" c="dimmed">총 {total.toLocaleString()}건</Text><Select size="xs" w={100} data={PAGE_OPTIONS} value={String(pageSize)} onChange={(value) => { if (!value) return; const next = Number(value); setPageSize(next); void load(1, filters, next); }} /></Group>
        <Group gap="xs"><Text size="xs" c="dimmed">{selectedCount.toLocaleString()}개 선택</Text><Pagination size="sm" total={Math.max(1, Math.ceil(total / pageSize))} value={page} onChange={(next) => load(next, filters)} withEdges color="red" disabled={loading || !total} /><Button variant="default" onClick={onClose}>취소</Button><Button color="red" onClick={apply} disabled={!selectedCount || loading}>선택 재고 반영</Button></Group>
      </Group>
    </Stack>
  </Modal>;
}
