import { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import {
  ActionIcon, Badge, Box, Button, Group, Loader, Modal, Pagination, Paper,
  ScrollArea, Stack, Table, Text, TextInput, Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconCopy, IconDeviceFloppy, IconFileSpreadsheet, IconFilter, IconPlus,
  IconPrinter, IconSearch, IconTrash, IconX,
} from '@tabler/icons-react';
import { TableVirtuoso } from 'react-virtuoso';
import * as XLSX from 'xlsx';
import { applyExcelHeaderStyle } from '../utils/excelHeaderStyle';
import sharedClasses from '../styles/pages/ManagementShared.module.css';
import codeClasses from '../styles/pages/CodeMasterPage.module.css';
import classes from '../styles/pages/OutboundRegister.module.css';
import inboundClasses from '../styles/pages/InboundRegister.module.css';
import { PageRibbonContext } from '../components/layout/MainLayout';

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
  { key: 'itemcode', label: '품목코드', width: 150, required: true },
  { key: 'itemname', label: '품목명', width: 190, required: true },
  { key: 'thickness', label: '두께', width: 90 },
  { key: 'width', label: '폭', width: 90 },
  { key: 'length', label: '길이', width: 90 },
  { key: 'qty', label: '수량', width: 100, required: true },
  { key: 'qtyunit', label: '수량단위', width: 110, required: true },
  { key: 'warehousecode', label: '창고코드', width: 125, required: true },
  { key: 'warehousecodename', label: '창고명', width: 150 },
  { key: 'current_qty', label: '현재수량', width: 115 },
  { key: 'current_weight', label: '현재중량', width: 115 },
  { key: 'weight', label: '출고중량', width: 120, required: true },
  { key: 'unit', label: '단가기준', width: 110, required: true },
  { key: 'unitprice', label: '판매단가', width: 120, required: true },
  { key: 'unitamt', label: '출고금액', width: 130 },
  { key: 'description', label: '비고', width: 190 },
];
const RECEIPT_COLUMNS = [
  { key: 'receptdate', label: '출고일자', width: 120, minWidth: 100 },
  { key: 'customcode', label: '거래처코드', width: 130, minWidth: 110 },
  { key: 'customname', label: '거래처명', width: 220, minWidth: 150 },
  { key: 'warehousecode', label: '창고코드', width: 130, minWidth: 100 },
  { key: 'warehousecodename', label: '창고명', width: 160, minWidth: 120 },
  { key: 'line_count', label: '상세건수', width: 95, minWidth: 80, align: 'right' },
  { key: 'total_qty', label: '수량', width: 110, minWidth: 90, align: 'right' },
  { key: 'total_weight', label: '중량', width: 120, minWidth: 100, align: 'right' },
  { key: 'supply_amount', label: '공급가', width: 145, minWidth: 120, align: 'right' },
  { key: 'vat_amount', label: '부가세', width: 125, minWidth: 100, align: 'right' },
  { key: 'total_amount', label: '합계금액', width: 150, minWidth: 120, align: 'right' },
  { key: 'receiptno', label: '출고전표', width: 190, minWidth: 150 },
  { key: 'description', label: '비고', width: 200, minWidth: 140 },
];
const READ_ONLY_DETAIL_FIELDS = new Set(['itemname', 'warehousecodename', 'current_qty', 'current_weight', 'unitamt']);
const NAVIGABLE_FIELDS = DETAIL_FIELDS.map(({ key }) => key).filter((key) => !READ_ONLY_DETAIL_FIELDS.has(key));
const EDITABLE_FIELDS = NAVIGABLE_FIELDS;
const EMPTY_DETAIL = { itemcode: '', itemname: '', thickness: '', width: '', length: '', qty: '', qtyunit: 'EA', warehousecode: '', warehousecodename: '', current_qty: '0', current_weight: '0', weight: '', unit: '', unitprice: '', unitamt: '', description: '' };
const masterPasteErrorKey = (rowId, field) => `${rowId}:${field}`;

const errorMessage = (error) => {
  const detail = error.response?.data?.detail;
  if (Array.isArray(detail)) return detail.slice(0, 5).map((item) => item.msg || String(item)).join(' / ');
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
  if (!String(row.weight ?? '').trim() || !String(row.unitprice ?? '').trim()) return '';
  const weight = Number(row.weight);
  const price = Number(row.unitprice);
  if (!Number.isFinite(weight) || !Number.isFinite(price)) return '';
  const unitName = priceUnits.find((option) => option.code === row.unit)?.name || '';
  const unitToken = `${row.unit || ''} ${unitName}`.toLocaleUpperCase();
  const quantity = /TON|톤/.test(unitToken) ? weight / 1000 : weight;
  return (quantity * price).toFixed(2);
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
      if (requestId === requestIdRef.current) notifications.show({ title: '거래처 조회 실패', message: errorMessage(error), color: 'red' });
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

  return <Modal opened={opened} onClose={invalidatePending} title={<PickerModalTitle title="거래처 선택" />} classNames={{ content: classes.receiptFinderModalContent, header: classes.receiptFinderModalHeader, title: classes.receiptFinderModalTitle, close: classes.receiptFinderModalClose }} centered size={900}>
    <Stack gap="sm" pt={10}>
      <Group gap={7} wrap="nowrap">
        <TextInput className={classes.customerSearchInput} placeholder="거래처코드 또는 거래처명 검색" value={searchInput}
          onChange={(event) => setSearchInput(event.currentTarget.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') searchCustomers(); }}
          leftSection={<IconSearch size={15} />} size="sm" autoFocus />
        <Button color="red" size="sm" leftSection={<IconSearch size={15} />} onClick={searchCustomers}>조회</Button>
      </Group>
      <Box className={classes.pickerResults}>
        {loading && <Loader className={classes.pickerLoader} size="xs" color="red" aria-label="조회 중" />}
        <ScrollArea h={420} type="auto" scrollbarSize={6}>
          <Table className={`${codeClasses.codeTable} ${classes.pickerTable}`} highlightOnHover withTableBorder withColumnBorders>
            <Table.Thead><Table.Tr><Table.Th className={classes.customerCodeColumn}>거래처코드</Table.Th><Table.Th className={classes.customerNameColumn}>거래처명</Table.Th><Table.Th className={classes.customerBusinessColumn}>사업자번호</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>
              {customers.map((customer) => (
                <Table.Tr key={customer.customercode} className={classes.customerResultRow} onClick={() => onSelect(customer)}>
                  <Table.Td>{customer.customercode}</Table.Td><Table.Td>{customer.customername}</Table.Td><Table.Td>{customer.businessno || ''}</Table.Td>
                </Table.Tr>
              ))}
              {!customers.length && <Table.Tr><Table.Td colSpan={3} className={classes.customerEmpty}>{loading ? '조회 중입니다.' : '조회된 거래처가 없습니다.'}</Table.Td></Table.Tr>}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Box>
      <Group justify="space-between"><Text size="xs" c="dimmed">총 {total.toLocaleString()}개 거래처</Text><Pagination size="sm" total={Math.max(1, Math.ceil(total / 20))} value={page} onChange={changePage} withEdges color="red" disabled={loading} /></Group>
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

const DetailCells = memo(function DetailCells({ row, index, selected, disabled, saved, unitOptions, onSelect, onChange, onPaste, registerCodeInput, registerCellInput, onFindItem, onFindMaster, onFocusCell, onDelete }) {
  const displayValue = (key) => {
    if (key === 'qtyunit') return unitOptions.quantity.find((option) => option.code === row.qtyunit)?.name || row.qtyunit || '';
    if (key === 'unit') return unitOptions.price.find((option) => option.code === row.unit)?.name || row.unit || '';
    if (key === 'current_qty' || key === 'current_weight') return formatNumericInput(row[key] ?? 0);
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
    <Table.Td className={`${codeClasses.rowNumber} ${saved ? classes.savedCell : ''}`}>{index + 1}</Table.Td>
    {DETAIL_FIELDS.map(({ key, label }) => (
      <Table.Td key={key} className={saved ? classes.savedCell : ''}>
        {key === 'unitamt' ? (
          <input className={`${codeClasses.cellInput} ${classes.amountInput}`} aria-label={label} value={formatAmount(amountOf(row, unitOptions.price))} readOnly />
        ) : (
          <input
            ref={(element) => {
              if (key === 'itemcode') registerCodeInput(row.id, element);
              registerCellInput(row.id, key, element);
            }}
            className={`${codeClasses.cellInput} ${READ_ONLY_DETAIL_FIELDS.has(key) ? classes.autoFilledInput : ''} ${key === 'current_qty' || key === 'current_weight' ? classes.currentStockInput : ''} ${key === 'itemcode' || key === 'unit' || key === 'qtyunit' || key === 'warehousecode' ? classes.itemCodePickerInput : ''}`}
            aria-label={label}
            title={['itemcode', 'unit', 'qtyunit', 'warehousecode'].includes(key) ? `${label} - 더블클릭하여 마스터에서 선택` : undefined}
            data-row-id={row.id}
            data-field={key}
            inputMode={NUMERIC_FIELDS.has(key) ? 'decimal' : undefined}
            value={displayValue(key)}
            placeholder={row.is_new && (key === 'itemcode' || key === 'itemname') ? label : ''}
            readOnly={READ_ONLY_DETAIL_FIELDS.has(key)}
            disabled={disabled}
            onFocus={() => onFocusCell(row.id, key)}
            onDoubleClick={key === 'itemcode' ? () => onFindItem(row.id) : ['unit', 'qtyunit', 'warehousecode'].includes(key) ? () => onFindMaster(row.id, key) : undefined}
            onPaste={pasteHandler(key)}
            onChange={(event) => onChange(row.id, key, NUMERIC_FIELDS.has(key) ? cleanNumericInput(event.currentTarget.value) : event.currentTarget.value)}
          />
        )}
      </Table.Td>
    ))}
    <Table.Td className={`${codeClasses.actionCol} ${saved ? classes.savedCell : ''}`}>
      <Tooltip label="상세 행 삭제"><ActionIcon variant="subtle" color="red" aria-label="상세 행 삭제" disabled={disabled} onClick={() => onDelete(row.id)}><IconTrash size={16} /></ActionIcon></Tooltip>
    </Table.Td>
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
  const [receiptFinderOpen, setReceiptFinderOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(true);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [detailDeleteOpen, setDetailDeleteOpen] = useState(false);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkValues, setBulkValues] = useState({ qtyunit: '', warehousecode: '', unit: '' });
  const [columnWidths, setColumnWidths] = useState({});
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [itemPickerTargetId, setItemPickerTargetId] = useState('');
  const [masterPickerTarget, setMasterPickerTarget] = useState(null);
  const [unitOptions, setUnitOptions] = useState({ price: [], quantity: [], warehouse: [] });
  const virtuosoRef = useRef(null);
  const codeInputsRef = useRef(new Map());
  const cellInputsRef = useRef(new Map());
  const codeLookupTimersRef = useRef(new Map());
  const masterPasteErrorsRef = useRef(new Map());
  const activeCellRef = useRef(null);
  const pendingCellFocusRef = useRef(null);
  const pendingFocusIdRef = useRef('');
  const selectionAnchorRef = useRef('');
  const originalStockRef = useRef(new Map());
  const receiptTableRef = useRef(null);
  const receiptSubtotalRef = useRef(null);
  const locked = isReceiptConfirmed(subulyn);
  const readOnly = locked;
  const hasPendingChanges = documentDirty || rows.some((row) => row.is_new || row.is_dirty);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

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

  useEffect(() => { void loadReceipts(1, createDefaultReceiptFilters()); }, []);

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

  const stockLookupKey = useMemo(() => rows.map((row) => [
    String(row.itemcode || '').trim(), String(row.thickness || '').trim(), String(row.width || '').trim(), String(row.length || '').trim(),
    resolveMasterCode('warehouse', row.warehousecode || row.warehousecodename, unitOptions) || String(row.warehousecode || '').trim(),
    resolveMasterCode('qtyunit', row.qtyunit, unitOptions) || String(row.qtyunit || '').trim(),
  ].join('\u001f')).join('\u001e'), [rows, unitOptions]);

  useEffect(() => {
    let cancelled = false;
    const candidates = rows.map((row) => ({
      row,
      warehousecode: resolveMasterCode('warehouse', row.warehousecode || row.warehousecodename, unitOptions) || String(row.warehousecode || '').trim(),
      qtyunit: resolveMasterCode('qtyunit', row.qtyunit, unitOptions) || String(row.qtyunit || '').trim(),
    })).filter(({ row, warehousecode, qtyunit }) => row.itemcode && warehousecode && qtyunit);
    if (!candidates.length) {
      setRows((current) => current.map((row) => ({ ...row, current_qty: '0', current_weight: '0' })));
      return () => { cancelled = true; };
    }
    axios.post('/api/current-stock/lookup', {
      items: candidates.map(({ row, warehousecode, qtyunit }) => ({
        itemcode: String(row.itemcode).trim(),
        thickness: row.thickness || null, width: row.width || null, length: row.length || null,
        warehousecode,
        qtyunit,
      })),
    }, authConfig()).then(({ data }) => {
      if (cancelled) return;
      const values = data.items || [];
      let lookupIndex = 0;
      setRows((current) => current.map((row) => {
        const warehousecode = resolveMasterCode('warehouse', row.warehousecode || row.warehousecodename, unitOptions) || String(row.warehousecode || '').trim();
        const qtyunit = resolveMasterCode('qtyunit', row.qtyunit, unitOptions) || String(row.qtyunit || '').trim();
        if (!row.itemcode || !warehousecode || !qtyunit) {
          return { ...row, current_qty: '0', current_weight: '0' };
        }
        const stock = values[lookupIndex++] || {};
        return { ...row, current_qty: String(stock.current_qty ?? 0), current_weight: String(stock.current_weight ?? 0) };
      }));
    }).catch((error) => {
      if (!cancelled) notifications.show({ title: '현재고 조회 실패', message: errorMessage(error), color: 'red' });
    });
    return () => { cancelled = true; };
  // The key only changes when a stock identity field changes. Stock values themselves do not retrigger this request.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stockLookupKey, unitOptions]);

  const openCustomerPicker = useCallback(() => {
    if (!readOnly && !saving) setCustomerPickerOpen(true);
  }, [readOnly, saving]);

  const selectCustomer = useCallback((customer) => {
    setHeader((current) => ({
      ...current,
      customcode: customer.customercode || '',
      customname: customer.customername || '',
    }));
    setDocumentDirty(true);
    setCustomerPickerOpen(false);
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
      notifications.show({ title: '저장되지 않은 변경사항', message: '현재 출고 내용을 먼저 저장해 주세요.', color: 'orange' });
      return false;
    }
    setDetailLoading(true);
    try {
      const { data } = await axios.get(`/api/outbound-register/receipts/${encodeURIComponent(receiptno)}`, authConfig());
      const receipt = data.receipt;
      const loadedRows = (receipt.items || []).map((item) => makeDetail(item, item.lineno));
      const originalStock = new Map();
      loadedRows.forEach((row) => {
        const warehousecode = resolveMasterCode('warehouse', row.warehousecode || row.warehousecodename, unitOptions) || row.warehousecode;
        const qtyunit = resolveMasterCode('qtyunit', row.qtyunit, unitOptions) || row.qtyunit;
        const key = [row.itemcode, row.thickness || 0, row.width || 0, row.length || 0, warehousecode, qtyunit].map((value) => String(value || '').trim()).join('\u001f');
        const previous = originalStock.get(key) || { qty: 0, weight: 0 };
        originalStock.set(key, { qty: previous.qty + Number(row.qty || 0), weight: previous.weight + Number(row.weight || 0) });
      });
      originalStockRef.current = originalStock;
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
  }, [hasPendingChanges, unitOptions]);

  const createReceipt = useCallback(() => {
    if (hasPendingChanges) {
      notifications.show({ title: '저장되지 않은 변경사항', message: '현재 출고 내용을 먼저 저장해 주세요.', color: 'orange' });
      return;
    }
    setHeader({ ...EMPTY_HEADER, receptdate: localDate() });
    setReceiptMetadata({ companyid: '', companyname: '', created_at: '', updated_at: '' });
    setRows([]);
    originalStockRef.current = new Map();
    setSelectedReceiptno('');
    setSubulyn('N');
    setDocumentDirty(false);
    setSelectedIds([]);
    selectionAnchorRef.current = '';
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

  const changeHeader = useCallback((key, value) => {
    setHeader((current) => ({ ...current, [key]: value }));
    setDocumentDirty(true);
  }, []);
  const changeDetail = useCallback((id, key, value) => {
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
  }, [lookupItemNames, unitOptions, selectedIds, selectedSet]);

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
    if (readOnly) return;
    const row = makeDetail();
    pendingFocusIdRef.current = row.id;
    setRows((current) => [...current, row]);
    setDocumentDirty(true);
    selectionAnchorRef.current = '';
    requestAnimationFrame(() => {
      virtuosoRef.current?.scrollToIndex({ index: rows.length, align: 'end', behavior: 'auto' });
      codeInputsRef.current.get(row.id)?.focus();
    });
  }, [readOnly, rows.length]);

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

  const applyBulkMasterChanges = useCallback(() => {
    const hasChanges = Object.values(bulkValues).some(Boolean);
    if (selectedIds.length < 2 || !hasChanges) return;
    const warehouse = unitOptions.warehouse.find((item) => item.code === bulkValues.warehousecode);
    selectedIds.forEach((id) => {
      if (bulkValues.unit) masterPasteErrorsRef.current.delete(masterPasteErrorKey(id, 'unit'));
      if (bulkValues.qtyunit) masterPasteErrorsRef.current.delete(masterPasteErrorKey(id, 'qtyunit'));
      if (bulkValues.warehousecode) masterPasteErrorsRef.current.delete(masterPasteErrorKey(id, 'warehouse'));
    });
    setRows((current) => current.map((row) => {
      if (!selectedSet.has(row.id)) return row;
      const updated = {
        ...row,
        ...(bulkValues.unit ? { unit: bulkValues.unit } : {}),
        ...(bulkValues.qtyunit ? { qtyunit: bulkValues.qtyunit } : {}),
        ...(bulkValues.warehousecode ? {
          warehousecode: bulkValues.warehousecode,
          warehousecodename: warehouse?.name || '',
        } : {}),
      };
      return { ...updated, is_dirty: !updated.is_new };
    }));
    setDocumentDirty(true);
    setBulkEditOpen(false);
    setBulkValues({ qtyunit: '', warehousecode: '', unit: '' });
    notifications.show({
      title: '선택 행 일괄 변경 완료',
      message: `${selectedIds.length.toLocaleString()}개 행에 선택한 변경 값을 적용했습니다.`,
      color: 'teal',
    });
  }, [bulkValues, selectedIds, selectedSet, unitOptions.warehouse]);

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

  const deleteDetail = useCallback((id) => {
    setRows((current) => current.filter((row) => row.id !== id));
    setSelectedIds((current) => current.filter((value) => value !== id));
    setDocumentDirty(true);
  }, []);
  const requestDeleteSelectedDetails = useCallback(() => {
    if (!selectedIds.length || readOnly) return;
    setDetailDeleteOpen(true);
  }, [selectedIds.length, readOnly]);

  const deleteSelectedDetails = useCallback(() => {
    if (!selectedIds.length || readOnly) return;
    const deleteCount = selectedIds.length;
    const ids = new Set(selectedIds);
    setRows((current) => current.filter((row) => !ids.has(row.id)));
    setSelectedIds([]);
    selectionAnchorRef.current = '';
    setDocumentDirty(true);
    setDetailDeleteOpen(false);
    notifications.show({
      title: '상세 행 삭제 완료',
      message: `선택한 ${deleteCount.toLocaleString()}개 행을 입력 목록에서 제거했습니다. 저장해야 반영됩니다.`,
      color: 'teal',
    });
  }, [selectedIds, readOnly]);

  const validateDocument = useCallback(() => {
    const missing = [];
    if (selectedReceiptno && !header.receiptno.trim()) missing.push('출고전표번호');
    if (!header.receptdate) missing.push('출고일자');
    if (!header.customcode.trim()) missing.push('거래처코드');
    if (!rows.length) missing.push('상세 품목');
    if (missing.length) {
      notifications.show({ title: '필수 항목을 입력해 주세요', message: missing.join(', '), color: 'orange' });
      return false;
    }
    const failures = rows.flatMap((row, index) => {
      const errors = [];
      if (!String(row.itemcode || '').trim()) errors.push('품목코드');
      if (!String(row.itemname || '').trim()) errors.push('품목명');
      if (!String(row.unit || '').trim()) errors.push('단가기준');
      if (!String(row.qtyunit || '').trim()) errors.push('수량단위');
      const qtyText = String(row.qty ?? '').trim();
      const qty = Number(qtyText);
      if (!qtyText || !Number.isFinite(qty) || qty <= 0) errors.push('수량(0 초과)');
      if (!String(row.warehousecode || '').trim()) errors.push('창고코드');
      const weight = Number(row.weight);
      if (!String(row.weight || '').trim() || !Number.isFinite(weight) || weight <= 0) errors.push('출고중량(0 초과)');
      const unitprice = Number(row.unitprice);
      if (!String(row.unitprice || '').trim() || !Number.isFinite(unitprice) || unitprice < 0) errors.push('판매단가(0 이상)');
      return errors.length ? [`${index + 1}행 ${errors.join(', ')}`] : [];
    });
    const requestedByStock = new Map();
    rows.forEach((row) => {
      const warehousecode = resolveMasterCode('warehouse', row.warehousecode || row.warehousecodename, unitOptions) || row.warehousecode;
      const qtyunit = resolveMasterCode('qtyunit', row.qtyunit, unitOptions) || row.qtyunit;
      const key = [row.itemcode, row.thickness || 0, row.width || 0, row.length || 0, warehousecode, qtyunit].map((value) => String(value || '').trim()).join('\u001f');
      if (!row.itemcode || !warehousecode || !qtyunit || !Number.isFinite(Number(row.qty))) return;
      const original = originalStockRef.current.get(key) || { qty: 0, weight: 0 };
      const availableQty = Number(row.current_qty || 0) + original.qty;
      const availableWeight = Number(row.current_weight || 0) + original.weight;
      const entry = requestedByStock.get(key) || { requestedQty: 0, requestedWeight: 0, availableQty, availableWeight, row };
      entry.requestedQty += Number(row.qty);
      entry.requestedWeight += Number(row.weight);
      entry.availableQty = availableQty;
      entry.availableWeight = availableWeight;
      requestedByStock.set(key, entry);
    });
    requestedByStock.forEach(({ requestedQty, requestedWeight, availableQty, availableWeight, row }) => {
      if (requestedQty > availableQty || requestedWeight > availableWeight) {
        failures.push(`${row.itemcode} / ${row.warehousecodename || row.warehousecode}: 현재고 ${formatNumericInput(availableQty)}개 · ${formatNumericInput(availableWeight)}중량, 출고 요청 ${formatNumericInput(requestedQty)}개 · ${formatNumericInput(requestedWeight)}중량`);
      }
    });
    if (failures.length) {
      notifications.show({ title: '상세 입력을 확인해 주세요', message: failures.slice(0, 5).join(' / '), color: 'orange', autoClose: 8000 });
      return false;
    }
    return true;
  }, [header, rows, selectedReceiptno, unitOptions]);

  const validateDetailMasters = useCallback((sourceRows) => {
    const errors = [];
    sourceRows.forEach((row, index) => {
      const checks = [
        { field: 'unit', label: '단가단위', required: true, errorKey: 'unit' },
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
    if (locked) {
      notifications.show({ title: '수불 확정 전표', message: '수불 확정된 출고전표는 수정할 수 없습니다.', color: 'orange' });
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
        is_new: !selectedReceiptno,
        items: sourceRows.map((row) => ({
          itemcode: String(row.itemcode || '').trim(), itemname: String(row.itemname || '').trim(),
          thickness: String(row.thickness ?? '').trim(), width: String(row.width ?? '').trim(), length: String(row.length ?? '').trim(),
          unit: resolveMasterCode('unit', row.unit, unitOptions) || String(row.unit || '').trim(),
          qty: String(row.qty ?? '').trim(), qtyunit: resolveMasterCode('qtyunit', row.qtyunit, unitOptions) || String(row.qtyunit || '').trim(),
          warehousecode: resolveMasterCode('warehouse', row.warehousecode || row.warehousecodename, unitOptions) || String(row.warehousecode || '').trim(),
          warehousecodename: String(row.warehousecodename || '').trim(),
          weight: String(row.weight || '').trim(), unitprice: String(row.unitprice || '').trim(),
          description: String(row.description || '').trim(),
        })),
      };
      const { data } = await axios.put('/api/outbound-register/receipts', payload, authConfig());
      masterPasteErrorsRef.current.clear();
      notifications.show({
        title: '출고 저장 완료',
        message: `${data.receiptno} 전표의 상세 ${data.saved_count}건을 저장했습니다.`,
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
  }, [locked, selectedReceiptno, header, rows, unitOptions, validateDetailMasters, validateDocument, loadReceipts, openReceipt]);

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
        ['출고일자', () => header.receptdate],
        ['거래처코드', () => header.customcode],
        ['거래처명', () => header.customname],
        ['전표 비고', () => header.description],
        ['수불확정여부', () => subulyn],
        ['전표 등록일자', () => receiptMetadata.created_at],
        ['전표 수정일자', () => receiptMetadata.updated_at],
        ['순번', (row) => row.lineno],
        ...DETAIL_FIELDS.filter(({ key }) => !['current_qty', 'current_weight'].includes(key)).map(({ key, label }) => [
          `상세 ${label}`,
          (row) => key === 'unitamt'
            ? amountOf(row, unitOptions.price)
            : row[key] ?? '',
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
      XLSX.writeFile(workbook, `출고전표_${safeFilePart(header.customname || header.customcode)}_${safeFilePart(header.receptdate)}_${safeFilePart(header.receiptno)}.xlsx`);
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

  const handleToolbarAdd = useCallback(() => {
    addDetail();
  }, [addDetail]);

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

  const requestToolbarDelete = useCallback(() => {
    if (selectedIds.length && !readOnly) {
      requestDeleteSelectedDetails();
      return;
    }
    if (!selectedReceiptno) {
      notifications.show({ title: '삭제할 항목 없음', message: '출고전표를 선택하거나 상세 행을 선택해 주세요.', color: 'orange' });
      return;
    }
    if (hasPendingChanges) {
      notifications.show({ title: '저장되지 않은 변경사항', message: '삭제 전에 현재 변경사항을 먼저 정리해 주세요.', color: 'orange' });
      return;
    }
    setDeleteOpen(true);
  }, [selectedIds.length, readOnly, requestDeleteSelectedDetails, selectedReceiptno, hasPendingChanges]);

  useEffect(() => {
    if (!registerPageRibbon) return undefined;
    registerPageRibbon(
      <Group className={inboundClasses.commandRibbon} justify="flex-start" wrap="nowrap" gap={2}>
        <Button className={inboundClasses.ribbonTool} variant="subtle" size="sm" leftSection={<IconSearch size={15} />} onClick={runSearch} loading={loading}>조회</Button>
        <span className={inboundClasses.ribbonSeparator} />
        <Button className={inboundClasses.ribbonTool} variant="subtle" size="sm" leftSection={<IconPlus size={15} />} onClick={handleToolbarAdd} disabled={saving || locked}>추가</Button>
        <Button className={inboundClasses.ribbonTool} variant="subtle" size="sm" leftSection={<IconCopy size={15} />} onClick={copySelectedDetails} disabled={readOnly || saving || selectedIds.length !== 1}>복사</Button>
        <Button className={inboundClasses.ribbonTool} variant="subtle" size="sm" leftSection={<IconFileSpreadsheet size={15} />} onClick={exportDocument} loading={exporting} disabled={!selectedReceiptno || loading || detailLoading || !rows.length}>EXCEL</Button>
        <Button className={`${inboundClasses.ribbonTool} ${inboundClasses.ribbonSave}`} variant="subtle" size="sm" leftSection={<IconDeviceFloppy size={15} />} onClick={() => saveDocument()} loading={saving} disabled={readOnly || detailLoading}>저장</Button>
        <Button className={inboundClasses.ribbonTool} variant="subtle" size="sm" leftSection={<IconTrash size={15} />} onClick={requestToolbarDelete} disabled={saving || locked || (!selectedReceiptno && (!selectedIds.length || readOnly))}>삭제</Button>
        <Button className={inboundClasses.ribbonTool} variant="subtle" size="sm" leftSection={<IconPrinter size={15} />} onClick={() => window.print()}>인쇄</Button>
        <span className={inboundClasses.ribbonSeparator} />
        <Button className={inboundClasses.ribbonTool} variant="subtle" size="sm" leftSection={<IconX size={15} />} onClick={closeActivePage}>닫기</Button>
      </Group>,
    );
    return () => registerPageRibbon(null);
  }, [registerPageRibbon, closeActivePage, runSearch, loading, handleToolbarAdd, copySelectedDetails, readOnly, saving, selectedIds.length, exportDocument, exporting, selectedReceiptno, rows.length, detailLoading, saveDocument, requestToolbarDelete, locked]);

  const openReceiptFinder = useCallback(() => {
    setReceiptFinderOpen(true);
    setFilterInputs({ ...filters });
    loadReceipts(1, filters);
  }, [loadReceipts, filters]);

  const requestDeleteReceipt = useCallback(async () => {
    if (!selectedReceiptno || locked) return;
    setSaving(true);
    try {
      await axios.delete(`/api/outbound-register/receipts/${encodeURIComponent(selectedReceiptno)}`, authConfig());
      notifications.show({ title: '출고 삭제 완료', message: `${selectedReceiptno} 전표를 삭제했습니다.`, color: 'teal' });
      setDeleteOpen(false);
      setHeader({ ...EMPTY_HEADER, receptdate: localDate() });
      setReceiptMetadata({ companyid: '', companyname: '', created_at: '', updated_at: '' });
      setRows([]); originalStockRef.current = new Map(); setSelectedReceiptno(''); setSubulyn('N'); setDocumentDirty(false);
      await loadReceipts(page, filters);
    } catch (error) {
      notifications.show({ title: '출고 삭제 실패', message: errorMessage(error), color: 'red' });
    } finally { setSaving(false); }
  }, [selectedReceiptno, locked, loadReceipts, page, filters]);

  const rowContent = useCallback((index, row) => (
    <DetailCells row={row} index={index} selected={selectedSet.has(row.id)} disabled={saving || readOnly} saved={locked} unitOptions={unitOptions}
      onSelect={toggleSelection} onChange={changeDetail} onPaste={pasteRange}
      registerCodeInput={registerCodeInput} registerCellInput={registerCellInput} onFindItem={setItemPickerTargetId}
      onFindMaster={openMasterPicker} onFocusCell={setActiveCell} onDelete={deleteDetail} />
  ), [selectedSet, saving, readOnly, locked, unitOptions, toggleSelection, changeDetail, pasteRange, registerCodeInput, registerCellInput, openMasterPicker, setActiveCell, deleteDetail]);

  const headerColumns = [
    { key: 'select', width: 44, minWidth: 42, className: codeClasses.checkCol, label: <input type="checkbox" aria-label="상세 전체 선택" checked={rows.length > 0 && rows.every((row) => selectedSet.has(row.id))} onChange={(event) => toggleAll(event.currentTarget.checked)} /> },
    { key: 'number', width: 58, minWidth: 48, className: codeClasses.numberCol, label: 'No.' },
    ...DETAIL_FIELDS.map(({ key, label, width, required }) => ({ key, width, minWidth: 70, label: <>{label}{required && <span className={codeClasses.required}> *</span>}</> })),
    { key: 'action', width: 58, minWidth: 48, className: codeClasses.actionCol, label: '관리' },
  ];
  const tableWidth = headerColumns.reduce((sum, column) => sum + (columnWidths[column.key] ?? column.width), 0);
  const receiptTableWidth = RECEIPT_COLUMNS.reduce((sum, column) => sum + column.width, 0);
  const receiptTotals = receipts.reduce((totals, receipt) => {
    for (const key of ['line_count', 'total_qty', 'total_weight', 'supply_amount', 'vat_amount', 'total_amount']) {
      totals[key] += Number(receipt[key] || 0);
    }
    return totals;
  }, { line_count: 0, total_qty: 0, total_weight: 0, supply_amount: 0, vat_amount: 0, total_amount: 0 });
  const syncReceiptScroll = (left, source) => {
    for (const element of [receiptTableRef.current, receiptSubtotalRef.current]) {
      if (element && element !== source && element.scrollLeft !== left) element.scrollLeft = left;
    }
  };
  const renderReceiptHeader = (column) => (
    <Table.Th key={column.key} ta={column.align} style={{ width: `${column.width}px`, minWidth: `${column.width}px` }}>{column.label}</Table.Th>
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
          <Paper className={`${sharedClasses.panel} ${classes.outboundReceiptPanel}`} withBorder>
            <Group className={classes.outboundReceiptToolbar} justify="space-between">
              <Group gap={8}><Text className={inboundClasses.sectionTitle} fw={700}>출고 기본</Text><Badge color="gray" variant="light">{total.toLocaleString()}건</Badge></Group>
              <Group gap={4}>
                <Button className={classes.outboundFinderButton} variant="subtle" size="xs" leftSection={<IconPlus size={14} />} onClick={createReceipt} disabled={hasPendingChanges || saving}>신규 전표</Button>
                <Button className={classes.outboundFinderButton} variant="subtle" size="xs" leftSection={<IconSearch size={14} />} onClick={openReceiptFinder}>전표 찾기</Button>
              </Group>
            </Group>
            <Box ref={receiptTableRef} className={classes.outboundReceiptTableWrap} onScroll={(event) => syncReceiptScroll(event.currentTarget.scrollLeft, event.currentTarget)}>
              <Table className={classes.outboundReceiptTable} stickyHeader highlightOnHover withTableBorder withColumnBorders
                style={{ width: `${receiptTableWidth}px`, minWidth: `${receiptTableWidth}px`, tableLayout: 'fixed' }}>
                <Table.Thead><Table.Tr>{RECEIPT_COLUMNS.map(renderReceiptHeader)}</Table.Tr></Table.Thead>
                <Table.Tbody>
                  {receipts.map((receipt) => <Table.Tr key={receipt.receiptno}
                    className={`${classes.receiptFinderRow} ${selectedReceiptno === receipt.receiptno ? classes.receiptFinderRowActive : ''}`}
                    onClick={() => { void openReceipt(receipt.receiptno, true); }}>
                    <Table.Td>{String(receipt.receptdate || '').slice(0, 10)}</Table.Td>
                    <Table.Td>{receipt.customcode}</Table.Td>
                    <Table.Td>{receipt.customname || receipt.customcode}</Table.Td>
                    <Table.Td>{receipt.warehousecode || ''}</Table.Td>
                    <Table.Td>{receipt.warehousecodename || ''}</Table.Td>
                    <Table.Td ta="right">{Number(receipt.line_count || 0).toLocaleString()}</Table.Td>
                    <Table.Td ta="right">{Number(receipt.total_qty || 0).toLocaleString(undefined, { maximumFractionDigits: 3 })}</Table.Td>
                    <Table.Td ta="right">{Number(receipt.total_weight || 0).toLocaleString(undefined, { maximumFractionDigits: 3 })}</Table.Td>
                    <Table.Td ta="right">{formatAmount(String(receipt.supply_amount ?? 0))}</Table.Td>
                    <Table.Td ta="right">{formatAmount(String(receipt.vat_amount ?? 0))}</Table.Td>
                    <Table.Td ta="right" className={classes.receiptFinderAmount}>{formatAmount(String(receipt.total_amount ?? 0))}</Table.Td>
                    <Table.Td>{receipt.receiptno}</Table.Td>
                    <Table.Td>{receipt.description || ''}</Table.Td>
                  </Table.Tr>)}
                </Table.Tbody>
              </Table>
              {!receipts.length && <Box className={classes.outboundReceiptEmpty}>{loading ? '조회 중입니다.' : '검색된 출고전표가 없습니다.'}</Box>}
            </Box>
            {!!receipts.length && <Box ref={receiptSubtotalRef} className={classes.outboundReceiptSubtotalViewport} onScroll={(event) => syncReceiptScroll(event.currentTarget.scrollLeft, event.currentTarget)}>
              <Table className={`${classes.outboundReceiptTable} ${classes.outboundReceiptSubtotalTable}`} withTableBorder withColumnBorders
                style={{ width: `${receiptTableWidth}px`, minWidth: `${receiptTableWidth}px`, tableLayout: 'fixed' }}>
                <colgroup>{RECEIPT_COLUMNS.map((column) => <col key={column.key} style={{ width: `${column.width}px` }} />)}</colgroup>
                <Table.Tbody><Table.Tr className={classes.outboundReceiptSubtotal}>
                  {RECEIPT_COLUMNS.map((column, index) => <Table.Td key={column.key} ta={column.align}>
                    {index === 0 ? '소계' : column.key === 'line_count' ? receiptTotals.line_count.toLocaleString()
                      : column.key === 'total_qty' || column.key === 'total_weight' ? receiptTotals[column.key].toLocaleString(undefined, { maximumFractionDigits: 3 })
                        : ['supply_amount', 'vat_amount', 'total_amount'].includes(column.key) ? formatAmount(String(receiptTotals[column.key])) : ''}
                  </Table.Td>)}
                </Table.Tr></Table.Tbody>
              </Table>
            </Box>}
            <Group className={classes.outboundReceiptPagination} justify="space-between">
              <Select aria-label="페이지당 표시 건수" data={PAGE_SIZE_OPTIONS} value={String(pageSize)} w={100} size="xs"
                onChange={(value) => { if (value) { const nextPageSize = Number(value); setPageSize(nextPageSize); void loadReceipts(1, filters, nextPageSize); } }} />
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

          <Box className={classes.headerForm}>
            <TextInput label="출고일자" type="date" value={header.receptdate} onChange={(event) => changeHeader('receptdate', event.currentTarget.value)} size="sm" disabled={readOnly || saving} required />
            <TextInput label="거래처코드" value={header.customcode} placeholder="거래처 찾기" size="sm" readOnly disabled={readOnly || saving} required
              rightSection={<ActionIcon variant="subtle" color="red" aria-label="거래처 찾기" onClick={openCustomerPicker} disabled={readOnly || saving}><IconSearch size={16} /></ActionIcon>}
              rightSectionPointerEvents="all" />
            <TextInput label="거래처명" value={header.customname} placeholder="거래처 선택 시 자동 입력" size="sm" disabled />
            <TextInput className={classes.headerDescription} label="비고" value={header.description} onChange={(event) => changeHeader('description', event.currentTarget.value)} placeholder="비고" size="sm" disabled={readOnly || saving} />
          </Box>

          {selectedIds.length > 1 && !readOnly && <Group className={`${sharedClasses.toolbar} ${codeClasses.toolbar}`} justify="flex-end" gap={7}>
            <Text size="xs" c="red" fw={600}>{`드롭박스 변경 시 선택한 ${selectedIds.length}행에 일괄 적용됩니다.`}</Text>
            <Button variant="light" color="red" size="xs" onClick={() => {
              setBulkValues({ qtyunit: '', warehousecode: '', unit: '' });
              setBulkEditOpen(true);
            }}>일괄 변경</Button>
          </Group>}

          <Box className={codeClasses.tableWrap} style={{ '--code-table-min-width': `${Math.max(1120, tableWidth)}px` }} onKeyDown={handleTableKeyDown}>
            {detailLoading ? <Box className={classes.receiptLoading}><Loader size="sm" color="red" /></Box> : rows.length ? (
              <TableVirtuoso ref={virtuosoRef} data={rows} style={{ height: '100%' }} components={virtuosoComponents} computeItemKey={(_index, row) => row.id} defaultItemHeight={42} increaseViewportBy={{ top: 160, bottom: 320 }} fixedHeaderContent={() => <Table.Tr>{headerColumns.map(renderHeader)}</Table.Tr>} itemContent={rowContent} />
            ) : <Box className={codeClasses.emptyState}>{selectedReceiptno ? '출고 상세가 없습니다.' : '상단 헤더의 추가를 눌러 품목을 등록하세요.'}</Box>}
          </Box>
          <Group className={`${sharedClasses.footer} ${codeClasses.tableFooter}`} justify="space-between" wrap="wrap">
            <Text size="xs" c="dimmed">금액 계산: KG = 중량 × 단가, TON = (중량 ÷ 1,000) × 단가 (중량은 kg 기준). 엑셀 셀 범위를 붙여넣고 저장할 수 있습니다.</Text>
            <Group gap="md" wrap="wrap">
              <Text size="xs" fw={600}>수량 소계 {rows.reduce((sum, row) => sum + (Number(cleanNumericInput(row.qty)) || 0), 0).toLocaleString(undefined, { maximumFractionDigits: 3 })}</Text>
              <Text size="xs" fw={600}>중량 소계 {rows.reduce((sum, row) => sum + (Number(cleanNumericInput(row.weight)) || 0), 0).toLocaleString(undefined, { maximumFractionDigits: 3 })}</Text>
              <Text size="xs" fw={700}>출고금액 소계 {formatAmount(rows.reduce((sum, row) => sum + (Number(amountOf(row, unitOptions.price)) || 0), 0).toFixed(2))}</Text>
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
            <TextInput label="거래처" placeholder="거래처코드 또는 거래처명" value={filterInputs.customer}
              onChange={(event) => setFilterInputs((current) => ({ ...current, customer: event.currentTarget.value }))}
              onKeyDown={(event) => { if (event.key === 'Enter') runSearch(); }} />
            <TextInput label="출고전표번호" placeholder="전표번호" value={filterInputs.receiptno}
              onChange={(event) => setFilterInputs((current) => ({ ...current, receiptno: event.currentTarget.value }))}
              onKeyDown={(event) => { if (event.key === 'Enter') runSearch(); }} />
            <TextInput label="창고" placeholder="창고코드 또는 창고명" value={filterInputs.warehouse}
              onChange={(event) => setFilterInputs((current) => ({ ...current, warehouse: event.currentTarget.value }))}
              onKeyDown={(event) => { if (event.key === 'Enter') runSearch(); }} />
          </Stack>
        </Paper>}
      </Box>

      <Modal
        opened={receiptFinderOpen}
        onClose={() => setReceiptFinderOpen(false)}
        title={<Group gap={9} wrap="nowrap"><Box className={classes.receiptFinderTitleIcon}><IconSearch size={17} /></Box><Text fw={750}>출고전표 찾기</Text></Group>}
        classNames={{
          content: classes.receiptFinderModalContent,
          header: classes.receiptFinderModalHeader,
          title: classes.receiptFinderModalTitle,
          close: classes.receiptFinderModalClose,
        }}
        centered
        size={960}
      >
        <Stack gap="md">
          <Box className={classes.receiptFinderFilters}>
            <Group justify="space-between" align="center" mb="sm" wrap="wrap" gap={4}>
              <Text fw={700} size="sm">{'조회 조건'}</Text>
              <Text size="xs" c="dimmed">{'입력한 조건은 모두 적용됩니다.'}</Text>
            </Group>
            <Box className={classes.receiptFinderFilterGrid}>
              <TextInput
                label={'출고전표번호'}
                placeholder={'전표번호 입력'}
                value={filterInputs.receiptno}
                onChange={(event) => setFilterInputs((current) => ({ ...current, receiptno: event.currentTarget.value }))}
                onKeyDown={(event) => { if (event.key === 'Enter') runSearch(); }}
              />
              <TextInput
                label={'거래처코드'}
                placeholder={'거래처코드 입력'}
                value={filterInputs.customcode}
                onChange={(event) => setFilterInputs((current) => ({ ...current, customcode: event.currentTarget.value }))}
                onKeyDown={(event) => { if (event.key === 'Enter') runSearch(); }}
              />
              <TextInput
                label={'거래처명'}
                placeholder={'거래처명 입력'}
                value={filterInputs.customname}
                onChange={(event) => setFilterInputs((current) => ({ ...current, customname: event.currentTarget.value }))}
                onKeyDown={(event) => { if (event.key === 'Enter') runSearch(); }}
              />
              <TextInput
                type="date"
                label={'출고 시작일'}
                value={filterInputs.date_from}
                onChange={(event) => setFilterInputs((current) => ({ ...current, date_from: event.currentTarget.value }))}
              />
              <TextInput
                type="date"
                label={'출고 종료일'}
                value={filterInputs.date_to}
                onChange={(event) => setFilterInputs((current) => ({ ...current, date_to: event.currentTarget.value }))}
              />
            </Box>
            <Group justify="flex-end" gap={8} mt="sm">
              <Button
                variant="subtle"
                color="gray"
                onClick={() => {
                  const defaultFilters = createDefaultReceiptFilters();
                  setFilterInputs(defaultFilters);
                  setFilters(defaultFilters);
                  setPage(1);
                  loadReceipts(1, defaultFilters);
                }}
                disabled={loading}
              >
                {'초기화'}
              </Button>
              <Button color="red" leftSection={<IconSearch size={15} />} onClick={runSearch} loading={loading}>
                {'조회'}
              </Button>
            </Group>
          </Box>
          <Group justify="space-between" align="center">
            <Text size="xs" c="dimmed">총 {total.toLocaleString()}건 · 전표를 선택하면 상세 내용을 확인할 수 있습니다.</Text>
          </Group>
          <Box className={classes.receiptFinderResults}>
            {loading ? <Box className={classes.receiptLoading}><Loader size="sm" color="red" /></Box> : receipts.length ? (
              <ScrollArea h="100%" type="auto" scrollbarSize={6}>
                <Table className={classes.receiptFinderTable} stickyHeader highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>출고전표번호</Table.Th>
                      <Table.Th>거래처코드</Table.Th>
                      <Table.Th>거래처명</Table.Th>
                      <Table.Th>출고일자</Table.Th>
                      <Table.Th ta="right">상세 건수</Table.Th>
                      <Table.Th ta="right">합계 금액</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {receipts.map((receipt) => (
                      <Table.Tr
                        key={receipt.receiptno}
                        className={`${classes.receiptFinderRow} ${selectedReceiptno === receipt.receiptno ? classes.receiptFinderRowActive : ''}`}
                        onClick={async () => {
                          const opened = await openReceipt(receipt.receiptno, true);
                          if (opened) setReceiptFinderOpen(false);
                        }}
                      >
                        <Table.Td>{receipt.receiptno}</Table.Td>
                        <Table.Td>{receipt.customcode}</Table.Td>
                        <Table.Td>{receipt.customname || receipt.customcode}</Table.Td>
                        <Table.Td>{String(receipt.receptdate || '').slice(0, 10)}</Table.Td>
                        <Table.Td ta="right">{Number(receipt.line_count || 0).toLocaleString()}</Table.Td>
                        <Table.Td ta="right" className={classes.receiptFinderAmount}>{formatAmount(String(receipt.total_amount ?? 0))}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </ScrollArea>
            ) : <Box className={codeClasses.emptyState}>검색된 출고전표가 없습니다.</Box>}
          </Box>
          <Group justify="space-between" align="center">
            <Text size="xs" c="dimmed">페이지 {page} / {Math.max(1, Math.ceil(total / pageSize))}</Text>
            <Pagination
              size="sm"
              total={Math.max(1, Math.ceil(total / pageSize))}
              value={page}
              onChange={(value) => loadReceipts(value, filters)}
              withEdges
              color="red"
              disabled={loading}
            />
          </Group>
        </Stack>
      </Modal>

      <Modal opened={bulkEditOpen} onClose={() => setBulkEditOpen(false)} title={<PickerModalTitle title="선택 행 일괄 변경" />} classNames={{ content: classes.receiptFinderModalContent, header: classes.receiptFinderModalHeader, title: classes.receiptFinderModalTitle, close: classes.receiptFinderModalClose }} centered size="md">
        <Stack gap="md" pt={10}>
          <Box className={classes.modalHint}>비워 둔 항목은 변경하지 않습니다.</Box>
          <Stack gap="sm">
            <Box>
              <Text size="xs" fw={700} mb={4}>{'수량단위'}</Text>
              <select className={codeClasses.cellSelect} value={bulkValues.qtyunit} onChange={(event) => setBulkValues((current) => ({ ...current, qtyunit: event.currentTarget.value }))}>
                <option value="">{'변경 안 함'}</option>
                {unitOptions.quantity.map((option) => <option key={option.code} value={option.code}>{option.name}</option>)}
              </select>
            </Box>
            <Box>
              <Text size="xs" fw={700} mb={4}>{'창고명'}</Text>
              <select className={codeClasses.cellSelect} value={bulkValues.warehousecode} onChange={(event) => setBulkValues((current) => ({ ...current, warehousecode: event.currentTarget.value }))}>
                <option value="">{'변경 안 함'}</option>
                {unitOptions.warehouse.map((option) => <option key={option.code} value={option.code}>{option.name}</option>)}
              </select>
            </Box>
            <Box>
              <Text size="xs" fw={700} mb={4}>{'단가기준'}</Text>
              <select className={codeClasses.cellSelect} value={bulkValues.unit} onChange={(event) => setBulkValues((current) => ({ ...current, unit: event.currentTarget.value }))}>
                <option value="">{'변경 안 함'}</option>
                {unitOptions.price.map((option) => <option key={option.code} value={option.code}>{option.name}</option>)}
              </select>
            </Box>
          </Stack>
          <Group justify="flex-end" gap={8}>
            <Button variant="default" onClick={() => setBulkEditOpen(false)}>{'취소'}</Button>
            <Button color="red" onClick={applyBulkMasterChanges} disabled={!Object.values(bulkValues).some(Boolean)}>{'선택 행에 적용'}</Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={deleteOpen} onClose={() => !saving && setDeleteOpen(false)} title="출고전표 삭제" centered size="sm">
        <Stack gap="md">
          <Text size="sm" c="dimmed">{selectedReceiptno} 전표와 상세 내역을 삭제합니다. 삭제한 전표는 복구할 수 없습니다.</Text>
          <Group justify="flex-end"><Button variant="default" onClick={() => setDeleteOpen(false)} disabled={saving}>취소</Button><Button color="red" leftSection={<IconTrash size={15} />} onClick={requestDeleteReceipt} loading={saving}>삭제</Button></Group>
        </Stack>
      </Modal>

      <Modal opened={detailDeleteOpen} onClose={() => setDetailDeleteOpen(false)} title="상세 행 삭제" centered size="sm">
        <Stack gap="md">
          <Text size="sm" c="dimmed">선택한 {selectedIds.length.toLocaleString()}개 상세 행을 입력 목록에서 제거합니다. 삭제 후 저장해야 출고전표에 반영됩니다.</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDetailDeleteOpen(false)}>취소</Button>
            <Button color="red" leftSection={<IconTrash size={15} />} onClick={deleteSelectedDetails}>삭제</Button>
          </Group>
        </Stack>
      </Modal>

      <CustomerPickerModal opened={customerPickerOpen} onClose={() => setCustomerPickerOpen(false)} onSelect={selectCustomer} />
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
