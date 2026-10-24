import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import * as XLSX from 'xlsx';
import {
  ActionIcon, Badge, Box, Button, Group, Loader, Modal, Pagination, Paper, Popover,
  ScrollArea, Select, Stack, Table, Text, TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconDownload, IconSearch, IconTrash, IconUpload, IconX } from '@tabler/icons-react';
import { TableVirtuoso } from 'react-virtuoso';
import sharedClasses from '../styles/pages/ManagementShared.module.css';
import codeClasses from '../styles/pages/CodeMasterPage.module.css';
import outboundClasses from '../styles/pages/OutboundRegister.module.css';
import inboundClasses from '../styles/pages/InboundRegister.module.css';
import itemMasterClasses from '../styles/pages/ItemMaster.module.css';
import classes from '../styles/pages/StockStand.module.css';
import { applyExcelHeaderStyle } from '../utils/excelHeaderStyle';
import useErpPageRibbon from '../components/common/useErpPageRibbon';
import ErpBreadcrumb from '../components/common/ErpBreadcrumb';

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
const MASTER_FIELDS = new Set(['qtyunit', 'warehousecode', 'unit', 'materialcode', 'surfacecode']);
const PRICE_FIELDS = new Set(['unit', 'unitprice']);
const EDITABLE_PRICE_FIELDS = new Set(['unit', 'unitprice']);
const MASTER_KIND = { qtyunit: 'quantity', warehousecode: 'warehouse', unit: 'price', materialcode: 'material', surfacecode: 'surface' };
const MASTER_TITLE = { qtyunit: '수량단위 선택', warehousecode: '창고 선택', unit: '단가기준 선택', materialcode: '강종 선택', surfacecode: '표면 선택' };

const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });
const localDate = () => {
  const now = new Date();
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
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const lastDay = new Date(year, now.getMonth() + 1, 0).getDate();
  return { from: `${year}-${month}-01`, to: `${year}-${month}-${String(lastDay).padStart(2, '0')}` };
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
  const parts = new Intl.DateTimeFormat('en-GB', {
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
        <ScrollArea h={420} type="auto" scrollbarSize={6}>
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

function ItemNameAutocompleteCell({ row, disabled, registerCellInput, onChange, onSelect, onFindItem, onFocus, onPaste }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.itemname || '');
  const [items, setItems] = useState([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const requestIdRef = useRef(0);
  const query = String(draft || '').trim();
  const opened = editing && !disabled && query.length > 0 && items.length > 0;

  useEffect(() => {
    if (!editing || disabled || !query) {
      setItems((current) => current.length ? [] : current);
      return undefined;
    }
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
  }, [editing, disabled, query]);

  const chooseItem = (item) => {
    requestIdRef.current += 1;
    onSelect(row.id, item);
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
            requestIdRef.current += 1;
            setDraft(row.itemname || '');
            setEditing(true);
            onFocus();
            event.currentTarget.select();
          }}
          onBlur={() => { void commitExactMatch(); }}
          onChange={(event) => {
            const value = event.currentTarget.value;
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
              if (!items.length) return;
              event.preventDefault();
              event.stopPropagation();
              setActiveIndex((current) => event.key === 'ArrowDown'
                ? (current + 1) % items.length
                : (current <= 0 ? items.length - 1 : current - 1));
            } else if (event.key === 'Enter' && activeIndex >= 0 && items[activeIndex]) {
              event.preventDefault();
              event.stopPropagation();
              chooseItem(items[activeIndex]);
            } else if (event.key === 'Escape' && opened) {
              event.preventDefault();
              event.stopPropagation();
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
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!opened) return undefined;
    let alive = true;
    setLoading(true);
    axios.get('/api/list', { ...authConfig(), params: { search_keyword: query || undefined, status: 'Y', page, page_size: 20, include_total: true } })
      .then(({ data }) => {
        if (!alive) return;
        setCustomers(data.data || []);
        setTotal(data.total || 0);
      })
      .catch((error) => { if (alive) notifications.show({ title: '거래처 조회 실패', message: errorText(error), color: 'red' }); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [opened, query, page]);

  const search = () => { setPage(1); setQuery(input.trim()); };
  return <Modal opened={opened} onClose={onClose} title={<Group gap={9} wrap="nowrap"><Box className={outboundClasses.receiptFinderTitleIcon}><IconSearch size={17} /></Box><Text fw={750}>{'거래처 선택'}</Text></Group>}
    classNames={{ content: outboundClasses.receiptFinderModalContent, header: outboundClasses.receiptFinderModalHeader, title: outboundClasses.receiptFinderModalTitle, close: outboundClasses.receiptFinderModalClose }} centered size={900}>
    <Stack gap="sm" pt={10}>
      <Group gap={7} wrap="nowrap">
        <TextInput className={outboundClasses.customerSearchInput} value={input} onChange={(event) => setInput(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === 'Enter') search(); }} placeholder={'거래처코드 또는 거래처명 검색'} leftSection={<IconSearch size={15} />} size="sm" autoFocus />
        <Button color="red" size="sm" leftSection={<IconSearch size={15} />} onClick={search}>{'조회'}</Button>
      </Group>
      <Box className={outboundClasses.pickerResults}>
        {loading && <Loader className={outboundClasses.pickerLoader} size="xs" color="red" />}
        <ScrollArea h={420} type="auto" scrollbarSize={6}>
          <Table className={`${codeClasses.codeTable} ${outboundClasses.pickerTable}`} highlightOnHover withTableBorder withColumnBorders>
            <Table.Thead><Table.Tr><Table.Th>{'거래처코드'}</Table.Th><Table.Th>{'거래처명'}</Table.Th><Table.Th>{'사업자번호'}</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>{customers.map((customer) => <Table.Tr key={customer.customercode} className={outboundClasses.customerResultRow} onClick={() => { onSelect(customer); onClose(); }}>
              <Table.Td>{customer.customercode}</Table.Td><Table.Td>{customer.customername}</Table.Td><Table.Td>{customer.businessno || ''}</Table.Td>
            </Table.Tr>)}</Table.Tbody>
          </Table>
        </ScrollArea>
      </Box>
      <Group justify="space-between"><Text size="xs" c="dimmed">{`총 ${total.toLocaleString()}건`}</Text><Pagination size="sm" total={Math.max(1, Math.ceil(total / 20))} value={page} onChange={setPage} withEdges color="red" /></Group>
    </Stack>
  </Modal>;
}

function CustomerNameAutocompleteCell({ row, disabled, registerCellInput, onChange, onSelect, onFindCustomer, onFocus, onPaste }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.customname || '');
  const [customers, setCustomers] = useState([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const requestIdRef = useRef(0);
  const query = String(draft || '').trim();
  const opened = editing && !disabled && query.length > 0 && customers.length > 0;

  useEffect(() => {
    if (!editing || disabled || !query) {
      setCustomers((current) => current.length ? [] : current);
      return undefined;
    }
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
  }, [editing, disabled, query]);

  const chooseCustomer = (customer) => {
    requestIdRef.current += 1;
    onSelect(row.id, customer);
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
            requestIdRef.current += 1;
            setDraft(row.customname || '');
            setEditing(true);
            onFocus();
            event.currentTarget.select();
          }}
          onBlur={() => { void commitExactMatch(); }}
          onChange={(event) => {
            const value = event.currentTarget.value;
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
              if (!customers.length) return;
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
            } else if (event.key === 'Escape' && opened) {
              event.preventDefault();
              event.stopPropagation();
              setDraft(row.customname || '');
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
          style={index === activeIndex ? { background: '#edf3f8' } : undefined}
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
  const pickerOpenRef = useRef(false);
  const query = String(draft || '').trim().toLocaleLowerCase();
  const matches = useMemo(() => editing && !disabled && query
    ? options.filter((option) => `${option.name || ''} ${option.code || ''}`.toLocaleLowerCase().includes(query)).slice(0, 8)
    : [], [options, query, editing, disabled]);
  const opened = editing && !disabled && matches.length > 0;

  const choose = (option) => {
    onChange(row.id, field, option.code);
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
            pickerOpenRef.current = false;
            setDraft(getDisplayValue());
            setEditing(true);
            onFocus();
            event.currentTarget.select();
          }}
          onBlur={() => { if (!pickerOpenRef.current) commit(); }}
          onChange={(event) => { setDraft(event.currentTarget.value); setActiveIndex(-1); setEditing(true); }}
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
              if (!matches.length) return;
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
            } else if (event.key === 'Escape' && opened) {
              event.preventDefault();
              event.stopPropagation();
              setDraft(getDisplayValue());
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
      <ScrollArea h={360} type="auto" scrollbarSize={6}>
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
  const [masters, setMasters] = useState({ quantity: [], warehouse: [], price: [], material: [], surface: [] });
  const [hasSavedStock, setHasSavedStock] = useState(false);
  const [hasTransactions, setHasTransactions] = useState(false);
  const [hasStockMovements, setHasStockMovements] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMoreRows, setLoadingMoreRows] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [itemPickerId, setItemPickerId] = useState('');
  const [customerPickerId, setCustomerPickerId] = useState('');
  const [masterPickerTarget, setMasterPickerTarget] = useState(null);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [columnWidths, setColumnWidths] = useState({});
  const uploadInputRef = useRef(null);
  const virtuosoRef = useRef(null);
  const cellInputRefs = useRef(new Map());
  const pendingCellFocusRef = useRef(null);
  const originalRowsRef = useRef(new Map());
  const activeCellRef = useRef(null);
  const selectionAnchorRef = useRef('');
  const movementNoticeShownRef = useRef(false);
  const listRequestIdRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const hasMoreRowsRef = useRef(false);
  const nextCursorRef = useRef(0);
  const { hasNewRows, changedPriceRows, hasChanges } = useMemo(() => {
    const hasNew = rows.some((row) => !row.lineno && hasRowInput(row));
    const changedPrices = rows.filter((row) => {
      if (!row.lineno) return false;
      const original = originalRowsRef.current.get(row.id);
      return original && [...EDITABLE_PRICE_FIELDS].some((field) => String(row[field] ?? '') !== String(original[field] ?? ''));
    });
    return { hasNewRows: hasNew, changedPriceRows: changedPrices, hasChanges: hasNew || changedPrices.length > 0 };
  }, [rows]);
  const displayRowCount = hasSavedStock ? totalRows : rows.length;
  const visibleRows = hasSavedStock ? rows : rows.slice((page - 1) * pageSize, page * pageSize);
  const pageCount = Math.max(1, Math.ceil(displayRowCount / pageSize));
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

  const loadRows = useCallback(async (nextDate = standdate, nextQuery = query, confirmDiscard = true, useRegisteredDate = false, nextPage = page, nextPageSize = pageSize, nextDateFrom = dateFrom, nextDateTo = dateTo, nextWarehouse = warehouseQuery) => {
    if (confirmDiscard && hasChanges && !window.confirm('저장하지 않은 변경사항이 있습니다. 조회하면 변경 내용이 사라집니다. 계속할까요?')) return;
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
      if (useRegisteredDate && data.has_stock_rows && registeredDate && registeredDate !== nextDate) {
        setStanddate(registeredDate);
        setDateFrom(registeredDate);
        setDateTo(registeredDate);
        response = await axios.get('/api/stock-stand/items', { ...authConfig(), params: { standdate: registeredDate, date_from: registeredDate, date_to: registeredDate, q: nextQuery || undefined, warehouse: nextWarehouse || undefined, cursor: 0, limit: nextPageSize, offset } });
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
      const shouldShowMovementNotice = Boolean(data.has_transactions && !data.has_stock_rows);
      if (shouldShowMovementNotice && !movementNoticeShownRef.current) {
        notifications.show({
          title: '입출고 수불 내역이 있습니다',
          message: '입고 또는 출고 내역이 있는 회사는 기초재고를 신규 등록하거나 전체 삭제할 수 없습니다.',
          color: 'orange',
          autoClose: 7000,
        });
      }
      movementNoticeShownRef.current = shouldShowMovementNotice;
      return true;
    } catch (error) {
      notifications.show({ title: '기초재고 조회 실패', message: errorText(error), color: 'red' });
      return false;
    } finally { if (requestId === listRequestIdRef.current) setLoading(false); }
  }, [standdate, query, hasChanges, page, pageSize, dateFrom, dateTo, warehouseQuery]);

  const changePage = async (nextPage) => {
    if (nextPage < 1 || nextPage > pageCount || nextPage === page) return;
    if (hasSavedStock && hasChanges && !window.confirm('저장하지 않은 변경사항이 있습니다. 페이지를 이동하면 변경 내용이 사라집니다. 계속할까요?')) return;
    if (hasSavedStock && !(await loadRows(standdate, query, false, false, nextPage, pageSize))) return;
    setPage(nextPage);
  };

  const changePageSize = async (value) => {
    const nextPageSize = Number(value);
    if (!nextPageSize || nextPageSize === pageSize) return;
    if (hasSavedStock && hasChanges && !window.confirm('저장하지 않은 변경사항이 있습니다. 표시 행 수를 바꾸면 변경 내용이 사라집니다. 계속할까요?')) return;
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
    if (hasChanges && !window.confirm('저장하지 않은 변경사항이 있습니다. 조회하면 변경 내용이 사라집니다. 계속할까요?')) return;
    const nextDate = dateTo || dateFrom || standdate;
    if (!(await loadRows(nextDate, nextQuery, false, false, 1, pageSize, dateFrom, dateTo, nextWarehouse))) return;
    setStanddate(nextDate);
    setQuery(nextQuery);
    setWarehouseQuery(nextWarehouse);
    setPage(1);
  };

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
    loadRows(standdate, '', false, true);
    Promise.all([loadCodes('QTY'), loadCodes('WAREHOUSE'), loadCodes('PRICE_UNIT'), loadCodes('MATERIAL'), loadCodes('SURFACE')])
      .then(([quantity, warehouse, price, material, surface]) => setMasters({ quantity, warehouse, price, material, surface }))
      .catch((error) => notifications.show({ title: '기초재고 코드 조회 실패', message: errorText(error), color: 'red' }));
  // Initial load; date changes are explicitly searched to protect edits.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      if (row.id !== id && !(applyToSelected && selectedSet.has(row.id))) return row;
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
    if (hasSavedStock || hasTransactions) {
      notifications.show({
        title: '기초재고를 등록할 수 없습니다',
        message: registrationBlockMessage,
        color: 'orange',
      });
      return;
    }
    const row = makeRow({
      standdate: localDate(),
      qtyunit: resolveMasterCode('qtyunit', 'EA', masters) || 'EA',
      unit: resolveMasterCode('unit', 'KG', masters) || 'KG',
    });
    setRows((current) => [...current, row]);
    const nextPage = Math.ceil((rows.length + 1) / pageSize);
    setPage(nextPage);
    setSelectedIds([]);
    selectionAnchorRef.current = '';
    pendingCellFocusRef.current = { key: `${row.id}:standdate` };
    requestAnimationFrame(() => {
      virtuosoRef.current?.scrollToIndex({ index: Math.max(0, rows.length - (nextPage - 1) * pageSize), align: 'end', behavior: 'auto' });
    });
  };
  const copySelectedRow = () => {
    if (hasSavedStock || hasTransactions || saving || loading || uploading) return;
    if (selectedIds.length !== 1) {
      notifications.show({ title: '복사할 행 선택', message: '복사할 기초재고 행을 하나 선택해 주세요.', color: 'orange' });
      return;
    }
    const source = rows.find((row) => row.id === selectedIds[0]);
    if (!source || source.lineno) return;
    const values = Object.fromEntries(Object.entries(source)
      .filter(([key]) => !['id', 'lineno', 'isNew', 'has_movements', 'created_at', 'updated_at'].includes(key)));
    const copy = makeRow(values);
    const nextPage = Math.ceil((rows.length + 1) / pageSize);
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
      if (active.field === 'materialcode') next.materialname = masters.material.find((option) => option.code === value)?.name || '';
      if (active.field === 'surfacecode') next.surfacename = masters.surface.find((option) => option.code === value)?.name || '';
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

  const pasteRange = useCallback(async (startId, startField, pastedText) => {
    const matrix = pastedText.replace(/\r/g, '').split('\n').filter((line, index, all) => line || index < all.length - 1).map((line) => line.split('\t'));
    const startIndex = rows.findIndex((row) => row.id === startId);
    const startColumn = GRID_FIELDS.indexOf(startField);
    if (startIndex < 0 || startColumn < 0) return;
    const targetRowCount = startIndex + matrix.length;
    if (registrationBlockMessage && !hasSavedStock && targetRowCount > rows.length) {
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
  }, [rows, masters, registrationBlockMessage, hasSavedStock, standdate, query]);

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
    worksheet['!cols'] = STOCK_EXCEL_COLUMNS.map(([key]) => ({ wch: ['itemname', 'customname', 'warehousecodename', 'materialname', 'surfacename', 'description'].includes(key) ? 24 : 16 }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '기초재고');
    XLSX.writeFile(workbook, `기초재고_일괄등록_샘플.xlsx`);
  }, []);

  const exportRows = useCallback(async () => {
    setExporting(true);
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
      XLSX.writeFile(workbook, `기초재고_${standdate.replaceAll('-', '')}.xlsx`);
      notifications.show({ title: '엑셀 다운로드 완료', message: `${rowsForExport.length.toLocaleString()}건을 저장했습니다.`, color: 'teal' });
    } catch (error) {
      notifications.show({ title: '엑셀 다운로드 실패', message: errorText(error), color: 'red' });
    } finally { setExporting(false); }
  }, [rows, standdate, query, hasSavedStock, totalRows]);

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
  }, [hasChanges, masters, hasSavedStock, hasTransactions, registrationBlockMessage, standdate]);

  const save = async () => {
    let newRows = rows.filter((row) => !row.lineno && hasRowInput(row));
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
        notifications.show({ title: '기초재고 전체 삭제 실패', message: errorText(error), color: 'red' });
    } finally { setSaving(false); }
  };

  const deleteSelectedRows = () => {
    if (!selectedIds.length || hasSavedStock || saving) return;
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
  const columns = STOCK_GRID_COLUMNS;
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
        ? <input type="checkbox" aria-label="전체 선택" disabled={hasSavedStock || !rows.some((row) => !row.lineno)} checked={rows.some((row) => !row.lineno) && rows.filter((row) => !row.lineno).every((row) => selectedSet.has(row.id))} onChange={(event) => toggleAll(event.currentTarget.checked)} />
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
          : key === 'materialcode' ? masterOptions.find((option) => option.code === row.materialcode)?.name || row.materialname || row.materialcode || ''
            : key === 'surfacecode' ? masterOptions.find((option) => option.code === row.surfacecode)?.name || row.surfacename || row.surfacecode || ''
              : ['supplyamt', 'vat', 'unitamt'].includes(key) ? formatAmount(amounts[key])
                : ['myrtle', 'thickness', 'width', 'length', 'qty', 'weight', 'unitprice'].includes(key) ? numberText(row[key]) : row[key] ?? '';
      if (saved && !PRICE_FIELDS.has(key)) return <Table.Td key={key} className={outboundClasses.savedCell}>
        <span className={`${classes.savedValue} ${['supplyamt', 'vat', 'unitamt'].includes(key) ? classes.savedAmountValue : ''}`} title={String(displayed)}>{displayed}</span>
      </Table.Td>;
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
          pasteRange(row.id, key, text);
        } else if (masterKey) {
          event.preventDefault();
          updateRow(row.id, key, text.trim());
        }
      };
      if (key === 'standdate') return <Table.Td key={key} className={saved ? outboundClasses.savedCell : ''}>
        <input
          ref={(element) => registerCellInput(row.id, key, element)}
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
          onFocus={() => { activeCellRef.current = { id: row.id, field: key }; }}
          onChange={(event) => updateRow(row.id, key, event.currentTarget.value)}
          onPaste={pasted}
        />
      </Table.Td>;
      if (key === 'customname') return <Table.Td key={key} className={saved ? outboundClasses.savedCell : ''}>
        <CustomerNameAutocompleteCell
          row={row}
          disabled={disabled}
          registerCellInput={registerCellInput}
          onChange={updateRow}
          onSelect={selectCustomerForRow}
          onFindCustomer={setCustomerPickerId}
          onFocus={() => { activeCellRef.current = { id: row.id, field: key }; }}
          onPaste={pasted}
        />
      </Table.Td>;
      if (key === 'itemname') return <Table.Td key={key} className={saved ? outboundClasses.savedCell : ''}>
        <ItemNameAutocompleteCell
          row={row}
          disabled={disabled}
          registerCellInput={registerCellInput}
          onChange={updateRow}
          onSelect={selectItem}
          onFindItem={setItemPickerId}
          onFocus={() => { activeCellRef.current = { id: row.id, field: key }; }}
          onPaste={pasted}
        />
      </Table.Td>;
      if (['warehousecode', 'materialcode', 'surfacecode'].includes(key)) return <Table.Td key={key} className={saved ? outboundClasses.savedCell : ''}>
        <MasterNameAutocompleteCell
          row={row}
          field={key}
          options={masterOptions}
          disabled={disabled}
          registerCellInput={registerCellInput}
          onChange={updateRow}
          onFindMaster={(id, field) => setMasterPickerTarget({ id, field })}
          onFocus={() => { activeCellRef.current = { id: row.id, field: key }; }}
          onPaste={pasted}
        />
      </Table.Td>;
      if (key === 'unit' || key === 'qtyunit') {
        const defaultValue = key === 'unit' ? 'KG' : 'EA';
        const value = resolveMasterCode(key, row[key] || defaultValue, masters) || row[key] || defaultValue;
        return <Table.Td key={key} className={saved ? outboundClasses.savedCell : ''}>
          <select
            ref={(element) => registerCellInput(row.id, key, element)}
            className={`${codeClasses.cellSelect} ${inboundClasses.priceUnitSelect}`}
            aria-label={columns.find(([columnKey]) => columnKey === key)?.[1] || key}
            data-row-id={row.id}
            data-field={key}
            value={value}
            disabled={disabled}
            onFocus={() => { activeCellRef.current = { id: row.id, field: key }; }}
            onPaste={pasted}
            onChange={(event) => updateRow(row.id, key, event.currentTarget.value)}
          >
            {row[key] && !resolveMasterCode(key, row[key], masters) && <option value={row[key]}>{row[key]}</option>}
            {masterOptions.map((option) => <option key={option.code} value={option.code}>{option.name || option.code}</option>)}
          </select>
        </Table.Td>;
      }
      return <Table.Td key={key} className={saved ? (editableSavedPrice ? classes.savedEditableCell : outboundClasses.savedCell) : ''}>
        <input
          ref={(element) => {
            registerCellInput(row.id, key, element);
          }}
          className={`${codeClasses.cellInput} ${['unitamt', 'supplyamt', 'vat'].includes(key) ? outboundClasses.amountInput : ''} ${key === 'itemcode' || key === 'itemname' || key === 'customname' || masterKey ? outboundClasses.itemCodePickerInput : ''}`}
          aria-label={columns.find(([columnKey]) => columnKey === key)?.[1] || key}
          title={key === 'itemcode' || key === 'itemname' ? '더블클릭하여 품목 선택' : masterKey ? '더블클릭하여 마스터 코드 선택' : undefined}
          data-row-id={row.id}
          data-field={key}
          inputMode={['myrtle', 'thickness', 'width', 'length', 'qty', 'weight', 'unitprice', 'supplyamt', 'vat'].includes(key) ? 'decimal' : undefined}
          value={displayed}
          placeholder={row.isNew && (key === 'itemcode' || key === 'itemname') ? (key === 'itemcode' ? '품목코드' : '품목명') : ''}
          readOnly={readOnly || disabled}
          disabled={disabled}
          onFocus={() => { activeCellRef.current = { id: row.id, field: key }; }}
          onClick={(event) => {
            if (masterKey && !disabled && event.nativeEvent.offsetX >= event.currentTarget.clientWidth - 28) {
              event.preventDefault();
              event.stopPropagation();
              setMasterPickerTarget({ id: row.id, field: key });
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'F2' && !disabled) {
              event.preventDefault();
              event.stopPropagation();
              if (key === 'customname') setCustomerPickerId(row.id);
              else if (key === 'itemcode' || key === 'itemname') setItemPickerId(row.id);
              else if (masterKey) setMasterPickerTarget({ id: row.id, field: key });
            }
          }}
          onDoubleClick={() => {
            if (key === 'customname') setCustomerPickerId(row.id);
            else if (key === 'itemcode' || key === 'itemname') setItemPickerId(row.id);
            else if (masterKey) setMasterPickerTarget({ id: row.id, field: key });
          }}
          onPaste={pasted}
          onBlur={key === 'customname' ? (event) => { void resolveCustomerName(row.id, event.currentTarget.value); } : key === 'itemcode' || key === 'itemname' ? async (event) => {
            const itemValue = event.currentTarget.value.trim();
            if (!itemValue) return;
            try {
              const { data } = await axios.get('/api/item-master/items/picker', { ...authConfig(), params: { q: itemValue, page: 1, page_size: 20 } });
              const normalizedValue = itemValue.toLocaleLowerCase();
              const match = (data.items || []).find((item) => String(item.itemcode).trim().toLocaleLowerCase() === normalizedValue
                || String(item.itemname).trim().toLocaleLowerCase() === normalizedValue);
              if (match) selectItem(row.id, match);
            } catch { /* Keep the entered code so validation can identify it on save. */ }
          } : undefined}
          onChange={(event) => updateRow(row.id, key, ['myrtle', 'thickness', 'width', 'length', 'qty', 'weight', 'unitprice', 'supplyamt', 'vat'].includes(key) ? cleanNumber(event.currentTarget.value) : event.currentTarget.value)}
        />
      </Table.Td>;
    };
    const amounts = calculateAmounts(row, masters.price);

    return <>
      <Table.Td className={codeClasses.checkCol}><input type="checkbox" checked={isSelected} disabled={saving || saved || hasSavedStock} onChange={(event) => toggleRowSelection(row.id, event.nativeEvent.shiftKey)} /></Table.Td>
      <Table.Td className={`${codeClasses.rowNumber} ${!saved ? classes.newRowNumber : ''}`}>{(page - 1) * pageSize + index + 1}</Table.Td>
      {GRID_FIELDS.map(renderField)}
    </>;
  };

  const deleteFromRibbon = () => {
    if (loading || saving || uploading) return;
    if (selectedIds.length && !hasSavedStock) {
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
    onCopy: selectedIds.length === 1 && !hasSavedStock && !hasTransactions ? copySelectedRow : undefined,
    onSave: save,
    onDelete: deleteFromRibbon,
    onExcel: exportRows,
    showPrint: false,
    useSaveColor: false,
  });

  return <Box className={`${sharedClasses.pageShell} ${classes.page}`}>
    <ErpBreadcrumb parent="재고관리" current="기초재고등록" filterOpen={filterOpen} onOpenFilters={() => setFilterOpen(true)} />

    <Box className={`${classes.workspace} ${filterOpen ? classes.workspaceWithFilter : ''}`}>
    <Paper className={`${sharedClasses.panel} ${codeClasses.codePanel} ${classes.editorPanel}`} withBorder>
      <Group className={`${sharedClasses.panelHeader} ${codeClasses.codeHeader} ${classes.codeHeader}`} justify="space-between" align="flex-start" wrap="wrap" gap="sm">
        <Group gap={8} align="center"><Text className={classes.sectionTitle} fw={700}>기초재고등록</Text><Badge color="gray" variant="light">{displayRowCount.toLocaleString()}행</Badge></Group>
        <Group className={classes.headerActions} gap={7} align="center" wrap="wrap">
          <Button variant="default" size="xs" leftSection={<IconDownload size={15} />} onClick={downloadTemplate} disabled={loading || uploading}>샘플양식</Button>
          <Button variant="light" size="xs" leftSection={<IconUpload size={15} />} onClick={() => uploadInputRef.current?.click()} loading={uploading} disabled={saving || loading || hasSavedStock || hasTransactions}>엑셀 일괄등록</Button>
          <input ref={uploadInputRef} type="file" accept=".xlsx,.xls" onChange={uploadExcel} hidden />
        </Group>
      </Group>
      <Group className={`${sharedClasses.toolbar} ${codeClasses.toolbar} ${classes.detailToolbar}`} justify="space-between" wrap="wrap" gap={6}>
        {selectedIds.length > 1 && <Text size="xs" c="red" fw={600}>마스터 값 변경 시 {selectedIds.length}개 행에 일괄 적용됩니다.</Text>}
      </Group>
      <Box className={`${codeClasses.tableWrap} ${classes.tableViewport} ${hasSavedStock ? classes.savedTableViewport : ''}`} style={{ '--code-table-min-width': `${Math.max(1730, tableWidth)}px` }} onKeyDown={handleTableKeyDown}>
        {loading ? <Box className={classes.loading}><Loader color="red" /></Box> : visibleRows.length ? (hasSavedStock ? (
          <Table className={`${sharedClasses.table} ${codeClasses.codeTable} ${classes.table}`} highlightOnHover withTableBorder withColumnBorders verticalSpacing="xs" horizontalSpacing={0}
            style={{ width: '100%', minWidth: 'var(--code-table-min-width)', tableLayout: 'fixed' }}>
            <Table.Thead><Table.Tr>{headerColumns.map(renderHeader)}</Table.Tr></Table.Thead>
            <Table.Tbody>{visibleRows.map((row, index) => <Table.Tr key={row.id}>{itemContent(index, row)}</Table.Tr>)}</Table.Tbody>
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
          />
        )) : (
          <Box className={classes.emptyTableState}>
            <Table className={`${sharedClasses.table} ${codeClasses.codeTable}`} highlightOnHover withTableBorder withColumnBorders
              style={{ width: '100%', minWidth: 'var(--code-table-min-width)', tableLayout: 'fixed' }}>
              <Table.Thead><Table.Tr>{headerColumns.map(renderHeader)}</Table.Tr></Table.Thead>
            </Table>
            <Box className={classes.emptyTableMessage}>{'표시할 기초재고가 없습니다.'}</Box>
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
            <TextInput type="date" aria-label={'기준기간 시작일'} value={dateFrom} onChange={(event) => setDateFrom(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === 'Enter') runSearch(); }} />
            <TextInput type="date" aria-label={'기준기간 종료일'} value={dateTo} onChange={(event) => setDateTo(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === 'Enter') runSearch(); }} />
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
    <Modal opened={deleteAllOpen} onClose={() => !saving && setDeleteAllOpen(false)} title="기초재고 전체 삭제" centered size="sm">
      <Stack gap="md">
        <Text size="sm" c="dimmed">이 회사에 등록된 기초재고 전체를 삭제합니다. 삭제한 데이터는 복구할 수 없습니다.</Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setDeleteAllOpen(false)} disabled={saving}>취소</Button>
          <Button color="red" leftSection={<IconTrash size={15} />} onClick={deleteAll} loading={saving}>전체 삭제</Button>
        </Group>
      </Stack>
    </Modal>
  </Box>;
}
