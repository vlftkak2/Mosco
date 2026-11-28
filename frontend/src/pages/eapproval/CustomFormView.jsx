// 전자결재 추가 양식 그리기 (결재양식관리 > [양식 추가]로 만든 양식) — 작성 화면 입력칸 · 읽기 화면 값 · HTML 서식
//  입력칸 종류: text 글자 · textarea 긴글 · number 숫자 · money 금액 · date 날짜 · period 기간 · select 선택
//  HTML 서식(모스코만): 서버가 정리해 저장한 HTML 을 화면에서도 DOMPurify 로 한 번 더 정리하고,
//  {{입력칸 이름}} 자리에 작성 화면은 입력칸, 읽기 화면은 값(글자로)을 넣는다.
// 서버: backend/services/eapproval/CustomForm.py
import { useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import DOMPurify from 'dompurify';
import { Select, TextInput, Textarea } from '@mantine/core';
import ErpDateInput from '../../components/common/ErpDateInput';
import ea from '../../styles/pages/EApproval.module.css';

export const FIELD_TYPE_LABELS = { text: '글자', textarea: '긴글', number: '숫자', money: '금액', date: '날짜', period: '기간', select: '선택' };
const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g;

// 서버(CustomForm.py)와 같은 허용 목록
const PURIFY = {
  ALLOWED_TAGS: ['table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'colgroup', 'col', 'caption', 'div', 'span', 'p', 'br', 'hr', 'b', 'strong', 'i', 'em', 'u', 's',
    'small', 'sub', 'sup', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre'],
  ALLOWED_ATTR: ['style', 'align', 'title', 'colspan', 'rowspan', 'width', 'height', 'valign', 'span', 'border', 'cellpadding', 'cellspacing'],
  ALLOW_DATA_ATTR: false,
};
// 허용한 것만 남기고, 스타일 안의 url(…) · expression(…) 도 막는다 (외부 주소 불러오기 차단)
export const sanitizeTemplate = (html) => DOMPurify.sanitize(String(html || ''), PURIFY).replace(/(url|expression)\s*\(/gi, 'blocked(');
const escapeHtml = (text) => String(text ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const won = (value) => (value === '' || value === undefined || value === null ? '' : Number(String(value).replace(/,/g, '')).toLocaleString('ko-KR'));

// 값 → 보이는 글자
export function displayValue(field, value) {
  if (value === undefined || value === null || value === '') return '';
  if (field.type === 'period') return value.from || value.to ? `${value.from || ''} ~ ${value.to || ''}` : '';
  if (field.type === 'money') return `${won(value)}원`;
  if (field.type === 'number') return Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 6 });
  return String(value);
}
// 서식 안의 {{이름}} 중 입력칸에 없는 이름
export const unknownPlaceholders = (template, fields) => {
  const labels = new Set(fields.map((f) => f.label));
  return [...new Set([...String(template || '').matchAll(PLACEHOLDER)].map((m) => m[1]))].filter((name) => !labels.has(name));
};

// 입력칸 하나
export function FieldInput({ field, value, onChange, compact = false }) {
  const cls = compact ? ea.cfInline : ea.input;
  switch (field.type) {
    case 'textarea':
      return <Textarea className={cls} autosize minRows={compact ? 2 : 3} maxRows={10} maxLength={4000} value={value || ''} aria-label={field.label}
        onChange={(e) => onChange(e.currentTarget.value)} />;
    case 'number':
      return <TextInput className={cls} inputMode="decimal" value={value || ''} aria-label={field.label}
        onChange={(e) => onChange(e.currentTarget.value.replace(/[^0-9.-]/g, ''))} />;
    case 'money':
      return <TextInput className={cls} inputMode="numeric" value={won(value)} aria-label={field.label} rightSection={<span className={ea.cfUnit}>원</span>}
        onChange={(e) => onChange(e.currentTarget.value.replace(/[^0-9]/g, ''))} />;
    case 'date':
      return <ErpDateInput value={value || ''} aria-label={field.label} onChange={(e) => onChange(e.currentTarget.value)} />;
    case 'period': {
      const period = value || {};
      return <div className={ea.period}>
        <ErpDateInput value={period.from || ''} aria-label={`${field.label} 시작`} onChange={(e) => { const from = e.currentTarget.value; onChange({ ...period, from }); }} />
        <span>~</span>
        <ErpDateInput value={period.to || ''} aria-label={`${field.label} 종료`} onChange={(e) => { const to = e.currentTarget.value; onChange({ ...period, to }); }} />
      </div>;
    }
    case 'select':
      return <Select className={cls} data={field.options || []} value={value || null} placeholder="선택" aria-label={field.label} clearable={!field.required}
        onChange={(next) => onChange(next || '')} />;
    default:
      return <TextInput className={cls} maxLength={200} value={value || ''} aria-label={field.label} onChange={(e) => onChange(e.currentTarget.value)} />;
  }
}

// HTML 서식 + 자리마다 입력칸 (자리 span 에 입력칸을 portal 로 넣는다)
function TemplateWriter({ form, values, setValue }) {
  const [slots, setSlots] = useState([]);
  const byLabel = useMemo(() => Object.fromEntries(form.fields.map((f) => [f.label, f])), [form.fields]);
  const html = useMemo(() => sanitizeTemplate(form.template).replace(PLACEHOLDER, (all, name) => {
    const field = byLabel[name];
    return field ? `<span data-cf-slot="${escapeHtml(field.key)}"></span>` : escapeHtml(all);
  }), [byLabel, form.template]);
  // innerHTML 객체를 고정: 다시 그릴 때마다 새 객체면 React 가 서식을 다시 써서, 자리에 넣은 입력칸이 사라진다
  const inner = useMemo(() => ({ __html: html }), [html]);
  // 서식이 그려진 뒤 자리(span)를 모은다 — 서식(html)이 바뀔 때만 다시 (ref 콜백은 DOM 이 반영된 뒤 불린다)
  const ref = useCallback((el) => {
    if (!el) return;   // 떼어질 때(개발 모드 StrictMode 의 재연결 포함)는 그대로 둔다
    const nodes = [...el.querySelectorAll('[data-cf-slot]')];
    setSlots(nodes.map((node) => ({ node, key: node.getAttribute('data-cf-slot') })));
  }, [html]); // eslint-disable-line react-hooks/exhaustive-deps
  const fieldOf = (key) => form.fields.find((f) => f.key === key);
  // 서식에 넣지 않은 필수 칸은 서식 아래에 따로 보여 준다 (빠뜨리고 신청하지 않게)
  const placed = new Set(slots.map((s) => s.key));
  const rest = form.fields.filter((f) => !placed.has(f.key));
  return <div className={ea.full}>
    <div ref={ref} className={ea.cfTemplate} dangerouslySetInnerHTML={inner} />
    {slots.map(({ node, key }, index) => { const field = fieldOf(key); return field ? createPortal(<FieldInput field={field} value={values[key]} compact onChange={(v) => setValue(key, v)} />, node, `${key}-${index}`) : null; })}
    {rest.length > 0 && <div className={ea.cfRest}>
      {rest.map((field) => <div key={field.key} className={ea.cfRestRow}><span className={ea.label}>{field.label} {field.required && <i>*</i>}</span>
        <FieldInput field={field} value={values[field.key]} onChange={(v) => setValue(field.key, v)} /></div>)}
    </div>}
  </div>;
}

// 작성 화면: 서식이 있으면 서식, 없으면 '라벨 | 입력' 자동 배치
export function CustomFields({ form, values, setValue }) {
  if (form.template) return <TemplateWriter form={form} values={values} setValue={setValue} />;
  return <>{form.fields.map((field) => <div key={field.key} className={['textarea', 'period'].includes(field.type) ? ea.full : ''}>
    <span className={ea.label}>{field.label} {field.required && <i>*</i>}</span>
    <FieldInput field={field} value={values[field.key]} onChange={(v) => setValue(field.key, v)} />
  </div>)}</>;
}

// 읽기 화면: 문서에 저장된 그 시점 양식으로 (양식을 고쳐도 옛 문서는 그대로)
export function CustomRead({ content }) {
  const snapshot = content?._form || { fields: [], template: '' };
  const values = content?.values || {};
  const html = useMemo(() => {
    const snapshot = content?._form || { fields: [], template: '' };
    const values = content?.values || {};
    if (!snapshot.template) return '';
    const byLabel = Object.fromEntries(snapshot.fields.map((f) => [f.label, f]));
    return sanitizeTemplate(snapshot.template).replace(PLACEHOLDER, (all, name) => {
      const field = byLabel[name];
      return field ? `<span class="${ea.cfValue}">${escapeHtml(displayValue(field, values[field.key])).replace(/\n/g, '<br>') || '&nbsp;'}</span>` : escapeHtml(all);
    });
  }, [content]);
  if (snapshot.template) return <div className={ea.cfTemplate} dangerouslySetInnerHTML={{ __html: html }} />;
  return <div className={ea.readGrid}>
    {snapshot.fields.map((field) => [<div key={`${field.key}-l`}>{field.label}</div>, <div key={`${field.key}-v`} style={{ whiteSpace: 'pre-wrap' }}>{displayValue(field, values[field.key]) || '-'}</div>])}
  </div>;
}
