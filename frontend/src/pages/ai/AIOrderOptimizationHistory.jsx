// 가공 최적화 이력 창 (시안 v10 "과거 이력" · "가공 후보 추가" → 과거 가공이력 창 하나로 합침)
//   HistoryModal (purchase)   : ① 과거 매입이력 → 신규 원자재 후보
//   HistoryModal (processing) : ③ 과거 가공이력 창 하나에서 구분 탭으로 관리
//     - 가공이력      : 가공등록 칼 배치 → 추천조합에 반영
//     - 가공매출이력  : 출고(매출) 규격 → 가공 후보로 추가 (혼합 계산에 함께 넣을 폭·길이)
//     - 직접 입력     : 가공 후보 폭·길이를 직접 입력
// 창은 열 때마다 새로 그려진다(부모가 열린 동안만 렌더) → 입력값은 매번 처음부터.
// 적합 여부는 현재 ③ 값(context)으로 바로 보여주고, 적용한 뒤에는 서버가 같은 기준으로 다시 검증한다.
import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Button, NumberInput, Select, TextInput } from '@mantine/core';
import { ItemNameAutocomplete } from './AIItemNameLookup';
import { IconCheck, IconChevronDown, IconHistory, IconSearch } from '@tabler/icons-react';
import PickerModal, { ColumnResizeHandle, PickerEmpty, pickerClasses, useResizableColumns } from '../../components/common/PickerModal';
import classes from '../../styles/pages/AIOrderOptimization.module.css';
import m from '../../styles/pages/AIOrderManage.module.css';
import { apiErrorMessage } from '../../utils/apiError';

const API = '/api/ai-optimization';
const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });
const fmt = (value, digits = 1) => (value === null || value === undefined || value === '' ? '–'
  : Number(value).toLocaleString('ko-KR', { maximumFractionDigits: digits }));
const same = (a, b) => Math.abs(Number(a) - Number(b)) < 1e-6;
const FIELD_LOOK = { input: m.mInput, label: m.mLabel };
const PERIODS = [{ value: '0', label: '전체 기간' }, { value: '3', label: '최근 3개월' }, { value: '6', label: '최근 6개월' }, { value: '12', label: '최근 12개월' }];

// 이력 조회 캐시: 같은 조건은 1분 동안 다시 묻지 않고 바로 보여 준다 (진행 중인 요청도 함께 쓴다).
// 가공최적화 화면이 품목을 담으면 미리 불러 두므로(prefetchHistory) 창을 열면 바로 목록이 나온다.
const HISTORY_TTL = 60 * 1000;
const historyCache = new Map();   // key → { at, rows } | { at, promise }
// query: 검색어 문자열 또는 조회조건 객체 { q, name_exact, productname, steelgrade, surface, warehouse, thickness_from, thickness_to, width, length }
const queryParams = (query) => (typeof query === 'string' || !query ? { q: query || '' } : query);
const historyKey = (kind, material, itemname, months, query) => JSON.stringify([kind, material, itemname || '', String(months || 0), queryParams(query)]);
function fetchHistory(kind, material, itemname, months, query) {
  const key = historyKey(kind, material, itemname, months, query);
  const hit = historyCache.get(key);
  if (hit && Date.now() - hit.at < HISTORY_TTL) return hit.promise || Promise.resolve(hit.rows);
  const promise = axios.get(`${API}/history`, { ...authConfig(), params: { kind, material, itemname: itemname || '', months, ...queryParams(query) } })
    .then(({ data }) => { const rows = data.items || []; historyCache.set(key, { at: Date.now(), rows }); return rows; })
    .catch((err) => { historyCache.delete(key); throw err; });
  historyCache.set(key, { at: Date.now(), promise });
  return promise;
}
const cachedHistory = (kind, material, itemname, months, query) => {
  const hit = historyCache.get(historyKey(kind, material, itemname, months, query));
  return hit && hit.rows && Date.now() - hit.at < HISTORY_TTL ? hit.rows : null;
};
// 이력 창 기본 조회조건 (창을 열 때 바로 쓰는 값): 기준 품목 품명 일치 + 두께
export const defaultHistoryFilters = (context) => ({
  ...EMPTY_HISTORY_FILTERS, name: context.itemname || '', nameExact: Boolean(context.itemname),
  thicknessFrom: context.thickness ? String(Number(context.thickness)) : '', thicknessTo: context.thickness ? String(Number(context.thickness)) : '',
});
const EMPTY_HISTORY_FILTERS = { name: '', nameExact: false, productname: '', steelgrade: '', surface: '', warehouse: '', thicknessFrom: '', thicknessTo: '', width: '', length: '', q: '' };
const historyQuery = (f) => {
  const text = (value) => String(value ?? '').trim();
  const query = { q: text(f.q) };
  if (f.nameExact && text(f.name)) query.name_exact = true;
  for (const [key, param] of [['productname', 'productname'], ['steelgrade', 'steelgrade'], ['surface', 'surface'], ['warehouse', 'warehouse'],
    ['thicknessFrom', 'thickness_from'], ['thicknessTo', 'thickness_to'], ['width', 'width'], ['length', 'length']]) {
    if (text(f[key])) query[param] = text(f[key]);
  }
  return query;
};
export function prefetchHistory(material, itemname, thickness) {
  if (!itemname) return;
  const query = historyQuery(defaultHistoryFilters({ itemname, thickness }));
  ['purchase', 'processing'].forEach((kind) => { fetchHistory(kind, material, itemname, '0', query).catch(() => {}); });
  fetchHistory('sales', material, itemname, '0', '').catch(() => {});
}

function useHistory(opened, kind, material, itemname, months, query) {
  const [state, setState] = useState({ key: '', rows: [], loading: false, error: '' });
  const key = historyKey(kind, material, itemname, months, query);
  useEffect(() => {
    if (!opened) return undefined;
    let alive = true;
    void (async () => {
      if (!cachedHistory(kind, material, itemname, months, query)) setState({ key, rows: [], loading: true, error: '' });
      try {
        const rows = await fetchHistory(kind, material, itemname, months, query);
        if (alive) setState({ key, rows, loading: false, error: '' });
      } catch (err) {
        if (alive) setState({ key, rows: [], loading: false, error: apiErrorMessage(err, '이력을 불러오지 못했습니다.') });
      }
    })();
    return () => { alive = false; };
  }, [opened, key, kind, material, itemname, months, query]);
  // 캐시에 있으면 첫 화면부터 바로 (요청을 기다리지 않음)
  const cached = opened ? cachedHistory(kind, material, itemname, months, query) : null;
  if (cached && state.key !== key) return { rows: cached, loading: false, error: '' };
  return state.key === key ? state : { rows: [], loading: opened, error: '' };
}

// 현재 ③ 값으로 본 적합 여부 { ok, label, reason }
export function historyFit(kind, material, row, ctx) {
  if (kind === 'purchase') {
    // 주문서 관리에서 연결해 ① 에 이미 연결 원자재로 있는 현재고는 다시 추가하지 않는다
    if (row.linked_refs && !(ctx.linkedKeys || []).includes(row.id)) {
      return { ok: false, label: '연결 원자재', reason: `이 재고는 다른 주문 · 계획(${row.linked_refs})에 연결되어 있어 후보로 추가할 수 없습니다.` };
    }
    if ((ctx.linkedKeys || []).includes(row.id)) {
      return { ok: false, label: '연결 원자재', reason: '이 재고는 주문서 관리에서 연결한 원자재로 ① 후보에 이미 있습니다. 다시 추가할 필요가 없습니다.' };
    }
    // 아직 현재고로 남아 있는 매입 · 기초분은 ① 에 현재고로 이미 나온다 → 신규로 또 추가하지 않는다
    if (row.in_stock && (ctx.stockKeys || []).includes(row.id)) {
      return { ok: false, label: '기추천', reason: '① 원자재 후보에 현재고로 추천된 원자재입니다 (중복 추가 불가).' };
    }
    // 슬리팅 · 절단으로 두께는 바뀌지 않는다 → 발주와 같은 두께의 매입이력만 원자재 후보로 추가할 수 있다
    // 코일: 가장 넓은 제품 폭 + 기본 로스보다 좁은 원자재는 후보가 될 수 없다
    const minWidth = Math.max(0, ...(ctx.orderValues || []).map(Number)) + (Number(ctx.trim) || 0);
    if (material === 'COIL' && Number(row.width) < minWidth - 1e-6) {
      return { ok: false, label: '폭 부족', reason: `원자재 폭 ${fmt(row.width)}mm는 가장 넓은 제품 폭 + 기본 로스 = ${fmt(minWidth)}mm 이상이어야 후보로 추가할 수 있습니다.` };
    }
    if (row.in_stock) return { ok: false, label: '재고 보유', reason: '현재고로 보유 중인 원자재입니다. 신규 후보로 추가하지 않습니다.' };
    return same(row.thickness, ctx.thickness) ? { ok: true, label: '두께 일치' }
      : { ok: false, label: '두께 상이', reason: `이력 두께 ${fmt(row.thickness, 3)}T · 발주 두께 ${fmt(ctx.thickness, 3)}T. 같은 두께의 매입이력만 원자재 후보로 추가할 수 있습니다.` };
  }
  if (material === 'COIL') {
    const used = (row.pattern || []).reduce((sum, [w, n]) => sum + w * n, 0);
    if (!(ctx.rawWidth > 0)) return { ok: false, label: '원자재 미선택', reason: '① 에서 원자재를 먼저 선택해 주세요.' };
    return used + ctx.trim <= ctx.rawWidth + 1e-4 ? { ok: true, label: '적용 가능' }
      : { ok: false, label: '폭 초과', reason: `가공폭 ${fmt(used)}mm + 기본 로스 ${fmt(ctx.trim)}mm가 원자재 폭 ${fmt(ctx.rawWidth)}mm를 넘습니다.` };
  }
  const across = ctx.orientation === 'ROTATED' ? ctx.rawLength : ctx.rawWidth;
  const cap = ctx.orientation === 'ROTATED' ? ctx.rawWidth : ctx.rawLength;
  const strips = Math.min(50, Math.floor((across + 1e-7) / ctx.itemWidth));
  if (!(strips >= 1)) return { ok: false, label: '원판 초과', reason: '현재 원판 폭에 제품 폭이 들어가지 않습니다.' };
  let usedLength = 0;
  for (const [w, l, n] of row.pattern || []) {
    if (!same(w, ctx.itemWidth) || !ctx.lengths.some((x) => same(x, l))) return { ok: false, label: '규격 상이', reason: '과거 패턴의 제품 폭·길이가 이번 품목(또는 가공 후보 길이)과 다릅니다.' };
    if (n % strips) return { ok: false, label: '줄 수 상이', reason: `과거 패턴 ${fmt(n, 0)}매를 이번 원판 ${strips}줄로 똑같이 나눌 수 없습니다.` };
    usedLength += l * (n / strips);
  }
  return usedLength <= cap + 1e-3 ? { ok: true, label: '적용 가능' } : { ok: false, label: '원판 초과',
    reason: `과거 패턴에 원판 길이 ${fmt(usedLength)}mm가 필요한데 지금 고른 원판(${fmt(ctx.rawWidth)} × ${fmt(ctx.rawLength)}mm)은 ${fmt(cap)}mm입니다. `
      + `[원자재 후보로 추가]로 이 이력의 원판(${fmt(row.raw_width)} × ${fmt(row.raw_length)}mm)을 ① 후보에 넣고 고른 뒤 다시 열면 반영할 수 있습니다.` };
}

const patternText = (material, row) => (material === 'COIL'
  ? (row.pattern || []).map(([w, n]) => `${fmt(w)}×${n}`).join(' + ')
  : (row.pattern || []).map(([, l, n]) => `${fmt(l)}×${n}`).join(' + '));
const rawText = (material, row) => (material === 'COIL' ? `${fmt(row.raw_width ?? row.width)} × C` : `${fmt(row.raw_width ?? row.width)} × ${fmt(row.raw_length ?? row.length)}`);

const TITLES = { purchase: '과거 매입이력', processing: '과거 가공이력' };
const DESCRIPTIONS = {
  purchase: '예전에 매입(입고 · 기초)한 원자재 규격을 ① 원자재 후보에 신규로 추가합니다. 발주와 두께가 같은 규격만 고를 수 있습니다.',
  processing: { COIL: '예전에 가공한 칼 배치를 ③ 추천조합에 추가합니다. 지금 원자재 폭에 들어가는 이력만 고를 수 있습니다.', SHEET: '예전에 절단한 패턴을 ③ 추천조합에 추가합니다. 지금 원판에 들어가는 이력만 고를 수 있습니다.' },
};
const APPLY_LABEL = { purchase: '후보로 추가', processing: '추천조합에 반영' };

// ③ 과거 가공이력 창의 구분
const PROCESS_TABS = [
  { value: 'history', label: '가공이력', hint: '칼 배치 반영' },
  { value: 'sales', label: '가공매출이력', hint: '가공 후보 추가' },
  { value: 'manual', label: '직접 입력', hint: '가공 후보 추가' },
];

// 이력 목록 열 (열 너비 조절)
const HISTORY_COLUMNS = (kind, isCoil) => [
  { key: 'select', label: '선택', width: 52, align: 'center' },
  { key: 'fit', label: '적합', width: 112 },
  { key: 'spec', label: kind === 'purchase' ? '매입 규격' : '사용 원자재', width: 150 },
  { key: 'amount', label: kind === 'purchase' ? (isCoil ? '중량' : '수량') : '가공패턴', width: kind === 'purchase' ? 100 : 170, align: kind === 'purchase' ? 'right' : undefined },
  { key: 'date', label: kind === 'purchase' ? '일자' : '작업일', width: 100 },
  ...(kind === 'purchase' ? [{ key: 'origin', label: '구분', width: 60, align: 'center' }] : []),
  { key: 'customer', label: '거래처', width: 150 },
  { key: 'itemname', label: '품명', width: 120 },
  { key: 'grade', label: '강종', width: 90 },
  { key: 'surface', label: '표면', width: 80 },
];
const SALES_COLUMNS = (isCoil) => [
  { key: 'select', label: '선택', width: 52, align: 'center' },
  { key: 'value', label: isCoil ? '제품 폭' : '제품 길이', width: 110 },
  { key: 'count', label: '출고', width: 80, align: 'right' },
  { key: 'sum', label: `누적 ${isCoil ? '중량' : '수량'}`, width: 120, align: 'right' },
  { key: 'last', label: '최근 출고', width: 260 },
  { key: 'state', label: '상태', width: 170 },
];

function ResizableHead({ columns, sizing, first }) {
  return <thead><tr>{columns.map((column, index) => <th key={column.key} className={`${index ? pickerClasses.resizableHead : ''} ${column.align ? pickerClasses[column.align] : ''}`}>
    {index === 0 && first !== undefined ? first : column.label}{index > 0 && <ColumnResizeHandle column={column} columns={sizing} />}</th>)}</tr></thead>;
}

// 가공 후보 (과거 가공이력 창의 '가공매출이력' · '직접 입력'): 혼합가공에 함께 쓸 제품 폭(코일) / 길이(시트).
// 발주품목이 아니며 추가하면 추천조합이 다시 계산된다.
function useCandidates(active, material, context) {
  const { rows, loading } = useHistory(active, 'sales', material, context.itemname, 0, '');
  const isCoil = material === 'COIL';
  const usable = isCoil ? (context.rawWidth || 0) - (context.trim || 0) : Math.max(context.rawWidth || 0, context.rawLength || 0);
  // 출고 규격별로 묶는다: 코일 = 폭, 시트 = 같은 제품 폭의 길이
  const groups = useMemo(() => {
    const map = new Map();
    rows.filter((row) => isCoil || same(row.width, context.itemWidth)).forEach((row) => {
      const value = isCoil ? row.width : row.length;
      if (!(value > 0)) return;
      const key = String(value);
      const group = map.get(key) || { value, count: 0, weight: 0, qty: 0, last: row, sameThickness: false };
      group.count += 1;
      group.weight += Number(row.weight) || 0;
      group.qty += Number(row.qty) || 0;
      if (String(row.date || '') > String(group.last.date || '')) group.last = row;
      if (same(row.thickness, context.thickness)) group.sameThickness = true;
      map.set(key, group);
    });
    return [...map.values()].map((group) => {
      const reason = context.orderValues.some((x) => same(x, group.value)) ? '발주 규격'
        : context.extraValues.some((x) => same(x, group.value)) ? '이미 추가됨'
          : usable > 0 && group.value > usable + 1e-6 ? '원자재 초과' : '';
      return { ...group, reason };
    }).sort((a, b) => Number(!a.reason) === Number(!b.reason) ? b.count - a.count : Number(!b.reason) - Number(!a.reason));
  }, [rows, isCoil, context.itemWidth, context.thickness, context.orderValues, context.extraValues, usable]);
  return { groups, loading, usable };
}

export function HistoryModal({ opened, kind, material, context, onClose, onApply, onAdd }) {
  const [tab, setTab] = useState('history');
  const [months, setMonths] = useState('0');
  const [chosenId, setChosenId] = useState(null);
  const [checked, setChecked] = useState([]);   // 반영할 이력 (여러 건)
  const [picked, setPicked] = useState(null);   // 가공매출이력에서 고른 출고 규격
  const [manual, setManual] = useState('');     // 직접 입력한 가공 후보
  const [salesQuery, setSalesQuery] = useState('');
  const [message, setMessage] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);   // 조회조건 [상세 조건] 펼침
  // 매입이력: 기본은 기준 품목의 품명으로 찾고, 없으면 품명을 바꾸거나 비워(전체) 직접 찾는다
  // 조회조건: 입력칸(input)은 [조회] · Enter 때 적용(applied). 기간은 바로 적용
  const [filterInput, setFilterInput] = useState(() => defaultHistoryFilters(context));
  const [appliedFilters, setAppliedFilters] = useState(() => defaultHistoryFilters(context));
  const setField = (field) => (event) => { const { value } = event.currentTarget; setFilterInput((current) => ({ ...current, [field]: value })); };
  const runSearch = () => { setAppliedFilters(filterInput); setChosenId(null); setChecked([]); };
  const onEnter = (event) => { if (event.key === 'Enter') runSearch(); };
  const isCoil = material === 'COIL';
  const historyColumnsDef = useMemo(() => HISTORY_COLUMNS(kind, isCoil), [kind, isCoil]);
  const salesColumnsDef = useMemo(() => SALES_COLUMNS(isCoil), [isCoil]);
  const historyColumns = useResizableColumns(historyColumnsDef);
  const salesColumns = useResizableColumns(salesColumnsDef);
  const searchName = appliedFilters.name.trim();
  const historyParams = useMemo(() => historyQuery(appliedFilters), [appliedFilters]);
  const { rows, loading, error } = useHistory(opened && tab === 'history', kind, material, searchName, months, historyParams);
  const candidates = useCandidates(opened && kind === 'processing' && tab === 'sales', material, context);
  const salesGroups = useMemo(() => {
    const q = salesQuery.trim().toLowerCase();
    return q ? candidates.groups.filter((group) => String(group.value).includes(q) || String(group.last.customer || '').toLowerCase().includes(q)) : candidates.groups;
  }, [candidates.groups, salesQuery]);
  // 적합한 이력이 먼저
  const shown = useMemo(() => rows
    .map((row) => ({ row, fit: historyFit(kind, material, row, context) }))
    .sort((a, b) => Number(b.fit.ok) - Number(a.fit.ok) || (a.fit.rank || 0) - (b.fit.rank || 0)), [rows, kind, material, context]);
  const fitCount = shown.filter((item) => item.fit.ok).length;
  const chosen = shown.find((item) => item.row.id === chosenId) || shown[0] || null;
  const toggle = (item) => {
    if (!item.fit.ok) return;
    setChecked((current) => (current.includes(item.row.id) ? current.filter((id) => id !== item.row.id) : [...current, item.row.id]));
  };
  const fitIds = shown.filter((item) => item.fit.ok).map((item) => item.row.id);
  const allChecked = fitIds.length > 0 && fitIds.every((id) => checked.includes(id));
  const pickedRows = shown.filter((item) => checked.includes(item.row.id)).map((item) => item.row);
  const basis = kind === 'purchase'
    ? [['품명', context.itemname || '–'], ['두께', `${fmt(context.thickness, 3)}T`]]
    : tab === 'history'
      ? [['품명', context.itemname || '–'], [isCoil ? '원자재 폭' : '원판', !(context.rawWidth > 0) ? '① 에서 미선택' : isCoil ? `${fmt(context.rawWidth)}mm` : `${fmt(context.rawWidth)} × ${fmt(context.rawLength)}mm`], [isCoil ? '기본 로스' : '제품 폭', isCoil ? `${fmt(context.trim)}mm` : `${fmt(context.itemWidth)}mm`]]
      : [['품명', context.itemname || '–'], ['두께', `${fmt(context.thickness, 3)}T`],
        [isCoil ? '사용 가능 폭' : '원판', isCoil ? `${fmt(candidates.usable)}mm (원자재 ${fmt(context.rawWidth)} − 로스 ${fmt(context.trim)})` : `${fmt(context.rawWidth)} × ${fmt(context.rawLength)}mm · 제품 폭 ${fmt(context.itemWidth)}mm`],
        ...(context.extraValues.length ? [['추가된 가공 후보', context.extraValues.map((v) => `${fmt(v)}mm`).join(', ')]] : [])];
  const detail = (row) => (kind === 'purchase'
    ? [['구분', row.origin || '입고'], ['전표번호', row.id], ['일자', String(row.date || '').slice(0, 10)], ['매입처', row.customer || '–'], ['품명', row.itemname],
      ['강종 · 표면', [row.steelgrade, row.surface].filter(Boolean).join(' · ') || '–'], ['규격', `${fmt(row.thickness, 3)} × ${rawText(material, row)}`],
      [isCoil ? '중량' : '수량', isCoil ? `${fmt(row.weight)}kg` : `${fmt(row.qty, 0)}매 · ${fmt(row.weight)}kg`], ['매입단가', row.unitprice ? `${fmt(row.unitprice, 2)}원` : '–'], ['창고', row.warehouse || '–']]
    : [['가공번호', row.id], ['작업일', String(row.date || '').slice(0, 10)], ['거래처', row.customer || '–'], ['원자재', `${row.itemname} ${fmt(row.thickness, 3)}T × ${rawText(material, row)}`],
      ['가공패턴', patternText(material, row)],
      ...(isCoil ? [['칼수', `${row.knives}칼`], ['작업 원코일', `${fmt(row.raw_weight)}kg (${fmt(row.raw_qty, 0)}개)`],
        ['실적 로스', row.actual_loss === null || row.actual_loss === undefined ? '–' : `${fmt(row.actual_loss)}kg`], ['실적 수율', row.actual_yield === null || row.actual_yield === undefined ? '–' : `${fmt(row.actual_yield, 2)}%`]]
        : [['작업 원판', `${fmt(row.raw_qty, 0)}매`]])]);
  // 가공 후보 추가 (가공매출이력 · 직접 입력)
  const addCandidate = () => {
    let value;
    let label;
    if (tab === 'sales') {
      const group = salesGroups.find((item) => String(item.value) === picked);
      if (!group) { setMessage('목록에서 출고 규격을 선택해 주세요. 없으면 직접 입력을 사용해 주세요.'); return; }
      value = group.value;
      label = `매출이력 ${group.last.id}`;
    } else {
      value = Number(manual);
      label = '직접 입력';
    }
    if (!(value > 0)) { setMessage(`제품 ${isCoil ? '폭' : '길이'}을 올바르게 입력해 주세요.`); return; }
    if (context.orderValues.some((x) => same(x, value))) { setMessage('이미 담은 발주품목의 규격입니다. [대기 품목]에서 함께 담아 주세요.'); return; }
    if (context.extraValues.some((x) => same(x, value))) { setMessage('이미 추가된 가공 후보입니다.'); return; }
    if (isCoil && context.rawWidth > 0 && value > context.rawWidth - context.trim + 1e-6) { setMessage(`현재 원코일 폭에 들어가지 않습니다. (사용 가능 ${fmt(context.rawWidth - context.trim)}mm)`); return; }
    if (!isCoil && context.rawWidth > 0 && value > Math.max(context.rawWidth, context.rawLength) + 1e-6) { setMessage('현재 원판 규격에 들어가지 않는 길이입니다.'); return; }
    onAdd(value, label);
    onClose();
  };

  const changeTab = (value) => { setTab(value); setMessage(''); };
  const tabs = kind === 'processing' && PROCESS_TABS.map((item) => <button key={item.value} type="button" role="tab" aria-selected={tab === item.value}
    onClick={() => changeTab(item.value)}>{item.label}<small>{item.hint}</small></button>);
  // 안내 첫 줄 (탭마다 한 줄로 · 높이 고정)
  const lead = tab === 'history' ? (kind === 'purchase' ? DESCRIPTIONS.purchase : DESCRIPTIONS.processing[material])
    : tab === 'sales' ? `예전에 출고한 제품 ${isCoil ? '폭' : '길이'}을 가공 후보로 추가합니다. 추가하면 ③ 추천조합을 혼합으로 다시 계산합니다.`
      : `주문에 없는 제품 ${isCoil ? '폭' : '길이'}을 직접 넣어 가공 후보로 추가합니다. 추가하면 ③ 추천조합을 혼합으로 다시 계산합니다.`;
  // 가공이력: 이력에서 쓴 원자재를 ① 원자재 후보로 (체크한 이력, 없으면 보고 있는 이력 1건 · 칼 배치 적합 여부와 무관)
  // 두께가 발주와 같은 이력의 원자재만 (슬리팅 · 절단으로 두께는 바뀌지 않는다)
  const rawRows = (pickedRows.length ? pickedRows : chosen ? [chosen.row] : []).filter((row) => same(row.thickness, context.thickness));
  const processFooter = kind === 'processing' && tab === 'history' ? <>
    <Button size="sm" variant="default" onClick={onClose}>취소</Button>
    <Button size="sm" color="dark" disabled={!rawRows.length} onClick={() => { onApply(rawRows, 'raw'); onClose(); }}
      title="이력에서 쓴 원자재 규격(원코일 폭 · 1개 중량 / 원판 폭 · 길이)을 ① 원자재 후보에 추가합니다. 체크한 이력이 없으면 보고 있는 이력 1건입니다.">
      원자재 후보로 추가{rawRows.length > 1 ? ` (${rawRows.length})` : ''}</Button>
    <Button size="sm" color="red" leftSection={<IconCheck size={15} />} disabled={!pickedRows.length} onClick={() => { onApply(pickedRows); onClose(); }}>
      {APPLY_LABEL[kind]}{pickedRows.length ? ` (${pickedRows.length})` : ''}</Button>
  </> : undefined;
  const frame = tab === 'history'
    ? { listTitle: '이력', count: shown.length, listHint: shown.length ? `고를 수 있는 이력 ${fmt(fitCount, 0)}건 (위쪽)` : '', selectedCount: pickedRows.length,
      onClearSelection: () => setChecked([]), onApply: () => { onApply(pickedRows); onClose(); }, applyLabel: APPLY_LABEL[kind], applyDisabled: !pickedRows.length, footerActions: processFooter }
    : tab === 'sales'
      ? { listTitle: '출고 규격', count: salesGroups.length, listHint: '행을 눌러 규격을 고르세요', selectedCount: picked ? 1 : 0,
        onClearSelection: () => setPicked(null), onApply: addCandidate, applyLabel: '가공 후보 추가', applyDisabled: !picked }
      : { listTitle: '배치 미리보기', count: undefined, listHint: isCoil ? '현재 원자재 폭에 몇 칼 들어가는지 보여 줍니다' : '', selectedCount: manual ? 1 : 0, selectionLabel: '입력',
        onApply: addCandidate, applyLabel: '가공 후보 추가', applyDisabled: !manual };
  // 검색 줄: 탭마다 같은 높이 (라벨 + 입력칸)
  const moreCount = ['productname', 'steelgrade', 'surface', 'warehouse', 'q'].filter((key) => String(filterInput[key] ?? '').trim()).length;
  const filters = tab === 'history' ? <>
    <ItemNameAutocomplete value={filterInput.name} exact={filterInput.nameExact} onKeyDown={onEnter} width={170} subject="이력"
      onChange={(value, exact) => setFilterInput((current) => ({ ...current, name: value, nameExact: exact }))} />
    <div className={classes.hxRange}>
      <label htmlFor="hx-thick-from">두께 (mm)</label>
      <div>
        <TextInput id="hx-thick-from" size="sm" type="number" step="0.01" min="0" aria-label="두께 시작" value={filterInput.thicknessFrom} onKeyDown={onEnter} onChange={setField('thicknessFrom')} />
        <span>~</span>
        <TextInput size="sm" type="number" step="0.01" min="0" aria-label="두께 끝" value={filterInput.thicknessTo} onKeyDown={onEnter} onChange={setField('thicknessTo')} />
      </div>
    </div>
    <TextInput size="sm" label="폭" type="number" step="0.1" min="0" style={{ width: 84 }} value={filterInput.width} onKeyDown={onEnter} onChange={setField('width')} />
    {!isCoil && <TextInput size="sm" label="길이" type="number" step="0.1" min="0" style={{ width: 84 }} value={filterInput.length} onKeyDown={onEnter} onChange={setField('length')} />}
    <Select size="sm" label="기간" value={months} allowDeselect={false} style={{ width: 120 }} onChange={setMonths} data={PERIODS} />
    <Button size="sm" color="red" leftSection={<IconSearch size={14} />} onClick={runSearch}>조회</Button>
    <button type="button" className={`${classes.hxMoreToggle} ${moreOpen ? classes.hxMoreOn : ''}`} aria-expanded={moreOpen} onClick={() => setMoreOpen((v) => !v)}>
      상세 조건{moreCount ? <em>{moreCount}</em> : null}<IconChevronDown size={14} stroke={2} /></button>
    {moreOpen && <div className={classes.hxMoreRow}>
      <TextInput size="sm" label="거래처 · 전표번호" style={{ width: 170 }} value={filterInput.q} onKeyDown={onEnter} onChange={setField('q')} />
      <TextInput size="sm" label="제품명" style={{ width: 130 }} value={filterInput.productname} onKeyDown={onEnter} onChange={setField('productname')} />
      <TextInput size="sm" label="강종" style={{ width: 110 }} value={filterInput.steelgrade} onKeyDown={onEnter} onChange={setField('steelgrade')} />
      <TextInput size="sm" label="표면" style={{ width: 100 }} value={filterInput.surface} onKeyDown={onEnter} onChange={setField('surface')} />
      <TextInput size="sm" label="창고" style={{ width: 130 }} value={filterInput.warehouse} onKeyDown={onEnter} onChange={setField('warehouse')} />
    </div>}
  </> : tab === 'sales' ? <>
    <TextInput size="sm" label="검색" placeholder={`제품 ${isCoil ? '폭' : '길이'} · 거래처`} style={{ width: 240 }} value={salesQuery} onChange={(event) => setSalesQuery(event.currentTarget.value)} />
  </> : <>
    <NumberInput size="sm" label={isCoil ? '제품 폭 (mm)' : '제품 길이 (mm)'} placeholder={isCoil ? '예: 165' : '예: 400'} value={manual} data-autofocus
      onChange={(value) => { setManual(value); setMessage(''); }} hideControls min={0} style={{ width: 240 }} />
    <span className={classes.hxFilterNote}>{isCoil ? `사용 가능 폭 ${fmt(candidates.usable)}mm 이하` : `제품 폭 ${fmt(context.itemWidth)}mm 기준 · 원판에 들어가는 길이`}</span>
  </>;

  return <PickerModal look="saas" opened={opened} onClose={onClose} title={TITLES[kind]} badge={isCoil ? '코일·스켈프' : '시트·판재'}
    description={kind === 'purchase' ? '과거에 매입한 원자재 규격을 골라 신규 원자재 후보로 추가합니다.' : '과거 가공 실적 · 출고 규격으로 추천조합을 보강합니다.'}
    icon={<IconHistory size={22} stroke={1.7} />}
    tabs={tabs || null}
    filters={kind === 'processing' || tab === 'history' ? filters : null}
    guide={<div className={classes.hxGuide}>
      <p title={lead}>{lead}</p>
      <div className={pickerClasses.criteria}>{basis.map(([key, value]) => <span key={key} title={value}><b>{key}</b>{value}</span>)}</div>
    </div>}
    loading={tab === 'history' ? loading : tab === 'sales' ? candidates.loading : false} {...frame}>
    {tab === 'history' && <div className={classes.hxSplit}>
      <div className={classes.hxSplitList}>
        <table className={pickerClasses.table} style={{ width: `max(100%, ${historyColumns.tableWidth}px)` }} aria-label={TITLES[kind]}>
          <colgroup>{historyColumnsDef.map((column) => <col key={column.key} data-column-key={column.key} style={{ width: historyColumns.widthOf(column) }} />)}</colgroup>
          <ResizableHead columns={historyColumnsDef} sizing={historyColumns}
            first={<input className={pickerClasses.checkbox} type="checkbox" aria-label="적합한 이력 모두 선택" checked={allChecked} disabled={!fitIds.length} onChange={() => setChecked(allChecked ? [] : fitIds)} />} />
          <tbody>{shown.map((item) => <tr key={item.row.id}
            className={`${checked.includes(item.row.id) ? pickerClasses.selectedRow : !item.fit.ok ? pickerClasses.disabledRow : ''} ${chosen?.row.id === item.row.id ? `${classes.hxFocusRow} ${checked.includes(item.row.id) ? '' : classes.hxFocusBg}` : ''}`}
            onClick={() => { setChosenId(item.row.id); toggle(item); }}>
            <td className={pickerClasses.center}><input className={pickerClasses.checkbox} type="checkbox" aria-label={`${item.row.id} 선택`} checked={checked.includes(item.row.id)} disabled={!item.fit.ok}
              onClick={(event) => event.stopPropagation()} onChange={() => toggle(item)} /></td>
            <td><span className={item.fit.ok ? classes.hxFitOk : classes.hxFitNo} title={item.fit.reason || ''}>{item.fit.label}</span></td>
            <td><b>{fmt(item.row.thickness, 3)} × {rawText(material, item.row)}</b></td>
            <td className={kind === 'purchase' ? pickerClasses.right : ''} title={kind === 'processing' ? patternText(material, item.row) : undefined}>
              {kind === 'purchase' ? (isCoil ? `${fmt(item.row.weight)}kg` : `${fmt(item.row.qty, 0)}매`) : patternText(material, item.row)}</td>
            <td>{String(item.row.date || '').slice(0, 10)}</td>
            {kind === 'purchase' && <td className={pickerClasses.center} title={item.row.origin === '기초' ? '기초재고로 등록한 원자재' : '입고(매입) 전표'}>{item.row.origin || '입고'}</td>}
            <td title={item.row.customer || ''}>{item.row.customer || '–'}</td>
            <td title={item.row.itemname || ''}>{item.row.itemname || '–'}</td>
            <td title={item.row.steelgrade || ''}>{item.row.steelgrade || '–'}</td>
            <td title={item.row.surface || ''}>{item.row.surface || '–'}</td>
          </tr>)}
          {!shown.length && <tr><td colSpan={historyColumnsDef.length} className={pickerClasses.emptyCell}>
            <PickerEmpty title={loading ? '이력을 불러오는 중입니다' : error || (searchName ? `"${searchName}" ${TITLES[kind]}이 없습니다` : `검색 조건에 맞는 ${TITLES[kind]}이 없습니다`)}
              description={loading ? '' : kind === 'purchase' ? '위 [품명]을 바꾸거나 비우고 [조회]하면 다른 품명의 입고(매입) 기록도 찾을 수 있습니다. 없으면 ①에서 규격을 직접 입력해 주세요.' : '위 [품명]을 바꾸거나 비우고 [조회]하면 다른 품명을 원자재로 쓴 가공등록 기록도 찾을 수 있습니다.'} />
          </td></tr>}
          </tbody>
        </table>
      </div>
      <aside className={classes.hxSplitDetail}>
        {chosen ? <>
          <div className={classes.hxCard}>
            <div className={classes.hxDetailHead}><strong>{chosen.row.id}</strong><span className={chosen.fit.ok ? classes.hxPillOk : classes.hxPillNo}>{chosen.fit.label}</span></div>
            <span className={classes.hxDetailSub}>{String(chosen.row.date || '').slice(0, 10)} · {chosen.row.customer || '–'}</span>
          </div>
          {kind === 'processing' && isCoil && <PatternBar row={chosen.row} rawWidth={context.rawWidth} trim={context.trim} orderValues={context.orderValues} />}
          <dl className={`${classes.hxCard} ${classes.hxKeyvals}`}>{detail(chosen.row).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
          {chosen.fit.ok
            ? <div className={classes.hxResult}>
              <span className={classes.hxResultLabel}>{kind === 'purchase' ? '① 원자재 후보에 추가' : '③ 추천조합에 추가'}</span>
              <strong>{kind === 'purchase' ? `${fmt(chosen.row.thickness, 3)} × ${rawText(material, chosen.row)}` : patternText(material, chosen.row)}</strong>
              <small>{kind === 'purchase' ? '여러 건을 고르면 첫 번째 규격이 선택됩니다.' : '여러 건을 고르면 A · B · C안으로 최대 3개까지 추가됩니다.'}</small>
              {chosen.fit.reason && <small>{chosen.fit.reason}</small>}
            </div>
            : <div className={classes.hxBlocked}>
              <span className={classes.hxResultLabel}>고를 수 없는 이력</span>
              <p>{chosen.fit.reason}</p>
            </div>}
          {kind === 'processing' && (same(chosen.row.thickness, context.thickness)
            ? <div className={`${classes.hxResult} ${classes.hxResultSub}`}>
              <span className={classes.hxResultLabel}>[원자재 후보로 추가] 시</span>
              <strong>{fmt(chosen.row.thickness, 3)} × {rawText(material, chosen.row)}{isCoil && chosen.row.raw_weight ? <em> · 1개 {fmt(chosen.row.raw_weight / (chosen.row.raw_qty || 1))}kg</em> : null}</strong>
              <small>이 이력의 원자재가 ① 후보에 신규로 추가됩니다. 칼 배치가 맞지 않아도 됩니다.</small>
            </div>
            : <div className={classes.hxBlocked}>
              <span className={classes.hxResultLabel}>원자재 후보로 추가 불가</span>
              <p>이력 두께 {fmt(chosen.row.thickness, 3)}T가 발주 두께 {fmt(context.thickness, 3)}T와 다릅니다.</p>
            </div>)}
        </> : <div className={classes.hxDetailEmpty}><strong>선택한 이력이 없습니다</strong><span>목록에서 이력을 누르면 상세와 적용 결과를 확인할 수 있습니다.</span></div>}
      </aside>
    </div>}
    {tab === 'sales' && <>
      {message && <p className={classes.hxMessage}>{message}</p>}
      <table className={pickerClasses.table} style={{ width: `max(100%, ${salesColumns.tableWidth}px)` }} aria-label="출고 규격">
        <colgroup>{salesColumnsDef.map((column) => <col key={column.key} data-column-key={column.key} style={{ width: salesColumns.widthOf(column) }} />)}</colgroup>
        <ResizableHead columns={salesColumnsDef} sizing={salesColumns} />
        <tbody>{salesGroups.map((group) => {
          const isPicked = picked === String(group.value);
          return <tr key={group.value} className={isPicked ? pickerClasses.selectedRow : group.reason ? pickerClasses.disabledRow : ''}
            onClick={() => { if (!group.reason) { setPicked(String(group.value)); setMessage(''); } }}>
            <td className={pickerClasses.center}><input className={pickerClasses.checkbox} type="radio" name="sales-pick" checked={isPicked} disabled={Boolean(group.reason)}
              onClick={(event) => event.stopPropagation()} onChange={() => { setPicked(String(group.value)); setMessage(''); }} aria-label={`${fmt(group.value)}mm 선택`} /></td>
            <td><b>{fmt(group.value)}mm</b></td>
            <td className={pickerClasses.right}>{fmt(group.count, 0)}회</td>
            <td className={pickerClasses.right}>{isCoil ? `${fmt(group.weight)}kg` : `${fmt(group.qty, 0)}매`}</td>
            <td title={group.last.customer || ''}>{String(group.last.date || '').slice(0, 10)} · {group.last.customer || '–'}</td>
            <td>{group.reason ? <span className={classes.hxFitNo}>{group.reason}</span> : <span className={classes.hxFitOk}>{group.sameThickness ? '추가 가능' : '추가 가능 · 두께 상이'}</span>}</td>
          </tr>;
        })}
        {!salesGroups.length && <tr><td colSpan={salesColumnsDef.length} className={pickerClasses.emptyCell}>
          <PickerEmpty title={candidates.loading ? '출고 이력을 불러오는 중입니다' : salesQuery ? '검색 조건에 맞는 출고 규격이 없습니다' : `"${context.itemname}" 출고 이력이 없습니다`}
            description={candidates.loading ? '' : `[직접 입력] 탭에서 제품 ${isCoil ? '폭' : '길이'}을 넣어 주세요.`} />
        </td></tr>}
        </tbody>
      </table>
    </>}
    {tab === 'manual' && <div className={classes.hxManualPane}>
      {message && <p className={classes.hxMessage}>{message}</p>}
      {isCoil ? <ManualPreview value={Number(manual) || 0} rawWidth={context.rawWidth} trim={context.trim} orderValues={context.orderValues} extraValues={context.extraValues} />
        : <div className={classes.hxChips}><b>담은 발주 길이</b>{context.orderValues.map((v) => <span key={v}>{fmt(v)}mm</span>)}
          {context.extraValues.length > 0 && <><b>추가된 가공 후보</b>{context.extraValues.map((v) => <span key={v} className={classes.hxChipExtra}>{fmt(v)}mm</span>)}</>}</div>}
    </div>}
  </PickerModal>;
}

// 폭 색: 발주 폭은 ③ 칼 배치와 같은 순서 · 같은 색, 그 밖의 폭은 회색 (가공 후보)
function toneOf(width, orderValues) {
  const index = (orderValues || []).findIndex((v) => same(v, width));
  return index < 0 ? classes.pieceExtra : classes[`piece${index % 4}`];
}

// 원코일 막대 (③ 칼 배치와 같은 색 · 로스 빗금)
function CoilStrip({ pieces, rawWidth, trim, orderValues, limit, newCut = false }) {
  const used = pieces.reduce((sum, w) => sum + w, 0);
  const loss = (rawWidth || 0) - used;   // 기본 로스 + 잔여폭
  const cap = (limit ?? rawWidth) - (trim || 0);   // 이 폭을 넘는 칼은 빨갛게 (원자재 폭 초과)
  const ends = pieces.reduce((list, w) => [...list, (list.at(-1) || 0) + w], []);
  return <div className={`${classes.coilBar} ${classes.hxStrip}`} role="img" aria-label={`원자재 ${fmt(rawWidth)}mm 칼 배치`}>
    {pieces.map((w, index) => {
      const over = ends[index] > cap + 1e-6;
      // 칼이 11개 이하면 칸마다 최소 폭을 줘서 숫자가 보이게 (좁아진 만큼 로스 빗금이 줄어든다). 많으면 비율 그대로
      const roomy = pieces.length <= 11;
      return <span key={index} className={`${classes.piece} ${roomy ? classes.hxPieceRoomy : classes.hxPiece} ${over ? classes.hxPieceOver : newCut ? classes.pieceNew : toneOf(w, orderValues)}`}
        style={{ flex: `${w} 1 0` }} title={over ? `${fmt(w)}mm · 원자재 폭 초과` : `${fmt(w)}mm`}>{roomy || (rawWidth > 0 && w / rawWidth >= 0.09) ? fmt(w) : ''}</span>;
    })}
    {loss > 0.001 && <span className={`${classes.piece} ${classes.loss}`} style={{ flex: loss }} title={`기본 로스 ${fmt(trim)}mm + 잔여폭 ${fmt(Math.max(0, loss - (trim || 0)))}mm`} />}
  </div>;
}

// 과거 가공이력 칼 배치를 현재 원자재 폭 위에 그려 본다 (사용폭 · 기본 로스 · 잔여폭)
function PatternBar({ row, rawWidth, trim, orderValues }) {
  const pattern = (row.pattern || []).filter(([w, n]) => w > 0 && n > 0);
  const pieces = pattern.flatMap(([w, n]) => Array.from({ length: Math.min(n, 60) }, () => w));
  const used = pattern.reduce((sum, [w, n]) => sum + w * n, 0);
  const spare = (rawWidth || 0) - used - (trim || 0);
  const knives = pattern.reduce((sum, [, n]) => sum + n, 0);
  const outside = pattern.filter(([w]) => !(orderValues || []).some((v) => same(v, w))).map(([w]) => `${fmt(w)}mm`);
  // ③ 추천조합 칼 배치와 같은 모양: 제목 줄 · 48px 막대 · 사용폭 | 원코일 | 기본 로스 · 잔여폭
  return <div className={classes.hxCard}>
    <div className={classes.hxCardTitle}><b>칼 배치</b><span>원코일 {fmt(rawWidth)}mm</span></div>
    <div className={classes.hxRunTitle}>{patternText('COIL', row)} · {knives}칼</div>
    <CoilStrip pieces={pieces} rawWidth={Math.max(rawWidth || 0, used)} trim={trim} orderValues={orderValues} limit={rawWidth || 0} />
    <div className={classes.subMetric}><span>사용폭 {fmt(used)}mm · {knives}칼</span>
      {spare < 0 ? <span className={classes.hxOver}>{fmt(-spare)}mm 초과</span> : <span>기본 로스 {fmt(trim)}mm · 잔여폭 {fmt(spare)}mm</span>}</div>
    {outside.length > 0 && <span className={classes.hxRunNote}>회색 칸은 이번 주문에 없는 폭 ({outside.join(', ')})</span>}
  </div>;
}

// 직접 입력 미리보기: 입력한 폭만으로 현재 원자재에 몇 칼 들어가는지 + 담은 발주 폭 · 추가된 가공 후보
function ManualPreview({ value, rawWidth, trim, orderValues, extraValues }) {
  const usable = (rawWidth || 0) - (trim || 0);
  const cuts = value > 0 && usable > 0 ? Math.min(60, Math.floor((usable + 1e-7) / value)) : 0;
  const rest = value > 0 ? Math.max(0, usable - cuts * value) : 0;
  return <div className={classes.hxPreview}>
    <div className={classes.hxPreviewHead}>
      <b>{value > 0 ? <>제품 폭 <em>{fmt(value)}mm</em> 만 넣으면</> : '제품 폭을 입력해 주세요'}</b>
      <span>원자재 {fmt(rawWidth)}mm · 기본 로스 {fmt(trim)}mm · 사용 가능 {fmt(usable)}mm</span>
    </div>
    {value > 0
      ? <CoilStrip pieces={Array.from({ length: cuts }, () => value)} rawWidth={rawWidth} trim={trim} orderValues={[]} newCut />
      : <div className={classes.hxPreviewEmpty}>위에 제품 폭을 입력하면 원자재에 몇 칼 들어가는지 바로 보여 줍니다.</div>}
    <div className={classes.hxPreviewStats}>
      <div className={cuts > 0 ? classes.hxStatMain : value > 0 ? classes.hxStatBad : ''}><span>최대 칼수</span><strong>{value > 0 ? `${fmt(cuts, 0)}칼` : '–'}</strong></div>
      <div><span>사용폭</span><strong>{value > 0 ? `${fmt(cuts * value)}mm` : '–'}</strong></div>
      <div><span>잔여폭</span><strong>{value > 0 ? `${fmt(rest)}mm` : '–'}</strong></div>
    </div>
    <div className={classes.hxLegend}>
      <span><i className={classes.pieceNew} />입력한 폭</span>
      {(orderValues || []).length > 0 && <span className={classes.hxLegendGroup}>담은 발주 폭{(orderValues || []).map((v) => <em key={v}>{fmt(v)}</em>)}</span>}
      {extraValues?.length > 0 && <span className={classes.hxLegendGroup}>추가된 가공 후보{extraValues.map((v) => <em key={v}>{fmt(v)}</em>)}</span>}
      <span><i className={classes.loss} />로스 · 잔여</span>
    </div>
    <p className={classes.hxPreviewNote}>참고용입니다. 실제 추천은 담은 발주 폭과 섞어(혼합) 계산합니다.</p>
  </div>;
}
