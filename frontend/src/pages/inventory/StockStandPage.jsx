import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { usePageActivation } from '../../components/common/usePageReactivated';
import ErpDateInput from '../../components/common/ErpDateInput';
import { SelectPickerModal } from '../../components/common/PickerModal';
import { loadXLSXOrNotify } from '../../utils/excelSafe';
import { ActionIcon, Badge, Box, Button, Group, Loader, Notification, Pagination, Paper, Popover, Select, Stack, Table, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconBox, IconBuildingStore, IconListDetails, IconX } from '@tabler/icons-react';
import { TableVirtuoso } from 'react-virtuoso';
import sharedClasses from '../../styles/pages/ManagementShared.module.css';
import simpleTheme from '../../styles/pages/SimpleTheme.module.css';
import codeClasses from '../../styles/pages/CodeMasterPage.module.css';
import outboundClasses from '../../styles/pages/OutboundRegister.module.css';
import inboundClasses from '../../styles/pages/InboundRegister.module.css';
import itemMasterClasses from '../../styles/pages/ItemMaster.module.css';
import classes from '../../styles/pages/StockStand.module.css';
import { applyExcelHeaderStyle } from '../../utils/excelHeaderStyle';
import useErpPageRibbon from '../../components/common/useErpPageRibbon';
import ErpBreadcrumb from '../../components/common/ErpBreadcrumb';
import ExcelBulkActions from '../../components/common/ExcelBulkActions';
import ConfirmDeleteModal from '../../components/common/ConfirmDeleteModal';
import { cachedDateFormat, kstDate } from '../../utils/dateFormat';
import { useUnsavedChanges } from '../../utils/dirtyRegistry';
import { apiErrorMessage } from '../../utils/apiError';
import { fetchAllPages, loadMaster, peekMaster } from '../../utils/masterCache';

// 지난번에 받은 코드 목록 (없으면 빈 목록) — 화면 첫 그림부터 창고·단위·강종 선택지가 보이게
const cachedStandMasters = () => ({
  quantity: peekMaster('code-all-use:QTY') || [], warehouse: peekMaster('code-all-use:WAREHOUSE') || [],
  price: peekMaster('code-all-use:PRICE_UNIT') || [], material: peekMaster('code-all-use:MATERIAL') || [],
  surface: peekMaster('code-all-use:SURFACE') || [],
});
// 기초재고가 등록된 기초일자 (지난번 조회에서 서버가 알려 준 값). 처음 열 때 이 날짜로 바로 조회해 요청 한 번을 줄인다.
const REGISTERED_DATE_KEY = 'stock-stand:registered-date';

const STOCK_EXCEL_COLUMNS = [
  ['standdate', '기초일자'], ['customname', '거래처'], ['warehousecodename', '창고'], ['productname', '제품번호'],
  ['itemname', '품명'], ['materialname', '강종'], ['surfacename', '표면'], ['myrtle', '도금량(g/m²)'],
  ['thickness', '두께'], ['width', '폭'], ['length', '길이'], ['qty', '기초수량'], ['weight', '기초중량'],
  ['unitprice', '기초단가'], ['supplyamt', '공급가'], ['vat', '부가세'], ['unitamt', '합계금액'],
  ['unit', '단가기준'], ['qtyunit', '수량단위'], ['description', '비고'],
];
const STOCK_EXPORT_COLUMNS = [
  ...STOCK_EXCEL_COLUMNS,
  ['created_at', '등록일자'], ['updated_at', '수정일자'],
  ['created_by', '등록자'], ['updated_by', '수정자'],
];
const STOCK_PAGE_OPTIONS = [
  { value: '15', label: '15개씩' },
  { value: '50', label: '50개씩' },
  { value: '100', label: '100개씩' },
  { value: '200', label: '200개씩' },
];
const GRID_FIELDS = ['standdate', 'customname', 'warehousecode', 'productname', 'itemname', 'materialcode', 'surfacecode', 'myrtle', 'thickness', 'width', 'length', 'qty', 'weight', 'unitprice', 'supplyamt', 'vat', 'unitamt', 'unit', 'qtyunit', 'description'];
const GRID_COLUMN_WIDTHS = { select: 44, number: 58, standdate: 118, customname: 160, itemcode: 135, itemname: 170, productname: 125, materialcode: 105, surfacecode: 100, myrtle: 110, thickness: 90, width: 90, length: 90, qty: 100, qtyunit: 100, warehousecode: 130, weight: 110, unit: 100, unitprice: 115, supplyamt: 120, vat: 100, unitamt: 120, description: 160 };
const STOCK_GRID_COLUMNS = [
  ['select', ''], ['number', 'No.'], ['standdate', '기초일자 *'], ['customname', '거래처'], ['warehousecode', '창고 *'],
  ['productname', '제품번호'], ['itemname', '품명 *'], ['materialcode', '강종 *'], ['surfacecode', '표면'], ['myrtle', '도금량(g/m²)'],
  ['thickness', '두께'], ['width', '폭'], ['length', '길이'], ['qty', '기초수량 *'], ['weight', '기초중량 *'],
  ['unitprice', '기초단가'], ['supplyamt', '공급가'], ['vat', '부가세'], ['unitamt', '합계금액'],
  ['unit', '단가기준'], ['qtyunit', '수량단위 *'], ['description', '비고'],
];
// Reasons (from the server's delete_block) why a saved opening-stock line cannot be deleted.
const DELETE_BLOCK_TEXT = {
  MISSING: '현재고 원천행을 찾을 수 없습니다',
  USED: '현재고 수량·중량이 사용되었습니다',
  OUTBOUND: '출고에 사용되었습니다',
  PROCESS: '가공에 사용되었습니다',
  TRANSFER: '재고이전에 사용되었습니다',
};
const OPTIONAL_INPUT_FIELDS = new Set(STOCK_GRID_COLUMNS
  .filter(([key, label]) => GRID_FIELDS.includes(key) && !label.endsWith('*') && key !== 'unitamt')
  .map(([key]) => key));
const MASTER_FIELDS = new Set(['qtyunit', 'warehousecode', 'unit', 'materialcode', 'surfacecode']);
const PRICE_FIELDS = new Set(['unit', 'unitprice']);
const EDITABLE_PRICE_FIELDS = new Set(['unit', 'unitprice']);
const MASTER_KIND = { qtyunit: 'quantity', warehousecode: 'warehouse', unit: 'price', materialcode: 'material', surfacecode: 'surface' };
const MASTER_TITLE = { qtyunit: '수량단위 선택', warehousecode: '창고 선택', unit: '단가기준 선택', materialcode: '강종 선택', surfacecode: '표면 선택' };

const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });
const localDate = () => {
  const now = kstDate();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};
const isValidDateInput = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  if (!match) return false;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const check = new Date(0);
  check.setUTCHours(0, 0, 0, 0);
  check.setUTCFullYear(year, month - 1, day);
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
};
const currentMonthRange = () => {
  const now = kstDate();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return { from: `${year}-${month}-01`, to: localDate() };
};
const hasRowInput = (row) => ['itemcode', 'itemname', 'customname', 'productname', 'materialcode', 'surfacecode', 'myrtle', 'thickness', 'width', 'length', 'qty', 'qtyunit', 'weight', 'warehousecode', 'unitprice', 'supplyamt', 'vat', 'description'].some((key) => String(row[key] ?? '').trim() !== '' && !(key === 'qtyunit' && row[key] === 'EA'));
const fitColumnWidth = (label, values, baseWidth, minWidth, maxWidth = 420) => {
  const measure = (value) => Array.from(String(value ?? '')).reduce((width, character) => width + (character.charCodeAt(0) > 255 ? 11 : 6.5), 0) + 20;
  return Math.max(minWidth, Math.min(maxWidth, Math.max(baseWidth, measure(label), ...values.map(measure))));
};
const makeRow = (values = {}) => ({
  id: values.lineno ? `saved-${values.lineno}` : `new-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  isNew: !values.lineno,
  lineno: values.lineno ?? null,
  standdate: values.standdate || localDate(),
  itemcode: values.itemcode || '', itemname: values.itemname || '', productname: values.productname || '',
  customcode: values.customcode || '', customname: values.customname || '',
  materialcode: values.materialcode || '', materialname: values.materialname || '',
  surfacecode: values.surfacecode || '', surfacename: values.surfacename || '',
  myrtle: values.myrtle == null ? '' : String(values.myrtle),
  thickness: values.thickness == null ? '' : String(values.thickness),
  width: values.width == null ? '' : String(values.width),
  length: values.length == null ? '' : String(values.length),
  qty: values.qty == null ? '' : String(values.qty), qtyunit: values.qtyunit || '',
  weight: values.weight == null ? '' : String(values.weight),
  warehousecode: values.warehousecode || '', warehousecodename: values.warehousecodename || '',
  unit: values.unit || '', unitprice: values.unitprice == null ? '' : String(values.unitprice),
  supplyamt: values.supplyamt == null ? '' : String(values.supplyamt),
  vat: values.vat == null ? '' : String(values.vat),
  supplyamt_manual: values.supplyamt_manual ?? (values.supplyamt != null && values.supplyamt !== ''),
  vat_manual: values.vat_manual ?? (values.vat != null && values.vat !== ''),
  unitamt: values.unitamt == null ? '' : String(values.unitamt), description: values.description || '',
  created_at: values.created_at || '', updated_at: values.updated_at || '',
  created_by: values.created_by || '', updated_by: values.updated_by || '',
  has_movements: Boolean(values.has_movements),
  delete_block: values.delete_block || '',
});
const cleanNumber = (value) => String(value ?? '').replace(/,/g, '').replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1');
const numberText = (value) => {
  const raw = cleanNumber(value);
  if (!raw) return '';
  const [integer, ...decimal] = raw.split('.');
  const grouped = (integer || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return decimal.length ? `${grouped}.${decimal.join('')}` : grouped;
};
const calculateAmounts = (row, priceOptions) => {
  let supplyamt;
  if (row.supplyamt_manual) supplyamt = Number(row.supplyamt || 0);
  else {
    if (!String(row.unitprice ?? '').trim()) return { supplyamt: '', vat: '', unitamt: '' };
    const unitprice = Number(row.unitprice);
    if (!Number.isFinite(unitprice)) return { supplyamt: '', vat: '', unitamt: '' };
    const unitName = priceOptions.find((option) => option.code === row.unit)?.name || '';
    const unitToken = `${row.unit || ''} ${unitName}`.toLocaleUpperCase();
    let basis;
    if (/QTY|COUNT|(^|[\s_-])(EA|PCS)([\s_-]|$)/.test(unitToken) || unitToken.includes('수량')) basis = Number(row.qty);
    else if (/LENGTH|METER|(^|[\s_-])(M|MTR)([\s_-]|$)/.test(unitToken) || unitToken.includes('길이')) basis = Number(row.length);
    else basis = /TON|톤/.test(unitToken) ? Number(row.weight) / 1000 : Number(row.weight);
    if (!Number.isFinite(basis)) return { supplyamt: '', vat: '', unitamt: '' };
    supplyamt = Number((basis * unitprice).toFixed(2));
  }
  if (!Number.isFinite(supplyamt)) return { supplyamt: '', vat: '', unitamt: '' };
  const vat = row.vat_manual ? Number(row.vat || 0) : Number((supplyamt * 0.1).toFixed(2));
  if (!Number.isFinite(vat)) return { supplyamt: '', vat: '', unitamt: '' };
  return { supplyamt: supplyamt.toFixed(2), vat: vat.toFixed(2), unitamt: (supplyamt + vat).toFixed(2) };
};
const formatAmount = (value) => {
  const amount = Number(value);
  if (value === '' || !Number.isFinite(amount)) return '';
  return amount.toLocaleString(undefined, {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  });
};
const formatTimestamp = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const parts = cachedDateFormat('en-GB', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${parts.year}${parts.month}${parts.day} ${parts.hour}:${parts.minute}`;
};
const resolveMasterCode = (field, value, masters) => {
  const text = String(value ?? '').trim().toLocaleLowerCase();
  if (!text) return '';
  const options = masters[MASTER_KIND[field]] || [];
  return options.find((option) => String(option.code).trim().toLocaleLowerCase() === text
    || String(option.name).trim().toLocaleLowerCase() === text
    || `${String(option.code).trim()} - ${String(option.name).trim()}`.toLocaleLowerCase() === text)?.code || '';
};
const VALIDATION_FIELD_LABELS = {
  standdate: '기초일자', itemcode: '품목코드', itemname: '품명', customcode: '거래처코드', customname: '거래처',
  productname: '제품번호', materialcode: '강종코드', materialname: '강종', surfacecode: '표면코드', surfacename: '표면',
  myrtle: '도금량', thickness: '두께', width: '폭', length: '길이', qty: '기초수량', qtyunit: '수량단위',
  weight: '기초중량', warehousecode: '창고코드', warehousecodename: '창고명', unit: '단가기준',
  unitprice: '기초단가', supplyamt: '공급가', vat: '부가세', description: '비고',
};
const errorText = (error) => {
  const detail = error.response?.data?.detail;
  if (Array.isArray(detail)) return [...new Set(detail.slice(0, 5).map((item) => {
    const path = Array.isArray(item.loc) ? [...item.loc].reverse().find((part) => typeof part === 'string' && part !== 'body') : '';
    const label = VALIDATION_FIELD_LABELS[path];
    if (['string_too_short', 'missing'].includes(item.type) || item.msg === 'String should have at least 1 character') {
      return label ? `${label} 항목이 비어 있습니다. 값을 입력해 주세요.` : '필수 입력 항목이 비어 있습니다. 값을 입력해 주세요.';
    }
    if (item.type === 'string_too_long') return `${label || '입력 항목'}의 글자 수가 허용 범위를 넘었습니다.`;
    if (item.type === 'float_parsing' || item.type === 'int_parsing') return `${label || '입력 항목'}에 숫자를 입력해 주세요.`;
    return label ? `${label}: ${item.msg || '입력값을 확인해 주세요.'}` : item.msg || String(item);
  }))].join(' / ');
  return apiErrorMessage(error, '요청을 처리하지 못했습니다.');
};

// ── 엑셀식 입력 도우미 (범위 채우기 · 지우기 · 복사) ──
// 값을 옮길 때도 직접 입력(updateRow)·붙여넣기(pasteRange)와 같은 규칙을 쓴다:
//   저장된 행은 단가기준·기초단가만, 거래처·품명·창고·강종·표면은 코드와 이름을 함께,
//   단가기준·기초단가가 바뀌면 공급가·부가세는 자동계산으로, 공급가·부가세는 '직접 입력' 여부까지 함께 옮기고,
//   마지막에 금액(공급가·부가세·합계)을 다시 계산한다. 합계금액은 계산값이라 건너뛴다.
const STAND_FIELD_INDEX = Object.fromEntries(GRID_FIELDS.map((key, index) => [key, index]));
const STAND_CODE_NAME = { customname: 'customcode', itemname: 'itemcode', warehousecode: 'warehousecodename', materialcode: 'materialname', surfacecode: 'surfacename' };
const STAND_FIRST_FIELD_CELL = 2;   // 표 칸 순서: 선택 · No. 다음부터 GRID_FIELDS
const standFieldWritable = (row, field) => field !== 'unitamt' && (!row.lineno || EDITABLE_PRICE_FIELDS.has(field));
// 금액을 자동계산으로 되돌리는 칸을 먼저 처리해야 같은 범위의 공급가·부가세 직접 입력값이 남는다
const orderStandFields = (fields) => [
  ...fields.filter((field) => field === 'unit' || field === 'unitprice'),
  ...fields.filter((field) => field !== 'unit' && field !== 'unitprice'),
];
const copyStandField = (target, source, field) => {
  if (!standFieldWritable(target, field)) return;
  const pair = STAND_CODE_NAME[field];
  if (pair) { target[field] = source[field] || ''; target[pair] = source[pair] || ''; return; }
  if (field === 'unit' || field === 'unitprice') {
    target[field] = source[field] ?? '';
    target.supplyamt_manual = false;
    target.vat_manual = false;
    return;
  }
  if (field === 'supplyamt' || field === 'vat') {
    const manual = Boolean(source[`${field}_manual`]);
    target[field] = manual ? source[field] ?? '' : '';
    target[`${field}_manual`] = manual;
    return;
  }
  target[field] = source[field] ?? '';
};
const clearStandField = (target, field) => {
  // 기본값이 있는 목록(단가기준 KG · 수량단위 EA)은 지우지 않는다
  if (!standFieldWritable(target, field) || field === 'unit' || field === 'qtyunit') return;
  const pair = STAND_CODE_NAME[field];
  if (pair) { target[field] = ''; target[pair] = ''; return; }
  target[field] = '';
  if (field === 'unitprice') { target.supplyamt_manual = false; target.vat_manual = false; }
  if (field === 'supplyamt' || field === 'vat') target[`${field}_manual`] = false;   // 지우면 자동계산으로
};
// 복사(Ctrl+C) 글자: 엑셀에 붙이거나 다시 이 표에 붙여넣을 수 있는 값 (코드 칸은 코드명, 금액은 화면 값)
const standCopyText = (row, field, masters) => {
  let value;
  if (field === 'unit' || field === 'qtyunit') {
    const fallback = field === 'unit' ? 'KG' : 'EA';
    const code = resolveMasterCode(field, row[field] || fallback, masters) || row[field] || fallback;
    value = (masters[MASTER_KIND[field]] || []).find((option) => option.code === code)?.name || code;
  } else if (field === 'warehousecode') value = row.warehousecodename || row.warehousecode;
  else if (field === 'materialcode') value = (masters.material || []).find((option) => option.code === row.materialcode)?.name || row.materialname || row.materialcode;
  else if (field === 'surfacecode') value = (masters.surface || []).find((option) => option.code === row.surfacecode)?.name || row.surfacename || row.surfacecode;
  else if (field === 'supplyamt' || field === 'vat' || field === 'unitamt') {
    const amount = calculateAmounts(row, masters.price || [])[field];
    value = amount === '' ? '' : String(Number(amount));
  } else value = row[field] ?? '';
  return String(value ?? '').replace(/[\t\r\n]+/g, ' ');
};
const isMultiCellText = (text) => /[\t\n]/.test(String(text || '').replace(/\r?\n$/, ''));

const StockVirtualRow = ({ item, className, ...props }) => (
  <Table.Tr {...props} data-row-id={item?.id} className={[className, !item?.lineno && codeClasses.newRow, !item?.lineno && classes.newRow].filter(Boolean).join(' ')} />
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

const STOCK_ITEM_PICKER_COLUMNS = [
  { key: 'itemcode', label: '품목코드', width: 150 },
  { key: 'itemname', label: '품목명', width: 260 },
  { key: 'itemtype', label: '형태구분', width: 140, render: (item) => item.itemtypecode || '-' },
];
const STOCK_CUSTOMER_PICKER_COLUMNS = [
  { key: 'customercode', label: '거래처코드', width: 130 },
  { key: 'customername', label: '거래처명', width: 300 },
  { key: 'businessno', label: '사업자번호', width: 150, render: (customer) => customer.businessno || '' },
];
const STOCK_CODE_PICKER_COLUMNS = [
  { key: 'code', label: '코드', width: 140 },
  { key: 'name', label: '코드명', width: 260 },
];

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
  return <SelectPickerModal opened={opened} onClose={onClose} size="md"
    title="품목 선택" description="기초재고에 넣을 품목을 고릅니다." icon={<IconBox size={21} stroke={1.8} />}
    searchValue={input} onSearchChange={setInput} onSearch={search} searchPlaceholder="품목코드, 품목명 또는 형태구분 검색"
    listTitle="품목" columns={STOCK_ITEM_PICKER_COLUMNS} rows={items} rowKey={(item) => item.itemcode} onSelect={(item) => { onSelect(item); onClose(); }}
    loading={loading} total={total} page={page} pageCount={Math.max(1, Math.ceil(total / pageSize))} onPageChange={setPage}
    emptyTitle="조회된 품목이 없습니다" emptyDescription="품목코드나 품목명을 바꿔 다시 조회해 주세요." />;
}

// Tab in an open suggestion list fills: the ↑/↓-highlighted entry, else an exact match of the typed text,
// else the first suggestion. Returns undefined when nothing applies.
// Tab 으로 고를 항목: 방향키로 고른 항목 → 이름·코드가 정확히 같은 항목 하나 → 후보가 하나뿐이면 그것.
// 정할 수 없으면 고르지 않는다 (칸을 벗어날 때처럼 확정: 친 글자는 그대로 두고, 코드가 안 맞으면 저장할 때 걸러진다).
const pickSuggestionForTab = (list, activeIndex, typed, valuesOf) => {
  if (!list.length) return undefined;
  if (activeIndex >= 0 && list[activeIndex]) return list[activeIndex];
  const normalized = String(typed || '').trim().toLocaleLowerCase();
  const exact = list.filter((entry) => valuesOf(entry).some((value) => String(value || '').trim().toLocaleLowerCase() === normalized));
  if (exact.length === 1) return exact[0];
  return list.length === 1 ? list[0] : undefined;
};

function ItemNameAutocompleteCell({ row, disabled, registerCellInput, onChange, onSelect, onFindItem, onFocus, onPaste }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.itemname || '');
  const [items, setItems] = useState([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  // 목록은 글자를 쳤을 때만 연다 (값이 있는 칸에 들어오기만 해도 목록이 열려 방향키·Enter 가 행 이동 대신 목록을 움직이지 않게)
  const [typed, setTyped] = useState(false);
  const requestIdRef = useRef(0);
  const skipBlurCommitRef = useRef(false);
  // 채우기·범위 붙여넣기로 바깥에서 값이 바뀌면, 아직 손대지 않은 입력칸은 새 값을 따른다
  const [syncedName, setSyncedName] = useState(row.itemname);
  if (syncedName !== row.itemname) {
    setSyncedName(row.itemname);
    if (editing) setDraft((current) => (current === (syncedName || '') ? row.itemname || '' : current));
  }
  const query = String(draft || '').trim();
  const opened = editing && typed && !disabled && query.length > 0 && items.length > 0;
  const idle = !editing || !typed || disabled || !query;
  if (idle && items.length) setItems([]);

  useEffect(() => {
    if (idle) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const { data } = await axios.get('/api/item-master/items/suggest', {
          ...authConfig(),
          params: { q: query },
          signal: controller.signal,
        });
        if (!controller.signal.aborted) setItems(data.items || []);
      } catch { /* Keep suggestions closed if lookup fails. */ }
    }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [editing, disabled, query, idle]);

  const chooseItem = (item) => {
    requestIdRef.current += 1;
    onSelect(row.id, item);
    setTyped(false);
    setDraft(item.itemname || '');
    setItems([]);
    setEditing(false);
    setActiveIndex(-1);
  };

  const commitExactMatch = async () => {
    const requestId = ++requestIdRef.current;
    const normalized = query.toLocaleLowerCase();
    if (!normalized) {
      onChange(row.id, 'itemname', '');
      setEditing(false);
      return;
    }
    let candidates = items;
    if (!candidates.some((item) => [item.itemname, item.itemcode]
      .some((value) => String(value || '').trim().toLocaleLowerCase() === normalized))) {
      try {
        const { data } = await axios.get('/api/item-master/items/suggest', {
          ...authConfig(), params: { q: query },
        });
        candidates = data.items || [];
      } catch { /* Keep the typed value so save validation can explain the mismatch. */ }
    }
    if (requestId !== requestIdRef.current) return;
    const exact = candidates.filter((item) => [item.itemname, item.itemcode]
      .some((value) => String(value || '').trim().toLocaleLowerCase() === normalized));
    if (exact.length === 1) chooseItem(exact[0]);
    else setEditing(false);
  };

  return <Popover opened={opened} onChange={(value) => { if (!value) setEditing(false); }} position="bottom-start" width="target" withinPortal shadow="sm" offset={2} zIndex={500}>
    <Popover.Target>
      <div>
        <input
          ref={(element) => registerCellInput(row.id, 'itemname', element)}
          className={`${codeClasses.cellInput} ${outboundClasses.itemCodePickerInput}`}
          aria-label={'품명'}
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-expanded={opened}
          value={editing ? draft : row.itemname || ''}
          maxLength={150}
          disabled={disabled}
          onPaste={onPaste}
          onFocus={(event) => {
            skipBlurCommitRef.current = false;
            requestIdRef.current += 1;
            setDraft(row.itemname || '');
            setTyped(false);
            setEditing(true);
            onFocus();
            event.currentTarget.select();
          }}
          onBlur={() => {
            // A Tab pick already filled the cell; committing the typed text now would undo it.
            if (skipBlurCommitRef.current) { skipBlurCommitRef.current = false; return; }
            // 손대지 않고 지나가기만 한 칸은 다시 확정하지 않는다 (지금 값 그대로)
            if (!typed) { setEditing(false); return; }
            void commitExactMatch();
          }}
          onChange={(event) => {
            const value = event.currentTarget.value;
            skipBlurCommitRef.current = false;
            setTyped(true);
            setDraft(value);
            setActiveIndex(-1);
            setEditing(true);
            onChange(row.id, 'itemname', value);
          }}
          onClick={(event) => {
            if (!disabled && event.nativeEvent.offsetX >= event.currentTarget.clientWidth - 28) {
              event.preventDefault();
              event.stopPropagation();
              setEditing(false);
              onFindItem(row.id);
            }
          }}
          onDoubleClick={() => onFindItem(row.id)}
          onKeyDown={(event) => {
            if (event.key === 'F2') {
              event.preventDefault();
              onFindItem(row.id);
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              // 목록이 열려 있을 때만 목록 이동. 닫혀 있으면 표의 위/아래 행 이동으로 넘긴다
              if (!opened) return;
              event.preventDefault();
              event.stopPropagation();
              setActiveIndex((current) => event.key === 'ArrowDown'
                ? (current + 1) % items.length
                : (current <= 0 ? items.length - 1 : current - 1));
            } else if (event.key === 'Enter' && opened && activeIndex >= 0 && items[activeIndex]) {
              event.preventDefault();
              event.stopPropagation();
              chooseItem(items[activeIndex]);
            } else if (event.key === 'Tab' && !event.shiftKey && opened) {
              // 고른 항목 → 정확히 같은 이름/코드 하나 → 후보가 하나뿐이면 그것. 못 정하면 칸을 벗어날 때처럼 확정
              const item = pickSuggestionForTab(items, activeIndex, draft, (entry) => [entry.itemname, entry.itemcode]);
              if (item) { skipBlurCommitRef.current = true; chooseItem(item); }
            } else if (event.key === 'Escape' && opened) {
              event.preventDefault();
              event.stopPropagation();
              setTyped(false);
              setEditing(false);
            }
          }}
        />
      </div>
    </Popover.Target>
    <Popover.Dropdown p={4} mah={240} style={{ overflowY: 'auto' }}>
      <Stack gap={2} role="listbox">
        {items.map((item, index) => <Box
          key={item.itemcode}
          role="option"
          aria-selected={index === activeIndex}
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => setActiveIndex(index)}
          onClick={() => chooseItem(item)}
          style={{
            display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 9px',
            borderRadius: 4, cursor: 'pointer', fontSize: 12,
            background: index === activeIndex ? 'var(--mantine-color-blue-0)' : undefined,
          }}
        >
          <Text size="xs" truncate>{item.itemname}</Text>
          <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>{item.itemcode}</Text>
        </Box>)}
      </Stack>
    </Popover.Dropdown>
  </Popover>;
}

function CustomerPicker({ opened, onClose, onSelect }) {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [customers, setCustomers] = useState([]);
  const [total, setTotal] = useState(0);
  // Each opening is a new session so reopening with the same query shows the loader again (as before).
  const [openSession, setOpenSession] = useState(0);
  const [prevOpened, setPrevOpened] = useState(opened);
  if (prevOpened !== opened) {
    setPrevOpened(opened);
    if (opened) setOpenSession((current) => current + 1);
  }
  const requestKey = `${openSession}|${query}|${page}`;
  const [finishedKey, setFinishedKey] = useState('');
  const loading = opened && finishedKey !== requestKey;

  useEffect(() => {
    if (!opened) return undefined;
    let alive = true;
    axios.get('/api/list', { ...authConfig(), params: { search_keyword: query || undefined, status: 'Y', page, page_size: 20, include_total: true } })
      .then(({ data }) => {
        if (!alive) return;
        setCustomers(data.data || []);
        setTotal(data.total || 0);
      })
      .catch((error) => { if (alive) notifications.show({ title: '거래처 조회 실패', message: errorText(error), color: 'red' }); })
      .finally(() => { if (alive) setFinishedKey(requestKey); });
    return () => { alive = false; };
  }, [opened, query, page, requestKey]);

  const search = () => { setPage(1); setQuery(input.trim()); };
  return <SelectPickerModal opened={opened} onClose={onClose} size="lg"
    title="거래처 선택" description="기초재고에 넣을 거래처를 고릅니다." icon={<IconBuildingStore size={21} stroke={1.8} />}
    searchValue={input} onSearchChange={setInput} onSearch={search} searchPlaceholder="거래처코드 또는 거래처명 검색"
    listTitle="거래처" columns={STOCK_CUSTOMER_PICKER_COLUMNS} rows={customers} rowKey={(customer) => customer.customercode} onSelect={(customer) => { onSelect(customer); onClose(); }}
    loading={loading} total={total} page={page} pageCount={Math.max(1, Math.ceil(total / 20))} onPageChange={setPage}
    emptyTitle="조회된 거래처가 없습니다" emptyDescription="거래처코드나 이름을 바꿔 다시 조회해 주세요." />;
}

function CustomerNameAutocompleteCell({ row, disabled, registerCellInput, onChange, onSelect, onFindCustomer, onFocus, onPaste }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.customname || '');
  const [customers, setCustomers] = useState([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [typed, setTyped] = useState(false);   // 목록은 글자를 쳤을 때만 연다
  const requestIdRef = useRef(0);
  const skipBlurCommitRef = useRef(false);
  // 채우기·범위 붙여넣기로 바깥에서 값이 바뀌면, 아직 손대지 않은 입력칸은 새 값을 따른다
  const [syncedName, setSyncedName] = useState(row.customname);
  if (syncedName !== row.customname) {
    setSyncedName(row.customname);
    if (editing) setDraft((current) => (current === (syncedName || '') ? row.customname || '' : current));
  }
  const query = String(draft || '').trim();
  const opened = editing && typed && !disabled && query.length > 0 && customers.length > 0;
  const idle = !editing || !typed || disabled || !query;
  if (idle && customers.length) setCustomers([]);

  useEffect(() => {
    if (idle) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const { data } = await axios.get('/api/list', {
          ...authConfig(),
          params: { search_keyword: query, status: 'Y', page: 1, page_size: 8, include_total: false },
          signal: controller.signal,
        });
        if (!controller.signal.aborted) setCustomers(data.data || []);
      } catch { /* Keep suggestions closed if lookup fails. */ }
    }, 220);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [editing, disabled, query, idle]);

  const chooseCustomer = (customer) => {
    requestIdRef.current += 1;
    onSelect(row.id, customer);
    setTyped(false);
    setDraft(customer.customername || '');
    setEditing(false);
    setActiveIndex(-1);
  };

  const commitExactMatch = async () => {
    const requestId = ++requestIdRef.current;
    const normalized = query.toLocaleLowerCase();
    if (!normalized) {
      onChange(row.id, 'customname', '');
      setEditing(false);
      return;
    }
    let candidates = customers;
    if (!candidates.some((customer) => [customer.customername, customer.customercode]
      .some((value) => String(value || '').trim().toLocaleLowerCase() === normalized))) {
      try {
        const { data } = await axios.get('/api/list', {
          ...authConfig(),
          params: { search_keyword: query, status: 'Y', page: 1, page_size: 8, include_total: false },
        });
        candidates = data.data || [];
      } catch { /* Keep the typed optional value if lookup fails. */ }
    }
    if (requestId !== requestIdRef.current) return;
    const exact = candidates.filter((customer) => [customer.customername, customer.customercode]
      .some((value) => String(value || '').trim().toLocaleLowerCase() === normalized));
    if (exact.length === 1) chooseCustomer(exact[0]);
    else setEditing(false);
  };

  return <Popover opened={opened} onChange={(value) => { if (!value) setEditing(false); }} position="bottom-start" width="target" withinPortal shadow="none" offset={0} zIndex={500}>
    <Popover.Target>
      <div>
        <input
          ref={(element) => registerCellInput(row.id, 'customname', element)}
          className={`${codeClasses.cellInput} ${outboundClasses.itemCodePickerInput}`}
          aria-label={'거래처명'}
          aria-haspopup="listbox"
          aria-expanded={opened}
          value={editing ? draft : row.customname || ''}
          maxLength={100}
          disabled={disabled}
          onPaste={onPaste}
          onFocus={(event) => {
            skipBlurCommitRef.current = false;
            requestIdRef.current += 1;
            setDraft(row.customname || '');
            setTyped(false);
            setEditing(true);
            onFocus();
            event.currentTarget.select();
          }}
          onBlur={() => {
            if (skipBlurCommitRef.current) { skipBlurCommitRef.current = false; return; }
            if (!typed) { setEditing(false); return; }   // 손대지 않은 칸은 그대로
            void commitExactMatch();
          }}
          onChange={(event) => {
            const value = event.currentTarget.value;
            skipBlurCommitRef.current = false;
            setTyped(true);
            setDraft(value);
            setActiveIndex(-1);
            setEditing(true);
            onChange(row.id, 'customname', value);
          }}
          onClick={(event) => {
            if (!disabled && event.nativeEvent.offsetX >= event.currentTarget.clientWidth - 28) {
              event.preventDefault();
              event.stopPropagation();
              setEditing(false);
              onFindCustomer(row.id);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'F2') {
              event.preventDefault();
              onFindCustomer(row.id);
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              if (!opened) return;   // 목록이 닫혀 있으면 표의 위/아래 행 이동
              event.preventDefault();
              event.stopPropagation();
              setActiveIndex((current) => event.key === 'ArrowDown'
                ? (current + 1) % customers.length
                : (current - 1 + customers.length) % customers.length);
            } else if (event.key === 'Enter' && opened) {
              event.preventDefault();
              event.stopPropagation();
              const customer = customers[activeIndex >= 0 ? activeIndex : 0];
              if (customer) chooseCustomer(customer);
            } else if (event.key === 'Tab' && !event.shiftKey && opened) {
              const customer = pickSuggestionForTab(customers, activeIndex, draft, (entry) => [entry.customername, entry.customercode]);
              if (customer) { skipBlurCommitRef.current = true; chooseCustomer(customer); }
            } else if (event.key === 'Escape' && opened) {
              event.preventDefault();
              event.stopPropagation();
              setDraft(row.customname || '');
              setTyped(false);
              setEditing(false);
              setActiveIndex(-1);
            }
          }}
          onDoubleClick={() => { if (!disabled) onFindCustomer(row.id); }}
        />
      </div>
    </Popover.Target>
    <Popover.Dropdown className={itemMasterClasses.shapeSuggestions}>
      <div role="listbox" aria-label={'거래처 검색 결과'}>
        {customers.map((customer, index) => <button
          key={customer.customercode}
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          className={itemMasterClasses.shapeSuggestion}
          style={index === activeIndex ? { background: 'var(--dk-bg-edf3f8, #edf3f8)' } : undefined}
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => setActiveIndex(index)}
          onClick={() => chooseCustomer(customer)}
        >
          <span>{customer.customername}</span>
        </button>)}
      </div>
    </Popover.Dropdown>
  </Popover>;
}

function MasterNameAutocompleteCell({ row, field, options, disabled, registerCellInput, onChange, onFindMaster, onFocus, onPaste }) {
  const nameField = field === 'warehousecode' ? 'warehousecodename' : field === 'materialcode' ? 'materialname' : 'surfacename';
  const displayValue = options.find((option) => option.code === row[field])?.name || row[nameField] || row[field] || '';
  const getDisplayValue = () => displayValue;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(getDisplayValue());
  const [activeIndex, setActiveIndex] = useState(-1);
  const [typed, setTyped] = useState(false);   // 목록은 글자를 쳤을 때만 연다
  const pickerOpenRef = useRef(false);
  const skipBlurCommitRef = useRef(false);
  // 채우기·범위 붙여넣기로 바깥에서 값이 바뀌면, 아직 손대지 않은 입력칸은 새 값을 따른다
  const [syncedDisplay, setSyncedDisplay] = useState(displayValue);
  if (syncedDisplay !== displayValue) {
    setSyncedDisplay(displayValue);
    if (editing) setDraft((current) => (current === (syncedDisplay || '') ? displayValue : current));
  }
  const query = String(draft || '').trim().toLocaleLowerCase();
  const matches = useMemo(() => editing && typed && !disabled && query
    ? options.filter((option) => `${option.name || ''} ${option.code || ''}`.toLocaleLowerCase().includes(query)).slice(0, 8)
    : [], [options, query, editing, typed, disabled]);
  const opened = editing && !disabled && matches.length > 0;

  const choose = (option) => {
    onChange(row.id, field, option.code);
    setTyped(false);
    setDraft(option.name || '');
    setEditing(false);
    setActiveIndex(-1);
  };
  const commit = () => {
    const value = String(draft || '').trim();
    if (!value) {
      onChange(row.id, field, '');
      setEditing(false);
      return;
    }
    const exact = options.filter((option) => [option.code, option.name]
      .some((candidate) => String(candidate || '').trim().toLocaleLowerCase() === value.toLocaleLowerCase()));
    if (exact.length === 1) choose(exact[0]);
    else {
      onChange(row.id, field, value);
      setEditing(false);
    }
  };
  const openPicker = () => {
    pickerOpenRef.current = true;
    setEditing(false);
    onFindMaster(row.id, field);
  };

  return <Popover opened={opened} onChange={(value) => { if (!value) setEditing(false); }} position="bottom-start" width="target" withinPortal shadow="sm" offset={2} zIndex={500}>
    <Popover.Target>
      <div>
        <input
          ref={(element) => registerCellInput(row.id, field, element)}
          className={`${codeClasses.cellInput} ${outboundClasses.itemCodePickerInput}`}
          aria-label={field === 'warehousecode' ? '창고' : field === 'materialcode' ? '강종' : '표면'}
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-expanded={opened}
          value={editing ? draft : getDisplayValue()}
          maxLength={100}
          disabled={disabled}
          onFocus={(event) => {
            skipBlurCommitRef.current = false;
            pickerOpenRef.current = false;
            setDraft(getDisplayValue());
            setTyped(false);
            setEditing(true);
            onFocus();
            event.currentTarget.select();
          }}
          onBlur={() => {
            if (skipBlurCommitRef.current) { skipBlurCommitRef.current = false; return; }
            if (!typed) { setEditing(false); return; }   // 손대지 않은 칸은 그대로
            if (!pickerOpenRef.current) commit();
          }}
          onChange={(event) => { skipBlurCommitRef.current = false; setTyped(true); setDraft(event.currentTarget.value); setActiveIndex(-1); setEditing(true); }}
          onClick={(event) => {
            if (event.nativeEvent.offsetX >= event.currentTarget.clientWidth - 28) {
              event.preventDefault();
              event.stopPropagation();
              openPicker();
            }
          }}
          onDoubleClick={openPicker}
          onPaste={(event) => {
            const text = event.clipboardData.getData('text/plain');
            onPaste(event);
            setDraft(text.split(/[\t\r\n]/, 1)[0].trim());
            setEditing(false);
          }}
          onKeyDown={(event) => {
            if (event.key === 'F2') {
              event.preventDefault();
              event.stopPropagation();
              if (!disabled) openPicker();
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              if (!opened) return;   // 목록이 닫혀 있으면 표의 위/아래 행 이동
              event.preventDefault();
              event.stopPropagation();
              setActiveIndex((current) => event.key === 'ArrowDown'
                ? (current + 1) % matches.length
                : (current - 1 + matches.length) % matches.length);
            } else if (event.key === 'Enter' && opened) {
              event.preventDefault();
              event.stopPropagation();
              const option = matches[activeIndex >= 0 ? activeIndex : 0];
              if (option) choose(option);
            } else if (event.key === 'Tab' && !event.shiftKey && opened) {
              const option = pickSuggestionForTab(matches, activeIndex, draft, (entry) => [entry.name, entry.code]);
              if (option) { skipBlurCommitRef.current = true; choose(option); }
            } else if (event.key === 'Escape' && opened) {
              event.preventDefault();
              event.stopPropagation();
              setDraft(getDisplayValue());
              setTyped(false);
              setEditing(false);
              setActiveIndex(-1);
            }
          }}
        />
      </div>
    </Popover.Target>
    <Popover.Dropdown p={4} mah={240} style={{ overflowY: 'auto' }}>
      <Stack gap={2} role="listbox">
        {matches.map((option, index) => <button
          key={option.code}
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => setActiveIndex(index)}
          onClick={() => choose(option)}
          style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 9px', border: 0, borderRadius: 4, background: index === activeIndex ? 'var(--mantine-color-blue-0)' : 'transparent', cursor: 'pointer', fontSize: 12, textAlign: 'left' }}
        >
          <span>{option.name}</span><Text size="xs" c="dimmed">{option.code}</Text>
        </button>)}
      </Stack>
    </Popover.Dropdown>
  </Popover>;
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

  return <SelectPickerModal opened={opened} onClose={onClose} size="sm"
    title={title} description="사용 중인 코드 중에서 고릅니다." icon={<IconListDetails size={21} stroke={1.8} />}
    searchValue={search} onSearchChange={(value) => { setSearch(value); setPage(1); }} searchPlaceholder="코드 또는 코드명 검색"
    listTitle="코드" columns={STOCK_CODE_PICKER_COLUMNS} rows={visible} rowKey={(option) => option.code} onSelect={onSelect}
    total={filtered.length} page={page} pageCount={pageCount} onPageChange={setPage}
    emptyTitle="조회된 사용 중 코드가 없습니다" />;
}

// One grid row's cells. Memoized so typing in one row (or toggling one checkbox) re-renders only that row;
// every callback comes from the page's stable `handlers` object, which always calls the latest logic.
// Same markup as Mantine's <Table.Td> inside a table with column borders, but without reading the Table
// context: Mantine creates a new context value on every table render, which would re-render every cell.
const GRID_CELL_CLASS = `${Table.classes.td} mantine-Table-td`;
const GridCell = ({ className, children, ...props }) => (
  <td {...props} className={className ? `${GRID_CELL_CLASS} ${className}` : GRID_CELL_CLASS} data-with-column-border="true">{children}</td>
);

const StockGridRowCells = memo(function StockGridRowCells({ row, rowNumber, isSelected, saving, masters, handlers }) {
  const saved = Boolean(row.lineno);
  const renderField = (key) => {
    const editableSavedPrice = saved && EDITABLE_PRICE_FIELDS.has(key);
    // New rows: optional input cells are white; required (*) cells keep the new-row tint.
    const newCellClass = OPTIONAL_INPUT_FIELDS.has(key) ? classes.optionalNewCell : '';
    const masterKey = MASTER_FIELDS.has(key);
    const masterOptions = masters[MASTER_KIND[key]] || [];
    const displayed = key === 'qtyunit' || key === 'unit'
      ? masterOptions.find((option) => option.code === row[key])?.name || row[key] || ''
      : key === 'warehousecode' ? row.warehousecodename || row.warehousecode || ''
        : key === 'materialcode' ? masterOptions.find((option) => option.code === row.materialcode)?.name || row.materialname || row.materialcode || ''
          : key === 'surfacecode' ? masterOptions.find((option) => option.code === row.surfacecode)?.name || row.surfacename || row.surfacecode || ''
            : ['supplyamt', 'vat', 'unitamt'].includes(key) ? formatAmount(amounts[key])
              : ['myrtle', 'thickness', 'width', 'length', 'qty', 'weight', 'unitprice'].includes(key) ? numberText(row[key]) : row[key] ?? '';
    if (saved && !PRICE_FIELDS.has(key)) return <GridCell key={key} className={outboundClasses.savedCell}>
      <span className={`${classes.savedValue} ${['supplyamt', 'vat', 'unitamt'].includes(key) ? classes.savedAmountValue : ''}`} title={String(displayed)}>{displayed}</span>
    </GridCell>;
    const readOnly = key === 'unitamt';
    const disabled = saving || (saved && !PRICE_FIELDS.has(key));
    const pasted = (event) => {
      if (key === 'unitamt') {
        event.preventDefault();
        return;
      }
      const text = event.clipboardData.getData('text/plain');
      if (text.includes('\t') || text.includes('\n')) {
        event.preventDefault();
        handlers.pasteRange(row.id, key, text);
      } else if (masterKey) {
        event.preventDefault();
        handlers.updateRow(row.id, key, text.trim());
      }
    };
    if (key === 'standdate') return <GridCell key={key} className={saved ? outboundClasses.savedCell : newCellClass}>
      <input
        ref={(element) => handlers.registerCellInput(row.id, key, element)}
        className={codeClasses.cellInput}
        aria-label={'기초일자'}
        data-row-id={row.id}
        data-field={key}
        type="text"
        inputMode="numeric"
        maxLength={10}
        placeholder="YYYY-MM-DD"
        value={row.standdate || ''}
        disabled={disabled}
        onFocus={() => handlers.setActiveCell(row.id, key)}
        onChange={(event) => handlers.updateRow(row.id, key, event.currentTarget.value)}
        onPaste={pasted}
      />
    </GridCell>;
    if (key === 'customname') return <GridCell key={key} className={saved ? outboundClasses.savedCell : newCellClass}>
      <CustomerNameAutocompleteCell
        row={row}
        disabled={disabled}
        registerCellInput={handlers.registerCellInput}
        onChange={handlers.updateRow}
        onSelect={handlers.selectCustomerForRow}
        onFindCustomer={handlers.openCustomerPicker}
        onFocus={() => handlers.setActiveCell(row.id, key)}
        onPaste={pasted}
      />
    </GridCell>;
    if (key === 'itemname') return <GridCell key={key} className={saved ? outboundClasses.savedCell : newCellClass}>
      <ItemNameAutocompleteCell
        row={row}
        disabled={disabled}
        registerCellInput={handlers.registerCellInput}
        onChange={handlers.updateRow}
        onSelect={handlers.selectItem}
        onFindItem={handlers.openItemPicker}
        onFocus={() => handlers.setActiveCell(row.id, key)}
        onPaste={pasted}
      />
    </GridCell>;
    if (['warehousecode', 'materialcode', 'surfacecode'].includes(key)) return <GridCell key={key} className={saved ? outboundClasses.savedCell : newCellClass}>
      <MasterNameAutocompleteCell
        row={row}
        field={key}
        options={masterOptions}
        disabled={disabled}
        registerCellInput={handlers.registerCellInput}
        onChange={handlers.updateRow}
        onFindMaster={handlers.openMasterPicker}
        onFocus={() => handlers.setActiveCell(row.id, key)}
        onPaste={pasted}
      />
    </GridCell>;
    if (key === 'unit' || key === 'qtyunit') {
      const defaultValue = key === 'unit' ? 'KG' : 'EA';
      const value = resolveMasterCode(key, row[key] || defaultValue, masters) || row[key] || defaultValue;
      return <GridCell key={key} className={saved ? outboundClasses.savedCell : newCellClass}>
        <select
          ref={(element) => handlers.registerCellInput(row.id, key, element)}
          className={`${codeClasses.cellSelect} ${inboundClasses.priceUnitSelect}`}
          aria-label={STOCK_GRID_COLUMNS.find(([columnKey]) => columnKey === key)?.[1] || key}
          data-row-id={row.id}
          data-field={key}
          value={value}
          disabled={disabled}
          onFocus={() => handlers.setActiveCell(row.id, key)}
          onPaste={pasted}
          onChange={(event) => handlers.updateRow(row.id, key, event.currentTarget.value)}
        >
          {row[key] && !resolveMasterCode(key, row[key], masters) && <option value={row[key]}>{row[key]}</option>}
          {masterOptions.map((option) => <option key={option.code} value={option.code}>{option.name || option.code}</option>)}
        </select>
      </GridCell>;
    }
    return <GridCell key={key} className={saved ? (editableSavedPrice ? classes.savedEditableCell : outboundClasses.savedCell) : newCellClass}>
      <input
        ref={(element) => {
          handlers.registerCellInput(row.id, key, element);
        }}
        className={`${codeClasses.cellInput} ${['unitamt', 'supplyamt', 'vat'].includes(key) ? outboundClasses.amountInput : ''} ${key === 'itemcode' || key === 'itemname' || key === 'customname' || masterKey ? outboundClasses.itemCodePickerInput : ''}`}
        aria-label={STOCK_GRID_COLUMNS.find(([columnKey]) => columnKey === key)?.[1] || key}
        title={key === 'itemcode' || key === 'itemname' ? '더블클릭하여 품목 선택' : masterKey ? '더블클릭하여 마스터 코드 선택' : undefined}
        data-row-id={row.id}
        data-field={key}
        inputMode={['myrtle', 'thickness', 'width', 'length', 'qty', 'weight', 'unitprice', 'supplyamt', 'vat'].includes(key) ? 'decimal' : undefined}
        value={displayed}
        placeholder={row.isNew && (key === 'itemcode' || key === 'itemname') ? (key === 'itemcode' ? '품목코드' : '품목명') : ''}
        readOnly={readOnly || disabled}
        disabled={disabled}
        onFocus={() => handlers.setActiveCell(row.id, key)}
        onClick={(event) => {
          if (masterKey && !disabled && event.nativeEvent.offsetX >= event.currentTarget.clientWidth - 28) {
            event.preventDefault();
            event.stopPropagation();
            handlers.openMasterPicker(row.id, key);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'F2' && !disabled) {
            event.preventDefault();
            event.stopPropagation();
            if (key === 'customname') handlers.openCustomerPicker(row.id);
            else if (key === 'itemcode' || key === 'itemname') handlers.openItemPicker(row.id);
            else if (masterKey) handlers.openMasterPicker(row.id, key);
          }
        }}
        onDoubleClick={() => {
          if (key === 'customname') handlers.openCustomerPicker(row.id);
          else if (key === 'itemcode' || key === 'itemname') handlers.openItemPicker(row.id);
          else if (masterKey) handlers.openMasterPicker(row.id, key);
        }}
        onPaste={pasted}
        onBlur={key === 'customname' ? (event) => { void handlers.resolveCustomerName(row.id, event.currentTarget.value); } : key === 'itemcode' || key === 'itemname' ? async (event) => {
          const itemValue = event.currentTarget.value.trim();
          if (!itemValue) return;
          try {
            const { data } = await axios.get('/api/item-master/items/picker', { ...authConfig(), params: { q: itemValue, page: 1, page_size: 20 } });
            const normalizedValue = itemValue.toLocaleLowerCase();
            const match = (data.items || []).find((item) => String(item.itemcode).trim().toLocaleLowerCase() === normalizedValue
              || String(item.itemname).trim().toLocaleLowerCase() === normalizedValue);
            if (match) handlers.selectItem(row.id, match);
          } catch { /* Keep the entered code so validation can identify it on save. */ }
        } : undefined}
        onChange={(event) => handlers.updateRow(row.id, key, ['myrtle', 'thickness', 'width', 'length', 'qty', 'weight', 'unitprice', 'supplyamt', 'vat'].includes(key) ? cleanNumber(event.currentTarget.value) : event.currentTarget.value)}
      />
    </GridCell>;
  };
  const amounts = calculateAmounts(row, masters.price);

  return <>
    <GridCell className={codeClasses.checkCol} title={saved && row.delete_block ? `삭제 불가: ${DELETE_BLOCK_TEXT[row.delete_block] || row.delete_block}` : undefined}>
      {/* Saved lines can be selected for deletion only while their stock source row is unused. */}
      <input type="checkbox" checked={isSelected} disabled={saving || (saved && Boolean(row.delete_block))} onChange={(event) => handlers.toggleRowSelection(row.id, event.nativeEvent.shiftKey)} />
    </GridCell>
    <GridCell className={`${codeClasses.rowNumber} ${!saved ? classes.newRowNumber : ''}`}>{rowNumber}</GridCell>
    {GRID_FIELDS.map(renderField)}
  </>;
});

export default function StockStandPage() {
  const pageActivation = usePageActivation(); // 탭에 돌아올 때마다 목록(코드·거래처)을 다시 불러온다
  const initialRange = currentMonthRange();
  const [standdate, setStanddate] = useState(localDate);
  const [dateFrom, setDateFrom] = useState(initialRange.from);
  const [dateTo, setDateTo] = useState(initialRange.to);
  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState('');
  const [warehouseInput, setWarehouseInput] = useState('');
  const [warehouseQuery, setWarehouseQuery] = useState('');
  const [filterOpen, setFilterOpen] = useState(true);
  const [rows, setRows] = useState([]);
  const [totalRows, setTotalRows] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [selectedIds, setSelectedIds] = useState([]);
  const [masters, setMasters] = useState(cachedStandMasters);
  const [hasSavedStock, setHasSavedStock] = useState(false);
  const [hasTransactions, setHasTransactions] = useState(false);
  const [hasStockMovements, setHasStockMovements] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMoreRows, setLoadingMoreRows] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [itemPickerId, setItemPickerId] = useState('');
  const [customerPickerId, setCustomerPickerId] = useState('');
  const [masterPickerTarget, setMasterPickerTarget] = useState(null);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [deleteBlocked, setDeleteBlocked] = useState('');   // 서버가 삭제를 거절한 사유 (삭제 창에 표시)
  const [deleteLinesOpen, setDeleteLinesOpen] = useState(false);
  // Bottom-right "discard unsaved changes?" confirm (replaces the browser's window.confirm).
  const [discardMessage, setDiscardMessage] = useState('');
  const discardResolveRef = useRef(null);
  const askDiscard = useCallback((action) => new Promise((resolve) => {
    discardResolveRef.current?.(false);
    discardResolveRef.current = resolve;
    setDiscardMessage(`저장하지 않은 변경사항이 있습니다. ${action} 변경 내용이 사라집니다. 계속할까요?`);
  }), []);
  const answerDiscard = useCallback((confirmed) => {
    const resolve = discardResolveRef.current;
    discardResolveRef.current = null;
    setDiscardMessage('');
    resolve?.(confirmed);
  }, []);
  useEffect(() => () => discardResolveRef.current?.(false), []);
  const [columnWidths, setColumnWidths] = useState({});
  const uploadInputRef = useRef(null);
  const virtuosoRef = useRef(null);
  const cellInputRefs = useRef(new Map());
  const pendingCellFocusRef = useRef(null);
  const originalRowsRef = useRef(new Map());
  const activeCellRef = useRef(null);
  const selectionAnchorRef = useRef('');
  const listRequestIdRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const hasMoreRowsRef = useRef(false);
  const nextCursorRef = useRef(0);
  const { changedPriceRows, hasChanges } = useMemo(() => {
    const hasNew = rows.some((row) => !row.lineno && hasRowInput(row));
    const changedPrices = rows.filter((row) => {
      if (!row.lineno) return false;
      const original = originalRowsRef.current.get(row.id);
      return original && [...EDITABLE_PRICE_FIELDS].some((field) => String(row[field] ?? '') !== String(original[field] ?? ''));
    });
    return { hasNewRows: hasNew, changedPriceRows: changedPrices, hasChanges: hasNew || changedPrices.length > 0 };
  }, [rows]);
  useUnsavedChanges(hasChanges);   // 탭 닫기 · 브라우저 닫기 전에 확인
  const displayRowCount = hasSavedStock ? totalRows : rows.length;
  const visibleRows = hasSavedStock ? rows : rows.slice((page - 1) * pageSize, page * pageSize);
  const pageCount = Math.max(1, Math.ceil(displayRowCount / pageSize));
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const { selectedSavedCount, selectedNewCount } = useMemo(() => rows.reduce((counts, row) => {
    if (selectedSet.has(row.id)) counts[row.lineno ? 'selectedSavedCount' : 'selectedNewCount'] += 1;
    return counts;
  }, { selectedSavedCount: 0, selectedNewCount: 0 }), [rows, selectedSet]);

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

  const loadRows = useCallback(async (nextDate = standdate, nextQuery = query, confirmDiscard = true, useRegisteredDate = false, nextPage = page, nextPageSize = pageSize, nextDateFrom = dateFrom, nextDateTo = dateTo, nextWarehouse = warehouseQuery, expectRegistered = false) => {
    if (confirmDiscard && hasChanges && !(await askDiscard('조회하면'))) return;
    const requestId = ++listRequestIdRef.current;
    loadingMoreRef.current = false;
    setLoadingMoreRows(false);
    hasMoreRowsRef.current = false;
    nextCursorRef.current = 0;
    setLoading(true);
    try {
      const offset = (nextPage - 1) * nextPageSize;
      let response = await axios.get('/api/stock-stand/items', { ...authConfig(), params: { standdate: nextDate, date_from: nextDateFrom || undefined, date_to: nextDateTo || undefined, q: nextQuery || undefined, warehouse: nextWarehouse || undefined, cursor: 0, limit: nextPageSize, offset } });
      let data = response.data;
      const registeredDate = data.registered_standdate ? String(data.registered_standdate).slice(0, 10) : '';
      if (data.has_stock_rows && registeredDate) void loadMaster(REGISTERED_DATE_KEY, () => registeredDate);
      // 지난번 등록일로 바로 조회했는데 지금 등록일과 다르면(삭제·재등록 등) 아무것도 바꾸지 않고 예전 방식으로 다시 조회한다
      if (expectRegistered && !(data.has_stock_rows && registeredDate === nextDate)) return 'mismatch';
      if (useRegisteredDate && data.has_stock_rows && registeredDate && registeredDate !== nextDate) {
        const today = localDate();
        setStanddate(registeredDate);
        setDateFrom(registeredDate);
        setDateTo(today);
        response = await axios.get('/api/stock-stand/items', { ...authConfig(), params: { standdate: registeredDate, date_from: registeredDate, date_to: today, q: nextQuery || undefined, warehouse: nextWarehouse || undefined, cursor: 0, limit: nextPageSize, offset } });
        data = response.data;
      }
      if (requestId !== listRequestIdRef.current) return;
      const loadedRows = (data.items || []).map((item) => makeRow(item));
      originalRowsRef.current = new Map(loadedRows.filter((row) => row.lineno).map((row) => [row.id, { ...row }]));
      setRows(loadedRows);
      setTotalRows(Number(data.total) || 0);
      hasMoreRowsRef.current = Boolean(data.has_more);
      nextCursorRef.current = Number(data.next_cursor) || 0;
      setSelectedIds([]);
      setHasSavedStock(Boolean(data.has_stock_rows));
      setHasTransactions(Boolean(data.has_transactions));
      setHasStockMovements(Boolean(data.has_stock_movements));
      return true;
    } catch (error) {
      notifications.show({ title: '기초재고 조회 실패', message: errorText(error), color: 'red' });
      return false;
    } finally { if (requestId === listRequestIdRef.current) setLoading(false); }
  }, [standdate, query, hasChanges, page, pageSize, dateFrom, dateTo, warehouseQuery, askDiscard]);

  const changePage = async (nextPage) => {
    if (nextPage < 1 || nextPage > pageCount || nextPage === page) return;
    if (hasSavedStock && hasChanges && !(await askDiscard('페이지를 이동하면'))) return;
    if (hasSavedStock && !(await loadRows(standdate, query, false, false, nextPage, pageSize))) return;
    setPage(nextPage);
  };

  const changePageSize = async (value) => {
    const nextPageSize = Number(value);
    if (!nextPageSize || nextPageSize === pageSize) return;
    if (hasSavedStock && hasChanges && !(await askDiscard('표시 행 수를 바꾸면'))) return;
    if (hasSavedStock && !(await loadRows(standdate, query, false, false, 1, nextPageSize))) return;
    setPageSize(nextPageSize);
    setPage(1);
  };

  const runSearch = async () => {
    const nextQuery = searchInput.trim();
    const nextWarehouse = warehouseInput.trim();
    if (dateFrom && dateTo && dateFrom > dateTo) {
      notifications.show({ title: '조회 기간 확인', message: '시작일은 종료일보다 늦을 수 없습니다.', color: 'red' });
      return;
    }
    if (hasChanges && !(await askDiscard('조회하면'))) return;
    const nextDate = dateTo || dateFrom || standdate;
    if (!(await loadRows(nextDate, nextQuery, false, false, 1, pageSize, dateFrom, dateTo, nextWarehouse))) return;
    setStanddate(nextDate);
    setQuery(nextQuery);
    setWarehouseQuery(nextWarehouse);
    setPage(1);
  };

  // 코드 목록: 지난번 값(메모리 캐시)으로 화면을 바로 채우고 서버 값으로 곧바로 바꾼다. 여러 쪽은 병렬로 받는다 (값 모양은 예전과 같음)
  const loadCodes = useCallback((groupcode) => loadMaster(`code-all-use:${groupcode}`, async () => {
    const all = await fetchAllPages(async (pageNumber) => {
      const { data } = await axios.get(`/api/code-master/groups/${groupcode}/items`, { ...authConfig(), params: { page: pageNumber, page_size: 200, include_total: true } });
      return { items: data.items || [], total: data.total || 0 };
    }, 200);
    return all.filter((item) => item.use).map((item) => ({ code: item.code, name: item.name }));
  }), []);

  useEffect(() => {
    // 처음 열 때: 지난번에 알게 된 등록 기초일자가 있으면 그 날짜로 바로 한 번에 조회한다
    // (예전: 오늘 날짜로 한 번 조회 → 등록일이 다르면 등록일로 다시 조회 = 요청 두 번). 결과는 예전 두 번째 조회와 같다.
    const guess = peekMaster(REGISTERED_DATE_KEY);
    if (guess) {
      const today = localDate();
      void loadRows(guess, '', false, false, 1, pageSize, guess, today, '', true).then((result) => {
        if (result === true) { setStanddate(guess); setDateFrom(guess); setDateTo(today); }
        else if (result === 'mismatch') void loadRows(standdate, '', false, true);
      });
      return;
    }
    loadRows(standdate, '', false, true);
  // Initial load; date changes are explicitly searched to protect edits.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    Promise.all([loadCodes('QTY'), loadCodes('WAREHOUSE'), loadCodes('PRICE_UNIT'), loadCodes('MATERIAL'), loadCodes('SURFACE')])
      .then(([quantity, warehouse, price, material, surface]) => setMasters({ quantity, warehouse, price, material, surface }))
      .catch((error) => notifications.show({ title: '기초재고 코드 조회 실패', message: errorText(error), color: 'red' }));
  }, [loadCodes, pageActivation]);

  useEffect(() => {
    if (!masters.warehouse.length && !masters.material.length && !masters.surface.length) return;
    setRows((current) => {
      let changed = false;
      const nextRows = current.map((row) => {
        if (row.lineno) return row;
        const next = { ...row };
        let rowChanged = false;
        for (const [field, nameField] of [
          ['warehousecode', 'warehousecodename'],
          ['materialcode', 'materialname'],
          ['surfacecode', 'surfacename'],
        ]) {
          const code = resolveMasterCode(field, next[nameField] || next[field], masters);
          if (!code) continue;
          const option = masters[MASTER_KIND[field]].find((entry) => entry.code === code);
          if (next[field] !== code || next[nameField] !== option?.name) rowChanged = true;
          next[field] = code;
          next[nameField] = option?.name || '';
        }
        if (rowChanged) changed = true;
        return rowChanged ? next : row;
      });
      return changed ? nextRows : current;
    });
  }, [masters]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const updateRow = useCallback((id, key, value) => {
    const applyToSelected = MASTER_FIELDS.has(key) && selectedIds.length > 1 && selectedSet.has(id);
    setRows((current) => current.map((row) => {
      // Bulk master changes apply to selected NEW rows only (saved rows are selectable just for deletion).
      if (row.id !== id && !(applyToSelected && selectedSet.has(row.id) && !row.lineno)) return row;
      if (row.lineno && !PRICE_FIELDS.has(key)) return row;
      const next = { ...row, [key]: value };
      if (key === 'itemcode') next.itemname = '';
      if (key === 'itemname') next.itemcode = '';
      if (key === 'customname') next.customcode = '';
      if (key === 'supplyamt' || key === 'vat') next[`${key}_manual`] = true;
      if (key === 'unit' || key === 'unitprice') {
        next.supplyamt_manual = false;
        next.vat_manual = false;
      }
      if (MASTER_FIELDS.has(key)) {
        const code = resolveMasterCode(key, value, masters);
        next[key] = code || value;
        if (key === 'warehousecode') next.warehousecodename = masters.warehouse.find((option) => option.code === code)?.name || '';
        if (key === 'materialcode') next.materialname = masters.material.find((option) => option.code === code)?.name || '';
        if (key === 'surfacecode') next.surfacename = masters.surface.find((option) => option.code === code)?.name || '';
      }
      if (['unit', 'qty', 'length', 'weight', 'unitprice', 'supplyamt', 'vat'].includes(key)) Object.assign(next, calculateAmounts(next, masters.price));
      return next;
    }));
  }, [masters, selectedIds.length, selectedSet]);

  const addRow = () => {
    const row = makeRow({
      standdate: localDate(),
      qtyunit: resolveMasterCode('qtyunit', 'EA', masters) || 'EA',
      unit: resolveMasterCode('unit', 'KG', masters) || 'KG',
    });
    setRows((current) => [...current, row]);
    const nextPage = hasSavedStock ? page : Math.ceil((rows.length + 1) / pageSize);
    setPage(nextPage);
    setSelectedIds([]);
    selectionAnchorRef.current = '';
    pendingCellFocusRef.current = { key: `${row.id}:standdate` };
    requestAnimationFrame(() => {
      virtuosoRef.current?.scrollToIndex({ index: Math.max(0, rows.length - (nextPage - 1) * pageSize), align: 'end', behavior: 'auto' });
    });
  };
  const copySelectedRow = () => {
    if (saving || loading || uploading) return;
    if (selectedIds.length !== 1) {
      notifications.show({ title: '복사할 행 선택', message: '복사할 기초재고 행을 하나 선택해 주세요.', color: 'orange' });
      return;
    }
    const source = rows.find((row) => row.id === selectedIds[0]);
    if (!source || source.lineno) return;
    const values = Object.fromEntries(Object.entries(source)
      .filter(([key]) => !['id', 'lineno', 'isNew', 'has_movements', 'delete_block', 'created_at', 'updated_at', 'created_by', 'updated_by'].includes(key)));
    const copy = makeRow(values);
    const nextPage = hasSavedStock ? page : Math.ceil((rows.length + 1) / pageSize);
    setRows((current) => [...current, copy]);
    setSelectedIds([copy.id]);
    setPage(nextPage);
    selectionAnchorRef.current = '';
    pendingCellFocusRef.current = { key: `${copy.id}:standdate` };
    requestAnimationFrame(() => {
      virtuosoRef.current?.scrollToIndex({ index: Math.max(0, rows.length - (nextPage - 1) * pageSize), align: 'end', behavior: 'auto' });
    });
    notifications.show({ title: '행 복사 완료', message: '선택한 행의 입력값을 그대로 복사했습니다.', color: 'teal' });
  };
  const selectItem = (id, item) => setRows((current) => current.map((row) => row.id === id ? { ...row, itemcode: item.itemcode, itemname: item.itemname } : row));
  const selectCustomerForRow = (rowId, customer) => {
    setRows((current) => current.map((row) => row.id === rowId
      ? { ...row, customcode: customer.customercode || '', customname: customer.customername || '' }
      : row));
  };
  const selectCustomer = (customer) => {
    selectCustomerForRow(customerPickerId, customer);
    setCustomerPickerId('');
  };
  const resolveCustomerName = async (id, value) => {
    const customerValue = value.trim();
    if (!customerValue) return;
    try {
      const { data } = await axios.get('/api/list', { ...authConfig(), params: { search_keyword: customerValue, status: 'Y', page: 1, page_size: 20, include_total: false } });
      const normalizedValue = customerValue.toLocaleLowerCase();
      const matches = (data.data || []).filter((customer) => [customer.customercode, customer.customername]
        .some((candidate) => String(candidate || '').trim().toLocaleLowerCase() === normalizedValue));
      if (matches.length === 1) setRows((current) => current.map((row) => row.id === id
        ? { ...row, customcode: matches[0].customercode || '', customname: matches[0].customername || '' }
        : row));
    } catch { /* Keep the entered optional customer name if lookup fails. */ }
  };

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
    const rowIndex = visibleRows.findIndex((row) => row.id === id);
    if (rowIndex < 0) return;
    pendingCellFocusRef.current = { key: `${id}:${field}` };
    virtuosoRef.current?.scrollToIndex({ index: rowIndex, align: 'center', behavior: 'auto' });
  }, [visibleRows]);

  const moveGridCell = useCallback((id, field, rowDelta, columnDelta) => {
    const rowIndex = visibleRows.findIndex((row) => row.id === id);
    if (rowIndex < 0) return false;
    let nextRow = rowIndex;
    let nextColumn = GRID_FIELDS.indexOf(field);
    if (nextColumn < 0) return false;
    nextRow += rowDelta;
    nextColumn += columnDelta;
    if (nextColumn < 0) { nextRow -= 1; nextColumn = GRID_FIELDS.length - 1; }
    if (nextColumn >= GRID_FIELDS.length) { nextRow += 1; nextColumn = 0; }
    if (nextRow < 0 || nextRow >= visibleRows.length) return false;
    focusGridCell(visibleRows[nextRow].id, GRID_FIELDS[nextColumn]);
    return true;
  }, [visibleRows, focusGridCell]);

  const pasteRange = useCallback(async (startId, startField, pastedText) => {
    const matrix = pastedText.replace(/\r/g, '').split('\n').filter((line, index, all) => line || index < all.length - 1).map((line) => line.split('\t'));
    // startId 가 없으면 빈 표에 처음부터 붙여넣는다 (모든 행을 새로 만든다)
    const startIndex = startId == null && !rows.length ? 0 : rows.findIndex((row) => row.id === startId);
    const startColumn = GRID_FIELDS.indexOf(startField);
    if (startIndex < 0 || startColumn < 0) return;
    const targetRowCount = startIndex + matrix.length;
    if (startIndex + matrix.length > 10000) {
      notifications.show({ title: '붙여넣기 제한', message: '한 번에 최대 10,000행까지 입력할 수 있습니다.', color: 'orange' });
      return;
    }
    let workingRows = rows;
    if (hasSavedStock && targetRowCount > workingRows.length) {
      const requestId = listRequestIdRef.current;
      let cursor = nextCursorRef.current;
      let hasMore = hasMoreRowsRef.current;
      loadingMoreRef.current = true;
      setLoadingMoreRows(true);
      try {
        while (workingRows.length < targetRowCount && hasMore) {
          const { data } = await axios.get('/api/stock-stand/items', {
            ...authConfig(),
            params: { standdate, q: query || undefined, cursor, limit: 500, include_metadata: false },
          });
          if (requestId !== listRequestIdRef.current) return;
          const pageRows = (data.items || []).map((item) => makeRow(item));
          if (!pageRows.length) break;
          for (const row of pageRows) originalRowsRef.current.set(row.id, { ...row });
          workingRows = [...workingRows, ...pageRows];
          cursor = Number(data.next_cursor) || cursor;
          hasMore = Boolean(data.has_more);
        }
        nextCursorRef.current = cursor;
        hasMoreRowsRef.current = hasMore;
        setRows(workingRows);
      } catch (error) {
        notifications.show({ title: '기초재고 추가 조회 실패', message: errorText(error), color: 'red' });
        return;
      } finally {
        loadingMoreRef.current = false;
        setLoadingMoreRows(false);
      }
      if (workingRows.length < targetRowCount) return;
    }
    const nextRows = [...workingRows];
    const additions = [];
    matrix.forEach((line, rowOffset) => {
      const target = nextRows[startIndex + rowOffset] ? { ...nextRows[startIndex + rowOffset] } : makeRow({ standdate, qtyunit: resolveMasterCode('qtyunit', 'EA', masters) || 'EA' });
      line.forEach((cell, columnOffset) => {
        const key = GRID_FIELDS[startColumn + columnOffset];
        if (!key || key === 'unitamt') return;
        if (target.lineno && !EDITABLE_PRICE_FIELDS.has(key)) return;
        const value = String(cell ?? '').trim();
        if (key === 'unit' || key === 'unitprice') {
          target.supplyamt_manual = false;
          target.vat_manual = false;
        }
        if (MASTER_FIELDS.has(key)) {
          const code = resolveMasterCode(key, value, masters);
          target[key] = value ? code || value : '';
          if (key === 'warehousecode') target.warehousecodename = masters.warehouse.find((option) => option.code === code)?.name || '';
          if (key === 'materialcode') target.materialname = masters.material.find((option) => option.code === code)?.name || '';
          if (key === 'surfacecode') target.surfacename = masters.surface.find((option) => option.code === code)?.name || '';
        } else if (['myrtle', 'thickness', 'width', 'length', 'qty', 'weight', 'unitprice', 'supplyamt', 'vat'].includes(key)) {
          target[key] = value ? cleanNumber(value) : '';
          if (key === 'supplyamt' || key === 'vat') target[`${key}_manual`] = true;
        }
        else {
          target[key] = value;
          if (key === 'customname') target.customcode = '';
          if (key === 'itemname') target.itemcode = '';
        }
      });
      Object.assign(target, calculateAmounts(target, masters.price));
      if (nextRows[startIndex + rowOffset]) nextRows[startIndex + rowOffset] = target;
      else additions.push(target);
    });
    setRows([...nextRows, ...additions]);
  }, [rows, masters, hasSavedStock, standdate, query]);

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

  // ── 셀 범위 선택 (Shift+방향키 · Shift+클릭). 포커스는 시작 칸에 두고 범위는 표 칸(td)에 클래스로만 칠한다 ──
  // activeCellRef: 현재 칸 (입력칸 포커스 또는 저장된 행 칸 클릭). rangeRef: { anchorId, anchorColumn, focusId, focusColumn }
  const gridWrapRef = useRef(null);
  const visibleRowsRef = useRef(visibleRows);
  useLayoutEffect(() => { visibleRowsRef.current = visibleRows; });
  const rangeRef = useRef(null);
  const paintedCellsRef = useRef(new Set());
  const paintFrameRef = useRef(0);
  const getRangeBounds = useCallback(() => {
    const range = rangeRef.current;
    if (!range) return null;
    const list = visibleRowsRef.current;
    const anchorIndex = list.findIndex((row) => row.id === range.anchorId);
    const focusIndex = range.focusId === range.anchorId ? anchorIndex : list.findIndex((row) => row.id === range.focusId);
    if (anchorIndex < 0 || focusIndex < 0) return null;
    return {
      top: Math.min(anchorIndex, focusIndex), bottom: Math.max(anchorIndex, focusIndex),
      left: Math.min(range.anchorColumn, range.focusColumn), right: Math.max(range.anchorColumn, range.focusColumn), focusIndex,
    };
  }, []);
  const isMultiCellRange = useCallback((bounds = getRangeBounds()) => Boolean(bounds && (bounds.top !== bounds.bottom || bounds.left !== bounds.right)), [getRangeBounds]);
  const rowElement = useCallback((id) => {
    const escaped = window.CSS?.escape ? window.CSS.escape(String(id)) : String(id).replace(/"/g, '\\"');
    return gridWrapRef.current?.querySelector(`tr[data-row-id="${escaped}"]`) || null;
  }, []);
  const paintRange = useCallback(() => {
    paintFrameRef.current = 0;
    paintedCellsRef.current.forEach((cell) => cell.classList.remove(classes.rangeCell));
    paintedCellsRef.current.clear();
    const bounds = getRangeBounds();
    if (!isMultiCellRange(bounds)) return;
    const list = visibleRowsRef.current;
    for (let rowIndex = bounds.top; rowIndex <= bounds.bottom; rowIndex += 1) {
      const rowEl = rowElement(list[rowIndex].id);
      if (!rowEl) continue;
      for (let column = bounds.left; column <= bounds.right; column += 1) {
        const cell = rowEl.cells[STAND_FIRST_FIELD_CELL + column];
        if (cell) { cell.classList.add(classes.rangeCell); paintedCellsRef.current.add(cell); }
      }
    }
  }, [getRangeBounds, isMultiCellRange, rowElement]);
  const schedulePaintRange = useCallback(() => {
    if (rangeRef.current && !paintFrameRef.current) paintFrameRef.current = requestAnimationFrame(paintRange);
  }, [paintRange]);
  const clearRange = useCallback(() => {
    if (!rangeRef.current && !paintedCellsRef.current.size) return;
    rangeRef.current = null;
    paintRange();
  }, [paintRange]);
  useEffect(() => { schedulePaintRange(); }, [visibleRows, schedulePaintRange]);
  useEffect(() => () => { if (paintFrameRef.current) cancelAnimationFrame(paintFrameRef.current); }, []);
  const setActiveCell = useCallback((id, field) => {
    const previous = activeCellRef.current;
    activeCellRef.current = { id, field };
    if (previous?.id !== id || previous?.field !== field) clearRange();
  }, [clearRange]);
  const rangeFields = (bounds, fallbackField) => (bounds ? GRID_FIELDS.slice(bounds.left, bounds.right + 1) : [fallbackField]);
  const busy = saving || loading || uploading;

  // 행 쓰기: 바뀐 칸이 있는 행만 바꾸고 금액을 다시 계산한다 (updateRow · pasteRange 와 같음)
  const writeRows = (targets, apply) => {
    const updates = new Map();
    targets.forEach((row) => {
      const next = { ...row };
      if (!apply(next)) return;
      Object.assign(next, calculateAmounts(next, masters.price));
      updates.set(row.id, next);
    });
    if (updates.size) setRows((current) => current.map((row) => updates.get(row.id) || row));
    return updates.size;
  };

  // Ctrl+D 아래로 채우기 (엑셀과 같음)
  //  - 셀 범위가 여러 행이면: 범위 맨 윗행 값을 범위 안 아래 행들에 (열마다)
  //  - 체크한 행이 있으면: 현재 칸 값을 그 아래 체크한 신규 행들에 (예전과 같음)
  //  - 그 밖에는: 바로 윗행 값을 현재 칸에
  const fillDown = () => {
    const active = activeCellRef.current;
    if (!active || busy) return;
    const list = visibleRowsRef.current;
    const activeIndex = list.findIndex((row) => row.id === active.id);
    if (activeIndex < 0) return;
    const bounds = getRangeBounds();
    let source;
    let targets;
    let mode;
    if (bounds && bounds.bottom > bounds.top) {
      mode = 'range';
      source = list[bounds.top];
      targets = list.slice(bounds.top + 1, bounds.bottom + 1);
    } else if (selectedIds.length) {
      mode = 'selected';
      source = list[activeIndex];
      const sourceIndex = rows.findIndex((row) => row.id === source.id);
      targets = rows.filter((row, index) => index > sourceIndex && selectedSet.has(row.id) && !row.lineno);
    } else {
      mode = 'above';
      source = list[activeIndex - 1];
      targets = [list[activeIndex]];
    }
    const fields = orderStandFields(rangeFields(mode === 'range' ? bounds : (bounds && isMultiCellRange(bounds) ? bounds : null), active.field).filter((field) => field !== 'unitamt'));
    if (!source || !targets.length || !fields.length) return;
    const changed = writeRows(targets, (next) => fields.reduce((any, field) => {
      if (!standFieldWritable(next, field)) return any;
      copyStandField(next, source, field);
      return true;
    }, false));
    if (mode !== 'above' && changed) notifications.show({ title: '아래로 채우기 완료', message: `${changed.toLocaleString()}개 행에 ${mode === 'range' ? '범위 맨 윗행' : '현재 칸'}의 값을 복사했습니다.`, color: 'teal' });
  };

  // 범위 지우기 (Delete · 잘라내기). 저장된 행은 단가만, 단가기준·수량단위(기본값 있는 목록)와 합계금액은 그대로 둔다.
  const clearRangeCells = () => {
    if (busy) return;
    const bounds = getRangeBounds();
    if (!bounds) return;
    const fields = rangeFields(bounds);
    writeRows(visibleRowsRef.current.slice(bounds.top, bounds.bottom + 1), (next) => fields.reduce((any, field) => {
      if (!standFieldWritable(next, field) || field === 'unit' || field === 'qtyunit') return any;
      clearStandField(next, field);
      return true;
    }, false));
  };

  const rangeCopyText = () => {
    const bounds = getRangeBounds();
    if (!bounds) return '';
    const fields = rangeFields(bounds);
    return visibleRowsRef.current.slice(bounds.top, bounds.bottom + 1)
      .map((row) => fields.map((field) => standCopyText(row, field, masters)).join('\t')).join('\n');
  };

  // 새 행 넣기 (추가 버튼과 같은 기본값) · 현재 행 복제 (복사 버튼과 같은 값 — 신규 행만)
  const newStandRow = () => makeRow({
    standdate: localDate(),
    qtyunit: resolveMasterCode('qtyunit', 'EA', masters) || 'EA',
    unit: resolveMasterCode('unit', 'KG', masters) || 'KG',
  });
  const placeRow = (row, position, field) => {
    setRows((current) => {
      const next = [...current];
      next.splice(Math.min(position, next.length), 0, row);
      return next;
    });
    if (!hasSavedStock) setPage(Math.floor(position / pageSize) + 1);
    pendingCellFocusRef.current = { key: `${row.id}:${field}` };
    const visibleIndex = hasSavedStock ? position : position % pageSize;
    requestAnimationFrame(() => virtuosoRef.current?.scrollToIndex({ index: visibleIndex, align: 'center', behavior: 'auto' }));
  };
  const insertRowBelow = (rowId, field, duplicate) => {
    if (busy) return;
    const index = rows.findIndex((row) => row.id === rowId);
    if (index < 0) return;
    const source = rows[index];
    if (duplicate && source.lineno) {
      notifications.show({ title: '행 복제', message: '저장된 기초재고 행은 복제할 수 없습니다. 신규 입력 행에서 Ctrl+Shift+Enter 를 눌러 주세요.', color: 'orange' });
      return;
    }
    const row = duplicate
      ? makeRow(Object.fromEntries(Object.entries(source)
        .filter(([key]) => !['id', 'lineno', 'isNew', 'has_movements', 'delete_block', 'created_at', 'updated_at', 'created_by', 'updated_by'].includes(key))))
      : newStandRow();
    placeRow(row, index + 1, field);
  };

  const focusFieldOf = (id, field) => {
    const input = cellInputRefs.current.get(`${id}:${field}`);
    if (input && !input.disabled) { input.focus(); input.select?.(); return true; }
    return false;
  };

  // 엑셀식 단축키 — 칸 자체 처리(자동완성 목록 등)보다 먼저 받는다
  const handleGridKeyDownCapture = (event) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229 || event.altKey) return;
    const ctrl = event.ctrlKey || event.metaKey;
    const { key } = event;
    if (ctrl && key.toLowerCase() === 'd') event.preventDefault();   // 표 안의 Ctrl+D 는 브라우저 즐겨찾기로 넘기지 않는다
    const active = activeCellRef.current;
    const list = visibleRowsRef.current;
    if (!active || STAND_FIELD_INDEX[active.field] === undefined || !list.some((row) => row.id === active.id)) return;
    const stop = () => { event.preventDefault(); event.stopPropagation(); };
    const arrow = key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight';

    if (event.shiftKey && !ctrl && arrow) {
      // 좌/우는 글자 안에서 커서가 움직일 수 있으면 글자 선택으로 둔다 (이미 범위가 있거나 글자 끝·전체 선택일 때만 범위 확장)
      const target = event.target;
      if ((key === 'ArrowLeft' || key === 'ArrowRight') && !isMultiCellRange() && target instanceof HTMLInputElement && !target.readOnly && target.selectionStart !== null) {
        const { selectionStart: start, selectionEnd: end, value } = target;
        const allSelected = start === 0 && end === value.length;
        if (!allSelected && (key === 'ArrowLeft' ? start !== 0 : end !== value.length)) return;
      }
      const column = STAND_FIELD_INDEX[active.field];
      const range = rangeRef.current || { anchorId: active.id, anchorColumn: column, focusId: active.id, focusColumn: column };
      const focusIndex = list.findIndex((row) => row.id === range.focusId);
      if (focusIndex < 0) return;
      const nextIndex = Math.max(0, Math.min(list.length - 1, focusIndex + (key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : 0)));
      const nextColumn = Math.max(0, Math.min(GRID_FIELDS.length - 1, range.focusColumn + (key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0)));
      stop();
      rangeRef.current = { ...range, focusId: list[nextIndex].id, focusColumn: nextColumn };
      paintRange();
      const cell = rowElement(list[nextIndex].id)?.cells[STAND_FIRST_FIELD_CELL + nextColumn];
      if (cell) cell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      else virtuosoRef.current?.scrollToIndex({ index: nextIndex, align: 'center', behavior: 'auto' });
      return;
    }
    if (ctrl && !event.shiftKey && (key === 'ArrowUp' || key === 'ArrowDown')) {
      // Ctrl+위/아래: 이 쪽의 첫 행 / 마지막 행으로
      stop();
      const targetRow = list[key === 'ArrowUp' ? 0 : list.length - 1];
      if (!focusFieldOf(targetRow.id, active.field)) focusGridCell(targetRow.id, active.field);
      return;
    }
    if (ctrl && key.toLowerCase() === 'd') { stop(); fillDown(); return; }
    if (ctrl && key === 'Enter') { stop(); insertRowBelow(active.id, active.field, event.shiftKey); return; }
    if (key === 'Delete' && !ctrl && isMultiCellRange()) { stop(); clearRangeCells(); return; }
    if (key === 'Escape' && rangeRef.current) clearRange();   // 칸의 Esc(입력 취소)도 그대로 동작
  };

  // 칸 클릭: 현재 칸으로 (저장된 행의 글자 칸 포함). Shift+클릭: 현재 칸부터 클릭한 칸까지 범위 (포커스는 그대로)
  const handleGridMouseDownCapture = (event) => {
    const cell = event.target instanceof Element ? event.target.closest('td') : null;
    const rowEl = cell?.parentElement;
    const id = rowEl?.dataset?.rowId;
    const column = cell ? cell.cellIndex - STAND_FIRST_FIELD_CELL : -1;
    if (!id || column < 0 || column >= GRID_FIELDS.length || !gridWrapRef.current?.contains(cell)) {
      if (!event.shiftKey) clearRange();
      return;
    }
    const active = activeCellRef.current;
    if (event.shiftKey && active && STAND_FIELD_INDEX[active.field] !== undefined && visibleRowsRef.current.some((row) => row.id === active.id)) {
      event.preventDefault();
      rangeRef.current = {
        anchorId: rangeRef.current?.anchorId || active.id,
        anchorColumn: rangeRef.current?.anchorColumn ?? STAND_FIELD_INDEX[active.field],
        focusId: id, focusColumn: column,
      };
      paintRange();
      return;
    }
    setActiveCell(id, GRID_FIELDS[column]);
  };

  // 범위 복사·잘라내기: 엑셀에 그대로 붙일 수 있는 탭 구분 글자
  const handleGridCopyCapture = (event) => {
    if (!isMultiCellRange()) return;
    event.preventDefault();
    event.clipboardData.setData('text/plain', rangeCopyText());
  };
  const handleGridCutCapture = (event) => {
    if (!isMultiCellRange()) return;
    event.preventDefault();
    event.clipboardData.setData('text/plain', rangeCopyText());
    clearRangeCells();
  };
  // 범위를 고른 채 붙여넣기: 엑셀 범위는 범위 왼쪽 위부터, 값 하나는 범위 전체에 채운다 (pasteRange 규칙 그대로)
  const handleGridPasteCapture = (event) => {
    if (busy || !isMultiCellRange()) return;
    const bounds = getRangeBounds();
    const text = event.clipboardData.getData('text/plain');
    event.preventDefault();
    event.stopPropagation();
    const startId = visibleRowsRef.current[bounds.top].id;
    const startField = GRID_FIELDS[bounds.left];
    if (isMultiCellText(text)) { void latestRowActionsRef.current.pasteRange(startId, startField, text); return; }
    const value = text.replace(/\r?\n$/, '');
    if (!value.trim()) { clearRangeCells(); return; }
    const line = Array(bounds.right - bounds.left + 1).fill(value).join('\t');
    void latestRowActionsRef.current.pasteRange(startId, startField, Array(bounds.bottom - bounds.top + 1).fill(line).join('\n'));
  };
  // 빈 표에 엑셀 범위 붙여넣기 (기초일자 칸부터 — 샘플 양식과 같은 칸 순서)
  const handleEmptyGridPaste = (event) => {
    if (busy || rows.length) return;
    const text = event.clipboardData.getData('text/plain');
    if (!text.trim()) return;
    event.preventDefault();
    void latestRowActionsRef.current.pasteRange(null, GRID_FIELDS[0], text);
  };

  const handleTableKeyDown = (event) => {
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
    if (moveGridCell(active.id, active.field, rowDelta, columnDelta)) { event.preventDefault(); return; }
    // 마지막 행에서 Enter: 새 행을 이어 붙이고 같은 칸으로 (엑셀처럼 계속 입력)
    if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && !event.nativeEvent.isComposing && !busy
      && visibleRows.at(-1)?.id === active.id && (hasSavedStock || rows.at(-1)?.id === active.id)) {
      event.preventDefault();
      placeRow(newStandRow(), rows.findIndex((row) => row.id === active.id) + 1, active.field);
    }
  };

  const chooseMaster = useCallback((option) => {
    if (!masterPickerTarget) return;
    updateRow(masterPickerTarget.id, masterPickerTarget.field, option.code);
    setMasterPickerTarget(null);
  }, [masterPickerTarget, updateRow]);

  const downloadTemplate = useCallback(async () => {
    const headers = STOCK_EXCEL_COLUMNS.map(([, label]) => label);
    const XLSX = await loadXLSXOrNotify();
    if (!XLSX) return;
    const worksheet = XLSX.utils.aoa_to_sheet([headers, Array(headers.length).fill('')]);
    applyExcelHeaderStyle(worksheet, headers.length);
    worksheet['!cols'] = STOCK_EXCEL_COLUMNS.map(([key]) => ({ wch: ['itemname', 'customname', 'warehousecodename', 'materialname', 'surfacename', 'description'].includes(key) ? 24 : 16 }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '기초재고');
    XLSX.writeFile(workbook, `기초재고_일괄등록_샘플.xlsx`);
  }, []);

  const exportRows = useCallback(async () => {
    try {
      let rowsForExport = rows;
      if (hasSavedStock && rows.length < totalRows) {
        rowsForExport = [];
        let cursor = 0;
        let hasMore = true;
        while (hasMore) {
          const { data } = await axios.get('/api/stock-stand/items', {
            ...authConfig(),
            params: { standdate, q: query || undefined, cursor, limit: 1000, include_metadata: false },
          });
          const pageRows = (data.items || []).map((item) => makeRow(item));
          rowsForExport.push(...pageRows);
          cursor = Number(data.next_cursor) || cursor;
          hasMore = Boolean(data.has_more);
          if (!pageRows.length) break;
        }
        const currentRowsById = new Map(rows.map((row) => [row.id, row]));
        rowsForExport = rowsForExport.map((row) => currentRowsById.get(row.id) || row);
      }
      const headers = STOCK_EXPORT_COLUMNS.map(([, label]) => label);
      const XLSX = await loadXLSXOrNotify();
      if (!XLSX) return;
      const worksheet = XLSX.utils.aoa_to_sheet([
        headers,
        ...rowsForExport.map((row) => STOCK_EXPORT_COLUMNS.map(([key]) => {
          const value = row[key];
          if (key === 'standdate') return row.standdate || standdate;
          if (key === 'created_at' || key === 'updated_at') return formatTimestamp(value);
          return ['myrtle', 'thickness', 'width', 'length', 'qty', 'weight', 'unitprice', 'supplyamt', 'vat', 'unitamt'].includes(key) && value !== '' && value != null
            ? Number(cleanNumber(value)) : value ?? '';
        })),
      ]);
      applyExcelHeaderStyle(worksheet, headers.length);
      worksheet['!cols'] = STOCK_EXPORT_COLUMNS.map(([key]) => ({ wch: ['itemname', 'materialname', 'surfacename', 'description'].includes(key) ? 24 : ['created_at', 'updated_at'].includes(key) ? 19 : 16 }));
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, '기초재고');
      XLSX.writeFile(workbook, `기초재고등록_${standdate.replaceAll('-', '')}.xlsx`);
      notifications.show({ title: '엑셀 다운로드 완료', message: `${rowsForExport.length.toLocaleString()}건을 저장했습니다.`, color: 'teal' });
    } catch (error) {
      notifications.show({ title: '엑셀 다운로드 실패', message: errorText(error), color: 'red' });
    }
  }, [rows, standdate, query, hasSavedStock, totalRows]);

  const uploadExcel = useCallback(async (event) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    if (hasChanges) {
      notifications.show({ title: '저장되지 않은 변경 사항', message: '현재 입력한 내용을 먼저 저장한 뒤 엑셀을 등록해 주세요.', color: 'orange' });
      return;
    }
    setUploading(true);
    try {
      const XLSX = await loadXLSXOrNotify();
      if (!XLSX) return;
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!sheet) throw new Error('엑셀 첫 번째 시트를 확인해 주세요.');
      const sourceRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      if (sourceRows.length > 10000) throw new Error('한 번에 최대 10,000행까지 등록할 수 있습니다.');
      const normalize = (value) => String(value ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '');
      const aliases = {
        standdate: ['standdate', '기초일자', '기준일자'],
        itemcode: ['itemcode', '품목코드'], itemname: ['itemname', '품명', '품목명'],
        customcode: ['customcode', '거래처코드'], customname: ['customname', '거래처', '거래처명'],
        productname: ['productname', '제품번호'],
        materialcode: ['materialcode', '강종코드'], materialname: ['materialname', '강종'],
        surfacecode: ['surfacecode', '표면코드'], surfacename: ['surfacename', '표면'],
        myrtle: ['myrtle', '도금량(g/m²)', '도금량'], thickness: ['thickness', '두께'], width: ['width', '폭'], length: ['length', '길이'],
        qty: ['qty', '기초수량', '수량'], qtyunit: ['qtyunit', '수량단위코드', '수량단위'],
        weight: ['weight', '기초중량', '중량'], warehousecode: ['warehousecode', '창고코드'],
        warehousecodename: ['warehousecodename', '창고', '창고명'], unit: ['unit', '단가기준'],
        unitprice: ['unitprice', '기초단가'], supplyamt: ['supplyamt', '공급가'],
        vat: ['vat', '부가세', '세액'], unitamt: ['unitamt', '합계금액', '기초금액'],
        description: ['description', '비고'],
      };
      const getValue = (source, key) => {
        const cells = Object.fromEntries(Object.entries(source).map(([name, value]) => [normalize(name), value]));
        const header = aliases[key].map(normalize).find((name) => cells[name] !== undefined);
        return header === undefined ? '' : String(cells[header] ?? '').trim();
      };
      const parseExcelDate = (value) => {
        const text = String(value ?? '').trim();
        if (!text) return '';
        if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
        if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(text)) return text.replaceAll('/', '-').replace(/-(\d)(?=-|$)/g, '-0$1');
        const serial = Number(text);
        if (Number.isFinite(serial)) {
          const date = XLSX.SSF.parse_date_code(serial);
          if (date) return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
        }
        return text;
      };
      const parseNumber = (value) => value === '' ? '' : Number(String(value).replace(/,/g, '').trim());
      const resolveMaster = (value, options) => {
        const normalized = normalize(value);
        return options.find((option) => normalize(option.code) === normalized || normalize(option.name) === normalized)?.code || '';
      };
      const parsedRows = sourceRows.map((source, index) => ({
        excelRow: index + 2,
        standdate: parseExcelDate(getValue(source, 'standdate')) || localDate(),
        itemcode: getValue(source, 'itemcode'), itemname: getValue(source, 'itemname'),
        customcode: getValue(source, 'customcode'), customname: getValue(source, 'customname'),
        productname: getValue(source, 'productname'),
        materialcode: resolveMaster(getValue(source, 'materialcode') || getValue(source, 'materialname'), masters.material),
        surfacecode: resolveMaster(getValue(source, 'surfacecode') || getValue(source, 'surfacename'), masters.surface),
        myrtle: parseNumber(getValue(source, 'myrtle')),
        thickness: parseNumber(getValue(source, 'thickness')), width: parseNumber(getValue(source, 'width')), length: parseNumber(getValue(source, 'length')),
        qty: parseNumber(getValue(source, 'qty')),
        qtyunit: resolveMaster(getValue(source, 'qtyunit'), masters.quantity),
        weight: parseNumber(getValue(source, 'weight')),
        warehousecode: resolveMaster(getValue(source, 'warehousecode') || getValue(source, 'warehousecodename'), masters.warehouse),
        unit: getValue(source, 'unit') ? resolveMaster(getValue(source, 'unit'), masters.price) : '',
        unitprice: parseNumber(getValue(source, 'unitprice')), supplyamt: parseNumber(getValue(source, 'supplyamt')),
        vat: parseNumber(getValue(source, 'vat')), unitamt: parseNumber(getValue(source, 'unitamt')),
        supplyamt_manual: getValue(source, 'supplyamt') !== '', vat_manual: getValue(source, 'vat') !== '',
        description: getValue(source, 'description'),
      })).filter((row) => Object.entries(row).some(([key, value]) => key !== 'excelRow' && key !== 'standdate' && value !== '' && value != null));
      if (!parsedRows.length) throw new Error('업로드할 데이터가 없습니다. 첫 번째 시트의 열 이름을 확인해 주세요.');

      const itemcodes = [...new Set(parsedRows.map((row) => row.itemcode).filter(Boolean))];
      const itemnames = [...new Set(parsedRows.filter((row) => !row.itemcode).map((row) => row.itemname).filter(Boolean))];
      const customernames = [...new Set(parsedRows.flatMap((row) => [row.customcode, row.customname]).filter(Boolean))];
      let activeItems = {};
      let activeItemNames = {};
      let activeCustomers = {};
      if (itemcodes.length || itemnames.length || customernames.length) {
        const { data } = await axios.post('/api/stock-stand/items/resolve', { itemcodes, itemnames, customernames }, authConfig());
        activeItems = data.items || {};
        activeItemNames = data.names || {};
        activeCustomers = data.customers || {};
      }
      parsedRows.forEach((row) => {
        if (row.customcode) {
          const matches = activeCustomers[row.customcode.toLocaleLowerCase()] || [];
          if (matches.length === 1) {
            if (row.customname && row.customname.toLocaleLowerCase() !== matches[0].customername.toLocaleLowerCase()) {
              row.customerResolveError = '거래처코드와 거래처명이 일치하지 않습니다';
            } else {
              row.customcode = matches[0].customercode;
              row.customname = matches[0].customername;
            }
          } else {
            row.customerResolveError = '활성 거래처 마스터에서 거래처코드를 찾을 수 없습니다';
          }
        } else if (row.customname) {
          const matches = activeCustomers[row.customname.toLocaleLowerCase()] || [];
          if (matches.length === 1) {
            row.customcode = matches[0].customercode;
            row.customname = matches[0].customername;
          } else if (matches.length > 1) {
            row.customerResolveError = '거래처명이 중복되어 거래처코드가 필요합니다';
          } else {
            row.customerResolveError = `활성 거래처 마스터에서 거래처명을 찾을 수 없습니다: ${row.customname}`;
          }
        }
        if (row.itemcode) {
          const match = activeItems[row.itemcode.toLocaleLowerCase()];
          row.itemcode = match?.itemcode || row.itemcode;
          row.itemname = match?.itemname || '';
        } else if (row.itemname) {
          const matches = activeItemNames[row.itemname.toLocaleLowerCase()] || [];
          if (matches.length === 1) {
            row.itemcode = matches[0].itemcode;
            row.itemname = matches[0].itemname;
          } else if (matches.length > 1) {
            row.itemResolveError = '품명이 중복되어 품목코드가 필요합니다';
          } else {
            row.itemResolveError = '활성 품목 마스터에서 품명을 찾을 수 없습니다';
          }
        }
        row.materialname = masters.material.find((option) => option.code === row.materialcode)?.name || '';
        row.surfacename = masters.surface.find((option) => option.code === row.surfacecode)?.name || '';
      });

      const errors = [];
      parsedRows.forEach((row) => {
        const rowErrors = [];
        if (row.itemResolveError) rowErrors.push(row.itemResolveError);
        if (row.customerResolveError) rowErrors.push(row.customerResolveError);
        if (!isValidDateInput(row.standdate)) rowErrors.push('기초일자 YYYY-MM-DD');
        if (!row.itemcode) rowErrors.push('품목코드 필수');
        else if (!row.itemname) rowErrors.push('품목코드가 미등록이거나 사용중지 상태입니다');
        if (!row.materialcode || !row.materialname) rowErrors.push('강종 확인 필요');
        if ((getValue(sourceRows[row.excelRow - 2], 'surfacecode') || getValue(sourceRows[row.excelRow - 2], 'surfacename')) && !row.surfacecode) rowErrors.push('표면 확인 필요');
        if (!row.qtyunit) rowErrors.push('수량단위 확인 필요');
        if (row.qty === '' || !Number.isFinite(row.qty) || row.qty <= 0) rowErrors.push('기초수량은 양수');
        if (!Number.isFinite(row.weight) || row.weight <= 0) rowErrors.push('기초중량은 양수');
        if (!row.warehousecode) rowErrors.push('창고코드/창고명 확인 필요');
        if (!row.unit) rowErrors.push('단가기준 확인 필요');
        for (const key of ['myrtle', 'thickness', 'width', 'length']) {
          if (row[key] !== '' && (!Number.isFinite(row[key]) || row[key] < 0)) rowErrors.push('??/???? 0 ?? ??');
        }
        for (const key of ['unitprice', 'supplyamt', 'vat']) {
          if (row[key] !== '' && (!Number.isFinite(row[key]) || row[key] < 0)) rowErrors.push('????/???/???? 0 ?? ??');
        }
        if (rowErrors.length) errors.push(`${row.excelRow}행: ${rowErrors.join(', ')}`);
      });
      if (errors.length) {
        notifications.show({ title: '엑셀 등록 중단', message: `${errors.length}개 행을 확인해 주세요. ${errors.slice(0, 5).join(' / ')}`, color: 'red', autoClose: 9000 });
        return;
      }

      setRows((current) => [...current, ...parsedRows.map(({ excelRow, ...row }) => makeRow({
        ...row,
        ...calculateAmounts(row, masters.price),
        warehousecodename: masters.warehouse.find((option) => option.code === row.warehousecode)?.name || '',
      }))]);
      notifications.show({ title: '엑셀 업로드 완료', message: `${parsedRows.length.toLocaleString()}건을 입력 목록에 추가했습니다. 저장 버튼을 눌러 반영해 주세요.`, color: 'teal', autoClose: 7000 });
    } catch (error) {
      notifications.show({ title: '엑셀 업로드 실패', message: errorText(error), color: 'red' });
    } finally { setUploading(false); }
  }, [hasChanges, masters]);

  const save = async () => {
    let newRows = rows.filter((row) => !row.lineno && hasRowInput(row));
    if (!newRows.length && !changedPriceRows.length) {
      notifications.show({ title: '저장할 변경사항 없음', message: '새 기초재고를 입력하거나 단가 정보를 변경해 주세요.', color: 'blue' });
      return;
    }
    const pendingItemRows = newRows.filter((row) => !row.itemcode.trim() && row.itemname.trim());
    if (pendingItemRows.length) {
      setSaving(true);
      try {
        const values = [...new Set(pendingItemRows.map((row) => row.itemname.trim()))];
        const { data } = await axios.post('/api/stock-stand/items/resolve', {
          itemcodes: values,
          itemnames: values,
        }, authConfig());
        const unresolved = [];
        const resolvedById = new Map();
        pendingItemRows.forEach((row) => {
          const value = row.itemname.trim();
          const byCode = data.items?.[value.toLocaleLowerCase()];
          const byName = data.names?.[value.toLocaleLowerCase()] || [];
          const match = byCode || (byName.length === 1 ? byName[0] : null);
          if (match) resolvedById.set(row.id, match);
          else unresolved.push(`${rows.indexOf(row) + 1}행 ${byName.length > 1 ? '품명이 중복되어 품목코드가 필요합니다' : '활성 품목 마스터에서 품명을 찾을 수 없습니다'}`);
        });
        if (unresolved.length) {
          notifications.show({ title: '품목 정보 확인', message: unresolved.slice(0, 5).join(' / '), color: 'orange', autoClose: 9000 });
          return;
        }
        newRows = newRows.map((row) => {
          const match = resolvedById.get(row.id);
          return match ? { ...row, itemcode: match.itemcode, itemname: match.itemname } : row;
        });
        setRows((current) => current.map((row) => {
          const match = resolvedById.get(row.id);
          return match ? { ...row, itemcode: match.itemcode, itemname: match.itemname } : row;
        }));
      } catch (error) {
        notifications.show({
          title: error.response?.status === 409 ? '입력값 확인 필요' : '기초재고 저장 실패',
          message: errorText(error),
          color: error.response?.status === 409 ? 'orange' : 'red',
        });
        return;
      } finally {
        setSaving(false);
      }
    }
    const invalid = [];
    newRows.forEach((row) => {
      const rowNo = rows.indexOf(row) + 1;
      if (!isValidDateInput(row.standdate)) invalid.push(`${rowNo}행 기초일자`);
      if (!row.itemcode.trim() || !row.itemname.trim()) invalid.push(`${rowNo}행 품목`);
      if (!row.materialcode || !row.materialname) invalid.push(`${rowNo}행 강종`);
      if (!row.qtyunit) invalid.push(`${rowNo}행 수량단위`);
      if (!row.qty || !Number.isFinite(Number(row.qty)) || Number(row.qty) <= 0) invalid.push(`${rowNo}행 기초수량`);
      if (!row.weight || !Number.isFinite(Number(row.weight)) || Number(row.weight) <= 0) invalid.push(`${rowNo}행 기초중량`);
      if (!row.warehousecode) invalid.push(`${rowNo}행 창고`);
      for (const key of ['myrtle', 'thickness', 'width', 'length']) {
        if (row[key] !== '' && (!Number.isFinite(Number(row[key])) || Number(row[key]) < 0)) invalid.push(`${rowNo}행 규격/도금량`);
      }
      for (const key of ['supplyamt', 'vat']) {
        if (row[`${key}_manual`] && row[key] !== '' && (!Number.isFinite(Number(row[key])) || Number(row[key]) < 0)) {
          invalid.push(`${rowNo}행 ${key === 'supplyamt' ? '공급가' : '부가세'}`);
        }
      }
    });
    [...newRows, ...changedPriceRows].forEach((row) => {
      if (!row.unit) invalid.push(`${rows.indexOf(row) + 1}행 단가기준`);
      for (const key of ['unitprice']) {
        if (row[key] !== '' && (!Number.isFinite(Number(row[key])) || Number(row[key]) < 0)) invalid.push(`${rows.indexOf(row) + 1}행 기초단가`);
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
            standdate: row.standdate,
            itemcode: row.itemcode.trim(), itemname: row.itemname.trim(), productname: row.productname.trim(),
            customcode: row.customcode.trim(), customname: row.customname.trim(),
            materialcode: row.materialcode, materialname: row.materialname,
            surfacecode: row.surfacecode, surfacename: row.surfacename,
            myrtle: row.myrtle === '' ? null : cleanNumber(row.myrtle),
            thickness: row.thickness === '' ? null : cleanNumber(row.thickness),
            width: row.width === '' ? null : cleanNumber(row.width),
            length: row.length === '' ? null : cleanNumber(row.length),
            qty: cleanNumber(row.qty), qtyunit: row.qtyunit,
            weight: cleanNumber(row.weight), warehousecode: row.warehousecode,
            warehousecodename: row.warehousecodename, unit: row.unit,
            unitprice: row.unitprice === '' ? null : cleanNumber(row.unitprice),
            supplyamt: row.supplyamt_manual && row.supplyamt !== '' ? cleanNumber(row.supplyamt) : null,
            vat: row.vat_manual && row.vat !== '' ? cleanNumber(row.vat) : null,
            supplyamt_manual: Boolean(row.supplyamt_manual), vat_manual: Boolean(row.vat_manual),
            ...Object.fromEntries(Object.entries(calculateAmounts(row, masters.price)).map(([key, value]) => [key, value || null])),
            description: row.description.trim(),
          })),
        }, authConfig());
      }
      if (changedPriceRows.length) {
        await axios.put('/api/stock-stand/items/prices', {
          items: changedPriceRows.map((row) => ({
            lineno: row.lineno,
            unit: row.unit || '',
            unitprice: row.unitprice === '' ? null : cleanNumber(row.unitprice),
            ...Object.fromEntries(Object.entries(calculateAmounts(row, masters.price)).map(([key, value]) => [key, value || null])),
          })),
        }, authConfig());
      }
      const resultParts = [];
      if (newRows.length) resultParts.push(`${newRows.length}건 등록`);
      if (changedPriceRows.length) resultParts.push(`${changedPriceRows.length}건 단가정보 수정`);
      notifications.show({ title: '기초재고 저장 완료', message: `${resultParts.join(', ')}했습니다. 저장된 행은 단가기준·기초단가를 수정할 수 있고, 기초금액은 자동 계산됩니다.`, color: 'teal' });
      if (newRows.length) {
        const savedDates = newRows.map((row) => row.standdate || standdate).filter(Boolean).sort();
        const savedDateFrom = savedDates[0] || dateFrom;
        const savedDateTo = savedDates[savedDates.length - 1] || dateTo;
        setDateFrom(savedDateFrom);
        setDateTo(savedDateTo);
        setPage(1);
        await loadRows(standdate, query, false, false, 1, pageSize, savedDateFrom, savedDateTo, warehouseQuery);
      } else {
        await loadRows(standdate, query, false);
      }
    } catch (error) {
        notifications.show({
          title: error.response?.status === 409 ? '입력값 확인 필요' : '기초재고 저장 실패',
          message: errorText(error),
          color: error.response?.status === 409 ? 'orange' : 'red',
        });
    } finally { setSaving(false); }
  };

  const requestDeleteAll = () => {
    if (!hasSavedStock || saving) return;
    if (hasTransactions || hasStockMovements) {
      notifications.show({
        title: '기초재고를 삭제할 수 없습니다',
        message: '입고 또는 출고 수불 내역이 있어 등록된 기초재고 전체를 삭제할 수 없습니다.',
        color: 'orange',
      });
      return;
    }
    setDeleteAllOpen(true);
  };

  const deleteAll = async () => {
    if (!hasSavedStock || saving || hasTransactions || hasStockMovements) return;
    listRequestIdRef.current += 1;
    loadingMoreRef.current = false;
    setLoadingMoreRows(false);
    setSaving(true);
    try {
      const { data } = await axios.delete('/api/stock-stand/items', { ...authConfig(), data: { delete_all: true } });
      setDeleteAllOpen(false);
      setRows([]);
      setTotalRows(0);
      setPage(1);
      hasMoreRowsRef.current = false;
      nextCursorRef.current = 0;
      setSelectedIds([]);
      setHasSavedStock(false);
      setHasTransactions(false);
      setHasStockMovements(false);
      notifications.show({ title: '기초재고 전체 삭제 완료', message: `${Number(data.deleted_count || 0).toLocaleString()}건을 삭제했습니다.`, color: 'teal' });
    } catch (error) {
      setDeleteBlocked(errorText(error));   // 월마감 · 이후 거래 등: 같은 창에서 사유
    } finally { setSaving(false); }
  };

  const deleteSelectedRows = () => {
    if (!selectedIds.length || saving) return;
    const ids = new Set(selectedIds);
    const deletedCount = rows.filter((row) => ids.has(row.id) && !row.lineno).length;
    setRows((current) => current.filter((row) => !ids.has(row.id) || row.lineno));
    setSelectedIds([]);
    selectionAnchorRef.current = '';
    notifications.show({ title: '선택 삭제 완료', message: `${deletedCount}개 입력 행을 삭제했습니다.`, color: 'teal' });
  };

  const toggleAll = (checked) => {
    setSelectedIds(checked ? rows.filter((row) => !row.lineno).map((row) => row.id) : []);
    selectionAnchorRef.current = '';
  };
  const latestRowActionsRef = useRef(null);
  useLayoutEffect(() => {
    latestRowActionsRef.current = { updateRow, pasteRange, selectItem, selectCustomerForRow, resolveCustomerName, toggleRowSelection };
  });
  const rowHandlers = useMemo(() => ({
    registerCellInput,
    setActiveCell,
    updateRow: (...args) => latestRowActionsRef.current.updateRow(...args),
    pasteRange: (...args) => latestRowActionsRef.current.pasteRange(...args),
    selectItem: (...args) => latestRowActionsRef.current.selectItem(...args),
    selectCustomerForRow: (...args) => latestRowActionsRef.current.selectCustomerForRow(...args),
    resolveCustomerName: (...args) => latestRowActionsRef.current.resolveCustomerName(...args),
    toggleRowSelection: (...args) => latestRowActionsRef.current.toggleRowSelection(...args),
    openItemPicker: setItemPickerId,
    openCustomerPicker: setCustomerPickerId,
    openMasterPicker: (id, field) => setMasterPickerTarget({ id, field }),
  }), [registerCellInput, setActiveCell]);
  const autoColumnWidths = useMemo(() => Object.fromEntries(STOCK_GRID_COLUMNS.map(([key, label]) => {
    const minWidth = key === 'select' ? 42 : key === 'number' ? 48 : 70;
    const width = fitColumnWidth(label, rows.map((row) => row[key]), GRID_COLUMN_WIDTHS[key], minWidth);
    return [key, width];
  })), [rows]);
  const headerColumns = STOCK_GRID_COLUMNS.map(([key, label]) => {
    const minWidth = key === 'select' ? 42 : key === 'number' ? 48 : 70;
    const width = autoColumnWidths[key];
    return {
      key,
      label: key === 'select'
        ? <input type="checkbox" aria-label="전체 선택" disabled={!rows.some((row) => !row.lineno)} checked={rows.some((row) => !row.lineno) && rows.filter((row) => !row.lineno).every((row) => selectedSet.has(row.id))} onChange={(event) => toggleAll(event.currentTarget.checked)} />
        : label,
      width,
      minWidth,
      className: key === 'select' ? codeClasses.checkCol : key === 'number' ? codeClasses.numberCol : '',
    };
  });
  const tableWidth = headerColumns.reduce((sum, column) => sum + (columnWidths[column.key] ?? column.width), 0);
  const renderHeader = (column) => (
    <Table.Th key={column.key} className={[codeClasses.resizableHeader, column.className].filter(Boolean).join(' ')} style={{ width: columnWidths[column.key] ?? column.width }}>
      {column.label}<span className={codeClasses.columnResizeHandle} onPointerDown={(event) => resizeColumn(event, column.key, column.width, column.minWidth, tableWidth)} role="separator" aria-label={`${column.key} 열 너비 조절`} />
    </Table.Th>
  );
  const itemContent = (index, row) => <StockGridRowCells
    row={row}
    rowNumber={(page - 1) * pageSize + index + 1}
    isSelected={selectedSet.has(row.id)}
    saving={saving}
    masters={masters}
    handlers={rowHandlers}
  />;

  const deleteSelectedLines = async () => {
    const savedRows = rows.filter((row) => row.lineno && selectedSet.has(row.id));
    if (!savedRows.length || saving) return;
    const removedIds = new Set(rows.filter((row) => selectedSet.has(row.id)).map((row) => row.id));
    setSaving(true);
    try {
      const { data } = await axios.delete('/api/stock-stand/items', { ...authConfig(), data: { linenos: savedRows.map((row) => row.lineno) } });
      setDeleteLinesOpen(false);
      setSelectedIds([]);
      selectionAnchorRef.current = '';
      savedRows.forEach((row) => originalRowsRef.current.delete(row.id));
      const keepsUnsavedInput = rows.some((row) => !row.lineno && !removedIds.has(row.id) && hasRowInput(row));
      if (keepsUnsavedInput) {
        // Keep the user's other unsaved input rows: drop the deleted rows locally instead of reloading.
        setRows((current) => current.filter((row) => !removedIds.has(row.id)));
        setTotalRows((current) => Math.max(0, current - savedRows.length));
      } else {
        const remaining = Math.max(0, totalRows - savedRows.length);
        const targetPage = Math.min(page, Math.max(1, Math.ceil(remaining / pageSize)));
        if (await loadRows(standdate, query, false, false, targetPage, pageSize, dateFrom, dateTo, warehouseQuery)) setPage(targetPage);
      }
      notifications.show({ title: '기초재고 삭제 완료', message: `${Number(data.deleted_count || savedRows.length).toLocaleString()}건을 삭제했습니다. 현재고·재고수불 내역도 함께 삭제했습니다.`, color: 'teal' });
    } catch (error) {
      setDeleteBlocked(errorText(error));   // 같은 창에서 사유
    } finally { setSaving(false); }
  };

  const deleteFromRibbon = () => {
    if (loading || saving || uploading) return;
    if (selectedSavedCount) {
      setDeleteLinesOpen(true);
    } else if (selectedIds.some((id) => rows.some((row) => row.id === id && !row.lineno))) {
      deleteSelectedRows();
    } else if (hasSavedStock) {
      requestDeleteAll();
    } else {
      notifications.show({ title: '삭제할 행 선택', message: '삭제할 신규 행을 선택해 주세요.', color: 'orange' });
    }
  };

  useErpPageRibbon({
    onSearch: runSearch,
    onAdd: addRow,
    onCopy: selectedIds.length === 1 ? copySelectedRow : undefined,
    onSave: save,
    onDelete: deleteFromRibbon,
    onExcel: exportRows,
    useSaveColor: false,
  });

  return <Box className={`${simpleTheme.simple} ${sharedClasses.pageShell} ${classes.page}`}>
    <ErpBreadcrumb parent="재고" current="기초재고 등록" filterOpen={filterOpen} onOpenFilters={() => setFilterOpen(true)} />

    <Box className={`${classes.workspace} ${filterOpen ? classes.workspaceWithFilter : ''}`}>
    <Paper className={`${sharedClasses.panel} ${codeClasses.codePanel} ${classes.editorPanel}`} withBorder>
      <Group className={`${sharedClasses.panelHeader} ${codeClasses.codeHeader} ${classes.codeHeader}`} justify="space-between" align="flex-start" wrap="wrap" gap="sm">
        <Group gap={8} align="center"><Text className={classes.sectionTitle} fw={700}>기초재고등록</Text><Badge color="gray" variant="light">{displayRowCount.toLocaleString()}행</Badge>
          {/* Shown inline in the header (not as a separate bar) so checking rows never pushes the grid down. */}
          {selectedNewCount > 1 && <Text size="xs" c="red" fw={600}>마스터 값 변경 시 {selectedNewCount}개 행에 일괄 적용됩니다.</Text>}
        </Group>
        <Group className={classes.headerActions} gap={7} align="center" wrap="wrap">
          <ExcelBulkActions
            onDownloadTemplate={downloadTemplate}
            templateDisabled={loading || uploading}
            templateTitle="기초재고 일괄등록 샘플 양식을 내려받습니다"
            inputRef={uploadInputRef}
            onUpload={uploadExcel}
            uploading={uploading}
            uploadDisabled={saving || loading}
            uploadTitle="샘플 양식으로 작성한 엑셀 파일로 기초재고를 한 번에 등록합니다"
            accept=".xlsx,.xls"
          />
        </Group>
      </Group>
      <Box className={`${codeClasses.tableWrap} ${classes.tableViewport} ${hasSavedStock ? classes.savedTableViewport : ''}`} style={{ '--code-table-min-width': `${Math.max(1730, tableWidth)}px`, outline: 'none' }} onKeyDown={handleTableKeyDown}
        ref={gridWrapRef} tabIndex={-1} onKeyDownCapture={handleGridKeyDownCapture} onMouseDownCapture={handleGridMouseDownCapture}
        onCopyCapture={handleGridCopyCapture} onCutCapture={handleGridCutCapture} onPasteCapture={handleGridPasteCapture}>
        {loading ? <Box className={classes.loading}><Loader color="red" /></Box> : visibleRows.length ? (hasSavedStock ? (
          <Table className={`${sharedClasses.table} ${codeClasses.codeTable} ${classes.table}`} highlightOnHover withTableBorder withColumnBorders verticalSpacing="xs" horizontalSpacing={0}
            style={{ width: '100%', minWidth: 'var(--code-table-min-width)', tableLayout: 'fixed' }}>
            <Table.Thead><Table.Tr>{headerColumns.map(renderHeader)}</Table.Tr></Table.Thead>
            <Table.Tbody>{visibleRows.map((row, index) => <Table.Tr key={row.id} data-row-id={row.id} className={row.lineno ? undefined : `${codeClasses.newRow} ${classes.newRow}`}>{itemContent(index, row)}</Table.Tr>)}</Table.Tbody>
          </Table>
        ) : (
          <TableVirtuoso
            ref={virtuosoRef}
            data={visibleRows}
            style={{ height: '100%' }}
            components={stockVirtuosoComponents}
            computeItemKey={(_index, row) => row.id}
            defaultItemHeight={34}
            increaseViewportBy={{ top: 160, bottom: 240 }}
            fixedHeaderContent={() => <Table.Tr>{headerColumns.map(renderHeader)}</Table.Tr>}
            itemContent={itemContent}
            rangeChanged={schedulePaintRange}
          />
        )) : (
          <Box className={classes.emptyTableState}>
            <Table className={`${sharedClasses.table} ${codeClasses.codeTable}`} highlightOnHover withTableBorder withColumnBorders
              style={{ width: '100%', minWidth: 'var(--code-table-min-width)', tableLayout: 'fixed' }}>
              <Table.Thead><Table.Tr>{headerColumns.map(renderHeader)}</Table.Tr></Table.Thead>
            </Table>
            {busy ? <Box className={classes.emptyTableMessage}>{'표시할 기초재고가 없습니다.'}</Box> : (
              <Box className={`${classes.emptyTableMessage} ${classes.emptyPasteTarget}`} tabIndex={0} role="textbox" aria-label="기초재고 붙여넣기" onPaste={handleEmptyGridPaste}>
                {'표시할 기초재고가 없습니다. 추가를 누르거나, 여기를 클릭하고 엑셀 범위를 붙여넣으세요 (Ctrl+V · 기초일자 칸부터).'}
              </Box>
            )}
          </Box>
        )}
      </Box>
      <Group className={`${sharedClasses.footer} ${codeClasses.tableFooter} ${classes.stockFooter}`} justify="space-between" wrap="wrap">
        <Group className={classes.paginationBar} gap="md" justify="flex-end" wrap="wrap">
          <Text size="xs" c="dimmed">총 {displayRowCount.toLocaleString()}건</Text>
          {loadingMoreRows && <Text size="xs" c="dimmed">추가 행 확인 중</Text>}
          <Select aria-label="페이지당 표시 행 수" size="xs" w={105} data={STOCK_PAGE_OPTIONS} value={String(pageSize)} onChange={changePageSize} disabled={loading || saving} />
          <Pagination size="sm" color="red" value={page} onChange={changePage} total={pageCount} withEdges disabled={loading || saving || pageCount <= 1} />
          <Text size="xs" fw={700}>선택 {selectedIds.length.toLocaleString()}건</Text>
        </Group>
      </Group>
    </Paper>
    {filterOpen && <Paper component="aside" className={inboundClasses.receiptFilterSidebar} withBorder>
      <Group className={inboundClasses.receiptFilterHeader} justify="space-between" align="center">
        <Text fw={700}>{'조회조건'}</Text>
        <ActionIcon variant="subtle" color="gray" aria-label={'조회조건 닫기'} onClick={() => setFilterOpen(false)}><IconX size={16} /></ActionIcon>
      </Group>
      <Stack gap="sm" className={inboundClasses.receiptFilterFields}>
        <Box>
          <Text size="xs" fw={700} mb={5}>{'기준기간'}</Text>
          <Stack gap={6}>
            <ErpDateInput type="date" aria-label={'기준기간 시작일'} value={dateFrom} onChange={(event) => setDateFrom(event.currentTarget.value)} />
            <ErpDateInput type="date" aria-label={'기준기간 종료일'} value={dateTo} onChange={(event) => setDateTo(event.currentTarget.value)} />
          </Stack>
        </Box>
        <TextInput label={'품목'} placeholder={'품목코드 또는 품목명'} value={searchInput} onChange={(event) => setSearchInput(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === 'Enter') runSearch(); }} />
        <TextInput label={'창고'} placeholder={'창고코드 또는 창고명'} value={warehouseInput} onChange={(event) => setWarehouseInput(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === 'Enter') runSearch(); }} />
      </Stack>
    </Paper>}
    </Box>
    <ItemPicker opened={Boolean(itemPickerId)} onClose={() => setItemPickerId('')} onSelect={(item) => selectItem(itemPickerId, item)} />
    <CustomerPicker opened={Boolean(customerPickerId)} onClose={() => setCustomerPickerId('')} onSelect={selectCustomer} />
    <StockMasterPicker
      opened={Boolean(masterPickerTarget)}
      title={MASTER_TITLE[masterPickerTarget?.field] || '코드 선택'}
      options={masters[MASTER_KIND[masterPickerTarget?.field]] || []}
      onClose={() => setMasterPickerTarget(null)}
      onSelect={chooseMaster}
    />
    <ConfirmDeleteModal opened={deleteAllOpen} onClose={() => { setDeleteAllOpen(false); setDeleteBlocked(''); }} onConfirm={deleteAll} loading={saving} blocked={deleteBlocked}
      title="기초재고를 전체 삭제할까요?" target="기초재고 전체" message="이 회사에 등록된 기초재고가 모두 삭제되며" note="삭제한 데이터는 복구할 수 없습니다." confirmLabel="전체 삭제" />
    <ConfirmDeleteModal opened={deleteLinesOpen} onClose={() => { setDeleteLinesOpen(false); setDeleteBlocked(''); }} onConfirm={deleteSelectedLines} loading={saving} blocked={deleteBlocked}
      title="기초재고를 삭제할까요?" target={`저장된 기초재고 ${selectedSavedCount.toLocaleString()}건`}
      message={`현재고와 재고수불 내역에서도 함께 삭제됩니다.${selectedNewCount > 0 ? ` 선택한 신규 입력 행 ${selectedNewCount.toLocaleString()}건도 함께 제거됩니다.` : ''}`}
      note="삭제한 데이터는 복구할 수 없습니다." />
    {discardMessage && <Box className={classes.discardConfirm} onKeyDown={(event) => { if (event.key === 'Escape') answerDiscard(false); }}>
      <Notification color="orange" title="저장하지 않은 변경사항" withBorder onClose={() => answerDiscard(false)}>
        <Text size="sm">{discardMessage}</Text>
        <Group justify="flex-end" gap={6} mt={10}>
          <Button size="xs" variant="default" onClick={() => answerDiscard(false)}>취소</Button>
          <Button size="xs" color="red" onClick={() => answerDiscard(true)} autoFocus>확인</Button>
        </Group>
      </Notification>
    </Box>}
  </Box>;
}
