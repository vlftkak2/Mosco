import { memo, useCallback, useContext, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import * as XLSX from 'xlsx';
import {
  ActionIcon, Badge, Box, Button, Group, Loader, Modal, Pagination, Paper,
  Popover, ScrollArea, Stack, Table, Text, TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconSearch, IconTrash, IconX } from '@tabler/icons-react';

import ErpBreadcrumb from '../components/common/ErpBreadcrumb';
import ErpRibbon from '../components/common/ErpRibbon';
import { applyExcelHeaderStyle } from '../utils/excelHeaderStyle';
import { PageRibbonContext } from '../components/layout/MainLayout';
import sharedClasses from '../styles/pages/ManagementShared.module.css';
import classes from '../styles/pages/ItemProcessMaster.module.css';
import inboundClasses from '../styles/pages/InboundRegister.module.css';


const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` });
const YES_NO_FIELDS = ['steelgradeyn', 'surfaceyn', 'thicknessyn', 'widthyn', 'lengthyn'];
const GRID_FIELDS = ['itemname', 'processid', 'processnm', ...YES_NO_FIELDS, 'description'];
const TABLE_COLUMN_WIDTHS = [42, 50, 235, 185, 175, 71, 71, 71, 71, 71, 245];
const TABLE_COLUMN_MIN_WIDTHS = [38, 42, 130, 110, 110, 55, 55, 55, 55, 55, 100];

const createRow = () => ({
  id: `new-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  itemcode: '', itemname: '', itemtypecode: '', itemtypecodenm: '',
  processid: '', processcodename: '', processnm: '',
  steelgradeyn: 'N', surfaceyn: 'N', thicknessyn: 'N', widthyn: 'N', lengthyn: 'N',
  description: '', is_new: true, is_dirty: false,
});

const toRow = (item) => ({
  ...item,
  original_processid: item.processid,
  id: `${item.itemcode}:${item.processid}`,
  is_new: false,
  is_dirty: false,
});

function ItemPickerModal({ opened, onClose, onSelect }) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 20;

  const loadItems = useCallback(async () => {
    if (!opened) return;
    setLoading(true);
    try {
      const { data } = await axios.get('/api/item-process-master/items/picker', {
        headers: authHeaders(), params: { q: query.trim(), page, page_size: pageSize },
      });
      setItems(data.items || []);
      setTotal(data.total || 0);
    } catch {
      notifications.show({ title: '품목 조회 실패', message: '사용 중인 품목을 불러오지 못했습니다.', color: 'red' });
    } finally {
      setLoading(false);
    }
  }, [opened, query, page]);

  useEffect(() => { void loadItems(); }, [loadItems]);
  useEffect(() => { if (!opened) { setQuery(''); setPage(1); } }, [opened]);

  return (
    <Modal opened={opened} onClose={onClose} centered size={900}
      classNames={{ content: inboundClasses.receiptFinderModalContent, header: inboundClasses.receiptFinderModalHeader,
        title: inboundClasses.receiptFinderModalTitle, close: inboundClasses.receiptFinderModalClose }}
      title={<Group gap={8}><IconSearch size={18} /><Text fw={700}>원소재 품목 선택</Text></Group>}>
      <Stack gap="sm">
        <TextInput value={query} onChange={(event) => { setQuery(event.currentTarget.value); setPage(1); }}
          placeholder="품목코드 또는 품목명 검색" leftSection={<IconSearch size={15} />} autoFocus />
        <ScrollArea className={classes.pickerResults} h={350} type="auto" scrollbarSize={6}>
          <Table className={classes.pickerTable} withTableBorder withColumnBorders highlightOnHover>
            <Table.Thead><Table.Tr><Table.Th>품목코드</Table.Th><Table.Th>원소재 품명</Table.Th><Table.Th>형태구분</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>
              {items.map((item) => (
                <Table.Tr key={item.itemcode} className={classes.pickerRow} onDoubleClick={() => onSelect(item)} onClick={() => onSelect(item)}>
                  <Table.Td>{item.itemcode}</Table.Td><Table.Td>{item.itemname}</Table.Td><Table.Td>{item.itemtypecodenm || item.itemtypecode}</Table.Td>
                </Table.Tr>
              ))}
              {!items.length && <Table.Tr><Table.Td colSpan={3} ta="center" c="dimmed" py="xl">{loading ? '조회 중입니다.' : '조회된 품목이 없습니다.'}</Table.Td></Table.Tr>}
            </Table.Tbody>
          </Table>
        </ScrollArea>
        <Group justify="space-between"><Text size="xs" c="dimmed">총 {total.toLocaleString()}개</Text>
          <Pagination size="sm" color="red" value={page} onChange={setPage} total={Math.max(1, Math.ceil(total / pageSize))} withEdges /></Group>
      </Stack>
    </Modal>
  );
}

function ItemAutoComplete({ row, disabled, onChange, onSelect, onOpenPicker, inputProps }) {
  const [draft, setDraft] = useState(row.itemname || row.itemcode || '');
  const [items, setItems] = useState([]);
  const [opened, setOpened] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const requestRef = useRef(0);
  const skipBlurCommitRef = useRef(false);

  useEffect(() => { setDraft(row.itemname || row.itemcode || ''); }, [row.itemcode, row.itemname]);

  useEffect(() => {
    if (disabled || !draft.trim() || draft === row.itemname || draft === row.itemcode) {
      return undefined;
    }
    const requestId = ++requestRef.current;
    const timer = window.setTimeout(async () => {
      try {
        const { data } = await axios.get('/api/item-process-master/items/suggest', { headers: authHeaders(), params: { q: draft.trim() } });
        if (requestId !== requestRef.current) return;
        setItems(data.items || []);
        setActiveIndex(-1);
        setOpened((data.items || []).length > 0);
      } catch {
        if (requestId === requestRef.current) setItems([]);
      }
    }, 70);
    return () => window.clearTimeout(timer);
  }, [draft, disabled, row.itemcode, row.itemname]);

  const choose = (item) => { setDraft(item.itemname); setOpened(false); setActiveIndex(-1); onSelect(item); };
  return (
    <Popover opened={opened && !disabled} onChange={setOpened} position="bottom-start" withinPortal width="target" shadow="none" offset={0} transitionProps={{ duration: 0 }}>
      <Popover.Target>
        <div className={classes.itemPickerCell}>
          <input {...inputProps} className={`${classes.cellInput} ${classes.itemPickerInput}`} value={draft} readOnly={disabled}
            title="돋보기 커서로 원소재 품목을 조회하거나 품목명을 입력하세요." onFocus={() => {
              if (draft.trim() && draft !== row.itemname && draft !== row.itemcode && items.length) setOpened(true);
            }}
            onChange={(event) => {
              const value = event.currentTarget.value;
              requestRef.current += 1;
              setDraft(value);
              setActiveIndex(-1);
              setItems([]);
              setOpened(false);
            }}
            onBlur={() => {
              if (skipBlurCommitRef.current) { skipBlurCommitRef.current = false; return; }
              setOpened(false);
              if (draft !== row.itemname && draft !== row.itemcode) onChange();
            }}
            onKeyDown={(event) => {
              if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && opened && items.length) {
                event.preventDefault(); event.stopPropagation();
                setActiveIndex((current) => event.key === 'ArrowDown'
                  ? (current < 0 ? 0 : (current + 1) % items.length)
                  : (current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length));
              } else if (event.key === 'Enter' && opened && items.length) {
                event.preventDefault(); event.stopPropagation(); choose(items[activeIndex >= 0 ? activeIndex : 0]);
              } else if (event.key === 'Tab' && (draft !== row.itemname && draft !== row.itemcode)) {
                skipBlurCommitRef.current = true;
                const selected = activeIndex >= 0 ? items[activeIndex] : null;
                if (selected) choose(selected);
                else { onChange(); setDraft(''); setOpened(false); setActiveIndex(-1); }
              } else if (event.key === 'Escape') { event.stopPropagation(); setOpened(false); setActiveIndex(-1); }
            }}
            onDoubleClick={() => { if (!disabled) onOpenPicker(); }} />
          <button type="button" className={classes.pickerButton} disabled={disabled} onClick={onOpenPicker} aria-label="원소재 품목 조회" title="원소재 품목 조회"><IconSearch size={15} /></button>
        </div>
      </Popover.Target>
      <Popover.Dropdown className={classes.suggestions}>
        {items.map((item, index) => (
          <button type="button" className={classes.suggestion} key={item.itemcode}
            aria-selected={index === activeIndex} style={index === activeIndex ? { background: '#edf3f8' } : undefined}
            onMouseDown={(event) => event.preventDefault()} onClick={() => choose(item)}>
            <span>{item.itemname}</span>
          </button>
        ))}
      </Popover.Dropdown>
    </Popover>
  );
}

function ProcessPickerModal({ opened, onClose, options, onSelect }) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 8;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matches = options.filter((option) => !normalizedQuery
    || `${option.code} ${option.name}`.toLocaleLowerCase().includes(normalizedQuery));
  const pageCount = Math.max(1, Math.ceil(matches.length / pageSize));
  const pageItems = matches.slice((page - 1) * pageSize, page * pageSize);

  return (
    <Modal opened={opened} onClose={onClose} centered size={680}
      classNames={{ content: inboundClasses.receiptFinderModalContent, header: inboundClasses.receiptFinderModalHeader,
        title: inboundClasses.receiptFinderModalTitle, close: inboundClasses.receiptFinderModalClose }}
      title={<Group gap={8}><IconSearch size={18} /><Text fw={700}>가공공정 선택</Text></Group>}>
      <Stack gap="sm">
        <TextInput value={query} onChange={(event) => { setQuery(event.currentTarget.value); setPage(1); }}
          placeholder="공정코드 또는 가공공정명 검색" leftSection={<IconSearch size={15} />} autoFocus />
        <ScrollArea className={classes.pickerResults} h={350} type="auto" scrollbarSize={6}>
          <Table className={classes.pickerTable} withTableBorder withColumnBorders highlightOnHover>
            <Table.Thead><Table.Tr><Table.Th>공정코드</Table.Th><Table.Th>가공공정명</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>
              {pageItems.map((option) => (
                <Table.Tr key={option.code} className={classes.pickerRow} onClick={() => onSelect(option)}>
                  <Table.Td>{option.code}</Table.Td><Table.Td>{option.name}</Table.Td>
                </Table.Tr>
              ))}
              {!pageItems.length && <Table.Tr><Table.Td colSpan={2} ta="center" c="dimmed" py="xl">등록된 가공공정이 없습니다.</Table.Td></Table.Tr>}
            </Table.Tbody>
          </Table>
        </ScrollArea>
        <Group justify="space-between"><Text size="xs" c="dimmed">총 {matches.length.toLocaleString()}개 공정</Text>
          <Pagination size="sm" total={pageCount} value={page} onChange={setPage} withEdges color="red" /></Group>
      </Stack>
    </Modal>
  );
}

function ProcessAutoComplete({ row, disabled, options, onChange, onSelect, onOpenPicker }) {
  const selectedName = options.find((option) => option.code === row.processid)?.name || row.processcodename || '';
  const [draft, setDraft] = useState(selectedName);
  const [opened, setOpened] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const skipBlurCommitRef = useRef(false);
  const matches = options.filter((option) => draft.trim() && option.name.toLocaleLowerCase().includes(draft.trim().toLocaleLowerCase())).slice(0, 8);

  useEffect(() => { setDraft(selectedName); }, [selectedName]);

  const choose = (option) => {
    setDraft(option.name);
    setOpened(false);
    setActiveIndex(-1);
    onSelect(option);
  };

  return (
    <Popover opened={opened && matches.length > 0 && !disabled} onChange={setOpened}
      position="bottom-start" withinPortal width="target" shadow="none" offset={0} transitionProps={{ duration: 0 }}>
      <Popover.Target>
        <div className={classes.itemPickerCell}>
          <input className={`${classes.cellInput} ${classes.itemPickerInput}`} value={draft} disabled={disabled}
            data-row-id={row.id} data-field="processid"
            onFocus={() => { if (matches.length) setOpened(true); }}
            onChange={(event) => { setDraft(event.currentTarget.value); setActiveIndex(-1); setOpened(true); }}
            onBlur={() => {
              if (skipBlurCommitRef.current) { skipBlurCommitRef.current = false; return; }
              setOpened(false);
              if (draft !== selectedName) { setDraft(''); onChange(null); }
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
                else { setDraft(''); setOpened(false); setActiveIndex(-1); onChange(null); }
              } else if (event.key === 'Escape') { event.stopPropagation(); setOpened(false); setActiveIndex(-1); }
            }}
            onDoubleClick={() => { if (!disabled) onOpenPicker(); }} />
          <button type="button" className={classes.pickerButton} disabled={disabled}
            onClick={onOpenPicker} aria-label="가공공정 조회"><IconSearch size={15} /></button>
        </div>
      </Popover.Target>
      <Popover.Dropdown className={classes.suggestions}>
        {matches.map((option, index) => (
          <button type="button" className={classes.suggestion} key={option.code}
            aria-selected={index === activeIndex} style={index === activeIndex ? { background: '#edf3f8' } : undefined}
            onMouseDown={(event) => event.preventDefault()} onClick={() => choose(option)}>
            <span>{option.name}</span>
          </button>
        ))}
      </Popover.Dropdown>
    </Popover>
  );
}

const ProcessRuleTableRow = memo(function ProcessRuleTableRow({
  row, index, selected, saving, processOptions, onToggleSelection, onChangeRow,
  onSelectItem, onSelectProcess, onClearProcess, setPickerTarget, setProcessPickerTarget,
}) {
  return (
    <tr className={`${row.is_new ? classes.newRow : ''} ${selected ? classes.selectedRow : ''}`}>
      <td className={classes.checkCell}><input type="checkbox" checked={selected} onChange={(event) => onToggleSelection(row.id, event.nativeEvent.shiftKey)} /></td>
      <td className={classes.numberCell}>{index + 1}</td>
      <td><ItemAutoComplete row={row} disabled={!row.is_new || saving}
        inputProps={{ ...(row.is_new && !row.itemcode ? { 'data-new-item-input': row.id } : {}), 'data-row-id': row.id, 'data-field': 'itemname' }}
        onChange={() => onSelectItem(row.id, { itemcode: '', itemname: '', itemtypecode: '', itemtypecodenm: '' })}
        onSelect={(item) => onSelectItem(row.id, item)} onOpenPicker={() => setPickerTarget(row.id)} /></td>
      <td><ProcessAutoComplete row={row} disabled={saving} options={processOptions}
        onChange={(option) => option ? onSelectProcess(row.id, option) : onClearProcess(row.id)}
        onSelect={(option) => onSelectProcess(row.id, option)} onOpenPicker={() => setProcessPickerTarget(row.id)} /></td>
      <td><input className={classes.cellInput} value={row.processnm} data-row-id={row.id} data-field="processnm" disabled={saving}
        onChange={(event) => onChangeRow(row.id, 'processnm', event.currentTarget.value)} /></td>
      {YES_NO_FIELDS.map((field) => <td key={field} className={classes.flagCell}>
        <select className={classes.cellSelect} aria-label={field} data-row-id={row.id} data-field={field} value={row[field] || 'N'} disabled={saving}
          onChange={(event) => onChangeRow(row.id, field, event.currentTarget.value)}>
          <option value="Y">가능</option><option value="N">불가</option>
        </select>
      </td>)}
      <td><input className={classes.cellInput} value={row.description || ''} data-row-id={row.id} data-field="description" disabled={saving}
        onChange={(event) => onChangeRow(row.id, 'description', event.currentTarget.value)} /></td>
    </tr>
  );
});

export default function ItemProcessMaster() {
  const pageLayout = useContext(PageRibbonContext);
  const registerPageRibbon = pageLayout?.registerPageRibbon;
  const closeActivePage = pageLayout?.closeActivePage;
  const [rows, setRows] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [filterOpen, setFilterOpen] = useState(true);
  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');
  const [processFilterInput, setProcessFilterInput] = useState('');
  const [processFilter, setProcessFilter] = useState('');
  const [itemtypeFilterInput, setItemtypeFilterInput] = useState('');
  const [itemtypeFilter, setItemtypeFilter] = useState('');
  const [outputNameFilterInput, setOutputNameFilterInput] = useState('');
  const [outputNameFilter, setOutputNameFilter] = useState('');
  const [processOptions, setProcessOptions] = useState([]);
  const [pickerTarget, setPickerTarget] = useState('');
  const [processPickerTarget, setProcessPickerTarget] = useState('');
  const [deleteRequest, setDeleteRequest] = useState(null);
  const tableViewportRef = useRef(null);
  const pendingNewRowRef = useRef('');
  const loadRowsRequestRef = useRef(0);
  const selectionAnchorRef = useRef('');
  const resizeColumnRef = useRef(null);
  const [columnWidths, setColumnWidths] = useState(TABLE_COLUMN_WIDTHS);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const loadOptions = useCallback(async () => {
    try {
      const { data } = await axios.get('/api/item-process-master/options', { headers: authHeaders() });
      setProcessOptions(data.processes || []);
    } catch {
      notifications.show({ title: '조회조건 조회 실패', message: '가공공정과 형태구분을 불러오지 못했습니다.', color: 'red' });
    }
  }, []);

  const loadRows = useCallback(async () => {
    const requestId = ++loadRowsRequestRef.current;
    setLoading(true);
    try {
      const { data } = await axios.get('/api/item-process-master/rules', {
        headers: authHeaders(), params: { q: query, process_name: processFilter, itemtype_name: itemtypeFilter, output_name: outputNameFilter },
      });
      if (requestId !== loadRowsRequestRef.current) return;
      setRows((data.items || []).map(toRow));
      setSelectedIds([]);
      selectionAnchorRef.current = '';
    } catch (error) {
      if (requestId === loadRowsRequestRef.current) {
        notifications.show({ title: '가공공정 조회 실패', message: error.response?.data?.detail || '목록을 불러오지 못했습니다.', color: 'red' });
      }
    } finally {
      if (requestId === loadRowsRequestRef.current) setLoading(false);
    }
  }, [query, processFilter, itemtypeFilter, outputNameFilter]);

  useEffect(() => { void loadOptions(); }, [loadOptions]);
  useEffect(() => { void loadRows(); }, [loadRows]);

  const changeRow = useCallback((id, field, value) => {
    setRows((current) => current.map((row) => row.id === id ? { ...row, [field]: value, is_dirty: !row.is_new } : row));
  }, []);

  const selectItem = useCallback((rowId, item) => {
    setRows((current) => current.map((row) => row.id === rowId ? {
      ...row, itemcode: item.itemcode, itemname: item.itemname,
      itemtypecode: item.itemtypecode || '', itemtypecodenm: item.itemtypecodenm || '',
    } : row));
    setPickerTarget('');
  }, []);

  const selectProcess = useCallback((rowId, option) => {
    setRows((current) => current.map((row) => row.id === rowId
      ? { ...row, processid: option.code, processcodename: option.name, is_dirty: !row.is_new }
      : row));
    setProcessPickerTarget('');
  }, []);

  const clearProcess = useCallback((rowId) => {
    setRows((current) => current.map((row) => row.id === rowId
      ? { ...row, processid: '', processcodename: '', is_dirty: !row.is_new }
      : row));
  }, []);

  const addRow = useCallback(() => {
    const row = createRow();
    pendingNewRowRef.current = row.id;
    setRows((current) => [...current, row]);
    setSelectedIds([]);
    selectionAnchorRef.current = '';
  }, []);

  useEffect(() => {
    if (!pendingNewRowRef.current) return;
    const rowId = pendingNewRowRef.current;
    pendingNewRowRef.current = false;
    requestAnimationFrame(() => {
      const viewport = tableViewportRef.current;
      if (viewport) viewport.scrollTop = viewport.scrollHeight;
      const input = [...(viewport?.querySelectorAll('[data-new-item-input]') || [])]
        .find((element) => element.dataset.newItemInput === rowId);
      input?.focus({ preventScroll: true });
    });
  }, [rows]);

  const copyRow = useCallback(() => {
    if (selectedIds.length !== 1) return;
    const source = rows.find((row) => row.id === selectedIds[0]);
    if (!source) return;
    const row = { ...createRow(), itemcode: source.itemcode, itemname: source.itemname,
      itemtypecode: source.itemtypecode, itemtypecodenm: source.itemtypecodenm,
      processnm: source.processnm, steelgradeyn: source.steelgradeyn, surfaceyn: source.surfaceyn,
      thicknessyn: source.thicknessyn, widthyn: source.widthyn, lengthyn: source.lengthyn,
      description: source.description };
    setRows((current) => [...current, row]);
    setSelectedIds([row.id]);
    selectionAnchorRef.current = row.id;
  }, [rows, selectedIds]);

  const saveRows = useCallback(async () => {
    const changed = rows.filter((row) => row.is_new || row.is_dirty);
    if (!changed.length) {
      notifications.show({ title: '저장할 내용 없음', message: '변경된 가공공정이 없습니다.', color: 'gray' });
      return;
    }
    const invalid = changed.find((row) => !row.itemcode || !row.processid || !row.processnm.trim());
    if (invalid) {
      notifications.show({ title: '필수값 확인', message: '원소재 품목, 가공공정, 가공품명을 모두 입력해 주세요.', color: 'orange' });
      return;
    }
    const keys = changed.map((row) => `${row.itemcode}\u0000${row.processid}`);
    if (new Set(keys).size !== keys.length || changed.some((row) => rows.some((other) => other.id !== row.id && other.itemcode === row.itemcode && other.processid === row.processid))) {
      notifications.show({ title: '가공공정 중복', message: '동일한 원소재 품목과 가공공정은 한 번만 등록할 수 있습니다.', color: 'orange' });
      return;
    }
    setSaving(true);
    try {
      const items = changed.map(({ id, itemname, itemtypecode, itemtypecodenm, processcodename, is_dirty, ...item }) => item);
      await axios.put('/api/item-process-master/rules', { items }, { headers: authHeaders() });
      notifications.show({ title: '저장 완료', message: `${changed.length.toLocaleString()}개 가공공정을 저장했습니다.`, color: 'teal' });
      await loadRows();
    } catch (error) {
      notifications.show({ title: '저장 실패', message: error.response?.data?.detail || '가공공정을 저장하지 못했습니다.', color: 'red' });
    } finally {
      setSaving(false);
    }
  }, [rows, loadRows]);

  const requestDelete = useCallback(() => {
    const selected = rows.filter((row) => selectedIds.includes(row.id));
    if (!selected.length) return;
    const saved = selected.filter((row) => !row.is_new);
    const unsavedIds = new Set(selected.filter((row) => row.is_new).map((row) => row.id));
    if (unsavedIds.size) setRows((current) => current.filter((row) => !unsavedIds.has(row.id)));
    if (saved.length) setDeleteRequest(saved);
    else setSelectedIds([]);
  }, [rows, selectedIds]);

  const confirmDelete = useCallback(async () => {
    if (!deleteRequest?.length) return;
    setSaving(true);
    try {
      await axios.post('/api/item-process-master/rules/delete', {
        items: deleteRequest.map((row) => ({ itemcode: row.itemcode, processid: row.processid })),
      }, { headers: authHeaders() });
      notifications.show({ title: '삭제 완료', message: `${deleteRequest.length.toLocaleString()}개 가공공정을 삭제했습니다.`, color: 'teal' });
      setDeleteRequest(null);
      await loadRows();
    } catch (error) {
      notifications.show({ title: '삭제 실패', message: error.response?.data?.detail || '가공공정을 삭제하지 못했습니다.', color: 'red' });
    } finally {
      setSaving(false);
    }
  }, [deleteRequest, loadRows]);

  const exportRows = useCallback(() => {
    if (!rows.length) {
      notifications.show({ title: '다운로드할 가공공정 없음', message: '조회된 가공공정이 없습니다.', color: 'orange' });
      return;
    }
    const flagLabel = (value) => String(value || 'N').trim().toUpperCase() === 'Y' ? '가능' : '불가';
    const exportFields = [
      ['No.', (_, index) => index + 1],
      ['원소재 품명', (row) => row.itemname || ''],
      ['가공공정', (row) => row.processcodename || row.processid || ''],
      ['가공품명', (row) => row.processnm || ''],
      ['강종', (row) => flagLabel(row.steelgradeyn)],
      ['표면', (row) => flagLabel(row.surfaceyn)],
      ['두께', (row) => flagLabel(row.thicknessyn)],
      ['폭', (row) => flagLabel(row.widthyn)],
      ['길이', (row) => flagLabel(row.lengthyn)],
      ['비고', (row) => row.description || ''],
    ];
    const worksheet = XLSX.utils.aoa_to_sheet([
      exportFields.map(([label]) => label),
      ...rows.map((row, index) => exportFields.map(([, getValue]) => getValue(row, index))),
    ]);
    applyExcelHeaderStyle(worksheet, exportFields.length);
    worksheet['!cols'] = exportFields.map(([label]) => ({ wch: Math.min(30, Math.max(12, String(label).length + 4)) }));
    worksheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: exportFields.length - 1 } }) };
    const today = new Date();
    const fileDate = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '가공공정');
    XLSX.writeFile(workbook, `가공공정_${fileDate}.xlsx`);
  }, [rows]);

  const applySearch = useCallback(() => {
    setQuery(queryInput.trim());
    setProcessFilter(processFilterInput.trim());
    setItemtypeFilter(itemtypeFilterInput.trim());
    setOutputNameFilter(outputNameFilterInput.trim());
  }, [queryInput, processFilterInput, itemtypeFilterInput, outputNameFilterInput]);
  useEffect(() => {
    if (!registerPageRibbon) return undefined;
    registerPageRibbon(<ErpRibbon onSearch={applySearch} onAdd={addRow} onCopy={copyRow} onExcel={exportRows} useSaveColor={false}
      onSave={saveRows} onDelete={requestDelete} showPrint={false} onClose={closeActivePage}
      disabled={{ search: loading, add: loading || saving, copy: selectedIds.length !== 1 || saving, excel: loading || !rows.length,
        save: loading || saving, delete: selectedIds.length === 0 || saving }} loading={{ save: saving }} />);
    return () => registerPageRibbon(null);
  }, [registerPageRibbon, closeActivePage, applySearch, addRow, copyRow, exportRows, saveRows, requestDelete, loading, saving, rows.length, selectedIds.length]);

  const allSelected = rows.length > 0 && rows.every((row) => selectedIds.includes(row.id));
  const tableWidth = columnWidths.reduce((sum, width) => sum + width, 0);
  const toggleRowSelection = useCallback((id, shiftKey = false) => {
    setSelectedIds((current) => {
      const anchorId = selectionAnchorRef.current || current[current.length - 1];
      const currentRows = rowsRef.current;
      const from = currentRows.findIndex((row) => row.id === anchorId);
      const to = currentRows.findIndex((row) => row.id === id);
      if (shiftKey && from >= 0 && to >= 0) {
        selectionAnchorRef.current = id;
        return [...new Set([...current, ...currentRows.slice(Math.min(from, to), Math.max(from, to) + 1).map((row) => row.id)])];
      }
      selectionAnchorRef.current = id;
      return current.includes(id) ? current.filter((selectedId) => selectedId !== id) : [...current, id];
    });
  }, []);
  const toggleAllRows = useCallback((checked) => {
    setSelectedIds(checked ? rowsRef.current.map((row) => row.id) : []);
    selectionAnchorRef.current = '';
  }, []);
  const handleGridKeyDown = useCallback((event) => {
    const target = event.target;
    const isTextInput = target instanceof HTMLInputElement;
    if ((!isTextInput && !(target instanceof HTMLSelectElement)) || !target.dataset.rowId || !target.dataset.field) return;
    const rowIndex = rows.findIndex((row) => row.id === target.dataset.rowId);
    const fieldIndex = GRID_FIELDS.indexOf(target.dataset.field);
    if (rowIndex < 0 || fieldIndex < 0) return;

    let rowDelta = 0;
    let columnDelta = 0;
    if (event.key === 'Tab') columnDelta = event.shiftKey ? -1 : 1;
    else if (isTextInput && event.key === 'Enter') rowDelta = event.shiftKey ? -1 : 1;
    else if (isTextInput && event.key === 'ArrowDown') rowDelta = 1;
    else if (isTextInput && event.key === 'ArrowUp') rowDelta = -1;
    else if (isTextInput && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      const hasSelection = target.selectionStart !== target.selectionEnd;
      const atEdge = event.key === 'ArrowLeft' ? target.selectionStart === 0 : target.selectionEnd === target.value.length;
      if (hasSelection || !atEdge) return;
      columnDelta = event.key === 'ArrowLeft' ? -1 : 1;
    } else return;

    const viewport = tableViewportRef.current;
    if (!viewport) return;
    let nextRow = rowIndex;
    let nextColumn = fieldIndex;
    for (let attempt = 0; attempt < rows.length * GRID_FIELDS.length; attempt += 1) {
      nextRow += rowDelta;
      nextColumn += columnDelta;
      if (nextColumn < 0) { nextRow -= 1; nextColumn = GRID_FIELDS.length - 1; }
      else if (nextColumn >= GRID_FIELDS.length) { nextRow += 1; nextColumn = 0; }
      if (nextRow < 0 || nextRow >= rows.length) break;

      const nextRowId = rows[nextRow].id;
      const nextField = GRID_FIELDS[nextColumn];
      const nextInput = [...viewport.querySelectorAll('[data-row-id][data-field]')]
        .find((element) => element.dataset.rowId === nextRowId && element.dataset.field === nextField);
      if (!nextInput || nextInput.disabled || nextInput.readOnly) continue;

      event.preventDefault();
      const rect = nextInput.getBoundingClientRect();
      const viewportRect = viewport.getBoundingClientRect();
      if (rect.top < viewportRect.top) viewport.scrollTop -= viewportRect.top - rect.top;
      else if (rect.bottom > viewportRect.bottom) viewport.scrollTop += rect.bottom - viewportRect.bottom;
      if (rect.left < viewportRect.left) viewport.scrollLeft -= viewportRect.left - rect.left;
      else if (rect.right > viewportRect.right) viewport.scrollLeft += rect.right - viewportRect.right;
      nextInput.focus({ preventScroll: true });
      return;
    }
  }, [rows]);
  const startColumnResize = (event, index) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeColumnRef.current = { index, startX: event.clientX, startWidth: columnWidths[index] };
  };
  const moveColumnResize = (event) => {
    const resizing = resizeColumnRef.current;
    if (!resizing) return;
    const nextWidth = Math.max(TABLE_COLUMN_MIN_WIDTHS[resizing.index], resizing.startWidth + event.clientX - resizing.startX);
    setColumnWidths((current) => current.map((width, index) => index === resizing.index ? nextWidth : width));
  };
  const stopColumnResize = () => { resizeColumnRef.current = null; };
  const renderHeader = (label, index, className = '') => (
    <th className={className} style={{ width: columnWidths[index] }} key={index}>
      <span>{label}</span>
      <span className={classes.columnResizer} role="separator" aria-orientation="vertical" aria-label={`${label} 열 너비 조정`}
        onPointerDown={(event) => startColumnResize(event, index)} onPointerMove={moveColumnResize} onPointerUp={stopColumnResize}
        onPointerCancel={stopColumnResize} />
    </th>
  );

  return (
    <Box className={`${sharedClasses.pageShell} ${classes.page}`}>
      <ErpBreadcrumb parent="AI 가공관리" current="가공공정 관리" filterOpen={filterOpen} onOpenFilters={() => setFilterOpen(true)} />
      <Box className={classes.workspace}>
        <Paper className={`${sharedClasses.panel} ${classes.panel}`} withBorder>
          <Group className={classes.header} justify="space-between" align="flex-start">
            <Box><Group gap={9}><Text className={classes.title}>가공공정 등록</Text><Badge className={classes.count}>{rows.length}개</Badge></Group>
              <Text size="xs" c="dimmed" mt={5}>원소재 품목별 가공공정과 가공품명, 규격 적용 항목을 관리합니다.</Text></Box>
          </Group>
          <Box className={classes.tableViewport} ref={tableViewportRef} onKeyDown={handleGridKeyDown}>
            {loading ? <Box className={classes.loading}><Loader color="red" size="sm" /></Box> : (
              <table className={classes.table} style={{ width: tableWidth, minWidth: tableWidth }}>
                <colgroup>{columnWidths.map((width, index) => <col key={index} style={{ width }} />)}</colgroup>
                <thead><tr>
                  {renderHeader(<input type="checkbox" checked={allSelected} onChange={(event) => toggleAllRows(event.currentTarget.checked)} />, 0, classes.checkCell)}
                  {renderHeader('No.', 1, classes.numberCell)}{renderHeader('원소재 품명 *', 2, classes.nameCell)}
                  {renderHeader('가공공정 *', 3, classes.processCell)}{renderHeader('가공품명 *', 4, classes.outputCell)}
                  {renderHeader('강종', 5, classes.flagCell)}{renderHeader('표면', 6, classes.flagCell)}{renderHeader('두께', 7, classes.flagCell)}
                  {renderHeader('폭', 8, classes.flagCell)}{renderHeader('길이', 9, classes.flagCell)}{renderHeader('비고', 10, classes.descriptionCell)}
                </tr></thead>
                <tbody>
                  {rows.map((row, index) => <ProcessRuleTableRow key={row.id} row={row} index={index}
                    selected={selectedIds.includes(row.id)} saving={saving} processOptions={processOptions}
                    onToggleSelection={toggleRowSelection} onChangeRow={changeRow} onSelectItem={selectItem}
                    onSelectProcess={selectProcess} onClearProcess={clearProcess}
                    setPickerTarget={setPickerTarget} setProcessPickerTarget={setProcessPickerTarget} />)}                  {!rows.length && <tr><td className={classes.emptyCell} colSpan={11}>등록된 가공공정이 없습니다.</td></tr>}
                </tbody>
              </table>
            )}
          </Box>
          <Group className={sharedClasses.footer} justify="space-between"><Text size="xs" c="dimmed">조회 {rows.length.toLocaleString()}개 · 품목명 입력 또는 돋보기로 원소재 품목을 선택할 수 있습니다.</Text></Group>
        </Paper>
        {filterOpen && <Paper component="aside" className={classes.filterSidebar} withBorder>
          <Group className={classes.filterHeader} justify="space-between"><Text>조회조건</Text><ActionIcon variant="subtle" color="gray" onClick={() => setFilterOpen(false)}><IconX size={16} /></ActionIcon></Group>
          <Stack className={classes.filterFields} gap="sm">
            <TextInput label="품목/가공품명" placeholder="품목코드, 품목명 또는 가공품명" value={queryInput}
              onChange={(event) => setQueryInput(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === 'Enter') applySearch(); }} />
            <TextInput label="공정구분" placeholder="공정명 입력" value={processFilterInput}
              onChange={(event) => setProcessFilterInput(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === 'Enter') applySearch(); }} />
            <TextInput label="형태구분" placeholder="형태명 입력" value={itemtypeFilterInput}
              onChange={(event) => setItemtypeFilterInput(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === 'Enter') applySearch(); }} />
            <TextInput label="가공품명" placeholder="가공품명 입력" value={outputNameFilterInput}
              onChange={(event) => setOutputNameFilterInput(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === 'Enter') applySearch(); }} />
          </Stack>
        </Paper>}
      </Box>

      <ItemPickerModal opened={Boolean(pickerTarget)} onClose={() => setPickerTarget('')}
        onSelect={(item) => { if (pickerTarget) selectItem(pickerTarget, item); }} />
      <ProcessPickerModal key={processPickerTarget || 'closed'} opened={Boolean(processPickerTarget)} onClose={() => setProcessPickerTarget('')}
        options={processOptions} onSelect={(option) => { if (processPickerTarget) selectProcess(processPickerTarget, option); }} />
      <Modal opened={Boolean(deleteRequest?.length)} onClose={() => !saving && setDeleteRequest(null)} title="가공공정 삭제" centered size="xs">
        <Stack gap="sm"><Text size="sm" c="dimmed">선택한 {deleteRequest?.length || 0}개 가공공정을 삭제합니다. 삭제 후 복구할 수 없습니다.</Text>
          <Group justify="flex-end"><Button variant="default" onClick={() => setDeleteRequest(null)} disabled={saving}>취소</Button>
            <Button color="red" leftSection={<IconTrash size={15} />} onClick={confirmDelete} loading={saving}>삭제</Button></Group></Stack>
      </Modal>
    </Box>
  );
}
