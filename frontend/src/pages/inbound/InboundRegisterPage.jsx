import { createContext, memo, useCallback, useContext, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { usePageActivation } from '../../components/common/usePageReactivated';
import ErpDateInput from '../../components/common/ErpDateInput';
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
import XLSX from 'xlsx-js-style';
import { applyExcelHeaderStyle } from '../../utils/excelHeaderStyle';
import sharedClasses from '../../styles/pages/ManagementShared.module.css';
import codeClasses from '../../styles/pages/CodeMasterPage.module.css';
import classes from '../../styles/pages/InboundRegister.module.css';
import itemMasterClasses from '../../styles/pages/ItemMaster.module.css';
import outboundClasses from '../../styles/pages/OutboundRegister.module.css';
import { makeExpense, ExpenseCostAutocompleteCell, ExpenseCustomerAutocompleteCell, ExpenseNumericCell, ExpenseDescriptionCell } from '../outbound/OutboundRegisterPage';
import { PageRibbonContext } from '../../components/layout/MainLayout';

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
const RECEIPT_HEADER_PICKER_ID = '__receipt_header__';
const EMPTY_HEADER = { receiptno: '', receptdate: localDate(), customcode: '', customname: '', warehousecode: '', warehousecodename: '', manager: '', description: '' };

const InboundExpenseRow = memo(function InboundExpenseRow({
  expense, index, selected, disabled, options, inputRef,
  onToggle, onChange, onOpenCustomerPicker, onSetCostPicker,
}) {
  const supply = Number(cleanNumericInput(expense.supplyamt)) || 0;
  const vat = Number(cleanNumericInput(expense.vat)) || 0;
  const handleCostSelect = useCallback((option) => onChange(expense.id, 'costcode', option?.code || ''), [expense.id, onChange]);
  const handleCustomerSelect = useCallback((id, customer) => onChange(expense.id, 'customcode', customer.customercode || ''), [expense.id, onChange]);
  const handleCustomerPicker = useCallback((id) => onOpenCustomerPicker(`expense::${expense.id}`), [expense.id, onOpenCustomerPicker]);
  const handleToggle = useCallback((event) => onToggle(expense.id, event.nativeEvent.shiftKey), [expense.id, onToggle]);
  const handleCostPicker = useCallback(() => onSetCostPicker(expense.id), [expense.id, onSetCostPicker]);

  return (
    <Table.Tr className={[expense.is_new && outboundClasses.newRow, selected && outboundClasses.selectedRow].filter(Boolean).join(' ')}>
      <Table.Td className={codeClasses.checkCol} ta="center"><input type="checkbox" aria-label={`기타비용 ${index + 1}행 선택`} checked={selected} disabled={disabled} onChange={handleToggle} /></Table.Td>
      <Table.Td ta="center">{index + 1}</Table.Td>
      <Table.Td><ExpenseCostAutocompleteCell row={expense} options={options} disabled={disabled} inputRef={inputRef}
        onDoubleClick={handleCostPicker} onSelect={handleCostSelect} /></Table.Td>
      <Table.Td><ExpenseNumericCell expenseId={expense.id} field="supplyamt" value={expense.supplyamt} disabled={disabled} onCommit={onChange} /></Table.Td>
      <Table.Td><ExpenseNumericCell expenseId={expense.id} field="vat" value={expense.vat} disabled={disabled} onCommit={onChange} /></Table.Td>
      <Table.Td><input className={`${codeClasses.cellInput} ${classes.amountInput}`} aria-label="합계금액" value={formatNumericInput(String(supply + vat))} readOnly /></Table.Td>
      <Table.Td><ExpenseCustomerAutocompleteCell expenseId={expense.id} value={expense.customname || ''} disabled={disabled}
        onSelect={handleCustomerSelect} onOpenPicker={handleCustomerPicker} /></Table.Td>
      <Table.Td><ExpenseDescriptionCell expenseId={expense.id} value={expense.description} disabled={disabled} onCommit={onChange} /></Table.Td>
    </Table.Tr>
  );
});

const InboundReceiptRows = memo(function InboundReceiptRows({ receipts, selectedReceiptno, onOpenReceipt }) {
  return receipts.map((receipt) => (
    <Table.Tr
      key={receipt.receiptno}
      className={`${classes.receiptFinderRow} ${selectedReceiptno === receipt.receiptno ? classes.receiptFinderRowActive : ''}`}
      onClick={() => { void onOpenReceipt(receipt.receiptno, true); }}
    >
      <Table.Td>{String(receipt.receptdate || '').slice(0, 10)}</Table.Td>
      <Table.Td title={receipt.customname || ''}>{receipt.customname || ''}</Table.Td>
      <Table.Td title={receipt.warehousecodename || ''}>{receipt.warehousecodename || ''}</Table.Td>
      <Table.Td ta="right">{Number(receipt.line_count || 0).toLocaleString()}</Table.Td>
      <Table.Td ta="right">{Number(receipt.total_qty || 0).toLocaleString(undefined, { maximumFractionDigits: 3 })}</Table.Td>
      <Table.Td ta="right">{Number(receipt.total_weight || 0).toLocaleString(undefined, { maximumFractionDigits: 3 })}</Table.Td>
      <Table.Td ta="right">{formatAmount(String(receipt.supply_amount ?? 0))}</Table.Td>
      <Table.Td ta="right">{formatAmount(String(receipt.vat_amount ?? 0))}</Table.Td>
      <Table.Td ta="right" className={classes.receiptFinderAmount}>{formatAmount(String(receipt.total_amount ?? 0))}</Table.Td>
      <Table.Td ta="right">{formatAmount(String(receipt.other_cost_amount ?? 0))}</Table.Td>
      <Table.Td>{receipt.qtyunit || ''}</Table.Td>
      <Table.Td>{receipt.unit || ''}</Table.Td>
      <Table.Td title={receipt.receiptno || ''}>{receipt.receiptno}</Table.Td>
      <Table.Td title={receipt.description || ''}>{receipt.description || ''}</Table.Td>
    </Table.Tr>
  ));
});

const DETAIL_FIELDS = [
  { key: 'productname', label: '제품번호', width: 100, minWidth: 95, fixedWidth: true },
  { key: 'itemname', label: '품명', width: 100, minWidth: 100, fixedWidth: true, required: true },
  { key: 'materialname', label: '강종', width: 100, minWidth: 100, fixedWidth: true },
  { key: 'surfacename', label: '표면', width: 100, minWidth: 100, fixedWidth: true },
  { key: 'myrtle', label: '도금량(g/㎡)', width: 80, minWidth: 80, fixedWidth: true },
  { key: 'thickness', label: '두께', width: 70, minWidth: 70 },
  { key: 'width', label: '폭', width: 70, minWidth: 70 },
  { key: 'length', label: '길이', width: 70, minWidth: 70 },
  { key: 'qty', label: '수량', width: 70, minWidth: 70, required: true },
  { key: 'weight', label: '중량', width: 70, minWidth: 70, required: true },
  { key: 'unitprice', label: '매입단가', width: 70, minWidth: 70, required: true },
  { key: 'supplyamt', label: '공급가', width: 110, minWidth: 110 },
  { key: 'vat', label: '부가세', width: 110, minWidth: 110 },
  { key: 'unitamt', label: '합계금액', width: 110, minWidth: 110 },
  { key: 'qtyunit', label: '수량단위', width: 70, minWidth: 70, required: true },
  { key: 'unit', label: '단가기준', width: 70, minWidth: 70, required: true },
];
const RECEIPT_COLUMNS = [
  { key: 'receptdate', label: '입고일자', width: 100, minWidth: 80 },
  { key: 'customname', label: '매입처', width: 100, minWidth: 80 },
  { key: 'warehousecodename', label: '창고', width: 70, minWidth: 70 },
  { key: 'line_count', label: '상세건수', width: 70, minWidth: 70, align: 'right' },
  { key: 'total_qty', label: '수량', width: 70, minWidth: 70, align: 'right' },
  { key: 'total_weight', label: '중량', width: 70, minWidth: 70, align: 'right' },
  { key: 'supply_amount', label: '공급가', width: 110, minWidth: 80, align: 'right' },
  { key: 'vat_amount', label: '부가세', width: 110, minWidth: 80, align: 'right' },
  { key: 'total_amount', label: '합계금액', width: 110, minWidth: 80, align: 'right' },
  { key: 'other_cost_amount', label: '기타비용', width: 100, minWidth: 80, align: 'right' },
  { key: 'qtyunit', label: '수량단위', width: 80, minWidth: 80 },
  { key: 'unit', label: '단가기준', width: 80, minWidth: 80 },
  { key: 'receiptno', label: '입고전표', width: 110, minWidth: 110 },
  { key: 'description', label: '비고', width: 175, minWidth: 110 },
];
const NAVIGABLE_FIELDS = DETAIL_FIELDS.map(({ key }) => key);
const EDITABLE_FIELDS = DETAIL_FIELDS.map(({ key }) => key);
const EMPTY_DETAIL = { receptdate: localDate(), customcode: '', customname: '', itemcode: '', itemname: '', productname: '', materialcode: '', materialname: '', surfacecode: '', surfacename: '', myrtle: '', thickness: '', width: '', length: '', qty: '', qtyunit: 'EA', warehousecode: '', warehousecodename: '', weight: '', unit: 'KG', unitprice: '', supplyamt: '', vat: '', unitamt: '' };
const masterPasteErrorKey = (rowId, field) => `${rowId}:${field}`;
const applyReceiptHeaderToRows = (rows, values) => {
  let changed = false;
  const next = rows.map((row) => {
    const hasChanges = Object.entries(values).some(([key, value]) => row[key] !== value);
    if (!hasChanges) return row;
    changed = true;
    return { ...row, ...values, is_dirty: !row.is_new };
  });
  return changed ? next : rows;
};

const errorMessage = (error) => {
  const detail = error.response?.data?.detail;
  if (Array.isArray(detail)) return detail.slice(0, 5).map((item) => {
    const location = Array.isArray(item.loc) ? item.loc : [];
    const itemIndex = location.indexOf('items');
    const field = location.at(-1);
    const headerFields = { receptdate: '\uC785\uACE0\uC77C\uC790', customcode: '\uB9E4\uC785\uCC98', customname: '\uB9E4\uC785\uCC98', warehousecode: '\uCC3D\uACE0', warehousecodename: '\uCC3D\uACE0', manager: '\uB2F4\uB2F9\uC790', description: '\uBE44\uACE0', receiptno: '\uC785\uACE0\uC804\uD45C\uBC88\uD638' };
    const detailFields = { receptdate: '\uC785\uACE0\uC77C\uC790', customcode: '\uB9E4\uC785\uCC98', customname: '\uB9E4\uC785\uCC98', warehousecode: '\uCC3D\uACE0', warehousecodename: '\uCC3D\uACE0', itemcode: '\uD488\uBAA9\uCF54\uB4DC', itemname: '\uD488\uBA85', productname: '\uC81C\uD488\uBC88\uD638', materialcode: '\uAC15\uC885', materialname: '\uAC15\uC885', surfacecode: '\uD45C\uBA74', surfacename: '\uD45C\uBA74', myrtle: '\uB3C4\uAE08\uB7C9', thickness: '\uB450\uAED8', width: '\uD3ED', length: '\uAE38\uC774', qty: '\uC218\uB7C9', qtyunit: '\uC218\uB7C9\uB2E8\uC704', weight: '\uC911\uB7C9', unit: '\uB2E8\uAC00\uAE30\uC900', unitprice: '\uB9E4\uC785\uB2E8\uAC00', supplyamt: '\uACF5\uAE09\uAC00', vat: '\uBD80\uAC00\uC138' };
    const rowNumber = itemIndex >= 0 && Number.isInteger(Number(location[itemIndex + 1]))
      ? Number(location[itemIndex + 1]) + 1 : null;
    const label = itemIndex >= 0 ? detailFields[field] : headerFields[field];
    if (label) return rowNumber ? `${rowNumber}\uD589 ${label} \uD56D\uBAA9\uC744 \uD655\uC778\uD574 \uC8FC\uC138\uC694.` : `${label} \uD56D\uBAA9\uC744 \uC785\uB825\uD574 \uC8FC\uC138\uC694.`;
    return rowNumber ? `${rowNumber}\uD589 \uC785\uB825 \uD56D\uBAA9\uC744 \uD655\uC778\uD574 \uC8FC\uC138\uC694.` : '\uC785\uB825 \uD56D\uBAA9\uC744 \uD655\uC778\uD574 \uC8FC\uC138\uC694.';
  }).join(' / ');
  if (typeof detail === 'string') return detail
    .replaceAll('customcode', '\uB9E4\uC785\uCC98')
    .replaceAll('warehousecode', '\uCC3D\uACE0')
    .replaceAll('receptdate', '\uC785\uACE0\uC77C\uC790');
  return detail || error.response?.data?.message || error.message || '\uC785\uACE0 \uC694\uCCAD\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.';
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
    const timer = window.setTimeout(() => { void loadItems(); }, 140);
    return () => { window.clearTimeout(timer); controller.abort(); };
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
          onClick={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            if (!disabled && event.clientX >= bounds.right - 28) openPicker();
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
    const timer = window.setTimeout(() => { void loadCustomers(); }, 140);
    return () => { window.clearTimeout(timer); controller.abort(); };
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
          onClick={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            if (!disabled && event.clientX >= bounds.right - 28) openPicker();
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
          onClick={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            if (!disabled && event.clientX >= bounds.right - 28) openPicker();
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
      onChange={handleDateChange}
      onPaste={onPaste}
      onKeyDown={handleKeyDown}
    />
  );
});

const DetailCells = memo(function DetailCells({ row, index, selected, disabled, saved, unitOptions, onSelect, onChange, onPaste, registerCellInput, onSelectItem, onSelectCustomer, onSelectWarehouse, onSelectGeneralMaster, onFindItem, onFindCustomer, onFindMaster, onFocusCell }) {
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
      <Table.Td key={key} className={saved ? classes.savedCell : ''}>
        {saved ? (
          <span className={classes.savedCellText} title={String(displayValue(key))}>
            {key === 'supplyamt' || key === 'vat'
              ? formatNumericInput(row[`${key}_manual`] ? row[key] : (key === 'vat' ? vatOf({ ...row, vat_manual: false }, unitOptions.price) : amountOf({ ...row, supplyamt_manual: false }, unitOptions.price)))
              : displayValue(key)}
          </span>
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
            className={`${codeClasses.cellInput} ${key === 'productname' ? classes.fixedValueInput : ''} ${key === 'itemname' || key === 'warehousecodename' ? classes.autoFilledInput : ''} ${key === 'warehousecode' ? classes.itemCodePickerInput : ''}`}
            aria-label={label}
            title={key === 'warehousecode' ? `${label} - 더블클릭하여 마스터에서 선택` : undefined}
            data-row-id={row.id}
            data-field={key}
            inputMode={NUMERIC_FIELDS.has(key) ? 'decimal' : undefined}
            value={displayValue(key)}
            placeholder={row.is_new && (key === 'itemcode' || key === 'itemname') ? label : ''}
            readOnly={key === 'itemname' || key === 'warehousecodename'}
            disabled={disabled}
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

// Footer totals live in their own component so the deferred re-render triggered by
// useDeferredValue only repaints this footer instead of the whole register page.
const InboundDetailSummary = memo(function InboundDetailSummary({ rows, unitOptions }) {
  const summaryRows = useDeferredValue(rows);
  const detailSubtotals = useMemo(() => summaryRows.reduce((totals, row) => {
    totals.qty += Number(cleanNumericInput(row.qty)) || 0;
    totals.weight += Number(cleanNumericInput(row.weight)) || 0;
    totals.amount += Number(amountOf(row, unitOptions.price)) || 0;
    totals.vat += Number(vatOf(row, unitOptions.price)) || 0;
    totals.total += Number(totalAmountOf(row, unitOptions.price)) || 0;
    return totals;
  }, { qty: 0, weight: 0, amount: 0, vat: 0, total: 0 }), [summaryRows, unitOptions.price]);
  const quantitySummary = useMemo(() => {
    if (!summaryRows.length) return '0';
    const totals = new Map();
    const defaultUnit = unitOptions.quantity.find((option) => option.code === 'EA')?.name || 'EA';
    summaryRows.forEach((row) => {
      const unitCode = resolveMasterCode('qtyunit', row.qtyunit, unitOptions);
      const unit = unitOptions.quantity.find((option) => option.code === unitCode)?.name || row.qtyunit || defaultUnit;
      const quantity = Number(cleanNumericInput(row.qty)) || 0;
      totals.set(unit, (totals.get(unit) || 0) + quantity);
    });
    return [...totals.entries()].map(([unit, quantity]) => `${quantity.toLocaleString(undefined, { maximumFractionDigits: 3 })}${unit}`).join(', ');
  }, [summaryRows, unitOptions]);
  return (
    <Group className={`${sharedClasses.footer} ${codeClasses.tableFooter}`} justify="space-between" wrap="wrap">
      <Text size="xs" c="dimmed">엑셀 셀 범위를 붙여넣고 저장할 수 있습니다.</Text>
      <Text size="xs" fw={700}>
        총 수량 {quantitySummary} · 총 중량 {detailSubtotals.weight.toLocaleString(undefined, { maximumFractionDigits: 3 })}{summaryRows.length ? 'KG' : ''}
        {' · '}총공급가 {formatWon(detailSubtotals.amount.toFixed(2))}
        {' · '}부가세 {formatWon(detailSubtotals.vat.toFixed(2))}
        {' · '}합계 {formatWon(detailSubtotals.total.toFixed(2))}
      </Text>
    </Group>
  );
});

const InboundDetailRow = memo(function InboundDetailRow({ row, index, renderCells }) {
  return (
    <Table.Tr className={[row.is_new && codeClasses.newRow, row.is_new && classes.newRow].filter(Boolean).join(' ')}>
      {renderCells(index, row)}
    </Table.Tr>
  );
});

// Mantine <Table> hands a fresh context value to every Table.Td/Th whenever it re-renders,
// which forces all existing (memoized) rows to re-render on each row add. The table
// elements are therefore memoized and the row arrays reach the tbody through these
// contexts, so adding a row only renders the new row.
const DetailRowsContext = createContext([]);
const ExpenseRowsContext = createContext({ expenses: [], selectedExpenseSet: new Set() });

const InboundDetailTableRows = memo(function InboundDetailTableRows({ renderCells }) {
  const rows = useContext(DetailRowsContext);
  return rows.map((row, index) => <InboundDetailRow key={row.id} row={row} index={index} renderCells={renderCells} />);
});

const InboundExpenseTableRows = memo(function InboundExpenseTableRows({
  disabled, options, getInputRef, onToggle, onChange, onOpenCustomerPicker, onSetCostPicker,
}) {
  const { expenses, selectedExpenseSet } = useContext(ExpenseRowsContext);
  if (!expenses.length) return null;
  return <Table.Tbody>{expenses.map((expense, index) => (
    <InboundExpenseRow key={expense.id} expense={expense} index={index} selected={selectedExpenseSet.has(expense.id)}
      disabled={disabled} options={options} inputRef={getInputRef(expense.id)}
      onToggle={onToggle} onChange={onChange} onOpenCustomerPicker={onOpenCustomerPicker}
      onSetCostPicker={onSetCostPicker} />
  ))}</Table.Tbody>;
});

const VirtualRow = ({ item, className, ...props }) => (
  <Table.Tr {...props} className={[className, item?.is_new && codeClasses.newRow, item?.is_new && classes.newRow].filter(Boolean).join(' ')} />
);

const DeferredHeaderTextInput = memo(function DeferredHeaderTextInput({ value, onCommit, onEditStart, disabled, maxLength, ariaLabel }) {
  const [draft, setDraft] = useState(value || '');
  const originalValueRef = useRef(value || '');
  const editStartedRef = useRef(false);

  return <TextInput
    aria-label={ariaLabel}
    value={draft}
    maxLength={maxLength}
    disabled={disabled}
    onChange={(event) => {
      const nextValue = event.currentTarget.value;
      setDraft(nextValue);
      if (!editStartedRef.current && nextValue !== originalValueRef.current) {
        editStartedRef.current = true;
        onEditStart();
      }
    }}
    onBlur={() => {
      if (draft !== (value || '')) onCommit(draft);
    }}
  />;
});

const virtuosoComponents = {
  Table: ({ style, ...props }) => <Table {...props} className={`${sharedClasses.table} ${codeClasses.codeTable}`} highlightOnHover withTableBorder withColumnBorders verticalSpacing="xs" horizontalSpacing={0} style={{ ...style, width: '100%', tableLayout: 'fixed' }} />,
  TableHead: Table.Thead,
  TableBody: Table.Tbody,
  TableRow: VirtualRow,
};

export default function InboundRegisterPage() {
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
  const [filterOpen, setFilterOpen] = useState(true);
  const [header, setHeader] = useState(EMPTY_HEADER);
  const [receiptMetadata, setReceiptMetadata] = useState({ companyid: '', companyname: '', created_at: '', updated_at: '' });
  const [rows, setRows] = useState([]);
  const detailRowsRef = useRef(rows);
  useLayoutEffect(() => { detailRowsRef.current = rows; }, [rows]);
  const [expenses, setExpenses] = useState([]);
  const expenseRowsRef = useRef(expenses);
  useLayoutEffect(() => { expenseRowsRef.current = expenses; }, [expenses]);
  const [expenseOptions, setExpenseOptions] = useState([]);
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
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [columnWidths, setColumnWidths] = useState({});
  const [receiptColumnWidths, setReceiptColumnWidths] = useState({});
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [customerPickerTarget, setCustomerPickerTarget] = useState(null);
  const [itemPickerTarget, setItemPickerTarget] = useState(null);
  const [masterPickerTarget, setMasterPickerTarget] = useState(null);
  const [receiptCustomers, setReceiptCustomers] = useState([]);
  const [unitOptions, setUnitOptions] = useState({ price: [], quantity: [], warehouse: [], material: [], surface: [] });
  const virtuosoRef = useRef(null);
  const receiptTableRef = useRef(null);
  const receiptSubtotalRef = useRef(null);
  const cellInputsRef = useRef(new Map());
  const codeLookupTimersRef = useRef(new Map());
  const masterPasteErrorsRef = useRef(new Map());
  const activeCellRef = useRef(null);
  const pendingCellFocusRef = useRef(null);
  const pendingFocusIdRef = useRef('');
  const selectionAnchorRef = useRef('');
  const expenseSelectionAnchorRef = useRef('');
  const pendingExpenseFocusIdRef = useRef('');
  const expenseCostInputsRef = useRef(new Map());
  const locked = isReceiptConfirmed(subulyn);
  const readOnly = Boolean(selectedReceiptno) || locked;
  const hasManagerChanges = Boolean(selectedReceiptno) && documentDirty;
  const hasPendingChanges = useMemo(() => documentDirty || rows.some((row) => row.is_new || row.is_dirty) || expenses.some((row) => row.is_new || row.is_dirty), [documentDirty, rows, expenses]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedExpenseSet = useMemo(() => new Set(selectedExpenseIds), [selectedExpenseIds]);
  const expenseTotals = useMemo(() => expenses.reduce((totals, row) => {
    totals.supply += Number(cleanNumericInput(row.supplyamt)) || 0;
    totals.vat += Number(cleanNumericInput(row.vat)) || 0;
    totals.total += (Number(cleanNumericInput(row.supplyamt)) || 0) + (Number(cleanNumericInput(row.vat)) || 0);
    return totals;
  }, { supply: 0, vat: 0, total: 0 }), [expenses]);
  const hasPendingExpenses = useMemo(() => expenses.some((row) => row.is_new || row.is_dirty), [expenses]);
  const receiptAutoWidths = useMemo(
    () => Object.fromEntries(RECEIPT_COLUMNS.map((column) => [column.key, column.width])),
    [],
  );

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

  const loadReceiptCustomers = useCallback(async () => {
    const customers = [];
    let pageNumber = 1;
    let totalCount = 0;
    do {
      const { data } = await axios.get('/api/list', {
        ...authConfig(),
        params: { status: 'Y', page: pageNumber, page_size: 200, include_total: true },
      });
      customers.push(...(data.data || []));
      totalCount = data.total || 0;
      pageNumber += 1;
    } while (customers.length < totalCount && pageNumber <= 100);
    setReceiptCustomers(customers);
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadUnitOptions('PRICE_UNIT'), loadUnitOptions('QTY'), loadUnitOptions('WAREHOUSE'), loadUnitOptions('MATERIAL'), loadUnitOptions('SURFACE'), loadUnitOptions('OTHER_COST')])
      .then(([price, quantity, warehouse, material, surface, expensesList]) => {
        if (!cancelled) { setUnitOptions({ price, quantity, warehouse, material, surface }); setExpenseOptions(expensesList); }
      })
      .catch((error) => {
        if (!cancelled) notifications.show({ title: '단위 코드 조회 실패', message: errorMessage(error), color: 'red' });
      });
    return () => { cancelled = true; };
  }, [loadUnitOptions, pageActivation]);

  useEffect(() => {
    void loadReceiptCustomers().catch((error) => {
      notifications.show({ title: '매입처 조회 실패', message: errorMessage(error), color: 'red' });
    });
  }, [loadReceiptCustomers, pageActivation]);

  useEffect(() => {
    const expenseId = pendingExpenseFocusIdRef.current;
    if (!expenseId) return;
    requestAnimationFrame(() => {
      expenseCostInputsRef.current.get(expenseId)?.current?.focus();
    });
    pendingExpenseFocusIdRef.current = '';
  }, [expenses.length]);

  const getExpenseCostInputRef = useCallback((id) => {
    if (!expenseCostInputsRef.current.has(id)) expenseCostInputsRef.current.set(id, { current: null });
    return expenseCostInputsRef.current.get(id);
  }, []);

  const addExpense = useCallback(() => {
    if (saving || readOnly) return;
    const expense = makeExpense();
    setExpenses((current) => [...current, expense]);
    setDocumentDirty(true);
    setDetailTab('expenses');
    pendingExpenseFocusIdRef.current = expense.id;
  }, [saving, readOnly]);

  const changeExpense = useCallback((id, key, value) => {
    if (saving || readOnly) return;
    setExpenses((current) => current.map((expense) => {
      if (expense.id !== id) return expense;
      const next = { ...expense, [key]: value, is_dirty: !expense.is_new };
      if (key === 'supplyamt' && !expense.vat_manual) {
        const supply = Number(cleanNumericInput(value)) || 0;
        next.vat = (Math.round((supply * 0.1 + Number.EPSILON) * 100) / 100).toFixed(2);
      }
      if (key === 'vat') next.vat_manual = true;
      if (key === 'costcode') next.costname = expenseOptions.find((option) => option.code === value)?.name || '';
      if (key === 'customcode') next.customname = receiptCustomers.find((customer) => customer.customercode === value)?.customername || '';
      return next;
    }));
    setDocumentDirty(true);
  }, [saving, readOnly, expenseOptions, receiptCustomers]);

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
  }, [saving, readOnly]);

  const toggleAllExpenses = useCallback((checked) => {
    if (saving || readOnly) return;
    setSelectedExpenseIds(checked ? expenseRowsRef.current.map((expense) => expense.id) : []);
    expenseSelectionAnchorRef.current = '';
  }, [saving, readOnly]);

  const removeSelectedExpenses = useCallback(() => {
    if (saving || readOnly || !selectedExpenseIds.length) return;
    const selected = new Set(selectedExpenseIds);
    const removedCount = expenses.filter((expense) => selected.has(expense.id)).length;
    setExpenses((current) => current.filter((expense) => !selected.has(expense.id)));
    setSelectedExpenseIds([]);
    expenseSelectionAnchorRef.current = '';
    setDocumentDirty(true);
    notifications.show({ title: '선택 행 제거 완료', message: `기타비용 ${removedCount}행을 제거했습니다. 저장하면 반영됩니다.`, color: 'teal' });
  }, [saving, readOnly, selectedExpenseIds, expenses]);

  const openCustomerPicker = useCallback((rowId) => {
    if (!readOnly && !saving) {
      setCustomerPickerTarget(rowId);
      setCustomerPickerOpen(true);
    }
  }, [readOnly, saving]);

  const selectCustomer = useCallback((customer) => {
    if (typeof customerPickerTarget === 'string' && customerPickerTarget.startsWith('expense::')) {
      const expenseId = customerPickerTarget.slice('expense::'.length);
      setExpenses((current) => current.map((expense) => expense.id === expenseId
        ? { ...expense, customcode: customer.customercode || '', customname: customer.customername || '' }
        : expense));
    } else if (customerPickerTarget === RECEIPT_HEADER_PICKER_ID) {
      const customcode = customer.customercode || '';
      const customname = customer.customername || '';
      setHeader((current) => ({ ...current, customcode, customname }));
      setRows((current) => applyReceiptHeaderToRows(current, { customcode, customname }));
    } else if (customerPickerTarget) {
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

  const changeReceiptField = useCallback((key, value) => {
    if (key === 'receptdate') {
      setHeader((current) => ({ ...current, receptdate: value }));
      setRows((current) => applyReceiptHeaderToRows(current, { receptdate: value }));
    } else if (key === 'customname') {
      setHeader((current) => ({ ...current, customcode: '', customname: value }));
      setRows((current) => applyReceiptHeaderToRows(current, { customcode: '', customname: value }));
    } else if (key === 'warehousecodename') {
      const code = resolveMasterCode('warehouse', value, unitOptions);
      const selected = unitOptions.warehouse.find((option) => option.code === code);
      const warehousecode = selected?.code || '';
      const warehousecodename = selected?.name || String(value || '');
      setHeader((current) => ({ ...current, warehousecode, warehousecodename }));
      setRows((current) => applyReceiptHeaderToRows(current, { warehousecode, warehousecodename }));
    } else if (key === 'description') {
      setHeader((current) => ({ ...current, description: value }));
    } else if (key === 'manager') {
      setHeader((current) => ({ ...current, manager: value }));
    }
    setDocumentDirty(true);
  }, [unitOptions]);

  const commitReceiptManager = useCallback((value) => changeReceiptField('manager', value), [changeReceiptField]);
  const commitReceiptDescription = useCallback((value) => changeReceiptField('description', value), [changeReceiptField]);
  const markHeaderTextEdited = useCallback(() => setDocumentDirty(true), []);

  const selectReceiptWarehouse = useCallback((id, option) => {
    if (id !== RECEIPT_HEADER_PICKER_ID) return;
    const warehousecode = option.code || '';
    const warehousecodename = option.name || '';
    setHeader((current) => ({ ...current, warehousecode, warehousecodename }));
    setRows((current) => applyReceiptHeaderToRows(current, { warehousecode, warehousecodename }));
    setDocumentDirty(true);
  }, []);

  const selectReceiptCustomer = useCallback((_id, customer) => {
    const customcode = customer.customercode || '';
    const customname = customer.customername || '';
    setHeader((current) => ({ ...current, customcode, customname }));
    setRows((current) => applyReceiptHeaderToRows(current, { customcode, customname }));
    setDocumentDirty(true);
  }, []);

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
    openRequestRef.current.controller?.abort();
    const controller = new AbortController();
    const requestId = openRequestRef.current.id + 1;
    openRequestRef.current = { id: requestId, controller };
    const isLatest = () => openRequestRef.current.id === requestId;
    setOpeningReceiptno(receiptno);
    setDetailLoading(true);
    try {
      const { data } = await axios.get(`/api/inbound-register/receipts/${encodeURIComponent(receiptno)}`, { ...authConfig(), signal: controller.signal });
      // A newer click (or 신규) superseded this request: drop the stale response.
      if (!isLatest()) return false;
      const receipt = data.receipt;
      setHeader({
        receiptno: receipt.receiptno || '',
        receptdate: String(receipt.receptdate || '').slice(0, 10),
        customcode: receipt.customcode || '',
        customname: receipt.customname || '',
        warehousecode: receipt.warehousecode || receipt.items?.[0]?.warehousecode || '',
        warehousecodename: receipt.warehousecodename || receipt.items?.[0]?.warehousecodename || '',
        manager: receipt.manager || '',
        description: receipt.description || receipt.items?.[0]?.description || '',
      });
      setReceiptMetadata({
        companyid: receipt.companyid || '',
        companyname: receipt.companyname || '',
        created_at: receipt.created_at || '',
        updated_at: receipt.updated_at || '',
      });
      setRows((receipt.items || []).map((item) => {
        const detail = { ...item };
        delete detail.manager;
        return makeDetail({
          ...detail,
          receptdate: String(receipt.receptdate || item.receptdate || '').slice(0, 10),
          customcode: receipt.customcode || item.customcode || '',
          customname: receipt.customname || item.customname || '',
          warehousecode: receipt.warehousecode || item.warehousecode || '',
          warehousecodename: receipt.warehousecodename || item.warehousecodename || '',
        }, item.lineno);
      }));
      setExpenses((receipt.expenses || []).map((expense) => makeExpense({ ...expense, is_new: false, is_dirty: false })));
      setSelectedExpenseIds([]);
      expenseSelectionAnchorRef.current = '';
      setSelectedReceiptno(receipt.receiptno);
      setSubulyn(receipt.subulyn || 'N');
      setDocumentDirty(false);
      setSelectedIds([]);
      setDetailTab('details');
      selectionAnchorRef.current = '';
      return true;
    } catch (error) {
      if (!isLatest()) return false;
      notifications.show({ title: '입고 상세 조회 실패', message: errorMessage(error), color: 'red' });
      return false;
    } finally {
      if (isLatest()) {
        openRequestRef.current.controller = null;
        setOpeningReceiptno('');
        setDetailLoading(false);
      }
    }
  }, [hasPendingChanges]);

  // Expense edits also rerender this page. Keep receipt-table callbacks stable so
  // its memoized rows are not rebuilt while the user is typing in other expenses.
  const openReceiptRef = useRef(openReceipt);
  useLayoutEffect(() => { openReceiptRef.current = openReceipt; }, [openReceipt]);
  const handleOpenReceipt = useCallback((...args) => openReceiptRef.current(...args), []);

  const createReceipt = useCallback(() => {
    if (hasPendingChanges) {
      notifications.show({ title: '저장되지 않은 변경사항', message: '현재 입고 내용을 먼저 저장해 주세요.', color: 'orange' });
      return false;
    }
    // Cancel a receipt still loading so its late response cannot overwrite the new draft.
    if (openRequestRef.current.controller) {
      openRequestRef.current.controller.abort();
      openRequestRef.current = { id: openRequestRef.current.id + 1, controller: null };
      setOpeningReceiptno('');
      setDetailLoading(false);
    }
    setHeader({ ...EMPTY_HEADER, receptdate: localDate() });
    setReceiptMetadata({ companyid: '', companyname: '', created_at: '', updated_at: '' });
    setRows([]);
    setExpenses([]);
    setSelectedExpenseIds([]);
    expenseSelectionAnchorRef.current = '';
    setSelectedReceiptno('');
    setSubulyn('N');
    setDocumentDirty(false);
    setSelectedIds([]);
    setDetailTab('details');
    selectionAnchorRef.current = '';
    return true;
  }, [hasPendingChanges]);

  useEffect(() => {
    if (!pendingFocusIdRef.current) return;
    // Both add and copy append their new row, so avoid scanning the full detail array.
    const rowIndex = rows.length - 1;
    // For virtualized rows, scroll first; registerCellInput applies the pending
    // focus when the target cell mounts. Regular table rows focus in their ref callback.
    if (rowIndex >= 100) requestAnimationFrame(() => virtuosoRef.current?.scrollToIndex({ index: rowIndex, align: 'end', behavior: 'auto' }));
    pendingFocusIdRef.current = '';
  }, [rows.length]);

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
    }, 180);
    codeLookupTimersRef.current.set(id, timer);
  }, [lookupItemNames, unitOptions]);

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
    if (masterPickerTarget.id === RECEIPT_HEADER_PICKER_ID && masterPickerTarget.field === 'warehousecodename') {
      selectReceiptWarehouse(masterPickerTarget.id, option);
      setMasterPickerTarget(null);
      return;
    }
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
  }, [masterPickerTarget, changeDetail, selectReceiptWarehouse]);

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
    const receiptValues = startingNewReceipt ? { ...EMPTY_HEADER, receptdate: localDate() } : header;
    const row = makeDetail({
      receptdate: receiptValues.receptdate,
      customcode: receiptValues.customcode,
      customname: receiptValues.customname,
      warehousecode: receiptValues.warehousecode,
      warehousecodename: receiptValues.warehousecodename,
    });
    pendingFocusIdRef.current = row.id;
    pendingCellFocusRef.current = { key: `${row.id}:productname` };
    setRows((current) => startingNewReceipt ? [row] : [...current, row]);
    if (startingNewReceipt) { setExpenses([]); setSelectedExpenseIds([]); expenseSelectionAnchorRef.current = ''; setDetailTab('details'); }
    setDocumentDirty(true);
    selectionAnchorRef.current = '';
  }, [saving, selectedReceiptno, createReceipt, readOnly, header]);

  const handleAddAction = useCallback(() => {
    if (selectedReceiptno) { addDetail(); return; }
    if (detailTab === 'expenses') addExpense();
    else addDetail();
  }, [selectedReceiptno, detailTab, addExpense, addDetail]);

  const toggleSelection = useCallback((id, shiftKey = false) => {
    const currentRows = detailRowsRef.current;
    setSelectedIds((current) => {
      const from = currentRows.findIndex((row) => row.id === selectionAnchorRef.current);
      const to = currentRows.findIndex((row) => row.id === id);
      if (shiftKey && from >= 0 && to >= 0) {
        selectionAnchorRef.current = id;
        return [...new Set([...current, ...currentRows.slice(Math.min(from, to), Math.max(from, to) + 1).map((row) => row.id)])];
      }
      selectionAnchorRef.current = id;
      return current.includes(id) ? current.filter((value) => value !== id) : [...current, id];
    });
  }, []);
  const toggleAll = useCallback((checked) => {
    setSelectedIds(checked ? detailRowsRef.current.map((row) => row.id) : []);
    selectionAnchorRef.current = '';
  }, []);

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

  // Keep the per-cell paste handler stable so adding a row does not invalidate
  // every memoized detail row just because pasteRange captured the latest rows.
  const pasteRangeRef = useRef(pasteRange);
  pasteRangeRef.current = pasteRange;
  const handlePasteRange = useCallback((...args) => pasteRangeRef.current(...args), []);

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
    if (rows.length && !isValidDateInput(header.receptdate)) {
      notifications.show({
        title: '입고일자 형식 확인',
        message: '입고일자를 YYYY-MM-DD 형식으로 입력해 주세요. 예: 2026-10-23',
        color: 'orange',
        autoClose: 8000,
      });
      return false;
    }
    const missing = [];
    if (selectedReceiptno && !header.receiptno.trim()) missing.push('입고전표번호');
    if (!rows.length) missing.push('상세 품목');
    if (!String(header.customcode || '').trim()) missing.push('매입처');
    if (!String(header.warehousecode || '').trim()) missing.push('창고');
    if (missing.length) {
      notifications.show({ title: '필수 항목을 입력해 주세요', message: missing.join(', '), color: 'orange' });
      return false;
    }
    const failures = rows.flatMap((row, index) => {
      const errors = [];
      if (!String(row.itemcode || '').trim()) errors.push('품목명 자동완성에서 품목을 선택해 주세요');
      if (!String(row.itemname || '').trim()) errors.push('품목명');
      if (!String(row.qtyunit || '').trim()) errors.push('수량단위');
      const qtyText = String(row.qty ?? '').trim();
      const qty = Number(qtyText);
      if (!qtyText || !Number.isFinite(qty) || qty <= 0) errors.push('수량(0 초과)');
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
    const invalidExpenses = expenses.map((expense, index) => ({
      index: index + 1,
      missing: [
        !String(expense.costname || '').trim() && '비용구분',
        !String(expense.supplyamt ?? '').trim() && '공급가',
        !String(expense.vat ?? '').trim() && '부가세',
        !String(expense.customcode || '').trim() && '거래처',
      ].filter(Boolean),
    })).filter((entry) => entry.missing.length);
    if (invalidExpenses.length) {
      setDetailTab('expenses');
      notifications.show({
        title: '기타비용 입력 확인',
        message: invalidExpenses.slice(0, 5).map((entry) => `${entry.index}행 ${entry.missing.join(', ')}`).join(' · '),
        color: 'orange',
        autoClose: 8000,
      });
      return false;
    }
    return true;
  }, [header, rows, selectedReceiptno, expenses]);

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
      setSaving(true);
      try {
        const { data } = await axios.patch(
          '/api/inbound-register/receipts/' + encodeURIComponent(selectedReceiptno) + '/manager',
          { manager: String(header.manager || '').trim() },
          authConfig(),
        );
        await openReceipt(selectedReceiptno, true);
        notifications.show({
          title: '담당자 수정 완료',
          message: '입고전표 담당자를 수정했습니다. 관련 현재고·수불현황에도 반영했습니다.',
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
        receptdate: sourceHeader.receptdate,
        customcode: sourceHeader.customcode,
        customname: sourceHeader.customname,
        warehousecode: sourceHeader.warehousecode,
        warehousecodename: sourceHeader.warehousecodename,
        manager: String(sourceHeader.manager || '').trim(),
        description: sourceHeader.description,
        is_new: !selectedReceiptno,
        items: sourceRows.map((row) => ({
          receptdate: sourceHeader.receptdate,
          customcode: String(sourceHeader.customcode || '').trim(),
          customname: String(sourceHeader.customname || '').trim(),
          itemcode: String(row.itemcode || '').trim(), itemname: String(row.itemname || '').trim(),
          productname: String(row.productname || '').trim(),
          materialcode: String(row.materialcode || '').trim(), materialname: String(row.materialname || '').trim(),
          surfacecode: String(row.surfacecode || '').trim(), surfacename: String(row.surfacename || '').trim(),
          myrtle: String(row.myrtle ?? '').trim(),
          thickness: String(row.thickness ?? '').trim(), width: String(row.width ?? '').trim(), length: String(row.length ?? '').trim(),
          unit: unitOptions.price.find((option) => option.code === resolveMasterCode('unit', row.unit || 'KG', unitOptions))?.name || String(row.unit || 'KG').trim(),
          qty: String(row.qty ?? '').trim(), qtyunit: unitOptions.quantity.find((option) => option.code === resolveMasterCode('qtyunit', row.qtyunit, unitOptions))?.name || String(row.qtyunit || '').trim(),
          warehousecode: resolveMasterCode('warehouse', sourceHeader.warehousecode || sourceHeader.warehousecodename, unitOptions) || String(sourceHeader.warehousecode || '').trim(),
          warehousecodename: String(sourceHeader.warehousecodename || '').trim(),
          weight: String(row.weight || '').trim(), unitprice: String(row.unitprice || '').trim(),
          supplyamt: row.supplyamt_manual ? String(row.supplyamt || '0').trim() : '',
          vat: row.vat_manual ? String(row.vat || '0').trim() : '',
        })),
        expenses: expenses.map((expense) => ({
          costcode: String(expense.costcode || '').trim(),
          costname: String(expense.costname || '').trim(),
          supplyamt: cleanNumericInput(expense.supplyamt) || '0',
          vat: cleanNumericInput(expense.vat) || '0',
          customcode: String(expense.customcode || '').trim(),
          customname: String(expense.customname || '').trim(),
          description: String(expense.description || '').trim(),
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
  }, [selectedReceiptno, hasManagerChanges, locked, rows, expenses, openReceipt, header, unitOptions, validateDetailMasters, validateDocument, loadReceipts]);

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
        ['입고일자', () => header.receptdate || ''],
        ['매입처', () => header.customname || ''],
        ['창고', () => header.warehousecodename || ''],
        ['비고', () => header.description || ''],
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
        ['등록자', (row) => row.created_by ?? ''],
        ['수정자', (row) => row.updated_by ?? ''],
      ];
      const worksheet = XLSX.utils.aoa_to_sheet([
        exportFields.map(([label]) => label),
        ...rows.map((row, index) => exportFields.map(([, getValue]) => getValue(row, index))),
      ]);
      applyExcelHeaderStyle(worksheet, exportFields.length);
      worksheet['!cols'] = exportFields.map(([label]) => ({ wch: Math.min(28, Math.max(14, String(label).length + 4)) }));
      worksheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: exportFields.length - 1 } }) };
      XLSX.utils.book_append_sheet(workbook, worksheet, '매입내역');
      const safeFilePart = (value) => {
        const invalidCharacters = '<>:"/\\|?*';
        const safePart = [...String(value || '').trim()]
          .map((character) => character.charCodeAt(0) < 32 || invalidCharacters.includes(character) ? '_' : character)
          .join('')
          .replace(/\s+/g, '_');
        return safePart || '미입력';
      };
      XLSX.writeFile(workbook, `매입전표_${safeFilePart(header.customname || header.customcode)}_${safeFilePart(header.receptdate)}_${safeFilePart(header.receiptno)}.xlsx`);
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
    if (detailTab === 'expenses') {
      if (selectedExpenseIds.length && !readOnly) removeSelectedExpenses();
      else notifications.show({ title: '삭제할 행을 선택해 주세요', message: '기타비용 표에서 삭제할 행을 선택한 뒤 상단 삭제를 눌러 주세요.', color: 'orange' });
      return;
    }
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
  }, [detailTab, selectedExpenseIds.length, removeSelectedExpenses, selectedIds.length, readOnly, deleteSelectedDetails, selectedReceiptno, hasPendingChanges]);

  const ribbonActionsRef = useRef({});
  ribbonActionsRef.current = { runSearch, handleAddAction, copySelectedDetails, exportDocument, saveDocument, requestToolbarDelete, closeActivePage };
  const invokeRibbonAction = useCallback((action) => ribbonActionsRef.current[action]?.(), []);
  const hasExportableRows = Boolean(selectedReceiptno && rows.length);

  useEffect(() => {
    if (!registerPageRibbon) return undefined;
    registerPageRibbon(
      <Group className={classes.commandRibbon} justify="flex-start" wrap="nowrap" gap={2}>
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconSearch size={15} />} onClick={() => invokeRibbonAction('runSearch')} loading={loading}>조회</Button>
        <span className={classes.ribbonSeparator} />
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconPlus size={15} />} onClick={() => invokeRibbonAction('handleAddAction')} disabled={saving}>추가</Button>
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconCopy size={15} />} onClick={() => invokeRibbonAction('copySelectedDetails')} disabled={readOnly || saving || selectedIds.length !== 1}>복사</Button>
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconFileSpreadsheet size={15} />} onClick={() => invokeRibbonAction('exportDocument')} loading={exporting} disabled={!hasExportableRows || loading || detailLoading}>엑셀</Button>
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconDeviceFloppy size={15} />} onClick={() => invokeRibbonAction('saveDocument')} loading={saving} disabled={selectedReceiptno ? (locked || detailLoading || !hasManagerChanges) : (readOnly || detailLoading)}>저장</Button>
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconTrash size={15} />} onClick={() => invokeRibbonAction('requestToolbarDelete')} disabled={saving || (detailTab === 'expenses' ? (readOnly || !selectedExpenseIds.length) : (locked || (!selectedReceiptno && (!selectedIds.length || readOnly))))}>삭제</Button>
        <span className={classes.ribbonSeparator} />
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconX size={15} />} onClick={() => invokeRibbonAction('closeActivePage')}>닫기</Button>
      </Group>,
    );
    return () => registerPageRibbon(null);
  }, [registerPageRibbon, invokeRibbonAction, loading, saving, readOnly, selectedIds.length, selectedExpenseIds.length, detailTab, exporting, hasExportableRows, detailLoading, selectedReceiptno, locked, hasManagerChanges]);

  const requestDeleteReceipt = useCallback(async () => {
    if (!selectedReceiptno || locked) return;
    setSaving(true);
    try {
      await axios.delete(`/api/inbound-register/receipts/${encodeURIComponent(selectedReceiptno)}`, authConfig());
      notifications.show({ title: '입고 삭제 완료', message: `${selectedReceiptno} 전표를 삭제했습니다.`, color: 'teal' });
      setDeleteOpen(false);
      setHeader({ ...EMPTY_HEADER, receptdate: localDate() });
      setReceiptMetadata({ companyid: '', companyname: '', created_at: '', updated_at: '' });
      setRows([]); setExpenses([]); setSelectedExpenseIds([]); expenseSelectionAnchorRef.current = '';
      setSelectedReceiptno(''); setSubulyn('N'); setDocumentDirty(false); setDetailTab('details');
      await loadReceipts(page, filters);
    } catch (error) {
      notifications.show({ title: '입고 삭제 실패', message: errorMessage(error), color: 'red' });
    } finally { setSaving(false); }
  }, [selectedReceiptno, locked, loadReceipts, page, filters]);

  const rowContent = useCallback((index, row) => (
    <DetailCells row={row} index={index} selected={selectedSet.has(row.id)} disabled={saving || readOnly}
      saved={readOnly} unitOptions={unitOptions}
      onSelect={toggleSelection} onChange={changeDetail} onPaste={handlePasteRange}
      registerCellInput={registerCellInput} onSelectItem={selectItem} onSelectCustomer={selectCustomerForRow} onSelectWarehouse={selectWarehouse} onSelectGeneralMaster={selectGeneralMaster} onFindItem={openItemPicker}
      onFindCustomer={openCustomerPicker} onFindMaster={openMasterPicker} onFocusCell={setActiveCell} />
  ), [selectedSet, saving, readOnly, unitOptions, toggleSelection, changeDetail, handlePasteRange, registerCellInput, selectItem, selectCustomerForRow, selectWarehouse, selectGeneralMaster, openItemPicker, openCustomerPicker, openMasterPicker, setActiveCell]);

  const allRowsSelected = rows.length > 0 && selectedIds.length === rows.length;
  const noDetailRows = rows.length === 0;
  const headerColumns = useMemo(() => [
    // Disabled exactly like the row checkboxes (saved receipt = read-only), plus when there are no rows.
    { key: 'select', width: 42, minWidth: 42, className: codeClasses.checkCol, label: <input type="checkbox" aria-label="상세 전체 선택" checked={allRowsSelected} disabled={saving || readOnly || noDetailRows} onChange={(event) => toggleAll(event.currentTarget.checked)} /> },
    { key: 'number', width: 58, minWidth: 58, className: codeClasses.numberCol, label: 'No.' },
    ...DETAIL_FIELDS.map(({ key, label, width, minWidth, required }) => ({
      key, width, minWidth: minWidth || width,
      label: <>{label}{required && <span className={codeClasses.required}> *</span>}</>,
    })),
  ], [allRowsSelected, toggleAll, saving, readOnly, noDetailRows]);
  const tableWidth = useMemo(
    () => headerColumns.reduce((sum, column) => sum + (columnWidths[column.key] ?? column.width), 0),
    [headerColumns, columnWidths],
  );
  const renderHeader = useCallback((column) => (
    <Table.Th key={column.key} className={[codeClasses.resizableHeader, column.className].filter(Boolean).join(' ')} style={{ width: columnWidths[column.key] ?? column.width }}>
      <span style={{ whiteSpace: 'nowrap' }}>{column.label}</span><span className={codeClasses.columnResizeHandle} onPointerDown={(event) => resizeColumn(event, column.key, column.width, column.minWidth, tableWidth)} role="separator" aria-label={`${column.key} 열 너비 조절`} />
    </Table.Th>
  ), [columnWidths, resizeColumn, tableWidth]);
  const detailHeaderRow = useMemo(() => <Table.Tr>{headerColumns.map(renderHeader)}</Table.Tr>, [headerColumns, renderHeader]);
  const renderDetailHeaderRow = useCallback(() => detailHeaderRow, [detailHeaderRow]);
  const receiptTableWidth = RECEIPT_COLUMNS.reduce((sum, column) => sum + (receiptColumnWidths[column.key] ?? receiptAutoWidths[column.key] ?? column.width), 0);
  const receiptSubtotals = useMemo(() => receipts.reduce((totals, receipt) => {
    for (const key of ['line_count', 'total_qty', 'total_weight', 'supply_amount', 'vat_amount', 'total_amount', 'other_cost_amount']) {
      totals[key] += Number(receipt[key]) || 0;
    }
    return totals;
  }, { line_count: 0, total_qty: 0, total_weight: 0, supply_amount: 0, vat_amount: 0, total_amount: 0, other_cost_amount: 0 }), [receipts]);
  const syncReceiptScroll = useCallback((left) => {
    for (const element of [receiptTableRef.current, receiptSubtotalRef.current]) {
      if (element && Math.abs(element.scrollLeft - left) > 0.5) element.scrollLeft = left;
    }
  }, []);
  const renderReceiptHeader = useCallback((column) => (
    <Table.Th key={column.key} className={codeClasses.resizableHeader} ta={column.align} style={{ width: receiptColumnWidths[column.key] ?? receiptAutoWidths[column.key] ?? column.width }}>
      <span style={{ whiteSpace: 'nowrap' }}>{column.label}</span><span className={codeClasses.columnResizeHandle} onPointerDown={(event) => resizeReceiptColumn(event, column.key, column.width, column.minWidth)} role="separator" aria-label={`${column.label} 열 너비 조절`} />
    </Table.Th>
  ), [receiptColumnWidths, receiptAutoWidths, resizeReceiptColumn]);
  const receiptCustomerData = useMemo(() => {
    const options = receiptCustomers
      .map((customer) => ({ value: customer.customercode, label: customer.customername }))
      .filter((option) => option.value && option.label);
    if (header.customcode && !options.some((option) => option.value === header.customcode)) {
      options.unshift({ value: header.customcode, label: header.customname || header.customcode });
    }
    return options;
  }, [receiptCustomers, header.customcode, header.customname]);
  const receiptWarehouseData = useMemo(() => {
    const options = unitOptions.warehouse
      .map((warehouse) => ({ value: warehouse.code, label: warehouse.name }))
      .filter((option) => option.value && option.label);
    if (header.warehousecode && !options.some((option) => option.value === header.warehousecode)) {
      options.unshift({ value: header.warehousecode, label: header.warehousecodename || header.warehousecode });
    }
    return options;
  }, [unitOptions.warehouse, header.warehousecode, header.warehousecodename]);

  const closeCustomerPicker = useCallback(() => { setCustomerPickerOpen(false); setCustomerPickerTarget(null); }, []);
  const closeItemPicker = useCallback(() => setItemPickerTarget(null), []);
  const closeExpenseCostPicker = useCallback(() => setExpenseCostPickerId(''), []);
  const selectExpenseCostFromPicker = useCallback((option) => {
    if (expenseCostPickerId) changeExpense(expenseCostPickerId, 'costcode', option.code || '');
    setExpenseCostPickerId('');
  }, [expenseCostPickerId, changeExpense]);
  const closeMasterPicker = useCallback(() => setMasterPickerTarget(null), []);
  const masterPickerField = masterPickerTarget?.field;
  const masterPickerOptions = masterPickerField === 'qtyunit' ? unitOptions.quantity : masterPickerField === 'unit' ? unitOptions.price : masterPickerField === 'material' ? unitOptions.material : masterPickerField === 'surface' ? unitOptions.surface : unitOptions.warehouse;
  const allExpensesSelected = expenses.length > 0 && selectedExpenseIds.length === expenses.length;
  const expenseHeader = useMemo(() => (
    <Table.Thead><Table.Tr>
      <Table.Th className={codeClasses.checkCol} style={{ width: 42 }} ta="center"><input type="checkbox" aria-label="기타비용 전체 선택" disabled={saving || readOnly}
        checked={allExpensesSelected} onChange={(event) => toggleAllExpenses(event.currentTarget.checked)} /></Table.Th>
      <Table.Th style={{ width: 52 }}>No.</Table.Th>
      <Table.Th style={{ width: 160 }}>비용 구분<span className={codeClasses.required}> *</span></Table.Th>
      <Table.Th style={{ width: 145 }} ta="right">공급가<span className={codeClasses.required}> *</span></Table.Th>
      <Table.Th style={{ width: 135 }} ta="right">부가세<span className={codeClasses.required}> *</span></Table.Th>
      <Table.Th style={{ width: 145 }} ta="right">합계금액</Table.Th>
      <Table.Th style={{ width: 190 }}>거래처<span className={codeClasses.required}> *</span></Table.Th>
      <Table.Th>비고</Table.Th>
    </Table.Tr></Table.Thead>
  ), [saving, readOnly, allExpensesSelected, toggleAllExpenses]);
  const detailTable = useMemo(() => (
    <Table className={`${sharedClasses.table} ${codeClasses.codeTable}`} highlightOnHover withTableBorder withColumnBorders verticalSpacing="xs" horizontalSpacing={0}
      style={{ width: '100%', minWidth: 'var(--code-table-min-width)', tableLayout: 'fixed' }}>
      <Table.Thead>{detailHeaderRow}</Table.Thead>
      <Table.Tbody><InboundDetailTableRows renderCells={rowContent} /></Table.Tbody>
    </Table>
  ), [detailHeaderRow, rowContent]);
  const expenseRowsValue = useMemo(() => ({ expenses, selectedExpenseSet }), [expenses, selectedExpenseSet]);
  const expenseTable = useMemo(() => (
    <Table className={`${sharedClasses.table} ${codeClasses.codeTable}`} withTableBorder withColumnBorders horizontalSpacing="xs" verticalSpacing="xs"
      style={{ width: '100%', minWidth: 1120, tableLayout: 'fixed' }}>
      {expenseHeader}
      <InboundExpenseTableRows disabled={saving || readOnly} options={expenseOptions} getInputRef={getExpenseCostInputRef}
        onToggle={toggleExpenseSelection} onChange={changeExpense} onOpenCustomerPicker={openCustomerPicker}
        onSetCostPicker={setExpenseCostPickerId} />
    </Table>
  ), [expenseHeader, saving, readOnly, expenseOptions, getExpenseCostInputRef, toggleExpenseSelection, changeExpense, openCustomerPicker]);
  const highlightedReceiptno = openingReceiptno || selectedReceiptno;
  const receiptPanel = useMemo(() => (
    <Paper className={`${sharedClasses.panel} ${classes.topReceiptPanel}`} withBorder>
      <Group className={classes.topReceiptToolbar} justify="space-between" wrap="wrap">
        <Group gap={8}><Text className={classes.sectionTitle} fw={700}>입고 기본</Text><Badge color="gray" variant="light">{total.toLocaleString()}건</Badge></Group>
      </Group>
      <Box ref={receiptTableRef} className={classes.topReceiptTable}>
        <Table className={classes.receiptFinderTable} stickyHeader highlightOnHover withTableBorder withColumnBorders style={{ width: `${receiptTableWidth}px`, minWidth: `${receiptTableWidth}px`, tableLayout: 'fixed' }}>
          <colgroup>{RECEIPT_COLUMNS.map((column) => <col key={column.key} data-column-key={column.key} style={{ width: `${receiptColumnWidths[column.key] ?? receiptAutoWidths[column.key] ?? column.width}px` }} />)}</colgroup>
          <Table.Thead><Table.Tr>{RECEIPT_COLUMNS.map(renderReceiptHeader)}</Table.Tr></Table.Thead>
          <Table.Tbody>
            <InboundReceiptRows receipts={receipts} selectedReceiptno={highlightedReceiptno} onOpenReceipt={handleOpenReceipt} />
          </Table.Tbody>
        </Table>
        {!receipts.length && <Box className={classes.topReceiptEmptyMessage}>{loading ? '조회 중입니다.' : '검색된 입고전표가 없습니다.'}</Box>}
      </Box>
      <Box className={classes.topReceiptBottom}>
        {!!receipts.length && <Box ref={receiptSubtotalRef} className={classes.topReceiptSubtotalViewport}>
          <Table className={`${classes.receiptFinderTable} ${classes.receiptSubtotalTable}`} withTableBorder withColumnBorders
            style={{ width: `${receiptTableWidth}px`, minWidth: `${receiptTableWidth}px`, tableLayout: 'fixed' }}>
            <colgroup>{RECEIPT_COLUMNS.map((column) => <col key={column.key} data-column-key={column.key} style={{ width: `${receiptColumnWidths[column.key] ?? receiptAutoWidths[column.key] ?? column.width}px` }} />)}</colgroup>
            <Table.Tbody><Table.Tr>
              {RECEIPT_COLUMNS.map((column, index) => <Table.Td key={column.key} className={`${classes.topReceiptSubtotalCell} ${column.align === 'right' ? classes.topReceiptSubtotalNumber : ''}`} ta={column.align}>
              {index === 0 ? '소계' : column.key === 'line_count' ? receiptSubtotals.line_count.toLocaleString()
                : column.key === 'total_qty' || column.key === 'total_weight' ? receiptSubtotals[column.key].toLocaleString(undefined, { maximumFractionDigits: 3 })
                  : ['supply_amount', 'vat_amount', 'total_amount', 'other_cost_amount'].includes(column.key) ? formatWon(String(receiptSubtotals[column.key])) : ''}
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
  ), [total, receiptTableWidth, receiptColumnWidths, receiptAutoWidths, renderReceiptHeader, receipts, highlightedReceiptno, handleOpenReceipt, loading, receiptSubtotals, syncReceiptScroll, pageSize, loadReceipts, filters, page]);
  const receiptHeaderFields = useMemo(() => (
    <Box className={classes.sharedReceiptFields}>
      <Box className={classes.sharedReceiptField}>
        <Text size="xs" fw={700} mb={4}>입고일자 <span className={codeClasses.required}>*</span></Text>
        <ErpDateInput type="date" aria-label="입고일자" value={header.receptdate || ''} disabled={readOnly || saving}
          onChange={(event) => changeReceiptField('receptdate', event.currentTarget.value)} />
      </Box>
      <Box className={classes.sharedReceiptField}>
        <Text size="xs" fw={700} mb={4}>매입처 <span className={codeClasses.required}>*</span></Text>
        <Select searchable autoSelectOnBlur aria-label="매입처" placeholder=""
          disabled={readOnly || saving} data={receiptCustomerData} value={header.customcode || null}
          onChange={(value) => {
            const customer = receiptCustomers.find((item) => item.customercode === value);
            selectReceiptCustomer(RECEIPT_HEADER_PICKER_ID, customer || {
              customercode: value || '', customername: receiptCustomerData.find((item) => item.value === value)?.label || '',
            });
          }} />
      </Box>
      <Box className={classes.sharedReceiptField}>
        <Text size="xs" fw={700} mb={4}>창고 <span className={codeClasses.required}>*</span></Text>
        <Select searchable autoSelectOnBlur aria-label="창고" placeholder=""
          disabled={readOnly || saving} data={receiptWarehouseData} value={header.warehousecode || null}
          onChange={(value) => {
            const warehouse = unitOptions.warehouse.find((item) => item.code === value);
            selectReceiptWarehouse(RECEIPT_HEADER_PICKER_ID, warehouse || {
              code: value || '', name: receiptWarehouseData.find((item) => item.value === value)?.label || '',
            });
          }} />
      </Box>
      <Box className={classes.sharedReceiptField}>
        <Text size="xs" fw={700} mb={4}>담당자</Text>
        <DeferredHeaderTextInput key={`${selectedReceiptno}:manager:${header.manager || ''}`} ariaLabel="담당자" value={header.manager || ''} maxLength={100} disabled={saving || locked} onEditStart={markHeaderTextEdited}
          onCommit={commitReceiptManager} />
      </Box>
      <Box className={classes.sharedReceiptField}>
        <Text size="xs" fw={700} mb={4}>비고</Text>
        <DeferredHeaderTextInput key={`${selectedReceiptno}:description:${header.description || ''}`} ariaLabel="입고 비고" value={header.description || ''} maxLength={500} disabled={readOnly || saving} onEditStart={markHeaderTextEdited}
          onCommit={commitReceiptDescription} />
      </Box>
    </Box>
  ), [header, readOnly, saving, locked, changeReceiptField, receiptCustomerData, receiptCustomers, selectReceiptCustomer, receiptWarehouseData, unitOptions.warehouse, selectReceiptWarehouse, selectedReceiptno, markHeaderTextEdited, commitReceiptManager, commitReceiptDescription]);
  const filterSidebar = useMemo(() => (
    <Paper component="aside" className={classes.receiptFilterSidebar} withBorder>
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
            <ErpDateInput type="date" aria-label="입고기간 시작일" value={filterInputs.date_from}
              onChange={(event) => { const { value: nextValue } = event.currentTarget; setFilterInputs((current) => ({ ...current, date_from: nextValue })); }} />
            <ErpDateInput type="date" aria-label="입고기간 종료일" value={filterInputs.date_to}
              onChange={(event) => { const { value: nextValue } = event.currentTarget; setFilterInputs((current) => ({ ...current, date_to: nextValue })); }} />
          </Stack>
        </Box>
        <TextInput label="매입처" placeholder="매입처코드 또는 매입처명" value={filterInputs.customer}
          onChange={(event) => { const { value: nextValue } = event.currentTarget; setFilterInputs((current) => ({ ...current, customer: nextValue })); }}
          onKeyDown={(event) => { if (event.key === 'Enter') runSearch(); }} />
        <TextInput label="창고" placeholder="창고코드 또는 창고명" value={filterInputs.warehouse}
          onChange={(event) => { const { value: nextValue } = event.currentTarget; setFilterInputs((current) => ({ ...current, warehouse: nextValue })); }}
          onKeyDown={(event) => { if (event.key === 'Enter') runSearch(); }} />
        <TextInput label="입고전표번호" placeholder="전표번호" value={filterInputs.receiptno}
          onChange={(event) => { const { value: nextValue } = event.currentTarget; setFilterInputs((current) => ({ ...current, receiptno: nextValue })); }}
          onKeyDown={(event) => { if (event.key === 'Enter') runSearch(); }} />
        </Stack>
    </Paper>
  ), [filterInputs, runSearch]);

  return (
    <Box className={`${sharedClasses.pageShell} ${classes.page}`}>
      <Box component="nav" aria-label="현재 위치" className={classes.pageBreadcrumb}>
        <Group className={classes.breadcrumbTrail} gap={7}>
          <Text component="span" className={classes.breadcrumbParent}>매입관리</Text>
          <Text component="span" className={classes.breadcrumbChevron}>›</Text>
          <Text component="span" className={classes.breadcrumbCurrent}>매입등록</Text>
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

      {receiptPanel}

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

          {receiptHeaderFields}

          <Box className={outboundClasses.detailTabsBar} role="tablist" aria-label="입고 상세 구분">
            <button type="button" role="tab" aria-selected={detailTab === 'details'} className={detailTab === 'details' ? outboundClasses.detailTabActive : outboundClasses.detailTab}
              onClick={() => setDetailTab('details')}>입고 상세 {rows.length.toLocaleString()}건</button>
            <button type="button" role="tab" aria-selected={detailTab === 'expenses'} className={detailTab === 'expenses' ? outboundClasses.detailTabActive : outboundClasses.detailTab}
              onClick={() => setDetailTab('expenses')}>기타비용 {expenses.length.toLocaleString()}건</button>
          </Box>
          {detailTab === 'details' && <>
          <Box className={`${codeClasses.tableWrap} ${(rows.length <= 100 || (selectedReceiptno && rows.length <= 200)) ? classes.savedDetailScroller : ''} ${!detailLoading && !rows.length ? classes.emptyDetailWrap : ''}`} style={{ '--code-table-min-width': `${Math.max(1120, tableWidth)}px` }} onKeyDown={handleTableKeyDown}>
            {detailLoading ? <Box className={classes.receiptLoading}><Loader size="sm" color="red" /></Box> : rows.length ? (
              (rows.length <= 100 || (selectedReceiptno && rows.length <= 200)) ? <>
                <DetailRowsContext.Provider value={rows}>{detailTable}</DetailRowsContext.Provider>
              </> : <TableVirtuoso ref={virtuosoRef} data={rows} style={{ height: '100%' }} components={virtuosoComponents} computeItemKey={(_index, row) => row.id} increaseViewportBy={{ top: 84, bottom: 84 }} fixedHeaderContent={renderDetailHeaderRow} itemContent={rowContent} />
            ) : (
              <Table className={`${sharedClasses.table} ${codeClasses.codeTable}`} highlightOnHover withTableBorder withColumnBorders verticalSpacing="xs" horizontalSpacing={0}
                style={{ width: '100%', minWidth: 'var(--code-table-min-width)', tableLayout: 'fixed' }}>
                <Table.Thead>{detailHeaderRow}</Table.Thead>
              </Table>
            )}
            {!detailLoading && !rows.length && (
              <Box className={classes.emptyDetailMessage}>
                {selectedReceiptno ? '입고 상세가 없습니다.' : '상단 헤더의 추가를 눌러 품목을 등록하세요.'}
              </Box>
            )}
          </Box>
          <InboundDetailSummary rows={rows} unitOptions={unitOptions} />
          </>}
          {detailTab === 'expenses' && <Box className={outboundClasses.expenseTabPanel}>
            <Box className={`${codeClasses.tableWrap} ${outboundClasses.expenseTableWrap} ${expenses.length <= 100 ? classes.savedDetailScroller : ''} ${!expenses.length ? classes.emptyDetailWrap : ''}`}>
              <ExpenseRowsContext.Provider value={expenseRowsValue}>{expenseTable}</ExpenseRowsContext.Provider>
              {!expenses.length && <Box className={classes.emptyDetailMessage}>등록된 기타비용이 없습니다.</Box>}
            </Box>
            <Group className={`${sharedClasses.footer} ${codeClasses.tableFooter}`} justify="flex-end" wrap="wrap">
              <Text size="xs" fw={700}>총공급가 {formatWon(String(expenseTotals.supply))}{' · '}부가세 {formatWon(String(expenseTotals.vat))}{' · '}합계 {formatWon(String(expenseTotals.total))}</Text>
            </Group>
          </Box>}
        </Paper>
      </Box>
        </Box>

        {filterOpen && filterSidebar}
      </Box>

      <Modal opened={deleteOpen} onClose={() => !saving && setDeleteOpen(false)} title="입고전표 삭제" centered size="sm">
        <Stack gap="md">
          <Text size="sm" c="dimmed">{selectedReceiptno} 전표와 상세 내역을 삭제합니다. 삭제한 전표는 복구할 수 없습니다.</Text>
          <Group justify="flex-end"><Button variant="default" onClick={() => setDeleteOpen(false)} disabled={saving}>취소</Button><Button color="red" leftSection={<IconTrash size={15} />} onClick={requestDeleteReceipt} loading={saving}>삭제</Button></Group>
        </Stack>
      </Modal>

      <CustomerPickerModal opened={customerPickerOpen} onClose={closeCustomerPicker} onSelect={selectCustomer} />
      <MasterOptionPickerModal
        key={expenseCostPickerId || 'expense-cost-closed'}
        opened={Boolean(expenseCostPickerId)}
        onClose={closeExpenseCostPicker}
        title="비용 구분 선택"
        options={expenseOptions}
        onSelect={selectExpenseCostFromPicker}
      />
      <ItemPickerModal opened={itemPickerTarget !== null} onClose={closeItemPicker} onSelect={selectItemFromPicker} />
      <MasterOptionPickerModal
        key={masterPickerTarget ? `${masterPickerTarget.id}:${masterPickerTarget.field}` : 'closed'}
        opened={Boolean(masterPickerTarget)}
        onClose={closeMasterPicker}
        title={masterPickerField === 'qtyunit' ? '수량단위 선택' : masterPickerField === 'unit' ? '단가기준 선택' : masterPickerField === 'material' ? '강종 선택' : masterPickerField === 'surface' ? '표면 선택' : '창고 선택'}
        options={masterPickerOptions}
        onSelect={selectMasterOption}
      />
    </Box>
  );
}
