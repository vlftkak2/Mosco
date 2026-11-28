// 대시보드 월별 매출 차트. 차트 라이브러리(recharts)가 커서 따로 받는다:
// 카드 · 표 · 오늘 칸은 차트를 기다리지 않고 바로 그려지고, 차트는 받는 대로 붙는다 (화면 코드와 동시에 받기 시작).
import { memo } from 'react';
import { Paper, Text } from '@mantine/core';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { FillChart } from '../../components/common/DashboardKit';
import classes from '../../styles/pages/HomeDashboard.module.css';

const COST_COLOR = { past: '#dbe3ee', current: '#9fb1c8' };
const PROFIT_COLOR = { past: '#a9e0c9', current: '#1baf7a' };
const SALES_COLOR = { past: '#bcd6f3', current: '#2a78d6' };
const AXIS_TICK = { fontSize: 11, fill: '#5d6b80' };

// 월별 매출 = 비용 + 매출이익 (쌓은 막대, 금액 축 하나) · 조회한 달은 진하게, 막대 위에 매출 합계
const HomeMonthlyChart = memo(function HomeMonthlyChart({ data, showProfit, compact, won, kgWeight, pctText }) {
  const last = data.length - 1;
  return <FillChart><ResponsiveContainer width="100%" height="100%">
    <BarChart data={data} margin={{ top: 20, right: 8, bottom: 0, left: 0 }} barCategoryGap="28%">
      <CartesianGrid vertical={false} stroke="#eef1f5" />
      <XAxis dataKey="name" tick={AXIS_TICK} axisLine={{ stroke: '#d5dbe3' }} tickLine={false} />
      <YAxis tickFormatter={compact} width={52} tick={{ fontSize: 10, fill: '#8b95a3' }} axisLine={false} tickLine={false} />
      <Tooltip cursor={{ fill: '#f3f6fa' }} content={({ active, payload }) => {
        if (!active || !payload?.length) return null;
        const row = payload[0].payload;
        return <Paper className={classes.tooltip} withBorder shadow="sm">
          <Text size="xs" fw={700} mb={4}>{row.month}</Text>
          {showProfit ? <>
            <div className={classes.tooltipRow}><span className={classes.swatch} style={{ background: PROFIT_COLOR.current }} />매출이익<b>{won(row.profit)}</b></div>
            <div className={classes.tooltipRow}><span className={classes.swatch} style={{ background: COST_COLOR.current }} />비용<b>{won(row.cost)}</b></div>
            <div className={`${classes.tooltipRow} ${classes.tooltipTotal}`}><span className={classes.swatch} style={{ background: 'transparent' }} />매출<b>{won(row.sales)}</b></div>
            <div className={classes.tooltipRow}><span className={classes.swatch} style={{ background: 'transparent' }} />마진율<b>{pctText(row.margin)}</b></div>
          </> : <div className={classes.tooltipRow}><span className={classes.swatch} style={{ background: SALES_COLOR.current }} />매출<b>{won(row.sales)}</b></div>}
          <div className={classes.tooltipRow}><span className={classes.swatch} style={{ background: 'transparent' }} />판매중량<b>{kgWeight(row.weight)}</b></div>
        </Paper>;
      }} />
      {showProfit ? <>
        <Bar dataKey="costPart" stackId="sales" name="비용" maxBarSize={30} isAnimationActive={false}>
          {data.map((row, index) => <Cell key={row.month} fill={index === last ? COST_COLOR.current : COST_COLOR.past} />)}
        </Bar>
        <Bar dataKey="profitPart" stackId="sales" name="매출이익" maxBarSize={30} radius={[4, 4, 0, 0]} isAnimationActive={false}>
          {data.map((row, index) => <Cell key={row.month} fill={index === last ? PROFIT_COLOR.current : PROFIT_COLOR.past} />)}
          <LabelList dataKey="label" position="top" style={{ fontSize: 10.5, fill: '#33425a', fontWeight: 700 }} />
        </Bar>
      </> : <Bar dataKey="sales" name="매출" maxBarSize={30} radius={[4, 4, 0, 0]} isAnimationActive={false}>
        {data.map((row, index) => <Cell key={row.month} fill={index === last ? SALES_COLOR.current : SALES_COLOR.past} />)}
        <LabelList dataKey="label" position="top" style={{ fontSize: 10.5, fill: '#33425a', fontWeight: 700 }} />
      </Bar>}
    </BarChart>
  </ResponsiveContainer></FillChart>;
});

export default HomeMonthlyChart;
