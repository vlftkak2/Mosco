import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import * as XLSX from 'xlsx-js-style';
import {
  ActionIcon, Badge, Box, Button, Group, Loader, Modal, Pagination, Paper,
  ScrollArea, Stack, Table, Text, TextInput, Title, Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconDeviceFloppy, IconDownload, IconPlus, IconSearch, IconTrash, IconUpload } from '@tabler/icons-react';
import { TableVirtuoso } from 'react-virtuoso';
import dashboardClasses from '../styles/pages/HomePage.module.css';
import sharedClasses from '../styles/pages/ManagementShared.module.css';
import codeClasses from '../styles/pages/CodeMasterPage.module.css';
import outboundClasses from '../styles/pages/OutboundRegister.module.css';
import classes from '../styles/pages/StockStand.module.css';
import { applyExcelHeaderStyle } from '../utils/excelHeaderStyle';

const STOCK_EXCEL_COLUMNS = [
  ['itemcode', '품목코드'], ['itemname', '품목명'], ['size', '규격'], ['qty', '기초수량'],
  ['qtyunit', '수량단위코드'], ['weight', '기초중량'], ['warehousecode', '창고코드'],
  ['warehousecodename', '창고명'], ['unit', '단가기준'], ['unitprice', '기초단가'],
  ['unitamt', '기초금액'], ['description', '비고'],
];
const GRID_FIELDS = ['itemcode', 'itemname', 'size', 'qty', 'qtyunit', 'warehousecode', 'weight', 'unit', 'unitprice', 'unitamt', 'description'];
const GRID_COLUMN_WIDTHS = { select: 44, number: 58, itemcode: 150, itemname: 180, size: 125, qty: 115, qtyunit: 110, warehousecode: 120, weight: 135, unit: 115, unitprice: 125, unitamt: 125, description: 180, action: 58 };
const MASTER_FIELDS = new Set(['qtyunit', 'warehousecode', 'unit']);
const PRICE_FIELDS = new Set(['unit', 'unitprice', 'unitamt']);
const EDITABLE_PRICE_FIELDS = new Set(['unit', 'unitprice']);
const MASTER_KIND = { qtyunit: 'quantity', warehousecode: 'warehouse', unit: 'price' };
const MASTER_TITLE = { qtyunit: '수량단위 선택', warehousecode: '창고 선택', unit: '단가기준 선택' };

const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });
const localDate = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};
const makeRow = (values = {}) => ({
  id: values.lineno ? `saved-${values.lineno}` : `new-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  isNew: !values.lineno,
  lineno: values.lineno ?? null,
  itemcode: values.itemcode || '', itemname: values.itemname || '', size: values.size || '',
  qty: values.qty == null ? '' : String(values.qty), qtyunit: values.qtyunit || '',
  weight: values.weight == null ? '' : String(values.weight),
  warehousecode: values.warehousecode || '', warehousecodename: values.warehousecodename || '',
  unit: values.unit || '', unitprice: values.unitprice == null ? '' : String(values.unitprice),
  unitamt: values.unitamt == null ? '' : String(values.unitamt), description: values.description || '',
  has_movements: Boolean(values.has_movements),
});
const cleanNumber = (value) => String(value ?? '').replace(/,/g, '').replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1');
const numberText = (value) => {
  const raw = cleanNumber(value);
  if (!raw) return '';
  const [integer, ...decimal] = raw.split('.');
  const grouped = (integer || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return decimal.length ? `${grouped}.${decimal.join('')}` : grouped;
};
const calculateAmount = (row, priceOptions) => {
  if (!String(row.weight ?? '').trim() || !String(row.unitprice ?? '').trim()) return '';
  const weight = Number(row.weight);
  const unitprice = Number(row.unitprice);
  if (!Number.isFinite(weight) || !Number.isFinite(unitprice)) return '';
  const unitName = priceOptions.find((option) => option.code === row.unit)?.name || '';
  const unitToken = `${row.unit || ''} ${unitName}`.toLocaleUpperCase();
  const quantity = /TON|\uD1A4/.test(unitToken) ? weight / 1000 : weight;
  return (quantity * unitprice).toFixed(2);
};
const formatAmount = (value) => {
  const amount = Number(value);
  if (value === '' || !Number.isFinite(amount)) return '';
  return amount.toLocaleString(undefined, {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  });
};
const resolveMasterCode = (field, value, masters) => {
  const text = String(value ?? '').trim().toLocaleLowerCase();
  if (!text) return '';
  const options = masters[MASTER_KIND[field]] || [];
  return options.find((option) => String(option.code).trim().toLocaleLowerCase() === text
    || String(option.name).trim().toLocaleLowerCase() === text
    || `${String(option.code).trim()} - ${String(option.name).trim()}`.toLocaleLowerCase() === text)?.code || '';
};
const errorText = (error) => {
  const detail = error.response?.data?.detail;
  if (Array.isArray(detail)) return detail.slice(0, 5).map((item) => item.msg || String(item)).join(' / ');
  return detail || error.message || '요청을 처리하지 못했습니다.';
};

const StockVirtualRow = ({ item, className, ...props }) => (
  <Table.Tr {...props} className={[className, !item?.lineno && codeClasses.newRow, !item?.lineno && classes.newRow].filter(Boolean).join(' ')} />
);

const stockVirtuosoComponents = {
  Table: ({ style, ...props }) => (
    <Table
      {...props}
      className={`${sharedClasses.table} ${codeClasses.codeTable} ${classes.table}`}
      highlightOnHover
      withTableBorder
      withColumnBorders
      verticalSpacing="xs"
      horizontalSpacing={0}
      style={{ ...style, width: '100%', tableLayout: 'fixed' }}
    />
  ),
  TableHead: Table.Thead,
  TableBody: Table.Tbody,
  TableRow: StockVirtualRow,
};

function ItemPicker({ opened, onClose, onSelect }) {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const requestKey = `${query}\u0000${page}`;
  const [completedRequestKey, setCompletedRequestKey] = useState('');
  const loading = opened && completedRequestKey !== requestKey;
  const pageSize = 20;

  useEffect(() => {
    if (!opened) return undefined;
    let alive = true;
    axios.get('/api/item-master/items/picker', { ...authConfig(), params: { q: query, page, page_size: pageSize } })
      .then(({ data }) => {
        if (!alive) return;
        setItems(data.items || []);
        setTotal(data.total || 0);
      })
      .catch((error) => { if (alive) notifications.show({ title: '품목 조회 실패', message: errorText(error), color: 'red' }); })
      .finally(() => { if (alive) setCompletedRequestKey(requestKey); });
    return () => { alive = false; };
  }, [opened, query, page, requestKey]);

  const search = () => { setPage(1); setQuery(input.trim()); };
  return <Modal
    opened={opened}
    onClose={onClose}
    title={<Group gap={9} wrap="nowrap"><Box className={outboundClasses.receiptFinderTitleIcon}><IconSearch size={17} /></Box><Text fw={750}>품목 선택</Text></Group>}
    classNames={{ content: outboundClasses.receiptFinderModalContent, header: outboundClasses.receiptFinderModalHeader, title: outboundClasses.receiptFinderModalTitle, close: outboundClasses.receiptFinderModalClose }}
    centered
    size={900}
  >
    <Stack gap="sm" pt={10}>
      <Group gap={7} wrap="nowrap">
        <TextInput className={outboundClasses.customerSearchInput} value={input} onChange={(event) => setInput(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === 'Enter') search(); }} placeholder="품목코드, 품목명 또는 형태구분 검색" leftSection={<IconSearch size={15} />} size="sm" autoFocus />
        <Button color="red" size="sm" leftSection={<IconSearch size={15} />} onClick={search}>조회</Button>
      </Group>
      <Box className={outboundClasses.pickerResults}>
        {loading && <Loader className={outboundClasses.pickerLoader} size="xs" color="red" />}
        <ScrollArea h={420} type="auto">
          <Table className={`${codeClasses.codeTable} ${outboundClasses.pickerTable}`} highlightOnHover withTableBorder withColumnBorders>
            <Table.Thead><Table.Tr><Table.Th className={outboundClasses.customerCodeColumn}>품목코드</Table.Th><Table.Th className={outboundClasses.customerNameColumn}>품목명</Table.Th><Table.Th className={outboundClasses.customerBusinessColumn}>형태구분</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>{items.map((item) => <Table.Tr key={item.itemcode} className={outboundClasses.customerResultRow} onClick={() => { onSelect(item); onClose(); }}>
              <Table.Td>{item.itemcode}</Table.Td><Table.Td>{item.itemname}</Table.Td><Table.Td>{item.itemtypecode || '-'}</Table.Td>
            </Table.Tr>)}</Table.Tbody>
          </Table>
        </ScrollArea>
      </Box>
      <Group justify="space-between"><Text size="xs" c="dimmed">총 {total.toLocaleString()}개 품목</Text><Pagination size="sm" total={Math.max(1, Math.ceil(total / pageSize))} value={page} onChange={setPage} withEdges color="red" /></Group>
    </Stack>
  </Modal>;
}

function StockMasterPicker({ opened, title, options, onClose, onSelect }) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return query ? options.filter((option) => `${option.code} ${option.name}`.toLocaleLowerCase().includes(query)) : options;
  }, [options, search]);
  const pageSize = 20;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);

  return <Modal
    opened={opened}
    onClose={onClose}
    title={<Group gap={9} wrap="nowrap"><Box className={outboundClasses.receiptFinderTitleIcon}><IconSearch size={17} /></Box><Text fw={750}>{title}</Text></Group>}
    classNames={{ content: outboundClasses.receiptFinderModalContent, header: outboundClasses.receiptFinderModalHeader, title: outboundClasses.receiptFinderModalTitle, close: outboundClasses.receiptFinderModalClose }}
    centered
    size="md"
  >
    <Stack gap="sm" pt={10}>
      <TextInput value={search} onChange={(event) => { setSearch(event.currentTarget.value); setPage(1); }} placeholder="코드 또는 코드명 검색" leftSection={<IconSearch size={15} />} autoFocus />
      <ScrollArea h={360} type="auto">
          <Table className={`${codeClasses.codeTable} ${outboundClasses.pickerTable}`} highlightOnHover withTableBorder withColumnBorders>
            <Table.Thead><Table.Tr><Table.Th>코드</Table.Th><Table.Th>코드명</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>
              {visible.map((option) => <Table.Tr key={option.code} className={outboundClasses.customerResultRow} onClick={() => onSelect(option)}>
                <Table.Td>{option.code}</Table.Td><Table.Td>{option.name}</Table.Td>
              </Table.Tr>)}
              {!visible.length && <Table.Tr><Table.Td colSpan={2} className={outboundClasses.customerEmpty}>조회된 사용중 코드가 없습니다.</Table.Td></Table.Tr>}
            </Table.Tbody>
          </Table>
      </ScrollArea>
      <Group justify="space-between"><Text size="xs" c="dimmed">총 {filtered.length.toLocaleString()}개 코드</Text><Pagination size="sm" total={pageCount} value={page} onChange={setPage} withEdges color="red" /></Group>
    </Stack>
  </Modal>;
}

export default function StockStandPage() {
  const [standdate, setStanddate] = useState(localDate);
  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [masters, setMasters] = useState({ quantity: [], warehouse: [], price: [] });
  const [hasSavedStock, setHasSavedStock] = useState(false);
  const [hasTransactions, setHasTransactions] = useState(false);
  const [hasStockMovements, setHasStockMovements] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [itemPickerId, setItemPickerId] = useState('');
  const [masterPickerTarget, setMasterPickerTarget] = useState(null);
  const [selectedDeleteOpen, setSelectedDeleteOpen] = useState(false);
  const [columnWidths, setColumnWidths] = useState({});
  const uploadInputRef = useRef(null);
  const virtuosoRef = useRef(null);
  const cellInputRefs = useRef(new Map());
  const pendingCellFocusRef = useRef(null);
  const originalRowsRef = useRef(new Map());
  const activeCellRef = useRef(null);
  const selectionAnchorRef = useRef('');
  const hasNewRows = rows.some((row) => !row.lineno);
  const changedPriceRows = rows.filter((row) => {
    if (!row.lineno) return false;
    const original = originalRowsRef.current.get(row.id);
    return original && [...EDITABLE_PRICE_FIELDS].some((field) => String(row[field] ?? '') !== String(original[field] ?? ''));
  });
  const hasChanges = hasNewRows || changedPriceRows.length > 0;
  const registrationBlockMessage = hasSavedStock
    ? '이 회사의 기초재고는 이미 등록되어 추가할 수 없습니다.'
    : hasTransactions
      ? '입고 또는 출고 수불 이력이 있어 기초재고를 등록할 수 없습니다.'
      : '';
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const resizeColumn = useCallback((event, key, defaultWidth, minWidth, totalWidth) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = columnWidths[key] ?? defaultWidth;
    const root = event.currentTarget.closest(`.${codeClasses.tableWrap}`);
    const header = event.currentTarget.parentElement;
    let nextWidth = startWidth;
    const move = (pointerEvent) => {
      nextWidth = Math.max(minWidth, Math.min(1600, startWidth + pointerEvent.clientX - startX));
      if (header) header.style.width = `${nextWidth}px`;
      root?.style.setProperty('--code-table-min-width', `${Math.max(1730, totalWidth + nextWidth - startWidth)}px`);
    };
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      setColumnWidths((current) => ({ ...current, [key]: nextWidth }));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  }, [columnWidths]);

  const loadRows = useCallback(async (nextDate = standdate, nextQuery = query, confirmDiscard = true) => {
    if (confirmDiscard && hasChanges && !window.confirm('저장하지 않은 변경사항이 있습니다. 조회하면 변경 내용이 사라집니다. 계속할까요?')) return;
    setLoading(true);
    try {
      const { data } = await axios.get('/api/stock-stand/items', { ...authConfig(), params: { standdate: nextDate, q: nextQuery || undefined } });
      const loadedRows = (data.items || []).map((item) => makeRow(item));
      originalRowsRef.current = new Map(loadedRows.filter((row) => row.lineno).map((row) => [row.id, { ...row }]));
      setRows(loadedRows);
      setSelectedIds([]);
      setHasSavedStock(Boolean(data.has_stock_rows));
      setHasTransactions(Boolean(data.has_transactions));
      setHasStockMovements(Boolean(data.has_stock_movements));
    } catch (error) {
      notifications.show({ title: '기초재고 조회 실패', message: errorText(error), color: 'red' });
    } finally { setLoading(false); }
  }, [standdate, query, hasChanges]);

  const loadCodes = useCallback(async (groupcode) => {
    const all = [];
    let page = 1;
    let total = 0;
    do {
      const { data } = await axios.get(`/api/code-master/groups/${groupcode}/items`, { ...authConfig(), params: { page, page_size: 200, include_total: true } });
      all.push(...(data.items || []));
      total = data.total || 0;
      page += 1;
    } while (all.length < total && page <= 100);
    return all.filter((item) => item.use).map((item) => ({ code: item.code, name: item.name }));
  }, []);

  useEffect(() => {
    loadRows(standdate, '', false);
    Promise.all([loadCodes('QTY'), loadCodes('WAREHOUSE'), loadCodes('PRICE_UNIT')])
      .then(([quantity, warehouse, price]) => setMasters({ quantity, warehouse, price }))
      .catch((error) => notifications.show({ title: '기초재고 코드 조회 실패', message: errorText(error), color: 'red' }));
  // Initial load; date changes are explicitly searched to protect edits.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateRow = useCallback((id, key, value) => {
    const applyToSelected = MASTER_FIELDS.has(key) && selectedIds.length > 1 && selectedSet.has(id);
    setRows((current) => current.map((row) => {
      if (row.id !== id && !(applyToSelected && selectedSet.has(row.id))) return row;
      if (row.lineno && !PRICE_FIELDS.has(key)) return row;
      const next = { ...row, [key]: value };
      if (MASTER_FIELDS.has(key)) {
        const code = resolveMasterCode(key, value, masters);
        next[key] = code || value;
        if (key === 'warehousecode') next.warehousecodename = masters.warehouse.find((option) => option.code === code)?.name || '';
      }
      if (['unit', 'weight', 'unitprice'].includes(key)) next.unitamt = calculateAmount(next, masters.price);
      return next;
    }));
  }, [masters, selectedIds.length, selectedSet]);

  const addRow = () => {
    if (hasSavedStock || hasTransactions) {
      notifications.show({
        title: '기초재고를 등록할 수 없습니다',
        message: registrationBlockMessage,
        color: 'orange',
      });
      return;
    }
    const row = makeRow({ qtyunit: resolveMasterCode('qtyunit', 'EA', masters) || 'EA' });
    setRows((current) => [...current, row]);
    setSelectedIds([]);
    selectionAnchorRef.current = '';
    pendingCellFocusRef.current = { key: `${row.id}:itemcode` };
    requestAnimationFrame(() => {
      virtuosoRef.current?.scrollToIndex({ index: rows.length, align: 'end', behavior: 'auto' });
    });
  };
  const selectItem = (id, item) => setRows((current) => current.map((row) => row.id === id ? { ...row, itemcode: item.itemcode, itemname: item.itemname } : row));

  const registerCellInput = useCallback((id, field, element) => {
    const key = `${id}:${field}`;
    if (element) {
      cellInputRefs.current.set(key, element);
      if (pendingCellFocusRef.current?.key === key) {
        element.focus();
        pendingCellFocusRef.current = null;
      }
    } else cellInputRefs.current.delete(key);
  }, []);

  const focusGridCell = useCallback((id, field) => {
    const input = cellInputRefs.current.get(`${id}:${field}`);
    if (input && !input.disabled) { input.focus(); return; }
    const rowIndex = rows.findIndex((row) => row.id === id);
    if (rowIndex < 0) return;
    pendingCellFocusRef.current = { key: `${id}:${field}` };
    virtuosoRef.current?.scrollToIndex({ index: rowIndex, align: 'center', behavior: 'auto' });
  }, [rows]);

  const moveGridCell = useCallback((id, field, rowDelta, columnDelta) => {
    const rowIndex = rows.findIndex((row) => row.id === id);
    if (rowIndex < 0) return false;
    let nextRow = rowIndex;
    let nextColumn = GRID_FIELDS.indexOf(field);
    if (nextColumn < 0) return false;
    nextRow += rowDelta;
    nextColumn += columnDelta;
    if (nextColumn < 0) { nextRow -= 1; nextColumn = GRID_FIELDS.length - 1; }
    if (nextColumn >= GRID_FIELDS.length) { nextRow += 1; nextColumn = 0; }
    if (nextRow < 0 || nextRow >= rows.length) return false;
    focusGridCell(rows[nextRow].id, GRID_FIELDS[nextColumn]);
    return true;
  }, [rows, focusGridCell]);

  const fillDown = useCallback(() => {
    const active = activeCellRef.current;
    if (!active || !selectedIds.length) return;
    const sourceIndex = rows.findIndex((row) => row.id === active.id);
    if (sourceIndex < 0) return;
    const targetRows = rows.filter((row, index) => index > sourceIndex && selectedSet.has(row.id) && !row.lineno);
    if (!targetRows.length) return;
    const source = rows[sourceIndex];
    if (active.field === 'itemname' || source.lineno) return;
    const value = source[active.field] ?? '';
    const targetIds = new Set(targetRows.map((row) => row.id));
    setRows((current) => current.map((row) => {
      if (!targetIds.has(row.id)) return row;
      const next = { ...row, [active.field]: value };
      if (active.field === 'warehousecode') next.warehousecodename = masters.warehouse.find((option) => option.code === value)?.name || '';
      return next;
    }));
    notifications.show({ title: '아래로 채우기 완료', message: `${targetRows.length}개 행에 현재 셀의 값을 복사했습니다.`, color: 'teal' });
  }, [rows, selectedIds.length, selectedSet, masters.warehouse]);

  const handleTableKeyDown = useCallback((event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      fillDown();
      return;
    }
    const target = event.target instanceof HTMLInputElement ? event.target : null;
    const active = target?.dataset.rowId && target?.dataset.field
      ? { id: target.dataset.rowId, field: target.dataset.field }
      : activeCellRef.current;
    if (!active) return;
    let rowDelta = 0;
    let columnDelta = 0;
    if (event.key === 'Enter') rowDelta = event.shiftKey ? -1 : 1;
    else if (event.key === 'Tab') columnDelta = event.shiftKey ? -1 : 1;
    else if (event.key === 'ArrowDown') rowDelta = 1;
    else if (event.key === 'ArrowUp') rowDelta = -1;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const hasSelection = target && target.selectionStart !== target.selectionEnd;
      const atBoundary = !target || target.readOnly || hasSelection
        ? !hasSelection
        : event.key === 'ArrowLeft' ? target.selectionStart === 0 : target.selectionEnd === target.value.length;
      if (!atBoundary) return;
      columnDelta = event.key === 'ArrowLeft' ? -1 : 1;
    } else return;
    if (moveGridCell(active.id, active.field, rowDelta, columnDelta)) event.preventDefault();
  }, [fillDown, moveGridCell]);

  const pasteRange = useCallback((startId, startField, pastedText) => {
    const matrix = pastedText.replace(/\r/g, '').split('\n').filter((line, index, all) => line || index < all.length - 1).map((line) => line.split('\t'));
    const startIndex = rows.findIndex((row) => row.id === startId);
    const startColumn = GRID_FIELDS.indexOf(startField);
    if (startIndex < 0 || startColumn < 0) return;
    if (registrationBlockMessage && startIndex + matrix.length > rows.length) {
      notifications.show({
        title: '기초재고를 추가할 수 없습니다',
        message: registrationBlockMessage,
        color: 'orange',
      });
      return;
    }
    if (startIndex + matrix.length > 10000) {
      notifications.show({ title: '붙여넣기 제한', message: '한 번에 최대 10,000행까지 입력할 수 있습니다.', color: 'orange' });
      return;
    }
    const nextRows = [...rows];
    const additions = [];
    matrix.forEach((line, rowOffset) => {
      const target = nextRows[startIndex + rowOffset] ? { ...nextRows[startIndex + rowOffset] } : makeRow({ qtyunit: resolveMasterCode('qtyunit', 'EA', masters) || 'EA' });
      line.forEach((cell, columnOffset) => {
        const key = GRID_FIELDS[startColumn + columnOffset];
        if (!key || key === 'itemname') return;
        if (target.lineno && !EDITABLE_PRICE_FIELDS.has(key)) return;
        const value = String(cell ?? '').trim();
        if (MASTER_FIELDS.has(key)) {
          const code = resolveMasterCode(key, value, masters);
          target[key] = value ? code || value : '';
          if (key === 'warehousecode') target.warehousecodename = masters.warehouse.find((option) => option.code === code)?.name || '';
        } else if (['qty', 'weight', 'unitprice'].includes(key)) target[key] = value ? cleanNumber(value) : '';
        else target[key] = value;
      });
      target.unitamt = calculateAmount(target, masters.price);
      if (nextRows[startIndex + rowOffset]) nextRows[startIndex + rowOffset] = target;
      else additions.push(target);
    });
    setRows([...nextRows, ...additions]);
  }, [rows, masters, registrationBlockMessage]);

  const toggleRowSelection = useCallback((id, shiftKey = false) => {
    setSelectedIds((current) => {
      const from = rows.findIndex((row) => row.id === selectionAnchorRef.current);
      const to = rows.findIndex((row) => row.id === id);
      if (shiftKey && from >= 0 && to >= 0) {
        selectionAnchorRef.current = id;
        return [...new Set([...current, ...rows.slice(Math.min(from, to), Math.max(from, to) + 1).map((row) => row.id)])];
      }
      selectionAnchorRef.current = id;
      return current.includes(id) ? current.filter((value) => value !== id) : [...current, id];
    });
  }, [rows]);

  const chooseMaster = useCallback((option) => {
    if (!masterPickerTarget) return;
    updateRow(masterPickerTarget.id, masterPickerTarget.field, option.code);
    setMasterPickerTarget(null);
  }, [masterPickerTarget, updateRow]);

  const downloadTemplate = useCallback(() => {
    const headers = STOCK_EXCEL_COLUMNS.map(([, label]) => label);
    const worksheet = XLSX.utils.aoa_to_sheet([headers, Array(headers.length).fill('')]);
    applyExcelHeaderStyle(worksheet, headers.length);
    worksheet['!cols'] = STOCK_EXCEL_COLUMNS.map(([key]) => ({ wch: ['itemname', 'description'].includes(key) ? 24 : 16 }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '기초재고');
    XLSX.writeFile(workbook, `기초재고_일괄등록_샘플.xlsx`);
  }, []);

  const exportRows = useCallback(() => {
    setExporting(true);
    try {
      const headers = STOCK_EXCEL_COLUMNS.map(([, label]) => label);
      const worksheet = XLSX.utils.aoa_to_sheet([
        headers,
        ...rows.map((row) => STOCK_EXCEL_COLUMNS.map(([key]) => {
          const value = row[key];
          return ['qty', 'weight', 'unitprice', 'unitamt'].includes(key) && value !== '' && value != null
            ? Number(cleanNumber(value)) : value ?? '';
        })),
      ]);
      applyExcelHeaderStyle(worksheet, headers.length);
      worksheet['!cols'] = STOCK_EXCEL_COLUMNS.map(([key]) => ({ wch: ['itemname', 'description'].includes(key) ? 24 : 16 }));
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, '기초재고');
      XLSX.writeFile(workbook, `기초재고_${standdate.replaceAll('-', '')}.xlsx`);
      notifications.show({ title: '엑셀 다운로드 완료', message: `${rows.length.toLocaleString()}건을 저장했습니다.`, color: 'teal' });
    } catch (error) {
      notifications.show({ title: '엑셀 다운로드 실패', message: errorText(error), color: 'red' });
    } finally { setExporting(false); }
  }, [rows, standdate]);

  const uploadExcel = useCallback(async (event) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    if (hasSavedStock || hasTransactions) {
      notifications.show({
        title: '기초재고를 등록할 수 없습니다',
        message: registrationBlockMessage,
        color: 'orange',
      });
      return;
    }
    if (hasChanges) {
      notifications.show({ title: '저장되지 않은 변경 사항', message: '현재 입력한 내용을 먼저 저장한 뒤 엑셀을 등록해 주세요.', color: 'orange' });
      return;
    }
    setUploading(true);
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!sheet) throw new Error('엑셀 첫 번째 시트를 확인해 주세요.');
      const sourceRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      if (sourceRows.length > 10000) throw new Error('한 번에 최대 10,000행까지 등록할 수 있습니다.');
      const normalize = (value) => String(value ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '');
      const aliases = {
        itemcode: ['itemcode', '품목코드'], itemname: ['itemname', '품목명'], size: ['size', '규격'],
        qty: ['qty', '기초수량', '수량'], qtyunit: ['qtyunit', '수량단위코드', '수량단위'],
        weight: ['weight', '기초중량', '중량'], warehousecode: ['warehousecode', '창고코드'],
        warehousecodename: ['warehousecodename', '창고명'], unit: ['unit', '단가기준'],
        unitprice: ['unitprice', '기초단가'], unitamt: ['unitamt', '기초금액'],
        description: ['description', '비고'],
      };
      const getValue = (source, key) => {
        const cells = Object.fromEntries(Object.entries(source).map(([name, value]) => [normalize(name), value]));
        const header = aliases[key].map(normalize).find((name) => cells[name] !== undefined);
        return header === undefined ? '' : String(cells[header] ?? '').trim();
      };
      const parseNumber = (value) => value === '' ? '' : Number(String(value).replace(/,/g, '').trim());
      const resolveMaster = (value, options) => {
        const normalized = normalize(value);
        return options.find((option) => normalize(option.code) === normalized || normalize(option.name) === normalized)?.code || '';
      };
      const parsedRows = sourceRows.map((source, index) => ({
        excelRow: index + 2,
        itemcode: getValue(source, 'itemcode'), itemname: getValue(source, 'itemname'),
        size: getValue(source, 'size'), qty: parseNumber(getValue(source, 'qty')),
        qtyunit: resolveMaster(getValue(source, 'qtyunit'), masters.quantity),
        weight: parseNumber(getValue(source, 'weight')),
        warehousecode: resolveMaster(getValue(source, 'warehousecode') || getValue(source, 'warehousecodename'), masters.warehouse),
        unit: getValue(source, 'unit') ? resolveMaster(getValue(source, 'unit'), masters.price) : '',
        unitprice: parseNumber(getValue(source, 'unitprice')), unitamt: parseNumber(getValue(source, 'unitamt')),
        description: getValue(source, 'description'),
      })).filter(({ excelRow, ...row }) => Object.values(row).some((value) => value !== '' && value != null));
      if (!parsedRows.length) throw new Error('업로드할 데이터가 없습니다. 첫 번째 시트의 열 이름을 확인해 주세요.');

      const itemcodes = [...new Set(parsedRows.map((row) => row.itemcode).filter(Boolean))];
      let activeItems = {};
      if (itemcodes.length) {
        const { data } = await axios.post('/api/stock-stand/items/resolve', { itemcodes }, authConfig());
        activeItems = data.items || {};
      }
      parsedRows.forEach((row) => {
        row.itemname = activeItems[row.itemcode] || '';
      });

      const errors = [];
      parsedRows.forEach((row) => {
        const rowErrors = [];
        if (!row.itemcode) rowErrors.push('품목코드 필수');
        else if (!row.itemname) rowErrors.push('품목코드가 미등록이거나 사용중지 상태입니다');
        if (!row.qtyunit) rowErrors.push('수량단위 확인 필요');
        if (row.qty !== '' && (!Number.isFinite(row.qty) || row.qty <= 0)) rowErrors.push('기초수량은 양수');
        if (!Number.isFinite(row.weight) || row.weight <= 0) rowErrors.push('기초중량은 양수');
        if (!row.warehousecode) rowErrors.push('창고코드/창고명 확인 필요');
        if (getValue(sourceRows[row.excelRow - 2], 'unit') && !row.unit) rowErrors.push('단가기준 확인 필요');
        for (const key of ['unitprice']) {
          if (row[key] !== '' && (!Number.isFinite(row[key]) || row[key] < 0)) rowErrors.push('기초단가는 0 이상 숫자');
        }
        if (rowErrors.length) errors.push(`${row.excelRow}행: ${rowErrors.join(', ')}`);
      });
      if (errors.length) {
        notifications.show({ title: '엑셀 등록 중단', message: `${errors.length}개 행을 확인해 주세요. ${errors.slice(0, 5).join(' / ')}`, color: 'red', autoClose: 9000 });
        return;
      }

      setRows((current) => [...current, ...parsedRows.map(({ excelRow, ...row }) => makeRow({
        ...row,
        unitamt: calculateAmount(row, masters.price),
        warehousecodename: masters.warehouse.find((option) => option.code === row.warehousecode)?.name || '',
      }))]);
      notifications.show({ title: '엑셀 업로드 완료', message: `${parsedRows.length.toLocaleString()}건을 입력 목록에 추가했습니다. 저장 버튼을 눌러 반영해 주세요.`, color: 'teal', autoClose: 7000 });
    } catch (error) {
      notifications.show({ title: '엑셀 업로드 실패', message: errorText(error), color: 'red' });
    } finally { setUploading(false); }
  }, [hasChanges, masters, hasSavedStock, hasTransactions, registrationBlockMessage]);

  const save = async () => {
    const newRows = rows.filter((row) => !row.lineno);
    if (newRows.length && (hasSavedStock || hasTransactions)) {
      notifications.show({
        title: '기초재고를 등록할 수 없습니다',
        message: registrationBlockMessage,
        color: 'orange',
      });
      return;
    }
    if (!newRows.length && !changedPriceRows.length) {
      notifications.show({ title: '저장할 변경사항 없음', message: '새 기초재고를 입력하거나 단가 정보를 변경해 주세요.', color: 'blue' });
      return;
    }
    const invalid = [];
    newRows.forEach((row) => {
      const rowNo = rows.indexOf(row) + 1;
      if (!row.itemcode.trim() || !row.itemname.trim()) invalid.push(`${rowNo}행 품목`);
      if (!row.qtyunit) invalid.push(`${rowNo}행 수량단위`);
      if (row.qty && (!Number.isFinite(Number(row.qty)) || Number(row.qty) <= 0)) invalid.push(`${rowNo}행 기초수량`);
      if (!row.weight || !Number.isFinite(Number(row.weight)) || Number(row.weight) <= 0) invalid.push(`${rowNo}행 기초중량`);
      if (!row.warehousecode) invalid.push(`${rowNo}행 창고`);
    });
    [...newRows, ...changedPriceRows].forEach((row) => {
      for (const key of ['unitprice']) {
        if (row[key] !== '' && (!Number.isFinite(Number(row[key])) || Number(row[key]) < 0)) invalid.push(`${rows.indexOf(row) + 1}행 ${key === 'unitprice' ? '기초단가' : '기초금액'}`);
      }
    });
    if (invalid.length) {
      notifications.show({ title: '입력값을 확인해 주세요', message: invalid.slice(0, 5).join(', '), color: 'orange' });
      return;
    }

    setSaving(true);
    try {
      if (newRows.length) {
        await axios.post('/api/stock-stand/items', {
          standdate,
          items: newRows.map((row) => ({
            itemcode: row.itemcode.trim(), itemname: row.itemname.trim(), size: row.size.trim(),
            qty: row.qty ? cleanNumber(row.qty) : null, qtyunit: row.qtyunit,
            weight: cleanNumber(row.weight), warehousecode: row.warehousecode,
            warehousecodename: row.warehousecodename, unit: row.unit,
            unitprice: row.unitprice === '' ? null : cleanNumber(row.unitprice),
            unitamt: calculateAmount(row, masters.price) || null, description: row.description.trim(),
          })),
        }, authConfig());
      }
      if (changedPriceRows.length) {
        await axios.put('/api/stock-stand/items/prices', {
          items: changedPriceRows.map((row) => ({
            lineno: row.lineno,
            unit: row.unit || '',
            unitprice: row.unitprice === '' ? null : cleanNumber(row.unitprice),
            unitamt: calculateAmount(row, masters.price) || null,
          })),
        }, authConfig());
      }
      const resultParts = [];
      if (newRows.length) resultParts.push(`${newRows.length}건 등록`);
      if (changedPriceRows.length) resultParts.push(`${changedPriceRows.length}건 단가정보 수정`);
      notifications.show({ title: '기초재고 저장 완료', message: `${resultParts.join(', ')}했습니다. 저장된 행은 단가기준·기초단가를 수정할 수 있고, 기초금액은 자동 계산됩니다.`, color: 'teal' });
      await loadRows(standdate, query, false);
    } catch (error) {
      notifications.show({ title: '기초재고 저장 실패', message: errorText(error), color: 'red' });
    } finally { setSaving(false); }
  };

  const deleteAll = async () => {
    if (!hasSavedStock || hasStockMovements || saving) return;
    if (!window.confirm('이 회사에 등록된 기초재고 전체를 삭제할까요? 수불 이력이 없는 경우에만 삭제됩니다.')) return;
    setSaving(true);
    try {
      const { data } = await axios.delete('/api/stock-stand/items', { ...authConfig(), data: { delete_all: true } });
      setRows([]);
      setSelectedIds([]);
      setHasSavedStock(false);
      setHasStockMovements(false);
      notifications.show({ title: '기초재고 전체 삭제 완료', message: `${Number(data.deleted_count || 0).toLocaleString()}건을 삭제했습니다.`, color: 'teal' });
    } catch (error) {
      notifications.show({ title: '기초재고 삭제 실패', message: errorText(error), color: 'red' });
    } finally { setSaving(false); }
  };

  const deleteRow = async (row) => {
    if (saving) return;
    if (row.lineno) {
      notifications.show({ title: '행 단위 삭제 불가', message: '저장된 기초재고는 행별로 삭제할 수 없습니다. 기초재고 전체 삭제를 이용해 주세요.', color: 'orange' });
      return;
    }
    if (row.has_movements) {
      notifications.show({ title: '삭제할 수 없음', message: '입고 또는 출고 이력이 있는 기초재고는 삭제할 수 없습니다.', color: 'orange' });
      return;
    }
    if (!window.confirm(`${row.itemcode || '신규 행'} 기초재고를 삭제할까요?`)) return;
    setSaving(true);
    try {
      setRows((current) => current.filter((item) => item.id !== row.id));
      setSelectedIds((current) => current.filter((id) => id !== row.id));
      notifications.show({ title: '기초재고 삭제 완료', message: '선택한 행을 삭제했습니다.', color: 'teal' });
    } catch (error) {
      notifications.show({ title: '기초재고 삭제 실패', message: errorText(error), color: 'red' });
    } finally { setSaving(false); }
  };

  const deleteSelectedRows = () => {
    if (!selectedIds.length || hasSavedStock || saving) return;
    const ids = new Set(selectedIds);
    const deletedCount = rows.filter((row) => ids.has(row.id) && !row.lineno).length;
    setRows((current) => current.filter((row) => !ids.has(row.id) || row.lineno));
    setSelectedIds([]);
    selectionAnchorRef.current = '';
    setSelectedDeleteOpen(false);
    notifications.show({ title: '선택 삭제 완료', message: `${deletedCount}개 입력 행을 삭제했습니다.`, color: 'teal' });
  };

  const toggleAll = (checked) => {
    setSelectedIds(checked ? rows.filter((row) => !row.lineno).map((row) => row.id) : []);
    selectionAnchorRef.current = '';
  };
  const columns = [
    ['select', ''], ['number', 'No.'], ['itemcode', '품목코드 *'], ['itemname', '품목명 *'], ['size', '규격'],
    ['qty', '기초수량'], ['qtyunit', '수량단위 *'], ['warehousecode', '창고명 *'], ['weight', '기초중량 *'],
    ['unit', '단가기준'], ['unitprice', '기초단가'], ['unitamt', '기초금액'], ['description', '비고'], ['action', ''],
  ];

  const headerColumns = columns.map(([key, label]) => ({
    key,
    label: key === 'select'
      ? <input type="checkbox" aria-label="전체 선택" disabled={hasSavedStock || !rows.some((row) => !row.lineno)} checked={rows.some((row) => !row.lineno) && rows.filter((row) => !row.lineno).every((row) => selectedSet.has(row.id))} onChange={(event) => toggleAll(event.currentTarget.checked)} />
      : label,
    width: GRID_COLUMN_WIDTHS[key],
    minWidth: ['select', 'action'].includes(key) ? 42 : key === 'number' ? 48 : 70,
    className: key === 'select' ? codeClasses.checkCol : key === 'number' ? codeClasses.numberCol : key === 'action' ? codeClasses.actionCol : '',
  }));
  const tableWidth = headerColumns.reduce((sum, column) => sum + (columnWidths[column.key] ?? column.width), 0);
  const renderHeader = (column) => (
    <Table.Th key={column.key} className={[codeClasses.resizableHeader, column.className].filter(Boolean).join(' ')} style={{ width: columnWidths[column.key] ?? column.width }}>
      {column.label}<span className={codeClasses.columnResizeHandle} onPointerDown={(event) => resizeColumn(event, column.key, column.width, column.minWidth, tableWidth)} role="separator" aria-label={`${column.key} 열 너비 조절`} />
    </Table.Th>
  );
  const itemContent = (index, row) => {
    const saved = Boolean(row.lineno);
    const isSelected = selectedSet.has(row.id);
    const renderField = (key) => {
      const editableSavedPrice = saved && EDITABLE_PRICE_FIELDS.has(key);
      const masterKey = MASTER_FIELDS.has(key);
      const masterOptions = masters[MASTER_KIND[key]] || [];
      const displayed = key === 'qtyunit' || key === 'unit'
        ? masterOptions.find((option) => option.code === row[key])?.name || row[key] || ''
        : key === 'warehousecode' ? row.warehousecodename || row.warehousecode || ''
          : key === 'unitamt' ? formatAmount(calculateAmount(row, masters.price))
            : ['qty', 'weight', 'unitprice'].includes(key) ? numberText(row[key]) : row[key] ?? '';
      const readOnly = key === 'itemname' || key === 'unitamt';
      const disabled = saving || (saved && !PRICE_FIELDS.has(key));
      const pasted = (event) => {
        if (key === 'unitamt') {
          event.preventDefault();
          return;
        }
        const text = event.clipboardData.getData('text/plain');
        if (text.includes('\t') || text.includes('\n')) {
          event.preventDefault();
          pasteRange(row.id, key, text);
        } else if (masterKey) {
          event.preventDefault();
          updateRow(row.id, key, text.trim());
        }
      };
      return <Table.Td key={key} className={saved ? (editableSavedPrice ? classes.savedEditableCell : outboundClasses.savedCell) : ''}>
        <input
          ref={(element) => {
            registerCellInput(row.id, key, element);
          }}
          className={`${codeClasses.cellInput} ${key === 'itemname' ? outboundClasses.autoFilledInput : ''} ${key === 'unitamt' ? outboundClasses.amountInput : ''} ${key === 'itemcode' || masterKey ? outboundClasses.itemCodePickerInput : ''}`}
          aria-label={columns.find(([columnKey]) => columnKey === key)?.[1] || key}
          title={key === 'itemcode' ? '더블클릭하여 품목 선택' : masterKey ? '더블클릭하여 마스터 코드 선택' : undefined}
          data-row-id={row.id}
          data-field={key}
          inputMode={['qty', 'weight', 'unitprice'].includes(key) ? 'decimal' : undefined}
          value={displayed}
          placeholder={row.isNew && (key === 'itemcode' || key === 'itemname') ? (key === 'itemcode' ? '품목코드' : '품목명') : ''}
          readOnly={readOnly || disabled}
          disabled={disabled}
          onFocus={() => { activeCellRef.current = { id: row.id, field: key }; }}
          onDoubleClick={() => {
            if (key === 'itemcode') setItemPickerId(row.id);
            else if (masterKey) setMasterPickerTarget({ id: row.id, field: key });
          }}
          onPaste={pasted}
          onBlur={key === 'itemcode' ? async (event) => {
            const itemcode = event.currentTarget.value.trim();
            if (!itemcode) return;
            try {
              const { data } = await axios.get('/api/item-master/items/picker', { ...authConfig(), params: { q: itemcode, page: 1, page_size: 20 } });
              const match = (data.items || []).find((item) => String(item.itemcode).toLocaleLowerCase() === itemcode.toLocaleLowerCase());
              if (match) selectItem(row.id, match);
            } catch { /* Keep the entered code so validation can identify it on save. */ }
          } : undefined}
          onChange={(event) => updateRow(row.id, key, ['qty', 'weight', 'unitprice'].includes(key) ? cleanNumber(event.currentTarget.value) : event.currentTarget.value)}
        />
      </Table.Td>;
    };

    return <>
      <Table.Td className={codeClasses.checkCol}><input type="checkbox" checked={isSelected} disabled={saving || saved || hasSavedStock} onChange={(event) => toggleRowSelection(row.id, event.nativeEvent.shiftKey)} /></Table.Td>
      <Table.Td className={`${codeClasses.rowNumber} ${!saved ? classes.newRowNumber : ''}`}>{index + 1}</Table.Td>
      {GRID_FIELDS.map(renderField)}
      <Table.Td className={codeClasses.actionCol}>
        <Tooltip label={saved ? '저장된 행은 행별 삭제할 수 없습니다. 전체 삭제를 이용해 주세요.' : '행 삭제'}>
          <ActionIcon variant="subtle" color="red" aria-label="행 삭제" disabled={saving || saved} onClick={() => deleteRow(row)}><IconTrash size={16} /></ActionIcon>
        </Tooltip>
      </Table.Td>
    </>;
  };

  return <Box className={`${sharedClasses.pageShell} ${classes.page}`}>
    <Paper className={dashboardClasses.dashboardHeader}>
      <Box className={dashboardClasses.headerCopy}>
        <Text className={sharedClasses.breadcrumb}>기초재고 관리 <span>›</span> 기준정보 관리</Text>
        <Title order={1} className={dashboardClasses.pageTitle}>기초재고 <span>등록</span></Title>
        <Text className={dashboardClasses.pageSubtitle}>기준일자별 기초재고를 등록합니다.</Text>
        <Group className={dashboardClasses.sampleNotice} gap={8}><span className={dashboardClasses.statusDot} /><Text size="xs">System Active</Text></Group>
      </Box>
    </Paper>

    <Paper className={`${sharedClasses.panel} ${classes.panel}`} withBorder>
      <Group className={`${sharedClasses.panelHeader} ${codeClasses.codeHeader} ${classes.codeHeader}`} justify="space-between" align="flex-start" wrap="wrap" gap="sm">
        <Box>
          <Group gap={9} align="center"><Text className={codeClasses.codeTitle} fw={800}>기초재고 등록</Text><Badge color="red" variant="light">{rows.length}행</Badge></Group>

        </Box>
        <Group className={classes.headerActions} gap={7} align="center" wrap="wrap">
          <Button variant="default" size="sm" leftSection={<IconDownload size={15} />} onClick={downloadTemplate} disabled={loading || uploading}>샘플양식</Button>
          <Button variant="light" size="sm" leftSection={<IconDownload size={15} />} onClick={exportRows} loading={exporting} disabled={loading || uploading}>엑셀 다운로드</Button>
          <Button variant="light" color="red" size="sm" leftSection={<IconTrash size={15} />} disabled={!hasSavedStock || hasStockMovements || saving || uploading || loading} onClick={deleteAll} title={hasStockMovements ? '입고 또는 출고 수불 이력이 있어 전체 삭제할 수 없습니다.' : '회사 기초재고 전체 삭제'}>전체 삭제</Button>
          <Button color="red" size="sm" leftSection={<IconDeviceFloppy size={15} />} loading={saving} disabled={loading || uploading || !hasChanges} onClick={save}>저장</Button>
        </Group>
      </Group>
      <Group className={`${sharedClasses.toolbar} ${codeClasses.toolbar} ${classes.filterToolbar}`} justify="space-between" wrap="wrap" gap={8}>
        <Group className={classes.searchGroup} gap={6} wrap="wrap" align="end">
          <TextInput className={classes.dateFilter} type="date" label="기준일자" value={standdate} onChange={(event) => setStanddate(event.currentTarget.value)} size="sm" />
          <TextInput className={classes.stockSearch} placeholder="품목코드 또는 품목명 검색" aria-label="품목 검색" leftSection={<IconSearch size={15} />} value={searchInput} onChange={(event) => setSearchInput(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === 'Enter') { setQuery(searchInput.trim()); loadRows(standdate, searchInput.trim()); } }} size="sm" />
          <Button size="sm" leftSection={<IconSearch size={15} />} onClick={() => { setQuery(searchInput.trim()); loadRows(standdate, searchInput.trim()); }} loading={loading}>조회</Button>
        </Group>
        <Group className={classes.listActions} gap={7} wrap="wrap" justify="flex-end" align="flex-end">
          {selectedIds.length > 0 && <Text size="xs" c="dimmed">{selectedIds.length}개 선택</Text>}
          <Button variant="subtle" color="red" size="xs" leftSection={<IconTrash size={14} />} disabled={!selectedIds.length || hasSavedStock || saving || uploading || loading} onClick={() => setSelectedDeleteOpen(true)}>선택 삭제</Button>
          <Button color="red" size="xs" leftSection={<IconPlus size={14} />} onClick={addRow} disabled={saving || uploading || loading || hasSavedStock || hasTransactions}>행 추가</Button>
          <Button size="xs" variant="light" leftSection={<IconUpload size={14} />} onClick={() => uploadInputRef.current?.click()} loading={uploading} disabled={saving || loading || hasSavedStock || hasTransactions}>엑셀 일괄등록</Button>
          <input ref={uploadInputRef} type="file" accept=".xlsx,.xls" onChange={uploadExcel} hidden />
        </Group>
      </Group>
      <Group className={`${sharedClasses.toolbar} ${codeClasses.toolbar} ${classes.detailToolbar}`} justify="space-between" wrap="wrap" gap={6}>
        <Group gap={8}><Text fw={700} c="dark">기초재고 상세</Text><Badge color="gray" variant="light">{rows.length}행</Badge></Group>
        {selectedIds.length > 1 && <Text size="xs" c="red" fw={600}>마스터 값 변경 시 {selectedIds.length}개 행에 일괄 적용됩니다.</Text>}
      </Group>
      <Box className={codeClasses.tableWrap} style={{ '--code-table-min-width': `${Math.max(1730, tableWidth)}px` }} onKeyDown={handleTableKeyDown}>
        {loading ? <Box className={classes.loading}><Loader color="red" /></Box> : rows.length ? (
          <TableVirtuoso
            ref={virtuosoRef}
            data={rows}
            style={{ height: '100%' }}
            components={stockVirtuosoComponents}
            computeItemKey={(_index, row) => row.id}
            defaultItemHeight={42}
            increaseViewportBy={{ top: 160, bottom: 320 }}
            fixedHeaderContent={() => <Table.Tr>{headerColumns.map(renderHeader)}</Table.Tr>}
            itemContent={itemContent}
          />
        ) : <Box className={codeClasses.emptyState}>{'\uD45C\uC2DC\uD560 \uAE30\uCD08\uC7AC\uACE0\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.'}</Box>}
      </Box>      <Group className={`${sharedClasses.footer} ${codeClasses.tableFooter} ${classes.stockFooter}`} justify="space-between" wrap="wrap">
        <Text className={classes.footerNotice} size="xs" c="dimmed">기초금액 자동 계산: KG = 중량 × 단가, TON = (중량 ÷ 1,000) × 단가. 저장된 행은 단가기준·기초단가만 수정할 수 있습니다.</Text>
        <Text size="xs" fw={700}>선택 {selectedIds.length.toLocaleString()}건</Text>
      </Group>
    </Paper>
    <ItemPicker opened={Boolean(itemPickerId)} onClose={() => setItemPickerId('')} onSelect={(item) => selectItem(itemPickerId, item)} />
    <StockMasterPicker
      opened={Boolean(masterPickerTarget)}
      title={MASTER_TITLE[masterPickerTarget?.field] || '코드 선택'}
      options={masters[MASTER_KIND[masterPickerTarget?.field]] || []}
      onClose={() => setMasterPickerTarget(null)}
      onSelect={chooseMaster}
    />
    <Modal opened={selectedDeleteOpen} onClose={() => !saving && setSelectedDeleteOpen(false)} title="선택 행 삭제" centered size="sm">
      <Stack gap="md">
        <Text size="sm" c="dimmed">선택한 {selectedIds.length.toLocaleString()}개 입력 행을 삭제할까요? 아직 저장되지 않은 행만 삭제됩니다.</Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setSelectedDeleteOpen(false)} disabled={saving}>취소</Button>
          <Button color="red" leftSection={<IconTrash size={15} />} onClick={deleteSelectedRows} disabled={hasSavedStock || saving}>삭제</Button>
        </Group>
      </Stack>
    </Modal>
  </Box>;
}
