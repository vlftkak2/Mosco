import { useCallback, useContext, useEffect, useState } from 'react';
import axios from 'axios';
import {
  ActionIcon, Badge, Box, Button, Checkbox, Group, Loader, Modal, Pagination,
  Paper, Select, Stack, Table, Text, TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconPlus, IconSearch, IconTrash, IconX } from '@tabler/icons-react';
import ErpBreadcrumb from '../components/common/ErpBreadcrumb';
import ErpRibbon from '../components/common/ErpRibbon';
import { PageRibbonContext } from '../components/layout/MainLayout';
import sharedClasses from '../styles/pages/ManagementShared.module.css';
import classes from '../styles/pages/ItemProcessRegister.module.css';


const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const num = (value) => Number(String(value ?? '').replace(/,/g, '')) || 0;
const numberText = (value) => num(value).toLocaleString(undefined, { maximumFractionDigits: 3 });
const sourceKey = (row) => `${row.sourcetype}\u001f${row.sourceno}\u001f${row.sourceline}`;
const emptyHeader = () => ({ processdate: today(), customcode: '', customname: '', warehousecode: '', warehousecodename: '', manager: localStorage.getItem('user_name') || '', description: '' });


function StockPicker({ opened, onClose, onApply, existingKeys }) {
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState({});
  const [drafts, setDrafts] = useState({});
  const [query, setQuery] = useState('');
  const [warehouse, setWarehouse] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const pageSize = 30;

  const load = useCallback(async (nextPage = 1) => {
    setLoading(true);
    try {
      const { data } = await axios.get('/api/item-process-register/available-stock', {
        ...authConfig(), params: { page: nextPage, page_size: pageSize, q: query.trim() || undefined, warehouse: warehouse.trim() || undefined },
      });
      setItems(data.items || []); setTotal(data.total || 0); setPage(nextPage);
    } catch (error) {
      notifications.show({ title: '현재고 조회 실패', message: error.response?.data?.detail || '현재고를 조회하지 못했습니다.', color: 'red' });
    } finally { setLoading(false); }
  }, [query, warehouse]);

  useEffect(() => {
    if (!opened) return;
    setSelected({}); setDrafts({}); setQuery(''); setWarehouse('');
    void (async () => {
      setLoading(true);
      try {
        const { data } = await axios.get('/api/item-process-register/available-stock', { ...authConfig(), params: { page: 1, page_size: pageSize } });
        setItems(data.items || []); setTotal(data.total || 0); setPage(1);
      } catch (error) {
        notifications.show({ title: '현재고 조회 실패', message: error.response?.data?.detail || '현재고를 조회하지 못했습니다.', color: 'red' });
      } finally { setLoading(false); }
    })();
  }, [opened]);

  const draft = (row) => drafts[sourceKey(row)] || { qty: String(row.qty || ''), weight: String(row.weight || '') };
  const toggle = (row, checked) => {
    const key = sourceKey(row);
    setSelected((current) => ({ ...current, [key]: checked }));
    if (checked && !drafts[key]) setDrafts((current) => ({ ...current, [key]: { qty: String(row.qty || ''), weight: String(row.weight || '') } }));
  };
  const apply = () => {
    const chosen = items.filter((row) => selected[sourceKey(row)]);
    const rows = [];
    for (const row of chosen) {
      const values = draft(row);
      if (num(values.qty) <= 0 || num(values.weight) <= 0 || num(values.qty) > num(row.qty) || num(values.weight) > num(row.weight)) {
        notifications.show({ title: '투입량 확인', message: `${row.itemname}: 투입 수량 또는 중량이 현재고를 초과합니다.`, color: 'orange' });
        return;
      }
      rows.push({ ...row, input_qty: values.qty, input_weight: values.weight });
    }
    if (!rows.length) return;
    onApply(rows); onClose();
  };

  return <Modal opened={opened} onClose={onClose} title={<Text fw={600}>가공 원소재 선택</Text>} size="95%" centered classNames={{ content: classes.modalContent }}>
    <Stack gap="sm" pt={6}>
      <Group align="end" gap="xs"><TextInput label="품목" placeholder="품목코드·품명·제품번호" value={query} onChange={(e) => setQuery(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && load(1)} />
        <TextInput label="창고" placeholder="창고코드 또는 창고명" value={warehouse} onChange={(e) => setWarehouse(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && load(1)} />
        <Button color="red" leftSection={<IconSearch size={15} />} onClick={() => load(1)}>조회</Button></Group>
      <Box className={classes.pickerViewport}>{loading && <Loader className={classes.loader} color="red" size="sm" />}
        <Table stickyHeader withTableBorder withColumnBorders className={classes.pickerTable}><Table.Thead><Table.Tr>
          <Table.Th /><Table.Th>구분</Table.Th><Table.Th>입고일자</Table.Th><Table.Th>품명</Table.Th><Table.Th>제품명</Table.Th><Table.Th>강종</Table.Th><Table.Th>두께</Table.Th><Table.Th>폭</Table.Th><Table.Th>길이</Table.Th><Table.Th>창고</Table.Th><Table.Th>현재수량</Table.Th><Table.Th>현재중량</Table.Th><Table.Th>투입수량</Table.Th><Table.Th>투입중량</Table.Th>
        </Table.Tr></Table.Thead><Table.Tbody>{items.map((row) => {
          const key = sourceKey(row); const disabled = existingKeys.has(key); const values = draft(row);
          return <Table.Tr key={key}><Table.Td><Checkbox checked={Boolean(selected[key])} disabled={disabled} onChange={(e) => toggle(row, e.currentTarget.checked)} /></Table.Td>
            <Table.Td>{row.sourcetype === 'OPENING' ? '기초' : row.sourcetype === 'INBOUND' ? '입고' : '가공'}</Table.Td><Table.Td>{String(row.receiptdate || '').slice(0, 10)}</Table.Td><Table.Td>{row.itemname}</Table.Td><Table.Td>{row.productname}</Table.Td><Table.Td>{row.materialname || row.myrtle}</Table.Td><Table.Td>{numberText(row.thickness)}</Table.Td><Table.Td>{numberText(row.width)}</Table.Td><Table.Td>{numberText(row.length)}</Table.Td><Table.Td>{row.warehousecodename}</Table.Td><Table.Td ta="right">{numberText(row.qty)}</Table.Td><Table.Td ta="right">{numberText(row.weight)}</Table.Td>
            <Table.Td><input className={classes.numberInput} value={values.qty} disabled={disabled} onChange={(e) => setDrafts((c) => ({ ...c, [key]: { ...values, qty: e.target.value } }))} /></Table.Td>
            <Table.Td><input className={classes.numberInput} value={values.weight} disabled={disabled} onChange={(e) => setDrafts((c) => ({ ...c, [key]: { ...values, weight: e.target.value } }))} /></Table.Td></Table.Tr>;
        })}{!items.length && <Table.Tr><Table.Td colSpan={14} className={classes.empty}>가공 가능한 현재고가 없습니다.</Table.Td></Table.Tr>}</Table.Tbody></Table>
      </Box>
      <Group justify="space-between"><Text size="xs" c="dimmed">총 {total.toLocaleString()}건</Text><Group><Pagination size="sm" color="red" total={Math.max(1, Math.ceil(total / pageSize))} value={page} onChange={load} /><Button variant="default" onClick={onClose}>취소</Button><Button color="red" onClick={apply}>선택 반영</Button></Group></Group>
    </Stack>
  </Modal>;
}


export default function ItemProcessRegister() {
  const pageLayout = useContext(PageRibbonContext);
  const [filterOpen, setFilterOpen] = useState(true);
  const [header, setHeader] = useState(emptyHeader);
  const [sources, setSources] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [options, setOptions] = useState({ customers: [], warehouses: [], rules: [] });
  const [stockOpen, setStockOpen] = useState(false);
  const [selectedProcessno, setSelectedProcessno] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filters, setFilters] = useState({ q: '', date_from: `${today().slice(0, 8)}01`, date_to: today() });

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get('/api/item-process-register/documents', { ...authConfig(), params: Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) });
      setDocuments(data.items || []);
    } catch (error) { notifications.show({ title: '가공 조회 실패', message: error.response?.data?.detail || '가공전표를 조회하지 못했습니다.', color: 'red' }); }
    finally { setLoading(false); }
  }, [filters]);

  useEffect(() => {
    void loadDocuments();
    axios.get('/api/item-process-register/options', authConfig()).then(({ data }) => setOptions(data)).catch(() => notifications.show({ title: '기준정보 조회 실패', message: '가공처·창고·가공공정을 조회하지 못했습니다.', color: 'red' }));
  }, []);

  const reset = useCallback(() => { setHeader(emptyHeader()); setSources([]); setSelectedProcessno(''); }, []);
  const openDocument = useCallback(async (processno) => {
    setLoading(true);
    try {
      const { data } = await axios.get(`/api/item-process-register/documents/${encodeURIComponent(processno)}`, authConfig());
      setSelectedProcessno(processno);
      setHeader({
        processdate: String(data.header.processdate || '').slice(0, 10), customcode: data.header.customcode || '',
        customname: data.header.customname || '', warehousecode: data.header.warehousecode || '',
        warehousecodename: data.header.warehousecodename || '', manager: data.header.manager || '', description: data.header.description || '',
      });
      setSources((data.sources || []).map(({ source, products }) => ({
        id: `source-${source.lineno}`,
        stock: {
          sourcetype: source.stocksourcetype, sourceno: source.stocksourceno, sourceline: source.stocksourceline,
          itemcode: source.itemcode, itemname: source.itemname, productname: source.productname,
          materialcode: source.materialcode, materialname: source.materialname, surfacecode: source.surfacecode,
          surfacename: source.surfacename, myrtle: source.myrtle, thickness: source.thickness, width: source.width,
          length: source.length, qtyunit: source.qtyunit, warehousecode: source.sourcewarehousecode,
          warehousecodename: source.sourcewarehousecodename,
        },
        qty: String(source.qty), weight: String(source.weight),
        products: products.map((product) => ({
          id: `saved-${product.lineno}`,
          parentId: product.parentlineno === source.lineno ? null : `saved-${product.parentlineno}`,
          processid: product.processid || '', processcodename: product.processcodename || '',
          productname: product.productname || '', thickness: product.thickness ?? '', width: product.width ?? '',
          length: product.length ?? '', qty: String(product.qty), qtyunit: product.qtyunit || '',
          weight: String(product.weight), unit: product.unit || 'KG', unitprice: String(product.unitprice || 0),
          description: product.description || '',
        })),
      })));
    } catch (error) {
      notifications.show({ title: '가공 상세 조회 실패', message: error.response?.data?.detail || '가공 상세를 조회하지 못했습니다.', color: 'red' });
    } finally { setLoading(false); }
  }, []);
  const addStocks = (rows) => setSources((current) => [...current, ...rows.map((row) => ({ id: uid(), stock: row, qty: String(row.input_qty), weight: String(row.input_weight), products: [] }))]);
  const addProduct = (sourceId, parentId = null) => setSources((current) => current.map((source) => source.id === sourceId ? {
    ...source, products: [...source.products, { id: uid(), parentId, processid: '', processcodename: '', productname: '', thickness: source.stock.thickness ?? '', width: source.stock.width ?? '', length: source.stock.length ?? '', qty: '1', qtyunit: source.stock.qtyunit || 'EA', weight: '', unit: 'KG', unitprice: '0', description: '' }],
  } : source));
  const updateProduct = (sourceId, productId, field, value) => setSources((current) => current.map((source) => source.id === sourceId ? { ...source, products: source.products.map((product) => product.id === productId ? { ...product, [field]: value } : product) } : source));
  const removeProduct = (sourceId, productId) => setSources((current) => current.map((source) => {
    if (source.id !== sourceId) return source;
    const removed = new Set([productId]);
    let changed = true;
    while (changed) {
      changed = false;
      source.products.forEach((product) => {
        if (product.parentId && removed.has(product.parentId) && !removed.has(product.id)) { removed.add(product.id); changed = true; }
      });
    }
    return { ...source, products: source.products.filter((product) => !removed.has(product.id)) };
  }));
  const chooseRule = (source, product, processid) => {
    const rule = options.rules.find((item) => item.itemcode === source.stock.itemcode && item.processid === processid);
    setSources((current) => current.map((item) => item.id === source.id ? {
      ...item,
      products: item.products.map((row) => row.id === product.id ? {
        ...row, processid: processid || '', processcodename: rule?.processname || '',
        productname: rule?.productname || row.productname,
      } : row),
    } : item));
  };

  const totalSourceWeight = sources.reduce((sum, row) => sum + num(row.weight), 0);
  const totalLeafWeight = sources.reduce((sum, source) => {
    const parentIds = new Set(source.products.map((p) => p.parentId).filter(Boolean));
    return sum + source.products.filter((p) => !parentIds.has(p.id)).reduce((s, p) => s + num(p.weight), 0);
  }, 0);

  const save = useCallback(async () => {
    if (selectedProcessno) return;
    if (!header.customcode || !header.warehousecode || !sources.length) {
      notifications.show({ title: '입력 확인', message: '가공일자·가공처·창고와 현재고 원소재를 확인해 주세요.', color: 'orange' }); return;
    }
    if (sources.some((source) => !source.products.length || source.products.some((p) => !p.processid || !p.productname || num(p.qty) <= 0 || num(p.weight) <= 0))) {
      notifications.show({ title: '가공 상세 확인', message: '각 원소재의 가공공정·가공품명·수량·중량을 입력해 주세요.', color: 'orange' }); return;
    }
    setSaving(true);
    try {
      const payload = { ...header, sources: sources.map((source) => ({ stocksourcetype: source.stock.sourcetype, stocksourceno: source.stock.sourceno, stocksourceline: source.stock.sourceline, qty: num(source.qty), weight: num(source.weight), products: source.products.map((p) => ({ clientid: p.id, parent_clientid: p.parentId, processid: p.processid, processcodename: p.processcodename, productname: p.productname, thickness: p.thickness === '' ? null : num(p.thickness), width: p.width === '' ? null : num(p.width), length: p.length === '' ? null : num(p.length), qty: num(p.qty), qtyunit: p.qtyunit, weight: num(p.weight), unit: p.unit, unitprice: num(p.unitprice), description: p.description })) })) };
      const { data } = await axios.post('/api/item-process-register/documents', payload, authConfig());
      notifications.show({ title: '가공 등록 완료', message: `${data.processno} 전표가 현재고와 수불장에 반영되었습니다.`, color: 'teal' });
      reset(); await loadDocuments();
    } catch (error) { notifications.show({ title: '가공 저장 실패', message: error.response?.data?.detail || '가공전표를 저장하지 못했습니다.', color: 'red' }); }
    finally { setSaving(false); }
  }, [header, sources, selectedProcessno, reset, loadDocuments]);

  useEffect(() => {
    if (!pageLayout?.registerPageRibbon) return undefined;
    pageLayout.registerPageRibbon(<ErpRibbon onSearch={loadDocuments} onAdd={reset} onSave={save} onClose={pageLayout.closeActivePage}
      showPrint={false} useSaveColor disabled={{ copy: true, excel: true, delete: true, save: saving || Boolean(selectedProcessno) }} loading={{ search: loading, save: saving }} />);
    return () => pageLayout.registerPageRibbon(null);
  }, [pageLayout, loadDocuments, reset, save, saving, loading, selectedProcessno]);

  const customerData = options.customers.map((x) => ({ value: x.code, label: x.name }));
  const warehouseData = options.warehouses.map((x) => ({ value: x.code, label: x.name }));
  const existingKeys = new Set(sources.map((x) => sourceKey(x.stock)));

  return <Box className={`${sharedClasses.pageShell} ${classes.page}`}>
    <ErpBreadcrumb parent="AI 가공관리" current="재고가공" filterOpen={filterOpen} onOpenFilters={() => setFilterOpen(true)} />
    <Box className={classes.workspace}>
      <Stack gap="sm" className={classes.main}>
        <Paper withBorder className={sharedClasses.panel}>
          <Group className={classes.sectionHeader} justify="space-between"><Group gap={8}><Text className={classes.title}>가공 기본</Text><Badge className={classes.count}>{selectedProcessno || '신규'}</Badge></Group><Button size="xs" variant="light" color="red" disabled={Boolean(selectedProcessno)} onClick={() => setStockOpen(true)}>현재고 조회</Button></Group>
          <Box className={classes.headerGrid}>
            <TextInput label="가공일자" type="date" disabled={Boolean(selectedProcessno)} value={header.processdate} onChange={(e) => setHeader((h) => ({ ...h, processdate: e.currentTarget.value }))} />
            <Select label="가공처" searchable disabled={Boolean(selectedProcessno)} data={customerData} value={header.customcode || null} onChange={(value) => { const item = options.customers.find((x) => x.code === value); setHeader((h) => ({ ...h, customcode: value || '', customname: item?.name || '' })); }} />
            <Select label="입고창고" searchable disabled={Boolean(selectedProcessno)} data={warehouseData} value={header.warehousecode || null} onChange={(value) => { const item = options.warehouses.find((x) => x.code === value); setHeader((h) => ({ ...h, warehousecode: value || '', warehousecodename: item?.name || '' })); }} />
            <TextInput label="담당자" disabled={Boolean(selectedProcessno)} value={header.manager} onChange={(e) => setHeader((h) => ({ ...h, manager: e.currentTarget.value }))} />
            <TextInput label="비고" disabled={Boolean(selectedProcessno)} value={header.description} onChange={(e) => setHeader((h) => ({ ...h, description: e.currentTarget.value }))} />
          </Box>
        </Paper>

        <Paper withBorder className={`${sharedClasses.panel} ${classes.detailPanel}`}>
          <Group className={classes.sectionHeader} justify="space-between"><Group gap={8}><Text className={classes.title}>가공 상세</Text><Badge className={classes.count}>{sources.length}개 원소재</Badge></Group><Text size="xs" c={Math.abs(totalSourceWeight - totalLeafWeight) <= 0.001 ? 'teal' : 'red'}>투입 {numberText(totalSourceWeight)} KG · 최종제품 {numberText(totalLeafWeight)} KG</Text></Group>
          <Box className={classes.detailViewport}>
            <table className={classes.detailTable}><thead><tr><th>No.</th><th>구분</th><th>가공방법</th><th>가공품명</th><th>두께</th><th>폭</th><th>길이</th><th>수량</th><th>단위</th><th>중량(KG)</th><th>단가/KG</th><th>가공금액</th><th /></tr></thead>
              <tbody>{sources.flatMap((source, sourceIndex) => {
                const sourceRow = <tr className={classes.sourceRow} key={source.id}><td>{sourceIndex + 1}</td><td><Badge size="xs" variant="light">원소재</Badge></td><td>재고 연결</td><td>{source.stock.productname || source.stock.itemname}</td><td>{numberText(source.stock.thickness)}</td><td>{numberText(source.stock.width)}</td><td>{numberText(source.stock.length)}</td><td><input disabled={Boolean(selectedProcessno)} value={source.qty} onChange={(e) => setSources((c) => c.map((x) => x.id === source.id ? { ...x, qty: e.target.value } : x))} /></td><td>{source.stock.qtyunit}</td><td><input disabled={Boolean(selectedProcessno)} value={source.weight} onChange={(e) => setSources((c) => c.map((x) => x.id === source.id ? { ...x, weight: e.target.value } : x))} /></td><td>—</td><td>—</td><td><Group gap={2} wrap="nowrap"><ActionIcon size="sm" variant="subtle" color="red" disabled={Boolean(selectedProcessno)} title="가공품 추가" onClick={() => addProduct(source.id)}><IconPlus size={14} /></ActionIcon><ActionIcon size="sm" variant="subtle" color="gray" disabled={Boolean(selectedProcessno)} title="원소재 제거" onClick={() => setSources((c) => c.filter((x) => x.id !== source.id))}><IconTrash size={14} /></ActionIcon></Group></td></tr>;
                const productRows = source.products.map((product, productIndex) => {
                  const ruleData = options.rules.filter((r) => r.itemcode === source.stock.itemcode).map((r) => ({ value: r.processid, label: r.processname }));
                  const depth = (() => { let d = 1; let p = product; while (p?.parentId) { d += 1; p = source.products.find((x) => x.id === p.parentId); } return d; })();
                  return <tr key={product.id}><td className={classes.branch}>{'└'.repeat(depth)} {String(productIndex + 1).padStart(2, '0')}</td><td>가공품</td><td><Select size="xs" disabled={Boolean(selectedProcessno)} data={ruleData} value={product.processid || null} onChange={(value) => chooseRule(source, product, value)} /></td><td><input disabled={Boolean(selectedProcessno)} value={product.productname} onChange={(e) => updateProduct(source.id, product.id, 'productname', e.target.value)} /></td>{['thickness', 'width', 'length', 'qty'].map((field) => <td key={field}><input disabled={Boolean(selectedProcessno)} value={product[field]} onChange={(e) => updateProduct(source.id, product.id, field, e.target.value)} /></td>)}<td><input disabled={Boolean(selectedProcessno)} value={product.qtyunit} onChange={(e) => updateProduct(source.id, product.id, 'qtyunit', e.target.value)} /></td><td><input disabled={Boolean(selectedProcessno)} value={product.weight} onChange={(e) => updateProduct(source.id, product.id, 'weight', e.target.value)} /></td><td><input disabled={Boolean(selectedProcessno)} value={product.unitprice} onChange={(e) => updateProduct(source.id, product.id, 'unitprice', e.target.value)} /></td><td>{numberText(num(product.weight) * num(product.unitprice))}</td><td><Group gap={2} wrap="nowrap"><ActionIcon size="sm" variant="subtle" color="red" disabled={Boolean(selectedProcessno)} title="하위 가공 추가" onClick={() => addProduct(source.id, product.id)}><IconPlus size={14} /></ActionIcon><ActionIcon size="sm" variant="subtle" color="gray" disabled={Boolean(selectedProcessno)} onClick={() => removeProduct(source.id, product.id)}><IconTrash size={14} /></ActionIcon></Group></td></tr>;
                });
                return [sourceRow, ...productRows];
              })}{!sources.length && <tr><td colSpan={13} className={classes.empty}>현재고 조회에서 가공할 원소재를 선택해 주세요.</td></tr>}</tbody>
            </table>
          </Box>
        </Paper>

        <Paper withBorder className={sharedClasses.panel}><Group className={classes.sectionHeader}><Text className={classes.title}>가공 목록</Text></Group><Box className={classes.documentViewport}><Table stickyHeader withColumnBorders><Table.Thead><Table.Tr><Table.Th>상태</Table.Th><Table.Th>가공번호</Table.Th><Table.Th>가공일자</Table.Th><Table.Th>가공처</Table.Th><Table.Th>창고</Table.Th><Table.Th>담당자</Table.Th><Table.Th>원소재</Table.Th><Table.Th>투입중량(KG)</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{documents.map((row) => <Table.Tr key={row.processno} className={row.processno === selectedProcessno ? classes.selectedDocument : classes.documentRow} onClick={() => openDocument(row.processno)}><Table.Td><Badge size="xs" color={row.subulyn === 'Y' ? 'teal' : 'gray'}>{row.subulyn === 'Y' ? '완료' : '작성중'}</Badge></Table.Td><Table.Td>{row.processno}</Table.Td><Table.Td>{String(row.processdate || '').slice(0, 10)}</Table.Td><Table.Td>{row.customname}</Table.Td><Table.Td>{row.warehousecodename}</Table.Td><Table.Td>{row.manager}</Table.Td><Table.Td ta="right">{row.source_count}</Table.Td><Table.Td ta="right">{numberText(row.source_weight)}</Table.Td></Table.Tr>)}{!documents.length && <Table.Tr><Table.Td colSpan={8} className={classes.empty}>{loading ? '조회 중입니다.' : '등록된 가공전표가 없습니다.'}</Table.Td></Table.Tr>}</Table.Tbody></Table></Box></Paper>
      </Stack>
      {filterOpen && <Paper component="aside" withBorder className={classes.filter}><Group className={classes.filterHeader} justify="space-between"><Text>조회조건</Text><ActionIcon variant="subtle" color="gray" onClick={() => setFilterOpen(false)}><IconX size={16} /></ActionIcon></Group><Stack gap="sm" p="sm"><TextInput label="가공기간" type="date" value={filters.date_from} onChange={(e) => setFilters((f) => ({ ...f, date_from: e.currentTarget.value }))} /><TextInput type="date" value={filters.date_to} onChange={(e) => setFilters((f) => ({ ...f, date_to: e.currentTarget.value }))} /><TextInput label="가공번호/가공처" value={filters.q} onChange={(e) => setFilters((f) => ({ ...f, q: e.currentTarget.value }))} onKeyDown={(e) => e.key === 'Enter' && loadDocuments()} /></Stack></Paper>}
    </Box>
    <StockPicker opened={stockOpen} onClose={() => setStockOpen(false)} onApply={addStocks} existingKeys={existingKeys} />
  </Box>;
}
