import { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import {
  ActionIcon, Badge, Box, Button, Group, Loader, Modal, Pagination, Paper,
  ScrollArea, Select, Stack, Table, Text, TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconCopy, IconDeviceFloppy, IconFileSpreadsheet, IconFilter,
  IconPlus, IconSearch, IconTrash, IconX,
} from '@tabler/icons-react';
import { TableVirtuoso } from 'react-virtuoso';
import * as XLSX from 'xlsx';
import { applyExcelHeaderStyle } from '../utils/excelHeaderStyle';
import sharedClasses from '../styles/pages/ManagementShared.module.css';
import codeClasses from '../styles/pages/CodeMasterPage.module.css';
import classes from '../styles/pages/OutboundRegister.module.css';
import inboundClasses from '../styles/pages/InboundRegister.module.css';
import { PageRibbonContext } from '../components/layout/MainLayout';
import OutboundStockPickerModal from './OutboundStockPickerModal';

const PAGE_SIZE_OPTIONS = [
  { value: '15', label: '15개씩' }, { value: '50', label: '50개씩' },
  { value: '100', label: '100개씩' }, { value: '200', label: '200개씩' },
];
const createDefaultReceiptFilters = () => {
  const today = new Date();
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
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const EMPTY_HEADER = { receiptno: '', receptdate: localDate(), customcode: '', customname: '', description: '' };
const DETAIL_FIELDS = [
  { key: 'receptdate', label: '출고일자', width: 120, required: true },
  { key: 'customname', label: '매출처', width: 180 },
  { key: 'warehousecodename', label: '창고', width: 130 },
  { key: 'productname', label: '제품번호', width: 120 },
  { key: 'itemname', label: '품명', width: 170 },
  { key: 'materialname', label: '강종', width: 110 },
  { key: 'surfacename', label: '표면', width: 110 },
  { key: 'myrtle', label: '도금량(g/㎡)', width: 135 },
  { key: 'thickness', label: '두께', width: 80 },
  { key: 'width', label: '폭', width: 80 },
  { key: 'length', label: '길이', width: 80 },
  { key: 'qty', label: '출고수량', width: 100, required: true },
  { key: 'weight', label: '출고중량(kg)', width: 115, required: true },
  { key: 'unitprice', label: '판매단가', width: 110, required: true },
  { key: 'supplyamt', label: '공급가', width: 110 },
  { key: 'vat', label: '부가세', width: 95 },
  { key: 'unitamt', label: '출고금액', width: 120 },
  { key: 'qtyunit', label: '수량단위', width: 90 },
  { key: 'unit', label: '단가기준', width: 105, required: true },
  { key: 'manager', label: '담당자', width: 110 },
  { key: 'description', label: '비고', width: 160 },
  { key: 'current_qty', label: '현재고수량', width: 110 },
  { key: 'current_weight', label: '현재고중량(kg)', width: 130 },
  { key: 'itemcode', label: '품목코드', width: 130 },
  { key: 'sourcecustomname', label: '매입처', width: 160 },
  { key: 'receiptdate', label: '재고입고일자', width: 120 },
  { key: 'sourcetype', label: '재고구분', width: 90 },
  { key: 'stocksourceno', label: '원천전표', width: 170 },
  { key: 'stocksourceline', label: '원천순번', width: 90 },
];
const RECEIPT_COLUMNS = [
  { key: 'receptdate', label: '출고일자', width: 100, minWidth: 90 },
  { key: 'customname', label: '매출처', width: 150, minWidth: 105 },
  { key: 'warehousecodename', label: '창고', width: 115, minWidth: 90 },
  { key: 'line_count', label: '상세건수', width: 78, minWidth: 68, align: 'right' },
  { key: 'total_qty', label: '수량', width: 78, minWidth: 68, align: 'right' },
  { key: 'total_weight', label: '중량', width: 82, minWidth: 72, align: 'right' },
  { key: 'supply_amount', label: '공급가', width: 105, minWidth: 85, align: 'right' },
  { key: 'vat_amount', label: '부가세', width: 90, minWidth: 75, align: 'right' },
  { key: 'total_amount', label: '합계금액', width: 115, minWidth: 95, align: 'right' },
  { key: 'qtyunit', label: '수량단위', width: 80, minWidth: 70 },
  { key: 'unit', label: '단가기준', width: 80, minWidth: 70 },
  { key: 'receiptno', label: '출고전표', width: 155, minWidth: 125 },
  { key: 'description', label: '비고', width: 115, minWidth: 85 },
];
const fitReceiptColumnWidth = (label, values, baseWidth, minWidth, maxWidth = 420) => {
  const measure = (value) => Array.from(String(value ?? '')).reduce((width, character) => width + (character.charCodeAt(0) > 255 ? 11 : 6.5), 0) + 20;
  const contentWidth = Math.max(measure(label), ...values.map(measure));
  return Math.max(minWidth, Math.min(maxWidth, Math.max(baseWidth, contentWidth)));
};
const READ_ONLY_DETAIL_FIELDS = new Set(['sourcetype', 'receiptdate', 'stocksourceno', 'stocksourceline', 'sourcecustomname', 'customname', 'itemcode', 'itemname', 'productname', 'materialname', 'surfacename', 'myrtle', 'thickness', 'width', 'length', 'warehousecodename', 'current_qty', 'qtyunit', 'current_weight', 'unit', 'unitprice', 'supplyamt', 'vat', 'unitamt', 'manager']);
const NAVIGABLE_FIELDS = DETAIL_FIELDS.map(({ key }) => key).filter((key) => !READ_ONLY_DETAIL_FIELDS.has(key));
const EDITABLE_FIELDS = NAVIGABLE_FIELDS;
const EMPTY_DETAIL = { sourcetype: '', receiptdate: '', receptdate: localDate(), stocksourceno: '', stocksourcetype: '', stocksourceline: '', sourcecustomname: '', customcode: '', customname: '', itemcode: '', itemname: '', productname: '', materialcode: '', materialname: '', surfacecode: '', surfacename: '', myrtle: '', thickness: '', width: '', length: '', qty: '', qtyunit: '', warehousecode: '', warehousecodename: '', current_qty: '0', current_weight: '0', weight: '', unit: '', unitprice: '', supplyamt: '', vat: '', unitamt: '', manager: '', description: '' };
const masterPasteErrorKey = (rowId, field) => `${rowId}:${field}`;

const errorMessage = (error) => {
  const detail = error.response?.data?.detail;
  if (Array.isArray(detail)) return detail.slice(0, 5).map((item) => {
    const location = Array.isArray(item.loc) ? item.loc : [];
    const itemIndex = location.indexOf('items');
    const field = location.at(-1);
    const fieldNames = {
      stocksourcetype: '원천 재고 구분', stocksourceno: '원천 전표번호',
      stocksourceline: '원천 순번', customcode: '매출처코드', unit: '단가기준',
    };
    const rowLabel = itemIndex >= 0 && Number.isInteger(Number(location[itemIndex + 1]))
      ? `${Number(location[itemIndex + 1]) + 1}행 ` : '';
    const fieldLabel = fieldNames[field] || (typeof field === 'string' ? field : '요청값');
    return `${rowLabel}${fieldLabel}: ${item.msg || String(item)}`;
  }).join(' / ');
  return detail || error.response?.data?.message || error.message || '출고 요청에 실패했습니다.';
};
const makeDetail = (source = EMPTY_DETAIL, lineNo = null) => ({
  ...EMPTY_DETAIL,
  ...source,
  id: source.id || `line-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  lineno: lineNo,
  is_new: lineNo == null,
  is_dirty: false,
});
const amountOf = (row, priceUnits = []) => {
  if (!String(row.unitprice ?? '').trim()) return '';
  const weight = Number(row.weight);
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
const NUMERIC_FIELDS = new Set(['thickness', 'width', 'length', 'qty', 'weight', 'unitprice']);
const cleanNumericInput = (value) => String(value ?? '').replace(/,/g, '').replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1');
const formatNumericInput = (value) => {
  const raw = cleanNumericInput(value);
  if (!raw) return '';
  const [integer, ...decimalParts] = raw.split('.');
  const groupedInteger = (integer || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return decimalParts.length ? `${groupedInteger}.${decimalParts.join('')}` : groupedInteger;
};

const PickerModalTitle = ({ title }) => (
  <Group gap={9} wrap="nowrap">
    <Box className={classes.receiptFinderTitleIcon}><IconSearch size={17} /></Box>
    <Text className={classes.receiptFinderModalTitle} fw={750}>{title}</Text>
  </Group>
);
const formatExcelDateTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type) => parts.find((entry) => entry.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}:${part('second')}`;
};

const isReceiptConfirmed = (value) => ['Y', 'YES', '확정'].includes(String(value ?? '').trim().toUpperCase());
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

  return <Modal opened={opened} onClose={invalidatePending} title={<PickerModalTitle title="매출처 선택" />} classNames={{ content: classes.receiptFinderModalContent, header: classes.receiptFinderModalHeader, title: classes.receiptFinderModalTitle, close: classes.receiptFinderModalClose }} centered size={900}>
    <Stack gap="sm" pt={10}>
      <Group gap={7} wrap="nowrap">
        <TextInput className={classes.customerSearchInput} placeholder="매출처코드 또는 매출처명 검색" value={searchInput}
          onChange={(event) => setSearchInput(event.currentTarget.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') searchCustomers(); }}
          leftSection={<IconSearch size={15} />} size="sm" autoFocus />
        <Button color="red" size="sm" leftSection={<IconSearch size={15} />} onClick={searchCustomers}>조회</Button>
      </Group>
      <Box className={classes.pickerResults}>
        {loading && <Loader className={classes.pickerLoader} size="xs" color="red" aria-label="조회 중" />}
        <ScrollArea h={420} type="auto" scrollbarSize={6}>
          <Table className={`${codeClasses.codeTable} ${classes.pickerTable}`} highlightOnHover withTableBorder withColumnBorders>
            <Table.Thead><Table.Tr><Table.Th className={classes.customerCodeColumn}>매출처코드</Table.Th><Table.Th className={classes.customerNameColumn}>매출처명</Table.Th><Table.Th className={classes.customerBusinessColumn}>사업자번호</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>
              {customers.map((customer) => (
                <Table.Tr key={customer.customercode} className={classes.customerResultRow} onClick={() => onSelect(customer)}>
                  <Table.Td>{customer.customercode}</Table.Td><Table.Td>{customer.customername}</Table.Td><Table.Td>{customer.businessno || ''}</Table.Td>
                </Table.Tr>
              ))}
              {!customers.length && <Table.Tr><Table.Td colSpan={3} className={classes.customerEmpty}>{loading ? '조회 중입니다.' : '조회된 매출처가 없습니다.'}</Table.Td></Table.Tr>}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Box>
      <Group justify="space-between"><Text size="xs" c="dimmed">총 {total.toLocaleString()}개 매출처</Text><Pagination size="sm" total={Math.max(1, Math.ceil(total / 20))} value={page} onChange={changePage} withEdges color="red" disabled={loading} /></Group>
    </Stack>
  </Modal>;
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

  return <Modal opened={opened} onClose={invalidatePending} title={<PickerModalTitle title="품목 선택" />} classNames={{ content: classes.receiptFinderModalContent, header: classes.receiptFinderModalHeader, title: classes.receiptFinderModalTitle, close: classes.receiptFinderModalClose }} centered size={900}>
    <Stack gap="sm" pt={10}>
      <Group gap={7} wrap="nowrap">
        <TextInput className={classes.customerSearchInput} placeholder="품목코드, 품목명 또는 형태구분 검색" value={searchInput}
          onChange={(event) => setSearchInput(event.currentTarget.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') searchItems(); }}
          leftSection={<IconSearch size={15} />} size="sm" autoFocus />
        <Button color="red" size="sm" leftSection={<IconSearch size={15} />} onClick={searchItems}>조회</Button>
      </Group>
      <Box className={classes.pickerResults}>
        {loading && <Loader className={classes.pickerLoader} size="xs" color="red" aria-label="조회 중" />}
        <ScrollArea h={420} type="auto" scrollbarSize={6}>
          <Table className={`${codeClasses.codeTable} ${classes.pickerTable}`} highlightOnHover withTableBorder withColumnBorders>
            <Table.Thead><Table.Tr><Table.Th className={classes.customerCodeColumn}>품목코드</Table.Th><Table.Th className={classes.customerNameColumn}>품목명</Table.Th><Table.Th className={classes.customerBusinessColumn}>형태구분</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>
              {items.map((item) => (
                <Table.Tr key={item.itemcode} className={classes.customerResultRow} onClick={() => onSelect(item)}>
                  <Table.Td>{item.itemcode}</Table.Td><Table.Td>{item.itemname}</Table.Td><Table.Td>{item.itemtypecode || ''}</Table.Td>
                </Table.Tr>
              ))}
              {!items.length && <Table.Tr><Table.Td colSpan={3} className={classes.customerEmpty}>{loading ? '조회 중입니다.' : '조회된 사용중 품목이 없습니다.'}</Table.Td></Table.Tr>}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Box>
      <Group justify="space-between"><Text size="xs" c="dimmed">총 {total.toLocaleString()}개 품목</Text><Pagination size="sm" total={Math.max(1, Math.ceil(total / 20))} value={page} onChange={changePage} withEdges color="red" disabled={loading} /></Group>
    </Stack>
  </Modal>;
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

  return <Modal opened={opened} onClose={onClose} title={<PickerModalTitle title={title} />} classNames={{ content: classes.receiptFinderModalContent, header: classes.receiptFinderModalHeader, title: classes.receiptFinderModalTitle, close: classes.receiptFinderModalClose }} centered size="md">
    <Stack gap="sm" pt={10}>
      <TextInput value={search} onChange={(event) => { setSearch(event.currentTarget.value); setPage(1); }} placeholder={'코드 또는 코드명 검색'} leftSection={<IconSearch size={15} />} autoFocus />
      <ScrollArea h={360} type="auto" scrollbarSize={6}>
        <Table className={`${codeClasses.codeTable} ${classes.pickerTable}`} highlightOnHover withTableBorder withColumnBorders>
          <Table.Thead><Table.Tr><Table.Th>{'코드'}</Table.Th><Table.Th>{'코드명'}</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>
            {visibleOptions.map((option) => <Table.Tr key={option.code} className={classes.customerResultRow} onClick={() => onSelect(option)}>
              <Table.Td>{option.code}</Table.Td><Table.Td>{option.name}</Table.Td>
            </Table.Tr>)}
            {!visibleOptions.length && <Table.Tr><Table.Td colSpan={2} className={classes.customerEmpty}>{'조회된 사용중 코드가 없습니다.'}</Table.Td></Table.Tr>}
          </Table.Tbody>
        </Table>
      </ScrollArea>
      <Group justify="space-between" align="center">
        <Text size="xs" c="dimmed">총 {filteredOptions.length.toLocaleString()}개 코드</Text>
        <Pagination size="sm" total={pageCount} value={page} onChange={setPage} withEdges color="red" />
      </Group>
    </Stack>
  </Modal>;
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

const DetailCells = memo(function DetailCells({ row, index, selected, disabled, managerEditable, saved, unitOptions, onSelect, onChange, onPaste, registerCodeInput, registerCellInput, onFindItem, onFindMaster, onFindCustomer, onFocusCell }) {
  const displayValue = (key) => {
    if (key === 'sourcetype') return row.sourcetype === 'OPENING' || row.stocksourcetype === 'OPENING' ? '기초' : row.sourcetype === 'INBOUND' || row.stocksourcetype === 'INBOUND' ? '입고' : '';
    if (key === 'stocksourceno') return row.stocksourceno || row.sourceno || '';
    if (key === 'stocksourceline') return row.stocksourceline ?? row.sourceline ?? '';
    if (key === 'sourcecustomname') return row.sourcecustomname || '';
    if (key === 'receiptdate') return String(row.receiptdate || '').slice(0, 10);
    if (key === 'qtyunit') return unitOptions.quantity.find((option) => option.code === row.qtyunit)?.name || row.qtyunit || '';
    if (key === 'unit') return unitOptions.price.find((option) => option.code === row.unit)?.name || row.unit || '';
    if (['current_qty', 'current_weight', 'thickness', 'width', 'length', 'myrtle', 'qty', 'weight', 'unitprice'].includes(key)) return formatNumericInput(row[key] ?? 0);
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
      <input type="checkbox" aria-label={`${row.itemcode || '출고 상세'} 선택`} checked={selected} disabled={disabled} onChange={(event) => onSelect(row.id, event.nativeEvent.shiftKey)} />
    </Table.Td>
    <Table.Td className={`${codeClasses.rowNumber} ${classes.rowNumberCell} ${saved ? classes.savedCell : ''}`}>{index + 1}</Table.Td>
    {DETAIL_FIELDS.map(({ key, label }) => (
      <Table.Td key={key} className={[saved && !(key === 'manager' && managerEditable) && classes.savedCell, key === 'manager' && managerEditable && inboundClasses.managerEditableCell].filter(Boolean).join(' ')}>
        {saved && key !== 'manager' ? (
          <span className={classes.savedCellText} title={String(displayValue(key))}>
            {key === 'supplyamt' ? formatAmount(amountOf(row, unitOptions.price))
              : key === 'vat' ? formatAmount(vatAmountOf(row, unitOptions.price))
                : key === 'unitamt' ? formatAmount(totalAmountOf(row, unitOptions.price))
                  : displayValue(key)}
          </span>
        ) : key === 'manager' ? (
          <ManagerInput key={`${row.id}:${row.manager || ''}`} row={row} editable={managerEditable} label={label} onChange={onChange} onPaste={pasteHandler(key)} registerCellInput={registerCellInput} onFocusCell={onFocusCell} />
        ) : key === 'customname' ? (
          <Group gap={2} wrap="nowrap">
            <input
              ref={(element) => registerCellInput(row.id, key, element)}
              className={`${codeClasses.cellInput} ${classes.autoFilledInput}`}
              aria-label={label}
              title="저장 전에 돋보기 버튼을 눌러 매출처를 변경할 수 있습니다."
              data-row-id={row.id}
              data-field={key}
              value={row.customname || ''}
              readOnly
              disabled={disabled}
              onFocus={() => onFocusCell(row.id, key)}
              onDoubleClick={() => onFindCustomer(row.id)}
            />
            <ActionIcon size="sm" variant="subtle" color="red" aria-label="매출처 찾기" title="저장 전에 매출처 변경" disabled={disabled} onClick={() => onFindCustomer(row.id)}>
              <IconSearch size={15} />
            </ActionIcon>
          </Group>
        ) : key === 'customcode' ? (
          <Group gap={2} wrap="nowrap">
            <input
              ref={(element) => registerCellInput(row.id, key, element)}
              className={codeClasses.cellInput}
              aria-label={label}
              title="매출처 찾기"
              data-row-id={row.id}
              data-field={key}
              value={row.customcode || ''}
              readOnly
              disabled={disabled}
              onFocus={() => onFocusCell(row.id, key)}
              onDoubleClick={() => onFindCustomer(row.id)}
            />
            <ActionIcon size="sm" variant="subtle" color="red" aria-label="매출처 찾기" disabled={disabled} onClick={() => onFindCustomer(row.id)}>
              <IconSearch size={15} />
            </ActionIcon>
          </Group>
        ) : ['supplyamt', 'vat', 'unitamt'].includes(key) ? (
          <input className={`${codeClasses.cellInput} ${classes.amountInput} ${classes.autoFilledInput}`} aria-label={label}
            value={formatAmount(key === 'supplyamt' ? amountOf(row, unitOptions.price) : key === 'vat' ? vatAmountOf(row, unitOptions.price) : totalAmountOf(row, unitOptions.price))} disabled />
        ) : (
          <input
            ref={(element) => {
              if (key === 'itemcode') registerCodeInput(row.id, element);
              registerCellInput(row.id, key, element);
            }}
            className={`${codeClasses.cellInput} ${key === 'manager' && managerEditable ? '' : classes.autoFilledInput} ${key === 'current_qty' || key === 'current_weight' || key === 'unit' ? classes.currentStockInput : ''} ${key === 'unit' ? classes.itemCodePickerInput : ''}`}
            aria-label={label}
            title={key === 'unit' ? `${label} - 더블클릭하여 마스터에서 선택` : undefined}
            data-row-id={row.id}
            data-field={key}
            type={key === 'receptdate' ? 'date' : 'text'}
            inputMode={NUMERIC_FIELDS.has(key) ? 'decimal' : undefined}
            value={displayValue(key)}
            placeholder={row.is_new && key !== 'description' && !READ_ONLY_DETAIL_FIELDS.has(key) ? label : ''}
            disabled={key === 'manager' ? !managerEditable : disabled || READ_ONLY_DETAIL_FIELDS.has(key) || key === 'unitprice' || key === 'unit'}
            onFocus={() => onFocusCell(row.id, key)}
            onDoubleClick={key === 'unit' ? () => onFindMaster(row.id, key) : undefined}
            onPaste={pasteHandler(key)}
            onChange={(event) => onChange(row.id, key, NUMERIC_FIELDS.has(key) ? cleanNumericInput(event.currentTarget.value) : event.currentTarget.value)}
          />
        )}
      </Table.Td>
    ))}

  </>;
});

const VirtualRow = ({ item, context, className, ...props }) => (
  <Table.Tr {...props} className={[className, item?.is_new && codeClasses.newRow, item?.is_new && classes.newRow, context?.selectedSet?.has(item?.id) && classes.selectedRow].filter(Boolean).join(' ')} />
);
const virtuosoComponents = {
  Table: ({ style, ...props }) => <Table {...props} className={`${sharedClasses.table} ${codeClasses.codeTable}`} highlightOnHover withTableBorder withColumnBorders verticalSpacing="xs" horizontalSpacing={0} style={{ ...style, width: '100%', tableLayout: 'fixed' }} />,
  TableHead: Table.Thead,
  TableBody: Table.Tbody,
  TableRow: VirtualRow,
};

export default function OutboundRegisterPage() {
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
  const [receiptMetadata, setReceiptMetadata] = useState({ companyid: '', companyname: '', created_at: '', updated_at: '' });
  const [rows, setRows] = useState([]);
  const [selectedReceiptno, setSelectedReceiptno] = useState('');
  const [subulyn, setSubulyn] = useState('N');
  const [documentDirty, setDocumentDirty] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [filterOpen, setFilterOpen] = useState(true);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [columnWidths, setColumnWidths] = useState({});
  const [receiptColumnWidths, setReceiptColumnWidths] = useState({});
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [customerPickerTargetId, setCustomerPickerTargetId] = useState('');
  const [stockPickerOpen, setStockPickerOpen] = useState(false);
  const [itemPickerTargetId, setItemPickerTargetId] = useState('');
  const [masterPickerTarget, setMasterPickerTarget] = useState(null);
  const [unitOptions, setUnitOptions] = useState({ price: [], quantity: [], warehouse: [] });
  const virtuosoRef = useRef(null);
  const detailScrollerRef = useRef(null);
  const initialReceiptLoadRef = useRef(false);
  const codeInputsRef = useRef(new Map());
  const cellInputsRef = useRef(new Map());
  const codeLookupTimersRef = useRef(new Map());
  const masterPasteErrorsRef = useRef(new Map());
  const activeCellRef = useRef(null);
  const pendingCellFocusRef = useRef(null);
  const pendingFocusIdRef = useRef('');
  const selectionAnchorRef = useRef('');
  const receiptTableRef = useRef(null);
  const receiptSubtotalRef = useRef(null);
  const receiptHorizontalScrollRef = useRef(null);
  const locked = isReceiptConfirmed(subulyn);
  const readOnly = Boolean(selectedReceiptno) || locked;
  const hasManagerChanges = useMemo(() => Boolean(selectedReceiptno) && rows.some((row) => row.manager_dirty), [selectedReceiptno, rows]);
  const hasNewDetails = useMemo(() => rows.some((row) => row.is_new), [rows]);
  const hasPendingChanges = useMemo(() => documentDirty || rows.some((row) => row.is_new || row.is_dirty), [documentDirty, rows]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const virtuosoContext = useMemo(() => ({ selectedSet }), [selectedSet]);
  const detailTotals = useMemo(() => rows.reduce((totals, row) => {
    const amount = Number(amountOf(row, unitOptions.price)) || 0;
    const vat = Number(vatAmountOf(row, unitOptions.price)) || 0;
    totals.weight += Number(cleanNumericInput(row.weight)) || 0;
    totals.amount += amount;
    totals.vat += vat;
    totals.total += amount + vat;
    return totals;
  }, { weight: 0, amount: 0, vat: 0, total: 0 }), [rows, unitOptions.price]);
  const receiptAutoWidths = useMemo(() => Object.fromEntries(RECEIPT_COLUMNS.map((column) => {
    const values = receipts.map((receipt) => receipt[column.key]);
    if (column.key === 'total_weight') {
      const subtotal = receipts.reduce((sum, receipt) => sum + Number(receipt.total_weight || 0), 0);
      values.push(subtotal.toLocaleString(undefined, { maximumFractionDigits: 3 }));
    } else if (['supply_amount', 'vat_amount', 'total_amount'].includes(column.key)) {
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

  const loadReceipts = useCallback(async (nextPage = page, nextFilters = filters, nextPageSize = pageSize) => {
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
        },
      });
      setReceipts(data.receipts || []);
      setTotal(data.total || 0);
      setPage(nextPage);
    } catch (error) {
      notifications.show({ title: '출고 목록 조회 실패', message: errorMessage(error), color: 'red' });
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, filters]);

  useEffect(() => {
    if (initialReceiptLoadRef.current) return;
    initialReceiptLoadRef.current = true;
    void loadReceipts(1, createDefaultReceiptFilters(), 15);
  }, [loadReceipts]);

  const loadUnitOptions = useCallback(async (groupcode) => {
    const items = [];
    let pageNumber = 1;
    let totalCount = 0;
    do {
      const { data } = await axios.get(`/api/code-master/groups/${groupcode}/items`, {
        ...authConfig(), params: { page: pageNumber, page_size: 200, include_total: true },
      });
      items.push(...(data.items || []));
      totalCount = data.total || 0;
      pageNumber += 1;
    } while (items.length < totalCount && pageNumber <= 100);
    return items.filter((item) => item.use).map((item) => ({ code: item.code, name: item.name }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadUnitOptions('PRICE_UNIT'), loadUnitOptions('QTY'), loadUnitOptions('WAREHOUSE')])
      .then(([price, quantity, warehouse]) => {
        if (!cancelled) setUnitOptions({ price, quantity, warehouse });
      })
      .catch((error) => {
        if (!cancelled) notifications.show({ title: '단위 코드 조회 실패', message: errorMessage(error), color: 'red' });
      });
    return () => { cancelled = true; };
  }, [loadUnitOptions]);


  const openCustomerPicker = useCallback((rowId) => {
    if (!readOnly && !saving) {
      setCustomerPickerTargetId(rowId);
      setCustomerPickerOpen(true);
    }
  }, [readOnly, saving]);

  const selectCustomer = useCallback((customer) => {
    if (!customerPickerTargetId) return;
    setRows((current) => current.map((row) => row.id === customerPickerTargetId
      ? { ...row, customcode: customer.customercode || '', customname: customer.customername || '', is_dirty: !row.is_new }
      : row));
    setDocumentDirty(true);
    setCustomerPickerOpen(false);
    setCustomerPickerTargetId('');
  }, [customerPickerTargetId]);

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
      notifications.show({ title: '저장되지 않은 변경사항', message: '현재 출고 내용을 먼저 저장해 주세요.', color: 'orange' });
      return false;
    }
    setDetailLoading(true);
    try {
      const { data } = await axios.get(`/api/outbound-register/receipts/${encodeURIComponent(receiptno)}`, authConfig());
      const receipt = data.receipt;
      const loadedRows = (receipt.items || []).map((item) => makeDetail({
        ...item,
        sourcetype: item.stocksourcetype || '',
      }, item.lineno));
      setHeader({
        receiptno: receipt.receiptno || '',
        receptdate: String(receipt.receptdate || '').slice(0, 10),
        customcode: receipt.customcode || '',
        customname: receipt.customname || '',
        description: receipt.description || '',
      });
      setReceiptMetadata({
        companyid: receipt.companyid || '',
        companyname: receipt.companyname || '',
        created_at: receipt.created_at || '',
        updated_at: receipt.updated_at || '',
      });
      setRows(loadedRows);
      setSelectedReceiptno(receipt.receiptno);
      setSubulyn(receipt.subulyn || 'N');
      setDocumentDirty(false);
      setSelectedIds([]);
      selectionAnchorRef.current = '';
      return true;
    } catch (error) {
      notifications.show({ title: '출고 상세 조회 실패', message: errorMessage(error), color: 'red' });
      return false;
    } finally {
      setDetailLoading(false);
    }
  }, [hasPendingChanges]);

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

  const registerCellInput = useCallback((id, field, element) => {
    const key = `${id}:${field}`;
    if (element) {
      cellInputsRef.current.set(key, element);
      if (pendingCellFocusRef.current?.key === key) {
        element.focus();
        pendingCellFocusRef.current = null;
      }
    } else cellInputsRef.current.delete(key);
  }, []);

  const changeDetail = useCallback((id, key, value) => {
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
    activeCellRef.current = { id, field };
  }, []);

  const fillDown = useCallback(() => {
    const activeCell = activeCellRef.current;
    if (!activeCell || readOnly || saving || !selectedIds.length) return;
    const field = activeCell.field;
    if (field === 'itemname' || field === 'warehousecodename' || field === 'unitamt') return;
    const sourceIndex = rows.findIndex((row) => row.id === activeCell.id);
    if (sourceIndex < 0) return;
    const sourceValue = rows[sourceIndex][field] ?? '';
    const targetRows = rows.filter((row, index) => index > sourceIndex && selectedSet.has(row.id));
    if (!targetRows.length) return;

    let value = sourceValue;
    let warehouseName = '';
    if (field === 'warehousecode') {
      value = resolveMasterCode('warehouse', sourceValue, unitOptions) || sourceValue;
      warehouseName = unitOptions.warehouse.find((option) => option.code === value)?.name || '';
    } else if (field === 'qtyunit' || field === 'unit') {
      value = resolveMasterCode(field, sourceValue, unitOptions) || sourceValue;
    }

    const targetIds = new Set(targetRows.map((row) => row.id));
    targetRows.forEach((row) => {
      if (field === 'unit' || field === 'qtyunit') masterPasteErrorsRef.current.delete(masterPasteErrorKey(row.id, field));
      if (field === 'warehousecode') masterPasteErrorsRef.current.delete(masterPasteErrorKey(row.id, 'warehouse'));
    });
    setRows((current) => current.map((row) => {
      if (!targetIds.has(row.id)) return row;
      const updated = field === 'warehousecode'
        ? { ...row, warehousecode: value, warehousecodename: warehouseName }
        : { ...row, [field]: value };
      return { ...updated, is_dirty: !updated.is_new };
    }));
    setDocumentDirty(true);
    notifications.show({
      title: '아래로 채우기 완료',
      message: `${targetRows.length.toLocaleString()}개 행에 현재 셀의 값을 복사했습니다.`,
      color: 'teal',
    });
  }, [readOnly, saving, selectedIds.length, rows, selectedSet, unitOptions]);

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

  const handleTableKeyDown = useCallback((event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      fillDown();
      return;
    }
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
  }, [fillDown, moveGridCell]);

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
      notifications.show({ title: '저장되지 않은 변경사항', message: '기존 전표의 변경사항을 먼저 저장하거나 취소한 뒤 새 출고를 시작해 주세요.', color: 'orange' });
      return;
    }
    if (selectedReceiptno) {
      setHeader({ ...EMPTY_HEADER, receptdate: localDate() });
      setReceiptMetadata({ companyid: '', companyname: '', created_at: '', updated_at: '' });
      setRows([]);
      setSelectedReceiptno('');
      setSubulyn('N');
      setDocumentDirty(false);
      setSelectedIds([]);
      selectionAnchorRef.current = '';
    }
    setStockPickerOpen(true);
  }, [saving, selectedReceiptno, hasPendingChanges]);

  const applyAvailableStocks = useCallback((stocks) => {
    const addedRows = stocks.map((stock) => makeDetail({
      ...stock,
      stocksourcetype: stock.sourcetype,
      stocksourceno: stock.sourceno,
      stocksourceline: stock.sourceline,
      sourcecustomname: stock.customname || '',
      current_qty: String(stock.available_qty ?? 0),
      current_weight: String(stock.available_weight ?? 0),
      qtyunit: stock.qtyunit || '',
      warehousecode: stock.warehousecode || '',
      warehousecodename: stock.warehousecodename || '',
      unit: stock.unit || unitOptions.price[0]?.code || '',
      unitprice: String(stock.unitprice ?? ''),
    }));
    if (!addedRows.length) return;
    setRows((current) => [...current, ...addedRows]);
    setSelectedIds(addedRows.map((row) => row.id));
    setDocumentDirty(true);
    setStockPickerOpen(false);
    selectionAnchorRef.current = '';
    requestAnimationFrame(() => {
      virtuosoRef.current?.scrollToIndex({ index: rows.length + addedRows.length - 1, align: 'end', behavior: 'auto' });
      if (detailScrollerRef.current) detailScrollerRef.current.scrollTop = detailScrollerRef.current.scrollHeight;
    });
  }, [rows.length, unitOptions.price]);

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
      notifications.show({ title: '출고 재고 행 확인', message: '엑셀 붙여넣기는 재고조회에서 추가한 행에만 적용할 수 있습니다.', color: 'orange' });
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
          } else if (key && key !== 'itemname' && key !== 'unitamt') target[key] = NUMERIC_FIELDS.has(key) ? cleanNumericInput(value) : value;
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

  const validateDocument = useCallback(() => {
    const missing = [];
    if (selectedReceiptno && !header.receiptno.trim()) missing.push('출고전표번호');
    if (!rows.length) missing.push('상세 품목');
    if (missing.length) {
      notifications.show({ title: '필수 항목을 입력해 주세요', message: missing.join(', '), color: 'orange' });
      return false;
    }
    const failures = rows.flatMap((row, index) => {
      const errors = [];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(row.receptdate || ''))) errors.push('출고일자(YYYY-MM-DD)');
      if (!String(row.customcode || '').trim() && !String(row.customname || '').trim()) errors.push('매출처명');
      if (!String(row.stocksourcetype || '').trim() || !String(row.stocksourceno || '').trim() || !String(row.stocksourceline ?? '').trim()) errors.push('원천 재고 라인');
      if (!String(row.unit || '').trim()) errors.push('단가기준');
      const qtyText = String(row.qty ?? '').trim();
      const qty = Number(qtyText);
      if (!qtyText || !Number.isFinite(qty) || qty <= 0) errors.push('수량(0 초과)');
      const weight = Number(row.weight);
      if (!String(row.weight || '').trim() || !Number.isFinite(weight) || weight <= 0) errors.push('출고중량(0 초과)');
      const unitprice = Number(row.unitprice);
      if (!String(row.unitprice || '').trim() || !Number.isFinite(unitprice) || unitprice < 0) errors.push('판매단가(0 이상)');
      return errors.length ? [`${index + 1}행 ${errors.join(', ')}`] : [];
    });
    if (failures.length) {
      notifications.show({ title: '상세 입력을 확인해 주세요', message: failures.slice(0, 5).join(' / '), color: 'orange', autoClose: 8000 });
      return false;
    }
    return true;
  }, [header, rows, selectedReceiptno]);

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
    if (selectedReceiptno && hasManagerChanges && !hasNewDetails && !locked) {
      const managerItems = rows
        .filter((row) => row.manager_dirty)
        .map((row) => ({ lineno: row.lineno, manager: String(row.manager || '').trim() }));
      setSaving(true);
      try {
        const { data } = await axios.patch(
          `/api/outbound-register/receipts/${encodeURIComponent(selectedReceiptno)}/manager`,
          { items: managerItems },
          authConfig(),
        );
        await openReceipt(selectedReceiptno, true);
        notifications.show({
          title: '담당자 수정 완료',
          message: `${data.updated_count}행 담당자를 출고상세와 재고수불현황에 반영했습니다.`,
          color: 'teal',
        });
        return true;
      } catch (error) {
        notifications.show({ title: '담당자 수정 실패', message: errorMessage(error), color: 'red', autoClose: 9000 });
        return false;
      } finally {
        setSaving(false);
      }
    }
    if (locked) {
      notifications.show({ title: '수불 확정 전표', message: '수불 확정된 출고전표는 수정할 수 없습니다.', color: 'orange' });
      return false;
    }
    if (selectedReceiptno && !hasPendingChanges) {
      notifications.show({ title: '저장할 변경사항이 없습니다', message: '현재고 조회에서 출고할 재고를 추가한 뒤 저장해 주세요.', color: 'orange' });
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
        receptdate: sourceRows[0]?.receptdate || sourceHeader.receptdate,
        customcode: String(sourceHeader.customcode || sourceRows[0]?.customcode || '').trim(),
        customname: String(sourceHeader.customname || sourceRows[0]?.customname || '').trim(),
        is_new: !selectedReceiptno,
        items: sourceRows.map((row) => ({
          stocksourcetype: String(row.stocksourcetype || '').trim(),
          stocksourceno: String(row.stocksourceno || '').trim(),
          stocksourceline: Number(row.stocksourceline),
          receptdate: String(row.receptdate || '').trim(),
          customcode: String(row.customcode || '').trim(),
          customname: String(row.customname || '').trim(),
          warehousecode: String(row.warehousecode || '').trim(),
          warehousecodename: String(row.warehousecodename || '').trim(),
          unit: resolveMasterCode('unit', row.unit, unitOptions) || String(row.unit || '').trim(),
          qty: String(row.qty ?? '').trim(),
          weight: String(row.weight || '').trim(), unitprice: String(row.unitprice || '').trim(),
          description: String(row.description || '').trim(),
        })),
      };
      const saveRequest = selectedReceiptno
        ? axios.put('/api/outbound-register/receipts', payload, authConfig())
        : axios.post('/api/outbound-register/receipts', payload, authConfig());
      const { data } = await saveRequest;
      masterPasteErrorsRef.current.clear();
      notifications.show({
        title: '출고 저장 완료',
        message: data.group_count > 1
          ? `${data.group_count}개 출고전표 등록 완료 (${(data.receipt_numbers || []).join(', ')}) / 상세 ${data.saved_count}건`
          : `${data.receiptno} 전표의 상세 ${data.saved_count}건을 저장했습니다.`,
        color: 'teal',
      });
      const defaultFilters = createDefaultReceiptFilters();
      setFilters(defaultFilters);
      setFilterInputs(defaultFilters);
      await loadReceipts(1, defaultFilters);
      await openReceipt(data.receiptno, true);
      return true;
    } catch (error) {
      notifications.show({ title: '출고 저장 실패', message: errorMessage(error), color: 'red', autoClose: 9000 });
      return false;
    } finally {
      setSaving(false);
    }
  }, [locked, selectedReceiptno, hasManagerChanges, hasNewDetails, hasPendingChanges, rows, header, unitOptions, validateDetailMasters, validateDocument, loadReceipts, openReceipt]);

  const exportDocument = useCallback(() => {
    if (!header.receiptno || !rows.length) {
      notifications.show({ title: '다운로드할 출고전표 없음', message: '먼저 저장된 출고전표를 선택해 주세요.', color: 'orange' });
      return;
    }
    setExporting(true);
    try {
      const workbook = XLSX.utils.book_new();
      const exportFields = [
        ['회사코드', () => receiptMetadata.companyid],
        ['회사명', () => receiptMetadata.companyname],
        ['출고전표번호', () => header.receiptno],
        ['출고일자', () => rows[0]?.receptdate || header.receptdate],
        ['전표 비고', () => header.description],
        ['수불확정여부', () => subulyn],
        ['전표 등록일자', () => receiptMetadata.created_at],
        ['전표 수정일자', () => receiptMetadata.updated_at],
        ['순번', (row) => row.lineno],
        ...DETAIL_FIELDS.filter(({ key }) => !['current_qty', 'current_weight'].includes(key)).map(({ key, label }) => [
          `상세 ${label}`,
            (row) => key === 'supplyamt' ? amountOf(row, unitOptions.price)
              : key === 'vat' ? vatAmountOf(row, unitOptions.price)
                : key === 'unitamt' ? totalAmountOf(row, unitOptions.price) : row[key] ?? '',
        ]),
        ['상세 등록일자', (row) => formatExcelDateTime(row.created_at)],
        ['상세 수정일자', (row) => formatExcelDateTime(row.updated_at)],
      ];
      const worksheet = XLSX.utils.aoa_to_sheet([
        exportFields.map(([label]) => label),
        ...rows.map((row) => exportFields.map(([, getValue]) => getValue(row))),
      ]);
      applyExcelHeaderStyle(worksheet, exportFields.length);
      worksheet['!cols'] = exportFields.map(([label]) => ({ wch: Math.min(28, Math.max(14, String(label).length + 4)) }));
      worksheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: exportFields.length - 1 } }) };
      XLSX.utils.book_append_sheet(workbook, worksheet, '출고내역');
      const safeFilePart = (value) => {
        const invalidCharacters = '<>:"/\\|?*';
        const safePart = [...String(value || '').trim()]
          .map((character) => character.charCodeAt(0) < 32 || invalidCharacters.includes(character) ? '_' : character)
          .join('')
          .replace(/\s+/g, '_');
        return safePart || '미입력';
      };
      XLSX.writeFile(workbook, `출고전표_${safeFilePart(rows[0]?.customname || rows[0]?.customcode)}_${safeFilePart(rows[0]?.receptdate || header.receptdate)}_${safeFilePart(header.receiptno)}.xlsx`);
    } finally { setExporting(false); }
  }, [header, receiptMetadata, rows, subulyn, unitOptions.price]);

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
    notifications.show({ title: '선택 행 제거 완료', message: `저장 전 재고 ${removedCount}행을 출고 상세에서 제거했습니다.`, color: 'teal' });
  }, [saving, selectedIds, rows]);

  const requestToolbarDelete = useCallback(() => {
    if (!selectedReceiptno) {
      if (selectedIds.length) {
        removeSelectedDraftDetails();
        return;
      }
      notifications.show({ title: '삭제할 행을 선택해 주세요', message: '저장 전에는 출고 상세에서 삭제할 행을 선택한 뒤 최상단 삭제를 눌러 주세요.', color: 'orange' });
      return;
    }
    if (hasPendingChanges) {
      notifications.show({ title: '저장되지 않은 변경사항', message: '삭제 전에 현재 변경사항을 먼저 정리해 주세요.', color: 'orange' });
      return;
    }
    setDeleteOpen(true);
  }, [selectedReceiptno, selectedIds.length, removeSelectedDraftDetails, hasPendingChanges]);

  useEffect(() => {
    if (!registerPageRibbon) return undefined;
    registerPageRibbon(
      <Group className={inboundClasses.commandRibbon} justify="flex-start" wrap="nowrap" gap={2}>
        <Button className={inboundClasses.ribbonTool} variant="subtle" size="sm" leftSection={<IconSearch size={15} />} onClick={runSearch} loading={loading}>조회</Button>
        <span className={inboundClasses.ribbonSeparator} />
        <Button className={inboundClasses.ribbonTool} variant="subtle" size="sm" leftSection={<IconPlus size={15} />} onClick={addDetail} disabled={saving}>&#xCD94;&#xAC00;</Button>
        <Button className={inboundClasses.ribbonTool} variant="subtle" size="sm" leftSection={<IconCopy size={15} />} onClick={copySelectedDetails} disabled>복사</Button>
        <Button className={inboundClasses.ribbonTool} variant="subtle" size="sm" leftSection={<IconFileSpreadsheet size={15} />} onClick={exportDocument} loading={exporting} disabled={!selectedReceiptno || loading || detailLoading || !rows.length}>엑셀</Button>
        <Button className={inboundClasses.ribbonTool} variant="subtle" size="sm" leftSection={<IconDeviceFloppy size={15} />} onClick={() => saveDocument()} loading={saving} disabled={selectedReceiptno ? (locked || detailLoading || !(hasManagerChanges || hasPendingChanges)) : (readOnly || detailLoading)}>저장</Button>
        <Button className={inboundClasses.ribbonTool} variant="subtle" size="sm" leftSection={<IconTrash size={15} />} onClick={requestToolbarDelete} disabled={saving || (selectedReceiptno ? locked : !selectedIds.length)}>삭제</Button>
        <span className={inboundClasses.ribbonSeparator} />
        <Button className={inboundClasses.ribbonTool} variant="subtle" size="sm" leftSection={<IconX size={15} />} onClick={closeActivePage}>닫기</Button>
      </Group>,
    );
    return () => registerPageRibbon(null);
  }, [registerPageRibbon, closeActivePage, runSearch, loading, addDetail, copySelectedDetails, readOnly, saving, selectedIds.length, exportDocument, exporting, selectedReceiptno, rows.length, detailLoading, saveDocument, requestToolbarDelete, locked, hasManagerChanges, hasPendingChanges]);


  const requestDeleteReceipt = useCallback(async () => {
    if (!selectedReceiptno || locked) return;
    setSaving(true);
    try {
      await axios.delete(`/api/outbound-register/receipts/${encodeURIComponent(selectedReceiptno)}`, authConfig());
      notifications.show({ title: '출고 삭제 완료', message: `${selectedReceiptno} 전표를 삭제했습니다.`, color: 'teal' });
      setDeleteOpen(false);
      setHeader({ ...EMPTY_HEADER, receptdate: localDate() });
      setReceiptMetadata({ companyid: '', companyname: '', created_at: '', updated_at: '' });
      setRows([]); setSelectedReceiptno(''); setSubulyn('N'); setDocumentDirty(false);
      await loadReceipts(page, filters);
    } catch (error) {
      notifications.show({ title: '출고 삭제 실패', message: errorMessage(error), color: 'red' });
    } finally { setSaving(false); }
  }, [selectedReceiptno, locked, loadReceipts, page, filters]);

  const rowContent = useCallback((index, row) => (
    <DetailCells row={row} index={index} selected={selectedSet.has(row.id)} disabled={saving || locked || (Boolean(selectedReceiptno) && !row.is_new)} managerEditable={Boolean(selectedReceiptno) && !locked && !saving && !hasNewDetails} saved={locked || (Boolean(selectedReceiptno) && !row.is_new)} unitOptions={unitOptions}
      onSelect={toggleSelection} onChange={changeDetail} onPaste={pasteRange}
      registerCodeInput={registerCodeInput} registerCellInput={registerCellInput} onFindItem={setItemPickerTargetId}
      onFindMaster={openMasterPicker} onFindCustomer={openCustomerPicker} onFocusCell={setActiveCell} />
  ), [selectedSet, saving, selectedReceiptno, locked, hasNewDetails, unitOptions, toggleSelection, changeDetail, pasteRange, registerCodeInput, registerCellInput, openMasterPicker, openCustomerPicker, setActiveCell]);

  const headerColumns = [
    { key: 'select', width: 44, minWidth: 42, className: codeClasses.checkCol, label: <input type="checkbox" aria-label="상세 전체 선택" checked={rows.length > 0 && selectedIds.length === rows.length} onChange={(event) => toggleAll(event.currentTarget.checked)} /> },
    { key: 'number', width: 58, minWidth: 48, className: codeClasses.numberCol, label: 'No.' },
    ...DETAIL_FIELDS.map(({ key, label, width, required }) => ({ key, width, minWidth: 70, label: <>{label}{required && <span className={codeClasses.required}> *</span>}</> })),
  ];
  const tableWidth = headerColumns.reduce((sum, column) => sum + (columnWidths[column.key] ?? column.width), 0);
  const receiptTableWidth = RECEIPT_COLUMNS.reduce((sum, column) => sum + (receiptColumnWidths[column.key] ?? receiptAutoWidths[column.key] ?? column.width), 0);
  const receiptTotals = receipts.reduce((totals, receipt) => {
    for (const key of ['line_count', 'total_qty', 'total_weight', 'supply_amount', 'vat_amount', 'total_amount']) {
      totals[key] += Number(receipt[key] || 0);
    }
    return totals;
  }, { line_count: 0, total_qty: 0, total_weight: 0, supply_amount: 0, vat_amount: 0, total_amount: 0 });
  const syncReceiptScroll = (left) => {
    for (const element of [receiptTableRef.current, receiptSubtotalRef.current]) {
      if (element && Math.abs(element.scrollLeft - left) > 0.5) element.scrollLeft = left;
    }
  };
  const renderReceiptHeader = (column) => (
    <Table.Th key={column.key} className={codeClasses.resizableHeader} ta={column.align} style={{ width: receiptColumnWidths[column.key] ?? receiptAutoWidths[column.key] ?? column.width }}>
      <span style={{ whiteSpace: 'nowrap' }}>{column.label}</span>
      <span className={codeClasses.columnResizeHandle} onPointerDown={(event) => resizeReceiptColumn(event, column.key, column.width, column.minWidth)} role="separator" aria-label={`${column.label} 열 너비 조절`} />
    </Table.Th>
  );
  const renderHeader = (column) => (
    <Table.Th key={column.key} className={[codeClasses.resizableHeader, column.className].filter(Boolean).join(' ')} style={{ width: columnWidths[column.key] ?? column.width }}>
      {column.label}<span className={codeClasses.columnResizeHandle} onPointerDown={(event) => resizeColumn(event, column.key, column.width, column.minWidth, tableWidth)} role="separator" aria-label={`${column.key} 열 너비 조절`} />
    </Table.Th>
  );

  return (
    <Box className={`${sharedClasses.pageShell} ${classes.page}`}>
      <Box component="nav" aria-label="현재 위치" className={inboundClasses.pageBreadcrumb}>
        <Group className={inboundClasses.breadcrumbTrail} gap={7}>
          <Text component="span" className={inboundClasses.breadcrumbParent}>출고관리</Text>
          <Text component="span" className={inboundClasses.breadcrumbChevron}>›</Text>
          <Text component="span" className={inboundClasses.breadcrumbCurrent}>출고등록</Text>
        </Group>
        {!filterOpen && (
          <Button className={inboundClasses.receiptFilterToggle} variant="subtle" size="xs"
            leftSection={<IconFilter size={15} />} onClick={() => setFilterOpen(true)}>
            조회조건
          </Button>
        )}
      </Box>

      <Box className={`${inboundClasses.inboundWorkspace} ${classes.outboundWorkspace}`}>
        <Box className={`${inboundClasses.inboundPrimaryColumn} ${classes.outboundPrimaryColumn}`}>
          <Paper className={`${sharedClasses.panel} ${inboundClasses.topReceiptPanel}`} withBorder>
            <Group className={inboundClasses.topReceiptToolbar} justify="space-between" wrap="wrap">
              <Group gap={8}><Text className={inboundClasses.sectionTitle} fw={700}>출고 기본</Text><Badge color="gray" variant="light">{total.toLocaleString()}건</Badge></Group>
            </Group>
            <Box ref={receiptTableRef} className={inboundClasses.topReceiptTable}>
              <Table className={inboundClasses.receiptFinderTable} stickyHeader highlightOnHover withTableBorder withColumnBorders
                style={{ width: `${receiptTableWidth}px`, minWidth: `${receiptTableWidth}px`, tableLayout: 'fixed' }}>
                <colgroup>{RECEIPT_COLUMNS.map((column) => <col key={column.key} data-column-key={column.key} style={{ width: `${receiptColumnWidths[column.key] ?? receiptAutoWidths[column.key] ?? column.width}px` }} />)}</colgroup>
                <Table.Thead><Table.Tr>{RECEIPT_COLUMNS.map(renderReceiptHeader)}</Table.Tr></Table.Thead>
                <Table.Tbody>
                  {receipts.map((receipt) => <Table.Tr key={receipt.receiptno}
                    className={`${classes.receiptFinderRow} ${selectedReceiptno === receipt.receiptno ? classes.receiptFinderRowActive : ''}`}
                    onClick={() => { void openReceipt(receipt.receiptno, true); }}>
                    <Table.Td>{String(receipt.receptdate || '').slice(0, 10)}</Table.Td>
                    <Table.Td>{receipt.customname || ''}</Table.Td>
                    <Table.Td>{receipt.warehousecodename || ''}</Table.Td>
                    <Table.Td ta="right">{Number(receipt.line_count || 0).toLocaleString()}</Table.Td>
                    <Table.Td ta="right">{Number(receipt.total_qty || 0).toLocaleString(undefined, { maximumFractionDigits: 3 })}</Table.Td>
                    <Table.Td ta="right">{Number(receipt.total_weight || 0).toLocaleString(undefined, { maximumFractionDigits: 3 })}</Table.Td>
                    <Table.Td ta="right">{formatAmount(String(receipt.supply_amount ?? 0))}</Table.Td>
                    <Table.Td ta="right">{formatAmount(String(receipt.vat_amount ?? 0))}</Table.Td>
                    <Table.Td ta="right" className={classes.receiptFinderAmount}>{formatAmount(String(receipt.total_amount ?? 0))}</Table.Td>
                    <Table.Td>{receipt.qtyunit || ''}</Table.Td>
                    <Table.Td>{receipt.unit || ''}</Table.Td>
                    <Table.Td>{receipt.receiptno}</Table.Td>
                    <Table.Td>{receipt.description || ''}</Table.Td>
                  </Table.Tr>)}
                </Table.Tbody>
              </Table>
              {!receipts.length && <Box className={inboundClasses.topReceiptEmptyMessage}>{loading ? '조회 중입니다.' : '검색된 출고전표가 없습니다.'}</Box>}
            </Box>
            <Box className={inboundClasses.topReceiptBottom}>
              {!!receipts.length && <Box ref={receiptSubtotalRef} className={inboundClasses.topReceiptSubtotalViewport}>
              <Table className={`${inboundClasses.receiptFinderTable} ${inboundClasses.receiptSubtotalTable}`} withTableBorder withColumnBorders
                style={{ width: `${receiptTableWidth}px`, minWidth: `${receiptTableWidth}px`, tableLayout: 'fixed' }}>
                <colgroup>{RECEIPT_COLUMNS.map((column) => <col key={column.key} data-column-key={column.key} style={{ width: `${receiptColumnWidths[column.key] ?? receiptAutoWidths[column.key] ?? column.width}px` }} />)}</colgroup>
                <Table.Tbody><Table.Tr>
                  {RECEIPT_COLUMNS.map((column, index) => <Table.Td key={column.key} className={`${inboundClasses.topReceiptSubtotalCell} ${column.align === 'right' ? inboundClasses.topReceiptSubtotalNumber : ''}`} ta={column.align}>
                    {index === 0 ? '소계' : column.key === 'line_count' ? receiptTotals.line_count.toLocaleString()
                      : column.key === 'total_qty' ? receiptTotals.total_qty.toLocaleString(undefined, { maximumFractionDigits: 3 })
                      : column.key === 'total_weight' ? receiptTotals.total_weight.toLocaleString(undefined, { maximumFractionDigits: 3 })
                          : ['supply_amount', 'vat_amount', 'total_amount'].includes(column.key) ? formatWon(String(receiptTotals[column.key])) : ''}
                  </Table.Td>)}
                </Table.Tr></Table.Tbody>
              </Table>
              </Box>}
              <Box ref={receiptHorizontalScrollRef} className={inboundClasses.topReceiptHorizontalScroll} onScroll={(event) => syncReceiptScroll(event.currentTarget.scrollLeft)} aria-label="출고 기본 가로 스크롤">
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
          </Paper>

      <Box className={classes.workspace}>
        <Paper className={`${sharedClasses.panel} ${codeClasses.codePanel} ${classes.editorPanel}`} withBorder>
          <Group className={codeClasses.codeHeader} justify="space-between" align="center" wrap="wrap" gap="sm">
            <Group gap={9} align="center">
              <Text className={inboundClasses.sectionTitle} fw={700}>출고 상세</Text>
              <Badge color="gray" variant="light">{rows.length.toLocaleString()}행</Badge>
              {selectedReceiptno && <Badge color="gray" variant="light">{selectedReceiptno}</Badge>}
            </Group>
            <Group gap={8} align="center">
              {selectedReceiptno && <Badge color={locked ? 'green' : 'gray'} variant="light">{locked ? '수불 확정' : '저장됨 · 수정 가능'}</Badge>}
              {selectedIds.length > 0 && <Badge color="gray" variant="light">{selectedIds.length}개 선택</Badge>}
            </Group>
          </Group>

          <Box ref={detailScrollerRef} className={`${codeClasses.tableWrap} ${(rows.length <= 100 || (selectedReceiptno && rows.length <= 200)) ? classes.savedDetailScroller : ''} ${!detailLoading && !rows.length ? inboundClasses.emptyDetailWrap : ''}`} style={{ '--code-table-min-width': `${Math.max(1120, tableWidth)}px` }} onKeyDown={handleTableKeyDown}>
            {detailLoading ? <Box className={classes.receiptLoading}><Loader size="sm" color="red" /></Box> : rows.length ? (
              (rows.length <= 100 || (selectedReceiptno && rows.length <= 200)) ? <>
                <Table className={`${sharedClasses.table} ${codeClasses.codeTable}`} highlightOnHover withTableBorder withColumnBorders verticalSpacing="xs" horizontalSpacing={0}
                  style={{ width: '100%', minWidth: 'var(--code-table-min-width)', tableLayout: 'fixed' }}>
                  <Table.Thead><Table.Tr>{headerColumns.map(renderHeader)}</Table.Tr></Table.Thead>
                  <Table.Tbody>{rows.map((row, index) => <Table.Tr key={row.id} className={[row.is_new && classes.newRow, selectedSet.has(row.id) && classes.selectedRow].filter(Boolean).join(' ')}>{rowContent(index, row)}</Table.Tr>)}</Table.Tbody>
                </Table>
              </> : <TableVirtuoso ref={virtuosoRef} data={rows} context={virtuosoContext} style={{ height: '100%' }} components={virtuosoComponents} computeItemKey={(_index, row) => row.id} increaseViewportBy={{ top: 84, bottom: 84 }} fixedHeaderContent={() => <Table.Tr>{headerColumns.map(renderHeader)}</Table.Tr>} itemContent={rowContent} />
            ) : (
              <Table className={`${sharedClasses.table} ${codeClasses.codeTable}`} highlightOnHover withTableBorder withColumnBorders verticalSpacing="xs" horizontalSpacing={0}
                style={{ width: '100%', minWidth: 'var(--code-table-min-width)', tableLayout: 'fixed' }}>
                <Table.Thead><Table.Tr>{headerColumns.map(renderHeader)}</Table.Tr></Table.Thead>
              </Table>
            )}
            {!detailLoading && !rows.length && (
              <Box className={inboundClasses.emptyDetailMessage}>
                {selectedReceiptno ? '출고 상세가 없습니다.' : '조회조건의 재고조회에서 출고할 재고를 선택하세요.'}
              </Box>
            )}
          </Box>
          <Group className={`${sharedClasses.footer} ${codeClasses.tableFooter}`} justify="flex-end" wrap="wrap">
            <Group gap={16} wrap="wrap" justify="flex-end">
              <Text size="xs" fw={700}>합계 중량 {detailTotals.weight.toLocaleString(undefined, { maximumFractionDigits: 3 })} kg</Text>
              <Text size="xs" fw={700}>
                공급가 {formatWon(detailTotals.amount.toFixed(2))}
                {' · '}부가세 {formatWon(detailTotals.vat.toFixed(2))}
                {' · '}합계 {formatWon(detailTotals.total.toFixed(2))}
              </Text>
            </Group>
          </Group>
        </Paper>
      </Box>
        </Box>
        {filterOpen && <Paper component="aside" className={`${inboundClasses.receiptFilterSidebar} ${classes.outboundFilterSidebar}`} withBorder>
          <Group className={inboundClasses.receiptFilterHeader} justify="space-between" align="center">
            <Text fw={700}>조회조건</Text>
            <ActionIcon variant="subtle" color="gray" aria-label="조회조건 닫기" onClick={() => setFilterOpen(false)}><IconX size={16} /></ActionIcon>
          </Group>
          <Stack gap="sm" className={inboundClasses.receiptFilterFields}>
            <Box>
              <Text size="xs" fw={700} mb={5}>출고기간</Text>
              <Stack gap={6}>
                <TextInput type="date" aria-label="출고기간 시작일" value={filterInputs.date_from}
                  onChange={(event) => setFilterInputs((current) => ({ ...current, date_from: event.currentTarget.value }))}
                  onKeyDown={(event) => { if (event.key === 'Enter') runSearch(); }} />
                <TextInput type="date" aria-label="출고기간 종료일" value={filterInputs.date_to}
                  onChange={(event) => setFilterInputs((current) => ({ ...current, date_to: event.currentTarget.value }))}
                  onKeyDown={(event) => { if (event.key === 'Enter') runSearch(); }} />
              </Stack>
            </Box>
            <TextInput label="매출처" placeholder="매출처코드 또는 매출처명" value={filterInputs.customer}
              onChange={(event) => setFilterInputs((current) => ({ ...current, customer: event.currentTarget.value }))}
              onKeyDown={(event) => { if (event.key === 'Enter') runSearch(); }} />
            <TextInput label="출고전표번호" placeholder="전표번호" value={filterInputs.receiptno}
              onChange={(event) => setFilterInputs((current) => ({ ...current, receiptno: event.currentTarget.value }))}
              onKeyDown={(event) => { if (event.key === 'Enter') runSearch(); }} />
            <TextInput label="창고" placeholder="창고코드 또는 창고명" value={filterInputs.warehouse}
              onChange={(event) => setFilterInputs((current) => ({ ...current, warehouse: event.currentTarget.value }))}
              onKeyDown={(event) => { if (event.key === 'Enter') runSearch(); }} />
          </Stack>
          <Box className={classes.outboundStockLookup}>
            <Text fw={700} size="sm">재고조회</Text>
            <Text size="xs" c="dimmed">기초재고와 입고재고에서 출고할 원천 행을 선택합니다.</Text>
            <Button fullWidth color="red" leftSection={<IconSearch size={15} />} onClick={addDetail} disabled={saving}>
              현재고 조회
            </Button>
          </Box>
        </Paper>}
      </Box>




      <Modal opened={deleteOpen} onClose={() => !saving && setDeleteOpen(false)} title="출고전표 삭제" centered size="sm">
        <Stack gap="md">
          <Text size="sm" c="dimmed">{selectedReceiptno} 전표와 상세 내역을 삭제합니다. 삭제한 전표는 복구할 수 없습니다.</Text>
          <Group justify="flex-end"><Button variant="default" onClick={() => setDeleteOpen(false)} disabled={saving}>취소</Button><Button color="red" leftSection={<IconTrash size={15} />} onClick={requestDeleteReceipt} loading={saving}>삭제</Button></Group>
        </Stack>
      </Modal>


      <CustomerPickerModal opened={customerPickerOpen} onClose={() => { setCustomerPickerOpen(false); setCustomerPickerTargetId('' ); }} onSelect={selectCustomer} />
      <OutboundStockPickerModal
        opened={stockPickerOpen}
        receiptno={selectedReceiptno}
        existingRows={rows}
        fixedCustomerCode={selectedReceiptno ? header.customcode : ''}
        fixedCustomerName={selectedReceiptno ? header.customname : ''}
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
    </Box>
  );
}
