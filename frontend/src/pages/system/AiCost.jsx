// AI 비용현황 (어드민 · 모스코 전용 메뉴 AI_COST) - 라이선스 매출현황과 같은 배치
// 자료: aiorderanalysis01t (AI 를 실제로 호출한 분석 기록). 비용은 분석마다 저장된 추정 비용(USD), 원화는 USD × 환율.
// (서버: services/masterdata/AiCost.py)
//  ① 요약 카드: 이번 달 AI 비용 · 이번 달 호출 · 사용 고객사 · 누적 비용
//  ② 월별 요약: 비용(USD) · 원화 환산 · 호출 · 실패 · 사용 고객사 · 건당 비용
//  ③ 고객사별 비용: 분기별 / 월별 · USD / 원화 · 이번 달 한도 대비 사용 · 12곳씩 페이지
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { loadXLSXOrNotify } from '../../utils/excelSafe';
import { Box, Loader, NumberInput, Pagination, Paper, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconBuildingSkyscraper, IconCalendarStats, IconCoin, IconSparkles } from '@tabler/icons-react';
import { CustomerPicker, DashboardHeader, KPI_PALETTE, PeriodFilter, useCustomerPicker, KpiCard, KpiGrid } from '../../components/common/DashboardKit';
import useErpPageRibbon from '../../components/common/useErpPageRibbon';
import usePageReactivated from '../../components/common/usePageReactivated';
import sharedClasses from '../../styles/pages/ManagementShared.module.css';
import searchClasses from '../../styles/pages/InboundSearch.module.css';
import simpleTheme from '../../styles/pages/SimpleTheme.module.css';
import classes from '../../styles/pages/LicenseRevenue.module.css';
import { applyExcelHeaderStyle } from '../../utils/excelHeaderStyle';
import { ColumnResizeHandle, pickerClasses, useResizableColumns } from '../../components/common/PickerModal';
import { apiErrorMessage } from '../../utils/apiError';
import { yearKST } from '../../utils/dateFormat';

const defaultPeriod = () => {
  const year = yearKST();
  return { date_from: `${year}-01-01`, date_to: `${year}-12-31` };
};
const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });
const toNumber = (value) => { const number = Number(value); return Number.isFinite(number) ? number : 0; };
const usd = (value, digits = 2) => `$${toNumber(value).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const krw = (value) => `${Math.round(toNumber(value)).toLocaleString('ko-KR')}원`;
const count = (value) => toNumber(value).toLocaleString('ko-KR');
const monthNo = (month) => Number(String(month).slice(5, 7));
const dot = (month) => String(month).replace('-', '.');
const RATE_KEY = 'mosco.aiCost.krwRate';
const readRate = () => { try { return Number(localStorage.getItem(RATE_KEY)) || null; } catch { return null; } };

function Section({ title, sub, tools, children, className = '' }) {
  return <Paper className={`${classes.panel} ${className}`} withBorder>
    <div className={classes.panelHead}>
      <Text className={classes.panelTitle}>{title}</Text>
      {sub && <Text className={classes.panelSub}>{sub}</Text>}
      {tools}
    </div>
    <div className={classes.panelBody}>{children}</div>
  </Paper>;
}
// 칸 너비 조절: 머리글 오른쪽 끝을 끌면 바뀌고 두 번 누르면 원래대로 (월 칸은 처음엔 모두 같은 너비)
// 순위 칸은 옆 고객사 칸의 고정 위치(left: 52px)가 어긋나지 않게 너비를 바꾸지 않는다.
const RANK = { key: 'rank', label: '순위', width: 52, fixed: true };
function ResizeHead({ column, cols, className = '', children, title }) {
  return <th className={`${className} ${column.fixed ? '' : pickerClasses.resizableHead}`} title={title}>
    {children}{column.fixed ? null : <ColumnResizeHandle column={column} columns={cols} />}
  </th>;
}
const ColGroup = ({ columns, cols }) => <colgroup>{columns.map((column) => <col key={column.key} data-column-key={column.key} style={{ width: cols.widthOf(column) }} />)}</colgroup>;
const gridStyle = (cols) => ({ width: `max(100%, ${cols.tableWidth}px)`, tableLayout: 'fixed' });
const Empty = ({ loading, text = '데이터가 없습니다.' }) => <div className={classes.empty}>{loading ? <Loader size="sm" color="red" /> : text}</div>;
const Tabs = ({ items, value, onChange, label }) => <div className={classes.viewTabs} role="tablist" aria-label={label}>
  {items.map((item) => <button key={item.value} type="button" role="tab" aria-selected={value === item.value}
    className={`${classes.viewTab} ${value === item.value ? classes.viewTabActive : ''}`} onClick={() => onChange(item.value)}>{item.label}</button>)}
</div>;

// ② 월별 요약 (월 = 열) · 이번 달은 진행 중
function SummaryTable({ data, rate }) {
  const { trend } = data;
  const columns = useMemo(() => [{ key: 'label', label: '구분', width: 130 }, ...trend.map((row) => ({ key: row.month, label: `${monthNo(row.month)}월`, width: 108 })),
    { key: 'total', label: '기간 합계', width: 130 }], [trend]);
  const cols = useResizableColumns(columns);
  const sum = (key) => trend.reduce((total, row) => total + toNumber(row[key]), 0);
  const rows = [
    { label: '추정 비용 (USD)', strong: true, cell: (row) => usd(row.cost), total: usd(sum('cost')) },
    { label: '원화 환산', cell: (row) => krw(row.cost * rate), total: krw(sum('cost') * rate) },
    { label: '호출 (성공)', cell: (row) => (row.calls ? `${count(row.calls)}회` : <span className={classes.zero}>-</span>), total: `${count(sum('calls'))}회` },
    { label: '실패', cell: (row) => (row.failed ? <span className={classes.down}>{count(row.failed)}회</span> : <span className={classes.zero}>-</span>), total: `${count(sum('failed'))}회` },
    { label: '사용 고객사', cell: (row) => (row.companies ? `${row.companies}곳` : <span className={classes.zero}>-</span>), total: '' },
    { label: '건당 비용', cell: (row) => (row.calls ? usd(row.cost / row.calls, 3) : <span className={classes.zero}>-</span>), total: sum('calls') ? usd(sum('cost') / sum('calls'), 3) : '' },
  ];
  return <div className={classes.summaryScroll}>
    <table className={`${classes.table} ${classes.summaryTable}`} style={gridStyle(cols)}>
      <ColGroup columns={columns} cols={cols} />
      <thead><tr>
        <ResizeHead column={columns[0]} cols={cols} className={classes.stickyCol}>구분</ResizeHead>
        {trend.map((row, index) => <ResizeHead key={row.month} column={columns[index + 1]} cols={cols} className={`${classes.num} ${row.current ? classes.estimatedHead : ''}`}>
          {monthNo(row.month)}월{row.current ? <small>(진행 중)</small> : null}
        </ResizeHead>)}
        <ResizeHead column={columns[columns.length - 1]} cols={cols} className={`${classes.num} ${classes.totalCol}`}>기간 합계</ResizeHead>
      </tr></thead>
      <tbody>{rows.map((item) => <tr key={item.label} className={item.strong ? classes.strongRow : ''}>
        <td className={classes.stickyCol}>{item.label}</td>
        {trend.map((row) => <td key={row.month} className={`${classes.num} ${row.current ? classes.estimatedCell : ''}`}>{item.cell(row)}</td>)}
        <td className={`${classes.num} ${classes.totalCol}`}>{item.total}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}

const buildQuarters = (months, current) => {
  const multiYear = new Set(months.map((month) => month.slice(0, 4))).size > 1;
  const quarters = [];
  months.forEach((month, index) => {
    const key = `${month.slice(0, 4)}-Q${Math.ceil(monthNo(month) / 3)}`;
    let quarter = quarters.find((item) => item.key === key);
    if (!quarter) {
      quarter = { key, label: `${multiYear ? `${month.slice(2, 4)}년 ` : ''}${Math.ceil(monthNo(month) / 3)}분기`, indexes: [], months: [], current: false };
      quarters.push(quarter);
    }
    quarter.indexes.push(index);
    quarter.months.push(month);
    if (month === current) quarter.current = true;
  });
  return quarters;
};
const buildMonthColumns = (months, current) => months.map((month, index) => ({ key: month, label: `${monthNo(month)}월`, months: [month], indexes: [index], current: month === current }));

const PAGE_SIZE = 12;
const VIEWS = [{ value: 'quarter', label: '분기별' }, { value: 'month', label: '월별' }];
const CURRENCIES = [{ value: 'usd', label: 'USD' }, { value: 'krw', label: '원화' }];

// 이번 달 한도 대비: '12 / 100회' + 막대 (80% 넘으면 주황, 다 쓰면 빨강) · 한도 없으면 '제한 없음'
function QuotaCell({ row }) {
  if (row.monthly_limit === null || row.monthly_limit === undefined) return <span className={classes.zero}>{row.used_month ? `${count(row.used_month)}회 · 제한 없음` : '제한 없음'}</span>;
  const ratio = row.monthly_limit ? row.used_month / row.monthly_limit : 1;
  const tone = ratio >= 1 ? classes.down : ratio >= 0.8 ? classes.quotaWarn : '';
  return <span className={`${classes.quotaCell} ${tone}`} title={`이번 달 ${count(row.used_month)}회 사용 / 한도 ${count(row.monthly_limit)}회`}>
    {count(row.used_month)} / {count(row.monthly_limit)}회
    <i className={classes.quotaBar}><b style={{ width: `${Math.min(100, ratio * 100)}%` }} /></i>
  </span>;
}

// ③ 고객사별 비용
function CompanySection({ data, rate }) {
  const [view, setView] = useState('month');
  const [currency, setCurrency] = useState('usd');
  const [page, setPage] = useState(1);
  const { months, current_month: current } = data;
  const columns = view === 'quarter' ? buildQuarters(months, current) : buildMonthColumns(months, current);
  const rows = useMemo(() => [...data.companies].sort((a, b) => b.cost_now - a.cost_now || b.total_cost - a.total_cost || a.companyname.localeCompare(b.companyname, 'ko')), [data]);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const grandTotal = rows.reduce((sum, row) => sum + toNumber(row.total_cost), 0);
  const columnSum = (row, column) => column.indexes.reduce((sum, index) => sum + toNumber(row.costs[index]), 0);
  const money = (value) => (currency === 'usd' ? usd(value) : krw(value * rate));
  const startRank = (safePage - 1) * PAGE_SIZE;
  // 칸 너비: 앞뒤 칸은 정해진 너비, 기간 칸(분기 / 월)은 모두 같은 너비 → 보기 · 금액 단위를 바꿔도 표가 흔들리지 않음. 끌어서 조절
  const gridColumns = useMemo(() => [RANK, { key: 'name', label: '고객사', width: 170 }, { key: 'quota', label: '이번 달 사용 / 한도', width: 190 },
    { key: 'calls', label: '호출', width: 110 },
    ...columns.map((column) => ({ key: `${view}-${column.key}`, label: column.label, width: view === 'quarter' ? 130 : 108 })),
    { key: 'total', label: '합계', width: 124 }, { key: 'share', label: '비중', width: 76 }], [columns, view]);
  const cols = useResizableColumns(gridColumns);
  const head = (index) => gridColumns[index];

  return <Section title="고객사별 AI 비용" sub={<span className={classes.estimateNote}><b>추정</b>OpenAI 청구서 금액과 다를 수 있습니다.</span>} className={classes.companyPanel}
    tools={<div className={classes.toolGroup}>
      <Tabs items={CURRENCIES} value={currency} onChange={setCurrency} label="금액 단위" />
      <Tabs items={VIEWS} value={view} onChange={setView} label="보기" />
    </div>}>
    <div className={classes.companyBody}>
      <div className={classes.tableScroll}>
        <table className={classes.table} style={gridStyle(cols)}>
          <ColGroup columns={gridColumns} cols={cols} />
          <thead><tr>
            <ResizeHead column={head(0)} cols={cols} className={classes.rankCol}>순위</ResizeHead>
            <ResizeHead column={head(1)} cols={cols} className={classes.stickyCol}>고객사</ResizeHead>
            <ResizeHead column={head(2)} cols={cols}>이번 달 사용 / 한도</ResizeHead>
            <ResizeHead column={head(3)} cols={cols} className={classes.num}>호출</ResizeHead>
            {columns.map((column, index) => <ResizeHead key={column.key} column={head(4 + index)} cols={cols} className={`${classes.num} ${column.current ? classes.estimatedHead : ''}`}
              title={view === 'quarter' ? column.months.map((month) => `${monthNo(month)}월`).join(' · ') : undefined}>
              {column.label}{column.current ? <small>(진행 중)</small> : null}
            </ResizeHead>)}
            <ResizeHead column={head(gridColumns.length - 2)} cols={cols} className={`${classes.num} ${classes.totalCol}`}>합계</ResizeHead>
            <ResizeHead column={head(gridColumns.length - 1)} cols={cols} className={`${classes.num} ${classes.totalCol}`}>비중</ResizeHead>
          </tr></thead>
          <tbody>{pageRows.length ? pageRows.map((row, index) => <tr key={row.companyid}>
            <td className={classes.rankCol}>{startRank + index + 1}</td>
            <td className={classes.stickyCol} title={`${row.companyid} ${row.companyname}`}><b className={classes.nameCell}>{row.companyname}</b></td>
            <td><QuotaCell row={row} /></td>
            <td className={classes.num}>{row.total_calls ? `${count(row.total_calls)}회` : '-'}{row.total_failed ? <small className={classes.failNote}> 실패 {row.total_failed}</small> : null}</td>
            {columns.map((column) => {
              const value = columnSum(row, column);
              return <td key={column.key} className={`${classes.num} ${column.current ? classes.estimatedCell : ''}`}>{value ? money(value) : <span className={classes.zero}>-</span>}</td>;
            })}
            <td className={`${classes.num} ${classes.totalCol}`}>{row.total_cost ? money(row.total_cost) : '-'}</td>
            <td className={`${classes.num} ${classes.totalCol}`}>{grandTotal && row.total_cost ? `${((row.total_cost / grandTotal) * 100).toFixed(1)}%` : '-'}</td>
          </tr>) : <tr><td colSpan={columns.length + 6} className={classes.noRows}>조회 기간에 AI를 사용한 고객사가 없습니다.</td></tr>}</tbody>
          <tfoot><tr>
            <td className={classes.rankCol} />
            <td className={classes.stickyCol}>전체 합계</td><td />
            <td className={classes.num}>{count(rows.reduce((sum, row) => sum + row.total_calls, 0))}회</td>
            {columns.map((column) => <td key={column.key} className={classes.num}>{money(rows.reduce((sum, row) => sum + columnSum(row, column), 0))}</td>)}
            <td className={`${classes.num} ${classes.totalCol}`}>{money(grandTotal)}</td>
            <td className={`${classes.num} ${classes.totalCol}`}>{grandTotal ? '100%' : '-'}</td>
          </tr></tfoot>
        </table>
      </div>
      <div className={classes.pager}>
        <span className={classes.pagerText}>{rows.length ? `${startRank + 1}~${Math.min(startRank + PAGE_SIZE, rows.length)}위 / 전체 ${rows.length}곳` : ''}</span>
        <Pagination size="sm" color="red" value={safePage} total={pageCount} onChange={setPage} disabled={pageCount <= 1} withEdges />
      </div>
    </div>
  </Section>;
}

export default function AiCost() {
  const [inputs, setInputs] = useState(defaultPeriod);
  const [period, setPeriod] = useState(defaultPeriod);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [rateInput, setRateInput] = useState(readRate);   // 화면에서 바꾼 환율 (이 브라우저에 기억)
  const requestRef = useRef(0);
  const picker = useCustomerPicker('/api/ai-cost/companies');
  const rate = toNumber(rateInput) > 0 ? toNumber(rateInput) : toNumber(data?.krw_rate) || 1400;

  const load = useCallback(async (range) => {
    const requestId = ++requestRef.current;
    setLoading(true);
    try {
      const params = { date_from: range.date_from, date_to: range.date_to, companyid: range.customer?.ckey || undefined };
      const response = await axios.get('/api/ai-cost', { ...authConfig(), params });
      if (requestId === requestRef.current) setData(response.data);
    } catch (error) {
      if (requestId === requestRef.current) notifications.show({ title: 'AI 비용 조회 실패', message: apiErrorMessage(error, 'AI 비용을 불러오지 못했습니다.'), color: 'red' });
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, []);
  useEffect(() => { void load(period); }, [load, period]);
  usePageReactivated(() => { void load(period); });

  const apply = useCallback((range, customer) => {
    if (!range.date_from || !range.date_to || range.date_from > range.date_to) {
      notifications.show({ title: '조회기간 확인', message: '기간을 올바르게 입력해 주세요.', color: 'orange' });
      return;
    }
    setInputs({ date_from: range.date_from, date_to: range.date_to });
    setPeriod({ date_from: range.date_from, date_to: range.date_to, customer: customer || null });
  }, []);
  const search = useCallback(async () => {
    const result = await picker.resolve();
    if (result.ok) apply(inputs, result.customer);
  }, [picker, inputs, apply]);
  const pickCustomer = useCallback((item) => { picker.choose(item); apply(inputs, item); }, [picker, inputs, apply]);
  const clearCustomer = useCallback(() => {
    picker.clear();
    if (period.customer) apply(inputs, null);
    picker.inputRef.current?.focus();
  }, [picker, period.customer, inputs, apply]);
  const changeRate = (value) => {
    const next = value === '' ? null : toNumber(value);
    setRateInput(next);
    try { if (next) localStorage.setItem(RATE_KEY, String(next)); else localStorage.removeItem(RATE_KEY); } catch { /* 기억만 못 함 */ }
  };

  const exportExcel = useCallback(async () => {
    if (!data?.companies?.length) { notifications.show({ title: '엑셀 데이터 없음', message: '다운로드할 데이터가 없습니다.', color: 'orange' }); return; }
    const XLSX = await loadXLSXOrNotify();
    if (!XLSX) return;
    const workbook = XLSX.utils.book_new();
    const addSheet = (rows, name) => {
      const sheet = XLSX.utils.json_to_sheet(rows);
      applyExcelHeaderStyle(sheet, Object.keys(rows[0]).length);
      XLSX.utils.book_append_sheet(workbook, sheet, name);
    };
    addSheet(data.trend.map((row) => ({
      월: `${row.month}${row.current ? ' (진행 중)' : ''}`, '추정 비용(USD)': Number(toNumber(row.cost).toFixed(4)), [`추정 원화(원, ${rate}원/USD)`]: Math.round(row.cost * rate),
      '호출(성공)': row.calls, 실패: row.failed, '사용 고객사': row.companies,
    })), '월별 요약');
    addSheet(data.companies.map((row) => ({
      고객사: row.companyname, 코드: row.companyid, '이번 달 사용': row.used_month, '월 한도': row.monthly_limit ?? '제한 없음', 호출: row.total_calls, 실패: row.total_failed,
      ...Object.fromEntries(data.months.map((month, index) => [`${month}(추정 USD)`, Number(toNumber(row.costs[index]).toFixed(4))])),
      '추정 합계(USD)': Number(toNumber(row.total_cost).toFixed(4)), '추정 합계(원)': Math.round(row.total_cost * rate),
    })), '고객사별');
    XLSX.writeFile(workbook, `AI추정비용_${data.month_from.replace('-', '')}_${data.month_to.replace('-', '')}.xlsx`);
  }, [data, rate]);

  useErpPageRibbon({ onSearch: search, onExcel: data ? exportExcel : undefined, showExcel: true, showPrint: false, useSaveColor: false });

  const s = data?.summary;
  const baseMonth = data ? `${monthNo(data.base_month || data.month_to)}월` : '';

  return (
    <Box className={`${simpleTheme.simple} ${sharedClasses.pageShell} ${searchClasses.page} ${classes.page}`}>
      <DashboardHeader parent="어드민" title="AI 비용현황">
        <PeriodFilter value={inputs} onChange={setInputs} onSearch={() => { void search(); }} loading={loading}>
          <CustomerPicker label="고객사" picker={picker} onPick={pickCustomer} onClear={clearCustomer} onEnter={() => { void search(); }} />
          <label className={classes.rateBox} title="원화 환산에 쓰는 환율 (이 브라우저에 기억)">
            <span>환율</span>
            <NumberInput size="xs" value={rateInput ?? ''} placeholder={String(data?.krw_rate ?? 1400)} min={1} max={10000} allowDecimal={false} thousandSeparator="," hideControls
              onChange={changeRate} aria-label="원/USD 환율" />
            <em>원/USD</em>
          </label>
        </PeriodFilter>
      </DashboardHeader>

      <div className={classes.scroll}>
        {s ? <KpiGrid count={4}>
          <KpiCard palette={KPI_PALETTE.blue} icon={IconCoin} label={`${baseMonth} AI 비용 (추정)`} basis={`약 ${krw(s.cost_now * rate)}`} value={usd(s.cost_now)} unit="" />
          <KpiCard palette={KPI_PALETTE.orange} icon={IconSparkles} label={`${baseMonth} 호출`} basis={s.cost_per_call ? `건당 ${usd(s.cost_per_call, 3)}` : '성공한 분석'} value={count(s.calls_now)} unit="회" />
          <KpiCard palette={KPI_PALETTE.slate} icon={IconBuildingSkyscraper} label="사용 고객사" basis={`${baseMonth} 기준`} value={String(s.companies_now)} unit="곳" />
          <KpiCard palette={KPI_PALETTE.amber} icon={IconCalendarStats} label="누적 AI 비용 (추정)" basis={`${dot(data.month_from)} ~ ${dot(data.base_month || data.month_to)} · 약 ${krw(s.period_cost * rate)}`} value={usd(s.period_cost)} unit="" />
        </KpiGrid> : <Empty loading={loading} />}

        {data && <>
          {/* 금액은 추정 비용: OpenAI 가 돌려준 실제 사용 토큰 × .env 단가 (청구서 금액 아님) */}
          <Section title="월별 요약" sub={<span className={classes.estimateNote}><b>추정</b>OpenAI 청구서 금액과 다를 수 있습니다.</span>}>
            <SummaryTable data={data} rate={rate} />
          </Section>
          <CompanySection data={data} rate={rate} />
        </>}
      </div>
    </Box>
  );
}
