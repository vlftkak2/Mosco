
import { AppShell, Burger, Text, Box, Modal, PasswordInput, Menu } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { SidebarNav } from './MainLayoutLink';
import classes from '../../styles/layout/MainLayout.module.css';
import { Suspense, createContext, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation, useOutlet, UNSAFE_LocationContext as LocationContext } from 'react-router-dom';
import { clearAIOrderPageSession } from '../../pages/ai/AIOrderPageSession';
import { clearAIOrderDraft } from '../../pages/ai/AIOrderDraft';
import {
  IconAdjustmentsHorizontal, IconBox, IconChevronDown, IconClipboardText, IconCreditCard, IconHome, IconKey, IconLayoutSidebar, IconLogout,
  IconBell, IconMoon, IconSearch, IconShieldLock, IconShoppingBag, IconStack2, IconTrendingUp, IconUserCircle, IconUsers,
} from '@tabler/icons-react';
import '@mantine/notifications/styles.css';
import { notifications } from '@mantine/notifications';
import axios from 'axios'; // axios 추가
import { IconCheck, IconX } from '@tabler/icons-react'; // 아이콘 추가
import Steel119Logo from './Steel119Logo';

export const PageRibbonContext = createContext(null);

// 열린 탭의 화면을 계속 띄워 두고(숨김만) 탭마다 리본을 따로 보관한다 → 탭을 옮겨도 화면 상태가 그대로.
// 탭을 닫을 때만 화면이 지워진다.
// 탭이 지금 보이는지 (숨었다가 다시 보이면 화면이 최신 데이터를 다시 불러올 수 있게)
export const PageActiveContext = createContext(true);
// 탭이 화면에 다시 나타난 횟수 (처음 열 때 1, 다른 탭에 갔다 돌아올 때마다 +1)
export const PageActivationContext = createContext(0);

const KeepAlivePage = memo(function KeepAlivePage({ path, active, activation, element, setRibbons, closeTabRef }) {
  const ribbonContext = useMemo(() => ({
    registerPageRibbon: (content) => setRibbons((current) => ({ ...current, [path]: content })),
    closeActivePage: () => closeTabRef.current?.(null, path),
  }), [path, setRibbons, closeTabRef]);
  // 숨은 탭에는 마지막으로 보였을 때의 주소를 그대로 준다. useNavigate · useLocation 은 주소가 바뀔 때마다 다시 그려지므로,
  // 그대로 두면 열린 탭 전체가(숨어 있어도) 탭을 옮길 때마다 다시 그려져 이동이 느려진다.
  const liveLocation = useContext(LocationContext);
  const [tabLocation, setTabLocation] = useState(liveLocation);
  if (active && tabLocation !== liveLocation) setTabLocation(liveLocation);
  return <div style={{ display: active ? 'contents' : 'none' }} data-tab-path={path} aria-hidden={active ? undefined : true}>
    <LocationContext.Provider value={active ? liveLocation : tabLocation}>
      <PageActiveContext.Provider value={active}>
        <PageActivationContext.Provider value={activation}>
          <PageRibbonContext.Provider value={ribbonContext}><Suspense fallback={null}>{element}</Suspense></PageRibbonContext.Provider>
        </PageActivationContext.Provider>
      </PageActiveContext.Provider>
    </LocationContext.Provider>
  </div>;
});
export const MenuAccessContext = createContext({ menuids: [], loaded: false, authority: 'USER', fallbackPath: null });

// 메뉴 구성: 대메뉴 > 화면 (네비 디자인 최종 시안 기준, 소제목 없음). 대시보드는 하위 없이 바로 열린다.
// 이름을 바꾸면 backend/sql/menu_catalog_seed.sql 의 menuname 도 같이 맞춘다.
const ic = { size: 20, stroke: 1.5 };
// 어드민: 시안과 같은 방패 + 체크 (Tabler 기본 방패보다 둥근 모양, 선 굵게)
const AdminShieldIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 2.8C9.7 4.8 6.8 5.5 4 6v5.5c0 4.6 3.2 8.2 8 10 4.8-1.8 8-5.4 8-10V6c-2.8-.5-5.7-1.2-8-3.2Z" />
    <path d="m8.4 12 2.4 2.4 4.8-5" />
  </svg>
);
const mockdata = [
  { label: '대시보드', icon: <IconHome {...ic} />, link: '/HomePage', MenuID: 'HOME' },
  {
    label: '매입관리',
    icon: <IconShoppingBag {...ic} />,
    links: [
      { label: '매입등록', link: '/InboundRegisterPage', MenuID: 'INBOUND_REGISTER' },
      { label: '매입현황', link: '/InboundSearchPage', MenuID: 'INBOUND_SEARCH' },
    ],
  },
  {
    label: '매출관리',
    icon: <IconTrendingUp {...ic} />,
    links: [
      { label: '매출등록', link: '/OutboundRegisterPage', MenuID: 'OUTBOUND_REGISTER' },
      { label: '매출현황', link: '/OutboundSearchPage', MenuID: 'OUTBOUND_SEARCH' },
      { label: '매출이익분석', link: '/GrossProfit', MenuID: 'GROSS_PROFIT' },
      { label: '매출이익요약', link: '/GrossProfitDashboard', MenuID: 'GROSS_PROFIT_DASHBOARD' },
    ],
  },
  {
    label: '재고관리',
    icon: <IconBox {...ic} />,
    links: [
      { label: '기초재고등록', link: '/StockStandPage', MenuID: 'STOCK_INITIAL' },
      { label: '현재고현황', link: '/CurrentStockPage', MenuID: 'STOCK_CURRENT' },
      { label: '재고수불현황', link: '/IniopStockPage', MenuID: 'STOCK_HISTORY' },
      { label: '재고이동등록', link: '/InoutmoveRegister', MenuID: 'INOUTMOVE_REGISTER' },
      { label: '재고이동현황', link: '/InoutmoveSearch', MenuID: 'INOUTMOVE_SEARCH' },
    ],
  },
  {
    label: '가공관리',
    icon: <IconStack2 {...ic} />,
    links: [
      { label: 'AI 주문서인식', link: '/AIOrderPage', MenuID: 'AI_ORDER_RECOGNITION' },
      { label: '가공주문관리', link: '/AIOrderManage', MenuID: 'AI_ORDER_MANAGEMENT' },
      { label: '가공최적화', link: '/AIOrderOptimization', MenuID: 'AI_OPTIMIZATION' },
      { label: '가공공정관리', link: '/ItemProcessMaster', MenuID: 'ITEM_PROCESS_MASTER' },
      { label: '재고가공등록', link: '/ItemProcessRegister', MenuID: 'ITEM_PROCESS_REGISTER' },
      { label: '재고가공현황', link: '/ItemProcessSearch', MenuID: 'ITEM_PROCESS_SEARCH' },
    ],
  },
  {
    label: '거래처관리',
    icon: <IconUsers {...ic} />,
    links: [
      { label: '거래처등록', link: '/CustomerPage', MenuID: 'DATA_CUSTOMER' },
      { label: '거래처원장', link: '/CustomerLedger', MenuID: 'CUSTOMER_LEDGER' },
      { label: '채권채무요약', link: '/CustomerBalanceDashboard', MenuID: 'CUSTOMER_BALANCE_DASHBOARD' },
    ],
  },
  {
    label: '자금관리',
    icon: <IconCreditCard {...ic} />,
    links: [
      { label: '수금/지급등록', link: '/ReceiptPayment', MenuID: 'RECEIPT_PAYMENT' },
      { label: '수금/지급현황', link: '/ReceiptPaymentSearch', MenuID: 'RECEIPT_PAYMENT_SEARCH' },
      { label: '수표/어음관리', link: '/InstrumentStatus', MenuID: 'INSTRUMENT_STATUS' },
    ],
  },
  {
    label: '기준정보',
    icon: <IconAdjustmentsHorizontal {...ic} />,
    links: [
      { label: '공통코드관리', link: '/CodeMasterPage', MenuID: 'DATA_CODE' },
      { label: '품목코드관리', link: '/ItemMasterPage', MenuID: 'DATA_ITEM' },
      { label: '사업장관리', link: '/Workplace', MenuID: 'WORKPLACE_MANAGEMENT' },
      { label: '월마감관리', link: '/MonthClose', MenuID: 'MONTH_CLOSING' },
      { label: '직원관리', link: '/UserInfo', MenuID: 'USER_MANAGEMENT' },
      { label: '통제관리', link: '/ControlManagement' },
    ],
  },
  {
    label: '게시판',
    icon: <IconClipboardText {...ic} />,
    links: [
      { label: '상담게시판', link: '/CustomerSupport', MenuID: 'CUSTOMER_SUPPORT' },
    ],
  },
  {
    label: '어드민',
    icon: <AdminShieldIcon />,
    links: [
      { label: '고객사등록', link: '/Company', MenuID: 'COMPANY_REGISTRATION' },
      { label: '고객계정관리', link: '/User', MenuID: 'COMPANY_USER_MANAGEMENT' },
      { label: '메뉴권한관리', link: '/UserMenu', MenuID: 'USER_MENU_PERMISSION' },
      { label: '라이선스 매출현황', link: '/LicenseRevenue', MenuID: 'LICENSE_REVENUE' },
      { label: '타사 재고현황', link: '/SharedStock', MenuID: 'SHARED_STOCK' },
    ],
  },
];

// 메뉴 트리에서 실제 화면(link 가 있는 항목)만 펼친다
const flattenMenuLinks = (items) => items.flatMap((item) => (item.links ? flattenMenuLinks(item.links) : [item]));

function findMenuLabel(items, path) {
  const normalizePath = (value) => String(value || '').replace(/\/+$/, '').toLowerCase() || '/';
  const normalizedPath = normalizePath(path);
  const canonicalPath = normalizedPath === '/inboundregister'
    ? '/inboundregisterpage'
    : normalizedPath;
  // 예전 주소로 들어와도 같은 메뉴 이름을 보여준다
  const routeLabelAliases = {
    '/inboundregister': '매입등록',
    '/inboundsearch': '매입현황',
    '/board': '상담게시판',
  };


  if (routeLabelAliases[normalizedPath]) return routeLabelAliases[normalizedPath];

  // 하위 섹션까지 내려가며 찾는다. 못 찾으면 '' (경로를 돌려주면 첫 섹션에서 바로 끝나 버린다)
  const found = flattenMenuLinks(items)
    .find((item) => item.link && normalizePath(item.link) === canonicalPath);
  if (found) return found.label;
  return canonicalPath === '/homepage' ? '대시보드' : path;
}

const isHomePath = (path) => String(path || '').replace(/\/+$/, '').toLowerCase() === '/homepage';

export default function MainLayout({ children }) {
  const [opened, { toggle }] = useDisclosure();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem('steel119-sidebar-collapsed') === 'Y';
    } catch {
      return false;
    }
  });
  const [pwModalOpened, { open: openPwModal, close: closePwModal }] = useDisclosure(false);
  // 네비 · 헤더 색: 다크(기본) / 라이트 (이 브라우저에 기억)
  const [navTheme, setNavTheme] = useState(() => {
    try { return localStorage.getItem('steel119-nav-theme') === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
  });
  const toggleNavTheme = () => setNavTheme((current) => {
    const next = current === 'light' ? 'dark' : 'light';
    try { localStorage.setItem('steel119-nav-theme', next); } catch { /* 기억 못 해도 지금 화면은 바뀐다 */ }
    return next;
  });
  // 메뉴 검색 (헤더 검색칸 → 왼쪽 메뉴를 거름, Ctrl+K 로 바로 이동)
  const [menuQuery, setMenuQuery] = useState('');
  const menuSearchRef = useRef(null);
  useEffect(() => {
    const onKey = (event) => {
      if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === 'k') {
        event.preventDefault();
        menuSearchRef.current?.focus();
        menuSearchRef.current?.select();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const [pwdForm, setPwdForm] = useState({
    current: '',
    next: '',
    confirm: ''
  });

  const navigate = useNavigate();
  const setSidebarCollapsedSaved = useCallback((next) => {
    setSidebarCollapsed(next);
    try {
      localStorage.setItem('steel119-sidebar-collapsed', next ? 'Y' : 'N');
    } catch {
      // Ignore storage errors; the current page can still toggle the sidebar.
    }
  }, []);
  const toggleSidebar = () => setSidebarCollapsedSaved(!sidebarCollapsed);
  const expandSidebar = useCallback(() => setSidebarCollapsedSaved(false), [setSidebarCollapsedSaved]);
  const location = useLocation();
  const { pathname } = location; // 2. 현재 경로 가져오기
  const outlet = useOutlet();
  const isDashboard = String(pathname || '').replace(/\/+$/, '').toLowerCase() === '/homepage';
  const isInboundWorkspace = [
    '/inboundregisterpage', '/inboundregister', '/inboundsearchpage', '/inboundsearch',
    '/customerpage', '/itemmasterpage', '/codemasterpage', '/aiorderpage',
    '/currentstockpage', '/iniopstockpage', '/stockstandpage', '/aiordermanage', '/aiorderoptimization', '/itemprocessmaster', '/itemprocessregister', '/itemprocesssearch', '/customersupport', '/board',
    '/outboundregisterpage', '/outboundsearchpage', '/inoutmoveregister', '/inoutmovesearch', '/receiptpayment', '/receiptpaymentsearch', '/instrumentstatus', '/customerledger', '/customerbalancedashboard', '/grossprofit', '/grossprofitdashboard', '/company', '/licenserevenue', '/sharedstock', '/user', '/usermenu', '/workplace', '/monthclose', '/userinfo', '/controlmanagement',
  ].includes(String(pathname || '').replace(/\/+$/, '').toLowerCase());
  // 탭별 화면 / 리본 보관 (key = 경로)
  const [pageCache, setPageCache] = useState({});
  const [ribbons, setRibbons] = useState({});
  const [activations, setActivations] = useState(() => ({ [pathname]: 1 }));
  const [tabState, setTabState] = useState(() => ({
    pathname,
    tabs: [{ path: pathname, label: findMenuLabel(mockdata, pathname) }],
  }));
  if (pathname !== tabState.pathname) {
    setActivations((current) => ({ ...current, [pathname]: (current[pathname] || 0) + 1 }));
    const tab = { path: pathname, label: findMenuLabel(mockdata, pathname) };
    const tabs = tabState.tabs.some((item) => item.path === tab.path)
      ? tabState.tabs
      : [...tabState.tabs, tab];
    setTabState({ pathname, tabs });
  }
  const pageTabs = tabState.tabs;
  // 대시보드는 왼쪽 고정 홈 버튼으로 열고, 업무 탭 줄에는 나머지 화면만 둔다
  const workTabs = useMemo(() => pageTabs.filter((tab) => !isHomePath(tab.path)), [pageTabs]);
  const visiblePageTabs = useMemo(() => {
    const maxVisible = 10;
    if (workTabs.length <= maxVisible) return workTabs;
    const initialTabs = workTabs.slice(0, maxVisible);
    if (initialTabs.some((tab) => tab.path === pathname)) return initialTabs;
    return [...workTabs.slice(0, maxVisible - 1), workTabs.find((tab) => tab.path === pathname)].filter(Boolean);
  }, [workTabs, pathname]);
  const overflowPageTabs = useMemo(
    () => workTabs.filter((tab) => !visiblePageTabs.some((visibleTab) => visibleTab.path === tab.path)),
    [workTabs, visiblePageTabs],
  );
  // 탭 끌어서 순서 바꾸기: 끄는 동안 지나가는 탭 자리로 바로 옮긴다
  const dragTabRef = useRef(null);
  const [draggingTab, setDraggingTab] = useState(null);
  const moveDraggedTab = (event, targetPath) => {
    const dragged = dragTabRef.current;
    if (!dragged) return;
    event.preventDefault();
    if (dragged === targetPath) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const after = event.clientX > rect.left + rect.width / 2;
    setTabState((current) => {
      const tabs = current.tabs.filter((tab) => tab.path !== dragged);
      const moving = current.tabs.find((tab) => tab.path === dragged);
      let index = tabs.findIndex((tab) => tab.path === targetPath);
      if (!moving || index < 0) return current;
      if (after) index += 1;
      tabs.splice(index, 0, moving);
      const same = tabs.every((tab, i) => tab.path === current.tabs[i].path);
      return same ? current : { ...current, tabs };
    });
  };

  const closePageTab = useCallback((event, path) => {
    event?.stopPropagation?.();
    if (String(path || '').replace(/\/+$/, '').toLowerCase() === '/aiorderpage') {
      clearAIOrderPageSession();
    }
    // 주문서 관리 탭을 닫으면 저장 전 주문도 버린다 (탭이 열려 있는 동안은 다른 화면에 다녀와도 유지)
    if (String(path || '').replace(/\/+$/, '').toLowerCase() === '/aiordermanage') {
      clearAIOrderDraft();
    }
    const remaining = pageTabs.filter((tab) => tab.path !== path);
    if (!remaining.length) remaining.push({ path: '/HomePage', label: findMenuLabel(mockdata, '/HomePage') });
    setTabState({ pathname, tabs: remaining });
    // 닫은 탭의 화면과 리본을 지운다 (다시 열면 처음 상태로 시작)
    setPageCache((current) => { const next = { ...current }; delete next[path]; return next; });
    setRibbons((current) => { const next = { ...current }; delete next[path]; return next; });
    if (pathname === path) navigate(remaining[remaining.length - 1].path);
  }, [pageTabs, pathname, navigate]);
  // 탭 모두 닫기: 대시보드만 남기고 나머지 화면과 리본을 지운다 (각 탭을 닫을 때와 같은 정리)
  const closeAllTabs = useCallback(() => {
    const paths = pageTabs.map((tab) => String(tab.path || '').replace(/\/+$/, '').toLowerCase());
    if (paths.includes('/aiorderpage')) clearAIOrderPageSession();
    if (paths.includes('/aiordermanage')) clearAIOrderDraft();
    const home = pageTabs.find((tab) => isHomePath(tab.path)) || { path: '/HomePage', label: findMenuLabel(mockdata, '/HomePage') };
    setTabState({ pathname, tabs: [home] });
    setPageCache((current) => (current[home.path] ? { [home.path]: current[home.path] } : {}));
    setRibbons((current) => (current[home.path] ? { [home.path]: current[home.path] } : {}));
    if (!isHomePath(pathname)) navigate(home.path);
  }, [pageTabs, pathname, navigate]);
  // 화면별 리본의 [닫기]가 항상 최신 closePageTab 을 쓰도록
  const closeTabRef = useRef(closePageTab);
  useLayoutEffect(() => { closeTabRef.current = closePageTab; }, [closePageTab]);

  // 승인 통제: 사용 여부 · 승인자 여부 · 대기 건수 (헤더 알림 · 통제관리 메뉴 표시)
  const [controlSummary, setControlSummary] = useState(null);
  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) return undefined;
    let alive = true;
    const loadControl = () => axios.get('/api/control/summary', { headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } })
      .then(({ data }) => { if (alive) setControlSummary(data); })
      .catch(() => { /* 알림만 못 보여 줌 */ });
    void loadControl();
    const onVisible = () => { if (document.visibilityState === 'visible') void loadControl(); };
    window.addEventListener('approval-changed', loadControl);
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(() => { void loadControl(); }, 60 * 1000);
    return () => {
      alive = false;
      window.removeEventListener('approval-changed', loadControl);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, []);

  const [myPermissions, setMyPermissions] = useState([]);
  const [myPermissionsLoaded, setMyPermissionsLoaded] = useState(false);
  const [currentAuthority, setCurrentAuthority] = useState(() =>
    String(localStorage.getItem('user_authority') || 'USER').toUpperCase()
  );
  const [currentCompanyId, setCurrentCompanyId] = useState(() =>
    String(localStorage.getItem('user_company') || '')
  );

  const [userInfo] = useState(() => ({
    // 초기값이 있으면 그 값을 사용하고, 없으면 빈 문자열
    name: localStorage.getItem('user_name') || '',
    email: localStorage.getItem('user_email') || '',
    companyname: localStorage.getItem('user_companyname') || '',
  }));

  // 메뉴 즐겨찾기 (사용자별, 서버 usermenufavorite01t 에 저장). 첫 화면을 바로 그리려고 이 브라우저에도 사본을 둔다.
  const favoriteCacheKey = `steel119-menu-favorites:${localStorage.getItem('user_company') || ''}:${userInfo.email}`.toLowerCase();
  const [favoriteIds, setFavoriteIds] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(favoriteCacheKey) || '[]');
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  });
  const favoriteIdsRef = useRef(favoriteIds);
  const applyFavorites = useCallback((next) => {
    favoriteIdsRef.current = next;
    setFavoriteIds(next);
    try { localStorage.setItem(favoriteCacheKey, JSON.stringify(next)); } catch { /* 저장 공간을 못 쓰면 화면 상태만 유지 */ }
  }, [favoriteCacheKey]);
  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token || !userInfo.email) return undefined;
    let cancelled = false;
    axios.get('/api/user-menu/favorites', { headers: { Authorization: `Bearer ${token}` } })
      .then(({ data }) => { if (!cancelled && Array.isArray(data.menuids)) applyFavorites(data.menuids); })
      .catch((error) => console.error('메뉴 즐겨찾기 조회 실패:', error));
    return () => { cancelled = true; };
  }, [applyFavorites, userInfo.email]);
  const saveFavorites = useCallback((next) => {
    const previous = favoriteIdsRef.current;
    applyFavorites(next);
    axios.put('/api/user-menu/favorites', { menuids: next }, {
      headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` },
    }).catch((error) => {
      console.error('메뉴 즐겨찾기 저장 실패:', error);
      if (favoriteIdsRef.current === next) applyFavorites(previous);
      notifications.show({ title: '즐겨찾기 저장 실패', message: '잠시 후 다시 시도해 주세요.', color: 'red', position: 'bottom-right' });
    });
  }, [applyFavorites]);
  const toggleFavorite = useCallback((menuid) => {
    const previous = favoriteIdsRef.current;
    saveFavorites(previous.includes(menuid) ? previous.filter((id) => id !== menuid) : [...previous, menuid]);
  }, [saveFavorites]);
  // 즐겨찾기 순서 변경: 화면에 보이는 순서 + (권한이 빠져 안 보이는 즐겨찾기는 뒤에 그대로)
  const reorderFavorites = useCallback((visibleOrder) => {
    const rest = favoriteIdsRef.current.filter((id) => !visibleOrder.includes(id));
    saveFavorites([...visibleOrder, ...rest]);
  }, [saveFavorites]);

  // 내 메뉴 권한 다시 읽기: 화면 이동마다 읽지 않고(이동이 느려짐), 창으로 돌아올 때와 권한 저장 직후에만 읽는다.
  // (권한이 빠진 메뉴는 서버가 403 으로 막으므로 다음 확인 때까지 화면에 남아 있어도 안전하다)
  const [permissionsVersion, setPermissionsVersion] = useState(0);
  // navigate 는 주소가 바뀔 때마다 새로 만들어지므로, 아래 권한 읽기가 이동마다 다시 돌지 않게 ref 로 쓴다
  const navigateRef = useRef(navigate);
  useEffect(() => { navigateRef.current = navigate; }, [navigate]);
  useEffect(() => {
    const refresh = () => setPermissionsVersion((value) => value + 1);
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('menu-permissions-changed', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('menu-permissions-changed', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const token = localStorage.getItem('access_token');
    if (!token || !userInfo.email) {
      return undefined;
    }

    axios.get('/api/user-menu/mine', {
      headers: { Authorization: `Bearer ${token}` },
    }).then(({ data }) => {
      if (!cancelled) {
        const nextMenuids = data.menuids || [];
        // 바뀐 게 없으면 같은 배열을 유지해 메뉴 전체를 다시 그리지 않는다
        setMyPermissions((current) => (current.length === nextMenuids.length && current.every((id, index) => id === nextMenuids[index]) ? current : nextMenuids));
        const authority = String(data.authority || 'USER').toUpperCase();
        setCurrentAuthority(authority);
        localStorage.setItem('user_authority', authority);
        setCurrentCompanyId(String(data.companyid || ''));
        localStorage.setItem('user_company', String(data.companyid || ''));
        if (data.username) localStorage.setItem('user_name', data.username);
        if (data.companyname) localStorage.setItem('user_companyname', data.companyname);
        setMyPermissionsLoaded(true);
      }
    }).catch((error) => {
      console.error('사용자 메뉴 권한 조회 실패:', error);
      if (!cancelled) {
        setMyPermissions([]);
        setMyPermissionsLoaded(true);
        if (error.response?.status === 401) {
          setCurrentAuthority('USER');
          setCurrentCompanyId('');
          ['access_token', 'user_name', 'user_email', 'user_company', 'user_companyname', 'user_authority']
            .forEach((key) => localStorage.removeItem(key));
          navigateRef.current('/login', { replace: true });
        }
      }
    });

    return () => { cancelled = true; };
  }, [permissionsVersion, userInfo.email]);

// 1. 함수 앞에 async를 붙입니다.
const handlePasswordChange = async (e) => {
    e.preventDefault();

    const company = localStorage.getItem('user_company');
    if (!company) {
      notifications.show({
        title: '로그인 정보 갱신 필요',
        message: '회사 정보가 없습니다. 로그아웃한 뒤 다시 로그인해 주세요.',
        color: 'orange',
        position: 'bottom-right',
      });
      return;
    }

    // [로직 추가] 새 비밀번호와 확인용 비밀번호가 일치하는지 프론트에서 먼저 체크
    if (pwdForm.next !== pwdForm.confirm) {
      notifications.show({
        title: '입력 오류',
        message: '새 비밀번호가 일치하지 않습니다.',
        color: '#e62222ff',
        position: 'bottom-right'
      });
      return;
    }

    try {
      const res = await axios.post('/passwordapi/change-password', {
        password: pwdForm.current,    // 사용자가 입력한 현재 비번
        changepassword: pwdForm.next  // 사용자가 입력한 새 비번
      }, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('access_token') || ''}`,
        },
      });

      if (res.data.success === false) {
        notifications.show({
          title: '변경 실패',
          message: res.data.message, // "기존 비밀번호가 일치하지 않습니다" 출력
          color: '#e62222ff',
          icon: <IconX size={18} />,
          position: 'bottom-right',
        });
        return; // 여기서 중단
      }

      // 최종 성공 시
      notifications.show({
        title: '변경 완료 🔐',
        message: '비밀번호 변경 완료!',
        color: 'teal',
        icon: <IconCheck size={18} />,
        position: 'bottom-right',
        autoClose: 3000,
      });
      closePwModal();
      setPwdForm({ current: '', next: '', confirm: '' });
      
    } catch (error) {
      console.error('비밀번호 변경 요청 실패:', error);
      const detail = error.response?.data?.detail;
      const errorDetail = Array.isArray(detail)
        ? detail.map((item) => item.msg).join(', ')
        : detail || error.response?.data?.message || error.message || '비밀번호 변경 실패';
      notifications.show({
        title: '변경 실패',
        message: errorDetail,
        color: '#e62222ff',
        icon: <IconX size={18} />,
        position: 'bottom-right',
      });
    }
  };

  // 3. 페이지 이동 시 스크롤 최상단 이동 로직
  useEffect(() => {
    window.scrollTo(0, 0);
    // 만약 특정 컨테이너 내부 스크롤이라면 아래 코드 사용
    // const contentElement = document.querySelector(`.${classes.contentCard}`);
    // if (contentElement) contentElement.scrollTop = 0;
  }, [pathname]);

  useEffect(() => {
    if (!userInfo.name || !userInfo.email) {
      navigate('/');
    }
  }, [userInfo, navigate]);

  const handleLogout = () =>{
    clearAIOrderPageSession();
    clearAIOrderDraft();
    ['access_token', 'user_name', 'user_email', 'user_company', 'user_companyname', 'user_authority']
      .forEach((key) => localStorage.removeItem(key));
    navigate('/login');
  }


const isPlatformMaster = currentCompanyId === '001' && currentAuthority === 'MASTER';
const canSeeMenu = (link) => {
  // 고객사등록 · 라이선스 매출현황: 플랫폼 운영사(001 MASTER)만
  if (link.link === '/Company' || link.link === '/LicenseRevenue') return isPlatformMaster;
  // 타사 재고현황: 모스코(001) 계정이면 권한과 상관없이, 다른 고객사는 숨김
  if (link.link === '/SharedStock') return currentCompanyId === '001';
  // 통제관리: 고객사에 승인 통제가 허용된 경우 모든 직원 (승인함 · 설정 탭은 화면에서 역할별로)
  if (link.link === '/ControlManagement') return Boolean(controlSummary?.enabled);
  // 고객사관리 · 고객사 메뉴권한: 플랫폼 관리자(001 MASTER)와 고객사 관리자(001 이외 SUBMASTER)만 (서버 규칙과 같게)
  if (link.link === '/User' || link.link === '/UserMenu') return isPlatformMaster || (currentAuthority === 'SUBMASTER' && currentCompanyId !== '001');
  // 사용자관리: 관리자(고객사 관리자 · 플랫폼 관리자)는 항상, 그 밖에는 메뉴 권한을 받은 계정만
  if (link.link === '/UserInfo' && (currentAuthority === 'SUBMASTER' && currentCompanyId !== '001')) return true;
  if (isPlatformMaster) return true;
  return !link.MenuID || myPermissions.includes(link.MenuID);
};
// 화면이 아직 없는 메뉴(disabled)는 비활성으로 보인다. 섹션은 비활성 메뉴만 있어도 보이지만,
// 대메뉴는 실제로 열 수 있는 화면이 하나도 없으면 숨긴다 (예: 권한 없는 사용자의 어드민).
const hasEnabledLink = (item) => (item.links ? item.links.some(hasEnabledLink) : !item.disabled);
const filterMenu = (items, depth = 0) => items
  .map((item) => (item.links ? { ...item, links: filterMenu(item.links, depth + 1) } : item))
  .filter((item) => {
    if (!item.links) return item.disabled || canSeeMenu(item);
    return depth === 0 ? item.links.some(hasEnabledLink) : item.links.length > 0;
  });
const visibleMockdata = filterMenu(mockdata);

const firstAccessiblePath = flattenMenuLinks(visibleMockdata)
  .find((item) => item.link && item.link !== '/HomePage')?.link;
const noAccessibleMenus = !isPlatformMaster
  && myPermissionsLoaded
  && !myPermissions.includes('HOME')
  && !firstAccessiblePath;

useEffect(() => {
  if (!isDashboard || isPlatformMaster || !myPermissionsLoaded || myPermissions.includes('HOME')) return;
  if (firstAccessiblePath) {
    navigate(firstAccessiblePath, { replace: true });
  }
}, [currentAuthority, firstAccessiblePath, isDashboard, isPlatformMaster, myPermissions, myPermissionsLoaded, navigate]);


// 대시보드 권한이 없으면 대시보드 화면을 띄우지 않고 안내 문구만 보인다
const dashboardBlocked = isDashboard && !isPlatformMaster && (!myPermissionsLoaded || !myPermissions.includes('HOME'));
// 처음 여는 탭이면 화면을 보관한다. 이미 열린 탭이라도 조건(주소 ?…, 전달값)을 들고 다시 열리면 새로 시작한다.
const cachedPage = pageCache[pathname];
const opensWithParams = Boolean(location.search) || location.state != null;
// (닫은 탭은 이동이 끝나기 전 한 번 더 그려질 때 다시 보관되지 않도록, 열린 탭 목록에 있을 때만)
const isOpenTab = pageTabs.some((tab) => tab.path === pathname);
if (!dashboardBlocked && outlet && isOpenTab && (!cachedPage || (opensWithParams && cachedPage.locationKey !== location.key))) {
  setPageCache((current) => ({
    ...current,
    [pathname]: { element: outlet, locationKey: location.key, version: (current[pathname]?.version || 0) + 1 },
  }));
}

// 값이 같으면 같은 객체를 유지한다 — 새 객체면 이 값을 읽는 화면(대시보드 등)이 숨어 있어도 탭 이동마다 다시 그려진다
const fallbackPath = firstAccessiblePath || '/HomePage';
const menuAccessContextValue = useMemo(() => ({
  menuids: myPermissions,
  loaded: myPermissionsLoaded,
  authority: currentAuthority,
  companyid: currentCompanyId,
  fallbackPath,
}), [currentAuthority, currentCompanyId, fallbackPath, myPermissions, myPermissionsLoaded]);

//   /* 잠시 주석처리 */
// const links = useMemo(() => {
//   return mockdata.map((group) => {
//     // 1. 하위 메뉴(links)가 있는 그룹 처리
//     if (group.links) {
//       const updatedSubLinks = group.links.map((sub) => ({
//         ...sub,
//         // 권한이 없으면 disabled: true
//         disabled: !myPermissions.includes(sub.MenuID)
//       }));

//       return <LinksGroup {...group} links={updatedSubLinks} key={group.label} />;
//     }

//     // 2. 단일 메뉴(Home 등) 처리
//     const isDisabled = group.MenuID !== null && !myPermissions.includes(group.MenuID);
//     return <LinksGroup {...group} disabled={isDisabled} key={group.label} />;
//   });
// }, [myPermissions]);


  return (
    <>
    <AppShell
      layout="alt"
      transitionDuration={220}
      transitionTimingFunction="ease"
      className={`${classes.shell} ${navTheme === 'light' ? classes.themeLight : classes.themeDark} ${isInboundWorkspace || isDashboard ? classes.appShellInbound : ''} ${sidebarCollapsed ? `${classes.sidebarCollapsed} steel119-sidebar-collapsed` : ''}`}
      header={{ height: 52 }}
      navbar={{
        width: sidebarCollapsed ? 76 : 224,
        breakpoint: 'sm',
        collapsed: { mobile: !opened },
      }}
      padding="sm"
    >
      <AppShell.Header className={classes.appHeader}>
        <Burger className={classes.mobileBurger} opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />

        <label className={classes.hsearch}>
          <IconSearch size={18} stroke={1.5} />
          <input ref={menuSearchRef} type="text" placeholder="메뉴 검색" autoComplete="off" aria-label="메뉴 검색" value={menuQuery}
            onChange={(event) => { setMenuQuery(event.target.value); if (sidebarCollapsed && event.target.value) expandSidebar(); }}
            onKeyDown={(event) => { if (event.key === 'Escape') { setMenuQuery(''); event.currentTarget.blur(); } }} />
          <kbd>Ctrl K</kbd>
        </label>

        <div className={classes.hright}>
          <Box className={classes.headerActions}>
            {ribbons[pathname] ?? null}
          </Box>
          <span className={classes.hsep} aria-hidden="true" />
          {controlSummary?.enabled && (() => {
            const count = controlSummary.is_approver ? controlSummary.pending : controlSummary.my_rejected;
            const label = controlSummary.is_approver
              ? `승인 대기 ${controlSummary.pending}건`
              : `내 요청 대기 ${controlSummary.my_pending}건 · 최근 반려 ${controlSummary.my_rejected}건`;
            return <button type="button" className={classes.bell} title={label} aria-label={label} onClick={() => navigate('/ControlManagement')}>
              <IconBell size={18} stroke={1.5} />
              {count > 0 && <span className={classes.bellBadge}>{count > 99 ? '99+' : count}</span>}
            </button>;
          })()}
          <Menu position="bottom-end" offset={8} width={248} shadow="md" withinPortal classNames={{ dropdown: classes.umenu }}>
            <Menu.Target>
              <button type="button" className={classes.ubtn} aria-label="사용자 메뉴">
                <IconUserCircle className={classes.uav} size={24} stroke={1.5} />
                <span>{userInfo.name ? `${userInfo.name}님` : '사용자'}</span>
                <IconChevronDown className={classes.uchev} size={14} stroke={1.8} />
              </button>
            </Menu.Target>
            <Menu.Dropdown>
              <div className={classes.uh}>
                <b>{userInfo.name ? `${userInfo.name}님` : '사용자'}</b>
                {userInfo.email && <span>{userInfo.email}</span>}
                {userInfo.companyname && <span>{userInfo.companyname}</span>}
              </div>
              <Menu.Item className={classes.ui} leftSection={<IconKey size={18} stroke={1.7} />} onClick={openPwModal}>비밀번호 변경</Menu.Item>
              <Menu.Item className={`${classes.ui} ${classes.uiDanger}`} leftSection={<IconLogout size={18} stroke={1.7} />} onClick={handleLogout}>로그아웃</Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </div>

        <Modal opened={pwModalOpened} onClose={closePwModal} centered size={380} withCloseButton={false} padding={0} radius={16}
          overlayProps={{ backgroundOpacity: 0.2 }} classNames={{ content: classes.pwModal }}>
          <form onSubmit={handlePasswordChange}>
            <div className={classes.pwTop}>
              <span className={classes.pwIcon} aria-hidden="true"><IconShieldLock size={24} stroke={1.8} /></span>
              <h2>비밀번호 변경</h2>
              <p>현재 비밀번호를 확인한 뒤 새 비밀번호로 바꿉니다.</p>
            </div>
            <div className={classes.pwFields}>
              <PasswordInput label="현재 비밀번호" placeholder="현재 비밀번호" required data-autofocus autoComplete="current-password"
                value={pwdForm.current} onChange={(e) => setPwdForm({ ...pwdForm, current: e.target.value })} />
              <PasswordInput label="새 비밀번호" placeholder="새 비밀번호" required autoComplete="new-password"
                value={pwdForm.next} onChange={(e) => setPwdForm({ ...pwdForm, next: e.target.value })} />
              <PasswordInput label="새 비밀번호 확인" placeholder="새 비밀번호 다시 입력" required autoComplete="new-password"
                value={pwdForm.confirm} onChange={(e) => setPwdForm({ ...pwdForm, confirm: e.target.value })}
                error={pwdForm.confirm && pwdForm.next !== pwdForm.confirm ? '새 비밀번호가 일치하지 않습니다.' : null} />
            </div>
            <div className={classes.pwActions}>
              <button type="button" className={classes.pwCancel} onClick={closePwModal}>취소</button>
              <button type="submit" className={classes.pwSubmit}
                disabled={!pwdForm.current || !pwdForm.next || pwdForm.next !== pwdForm.confirm}>변경하기</button>
            </div>
          </form>
        </Modal>
      </AppShell.Header>

      <AppShell.Navbar className={classes.navBar} p={0}>
        <AppShell.Section className={classes.sideHead}>
          <div className={classes.logoSlot}>
            <Steel119Logo className={classes.brandLockup} redClass={classes.lgRed} inkClass={classes.lgInk} />
          </div>
          <button
            type="button"
            className={classes.sidebarToggle}
            onClick={toggleSidebar}
            aria-label={sidebarCollapsed ? '사이드바 펼치기' : '사이드바 접기'}
            title={sidebarCollapsed ? '사이드바 펼치기' : '사이드바 접기'}
          >
            <IconLayoutSidebar size={20} stroke={1.5} />
          </button>
        </AppShell.Section>
        <AppShell.Section grow className={classes.navScroll}>
          <SidebarNav items={visibleMockdata} pathname={pathname} collapsed={sidebarCollapsed} onExpand={expandSidebar} query={menuQuery}
            favoriteIds={favoriteIds} onToggleFavorite={toggleFavorite} onReorderFavorites={reorderFavorites} />
        </AppShell.Section>
        <AppShell.Section className={classes.sFoot}>
          <div className={classes.thm}>
            <IconMoon className={classes.thmIcon} size={20} stroke={1.5} />
            <span className={classes.thmText}>라이트 모드</span>
            <button type="button" className={classes.sw} role="switch" aria-checked={navTheme === 'light'} aria-label="라이트 모드 전환"
              title={navTheme === 'light' ? '다크 모드로' : '라이트 모드로'} onClick={toggleNavTheme} />
          </div>
          <button type="button" className={classes.lo} onClick={handleLogout} title="로그아웃">
            <IconLogout size={20} stroke={1.5} /><span className={classes.thmText}>로그아웃</span>
          </button>
        </AppShell.Section>
      </AppShell.Navbar>

      <AppShell.Main className={`${classes.appMain} ${isDashboard ? classes.appMainDashboard : isInboundWorkspace ? classes.appMainInbound : ''}`}>
        <div className={classes.pageTabs} role="tablist" aria-label="열린 메뉴">
          <button type="button" className={`${classes.pageTab} ${classes.homeTab} ${isDashboard ? classes.pageTabActive : ''}`}
            title="대시보드" aria-label="대시보드" aria-current={isDashboard ? 'page' : undefined} onClick={() => navigate('/HomePage')}>
            <IconHome size={14} stroke={1.6} /><span className={classes.pageTabLabel}>대시보드</span>
          </button>
          {visiblePageTabs.map((tab) => {
            const label = findMenuLabel(mockdata, tab.path);
            return (
              <div key={tab.path} role="tab" aria-selected={pathname === tab.path} tabIndex={0} draggable
                className={`${classes.pageTab} ${pathname === tab.path ? classes.pageTabActive : ''} ${draggingTab === tab.path ? classes.pageTabDragging : ''}`}
                onDragStart={(event) => { dragTabRef.current = tab.path; setDraggingTab(tab.path); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', tab.path); }}
                onDragOver={(event) => moveDraggedTab(event, tab.path)}
                onDrop={(event) => event.preventDefault()}
                onDragEnd={() => { dragTabRef.current = null; setDraggingTab(null); }}
                onClick={() => navigate(tab.path)} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) navigate(tab.path); }}>
                <span className={classes.pageTabLabel} title={label}>{label}</span>
                <button type="button" className={classes.pageTabClose} aria-label={`${label} 닫기`}
                  onClick={(event) => closePageTab(event, tab.path)}>×</button>
              </div>
            );
          })}
          <Menu position="bottom-end" withinPortal shadow="sm">
            <Menu.Target>
              <button type="button" className={classes.moreTabsButton} aria-label={overflowPageTabs.length ? `탭 메뉴 · 나머지 열린 화면 ${overflowPageTabs.length}개` : '탭 메뉴'}>
                ···{overflowPageTabs.length > 0 && <span>{overflowPageTabs.length}</span>}
              </button>
            </Menu.Target>
            <Menu.Dropdown className={classes.moreTabsDropdown}>
              {overflowPageTabs.length > 0 && <>
                <div className={classes.moreTabsHeading}>열린 화면 {workTabs.length}개</div>
                {overflowPageTabs.map((tab) => {
                  const label = findMenuLabel(mockdata, tab.path);
                  return <div className={classes.moreTabRow} key={tab.path}>
                    <button type="button" className={classes.moreTabOpen} title={label} onClick={() => navigate(tab.path)}>
                      <span>{label}</span>
                    </button>
                    <button type="button" className={classes.moreTabClose} aria-label={`${label} 닫기`}
                      onClick={(event) => closePageTab(event, tab.path)}>×</button>
                  </div>;
                })}
                <div className={classes.moreTabsDivider} />
              </>}
              <Menu.Item className={classes.closeAllItem} onClick={closeAllTabs} disabled={!workTabs.length}>탭 모두 닫기</Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </div>
        {/* 클래스 적용 */}
        <div className={`${classes.contentCard} ${isDashboard ? classes.dashboardContentCard : isInboundWorkspace ? classes.inboundContentCard : ''}`}>
          <MenuAccessContext.Provider value={menuAccessContextValue}>
            {dashboardBlocked && (!myPermissionsLoaded
              ? <Text c="dimmed" ta="center" mt="xl">메뉴 권한을 확인하고 있습니다.</Text>
              : <Text c="dimmed" ta="center" mt="xl">
                  {noAccessibleMenus
                    ? '접근할 수 있는 메뉴가 없습니다. 관리자에게 메뉴 권한을 요청해 주세요.'
                    : '대시보드 권한이 없어 허용된 메뉴로 이동합니다.'}
                </Text>)}
            {Object.entries(pageCache).map(([path, entry]) => (
              <KeepAlivePage key={`${path}#${entry.version}`} path={path} active={path === pathname && !dashboardBlocked} activation={activations[path] || 0}
                element={entry.element} setRibbons={setRibbons} closeTabRef={closeTabRef} />
            ))}
          </MenuAccessContext.Provider>
        </div>
      </AppShell.Main>
    </AppShell>
  </>
  );

}
