// 경영 대시보드 공통 부품 (대시보드 · 매출이익 현황 · 거래처 잔액 현황이 같은 모양을 쓴다)
//  DashboardHeader : 왼쪽 큰 제목 + 설명 한 줄, 오른쪽 조회 상자(children)
//  FilterBox       : 아이콘 · 라벨 | 입력칸들 | 조회 버튼
//  KpiGrid/KpiCard : 색 띠 · 아이콘 · 큰 숫자 · 전월 대비 알약 · 보조 지표 2개
//  TrendPill       : 증감 알약 (좋아지면 초록, 나빠지면 빨강, 중립이면 회색 · 화살표로도 방향 표시)
import { IconArrowDownRight, IconArrowUpRight, IconCalendar, IconSearch } from '@tabler/icons-react';
import classes from '../../styles/components/DashboardKit.module.css';

// 검증된 범주 팔레트 + 각 색의 옅은 바탕 · 미니 막대용 연한 색
export const KPI_PALETTE = {
  blue: { color: '#2a78d6', tint: '#e9f2fc', soft: '#bcd6f3' },
  orange: { color: '#eb6834', tint: '#fdeee7', soft: '#f6c7b2' },
  green: { color: '#1baf7a', tint: '#e4f6ee', soft: '#aee3cd' },
  amber: { color: '#d99400', tint: '#fdf3dc', soft: '#f3d99a' },
  slate: { color: '#52607a', tint: '#eef1f5', soft: '#c9d0da' },
  pink: { color: '#d4609a', tint: '#fbeaf3', soft: '#efbfd7' },
};

const toNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

// parent 가 있으면 '매출관리 › 매출이익 현황' (매입등록 등 다른 화면과 같은 브레드크럼)
export function DashboardHeader({ parent, title, subtitle, children }) {
  return <>
    <nav aria-label="현재 위치" className={classes.crumb}>
      {parent && <><span className={classes.crumbParent}>{parent}</span><span className={classes.crumbChevron}>›</span></>}
      <span className={classes.crumbCurrent}>{title}</span>
    </nav>
    <header className={classes.pageHeader}>
      {children}
      {subtitle ? <span className={classes.pageSub}>{subtitle}</span> : null}
    </header>
  </>;
}

export const SubSep = () => <span className={classes.dotSep} />;

export function FilterBox({ label = '조회기간', children, onSearch, loading = false }) {
  return <div className={classes.filterGroup}>
    <span className={classes.filterLabel}><IconCalendar size={15} stroke={1.9} />{label}</span>
    {children}
    <button type="button" className={classes.searchButton} onClick={onSearch} disabled={loading}>
      {loading ? <span className={classes.searchSpinner} aria-hidden="true" /> : <IconSearch size={15} stroke={2.2} />}조회
    </button>
  </div>;
}
export const FilterTilde = () => <span className={classes.tilde}>~</span>;

// mode: 'rate' = 증감률(%), 'point' = %p 차이, 'diff' = 금액 차이(format 으로 표시)
export function TrendPill({ current, previous, goodWhenUp = true, neutral = false, mode = 'rate', format = (value) => toNumber(value).toLocaleString('ko-KR'), unit = '', note = '전월 대비', emptyText = '전월 비교 없음' }) {
  if (previous === null || previous === undefined || current === null || current === undefined) return <span className={classes.pillNote}>{emptyText}</span>;
  const now = toNumber(current);
  const before = toNumber(previous);
  let amount;
  let text;
  if (mode === 'rate') {
    if (!before) return <span className={classes.pillNote}>{emptyText}</span>;
    amount = ((now - before) / Math.abs(before)) * 100;
    text = `${Math.abs(amount).toFixed(1)}%`;
  } else if (mode === 'point') {
    amount = now - before;
    text = `${Math.abs(amount).toFixed(1)}%p`;
  } else {
    amount = now - before;
    text = `${format(Math.abs(amount))}${unit}`;
  }
  if (Math.abs(amount) < (mode === 'diff' ? 0.5 : 0.05)) return <><span className={`${classes.pill} ${classes.pillFlat}`}>변동 없음</span><span className={classes.pillNote}>{note}</span></>;
  const up = amount > 0;
  const Icon = up ? IconArrowUpRight : IconArrowDownRight;
  const tone = neutral ? classes.pillFlat : up === goodWhenUp ? classes.pillGood : classes.pillBad;
  return <><span className={`${classes.pill} ${tone}`}><Icon size={13} stroke={2.4} />{text}</span><span className={classes.pillNote}>{note}</span></>;
}
export const PillNote = ({ children }) => <span className={classes.pillNote}>{children}</span>;

export function KpiGrid({ count, children, label = '핵심 지표' }) {
  return <div className={classes.kpis} aria-label={label} style={{ '--kpi-count': count || 5 }}>{children}</div>;
}

export function KpiCard({ palette = KPI_PALETTE.blue, icon: Icon, label, basis, value, unit = '원', negative = false, trend, stats = [], onClick, title }) {
  const Tag = onClick ? 'button' : 'div';
  return <Tag type={onClick ? 'button' : undefined} className={`${classes.kpi} ${onClick ? classes.kpiLink : ''}`} onClick={onClick}
    style={{ '--kpi-color': palette.color, '--kpi-tint': palette.tint }} title={title || (onClick ? '누르면 상세 화면으로 이동' : undefined)}>
    <div className={classes.kpiHead}>
      <div className={classes.kpiTitle}><span className={classes.kpiLabel}>{label}</span>{basis && <span className={classes.kpiBasis}>{basis}</span>}</div>
      {Icon && <span className={classes.kpiIcon}><Icon size={19} stroke={1.9} /></span>}
    </div>
    <div className={`${classes.kpiValue} ${negative ? classes.negative : ''}`}>{value}{unit && <small>{unit}</small>}</div>
    <div className={classes.kpiTrend}>{trend}</div>
    {stats.length > 0 && <div className={classes.kpiStats}>{stats.map((stat) => <div key={stat.label} className={classes.kpiStat}><span>{stat.label}</span><b className={stat.warn ? classes.warn : stat.good ? classes.good : ''}>{stat.value}</b></div>)}</div>}
  </Tag>;
}

export const kitClasses = classes;
