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
import { IconHistory } from '@tabler/icons-react';
import PickerModal, { ColumnResizeHandle, PickerEmpty, pickerClasses, useResizableColumns } from '../../components/common/PickerModal';
import classes from '../../styles/pages/AIOrderOptimization.module.css';
import m from '../../styles/pages/AIOrderManage.module.css';

const API = '/api/ai-optimization';
const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });
const fmt = (value, digits = 1) => (value === null || value === undefined || value === '' ? '–'
  : Number(value).toLocaleString('ko-KR', { maximumFractionDigits: digits }));
const same = (a, b) => Math.abs(Number(a) - Number(b)) < 1e-6;
const FIELD_LOOK = { input: m.mInput, label: m.mLabel };
const PERIODS = [{ value: '0', label: '전체 기간' }, { value: '3', label: '최근 3개월' }, { value: '6', label: '최근 6개월' }, { value: '12', label: '최근 12개월' }];

function useHistory(opened, kind, material, itemname, months, query) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!opened) return undefined;
    let alive = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const { data } = await axios.get(`${API}/history`, { ...authConfig(), params: { kind, material, itemname: itemname || '', months, q: query } });
        if (alive) setRows(data.items || []);
      } catch (err) {
        if (alive) { setRows([]); setError(typeof err?.response?.data?.detail === 'string' ? err.response.data.detail : '이력을 불러오지 못했습니다.'); }
      } finally {
        if (alive) setLoading(false);
      }
    }, 250);
    return () => { alive = false; clearTimeout(timer); };
  }, [opened, kind, material, itemname, months, query]);
  return { rows, loading, error };
}

// 현재 ③ 값으로 본 적합 여부 { ok, label, reason }
export function historyFit(kind, material, row, ctx) {
  if (kind === 'purchase') {
    return same(row.thickness, ctx.thickness) ? { ok: true, label: '두께 일치' }
      : { ok: false, label: '두께 상이', reason: `발주 두께 ${fmt(ctx.thickness, 3)}T와 다른 이력입니다. 같은 두께의 매입이력만 후보로 추가할 수 있습니다.` };
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
  return usedLength <= cap + 1e-3 ? { ok: true, label: '적용 가능' } : { ok: false, label: '원판 초과', reason: '현재 원판 규격·절단방향에 과거 패턴이 들어가지 않습니다.' };
}

const patternText = (material, row) => (material === 'COIL'
  ? (row.pattern || []).map(([w, n]) => `${fmt(w)}×${n}`).join(' + ')
  : (row.pattern || []).map(([, l, n]) => `${fmt(l)}×${n}`).join(' + '));
const rawText = (material, row) => (material === 'COIL' ? `${fmt(row.raw_width ?? row.width)} × C` : `${fmt(row.raw_width ?? row.width)} × ${fmt(row.raw_length ?? row.length)}`);

const TITLES = { purchase: '과거 매입이력', processing: '과거 가공이력' };
const DESCRIPTIONS = {
  purchase: '과거 입고(매입)한 원자재 규격을 조회해 ① 신규 원자재 후보로 추가합니다. 현재고가 아닙니다.',
  processing: { COIL: '가공등록에서 실제로 가공한 폭·칼수 조합을 조회하고, 현재 원자재 폭으로 검증해 ③ 추천에 반영합니다.', SHEET: '가공등록에서 실제로 절단한 패턴을 조회하고, 현재 원판에 들어가는지 검증해 ③ 추천에 반영합니다.' },
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
  { key: 'date', label: kind === 'purchase' ? '입고일' : '작업일', width: 100 },
  { key: 'customer', label: '거래처', width: 160 },
  { key: 'grade', label: '강종', width: 110 },
  { key: 'spec', label: kind === 'purchase' ? '매입 규격' : '사용 원자재', width: 160 },
  { key: 'amount', label: kind === 'purchase' ? (isCoil ? '중량' : '수량') : '가공패턴', width: 150, align: 'right' },
  { key: 'fit', label: '적합', width: 110 },
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
  const [query, setQuery] = useState('');
  const [months, setMonths] = useState('0');
  const [grade, setGrade] = useState('ALL');
  const [chosenId, setChosenId] = useState(null);
  const [checked, setChecked] = useState([]);   // 반영할 이력 (여러 건)
  const [picked, setPicked] = useState(null);   // 가공매출이력에서 고른 출고 규격
  const [manual, setManual] = useState('');     // 직접 입력한 가공 후보
  const [message, setMessage] = useState('');
  const isCoil = material === 'COIL';
  const historyColumnsDef = useMemo(() => HISTORY_COLUMNS(kind, isCoil), [kind, isCoil]);
  const salesColumnsDef = useMemo(() => SALES_COLUMNS(isCoil), [isCoil]);
  const historyColumns = useResizableColumns(historyColumnsDef);
  const salesColumns = useResizableColumns(salesColumnsDef);
  const { rows, loading, error } = useHistory(opened && tab === 'history', kind, material, context.itemname, months, query.trim());
  const candidates = useCandidates(opened && kind === 'processing' && tab === 'sales', material, context);
  const grades = useMemo(() => [...new Set(rows.map((row) => row.steelgrade).filter(Boolean))], [rows]);
  // 적합한 이력이 먼저
  const shown = useMemo(() => rows.filter((row) => grade === 'ALL' || row.steelgrade === grade)
    .map((row) => ({ row, fit: historyFit(kind, material, row, context) }))
    .sort((a, b) => Number(b.fit.ok) - Number(a.fit.ok)), [rows, grade, kind, material, context]);
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
      ? [['품명', context.itemname || '–'], [isCoil ? '원자재 폭' : '원판', isCoil ? `${fmt(context.rawWidth)}mm` : `${fmt(context.rawWidth)} × ${fmt(context.rawLength)}mm`], [isCoil ? '기본 로스' : '제품 폭', isCoil ? `${fmt(context.trim)}mm` : `${fmt(context.itemWidth)}mm`]]
      : [['품명', context.itemname || '–'], ['두께', `${fmt(context.thickness, 3)}T`],
        [isCoil ? '사용 가능 폭' : '원판', isCoil ? `${fmt(candidates.usable)}mm (원자재 ${fmt(context.rawWidth)} − 로스 ${fmt(context.trim)})` : `${fmt(context.rawWidth)} × ${fmt(context.rawLength)}mm · 제품 폭 ${fmt(context.itemWidth)}mm`],
        ...(context.extraValues.length ? [['추가된 가공 후보', context.extraValues.map((v) => `${fmt(v)}mm`).join(', ')]] : [])];
  const detail = (row) => (kind === 'purchase'
    ? [['입고번호', row.id], ['입고일', String(row.date || '').slice(0, 10)], ['매입처', row.customer || '–'], ['품명', row.itemname],
      ['강종 · 표면', [row.steelgrade, row.surface].filter(Boolean).join(' · ') || '–'], ['규격', `${fmt(row.thickness, 3)} × ${rawText(material, row)}`],
      [isCoil ? '중량' : '수량', isCoil ? `${fmt(row.weight)}kg` : `${fmt(row.qty, 0)}매 · ${fmt(row.weight)}kg`], ['매입단가', row.unitprice ? `${fmt(row.unitprice, 2)}원` : '–'], ['창고', row.warehouse || '–']]
    : [['가공번호', row.id], ['작업일', String(row.date || '').slice(0, 10)], ['거래처', row.customer || '–'], ['원자재', `${row.itemname} ${fmt(row.thickness, 3)}T × ${rawText(material, row)}`],
      ['가공패턴', patternText(material, row)],
      ...(isCoil ? [['칼수', `${row.knives}칼`], ['작업 원코일', `${fmt(row.raw_weight)}kg (${fmt(row.raw_qty, 0)}개)`],
        ['실적 로스', row.actual_loss === null || row.actual_loss === undefined ? '–' : `${fmt(row.actual_loss)}kg`], ['실적 수율', row.actual_yield === null || row.actual_yield === undefined ? '–' : `${fmt(row.actual_yield, 2)}%`]]
        : [['작업 원판', `${fmt(row.raw_qty, 0)}매`]])]);
  const applyText = kind === 'purchase'
    ? (row) => `반영하면 ① 원자재 후보에 "매입이력 ${row.id}" ${fmt(row.thickness, 3)} × ${rawText(material, row)} 규격이 추가됩니다. 여러 건이면 첫 번째가 선택됩니다. 실제 재고가 아니라 '이 규격을 사면' 기준입니다.`
    : (row) => `반영하면 ③ 추천조합에 ${patternText(material, row)} 칼 배치 안이 추가됩니다. 여러 건이면 안마다 하나씩 (A·B·C 최대 3개). (가공이력 ${row.no})`;

  // 가공 후보 추가 (가공매출이력 · 직접 입력)
  const addCandidate = () => {
    let value;
    let label;
    if (tab === 'sales') {
      const group = candidates.groups.find((item) => String(item.value) === picked);
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

  const tabs = kind === 'processing' && <div className={`${classes.hxTabs} ${classes.hxPickerTabs}`} role="tablist" aria-label="이력 구분">
    {PROCESS_TABS.map((item) => <button key={item.value} type="button" role="tab" aria-selected={tab === item.value}
      className={tab === item.value ? classes.hxTabOn : ''} title={item.hint} onClick={() => { setTab(item.value); setMessage(''); }}>{item.label}</button>)}
  </div>;
  const lead = tab === 'history' ? (kind === 'purchase' ? DESCRIPTIONS.purchase : DESCRIPTIONS.processing[material])
    : `${tab === 'sales' ? `과거 출고(매출)한 제품 ${isCoil ? '폭' : '길이'}을 규격별로 모아 보여 줍니다. ` : ''}주문에는 없지만 같은 원자재에서 함께 생산할 제품 ${isCoil ? '폭' : '길이'}을 가공 후보로 추가합니다. 추가하면 혼합으로 바뀌고 ③ 추천조합이 다시 계산됩니다.`;
  const frame = tab === 'history'
    ? { listTitle: '이력', count: shown.length, listHint: shown.length ? `적합 ${fmt(fitCount, 0)}건 · 적합한 이력이 위에 표시됩니다` : '', selectedCount: pickedRows.length,
      onClearSelection: () => setChecked([]), onApply: () => { onApply(pickedRows); onClose(); }, applyLabel: APPLY_LABEL[kind], applyDisabled: !pickedRows.length }
    : tab === 'sales'
      ? { listTitle: '출고 규격', count: candidates.groups.length, listHint: '행을 눌러 규격을 고르세요', selectedCount: picked ? 1 : 0,
        onClearSelection: () => setPicked(null), onApply: addCandidate, applyLabel: '가공 후보 추가', applyDisabled: !picked }
      : { listTitle: '직접 입력', count: undefined, listHint: '', selectedCount: manual ? 1 : 0, selectionLabel: '입력',
        onApply: addCandidate, applyLabel: '가공 후보 추가', applyDisabled: !manual };

  return <PickerModal opened={opened} onClose={onClose} title={TITLES[kind]} badge={isCoil ? '코일·스켈프' : '시트·판재'}
    description={kind === 'purchase' ? '과거에 매입한 원자재 규격을 골라 신규 원자재 후보로 추가합니다.' : '과거 가공 실적 · 출고 규격으로 추천조합을 보강합니다.'}
    icon={<IconHistory size={22} stroke={1.7} />}
    filters={(tabs || tab === 'history') ? <>
      {tabs}
      {tab === 'history' && <>
        <TextInput size="sm" label="검색" placeholder="거래처 · 전표번호 · 강종" style={{ width: 240 }} value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
        <Select size="sm" label="기간" value={months} allowDeselect={false} style={{ width: 140 }} onChange={setMonths} data={PERIODS} />
        <Select size="sm" label="강종" value={grade} allowDeselect={false} style={{ width: 150 }} onChange={setGrade} data={[{ value: 'ALL', label: '전체 강종' }, ...grades.map((g) => ({ value: g, label: g }))]} />
        <Button size="sm" variant="default" onClick={() => { setQuery(''); setMonths('0'); setGrade('ALL'); }}>초기화</Button>
      </>}
    </> : null}
    guide={<>
      <p>{lead}</p>
      <div className={pickerClasses.criteria}>{basis.map(([key, value]) => <span key={key}><b>{key}</b>{value}</span>)}</div>
    </>}
    loading={tab === 'history' ? loading : tab === 'sales' ? candidates.loading : false} {...frame}>
    {tab === 'history' && <div className={classes.hxSplit}>
      <div className={classes.hxSplitList}>
        <table className={pickerClasses.table} style={{ width: `max(100%, ${historyColumns.tableWidth}px)` }} aria-label={TITLES[kind]}>
          <colgroup>{historyColumnsDef.map((column) => <col key={column.key} data-column-key={column.key} style={{ width: historyColumns.widthOf(column) }} />)}</colgroup>
          <ResizableHead columns={historyColumnsDef} sizing={historyColumns}
            first={<input className={pickerClasses.checkbox} type="checkbox" aria-label="적합한 이력 모두 선택" checked={allChecked} disabled={!fitIds.length} onChange={() => setChecked(allChecked ? [] : fitIds)} />} />
          <tbody>{shown.map((item) => <tr key={item.row.id}
            className={checked.includes(item.row.id) ? pickerClasses.selectedRow : !item.fit.ok ? pickerClasses.disabledRow : chosen?.row.id === item.row.id ? classes.hxFocusRow : ''}
            onClick={() => setChosenId(item.row.id)}>
            <td className={pickerClasses.center}><input className={pickerClasses.checkbox} type="checkbox" aria-label={`${item.row.id} 선택`} checked={checked.includes(item.row.id)} disabled={!item.fit.ok}
              onClick={(event) => event.stopPropagation()} onChange={() => toggle(item)} /></td>
            <td>{String(item.row.date || '').slice(0, 10)}</td>
            <td title={item.row.customer || ''}>{item.row.customer || '–'}</td>
            <td title={item.row.steelgrade || ''}>{item.row.steelgrade || '–'}</td>
            <td><b>{fmt(item.row.thickness, 3)} × {rawText(material, item.row)}</b></td>
            <td className={pickerClasses.right}>{kind === 'purchase' ? (isCoil ? `${fmt(item.row.weight)}kg` : `${fmt(item.row.qty, 0)}매`) : patternText(material, item.row)}</td>
            <td><span className={item.fit.ok ? classes.hxFitOk : classes.hxFitNo} title={item.fit.reason || ''}>{item.fit.label}</span></td>
          </tr>)}
          {!shown.length && <tr><td colSpan={historyColumnsDef.length} className={pickerClasses.emptyCell}>
            <PickerEmpty title={loading ? '이력을 불러오는 중입니다' : error || `"${context.itemname}" ${TITLES[kind]}이 없습니다`}
              description={loading ? '' : kind === 'purchase' ? '같은 품명의 입고(매입) 기록을 찾습니다. 검색어 · 기간을 바꾸거나 ①에서 폭을 직접 입력해 주세요.' : '같은 품명을 원자재로 쓴 가공등록 기록을 찾습니다. 가공등록 실적이 쌓이면 여기에 표시됩니다.'} />
          </td></tr>}
          </tbody>
        </table>
      </div>
      <aside className={classes.hxSplitDetail}>
        {chosen ? <>
          <div className={classes.hxDetailHead}><strong>{chosen.row.id}</strong><span className={chosen.fit.ok ? classes.hxFitOk : classes.hxFitNo}>{chosen.fit.label}</span></div>
          {kind === 'processing' && isCoil && <PatternBar row={chosen.row} rawWidth={context.rawWidth} trim={context.trim} />}
          <dl className={classes.hxKeyvals}>{detail(chosen.row).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
          {chosen.fit.ok
            ? <p className={classes.hxApply}><b>적용하면</b>{applyText(chosen.row)}</p>
            : <p className={classes.hxReason}><b>적용할 수 없습니다</b>{chosen.fit.reason}</p>}
        </> : <div className={classes.hxDetailEmpty}><strong>선택한 이력이 없습니다</strong><span>목록에서 이력을 누르면 상세와 적용 결과를 확인할 수 있습니다.</span></div>}
      </aside>
    </div>}
    {tab === 'sales' && <>
      {message && <p className={classes.hxMessage}>{message}</p>}
      <table className={pickerClasses.table} style={{ width: `max(100%, ${salesColumns.tableWidth}px)` }} aria-label="출고 규격">
        <colgroup>{salesColumnsDef.map((column) => <col key={column.key} data-column-key={column.key} style={{ width: salesColumns.widthOf(column) }} />)}</colgroup>
        <ResizableHead columns={salesColumnsDef} sizing={salesColumns} />
        <tbody>{candidates.groups.map((group) => {
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
        {!candidates.groups.length && <tr><td colSpan={salesColumnsDef.length} className={pickerClasses.emptyCell}>
          <PickerEmpty title={candidates.loading ? '출고 이력을 불러오는 중입니다' : `"${context.itemname}" 출고 이력이 없습니다`} description={candidates.loading ? '' : `[직접 입력]으로 제품 ${isCoil ? '폭' : '길이'}을 넣어 주세요.`} />
        </td></tr>}
        </tbody>
      </table>
    </>}
    {tab === 'manual' && <div className={classes.hxManualPane}>
      <NumberInput size="sm" label={isCoil ? '제품 폭 (mm)' : `제품 길이 (mm) · 폭 ${fmt(context.itemWidth)}mm 기준`} placeholder={isCoil ? '예: 165' : '예: 400'} value={manual} onChange={(value) => { setManual(value); setMessage(''); }} hideControls min={0} style={{ width: 260 }} />
      <span>{isCoil ? `사용 가능 폭 ${fmt(candidates.usable)}mm 이하로 입력합니다.` : '원판에 들어가는 길이로 입력합니다.'}</span>
      {message && <p className={classes.hxMessage}>{message}</p>}
    </div>}
  </PickerModal>;
}

// 과거 가공이력 칼 배치를 현재 원자재 폭 위에 그려 본다 (사용폭 · 로스 · 남는 폭)
function PatternBar({ row, rawWidth, trim }) {
  const total = Math.max(rawWidth || 0, row.raw_width || 0, 1);
  const pieces = (row.pattern || []).flatMap(([w, n]) => Array.from({ length: Math.min(n, 40) }, () => w));
  const used = pieces.reduce((sum, w) => sum + w, 0);
  const remain = (rawWidth || 0) - used - (trim || 0);
  return <div className={classes.hxBar}>
    <div className={classes.hxBarTrack}>
      {pieces.map((w, index) => <span key={index} className={classes.hxBarPiece} style={{ flexBasis: `${(w / total) * 100}%` }} title={`${fmt(w)}mm`}>{w / total > 0.08 ? fmt(w) : ''}</span>)}
      {remain > 0 && <span className={classes.hxBarRest} style={{ flexBasis: `${(remain / total) * 100}%` }} />}
    </div>
    <div className={classes.hxBarLegend}><span>사용 {fmt(used)}mm</span><span>로스 {fmt(trim)}mm</span><span className={remain < 0 ? classes.hxOver : ''}>{remain < 0 ? `${fmt(-remain)}mm 초과` : `남는 폭 ${fmt(remain)}mm`}</span><span>현재 원자재 {fmt(rawWidth)}mm</span></div>
  </div>;
}
