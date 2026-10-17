import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Group,
  Loader,
  Modal,
  Paper,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconDeviceFloppy, IconDownload, IconPlus, IconSearch, IconTrash, IconUpload } from '@tabler/icons-react';
import { TableVirtuoso } from 'react-virtuoso';
import * as XLSX from 'xlsx-js-style';
import { applyExcelHeaderStyle } from '../utils/excelHeaderStyle';
import sharedClasses from '../styles/pages/ManagementShared.module.css';
import classes from '../styles/pages/ItemMaster.module.css';
import codeClasses from '../styles/pages/CodeMasterPage.module.css';
import dashboardClasses from '../styles/pages/HomePage.module.css';

const authHeaders = () => ({
  Authorization: `Bearer ${localStorage.getItem('access_token') || ''}`,
});

const FIELDS = [
  { key: 'itemcode', label: '품목코드', width: 150, required: true },
  { key: 'itemname', label: '품목명', width: 190, required: true },
  { key: 'itemtypecode', label: '형태구분', width: 130 },
  { key: 'use_yn', label: '사용여부', width: 105 },
  { key: 'description', label: '설명', width: 200 },
];
const EDITABLE_FIELDS = FIELDS.map(({ key }) => key);
const EMPTY_ITEM = {
  itemcode: '', itemname: '', itemtypecode: '', use_yn: 'Y', description: '',
};

const errorMessage = (error) => {
  const detail = error.response?.data?.detail;
  if (Array.isArray(detail)) return detail.map((item) => item.msg || String(item)).join(', ');
  return detail || error.response?.data?.message || error.message || '품목 요청에 실패했습니다.';
};

const saveErrorMessage = (error, rows) => {
  const detail = error.response?.data?.detail;
  if (Array.isArray(detail)) {
    const requiredFieldErrors = detail.filter((item) => item.type === 'string_too_short');
    if (requiredFieldErrors.length) {
      return requiredFieldErrors.map((item) => {
        const field = item.loc?.at(-1);
        const itemIndex = item.loc?.findIndex((part) => part === 'items') ?? -1;
        const rowIndex = itemIndex >= 0 ? Number(item.loc[itemIndex + 1]) : -1;
        const fieldName = field === 'itemcode' ? '품목코드' : field === 'itemname' ? '품목명' : '';
        return fieldName && Number.isInteger(rowIndex) && rowIndex >= 0
          ? `${rowIndex + 1}행 ${fieldName}을 입력해 주세요.`
          : fieldName ? `${fieldName}을 입력해 주세요.` : '';
      }).filter(Boolean).join(' ');
    }
  }
  return errorMessage(error) || `저장 중 문제가 발생했습니다. 입력 내용을 확인해 주세요. (${rows.length}행)`;
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

const ItemCells = memo(function ItemCells({ item, index, selected, disabled, onSelect, onChange, onPaste, registerCodeInput, registerCellInput, onFocusCell, onCellKeyDown, onDelete }) {
  const handlePaste = (field) => (event) => {
    const text = event.clipboardData.getData('text/plain');
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
          {key === 'use_yn' ? (
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
};

export default function ItemMaster() {
  const [rows, setRows] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [columnWidths, setColumnWidths] = useState({});
  const [deleteRequest, setDeleteRequest] = useState(null);
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
    } catch (error) {
      notifications.show({ title: '품목 목록 조회 실패', message: errorMessage(error), color: 'red' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadItems(); }, [loadItems]);

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
          if (key === 'use_yn') {
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
  }, [filteredRows]);

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
    setSaving(true);
    try {
      const items = changed.map(({ id, is_dirty, ...item }) => item);
      await axios.put('/api/item-master/items', { items }, { headers: authHeaders() });
      notifications.show({ title: '저장 완료', message: `${changed.length.toLocaleString()}개 품목을 저장했습니다.`, color: 'teal' });
      await loadItems();
    } catch (error) {
      notifications.show({ title: '저장할 내용을 확인해 주세요', message: saveErrorMessage(error, changed), color: 'orange', autoClose: 8000 });
    } finally {
      setSaving(false);
    }
  }, [rows, filteredRows, loadItems]);

  const requestDeleteSelected = useCallback(() => {
    const selected = filteredRows.filter((row) => selectedIds.includes(row.id));
    if (selected.length) setDeleteRequest({ rows: selected });
  }, [filteredRows, selectedIds]);

  const requestDeleteOne = useCallback((row) => setDeleteRequest({ rows: [row] }), []);

  const confirmDelete = useCallback(async () => {
    const selected = deleteRequest?.rows || [];
    if (!selected.length) return;
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
      setDeleteRequest(null);
    } catch (error) {
      notifications.show({ title: '삭제 실패', message: errorMessage(error), color: 'red' });
    } finally {
      setSaving(false);
    }
  }, [deleteRequest]);

  const applySearch = useCallback(() => {
    setQuery(queryInput.trim());
    setSelectedIds([]);
    selectionAnchorRef.current = '';
  }, [queryInput]);

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
        return item[key] ?? '';
      }));
      const sheet = XLSX.utils.aoa_to_sheet([FIELDS.map(({ label }) => label), ...values]);
      applyExcelHeaderStyle(sheet, FIELDS.length);
      sheet['!cols'] = FIELDS.map(({ width }) => ({ wch: Math.max(12, Math.round(width / 8)) }));
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, '품목목록');
      const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
      XLSX.writeFile(workbook, `품목목록_${date}.xlsx`);
    } catch (error) {
      notifications.show({ title: '엑셀 다운로드 실패', message: errorMessage(error), color: 'red' });
    } finally {
      setExporting(false);
    }
  }, [filteredRows]);

  const uploadExcel = useCallback(async (event) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    if (!requireNoPendingChanges()) return;
    setUploading(true);
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!sheet) throw new Error('엑셀 첫 번째 시트를 확인해 주세요.');
      const imported = XLSX.utils.sheet_to_json(sheet, { defval: '' }).map(normalizeImportedRow)
        .filter((item) => item.itemcode || item.itemname);
      if (!imported.length) throw new Error('등록할 데이터가 없습니다.');
      if (imported.length > 10000) throw new Error('한 번에 최대 10,000행까지 등록할 수 있습니다.');
      const invalid = imported.flatMap((item, index) => {
        const errors = [];
        if (!item.itemcode) errors.push('품목코드 누락');
        if (!item.itemname) errors.push('품목명 누락');
        if (!item.use_yn) errors.push('사용여부 누락');
        else if (!['Y', 'N'].includes(item.use_yn)) errors.push('사용여부는 Y/N 입력');
        return errors.length ? [`${index + 2}행 ${errors.join(', ')}`] : [];
      });
      if (invalid.length) throw new Error(invalid.slice(0, 5).join(' / '));

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
      notifications.show({ title: '일괄 등록 중단', message: errorMessage(error), color: 'red', autoClose: 9000 });
    } finally {
      setUploading(false);
    }
  }, [requireNoPendingChanges, loadItems, rows]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const rowContent = useCallback((index, item) => (
    <ItemCells
      item={item}
      index={index}
      selected={selectedSet.has(item.id)}
      disabled={saving || uploading}
      onSelect={toggleSelection}
      onChange={changeCell}
      onPaste={pasteRange}
      registerCodeInput={registerCodeInput}
      registerCellInput={registerCellInput}
      onFocusCell={setActiveCell}
      onCellKeyDown={handleTableKeyDown}
      onDelete={requestDeleteOne}
    />
  ), [selectedSet, saving, uploading, toggleSelection, changeCell, pasteRange, registerCodeInput, registerCellInput, setActiveCell, handleTableKeyDown, requestDeleteOne]);
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
      <Table.Th key={column.key} className={[codeClasses.resizableHeader, column.className].filter(Boolean).join(' ')} style={{ width }}>
        {column.label}
        <span className={codeClasses.columnResizeHandle} onPointerDown={(event) => resizeColumn(event, column.key, column.width, column.minWidth, tableWidth)} role="separator" aria-label={`${column.key} 열 너비 조절`} />
      </Table.Th>
    );
  };

  return (
    <Box className={`${sharedClasses.pageShell} ${classes.page}`}>
      <Paper className={dashboardClasses.dashboardHeader}>
        <Box className={dashboardClasses.headerCopy}>
          <Text className={sharedClasses.breadcrumb}>시스템 관리 <span>›</span> 기준정보 관리</Text>
          <Title order={1} className={dashboardClasses.pageTitle}>품목코드 <span>관리</span></Title>
          <Text className={dashboardClasses.pageSubtitle}>회사별 품목코드와 품목명, 형태구분 및 사용 여부를 관리합니다.</Text>
          <Group className={dashboardClasses.sampleNotice} gap={8}>
            <span className={dashboardClasses.statusDot} />
            <Text size="xs">System Active</Text>
          </Group>
        </Box>
      </Paper>

      <Box className={classes.workspace}>
      <Paper className={`${sharedClasses.panel} ${codeClasses.codePanel}`} withBorder>
        <Group className={codeClasses.codeHeader} justify="space-between" align="flex-start" wrap="wrap" gap="sm">
          <Box>
            <Group gap={9} align="center"><Text className={codeClasses.codeTitle} fw={800}>품목 등록</Text><Badge color="red" variant="light">{rows.length}개</Badge></Group>
            <Text size="xs" c="dimmed" mt={5}>회사별 품목코드, 품목명, 형태구분 및 사용 여부를 관리합니다.</Text>
          </Box>
          <Group gap={7} align="flex-end" wrap="wrap">
            <Select
              className={codeClasses.statusFilter}
              label="사용 여부"
              aria-label="사용 여부 필터"
              value={statusFilter === 'Y' ? '사용중' : statusFilter === 'N' ? '사용중지' : '전체'}
              onChange={(value) => { setStatusFilter(value === '사용중' ? 'Y' : value === '사용중지' ? 'N' : 'all'); setSelectedIds([]); selectionAnchorRef.current = ''; }}
              data={['전체', '사용중', '사용중지']}
              w={126}
              size="sm"
              allowDeselect={false}
              disabled={loading}
            />
            <Button variant="default" size="sm" leftSection={<IconDownload size={15} />} onClick={downloadTemplate}>샘플양식</Button>
            <Button variant="light" size="sm" leftSection={<IconDownload size={15} />} onClick={exportExcel} loading={exporting} disabled={loading}>엑셀 다운로드</Button>
            <Button color="red" size="sm" leftSection={<IconPlus size={15} />} onClick={addRow} disabled={loading || saving || uploading}>행 추가</Button>
            <Button color="red" size="sm" leftSection={<IconDeviceFloppy size={15} />} onClick={saveRows} loading={saving} disabled={loading || uploading}>저장</Button>
          </Group>
        </Group>

        <Group className={`${sharedClasses.toolbar} ${codeClasses.toolbar}`} justify="space-between" wrap="wrap" gap={6}>
          <Group className={codeClasses.searchGroup} gap={6} wrap="nowrap">
            <TextInput
              className={codeClasses.codeSearch}
              placeholder="품목코드 또는 품목명 검색"
              aria-label="품목코드 또는 품목명 검색"
              leftSection={<IconSearch size={15} />}
              value={queryInput}
              onChange={(event) => setQueryInput(event.currentTarget.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') applySearch(); }}
              size="sm"
              disabled={loading}
            />
            <Button size="sm" leftSection={<IconSearch size={15} />} onClick={applySearch} disabled={loading}>조회</Button>
          </Group>
          <Group gap={7} wrap="nowrap">
            {selectedIds.length > 0 && <Text size="xs" c="dimmed">{selectedIds.length}개 선택</Text>}
            <Button variant="subtle" color="red" size="xs" leftSection={<IconTrash size={14} />} disabled={!selectedIds.length || saving || uploading} onClick={requestDeleteSelected}>선택 삭제</Button>
            <Button size="xs" variant="light" leftSection={<IconUpload size={14} />} onClick={() => uploadRef.current?.click()} disabled={loading || saving} loading={uploading}>엑셀 일괄등록</Button>
            <input ref={uploadRef} type="file" accept=".xlsx,.xls" onChange={uploadExcel} hidden />
          </Group>
        </Group>

        <Box className={codeClasses.tableWrap} style={{ '--code-table-min-width': `${Math.max(900, tableWidth)}px` }}>
          {loading ? <Box className={classes.loading}><Loader color="red" size="sm" /></Box> : filteredRows.length ? (
            <TableVirtuoso
              ref={virtuosoRef}
              data={filteredRows}
              style={{ height: '100%' }}
              components={virtuosoComponents}
              computeItemKey={(_index, item) => item.id}
              defaultItemHeight={58}
              increaseViewportBy={{ top: 160, bottom: 320 }}
              key={`${query}-${statusFilter}`}
              fixedHeaderContent={() => <Table.Tr>{headerColumns.map(renderResizableHeader)}</Table.Tr>}
              itemContent={rowContent}
            />
          ) : (
            <Box className={codeClasses.emptyState}>{query.trim() ? '검색 결과가 없습니다.' : '등록된 품목이 없습니다.'}</Box>
          )}
        </Box>

        <Group className={`${sharedClasses.footer} ${codeClasses.tableFooter}`} justify="space-between" wrap="wrap">
          <Text size="xs" c="dimmed">조회 {filteredRows.length}개 · 엑셀 셀 범위를 복사해 표에 붙여넣은 뒤 저장할 수 있습니다.</Text>
        </Group>
      </Paper>
      </Box>

      <Modal opened={Boolean(deleteRequest)} onClose={() => !saving && setDeleteRequest(null)} title="품목 삭제" centered size="sm">
        <Stack gap="md">
          <Text size="sm" c="dimmed">선택한 {deleteRequest?.rows.length || 0}개 품목을 삭제합니다. 삭제한 품목은 복구할 수 없습니다.</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeleteRequest(null)} disabled={saving}>취소</Button>
            <Button color="red" leftSection={<IconTrash size={15} />} onClick={confirmDelete} loading={saving}>삭제</Button>
          </Group>
        </Stack>
      </Modal>
    </Box>
  );
}
