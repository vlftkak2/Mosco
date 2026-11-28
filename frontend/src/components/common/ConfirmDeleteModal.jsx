import { Modal } from '@mantine/core';
import { IconLock, IconTrash } from '@tabler/icons-react';
import classes from '../../styles/components/ConfirmDeleteModal.module.css';

/**
 * 모든 화면 공통 삭제 확인 창 (매입등록 심플형과 같은 디자인).
 *  title   : '입고전표를 삭제할까요?'
 *  target  : 삭제 대상 (전표번호 · '선택 3개 품목' 등) — 가운데 알약 모양으로 표시
 *  message : '전표와 상세 내역이 모두 삭제되며'
 *  note    : '삭제한 전표는 복구할 수 없습니다.' (message 다음 줄)
 *  showIcon: false 면 위쪽 휴지통 아이콘을 숨긴다 (삭제가 아닌 확인 창)
 *  icon / cancelLabel : 휴지통 대신 다른 아이콘, '취소' 대신 다른 글자 (예: 승인요청 안내 창)
 *  blocked : 삭제할 수 없는 사유 (월마감 · 수불확정 · 사용된 재고 …). 있으면 같은 모양의 '삭제할 수 없습니다' 창 + [확인] 하나
 */
export default function ConfirmDeleteModal({
  opened, onClose, onConfirm, loading = false, title = '삭제할까요?',
  target, message, note = '삭제한 내용은 복구할 수 없습니다.', confirmLabel = '삭제', showIcon = true, icon, cancelLabel = '취소', blocked = '',
}) {
  const close = () => { if (!loading) onClose?.(); };
  if (blocked) {
    return <Modal opened={opened} onClose={close} centered size={360} withCloseButton={false} padding={0} radius={16} returnFocus={false}
      overlayProps={{ backgroundOpacity: 0.2 }} classNames={{ content: classes.content }}>
      <div className={classes.top}>
        <span className={classes.icon} aria-hidden="true"><IconLock size={24} stroke={1.8} /></span>
        <h2>삭제할 수 없습니다</h2>
        {target ? <span className={classes.target} title={String(target)}>{target}</span> : null}
        <p>{blocked}</p>
      </div>
      <div className={`${classes.actions} ${classes.actionsSingle}`}>
        <button type="button" className={classes.ok} onClick={close} data-autofocus>확인</button>
      </div>
    </Modal>;
  }
  return <Modal opened={opened} onClose={close} centered size={360} withCloseButton={false} padding={0} radius={16} returnFocus={false}
    closeOnEscape={!loading} closeOnClickOutside={!loading} overlayProps={{ backgroundOpacity: 0.2 }} classNames={{ content: classes.content }}>
    <div className={classes.top}>
      {showIcon && <span className={classes.icon} aria-hidden="true">{icon || <IconTrash size={24} stroke={1.8} />}</span>}
      <h2>{title}</h2>
      {target ? <span className={classes.target} title={String(target)}>{target}</span> : null}
      {(message || note) && <p>{message}{message && note ? <br /> : null}{note}</p>}
    </div>
    <div className={classes.actions}>
      <button type="button" className={classes.cancel} onClick={close} disabled={loading}>{cancelLabel}</button>
      <button type="button" className={classes.confirm} onClick={onConfirm} disabled={loading} data-autofocus>
        {loading && <span className={classes.spinner} aria-hidden="true" />}{confirmLabel}
      </button>
    </div>
  </Modal>;
}
