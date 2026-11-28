// 홈 › AI 업무비서 (메뉴권한 AI_ASSISTANT · 모스코 전용)
//  - 왼쪽: 대화 목록 (+ 새 대화) · 오른쪽: 대화. 질문을 입력하면 답(글 · 차트 · 표)을 보여준다.
//  - 답은 서버가 메뉴권한 안의 자료로만 만든다. 질문 원문은 서버에 기록되고, 답변 · 대화는 저장하지 않는다
//    → 대화 목록은 이 탭이 열려 있는 동안만 남는다 (탭을 닫거나 로그아웃하면 지워진다).
//  - 화면 오른쪽 가장자리 대화창과는 따로 움직인다 (대화가 섞이지 않음).
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Box, Group, Text } from '@mantine/core';
import {
  IconArrowUp, IconBox, IconChartBar, IconLayoutSidebarLeftCollapse, IconLayoutSidebarLeftExpand, IconPlayerStopFilled,
  IconPlus, IconReceipt, IconTrash, IconWallet,
} from '@tabler/icons-react';
import useErpPageRibbon from '../../components/common/useErpPageRibbon';
import AIBotIcon from '../../components/layout/AIBotIcon';
import { askAssistant, isSendKey } from '../../components/layout/aiChatApi';
import sharedClasses from '../../styles/pages/ManagementShared.module.css';
import simpleTheme from '../../styles/pages/SimpleTheme.module.css';
import pageClasses from '../../styles/pages/InboundRegister.module.css';
import chartClasses from '../../styles/layout/AIAssistant.module.css';
import classes from '../../styles/pages/AIAssistantPage.module.css';

const AnswerChart = lazy(() => import('../../components/layout/AIAssistantChart'));

const EXAMPLES = [
  { icon: IconReceipt, text: '이번 달 매출 현황을 요약해줘' },
  { icon: IconChartBar, text: '최근 3개월 매출이익 추이를 보여줘' },
  { icon: IconWallet, text: '미수금이 많은 거래처를 알려줘' },
  { icon: IconBox, text: '현재고가 많은 품목 10개를 보여줘' },
];
const titleOf = (question) => (question.length > 28 ? `${question.slice(0, 28)}…` : question);
let seq = 0;
const newId = () => `c${Date.now()}-${seq++}`;

export default function AIAssistantPage() {
  const [conversations, setConversations] = useState([]);   // [{ id, title, messages }] 최근 것이 위
  const [activeId, setActiveId] = useState(null);           // null = 새 대화 (아직 질문 전)
  const [pendingId, setPendingId] = useState(null);         // 답을 기다리는 대화
  const [text, setText] = useState('');
  const [listOpen, setListOpen] = useState(true);
  const inputRef = useRef(null);
  const bodyRef = useRef(null);
  const abortRef = useRef(null);

  const active = conversations.find((conversation) => conversation.id === activeId) || null;
  const messages = active?.messages || [];
  const sending = Boolean(pendingId);

  useEffect(() => () => abortRef.current?.abort(), []);   // 탭을 닫으면 기다리던 요청을 끊는다
  useEffect(() => {
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [messages.length, pendingId, activeId]);
  // 입력칸 높이: 내용만큼 (최대 6줄쯤)
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 150)}px`;
  }, [text]);

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPendingId(null);
  };
  const startNew = () => {
    if (sending) stop();
    setActiveId(null);
    setText('');
    inputRef.current?.focus();
  };
  useErpPageRibbon({ onAdd: startNew });

  const send = async (raw = text) => {
    const question = String(raw || '').trim();
    if (!question || sending) return;
    const id = active?.id || newId();
    const next = [...messages, { role: 'user', content: question }];
    setConversations((current) => (active
      ? current.map((conversation) => (conversation.id === id ? { ...conversation, messages: next } : conversation))
      : [{ id, title: titleOf(question), messages: next }, ...current]));
    setActiveId(id);
    setText('');
    setPendingId(id);
    const controller = new AbortController();
    abortRef.current = controller;
    const answer = await askAssistant(next, controller.signal);
    if (!answer) return;   // 멈춤 · 새 대화 · 삭제로 끊은 요청
    setConversations((current) => current.map((conversation) => (conversation.id === id
      ? { ...conversation, messages: [...conversation.messages, answer] } : conversation)));
    if (abortRef.current === controller) abortRef.current = null;
    setPendingId(null);
    inputRef.current?.focus();
  };

  const remove = (id) => {
    if (pendingId === id) stop();
    setConversations((current) => current.filter((conversation) => conversation.id !== id));
    if (activeId === id) setActiveId(null);
  };

  return <Box className={`${sharedClasses.pageShell} ${pageClasses.page} ${simpleTheme.simple} ${classes.page}`}>
    <Box component="nav" aria-label="현재 위치" className={pageClasses.pageBreadcrumb}>
      <Group className={pageClasses.breadcrumbTrail} gap={7}>
        <Text component="span" className={pageClasses.breadcrumbParent}>홈</Text>
        <Text component="span" className={pageClasses.breadcrumbChevron}>›</Text>
        <Text component="span" className={pageClasses.breadcrumbCurrent}>AI 업무비서</Text>
      </Group>
    </Box>

    <div className={`${chartClasses.root} ${classes.frame} ${listOpen ? '' : classes.listClosed}`}>
      {/* 대화 목록 */}
      {listOpen && <aside className={classes.list} aria-label="대화 목록">
        <button type="button" className={classes.newChat} onClick={startNew}><IconPlus size={16} stroke={2} />새 대화</button>
        <div className={classes.listBody}>
          {conversations.length ? conversations.map((conversation) => (
            <div key={conversation.id} className={`${classes.item} ${conversation.id === activeId ? classes.itemOn : ''}`}>
              <button type="button" className={classes.itemOpen} title={conversation.title} onClick={() => setActiveId(conversation.id)}>
                {conversation.title}{pendingId === conversation.id && <span className={classes.itemDot} aria-label="답변 중" />}
              </button>
              <button type="button" className={classes.itemDel} title="대화 삭제" aria-label={`${conversation.title} 삭제`}
                onClick={() => remove(conversation.id)}><IconTrash size={14} stroke={1.6} /></button>
            </div>
          )) : <div className={classes.listEmpty}>대화 기록이 없습니다</div>}
        </div>
        <div className={classes.listNote}>대화는 이 탭을 닫으면 지워집니다</div>
      </aside>}

      {/* 대화 */}
      <section className={classes.chat} aria-label="AI 업무비서 대화">
        <header className={classes.chatHead}>
          <button type="button" className={classes.iconBtn} title={listOpen ? '대화 목록 접기' : '대화 목록 펼치기'}
            aria-label={listOpen ? '대화 목록 접기' : '대화 목록 펼치기'} onClick={() => setListOpen((value) => !value)}>
            {listOpen ? <IconLayoutSidebarLeftCollapse size={18} stroke={1.6} /> : <IconLayoutSidebarLeftExpand size={18} stroke={1.6} />}
          </button>
          <span className={classes.avatarSm}><AIBotIcon size={17} stroke={1.7} /></span>
          <b>{active ? active.title : 'AI 업무비서'}</b>
        </header>

        <div className={classes.body} ref={bodyRef}>
          {!messages.length ? <div className={classes.welcome}>
            <span className={classes.avatarLg}><AIBotIcon size={34} stroke={1.5} /></span>
            <h2>AI 업무비서</h2>
            <p>ERP 자료를 바탕으로 업무 질문에 답합니다.<br />아래 예시를 누르거나 직접 질문해 보세요.</p>
            <div className={classes.examples}>
              {EXAMPLES.map(({ icon: Icon, text: example }) => (
                <button key={example} type="button" className={classes.example} disabled={sending} onClick={() => send(example)}>
                  <Icon size={18} stroke={1.6} /><span>{example}</span>
                </button>
              ))}
            </div>
          </div> : <div className={classes.thread}>
            {messages.map((message, index) => {
              const charts = message.charts || [];
              return message.role === 'user'
                ? <div key={index} className={classes.userRow}><div className={classes.userBubble}>{message.content}</div></div>
                : <div key={index} className={classes.botRow}>
                  <span className={classes.avatarSm}><AIBotIcon size={17} stroke={1.7} /></span>
                  <div className={`${classes.answer} ${message.error ? classes.answerError : ''}`}>
                    {message.content}
                    {charts.length > 0 && <Suspense fallback={null}>{charts.map((chart, chartIndex) => <AnswerChart key={chartIndex} chart={chart} />)}</Suspense>}
                  </div>
                </div>;
            })}
            {pendingId === activeId && <div className={classes.botRow}>
              <span className={classes.avatarSm}><AIBotIcon size={17} stroke={1.7} /></span>
              <div className={classes.typing} aria-label="답변을 준비하고 있습니다"><i /><i /><i /></div>
            </div>}
          </div>}
        </div>

        <footer className={classes.composerWrap}>
          <div className={classes.composer}>
            <textarea ref={inputRef} rows={1} value={text} maxLength={2000} autoComplete="off"
              placeholder="질문을 입력하세요 (Enter 보내기 · Shift+Enter 줄바꿈)" aria-label="질문"
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => { if (isSendKey(event)) { event.preventDefault(); send(); } }} />
            {sending
              ? <button type="button" className={classes.sendBtn} title="멈추기" aria-label="답변 멈추기" onClick={stop}><IconPlayerStopFilled size={14} /></button>
              : <button type="button" className={classes.sendBtn} title="보내기" aria-label="보내기" disabled={!text.trim()} onClick={() => send()}><IconArrowUp size={17} stroke={2.2} /></button>}
          </div>
          <p className={classes.footNote}>질문 내용은 서비스 개선을 위해 기록됩니다 · 답변은 저장하지 않습니다 · 중요한 결정은 원본 자료를 확인하세요</p>
        </footer>
      </section>
    </div>
  </Box>;
}
