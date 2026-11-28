// 전자결재 (메뉴: EAPPROVAL) — 신규작성 · 임시저장함 · 신청내역 · 결재함
// 양식(휴가신청서 · 출장신청서 · 업무보고서)을 작성해 신청하면 양식별 기본 결재선(결재양식관리에서 고정)대로 1차 → 2차 … 승인.
// 서버: backend/services/eapproval/EApproval.py
import { Fragment, memo, useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react';
import axios from 'axios';
import { useLocation } from 'react-router-dom';
import { Box, Group, Loader, Pagination, Paper, Select, Text, TextInput, Textarea } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import ErpDateInput from '../../components/common/ErpDateInput';
import { ColumnResizeHandle, pickerClasses, useResizableColumns } from '../../components/common/PickerModal';
import ConfirmDeleteModal from '../../components/common/ConfirmDeleteModal';
import useErpPageRibbon from '../../components/common/useErpPageRibbon';
import usePageReactivated from '../../components/common/usePageReactivated';
import sharedClasses from '../../styles/pages/ManagementShared.module.css';
import simpleTheme from '../../styles/pages/SimpleTheme.module.css';
import classes from '../../styles/pages/InboundRegister.module.css';
import own from '../../styles/pages/ControlManagement.module.css';
import ea from '../../styles/pages/EApproval.module.css';
import { apiErrorMessage } from '../../utils/apiError';

const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });
const errorText = (error, fallback = '처리하지 못했습니다.') => apiErrorMessage(error, fallback);
const KST_FORMAT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const kst = (value) => {
  if (!value) return '';
  const p = Object.fromEntries(KST_FORMAT.formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
};
const today = () => kst(new Date()).slice(0, 10);
const thisMonth = () => {
  const t = today();
  const [y, m] = t.split('-').map(Number);
  return { date_from: `${t.slice(0, 8)}01`, date_to: `${t.slice(0, 8)}${String(new Date(y, m, 0).getDate()).padStart(2, '0')}` };
};
const num = (value) => (value === null || value === undefined || value === '' ? '' : Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 2 }));
const STATUS_CLASS = { DRAFT: own.muted, PENDING: own.wait, APPROVED: own.ok, REJECTED: own.no };
const StatusPill = ({ status, label }) => <span className={`${own.pill} ${STATUS_CLASS[status] || own.muted}`}>{label}</span>;
const FORM_OPTIONS = [{ value: '', label: '전체 양식' }, { value: 'LEAVE', label: '휴가신청서' }, { value: 'TRIP', label: '출장신청서' }, { value: 'REPORT', label: '업무보고서' }];
// 필터 드롭다운: 입력칸보다 좁아지지 않고 글자가 한 줄에 들어가게
const FILTER_DROPDOWN = { width: 150, position: 'bottom-start' };
const STATUS_OPTIONS = [{ value: '', label: '전체 상태' }, { value: 'PENDING', label: '결재중' }, { value: 'APPROVED', label: '완료' }, { value: 'REJECTED', label: '반려' }];
// 하루 안에서 시간으로 쓰는 휴가 (반차 0.5일 · 반반차 0.25일)
const PART_DAYS = { HALF_AM: 0.5, HALF_PM: 0.5, QUARTER: 0.25 };
const isPart = (kind) => kind in PART_DAYS;
const DEDUCT = ['ANNUAL', 'HALF_AM', 'HALF_PM', 'QUARTER'];
const slotLabel = (slot) => `${slot.from} ~ ${slot.to}`;

// 휴가 일수 미리보기 (서버와 같은 규칙: 반차 0.5일 · 반반차 0.25일 (평일), 그 밖은 평일 수)
const leaveDays = (kind, from, to) => {
  if (!from) return 0;
  if (isPart(kind)) { const day = new Date(`${from}T00:00:00`).getDay(); return day === 0 || day === 6 ? 0 : PART_DAYS[kind]; }
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${(to || from)}T00:00:00`);
  if (end < start) return 0;
  let days = 0;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) if (d.getDay() !== 0 && d.getDay() !== 6) days += 1;
  return days;
};
const emptyContent = (formcode) => ({
  LEAVE: { kind: 'ANNUAL', date_from: today(), date_to: today(), reason: '' },
  TRIP: { title: '', destination: '', date_from: today(), date_to: today(), purpose: '', companions: '', cost: '', memo: '' },
  REPORT: { title: '', report_type: 'WEEKLY', date_from: today(), date_to: today(), done: '', plan: '', issue: '' },
}[formcode] || {});

// ── 결재 흐름 (신청 → 1차 → 2차 …) : 제목 아래 한 줄, 결재자가 많으면 다음 줄로 ──
const STEP_TONE = { done: ea.flowDone, ok: ea.flowOk, now: ea.flowNow, wait: ea.flowWait, no: ea.flowNo, draft: ea.flowWait };
const shortTime = (value) => (value ? kst(value).slice(5, 16) : '');
function StampGrid({ writer = {}, steps = [], currentStep, status, submittedAt }) {
  // 줄이 바뀐 첫 카드 앞의 화살표는 숨긴다
  const flowRef = useRef(null);
  useLayoutEffect(() => {
    const list = flowRef.current;
    if (!list) return undefined;
    const mark = () => {
      let top = null;
      for (const item of list.children) {
        item.dataset.rowStart = top !== null && item.offsetTop > top + 4 ? 'y' : '';
        top = item.offsetTop;
      }
    };
    mark();
    const observer = new ResizeObserver(mark);
    observer.observe(list);
    return () => observer.disconnect();
  }, [steps.length]);
  const cards = [{
    key: 'writer', role: '신청', name: writer.name, sub: [writer.team, writer.position].filter(Boolean).join(' · '),
    tone: status === 'DRAFT' ? 'draft' : 'done', label: status === 'DRAFT' ? '작성 중' : '신청', time: status === 'DRAFT' ? '' : shortTime(submittedAt),
  }, ...steps.map((s) => {
    const tone = s.status === 'APPROVED' ? 'ok' : s.status === 'REJECTED' ? 'no' : status === 'PENDING' && s.step === currentStep ? 'now' : 'wait';
    return {
      key: s.step, role: `${s.step}차`, name: s.name, sub: [s.team, s.position].filter(Boolean).join(' · '), tone,
      label: { ok: '승인', no: '반려', now: '진행중', wait: '대기' }[tone], time: tone === 'ok' || tone === 'no' ? shortTime(s.acted_at) : '',
    };
  })];
  return <ol ref={flowRef} className={ea.flow} aria-label="결재선">
    {cards.map((c, index) => <li key={c.key} className={`${ea.flowStep} ${STEP_TONE[c.tone]}`}
      title={[c.role, c.name, c.sub, c.label, c.time].filter(Boolean).join(' · ')}>
      {index > 0 && <span className={ea.flowLink} aria-hidden="true" />}
      <span className={ea.flowDot} aria-hidden="true">{{ done: '✓', ok: '✓', no: '✕' }[c.tone] || ''}</span>
      <span className={ea.flowRole}>{c.role}</span>
      <span className={ea.flowName}>{c.name || '-'}</span>
      <span className={ea.flowState}>{c.time || c.label}</span>
    </li>)}
  </ol>;
}

// ── 연차 현황 ───────────────────────────────────────────────────────
function LeaveBox({ leave, requestDays }) {
  if (!leave) return null;
  const after = leave.granted - leave.used - leave.pending - requestDays;
  return <div>
    <span className={ea.label}>연차 현황 ({leave.year}년)</span>
    <table className={ea.leaveTable}>
      <thead><tr><th>발생</th><th>사용</th><th>결재중</th><th>잔여</th><th>신청 후 잔여</th></tr></thead>
      <tbody><tr>
        <td>{num(leave.granted)}</td><td>{num(leave.used)}</td><td>{num(leave.pending)}</td><td>{num(leave.remain)}</td>
        <td className={after < 0 ? ea.over : ea.after}>{num(after)}{after < 0 ? ' (초과)' : ''}</td>
      </tr></tbody>
    </table>
    {!leave.registered && <div className={ea.hint}>올해 연차 발생 일수가 아직 등록되지 않았습니다. (결재양식관리 › 연차 관리)</div>}
  </div>;
}

// ── 양식 입력 칸 ────────────────────────────────────────────────────
function DocFields({ formcode, content, set, setup }) {
  const kinds = Object.entries(setup?.leave_kinds || {}).map(([value, label]) => ({ value, label }));
  const types = Object.entries(setup?.report_types || {}).map(([value, label]) => ({ value, label: `${label} 보고` }));
  const period = (label, required = true) => <div className={ea.full}>
    <span className={ea.label}>{label} {required && <i>*</i>}</span>
    <div className={ea.period}>
      <ErpDateInput value={content.date_from || ''} onChange={(event) => set({ date_from: event.currentTarget.value, ...(isPart(content.kind) ? { date_to: event.currentTarget.value } : {}) })} />
      <span>~</span>
      <ErpDateInput value={content.date_to || ''} onChange={(event) => set({ date_to: event.currentTarget.value })} />
    </div>
  </div>;
  if (formcode === 'LEAVE') {
    const days = leaveDays(content.kind, content.date_from, content.date_to);
    const part = isPart(content.kind);
    const slots = setup?.leave_times?.[content.kind] || [];
    const slotValue = part && content.time_from ? `${content.time_from}-${content.time_to}` : null;
    // 종류를 바꾸면: 시간 휴가는 하루 + 첫 시간대, 그 밖은 시간 지움
    const pickKind = (value) => {
      if (isPart(value)) {
        const first = (setup?.leave_times?.[value] || [])[0];
        set({ kind: value, date_to: content.date_from, time_from: first?.from || '', time_to: first?.to || '' });
      } else set({ kind: value, time_from: undefined, time_to: undefined });
    };
    return <>
      <div><span className={ea.label}>대상자</span><div className={ea.static}>{setup?.me?.name}{setup?.me?.team ? ` · ${setup.me.team}` : ''}</div></div>
      <div><span className={ea.label}>휴가 종류 <i>*</i></span>
        <Select className={ea.input} data={kinds} value={content.kind} allowDeselect={false} onChange={pickKind} /></div>
      {part ? <>
        <div><span className={ea.label}>신청일 <i>*</i></span>
          <ErpDateInput value={content.date_from || ''} onChange={(event) => set({ date_from: event.currentTarget.value, date_to: event.currentTarget.value })} /></div>
        <div><span className={ea.label}>시간 <i>*</i></span>
          <Select className={ea.input} data={slots.map((slot) => ({ value: `${slot.from}-${slot.to}`, label: slotLabel(slot) }))} value={slotValue} allowDeselect={false}
            disabled={content.kind !== 'QUARTER'} placeholder="시간대 선택"
            onChange={(value) => { const [from, to] = String(value || '').split('-'); set({ time_from: from, time_to: to }); }} /></div>
      </> : period('신청기간')}
      <div className={`${ea.full} ${ea.hint}`} style={{ marginTop: -8 }}>신청일수 <b>{num(days)}일</b>{part ? ` (${setup?.leave_kinds?.[content.kind]}${content.time_from ? ` ${content.time_from} ~ ${content.time_to}` : ''})` : ' (주말 제외)'}</div>
      <div className={ea.full}><span className={ea.label}>신청사유 <i>*</i></span>
        <Textarea className={ea.input} autosize minRows={3} maxRows={8} maxLength={2000} value={content.reason || ''} onChange={(event) => set({ reason: event.currentTarget.value })} /></div>
      {DEDUCT.includes(content.kind) && <div className={ea.full}><LeaveBox leave={setup?.leave} requestDays={days} /></div>}
    </>;
  }
  if (formcode === 'TRIP') {
    return <>
      <div className={ea.full}><span className={ea.label}>제목 <i>*</i></span><TextInput className={ea.input} maxLength={100} value={content.title || ''} onChange={(event) => set({ title: event.currentTarget.value })} /></div>
      <div><span className={ea.label}>출장지 <i>*</i></span><TextInput className={ea.input} maxLength={200} value={content.destination || ''} onChange={(event) => set({ destination: event.currentTarget.value })} /></div>
      <div><span className={ea.label}>동행자</span><TextInput className={ea.input} maxLength={200} value={content.companions || ''} onChange={(event) => set({ companions: event.currentTarget.value })} /></div>
      {period('출장기간')}
      <div className={ea.full}><span className={ea.label}>출장목적 <i>*</i></span>
        <Textarea className={ea.input} autosize minRows={3} maxRows={8} maxLength={2000} value={content.purpose || ''} onChange={(event) => set({ purpose: event.currentTarget.value })} /></div>
      <div><span className={ea.label}>예상 경비 (원)</span>
        <TextInput className={ea.input} inputMode="numeric" value={content.cost ? Number(String(content.cost).replace(/,/g, '')).toLocaleString('ko-KR') : ''}
          onChange={(event) => set({ cost: event.currentTarget.value.replace(/[^0-9]/g, '') })} /></div>
      <div><span className={ea.label}>비고</span><TextInput className={ea.input} maxLength={500} value={content.memo || ''} onChange={(event) => set({ memo: event.currentTarget.value })} /></div>
    </>;
  }
  return <>
    <div className={ea.full}><span className={ea.label}>제목 <i>*</i></span><TextInput className={ea.input} maxLength={100} value={content.title || ''} onChange={(event) => set({ title: event.currentTarget.value })} /></div>
    <div><span className={ea.label}>보고 구분 <i>*</i></span><Select className={ea.input} data={types} value={content.report_type} allowDeselect={false} onChange={(value) => set({ report_type: value })} /></div>
    <div />
    {period('보고기간')}
    <div className={ea.full}><span className={ea.label}>업무 실적 <i>*</i></span>
      <Textarea className={ea.input} autosize minRows={4} maxRows={12} maxLength={4000} value={content.done || ''} onChange={(event) => set({ done: event.currentTarget.value })} /></div>
    <div className={ea.full}><span className={ea.label}>업무 계획</span>
      <Textarea className={ea.input} autosize minRows={3} maxRows={10} maxLength={4000} value={content.plan || ''} onChange={(event) => set({ plan: event.currentTarget.value })} /></div>
    <div className={ea.full}><span className={ea.label}>이슈 · 건의</span>
      <Textarea className={ea.input} autosize minRows={2} maxRows={8} maxLength={2000} value={content.issue || ''} onChange={(event) => set({ issue: event.currentTarget.value })} /></div>
  </>;
}

// 읽기 화면: 양식 내용을 항목 · 값으로
const readRows = (doc, setup) => {
  const c = doc.content || {};
  const period = c.date_from ? `${c.date_from}${c.date_to && c.date_to !== c.date_from ? ` ~ ${c.date_to}` : ''}` : '';
  if (doc.formcode === 'LEAVE') return [['휴가 종류', setup?.leave_kinds?.[c.kind] || c.kind], ['신청기간', `${period}${c.time_from ? ` ${c.time_from} ~ ${c.time_to}` : ''}`], ['신청일수', `${num(c.days)}일`], ['신청사유', c.reason]];
  if (doc.formcode === 'TRIP') return [['제목', c.title || doc.title], ['출장지', c.destination], ['출장기간', `${period}${c.days ? ` (${c.days}일)` : ''}`], ['출장목적', c.purpose], ['동행자', c.companions],
    ['예상 경비', c.cost ? `${Number(c.cost).toLocaleString('ko-KR')}원` : ''], ['비고', c.memo]];
  return [['제목', c.title || doc.title], ['보고 구분', `${setup?.report_types?.[c.report_type] || c.report_type} 보고`], ['보고기간', period], ['업무 실적', c.done], ['업무 계획', c.plan], ['이슈 · 건의', c.issue]];
};

// ── 신규작성 (임시저장 문서 고치기 포함) ───────────────────────────────
function WriteTab({ setup, draft, onSaved, onBack }) {
  const forms = setup?.forms || [];
  const [formcode, setFormcode] = useState(draft?.formcode || forms[0]?.formcode || 'LEAVE');
  const [content, setContent] = useState(() => ({ ...emptyContent(draft?.formcode || forms[0]?.formcode || 'LEAVE'), ...(draft?.content || {}) }));
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const docno = draft?.docno || null;
  const form = forms.find((item) => item.formcode === formcode);
  const set = useCallback((patch) => setContent((current) => ({ ...current, ...patch })), []);
  const pick = (code) => { if (code === formcode) return; setFormcode(code); setContent(emptyContent(code)); };

  const send = async (kind) => {
    setBusy(true);
    try {
      const { data } = await axios.post(`/api/eapproval/docs/${kind}`, { formcode, content, docno }, authConfig());
      notifications.show({ title: kind === 'submit' ? '신청했습니다' : '임시저장했습니다', message: data.docno, color: 'teal' });
      window.dispatchEvent(new Event('eapproval-changed'));
      onSaved?.(kind, data.docno);
    } catch (error) {
      notifications.show({ title: kind === 'submit' ? '신청할 수 없습니다' : '임시저장 실패', message: errorText(error), color: 'red' });
    } finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await axios.delete(`/api/eapproval/docs/${encodeURIComponent(docno)}`, authConfig());
      setDeleteOpen(false);
      notifications.show({ title: '삭제했습니다', message: docno, color: 'teal' });
      onSaved?.('delete', docno);
    } catch (error) {
      notifications.show({ title: '삭제 실패', message: errorText(error), color: 'red' });
    } finally { setBusy(false); }
  };

  if (!forms.length) return <Paper className={ea.sheetPanel} withBorder><div className={ea.empty}>사용할 수 있는 양식이 없습니다. 관리자에게 결재양식관리에서 양식 사용과 결재선 지정을 요청해 주세요.</div></Paper>;
  return <div className={ea.writeWrap}>
    <Paper className={ea.sheetPanel} withBorder>
      {onBack && <button type="button" className={ea.backLink} onClick={onBack}>‹ 임시저장함 목록</button>}
      {!docno && <div className={ea.formPicker} role="tablist">
        {forms.map((item) => <button key={item.formcode} type="button" className={`${ea.formChip} ${item.formcode === formcode ? ea.formChipOn : ''}`} onClick={() => pick(item.formcode)}>{item.formname}</button>)}
      </div>}
      <div className={ea.docHead}>
        <div>
          <h2 className={ea.docTitle}>{form?.formname || ''}</h2>
          <div className={ea.docMeta}>{docno ? `${docno} · 임시저장` : '새 문서'} · {setup?.me?.name}</div>
        </div>
      </div>
      <div className={ea.fieldGrid}><DocFields formcode={formcode} content={content} set={set} setup={setup} /></div>
    </Paper>
    <Paper className={ea.sidePanel} withBorder>
      <div className={ea.actionsRow}>
        <button type="button" className={ea.btnMain} disabled={busy || !(form?.line || []).length} onClick={() => send('submit')}>신청</button>
        <button type="button" className={ea.btnSub} disabled={busy} onClick={() => send('draft')}>임시저장</button>
      </div>
      {docno && <button type="button" className={ea.btnGhost} disabled={busy} onClick={() => setDeleteOpen(true)}>임시저장 문서 삭제</button>}
      <div>
        <div className={ea.sideTitle}>결재선</div>
        {(form?.line || []).length ? <div className={ea.lineList} style={{ marginTop: 8 }}>
          {form.line.map((s) => <div key={s.step} className={ea.lineItem}>
            <span className={ea.lineStep}>{s.step}</span>
            <div className={ea.lineWho}><b>{s.name}</b><span>{[s.team, s.position].filter(Boolean).join(' · ') || s.approver}</span></div>
          </div>)}
        </div> : <div className={ea.warn} style={{ marginTop: 8 }}>결재선이 지정되지 않아 신청할 수 없습니다. 관리자에게 요청해 주세요.</div>}
      </div>
      <div>
        <div className={ea.sideTitle}>신청 안내</div>
        <ul className={ea.guide} style={{ marginTop: 6 }}>
          <li>결재선은 회사에서 양식별로 지정한 순서에 따라 진행됩니다.</li>
          <li>결재가 시작되기 전이라면 신청내역에서 신청을 회수할 수 있습니다.</li>
          <li>결재자 중 한 명이라도 반려하면 결재가 종료됩니다.</li>
          {formcode === 'LEAVE' && <li>연차 · 반차(0.5일) · 반반차(0.25일)는 연차에서 차감됩니다. 주말은 제외됩니다.</li>}
        </ul>
      </div>
    </Paper>
    <ConfirmDeleteModal opened={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={remove} loading={busy}
      title="임시저장 문서를 삭제할까요?" target={docno} message="작성한 내용이 모두 삭제되며" note="삭제한 문서는 복구할 수 없습니다." />
  </div>;
}

// ── 문서 상세 (신청내역 · 결재함) ────────────────────────────────────
function DocDetail({ docno, setup, onChanged, onRewrite, onWithdrawn }) {
  const [doc, setDoc] = useState(null);
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const current = useRef(docno);
  current.current = docno;
  const load = useCallback(async () => {
    if (!docno) return;
    try {
      const { data } = await axios.get(`/api/eapproval/docs/${encodeURIComponent(docno)}`, authConfig());
      if (current.current === docno) setDoc(data);
    } catch (error) {
      notifications.show({ title: '문서 조회 실패', message: errorText(error), color: 'red' });
    }
  }, [docno]);
  const runLoad = useEffectEvent(() => { void load(); });
  useEffect(() => { setComment(''); setRejecting(false); runLoad(); }, [docno]);

  const act = async (kind) => {
    setBusy(true);
    try {
      const body = kind === 'withdraw' ? {} : { comment };
      await axios.post(`/api/eapproval/docs/${encodeURIComponent(docno)}/${kind}`, body, authConfig());
      notifications.show({ title: { approve: '승인했습니다', reject: '반려했습니다', withdraw: '회수했습니다. 임시저장함에서 수정할 수 있습니다.' }[kind], message: docno, color: 'teal' });
      window.dispatchEvent(new Event('eapproval-changed'));
      if (kind === 'withdraw' && onWithdrawn) { onWithdrawn(docno); return; }
      setComment(''); setRejecting(false);
      await load();
      onChanged?.();
    } catch (error) {
      notifications.show({ title: '처리할 수 없습니다', message: errorText(error), color: 'red', autoClose: 8000 });
    } finally { setBusy(false); }
  };

  if (!docno) return <div className={own.empty}>목록에서 문서를 선택하세요.</div>;
  const view = doc?.docno === docno ? doc : null;
  if (!view) return <div className={own.detail}><div className={own.loadingRow}><Loader size="xs" color="red" /></div></div>;
  return <div key={view.docno} className={`${own.detail} ${own.detailFade}`}>
    <div className={ea.docHead}>
      <div>
        <Group gap={8}><h2 className={ea.docTitle} style={{ fontSize: 19 }}>{view.formname}</h2><StatusPill status={view.status} label={view.status_label} /></Group>
        <div className={ea.docMeta}>{view.docno} · {view.writer_name}{view.writer_team ? ` (${view.writer_team})` : ''} · 신청 {kst(view.submitted_at) || '-'}</div>
      </div>
      <StampGrid writer={{ name: view.writer_name, team: view.writer_team }} steps={view.steps} currentStep={view.current_step} status={view.status} submittedAt={view.submitted_at} />
    </div>
    <div className={ea.readGrid}>
      {readRows(view, setup).map(([label, value]) => <Fragment key={label}><div>{label}</div><div>{value || '-'}</div></Fragment>)}
    </div>
    {/* 결재 의견 · 반려 사유만 따로 (신청자 본인 단계 자동 승인 문구는 빼고) */}
    {view.steps.filter((x) => x.comment && x.comment !== '신청자 본인 단계').map((x) => <div key={x.step} className={`${ea.opinion} ${x.status === 'REJECTED' ? ea.opinionNo : ''}`}>
      {/* 관리자 반려: "[관리자 반려 · 이름] 사유" */}
      {x.comment.startsWith('[관리자 반려') ? <><b>관리자 반려</b><span>{x.comment.slice(7, x.comment.indexOf(']')).replace(/^ · /, '')}</span><p>{x.comment.slice(x.comment.indexOf(']') + 1).trim()}</p></>
        : <><b>{x.status === 'REJECTED' ? '반려 사유' : '결재 의견'}</b><span>{x.step}차 {x.name}</span><p>{x.comment}</p></>}
    </div>)}
    {view.my_wait_step && <div className={ea.waitNote}>
      <b>{view.my_wait_step}차 결재 대기</b>
      <span>{(view.steps.find((x) => x.step === view.current_step) || {}).name || '앞 결재자'}님의 {view.current_step}차 결재가 끝난 뒤 결재할 수 있습니다.</span>
    </div>}
    {(view.can_approve || view.can_withdraw || view.status === 'REJECTED') && <div className={own.actions}>
      {view.can_approve && (rejecting ? <>
        <Textarea className={own.reasonInput} placeholder="반려 사유" autosize minRows={2} maxLength={500} data-autofocus value={comment} onChange={(event) => setComment(event.currentTarget.value)} />
        <Group gap={6} justify="flex-end">
          <button type="button" className={`${own.btn} ${own.gray}`} disabled={busy} onClick={() => setRejecting(false)}>닫기</button>
          <button type="button" className={`${own.btn} ${own.navy}`} disabled={busy || !comment.trim()} onClick={() => act('reject')}>반려</button>
        </Group>
      </> : <>
        <TextInput className={own.reasonInput} placeholder="의견 (선택)" maxLength={500} value={comment} onChange={(event) => setComment(event.currentTarget.value)} />
        <Group gap={6} justify="flex-end">
          <button type="button" className={`${own.btn} ${own.navy}`} disabled={busy} onClick={() => setRejecting(true)}>반려</button>
          <button type="button" className={`${own.btn} ${own.red}`} disabled={busy} onClick={() => act('approve')}>승인</button>
        </Group>
      </>)}
      {view.can_withdraw && <Group gap={6} justify="flex-end"><button type="button" className={`${own.btn} ${own.gray}`} disabled={busy} onClick={() => act('withdraw')}>회수</button></Group>}
      {view.status === 'REJECTED' && view.writer === localStorage.getItem('user_email') && <Group gap={6} justify="flex-end">
        <button type="button" className={`${own.btn} ${own.red}`} onClick={() => onRewrite?.(view)}>다시 작성</button>
      </Group>}
    </div>}
  </div>;
}

// ── 목록 (임시저장함 · 신청내역 · 결재함) ─────────────────────────────
// 목록 칸 (key · 이름 · 기본 너비 · 정렬) — 너비는 끌어서 바꾼다
const COL = {
  status: { key: 'status', label: '상태', width: 72, minWidth: 60, align: 'center' },
  turn: { key: 'turn', label: '내 결재', width: 80, minWidth: 64, align: 'center' },
  docno: { key: 'docno', label: '문서번호', width: 120, minWidth: 90 },
  form: { key: 'form', label: '양식', width: 76, minWidth: 60, align: 'center' },
  title: { key: 'title', label: '제목', width: 200, minWidth: 120 },
  progress: { key: 'progress', label: '결재 진행', width: 80, minWidth: 64, align: 'center' },
  writer: { key: 'writer', label: '신청자', width: 84, minWidth: 64, align: 'center' },
  saved: { key: 'saved', label: '저장일시', width: 136, minWidth: 100, align: 'center' },
  submitted: { key: 'submitted', label: '신청일시', width: 136, minWidth: 100, align: 'center' },
};
const COLUMN_DEFS = {
  drafts: [COL.docno, COL.form, COL.writer, COL.title, COL.saved],
  mine: [COL.status, COL.docno, COL.form, COL.writer, COL.title, COL.progress, COL.submitted],
  todo: [COL.turn, COL.docno, COL.form, COL.writer, COL.title, COL.progress, COL.submitted],
  done: [COL.status, COL.docno, COL.form, COL.writer, COL.title, COL.submitted],
};
const shortForm = (name) => String(name || '').replace(/신청서$|보고서$/, (m) => (m === '보고서' ? '보고' : ''));
const listTime = (value) => (value ? kst(value) : '');   // 2026-11-28 10:41
const DocRow = memo(function DocRow({ row, box, selected, onSelect }) {
  // 결재 진행: 진행중 · 지금 결재할 사람 / 완료 / 반려
  const progress = row.status === 'PENDING' ? '진행중' : row.status === 'APPROVED' ? '완료' : row.status === 'REJECTED' ? '반려' : '';
  return <tr className={`${own.clickRow} ${selected ? own.selected : ''}`} onClick={() => onSelect(row)} tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') onSelect(row); }}>
    {box === 'todo' && <td className={own.center}>{row.my_step === row.current_step
      ? <span className={`${own.pill} ${own.no}`}>내 차례</span>
      : <span className={`${own.pill} ${own.muted}`} title={`${row.my_step}차 · 앞 결재 대기`}>{row.my_step}차 대기</span>}</td>}
    {box !== 'drafts' && box !== 'todo' && <td className={own.center}><StatusPill status={row.status} label={row.status_label} /></td>}
    <td className={`${own.mono} ${own.ellipsis}`}>{row.docno}</td>
    <td className={own.center} title={row.formname}>{shortForm(row.formname)}</td>
    <td className={`${own.center} ${own.ellipsis}`}>{row.writer_name}</td>
    <td className={own.ellipsis} title={row.title}>{row.title || '(제목 없음)'}</td>
    {(box === 'mine' || box === 'todo') && <td className={own.center}>{row.status === 'DRAFT' ? '' : progress}</td>}
    <td className={`${own.mono} ${own.center}`}>{listTime(box === 'drafts' ? (row.updatedat || row.createdat) : row.submitted_at)}</td>
  </tr>;
});

function ListTab({ box: initialBox, setup, reloadKey, onOpenDraft, onRewrite, onWithdrawn, initialDoc }) {
  const [box, setBox] = useState(initialBox);
  const [filters, setFilters] = useState(() => ({ ...thisMonth(), status: '', formcode: '', q: '' }));
  const [query, setQuery] = useState(filters);
  const [result, setResult] = useState({ items: [], total: 0 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(initialDoc || null);
  const requestId = useRef(0);
  const load = useCallback(async (nextPage, nextQuery, nextBox) => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      const params = { box: nextBox, page: nextPage, page_size: 30, ...(nextBox === 'todo' ? { formcode: nextQuery.formcode, q: nextQuery.q } : nextQuery) };
      const { data } = await axios.get('/api/eapproval/docs', { ...authConfig(), params });
      if (id !== requestId.current) return;
      setResult(data); setPage(nextPage);
    } catch (error) {
      if (id === requestId.current) notifications.show({ title: '목록 조회 실패', message: errorText(error), color: 'red' });
    } finally { if (id === requestId.current) setLoading(false); }
  }, []);
  const runLoad = useEffectEvent((p, qy, b) => { void load(p, qy, b); });
  useEffect(() => { runLoad(1, query, box); }, [query, box, reloadKey]);
  const refresh = useEffectEvent(() => { void load(page, query, box); });
  usePageReactivated(() => { void load(page, query, box); });
  useEffect(() => {
    const onChanged = () => refresh();
    window.addEventListener('eapproval-changed', onChanged);
    return () => window.removeEventListener('eapproval-changed', onChanged);
  }, []);
  const select = useCallback((row) => { if (box === 'drafts') onOpenDraft?.(row.docno); else setSelected(row); }, [box, onOpenDraft]);
  // 머리글 오른쪽 끝을 끌어 칸 너비 조절 (두 번 누르면 원래대로)
  const columns = COLUMN_DEFS[box];
  const resizable = useResizableColumns(columns);

  return <div className={box === 'drafts' ? '' : own.split} style={box === 'drafts' ? { display: 'flex', flex: '1 1 0', minHeight: 0 } : undefined}>
    <Paper className={`${sharedClasses.panel} ${own.listPanel}`} withBorder style={box === 'drafts' ? { flex: 1 } : undefined}>
      <div className={own.filterRow}>
        {(initialBox === 'todo' || initialBox === 'done') && <div className={own.seg} role="radiogroup" aria-label="결재함 구분" style={{ marginRight: 4 }}>
          <button type="button" role="radio" aria-checked={box === 'todo'} className={box === 'todo' ? own.segOn : ''} onClick={() => { setBox('todo'); setSelected(null); }}>결재할 문서</button>
          <button type="button" role="radio" aria-checked={box === 'done'} className={box === 'done' ? own.segOn : ''} onClick={() => { setBox('done'); setSelected(null); }}>결재한 문서</button>
        </div>}
        {box !== 'todo' && <div className={own.period}>
          <ErpDateInput aria-label="시작일" value={filters.date_from} onChange={(event) => { const next = { ...filters, date_from: event.currentTarget.value }; setFilters(next); if (next.date_from) setQuery(next); }} />
          <span>~</span>
          <ErpDateInput aria-label="종료일" value={filters.date_to} onChange={(event) => { const next = { ...filters, date_to: event.currentTarget.value }; setFilters(next); if (next.date_to) setQuery(next); }} />
        </div>}
        {(box === 'mine' || box === 'done') && <Select className={own.smallSelect} data={STATUS_OPTIONS} value={filters.status} allowDeselect={false} aria-label="상태" comboboxProps={FILTER_DROPDOWN}
          onChange={(value) => { const next = { ...filters, status: value || '' }; setFilters(next); setQuery(next); }} />}
        <Select className={own.smallSelect} data={FORM_OPTIONS} value={filters.formcode} allowDeselect={false} aria-label="양식" comboboxProps={FILTER_DROPDOWN}
          onChange={(value) => { const next = { ...filters, formcode: value || '' }; setFilters(next); setQuery(next); }} />
        <TextInput className={own.search} placeholder="문서번호 · 제목 · 신청자 (Enter)" value={filters.q}
          onChange={(event) => { const value = event.currentTarget.value; setFilters((current) => ({ ...current, q: value })); }}
          onKeyDown={(event) => { if (event.key === 'Enter') setQuery({ ...filters }); }} />
        {loading && <Loader size={12} color="red" />}
      </div>
      <div className={own.listScroll}>
        <table className={own.table} style={{ width: `max(100%, ${resizable.tableWidth}px)` }}>
          <colgroup>{columns.map((column) => <col key={column.key} data-column-key={column.key} style={{ width: resizable.widthOf(column) }} />)}</colgroup>
          <thead><tr>{columns.map((column) => <th key={column.key} className={`${pickerClasses.resizableHead} ${column.align === 'center' ? own.center : ''}`}>
            {column.label}<ColumnResizeHandle column={column} columns={resizable} />
          </th>)}</tr></thead>
          <tbody>
            {result.items.map((row) => <DocRow key={row.docno} row={row} box={box} selected={selected?.docno === row.docno} onSelect={select} />)}
            {!result.items.length && <tr><td colSpan={columns.length} className={own.center} style={{ height: 120, color: '#9aa3af' }}>
              {loading ? '조회 중' : { drafts: '임시저장한 문서가 없습니다', mine: '신청한 문서가 없습니다', todo: '결재할 문서가 없습니다', done: '결재한 문서가 없습니다' }[box]}
            </td></tr>}
          </tbody>
        </table>
      </div>
      {result.total > 30 && <div className={own.pager}><Pagination size="sm" color="red" total={Math.ceil(result.total / 30)} value={page} onChange={(next) => load(next, query, box)} /></div>}
    </Paper>
    {box !== 'drafts' && <Paper className={`${sharedClasses.panel} ${own.detailPanel}`} withBorder>
      <DocDetail docno={selected?.docno} setup={setup} onRewrite={onRewrite} onWithdrawn={onWithdrawn} />   {/* 처리하면 'eapproval-changed' 로 목록도 새로고침 */}
    </Paper>}
  </div>;
}

export default function EApproval() {
  const location = useLocation();
  const [tab, setTab] = useState(() => new URLSearchParams(location.search).get('tab') || 'write');
  const [setup, setSetup] = useState(null);
  const [draft, setDraft] = useState(null);          // 신규작성에 채울 내용 (반려 문서 다시 작성)
  const [editDraft, setEditDraft] = useState(null);  // 임시저장함에서 고치는 문서
  const [writeKey, setWriteKey] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const loadSetup = useCallback(async () => {
    try {
      const { data } = await axios.get('/api/eapproval/forms', authConfig());
      setSetup(data);
    } catch (error) {
      notifications.show({ title: '전자결재를 불러오지 못했습니다', message: errorText(error), color: 'red' });
      setSetup({ forms: [] });
    }
  }, []);
  const runSetup = useEffectEvent(() => { void loadSetup(); });
  useEffect(() => { runSetup(); }, []);
  usePageReactivated(() => { void loadSetup(); });
  useErpPageRibbon({ onSearch: () => { setReloadKey((v) => v + 1); void loadSetup(); }, showPrint: false });

  const openWrite = (next) => { setDraft(next); setWriteKey((v) => v + 1); setTab('write'); };
  // 임시저장 문서는 임시저장함 탭 안에서 연다 (탭 이름 · 개수는 그대로)
  const openDraft = async (docno) => {
    try {
      const { data } = await axios.get(`/api/eapproval/docs/${encodeURIComponent(docno)}`, authConfig());
      setEditDraft({ docno: data.docno, formcode: data.formcode, content: data.content });
      setTab('drafts');
    } catch (error) {
      notifications.show({ title: '문서 조회 실패', message: errorText(error), color: 'red' });
    }
  };
  // 신규작성: 신청 → 신청내역, 임시저장 → 임시저장함
  const onSaved = (kind) => {
    void loadSetup();
    setDraft(null);
    setWriteKey((v) => v + 1);
    setTab(kind === 'submit' ? 'mine' : 'drafts');
  };
  // 임시저장함에서 고치던 문서: 신청 → 신청내역, 저장 · 삭제 → 임시저장함 목록
  const onDraftSaved = (kind) => {
    void loadSetup();
    setEditDraft(null);
    if (kind === 'submit') setTab('mine');
  };
  // 회수 → 임시저장함 목록으로 바로
  const onWithdrawn = () => { setEditDraft(null); setTab('drafts'); };
  const tabs = [{ key: 'write', label: '신규작성' }, { key: 'drafts', label: '임시저장함' }, { key: 'mine', label: '신청내역' }, { key: 'inbox', label: '결재함' }];
  const pickTab = (key) => {
    if (key === 'write' && tab !== 'write') { setDraft(null); setWriteKey((v) => v + 1); }
    if (key === 'drafts') setEditDraft(null);   // 임시저장함 탭을 누르면 목록
    setTab(key);
  };

  return <Box className={`${sharedClasses.pageShell} ${classes.page} ${simpleTheme.simple} ${own.page}`}>
    <Box component="nav" aria-label="현재 위치" className={classes.pageBreadcrumb}>
      <Group className={classes.breadcrumbTrail} gap={7}>
        <Text component="span" className={classes.breadcrumbParent}>전자결재</Text>
        <Text component="span" className={classes.breadcrumbChevron}>›</Text>
        <Text component="span" className={classes.breadcrumbCurrent}>{tabs.find((t) => t.key === tab)?.label}</Text>
        {tab === 'drafts' && editDraft && <><Text component="span" className={classes.breadcrumbChevron}>›</Text><Text component="span" className={classes.breadcrumbCurrent}>{editDraft.docno}</Text></>}
      </Group>
    </Box>
    <div className={own.tabs} role="tablist">
      {tabs.map((item) => <button key={item.key} type="button" role="tab" aria-selected={tab === item.key}
        className={`${own.tab} ${tab === item.key ? own.tabOn : ''}`} onClick={() => pickTab(item.key)}>
        {item.label}
      </button>)}
    </div>
    <div className={own.body}>
      {!setup ? <div className={own.empty}><Loader size="sm" color="red" /></div> : <>
        {tab === 'write' && <WriteTab key={writeKey} setup={setup} draft={draft} onSaved={onSaved} />}
        {tab === 'drafts' && (editDraft
          ? <WriteTab key={editDraft.docno} setup={setup} draft={editDraft} onSaved={onDraftSaved} onBack={() => setEditDraft(null)} />
          : <ListTab key="drafts" box="drafts" setup={setup} reloadKey={reloadKey} onOpenDraft={openDraft} />)}
        {tab === 'mine' && <ListTab key="mine" box="mine" setup={setup} reloadKey={reloadKey} onWithdrawn={onWithdrawn}
          onRewrite={(doc) => openWrite({ formcode: doc.formcode, content: doc.content })} />}
        {tab === 'inbox' && <ListTab key="inbox" box="todo" setup={setup} reloadKey={reloadKey} onWithdrawn={onWithdrawn} initialDoc={location.state?.doc || null} />}
      </>}
    </div>
  </Box>;
}
