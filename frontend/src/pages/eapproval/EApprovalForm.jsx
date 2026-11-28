// 결재양식관리 (메뉴: EAPPROVAL_FORM) — 양식 사용 여부 · 양식별 기본 결재선(고정) · 직원별 연차 발생 일수
// 서버: backend/services/eapproval/EApproval.py (admin_settings · save_admin)
import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import axios from 'axios';
import { Box, Group, Loader, Modal, NumberInput, Pagination, Paper, Select, Switch, Text, TextInput, Textarea } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconBan, IconUserCheck } from '@tabler/icons-react';
import useErpPageRibbon from '../../components/common/useErpPageRibbon';
import ErpDateInput from '../../components/common/ErpDateInput';
import { ColumnResizeHandle, pickerClasses, useResizableColumns } from '../../components/common/PickerModal';
import usePageReactivated from '../../components/common/usePageReactivated';
import sharedClasses from '../../styles/pages/ManagementShared.module.css';
import simpleTheme from '../../styles/pages/SimpleTheme.module.css';
import classes from '../../styles/pages/InboundRegister.module.css';
import own from '../../styles/pages/ControlManagement.module.css';
import ea from '../../styles/pages/EApproval.module.css';
import { apiErrorMessage } from '../../utils/apiError';
import { yearKST } from '../../utils/dateFormat';

const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });
const errorText = (error, fallback = '처리하지 못했습니다.') => apiErrorMessage(error, fallback);
const num = (value) => (value === null || value === undefined ? '-' : Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 2 }));
const THIS_YEAR = yearKST();
// 시간 고르기: 30분 단위 (06:00 ~ 23:30)
const TIME_OPTIONS = Array.from({ length: 36 }, (_, i) => { const m = 360 + i * 30; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; });
const toMin = (t) => { const [h, m] = String(t || '0:0').split(':').map(Number); return h * 60 + m; };
const fromMin = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const duration = (slot) => {
  const d = toMin(slot.to) - toMin(slot.from);
  return `${Math.floor(d / 60) ? `${Math.floor(d / 60)}시간` : ''}${d % 60 ? ` ${d % 60}분` : ''}`.trim();
};
// 겹치는 시간대 번호
const overlaps = (slots) => {
  const bad = new Set();
  slots.forEach((a, i) => slots.forEach((b, j) => { if (i < j && toMin(a.from) < toMin(b.to) && toMin(b.from) < toMin(a.to)) { bad.add(i); bad.add(j); } }));
  return bad;
};
// 다음 시간대: 마지막 시간대 끝부터 2시간
const nextSlot = (slots) => {
  const start = slots.length ? Math.min(toMin(slots[slots.length - 1].to), 21 * 60) : 9 * 60;
  return { from: fromMin(start), to: fromMin(Math.min(start + 120, 23 * 60 + 30)) };
};
// 시간 막대: 07:00 ~ 21:00 위에 시간대를 그린다
const BAR_START = 7 * 60;
const BAR_END = 21 * 60;
const barPos = (t) => Math.max(0, Math.min(100, ((toMin(t) - BAR_START) / (BAR_END - BAR_START)) * 100));
function TimeBar({ slots, kind }) {
  return <div className={ea.timeBarWrap} aria-hidden="true">
    <div className={ea.timeBar}>
      {[9, 12, 15, 18].map((h) => <span key={h} className={ea.timeTick} style={{ left: `${barPos(`${h}:00`)}%` }} />)}
      {slots.map((s, i) => (toMin(s.from) < toMin(s.to) ? <span key={i} className={`${ea.timeBlock} ${ea[`timeBlock_${kind}`]}`}
        style={{ left: `${barPos(s.from)}%`, width: `${barPos(s.to) - barPos(s.from)}%` }} title={`${s.from} ~ ${s.to}`}>{kind === 'QUARTER' ? i + 1 : ''}</span> : null))}
    </div>
    <div className={ea.timeScale}>{[9, 12, 15, 18].map((h) => <span key={h} style={{ left: `${barPos(`${h}:00`)}%` }}>{h}시</span>)}</div>
  </div>;
}
const TIME_ROWS = [['HALF_AM', '오전반차', '0.5일'], ['HALF_PM', '오후반차', '0.5일'], ['QUARTER', '반반차', '0.25일']];

const kstTime = (value) => {
  if (!value) return '';
  const d = new Date(value);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
};

// 칸 너비를 끌어서 바꾸는 표 (머리글 오른쪽 끝 손잡이 · 두 번 누르면 원래대로)
const alignOf = (column) => (column.align === 'right' ? own.num : column.align === 'center' ? own.center : '');
function GridTable({ columns, className, children }) {
  const cols = useResizableColumns(columns);
  return <table className={className} style={{ width: `max(100%, ${cols.tableWidth}px)`, maxWidth: 'none' }}>
    <colgroup>{columns.map((column) => <col key={column.key} data-column-key={column.key} style={{ width: cols.widthOf(column) }} />)}</colgroup>
    <thead><tr>{columns.map((column) => <th key={column.key} className={`${pickerClasses.resizableHead} ${alignOf(column)}`}>
      {column.label}<ColumnResizeHandle column={column} columns={cols} />
    </th>)}</tr></thead>
    <tbody>{children}</tbody>
  </table>;
}
const FORM_COLUMNS = [
  { key: 'form', label: '양식', width: 150, minWidth: 100 },
  { key: 'use', label: '사용', width: 100, minWidth: 70 },
  { key: 'line', label: '결재선 (순서대로 결재)', width: 780, minWidth: 240 },
];
const LEAVE_COLUMNS = [
  { key: 'name', label: '이름', width: 120, minWidth: 80 },
  { key: 'team', label: '부서 · 직급', width: 220, minWidth: 100 },
  { key: 'hire', label: '입사일', width: 120, minWidth: 90, align: 'center' },
  { key: 'granted', label: '발생(일)', width: 110, minWidth: 90, align: 'right' },
  { key: 'used', label: '사용', width: 90, minWidth: 60, align: 'right' },
  { key: 'pending', label: '결재중', width: 90, minWidth: 60, align: 'right' },
  { key: 'remain', label: '잔여', width: 90, minWidth: 60, align: 'right' },
];
const PENDING_COLUMNS = [
  { key: 'state', label: '상태', width: 92, minWidth: 70, align: 'center' },
  { key: 'docno', label: '문서번호', width: 124, minWidth: 90 },
  { key: 'form', label: '양식', width: 70, minWidth: 56, align: 'center' },
  { key: 'writer', label: '신청자', width: 84, minWidth: 64, align: 'center' },
  { key: 'title', label: '제목', width: 220, minWidth: 100 },
  { key: 'line', label: '결재선', width: 240, minWidth: 120 },
  { key: 'submitted', label: '신청일시', width: 136, minWidth: 100, align: 'center' },
  { key: 'change', label: '결재자 변경', width: 104, minWidth: 90, align: 'center' },
  { key: 'reject', label: '반려', width: 76, minWidth: 64, align: 'center' },
];

// ── 진행 문서: 결재중 문서 · 결재할 수 없는 결재자(사용 중지 · 권한 없음) → 결재자 변경 · 관리자 반려 ──
const PENDING_HINT = {
  blocked: '지금 결재할 사람이 사용 중지 계정이거나 전자결재 권한이 없어 결재가 진행되지 않는 문서',
  warn: '지금은 진행 중이지만, 뒤 단계 결재자가 사용 중지 계정이거나 전자결재 권한이 없어 그 단계에서 멈출 문서',
};
const PENDING_FORMS = [{ value: '', label: '전체 양식' }, { value: 'LEAVE', label: '휴가신청서' }, { value: 'TRIP', label: '출장신청서' }, { value: 'REPORT', label: '업무보고서' }];
const PAGE_SIZE = 30;
function PendingTab({ reloadKey }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [filters, setFilters] = useState({ date_from: '', date_to: '', formcode: '', q: '' });   // 입력 중
  const [query, setQuery] = useState(filters);                                                  // 조회한 조건
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [change, setChange] = useState(null);   // { doc, step, approver }
  const [reject, setReject] = useState(null);   // { doc, reason }
  const seq = useRef(0);   // 늦게 도착한 이전 조회 결과는 버린다
  const load = useCallback(async (targetPage, cond) => {
    const mySeq = ++seq.current;
    setLoading(true);
    try {
      const params = { page: targetPage, page_size: PAGE_SIZE, q: cond.q.trim(), formcode: cond.formcode };
      if (cond.date_from) params.date_from = cond.date_from;
      if (cond.date_to) params.date_to = cond.date_to;
      const { data: result } = await axios.get('/api/eapproval/admin/pending', { ...authConfig(), params });
      if (mySeq !== seq.current) return;
      setData(result);
      setPage(targetPage);
    } catch (error) {
      if (mySeq === seq.current) notifications.show({ title: '진행 문서 조회 실패', message: errorText(error), color: 'red' });
    } finally { if (mySeq === seq.current) setLoading(false); }
  }, []);
  const runLoad = useEffectEvent((targetPage) => { void load(targetPage, query); });
  useEffect(() => { runLoad(1); }, [reloadKey, query]);
  const reload = () => load(page, query);

  // 결재자 변경 창: 단계를 정해서 열거나(결재선의 이름 클릭), 문제 있는 단계 → 지금 차례 순으로 미리 고른다
  const openChange = (doc, step) => {
    const target = step || doc.steps.find((x) => x.status === 'WAIT' && x.problem)?.step || doc.current_step;
    setChange({ doc, step: target, approver: null });
  };
  const saveChange = async () => {
    if (!change?.step || !change?.approver) return;
    setBusy(true);
    try {
      await axios.post(`/api/eapproval/admin/docs/${encodeURIComponent(change.doc.docno)}/approver`, { step: change.step, approver: change.approver }, authConfig());
      notifications.show({ title: '결재자를 바꿨습니다', message: change.doc.docno, color: 'teal' });
      setChange(null);
      window.dispatchEvent(new Event('eapproval-changed'));
      await reload();
    } catch (error) {
      notifications.show({ title: '바꿀 수 없습니다', message: errorText(error), color: 'red' });
    } finally { setBusy(false); }
  };
  const saveReject = async () => {
    if (!reject?.reason?.trim()) return;
    setBusy(true);
    try {
      await axios.post(`/api/eapproval/admin/docs/${encodeURIComponent(reject.doc.docno)}/reject`, { comment: reject.reason }, authConfig());
      notifications.show({ title: '반려했습니다', message: reject.doc.docno, color: 'teal' });
      setReject(null);
      window.dispatchEvent(new Event('eapproval-changed'));
      await reload();
    } catch (error) {
      notifications.show({ title: '반려할 수 없습니다', message: errorText(error), color: 'red' });
    } finally { setBusy(false); }
  };

  if (!data) return <div className={own.empty}><Loader size="sm" color="red" /></div>;
  const rows = data.docs;
  const searched = Boolean(query.q.trim() || query.formcode || query.date_from || query.date_to);
  const changeDoc = change?.doc;
  const taken = changeDoc ? changeDoc.steps.filter((x) => x.status === 'WAIT' && x.step !== change.step).map((x) => x.approver) : [];
  const approverOptions = (data.approvers || []).filter((x) => x.email !== changeDoc?.writer && !taken.includes(x.email))
    .map((x) => ({ value: x.email, label: `${x.name}${x.team ? ` · ${x.team}` : ''}${x.position ? ` ${x.position}` : ''}` }));
  const modalProps = { centered: true, size: 420, withCloseButton: false, padding: 0, radius: 16, returnFocus: false, overlayProps: { backgroundOpacity: 0.2 },
    closeOnEscape: !busy, closeOnClickOutside: !busy, classNames: { content: ea.pmContent } };

  return <section className={own.block}>
    <div className={own.blockHead}><h3>진행 문서</h3>
      <span>결재자가 사용 중지되었거나 전자결재 권한이 없어 멈춘 문서는 결재자를 바꾸거나 반려할 수 있습니다.</span></div>
    {/* 조회 조건: 신청일 · 양식 · 문서번호 / 제목 / 신청자 (Enter) */}
    <div className={ea.pendingBar}>
      <div className={own.period}>
        <ErpDateInput aria-label="신청일 시작" value={filters.date_from} onChange={(event) => { const next = { ...filters, date_from: event.currentTarget.value }; setFilters(next); setQuery(next); }} />
        <span>~</span>
        <ErpDateInput aria-label="신청일 끝" value={filters.date_to} onChange={(event) => { const next = { ...filters, date_to: event.currentTarget.value }; setFilters(next); setQuery(next); }} />
      </div>
      <Select className={own.smallSelect} data={PENDING_FORMS} value={filters.formcode} allowDeselect={false} aria-label="양식" comboboxProps={{ width: 150, position: 'bottom-start' }}
        onChange={(value) => { const next = { ...filters, formcode: value || '' }; setFilters(next); setQuery(next); }} />
      <TextInput className={ea.pendingSearch} placeholder="문서번호 · 제목 · 신청자 (Enter)" value={filters.q}
        onChange={(event) => { const value = event.currentTarget.value; setFilters((current) => ({ ...current, q: value })); }}
        onKeyDown={(event) => { if (event.key === 'Enter') setQuery({ ...filters }); }} />
      {loading && <Loader size={12} color="red" />}
      {data.blocked_total > 0 && <span className={ea.pendingAlert}>결재가 멈춘 문서 {data.blocked_total}건 · 빨간 이름을 누르면 바로 결재자를 바꿀 수 있습니다.</span>}
    </div>
    <div className={own.tableWrap} style={{ maxWidth: 1180 }}>
      <GridTable columns={PENDING_COLUMNS} className={own.table}>
          {rows.map((doc) => <tr key={doc.docno} className={doc.blocked ? ea.stuckRow : ''}>
            <td className={own.center}>{doc.blocked ? <span className={`${own.pill} ${own.no}`} title={PENDING_HINT.blocked}>결재 멈춤</span>
              : doc.warn ? <span className={`${own.pill} ${own.wait}`} title={PENDING_HINT.warn}>멈춤 예정</span> : <span className={`${own.pill} ${own.muted}`}>정상</span>}</td>
            <td className={own.mono}>{doc.docno}</td>
            <td className={own.center}>{doc.formname.replace(/신청서$/, '').replace(/보고서$/, '보고')}</td>
            <td className={own.center}>{doc.writer_name}</td>
            <td className={own.ellipsis} title={doc.title}>{doc.title}</td>
            <td className={own.ellipsis}>
              {doc.steps.map((x, i) => <span key={x.step}>{i > 0 && <i className={ea.lineMiniSep}>›</i>}
                {x.problem
                  ? <button type="button" className={`${ea.lineMini} ${ea.lineMiniBad}`} title={`${x.step}차 ${x.name} · ${x.problem} — 눌러서 결재자 변경`} onClick={() => openChange(doc, x.step)}>{x.name}</button>
                  : <span className={`${ea.lineMini} ${x.status === 'APPROVED' ? ea.lineMiniOk : ''} ${x.step === doc.current_step ? ea.lineMiniNow : ''}`} title={`${x.step}차 ${x.name}`}>{x.name}</span>}
              </span>)}
            </td>
            <td className={`${own.mono} ${own.center}`}>{kstTime(doc.submitted_at)}</td>
            <td className={own.center}>
              <button type="button" className={`${ea.rowBtn} ${doc.blocked ? ea.rowBtnPrimary : ''}`} onClick={() => openChange(doc)}>변경</button>
            </td>
            <td className={own.center}>
              <button type="button" className={`${ea.rowBtn} ${ea.rowBtnDanger}`} onClick={() => setReject({ doc, reason: '' })}>반려</button>
            </td>
          </tr>)}
          {!rows.length && <tr><td colSpan={PENDING_COLUMNS.length} className={own.center} style={{ height: 110, color: '#9aa3af' }}>
            {searched ? '조건에 맞는 결재중 문서가 없습니다' : '결재중인 문서가 없습니다'}</td></tr>}
      </GridTable>
    </div>
    {data.total > PAGE_SIZE && <div className={own.pager} style={{ maxWidth: 1180 }}>
      <Pagination size="sm" color="red" total={Math.ceil(data.total / PAGE_SIZE)} value={page} onChange={(next) => load(next, query)} />
    </div>}

    {/* 결재자 변경 (매입등록 확인 창과 같은 모양) */}
    <Modal opened={Boolean(change)} onClose={() => { if (!busy) setChange(null); }} {...modalProps}>
      {changeDoc && <>
        <div className={ea.pmTop}>
          <span className={ea.pmIcon} aria-hidden="true"><IconUserCheck size={24} stroke={1.8} /></span>
          <h2>결재자를 바꿀까요?</h2>
          <span className={ea.pmTarget} title={changeDoc.title}>{changeDoc.docno}</span>
          <p>{changeDoc.title}</p>
        </div>
        <div className={ea.pmBody}>
          <div className={ea.pmLabel}>바꿀 단계</div>
          <div className={ea.pmSteps} role="radiogroup" aria-label="바꿀 단계">
            {changeDoc.steps.map((x) => {
              const done = x.status !== 'WAIT';
              return <button key={x.step} type="button" role="radio" aria-checked={change.step === x.step} disabled={done}
                className={`${ea.pmStep} ${change.step === x.step ? ea.pmStepOn : ''} ${x.problem ? ea.pmStepBad : ''}`}
                onClick={() => setChange((c) => ({ ...c, step: x.step, approver: null }))}>
                <em>{x.step}차</em><b>{x.name}</b>
                <span>{done ? '승인' : x.problem || (x.step === changeDoc.current_step ? '결재 차례' : '대기')}</span>
              </button>;
            })}
          </div>
          <div className={ea.pmLabel}>새 결재자</div>
          <Select classNames={{ input: ea.pmSelectInput, option: ea.pmSelectOption }} data={approverOptions} value={change.approver} searchable placeholder="직원 이름으로 찾기" nothingFoundMessage="고를 수 있는 직원이 없습니다"
            comboboxProps={{ withinPortal: true, zIndex: 400 }} onChange={(value) => setChange((c) => ({ ...c, approver: value }))} />
          <p className={ea.pmHint}>이 문서에만 적용되며 양식의 기본 결재선은 그대로입니다.</p>
        </div>
        <div className={ea.pmActions}>
          <button type="button" className={ea.pmCancel} onClick={() => setChange(null)} disabled={busy}>취소</button>
          <button type="button" className={ea.pmConfirm} onClick={saveChange} disabled={busy || !change.step || !change.approver}>
            {busy && <span className={ea.pmSpinner} aria-hidden="true" />}변경
          </button>
        </div>
      </>}
    </Modal>

    {/* 관리자 반려 */}
    <Modal opened={Boolean(reject)} onClose={() => { if (!busy) setReject(null); }} {...modalProps}>
      {reject && <>
        <div className={ea.pmTop}>
          <span className={ea.pmIcon} aria-hidden="true"><IconBan size={24} stroke={1.8} /></span>
          <h2>문서를 반려할까요?</h2>
          <span className={ea.pmTarget} title={reject.doc.title}>{reject.doc.docno}</span>
          <p>결재가 종료되며, 신청자는 신청내역에서<br />다시 작성할 수 있습니다.</p>
        </div>
        <div className={ea.pmBody}>
          <div className={ea.pmLabel}>반려 사유 <i>*</i></div>
          <Textarea autosize minRows={3} maxRows={6} maxLength={400} data-autofocus value={reject.reason} placeholder="예: 결재자 퇴사로 결재를 진행할 수 없습니다. 다시 신청해 주세요."
            onChange={(event) => { const value = event.currentTarget.value; setReject((r) => ({ ...r, reason: value })); }} />
        </div>
        <div className={ea.pmActions}>
          <button type="button" className={ea.pmCancel} onClick={() => setReject(null)} disabled={busy}>취소</button>
          <button type="button" className={ea.pmConfirm} onClick={saveReject} disabled={busy || !reject.reason.trim()}>
            {busy && <span className={ea.pmSpinner} aria-hidden="true" />}반려
          </button>
        </div>
      </>}
    </Modal>
  </section>;
}

export default function EApprovalForm() {
  const [tab, setTab] = useState('forms');
  const [pendingKey, setPendingKey] = useState(0);
  const [year, setYear] = useState(THIS_YEAR);
  const [data, setData] = useState(null);
  const [saving, setSaving] = useState(false);
  const load = useCallback(async (targetYear) => {
    try {
      const { data: result } = await axios.get('/api/eapproval/admin', { ...authConfig(), params: { year: targetYear } });
      setData(result);
    } catch (error) {
      notifications.show({ title: '설정 조회 실패', message: errorText(error), color: 'red' });
    }
  }, []);
  const runLoad = useEffectEvent((y) => { void load(y); });
  useEffect(() => { runLoad(year); }, [year]);
  usePageReactivated(() => { void load(year); });

  const save = useCallback(async () => {
    if (!data || saving || tab === 'pending') return;
    setSaving(true);
    try {
      const body = tab === 'forms'
        ? { forms: data.forms.map((f) => ({ formcode: f.formcode, useyn: f.useyn, line: f.line })) }
        : tab === 'times' ? { times: data.leave_times }
          : { year, leaves: data.users.map((u) => ({ email: u.email, granted: u.granted ?? '' })) };
      const { data: result } = await axios.put('/api/eapproval/admin', body, authConfig());
      setData(result);
      notifications.show({ title: '저장 완료', message: { forms: '양식 · 결재선을 저장했습니다.', times: '휴가 시간대를 저장했습니다.' }[tab] || `${year}년 연차를 저장했습니다.`, color: 'teal' });
    } catch (error) {
      notifications.show({ title: '저장할 수 없습니다', message: errorText(error), color: 'red' });
    } finally { setSaving(false); }
  }, [data, saving, tab, year]);
  const saveRef = useRef(save);
  useEffect(() => { saveRef.current = save; }, [save]);
  useErpPageRibbon({ onSearch: () => { void load(year); setPendingKey((v) => v + 1); }, onSave: () => saveRef.current?.(), showPrint: false });

  const setSlots = (kind, slots) => setData((current) => ({ ...current, leave_times: { ...current.leave_times, [kind]: slots } }));
  const timeSelect = (value, onChange, label) => <Select size="xs" className={ea.timeInput} data={TIME_OPTIONS} value={value} allowDeselect={false} searchable aria-label={label}
    withCheckIcon={false} rightSection={<span />} rightSectionWidth={4} comboboxProps={{ width: 96 }} maxDropdownHeight={220}
    onChange={(next) => { if (next) onChange(next); }} />;
  const setForm = (code, patch) => setData((current) => ({ ...current, forms: current.forms.map((f) => (f.formcode === code ? { ...f, ...patch } : f)) }));
  const nameOf = (email) => data?.users.find((u) => u.email === email);
  const userOptions = (exclude) => (data?.users || []).filter((u) => !exclude.includes(u.email))
    .map((u) => ({ value: u.email, label: `${u.username}${u.team ? ` · ${u.team}` : ''}${u.position ? ` ${u.position}` : ''}` }));

  return <Box className={`${sharedClasses.pageShell} ${classes.page} ${simpleTheme.simple} ${own.page}`}>
    <Box component="nav" aria-label="현재 위치" className={classes.pageBreadcrumb}>
      <Group className={classes.breadcrumbTrail} gap={7}>
        <Text component="span" className={classes.breadcrumbParent}>전자결재</Text>
        <Text component="span" className={classes.breadcrumbChevron}>›</Text>
        <Text component="span" className={classes.breadcrumbCurrent}>결재양식관리</Text>
      </Group>
    </Box>
    <div className={own.tabs} role="tablist">
      {[['forms', '양식 · 결재선'], ['times', '휴가 시간'], ['leave', '연차 관리'], ['pending', '진행 문서']].map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={tab === key}
        className={`${own.tab} ${tab === key ? own.tabOn : ''}`} onClick={() => setTab(key)}>{label}</button>)}
    </div>
    <div className={own.body}>
      {!data ? <div className={own.empty}><Loader size="sm" color="red" /></div> : <Paper className={`${sharedClasses.panel} ${own.sheet}`} withBorder>
        {tab === 'pending' ? <PendingTab reloadKey={pendingKey} /> : tab === 'forms' ? <section className={own.block}>
          <div className={own.blockHead}><h3>양식 · 결재선</h3></div>
          <div className={ea.gridScroll}><GridTable columns={FORM_COLUMNS} className={own.ruleTable}>
              {data.forms.map((form) => <tr key={form.formcode}>
                <th scope="row">{form.formname}</th>
                <td><Switch color="red" size="sm" checked={form.useyn} className={own.switch} withThumbIndicator={false}
                  onChange={(event) => setForm(form.formcode, { useyn: event.currentTarget.checked })} aria-label={`${form.formname} 사용`} /></td>
                <td>
                  <div className={ea.lineEditor} style={{ padding: '8px 0' }}>
                    {form.line.map((email, index) => <span key={email} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      {index > 0 && <span className={ea.lineArrow}>→</span>}
                      <span className={ea.lineChip}><em>{index + 1}차</em>{nameOf(email)?.username || email}
                        <button type="button" aria-label="결재자 빼기" onClick={() => setForm(form.formcode, { line: form.line.filter((e) => e !== email) })}>×</button>
                      </span>
                    </span>)}
                    <Select className={ea.addSelect} size="xs" placeholder={form.line.length ? '+ 결재자 추가' : '+ 1차 결재자'} searchable value={null}
                      data={userOptions(form.line)} onChange={(value) => { if (value) setForm(form.formcode, { line: [...form.line, value] }); }} />
                  </div>
                </td>
              </tr>)}
          </GridTable></div>
          <div className={own.blockHead}><span>신청하면 이 결재선이 문서에 그대로 복사되어 1차부터 차례로 결재됩니다. 저장은 위 [저장]</span></div>
        </section> : tab === 'times' ? <section className={own.block}>
          <div className={own.blockHead}><h3>휴가 시간</h3><span>반차 · 반반차를 신청할 때 쓰는 시간대입니다. 바꾼 시간대는 이후 신청부터 적용됩니다.</span></div>
          <div className={ea.timeBoard}>
            {TIME_ROWS.map(([kind, label, deduct]) => {
              const slots = data.leave_times?.[kind] || [];
              const multi = kind === 'QUARTER';
              const clash = overlaps(slots);
              return <div key={kind} className={ea.timeRow}>
                <div className={ea.timeKind}><b>{label}</b><span>{deduct} 차감</span></div>
                <div className={ea.timeSlots}>
                  {slots.map((slot, index) => {
                    const reversed = toMin(slot.from) >= toMin(slot.to);
                    const bad = reversed || clash.has(index);
                    return <div key={`${kind}-${index}`} className={`${ea.timeSlot} ${bad ? ea.timeSlotBad : ''}`}>
                      {multi && <span className={ea.timeNo}>{index + 1}</span>}
                      {timeSelect(slot.from, (from) => setSlots(kind, slots.map((x, i) => (i === index ? { ...x, from } : x))), `${label} 시작`)}
                      <span className={ea.timeTilde}>~</span>
                      {timeSelect(slot.to, (to) => setSlots(kind, slots.map((x, i) => (i === index ? { ...x, to } : x))), `${label} 종료`)}
                      <span className={ea.timeLen}>{reversed ? '시간 확인' : clash.has(index) ? '겹침' : duration(slot)}</span>
                      {multi && slots.length > 1 && <button type="button" className={ea.timeRemove} aria-label={`${index + 1}번 시간대 빼기`}
                        onClick={() => setSlots(kind, slots.filter((_, i) => i !== index))}>×</button>}
                    </div>;
                  })}
                  {multi && slots.length < 8 && <button type="button" className={ea.timeAdd} onClick={() => setSlots(kind, [...slots, nextSlot(slots)])}>+ 시간대 추가</button>}
                </div>
                <TimeBar slots={slots} kind={kind} />
              </div>;
            })}
          </div>
          <div className={own.blockHead}><span>저장은 위 [저장]</span></div>
        </section> : <section className={own.block}>
          <div className={own.blockHead}><h3>연차 관리</h3>
            <Select size="xs" style={{ width: 110 }} value={String(year)} allowDeselect={false}
              data={[THIS_YEAR - 1, THIS_YEAR, THIS_YEAR + 1].map((y) => ({ value: String(y), label: `${y}년` }))} onChange={(value) => setYear(Number(value))} />
          </div>
          <div className={own.tableWrap} style={{ maxWidth: 1080 }}>
            <GridTable columns={LEAVE_COLUMNS} className={own.table}>
                {data.users.map((u) => <tr key={u.email}>
                  <td><b>{u.username}</b></td>
                  <td className={own.ellipsis}>{[u.team, u.position].filter(Boolean).join(' · ')}</td>
                  <td className={`${own.mono} ${own.center}`}>{u.hiredate ? String(u.hiredate).slice(0, 10) : ''}</td>
                  <td className={own.num}>
                    <NumberInput className={ea.leaveInput} value={u.granted ?? ''} min={0} max={99} step={0.5} decimalScale={1} hideControls placeholder="미등록"
                      onChange={(value) => setData((current) => ({ ...current, users: current.users.map((x) => (x.email === u.email ? { ...x, granted: value === '' ? null : Number(value) } : x)) }))} />
                  </td>
                  <td className={own.num}>{num(u.used)}</td>
                  <td className={own.num}>{num(u.pending)}</td>
                  <td className={own.num}><b>{u.granted === null || u.granted === undefined ? '-' : num(Math.max(u.granted - u.used - u.pending, 0))}</b></td>
                </tr>)}
            </GridTable>
          </div>
          <div className={own.blockHead}><span>사용 · 결재중은 휴가신청서(연차 · 반차)로 자동 계산됩니다. 저장은 위 [저장]</span></div>
        </section>}
      </Paper>}
    </div>
  </Box>;
}
