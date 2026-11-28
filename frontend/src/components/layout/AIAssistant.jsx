// AI 업무비서 (메뉴권한 AI_ASSISTANT · 모스코 전용) — 시안 STEEL119_AI비서_챗봇.html 과 같은 모양 · 동작
//  - 화면 오른쪽 가장자리 탭을 누르면 오른쪽 아래에 대화 창이 열리고 탭은 숨는다. X 를 누르면 닫히고 탭이 다시 보인다.
//  - Enter 로 보낸다 (한글 조합 중 Enter 는 보내지 않음). 대화는 로그인해 있는 동안 유지된다 (탭을 옮겨도 그대로).
//  - 답은 서버가 메뉴권한 안의 자료로만 만든다 (권한 없는 메뉴 자료는 서버가 막는다).
//  - 질문 원문은 서버에 기록된다 (AI 비용현황 · 모스코 전용에서 열람). 답변은 저장하지 않는다.
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import AIBotIcon from './AIBotIcon';
import { askAssistant } from './aiChatApi';
import { IconRefresh, IconRobot, IconSend, IconX } from '@tabler/icons-react';
import classes from '../../styles/layout/AIAssistant.module.css';

const GREETING = '무엇을 도와드릴까요?';
const AnswerChart = lazy(() => import('./AIAssistantChart'));

// hideTab: 'AI 업무비서' 화면을 보고 있을 때는 가장자리 탭을 숨긴다 (열어 둔 대화창 · 대화는 그대로)
export default function AIAssistant({ hideTab = false }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);   // { role: 'user' | 'assistant', content, charts?, error? }
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const inputRef = useRef(null);
  const bodyRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => () => abortRef.current?.abort(), []);   // 로그아웃 등으로 화면이 사라지면 기다리던 요청을 끊는다
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  // 네비 메뉴 '홈 › AI 업무비서'를 누르면 열린다 (화면 · 탭은 따로 없음). 이미 열려 있으면 입력칸으로.
  useEffect(() => {
    const onOpen = () => { setOpen(true); inputRef.current?.focus(); };
    window.addEventListener('open-ai-assistant', onOpen);
    return () => window.removeEventListener('open-ai-assistant', onOpen);
  }, []);
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
    const controller = new AbortController();
    abortRef.current = controller;
    const answer = await askAssistant(next, controller.signal);
    if (!answer) return;   // 초기화로 끊은 요청 (초기화가 이미 정리했다)
    setMessages((current) => [...current, answer]);
    if (abortRef.current === controller) abortRef.current = null;
    setSending(false);
  };

  // 대화 초기화: 기다리던 답변도 끊고 첫 인사만 남긴다 (서버에는 대화가 저장되지 않는다)
  const reset = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages([]);
    setText('');
    setSending(false);
    inputRef.current?.focus();
  };

  const onKeyDown = (event) => {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) {
      event.preventDefault();
      send();
    }
  };

  return <div className={classes.root}>
    {!open && !hideTab && <button type="button" className={classes.bot} title="AI 업무비서" aria-label="AI 업무비서 열기" onClick={() => setOpen(true)}>
      <AIBotIcon />
    </button>}
    {open && <div className={classes.panel} role="dialog" aria-label="AI 업무비서">
      <div className={classes.head}>
        <IconRobot size={18} stroke={1.5} />AI 업무비서
        <button type="button" className={`${classes.close} ${classes.reset}`} title="대화 초기화" aria-label="대화 초기화"
          disabled={!messages.length && !sending} onClick={reset}><IconRefresh size={16} stroke={1.5} /></button>
        <button type="button" className={classes.close} title="닫기" aria-label="닫기" onClick={() => setOpen(false)}><IconX size={16} stroke={1.5} /></button>
      </div>
      <div className={classes.body} ref={bodyRef}>
        <div className={`${classes.bubble} ${classes.assistant}`}>{GREETING}</div>
        <div className={classes.notice}>질문 내용은 서비스 개선을 위해 기록됩니다 · 답변은 저장하지 않습니다</div>
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
