// 급여입력 (메뉴: PAYROLL) — 귀속월 급여를 만들고 고치고 마감한다.
// 흐름(화면 위 단계 표시): ① 급여 만들기(전월 불러오기) → ② 입력 · 확인(직원별 변동분 입력 · 저장) → ③ 마감
// 위: 월 이동 · 지급일 · 단계 · 월 동작(전월 불러오기 · 마감) + 그달 합계
// 왼쪽: 직원 목록(전체 · 미입력 · 입력완료) / 오른쪽: 선택한 직원 지급 | 공제, 아래 고정 줄에 실지급액 · 저장
// [목록 입력]: 표에서 여러 명 금액을 엑셀처럼 바로 입력(Enter · ↑↓ 로 위아래 이동) → [일괄 저장] 한 번
// [지급항목 설정]: 회사가 쓰는 지급항목만 보이게
// 버튼 색: 저장(주 동작) 빨강 · 월 동작(전월 불러오기 · 마감) 남색 · 삭제 · 마감취소 · 이전/다음 회색
// 서버: backend/services/payroll/Payroll.py (자기 회사 급여만)
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Box, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import useErpPageRibbon from '../../components/common/useErpPageRibbon';
import usePageReactivated from '../../components/common/usePageReactivated';
import ConfirmDeleteModal from '../../components/common/ConfirmDeleteModal';
import ErpDateInput from '../../components/common/ErpDateInput';
import { ColumnResizeHandle, pickerClasses, useResizableColumns } from '../../components/common/PickerModal';
import { apiErrorMessage } from '../../utils/apiError';
import { useUnsavedChanges } from '../../utils/dirtyRegistry';
import { ItemSettingsModal } from './PayrollTools';
import sharedClasses from '../../styles/pages/ManagementShared.module.css';
import simpleTheme from '../../styles/pages/SimpleTheme.module.css';
import classes from '../../styles/pages/User.module.css';
import pc from '../../styles/pages/Payroll.module.css';
import dk from '../../styles/components/DashboardKit.module.css';   // 지급일 칸: 대시보드 조회기간 칸과 같은 모양
import {
  DED_ITEMS, PAY_ITEMS, authConfig, defaultPaydate, kstToday, sumOf, won, ymLabel,
} from './payrollCommon';

const EMPTY_SLIP = {
  base_monthly: 0, family_cnt: 1, child_cnt: 0, tax_rate: 100, bankname: '', accountno: '', remark: '',
  ...Object.fromEntries([...PAY_ITEMS, ...DED_ITEMS].map((item) => [item.key, 0])),
};
const toDraft = (item) => Object.fromEntries(Object.keys(EMPTY_SLIP).map((key) => [key, item?.[key] ?? EMPTY_SLIP[key]]));
const isEntered = (item) => item.pay_total > 0;   // 지급액이 있으면 입력완료
const FILTERS = [{ key: 'all', label: '전체' }, { key: 'todo', label: '미입력' }, { key: 'done', label: '입력완료' }];
const STEPS = ['급여 만들기', '입력 · 확인', '마감'];
// 목록 칸 (머리 오른쪽 끝을 끌어 너비 조절 · 두 번 누르면 원래대로)
const LIST_COLUMNS = [
  { key: 'empno', label: '사원번호', width: 86 },
  { key: 'username', label: '사원명', width: 80 },
  { key: 'team', label: '부서', width: 100 },
  { key: 'pay_total', label: '지급', width: 104 },
  { key: 'ded_total', label: '공제', width: 96 },
  { key: 'net_pay', label: '실지급액', width: 108 },
  { key: 'state', label: '상태', width: 66 },
];

// 목록 입력: Enter · ↓ 는 아래 줄, ↑ 는 윗줄 같은 칸으로 (엑셀처럼)
const gridKey = (event) => {
  const { key } = event;
  if (!['Enter', 'ArrowDown', 'ArrowUp'].includes(key) || event.nativeEvent.isComposing) return;
  event.preventDefault();
  const { row, col } = event.currentTarget.dataset;
  const next = Number(row) + (key === 'ArrowUp' ? -1 : 1);
  event.currentTarget.closest('table')?.querySelector(`input[data-row="${next}"][data-col="${col}"]`)?.focus();
};

const shiftYm = (payym, diff) => {
  const [year, month] = payym.split('-').map(Number);
  const date = new Date(year, month - 1 + diff, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

// Enter 로 다음 입력칸 (상세 영역 안에서만)
const focusNext = (event) => {
  if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
  event.preventDefault();
  const scope = event.currentTarget.closest('[data-entry-scope]');
  const fields = [...(scope?.querySelectorAll('input:not([disabled]):not([readonly]), select:not([disabled])') || [])];
  fields[fields.indexOf(event.currentTarget) + 1]?.focus();
};

// 금액 칸: 쉼표 표시, 숫자만 (signed 면 음수 허용)
function MoneyInput({ value, onChange, signed = false, disabled, label, onKeyDown = focusNext, ...rest }) {
  const text = value === '' || value === '-' ? value : won(value);
  const change = (event) => {
    const raw = event.currentTarget.value.replace(/[^\d-]/g, '');
    const negative = signed && raw.startsWith('-');
    const digits = raw.replace(/-/g, '').slice(0, 12);
    if (negative && !digits) { onChange('-'); return; }
    onChange(digits ? Number(digits) * (negative ? -1 : 1) : 0);
  };
  return <input aria-label={label} className={`${pc.input} ${pc.num}`} inputMode="numeric" value={text} onChange={change} disabled={disabled}
    onFocus={(event) => event.currentTarget.select()} onKeyDown={onKeyDown} {...rest} />;
}

export default function PayrollEntry() {
  const [payym, setPayym] = useState(() => kstToday().slice(0, 7));
  const [paydate, setPaydate] = useState(() => defaultPaydate(kstToday().slice(0, 7)));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState('');     // 선택한 직원 이메일
  const [newEmail, setNewEmail] = useState(null);   // 추가 중이면 '' 또는 고른 직원 이메일
  const [draft, setDraft] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [view, setView] = useState('detail');      // detail 상세 입력 · grid 목록 입력
  const [gridEdits, setGridEdits] = useState({});  // 목록 입력에서 바꾼 직원: { email: 급여 }
  const [itemsOpen, setItemsOpen] = useState(false);   // 지급항목 설정 창
  const gridTimers = useRef({});
  const loadSeq = useRef(0);
  const calcSeq = useRef(0);
  const calcTimer = useRef(null);
  const calcPending = useRef(false);   // 지급을 바꿨는데 공제 계산이 아직 안 끝남 (저장 직전에 다시 계산)
  const gridPending = useRef(new Set());   // 목록 입력: 공제 계산이 아직 안 끝난 직원
  const payymRef = useRef(payym);
  payymRef.current = payym;

  const items = useMemo(() => data?.items || [], [data]);
  const closed = Boolean(data?.closed);
  const current = items.find((item) => item.useremail === selected) || null;
  const adding = newEmail !== null;
  const todoCount = items.filter((item) => !isEntered(item)).length;
  const shown = useMemo(() => items.filter((item) => (filter === 'all' ? true : filter === 'todo' ? !isEntered(item) : isEntered(item))), [filter, items]);
  const totals = useMemo(() => ({
    pay: items.reduce((s, i) => s + i.pay_total, 0), ded: items.reduce((s, i) => s + i.ded_total, 0), net: items.reduce((s, i) => s + i.net_pay, 0),
  }), [items]);
  const step = !items.length ? 0 : closed ? 2 : 1;
  const gridDirty = Object.keys(gridEdits).length > 0;
  const anyDirty = dirty || gridDirty;
  // 회사가 쓰는 지급항목 (설정이 없으면 모두) — 이미 금액이 있는 항목은 설정과 상관없이 보인다
  const enabledKeys = useMemo(() => data?.pay_items || PAY_ITEMS.map((i) => i.key), [data]);
  const gridPayItems = useMemo(() => PAY_ITEMS.filter((i) => enabledKeys.includes(i.key) || items.some((r) => Number(r[i.key] || 0) !== 0)), [enabledKeys, items]);
  const cols = useResizableColumns(LIST_COLUMNS);

  // keepPaydate: 지급일을 골라 달을 옮긴 경우 그 날짜를 그대로 둔다
  const load = useCallback(async (targetYm, keepEmail = '', keepPaydate = null) => {
    const seq = ++loadSeq.current;
    setLoading(true);
    try {
      const { data: result } = await axios.get('/api/payroll/slips', { ...authConfig(), params: { payym: targetYm } });
      if (seq !== loadSeq.current) return;
      setData(result);
      if (keepPaydate) setPaydate(keepPaydate);
      else if (result.items[0]?.paydate) setPaydate(result.items[0].paydate);
      // 처음 열 때는 첫 직원을 바로 보여 준다
      const keep = result.items.find((item) => item.useremail === keepEmail) || (keepEmail === null ? null : result.items[0]);
      setSelected(keep?.useremail || '');
      setDraft(keep ? toDraft(keep) : null);
      setNewEmail(null);
      setDirty(false);
      setGridEdits({});
    } catch (error) {
      if (seq === loadSeq.current) notifications.show({ title: '급여 조회 실패', message: apiErrorMessage(error, '급여를 불러오지 못했습니다.'), color: 'red' });
    } finally { if (seq === loadSeq.current) setLoading(false); }
  }, []);

  useEffect(() => { void load(payymRef.current); }, [load]);
  usePageReactivated(() => { if (!dirty && !gridDirty) void load(payymRef.current, selected); });

  // 확인 창 (브라우저 확인 창 대신 공통 확인 창): { title, message, confirmLabel, action }
  const [ask, setAsk] = useState(null);
  // 저장하지 않은 내용이 있으면 묻고, [이동]을 누르면 action 실행
  const withLeave = (action) => {
    if (!anyDirty) { action(); return; }
    setAsk({ title: '저장하지 않은 내용이 있습니다', message: '버리고 이동하면 입력한 내용이 사라집니다.', confirmLabel: '이동', action });
  };
  useUnsavedChanges(anyDirty);   // 탭 닫기 · 브라우저 닫기 전에 확인

  // ── 목록 입력 ──
  const changeView = (next) => {
    if (next === view) return;
    withLeave(() => { setView(next); setGridEdits({}); setDirty(false); if (current) setDraft(toDraft(current)); });
  };
  const gridRow = (item) => ({ ...item, ...(gridEdits[item.useremail] || {}) });
  const setGridField = (item, key, value) => {
    const email = item.useremail;
    setGridEdits((cur) => {
      const row = { ...toDraft(item), ...(cur[email] || {}), [key]: value };
      // 공제는 직원마다 잠시 뒤 서버 계산 (기타공제는 그대로)
      window.clearTimeout(gridTimers.current[email]);
      gridPending.current.add(email);
      gridTimers.current[email] = window.setTimeout(async () => {
        try {
          const { data: result } = await axios.post('/api/payroll/calc', { payym: payymRef.current, slip: { ...row, [key]: value === '-' ? 0 : value } }, authConfig());
          if (!gridPending.current.has(email)) return;   // 그새 저장 · 취소됨
          gridPending.current.delete(email);
          setGridEdits((now) => (now[email] ? { ...now, [email]: { ...now[email], ...Object.fromEntries(DED_ITEMS.map((d) => [d.key, result[d.key]])) } } : now));
        } catch (error) {
          notifications.show({ title: '공제 계산 실패', message: apiErrorMessage(error, '공제를 계산하지 못했습니다.'), color: 'red' });
        }
      }, 300);
      return { ...cur, [email]: row };
    });
  };
  const saveGrid = useCallback(async () => {
    const rows = Object.entries(gridEdits).map(([useremail, slip]) => ({
      useremail, slip: Object.fromEntries(Object.entries(slip).map(([k, v]) => [k, v === '-' ? 0 : v])),
    }));
    if (!rows.length) return;
    if (!paydate) { notifications.show({ title: '저장 확인', message: '지급일을 입력해 주세요.', color: 'red' }); return; }
    setSaving(true);
    try {
      // 공제 계산이 아직 안 끝난 직원은 지금 계산해서 저장 (빨리 누르면 예전 공제로 저장되는 것 방지)
      const pending = rows.filter((row) => gridPending.current.has(row.useremail));
      pending.forEach((row) => { window.clearTimeout(gridTimers.current[row.useremail]); gridPending.current.delete(row.useremail); });
      await Promise.all(pending.map(async (row) => {
        const { data: calc } = await axios.post('/api/payroll/calc', { payym, slip: row.slip }, authConfig());
        row.slip = { ...row.slip, ...Object.fromEntries(DED_ITEMS.map((d) => [d.key, calc[d.key]])) };
      }));
      const { data: result } = await axios.put('/api/payroll/slips/bulk', { payym, paydate, rows }, authConfig());
      notifications.show({ title: '일괄 저장 완료', message: `${result.saved}명의 급여를 저장했습니다.`, color: 'teal' });
      setGridEdits({});
      await load(payym, selected);
    } catch (error) {
      notifications.show({ title: '일괄 저장 실패', message: apiErrorMessage(error, '급여를 저장하지 못했습니다.'), color: 'red' });
    } finally { setSaving(false); }
  }, [gridEdits, load, paydate, payym, selected]);

  const changeYm = (value) => {
    if (!value) return;
    withLeave(() => {
      setPayym(value);
      setPaydate(defaultPaydate(value));
      setFilter('all');
      void load(value);
    });
  };

  // 지급일을 고르면 그 날짜가 속한 달로 이동 (같은 달이면 날짜만 바꿈)
  const changePaydate = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '') || value.slice(0, 7) === payym) { setPaydate(value); return; }
    const ym = value.slice(0, 7);
    withLeave(() => {
      setPayym(ym);
      setFilter('all');
      setPaydate(value);
      void load(ym, '', value);
    });
  };

  const open = (item) => {
    window.clearTimeout(calcTimer.current);
    calcPending.current = false;
    ++calcSeq.current;
    setSelected(item.useremail);
    setNewEmail(null);
    setDraft(toDraft(item));
    setDirty(false);
  };
  const select = (item) => {
    if (item.useremail === selected && !adding) return;
    withLeave(() => open(item));
  };
  // 목록(지금 보이는 필터) 안에서 이전 · 다음 직원
  const index = shown.findIndex((item) => item.useremail === selected);
  const neighbor = (diff) => (index < 0 ? null : shown[index + diff] || null);
  const move = (diff) => { const target = neighbor(diff); if (target) withLeave(() => open(target)); };

  // 공제 자동 계산 (지급 · 계산 기준이 바뀌면 잠시 뒤 서버에 계산을 맡긴다)
  const recalc = useCallback((slip, notify = false) => {
    window.clearTimeout(calcTimer.current);
    calcPending.current = true;
    calcTimer.current = window.setTimeout(async () => {
      const seq = ++calcSeq.current;
      try {
        const { data: result } = await axios.post('/api/payroll/calc', { payym: payymRef.current, slip }, authConfig());
        if (seq !== calcSeq.current) return;
        calcPending.current = false;
        setDraft((cur) => (cur ? { ...cur, ...Object.fromEntries(DED_ITEMS.map((item) => [item.key, result[item.key]])) } : cur));
        if (notify) {
          notifications.show({
            title: '공제 다시 계산',
            message: result.pay_total > 0
              ? `공제 합계 ${won(result.ded_total)}원 · 실지급액 ${won(result.net_pay)}원 (과세 지급액 ${won(result.taxable)}원 기준)`
              : '지급항목이 없어 공제가 0원입니다. 기본급 등 지급항목을 먼저 입력하세요.',
            color: result.pay_total > 0 ? 'teal' : 'yellow',
          });
        }
      } catch (error) {
        if (seq === calcSeq.current) notifications.show({ title: '공제 계산 실패', message: apiErrorMessage(error, '공제를 계산하지 못했습니다.'), color: 'red' });
      }
    }, notify ? 0 : 250);
  }, []);

  const setField = (key, value, autoCalc) => {
    setDirty(true);
    setDraft((cur) => {
      const next = { ...cur, [key]: value };
      if (autoCalc) recalc(next);
      return next;
    });
  };

  const startAdd = useCallback(() => {
    if (closed || !data?.candidates?.length) return;
    withLeave(() => {
      setSelected('');
      setNewEmail('');
      setDraft(toDraft(null));
      setDirty(false);
    });
  }, [closed, data, dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useCallback(async () => {
    const email = adding ? newEmail : selected;
    if (!draft || !email) {
      notifications.show({ title: '저장 확인', message: adding ? '추가할 직원을 골라 주세요.' : '직원을 선택해 주세요.', color: 'red' });
      return;
    }
    if (!paydate) { notifications.show({ title: '저장 확인', message: '지급일을 입력해 주세요.', color: 'red' }); return; }
    setSaving(true);
    try {
      let slip = { ...draft };
      Object.keys(slip).forEach((key) => { if (slip[key] === '-') slip[key] = 0; });
      if (calcPending.current) {
        window.clearTimeout(calcTimer.current);
        ++calcSeq.current;   // 진행 중이던 계산 결과는 버린다
        const { data: result } = await axios.post('/api/payroll/calc', { payym, slip }, authConfig());
        slip = { ...slip, ...Object.fromEntries(DED_ITEMS.map((item) => [item.key, result[item.key]])) };
        calcPending.current = false;
      }
      await axios.put('/api/payroll/slips', { payym, useremail: email, paydate, slip }, authConfig());
      notifications.show({ title: '저장 완료', message: '급여를 저장했습니다.', color: 'teal' });
      setDirty(false);
      await load(payym, email);
    } catch (error) {
      notifications.show({ title: '저장 실패', message: apiErrorMessage(error, '급여를 저장하지 못했습니다.'), color: 'red' });
    } finally { setSaving(false); }
  }, [adding, draft, load, newEmail, paydate, payym, selected]);

  const remove = async () => {
    setBusy(true);
    try {
      await axios.delete('/api/payroll/slips', { ...authConfig(), params: { payym, useremail: selected } });
      setDeleteOpen(false);
      notifications.show({ title: '삭제 완료', message: `${current?.username || ''} 님의 급여를 삭제했습니다.`, color: 'teal' });
      setDirty(false);
      await load(payym);
    } catch (error) {
      notifications.show({ title: '삭제 실패', message: apiErrorMessage(error, '급여를 삭제하지 못했습니다.'), color: 'red' });
    } finally { setBusy(false); }
  };

  const generate = () => {
    if (!paydate) { notifications.show({ title: '전월 불러오기', message: '지급일을 먼저 입력해 주세요.', color: 'red' }); return; }
    withLeave(() => { void runGenerate(); });
  };
  const runGenerate = async () => {
    setBusy(true);
    try {
      const { data: result } = await axios.post('/api/payroll/generate', { payym, paydate }, authConfig());
      notifications.show({
        title: '전월 불러오기',
        message: result.created ? `${result.created}명을 만들었습니다 (지난 급여 복사 ${result.copied}명)` : '새로 만들 재직자가 없습니다.',
        color: 'teal',
      });
      setDirty(false);
      await load(payym, selected);
    } catch (error) {
      notifications.show({ title: '전월 불러오기 실패', message: apiErrorMessage(error, '급여를 만들지 못했습니다.'), color: 'red' });
    } finally { setBusy(false); }
  };

  const toggleClose = () => {
    const close = !closed;
    if (close) {
      const message = [dirty ? '저장하지 않은 내용은 버려집니다.' : '', todoCount ? `지급액이 없는 직원이 ${todoCount}명 있습니다.` : '', '마감하면 직원이 내 급여현황에서 명세서를 봅니다.'].filter(Boolean).join(' ');
      setAsk({ title: `${ymLabel(payym)} 급여를 마감할까요?`, target: `${items.length}명 · 실지급액 ${won(totals.net)}원`, message, confirmLabel: '마감', action: () => { void runToggleClose(true); } });
      return;
    }
    setAsk({ title: '급여 마감을 취소할까요?', target: ymLabel(payym), message: '직원의 내 급여현황에서도 이 달이 숨겨집니다.', confirmLabel: '마감 취소', action: () => { void runToggleClose(false); } });
  };
  const runToggleClose = async (close) => {
    setBusy(true);
    try {
      await axios.post('/api/payroll/close', { payym, close }, authConfig());
      notifications.show({ title: close ? '마감 완료' : '마감 취소', message: close ? `${ymLabel(payym)} 급여를 마감했습니다. 직원이 내 급여현황에서 볼 수 있습니다.` : `${ymLabel(payym)} 급여를 다시 고칠 수 있습니다.`, color: 'teal' });
      setDirty(false);
      await load(payym, selected);
    } catch (error) {
      notifications.show({ title: '마감 처리 실패', message: apiErrorMessage(error, '마감을 처리하지 못했습니다.'), color: 'red' });
    } finally { setBusy(false); }
  };

  useErpPageRibbon({
    onSearch: () => withLeave(() => { void load(payym, selected); }),
    onAdd: view === 'detail' && !closed && data?.candidates?.length ? startAdd : undefined,
    onSave: view === 'grid' ? (gridDirty && !closed && !saving ? saveGrid : undefined) : draft && !closed && !saving && (dirty || adding) ? save : undefined,
    onDelete: view === 'detail' && current && !closed && !adding ? () => setDeleteOpen(true) : undefined,
    showPrint: false,
    useSaveColor: false,
  });

  const payTotal = draft ? sumOf(draft, PAY_ITEMS) : 0;
  const dedTotal = draft ? sumOf(draft, DED_ITEMS) : 0;
  const person = adding ? data?.candidates?.find((c) => c.email === newEmail) : current;
  const locked = closed;
  const candidates = data?.candidates || [];

  return <Box className={`${simpleTheme.simple} ${simpleTheme.noIcons} ${sharedClasses.pageShell} ${classes.page}`}>
    <Box component="nav" className={classes.breadcrumb}>
      <Text component="span" className={classes.breadcrumbParent}>급여관리</Text>
      <Text component="span" className={classes.breadcrumbChevron}>›</Text>
      <Text component="span" className={classes.breadcrumbCurrent}>급여입력</Text>
    </Box>

    {/* 월 머리: 월 이동 · 지급일 · 단계 · 월 동작 / 그달 합계 */}
    <section className={pc.monthCard}>
      <div className={pc.monthTop}>
        <div className={pc.monthNav}>
          <button type="button" className={pc.navBtn} onClick={() => changeYm(shiftYm(payym, -1))} aria-label="이전 달">‹</button>
          <label className={pc.monthPick}>
            <span>{ymLabel(payym)}</span>
            <input type="month" value={payym} onChange={(event) => changeYm(event.currentTarget.value)} aria-label="귀속년월" />
          </label>
          <button type="button" className={pc.navBtn} onClick={() => changeYm(shiftYm(payym, 1))} aria-label="다음 달">›</button>
        </div>
        <div className={pc.paydate}>
          <span>지급일</span>
          <div className={`${dk.rangeBox} ${pc.dateIcon}`} title="날짜를 고르면 그 달 급여로 이동합니다">
            <ErpDateInput aria-label="지급일" value={paydate} onChange={(event) => changePaydate(event.currentTarget.value)} disabled={closed} />
          </div>
        </div>

        <ol className={pc.steps} aria-label="진행 단계">
          {STEPS.map((label, i) => <li key={label} className={i < step || (i === 2 && closed) ? pc.stepDone : i === step ? pc.stepNow : ''}>
            <b>{i + 1}</b>{label}
          </li>)}
        </ol>

        <div className={pc.monthActions}>
          {!closed && <button type="button" className={`${pc.btn} ${pc.btnNavy}`} onClick={generate} disabled={busy || loading}
            title="그달 재직자 중 급여가 없는 직원을 만들고, 지난 급여의 고정값을 복사합니다">전월 불러오기</button>}
          {items.length > 0 && <button type="button" className={`${pc.btn} ${closed ? pc.btnGray : pc.btnNavy}`} onClick={toggleClose} disabled={busy}>
            {closed ? '마감취소' : '마감'}
          </button>}
        </div>
      </div>
      <dl className={pc.kpis}>
        <div><dt>인원</dt><dd>{items.length}<small>명</small>{todoCount > 0 && <em>미입력 {todoCount}</em>}</dd></div>
        <div><dt>지급 합계</dt><dd>{won(totals.pay)}<small>원</small></dd></div>
        <div><dt>공제 합계</dt><dd>{won(totals.ded)}<small>원</small></dd></div>
        <div className={pc.kpiNet}><dt>실지급액 합계</dt><dd>{won(totals.net)}<small>원</small></dd></div>
        <div><dt>상태</dt><dd className={closed ? pc.closedText : ''}>{!items.length ? '미작성' : closed ? '마감' : '작성중'}</dd></div>
      </dl>
    </section>

    <div className={`${pc.entryLayout} ${view === 'grid' ? pc.entryFull : ''}`}>
      {/* 왼쪽: 직원 목록 */}
      <section className={pc.listCard}>
        <div className={pc.listHead}>
          <div className={pc.tabs} role="tablist">
            {FILTERS.map((f) => {
              const count = f.key === 'all' ? items.length : f.key === 'todo' ? todoCount : items.length - todoCount;
              return <button key={f.key} type="button" role="tab" aria-selected={filter === f.key} className={filter === f.key ? pc.tabOn : ''} onClick={() => setFilter(f.key)}>
                {f.label} <span>{count}</span>
              </button>;
            })}
          </div>
          <span className={pc.filterGap} />
          {view === 'detail' && !closed && candidates.length > 0 && <button type="button" className={`${pc.btn} ${pc.btnNavy} ${pc.btnSmall}`} onClick={startAdd}
            title="이 달 급여가 없는 재직자를 추가합니다">직원 추가 {candidates.length}</button>}
          <button type="button" className={`${pc.btn} ${pc.btnGray} ${pc.btnSmall}`} onClick={() => setItemsOpen(true)}>지급항목 설정</button>
          {items.length > 0 && <div className={`${pc.slideSeg} ${view === 'grid' ? pc.slideSegRight : ''}`} role="radiogroup" aria-label="입력 방식">
            <span className={pc.slideThumb} aria-hidden="true" />
            {[['detail', '상세 입력'], ['grid', '목록 입력']].map(([key, label]) => <button key={key} type="button" role="radio" aria-checked={view === key}
              className={view === key ? pc.slideOn : ''} onClick={() => changeView(key)}>{label}</button>)}
          </div>}
        </div>
        <div className={pc.gridWrap}>
          {items.length > 0 && view === 'grid' ? <table className={`${pc.grid} ${pc.editGrid}`} style={{ minWidth: 380 + gridPayItems.length * 118 + 330 }}>
            <colgroup><col style={{ width: 86 }} /><col style={{ width: 84 }} />{gridPayItems.map((i) => <col key={i.key} style={{ width: 118 }} />)}
              <col style={{ width: 110 }} /><col style={{ width: 104 }} /><col style={{ width: 116 }} /></colgroup>
            <thead><tr><th>사원번호</th><th>사원명</th>{gridPayItems.map((i) => <th key={i.key} title={i.nontax ? (i.hint || '비과세 20만') : undefined}>{i.label}</th>)}
              <th>지급 합계</th><th>공제 합계</th><th>실지급액</th></tr></thead>
            <tbody>
              {shown.map((item, rowIndex) => {
                const row = gridRow(item);
                const pay = sumOf(row, PAY_ITEMS);
                const ded = sumOf(row, DED_ITEMS);
                return <tr key={item.useremail} className={gridEdits[item.useremail] ? pc.editedRow : ''}>
                  <td className={pc.center}>{item.empno}</td>
                  <td className={pc.center}><b className={pc.name}>{item.username}</b></td>
                  {gridPayItems.map((i, colIndex) => <td key={i.key} className={pc.editCell}>
                    <MoneyInput label={`${item.username} ${i.label}`} value={row[i.key]} signed={i.signed} disabled={closed}
                      onChange={(v) => setGridField(item, i.key, v)} onKeyDown={gridKey} data-row={rowIndex} data-col={colIndex} />
                  </td>)}
                  <td className={pc.num}>{won(pay)}</td>
                  <td className={pc.num}>{won(ded)}</td>
                  <td className={pc.num}><b className={pay - ded < 0 ? pc.minus : ''}>{won(pay - ded)}</b></td>
                </tr>;
              })}
            </tbody>
          </table>
          : items.length > 0 ? <table className={pc.grid} style={{ width: `max(100%, ${cols.tableWidth}px)` }}>
            <colgroup>{LIST_COLUMNS.map((c) => <col key={c.key} data-column-key={c.key} style={{ width: cols.widthOf(c) }} />)}</colgroup>
            <thead><tr>{LIST_COLUMNS.map((c) => <th key={c.key} className={pickerClasses.resizableHead}>{c.label}<ColumnResizeHandle column={c} columns={cols} /></th>)}</tr></thead>
            <tbody>
              {shown.map((item) => <tr key={item.useremail} className={item.useremail === selected && !adding ? pc.selected : ''} onClick={() => select(item)}>
                <td className={pc.center}>{item.empno}</td>
                <td className={pc.center}><b className={pc.name}>{item.username}</b></td>
                <td className={pc.center} title={item.team}>{item.team}</td>
                <td className={pc.num}>{won(item.pay_total)}</td>
                <td className={pc.num}>{won(item.ded_total)}</td>
                <td className={pc.num}><b>{won(item.net_pay)}</b></td>
                <td className={`${pc.center} ${isEntered(item) ? pc.stateDone : pc.stateTodo}`}>{isEntered(item) ? '완료' : '미입력'}</td>
              </tr>)}
              {!shown.length && <tr><td colSpan={7} className={pc.emptyCell}>{filter === 'todo' ? '미입력 직원이 없습니다.' : '입력을 마친 직원이 없습니다.'}</td></tr>}
            </tbody>
            <tfoot><tr><td colSpan={3} className={pc.center}>합계 {items.length}명</td><td className={pc.num}>{won(totals.pay)}</td><td className={pc.num}>{won(totals.ded)}</td><td className={pc.num}>{won(totals.net)}</td><td /></tr></tfoot>
          </table>
            : <div className={pc.startBox}>
              {loading ? <p>조회 중...</p> : <>
                <h4>{ymLabel(payym)} 급여가 아직 없습니다</h4>
                <p>지급일을 확인하고 <b>전월 불러오기</b>를 누르면 재직자 급여가 만들어집니다.<br />지난 급여가 있으면 기본급 · 고정수당 · 계좌가 그대로 복사됩니다.</p>
                <button type="button" className={`${pc.btn} ${pc.btnRed}`} onClick={generate} disabled={busy || closed}>전월 불러오기</button>
              </>}
            </div>}
        </div>
        {view === 'grid' && items.length > 0 && <div className={pc.saveBar}>
          <span className={pc.equation}>{closed ? '마감된 달은 고칠 수 없습니다.' : gridDirty ? <>바꾼 직원 <b>{Object.keys(gridEdits).length}</b>명 · 공제는 자동 계산</> : 'Enter · ↑↓ 로 위아래 칸 이동 · 공제는 자동 계산'}</span>
          {!closed && <div className={pc.saveActions}>
            <button type="button" className={`${pc.btn} ${pc.btnGray}`} onClick={() => { gridPending.current.clear(); setGridEdits({}); }} disabled={!gridDirty || saving}>변경 취소</button>
            <button type="button" className={`${pc.btn} ${pc.btnRed}`} onClick={saveGrid} disabled={!gridDirty || saving}>일괄 저장</button>
          </div>}
        </div>}
      </section>

      {/* 오른쪽: 상세 */}
      {view === 'detail' && <section className={pc.detailCard} data-entry-scope>
        {!draft ? <div className={pc.placeholder}>{items.length ? '왼쪽 목록에서 직원을 선택하세요.' : '급여를 만든 뒤 직원별로 입력합니다.'}</div> : <>
          <div className={pc.personHead}>
            {adding
              ? <select className={`${pc.input} ${pc.personSelect}`} value={newEmail} onChange={(event) => { setNewEmail(event.currentTarget.value); setDirty(true); }} aria-label="추가할 직원">
                <option value="">추가할 직원 선택</option>
                {candidates.map((c) => <option key={c.email} value={c.email}>{c.username}{c.empno ? ` (${c.empno})` : ''}</option>)}
              </select>
              : <h3>{person?.username}</h3>}
            <span className={pc.personMeta}>{[person?.empno, person?.team, person?.position].filter(Boolean).join(' · ')}</span>
            {dirty && <span className={pc.dirtyMark}>변경됨</span>}
            {!adding && <div className={pc.personNav}>
              <button type="button" className={`${pc.btn} ${pc.btnGray} ${pc.btnSmall}`} onClick={() => move(-1)} disabled={!neighbor(-1)}>이전</button>
              <span>{index + 1} / {shown.length}</span>
              <button type="button" className={`${pc.btn} ${pc.btnGray} ${pc.btnSmall}`} onClick={() => move(1)} disabled={!neighbor(1)}>다음</button>
            </div>}
          </div>
          {closed && <div className={pc.lockNote}>마감된 달입니다. 고치려면 위의 <b>마감취소</b>를 누르세요.</div>}

          <div className={pc.detailScroll}>
            <div className={pc.pair}>
              <div className={pc.itemBox}>
                <div className={pc.itemHead}><h4>지급</h4><span>{won(payTotal)}원</span></div>
                {PAY_ITEMS.filter((item) => enabledKeys.includes(item.key) || Number(draft[item.key] || 0) !== 0).map((item) => <label key={item.key} className={pc.itemRow}>
                  <span>{item.label}{item.nontax && <small>{item.hint || '비과세 20만'}</small>}</span>
                  <MoneyInput label={item.label} value={draft[item.key]} signed={item.signed} disabled={locked} onChange={(v) => setField(item.key, v, true)} />
                </label>)}
              </div>
              <div className={pc.itemBox}>
                <div className={pc.itemHead}>
                  <h4>공제</h4><span>{won(dedTotal)}원</span>
                  {!locked && <button type="button" className={pc.linkBtn} onClick={() => recalc(draft, true)}>다시 계산</button>}
                </div>
                {DED_ITEMS.map((item) => <label key={item.key} className={pc.itemRow}>
                  <span>{item.label}</span>
                  <MoneyInput label={item.label} value={draft[item.key]} signed={item.signed} disabled={locked} onChange={(v) => setField(item.key, v)} />
                </label>)}
                <p className={pc.itemNote}>지급을 바꾸면 자동으로 다시 계산됩니다. 국민연금 · 건강보험은 기본급, 고용보험 · 소득세는 과세 지급액 기준.</p>
              </div>
            </div>

            <div className={pc.subSection}>
              <h4>세금 기준 · 계좌</h4>
              <div className={pc.inlineFields}>
                <label><span>공제가족</span>
                  <input className={`${pc.input} ${pc.num} ${pc.short}`} type="number" min={1} max={20} value={draft.family_cnt} disabled={locked} onKeyDown={focusNext}
                    title="본인 포함" aria-label="공제대상가족 수(본인 포함)" onChange={(event) => { const family = Math.max(1, Math.min(20, Number(event.currentTarget.value) || 1)); if (Number(draft.child_cnt) > family - 1) setField('child_cnt', family - 1); setField('family_cnt', family, true); }} /><em>명</em></label>
                <label><span>자녀</span>
                  <input className={`${pc.input} ${pc.num} ${pc.short}`} type="number" min={0} max={20} value={draft.child_cnt} disabled={locked} onKeyDown={focusNext}
                    title="8세 이상 20세 이하" aria-label="8세 이상 20세 이하 자녀 수" onChange={(event) => { const child = Math.max(0, Math.min(19, Number(event.currentTarget.value) || 0)); if (child > Number(draft.family_cnt) - 1) setField('family_cnt', child + 1); setField('child_cnt', child, true); }} /><em>명</em></label>
                <label><span>징수비율</span>
                  <select className={`${pc.input} ${pc.short}`} value={draft.tax_rate} disabled={locked} onKeyDown={focusNext} aria-label="원천징수 비율"
                    onChange={(event) => setField('tax_rate', Number(event.currentTarget.value), true)}>
                    <option value={80}>80%</option><option value={100}>100%</option><option value={120}>120%</option>
                  </select></label>
              </div>
              <div className={pc.inlineFields}>
                <label><span>은행</span><input className={pc.input} value={draft.bankname} maxLength={50} disabled={locked} onKeyDown={focusNext} onChange={(event) => setField('bankname', event.currentTarget.value)} aria-label="은행" /></label>
                <label className={pc.grow}><span>계좌번호</span><input className={pc.input} value={draft.accountno} maxLength={50} disabled={locked} onKeyDown={focusNext} onChange={(event) => setField('accountno', event.currentTarget.value)} aria-label="계좌번호" /></label>
              </div>
              <div className={pc.inlineFields}>
                <label className={pc.grow}><span>적요</span><input className={pc.input} value={draft.remark} maxLength={200} disabled={locked} onKeyDown={focusNext}
                  placeholder="명세서 계산방법 (예: 연장근무 10시간 × 15,000원)" onChange={(event) => setField('remark', event.currentTarget.value)} aria-label="적요" /></label>
              </div>
            </div>
          </div>

          {/* 아래 고정: 실지급액 + 동작 */}
          <div className={pc.saveBar}>
            <div className={pc.equation}>
              <span>지급 <b>{won(payTotal)}</b></span><i>−</i><span>공제 <b>{won(dedTotal)}</b></span><i>=</i>
              <span className={pc.netValue}>실지급액 <b className={payTotal - dedTotal < 0 ? pc.minus : ''}>{won(payTotal - dedTotal)}</b>원</span>
            </div>
            {!locked && <div className={pc.saveActions}>
              {!adding && <button type="button" className={`${pc.btn} ${pc.btnGray}`} onClick={() => setDeleteOpen(true)} disabled={busy || saving}>삭제</button>}
              <button type="button" className={`${pc.btn} ${pc.btnRed}`} onClick={save} disabled={saving || (!dirty && !adding)}>저장</button>
            </div>}
          </div>
        </>}
      </section>}
    </div>

    {itemsOpen && <ItemSettingsModal opened onClose={() => setItemsOpen(false)} enabled={enabledKeys}
      onSaved={(keys) => setData((cur) => (cur ? { ...cur, pay_items: keys } : cur))} />}
    <ConfirmDeleteModal opened={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={remove} loading={busy}
      title="급여를 삭제할까요?" target={`${ymLabel(payym)} · ${current?.username || ''}`} message="이 직원의 이 달 급여가 삭제되며" />
    <ConfirmDeleteModal opened={Boolean(ask)} onClose={() => setAsk(null)}
      onConfirm={() => { const action = ask?.action; setAsk(null); action?.(); }}
      showIcon={false} title={ask?.title} target={ask?.target} message={ask?.message} note="그래도 진행할까요?" confirmLabel={ask?.confirmLabel || '확인'} />
  </Box>;
}
