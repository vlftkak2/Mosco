// 승인 통제: 저장 · 삭제 API 가 바로 반영하지 않고 승인요청으로 보관했을 때의 응답 처리
//   서버 응답 { pending_approval: true, requestno, label, message }
//   매입등록 삭제 창과 같은 모양의 안내 창을 MainLayout 이 띄운다 → [내 요청 보기] 로 통제관리 › 내 요청 이동

export const isApprovalPending = (data) => Boolean(data?.pending_approval);

export function notifyApprovalPending(data) {
  window.dispatchEvent(new CustomEvent('approval-pending', { detail: data || {} }));
  window.dispatchEvent(new Event('approval-changed'));   // 헤더 알림 숫자 새로고침
}
