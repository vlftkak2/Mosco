// AI 비용현황 (어드민 · 모스코 전용 메뉴 AI_COST) - 라이선스 매출현황과 같은 배치
// 자료: aiorderanalysis01t (AI 주문서인식 분석 기록) + aichatusage01t (AI 업무비서 질문 기록). 비용은 저장된 추정 비용(USD), 원화는 USD × 환율.
// 비용은 두 기능 합계, '호출'은 주문서인식 성공 건수(고객사 AI 월 호출 한도와 같은 기준) · 업무비서는 '질문'으로 따로 센다.
// (서버: services/masterdata/AiCost.py)
//  ① 요약 카드: 이번 달 AI 비용 · 이번 달 호출 · 사용 고객사 · 누적 비용
//  ② 월별 요약: 비용(USD) · 원화 환산 · 호출 · 실패 · 사용 고객사 · 건당 비용
//  ③ 고객사별 비용: 분기별 / 월별 · USD / 원화 · 이번 달 한도 대비 사용 · 12곳씩 페이지
//  ④ 사용자별 비용: 회사 · 사용자마다 주문서인식 호출 · 업무비서 질문 · 비용 (조회 기간 합계 + 이번 달) · 12명씩 페이지
//     ③ · ④ 는 같은 자리에서 [고객사별 | 사용자별] 탭으로 바꿔 본다
//     사용자 줄을 누르면 그 사람의 AI 업무비서 질문 기록(조회 기간 · 최근 순)이 열린다 (답변은 저장하지 않음)
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { loadXLSXOrNotify } from '../../utils/excelSafe';
import { Box, Loader, Modal, NumberInput, Pagination, Paper, Text } from '@mantine/core';
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
  const columns = useMemo(() => [{ key: 'label', label: '구분', width: 150 }, ...trend.map((row) => ({ key: row.month, label: `${monthNo(row.month)}월`, width: 108 })),
    { key: 'total', label: '기간 합계', width: 130 }], [trend]);
  const cols = useResizableColumns(columns);
  const sum = (key) => trend.reduce((total, row) => total + toNumber(row[key]), 0);
  const rows = [
    { label: '추정 비용 (USD)', strong: true, cell: (row) => usd(row.cost), total: usd(sum('cost')) },
    { label: '· 주문서인식', cell: (row) => (row.order_cost ? usd(row.order_cost) : <span className={classes.zero}>-</span>), total: usd(sum('order_cost')) },
    { label: '· 업무비서', cell: (row) => (row.chat_cost ? usd(row.chat_cost) : <span className={classes.zero}>-</span>), total: usd(sum('chat_cost')) },
    { label: '원화 환산', cell: (row) => krw(row.cost * rate), total: krw(sum('cost') * rate) },
    { label: '주문서인식 호출 (성공)', cell: (row) => (row.calls ? `${count(row.calls)}회` : <span className={classes.zero}>-</span>), total: `${count(sum('calls'))}회` },
    { label: '주문서인식 실패', cell: (row) => (row.failed ? <span className={classes.down}>{count(row.failed)}회</span> : <span className={classes.zero}>-</span>), total: `${count(sum('failed'))}회` },
    { label: '업무비서 질문', cell: (row) => (row.chat_calls || row.chat_failed
      ? <>{count(row.chat_calls)}회{row.chat_failed ? <small className={classes.failNote}> 실패 {row.chat_failed}</small> : null}</>
      : <span className={classes.zero}>-</span>), total: `${count(sum('chat_calls'))}회` },
    { label: '사용 고객사', cell: (row) => (row.companies ? `${row.companies}곳` : <span className={classes.zero}>-</span>), total: '' },
    // 건당 비용 = 주문서인식 비용 ÷ 주문서인식 성공 건수 (업무비서 비용은 빼고)
    { label: '주문서인식 건당', cell: (row) => (row.calls ? usd(toNumber(row.order_cost) / row.calls, 3) : <span className={classes.zero}>-</span>), total: sum('calls') ? usd(sum('order_cost') / sum('calls'), 3) : '' },
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
function CompanySection({ data, rate, switcher }) {
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
      {switcher}
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
            <td className={classes.num} title={row.total_chat_calls ? `업무비서 질문 ${count(row.total_chat_calls)}회 · ${usd(row.total_chat_cost)}` : undefined}>
              {row.total_calls ? `${count(row.total_calls)}회` : '-'}{row.total_failed ? <small className={classes.failNote}> 실패 {row.total_failed}</small> : null}
            </td>
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
            <td className={classes.num}>{count(rows.reduce((sum, row) => sum + row.total_calls, 0))}회
            </td>
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

// 사용자별 AI 업무비서 질문 기록 (조회 기간 · 최근 순 30건씩). 질문 원문은 영구 보관, 답변은 저장하지 않는다.
const Q_STATUS = { complete: { label: '답변', className: 'qOk' }, failed: { label: '실패', className: 'qFail' }, processing: { label: '처리 중', className: 'qWait' } };
function QuestionList({ target, period }) {
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(null);   // { key, items, total, pageSize } — key 가 지금 조건과 다르면 불러오는 중
  const key = `${period.date_from}|${period.date_to}|${page}`;
  useEffect(() => {
    let alive = true;
    axios.get('/api/ai-cost/questions', { ...authConfig(), params: { companyid: target.companyid, email: target.email, date_from: period.date_from, date_to: period.date_to, page } })
      .then((response) => { if (alive) setResult({ key, items: response.data.items || [], total: response.data.total || 0, pageSize: response.data.page_size || 30 }); })
      .catch((error) => {
        if (!alive) return;
        setResult({ key, items: [], total: 0, pageSize: 30 });
        notifications.show({ title: '질문 기록 조회 실패', message: apiErrorMessage(error, '질문 기록을 불러오지 못했습니다.'), color: 'red' });
      });
    return () => { alive = false; };
  }, [target, period, page, key]);
  const loading = !result || result.key !== key;
  const total = result?.total || 0;
  const pageCount = Math.max(1, Math.ceil(total / (result?.pageSize || 30)));
  return <div className={classes.qBody}>
    <div className={classes.qMeta}>
      <span>{period.date_from} ~ {period.date_to} · AI 업무비서 질문 <b>{loading && !result ? '…' : `${count(total)}건`}</b></span>
      <span className={classes.estimateNote}><b>기록</b>질문 원문만 보관 · 답변은 저장하지 않음</span>
    </div>
    <div className={classes.qList}>
      {loading ? <Empty loading /> : result.items.length ? result.items.map((item) => {
        const status = Q_STATUS[item.status] || Q_STATUS.processing;
        return <div key={item.request_id} className={classes.qItem}>
          <div className={classes.qHead}>
            <span className={classes.qTime}>{item.asked_at}</span>
            <span className={`${classes.qBadge} ${classes[status.className]}`}>{status.label}</span>
            {item.tools.map((tool) => <span key={tool} className={classes.qTool}>{tool}</span>)}
            <span className={classes.qCost}>{usd(item.cost, 4)}</span>
          </div>
          <div className={classes.qText}>{item.question || <span className={classes.zero}>(기록 전 질문 · 내용 없음)</span>}</div>
        </div>;
      }) : <Empty text="조회 기간에 질문한 기록이 없습니다." />}
    </div>
    {pageCount > 1 && <div className={classes.qPager}><Pagination size="sm" color="red" value={page} total={pageCount} onChange={setPage} withEdges /></div>}
  </div>;
}
function QuestionModal({ target, period, onClose }) {
  const sub = target ? [target.team, target.position].filter(Boolean).join(' · ') : '';
  return <Modal opened={Boolean(target)} onClose={onClose} centered size={760} radius="md" withinPortal
    title={target ? <span className={classes.qTitle}><b>{target.username || target.email}</b>{sub && <small>{sub}</small>}<em>{target.companyname}</em></span> : null}>
    {/* 사용자가 바뀌면 목록을 새로 만든다 (쪽 · 결과 초기화) */}
    {target && <QuestionList key={`${target.companyid}|${target.email}`} target={target} period={period} />}
  </Modal>;
}

// ④ 사용자별 비용 (회사 · 사용자) — 고객사별 표와 같은 모양
const USER_SORTS = [{ value: 'cost', label: '비용순' }, { value: 'calls', label: '사용순' }];
const usesOf = (row) => toNumber(row.order_calls) + toNumber(row.chat_calls);
function UserSection({ data, rate, switcher, period }) {
  const [questionsOf, setQuestionsOf] = useState(null);   // 질문 기록을 볼 사용자
  const [currency, setCurrency] = useState('usd');
  const [sort, setSort] = useState('cost');
  const [page, setPage] = useState(1);
  const rows = useMemo(() => [...(data.users || [])].sort((a, b) => (sort === 'calls'
    ? usesOf(b) - usesOf(a) || b.total_cost - a.total_cost
    : b.total_cost - a.total_cost || usesOf(b) - usesOf(a))
    || a.companyname.localeCompare(b.companyname, 'ko') || String(a.username).localeCompare(String(b.username), 'ko')), [data, sort]);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const startRank = (safePage - 1) * PAGE_SIZE;
  const money = (value) => (currency === 'usd' ? usd(value) : krw(value * rate));
  const total = (key) => rows.reduce((sum, row) => sum + toNumber(row[key]), 0);
  const grandTotal = total('total_cost');
  const maxCost = rows.reduce((max, row) => Math.max(max, toNumber(row.total_cost)), 0);
  const baseMonth = `${monthNo(data.current_month)}월`;
  const gridColumns = useMemo(() => [RANK, { key: 'name', label: '사용자', width: 190 }, { key: 'company', label: '고객사', width: 150 },
    { key: 'order', label: '주문서인식', width: 116 }, { key: 'chat', label: '업무비서', width: 116 }, { key: 'now', label: `${baseMonth} 사용`, width: 150 },
    { key: 'orderCost', label: '주문서인식 비용', width: 124 }, { key: 'chatCost', label: '업무비서 비용', width: 124 },
    { key: 'total', label: '기간 합계', width: 124 }, { key: 'share', label: '비중', width: 120 }], [baseMonth]);
  const cols = useResizableColumns(gridColumns);
  const head = (index) => gridColumns[index];
  const callsCell = (calls, failed) => (calls || failed
    ? <>{count(calls)}회{failed ? <small className={classes.failNote}> 실패 {failed}</small> : null}</>
    : <span className={classes.zero}>-</span>);
  const moneyCell = (value) => (value ? money(value) : <span className={classes.zero}>-</span>);

  return <Section title="사용자별 AI 비용" sub={<span className={classes.estimateNote}><b>추정</b>조회 기간 합계 · 주문서인식은 성공한 호출, 업무비서는 질문 수</span>}
    className={classes.companyPanel}
    tools={<div className={classes.toolGroup}>
      {switcher}
      <Tabs items={USER_SORTS} value={sort} onChange={(value) => { setSort(value); setPage(1); }} label="정렬" />
      <Tabs items={CURRENCIES} value={currency} onChange={setCurrency} label="금액 단위" />
    </div>}>
    <div className={classes.companyBody}>
      <div className={classes.tableScroll}>
        <table className={classes.table} style={gridStyle(cols)}>
          <ColGroup columns={gridColumns} cols={cols} />
          <thead><tr>
            <ResizeHead column={head(0)} cols={cols} className={classes.rankCol}>순위</ResizeHead>
            <ResizeHead column={head(1)} cols={cols} className={classes.stickyCol}>사용자</ResizeHead>
            <ResizeHead column={head(2)} cols={cols}>고객사</ResizeHead>
            <ResizeHead column={head(3)} cols={cols} className={classes.num}>주문서인식</ResizeHead>
            <ResizeHead column={head(4)} cols={cols} className={classes.num}>업무비서</ResizeHead>
            <ResizeHead column={head(5)} cols={cols} className={`${classes.num} ${classes.estimatedHead}`}>{baseMonth} 사용<small>(진행 중)</small></ResizeHead>
            <ResizeHead column={head(6)} cols={cols} className={classes.num}>주문서인식 비용</ResizeHead>
            <ResizeHead column={head(7)} cols={cols} className={classes.num}>업무비서 비용</ResizeHead>
            <ResizeHead column={head(8)} cols={cols} className={`${classes.num} ${classes.totalCol}`}>기간 합계</ResizeHead>
            <ResizeHead column={head(9)} cols={cols} className={`${classes.num} ${classes.totalCol}`}>비중</ResizeHead>
          </tr></thead>
          <tbody>{pageRows.length ? pageRows.map((row, index) => {
            const sub = [row.team, row.position].filter(Boolean).join(' · ');
            const share = grandTotal ? (row.total_cost / grandTotal) * 100 : 0;
            return <tr key={`${row.companyid}|${row.email}`} className={`${classes.clickRow} ${row.active ? '' : classes.mutedRow}`}
              title="누르면 AI 업무비서 질문 기록을 봅니다" onClick={() => setQuestionsOf(row)}>
              <td className={classes.rankCol}>{startRank + index + 1}</td>
              <td className={classes.stickyCol} title={`${row.username || row.email}${sub ? ` (${sub})` : ''} · ${row.email}`}>
                <span className={classes.userCell}>
                  <b className={classes.nameCell}>{row.username || row.email}</b>
                  {sub && <small className={classes.userSub}>{sub}</small>}
                  {!row.active && <em className={classes.userTag}>미사용</em>}
                </span>
              </td>
              <td title={`${row.companyid} ${row.companyname}`}><span className={classes.nameCell}>{row.companyname}</span></td>
              <td className={classes.num}>{callsCell(row.order_calls, row.order_failed)}</td>
              <td className={classes.num}>{callsCell(row.chat_calls, row.chat_failed)}</td>
              <td className={`${classes.num} ${classes.estimatedCell}`}>{row.calls_now || row.cost_now
                ? <>{money(row.cost_now)}<small className={classes.userSub}> · {count(row.calls_now)}회</small></> : <span className={classes.zero}>-</span>}</td>
              <td className={classes.num}>{moneyCell(row.order_cost)}</td>
              <td className={classes.num}>{moneyCell(row.chat_cost)}</td>
              <td className={`${classes.num} ${classes.totalCol}`}><b>{moneyCell(row.total_cost)}</b></td>
              <td className={`${classes.num} ${classes.totalCol}`}>
                {row.total_cost ? <span className={classes.quotaCell} title={`전체 비용의 ${share.toFixed(1)}%`}>
                  <i className={classes.quotaBar}><b style={{ width: `${maxCost ? Math.max(4, (row.total_cost / maxCost) * 100) : 0}%` }} /></i>{share.toFixed(1)}%
                </span> : <span className={classes.zero}>-</span>}
              </td>
            </tr>;
          }) : <tr><td colSpan={gridColumns.length} className={classes.noRows}>조회 기간에 AI를 사용한 사용자가 없습니다.</td></tr>}</tbody>
          <tfoot><tr>
            <td className={classes.rankCol} />
            <td className={classes.stickyCol}>전체 {count(rows.length)}명</td><td />
            <td className={classes.num}>{count(total('order_calls'))}회</td>
            <td className={classes.num}>{count(total('chat_calls'))}회</td>
            <td className={classes.num}>{money(total('cost_now'))}</td>
            <td className={classes.num}>{money(total('order_cost'))}</td>
            <td className={classes.num}>{money(total('chat_cost'))}</td>
            <td className={`${classes.num} ${classes.totalCol}`}>{money(grandTotal)}</td>
            <td className={`${classes.num} ${classes.totalCol}`}>{grandTotal ? '100%' : '-'}</td>
          </tr></tfoot>
        </table>
      </div>
      <div className={classes.pager}>
        <span className={classes.pagerText}>{rows.length ? `${startRank + 1}~${Math.min(startRank + PAGE_SIZE, rows.length)}위 / 전체 ${rows.length}명` : ''}</span>
        <Pagination size="sm" color="red" value={safePage} total={pageCount} onChange={setPage} disabled={pageCount <= 1} withEdges />
      </div>
    </div>
    <QuestionModal target={questionsOf} period={period} onClose={() => setQuestionsOf(null)} />
  </Section>;
}

// ③ · ④ 전환: 같은 자리에서 고객사별 ↔ 사용자별
const TARGETS = [{ value: 'company', label: '고객사별' }, { value: 'user', label: '사용자별' }];
function CostBreakdown({ data, rate, period }) {
  const [target, setTarget] = useState('company');
  const switcher = <Tabs items={TARGETS} value={target} onChange={setTarget} label="보는 기준" />;
  return target === 'user'
    ? <UserSection data={data} rate={rate} switcher={switcher} period={period} />
    : <CompanySection data={data} rate={rate} switcher={switcher} />;
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
      '주문서인식(USD)': Number(toNumber(row.order_cost).toFixed(4)), '업무비서(USD)': Number(toNumber(row.chat_cost).toFixed(4)),
      '주문서인식 호출(성공)': row.calls, '주문서인식 실패': row.failed, '업무비서 질문': row.chat_calls, '업무비서 실패': row.chat_failed, '사용 고객사': row.companies,
    })), '월별 요약');
    addSheet(data.companies.map((row) => ({
      고객사: row.companyname, 코드: row.companyid, '이번 달 사용': row.used_month, '월 한도': row.monthly_limit ?? '제한 없음', '주문서인식 호출': row.total_calls, '주문서인식 실패': row.total_failed,
      '업무비서 질문': row.total_chat_calls, '업무비서 실패': row.total_chat_failed,
      ...Object.fromEntries(data.months.map((month, index) => [`${month}(추정 USD)`, Number(toNumber(row.costs[index]).toFixed(4))])),
      '주문서인식 합계(USD)': Number(toNumber(row.total_order_cost).toFixed(4)), '업무비서 합계(USD)': Number(toNumber(row.total_chat_cost).toFixed(4)),
      '추정 합계(USD)': Number(toNumber(row.total_cost).toFixed(4)), '추정 합계(원)': Math.round(row.total_cost * rate),
    })), '고객사별');
    if (data.users?.length) addSheet(data.users.map((row) => ({
      고객사: row.companyname, 코드: row.companyid, 사용자: row.username, 이메일: row.email, 부서: row.team, 직급: row.position,
      '주문서인식 호출(성공)': row.order_calls, '주문서인식 실패': row.order_failed, '업무비서 질문': row.chat_calls, '업무비서 실패': row.chat_failed,
      '주문서인식(USD)': Number(toNumber(row.order_cost).toFixed(4)), '업무비서(USD)': Number(toNumber(row.chat_cost).toFixed(4)),
      [`${data.current_month} 사용(USD)`]: Number(toNumber(row.cost_now).toFixed(4)),
      '추정 합계(USD)': Number(toNumber(row.total_cost).toFixed(4)), '추정 합계(원)': Math.round(row.total_cost * rate),
    })), '사용자별');
    XLSX.writeFile(workbook, `AI추정비용_${data.month_from.replace('-', '')}_${data.month_to.replace('-', '')}.xlsx`);
  }, [data, rate]);

  useErpPageRibbon({ onSearch: search, onExcel: data ? exportExcel : undefined, showExcel: true, useSaveColor: false });

  const s = data?.summary;
  const baseMonth = data ? `${monthNo(data.base_month || data.month_to)}월` : '';

  return (
    <Box className={`${simpleTheme.simple} ${sharedClasses.pageShell} ${searchClasses.page} ${classes.page}`}>
      <DashboardHeader parent="관리" title="AI 비용현황">
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
          <KpiCard palette={KPI_PALETTE.blue} icon={IconCoin} label={`${baseMonth} AI 비용 (추정)`} basis={`약 ${krw(s.cost_now * rate)}${s.chat_cost_now ? ` · 업무비서 ${usd(s.chat_cost_now)}` : ''}`} value={usd(s.cost_now)} unit="" />
          <KpiCard palette={KPI_PALETTE.orange} icon={IconSparkles} label={`${baseMonth} 주문서인식 호출`} basis={`${s.cost_per_call ? `건당 ${usd(s.cost_per_call, 3)}` : '성공한 분석'}${s.chat_calls_now ? ` · 업무비서 질문 ${count(s.chat_calls_now)}회` : ''}`} value={count(s.calls_now)} unit="회" />
          <KpiCard palette={KPI_PALETTE.slate} icon={IconBuildingSkyscraper} label="사용 고객사" basis={`${baseMonth} 기준`} value={String(s.companies_now)} unit="곳" />
          <KpiCard palette={KPI_PALETTE.amber} icon={IconCalendarStats} label="누적 AI 비용 (추정)" basis={`${dot(data.month_from)} ~ ${dot(data.base_month || data.month_to)} · 약 ${krw(s.period_cost * rate)}`} value={usd(s.period_cost)} unit="" />
        </KpiGrid> : <Empty loading={loading} />}

        {data && <>
          {/* 금액은 추정 비용: OpenAI 가 돌려준 실제 사용 토큰 × .env 단가 (청구서 금액 아님) */}
          <Section title="월별 요약" sub={<span className={classes.estimateNote}><b>추정</b>OpenAI 청구서 금액과 다를 수 있습니다.</span>}>
            <SummaryTable data={data} rate={rate} />
          </Section>
          <CostBreakdown data={data} rate={rate} period={period} />
        </>}
      </div>
    </Box>
  );
}
