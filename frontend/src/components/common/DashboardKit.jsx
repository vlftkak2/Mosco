// 경영 대시보드 공통 부품 (대시보드 · 매출이익요약 · 채권채무요약이 같은 모양을 쓴다)
//  DashboardHeader : 위치(브레드크럼) + 한 줄 안내, 아래에 조회 줄(children)
//  PeriodFilter    : 시작일 – 종료일 | (거래처) | 조회
//  CustomerPicker  : 거래처 조건 (글자를 치면 자동 맞춤 목록, 비우면 전체) · useCustomerPicker 와 함께 쓴다
//  FilterBox       : 예전 조회 상자 (라이선스 매출현황이 씀)
//  KpiGrid/KpiCard : 큰 숫자 · 증감 알약 · 보조 지표 2개
//  TrendPill       : 증감 알약 (좋아지면 초록, 나빠지면 빨강, 중립이면 회색 · 화살표로도 방향 표시)
//  KpiCard breakdown : 마우스를 올리면 그 숫자가 어떻게 나왔는지 (구성 항목 + 계산식) 보여 주는 작은 창
import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { HoverCard } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconArrowDownRight, IconArrowUpRight, IconCalendar, IconSearch, IconX } from '@tabler/icons-react';
import ErpDateInput from './ErpDateInput';
import classes from '../../styles/components/DashboardKit.module.css';

// 검증된 범주 팔레트 + 각 색의 옅은 바탕 · 미니 막대용 연한 색
export const KPI_PALETTE = {
  blue: { color: '#2a78d6', tint: 'var(--dk-bg-e9f2fc, #e9f2fc)', soft: '#bcd6f3' },
  orange: { color: '#eb6834', tint: 'var(--dk-bg-fdeee7, #fdeee7)', soft: '#f6c7b2' },
  green: { color: '#1baf7a', tint: 'var(--dk-bg-e4f6ee, #e4f6ee)', soft: '#aee3cd' },
  amber: { color: '#d99400', tint: 'var(--dk-bg-fdf3dc, #fdf3dc)', soft: '#f3d99a' },
  slate: { color: '#52607a', tint: 'var(--dk-bg-eef1f5, #eef1f5)', soft: '#c9d0da' },
  pink: { color: '#d4609a', tint: 'var(--dk-bg-fbeaf3, #fbeaf3)', soft: '#efbfd7' },
};

const toNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};
const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });

// parent 가 있으면 '매출관리 › 매출이익요약' (매입등록 등 다른 화면과 같은 브레드크럼) · note = 제목 옆 회색 한 줄
export function DashboardHeader({ parent, title, subtitle, note, children }) {
  return <>
    <nav aria-label="현재 위치" className={classes.crumb}>
      {parent && <><span className={classes.crumbParent}>{parent}</span><span className={classes.crumbChevron}>›</span></>}
      <span className={classes.crumbCurrent}>{title}</span>
      {note ? <span className={classes.crumbNote}>{note}</span> : null}
    </nav>
    <header className={classes.pageHeader}>
      {children}
      {subtitle ? <span className={classes.pageSub}>{subtitle}</span> : null}
    </header>
  </>;
}

export function FilterBox({ label = '조회기간', children, onSearch, loading = false }) {
  return <div className={classes.filterGroup}>
    <span className={classes.filterLabel}><IconCalendar size={15} stroke={1.9} />{label}</span>
    {children}
    <button type="button" className={classes.searchButton} onClick={onSearch} disabled={loading}>
      {loading ? <span className={classes.searchSpinner} aria-hidden="true" /> : <IconSearch size={15} stroke={2.2} />}조회
    </button>
  </div>;
}

// ── 조회 줄 ─────────────────────────────────────────────
export function PeriodFilter({ value, onChange, onSearch, loading = false, children }) {
  return <div className={classes.periodBar}>
    <div className={classes.rangeBox}>
      <ErpDateInput aria-label="시작일" value={value.date_from} onChange={(event) => onChange({ ...value, date_from: event.currentTarget.value })} />
      <span className={classes.rangeDash}>–</span>
      <ErpDateInput aria-label="종료일" value={value.date_to} onChange={(event) => onChange({ ...value, date_to: event.currentTarget.value })} />
    </div>
    {children}
    <button type="button" className={classes.goButton} onClick={onSearch} disabled={loading}>
      {loading ? <span className={classes.goSpinner} aria-hidden="true" /> : null}조회
    </button>
  </div>;
}

// ── 거래처 조건 ─────────────────────────────────────────
// url: 그 화면 메뉴 권한으로 쓸 수 있는 자동완성 API ({ items: [{ ckey, customcode, customname }] })
export function useCustomerPicker(url) {
  const [text, setText] = useState('');
  const [picked, setPicked] = useState(null);
  const inputRef = useRef(null);
  const fetchCustomers = useCallback(async (keyword, signal) => {
    const response = await axios.get(url, { ...authConfig(), params: { keyword }, signal });
    return response.data?.items || [];
  }, [url]);
  const type = useCallback((value) => { setText(value); setPicked(null); }, []);
  const choose = useCallback((item) => { setPicked(item); setText(item.customname); }, []);
  const clear = useCallback(() => { setText(''); setPicked(null); }, []);
  // 조회 직전: 고른 거래처 / 비었으면 전체 / 글자만 있으면 딱 맞는 한 곳을 찾아 고른다 → { ok, customer }
  const resolve = useCallback(async () => {
    const keyword = text.trim();
    if (!keyword) return { ok: true, customer: null };
    if (picked) return { ok: true, customer: picked };
    try {
      const found = await fetchCustomers(keyword);
      const exact = found.filter((item) => item.customname === keyword || item.customcode === keyword);
      const match = exact.length === 1 ? exact[0] : found.length === 1 ? found[0] : null;
      if (match) { choose(match); return { ok: true, customer: match }; }
      notifications.show({ title: '거래처 확인', message: found.length ? '같은 글자가 들어간 거래처가 여러 곳입니다. 목록에서 골라 주세요.' : `'${keyword}' 거래처를 찾지 못했습니다.`, color: 'orange' });
    } catch {
      notifications.show({ title: '거래처 확인', message: '거래처를 찾지 못했습니다.', color: 'red' });
    }
    inputRef.current?.focus();
    return { ok: false, customer: null };
  }, [text, picked, fetchCustomers, choose]);
  return { text, picked, inputRef, fetchCustomers, type, choose, clear, resolve };
}

const highlight = (text, keyword) => {
  const value = String(text || '');
  const index = keyword ? value.toLocaleLowerCase().indexOf(keyword.toLocaleLowerCase()) : -1;
  if (index < 0) return value;
  return <>{value.slice(0, index)}<mark>{value.slice(index, index + keyword.length)}</mark>{value.slice(index + keyword.length)}</>;
};

export function CustomerPicker({ picker, onPick, onClear, onEnter, label = '거래처' }) {
  const { text, picked: selected, inputRef, fetchCustomers } = picker;
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [busy, setBusy] = useState(false);
  const keyword = text.trim();
  const showList = open && keyword && !selected;

  useEffect(() => {
    if (!open || !keyword || selected) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setBusy(true);
      try {
        const found = await fetchCustomers(keyword, controller.signal);
        if (!controller.signal.aborted) { setItems(found); setActive(found.length ? 0 : -1); }
      } catch { /* 목록만 비운다 */ } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    }, 140);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, keyword, selected, fetchCustomers]);

  const pick = (item) => { setOpen(false); setItems([]); onPick(item); };
  const onKeyDown = (event) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown' && showList && items.length) { event.preventDefault(); setActive((index) => (index + 1) % items.length); return; }
    if (event.key === 'ArrowUp' && showList && items.length) { event.preventDefault(); setActive((index) => (index - 1 + items.length) % items.length); return; }
    if (event.key === 'Escape') { setOpen(false); return; }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (showList && items[active]) pick(items[active]);
      else { setOpen(false); onEnter(); }
    }
  };

  return <div className={`${classes.customerBox} ${selected ? classes.customerBoxPicked : ''}`}>
    <span className={classes.customerLabel}>{label}</span>
    <input ref={inputRef} className={classes.customerInput} value={text} placeholder="전체" aria-label={label} autoComplete="off"
      role="combobox" aria-expanded={Boolean(showList)} aria-controls="dashboard-customer-list"
      onChange={(event) => { picker.type(event.currentTarget.value); setOpen(true); }}
      onFocus={() => setOpen(true)} onBlur={() => window.setTimeout(() => setOpen(false), 120)} onKeyDown={onKeyDown} />
    {busy && showList ? <span className={classes.customerSpin} aria-hidden="true" /> : null}
    {text ? <button type="button" className={classes.customerClear} onMouseDown={(event) => event.preventDefault()} onClick={onClear} aria-label="거래처 조건 지우기" title="지우고 전체 보기"><IconX size={13} stroke={2.2} /></button> : null}
    {showList ? <div id="dashboard-customer-list" role="listbox" className={classes.customerList}>
      {items.length ? items.map((item, index) => <button key={item.ckey} type="button" role="option" aria-selected={index === active}
        className={`${classes.customerOption} ${index === active ? classes.customerOptionActive : ''}`}
        onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => pick(item)}>
        <span className={classes.customerOptionName}>{highlight(item.customname, keyword)}</span>
        <span className={classes.customerOptionCode}>{highlight(item.customcode, keyword)}</span>
      </button>) : <div className={classes.customerNone}>{busy ? '찾는 중…' : '일치하는 거래처가 없습니다'}</div>}
    </div> : null}
  </div>;
}

// mode: 'rate' = 증감률(%), 'point' = %p 차이, 'diff' = 금액 차이(format 으로 표시) · note 가 비면 알약만
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
  const noteNode = note ? <span className={classes.pillNote}>{note}</span> : null;
  if (Math.abs(amount) < (mode === 'diff' ? 0.5 : 0.05)) return <><span className={`${classes.pill} ${classes.pillFlat}`}>변동 없음</span>{noteNode}</>;
  const up = amount > 0;
  const Icon = up ? IconArrowUpRight : IconArrowDownRight;
  const tone = neutral ? classes.pillFlat : up === goodWhenUp ? classes.pillGood : classes.pillBad;
  return <><span className={`${classes.pill} ${tone}`}><Icon size={13} stroke={2.4} />{text}</span>{noteNode}</>;
}
export const PillNote = ({ children }) => <span className={classes.pillNote}>{children}</span>;

export function KpiGrid({ count, children, label = '핵심 지표' }) {
  // 카드가 4개 이하면 좁은 화면에서도 한 줄 (3 + 1 로 나뉘어 빈자리가 생기지 않게)
  return <div className={`${classes.kpis} ${(count || 5) <= 4 ? classes.kpisFew : ''}`} aria-label={label} style={{ '--kpi-count': count || 5 }}>{children}</div>;
}

// breakdown: { title, rows: [{ op: '' | '+' | '−' | '÷' | '=', label, hint, value, strong }], note }
//  op '=' 줄은 위에 가는 선을 긋고 굵게 (소계 · 결과)
export function KpiBreakdown({ breakdown, palette = KPI_PALETTE.blue }) {
  return <div className={classes.breakdown} style={{ '--kpi-color': palette.color }}>
    <div className={classes.breakdownTitle}>{breakdown.title}</div>
    <div className={classes.breakdownRows}>
      {breakdown.rows.map((row, index) => <div key={`${row.label}-${index}`} className={`${classes.breakdownRow} ${row.op === '=' ? classes.breakdownTotal : ''} ${row.strong ? classes.breakdownStrong : ''}`}>
        <span className={classes.breakdownOp}>{row.op === '=' ? '' : row.op}</span>
        <span className={classes.breakdownLabel}>{row.label}{row.hint && <small>{row.hint}</small>}</span>
        <span className={classes.breakdownValue}>{row.value}</span>
      </div>)}
    </div>
    {breakdown.note && <div className={classes.breakdownNote}>{breakdown.note}</div>}
  </div>;
}

// 마우스 올림 창: 화면 고정 위치로 띄운다 (페이지 길이를 늘려 스크롤 막대가 생겼다 사라지며 화면이 흔들리지 않게)
export const HOVER_PROPS = { withArrow: true, shadow: 'md', openDelay: 120, closeDelay: 80, withinPortal: true, floatingStrategy: 'fixed' };

export function KpiCard({ palette = KPI_PALETTE.blue, icon: Icon, label, basis, value, unit = '원', negative = false, trend, stats = [], onClick, title, breakdown }) {
  const Tag = onClick ? 'button' : 'div';
  const card = <Tag type={onClick ? 'button' : undefined} className={`${classes.kpi} ${onClick ? classes.kpiLink : ''} ${breakdown ? classes.kpiHasBreakdown : ''}`} onClick={onClick}
    style={{ '--kpi-color': palette.color, '--kpi-tint': palette.tint }} title={breakdown ? undefined : title || (onClick ? '누르면 상세 화면으로 이동' : undefined)}>
    <div className={classes.kpiHead}>
      <div className={classes.kpiTitle}><span className={classes.kpiLabel}>{label}</span>{basis && <span className={classes.kpiBasis}>{basis}</span>}</div>
      {Icon && <span className={classes.kpiIcon}><Icon size={19} stroke={1.9} /></span>}
    </div>
    <div className={`${classes.kpiValue} ${negative ? classes.negative : ''}`}>{value}{unit && <small>{unit}</small>}</div>
    {trend ? <div className={classes.kpiTrend}>{trend}</div> : null}
    {stats.length > 0 && <div className={classes.kpiStats}>{stats.map((stat) => <div key={stat.label} className={classes.kpiStat}><span>{stat.label}</span><b className={stat.warn ? classes.warn : stat.good ? classes.good : ''}>{stat.value}</b></div>)}</div>}
  </Tag>;
  if (!breakdown) return card;
  return <HoverCard width={300} position="bottom" {...HOVER_PROPS}>
    <HoverCard.Target>{card}</HoverCard.Target>
    <HoverCard.Dropdown p={0}><KpiBreakdown breakdown={breakdown} palette={palette} /></HoverCard.Dropdown>
  </HoverCard>;
}

// 차트 칸: 옆 패널 높이에 맞춰 남는 세로 공간을 다 채운다 (아래 빈 여백 없이) · 안에는 ResponsiveContainer height="100%"
export const FillChart = ({ min = 240, children }) => <div className={classes.chartFill} style={{ minHeight: min }}><div className={classes.chartFillInner}>{children}</div></div>;

export const kitClasses = classes;
