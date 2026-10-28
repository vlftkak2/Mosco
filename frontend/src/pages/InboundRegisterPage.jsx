import { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import {
  ActionIcon, Badge, Box, Button, Group, Loader, Modal, Pagination, Paper, Popover, Select,
  ScrollArea, Stack, Table, Text, TextInput, Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconCopy, IconDeviceFloppy, IconFileSpreadsheet, IconPlus,
  IconFilter, IconSearch, IconTrash, IconX,
} from '@tabler/icons-react';
import { TableVirtuoso } from 'react-virtuoso';
import * as XLSX from 'xlsx';
import { applyExcelHeaderStyle } from '../utils/excelHeaderStyle';
import sharedClasses from '../styles/pages/ManagementShared.module.css';
import codeClasses from '../styles/pages/CodeMasterPage.module.css';
import classes from '../styles/pages/InboundRegister.module.css';
import itemMasterClasses from '../styles/pages/ItemMaster.module.css';
import { PageRibbonContext } from '../components/layout/MainLayout';

const PAGE_SIZE_OPTIONS = [
  { value: '15', label: '15개씩' },
  { value: '50', label: '50개씩' },
  { value: '100', label: '100개씩' },
  { value: '200', label: '200개씩' },
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
const isValidDateInput = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  if (!match) return false;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};
const EMPTY_HEADER = { receiptno: '', receptdate: localDate(), customcode: '', customname: '' };
const DETAIL_FIELDS = [
  { key: 'receptdate', label: '입고일자', width: 120, minWidth: 112, required: true },
  { key: 'customname', label: '매입처', width: 180, minWidth: 110, required: true },
  { key: 'warehousecodename', label: '창고', width: 135, minWidth: 100, required: true },
  { key: 'productname', label: '제품번호', width: 135, minWidth: 100 },
  { key: 'itemname', label: '품명', width: 180, minWidth: 100, required: true },
  { key: 'materialname', label: '강종', width: 120, minWidth: 90 },
  { key: 'surfacename', label: '표면', width: 140, minWidth: 100 },
  { key: 'myrtle', label: '도금량(g/㎡)', width: 135, minWidth: 120 },
  { key: 'thickness', label: '두께', width: 75, minWidth: 65 },
  { key: 'width', label: '폭', width: 75, minWidth: 65 },
  { key: 'length', label: '길이', width: 75, minWidth: 65 },
  { key: 'qty', label: '수량', width: 90, minWidth: 75, required: true },
  { key: 'weight', label: '중량', width: 100, minWidth: 80, required: true },
  { key: 'unitprice', label: '매입단가', width: 105, minWidth: 90, required: true },
  { key: 'supplyamt', label: '공급가', width: 110, minWidth: 85 },
  { key: 'vat', label: '부가세', width: 95, minWidth: 75 },
  { key: 'unitamt', label: '합계금액', width: 115, minWidth: 100 },
  { key: 'qtyunit', label: '수량단위', width: 95, minWidth: 85, required: true },
  { key: 'unit', label: '단가기준', width: 95, minWidth: 85, required: true },
  { key: 'manager', label: '담당자', width: 110, minWidth: 90 },
  { key: 'description', label: '비고', width: 160, minWidth: 100 },
];
const RECEIPT_COLUMNS = [
  { key: 'receptdate', label: '입고일자', width: 100, minWidth: 90 },
  { key: 'customname', label: '매입처', width: 150, minWidth: 105 },
  { key: 'warehousecodename', label: '창고', width: 115, minWidth: 90 },
  { key: 'line_count', label: '상세건수', width: 78, minWidth: 68, align: 'right' },
  { key: 'total_qty', label: '수량', width: 78, minWidth: 68, align: 'right' },
  { key: 'total_weight', label: '중량', width: 82, minWidth: 72, align: 'right' },
  { key: 'supply_amount', label: '공급가', width: 105, minWidth: 85, align: 'right' },
  { key: 'vat_amount', label: '부가세', width: 90, minWidth: 75, align: 'right' },
  { key: 'total_amount', label: '합계금액', width: 115, minWidth: 95, align: 'right' },
  { key: 'qtyunit', label: '수량단위', width: 80, minWidth: 70 },
  { key: 'unit', label: '단가기준', width: 80, minWidth: 70 },
  { key: 'receiptno', label: '입고전표', width: 155, minWidth: 125 },
  { key: 'description', label: '비고', width: 115, minWidth: 85 },
];
const fitColumnWidth = (label, values, baseWidth, minWidth, maxWidth = 420) => {
  const measure = (value) => Array.from(String(value ?? '')).reduce((width, character) => width + (character.charCodeAt(0) > 255 ? 11 : 6.5), 0) + 20;
  const contentWidth = Math.max(measure(label), ...values.map(measure));
  return Math.max(minWidth, Math.min(maxWidth, Math.max(baseWidth, contentWidth)));
};
const NAVIGABLE_FIELDS = DETAIL_FIELDS.map(({ key }) => key);
const EDITABLE_FIELDS = DETAIL_FIELDS.map(({ key }) => key);
const EMPTY_DETAIL = { receptdate: localDate(), customcode: '', customname: '', itemcode: '', itemname: '', productname: '', materialcode: '', materialname: '', surfacecode: '', surfacename: '', myrtle: '', thickness: '', width: '', length: '', qty: '', qtyunit: 'EA', warehousecode: '', warehousecodename: '', weight: '', unit: 'KG', unitprice: '', supplyamt: '', vat: '', unitamt: '', manager: '', description: '' };
const masterPasteErrorKey = (rowId, field) => `${rowId}:${field}`;

const errorMessage = (error) => {
  const detail = error.response?.data?.detail;
  if (Array.isArray(detail)) return detail.slice(0, 5).map((item) => item.msg || String(item)).join(' / ');
  return detail || error.response?.data?.message || error.message || '입고 요청에 실패했습니다.';
};
const makeDetail = (source = EMPTY_DETAIL, lineNo = null) => ({
  ...EMPTY_DETAIL,
  ...source,
  receptdate: source.receptdate || localDate(),
  supplyamt_manual: source.supplyamt_manual ?? (String(source.supplyamt ?? '').trim() !== ''),
  vat_manual: source.vat_manual ?? (String(source.vat ?? '').trim() !== ''),
  id: source.id || `line-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  lineno: lineNo,
  is_new: lineNo == null,
  is_dirty: false,
});
const amountOf = (row, priceUnits = []) => {
  if (row.supplyamt_manual) {
    const entered = Number(row.supplyamt || 0);
    return Number.isFinite(entered) ? entered.toFixed(2) : '0.00';
  }
  if (!String(row.unitprice ?? '').trim()) return '';
  const price = Number(row.unitprice);
  if (!Number.isFinite(price)) return '';
  const priceUnit = priceUnits.find((option) => option.code === row.unit);
  const unitToken = `${row.unit || ''} ${priceUnit?.name || ''}`.trim().toLocaleUpperCase();
  let basis;
  if (unitToken.includes('수량') || /QTY|(^|[\s_-])(EA|PCS|COUNT)([\s_-]|$)/.test(unitToken)) {
    basis = Number(cleanNumericInput(row.qty));
  } else if (unitToken.includes('길이') || unitToken.includes('LENGTH') || /(^|[\s_-])(M|METER)([\s_-]|$)/.test(unitToken)) {
    basis = Number(cleanNumericInput(row.length));
  } else {
    const weight = Number(cleanNumericInput(row.weight));
    basis = /TON|톤/.test(unitToken) ? weight / 1000 : weight;
  }
  return Number.isFinite(basis) ? (basis * price).toFixed(2) : '';
}
const vatOf = (row, priceUnits = []) => {
  if (row.vat_manual) {
    const entered = Number(row.vat || 0);
    return Number.isFinite(entered) ? entered.toFixed(2) : '0.00';
  }
  const supplyValue = amountOf(row, priceUnits);
  if (supplyValue === '') return '';
  const supply = Number(supplyValue);
  return Number.isFinite(supply) ? (Math.round((supply * 0.1 + Number.EPSILON) * 100) / 100).toFixed(2) : '';
};
const totalAmountOf = (row, priceUnits = []) => {
  const supply = Number(amountOf(row, priceUnits));
  const vat = Number(vatOf(row, priceUnits));
  return Number.isFinite(supply) && Number.isFinite(vat) ? (supply + vat).toFixed(2) : '';
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
const NUMERIC_FIELDS = new Set(['myrtle', 'thickness', 'width', 'length', 'qty', 'weight', 'unitprice', 'supplyamt', 'vat']);
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
      if (requestId === requestIdRef.current) notifications.show({ title: '매입처 조회 실패', message: errorMessage(error), color: 'red' });
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

  return <Modal opened={opened} onClose={invalidatePending} title={<PickerModalTitle title="매입처 선택" />} classNames={{ content: classes.receiptFinderModalContent, header: classes.receiptFinderModalHeader, title: classes.receiptFinderModalTitle, close: classes.receiptFinderModalClose }} centered size={900}>
    <Stack gap="sm" pt={10}>
      <Group gap={7} wrap="nowrap">
        <TextInput className={classes.customerSearchInput} placeholder="매입처코드 또는 매입처명 검색" value={searchInput}
          onChange={(event) => setSearchInput(event.currentTarget.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') searchCustomers(); }}
          leftSection={<IconSearch size={15} />} size="sm" autoFocus />
        <Button color="red" size="sm" leftSection={<IconSearch size={15} />} onClick={searchCustomers}>조회</Button>
      </Group>
      <Box className={classes.pickerResults}>
        {loading && <Loader className={classes.pickerLoader} size="xs" color="gray" aria-label="조회 중" />}
        <ScrollArea h={420} type="auto" scrollbarSize={6}>
          <Table className={`${codeClasses.codeTable} ${classes.pickerTable}`} highlightOnHover withTableBorder withColumnBorders>
            <Table.Thead><Table.Tr><Table.Th className={classes.customerCodeColumn}>매입처코드</Table.Th><Table.Th className={classes.customerNameColumn}>매입처명</Table.Th><Table.Th className={classes.customerRepresentativeColumn}>대표자</Table.Th><Table.Th className={classes.customerBusinessColumn}>사업자번호</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>
              {customers.map((customer) => (
                <Table.Tr key={customer.customercode} className={classes.customerResultRow} onClick={() => onSelect(customer)}>
                  <Table.Td>{customer.customercode}</Table.Td><Table.Td>{customer.customername}</Table.Td><Table.Td>{customer.ceoname || ''}</Table.Td><Table.Td>{customer.businessno || ''}</Table.Td>
                </Table.Tr>
              ))}
              {!customers.length && <Table.Tr><Table.Td colSpan={4} className={classes.customerEmpty}>{loading ? '조회 중입니다.' : '조회된 매입처가 없습니다.'}</Table.Td></Table.Tr>}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Box>
      <Group justify="space-between"><Text size="xs" c="dimmed">총 {total.toLocaleString()}개 매입처</Text><Pagination size="sm" total={Math.max(1, Math.ceil(total / 20))} value={page} onChange={changePage} withEdges color="red" disabled={loading} /></Group>
    </Stack>
  </Modal>;
});

const ItemPickerModal = memo(function ItemPickerModal({ opened, onClose, onSelect }) {
  const [searchInput, setSearchInput] = useState('');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);

  const loadItems = useCallback(async (nextPage, query) => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const { data } = await axios.get('/api/item-master/items/picker', {
        ...authConfig(), params: { q: query, page: nextPage, page_size: 20 },
      });
      if (requestId !== requestIdRef.current) return;
      setItems(data.items || []);
      setTotal(data.total || 0);
      setPage(nextPage);
    } catch (error) {
      if (requestId === requestIdRef.current) notifications.show({ title: '품목 조회 실패', message: errorMessage(error), color: 'red' });
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (opened) {
      setSearchInput('');
      void loadItems(1, '');
    } else {
      requestIdRef.current += 1;
    }
  }, [opened, loadItems]);

  const close = () => { requestIdRef.current += 1; onClose(); };
  const search = () => { void loadItems(1, searchInput.trim()); };

  return <Modal opened={opened} onClose={close} title={<PickerModalTitle title="품목 선택" />}
    classNames={{ content: classes.receiptFinderModalContent, header: classes.receiptFinderModalHeader, title: classes.receiptFinderModalTitle, close: classes.receiptFinderModalClose }}
    centered size={700}>
    <Stack gap="sm" pt={10}>
      <Group gap={7} wrap="nowrap">
        <TextInput className={classes.customerSearchInput} placeholder="품목코드, 품목명 또는 형태구분 검색"
          value={searchInput} onChange={(event) => setSearchInput(event.currentTarget.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') search(); }} />
        <Button color="red" size="sm" leftSection={<IconSearch size={15} />} onClick={search} loading={loading}>조회</Button>
      </Group>
      <Box className={classes.pickerResults}>
        {loading && <Loader className={classes.pickerLoader} size="xs" color="gray" aria-label="조회 중" />}
        <ScrollArea h={260} type="auto" scrollbarSize={6}>
          <Table className={`${codeClasses.codeTable} ${classes.pickerTable}`} highlightOnHover withTableBorder withColumnBorders>
            <Table.Thead><Table.Tr><Table.Th>품목코드</Table.Th><Table.Th>품목명</Table.Th><Table.Th>형태구분</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>
              {items.map((item) => <Table.Tr key={item.itemcode} className={classes.customerResultRow} onClick={() => onSelect(item)}>
                <Table.Td>{item.itemcode}</Table.Td><Table.Td>{item.itemname}</Table.Td><Table.Td>{item.itemtypecodenm || item.itemtypecode || ''}</Table.Td>
              </Table.Tr>)}
              {!items.length && <Table.Tr><Table.Td colSpan={3} className={classes.customerEmpty}>{loading ? '조회 중입니다.' : '조회된 품목이 없습니다.'}</Table.Td></Table.Tr>}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Box>
      <Group justify="space-between"><Text size="xs" c="dimmed">총 {total.toLocaleString()}개 품목</Text>
        <Pagination size="sm" total={Math.max(1, Math.ceil(total / 20))} value={page} onChange={(nextPage) => { void loadItems(nextPage, searchInput.trim()); }} withEdges color="red" disabled={loading} />
      </Group>
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
  const masterField = field === 'warehousecode' || field === 'warehousecodename' ? 'warehouse' : field;
  const options = masterField === 'unit' ? unitOptions.price
    : masterField === 'qtyunit' ? unitOptions.quantity
      : masterField === 'warehouse' ? unitOptions.warehouse
        : masterField === 'material' ? unitOptions.material
          : masterField === 'surface' ? unitOptions.surface : [];
  return options.find((option) => (
    String(option.code ?? '').trim().toLocaleLowerCase() === text
    || String(option.name ?? '').trim().toLocaleLowerCase() === text
    || `${String(option.code ?? '').trim()} - ${String(option.name ?? '').trim()}`.toLocaleLowerCase() === text
  ))?.code || '';
};

const ItemNameAutocompleteCell = memo(function ItemNameAutocompleteCell({ row, disabled, onChange, onPaste, onSelectItem, onFindItem, onFocusCell, registerCellInput }) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(row.itemname || '');
  const [items, setItems] = useState([]);
  const [itemsQuery, setItemsQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const commitRequestRef = useRef(0);
  const pickerOpenRef = useRef(false);
  const skipBlurCommitRef = useRef(false);
  const hasEditedRef = useRef(false);
  const keyboardSelectionRef = useRef(false);
  const query = String(draft || '').trim();
  const isOpen = isEditing && !disabled && itemsQuery === query && items.length > 0;

  useEffect(() => {
    if (!isEditing || disabled || !query) return undefined;
    const controller = new AbortController();
    const loadItems = async () => {
      try {
        const { data } = await axios.get('/api/item-master/items/suggest', {
          ...authConfig(), params: { q: query }, signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          setItems(data.items || []);
          setItemsQuery(query);
        }
      } catch { /* the shape-style suggestion list stays closed on lookup failure */ }
    };
    void loadItems();
    return () => controller.abort();
  }, [isEditing, disabled, query]);

  const chooseItem = (item) => {
    onSelectItem(row.id, item);
    hasEditedRef.current = false;
    keyboardSelectionRef.current = false;
    setDraft(item.itemname || '');
    setIsEditing(false);
    setActiveIndex(-1);
  };

  const openPicker = () => {
    pickerOpenRef.current = true;
    setIsEditing(false);
    onFindItem(row.id);
  };

  const commitExactMatch = async () => {
    const requestId = ++commitRequestRef.current;
    const normalized = query.toLocaleLowerCase();
    if (!normalized) {
      onChange(row.id, 'itemname', '');
      setIsEditing(false);
      return;
    }
    setIsEditing(false);
    let candidates = items;
    if (!candidates.some((item) => [item.itemname, item.itemcode].some((value) => String(value || '').trim().toLocaleLowerCase() === normalized))) {
      try {
        const { data } = await axios.get('/api/item-master/items/suggest', { ...authConfig(), params: { q: query } });
        candidates = data.items || [];
      } catch { /* keep the current item if lookup fails */ }
    }
    if (requestId !== commitRequestRef.current) return;
    const exact = candidates.filter((item) => [item.itemname, item.itemcode]
      .some((value) => String(value || '').trim().toLocaleLowerCase() === normalized));
    if (exact.length === 1) chooseItem(exact[0]);
    else {
      onChange(row.id, 'itemname', query);
      setIsEditing(false);
    }
  };

  return <Popover opened={isOpen} onChange={(nextOpened) => { if (!nextOpened) setIsEditing(false); }} position="bottom-start" width="target" withinPortal shadow="none" offset={0} zIndex={500} transitionProps={{ duration: 0 }}>
    <Popover.Target>
      <div className={classes.itemNameSearchTarget}>
        <input
          ref={(element) => registerCellInput(row.id, 'itemname', element)}
          className={`${codeClasses.cellInput} ${classes.itemCodePickerInput} ${classes.itemNameSearchInput}`}
          aria-label="품명"
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-controls={isOpen ? `item-suggestions-${row.id}` : undefined}
          data-row-id={row.id}
          data-field="itemname"
          value={isEditing ? draft : row.itemname || ''}
          maxLength={150}
          placeholder=""
          disabled={disabled}
          onFocus={(event) => {
            commitRequestRef.current += 1;
            pickerOpenRef.current = false;
            hasEditedRef.current = false;
            keyboardSelectionRef.current = false;
            onFocusCell(row.id, 'itemname');
            setDraft(row.itemname || '');
            setIsEditing(true);
            event.currentTarget.select();
          }}
          onBlur={() => {
            if (skipBlurCommitRef.current) { skipBlurCommitRef.current = false; return; }
            if (!pickerOpenRef.current) void commitExactMatch();
          }}
          onChange={(event) => { hasEditedRef.current = true; keyboardSelectionRef.current = false; setDraft(event.currentTarget.value); setActiveIndex(-1); setIsEditing(true); }}
          onPaste={onPaste}
          onKeyDown={(event) => {
            if (event.key === 'F2' || event.key === ' ') {
              event.preventDefault(); event.stopPropagation();
              if (!disabled) openPicker();
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault(); event.stopPropagation();
              if (isOpen) keyboardSelectionRef.current = true;
              setIsEditing(true);
              if (isOpen) setActiveIndex((current) => event.key === 'ArrowDown'
                ? (current + 1) % items.length : (current - 1 + items.length) % items.length);
            } else if (event.key === 'Tab' && isOpen) {
              if (hasEditedRef.current) {
                const item = keyboardSelectionRef.current && activeIndex >= 0 ? items[activeIndex] : null;
                skipBlurCommitRef.current = true;
                if (item) chooseItem(item);
                else { onChange(row.id, 'itemname', ''); setDraft(''); setIsEditing(false); setActiveIndex(-1); hasEditedRef.current = false; keyboardSelectionRef.current = false; }
              }
            } else if (event.key === 'Tab' && hasEditedRef.current) {
              skipBlurCommitRef.current = true;
              onChange(row.id, 'itemname', ''); setDraft(''); setIsEditing(false); setActiveIndex(-1); hasEditedRef.current = false; keyboardSelectionRef.current = false;
            } else if (event.key === 'Enter' && isOpen) {
              event.preventDefault(); event.stopPropagation();
              const chosen = items[activeIndex >= 0 ? activeIndex : 0];
              if (chosen) chooseItem(chosen);
            } else if (event.key === 'Escape') {
              event.preventDefault(); event.stopPropagation(); setDraft(row.itemname || ''); setIsEditing(false); setActiveIndex(-1);
            }
          }}
          onDoubleClick={() => { if (!disabled) openPicker(); }}
        />
      </div>
    </Popover.Target>
    <Popover.Dropdown className={itemMasterClasses.shapeSuggestions}>
      <div id={`item-suggestions-${row.id}`} role="listbox" aria-label="품목 검색 결과">
        {items.map((item, index) => <button key={item.itemcode} type="button" role="option" aria-selected={index === activeIndex}
          className={itemMasterClasses.shapeSuggestion}
          style={index === activeIndex ? { background: '#edf3f8' } : undefined}
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => setActiveIndex(index)}
          onClick={() => chooseItem(item)}>
          <span>{item.itemname}</span>
        </button>)}
      </div>
    </Popover.Dropdown>
  </Popover>;
});

const CustomerNameAutocompleteCell = memo(function CustomerNameAutocompleteCell({ row, disabled, onChange, onPaste, onSelectCustomer, onFindCustomer, onFocusCell, registerCellInput }) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(row.customname || '');
  const [customers, setCustomers] = useState([]);
  const [customersQuery, setCustomersQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const requestIdRef = useRef(0);
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
  const isOpen = isEditing && !disabled && visibleCustomers.length > 0;

  useEffect(() => {
    if (!isEditing || disabled || !query) return undefined;
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
        }
      } catch { /* keep the customer suggestion list closed on lookup failure */ }
    };
    void loadCustomers();
    return () => controller.abort();
  }, [isEditing, disabled, query]);

  const chooseCustomer = (customer) => {
    requestIdRef.current += 1;
    hasEditedRef.current = false;
    keyboardSelectionRef.current = false;
    onSelectCustomer(row.id, customer);
    setDraft(customer.customername || '');
    setIsEditing(false);
    setActiveIndex(-1);
  };

  const commitExactMatch = async () => {
    const requestId = ++requestIdRef.current;
    const normalized = query.toLocaleLowerCase();
    if (!normalized) {
      onChange(row.id, 'customname', '');
      setIsEditing(false);
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
      } catch { /* retain the entered text if lookup fails */ }
    }
    if (requestId !== requestIdRef.current) return;
    const exact = candidates.filter((customer) => [customer.customername, customer.customercode]
      .some((value) => String(value || '').trim().toLocaleLowerCase() === normalized));
    if (exact.length === 1) chooseCustomer(exact[0]);
    else {
      onChange(row.id, 'customname', query);
      setIsEditing(false);
    }
  };

  const openPicker = () => {
    pickerOpenRef.current = true;
    setIsEditing(false);
    onFindCustomer(row.id);
  };

  return <Popover opened={isOpen} onChange={(opened) => { if (!opened) setIsEditing(false); }} position="bottom-start" width="target" withinPortal shadow="none" offset={0} zIndex={500} transitionProps={{ duration: 0 }}>
    <Popover.Target>
      <div className={classes.itemNameSearchTarget}>
        <input
          ref={(element) => registerCellInput(row.id, 'customname', element)}
          className={`${codeClasses.cellInput} ${classes.itemCodePickerInput} ${classes.itemNameSearchInput}`}
          aria-label="매입처명"
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-controls={isOpen ? `customer-suggestions-${row.id}` : undefined}
          data-row-id={row.id}
          data-field="customname"
          value={isEditing ? draft : row.customname || ''}
          maxLength={100}
          placeholder=""
          disabled={disabled}
          onFocus={(event) => {
            requestIdRef.current += 1;
            pickerOpenRef.current = false;
            hasEditedRef.current = false;
            keyboardSelectionRef.current = false;
            onFocusCell(row.id, 'customname');
            setDraft(row.customname || '');
            setIsEditing(true);
            event.currentTarget.select();
          }}
          onBlur={() => {
            if (skipBlurCommitRef.current) { skipBlurCommitRef.current = false; return; }
            if (!pickerOpenRef.current) void commitExactMatch();
          }}
          onChange={(event) => { hasEditedRef.current = true; keyboardSelectionRef.current = false; setDraft(event.currentTarget.value); setActiveIndex(-1); setIsEditing(true); onChange(row.id, 'customname', event.currentTarget.value); }}
          onPaste={onPaste}
          onKeyDown={(event) => {
            if (event.key === 'F2' || event.key === ' ') {
              event.preventDefault(); event.stopPropagation();
              if (!disabled) openPicker();
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              if (!isOpen) return;
              event.preventDefault(); event.stopPropagation(); setIsEditing(true);
              keyboardSelectionRef.current = true;
              setActiveIndex((current) => event.key === 'ArrowDown'
                ? (current + 1) % visibleCustomers.length : (current - 1 + visibleCustomers.length) % visibleCustomers.length);
            } else if (event.key === 'Tab' && isOpen) {
              if (hasEditedRef.current) {
                const customer = keyboardSelectionRef.current && activeIndex >= 0 ? visibleCustomers[activeIndex] : null;
                skipBlurCommitRef.current = true;
                if (customer) chooseCustomer(customer);
                else { onChange(row.id, 'customname', ''); setDraft(''); setIsEditing(false); setActiveIndex(-1); hasEditedRef.current = false; keyboardSelectionRef.current = false; }
              }
            } else if (event.key === 'Tab' && hasEditedRef.current) {
              skipBlurCommitRef.current = true;
              onChange(row.id, 'customname', ''); setDraft(''); setIsEditing(false); setActiveIndex(-1); hasEditedRef.current = false; keyboardSelectionRef.current = false;
            } else if (event.key === 'Enter' && isOpen) {
              event.preventDefault(); event.stopPropagation();
              const customer = visibleCustomers[activeIndex >= 0 ? activeIndex : 0];
              if (customer) chooseCustomer(customer);
            } else if (event.key === 'Escape') {
              event.preventDefault(); event.stopPropagation(); setDraft(row.customname || ''); setIsEditing(false); setActiveIndex(-1);
            }
          }}
          onDoubleClick={() => { if (!disabled) openPicker(); }}
        />
      </div>
    </Popover.Target>
    <Popover.Dropdown className={itemMasterClasses.shapeSuggestions}>
      <div id={`customer-suggestions-${row.id}`} role="listbox" aria-label="매입처 검색 결과">
        {visibleCustomers.map((customer, index) => <button key={customer.customercode} type="button" role="option" aria-selected={index === activeIndex}
          className={itemMasterClasses.shapeSuggestion}
          style={index === activeIndex ? { background: '#edf3f8' } : undefined}
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => setActiveIndex(index)}
          onClick={() => chooseCustomer(customer)}>
          <span>{customer.customername}</span>
        </button>)}
      </div>
    </Popover.Dropdown>
  </Popover>;
});

const WarehouseNameAutocompleteCell = memo(function WarehouseNameAutocompleteCell({ row, options, disabled, onChange, onSelectWarehouse, onPaste, onFindMaster, onFocusCell, registerCellInput }) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(row.warehousecodename || '');
  const [activeIndex, setActiveIndex] = useState(-1);
  const pickerOpenRef = useRef(false);
  const skipBlurCommitRef = useRef(false);
  const hasEditedRef = useRef(false);
  const keyboardSelectionRef = useRef(false);
  const query = String(draft || '').trim().toLocaleLowerCase();
  const matches = useMemo(() => query
    ? options.filter((option) => `${option.name || ''} ${option.code || ''}`.toLocaleLowerCase().includes(query)).slice(0, 8)
    : [], [options, query]);
  const isOpen = isEditing && !disabled && matches.length > 0;

  const choose = (option) => {
    onSelectWarehouse(row.id, option);
    hasEditedRef.current = false;
    keyboardSelectionRef.current = false;
    setDraft(option.name || '');
    setIsEditing(false);
    setActiveIndex(-1);
  };
  const commit = () => {
    const text = String(draft || '').trim();
    if (!text) {
      onChange(row.id, 'warehousecodename', '');
      setIsEditing(false);
      return;
    }
    const exact = options.filter((option) => [option.name, option.code]
      .some((value) => String(value || '').trim().toLocaleLowerCase() === text.toLocaleLowerCase()));
    if (exact.length === 1) choose(exact[0]);
    else {
      onChange(row.id, 'warehousecodename', text);
      setIsEditing(false);
    }
  };
  const openPicker = () => {
    pickerOpenRef.current = true;
    setIsEditing(false);
    onFindMaster(row.id, 'warehousecodename');
  };

  return <Popover opened={isOpen} onChange={(opened) => { if (!opened) setIsEditing(false); }} position="bottom-start" width="target" withinPortal shadow="none" offset={0} zIndex={500} transitionProps={{ duration: 0 }}>
    <Popover.Target>
      <div className={classes.itemNameSearchTarget}>
        <input
          ref={(element) => registerCellInput(row.id, 'warehousecodename', element)}
          className={`${codeClasses.cellInput} ${classes.itemCodePickerInput} ${classes.itemNameSearchInput}`}
          aria-label="창고명" aria-haspopup="listbox" aria-expanded={isOpen}
          data-row-id={row.id} data-field="warehousecodename"
          value={isEditing ? draft : row.warehousecodename || ''} maxLength={50}
          disabled={disabled}
          onFocus={(event) => {
            pickerOpenRef.current = false;
            hasEditedRef.current = false;
            keyboardSelectionRef.current = false;
            onFocusCell(row.id, 'warehousecodename');
            setDraft(row.warehousecodename || '');
            setIsEditing(true);
            event.currentTarget.select();
          }}
          onBlur={() => {
            if (skipBlurCommitRef.current) { skipBlurCommitRef.current = false; return; }
            if (!pickerOpenRef.current) commit();
          }}
          onChange={(event) => { hasEditedRef.current = true; keyboardSelectionRef.current = false; setDraft(event.currentTarget.value); setActiveIndex(-1); setIsEditing(true); }}
          onPaste={onPaste}
          onKeyDown={(event) => {
            if (event.key === 'F2' || event.key === ' ') {
              event.preventDefault(); event.stopPropagation();
              if (!disabled) openPicker();
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              if (!matches.length) return;
              event.preventDefault(); event.stopPropagation(); setIsEditing(true);
              keyboardSelectionRef.current = true;
              setActiveIndex((current) => event.key === 'ArrowDown'
                ? (current + 1) % matches.length : (current - 1 + matches.length) % matches.length);
            } else if (event.key === 'Tab' && isOpen) {
              if (hasEditedRef.current) {
                const option = keyboardSelectionRef.current && activeIndex >= 0 ? matches[activeIndex] : null;
                skipBlurCommitRef.current = true;
                if (option) choose(option);
                else { onChange(row.id, 'warehousecodename', ''); setDraft(''); setIsEditing(false); setActiveIndex(-1); hasEditedRef.current = false; keyboardSelectionRef.current = false; }
              }
            } else if (event.key === 'Tab' && hasEditedRef.current) {
              skipBlurCommitRef.current = true;
              onChange(row.id, 'warehousecodename', ''); setDraft(''); setIsEditing(false); setActiveIndex(-1); hasEditedRef.current = false; keyboardSelectionRef.current = false;
            } else if (event.key === 'Enter' && isEditing) {
              event.preventDefault(); event.stopPropagation();
              const option = matches[activeIndex >= 0 ? activeIndex : 0];
              if (option) choose(option);
            } else if (event.key === 'Escape') {
              event.preventDefault(); event.stopPropagation(); setDraft(row.warehousecodename || ''); setIsEditing(false); setActiveIndex(-1);
            }
          }}
          onDoubleClick={() => { if (!disabled) openPicker(); }}
        />
      </div>
    </Popover.Target>
    <Popover.Dropdown className={itemMasterClasses.shapeSuggestions}>
      <div role="listbox" aria-label="창고명 검색 결과">
        {matches.map((option, index) => <button key={option.code} type="button" role="option" aria-selected={index === activeIndex}
          className={itemMasterClasses.shapeSuggestion}
          style={index === activeIndex ? { background: '#edf3f8' } : undefined}
          onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(option)}>
          <span>{option.name}</span>
        </button>)}
      </div>
    </Popover.Dropdown>
  </Popover>;
});

const GeneralCodeNameAutocompleteCell = memo(function GeneralCodeNameAutocompleteCell({ row, field, options, disabled, onChange, onSelectMaster, onPaste, onFindMaster, onFocusCell, registerCellInput }) {
  const nameKey = field === 'material' ? 'materialname' : 'surfacename';
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(row[nameKey] || '');
  const [activeIndex, setActiveIndex] = useState(-1);
  const pickerOpenRef = useRef(false);
  const skipBlurCommitRef = useRef(false);
  const hasEditedRef = useRef(false);
  const keyboardSelectionRef = useRef(false);
  const query = String(draft || '').trim().toLocaleLowerCase();
  const matches = useMemo(() => query
    ? options.filter((option) => `${option.name || ''} ${option.code || ''}`.toLocaleLowerCase().includes(query)).slice(0, 8)
    : [], [options, query]);
  const isOpen = isEditing && !disabled && matches.length > 0;
  const choose = (option) => {
    onSelectMaster(row.id, field, option);
    hasEditedRef.current = false;
    keyboardSelectionRef.current = false;
    setDraft(option.name || '');
    setIsEditing(false);
    setActiveIndex(-1);
  };
  const commit = () => {
    const text = String(draft || '').trim();
    if (!text) {
      onChange(row.id, nameKey, '');
      setIsEditing(false);
      return;
    }
    const exact = options.filter((option) => [option.name, option.code]
      .some((value) => String(value || '').trim().toLocaleLowerCase() === text.toLocaleLowerCase()));
    if (exact.length === 1) choose(exact[0]);
    else {
      onChange(row.id, nameKey, text);
      setIsEditing(false);
    }
  };
  const openPicker = () => {
    pickerOpenRef.current = true;
    setIsEditing(false);
    onFindMaster(row.id, field);
  };

  return <Popover opened={isOpen} onChange={(opened) => { if (!opened) setIsEditing(false); }} position="bottom-start" width="target" withinPortal shadow="none" offset={0} zIndex={500} transitionProps={{ duration: 0 }}>
    <Popover.Target>
      <div className={classes.itemNameSearchTarget}>
        <input
          ref={(element) => registerCellInput(row.id, nameKey, element)}
          className={`${codeClasses.cellInput} ${classes.itemCodePickerInput} ${classes.itemNameSearchInput}`}
          aria-label={field === 'material' ? '강종' : '표면'} aria-haspopup="listbox" aria-expanded={isOpen}
          data-row-id={row.id} data-field={nameKey}
          value={isEditing ? draft : row[nameKey] || ''} maxLength={100}
          disabled={disabled}
          onFocus={(event) => {
            pickerOpenRef.current = false;
            hasEditedRef.current = false;
            keyboardSelectionRef.current = false;
            onFocusCell(row.id, nameKey);
            setDraft(row[nameKey] || '');
            setIsEditing(true);
            event.currentTarget.select();
          }}
          onBlur={() => {
            if (skipBlurCommitRef.current) { skipBlurCommitRef.current = false; return; }
            if (!pickerOpenRef.current) commit();
          }}
          onChange={(event) => { hasEditedRef.current = true; keyboardSelectionRef.current = false; setDraft(event.currentTarget.value); setActiveIndex(-1); setIsEditing(true); }}
          onPaste={onPaste}
          onKeyDown={(event) => {
            if (event.key === 'F2' || event.key === ' ') {
              event.preventDefault(); event.stopPropagation();
              if (!disabled) openPicker();
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              if (!matches.length) return;
              event.preventDefault(); event.stopPropagation(); setIsEditing(true);
              keyboardSelectionRef.current = true;
              setActiveIndex((current) => event.key === 'ArrowDown'
                ? (current + 1) % matches.length : (current - 1 + matches.length) % matches.length);
            } else if (event.key === 'Tab' && isOpen) {
              if (hasEditedRef.current) {
                const option = keyboardSelectionRef.current && activeIndex >= 0 ? matches[activeIndex] : null;
                skipBlurCommitRef.current = true;
                if (option) choose(option);
                else { onChange(row.id, nameKey, ''); setDraft(''); setIsEditing(false); setActiveIndex(-1); hasEditedRef.current = false; keyboardSelectionRef.current = false; }
              }
            } else if (event.key === 'Tab' && hasEditedRef.current) {
              skipBlurCommitRef.current = true;
              onChange(row.id, nameKey, ''); setDraft(''); setIsEditing(false); setActiveIndex(-1); hasEditedRef.current = false; keyboardSelectionRef.current = false;
            } else if (event.key === 'Enter' && isEditing) {
              event.preventDefault(); event.stopPropagation();
              const option = matches[activeIndex >= 0 ? activeIndex : 0];
              if (option) choose(option);
            } else if (event.key === 'Escape') {
              event.preventDefault(); event.stopPropagation(); setDraft(row[nameKey] || ''); setIsEditing(false); setActiveIndex(-1);
            }
          }}
          onDoubleClick={() => { if (!disabled) openPicker(); }}
        />
      </div>
    </Popover.Target>
    <Popover.Dropdown className={itemMasterClasses.shapeSuggestions}>
      <div role="listbox" aria-label={`${field === 'material' ? '강종' : '표면'} 검색 결과`}>
        {matches.map((option, index) => <button key={option.code} type="button" role="option" aria-selected={index === activeIndex}
          className={itemMasterClasses.shapeSuggestion}
          style={index === activeIndex ? { background: '#edf3f8' } : undefined}
          onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(option)}>
          <span>{option.name}</span>
        </button>)}
      </div>
    </Popover.Dropdown>
  </Popover>;
});

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

const InboundDateSegments = memo(function InboundDateSegments({ row, disabled, label, onChange, onPaste, registerCellInput, onFocusCell }) {
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
    if (event.key !== 'Tab') return;
    const nextIndex = activeSegmentRef.current + (event.shiftKey ? -1 : 1);
    if (nextIndex < 0 || nextIndex > 2) return;
    event.preventDefault();
    event.stopPropagation();
    selectSegment(nextIndex);
  };

  return (
    <input
      ref={(element) => { inputRef.current = element; registerCellInput(row.id, 'receptdate', element); }}
      className={codeClasses.cellInput}
      aria-label={label}
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
      onChange={(event) => onChange(row.id, 'receptdate', event.currentTarget.value.replace(/[^\d-]/g, '').slice(0, 10))}
      onPaste={onPaste}
      onKeyDown={handleKeyDown}
    />
  );
});

const DetailCells = memo(function DetailCells({ row, index, selected, disabled, managerEditable, saved, unitOptions, onSelect, onChange, onPaste, registerCellInput, onSelectItem, onSelectCustomer, onSelectWarehouse, onSelectGeneralMaster, onFindItem, onFindCustomer, onFindMaster, onFocusCell }) {
  const displayValue = (key) => {
    if (key === 'qtyunit') return unitOptions.quantity.find((option) => option.code === resolveMasterCode('qtyunit', row.qtyunit, unitOptions))?.name || row.qtyunit || '';
    if (key === 'unit') return unitOptions.price.find((option) => option.code === resolveMasterCode('unit', row.unit || 'KG', unitOptions))?.name || row.unit || 'KG';
    if (key === 'unitamt') return formatNumericInput(totalAmountOf(row, unitOptions.price));
    if (NUMERIC_FIELDS.has(key)) return formatNumericInput(row[key]);
    return row[key] ?? '';
  };
  const pasteHandler = (field) => (event) => {
    const text = event.clipboardData.getData('text/plain');
    if (field === 'unit' || field === 'qtyunit' || field === 'warehousecode' || field === 'warehousecodename' || field === 'customname') {
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
    <Table.Td className={`${codeClasses.checkCol} ${saved ? classes.savedCell : ''}`} style={{ width: 42, minWidth: 42, padding: '0 3px' }}>
      <input type="checkbox" aria-label={`${row.itemcode || '입고 상세'} 선택`} checked={selected} disabled={disabled} onChange={(event) => onSelect(row.id, event.nativeEvent.shiftKey)} />
    </Table.Td>
    <Table.Td className={`${codeClasses.rowNumber} ${saved ? classes.savedCell : ''}`} style={{ width: 58, minWidth: 58 }}>{index + 1}</Table.Td>
    {DETAIL_FIELDS.map(({ key, label }) => (
      <Table.Td key={key} className={[
        saved && !(key === 'manager' && managerEditable) ? classes.savedCell : '',
        key === 'manager' && managerEditable ? classes.managerEditableCell : '',
      ].filter(Boolean).join(' ')}>
        {saved && key !== 'manager' ? (
          <span className={classes.savedCellText} title={String(displayValue(key))}>
            {key === 'supplyamt' || key === 'vat'
              ? formatNumericInput(row[`${key}_manual`] ? row[key] : (key === 'vat' ? vatOf({ ...row, vat_manual: false }, unitOptions.price) : amountOf({ ...row, supplyamt_manual: false }, unitOptions.price)))
              : displayValue(key)}
          </span>
        ) : key === 'manager' ? (
          <ManagerInput key={`${row.id}:${row.manager || ''}`} row={row} editable={!disabled || managerEditable} label={label} onChange={onChange} onPaste={pasteHandler(key)} registerCellInput={registerCellInput} onFocusCell={onFocusCell} />
        ) : key === 'receptdate' ? (
          <InboundDateSegments row={row} disabled={disabled} label={label} onChange={onChange} onPaste={pasteHandler(key)} registerCellInput={registerCellInput} onFocusCell={onFocusCell} />
        ) : key === 'customname' ? (
          <CustomerNameAutocompleteCell row={row} disabled={disabled} onChange={onChange} onPaste={pasteHandler(key)}
            onSelectCustomer={onSelectCustomer} onFindCustomer={onFindCustomer} onFocusCell={onFocusCell} registerCellInput={registerCellInput} />
        ) : key === 'supplyamt' || key === 'vat' ? (
          <input
            ref={(element) => registerCellInput(row.id, key, element)}
            className={`${codeClasses.cellInput} ${classes.amountInput}`}
            aria-label={label}
            data-row-id={row.id}
            data-field={key}
            inputMode="decimal"
            value={formatNumericInput(row[`${key}_manual`] ? row[key] : (key === 'vat' ? vatOf({ ...row, vat_manual: false }, unitOptions.price) : amountOf({ ...row, supplyamt_manual: false }, unitOptions.price)))}
            disabled={disabled}
            onFocus={() => onFocusCell(row.id, key)}
            onPaste={pasteHandler(key)}
            onChange={(event) => onChange(row.id, key, cleanNumericInput(event.currentTarget.value))}
          />
        ) : key === 'unitamt' ? (
          <input
            ref={(element) => registerCellInput(row.id, key, element)}
            className={`${codeClasses.cellInput} ${classes.amountInput}`}
            aria-label={label}
            data-row-id={row.id}
            data-field={key}
            value={displayValue(key)}
            readOnly
            onFocus={() => onFocusCell(row.id, key)}
          />
        ) : key === 'itemname' ? (
          <ItemNameAutocompleteCell row={row} disabled={disabled} onChange={onChange} onPaste={pasteHandler(key)}
            onSelectItem={onSelectItem} onFindItem={onFindItem} onFocusCell={onFocusCell} registerCellInput={registerCellInput} />
        ) : key === 'warehousecodename' ? (
          <WarehouseNameAutocompleteCell row={row} options={unitOptions.warehouse} disabled={disabled} onChange={onChange}
            onSelectWarehouse={onSelectWarehouse} onPaste={pasteHandler(key)} onFindMaster={onFindMaster}
            onFocusCell={onFocusCell} registerCellInput={registerCellInput} />
        ) : key === 'materialname' || key === 'surfacename' ? (
          <GeneralCodeNameAutocompleteCell row={row} field={key === 'materialname' ? 'material' : 'surface'}
            options={key === 'materialname' ? unitOptions.material : unitOptions.surface} disabled={disabled} onChange={onChange}
            onSelectMaster={onSelectGeneralMaster} onPaste={pasteHandler(key)} onFindMaster={onFindMaster}
            onFocusCell={onFocusCell} registerCellInput={registerCellInput} />
        ) : key === 'unit' || key === 'qtyunit' ? (
          <select
            ref={(element) => registerCellInput(row.id, key, element)}
            className={`${codeClasses.cellSelect} ${classes.priceUnitSelect}`}
            aria-label={label}
            data-row-id={row.id}
            data-field={key}
            value={resolveMasterCode(key, row[key] || (key === 'unit' ? 'KG' : 'EA'), unitOptions) || row[key] || (key === 'unit' ? 'KG' : 'EA')}
            disabled={disabled}
            onFocus={() => onFocusCell(row.id, key)}
            onPaste={pasteHandler(key)}
            onChange={(event) => onChange(row.id, key, event.currentTarget.value)}
          >
            {row[key] && !resolveMasterCode(key, row[key], unitOptions) && <option value={row[key]}>{row[key]}</option>}
            {(key === 'unit' ? unitOptions.price : unitOptions.quantity)
              .map((option) => <option key={option.code} value={option.code}>{option.name || option.code}</option>)}
          </select>
        ) : (
          <input
            ref={(element) => registerCellInput(row.id, key, element)}
            className={`${codeClasses.cellInput} ${key === 'itemname' || key === 'warehousecodename' ? classes.autoFilledInput : ''} ${key === 'warehousecode' ? classes.itemCodePickerInput : ''}`}
            aria-label={label}
            title={key === 'warehousecode' ? `${label} - 더블클릭하여 마스터에서 선택` : undefined}
            data-row-id={row.id}
            data-field={key}
            inputMode={NUMERIC_FIELDS.has(key) ? 'decimal' : undefined}
            value={displayValue(key)}
            placeholder={row.is_new && (key === 'itemcode' || key === 'itemname') ? label : ''}
            readOnly={key === 'itemname' || key === 'warehousecodename'}
            disabled={disabled && !(key === 'manager' && managerEditable)}
            onFocus={() => onFocusCell(row.id, key)}
            onDoubleClick={key === 'warehousecode' ? () => onFindMaster(row.id, key) : undefined}
            onPaste={pasteHandler(key)}
            onChange={(event) => onChange(row.id, key, NUMERIC_FIELDS.has(key) ? cleanNumericInput(event.currentTarget.value) : event.currentTarget.value)}
          />
        )}
      </Table.Td>
    ))}
  </>;
});

const VirtualRow = ({ item, className, ...props }) => (
  <Table.Tr {...props} className={[className, item?.is_new && codeClasses.newRow, item?.is_new && classes.newRow].filter(Boolean).join(' ')} />
);
const virtuosoComponents = {
  Table: ({ style, ...props }) => <Table {...props} className={`${sharedClasses.table} ${codeClasses.codeTable}`} highlightOnHover withTableBorder withColumnBorders verticalSpacing="xs" horizontalSpacing={0} style={{ ...style, width: '100%', tableLayout: 'fixed' }} />,
  TableHead: Table.Thead,
  TableBody: Table.Tbody,
  TableRow: VirtualRow,
};

export default function InboundRegisterPage() {
  const pageLayout = useContext(PageRibbonContext);
  const registerPageRibbon = pageLayout?.registerPageRibbon;
  const closeActivePage = pageLayout?.closeActivePage;
  const [receipts, setReceipts] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [filterInputs, setFilterInputs] = useState(createDefaultReceiptFilters);
  const [filters, setFilters] = useState(createDefaultReceiptFilters);
  const [filterOpen, setFilterOpen] = useState(true);
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
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [columnWidths, setColumnWidths] = useState({});
  const [receiptColumnWidths, setReceiptColumnWidths] = useState({});
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [customerPickerTarget, setCustomerPickerTarget] = useState(null);
  const [itemPickerTarget, setItemPickerTarget] = useState(null);
  const [masterPickerTarget, setMasterPickerTarget] = useState(null);
  const [unitOptions, setUnitOptions] = useState({ price: [], quantity: [], warehouse: [], material: [], surface: [] });
  const virtuosoRef = useRef(null);
  const detailScrollerRef = useRef(null);
  const receiptTableRef = useRef(null);
  const receiptSubtotalRef = useRef(null);
  const cellInputsRef = useRef(new Map());
  const codeLookupTimersRef = useRef(new Map());
  const masterPasteErrorsRef = useRef(new Map());
  const activeCellRef = useRef(null);
  const pendingCellFocusRef = useRef(null);
  const pendingFocusIdRef = useRef('');
  const pendingFocusFieldRef = useRef('');
  const selectionAnchorRef = useRef('');
  const locked = isReceiptConfirmed(subulyn);
  const readOnly = Boolean(selectedReceiptno) || locked;
  const hasManagerChanges = useMemo(() => Boolean(selectedReceiptno) && rows.some((row) => row.manager_dirty), [selectedReceiptno, rows]);
  const hasPendingChanges = useMemo(() => documentDirty || rows.some((row) => row.is_new || row.is_dirty), [documentDirty, rows]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const receiptAutoWidths = useMemo(() => Object.fromEntries(RECEIPT_COLUMNS.map((column) => {
    const values = receipts.map((receipt) => {
      if (column.key === 'customname') return receipt.customname || '';
      if (column.key === 'warehousecodename') return receipt.warehousecodename || '';
      return receipt[column.key];
    });
    return [column.key, fitColumnWidth(column.label, values, column.width, column.minWidth)];
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
      const tables = [
        receiptTableRef.current?.querySelector('table'),
        receiptSubtotalRef.current?.querySelector('table'),
      ].filter(Boolean);
      tables.forEach((table) => {
        const column = [...table.querySelectorAll('col[data-column-key]')]
          .find((element) => element.dataset.columnKey === key);
        if (column) column.style.width = `${nextWidth}px`;
        table.style.width = `${nextTableWidth}px`;
        table.style.minWidth = `${nextTableWidth}px`;
      });
      const scrollbarContent = receiptTableRef.current?.parentElement
        ?.querySelector(`.${classes.topReceiptHorizontalContent}`);
      if (scrollbarContent) scrollbarContent.style.width = `${nextTableWidth}px`;
    };
    const move = (pointerEvent) => {
      nextWidth = Math.max(minWidth, Math.min(1600, startWidth + pointerEvent.clientX - startX));
      if (!animationFrame) {
        animationFrame = window.requestAnimationFrame(() => {
          animationFrame = 0;
          applyWidth();
        });
      }
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
      const { data } = await axios.get('/api/inbound-register/receipts', {
        ...authConfig(), params: {
          page: nextPage,
          page_size: nextPageSize,
          q: nextFilters.q || undefined,
          receiptno: nextFilters.receiptno || undefined,
          customer: nextFilters.customer || undefined,
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
      notifications.show({ title: '입고 목록 조회 실패', message: errorMessage(error), color: 'red' });
    } finally {
      setLoading(false);
    }
  }, [page, filters, pageSize]);

  const initialReceiptLoadRef = useRef(false);
  useEffect(() => {
    if (initialReceiptLoadRef.current) return;
    initialReceiptLoadRef.current = true;
    void loadReceipts(1, filters);
  }, [loadReceipts, filters]);

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
    const uniqueOptions = new Map();
    items.filter((item) => item.use).forEach((item) => {
      const code = String(item.code || '').trim();
      if (code) uniqueOptions.set(code.toLocaleUpperCase(), { code, name: item.name || code });
    });
    return [...uniqueOptions.values()];
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadUnitOptions('PRICE_UNIT'), loadUnitOptions('QTY'), loadUnitOptions('WAREHOUSE'), loadUnitOptions('MATERIAL'), loadUnitOptions('SURFACE')])
      .then(([price, quantity, warehouse, material, surface]) => {
        if (!cancelled) setUnitOptions({ price, quantity, warehouse, material, surface });
      })
      .catch((error) => {
        if (!cancelled) notifications.show({ title: '단위 코드 조회 실패', message: errorMessage(error), color: 'red' });
      });
    return () => { cancelled = true; };
  }, [loadUnitOptions]);

  const openCustomerPicker = useCallback((rowId) => {
    if (!readOnly && !saving) {
      setCustomerPickerTarget(rowId);
      setCustomerPickerOpen(true);
    }
  }, [readOnly, saving]);

  const selectCustomer = useCallback((customer) => {
    if (customerPickerTarget) {
      setRows((current) => current.map((row) => row.id === customerPickerTarget
        ? { ...row, customcode: customer.customercode || '', customname: customer.customername || '', is_dirty: !row.is_new }
        : row));
    } else {
      setHeader((current) => ({
        ...current,
        customcode: customer.customercode || '',
        customname: customer.customername || '',
      }));
    }
    setDocumentDirty(true);
    setCustomerPickerOpen(false);
    setCustomerPickerTarget(null);
  }, [customerPickerTarget]);

  const selectCustomerForRow = useCallback((rowId, customer) => {
    setRows((current) => current.map((row) => row.id === rowId
      ? { ...row, customcode: customer.customercode || '', customname: customer.customername || '', is_dirty: !row.is_new }
      : row));
    setDocumentDirty(true);
  }, []);

  const selectItem = useCallback((rowId, item) => {
    setRows((current) => current.map((row) => row.id === rowId
      ? { ...row, itemcode: item.itemcode || '', itemname: item.itemname || '', is_dirty: !row.is_new }
      : row));
    setDocumentDirty(true);
  }, []);

  const openItemPicker = useCallback((rowId) => {
    if (!readOnly && !saving) setItemPickerTarget(rowId);
  }, [readOnly, saving]);

  const selectItemFromPicker = useCallback((item) => {
    if (itemPickerTarget) selectItem(itemPickerTarget, item);
    setItemPickerTarget(null);
  }, [itemPickerTarget, selectItem]);

  const lookupItemNames = useCallback(async (itemcodes) => {
    const codes = [...new Set(itemcodes.map((code) => String(code || '').trim()).filter(Boolean))];
    if (!codes.length) return {};
    const { data } = await axios.post('/api/item-master/items/lookup', { itemcodes: codes }, authConfig());
    return Object.fromEntries((data.items || []).map((item) => [item.itemcode, item.itemname]));
  }, []);

  const openReceipt = useCallback(async (receiptno, allowDiscard = false) => {
    if (hasPendingChanges && !allowDiscard) {
      notifications.show({ title: '저장되지 않은 변경사항', message: '현재 입고 내용을 먼저 저장해 주세요.', color: 'orange' });
      return false;
    }
    setDetailLoading(true);
    try {
      const { data } = await axios.get(`/api/inbound-register/receipts/${encodeURIComponent(receiptno)}`, authConfig());
      const receipt = data.receipt;
      setHeader({
        receiptno: receipt.receiptno || '',
        receptdate: String(receipt.receptdate || '').slice(0, 10),
        customcode: receipt.customcode || '',
        customname: receipt.customname || '',
      });
      setReceiptMetadata({
        companyid: receipt.companyid || '',
        companyname: receipt.companyname || '',
        created_at: receipt.created_at || '',
        updated_at: receipt.updated_at || '',
      });
      setRows((receipt.items || []).map((item) => makeDetail(item, item.lineno)));
      setSelectedReceiptno(receipt.receiptno);
      setSubulyn(receipt.subulyn || 'N');
      setDocumentDirty(false);
      setSelectedIds([]);
      selectionAnchorRef.current = '';
      return true;
    } catch (error) {
      notifications.show({ title: '입고 상세 조회 실패', message: errorMessage(error), color: 'red' });
      return false;
    } finally {
      setDetailLoading(false);
    }
  }, [hasPendingChanges]);

  const createReceipt = useCallback(() => {
    if (hasPendingChanges) {
      notifications.show({ title: '저장되지 않은 변경사항', message: '현재 입고 내용을 먼저 저장해 주세요.', color: 'orange' });
      return false;
    }
    setHeader({ ...EMPTY_HEADER, receptdate: localDate() });
    setReceiptMetadata({ companyid: '', companyname: '', created_at: '', updated_at: '' });
    setRows([]);
    setSelectedReceiptno('');
    setSubulyn('N');
    setDocumentDirty(false);
    setSelectedIds([]);
    selectionAnchorRef.current = '';
    return true;
  }, [hasPendingChanges]);

  useEffect(() => {
    if (!pendingFocusIdRef.current) return;
    const id = pendingFocusIdRef.current;
    const field = pendingFocusFieldRef.current || 'itemname';
    const rowIndex = rows.findIndex((row) => row.id === id);
    if (rowIndex >= 0) requestAnimationFrame(() => virtuosoRef.current?.scrollToIndex({ index: rowIndex, align: 'end', behavior: 'auto' }));
    cellInputsRef.current.get(`${id}:${field}`)?.focus();
    pendingFocusIdRef.current = '';
    pendingFocusFieldRef.current = '';
  }, [rows]);

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
    if (key === 'itemname') {
      setRows((current) => current.map((row) => row.id === id
        ? { ...row, itemcode: '', itemname: value, is_dirty: !row.is_new }
        : row));
      setDocumentDirty(true);
      return;
    }
    if (key === 'customname') {
      setRows((current) => current.map((row) => row.id === id
        ? { ...row, customcode: '', customname: value, is_dirty: !row.is_new }
        : row));
      setDocumentDirty(true);
      return;
    }
    if (key === 'unit' || key === 'qtyunit') {
      masterPasteErrorsRef.current.delete(masterPasteErrorKey(id, key));
      const normalizedValue = resolveMasterCode(key, value, unitOptions) || value;
      setRows((current) => current.map((row) => row.id === id
        ? key === 'unit'
          ? { ...row, unit: normalizedValue, supplyamt: '', vat: '', supplyamt_manual: false, vat_manual: false, is_dirty: !row.is_new }
          : { ...row, [key]: normalizedValue, is_dirty: !row.is_new }
        : row));
      setDocumentDirty(true);
      return;
    }
    if (key === 'warehousecodename') {
      masterPasteErrorsRef.current.delete(masterPasteErrorKey(id, 'warehouse'));
      const normalizedValue = resolveMasterCode('warehouse', value, unitOptions);
      const option = unitOptions.warehouse.find((item) => item.code === normalizedValue);
      setRows((current) => current.map((row) => row.id === id
        ? { ...row, warehousecode: option?.code || '', warehousecodename: option?.name || String(value || ''), is_dirty: !row.is_new }
        : row));
      setDocumentDirty(true);
      return;
    }
    if (key === 'materialname' || key === 'surfacename') {
      const field = key === 'materialname' ? 'material' : 'surface';
      const codeKey = field === 'material' ? 'materialcode' : 'surfacecode';
      const nameKey = key;
      const code = resolveMasterCode(field, value, unitOptions);
      const options = field === 'material' ? unitOptions.material : unitOptions.surface;
      const option = options.find((item) => item.code === code);
      setRows((current) => current.map((row) => row.id === id
        ? { ...row, [codeKey]: option?.code || '', [nameKey]: option?.name || String(value || ''), is_dirty: !row.is_new }
        : row));
      setDocumentDirty(true);
      return;
    }
    if (key === 'supplyamt' || key === 'vat') {
      setRows((current) => current.map((row) => row.id === id
        ? { ...row, [key]: value, [`${key}_manual`]: true, is_dirty: !row.is_new }
        : row));
      setDocumentDirty(true);
      return;
    }
    if (key === 'unitprice') {
      setRows((current) => current.map((row) => row.id === id
        ? { ...row, unitprice: value, supplyamt: '', vat: '', supplyamt_manual: false, vat_manual: false, is_dirty: !row.is_new }
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
    }, 0);
    codeLookupTimersRef.current.set(id, timer);
  }, [lookupItemNames, unitOptions, selectedReceiptno]);

  const setActiveCell = useCallback((id, field) => {
    activeCellRef.current = { id, field };
  }, []);

  const fillDown = useCallback(() => {
    const activeCell = activeCellRef.current;
    if (!activeCell || readOnly || saving || !selectedIds.length) return;
    const field = activeCell.field;
    if (field === 'itemname' || field === 'warehousecodename' || field === 'unitamt' || field === 'unit') return;
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
    if (masterPickerTarget.field === 'material' || masterPickerTarget.field === 'surface') {
      const field = masterPickerTarget.field;
      const codeKey = field === 'material' ? 'materialcode' : 'surfacecode';
      const nameKey = field === 'material' ? 'materialname' : 'surfacename';
      setRows((current) => current.map((row) => row.id === masterPickerTarget.id
        ? { ...row, [codeKey]: option.code || '', [nameKey]: option.name || '', is_dirty: !row.is_new }
        : row));
      setDocumentDirty(true);
    } else changeDetail(masterPickerTarget.id, masterPickerTarget.field, option.code);
    setMasterPickerTarget(null);
  }, [masterPickerTarget, changeDetail]);

  const selectWarehouse = useCallback((id, option) => {
    setRows((current) => current.map((row) => row.id === id
      ? { ...row, warehousecode: option.code || '', warehousecodename: option.name || '', is_dirty: !row.is_new }
      : row));
    masterPasteErrorsRef.current.delete(masterPasteErrorKey(id, 'warehouse'));
    setDocumentDirty(true);
  }, []);

  const selectGeneralMaster = useCallback((id, field, option) => {
    const codeKey = field === 'material' ? 'materialcode' : 'surfacecode';
    const nameKey = field === 'material' ? 'materialname' : 'surfacename';
    setRows((current) => current.map((row) => row.id === id
      ? { ...row, [codeKey]: option.code || '', [nameKey]: option.name || '', is_dirty: !row.is_new }
      : row));
    setDocumentDirty(true);
  }, []);

  const openMasterPicker = useCallback((id, field) => {
    if (field !== 'unit' && !readOnly && !saving) setMasterPickerTarget({ id, field });
  }, [readOnly, saving]);

  const addDetail = useCallback(() => {
    if (saving) return;
    const startingNewReceipt = Boolean(selectedReceiptno);
    if (startingNewReceipt && !createReceipt()) return;
    if (readOnly && !startingNewReceipt) return;
    const row = makeDetail();
    pendingFocusIdRef.current = row.id;
    pendingFocusFieldRef.current = 'receptdate';
    pendingCellFocusRef.current = { key: `${row.id}:receptdate` };
    setRows((current) => startingNewReceipt ? [row] : [...current, row]);
    setDocumentDirty(true);
    selectionAnchorRef.current = '';
    requestAnimationFrame(() => {
      virtuosoRef.current?.scrollToIndex({ index: rows.length, align: 'end', behavior: 'auto' });
      if (detailScrollerRef.current) detailScrollerRef.current.scrollTop = detailScrollerRef.current.scrollHeight;
    });
  }, [saving, selectedReceiptno, createReceipt, readOnly, rows.length]);

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
    if (startIndex + matrix.length > 10000) {
      notifications.show({ title: '붙여넣기 제한', message: '한 번에 최대 10,000행까지 입력할 수 있습니다.', color: 'orange' });
      return;
    }
    const next = [...rows];
    const append = [];
    const codeLookups = [];
    const itemNameLookups = [];
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
          } else if (key === 'itemname') {
            const itemname = String(value || '').trim();
            target.itemcode = '';
            target.itemname = itemname;
            if (itemname) itemNameLookups.push({ id: target.id, itemname });
          } else if (key === 'unit') {
            const code = resolveMasterCode('unit', value, unitOptions);
            const rawValue = String(value ?? '').trim();
            target.unit = rawValue && !code ? '' : (code || rawValue);
            target.supplyamt = '';
            target.vat = '';
            target.supplyamt_manual = false;
            target.vat_manual = false;
            if (rawValue && !code) masterPasteErrorsRef.current.set(masterPasteErrorKey(target.id, 'unit'), rawValue);
            else masterPasteErrorsRef.current.delete(masterPasteErrorKey(target.id, 'unit'));
          } else if (key === 'materialname' || key === 'surfacename') {
            const masterField = key === 'materialname' ? 'material' : 'surface';
            const code = resolveMasterCode(masterField, value, unitOptions);
            const rawValue = String(value ?? '').trim();
            const option = (masterField === 'material' ? unitOptions.material : unitOptions.surface).find((item) => item.code === code);
            const codeKey = masterField === 'material' ? 'materialcode' : 'surfacecode';
            target[codeKey] = option?.code || '';
            target[key] = option?.name || rawValue;
            if (rawValue && !option) masterPasteErrorsRef.current.set(masterPasteErrorKey(target.id, masterField), rawValue);
            else masterPasteErrorsRef.current.delete(masterPasteErrorKey(target.id, masterField));
          } else if (key === 'qtyunit' || key === 'warehousecode' || key === 'warehousecodename') {
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
          } else if (key && key !== 'unitamt') {
            target[key] = NUMERIC_FIELDS.has(key) ? cleanNumericInput(value) : value;
            if (key === 'supplyamt' || key === 'vat') target[`${key}_manual`] = true;
            if (key === 'unitprice') {
              target.supplyamt = '';
              target.vat = '';
              target.supplyamt_manual = false;
              target.vat_manual = false;
            }
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
    if (itemNameLookups.length) {
      const uniqueNames = [...new Set(itemNameLookups.map(({ itemname }) => itemname.toLocaleLowerCase()))];
      Promise.all(uniqueNames.map(async (normalizedName) => {
        const itemname = itemNameLookups.find((entry) => entry.itemname.toLocaleLowerCase() === normalizedName)?.itemname || '';
        try {
          const { data } = await axios.get('/api/item-master/items/suggest', { ...authConfig(), params: { q: itemname } });
          const matches = (data.items || []).filter((item) => String(item.itemname || '').trim().toLocaleLowerCase() === normalizedName);
          return [normalizedName, matches.length === 1 ? matches[0] : null];
        } catch { return [normalizedName, null]; }
      })).then((resolved) => {
        const itemsByName = new Map(resolved);
        const lookupsById = new Map(itemNameLookups.map((entry) => [entry.id, entry]));
        setRows((current) => current.map((row) => {
          const requested = lookupsById.get(row.id);
          const item = requested && itemsByName.get(requested.itemname.toLocaleLowerCase());
          if (!item || String(row.itemname || '').trim() !== requested.itemname || row.itemcode) return row;
          return { ...row, itemcode: item.itemcode || '', itemname: item.itemname || requested.itemname, is_dirty: !row.is_new };
        }));
      });
    }
  }, [rows, readOnly, lookupItemNames, unitOptions]);

  const deleteSelectedDetails = useCallback(() => {
    if (!selectedIds.length || readOnly) return;
    const deleteCount = selectedIds.length;
    const ids = new Set(selectedIds);
    setRows((current) => current.filter((row) => !ids.has(row.id)));
    setSelectedIds([]);
    selectionAnchorRef.current = '';
    setDocumentDirty(true);
    notifications.show({
      title: '상세 행 삭제 완료',
      message: `선택한 ${deleteCount.toLocaleString()}개 행을 입력 목록에서 제거했습니다. 저장해야 반영됩니다.`,
      color: 'teal',
    });
  }, [selectedIds, readOnly]);

  const validateDocument = useCallback(() => {
    const invalidDates = rows.flatMap((row, index) => isValidDateInput(row.receptdate) ? [] : [`${index + 1}행`]);
    if (invalidDates.length) {
      notifications.show({
        title: '입고일자 형식 확인',
        message: `${invalidDates.slice(0, 5).join(', ')}: 날짜를 YYYY-MM-DD 형식으로 입력해 주세요. 예: 2026-10-23`,
        color: 'orange',
        autoClose: 8000,
      });
      return false;
    }
    const missing = [];
    if (selectedReceiptno && !header.receiptno.trim()) missing.push('입고전표번호');
    if (!rows.length) missing.push('상세 품목');
    if (missing.length) {
      notifications.show({ title: '필수 항목을 입력해 주세요', message: missing.join(', '), color: 'orange' });
      return false;
    }
    const failures = rows.flatMap((row, index) => {
      const errors = [];
      if (!String(row.customcode || '').trim() && !String(row.customname || '').trim()) errors.push('매입처');
      if (!String(row.itemcode || '').trim()) errors.push('품목명 자동완성에서 품목을 선택해 주세요');
      if (!String(row.itemname || '').trim()) errors.push('품목명');
      if (!String(row.qtyunit || '').trim()) errors.push('수량단위');
      const qtyText = String(row.qty ?? '').trim();
      const qty = Number(qtyText);
      if (!qtyText || !Number.isFinite(qty) || qty <= 0) errors.push('수량(0 초과)');
      if (!String(row.warehousecode || '').trim()) errors.push('창고코드');
      const weight = Number(row.weight);
      const unitprice = Number(row.unitprice);
      if (!Number.isFinite(weight) || weight <= 0) errors.push('입고중량(0 초과)');
      if (!String(row.unitprice || '').trim() || !Number.isFinite(unitprice) || unitprice <= 0) errors.push('매입단가(0 초과)');
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
        { field: 'unit', label: '단가기준', required: true, errorKey: 'unit' },
        { field: 'qtyunit', label: '수량단위', required: true, errorKey: 'qtyunit' },
        { field: 'warehousecode', label: '창고', required: true, errorKey: 'warehouse' },
      ];
      checks.forEach(({ field, label, required, errorKey }) => {
        const value = String(row[field] ?? '').trim();
        const pastedValue = masterPasteErrorsRef.current.get(masterPasteErrorKey(row.id, errorKey));
        const invalidValue = pastedValue || value;
        const invalid = pastedValue || (required && !value) || (value && !resolveMasterCode(field, value, unitOptions));
        if (invalid) errors.push(`${index + 1}행 ${label}: ${invalidValue || '미입력'}`);
      });
      [
        { code: row.materialcode, name: row.materialname, field: 'material', label: '강종' },
        { code: row.surfacecode, name: row.surfacename, field: 'surface', label: '표면' },
      ].forEach(({ code, name, field, label }) => {
        const value = String(code || name || '').trim();
        const pastedValue = masterPasteErrorsRef.current.get(masterPasteErrorKey(row.id, field));
        if (pastedValue || (value && !resolveMasterCode(field, value, unitOptions))) {
          errors.push(`${index + 1}행 ${label}: ${pastedValue || value}`);
        }
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
    if (selectedReceiptno && hasManagerChanges && !locked) {
      const managerItems = rows
        .filter((row) => row.manager_dirty)
        .map((row) => ({ lineno: row.lineno, manager: String(row.manager || '').trim() }));
      setSaving(true);
      try {
        const { data } = await axios.patch(
          '/api/inbound-register/receipts/' + encodeURIComponent(selectedReceiptno) + '/manager',
          { items: managerItems },
          authConfig(),
        );
        await openReceipt(selectedReceiptno, true);
        notifications.show({
          title: '담당자 수정 완료',
          message: data.updated_count + ' 행의 담당자를 입고상세·현재고·수불현황에 반영했습니다.',
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
    if (selectedReceiptno) {
      notifications.show({ title: '저장된 전표', message: '저장된 전표는 수정할 수 없습니다. 상단 헤더의 추가를 눌러 새 전표를 시작해 주세요.', color: 'orange' });
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
        customcode: sourceRows[0]?.customcode || sourceHeader.customcode,
        customname: sourceRows[0]?.customname || sourceHeader.customname,
        is_new: !selectedReceiptno,
        items: sourceRows.map((row) => ({
          receptdate: row.receptdate,
          customcode: String(row.customcode || '').trim(),
          customname: String(row.customname || '').trim(),
          itemcode: String(row.itemcode || '').trim(), itemname: String(row.itemname || '').trim(),
          productname: String(row.productname || '').trim(),
          materialcode: String(row.materialcode || '').trim(), materialname: String(row.materialname || '').trim(),
          surfacecode: String(row.surfacecode || '').trim(), surfacename: String(row.surfacename || '').trim(),
          myrtle: String(row.myrtle ?? '').trim(),
          thickness: String(row.thickness ?? '').trim(), width: String(row.width ?? '').trim(), length: String(row.length ?? '').trim(),
          unit: unitOptions.price.find((option) => option.code === resolveMasterCode('unit', row.unit || 'KG', unitOptions))?.name || String(row.unit || 'KG').trim(),
          qty: String(row.qty ?? '').trim(), qtyunit: unitOptions.quantity.find((option) => option.code === resolveMasterCode('qtyunit', row.qtyunit, unitOptions))?.name || String(row.qtyunit || '').trim(),
          warehousecode: resolveMasterCode('warehouse', row.warehousecode || row.warehousecodename, unitOptions) || String(row.warehousecode || '').trim(),
          warehousecodename: String(row.warehousecodename || '').trim(),
          weight: String(row.weight || '').trim(), unitprice: String(row.unitprice || '').trim(),
          supplyamt: row.supplyamt_manual ? String(row.supplyamt || '0').trim() : '',
          vat: row.vat_manual ? String(row.vat || '0').trim() : '',
          manager: String(row.manager || '').trim(),
          description: String(row.description || '').trim(),
        })),
      };
      const { data } = await axios.put('/api/inbound-register/receipts', payload, authConfig());
      masterPasteErrorsRef.current.clear();
      notifications.show({
        title: '입고 저장 완료',
        message: `${data.saved_count}건을 입고일자·매입처·창고 기준 ${data.group_count || 1}개 전표로 나누어 저장했습니다.`,
        color: 'teal',
      });
      const defaultFilters = createDefaultReceiptFilters();
      setFilters(defaultFilters);
      setFilterInputs(defaultFilters);
      await loadReceipts(1, defaultFilters);
      await openReceipt(data.receiptno, true);
      return true;
    } catch (error) {
      notifications.show({ title: '입고 저장 실패', message: errorMessage(error), color: 'red', autoClose: 9000 });
      return false;
    } finally {
      setSaving(false);
    }
  }, [selectedReceiptno, hasManagerChanges, locked, rows, openReceipt, header, unitOptions, validateDetailMasters, validateDocument, loadReceipts]);

  const exportDocument = useCallback(() => {
    if (!header.receiptno || !rows.length) {
      notifications.show({ title: '다운로드할 입고전표 없음', message: '먼저 저장된 입고전표를 선택해 주세요.', color: 'orange' });
      return;
    }
    setExporting(true);
    try {
      const workbook = XLSX.utils.book_new();
      const exportFields = [
        ['No.', (_, index) => index + 1],
        ...DETAIL_FIELDS.map(({ key, label }) => [
          label,
          (row) => key === 'supplyamt'
            ? amountOf(row, unitOptions.price)
            : key === 'vat'
              ? vatOf(row, unitOptions.price)
              : key === 'unitamt'
                ? totalAmountOf(row, unitOptions.price)
            : row[key] ?? '',
        ]),
        ['등록일자', (row) => formatExcelDateTime(row.created_at)],
        ['수정일자', (row) => formatExcelDateTime(row.updated_at)],
      ];
      const worksheet = XLSX.utils.aoa_to_sheet([
        exportFields.map(([label]) => label),
        ...rows.map((row, index) => exportFields.map(([, getValue]) => getValue(row, index))),
      ]);
      applyExcelHeaderStyle(worksheet, exportFields.length);
      worksheet['!cols'] = exportFields.map(([label]) => ({ wch: Math.min(28, Math.max(14, String(label).length + 4)) }));
      worksheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: exportFields.length - 1 } }) };
      XLSX.utils.book_append_sheet(workbook, worksheet, '입고내역');
      const safeFilePart = (value) => {
        const invalidCharacters = '<>:"/\\|?*';
        const safePart = [...String(value || '').trim()]
          .map((character) => character.charCodeAt(0) < 32 || invalidCharacters.includes(character) ? '_' : character)
          .join('')
          .replace(/\s+/g, '_');
        return safePart || '미입력';
      };
      XLSX.writeFile(workbook, `입고전표_${safeFilePart(header.customname || header.customcode)}_${safeFilePart(header.receptdate)}_${safeFilePart(header.receiptno)}.xlsx`);
    } finally { setExporting(false); }
  }, [header, rows, unitOptions.price]);

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
    if (readOnly || saving) return;
    if (selectedIds.length !== 1) {
    notifications.show({ title: '복사할 행 선택', message: '복사할 상세 행을 한 개만 선택해 주세요.', color: 'orange' });
      return;
    }
    const source = rows.find((row) => row.id === selectedIds[0]);
    if (!source) return;
    const sourceValues = Object.fromEntries(Object.entries(source)
      .filter(([key]) => !['id', 'lineno', 'is_new', 'is_dirty'].includes(key)));
    const copy = makeDetail(sourceValues);
    pendingFocusIdRef.current = copy.id;
    pendingCellFocusRef.current = { key: `${copy.id}:itemname` };
    setRows((current) => [...current, copy]);
    setSelectedIds([copy.id]);
    setDocumentDirty(true);
    notifications.show({ title: '상세 행 복사 완료', message: '선택한 행을 그대로 복사해 상세에 추가했습니다.', color: 'teal' });
  }, [readOnly, saving, rows, selectedIds]);

  const requestToolbarDelete = useCallback(() => {
    if (selectedIds.length && !readOnly) {
      deleteSelectedDetails();
      return;
    }
    if (!selectedReceiptno) {
      notifications.show({ title: '삭제할 항목 없음', message: '입고전표를 선택하거나 상세 행을 선택해 주세요.', color: 'orange' });
      return;
    }
    if (hasPendingChanges) {
      notifications.show({ title: '저장되지 않은 변경사항', message: '삭제 전에 현재 변경사항을 먼저 정리해 주세요.', color: 'orange' });
      return;
    }
    setDeleteOpen(true);
  }, [selectedIds.length, readOnly, deleteSelectedDetails, selectedReceiptno, hasPendingChanges]);

  useEffect(() => {
    if (!registerPageRibbon) return undefined;
    registerPageRibbon(
      <Group className={classes.commandRibbon} justify="flex-start" wrap="nowrap" gap={2}>
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconSearch size={15} />} onClick={runSearch} loading={loading}>조회</Button>
        <span className={classes.ribbonSeparator} />
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconPlus size={15} />} onClick={addDetail} disabled={saving}>추가</Button>
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconCopy size={15} />} onClick={copySelectedDetails} disabled={readOnly || saving || selectedIds.length !== 1}>복사</Button>
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconFileSpreadsheet size={15} />} onClick={exportDocument} loading={exporting} disabled={!selectedReceiptno || loading || detailLoading || !rows.length}>엑셀</Button>
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconDeviceFloppy size={15} />} onClick={() => saveDocument()} loading={saving} disabled={selectedReceiptno ? (locked || detailLoading || !hasManagerChanges) : (readOnly || detailLoading)}>저장</Button>
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconTrash size={15} />} onClick={requestToolbarDelete} disabled={saving || locked || (!selectedReceiptno && (!selectedIds.length || readOnly))}>삭제</Button>
        <span className={classes.ribbonSeparator} />
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconX size={15} />} onClick={closeActivePage}>닫기</Button>
      </Group>,
    );
    return () => registerPageRibbon(null);
  }, [registerPageRibbon, closeActivePage, runSearch, loading, addDetail, copySelectedDetails, readOnly, saving, selectedIds.length, exportDocument, exporting, selectedReceiptno, rows.length, detailLoading, saveDocument, requestToolbarDelete, locked, hasManagerChanges]);

  const requestDeleteReceipt = useCallback(async () => {
    if (!selectedReceiptno || locked) return;
    setSaving(true);
    try {
      await axios.delete(`/api/inbound-register/receipts/${encodeURIComponent(selectedReceiptno)}`, authConfig());
      notifications.show({ title: '입고 삭제 완료', message: `${selectedReceiptno} 전표를 삭제했습니다.`, color: 'teal' });
      setDeleteOpen(false);
      setHeader({ ...EMPTY_HEADER, receptdate: localDate() });
      setReceiptMetadata({ companyid: '', companyname: '', created_at: '', updated_at: '' });
      setRows([]); setSelectedReceiptno(''); setSubulyn('N'); setDocumentDirty(false);
      await loadReceipts(page, filters);
    } catch (error) {
      notifications.show({ title: '입고 삭제 실패', message: errorMessage(error), color: 'red' });
    } finally { setSaving(false); }
  }, [selectedReceiptno, locked, loadReceipts, page, filters]);

  const rowContent = useCallback((index, row) => (
    <DetailCells row={row} index={index} selected={selectedSet.has(row.id)} disabled={saving || readOnly}
      managerEditable={Boolean(selectedReceiptno) && !locked && !saving} saved={readOnly} unitOptions={unitOptions}
      onSelect={toggleSelection} onChange={changeDetail} onPaste={pasteRange}
      registerCellInput={registerCellInput} onSelectItem={selectItem} onSelectCustomer={selectCustomerForRow} onSelectWarehouse={selectWarehouse} onSelectGeneralMaster={selectGeneralMaster} onFindItem={openItemPicker}
      onFindCustomer={openCustomerPicker} onFindMaster={openMasterPicker} onFocusCell={setActiveCell} />
  ), [selectedSet, saving, readOnly, selectedReceiptno, locked, unitOptions, toggleSelection, changeDetail, pasteRange, registerCellInput, selectItem, selectCustomerForRow, selectWarehouse, selectGeneralMaster, openItemPicker, openCustomerPicker, openMasterPicker, setActiveCell]);

  const detailAutoWidths = useMemo(() => Object.fromEntries(DETAIL_FIELDS.map(({ key, label, width, minWidth }) => (
    [key, fitColumnWidth(label, rows.map((row) => row[key]), width, minWidth || width)]
  ))), [rows]);
  const allRowsSelected = rows.length > 0 && selectedIds.length === rows.length;
  const headerColumns = [
    { key: 'select', width: 42, minWidth: 42, className: codeClasses.checkCol, label: <input type="checkbox" aria-label="상세 전체 선택" checked={allRowsSelected} onChange={(event) => toggleAll(event.currentTarget.checked)} /> },
    { key: 'number', width: 58, minWidth: 58, className: codeClasses.numberCol, label: 'No.' },
    ...DETAIL_FIELDS.map(({ key, label, width, minWidth, required }) => {
      const fittedWidth = detailAutoWidths[key];
      return { key, width: fittedWidth, minWidth: minWidth || width, label: <>{label}{required && <span className={codeClasses.required}> *</span>}</> };
    }),
  ];
  const tableWidth = headerColumns.reduce((sum, column) => sum + (columnWidths[column.key] ?? column.width), 0);
  const detailSubtotals = useMemo(() => rows.reduce((totals, row) => {
    totals.qty += Number(cleanNumericInput(row.qty)) || 0;
    totals.weight += Number(cleanNumericInput(row.weight)) || 0;
    totals.amount += Number(amountOf(row, unitOptions.price)) || 0;
    totals.vat += Number(vatOf(row, unitOptions.price)) || 0;
    totals.total += Number(totalAmountOf(row, unitOptions.price)) || 0;
    return totals;
  }, { qty: 0, weight: 0, amount: 0, vat: 0, total: 0 }), [rows, unitOptions.price]);
  const quantitySummary = useMemo(() => {
    if (!rows.length) return '0';
    const totals = new Map();
    const defaultUnit = unitOptions.quantity.find((option) => option.code === 'EA')?.name || 'EA';
    rows.forEach((row) => {
      const unitCode = resolveMasterCode('qtyunit', row.qtyunit, unitOptions);
      const unit = unitOptions.quantity.find((option) => option.code === unitCode)?.name || row.qtyunit || defaultUnit;
      const quantity = Number(cleanNumericInput(row.qty)) || 0;
      totals.set(unit, (totals.get(unit) || 0) + quantity);
    });
    return [...totals.entries()].map(([unit, quantity]) => `${quantity.toLocaleString(undefined, { maximumFractionDigits: 3 })}${unit}`).join(', ');
  }, [rows, unitOptions]);
  const renderHeader = (column) => (
    <Table.Th key={column.key} className={[codeClasses.resizableHeader, column.className].filter(Boolean).join(' ')} style={{ width: columnWidths[column.key] ?? column.width }}>
      <span style={{ whiteSpace: 'nowrap' }}>{column.label}</span><span className={codeClasses.columnResizeHandle} onPointerDown={(event) => resizeColumn(event, column.key, column.width, column.minWidth, tableWidth)} role="separator" aria-label={`${column.key} 열 너비 조절`} />
    </Table.Th>
  );
  const receiptTableWidth = RECEIPT_COLUMNS.reduce((sum, column) => sum + (receiptColumnWidths[column.key] ?? receiptAutoWidths[column.key] ?? column.width), 0);
  const receiptSubtotals = receipts.reduce((totals, receipt) => {
    for (const key of ['line_count', 'total_qty', 'total_weight', 'supply_amount', 'vat_amount', 'total_amount']) {
      totals[key] += Number(receipt[key]) || 0;
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
      <span style={{ whiteSpace: 'nowrap' }}>{column.label}</span><span className={codeClasses.columnResizeHandle} onPointerDown={(event) => resizeReceiptColumn(event, column.key, column.width, column.minWidth)} role="separator" aria-label={`${column.label} 열 너비 조절`} />
    </Table.Th>
  );

  return (
    <Box className={`${sharedClasses.pageShell} ${classes.page}`}>
      <Box component="nav" aria-label="현재 위치" className={classes.pageBreadcrumb}>
        <Group className={classes.breadcrumbTrail} gap={7}>
          <Text component="span" className={classes.breadcrumbParent}>입고관리</Text>
          <Text component="span" className={classes.breadcrumbChevron}>›</Text>
          <Text component="span" className={classes.breadcrumbCurrent}>입고등록</Text>
        </Group>
        {!filterOpen && (
          <Button className={classes.receiptFilterToggle} variant="subtle" size="xs"
            leftSection={<IconFilter size={15} />} onClick={() => setFilterOpen(true)}>
            조회조건
          </Button>
        )}
      </Box>

      <Box className={`${classes.inboundWorkspace} ${!filterOpen ? classes.inboundWorkspaceExpanded : ''}`}>
        <Box className={classes.inboundPrimaryColumn}>

      <Paper className={`${sharedClasses.panel} ${classes.topReceiptPanel}`} withBorder>
        <Group className={classes.topReceiptToolbar} justify="space-between" wrap="wrap">
          <Group gap={8}><Text className={classes.sectionTitle} fw={700}>입고 기본</Text><Badge color="gray" variant="light">{total.toLocaleString()}건</Badge></Group>
        </Group>
        <Box ref={receiptTableRef} className={classes.topReceiptTable}>
          <Table className={classes.receiptFinderTable} stickyHeader highlightOnHover withTableBorder withColumnBorders style={{ width: '100%', minWidth: `${receiptTableWidth}px`, tableLayout: 'fixed' }}>
            <colgroup>{RECEIPT_COLUMNS.map((column) => <col key={column.key} data-column-key={column.key} style={{ width: `${receiptColumnWidths[column.key] ?? receiptAutoWidths[column.key] ?? column.width}px` }} />)}</colgroup>
            <Table.Thead><Table.Tr>{RECEIPT_COLUMNS.map(renderReceiptHeader)}</Table.Tr></Table.Thead>
            <Table.Tbody>
              {receipts.map((receipt) => <Table.Tr key={receipt.receiptno} className={`${classes.receiptFinderRow} ${selectedReceiptno === receipt.receiptno ? classes.receiptFinderRowActive : ''}`} onClick={() => { void openReceipt(receipt.receiptno, true); }}>
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
          {!receipts.length && <Box className={classes.topReceiptEmptyMessage}>{loading ? '조회 중입니다.' : '검색된 입고전표가 없습니다.'}</Box>}
        </Box>
        <Box className={classes.topReceiptBottom}>
          {!!receipts.length && <Box ref={receiptSubtotalRef} className={classes.topReceiptSubtotalViewport}>
            <Table className={`${classes.receiptFinderTable} ${classes.receiptSubtotalTable}`} withTableBorder withColumnBorders
              style={{ width: '100%', minWidth: `${receiptTableWidth}px`, tableLayout: 'fixed' }}>
              <colgroup>{RECEIPT_COLUMNS.map((column) => <col key={column.key} data-column-key={column.key} style={{ width: `${receiptColumnWidths[column.key] ?? receiptAutoWidths[column.key] ?? column.width}px` }} />)}</colgroup>
              <Table.Tbody><Table.Tr>
                {RECEIPT_COLUMNS.map((column, index) => <Table.Td key={column.key} className={`${classes.topReceiptSubtotalCell} ${column.align === 'right' ? classes.topReceiptSubtotalNumber : ''}`} ta={column.align}>
                {index === 0 ? '소계' : column.key === 'line_count' ? receiptSubtotals.line_count.toLocaleString()
                  : column.key === 'total_qty' || column.key === 'total_weight' ? receiptSubtotals[column.key].toLocaleString(undefined, { maximumFractionDigits: 3 })
                    : ['supply_amount', 'vat_amount', 'total_amount'].includes(column.key) ? formatWon(String(receiptSubtotals[column.key])) : ''}
                </Table.Td>)}
              </Table.Tr></Table.Tbody>
            </Table>
          </Box>}
          <Box className={classes.topReceiptHorizontalScroll} onScroll={(event) => syncReceiptScroll(event.currentTarget.scrollLeft)} aria-label="입고 기본 가로 스크롤">
            <Box className={classes.topReceiptHorizontalContent} style={{ width: `max(100%, ${receiptTableWidth}px)` }} />
          </Box>
        </Box>
        <Group className={classes.topReceiptPagination} justify="space-between">
          <Group className={classes.topReceiptPageSize} gap="xs">
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
              <Text className={classes.sectionTitle} fw={700}>입고 상세</Text>
              <Badge color="gray" variant="light">{rows.length.toLocaleString()}행</Badge>
              {selectedReceiptno && <Badge color="gray" variant="light">{selectedReceiptno}</Badge>}
            </Group>
            <Group gap={8} align="center">
              {selectedReceiptno && <Badge color={locked ? 'green' : 'gray'} variant="light">{locked ? '수불 확정' : '저장됨 · 담당자 수정 가능'}</Badge>}
              {selectedIds.length > 0 && <Badge color="gray" variant="light">{selectedIds.length}개 선택</Badge>}
            </Group>
          </Group>

          <Box ref={detailScrollerRef} className={`${codeClasses.tableWrap} ${(rows.length <= 100 || (selectedReceiptno && rows.length <= 200)) ? classes.savedDetailScroller : ''} ${!detailLoading && !rows.length ? classes.emptyDetailWrap : ''}`} style={{ '--code-table-min-width': `${Math.max(1120, tableWidth)}px` }} onKeyDown={handleTableKeyDown}>
            {detailLoading ? <Box className={classes.receiptLoading}><Loader size="sm" color="red" /></Box> : rows.length ? (
              (rows.length <= 100 || (selectedReceiptno && rows.length <= 200)) ? <>
                <Table className={`${sharedClasses.table} ${codeClasses.codeTable}`} highlightOnHover withTableBorder withColumnBorders verticalSpacing="xs" horizontalSpacing={0}
                  style={{ width: '100%', minWidth: 'var(--code-table-min-width)', tableLayout: 'fixed' }}>
                  <Table.Thead><Table.Tr>{headerColumns.map(renderHeader)}</Table.Tr></Table.Thead>
                  <Table.Tbody>{rows.map((row, index) => <Table.Tr key={row.id} className={[row.is_new && codeClasses.newRow, row.is_new && classes.newRow].filter(Boolean).join(' ')}>{rowContent(index, row)}</Table.Tr>)}</Table.Tbody>
                </Table>
              </> : <TableVirtuoso ref={virtuosoRef} data={rows} style={{ height: '100%' }} components={virtuosoComponents} computeItemKey={(_index, row) => row.id} increaseViewportBy={{ top: 84, bottom: 84 }} fixedHeaderContent={() => <Table.Tr>{headerColumns.map(renderHeader)}</Table.Tr>} itemContent={rowContent} />
            ) : (
              <Table className={`${sharedClasses.table} ${codeClasses.codeTable}`} highlightOnHover withTableBorder withColumnBorders verticalSpacing="xs" horizontalSpacing={0}
                style={{ width: '100%', minWidth: 'var(--code-table-min-width)', tableLayout: 'fixed' }}>
                <Table.Thead><Table.Tr>{headerColumns.map(renderHeader)}</Table.Tr></Table.Thead>
              </Table>
            )}
            {!detailLoading && !rows.length && (
              <Box className={classes.emptyDetailMessage}>
                {selectedReceiptno ? '입고 상세가 없습니다.' : '상단 헤더의 추가를 눌러 품목을 등록하세요.'}
              </Box>
            )}
          </Box>
          <Group className={`${sharedClasses.footer} ${codeClasses.tableFooter}`} justify="space-between" wrap="wrap">
            <Text size="xs" c="dimmed">엑셀 셀 범위를 붙여넣고 저장할 수 있습니다.</Text>
            <Text size="xs" fw={700}>
              총 수량 {quantitySummary} · 총 중량 {detailSubtotals.weight.toLocaleString(undefined, { maximumFractionDigits: 3 })}{rows.length ? 'KG' : ''}
              {' · '}총공급가 {formatWon(detailSubtotals.amount.toFixed(2))}
              {' · '}부가세 {formatWon(detailSubtotals.vat.toFixed(2))}
              {' · '}합계 {formatWon(detailSubtotals.total.toFixed(2))}
            </Text>
          </Group>
        </Paper>
      </Box>
        </Box>

        {filterOpen && <Paper component="aside" className={classes.receiptFilterSidebar} withBorder>
            <Group className={classes.receiptFilterHeader} justify="space-between" align="center">
              <Text fw={700}>조회조건</Text>
              <ActionIcon variant="subtle" color="gray" aria-label="조회조건 닫기" onClick={() => setFilterOpen(false)}>
                <IconX size={16} />
              </ActionIcon>
            </Group>
          <Stack gap="sm" className={classes.receiptFilterFields}>
            <Box>
              <Text size="xs" fw={700} mb={5}>입고기간</Text>
              <Stack gap={6}>
                <TextInput type="date" aria-label="입고기간 시작일" value={filterInputs.date_from}
                  onChange={(event) => setFilterInputs((current) => ({ ...current, date_from: event.currentTarget.value }))}
                  onKeyDown={(event) => { if (event.key === 'Enter') runSearch(); }} />
                <TextInput type="date" aria-label="입고기간 종료일" value={filterInputs.date_to}
                  onChange={(event) => setFilterInputs((current) => ({ ...current, date_to: event.currentTarget.value }))}
                  onKeyDown={(event) => { if (event.key === 'Enter') runSearch(); }} />
              </Stack>
            </Box>
            <TextInput label="매입처" placeholder="매입처코드 또는 매입처명" value={filterInputs.customer}
              onChange={(event) => setFilterInputs((current) => ({ ...current, customer: event.currentTarget.value }))}
              onKeyDown={(event) => { if (event.key === 'Enter') runSearch(); }} />
            <TextInput label="창고" placeholder="창고코드 또는 창고명" value={filterInputs.warehouse}
              onChange={(event) => setFilterInputs((current) => ({ ...current, warehouse: event.currentTarget.value }))}
              onKeyDown={(event) => { if (event.key === 'Enter') runSearch(); }} />
            <TextInput label="입고전표번호" placeholder="전표번호" value={filterInputs.receiptno}
              onChange={(event) => setFilterInputs((current) => ({ ...current, receiptno: event.currentTarget.value }))}
              onKeyDown={(event) => { if (event.key === 'Enter') runSearch(); }} />
            </Stack>
        </Paper>}
      </Box>

      <Modal opened={deleteOpen} onClose={() => !saving && setDeleteOpen(false)} title="입고전표 삭제" centered size="sm">
        <Stack gap="md">
          <Text size="sm" c="dimmed">{selectedReceiptno} 전표와 상세 내역을 삭제합니다. 삭제한 전표는 복구할 수 없습니다.</Text>
          <Group justify="flex-end"><Button variant="default" onClick={() => setDeleteOpen(false)} disabled={saving}>취소</Button><Button color="red" leftSection={<IconTrash size={15} />} onClick={requestDeleteReceipt} loading={saving}>삭제</Button></Group>
        </Stack>
      </Modal>

      <CustomerPickerModal opened={customerPickerOpen} onClose={() => { setCustomerPickerOpen(false); setCustomerPickerTarget(null); }} onSelect={selectCustomer} />
      <ItemPickerModal opened={itemPickerTarget !== null} onClose={() => setItemPickerTarget(null)} onSelect={selectItemFromPicker} />
      <MasterOptionPickerModal
        key={masterPickerTarget ? `${masterPickerTarget.id}:${masterPickerTarget.field}` : 'closed'}
        opened={Boolean(masterPickerTarget)}
        onClose={() => setMasterPickerTarget(null)}
        title={masterPickerTarget?.field === 'qtyunit' ? '수량단위 선택' : masterPickerTarget?.field === 'unit' ? '단가기준 선택' : masterPickerTarget?.field === 'material' ? '강종 선택' : masterPickerTarget?.field === 'surface' ? '표면 선택' : '창고 선택'}
        options={masterPickerTarget?.field === 'qtyunit' ? unitOptions.quantity : masterPickerTarget?.field === 'unit' ? unitOptions.price : masterPickerTarget?.field === 'material' ? unitOptions.material : masterPickerTarget?.field === 'surface' ? unitOptions.surface : unitOptions.warehouse}
        onSelect={selectMasterOption}
      />
    </Box>
  );
}
