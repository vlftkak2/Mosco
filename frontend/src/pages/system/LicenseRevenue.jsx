// 라이선스 매출현황 (어드민 › 고객사관리 · 플랫폼 운영사 001 MASTER 전용) - 경영자용, 표 중심 한 화면
// 지난달까지는 확정된 월별 청구(매달 1일 00:01 KST), 이번 달은 고객사등록의 지금 라이선스 개수 × 비용(예정)으로 본다
// (서버: services/masterdata/LicenseRevenue.py).
//  ① 요약 카드: 이용 고객사 · 라이선스 · 이번 달 매출 · 누적 매출 (한 줄 설명)
//  ② 월별 요약: 매출 · 지난달 대비 · 이용 고객사 · 신규 가입 · 해지 · 라이선스
//  ③ 고객사별 매출: 분기별 / 월별 탭 · 이번 달 금액 큰 순 · 12곳씩 페이지
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import XLSX from 'xlsx-js-style';
import { Box, Loader, Pagination, Paper, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconBuildingSkyscraper, IconCalendarStats, IconCoin, IconLicense } from '@tabler/icons-react';
import { CustomerPicker, DashboardHeader, KPI_PALETTE, PeriodFilter, useCustomerPicker, KpiCard, KpiGrid, PillNote } from '../../components/common/DashboardKit';
import useErpPageRibbon from '../../components/common/useErpPageRibbon';
import usePageReactivated from '../../components/common/usePageReactivated';
import sharedClasses from '../../styles/pages/ManagementShared.module.css';
import searchClasses from '../../styles/pages/InboundSearch.module.css';
import simpleTheme from '../../styles/pages/SimpleTheme.module.css';
import classes from '../../styles/pages/LicenseRevenue.module.css';
import { applyExcelHeaderStyle } from '../../utils/excelHeaderStyle';

const pad = (value) => String(value).padStart(2, '0');
const toDate = (value) => `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
// 기본 조회기간: 올해 1월 1일 ~ 12월 31일 (해가 바뀌면 그해로)
const defaultPeriod = () => {
  const year = new Date().getFullYear();
  return { date_from: `${year}-01-01`, date_to: `${year}-12-31` };
};
const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });
const toNumber = (value) => { const number = Number(value); return Number.isFinite(number) ? number : 0; };
const amount = (value) => Math.round(toNumber(value)).toLocaleString('ko-KR');
const won = (value) => `${amount(value)}원`;
const compact = (value) => {
  const number = toNumber(value);
  const abs = Math.abs(number);
  if (abs >= 100000000) return `${(number / 100000000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}억`;
  if (abs >= 10000) return `${Math.round(number / 10000).toLocaleString('ko-KR')}만`;
  return Math.round(number).toLocaleString('ko-KR');
};
const monthNo = (month) => Number(String(month).slice(5, 7));
const dot = (month) => String(month).replace('-', '.');
const dateText = (value) => (value ? String(value).slice(0, 10) : '');
const periodText = (row) => (row.license_start ? `${dot(dateText(row.license_start).slice(0, 7))} ~ ${row.license_end ? dot(dateText(row.license_end).slice(0, 7)) : '계속'}` : '-');
// 상태: 지금 청구 중이면 이용 중, 청구가 있었는데 끊겼으면 해지, 라이선스를 넣지 않았으면 미등록
const statusOf = (row) => (row.billed_now ? '이용 중' : row.total > 0 || row.license_end ? '해지' : row.has_license ? '시작 전' : '미등록');

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
const Empty = ({ loading, text = '데이터가 없습니다.' }) => <div className={classes.empty}>{loading ? <Loader size="sm" color="red" /> : text}</div>;

// 월 머리글: 이번 달(확정 전)은 '(예정)'
const MonthHead = ({ month, current }) => <th className={`${classes.num} ${month >= current ? classes.estimatedHead : ''}`}>
  {monthNo(month)}월{month >= current ? <small>(예정)</small> : null}
</th>;

// 지난달 대비: '30만원 증가' / '10만원 감소' / '변동 없음'
const changeText = (diff) => (!diff ? <span className={classes.flat}>변동 없음</span>
  : <span className={diff > 0 ? classes.up : classes.down}>{compact(Math.abs(diff))}원 {diff > 0 ? '증가' : '감소'}</span>);

// ② 월별 요약 (월 = 열)
function SummaryTable({ data }) {
  const { trend, current_month: current } = data;
  const sum = (key) => trend.reduce((total, row) => total + toNumber(row[key]), 0);
  const rows = [
    { label: '매출', strong: true, cell: (row) => won(row.total), total: won(sum('total')) },
    { label: '지난달 대비', cell: (row, index) => (index === 0 ? <span className={classes.zero}>-</span> : changeText(toNumber(row.total) - toNumber(trend[index - 1].total))), total: '' },
    { label: '이용 고객사', cell: (row) => `${row.count}곳`, total: '' },
    { label: '신규 가입', cell: (row) => (row.new ? <span className={classes.up}>{row.new}곳</span> : <span className={classes.zero}>-</span>), total: `${sum('new')}곳` },
    { label: '해지', cell: (row) => (row.churn ? <span className={classes.down}>{row.churn}곳</span> : <span className={classes.zero}>-</span>), total: `${sum('churn')}곳` },
    { label: '라이선스', cell: (row) => `${toNumber(row.quantity).toLocaleString('ko-KR')}개`, total: '' },
  ];
  return <div className={classes.summaryScroll}>
    <table className={`${classes.table} ${classes.summaryTable}`}>
      <thead><tr>
        <th className={classes.stickyCol}>구분</th>
        {trend.map((row) => <MonthHead key={row.month} month={row.month} current={current} />)}
        <th className={`${classes.num} ${classes.totalCol}`}>기간 합계</th>
      </tr></thead>
      <tbody>{rows.map((item) => <tr key={item.label} className={item.strong ? classes.strongRow : ''}>
        <td className={classes.stickyCol}>{item.label}</td>
        {trend.map((row, index) => <td key={row.month} className={`${classes.num} ${row.month >= current ? classes.estimatedCell : ''}`}>{item.cell(row, index)}</td>)}
        <td className={`${classes.num} ${classes.totalCol}`}>{item.total}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}

// 분기 묶음: 조회한 달을 분기별로 (해를 넘기면 '25년 4분기'처럼 연도 표시) · 확정 전 달이 들어 있으면 (예정)
const buildQuarters = (months, current) => {
  const multiYear = new Set(months.map((month) => month.slice(0, 4))).size > 1;
  const quarters = [];
  months.forEach((month, index) => {
    const key = `${month.slice(0, 4)}-Q${Math.ceil(monthNo(month) / 3)}`;
    let quarter = quarters.find((item) => item.key === key);
    if (!quarter) {
      quarter = { key, label: `${multiYear ? `${month.slice(2, 4)}년 ` : ''}${Math.ceil(monthNo(month) / 3)}분기`, indexes: [], months: [], estimated: false };
      quarters.push(quarter);
    }
    quarter.indexes.push(index);
    quarter.months.push(month);
    if (month >= current) quarter.estimated = true;
  });
  return quarters;
};

// 월 열: 달마다 한 칸
const buildMonthColumns = (months, current) => months.map((month, index) => ({
  key: month, label: `${monthNo(month)}월`, months: [month], indexes: [index], estimated: month >= current,
}));

const PAGE_SIZE = 12;
const COMPANY_VIEWS = [{ value: 'quarter', label: '분기별' }, { value: 'month', label: '월별' }];

// ③ 고객사별 매출: 분기별 / 월별 탭 · 12곳씩 페이지 · 머리글 · 고객사 칸 고정 (월별은 가로 스크롤)
function CompanySection({ data }) {
  const [view, setView] = useState('quarter');
  const [page, setPage] = useState(1);
  const { months, current_month: current } = data;
  const columns = view === 'quarter' ? buildQuarters(months, current) : buildMonthColumns(months, current);
  const rows = useMemo(() => [...data.companies].sort((a, b) => b.fee_now - a.fee_now || b.total - a.total || a.companyname.localeCompare(b.companyname, 'ko')), [data]);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const grandTotal = rows.reduce((sum, row) => sum + toNumber(row.total), 0);
  const columnSum = (row, column) => column.indexes.reduce((sum, index) => sum + toNumber(row.amounts[index]), 0);
  const startRank = (safePage - 1) * PAGE_SIZE;

  return <Section title="고객사별 매출" className={classes.companyPanel}
    tools={<div className={classes.viewTabs} role="tablist" aria-label="보기">
      {COMPANY_VIEWS.map((item) => <button key={item.value} type="button" role="tab" aria-selected={view === item.value}
        className={`${classes.viewTab} ${view === item.value ? classes.viewTabActive : ''}`} onClick={() => setView(item.value)}>{item.label}</button>)}
    </div>}>
    <div className={classes.companyBody}>
      <div className={classes.tableScroll}>
        <table className={classes.table}>
          <thead><tr>
            <th className={classes.rankCol}>순위</th>
            <th className={classes.stickyCol}>고객사</th><th>상태</th><th>계약 기간</th><th className={classes.num}>라이선스</th>
            {columns.map((column) => <th key={column.key} className={`${classes.num} ${column.estimated ? classes.estimatedHead : ''}`}
              title={view === 'quarter' ? `${column.months.map((month) => `${monthNo(month)}월`).join(' · ')}${column.estimated ? ' · 확정 전 달 포함' : ''}` : undefined}>
              {column.label}{column.estimated ? <small>(예정)</small> : null}
            </th>)}
            <th className={`${classes.num} ${classes.totalCol}`}>합계</th>
            <th className={`${classes.num} ${classes.totalCol}`}>비중</th>
          </tr></thead>
          <tbody>{pageRows.length ? pageRows.map((row, index) => {
            const status = statusOf(row);
            return <tr key={row.companyid} className={row.billed_now ? '' : classes.mutedRow}>
              <td className={classes.rankCol}>{startRank + index + 1}</td>
              <td className={classes.stickyCol} title={`${row.companyid} ${row.companyname}`}><b className={classes.nameCell}>{row.companyname}</b></td>
              <td><span className={`${classes.status} ${status === '이용 중' ? classes.statusOn : status === '해지' ? classes.statusOff : ''}`}>{status}</span></td>
              <td className={classes.periodCell}>{periodText(row)}</td>
              <td className={classes.num}>{row.quantity_now ? `${row.quantity_now}개` : '-'}</td>
              {columns.map((column) => {
                const value = columnSum(row, column);
                return <td key={column.key} className={`${classes.num} ${column.estimated ? classes.estimatedCell : ''}`}>{value ? amount(value) : <span className={classes.zero}>-</span>}</td>;
              })}
              <td className={`${classes.num} ${classes.totalCol}`}>{row.total ? amount(row.total) : '-'}</td>
              <td className={`${classes.num} ${classes.totalCol}`}>{grandTotal && row.total ? `${((row.total / grandTotal) * 100).toFixed(1)}%` : '-'}</td>
            </tr>;
          }) : <tr><td colSpan={columns.length + 7} className={classes.noRows}>등록된 고객사가 없습니다.</td></tr>}</tbody>
          <tfoot><tr>
            <td className={classes.rankCol} />
            <td className={classes.stickyCol}>전체 합계</td><td /><td />
            <td className={classes.num}>{rows.reduce((sum, row) => sum + row.quantity_now, 0).toLocaleString('ko-KR')}개</td>
            {columns.map((column) => <td key={column.key} className={classes.num}>{amount(rows.reduce((sum, row) => sum + columnSum(row, column), 0))}</td>)}
            <td className={`${classes.num} ${classes.totalCol}`}>{amount(grandTotal)}</td>
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

export default function LicenseRevenue() {
  const [inputs, setInputs] = useState(defaultPeriod);
  const [period, setPeriod] = useState(defaultPeriod);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const requestRef = useRef(0);
  const picker = useCustomerPicker('/api/license-revenue/companies');

  const load = useCallback(async (range) => {
    const requestId = ++requestRef.current;
    setLoading(true);
    try {
      const params = { date_from: range.date_from, date_to: range.date_to, companyid: range.customer?.ckey || undefined };
      const response = await axios.get('/api/license-revenue', { ...authConfig(), params });
      if (requestId === requestRef.current) setData(response.data);
    } catch (error) {
      if (requestId === requestRef.current) notifications.show({ title: '라이선스 매출 조회 실패', message: error.response?.data?.detail || '라이선스 매출을 불러오지 못했습니다.', color: 'red' });
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, []);
  useEffect(() => { void load(period); }, [load, period]);
  usePageReactivated(() => { void load(period); });

  // 조회: 기간 + 고객사 (같은 조건이어도 새로 불러온다)
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

  // 엑셀: 월별 요약 + 고객사별 두 시트 (화면과 같은 말)
  const exportExcel = useCallback(() => {
    if (!data?.companies?.length) { notifications.show({ title: '엑셀 데이터 없음', message: '다운로드할 데이터가 없습니다.', color: 'orange' }); return; }
    const workbook = XLSX.utils.book_new();
    const addSheet = (rows, name) => {
      const sheet = XLSX.utils.json_to_sheet(rows);
      applyExcelHeaderStyle(sheet, Object.keys(rows[0]).length);
      XLSX.utils.book_append_sheet(workbook, sheet, name);
    };
    addSheet(data.trend.map((row, index) => ({
      월: `${row.month}${row.estimated ? ' (예정)' : ''}`, '매출(원)': toNumber(row.total),
      '지난달 대비(원)': index ? toNumber(row.total) - toNumber(data.trend[index - 1].total) : '',
      '이용 고객사': row.count, '신규 가입': row.new, 해지: row.churn, 라이선스: row.quantity,
    })), '월별 요약');
    const rows = [...data.companies].sort((a, b) => b.fee_now - a.fee_now || b.total - a.total);
    const sheetRows = rows.map((row) => ({
      고객사: row.companyname, 상태: statusOf(row), '계약 기간': periodText(row), 라이선스: row.quantity_now,
      ...Object.fromEntries(data.months.map((month, index) => [`${month}${month >= data.current_month ? ' (예정)' : ''}`, toNumber(row.amounts[index])])),
      합계: toNumber(row.total),
    }));
    sheetRows.push({ 고객사: '합계', ...Object.fromEntries(data.months.map((month, index) => [`${month}${month >= data.current_month ? ' (예정)' : ''}`, rows.reduce((sum, row) => sum + toNumber(row.amounts[index]), 0)])), 합계: rows.reduce((sum, row) => sum + toNumber(row.total), 0) });
    addSheet(sheetRows, '고객사별');
    XLSX.writeFile(workbook, `라이선스매출_${data.month_from.replace('-', '')}_${data.month_to.replace('-', '')}.xlsx`);
  }, [data]);

  useErpPageRibbon({ onSearch: search, onExcel: data ? exportExcel : undefined, showExcel: true, showPrint: false, useSaveColor: false });

  const s = data?.summary;
  const baseMonth = data ? `${monthNo(data.base_month || data.month_to)}월` : '';

  return (
    <Box className={`${simpleTheme.simple} ${sharedClasses.pageShell} ${searchClasses.page} ${classes.page}`}>
      <DashboardHeader parent="어드민" title="라이선스 매출현황">
        <PeriodFilter value={inputs} onChange={setInputs} onSearch={() => { void search(); }} loading={loading}>
          <CustomerPicker label="고객사" picker={picker} onPick={pickCustomer} onClear={clearCustomer} onEnter={() => { void search(); }} />
        </PeriodFilter>
      </DashboardHeader>

      <div className={classes.scroll}>
        {s ? <KpiGrid count={4}>
          <KpiCard palette={KPI_PALETTE.orange} icon={IconBuildingSkyscraper} label="이용 고객사" basis={`${baseMonth} 기준`} value={String(s.billed_count)} unit="곳" />
          <KpiCard palette={KPI_PALETTE.slate} icon={IconLicense} label="라이선스" basis={`${baseMonth} 기준`} value={toNumber(s.quantity).toLocaleString('ko-KR')} unit="개" />
          <KpiCard palette={KPI_PALETTE.blue} icon={IconCoin} label={`${baseMonth} 매출`} basis={s.base_estimated ? '예정 금액 · 부가세 별도' : '부가세 별도'} value={amount(s.mrr)} />
          <KpiCard palette={KPI_PALETTE.amber} icon={IconCalendarStats} label="누적 매출" basis={`${dot(data.month_from)} ~ ${dot(data.base_month || data.month_to)}`} value={amount(s.period_total)} />
        </KpiGrid> : <Empty loading={loading} />}

        {data && <>
          <Section title="월별 요약">
            <SummaryTable data={data} />
          </Section>
          <CompanySection data={data} />
        </>}
      </div>
    </Box>
  );
}
