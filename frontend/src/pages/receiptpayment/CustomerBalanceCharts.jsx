// 채권채무요약 차트들 (월말 잔액 추이 · 거래처 TOP 10 · 월별 흐름). 차트 라이브러리(recharts)가 커서 따로 받는다:
// 카드 · 경과 기간 · 표는 차트를 기다리지 않고 바로 그려지고, 차트는 받는 대로 붙는다 (화면 코드와 동시에 받기 시작).
import { memo } from 'react';
import { Group, Loader, Paper, Text } from '@mantine/core';
import {
  Bar, BarChart, Cell, CartesianGrid, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { FillChart } from '../../components/common/DashboardKit';
import classes from '../../styles/pages/CustomerBalanceDashboard.module.css';
import { COLOR, compact, monthLabel, pct, shortName, toNumber, won } from './CustomerBalanceFormat';

const AXIS_TICK = { fontSize: 11, fill: '#5d6b80' };
const Empty = ({ loading, text = '데이터가 없습니다.' }) => <div className={classes.empty}>{loading ? <Loader size="sm" color="red" /> : text}</div>;

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

// 미수금 · 미지급금 월말 잔액 (나란히 막대, 금액 축 하나) · 기준월만 진하게, 기준월 막대 위에 금액
const SOFT = { recv: '#bcd6f3', pay: '#f6c7b2' };
export const BalanceTrend = memo(function BalanceTrend({ trend }) {
  const last = trend.length - 1;
  const data = trend.map((row, index) => ({
    name: `${Number(String(row.month).slice(5, 7))}월`, fullName: row.month,
    recv: toNumber(row.recv_balance), pay: toNumber(row.pay_balance),
    recvLabel: index === last && toNumber(row.recv_balance) > 0 ? compact(row.recv_balance) : '',
    payLabel: index === last && toNumber(row.pay_balance) > 0 ? compact(row.pay_balance) : '',
  }));
  return <FillChart><ResponsiveContainer width="100%" height="100%">
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
  </ResponsiveContainer></FillChart>;
});

// 거래처 TOP 10: 한 가지 색의 순위 막대 + 전체 대비 비중
export const TopBars = memo(function TopBars({ rows, total, color, label, onPick }) {
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
          content={({ x, y, width, height, value }) => {
            // recharts 가 index 없이 부르는 경우가 있어(막대 1개일 때 등) 줄 대신 막대 값(value)으로 그린다
            if (value === undefined || value === null || x === undefined) return null;
            const amount = toNumber(value);
            return <text x={toNumber(x) + toNumber(width) + 8} y={toNumber(y) + toNumber(height) / 2} dy={4} fontSize={11} fill="#26364e">
              <tspan fontWeight={700}>{compact(amount)}</tspan><tspan fill="#8290a5">{`  ${pct(total ? (amount / total) * 100 : 0, 0)}`}</tspan>
            </text>;
          }} />
      </Bar>
    </BarChart>
  </ResponsiveContainer>;
});

// 월별 흐름: 증가(매출/매입) · 감소(수금/지급) 막대
export const FlowBars = memo(function FlowBars({ trend, side }) {
  const isRecv = side === 'recv';
  const data = trend.map((row) => ({ name: monthLabel(row.month), fullName: row.month, plus: toNumber(isRecv ? row.sales : row.purchase), minus: toNumber(isRecv ? row.receipt : row.payment) }));
  return <FillChart><ResponsiveContainer width="100%" height="100%">
    <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2} barCategoryGap="28%">
      <CartesianGrid vertical={false} stroke="#eef1f5" />
      <XAxis dataKey="name" tick={AXIS_TICK} axisLine={{ stroke: '#d5dbe3' }} tickLine={false} />
      <YAxis tickFormatter={compact} width={56} tick={{ fontSize: 10, fill: '#8b95a3' }} axisLine={false} tickLine={false} />
      <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f3f6fa' }} />
      <Legend verticalAlign="top" align="right" height={24} iconSize={9} wrapperStyle={{ fontSize: 11 }} />
      <Bar dataKey="plus" name={isRecv ? '매출' : '매입'} fill={isRecv ? COLOR.sales : COLOR.purchase} maxBarSize={12} radius={[4, 4, 0, 0]} isAnimationActive={false} />
      <Bar dataKey="minus" name={isRecv ? '수금' : '지급'} fill={isRecv ? COLOR.receipt : COLOR.payment} maxBarSize={12} radius={[4, 4, 0, 0]} isAnimationActive={false} />
    </BarChart>
  </ResponsiveContainer></FillChart>;
});

