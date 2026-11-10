import { memo, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import axios from 'axios';
import { useLocation } from 'react-router-dom';
import XLSX from 'xlsx-js-style';
import { ActionIcon, Badge, Box, Button, Checkbox, Group, Loader, Paper, Stack, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCopy, IconDeviceFloppy, IconFileSpreadsheet, IconFilter, IconPlus, IconSearch, IconTrash, IconX } from '@tabler/icons-react';
import ErpDateInput from '../../components/common/ErpDateInput';
import usePageReactivated from '../../components/common/usePageReactivated';
import { ColumnResizeHandle, useResizableColumns } from '../../components/common/PickerModal';
import { MenuAccessContext, PageRibbonContext } from '../../components/layout/MainLayout';
import searchClasses from '../../styles/pages/InboundSearch.module.css';
import classes from '../../styles/pages/CustomerLedger.module.css';
import { applyExcelHeaderStyle } from '../../utils/excelHeaderStyle';

// 거래처원장: 위 = 거래처별 잔액(미수금 / 미지급금), 아래 = 고른 거래처의 원장(이월 → 전표별 잔액 누계).
// 원장 계산 규칙은 backend/services/receiptpayment/CustomerLedger.py 설명 참고.

const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });
const toNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};
const won = (value) => Math.round(toNumber(value)).toLocaleString('ko-KR');
const blankZero = (value) => (Math.round(toNumber(value)) === 0 ? '' : won(value));
const dateText = (value) => (value ? String(value).slice(0, 10) : '');
const localDate = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const makeDefaultFilters = () => {
  const today = new Date();
  return { date_from: localDate(new Date(today.getFullYear(), today.getMonth(), 1)), date_to: localDate(today), keyword: '', balance_only: false };
};
const errorMessage = (error, fallback) => error.response?.data?.detail || fallback;

const BALANCE_COLUMNS = [
  { key: 'customcode', label: '거래처코드', width: 110 },
  { key: 'customname', label: '거래처명', width: 190 },
  { key: 'recv_open', label: '기초', width: 115, group: 'recv' },
  { key: 'sales', label: '매출', width: 115, group: 'recv' },
  { key: 'receipt', label: '수금', width: 115, group: 'recv' },
  { key: 'recv_close', label: '기말 미수금', width: 125, group: 'recv', balance: true },
  { key: 'pay_open', label: '기초', width: 115, group: 'pay' },
  { key: 'purchase', label: '매입', width: 115, group: 'pay' },
  { key: 'payment', label: '지급', width: 115, group: 'pay' },
  { key: 'pay_close', label: '기말 미지급금', width: 125, group: 'pay', balance: true },
];
const LEDGER_COLUMNS = [
  { key: 'entrydate', label: '일자', width: 96 },
  { key: 'kindname', label: '구분', width: 62 },
  { key: 'docno', label: '전표번호', width: 140 },
  { key: 'summary', label: '적요', width: 300 },
  { key: 'sales', label: '매출', width: 110, group: 'recv' },
  { key: 'receipt', label: '수금', width: 110, group: 'recv' },
  { key: 'recv_balance', label: '미수잔액', width: 120, group: 'recv', balance: true },
  { key: 'purchase', label: '매입', width: 110, group: 'pay' },
  { key: 'payment', label: '지급', width: 110, group: 'pay' },
  { key: 'pay_balance', label: '미지급잔액', width: 120, group: 'pay', balance: true },
  { key: 'description', label: '비고', width: 160 },
];
const groupClass = (column) => (column.group === 'recv' ? classes.recvCol : column.group === 'pay' ? classes.payCol : '');
const moneyCell = (column, value) => {
  const negative = toNumber(value) < 0;
  return { className: [classes.num, groupClass(column), column.balance ? classes.balance : '', negative ? classes.negative : ''].filter(Boolean).join(' '), text: column.balance ? won(value) : blankZero(value) };
};

const BalanceTable = memo(function BalanceTable({ items, totals, selectedKey, onSelect, columns }) {
  return <table className={classes.table} style={{ width: `max(100%, ${columns.tableWidth}px)` }} aria-label="거래처별 잔액">
    <colgroup>{BALANCE_COLUMNS.map((column) => <col key={column.key} data-column-key={column.key} style={{ width: columns.widthOf(column) }} />)}</colgroup>
    <thead>
      <tr>
        <th rowSpan={2}>거래처코드<ColumnResizeHandle column={BALANCE_COLUMNS[0]} columns={columns} /></th>
        <th rowSpan={2}>거래처명<ColumnResizeHandle column={BALANCE_COLUMNS[1]} columns={columns} /></th>
        <th colSpan={4} className={classes.groupRecv}>미수금</th>
        <th colSpan={4} className={classes.groupPay}>미지급금</th>
      </tr>
      <tr>{BALANCE_COLUMNS.slice(2).map((column) => <th key={column.key} className={column.group === 'recv' ? classes.groupRecv : classes.groupPay}>
        {column.label}<ColumnResizeHandle column={column} columns={columns} />
      </th>)}</tr>
    </thead>
    <tbody>
      {items.map((item) => <tr key={item.ckey} className={`${classes.clickable} ${item.ckey === selectedKey ? classes.selected : ''}`} onClick={() => onSelect(item.ckey)}
        tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') onSelect(item.ckey); }}>
        <td title={item.customcode}>{item.customcode}</td>
        <td title={item.customname}>{item.customname}</td>
        {BALANCE_COLUMNS.slice(2).map((column) => { const cell = moneyCell(column, item[column.key]); return <td key={column.key} className={cell.className}>{cell.text}</td>; })}
      </tr>)}
      {!items.length && <tr><td colSpan={BALANCE_COLUMNS.length}><div className={classes.empty}><strong>조회된 거래처가 없습니다</strong><span>기간을 바꾸거나 [조회]를 눌러 주세요.</span></div></td></tr>}
    </tbody>
    {items.length > 0 && <tfoot><tr>
      <td colSpan={2} className={classes.center}>합계 ({items.length.toLocaleString()}곳)</td>
      {BALANCE_COLUMNS.slice(2).map((column) => { const cell = moneyCell({ ...column, balance: true }, totals[column.key]); return <td key={column.key} className={cell.className}>{cell.text}</td>; })}
    </tr></tfoot>}
  </table>;
});

// 이월 줄 설명: 거래처관리 기초잔액이 있으면 금액을 그대로 보여준다 (이월 금액이 어디서 왔는지 알 수 있게)
const carryText = (ledger) => {
  const baseRecv = toNumber(ledger.opening.base_recv);
  const basePay = toNumber(ledger.opening.base_pay);
  const parts = [];
  // 날짜는 원장 시작일을 정했을 때만 붙인다 (기초잔액이 그 날짜 기준이므로)
  const baseLabel = ledger.ledgerstartdate ? `원장 시작일 ${dateText(ledger.ledgerstartdate)} 기준 기초잔액` : '기초잔액(거래처관리)';
  if (baseRecv || basePay) parts.push(`${baseLabel} 미수 ${won(baseRecv)} · 미지급 ${won(basePay)}`);
  const priorRecv = toNumber(ledger.opening.recv) - baseRecv;
  const priorPay = toNumber(ledger.opening.pay) - basePay;
  if (priorRecv || priorPay) parts.push(`이전 거래 미수 ${won(priorRecv)} · 미지급 ${won(priorPay)}`);
  return parts.length ? parts.join(' + ') : '이월 잔액 없음';
};

const LedgerTable = memo(function LedgerTable({ ledger, columns }) {
  if (!ledger) return <div className={classes.empty}><strong>거래처를 선택하세요</strong><span>위 목록에서 거래처를 누르면 원장이 나옵니다.</span></div>;
  return <table className={classes.table} style={{ width: `max(100%, ${columns.tableWidth}px)` }} aria-label="거래처원장">
    <colgroup>{LEDGER_COLUMNS.map((column) => <col key={column.key} data-column-key={column.key} style={{ width: columns.widthOf(column) }} />)}</colgroup>
    <thead><tr>{LEDGER_COLUMNS.map((column) => <th key={column.key} className={column.group === 'recv' ? classes.groupRecv : column.group === 'pay' ? classes.groupPay : undefined}>
      {column.label}<ColumnResizeHandle column={column} columns={columns} />
    </th>)}</tr></thead>
    <tbody>
      <tr className={classes.carry}>
        <td />
        <td className={classes.center}>이월</td>
        <td />
        <td title={carryText(ledger)}>{carryText(ledger)}</td>
        <td className={classes.recvCol} /><td className={classes.recvCol} />
        <td className={moneyCell(LEDGER_COLUMNS[6], ledger.opening.recv).className}>{won(ledger.opening.recv)}</td>
        <td className={classes.payCol} /><td className={classes.payCol} />
        <td className={moneyCell(LEDGER_COLUMNS[9], ledger.opening.pay).className}>{won(ledger.opening.pay)}</td>
        <td />
      </tr>
      {ledger.lines.map((line, index) => <tr key={`${line.kind}:${line.docno}:${index}`}>
        <td className={classes.center}>{dateText(line.entrydate)}</td>
        <td className={classes.center}><span className={`${classes.kind} ${classes[`kind${line.kind}`] || ''}`}>{line.kindname}</span></td>
        <td title={line.docno}>{line.docno}</td>
        <td title={line.summary}>{line.summary}</td>
        {['sales', 'receipt', 'recv_balance', 'purchase', 'payment', 'pay_balance'].map((key, offset) => {
          const cell = moneyCell(LEDGER_COLUMNS[4 + offset], line[key]);
          return <td key={key} className={cell.className}>{cell.text}</td>;
        })}
        <td title={line.description || ''}>{line.description || ''}</td>
      </tr>)}
      {!ledger.lines.length && <tr><td colSpan={LEDGER_COLUMNS.length} className={classes.center} style={{ height: 70, color: '#8290a5' }}>기간 안에 거래가 없습니다.</td></tr>}
    </tbody>
    <tfoot><tr>
      <td colSpan={4} className={classes.center}>기간 합계 · 기말 잔액</td>
      <td className={`${classes.num} ${classes.recvCol}`}>{won(ledger.totals.sales)}</td>
      <td className={`${classes.num} ${classes.recvCol}`}>{won(ledger.totals.receipt)}</td>
      <td className={moneyCell(LEDGER_COLUMNS[6], ledger.closing.recv).className}>{won(ledger.closing.recv)}</td>
      <td className={`${classes.num} ${classes.payCol}`}>{won(ledger.totals.purchase)}</td>
      <td className={`${classes.num} ${classes.payCol}`}>{won(ledger.totals.payment)}</td>
      <td className={moneyCell(LEDGER_COLUMNS[9], ledger.closing.pay).className}>{won(ledger.closing.pay)}</td>
      <td />
    </tr></tfoot>
  </table>;
});

const FilterSidebar = memo(function FilterSidebar({ filterInputs, setFilterInputs, onSearch, onClose, startDate, canEditStart, onSaveStart }) {
  const [startInput, setStartInput] = useState(startDate || '');
  const [editingStart, setEditingStart] = useState(false);
  const [lastStart, setLastStart] = useState(startDate);
  if (lastStart !== startDate) { setLastStart(startDate); setStartInput(startDate || ''); }
  const onKeyDown = (event) => { if (event.key === 'Enter') onSearch(); };
  return <Paper component="aside" className={searchClasses.filterSidebar} withBorder>
    <Group className={searchClasses.filterHeader} justify="space-between" align="center"><Text fw={700}>조회조건</Text>
      <ActionIcon variant="subtle" color="gray" aria-label="조회조건 닫기" onClick={onClose}><IconX size={16} /></ActionIcon></Group>
    <Stack gap="sm" className={searchClasses.filterFields}>
      <Box><Text size="xs" fw={700} mb={5}>조회 기간</Text><Stack gap={6}>
        <ErpDateInput aria-label="조회 시작일" type="date" value={filterInputs.date_from} onChange={(event) => { const { value } = event.currentTarget; setFilterInputs((current) => ({ ...current, date_from: value })); }} />
        <ErpDateInput aria-label="조회 종료일" type="date" value={filterInputs.date_to} onChange={(event) => { const { value } = event.currentTarget; setFilterInputs((current) => ({ ...current, date_to: value })); }} />
      </Stack></Box>
      <TextInput label="거래처" placeholder="거래처코드 또는 거래처명" value={filterInputs.keyword} onKeyDown={onKeyDown}
        onChange={(event) => { const { value } = event.currentTarget; setFilterInputs((current) => ({ ...current, keyword: value })); }} />
      <Checkbox size="xs" color="red" label="잔액이 남은 거래처만" checked={filterInputs.balance_only}
        onChange={(event) => { const { checked } = event.currentTarget; setFilterInputs((current) => ({ ...current, balance_only: checked })); }} />
      <Button size="xs" color="red" leftSection={<IconSearch size={14} />} onClick={onSearch}>조회</Button>
    </Stack>
    <div className={classes.startBox}>
      <Group justify="space-between" gap={4}><Text size="xs" fw={700}>원장 시작일</Text>
        {canEditStart && !editingStart && <Button size="compact-xs" variant="subtle" color="gray" onClick={() => setEditingStart(true)}>변경</Button>}</Group>
      {editingStart
        ? <Stack gap={6} mt={6}>
          <ErpDateInput aria-label="원장 시작일" type="date" value={startInput} onChange={(event) => setStartInput(event.currentTarget.value)} />
          <Group gap={6} grow>
            <Button size="compact-sm" variant="default" onClick={() => { setStartInput(startDate || ''); setEditingStart(false); }}>취소</Button>
            <Button size="compact-sm" color="red" onClick={async () => { if (await onSaveStart(startInput || null)) setEditingStart(false); }}>저장</Button>
          </Group>
        </Stack>
        : <div className={classes.startValue} style={{ marginTop: 4 }}>{startDate ? dateText(startDate) : '지정 안 됨 (첫 거래부터)'}</div>}
      <p>이 날짜 이전 잔액은 거래처관리의 기초 미수금·미지급금으로 보고, 이 날짜부터의 전표만 원장에 쌓습니다.{canEditStart ? '' : ' 변경은 관리자만 할 수 있습니다.'}</p>
    </div>
  </Paper>;
});

export default function CustomerLedger() {
  const ribbon = useContext(PageRibbonContext);
  const registerRibbon = ribbon?.registerPageRibbon;
  const closePage = ribbon?.closeActivePage;
  const { authority } = useContext(MenuAccessContext);
  const canEditStart = ['MASTER', 'SUBMASTER'].includes(String(authority || '').toUpperCase());

  const [filterInputs, setFilterInputs] = useState(makeDefaultFilters);
  const [filters, setFilters] = useState(makeDefaultFilters);
  const [filterOpen, setFilterOpen] = useState(true);
  const [balances, setBalances] = useState({ items: [], totals: {}, ledgerstartdate: null });
  // 거래처 잔액 현황에서 거래처를 눌러 들어오면 (?ckey=) 그 거래처 원장을 바로 연다
  const location = useLocation();
  const [selectedKey, setSelectedKey] = useState(() => new URLSearchParams(location.search).get('ckey') || '');
  const [ledger, setLedger] = useState(null);
  const [loadingBalances, setLoadingBalances] = useState(false);
  const [loadingLedger, setLoadingLedger] = useState(false);
  const [exporting, setExporting] = useState(false);
  const balanceRequestRef = useRef(0);
  const ledgerRequestRef = useRef(0);
  const balanceColumns = useResizableColumns(BALANCE_COLUMNS);
  const ledgerColumns = useResizableColumns(LEDGER_COLUMNS);

  const loadBalances = useCallback(async (requestFilters) => {
    const requestId = ++balanceRequestRef.current;
    setLoadingBalances(true);
    try {
      const { data } = await axios.get('/api/customer-ledger/balances', { ...authConfig(), params: {
        date_from: requestFilters.date_from, date_to: requestFilters.date_to,
        keyword: requestFilters.keyword || undefined, balance_only: requestFilters.balance_only || undefined,
      } });
      if (requestId !== balanceRequestRef.current) return;
      setBalances({ items: data.items || [], totals: data.totals || {}, ledgerstartdate: data.ledgerstartdate || null });
    } catch (error) {
      if (requestId === balanceRequestRef.current) notifications.show({ title: '거래처별 잔액 조회 실패', message: errorMessage(error, '거래처별 잔액을 불러오지 못했습니다.'), color: 'red' });
    } finally {
      if (requestId === balanceRequestRef.current) setLoadingBalances(false);
    }
  }, []);

  const loadLedger = useCallback(async (ckey, requestFilters) => {
    const requestId = ++ledgerRequestRef.current;
    if (!ckey) { setLedger(null); setLoadingLedger(false); return; }
    setLoadingLedger(true);
    try {
      const { data } = await axios.get('/api/customer-ledger/ledger', { ...authConfig(), params: { ckey, date_from: requestFilters.date_from, date_to: requestFilters.date_to } });
      if (requestId !== ledgerRequestRef.current) return;
      setLedger({ ...data, date_from: requestFilters.date_from });
    } catch (error) {
      if (requestId === ledgerRequestRef.current) notifications.show({ title: '거래처원장 조회 실패', message: errorMessage(error, '거래처원장을 불러오지 못했습니다.'), color: 'red' });
    } finally {
      if (requestId === ledgerRequestRef.current) setLoadingLedger(false);
    }
  }, []);

  useEffect(() => { void loadBalances(filters); }, [loadBalances, filters]);
  useEffect(() => { void loadLedger(selectedKey, filters); }, [loadLedger, selectedKey, filters]);
  // 탭에 돌아오면 같은 조건으로 다시 계산한다 (다른 화면에서 전표가 바뀌었을 수 있음)
  usePageReactivated(() => { void loadBalances(filters); void loadLedger(selectedKey, filters); });

  const runSearch = useCallback(() => {
    if (!filterInputs.date_from || !filterInputs.date_to) {
      notifications.show({ title: '조회 기간 확인', message: '조회 시작일과 종료일을 입력해 주세요.', color: 'orange' });
      return;
    }
    if (filterInputs.date_from > filterInputs.date_to) {
      notifications.show({ title: '조회 기간 확인', message: '시작일은 종료일보다 뒤일 수 없습니다.', color: 'orange' });
      return;
    }
    setFilters({ ...filterInputs, keyword: filterInputs.keyword.trim() });
  }, [filterInputs]);

  const saveStartDate = useCallback(async (value) => {
    try {
      await axios.put('/api/customer-ledger/settings', { ledgerstartdate: value }, authConfig());
      notifications.show({ title: '원장 시작일 저장', message: value ? `${value}부터 원장을 쌓습니다.` : '첫 거래부터 원장을 쌓습니다.', color: 'teal' });
      setFilters((current) => ({ ...current })); // 같은 조건으로 다시 계산
      return true;
    } catch (error) {
      notifications.show({ title: '원장 시작일 저장 실패', message: errorMessage(error, '원장 시작일을 저장하지 못했습니다.'), color: 'red' });
      return false;
    }
  }, []);

  const selectCustomer = useCallback((ckey) => setSelectedKey(ckey), []);
  const selectedItem = balances.items.find((item) => item.ckey === selectedKey);

  const exportExcel = useCallback(() => {
    if (!balances.items.length || exporting) return;
    setExporting(true);
    try {
      const workbook = XLSX.utils.book_new();
      const balanceRows = balances.items.map((item) => ({
        거래처코드: item.customcode, 거래처명: item.customname,
        '기초 미수금': toNumber(item.recv_open), 매출: toNumber(item.sales), 수금: toNumber(item.receipt), '기말 미수금': toNumber(item.recv_close),
        '기초 미지급금': toNumber(item.pay_open), 매입: toNumber(item.purchase), 지급: toNumber(item.payment), '기말 미지급금': toNumber(item.pay_close),
      }));
      const balanceSheet = XLSX.utils.json_to_sheet(balanceRows);
      applyExcelHeaderStyle(balanceSheet, 10);
      XLSX.utils.book_append_sheet(workbook, balanceSheet, '거래처별잔액');
      if (ledger) {
        const ledgerRows = [
          { 일자: filters.date_from, 구분: '이월', 전표번호: '', 적요: '', 매출: '', 수금: '', 미수잔액: toNumber(ledger.opening.recv), 매입: '', 지급: '', 미지급잔액: toNumber(ledger.opening.pay), 비고: '' },
          ...ledger.lines.map((line) => ({
            일자: dateText(line.entrydate), 구분: line.kindname, 전표번호: line.docno, 적요: line.summary,
            매출: toNumber(line.sales), 수금: toNumber(line.receipt), 미수잔액: toNumber(line.recv_balance),
            매입: toNumber(line.purchase), 지급: toNumber(line.payment), 미지급잔액: toNumber(line.pay_balance), 비고: line.description || '',
          })),
        ];
        const ledgerSheet = XLSX.utils.json_to_sheet(ledgerRows);
        applyExcelHeaderStyle(ledgerSheet, 11);
        XLSX.utils.book_append_sheet(workbook, ledgerSheet, '거래처원장');
      }
      const name = ledger ? `_${String(ledger.customer.customname || '').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 40)}` : '';
      XLSX.writeFile(workbook, `거래처원장${name}_${filters.date_from.replaceAll('-', '')}_${filters.date_to.replaceAll('-', '')}.xlsx`);
    } catch {
      notifications.show({ title: '엑셀 다운로드 실패', message: '거래처원장을 파일로 저장하지 못했습니다.', color: 'red' });
    } finally {
      setExporting(false);
    }
  }, [balances.items, exporting, ledger, filters]);

  // 리본: 최신 핸들러는 ref 로 호출 (조회 중 표시 때문에 레이아웃 전체를 다시 그리지 않게)
  const ribbonActions = useRef({});
  useLayoutEffect(() => { ribbonActions.current = { search: runSearch, excel: exportExcel }; });
  const excelDisabled = balances.items.length === 0;
  useEffect(() => {
    if (!registerRibbon) return undefined;
    registerRibbon(
      <Group className={searchClasses.commandRibbon} justify="flex-start" wrap="nowrap" gap={2}>
        <Button className={searchClasses.ribbonTool} variant="subtle" size="sm" leftSection={<IconSearch size={15} />} onClick={() => ribbonActions.current.search()}>조회</Button>
        <span className={searchClasses.ribbonSeparator} />
        <Button className={searchClasses.ribbonTool} variant="subtle" size="sm" leftSection={<IconPlus size={15} />} disabled>추가</Button>
        <Button className={searchClasses.ribbonTool} variant="subtle" size="sm" leftSection={<IconCopy size={15} />} disabled>복사</Button>
        <Button className={searchClasses.ribbonTool} variant="subtle" size="sm" leftSection={<IconFileSpreadsheet size={15} />}
          onClick={() => ribbonActions.current.excel()} loading={exporting} disabled={excelDisabled}>엑셀</Button>
        <Button className={searchClasses.ribbonTool} variant="subtle" size="sm" leftSection={<IconDeviceFloppy size={15} />} disabled>저장</Button>
        <Button className={searchClasses.ribbonTool} variant="subtle" size="sm" leftSection={<IconTrash size={15} />} disabled>삭제</Button>
        <span className={searchClasses.ribbonSeparator} />
        <Button className={searchClasses.ribbonTool} variant="subtle" size="sm" leftSection={<IconX size={15} />} onClick={closePage}>닫기</Button>
      </Group>,
    );
    return () => registerRibbon(null);
  }, [registerRibbon, closePage, exporting, excelDisabled]);

  return (
    <Box className={`${searchClasses.page}`}>
      <Box component="nav" aria-label="현재 위치" className={searchClasses.pageBreadcrumb}>
        <Group className={searchClasses.breadcrumbTrail} gap={7}>
          <Text component="span" className={searchClasses.breadcrumbParent}>자금관리</Text>
          <Text component="span" className={searchClasses.breadcrumbChevron}>›</Text>
          <Text component="span" className={searchClasses.breadcrumbCurrent}>거래처원장</Text>
        </Group>
        {!filterOpen && <Button className={searchClasses.filterToggle} variant="subtle" size="xs" leftSection={<IconFilter size={15} />} onClick={() => setFilterOpen(true)}>조회조건</Button>}
      </Box>

      <Box className={searchClasses.inboundWorkspace}>
        <div className={classes.mainColumn}>
          <Paper className={`${classes.panel} ${classes.balancePanel}`} withBorder>
            <div className={classes.toolbar}>
              <div className={classes.toolbarTitle}>
                <Text className={searchClasses.sectionTitle} fw={700}>거래처별 잔액</Text>
                <Badge color="gray" variant="light">{balances.items.length.toLocaleString()}곳</Badge>
              </div>
              <div className={classes.closingChips}>
                <span className={`${classes.chip} ${classes.chipRecv}`}>미수금 합계<b>{won(balances.totals.recv_close)}</b></span>
                <span className={`${classes.chip} ${classes.chipPay}`}>미지급금 합계<b>{won(balances.totals.pay_close)}</b></span>
              </div>
            </div>
            <div className={classes.tableWrap}>
              {loadingBalances && <Loader className={classes.loader} size="sm" color="red" />}
              <BalanceTable items={balances.items} totals={balances.totals} selectedKey={selectedKey} onSelect={selectCustomer} columns={balanceColumns} />
            </div>
          </Paper>

          <Paper className={`${classes.panel} ${classes.ledgerPanel}`} withBorder>
            <div className={classes.toolbar}>
              <div className={classes.toolbarTitle}>
                <Text className={searchClasses.sectionTitle} fw={700}>거래처원장</Text>
                {(ledger?.customer?.customname || selectedItem?.customname) && <Badge color="red" variant="light">{ledger?.customer?.customname || selectedItem?.customname}</Badge>}
                {ledger && <span className={classes.toolbarHint}>{ledger.lines.length.toLocaleString()}건</span>}
              </div>
              {ledger && <div className={classes.closingChips}>
                <span className={`${classes.chip} ${classes.chipRecv}`}>기말 미수금<b>{won(ledger.closing.recv)}</b></span>
                <span className={`${classes.chip} ${classes.chipPay}`}>기말 미지급금<b>{won(ledger.closing.pay)}</b></span>
              </div>}
            </div>
            <div className={classes.tableWrap}>
              {loadingLedger && <Loader className={classes.loader} size="sm" color="red" />}
              <LedgerTable ledger={ledger} columns={ledgerColumns} />
            </div>
          </Paper>
        </div>

        {filterOpen && <FilterSidebar filterInputs={filterInputs} setFilterInputs={setFilterInputs} onSearch={runSearch} onClose={() => setFilterOpen(false)}
          startDate={balances.ledgerstartdate ? dateText(balances.ledgerstartdate) : ''} canEditStart={canEditStart} onSaveStart={saveStartDate} />}
      </Box>
    </Box>
  );
}
