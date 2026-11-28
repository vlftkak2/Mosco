import { isApprovalPending, notifyApprovalPending } from '../../utils/approval';
import { createContext, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { usePageActivation } from '../../components/common/usePageReactivated';
import ErpDateInput from '../../components/common/ErpDateInput';
import { SelectPickerModal } from '../../components/common/PickerModal';
import { ActionIcon, Badge, Box, Button, Group, Loader, Pagination, Paper, Popover, Select, Stack, Table, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconBox, IconBuildingStore, IconCopy, IconDeviceFloppy, IconFileSpreadsheet, IconFilter, IconListDetails,
  IconFileInvoice, IconPlus, IconSearch, IconTrash, IconTruckDelivery, IconX,
} from '@tabler/icons-react';
import { TableVirtuoso } from 'react-virtuoso';
import { loadXLSXOrNotify } from '../../utils/excelSafe';
import { applyExcelHeaderStyle } from '../../utils/excelHeaderStyle';
import sharedClasses from '../../styles/pages/ManagementShared.module.css';
import simpleTheme from '../../styles/pages/SimpleTheme.module.css';
import codeClasses from '../../styles/pages/CodeMasterPage.module.css';
import classes from '../../styles/pages/OutboundRegister.module.css';
import inboundClasses from '../../styles/pages/InboundRegister.module.css';
import { PageRibbonContext } from '../../components/layout/MainLayout';
import OutboundStockPickerModal from './OutboundStockPickerModal';
import OutboundPrintDocument from './OutboundPrintDocument';
import ConfirmDeleteModal from '../../components/common/ConfirmDeleteModal';
import { cachedDateFormat, kstDate } from '../../utils/dateFormat';
import { useUnsavedChanges } from '../../utils/dirtyRegistry';
import { apiErrorMessage } from '../../utils/apiError';
import { useRequestKey } from '../../utils/requestKey';
import { fetchAllPages, loadMaster, peekMaster } from '../../utils/masterCache';

// 코드 목록 캐시 키 (매출등록은 코드 속성까지 쓰므로 매입등록 캐시와 따로)
const outboundCodeKey = (groupcode) => `code-props:${groupcode}`;
const cachedOutboundUnitOptions = () => ({
  price: peekMaster(outboundCodeKey('PRICE_UNIT')) || [],
  quantity: peekMaster(outboundCodeKey('QTY')) || [],
  warehouse: peekMaster(outboundCodeKey('WAREHOUSE')) || [],
});

const PAGE_SIZE_OPTIONS = [
  { value: '15', label: '15개씩' }, { value: '50', label: '50개씩' },
  { value: '100', label: '100개씩' }, { value: '200', label: '200개씩' },
];
const createDefaultReceiptFilters = () => {
  const today = kstDate();
  const year = today.getFullYear();
  const month = today.getMonth();
  const pad = (value) => String(value).padStart(2, '0');
  return {
    receiptno: '',
    customer: '',
    customcode: '',
    customname: '',
    warehouse: '',
    date_from: `${year}-${pad(month + 1)}-01`,
    date_to: `${year}-${pad(month + 1)}-${pad(new Date(year, month + 1, 0).getDate())}`,
  };
};
const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });
const localDate = () => {
  const date = kstDate();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const EMPTY_HEADER = { receiptno: '', receptdate: localDate(), customcode: '', customname: '', warehousecode: '', warehousecodename: '', manager: '', destination: '', description: '', manager_dirty: false, destination_dirty: false, other_dirty: false };
const DETAIL_FIELDS = [
  { key: 'productname', label: '제품번호', width: 100 },
  { key: 'itemname', label: '품명', width: 100 },
  { key: 'materialname', label: '강종', width: 100 },
  { key: 'surfacename', label: '표면', width: 100 },
  { key: 'myrtle', label: '도금량(g/㎡)', width: 80 },
  { key: 'thickness', label: '두께', width: 70 },
  { key: 'width', label: '폭', width: 70 },
  { key: 'length', label: '길이', width: 70 },
  { key: 'qty', label: '수량', width: 70, required: true },
  { key: 'weight', label: '중량', width: 90, required: true },
  // 조정(kg): 중량에 더하거나 뺄 중량(+/-). 총중량 = 중량 + 조정 → 현재고·수불장·매출금액 기준
  { key: 'adjweight', label: '조정(kg)', width: 80 },
  { key: 'totalweight', label: '총중량', width: 95 },
  { key: 'unitprice', label: '판매단가', width: 110, required: true },
  { key: 'supplyamt', label: '공급가', width: 110 },
  { key: 'vat', label: '부가세', width: 110 },
  { key: 'unitamt', label: '합계금액', width: 110 },
  // 창고: 담은 재고의 창고 (보기 전용, 저장·재고 처리는 서버가 원천 재고 창고로 함)
  { key: 'warehousecodename', label: '창고', width: 100 },
  { key: 'sourcecustomname', label: '매입처', width: 100 },
  { key: 'current_qty', label: '현재고수량', width: 80 },
  { key: 'current_weight', label: '현재고중량(kg)', width: 100 },
  { key: 'qtyunit', label: '수량단위', width: 70 },
  { key: 'unit', label: '단가기준', width: 70, required: true },
  { key: 'itemcode', label: '품목코드', width: 70 },
  { key: 'receiptdate', label: '재고입고일자', width: 100 },
  { key: 'sourcetype', label: '재고구분', width: 90 },
  { key: 'stocksourceno', label: '원천전표', width: 160 },
  { key: 'stocksourceline', label: '원천순번', width: 90 },
  { key: 'description', label: '비고', width: 180 },
];
const RECEIPT_COLUMNS = [
  { key: 'receptdate', label: '매출일자', width: 100, minWidth: 100 },
  { key: 'customname', label: '매출처', width: 100, minWidth: 100 },
  { key: 'manager', label: '담당자', width: 80, minWidth: 70 },
  { key: 'destination', label: '착지', width: 120, minWidth: 80 },
  { key: 'total_qty', label: '수량', width: 70, minWidth: 70, align: 'right' },
  { key: 'total_weight', label: '총중량', width: 70, minWidth: 70, align: 'right' },
  { key: 'supply_amount', label: '공급가', width: 110, minWidth: 110, align: 'right' },
  { key: 'vat_amount', label: '부가세', width: 110, minWidth: 110, align: 'right' },
  { key: 'total_amount', label: '합계금액', width: 110, minWidth: 110, align: 'right' },
  { key: 'warehousecodename', label: '창고', width: 70, minWidth: 70 },
  { key: 'other_cost_amount', label: '기타비용', width: 110, minWidth: 110, align: 'right' },
  { key: 'qtyunit', label: '수량단위', width: 80, minWidth: 80 },
  { key: 'unit', label: '단가기준', width: 80, minWidth: 80 },
  { key: 'receiptno', label: '매출전표', width: 160, minWidth: 140 },
  { key: 'created_at', label: '등록일자', width: 120, minWidth: 110 },
  { key: 'created_by', label: '등록자', width: 80, minWidth: 70 },
  { key: 'description', label: '비고', width: 175, minWidth: 175 },
];
// 등록일자: YYYY-MM-DD HH:mm (한국 시간)
const registeredAtText = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const parts = Object.fromEntries(cachedDateFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
};
const fitReceiptColumnWidth = (label, values, baseWidth, minWidth, maxWidth = 420) => {
  const measure = (value) => Array.from(String(value ?? '')).reduce((width, character) => width + (character.charCodeAt(0) > 255 ? 11 : 6.5), 0) + 20;
  const contentWidth = Math.max(measure(label), ...values.map(measure));
  return Math.max(minWidth, Math.min(maxWidth, Math.max(baseWidth, contentWidth)));
};
const READ_ONLY_DETAIL_FIELDS = new Set(['sourcetype', 'receiptdate', 'stocksourceno', 'stocksourceline', 'sourcecustomname', 'itemcode', 'itemname', 'productname', 'materialname', 'surfacename', 'myrtle', 'thickness', 'width', 'length', 'qty', 'weight', 'totalweight', 'warehousecodename', 'current_qty', 'qtyunit', 'current_weight', 'unit', 'unitprice', 'supplyamt', 'vat', 'unitamt', 'manager']);
const NAVIGABLE_FIELDS = DETAIL_FIELDS.map(({ key }) => key).filter((key) => !READ_ONLY_DETAIL_FIELDS.has(key));
const EDITABLE_FIELDS = NAVIGABLE_FIELDS;
const EMPTY_DETAIL = { sourcetype: '', receiptdate: '', receptdate: localDate(), stocksourceno: '', stocksourcetype: '', stocksourceline: '', sourcecustomname: '', customcode: '', customname: '', itemcode: '', itemname: '', productname: '', materialcode: '', materialname: '', surfacecode: '', surfacename: '', myrtle: '', thickness: '', width: '', length: '', qty: '', qtyunit: '', warehousecode: '', warehousecodename: '', current_qty: '0', current_weight: '0', weight: '', adjweight: '', unit: '', unitprice: '', supplyamt: '', vat: '', unitamt: '', manager: '', description: '' };
const masterPasteErrorKey = (rowId, field) => `${rowId}:${field}`;

const errorMessage = (error) => {
  const detail = error.response?.data?.detail;
  if (Array.isArray(detail)) return detail.slice(0, 5).map((item) => {
    const location = Array.isArray(item.loc) ? item.loc : [];
    const itemIndex = location.indexOf('items');
    const field = location.at(-1);
    const headerFields = { receptdate: '\uB9E4\uCD9C\uC77C\uC790', customcode: '\uB9E4\uCD9C\uCC98', customname: '\uB9E4\uCD9C\uCC98', warehousecode: '\uCC3D\uACE0', warehousecodename: '\uCC3D\uACE0', manager: '\uB2F4\uB2F9\uC790', destination: '\uCC29\uC9C0', description: '\uBE44\uACE0', receiptno: '\uB9E4\uCD9C\uC804\uD45C\uBC88\uD638' };
    const detailFields = { receptdate: '\uB9E4\uCD9C\uC77C\uC790', customcode: '\uB9E4\uCD9C\uCC98', customname: '\uB9E4\uCD9C\uCC98', warehousecode: '\uCC3D\uACE0', warehousecodename: '\uCC3D\uACE0', itemcode: '\uD488\uBAA9\uCF54\uB4DC', itemname: '\uD488\uBA85', productname: '\uC81C\uD488\uBC88\uD638', qty: '\uB9E4\uCD9C\uC218\uB7C9', qtyunit: '\uC218\uB7C9\uB2E8\uC704', weight: '\uCD1D\uC911\uB7C9', adjweight: '\uC870\uC815(kg)', unit: '\uB2E8\uAC00\uAE30\uC900', unitprice: '\uD310\uB9E4\uB2E8\uAC00', stocksourcetype: '\uC6D0\uCC9C \uC7AC\uACE0 \uAD6C\uBD84', stocksourceno: '\uC6D0\uCC9C \uC804\uD45C\uBC88\uD638', stocksourceline: '\uC6D0\uCC9C \uC21C\uBC88' };
    const rowNumber = itemIndex >= 0 && Number.isInteger(Number(location[itemIndex + 1]))
      ? Number(location[itemIndex + 1]) + 1 : null;
    const label = itemIndex >= 0 ? detailFields[field] : headerFields[field];
    if (label) return rowNumber ? `${rowNumber}\uD589 ${label} \uD56D\uBAA9\uC744 \uD655\uC778\uD574 \uC8FC\uC138\uC694.` : `${label} \uD56D\uBAA9\uC744 \uC785\uB825\uD574 \uC8FC\uC138\uC694.`;
    return rowNumber ? `${rowNumber}\uD589 \uC785\uB825 \uD56D\uBAA9\uC744 \uD655\uC778\uD574 \uC8FC\uC138\uC694.` : '\uC785\uB825 \uD56D\uBAA9\uC744 \uD655\uC778\uD574 \uC8FC\uC138\uC694.';
  }).join(' / ');
  if (typeof detail === 'string') return detail
    .replaceAll('customcode', '\uB9E4\uCD9C\uCC98')
    .replaceAll('warehousecode', '\uCC3D\uACE0')
    .replaceAll('receptdate', '\uB9E4\uCD9C\uC77C\uC790');
  return apiErrorMessage(error, '\uB9E4\uCD9C \uC694\uCCAD\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.');
};
const makeDetail = (source = EMPTY_DETAIL, lineNo = null) => ({
  ...EMPTY_DETAIL,
  ...source,
  id: source.id || `line-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  lineno: lineNo,
  is_new: lineNo == null,
  is_dirty: false,
});
// 조정(kg)은 부호(+/-)가 있는 숫자
const cleanSignedInput = (value) => {
  const text = String(value ?? '').replace(/,/g, '').trim();
  const negative = text.startsWith('-');
  const digits = text.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1');
  return negative ? `-${digits}` : digits;
};
const signedNumber = (value) => Number(cleanSignedInput(value)) || 0;
// 총중량 = 중량 + 조정 (소수 3자리)
const totalWeightOf = (row) => {
  const weight = Number(String(row.weight ?? '').replace(/,/g, ''));
  if (!String(row.weight ?? '').trim() || !Number.isFinite(weight)) return NaN;
  return Math.round((weight + signedNumber(row.adjweight)) * 1000) / 1000;
};
const amountOf = (row, priceUnits = []) => {
  if (!String(row.unitprice ?? '').trim()) return '';
  const weight = totalWeightOf(row);
  const price = Number(row.unitprice);
  const qty = Number(row.qty);
  const length = Number(row.length);
  if (!Number.isFinite(weight) || !Number.isFinite(price)) return '';
  const unitName = priceUnits.find((option) => option.code === row.unit)?.name || '';
  const unitToken = `${row.unit || ''} ${unitName}`.toLocaleUpperCase();
  const quantity = /TON|톤/.test(unitToken) ? weight / 1000
    : /QTY|수량|^EA\b/.test(unitToken) ? qty
      : /LENGTH|길이|\bM(?:ETER)?\b/.test(unitToken) ? length : weight;
  if (!Number.isFinite(quantity)) return '';
  return (quantity * price).toFixed(2);
};
const vatAmountOf = (row, priceUnits = []) => {
  const supplyText = amountOf(row, priceUnits);
  if (supplyText === '') return '';
  const supply = Number(supplyText);
  return Number.isFinite(supply) ? (Math.round(supply * 0.1 * 100) / 100).toFixed(2) : '';
};
const totalAmountOf = (row, priceUnits = []) => {
  const supplyText = amountOf(row, priceUnits);
  const vatText = vatAmountOf(row, priceUnits);
  if (supplyText === '' || vatText === '') return '';
  return (Number(supplyText) + Number(vatText)).toFixed(2);
};
const formatAmount = (value) => {
  const amount = Number(value);
  if (value === '' || !Number.isFinite(amount)) return '';
  const isWholeAmount = Number.isInteger(amount);
  return amount.toLocaleString(undefined, {
    minimumFractionDigits: isWholeAmount ? 0 : 2,
    maximumFractionDigits: 2,
  });
};
const formatWon = (value) => `${formatAmount(value)}원`;
// 매출등록 엑셀에서 숫자로 넣는 칸
const EXCEL_NUMBER_KEYS = new Set(['myrtle', 'thickness', 'width', 'length', 'qty', 'weight', 'adjweight', 'totalweight', 'unitprice', 'supplyamt', 'vat', 'unitamt', 'stocksourceline']);
const NUMERIC_FIELDS = new Set(['thickness', 'width', 'length', 'qty', 'weight', 'adjweight', 'unitprice']);
const cleanNumericInput = (value) => String(value ?? '').replace(/,/g, '').replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1');
// 기타비용 공급가 · 부가세 저장값: 소수 둘째 자리까지 (서버 검증과 같음 · 예전 자료에 셋째 자리가 있어도 반올림해 보낸다)
const expenseAmount2 = (value) => {
  const amount = Number(cleanNumericInput(value));
  return Number.isFinite(amount) && amount ? String(Math.round((amount + Number.EPSILON) * 100) / 100) : '0';
};
const formatNumericInput = (value) => {
  const raw = cleanNumericInput(value);
  if (!raw) return '';
  const [integer, ...decimalParts] = raw.split('.');
  const groupedInteger = (integer || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return decimalParts.length ? `${groupedInteger}.${decimalParts.join('')}` : groupedInteger;
};
const trimAmount = (value) => {
  const text = String(value ?? '').replace(/,/g, '').trim();
  const amount = Number(text);
  return text !== '' && Number.isFinite(amount) ? String(amount) : text;
};
export const makeExpense = (expense = {}) => ({
  id: expense.id || `expense-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  costcode: expense.costcode || '', costname: expense.costname || '',
  // 서버 금액(예: "100.00")은 끝의 0 을 떼어 보여 준다
  supplyamt: trimAmount(expense.supplyamt), vat: trimAmount(expense.vat),
  vat_manual: expense.vat_manual ?? false,
  customcode: expense.customcode || '', customname: expense.customname || '',
  purchaseyn: expense.purchaseyn || 'N', description: expense.description || '',
  is_new: expense.is_new ?? true, is_dirty: expense.is_dirty ?? true,
});

export const ExpenseCostAutocompleteCell = memo(function ExpenseCostAutocompleteCell({ row, options, disabled, onSelect, onDoubleClick, inputRef }) {
  const [draft, setDraft] = useState(row.costname || '');
  const [editing, setEditing] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const editedRef = useRef(false);
  const query = draft.trim().toLocaleLowerCase();
  const matches = useMemo(() => {
    if (!query) return showAll ? options.slice(0, 8) : [];
    return options.filter((option) => `${option.name || ''} ${option.code || ''}`.toLocaleLowerCase().includes(query)).slice(0, 8);
  }, [options, query, showAll]);
  const opened = editing && !disabled && matches.length > 0;

  // Same as the former effect on [row.costcode, row.costname, editing], applied during render.
  const [syncedCost, setSyncedCost] = useState({ costcode: row.costcode, costname: row.costname, editing });
  if (syncedCost.costcode !== row.costcode || syncedCost.costname !== row.costname || syncedCost.editing !== editing) {
    setSyncedCost({ costcode: row.costcode, costname: row.costname, editing });
    if (!editing) setDraft(row.costname || '');
  }

  useEffect(() => {
    if (editing && document.activeElement !== inputRef?.current) inputRef?.current?.focus();
  }, [editing, inputRef]);

  const choose = (option) => {
    onSelect(option);
    setDraft(option.name || '');
    setEditing(false);
    setShowAll(false);
    setActiveIndex(-1);
    editedRef.current = false;
  };

  return <Popover opened={opened} position="bottom-start" width="target" withinPortal shadow="none" offset={0} zIndex={500} transitionProps={{ duration: 0 }}>
    <Popover.Target>
      <div className={classes.customerAutocompleteTarget}>
        <input ref={inputRef} className={`${codeClasses.cellInput} ${inboundClasses.itemCodePickerInput} ${inboundClasses.itemNameSearchInput} ${classes.customerAutocompleteInput} ${classes.expenseCostInput}`}
          aria-label="비용 구분" aria-haspopup="listbox" aria-expanded={opened} value={draft} disabled={disabled}
          onFocus={(event) => { setEditing(true); setShowAll(false); setActiveIndex(-1); event.currentTarget.select(); }}
          onBlur={() => {
            const normalized = draft.trim().toLocaleLowerCase();
            if (!normalized) onSelect(null);
            else {
              const exact = options.filter((option) => [option.name, option.code].some((value) => String(value || '').trim().toLocaleLowerCase() === normalized));
              if (exact.length === 1) choose(exact[0]);
              else if (editedRef.current) setDraft(row.costname || '');
            }
            setEditing(false);
            setShowAll(false);
            setActiveIndex(-1);
          }}
          onChange={(event) => { setDraft(event.currentTarget.value); setEditing(true); setShowAll(false); setActiveIndex(-1); editedRef.current = true; }}
          onClick={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            if (!disabled && bounds.right - event.clientX <= 27) { setEditing(true); setShowAll(true); setActiveIndex(-1); }
          }}
          onKeyDown={(event) => {
            if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && opened) {
              event.preventDefault();
              setActiveIndex((current) => event.key === 'ArrowDown' ? (current + 1) % matches.length : (current - 1 + matches.length) % matches.length);
            } else if (event.key === 'Enter' && opened) {
              event.preventDefault();
              choose(matches[activeIndex >= 0 ? activeIndex : 0]);
            } else if (event.key === 'Escape') {
              event.preventDefault();
              setDraft(row.costname || '');
              setEditing(false);
              setShowAll(false);
              setActiveIndex(-1);
            } else if (event.key === 'Tab' && editedRef.current) {
              const normalized = draft.trim().toLocaleLowerCase();
              const exact = options.filter((option) => [option.name, option.code].some((value) => String(value || '').trim().toLocaleLowerCase() === normalized));
              const option = opened && activeIndex >= 0 ? matches[activeIndex] : exact.length === 1 ? exact[0] : null;
              if (option) choose(option);
              else if (!normalized) onSelect(null);
              else setDraft(row.costname || '');
            }
          }}
          onDoubleClick={() => { if (!disabled) onDoubleClick?.(); }} />
      </div>
    </Popover.Target>
    <Popover.Dropdown className={classes.stockCustomerSuggestions}>
      <div role="listbox" aria-label="비용 구분 검색 결과">
        {matches.map((option, index) => <button key={option.code} type="button" role="option" aria-selected={index === activeIndex}
          className={classes.stockCustomerSuggestion} style={index === activeIndex ? { background: '#edf3f8' } : undefined}
          onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(option)}>
          <span>{option.name || option.code}</span>
        </button>)}
      </div>
    </Popover.Dropdown>
  </Popover>;
});

export const ExpenseCustomerAutocompleteCell = memo(function ExpenseCustomerAutocompleteCell({ expenseId, value, disabled, onSelect, onOpenPicker }) {
  const [draft, setDraft] = useState(value || '');
  const [editing, setEditing] = useState(false);
  const [customers, setCustomers] = useState([]);
  const [customersQuery, setCustomersQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const requestIdRef = useRef(0);
  const hasEditedRef = useRef(false);
  const keyboardSelectionRef = useRef(false);
  const skipBlurCommitRef = useRef(false);
  const query = String(draft || '').trim();
  const matches = useMemo(() => {
    const normalized = query.toLocaleLowerCase();
    if (!normalized || !customersQuery || !normalized.startsWith(customersQuery.toLocaleLowerCase())) return [];
    return customers.filter((customer) => [customer.customername, customer.customercode]
      .some((candidate) => String(candidate || '').toLocaleLowerCase().includes(normalized)));
  }, [customers, customersQuery, query]);
  const opened = editing && !disabled && matches.length > 0;

  useEffect(() => {
    if (!editing || disabled || !query) return undefined;
    const controller = new AbortController();
    const requestId = ++requestIdRef.current;
    const load = async () => {
      try {
        const { data } = await axios.get('/api/list', {
          ...authConfig(),
          params: { search_keyword: query, status: 'Y', page: 1, page_size: 8, include_total: false },
          signal: controller.signal,
        });
        if (!controller.signal.aborted && requestId === requestIdRef.current) {
          setCustomers(data.data || []);
          setCustomersQuery(query);
          setActiveIndex(-1);
        }
      } catch { /* 자동완성 실패 시 목록만 닫아 둡니다. */ }
    };
    void load();
    return () => controller.abort();
  }, [editing, disabled, query]);

  // Same as the former effect on [editing, value], applied during render.
  const [syncedCustomer, setSyncedCustomer] = useState({ editing, value });
  if (syncedCustomer.editing !== editing || syncedCustomer.value !== value) {
    setSyncedCustomer({ editing, value });
    if (!editing) setDraft(value || '');
  }

  const choose = (customer) => {
    requestIdRef.current += 1;
    hasEditedRef.current = false;
    keyboardSelectionRef.current = false;
    onSelect(expenseId, customer);
    setDraft(customer.customername || '');
    setEditing(false);
    setActiveIndex(-1);
  };

  return <Popover opened={opened} position="bottom-start" width="target" withinPortal shadow="none" offset={0} zIndex={500} transitionProps={{ duration: 0 }}>
    <Popover.Target>
      <div className={classes.customerAutocompleteTarget}>
        <input className={`${codeClasses.cellInput} ${inboundClasses.itemCodePickerInput} ${inboundClasses.itemNameSearchInput} ${classes.customerAutocompleteInput} ${classes.expenseCostInput}`}
          aria-label="비용 거래처" aria-haspopup="listbox" aria-expanded={opened} value={draft} disabled={disabled}
          onFocus={(event) => { hasEditedRef.current = false; keyboardSelectionRef.current = false; setEditing(true); setActiveIndex(-1); event.currentTarget.select(); }}
          onChange={(event) => { hasEditedRef.current = true; keyboardSelectionRef.current = false; setDraft(event.currentTarget.value); setEditing(true); setActiveIndex(-1); }}
          onBlur={() => {
            if (skipBlurCommitRef.current) { skipBlurCommitRef.current = false; return; }
            const normalized = query.toLocaleLowerCase();
            const exact = customers.filter((customer) => [customer.customername, customer.customercode]
              .some((candidate) => String(candidate || '').trim().toLocaleLowerCase() === normalized));
            if (exact.length === 1) choose(exact[0]);
            else { setDraft(value || ''); setEditing(false); setActiveIndex(-1); }
          }}
          onClick={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            if (!disabled && bounds.right - event.clientX <= 27) onOpenPicker(expenseId);
          }}
          onKeyDown={(event) => {
            if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && opened) {
              event.preventDefault();
              keyboardSelectionRef.current = true;
              setActiveIndex((current) => event.key === 'ArrowDown'
                ? (current + 1) % matches.length : (current - 1 + matches.length) % matches.length);
            } else if (event.key === 'Tab' && hasEditedRef.current) {
              const customer = opened && keyboardSelectionRef.current && activeIndex >= 0 ? matches[activeIndex] : null;
              skipBlurCommitRef.current = true;
              if (customer) choose(customer);
              else { setDraft(''); setEditing(false); setActiveIndex(-1); hasEditedRef.current = false; keyboardSelectionRef.current = false; }
            } else if (event.key === 'Enter' && opened) {
              event.preventDefault();
              choose(matches[activeIndex >= 0 ? activeIndex : 0]);
            } else if (event.key === 'Escape') {
              event.preventDefault(); setDraft(value || ''); setEditing(false); setActiveIndex(-1);
            }
          }}
          onDoubleClick={() => { if (!disabled) onOpenPicker(expenseId); }} />
      </div>
    </Popover.Target>
    <Popover.Dropdown className={classes.stockCustomerSuggestions}>
      <div role="listbox" aria-label="비용 거래처 검색 결과">
        {matches.map((customer, index) => <button key={customer.customercode} type="button" role="option" aria-selected={index === activeIndex}
          className={classes.stockCustomerSuggestion} style={index === activeIndex ? { background: '#edf3f8' } : undefined}
          onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(customer)}>
          <span>{customer.customername}</span>
        </button>)}
      </div>
    </Popover.Dropdown>
  </Popover>;
});

// 기타비용 부가세 = 공급가 × 10% (소수 둘째 자리 반올림). 공급가를 입력하는 동안 미리보기와 저장 값이 같은 규칙을 쓴다.
const expenseVatOf = (supplyText) => {
  const supply = Number(cleanNumericInput(supplyText)) || 0;
  // 끝의 .00 은 붙이지 않는다 (100 → "100", 12.5 → "12.5"). 매입등록 기타비용과 같은 표시
  return String(Math.round((supply * 0.1 + Number.EPSILON) * 100) / 100);
};

// onDraftChange: 입력 중인 값을 알려 준다 (칸을 벗어나면 null). 공급가 입력 중 부가세·합계 미리보기용.
export const ExpenseNumericCell = memo(function ExpenseNumericCell({ expenseId, field, value, disabled, onCommit, onDraftChange }) {
  const [draft, setDraft] = useState(formatNumericInput(value));
  const [editing, setEditing] = useState(false);
  // Same as the former effect on [value]: follow outside changes unless the user is typing.
  const [syncedValue, setSyncedValue] = useState(value);
  if (syncedValue !== value) {
    setSyncedValue(value);
    if (!editing) setDraft(formatNumericInput(value));
  }
  return <input className={`${codeClasses.cellInput} ${inboundClasses.amountInput}`} aria-label={field === 'supplyamt' ? '공급가' : '부가세'}
    inputMode="decimal" value={draft} disabled={disabled}
    onFocus={() => { setEditing(true); }}
    onChange={(event) => {
      // 공급가·부가세는 소수 둘째 자리까지만 입력된다 (셋째 자리부터는 받지 않는다)
      const next = formatNumericInput(event.currentTarget.value).replace(/(\.\d{2})\d+$/, '$1');
      setDraft(next);
      onDraftChange?.(cleanNumericInput(next));
    }}
    onBlur={() => {
      setEditing(false);
      onDraftChange?.(null);
      const normalized = cleanNumericInput(draft);
      setDraft(formatNumericInput(normalized));
      if (normalized !== cleanNumericInput(value)) onCommit(expenseId, field, normalized);
    }} />;
});

export const ExpenseDescriptionCell = memo(function ExpenseDescriptionCell({ expenseId, value, disabled, onCommit }) {
  const [draft, setDraft] = useState(value || '');
  const [editing, setEditing] = useState(false);
  // Same as the former effect on [value]: follow outside changes unless the user is typing.
  const [syncedValue, setSyncedValue] = useState(value);
  if (syncedValue !== value) {
    setSyncedValue(value);
    if (!editing) setDraft(value || '');
  }
  return <TextInput size="xs" value={draft} maxLength={500} disabled={disabled}
    onFocus={() => { setEditing(true); }}
    onChange={(event) => setDraft(event.currentTarget.value)}
    onBlur={() => {
      setEditing(false);
      if (draft !== (value || '')) onCommit(expenseId, 'description', draft);
    }} />;
});

// 기타비용 표 방향키 이동 (매입·매출 공용).
// 표를 감싼 요소의 onKeyDownCapture 하나로 처리하고, 상태를 바꾸지 않고 다음 칸 입력칸에 포커스만 옮긴다 (다시 그리기 없음).
// - 자동완성·예/아니오 목록이 열려 있으면 위/아래는 기존처럼 목록 이동에 쓴다.
// - 좌/우는 커서가 글자 맨 앞/맨 끝(또는 전체 선택)일 때만 옆 칸으로 넘어간다. 줄 끝에서는 다음/이전 행으로 이어진다.
// - 비활성 칸과 합계(읽기 전용, data-expense-skip) 칸은 건너뛴다. 칸을 벗어날 때 값 확정은 Tab·클릭과 같다.
const EXPENSE_CELL_INPUT = 'input:not([type="checkbox"]):not([disabled]):not([data-expense-skip])';
const expenseCellInput = (cell) => cell?.querySelector(EXPENSE_CELL_INPUT) || null;

export function handleExpenseGridKeyDown(event) {
  const { key } = event;
  const horizontal = key === 'ArrowLeft' || key === 'ArrowRight';
  if (!horizontal && key !== 'ArrowUp' && key !== 'ArrowDown') return;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return;
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || target.type === 'checkbox') return;
  if (target.getAttribute('aria-expanded') === 'true' || target.hasAttribute('data-expanded')) return;
  const cell = target.closest('td');
  const row = cell?.parentElement;
  const body = row?.parentElement;
  if (!cell || !row || !body) return;
  if (horizontal && !target.readOnly && target.selectionStart !== null) {
    const { selectionStart: start, selectionEnd: end, value } = target;
    const allSelected = start === 0 && end === value.length;
    if (!allSelected && (start !== end || (key === 'ArrowLeft' ? start !== 0 : end !== value.length))) return;
  }
  const rows = body.rows;
  const column = cell.cellIndex;
  let next = null;
  if (horizontal) {
    const step = key === 'ArrowRight' ? 1 : -1;
    for (let r = row.sectionRowIndex; !next && r >= 0 && r < rows.length; r += step) {
      const cells = rows[r].cells;
      let c = r === row.sectionRowIndex ? column + step : step > 0 ? 0 : cells.length - 1;
      for (; !next && c >= 0 && c < cells.length; c += step) next = expenseCellInput(cells[c]);
    }
  } else {
    const step = key === 'ArrowDown' ? 1 : -1;
    for (let r = row.sectionRowIndex + step; !next && r >= 0 && r < rows.length; r += step) next = expenseCellInput(rows[r].cells[column]);
  }
  if (!next) return;
  event.preventDefault();
  event.stopPropagation();
  next.focus();
  if (!next.readOnly) next.select();
}

const OutboundExpenseRow = memo(function OutboundExpenseRow({
  expense, index, selected, disabled, options, inputRef, salesCustomerName,
  onToggle, onChange, onOpenCustomerPicker, onSetCostPicker,
}) {
  const isCost = expense.purchaseyn === 'Y';
  const saved = disabled && !expense.is_new;  // 저장된 행(수정 불가)은 매출상세처럼 회색
  // 공급가를 입력하는 동안 부가세(직접 고치지 않은 경우)와 합계금액을 바로 계산해 보여 준다. 칸을 벗어나면 저장 값으로 확정.
  const [supplyDraft, setSupplyDraft] = useState(null);
  const supplyText = supplyDraft ?? expense.supplyamt;
  const vatText = supplyDraft !== null && !expense.vat_manual ? expenseVatOf(supplyDraft) : expense.vat;
  const supply = Number(cleanNumericInput(supplyText)) || 0;
  const vat = Number(cleanNumericInput(vatText)) || 0;
  const total = (Math.round((supply + vat + Number.EPSILON) * 100) / 100).toString();
  const handleCostSelect = useCallback((option) => onChange(expense.id, 'costcode', option?.code || ''), [expense.id, onChange]);
  const handleCustomerSelect = useCallback((id, customer) => onChange(expense.id, 'customcode', customer.customercode || ''), [expense.id, onChange]);
  const handleCustomerPicker = useCallback(() => onOpenCustomerPicker(`expense::${expense.id}`), [expense.id, onOpenCustomerPicker]);
  const handleToggle = useCallback((event) => onToggle(expense.id, event.nativeEvent.shiftKey), [expense.id, onToggle]);
  const handleCostPicker = useCallback(() => onSetCostPicker(expense.id), [expense.id, onSetCostPicker]);

  return (
    <Table.Tr className={[expense.is_new && classes.newRow, selected && classes.selectedRow].filter(Boolean).join(' ')}>
      <Table.Td className={`${codeClasses.checkCol} ${saved ? classes.savedCell : ''}`} ta="center"><input type="checkbox" aria-label={`기타비용 ${index + 1}행 선택`} checked={selected} disabled={disabled} onChange={handleToggle} /></Table.Td>
      <Table.Td className={`${codeClasses.rowNumber} ${classes.rowNumberCell} ${saved ? classes.savedCell : ''}`} ta="center">{index + 1}</Table.Td>
      <Table.Td><ExpenseCostAutocompleteCell row={expense} options={options} disabled={disabled} inputRef={inputRef}
        onDoubleClick={handleCostPicker} onSelect={handleCostSelect} /></Table.Td>
      <Table.Td><ExpenseNumericCell expenseId={expense.id} field="supplyamt" value={expense.supplyamt} disabled={disabled} onCommit={onChange} onDraftChange={setSupplyDraft} /></Table.Td>
      <Table.Td><ExpenseNumericCell expenseId={expense.id} field="vat" value={vatText} disabled={disabled} onCommit={onChange} /></Table.Td>
      <Table.Td><input className={`${codeClasses.cellInput} ${inboundClasses.amountInput}`} aria-label="합계금액" value={formatNumericInput(total)} readOnly data-expense-skip /></Table.Td>
      {/* 거래처: 비용여부 '예'면 입력, '아니오'면 매출 헤더의 매출처를 따라감(비활성) */}
      <Table.Td><ExpenseCustomerAutocompleteCell expenseId={expense.id} value={isCost ? expense.customname || '' : salesCustomerName || ''} disabled={disabled || !isCost}
        onSelect={handleCustomerSelect} onOpenPicker={handleCustomerPicker} /></Table.Td>
      <Table.Td><Select size="xs" data={[{ value: 'N', label: '아니오' }, { value: 'Y', label: '예' }]} value={expense.purchaseyn || 'N'} disabled={disabled}
        onChange={(value) => onChange(expense.id, 'purchaseyn', value || 'N')} /></Table.Td>
      <Table.Td><ExpenseDescriptionCell expenseId={expense.id} value={expense.description} disabled={disabled} onCommit={onChange} /></Table.Td>
    </Table.Tr>
  );
});

// ── 매출 상세 · 기타비용 엑셀식 입력 도우미 ──
// 매출 상세 행은 [현재고 조회]로 담은 재고 라인(원천전표·순번·현재고)에 묶여 있다.
// 그래서 행 추가·복제는 하지 않고, 값을 쓰는 것(채우기·붙여넣기·지우기)은 직접 입력할 수 있는 칸(조정·비고)에만 한다.
// 범위 선택·복사는 모든 칸에서 된다.
const DETAIL_FIELD_INDEX = Object.fromEntries(DETAIL_FIELDS.map(({ key }, index) => [key, index]));
const EDITABLE_FIELD_SET = new Set(EDITABLE_FIELDS);
const editableFieldsBetween = (left, right) => DETAIL_FIELDS.slice(left, right + 1).map(({ key }) => key).filter((key) => EDITABLE_FIELD_SET.has(key));
// 한 칸 값을 옮기거나 지운다 — 손으로 칠 때(onChange)와 같은 규칙: 조정은 부호 있는 숫자, 비고는 글자
const copyDetailField = (target, source, field) => {
  if (field === 'adjweight') target.adjweight = cleanSignedInput(source.adjweight);
  else if (field === 'description') target.description = String(source.description ?? '');
};
const clearDetailField = (target, field) => {
  if (field === 'adjweight' || field === 'description') target[field] = '';
};
const plainAmountText = (value) => {
  if (value === '' || value === null || value === undefined) return '';
  const amount = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(amount) ? String(Math.round((amount + Number.EPSILON) * 100) / 100) : '';
};
// 복사(Ctrl+C) 글자: 화면 값과 같게, 숫자는 쉼표 없이 (엑셀에 그대로 붙여넣기)
const detailCopyText = (row, field, unitOptions) => {
  let value;
  if (field === 'sourcetype') {
    const type = row.sourcetype || row.stocksourcetype;
    value = type === 'OPENING' ? '기초' : type === 'INBOUND' ? '입고' : type === 'PROCESS' ? '가공' : '';
  } else if (field === 'stocksourceno') value = row.stocksourceno || row.sourceno || '';
  else if (field === 'stocksourceline') value = row.stocksourceline ?? row.sourceline ?? '';
  else if (field === 'receiptdate') value = String(row.receiptdate || '').slice(0, 10);
  else if (field === 'qtyunit') value = unitOptions.quantity.find((option) => option.code === row.qtyunit)?.name || row.qtyunit || '';
  else if (field === 'unit') value = unitOptions.price.find((option) => option.code === row.unit)?.name || row.unit || '';
  else if (field === 'adjweight') value = cleanSignedInput(row.adjweight);
  else if (field === 'totalweight') { const total = totalWeightOf(row); value = Number.isFinite(total) ? String(total) : ''; }
  else if (field === 'supplyamt') value = plainAmountText(amountOf(row, unitOptions.price));
  else if (field === 'vat') value = plainAmountText(vatAmountOf(row, unitOptions.price));
  else if (field === 'unitamt') value = plainAmountText(totalAmountOf(row, unitOptions.price));
  else value = row[field] ?? '';
  return String(value).replace(/[\t\r\n]+/g, ' ');
};
const parseClipboardMatrix = (text) => String(text || '').replace(/\r/g, '').split('\n')
  .filter((line, index, all) => line || index < all.length - 1).map((line) => line.split('\t'));
const isMultiCellText = (text) => /[\t\n]/.test(String(text || '').replace(/\r?\n$/, ''));

// 기타비용 표 칸 순서 (체크·No. 다음부터). 합계는 계산값이라 붙여넣기에서 건너뛴다.
const EXPENSE_GRID_FIELDS = ['costname', 'supplyamt', 'vat', 'total', 'customname', 'purchaseyn', 'description'];
const EXPENSE_FIRST_FIELD_COLUMN = 2;
const expenseCellOf = (target) => {
  const cell = target?.closest?.('td');
  const row = cell?.parentElement;
  if (!cell || !row || row.parentElement?.tagName !== 'TBODY') return null;
  const field = EXPENSE_GRID_FIELDS[cell.cellIndex - EXPENSE_FIRST_FIELD_COLUMN];
  return field ? { index: row.sectionRowIndex, column: cell.cellIndex, field } : null;
};
const cleanExpenseAmount = (value) => cleanNumericInput(value).replace(/(\.\d{2})\d+$/, '$1');
// 비용여부 글자 → Y/N (못 알아보면 null)
const parsePurchaseYn = (value) => {
  const text = String(value ?? '').trim().toUpperCase();
  if (['Y', 'YES', '예', '비용'].includes(text)) return 'Y';
  if (['', 'N', 'NO', '아니오', '아니요'].includes(text)) return 'N';
  return null;
};
// 한 칸 값을 옮긴다 — changeExpense 와 같은 규칙 (공급가 → 부가세 자동, 부가세 → 직접 입력, 비용구분·거래처는 코드와 이름 함께)
// 거래처는 비용여부 '예'인 행에만 (아니오는 매출처를 따라가는 보기 전용 칸)
const copyExpenseField = (target, source, field) => {
  const next = { ...target, is_dirty: !target.is_new };
  if (field === 'costname') { next.costcode = source.costcode || ''; next.costname = source.costname || ''; }
  else if (field === 'customname') {
    if (target.purchaseyn !== 'Y') return target;
    next.customcode = source.customcode || ''; next.customname = source.customname || '';
  } else if (field === 'supplyamt') {
    next.supplyamt = source.supplyamt ?? '';
    if (!target.vat_manual) next.vat = expenseVatOf(next.supplyamt);
  } else if (field === 'vat') { next.vat = source.vat ?? ''; next.vat_manual = true; }
  else if (field === 'purchaseyn') next.purchaseyn = source.purchaseyn || 'N';
  else if (field === 'description') next.description = source.description || '';
  else return target;
  return next;
};
const findUniqueMatch = (list, text, keys) => {
  const normalized = String(text ?? '').trim().toLocaleLowerCase();
  if (!normalized) return null;
  const matches = list.filter((entry) => keys.some((key) => String(entry[key] ?? '').trim().toLocaleLowerCase() === normalized));
  return matches.length === 1 ? matches[0] : null;
};

const formatExcelDateTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  const parts = cachedDateFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type) => parts.find((entry) => entry.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}:${part('second')}`;
};

const isReceiptConfirmed = (value) => ['Y', 'YES', '확정'].includes(String(value ?? '').trim().toUpperCase());
const CUSTOMER_PICKER_COLUMNS = [
  { key: 'customercode', label: '매출처코드', width: 130 },
  { key: 'customername', label: '매출처명', width: 260 },
  { key: 'ceoname', label: '대표자', width: 140 },
  { key: 'businessno', label: '사업자번호', width: 150 },
];
const ITEM_PICKER_COLUMNS = [
  { key: 'itemcode', label: '품목코드', width: 150 },
  { key: 'itemname', label: '품목명', width: 260 },
  { key: 'itemtypecode', label: '형태구분', width: 140 },
];
const CODE_PICKER_COLUMNS = [
  { key: 'code', label: '코드', width: 140 },
  { key: 'name', label: '코드명', width: 260 },
];
const CustomerPickerModal = memo(function CustomerPickerModal({ opened, onClose, onSelect }) {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [customers, setCustomers] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);

  const load = useCallback(async (nextPage, nextSearch) => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const { data } = await axios.get('/api/list', {
        ...authConfig(),
        params: { search_keyword: nextSearch || undefined, status: 'Y', page: nextPage, page_size: 20, include_total: true },
      });
      if (requestId !== requestIdRef.current) return;
      setCustomers(data.data || []);
      setTotal(data.total || 0);
      setPage(nextPage);
      setSearch(nextSearch);
    } catch (error) {
      if (requestId === requestIdRef.current) notifications.show({ title: '매출처 조회 실패', message: errorMessage(error), color: 'red' });
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!opened) return;
    setSearchInput('');
    setCustomers([]);
    setTotal(0);
    void load(1, '');
  }, [opened, load]);

  const searchCustomers = useCallback(() => { void load(1, searchInput.trim()); }, [load, searchInput]);
  const changePage = useCallback((nextPage) => { void load(nextPage, search); }, [load, search]);
  const invalidatePending = useCallback(() => { requestIdRef.current += 1; onClose(); }, [onClose]);

  return <SelectPickerModal opened={opened} onClose={invalidatePending} size="lg"
    title="매출처 선택" description="매출 전표에 넣을 매출처를 고릅니다." icon={<IconBuildingStore size={21} stroke={1.8} />}
    searchValue={searchInput} onSearchChange={setSearchInput} onSearch={searchCustomers} searchPlaceholder="매출처코드 또는 매출처명 검색"
    listTitle="매출처" columns={CUSTOMER_PICKER_COLUMNS} rows={customers} rowKey={(customer) => customer.customercode} onSelect={onSelect}
    loading={loading} total={total} page={page} pageCount={Math.max(1, Math.ceil(total / 20))} onPageChange={changePage}
    emptyTitle="조회된 매출처가 없습니다" emptyDescription="매출처코드나 이름을 바꿔 다시 조회해 주세요." />;
});

const ItemPickerModal = memo(function ItemPickerModal({ opened, onClose, onSelect }) {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);

  const load = useCallback(async (nextPage, nextSearch) => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const { data } = await axios.get('/api/item-master/items/picker', {
        ...authConfig(), params: { q: nextSearch, page: nextPage, page_size: 20 },
      });
      if (requestId !== requestIdRef.current) return;
      setItems(data.items || []);
      setTotal(data.total || 0);
      setPage(nextPage);
      setSearch(nextSearch);
    } catch (error) {
      if (requestId === requestIdRef.current) notifications.show({ title: '품목 조회 실패', message: errorMessage(error), color: 'red' });
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!opened) return;
    setSearchInput('');
    setItems([]);
    setTotal(0);
    void load(1, '');
  }, [opened, load]);

  const searchItems = useCallback(() => { void load(1, searchInput.trim()); }, [load, searchInput]);
  const changePage = useCallback((nextPage) => { void load(nextPage, search); }, [load, search]);
  const invalidatePending = useCallback(() => { requestIdRef.current += 1; onClose(); }, [onClose]);

  return <SelectPickerModal opened={opened} onClose={invalidatePending} size="md"
    title="품목 선택" description="매출 상세에 넣을 품목을 고릅니다." icon={<IconBox size={21} stroke={1.8} />}
    searchValue={searchInput} onSearchChange={setSearchInput} onSearch={searchItems} searchPlaceholder="품목코드, 품목명 또는 형태구분 검색"
    listTitle="품목" columns={ITEM_PICKER_COLUMNS} rows={items} rowKey={(item) => item.itemcode} onSelect={onSelect}
    loading={loading} total={total} page={page} pageCount={Math.max(1, Math.ceil(total / 20))} onPageChange={changePage}
    emptyTitle="조회된 사용 중 품목이 없습니다" emptyDescription="품목코드나 품목명을 바꿔 다시 조회해 주세요." />;
});

const MasterOptionPickerModal = memo(function MasterOptionPickerModal({ opened, onClose, title, options, onSelect }) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const filteredOptions = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return options;
    return options.filter((option) => `${option.code || ''} ${option.name || ''}`.toLocaleLowerCase().includes(query));
  }, [options, search]);
  const pageSize = 20;
  const pageCount = Math.max(1, Math.ceil(filteredOptions.length / pageSize));
  const visibleOptions = filteredOptions.slice((page - 1) * pageSize, page * pageSize);

  return <SelectPickerModal opened={opened} onClose={onClose} size="sm"
    title={title} description="사용 중인 코드 중에서 고릅니다." icon={<IconListDetails size={21} stroke={1.8} />}
    searchValue={search} onSearchChange={(value) => { setSearch(value); setPage(1); }} searchPlaceholder="코드 또는 코드명 검색"
    listTitle="코드" columns={CODE_PICKER_COLUMNS} rows={visibleOptions} rowKey={(option) => option.code} onSelect={onSelect}
    total={filteredOptions.length} page={page} pageCount={pageCount} onPageChange={setPage}
    emptyTitle="조회된 사용 중 코드가 없습니다" />;
});

const resolveMasterCode = (field, value, unitOptions) => {
  const text = String(value ?? '').trim().toLocaleLowerCase();
  if (!text) return '';
  const options = field === 'unit' ? unitOptions.price : field === 'qtyunit' ? unitOptions.quantity : unitOptions.warehouse;
  return options.find((option) => (
    String(option.code ?? '').trim().toLocaleLowerCase() === text
    || String(option.name ?? '').trim().toLocaleLowerCase() === text
    || `${String(option.code ?? '').trim()} - ${String(option.name ?? '').trim()}`.toLocaleLowerCase() === text
  ))?.code || '';
};

const ManagerInput = memo(function ManagerInput({ row, editable, label, onChange, onPaste, registerCellInput, onFocusCell }) {
  const [value, setValue] = useState(row.manager || '');

  return <input
    ref={(element) => registerCellInput(row.id, 'manager', element)}
    className={`${codeClasses.cellInput} ${editable ? '' : classes.autoFilledInput}`}
    aria-label={label}
    data-row-id={row.id}
    data-field="manager"
    type="text"
    value={value}
    disabled={!editable}
    onFocus={() => onFocusCell(row.id, 'manager')}
    onChange={(event) => setValue(event.currentTarget.value)}
    onPaste={onPaste}
    onBlur={() => {
      if (editable && value !== String(row.manager || '')) onChange(row.id, 'manager', value);
    }}
  />;
});

// 저장된 매출상세의 판매단가: 칸을 벗어나거나 Enter 로 확정 (소수 둘째 자리까지). 재고·원가와 무관해 따로 저장된다
const SavedPriceInput = memo(function SavedPriceInput({ row, label, onChange, registerCellInput, onFocusCell }) {
  const [value, setValue] = useState(formatNumericInput(row.unitprice ?? ''));
  return <input
    ref={(element) => registerCellInput(row.id, 'unitprice', element)}
    className={`${codeClasses.cellInput} ${classes.amountInput}`}
    aria-label={label}
    title="판매단가 수정: 공급가·부가세·합계를 다시 계산합니다 (재고·원가는 그대로)"
    data-row-id={row.id}
    data-field="unitprice"
    type="text"
    inputMode="decimal"
    value={value}
    onFocus={() => onFocusCell(row.id, 'unitprice')}
    onChange={(event) => setValue(formatNumericInput(event.currentTarget.value).replace(/(\.\d{2})\d+$/, '$1'))}
    onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
    onBlur={() => {
      const next = cleanNumericInput(value);
      if (next !== cleanNumericInput(row.unitprice)) onChange(row.id, 'unitprice', next);
    }}
  />;
});

const DeferredReceiptTextInput = memo(function DeferredReceiptTextInput({ value, onCommit, onEditStart, disabled, maxLength, ariaLabel }) {
  const [draft, setDraft] = useState(value || '');
  const originalValueRef = useRef(value || '');
  const editStartedRef = useRef(false);
  return <TextInput aria-label={ariaLabel} value={draft} maxLength={maxLength} disabled={disabled}
    onChange={(event) => {
      const nextValue = event.currentTarget.value;
      setDraft(nextValue);
      if (!editStartedRef.current && nextValue !== originalValueRef.current) {
        editStartedRef.current = true;
        onEditStart();
      }
    }}
    onBlur={() => { if (draft !== (value || '')) onCommit(draft); }} />;
});

const OutboundDateSegments = memo(function OutboundDateSegments({ row, disabled, onChange, registerCellInput, onFocusCell }) {
  const inputRef = useRef(null);
  const activeSegmentRef = useRef(0);
  const segmentRanges = [[0, 4], [5, 7], [8, 10]];

  const selectSegment = (index) => {
    activeSegmentRef.current = index;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(...segmentRanges[index]);
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key !== 'Tab') return;
    const nextIndex = activeSegmentRef.current + (event.shiftKey ? -1 : 1);
    if (nextIndex < 0 || nextIndex > 2) return;
    event.preventDefault();
    event.stopPropagation();
    selectSegment(nextIndex);
  };

  const handleDateChange = (event) => {
    const input = event.currentTarget;
    const raw = input.value;
    const digitsBeforeCaret = raw.slice(0, input.selectionStart || 0).replace(/\D/g, '').length;
    const digits = raw.replace(/\D/g, '').slice(0, 8);
    let formatted = digits;
    if (digits.length > 6) formatted = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
    else if (digits.length > 4) formatted = `${digits.slice(0, 4)}-${digits.slice(4)}`;
    else if (digits.length === 4 && activeSegmentRef.current === 0) formatted = `${digits}-`;
    else if (digits.length === 6 && activeSegmentRef.current === 1) formatted = `${digits.slice(0, 4)}-${digits.slice(4)}-`;
    const nextSegment = activeSegmentRef.current === 0 && digitsBeforeCaret >= 4 && digits.length >= 4
      ? 1
      : activeSegmentRef.current === 1 && digitsBeforeCaret >= 6 && digits.length >= 6 ? 2 : null;
    onChange(row.id, 'receptdate', formatted);
    if (nextSegment !== null) window.requestAnimationFrame(() => selectSegment(nextSegment));
  };

  return (
    <input
      ref={(element) => { inputRef.current = element; registerCellInput(row.id, 'receptdate', element); }}
      className={`${codeClasses.cellInput} ${disabled ? classes.autoFilledInput : ''}`}
      aria-label="매출일자 (연도-월-일)"
      data-row-id={row.id}
      data-field="receptdate"
      type="text"
      inputMode="numeric"
      maxLength={10}
      placeholder="YYYY-MM-DD"
      value={row.receptdate || ''}
      disabled={disabled}
      onFocus={() => { onFocusCell(row.id, 'receptdate'); selectSegment(0); }}
      onClick={(event) => {
        const position = event.currentTarget.selectionStart || 0;
        selectSegment(position < 5 ? 0 : position < 8 ? 1 : 2);
      }}
      onChange={handleDateChange}
      onKeyDown={handleKeyDown}
    />
  );
});

const CustomerAutocompleteInput = memo(function CustomerAutocompleteInput({ row, disabled, onChange, onFindCustomer, registerCellInput, onFocusCell }) {
  const [draft, setDraft] = useState(row.customname || '');
  const [customers, setCustomers] = useState([]);
  const [customersQuery, setCustomersQuery] = useState('');
  const [editing, setEditing] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const pickerOpenRef = useRef(false);
  const skipBlurCommitRef = useRef(false);
  const hasEditedRef = useRef(false);
  const keyboardSelectionRef = useRef(false);
  const query = String(draft || '').trim();
  const visibleCustomers = useMemo(() => {
    if (!query || !customersQuery || !query.toLocaleLowerCase().startsWith(customersQuery.toLocaleLowerCase())) return [];
    const keyword = query.toLocaleLowerCase();
    return customers.filter((customer) => [customer.customername, customer.customercode]
      .some((value) => String(value || '').toLocaleLowerCase().includes(keyword)));
  }, [customers, customersQuery, query]);
  const opened = editing && !disabled && visibleCustomers.length > 0;

  useEffect(() => {
    if (!editing || disabled || !query) return undefined;
    const controller = new AbortController();
    const loadCustomers = async () => {
      try {
        const { data } = await axios.get('/api/list', {
          ...authConfig(),
          params: { search_keyword: query, status: 'Y', page: 1, page_size: 8, include_total: false },
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          setCustomers(data.data || []);
          setCustomersQuery(query);
          setActiveIndex(-1);
        }
      } catch { /* 입력값은 유지하고 자동완성 목록만 닫는다. */ }
    };
    void loadCustomers();
    return () => controller.abort();
  }, [editing, disabled, query]);

  const selectCustomer = (customer) => {
    const name = customer.customername || '';
    hasEditedRef.current = false;
    keyboardSelectionRef.current = false;
    setDraft(name);
    onChange(row.id, 'customcode', customer.customercode || '');
    onChange(row.id, 'customname', name);
    setEditing(false);
    setActiveIndex(-1);
  };

  const openPicker = () => {
    pickerOpenRef.current = true;
    setEditing(false);
    onFindCustomer(row.id);
  };

  return <Popover opened={opened} position="bottom-start" width="target" withinPortal shadow="none" offset={0} zIndex={500} transitionProps={{ duration: 0 }}>
    <Popover.Target>
      <div className={classes.customerAutocompleteTarget}>
        <input
          ref={(element) => registerCellInput(row.id, 'customname', element)}
          className={`${codeClasses.cellInput} ${inboundClasses.itemCodePickerInput} ${inboundClasses.itemNameSearchInput} ${classes.customerAutocompleteInput}`}
          aria-label="매출처"
          aria-haspopup="listbox"
          aria-expanded={opened}
          data-row-id={row.id}
          data-field="customname"
          value={editing ? draft : row.customname || ''}
          disabled={disabled}
          onFocus={(event) => {
            pickerOpenRef.current = false;
            hasEditedRef.current = false;
            keyboardSelectionRef.current = false;
            onFocusCell(row.id, 'customname');
            setDraft(row.customname || '');
            setEditing(true);
            event.currentTarget.select();
          }}
          onBlur={() => {
            if (skipBlurCommitRef.current) { skipBlurCommitRef.current = false; return; }
            if (pickerOpenRef.current) return;
            const normalized = query.toLocaleLowerCase();
            const exact = visibleCustomers.filter((customer) => [customer.customername, customer.customercode]
              .some((value) => String(value || '').trim().toLocaleLowerCase() === normalized));
            if (exact.length === 1) selectCustomer(exact[0]);
            else setEditing(false);
          }}
          onChange={(event) => {
            const value = event.currentTarget.value;
            hasEditedRef.current = true;
            keyboardSelectionRef.current = false;
            setDraft(value);
            setEditing(true);
            setActiveIndex(-1);
            onChange(row.id, 'customname', value);
            onChange(row.id, 'customcode', '');
          }}
          onClick={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            if (!disabled && bounds.right - event.clientX <= 27) openPicker();
          }}
          onKeyDown={(event) => {
            if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && opened) {
              event.preventDefault();
              keyboardSelectionRef.current = true;
              setActiveIndex((current) => event.key === 'ArrowDown'
                ? (current + 1) % visibleCustomers.length
                : (current - 1 + visibleCustomers.length) % visibleCustomers.length);
            } else if (event.key === 'Tab' && hasEditedRef.current) {
              const customer = opened && keyboardSelectionRef.current && activeIndex >= 0
                ? visibleCustomers[activeIndex]
                : null;
              skipBlurCommitRef.current = true;
              if (customer) {
                selectCustomer(customer);
              } else {
                onChange(row.id, 'customname', '');
                onChange(row.id, 'customcode', '');
                setDraft('');
                setEditing(false);
                setActiveIndex(-1);
                hasEditedRef.current = false;
                keyboardSelectionRef.current = false;
              }
            } else if (event.key === 'Enter' && opened) {
              event.preventDefault();
              selectCustomer(visibleCustomers[activeIndex >= 0 ? activeIndex : 0]);
            } else if (event.key === 'Escape') {
              setDraft(row.customname || '');
              setEditing(false);
              setActiveIndex(-1);
            }
          }}
          onDoubleClick={() => { if (!disabled) openPicker(); }}
        />
      </div>
    </Popover.Target>
    <Popover.Dropdown className={classes.stockCustomerSuggestions}>
      <div role="listbox" aria-label="매출처 검색 결과">
        {visibleCustomers.map((customer, index) => <button
          key={customer.customercode}
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          className={classes.stockCustomerSuggestion}
          style={index === activeIndex ? { background: '#edf3f8' } : undefined}
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => setActiveIndex(index)}
          onClick={() => selectCustomer(customer)}
        >
          <span>{customer.customername}</span>
        </button>)}
      </div>
    </Popover.Dropdown>
  </Popover>;
});

const DetailCells = memo(function DetailCells({ row, index, selected, disabled, managerEditable, priceEditable, saved, unitOptions, onSelect, onChange, onPaste, registerCodeInput, registerCellInput, onFindItem, onFindMaster, onFindCustomer, onFocusCell }) {
  const displayValue = (key) => {
    if (key === 'sourcetype') return row.sourcetype === 'OPENING' || row.stocksourcetype === 'OPENING' ? '기초' : row.sourcetype === 'INBOUND' || row.stocksourcetype === 'INBOUND' ? '입고' : row.sourcetype === 'PROCESS' || row.stocksourcetype === 'PROCESS' ? '가공' : '';
    if (key === 'stocksourceno') return row.stocksourceno || row.sourceno || '';
    if (key === 'stocksourceline') return row.stocksourceline ?? row.sourceline ?? '';
    if (key === 'sourcecustomname') return row.sourcecustomname || '';
    if (key === 'receiptdate') return String(row.receiptdate || '').slice(0, 10);
    if (key === 'qtyunit') return unitOptions.quantity.find((option) => option.code === row.qtyunit)?.name || row.qtyunit || '';
    if (key === 'unit') return unitOptions.price.find((option) => option.code === row.unit)?.name || row.unit || '';
    if (key === 'adjweight') {
      const raw = cleanSignedInput(row.adjweight);
      if (!raw || raw === '-' || raw.endsWith('.')) return raw;
      const value = Number(raw);
      return Number.isFinite(value) ? `${value > 0 ? '+' : ''}${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '';
    }
    if (key === 'totalweight') {
      const total = totalWeightOf(row);
      return Number.isFinite(total) ? total.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '';
    }
    if (key === 'weight') {
      const rawWeight = cleanNumericInput(row.weight);
      const weight = Number(rawWeight);
      return rawWeight && Number.isFinite(weight)
        ? weight.toLocaleString(undefined, { maximumFractionDigits: 2 })
        : '';
    }
    if (['current_qty', 'current_weight', 'thickness', 'width', 'length', 'myrtle', 'qty', 'unitprice'].includes(key)) return formatNumericInput(row[key] ?? 0);
    if (NUMERIC_FIELDS.has(key)) return formatNumericInput(row[key]);
    return row[key] ?? '';
  };
  const pasteHandler = (field) => (event) => {
    const text = event.clipboardData.getData('text/plain');
    if (field === 'unit' || field === 'qtyunit' || field === 'warehousecode' || field === 'warehousecodename') {
      event.preventDefault();
      onPaste(row.id, field, text);
      return;
    }
    if (text.includes('\t') || text.includes('\n')) {
      event.preventDefault();
      onPaste(row.id, field, text);
    }
  };
  return <>
    <Table.Td className={`${codeClasses.checkCol} ${saved ? classes.savedCell : ''}`}>
      <input type="checkbox" aria-label={`${row.itemcode || '매출 상세'} 선택`} checked={selected} disabled={disabled} onChange={(event) => onSelect(row.id, event.nativeEvent.shiftKey)} />
    </Table.Td>
    <Table.Td className={`${codeClasses.rowNumber} ${classes.rowNumberCell} ${saved ? classes.savedCell : ''}`}>{index + 1}</Table.Td>
    {DETAIL_FIELDS.map(({ key, label }) => (
      <Table.Td key={key} className={[saved && !(key === 'manager' && managerEditable) && !(key === 'unitprice' && priceEditable) && classes.savedCell, ((key === 'manager' && managerEditable) || (key === 'unitprice' && saved && priceEditable)) && inboundClasses.managerEditableCell].filter(Boolean).join(' ')}>
        {saved && key === 'unitprice' && priceEditable ? (
          <SavedPriceInput key={`${row.id}:${row.unitprice ?? ''}`} row={row} label={label} onChange={onChange} registerCellInput={registerCellInput} onFocusCell={onFocusCell} />
        ) : saved && key !== 'manager' ? (
          <span className={classes.savedCellText} title={String(displayValue(key))}>
            {key === 'supplyamt' ? formatAmount(amountOf(row, unitOptions.price))
              : key === 'vat' ? formatAmount(vatAmountOf(row, unitOptions.price))
                : key === 'unitamt' ? formatAmount(totalAmountOf(row, unitOptions.price))
                  : displayValue(key)}
          </span>
        ) : key === 'manager' ? (
          <ManagerInput key={`${row.id}:${row.manager || ''}`} row={row} editable={managerEditable} label={label} onChange={onChange} onPaste={pasteHandler(key)} registerCellInput={registerCellInput} onFocusCell={onFocusCell} />
        ) : key === 'customname' ? (
          <CustomerAutocompleteInput row={row} disabled={disabled} onChange={onChange} onFindCustomer={onFindCustomer} registerCellInput={registerCellInput} onFocusCell={onFocusCell} />
        ) : key === 'receptdate' ? (
          <OutboundDateSegments row={row} disabled={disabled} onChange={onChange} registerCellInput={registerCellInput} onFocusCell={onFocusCell} />
        ) : ['supplyamt', 'vat', 'unitamt'].includes(key) ? (
          <input ref={(element) => registerCellInput(row.id, key, element)} className={`${codeClasses.cellInput} ${classes.amountInput} ${classes.autoFilledInput}`} aria-label={label}
            value={formatAmount(key === 'supplyamt' ? amountOf(row, unitOptions.price) : key === 'vat' ? vatAmountOf(row, unitOptions.price) : totalAmountOf(row, unitOptions.price))} disabled />
        ) : (
          <input
            ref={(element) => {
              if (key === 'itemcode') registerCodeInput(row.id, element);
              registerCellInput(row.id, key, element);
            }}
            className={`${codeClasses.cellInput} ${(key === 'manager' && managerEditable) || (['receptdate', 'adjweight', 'description'].includes(key) && !disabled) ? '' : classes.autoFilledInput} ${key === 'adjweight' ? classes.amountInput : ''} ${key === 'current_qty' || key === 'current_weight' || key === 'unit' ? classes.currentStockInput : ''} ${key === 'unit' ? classes.itemCodePickerInput : ''}`}
            aria-label={label}
            title={key === 'unit' ? `${label} - 더블클릭하여 마스터에서 선택` : key === 'adjweight' ? '중량에서 더하거나(+) 뺄(-) 중량. 총중량 = 중량 + 조정' : undefined}
            data-row-id={row.id}
            data-field={key}
            type={key === 'receptdate' ? 'date' : 'text'}
            inputMode={NUMERIC_FIELDS.has(key) ? 'decimal' : undefined}
            value={displayValue(key)}
            placeholder={row.is_new && key !== 'description' && key !== 'adjweight' && !READ_ONLY_DETAIL_FIELDS.has(key) ? label : ''}
            maxLength={key === 'description' ? 500 : undefined}
            disabled={key === 'manager' ? !managerEditable : disabled || READ_ONLY_DETAIL_FIELDS.has(key) || key === 'unitprice' || key === 'unit'}
            onFocus={() => onFocusCell(row.id, key)}
            onDoubleClick={key === 'unit' ? () => onFindMaster(row.id, key) : undefined}
            onPaste={pasteHandler(key)}
            onChange={(event) => onChange(row.id, key, key === 'adjweight' ? cleanSignedInput(event.currentTarget.value) : NUMERIC_FIELDS.has(key) ? cleanNumericInput(event.currentTarget.value) : event.currentTarget.value)}
          />
        )}
      </Table.Td>
    ))}

  </>;
});

const VirtualRow = ({ item, context, className, ...props }) => (
  <Table.Tr {...props} className={[className, item?.is_new && codeClasses.newRow, item?.is_new && classes.newRow, context?.selectedSet?.has(item?.id) && classes.selectedRow].filter(Boolean).join(' ')} />
);
// 상세 표 맨 아래 고정 소계 줄 (매출·입고등록 공용). columns 앞 두 칸(선택·No.)을 합쳐 '소계'를 쓰고,
// values[column.key]가 있는 칸만 숫자를 오른쪽 정렬로 채운다.
export const DetailSubtotalRow = ({ columns, values }) => <Table.Tr>
  <Table.Td colSpan={2} className={inboundClasses.detailSubtotalCell}>소계</Table.Td>
  {columns.slice(2).map((column) => <Table.Td key={column.key} className={`${inboundClasses.detailSubtotalCell} ${values[column.key] != null ? inboundClasses.detailSubtotalNumber : ''}`}>{values[column.key] ?? ''}</Table.Td>)}
</Table.Tr>;
export const DetailSubtotalFoot = (props) => <Table.Tfoot {...props} className={inboundClasses.detailSubtotalFoot} />;
// 행이 적어도 상세 영역 맨 아래에 붙는 소계 표 (매출 기본 소계 줄과 같은 위치). 본 표와 같은 스크롤 영역 안에 두어 가로 스크롤이 함께 움직인다.
export const DetailSubtotalTable = ({ columns, widths = {}, values, minWidth = 'var(--code-table-min-width)' }) => <Table className={inboundClasses.detailSubtotalTable} withTableBorder withColumnBorders horizontalSpacing={0}
  style={{ width: '100%', minWidth, tableLayout: 'fixed' }}>
  <colgroup>{columns.map((column) => <col key={column.key} style={{ width: widths[column.key] ?? column.width }} />)}</colgroup>
  <Table.Tbody><DetailSubtotalRow columns={columns} values={values} /></Table.Tbody>
</Table>;
export const detailSubtotalValues = (totals) => ({
  qty: totals.qty.toLocaleString(undefined, { maximumFractionDigits: 2 }),
  weight: totals.weight.toLocaleString(undefined, { maximumFractionDigits: 2 }),
  supplyamt: formatWon(totals.amount.toFixed(2)),
  vat: formatWon(totals.vat.toFixed(2)),
  unitamt: formatWon(totals.total.toFixed(2)),
});

// 기타비용 표 소계 줄의 열 (표 머리글 너비와 같게, 비고 칸은 남는 너비)
export const expenseSubtotalColumns = (withCostFlag) => [
  { key: 'select', width: 42 }, { key: 'number', width: 52 }, { key: 'costcode', width: 160 },
  { key: 'supplyamt', width: 145 }, { key: 'vat', width: 135 }, { key: 'total', width: 145 }, { key: 'customcode', width: 190 },
  ...(withCostFlag ? [{ key: 'costyn', width: 105 }] : []), { key: 'description' },
];
export const expenseSubtotalValues = (totals) => ({
  supplyamt: formatWon(String(totals.supply)), vat: formatWon(String(totals.vat)), total: formatWon(String(totals.total)),
});
const OUTBOUND_EXPENSE_SUBTOTAL_COLUMNS = expenseSubtotalColumns(true);

const virtuosoComponents = {
  Table: ({ style, ...props }) => <Table {...props} className={`${sharedClasses.table} ${codeClasses.codeTable}`} highlightOnHover withTableBorder withColumnBorders verticalSpacing="xs" horizontalSpacing={0} style={{ ...style, width: '100%', tableLayout: 'fixed' }} />,
  TableHead: Table.Thead,
  TableBody: Table.Tbody,
  TableRow: VirtualRow,
  TableFoot: DetailSubtotalFoot,
};

// Mantine <Table> hands a fresh context value to every Table.Td/Th whenever it re-renders,
// which forces all existing (memoized) expense rows to re-render on each row add. The table
// element is memoized and the expense array reaches the tbody through this context,
// so adding an expense only renders the new row.
const ExpenseRowsContext = createContext({ expenses: [], selectedExpenseSet: new Set(), salesCustomerName: '' });

const OutboundExpenseTableRows = memo(function OutboundExpenseTableRows({
  disabled, options, getInputRef, onToggle, onChange, onOpenCustomerPicker, onSetCostPicker,
}) {
  const { expenses, selectedExpenseSet, salesCustomerName } = useContext(ExpenseRowsContext);
  if (!expenses.length) return null;
  return <Table.Tbody>{expenses.map((expense, index) => (
    <OutboundExpenseRow key={expense.id} expense={expense} index={index} selected={selectedExpenseSet.has(expense.id)}
      disabled={disabled} options={options} inputRef={getInputRef(expense.id)} salesCustomerName={salesCustomerName}
      onToggle={onToggle} onChange={onChange} onOpenCustomerPicker={onOpenCustomerPicker}
      onSetCostPicker={onSetCostPicker} />
  ))}</Table.Tbody>;
});

export default function OutboundRegisterPage() {
  const pageActivation = usePageActivation(); // 탭에 돌아올 때마다 목록(코드·거래처)을 다시 불러온다
  const pageLayout = useContext(PageRibbonContext);
  const registerPageRibbon = pageLayout?.registerPageRibbon;
  const closeActivePage = pageLayout?.closeActivePage;
  const [receipts, setReceipts] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [filterInputs, setFilterInputs] = useState(createDefaultReceiptFilters);
  const [filters, setFilters] = useState(createDefaultReceiptFilters);
  const [header, setHeader] = useState(EMPTY_HEADER);
  const [receiptCustomers, setReceiptCustomers] = useState(() => peekMaster('customers:active') || []);
  const [receiptMetadata, setReceiptMetadata] = useState({ companyid: '', companyname: '', created_at: '', updated_at: '' });
  const [rows, setRows] = useState([]);
  const detailRowsRef = useRef(rows);
  useLayoutEffect(() => { detailRowsRef.current = rows; }, [rows]);
  const [expenses, setExpenses] = useState([]);
  const expenseRowsRef = useRef(expenses);
  useLayoutEffect(() => { expenseRowsRef.current = expenses; }, [expenses]);
  const [expenseOptions, setExpenseOptions] = useState(() => peekMaster(outboundCodeKey('OTHER_COST')) || []);
  const [expenseCostPickerId, setExpenseCostPickerId] = useState('');
  const [selectedExpenseIds, setSelectedExpenseIds] = useState([]);
  const [detailTab, setDetailTab] = useState('details');
  const [selectedReceiptno, setSelectedReceiptno] = useState('');
  const [subulyn, setSubulyn] = useState('N');
  const [documentDirty, setDocumentDirty] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  // Receipt being fetched after a list click: highlighted immediately so the click gets
  // instant feedback; only the latest click's response is applied (see openReceipt).
  const [openingReceiptno, setOpeningReceiptno] = useState('');
  const openRequestRef = useRef({ id: 0, controller: null });
  // Cancel a receipt still loading so its late response cannot overwrite a new draft.
  const cancelPendingOpen = useCallback(() => {
    if (!openRequestRef.current.controller) return;
    openRequestRef.current.controller.abort();
    openRequestRef.current = { id: openRequestRef.current.id + 1, controller: null };
    setOpeningReceiptno('');
    setDetailLoading(false);
  }, []);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [filterOpen, setFilterOpen] = useState(true);
  // 거래명세서 / 송장 출력 ('statement' | 'delivery' | '')
  const [printKind, setPrintKind] = useState('');
  const closePrint = useCallback(() => setPrintKind(''), []);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [columnWidths, setColumnWidths] = useState({});
  const [receiptColumnWidths, setReceiptColumnWidths] = useState({});
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [customerPickerTargetId, setCustomerPickerTargetId] = useState('');
  const [stockPickerOpen, setStockPickerOpen] = useState(false);
  const headerCustomerRef = useRef(null);
  // 매출처 목록 펼침 상태: 재고조회 안내로 포커스만 옮길 때는 목록을 펼치지 않는다 (클릭·입력하면 펼침)
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false);
  const suppressCustomerDropdownRef = useRef(false);
  const focusHeaderCustomer = useCallback(() => {
    suppressCustomerDropdownRef.current = true;
    headerCustomerRef.current?.focus();
    suppressCustomerDropdownRef.current = false;
  }, []);
  const [customerFocusTick, setCustomerFocusTick] = useState(0);
  useEffect(() => { if (customerFocusTick) focusHeaderCustomer(); }, [customerFocusTick, focusHeaderCustomer]);
  const [itemPickerTargetId, setItemPickerTargetId] = useState('');
  const [masterPickerTarget, setMasterPickerTarget] = useState(null);
  const [unitOptions, setUnitOptions] = useState(cachedOutboundUnitOptions);
  const virtuosoRef = useRef(null);
  const detailScrollerRef = useRef(null);
  const initialReceiptLoadRef = useRef(false);
  const codeInputsRef = useRef(new Map());
  const cellInputsRef = useRef(new Map());
  const expenseCostInputsRef = useRef(new Map());
  const expenseTableScrollerRef = useRef(null);
  const pendingExpenseFocusIdRef = useRef('');
  const codeLookupTimersRef = useRef(new Map());
  const masterPasteErrorsRef = useRef(new Map());
  const activeCellRef = useRef(null);
  const pendingCellFocusRef = useRef(null);
  const pendingFocusIdRef = useRef('');
  const selectionAnchorRef = useRef('');
  const expenseSelectionAnchorRef = useRef('');
  const receiptTableRef = useRef(null);
  const receiptSubtotalRef = useRef(null);
  const receiptHorizontalScrollRef = useRef(null);
  const getExpenseCostInputRef = useCallback((id) => {
    if (!expenseCostInputsRef.current.has(id)) expenseCostInputsRef.current.set(id, { current: null });
    return expenseCostInputsRef.current.get(id);
  }, []);
  useLayoutEffect(() => {
    const expenseId = pendingExpenseFocusIdRef.current;
    if (!expenseId) return;
    const scroller = expenseTableScrollerRef.current;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
    expenseCostInputsRef.current.get(expenseId)?.current?.focus();
    pendingExpenseFocusIdRef.current = '';
  }, [expenses.length]);
  const confirmed = isReceiptConfirmed(subulyn);
  // 저장된 전표는 서버가 알려 준 사유(월마감 · 승인 대기)가 있으면 매출일자 · 단가 · 담당자 · 착지 · 삭제를 모두 잠근다
  const locked = confirmed || Boolean(selectedReceiptno && header.edit_lock);
  const readOnly = Boolean(selectedReceiptno) || locked;
  const hasManagerChanges = Boolean(selectedReceiptno) && Boolean(header.manager_dirty);
  const hasNewDetails = useMemo(() => rows.some((row) => row.is_new), [rows]);
  const hasPendingExpenses = useMemo(() => expenses.some((row) => row.is_new || row.is_dirty), [expenses]);
  const hasPendingChanges = useMemo(() => documentDirty || rows.some((row) => row.is_new || row.is_dirty) || hasPendingExpenses, [documentDirty, rows, hasPendingExpenses]);
  useUnsavedChanges(hasPendingChanges);   // 탭 닫기 · 브라우저 닫기 전에 확인
  const requestKey = useRequestKey(!selectedReceiptno && hasPendingChanges);   // 새 전표 중복 저장 막기 (서버 request_key)
  // 출력은 항상 DB 에 저장된 전표 기준이므로, 화면에서 고친 내용이 있으면 먼저 저장하게 한다.
  const openPrint = useCallback((kind) => {
    if (!selectedReceiptno) {
      notifications.show({ title: '출력할 전표 없음', message: '목록에서 매출전표를 먼저 선택해 주세요.', color: 'orange' });
      return;
    }
    if (hasPendingChanges) {
      notifications.show({ title: '저장되지 않은 변경사항', message: '수정한 내용을 먼저 저장한 뒤 출력해 주세요. 출력은 저장된 전표 기준입니다.', color: 'orange' });
      return;
    }
    setPrintKind(kind);
  }, [selectedReceiptno, hasPendingChanges]);
  const expenseTotals = useMemo(() => expenses.reduce((totals, row) => {
    totals.supply += Number(cleanNumericInput(row.supplyamt)) || 0;
    totals.vat += Number(cleanNumericInput(row.vat)) || 0;
    totals.total += (Number(cleanNumericInput(row.supplyamt)) || 0) + (Number(cleanNumericInput(row.vat)) || 0);
    return totals;
  }, { supply: 0, vat: 0, total: 0 }), [expenses]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedExpenseSet = useMemo(() => new Set(selectedExpenseIds), [selectedExpenseIds]);
  const virtuosoContext = useMemo(() => ({ selectedSet }), [selectedSet]);
  const detailTotals = useMemo(() => rows.reduce((totals, row) => {
    const amount = Number(amountOf(row, unitOptions.price)) || 0;
    const vat = Number(vatAmountOf(row, unitOptions.price)) || 0;
    totals.qty += Number(cleanNumericInput(row.qty)) || 0;
    totals.weight += Number(cleanNumericInput(row.weight)) || 0;
    totals.adjweight += signedNumber(row.adjweight);
    totals.totalweight += Number.isFinite(totalWeightOf(row)) ? totalWeightOf(row) : 0;
    totals.amount += amount;
    totals.vat += vat;
    totals.total += amount + vat;
    return totals;
  }, { qty: 0, weight: 0, adjweight: 0, totalweight: 0, amount: 0, vat: 0, total: 0 }), [rows, unitOptions.price]);
  const detailSubtotals = useMemo(() => ({
    ...detailSubtotalValues(detailTotals),
    adjweight: detailTotals.adjweight.toLocaleString(undefined, { maximumFractionDigits: 2 }),
    totalweight: detailTotals.totalweight.toLocaleString(undefined, { maximumFractionDigits: 2 }),
  }), [detailTotals]);
  const quantitySummary = useMemo(() => {
    if (!rows.length) return '0';
    const totals = new Map();
    const defaultUnit = unitOptions.quantity.find((option) => option.code === 'EA')?.name || 'EA';
    rows.forEach((row) => {
      const unit = unitOptions.quantity.find((option) => option.code === row.qtyunit)?.name || row.qtyunit || defaultUnit;
      const quantity = Number(cleanNumericInput(row.qty)) || 0;
      totals.set(unit, (totals.get(unit) || 0) + quantity);
    });
    return [...totals.entries()].map(([unit, quantity]) => `${quantity.toLocaleString(undefined, { maximumFractionDigits: 2 })}${unit}`).join(', ');
  }, [rows, unitOptions.quantity]);
  const receiptAutoWidths = useMemo(() => Object.fromEntries(RECEIPT_COLUMNS.map((column) => {
    const values = receipts.map((receipt) => receipt[column.key]);
    if (column.key === 'total_weight') {
      const subtotal = receipts.reduce((sum, receipt) => sum + Number(receipt.total_weight || 0), 0);
      values.push(subtotal.toLocaleString(undefined, { maximumFractionDigits: 2 }));
    } else if (['supply_amount', 'vat_amount', 'total_amount', 'other_cost_amount'].includes(column.key)) {
      const subtotal = receipts.reduce((sum, receipt) => sum + Number(receipt[column.key] || 0), 0);
      values.push(formatWon(String(subtotal)));
    }
    return [column.key, fitReceiptColumnWidth(column.label, values, column.width, column.minWidth)];
  })), [receipts]);

  const resizeColumn = useCallback((event, key, defaultWidth, minWidth, tableWidth) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = columnWidths[key] ?? defaultWidth;
    const root = event.currentTarget.closest(`.${codeClasses.tableWrap}`);
    const th = event.currentTarget.parentElement;
    let nextWidth = startWidth;
    const move = (pointerEvent) => {
      nextWidth = Math.max(minWidth, Math.min(1600, startWidth + pointerEvent.clientX - startX));
      if (th) th.style.width = `${nextWidth}px`;
      root?.style.setProperty('--code-table-min-width', `${Math.max(900, tableWidth + nextWidth - startWidth)}px`);
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

  const resizeReceiptColumn = useCallback((event, key, defaultWidth, minWidth) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = receiptColumnWidths[key] ?? receiptAutoWidths[key] ?? defaultWidth;
    const tableWidth = RECEIPT_COLUMNS.reduce((sum, column) => sum + (receiptColumnWidths[column.key] ?? receiptAutoWidths[column.key] ?? column.width), 0);
    let nextWidth = startWidth;
    let animationFrame = 0;
    const applyWidth = () => {
      const nextTableWidth = tableWidth + nextWidth - startWidth;
      const tables = [receiptTableRef.current?.querySelector('table'), receiptSubtotalRef.current?.querySelector('table')].filter(Boolean);
      tables.forEach((table) => {
        const col = [...table.querySelectorAll('col[data-column-key]')].find((element) => element.dataset.columnKey === key);
        if (col) col.style.width = `${nextWidth}px`;
        table.style.width = `${nextTableWidth}px`;
        table.style.minWidth = `${nextTableWidth}px`;
      });
      if (receiptHorizontalScrollRef.current) {
        const content = receiptHorizontalScrollRef.current.firstElementChild;
        if (content) content.style.width = `${nextTableWidth}px`;
      }
    };
    const move = (pointerEvent) => {
      nextWidth = Math.max(minWidth, Math.min(1600, startWidth + pointerEvent.clientX - startX));
      if (!animationFrame) animationFrame = window.requestAnimationFrame(() => { animationFrame = 0; applyWidth(); });
    };
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      applyWidth();
      setReceiptColumnWidths((current) => ({ ...current, [key]: nextWidth }));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  }, [receiptColumnWidths, receiptAutoWidths]);

  // focusReceiptno: 저장한 전표가 들어 있는 쪽으로 바로 연다 (서버가 쪽 번호를 계산)
  const loadReceipts = useCallback(async (nextPage = page, nextFilters = filters, nextPageSize = pageSize, focusReceiptno = '') => {
    setLoading(true);
    try {
      const { data } = await axios.get('/api/outbound-register/receipts', {
        ...authConfig(), params: {
          page: nextPage,
          page_size: nextPageSize,
          q: nextFilters.customer || nextFilters.q || undefined,
          receiptno: nextFilters.receiptno || undefined,
          customcode: nextFilters.customcode || undefined,
          customname: nextFilters.customname || undefined,
          warehouse: nextFilters.warehouse || undefined,
          date_from: nextFilters.date_from || undefined,
          date_to: nextFilters.date_to || undefined,
          focus_receiptno: focusReceiptno || undefined,
        },
      });
      setReceipts(data.receipts || []);
      setTotal(data.total || 0);
      setPage(data.page || nextPage);
    } catch (error) {
      notifications.show({ title: '매출 목록 조회 실패', message: errorMessage(error), color: 'red' });
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, filters]);

  useEffect(() => {
    if (initialReceiptLoadRef.current) return;
    initialReceiptLoadRef.current = true;
    void loadReceipts(1, createDefaultReceiptFilters(), 15);
  }, [loadReceipts]);

  // 코드 목록: 지난번 값(메모리 캐시)으로 바로 채우고 서버 값으로 곧바로 바꾼다. 여러 쪽은 병렬로 받는다.
  const loadUnitOptions = useCallback((groupcode) => loadMaster(outboundCodeKey(groupcode), async () => {
    const items = await fetchAllPages(async (pageNumber) => {
      const { data } = await axios.get(`/api/code-master/groups/${groupcode}/items`, {
        ...authConfig(), params: { page: pageNumber, page_size: 200, include_total: true },
      });
      return { items: data.items || [], total: data.total || 0 };
    }, 200);
    return items.filter((item) => item.use).map((item) => ({ code: item.code, name: item.name, property: item.properties?.[0] || '' }));
  }), []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadUnitOptions('PRICE_UNIT'), loadUnitOptions('QTY'), loadUnitOptions('WAREHOUSE'), loadUnitOptions('OTHER_COST')])
      .then(([price, quantity, warehouse, otherCost]) => {
        if (!cancelled) {
          setUnitOptions({ price, quantity, warehouse });
          setExpenseOptions(otherCost);
        }
      })
      .catch((error) => {
        if (!cancelled) notifications.show({ title: '단위 코드 조회 실패', message: errorMessage(error), color: 'red' });
      });
    return () => { cancelled = true; };
  }, [loadUnitOptions, pageActivation]);

  const addExpense = useCallback(() => {
    if (saving || readOnly) return;
    const expense = makeExpense();
    pendingExpenseFocusIdRef.current = expense.id;
    setExpenses((current) => [...current, expense]);
    setDocumentDirty(true);
    setDetailTab('expenses');
  }, [saving, readOnly]);

  const changeExpense = useCallback((id, key, value) => {
    if (saving || readOnly) return;
    setExpenses((current) => current.map((expense) => {
      if (expense.id !== id) return expense;
      const next = { ...expense, [key]: value, is_dirty: !expense.is_new };
      if (key === 'supplyamt' && !expense.vat_manual) next.vat = expenseVatOf(value);
      if (key === 'vat') next.vat_manual = true;
      if (key === 'costcode') {
        const option = expenseOptions.find((item) => item.code === value);
        next.costname = option?.name || '';
      }
      if (key === 'customcode') {
        const customer = receiptCustomers.find((item) => item.customercode === value);
        next.customname = customer?.customername || '';
      }
      return next;
    }));
    setDocumentDirty(true);
  }, [expenseOptions, receiptCustomers, readOnly, saving]);

  const toggleExpenseSelection = useCallback((id, shiftKey = false) => {
    if (saving || readOnly) return;
    const currentExpenses = expenseRowsRef.current;
    setSelectedExpenseIds((current) => {
      const from = currentExpenses.findIndex((expense) => expense.id === expenseSelectionAnchorRef.current);
      const to = currentExpenses.findIndex((expense) => expense.id === id);
      if (shiftKey && from >= 0 && to >= 0) {
        expenseSelectionAnchorRef.current = id;
        return [...new Set([...current, ...currentExpenses.slice(Math.min(from, to), Math.max(from, to) + 1).map((expense) => expense.id)])];
      }
      expenseSelectionAnchorRef.current = id;
      return current.includes(id) ? current.filter((value) => value !== id) : [...current, id];
    });
  }, [readOnly, saving]);

  const toggleAllExpenses = useCallback((checked) => {
    if (saving || readOnly) return;
    setSelectedExpenseIds(checked ? expenseRowsRef.current.map((expense) => expense.id) : []);
    expenseSelectionAnchorRef.current = '';
  }, [readOnly, saving]);

  const removeSelectedExpenses = useCallback(() => {
    if (saving || readOnly || !selectedExpenseIds.length) return;
    const selected = new Set(selectedExpenseIds);
    const remaining = expenses.filter((expense) => !selected.has(expense.id));
    const removedCount = expenses.length - remaining.length;
    if (!removedCount) return;
    setExpenses(remaining);
    setSelectedExpenseIds([]);
    expenseSelectionAnchorRef.current = '';
    setDocumentDirty(true);
    notifications.show({ title: '선택 행 제거 완료', message: `기타비용 ${removedCount}행을 제거했습니다. 저장하면 반영됩니다.`, color: 'teal' });
  }, [saving, readOnly, selectedExpenseIds, expenses]);

  // ── 기타비용 표 엑셀식 입력 ──
  // 칸(공급가·부가세·비고·거래처·비용구분)은 벗어날 때 값을 확정하므로, 값을 바꾸기 전에 먼저 포커스를 빼서 확정시키고 바꾼 뒤 다시 돌아온다.
  const focusExpenseCell = useCallback((index, column) => {
    requestAnimationFrame(() => {
      const input = expenseTableScrollerRef.current?.querySelector('tbody')?.rows[index]?.cells[column]?.querySelector(EXPENSE_CELL_INPUT);
      if (!input) return;
      input.focus();
      if (!input.readOnly) input.select?.();
    });
  }, []);

  // Ctrl+D: 체크한 행이 있으면 현재 칸 값을 그 아래 체크한 행들에, 없으면 바로 윗행 값을 현재 칸에
  const fillExpenseDown = useCallback((cell, element) => {
    if (saving || readOnly || cell.field === 'total') return;
    const list = expenseRowsRef.current;
    const selected = new Set(selectedExpenseIds);
    const useSelection = selected.size > 0;
    const sourceIndex = useSelection ? cell.index : cell.index - 1;
    const targets = useSelection
      ? new Set(list.map((expense, index) => (index > cell.index && selected.has(expense.id) ? index : -1)).filter((index) => index >= 0))
      : new Set([cell.index]);
    if (sourceIndex < 0 || !targets.size) return;
    element?.blur();
    setExpenses((current) => current.map((expense, index) => (targets.has(index) && current[sourceIndex]
      ? copyExpenseField(expense, current[sourceIndex], cell.field) : expense)));
    setDocumentDirty(true);
    focusExpenseCell(cell.index, cell.column);
    if (useSelection) notifications.show({ title: '아래로 채우기 완료', message: `기타비용 ${targets.size.toLocaleString()}개 행에 현재 칸의 값을 복사했습니다.`, color: 'teal' });
  }, [saving, readOnly, selectedExpenseIds, focusExpenseCell]);

  // Ctrl+Enter: 아래에 빈 행 · Ctrl+Shift+Enter: 현재 행 복제
  const insertExpenseBelow = useCallback((index, duplicate, element) => {
    if (saving || readOnly) return;
    if (duplicate) element?.blur();
    const fresh = makeExpense();
    setExpenses((current) => {
      const source = current[index];
      const row = duplicate && source
        ? makeExpense({
          id: fresh.id, costcode: source.costcode, costname: source.costname, supplyamt: source.supplyamt, vat: source.vat,
          vat_manual: source.vat_manual, customcode: source.customcode, customname: source.customname,
          purchaseyn: source.purchaseyn, description: source.description,
        })
        : fresh;
      const next = [...current];
      next.splice(Math.min(index + 1, next.length), 0, row);
      return next;
    });
    setDocumentDirty(true);
    pendingExpenseFocusIdRef.current = fresh.id;
  }, [saving, readOnly]);

  const handleExpenseKeyDown = useCallback((event) => {
    if (event.defaultPrevented || event.altKey || event.nativeEvent.isComposing || event.keyCode === 229) return;
    const cell = expenseCellOf(event.target);
    if (!cell) return;
    const ctrl = event.ctrlKey || event.metaKey;
    const { key } = event;
    if (ctrl && key.toLowerCase() === 'd') { event.preventDefault(); fillExpenseDown(cell, event.target); return; }
    if (ctrl && key === 'Enter') { event.preventDefault(); insertExpenseBelow(cell.index, event.shiftKey, event.target); return; }
    if (ctrl && !event.shiftKey && (key === 'ArrowUp' || key === 'ArrowDown')) {
      const count = expenseRowsRef.current.length;
      if (!count) return;
      event.preventDefault();
      focusExpenseCell(key === 'ArrowUp' ? 0 : count - 1, cell.column);
      return;
    }
    // 비용여부 목록 칸은 Enter 를 목록 열기·고르기에 쓴다
    if (key === 'Enter' && !ctrl && cell.field !== 'purchaseyn') {
      // Enter / Shift+Enter: 아래·위 행 같은 칸. 마지막 행에서 Enter 는 새 행을 붙인다.
      event.preventDefault();
      const nextIndex = cell.index + (event.shiftKey ? -1 : 1);
      if (nextIndex < 0) return;
      if (nextIndex >= expenseRowsRef.current.length) {
        if (!event.shiftKey) { event.target.blur?.(); addExpense(); }
        return;
      }
      focusExpenseCell(nextIndex, cell.column);
    }
  }, [fillExpenseDown, insertExpenseBelow, focusExpenseCell, addExpense]);

  // 엑셀 범위 붙여넣기: 현재 칸부터 오른쪽·아래로 (비용구분 · 공급가 · 부가세 · 합계(건너뜀) · 거래처 · 비용여부 · 비고). 모자란 행은 새로 만든다.
  // 비용구분·거래처는 이름이나 코드가 정확히 하나로 맞을 때만 넣고, 못 찾으면 비워 두고 알려 준다.
  // 거래처는 비용여부 '예'인 행에만 넣는다 ('아니오'는 저장할 때 매출처로 저장되는 보기 전용 칸).
  const handleExpensePasteCapture = useCallback((event) => {
    if (saving || readOnly) return;
    const text = event.clipboardData.getData('text/plain');
    if (!isMultiCellText(text)) return;   // 값 하나는 칸 기본 붙여넣기
    const cell = expenseCellOf(event.target);
    if (!cell) return;
    event.preventDefault();
    event.stopPropagation();
    const matrix = parseClipboardMatrix(text);
    if (cell.index + matrix.length > 1000) {
      notifications.show({ title: '붙여넣기 제한', message: '기타비용은 한 번에 최대 1,000행까지 입력할 수 있습니다.', color: 'orange' });
      return;
    }
    const startField = EXPENSE_GRID_FIELDS.indexOf(cell.field);
    const unresolved = [];
    const patches = matrix.map((line, offset) => {
      const patch = {};
      const rowLabel = `${cell.index + offset + 1}행`;
      line.forEach((value, columnOffset) => {
        const field = EXPENSE_GRID_FIELDS[startField + columnOffset];
        const raw = String(value ?? '').trim();
        if (field === 'costname') {
          const option = findUniqueMatch(expenseOptions, raw, ['name', 'code']);
          patch.costcode = option?.code || '';
          patch.costname = option ? option.name || option.code || '' : '';
          if (raw && !option) unresolved.push(`${rowLabel} 비용구분: ${raw}`);
        } else if (field === 'customname') {
          const customer = findUniqueMatch(receiptCustomers, raw, ['customername', 'customercode']);
          patch.customer = { customcode: customer?.customercode || '', customname: customer?.customername || '', raw, found: Boolean(customer) };
        } else if (field === 'supplyamt' || field === 'vat') patch[field] = cleanExpenseAmount(raw);
        else if (field === 'purchaseyn') {
          const parsed = parsePurchaseYn(raw);
          if (parsed) patch.purchaseyn = parsed;
          else unresolved.push(`${rowLabel} 비용여부: ${raw} (예/아니오)`);
        } else if (field === 'description') patch.description = String(value ?? '').slice(0, 500);
      });
      return patch;
    });
    event.target.blur?.();
    const currentList = expenseRowsRef.current;
    patches.forEach((patch, offset) => {
      // 거래처를 못 찾은 경우는 그 행이 비용여부 '예'일 때만 알린다
      const purchaseyn = patch.purchaseyn ?? currentList[cell.index + offset]?.purchaseyn ?? 'N';
      if (patch.customer && purchaseyn === 'Y' && patch.customer.raw && !patch.customer.found) {
        unresolved.push(`${cell.index + offset + 1}행 거래처: ${patch.customer.raw}`);
      }
    });
    setExpenses((current) => {
      const next = [...current];
      patches.forEach((patch, offset) => {
        const index = cell.index + offset;
        const base = next[index] ? { ...next[index] } : makeExpense();
        const { customer, ...values } = patch;
        Object.assign(base, values);
        if (customer && base.purchaseyn === 'Y') { base.customcode = customer.customcode; base.customname = customer.customname; }
        if ('vat' in values) {
          // 부가세: 비우거나 공급가의 10% 와 같으면 자동계산, 다르면 직접 입력 (손으로 친 것과 같음)
          const autoVat = expenseVatOf(base.supplyamt);
          base.vat_manual = values.vat !== '' && Math.abs((Number(values.vat) || 0) - Number(autoVat)) > 0.004;
          if (!base.vat_manual) base.vat = autoVat;
        } else if ('supplyamt' in values && !base.vat_manual) base.vat = expenseVatOf(base.supplyamt);
        base.is_dirty = !base.is_new;
        if (next[index]) next[index] = base;
        else next.push(base);
      });
      return next;
    });
    setDocumentDirty(true);
    focusExpenseCell(cell.index, cell.column);
    if (unresolved.length) {
      notifications.show({
        title: '코드 확인 필요',
        message: `${unresolved.slice(0, 5).join(' · ')}${unresolved.length > 5 ? ` 외 ${unresolved.length - 5}건` : ''}. 사용 중인 비용구분·거래처만 들어가므로 해당 칸은 비워 두었습니다 (비용여부는 그대로).`,
        color: 'orange',
        autoClose: 8000,
      });
    }
  }, [saving, readOnly, expenseOptions, receiptCustomers, focusExpenseCell]);

  const openCustomerPicker = useCallback((rowId) => {
    if (!readOnly && !saving) {
      setCustomerPickerTargetId(rowId);
      setCustomerPickerOpen(true);
    }
  }, [readOnly, saving]);


  const selectCustomer = useCallback((customer) => {
    if (!customerPickerTargetId) return;
    if (customerPickerTargetId.startsWith('expense::')) {
      const expenseId = customerPickerTargetId.slice('expense::'.length);
      setExpenses((current) => current.map((expense) => expense.id === expenseId
        ? { ...expense, customcode: customer.customercode || '', customname: customer.customername || '', is_dirty: !expense.is_new }
        : expense));
      setDocumentDirty(true);
      setCustomerPickerOpen(false);
      setCustomerPickerTargetId('');
      return;
    }
    setRows((current) => current.map((row) => row.id === customerPickerTargetId
      ? { ...row, customcode: customer.customercode || '', customname: customer.customername || '', is_dirty: !row.is_new }
      : row));
    setDocumentDirty(true);
    setCustomerPickerOpen(false);
    setCustomerPickerTargetId('');
  }, [customerPickerTargetId]);

  const changeReceiptHeader = useCallback((key, value) => {
    if (key === 'customcode') {
      const customer = receiptCustomers.find((item) => item.customercode === value);
      const customname = customer?.customername || '';
      setHeader((current) => ({ ...current, customcode: value || '', customname, other_dirty: true }));
      setRows((current) => current.map((row) => ({ ...row, customcode: value || '', customname, is_dirty: !row.is_new })));
    } else if (key === 'receptdate') {
      if (selectedReceiptno && value && header.min_receptdate && value < header.min_receptdate) {
        notifications.show({ title: '매출일자 확인', message: `${header.min_receptdate} 이후 날짜만 선택할 수 있습니다. (재고 입고일 · 월마감 기준)`, color: 'orange' });
        return;
      }
      setHeader((current) => ({ ...current, receptdate: value, other_dirty: true }));
      setRows((current) => current.map((row) => ({ ...row, receptdate: value, is_dirty: !row.is_new })));
    } else {
      setHeader((current) => ({
        ...current,
        [key]: value,
        ...(key === 'manager' ? { manager_dirty: true } : key === 'destination' ? { destination_dirty: true } : { other_dirty: true }),
      }));
    }
    setDocumentDirty(true);
  }, [receiptCustomers, selectedReceiptno, header.min_receptdate]);
  const markReceiptHeaderEdited = useCallback((key) => {
    setHeader((current) => ({
      ...current,
      ...(key === 'manager' ? { manager_dirty: true } : key === 'destination' ? { destination_dirty: true } : { other_dirty: true }),
    }));
    setDocumentDirty(true);
  }, []);

  const selectItem = useCallback((rowId, item) => {
    setRows((current) => current.map((row) => row.id === rowId
      ? { ...row, itemcode: item.itemcode || '', itemname: item.itemname || '', is_dirty: !row.is_new }
      : row));
    setDocumentDirty(true);
    setItemPickerTargetId('');
  }, []);

  const lookupItemNames = useCallback(async (itemcodes) => {
    const codes = [...new Set(itemcodes.map((code) => String(code || '').trim()).filter(Boolean))];
    if (!codes.length) return {};
    const { data } = await axios.post('/api/item-master/items/lookup', { itemcodes: codes }, authConfig());
    return Object.fromEntries((data.items || []).map((item) => [item.itemcode, item.itemname]));
  }, []);

  const openReceipt = useCallback(async (receiptno, allowDiscard = false) => {
    if (hasPendingChanges && !allowDiscard) {
      notifications.show({ title: '저장되지 않은 변경사항', message: '현재 매출 내용을 먼저 저장해 주세요.', color: 'orange' });
      return false;
    }
    openRequestRef.current.controller?.abort();
    const controller = new AbortController();
    const requestId = openRequestRef.current.id + 1;
    openRequestRef.current = { id: requestId, controller };
    const isLatest = () => openRequestRef.current.id === requestId;
    setOpeningReceiptno(receiptno);
    setDetailLoading(true);
    try {
      const { data } = await axios.get(`/api/outbound-register/receipts/${encodeURIComponent(receiptno)}`, { ...authConfig(), signal: controller.signal });
      // A newer click (or 추가) superseded this request: drop the stale response.
      if (!isLatest()) return false;
      const receipt = data.receipt;
      const loadedRows = (receipt.items || []).map((item) => makeDetail({
        ...item,
        weight: String(Math.round((Number(item.weight || 0) - Number(item.adjweight || 0)) * 1000) / 1000),
        adjweight: Number(item.adjweight || 0) ? String(Number(item.adjweight)) : '',
        sourcetype: item.stocksourcetype || '',
      }, item.lineno));
      const warehouseKeys = [...new Set(loadedRows.map((row) => row.warehousecode).filter(Boolean))];
      setHeader({
        receiptno: receipt.receiptno || '',
        receptdate: String(receipt.receptdate || '').slice(0, 10),
        customcode: receipt.customcode || '',
        customname: receipt.customname || '',
        warehousecode: warehouseKeys.length === 1 ? warehouseKeys[0] : '',
        warehousecodename: warehouseKeys.length === 1
          ? (loadedRows.find((row) => row.warehousecode === warehouseKeys[0])?.warehousecodename || '')
          : warehouseKeys.length > 1 ? `복수 창고 (${warehouseKeys.length})` : '',
        manager: receipt.manager || receipt.items?.[0]?.manager || '',
        destination: receipt.destination || '',
        description: receipt.description || '',
        manager_dirty: false,
        destination_dirty: false,
        other_dirty: false,
        edit_lock: receipt.edit_lock || '',                 // 수정 · 삭제를 막는 사유 (없으면 수정 가능)
        min_receptdate: receipt.min_receptdate || '',       // 바꿀 수 있는 가장 이른 매출일자 (마감 다음날 · 재고 입고일)
      });
      setReceiptMetadata({
        companyid: receipt.companyid || '',
        companyname: receipt.companyname || '',
        created_at: receipt.created_at || '',
        created_by: receipt.created_by || '',
        updated_at: receipt.updated_at || '',
      });
      setRows(loadedRows);
      setExpenses((receipt.expenses || []).map((expense) => makeExpense({ ...expense, is_new: false, is_dirty: false })));
      setSelectedExpenseIds([]);
      expenseSelectionAnchorRef.current = '';
      setSelectedReceiptno(receipt.receiptno);
      setSubulyn(receipt.subulyn || 'N');
      setDetailTab('details');
      setDocumentDirty(false);
      setSelectedIds([]);
      selectionAnchorRef.current = '';
      return true;
    } catch (error) {
      if (!isLatest()) return false;
      notifications.show({ title: '매출 상세 조회 실패', message: errorMessage(error), color: 'red' });
      return false;
    } finally {
      if (isLatest()) {
        openRequestRef.current.controller = null;
        setOpeningReceiptno('');
        setDetailLoading(false);
      }
    }
  }, [hasPendingChanges]);

  useEffect(() => {
    let cancelled = false;
    // 사용 중 매출처 전체: 캐시로 바로 채우고(초기값) 첫 쪽 뒤 나머지 쪽은 병렬로 받아 바꾼다 (매입등록과 같은 캐시)
    const loadCustomers = async () => {
      const customers = await loadMaster('customers:active', () => fetchAllPages(async (pageNumber) => {
        const { data } = await axios.get('/api/list', {
          ...authConfig(),
          params: { status: 'Y', page: pageNumber, page_size: 200, include_total: true },
        });
        return { items: data.data || [], total: data.total || 0 };
      }, 200));
      if (!cancelled) setReceiptCustomers(customers);
    };
    void loadCustomers().catch((error) => {
      if (!cancelled) notifications.show({ title: '매출처 조회 실패', message: errorMessage(error), color: 'red' });
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!pendingFocusIdRef.current) return;
    const id = pendingFocusIdRef.current;
    const rowIndex = rows.findIndex((row) => row.id === id);
    if (rowIndex >= 0) requestAnimationFrame(() => virtuosoRef.current?.scrollToIndex({ index: rowIndex, align: 'end', behavior: 'auto' }));
    const input = codeInputsRef.current.get(id);
    if (input) { input.focus(); pendingFocusIdRef.current = ''; }
  }, [rows]);

  const registerCodeInput = useCallback((id, element) => {
    if (element) {
      codeInputsRef.current.set(id, element);
      if (pendingFocusIdRef.current === id) { element.focus(); pendingFocusIdRef.current = ''; }
    } else codeInputsRef.current.delete(id);
  }, []);

  // ── 셀 범위 선택 (Shift+방향키 · Shift+클릭). 포커스는 시작 칸에 두고 범위만 칠한다 (다시 그리기 없이 DOM 클래스로) ──
  // rangeRef: { anchorId, anchorColumn, focusId, focusColumn } — 열 번호는 DETAIL_FIELDS 순서
  const rangeRef = useRef(null);
  const paintedCellsRef = useRef(new Set());
  const paintFrameRef = useRef(0);
  const cellByElementRef = useRef(new WeakMap());
  const getRangeBounds = useCallback(() => {
    const range = rangeRef.current;
    if (!range) return null;
    const currentRows = detailRowsRef.current;
    const anchorIndex = currentRows.findIndex((row) => row.id === range.anchorId);
    const focusIndex = range.focusId === range.anchorId ? anchorIndex : currentRows.findIndex((row) => row.id === range.focusId);
    if (anchorIndex < 0 || focusIndex < 0) return null;
    return {
      top: Math.min(anchorIndex, focusIndex), bottom: Math.max(anchorIndex, focusIndex),
      left: Math.min(range.anchorColumn, range.focusColumn), right: Math.max(range.anchorColumn, range.focusColumn),
    };
  }, []);
  const isMultiCellRange = useCallback((bounds = getRangeBounds()) => Boolean(bounds && (bounds.top !== bounds.bottom || bounds.left !== bounds.right)), [getRangeBounds]);
  const paintRange = useCallback(() => {
    paintFrameRef.current = 0;
    paintedCellsRef.current.forEach((cell) => cell.classList.remove(classes.rangeCell));
    paintedCellsRef.current.clear();
    const bounds = getRangeBounds();
    if (!isMultiCellRange(bounds)) return;
    const currentRows = detailRowsRef.current;
    for (let rowIndex = bounds.top; rowIndex <= bounds.bottom; rowIndex += 1) {
      for (let column = bounds.left; column <= bounds.right; column += 1) {
        const cell = cellInputsRef.current.get(`${currentRows[rowIndex].id}:${DETAIL_FIELDS[column].key}`)?.closest('td');
        if (cell) { cell.classList.add(classes.rangeCell); paintedCellsRef.current.add(cell); }
      }
    }
  }, [getRangeBounds, isMultiCellRange]);
  const schedulePaintRange = useCallback(() => {
    if (!paintFrameRef.current) paintFrameRef.current = requestAnimationFrame(paintRange);
  }, [paintRange]);
  const clearRange = useCallback(() => {
    if (!rangeRef.current && !paintedCellsRef.current.size) return;
    rangeRef.current = null;
    paintRange();
  }, [paintRange]);
  useEffect(() => { if (rangeRef.current) schedulePaintRange(); }, [rows, schedulePaintRange]);
  useEffect(() => () => { if (paintFrameRef.current) cancelAnimationFrame(paintFrameRef.current); }, []);

  const registerCellInput = useCallback((id, field, element) => {
    const key = `${id}:${field}`;
    if (element) {
      cellByElementRef.current.set(element, { id, field });
      if (rangeRef.current) schedulePaintRange();   // 가상 스크롤로 새로 그려진 칸도 범위 색을 입힌다
      cellInputsRef.current.set(key, element);
      if (pendingCellFocusRef.current?.key === key) {
        element.focus();
        pendingCellFocusRef.current = null;
      }
    } else cellInputsRef.current.delete(key);
  }, [schedulePaintRange]);

  const changeDetail = useCallback((id, key, value) => {
    if (key === 'unitprice' && selectedReceiptno) {
      setRows((current) => current.map((row) => row.id === id && !row.is_new
        ? { ...row, unitprice: value, price_dirty: true }
        : row));
      setDocumentDirty(true);
      return;
    }
    if (key === 'manager' && selectedReceiptno) {
      setRows((current) => current.map((row) => row.id === id
        ? { ...row, manager: value, manager_dirty: true }
        : row));
      setDocumentDirty(true);
      return;
    }
    const bulkField = key === 'unit' || key === 'qtyunit' || key === 'warehousecode';
    const applyToSelected = bulkField && selectedIds.length > 1 && selectedSet.has(id);
    const shouldUpdate = (row) => row.id === id || (applyToSelected && selectedSet.has(row.id));

    if (key === 'unit' || key === 'qtyunit') {
      if (applyToSelected) selectedIds.forEach((rowId) => masterPasteErrorsRef.current.delete(masterPasteErrorKey(rowId, key)));
      else masterPasteErrorsRef.current.delete(masterPasteErrorKey(id, key));
      const normalizedValue = resolveMasterCode(key, value, unitOptions) || value;
      setRows((current) => current.map((row) => shouldUpdate(row)
        ? { ...row, [key]: normalizedValue, is_dirty: !row.is_new }
        : row));
      setDocumentDirty(true);
      return;
    }
    if (key === 'warehousecode') {
      if (applyToSelected) selectedIds.forEach((rowId) => masterPasteErrorsRef.current.delete(masterPasteErrorKey(rowId, 'warehouse')));
      else masterPasteErrorsRef.current.delete(masterPasteErrorKey(id, 'warehouse'));
      const normalizedValue = resolveMasterCode('warehouse', value, unitOptions) || value;
      const option = unitOptions.warehouse.find((item) => item.code === normalizedValue);
      setRows((current) => current.map((row) => shouldUpdate(row)
        ? { ...row, warehousecode: normalizedValue, warehousecodename: option?.name || '', is_dirty: !row.is_new }
        : row));
      setDocumentDirty(true);
      return;
    }
    if (key !== 'itemcode') {
      setRows((current) => current.map((row) => row.id === id ? { ...row, [key]: value, is_dirty: !row.is_new } : row));
      setDocumentDirty(true);
      return;
    }

    const code = String(value || '').trim();
    setRows((current) => current.map((row) => row.id === id
      ? { ...row, itemcode: value, itemname: '', is_dirty: !row.is_new }
      : row));
    setDocumentDirty(true);
    const previousTimer = codeLookupTimersRef.current.get(id);
    if (previousTimer) clearTimeout(previousTimer);
    if (!code) { codeLookupTimersRef.current.delete(id); return; }

    const timer = setTimeout(async () => {
      codeLookupTimersRef.current.delete(id);
      try {
        const matches = await lookupItemNames([code]);
        const itemname = matches[code];
        if (!itemname) return;
        setRows((current) => current.map((row) => row.id === id && String(row.itemcode || '').trim() === code
          ? { ...row, itemname, is_dirty: !row.is_new }
          : row));
      } catch {
        // A code that is not in this company's item master stays blank for correction.
      }
    }, 220);
    codeLookupTimersRef.current.set(id, timer);
  }, [lookupItemNames, unitOptions, selectedIds, selectedSet, selectedReceiptno]);

  const setActiveCell = useCallback((id, field) => {
    const previous = activeCellRef.current;
    activeCellRef.current = { id, field };
    if (previous?.id !== id || previous?.field !== field) clearRange();
  }, [clearRange]);

  // Ctrl+D 아래로 채우기 (엑셀과 같음) — 입력 칸(조정·비고)만. 재고에서 온 칸(품목·수량·중량·단가·단위·창고 등)은 옮기지 않는다.
  //  - 셀 범위가 여러 행이면: 범위 맨 윗행 값을 범위 안 아래 행들에 (열마다)
  //  - 체크한 행이 있으면: 현재 칸 값을 그 아래 체크한 행들에
  //  - 그 밖에는: 바로 윗행 값을 현재 칸에
  const fillDown = useCallback(() => {
    const activeCell = activeCellRef.current;
    if (!activeCell || readOnly || saving) return;
    const bounds = getRangeBounds();
    const activeIndex = rows.findIndex((row) => row.id === activeCell.id);
    if (activeIndex < 0) return;
    const rangeFields = bounds ? editableFieldsBetween(bounds.left, bounds.right) : (EDITABLE_FIELD_SET.has(activeCell.field) ? [activeCell.field] : []);
    let sourceRow;
    let targetRows;
    let mode;
    if (bounds && bounds.bottom > bounds.top) {
      mode = 'range';
      sourceRow = rows[bounds.top];
      targetRows = rows.slice(bounds.top + 1, bounds.bottom + 1);
    } else if (selectedIds.length) {
      mode = 'selected';
      sourceRow = rows[activeIndex];
      targetRows = rows.filter((row, index) => index > activeIndex && selectedSet.has(row.id));
    } else {
      mode = 'above';
      sourceRow = rows[activeIndex - 1];
      targetRows = [rows[activeIndex]];
    }
    if (!sourceRow || !targetRows.length || !rangeFields.length) return;
    const updates = new Map(targetRows.map((row) => {
      const target = { ...row };
      rangeFields.forEach((field) => copyDetailField(target, sourceRow, field));
      target.is_dirty = !target.is_new;
      return [row.id, target];
    }));
    setRows((current) => current.map((row) => updates.get(row.id) || row));
    setDocumentDirty(true);
    if (mode !== 'above') {
      notifications.show({
        title: '아래로 채우기 완료',
        message: `${targetRows.length.toLocaleString()}개 행에 ${mode === 'range' ? '범위 맨 윗행' : '현재 칸'}의 값을 복사했습니다.`,
        color: 'teal',
      });
    }
  }, [readOnly, saving, selectedIds.length, rows, selectedSet, getRangeBounds]);

  // 범위 지우기 (Delete · 잘라내기): 조정·비고만 지운다
  const clearRangeCells = useCallback(() => {
    if (readOnly || saving) return;
    const bounds = getRangeBounds();
    if (!bounds) return;
    const fields = editableFieldsBetween(bounds.left, bounds.right);
    if (!fields.length) return;
    const targetIds = new Set(rows.slice(bounds.top, bounds.bottom + 1).map((row) => row.id));
    setRows((current) => current.map((row) => {
      if (!targetIds.has(row.id)) return row;
      const target = { ...row };
      fields.forEach((field) => clearDetailField(target, field));
      target.is_dirty = !target.is_new;
      return target;
    }));
    setDocumentDirty(true);
  }, [readOnly, saving, rows, getRangeBounds]);

  const rangeCopyText = useCallback(() => {
    const bounds = getRangeBounds();
    if (!bounds) return '';
    return rows.slice(bounds.top, bounds.bottom + 1)
      .map((row) => DETAIL_FIELDS.slice(bounds.left, bounds.right + 1).map(({ key }) => detailCopyText(row, key, unitOptions)).join('\t'))
      .join('\n');
  }, [rows, unitOptions, getRangeBounds]);

  const focusGridCell = useCallback((rowId, field) => {
    const cellKey = `${rowId}:${field}`;
    const input = cellInputsRef.current.get(cellKey);
    if (input) {
      input.focus();
      return;
    }
    const rowIndex = rows.findIndex((row) => row.id === rowId);
    if (rowIndex < 0) return;
    pendingCellFocusRef.current = { key: cellKey };
    virtuosoRef.current?.scrollToIndex({ index: rowIndex, align: 'center', behavior: 'auto' });
  }, [rows]);

  const moveGridCell = useCallback((rowId, field, rowDelta, columnDelta) => {
    const rowIndex = rows.findIndex((row) => row.id === rowId);
    if (rowIndex < 0) return false;
    let columnIndex = NAVIGABLE_FIELDS.indexOf(field);
    if (columnIndex < 0) {
      const fieldPosition = DETAIL_FIELDS.findIndex((item) => item.key === field);
      columnIndex = NAVIGABLE_FIELDS.findIndex((key) => DETAIL_FIELDS.findIndex((item) => item.key === key) > fieldPosition);
      if (columnIndex < 0) columnIndex = NAVIGABLE_FIELDS.length - 1;
    }
    let nextRow = rowIndex + rowDelta;
    let nextColumn = columnIndex + columnDelta;
    if (nextColumn < 0) { nextRow -= 1; nextColumn = NAVIGABLE_FIELDS.length - 1; }
    if (nextColumn >= NAVIGABLE_FIELDS.length) { nextRow += 1; nextColumn = 0; }
    if (nextRow < 0 || nextRow >= rows.length) return false;
    focusGridCell(rows[nextRow].id, NAVIGABLE_FIELDS[nextColumn]);
    return true;
  }, [rows, focusGridCell]);

  // 엑셀식 단축키 — 칸 자체 처리보다 먼저 받는다 (새 전표의 입력 칸에서만)
  const handleTableKeyDownCapture = useCallback((event) => {
    if (readOnly || event.nativeEvent.isComposing || event.keyCode === 229 || event.altKey) return;
    // 표 안의 Ctrl+D 는 채울 칸이 없어도(저장된 전표 등) 브라우저 즐겨찾기 추가로 넘기지 않는다
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'd') event.preventDefault();
    const activeCell = activeCellRef.current;
    if (!activeCell || !cellInputsRef.current.has(`${activeCell.id}:${activeCell.field}`)) return;
    const ctrl = event.ctrlKey || event.metaKey;
    const { key } = event;
    const arrow = key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight';
    const stop = () => { event.preventDefault(); event.stopPropagation(); };

    if (event.shiftKey && !ctrl && arrow) {
      // 좌/우는 글자 안에서 커서가 움직일 수 있으면 글자 선택으로 둔다 (이미 범위가 있거나 글자 끝·전체 선택일 때만 범위 확장)
      const target = event.target;
      if ((key === 'ArrowLeft' || key === 'ArrowRight') && !isMultiCellRange() && target instanceof HTMLInputElement && !target.readOnly && target.selectionStart !== null) {
        const { selectionStart: start, selectionEnd: end, value } = target;
        const allSelected = start === 0 && end === value.length;
        if (!allSelected && (key === 'ArrowLeft' ? start !== 0 : end !== value.length)) return;
      }
      const currentRows = detailRowsRef.current;
      const range = rangeRef.current || { anchorId: activeCell.id, anchorColumn: DETAIL_FIELD_INDEX[activeCell.field], focusId: activeCell.id, focusColumn: DETAIL_FIELD_INDEX[activeCell.field] };
      if (range.anchorColumn === undefined) return;
      const focusIndex = currentRows.findIndex((row) => row.id === range.focusId);
      if (focusIndex < 0) return;
      const nextIndex = Math.max(0, Math.min(currentRows.length - 1, focusIndex + (key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : 0)));
      const nextColumn = Math.max(0, Math.min(DETAIL_FIELDS.length - 1, range.focusColumn + (key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0)));
      stop();
      rangeRef.current = { ...range, focusId: currentRows[nextIndex].id, focusColumn: nextColumn };
      paintRange();
      const focusCell = cellInputsRef.current.get(`${currentRows[nextIndex].id}:${DETAIL_FIELDS[nextColumn].key}`)?.closest('td');
      if (focusCell) focusCell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      else virtuosoRef.current?.scrollToIndex({ index: nextIndex, align: 'center', behavior: 'auto' });
      return;
    }
    if (ctrl && !event.shiftKey && (key === 'ArrowUp' || key === 'ArrowDown')) {
      // Ctrl+위/아래: 맨 처음 / 마지막 행으로
      const currentRows = detailRowsRef.current;
      if (!currentRows.length) return;
      stop();
      focusGridCell(currentRows[key === 'ArrowUp' ? 0 : currentRows.length - 1].id, activeCell.field);
      return;
    }
    if (ctrl && key.toLowerCase() === 'd') { stop(); fillDown(); return; }
    if (ctrl && key === 'Enter') {
      // 매출 상세 행은 재고 라인에 묶여 있어 빈 행 삽입·복제를 하지 않는다
      stop();
      notifications.show({ title: '행 추가는 현재고 조회로', message: '매출 상세는 [현재고 조회]에서 재고를 담아야 행이 생깁니다. 빈 행 삽입·복제는 할 수 없습니다.', color: 'orange' });
      return;
    }
    if (key === 'Delete' && !ctrl && isMultiCellRange()) { stop(); clearRangeCells(); return; }
    if (key === 'Escape' && rangeRef.current) clearRange();   // 칸의 Esc 도 그대로 동작
  }, [readOnly, isMultiCellRange, paintRange, focusGridCell, fillDown, clearRangeCells, clearRange]);

  // Shift+클릭: 현재 칸부터 클릭한 칸까지 범위 선택 (포커스는 그대로). 그냥 클릭하면 범위를 푼다.
  // 보기 전용(비활성) 칸은 브라우저가 입력칸 대신 칸(td)에 클릭을 주기도 해서 칸 안의 입력칸으로 찾는다.
  const handleTableMouseDownCapture = useCallback((event) => {
    const origin = event.target instanceof Element ? event.target : null;
    const element = origin?.closest('input, select') || origin?.closest('td')?.querySelector('input, select');
    const cell = element ? cellByElementRef.current.get(element) : null;
    if (!event.shiftKey || !cell || readOnly) { if (rangeRef.current) clearRange(); return; }
    const activeCell = activeCellRef.current;
    if (!activeCell || !cellInputsRef.current.has(`${activeCell.id}:${activeCell.field}`)) return;
    const anchorColumn = DETAIL_FIELD_INDEX[activeCell.field];
    const focusColumn = DETAIL_FIELD_INDEX[cell.field];
    if (anchorColumn === undefined || focusColumn === undefined) return;
    event.preventDefault();
    rangeRef.current = { anchorId: rangeRef.current?.anchorId || activeCell.id, anchorColumn: rangeRef.current?.anchorColumn ?? anchorColumn, focusId: cell.id, focusColumn };
    paintRange();
  }, [readOnly, clearRange, paintRange]);

  // 범위 복사·잘라내기: 엑셀에 그대로 붙일 수 있는 탭 구분 글자
  const handleTableCopyCapture = useCallback((event) => {
    if (!isMultiCellRange()) return;
    event.preventDefault();
    event.clipboardData.setData('text/plain', rangeCopyText());
  }, [isMultiCellRange, rangeCopyText]);
  const handleTableCutCapture = useCallback((event) => {
    if (!isMultiCellRange()) return;
    event.preventDefault();
    event.clipboardData.setData('text/plain', rangeCopyText());
    clearRangeCells();
  }, [isMultiCellRange, rangeCopyText, clearRangeCells]);

  const handleTableKeyDown = useCallback((event) => {
    const target = event.target instanceof HTMLInputElement ? event.target : null;
    const activeCell = target?.dataset.rowId && target?.dataset.field
      ? { id: target.dataset.rowId, field: target.dataset.field }
      : activeCellRef.current;
    if (!activeCell) return;

    let rowDelta = 0;
    let columnDelta = 0;
    if (event.key === 'Enter') rowDelta = event.shiftKey ? -1 : 1;
    else if (event.key === 'Tab') columnDelta = event.shiftKey ? -1 : 1;
    else if (event.key === 'ArrowDown') rowDelta = 1;
    else if (event.key === 'ArrowUp') rowDelta = -1;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const atInput = target && target.selectionStart !== null;
      const hasSelection = atInput && target.selectionStart !== target.selectionEnd;
      const atBoundary = !atInput || target.readOnly || hasSelection
        ? !hasSelection
        : event.key === 'ArrowLeft' ? target.selectionStart === 0 : target.selectionEnd === target.value.length;
      if (!atBoundary) return;
      columnDelta = event.key === 'ArrowLeft' ? -1 : 1;
    } else return;

    if (moveGridCell(activeCell.id, activeCell.field, rowDelta, columnDelta)) event.preventDefault();
  }, [moveGridCell]);

  const selectMasterOption = useCallback((option) => {
    if (!masterPickerTarget) return;
    changeDetail(masterPickerTarget.id, masterPickerTarget.field, option.code);
    setMasterPickerTarget(null);
  }, [masterPickerTarget, changeDetail]);

  const openMasterPicker = useCallback((id, field) => {
    if (!readOnly && !saving) setMasterPickerTarget({ id, field });
  }, [readOnly, saving]);

  const addDetail = useCallback(() => {
    if (saving) return;
    if (selectedReceiptno && hasPendingChanges) {
      notifications.show({ title: '저장되지 않은 변경사항', message: '기존 전표의 변경사항을 먼저 저장하거나 취소한 뒤 새 매출를 시작해 주세요.', color: 'orange' });
      return;
    }
    cancelPendingOpen();
    // [추가]: 저장 전표를 보든, 현재고에서 담던 새 전표든 언제나 빈 새 전표로 초기화하고 매출처에 포커스 (목록은 펼치지 않음)
    {
      setHeader({ ...EMPTY_HEADER, receptdate: localDate() });
      setReceiptMetadata({ companyid: '', companyname: '', created_at: '', updated_at: '' });
      setRows([]);
      setExpenses([]);
      setSelectedExpenseIds([]);
      expenseSelectionAnchorRef.current = '';
      setSelectedReceiptno('');
      setSubulyn('N');
      setDetailTab('details');
      setDocumentDirty(false);
      setSelectedIds([]);
      selectionAnchorRef.current = '';
    }
    // 재고조회를 바로 띄우지 않는다: 매출일자 / 매출처 / 창고를 먼저 입력한 뒤 [현재고 조회]로 재고를 담는다.
    setDetailTab('details');
    setCustomerFocusTick((tick) => tick + 1);   // 그린 뒤(입력 가능해진 뒤) 매출처에 포커스
  }, [saving, selectedReceiptno, hasPendingChanges, cancelPendingOpen]);

  // [재고조회]: 매출일자·매출처를 먼저 입력해야 열린다. 창고를 고르면 그 창고 재고로 먼저 조회한다.
  const openStockLookup = useCallback(() => {
    if (saving) return;
    if (readOnly) {
      notifications.show({ title: '새 매출을 시작해 주세요', message: '저장된 전표에는 재고를 추가할 수 없습니다. [추가]를 누른 뒤 매출일자·매출처·창고를 입력하고 [현재고 조회]를 눌러 주세요.', color: 'orange' });
      return;
    }
    const missing = [];
    if (!String(header.receptdate || '').trim()) missing.push('매출일자');
    if (!String(header.customcode || '').trim()) missing.push('매출처');
    if (missing.length) {
      notifications.show({ title: '매출 기본을 먼저 입력해 주세요', message: `${missing.join(', ')}을(를) 입력한 뒤 [현재고 조회]를 눌러 주세요.`, color: 'orange' });
      if (!String(header.customcode || '').trim()) focusHeaderCustomer();
      return;
    }
    setStockPickerOpen(true);
  }, [saving, readOnly, header.receptdate, header.customcode, focusHeaderCustomer]);
  // 재고조회 기본 조건: 기준일 종료 = 매출일자 (그 뒤에 들어온 재고는 이 날짜로 매출할 수 없음), 창고 = 헤더 창고
  const stockPickerFilters = useMemo(() => {
    const saleDate = String(header.receptdate || '').slice(0, 10);
    const filters = {};
    if (saleDate) {
      filters.date_to = saleDate;
      const thisMonthStart = `${localDate().slice(0, 8)}01`;
      filters.date_from = thisMonthStart <= saleDate ? thisMonthStart : `${saleDate.slice(0, 8)}01`;
    }
    if (header.warehousecode && !rows.length) filters.warehouse_search = header.warehousecodename || header.warehousecode;
    return filters;
  }, [header.receptdate, header.warehousecode, header.warehousecodename, rows.length]);

  const handleAddAction = useCallback(() => {
    if (selectedReceiptno) {
      addDetail();
      return;
    }
    if (detailTab === 'expenses') addExpense();
    else addDetail();
  }, [selectedReceiptno, detailTab, addExpense, addDetail]);

  const applyAvailableStocks = useCallback((stocks) => {
    const addedRows = stocks.map((stock) => makeDetail({
      ...stock,
      customcode: header.customcode || '',
      customname: header.customname || '',
      receptdate: header.receptdate || localDate(),
      stocksourcetype: stock.sourcetype,
      stocksourceno: stock.sourceno,
      stocksourceline: stock.sourceline,
      sourcecustomname: stock.sourcecustomname || stock.customname || '',
      current_qty: String(stock.available_qty ?? 0),
      current_weight: String(stock.available_weight ?? 0),
      qtyunit: stock.qtyunit || '',
      warehousecode: stock.warehousecode || '',
      warehousecodename: stock.warehousecodename || '',
      unit: stock.unit || unitOptions.price[0]?.code || '',
      unitprice: String(stock.unitprice ?? ''),
      adjweight: '',
    }));
    if (!addedRows.length) return;
    const nextRows = [...rows, ...addedRows];
    const warehouses = [...new Map(nextRows.filter((row) => row.warehousecode).map((row) => [row.warehousecode, row.warehousecodename || row.warehousecode])).entries()];
    setHeader((current) => ({
      ...current,
      warehousecode: warehouses.length === 1 ? warehouses[0][0] : '',
      warehousecodename: warehouses.length === 1 ? warehouses[0][1] : warehouses.length > 1 ? `복수 창고 (${warehouses.length})` : '',
    }));
    setRows((current) => [...current, ...addedRows]);
    setSelectedIds(addedRows.map((row) => row.id));
    setDocumentDirty(true);
    setStockPickerOpen(false);
    selectionAnchorRef.current = '';
    requestAnimationFrame(() => {
      virtuosoRef.current?.scrollToIndex({ index: rows.length + addedRows.length - 1, align: 'end', behavior: 'auto' });
      if (detailScrollerRef.current) detailScrollerRef.current.scrollTop = detailScrollerRef.current.scrollHeight;
    });
  }, [rows, header.customcode, header.customname, header.receptdate, unitOptions.price]);

  const toggleSelection = useCallback((id, shiftKey = false) => {
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
  const toggleAll = useCallback((checked) => {
    setSelectedIds(checked ? rows.map((row) => row.id) : []);
    selectionAnchorRef.current = '';
  }, [rows]);


  const pasteRange = useCallback((startId, startField, pastedText) => {
    const matrix = pastedText.replace(/\r/g, '').split('\n').filter((line, index, all) => line || index < all.length - 1).map((line) => line.split('\t'));
    const startIndex = rows.findIndex((row) => row.id === startId);
    const fieldIndex = EDITABLE_FIELDS.indexOf(startField);
    if (startIndex < 0 || fieldIndex < 0 || readOnly) return;
    if (startIndex + matrix.length > rows.length) {
      notifications.show({ title: '매출 재고 행 확인', message: '엑셀 붙여넣기는 현재고 조회에서 추가한 행에만 적용할 수 있습니다.', color: 'orange' });
      return;
    }
    if (startIndex + matrix.length > 10000) {
      notifications.show({ title: '붙여넣기 제한', message: '한 번에 최대 10,000행까지 입력할 수 있습니다.', color: 'orange' });
      return;
    }
    const next = [...rows];
    const append = [];
    const codeLookups = [];
    matrix.forEach((line, offset) => {
        const target = next[startIndex + offset] ? { ...next[startIndex + offset] } : makeDetail();
        line.forEach((value, columnOffset) => {
          const key = EDITABLE_FIELDS[fieldIndex + columnOffset];
          if (key === 'itemcode') {
            target.itemcode = value;
            target.itemname = '';
            codeLookups.push({ id: target.id, code: String(value || '').trim() });
            const previousTimer = codeLookupTimersRef.current.get(target.id);
            if (previousTimer) clearTimeout(previousTimer);
            codeLookupTimersRef.current.delete(target.id);
          } else if (key === 'unit' || key === 'qtyunit' || key === 'warehousecode' || key === 'warehousecodename') {
            const masterField = key === 'warehousecode' || key === 'warehousecodename' ? 'warehouse' : key;
            const errorField = masterField === 'warehouse' ? 'warehouse' : key;
            const code = resolveMasterCode(masterField, value, unitOptions);
            const rawValue = String(value ?? '').trim();
            if (rawValue && !code) {
              if (masterField === 'warehouse') {
                target.warehousecode = '';
                target.warehousecodename = '';
              } else target[key] = '';
              masterPasteErrorsRef.current.set(masterPasteErrorKey(target.id, errorField), rawValue);
            } else if (masterField === 'warehouse' && key === 'warehousecodename' && !rawValue) {
              // The warehouse name is derived from the code; a blank copied name must not erase a valid code.
            } else if (masterField === 'warehouse') {
              const option = unitOptions.warehouse.find((item) => item.code === code);
              target.warehousecode = code;
              target.warehousecodename = option?.name || '';
              masterPasteErrorsRef.current.delete(masterPasteErrorKey(target.id, errorField));
            } else {
              target[key] = code;
              masterPasteErrorsRef.current.delete(masterPasteErrorKey(target.id, errorField));
            }
          } else if (key && key !== 'itemname' && key !== 'unitamt') {
            // 조정(kg)은 손으로 칠 때처럼 부호(+/-)를 지킨다 (예전에는 붙여넣으면 '-' 가 빠져 빼야 할 중량이 더해졌다)
            target[key] = key === 'adjweight' ? cleanSignedInput(value) : NUMERIC_FIELDS.has(key) ? cleanNumericInput(value) : value;
          }
        });
        target.is_dirty = !target.is_new;
        if (next[startIndex + offset]) next[startIndex + offset] = target;
        else append.push(target);
    });
    setRows([...next, ...append]);
    setDocumentDirty(true);
    const codes = codeLookups.map(({ code }) => code);
    if (codes.some(Boolean)) {
      lookupItemNames(codes).then((matches) => {
        const namesByCode = new Map(Object.entries(matches).map(([code, name]) => [code.toLocaleLowerCase(), name]));
        const lookupsById = new Map(codeLookups.map((entry) => [entry.id, entry]));
        setRows((current) => current.map((row) => {
          const requested = lookupsById.get(row.id);
          if (!requested || String(row.itemcode || '').trim() !== requested.code) return row;
          const itemname = namesByCode.get(requested.code.toLocaleLowerCase());
          return itemname ? { ...row, itemname, is_dirty: !row.is_new } : row;
        }));
      }).catch(() => {});
    }
  }, [rows, readOnly, lookupItemNames, unitOptions]);

  // 범위를 고른 채 붙여넣기 — 범위 안의 입력 칸(조정·비고)에만:
  // 엑셀 범위는 범위 맨 윗행의 첫 입력 칸부터, 값 하나는 범위의 입력 칸 전체에 채운다
  const handleTablePasteCapture = useCallback((event) => {
    if (readOnly || saving || !isMultiCellRange()) return;
    const bounds = getRangeBounds();
    const text = event.clipboardData.getData('text/plain');
    event.preventDefault();
    event.stopPropagation();
    const fields = editableFieldsBetween(bounds.left, bounds.right);
    if (!fields.length) {
      notifications.show({ title: '붙여넣을 칸 없음', message: '매출 상세에서 붙여넣을 수 있는 칸은 조정(kg)·비고입니다.', color: 'orange' });
      return;
    }
    const startId = detailRowsRef.current[bounds.top].id;
    if (isMultiCellText(text)) { pasteRange(startId, fields[0], text); return; }
    const value = text.replace(/\r?\n$/, '');
    if (!value.trim()) { clearRangeCells(); return; }
    const line = Array(fields.length).fill(value).join('\t');
    pasteRange(startId, fields[0], Array(bounds.bottom - bounds.top + 1).fill(line).join('\n'));
  }, [readOnly, saving, isMultiCellRange, getRangeBounds, pasteRange, clearRangeCells]);

  const validateDocument = useCallback(() => {
    const missing = [];
    if (!String(header.receptdate || '').trim()) missing.push('매출일자');
    if (!String(header.customcode || '').trim()) missing.push('매출처');
    if (selectedReceiptno && !header.receiptno.trim()) missing.push('매출전표번호');
    if (!rows.length) missing.push('상세 품목');
    const invalidExpense = expenses
      .map((expense, index) => ({
        index,
        missing: [
          !(String(expense.costcode || '').trim() || String(expense.costname || '').trim()) && '비용구분',
          !String(expense.supplyamt ?? '').trim() && '공급가',
          !String(expense.vat ?? '').trim() && '부가세',
          // 비용여부 '예'는 지급할 거래처가 필수
          expense.purchaseyn === 'Y' && !(String(expense.customcode || '').trim() || String(expense.customname || '').trim()) && '거래처',
        ].filter(Boolean),
      }))
      .find(({ missing }) => missing.length > 0);
    if (invalidExpense) {
      notifications.show({
        title: '기타비용 입력 확인',
        message: `${invalidExpense.index + 1}행 ${invalidExpense.missing.join(', ')} 입력이 필요합니다.`,
        color: 'orange',
        position: 'bottom-right',
      });
      setDetailTab('expenses');
      return false;
    }
    // 비용여부 '예'는 다른 거래처(운송사 등)에 지급하는 비용: 매출처를 거래처로 쓸 수 없음
    const salesCode = String(header.customcode || '').trim().toLowerCase();
    const salesName = String(header.customname || '').trim().toLowerCase();
    const sameCustomerIndex = expenses.findIndex((expense) => {
      if (expense.purchaseyn !== 'Y') return false;
      const code = String(expense.customcode || '').trim().toLowerCase();
      const name = String(expense.customname || '').trim().toLowerCase();
      return (salesCode && code === salesCode) || (!code && salesName && name === salesName);
    });
    if (sameCustomerIndex >= 0) {
      notifications.show({
        title: '기타비용 거래처 확인',
        message: `${sameCustomerIndex + 1}행: 비용여부 '예'의 거래처는 매출처와 다른 거래처를 입력해 주세요. 매출처 부담이면 '아니오'로 선택해 주세요.`,
        color: 'orange',
        position: 'bottom-right',
        autoClose: 8000,
      });
      setDetailTab('expenses');
      return false;
    }
    if (missing.length) {
      notifications.show({ title: '필수 항목을 입력해 주세요', message: missing.join(', '), color: 'orange' });
      return false;
    }
    const failures = rows.flatMap((row, index) => {
      const errors = [];
      if (!String(row.stocksourcetype || '').trim() || !String(row.stocksourceno || '').trim() || !String(row.stocksourceline ?? '').trim()) errors.push('원천 재고 라인');
      if (!String(row.unit || '').trim()) errors.push('단가기준');
      const qtyText = String(row.qty ?? '').trim();
      const qty = Number(qtyText);
      if (!qtyText || !Number.isFinite(qty) || qty <= 0) errors.push('수량(0 초과)');
      const weight = Number(row.weight);
      if (!String(row.weight || '').trim() || !Number.isFinite(weight) || weight <= 0) errors.push('중량(0 초과)');
      else {
        const total = totalWeightOf(row);
        const stockWeight = Number(cleanNumericInput(row.current_weight));
        if (!Number.isFinite(total) || total <= 0) errors.push('총중량(0 초과)');
        else if (row.is_new && total > stockWeight + 1e-9) errors.push(`총중량이 현재고중량(${stockWeight.toLocaleString(undefined, { maximumFractionDigits: 2 })}kg) 초과`);
      }
      const unitprice = Number(row.unitprice);
      if (!String(row.unitprice || '').trim() || !Number.isFinite(unitprice) || unitprice < 0) errors.push('판매단가(0 이상)');
      return errors.length ? [`${index + 1}행 ${errors.join(', ')}`] : [];
    });
    if (failures.length) {
      notifications.show({ title: '상세 입력을 확인해 주세요', message: failures.slice(0, 5).join(' / '), color: 'orange', autoClose: 8000 });
      return false;
    }
    return true;
  }, [header, rows, selectedReceiptno, expenses]);

  const validateDetailMasters = useCallback((sourceRows) => {
    const errors = [];
    sourceRows.forEach((row, index) => {
      const checks = [
        { field: 'unit', label: '단가단위', required: true, errorKey: 'unit' },
      ];
      checks.forEach(({ field, label, required, errorKey }) => {
        const value = String(row[field] ?? '').trim();
        const pastedValue = masterPasteErrorsRef.current.get(masterPasteErrorKey(row.id, errorKey));
        const invalidValue = pastedValue || value;
        const invalid = pastedValue || (required && !value) || (value && !resolveMasterCode(field, value, unitOptions));
        if (invalid) errors.push(`${index + 1}행 ${label}: ${invalidValue || '미입력'}`);
      });
    });
    if (errors.length) {
      const shownErrors = errors.slice(0, 5).join(' · ');
      const remainingCount = errors.length - 5;
      notifications.show({
        title: '코드 확인 필요',
        message: `${shownErrors}${remainingCount > 0 ? ` 외 ${remainingCount}건` : ''}. 사용 가능한 코드인지 확인해 주세요.`,
        color: 'orange',
        autoClose: 8000,
      });
      return false;
    }
    return true;
  }, [unitOptions]);

  const saveDocument = useCallback(async () => {
    const priceRows = selectedReceiptno ? rows.filter((row) => row.price_dirty && !row.is_new) : [];
    const hasLightChanges = hasManagerChanges || Boolean(header.destination_dirty) || priceRows.length > 0;
    if (selectedReceiptno && hasLightChanges && !header.other_dirty && !hasNewDetails && !rows.some((row) => row.is_dirty) && !hasPendingExpenses && !locked) {
      const badPrice = priceRows.find((row) => {
        const text = cleanNumericInput(row.unitprice);
        return !text || !Number.isFinite(Number(text)) || Number(text) < 0;
      });
      if (badPrice) {
        notifications.show({ title: '판매단가 확인', message: `${badPrice.lineno}행 판매단가를 0 이상으로 입력해 주세요.`, color: 'orange' });
        return false;
      }
      setSaving(true);
      try {
        const { data } = await axios.patch(
          `/api/outbound-register/receipts/${encodeURIComponent(selectedReceiptno)}/sales-fields`,
          {
            ...(hasManagerChanges ? { manager: String(header.manager || '').trim() } : {}),
            ...(header.destination_dirty ? { destination: String(header.destination || '').trim() } : {}),
            prices: priceRows.map((row) => ({ lineno: Number(row.lineno), unitprice: String(Number(Number(cleanNumericInput(row.unitprice)).toFixed(2))) })),
          },
          authConfig(),
        );
        if (isApprovalPending(data)) {
          notifyApprovalPending(data);
          await openReceipt(selectedReceiptno, true);
          return true;
        }
        // 전표 다시 열기 + 목록 금액 갱신을 함께
        await Promise.all([openReceipt(selectedReceiptno, true), loadReceipts(page, filters)]);
        const changed = [hasManagerChanges && '담당자', header.destination_dirty && '착지', data.price_count > 0 && `판매단가 ${data.price_count}행`].filter(Boolean);
        notifications.show({
          title: '매출전표 수정 완료',
          message: `${changed.join(' · ') || '변경 내용'}을(를) 반영했습니다. 재고와 원가는 그대로입니다.`,
          color: 'teal',
        });
        return true;
      } catch (error) {
        notifications.show({ title: '매출전표 수정 실패', message: errorMessage(error), color: 'red', autoClose: 9000 });
        return false;
      } finally {
        setSaving(false);
      }
    }
    if (locked) {
      notifications.show({ title: '수정할 수 없는 전표', message: confirmed ? '수불 확정된 매출전표는 수정할 수 없습니다.' : header.edit_lock, color: 'orange' });
      return false;
    }
    if (selectedReceiptno && !hasPendingChanges) {
      notifications.show({ title: '저장할 변경사항이 없습니다', message: '현재고 조회에서 매출할 재고를 추가한 뒤 저장해 주세요.', color: 'orange' });
      return false;
    }
    const sourceHeader = header;
    const sourceRows = rows;
    if (!validateDetailMasters(sourceRows)) return false;
    if (!validateDocument()) return false;
    setSaving(true);
    try {
      const payload = {
        ...sourceHeader,
        receptdate: sourceHeader.receptdate,
        customcode: String(sourceHeader.customcode || '').trim(),
        customname: String(sourceHeader.customname || '').trim(),
        manager: String(sourceHeader.manager || '').trim(),
        destination: String(sourceHeader.destination || '').trim(),
        is_new: !selectedReceiptno,
        // 새 전표: 중복 저장 막기 키 / 저장된 전표 수정: 열 때 받은 수정시각 (그 사이 다른 사람이 고쳤으면 서버가 거절)
        ...(selectedReceiptno
          ? { expected_updated_at: receiptMetadata.updated_at || receiptMetadata.created_at || undefined }
          : { request_key: requestKey.take() }),
        items: sourceRows.map((row) => ({
          stocksourcetype: String(row.stocksourcetype || '').trim(),
          stocksourceno: String(row.stocksourceno || '').trim(),
          stocksourceline: Number(row.stocksourceline),
          description: String(row.description || '').trim(),
          warehousecode: String(row.warehousecode || '').trim(),
          warehousecodename: String(row.warehousecodename || '').trim(),
          unit: resolveMasterCode('unit', row.unit, unitOptions) || String(row.unit || '').trim(),
          qty: String(row.qty ?? '').trim(),
          // weight = 총중량 (현재고·수불장 반영), adjweight = 조정
          weight: String(Number(totalWeightOf(row).toFixed(3))),
          adjweight: String(Number(signedNumber(row.adjweight).toFixed(3))),
          unitprice: String(Number(Number(cleanNumericInput(row.unitprice)).toFixed(2))),
        })),
        expenses: expenses.map((expense) => {
          const isCost = expense.purchaseyn === 'Y';
          return {
          costcode: String(expense.costcode || '').trim(),
          costname: String(expense.costname || '').trim(),
          supplyamt: expenseAmount2(expense.supplyamt),   // 서버: 소수 둘째 자리까지
          vat: expenseAmount2(expense.vat),
          // 비용여부 '아니오' = 매출처 부담 → 매출 헤더의 매출처로 저장
          customcode: String((isCost ? expense.customcode : sourceHeader.customcode) || '').trim(),
          customname: String((isCost ? expense.customname : sourceHeader.customname) || '').trim(),
          purchaseyn: isCost ? 'Y' : 'N',
          description: String(expense.description || '').trim(),
          };
        }),
      };
      const saveRequest = selectedReceiptno
        ? axios.put('/api/outbound-register/receipts', payload, authConfig())
        : axios.post('/api/outbound-register/receipts', payload, authConfig());
      const { data } = await saveRequest;
      requestKey.reset();
      masterPasteErrorsRef.current.clear();
      // 승인 통제: 승인요청으로 보관 · 재고 예약됨 → 입력칸을 비운다 (승인되면 전표가 생김)
      if (isApprovalPending(data)) {
        notifyApprovalPending(data);
        if (selectedReceiptno) await openReceipt(selectedReceiptno, true);
        else {
          setHeader({ ...EMPTY_HEADER, receptdate: localDate() });
          setReceiptMetadata({ companyid: '', companyname: '', created_at: '', updated_at: '' });
          setRows([]); setExpenses([]); setSelectedExpenseIds([]); expenseSelectionAnchorRef.current = ''; setSubulyn('N'); setDocumentDirty(false); setDetailTab('details');
        }
        return true;
      }
      notifications.show({
        title: '매출 저장 완료',
        message: data.group_count > 1
          ? `${data.group_count}개 매출전표 등록 완료 (${(data.receipt_numbers || []).join(', ')}) / 상세 ${data.saved_count}건`
          : `${data.receiptno} 전표의 상세 ${data.saved_count}건을 저장했습니다.`,
        color: 'teal',
      });
      // 저장한 전표가 목록에 보이게: 매출일자가 이번 달이 아니면 그 달로 조회하고, 그 전표가 있는 쪽을 연다
      const defaultFilters = createDefaultReceiptFilters();
      const savedDate = String(sourceHeader.receptdate || '').slice(0, 10);
      if (savedDate && (savedDate < defaultFilters.date_from || savedDate > defaultFilters.date_to)) {
        const [year, month] = savedDate.split('-').map(Number);
        defaultFilters.date_from = `${savedDate.slice(0, 8)}01`;
        defaultFilters.date_to = `${savedDate.slice(0, 8)}${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`;
      }
      setFilters(defaultFilters);
      setFilterInputs(defaultFilters);
      await loadReceipts(1, defaultFilters, pageSize, data.receiptno);
      await openReceipt(data.receiptno, true);
      return true;
    } catch (error) {
      notifications.show({ title: '매출 저장 실패', message: errorMessage(error), color: 'red', autoClose: 9000 });
      return false;
    } finally {
      setSaving(false);
    }
  }, [locked, confirmed, selectedReceiptno, hasManagerChanges, hasNewDetails, hasPendingExpenses, hasPendingChanges, rows, expenses, header, unitOptions, validateDetailMasters, validateDocument, loadReceipts, openReceipt, pageSize, page, filters, receiptMetadata, requestKey]);

  const exportDocument = useCallback(async () => {
    if (!header.receiptno || !rows.length) {
      notifications.show({ title: '다운로드할 매출전표 없음', message: '먼저 저장된 매출전표를 선택해 주세요.', color: 'orange' });
      return;
    }
    setExporting(true);
    try {
      const XLSX = await loadXLSXOrNotify();
      if (!XLSX) return;
      const workbook = XLSX.utils.book_new();
      // 매입등록 엑셀과 같은 틀: No. / 전표 / 일자 / 거래처 / 창고 / 담당자 (+ 착지) / 상세 칸 / 등록·수정 정보
      // 창고는 행마다 (한 매출전표에 창고가 여럿일 수 있음). 현재고 수량·중량은 저장 시점 값이 아니라 빼고, 창고는 앞쪽 칸과 겹쳐 뺀다.
      const exportFields = [
        ['No.', (_, index) => index + 1],
        ['매출전표', () => header.receiptno || ''],
        ['매출일자', () => header.receptdate || ''],
        ['매출처', () => header.customname || ''],
        ['창고', (row) => row.warehousecodename || header.warehousecodename || ''],
        ['담당자', () => header.manager || ''],
        ['착지', () => header.destination || ''],
        ...DETAIL_FIELDS.filter(({ key }) => !['current_qty', 'current_weight', 'warehousecodename'].includes(key)).map(({ key, label }) => [
          label,
          (row) => {
            const value = key === 'supplyamt' ? amountOf(row, unitOptions.price)
              : key === 'totalweight' ? totalWeightOf(row)
                : key === 'adjweight' ? signedNumber(row.adjweight)
                  : key === 'vat' ? vatAmountOf(row, unitOptions.price)
                    : key === 'unitamt' ? totalAmountOf(row, unitOptions.price) : row[key] ?? '';
            // 숫자 칸은 엑셀에서 계산·합계가 되도록 숫자로 넣는다
            if (EXCEL_NUMBER_KEYS.has(key) && String(value ?? '').trim() !== '') {
              const number = Number(String(value).replace(/,/g, ''));
              return Number.isFinite(number) ? number : value;
            }
            return value;
          },
        ]),
        ['등록일자', (row) => formatExcelDateTime(row.created_at)],
        ['등록자', (row) => row.created_by ?? ''],
        ['수정일자', (row) => formatExcelDateTime(row.updated_at)],
        ['수정자', (row) => row.updated_by ?? ''],
      ];
      const worksheet = XLSX.utils.aoa_to_sheet([
        exportFields.map(([label]) => label),
        ...rows.map((row, index) => exportFields.map(([, getValue]) => getValue(row, index))),
      ]);
      applyExcelHeaderStyle(worksheet, exportFields.length);
      worksheet['!cols'] = exportFields.map(([label]) => ({ wch: Math.min(28, Math.max(14, String(label).length + 4)) }));
      worksheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: exportFields.length - 1 } }) };
      XLSX.utils.book_append_sheet(workbook, worksheet, '매출내역');
      // 매입등록과 같이 두 번째 시트: 매출등록 기타비용 탭과 같은 칸 (비용여부 '아니오' 거래처 = 매출처)
      if (expenses.length) {
        const expenseAmount = (value) => Number(cleanNumericInput(value)) || 0;
        const expenseFields = [
          ['No.', (_, index) => index + 1],
          ['비용 구분', (expense) => expense.costname || ''],
          ['공급가', (expense) => expenseAmount(expense.supplyamt)],
          ['부가세', (expense) => expenseAmount(expense.vat)],
          ['합계금액', (expense) => Math.round((expenseAmount(expense.supplyamt) + expenseAmount(expense.vat)) * 100) / 100],
          ['거래처', (expense) => (expense.purchaseyn === 'Y' ? expense.customname || '' : header.customname || '')],
          ['비용여부', (expense) => (expense.purchaseyn === 'Y' ? '예' : '아니오')],
          ['비고', (expense) => expense.description || ''],
        ];
        const expenseSheet = XLSX.utils.aoa_to_sheet([
          expenseFields.map(([label]) => label),
          ...expenses.map((expense, index) => expenseFields.map(([, getValue]) => getValue(expense, index))),
        ]);
        applyExcelHeaderStyle(expenseSheet, expenseFields.length);
        expenseSheet['!cols'] = expenseFields.map(([label]) => ({ wch: Math.min(28, Math.max(14, String(label).length + 4)) }));
        XLSX.utils.book_append_sheet(workbook, expenseSheet, '기타비용');
      }
      const safeFilePart = (value) => {
        const invalidCharacters = '<>:"/\\|?*';
        const safePart = [...String(value || '').trim()]
          .map((character) => character.charCodeAt(0) < 32 || invalidCharacters.includes(character) ? '_' : character)
          .join('')
          .replace(/\s+/g, '_');
        return safePart || '미입력';
      };
      XLSX.writeFile(workbook, `매출전표_${safeFilePart(rows[0]?.customname || rows[0]?.customcode)}_${safeFilePart(rows[0]?.receptdate || header.receptdate)}_${safeFilePart(header.receiptno)}.xlsx`);
    } finally { setExporting(false); }
  }, [header, rows, expenses, unitOptions.price]);

  const runSearch = useCallback(() => {
    const nextFilters = Object.fromEntries(Object.entries(filterInputs).map(([key, value]) => [key, String(value || '').trim()]));
    if (nextFilters.date_from && nextFilters.date_to && nextFilters.date_from > nextFilters.date_to) {
      notifications.show({ title: '날짜 범위 확인', message: '시작일이 종료일보다 뒤에 올 수 없습니다.', color: 'orange' });
      return;
    }
    setFilters(nextFilters);
    setPage(1);
    loadReceipts(1, nextFilters);
  }, [filterInputs, loadReceipts]);

  const copySelectedDetails = useCallback(() => {
    if (readOnly || saving || selectedIds.length !== 1) return;
    const source = rows.find((row) => row.id === selectedIds[0]);
    if (!source) return;
    const copy = makeDetail(Object.fromEntries(
      Object.keys(EMPTY_DETAIL).map((key) => [key, source[key] ?? EMPTY_DETAIL[key]]),
    ));
    pendingFocusIdRef.current = copy.id;
    setRows((current) => [...current, copy]);
    setSelectedIds([copy.id]);
    setDocumentDirty(true);
    notifications.show({ title: '상세 행 복사 완료', message: '선택한 행을 그대로 복사해 상세에 추가했습니다.', color: 'teal' });
  }, [readOnly, saving, selectedIds, rows]);

  const removeSelectedDraftDetails = useCallback(() => {
    if (saving || !selectedIds.length) return;
    const selected = new Set(selectedIds);
    const removedCount = rows.filter((row) => row.is_new && selected.has(row.id)).length;
    if (!removedCount) return;
    const remainingRows = rows.filter((row) => !(row.is_new && selected.has(row.id)));
    setRows(remainingRows);
    setSelectedIds((current) => current.filter((id) => remainingRows.some((row) => row.id === id)));
    setDocumentDirty(remainingRows.some((row) => row.is_new || row.is_dirty));
    selectionAnchorRef.current = '';
    notifications.show({ title: '선택 행 제거 완료', message: `저장 전 재고 ${removedCount}행을 매출 상세에서 제거했습니다.`, color: 'teal' });
  }, [saving, selectedIds, rows]);

  const [deleteBlocked, setDeleteBlocked] = useState('');   // 삭제할 수 없는 사유 (삭제 창에 표시)
  const requestToolbarDelete = useCallback(() => {
    if (detailTab === 'expenses') {
      if (selectedExpenseIds.length) removeSelectedExpenses();
      else notifications.show({ title: '삭제할 행을 선택해 주세요', message: '기타비용 표에서 삭제할 행을 선택한 뒤 상단 삭제를 눌러 주세요.', color: 'orange' });
      return;
    }
    if (!selectedReceiptno) {
      if (selectedIds.length) {
        removeSelectedDraftDetails();
        return;
      }
      notifications.show({ title: '삭제할 행을 선택해 주세요', message: '저장 전에는 매출 상세에서 삭제할 행을 선택한 뒤 최상단 삭제를 눌러 주세요.', color: 'orange' });
      return;
    }
    if (hasPendingChanges) {
      notifications.show({ title: '저장되지 않은 변경사항', message: '삭제 전에 현재 변경사항을 먼저 정리해 주세요.', color: 'orange' });
      return;
    }
    // 매입등록과 같게: 먼저 삭제 확인 → [삭제]를 눌렀는데 막히면(월마감 · 승인 대기 등) 같은 창에 사유
    setDeleteBlocked('');
    setDeleteOpen(true);
  }, [detailTab, selectedExpenseIds.length, removeSelectedExpenses, selectedReceiptno, selectedIds.length, removeSelectedDraftDetails, hasPendingChanges]);

  const ribbonActionsRef = useRef({});
  ribbonActionsRef.current = { runSearch, handleAddAction, copySelectedDetails, exportDocument, saveDocument, requestToolbarDelete, closeActivePage };
  const invokeRibbonAction = useCallback((action) => ribbonActionsRef.current[action]?.(), []);
  const hasExportableRows = Boolean(selectedReceiptno && rows.length);

  useEffect(() => {
    if (!registerPageRibbon) return undefined;
    registerPageRibbon(
      <Group className={inboundClasses.commandRibbon} justify="flex-start" wrap="nowrap" gap={2}>
        <Button className={inboundClasses.ribbonTool} variant="subtle" size="sm" leftSection={<IconSearch size={15} />} onClick={() => invokeRibbonAction('runSearch')} loading={loading}>조회</Button>
        <span className={inboundClasses.ribbonSeparator} />
        <Button className={inboundClasses.ribbonTool} variant="subtle" size="sm" leftSection={<IconPlus size={15} />} onClick={() => invokeRibbonAction('handleAddAction')} disabled={saving}>&#xCD94;&#xAC00;</Button>
        <Button className={inboundClasses.ribbonTool} variant="subtle" size="sm" leftSection={<IconCopy size={15} />} onClick={() => invokeRibbonAction('copySelectedDetails')} disabled>복사</Button>
        <Button className={inboundClasses.ribbonTool} variant="subtle" size="sm" leftSection={<IconDeviceFloppy size={15} />} onClick={() => invokeRibbonAction('saveDocument')} loading={saving} disabled={selectedReceiptno ? (locked || detailLoading || !(hasManagerChanges || hasPendingChanges)) : (readOnly || detailLoading)}>저장</Button>
        <Button className={inboundClasses.ribbonTool} variant="subtle" size="sm" leftSection={<IconTrash size={15} />} onClick={() => invokeRibbonAction('requestToolbarDelete')} disabled={saving || (detailTab === 'expenses' ? (readOnly || !selectedExpenseIds.length) : (selectedReceiptno ? confirmed : !selectedIds.length))}>삭제</Button>
        <Button className={inboundClasses.ribbonTool} variant="subtle" size="sm" leftSection={<IconFileSpreadsheet size={15} />} onClick={() => invokeRibbonAction('exportDocument')} loading={exporting} disabled={!hasExportableRows || loading || detailLoading}>엑셀</Button>
        <span className={inboundClasses.ribbonSeparator} />
        <Button className={inboundClasses.ribbonTool} variant="subtle" size="sm" leftSection={<IconX size={15} />} onClick={() => invokeRibbonAction('closeActivePage')}>닫기</Button>
      </Group>,
    );
    return () => registerPageRibbon(null);
  }, [registerPageRibbon, invokeRibbonAction, loading, readOnly, saving, selectedIds.length, exporting, hasExportableRows, selectedReceiptno, detailLoading, locked, confirmed, hasManagerChanges, hasPendingChanges, detailTab, selectedExpenseIds.length]);


  const requestDeleteReceipt = useCallback(async () => {
    if (!selectedReceiptno || confirmed) return;
    setSaving(true);
    try {
      const { data } = await axios.delete(`/api/outbound-register/receipts/${encodeURIComponent(selectedReceiptno)}`, authConfig());
      if (isApprovalPending(data)) {
        notifyApprovalPending(data);
        setDeleteOpen(false);
        return;
      }
      notifications.show({ title: '매출 삭제 완료', message: `${selectedReceiptno} 전표를 삭제했습니다.`, color: 'teal' });
      setDeleteOpen(false);
      setHeader({ ...EMPTY_HEADER, receptdate: localDate() });
      setReceiptMetadata({ companyid: '', companyname: '', created_at: '', updated_at: '' });
      setRows([]); setExpenses([]); setSelectedExpenseIds([]); expenseSelectionAnchorRef.current = ''; setSelectedReceiptno(''); setSubulyn('N'); setDocumentDirty(false); setDetailTab('details');
      await loadReceipts(page, filters);
    } catch (error) {
      setDeleteBlocked(errorMessage(error));   // 월마감 · 승인 대기 등: 같은 창에서 사유를 보여 준다
    } finally { setSaving(false); }
  }, [selectedReceiptno, confirmed, loadReceipts, page, filters]);

  const rowContent = useCallback((index, row) => (
    <DetailCells row={row} index={index} selected={selectedSet.has(row.id)} disabled={saving || locked || (Boolean(selectedReceiptno) && !row.is_new)} managerEditable={Boolean(selectedReceiptno) && !locked && !saving && !hasNewDetails} priceEditable={Boolean(selectedReceiptno) && !locked && !saving} saved={locked || (Boolean(selectedReceiptno) && !row.is_new)} unitOptions={unitOptions}
      onSelect={toggleSelection} onChange={changeDetail} onPaste={pasteRange}
      registerCodeInput={registerCodeInput} registerCellInput={registerCellInput} onFindItem={setItemPickerTargetId}
      onFindMaster={openMasterPicker} onFindCustomer={openCustomerPicker} onFocusCell={setActiveCell} />
  ), [selectedSet, saving, selectedReceiptno, locked, hasNewDetails, unitOptions, toggleSelection, changeDetail, pasteRange, registerCodeInput, registerCellInput, openMasterPicker, openCustomerPicker, setActiveCell]);

  const headerColumns = [
    // Disabled when no row checkbox is selectable (same rule as the rows: saving, locked, or saved rows of an opened receipt).
    { key: 'select', width: 44, minWidth: 42, className: codeClasses.checkCol, label: <input type="checkbox" aria-label="상세 전체 선택" checked={rows.length > 0 && selectedIds.length === rows.length}
      disabled={saving || locked || !rows.some((row) => !selectedReceiptno || row.is_new)} onChange={(event) => toggleAll(event.currentTarget.checked)} /> },
    { key: 'number', width: 58, minWidth: 48, className: codeClasses.numberCol, label: 'No.' },
    ...DETAIL_FIELDS.map(({ key, label, width, required }) => ({ key, width, minWidth: 70, label: <>{label}{required && <span className={codeClasses.required}> *</span>}</> })),
  ];
  const tableWidth = headerColumns.reduce((sum, column) => sum + (columnWidths[column.key] ?? column.width), 0);
  const receiptTableWidth = RECEIPT_COLUMNS.reduce((sum, column) => sum + (receiptColumnWidths[column.key] ?? receiptAutoWidths[column.key] ?? column.width), 0);
  const receiptTotals = useMemo(() => receipts.reduce((totals, receipt) => {
    for (const key of ['line_count', 'total_qty', 'total_weight', 'supply_amount', 'vat_amount', 'total_amount', 'other_cost_amount']) {
      totals[key] += Number(receipt[key] || 0);
    }
    return totals;
  }, { line_count: 0, total_qty: 0, total_weight: 0, supply_amount: 0, vat_amount: 0, total_amount: 0, other_cost_amount: 0 }), [receipts]);
  const warehouseData = useMemo(() => unitOptions.warehouse.map((option) => ({ value: option.code, label: option.name || option.code })), [unitOptions.warehouse]);
  const receiptCustomerData = useMemo(() => {
    const options = receiptCustomers.map((customer) => ({
      value: customer.customercode,
      label: customer.customername || customer.customercode,
    }));
    if (header.customcode && !options.some((option) => option.value === header.customcode)) {
      options.unshift({ value: header.customcode, label: header.customname || header.customcode });
    }
    return options;
  }, [receiptCustomers, header.customcode, header.customname]);
  const syncReceiptScroll = useCallback((left) => {
    for (const element of [receiptTableRef.current, receiptSubtotalRef.current]) {
      if (element && Math.abs(element.scrollLeft - left) > 0.5) element.scrollLeft = left;
    }
  }, []);
  const renderReceiptHeader = useCallback((column) => (
    <Table.Th key={column.key} className={codeClasses.resizableHeader} ta={column.align} style={{ width: receiptColumnWidths[column.key] ?? receiptAutoWidths[column.key] ?? column.width }}>
      <span style={{ whiteSpace: 'nowrap' }}>{column.label}</span>
      <span className={codeClasses.columnResizeHandle} onPointerDown={(event) => resizeReceiptColumn(event, column.key, column.width, column.minWidth)} role="separator" aria-label={`${column.label} 열 너비 조절`} />
    </Table.Th>
  ), [receiptColumnWidths, receiptAutoWidths, resizeReceiptColumn]);
  // Keep the receipt list stable while rows/expenses are added so it is not rebuilt on every add.
  const openReceiptRef = useRef(openReceipt);
  useLayoutEffect(() => { openReceiptRef.current = openReceipt; }, [openReceipt]);
  const handleOpenReceipt = useCallback((receiptno) => { void openReceiptRef.current(receiptno, true); }, []);
  const highlightedReceiptno = openingReceiptno || selectedReceiptno;
  // 저장 직후처럼 선택 전표가 목록 아래쪽에 있으면 보이는 곳까지 목록만 스크롤한다
  useEffect(() => {
    if (!selectedReceiptno) return;
    const row = receiptTableRef.current?.querySelector(`.${classes.receiptFinderRowActive}`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [selectedReceiptno, receipts]);
  const receiptTable = useMemo(() => (
    <Table className={inboundClasses.receiptFinderTable} stickyHeader highlightOnHover withTableBorder withColumnBorders
      style={{ width: `${receiptTableWidth}px`, minWidth: `${receiptTableWidth}px`, tableLayout: 'fixed' }}>
      <colgroup>{RECEIPT_COLUMNS.map((column) => <col key={column.key} data-column-key={column.key} style={{ width: `${receiptColumnWidths[column.key] ?? receiptAutoWidths[column.key] ?? column.width}px` }} />)}</colgroup>
      <Table.Thead><Table.Tr>{RECEIPT_COLUMNS.map(renderReceiptHeader)}</Table.Tr></Table.Thead>
      <Table.Tbody>
        {receipts.map((receipt) => <Table.Tr key={receipt.receiptno}
          className={`${classes.receiptFinderRow} ${highlightedReceiptno === receipt.receiptno ? classes.receiptFinderRowActive : ''}`}
          onClick={() => handleOpenReceipt(receipt.receiptno)}>
          <Table.Td>{String(receipt.receptdate || '').slice(0, 10)}</Table.Td>
          <Table.Td>{receipt.customname || ''}</Table.Td>
          <Table.Td title={receipt.manager || ''}>{receipt.manager || ''}</Table.Td>
          <Table.Td title={receipt.destination || ''}>{receipt.destination || ''}</Table.Td>
          <Table.Td ta="right">{Number(receipt.total_qty || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</Table.Td>
          <Table.Td ta="right">{Number(receipt.total_weight || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</Table.Td>
          <Table.Td ta="right">{formatAmount(String(receipt.supply_amount ?? 0))}</Table.Td>
          <Table.Td ta="right">{formatAmount(String(receipt.vat_amount ?? 0))}</Table.Td>
          <Table.Td ta="right" className={classes.receiptFinderAmount}>{formatAmount(String(receipt.total_amount ?? 0))}</Table.Td>
          <Table.Td>{receipt.warehousecodename || ''}</Table.Td>
          <Table.Td ta="right">{formatAmount(String(receipt.other_cost_amount ?? 0))}</Table.Td>
          <Table.Td>{receipt.qtyunit || ''}</Table.Td>
          <Table.Td>{receipt.unit || ''}</Table.Td>
          <Table.Td>{receipt.receiptno}</Table.Td>
          <Table.Td>{registeredAtText(receipt.created_at)}</Table.Td>
          <Table.Td title={receipt.created_by || ''}>{receipt.created_by || ''}</Table.Td>
          <Table.Td title={receipt.description || ''}>{receipt.description || ''}</Table.Td>
        </Table.Tr>)}
      </Table.Tbody>
    </Table>
  ), [receiptTableWidth, receiptColumnWidths, receiptAutoWidths, renderReceiptHeader, receipts, highlightedReceiptno, handleOpenReceipt]);
  const allExpensesSelected = expenses.length > 0 && selectedExpenseIds.length === expenses.length;
  const expenseRowsValue = useMemo(() => ({ expenses, selectedExpenseSet, salesCustomerName: header.customname || '' }),
    [expenses, selectedExpenseSet, header.customname]);
  const expenseTable = useMemo(() => (
    <Table className={`${sharedClasses.table} ${codeClasses.codeTable}`} withTableBorder withColumnBorders horizontalSpacing="xs" verticalSpacing="xs"
      style={{ width: '100%', minWidth: 1120, tableLayout: 'fixed' }}>
      <Table.Thead><Table.Tr>
        <Table.Th className={codeClasses.checkCol} style={{ width: 42 }} ta="center"><input type="checkbox" aria-label="기타비용 전체 선택" disabled={saving || readOnly}
          checked={allExpensesSelected}
          onChange={(event) => toggleAllExpenses(event.currentTarget.checked)} /></Table.Th>
        <Table.Th style={{ width: 52 }}>No.</Table.Th>
        <Table.Th style={{ width: 160 }}>비용 구분</Table.Th>
        <Table.Th style={{ width: 145 }} ta="right">공급가</Table.Th>
        <Table.Th style={{ width: 135 }} ta="right">부가세</Table.Th>
        <Table.Th style={{ width: 145 }} ta="right">합계금액</Table.Th>
        <Table.Th style={{ width: 190 }}>거래처</Table.Th>
        <Table.Th style={{ width: 105 }}>비용여부</Table.Th>
        <Table.Th>비고</Table.Th>
      </Table.Tr></Table.Thead>
      <OutboundExpenseTableRows disabled={saving || readOnly} options={expenseOptions} getInputRef={getExpenseCostInputRef}
        onToggle={toggleExpenseSelection} onChange={changeExpense} onOpenCustomerPicker={openCustomerPicker}
        onSetCostPicker={setExpenseCostPickerId} />
    </Table>
  ), [saving, readOnly, allExpensesSelected, toggleAllExpenses, expenseOptions, getExpenseCostInputRef, toggleExpenseSelection, changeExpense, openCustomerPicker]);
  const renderHeader = (column) => (
    <Table.Th key={column.key} className={[codeClasses.resizableHeader, column.className].filter(Boolean).join(' ')} style={{ width: columnWidths[column.key] ?? column.width }}>
      {column.label}<span className={codeClasses.columnResizeHandle} onPointerDown={(event) => resizeColumn(event, column.key, column.width, column.minWidth, tableWidth)} role="separator" aria-label={`${column.key} 열 너비 조절`} />
    </Table.Th>
  );

  const receiptBottom = useMemo(() => (<>
            <Box className={inboundClasses.topReceiptBottom}>
              {!!receipts.length && <Box ref={receiptSubtotalRef} className={inboundClasses.topReceiptSubtotalViewport}>
              <Table className={`${inboundClasses.receiptFinderTable} ${inboundClasses.receiptSubtotalTable}`} withTableBorder withColumnBorders
                style={{ width: `${receiptTableWidth}px`, minWidth: `${receiptTableWidth}px`, tableLayout: 'fixed' }}>
                <colgroup>{RECEIPT_COLUMNS.map((column) => <col key={column.key} data-column-key={column.key} style={{ width: `${receiptColumnWidths[column.key] ?? receiptAutoWidths[column.key] ?? column.width}px` }} />)}</colgroup>
                <Table.Tbody><Table.Tr>
                  {RECEIPT_COLUMNS.map((column, index) => <Table.Td key={column.key} className={`${inboundClasses.topReceiptSubtotalCell} ${column.align === 'right' ? inboundClasses.topReceiptSubtotalNumber : ''}`} ta={column.align}>
                    {index === 0 ? '소계' : column.key === 'line_count' ? receiptTotals.line_count.toLocaleString()
                      : column.key === 'total_qty' ? receiptTotals.total_qty.toLocaleString(undefined, { maximumFractionDigits: 2 })
                      : column.key === 'total_weight' ? receiptTotals.total_weight.toLocaleString(undefined, { maximumFractionDigits: 2 })
                          : ['supply_amount', 'vat_amount', 'total_amount', 'other_cost_amount'].includes(column.key) ? formatWon(String(receiptTotals[column.key])) : ''}
                  </Table.Td>)}
                </Table.Tr></Table.Tbody>
              </Table>
              </Box>}
              <Box ref={receiptHorizontalScrollRef} className={inboundClasses.topReceiptHorizontalScroll} onScroll={(event) => syncReceiptScroll(event.currentTarget.scrollLeft)} aria-label="매출 기본 가로 스크롤">
                <Box className={inboundClasses.topReceiptHorizontalContent} style={{ width: `${receiptTableWidth}px` }} />
              </Box>
            </Box>
            <Group className={inboundClasses.topReceiptPagination} justify="space-between">
              <Group className={inboundClasses.topReceiptPageSize} gap="xs">
                <Select aria-label="페이지당 표시 건수" data={PAGE_SIZE_OPTIONS} value={String(pageSize)} w={100} size="xs"
                  onChange={(value) => { if (value) { const nextPageSize = Number(value); setPageSize(nextPageSize); void loadReceipts(1, filters, nextPageSize); } }} />
              </Group>
              <Pagination size="sm" total={Math.max(1, Math.ceil(total / pageSize))} value={page} onChange={(value) => loadReceipts(value, filters)} withEdges color="red" disabled={loading || !total} />
            </Group>
  </>), [receipts.length, receiptTableWidth, receiptColumnWidths, receiptAutoWidths, receiptTotals, syncReceiptScroll, pageSize, loadReceipts, filters, total, page, loading]);
  const receiptHeaderFields = useMemo(() => (
          <Box className={inboundClasses.sharedReceiptFields}>
            <Box className={inboundClasses.sharedReceiptField}>
              <Text size="xs" fw={700} mb={4}>매출일자 <span className={codeClasses.required}>*</span></Text>
              <ErpDateInput type="date" aria-label="매출일자" value={header.receptdate || ''} disabled={saving || locked}
                onChange={(event) => changeReceiptHeader('receptdate', event.currentTarget.value)} />
            </Box>
            <Box className={inboundClasses.sharedReceiptField}>
              <Text size="xs" fw={700} mb={4}>매출처 <span className={codeClasses.required}>*</span></Text>
              <Select ref={headerCustomerRef} searchable autoSelectOnBlur aria-label="매출처" placeholder=""
                dropdownOpened={customerDropdownOpen}
                onDropdownOpen={() => { if (!suppressCustomerDropdownRef.current) setCustomerDropdownOpen(true); }}
                onDropdownClose={() => setCustomerDropdownOpen(false)}
                disabled={readOnly || saving} data={receiptCustomerData} value={header.customcode || null}
                onChange={(value) => changeReceiptHeader('customcode', value || '')} />
            </Box>
            <Box className={inboundClasses.sharedReceiptField}>
              <Text size="xs" fw={700} mb={4}>창고</Text>
              {/* 창고는 직접 고르지 않는다: [현재고 조회]에서 담은 재고의 창고로 자동 지정 (항상 비활성) */}
              <Select aria-label="창고" placeholder={readOnly ? '' : '재고 선택 시 자동'}
                disabled
                data={header.warehousecode && warehouseData.some((option) => option.value === header.warehousecode) ? warehouseData
                  : header.warehousecodename ? [{ value: header.warehousecode || '__shown', label: header.warehousecodename }, ...warehouseData] : warehouseData}
                value={header.warehousecode || (header.warehousecodename ? '__shown' : null)}
                />
            </Box>
            <Box className={inboundClasses.sharedReceiptField}>
              <Text size="xs" fw={700} mb={4}>담당자</Text>
              <DeferredReceiptTextInput key={`${selectedReceiptno}:manager:${header.manager || ''}`} ariaLabel="담당자" value={header.manager || ''} maxLength={100}
                disabled={saving || locked} onEditStart={() => markReceiptHeaderEdited('manager')}
                onCommit={(value) => changeReceiptHeader('manager', value)} />
            </Box>
            <Box className={inboundClasses.sharedReceiptField}>
              <Text size="xs" fw={700} mb={4}>착지</Text>
              {/* 직접 입력한다. 송장 받는 곳 주소 = 착지 (비우면 매출처 주소) */}
              <DeferredReceiptTextInput key={`${selectedReceiptno}:destination:${header.destination || ''}`} ariaLabel="착지" value={header.destination || ''} maxLength={500}
                disabled={locked || saving} onEditStart={() => markReceiptHeaderEdited('destination')}
                onCommit={(value) => changeReceiptHeader('destination', value)} />
            </Box>
          </Box>
  ), [header, saving, locked, readOnly, receiptCustomerData, changeReceiptHeader, selectedReceiptno, markReceiptHeaderEdited, warehouseData, customerDropdownOpen]);
  const filterSidebar = useMemo(() => (
        <Paper component="aside" className={`${inboundClasses.receiptFilterSidebar} ${classes.outboundFilterSidebar}`} withBorder>
          <Group className={inboundClasses.receiptFilterHeader} justify="space-between" align="center">
            <Text fw={700}>조회조건</Text>
            <ActionIcon variant="subtle" color="gray" aria-label="조회조건 닫기" onClick={() => setFilterOpen(false)}><IconX size={16} /></ActionIcon>
          </Group>
          <Stack gap="sm" className={inboundClasses.receiptFilterFields}>
            <Box>
              <Text size="xs" fw={700} mb={5}>매출기간</Text>
              <Stack gap={6}>
                <ErpDateInput type="date" aria-label="매출기간 시작일" value={filterInputs.date_from}
                  onChange={(event) => { const { value: nextValue } = event.currentTarget; setFilterInputs((current) => ({ ...current, date_from: nextValue })); }} />
                <ErpDateInput type="date" aria-label="매출기간 종료일" value={filterInputs.date_to}
                  onChange={(event) => { const { value: nextValue } = event.currentTarget; setFilterInputs((current) => ({ ...current, date_to: nextValue })); }} />
              </Stack>
            </Box>
            <TextInput label="매출처" placeholder="매출처코드 또는 매출처명" value={filterInputs.customer}
              onChange={(event) => { const { value: nextValue } = event.currentTarget; setFilterInputs((current) => ({ ...current, customer: nextValue })); }}
              onKeyDown={(event) => { if (event.key === 'Enter') runSearch(); }} />
            <TextInput label="창고" placeholder="창고코드 또는 창고명" value={filterInputs.warehouse}
              onChange={(event) => { const { value: nextValue } = event.currentTarget; setFilterInputs((current) => ({ ...current, warehouse: nextValue })); }}
              onKeyDown={(event) => { if (event.key === 'Enter') runSearch(); }} />
            <TextInput label="매출전표번호" placeholder="전표번호" value={filterInputs.receiptno}
              onChange={(event) => { const { value: nextValue } = event.currentTarget; setFilterInputs((current) => ({ ...current, receiptno: nextValue })); }}
              onKeyDown={(event) => { if (event.key === 'Enter') runSearch(); }} />
          </Stack>
          <Box className={classes.outboundStockLookup}>
            <Text fw={700} size="sm">재고 조회</Text>
            <Text size="xs" c="dimmed">매출일자·매출처·창고를 입력한 뒤 매출할 재고를 선택합니다.</Text>
            <Button fullWidth color="red" leftSection={<IconSearch size={15} />} onClick={openStockLookup} disabled={saving || readOnly}>
              현재고 조회
            </Button>
          </Box>
        </Paper>
  ), [filterInputs, runSearch, openStockLookup, saving, readOnly]);
  const pickerModals = useMemo(() => (<>
      <CustomerPickerModal opened={customerPickerOpen} onClose={() => { setCustomerPickerOpen(false); setCustomerPickerTargetId('' ); }} onSelect={selectCustomer} />
      <MasterOptionPickerModal
        key={expenseCostPickerId || 'expense-cost-closed'}
        opened={Boolean(expenseCostPickerId)}
        onClose={() => setExpenseCostPickerId('')}
        title="비용구분 선택"
        options={expenseOptions}
        onSelect={(option) => {
          if (expenseCostPickerId) changeExpense(expenseCostPickerId, 'costcode', option.code || '');
          setExpenseCostPickerId('');
        }}
      />
      <OutboundStockPickerModal
        opened={stockPickerOpen}
        receiptno={selectedReceiptno}
        existingRows={rows}
        initialFilters={stockPickerFilters}
        onClose={() => setStockPickerOpen(false)}
        onApply={applyAvailableStocks}
      />
      <ItemPickerModal opened={Boolean(itemPickerTargetId)} onClose={() => setItemPickerTargetId('')} onSelect={(item) => selectItem(itemPickerTargetId, item)} />
      <MasterOptionPickerModal
        key={masterPickerTarget ? `${masterPickerTarget.id}:${masterPickerTarget.field}` : 'closed'}
        opened={Boolean(masterPickerTarget)}
        onClose={() => setMasterPickerTarget(null)}
        title={masterPickerTarget?.field === 'qtyunit' ? '수량단위 선택' : masterPickerTarget?.field === 'unit' ? '단가기준 선택' : '창고 선택'}
        options={masterPickerTarget?.field === 'qtyunit' ? unitOptions.quantity : masterPickerTarget?.field === 'unit' ? unitOptions.price : unitOptions.warehouse}
        onSelect={selectMasterOption}
      />
  </>), [customerPickerOpen, selectCustomer, expenseCostPickerId, expenseOptions, changeExpense, stockPickerOpen, selectedReceiptno, rows, stockPickerFilters, applyAvailableStocks, itemPickerTargetId, selectItem, masterPickerTarget, unitOptions, selectMasterOption]);

  return (
    <Box className={`${sharedClasses.pageShell} ${classes.page} ${simpleTheme.simple}`}>
      <Box component="nav" aria-label="현재 위치" className={inboundClasses.pageBreadcrumb}>
        <Group className={inboundClasses.breadcrumbTrail} gap={7}>
          <Text component="span" className={inboundClasses.breadcrumbParent}>매출관리</Text>
          <Text component="span" className={inboundClasses.breadcrumbChevron}>›</Text>
          <Text component="span" className={inboundClasses.breadcrumbCurrent}>매출등록</Text>
        </Group>
        {!filterOpen && (
          <Button className={inboundClasses.receiptFilterToggle} variant="subtle" size="xs"
            leftSection={<IconFilter size={15} />} onClick={() => setFilterOpen(true)}>
            조회조건
          </Button>
        )}
      </Box>
      <OutboundPrintDocument opened={Boolean(printKind)} receiptno={selectedReceiptno} initialKind={printKind || 'statement'} onClose={closePrint} />

      <Box className={`${inboundClasses.inboundWorkspace} ${classes.outboundWorkspace}`}>
        <Box className={`${inboundClasses.inboundPrimaryColumn} ${classes.outboundPrimaryColumn}`}>
          <Paper className={`${sharedClasses.panel} ${inboundClasses.topReceiptPanel}`} withBorder>
            <Group className={`${inboundClasses.topReceiptToolbar} ${classes.receiptToolbarWithActions}`} justify="space-between" wrap="wrap">
              <Group gap={8}><Text className={inboundClasses.sectionTitle} fw={700}>매출 기본</Text><Badge color="gray" variant="light">{total.toLocaleString()}건</Badge></Group>
              {/* 선택한 매출전표의 거래명세서 / 납품송장 출력 */}
              <Group gap={6} wrap="nowrap" className={classes.printActions}>
                <Button size="xs" variant="default" leftSection={<IconFileInvoice size={15} />} onClick={() => openPrint('statement')}
                  disabled={!selectedReceiptno || detailLoading} title={selectedReceiptno ? '선택한 매출전표의 거래명세서를 출력합니다' : '목록에서 매출전표를 먼저 선택하세요'}>
                  거래명세서 출력
                </Button>
                <Button size="xs" variant="default" leftSection={<IconTruckDelivery size={15} />} onClick={() => openPrint('delivery')}
                  disabled={!selectedReceiptno || detailLoading} title={selectedReceiptno ? '선택한 매출전표의 납품송장을 출력합니다' : '목록에서 매출전표를 먼저 선택하세요'}>
                  송장 출력
                </Button>
              </Group>
            </Group>
            <Box ref={receiptTableRef} className={inboundClasses.topReceiptTable}>
              {receiptTable}
              {!receipts.length && <Box className={inboundClasses.topReceiptEmptyMessage}>{loading ? '조회 중입니다.' : '검색된 매출전표가 없습니다.'}</Box>}
            </Box>
            {receiptBottom}
          </Paper>

      <Box className={classes.workspace}>
        <Paper className={`${sharedClasses.panel} ${codeClasses.codePanel} ${classes.editorPanel}`} withBorder>
          <Group className={codeClasses.codeHeader} justify="space-between" align="center" wrap="wrap" gap="sm">
            <Group gap={9} align="center">
              <Text className={inboundClasses.sectionTitle} fw={700}>매출 상세</Text>
              <Badge color="gray" variant="light">{rows.length.toLocaleString()}행</Badge>
              {selectedReceiptno && <Badge color="gray" variant="light">{selectedReceiptno}</Badge>}
            </Group>
            <Group gap={8} align="center">
              {selectedReceiptno && <Badge color={confirmed ? 'green' : locked ? 'orange' : 'gray'} variant="light" title={locked && !confirmed ? header.edit_lock : undefined}>
                {confirmed ? '수불 확정' : locked ? '수정 불가' : '저장됨 · 수정 가능'}
              </Badge>}
              {selectedIds.length > 0 && <Badge color="gray" variant="light">{selectedIds.length}개 선택</Badge>}
            </Group>
          </Group>

          {receiptHeaderFields}

          <Box className={classes.detailTabsBar} role="tablist" aria-label="매출 상세 구분">
            <button type="button" role="tab" aria-selected={detailTab === 'details'} className={detailTab === 'details' ? classes.detailTabActive : classes.detailTab}
              onClick={() => setDetailTab('details')}>매출 상세 {rows.length.toLocaleString()}건</button>
            <button type="button" role="tab" aria-selected={detailTab === 'expenses'} className={detailTab === 'expenses' ? classes.detailTabActive : classes.detailTab}
              onClick={() => setDetailTab('expenses')}>기타비용 {expenses.length.toLocaleString()}건</button>
          </Box>
          {detailTab === 'details' && <>
          <Box ref={detailScrollerRef} className={`${codeClasses.tableWrap} ${(rows.length <= 100 || (selectedReceiptno && rows.length <= 200)) ? classes.savedDetailScroller : ''} ${!detailLoading && !rows.length ? inboundClasses.emptyDetailWrap : ''}`} style={{ '--code-table-min-width': `${Math.max(1120, tableWidth)}px` }} onKeyDown={handleTableKeyDown}
            onKeyDownCapture={handleTableKeyDownCapture} onMouseDownCapture={handleTableMouseDownCapture}
            onCopyCapture={handleTableCopyCapture} onCutCapture={handleTableCutCapture} onPasteCapture={handleTablePasteCapture}>
            {detailLoading ? <Box className={classes.receiptLoading}><Loader size="sm" color="red" /></Box> : rows.length ? (
              (rows.length <= 100 || (selectedReceiptno && rows.length <= 200)) ? <Box className={inboundClasses.detailFillWrap}>
                <Table className={`${sharedClasses.table} ${codeClasses.codeTable}`} highlightOnHover withTableBorder withColumnBorders verticalSpacing="xs" horizontalSpacing={0}
                  style={{ width: '100%', minWidth: 'var(--code-table-min-width)', tableLayout: 'fixed' }}>
                  <Table.Thead><Table.Tr>{headerColumns.map(renderHeader)}</Table.Tr></Table.Thead>
                  <Table.Tbody>{rows.map((row, index) => <Table.Tr key={row.id} className={[row.is_new && classes.newRow, selectedSet.has(row.id) && classes.selectedRow].filter(Boolean).join(' ')}>{rowContent(index, row)}</Table.Tr>)}</Table.Tbody>
                </Table>
                <DetailSubtotalTable columns={headerColumns} widths={columnWidths} values={detailSubtotals} />
              </Box> : <TableVirtuoso ref={virtuosoRef} data={rows} context={virtuosoContext} style={{ height: '100%' }} components={virtuosoComponents} computeItemKey={(_index, row) => row.id} increaseViewportBy={{ top: 84, bottom: 84 }} fixedHeaderContent={() => <Table.Tr>{headerColumns.map(renderHeader)}</Table.Tr>} fixedFooterContent={() => <DetailSubtotalRow columns={headerColumns} values={detailSubtotals} />} itemContent={rowContent} />
            ) : (
              <Table className={`${sharedClasses.table} ${codeClasses.codeTable}`} highlightOnHover withTableBorder withColumnBorders verticalSpacing="xs" horizontalSpacing={0}
                style={{ width: '100%', minWidth: 'var(--code-table-min-width)', tableLayout: 'fixed' }}>
                <Table.Thead><Table.Tr>{headerColumns.map(renderHeader)}</Table.Tr></Table.Thead>
              </Table>
            )}
            {!detailLoading && !rows.length && (
              <Box className={inboundClasses.emptyDetailMessage}>
                {selectedReceiptno ? '매출 상세가 없습니다.' : '매출일자·매출처·창고를 입력한 뒤 [현재고 조회]로 매출할 재고를 선택하세요.'}
              </Box>
            )}
          </Box>
          <Group className={`${sharedClasses.footer} ${codeClasses.tableFooter}`} justify="flex-end" wrap="wrap">
            <Text size="xs" fw={700}>
              총 수량 {quantitySummary} · 총중량 {detailTotals.totalweight.toLocaleString(undefined, { maximumFractionDigits: 2 })}{rows.length ? 'KG' : ''}
              {' · '}총공급가 {formatWon(detailTotals.amount.toFixed(2))}
              {' · '}부가세 {formatWon(detailTotals.vat.toFixed(2))}
              {' · '}합계 {formatWon(detailTotals.total.toFixed(2))}
            </Text>
          </Group>
            </>}
          {detailTab === 'expenses' && <Box className={classes.expenseTabPanel}>
              <Box ref={expenseTableScrollerRef} onKeyDownCapture={handleExpenseGridKeyDown} onKeyDown={handleExpenseKeyDown} onPasteCapture={handleExpensePasteCapture} className={`${codeClasses.tableWrap} ${classes.expenseTableWrap} ${expenses.length <= 100 ? classes.savedDetailScroller : ''} ${!expenses.length ? inboundClasses.emptyDetailWrap : ''}`}>
                <Box className={inboundClasses.detailFillWrap}>
                  <ExpenseRowsContext.Provider value={expenseRowsValue}>{expenseTable}</ExpenseRowsContext.Provider>
                  {expenses.length > 0 && <DetailSubtotalTable columns={OUTBOUND_EXPENSE_SUBTOTAL_COLUMNS} values={expenseSubtotalValues(expenseTotals)} minWidth={1120} />}
                </Box>
                {!expenses.length && <Box className={inboundClasses.emptyDetailMessage}>등록된 기타비용이 없습니다.</Box>}
              </Box>
              <Group className={`${sharedClasses.footer} ${codeClasses.tableFooter}`} justify="flex-end" wrap="wrap">
                <Text size="xs" fw={700}>
                  총공급가 {formatWon(String(expenseTotals.supply))}
                  {' · '}부가세 {formatWon(String(expenseTotals.vat))}
                  {' · '}합계 {formatWon(String(expenseTotals.total))}
                </Text>
              </Group>
            </Box>}
        </Paper>
      </Box>
        </Box>
        {filterOpen && filterSidebar}
      </Box>




      <ConfirmDeleteModal opened={deleteOpen} onClose={() => { setDeleteOpen(false); setDeleteBlocked(''); }} onConfirm={requestDeleteReceipt} loading={saving} blocked={deleteBlocked}
        title="매출전표를 삭제할까요?" target={selectedReceiptno} message="전표와 상세 내역이 모두 삭제되며" note="삭제한 전표는 복구할 수 없습니다." />


      {pickerModals}
    </Box>
  );
}
