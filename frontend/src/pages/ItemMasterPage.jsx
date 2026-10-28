import { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Group,
  Loader,
  Modal,
  Pagination,
  Paper,
  Popover,
  ScrollArea,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconDownload, IconSearch, IconTrash, IconUpload, IconX } from '@tabler/icons-react';
import { TableVirtuoso } from 'react-virtuoso';
import * as XLSX from 'xlsx';
import { applyExcelHeaderStyle } from '../utils/excelHeaderStyle';
import ErpBreadcrumb from '../components/common/ErpBreadcrumb';
import ErpRibbon from '../components/common/ErpRibbon';
import { PageRibbonContext } from '../components/layout/MainLayout';
import sharedClasses from '../styles/pages/ManagementShared.module.css';
import classes from '../styles/pages/ItemMaster.module.css';
import inboundClasses from '../styles/pages/InboundRegister.module.css';
import outboundClasses from '../styles/pages/OutboundRegister.module.css';
import codeClasses from '../styles/pages/CodeMasterPage.module.css';

const authHeaders = () => ({
  Authorization: `Bearer ${localStorage.getItem('access_token') || ''}`,
});

const FIELDS = [
  { key: 'itemcode', label: '품목코드', width: 150, required: true },
  { key: 'itemname', label: '품목명', width: 190, required: true },
  { key: 'itemtypecode', label: '형태구분', width: 170, required: true },
  { key: 'use_yn', label: '사용여부', width: 105 },
  { key: 'description', label: '설명', width: 200 },
];
const EDITABLE_FIELDS = FIELDS.map(({ key }) => key);
const ITEM_FIELD_LABELS = Object.fromEntries(FIELDS.map(({ key, label }) => [key, label]));
const EMPTY_ITEM = {
  itemcode: '', itemname: '', itemtypecode: '', use_yn: 'Y', description: '',
};

const saveFailureNotice = (error, changed, rows, filteredRows, source = 'table') => {
  const detail = error.response?.data?.detail;
  const rowNumber = (row) => {
    const visibleIndex = filteredRows.findIndex((candidate) => candidate.id === row?.id);
    const index = visibleIndex >= 0 ? visibleIndex : rows.findIndex((candidate) => candidate.id === row?.id);
    return index >= 0 ? index + 1 : null;
  };

  if (Array.isArray(detail) && detail.length) {
    const messages = detail.slice(0, 5).map((issue) => {
      const location = Array.isArray(issue.loc) ? issue.loc : [];
      const itemsIndex = location.indexOf('items');
      const batchIndex = itemsIndex >= 0 ? Number(location[itemsIndex + 1]) : -1;
      const row = Number.isInteger(batchIndex) && batchIndex >= 0 ? changed[batchIndex] : null;
      const number = source === 'excel' && row ? batchIndex + 2 : rowNumber(row);
      const rowPrefix = number ? (source === 'excel' ? '엑셀 ' : '') + number + '행 ' : '';
      const field = location.at(-1);
      const rawReason = String(issue.msg || '서버 검증 실패').replace(/^Value error,\s*/i, '');
      if (field && ITEM_FIELD_LABELS[field]) return rowPrefix + ITEM_FIELD_LABELS[field] + ' (' + field + '): ' + rawReason;
      if (field && field !== 'items' && field !== 'body') {
        return rowPrefix + '전송 필드 "' + field + '"를 서버가 인식하지 못했습니다. 키 매핑을 확인해 주세요. (' + rawReason + ')';
      }
      return rowPrefix + rawReason;
    });
    return {
      title: '입력 데이터 검증 실패',
      message: messages.join(' / ') + (detail.length > 5 ? ' 외 ' + (detail.length - 5) + '건' : ''),
      color: 'orange',
    };
  }

  if (typeof detail === 'string' && detail.trim()) {
    if (/중복.*품목코드|이미 등록된 품목코드/i.test(detail)) {
      const conflict = changed.find((item) => item.itemcode && detail.includes(String(item.itemcode).trim()));
      const conflictIndex = conflict ? changed.indexOf(conflict) : -1;
      const fileRow = source === 'excel' && conflictIndex >= 0 ? ' 엑셀 ' + (conflictIndex + 2) + '행' : '';
      return { title: '품목코드 중복', message: detail + fileRow + ' 입력 행과 기존 품목의 코드를 확인해 주세요.', color: 'orange' };
    }
    if (/형태구분/.test(detail)) {
      const conflict = changed.find((item) => item.itemcode && detail.includes(String(item.itemcode).trim()));
      const conflictIndex = conflict ? changed.indexOf(conflict) : -1;
      const fileRow = source === 'excel' && conflictIndex >= 0 ? ' 엑셀 ' + (conflictIndex + 2) + '행' : '';
      return { title: '형태구분 확인 필요', message: detail + fileRow + ' 코드마스터의 SHAPE 그룹에서 코드와 사용 상태를 확인해 주세요.', color: 'orange' };
    }
    if (error.response?.status >= 500) {
      return { title: '서버 저장 오류', message: detail + ' 서버 로그와 데이터베이스 제약 조건을 확인해 주세요.', color: 'red' };
    }
    return { title: '저장 실패', message: detail, color: 'orange' };
  }

  if (error.response?.status === 401 || error.response?.status === 403) {
    return { title: '저장 권한 확인 필요', message: '로그인 상태와 품목 저장 권한을 확인해 주세요.', color: 'red' };
  }
  if (!error.response) {
    return { title: '서버 연결 실패', message: '저장 API에 연결하지 못했습니다. 백엔드 실행 상태와 네트워크를 확인해 주세요.', color: 'red' };
  }
  return {
    title: '저장 실패 (HTTP ' + (error.response.status || '오류') + ')',
    message: '서버 응답에 상세 사유가 없습니다. 전송 필드 키 매핑과 백엔드 로그를 확인해 주세요.',
    color: 'red',
  };
};

const newRow = () => ({
  ...EMPTY_ITEM,
  id: `new-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  is_new: true,
  is_dirty: false,
});

const normalizeImportedRow = (raw) => {
  const normalize = (value) => String(value ?? '').trim().toLowerCase().replace(/[\s_]/g, '');
  const aliases = {
    itemcode: ['itemcode', '품목코드'], itemname: ['itemname', '품목명'],
    itemtypecode: ['itemtypecode', '형태구분'],
    use_yn: ['useyn', '사용여부'], description: ['description', '설명', '비고'],
  };
  const source = Object.fromEntries(Object.entries(raw).map(([key, value]) => [normalize(key), value]));
  const item = { ...EMPTY_ITEM, use_yn: '' };
  for (const [field, names] of Object.entries(aliases)) {
    const match = names.find((name) => source[normalize(name)] !== undefined);
    if (match) item[field] = String(source[normalize(match)] ?? '').trim();
  }
  item.use_yn = item.use_yn.trim().toUpperCase();
  return item;
};

const normalizeShapeInput = (value) => String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
const resolveShapeCode = (value, options) => {
  const normalized = normalizeShapeInput(value);
  if (!normalized) return '';
  const matchedShape = options.find((option) => [option.code, option.name]
    .some((candidate) => normalizeShapeInput(candidate) === normalized));
  return matchedShape?.code || String(value).trim();
};

const ItemCells = memo(function ItemCells({ item, index, selected, disabled, shapeOptions, onSelect, onChange, onPaste, onFindShape, registerCodeInput, registerCellInput, onFocusCell, onCellKeyDown, onDelete }) {
  const selectedShape = shapeOptions.find((option) => option.code === item.itemtypecode);
  const shapeDisplay = item.itemtypecode ? (selectedShape?.name || item.itemtypecodenm || item.itemtypecode) : '';
  const [shapeCodeDraft, setShapeCodeDraft] = useState(item.itemtypecode || '');
  const [isEditingShape, setIsEditingShape] = useState(false);
  const shapeMatches = shapeCodeDraft.trim()
    ? shapeOptions.filter((option) => [option.code, option.name]
      .some((value) => normalizeShapeInput(value).includes(normalizeShapeInput(shapeCodeDraft)))).slice(0, 8)
    : [];

  const chooseShape = (option) => {
    setShapeCodeDraft(option.name || option.code);
    setIsEditingShape(false);
    onChange(item.id, 'itemtypecode', option.code);
  };

  const handlePaste = (field) => (event) => {
    const text = event.clipboardData.getData('text/plain');
    if (field === 'itemtypecode') {
      event.preventDefault();
      if (!/[\t\r\n]/.test(text)) {
        const enteredValue = text.trim();
        setShapeCodeDraft(enteredValue);
        onChange(item.id, field, resolveShapeCode(enteredValue, shapeOptions));
      } else {
        onPaste(item.id, field, text);
      }
      return;
    }
    if (!text.includes('\t') && !text.includes('\n')) return;
    event.preventDefault();
    onPaste(item.id, field, text);
  };
  return (
    <>
      <Table.Td className={codeClasses.checkCol}>
        <input type="checkbox" aria-label={`${item.itemcode || '새 품목'} 선택`} checked={selected} onChange={(event) => onSelect(item.id, event.nativeEvent.shiftKey)} />
      </Table.Td>
      <Table.Td className={codeClasses.rowNumber}>{index + 1}</Table.Td>
      {FIELDS.map(({ key, label }) => (
        <Table.Td key={key}>
          {key === 'itemtypecode' ? (
            <Popover opened={isEditingShape && shapeMatches.length > 0} position="bottom-start" withinPortal width="target" shadow="none" offset={0} zIndex={500}>
              <Popover.Target>
                <div className={classes.shapeInputTarget}>
                  <input
                    ref={(element) => registerCellInput(item.id, key, element)}
                    className={`${codeClasses.cellInput} ${outboundClasses.itemCodePickerInput} ${classes.shapePickerInput}`}
                    aria-label={label}
                    aria-autocomplete="list"
                    aria-expanded={isEditingShape && shapeMatches.length > 0}
                    data-row-id={item.id}
                    data-field={key}
                    value={isEditingShape ? shapeCodeDraft : shapeDisplay}
                    placeholder=""
                    title="형태구분 코드 또는 명칭 검색"
                    disabled={disabled}
                    onFocus={(event) => {
                      setShapeCodeDraft(shapeDisplay);
                      setIsEditingShape(true);
                      onFocusCell(item.id, key);
                      event.currentTarget.select();
                    }}
                    onBlur={() => {
                      if (!isEditingShape) return;
                      const code = shapeCodeDraft === shapeDisplay
                        ? (item.itemtypecode || '')
                        : resolveShapeCode(shapeCodeDraft, shapeOptions);
                      setIsEditingShape(false);
                      if (code !== (item.itemtypecode || '')) onChange(item.id, key, code);
                    }}
                    onChange={(event) => setShapeCodeDraft(event.currentTarget.value)}
                    onPaste={handlePaste(key)}
                    onKeyDown={(event) => {
                      if (event.key === 'F2' || event.key === ' ') {
                        event.preventDefault();
                        if (!disabled) onFindShape(item.id);
                      } else if (event.key === 'Enter' && shapeMatches.length > 0) {
                        event.preventDefault();
                        chooseShape(shapeMatches[0]);
                      } else onCellKeyDown(event);
                    }}
                    onDoubleClick={() => { if (!disabled) onFindShape(item.id); }}
                  />
                </div>
              </Popover.Target>
              <Popover.Dropdown className={classes.shapeSuggestions} role="listbox" aria-label="형태구분 검색 결과">
                {shapeMatches.map((option) => (
                  <button
                    key={option.code}
                    type="button"
                    className={classes.shapeSuggestion}
                    role="option"
                    aria-label={`${option.code} ${option.name}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => chooseShape(option)}
                  >
                    <span>{option.name}</span>
                    <small>{option.code}</small>
                  </button>
                ))}
              </Popover.Dropdown>
            </Popover>
          ) : key === 'use_yn' ? (
            <select ref={(element) => registerCellInput(item.id, key, element)} className={codeClasses.cellSelect} aria-label={label} data-row-id={item.id} data-field={key} value={item.use_yn || 'Y'} disabled={disabled} onFocus={() => onFocusCell(item.id, key)} onKeyDown={onCellKeyDown} onPaste={handlePaste(key)} onChange={(event) => onChange(item.id, key, event.currentTarget.value)}>
              <option value="Y">사용중</option>
              <option value="N">사용중지</option>
            </select>
          ) : (
            <input
              ref={(element) => {
                if (key === 'itemcode') registerCodeInput(item.id, element);
                registerCellInput(item.id, key, element);
              }}
              className={codeClasses.cellInput}
              aria-label={label}
              data-row-id={item.id}
              data-field={key}
              value={item[key] ?? ''}
              placeholder={item.is_new && (key === 'itemcode' || key === 'itemname') ? label : ''}
              readOnly={key === 'itemcode' && !item.is_new}
              disabled={disabled}
              onFocus={() => onFocusCell(item.id, key)}
              onKeyDown={onCellKeyDown}
              onPaste={handlePaste(key)}
              onChange={(event) => onChange(item.id, key, event.currentTarget.value)}
            />
          )}
        </Table.Td>
      ))}
      <Table.Td className={codeClasses.actionCol}>
        <Tooltip label="품목 삭제">
          <ActionIcon variant="subtle" color="red" aria-label="품목 삭제" disabled={disabled} onClick={() => onDelete(item)}><IconTrash size={16} /></ActionIcon>
        </Tooltip>
      </Table.Td>
    </>
  );
});

const ShapePickerModal = memo(function ShapePickerModal({ opened, onClose, options, loading, onSelect }) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const filteredOptions = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return options;
    return options.filter((option) => `${option.code} ${option.name}`.toLocaleLowerCase().includes(normalized));
  }, [options, query]);
  const pageSize = 20;
  const pageCount = Math.max(1, Math.ceil(filteredOptions.length / pageSize));
  const visibleOptions = filteredOptions.slice((page - 1) * pageSize, page * pageSize);

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={<Group gap={9} wrap="nowrap"><Box className={outboundClasses.receiptFinderTitleIcon}><IconSearch size={17} /></Box><Text className={outboundClasses.receiptFinderModalTitle} fw={750}>형태구분 선택</Text></Group>}
      classNames={{ content: outboundClasses.receiptFinderModalContent, header: outboundClasses.receiptFinderModalHeader, title: outboundClasses.receiptFinderModalTitle, close: outboundClasses.receiptFinderModalClose }}
      centered
      size="md"
    >
      <Stack gap="sm" pt={10}>
        <TextInput
          value={query}
          onChange={(event) => { setQuery(event.currentTarget.value); setPage(1); }}
          placeholder="코드 또는 코드명 검색"
          leftSection={<IconSearch size={15} />}
          autoFocus
        />
        <ScrollArea h={360} type="auto" scrollbarSize={6}>
          <Table className={inboundClasses.pickerTable} highlightOnHover withTableBorder withColumnBorders>
            <Table.Thead><Table.Tr><Table.Th>코드</Table.Th><Table.Th>코드명</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>
              {visibleOptions.map((option) => (
                <Table.Tr key={option.code} className={inboundClasses.customerResultRow} onClick={() => onSelect(option)}>
                  <Table.Td>{option.code}</Table.Td><Table.Td>{option.name}</Table.Td>
                </Table.Tr>
              ))}
              {!visibleOptions.length && <Table.Tr><Table.Td colSpan={2} className={inboundClasses.customerEmpty}>{loading ? '형태구분을 불러오는 중입니다.' : '조회된 사용중 코드가 없습니다.'}</Table.Td></Table.Tr>}
            </Table.Tbody>
          </Table>
        </ScrollArea>
        <Group justify="space-between" align="center">
          <Text size="xs" c="dimmed">총 {filteredOptions.length.toLocaleString()}개 코드</Text>
          <Pagination size="sm" total={pageCount} value={page} onChange={setPage} withEdges color="red" disabled={loading} />
        </Group>
      </Stack>
    </Modal>
  );
});

const VirtualRow = ({ item, className, ...props }) => (
  <Table.Tr {...props} className={[className, item?.is_new && codeClasses.newRow].filter(Boolean).join(' ')} />
);

const virtuosoComponents = {
  Table: ({ style, ...props }) => (
    <Table {...props} className={`${sharedClasses.table} ${codeClasses.codeTable}`} highlightOnHover withTableBorder withColumnBorders verticalSpacing="xs" horizontalSpacing={0} style={{ ...style, width: '100%', tableLayout: 'fixed' }} />
  ),
  TableHead: Table.Thead,
  TableBody: Table.Tbody,
  TableRow: VirtualRow,
  EmptyPlaceholder: ({ context = {} }) => (
    <Table.Tbody>
      <Table.Tr className={classes.itemEmptyRow}>
        <Table.Td colSpan={Math.max(1, Number(context.columnCount) || 1)} className={`${codeClasses.emptyPlaceholder} ${classes.itemEmptyPlaceholder}`}>
          {context.emptyMessage || '등록된 품목이 없습니다.'}
        </Table.Td>
      </Table.Tr>
    </Table.Tbody>
  ),
};

export default function ItemMaster() {
  const pageLayout = useContext(PageRibbonContext);
  const registerPageRibbon = pageLayout?.registerPageRibbon;
  const closeActivePage = pageLayout?.closeActivePage;
  const [rows, setRows] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleteRequest, setDeleteRequest] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [filterOpen, setFilterOpen] = useState(true);
  const [columnWidths, setColumnWidths] = useState({});
  const [shapeOptions, setShapeOptions] = useState([]);
  const [shapeLoading, setShapeLoading] = useState(false);
  const [shapePickerTarget, setShapePickerTarget] = useState('');
  const uploadRef = useRef(null);
  const virtuosoRef = useRef(null);
  const codeInputsRef = useRef(new Map());
  const cellInputsRef = useRef(new Map());
  const activeCellRef = useRef(null);
  const pendingCellFocusRef = useRef(null);
  const pendingFocusIdRef = useRef('');
  const selectionAnchorRef = useRef('');
  const hasPendingChanges = rows.some((row) => row.is_new || row.is_dirty);
  const resizeColumn = useCallback((event, columnKey, defaultWidth, minimumWidth, tableWidth) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = columnWidths[columnKey] ?? defaultWidth;
    const resizeRoot = event.currentTarget.closest(`.${codeClasses.tableWrap}`);
    const resizeHeader = event.currentTarget.parentElement;
    let currentWidth = startWidth;
    const updateWidth = (pointerEvent) => {
      currentWidth = Math.max(minimumWidth, Math.min(1600, startWidth + pointerEvent.clientX - startX));
      if (resizeHeader) resizeHeader.style.width = `${currentWidth}px`;
      resizeRoot?.style.setProperty('--code-table-min-width', `${Math.max(900, tableWidth + currentWidth - startWidth)}px`);
    };
    const finishResize = () => {
      window.removeEventListener('pointermove', updateWidth);
      window.removeEventListener('pointerup', finishResize);
      window.removeEventListener('pointercancel', finishResize);
      setColumnWidths((current) => ({ ...current, [columnKey]: currentWidth }));
    };
    window.addEventListener('pointermove', updateWidth);
    window.addEventListener('pointerup', finishResize);
    window.addEventListener('pointercancel', finishResize);
  }, [columnWidths]);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get('/api/item-master/items/export', { headers: authHeaders() });
      setRows((data.items || []).map((item) => ({ ...item, id: `item:${item.itemcode}`, is_new: false, is_dirty: false })));
      setSelectedIds([]);
      selectionAnchorRef.current = '';
    } catch {
      notifications.show({ title: '품목 목록 조회 실패', message: '품목 목록을 불러오지 못했습니다.', color: 'red' });
    } finally {
      setLoading(false);
    }
  }, []);

  const loadShapeOptions = useCallback(async () => {
    setShapeLoading(true);
    try {
      const { data } = await axios.get('/api/code-master/groups', { headers: authHeaders() });
      const shapeGroup = (data.groups || []).find((group) => group.groupcode === 'SHAPE');
      setShapeOptions((shapeGroup?.rows || [])
        .filter((row) => row.use)
        .map((row) => ({ code: row.code, name: row.name, property: row.properties?.[0] || '' })));
    } catch {
      notifications.show({ title: '형태구분 조회 실패', message: '형태구분 목록을 불러오지 못했습니다.', color: 'red' });
      setShapeOptions([]);
    } finally {
      setShapeLoading(false);
    }
  }, []);

  useEffect(() => { loadItems(); void loadShapeOptions(); }, [loadItems, loadShapeOptions]);

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return rows.filter((row) => {
      const matchesQuery = !normalizedQuery || `${row.itemcode || ''} ${row.itemname || ''}`.toLocaleLowerCase().includes(normalizedQuery);
      const matchesStatus = statusFilter === 'all' || String(row.use_yn || 'Y').trim().toUpperCase() === statusFilter;
      return matchesQuery && matchesStatus;
    });
  }, [rows, query, statusFilter]);

  useEffect(() => {
    if (!pendingFocusIdRef.current) return;
    const rowIndex = rows.findIndex((row) => row.id === pendingFocusIdRef.current);
    if (rowIndex >= 0) {
      requestAnimationFrame(() => {
        virtuosoRef.current?.scrollToIndex({ index: rowIndex, align: 'end', behavior: 'auto' });
      });
    }
    const input = codeInputsRef.current.get(pendingFocusIdRef.current);
    if (input) {
      input.focus();
      pendingFocusIdRef.current = '';
    }
  }, [rows]);

  const registerCodeInput = useCallback((id, element) => {
    if (element) {
      codeInputsRef.current.set(id, element);
      if (pendingFocusIdRef.current === id) {
        element.focus();
        pendingFocusIdRef.current = '';
      }
    } else {
      codeInputsRef.current.delete(id);
    }
  }, []);

  const registerCellInput = useCallback((id, field, element) => {
    const key = `${id}:${field}`;
    if (element) {
      cellInputsRef.current.set(key, element);
      if (pendingCellFocusRef.current === key) {
        element.focus();
        pendingCellFocusRef.current = null;
      }
    } else cellInputsRef.current.delete(key);
  }, []);

  const setActiveCell = useCallback((id, field) => {
    activeCellRef.current = { id, field };
  }, []);

  const focusGridCell = useCallback((rowId, field) => {
    const key = `${rowId}:${field}`;
    const input = cellInputsRef.current.get(key);
    if (input) { input.focus(); return; }
    const rowIndex = filteredRows.findIndex((row) => row.id === rowId);
    if (rowIndex < 0) return;
    pendingCellFocusRef.current = key;
    virtuosoRef.current?.scrollToIndex({ index: rowIndex, align: 'center', behavior: 'auto' });
  }, [filteredRows]);

  const moveGridCell = useCallback((rowId, field, rowDelta, columnDelta) => {
    const rowIndex = filteredRows.findIndex((row) => row.id === rowId);
    if (rowIndex < 0) return false;
    let columnIndex = EDITABLE_FIELDS.indexOf(field);
    if (columnIndex < 0) return false;
    let nextRow = rowIndex + rowDelta;
    let nextColumn = columnIndex + columnDelta;
    if (nextColumn < 0) { nextRow -= 1; nextColumn = EDITABLE_FIELDS.length - 1; }
    if (nextColumn >= EDITABLE_FIELDS.length) { nextRow += 1; nextColumn = 0; }
    if (nextRow < 0 || nextRow >= filteredRows.length) return false;
    focusGridCell(filteredRows[nextRow].id, EDITABLE_FIELDS[nextColumn]);
    return true;
  }, [filteredRows, focusGridCell]);

  const handleTableKeyDown = useCallback((event) => {
    const target = event.target instanceof HTMLElement && event.target.dataset.field ? event.target : null;
    if (!target) return;
    if (target.tagName === 'SELECT' && event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const field = target.dataset.field;
    const rowId = target.dataset.rowId;
    let rowDelta = 0;
    let columnDelta = 0;
    if (event.key === 'Enter') rowDelta = event.shiftKey ? -1 : 1;
    else if (event.key === 'Tab') columnDelta = event.shiftKey ? -1 : 1;
    else if (event.key === 'ArrowDown') rowDelta = 1;
    else if (event.key === 'ArrowUp') rowDelta = -1;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const hasSelection = 'selectionStart' in target && target.selectionStart !== target.selectionEnd;
      const atBoundary = !('selectionStart' in target) || target.readOnly || hasSelection
        ? !hasSelection
        : event.key === 'ArrowLeft' ? target.selectionStart === 0 : target.selectionEnd === target.value.length;
      if (!atBoundary) return;
      columnDelta = event.key === 'ArrowLeft' ? -1 : 1;
    } else return;
    if (moveGridCell(rowId, field, rowDelta, columnDelta)) event.preventDefault();
  }, [moveGridCell]);

  const requireNoPendingChanges = useCallback(() => {
    if (!hasPendingChanges) return true;
    notifications.show({ title: '저장되지 않은 변경사항', message: '현재 입력 내용을 먼저 저장해 주세요.', color: 'orange' });
    return false;
  }, [hasPendingChanges]);

  const changeCell = useCallback((id, field, value) => {
    setRows((current) => current.map((row) => row.id === id
      ? { ...row, [field]: value, is_dirty: !row.is_new }
      : row));
  }, []);

  const openShapePicker = useCallback((id) => {
    setShapePickerTarget(id);
    void loadShapeOptions();
  }, [loadShapeOptions]);

  const selectShape = useCallback((option) => {
    if (!shapePickerTarget) return;
    changeCell(shapePickerTarget, 'itemtypecode', option.code);
    setShapePickerTarget('');
  }, [shapePickerTarget, changeCell]);

  const addRow = useCallback(() => {
    const item = newRow();
    pendingFocusIdRef.current = item.id;
    setRows((current) => [...current, item]);
    setQueryInput('');
    setQuery('');
    setStatusFilter('all');
    setSelectedIds([]);
    selectionAnchorRef.current = '';
    requestAnimationFrame(() => {
      virtuosoRef.current?.scrollToIndex({ index: rows.length, align: 'end', behavior: 'auto' });
      codeInputsRef.current.get(item.id)?.focus();
    });
  }, [rows.length]);

  const toggleSelection = useCallback((id, shiftKey = false) => {
    setSelectedIds((current) => {
      const fromIndex = filteredRows.findIndex((row) => row.id === selectionAnchorRef.current);
      const toIndex = filteredRows.findIndex((row) => row.id === id);
      if (shiftKey && fromIndex >= 0 && toIndex >= 0) {
        const range = filteredRows.slice(Math.min(fromIndex, toIndex), Math.max(fromIndex, toIndex) + 1).map((row) => row.id);
        selectionAnchorRef.current = id;
        return [...new Set([...current, ...range])];
      }
      selectionAnchorRef.current = id;
      return current.includes(id) ? current.filter((value) => value !== id) : [...current, id];
    });
  }, [filteredRows]);

  const toggleAll = useCallback((checked) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      filteredRows.forEach((row) => checked ? next.add(row.id) : next.delete(row.id));
      return [...next];
    });
    selectionAnchorRef.current = '';
  }, [filteredRows]);

  const pasteRange = useCallback((startId, startField, pastedText) => {
    const matrix = pastedText.replace(/\r/g, '').split('\n').filter((line, index, all) => line || index < all.length - 1).map((line) => line.split('\t'));
    const startIndex = filteredRows.findIndex((row) => row.id === startId);
    const fieldIndex = EDITABLE_FIELDS.indexOf(startField);
    if (startIndex < 0 || fieldIndex < 0) return;
    if (startIndex + matrix.length > 1000) {
      notifications.show({ title: '붙여넣기 제한', message: '한 번에 최대 1,000행까지 입력할 수 있습니다.', color: 'orange' });
      return;
    }
    setRows((current) => {
      const next = [...current];
      const newRows = [];
      matrix.forEach((line, rowOffset) => {
        const targetRow = filteredRows[startIndex + rowOffset];
        const targetIndex = targetRow ? next.findIndex((row) => row.id === targetRow.id) : -1;
        const target = targetIndex >= 0 ? { ...next[targetIndex] } : newRow();
        line.forEach((value, columnOffset) => {
          const key = EDITABLE_FIELDS[fieldIndex + columnOffset];
          if (!key || (key === 'itemcode' && !target.is_new)) return;
          if (key === 'itemtypecode') {
            target[key] = resolveShapeCode(value, shapeOptions);
          } else if (key === 'use_yn') {
            const normalized = value.trim().toUpperCase();
            target[key] = ['N', '사용중지', '미사용'].includes(normalized) ? 'N' : 'Y';
          } else {
            target[key] = value;
          }
        });
        target.is_dirty = !target.is_new;
        if (targetIndex >= 0) next[targetIndex] = target;
        else newRows.push(target);
      });
      next.push(...newRows);
      return next;
    });
    setQueryInput('');
    setQuery('');
    setStatusFilter('all');
  }, [filteredRows, shapeOptions]);

  const saveRows = useCallback(async () => {
    const changed = rows.filter((row) => row.is_new || row.is_dirty);
    if (!changed.length) {
      notifications.show({ title: '저장할 내용 없음', message: '변경된 품목이 없습니다.', color: 'gray' });
      return;
    }
    const missingRequired = changed.flatMap((row) => {
      const missing = [];
      if (!String(row.itemcode || '').trim()) missing.push('품목코드');
      if (!String(row.itemname || '').trim()) missing.push('품목명');
      if (row.is_new && !String(row.itemtypecode || '').trim()) missing.push('형태구분');
      if (!missing.length) return [];
      const visibleIndex = filteredRows.findIndex((visibleRow) => visibleRow.id === row.id);
      const rowNumber = (visibleIndex >= 0 ? visibleIndex : rows.findIndex((sourceRow) => sourceRow.id === row.id)) + 1;
      return [`${rowNumber}행: ${missing.join(', ')}`];
    });
    if (missingRequired.length) {
      notifications.show({
        title: '필수 항목을 입력해 주세요',
        message: missingRequired.slice(0, 5).join(' / '),
        color: 'orange',
        autoClose: 8000,
      });
      return;
    }
    const duplicatePairs = new Set();
    const duplicateRows = [];
    for (const row of changed) {
      const itemcode = String(row.itemcode || '').trim();
      if (!itemcode) continue;
      const conflicts = rows.filter((candidate) => candidate.id !== row.id && String(candidate.itemcode || '').trim() === itemcode);
      for (const conflict of conflicts) {
        const pairKey = [String(row.id), String(conflict.id)].sort().join('|');
        if (duplicatePairs.has(pairKey)) continue;
        duplicatePairs.add(pairKey);
        const rowIndex = filteredRows.findIndex((candidate) => candidate.id === row.id);
        const conflictIndex = filteredRows.findIndex((candidate) => candidate.id === conflict.id);
        const rowLabel = (rowIndex >= 0 ? rowIndex : rows.findIndex((candidate) => candidate.id === row.id)) + 1;
        const conflictLabel = (conflictIndex >= 0 ? conflictIndex : rows.findIndex((candidate) => candidate.id === conflict.id)) + 1;
        duplicateRows.push(rowLabel + '행 품목코드 "' + itemcode + '"가 ' + conflictLabel + '행과 중복됩니다.');
      }
    }
    if (duplicateRows.length) {
      notifications.show({
        title: '품목코드 중복',
        message: duplicateRows.slice(0, 5).join(' / ') + (duplicateRows.length > 5 ? ' 외 ' + (duplicateRows.length - 5) + '건' : ''),
        color: 'orange',
        autoClose: 9000,
      });
      return;
    }
    setSaving(true);
    try {
      const items = changed.map(({ id, is_dirty, ...item }) => item);
      await axios.put('/api/item-master/items', { items }, { headers: authHeaders() });
      notifications.show({ title: '저장 완료', message: `${changed.length.toLocaleString()}개 품목을 저장했습니다.`, color: 'teal' });
      await loadItems();
    } catch (error) {
      notifications.show({ ...saveFailureNotice(error, changed, rows, filteredRows), autoClose: 10000 });
    } finally {
      setSaving(false);
    }
  }, [rows, filteredRows, loadItems]);

  const deleteRows = useCallback(async (selected) => {
    if (!selected.length || saving) return false;
    const selectedRowIds = new Set(selected.map((row) => row.id));
    const savedCodes = selected.filter((row) => !row.is_new).map((row) => row.itemcode);
    setSaving(true);
    try {
      if (savedCodes.length) {
        await axios.delete('/api/item-master/items', { data: { itemcodes: savedCodes }, headers: authHeaders() });
      }
      setRows((current) => current.filter((row) => !selectedRowIds.has(row.id)));
      setSelectedIds([]);
      notifications.show({ title: '삭제 완료', message: `${selected.length.toLocaleString()}개 품목을 삭제했습니다.`, color: 'teal' });
      return true;
    } catch {
      notifications.show({ title: '삭제 실패', message: '품목 삭제 중 오류가 발생했습니다.', color: 'red' });
      return false;
    } finally {
      setSaving(false);
    }
  }, [saving]);

  const requestDeleteRows = useCallback((selected) => {
    if (!selected.length || saving) return;
    const unsavedRows = selected.filter((row) => row.is_new);
    const savedRows = selected.filter((row) => !row.is_new);
    if (savedRows.length) setDeleteRequest(savedRows);
    if (unsavedRows.length) void deleteRows(unsavedRows);
  }, [saving, deleteRows]);

  const deleteSelectedRows = useCallback(() => {
    const selected = filteredRows.filter((row) => selectedIds.includes(row.id));
    if (selected.length) void deleteRows(selected);
  }, [filteredRows, selectedIds, deleteRows]);

  const deleteOneRow = useCallback((row) => { requestDeleteRows([row]); }, [requestDeleteRows]);

  const confirmDelete = useCallback(async () => {
    if (!deleteRequest?.length || saving) return;
    const deleted = await deleteRows(deleteRequest);
    if (deleted) setDeleteRequest(null);
  }, [deleteRequest, saving, deleteRows]);

  const applySearch = useCallback(() => {
    setQuery(queryInput.trim());
    setSelectedIds([]);
    selectionAnchorRef.current = '';
  }, [queryInput]);

  const copySelectedRow = useCallback(() => {
    if (selectedIds.length !== 1) return;
    const source = filteredRows.find((row) => row.id === selectedIds[0]);
    if (!source) return;
    const copy = {
      ...newRow(),
      itemname: source.itemname || '',
      itemtypecode: source.itemtypecode || '',
      use_yn: source.use_yn || 'Y',
      description: source.description || '',
    };
    pendingFocusIdRef.current = copy.id;
    setRows((current) => [...current, copy]);
    setSelectedIds([copy.id]);
  }, [selectedIds, filteredRows]);

  const downloadTemplate = useCallback(() => {
    const headers = FIELDS.map(({ label }) => label);
    const exampleRow = FIELDS.map(({ key }) => key === 'use_yn' ? 'Y' : '');
    const sheet = XLSX.utils.aoa_to_sheet([headers, exampleRow]);
    applyExcelHeaderStyle(sheet, headers.length);
    sheet['!cols'] = FIELDS.map(({ width }) => ({ wch: Math.max(12, Math.round(width / 8)) }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, '품목등록');
    XLSX.writeFile(workbook, '품목코드_일괄등록_샘플.xlsx');
  }, []);

  const exportExcel = useCallback(async () => {
    setExporting(true);
    try {
      const values = filteredRows.map((item) => FIELDS.map(({ key }) => {
        if (key === 'use_yn') return item[key];
        if (key === 'itemtypecode') {
          return shapeOptions.find((option) => option.code === item.itemtypecode)?.name || item.itemtypecodenm || item.itemtypecode || '';
        }
        return item[key] ?? '';
      }));
      const sheet = XLSX.utils.aoa_to_sheet([FIELDS.map(({ label }) => label), ...values]);
      applyExcelHeaderStyle(sheet, FIELDS.length);
      sheet['!cols'] = FIELDS.map(({ width }) => ({ wch: Math.max(12, Math.round(width / 8)) }));
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, '품목목록');
      const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
      XLSX.writeFile(workbook, `품목목록_${date}.xlsx`);
    } catch {
      notifications.show({ title: '엑셀 다운로드 실패', message: '엑셀 파일을 생성하지 못했습니다.', color: 'red' });
    } finally {
      setExporting(false);
    }
  }, [filteredRows, shapeOptions]);

  useEffect(() => {
    if (!registerPageRibbon) return undefined;
    registerPageRibbon(
      <ErpRibbon
        onSearch={applySearch}
        onAdd={addRow}
        onCopy={copySelectedRow}
        onExcel={exportExcel}
        onSave={saveRows}
        onDelete={deleteSelectedRows}
        showPrint={false}
        onClose={closeActivePage}
        useSaveColor={false}
        disabled={{ search: loading, add: loading || saving || uploading, copy: selectedIds.length !== 1 || saving || uploading, excel: loading || exporting, save: loading || uploading || saving, delete: !selectedIds.length || saving || uploading }}
        loading={{ excel: exporting, save: saving }}
      />,
    );
    return () => registerPageRibbon(null);
  }, [registerPageRibbon, closeActivePage, applySearch, addRow, copySelectedRow, exportExcel, saveRows, deleteSelectedRows, loading, saving, uploading, exporting, selectedIds.length]);

  const uploadExcel = useCallback(async (event) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    if (!requireNoPendingChanges()) return;
    let imported = [];
    setUploading(true);
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!sheet) throw new Error('엑셀 첫 번째 시트를 확인해 주세요.');
      const headerCells = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false })[0] || [];
      const normalizeHeader = (value) => String(value ?? '').trim().toLowerCase().replace(/[\s_]/g, '');
      const normalizedHeaders = new Set(headerCells.map(normalizeHeader));
      const requiredHeaderAliases = {
        itemcode: ['itemcode', '품목코드'],
        itemname: ['itemname', '품목명'],
        itemtypecode: ['itemtypecode', '형태구분'],
        use_yn: ['useyn', '사용여부'],
      };
      const unmappedHeaders = Object.entries(requiredHeaderAliases)
        .filter(([, aliases]) => !aliases.some((alias) => normalizedHeaders.has(normalizeHeader(alias))))
        .map(([field]) => ITEM_FIELD_LABELS[field] + ' (' + field + ')');
      if (unmappedHeaders.length) {
        throw new Error('엑셀 1행 헤더/열 매핑 오류: ' + unmappedHeaders.join(', ') + ' 열 이름을 샘플양식과 맞춰 주세요.');
      }
      imported = XLSX.utils.sheet_to_json(sheet, { defval: '' }).map(normalizeImportedRow)
        .filter((item) => item.itemcode || item.itemname);
      if (!imported.length) throw new Error('등록할 데이터가 없습니다.');
      if (imported.length > 10000) throw new Error('한 번에 최대 10,000행까지 등록할 수 있습니다.');

      const normalizeShapeValue = (value) => String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
      const invalidShapes = [];
      imported.forEach((item, index) => {
        const shapeValue = String(item.itemtypecode || '').trim();
        if (!shapeValue) return;
        const normalizedShapeValue = normalizeShapeValue(shapeValue);
        const matchedShape = shapeOptions.find((option) => [option.code, option.name]
          .some((candidate) => normalizeShapeValue(candidate) === normalizedShapeValue));
        if (matchedShape) item.itemtypecode = matchedShape.code;
        else invalidShapes.push(`${index + 2}행 ${shapeValue}`);
      });
      if (invalidShapes.length) {
        throw new Error(`형태구분 코드 또는 코드명을 확인해주세요: ${invalidShapes.slice(0, 5).join(' / ')}`);
      }

      const invalid = imported.flatMap((item, index) => {
        const errors = [];
        if (!item.itemcode) errors.push('품목코드 누락');
        if (!item.itemname) errors.push('품목명 누락');
        if (!item.itemtypecode) errors.push('형태구분 누락');
        if (!item.use_yn) errors.push('사용여부 누락');
        else if (!['Y', 'N'].includes(item.use_yn)) errors.push('사용여부는 Y/N 입력');
        return errors.length ? [`${index + 2}행 ${errors.join(', ')}`] : [];
      });
      if (invalid.length) throw new Error('필수값 누락 또는 값 형식 오류: ' + invalid.slice(0, 5).join(' / '));

      const firstCodeRows = new Map();
      const duplicateCodes = [];
      imported.forEach((item, index) => {
        const code = item.itemcode.trim();
        if (!code) return;
        if (firstCodeRows.has(code)) {
          duplicateCodes.push(`${index + 2}행 ${code} (최초 ${firstCodeRows.get(code)}행)`);
        } else {
          firstCodeRows.set(code, index + 2);
        }
      });
      if (duplicateCodes.length) {
        throw new Error(`엑셀에 중복된 품목코드가 있습니다: ${duplicateCodes.slice(0, 5).join(' / ')}`);
      }

      const existingCodes = new Set(rows.map((row) => String(row.itemcode || '').trim()));
      const alreadyRegistered = imported.flatMap((item, index) => (
        existingCodes.has(item.itemcode.trim()) ? [`${index + 2}행 ${item.itemcode} (이미 등록됨)`] : []
      ));
      if (alreadyRegistered.length) {
        throw new Error(`이미 등록된 품목코드가 있습니다: ${alreadyRegistered.slice(0, 5).join(' / ')}`);
      }
      await axios.post('/api/item-master/items/bulk', { items: imported }, { headers: authHeaders() });
      setQuery('');
      setQueryInput('');
      setStatusFilter('all');
      setSelectedIds([]);
      await loadItems();
      notifications.show({ title: '일괄 등록 완료', message: `${imported.length.toLocaleString()}개 품목을 등록했습니다.`, color: 'teal' });
    } catch (error) {
      const notice = error.response
        ? saveFailureNotice(error, imported, rows, filteredRows, 'excel')
        : {
            title: /중복.*품목코드|이미 등록된 품목코드/i.test(error.message || '') ? '품목코드 중복'
              : /형태구분/.test(error.message || '') ? '형태구분 확인 필요'
                : /헤더|열 매핑/.test(error.message || '') ? '엑셀 열 매핑 오류'
                  : /누락|형식 오류/.test(error.message || '') ? '엑셀 데이터 검증 실패'
                    : '엑셀 업로드 실패',
            message: error.message || '엑셀 일괄등록을 완료하지 못했습니다.',
            color: 'red',
          };
      notifications.show({ ...notice, autoClose: 10000 });
    } finally {
      setUploading(false);
    }
  }, [requireNoPendingChanges, loadItems, rows, filteredRows, shapeOptions]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const rowContent = useCallback((index, item) => (
    <ItemCells
      item={item}
      index={index}
      selected={selectedSet.has(item.id)}
      disabled={saving || uploading}
      shapeOptions={shapeOptions}
      onSelect={toggleSelection}
      onChange={changeCell}
      onPaste={pasteRange}
      onFindShape={openShapePicker}
      registerCodeInput={registerCodeInput}
      registerCellInput={registerCellInput}
      onFocusCell={setActiveCell}
      onCellKeyDown={handleTableKeyDown}
      onDelete={deleteOneRow}
    />
  ), [selectedSet, saving, uploading, shapeOptions, toggleSelection, changeCell, pasteRange, openShapePicker, registerCodeInput, registerCellInput, setActiveCell, handleTableKeyDown, deleteOneRow]);
  const headerColumns = [
    { key: 'select', width: 46, minWidth: 42, className: codeClasses.checkCol, label: <input type="checkbox" aria-label="현재 목록 전체 선택" checked={filteredRows.length > 0 && filteredRows.every((row) => selectedSet.has(row.id))} onChange={(event) => toggleAll(event.currentTarget.checked)} /> },
    { key: 'number', width: 62, minWidth: 48, className: codeClasses.numberCol, label: 'No.' },
    ...FIELDS.map(({ key, label, width, required }) => ({ key, width, minWidth: 70, label: <>{label}{required && <span className={codeClasses.required}> *</span>}</> })),
    { key: 'action', width: 76, minWidth: 50, className: codeClasses.actionCol, label: '관리' },
  ];
  const tableWidth = headerColumns.reduce((totalWidth, column) => totalWidth + (columnWidths[column.key] ?? column.width), 0);
  const renderResizableHeader = (column) => {
    const width = columnWidths[column.key] ?? column.width;
    return (
      <Table.Th key={column.key} className={[codeClasses.resizableHeader, classes.itemTableHeader, column.className].filter(Boolean).join(' ')} style={{ width }}>
        {column.label}
        <span className={codeClasses.columnResizeHandle} onPointerDown={(event) => resizeColumn(event, column.key, column.width, column.minWidth, tableWidth)} role="separator" aria-label={`${column.key} 열 너비 조절`} />
      </Table.Th>
    );
  };

  return (
    <Box className={`${sharedClasses.pageShell} ${classes.page}`}>
      <ErpBreadcrumb parent="기준정보" current="품목코드" filterOpen={filterOpen} onOpenFilters={() => setFilterOpen(true)} />

      <Box className={classes.workspace}>
      <Paper className={`${sharedClasses.panel} ${codeClasses.codePanel}`} withBorder>
        <Group className={codeClasses.codeHeader} justify="space-between" align="flex-start" wrap="wrap" gap="sm">
          <Box>
            <Group gap={9} align="center"><Text className={classes.itemTitle}>품목 등록</Text><Badge className={classes.itemCount}>{rows.length}개</Badge></Group>
            <Text size="xs" c="dimmed" mt={5}>회사별 품목코드, 품목명, 형태구분 및 사용 여부를 관리합니다.</Text>
          </Box>
          <Group gap={7} align="center" wrap="wrap">
            <Button variant="default" size="xs" leftSection={<IconDownload size={14} />} onClick={downloadTemplate}>샘플양식</Button>
            <Button size="xs" variant="light" leftSection={<IconUpload size={14} />} onClick={() => uploadRef.current?.click()} disabled={loading || saving} loading={uploading}>엑셀 일괄등록</Button>
            <input ref={uploadRef} type="file" accept=".xlsx,.xls" onChange={uploadExcel} hidden />
          </Group>
        </Group>

        {selectedIds.length > 0 && (
          <Group className={`${sharedClasses.toolbar} ${codeClasses.toolbar}`} justify="flex-start" wrap="wrap" gap={6}>
            <Text size="xs" c="dimmed">{selectedIds.length}개 선택</Text>
          </Group>
        )}

        <Box className={`${codeClasses.tableWrap} ${filteredRows.length === 0 ? classes.emptyItemTable : ''}`} style={{ '--code-table-min-width': `${Math.max(900, tableWidth)}px` }}>
          {loading ? <Box className={classes.loading}><Loader color="red" size="sm" /></Box> : (
            <TableVirtuoso
              ref={virtuosoRef}
              data={filteredRows}
              context={{
                columnCount: headerColumns.length,
                emptyMessage: query.trim() ? '검색 결과가 없습니다.' : '등록된 품목이 없습니다.',
              }}
              style={{ height: '100%' }}
              components={virtuosoComponents}
              computeItemKey={(_index, item) => item.id}
              defaultItemHeight={58}
              increaseViewportBy={{ top: 160, bottom: 320 }}
              key={`${query}-${statusFilter}`}
              fixedHeaderContent={() => <Table.Tr>{headerColumns.map(renderResizableHeader)}</Table.Tr>}
              itemContent={rowContent}
            />
          )}
        </Box>

        <Group className={`${sharedClasses.footer} ${codeClasses.tableFooter}`} justify="space-between" wrap="wrap">
          <Text size="xs" c="dimmed">조회 {filteredRows.length}개 · 엑셀 셀 범위를 복사해 표에 붙여넣은 뒤 저장할 수 있습니다.</Text>
        </Group>
      </Paper>
      {filterOpen && <Paper component="aside" className={classes.filterSidebar} withBorder>
        <Group className={classes.filterHeader} justify="space-between" align="center">
          <Text fw={700}>조회조건</Text>
          <ActionIcon variant="subtle" color="gray" aria-label="조회조건 닫기" onClick={() => setFilterOpen(false)}><IconX size={16} /></ActionIcon>
        </Group>
        <Stack gap="sm" className={classes.filterFields}>
          <TextInput label="품목정보" placeholder="품목코드 또는 품목명" value={queryInput} onChange={(event) => setQueryInput(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === 'Enter') applySearch(); }} />
          <Select label="사용 여부" value={statusFilter === 'Y' ? '사용중' : statusFilter === 'N' ? '사용중지' : '전체'}
            onChange={(value) => { setStatusFilter(value === '사용중' ? 'Y' : value === '사용중지' ? 'N' : 'all'); setSelectedIds([]); selectionAnchorRef.current = ''; }}
            data={['전체', '사용중', '사용중지']} allowDeselect={false} disabled={loading} />
        </Stack>
      </Paper>}
      </Box>

      <Modal opened={Boolean(deleteRequest?.length)} onClose={() => !saving && setDeleteRequest(null)} title="품목 삭제" centered size="xs" padding="sm">
        <Stack gap="sm">
          <Text size="sm" c="dimmed">선택한 {deleteRequest?.length || 0}개 저장된 품목을 삭제합니다. 삭제한 품목은 복구할 수 없습니다.</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeleteRequest(null)} disabled={saving}>취소</Button>
            <Button color="red" leftSection={<IconTrash size={15} />} onClick={confirmDelete} loading={saving}>삭제</Button>
          </Group>
        </Stack>
      </Modal>

      <ShapePickerModal
        key={shapePickerTarget || 'closed'}
        opened={Boolean(shapePickerTarget)}
        onClose={() => setShapePickerTarget('')}
        options={shapeOptions}
        loading={shapeLoading}
        onSelect={selectShape}
      />
    </Box>
  );
}
