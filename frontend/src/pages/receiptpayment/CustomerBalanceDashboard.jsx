import { memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import XLSX from 'xlsx-js-style';
import { Badge, Box, Button, Group, HoverCard, Loader, Paper, SegmentedControl, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconAlertTriangle, IconBulb, IconCash, IconCoins, IconCopy, IconDeviceFloppy, IconPercentage, IconReceipt, IconScale,
  IconFileSpreadsheet, IconPlus, IconSearch, IconTrash, IconX,
} from '@tabler/icons-react';
import {
  Bar, BarChart, Cell, CartesianGrid, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import ErpDateInput from '../../components/common/ErpDateInput';
import { DashboardHeader, FilterBox, FilterTilde, KPI_PALETTE, KpiBreakdown, KpiCard, KpiGrid, PillNote, TrendPill } from '../../components/common/DashboardKit';
import usePageReactivated from '../../components/common/usePageReactivated';
import { PageRibbonContext } from '../../components/layout/MainLayout';
import sharedClasses from '../../styles/pages/ManagementShared.module.css';
import simpleTheme from '../../styles/pages/SimpleTheme.module.css';
import searchClasses from '../../styles/pages/InboundSearch.module.css';
import classes from '../../styles/pages/CustomerBalanceDashboard.module.css';
import { applyExcelHeaderStyle } from '../../utils/excelHeaderStyle';

// 거래처 잔액 현황 (경영 대시보드): 거래처원장과 같은 계산(서버 CustomerLedger.dashboard)을 쓴다.
// - 조회기간: 기말 = 종료일 잔액, 기초 = 시작일 전날 잔액, 수금·지급·회수율은 기간 합계. 금액은 거래처원장 합계와 같다 (선수금 · 선급금 포함)
// - 색: 미수금 = 파랑, 미지급금 = 주황 (validate_palette 통과). 경과 기간은 파랑 한 가지 색의 밝음→어두움.
// - 월말 잔액 추이는 기간의 월 (최소 6개월 · 최대 36개월, 서버가 정함).
const COLOR = { recv: '#2a78d6', pay: '#eb6834', sales: '#2a78d6', receipt: '#1baf7a', purchase: '#eb6834', payment: '#eda100' };
const AGING_COLORS = { d30: '#86b6ef', d60: '#5598e7', d90: '#2a78d6', over90: '#184f95', unknown: '#b8c0cc' };
const AXIS_TICK = { fontSize: 11, fill: '#5d6b80' };

const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });
const toNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};
const won = (value) => `${Math.round(toNumber(value)).toLocaleString('ko-KR')}원`;
const compact = (value) => {
  const number = toNumber(value);
  const abs = Math.abs(number);
  if (abs >= 100000000) return `${(number / 100000000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}억`;
  if (abs >= 10000) return `${Math.round(number / 10000).toLocaleString('ko-KR')}만`;
  return Math.round(number).toLocaleString('ko-KR');
};
const pct = (value, digits = 1) => `${toNumber(value).toLocaleString('ko-KR', { maximumFractionDigits: digits })}%`;
const shortName = (name, max = 9) => (String(name || '').length > max ? `${String(name).slice(0, max)}…` : String(name || ''));
const toDate = (value) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
// 기본 조회기간
const defaultPeriod = () => {
  const now = new Date();
  // 당월 1일 ~ 당월 말일 (매출이익요약과 같음)
  return { date_from: toDate(new Date(now.getFullYear(), now.getMonth(), 1)), date_to: toDate(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
};
const shortDate = (value) => (value ? `${String(value).slice(5, 7)}.${String(value).slice(8, 10)}` : '');
const dateText = (value) => (value ? String(value).slice(0, 10) : '');
const monthLabel = (month) => `${month.slice(2, 4)}.${month.slice(5)}`;

function ChartTooltip({ active, payload, label, extra }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return <Paper className={classes.tooltip} withBorder shadow="sm">
    <Text size="xs" fw={700} mb={4}>{row.fullName || label}</Text>
    {payload.map((item) => <Group key={item.dataKey} justify="space-between" gap={14} wrap="nowrap">
      <Group gap={6} wrap="nowrap"><span className={classes.swatch} style={{ background: item.color || item.fill }} /><Text size="xs" c="dimmed">{item.name}</Text></Group>
      <Text size="xs" fw={600}>{won(item.value)}</Text>
    </Group>)}
    {extra && <Text size="xs" c="dimmed" mt={4}>{extra(row)}</Text>}
  </Paper>;
}

function Panel({ title, sub, action, children, className = '' }) {
  return <Paper className={`${classes.panel} ${className}`} withBorder>
    <div className={classes.panelHead}>
      <div className={classes.panelTitleWrap}><Text className={classes.panelTitle}>{title}</Text>{sub && <Text className={classes.panelSub}>{sub}</Text>}</div>
      {action}
    </div>
    <div className={classes.panelBody}>{children}</div>
  </Paper>;
}
const Empty = ({ loading, text = '데이터가 없습니다.' }) => <div className={classes.empty}>{loading ? <Loader size="sm" color="red" /> : text}</div>;

// 미수금 · 미지급금 월말 잔액 (나란히 막대, 금액 축 하나) · 기준월만 진하게, 기준월 막대 위에 금액
const SOFT = { recv: '#bcd6f3', pay: '#f6c7b2' };
const BalanceTrend = memo(function BalanceTrend({ trend }) {
  const last = trend.length - 1;
  const data = trend.map((row, index) => ({
    name: `${Number(String(row.month).slice(5, 7))}월`, fullName: row.month,
    recv: toNumber(row.recv_balance), pay: toNumber(row.pay_balance),
    recvLabel: index === last && toNumber(row.recv_balance) > 0 ? compact(row.recv_balance) : '',
    payLabel: index === last && toNumber(row.pay_balance) > 0 ? compact(row.pay_balance) : '',
  }));
  return <ResponsiveContainer width="100%" height={232}>
    <BarChart data={data} margin={{ top: 20, right: 8, bottom: 0, left: 0 }} barGap={2} barCategoryGap="26%">
      <CartesianGrid vertical={false} stroke="#eef1f5" />
      <XAxis dataKey="name" tick={AXIS_TICK} axisLine={{ stroke: '#d5dbe3' }} tickLine={false} />
      <YAxis tickFormatter={compact} width={56} tick={{ fontSize: 10, fill: '#8b95a3' }} axisLine={false} tickLine={false} />
      <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f3f6fa' }} />
      <Bar dataKey="recv" name="미수금" maxBarSize={16} radius={[4, 4, 0, 0]} isAnimationActive={false} fill={COLOR.recv}>
        {data.map((row, index) => <Cell key={row.fullName} fill={index === last ? COLOR.recv : SOFT.recv} />)}
        <LabelList dataKey="recvLabel" position="top" style={{ fontSize: 10.5, fill: '#1d5fae', fontWeight: 700 }} />
      </Bar>
      <Bar dataKey="pay" name="미지급금" maxBarSize={16} radius={[4, 4, 0, 0]} isAnimationActive={false} fill={COLOR.pay}>
        {data.map((row, index) => <Cell key={row.fullName} fill={index === last ? COLOR.pay : SOFT.pay} />)}
        <LabelList dataKey="payLabel" position="top" style={{ fontSize: 10.5, fill: '#b5481c', fontWeight: 700 }} />
      </Bar>
    </BarChart>
  </ResponsiveContainer>;
});

// 거래처 TOP 10: 한 가지 색의 순위 막대 + 전체 대비 비중
const TopBars = memo(function TopBars({ rows, total, color, label, onPick }) {
  if (!rows.length) return <Empty text={`${label}이 남은 거래처가 없습니다.`} />;
  const data = rows.map((row) => ({ name: shortName(row.customname), fullName: row.customname, ckey: row.ckey, amount: toNumber(row.amount), share: total ? (toNumber(row.amount) / total) * 100 : 0 }));
  return <ResponsiveContainer width="100%" height={Math.max(150, data.length * 28 + 16)}>
    <BarChart data={data} layout="vertical" margin={{ top: 2, right: 92, bottom: 2, left: 4 }} barCategoryGap="30%">
      <XAxis type="number" hide domain={[0, 'dataMax']} />
      <YAxis type="category" dataKey="name" width={104} axisLine={false} tickLine={false} interval={0}
        tick={({ x, y, payload }) => <text x={x} y={y} dy={4} textAnchor="end" fontSize={11} fill="#5d6b80">{payload.value}</text>} />
      <Tooltip content={<ChartTooltip extra={(row) => `전체의 ${pct(row.share)} · 누르면 거래처원장`} />} cursor={{ fill: '#f3f6fa' }} />
      <Bar dataKey="amount" name={label} fill={color} maxBarSize={14} radius={[0, 4, 4, 0]} isAnimationActive={false} cursor="pointer"
        background={{ fill: '#f3f5f8', radius: 4 }} onClick={(entry) => onPick(entry.payload?.ckey ?? entry.ckey)}>
        <LabelList dataKey="amount" position="right" offset={8}
          content={({ x, y, width, height, index }) => {
            const row = data[index];
            return <text x={x + width + 8} y={y + height / 2} dy={4} fontSize={11} fill="#26364e">
              <tspan fontWeight={700}>{compact(row.amount)}</tspan><tspan fill="#8290a5">{`  ${pct(row.share, 0)}`}</tspan>
            </text>;
          }} />
      </Bar>
    </BarChart>
  </ResponsiveContainer>;
});

// 미수금 경과 기간: 하나의 전체를 나눈 큰 비율 막대 (6칸 이하) + 이름 범례
// 경과 구간 마우스 올림: 그 구간에 남은 미수금의 거래처 (금액 큰 순 · 가장 오래된 매출일)
const agingBreakdown = (row, total) => ({
  title: `${row.label} 미수금`,
  rows: [
    { op: '=', label: `${toNumber(row.customer_count)}곳`, hint: total ? `전체 미수금의 ${pct((toNumber(row.amount) / total) * 100)}` : '', value: won(row.amount), strong: true },
    ...(row.customers || []).map((customer) => ({
      op: '·', label: customer.customname || customer.customcode || '',
      hint: customer.oldest ? `가장 오래된 매출 ${dateText(customer.oldest)}` : '기초잔액 (날짜 미상)',
      value: won(customer.amount),
    })),
  ],
  note: toNumber(row.customer_count) > (row.customers || []).length
    ? `외 ${toNumber(row.customer_count) - row.customers.length}곳 · 오래된 매출부터 수금된 것으로 계산`
    : '오래된 매출부터 수금된 것으로 계산 (선입선출)',
});
const AgingHover = ({ row, total, children }) => (toNumber(row.amount) > 0
  ? <HoverCard width={320} position="bottom-start" withArrow shadow="md" openDelay={120} closeDelay={80} withinPortal>
    <HoverCard.Target>{children}</HoverCard.Target>
    <HoverCard.Dropdown p={0}><KpiBreakdown breakdown={agingBreakdown(row, total)} palette={KPI_PALETTE.blue} /></HoverCard.Dropdown>
  </HoverCard>
  : children);

function AgingBar({ aging }) {
  const total = aging.reduce((sum, row) => sum + toNumber(row.amount), 0);
  if (!total) return <Empty text="남은 미수금이 없습니다." />;
  const parts = aging.filter((row) => toNumber(row.amount) > 0);
  return <div className={classes.aging}>
    <div className={classes.agingBar} role="img" aria-label={`미수금 경과 기간: ${parts.map((row) => `${row.label} ${won(row.amount)}`).join(', ')}`}>
      {parts.map((row) => {
        const share = (toNumber(row.amount) / total) * 100;
        return <AgingHover key={row.key} row={row} total={total}>
          <div className={classes.agingPart} style={{ width: `${share}%`, background: AGING_COLORS[row.key] || AGING_COLORS.unknown }} tabIndex={0}>
            {share >= 12 && <span className={row.key === 'd30' ? classes.agingTextDark : classes.agingText}>{pct(share, 0)}</span>}
          </div>
        </AgingHover>;
      })}
    </div>
    <div className={classes.agingLegend}>
      {aging.map((row) => <AgingHover key={row.key} row={row} total={total}>
        <div className={`${classes.agingRow} ${toNumber(row.amount) > 0 ? classes.agingRowHover : ''}`}>
          <span className={classes.swatch} style={{ background: AGING_COLORS[row.key] || AGING_COLORS.unknown }} />
          <span className={classes.agingName}>{row.label}</span>
          <span className={classes.agingAmount}>{won(row.amount)}</span>
        </div>
      </AgingHover>)}
    </div>
  </div>;
}

// 월별 흐름: 증가(매출/매입) · 감소(수금/지급) 막대
const FlowBars = memo(function FlowBars({ trend, side }) {
  const isRecv = side === 'recv';
  const data = trend.map((row) => ({ name: monthLabel(row.month), fullName: row.month, plus: toNumber(isRecv ? row.sales : row.purchase), minus: toNumber(isRecv ? row.receipt : row.payment) }));
  return <ResponsiveContainer width="100%" height={230}>
    <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2} barCategoryGap="28%">
      <CartesianGrid vertical={false} stroke="#eef1f5" />
      <XAxis dataKey="name" tick={AXIS_TICK} axisLine={{ stroke: '#d5dbe3' }} tickLine={false} />
      <YAxis tickFormatter={compact} width={56} tick={{ fontSize: 10, fill: '#8b95a3' }} axisLine={false} tickLine={false} />
      <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f3f6fa' }} />
      <Legend verticalAlign="top" align="right" height={24} iconSize={9} wrapperStyle={{ fontSize: 11 }} />
      <Bar dataKey="plus" name={isRecv ? '매출' : '매입'} fill={isRecv ? COLOR.sales : COLOR.purchase} maxBarSize={12} radius={[4, 4, 0, 0]} isAnimationActive={false} />
      <Bar dataKey="minus" name={isRecv ? '수금' : '지급'} fill={isRecv ? COLOR.receipt : COLOR.payment} maxBarSize={12} radius={[4, 4, 0, 0]} isAnimationActive={false} />
    </BarChart>
  </ResponsiveContainer>;
});

function FlowTable({ trend, side }) {
  const isRecv = side === 'recv';
  return <div className={classes.tableScroll}><table className={classes.table}>
    <thead><tr><th>월</th><th className={classes.num}>{isRecv ? '매출' : '매입'}</th><th className={classes.num}>{isRecv ? '수금' : '지급'}</th><th className={classes.num}>{isRecv ? '월말 미수금' : '월말 미지급금'}</th></tr></thead>
    <tbody>{trend.map((row) => <tr key={row.month}>
      <td>{row.month}</td>
      <td className={classes.num}>{won(isRecv ? row.sales : row.purchase)}</td>
      <td className={classes.num}>{won(isRecv ? row.receipt : row.payment)}</td>
      <td className={`${classes.num} ${classes.strong}`}>{won(isRecv ? row.recv_balance : row.pay_balance)}</td>
    </tr>)}</tbody>
  </table></div>;
}

// 카드 마우스 올림: 숫자 구성 (서버 data.breakdown · summary). optional 줄은 0이면 숨긴다.
const pruneRows = (rows) => rows.filter((row) => !row.optional || Math.round(toNumber(row.raw)) !== 0);
function buildBreakdowns(data) {
  const s = data.summary;
  const b = data.breakdown || {};
  const r = (op, label, raw, extra = {}) => ({ op, label, raw, value: won(raw), ...extra });
  const period = `${String(data.date_from).slice(0, 10)} ~ ${String(data.as_of).slice(0, 10)}`;
  const salesHint = `매출 공급가 ${won(b.sales_goods)} + 매출비용(+) ${won(b.sales_plus)}`;
  const purchaseHint = `매입 공급가 ${won(b.purchase_goods)} + 매입 기타비용 ${won(b.purchase_exp)} + 매출비용 '예' ${won(b.purchase_cost)} + 가공금액 ${won(b.purchase_process)}`;
  const receiptRows = pruneRows([
    r('', '현금', b.r_cash, { hint: '수금 전표' }),
    r('+', '어음/수표', b.r_inst, { hint: '외상매출채권 포함', optional: true }),
    r('+', '상계', b.r_offset, { optional: true }),
    r('+', '잡손실', b.r_loss, { optional: true }),
    r('−', '잡이익', b.r_gain, { optional: true }),
    r('+', '지급 전표의 상계', b.r_cross_offset, { hint: '상계는 미수 · 미지급 양쪽에서 빠짐', optional: true }),
    r('−', '부도', b.r_dishonor, { hint: '받은 어음 부도 → 수금 되돌림', optional: true }),
  ]);
  const paymentRows = pruneRows([
    r('', '현금', b.p_cash, { hint: '지급 전표' }),
    r('+', '어음/수표', b.p_inst, { hint: '배서 · 발행 어음', optional: true }),
    r('+', '상계', b.p_offset, { optional: true }),
    r('−', '잡손실', b.p_loss, { optional: true }),
    r('+', '잡이익', b.p_gain, { optional: true }),
    r('+', '수금 전표의 상계', b.p_cross_offset, { hint: '상계는 미수 · 미지급 양쪽에서 빠짐', optional: true }),
    r('−', '부도', b.p_dishonor, { hint: '넘겨준 어음 부도 → 지급 되돌림', optional: true }),
  ]);
  return {
    recv: { title: '채권 (미수금) 계산', rows: pruneRows([
      r('', '기초 미수금', s.open_receivable, { hint: '시작일 전날 잔액 (거래처관리 기초잔액 + 이전 거래)' }),
      r('+', '기간 매출', s.period_sales, { hint: salesHint }),
      r('−', '기간 수금', s.period_receipt, { hint: '현금 · 어음 · 상계 · 잡손실/잡이익 · 부도' }),
      r('=', '기말 미수금', s.receivable, { strong: true }),
      r('·', '그중 선수금', -toNumber(b.advance_amount), { hint: `미수금이 마이너스인 거래처 ${toNumber(b.advance_count)}곳 (매출보다 더 받음)`, optional: true }),
    ]), note: `${period} · 거래처원장 기말 미수금 합계와 같음 · 공급가 기준` },
    pay: { title: '채무 (미지급금) 계산', rows: pruneRows([
      r('', '기초 미지급금', s.open_payable, { hint: '시작일 전날 잔액 (거래처관리 기초잔액 + 이전 거래)' }),
      r('+', '기간 매입', s.period_purchase, { hint: purchaseHint }),
      r('−', '기간 지급', s.period_payment, { hint: '현금 · 어음 · 상계 · 잡손실/잡이익 · 부도' }),
      r('=', '기말 미지급금', s.payable, { strong: true }),
      r('·', '그중 선급금', -toNumber(b.prepaid_amount), { hint: `미지급금이 마이너스인 거래처 ${toNumber(b.prepaid_count)}곳 (매입보다 더 줌)`, optional: true }),
    ]), note: `${period} · 거래처원장 기말 미지급금 합계와 같음 · 공급가 기준` },
    net: { title: '순잔액 계산', rows: [
      r('', '기말 미수금 (채권)', s.receivable),
      r('−', '기말 미지급금 (채무)', s.payable),
      r('=', '기말 순잔액', s.net, { strong: true }),
      r('', '기초 순잔액', s.open_net, { hint: '기초 미수금 − 기초 미지급금' }),
    ], note: `기간 변화 ${toNumber(s.net) - toNumber(s.open_net) >= 0 ? '+' : '−'}${won(Math.abs(toNumber(s.net) - toNumber(s.open_net)))}` },
    rate: { title: '회수율 계산', rows: [
      ...receiptRows,
      r('=', '기간 수금', s.period_receipt),
      r('÷', '기간 매출', s.period_sales, { hint: salesHint }),
      { op: '=', label: '기간 회수율', value: toNumber(s.period_sales) > 0 ? pct((toNumber(s.period_receipt) / toNumber(s.period_sales)) * 100, 2) : '–', strong: true },
    ], note: period },
    payment: { title: '기간 지급 구성', rows: [
      ...paymentRows,
      r('=', '기간 지급', s.period_payment, { strong: true }),
      r('', '기간 매입', s.period_purchase, { hint: purchaseHint }),
    ], note: `${period} · 매입 대비 지급 ${toNumber(s.period_purchase) > 0 ? pct((toNumber(s.period_payment) / toNumber(s.period_purchase)) * 100) : '–'}` },
  };
}

const KIND_COLOR = { 선수금: 'blue', 선급금: 'orange', '장기 미정리': 'gray' };

// 숫자에서 바로 읽을 수 있는 요점 문장 (모두 화면 데이터로 계산)
function buildInsights(data) {
  const { summary, top_receivable: topRecv, aging, attention, trend } = data;
  const items = [];
  const receivable = toNumber(summary.receivable);
  if (receivable > 0 && topRecv.length) {
    const top3 = topRecv.slice(0, 3).reduce((sum, row) => sum + toNumber(row.amount), 0);
    const share = (top3 / receivable) * 100;
    items.push({ tone: share >= 70 ? 'warn' : 'info', text: <>미수금의 <b>{pct(share, 0)}</b>가 상위 {Math.min(3, topRecv.length)}곳({topRecv.slice(0, 3).map((row) => row.customname).join(', ')})에 몰려 있습니다.</> });
  }
  const late = aging.filter((row) => ['d60', 'd90', 'over90'].includes(row.key)).reduce((sum, row) => sum + toNumber(row.amount), 0);
  const over90 = toNumber(aging.find((row) => row.key === 'over90')?.amount);
  if (late > 0) items.push({ tone: over90 > 0 ? 'bad' : 'warn', text: <>30일 넘게 회수되지 않은 미수금 <b>{won(late)}</b>{over90 > 0 ? <> (그중 90일 초과 <b>{won(over90)}</b>)</> : null} — 회수 독촉이 필요합니다.</> });
  else if (receivable > 0) items.push({ tone: 'good', text: <>미수금은 모두 <b>30일 이내</b> 매출에서 생긴 금액입니다.</> });
  const sales = toNumber(summary.period_sales);
  const receipt = toNumber(summary.period_receipt);
  if (sales || receipt) {
    const gap = receipt - sales;
    items.push({ tone: gap >= 0 ? 'good' : 'info', text: gap >= 0
      ? <>기간 중 수금이 매출보다 <b>{won(gap)}</b> 많아 미수금이 줄었습니다.</>
      : <>기간 중 매출이 수금보다 <b>{won(-gap)}</b> 많아 미수금이 늘었습니다.</> });
  }
  const prepaid = attention.filter((row) => row.kind === '선급금');
  if (prepaid.length) {
    const amount = prepaid.reduce((sum, row) => sum + Math.abs(toNumber(row.pay)), 0);
    items.push({ tone: 'info', text: <>선급금이 <b>{prepaid.length}곳 {won(amount)}</b> 있습니다. 매입으로 정리됐는지 확인하세요.</> });
  }
  const advance = attention.filter((row) => row.kind === '선수금');
  if (advance.length) {
    const amount = advance.reduce((sum, row) => sum + Math.abs(toNumber(row.recv)), 0);
    items.push({ tone: 'info', text: <>선수금이 <b>{advance.length}곳 {won(amount)}</b> 있습니다.</> });
  }
  const dormant = attention.filter((row) => row.kind === '장기 미정리').length;
  if (dormant) items.push({ tone: 'warn', text: <>90일 넘게 거래 없이 잔액이 남은 거래처가 <b>{dormant}곳</b> 있습니다.</> });
  if (trend.length >= 2) {
    const first = toNumber(trend[0].recv_balance);
    const last = toNumber(trend[trend.length - 1].recv_balance);
    if (first > 0) items.push({ tone: last <= first ? 'good' : 'info', text: <>{trend.length}개월 전보다 미수금이 <b>{last >= first ? '+' : '−'}{pct(Math.abs((last - first) / first) * 100, 0)}</b> {last >= first ? '늘었습니다' : '줄었습니다'}.</> });
  }
  return items;
}

export default function CustomerBalanceDashboard() {
  const ribbon = useContext(PageRibbonContext);
  const registerRibbon = ribbon?.registerPageRibbon;
  const closePage = ribbon?.closeActivePage;
  const navigate = useNavigate();
  const [inputs, setInputs] = useState(defaultPeriod);
  const [period, setPeriod] = useState(defaultPeriod);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [flowSide, setFlowSide] = useState('recv');
  const [flowView, setFlowView] = useState('chart');
  const requestRef = useRef(0);

  // 금액은 공급가 기준 (거래처원장 기본과 같음)
  const load = useCallback(async (range) => {
    const requestId = ++requestRef.current;
    setLoading(true);
    try {
      const response = await axios.get('/api/customer-balance-dashboard', { ...authConfig(), params: { date_from: range.date_from, as_of: range.date_to } });
      if (requestId === requestRef.current) setData(response.data);
    } catch (error) {
      if (requestId === requestRef.current) notifications.show({ title: '거래처 잔액 현황 조회 실패', message: error.response?.data?.detail || '현황을 불러오지 못했습니다.', color: 'red' });
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, []);
  useEffect(() => { void load(period); }, [load, period]);
  usePageReactivated(() => { void load(period); });

  const search = useCallback(() => {
    if (!inputs.date_from || !inputs.date_to) {
      notifications.show({ title: '조회기간 확인', message: '시작일과 종료일을 입력해 주세요.', color: 'orange' });
      return;
    }
    if (inputs.date_from > inputs.date_to) {
      notifications.show({ title: '조회기간 확인', message: '시작일은 종료일보다 뒤일 수 없습니다.', color: 'orange' });
      return;
    }
    if (inputs.date_from === period.date_from && inputs.date_to === period.date_to) void load(period); else setPeriod({ ...inputs });
  }, [inputs, period, load]);

  const openLedger = useCallback((ckey) => { if (ckey) navigate(`/CustomerLedger?ckey=${encodeURIComponent(ckey)}`); }, [navigate]);

  const exportExcel = useCallback(() => {
    if (!data) return;
    const workbook = XLSX.utils.book_new();
    const add = (rows, name, width) => {
      const sheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{ 내용: '데이터 없음' }]);
      applyExcelHeaderStyle(sheet, width);
      XLSX.utils.book_append_sheet(workbook, sheet, name);
    };
    add(data.top_receivable.map((row) => ({ 거래처코드: row.customcode, 거래처명: row.customname, 미수금: toNumber(row.amount) })), '미수금상위', 3);
    add(data.top_payable.map((row) => ({ 거래처코드: row.customcode, 거래처명: row.customname, 미지급금: toNumber(row.amount) })), '미지급금상위', 3);
    add(data.aging.map((row) => ({ 경과기간: row.label, 미수금: toNumber(row.amount) })), '미수금경과기간', 2);
    add(data.trend.map((row) => ({ 월: row.month, 매출: toNumber(row.sales), 수금: toNumber(row.receipt), 월말미수금: toNumber(row.recv_balance), 매입: toNumber(row.purchase), 지급: toNumber(row.payment), 월말미지급금: toNumber(row.pay_balance) })), '월별추이', 7);
    add(data.attention.map((row) => ({ 구분: row.kind, 거래처코드: row.customcode, 거래처명: row.customname, 내용: row.text, 미수금: toNumber(row.recv), 미지급금: toNumber(row.pay), 마지막거래: dateText(row.last) })), '주의거래처', 7);
    XLSX.writeFile(workbook, `채권채무요약_${String(data.date_from).slice(0, 10).replaceAll('-', '')}_${String(data.as_of).slice(0, 10).replaceAll('-', '')}.xlsx`);
  }, [data]);

  const ribbonActions = useRef({});
  useLayoutEffect(() => { ribbonActions.current = { search, excel: exportExcel }; });
  const excelDisabled = !data;
  useEffect(() => {
    if (!registerRibbon) return undefined;
    registerRibbon(
      <Group className={searchClasses.commandRibbon} justify="flex-start" wrap="nowrap" gap={2}>
        <Button className={searchClasses.ribbonTool} variant="subtle" size="sm" leftSection={<IconSearch size={15} />} onClick={() => ribbonActions.current.search()}>조회</Button>
        <span className={searchClasses.ribbonSeparator} />
        <Button className={searchClasses.ribbonTool} variant="subtle" size="sm" leftSection={<IconPlus size={15} />} disabled>추가</Button>
        <Button className={searchClasses.ribbonTool} variant="subtle" size="sm" leftSection={<IconCopy size={15} />} disabled>복사</Button>
        <Button className={searchClasses.ribbonTool} variant="subtle" size="sm" leftSection={<IconDeviceFloppy size={15} />} disabled>저장</Button>
        <Button className={searchClasses.ribbonTool} variant="subtle" size="sm" leftSection={<IconTrash size={15} />} disabled>삭제</Button>
        <Button className={searchClasses.ribbonTool} variant="subtle" size="sm" leftSection={<IconFileSpreadsheet size={15} />} onClick={() => ribbonActions.current.excel()} disabled={excelDisabled}>엑셀</Button>
        <span className={searchClasses.ribbonSeparator} />
        <Button className={searchClasses.ribbonTool} variant="subtle" size="sm" leftSection={<IconX size={15} />} onClick={closePage}>닫기</Button>
      </Group>,
    );
    return () => registerRibbon(null);
  }, [registerRibbon, closePage, excelDisabled]);

  // 비교 기준 = 시작일 전날 잔액 (서버 summary.open_*), 회수율 = 기간 수금 ÷ 기간 매출
  const derived = useMemo(() => {
    if (!data) return null;
    const trend = data.trend || [];
    const { summary: s } = data;
    const periodRate = toNumber(s.period_sales) > 0 ? (toNumber(s.period_receipt) / toNumber(s.period_sales)) * 100 : null;
    return {
      prevRecv: toNumber(s.open_receivable), prevPay: toNumber(s.open_payable), prevNet: toNumber(s.open_net),
      periodRate,
      periodText: `${shortDate(data.date_from)} ~ ${shortDate(data.as_of)}`,
      trendMonths: trend.length,
      peakRecv: trend.reduce((best, row) => (toNumber(row.recv_balance) > best.value ? { value: toNumber(row.recv_balance), month: row.month } : best), { value: 0, month: '' }),
      avgRate: (() => {
        const salesSum = trend.reduce((sum, row) => sum + toNumber(row.sales), 0);
        return salesSum > 0 ? (trend.reduce((sum, row) => sum + toNumber(row.receipt), 0) / salesSum) * 100 : null;
      })(),
      late: (data.aging || []).filter((row) => ['d60', 'd90', 'over90'].includes(row.key)).reduce((sum, row) => sum + toNumber(row.amount), 0),
      prepaid: (data.attention || []).filter((row) => row.kind === '선급금').length,
      insights: buildInsights(data),
      breakdowns: buildBreakdowns(data),
    };
  }, [data]);

  const summary = data?.summary;
  const net = toNumber(summary?.net);
  return (
    <Box className={`${simpleTheme.simple} ${sharedClasses.pageShell} ${searchClasses.page} ${classes.page}`}>
      <DashboardHeader parent="장부관리" title="채권채무요약">
        <FilterBox label="조회기간" onSearch={search} loading={loading}>
          <ErpDateInput aria-label="시작일" type="date" value={inputs.date_from} onChange={(event) => { const { value } = event.currentTarget; setInputs((current) => ({ ...current, date_from: value })); }} />
          <FilterTilde />
          <ErpDateInput aria-label="종료일" type="date" value={inputs.date_to} onChange={(event) => { const { value } = event.currentTarget; setInputs((current) => ({ ...current, date_to: value })); }} />
        </FilterBox>
      </DashboardHeader>

      <div className={classes.scroll}>
        {summary && derived ? <KpiGrid count={5}>
          <KpiCard breakdown={derived.breakdowns.recv} palette={KPI_PALETTE.blue} icon={IconCoins} label="미수금" basis="채권 · 기말" value={Math.round(toNumber(summary.receivable)).toLocaleString('ko-KR')}
            trend={<TrendPill mode="diff" current={summary.receivable} previous={derived.prevRecv} goodWhenUp={false} format={compact} unit="원" note="기초 대비" emptyText="비교 없음" />}
            stats={[{ label: '채권 거래처', value: `${summary.receivable_customers}곳` }, { label: '30일 넘게 밀림', value: derived.late > 0 ? `${compact(derived.late)}원` : '없음', warn: derived.late > 0 }]} />
          <KpiCard breakdown={derived.breakdowns.pay} palette={KPI_PALETTE.orange} icon={IconReceipt} label="미지급금" basis="채무 · 기말" value={Math.round(toNumber(summary.payable)).toLocaleString('ko-KR')}
            trend={<TrendPill mode="diff" current={summary.payable} previous={derived.prevPay} neutral format={compact} unit="원" note="기초 대비" emptyText="비교 없음" />}
            stats={[{ label: '채무 거래처', value: `${summary.payable_customers}곳` }, { label: '선급금 거래처', value: derived.prepaid ? `${derived.prepaid}곳` : '없음', warn: derived.prepaid > 0 }]} />
          <KpiCard breakdown={derived.breakdowns.net} palette={KPI_PALETTE.slate} icon={IconScale} label="순잔액" basis="채권 − 채무" value={Math.round(net).toLocaleString('ko-KR')} negative={net < 0}
            trend={<TrendPill mode="diff" current={net} previous={derived.prevNet} format={compact} unit="원" note="기초 대비" emptyText="비교 없음" />}
            stats={[{ label: '상태', value: net < 0 ? '채무가 더 많음' : '채권이 더 많음', warn: net < 0, good: net >= 0 }, { label: '기초', value: `${compact(derived.prevNet)}원` }]} />
          <KpiCard breakdown={derived.breakdowns.rate} palette={KPI_PALETTE.green} icon={IconPercentage} label="기간 회수율" basis="매출 중 수금한 비율" value={derived.periodRate === null ? '–' : derived.periodRate.toFixed(1)} unit={derived.periodRate === null ? '' : '%'}
            trend={<PillNote>{derived.periodRate === null ? '기간 매출 없음' : derived.periodText}</PillNote>}
            stats={[{ label: '수금', value: `${compact(summary.period_receipt)}원` }, { label: '매출', value: `${compact(summary.period_sales)}원` }]} />
          <KpiCard breakdown={derived.breakdowns.payment} palette={KPI_PALETTE.amber} icon={IconCash} label="기간 지급" basis="기간에 지급한 돈" value={Math.round(toNumber(summary.period_payment)).toLocaleString('ko-KR')}
            trend={<PillNote>{derived.periodText}</PillNote>}
            stats={[{ label: '매입', value: `${compact(summary.period_purchase)}원` }, { label: '매입 대비 지급', value: toNumber(summary.period_purchase) > 0 ? pct((toNumber(summary.period_payment) / toNumber(summary.period_purchase)) * 100) : '–' }]} />
        </KpiGrid> : <Empty loading={loading} />}

        <div className={classes.row2_1}>
          <Panel title="월말 잔액 추이" sub={`${derived?.trendMonths || 0}개월 · 진한 막대 = 종료월`}>
            {data && derived ? <>
              <div className={classes.monthSummary}>
                <div className={classes.monthStat}><span className={classes.monthStatLabel}><i className={classes.swatch} style={{ background: COLOR.recv }} />기말 미수금</span><span className={classes.monthStatValue}>{compact(summary.receivable)}원</span><span className={classes.statTrend}><TrendPill mode="diff" current={summary.receivable} previous={derived.prevRecv} goodWhenUp={false} format={compact} unit="원" note="기초 대비" emptyText="비교 없음" /></span></div>
                <div className={classes.monthStat}><span className={classes.monthStatLabel}><i className={classes.swatch} style={{ background: COLOR.pay }} />기말 미지급금</span><span className={classes.monthStatValue}>{compact(summary.payable)}원</span><span className={classes.statTrend}><TrendPill mode="diff" current={summary.payable} previous={derived.prevPay} neutral format={compact} unit="원" note="기초 대비" emptyText="비교 없음" /></span></div>
                <div className={classes.monthStat}><span className={classes.monthStatLabel}>{derived.trendMonths}개월 최고 미수금</span><span className={classes.monthStatValue}>{compact(derived.peakRecv.value)}원</span><span className={classes.statTrend}><PillNote>{derived.peakRecv.month ? `${Number(derived.peakRecv.month.slice(5, 7))}월말` : '–'}</PillNote></span></div>
                <div className={classes.monthStat}><span className={classes.monthStatLabel}>{derived.trendMonths}개월 평균 회수율</span><span className={classes.monthStatValue}>{derived.avgRate === null ? '–' : pct(derived.avgRate)}</span><span className={classes.statTrend}><PillNote>수금 ÷ 매출 ({derived.trendMonths}개월 합계)</PillNote></span></div>
              </div>
              <div className={classes.monthLegend}>
                <span><i className={classes.swatch} style={{ background: COLOR.recv }} />미수금</span>
                <span><i className={classes.swatch} style={{ background: COLOR.pay }} />미지급금</span>
              </div>
              <BalanceTrend trend={data.trend} />
            </> : <Empty loading={loading} />}
          </Panel>
          <Paper className={`${classes.panel} ${classes.flowPanel}`} withBorder>
            <div className={classes.flowTop}>
              <span className={classes.flowTitle}>기간 자금 흐름 <small>{derived?.periodText}</small></span>
              {summary ? <>
                <div className={classes.flowRow}><span>채권 <small>수금</small></span><b className={classes.flowIn}>+{compact(summary.period_receipt)}원</b></div>
                <div className={classes.flowRow}><span>채무 <small>지급</small></span><b className={classes.flowOut}>−{compact(summary.period_payment)}원</b></div>
                <div className={`${classes.flowRow} ${classes.flowNet}`}><span>차이</span><b>{toNumber(summary.period_receipt) - toNumber(summary.period_payment) >= 0 ? '+' : '−'}{compact(Math.abs(toNumber(summary.period_receipt) - toNumber(summary.period_payment)))}원</b></div>
              </> : <span className={classes.flowEmpty}>{loading ? '불러오는 중…' : '데이터가 없습니다.'}</span>}
            </div>
            <div className={classes.pointHead}><span className={classes.pointTitle}><IconBulb size={16} stroke={1.9} />한눈에 보는 요점</span><span className={classes.pointSub}>이 화면의 숫자로 자동 작성</span></div>
            {derived ? (derived.insights.length
              ? <ol className={classes.points}>{derived.insights.map((item, index) => <li key={index} className={classes[`point_${item.tone}`]}>
                <span className={classes.pointRank}>{item.tone === 'bad' || item.tone === 'warn' ? <IconAlertTriangle size={12} stroke={2.2} /> : index + 1}</span>
                <span className={classes.pointText}>{item.text}</span>
              </li>)}</ol>
              : <Empty text="특이사항이 없습니다." />) : <Empty loading={loading} />}
          </Paper>
        </div>

        <div className={classes.row3}>
          <Panel title="미수금 상위 거래처" sub="상위 10곳 · 금액 / 전체 대비 비중 · 막대를 누르면 원장">
            {data ? <TopBars rows={data.top_receivable} total={toNumber(data.summary.receivable)} color={COLOR.recv} label="미수금" onPick={openLedger} /> : <Empty loading={loading} />}
          </Panel>
          <Panel title="미지급금 상위 거래처" sub="상위 10곳 · 금액 / 전체 대비 비중 · 막대를 누르면 원장">
            {data ? <TopBars rows={data.top_payable} total={toNumber(data.summary.payable)} color={COLOR.pay} label="미지급금" onPick={openLedger} /> : <Empty loading={loading} />}
          </Panel>
          <Panel title="미수금 경과 기간" sub="오래된 매출부터 수금된 것으로 계산 (선입선출)">
            {data ? <>
              <AgingBar aging={data.aging} />
              {data.overdue.length > 0 && <div className={classes.overdue}>
                <Text className={classes.overdueTitle}>30일 넘은 미수금 거래처</Text>
                {data.overdue.slice(0, 5).map((row) => <button key={row.ckey} type="button" className={classes.overdueRow} onClick={() => openLedger(row.ckey)} title="누르면 거래처원장">
                  <span>{row.customname}</span><b>{won(row.over30)}</b>
                </button>)}
              </div>}
            </> : <Empty loading={loading} />}
          </Panel>
        </div>

        <div className={classes.row2_1}>
          <Panel title="월별 흐름" sub={`${flowSide === 'recv' ? '매출 vs 수금' : '매입 vs 지급'} · ${derived?.trendMonths || 0}개월`}
            action={<Group gap={8} wrap="nowrap">
              <SegmentedControl size="xs" color="red" value={flowSide} onChange={setFlowSide} data={[{ value: 'recv', label: '미수금' }, { value: 'pay', label: '미지급금' }]} />
              <SegmentedControl size="xs" value={flowView} onChange={setFlowView} data={[{ value: 'chart', label: '그래프' }, { value: 'table', label: '표' }]} />
            </Group>}>
            {data ? (flowView === 'chart' ? <FlowBars trend={data.trend} side={flowSide} /> : <FlowTable trend={data.trend} side={flowSide} />) : <Empty loading={loading} />}
          </Panel>
          <Panel title="주의 거래처" sub="선수금 · 선급금 거래처 · 90일 넘게 거래 없이 잔액이 남은 거래처">
            {data ? (data.attention.length
              ? <div className={classes.attention}>{data.attention.slice(0, 12).map((row) => <button key={`${row.ckey}:${row.kind}`} type="button" className={classes.attentionRow} onClick={() => openLedger(row.ckey)} title="누르면 거래처원장">
                <Badge size="sm" variant="light" color={KIND_COLOR[row.kind] || 'gray'}>{row.kind}</Badge>
                <span className={classes.attentionName}>{row.customname}</span>
                <span className={classes.attentionText}>{row.text}</span>
              </button>)}
                {data.attention.length > 12 && <Text size="xs" c="dimmed" ta="right" mt={4}>외 {data.attention.length - 12}곳 (엑셀에서 전체 확인)</Text>}
              </div>
              : <Empty text="주의할 거래처가 없습니다." />) : <Empty loading={loading} />}
          </Panel>
        </div>
      </div>
    </Box>
  );
}
