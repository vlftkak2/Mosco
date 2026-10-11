import { useState } from 'react';
import {
  Badge,
  Group,
  Paper,
  SegmentedControl,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from '@mantine/core';
import {
  IconBell,
  IconCalendar,
  IconChartBar,
  IconClipboardList,
  IconCube,
  IconShoppingCart,
  IconTrendingUp,
  IconWallet,
} from '@tabler/icons-react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Cell,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import classes from '../styles/pages/HomePage.module.css';

const monthlyData = [
  { month: '5월', sales: 115000000, purchases: 92000000, profit: 23000000, salesKg: 1180, purchasesKg: 940, profitKg: 240 },
  { month: '6월', sales: 116000000, purchases: 90000000, profit: 26000000, salesKg: 1205, purchasesKg: 925, profitKg: 280 },
  { month: '7월', sales: 116000000, purchases: 88000000, profit: 28000000, salesKg: 1210, purchasesKg: 900, profitKg: 310 },
  { month: '8월', sales: 137000000, purchases: 107000000, profit: 30000000, salesKg: 1430, purchasesKg: 1100, profitKg: 330 },
  { month: '9월', sales: 128000000, purchases: 106000000, profit: 22000000, salesKg: 1335, purchasesKg: 1080, profitKg: 255 },
  { month: '10월', sales: 131000000, purchases: 112000000, profit: 19000000, salesKg: 1360, purchasesKg: 1145, profitKg: 215 },
];

const salesMix = [
  { name: '형강', share: 38, amount: 486343000, color: '#4f7fe8' },
  { name: '철판', share: 27, amount: 345559500, color: '#41b99a' },
  { name: '철근', share: 21, amount: 268695000, color: '#f0aa55' },
  { name: '기타', share: 14, amount: 179130500, color: '#a58add' },
];

const alerts = [
  {
    group: '재고 관리',
    title: '안전재고 미달 품목',
    description: '발주 기준 이하로 내려간 품목이 있어 재고 보충 확인이 필요합니다.',
    action: '3개 품목 확인 필요',
    icon: IconCube,
    state: '재고 점검',
    stateTone: 'warning',
    tone: 'blue',
    attention: true,
    stats: [
      { label: '전체 보유량', value: '482,350 KG' },
      { label: '재고 평가액', value: '₩ 1.28B' },
    ],
  },
  {
    group: '매출 채권',
    title: '기한 초과 미수금',
    description: '결제 예정일이 지난 거래처의 입금 상태를 확인해 주세요.',
    action: '거래처 2곳 확인 필요',
    icon: IconWallet,
    tone: 'orange',
    state: '입금 확인',
    stateTone: 'critical',
    attention: true,
    stats: [
      { label: '미수금 잔액', value: '₩ 45.28M' },
      { label: '기한 초과', value: '2개 거래처' },
    ],
  },
  {
    group: '현장 업무',
    title: '철강알바 처리 현황',
    description: '오늘 접수된 작업 요청이 모두 처리되었습니다.',
    action: '당일 등록 업무',
    icon: IconClipboardList,
    tone: 'green',
    state: '처리 완료',
    stateTone: 'success',
    attention: false,
    stats: [
      { label: '오늘 등록', value: '4건' },
      { label: '처리 완료', value: '4 / 4건', progress: 100 },
    ],
  },
];

const metrics = [
  { title: '매출', dailyAmount: 127985000, change: '+12.5%', detailLabel: '출고 중량', dailyDetail: 1279, icon: IconChartBar, tone: 'green' },
  { title: '매입', dailyAmount: 98430000, change: '+8.3%', detailLabel: '입고 중량', dailyDetail: 985, icon: IconShoppingCart, tone: 'blue' },
  { title: '매출이익', dailyAmount: 29555000, subLabel: '이익률', subValue: '23.1%', icon: IconChartBar, tone: 'purple' },
  { title: '미수금 잔액', dailyAmount: 45280000, badge: '확인 필요 0건', icon: IconWallet, tone: 'orange', pointInTime: true },
];

export default function HomePage() {
  const [dateFrom, setDateFrom] = useState(() => startOfMonth());
  const [dateTo, setDateTo] = useState(() => localDateString(new Date()));
  const [period, setPeriod] = useState('month');
  const [chartMode, setChartMode] = useState('amount');
  const weightMode = chartMode === 'weight';
  const selectedDays = period === 'today' ? 1 : countInclusiveDays(dateFrom, dateTo);
  const visibleMetrics = metrics.map((metric) => ({
    ...metric,
    title: metric.title === '매출' || metric.title === '매입'
      ? `${period === 'today' ? '금일' : period === 'month' ? '당월' : '선택 기간'} ${metric.title}`
      : metric.title,
    amount: metric.pointInTime ? metric.dailyAmount : metric.dailyAmount * selectedDays,
    detail: metric.dailyDetail ? `${(metric.dailyDetail * selectedDays).toLocaleString('ko-KR')} KG` : null,
  }));
  const chartKeys = weightMode
    ? { sales: 'salesKg', purchases: 'purchasesKg', profit: 'profitKg' }
    : { sales: 'sales', purchases: 'purchases', profit: 'profit' };

  const selectPeriod = (nextPeriod) => {
    const today = new Date();
    setDateTo(localDateString(today));
    setDateFrom(nextPeriod === 'today' ? localDateString(today) : startOfMonth(today));
    setPeriod(nextPeriod);
  };

  return (
    <main className={classes.root}>
      <Stack gap="lg">
        <Paper className={classes.dashboardHeader}>
          <Group className={classes.pageHeading} justify="space-between" align="center" wrap="wrap">
            <div className={classes.headerCopy}>
              <Title order={1} className={classes.pageTitle}>스틸119 대시보드 <span>Monitor</span></Title>
              <Text className={classes.pageSubtitle}>오늘의 매출부터 재고·미수금까지, 주요 운영 현황을 확인하세요.</Text>
              <Group className={classes.sampleNotice} gap={8}>
                <span className={classes.statusDot} />
                <Text size="xs">데모 데이터</Text>
                <span className={classes.noticeDivider} />
                <Text size="xs">실제 연동 전 화면 미리보기</Text>
              </Group>
            </div>
          </Group>
        </Paper>

        <Paper className={classes.periodToolbar} withBorder>
          <Group className={classes.periodControls} justify="flex-start" wrap="wrap">
            <div className={classes.periodHeading}>
              <Text className={classes.periodLabel}>조회 기간</Text>
            </div>
            <Group gap="sm" className={classes.periodInputs}>
              <div className={classes.dateRange}>
                <IconCalendar size={17} aria-hidden="true" />
                <input aria-label="조회 시작일" type="date" value={dateFrom} max={dateTo} onChange={(event) => { setDateFrom(event.target.value); setPeriod('custom'); }} />
                <span className={classes.rangeSeparator}>–</span>
                <input aria-label="조회 종료일" type="date" value={dateTo} min={dateFrom} onChange={(event) => { setDateTo(event.target.value); setPeriod('custom'); }} />
              </div>
              <SegmentedControl
                value={period === 'custom' ? '' : period}
                onChange={selectPeriod}
                data={[{ label: '오늘', value: 'today' }, { label: '이번 달', value: 'month' }]}
                classNames={{ root: classes.periodToggle, indicator: classes.periodIndicator, label: classes.periodOption }}
              />
            </Group>
          </Group>
        </Paper>

        <div className={classes.metricGrid}>
          {visibleMetrics.map((metric) => <MetricCard key={metric.title} metric={metric} period={period} />)}
        </div>

        <div className={classes.analyticsGrid}>
          <Paper className={classes.chartPanel} withBorder>
            <Group justify="space-between" align="center" mb="md" wrap="wrap">
              <div>
                <Title order={3} className={classes.sectionTitle}>매출 · 매입 추이</Title>
                <Text className={classes.panelCaption}>최근 6개월 월별 실적</Text>
              </div>
              <Group gap="md" className={classes.chartTools}>
                <span className={classes.legend}><i className={classes.salesDot} />{weightMode ? '출고 중량' : '매출액'}</span>
                <span className={classes.legend}><i className={classes.purchaseDot} />{weightMode ? '매입 중량' : '매입액'}</span>
                <span className={classes.legend}><i className={classes.profitDot} />{weightMode ? '이익 중량' : '매출이익'}</span>
                <SegmentedControl
                  value={chartMode}
                  onChange={setChartMode}
                  data={[{ label: '금액', value: 'amount' }, { label: '중량', value: 'weight' }]}
                  classNames={{ root: classes.chartModeToggle, indicator: classes.chartModeIndicator, label: classes.chartModeOption }}
                />
              </Group>
            </Group>
            <div className={classes.chart}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={monthlyData} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="#edf1f6" />
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#8491a4', fontSize: 12 }} />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    width={weightMode ? 55 : 48}
                    domain={[0, weightMode ? 1600 : 160000000]}
                    ticks={weightMode ? [0, 400, 800, 1200, 1600] : [0, 40000000, 80000000, 120000000, 160000000]}
                    tickFormatter={(value) => weightMode ? `${value}` : compactWon(value)}
                    tick={{ fill: '#8491a4', fontSize: 11 }}
                  />
                  <Tooltip formatter={(value, name) => [weightMode ? `${Number(value).toLocaleString('ko-KR')} KG` : `₩ ${Number(value).toLocaleString('ko-KR')}`, name]} />
                  <Bar dataKey={chartKeys.sales} name={weightMode ? '출고 중량' : '매출액'} fill="#4f7fe8" radius={[5, 5, 0, 0]} barSize={30} />
                  <Bar dataKey={chartKeys.purchases} name={weightMode ? '매입 중량' : '매입액'} fill="#b9c9e4" radius={[5, 5, 0, 0]} barSize={30} />
                  <Line dataKey={chartKeys.profit} name={weightMode ? '이익 중량' : '매출이익'} stroke="#16b69a" strokeWidth={2.5} dot={{ r: 3, fill: '#fff', strokeWidth: 2 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Paper>

          <Paper className={classes.mixPanel} withBorder>
            <div>
              <Title order={3} className={classes.sectionTitle}>품목별 매출 비중</Title>
              <Text className={classes.panelCaption}>이번 달 품목 구성</Text>
            </div>
            <div className={classes.donutWrap}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={salesMix} dataKey="share" nameKey="name" innerRadius={58} outerRadius={82} paddingAngle={3} stroke="none" cornerRadius={4}>
                    {salesMix.map((item) => <Cell key={item.name} fill={item.color} />)}
                  </Pie>
                  <Tooltip formatter={(value, name) => [`${value}%`, name]} />
                </PieChart>
              </ResponsiveContainer>
              <div className={classes.donutCenter}><strong>₩ 1.28B</strong><span>총 매출</span></div>
            </div>
            <Stack gap={0} className={classes.mixList}>
              {salesMix.map((item) => (
                <div className={classes.mixRow} key={item.name}>
                  <span className={classes.mixName}><i style={{ background: item.color }} />{item.name}</span>
                  <Text size="xs" c="dimmed">{item.share}%</Text>
                  <Text size="xs" fw={700}>{compactWon(item.amount)}</Text>
                </div>
              ))}
            </Stack>
          </Paper>
        </div>

        <Paper className={classes.alertPanel} withBorder>
          <Group justify="space-between" align="center" mb="md" wrap="wrap">
            <div>
              <Group gap="sm"><span className={classes.alertHeadingIcon}><IconBell size={17} /></span><Title order={3} className={classes.sectionTitle}>오늘의 업무 알림</Title></Group>
              <Text className={classes.panelCaption}>재고·채권·현장 업무 중 확인이 필요한 항목입니다.</Text>
            </div>
            <Group gap={8} className={classes.alertSummary}>
              <Badge className={classes.pendingBadge} variant="light">확인 필요 {alerts.filter((alert) => alert.attention).length}건</Badge>
              <Text size="xs" c="dimmed">전체 {alerts.length}건</Text>
            </Group>
          </Group>
          <Stack gap="sm">
            {alerts.map((alert) => <AlertRow key={alert.title} alert={alert} />)}
          </Stack>
        </Paper>
      </Stack>
    </main>
  );
}

function MetricCard({ metric, period }) {
  const Icon = metric.icon;
  return (
    <Paper withBorder className={`${classes.metricCard} ${classes[metric.tone]}`}>
      <Group gap="sm" wrap="nowrap">
        <ThemeIcon className={classes.metricIcon} radius="xl" size={52} variant="light"><Icon size={25} /></ThemeIcon>
        <Text fw={800} className={classes.metricTitle}>{metric.title}</Text>
      </Group>
      <Text className={classes.metricAmount}>{formatWon(metric.amount)}</Text>
      {metric.change ? (
        <Group gap={7} className={classes.metricChange}><IconTrendingUp size={16} /><Text size="sm" c="dimmed">{period === 'today' ? '전일 대비' : '이전 기간 대비'}</Text><Text size="sm" fw={700}>{metric.change}</Text></Group>
      ) : metric.subLabel ? (
        <Group gap="sm" mt="md"><Text size="sm" c="dimmed">{metric.subLabel}</Text><Text fw={800}>{metric.subValue}</Text></Group>
      ) : <Badge className={classes.receivableBadge} variant="filled">{metric.badge}</Badge>}
      {metric.detail && <div className={classes.metricDetail}><Text size="xs" c="dimmed">{metric.detailLabel}</Text><Text fw={700} mt={4}>{metric.detail}</Text></div>}
    </Paper>
  );
}

function AlertRow({ alert }) {
  const Icon = alert.icon;
  return (
    <Paper className={`${classes.alertRow} ${classes[`alert_${alert.tone}`]} ${alert.attention ? classes.needsAttention : classes.isComplete}`} withBorder>
      <ThemeIcon className={classes.alertIcon} variant="light" radius="xl" size={44}><Icon size={21} /></ThemeIcon>
      <div className={classes.alertCopy}>
        <Text className={classes.alertGroup}>{alert.group}</Text>
        <Text fw={750} className={classes.alertTitle}>{alert.title}</Text>
        <Text size="xs" c="dimmed" mt={4} className={classes.alertDescription}>{alert.description}</Text>
        <Text className={classes.alertAction} size="xs" mt={7}>{alert.action}</Text>
      </div>
      <div className={classes.alertStats}>
        {alert.stats.map((stat) => <div className={classes.alertStat} key={stat.label}>
          <Text size="xs" c="dimmed">{stat.label}</Text>
          <Text fw={800} mt={5}>{stat.value}</Text>
          {stat.progress !== undefined && <div className={classes.progressTrack}><span style={{ width: `${stat.progress}%` }} /></div>}
        </div>)}
      </div>
      <Badge className={classes[`state_${alert.stateTone}`]} variant="light">{alert.state}</Badge>
    </Paper>
  );
}

function localDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function startOfMonth(date = new Date()) {
  return localDateString(new Date(date.getFullYear(), date.getMonth(), 1));
}

function countInclusiveDays(from, to) {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 1;
  return Math.floor((end - start) / 86400000) + 1;
}

function formatWon(value) {
  return `₩ ${Number(value).toLocaleString('ko-KR')}`;
}

function compactWon(value) {
  if (value === 0) return '0';
  return `${Math.round(value / 1000000)}M`;
}
