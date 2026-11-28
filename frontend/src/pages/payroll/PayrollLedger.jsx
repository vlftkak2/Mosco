// 급여대장 (메뉴: PAYROLL_LEDGER, 보이는 권한은 급여입력 PAYROLL 과 같음) — 급여를 항목별로 한눈에 보고 엑셀로 내려받는다.
// 위: [월별 | 연간] 전환
//   월별 = ‹ 2026년 11월 › 로 한 달씩
//   연간 = 시작월 ~ 끝월(대시보드 조회기간 칸과 같은 모양) + [조회] → 년-월별 급여 줄 + 월마다 소계 + 기간 합계
// 아래: 합계 요약 / 검색 · 전체항목보기 · 부서별 집계 / 표(사원번호 · 사원명 왼쪽 고정, 머리 누르면 정렬, 오른쪽 끝 끌면 너비 조절)
// 지급항목은 금액이 있는 것만 ('전체항목보기'면 급여입력 > 지급항목 설정에서 고른 항목까지)
// 서버: backend/services/payroll/Payroll.py (list_slips · period_ledger — 자기 회사 급여만)
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Box, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import useErpPageRibbon from '../../components/common/useErpPageRibbon';
import usePageReactivated from '../../components/common/usePageReactivated';
import { ColumnResizeHandle, pickerClasses, useResizableColumns } from '../../components/common/PickerModal';
import { apiErrorMessage } from '../../utils/apiError';
import sharedClasses from '../../styles/pages/ManagementShared.module.css';
import simpleTheme from '../../styles/pages/SimpleTheme.module.css';
import classes from '../../styles/pages/User.module.css';
import pc from '../../styles/pages/Payroll.module.css';
import dk from '../../styles/components/DashboardKit.module.css';   // 기간 칸 · 조회 버튼: 대시보드와 같은 모양
import { DED_ITEMS, PAY_ITEMS, WORKTYPE_LABELS, authConfig, kstToday, printPayslip, won, yymmdd, ymLabel } from './payrollCommon';

const FIXED_COLUMNS = [   // 왼쪽 고정
  { key: 'empno', label: '사원번호', width: 86 },
  { key: 'username', label: '사원명', width: 80 },
];
const MONTH_INFO = [
  { key: 'team', label: '부서', width: 90 },
  { key: 'position', label: '직급', width: 64 },
  { key: 'worktype', label: '근무유형', width: 70, format: (v) => WORKTYPE_LABELS[v] || '' },
  { key: 'birthdate', label: '생년월일', width: 76, format: yymmdd },
  { key: 'hiredate', label: '입사일', width: 92 },
  { key: 'paydate', label: '지급일', width: 92 },
];
const PAYYM_COLUMN = { key: 'payym', label: '귀속월', width: 84 };   // 연간(기간): 맨 왼쪽에 고정
const PERIOD_INFO = [
  { key: 'team', label: '부서', width: 90 },
  { key: 'position', label: '직급', width: 64 },
  { key: 'worktype', label: '근무유형', width: 70, format: (v) => WORKTYPE_LABELS[v] || '' },
  { key: 'paydate', label: '지급일', width: 92 },
];
const SUM_COLUMNS = [
  { key: 'pay_total', label: '지급액', width: 108, money: true },
  { key: 'ded_total', label: '공제합계', width: 102, money: true },
  { key: 'net_pay', label: '실지급액', width: 112, money: true },
];
const TAIL_COLUMNS = [
  { key: 'bankname', label: '은행', width: 80 },
  { key: 'accountno', label: '계좌번호', width: 130 },
  { key: 'remark', label: '적요', width: 160 },
  { key: 'slip', label: '명세서', width: 66 },
];
// 항목 칸 너비: 머리 글자(+ 정렬 표시 · 너비 조절 손잡이)가 잘리지 않게 글자 수에 맞춘다
const fitWidth = (label, min = 96) => Math.max(min, label.length * 14 + 40);
const PAY_COLS = PAY_ITEMS.map((c) => ({ ...c, width: fitWidth(c.label), money: true }));
const DED_COLS = DED_ITEMS.map((c) => ({ ...c, width: fitWidth(c.label, 92), money: true }));
const ALL_COLUMNS = [PAYYM_COLUMN, ...FIXED_COLUMNS, ...MONTH_INFO, ...SUM_COLUMNS, ...PAY_COLS, ...DED_COLS, ...TAIL_COLUMNS];
const MONEY_KEYS = [...SUM_COLUMNS, ...PAY_COLS, ...DED_COLS].map((c) => c.key);
const addUp = (rows) => Object.fromEntries(MONEY_KEYS.map((key) => [key, rows.reduce((sum, row) => sum + Number(row[key] || 0), 0)]));
const cellText = (column, row) => (column.format ? column.format(row[column.key]) : row[column.key] ?? '');

const shiftYm = (payym, diff) => {
  const [year, month] = payym.split('-').map(Number);
  const date = new Date(year, month - 1 + diff, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};
// 기간 이름: 2026년 1월 ~ 11월 / 2025년 12월 ~ 2026년 2월
const periodLabel = (from, to) => (from.slice(0, 4) === to.slice(0, 4)
  ? `${from.slice(0, 4)}년 ${Number(from.slice(5))}월 ~ ${Number(to.slice(5))}월`
  : `${ymLabel(from)} ~ ${ymLabel(to)}`);

export default function PayrollLedger() {
  const today = kstToday();
  const [mode, setMode] = useState('month');   // month 월별 · period 연간(기간)
  const [payym, setPayym] = useState(() => today.slice(0, 7));
  const [range, setRange] = useState(() => ({ from: `${today.slice(0, 4)}-01`, to: today.slice(0, 7) }));   // 입력 중인 기간
  const [shownRange, setShownRange] = useState(null);   // 조회한 기간 (표에 보이는 것)
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [byTeam, setByTeam] = useState(false);
  const [sort, setSort] = useState({ key: '', dir: 1 });
  const seq = useRef(0);
  const cols = useResizableColumns(ALL_COLUMNS);

  const load = useCallback(async (view) => {
    const my = ++seq.current;
    setLoading(true);
    try {
      const { data: result } = view.mode === 'period'
        ? await axios.get('/api/payroll/ledger-period', { ...authConfig(), params: { from_ym: view.from, to_ym: view.to } })
        : await axios.get('/api/payroll/slips', { ...authConfig(), params: { payym: view.payym } });
      if (my !== seq.current) return;
      setData(result);
      if (view.mode === 'period') setShownRange({ from: view.from, to: view.to });
    } catch (error) {
      if (my === seq.current) notifications.show({ title: '급여대장 조회 실패', message: apiErrorMessage(error, '급여대장을 불러오지 못했습니다.'), color: 'red' });
    } finally { if (my === seq.current) setLoading(false); }
  }, []);
  const viewRef = useRef(null);
  viewRef.current = mode === 'period' ? { mode, ...(shownRange || range) } : { mode, payym };
  const reload = useCallback(() => { void load(viewRef.current); }, [load]);
  useEffect(() => { void load({ mode: 'month', payym: today.slice(0, 7) }); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  usePageReactivated(reload);

  const changeYm = (value) => { if (value) { setPayym(value); void load({ mode: 'month', payym: value }); } };
  const searchPeriod = (next = range) => {
    if (!next.from || !next.to) { notifications.show({ title: '기간 확인', message: '시작월과 끝월을 입력해 주세요.', color: 'red' }); return; }
    if (next.from > next.to) { notifications.show({ title: '기간 확인', message: '시작월이 끝월보다 늦습니다.', color: 'red' }); return; }
    setRange(next);
    void load({ mode: 'period', ...next });
  };
  const changeMode = (next) => {
    if (next === mode) return;
    setMode(next);
    setData(null);
    setSort({ key: '', dir: 1 });
    if (next === 'period') searchPeriod(shownRange || range);
    else void load({ mode: 'month', payym });
  };
  const isPeriod = mode === 'period';
  const fixedColumns = isPeriod ? [PAYYM_COLUMN, ...FIXED_COLUMNS] : FIXED_COLUMNS;
  const infoColumns = isPeriod ? PERIOD_INFO : MONTH_INFO;
  const tailColumns = TAIL_COLUMNS;
  const title = isPeriod ? `${shownRange ? periodLabel(shownRange.from, shownRange.to) : ''} 급여대장` : `${ymLabel(payym)} 급여대장`;

  const items = useMemo(() => data?.items || [], [data]);
  const total = useMemo(() => addUp(items), [items]);
  // 검색 · 정렬
  const rows = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    const found = q ? items.filter((r) => [r.username, r.empno, r.team, r.position].some((v) => String(v || '').toLowerCase().includes(q))) : items;
    if (!sort.key) return found;
    const money = MONEY_KEYS.includes(sort.key);
    return [...found].sort((a, b) => (money ? (Number(a[sort.key] || 0) - Number(b[sort.key] || 0))
      : String(a[sort.key] ?? '').localeCompare(String(b[sort.key] ?? ''), 'ko', { numeric: true })) * sort.dir);
  }, [items, keyword, sort]);
  const shownTotal = useMemo(() => addUp(rows), [rows]);

  // 지급항목: 금액이 있는 항목 + (전체항목보기면) 지급항목 설정에서 고른 항목 / 공제항목: 금액이 있는 항목 (전체항목보기면 모두)
  const enabledPay = data?.pay_items || PAY_ITEMS.map((i) => i.key);
  const widen = (c) => (isPeriod ? { ...c, width: Math.max(c.width, 120) } : c);   // 기간 합계 줄은 금액이 커서 칸을 조금 넓힌다
  const payCols = PAY_COLS.filter((c) => total[c.key] !== 0 || (showAll && enabledPay.includes(c.key))).map(widen);
  const dedCols = DED_COLS.filter((c) => showAll || total[c.key] !== 0).map(widen);
  const leftColumns = [...fixedColumns, ...infoColumns, ...SUM_COLUMNS.map(widen)];
  const columns = [...leftColumns, ...payCols, ...dedCols, ...tailColumns];
  const tableWidth = columns.reduce((s, c) => s + cols.widthOf(c), 0);
  const stickyLeft = (i) => fixedColumns.slice(0, i).reduce((s, c) => s + cols.widthOf(c), 0);

  // 줄: 연간 = 귀속월마다 직원 줄 + 그 달 소계 / 월별 = 직원 줄 (+ 부서별 집계면 부서마다 소계)
  const lines = useMemo(() => {
    const groupBy = (keyOf, labelOf, order) => {
      const groups = new Map();
      rows.forEach((row) => { const key = keyOf(row); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(row); });
      return [...groups.entries()].sort(([a], [b]) => order(a, b)).flatMap(([key, list]) => [
        ...list.map((row) => ({ type: 'row', row })),
        { type: 'sub', key, label: labelOf(key), count: list.length, row: addUp(list) },
      ]);
    };
    if (isPeriod) return groupBy((row) => row.payym, (ym) => ym, (a, b) => a.localeCompare(b));   // 귀속월 칸에 2026-09, 옆 칸에 '소계'
    if (!byTeam) return rows.map((row) => ({ type: 'row', row }));
    return groupBy((row) => row.team || '(부서 없음)', (team) => `${team} 소계`, (a, b) => a.localeCompare(b, 'ko'));
  }, [byTeam, isPeriod, rows]);
  const people = useMemo(() => new Set(items.map((i) => i.useremail)).size, [items]);

  const toggleSort = (column) => {
    if (column.key === 'slip') return;
    setSort((cur) => (cur.key !== column.key ? { key: column.key, dir: 1 } : cur.dir === 1 ? { key: column.key, dir: -1 } : { key: '', dir: 1 }));
  };

  // 엑셀 라이브러리(약 300KB)는 화면을 열 때가 아니라 [엑셀]을 누를 때 받는다 → 메뉴를 누르면 바로 열림 (만드는 파일은 예전과 같음)
  const exportExcel = async () => {
    if (!rows.length) return;
    let XLSX;
    try {
      const mod = await import('xlsx-js-style');
      XLSX = mod.default || mod;
    } catch {
      notifications.show({ title: '엑셀 기능을 불러오지 못했습니다', message: '네트워크를 확인한 뒤 다시 시도해 주세요.', color: 'red' });
      return;
    }
    const moneyCols = [...SUM_COLUMNS, ...payCols, ...dedCols];
    const textCols = [...fixedColumns, ...infoColumns];
    const tailCols = tailColumns.filter((c) => c.key !== 'slip');
    const header1 = [...textCols.map((c) => c.label), ...SUM_COLUMNS.map((c) => c.label), ...payCols.map(() => '지급항목'), ...dedCols.map(() => '공제항목'), ...tailCols.map((c) => c.label)];
    const header2 = [...textCols.map(() => ''), ...SUM_COLUMNS.map(() => ''), ...payCols.map((c) => c.label), ...dedCols.map((c) => c.label), ...tailCols.map(() => '')];
    const money = (row) => moneyCols.map((c) => Number(row[c.key] || 0));
    const blankText = textCols.map(() => '');
    const body = lines.map((line) => (line.type === 'sub'
      ? [`${line.label}${isPeriod ? ' 소계' : ''} (${line.count}명)`, ...blankText.slice(1), ...money(line.row), ...tailCols.map(() => '')]
      : [...textCols.map((c) => cellText(c, line.row)), ...money(line.row), ...tailCols.map((c) => line.row[c.key] || '')]));
    const sheet = XLSX.utils.aoa_to_sheet([[title], [], header1, header2, ...body, ['합계', ...blankText.slice(1), ...money(shownTotal), ...tailCols.map(() => '')]]);
    const moneyStart = textCols.length;
    const moneyEnd = moneyStart + moneyCols.length;
    Object.keys(sheet).forEach((ref) => {
      if (ref.startsWith('!')) return;
      const { r, c } = XLSX.utils.decode_cell(ref);
      if (r === 0) sheet[ref].s = { font: { bold: true, sz: 14 } };
      else if (r === 2 || r === 3) sheet[ref].s = { font: { bold: true }, fill: { fgColor: { rgb: 'F3F4F6' } }, alignment: { horizontal: 'center' } };
      else if (c >= moneyStart && c < moneyEnd && typeof sheet[ref].v === 'number') sheet[ref].z = '#,##0';
    });
    sheet['!cols'] = header1.map((_, i) => ({ wch: i < moneyStart ? 11 : i < moneyEnd ? 13 : 16 }));
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, '급여대장');
    XLSX.writeFile(book, isPeriod && shownRange
      ? `급여대장_${shownRange.from.replace('-', '')}-${shownRange.to.replace('-', '')}.xlsx`
      : `급여대장_${payym.replace('-', '')}.xlsx`);
  };
  const printSlip = (row) => {
    if (!printPayslip(row)) notifications.show({ title: '명세서 인쇄', message: '팝업이 막혀 있습니다. 브라우저에서 팝업을 허용해 주세요.', color: 'red' });
  };

  useErpPageRibbon({ onSearch: () => (isPeriod ? searchPeriod() : reload()), onExcel: rows.length ? exportExcel : undefined, showExcel: true, showPrint: false });

  const head = (column, extra = {}) => {
    const fixedIndex = fixedColumns.findIndex((c) => c.key === column.key);
    const mark = sort.key === column.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : '';
    return <th key={column.key} {...extra} onClick={() => toggleSort(column)} title={column.key === 'slip' ? undefined : '눌러서 정렬'}
      className={`${pickerClasses.resizableHead} ${extra.className || ''} ${fixedIndex >= 0 ? pc.stickyCol : ''} ${column.key === 'slip' ? '' : pc.sortable}`}
      style={fixedIndex >= 0 ? { left: stickyLeft(fixedIndex), zIndex: 4 } : undefined}>
      {column.label}<span className={pc.sortMark}>{mark}</span><ColumnResizeHandle column={column} columns={cols} />
    </th>;
  };
  const fixedCell = (column, i, content, className = '') => <td key={column.key} className={`${pc.stickyCol} ${className}`} style={{ left: stickyLeft(i) }}>{content}</td>;
  const moneyCells = (row) => [...SUM_COLUMNS, ...payCols, ...dedCols].map((c) => <td key={c.key} className={pc.num}>
    {c.key === 'net_pay' ? <b>{won(row[c.key])}</b> : row[c.key] || SUM_COLUMNS.some((s) => s.key === c.key) ? won(row[c.key]) : ''}
  </td>);
  const months = data?.months || [];
  const closedCount = months.filter((m) => m.closed).length;
  const rangeChanged = isPeriod && shownRange && (range.from !== shownRange.from || range.to !== shownRange.to);

  return <Box className={`${simpleTheme.simple} ${simpleTheme.noIcons} ${sharedClasses.pageShell} ${classes.page}`}>
    <Box component="nav" className={classes.breadcrumb}>
      <Text component="span" className={classes.breadcrumbParent}>급여관리</Text>
      <Text component="span" className={classes.breadcrumbChevron}>›</Text>
      <Text component="span" className={classes.breadcrumbCurrent}>급여대장</Text>
    </Box>

    <section className={pc.monthCard}>
      <div className={pc.monthTop}>
        {/* 월별 · 연간: 남색 바탕이 고른 쪽으로 미끄러진다 */}
        <div className={`${pc.slideSeg} ${isPeriod ? pc.slideSegRight : ''}`} role="radiogroup" aria-label="보기">
          <span className={pc.slideThumb} aria-hidden="true" />
          {[['month', '월별'], ['period', '연간']].map(([key, label]) => <button key={key} type="button" role="radio" aria-checked={mode === key}
            className={mode === key ? pc.slideOn : ''} onClick={() => changeMode(key)}>{label}</button>)}
        </div>
        {isPeriod
          ? <div className={pc.periodBar}>
            <div className={`${dk.rangeBox} ${pc.monthRange}`}>
              <input type="month" aria-label="시작월" value={range.from} onChange={(e) => { const from = e.currentTarget.value; setRange((r) => ({ ...r, from })); }}
                onKeyDown={(e) => { if (e.key === 'Enter') searchPeriod(); }} />
              <span className={dk.rangeDash}>–</span>
              <input type="month" aria-label="끝월" value={range.to} onChange={(e) => { const to = e.currentTarget.value; setRange((r) => ({ ...r, to })); }}
                onKeyDown={(e) => { if (e.key === 'Enter') searchPeriod(); }} />
            </div>
            <button type="button" className={dk.goButton} onClick={() => searchPeriod()} disabled={loading}>
              {loading ? <span className={dk.goSpinner} aria-hidden="true" /> : null}조회
            </button>
            {rangeChanged && <span className={pc.rangeHint}>기간을 바꿨습니다. [조회]를 눌러 주세요.</span>}
          </div>
          : <div className={pc.monthNav}>
            <button type="button" className={pc.navBtn} onClick={() => changeYm(shiftYm(payym, -1))} aria-label="이전 달">‹</button>
            <label className={pc.monthPick}>
              <span>{title}</span>
              <input type="month" value={payym} onChange={(event) => changeYm(event.currentTarget.value)} aria-label="귀속년월" />
            </label>
            <button type="button" className={pc.navBtn} onClick={() => changeYm(shiftYm(payym, 1))} aria-label="다음 달">›</button>
          </div>}
      </div>
      <dl className={pc.kpis}>
        <div><dt>{isPeriod ? '기간' : '인원'}</dt>{isPeriod
          ? <dd className={pc.kpiText}>{shownRange ? periodLabel(shownRange.from, shownRange.to) : '-'}<small>{people}명</small></dd>
          : <dd>{items.length}<small>명</small></dd>}</div>
        <div><dt>지급 합계</dt><dd>{won(total.pay_total)}<small>원</small></dd></div>
        <div><dt>공제 합계</dt><dd>{won(total.ded_total)}<small>원</small></dd></div>
        <div className={pc.kpiNet}><dt>실지급액 합계</dt><dd>{won(total.net_pay)}<small>원</small></dd></div>
        {isPeriod
          ? <div><dt>마감 현황</dt>{!months.length ? <dd className={pc.kpiText}>-</dd>
            : closedCount === months.length ? <dd className={pc.kpiText}>모두 마감<small>{months.length}개월</small></dd>
              : <dd className={pc.kpiText}>{closedCount} / {months.length}개월</dd>}</div>
          : <div><dt>상태</dt><dd className={data?.closed ? pc.closedText : ''}>{!items.length ? '미작성' : data?.closed ? '마감' : '작성중'}</dd></div>}
      </dl>
    </section>

    <div className={pc.ledgerPane}>
      <div className={pc.ledgerHead}>
        <input className={`${pc.filterInput} ${pc.search}`} placeholder="이름 · 사원번호 · 부서 · 직급 검색" value={keyword} onChange={(event) => setKeyword(event.currentTarget.value)} aria-label="검색" />
        <label className={pc.check}><input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.currentTarget.checked)} />전체항목보기</label>
        {!isPeriod && <label className={pc.check}><input type="checkbox" checked={byTeam} onChange={(event) => setByTeam(event.currentTarget.checked)} />부서별 집계</label>}
      </div>
      <div className={`${pc.gridWrap} ${pc.fadeIn}`} key={isPeriod ? `period:${shownRange?.from}:${shownRange?.to}` : `month:${payym}`}>   {/* 보기를 바꾸면 표가 부드럽게 나타난다 */}
        <table className={`${pc.grid} ${pc.ledgerGrid}`} style={{ width: `max(100%, ${tableWidth}px)` }}>
          <colgroup>{columns.map((c) => <col key={c.key} data-column-key={c.key} style={{ width: cols.widthOf(c) }} />)}</colgroup>
          <thead>
            <tr>
              {leftColumns.map((c) => head(c, { rowSpan: 2 }))}
              {payCols.length > 0 && <th colSpan={payCols.length} className={pc.groupPay}>지급항목</th>}
              {dedCols.length > 0 && <th colSpan={dedCols.length} className={pc.groupDed}>공제항목</th>}
              {tailColumns.map((c) => head(c, { rowSpan: 2 }))}
            </tr>
            <tr>
              {payCols.map((c) => head(c, { className: pc.groupPay }))}
              {dedCols.map((c) => head(c, { className: pc.groupDed }))}
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (line.type === 'sub'
              ? <tr key={`sub:${line.key}`} className={pc.subtotal}>
                {fixedColumns.map((c, i) => fixedCell(c, i, i === 0 ? line.label : i === fixedColumns.length - 1 ? `${line.count}명` : '소계', i ? pc.center : pc.nowrapCell))}
                <td colSpan={infoColumns.length} />{moneyCells(line.row)}<td colSpan={tailColumns.length} />
              </tr>
              : <tr key={`${line.row.payym}:${line.row.useremail}`} className={line.row.pay_total <= 0 ? pc.faded : ''}>
                {fixedColumns.map((c, i) => fixedCell(c, i, c.key === 'username' ? <b className={pc.name}>{line.row.username}</b> : line.row[c.key], pc.center))}
                {infoColumns.map((c) => <td key={c.key} className={pc.center} title={String(cellText(c, line.row))}>{cellText(c, line.row)}</td>)}
                {moneyCells(line.row)}
                <td title={line.row.bankname}>{line.row.bankname}</td>
                <td title={line.row.accountno}>{line.row.accountno}</td>
                <td title={line.row.remark}>{line.row.remark}</td>
                <td className={pc.center}><button type="button" className={pc.linkBtn} onClick={() => printSlip(line.row)}>인쇄</button></td>
              </tr>))}
            {!rows.length && <tr><td colSpan={columns.length} className={pc.emptyCell}>
              {loading ? '조회 중...' : keyword ? '검색 결과가 없습니다.' : isPeriod ? '이 기간에 급여가 없습니다.' : '이 달 급여가 없습니다. 급여입력에서 먼저 만들어 주세요.'}
            </td></tr>}
          </tbody>
          {rows.length > 0 && <tfoot><tr>
            {fixedColumns.map((c, i) => fixedCell(c, i, i === 0 ? (isPeriod ? '기간 합계' : '합계') : i === fixedColumns.length - 1 ? `${isPeriod ? people : rows.length}명` : '', i ? pc.center : pc.nowrapCell))}
            <td colSpan={infoColumns.length} />{moneyCells(shownTotal)}<td colSpan={tailColumns.length} />
          </tr></tfoot>}
        </table>
      </div>
    </div>
  </Box>;
}
