// 타사 재고현황 (어드민 › 고객사관리 맨 아래 · 플랫폼 운영사 001 · 모스코 계정 전용)
// 서면 계약으로 재고 공개에 동의한 고객사(고객사등록 › 재고 공개)의 재고를 본다. 서버: services/inventory/SharedStock.py
//  [재고 현황] 조회조건 + 재고 표 · 규격별 합계(기본: 같은 고객사·품명·강종·표면·두께·폭·길이는 한 줄) / 상세(현재고현황과 같은 칸)
//  [재고 추이] 조회조건(재고 현황과 같은 항목) + 고객사별 / 품명별 월말 재고 · 입고 · 판매 출고 중량(kg) (줄을 누르면 펼침)
//  창고 · 매입처 · 단가 · 원가 · 전표번호는 서버가 아예 보내지 않는다
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { loadXLSXOrNotify } from '../../utils/excelSafe';
import { ActionIcon, Badge, Box, Group, Loader, Pagination, Paper, Select, Stack, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconX } from '@tabler/icons-react';
import ErpBreadcrumb from '../../components/common/ErpBreadcrumb';
import ErpDateInput from '../../components/common/ErpDateInput';
import useErpPageRibbon from '../../components/common/useErpPageRibbon';
import usePageReactivated from '../../components/common/usePageReactivated';
import sharedClasses from '../../styles/pages/ManagementShared.module.css';
import simpleTheme from '../../styles/pages/SimpleTheme.module.css';
import searchClasses from '../../styles/pages/InboundSearch.module.css';
import classes from '../../styles/pages/SharedStock.module.css';
import outboundClasses from '../../styles/pages/OutboundRegister.module.css';   // 탭: 매출등록 상세 탭과 같은 모양
import { applyExcelHeaderStyle } from '../../utils/excelHeaderStyle';
import { ColumnResizeHandle, pickerClasses, useResizableColumns } from '../../components/common/PickerModal';   // 머리글 오른쪽 끝을 끌어 칸 너비 조절
import { apiErrorMessage } from '../../utils/apiError';

const PAGE_OPTIONS = [{ value: '50', label: '50개씩' }, { value: '100', label: '100개씩' }, { value: '200', label: '200개씩' }];
const KIND_OPTIONS = [{ value: '', label: '전체' }, { value: 'OPENING', label: '기초' }, { value: 'INBOUND', label: '입고' }, { value: 'PROCESS', label: '가공' }, { value: 'TRANSFER', label: '이동' }];
const KIND_NAME = { OPENING: '기초', INBOUND: '입고', PROCESS: '가공', TRANSFER: '이동' };
const KIND_BADGE = { OPENING: searchClasses.typeOpening, INBOUND: searchClasses.typeInbound, PROCESS: searchClasses.typeProcess, TRANSFER: searchClasses.typeMove };
const TABS = [{ value: 'stock', label: '재고 현황' }, { value: 'trend', label: '재고 추이' }];   // 재고 현황이 먼저 (처음 열면 재고 현황)
const STOCK_VIEWS = [{ value: 'grouped', label: '규격별 합계' }, { value: 'lots', label: '상세' }];
const AXES = [{ value: 'company', label: '고객사별' }, { value: 'item', label: '품명별' }];
const TREND_VIEWS = [{ value: 'ending', label: '월말 재고' }, { value: 'inbound', label: '입고' }, { value: 'outbound', label: '판매 출고' }];
const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });
const toNumber = (value) => { const number = Number(value); return Number.isFinite(number) ? number : 0; };
const kg = (value) => Math.round(toNumber(value)).toLocaleString('ko-KR');
const numberText = (value) => (value === null || value === undefined || value === '' ? '' : Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 2 }));
// 규격(두께·폭·길이·마이)은 금액이 아니므로 소수 셋째 자리까지 그대로 보여 준다
const specText = (value) => value === null || value === undefined || value === '' ? '' : Number(value).toLocaleString(undefined, { maximumFractionDigits: 3 });
const dateText = (value) => (value ? String(value).slice(0, 10) : '');
const todayText = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
const pad = (value) => String(value).padStart(2, '0');
const monthEnd = (year, month) => `${year}-${pad(month)}-${pad(new Date(year, month, 0).getDate())}`;

// 기본 조회조건: 재고 현황 · 재고 추이 모두 이번 달 1일 ~ 말일 (KST)
const stockDefaults = () => {
  const [year, month] = todayText().split('-').map(Number);
  return { companyid: '', sourcetype: '', date_from: `${year}-${pad(month)}-01`, date_to: monthEnd(year, month),
    item_search: '', product_search: '', material_search: '', surface_search: '', thickness: '', width: '', length: '' };
};
const trendDefaults = () => {
  const [year, month] = todayText().split('-').map(Number);
  return { companyid: '', date_from: `${year}-${pad(month)}-01`, date_to: monthEnd(year, month),
    item_search: '', material_search: '', surface_search: '', product_search: '', thickness: '', width: '', length: '' };
};

// [재고 현황] 칸: 규격별 합계 / 상세 (현재고현황과 같은 이름 · 순서, 창고 · 매입처 · 금액 · 전표는 없음)
const daysCell = (days) => (days === null || days === undefined ? '' : <span className={toNumber(days) >= 365 ? classes.oldCell : ''}>{toNumber(days).toLocaleString('ko-KR')}일</span>);
const GROUPED_COLUMNS = [
  { key: 'no', label: 'No.', width: 56, className: 'center' },
  { key: 'companyname', label: '고객사', width: 130, className: 'strong', render: (row) => row.companyname || '' },
  { key: 'itemname', label: '품명', width: 140, className: 'strong', render: (row) => row.itemname || '' },
  { key: 'materialname', label: '강종', width: 100, render: (row) => row.materialname || '' },
  { key: 'surfacename', label: '표면', width: 100, render: (row) => row.surfacename || '' },
  { key: 'thickness', label: '두께', width: 70, className: 'num', render: (row) => specText(row.thickness) },
  { key: 'width', label: '폭', width: 80, className: 'num', render: (row) => specText(row.width) },
  { key: 'length', label: '길이', width: 80, className: 'num', render: (row) => specText(row.length) },
  { key: 'qty', label: '현재수량', width: 90, className: 'num', render: (row) => numberText(row.qty) },
  { key: 'qtyunit', label: '수량단위', width: 80, className: 'center', render: (row) => row.qtyunit || '' },
  { key: 'weight', label: '현재중량(KG)', width: 120, className: 'num weightCell', render: (row) => numberText(row.weight) },
  { key: 'first_date', label: '최초 입고일', width: 110, className: 'center', render: (row) => dateText(row.first_date) },
  { key: 'last_date', label: '최근 입고일', width: 110, className: 'center', render: (row) => dateText(row.last_date) },
  { key: 'max_days', label: '최장 재고일수', width: 110, className: 'num', render: (row) => daysCell(row.max_days) },
];
const LOT_COLUMNS = [
  { key: 'no', label: 'No.', width: 56, className: 'center' },
  { key: 'companyname', label: '고객사', width: 130, className: 'strong', render: (row) => row.companyname || '' },
  { key: 'stockkind', label: '재고구분', width: 80, className: 'center', render: (row) => (KIND_NAME[row.stockkind] ? <span className={`${searchClasses.typeBadge} ${KIND_BADGE[row.stockkind] || ''}`}>{KIND_NAME[row.stockkind]}</span> : '') },
  { key: 'receiptdate', label: '입고일자', width: 110, className: 'center', render: (row) => dateText(row.receiptdate) },
  { key: 'itemname', label: '품명', width: 140, render: (row) => row.itemname || '' },
  { key: 'materialname', label: '강종', width: 100, render: (row) => row.materialname || '' },
  { key: 'surfacename', label: '표면', width: 100, render: (row) => row.surfacename || '' },
  { key: 'myrtle', label: '도금량(g/㎡)', width: 100, className: 'num', render: (row) => specText(row.myrtle) },
  { key: 'thickness', label: '두께', width: 70, className: 'num', render: (row) => specText(row.thickness) },
  { key: 'width', label: '폭', width: 80, className: 'num', render: (row) => specText(row.width) },
  { key: 'length', label: '길이', width: 80, className: 'num', render: (row) => specText(row.length) },
  { key: 'qty', label: '현재수량', width: 90, className: 'num', render: (row) => numberText(row.qty) },
  { key: 'weight', label: '현재중량(KG)', width: 120, className: 'num weightCell', render: (row) => numberText(row.weight) },
  { key: 'productname', label: '제품번호', width: 170, render: (row) => row.productname || '' },
  { key: 'originalqty', label: '최초수량', width: 90, className: 'num', render: (row) => numberText(row.originalqty) },
  { key: 'originalweight', label: '최초중량(KG)', width: 110, className: 'num', render: (row) => numberText(row.originalweight) },
  { key: 'qtyunit', label: '수량단위', width: 80, className: 'center', render: (row) => row.qtyunit || '' },
  { key: 'days', label: '재고일수', width: 90, className: 'num', render: (row) => daysCell(row.days) },
];
const cellClass = (name = '') => name.split(' ').filter(Boolean).map((part) => classes[part] || '').join(' ');

// 데이터가 없어도 머리글은 보이고, 표 안에 안내 한 줄
function StockTable({ rows, columns, rowOffset, emptyText }) {
  const resizable = useResizableColumns(columns);
  return <table className={classes.stockTable} style={{ width: `max(100%, ${resizable.tableWidth}px)` }}>
    <colgroup>{columns.map((column) => <col key={column.key} data-column-key={column.key} style={{ width: resizable.widthOf(column) }} />)}</colgroup>
    <thead><tr>{columns.map((column) => <th key={column.key} className={`${cellClass(column.className)} ${pickerClasses.resizableHead}`}>{column.label}<ColumnResizeHandle column={column} columns={resizable} /></th>)}</tr></thead>
    <tbody>{rows.length ? rows.map((row, index) => <tr key={`${row.companyid}|${row.rowkey || index}`}>
      {columns.map((column) => <td key={column.key} className={cellClass(column.className)}>{column.key === 'no' ? rowOffset + index + 1 : column.render(row)}</td>)}
    </tr>) : <tr className={classes.emptyRow}><td colSpan={columns.length}>{emptyText}</td></tr>}</tbody>
  </table>;
}

// 엑셀 보기 좋게: 열 너비를 머리글 · 값 길이에 맞추고(한글은 2칸), 숫자는 천 단위 쉼표 (소수 3자리까지)
const textWidth = (value) => [...String(value ?? '')].reduce((sum, char) => sum + (/[ㄱ-힝]/.test(char) ? 2 : 1), 0);
const fitExcelSheet = (sheet, rows, XLSX) => {
  const keys = Object.keys(rows[0]);
  sheet['!cols'] = keys.map((key) => ({ wch: Math.min(Math.max(textWidth(key), ...rows.map((row) => textWidth(typeof row[key] === 'number' ? row[key].toLocaleString('ko-KR', { maximumFractionDigits: 2 }) : row[key]))) + 2, 40) }));
  const range = XLSX.utils.decode_range(sheet['!ref']);
  for (let r = 1; r <= range.e.r; r += 1) {
    for (let c = 0; c <= range.e.c; c += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.t === 'n') cell.z = Number.isInteger(cell.v) ? '#,##0' : '#,##0.##';
    }
  }
};

// 지난달 대비 (kg)
const Change = ({ diff }) => (!Math.round(diff) ? <span className={classes.flat}>변동 없음</span>
  : <span className={diff > 0 ? classes.up : classes.down}>{kg(Math.abs(diff))} {diff > 0 ? '증가' : '감소'}</span>);

// [재고 추이] 고객사별 / 품명별 · 줄을 누르면 펼침 (고객사 → 품명별, 품명 → 고객사별)
function TrendTable({ data, axis, view }) {
  const [open, setOpen] = useState(() => new Set());   // 묶는 기준 · 조회조건이 바뀌면 key 가 바뀌어 접힌 상태로 다시 시작
  const { months, current_month: current } = data;
  const multiYear = new Set(months.map((month) => month.slice(0, 4))).size > 1;
  const monthLabel = (month) => (multiYear ? `${month.slice(2, 4)}.${month.slice(5)}` : `${Number(month.slice(5))}월`);
  const rows = axis === 'company' ? data.companies : (data.items || []);
  const last = months.length - 1;
  const columnDefs = [
    { key: 'name', label: axis === 'company' ? '고객사' : '품명', width: 180 },
    { key: 'holder', label: axis === 'company' ? '보유 품명' : '보유 고객사', width: 100 },
    { key: 'weight', label: '현재 재고(kg)', width: 120 },
    ...months.map((month) => ({ key: month, label: monthLabel(month), width: 100 })),
    { key: 'change', label: '지난달 대비(kg)', width: 130 },
  ];
  const resizable = useResizableColumns(columnDefs);
  const head = (key) => columnDefs.find((column) => column.key === key);
  const handle = (key) => <ColumnResizeHandle column={head(key)} columns={resizable} />;
  const keyOf = (row) => (axis === 'company' ? row.companyid : row.itemname);
  const toggle = (key) => setOpen((now) => { const next = new Set(now); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const monthTotal = (index) => rows.reduce((sum, row) => sum + toNumber(row[view][index]), 0);
  // 지난달 값: 기간 안의 전 달, 한 달만 조회했으면 서버가 같이 보낸 기간 바로 전 달(before)
  const previousOf = (row) => (last > 0 ? toNumber(row[view][last - 1]) : toNumber(row.before?.[view]));
  const cells = (row, child = false) => <>
    <td className={`${classes.num} ${child ? '' : classes.strongCell}`}>{kg(row.weight)}</td>
    {months.map((month, index) => <td key={month} className={`${classes.num} ${month === current ? classes.currentCell : ''}`}>
      {toNumber(row[view][index]) ? kg(row[view][index]) : <span className={classes.zero}>-</span>}
    </td>)}
    <td className={`${classes.num} ${classes.totalCol}`}><Change diff={toNumber(row[view][last]) - previousOf(row)} /></td>
  </>;
  const rh = pickerClasses.resizableHead;
  return <table className={classes.trendTable} style={{ width: `max(100%, ${resizable.tableWidth}px)` }}>
    <colgroup>{columnDefs.map((column) => <col key={column.key} data-column-key={column.key} style={{ width: resizable.widthOf(column) }} />)}</colgroup>
    <thead><tr>
      <th className={`${classes.stickyCol} ${rh}`}>{head('name').label}{handle('name')}</th>
      <th className={rh}>{head('holder').label}{handle('holder')}</th>
      <th className={`${classes.num} ${rh}`}>현재 재고(kg){handle('weight')}</th>
      {months.map((month) => <th key={month} className={`${classes.num} ${rh} ${month === current ? classes.currentHead : ''}`}>{monthLabel(month)}{month === current ? <small>(이번 달)</small> : null}{handle(month)}</th>)}
      <th className={`${classes.num} ${classes.totalCol} ${rh}`}>지난달 대비(kg){handle('change')}</th>
    </tr></thead>
    <tbody>{!rows.length && <tr className={classes.emptyRow}><td colSpan={months.length + 4}>조건에 맞는 재고 추이가 없습니다.</td></tr>}{rows.map((row) => {
      const key = keyOf(row);
      const expanded = open.has(key);
      return <Fragment key={key}>
        <tr className={`${classes.clickRow} ${expanded ? classes.openRow : ''}`} onClick={() => toggle(key)} title={`누르면 ${axis === 'company' ? '품명별' : '고객사별'}로 펼치기 / 접기`}>
          <td className={classes.stickyCol}><span className={classes.treeName}><span className={classes.chevron}>{expanded ? '▾' : '▸'}</span><b>{axis === 'company' ? row.companyname : row.itemname}</b></span></td>
          <td className={classes.mutedCell}>{axis === 'company' ? `${toNumber(row.items)}종` : `${toNumber(row.company_count)}곳`}</td>
          {cells(row)}
        </tr>
        {expanded && (row.children || []).map((child) => <tr key={`${key}|${child.key}`} className={classes.childRow}>
          <td className={classes.stickyCol}><span className={classes.childName}>{child.name}</span></td>
          <td />
          {cells(child, true)}
        </tr>)}
      </Fragment>;
    })}</tbody>
    <tfoot><tr>
      <td className={classes.stickyCol}>합계</td>
      <td className={classes.mutedCell}>{axis === 'company' ? `${rows.length}곳` : `${rows.filter((row) => row.weight > 0).length}종`}</td>
      <td className={classes.num}>{kg(data.summary.weight)}</td>
      {months.map((month, index) => <td key={month} className={classes.num}>{kg(monthTotal(index))}</td>)}
      <td className={`${classes.num} ${classes.totalCol}`}><Change diff={monthTotal(last) - rows.reduce((sum, row) => sum + previousOf(row), 0)} /></td>
    </tr></tfoot>
  </table>;
}

// 오른쪽 조회조건 패널 (현재고현황과 같은 모양)
function FilterPanel({ onClose, children }) {
  return <Paper component="aside" className={searchClasses.filterSidebar} withBorder>
    <Group className={searchClasses.filterHeader} justify="space-between">
      <Text fw={700}>조회조건</Text>
      <ActionIcon variant="subtle" color="gray" size="sm" aria-label="조회조건 닫기" onClick={onClose}><IconX size={15} /></ActionIcon>
    </Group>
    <Stack className={searchClasses.filterFields} gap="sm">{children}</Stack>
  </Paper>;
}

// 두 칸짜리 보기 전환 (규격별 합계 / 상세, 고객사별 / 품명별 ...)
const Switch = ({ items, value, onChange, label }) => <div className={classes.viewTabs} role="tablist" aria-label={label}>
  {items.map((item) => <button key={item.value} type="button" role="tab" aria-selected={value === item.value}
    className={`${classes.viewTab} ${value === item.value ? classes.viewTabActive : ''}`} onClick={() => onChange(item.value)}>{item.label}</button>)}
</div>;

export default function SharedStock() {
  const [tab, setTab] = useState('stock');
  const [filterOpen, setFilterOpen] = useState(true);
  // 재고 현황
  const [inputs, setInputs] = useState(stockDefaults);
  const [filters, setFilters] = useState(stockDefaults);
  const [stockView, setStockView] = useState('grouped');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [list, setList] = useState({ items: [], total: 0, lot_total: 0, total_weight: 0, companies: [] });
  const [loading, setLoading] = useState(false);
  const requestRef = useRef(0);
  // 재고 추이
  const [trendInputs, setTrendInputs] = useState(trendDefaults);
  const [trendFilters, setTrendFilters] = useState(trendDefaults);
  const [axis, setAxis] = useState('company');
  const [trendView, setTrendView] = useState('ending');
  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const summaryRef = useRef(0);

  const clean = (values) => Object.fromEntries(Object.entries(values).filter(([, value]) => value));
  const params = useCallback((extra = {}) => ({ ...clean(filters), grouped: stockView === 'grouped' || undefined, ...extra }), [filters, stockView]);

  const loadList = useCallback(async () => {
    const id = ++requestRef.current;
    setLoading(true);
    try {
      const response = await axios.get('/api/shared-stock/items', { ...authConfig(), params: params({ page, page_size: pageSize }) });
      if (id === requestRef.current) setList(response.data);
    } catch (error) {
      if (id === requestRef.current) notifications.show({ title: '타사 재고 조회 실패', message: apiErrorMessage(error, '타사 재고를 불러오지 못했습니다.'), color: 'red' });
    } finally {
      if (id === requestRef.current) setLoading(false);
    }
  }, [page, pageSize, params]);

  const loadSummary = useCallback(async () => {
    const id = ++summaryRef.current;
    setSummaryLoading(true);
    try {
      const response = await axios.get('/api/shared-stock/summary', { ...authConfig(), params: clean(trendFilters) });
      if (id === summaryRef.current) setSummary(response.data);
    } catch (error) {
      if (id === summaryRef.current) notifications.show({ title: '재고 추이 조회 실패', message: apiErrorMessage(error, '재고 추이를 불러오지 못했습니다.'), color: 'red' });
    } finally {
      if (id === summaryRef.current) setSummaryLoading(false);
    }
  }, [trendFilters]);

  useEffect(() => { void loadList(); }, [loadList]);
  useEffect(() => { if (tab === 'trend') void loadSummary(); }, [tab, loadSummary]);
  usePageReactivated(() => { if (tab === 'trend') void loadSummary(); else void loadList(); });

  const search = useCallback(() => {
    const source = tab === 'stock' ? inputs : trendInputs;
    if (source.date_from && source.date_to && source.date_from > source.date_to) {
      notifications.show({ title: '조회조건 확인', message: '기간 시작일은 종료일보다 뒤일 수 없습니다.', color: 'orange' });
      return;
    }
    const trimmed = Object.fromEntries(Object.entries(source).map(([key, value]) => [key, String(value || '').trim()]));
    if (tab === 'stock') { setFilters(trimmed); setPage(1); } else setTrendFilters(trimmed);
  }, [inputs, tab, trendInputs]);
  const bind = (setter) => (key) => (event) => { const { value } = event.currentTarget; setter((current) => ({ ...current, [key]: value })); };
  const setStockInput = bind(setInputs);
  const setTrendInput = bind(setTrendInputs);
  const enter = (event) => { if (event.key === 'Enter') search(); };

  // 엑셀: 재고 현황(규격별 합계 · 상세, 지금 조건) + 재고 추이(지금 조건, 고객사별 · 품명별)
  const exportExcel = useCallback(async () => {
    try {
      const [groupedResponse, lotResponse, trendResponse] = await Promise.all([
        axios.get('/api/shared-stock/items', { ...authConfig(), params: { ...clean(filters), grouped: true, export: true } }),
        axios.get('/api/shared-stock/items', { ...authConfig(), params: { ...clean(filters), export: true } }),
        axios.get('/api/shared-stock/summary', { ...authConfig(), params: clean(trendFilters) }),
      ]);
      const XLSX = await loadXLSXOrNotify();
      if (!XLSX) return;
      const workbook = XLSX.utils.book_new();
      const addSheet = (rows, name) => {
        if (!rows.length) return;
        const sheet = XLSX.utils.json_to_sheet(rows);
        applyExcelHeaderStyle(sheet, Object.keys(rows[0]).length);
        fitExcelSheet(sheet, rows, XLSX);
        XLSX.utils.book_append_sheet(workbook, sheet, name);
      };
      addSheet(groupedResponse.data.items.map((row) => ({
        고객사: row.companyname, 품명: row.itemname, 강종: row.materialname, 표면: row.surfacename, 두께: toNumber(row.thickness), 폭: toNumber(row.width), 길이: toNumber(row.length),
        현재수량: toNumber(row.qty), 수량단위: row.qtyunit || '', '현재중량(KG)': toNumber(row.weight), '최초 입고일': dateText(row.first_date), '최근 입고일': dateText(row.last_date),
        '최장 재고일수': row.max_days === null || row.max_days === undefined ? '' : toNumber(row.max_days),
      })), '재고 현황(규격별 합계)');
      addSheet(lotResponse.data.items.map((row) => ({
        고객사: row.companyname, 재고구분: KIND_NAME[row.stockkind] || '', 입고일자: dateText(row.receiptdate), 품명: row.itemname, 강종: row.materialname,
        표면: row.surfacename, '도금량(g/㎡)': row.myrtle === null || row.myrtle === undefined || row.myrtle === '' ? '' : toNumber(row.myrtle), 두께: toNumber(row.thickness), 폭: toNumber(row.width), 길이: toNumber(row.length),
        현재수량: toNumber(row.qty), '현재중량(KG)': toNumber(row.weight), 제품번호: row.productname || '', 최초수량: toNumber(row.originalqty),
        '최초중량(KG)': toNumber(row.originalweight), 수량단위: row.qtyunit || '', 재고일수: row.days === null || row.days === undefined ? '' : toNumber(row.days),
      })), '재고 현황(상세)');
      const trend = trendResponse.data;
      const trendSheet = (key, by) => (by === 'company' ? trend.companies : (trend.items || [])).flatMap((row) => [row, ...(row.children || [])].map((part, index) => ({
        [by === 'company' ? '고객사' : '품명']: by === 'company' ? row.companyname : row.itemname,
        [by === 'company' ? '품명' : '고객사']: index === 0 ? '(합계)' : part.name,
        '현재 재고(kg)': Math.round(toNumber(part.weight)),
        ...Object.fromEntries(trend.months.map((month, monthIndex) => [month, Math.round(toNumber(part[key][monthIndex]))])),
      })));
      addSheet(trendSheet('ending', 'company'), '월말 재고(고객사별)');
      addSheet(trendSheet('ending', 'item'), '월말 재고(품명별)');
      addSheet(trendSheet('inbound', 'item'), '입고(품명별)');
      addSheet(trendSheet('outbound', 'item'), '판매 출고(품명별)');
      if (!workbook.SheetNames.length) { notifications.show({ title: '엑셀 데이터 없음', message: '내려받을 재고가 없습니다.', color: 'orange' }); return; }
      XLSX.writeFile(workbook, `타사재고현황_${todayText().replaceAll('-', '')}.xlsx`);
      if (lotResponse.data.truncated) notifications.show({ title: '엑셀 일부만 저장', message: `재고가 많아 앞의 ${lotResponse.data.page_size.toLocaleString('ko-KR')}건만 저장했습니다. 고객사나 조건으로 줄여 주세요.`, color: 'orange' });
    } catch (error) {
      notifications.show({ title: '엑셀 저장 실패', message: apiErrorMessage(error, '엑셀을 만들지 못했습니다.'), color: 'red' });
    }
  }, [filters, trendFilters]);

  useErpPageRibbon({ onSearch: search, onExcel: exportExcel, showExcel: true, useSaveColor: false });

  const companyOptions = [{ value: '', label: '전체 고객사' }, ...(list.companies || []).map((row) => ({ value: row.companyid, label: row.companyname }))];
  const pageCount = Math.max(1, Math.ceil(toNumber(list.total) / pageSize));
  const columns = stockView === 'grouped' ? GROUPED_COLUMNS : LOT_COLUMNS;
  const noOpenCompany = !(list.companies || []).length;
  const pickCompany = (setterInputs, setterFilters, afterChange) => (value) => {
    const next = value || '';
    setterInputs((current) => ({ ...current, companyid: next }));
    setterFilters((current) => ({ ...current, companyid: next }));
    afterChange?.();
  };

  return <Box className={`${simpleTheme.simple} ${sharedClasses.pageShell} ${searchClasses.page} ${classes.page}`}>
    <ErpBreadcrumb parent="관리" current="타사재고 현황" filterOpen={filterOpen} onOpenFilters={() => setFilterOpen(true)} />

    {/* 탭: 매출등록 상세 탭(매출 상세 · 기타비용)과 같은 모양 */}
    <div className={`${outboundClasses.detailTabsBar} ${classes.tabBar}`} role="tablist" aria-label="보기">
      {TABS.map((item) => <button key={item.value} type="button" role="tab" aria-selected={tab === item.value}
        className={tab === item.value ? outboundClasses.detailTabActive : outboundClasses.detailTab} onClick={() => setTab(item.value)}>{item.label}</button>)}
    </div>

    <Box className={`${searchClasses.inboundWorkspace} ${classes.workspace}`}>
      {filterOpen && (tab === 'stock' ? <FilterPanel onClose={() => setFilterOpen(false)}>
        <Select label="고객사" data={companyOptions} value={inputs.companyid} allowDeselect={false} onChange={pickCompany(setInputs, setFilters, () => setPage(1))} />
        <Select label="재고구분" data={KIND_OPTIONS} value={inputs.sourcetype} allowDeselect={false} onChange={(value) => setInputs((current) => ({ ...current, sourcetype: value || '' }))} />
        <Box>
          <Text className={searchClasses.filterGroupLabel}>기간</Text>
          <Stack gap={6}>
            <ErpDateInput type="date" aria-label="기간 시작일" value={inputs.date_from} onChange={setStockInput('date_from')} />
            <ErpDateInput type="date" aria-label="기간 종료일" value={inputs.date_to} onChange={setStockInput('date_to')} />
          </Stack>
        </Box>
        <TextInput label="품명" placeholder="품목코드 또는 품명" value={inputs.item_search} onChange={setStockInput('item_search')} onKeyDown={enter} />
        <TextInput label="강종" placeholder="강종 검색" value={inputs.material_search} onChange={setStockInput('material_search')} onKeyDown={enter} />
        <TextInput label="표면" placeholder="표면 검색" value={inputs.surface_search} onChange={setStockInput('surface_search')} onKeyDown={enter} />
        <TextInput label="제품번호" placeholder="제품번호 검색" value={inputs.product_search} onChange={setStockInput('product_search')} onKeyDown={enter} />
        <TextInput label="두께" placeholder="두께 검색" value={inputs.thickness} onChange={setStockInput('thickness')} onKeyDown={enter} />
        <TextInput label="폭" placeholder="폭 검색" value={inputs.width} onChange={setStockInput('width')} onKeyDown={enter} />
        <TextInput label="길이" placeholder="길이 검색" value={inputs.length} onChange={setStockInput('length')} onKeyDown={enter} />
      </FilterPanel> : <FilterPanel onClose={() => setFilterOpen(false)}>
        <Select label="고객사" data={companyOptions} value={trendInputs.companyid} allowDeselect={false} onChange={pickCompany(setTrendInputs, setTrendFilters)} />
        <Box>
          <Text className={searchClasses.filterGroupLabel}>기간</Text>
          <Stack gap={6}>
            <ErpDateInput type="date" aria-label="기간 시작일" value={trendInputs.date_from} onChange={setTrendInput('date_from')} />
            <ErpDateInput type="date" aria-label="기간 종료일" value={trendInputs.date_to} onChange={setTrendInput('date_to')} />
          </Stack>
        </Box>
        <TextInput label="품명" placeholder="품목코드 또는 품명" value={trendInputs.item_search} onChange={setTrendInput('item_search')} onKeyDown={enter} />
        <TextInput label="강종" placeholder="강종 검색" value={trendInputs.material_search} onChange={setTrendInput('material_search')} onKeyDown={enter} />
        <TextInput label="표면" placeholder="표면 검색" value={trendInputs.surface_search} onChange={setTrendInput('surface_search')} onKeyDown={enter} />
        <TextInput label="제품번호" placeholder="제품번호 검색" value={trendInputs.product_search} onChange={setTrendInput('product_search')} onKeyDown={enter} />
        <TextInput label="두께" placeholder="두께 검색" value={trendInputs.thickness} onChange={setTrendInput('thickness')} onKeyDown={enter} />
        <TextInput label="폭" placeholder="폭 검색" value={trendInputs.width} onChange={setTrendInput('width')} onKeyDown={enter} />
        <TextInput label="길이" placeholder="길이 검색" value={trendInputs.length} onChange={setTrendInput('length')} onKeyDown={enter} />
      </FilterPanel>)}

      <Paper className={`${sharedClasses.panel} ${searchClasses.resultsPanel}`} withBorder>
        {tab === 'stock' ? <>
          <Group className={searchClasses.resultsToolbar} justify="space-between" wrap="wrap">
            <Box className={searchClasses.toolbarTitle}>
              <Text className={searchClasses.sectionTitle} fw={700}>재고 내역</Text>
              <Badge color="gray" variant="light">{toNumber(list.total).toLocaleString('ko-KR')}건</Badge>
            </Box>
            <Switch items={STOCK_VIEWS} value={stockView} onChange={(value) => { if (value === stockView) return; setList((current) => ({ ...current, items: [] })); setStockView(value); setPage(1); }} label="재고 보기" />
          </Group>
          <Box className={searchClasses.tableWrap}>
            {loading && <Box className={searchClasses.loadingOverlay}><Loader color="red" size="sm" /></Box>}
            <div className={classes.stockScroll}>
              <StockTable key={stockView} rows={list.items} columns={columns} rowOffset={(page - 1) * pageSize}
                emptyText={loading ? '불러오는 중…' : noOpenCompany ? "재고를 공개한 고객사가 없습니다. 고객사등록에서 '재고 공개'를 공개로 바꾸면 여기에 보입니다." : '조회된 재고가 없습니다. 기간이나 조회조건을 바꿔 다시 조회해 보세요.'} />
            </div>
          </Box>
          <Group className={searchClasses.paginationBar} justify="space-between" wrap="wrap">
            <Group gap="xs"><Text size="xs" c="dimmed">총 {toNumber(list.total).toLocaleString('ko-KR')}건</Text>
              <Select size="xs" w={105} data={PAGE_OPTIONS} value={String(pageSize)} allowDeselect={false} onChange={(value) => { setPageSize(Number(value)); setPage(1); }} /></Group>
            <Pagination size="sm" color="red" value={Math.min(page, pageCount)} onChange={setPage} total={pageCount} withEdges />
          </Group>
        </> : <>
          <Group className={searchClasses.resultsToolbar} justify="space-between" wrap="wrap">
            <Box className={searchClasses.toolbarTitle}>
              <Text className={searchClasses.sectionTitle} fw={700}>재고 추이</Text>
            </Box>
            <div className={classes.trendTools}>
              <Switch items={AXES} value={axis} onChange={setAxis} label="묶는 기준" />
              <Switch items={TREND_VIEWS} value={trendView} onChange={setTrendView} label="지표" />
            </div>
          </Group>
          <Box className={searchClasses.tableWrap}>
            {summaryLoading && <Box className={searchClasses.loadingOverlay}><Loader color="red" size="sm" /></Box>}
            {summary ? <div className={classes.stockScroll}><TrendTable key={`${axis}:${JSON.stringify(trendFilters)}`} data={summary} axis={axis} view={trendView} /></div> : null}
          </Box>
        </>}
      </Paper>
    </Box>
  </Box>;
}
