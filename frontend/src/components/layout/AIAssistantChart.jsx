// AI 업무비서 답변 안 차트 · 표 (recharts 는 차트가 있는 답이 올 때만 불러온다)
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import classes from '../../styles/layout/AIAssistant.module.css';

const SERIES_COLORS = ['#2563EB', '#D9343A', '#16A34A'];
const fullNumber = (value) => (value === null || value === undefined ? '-' : Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 2 }));
const shortNumber = (value) => {
  const number = Number(value) || 0;
  const abs = Math.abs(number);
  if (abs >= 1e8) return `${(number / 1e8).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}억`;
  if (abs >= 1e4) return `${(number / 1e4).toLocaleString('ko-KR', { maximumFractionDigits: 0 })}만`;
  return number.toLocaleString('ko-KR', { maximumFractionDigits: 1 });
};
const looksNumeric = (text) => /^-?[\d,]+(\.\d+)?\s*(원|kg|톤|%|건|명)?$/.test(String(text || '').trim());

export default function AnswerChart({ chart }) {
  if (chart.kind === 'table') {
    return <div className={classes.chart}>
      {chart.title && <div className={classes.chartTitle}>{chart.title}</div>}
      <div className={classes.tableWrap}>
        <table className={classes.table}>
          <thead><tr>{chart.columns.map((column, index) => <th key={index}>{column}</th>)}</tr></thead>
          <tbody>{chart.rows.map((row, rowIndex) => <tr key={rowIndex}>
            {chart.columns.map((_, index) => <td key={index} className={looksNumeric(row[index]) ? classes.num : undefined}>{row[index] ?? ''}</td>)}
          </tr>)}</tbody>
        </table>
      </div>
    </div>;
  }
  const data = chart.labels.map((label, index) => {
    const point = { label };
    chart.series.forEach((series, seriesIndex) => { point[`s${seriesIndex}`] = series.values[index]; });
    return point;
  });
  const Chart = chart.kind === 'line' ? LineChart : BarChart;
  const tooltip = (value) => `${fullNumber(value)}${chart.unit ? ` ${chart.unit}` : ''}`;
  return <div className={classes.chart}>
    {chart.title && <div className={classes.chartTitle}>{chart.title}{chart.unit && <span>({chart.unit})</span>}</div>}
    <ResponsiveContainer width="100%" height={180}>
      <Chart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E2E5E9" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#8E95A2' }} interval="preserveStartEnd" tickLine={false} />
        <YAxis tick={{ fontSize: 10, fill: '#8E95A2' }} tickFormatter={shortNumber} width={44} tickLine={false} axisLine={false} />
        <Tooltip formatter={(value, name) => [tooltip(value), name]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
        {chart.series.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
        {chart.series.map((series, index) => (chart.kind === 'line'
          ? <Line key={index} type="monotone" dataKey={`s${index}`} name={series.name} stroke={SERIES_COLORS[index]} strokeWidth={2} dot={{ r: 2 }} connectNulls />
          : <Bar key={index} dataKey={`s${index}`} name={series.name} fill={SERIES_COLORS[index]} radius={[3, 3, 0, 0]} maxBarSize={28} />))}
      </Chart>
    </ResponsiveContainer>
  </div>;
}
