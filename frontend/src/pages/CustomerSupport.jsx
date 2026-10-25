import { useMemo, useState } from 'react';
import { Box } from '@mantine/core';
import { IconArrowLeft, IconSearch } from '@tabler/icons-react';
import ErpBreadcrumb from '../components/common/ErpBreadcrumb';
import useErpPageRibbon from '../components/common/useErpPageRibbon';
import sharedClasses from '../styles/pages/ManagementShared.module.css';
import classes from '../styles/pages/CustomerSupport.module.css';

const initialPosts = [
  {
    id: 1,
    category: '공지사항',
    title: '스틸119 서비스 이용 안내',
    company: '관리자',
    manager: '관리자',
    phone: '',
    date: '2026-10-20',
    status: '공지',
    details: '스틸119 서비스 이용 안내입니다.',
    reply: '',
  },
  {
    id: 2,
    category: '시스템문의',
    title: '로그인 관련 문의',
    company: '대한철강 주식회사',
    manager: '김민수',
    phone: '010-1234-5678',
    date: '2026-10-19',
    status: '답변완료',
    details: '로그인 관련 문의 예시입니다.',
    reply: '문의 내용을 확인했습니다. 안내에 따라 다시 로그인해 주세요.',
  },
  {
    id: 3,
    category: '재고문의',
    title: '냉연강판 재고 문의',
    company: '모스코 주식회사',
    manager: '이서준',
    phone: '010-9876-5432',
    date: '2026-10-18',
    status: '답변대기',
    details: '냉연강판 0.8T × 914 × 1,829 규격의 현재고와 납기 가능 여부를 확인해 주세요.',
    reply: '',
  },
];

const categories = ['전체', '공지사항', '재고문의', '시스템문의', '기타문의'];

function maskCompany(value) {
  const name = String(value || '비공개 업체').trim();
  if (!name) return '비공개 업체';
  if (name.length === 1) return `${name}○`;
  if (name.length === 2) return `${name[0]}○`;
  return `${name[0]}${'○'.repeat(Math.min(name.length - 1, 4))}`;
}

function CategoryBadge({ value }) {
  const tone = {
    공지사항: classes.noticeBadge,
    재고문의: classes.stockBadge,
    시스템문의: classes.systemBadge,
    기타문의: classes.etcBadge,
  }[value] || '';
  return <span className={`${classes.badge} ${tone}`}>{value}</span>;
}

function StatusBadge({ value }) {
  const tone = value === '답변완료' ? classes.doneStatus : value === '답변대기' ? classes.pendingStatus : classes.noticeStatus;
  return <span className={`${classes.status} ${tone}`}>{value}</span>;
}

export default function CustomerSupport() {
  useErpPageRibbon({ showPrint: false, useSaveColor: false });
  const [posts, setPosts] = useState(initialPosts);
  const [category, setCategory] = useState('전체');
  const [searchInput, setSearchInput] = useState('');
  const [keyword, setKeyword] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [toast, setToast] = useState('');

  const selectedPost = posts.find((post) => post.id === selectedId) || null;
  const visiblePosts = useMemo(() => {
    const normalized = keyword.trim().toLowerCase();
    return posts.filter((post) => (category === '전체' || post.category === category)
      && [post.title, post.company].join(' ').toLowerCase().includes(normalized));
  }, [posts, category, keyword]);

  const notify = (message) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2800);
  };

  const openPost = (post) => {
    setSelectedId(post.id);
    setReplyDraft(post.reply || '');
  };

  const returnToList = () => {
    setSelectedId(null);
    setReplyDraft('');
  };

  const updateStatus = (status) => {
    if (!selectedPost) return;
    setPosts((current) => current.map((post) => post.id === selectedPost.id ? { ...post, status } : post));
    notify(status === '답변대기' ? '문의 상태를 답변대기로 변경했습니다.' : '상태를 변경했습니다.');
  };

  const saveReply = () => {
    const reply = replyDraft.trim();
    if (!reply) {
      notify('답변 내용을 입력해 주세요.');
      return;
    }
    setPosts((current) => current.map((post) => post.id === selectedPost.id
      ? { ...post, reply, status: '답변완료' }
      : post));
    setReplyDraft(reply);
    notify('답변이 저장되고 상태가 답변완료로 변경되었습니다.');
  };

  return <Box className={`${sharedClasses.pageShell} ${classes.pageRoot}`}>
    <main className={classes.page}>
      <ErpBreadcrumb parent="고객지원" current={selectedPost ? selectedPost.category : '상담게시판'} />
      {toast && <div className={classes.toast} role="status">{toast}</div>}

      <header className={classes.pageHeading}>
        <div><h1>고객지원</h1><p>공지사항과 고객 문의를 확인하고 관리할 수 있습니다.</p></div>
      </header>

      {!selectedPost ? <section className={classes.panel}>
        <div className={classes.tabs} role="tablist" aria-label="게시글 구분">
          {categories.map((item) => <button key={item} type="button" role="tab" aria-selected={category === item} className={category === item ? classes.activeTab : ''} onClick={() => { setCategory(item); setSelectedId(null); }}>{item}</button>)}
        </div>

        <div className={classes.toolbar}>
          <div className={classes.count}>전체 게시글 <strong>{visiblePosts.length}</strong>건</div>
          <div className={classes.toolbarActions}>
            <div className={classes.searchBox}><IconSearch size={15} /><input type="search" value={searchInput} placeholder="제목 또는 회사명 검색" onChange={(event) => setSearchInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') setKeyword(searchInput); }} /></div>
            <button type="button" className={classes.button} onClick={() => setKeyword(searchInput)}>검색</button>
            <button type="button" className={`${classes.button} ${classes.primaryButton}`} onClick={() => notify('글쓰기 기능은 실제 등록·저장 기능 연결 후 제공됩니다.')}>글쓰기</button>
          </div>
        </div>

        <div className={classes.tableScroll}>
          <table className={classes.boardTable}>
            <thead><tr><th>번호</th><th>구분</th><th>제목</th><th>회사명</th><th>작성일</th><th>상태</th></tr></thead>
            <tbody>{visiblePosts.length ? visiblePosts.map((post) => <tr key={post.id}>
              <td className={classes.center}>{post.id}</td>
              <td><CategoryBadge value={post.category} /></td>
              <td><button type="button" className={classes.titleButton} onClick={() => openPost(post)}>{post.title}</button></td>
              <td>{maskCompany(post.company)}</td><td>{post.date}</td><td><StatusBadge value={post.status} /></td>
            </tr>) : <tr><td colSpan="6" className={classes.empty}>등록된 게시글이 없습니다.</td></tr>}</tbody>
          </table>
        </div>
        <div className={classes.noticeBox}>회사명은 목록에서 마스킹해 표시합니다. 상세 정보는 담당자 권한을 확인한 뒤 표시해야 합니다.</div>
        <footer className={classes.panelFooter}>STEEL119 · 고객지원</footer>
      </section> : <section className={classes.panel}>
        <div className={classes.detailTop}>
          <div><h2>{selectedPost.title}</h2><div className={classes.meta}><CategoryBadge value={selectedPost.category} /><span>{selectedPost.date}</span><StatusBadge value={selectedPost.status} /></div></div>
          <button type="button" className={classes.button} onClick={returnToList}><IconArrowLeft size={15} />목록으로</button>
        </div>
        <div className={classes.detailBody}>
          <div className={classes.detailGrid}>
            <div><span>회사명</span><strong>{selectedPost.company || '미입력'}</strong></div>
            <div><span>담당자명</span><strong>{selectedPost.manager || '미입력'}</strong></div>
            <div><span>연락처</span><strong>{selectedPost.phone || '미입력'}</strong></div>
            <div><span>처리상태</span><StatusBadge value={selectedPost.status} /></div>
          </div>
          <section className={classes.inquirySection}><h3>문의 내용</h3><div className={classes.inquiryContent}>{selectedPost.details || '문의 내용이 없습니다.'}</div></section>
          <p className={classes.privacyNote}>상세 화면의 전체 회사명, 담당자명 및 연락처 표시는 향후 사용자 권한 검사가 필요한 항목입니다.</p>
          <section className={classes.replySection}>
            <h3>답변 작성</h3>
            <textarea value={replyDraft} placeholder="문의에 대한 답변을 입력하세요." onChange={(event) => setReplyDraft(event.target.value)} />
            {selectedPost.reply && <div className={classes.savedReply}><strong>저장된 답변</strong><p>{selectedPost.reply}</p></div>}
          </section>
        </div>
        <footer className={classes.detailActions}>
          <button type="button" className={classes.button} onClick={returnToList}>목록으로</button>
          <div><button type="button" className={classes.button} onClick={() => updateStatus('답변대기')}>답변 대기로 변경</button><button type="button" className={`${classes.button} ${classes.primaryButton}`} onClick={saveReply}>{selectedPost.status === '답변완료' ? '답변 수정 및 저장' : '답변 저장 및 완료 처리'}</button></div>
        </footer>
      </section>}
    </main>
  </Box>;
}
