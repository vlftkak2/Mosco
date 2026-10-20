import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { ActionIcon, Badge, Button, Group, Modal, NumberInput, Pagination, Paper, Select, Table, Text, TextInput, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconDeviceFloppy, IconPlus, IconSearch, IconTrash } from '@tabler/icons-react';
import sharedClasses from '../styles/pages/ManagementShared.module.css';
import dashboardClasses from '../styles/pages/HomePage.module.css';
import classes from '../styles/pages/Purchase.module.css';

const api = axios.create({ baseURL: '/api/purchase' });
api.interceptors.request.use((config) => { config.headers.Authorization = `Bearer ${localStorage.getItem('access_token') || ''}`; return config; });
const auth = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });
const today = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };
const dateText = (value) => value ? String(value).slice(0, 10) : '';
const number = (value) => Number(value || 0).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
const errorText = (error) => { const detail = error.response?.data?.detail; return Array.isArray(detail) ? detail.map((entry) => entry.msg).join(' / ') : detail || '요청을 처리하지 못했습니다.'; };
const rowId = () => `purchase-row-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const emptyLine = () => ({ id: rowId(), inboundlineno: null, itemcode: '', itemname: '', size: '', steelgrade: '', thickness: '', width: '', length: '', qty: '', qtyunit: '', weight: '', unit: '', unitprice: '', warehousecode: '', warehousecodename: '', description: '' });
const blank = () => ({ purchaseno: '', receiptno: '', purchasedate: today(), customcode: '', customname: '', paymentterms: '', paymentduedate: '', vattype: 'TAXABLE', freightamount: 0, otheramount: 0, vatamount: 0, description: '', lines: [] });
const columns = [
  { key: 'itemcode', title: '품목코드', width: 145, master: 'item', required: true },
  { key: 'itemname', title: '품목명', width: 180, readonly: true },
  { key: 'size', title: '규격', width: 140 },
  { key: 'steelgrade', title: '강종', width: 115 },
  { key: 'thickness', title: '두께', width: 100, numeric: true },
  { key: 'width', title: '폭', width: 100, numeric: true },
  { key: 'length', title: '길이', width: 100, numeric: true },
  { key: 'qty', title: '수량', width: 100, numeric: true, required: true },
  { key: 'qtyunit', title: '수량단위', width: 115, master: 'qtyunit', required: true },
  { key: 'weight', title: '중량(KG)', width: 110, numeric: true, required: true },
  { key: 'unit', title: '단가기준', width: 110, master: 'unit', required: true },
  { key: 'unitprice', title: '매입단가', width: 125, numeric: true, required: true },
  { key: 'supplyamount', title: '공급가', width: 125, readonly: true },
  { key: 'warehousecode', title: '창고', width: 135, master: 'warehouse' },
  { key: 'description', title: '비고', width: 200 },
];
const listColumns = [
  ['purchaseno', '매입전표번호', 170], ['purchasedate', '매입일자', 120], ['customname', '매입처', 180],
  ['receiptno', '입고번호', 150], ['paymentterms', '결제조건', 130], ['paymentduedate', '결제예정일', 125],
  ['itemcount', '품목 수', 80], ['goodsamount', '품목 공급가', 130], ['freightamount', '운임', 100],
  ['otheramount', '기타비용', 110], ['vatamount', '부가세', 110], ['totalamount', '합계', 140],
];
const resolveKind = (key) => key === 'customer' ? 'customer' : key === 'itemname' ? 'item' : key === 'warehousecodename' ? 'warehouse' : columns.find((column) => column.key === key)?.master;
const amountOf = (line, unitNames) => {
  const weight = Number(line.weight); const price = Number(line.unitprice);
  if (!Number.isFinite(weight) || !Number.isFinite(price) || line.weight === '' || line.unitprice === '') return 0;
  const name = unitNames[line.unit] || line.unit;
  return Math.round((/TON|톤/i.test(name) ? weight / 1000 : weight) * price * 100) / 100;
};

export default function PurchasePage() {
  const [filters, setFilters] = useState({ date_from: '', date_to: '', customname: '', purchaseno: '' });
  const [query, setQuery] = useState({});
  const [orders, setOrders] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState('50');
  const [form, setForm] = useState(blank);
  const [selectedRows, setSelectedRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState(null);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerItems, setPickerItems] = useState([]);
  const [pickerPage, setPickerPage] = useState(1);
  const [pickerTotal, setPickerTotal] = useState(0);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteRowsOpen, setDeleteRowsOpen] = useState(false);
  const [unitNames, setUnitNames] = useState({});
  const requestRef = useRef(0);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try { const { data } = await api.get('/orders', { params: { ...query, page, page_size: Number(pageSize) } }); setOrders(data.items || []); setTotal(data.total || 0); }
    catch (error) { notifications.show({ color: 'red', message: errorText(error) }); }
    finally { setLoading(false); }
  }, [query, page, pageSize]);
  useEffect(() => { void loadOrders(); }, [loadOrders]);
  useEffect(() => { let active = true; axios.get('/api/code-master/groups/PRICE_UNIT/items', { ...auth(), params: { page: 1, page_size: 200 } }).then(({ data }) => { if (active) setUnitNames(Object.fromEntries((data.items || []).map((item) => [item.code, item.name]))); }).catch(() => {}); return () => { active = false; }; }, []);

  const openOrder = async (purchaseno) => {
    try { const { data } = await api.get(`/orders/${encodeURIComponent(purchaseno)}`); setForm({ ...data.header, purchasedate: dateText(data.header.purchasedate), paymentduedate: dateText(data.header.paymentduedate), lines: data.lines.map((line) => ({ ...line, id: rowId() })) }); setSelectedRows([]); }
    catch (error) { notifications.show({ color: 'red', message: errorText(error) }); }
  };
  const openNew = () => { setForm(blank()); setSelectedRows([]); };
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const updateLine = (id, key, value) => setForm((current) => ({ ...current, lines: current.lines.map((line) => line.id === id ? { ...line, [key]: value } : line) }));
  const addLine = () => setForm((current) => ({ ...current, lines: [...current.lines, emptyLine()] }));
  const normalizeCell = async (id, key, value) => {
    const kind = resolveKind(key);
    if (!kind || !String(value || '').trim()) return;
    try {
      const { data } = await api.get(`/resolve/${kind}`, { params: { value } });
      setForm((current) => ({ ...current, ...(kind === 'customer' ? { customcode: data.code, customname: data.name } : {}),
        lines: current.lines.map((line) => line.id !== id ? line : kind === 'item' ? { ...line, itemcode: data.code, itemname: data.name } : kind === 'warehouse' ? { ...line, warehousecode: data.code, warehousecodename: data.name } : { ...line, [key]: data.code }) }));
    } catch (error) { notifications.show({ color: 'red', message: `${value}: ${errorText(error)}` }); }
  };
  const loadPicker = useCallback(async (target, search, nextPage) => {
    const request = ++requestRef.current;
    try {
      let data;
      if (target.kind === 'customer') ({ data } = await axios.get('/api/list', { ...auth(), params: { search_keyword: search, status: 'Y', page: nextPage, page_size: 20, include_total: true } }));
      else if (target.kind === 'item') ({ data } = await axios.get('/api/item-master/items/picker', { ...auth(), params: { q: search, page: nextPage, page_size: 20 } }));
      else {
        const group = { qtyunit: 'QTY', unit: 'PRICE_UNIT', warehouse: 'WAREHOUSE' }[target.kind];
        ({ data } = await axios.get(`/api/code-master/groups/${group}/items`, { ...auth(), params: { page: nextPage, page_size: 200, include_total: true } }));
      }
      if (request !== requestRef.current) return;
      const raw = target.kind === 'customer' ? data.data : data.items;
      const mapped = (raw || []).filter((item) => ['customer', 'item'].includes(target.kind) || item.use).map((item) => target.kind === 'customer' ? { code: item.customercode, name: item.customername } : target.kind === 'item' ? { code: item.itemcode, name: item.itemname } : { code: item.code, name: item.name });
      setPickerItems(mapped.filter((item) => !search || target.kind === 'customer' || target.kind === 'item' || `${item.code} ${item.name}`.toLowerCase().includes(search.toLowerCase())));
      setPickerTotal(data.total || mapped.length); setPickerPage(nextPage);
    } catch (error) { notifications.show({ color: 'red', message: errorText(error) }); }
  }, []);
  const openPicker = (kind, id = null) => { const target = { kind, id }; setPicker(target); setPickerSearch(''); setPickerItems([]); setPickerPage(1); void loadPicker(target, '', 1); };
  const selectPickerItem = (item) => {
    if (picker.kind === 'customer') setForm((current) => ({ ...current, customcode: item.code, customname: item.name }));
    else setForm((current) => ({ ...current, lines: current.lines.map((line) => line.id !== picker.id ? line : picker.kind === 'item' ? { ...line, itemcode: item.code, itemname: item.name } : picker.kind === 'warehouse' ? { ...line, warehousecode: item.code, warehousecodename: item.name } : { ...line, [picker.kind]: item.code }) }));
    setPicker(null);
  };
  const pasteRange = async (event, startRow, startColumn) => {
    const text = event.clipboardData.getData('text/plain');
    if (!text.includes('\t') && !text.includes('\n')) return;
    event.preventDefault();
    const matrix = text.replace(/\r/g, '').trimEnd().split('\n').map((line) => line.split('\t'));
    const draft = [...form.lines];
    while (draft.length < startRow + matrix.length) draft.push(emptyLine());
    for (let r = 0; r < matrix.length; r += 1) {
      const next = { ...draft[startRow + r] };
      matrix[r].forEach((value, offset) => {
        const column = columns[startColumn + offset];
        if (column && !['supplyamount', 'itemname', 'warehousecodename'].includes(column.key)) next[column.key] = value.trim();
      });
      draft[startRow + r] = next;
    }
    const kinds = { item: 'itemcode', qtyunit: 'qtyunit', unit: 'unit', warehouse: 'warehousecode' };
    try {
      const resolved = {};
      for (const [kind, key] of Object.entries(kinds)) {
        const values = [...new Set(draft.slice(startRow, startRow + matrix.length).map((row) => row[key]).filter(Boolean))];
        if (values.length) resolved[kind] = (await api.post('/resolve-bulk', { kind, values })).data.items;
      }
      for (let r = startRow; r < startRow + matrix.length; r += 1) {
        const line = draft[r];
        for (const [kind, key] of Object.entries(kinds)) {
          const value = line[key];
          if (!value) continue;
          const match = resolved[kind]?.[value];
          if (!match) { notifications.show({ color: 'red', message: `${r + 1}행 ${key}: 마스터와 일치하지 않습니다 (${value})` }); continue; }
          line[key] = match.code;
          if (kind === 'item') line.itemname = match.name;
          if (kind === 'warehouse') line.warehousecodename = match.name;
        }
      }
    } catch (error) { notifications.show({ color: 'red', message: errorText(error) }); }
    setForm((current) => ({ ...current, lines: draft }));
  };
  const chooseReceipt = async (receiptno) => {
    try {
      const { data } = await api.get(`/inbound-candidates/${encodeURIComponent(receiptno)}`);
      setForm({ ...blank(), receiptno, customcode: data.header.customcode, customname: data.header.customname,
        lines: data.lines.map((line) => ({ ...emptyLine(), ...line, id: rowId(), unitprice: line.unitprice || '' })) });
      setPicker(null);
    } catch (error) { notifications.show({ color: 'red', message: errorText(error) }); }
  };
  const goods = form.lines.reduce((sum, line) => sum + amountOf(line, unitNames), 0);
  const supply = goods + Number(form.freightamount || 0) + Number(form.otheramount || 0);
  const save = async () => {
    if (!form.customcode || !form.lines.length) { notifications.show({ color: 'red', message: '매입처와 상세 품목을 입력하세요.' }); return; }
    setSaving(true);
    try {
      const payload = { purchaseno: form.purchaseno || '', receiptno: form.receiptno || null, purchasedate: form.purchasedate,
        customcode: form.customcode, paymentterms: form.paymentterms || '', paymentduedate: form.paymentduedate || null,
        vattype: form.vattype, freightamount: Number(form.freightamount || 0), otheramount: Number(form.otheramount || 0),
        vatamount: Number(form.vatamount || 0), description: form.description || '',
        lines: form.lines.map((line) => ({ inboundlineno: line.inboundlineno || null, itemcode: line.itemcode,
          size: line.size || '', steelgrade: line.steelgrade || '', thickness: line.thickness === '' ? null : line.thickness,
          width: line.width === '' ? null : line.width, length: line.length === '' ? null : line.length,
          qty: line.qty, qtyunit: line.qtyunit, weight: line.weight, unit: line.unit,
          unitprice: line.unitprice, warehousecode: line.warehousecode || '', description: line.description || '' })) };
      const { data } = await api.put('/orders', payload);
      notifications.show({ color: 'green', message: `${data.purchaseno} 매입 전표 ${data.saved_count}행을 저장했습니다.` });
      await loadOrders(); await openOrder(data.purchaseno);
    } catch (error) { notifications.show({ color: 'red', message: errorText(error) }); }
    finally { setSaving(false); }
  };
  const removeDocument = async () => {
    try { await api.delete(`/orders/${encodeURIComponent(form.purchaseno)}`); setDeleteOpen(false); openNew(); await loadOrders(); notifications.show({ color: 'green', message: '매입 전표를 삭제했습니다.' }); }
    catch (error) { notifications.show({ color: 'red', message: errorText(error) }); }
  };
  const removeSelected = () => {
    if (form.lines.length <= selectedRows.length) { notifications.show({ color: 'red', message: '마지막 상세 행은 삭제할 수 없습니다. 전표 삭제를 사용하세요.' }); setDeleteRowsOpen(false); return; }
    setForm((current) => ({ ...current, lines: current.lines.filter((line) => !selectedRows.includes(line.id)) }));
    setSelectedRows([]); setDeleteRowsOpen(false);
    notifications.show({ color: 'blue', message: '선택 행을 화면에서 제거했습니다. 저장하면 전표에 반영됩니다.' });
  };
  return <div className={`${sharedClasses.pageShell} ${classes.page}`}>
    <Paper className={dashboardClasses.dashboardHeader}><div className={dashboardClasses.headerCopy}>
      <Text className={sharedClasses.breadcrumb}>매입 관리 › 매입등록</Text>
      <Title order={1} className={dashboardClasses.pageTitle}>매입 등록 <span>관리</span></Title>
      <Text className={dashboardClasses.pageSubtitle}>회사별 매입 전표와 품목 상세를 등록합니다. 입고 연결은 선택 사항이며 매입 저장은 재고를 변경하지 않습니다.</Text>
      <Group className={dashboardClasses.sampleNotice} gap={8}><span className={dashboardClasses.statusDot} /><Text size="xs">System Active</Text></Group>
    </div></Paper>
    <Paper className={classes.panel} withBorder>
      <Group justify="space-between" mb="sm"><Title order={5}>매입 전표 조회</Title><Badge color="gray" variant="light">{number(total)}건</Badge></Group>
      <form className={classes.filters} onSubmit={(event) => { event.preventDefault(); setPage(1); setQuery({ ...filters }); }}>
        <TextInput type="date" label="매입 시작일" value={filters.date_from} onChange={(event) => setFilters({ ...filters, date_from: event.target.value })} />
        <TextInput type="date" label="매입 종료일" value={filters.date_to} onChange={(event) => setFilters({ ...filters, date_to: event.target.value })} />
        <TextInput label="매입처" value={filters.customname} onChange={(event) => setFilters({ ...filters, customname: event.target.value })} />
        <TextInput label="매입전표번호" value={filters.purchaseno} onChange={(event) => setFilters({ ...filters, purchaseno: event.target.value })} />
        <Button type="submit" color="red" loading={loading}>조회</Button>
      </form>
    </Paper>
    <Paper className={classes.panel} withBorder>
      <Group justify="space-between" mb="sm"><Title order={5}>매입 전표 목록</Title><Group gap="xs"><Button variant="light" color="red" onClick={openNew}>신규 전표</Button><Button color="red" variant="light" onClick={() => { setPicker({ kind: 'receipt' }); setPickerSearch(''); setPickerItems([]); void api.get('/inbound-candidates').then(({ data }) => setPickerItems(data.items || [])); }}>입고 전표 가져오기</Button></Group></Group>
      <div className={classes.listGrid}><Table striped highlightOnHover withTableBorder withColumnBorders style={{ minWidth: 1600 }}><Table.Thead><Table.Tr>{listColumns.map(([key, label, width]) => <Table.Th key={key} style={{ minWidth: width }}>{label}</Table.Th>)}</Table.Tr></Table.Thead><Table.Tbody>
        {orders.map((row) => <Table.Tr key={row.purchaseno} className={form.purchaseno === row.purchaseno ? classes.selected : ''} onClick={() => openOrder(row.purchaseno)}>{listColumns.map(([key]) => <Table.Td key={key}>{key.includes('date') ? dateText(row[key]) : ['goodsamount','freightamount','otheramount','vatamount','totalamount'].includes(key) ? number(row[key]) : row[key] ?? ''}</Table.Td>)}</Table.Tr>)}
        {!orders.length && <Table.Tr><Table.Td colSpan={listColumns.length} className={classes.empty}>조회된 매입 전표가 없습니다.</Table.Td></Table.Tr>}
      </Table.Tbody></Table></div>
      <Group justify="space-between" mt="sm"><Select w={110} value={pageSize} data={['15','50','100','200'].map((value) => ({ value, label: `${value}개씩` }))} onChange={(value) => { setPageSize(value || '50'); setPage(1); }} /><Pagination total={Math.max(1, Math.ceil(total / Number(pageSize)))} value={page} onChange={setPage} size="sm" color="red" /></Group>
    </Paper>
    <Paper className={classes.panel} withBorder>
      <Group justify="space-between" mb="sm"><Group gap="xs"><Title order={5}>매입 상세</Title><Badge color="gray" variant="light">{form.purchaseno || '신규 전표'}</Badge></Group><Group gap="xs"><Button color="red" variant="subtle" leftSection={<IconTrash size={15} />} disabled={!form.purchaseno} onClick={() => setDeleteOpen(true)}>전표 삭제</Button><Button color="red" leftSection={<IconDeviceFloppy size={15} />} loading={saving} onClick={save}>저장</Button></Group></Group>
      <div className={classes.editor}>
        <TextInput type="date" label="매입일자" required value={dateText(form.purchasedate)} onChange={(event) => update('purchasedate', event.target.value)} />
        <TextInput label="매입처코드" required value={form.customcode || ''} onChange={(event) => update('customcode', event.target.value)} onBlur={(event) => { if (event.target.value) void normalizeCell(null, 'customer', event.target.value); }} onDoubleClick={() => openPicker('customer')} rightSection={<ActionIcon color="red" variant="subtle" onClick={() => openPicker('customer')}><IconSearch size={16} /></ActionIcon>} rightSectionPointerEvents="all" />
        <TextInput label="매입처명" value={form.customname || ''} readOnly />
        <TextInput label="연결 입고번호" value={form.receiptno || ''} readOnly placeholder="선택 사항" />
        <TextInput label="결제조건" value={form.paymentterms || ''} onChange={(event) => update('paymentterms', event.target.value)} />
        <TextInput type="date" label="결제예정일" value={dateText(form.paymentduedate)} onChange={(event) => update('paymentduedate', event.target.value)} />
        <Select label="부가세 구분" value={form.vattype} data={[{ value: 'TAXABLE', label: '과세' },{ value: 'ZERO', label: '영세' },{ value: 'EXEMPT', label: '면세' }]} onChange={(value) => setForm((current) => ({ ...current, vattype: value, vatamount: value === 'TAXABLE' ? current.vatamount : 0 }))} />
        <NumberInput label="운임" min={0} thousandSeparator="," value={Number(form.freightamount || 0)} onChange={(value) => update('freightamount', value)} />
        <NumberInput label="기타비용" min={0} thousandSeparator="," value={Number(form.otheramount || 0)} onChange={(value) => update('otheramount', value)} />
        <NumberInput label="부가세" min={0} thousandSeparator="," value={Number(form.vatamount || 0)} disabled={form.vattype !== 'TAXABLE'} onChange={(value) => update('vatamount', value)} />
        <TextInput label="비고" value={form.description || ''} onChange={(event) => update('description', event.target.value)} />
      </div>
      <Group justify="space-between" className={classes.detailToolbar}><Group gap="xs"><Text fw={700} size="sm">품목 상세</Text><Badge color="gray" variant="light">{form.lines.length}행</Badge></Group><Group gap="xs"><Button size="xs" color="red" variant="subtle" leftSection={<IconTrash size={14} />} disabled={!selectedRows.length} onClick={() => setDeleteRowsOpen(true)}>선택 삭제</Button><Button size="xs" color="red" leftSection={<IconPlus size={14} />} onClick={addLine}>행 추가</Button></Group></Group>
      <div className={classes.detailGrid}><Table withTableBorder withColumnBorders striped style={{ minWidth: 2100 }}><Table.Thead><Table.Tr><Table.Th className={classes.checkCol}><input type="checkbox" aria-label="상세 전체 선택" checked={form.lines.length > 0 && selectedRows.length === form.lines.length} onChange={(event) => setSelectedRows(event.target.checked ? form.lines.map((line) => line.id) : [])} /></Table.Th><Table.Th className={classes.numberCol}>No.</Table.Th>{columns.map((column) => <Table.Th key={column.key} style={{ minWidth: column.width }}>{column.title}{column.required && ' *'}</Table.Th>)}<Table.Th className={classes.numberCol}>관리</Table.Th></Table.Tr></Table.Thead><Table.Tbody>
        {form.lines.map((line, index) => <Table.Tr key={line.id}><Table.Td><input type="checkbox" checked={selectedRows.includes(line.id)} onChange={(event) => setSelectedRows((current) => event.target.checked ? [...current, line.id] : current.filter((id) => id !== line.id))} /></Table.Td><Table.Td>{index + 1}</Table.Td>{columns.map((column, columnIndex) => <Table.Td key={column.key}>{column.key === 'supplyamount' ? <span className={classes.amount}>{number(amountOf(line, unitNames))}</span> : <input className={`${classes.cellInput} ${column.master ? classes.masterCell : ''} ${column.readonly ? classes.readonlyCell : ''}`} aria-label={`${index + 1}행 ${column.title}`} value={line[column.key] ?? ''} readOnly={column.readonly} inputMode={column.numeric ? 'decimal' : undefined} onChange={(event) => updateLine(line.id, column.key, event.target.value)} onBlur={(event) => { if (column.master && event.target.value) void normalizeCell(line.id, column.key, event.target.value); }} onDoubleClick={column.master ? () => openPicker(column.master, line.id) : undefined} onPaste={(event) => void pasteRange(event, index, columnIndex)} />}</Table.Td>)}<Table.Td><ActionIcon variant="subtle" color="red" aria-label={`${index + 1}행 삭제`} onClick={() => { setSelectedRows([line.id]); setDeleteRowsOpen(true); }}><IconTrash size={15} /></ActionIcon></Table.Td></Table.Tr>)}
        {!form.lines.length && <Table.Tr><Table.Td colSpan={columns.length + 3} className={classes.empty}>행 추가를 누르거나 입고 전표를 가져오세요. 엑셀 범위를 셀에 붙여넣을 수 있습니다.</Table.Td></Table.Tr>}
      </Table.Tbody></Table></div>
      <Group className={classes.totals} justify="flex-end" gap="lg"><Text size="sm">품목 공급가 <b>{number(goods)}</b></Text><Text size="sm">공급가 합계 <b>{number(supply)}</b></Text><Text size="sm">부가세 <b>{number(form.vatamount)}</b></Text><Text size="sm">총 합계 <b>{number(supply + Number(form.vatamount || 0))}</b></Text></Group>
    </Paper>
    <Modal opened={Boolean(picker)} onClose={() => setPicker(null)} title={`${{ customer: '거래처', item: '품목', qtyunit: '수량단위', unit: '단가기준', warehouse: '창고', receipt: '입고 전표' }[picker?.kind] || ''} 선택`} centered size="lg">
      <Group mb="sm"><TextInput flex={1} autoFocus placeholder="코드 또는 코드명 검색" value={pickerSearch} onChange={(event) => setPickerSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && picker) { if (picker.kind === 'receipt') void api.get('/inbound-candidates', { params: { q: pickerSearch } }).then(({ data }) => setPickerItems(data.items || [])); else void loadPicker(picker, pickerSearch, 1); } }} /><Button color="red" onClick={() => { if (picker.kind === 'receipt') void api.get('/inbound-candidates', { params: { q: pickerSearch } }).then(({ data }) => setPickerItems(data.items || [])); else void loadPicker(picker, pickerSearch, 1); }}>조회</Button></Group>
      <div className={classes.pickerGrid}><Table striped highlightOnHover withTableBorder><Table.Thead><Table.Tr><Table.Th>코드 / 전표번호</Table.Th><Table.Th>코드명 / 거래처명</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{pickerItems.map((item) => <Table.Tr key={item.code || item.receiptno} onClick={() => picker.kind === 'receipt' ? chooseReceipt(item.receiptno) : selectPickerItem(item)}><Table.Td>{item.code || item.receiptno}</Table.Td><Table.Td>{item.name || item.customname}</Table.Td></Table.Tr>)}</Table.Tbody></Table></div>
      {picker?.kind !== 'receipt' && <Pagination mt="sm" size="sm" color="red" total={Math.max(1, Math.ceil(pickerTotal / (['customer','item'].includes(picker?.kind) ? 20 : 200)))} value={pickerPage} onChange={(next) => void loadPicker(picker, pickerSearch, next)} />}
    </Modal>
    <Modal opened={deleteOpen} onClose={() => setDeleteOpen(false)} title="매입 전표 삭제" centered><Text size="sm">{form.purchaseno} 전표의 헤더와 상세 전체를 삭제합니다.</Text><Group justify="flex-end" mt="lg"><Button variant="default" onClick={() => setDeleteOpen(false)}>취소</Button><Button color="red" onClick={removeDocument}>삭제</Button></Group></Modal>
    <Modal opened={deleteRowsOpen} onClose={() => setDeleteRowsOpen(false)} title="상세 행 삭제" centered><Text size="sm">선택한 {selectedRows.length}행을 삭제합니다. 저장하면 전표 합계도 다시 계산됩니다.</Text><Group justify="flex-end" mt="lg"><Button variant="default" onClick={() => setDeleteRowsOpen(false)}>취소</Button><Button color="red" onClick={removeSelected}>삭제</Button></Group></Modal>
  </div>;
}
