// AI 업무비서 질문 보내기 (오른쪽 대화창 · 'AI 업무비서' 화면이 같이 쓴다)
//  - 서버는 대화를 저장하지 않으므로, 앞선 대화(최근 12개)를 같이 보낸다. 오류 안내는 대화 기록으로 보내지 않는다.
//  - 답은 서버가 메뉴권한 안의 자료로만 만든다. 질문 원문은 서버에 기록된다 (AI 비용현황).
import axios from 'axios';
import { apiErrorMessage } from '../../utils/apiError';

const MAX_HISTORY = 12;
const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });

// messages: [{ role: 'user' | 'assistant', content, charts?, error? }] (마지막이 이번 질문)
// 돌려줌: 답변 메시지 하나 · 요청을 끊었으면 null
export async function askAssistant(messages, signal) {
  const history = messages.filter((message) => !message.error).slice(-MAX_HISTORY)
    .map((message) => ({ role: message.role, content: String(message.content || '').slice(0, 2000) }));
  try {
    const response = await axios.post('/api/ai-chat/messages', { messages: history }, { ...authConfig(), signal });
    const data = response.data || {};
    return { role: 'assistant', content: data.answer || '', charts: Array.isArray(data.charts) ? data.charts : [] };
  } catch (error) {
    if (axios.isCancel(error)) return null;
    return { role: 'assistant', content: apiErrorMessage(error, '답변을 받지 못했습니다. 잠시 후 다시 질문해 주세요.'), error: true };
  }
}

// Enter 로 보내기 (한글 조합 중 Enter · Shift+Enter 줄바꿈은 제외)
export const isSendKey = (event) => event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229;
