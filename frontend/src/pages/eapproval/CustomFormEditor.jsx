// 결재설정 > 양식 추가 · 수정 창
//  왼쪽: 양식 이름 · 입력칸(번호 · 이름 · 종류 · 필수 · 순서/삭제, 선택 칸은 아래 줄에 보기) · (모스코만) HTML 서식(켜면 펼침)
//  오른쪽: 미리보기 (작성 화면 그대로) — 모든 회사
//  아래: [양식 삭제] ······ [취소] [저장]  (간결 디자인: 32px 입력칸 · 얇은 선 · 버튼 3색)
//  새 양식은 '사용 안 함'으로 만들어진다 → 결재선을 정하고 켠 뒤 위 [저장]
// 서버: backend/services/eapproval/EApproval.py (create_form · update_form · delete_form)
import { useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Modal } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import ConfirmDeleteModal from '../../components/common/ConfirmDeleteModal';
import { apiErrorMessage } from '../../utils/apiError';
import ea from '../../styles/pages/EApproval.module.css';
import { CustomFields, FIELD_TYPE_LABELS, unknownPlaceholders } from './CustomFormView';

const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });
const newField = () => ({ key: '', label: '', type: 'text', required: false, options: [] });
const SAMPLE = `<table style="width:100%; border-collapse:collapse" border="1" cellpadding="8">
  <tr><th style="width:120px; background:#f3f4f6">품목</th><td>{{품목}}</td></tr>
  <tr><th style="background:#f3f4f6">금액</th><td>{{금액}}</td></tr>
  <tr><th style="background:#f3f4f6">사유</th><td>{{사유}}</td></tr>
</table>`;

export default function CustomFormEditor({ form, canTemplate, onClose, onSaved }) {
  const editing = Boolean(form);
  const [name, setName] = useState(form?.formname || '');
  const [fields, setFields] = useState(() => (form?.fields?.length ? form.fields.map((f) => ({ ...newField(), ...f })) : [{ ...newField(), label: '제목', required: true }]));
  const [template, setTemplate] = useState(form?.template || '');
  const [useHtml, setUseHtml] = useState(Boolean(form?.template));
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [previewValues, setPreviewValues] = useState({});
  const templateRef = useRef(null);

  const setField = (index, patch) => setFields((list) => list.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  const move = (index, diff) => setFields((list) => {
    const target = index + diff;
    if (target < 0 || target >= list.length) return list;
    const next = [...list];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });
  const htmlOn = canTemplate && useHtml;
  // 미리보기: 아직 key 가 없는 새 칸은 임시 key 로
  const previewForm = useMemo(() => ({
    template: htmlOn ? template : '',
    fields: fields.filter((f) => f.label.trim()).map((f, i) => ({ ...f, key: f.key || `new${i}`, label: f.label.trim(), options: (f.options || []).filter(Boolean) })),
  }), [fields, htmlOn, template]);
  const unknown = htmlOn && template ? unknownPlaceholders(template, previewForm.fields) : [];

  const insertPlaceholder = (label) => {
    const el = templateRef.current;
    const text = `{{${label}}}`;
    const start = el?.selectionStart ?? template.length;
    const end = el?.selectionEnd ?? template.length;
    setTemplate((t) => t.slice(0, start) + text + t.slice(end));
    window.requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(start + text.length, start + text.length); });
  };

  const save = async () => {
    setBusy(true);
    try {
      const body = { formname: name.trim(), template: htmlOn ? template : '',
        fields: fields.filter((f) => f.label.trim()).map((f) => ({ key: f.key || undefined, label: f.label.trim(), type: f.type, required: f.required,
          options: f.type === 'select' ? (f.options || []).filter(Boolean) : undefined })) };
      const { data } = editing
        ? await axios.put(`/api/eapproval/admin/forms/${encodeURIComponent(form.formcode)}`, body, authConfig())
        : await axios.post('/api/eapproval/admin/forms', body, authConfig());
      notifications.show({ title: editing ? '양식 저장' : '양식 추가', color: 'teal',
        message: editing ? `${body.formname} 양식을 저장했습니다.` : `${body.formname} 양식을 추가했습니다. 결재선을 정하고 사용을 켠 뒤 [저장]하세요.` });
      if (data.problems?.length) notifications.show({ title: 'HTML 서식 확인', color: 'yellow', message: `입력칸에 없는 이름이 있습니다: ${data.problems.map((p) => `{{${p}}}`).join(', ')}` });
      onSaved(data.formcode);
    } catch (error) {
      notifications.show({ title: '저장할 수 없습니다', message: apiErrorMessage(error, '양식을 저장하지 못했습니다.'), color: 'red' });
    } finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await axios.delete(`/api/eapproval/admin/forms/${encodeURIComponent(form.formcode)}`, authConfig());
      notifications.show({ title: '양식 삭제', message: `${form.formname} 양식을 지웠습니다.`, color: 'teal' });
      setConfirmDelete(false);
      onSaved(null);
    } catch (error) {
      notifications.show({ title: '지울 수 없습니다', message: apiErrorMessage(error, '양식을 지우지 못했습니다.'), color: 'red' });
    } finally { setBusy(false); }
  };

  const canSave = name.trim() && fields.some((f) => f.label.trim());
  return <Modal opened onClose={() => { if (!busy) onClose(); }} yOffset="5vh" size={1040} radius={8} padding={0} withCloseButton={false}
    overlayProps={{ backgroundOpacity: 0.3 }} classNames={{ content: ea.feContent }}>
    <header className={ea.feHead}>
      <div><h2>{editing ? '양식 수정' : '양식 추가'}</h2><span>직원이 작성할 결재 양식을 만듭니다</span></div>
      <button type="button" className={ea.feClose} onClick={onClose} disabled={busy} aria-label="닫기">×</button>
    </header>

    <div className={ea.feBody}>
      {/* 왼쪽: 설정 */}
      <div className={ea.feMain}>
        <section className={ea.feSection}>
          <label className={ea.feLabel} htmlFor="fe-name">양식 이름 <i>*</i></label>
          <input id="fe-name" className={ea.feInput} value={name} maxLength={100} placeholder="예: 구매요청서" onChange={(e) => setName(e.currentTarget.value)} data-autofocus />
        </section>

        <section className={ea.feSection}>
          <div className={ea.feSectionHead}>
            <h3>입력칸 <em>{fields.length}</em></h3>
            {fields.length < 30 && <button type="button" className={ea.feTextBtn} onClick={() => setFields((list) => [...list, newField()])}>+ 칸 추가</button>}
          </div>
          <div className={ea.feList}>
            <div className={`${ea.feRow} ${ea.feRowHead}`}><span>#</span><span>이름</span><span>종류</span><span>필수</span><span /></div>
            {fields.map((field, index) => <div key={field.key || `n${index}`} className={ea.feItem}>
              <div className={ea.feRow}>
                <span className={ea.feNo}>{index + 1}</span>
                <input className={ea.feInput} value={field.label} maxLength={50} placeholder="칸 이름 (예: 금액)" aria-label={`${index + 1}번 칸 이름`}
                  onChange={(e) => setField(index, { label: e.currentTarget.value })} />
                <select className={ea.feInput} value={field.type} aria-label={`${index + 1}번 칸 종류`} onChange={(e) => setField(index, { type: e.currentTarget.value })}>
                  {Object.entries(FIELD_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                <label className={ea.feCheck}><input type="checkbox" checked={field.required} onChange={(e) => setField(index, { required: e.currentTarget.checked })} aria-label={`${index + 1}번 칸 필수`} /></label>
                <div className={ea.feTools}>
                  <button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label="위로">↑</button>
                  <button type="button" onClick={() => move(index, 1)} disabled={index === fields.length - 1} aria-label="아래로">↓</button>
                  <button type="button" className={ea.feRemove} onClick={() => setFields((list) => list.filter((_, i) => i !== index))} disabled={fields.length === 1} aria-label="칸 빼기">삭제</button>
                </div>
              </div>
              {field.type === 'select' && <div className={ea.feOptions}>
                <span>보기</span>
                <input className={ea.feInput} value={(field.options || []).join(', ')} placeholder="쉼표로 나눠 입력 (예: 소모품, 설비, 기타)" aria-label={`${index + 1}번 칸 보기`}
                  onChange={(e) => setField(index, { options: e.currentTarget.value.split(',').map((o) => o.trimStart()) })} />
              </div>}
            </div>)}
          </div>
        </section>

        {canTemplate && <section className={ea.feSection}>
          <div className={ea.feSectionHead}>
            <h3>HTML 서식 <small>모스코 전용</small></h3>
            <label className={ea.feSwitch}><input type="checkbox" checked={useHtml} onChange={(e) => setUseHtml(e.currentTarget.checked)} /><span>{useHtml ? '사용' : '사용 안 함'}</span></label>
          </div>
          {useHtml ? <>
            <div className={ea.feChips}>
              {previewForm.fields.map((f) => <button key={f.key} type="button" onClick={() => insertPlaceholder(f.label)} title="커서 위치에 넣기">{`{{${f.label}}}`}</button>)}
              {!template && <button type="button" className={ea.feSample} onClick={() => setTemplate(SAMPLE)}>예시 넣기</button>}
            </div>
            <textarea ref={templateRef} className={ea.feCode} rows={10} value={template} spellCheck={false}
              placeholder={'<table>\n  <tr><th>품목</th><td>{{품목}}</td></tr>\n</table>'} onChange={(e) => setTemplate(e.currentTarget.value)} />
            <p className={ea.feHint}>{'{{칸 이름}}'} 자리에 입력칸이 들어갑니다. 표 · 글자 · 색 · 테두리만 남고 스크립트 · 링크 · 이미지는 지워집니다.</p>
            {unknown.length > 0 && <p className={ea.feWarn}>입력칸에 없는 이름: {unknown.map((u) => `{{${u}}}`).join(', ')}</p>}
          </> : <p className={ea.feHint}>사용하지 않으면 입력칸이 &apos;이름 | 입력&apos; 모양으로 자동 배치됩니다.</p>}
        </section>}
      </div>

      {/* 오른쪽: 미리보기 */}
      <aside className={ea.fePreview}>
        <div className={ea.feSectionHead}><h3>미리보기</h3><span>직원 작성 화면</span></div>
        <div className={ea.fePaper}>
          <h4>{name.trim() || '양식 이름'}</h4>
          <div className={ea.fieldGrid}>
            {previewForm.fields.length ? <CustomFields form={previewForm} values={previewValues} setValue={(key, v) => setPreviewValues((cur) => ({ ...cur, [key]: v }))} />
              : <div className={ea.full}><p className={ea.feHint}>입력칸을 추가하면 여기에 보입니다.</p></div>}
          </div>
        </div>
      </aside>
    </div>

    <footer className={ea.feFoot}>
      {editing && <button type="button" className={ea.feDelete} onClick={() => setConfirmDelete(true)} disabled={busy || form.doc_count > 0}
        title={form.doc_count > 0 ? '이 양식으로 작성한 문서가 있어 지울 수 없습니다. 사용 여부로 끄세요.' : undefined}>양식 삭제</button>}
      <span className={ea.cfGap} />
      <button type="button" className={`${ea.feBtn} ${ea.feBtnGray}`} onClick={onClose} disabled={busy}>취소</button>
      <button type="button" className={`${ea.feBtn} ${ea.feBtnRed}`} onClick={save} disabled={busy || !canSave}>{editing ? '저장' : '추가'}</button>
    </footer>
    <ConfirmDeleteModal opened={confirmDelete} onClose={() => setConfirmDelete(false)} onConfirm={remove} loading={busy}
      title="양식을 지울까요?" target={form?.formname} message="결재선도 함께 지워지며" />
  </Modal>;
}
