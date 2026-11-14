// 상담게시판 (메뉴: CUSTOMER_SUPPORT, 로그인한 모든 계정) — 왼쪽 목록 · 오른쪽 상세 + 대화형 답글.
// 탭: 공지사항(답글 없음) · AI ERP문의 = 운영사(001)만 보고 관리, 재고 · 시스템문의 = 각 회사가 등록 · 관리(운영사도 시험 등록 가능).
// 처리상태: 답변대기(답글 없음) · 답변완료(운영사가 마지막) · 추가문의(회사가 마지막). 서버: backend/services/system/Board.py
import { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Checkbox, Loader, Modal, Pagination, Textarea, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconCheck, IconInbox, IconLock, IconMessageCircle, IconMessages, IconPackage, IconPencil, IconPhone, IconPin,
  IconPinnedOff, IconSearch, IconSend, IconSettings, IconSparkles, IconSpeakerphone, IconTrash, IconX,
} from '@tabler/icons-react';
import ErpBreadcrumb from '../../components/common/ErpBreadcrumb';
import useErpPageRibbon from '../../components/common/useErpPageRibbon';
import usePageReactivated from '../../components/common/usePageReactivated';
import { MenuAccessContext } from '../../components/layout/MainLayout';
import shared from '../../styles/pages/ManagementShared.module.css';
import { ColumnResizeHandle, pickerClasses, useResizableColumns } from '../../components/common/PickerModal';
import simpleTheme from '../../styles/pages/SimpleTheme.module.css';
import searchClasses from '../../styles/pages/InboundSearch.module.css';
import classes from '../../styles/pages/Board.module.css';
import ConfirmDeleteModal from '../../components/common/ConfirmDeleteModal';
import { cachedDateFormat } from '../../utils/dateFormat';

const TABS = [
  { key: 'notice', label: '공지사항', icon: IconSpeakerphone, operatorOnly: true, noReply: true, hint: '운영사 공지 (운영사만 보고 씀)' },
  { key: 'stock', label: '재고문의', icon: IconPackage, hint: '재고 · 납기 문의' },
  { key: 'ai', label: 'AI ERP문의', icon: IconSparkles, operatorOnly: true, noReply: true, hint: '홈페이지로 들어오는 AI ERP 문의 (운영사만 봄)' },
  { key: 'system', label: '시스템문의', icon: IconSettings, hint: '시스템 이용 문의' },
];
const STATUS = {
  waiting: { label: '답변대기', tone: 'waiting' },
  followup: { label: '추가문의', tone: 'followup' },
  answered: { label: '답변완료', tone: 'answered' },
  notice: { label: '안내', tone: 'notice' },
  ai: { label: '접수', tone: 'notice' },
};
const STATUS_FILTERS = [['', '전체'], ['waiting', '답변대기'], ['followup', '추가문의'], ['answered', '답변완료']];
const PAGE_SIZE = 20;

const auth = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });
const errorText = (error) => (typeof error.response?.data?.detail === 'string' ? error.response.data.detail : '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
// 다른 메뉴와 같은 알림 형식: 굵은 제목 + 설명
const toast = (title, message, color = 'teal') => notifications.show({ title, message, color });
const fullDate = (value) => (value ? new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-');
const shortDate = (value) => (value ? cachedDateFormat('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit' }).format(new Date(value)).replace(/\s/g, '').replace(/\.$/, '') : '-');
const ago = (value) => {
  if (!value) return '';
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
  if (minutes < 1) return '방금 전';
  if (minutes < 60) return `${minutes}분 전`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}시간 전`;
  if (minutes < 60 * 24 * 7) return `${Math.round(minutes / 1440)}일 전`;
  return shortDate(value);
};
// N 표시: 글을 쓴 지 24시간 이내
const isNew = (value) => value && Date.now() - new Date(value).getTime() < 24 * 60 * 60 * 1000;

function StatusBadge({ status }) {
  const meta = STATUS[status] || STATUS.waiting;
  return <span className={`${classes.status} ${classes[`status_${meta.tone}`]}`}>{meta.label}</span>;
}

// 목록 열: 머리글 오른쪽 끝을 끌어 너비 조절 (두 번 누르면 기본 너비)
const LIST_COLUMNS = [
  { key: 'status', label: '상태', width: 86, minWidth: 70 },
  { key: 'title', label: '제목', width: 300, minWidth: 120 },
  { key: 'company', label: '회사', width: 130 },
  { key: 'author', label: '작성자', width: 96 },
  { key: 'date', label: '등록일', width: 76 },
  { key: 'reply', label: '최근 답글', width: 84 },
];

export default function Board() {
  const listCols = useResizableColumns(LIST_COLUMNS);
  const access = useContext(MenuAccessContext);
  const operator = String(access?.companyid || '') === '001';
  // 다른 회사에는 재고 · 시스템문의 탭만 보인다
  const tabs = useMemo(() => TABS.filter((item) => operator || !item.operatorOnly), [operator]);
  const [category, setCategory] = useState(() => (operator ? 'notice' : 'stock'));
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ items: [], total: 0, can_create: false, is_operator: false });
  const [summary, setSummary] = useState({});
  const [listLoading, setListLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [editing, setEditing] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const listRequest = useRef(0);
  const detailRequest = useRef(0);
  const threadEnd = useRef(null);

  const tab = tabs.find((item) => item.key === category) || tabs[0];
  const noReply = Boolean(tab?.noReply);
  const isNotice = tab?.key === 'notice';
  const operatorName = result.management_company_name || '운영사';

  const loadSummary = useCallback(async () => {
    try {
      const { data } = await axios.get('/api/board/summary', auth());
      setSummary(data.categories || {});
    } catch { /* 건수는 없어도 화면은 쓸 수 있다 */ }
  }, []);

  const loadList = useCallback(async () => {
    const id = ++listRequest.current;
    setListLoading(true);
    try {
      const { data } = await axios.get('/api/board', { ...auth(), params: { category, keyword, status: noReply ? '' : statusFilter, page, page_size: PAGE_SIZE } });
      if (id !== listRequest.current) return;
      if (page > 1 && !data.items.length) { setPage(page - 1); return; }
      setResult(data);
    } catch (error) {
      if (id === listRequest.current) { setResult((current) => ({ ...current, items: [], total: 0 })); toast('게시글 조회 실패', errorText(error), 'red'); }
    } finally {
      if (id === listRequest.current) setListLoading(false);
    }
  }, [category, keyword, statusFilter, noReply, page]);

  const loadDetail = useCallback(async (postId) => {
    const id = ++detailRequest.current;
    setDetailLoading(true);
    try {
      const { data } = await axios.get(`/api/board/${postId}`, auth());
      if (id === detailRequest.current) { setDetail(data.item); setEditing(null); }
    } catch (error) {
      if (id === detailRequest.current) { setDetail(null); setSelectedId(null); toast('게시글 조회 실패', errorText(error), 'red'); }
    } finally {
      if (id === detailRequest.current) setDetailLoading(false);
    }
  }, []);

  useEffect(() => { void loadList(); }, [loadList]);
  useEffect(() => { void loadSummary(); }, [loadSummary]);
  const refreshAll = useCallback(() => { void loadList(); void loadSummary(); if (selectedId) void loadDetail(selectedId); }, [loadList, loadSummary, loadDetail, selectedId]);
  usePageReactivated(() => { if (!busy && !draft) refreshAll(); });

  // 답글이 늘면 대화 끝으로
  const replyCount = detail?.replies?.length || 0;
  const detailNoReply = Boolean(TABS.find((item) => item.key === detail?.category)?.noReply);
  // 글을 열면 맨 위(본문)부터, 같은 글에 답글이 늘었을 때만 새 답글까지 내려간다
  const seenReplies = useRef({ id: null, count: 0 });
  useEffect(() => {
    const seen = seenReplies.current;
    if (seen.id === detail?.id && replyCount > seen.count) threadEnd.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
    seenReplies.current = { id: detail?.id, count: replyCount };
  }, [replyCount, detail?.id]);

  const changeTab = (key) => {
    if (key === category) return;
    setCategory(key); setStatusFilter(''); setSearch(''); setKeyword(''); setPage(1);
    setSelectedId(null); setDetail(null); setReplyText(''); setEditing(null);
  };
  const runSearch = () => { setPage(1); if (keyword === search.trim()) void loadList(); else setKeyword(search.trim()); };
  const select = (postId) => { if (postId === selectedId) return; setSelectedId(postId); setReplyText(''); setEditing(null); void loadDetail(postId); };
  const startNew = () => setDraft({ category, title: '', content: '', phone: '', pinned: false });
  const startEdit = () => setDraft({ id: detail.id, category: detail.category, title: detail.title, content: detail.content, phone: detail.phone || '', pinned: Boolean(detail.pinned) });

  useErpPageRibbon({
    onSearch: busy ? undefined : refreshAll,
    onAdd: result.can_create && !busy ? startNew : undefined,
    // 목록에서 글을 고르면 위쪽 [삭제]로도 지울 수 있다 (지울 권한이 있는 글만)
    onDelete: detail?.can_edit && !busy ? () => setConfirm({ type: 'post' }) : undefined,
    showPrint: false,
  });

  // 결과 반영: 상세 · 목록 · 건수
  const applyItem = (item, title, message) => {
    setDetail(item); setSelectedId(item.id);
    if (title) toast(title, message);
    void loadList(); void loadSummary();
  };
  const run = async (action) => {
    if (busy) return;
    setBusy(true);
    try { await action(); } catch (error) { toast('처리 실패', errorText(error), 'red'); } finally { setBusy(false); }
  };

  const savePost = (form) => {
    void run(async () => {
      const { id, ...body } = form;
      const { data } = id ? await axios.put(`/api/board/${id}`, body, auth()) : await axios.post('/api/board', body, auth());
      setDraft(null);
      if (!id) setPage(1);
      applyItem(data.item, id ? '게시글 수정 완료' : '게시글 등록 완료', id ? '게시글을 수정했습니다.' : '게시글을 등록했습니다.');
    });
  };
  const sendReply = () => {
    if (!replyText.trim()) return;
    void run(async () => {
      const { data } = await axios.post(`/api/board/${detail.id}/replies`, { reply: replyText }, auth());
      setReplyText('');
      applyItem(data.item);
    });
  };
  const saveReplyEdit = () => {
    if (!editing?.text.trim()) return;
    void run(async () => {
      const { data } = await axios.put(`/api/board/${detail.id}/replies/${editing.id}`, { reply: editing.text }, auth());
      setEditing(null);
      applyItem(data.item, '답글 수정 완료', '답글을 수정했습니다.');
    });
  };
  const togglePin = () => void run(async () => {
    const { data } = await axios.put(`/api/board/${detail.id}/pin`, { pinned: !detail.pinned }, auth());
    applyItem(data.item, data.item.pinned ? '상단 고정 완료' : '고정 해제 완료', data.item.pinned ? '공지를 목록 맨 위에 고정했습니다.' : '공지 고정을 해제했습니다.');
  });
  const confirmDelete = () => void run(async () => {
    if (confirm.type === 'post') {
      await axios.delete(`/api/board/${detail.id}`, auth());
      setConfirm(null); setDetail(null); setSelectedId(null);
      toast('게시글 삭제 완료', '게시글을 삭제했습니다.');
      void loadList(); void loadSummary();
    } else {
      const { data } = await axios.delete(`/api/board/${detail.id}/replies/${confirm.replyId}`, auth());
      setConfirm(null);
      applyItem(data.item, '답글 삭제 완료', '답글을 삭제했습니다.');
    }
  });

  const counts = useMemo(() => Object.fromEntries(tabs.map(({ key }) => [key, summary[key] || { total: 0, pending: 0 }])), [summary, tabs]);
  const pages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));

  return <div className={`${simpleTheme.simple} ${shared.pageShell} ${searchClasses.page} ${classes.page}`}>
    <ErpBreadcrumb parent="상담관리" current="상담게시판" />

    <div className={classes.workspace}>
      {/* ── 목록 ── */}
      <section className={classes.listPanel}>
        <div className={classes.tabs} role="tablist" aria-label="상담 분류">
          {tabs.map(({ key, label }) => {
            const count = counts[key];
            return <button key={key} type="button" role="tab" aria-selected={category === key} className={`${classes.tab} ${category === key ? classes.tabOn : ''}`} onClick={() => changeTab(key)}>
              <span>{label}</span>
              {count.pending > 0 ? <b className={classes.tabPending} title="답변을 기다리는 문의">{count.pending}</b> : <i className={classes.tabCount}>{count.total}</i>}
            </button>;
          })}
        </div>

        <div className={classes.toolbar}>
          {/* 공지사항 · AI ERP문의는 상태 필터가 없으므로 검색 · 등록 버튼을 왼쪽부터 놓는다 */}
          {!noReply && <div className={classes.filters} role="radiogroup" aria-label="처리상태">
              {STATUS_FILTERS.map(([value, label]) => <button key={value || 'all'} type="button" role="radio" aria-checked={statusFilter === value}
                className={`${classes.filter} ${statusFilter === value ? classes.filterOn : ''}`} onClick={() => { setStatusFilter(value); setPage(1); }}>{label}</button>)}
            </div>}
          <form className={`${classes.search} ${noReply ? classes.searchLeft : ''}`} onSubmit={(event) => { event.preventDefault(); runSearch(); }}>
            <TextInput size="xs" leftSection={<IconSearch size={14} />} placeholder="제목 · 내용 검색" value={search} maxLength={200} aria-label="게시글 검색"
              onChange={(event) => setSearch(event.currentTarget.value)} />
          </form>
          {result.can_create && <button type="button" className={classes.writeButton} onClick={startNew} disabled={busy}><IconPencil size={15} stroke={2} />{isNotice ? '공지 등록' : '문의 등록'}</button>}
        </div>

        <div className={classes.listScroll} aria-busy={listLoading}>
          <table className={classes.table} style={{ width: `max(100%, ${listCols.tableWidth}px)` }}>
            <colgroup>{LIST_COLUMNS.map((column) => <col key={column.key} data-column-key={column.key} style={{ width: listCols.widthOf(column) }} />)}</colgroup>
            <thead><tr>{LIST_COLUMNS.map((column) => <th key={column.key} className={pickerClasses.resizableHead}>{column.label}<ColumnResizeHandle column={column} columns={listCols} /></th>)}</tr></thead>
            <tbody>
              {listLoading && !result.items.length ? <tr><td colSpan={6} className={classes.empty}><Loader size="sm" color="red" /></td></tr>
                : result.items.length ? result.items.map((item) => <tr key={item.id} className={item.id === selectedId ? classes.rowOn : ''} onClick={() => select(item.id)}
                  tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') select(item.id); }}>
                  <td><StatusBadge status={item.status} /></td>
                  <td className={classes.titleCell}>
                    {item.pinned && <IconPin size={13} className={classes.pinIcon} aria-label="상단 고정" />}
                    <span className={classes.titleText} title={item.title}>{item.title}</span>
                    {item.reply_count > 0 && <span className={classes.replyChip}><IconMessageCircle size={11} />{item.reply_count}</span>}
                    {isNew(item.created_at) && <span className={classes.newDot}>N</span>}
                  </td>
                  <td className={classes.muted} title={item.companyname}>{item.companyname}</td>
                  <td className={classes.muted} title={item.created_by}>{item.created_name || item.created_by}</td>
                  <td className={classes.muted}>{shortDate(item.created_at)}</td>
                  <td className={classes.muted}>{item.last_reply_at ? ago(item.last_reply_at) : '-'}</td>
                </tr>)
                  : <tr><td colSpan={6} className={classes.empty}>
                    <IconInbox size={30} stroke={1.4} />
                    <b>{keyword || statusFilter ? '조건에 맞는 글이 없습니다' : isNotice ? '등록된 공지가 없습니다' : '등록된 문의가 없습니다'}</b>
                    <span>{result.can_create ? (isNotice ? '[공지 등록]으로 새 소식을 남겨 주세요.' : '[문의 등록]으로 궁금한 점을 남겨 주세요.') : tab.hint}</span>
                  </td></tr>}
            </tbody>
          </table>
        </div>

        <footer className={classes.listFooter}>
          <span>전체 <b>{result.total.toLocaleString()}</b>건 · {tab?.operatorOnly ? '운영사만 볼 수 있습니다' : `작성 회사와 ${operatorName}만 볼 수 있습니다`}</span>
          <Pagination size="sm" color="red" total={pages} value={page} onChange={setPage} disabled={listLoading} />
        </footer>
      </section>

      {/* ── 상세 · 대화 ── */}
      <section className={classes.detailPanel}>
        {!detail ? <div className={classes.detailEmpty}>
          {detailLoading ? <Loader size="sm" color="red" /> : <>
            <span className={classes.detailEmptyIcon}><IconMessages size={28} stroke={1.5} /></span>
            <b>글을 선택하세요</b>
            <span>왼쪽 목록에서 글을 누르면 내용과 답글 대화가 여기에 열립니다.</span>
          </>}
        </div> : <>
          <header className={classes.detailHead}>
            <div className={classes.detailTags}>
              <span className={classes.categoryTag}>{TABS.find((item) => item.key === detail.category)?.label}</span>
              <StatusBadge status={detail.status} />
              {detail.pinned && <span className={classes.pinTag}><IconPin size={11} />고정</span>}
            </div>
            <div className={classes.detailActions}>
              {detail.can_pin && <button type="button" className={classes.iconButton} onClick={togglePin} disabled={busy} title={detail.pinned ? '고정 해제' : '상단 고정'}>{detail.pinned ? <IconPinnedOff size={16} /> : <IconPin size={16} />}</button>}
              {detail.can_edit && <button type="button" className={classes.iconButton} onClick={startEdit} disabled={busy} title="수정"><IconPencil size={16} /></button>}
              {detail.can_edit && <button type="button" className={`${classes.iconButton} ${classes.iconDanger}`} onClick={() => setConfirm({ type: 'post' })} disabled={busy} title="삭제"><IconTrash size={16} /></button>}
              <button type="button" className={classes.iconButton} onClick={() => { setSelectedId(null); setDetail(null); }} title="닫기"><IconX size={16} /></button>
            </div>
          </header>

          <div className={classes.detailScroll}>
            <h2 className={classes.detailTitle}>{detail.title}</h2>
            <div className={classes.author}>
              <b>{detail.created_name || detail.created_by}</b>
              {detail.companyid === '001' ? <span className={classes.operatorTag}>운영사</span> : <span className={classes.commentCompany}>{detail.companyname}</span>}
              <time dateTime={detail.created_at}>{fullDate(detail.created_at)}</time>
              {detail.updated_at && detail.updated_at !== detail.created_at && detail.updated_name ? <span className={classes.edited}>최종 수정 {detail.updated_name}</span> : null}
              {detail.phone && <a className={classes.phone} href={`tel:${detail.phone}`}><IconPhone size={13} />{detail.phone}</a>}
            </div>
            <div className={classes.body}>{detail.content}</div>

            {!detailNoReply && <div className={classes.threadHead}><IconMessages size={15} />답글 <b>{replyCount}</b></div>}
            {detailNoReply ? null : replyCount ? <ol className={classes.thread}>
              {detail.replies.map((reply) => {
                const operator = reply.companyid === '001';
                return <li key={reply.id} className={`${classes.comment} ${operator ? classes.commentOperator : ''}`}>
                  <div className={classes.commentMeta}>
                    <b>{reply.created_name || reply.created_by}</b>
                    {operator ? <span className={classes.operatorTag}>운영사</span> : <span className={classes.commentCompany}>{reply.companyname}</span>}
                    <time dateTime={reply.created_at} title={ago(reply.created_at)}>{fullDate(reply.created_at)}</time>
                    {reply.updated_at && <span className={classes.edited}>수정됨</span>}
                    {(reply.can_edit || reply.can_delete) && editing?.id !== reply.id && <span className={classes.commentActions}>
                      {reply.can_edit && <button type="button" onClick={() => setEditing({ id: reply.id, text: reply.content })} disabled={busy}>수정</button>}
                      {reply.can_delete && <button type="button" onClick={() => setConfirm({ type: 'reply', replyId: reply.id })} disabled={busy}>삭제</button>}
                    </span>}
                  </div>
                  {editing?.id === reply.id ? <div className={classes.editBox}>
                    <Textarea autosize minRows={2} maxRows={8} maxLength={20000} value={editing.text} autoFocus
                      onChange={(event) => setEditing({ ...editing, text: event.currentTarget.value })}
                      onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) saveReplyEdit(); if (event.key === 'Escape') setEditing(null); }} />
                    <div className={classes.editActions}>
                      <button type="button" className={classes.textButton} onClick={() => setEditing(null)} disabled={busy}>취소</button>
                      <button type="button" className={classes.smallPrimary} onClick={saveReplyEdit} disabled={busy || !editing.text.trim()}><IconCheck size={13} />저장</button>
                    </div>
                  </div> : <div className={classes.commentBody}>{reply.content}</div>}
                </li>;
              })}
              <li ref={threadEnd} aria-hidden="true" />
            </ol> : <p className={classes.noReply}>{detail.can_reply ? '아직 답글이 없습니다. 첫 답글을 남겨 보세요.' : '아직 답글이 없습니다.'}</p>}
          </div>

          {detailNoReply ? null : detail.can_reply ? <div className={classes.composer}>
            <Textarea autosize minRows={2} maxRows={6} maxLength={20000} value={replyText} placeholder={result.is_operator ? '답변을 입력하세요' : '추가로 궁금한 점이나 답변에 대한 회신을 남겨 주세요'}
              onChange={(event) => setReplyText(event.currentTarget.value)} disabled={busy}
              onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) sendReply(); }} aria-label="답글 입력" />
            <div className={classes.composerBar}>
              <span>Ctrl + Enter 로 등록 · {replyText.length.toLocaleString()} / 20,000</span>
              <button type="button" className={classes.sendButton} onClick={sendReply} disabled={busy || !replyText.trim()}>
                {busy ? <span className={classes.spinner} aria-hidden="true" /> : <IconSend size={15} stroke={2} />}답글 등록
              </button>
            </div>
          </div> : <div className={classes.composerLocked}><IconLock size={13} />작성 회사와 운영사만 답글을 달 수 있습니다.</div>}
        </>}
      </section>
    </div>

    {/* ── 글쓰기 · 수정 ── */}
    <Modal opened={Boolean(draft)} onClose={() => { if (!busy) setDraft(null); }} size={680} centered returnFocus={false} closeOnClickOutside={false} closeOnEscape={!busy}
      title={<span className={classes.modalTitle}><span className={classes.modalIcon}><IconPencil size={17} /></span>{draft?.id ? '게시글 수정' : isNotice ? '공지 등록' : '문의 등록'}</span>}
      classNames={{ header: classes.modalHeader, body: classes.modalBody, content: classes.modalContent }}>
      {draft && <PostForm initial={draft} busy={busy} isOperator={result.is_operator} operatorName={operatorName}
        onCancel={() => setDraft(null)} onSubmit={savePost} />}
    </Modal>

    {/* ── 삭제 확인 ── */}
    <ConfirmDeleteModal opened={Boolean(confirm)} onClose={() => setConfirm(null)} onConfirm={confirmDelete} loading={busy}
      title={confirm?.type === 'post' ? '게시글을 삭제할까요?' : '답글을 삭제할까요?'} target={confirm?.type === 'post' ? detail?.title : undefined}
      message={confirm?.type === 'post' ? '이 글과 달린 답글이 모두 삭제되며' : ''} />
  </div>;
}

// 글쓰기 창: 입력값을 이 안에서만 들고 있어 글자를 칠 때 게시판 전체가 다시 그려지지 않는다.
const PostForm = memo(function PostForm({ initial, busy, isOperator, operatorName, onCancel, onSubmit }) {
  const [form, setForm] = useState(initial);
  const set = (key) => (event) => {
    const value = event.currentTarget.type === 'checkbox' ? event.currentTarget.checked : event.currentTarget.value;
    setForm((prev) => ({ ...prev, [key]: value }));
  };
  const tabInfo = TABS.find((item) => item.key === form.category);
  const notice = form.category === 'notice';
  return <form className={classes.form} onSubmit={(event) => { event.preventDefault(); onSubmit(form); }}>
    <div className={classes.formTarget}>
      <span className={classes.categoryTag}>{tabInfo?.label}</span>
      <span>{tabInfo?.operatorOnly ? '운영사만 볼 수 있습니다.' : `작성 회사와 ${operatorName}만 볼 수 있습니다.`}</span>
    </div>
    <TextInput label="제목" required data-autofocus maxLength={200} value={form.title} placeholder={notice ? '공지할 내용을 한 줄로' : '문의 내용을 한 줄로 요약해 주세요'}
      onChange={set('title')} description={`${form.title.length} / 200`} disabled={busy} />
    <Textarea label="내용" required autosize minRows={8} maxRows={16} maxLength={20000} value={form.content} disabled={busy}
      placeholder={notice ? '주요 내용과 적용 일정을 적어 주세요.' : '상황을 자세히 남겨 주시면 더 정확하게 답변드릴 수 있습니다.\n예) 품목 · 규격 · 수량 / 사용 중인 메뉴 · 발생한 문제'}
      onChange={set('content')} description={`${form.content.length.toLocaleString()} / 20,000`} />
    {!notice && <TextInput label="회신 연락처" leftSection={<IconPhone size={14} />} placeholder="010-0000-0000 (선택)" maxLength={50}
      value={form.phone} onChange={set('phone')} disabled={busy} />}
    {notice && isOperator && <Checkbox color="red" label="목록 맨 위에 고정" checked={form.pinned} onChange={set('pinned')} disabled={busy} />}
    <div className={classes.formActions}>
      <button type="button" className={classes.textButton} onClick={onCancel} disabled={busy}>취소</button>
      <button type="submit" className={classes.sendButton} disabled={busy || !form.title.trim() || !form.content.trim()}>
        {busy ? <span className={classes.spinner} aria-hidden="true" /> : <IconCheck size={15} stroke={2.2} />}{form.id ? '수정 저장' : '등록'}
      </button>
    </div>
  </form>;
});
