import { memo, useCallback, useContext, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import XLSX from 'xlsx-js-style';
import { applyExcelHeaderStyle } from '../utils/excelHeaderStyle';
import { INSTRUMENT_OPTIONS_BY_FIELD, INSTRUMENT_TYPE_OPTIONS, instrumentLabel } from '../utils/instrumentCodes';
import {
  ActionIcon, Autocomplete, Badge, Box, Button, Group, Input, Loader, Modal, NumberInput,
  Pagination, Paper, ScrollArea, Select, Stack, Table, Text, TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconChevronDown, IconCopy, IconDeviceFloppy, IconFileSpreadsheet, IconFilter, IconPlus, IconSearch, IconTrash, IconX,
} from '@tabler/icons-react';
import ErpDateInput from '../components/common/ErpDateInput';
import { PageRibbonContext } from '../components/layout/MainLayout';
import sharedClasses from '../styles/pages/ManagementShared.module.css';
import codeClasses from '../styles/pages/CodeMasterPage.module.css';
import inboundClasses from '../styles/pages/InboundRegister.module.css';
import outboundClasses from '../styles/pages/OutboundRegister.module.css';
import classes from '../styles/pages/ReceiptPayment.module.css';

const PAGE_SIZE_OPTIONS = [
  { value: '15', label: '15개씩' }, { value: '50', label: '50개씩' },
  { value: '100', label: '100개씩' }, { value: '200', label: '200개씩' },
];
const TRANSACTION_OPTIONS = [
  { value: 'RECEIPT', label: '수금' }, { value: 'PAYMENT', label: '지급' },
];
const TRANSACTION_FILTER_OPTIONS = [{ value: '', label: '전체' }, ...TRANSACTION_OPTIONS];
const AMOUNT_FIELDS = [
  { key: 'cashamt', label: '현금', width: 90 },
  { key: 'instrumentamt', label: '수표·어음', width: 100 },
  { key: 'bankamt', label: '은행예금', width: 95 },
  { key: 'cardamt', label: '카드', width: 85 },
  { key: 'offsetamt', label: '상계', width: 85 },
  { key: 'lossamt', label: '잡손실', width: 85 },
  { key: 'chargeamt', label: '과금', width: 85 },
];
const INSTRUMENT_PREFIX_FIELDS = [
  { key: 'instrumenttype', label: '수표/어음 종류', width: 100, options: INSTRUMENT_OPTIONS_BY_FIELD.instrumenttype },
  { key: 'instrumentno', label: '수표/어음 번호', width: 140, maxLength: 100 },
];
const INSTRUMENT_INFO_FIELDS = [
  { key: 'issuedate', label: '발행일', width: 100, type: 'date' },
  { key: 'issuercompany', label: '발행회사', width: 130, maxLength: 150 },
  { key: 'issuer', label: '발행자', width: 90, maxLength: 100 },
  { key: 'issuekind', label: '발행구분', width: 90, options: INSTRUMENT_OPTIONS_BY_FIELD.issuekind },
  { key: 'maturitydate', label: '만기일', width: 100, type: 'date' },
  { key: 'custodyaccount', label: '보관계좌', width: 120, maxLength: 100 },
  { key: 'custodybank', label: '보관은행', width: 110, maxLength: 100 },
  { key: 'instrumentstatus', label: '어음처리상태', width: 120, options: INSTRUMENT_OPTIONS_BY_FIELD.instrumentstatus },
];
// 수표/어음 상세 칸 뒤의 금액 칸: 현금 · 은행예금 · 카드 · 상계 · 잡손실 · 과금
const REMAINING_AMOUNT_FIELDS = AMOUNT_FIELDS.filter((field) => field.key !== 'instrumentamt');
const DESCRIPTION_FIELD = { key: 'description', label: '비고', width: 180, maxLength: 500 };
const DETAIL_NAVIGATION_FIELDS = [
  ...INSTRUMENT_PREFIX_FIELDS.map((field) => field.key),
  AMOUNT_FIELDS[1].key,
  ...INSTRUMENT_INFO_FIELDS.map((field) => field.key),
  ...REMAINING_AMOUNT_FIELDS.map((field) => field.key),
  'description',
];
const SUMMARY_COLUMNS = [
  ['receiptdate', '수금/지급일', 95], ['transactiontype', '구분', 60], ['customname', '거래처', 125],
  ['line_count', '상세건수', 65], ['instrumentamt', '수표·어음', 95], ['cashamt', '현금', 85],
  ['bankamt', '은행예금', 85], ['cardamt', '카드', 75], ['totalamt', '합계', 90],
  ['offsetamt', '상계', 80], ['lossamt', '잡손실', 80], ['chargeamt', '과금', 80], ['receiptno', '전표번호', 135],
].map(([key, label, width]) => ({ key, label, width }));
const DETAIL_COLUMN_WIDTHS = [36, 46, ...INSTRUMENT_PREFIX_FIELDS.map((field) => field.width), AMOUNT_FIELDS[1].width,
  ...INSTRUMENT_INFO_FIELDS.map((field) => field.width), ...REMAINING_AMOUNT_FIELDS.map((field) => field.width), 80, DESCRIPTION_FIELD.width];
const DETAIL_HEADER_LABELS = ['', 'No.', ...INSTRUMENT_PREFIX_FIELDS.map((field) => field.label), AMOUNT_FIELDS[1].label,
  ...INSTRUMENT_INFO_FIELDS.map((field) => field.label), ...REMAINING_AMOUNT_FIELDS.map((field) => field.label), '합계', DESCRIPTION_FIELD.label];
const AMOUNT_KEYS = AMOUNT_FIELDS.map(({ key }) => key);
const todayString = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const makeFilters = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return {
    date_from: `${y}-${m}-01`,
    date_to: `${y}-${m}-${String(new Date(y, d.getMonth() + 1, 0).getDate()).padStart(2, '0')}`,
    transactiontype: '', customer: '', receiptno: '',
  };
};
const emptyHeader = () => ({
  receiptno: '', receiptdate: todayString(), transactiontype: 'RECEIPT',
  customcode: '', customname: '', manager: '', description: '',
});
const makeDetail = (data = {}) => ({
  id: data.id || `detail-${Date.now()}-${Math.random()}`,
  cashamt: data.cashamt ?? '', instrumentamt: data.instrumentamt ?? '',
  instrumenttype: data.instrumenttype ?? '', instrumentno: data.instrumentno ?? '',
  issuedate: data.issuedate ? String(data.issuedate).slice(0, 10) : '',
  issuercompany: data.issuercompany ?? '', issuer: data.issuer ?? '', issuekind: data.issuekind ?? '',
  maturitydate: data.maturitydate ? String(data.maturitydate).slice(0, 10) : '',
  custodyaccount: data.custodyaccount ?? '', custodybank: data.custodybank ?? '',
  instrumentstatus: data.instrumentstatus ?? '',
  bankamt: data.bankamt ?? '', cardamt: data.cardamt ?? '',
  offsetamt: data.offsetamt ?? '', lossamt: data.lossamt ?? '',
  chargeamt: data.chargeamt ?? '', description: data.description ?? '',
  created_by: data.created_by ?? '', updated_by: data.updated_by ?? '',
  // 보유증권 불러오기: 지급 행이 사용한 수금 증권 / 수금 증권이 사용된 지급전표
  source_receiptno: data.source_receiptno ?? '', source_lineno: data.source_lineno ?? null,
  used_receiptno: data.used_receiptno ?? '',
});
const sourceKey = (receiptno, lineno) => `${receiptno}:${lineno}`;
const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });
const numeric = (value) => {
  const parsed = Number(String(value ?? 0).replaceAll(',', ''));
  return Number.isFinite(parsed) ? parsed : 0;
};
const formatted = (value) => numeric(value).toLocaleString(undefined, { maximumFractionDigits: 3 });
const dateOnly = (value) => value ? String(value).slice(0, 10) : '';
const totalOf = (row) => ['cashamt', 'instrumentamt', 'bankamt', 'cardamt'].reduce((sum, key) => sum + numeric(row[key]), 0);
const typeName = (value) => value === 'PAYMENT' ? '지급' : '수금';
const errorText = (error) => {
  const detail = error.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) return detail.map((item) => item?.msg || String(item)).join(' · ');
  return error.message || '요청을 처리하지 못했습니다.';
};

const ResizableHeaderCell = memo(function ResizableHeaderCell({ index, width, onResize, children, ...props }) {
  return <Table.Th {...props} className={classes.resizableHeader}>
    {children}
    <span className={classes.columnResizeHandle} onPointerDown={(event) => onResize(event, index, width)} role="separator" aria-orientation="vertical" aria-label={`${index + 1}열 너비 조절`} />
  </Table.Th>;
});

const ReceiptPaymentSummaryRow = memo(function ReceiptPaymentSummaryRow({ doc, selected, onSelect }) {
  return <Table.Tr className={selected ? classes.selectedRow : ''} onClick={() => onSelect(doc.receiptno)}>
    {SUMMARY_COLUMNS.map((column) => {
      const value = doc[column.key];
      const money = ['cashamt', 'instrumentamt', 'bankamt', 'cardamt', 'totalamt', 'offsetamt', 'lossamt', 'chargeamt'].includes(column.key);
      return <Table.Td key={column.key} ta={money || column.key === 'line_count' ? 'right' : undefined} title={String(value ?? '')}>
        {column.key === 'receiptdate' ? dateOnly(value) : column.key === 'transactiontype' ? typeName(value)
          : money ? formatted(value) : column.key === 'line_count' ? Number(value || 0).toLocaleString() : value || ''}
      </Table.Td>;
    })}
  </Table.Tr>;
});

// 헤더 거래처(수백 건): Mantine은 닫힌 목록도 옵션을 모두 그리므로, props가 같으면 다시 그리지 않도록 memo로 분리.
const HeaderCustomerSelect = memo(function HeaderCustomerSelect({ options, value, disabled, onChange }) {
  return <Select searchable autoSelectOnBlur aria-label="거래처" placeholder="" disabled={disabled} data={options} value={value} onChange={onChange} />;
});

// 수표/어음 종류·발행구분·어음처리상태: 평소엔 가벼운 표시용 입력칸만 그리고, 포커스/클릭할 때만 검색형 Select로 바꾼다.
// (행마다 Select 3개가 닫힌 상태에서도 옵션 목록·위치계산을 해서 행 추가가 느렸음)
const LazyOptionSelect = memo(function LazyOptionSelect({ ariaLabel, options, value, disabled, onChange }) {
  const [active, setActive] = useState(null); // null | 'focus' | 'click' (click opens the list right away)
  const clickedRef = useRef(false);
  const selectRef = useRef(null);
  const data = useMemo(() => (value && !options.some((option) => option.value === value)
    ? [{ value, label: value }, ...options] // an older free-text value stays visible until changed
    : options), [options, value]);
  const label = data.find((option) => option.value === value)?.label ?? '';
  useLayoutEffect(() => { if (active) selectRef.current?.focus(); }, [active]);
  if (!active || disabled) {
    return <div className={classes.lazySelect}>
      <input aria-label={ariaLabel} className={classes.lazySelectInput} value={label} readOnly disabled={disabled}
        onMouseDown={() => { clickedRef.current = !disabled; }}
        onFocus={() => { if (!disabled) setActive(clickedRef.current ? 'click' : 'focus'); clickedRef.current = false; }} />
      <IconChevronDown size={14} className={classes.lazySelectChevron} aria-hidden />
    </div>;
  }
  return <Select ref={selectRef} aria-label={ariaLabel} size="xs" searchable clearable autoSelectOnBlur selectFirstOptionOnChange
    data={data} value={value || null} placeholder="" nothingFoundMessage="목록에 없습니다" comboboxProps={{ withinPortal: true }}
    defaultDropdownOpened={active === 'click'}
    onChange={(nextValue) => onChange(nextValue || '')}
    onBlur={() => setActive(null)} />;
});

const ReceiptPaymentDetailInputCell = memo(function ReceiptPaymentDetailInputCell({ rowId, rowNumber, field, value, numericInput = false, suggestions, disabled, onUpdate, onOpenPicker }) {
  const [draft, setDraft] = useState(value ?? '');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const pickerOpenRef = useRef(false);
  const [synced, setSynced] = useState({ type: field.type, numericInput, value });
  if (synced.type !== field.type || synced.numericInput !== numericInput || synced.value !== value) {
    setSynced({ type: field.type, numericInput, value });
    if (!numericInput && field.type !== 'date') { setDraft(value ?? ''); setShowSuggestions(false); }
  }
  const openPicker = () => {
    if (disabled || !onOpenPicker) return;
    pickerOpenRef.current = true;
    setShowSuggestions(false);
    onOpenPicker(rowId, field.key);
  };
  return <Table.Td data-detail-row={rowId} data-detail-field={field.key}>
    {numericInput
      ? <NumberInput aria-label={`${rowNumber}행 ${field.label}`} value={value} min={0} allowNegative={false} decimalScale={3} thousandSeparator="," hideControls withKeyboardEvents={false} size="xs" disabled={disabled} placeholder="" onChange={(nextValue) => onUpdate(rowId, field.key, nextValue)} />
      : field.type === 'date'
        ? <ErpDateInput aria-label={`${rowNumber}행 ${field.label}`} size="xs" value={value} disabled={disabled} placeholder="" autoComplete="off" onChange={(event) => onUpdate(rowId, field.key, event.currentTarget.value)} />
        : field.options
          // 검색형 선택: 입력하면 목록이 좁혀지고 Enter/Tab(자동확정)으로 선택. 목록에 없는 값은 들어가지 않음.
          ? <LazyOptionSelect ariaLabel={`${rowNumber}행 ${field.label}`} options={field.options} value={value} disabled={disabled}
            onChange={(nextValue) => onUpdate(rowId, field.key, nextValue)} />
        : suggestions
          ? <Box className={inboundClasses.itemNameSearchTarget} onClick={(event) => {
            const input = event.currentTarget.querySelector('input');
            if (input && event.clientX >= input.getBoundingClientRect().right - 28) openPicker();
          }} onDoubleClick={openPicker}>
            <Autocomplete aria-label={`${rowNumber}행 ${field.label}`} value={draft} placeholder="" autoComplete="off" data={showSuggestions && draft.trim() ? suggestions : []} limit={8} maxLength={field.maxLength} size="xs" disabled={disabled}
            classNames={{ input: `${codeClasses.cellInput} ${inboundClasses.itemCodePickerInput} ${inboundClasses.itemNameSearchInput}` }}
            filter={({ options, search }) => {
              const query = String(search || '').trim().toLocaleLowerCase();
              if (!showSuggestions || !query || !Array.isArray(options)) return [];
              return options.filter((option) => `${option.label || option.value || ''} ${option.code || ''}`
                .toLocaleLowerCase().includes(query));
            }}
            onChange={(nextValue) => { pickerOpenRef.current = false; setDraft(nextValue); setShowSuggestions(Boolean(nextValue.trim())); }}
            onOptionSubmit={(nextValue) => { pickerOpenRef.current = false; setDraft(nextValue); setShowSuggestions(false); onUpdate(rowId, field.key, nextValue); }}
            onKeyDown={(event) => {
              // Tab fills the option highlighted with ↑/↓ (same as Enter), then moves on as usual.
              if (event.key !== 'Tab' || event.shiftKey) return;
              const listId = event.currentTarget.getAttribute('aria-controls');
              const highlighted = listId ? document.getElementById(listId)?.querySelector('[role="option"][data-combobox-selected]') : null;
              highlighted?.click();
            }}
            onBlur={() => { setShowSuggestions(false); if (!pickerOpenRef.current && draft !== (value ?? '')) onUpdate(rowId, field.key, draft); pickerOpenRef.current = false; }} /></Box>
        : <TextInput aria-label={`${rowNumber}행 ${field.label}`} value={draft} placeholder="" autoComplete="off" maxLength={field.maxLength} size="xs" disabled={disabled}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onBlur={() => { if (draft !== (value ?? '')) onUpdate(rowId, field.key, draft); }} />}
  </Table.Td>;
});

const ReceiptPaymentHeaderTextInput = memo(function ReceiptPaymentHeaderTextInput({ label, value, maxLength, disabled, onCommit }) {
  const [draft, setDraft] = useState(value ?? '');
  const [syncedValue, setSyncedValue] = useState(value);
  if (syncedValue !== value) {
    setSyncedValue(value);
    setDraft(value ?? '');
  }
  return <TextInput aria-label={label} value={draft} maxLength={maxLength} disabled={disabled}
    onChange={(event) => setDraft(event.currentTarget.value)}
    onBlur={() => { if (draft !== (value ?? '')) onCommit(draft); }} />;
});

const ReceiptPaymentDetailRow = memo(function ReceiptPaymentDetailRow({ row, index, selected, disabled: rowDisabled, issuerCompanyOptions, bankOptions, onToggle, onUpdate, onOpenPicker }) {
  const rowNumber = index + 1;
  const fromHeld = Boolean(row.source_receiptno);
  const disabled = rowDisabled || fromHeld; // 불러온 증권 행은 내용 수정 불가 (행 삭제·비고만 가능)
  const sourceTitle = fromHeld ? `보유증권 ${row.source_receiptno}-${row.source_lineno} 사용` : row.used_receiptno ? `지급전표 ${row.used_receiptno}에 사용됨` : undefined;
  return <Table.Tr className={[selected ? classes.detailSelectedRow : '', fromHeld ? classes.heldSourceRow : ''].filter(Boolean).join(' ')}>
    <Table.Td ta="center"><input type="checkbox" aria-label={`${rowNumber}행 선택`} checked={selected} disabled={rowDisabled} onChange={(event) => onToggle(row.id, event.nativeEvent.shiftKey)} /></Table.Td>
    <Table.Td ta="center" title={sourceTitle}>{rowNumber}{fromHeld && <span className={classes.heldBadge}>보유</span>}{row.used_receiptno && <span className={classes.usedBadge}>사용</span>}</Table.Td>
    {INSTRUMENT_PREFIX_FIELDS.map((field) => <ReceiptPaymentDetailInputCell key={field.key} rowId={row.id} rowNumber={rowNumber} field={field} value={row[field.key]} disabled={disabled} onUpdate={onUpdate} />)}
    <ReceiptPaymentDetailInputCell rowId={row.id} rowNumber={rowNumber} field={AMOUNT_FIELDS[1]} value={row[AMOUNT_FIELDS[1].key]} numericInput disabled={disabled} onUpdate={onUpdate} />
    {INSTRUMENT_INFO_FIELDS.map((field) => <ReceiptPaymentDetailInputCell key={field.key} rowId={row.id} rowNumber={rowNumber} field={field} value={row[field.key]}
      suggestions={field.key === 'issuercompany' ? issuerCompanyOptions : field.key === 'custodybank' ? bankOptions : undefined}
      onOpenPicker={['issuercompany', 'custodybank'].includes(field.key) ? onOpenPicker : undefined} disabled={disabled} onUpdate={onUpdate} />)}
    {REMAINING_AMOUNT_FIELDS.map((field) => <ReceiptPaymentDetailInputCell key={field.key} rowId={row.id} rowNumber={rowNumber} field={field} value={row[field.key]} numericInput disabled={disabled} onUpdate={onUpdate} />)}
    <Table.Td ta="right" className={classes.calculatedAmount}>{formatted(totalOf(row))}</Table.Td>
    <ReceiptPaymentDetailInputCell rowId={row.id} rowNumber={rowNumber} field={DESCRIPTION_FIELD} value={row.description} disabled={rowDisabled} onUpdate={onUpdate} />
  </Table.Tr>;
});

// 저장된 전표(읽기 전용)는 입력 컴포넌트 대신 글자만 그린다 → 전표 선택 시 렌더가 훨씬 가볍다.
const readonlyText = (field, value) => field.options ? instrumentLabel(field.key, value)
  : field.type === 'date' ? dateOnly(value) : String(value ?? '');
const ReadonlyAmountCell = ({ value }) => <td className={classes.readonlyCell} data-align="right">{value === '' || value == null ? '' : formatted(value)}</td>;
const ReadonlyTextCell = ({ field, value }) => {
  const text = readonlyText(field, value);
  return <td className={classes.readonlyCell} title={text}>{text}</td>;
};
const ReceiptPaymentReadonlyRow = memo(function ReceiptPaymentReadonlyRow({ row, index }) {
  const rowNumber = index + 1;
  const sourceTitle = row.source_receiptno ? `보유증권 ${row.source_receiptno}-${row.source_lineno} 사용` : row.used_receiptno ? `지급전표 ${row.used_receiptno}에 사용됨` : undefined;
  return <tr className={row.source_receiptno ? classes.heldSourceRow : undefined}>
    <td className={classes.readonlyCell} data-align="center"><input type="checkbox" aria-label={`${rowNumber}행 선택`} checked={false} disabled readOnly /></td>
    <td className={classes.readonlyCell} data-align="center" title={sourceTitle}>{rowNumber}{row.source_receiptno && <span className={classes.heldBadge}>보유</span>}{row.used_receiptno && <span className={classes.usedBadge}>사용</span>}</td>
    {INSTRUMENT_PREFIX_FIELDS.map((field) => <ReadonlyTextCell key={field.key} field={field} value={row[field.key]} />)}
    <ReadonlyAmountCell value={row.instrumentamt} />
    {INSTRUMENT_INFO_FIELDS.map((field) => <ReadonlyTextCell key={field.key} field={field} value={row[field.key]} />)}
    {REMAINING_AMOUNT_FIELDS.map((field) => <ReadonlyAmountCell key={field.key} value={row[field.key]} />)}
    <td className={`${classes.readonlyCell} ${classes.calculatedAmount}`} data-align="right">{formatted(totalOf(row))}</td>
    <ReadonlyTextCell field={DESCRIPTION_FIELD} value={row.description} />
  </tr>;
});

const ReceiptPaymentFilterPanel = memo(function ReceiptPaymentFilterPanel({ initialValues, transactionOptions, onSearch, onClose }) {
  const [draft, setDraft] = useState(initialValues);
  const draftRef = useRef(draft);
  const update = (key, value) => {
    const next = { ...draftRef.current, [key]: value };
    draftRef.current = next;
    setDraft(next);
  };
  const submit = () => onSearch({ ...draftRef.current });
  const searchOnEnter = (event) => { if (event.key === 'Enter') submit(); };

  return <Paper className={`${inboundClasses.receiptFilterSidebar} ${classes.filterPanel}`} withBorder>
    <Group className={inboundClasses.receiptFilterHeader} justify="space-between"><Text fw={700}>조회조건</Text><ActionIcon variant="subtle" color="gray" aria-label="조회조건 닫기" onClick={onClose}><IconX size={15} /></ActionIcon></Group>
    <Stack gap="sm" className={`${inboundClasses.receiptFilterFields} ${classes.filters}`}>
      <Input.Wrapper label="수금/지급 기간"><Stack gap={6}>
        <ErpDateInput type="date" value={draft.date_from} onChange={(event) => update('date_from', event.currentTarget.value)} />
        <ErpDateInput type="date" value={draft.date_to} onChange={(event) => update('date_to', event.currentTarget.value)} />
      </Stack></Input.Wrapper>
      <Select label="구분" data={transactionOptions} value={draft.transactiontype} onChange={(value) => update('transactiontype', value || '')} />
      <TextInput label="거래처" placeholder="거래처코드 또는 거래처명" value={draft.customer} onChange={(event) => update('customer', event.currentTarget.value)} onKeyDown={searchOnEnter} />
      <TextInput label="전표번호" placeholder="전표번호" value={draft.receiptno} onChange={(event) => update('receiptno', event.currentTarget.value)} onKeyDown={searchOnEnter} />
    </Stack>
  </Paper>;
});

// 보유증권 불러오기: 보관 중인 수금 증권(어음·수표·외상매출채권)을 골라 지급 상세로 가져온다.
const HELD_PAGE_SIZE = 50;
const daysUntil = (value) => {
  if (!value) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((new Date(`${String(value).slice(0, 10)}T00:00:00`) - today) / 86400000);
};
const HeldInstrumentPickerModal = memo(function HeldInstrumentPickerModal({ opened, onClose, excludedKeys, onApply }) {
  const [filters, setFilters] = useState({ maturity_from: '', maturity_to: '', customer: '', keyword: '', instrumenttype: '' });
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState({});
  const requestRef = useRef(0);

  const load = useCallback(async (nextPage, nextFilters) => {
    const request = ++requestRef.current;
    setLoading(true);
    try {
      const params = Object.fromEntries(Object.entries(nextFilters).filter(([, value]) => value));
      const { data } = await axios.get('/api/receipt-payment/held-instruments', { ...authConfig(), params: { ...params, page: nextPage, page_size: HELD_PAGE_SIZE } });
      if (request !== requestRef.current) return;
      setRows(data.items || []); setTotal(data.total || 0); setPage(nextPage);
    } catch (error) {
      if (request === requestRef.current) notifications.show({ title: '보유증권 조회 실패', message: errorText(error), color: 'red' });
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, []);
  const resetAndLoad = useEffectEvent(() => {
    const empty = { maturity_from: '', maturity_to: '', customer: '', keyword: '', instrumenttype: '' };
    setFilters(empty); setSelected({}); setRows([]); setTotal(0);
    void load(1, empty);
  });
  useEffect(() => { if (opened) resetAndLoad(); }, [opened]);

  const visibleRows = rows.filter((row) => !excludedKeys.has(sourceKey(row.receiptno, row.lineno)));
  const selectedRows = Object.values(selected);
  const selectedAmount = selectedRows.reduce((sum, row) => sum + numeric(row.instrumentamt), 0);
  const toggle = (row) => setSelected((current) => {
    const key = sourceKey(row.receiptno, row.lineno);
    const next = { ...current };
    if (next[key]) delete next[key]; else next[key] = row;
    return next;
  });
  const allVisibleSelected = visibleRows.length > 0 && visibleRows.every((row) => selected[sourceKey(row.receiptno, row.lineno)]);
  const toggleAllVisible = (checked) => setSelected((current) => {
    const next = { ...current };
    visibleRows.forEach((row) => { const key = sourceKey(row.receiptno, row.lineno); if (checked) next[key] = row; else delete next[key]; });
    return next;
  });
  const updateFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }));
  const search = () => { void load(1, filters); };
  const close = () => { requestRef.current += 1; onClose(); };

  return <Modal opened={opened} onClose={close} title={<Group gap={9} wrap="nowrap"><Box className={outboundClasses.receiptFinderTitleIcon}><IconSearch size={17} /></Box><Text className={outboundClasses.receiptFinderModalTitle} fw={750}>보유증권 불러오기</Text></Group>}
    classNames={{ content: outboundClasses.receiptFinderModalContent, header: outboundClasses.receiptFinderModalHeader, title: outboundClasses.receiptFinderModalTitle, close: outboundClasses.receiptFinderModalClose }} centered size={1180}>
    <Stack gap="sm" pt={10}>
      <Text size="xs" c="dimmed">수금으로 받아 보관 중인 어음·수표·외상매출채권입니다. 선택하면 지급 상세에 추가되고, 저장하면 원래 증권은 '배서'로 바뀝니다.</Text>
      <Group gap={7} wrap="wrap" align="end" onKeyDown={(event) => { if (event.key === 'Enter') search(); }}>
        <Box><Text size="xs" fw={700} mb={4}>만기일</Text><Group gap={4} wrap="nowrap">
          <ErpDateInput size="xs" w={130} value={filters.maturity_from} onChange={(event) => updateFilter('maturity_from', event.currentTarget.value)} aria-label="만기일 시작" />
          <Text size="xs">~</Text>
          <ErpDateInput size="xs" w={130} value={filters.maturity_to} onChange={(event) => updateFilter('maturity_to', event.currentTarget.value)} aria-label="만기일 끝" />
        </Group></Box>
        <Select size="xs" w={130} label="종류" data={[{ value: '', label: '전체' }, ...INSTRUMENT_TYPE_OPTIONS]} value={filters.instrumenttype} onChange={(value) => updateFilter('instrumenttype', value || '')} />
        <TextInput size="xs" w={170} label="받은 거래처" value={filters.customer} onChange={(event) => updateFilter('customer', event.currentTarget.value)} />
        <TextInput size="xs" w={200} label="증권번호·발행회사" value={filters.keyword} onChange={(event) => updateFilter('keyword', event.currentTarget.value)} />
        <Button color="red" size="xs" leftSection={<IconSearch size={14} />} onClick={search}>조회</Button>
      </Group>
      <Box className={outboundClasses.pickerResults}>
        {loading && <Loader className={outboundClasses.pickerLoader} size="xs" color="red" aria-label="조회 중" />}
        <ScrollArea h={420} type="auto" scrollbarSize={6}>
          <Table className={`${codeClasses.codeTable} ${outboundClasses.pickerTable} ${classes.heldTable}`} highlightOnHover withTableBorder withColumnBorders>
            <Table.Thead><Table.Tr>
              <Table.Th className={codeClasses.checkCol}><input type="checkbox" aria-label="전체 선택" checked={allVisibleSelected} disabled={!visibleRows.length} onChange={(event) => toggleAllVisible(event.currentTarget.checked)} /></Table.Th>
              <Table.Th>만기일</Table.Th><Table.Th>D-day</Table.Th><Table.Th>종류</Table.Th><Table.Th>증권번호</Table.Th><Table.Th ta="right">금액</Table.Th>
              <Table.Th>발행회사</Table.Th><Table.Th>받은 거래처</Table.Th><Table.Th>수금일</Table.Th><Table.Th>수금전표</Table.Th>
            </Table.Tr></Table.Thead>
            <Table.Tbody>
              {visibleRows.map((row) => {
                const key = sourceKey(row.receiptno, row.lineno);
                const days = daysUntil(row.maturitydate);
                return <Table.Tr key={key} className={selected[key] ? classes.detailSelectedRow : ''} onClick={() => toggle(row)} style={{ cursor: 'pointer' }}>
                  <Table.Td className={codeClasses.checkCol} onClick={(event) => event.stopPropagation()}><input type="checkbox" aria-label={`${row.instrumentno || key} 선택`} checked={Boolean(selected[key])} onChange={() => toggle(row)} /></Table.Td>
                  <Table.Td>{dateOnly(row.maturitydate)}</Table.Td>
                  <Table.Td className={days !== null && days < 0 ? classes.heldOverdue : days !== null && days <= 7 ? classes.heldSoon : ''}>{days === null ? '' : days < 0 ? `D+${-days}` : days === 0 ? 'D-Day' : `D-${days}`}</Table.Td>
                  <Table.Td>{instrumentLabel('instrumenttype', row.instrumenttype)}</Table.Td>
                  <Table.Td>{row.instrumentno || ''}</Table.Td>
                  <Table.Td ta="right">{formatted(row.instrumentamt)}</Table.Td>
                  <Table.Td>{row.issuercompany || ''}</Table.Td>
                  <Table.Td>{row.customname || ''}</Table.Td>
                  <Table.Td>{dateOnly(row.receiptdate)}</Table.Td>
                  <Table.Td>{row.receiptno}-{row.lineno}</Table.Td>
                </Table.Tr>;
              })}
              {!visibleRows.length && <Table.Tr><Table.Td colSpan={10} className={outboundClasses.customerEmpty}>{loading ? '조회 중입니다.' : '보관 중인 증권이 없습니다.'}</Table.Td></Table.Tr>}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Box>
      <Group justify="space-between" wrap="nowrap">
        <Group gap="md" wrap="nowrap">
          <Pagination size="sm" total={Math.max(1, Math.ceil(total / HELD_PAGE_SIZE))} value={page} onChange={(nextPage) => void load(nextPage, filters)} withEdges color="red" disabled={loading} />
          <Text size="xs" c="dimmed">총 {total.toLocaleString()}건</Text>
        </Group>
        <Group gap="sm" wrap="nowrap">
          <Text size="sm" fw={700}>선택 {selectedRows.length.toLocaleString()}장 · 합계 {formatted(selectedAmount)}원</Text>
          <Button variant="default" onClick={close}>취소</Button>
          <Button color="red" disabled={!selectedRows.length} onClick={() => { onApply(selectedRows); onClose(); }}>선택 적용</Button>
        </Group>
      </Group>
    </Stack>
  </Modal>;
});

const ReceiptCustomerPickerModal = memo(function ReceiptCustomerPickerModal({ opened, onClose, onSelect }) {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [customers, setCustomers] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const requestRef = useRef(0);

  const load = useCallback(async (nextPage, nextSearch) => {
    const request = ++requestRef.current;
    setLoading(true);
    try {
      const { data } = await axios.get('/api/list', {
        ...authConfig(),
        params: { search_keyword: nextSearch || undefined, status: 'Y', page: nextPage, page_size: 20, include_total: true },
      });
      if (request !== requestRef.current) return;
      setCustomers(data.data || []); setTotal(data.total || 0); setPage(nextPage); setSearch(nextSearch);
    } catch (error) {
      if (request === requestRef.current) notifications.show({ title: '거래처 조회 실패', message: errorText(error), color: 'red' });
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!opened) return;
    setSearchInput(''); setCustomers([]); setTotal(0);
    void load(1, '');
  }, [opened, load]);

  const runSearch = () => { void load(1, searchInput.trim()); };
  const select = (customer) => { onSelect(customer); onClose(); };
  const invalidatePending = () => { requestRef.current += 1; onClose(); };

  return <Modal opened={opened} onClose={invalidatePending} title={<Group gap={9} wrap="nowrap"><Box className={outboundClasses.receiptFinderTitleIcon}><IconSearch size={17} /></Box><Text className={outboundClasses.receiptFinderModalTitle} fw={750}>거래처 선택</Text></Group>}
    classNames={{ content: outboundClasses.receiptFinderModalContent, header: outboundClasses.receiptFinderModalHeader, title: outboundClasses.receiptFinderModalTitle, close: outboundClasses.receiptFinderModalClose }} centered size={900}>
    <Stack gap="sm" pt={10}>
      <Group gap={7} wrap="nowrap">
        <TextInput className={outboundClasses.customerSearchInput} placeholder="거래처코드 또는 거래처명 검색" value={searchInput}
          onChange={(event) => setSearchInput(event.currentTarget.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') runSearch(); }} leftSection={<IconSearch size={15} />} size="sm" autoFocus />
        <Button color="red" size="sm" leftSection={<IconSearch size={15} />} onClick={runSearch}>조회</Button>
      </Group>
      <Box className={outboundClasses.pickerResults}>
        {loading && <Loader className={outboundClasses.pickerLoader} size="xs" color="red" aria-label="조회 중" />}
        <ScrollArea h={420} type="auto" scrollbarSize={6}>
          <Table className={`${codeClasses.codeTable} ${outboundClasses.pickerTable}`} highlightOnHover withTableBorder withColumnBorders>
            <Table.Thead><Table.Tr><Table.Th className={outboundClasses.customerCodeColumn}>거래처코드</Table.Th><Table.Th className={outboundClasses.customerNameColumn}>거래처명</Table.Th><Table.Th className={outboundClasses.customerRepresentativeColumn}>대표자</Table.Th><Table.Th className={outboundClasses.customerBusinessColumn}>사업자번호</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>
              {customers.map((customer) => <Table.Tr key={customer.customercode} className={outboundClasses.customerResultRow} onClick={() => select(customer)}>
                <Table.Td>{customer.customercode}</Table.Td><Table.Td>{customer.customername}</Table.Td><Table.Td>{customer.ceoname || ''}</Table.Td><Table.Td>{customer.businessno || ''}</Table.Td>
              </Table.Tr>)}
              {!customers.length && <Table.Tr><Table.Td colSpan={4} className={outboundClasses.customerEmpty}>{loading ? '조회 중입니다.' : '조회된 거래처가 없습니다.'}</Table.Td></Table.Tr>}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Box>
      <Group justify="space-between"><Text size="xs" c="dimmed">총 {total.toLocaleString()}건</Text><Pagination size="sm" total={Math.max(1, Math.ceil(total / 20))} value={page} onChange={(nextPage) => void load(nextPage, search)} withEdges color="red" disabled={loading} /></Group>
    </Stack>
  </Modal>;
});

const ReceiptBankPickerModal = memo(function ReceiptBankPickerModal({ opened, onClose, options, onSelect }) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return query ? options.filter((item) => `${item.code} ${item.name}`.toLocaleLowerCase().includes(query)) : options;
  }, [options, search]);
  const pageItems = filtered.slice((page - 1) * pageSize, page * pageSize);

  const [prevOpened, setPrevOpened] = useState(opened);
  if (prevOpened !== opened) {
    setPrevOpened(opened);
    if (opened) { setSearch(''); setPage(1); }
  }

  return <Modal opened={opened} onClose={onClose}
    title={<Group gap={9} wrap="nowrap"><Box className={outboundClasses.receiptFinderTitleIcon}><IconSearch size={17} /></Box><Text className={outboundClasses.receiptFinderModalTitle} fw={750}>은행 선택</Text></Group>}
    classNames={{ content: outboundClasses.receiptFinderModalContent, header: outboundClasses.receiptFinderModalHeader, title: outboundClasses.receiptFinderModalTitle, close: outboundClasses.receiptFinderModalClose }}
    centered size={620}>
    <Stack gap="sm" pt={10}>
      <TextInput className={outboundClasses.customerSearchInput} placeholder="은행코드 또는 은행명 검색" value={search}
        onChange={(event) => { setSearch(event.currentTarget.value); setPage(1); }} leftSection={<IconSearch size={15} />} size="sm" autoFocus />
      <Box className={outboundClasses.pickerResults}>
        <ScrollArea h={360} type="auto" scrollbarSize={6}>
          <Table className={`${codeClasses.codeTable} ${outboundClasses.pickerTable}`} highlightOnHover withTableBorder withColumnBorders>
            <Table.Thead><Table.Tr><Table.Th>은행코드</Table.Th><Table.Th>은행명</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>
              {pageItems.map((item) => <Table.Tr key={item.code} className={outboundClasses.customerResultRow} onClick={() => { onSelect(item); onClose(); }}>
                <Table.Td>{item.code}</Table.Td><Table.Td>{item.name}</Table.Td>
              </Table.Tr>)}
              {!pageItems.length && <Table.Tr><Table.Td colSpan={2} className={outboundClasses.customerEmpty}>조회된 은행이 없습니다.</Table.Td></Table.Tr>}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Box>
      <Group justify="space-between"><Text size="xs" c="dimmed">총 {filtered.length.toLocaleString()}건</Text>
        <Pagination size="sm" total={Math.max(1, Math.ceil(filtered.length / pageSize))} value={page} onChange={setPage} withEdges color="red" /></Group>
    </Stack>
  </Modal>;
});

export default function ReceiptPayment() {
  const ribbon = useContext(PageRibbonContext);
  const registerRibbon = ribbon?.registerPageRibbon;
  const closePage = ribbon?.closeActivePage;
  const [filterOpen, setFilterOpen] = useState(true);
  const filterInputsRef = useRef(null);
  if (filterInputsRef.current === null) filterInputsRef.current = makeFilters();
  const [filters, setFilters] = useState(makeFilters);
  const [documents, setDocuments] = useState([]);
  const [header, setHeader] = useState(emptyHeader);
  const [customers, setCustomers] = useState([]);
  const [bankOptions, setBankOptions] = useState([]);
  const [items, setItems] = useState([]);
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [detailPicker, setDetailPicker] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [summaryColumnWidths, setSummaryColumnWidths] = useState(() => SUMMARY_COLUMNS.map((column) => column.width));
  const [detailColumnWidths, setDetailColumnWidths] = useState(DETAIL_COLUMN_WIDTHS);
  const [totalRows, setTotalRows] = useState(0);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedRows, setSelectedRows] = useState([]);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const documentsRef = useRef(documents);
  documentsRef.current = documents;
  const selectedReceiptRef = useRef('');
  const detailRequest = useRef(0);
  const detailCache = useRef(new Map());
  const detailLoadingRef = useRef(detailLoading);
  detailLoadingRef.current = detailLoading;
  const listRequest = useRef(0);
  const selectionAnchor = useRef(null);
  const listTableRef = useRef(null);
  const listSubtotalRef = useRef(null);
  const listHorizontalScrollRef = useRef(null);
  const detailTableWrapRef = useRef(null);
  const pendingDetailFocus = useRef(null);
  const updateHeaderField = useCallback((field, value) => {
    setHeader((current) => ({ ...current, [field]: value }));
  }, []);
  const summaryTableWidth = summaryColumnWidths.reduce((sum, width) => sum + width, 0);
  const detailTableWidth = detailColumnWidths.reduce((sum, width) => sum + width, 0);
  const isSavedDocument = Boolean(header.receiptno);
  // 신규 전표는 추가 직후 저장 버튼을 활성화하고, 저장된 전표는 읽기 전용으로 표시한다.
  const canSave = Boolean(!isSavedDocument && items.length > 0);
  const canExport = header.receiptno ? items.length > 0 : documents.length > 0;

  const startColumnResize = useCallback((event, index, startWidth, widths, setWidths, scope) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const priorUserSelect = document.body.style.userSelect;
    const priorCursor = document.body.style.cursor;
    const handle = event.currentTarget;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    handle.classList.add(classes.columnResizeHandleActive);
    const nextWidths = [...widths];
    const getTables = () => scope === 'summary'
      ? [listTableRef.current?.querySelector('table'), listSubtotalRef.current?.querySelector('table')].filter(Boolean)
      : [detailTableWrapRef.current?.querySelector('table')].filter(Boolean);
    const handleMove = (moveEvent) => {
      const nextWidth = Math.max(54, startWidth + moveEvent.clientX - startX);
      nextWidths[index] = nextWidth;
      const totalWidth = nextWidths.reduce((sum, width) => sum + width, 0);
      getTables().forEach((table) => {
        const column = table.querySelectorAll('colgroup col')[index];
        if (column) column.style.width = `${nextWidth}px`;
        table.style.setProperty('--code-table-min-width', `${totalWidth}px`);
        if (scope === 'summary' && table === listSubtotalRef.current?.querySelector('table')) {
          table.style.width = `${totalWidth}px`;
          table.style.minWidth = `${totalWidth}px`;
        }
      });
      if (scope === 'summary' && listHorizontalScrollRef.current?.firstElementChild) {
        listHorizontalScrollRef.current.firstElementChild.style.width = `${totalWidth}px`;
      }
    };
    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
      document.body.style.userSelect = priorUserSelect;
      document.body.style.cursor = priorCursor;
      handle.classList.remove(classes.columnResizeHandleActive);
      setWidths(nextWidths);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
  }, []);

  const baseCustomerOptions = useMemo(() => customers
    .map((customer) => ({ value: customer.customercode, label: customer.customername }))
    .filter((option) => option.value && option.label), [customers]);
  // Keep the same array unless the current customer is missing: a new array makes the Select redraw every option (hundreds of customers).
  const customerOptions = useMemo(() => (
    header.customcode && !baseCustomerOptions.some((option) => option.value === header.customcode)
      ? [{ value: header.customcode, label: header.customname || header.customcode }, ...baseCustomerOptions]
      : baseCustomerOptions
  ), [baseCustomerOptions, header.customcode, header.customname]);
  const issuerCompanyOptions = useMemo(() => [...new Map(customers
    .map((customer) => ({ value: String(customer.customername || '').trim(), label: String(customer.customername || '').trim(), code: String(customer.customercode || '').trim() }))
    .filter((option) => option.value)
    .map((option) => [option.value, option])).values()], [customers]);

  useEffect(() => {
    let cancelled = false;
    const loadCustomers = async () => {
      const loadedCustomers = [];
      let pageNumber = 1;
      let totalCount = 0;
      do {
        const { data } = await axios.get('/api/list', {
          ...authConfig(),
          params: { status: 'Y', page: pageNumber, page_size: 200, include_total: true },
        });
        loadedCustomers.push(...(data.data || []));
        totalCount = data.total || 0;
        pageNumber += 1;
      } while (loadedCustomers.length < totalCount && pageNumber <= 100);
      if (!cancelled) setCustomers(loadedCustomers);
    };
    void loadCustomers().catch((error) => {
      if (!cancelled) notifications.show({ title: '거래처 조회 실패', message: errorText(error), color: 'red' });
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadBankOptions = async () => {
      const items = [];
      let pageNumber = 1;
      let totalCount = 0;
      do {
        const { data } = await axios.get('/api/code-master/groups/BANK/items', {
          ...authConfig(), params: { page: pageNumber, page_size: 200, include_total: true },
        });
        items.push(...(data.items || []));
        totalCount = data.total || 0;
        pageNumber += 1;
      } while (items.length < totalCount && pageNumber <= 100);
      if (!cancelled) setBankOptions([...new Map(items.filter((item) => item.use)
        .map((item) => ({ value: String(item.name || '').trim(), label: String(item.name || '').trim(), code: String(item.code || '').trim(), name: String(item.name || '').trim() }))
        .filter((item) => item.name)
        .map((item) => [item.code || item.name, item])).values()]);
    };
    void loadBankOptions().catch(() => { if (!cancelled) setBankOptions([]); });
    return () => { cancelled = true; };
  }, []);

  const loadDocuments = useCallback(async (nextPage = 1, query = filters, size = pageSize) => {
    const request = ++listRequest.current;
    setLoading(true);
    try {
      const { data } = await axios.get('/api/receipt-payment/documents', {
        ...authConfig(),
        params: {
          page: nextPage, page_size: size,
          date_from: query.date_from || undefined, date_to: query.date_to || undefined,
          transactiontype: query.transactiontype || undefined, customer: query.customer || undefined,
          receiptno: query.receiptno || undefined,
        },
      });
      if (request !== listRequest.current) return;
      setDocuments(data.documents || []);
      setTotalRows(data.total || 0);
      setPage(data.page || nextPage);
    } catch (error) {
      if (request === listRequest.current) notifications.show({ title: '수금/지급 조회 실패', message: errorText(error), color: 'red' });
    } finally {
      if (request === listRequest.current) setLoading(false);
    }
  }, [filters, pageSize]);

  const loadInitialDocuments = useEffectEvent(() => { void loadDocuments(1, filters, pageSize); });
  useEffect(() => { loadInitialDocuments(); }, []);

  const openDocument = useCallback(async (receiptno) => {
    const cachedItems = detailCache.current.get(receiptno);
    if (selectedReceiptRef.current === receiptno) {
      if (cachedItems) return;
      if (detailLoadingRef.current) return;
    }
    selectedReceiptRef.current = receiptno;
    const request = ++detailRequest.current;
    const summary = documentsRef.current.find((doc) => doc.receiptno === receiptno);
    if (summary) {
      setHeader({
        receiptno: summary.receiptno, receiptdate: dateOnly(summary.receiptdate),
        transactiontype: summary.transactiontype, customcode: summary.customcode || '',
        customname: summary.customname || '', manager: summary.manager || '', description: summary.description || '',
      });
    }
    setSelectedRows([]);
    selectionAnchor.current = null;
    if (cachedItems) {
      setItems(cachedItems);
      detailLoadingRef.current = false;
      setDetailLoading(false);
      return;
    }
    setItems([]);
    detailLoadingRef.current = true;
    setDetailLoading(true);
    try {
      const { data } = await axios.get(`/api/receipt-payment/documents/${encodeURIComponent(receiptno)}`, authConfig());
      if (request !== detailRequest.current) return;
      const doc = data.document;
      setHeader({
        receiptno: doc.receiptno, receiptdate: dateOnly(doc.receiptdate),
        transactiontype: doc.transactiontype, customcode: doc.customcode,
        customname: doc.customname, manager: doc.manager || '', description: doc.description || '',
      });
      const nextItems = (doc.items || []).map((item) => makeDetail(item));
      detailCache.current.set(receiptno, nextItems);
      setItems(nextItems);
    } catch (error) {
      if (request === detailRequest.current) notifications.show({ title: '상세 조회 실패', message: errorText(error), color: 'red' });
    } finally {
      if (request === detailRequest.current) {
        detailLoadingRef.current = false;
        setDetailLoading(false);
      }
    }
  }, []);

  const runSearch = useCallback((inputValues = filterInputsRef.current) => {
    const next = { ...inputValues };
    filterInputsRef.current = next;
    setFilters(next);
    void loadDocuments(1, next, pageSize);
  }, [loadDocuments, pageSize]);
  const closeFilter = useCallback(() => setFilterOpen(false), []);

  const startNew = useCallback(() => {
    selectedReceiptRef.current = '';
    detailRequest.current += 1;
    setHeader(emptyHeader());
    setItems([makeDetail()]);
    setSelectedRows([]);
    selectionAnchor.current = null;
  }, []);

  const selectDocument = useCallback((receiptno) => { void openDocument(receiptno); }, [openDocument]);

  const chooseCustomer = useCallback((customer) => {
    setHeader((current) => ({ ...current, customname: customer.customername || '', customcode: customer.customercode || '' }));
  }, []);
  const pickHeaderCustomer = useCallback((value) => {
    const customer = customers.find((item) => item.customercode === value);
    chooseCustomer(customer || {
      customercode: value || '',
      customername: customerOptions.find((option) => option.value === value)?.label || '',
    });
  }, [customers, customerOptions, chooseCustomer]);

  const updateDetail = useCallback((id, key, value) => {
    setItems((rows) => rows.map((row) => row.id === id ? { ...row, [key]: value } : row));
  }, []);
  const openDetailPicker = useCallback((rowId, field) => setDetailPicker({ rowId, field }), []);
  const selectDetailCustomer = useCallback((customer) => {
    if (detailPicker?.rowId) updateDetail(detailPicker.rowId, 'issuercompany', customer.customername || '');
  }, [detailPicker, updateDetail]);
  const selectDetailBank = useCallback((bank) => {
    if (detailPicker?.rowId) updateDetail(detailPicker.rowId, 'custodybank', bank.name || '');
  }, [detailPicker, updateDetail]);
  const toggleRow = useCallback((id, shiftKey) => {
    setSelectedRows((previous) => {
      const next = new Set(previous);
      const currentItems = itemsRef.current;
      const anchorIndex = currentItems.findIndex((row) => row.id === selectionAnchor.current);
      const currentIndex = currentItems.findIndex((row) => row.id === id);
      if (shiftKey && anchorIndex >= 0 && currentIndex >= 0) {
        currentItems.slice(Math.min(anchorIndex, currentIndex), Math.max(anchorIndex, currentIndex) + 1).forEach((row) => next.add(row.id));
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      selectionAnchor.current = id;
      return [...next];
    });
  }, []);

  const [heldPickerOpen, setHeldPickerOpen] = useState(false);
  const usedSourceKeys = useMemo(() => new Set(items.filter((row) => row.source_receiptno)
    .map((row) => sourceKey(row.source_receiptno, row.source_lineno))), [items]);
  const hasHeldRows = usedSourceKeys.size > 0;
  const applyHeldInstruments = useCallback((selectedInstruments) => {
    const added = selectedInstruments.map((source) => makeDetail({
      instrumentamt: String(numeric(source.instrumentamt)), instrumenttype: source.instrumenttype || '', instrumentno: source.instrumentno || '',
      issuedate: source.issuedate, issuercompany: source.issuercompany || '', issuer: source.issuer || '',
      issuekind: 'OTHER', maturitydate: source.maturitydate, custodyaccount: source.custodyaccount || '',
      custodybank: source.custodybank || '', instrumentstatus: 'ENDORSED',
      source_receiptno: source.receiptno, source_lineno: source.lineno,
    }));
    // 새 전표의 빈 첫 행은 불러온 증권으로 대체
    setItems((rows) => [...rows.filter((row) => row.source_receiptno || totalOf(row) > 0
      || ['offsetamt', 'lossamt', 'chargeamt'].some((key) => numeric(row[key]) > 0) || String(row.description || '').trim()), ...added]);
    setSelectedRows([]);
    notifications.show({ title: '보유증권 추가', message: `${added.length}장 · ${formatted(added.reduce((sum, row) => sum + numeric(row.instrumentamt), 0))}원을 지급 상세에 추가했습니다. 저장하면 원래 증권이 '배서'로 바뀝니다.`, color: 'teal' });
  }, []);

  const addDetail = useCallback((focusField = null) => {
    const newRow = makeDetail();
    if (focusField) pendingDetailFocus.current = { rowId: newRow.id, field: focusField };
    setItems((rows) => [...rows, newRow]);
    setSelectedRows([]);
  }, []);
  useEffect(() => {
    const pendingFocus = pendingDetailFocus.current;
    if (!pendingFocus || !items.some((row) => row.id === pendingFocus.rowId)) return undefined;
    pendingDetailFocus.current = null;
    const frame = requestAnimationFrame(() => {
      const cells = detailTableWrapRef.current?.querySelectorAll('[data-detail-row][data-detail-field]');
      const firstCell = Array.from(cells || []).find((cell) =>
        cell.dataset.detailRow === pendingFocus.rowId && cell.dataset.detailField === pendingFocus.field
      );
      firstCell?.querySelector('input, textarea, select')?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [items]);
  const handleDetailTableKeyDown = useCallback((event) => {
    const input = event.target instanceof HTMLElement ? event.target.closest('input, textarea, select') : null;
    const cell = input?.closest('[data-detail-row][data-detail-field]');
    if (!input || !cell || saving || isSavedDocument) return;

    // While an autocomplete (발행회사·보관은행) shows suggestions, ↑/↓/Enter belong to that list:
    // moving to another row here would blur the input and close the list before a choice is made.
    const suggestionList = input.dataset.expanded !== undefined && input.getAttribute('aria-controls')
      ? document.getElementById(input.getAttribute('aria-controls'))
      : null;
    if (suggestionList?.querySelector('[role="option"]') && ['ArrowUp', 'ArrowDown', 'Enter'].includes(event.key)) return;

    if (event.key === 'Enter') {
      event.preventDefault();
      const currentRowIndex = items.findIndex((row) => row.id === cell.dataset.detailRow);
      const nextRow = items[currentRowIndex + 1];
      if (nextRow) {
        const cells = detailTableWrapRef.current?.querySelectorAll('[data-detail-row][data-detail-field]');
        const nextCell = Array.from(cells || []).find((candidate) =>
          candidate.dataset.detailRow === nextRow.id && candidate.dataset.detailField === cell.dataset.detailField
        );
        nextCell?.querySelector('input, textarea, select')?.focus();
      }
      // On the last row Enter no longer appends a new row; rows are added with the 추가 button.
      return;
    }

    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      const currentRowIndex = items.findIndex((row) => row.id === cell.dataset.detailRow);
      const nextRow = items[currentRowIndex + (event.key === 'ArrowUp' ? -1 : 1)];
      if (!nextRow) return;
      const cells = detailTableWrapRef.current?.querySelectorAll('[data-detail-row][data-detail-field]');
      const nextCell = Array.from(cells || []).find((candidate) =>
        candidate.dataset.detailRow === nextRow.id && candidate.dataset.detailField === cell.dataset.detailField
      );
      const nextInput = nextCell?.querySelector('input, textarea, select');
      if (!nextInput || nextInput.disabled) return;
      event.preventDefault();
      nextInput.focus();
      return;
    }

    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    if (input instanceof HTMLInputElement && input.type === 'date') return;
    let start;
    let end;
    try {
      start = input.selectionStart;
      end = input.selectionEnd;
    } catch {
      return;
    }
    if (typeof start !== 'number' || typeof end !== 'number' || start !== end) return;
    const valueLength = input.value?.length ?? 0;
    const movingLeft = event.key === 'ArrowLeft';
    if ((movingLeft && start !== 0) || (!movingLeft && end !== valueLength)) return;

    const fieldIndex = DETAIL_NAVIGATION_FIELDS.indexOf(cell.dataset.detailField);
    const nextField = DETAIL_NAVIGATION_FIELDS[fieldIndex + (movingLeft ? -1 : 1)];
    if (!nextField) return;
    const cells = detailTableWrapRef.current?.querySelectorAll('[data-detail-row][data-detail-field]');
    const nextCell = Array.from(cells || []).find((candidate) =>
      candidate.dataset.detailRow === cell.dataset.detailRow && candidate.dataset.detailField === nextField
    );
    const nextInput = nextCell?.querySelector('input, textarea, select');
    if (!nextInput || nextInput.disabled) return;
    event.preventDefault();
    nextInput.focus();
    try {
      const caret = movingLeft ? (nextInput.value?.length ?? 0) : 0;
      nextInput.setSelectionRange(caret, caret);
    } catch {
      // Date and numeric inputs may not expose a text selection range.
    }
  }, [isSavedDocument, items, saving]);
  const handleDetailTablePaste = useCallback((event) => {
    if (saving || isSavedDocument) return;
    const text = event.clipboardData?.getData('text/plain') ?? '';
    if (!text.includes('\t') && !/[\r\n]/.test(text)) return;

    const input = event.target instanceof HTMLElement ? event.target.closest('input, textarea, select') : null;
    const cell = input?.closest('[data-detail-row][data-detail-field]');
    if (!cell) return;
    const startRow = itemsRef.current.findIndex((row) => row.id === cell.dataset.detailRow);
    const startColumn = DETAIL_NAVIGATION_FIELDS.indexOf(cell.dataset.detailField);
    if (startRow < 0 || startColumn < 0) return;

    event.preventDefault();
    const matrix = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    if (matrix.length > 1 && matrix[matrix.length - 1] === '') matrix.pop();
    const numericKeys = new Set(AMOUNT_KEYS);
    let invalidNumericCount = 0;
    const values = matrix.map((line) => line.split('\t').map((value, columnOffset) => {
      const field = DETAIL_NAVIGATION_FIELDS[startColumn + columnOffset];
      if (!field) return null;
      const trimmed = value.trim();
      if (!numericKeys.has(field) || trimmed === '') return trimmed;
      const normalized = trimmed.replaceAll(',', '').replace(/\s/g, '');
      if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) {
        invalidNumericCount += 1;
        return null;
      }
      const amount = Math.round(Number(normalized) * 1000) / 1000;
      return Number.isFinite(amount) ? String(amount) : null;
    }));

    setItems((current) => {
      const next = [...current];
      while (next.length < startRow + values.length) next.push(makeDetail());
      values.forEach((line, rowOffset) => {
        const rowIndex = startRow + rowOffset;
        const row = { ...next[rowIndex] };
        line.forEach((value, columnOffset) => {
          const field = DETAIL_NAVIGATION_FIELDS[startColumn + columnOffset];
          if (field && value !== null && (!row.source_receiptno || field === 'description')) row[field] = value;
        });
        next[rowIndex] = row;
      });
      return next;
    });
    setSelectedRows([]);
    if (invalidNumericCount) notifications.show({
      title: '숫자 입력 확인',
      message: '금액 칸에 숫자가 아닌 값은 붙여넣지 않았습니다.',
      color: 'red',
    });
  }, [isSavedDocument, saving]);
  const handleAddAction = useCallback(() => {
    if (!header.receiptno && items.length > 0) addDetail();
    else startNew();
  }, [header.receiptno, items.length, addDetail, startNew]);
  const deleteSelected = useCallback(() => {
    if (!selectedRows.length) return false;
    const selected = new Set(selectedRows);
    setItems((rows) => rows.filter((row) => !selected.has(row.id)));
    setSelectedRows([]);
    selectionAnchor.current = null;
    return true;
  }, [selectedRows]);

  const copySelected = useCallback(() => {
    if (isSavedDocument) return;
    if (selectedRows.length !== 1) {
      notifications.show({ title: '복사할 행을 선택해 주세요', message: '상세에서 한 행을 선택한 뒤 복사할 수 있습니다.', color: 'orange' });
      return;
    }
    const source = items.find((row) => row.id === selectedRows[0]);
    if (source?.source_receiptno) {
      notifications.show({ title: '복사할 수 없는 행', message: '보유증권 행은 같은 증권을 두 번 쓸 수 없어 복사할 수 없습니다.', color: 'orange' });
      return;
    }
    if (source) setItems((rows) => [...rows, makeDetail({ ...source, id: undefined })]);
    setSelectedRows([]);
  }, [isSavedDocument, items, selectedRows]);

  const totals = useMemo(() => items.reduce((sum, row) => {
    AMOUNT_KEYS.forEach((key) => { sum[key] += numeric(row[key]); });
    sum.totalamt += totalOf(row);
    return sum;
  }, { ...Object.fromEntries(AMOUNT_KEYS.map((key) => [key, 0])), totalamt: 0 }), [items]);

  const saveDocument = useCallback(async () => {
    if (!header.receiptdate || !header.transactiontype || !header.customcode || !header.customname) {
      notifications.show({ title: '필수 항목을 확인해 주세요', message: '수금/지급일, 구분, 거래처를 선택해 주세요.', color: 'red' });
      return;
    }
    if (!items.length) {
      notifications.show({ title: '상세 행을 확인해 주세요', message: '금액 상세를 한 행 이상 추가해 주세요.', color: 'red' });
      return;
    }
    const emptyRowIndex = items.findIndex((row) => !AMOUNT_KEYS.some((key) => numeric(row[key]) > 0));
    if (emptyRowIndex >= 0) {
      notifications.show({ title: '금액을 입력해 주세요', message: `${emptyRowIndex + 1}행에 금액이 없습니다. 금액을 입력하거나 빈 행을 삭제해 주세요.`, color: 'red' });
      return;
    }
    // 종류를 골랐다면 증권 → 금액은 '수표/어음' 칸. 현금 수금은 종류를 비운다.
    const misplacedIndex = items.findIndex((row) => row.instrumenttype && numeric(row.instrumentamt) <= 0);
    if (misplacedIndex >= 0) {
      notifications.show({
        title: '수표/어음 금액 확인',
        message: `${misplacedIndex + 1}행: 수표/어음 종류를 선택했으면 금액은 '수표/어음' 칸에 입력해 주세요. 현금으로 받았다면 종류를 비워 주세요.`,
        color: 'orange', autoClose: 9000,
      });
      return;
    }
    setSaving(true);
    try {
      const { data } = await axios.put('/api/receipt-payment/documents', {
        ...header,
        items: items.map((row) => ({
          cashamt: numeric(row.cashamt), instrumentamt: numeric(row.instrumentamt),
          instrumenttype: row.instrumenttype || '', instrumentno: row.instrumentno || '',
          issuedate: row.issuedate || null, issuercompany: row.issuercompany || '',
          issuer: row.issuer || '', issuekind: row.issuekind || '', maturitydate: row.maturitydate || null,
          custodyaccount: row.custodyaccount || '', custodybank: row.custodybank || '',
          instrumentstatus: row.instrumentstatus || '',
          bankamt: numeric(row.bankamt), cardamt: numeric(row.cardamt),
          offsetamt: numeric(row.offsetamt), lossamt: numeric(row.lossamt),
          chargeamt: numeric(row.chargeamt), description: row.description || '',
          source_receiptno: row.source_receiptno || '', source_lineno: row.source_receiptno ? Number(row.source_lineno) : null,
        })),
      }, authConfig());
      notifications.show({ title: '저장 완료', message: `${data.receiptno} 전표를 저장했습니다.`, color: 'teal' });
      // 입력 중인 임시 상태를 비우고 목록을 갱신한 뒤, 저장된 전표를 다시 선택한다.
      startNew();
      await loadDocuments(1, filters, pageSize);
      await openDocument(data.receiptno);
    } catch (error) {
      notifications.show({ title: '저장 실패', message: errorText(error), color: 'red' });
    } finally {
      setSaving(false);
    }
  }, [filters, header, items, loadDocuments, openDocument, pageSize, startNew]);

  const deleteDocument = useCallback(async () => {
    if (!header.receiptno) return;
    setSaving(true);
    try {
      await axios.delete(`/api/receipt-payment/documents/${encodeURIComponent(header.receiptno)}`, authConfig());
      notifications.show({ title: '삭제 완료', message: `${header.receiptno} 전표를 삭제했습니다.`, color: 'teal' });
      setDeleteOpen(false);
      startNew();
      await loadDocuments(page, filters, pageSize);
    } catch (error) {
      notifications.show({ title: '삭제 실패', message: errorText(error), color: 'red' });
    } finally {
      setSaving(false);
    }
  }, [filters, header.receiptno, loadDocuments, page, pageSize, startNew]);

  const deleteAction = useCallback(() => {
    if (deleteSelected()) return;
    if (header.receiptno) setDeleteOpen(true);
    else notifications.show({ title: '삭제할 항목이 없습니다', message: '상세 행을 선택해 주세요.', color: 'orange' });
  }, [deleteSelected, header.receiptno]);

  const exportExcel = useCallback(() => {
    const rows = header.receiptno
      ? items.map((row, index) => ({
        전표번호: header.receiptno, 수금지급일: header.receiptdate, 구분: typeName(header.transactiontype),
        거래처: header.customname, 순번: index + 1,
        수표어음종류: instrumentLabel('instrumenttype', row.instrumenttype), 수표어음번호: row.instrumentno, 수표어음: numeric(row.instrumentamt),
        발행일: dateOnly(row.issuedate), 발행회사: row.issuercompany, 발행자: row.issuer,
        발행구분: instrumentLabel('issuekind', row.issuekind), 만기일: dateOnly(row.maturitydate), 보관계좌: row.custodyaccount,
        보관은행: row.custodybank, 어음처리상태: instrumentLabel('instrumentstatus', row.instrumentstatus),
        현금: numeric(row.cashamt), 은행예금: numeric(row.bankamt), 카드: numeric(row.cardamt), 합계: totalOf(row), 상계: numeric(row.offsetamt),
        잡손실: numeric(row.lossamt), 과금: numeric(row.chargeamt), 비고: row.description,
        등록자: row.created_by || '', 수정자: row.updated_by || '',
      }))
      : documents.map((row) => ({
        수금지급일: dateOnly(row.receiptdate), 구분: typeName(row.transactiontype), 거래처: row.customname,
        상세건수: row.line_count, 수표어음: numeric(row.instrumentamt), 현금: numeric(row.cashamt),
        은행예금: numeric(row.bankamt), 카드: numeric(row.cardamt), 합계: numeric(row.totalamt),
        상계: numeric(row.offsetamt), 잡손실: numeric(row.lossamt), 과금: numeric(row.chargeamt), 전표번호: row.receiptno,
        등록자: row.created_by || '', 수정자: row.updated_by || '',
      }));
    if (!rows.length) {
      notifications.show({ title: '엑셀 데이터 없음', message: '다운로드할 데이터가 없습니다.', color: 'orange' });
      return;
    }
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(rows);
    applyExcelHeaderStyle(worksheet, Object.keys(rows[0] || {}).length);
    XLSX.utils.book_append_sheet(workbook, worksheet, '수금지급');
    XLSX.writeFile(workbook, `수금지급_${todayString()}.xlsx`);
  }, [documents, header, items]);

  // 리본 버튼은 ref를 통해 최신 핸들러를 호출 → 행 추가처럼 핸들러만 바뀔 때는 리본(레이아웃 전체)을 다시 등록하지 않는다.
  const ribbonActions = useRef({});
  useLayoutEffect(() => {
    ribbonActions.current = { runSearch, handleAddAction, copySelected, exportExcel, saveDocument, deleteAction };
  });
  const copyEnabled = !saving && !isSavedDocument && selectedRows.length === 1;
  const deleteEnabled = !saving && Boolean(header.receiptno || selectedRows.length > 0);
  useEffect(() => {
    if (!registerRibbon) return undefined;
    const call = (name) => () => ribbonActions.current[name]?.();
    registerRibbon(
      <Group className={inboundClasses.commandRibbon} gap={2} wrap="nowrap">
        <Button className={inboundClasses.ribbonTool} variant="subtle" size="sm" leftSection={<IconSearch size={15} />} onClick={call('runSearch')} loading={loading} disabled={loading}>조회</Button>
        <span className={inboundClasses.ribbonSeparator} />
        <Button className={inboundClasses.ribbonTool} variant="subtle" size="sm" leftSection={<IconPlus size={15} />} onClick={call('handleAddAction')} disabled={saving}>추가</Button>
        <Button className={inboundClasses.ribbonTool} variant="subtle" size="sm" leftSection={<IconCopy size={15} />} onClick={call('copySelected')} disabled={!copyEnabled}>복사</Button>
        <Button className={inboundClasses.ribbonTool} variant="subtle" size="sm" leftSection={<IconFileSpreadsheet size={15} />} onClick={call('exportExcel')} disabled={!canExport}>엑셀</Button>
        <Button className={inboundClasses.ribbonTool} variant="subtle" size="sm" leftSection={<IconDeviceFloppy size={15} />} onClick={call('saveDocument')} loading={saving} disabled={saving || !canSave}>저장</Button>
        <Button className={inboundClasses.ribbonTool} variant="subtle" size="sm" leftSection={<IconTrash size={15} />} onClick={call('deleteAction')} disabled={!deleteEnabled}>삭제</Button>
        <span className={inboundClasses.ribbonSeparator} />
        <Button className={inboundClasses.ribbonTool} variant="subtle" size="sm" leftSection={<IconX size={15} />} onClick={closePage}>닫기</Button>
      </Group>,
    );
    return () => registerRibbon(null);
  }, [registerRibbon, closePage, loading, saving, copyEnabled, canExport, canSave, deleteEnabled]);

  const visibleTotals = useMemo(() => documents.reduce((sum, row) => {
    sum.line_count += Number(row.line_count || 0);
    ['cashamt', 'instrumentamt', 'bankamt', 'cardamt', 'totalamt', 'offsetamt', 'lossamt', 'chargeamt'].forEach((key) => { sum[key] += numeric(row[key]); });
    return sum;
  }, { line_count: 0, cashamt: 0, instrumentamt: 0, bankamt: 0, cardamt: 0, totalamt: 0, offsetamt: 0, lossamt: 0, chargeamt: 0 }), [documents]);
  const syncListScroll = (left) => {
    for (const element of [listTableRef.current, listSubtotalRef.current]) {
      if (element && Math.abs(element.scrollLeft - left) > 0.5) element.scrollLeft = left;
    }
  };
  // The list table stretches to the panel width (minus its vertical scrollbar), so the subtotal
  // table copies its rendered width to keep every column lined up.
  const hasDocuments = documents.length > 0;
  useEffect(() => {
    const listTable = listTableRef.current?.querySelector('table');
    const subtotalTable = listSubtotalRef.current?.querySelector('table');
    if (!listTable || !subtotalTable || typeof ResizeObserver === 'undefined') return undefined;
    const apply = () => {
      const width = `${listTable.getBoundingClientRect().width}px`;
      subtotalTable.style.width = width;
      subtotalTable.style.minWidth = width;
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(listTable);
    return () => observer.disconnect();
  }, [hasDocuments, summaryTableWidth]);

  return (
    <Box className={`${sharedClasses.pageShell} ${classes.page}`}>
      <Box component="nav" aria-label="현재 위치" className={inboundClasses.pageBreadcrumb}>
        <Group className={inboundClasses.breadcrumbTrail} gap={7}>
          <Text component="span" className={inboundClasses.breadcrumbParent}>수금/지급관리</Text>
          <Text component="span" className={inboundClasses.breadcrumbChevron}>›</Text>
          <Text component="span" className={inboundClasses.breadcrumbCurrent}>수금/지급 등록</Text>
        </Group>
        {!filterOpen && (
          <Button className={inboundClasses.receiptFilterToggle} variant="subtle" size="xs"
            leftSection={<IconFilter size={15} />} onClick={() => setFilterOpen(true)}>
            조회조건
          </Button>
        )}
      </Box>
      <Box className={`${inboundClasses.inboundWorkspace} ${classes.workspace}`}>
        <Box className={`${inboundClasses.inboundPrimaryColumn} ${classes.primary}`}>
          <Paper className={`${sharedClasses.panel} ${inboundClasses.topReceiptPanel} ${classes.listPanel}`} withBorder>
            <Group className={inboundClasses.topReceiptToolbar} justify="space-between" wrap="nowrap">
              <Group gap={8}><Text className={inboundClasses.sectionTitle} fw={700}>수금/지급 기본</Text><Badge variant="light" color="gray">{totalRows.toLocaleString()}건</Badge></Group>
            </Group>
            <Box ref={listTableRef} className={`${inboundClasses.topReceiptTable} ${classes.listTableWrap}`}>
              <Table className={`${sharedClasses.table} ${codeClasses.codeTable} ${classes.table}`} withTableBorder withColumnBorders
                style={{ width: 'max(100%, var(--code-table-min-width))', minWidth: 'var(--code-table-min-width)', tableLayout: 'fixed', '--code-table-min-width': `${summaryTableWidth}px` }}>
                <colgroup>{SUMMARY_COLUMNS.map((column, index) => <col key={column.key} style={{ width: summaryColumnWidths[index] }} />)}</colgroup>
                <Table.Thead><Table.Tr>{SUMMARY_COLUMNS.map((column, index) => <ResizableHeaderCell key={column.key} index={index} width={summaryColumnWidths[index]}
                  onResize={(event, columnIndex, width) => startColumnResize(event, columnIndex, width, summaryColumnWidths, setSummaryColumnWidths, 'summary')}>{column.label}</ResizableHeaderCell>)}</Table.Tr></Table.Thead>
                <Table.Tbody>
                  {documents.map((doc) => <ReceiptPaymentSummaryRow key={doc.receiptno} doc={doc}
                    selected={header.receiptno === doc.receiptno} onSelect={selectDocument} />)}
                </Table.Tbody>
              </Table>
              {!documents.length && <Box className={classes.emptyMessage}>{loading ? <Loader size="sm" color="red" /> : '검색된 수금/지급 전표가 없습니다.'}</Box>}
            </Box>
            <Box className={inboundClasses.topReceiptBottom}>
              {!!documents.length && <Box ref={listSubtotalRef} className={inboundClasses.topReceiptSubtotalViewport}>
                <Table className={`${inboundClasses.receiptFinderTable} ${inboundClasses.receiptSubtotalTable}`} withTableBorder withColumnBorders
                  style={{ width: `${summaryTableWidth}px`, minWidth: `${summaryTableWidth}px`, tableLayout: 'fixed' }}>
                  <colgroup>{SUMMARY_COLUMNS.map((column, index) => <col key={column.key} style={{ width: summaryColumnWidths[index] }} />)}</colgroup>
                  <Table.Tbody><Table.Tr>
                    {SUMMARY_COLUMNS.map((column, index) => <Table.Td key={column.key}
                      className={`${inboundClasses.topReceiptSubtotalCell} ${column.key === 'line_count' || Object.hasOwn(visibleTotals, column.key) ? inboundClasses.topReceiptSubtotalNumber : ''}`}>
                      {index === 0 ? '소계' : column.key === 'line_count' ? visibleTotals.line_count.toLocaleString()
                        : Object.hasOwn(visibleTotals, column.key) ? formatted(visibleTotals[column.key]) : ''}
                    </Table.Td>)}
                  </Table.Tr></Table.Tbody>
                </Table>
              </Box>}
              <Box ref={listHorizontalScrollRef} className={inboundClasses.topReceiptHorizontalScroll}
                onScroll={(event) => syncListScroll(event.currentTarget.scrollLeft)} aria-label="수금/지급 기본 가로 스크롤">
                <Box className={inboundClasses.topReceiptHorizontalContent} style={{ width: `${summaryTableWidth}px` }} />
              </Box>
            </Box>
            <Group className={`${inboundClasses.topReceiptPagination} ${classes.listFooter}`} justify="space-between" wrap="nowrap">
              <Select className={inboundClasses.topReceiptPageSize} aria-label="페이지당 표시 건수" data={PAGE_SIZE_OPTIONS} value={String(pageSize)} w={100} size="xs"
                onChange={(value) => { if (value) { const size = Number(value); setPageSize(size); void loadDocuments(1, filters, size); } }} />
              <Pagination size="sm" total={Math.max(1, Math.ceil(totalRows / pageSize))} value={page} onChange={(value) => void loadDocuments(value, filters, pageSize)} withEdges color="red" disabled={loading || !totalRows} />
            </Group>
          </Paper>

          <Paper className={`${sharedClasses.panel} ${inboundClasses.editorPanel} ${classes.detailPanel}`} withBorder>
            <Group className={classes.detailHeader} justify="space-between" wrap="wrap">
              <Group gap={8}><Text className={inboundClasses.sectionTitle} fw={700}>수금/지급 상세</Text><Badge variant="light" color="gray">{items.length}행</Badge>{header.receiptno && <Badge variant="light" color="gray">{header.receiptno}</Badge>}</Group>
            </Group>
            <Box className={`${inboundClasses.sharedReceiptFields} ${classes.headerFields}`}>
              <Box className={inboundClasses.sharedReceiptField}><Text className={classes.fieldLabel}>수금/지급일 <i>*</i></Text><ErpDateInput type="date" value={header.receiptdate} disabled={saving || isSavedDocument} onChange={(event) => setHeader((v) => ({ ...v, receiptdate: event.currentTarget.value }))} /></Box>
              <Box className={inboundClasses.sharedReceiptField}><Text className={classes.fieldLabel}>구분 <i>*</i></Text><Select data={TRANSACTION_OPTIONS} value={header.transactiontype} disabled={saving || isSavedDocument || hasHeldRows} title={hasHeldRows ? '보유증권 행이 있어 구분을 바꿀 수 없습니다.' : undefined} onChange={(value) => setHeader((v) => ({ ...v, transactiontype: value || 'RECEIPT' }))} /></Box>
              <Box className={`${inboundClasses.sharedReceiptField} ${classes.customerField}`}><Text className={classes.fieldLabel}>거래처 <i>*</i></Text>
                <Box onDoubleClick={() => { if (!saving && !isSavedDocument) setCustomerPickerOpen(true); }}>
                  {/* 저장된 전표는 읽기 전용 → 거래처 목록(수백 건)을 그리지 않고 이름만 표시해 행 선택 반응을 빠르게 */}
                  {isSavedDocument ? <TextInput aria-label="거래처" value={header.customname || header.customcode || ''} disabled readOnly />
                    : <HeaderCustomerSelect options={customerOptions} value={header.customcode || null} disabled={saving} onChange={pickHeaderCustomer} />}
                </Box>
              </Box>
              <Box className={inboundClasses.sharedReceiptField}><Text className={classes.fieldLabel}>담당자</Text><ReceiptPaymentHeaderTextInput label="담당자" value={header.manager} maxLength={100} disabled={saving || isSavedDocument} onCommit={(value) => updateHeaderField('manager', value)} /></Box>
              <Box className={`${inboundClasses.sharedReceiptField} ${classes.descriptionField}`}><Text className={classes.fieldLabel}>비고</Text><ReceiptPaymentHeaderTextInput label="비고" value={header.description} maxLength={500} disabled={saving || isSavedDocument} onCommit={(value) => updateHeaderField('description', value)} /></Box>
            </Box>
            <Group className={classes.detailToolbar} justify="space-between" wrap="nowrap">
              <Group gap={8}><Text fw={700}>금액 상세</Text><Badge variant="light" color="gray">{items.length}행</Badge>{selectedRows.length > 0 && <Badge variant="light" color="gray">{selectedRows.length}개 선택</Badge>}</Group>
              <Button size="xs" variant="light" color="red" leftSection={<IconSearch size={14} />}
                disabled={saving || isSavedDocument || header.transactiontype !== 'PAYMENT'}
                title={header.transactiontype !== 'PAYMENT' ? '지급 전표에서 사용할 수 있습니다.' : undefined}
                onClick={() => setHeldPickerOpen(true)}>보유증권 불러오기</Button>
            </Group>
            <Box ref={detailTableWrapRef} className={`${codeClasses.tableWrap} ${classes.detailTableWrap}`} onKeyDown={handleDetailTableKeyDown} onPaste={handleDetailTablePaste}>
              <Table className={`${sharedClasses.table} ${codeClasses.codeTable} ${classes.table}`} withTableBorder withColumnBorders
                style={{ width: 'max(100%, var(--code-table-min-width))', minWidth: 'var(--code-table-min-width)', tableLayout: 'fixed', '--code-table-min-width': `${detailTableWidth}px` }}>
                <colgroup>{detailColumnWidths.map((width, index) => <col key={index} style={{ width }} />)}</colgroup>
                <Table.Thead><Table.Tr>
                  {DETAIL_HEADER_LABELS.map((label, index) => <ResizableHeaderCell key={`${label}-${index}`} index={index} width={detailColumnWidths[index]}
                    ta={index === 0 || index === 1 ? 'center' : undefined}
                    onResize={(event, columnIndex, width) => startColumnResize(event, columnIndex, width, detailColumnWidths, setDetailColumnWidths, 'detail')}>
                    {index === 0
                      ? <input type="checkbox" aria-label="전체 행 선택" checked={items.length > 0 && selectedRows.length === items.length} disabled={!items.length || saving || isSavedDocument} onChange={(event) => setSelectedRows(event.currentTarget.checked ? items.map((row) => row.id) : [])} />
                      : label}
                  </ResizableHeaderCell>)}
                </Table.Tr></Table.Thead>
                <Table.Tbody>{items.map((row, index) => isSavedDocument ? <ReceiptPaymentReadonlyRow key={row.id} row={row} index={index} /> : <ReceiptPaymentDetailRow
                  key={row.id}
                  row={row}
                  index={index}
                  selected={selectedRows.includes(row.id)}
                  disabled={saving || isSavedDocument}
                  issuerCompanyOptions={issuerCompanyOptions}
                  bankOptions={bankOptions}
                  onToggle={toggleRow}
                  onUpdate={updateDetail}
                  onOpenPicker={openDetailPicker}
                />)}</Table.Tbody>
              </Table>
              {!items.length && <Box className={classes.emptyDetailMessage}>{detailLoading ? <Loader size="sm" color="red" /> : '상단의 추가를 눌러 수금/지급 전표를 등록하세요.'}</Box>}
            </Box>
            <Group className={`${sharedClasses.footer} ${codeClasses.tableFooter} ${classes.detailFooter}`} justify="flex-end" wrap="wrap">
              <Text size="xs" fw={700}>수표/어음 {formatted(totals.instrumentamt)} · 현금 {formatted(totals.cashamt)} · 은행예금 {formatted(totals.bankamt)} · 카드 {formatted(totals.cardamt)} · 합계 {formatted(totals.totalamt)} · 상계 {formatted(totals.offsetamt)} · 잡손실 {formatted(totals.lossamt)} · 과금 {formatted(totals.chargeamt)}</Text>
            </Group>
          </Paper>
        </Box>

        {filterOpen && <ReceiptPaymentFilterPanel initialValues={filterInputsRef.current} transactionOptions={TRANSACTION_FILTER_OPTIONS} onSearch={runSearch} onClose={closeFilter} />}
      </Box>
      <Modal opened={deleteOpen} onClose={() => !saving && setDeleteOpen(false)} title="수금/지급 전표 삭제" centered size="sm">
        <Stack gap="md"><Text size="sm" c="dimmed">{header.receiptno} 전표와 상세 행을 삭제합니다. 삭제한 전표는 복구할 수 없습니다.</Text>
          <Group justify="flex-end"><Button variant="default" onClick={() => setDeleteOpen(false)} disabled={saving}>취소</Button><Button color="red" leftSection={<IconTrash size={15} />} onClick={() => void deleteDocument()} loading={saving}>삭제</Button></Group>
        </Stack>
      </Modal>
      <ReceiptCustomerPickerModal opened={customerPickerOpen} onClose={() => setCustomerPickerOpen(false)} onSelect={chooseCustomer} />
      <ReceiptCustomerPickerModal opened={detailPicker?.field === 'issuercompany'} onClose={() => setDetailPicker(null)} onSelect={selectDetailCustomer} />
      <HeldInstrumentPickerModal opened={heldPickerOpen} onClose={() => setHeldPickerOpen(false)} excludedKeys={usedSourceKeys} onApply={applyHeldInstruments} />
      <ReceiptBankPickerModal opened={detailPicker?.field === 'custodybank'} onClose={() => setDetailPicker(null)} options={bankOptions} onSelect={selectDetailBank} />
    </Box>
  );
}
