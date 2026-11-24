// 승인 통제: 저장 · 삭제 API 가 바로 반영하지 않고 승인요청으로 보관했을 때의 응답 처리
//   서버 응답 { pending_approval: true, requestno, message }
import { notifications } from '@mantine/notifications';

export const isApprovalPending = (data) => Boolean(data?.pending_approval);

// 알림을 띄우고, 헤더의 승인 알림 숫자를 바로 새로 읽게 한다
export function notifyApprovalPending(data) {
  notifications.show({
    title: '승인요청',
    message: data?.message || '승인요청했습니다. 승인되면 반영됩니다.',
    color: 'yellow',
    position: 'bottom-right',
    autoClose: 7000,
  });
  window.dispatchEvent(new Event('approval-changed'));
}
