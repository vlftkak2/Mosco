// AI 업무비서 (메뉴권한 AI_ASSISTANT · 모스코 전용) — 시안 STEEL119_AI비서_챗봇.html 과 같은 모양 · 동작
//  - 화면 오른쪽 가장자리 탭을 누르면 오른쪽 아래에 대화 창이 열리고 탭은 숨는다. X 를 누르면 닫히고 탭이 다시 보인다.
//  - Enter 로 보낸다 (한글 조합 중 Enter 는 보내지 않음). 대화는 로그인해 있는 동안 유지된다 (탭을 옮겨도 그대로).
//  - 답은 서버가 메뉴권한 안의 자료로만 만든다 (권한 없는 메뉴 자료는 서버가 막는다).
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { IconRobot, IconSend, IconX } from '@tabler/icons-react';
import classes from '../../styles/layout/AIAssistant.module.css';
import { apiErrorMessage } from '../../utils/apiError';

const GREETING = '무엇을 도와드릴까요?';
const AnswerChart = lazy(() => import('./AIAssistantChart'));
const MAX_HISTORY = 12;
const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });

export default function AIAssistant() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);   // { role: 'user' | 'assistant', content, charts?, error? }
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const inputRef = useRef(null);
  const bodyRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => () => abortRef.current?.abort(), []);   // 로그아웃 등으로 화면이 사라지면 기다리던 요청을 끊는다
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  useEffect(() => {
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [messages, sending, open]);

  const send = async () => {
    const question = text.trim();
    if (!question || sending) return;
    const next = [...messages, { role: 'user', content: question }];
    setMessages(next);
    setText('');
    setSending(true);
    // 오류 안내는 대화 기록으로 보내지 않는다
    const history = next.filter((message) => !message.error).slice(-MAX_HISTORY)
      .map((message) => ({ role: message.role, content: message.content.slice(0, 2000) }));
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await axios.post('/api/ai-chat/messages', { messages: history }, { ...authConfig(), signal: controller.signal });
      const data = response.data || {};
      setMessages((current) => [...current, { role: 'assistant', content: data.answer || '', charts: Array.isArray(data.charts) ? data.charts : [] }]);
    } catch (error) {
      if (axios.isCancel(error)) return;
      setMessages((current) => [...current, { role: 'assistant', content: apiErrorMessage(error, '답변을 받지 못했습니다. 잠시 후 다시 질문해 주세요.'), error: true }]);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setSending(false);
    }
  };

  const onKeyDown = (event) => {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) {
      event.preventDefault();
      send();
    }
  };

  return <div className={classes.root}>
    {!open && <button type="button" className={classes.bot} title="AI 업무비서" aria-label="AI 업무비서 열기" onClick={() => setOpen(true)}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2z" /><path d="M12 2v2" /><path d="M9 12v9" /><path d="M15 12v9" />
        <path d="M5 16l4-2" /><path d="M15 14l4 2" /><path d="M9 18h6" /><path d="M10 8v.01" /><path d="M14 8v.01" />
      </svg>
    </button>}
    {open && <div className={classes.panel} role="dialog" aria-label="AI 업무비서">
      <div className={classes.head}>
        <IconRobot size={18} stroke={1.5} />AI 업무비서
        <button type="button" className={classes.close} aria-label="닫기" onClick={() => setOpen(false)}><IconX size={16} stroke={1.5} /></button>
      </div>
      <div className={classes.body} ref={bodyRef}>
        <div className={`${classes.bubble} ${classes.assistant}`}>{GREETING}</div>
        {messages.map((message, index) => {
          const charts = message.charts || [];
          const kind = message.role === 'user' ? classes.user : classes.assistant;
          return <div key={index} className={`${classes.bubble} ${kind} ${charts.length ? classes.wide : ''} ${message.error ? classes.error : ''}`}>
            {message.content}
            {charts.length > 0 && <Suspense fallback={null}>{charts.map((chart, chartIndex) => <AnswerChart key={chartIndex} chart={chart} />)}</Suspense>}
          </div>;
        })}
        {sending && <div className={`${classes.bubble} ${classes.assistant} ${classes.pending}`}>답변을 준비하고 있습니다…</div>}
      </div>
      <div className={classes.inputRow}>
        <input ref={inputRef} type="text" placeholder="메시지 입력" autoComplete="off" maxLength={2000}
          value={text} onChange={(event) => setText(event.target.value)} onKeyDown={onKeyDown} />
        <button type="button" className={classes.send} aria-label="보내기" disabled={sending} onClick={send}>
          <IconSend size={17} stroke={1.5} />
        </button>
      </div>
    </div>}
  </div>;
}
