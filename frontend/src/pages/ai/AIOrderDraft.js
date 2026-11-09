// AI 주문서 인식 → 주문서 관리로 넘기는 "저장 전" 주문 (브라우저 세션에만 보관, DB 저장 X)
// 주문서 관리에서 [저장]하면 /api/ai-order/confirmed 로 저장되고 이 값은 지워진다.
const KEY = 'steel119-ai-order-draft';

export function writeAIOrderDraft(draft) {
  sessionStorage.setItem(KEY, JSON.stringify({ ...draft, created_at: new Date().toISOString() }));
}

export function readAIOrderDraft() {
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    return value && Array.isArray(value.items) && value.analysis_request_id ? value : null;
  } catch {
    return null;
  }
}

export function clearAIOrderDraft() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // 저장공간을 쓸 수 없으면 지울 것도 없다
  }
}
