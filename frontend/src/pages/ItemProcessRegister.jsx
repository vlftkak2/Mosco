import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import {
  ActionIcon, Badge, Box, Button, Checkbox, Group, Loader, Modal, Pagination,
  Paper, Popover, Select, Stack, Table, Text, TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconPlus, IconSearch, IconTrash, IconX } from '@tabler/icons-react';
import ErpBreadcrumb from '../components/common/ErpBreadcrumb';
import ErpRibbon from '../components/common/ErpRibbon';
import { PageRibbonContext } from '../components/layout/MainLayout';
import sharedClasses from '../styles/pages/ManagementShared.module.css';
import classes from '../styles/pages/ItemProcessRegister.module.css';


const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const num = (value) => Number(String(value ?? '').replace(/,/g, '')) || 0;
const numberText = (value) => num(value).toLocaleString(undefined, { maximumFractionDigits: 3 });
const DECIMAL_INPUT_PATTERN = /^\d*(?:\.\d{0,3})?$/;
const rawNumericValue = (value) => String(value ?? '').replace(/,/g, '');
const formatNumericInput = (value) => {
  const raw = rawNumericValue(value);
  const [integer, decimal] = raw.split('.');
  const groupedInteger = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return decimal === undefined ? groupedInteger : `${groupedInteger}.${decimal}`;
};
function handleDetailGridKeyDown(event) {
  const field = event.currentTarget.dataset.detailField;
  const currentRow = event.currentTarget.closest('tr');
  if (!field || !currentRow) return;

  if (event.key === 'Enter' || event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const delta = event.key === 'ArrowUp' || (event.key === 'Enter' && event.shiftKey) ? -1 : 1;
    let row = delta > 0 ? currentRow.nextElementSibling : currentRow.previousElementSibling;
    while (row) {
      const nextInput = [...row.querySelectorAll('[data-detail-field]')]
        .find((input) => input.dataset.detailField === field && !input.disabled);
      if (nextInput) {
        nextInput.focus();
        return;
      }
      row = delta > 0 ? row.nextElementSibling : row.previousElementSibling;
    }
    return;
  }

  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  const input = event.currentTarget;
  const hasSelection = input.selectionStart !== null && input.selectionStart !== input.selectionEnd;
  const atBoundary = hasSelection
    ? false
    : event.key === 'ArrowLeft'
      ? input.selectionStart === 0
      : input.selectionEnd === input.value.length;
  if (!atBoundary) return;

  const cells = [...currentRow.querySelectorAll('[data-detail-field]')].filter((item) => !item.disabled);
  const currentIndex = cells.indexOf(input);
  const nextInput = cells[currentIndex + (event.key === 'ArrowLeft' ? -1 : 1)];
  if (nextInput) {
    event.preventDefault();
    nextInput.focus();
  }
}
function DetailNumericInput({ field, value, disabled, onCommit }) {
  const inputRef = useRef(null);
  const rawRef = useRef(rawNumericValue(value));
  const [draft, setDraft] = useState(() => formatNumericInput(value));
  const [editing, setEditing] = useState(false);

  return <input ref={inputRef} data-detail-field={field} onKeyDown={handleDetailGridKeyDown}
    disabled={disabled} inputMode="decimal" value={editing ? draft : formatNumericInput(value)}
    onFocus={() => {
      rawRef.current = rawNumericValue(value);
      setDraft(formatNumericInput(value));
      setEditing(true);
    }}
    onChange={(event) => {
      const input = event.currentTarget;
      const cursor = input.selectionStart ?? input.value.length;
      const rawBeforeCursor = rawNumericValue(input.value.slice(0, cursor));
      const raw = rawNumericValue(input.value);
      if (!DECIMAL_INPUT_PATTERN.test(raw)) return;
      rawRef.current = raw;
      setDraft(formatNumericInput(raw));
      const nextCursor = formatNumericInput(rawBeforeCursor).length;
      requestAnimationFrame(() => input.setSelectionRange(nextCursor, nextCursor));
    }}
    onBlur={() => {
      if (rawRef.current !== rawNumericValue(value) && onCommit(rawRef.current) === false) {
        rawRef.current = rawNumericValue(value);
        setDraft(formatNumericInput(value));
      }
      setEditing(false);
    }} />;
}
const sourceKey = (row) => `${row.sourcetype}\u001f${row.sourceno}\u001f${row.sourceline}`;
function isSourceWeightBalanced(source) {
  const tolerance = 1e-9;
  const childrenByParent = new Map();
  source.products.forEach((product) => {
    const parentId = product.parentId || null;
    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
    childrenByParent.get(parentId).push(product);
  });
  const roots = childrenByParent.get(null) || [];
  if (!roots.length || Math.abs(roots.reduce((sum, product) => sum + num(product.weight), 0) - num(source.weight)) > tolerance) {
    return false;
  }
  return source.products.every((product) => {
    const children = childrenByParent.get(product.id) || [];
    return !children.length || Math.abs(children.reduce((sum, child) => sum + num(child.weight), 0) - num(product.weight)) <= tolerance;
  });
}
const emptyHeader = () => ({ processdate: today(), customcode: '', customname: '', warehousecode: '', warehousecodename: '', manager: localStorage.getItem('user_name') || '', description: '' });
const DOCUMENT_COLUMNS = [
  { key: 'customname', label: '가공처', width: 180, minWidth: 110 },
  { key: 'warehouse', label: '창고', width: 145, minWidth: 90 },
  { key: 'detail_count', label: '상세건수', width: 95, minWidth: 75 },
  { key: 'qty', label: '수량', width: 105, minWidth: 80 },
  { key: 'weight', label: '중량', width: 115, minWidth: 85 },
  { key: 'supplyamt', label: '공급가', width: 130, minWidth: 90 },
  { key: 'vat', label: '부가세', width: 120, minWidth: 85 },
  { key: 'unitamt', label: '합계금액', width: 135, minWidth: 95 },
  { key: 'processno', label: '가공전표', width: 175, minWidth: 120 },
  { key: 'description', label: '비고', width: 180, minWidth: 100 },
];
const DETAIL_COLUMNS = [
  { key: 'select', label: '', width: 42, minWidth: 36 },
  { key: 'no', label: 'No.', width: 130, minWidth: 85 },
  { key: 'category', label: '구분', width: 95, minWidth: 70 },
  { key: 'process', label: '가공방법', width: 145, minWidth: 100 },
  { key: 'productname', label: '가공품명', width: 160, minWidth: 100 },
  { key: 'productno', label: '제품명', width: 150, minWidth: 110 },
  { key: 'thickness', label: '두께', width: 82, minWidth: 60 },
  { key: 'width', label: '폭', width: 82, minWidth: 60 },
  { key: 'length', label: '길이', width: 82, minWidth: 60 },
  { key: 'qty', label: '수량', width: 82, minWidth: 60 },
  { key: 'qtyunit', label: '단위', width: 70, minWidth: 55 },
  { key: 'weight', label: '중량(KG)', width: 110, minWidth: 80 },
  { key: 'unitprice', label: '단가/KG', width: 100, minWidth: 75 },
  { key: 'amount', label: '가공금액', width: 115, minWidth: 85 },
];
function startTableColumnResize(event, columns, widths, setWidths, minTableWidth) {
  event.preventDefault();
  event.stopPropagation();
  const table = event.currentTarget.closest('table');
  const header = event.currentTarget.parentElement;
  const columnKey = event.currentTarget.dataset.columnKey;
  const column = columns.find((item) => item.key === columnKey);
  if (!table || !column) return;
  const startX = event.clientX;
  const startWidth = widths[columnKey] ?? column.width;
  const tableWidth = columns.reduce((sum, item) => sum + (widths[item.key] ?? item.width), 0);
  let nextWidth = startWidth;
  const move = (pointerEvent) => {
    nextWidth = Math.max(column.minWidth, Math.min(1600, startWidth + pointerEvent.clientX - startX));
    const col = [...table.querySelectorAll('col[data-column-key]')].find((item) => item.dataset.columnKey === columnKey);
    if (col) col.style.width = `${nextWidth}px`;
    if (header) header.style.width = `${nextWidth}px`;
    const nextTableWidth = Math.max(minTableWidth, tableWidth + nextWidth - startWidth);
    table.style.width = `${nextTableWidth}px`;
    table.style.minWidth = `${nextTableWidth}px`;
  };
  const finish = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', finish);
    setWidths((current) => ({ ...current, [columnKey]: nextWidth }));
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', finish);
  window.addEventListener('pointercancel', finish);
}
const orderProducts = (products) => {
  const children = new Map();
  products.forEach((product) => {
    const parentId = product.parentId || '';
    if (!children.has(parentId)) children.set(parentId, []);
    children.get(parentId).push(product);
  });
  const ordered = [];
  const visit = (parentId = '', parentPath = [], ancestorContinues = []) => {
    const siblings = children.get(parentId) || [];
    siblings.forEach((product, index) => {
      const lineNo = [...parentPath, index + 1];
      const isLast = index === siblings.length - 1;
      ordered.push({ product, lineNo, isLast, ancestorContinues });
      visit(product.id, lineNo, [...ancestorContinues, !isLast]);
    });
  };
  visit();
  return ordered;
};

function ProcessMethodCell({ product, options, disabled, onSelect }) {
  const selectedOption = options.find((option) => option.processid === product.processid);
  const selectedName = selectedOption?.processname || product.processcodename || '';
  const [draft, setDraft] = useState(selectedName);
  const [opened, setOpened] = useState(false);
  const [pickerOpened, setPickerOpened] = useState(false);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [activeIndex, setActiveIndex] = useState(-1);
  const skipBlurCommitRef = useRef(false);
  const matches = options.filter((option) => draft.trim()
    && option.processname.toLocaleLowerCase().includes(draft.trim().toLocaleLowerCase())).slice(0, 8);
  const pickerMatches = options.filter((option) => !query.trim()
    || `${option.processid} ${option.processname}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const pageSize = 8;
  const pageItems = pickerMatches.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => { setDraft(selectedName); }, [selectedName]);

  const choose = (option) => {
    setDraft(option?.processname || '');
    setOpened(false);
    setPickerOpened(false);
    setActiveIndex(-1);
    onSelect(option || null);
  };

  return <>
    <Popover opened={opened && matches.length > 0 && !disabled} onChange={setOpened}
      position="bottom-start" withinPortal width="target" shadow="none" offset={0} transitionProps={{ duration: 0 }}>
      <Popover.Target>
        <div className={classes.processPickerCell}>
          <input className={classes.processPickerInput} data-detail-field="processid" value={draft} disabled={disabled}
            onFocus={() => { if (matches.length) setOpened(true); }}
            onChange={(event) => { setDraft(event.currentTarget.value); setActiveIndex(-1); setOpened(true); }}
            onBlur={() => {
              if (skipBlurCommitRef.current) { skipBlurCommitRef.current = false; return; }
              setOpened(false);
              if (draft !== selectedName) choose(null);
            }}
            onKeyDown={(event) => {
              if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && opened && matches.length) {
                event.preventDefault(); event.stopPropagation();
                setActiveIndex((current) => event.key === 'ArrowDown'
                  ? (current < 0 ? 0 : (current + 1) % matches.length)
                  : (current < 0 ? matches.length - 1 : (current - 1 + matches.length) % matches.length));
              } else if (event.key === 'Enter' && opened && matches.length) {
                event.preventDefault(); event.stopPropagation(); choose(matches[activeIndex >= 0 ? activeIndex : 0]);
              } else if (event.key === 'Tab' && draft !== selectedName) {
                skipBlurCommitRef.current = true;
                const selected = activeIndex >= 0 ? matches[activeIndex] : null;
                if (selected) choose(selected);
                else { setDraft(''); setOpened(false); setActiveIndex(-1); onSelect(null); }
              } else if (event.key === 'Escape') { event.stopPropagation(); setOpened(false); setActiveIndex(-1); }
              else if (event.key === 'Enter' || event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowDown') handleDetailGridKeyDown(event);
            }}
            onDoubleClick={() => { if (!disabled) setPickerOpened(true); }} />
          <button type="button" className={classes.processPickerButton} disabled={disabled}
            onClick={() => { setQuery(''); setPage(1); setPickerOpened(true); }} aria-label="가공방법 조회"><IconSearch size={15} /></button>
        </div>
      </Popover.Target>
      <Popover.Dropdown className={classes.processSuggestions}>
        {matches.map((option, index) => <button type="button" className={classes.processSuggestion} key={option.processid}
          aria-selected={index === activeIndex} style={index === activeIndex ? { background: '#edf3f8' } : undefined}
          onMouseDown={(event) => event.preventDefault()} onClick={() => choose(option)}><span>{option.processname}</span></button>)}
      </Popover.Dropdown>
    </Popover>
    <Modal opened={pickerOpened} onClose={() => setPickerOpened(false)} centered size={620}
      title={<Group gap={8}><IconSearch size={17} /><Text fw={600}>가공방법 선택</Text></Group>}>
      <Stack gap="sm">
        <TextInput value={query} onChange={(event) => { setQuery(event.currentTarget.value); setPage(1); }}
          leftSection={<IconSearch size={15} />} autoFocus />
        <Box className={classes.processOptionViewport}><Table withTableBorder withColumnBorders highlightOnHover>
          <Table.Thead><Table.Tr><Table.Th>공정코드</Table.Th><Table.Th>가공방법</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>{pageItems.map((option) => <Table.Tr key={option.processid} className={classes.processOptionRow} onClick={() => choose(option)}>
            <Table.Td>{option.processid}</Table.Td><Table.Td>{option.processname}</Table.Td></Table.Tr>)}
            {!pageItems.length && <Table.Tr><Table.Td colSpan={2} ta="center" c="dimmed" py="xl">선택 가능한 가공방법이 없습니다.</Table.Td></Table.Tr>}
          </Table.Tbody></Table></Box>
        <Group justify="space-between"><Text size="xs" c="dimmed">총 {pickerMatches.length.toLocaleString()}개</Text>
          <Pagination size="sm" total={Math.max(1, Math.ceil(pickerMatches.length / pageSize))} value={page} onChange={setPage} withEdges color="red" /></Group>
      </Stack>
    </Modal>
  </>;
}


function StockPicker({ opened, onClose, onApply, existingKeys }) {
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState({});
  const [query, setQuery] = useState('');
  const [warehouse, setWarehouse] = useState('');
  const [thickness, setThickness] = useState('');
  const [width, setWidth] = useState('');
  const [length, setLength] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const pageSize = 30;

  const load = useCallback(async (nextPage = 1) => {
    setLoading(true);
    try {
      const { data } = await axios.get('/api/item-process-register/available-stock', {
        ...authConfig(), params: {
          page: nextPage, page_size: pageSize, q: query.trim() || undefined, warehouse: warehouse.trim() || undefined,
          thickness: thickness || undefined, width: width || undefined, length: length || undefined,
        },
      });
      setItems(data.items || []); setTotal(data.total || 0); setPage(nextPage);
    } catch (error) {
      notifications.show({ title: '현재고 조회 실패', message: error.response?.data?.detail || '현재고를 조회하지 못했습니다.', color: 'red' });
    } finally { setLoading(false); }
  }, [query, warehouse, thickness, width, length]);

  useEffect(() => {
    if (!opened) return;
    setSelected({}); setQuery(''); setWarehouse(''); setThickness(''); setWidth(''); setLength('');
    void (async () => {
      setLoading(true);
      try {
        const { data } = await axios.get('/api/item-process-register/available-stock', { ...authConfig(), params: { page: 1, page_size: pageSize } });
        setItems(data.items || []); setTotal(data.total || 0); setPage(1);
      } catch (error) {
        notifications.show({ title: '현재고 조회 실패', message: error.response?.data?.detail || '현재고를 조회하지 못했습니다.', color: 'red' });
      } finally { setLoading(false); }
    })();
  }, [opened]);

  const toggle = (row, checked) => {
    const key = sourceKey(row);
    setSelected((current) => ({ ...current, [key]: checked }));
  };
  const apply = () => {
    const chosen = items.filter((row) => selected[sourceKey(row)]);
    const rows = chosen.map((row) => ({ ...row, input_qty: row.qty, input_weight: row.weight }));
    if (!rows.length) return;
    onApply(rows); onClose();
  };

  return <Modal opened={opened} onClose={onClose} title={<Text fw={600}>가공 원소재 선택</Text>} size="95%" centered classNames={{ content: classes.modalContent, body: classes.modalBody }} styles={{ content: { height: '96vh', minHeight: 'min(96vh, 360px)', maxHeight: 'calc(100vh - 12px)', display: 'flex', flexDirection: 'column' }, body: { display: 'flex', minHeight: 0, flex: '1 1 auto', flexDirection: 'column', overflow: 'hidden' } }}>
    <Stack className={classes.pickerLayout} gap="sm" pt={6}>
      <Group className={classes.pickerFilters} align="end" gap="xs" wrap="wrap"><TextInput label="창고" placeholder="창고코드 또는 창고명" w={180} value={warehouse} onChange={(e) => setWarehouse(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && load(1)} />
        <TextInput label="품목" placeholder="품목코드·품명·제품번호" w={220} value={query} onChange={(e) => setQuery(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && load(1)} />
        <TextInput label="두께" type="number" min="0" step="0.001" w={100} value={thickness} onChange={(e) => setThickness(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && load(1)} />
        <TextInput label="폭" type="number" min="0" step="0.001" w={100} value={width} onChange={(e) => setWidth(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && load(1)} />
        <TextInput label="길이" type="number" min="0" step="0.001" w={100} value={length} onChange={(e) => setLength(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && load(1)} />
        <Button color="red" leftSection={<IconSearch size={15} />} onClick={() => load(1)}>조회</Button></Group>
      <Box className={classes.pickerViewport}>{loading && <Loader className={classes.loader} color="red" size="sm" />}
        <Table stickyHeader withTableBorder withColumnBorders className={classes.pickerTable}><Table.Thead><Table.Tr>
          <Table.Th /><Table.Th>구분</Table.Th><Table.Th>입고일자</Table.Th><Table.Th>창고</Table.Th><Table.Th>품명</Table.Th><Table.Th>제품명</Table.Th><Table.Th>강종</Table.Th><Table.Th>두께</Table.Th><Table.Th>폭</Table.Th><Table.Th>길이</Table.Th><Table.Th>현재수량</Table.Th><Table.Th>현재중량</Table.Th>
        </Table.Tr></Table.Thead><Table.Tbody>{items.map((row) => {
          const key = sourceKey(row); const disabled = existingKeys.has(key);
          return <Table.Tr key={key}><Table.Td><Checkbox checked={Boolean(selected[key])} disabled={disabled} onChange={(e) => toggle(row, e.currentTarget.checked)} /></Table.Td>
            <Table.Td>{row.sourcetype === 'OPENING' ? '기초' : row.sourcetype === 'INBOUND' ? '입고' : '가공'}</Table.Td><Table.Td>{String(row.receiptdate || '').slice(0, 10)}</Table.Td><Table.Td>{row.warehousecodename}</Table.Td><Table.Td>{row.itemname}</Table.Td><Table.Td>{row.productname}</Table.Td><Table.Td>{row.materialname || row.myrtle}</Table.Td><Table.Td>{numberText(row.thickness)}</Table.Td><Table.Td>{numberText(row.width)}</Table.Td><Table.Td>{numberText(row.length)}</Table.Td><Table.Td ta="right">{numberText(row.qty)}</Table.Td><Table.Td ta="right">{numberText(row.weight)}</Table.Td>
            </Table.Tr>;
        })}{!items.length && <Table.Tr><Table.Td colSpan={12} className={classes.empty}>가공 가능한 현재고가 없습니다.</Table.Td></Table.Tr>}</Table.Tbody></Table>
      </Box>
      <Group className={classes.pickerFooter} justify="space-between"><Group gap="sm"><Text size="xs" c="dimmed">총 {total.toLocaleString()}건</Text><Text size="xs" c="dimmed">현재 페이지 선택 {items.filter((row) => selected[sourceKey(row)]).length}건</Text></Group><Group><Pagination size="sm" color="red" total={Math.max(1, Math.ceil(total / pageSize))} value={page} onChange={load} /><Button variant="default" onClick={onClose}>취소</Button><Button color="red" disabled={!items.some((row) => selected[sourceKey(row)])} onClick={apply}>선택 반영</Button></Group></Group>
    </Stack>
  </Modal>;
}


export default function ItemProcessRegister() {
  const pageLayout = useContext(PageRibbonContext);
  const [filterOpen, setFilterOpen] = useState(true);
  const [header, setHeader] = useState(emptyHeader);
  const [sources, setSources] = useState([]);
  const [selectedDetailIds, setSelectedDetailIds] = useState([]);
  const selectionAnchorRef = useRef('');
  const lastAddTargetRef = useRef(null);
  const productNumberCounterRef = useRef({});
  const [documents, setDocuments] = useState([]);
  const documentSubtotalRef = useRef(null);
  const documentCacheRef = useRef(new Map());
  const detailRequestIdRef = useRef(0);
  const [deleteDocumentNos, setDeleteDocumentNos] = useState([]);
  const [deleteDocumentsOpen, setDeleteDocumentsOpen] = useState(false);
  const [documentColumnWidths, setDocumentColumnWidths] = useState({});
  const [detailColumnWidths, setDetailColumnWidths] = useState({});
  const [options, setOptions] = useState({ customers: [], warehouses: [], rules: [] });
  const [stockOpen, setStockOpen] = useState(false);
  const [selectedProcessno, setSelectedProcessno] = useState('');
  const [selectedProcessEditable, setSelectedProcessEditable] = useState(false);
  const readOnly = Boolean(selectedProcessno) && !selectedProcessEditable;
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filters, setFilters] = useState({ q: '', date_from: `${today().slice(0, 8)}01`, date_to: today() });

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    documentCacheRef.current.clear();
    try {
      const { data } = await axios.get('/api/item-process-register/documents', { ...authConfig(), params: Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) });
      setDocuments(data.items || []);
    } catch (error) { notifications.show({ title: '가공 조회 실패', message: error.response?.data?.detail || '가공전표를 조회하지 못했습니다.', color: 'red' }); }
    finally { setLoading(false); }
  }, [filters]);

  useEffect(() => { void loadDocuments(); }, [loadDocuments]);
  useEffect(() => {
    axios.get('/api/item-process-register/options', authConfig()).then(({ data }) => setOptions(data)).catch(() => notifications.show({ title: '기준정보 조회 실패', message: '가공처·창고·가공공정을 조회하지 못했습니다.', color: 'red' }));
  }, []);

  const reset = useCallback(() => { detailRequestIdRef.current += 1; setDetailLoading(false); setHeader(emptyHeader()); setSources([]); setSelectedDetailIds([]); selectionAnchorRef.current = ''; lastAddTargetRef.current = null; setSelectedProcessno(''); setSelectedProcessEditable(false); }, []);
  const fetchDocument = useCallback((processno) => {
    const cache = documentCacheRef.current;
    if (!cache.has(processno)) {
      const request = axios.get(`/api/item-process-register/documents/${encodeURIComponent(processno)}`, authConfig())
        .then(({ data }) => data)
        .catch((error) => {
          if (cache.get(processno) === request) cache.delete(processno);
          throw error;
        });
      cache.set(processno, request);
    }
    return cache.get(processno);
  }, []);
  const prefetchDocument = useCallback((processno) => {
    void fetchDocument(processno).catch(() => {});
  }, [fetchDocument]);
  const openDocument = useCallback(async (processno) => {
    if (processno === selectedProcessno) return;
    const requestId = ++detailRequestIdRef.current;
    setSelectedProcessno(processno);
    setSelectedProcessEditable(false);
    setDetailLoading(true);
    setHeader(emptyHeader());
    setSources([]);
    setSelectedDetailIds([]);
    selectionAnchorRef.current = '';
    lastAddTargetRef.current = null;
    try {
      const data = await fetchDocument(processno);
      if (requestId !== detailRequestIdRef.current) return;
      setSelectedDetailIds([]);
      selectionAnchorRef.current = '';
      setSelectedProcessEditable(Boolean(data.header.can_edit));
      setHeader({
        processdate: String(data.header.processdate || '').slice(0, 10), customcode: data.header.customcode || '',
        customname: data.header.customname || '', warehousecode: data.header.warehousecode || '',
        warehousecodename: data.header.warehousecodename || '', manager: data.header.manager || '', description: data.header.description || '',
      });
      setSources((data.sources || []).map(({ source, products }) => {
        const parentLineNumbers = new Set(products.map((product) => product.parentlineno).filter((lineno) => lineno != null && lineno !== source.lineno));
        return {
          id: `source-${source.lineno}`,
          stock: {
            sourcetype: source.stocksourcetype, sourceno: source.stocksourceno, sourceline: source.stocksourceline,
            itemcode: source.itemcode, itemname: source.itemname, productname: source.productname,
            materialcode: source.materialcode, materialname: source.materialname, surfacecode: source.surfacecode,
            surfacename: source.surfacename, myrtle: source.myrtle, thickness: source.thickness, width: source.width,
            length: source.length, qtyunit: source.qtyunit, warehousecode: source.sourcewarehousecode,
            warehousecodename: source.sourcewarehousecodename,
          },
          qty: String(source.qty), weight: String(source.weight),
          products: products.map((product) => ({
            id: `saved-${product.lineno}`,
            parentId: product.parentlineno === source.lineno ? null : `saved-${product.parentlineno}`,
            processid: product.processid || '', processcodename: product.processcodename || '',
            productno: parentLineNumbers.has(product.lineno) ? '' : product.productname || '', productname: product.itemname || '', thickness: product.thickness ?? '', width: product.width ?? '',
            length: product.length ?? '', qty: String(product.qty), qtyunit: product.qtyunit || '',
            weight: String(product.weight), unit: product.unit || 'KG', unitprice: String(product.unitprice || 0),
            description: product.description || '',
          })),
        };
      }));
    } catch (error) {
      if (requestId === detailRequestIdRef.current) {
        setSelectedProcessno('');
        notifications.show({ title: '가공 상세 조회 실패', message: error.response?.data?.detail || '가공 상세를 조회하지 못했습니다.', color: 'red' });
      }
    } finally {
      if (requestId === detailRequestIdRef.current) {
        setDetailLoading(false);
      }
    }
  }, [fetchDocument, selectedProcessno]);
  const addStocks = (rows) => {
    const addedSources = rows.map((row) => ({ id: uid(), stock: row, qty: String(row.input_qty), weight: String(row.input_weight), products: [] }));
    setSources((current) => [...current, ...addedSources]);
    const addedIds = addedSources.map((source) => source.id);
    setSelectedDetailIds(addedIds);
    selectionAnchorRef.current = addedIds.at(-1) || '';
    lastAddTargetRef.current = addedIds.length ? { sourceId: addedIds.at(-1), parentId: null } : null;
  };
  const allocateProductno = useCallback(async (sourceProductname) => {
    const productdate = header.processdate || today();
    const datePart = productdate.replaceAll('-', '');
    const baseProductname = String(sourceProductname || '').trim();
    const counterKey = `${baseProductname}|${datePart}`;
    const cachedNext = productNumberCounterRef.current[counterKey];
    if (cachedNext != null) {
      productNumberCounterRef.current[counterKey] = cachedNext + 1;
      return `${baseProductname}-${datePart}${String(cachedNext).padStart(5, '0')}`;
    }
    const { data } = await axios.post('/api/item-process-register/product-numbers/next', { productdate, source_productname: baseProductname }, authConfig());
    productNumberCounterRef.current[counterKey] = Number(String(data.productno).slice(-5)) + 1;
    return data.productno;
  }, [header.processdate]);
  const addProduct = useCallback(async (sourceId, parentId = null) => {
    if (readOnly) return;
    lastAddTargetRef.current = { sourceId, parentId };
    try {
      const source = sources.find((item) => item.id === sourceId);
      if (!source) return;
      const parent = parentId ? source.products.find((item) => item.id === parentId) : null;
      const parentAlreadyHasChildren = parentId && source.products.some((item) => item.parentId === parentId);
      const productno = parent?.productno && !parentAlreadyHasChildren
        ? parent.productno
        : await allocateProductno(source.stock.productname || source.stock.itemname || source.stock.itemcode);
      setSources((current) => current.map((source) => source.id === sourceId ? {
        ...source, products: [...source.products.map((product) => product.id === parentId ? { ...product, productno: '' } : product), { id: uid(), parentId, processid: '', processcodename: '', productno, productname: '', thickness: source.stock.thickness ?? '', width: source.stock.width ?? '', length: source.stock.length ?? '', qty: '1', qtyunit: source.stock.qtyunit || 'EA', weight: '', unit: 'KG', unitprice: '0', description: '' }],
      } : source));
    } catch (error) {
      const detail = error.response?.data?.detail;
      const message = typeof detail === 'string'
        ? detail
        : Array.isArray(detail)
          ? detail.map((item) => item?.msg).filter(Boolean).join(' ')
          : '제품번호를 자동으로 채번하지 못했습니다.';
      notifications.show({ title: '제품번호 채번 실패', message, color: 'red' });
    }
  }, [allocateProductno, readOnly, sources]);
  const copySelectedDetail = useCallback(async () => {
    if (readOnly || saving) return;
    if (selectedDetailIds.length !== 1) {
      notifications.show({ title: '복사할 행 선택', message: '복사할 가공품 행을 한 개 선택해 주세요.', color: 'orange' });
      return;
    }
    const selectedId = selectedDetailIds[0];
    const source = sources.find((item) => item.products.some((product) => product.id === selectedId));
    const selectedProduct = source?.products.find((product) => product.id === selectedId);
    if (!source || !selectedProduct) {
      notifications.show({ title: '복사할 행 선택', message: '원소재가 아닌 가공품 행을 선택해 주세요.', color: 'orange' });
      return;
    }
    try {
      const copiedProduct = { ...selectedProduct, id: uid(), productno: await allocateProductno(source.stock.productname || source.stock.itemname || source.stock.itemcode) };
      lastAddTargetRef.current = { sourceId: source.id, parentId: selectedProduct.parentId || null };
      setSources((current) => current.map((item) => item.id === source.id
        ? { ...item, products: [...item.products, copiedProduct] }
        : item));
      setSelectedDetailIds([copiedProduct.id]);
      selectionAnchorRef.current = copiedProduct.id;
      notifications.show({ title: '가공품 행 복사 완료', message: '새 제품명을 채번해 선택한 행의 입력값을 복사했습니다.', color: 'teal' });
    } catch (error) {
      notifications.show({ title: '제품명 채번 실패', message: error.response?.data?.detail || '제품명을 자동으로 채번하지 못했습니다.', color: 'red' });
    }
  }, [allocateProductno, readOnly, saving, selectedDetailIds, sources]);
  const handleAdd = useCallback(() => {
    if (readOnly) {
      notifications.show({ title: '수정할 수 없는 전표', message: '가공품이 출고되었거나 후속 가공에 사용되어 수정할 수 없습니다.', color: 'orange' });
      return;
    }
    if (selectedDetailIds.length) {
      const selectedSources = selectedDetailIds.filter((id) => sources.some((source) => source.id === id));
      const selectedProducts = selectedDetailIds.filter((id) => sources.some((source) => source.products.some((product) => product.id === id)));
      if (selectedSources.length === selectedDetailIds.length) {
        selectedSources.forEach((sourceId) => addProduct(sourceId));
        lastAddTargetRef.current = { sourceId: selectedSources.at(-1), parentId: null };
        setSelectedDetailIds([]);
        selectionAnchorRef.current = '';
        return;
      }
      if (selectedDetailIds.length === 1 && selectedProducts.length === 1) {
        const parentSource = sources.find((item) => item.products.some((product) => product.id === selectedProducts[0]));
        if (parentSource) {
          lastAddTargetRef.current = { sourceId: parentSource.id, parentId: selectedProducts[0] };
          addProduct(parentSource.id, selectedProducts[0]);
          setSelectedDetailIds([]);
          selectionAnchorRef.current = '';
          return;
        }
      }
    }
    const rememberedTarget = lastAddTargetRef.current;
    const rememberedSource = rememberedTarget && sources.find((source) => source.id === rememberedTarget.sourceId);
    const rememberedParentExists = !rememberedTarget?.parentId || rememberedSource?.products.some((product) => product.id === rememberedTarget.parentId);
    if (rememberedSource && rememberedParentExists) {
      addProduct(rememberedSource.id, rememberedTarget.parentId || null);
      return;
    }
    if (sources.length) {
      const lastSource = sources.at(-1);
      lastAddTargetRef.current = { sourceId: lastSource.id, parentId: null };
      addProduct(lastSource.id);
      return;
    }
    setStockOpen(true);
  }, [readOnly, selectedDetailIds, sources, addProduct]);
  const updateProduct = (sourceId, productId, field, value) => setSources((current) => current.map((source) => source.id === sourceId ? { ...source, products: source.products.map((product) => product.id === productId ? { ...product, [field]: value } : product) } : source));
  const updateProductWeight = (sourceId, productId, value) => {
    const source = sources.find((item) => item.id === sourceId);
    const product = source?.products.find((item) => item.id === productId);
    if (!source || !product) return false;

    const parent = product.parentId
      ? source.products.find((item) => item.id === product.parentId)
      : null;
    const parentWeight = parent ? num(parent.weight) : num(source.weight);
    const siblingWeight = source.products
      .filter((item) => item.parentId === (product.parentId || null) && item.id !== productId)
      .reduce((sum, item) => sum + num(item.weight), 0);
    const availableWeight = Math.max(0, parentWeight - siblingWeight);
    if (num(value) > availableWeight + 1e-9) {
      notifications.show({
        title: '가공 중량 초과',
        message: `상위 중량 ${numberText(parentWeight)} KG 중 남은 ${numberText(availableWeight)} KG까지 입력할 수 있습니다.`,
        color: 'orange',
      });
      return false;
    }

    const childWeight = source.products
      .filter((item) => item.parentId === productId)
      .reduce((sum, item) => sum + num(item.weight), 0);
    if (num(value) + 1e-9 < childWeight) {
      notifications.show({
        title: '상위 중량 확인',
        message: `하위 가공품 중량 합계 ${numberText(childWeight)} KG보다 작게 입력할 수 없습니다.`,
        color: 'orange',
      });
      return false;
    }

    updateProduct(sourceId, productId, 'weight', value);
    return true;
  };
  const detailRowIds = sources.flatMap((source) => [source.id, ...orderProducts(source.products).map(({ product }) => product.id)]);
  const allDetailsSelected = detailRowIds.length > 0 && detailRowIds.every((id) => selectedDetailIds.includes(id));
  const toggleDetailSelection = (id, shiftKey = false) => setSelectedDetailIds((current) => {
    const from = detailRowIds.indexOf(selectionAnchorRef.current);
    const to = detailRowIds.indexOf(id);
    if (shiftKey && from >= 0 && to >= 0) {
      selectionAnchorRef.current = id;
      return [...new Set([...current, ...detailRowIds.slice(Math.min(from, to), Math.max(from, to) + 1)])];
    }
    selectionAnchorRef.current = id;
    return current.includes(id) ? current.filter((selectedId) => selectedId !== id) : [...current, id];
  });
  const deleteSelectedDetails = useCallback(() => {
    if (readOnly || !selectedDetailIds.length) return;
    const selected = new Set(selectedDetailIds);
    setSources((current) => current.flatMap((source) => {
      if (selected.has(source.id)) return [];
      const removed = new Set(source.products.filter((product) => selected.has(product.id)).map((product) => product.id));
      let changed = true;
      while (changed) {
        changed = false;
        source.products.forEach((product) => {
          if (product.parentId && removed.has(product.parentId) && !removed.has(product.id)) {
            removed.add(product.id);
            changed = true;
          }
        });
      }
      return [{ ...source, products: source.products.filter((product) => !removed.has(product.id)) }];
    }));
    setSelectedDetailIds([]);
    selectionAnchorRef.current = '';
  }, [readOnly, selectedDetailIds]);
  const requestToolbarDelete = useCallback(() => {
    if (detailLoading) return;
    if (selectedProcessno) {
      setDeleteDocumentNos([selectedProcessno]);
      setDeleteDocumentsOpen(true);
      return;
    }
    if (selectedDetailIds.length) {
      deleteSelectedDetails();
      return;
    }
    notifications.show({ title: '삭제할 항목 없음', message: '가공목록의 전표 또는 상세 행을 선택해 주세요.', color: 'orange' });
  }, [detailLoading, selectedProcessno, selectedDetailIds.length, deleteSelectedDetails]);
  const confirmDeleteDocuments = useCallback(async () => {
    if (!deleteDocumentNos.length || saving) return;
    setSaving(true);
    try {
      const { data } = await axios.post('/api/item-process-register/documents/delete', { processnos: deleteDocumentNos }, authConfig());
      if (deleteDocumentNos.includes(selectedProcessno)) reset();
      setDeleteDocumentsOpen(false);
      setDeleteDocumentNos([]);
      const deletedProcessno = data.deleted?.[0] || deleteDocumentNos[0];
      notifications.show({ title: '재고가공 삭제 완료', message: `${deletedProcessno} 전표를 삭제했습니다.`, color: 'teal' });
      await loadDocuments();
    } catch (error) {
      notifications.show({ title: '재고가공 삭제 실패', message: error.response?.data?.detail || '현재고와 수불 내역을 복구하지 못해 가공전표를 삭제하지 못했습니다.', color: 'red' });
    } finally { setSaving(false); }
  }, [deleteDocumentNos, saving, selectedProcessno, reset, loadDocuments]);
  const chooseRule = (source, product, processid) => {
    const itemcode = String(source.stock.itemcode || '').trim();
    const selectedProcessId = String(processid || '').trim();
    const rule = options.rules.find((item) => String(item.itemcode || '').trim() === itemcode
      && String(item.processid || '').trim() === selectedProcessId);
    const process = options.processes?.find((item) => String(item.processid || '').trim() === selectedProcessId);
    setSources((current) => current.map((item) => item.id === source.id ? {
      ...item,
      products: item.products.map((row) => row.id === product.id ? {
        ...row, processid: selectedProcessId, processcodename: process?.processname || rule?.processname || '',
        productname: rule?.productname || row.productname,
      } : row),
    } : item));
  };

  const totalSourceWeight = sources.reduce((sum, row) => sum + num(row.weight), 0);
  const totalLeafWeight = sources.reduce((sum, source) => {
    const parentIds = new Set(source.products.map((p) => p.parentId).filter(Boolean));
    return sum + source.products.filter((p) => !parentIds.has(p.id)).reduce((s, p) => s + num(p.weight), 0);
  }, 0);
  const leafProducts = sources.flatMap((source) => {
    const parentIds = new Set(source.products.map((p) => p.parentId).filter(Boolean));
    return source.products.filter((p) => !parentIds.has(p.id));
  });
  const totalLeafQty = leafProducts.reduce((sum, product) => sum + num(product.qty), 0);
  const totalProcessCost = sources.reduce((sum, source) => sum + source.products.reduce((productSum, product) => {
    const basis = String(product.unit || 'KG').toUpperCase() === 'KG' ? num(product.weight) : num(product.qty);
    return productSum + basis * num(product.unitprice);
  }, 0), 0);
  const weightDifference = totalSourceWeight - totalLeafWeight;
  const isWeightBalanced = sources.length > 0 && sources.every(isSourceWeightBalanced);
  const weightStatusText = isWeightBalanced
    ? '중량 정산 완료'
    : !sources.length
      ? '현재고 원소재를 선택해 주세요.'
      : Math.abs(weightDifference) > 1e-9
        ? `제품 중량 ${numberText(Math.abs(weightDifference))} KG ${weightDifference > 0 ? '부족' : '초과'}`
        : '원소재별 중량 합계를 확인해 주세요.';

  const autoMatchWeight = () => {
    if (!sources.length || sources.some((source) => !source.products.length || num(source.weight) <= 0)) {
      notifications.show({ title: '중량 자동맞춤 확인', message: '현재고 원소재와 가공품을 먼저 추가해 주세요.', color: 'orange' });
      return;
    }
    const rebalanceTree = (allProducts, products, targetWeight, updatedWeights) => {
      if (!products.length) return;
      const targetMilliKg = Math.max(0, Math.round(targetWeight * 1000));
      const evenShareMilliKg = Math.floor(targetMilliKg / products.length);
      let assigned = 0;
      products.forEach((product, index) => {
        const shareMilliKg = index === products.length - 1
          ? targetMilliKg - assigned
          : evenShareMilliKg;
        assigned += shareMilliKg;
        updatedWeights.set(product.id, (shareMilliKg / 1000).toFixed(3));
        const children = allProducts.filter((item) => item.parentId === product.id);
        if (children.length) rebalanceTree(allProducts, children, shareMilliKg / 1000, updatedWeights);
      });
    };
    setSources((current) => current.map((source) => {
      const updatedWeights = new Map();
      rebalanceTree(source.products, source.products.filter((product) => !product.parentId), num(source.weight), updatedWeights);
      return { ...source, products: source.products.map((product) => ({ ...product, weight: updatedWeights.get(product.id) ?? product.weight })) };
    }));
    notifications.show({ title: '중량 자동맞춤 완료', message: '각 가공 단계의 중량을 원소재 투입 중량에 맞췄습니다.', color: 'teal' });
  };

  const save = useCallback(async () => {
    if (readOnly) return;
    if (!header.customcode || !header.warehousecode || !sources.length) {
      notifications.show({ title: '입력 확인', message: '가공일자·가공처·창고와 현재고 원소재를 확인해 주세요.', color: 'orange' }); return;
    }
    if (sources.some((source) => !source.products.length || source.products.some((p) => !p.processid || !p.productname || num(p.qty) <= 0 || num(p.weight) <= 0))) {
      notifications.show({ title: '가공 상세 확인', message: '각 원소재의 가공공정·가공품명·수량·중량을 입력해 주세요.', color: 'orange' }); return;
    }
    if (!sources.every(isSourceWeightBalanced)) {
      notifications.show({
        title: '중량 정산 확인',
        message: '각 원소재의 투입중량과 가공품 중량 합계를 같게 맞춰야 저장할 수 있습니다. 중량 자동맞춤을 사용해 주세요.',
        color: 'orange',
      }); return;
    }
    setSaving(true);
    try {
      const payload = { ...header, ...(selectedProcessno ? { processno: selectedProcessno } : {}), sources: sources.map((source) => ({ stocksourcetype: source.stock.sourcetype, stocksourceno: source.stock.sourceno, stocksourceline: source.stock.sourceline, qty: num(source.qty), weight: num(source.weight), products: source.products.map((p) => ({ clientid: p.id, parent_clientid: p.parentId, processid: p.processid, processcodename: p.processcodename, productno: p.productno, productname: p.productname, thickness: p.thickness === '' ? null : num(p.thickness), width: p.width === '' ? null : num(p.width), length: p.length === '' ? null : num(p.length), qty: num(p.qty), qtyunit: source.stock.qtyunit || p.qtyunit, weight: num(p.weight), unit: p.unit, unitprice: num(p.unitprice), description: p.description })) })) };
      const { data } = await axios.post('/api/item-process-register/documents', payload, authConfig());
      if (data.product_numbers) {
        setSources((current) => current.map((source) => ({ ...source, products: source.products.map((product) => ({ ...product, productno: data.product_numbers[product.id] || product.productno })) })));
      }
      const wasEditing = Boolean(selectedProcessno);
      notifications.show({ title: wasEditing ? '가공 수정 완료' : '가공 등록 완료', message: `${data.processno} 전표가 현재고와 수불장에 반영되었습니다.`, color: 'teal' });
      if (!wasEditing) reset();
      await loadDocuments();
    } catch (error) { notifications.show({ title: '가공 저장 실패', message: error.response?.data?.detail || '가공전표를 저장하지 못했습니다.', color: 'red' }); }
    finally { setSaving(false); }
  }, [header, sources, selectedProcessno, readOnly, reset, loadDocuments]);

  useEffect(() => {
    if (!pageLayout?.registerPageRibbon) return undefined;
    const canDelete = Boolean(selectedProcessno) || (!selectedProcessno && selectedDetailIds.length > 0);
    pageLayout.registerPageRibbon(<ErpRibbon onSearch={loadDocuments} onAdd={handleAdd} onCopy={copySelectedDetail} onSave={save} onDelete={requestToolbarDelete} onClose={pageLayout.closeActivePage}
      showPrint={false} useSaveColor disabled={{ copy: readOnly || saving || selectedDetailIds.length !== 1, excel: true, delete: !canDelete || saving || detailLoading, save: saving || readOnly }} loading={{ search: loading, save: saving, delete: saving }} />);
    return () => pageLayout.registerPageRibbon(null);
  }, [pageLayout, loadDocuments, handleAdd, copySelectedDetail, save, requestToolbarDelete, saving, loading, detailLoading, selectedProcessno, selectedDetailIds.length, readOnly]);

  const customerData = options.customers.map((x) => ({ value: x.code, label: x.name }));
  const warehouseData = options.warehouses.map((x) => ({ value: x.code, label: x.name }));
  const existingKeys = new Set(sources.map((x) => sourceKey(x.stock)));
  const documentTableWidth = Math.max(1000, DOCUMENT_COLUMNS.reduce((sum, column) => sum + (documentColumnWidths[column.key] ?? column.width), 0));
  const detailTableWidth = Math.max(1320, DETAIL_COLUMNS.reduce((sum, column) => sum + (detailColumnWidths[column.key] ?? column.width), 0));
  const documentSubtotals = documents.reduce((totals, row) => {
    for (const key of ['detail_count', 'qty', 'weight', 'supplyamt', 'vat', 'unitamt']) totals[key] += num(row[key]);
    return totals;
  }, { detail_count: 0, qty: 0, weight: 0, supplyamt: 0, vat: 0, unitamt: 0 });
  const syncDocumentScroll = (left) => {
    const subtotal = documentSubtotalRef.current;
    if (subtotal && Math.abs(subtotal.scrollLeft - left) > 0.5) subtotal.scrollLeft = left;
  };

  return <Box className={`${sharedClasses.pageShell} ${classes.page}`}>
    <ErpBreadcrumb parent="AI 가공관리" current="재고가공" filterOpen={filterOpen} onOpenFilters={() => setFilterOpen(true)} />
    <Box className={classes.workspace}>
      <Stack gap="sm" className={classes.main}>
        <Paper withBorder className={`${sharedClasses.panel} ${classes.listPanel}`}>
          <Group className={classes.sectionHeader} justify="space-between"><Group gap={8}><Text className={classes.title}>가공 목록</Text><Badge color="gray" variant="light" className={classes.count}>{documents.length}건</Badge></Group></Group>
          <Box className={classes.documentViewport} onScroll={(event) => syncDocumentScroll(event.currentTarget.scrollLeft)}><Table className={classes.documentTable} stickyHeader highlightOnHover withTableBorder withColumnBorders style={{ width: '100%', minWidth: `${documentTableWidth}px`, tableLayout: 'fixed' }}><colgroup>{DOCUMENT_COLUMNS.map((column) => <col key={column.key} data-column-key={column.key} style={{ width: `${documentColumnWidths[column.key] ?? column.width}px` }} />)}</colgroup><Table.Thead><Table.Tr>{DOCUMENT_COLUMNS.map((column) => <Table.Th key={column.key} className={classes.resizableHeader} style={{ width: `${documentColumnWidths[column.key] ?? column.width}px` }}>{column.label}<span className={classes.columnResizeHandle} data-column-key={column.key} onPointerDown={(event) => startTableColumnResize(event, DOCUMENT_COLUMNS, documentColumnWidths, setDocumentColumnWidths, 1000)} role="separator" aria-label={`${column.label} 열 너비 조절`} /></Table.Th>)}</Table.Tr></Table.Thead><Table.Tbody>{documents.map((row) => {
            const selected = row.processno === selectedProcessno;
            return <Table.Tr key={row.processno} className={selected ? classes.selectedDocument : classes.documentRow} onMouseEnter={() => prefetchDocument(row.processno)} onClick={() => openDocument(row.processno)}>
              <Table.Td>{row.customname || '—'}</Table.Td>
              <Table.Td>{row.warehousecodename || '—'}</Table.Td>
              <Table.Td ta="right">{numberText(row.detail_count)}</Table.Td>
              <Table.Td ta="right">{numberText(row.qty)}</Table.Td>
              <Table.Td ta="right">{numberText(row.weight)}</Table.Td>
              <Table.Td ta="right">{numberText(row.supplyamt)}</Table.Td>
              <Table.Td ta="right">{numberText(row.vat)}</Table.Td>
              <Table.Td ta="right">{numberText(row.unitamt)}</Table.Td>
              <Table.Td>{row.processno}</Table.Td>
              <Table.Td>{row.description || '—'}</Table.Td>
            </Table.Tr>;
          })}</Table.Tbody></Table>{!documents.length && <Box className={classes.documentEmptyMessage}>{loading ? '조회 중입니다.' : '등록된 가공전표가 없습니다.'}</Box>}</Box>
          <Box className={classes.documentBottom}>
            {!!documents.length && <Box ref={documentSubtotalRef} className={classes.documentSubtotalViewport} onScroll={(event) => syncDocumentScroll(event.currentTarget.scrollLeft)}>
              <Table className={`${classes.documentTable} ${classes.documentSubtotalTable}`} withTableBorder withColumnBorders style={{ width: '100%', minWidth: `${documentTableWidth}px`, tableLayout: 'fixed' }}><colgroup>{DOCUMENT_COLUMNS.map((column) => <col key={column.key} style={{ width: `${documentColumnWidths[column.key] ?? column.width}px` }} />)}</colgroup>
                <Table.Tbody><Table.Tr className={classes.documentSubtotalRow}>{DOCUMENT_COLUMNS.map((column, index) => <Table.Td key={column.key} ta={['detail_count', 'qty', 'weight', 'supplyamt', 'vat', 'unitamt'].includes(column.key) ? 'right' : undefined}>
                  {index === 0 ? '소계' : ['detail_count', 'qty', 'weight'].includes(column.key) ? numberText(documentSubtotals[column.key]) : ['supplyamt', 'vat', 'unitamt'].includes(column.key) ? `${numberText(documentSubtotals[column.key])}원` : ''}
                </Table.Td>)}</Table.Tr></Table.Tbody>
              </Table>
            </Box>}
          </Box>
        </Paper>

        <Paper withBorder className={`${sharedClasses.panel} ${classes.detailPanel}`}>
          <Group className={classes.sectionHeader} justify="space-between"><Group gap={8}><Text className={classes.title}>가공 상세</Text><Badge color="gray" variant="light" className={classes.count}>{selectedProcessno || '신규'} · {sources.length}개 원소재</Badge></Group><Group gap="sm"><Text size="xs" c={Math.abs(totalSourceWeight - totalLeafWeight) <= 0.001 ? 'teal' : 'red'}>투입 {numberText(totalSourceWeight)} KG · 최종제품 {numberText(totalLeafWeight)} KG</Text><Button size="xs" variant="light" color="red" disabled={readOnly} onClick={() => setStockOpen(true)}>현재고 조회</Button></Group></Group>
          <Box className={classes.headerGrid}>
            <TextInput label="가공일자" type="date" disabled={readOnly} value={header.processdate} onChange={(e) => setHeader((h) => ({ ...h, processdate: e.currentTarget.value }))} />
            <Select label="가공처" searchable disabled={readOnly} data={customerData} value={header.customcode || null} onChange={(value) => { const item = options.customers.find((x) => x.code === value); setHeader((h) => ({ ...h, customcode: value || '', customname: item?.name || '' })); }} />
            <Select label="입고창고" searchable disabled={readOnly} data={warehouseData} value={header.warehousecode || null} onChange={(value) => { const item = options.warehouses.find((x) => x.code === value); setHeader((h) => ({ ...h, warehousecode: value || '', warehousecodename: item?.name || '' })); }} />
            <TextInput label="담당자" disabled={readOnly} value={header.manager} onChange={(e) => setHeader((h) => ({ ...h, manager: e.currentTarget.value }))} />
            <TextInput label="비고" disabled={readOnly} value={header.description} onChange={(e) => setHeader((h) => ({ ...h, description: e.currentTarget.value }))} />
          </Box>
          <Box className={classes.detailViewport}>
            <table className={classes.detailTable} style={{ width: `${detailTableWidth}px`, minWidth: `${detailTableWidth}px` }}><colgroup>{DETAIL_COLUMNS.map((column) => <col key={column.key} data-column-key={column.key} style={{ width: `${detailColumnWidths[column.key] ?? column.width}px` }} />)}</colgroup><thead><tr>{DETAIL_COLUMNS.map((column) => <th key={column.key} className={classes.resizableHeader} style={{ width: `${detailColumnWidths[column.key] ?? column.width}px` }}>{column.key === 'select' ? detailRowIds.length > 0 && <input type="checkbox" aria-label="상세 전체 선택" checked={allDetailsSelected} disabled={readOnly} onChange={(event) => { setSelectedDetailIds(event.currentTarget.checked ? detailRowIds : []); selectionAnchorRef.current = ''; }} /> : column.label}<span className={classes.columnResizeHandle} data-column-key={column.key} onPointerDown={(event) => startTableColumnResize(event, DETAIL_COLUMNS, detailColumnWidths, setDetailColumnWidths, 1320)} role="separator" aria-label={`${column.label || '선택'} 열 너비 조절`} /></th>)}</tr></thead>
              <tbody>{sources.flatMap((source, sourceIndex) => {
                const sourceRow = <tr className={classes.sourceRow} key={source.id}><td className={classes.checkCell}><input type="checkbox" aria-label={`원소재 ${sourceIndex + 1} 선택`} checked={selectedDetailIds.includes(source.id)} disabled={readOnly} onChange={(event) => toggleDetailSelection(source.id, event.nativeEvent.shiftKey)} /></td><td className={classes.noCell}><div className={classes.noCellContent}><span className={classes.sourceNoLabel}><span>{sourceIndex + 1}</span><Badge size="xs" variant="light">원소재</Badge></span><ActionIcon size="xs" variant="subtle" color="red" disabled={readOnly} title="가공품 추가" onClick={() => addProduct(source.id)}><IconPlus size={13} /></ActionIcon></div></td><td>재고 연결</td><td></td><td>{source.stock.itemname}</td><td>{source.stock.productname || ''}</td><td>{numberText(source.stock.thickness)}</td><td>{numberText(source.stock.width)}</td><td>{numberText(source.stock.length)}</td><td>{numberText(source.qty)}</td><td>{source.stock.qtyunit}</td><td>{numberText(source.weight)}</td><td>—</td><td>—</td></tr>;
                const productRows = orderProducts(source.products).map(({ product, lineNo, isLast, ancestorContinues }) => {
                  const processOptions = options.processes || [];
                  const dimensionRule = options.rules.find((rule) => rule.itemcode === source.stock.itemcode && rule.processid === product.processid);
                  const canEditDimension = (field) => String(dimensionRule?.[`${field}yn`] || '').trim().toUpperCase() === 'Y';
                  const depth = lineNo.length;
                return <tr key={product.id}><td className={classes.checkCell}><input type="checkbox" aria-label={`가공품 ${lineNo.join('.')} 선택`} checked={selectedDetailIds.includes(product.id)} disabled={readOnly} onChange={(event) => toggleDetailSelection(product.id, event.nativeEvent.shiftKey)} /></td><td className={classes.noCell}><div className={classes.noCellContent}><span className={classes.treeNumber}>{ancestorContinues.map((continues, index) => <span key={`parent-${index}`} className={`${classes.treeGuide} ${continues ? classes.treeGuideContinue : ''}`} />)}<span className={`${classes.treeGuide} ${isLast ? classes.treeGuideLast : classes.treeGuideMiddle}`} /><span>{String(lineNo[depth - 1]).padStart(2, '0')}</span></span><ActionIcon size="xs" variant="subtle" color="red" disabled={readOnly} title="하위 가공 추가" onClick={() => addProduct(source.id, product.id)}><IconPlus size={13} /></ActionIcon></div></td><td>가공품</td><td><ProcessMethodCell product={product} options={processOptions} disabled={readOnly} onSelect={(option) => chooseRule(source, product, option?.processid || null)} /></td><td><input data-detail-field="productname" onKeyDown={handleDetailGridKeyDown} disabled={readOnly} value={product.productname} onChange={(e) => updateProduct(source.id, product.id, 'productname', e.target.value)} /></td><td><input data-detail-field="productno" onKeyDown={handleDetailGridKeyDown} disabled={readOnly} maxLength={150} value={product.productno} onChange={(e) => updateProduct(source.id, product.id, 'productno', e.target.value)} /></td>{['thickness', 'width', 'length'].map((field) => <td key={field}><DetailNumericInput field={field} value={product[field]} disabled={readOnly || !canEditDimension(field)} onCommit={(value) => updateProduct(source.id, product.id, field, value)} /></td>)}<td><DetailNumericInput field="qty" value={product.qty} disabled={readOnly} onCommit={(value) => updateProduct(source.id, product.id, 'qty', value)} /></td><td><input data-detail-field="qtyunit" disabled value={source.stock.qtyunit || product.qtyunit || 'EA'} /></td><td><DetailNumericInput field="weight" value={product.weight} disabled={readOnly} onCommit={(value) => updateProductWeight(source.id, product.id, value)} /></td><td><DetailNumericInput field="unitprice" value={product.unitprice} disabled={readOnly} onCommit={(value) => updateProduct(source.id, product.id, 'unitprice', value)} /></td><td>{numberText(num(product.weight) * num(product.unitprice))}</td></tr>;
                });
                return [sourceRow, ...productRows];
              })}</tbody>
            </table>
            {detailLoading ? <Box className={classes.detailLoading}><Loader size="sm" color="red" /></Box> : !sources.length && <Box className={classes.detailEmpty}>현재고 조회에서 가공할 원소재를 선택해 주세요.</Box>}
          </Box>
          <Group className={classes.tableSummary} gap="lg" wrap="nowrap">
            <Text>수량 <strong>{numberText(totalLeafQty)}</strong></Text>
            <Text>중량 합계 <strong>{numberText(totalLeafWeight)} KG</strong></Text>
            <Text>제품 수율 <strong>{totalSourceWeight > 0 ? (totalLeafWeight / totalSourceWeight * 100).toFixed(2) : '0.00'}%</strong></Text>
            <Text className={classes.costSummary}>가공비 합계 <strong>{numberText(totalProcessCost)} 원</strong></Text>
          </Group>
          <Group className={`${classes.balanceStrip} ${isWeightBalanced ? classes.balanced : ''}`} justify="space-between" wrap="nowrap">
            <Group gap="lg" wrap="nowrap">
              <Box><Text className={classes.balanceCaption}>소재 투입</Text><Text className={classes.balanceAmount}>{numberText(totalSourceWeight)} kg</Text></Box>
              <Text className={classes.balanceOperator}>−</Text>
              <Box><Text className={classes.balanceCaption}>제품 중량</Text><Text className={classes.balanceAmount}>{numberText(totalLeafWeight)} kg</Text></Box>
              <Text className={classes.balanceOperator}>−</Text>
              <Box><Text className={classes.balanceCaption}>미정산 중량</Text><Text className={classes.balanceAmount}>{numberText(Math.abs(weightDifference))} kg</Text></Box>
            </Group>
            <Group gap="md" wrap="nowrap" className={classes.balanceResult}>
              <Box ta="right"><Text fw={700} c={isWeightBalanced ? 'teal' : sources.length ? 'red' : 'dimmed'}>{weightStatusText}</Text><Text size="xs" c="dimmed">미정산 {numberText(Math.abs(weightDifference))} kg</Text></Box>
              <Button size="xs" variant="light" color="red" disabled={readOnly} onClick={autoMatchWeight}>↔ 중량 자동맞춤</Button>
            </Group>
          </Group>
        </Paper>
      </Stack>
      {filterOpen && <Paper component="aside" withBorder className={classes.filter}><Group className={classes.filterHeader} justify="space-between"><Text>조회조건</Text><ActionIcon variant="subtle" color="gray" onClick={() => setFilterOpen(false)}><IconX size={16} /></ActionIcon></Group><Stack gap="sm" p="sm"><TextInput label="가공기간" type="date" value={filters.date_from} onChange={(e) => setFilters((f) => ({ ...f, date_from: e.currentTarget.value }))} /><TextInput type="date" value={filters.date_to} onChange={(e) => setFilters((f) => ({ ...f, date_to: e.currentTarget.value }))} /><TextInput label="가공번호/가공처" value={filters.q} onChange={(e) => setFilters((f) => ({ ...f, q: e.currentTarget.value }))} onKeyDown={(e) => e.key === 'Enter' && loadDocuments()} /></Stack></Paper>}
    </Box>
    <Modal opened={deleteDocumentsOpen} onClose={() => !saving && setDeleteDocumentsOpen(false)} title="가공전표 삭제" centered size="sm">
      <Stack gap="md">
        <Text size="sm" c="dimmed">{deleteDocumentNos[0]} 전표와 상세 내역을 삭제합니다. 삭제한 전표는 복구할 수 없습니다.</Text>
        <Group justify="flex-end">
          <Button variant="default" disabled={saving} onClick={() => setDeleteDocumentsOpen(false)}>취소</Button>
          <Button color="red" leftSection={<IconTrash size={15} />} loading={saving} onClick={confirmDeleteDocuments}>삭제</Button>
        </Group>
      </Stack>
    </Modal>
    <StockPicker opened={stockOpen} onClose={() => setStockOpen(false)} onApply={addStocks} existingKeys={existingKeys} />
  </Box>;
}
