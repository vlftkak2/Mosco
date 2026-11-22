import { Modal } from '@mantine/core';
import base from '../../styles/components/ConfirmDeleteModal.module.css';
import classes from '../../styles/components/ConfirmActionModal.module.css';

/**
 * 공통 확인 창 (삭제 확인 창 ConfirmDeleteModal 과 같은 디자인 · 삭제가 아닌 확인 · 진행용).
 *  icon    : 위쪽 동그란 아이콘 (tabler 아이콘 요소)
 *  tone    : 'red'(기본) | 'orange' — 아이콘 동그라미 색
 *  title   : '주문서 관리로 넘길까요?'
 *  target  : 대상 (파일명 · 주문번호 등) — 가운데 알약 모양
 *  message : 설명 (줄바꿈은 <br /> 로)
 *  children: 설명 아래 추가 내용 (요약 표 · 안내 상자 등)
 *  actions : [{ label, onClick, kind: 'cancel' | 'dark' | 'confirm', loading, disabled, autoFocus }] — 같은 너비로 나란히
 */
export default function ConfirmActionModal({ opened, onClose, busy = false, icon, tone = 'red', title, target, message, children, actions = [] }) {
  const close = () => { if (!busy) onClose?.(); };
  return <Modal opened={opened} onClose={close} centered size={actions.length > 2 ? 420 : 380} withCloseButton={false} padding={0} radius={16} returnFocus={false}
    closeOnEscape={!busy} closeOnClickOutside={!busy} overlayProps={{ backgroundOpacity: 0.2 }} classNames={{ content: base.content }}>
    <div className={base.top}>
      {icon && <span className={`${base.icon} ${tone === 'orange' ? classes.iconOrange : ''}`} aria-hidden="true">{icon}</span>}
      <h2>{title}</h2>
      {target ? <span className={base.target} title={String(target)}>{target}</span> : null}
      {message && <p>{message}</p>}
    </div>
    {children && <div className={classes.body}>{children}</div>}
    <div className={base.actions} style={{ gridTemplateColumns: `repeat(${Math.max(1, actions.length)}, minmax(0, 1fr))` }}>
      {actions.map((action) => <button key={action.label} type="button" data-autofocus={action.autoFocus || undefined}
        className={`${action.kind === 'cancel' ? base.cancel : action.kind === 'dark' ? `${base.confirm} ${classes.dark}` : base.confirm} ${classes.oneLine}`}
        onClick={action.onClick} disabled={busy || action.disabled}>
        {action.loading && <span className={base.spinner} aria-hidden="true" />}{action.label}
      </button>)}
    </div>
  </Modal>;
}

/** 확인 창 안의 '항목 · 값' 요약 (회색 상자) */
export function ConfirmSummary({ rows }) {
  return <dl className={classes.summary}>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd title={typeof value === 'string' ? value : undefined}>{value}</dd></div>)}</dl>;
}

/** 확인 창 안의 주의 안내 (연한 빨강 상자) */
export function ConfirmNotice({ title, children }) {
  return <div className={classes.notice}><strong>{title}</strong>{children && <span>{children}</span>}</div>;
}
