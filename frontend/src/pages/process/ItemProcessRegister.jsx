import { useCallback, useContext, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, forwardRef } from 'react';
import axios from 'axios';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { usePageActivation } from '../../components/common/usePageReactivated';
import { LinkedOrderBadge } from '../../components/common/LinkedOrderNotice';
import XLSX from 'xlsx-js-style';
import {
  ActionIcon, Badge, Box, Button, Group, Loader, Modal, Pagination,
  Paper, Popover, Select, Stack, Table, Text, TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconBox, IconListCheck, IconPlus, IconSearch, IconTool, IconX } from '@tabler/icons-react';
import ErpBreadcrumb from '../../components/common/ErpBreadcrumb';
import ErpDateInput from '../../components/common/ErpDateInput';
import PickerModal, { ColumnResizeHandle, PickerEmpty, SelectPickerModal, pickerClasses, useResizableColumns } from '../../components/common/PickerModal';
import ErpRibbon from '../../components/common/ErpRibbon';
import { PageRibbonContext } from '../../components/layout/MainLayout';
import sharedClasses from '../../styles/pages/ManagementShared.module.css';
import simpleTheme from '../../styles/pages/SimpleTheme.module.css';
import classes from '../../styles/pages/ItemProcessRegister.module.css';
import inboundClasses from '../../styles/pages/InboundRegister.module.css';
import outboundClasses from '../../styles/pages/OutboundRegister.module.css';
import { applyExcelHeaderStyle } from '../../utils/excelHeaderStyle';
import ConfirmDeleteModal from '../../components/common/ConfirmDeleteModal';
import { cachedDateFormat } from '../../utils/dateFormat';


const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
// 원소재에서 이번 가공으로 넘어오는 이전 단계 가공비 (저장할 때 서버 계산과 같음: 남은 가공금액 × 투입중량 ÷ 남은 중량,
// 남은 중량을 다 쓰면 남은 가공금액 전부). 저장된 전표는 수불장 가공투입 행에 기록된 금액 그대로.
const carriedProcessFee = (source) => {
  if (source.stock.carriedfee != null) return num(source.stock.carriedfee) || null;
  const fee = num(source.stock.feeamt);
  const weight = num(source.weight);
  if (fee <= 0 || weight <= 0) return null;
  const stockWeight = num(source.stock.weight);
  if (stockWeight <= 0 || weight >= stockWeight) return fee;
  return Math.round(fee * weight / stockWeight);
};
// 가공금액: 수기 입력(amountManual)이면 입력값, 아니면 단가 × 중량(단가기준 KG) 또는 수량 — 서버와 같은 규칙 (소수 둘째 자리)
const calcProductAmount = (product) => {
  const basis = String(product.unit || 'KG').toUpperCase() === 'KG' ? num(product.weight) : num(product.qty);
  return Math.round(basis * num(product.unitprice) * 100) / 100;
};
const productAmount = (product) => (product.amountManual ? num(product.supplyamt) : calcProductAmount(product));
const num = (value) => Number(String(value ?? '').replace(/,/g, '')) || 0;
const numberText = (value) => num(value).toLocaleString(undefined, { maximumFractionDigits: 3 });
const cleanSourceInput = (value) => {
  const text = String(value ?? '').replace(/[^0-9.]/g, '');
  const [whole, ...rest] = text.split('.');
  return rest.length ? `${whole}.${rest.join('').slice(0, 3)}` : whole;
};
const DECIMAL_INPUT_PATTERN = /^\d*(?:\.\d{0,3})?$/;
const rawNumericValue = (value) => String(value ?? '').replace(/,/g, '');
const formatNumericInput = (value) => {
  const raw = rawNumericValue(value);
  const [integer, decimal] = raw.split('.');
  const groupedInteger = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return decimal === undefined ? groupedInteger : `${groupedInteger}.${decimal}`;
};
const formatExcelDateTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  const parts = cachedDateFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type) => parts.find((entry) => entry.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}:${part('second')}`;
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
// 가공품 한 줄이 쓰는 투입 몫 = 제품 중량 + 배부한 로스 (로스는 재고에 들어가지 않는다)
const usedWeight = (product) => num(product.weight) + num(product.lossweight);
function isSourceWeightBalanced(source) {
  const tolerance = 1e-9;
  const childrenByParent = new Map();
  source.products.forEach((product) => {
    const parentId = product.parentId || null;
    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
    childrenByParent.get(parentId).push(product);
  });
  const roots = childrenByParent.get(null) || [];
  if (!roots.length || Math.abs(roots.reduce((sum, product) => sum + usedWeight(product), 0) - num(source.weight)) > 1e-6) {
    return false;
  }
  return source.products.every((product) => {
    const children = childrenByParent.get(product.id) || [];
    return !children.length || Math.abs(children.reduce((sum, child) => sum + usedWeight(child), 0) - num(product.weight)) <= Math.max(tolerance, 1e-6);
  });
}
const emptyHeader = () => ({ processdate: today(), customcode: '', customname: '', warehousecode: '', warehousecodename: '', manager: localStorage.getItem('user_name') || '', description: '' });
const PAGE_SIZE_OPTIONS = [
  { value: '15', label: '15개씩' }, { value: '50', label: '50개씩' },
  { value: '100', label: '100개씩' }, { value: '200', label: '200개씩' },
];
const DOCUMENT_COLUMNS = [
  { key: 'processdate', label: '가공일자', width: 100, minWidth: 90 },
  { key: 'customname', label: '가공처', width: 180, minWidth: 110 },
  { key: 'warehouse', label: '창고', width: 145, minWidth: 90 },
  { key: 'manager', label: '담당자', width: 90, minWidth: 70 },
  { key: 'qty', label: '수량', width: 105, minWidth: 80 },
  { key: 'weight', label: '중량', width: 115, minWidth: 85 },
  { key: 'supplyamt', label: '공급가', width: 130, minWidth: 90 },
  { key: 'vat', label: '부가세', width: 120, minWidth: 85 },
  { key: 'unitamt', label: '합계금액', width: 135, minWidth: 95 },
  { key: 'processno', label: '가공전표', width: 175, minWidth: 120 },
  { key: 'createdat', label: '등록일자', width: 130, minWidth: 110 },
  { key: 'created_by', label: '등록자', width: 90, minWidth: 70 },
  { key: 'description', label: '비고', width: 180, minWidth: 100 },
];
// 등록일자: YYYY-MM-DD HH:mm (한국 시간) — 매출등록 목록과 같은 형식
const registeredAtText = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const parts = Object.fromEntries(cachedDateFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
};
const DETAIL_COLUMNS = [
  { key: 'select', label: '', width: 42, minWidth: 36 },
  { key: 'no', label: 'No.', width: 130, minWidth: 85 },
  { key: 'category', label: '구분', width: 95, minWidth: 70 },
  { key: 'process', label: '가공방법', width: 145, minWidth: 100 },
  { key: 'productname', label: '가공품명', width: 160, minWidth: 100 },
  { key: 'productno', label: '제품명', width: 250, minWidth: 210 },
  { key: 'thickness', label: '두께', width: 82, minWidth: 60 },
  { key: 'width', label: '폭', width: 82, minWidth: 60 },
  { key: 'length', label: '길이', width: 82, minWidth: 60 },
  { key: 'qty', label: '수량', width: 82, minWidth: 60, required: true },
  { key: 'qtyunit', label: '단위', width: 70, minWidth: 55 },
  { key: 'weight', label: '중량(KG)', width: 110, minWidth: 80, required: true },
  { key: 'lossweight', label: '로스(KG)', width: 100, minWidth: 75 },
  { key: 'unitprice', label: '단가/KG', width: 100, minWidth: 75 },
  { key: 'amount', label: '가공금액', width: 115, minWidth: 85 },
  { key: 'sourceReceipt', label: '원천전표', width: 175, minWidth: 120 },
  { key: 'sourceLine', label: '원천순번', width: 90, minWidth: 70 },
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

const PROCESS_METHOD_PICKER_COLUMNS = [
  { key: 'processid', label: '공정코드', width: 140 },
  { key: 'processname', label: '가공방법', width: 260 },
];

// 목록이 긴 Select (가공처 480 · 창고 139): Mantine Select 는 닫혀 있어도 옵션을 전부 그려서 전표를 열 때마다 느려진다.
// 닫혀 있을 때는 선택된 값 하나만 넘기고, 펼치거나 검색할 때 전체 목록을 넘긴다.
// dropdownOpened 를 넘기면 펼침을 밖에서 제어한다 (가공처: [추가] 뒤 포커스만 두고 목록은 펼치지 않음).
const LazySelect = forwardRef(function LazySelect({ data, value, onDropdownOpen, onDropdownClose, dropdownOpened, ...props }, ref) {
  const [openState, setOpen] = useState(false);
  const controlled = dropdownOpened !== undefined;
  const open = controlled ? dropdownOpened : openState;
  const shown = useMemo(() => (open ? data : data.filter((item) => item.value === value)), [open, data, value]);
  return <Select {...props} ref={ref} data={shown} value={value} {...(controlled ? { dropdownOpened } : {})}
    onDropdownOpen={() => { if (!controlled) setOpen(true); onDropdownOpen?.(); }} onDropdownClose={() => { if (!controlled) setOpen(false); onDropdownClose?.(); }} />;
});

function ProcessMethodCell({ product, options, disabled, onSelect }) {
  const selectedOption = options.find((option) => option.processid === product.processid);
  const selectedName = selectedOption?.processname || product.processcodename || '';
  const [draft, setDraft] = useState(selectedName);
  const [opened, setOpened] = useState(false);
  const [pickerOpened, setPickerOpened] = useState(false);
  // A closed Mantine Modal still mounts a Portal (a node in document.body) and its hooks, so
  // every product row paid for one while a document rendered. Mount it on first use instead.
  const [pickerMounted, setPickerMounted] = useState(false);
  const openPicker = () => { if (pickerMounted) setPickerOpened(true); else setPickerMounted(true); };
  // Open on the render after mounting so the modal keeps its usual enter transition.
  useEffect(() => { if (pickerMounted) setPickerOpened(true); }, [pickerMounted]);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [activeIndex, setActiveIndex] = useState(-1);
  const skipBlurCommitRef = useRef(false);
  // Disabled (saved) rows can never show suggestions, so skip filtering the options for them.
  const matches = disabled ? [] : options.filter((option) => draft.trim()
    && option.processname.toLocaleLowerCase().includes(draft.trim().toLocaleLowerCase())).slice(0, 8);
  const pickerMatches = pickerMounted ? options.filter((option) => !query.trim()
    || `${option.processid} ${option.processname}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) : [];
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
            onDoubleClick={() => { if (!disabled) openPicker(); }} />
          <button type="button" className={classes.processPickerButton} disabled={disabled}
            onClick={() => { setQuery(''); setPage(1); openPicker(); }} aria-label="가공방법 조회"><IconSearch size={15} /></button>
        </div>
      </Popover.Target>
      <Popover.Dropdown className={classes.processSuggestions}>
        {matches.map((option, index) => <button type="button" className={classes.processSuggestion} key={option.processid}
          aria-selected={index === activeIndex} style={index === activeIndex ? { background: '#edf3f8' } : undefined}
          onMouseDown={(event) => event.preventDefault()} onClick={() => choose(option)}><span>{option.processname}</span></button>)}
      </Popover.Dropdown>
    </Popover>
    {pickerMounted && <SelectPickerModal opened={pickerOpened} onClose={() => setPickerOpened(false)} size="sm"
      title="가공방법 선택" description="가공 결과에 적용할 가공방법을 고릅니다." icon={<IconTool size={21} stroke={1.8} />}
      searchValue={query} onSearchChange={(value) => { setQuery(value); setPage(1); }} searchPlaceholder="공정코드 또는 가공방법 검색"
      listTitle="가공방법" columns={PROCESS_METHOD_PICKER_COLUMNS} rows={pageItems} rowKey={(option) => option.processid} onSelect={choose}
      total={pickerMatches.length} page={page} pageCount={Math.max(1, Math.ceil(pickerMatches.length / pageSize))} onPageChange={setPage}
      emptyTitle="선택 가능한 가공방법이 없습니다" />}
  </>;
}


function StockPicker({ opened, onClose, onApply, existingKeys, existingWarehouseCode = '', baseDate = '' }) {
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState({});
  const [selectionWarehouseCode, setSelectionWarehouseCode] = useState(existingWarehouseCode);
  const [query, setQuery] = useState('');
  const [warehouse, setWarehouse] = useState('');
  const [thickness, setThickness] = useState('');
  const [width, setWidth] = useState('');
  const [length, setLength] = useState('');
  const [dateFrom, setDateFrom] = useState(`${today().slice(0, 8)}01`);
  const [dateTo, setDateTo] = useState(today());
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const pageSize = 30;

  const load = useCallback(async (nextPage = 1) => {
    if (dateFrom && dateTo && dateFrom > dateTo) {
      notifications.show({ title: '조회기간 확인', message: '시작일은 종료일보다 늦을 수 없습니다.', color: 'orange' });
      return;
    }
    setLoading(true);
    try {
      const { data } = await axios.get('/api/item-process-register/available-stock', {
        ...authConfig(), params: {
          page: nextPage, page_size: pageSize, q: query.trim() || undefined, warehouse: warehouse.trim() || undefined,
          thickness: thickness || undefined, width: width || undefined, length: length || undefined,
          date_from: dateFrom || undefined, date_to: dateTo || undefined,
        },
      });
      setItems(data.items || []); setTotal(data.total || 0); setPage(nextPage);
    } catch (error) {
      notifications.show({ title: '현재고 조회 실패', message: error.response?.data?.detail || '현재고를 조회하지 못했습니다.', color: 'red' });
    } finally { setLoading(false); }
  }, [query, warehouse, thickness, width, length, dateFrom, dateTo]);

  const resetAndLoadOnOpen = useEffectEvent(() => {
    // 기준일 종료 = 가공일자 (그 뒤에 들어온 재고는 이 날짜로 가공할 수 없음), 시작 = 이번 달 1일 (가공일자가 더 이르면 그 달 1일)
    const todayText = baseDate || today();
    const thisMonthStart = `${today().slice(0, 8)}01`;
    const monthStart = thisMonthStart <= todayText ? thisMonthStart : `${todayText.slice(0, 8)}01`;
    setSelected({}); setSelectionWarehouseCode(existingWarehouseCode); setQuery(''); setWarehouse(''); setThickness(''); setWidth(''); setLength('');
    setDateFrom(monthStart); setDateTo(todayText);
    void (async () => {
      setLoading(true);
      try {
        const { data } = await axios.get('/api/item-process-register/available-stock', { ...authConfig(), params: { page: 1, page_size: pageSize, date_from: monthStart, date_to: todayText } });
        setItems(data.items || []); setTotal(data.total || 0); setPage(1);
      } catch (error) {
        notifications.show({ title: '현재고 조회 실패', message: error.response?.data?.detail || '현재고를 조회하지 못했습니다.', color: 'red' });
      } finally { setLoading(false); }
    })();
  });
  useEffect(() => {
    if (opened) resetAndLoadOnOpen();
  }, [opened]);

  const toggle = (row, checked) => {
    const key = sourceKey(row);
    setSelected((current) => ({ ...current, [key]: checked }));
    if (checked && !selectionWarehouseCode) setSelectionWarehouseCode(row.warehousecode || '');
    if (!checked && !Object.entries(selected).some(([selectedKey, isSelected]) => selectedKey !== key && isSelected)) {
      setSelectionWarehouseCode(existingWarehouseCode || '');
    }
  };
  const apply = () => {
    const chosen = items.filter((row) => selected[sourceKey(row)]);
    const rows = chosen.map((row) => ({ ...row, input_qty: row.qty, input_weight: row.weight }));
    if (!rows.length) return;
    if (onApply(rows) !== false) onClose();
  };

  const baseWarehouseCode = selectionWarehouseCode || existingWarehouseCode;
  const baseWarehouseName = baseWarehouseCode ? (items.find((row) => row.warehousecode === baseWarehouseCode)?.warehousecodename || baseWarehouseCode) : '';
  const pickedCount = items.filter((row) => selected[sourceKey(row)]).length;
  const pickerColumns = useResizableColumns(PICKER_COLUMNS);
  const searchOnEnter = (event) => { if (event.key === 'Enter') void load(1); };
  const resetFilters = () => { setQuery(''); setWarehouse(''); setThickness(''); setWidth(''); setLength(''); setDateFrom(`${today().slice(0, 8)}01`); setDateTo(today()); };

  return <PickerModal opened={opened} onClose={onClose}
    title="가공 원소재 선택" description="가공에 투입할 현재고를 선택합니다. 같은 창고의 재고만 함께 담을 수 있습니다." icon={<IconBox size={22} stroke={1.7} />}
    filters={<>
      <ErpDateInput label="기준일 시작" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.currentTarget.value)} />
      <ErpDateInput label="기준일 종료" type="date" value={dateTo} onChange={(e) => setDateTo(e.currentTarget.value)} />
      <TextInput size="sm" label="창고" placeholder="창고코드 또는 창고명" value={warehouse} onChange={(e) => setWarehouse(e.currentTarget.value)} onKeyDown={searchOnEnter} />
      <TextInput size="sm" label="품목" placeholder="품목코드·품명·제품번호" leftSection={<IconSearch size={14} />} value={query} onChange={(e) => setQuery(e.currentTarget.value)} onKeyDown={searchOnEnter} />
      <TextInput size="sm" label="두께" type="number" min="0" step="0.001" placeholder="예: 1.2" style={{ width: 100 }} value={thickness} onChange={(e) => setThickness(e.currentTarget.value)} onKeyDown={searchOnEnter} />
      <TextInput size="sm" label="폭" type="number" min="0" step="0.001" style={{ width: 100 }} value={width} onChange={(e) => setWidth(e.currentTarget.value)} onKeyDown={searchOnEnter} />
      <TextInput size="sm" label="길이" type="number" min="0" step="0.001" style={{ width: 100 }} value={length} onChange={(e) => setLength(e.currentTarget.value)} onKeyDown={searchOnEnter} />
      <Button size="sm" color="red" leftSection={<IconSearch size={15} />} onClick={() => load(1)} loading={loading}>조회</Button>
      <Button size="sm" variant="default" onClick={resetFilters}>초기화</Button>
    </>}
    guide={<>
      <p>투입할 재고를 체크한 뒤 [선택 반영]을 누르세요. 처음 선택한 재고의 창고가 기준이 되며, 다른 창고의 재고는 함께 선택할 수 없습니다.</p>
      {/* 선택 전에도 같은 줄을 그려 두어 첫 선택 때 안내 상자 높이가 바뀌지 않게 한다 */}
      <div className={pickerClasses.criteria}>
        <span className={baseWarehouseCode ? undefined : pickerClasses.criteriaEmpty}><b>기준 창고</b>{baseWarehouseName || '재고를 선택하면 표시됩니다'}</span>
      </div>
    </>}
    listTitle="가공 가능 재고" count={total} loading={loading}
    selectedCount={pickedCount} selectionLabel="선택 (현재 페이지)" onClearSelection={() => { setSelected({}); setSelectionWarehouseCode(existingWarehouseCode || ''); }}
    pagination={<Pagination size="sm" color="red" total={Math.max(1, Math.ceil(total / pageSize))} value={page} onChange={load} siblings={1} disabled={loading || !total} />}
    onApply={apply} applyDisabled={!pickedCount || loading}>
    <table className={pickerClasses.table} style={{ width: `max(100%, ${pickerColumns.tableWidth}px)` }} aria-label="가공 가능 재고">
      <colgroup>{PICKER_COLUMNS.map((column) => <col key={column.key} data-column-key={column.key} style={{ width: pickerColumns.widthOf(column) }} />)}</colgroup>
      <thead><tr>{PICKER_COLUMNS.map((column, index) => <th key={column.key} className={`${index ? pickerClasses.resizableHead : ''} ${column.align ? pickerClasses[column.align] : ''}`}>{column.label}{index > 0 && <ColumnResizeHandle column={column} columns={pickerColumns} />}</th>)}</tr></thead>
      <tbody>{items.map((row) => {
        const key = sourceKey(row);
        const reason = existingKeys.has(key) ? '이미 가공 원소재로 담긴 재고입니다.'
          : row.linked_orders ? '주문서에 연결된 재고입니다.'
            : baseWarehouseCode && row.warehousecode !== baseWarehouseCode ? '기준 창고와 다른 창고의 재고는 함께 선택할 수 없습니다.' : '';
        const picked = Boolean(selected[key]);
        return <tr key={key} className={picked ? pickerClasses.selectedRow : reason ? pickerClasses.disabledRow : ''} title={reason || undefined}
          onClick={() => { if (!reason || picked) toggle(row, !picked); }}>
          <td className={pickerClasses.center}><input className={pickerClasses.checkbox} type="checkbox" checked={picked} disabled={Boolean(reason) && !picked} onClick={(e) => e.stopPropagation()} onChange={(e) => toggle(row, e.currentTarget.checked)} aria-label={`${row.itemname} 재고 선택`} /></td>
          <td>{({ OPENING: '기초', INBOUND: '입고', PROCESS: '가공', TRANSFER: '이동' })[row.stockkind || row.sourcetype] || '입고'}<LinkedOrderBadge orders={row.linked_orders} /></td>
          <td>{String(row.receiptdate || '').slice(0, 10)}</td>
          <td>{row.warehousecodename}</td>
          <td title={row.itemname || ''}>{row.itemname}</td>
          <td title={row.productname || ''}>{row.productname}</td>
          <td>{row.materialname || row.myrtle}</td>
          <td className={pickerClasses.right}>{numberText(row.thickness)}</td>
          <td className={pickerClasses.right}>{numberText(row.width)}</td>
          <td className={pickerClasses.right}>{numberText(row.length)}</td>
          <td className={pickerClasses.right}>{numberText(row.qty)}</td>
          <td className={pickerClasses.right}>{numberText(row.weight)}</td>
        </tr>;
      })}
      {!items.length && <tr><td colSpan={PICKER_COLUMNS.length} className={pickerClasses.emptyCell}>
        <PickerEmpty title={loading ? '현재고를 조회하고 있습니다' : '가공 가능한 현재고가 없습니다'} description={loading ? '' : '검색 조건을 바꿔 다시 조회해 주세요.'} />
      </td></tr>}
      </tbody>
    </table>
  </PickerModal>;
}

// 가공 최적화에서 확정한 코일 계획 → 계획 하나를 가공전표 1장으로 불러온다 (현재고 조회와 같은 선택 창 틀)
const PLAN_COLUMNS = [
  { key: 'select', label: '선택', width: 52, align: 'center' },
  { key: 'planno', label: '계획번호', width: 140 },
  { key: 'mode', label: '가공방식', width: 110 },
  { key: 'runs', label: '차수', width: 64, align: 'center' },
  { key: 'pattern', label: '칼 배치 · 절단', width: 200 },
  { key: 'weight', label: '가공중량', width: 104, align: 'right' },
  { key: 'raw', label: '원자재', width: 170 },
  { key: 'stock', label: '현재고', width: 104, align: 'right' },
  { key: 'warehouse', label: '창고', width: 110 },
  { key: 'source', label: '원천전표', width: 170 },
  { key: 'orders', label: '주문', width: 220 },
  { key: 'status', label: '상태', width: 170 },
];
const planModeText = (plan) => (plan.materialtype === 'SHEET'
  ? (plan.sheetkind === 'COIL' ? '시트 · 코일 길이 절단' : `시트 · ${plan.combo === 'MIXED' ? '혼합절단' : '단독절단'}`)
  : `${plan.processmode === 'SPLIT' ? '등분' : plan.processmode === 'PARTIAL' ? '일부가공' : '원샷'} · ${plan.combo === 'MIXED' ? '혼합' : '단독'}`);
function PlanRunPicker({ opened, initialQuery, onClose, onPick }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState(initialQuery || '');
  const [picked, setPicked] = useState('');
  const columns = useResizableColumns(PLAN_COLUMNS);
  useEffect(() => {
    if (!opened) return undefined;
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const { data } = await axios.get('/api/item-process-register/plans', authConfig());
        if (alive) setItems(data.items || []);
      } catch (error) {
        if (alive) notifications.show({ title: '계획 조회 실패', message: error.response?.data?.detail || '확정 계획을 조회하지 못했습니다.', color: 'red' });
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [opened]);
  const keyword = query.trim().toLowerCase();
  const rows = items.filter((plan) => !keyword || [plan.planno, plan.itemname, plan.lines, plan.stocksourceno]
    .some((value) => String(value || '').toLowerCase().includes(keyword)));
  const isDone = (plan) => plan.status === 'DONE' || (plan.processnos || []).length > 0;
  const chosen = rows.find((plan) => plan.planno === picked && !isDone(plan)) || null;
  const patternText = (plan) => [...new Set(plan.runs.map((run) => run.pattern))].join(' / ');
  return <PickerModal opened={opened} onClose={onClose}
    title="가공계획 불러오기" description="가공 최적화에서 확정한 코일 · 시트 계획을 가공전표로 불러옵니다." icon={<IconListCheck size={22} stroke={1.7} />}
    filters={<>
      <TextInput size="sm" label="검색" placeholder="계획번호 · 품명 · 주문번호 · 원천전표" leftSection={<IconSearch size={14} />} style={{ width: 320 }}
        value={query} onChange={(e) => setQuery(e.currentTarget.value)} />
      <Button size="sm" variant="default" onClick={() => setQuery('')}>초기화</Button>
    </>}
    guide={<p>계획 1개 = 가공전표 1장입니다. 코일은 원소재 아래 등분(차수)과 슬리팅(칼마다 1줄) — 일부가공 · 등분에서 남는 코일은 투입하지 않고 원래 재고에 남습니다. 시트는 원소재(원판 · 코일) 아래 품목별 절단 1줄이 로스 배부와 함께 채워지며, 저장해야 현재고에 반영됩니다.</p>}
    listTitle="확정 계획" count={rows.length} loading={loading} listHint="행을 눌러 계획을 고르세요"
    selectedCount={chosen ? 1 : 0} onClearSelection={() => setPicked('')}
    applyLabel="불러오기" applyDisabled={!chosen} onApply={() => chosen && onPick(chosen.planno)}>
    <table className={pickerClasses.table} style={{ width: `max(100%, ${columns.tableWidth}px)` }} aria-label="확정 계획">
      <colgroup>{PLAN_COLUMNS.map((column) => <col key={column.key} data-column-key={column.key} style={{ width: columns.widthOf(column) }} />)}</colgroup>
      <thead><tr>{PLAN_COLUMNS.map((column, index) => <th key={column.key} className={`${index ? pickerClasses.resizableHead : ''} ${column.align ? pickerClasses[column.align] : ''}`}>
        {column.label}{index > 0 && <ColumnResizeHandle column={column} columns={columns} />}</th>)}</tr></thead>
      <tbody>{rows.map((plan) => {
        const done = isDone(plan);
        const isPicked = picked === plan.planno && !done;
        const docs = (plan.processnos || []).join(', ');
        return <tr key={plan.planno} className={isPicked ? pickerClasses.selectedRow : done ? pickerClasses.disabledRow : ''}
          title={done ? `이미 ${docs} 전표로 등록된 계획입니다.` : undefined} onClick={() => { if (!done) setPicked(plan.planno); }}>
          <td className={pickerClasses.center}><input className={pickerClasses.checkbox} type="radio" name="plan-pick" checked={isPicked} disabled={done}
            onClick={(e) => e.stopPropagation()} onChange={() => setPicked(plan.planno)} aria-label={`${plan.planno} 선택`} /></td>
          <td><b>{plan.planno}</b></td>
          <td>{planModeText(plan)}</td>
          <td className={pickerClasses.center}>{plan.runs.length}차</td>
          <td title={patternText(plan)}>{patternText(plan)}</td>
          <td className={pickerClasses.right}>{numberText(plan.inputweight)}</td>
          <td title={plan.itemname || ''}>{plan.itemname} {numberText(plan.thickness)} × {numberText(plan.width)}{plan.materialtype === 'SHEET' && plan.length ? ` × ${numberText(plan.length)}` : ''}</td>
          <td className={pickerClasses.right}>{numberText(plan.stockweight)}</td>
          <td>{plan.warehousecodename || ''}</td>
          <td>{plan.stocksourceno}-{plan.stocksourceline}</td>
          <td title={plan.lines || ''}>{plan.lines || ''}</td>
          <td title={docs}>{plan.status === 'DONE' ? `가공완료 · ${docs}` : docs ? `등록됨 · ${docs}` : '미등록'}</td>
        </tr>;
      })}
      {!rows.length && <tr><td colSpan={PLAN_COLUMNS.length} className={pickerClasses.emptyCell}>
        <PickerEmpty title={loading ? '확정 계획을 조회하고 있습니다' : '불러올 확정 계획이 없습니다'} description={loading ? '' : '가공 최적화에서 현재고 원자재로 계획을 확정하면 여기에 표시됩니다.'} />
      </td></tr>}
      </tbody>
    </table>
  </PickerModal>;
}

const PICKER_COLUMNS = [
  { key: 'select', label: '선택', width: 52, align: 'center' },
  { key: 'sourcetype', label: '구분', width: 90 },
  { key: 'receiptdate', label: '입고일자', width: 100 },
  { key: 'warehouse', label: '창고', width: 130 },
  { key: 'itemname', label: '품명', width: 160 },
  { key: 'productname', label: '제품명', width: 200 },
  { key: 'material', label: '강종', width: 100 },
  { key: 'thickness', label: '두께', width: 80, align: 'right' },
  { key: 'width', label: '폭', width: 80, align: 'right' },
  { key: 'length', label: '길이', width: 80, align: 'right' },
  { key: 'qty', label: '현재수량', width: 100, align: 'right' },
  { key: 'weight', label: '현재중량', width: 120, align: 'right' },
];


export default function ItemProcessRegister() {
  const pageActivation = usePageActivation(); // 탭에 돌아올 때마다 목록(코드·거래처)을 다시 불러온다
  const pageLayout = useContext(PageRibbonContext);
  const [filterOpen, setFilterOpen] = useState(true);
  const [header, setHeader] = useState(emptyHeader);
  const [sources, setSources] = useState([]);
  const [selectedDetailIds, setSelectedDetailIds] = useState([]);
  const selectionAnchorRef = useRef('');
  const lastAddTargetRef = useRef(null);
  const productNumberCounterRef = useRef({});
  const [documents, setDocuments] = useState([]);
  const [documentTotal, setDocumentTotal] = useState(0);
  const [documentPage, setDocumentPage] = useState(1);
  const [documentPageSize, setDocumentPageSize] = useState(15);
  const documentSubtotalRef = useRef(null);
  const documentTableRef = useRef(null);
  const documentCacheRef = useRef(new Map());
  const documentDataRef = useRef(new Map());  // 응답이 이미 도착한 전표 (마우스를 올릴 때 미리 받아 둔 것)
  const documentListRequestIdRef = useRef(0);
  const detailRequestIdRef = useRef(0);
  const [deleteDocumentNos, setDeleteDocumentNos] = useState([]);
  const [deleteDocumentsOpen, setDeleteDocumentsOpen] = useState(false);
  const [documentColumnWidths, setDocumentColumnWidths] = useState({});
  const [detailColumnWidths, setDetailColumnWidths] = useState({});
  const [options, setOptions] = useState({ customers: [], warehouses: [], rules: [] });
  const [stockOpen, setStockOpen] = useState(false);
  // 가공 최적화 계획 연동: { planno } (계획 불러오기로 만든 전표 · 계획 1개 = 전표 1장)
  const [planLink, setPlanLink] = useState(null);
  const [planPickerOpen, setPlanPickerOpen] = useState(false);
  const [planPickerQuery, setPlanPickerQuery] = useState('');
  const notifyPlanLocked = () => notifications.show({ title: '계획 전표는 행을 바꿀 수 없습니다',
    message: '가공계획 그대로 등록합니다. 다르게 가공하려면 가공최적화에서 계획을 다시 확정해 주세요.', color: 'orange' });
  // 가공 최적화 [재고가공등록으로 이동] → ?planno= 로 열리면 선택 창 없이 그 계획을 바로 불러온다 (아래 loadPlan)
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const urlPlanno = searchParams.get('planno') || '';
  const closePlanPicker = () => {
    setPlanPickerOpen(false);
    if (urlPlanno) navigate('/ItemProcessRegister', { replace: true });
  };
  const [selectedProcessno, setSelectedProcessno] = useState('');
  const selectedProcessnoRef = useRef('');
  // 저장된 가공전표는 다른 등록 화면(매입·매출·재고이동)처럼 읽기 전용. 바꾸려면 삭제 후 다시 등록한다
  const readOnly = Boolean(selectedProcessno);
  // 가공처: [추가] 뒤 포커스만 두고 목록은 펼치지 않는다 (클릭·입력하면 펼침) — 매출등록의 매출처와 같게
  const customerRef = useRef(null);
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false);
  const suppressCustomerDropdownRef = useRef(false);
  const [focusTick, setFocusTick] = useState(0);
  const focusCustomer = useCallback(() => {
    suppressCustomerDropdownRef.current = true;
    customerRef.current?.focus();
    suppressCustomerDropdownRef.current = false;
  }, []);
  useEffect(() => { if (focusTick) focusCustomer(); }, [focusTick, focusCustomer]);
  // 계획에서 불러온 전표는 계획 그대로: 행 추가 · 복사 · 선택삭제 불가 (다르게 하려면 계획을 다시 확정)
  const structureLocked = readOnly || Boolean(planLink);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filters, setFilters] = useState({
    date_from: `${today().slice(0, 8)}01`, date_to: today(),
    customer: '', warehouse: '', processno: '', iteminfo: '', productinfo: '',
  });

  const reset = useCallback(() => {
    detailRequestIdRef.current += 1;
    setDetailLoading(false);
    setHeader(emptyHeader());
    setSources([]);
    setSelectedDetailIds([]);
    selectionAnchorRef.current = '';
    lastAddTargetRef.current = null;
    selectedProcessnoRef.current = '';
    setSelectedProcessno('');
    setPlanLink(null);
  }, []);

  const loadDocuments = useCallback(async (nextPage = 1, focusProcessno = '') => {
    const requestId = ++documentListRequestIdRef.current;
    setLoading(true);
    documentCacheRef.current.clear();
    documentDataRef.current.clear();
    try {
      const params = { ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)), page: nextPage, page_size: documentPageSize, ...(focusProcessno ? { focus_processno: focusProcessno } : {}) };
      const { data } = await axios.get('/api/item-process-register/documents', { ...authConfig(), params });
      if (requestId !== documentListRequestIdRef.current) return;
      const nextDocuments = data.items || [];
      const nextTotal = Number(data.total) || 0;
      setDocuments(nextDocuments);
      setDocumentTotal(nextTotal);
      setDocumentPage(Number(data.page) || nextPage);
      // Close the open document only when the search no longer returns it at all
      // (it may simply be on another page now that the list is paged).
      if (selectedProcessnoRef.current && nextPage === 1 && nextTotal <= nextDocuments.length
        && !nextDocuments.some((item) => item.processno === selectedProcessnoRef.current)) reset();
    } catch (error) {
      if (requestId === documentListRequestIdRef.current) notifications.show({ title: '\uac00\uacf5 \uc870\ud68c \uc2e4\ud328', message: error.response?.data?.detail || '\uac00\uacf5\uc804\ud45c\ub97c \uc870\ud68c\ud558\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4.', color: 'red' });
    } finally {
      if (requestId === documentListRequestIdRef.current) setLoading(false);
    }
  }, [filters, reset, documentPageSize]);

  useEffect(() => { void loadDocuments(); }, [loadDocuments]);
  useEffect(() => {
    axios.get('/api/item-process-register/options', authConfig()).then(({ data }) => setOptions(data)).catch(() => notifications.show({ title: '기준정보 조회 실패', message: '가공처·창고·가공공정을 조회하지 못했습니다.', color: 'red' }));
  }, [pageActivation]);

  const fetchDocument = useCallback((processno) => {
    const cache = documentCacheRef.current;
    if (!cache.has(processno)) {
      const request = axios.get(`/api/item-process-register/documents/${encodeURIComponent(processno)}`, authConfig())
        .then(({ data }) => {
          if (cache.get(processno) === request) documentDataRef.current.set(processno, data);
          return data;
        })
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
  // 전표 내용을 화면에 반영 (한 번에 그린다)
  const applyDocument = useCallback((data) => {
    setSelectedDetailIds([]);
    selectionAnchorRef.current = '';
    setPlanLink(data.header.planno ? { planno: data.header.planno } : null);
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
          warehousecodename: source.sourcewarehousecodename, costprice: source.costprice, carriedfee: source.feeamt,
        },
        qty: String(source.qty), weight: String(source.weight),
        products: products.map((product) => ({
          id: `saved-${product.lineno}`,
          parentId: product.parentlineno === source.lineno ? null : `saved-${product.parentlineno}`,
          processid: product.processid || '', processcodename: product.processcodename || '',
          productno: parentLineNumbers.has(product.lineno) ? '' : product.productname || '', productname: product.itemname || '', thickness: product.thickness ?? '', width: product.width ?? '',
          length: product.length ?? '', qty: String(product.qty), qtyunit: product.qtyunit || '',
          weight: String(product.weight), lossweight: String(product.lossweight || 0), unit: product.unit || 'KG', unitprice: String(product.unitprice || 0),
          supplyamt: String(product.supplyamt ?? ''),
          amountManual: Math.abs(num(product.supplyamt) - calcProductAmount({ unit: product.unit, weight: product.weight, qty: product.qty, unitprice: product.unitprice })) > 0.004,
          description: product.description || '',
        })),
      };
    }));
  }, []);
  // 저장된 전표 열기: 이미 받아 둔 데이터면 클릭 즉시 한 번에 그리고, 아니면 받을 때까지 지금 화면을 두었다가 바꾼다
  // (먼저 비웠다가 다시 그리는 두 번 그리기를 없앰 → 매입등록처럼 바로 반응)
  const openDocument = useCallback(async (processno, force = false) => {
    if (!force && processno === selectedProcessno) return;
    const requestId = ++detailRequestIdRef.current;
    selectedProcessnoRef.current = processno;
    setSelectedProcessno(processno);
    lastAddTargetRef.current = null;
    const ready = !force && documentDataRef.current.get(processno);
    if (ready) {
      setDetailLoading(false);
      applyDocument(ready);
      return;
    }
    setDetailLoading(true);
    try {
      const data = await fetchDocument(processno);
      if (requestId !== detailRequestIdRef.current) return;
      applyDocument(data);
    } catch (error) {
      if (requestId === detailRequestIdRef.current) {
        selectedProcessnoRef.current = '';
        setSelectedProcessno('');
        notifications.show({ title: '가공 상세 조회 실패', message: error.response?.data?.detail || '가공 상세를 조회하지 못했습니다.', color: 'red' });
      }
    } finally {
      if (requestId === detailRequestIdRef.current) {
        setDetailLoading(false);
      }
    }
  }, [fetchDocument, selectedProcessno, applyDocument]);
  const addStocks = (rows) => {
    const warehouseCode = rows[0]?.warehousecode || '';
    if (!warehouseCode || rows.some((row) => row.warehousecode !== warehouseCode)) return false;
    const addedSources = rows.map((row) => ({ id: uid(), stock: row, qty: '', weight: '', inputEditable: true, products: [] }));
    const selectedWarehouse = rows[0];
    setHeader((current) => ({ ...current, warehousecode: warehouseCode, warehousecodename: selectedWarehouse.warehousecodename || warehouseCode }));
    setSources((current) => [...current, ...addedSources]);
    const addedIds = addedSources.map((source) => source.id);
    setSelectedDetailIds(addedIds);
    selectionAnchorRef.current = addedIds.at(-1) || '';
    lastAddTargetRef.current = addedIds.length ? { sourceId: addedIds.at(-1), parentId: null } : null;
    return true;
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
    if (planLink) { notifyPlanLocked(); return; }
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
        ...source, products: [...source.products.map((product) => product.id === parentId ? { ...product, productno: '' } : product), { id: uid(), parentId, processid: '', processcodename: '', productno, productname: source.stock.itemname || '', thickness: source.stock.thickness ?? '', width: source.stock.width ?? '', length: source.stock.length ?? '', qty: '1', qtyunit: source.stock.qtyunit || 'EA', weight: '', lossweight: '0', unit: 'KG', unitprice: '0', description: '' }],
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
  }, [allocateProductno, readOnly, sources, planLink]);
  const copySelectedDetail = useCallback(async () => {
    if (readOnly || saving) return;
    if (planLink) { notifyPlanLocked(); return; }
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
  }, [allocateProductno, readOnly, saving, selectedDetailIds, sources, planLink]);
  // [추가] (리본) = 매출등록과 같게: 언제 누르든 새 전표로 초기화하고 가공처에 포커스. 재고조회 창은 바로 띄우지 않고,
  // 가공일자 / 가공처를 먼저 채운 뒤 [현재고 조회]로 원소재를 담는다. 가공품 행은 원소재·가공품 행의 [+]로 추가한다.
  const handleAdd = useCallback(() => {
    if (saving) return;
    reset();
    setFocusTick((tick) => tick + 1);   // 그린 뒤(입력 가능해진 뒤) 가공처에 포커스
  }, [saving, reset]);
  // [현재고 조회]: 가공일자·가공처를 먼저 입력해야 열린다
  const openStockLookup = useCallback(() => {
    if (saving) return;
    if (readOnly) {
      notifications.show({ title: '새 가공을 시작해 주세요', message: '저장된 전표에는 원소재를 추가할 수 없습니다. [추가]를 누른 뒤 가공일자·가공처를 입력하고 현재고 조회를 눌러 주세요.', color: 'orange' });
      return;
    }
    if (planLink) { notifyPlanLocked(); return; }
    const missing = [];
    if (!String(header.processdate || '').trim()) missing.push('가공일자');
    if (!String(header.customcode || '').trim()) missing.push('가공처');
    if (missing.length) {
      notifications.show({ title: '가공 기본을 먼저 입력해 주세요', message: `${missing.join(', ')}을(를) 입력한 뒤 현재고 조회를 눌러 주세요.`, color: 'orange' });
      if (!String(header.customcode || '').trim()) focusCustomer();
      return;
    }
    setStockOpen(true);
  }, [saving, readOnly, planLink, header.processdate, header.customcode, focusCustomer]);
  // 원소재 투입량: 판재·코일 모두 투입 수량을 입력하고, 중량은 현재고 비율로 계산 (다 쓰면 현재고 중량 그대로)
  const updateSourceQty = (sourceId, value) => setSources((current) => current.map((source) => {
    if (source.id !== sourceId) return source;
    const text = cleanSourceInput(value);
    const qty = num(text);
    const stockQty = num(source.stock.qty);
    const stockWeight = num(source.stock.weight);
    const weight = !text || qty <= 0 || stockQty <= 0 ? '' : qty >= stockQty ? String(stockWeight) : String(Math.round(stockWeight * qty / stockQty * 1000) / 1000);
    return { ...source, qty: text, weight };
  }));
  // 가공금액 수기 입력: 값을 넣으면 그 금액을 쓰고, 비우면 다시 단가 × 중량 자동 계산
  const setProductAmount = (sourceId, productId, value) => setSources((current) => current.map((source) => source.id !== sourceId ? source : {
    ...source,
    products: source.products.map((product) => {
      if (product.id !== productId) return product;
      const text = String(value ?? '').trim();
      if (!text) return { ...product, supplyamt: '', amountManual: false };
      if (num(text) === calcProductAmount(product) && !product.amountManual) return product;
      return { ...product, supplyamt: text, amountManual: true };
    }),
  }));
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
      .reduce((sum, item) => sum + usedWeight(item), 0);
    const availableWeight = Math.max(0, parentWeight - siblingWeight - num(product.lossweight));
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
      .reduce((sum, item) => sum + usedWeight(item), 0);
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
      notifications.show({ title: '가공등록 삭제 완료', message: `${deletedProcessno} 전표를 삭제했습니다.`, color: 'teal' });
      await loadDocuments();
    } catch (error) {
      notifications.show({ title: '가공등록 삭제 실패', message: error.response?.data?.detail || '현재고와 수불 내역을 복구하지 못해 가공전표를 삭제하지 못했습니다.', color: 'red' });
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
        // 가공규칙의 가공품명 → 입력된 값 → 원소재 품명 순 (비워 두지 않는다)
        productname: rule?.productname || row.productname || source.stock.itemname || '',
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
    return productSum + productAmount(product);
  }, 0), 0);
  const totalLossWeight = sources.reduce((sum, source) => sum + source.products.reduce((s2, p) => s2 + num(p.lossweight), 0), 0);
  const weightDifference = totalSourceWeight - totalLeafWeight - totalLossWeight;
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
      // kg 정수로 나눈다: 1kg 단위로 똑같이, 나머지 kg 와 소수 자투리는 마지막 줄 (합계는 정확히 일치)
      const lossMilliKg = products.reduce((sum, product) => sum + Math.round(num(product.lossweight) * 1000), 0);
      const targetMilliKg = Math.max(0, Math.round(targetWeight * 1000) - lossMilliKg);
      const evenShareMilliKg = Math.floor(targetMilliKg / 1000 / products.length) * 1000;
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
  // 로스 배부: 원소재 투입 − 1차 가공품 중량 = 로스 → 1차 가공품 중량 비율로 나눈다 (0.001kg 단위, 합계 정확히 일치)
  const distributeLoss = () => {
    if (!sources.length || sources.some((source) => !source.products.length)) {
      notifications.show({ title: '로스 배부 확인', message: '현재고 원소재와 가공품을 먼저 추가해 주세요.', color: 'orange' });
      return;
    }
    let short = false;
    setSources((current) => current.map((source) => {
      const roots = source.products.filter((product) => !product.parentId);
      const lossMilli = Math.round(num(source.weight) * 1000) - roots.reduce((sum, product) => sum + Math.round(num(product.weight) * 1000), 0);
      if (lossMilli < 0) { short = true; return source; }
      // kg 정수로 나눈다 (큰 나머지 순으로 1kg 씩), 1kg 미만 자투리는 가장 큰 줄에 붙여 합계를 정확히 맞춘다
      const lossKg = Math.floor(lossMilli / 1000);
      const bases = roots.map((product) => num(product.weight));
      const whole = bases.reduce((sum, value) => sum + value, 0) || roots.length;
      const exact = roots.map((_, index) => (lossKg * (bases[index] || (whole === roots.length ? 1 : 0))) / whole);
      const shares = exact.map(Math.floor);
      let left = lossKg - shares.reduce((sum, value) => sum + value, 0);
      exact.map((value, index) => [value - shares[index], index]).sort((a, b) => b[0] - a[0]).forEach(([, index]) => { if (left > 0) { shares[index] += 1; left -= 1; } });
      const largest = bases.indexOf(Math.max(...bases));
      const milli = shares.map((kg, index) => kg * 1000 + (index === largest ? lossMilli - lossKg * 1000 : 0));
      const byId = new Map(roots.map((product, index) => [product.id, (milli[index] / 1000).toFixed(3)]));
      return { ...source, products: source.products.map((product) => (byId.has(product.id) ? { ...product, lossweight: byId.get(product.id) } : product)) };
    }));
    if (short) notifications.show({ title: '로스 배부 확인', message: '가공품 중량 합계가 투입 중량보다 큰 원소재는 배부하지 않았습니다.', color: 'orange' });
    else notifications.show({ title: '로스 배부 완료', message: '투입 − 제품 중량을 가공품 중량 비율로 kg 단위로 나눴습니다.', color: 'teal' });
  };
  // 계획 불러오기: 계획 전체를 새 가공전표 초안으로 채운다 (원소재 → 등분 → 슬리팅, 저장 전에는 재고 변화 없음)
  const loadPlan = async (planno) => {
    try {
      const { data } = await axios.get(`/api/item-process-register/plans/${encodeURIComponent(planno)}/draft`, authConfig());
      reset();
      const stock = data.stock;
      setHeader({ ...emptyHeader(), warehousecode: stock.warehousecode || '', warehousecodename: stock.warehousecodename || '',
        description: `가공계획 ${planno}` });
      // 원판 계획은 로트마다 원소재 1줄 (data.sources) · 그 밖은 1줄
      const draftSources = data.sources?.length ? data.sources : [{ stock, source: data.source, products: data.products }];
      setSources(draftSources.map((draft) => {
        const ids = new Map(draft.products.map((product) => [product.key, uid()]));
        return {
        id: uid(), stock: draft.stock, qty: String(draft.source.qty), weight: String(draft.source.weight),
        products: draft.products.map((product) => ({
          id: ids.get(product.key), parentId: product.parent ? ids.get(product.parent) : null,
          processid: product.processid || '', processcodename: product.processcodename || '', productno: '',
          productname: product.productname || '', thickness: product.thickness ?? '', width: product.width ?? '', length: product.length ?? '',
          qty: String(product.qty), qtyunit: product.qtyunit || 'EA', weight: String(product.weight), lossweight: String(product.lossweight || 0),
          unit: 'KG', unitprice: '0', description: product.description || '',
        })),
      };
      }));
      setPlanLink({ planno, runs: data.runs });
      closePlanPicker();
      const slits = data.products.filter((product) => product.key.startsWith('slit')).length;
      // 시트 계획: 원판 N매(또는 코일 사용 중량) → 품목별 절단 1줄
      const message = data.materialtype === 'SHEET'
        ? `${planno} · ${data.sheetkind === 'COIL' ? `코일 ${numberText(data.source.weight)}kg 길이 절단` : `원판 ${numberText((data.sources || [data]).reduce((sum, s) => sum + Number(s.source.qty || 0), 0))}매 절단${data.sources?.length > 1 ? ` (로트 ${data.sources.length}개)` : ''}`} · 품목 ${(data.sources || [data]).reduce((sum, s) => sum + s.products.length, 0)}줄 · 로스 ${numberText(data.loss)}kg 배부. 가공처를 고르고 저장해 주세요.`
        : `${planno} · 슬리팅 ${slits}줄${Number(data.keep) > 0 ? ` · 보관분 ${numberText(data.keep)}kg` : ''} · 로스 ${numberText(data.loss)}kg 배부. 가공처를 고르고 저장해 주세요.`;
      notifications.show({ title: '계획 불러오기', message, color: 'teal' });
    } catch (error) {
      notifications.show({ title: '계획 불러오기 실패', message: error.response?.data?.detail || '계획을 불러오지 못했습니다.', color: 'red' });
      if (urlPlanno) navigate('/ItemProcessRegister', { replace: true });
    }
  };
  const loadPlanFromUrl = useEffectEvent((planno) => { void loadPlan(planno); });
  useEffect(() => { if (urlPlanno) loadPlanFromUrl(urlPlanno); }, [urlPlanno]);

  const save = useCallback(async () => {
    if (readOnly) return;
    if (!header.customcode || !header.warehousecode || !sources.length) {
      notifications.show({ title: '입력 확인', message: '가공일자·가공처·창고와 현재고 원소재를 확인해 주세요.', color: 'orange' }); return;
    }
    const badSource = sources.find((source) => num(source.weight) <= 0
      || (source.inputEditable && (num(source.qty) <= 0 || num(source.qty) > num(source.stock.qty))));
    if (badSource) {
      notifications.show({ title: '투입 수량 확인', message: `${badSource.stock.itemname || '원소재'}의 투입 수량을 현재고 이내로 입력해 주세요.`, color: 'orange' }); return;
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
      const payload = { ...header, ...(selectedProcessno ? { processno: selectedProcessno } : {}), ...(planLink ? { planno: planLink.planno } : {}), sources: sources.map((source) => ({ stocksourcetype: source.stock.sourcetype, stocksourceno: source.stock.sourceno, stocksourceline: source.stock.sourceline, qty: num(source.qty), weight: num(source.weight), products: source.products.map((p) => ({ clientid: p.id, parent_clientid: p.parentId, processid: p.processid, processcodename: p.processcodename, productno: p.productno, productname: p.productname, thickness: p.thickness === '' ? null : num(p.thickness), width: p.width === '' ? null : num(p.width), length: p.length === '' ? null : num(p.length), qty: num(p.qty), qtyunit: source.stock.qtyunit || p.qtyunit, weight: num(p.weight), lossweight: num(p.lossweight), unit: p.unit, unitprice: num(p.unitprice), supplyamt: p.amountManual ? num(p.supplyamt) : null, description: p.description })) })) };
      const { data } = await axios.post('/api/item-process-register/documents', payload, authConfig());
      if (data.product_numbers) {
        setSources((current) => current.map((source) => ({ ...source, products: source.products.map((product) => ({ ...product, productno: data.product_numbers[product.id] || product.productno })) })));
      }
      const wasEditing = Boolean(selectedProcessno);
      notifications.show({ title: wasEditing ? '가공 수정 완료' : '가공 등록 완료', message: `${data.processno} 전표가 현재고와 수불장에 반영되었습니다.`, color: 'teal' });
      await loadDocuments(1, data.processno);   // 오름차순이라 새 전표는 뒤쪽 페이지 → 그 전표가 있는 페이지로
      documentCacheRef.current.delete(data.processno);
      documentDataRef.current.delete(data.processno);
      await openDocument(data.processno, true);
    } catch (error) { notifications.show({ title: '가공 저장 실패', message: error.response?.data?.detail || '가공전표를 저장하지 못했습니다.', color: 'red' }); }
    finally { setSaving(false); }
  }, [header, sources, selectedProcessno, readOnly, loadDocuments, openDocument, planLink]);

  const exportDocument = useCallback(() => {
    if (!selectedProcessno || !sources.length || detailLoading) {
      notifications.show({ title: '내보낼 가공전표 없음', message: '저장된 가공전표를 선택해 주세요.', color: 'orange' });
      return;
    }

    const workbook = XLSX.utils.book_new();
    const document = documents.find((item) => item.processno === selectedProcessno);
    const docInfo = [
      selectedProcessno, header.processdate || String(document?.processdate || '').slice(0, 10),
      header.customname || document?.customname || '', header.warehousecodename || document?.warehousecodename || '',
      header.manager || document?.manager || '', header.description || document?.description || '',
      registeredAtText(document?.createdat), document?.created_by || '', registeredAtText(document?.updatedat), document?.updated_by || '',
    ];
    const rows = [[
      '가공전표', '가공일자', '가공처', '창고', '담당자', '전표 비고', '전표 등록일자', '전표 등록자', '전표 수정일자', '전표 수정자',
      'No.', '구분', '원소재품명', '원천전표', '원천행', '가공방법', '가공품명', '제품명',
      '두께', '폭', '길이', '수량', '단위', '중량(KG)', '로스(KG)', '단가/KG', '가공금액', '비고',
    ]];
    let rowNumber = 1;
    sources.forEach((source) => {
      rows.push([
        ...docInfo, rowNumber++, '원소재', source.stock.itemname || '', source.stock.sourceno || '',
        source.stock.sourceline ?? '', '', source.stock.productname || '', '',
        source.stock.thickness ?? '', source.stock.width ?? '', source.stock.length ?? '',
        num(source.qty), source.stock.qtyunit || '', num(source.weight), '', '', '', '',
      ]);
      source.products.forEach((product) => {
        const isChild = Boolean(product.parentId);
        rows.push([
          ...docInfo, isChild ? '' : rowNumber++, isChild ? '하위 가공품' : '가공품', source.stock.itemname || '',
          source.stock.sourceno || '', source.stock.sourceline ?? '', product.processcodename || '',
          product.productname || '', product.productno || '', product.thickness ?? '', product.width ?? '',
          product.length ?? '', num(product.qty), product.qtyunit || source.stock.qtyunit || '',
          num(product.weight), num(product.lossweight), num(product.unitprice), productAmount(product),
          product.description || '',
        ]);
      });
    });

    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    applyExcelHeaderStyle(worksheet, rows[0].length);
    worksheet['!cols'] = rows[0].map((label) => ({ wch: Math.min(28, Math.max(12, String(label).length + 4)) }));
    worksheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: rows[0].length - 1 } }) };
    XLSX.utils.book_append_sheet(workbook, worksheet, '재고가공상세');

    const safeFilePart = (value) => [...String(value || '').trim()]
      .map((character) => character.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(character) ? '_' : character)
      .join('').replace(/\s+/g, '_') || '가공전표';
    XLSX.writeFile(workbook, `재고가공전표_${safeFilePart(selectedProcessno)}.xlsx`);
  }, [selectedProcessno, sources, documents, detailLoading, header]);

  // The ribbon lives in the layout: re-registering it re-renders the whole layout, and the actions below change on
  // every keystroke (they read `sources`). Register stable wrappers that always call the latest action instead.
  const ribbonActionsRef = useRef(null);
  useLayoutEffect(() => {
    ribbonActionsRef.current = { loadDocuments, handleAdd, copySelectedDetail, exportDocument, save, requestToolbarDelete };
  });
  const ribbonHandlers = useMemo(() => ({
    onSearch: () => ribbonActionsRef.current.loadDocuments(1),
    onAdd: (...args) => ribbonActionsRef.current.handleAdd(...args),
    onCopy: (...args) => ribbonActionsRef.current.copySelectedDetail(...args),
    onExcel: (...args) => ribbonActionsRef.current.exportDocument(...args),
    onSave: (...args) => ribbonActionsRef.current.save(...args),
    onDelete: (...args) => ribbonActionsRef.current.requestToolbarDelete(...args),
  }), []);
  // 리본은 레이아웃에 등록되므로 다시 등록할 때마다 레이아웃 전체가 다시 그려진다 → 버튼 상태가 실제로 바뀔 때만 등록
  // (전표를 여는 짧은 로딩 동안의 비활성은 생략: 클릭 한 번에 레이아웃이 여러 번 그려지던 원인)
  const canDelete = Boolean(selectedProcessno) || (!selectedProcessno && selectedDetailIds.length > 0);
  const ribbonState = [structureLocked || saving || selectedDetailIds.length !== 1, !selectedProcessno || saving || !sources.length,
    !canDelete || saving, saving || readOnly, loading, saving].map(Number).join('');
  useEffect(() => {
    if (!pageLayout?.registerPageRibbon) return undefined;
    const [copy, excel, del, save, searchLoading, saveLoading] = [...ribbonState].map((flag) => flag === '1');
    pageLayout.registerPageRibbon(<ErpRibbon {...ribbonHandlers} onClose={pageLayout.closeActivePage}
      showPrint={false} useSaveColor={false} disabled={{ copy, excel, delete: del, save }} loading={{ search: searchLoading, save: saveLoading, delete: saveLoading }} />);
    return () => pageLayout.registerPageRibbon(null);
  }, [pageLayout, ribbonHandlers, ribbonState]);

  const customerData = useMemo(() => options.customers.map((x) => ({ value: x.code, label: x.name })), [options.customers]);
  const warehouseData = useMemo(() => options.warehouses.map((x) => ({ value: x.code, label: x.name })), [options.warehouses]);
  const existingKeys = new Set(sources.map((x) => sourceKey(x.stock)));
  const documentTableWidth = Math.max(1000, DOCUMENT_COLUMNS.reduce((sum, column) => sum + (documentColumnWidths[column.key] ?? column.width), 0));
  const detailTableWidth = Math.max(1320, DETAIL_COLUMNS.reduce((sum, column) => sum + (detailColumnWidths[column.key] ?? column.width), 0));
  const documentSubtotals = useMemo(() => documents.reduce((totals, row) => {
    for (const key of ['detail_count', 'qty', 'weight', 'supplyamt', 'vat', 'unitamt']) totals[key] += num(row[key]);
    return totals;
  }, { detail_count: 0, qty: 0, weight: 0, supplyamt: 0, vat: 0, unitamt: 0 }), [documents]);
  const syncDocumentScroll = useCallback((left) => {
    for (const element of [documentTableRef.current, documentSubtotalRef.current]) {
      if (element && Math.abs(element.scrollLeft - left) > 0.5) element.scrollLeft = left;
    }
  }, []);
  const hasSources = sources.length > 0;

  const documentListPanel = useMemo(() => (
    <Paper className={`${sharedClasses.panel} ${inboundClasses.topReceiptPanel}`} withBorder>
      <Group className={inboundClasses.topReceiptToolbar} justify="space-between" wrap="wrap">
        <Group gap={8}><Text className={inboundClasses.sectionTitle} fw={700}>가공 목록</Text><Badge color="gray" variant="light">{documentTotal.toLocaleString()}건</Badge></Group>
      </Group>
      <Box ref={documentTableRef} className={inboundClasses.topReceiptTable}>
        <Table className={inboundClasses.receiptFinderTable} stickyHeader highlightOnHover withTableBorder withColumnBorders
          style={{ width: `${documentTableWidth}px`, minWidth: `${documentTableWidth}px`, tableLayout: 'fixed' }}>
          <colgroup>{DOCUMENT_COLUMNS.map((column) => <col key={column.key} data-column-key={column.key} style={{ width: `${documentColumnWidths[column.key] ?? column.width}px` }} />)}</colgroup>
          <Table.Thead><Table.Tr>{DOCUMENT_COLUMNS.map((column) => <Table.Th key={column.key} className={classes.resizableHeader} style={{ width: `${documentColumnWidths[column.key] ?? column.width}px` }}>
            <span style={{ whiteSpace: 'nowrap' }}>{column.label}</span>
            <span className={classes.columnResizeHandle} data-column-key={column.key} onPointerDown={(event) => startTableColumnResize(event, DOCUMENT_COLUMNS, documentColumnWidths, setDocumentColumnWidths, 1000)} role="separator" aria-label={`${column.label} 열 너비 조절`} />
          </Table.Th>)}</Table.Tr></Table.Thead>
          <Table.Tbody>{documents.map((row) => (
            <Table.Tr key={row.processno}
              className={`${outboundClasses.receiptFinderRow} ${row.processno === selectedProcessno ? outboundClasses.receiptFinderRowActive : ''}`}
              onMouseEnter={() => prefetchDocument(row.processno)} onClick={() => openDocument(row.processno)}>
              <Table.Td>{String(row.processdate || '').slice(0, 10)}</Table.Td>
              <Table.Td>{row.customname || ''}</Table.Td>
              <Table.Td>{row.warehousecodename || ''}</Table.Td>
              <Table.Td>{row.manager || ''}</Table.Td>
              <Table.Td ta="right">{numberText(row.qty)}</Table.Td>
              <Table.Td ta="right">{numberText(row.weight)}</Table.Td>
              <Table.Td ta="right">{numberText(row.supplyamt)}</Table.Td>
              <Table.Td ta="right">{numberText(row.vat)}</Table.Td>
              <Table.Td ta="right" className={outboundClasses.receiptFinderAmount}>{numberText(row.unitamt)}</Table.Td>
              <Table.Td>{row.processno}</Table.Td>
              <Table.Td>{registeredAtText(row.createdat)}</Table.Td>
              <Table.Td>{row.created_by || ''}</Table.Td>
              <Table.Td>{row.description || ''}</Table.Td>
            </Table.Tr>
          ))}</Table.Tbody>
        </Table>
        {!documents.length && <Box className={inboundClasses.topReceiptEmptyMessage}>{loading ? '조회 중입니다.' : '검색된 가공전표가 없습니다.'}</Box>}
      </Box>
      <Box className={inboundClasses.topReceiptBottom}>
        {!!documents.length && <Box ref={documentSubtotalRef} className={inboundClasses.topReceiptSubtotalViewport}>
          <Table className={`${inboundClasses.receiptFinderTable} ${inboundClasses.receiptSubtotalTable}`} withTableBorder withColumnBorders
            style={{ width: `${documentTableWidth}px`, minWidth: `${documentTableWidth}px`, tableLayout: 'fixed' }}>
            <colgroup>{DOCUMENT_COLUMNS.map((column) => <col key={column.key} style={{ width: `${documentColumnWidths[column.key] ?? column.width}px` }} />)}</colgroup>
            <Table.Tbody><Table.Tr>{DOCUMENT_COLUMNS.map((column, index) => {
              const numeric = ['detail_count', 'qty', 'weight', 'supplyamt', 'vat', 'unitamt'].includes(column.key);
              return <Table.Td key={column.key} className={`${inboundClasses.topReceiptSubtotalCell} ${numeric ? inboundClasses.topReceiptSubtotalNumber : ''}`}>
                {index === 0 ? '소계' : ['detail_count', 'qty', 'weight'].includes(column.key) ? numberText(documentSubtotals[column.key])
                  : ['supplyamt', 'vat', 'unitamt'].includes(column.key) ? `${numberText(documentSubtotals[column.key])}원` : ''}
              </Table.Td>;
            })}</Table.Tr></Table.Tbody>
          </Table>
        </Box>}
        <Box className={inboundClasses.topReceiptHorizontalScroll} onScroll={(event) => syncDocumentScroll(event.currentTarget.scrollLeft)} aria-label="가공 목록 가로 스크롤">
          <Box className={inboundClasses.topReceiptHorizontalContent} style={{ width: `${documentTableWidth}px` }} />
        </Box>
      </Box>
      <Group className={inboundClasses.topReceiptPagination} justify="space-between">
        <Group className={inboundClasses.topReceiptPageSize} gap="xs">
          <Select aria-label="페이지당 표시 건수" data={PAGE_SIZE_OPTIONS} value={String(documentPageSize)} w={100} size="xs"
            onChange={(value) => { if (value) setDocumentPageSize(Number(value)); }} />
        </Group>
        <Pagination size="sm" total={Math.max(1, Math.ceil(documentTotal / documentPageSize))} value={documentPage}
          onChange={(value) => void loadDocuments(value)} withEdges color="red" disabled={loading || !documentTotal} />
      </Group>
    </Paper>
  ), [documents, documentTotal, documentPage, documentPageSize, documentTableWidth, documentColumnWidths, selectedProcessno, prefetchDocument, openDocument, loadDocuments, loading, documentSubtotals, syncDocumentScroll]);
  const headerFields = useMemo(() => (
    <Box className={classes.headerGrid}>
            <ErpDateInput label="가공일자" disabled={readOnly} value={header.processdate} onChange={(e) => { const { value: nextValue } = e.currentTarget; setHeader((h) => ({ ...h, processdate: nextValue })); }} />
            <LazySelect ref={customerRef} label="가공처" searchable autoSelectOnBlur disabled={readOnly} data={customerData}
              dropdownOpened={customerDropdownOpen} onDropdownOpen={() => { if (!suppressCustomerDropdownRef.current) setCustomerDropdownOpen(true); }} onDropdownClose={() => setCustomerDropdownOpen(false)} value={header.customcode || null} onChange={(value) => { const item = options.customers.find((x) => x.code === value); setHeader((h) => ({ ...h, customcode: value || '', customname: item?.name || '' })); }} />
            <LazySelect label="입고창고" searchable autoSelectOnBlur disabled={readOnly || hasSources} data={warehouseData} value={header.warehousecode || null} onChange={(value) => { const item = options.warehouses.find((x) => x.code === value); setHeader((h) => ({ ...h, warehousecode: value || '', warehousecodename: item?.name || '' })); }} />
            <TextInput label="담당자" disabled={readOnly} value={header.manager} onChange={(e) => { const { value: nextValue } = e.currentTarget; setHeader((h) => ({ ...h, manager: nextValue })); }} />
            <TextInput label="비고" disabled={readOnly} value={header.description} onChange={(e) => { const { value: nextValue } = e.currentTarget; setHeader((h) => ({ ...h, description: nextValue })); }} />
          </Box>
  ), [header, readOnly, customerData, warehouseData, options.customers, options.warehouses, hasSources, customerDropdownOpen]);
  const filterPanel = useMemo(() => (
    <Paper component="aside" withBorder className={classes.filter}>
        <Group className={classes.filterHeader} justify="space-between" align="center">
          <Text fw={700}>조회조건</Text>
          <ActionIcon variant="subtle" color="gray" aria-label="조회조건 닫기" onClick={() => setFilterOpen(false)}><IconX size={16} /></ActionIcon>
        </Group>
        <Stack gap="sm" className={classes.filterFields}>
          <Box>
            <Text size="xs" fw={700} mb={5}>가공기간</Text>
            <Stack gap={6}>
              <ErpDateInput aria-label="가공기간 시작일" value={filters.date_from} onChange={(e) => { const { value: nextValue } = e.currentTarget; setFilters((f) => ({ ...f, date_from: nextValue })); }} />
              <ErpDateInput aria-label="가공기간 종료일" value={filters.date_to} onChange={(e) => { const { value: nextValue } = e.currentTarget; setFilters((f) => ({ ...f, date_to: nextValue })); }} />
            </Stack>
          </Box>
          <TextInput label="가공처" placeholder="가공처명 입력" value={filters.customer} onChange={(e) => { const { value: nextValue } = e.currentTarget; setFilters((f) => ({ ...f, customer: nextValue })); }} onKeyDown={(e) => e.key === 'Enter' && loadDocuments()} />
          <TextInput label="가공창고" placeholder="가공창고명 입력" value={filters.warehouse} onChange={(e) => { const { value: nextValue } = e.currentTarget; setFilters((f) => ({ ...f, warehouse: nextValue })); }} onKeyDown={(e) => e.key === 'Enter' && loadDocuments()} />
          <TextInput label="가공전표번호" placeholder="가공전표번호 입력" value={filters.processno} onChange={(e) => { const { value: nextValue } = e.currentTarget; setFilters((f) => ({ ...f, processno: nextValue })); }} onKeyDown={(e) => e.key === 'Enter' && loadDocuments()} />
          <TextInput label="품목정보" placeholder="품목코드 또는 품명 입력" value={filters.iteminfo} onChange={(e) => { const { value: nextValue } = e.currentTarget; setFilters((f) => ({ ...f, iteminfo: nextValue })); }} onKeyDown={(e) => e.key === 'Enter' && loadDocuments()} />
          <TextInput label="제품정보" placeholder="제품명 또는 제품번호 입력" value={filters.productinfo} onChange={(e) => { const { value: nextValue } = e.currentTarget; setFilters((f) => ({ ...f, productinfo: nextValue })); }} onKeyDown={(e) => e.key === 'Enter' && loadDocuments()} />
        </Stack>
        <Box className={outboundClasses.outboundStockLookup}>
          <Text fw={700} size="sm">재고 조회</Text>
          <Text size="xs" c="dimmed">가공일자·가공처를 입력한 뒤 가공할 원소재를 선택합니다.</Text>
          <Button fullWidth color="red" leftSection={<IconSearch size={15} />} onClick={openStockLookup}>
            현재고 조회
          </Button>
          <Text fw={700} size="sm" mt={12}>가공계획 불러오기</Text>
          <Text size="xs" c="dimmed">가공 최적화에서 확정한 계획을 가공전표로 불러옵니다.</Text>
          <Button fullWidth color="red" leftSection={<IconListCheck size={15} />} onClick={() => { setPlanPickerQuery(''); setPlanPickerOpen(true); }}>
            가공계획 불러오기
          </Button>
        </Box>
      </Paper>
  ), [filters, loadDocuments, openStockLookup]);

  return <Box className={`${simpleTheme.simple} ${sharedClasses.pageShell} ${classes.page}`}>
    <ErpBreadcrumb parent="가공관리" current="재고가공등록" filterOpen={filterOpen} onOpenFilters={() => setFilterOpen(true)} />
    <Box className={classes.workspace}>
      <Stack gap="sm" className={classes.main}>
        {documentListPanel}

        <Paper withBorder className={`${sharedClasses.panel} ${classes.detailPanel}`}>
          <Group className={classes.sectionHeader} justify="space-between"><Group gap={8}><Text className={inboundClasses.sectionTitle} fw={700}>가공 상세</Text><Badge color="gray" variant="light" className={classes.count}>{selectedProcessno || '신규'} · {sources.length}개 원소재</Badge>{planLink && <Badge color="red" variant="light" className={classes.count} title="가공 최적화 확정 계획에서 불러온 전표입니다. 저장하면 계획이 가공완료됩니다.">가공계획 {planLink.planno}</Badge>}</Group><Group gap="sm"><Text size="xs" c={Math.abs(totalSourceWeight - totalLeafWeight) <= 0.001 ? 'teal' : 'red'}>투입 {numberText(totalSourceWeight)} KG · 최종제품 {numberText(totalLeafWeight)} KG</Text></Group></Group>
          {headerFields}
          <Box className={classes.detailViewport}>
            <table className={classes.detailTable} style={{ width: `${detailTableWidth}px`, minWidth: `${detailTableWidth}px` }}><colgroup>{DETAIL_COLUMNS.map((column) => <col key={column.key} data-column-key={column.key} style={{ width: `${detailColumnWidths[column.key] ?? column.width}px` }} />)}</colgroup><thead><tr>{DETAIL_COLUMNS.map((column) => <th key={column.key} className={classes.resizableHeader} style={{ width: `${detailColumnWidths[column.key] ?? column.width}px` }}>{column.key === 'select' ? detailRowIds.length > 0 && <input type="checkbox" aria-label="상세 전체 선택" checked={allDetailsSelected} disabled={structureLocked} onChange={(event) => { setSelectedDetailIds(event.currentTarget.checked ? detailRowIds : []); selectionAnchorRef.current = ''; }} /> : <>{column.label}{column.required && <span style={{ color: '#e03131' }}> *</span>}</>}<span className={classes.columnResizeHandle} data-column-key={column.key} onPointerDown={(event) => startTableColumnResize(event, DETAIL_COLUMNS, detailColumnWidths, setDetailColumnWidths, 1320)} role="separator" aria-label={`${column.label || '선택'} 열 너비 조절`} /></th>)}</tr></thead>
              <tbody>{sources.flatMap((source, sourceIndex) => {
                const sourceRow = <tr className={classes.sourceRow} key={source.id}><td className={classes.checkCell}><input type="checkbox" aria-label={`원소재 ${sourceIndex + 1} 선택`} checked={selectedDetailIds.includes(source.id)} disabled={structureLocked} onChange={(event) => toggleDetailSelection(source.id, event.nativeEvent.shiftKey)} /></td><td className={classes.noCell}><div className={classes.noCellContent}><span className={classes.sourceNoLabel}><span>{sourceIndex + 1}</span><Badge size="xs" variant="light">원소재</Badge></span><ActionIcon size="xs" variant="subtle" color="red" disabled={structureLocked} title="가공품 추가" onClick={() => addProduct(source.id)}><IconPlus size={13} /></ActionIcon></div></td><td>재고 연결</td><td></td><td>{source.stock.itemname}</td><td>{source.stock.productname || ''}</td><td>{numberText(source.stock.thickness)}</td><td>{numberText(source.stock.width)}</td><td>{numberText(source.stock.length)}</td><td>{source.inputEditable && !structureLocked
                  ? <input className={classes.sourceInput} data-detail-field="sourceqty" onKeyDown={handleDetailGridKeyDown} inputMode="decimal" aria-label="투입 수량" placeholder={`현재고 ${numberText(source.stock.qty)}`} title={`현재고 수량 ${numberText(source.stock.qty)} 이내`}
                      value={source.qty} onFocus={(e) => e.currentTarget.select()} onChange={(e) => updateSourceQty(source.id, e.currentTarget.value)} />
                  : numberText(source.qty)}</td><td>{source.stock.qtyunit}</td><td>{source.inputEditable && !structureLocked && !num(source.weight) ? '' : numberText(source.weight)}</td><td></td><td className={classes.readOnlyAmount}>—</td><td className={classes.readOnlyAmount} title="이전 단계에서 넘어오는 가공비: 원소재 가공금액 × 투입중량 ÷ 남은 중량. 이번 가공비는 가공품 행의 가공금액">{carriedProcessFee(source) != null ? numberText(carriedProcessFee(source)) : '—'}</td><td>{source.stock.sourceno || ''}</td><td>{source.stock.sourceline ?? ''}</td></tr>;
                const productRows = orderProducts(source.products).map(({ product, lineNo, isLast, ancestorContinues }) => {
                  const processOptions = options.processes || [];
                  const dimensionRule = options.rules.find((rule) => rule.itemcode === source.stock.itemcode && rule.processid === product.processid);
                  const canEditDimension = (field) => String(dimensionRule?.[`${field}yn`] || '').trim().toUpperCase() === 'Y';
                  const depth = lineNo.length;
                return <tr key={product.id}><td className={classes.checkCell}><input type="checkbox" aria-label={`가공품 ${lineNo.join('.')} 선택`} checked={selectedDetailIds.includes(product.id)} disabled={structureLocked} onChange={(event) => toggleDetailSelection(product.id, event.nativeEvent.shiftKey)} /></td><td className={classes.noCell}><div className={classes.noCellContent}><span className={classes.treeNumber}>{ancestorContinues.map((continues, index) => <span key={`parent-${index}`} className={`${classes.treeGuide} ${continues ? classes.treeGuideContinue : ''}`} />)}<span className={`${classes.treeGuide} ${isLast ? classes.treeGuideLast : classes.treeGuideMiddle}`} /><span>{String(lineNo[depth - 1]).padStart(2, '0')}</span></span><ActionIcon size="xs" variant="subtle" color="red" disabled={structureLocked} title="하위 가공 추가" onClick={() => addProduct(source.id, product.id)}><IconPlus size={13} /></ActionIcon></div></td><td title={product.description || undefined}>{product.description || "가공품"}</td><td><ProcessMethodCell product={product} options={processOptions} disabled={readOnly} onSelect={(option) => chooseRule(source, product, option?.processid || null)} /></td><td><input data-detail-field="productname" onKeyDown={handleDetailGridKeyDown} disabled={readOnly} value={product.productname} onChange={(e) => updateProduct(source.id, product.id, 'productname', e.target.value)} /></td><td><input data-detail-field="productno" onKeyDown={handleDetailGridKeyDown} disabled={readOnly} maxLength={150} value={product.productno} onChange={(e) => updateProduct(source.id, product.id, 'productno', e.target.value)} /></td>{['thickness', 'width', 'length'].map((field) => <td key={field}><DetailNumericInput field={field} value={product[field]} disabled={readOnly || !canEditDimension(field)} onCommit={(value) => updateProduct(source.id, product.id, field, value)} /></td>)}<td><DetailNumericInput field="qty" value={product.qty} disabled={readOnly} onCommit={(value) => updateProduct(source.id, product.id, 'qty', value)} /></td><td><input data-detail-field="qtyunit" disabled value={source.stock.qtyunit || product.qtyunit || 'EA'} /></td><td><DetailNumericInput field="weight" value={product.weight} disabled={readOnly} onCommit={(value) => updateProductWeight(source.id, product.id, value)} /></td><td className={classes.readOnlyAmount} title={planLink ? '가공계획에서 배부한 로스 (중량을 고치면 [로스 배부]로 다시 나눕니다)' : '수기가공은 로스를 쓰지 않습니다'}>{planLink || num(product.lossweight) ? numberText(product.lossweight) : '—'}</td><td><DetailNumericInput field="unitprice" value={product.unitprice} disabled={readOnly} onCommit={(value) => updateProduct(source.id, product.id, 'unitprice', value)} /></td><td className={readOnly ? classes.readOnlyAmount : classes.computedAmount} title={product.amountManual ? '직접 입력한 가공금액 (지우면 단가 × 중량으로 다시 계산)' : '단가 × 중량 자동 계산 (직접 입력 가능)'}>{readOnly
                  ? numberText(productAmount(product))
                  : <DetailNumericInput field="supplyamt" value={String(productAmount(product))} disabled={readOnly}
                      onCommit={(value) => setProductAmount(source.id, product.id, value)} />}</td><td></td><td></td></tr>;
                });
                return [sourceRow, ...productRows];
              })}</tbody>
            </table>
            {detailLoading ? <Box className={classes.detailLoading}><Loader size="sm" color="red" /></Box> : !sources.length && <Box className={classes.detailEmpty}>{readOnly ? '상세 원소재가 없습니다.' : '가공일자·가공처를 입력한 뒤 [현재고 조회]로 가공할 원소재를 선택해 주세요.'}</Box>}
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
              {planLink && <>
                <Box><Text className={classes.balanceCaption}>로스 (배부)</Text><Text className={classes.balanceAmount}>{numberText(totalLossWeight)} kg</Text></Box>
                <Text className={classes.balanceOperator}>−</Text>
              </>}
              <Box><Text className={classes.balanceCaption}>미정산 중량</Text><Text className={classes.balanceAmount}>{numberText(Math.abs(weightDifference))} kg</Text></Box>
            </Group>
            <Group gap="md" wrap="nowrap" className={classes.balanceResult}>
              <Box ta="right"><Text className={classes.balanceStatus} c={isWeightBalanced ? 'teal' : sources.length ? 'red' : 'dimmed'}>{weightStatusText}</Text><Text className={classes.balanceSub}>미정산 {numberText(Math.abs(weightDifference))} kg</Text></Box>
              {planLink && <Button size="sm" variant="default" disabled={readOnly} onClick={distributeLoss} title="투입 − 1차 가공품 중량을 로스로 보고 가공품 중량 비율로 나눕니다">로스 배부</Button>}
              <Button size="sm" variant="light" color="red" disabled={readOnly} onClick={autoMatchWeight}>↔ 중량 자동맞춤</Button>
            </Group>
          </Group>
        </Paper>
      </Stack>
      {filterOpen && filterPanel}
    </Box>
    <ConfirmDeleteModal opened={deleteDocumentsOpen} onClose={() => setDeleteDocumentsOpen(false)} onConfirm={confirmDeleteDocuments} loading={saving}
      title="가공전표를 삭제할까요?" target={deleteDocumentNos[0]} message="전표와 상세 내역이 모두 삭제되며" note="삭제한 전표는 복구할 수 없습니다." />
    {planPickerOpen && <PlanRunPicker opened initialQuery={planPickerQuery} onClose={closePlanPicker} onPick={loadPlan} />}
    {stockOpen && <StockPicker opened={stockOpen} onClose={() => setStockOpen(false)} onApply={addStocks} existingKeys={existingKeys} existingWarehouseCode={sources[0]?.stock?.warehousecode || ''} baseDate={String(header.processdate || '').slice(0, 10)} />}
  </Box>;
}
