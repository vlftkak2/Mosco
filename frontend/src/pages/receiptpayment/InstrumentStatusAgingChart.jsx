// 수표/어음관리 만기 구간 막대 차트. 차트 라이브러리(recharts)가 커서 따로 받는다:
// 목록 · 요약 카드는 차트를 기다리지 않고 바로 그려지고, 차트는 받는 대로 붙는다.
import { Group, Paper, Text } from '@mantine/core';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import pageClasses from '../../styles/pages/InstrumentStatus.module.css';

function AgingTooltip({ active, payload, label, formatNumber }) {
  if (!active || !payload?.length) return null;
  return <Paper className={pageClasses.chartTooltip} shadow="sm" withBorder>
    <Text size="xs" fw={700} mb={6}>{label}</Text>
    {payload.map((entry) => <Group key={entry.dataKey} gap={6} wrap="nowrap" mb={2}>
      <span className={pageClasses.legendSwatch} style={{ background: entry.color }} />
      <Text size="xs" w={56}>{entry.name}</Text>
      <Text size="xs" fw={700} ml="auto">{formatNumber(entry.value)}원</Text>
      <Text size="xs" c="dimmed" w={34} ta="right">{entry.payload[`${entry.dataKey}_count`]}건</Text>
    </Group>)}
    <Text size="10px" c="dimmed" mt={6}>누르면 목록이 이 구간으로 걸러집니다</Text>
  </Paper>;
}

export default function InstrumentStatusAgingChart({ chartData, series, compactWon, formatNumber, onPickBucket }) {
  return <ResponsiveContainer width="100%" height="100%">
    <BarChart data={chartData} margin={{ top: 10, right: 8, bottom: 0, left: 0 }} barGap={2} barCategoryGap="30%">
      <CartesianGrid vertical={false} stroke="#eef1f5" />
      <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: '#d5dbe3' }} tick={{ fontSize: 11, fill: '#52514e' }} />
      <YAxis tickFormatter={compactWon} tickLine={false} axisLine={false} width={48} tick={{ fontSize: 10, fill: '#8b95a3' }} />
      <Tooltip content={<AgingTooltip formatNumber={formatNumber} />} cursor={{ fill: '#f3f6fa' }} />
      {series.map((item) => <Bar key={item.key} dataKey={item.key} name={item.label} fill={item.color} maxBarSize={22} radius={[4, 4, 0, 0]}
        isAnimationActive={false} cursor="pointer" onClick={(entry) => onPickBucket(entry.bucket ?? entry.payload?.bucket, item.key)} />)}
    </BarChart>
  </ResponsiveContainer>;
}
