import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { LinkedOrderBadge } from '../../components/common/LinkedOrderNotice';
import ErpDateInput from '../../components/common/ErpDateInput';
import { Button, Pagination, Select, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconPackageExport, IconSearch } from '@tabler/icons-react';
import PickerModal, { PickerEmpty, pickerClasses } from '../../components/common/PickerModal';

const PAGE_SIZE = 50;
const PAGE_OPTIONS = [{ value: '25', label: '25개씩' }, { value: '50', label: '50개씩' }, { value: '100', label: '100개씩' }];
const STOCK_COLUMNS = [
  { key: 'select', label: '', width: 52, minWidth: 52 },
  { key: 'sourcetype', label: '구분', width: 90, minWidth: 60 },
  { key: 'receiptdate', label: '입고일자', width: 100, minWidth: 90 },
  { key: 'customname', label: '매입처', width: 120, minWidth: 90 },
  { key: 'itemname', label: '품명', width: 120, minWidth: 90 },
  { key: 'thickness', label: '두께', width: 75, minWidth: 60 },
  { key: 'width', label: '폭', width: 75, minWidth: 60 },
  { key: 'length', label: '길이', width: 75, minWidth: 60 },
  { key: 'warehouse', label: '창고', width: 115, minWidth: 90 },
  { key: 'currentqty', label: '현재고수량', width: 100, minWidth: 90 },
  { key: 'currentweight', label: '현재고중량(kg)', width: 125, minWidth: 100 },
  { key: 'unitprice', label: '출고단가', width: 130, minWidth: 100 },
  { key: 'qty', label: '출고수량', width: 100, minWidth: 90 },
  { key: 'weight', label: '출고중량(kg)', width: 125, minWidth: 100 },
  { key: 'productname', label: '제품번호', width: 260, minWidth: 150 },
];
const RIGHT_COLUMNS = new Set(['thickness', 'width', 'length', 'currentqty', 'currentweight']);
const initialColumnWidths = () => Object.fromEntries(STOCK_COLUMNS.map(({ key, width }) => [key, width]));
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
// The API accepts qty/weight with 3 decimals and unit prices with 2, so extra digits are not typed in.
const limitFraction = (value, digits) => {
  const [whole, fraction] = cleanDraftNumber(value).split('.');
  return fraction === undefined ? whole : `${whole}.${fraction.slice(0, digits)}`;
};
const draftNumberText = (value, maximumFractionDigits = Infinity) => {
  const raw = cleanDraftNumber(value);
  if (!raw) return '';
  if (Number.isFinite(maximumFractionDigits) && !raw.endsWith('.')) {
    const number = Number(raw);
    return Number.isFinite(number)
      ? number.toLocaleString(undefined, { maximumFractionDigits })
      : '';
  }
  const [integer, ...decimal] = raw.split('.');
  const grouped = (integer || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return decimal.length ? `${grouped}.${decimal.join('')}` : grouped;
};
const dimensionValue = (value) => value === null || value === undefined || String(value).trim() === '' ? '' : numberText(value);
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
  const [columnWidths, setColumnWidths] = useState(initialColumnWidths);
  const requestId = useRef(0);
  const draftInputRefs = useRef(new Map());
  const existingKeys = useMemo(() => new Set(existingRows.map(sourceKey)), [existingRows]);
  const tableWidth = STOCK_COLUMNS.reduce((sum, column) => sum + (columnWidths[column.key] ?? column.width), 0);

  const resizeColumn = useCallback((event, column) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = columnWidths[column.key] ?? column.width;
    const table = event.currentTarget.closest('table');
    const col = [...(table?.querySelectorAll('col[data-column-key]') || [])].find((element) => element.dataset.columnKey === column.key);
    let nextWidth = startWidth;
    const move = (pointerEvent) => {
      nextWidth = Math.max(column.minWidth, Math.min(1000, startWidth + pointerEvent.clientX - startX));
      if (col) col.style.width = `${nextWidth}px`;
      if (table) table.style.minWidth = `${tableWidth + nextWidth - startWidth}px`;
    };
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      setColumnWidths((current) => ({ ...current, [column.key]: nextWidth }));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  }, [columnWidths, tableWidth]);

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
    const nextValue = Math.max(0, num(limitFraction(value, 3)));
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
      [key]: { ...(current[key] || getDraft(stock)), unitprice: limitFraction(value, 2) },
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
      const key = sourceKey(stock);
      const draft = drafts[key] || getDraft(stock);
      // The DB/API keep qty and weight at 3 decimals; proportional weights (e.g. 1000 / 3)
      // would otherwise carry long fractions and be rejected on save.
      const qty = Number(num(draft.qty).toFixed(3));
      const weight = Number(num(draft.weight).toFixed(3));
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

  const stockDisabledReason = (stock, alreadyAdded, available) => {
    if (alreadyAdded) return '이미 출고 상세에 담긴 재고입니다.';
    if (stock.linked_orders) return '주문서에 연결된 재고입니다.';
    if (available.qty <= 0 || available.weight <= 0) return '출고 가능한 잔량이 없습니다.';
    return '';
  };
  const draftInputRef = (key, field) => (element) => {
    const inputKey = `${key}:${field}`;
    if (element) draftInputRefs.current.set(inputKey, element); else draftInputRefs.current.delete(inputKey);
  };
  const stopRowToggle = (event) => event.stopPropagation();

  return <PickerModal opened={opened} onClose={onClose}
    title="출고 재고 선택" description="기초·입고·가공 원천 재고에서 출고할 행과 수량·중량·단가를 지정합니다." icon={<IconPackageExport size={22} stroke={1.7} />}
    filters={<>
      <ErpDateInput label="기준일 시작" type="date" value={filterInputs.date_from} onChange={(event) => { const { value: nextValue } = event.currentTarget; setFilterInputs((current) => ({ ...current, date_from: nextValue })); }} />
      <ErpDateInput label="기준일 종료" type="date" value={filterInputs.date_to} onChange={(event) => { const { value: nextValue } = event.currentTarget; setFilterInputs((current) => ({ ...current, date_to: nextValue })); }} />
      <TextInput size="sm" label="품목" placeholder="품목코드·품명·제품번호" leftSection={<IconSearch size={14} />} value={filterInputs.item_search} onChange={(event) => { const { value: nextValue } = event.currentTarget; setFilterInputs((current) => ({ ...current, item_search: nextValue })); }} onKeyDown={(event) => event.key === 'Enter' && runSearch()} />
      <TextInput size="sm" label="창고" placeholder="창고코드 또는 창고명" value={filterInputs.warehouse_search} onChange={(event) => { const { value: nextValue } = event.currentTarget; setFilterInputs((current) => ({ ...current, warehouse_search: nextValue })); }} onKeyDown={(event) => event.key === 'Enter' && runSearch()} />
      <TextInput size="sm" label="매입처" placeholder="원천 거래처명" value={filterInputs.customname} onChange={(event) => { const { value: nextValue } = event.currentTarget; setFilterInputs((current) => ({ ...current, customname: nextValue })); }} onKeyDown={(event) => event.key === 'Enter' && runSearch()} />
      <Select size="sm" label="재고구분" data={[{ value: '', label: '전체' }, { value: 'OPENING', label: '기초' }, { value: 'INBOUND', label: '입고' }, { value: 'PROCESS', label: '가공' }]} value={filterInputs.sourcetype} onChange={(value) => setFilterInputs((current) => ({ ...current, sourcetype: value || '' }))} />
      <Button size="sm" color="red" leftSection={<IconSearch size={15} />} onClick={runSearch} loading={loading}>조회</Button>
      <Button size="sm" variant="default" onClick={() => setFilterInputs(createDefaultFilters())}>초기화</Button>
    </>}
    guide={<p>체크한 행의 출고단가·수량·중량을 입력한 뒤 [선택 재고 반영]을 누르세요. 수량을 바꾸면 중량은 잔량 비율대로 계산됩니다. 매출처는 재고 반영 후 출고 상세에서 입력합니다.</p>}
    listTitle="출고 가능 재고" count={total} loading={loading} listHint="행 또는 체크박스를 눌러 선택하고, 단가·수량·중량은 표에서 바로 입력하세요"
    selectedCount={selectedCount} onClearSelection={() => setSelected({})}
    pagination={<>
      <Pagination size="sm" color="red" total={Math.max(1, Math.ceil(total / pageSize))} value={page} onChange={(next) => load(next, filters, pageSize)} siblings={1} disabled={loading || !total} />
      <Select size="xs" w={92} data={PAGE_OPTIONS} value={String(pageSize)} aria-label="페이지당 행 수" onChange={(value) => { if (!value) return; const next = Number(value); setPageSize(next); void load(1, filters, next); }} />
    </>}
    onApply={apply} applyLabel="선택 재고 반영" applyDisabled={!selectedCount || loading}>
    <table className={pickerClasses.table} style={{ width: `max(100%, ${tableWidth}px)`, minWidth: tableWidth }} aria-label="출고 가능 재고">
      <colgroup>{STOCK_COLUMNS.map((column) => <col key={column.key} data-column-key={column.key} style={{ width: columnWidths[column.key] ?? column.width }} />)}</colgroup>
      <thead><tr>
        {STOCK_COLUMNS.map((column, index) => <th key={column.key} className={`${index ? pickerClasses.resizableHead : pickerClasses.center} ${RIGHT_COLUMNS.has(column.key) ? pickerClasses.right : ''}`}>
          {index ? column.label : '선택'}{index > 0 && <span className={pickerClasses.resizeHandle} onPointerDown={(event) => resizeColumn(event, column)} role="separator" aria-label={`${column.label} 열 너비 조절`} />}
        </th>)}
      </tr></thead>
      <tbody>
        {stocks.map((stock) => {
          const key = sourceKey(stock);
          const available = remaining(stock);
          const draft = getDraft(stock);
          const alreadyAdded = existingKeys.has(key);
          const picked = Boolean(selected[key]);
          const reason = stockDisabledReason(stock, alreadyAdded, available);
          const rowClass = picked ? pickerClasses.selectedRow : reason ? pickerClasses.disabledRow : '';
          return <tr key={key} className={rowClass} title={reason || undefined} onClick={() => { if (!reason && !loading) toggle(stock, !picked); }}>
            <td className={pickerClasses.center}><input className={pickerClasses.checkbox} type="checkbox" checked={picked} disabled={Boolean(reason) || loading} onClick={stopRowToggle} onChange={(event) => toggle(stock, event.currentTarget.checked)} aria-label={`${stock.itemname} 재고 선택`} /></td>
            <td>{sourceName(stock.sourcetype)}<LinkedOrderBadge orders={stock.linked_orders} /></td>
            <td>{String(stock.receiptdate || '').slice(0, 10)}</td>
            <td title={stock.customname || ''}>{stock.customname || '자체재고'}</td>
            <td title={stock.itemname || ''}>{stock.itemname}</td>
            <td className={pickerClasses.right}>{dimensionValue(stock.thickness)}</td>
            <td className={pickerClasses.right}>{dimensionValue(stock.width)}</td>
            <td className={pickerClasses.right}>{dimensionValue(stock.length)}</td>
            <td>{stock.warehousecodename || stock.warehousecode}</td>
            <td className={pickerClasses.right}>{numberText(stock.current_qty)}</td>
            <td className={pickerClasses.right}>{numberText(stock.current_weight)}</td>
            <td onClick={stopRowToggle}><input ref={draftInputRef(key, 'unitprice')} className={pickerClasses.cellInput} type="text" inputMode="decimal" value={draftNumberText(draft.unitprice)} disabled={alreadyAdded} onChange={(event) => updateUnitPriceDraft(stock, event.currentTarget.value)} onKeyDown={(event) => focusNextDraftInput(stock, 'unitprice', event)} aria-label={`${stock.itemname} 출고단가`} /></td>
            <td onClick={stopRowToggle}><input ref={draftInputRef(key, 'qty')} className={pickerClasses.cellInput} type="text" inputMode="decimal" value={draftNumberText(draft.qty)} disabled={alreadyAdded} onChange={(event) => updateDraft(stock, 'qty', event.currentTarget.value)} onKeyDown={(event) => focusNextDraftInput(stock, 'qty', event)} aria-label={`${stock.itemname} 출고수량`} /></td>
            <td onClick={stopRowToggle}><input ref={draftInputRef(key, 'weight')} className={pickerClasses.cellInput} type="text" inputMode="decimal" value={draftNumberText(draft.weight, 3)} disabled={alreadyAdded} onChange={(event) => updateDraft(stock, 'weight', event.currentTarget.value)} onKeyDown={(event) => focusNextDraftInput(stock, 'weight', event)} aria-label={`${stock.itemname} 출고중량`} /></td>
            <td title={stock.productname || ''}>{stock.productname || ''}</td>
          </tr>;
        })}
        {!stocks.length && <tr><td colSpan={STOCK_COLUMNS.length} className={pickerClasses.emptyCell}>
          <PickerEmpty title={loading ? '현재고를 조회하고 있습니다' : '출고 가능한 재고가 없습니다'} description={loading ? '' : '조회 기간이나 검색 조건을 바꿔 다시 조회해 주세요.'} />
        </td></tr>}
      </tbody>
    </table>
  </PickerModal>;
}
