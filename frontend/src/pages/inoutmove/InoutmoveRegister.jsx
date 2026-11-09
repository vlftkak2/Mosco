import { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import usePageReactivated from '../../components/common/usePageReactivated';
import { LinkedOrderBadge } from '../../components/common/LinkedOrderNotice';
import ErpDateInput from '../../components/common/ErpDateInput';
import PickerModal, { PickerEmpty, pickerClasses } from '../../components/common/PickerModal';
import { ActionIcon, Box, Button, Group, Modal, Pagination, Paper, Select, Stack, Table, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconArrowsExchange, IconCopy, IconDeviceFloppy, IconFileSpreadsheet, IconPlus, IconSearch, IconTrash, IconX } from '@tabler/icons-react';
import XLSX from 'xlsx-js-style';
import { applyExcelHeaderStyle } from '../../utils/excelHeaderStyle';
import { PageRibbonContext } from '../../components/layout/MainLayout';
import outboundClasses from '../../styles/pages/OutboundRegister.module.css';
import sharedClasses from '../../styles/pages/ManagementShared.module.css';
import codeClasses from '../../styles/pages/CodeMasterPage.module.css';
import inboundClasses from '../../styles/pages/InboundRegister.module.css';
import classes from './InoutmoveRegister.module.css';

const auth = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });
// Same Excel date-time text as 입고/출고등록: "YYYY-MM-DD HH:mm:ss" (KST).
const formatExcelDateTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type) => parts.find((entry) => entry.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}:${part('second')}`;
};
const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const number = (value) => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });
const sourceKey = (row) => `${row.stocksourcetype}\u001f${row.stocksourceno}\u001f${row.stocksourceline}`;
const stockSourceTypeName = (type, receiptno) => {
  if (type === 'OPENING') return '기초';
  if (type === 'PROCESS' || (type === 'INBOUND' && String(receiptno || '').toUpperCase().startsWith('PR'))) return '가공';
  return '입고';
};
const emptyFilters = () => ({ date_from: `${today().slice(0, 7)}-01`, date_to: today(), receiptno: '', warehouse: '' });
const emptyStockFilters = () => ({ item_search: '', warehouse_search: '', sourcetype: '', date_from: `${today().slice(0, 7)}-01`, date_to: today(), thickness: '', width: '', length: '' });
const PAGE_SIZE_OPTIONS = [
  { value: '15', label: '15개씩' }, { value: '50', label: '50개씩' },
  { value: '100', label: '100개씩' }, { value: '200', label: '200개씩' },
];
const LIST_COLUMNS = [
  { key: 'receptdate', label: '재고이전 일자', width: 90, minWidth: 90 },
  { key: 'fromwarehouse', label: '출고 창고', width: 90, minWidth: 90 },
  { key: 'towarehouse', label: '입고 창고', width: 90, minWidth: 90 },
  { key: 'line_count', label: '상세건수', width: 70, minWidth: 70 },
  { key: 'total_qty', label: '수량', width: 75, minWidth: 75 },
  { key: 'total_weight', label: '중량(KG)', width: 80, minWidth: 80 },
  { key: 'manager', label: '담당자', width: 80, minWidth: 75 },
  { key: 'receiptno', label: '재고이전전표', width: 110, minWidth: 110 },
  { key: 'description', label: '비고', width: 110, minWidth: 90 },
];
const DETAIL_COLUMNS = [
  { key: 'select', label: '', width: 38, minWidth: 38 },
  { key: 'number', label: 'No.', width: 48, minWidth: 42 },
  { key: 'move_type', label: '구분', width: 60, minWidth: 52 },
  { key: 'move_date', label: '재고이전 일자', width: 90, minWidth: 90 },
  { key: 'from_warehouse', label: '출고 창고', width: 90, minWidth: 90 },
  { key: 'to_warehouse', label: '입고 창고', width: 90, minWidth: 90 },
  { key: 'itemname', label: '품명', width: 90, minWidth: 90 },
  { key: 'productname', label: '제품명', width: 90, minWidth: 90 },
  { key: 'grade', label: '강종', width: 70, minWidth: 70 },
  { key: 'thickness', label: '두께', width: 70, minWidth: 70 },
  { key: 'width', label: '폭', width: 70, minWidth: 70 },
  { key: 'length', label: '길이', width: 70, minWidth: 70 },
  { key: 'qty', label: '이전 수량', width: 70, minWidth: 70 },
  { key: 'qtyunit', label: '단위', width: 50, minWidth: 50 },
  { key: 'weight', label: '이전 중량(KG)', width: 100, minWidth: 80 },
  { key: 'customname', label: '매입처', width: 120, minWidth: 90 },
  { key: 'source_date', label: '재고입고일자', width: 90, minWidth: 90 },
  { key: 'sourcetype', label: '재고구분', width: 80, minWidth: 65 },
  { key: 'stocksourceno', label: '원천전표', width: 110, minWidth: 110 },
  { key: 'stocksourceline', label: '원천순번', width: 90, minWidth: 90 },
];
const initialColumnWidths = (columns) => Object.fromEntries(columns.map(({ key, width }) => [key, width]));
const STOCK_PAGE_SIZE_OPTIONS = [
  { value: '25', label: '25개씩' }, { value: '50', label: '50개씩' }, { value: '100', label: '100개씩' },
];
const STOCK_COLUMNS = [
  { key: 'select', label: '', width: 52, minWidth: 52 },
  { key: 'sourcetype', label: '구분', width: 72, minWidth: 60 },
  { key: 'receiptdate', label: '입고일자', width: 108, minWidth: 90 },
  { key: 'warehouse', label: '출고창고', width: 145, minWidth: 100 },
  { key: 'itemname', label: '품명', width: 170, minWidth: 100 },
  { key: 'grade', label: '강종', width: 100, minWidth: 70 },
  { key: 'thickness', label: '두께', width: 82, minWidth: 60 },
  { key: 'width', label: '폭', width: 82, minWidth: 60 },
  { key: 'length', label: '길이', width: 82, minWidth: 60 },
  { key: 'qty', label: '현재고수량', width: 120, minWidth: 90 },
  { key: 'weight', label: '현재고중량', width: 140, minWidth: 100 },
  { key: 'productname', label: '제품번호', width: 260, minWidth: 130 },
];
const STOCK_RIGHT_COLUMNS = new Set(['thickness', 'width', 'length', 'qty', 'weight']);
const initialStockColumnWidths = () => Object.fromEntries(STOCK_COLUMNS.map(({ key, width }) => [key, width]));

// Keep fast header text edits local so each keystroke does not rerender the
// receipt list, detail grid, and stock picker state owned by the page.
const HeaderTextInput = memo(function HeaderTextInput({ value, disabled, inputRef, onCommit }) {
  const sourceValue = value || '';
  const [draftState, setDraftState] = useState({ sourceValue, draft: sourceValue });
  let draft = draftState.draft;
  if (draftState.sourceValue !== sourceValue) {
    draft = sourceValue;
    setDraftState({ sourceValue, draft: sourceValue });
  }

  return <TextInput
    ref={inputRef}
    value={draft}
    disabled={disabled}
    onChange={(event) => {
      const nextValue = event.currentTarget.value;
      setDraftState((current) => ({ ...current, draft: nextValue }));
    }}
    onBlur={() => onCommit(draft)}
  />;
});

function StockPicker({ opened, fromWarehouse, toWarehouse, existingKeys, onClose, onApply }) {
  const [inputs, setInputs] = useState(emptyStockFilters);
  const [filters, setFilters] = useState(emptyStockFilters);
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState({});
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [pageSize, setPageSize] = useState(50);
  const [columnWidths, setColumnWidths] = useState(initialStockColumnWidths);
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

  const load = useCallback(async (nextPage = 1, nextFilters = emptyStockFilters(), nextPageSize = 50) => {
    setLoading(true);
    try {
      const params = Object.fromEntries(Object.entries(nextFilters).filter(([, value]) => String(value || '').trim()));
      params.page = nextPage;
      params.page_size = nextPageSize;
      if (fromWarehouse) params.warehouse_search = fromWarehouse;
      const { data } = await axios.get('/api/inoutmove-register/available-stock', { ...auth(), params });
      setItems(data.items || []);
      setTotal(data.total || 0);
      setPage(nextPage);
    } catch (error) {
      setItems([]);
      setTotal(0);
      notifications.show({ title: '현재고 조회 실패', message: error.response?.data?.detail || '이전 가능한 현재고를 조회하지 못했습니다.', color: 'red' });
    } finally { setLoading(false); }
  }, [fromWarehouse]);

  useEffect(() => {
    if (!opened) return;
    setInputs(emptyStockFilters());
    setFilters(emptyStockFilters());
    setSelected({});
    setPageSize(50);
    void load(1, emptyStockFilters());
  }, [opened, load]);

  const runSearch = () => {
    if (inputs.date_from && inputs.date_to && inputs.date_from > inputs.date_to) {
      notifications.show({ title: '조회기간 확인', message: '시작일은 종료일보다 늦을 수 없습니다.', color: 'orange' });
      return;
    }
    const next = Object.fromEntries(Object.entries(inputs).map(([key, value]) => [key, String(value || '').trim()]));
    setFilters(next);
    void load(1, next, pageSize);
  };
  const toggle = (row, checked) => {
    const key = sourceKey(row);
    if (existingKeys.has(key) || row.linked_orders) return;
    setSelected((current) => ({ ...current, [key]: checked }));
  };
  const selectedItems = items.filter((row) => selected[sourceKey(row)] && !existingKeys.has(sourceKey(row)));

  const setInput = (field) => (event) => { const { value: nextValue } = event.currentTarget; setInputs((v) => ({ ...v, [field]: nextValue })); };
  const searchOnEnter = (event) => { if (event.key === 'Enter') runSearch(); };

  return <PickerModal opened={opened} onClose={onClose}
    title="재고 선택" description="이동할 현재고를 선택합니다. 선택한 재고의 출고 창고는 자동으로 지정됩니다." icon={<IconArrowsExchange size={22} stroke={1.7} />}
    badge={fromWarehouse ? `출고창고 ${fromWarehouse}` : undefined}
    filters={<>
      <ErpDateInput label="기준일 시작" type="date" value={inputs.date_from} onChange={setInput('date_from')} />
      <ErpDateInput label="기준일 종료" type="date" value={inputs.date_to} onChange={setInput('date_to')} />
      <TextInput size="sm" label="품목" placeholder="품목코드·품명·제품명" leftSection={<IconSearch size={14} />} value={inputs.item_search} onChange={setInput('item_search')} onKeyDown={searchOnEnter} />
      <Select size="sm" label="재고 구분" data={[{ value: '', label: '전체' }, { value: 'OPENING', label: '기초' }, { value: 'INBOUND', label: '입고' }, { value: 'PROCESS', label: '가공' }]} value={inputs.sourcetype} onChange={(value) => setInputs((v) => ({ ...v, sourcetype: value || '' }))} />
      <TextInput size="sm" label="두께" placeholder="예: 1.2" value={inputs.thickness} onChange={setInput('thickness')} onKeyDown={searchOnEnter} style={{ width: 100 }} />
      <TextInput size="sm" label="폭" placeholder="폭" value={inputs.width} onChange={setInput('width')} onKeyDown={searchOnEnter} style={{ width: 100 }} />
      <TextInput size="sm" label="길이" placeholder="길이" value={inputs.length} onChange={setInput('length')} onKeyDown={searchOnEnter} style={{ width: 100 }} />
      <Button size="sm" color="red" leftSection={<IconSearch size={15} />} onClick={runSearch} loading={loading}>조회</Button>
      <Button size="sm" variant="default" onClick={() => setInputs(emptyStockFilters())}>초기화</Button>
    </>}
    guide={<p>이동할 재고를 체크한 뒤 [선택 반영]을 누르세요. 입고 창고는 재고이동 상세에서 입력합니다{toWarehouse ? ` (현재 입고 창고: ${toWarehouse})` : ''}.</p>}
    listTitle="이동 가능 재고" count={total} loading={loading}
    selectedCount={selectedItems.length} onClearSelection={() => setSelected({})}
    pagination={<>
      <Pagination size="sm" color="red" total={Math.max(1, Math.ceil(total / pageSize))} value={page} onChange={(value) => void load(value, filters, pageSize)} siblings={1} disabled={loading || !total} />
      <Select size="xs" w={92} data={STOCK_PAGE_SIZE_OPTIONS} value={String(pageSize)} aria-label="페이지당 행 수" onChange={(value) => { if (!value) return; const nextSize = Number(value); setPageSize(nextSize); void load(1, filters, nextSize); }} />
    </>}
    onApply={() => onApply(selectedItems)} applyDisabled={!selectedItems.length || loading}>
    <table className={pickerClasses.table} style={{ width: `max(100%, ${tableWidth}px)`, minWidth: tableWidth }} aria-label="이동 가능 재고">
      <colgroup>{STOCK_COLUMNS.map((column) => <col key={column.key} data-column-key={column.key} style={{ width: columnWidths[column.key] ?? column.width }} />)}</colgroup>
      <thead><tr>
        {STOCK_COLUMNS.map((column, index) => <th key={column.key} className={`${index ? pickerClasses.resizableHead : pickerClasses.center} ${STOCK_RIGHT_COLUMNS.has(column.key) ? pickerClasses.right : ''}`}>
          {index ? column.label : '선택'}{index > 0 && <span className={pickerClasses.resizeHandle} onPointerDown={(event) => resizeColumn(event, column)} role="separator" aria-label={`${column.label} 열 너비 조절`} />}
        </th>)}
      </tr></thead>
      <tbody>{items.map((row) => {
        const rowKey = sourceKey(row);
        const alreadyAdded = existingKeys.has(rowKey);
        const reason = alreadyAdded ? '이미 재고이동 상세에 담긴 재고입니다.' : row.linked_orders ? '주문서에 연결된 재고입니다.' : '';
        const picked = Boolean(selected[rowKey]) && !alreadyAdded;
        return <tr key={rowKey} className={picked ? pickerClasses.selectedRow : reason ? pickerClasses.disabledRow : ''} title={reason || undefined}
          aria-disabled={Boolean(reason) || undefined} onClick={() => { if (!reason && !loading) toggle(row, !picked); }}>
          <td className={pickerClasses.center}><input className={pickerClasses.checkbox} type="checkbox" checked={picked} disabled={loading || Boolean(reason)} onClick={(event) => event.stopPropagation()} onChange={(event) => toggle(row, event.currentTarget.checked)} aria-label={`${row.itemname} 재고 선택`} /></td>
          <td>{stockSourceTypeName(row.stocksourcetype, row.stocksourceno)}<LinkedOrderBadge orders={row.linked_orders} /></td>
          <td>{String(row.receiptdate || '').slice(0, 10)}</td>
          <td>{row.warehousecodename || row.warehousecode}</td>
          <td title={row.itemname || ''}>{row.itemname}</td>
          <td>{row.materialname || row.myrtle || ''}</td>
          <td className={pickerClasses.right}>{number(row.thickness)}</td>
          <td className={pickerClasses.right}>{number(row.width)}</td>
          <td className={pickerClasses.right}>{number(row.length)}</td>
          <td className={pickerClasses.right}>{number(row.qty)}</td>
          <td className={pickerClasses.right}>{number(row.weight)}</td>
          <td title={row.productname || ''}>{row.productname || ''}</td>
        </tr>;
      })}
      {!items.length && <tr><td colSpan={STOCK_COLUMNS.length} className={pickerClasses.emptyCell}>
        <PickerEmpty title={loading ? '현재고를 조회하고 있습니다' : '이동할 수 있는 재고가 없습니다'} description={loading ? '' : '조회 기간이나 검색 조건을 바꿔 다시 조회해 주세요.'} />
      </td></tr>}
      </tbody>
    </table>
  </PickerModal>;
}

export default function InoutmoveRegister() {
  const pageLayout = useContext(PageRibbonContext);
  const [warehouses, setWarehouses] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [filters, setFilters] = useState(emptyFilters);
  const [filterInputs, setFilterInputs] = useState(emptyFilters);
  const [header, setHeader] = useState({ receptdate: today(), fromwarehousecode: '', towarehousecode: '', manager: '', description: '' });
  const [items, setItems] = useState([]);
  const [selectedReceiptno, setSelectedReceiptno] = useState('');
  // Document being fetched after a list click: highlighted immediately for instant feedback;
  // only the latest click's response is applied (see selectDocument).
  const [openingReceiptno, setOpeningReceiptno] = useState('');
  const openRequestRef = useRef({ id: 0, controller: null });
  const [selectedIds, setSelectedIds] = useState([]);
  const [stockOpen, setStockOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [listColumnWidths, setListColumnWidths] = useState(() => initialColumnWidths(LIST_COLUMNS));
  const [detailColumnWidths, setDetailColumnWidths] = useState(() => initialColumnWidths(DETAIL_COLUMNS));
  const listViewportRef = useRef(null);
  const listHorizontalRef = useRef(null);
  const managerInputRef = useRef(null);
  const descriptionInputRef = useRef(null);
  const readOnly = Boolean(selectedReceiptno);
  const warehouseData = useMemo(() => warehouses.map((row) => ({ value: row.warehousecode, label: row.warehousecodename })), [warehouses]);
  const fromWarehouse = warehouses.find((row) => row.warehousecode === header.fromwarehousecode)?.warehousecodename || '';
  const toWarehouse = warehouses.find((row) => row.warehousecode === header.towarehousecode)?.warehousecodename || '';
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const totals = useMemo(() => items.reduce((sum, row) => ({ qty: sum.qty + Number(row.qty || 0), weight: sum.weight + Number(row.weight || 0) }), { qty: 0, weight: 0 }), [items]);
  const listTableWidth = LIST_COLUMNS.reduce((sum, column) => sum + (listColumnWidths[column.key] ?? column.width), 0);
  const detailTableWidth = DETAIL_COLUMNS.reduce((sum, column) => sum + (detailColumnWidths[column.key] ?? column.width), 0);

  const resizeGridColumn = useCallback((event, column, widths, setWidths, columns, listTable = false) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = widths[column.key] ?? column.width;
    const table = event.currentTarget.closest('table');
    const col = [...(table?.querySelectorAll('col[data-column-key]') || [])].find((element) => element.dataset.columnKey === column.key);
    const tableWidth = columns.reduce((sum, item) => sum + (widths[item.key] ?? item.width), 0);
    let nextWidth = startWidth;
    let animationFrame = 0;
    const applyWidth = () => {
      const nextTableWidth = tableWidth + nextWidth - startWidth;
      if (col) col.style.width = `${nextWidth}px`;
      if (table) {
        const renderedWidth = Math.max(table.parentElement?.clientWidth || 0, nextTableWidth);
        table.style.width = `${renderedWidth}px`;
        table.style.minWidth = `${nextTableWidth}px`;
      }
      if (listTable && listHorizontalRef.current?.firstElementChild) {
        const viewportWidth = listViewportRef.current?.clientWidth || 0;
        listHorizontalRef.current.firstElementChild.style.width = `${Math.max(viewportWidth, nextTableWidth)}px`;
      }
    };
    const move = (pointerEvent) => {
      nextWidth = Math.max(column.minWidth, Math.min(1200, startWidth + pointerEvent.clientX - startX));
      if (!animationFrame) animationFrame = window.requestAnimationFrame(() => { animationFrame = 0; applyWidth(); });
    };
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      applyWidth();
      setWidths((current) => ({ ...current, [column.key]: nextWidth }));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  }, []);

  const loadWarehouses = useCallback(async () => {
    try { const { data } = await axios.get('/api/inoutmove-register/warehouses', auth()); setWarehouses(data.items || []); }
    catch (error) { notifications.show({ title: '창고 조회 실패', message: error.response?.data?.detail || '사용 중인 창고를 조회하지 못했습니다.', color: 'red' }); }
  }, []);

  const resetDraft = useCallback(() => {
    setSelectedReceiptno(''); setItems([]); setSelectedIds([]);
    setHeader({ receptdate: today(), fromwarehousecode: '', towarehousecode: '', manager: '', description: '' });
  }, []);

  const loadDocuments = useCallback(async (nextPage = 1, nextFilters = filters, nextPageSize = pageSize) => {
    setLoading(true);
    try {
      const params = Object.fromEntries(Object.entries(nextFilters).filter(([, value]) => String(value || '').trim()));
      params.page = nextPage; params.page_size = nextPageSize;
      const { data } = await axios.get('/api/inoutmove-register/documents', { ...auth(), params });
      setDocuments(data.items || []); setTotal(data.total || 0); setPage(nextPage);
      if (selectedReceiptno && !(data.items || []).some((row) => row.receiptno === selectedReceiptno)) resetDraft();
    } catch (error) {
      notifications.show({ title: '재고이전 조회 실패', message: error.response?.data?.detail || '재고이전 목록을 조회하지 못했습니다.', color: 'red' });
    } finally { setLoading(false); }
  }, [filters, selectedReceiptno, resetDraft, pageSize]);
  // 탭에 돌아오면 지금 조건 그대로 다시 불러온다 (다른 탭에서 데이터가 바뀌었을 수 있음)
  usePageReactivated(() => { void loadWarehouses(); });
  useEffect(() => {
    void loadWarehouses();
    void loadDocuments(1, emptyFilters());
    // Initial load only; interactions load again with their current filter state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadWarehouses]);

  const runSearch = useCallback(() => {
    if (filterInputs.date_from && filterInputs.date_to && filterInputs.date_from > filterInputs.date_to) {
      notifications.show({ title: '조회기간 확인', message: '시작일은 종료일보다 늦을 수 없습니다.', color: 'orange' }); return;
    }
    const next = Object.fromEntries(Object.entries(filterInputs).map(([key, value]) => [key, String(value || '').trim()]));
    setFilters(next); void loadDocuments(1, next);
  }, [filterInputs, loadDocuments]);

  // 추가 (ribbon) = same as 출고등록: leave a saved document for a new one, then pick current stock.
  const openStockPicker = useCallback(() => {
    if (saving) return;
    // Cancel a document still loading so its late response cannot replace the new draft.
    if (openRequestRef.current.controller) {
      openRequestRef.current.controller.abort();
      openRequestRef.current = { id: openRequestRef.current.id + 1, controller: null };
      setOpeningReceiptno('');
      setLoading(false);
    }
    if (selectedReceiptno) resetDraft();
    setStockOpen(true);
  }, [saving, selectedReceiptno, resetDraft]);

  const selectDocument = useCallback(async (receiptno) => {
    openRequestRef.current.controller?.abort();
    const controller = new AbortController();
    const requestId = openRequestRef.current.id + 1;
    openRequestRef.current = { id: requestId, controller };
    const isLatest = () => openRequestRef.current.id === requestId;
    setOpeningReceiptno(receiptno);
    setLoading(true);
    try {
      const { data } = await axios.get(`/api/inoutmove-register/documents/${encodeURIComponent(receiptno)}`, { ...auth(), signal: controller.signal });
      // A newer click superseded this request: drop the stale response.
      if (!isLatest()) return;
      const document = data.document;
      setSelectedReceiptno(document.receiptno);
      setHeader({ receptdate: String(document.receptdate).slice(0, 10), fromwarehousecode: document.fromwarehousecode, towarehousecode: document.towarehousecode, manager: document.manager || '', description: document.description || '' });
      setItems(document.items || []); setSelectedIds([]);
    } catch (error) {
      if (isLatest()) notifications.show({ title: '재고이전 상세 조회 실패', message: error.response?.data?.detail || '전표 상세를 불러오지 못했습니다.', color: 'red' });
    } finally {
      if (isLatest()) {
        openRequestRef.current.controller = null;
        setOpeningReceiptno('');
        setLoading(false);
      }
    }
  }, []);

  const applyStocks = (stocks) => {
    if (!stocks.length) return;
    const sourceWarehouseCodes = [...new Set(stocks.map((row) => row.warehousecode).filter(Boolean))];
    if (sourceWarehouseCodes.length !== 1) {
      notifications.show({ title: '출고 창고 확인', message: '한 전표에는 같은 출고 창고의 재고만 선택해 주세요.', color: 'orange' });
      return;
    }
    const selectedSourceCode = sourceWarehouseCodes[0];
    const existingSourceCode = header.fromwarehousecode || items[0]?.warehousecode;
    if (existingSourceCode && existingSourceCode !== selectedSourceCode) {
      notifications.show({ title: '출고 창고 확인', message: '이미 추가한 재고와 같은 출고 창고의 재고를 선택해 주세요.', color: 'orange' });
      return;
    }
    const existing = new Set(items.map(sourceKey));
    const additions = stocks.filter((row) => !existing.has(sourceKey(row)));
    if (additions.length !== stocks.length) notifications.show({ title: '현재고 확인', message: '이미 상세에 추가한 재고는 제외했습니다.', color: 'orange' });
    setHeader((current) => ({ ...current, fromwarehousecode: selectedSourceCode }));
    setItems((current) => [...current, ...additions.map((row) => ({
      ...row,
      qty: Number(row.qty || 0),
      weight: Number(row.weight || 0),
    }))]);
    setStockOpen(false);
  };

  const saveDocument = useCallback(async () => {
    if (!header.fromwarehousecode || !header.towarehousecode || !header.receptdate || !items.length) {
      notifications.show({ title: '필수 항목 확인', message: '이전일자와 현재고를 선택하고 입고 창고를 지정해 주세요.', color: 'orange' }); return;
    }
    if (header.fromwarehousecode === header.towarehousecode) {
      notifications.show({ title: '창고 확인', message: '출발 창고와 도착 창고는 달라야 합니다.', color: 'orange' }); return;
    }
    const invalidItem = items.find((row) => !Number.isFinite(Number(row.qty)) || Number(row.qty) <= 0);
    if (invalidItem) {
      notifications.show({ title: '이전 수량 확인', message: `${invalidItem.itemname}의 이전 수량을 현재고 이내로 입력해 주세요.`, color: 'orange' }); return;
    }
    setSaving(true);
    try {
      const payload = {
        ...header,
        manager: managerInputRef.current?.value ?? header.manager,
        description: descriptionInputRef.current?.value ?? header.description,
        items: items.map((row) => ({ stocksourcetype: row.stocksourcetype, stocksourceno: row.stocksourceno, stocksourceline: row.stocksourceline, qty: Number(row.qty) })),
      };
      const { data } = await axios.post('/api/inoutmove-register/documents', payload, auth());
      notifications.show({ title: '재고이전 저장 완료', message: `${data.receiptno} 전표로 저장했습니다.`, color: 'teal' });
      setFilters(emptyFilters()); setFilterInputs(emptyFilters());
      await loadDocuments(1, emptyFilters()); await selectDocument(data.receiptno);
    } catch (error) { notifications.show({ title: '재고이전 저장 실패', message: error.response?.data?.detail || '저장에 실패했습니다. 변경 사항은 모두 취소했습니다.', color: 'red' }); }
    finally { setSaving(false); }
  }, [header, items, loadDocuments, selectDocument]);

  const deleteDocument = async () => {
    if (!selectedReceiptno) { setItems((current) => current.filter((row) => !selectedSet.has(sourceKey(row)))); setSelectedIds([]); setDeleteOpen(false); return; }
    setSaving(true);
    try {
      await axios.delete(`/api/inoutmove-register/documents/${encodeURIComponent(selectedReceiptno)}`, auth());
      notifications.show({ title: '재고이전 삭제 완료', message: `${selectedReceiptno} 전표를 삭제하고 창고를 원래대로 되돌렸습니다.`, color: 'teal' });
      setDeleteOpen(false); resetDraft(); await loadDocuments(1, filters);
    } catch (error) { notifications.show({ title: '재고이전 삭제 실패', message: error.response?.data?.detail || '전표를 삭제하지 못했습니다.', color: 'red' }); }
    finally { setSaving(false); }
  };

  const requestDelete = useCallback(() => {
    if (!selectedReceiptno && !selectedIds.length) { notifications.show({ title: '삭제할 항목 선택', message: '상세 행을 선택하거나 이전 전표를 조회해 주세요.', color: 'orange' }); return; }
    if (!selectedReceiptno) {
      const deleteCount = selectedIds.length;
      setItems((current) => current.filter((row) => !selectedSet.has(sourceKey(row))));
      setSelectedIds([]);
      if (!items.some((row) => !selectedSet.has(sourceKey(row)))) {
        setHeader((current) => ({ ...current, fromwarehousecode: '' }));
      }
      notifications.show({ title: '선택 삭제 완료', message: `선택한 ${deleteCount}개 재고 행을 삭제했습니다.`, color: 'teal' });
      return;
    }
    setDeleteOpen(true);
  }, [selectedReceiptno, selectedIds, selectedSet, items]);

  const exportDocument = useCallback(() => {
    const exportRows = items.map((row, index) => ({
      순번: index + 1,
      재고구분: row.stocksourcetype === 'OPENING' ? '기초' : row.stocksourcetype === 'PROCESS' ? '가공' : '입고',
      원천전표번호: row.stocksourceno,
      원천순번: row.stocksourceline,
      품명: row.itemname,
      제품명: row.productname,
      강종: row.materialname || '',
      표면: row.surfacename || '',
      두께: row.thickness,
      폭: row.width,
      길이: row.length,
      수량: row.qty,
      수량단위: row.qtyunit,
      '중량(KG)': row.weight,
      출발창고: row.fromwarehousename || fromWarehouse,
      도착창고: row.towarehousename || toWarehouse,
      등록일자: formatExcelDateTime(row.created_at),
      수정일자: formatExcelDateTime(row.updated_at),
      등록자: row.created_by || '',
      수정자: row.updated_by || '',
    }));
    if (!exportRows.length) {
      notifications.show({ title: '엑셀 다운로드', message: '다운로드할 재고이전 상세가 없습니다.', color: 'orange' });
      return;
    }
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    applyExcelHeaderStyle(worksheet, Object.keys(exportRows[0] || {}).length);
    XLSX.utils.book_append_sheet(workbook, worksheet, '재고이동상세');
    // Same naming as the other downloads: <name>_YYYYMMDD (local date).
    XLSX.writeFile(workbook, `재고이동_${today().replaceAll('-', '')}.xlsx`);
  }, [items, fromWarehouse, toWarehouse]);

  useEffect(() => {
    if (!pageLayout?.registerPageRibbon) return undefined;
    pageLayout.registerPageRibbon(<Group className={inboundClasses.commandRibbon} justify="flex-start" wrap="nowrap" gap={2}>
      <Button className={inboundClasses.ribbonTool} variant="subtle" size="sm" leftSection={<IconSearch size={15} />} onClick={runSearch} loading={loading}>조회</Button>
      <span className={inboundClasses.ribbonSeparator} />
      <Button className={inboundClasses.ribbonTool} variant="subtle" size="sm" leftSection={<IconPlus size={15} />} onClick={openStockPicker} disabled={saving}>추가</Button>
      <Button className={inboundClasses.ribbonTool} variant="subtle" size="sm" leftSection={<IconCopy size={15} />} disabled>복사</Button>
      <Button className={inboundClasses.ribbonTool} variant="subtle" size="sm" leftSection={<IconFileSpreadsheet size={15} />} onClick={exportDocument} disabled={!items.length}>엑셀</Button>
      <Button className={inboundClasses.ribbonTool} variant="subtle" size="sm" leftSection={<IconDeviceFloppy size={15} />} onClick={saveDocument} loading={saving} disabled={readOnly || !items.length}>저장</Button>
      <Button className={inboundClasses.ribbonTool} variant="subtle" size="sm" leftSection={<IconTrash size={15} />} onClick={requestDelete} disabled={saving || (!selectedReceiptno && !selectedIds.length)}>삭제</Button>
      <span className={inboundClasses.ribbonSeparator} />
      <Button className={inboundClasses.ribbonTool} variant="subtle" size="sm" leftSection={<IconX size={15} />} onClick={pageLayout.closeActivePage}>닫기</Button>
    </Group>);
    return () => pageLayout.registerPageRibbon(null);
  }, [pageLayout, runSearch, loading, openStockPicker, saving, readOnly, items.length, requestDelete, selectedReceiptno, selectedIds.length, exportDocument, saveDocument]);

  // Both tables are memoized: Mantine <Table> hands every Table.Td a fresh context value on
  // each render, so otherwise every loading/highlight toggle while opening a document
  // re-rendered all list and detail cells.
  const highlightedReceiptno = openingReceiptno || selectedReceiptno;
  const documentListTable = useMemo(() => (
    <Table stickyHeader withTableBorder withColumnBorders className={`${classes.table} ${classes.listTable}`}
      style={{ width: `max(100%, ${listTableWidth}px)`, minWidth: `${listTableWidth}px`, tableLayout: 'fixed' }}>
      <colgroup>{LIST_COLUMNS.map((column) => <col key={column.key} data-column-key={column.key} style={{ width: `${listColumnWidths[column.key] ?? column.width}px` }} />)}</colgroup>
      <Table.Thead><Table.Tr>{LIST_COLUMNS.map((column) => <Table.Th key={column.key} className={codeClasses.resizableHeader} style={{ position: 'relative', width: listColumnWidths[column.key] ?? column.width }}>
        <span style={{ whiteSpace: 'nowrap' }}>{column.label}</span><span className={codeClasses.columnResizeHandle} onPointerDown={(event) => resizeGridColumn(event, column, listColumnWidths, setListColumnWidths, LIST_COLUMNS, true)} role="separator" aria-label={`${column.label} 열 너비 조절`} />
      </Table.Th>)}</Table.Tr></Table.Thead>
      {!!documents.length && <Table.Tbody>{documents.map((row) => <Table.Tr key={row.receiptno} onClick={() => void selectDocument(row.receiptno)} className={`${classes.clickableRow} ${row.receiptno === highlightedReceiptno ? classes.receiptFinderRowActive : ''}`}>
        <Table.Td>{String(row.receptdate).slice(0, 10)}</Table.Td><Table.Td>{row.fromwarehousename}</Table.Td><Table.Td>{row.towarehousename}</Table.Td>
        <Table.Td ta="right">{number(row.line_count)}</Table.Td><Table.Td ta="right">{number(row.total_qty)}</Table.Td><Table.Td ta="right">{number(row.total_weight)}</Table.Td>
        <Table.Td>{row.manager}</Table.Td><Table.Td>{row.receiptno}</Table.Td><Table.Td className={classes.ellipsis}>{row.description}</Table.Td>
      </Table.Tr>)}</Table.Tbody>}
    </Table>
  ), [documents, highlightedReceiptno, listColumnWidths, listTableWidth, resizeGridColumn, selectDocument]);
  const detailTable = useMemo(() => (
    <Table stickyHeader withTableBorder withColumnBorders className={`${sharedClasses.table} ${classes.table} ${classes.detailTable}`}
      style={{ width: `max(100%, ${detailTableWidth}px)`, minWidth: `${detailTableWidth}px`, tableLayout: 'fixed' }}>
      <colgroup>{DETAIL_COLUMNS.map((column) => <col key={column.key} data-column-key={column.key} style={{ width: `${detailColumnWidths[column.key] ?? column.width}px` }} />)}</colgroup>
      <Table.Thead><Table.Tr>{DETAIL_COLUMNS.map((column) => <Table.Th key={column.key} className={column.key === 'select' ? `${codeClasses.checkCol} ${classes.checkCell}` : codeClasses.resizableHeader} style={{ position: 'relative', width: detailColumnWidths[column.key] ?? column.width }}>
        {column.key === 'select' ? <input type="checkbox" checked={items.length > 0 && selectedIds.length === items.length} onChange={(event) => setSelectedIds(event.currentTarget.checked ? items.map(sourceKey) : [])} disabled={readOnly || !items.length} /> : <span style={{ whiteSpace: 'nowrap' }}>{column.label}</span>}
        {column.key !== 'select' && <span className={codeClasses.columnResizeHandle} onPointerDown={(event) => resizeGridColumn(event, column, detailColumnWidths, setDetailColumnWidths, DETAIL_COLUMNS)} role="separator" aria-label={`${column.label} 열 너비 조절`} />}
      </Table.Th>)}</Table.Tr></Table.Thead>
      {!!items.length && <Table.Tbody>{items.map((row, index) => <Table.Tr key={sourceKey(row)} className={readOnly ? classes.savedRow : selectedSet.has(sourceKey(row)) ? classes.selectedRow : ''}>
        <Table.Td className={`${codeClasses.checkCol} ${classes.checkCell}`}><input type="checkbox" checked={selectedSet.has(sourceKey(row))} disabled={readOnly} onChange={(event) => { const { checked: nextChecked } = event.currentTarget; setSelectedIds((current) => nextChecked ? [...current, sourceKey(row)] : current.filter((key) => key !== sourceKey(row))); }} /></Table.Td>
        <Table.Td>{index + 1}</Table.Td><Table.Td>이동</Table.Td>
        <Table.Td>{String(header.receptdate || '').slice(0, 10)}</Table.Td><Table.Td>{row.fromwarehousename || fromWarehouse}</Table.Td><Table.Td>{row.towarehousename || toWarehouse}</Table.Td>
        <Table.Td>{row.itemname}</Table.Td><Table.Td>{row.productname}</Table.Td><Table.Td>{row.materialname || row.myrtle || ''}</Table.Td>
        <Table.Td ta="right">{number(row.thickness)}</Table.Td><Table.Td ta="right">{number(row.width)}</Table.Td><Table.Td ta="right">{number(row.length)}</Table.Td>
        <Table.Td ta="right">{number(row.qty)}</Table.Td>
        <Table.Td>{row.qtyunit}</Table.Td><Table.Td ta="right">{number(row.weight)}</Table.Td>
        <Table.Td>{row.sourcecustomname || row.customname || ''}</Table.Td>
        <Table.Td>{String(row.sourcereceiptdate || row.receiptdate || '').slice(0, 10)}</Table.Td>
        <Table.Td>{stockSourceTypeName(row.stocksourcetype, row.stocksourceno)}</Table.Td>
        <Table.Td>{row.stocksourceno}</Table.Td><Table.Td ta="right">{number(row.stocksourceline)}</Table.Td>
      </Table.Tr>)}</Table.Tbody>}
    </Table>
  ), [items, selectedIds, selectedSet, readOnly, header.receptdate, fromWarehouse, toWarehouse, detailColumnWidths, detailTableWidth, resizeGridColumn]);

  const updateHeader = (field, value) => setHeader((current) => ({ ...current, [field]: value || '' }));
  return <Box className={`${sharedClasses.pageShell} ${classes.page}`}>
    <Box component="nav" aria-label="현재 위치" className={inboundClasses.pageBreadcrumb}>
      <Group className={inboundClasses.breadcrumbTrail} gap={7}>
        <Text component="span" className={inboundClasses.breadcrumbParent}>재고관리</Text>
        <Text component="span" className={inboundClasses.breadcrumbChevron}>›</Text>
        <Text component="span" className={inboundClasses.breadcrumbCurrent}>재고이동 등록</Text>
      </Group>
      {!filterOpen && <Button className={inboundClasses.receiptFilterToggle} variant="subtle" size="xs" leftSection={<IconSearch size={15} />} onClick={() => setFilterOpen(true)}>조회조건</Button>}
    </Box>
    <Box className={`${inboundClasses.inboundWorkspace} ${classes.outboundWorkspace}`}>
      <Box className={`${inboundClasses.inboundPrimaryColumn} ${classes.outboundPrimaryColumn}`}>
        <Paper className={`${sharedClasses.panel} ${inboundClasses.topReceiptPanel} ${classes.listPanel}`} withBorder>
          <Group className={inboundClasses.topReceiptToolbar} justify="space-between" wrap="wrap">
            <Group gap={8}><Text className={inboundClasses.sectionTitle} fw={700}>재고이전 기본</Text><span className={classes.count}>{total.toLocaleString()}건</span></Group>
            <Text size="xs" c="dimmed">재고이전 전표를 선택하면 상세 내용을 확인할 수 있습니다.</Text>
          </Group>
          <Box ref={listViewportRef} className={classes.listViewport}>
            {documentListTable}
            {!documents.length && <Box className={inboundClasses.topReceiptEmptyMessage}>{loading ? '조회 중입니다.' : '조회된 재고이전 전표가 없습니다.'}</Box>}
          </Box>
          <Box ref={listHorizontalRef} className={inboundClasses.topReceiptHorizontalScroll} onScroll={(event) => {
            const viewport = listViewportRef.current;
            if (viewport && Math.abs(viewport.scrollLeft - event.currentTarget.scrollLeft) > 0.5) {
              viewport.scrollLeft = event.currentTarget.scrollLeft;
            }
          }} aria-label="재고이전 기본 가로 스크롤">
            <Box className={inboundClasses.topReceiptHorizontalContent} style={{ width: `max(100%, ${listTableWidth}px)` }} />
          </Box>
          <Group className={inboundClasses.topReceiptPagination} justify="space-between">
            <Group className={inboundClasses.topReceiptPageSize} gap="xs">
              <Select aria-label="페이지당 표시 건수" data={PAGE_SIZE_OPTIONS} value={String(pageSize)} w={100} size="xs"
                onChange={(value) => { if (value) { const nextPageSize = Number(value); setPageSize(nextPageSize); void loadDocuments(1, filters, nextPageSize); } }} />
            </Group>
            <Pagination size="sm" color="red" total={Math.max(1, Math.ceil(total / pageSize))} value={page} onChange={(value) => void loadDocuments(value)} withEdges disabled={loading || !total} />
          </Group>
        </Paper>

        <Box className={inboundClasses.workspace}>
          <Paper className={`${sharedClasses.panel} ${codeClasses.codePanel} ${classes.editorPanel}`} withBorder>
            <Group className={codeClasses.codeHeader} justify="space-between" align="center" wrap="wrap" gap="sm">
              <Group gap={9} align="center"><Text className={inboundClasses.sectionTitle} fw={700}>재고이전 상세</Text><span className={classes.count}>{selectedReceiptno || `신규 · ${items.length}건`}</span></Group>
              <Group gap={8} align="center"><Text size="xs" fw={700} c="dimmed">총 수량 {number(totals.qty)} · 총 중량 {number(totals.weight)} KG</Text></Group>
            </Group>
            <Box className={inboundClasses.sharedReceiptFields}>
              <Box className={inboundClasses.sharedReceiptField}><Text size="xs" fw={700} mb={4}>이전일자 *</Text><ErpDateInput type="date" value={header.receptdate} disabled={readOnly} onChange={(event) => updateHeader('receptdate', event.currentTarget.value)} /></Box>
              <Box className={inboundClasses.sharedReceiptField}><Text size="xs" fw={700} mb={4}>출고 창고 *</Text><Select data={warehouseData} value={header.fromwarehousecode || null} disabled searchable /></Box>
              <Box className={inboundClasses.sharedReceiptField}><Text size="xs" fw={700} mb={4}>입고 창고 *</Text><Select data={warehouseData} value={header.towarehousecode || null} disabled={readOnly || !items.length} searchable onChange={(value) => updateHeader('towarehousecode', value)} /></Box>
              <Box className={inboundClasses.sharedReceiptField}><Text size="xs" fw={700} mb={4}>담당자</Text><HeaderTextInput value={header.manager} disabled={readOnly} inputRef={managerInputRef} onCommit={(value) => updateHeader('manager', value)} /></Box>
              <Box className={inboundClasses.sharedReceiptField}><Text size="xs" fw={700} mb={4}>비고</Text><HeaderTextInput value={header.description} disabled={readOnly} inputRef={descriptionInputRef} onCommit={(value) => updateHeader('description', value)} /></Box>
            </Box>
            <Box className={`${codeClasses.tableWrap} ${classes.detailViewport}`}>
              {detailTable}
              {!items.length && <Box className={inboundClasses.emptyDetailMessage}>{readOnly ? '상세 재고가 없습니다.' : '조회조건의 현재고 조회에서 이전할 재고를 선택하세요.'}</Box>}
            </Box>
            <Group className={`${sharedClasses.footer} ${codeClasses.tableFooter}`} justify="flex-end" wrap="wrap"><Text size="xs" fw={700}>총 수량 {items.length ? `${number(totals.qty)} ${[...new Set(items.map((row) => row.qtyunit).filter(Boolean))].join(', ')}` : '0'} · 총 중량 {items.length ? `${number(totals.weight)} KG` : '0'}</Text></Group>
          </Paper>
        </Box>
      </Box>
      {filterOpen && <Paper component="aside" className={`${inboundClasses.receiptFilterSidebar} ${classes.outboundFilterSidebar}`} withBorder>
        <Group className={inboundClasses.receiptFilterHeader} justify="space-between" align="center"><Text fw={700}>조회조건</Text><ActionIcon variant="subtle" color="gray" aria-label="조회조건 닫기" onClick={() => setFilterOpen(false)}><IconX size={16} /></ActionIcon></Group>
        <Stack gap="sm" className={inboundClasses.receiptFilterFields}>
          <Box><Text size="xs" fw={700} mb={5}>이전기간</Text><Stack gap={6}><ErpDateInput type="date" aria-label="이전기간 시작" value={filterInputs.date_from} onChange={(event) => { const { value: nextValue } = event.currentTarget; setFilterInputs((v) => ({ ...v, date_from: nextValue })); }} /><ErpDateInput type="date" aria-label="이전기간 종료" value={filterInputs.date_to} onChange={(event) => { const { value: nextValue } = event.currentTarget; setFilterInputs((v) => ({ ...v, date_to: nextValue })); }} /></Stack></Box>
          <TextInput label="재고이전전표" placeholder="전표번호" value={filterInputs.receiptno} onChange={(event) => { const { value: nextValue } = event.currentTarget; setFilterInputs((v) => ({ ...v, receiptno: nextValue })); }} onKeyDown={(event) => event.key === 'Enter' && runSearch()} />
          <TextInput label="창고" placeholder="출발 또는 도착 창고명" value={filterInputs.warehouse} onChange={(event) => { const { value: nextValue } = event.currentTarget; setFilterInputs((v) => ({ ...v, warehouse: nextValue })); }} onKeyDown={(event) => event.key === 'Enter' && runSearch()} />
        </Stack>
        <Box className={outboundClasses.outboundStockLookup}>
          <Text fw={700} size="sm">재고 조회</Text>
          <Text size="xs" c="dimmed">재고를 선택한 뒤 상세에서 입고 창고를 지정합니다.</Text>
          <Button fullWidth color="red" leftSection={<IconSearch size={15} />} onClick={openStockPicker} disabled={saving}>
            현재고 조회
          </Button>
        </Box>
      </Paper>}
    </Box>
    <Modal opened={deleteOpen} onClose={() => !saving && setDeleteOpen(false)} title="재고이전 삭제" centered size="sm"><Stack gap="md"><Text size="sm" c="dimmed">{selectedReceiptno ? `${selectedReceiptno} 전표를 삭제하고 원래 창고로 되돌립니다.` : '선택한 상세 행을 삭제합니다.'}</Text><Group justify="flex-end"><Button variant="default" onClick={() => setDeleteOpen(false)} disabled={saving}>취소</Button><Button color="red" leftSection={<IconTrash size={15} />} onClick={() => void deleteDocument()} loading={saving}>삭제</Button></Group></Stack></Modal>
    <StockPicker opened={stockOpen} fromWarehouse={fromWarehouse} toWarehouse={toWarehouse} existingKeys={new Set(items.map(sourceKey))} onClose={() => setStockOpen(false)} onApply={applyStocks} />
  </Box>;
}
