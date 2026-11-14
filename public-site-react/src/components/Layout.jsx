import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import Logo from './Logo';
import Lightbox from './Lightbox';
import { PendingLink } from './Toast';
import { useReveal } from '../hooks';

const KAKAO_PENDING = '카카오톡 채널 주소는 등록 후 연결됩니다.';

// 머리말 메뉴. current 는 지금 페이지에서 강조할 메뉴 (페이지 주소로 정한다)
const GNB = [
  { to: '/company', label: '회사소개', page: '/company' },
  { to: '/company#products', label: '철강 자재' },
  { to: '/inquiry', label: '발주 문의', page: '/inquiry' },
  { to: '/erp', label: <>AI ERP <sup>NEW</sup></>, page: '/erp' },
  { to: '/erp#pricing', label: '요금 안내' },
];

function Header({ pathname }) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const linkRefs = useRef([]);
  const [ink, setInk] = useState({ opacity: 0 });
  const currentIndex = GNB.findIndex((item) => item.page === pathname);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // 모바일 메뉴: CSS 가 body.menu-open 을 보고 펼친다
  useEffect(() => {
    document.body.classList.toggle('menu-open', menuOpen);
  }, [menuOpen]);
  const closeMenu = () => setMenuOpen(false);
  const [menuPath, setMenuPath] = useState(pathname);
  if (menuPath !== pathname) { setMenuPath(pathname); setMenuOpen(false); }

  // 메뉴 밑을 따라다니는 배경 (마우스를 올린 메뉴 → 벗어나면 현재 페이지 메뉴)
  const moveTo = useCallback((index) => {
    const a = linkRefs.current[index];
    if (!a) { setInk({ opacity: 0 }); return; }
    setInk({ opacity: 1, width: `${a.offsetWidth}px`, transform: `translateX(${a.offsetLeft}px)` });
  }, []);
  useLayoutEffect(() => {
    moveTo(currentIndex);
    // 글꼴을 다 받으면 메뉴 폭이 바뀌므로 한 번 더 맞춘다
    document.fonts?.ready.then(() => moveTo(currentIndex));
  }, [currentIndex, moveTo]);

  return (
    <header className={`hd${scrolled ? ' is-scrolled' : ''}`}>
      <div className="wrap hd-inner">
        <Logo />
        <nav className="gnb" id="gnb" aria-label="주요 메뉴" onMouseLeave={() => moveTo(currentIndex)}>
          <span className="gnb-ink" aria-hidden="true" style={ink} />
          {GNB.map((item, i) => (
            <Link
              key={item.to}
              to={item.to}
              ref={(el) => { linkRefs.current[i] = el; }}
              aria-current={i === currentIndex ? 'page' : undefined}
              onMouseEnter={() => moveTo(i)}
              onClick={closeMenu}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="hd-actions">
          <PendingLink className="hbtn hbtn-line" msg="ERP 접속 주소는 확정 후 연결됩니다." onClickCapture={closeMenu}>
            <svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>ERP 로그인
          </PendingLink>
          <Link className="hbtn hbtn-solid" to="/inquiry" onClick={closeMenu}>발주 문의<span className="ar">→</span></Link>
        </div>
        <button
          className="menu-btn"
          type="button"
          aria-label={menuOpen ? '메뉴 닫기' : '메뉴 열기'}
          aria-expanded={menuOpen}
          aria-controls="gnb"
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span /><span /><span />
        </button>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="ft">
      <div className="wrap">
        <div className="ft-top">
          <Logo dark />
          <dl><dt>상호</dt><dd>(주)모스코 · 브랜드 스틸119</dd><dt>주소</dt><dd>주소 표기 영역</dd><dt>사업자등록번호</dt><dd>표기 영역 · 대표자 표기 영역</dd></dl>
          <div>
            <nav className="ft-nav" aria-label="하단 메뉴">
              <Link to="/company">회사소개</Link>
              <Link to="/erp">AI ERP</Link>
              <Link to="/inquiry">발주 문의</Link>
              <PendingLink msg="이용약관은 준비 중입니다.">이용약관</PendingLink>
              <PendingLink msg="개인정보처리방침은 준비 중입니다.">개인정보처리방침</PendingLink>
            </nav>
            <div className="ft-call"><small>고객센터</small><a href="tel:16002579">1600-2579</a></div>
          </div>
        </div>
        <p className="ft-bottom">© STEEL119. All rights reserved.</p>
      </div>
    </footer>
  );
}

function Fab() {
  const [showTop, setShowTop] = useState(false);
  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 600);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <div className="fab">
      <PendingLink className="k" msg={KAKAO_PENDING} aria-label="카카오톡 상담">
        <span style={{ display: 'grid', placeItems: 'center' }}>
          <svg viewBox="0 0 24 24"><path d="M12 3C6.5 3 2 6.6 2 11c0 2.8 1.9 5.3 4.7 6.7L5.7 21l4-2.6c.7.1 1.5.2 2.3.2 5.5 0 10-3.6 10-8S17.5 3 12 3z" /></svg>상담
        </span>
      </PendingLink>
      <button className={`top${showTop ? ' is-show' : ''}`} type="button" aria-label="맨 위로" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>TOP</button>
    </div>
  );
}

// 페이지 이동 시: 주소에 #이 있으면 그 위치로, 없으면 맨 위로
function useScrollOnNavigate(pathname, hash) {
  useLayoutEffect(() => {
    if (hash) {
      const el = document.getElementById(decodeURIComponent(hash.slice(1)));
      if (el) { el.scrollIntoView(); return; }
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [pathname, hash]);
}

export default function Layout() {
  const { pathname, hash } = useLocation();
  const mainRef = useRef(null);
  useScrollOnNavigate(pathname, hash);
  useReveal(mainRef, pathname);

  return (
    <>
      <a className="skip" href="#main">본문으로 건너뛰기</a>
      <div className="topbar">
        <div className="wrap topbar-inner">
          <p><i />소량 철강 자재 · 재고 확인부터 출고까지</p>
          <div><a href="tel:16002579">고객센터 <b>1600-2579</b></a><PendingLink msg={KAKAO_PENDING}>카카오톡 상담</PendingLink></div>
        </div>
      </div>
      <Header pathname={pathname} />
      <main id="main" ref={mainRef}>
        <Outlet />
      </main>
      <Footer />
      <Fab />
      <Lightbox />
    </>
  );
}
