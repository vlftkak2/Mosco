
import { AppShell, Burger, Text, Box, Modal, PasswordInput, Menu, Popover } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { SidebarNav } from './MainLayoutLink';
import ConfirmDeleteModal from '../common/ConfirmDeleteModal';
import '../../styles/layout/shellTheme.css';
import classes from '../../styles/layout/MainLayout.module.css';
import { Suspense, createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import usePointerSort from './usePointerSort';
import { useNavigate, useLocation, useOutlet, UNSAFE_LocationContext as LocationContext } from 'react-router-dom';
import { clearAIOrderPageSession } from '../../pages/ai/AIOrderPageSession';
import { clearAIOrderDraft } from '../../pages/ai/AIOrderDraft';
import {
  IconBox, IconChevronDown, IconClipboardCheck, IconCoin, IconHome, IconKey, IconLayoutSidebar, IconLogout, IconMessages, IconSettings,
  IconBell, IconDots, IconHourglass, IconReload, IconSearch, IconShieldLock, IconShoppingCart, IconTool, IconTrendingUp, IconUserCircle, IconUsers,
} from '@tabler/icons-react';
import '@mantine/notifications/styles.css';
import { notifications } from '@mantine/notifications';
import axios from 'axios'; // axios 추가
import { IconCheck, IconX } from '@tabler/icons-react'; // 아이콘 추가
import Steel119Logo from './Steel119Logo';
import AIAssistant from './AIAssistant';
import { ShortcutHelp, useRibbonShortcutTitles, useShellShortcuts } from './ShellShortcuts';
import ErrorBoundary from '../common/ErrorBoundary';
import { PagePathContext, anyDirty, clearDirty, isDirty } from '../../utils/dirtyRegistry';
import { clearAuthStorage, logoutOnServer } from '../../utils/sessionGuard';
import { apiErrorMessage } from '../../utils/apiError';
import { preloadPagesWhenIdle } from '../../utils/pagePreload';
import { loadMaster } from '../../utils/masterCache';

export const PageRibbonContext = createContext(null);

// 열린 탭의 화면을 계속 띄워 두고(숨김만) 탭마다 리본을 따로 보관한다 → 탭을 옮겨도 화면 상태가 그대로.
// 탭을 닫을 때만 화면이 지워진다.
// 탭이 지금 보이는지 (숨었다가 다시 보이면 화면이 최신 데이터를 다시 불러올 수 있게)
export const PageActiveContext = createContext(true);
// 탭이 화면에 다시 나타난 횟수 (처음 열 때 1, 다른 탭에 갔다 돌아올 때마다 +1)
export const PageActivationContext = createContext(0);

const KeepAlivePage = memo(function KeepAlivePage({ path, active, activation, element, setRibbons }) {
  const ribbonContext = useMemo(() => ({
    registerPageRibbon: (content) => setRibbons((current) => ({ ...current, [path]: content })),
  }), [path, setRibbons]);
  // 숨은 탭에는 마지막으로 보였을 때의 주소를 그대로 준다. useNavigate · useLocation 은 주소가 바뀔 때마다 다시 그려지므로,
  // 그대로 두면 열린 탭 전체가(숨어 있어도) 탭을 옮길 때마다 다시 그려져 이동이 느려진다.
  const liveLocation = useContext(LocationContext);
  const [tabLocation, setTabLocation] = useState(liveLocation);
  if (active && tabLocation !== liveLocation) setTabLocation(liveLocation);
  return <div style={{ display: active ? 'contents' : 'none' }} data-tab-path={path} aria-hidden={active ? undefined : true}>
    <LocationContext.Provider value={active ? liveLocation : tabLocation}>
      <PageActiveContext.Provider value={active}>
        <PageActivationContext.Provider value={activation}>
          <PageRibbonContext.Provider value={ribbonContext}>
            <PagePathContext.Provider value={path}>
              <ErrorBoundary><Suspense fallback={null}>{element}</Suspense></ErrorBoundary>
            </PagePathContext.Provider>
          </PageRibbonContext.Provider>
        </PageActivationContext.Provider>
      </PageActiveContext.Provider>
    </LocationContext.Provider>
  </div>;
});
export const MenuAccessContext = createContext({ menuids: [], loaded: false, authority: 'USER', fallbackPath: null });

// 메뉴 구성: 대메뉴 > 소제목 > 화면 (네비 시안 '네비 메뉴 명칭.html' 기준 이름 · 아이콘 · 순서).
// MenuID 는 그대로 (권한 · 내메뉴가 그대로 이어진다). 이름을 바꾸면 backend/sql/migrations 의 메뉴 카탈로그(menuname · sort_order)도 같이 맞춘다.
//  access: 다른 메뉴의 권한을 그대로 쓰는 화면 (MenuID 는 내메뉴 저장용)
//  disabled: 화면을 만들기 전 자리 (흐리게 보이고 누를 수 없음)
//  action: 화면 대신 동작 (AI 업무비서 = 오른쪽 대화창 열기)
//  ai: 메뉴 옆 AI 배지
const ic = { size: 18, stroke: 2.25 };   // 시안 아이콘(Tabler 웹폰트) 굵기: SVG 는 웹폰트보다 가늘게 그려져 2 → 2.25
const mockdata = [
  {
    label: '홈',
    icon: <IconHome {...ic} />,
    links: [
      { label: '대시보드', link: '/HomePage', MenuID: 'HOME' },
      { label: 'AI 업무비서', link: '/AIAssistant', MenuID: 'AI_ASSISTANT', ai: true },
    ],
  },
  {
    label: '매입',
    icon: <IconShoppingCart {...ic} />,
    links: [
      { label: '매입 관리', links: [
        { label: '매입등록', link: '/InboundRegisterPage', MenuID: 'INBOUND_REGISTER' },
        { label: '매입현황', link: '/InboundSearchPage', MenuID: 'INBOUND_SEARCH' },
      ] },
    ],
  },
  {
    label: '매출',
    icon: <IconTrendingUp {...ic} />,
    links: [
      { label: '매출·이익', links: [
        { label: '매출등록', link: '/OutboundRegisterPage', MenuID: 'OUTBOUND_REGISTER' },
        { label: '매출현황', link: '/OutboundSearchPage', MenuID: 'OUTBOUND_SEARCH' },
        { label: '매출이익 현황', link: '/GrossProfit', MenuID: 'GROSS_PROFIT' },
        { label: '매출이익 분석', link: '/GrossProfitDashboard', MenuID: 'GROSS_PROFIT_DASHBOARD' },
      ] },
    ],
  },
  {
    label: '가공',
    icon: <IconTool {...ic} />,
    links: [
      { label: 'AI 가공솔루션', links: [
        { label: '주문서 자동인식', link: '/AIOrderPage', MenuID: 'AI_ORDER_RECOGNITION', ai: true },
        { label: '주문서 통합관리', link: '/AIOrderManage', MenuID: 'AI_ORDER_MANAGEMENT' },
        { label: 'AI 가공최적화', link: '/AIOrderOptimization', MenuID: 'AI_OPTIMIZATION', ai: true },
      ] },
      { label: '재고가공 공정', links: [
        { label: '재고가공 등록', link: '/ItemProcessRegister', MenuID: 'ITEM_PROCESS_REGISTER' },
        { label: '재고가공 현황', link: '/ItemProcessSearch', MenuID: 'ITEM_PROCESS_SEARCH' },
        { label: '가공공정 관리', link: '/ItemProcessMaster', MenuID: 'ITEM_PROCESS_MASTER' },
      ] },
    ],
  },
  {
    label: '재고',
    icon: <IconBox {...ic} />,
    links: [
      { label: '재고 조회', links: [
        { label: '현재고현황', link: '/CurrentStockPage', MenuID: 'STOCK_CURRENT' },
        { label: '재고수불 현황', link: '/IniopStockPage', MenuID: 'STOCK_HISTORY' },
        { label: '기초재고 등록', link: '/StockStandPage', MenuID: 'STOCK_INITIAL' },
      ] },
      { label: '창고 이동', links: [
        { label: '재고이동 등록', link: '/InoutmoveRegister', MenuID: 'INOUTMOVE_REGISTER' },
        { label: '재고이동 현황', link: '/InoutmoveSearch', MenuID: 'INOUTMOVE_SEARCH' },
      ] },
    ],
  },
  {
    label: '자금',
    icon: <IconCoin {...ic} />,
    links: [
      { label: '자금 관리', links: [
        { label: '수금지급 등록', link: '/ReceiptPayment', MenuID: 'RECEIPT_PAYMENT' },
        { label: '수금지급 현황', link: '/ReceiptPaymentSearch', MenuID: 'RECEIPT_PAYMENT_SEARCH' },
        { label: '어음수표 관리', link: '/InstrumentStatus', MenuID: 'INSTRUMENT_STATUS' },
        { label: '채권채무 현황', link: '/CustomerLedger', MenuID: 'CUSTOMER_LEDGER' },
        { label: '채권채무 분석', link: '/CustomerBalanceDashboard', MenuID: 'CUSTOMER_BALANCE_DASHBOARD' },
      ] },
      { label: '계산서 관리', links: [
        { label: '세금계산서 발행', disabled: true },
      ] },
    ],
  },
  {
    label: '인사',
    icon: <IconUsers {...ic} />,
    links: [
      { label: '인사·휴가', links: [
        { label: '인사기록부 등록', link: '/UserInfo', MenuID: 'USER_MANAGEMENT' },
        { label: '휴가현황', link: '/LeaveStatus', MenuID: 'EAPPROVAL_LEAVE', access: 'EAPPROVAL' },
        { label: '휴가설정', link: '/LeaveSetting', MenuID: 'EAPPROVAL_LEAVE_SETTING', access: 'EAPPROVAL_FORM' },
      ] },
      { label: '급여 관리', links: [
        { label: '급여등록', link: '/PayrollEntry', MenuID: 'PAYROLL' },
        { label: '급여대장', link: '/PayrollLedger', MenuID: 'PAYROLL_LEDGER', access: 'PAYROLL' },
        { label: '내 급여현황', link: '/MyPayroll', MenuID: 'PAYROLL_MY' },
      ] },
    ],
  },
  {
    label: '결재',
    icon: <IconClipboardCheck {...ic} />,
    links: [
      { label: '결재 문서', links: [
        { label: '새 문서 작성', link: '/EApproval', MenuID: 'EAPPROVAL' },
        { label: '임시저장함', link: '/EApprovalDrafts', MenuID: 'EAPPROVAL_DRAFTS', access: 'EAPPROVAL' },
        { label: '내 결재현황', link: '/EApprovalMine', MenuID: 'EAPPROVAL_MINE', access: 'EAPPROVAL' },
        { label: '결재함', link: '/EApprovalInbox', MenuID: 'EAPPROVAL_INBOX', access: 'EAPPROVAL' },
      ] },
      { label: '결재 관리', links: [
        { label: '양식관리', disabled: true },
        { label: '결재설정', link: '/EApprovalForm', MenuID: 'EAPPROVAL_FORM' },
      ] },
    ],
  },
  {
    label: '소통',
    icon: <IconMessages {...ic} />,
    links: [
      { label: '게시판', links: [
        { label: '상담게시판', link: '/CustomerSupport', MenuID: 'CUSTOMER_SUPPORT' },
        { label: '자료실', disabled: true },
      ] },
    ],
  },
  {
    label: '설정',
    icon: <IconSettings {...ic} />,
    links: [
      { label: '시스템 설정', links: [
        { label: '기초코드 관리', link: '/CodeMasterPage', MenuID: 'DATA_CODE' },
        { label: '품목코드 관리', link: '/ItemMasterPage', MenuID: 'DATA_ITEM' },
        { label: '거래처관리', link: '/CustomerPage', MenuID: 'DATA_CUSTOMER' },
        { label: '사업장관리', link: '/Workplace', MenuID: 'WORKPLACE_MANAGEMENT' },
        { label: '월마감관리', link: '/MonthClose', MenuID: 'MONTH_CLOSING' },
      ] },
    ],
  },
  {
    label: '관리',
    icon: <IconShieldLock {...ic} />,
    links: [
      { label: '고객사 관리', links: [
        { label: '고객사등록', link: '/Company', MenuID: 'COMPANY_REGISTRATION' },
        { label: '계정관리', link: '/User', MenuID: 'COMPANY_USER_MANAGEMENT' },
      ] },
      { label: '권한·통제', links: [
        { label: '메뉴별 권한', link: '/UserMenu', MenuID: 'USER_MENU_PERMISSION' },
        { label: '통제관리', link: '/ControlManagement', MenuID: 'CONTROL_MANAGEMENT' },
      ] },
      { label: '서비스 모니터링', links: [
        { label: '라이선스 현황', link: '/LicenseRevenue', MenuID: 'LICENSE_REVENUE' },
        { label: '타사재고 현황', link: '/SharedStock', MenuID: 'SHARED_STOCK' },
        { label: 'AI 비용현황', link: '/AiCost', MenuID: 'AI_COST' },
      ] },
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
  // 화면 색(라이트 / 다크)은 네비 아래 스위치(ThemeSwitch)가 혼자 맡는다 → 전환할 때 이 화면 전체를 다시 그리지 않음
  // 메뉴 검색 (헤더 검색칸 → 왼쪽 메뉴를 거름, '/' 로 바로 이동)
  // '/' 는 입력칸 · 표 등 화면 안에 포커스가 없을 때(바탕 · 네비 · 헤더 · 탭줄)만 받는다 → 화면에서 '/' 를 입력하는 데 방해되지 않음
  const [menuQuery, setMenuQuery] = useState('');
  const menuSearchRef = useRef(null);
  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || event.isComposing || event.defaultPrevented) return;
      const el = document.activeElement;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (el && el !== document.body && !el.closest?.('[data-shell-chrome]')) return;
      event.preventDefault();
      menuSearchRef.current?.focus();
      menuSearchRef.current?.select();
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
    '/outboundregisterpage', '/outboundsearchpage', '/inoutmoveregister', '/inoutmovesearch', '/receiptpayment', '/receiptpaymentsearch', '/instrumentstatus', '/customerledger', '/customerbalancedashboard', '/grossprofit', '/grossprofitdashboard', '/company', '/licenserevenue', '/aicost', '/aiassistant', '/sharedstock', '/user', '/usermenu', '/workplace', '/monthclose', '/userinfo', '/controlmanagement', '/eapproval', '/eapprovaldrafts', '/eapprovalmine', '/eapprovalinbox', '/eapprovalform', '/leavesetting', '/leavestatus', '/payrollentry', '/payrollledger', '/mypayroll',
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
  // 탭 끌어서 순서 바꾸기 (홈 탭은 끌 수 없고 홈 앞으로 옮길 수 없음): 원래 자리는 빈 칸, 끄는 모습은 화면 위에 따로
  const tabsRowRef = useRef(null);
  const visibleTabPaths = useMemo(() => visiblePageTabs.map((tab) => tab.path), [visiblePageTabs]);
  const commitTabOrder = useCallback((order) => setTabState((current) => {
    // 보이는 탭 자리만 새 순서로 채운다 (홈 · 더보기로 넘친 탭 자리는 그대로)
    const moved = new Set(order);
    const byPath = new Map(current.tabs.map((tab) => [tab.path, tab]));
    let next = 0;
    const tabs = current.tabs.map((tab) => (moved.has(tab.path) ? byPath.get(order[next++]) || tab : tab));
    return { ...current, tabs };
  }), []);
  const tabSort = usePointerSort({ ids: visibleTabPaths, axis: 'x', containerRef: tabsRowRef, onCommit: commitTabOrder });
  const sortedPageTabs = tabSort.order.map((path) => visiblePageTabs.find((tab) => tab.path === path)).filter(Boolean);


  // 저장하지 않은 변경이 있는 탭을 닫을 때 확인 창 ({ kind: 'one', path } | { kind: 'all' })
  const [pendingClose, setPendingClose] = useState(null);
  const closePageTab = useCallback((event, path, force = false) => {
    event?.stopPropagation?.();
    if (!force && isDirty(path)) { setPendingClose({ kind: 'one', path }); return; }
    clearDirty(path);
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
  // 탭 모두 닫기 / 현재 탭 제외 모두 닫기: 대시보드(와 지금 탭)만 남기고 나머지 화면과 리본을 지운다 (각 탭을 닫을 때와 같은 정리)
  const closeManyTabs = useCallback((keepCurrent, force = false) => {
    const home = pageTabs.find((tab) => isHomePath(tab.path)) || { path: '/HomePage', label: findMenuLabel(mockdata, '/HomePage') };
    const keep = new Set([home.path, ...(keepCurrent ? [pathname] : [])]);
    const closing = pageTabs.filter((tab) => !keep.has(tab.path)).map((tab) => tab.path);
    if (!closing.length) return;
    if (force !== true && anyDirty(closing)) { setPendingClose({ kind: keepCurrent ? 'others' : 'all' }); return; }
    closing.forEach(clearDirty);
    const paths = closing.map((path) => String(path || '').replace(/\/+$/, '').toLowerCase());
    if (paths.includes('/aiorderpage')) clearAIOrderPageSession();
    if (paths.includes('/aiordermanage')) clearAIOrderDraft();
    const kept = pageTabs.filter((tab) => keep.has(tab.path));
    setTabState({ pathname, tabs: kept.some((tab) => tab.path === home.path) ? kept : [home, ...kept] });
    const pick = (current) => Object.fromEntries(Object.entries(current).filter(([path]) => keep.has(path)));
    setPageCache(pick);
    setRibbons(pick);
    if (!keep.has(pathname)) navigate(home.path);
  }, [pageTabs, pathname, navigate]);
  const closeAllTabs = useCallback((force = false) => closeManyTabs(false, force), [closeManyTabs]);
  const closeOtherTabs = useCallback((force = false) => closeManyTabs(true, force), [closeManyTabs]);
  // 새로고침: 지금 탭 화면만 처음 상태로 다시 띄운다 (다시 그리면서 최신 데이터를 읽음). 저장 안 한 변경이 있으면 먼저 묻는다.
  const [refreshSpin, setRefreshSpin] = useState(0);
  const refreshCurrentTab = useCallback((force = false) => {
    if (force !== true && isDirty(pathname)) { setPendingClose({ kind: 'refresh', path: pathname }); return; }
    setRefreshSpin((value) => value + 1);
    clearDirty(pathname);
    setPageCache((current) => (current[pathname]
      ? { ...current, [pathname]: { ...current[pathname], version: current[pathname].version + 1 } }
      : current));
  }, [pathname]);

  // 전자결재: 내가 결재할 문서 · 최근 반려 (헤더 알림)
  const [eapprSummary, setEapprSummary] = useState(null);
  useEffect(() => {
    if (!localStorage.getItem('access_token')) return undefined;
    let alive = true;
    const loadEappr = () => axios.get('/api/eapproval/summary', { headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } })
      .then(({ data }) => { if (alive) setEapprSummary(data); })
      .catch(() => { /* 알림만 못 보여 줌 */ });
    void loadEappr();
    const onVisible = () => { if (document.visibilityState === 'visible') void loadEappr(); };
    window.addEventListener('eapproval-changed', loadEappr);
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(() => { if (document.visibilityState !== 'hidden') void loadEappr(); }, 60 * 1000);
    return () => {
      alive = false;
      window.removeEventListener('eapproval-changed', loadEappr);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, []);

  // 승인 통제: 사용 여부 · 승인자 여부 · 대기 건수 (헤더 알림 · 통제관리 메뉴 표시)
  const [controlSummary, setControlSummary] = useState(null);
  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) return undefined;
    let alive = true;
    // 받은 요약은 통제관리 화면과 같이 쓴다 (control:summary) → 통제관리를 처음 열어도 목록이 바로 시작된다
    const loadControl = () => loadMaster('control:summary', async () => (await axios.get('/api/control/summary', { headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } })).data)
      .then((data) => { if (alive) setControlSummary(data); })
      .catch(() => { /* 알림만 못 보여 줌 */ });
    void loadControl();
    const onVisible = () => { if (document.visibilityState === 'visible') void loadControl(); };
    window.addEventListener('approval-changed', loadControl);
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(() => { if (document.visibilityState !== 'hidden') void loadControl(); }, 60 * 1000);
    return () => {
      alive = false;
      window.removeEventListener('approval-changed', loadControl);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, []);

  // 승인요청 안내 창 (매입 · 매출 · 거래처 · 수금지급 저장 · 삭제가 승인요청으로 들어갔을 때)
  const [approvalNotice, setApprovalNotice] = useState(null);
  useEffect(() => {
    const onPending = (event) => setApprovalNotice(event.detail || {});
    window.addEventListener('approval-pending', onPending);
    return () => window.removeEventListener('approval-pending', onPending);
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
  // 헤더 왼쪽 회사명 (사업장 전환은 이후 작업 — 지금은 표시만)
  const [companyName, setCompanyName] = useState(userInfo.companyname);

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
      notifications.show({ title: '내메뉴 저장 실패', message: '잠시 후 다시 시도해 주세요.', color: 'red', position: 'bottom-right' });
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
        if (data.companyname) { localStorage.setItem('user_companyname', data.companyname); setCompanyName(data.companyname); }
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

      // 서버가 세션을 새로 만들었으면(다른 기기는 로그아웃) 새 토큰으로 바꿔 둔다
      if (res.data.access_token) localStorage.setItem('access_token', res.data.access_token);

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
      // 400: 현재 비밀번호 틀림 · 429: 시도 횟수 초과 · 422: 입력값 오류 → 서버 사유를 그대로
      const errorDetail = typeof error.response?.data?.detail !== 'string' && typeof error.response?.data?.message === 'string'
        ? error.response.data.message
        : apiErrorMessage(error, '비밀번호 변경에 실패했습니다.');
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
    logoutOnServer();   // 서버 세션도 끊는다 (기다리지 않음 · 실패해도 무시)
    clearAuthStorage();
    navigate('/login');
  }


const isPlatformMaster = currentCompanyId === '001' && currentAuthority === 'MASTER';
// AI 업무비서: 지금은 모스코(001) 직원 중 메뉴권한(AI_ASSISTANT)이 있는 사람만 (서버도 같은 조건으로 막는다)
const canUseAssistant = currentCompanyId === '001' && (isPlatformMaster || (myPermissionsLoaded && myPermissions.includes('AI_ASSISTANT')));
const canSeeMenu = (link) => {
  // 모든 메뉴는 메뉴권한으로 (모스코 전용 메뉴는 모스코 직원만 받을 수 있다 — 서버가 막음). 모스코 MASTER 는 전체.
  // 통제관리: 메뉴 권한이 없어도 통제 설정에서 승인자로 지정된 직원은 보인다
  if (link.link === '/ControlManagement' && controlSummary?.is_approver) return true;
  // AI 업무비서: 지금은 모스코(001) 직원 중 권한이 있는 사람만 (대화창과 같은 조건)
  if (link.MenuID === 'AI_ASSISTANT') return canUseAssistant;
  if (isPlatformMaster) return true;
  const required = link.access || link.MenuID;   // access: 다른 메뉴의 권한을 그대로 쓰는 화면 (예: 휴가현황 = 전자결재)
  return !required || myPermissions.includes(required);
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

  // 단축키 (F1 단축키 표 · 리본 F3~F9 · 탭 Alt+…): ShellShortcuts.jsx
  const headerActionsRef = useRef(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const tabOrder = [pageTabs.find((tab) => isHomePath(tab.path))?.path || '/HomePage', ...workTabs.map((tab) => tab.path)];
  const goTab = (step) => {
    const index = tabOrder.indexOf(pathname);
    const next = tabOrder[(Math.max(index, 0) + step + tabOrder.length) % tabOrder.length];
    if (next && next !== pathname) navigate(next);
  };
  useShellShortcuts(headerActionsRef, {
    toggleHelp: () => setHelpOpen((value) => !value),
    prevTab: () => goTab(-1),
    nextTab: () => goTab(1),
    refreshTab: () => refreshCurrentTab(),
    closeTab: () => { if (!isHomePath(pathname)) closePageTab(null, pathname); },
    home: () => navigate('/HomePage'),
    favorite: (index) => {
      const byId = new Map();
      const walk = (list) => list.forEach((item) => { if (item.links) walk(item.links); else if (item.MenuID && item.link && !item.disabled) byId.set(item.MenuID, item); });
      walk(visibleMockdata);
      const item = favoriteIds.map((id) => byId.get(id)).filter(Boolean)[index];
      if (item) navigate(item.link);
    },
  });
  useRibbonShortcutTitles(headerActionsRef, [pathname]);


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

// 로그인 후 브라우저가 한가할 때, 열 수 있는 메뉴 화면 코드를 메뉴 순서대로(매입 → 매출 → …) 미리 받아 둔다 → 처음 눌러도 바로 열린다
const preloadPathList = (myPermissionsLoaded || isPlatformMaster)
  ? flattenMenuLinks(visibleMockdata).filter((item) => item.link && !item.disabled).map((item) => item.link).join('|')
  : '';
useEffect(() => (preloadPathList ? preloadPagesWhenIdle(preloadPathList.split('|')) : undefined), [preloadPathList]);


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
      className={`${classes.shell} ${isInboundWorkspace || isDashboard ? classes.appShellInbound : ''} ${sidebarCollapsed ? `${classes.sidebarCollapsed} steel119-sidebar-collapsed` : ''}`}
      header={{ height: 56 }}
      navbar={{
        width: sidebarCollapsed ? 68 : 216,
        breakpoint: 'sm',
        collapsed: { mobile: !opened },
      }}
      padding="sm"
    >
      <AppShell.Header className={classes.appHeader} data-shell-chrome="">
        <Burger className={classes.mobileBurger} opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />

        {companyName && <div className={classes.tn} title={companyName}>
          <span className={classes.tdot} aria-hidden="true" /><span className={classes.tnName}>{companyName}</span>
          <IconChevronDown className={classes.tnChev} size={14} stroke={2} />   {/* 사업장 전환 자리 (기능은 이후 작업) */}
        </div>}
        <label className={classes.hsearch}>
          <IconSearch size={16} stroke={2} />
          <input ref={menuSearchRef} type="text" placeholder="메뉴 검색" autoComplete="off" aria-label="메뉴 검색 (단축키 /)" value={menuQuery}
            onChange={(event) => { setMenuQuery(event.target.value); if (sidebarCollapsed && event.target.value) expandSidebar(); }}
            onKeyDown={(event) => { if (event.key === 'Escape') { setMenuQuery(''); event.currentTarget.blur(); } }} />
          <kbd>/</kbd>
        </label>

        <div className={classes.hright}>
          <Box ref={headerActionsRef} className={classes.headerActions}>
            {ribbons[pathname] ?? null}
          </Box>
          <span className={classes.hsep} aria-hidden="true" />
          <ShortcutHelp opened={helpOpen} onChange={setHelpOpen} />
          {(controlSummary?.active || eapprSummary?.enabled) && <ApprovalBell summary={controlSummary?.active ? controlSummary : null} eappr={eapprSummary?.enabled ? eapprSummary : null}
            onOpen={(item) => navigate(`/ControlManagement?tab=${controlSummary.can_manage || controlSummary.is_approver ? 'inbox' : 'mine'}`, { state: { request: item || null } })}
            onOpenEappr={(item) => navigate('/EApprovalInbox', { state: { doc: item || null } })} />}
          <Menu position="bottom-end" offset={8} width={248} shadow="md" withinPortal classNames={{ dropdown: classes.umenu }}>
            <Menu.Target>
              <button type="button" className={classes.ubtn} aria-label="사용자 메뉴">
                <IconUserCircle className={classes.uav} size={22} stroke={1.5} />
                <span>{userInfo.name ? `${userInfo.name}님` : '사용자'}</span>
                <IconChevronDown className={classes.uchev} size={13} stroke={2} />
              </button>
            </Menu.Target>
            <Menu.Dropdown>
              <div className={classes.uh}>
                <b>{userInfo.name ? `${userInfo.name}님` : '사용자'}</b>
                {userInfo.email && <span>{userInfo.email}</span>}
              </div>
              <Menu.Item className={classes.ui} leftSection={<IconKey size={18} stroke={1.7} />} onClick={openPwModal}>비밀번호 변경</Menu.Item>
              <Menu.Item className={`${classes.ui} ${classes.uiDanger}`} leftSection={<IconLogout size={18} stroke={1.7} />} onClick={handleLogout}>로그아웃</Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </div>

        <ConfirmDeleteModal opened={Boolean(pendingClose)} onClose={() => setPendingClose(null)}
          onConfirm={() => {
            const target = pendingClose;
            setPendingClose(null);
            if (target?.kind === 'all') closeAllTabs(true);
            else if (target?.kind === 'others') closeOtherTabs(true);
            else if (target?.kind === 'refresh') { if (target.path === pathname) refreshCurrentTab(true); }
            else if (target?.path) closePageTab(null, target.path, true);
          }}
          showIcon={false}
          title={pendingClose?.kind === 'all' || pendingClose?.kind === 'others' ? '저장하지 않은 화면이 있습니다' : '저장하지 않은 변경이 있습니다'}
          target={pendingClose?.kind === 'one' || pendingClose?.kind === 'refresh' ? findMenuLabel(mockdata, pendingClose.path) : undefined}
          message={pendingClose?.kind === 'refresh' ? '새로고침하면 저장하지 않은 내용이 사라집니다.' : '닫으면 저장하지 않은 내용이 사라집니다.'}
          note={pendingClose?.kind === 'refresh' ? '그래도 새로고침할까요?' : '그래도 닫을까요?'}
          confirmLabel={pendingClose?.kind === 'refresh' ? '새로고침' : '닫기'} />

        <ConfirmDeleteModal opened={Boolean(approvalNotice)} onClose={() => setApprovalNotice(null)}
          onConfirm={() => {   // 내 요청 탭을 열고 방금 올린 요청을 골라 둔다
            const requestno = approvalNotice?.requestno;
            setApprovalNotice(null);
            navigate('/ControlManagement?tab=mine', { state: { request: requestno ? { requestno } : null } });
          }}
          icon={<IconHourglass size={24} stroke={1.8} />} title={`${approvalNotice?.label ? `${approvalNotice.label} ` : ''}승인을 요청했습니다`}
          target={approvalNotice?.requestno} message={approvalNotice?.reason_text ? `${approvalNotice.reason_text} 승인 후 자동으로 반영됩니다.` : "승인 후 자동으로 반영됩니다."}
          note="진행 상황은 내 요청에서 확인할 수 있습니다." cancelLabel="닫기" confirmLabel="내 요청 보기" />

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

      <AppShell.Navbar className={classes.navBar} p={0} data-shell-chrome="">
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
            <IconLayoutSidebar size={18} stroke={ic.stroke} />
          </button>
        </AppShell.Section>
        <AppShell.Section grow className={classes.navScroll}>
          <SidebarNav items={visibleMockdata} pathname={pathname} collapsed={sidebarCollapsed} onExpand={expandSidebar} query={menuQuery}
            favoriteIds={favoriteIds} onToggleFavorite={toggleFavorite} onReorderFavorites={reorderFavorites} />
        </AppShell.Section>
      </AppShell.Navbar>

      <AppShell.Main className={`${classes.appMain} ${isDashboard ? classes.appMainDashboard : isInboundWorkspace ? classes.appMainInbound : ''}`}>
        <div className={classes.pageTabs} data-shell-chrome="">
         <div ref={tabsRowRef} className={classes.tabsRow} role="tablist" aria-label="열린 메뉴" onClickCapture={tabSort.onClickCapture}>
          <button type="button" className={`${classes.pageTab} ${classes.homeTab} ${isDashboard ? classes.pageTabActive : ''}`}
            title="대시보드" aria-label="대시보드" aria-current={isDashboard ? 'page' : undefined} onClick={() => navigate('/HomePage')}>
            <IconHome size={16} stroke={ic.stroke} />
          </button>
          {sortedPageTabs.map((tab) => {
            const label = findMenuLabel(mockdata, tab.path);
            // 끌리는 탭의 원래 자리: 같은 크기의 빈 칸 (이름 · 닫기 없음)
            if (tabSort.draggingId === tab.path) return <div key={tab.path} data-sort-id={tab.path} className={classes.tabPlaceholder} style={tabSort.placeholderSize} aria-hidden="true" />;
            return (
              <div key={tab.path} data-sort-id={tab.path} role="tab" aria-selected={pathname === tab.path} tabIndex={0}
                className={`${classes.pageTab} ${pathname === tab.path ? classes.pageTabActive : ''}`}
                {...tabSort.handleProps(tab.path)}
                onClick={() => navigate(tab.path)} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) navigate(tab.path); }}>
                <span className={classes.pageTabLabel} title={label}>{label}</span>
                <button type="button" className={classes.pageTabClose} aria-label={`${label} 닫기`}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => closePageTab(event, tab.path)}><IconX size={13} stroke={1.8} /></button>
              </div>
            );
          })}
         </div>
         {/* 끌고 있는 탭: 화면 위에 따로 (그림자) */}
         {tabSort.draggingId && createPortal(<div className={`${classes.pageTab} ${classes.pageTabActive} ${classes.tabFlying}`} style={tabSort.overlayStyle} aria-hidden="true">
           <span className={classes.pageTabLabel}>{findMenuLabel(mockdata, tabSort.draggingId)}</span>
           <span className={classes.pageTabClose}><IconX size={13} stroke={1.8} /></span>
         </div>, document.body)}
         <div className={classes.tabTools}>
          <button type="button" className={classes.tabTool} title="새로고침" aria-label="지금 탭 새로고침"
            onClick={() => refreshCurrentTab()} disabled={!pageCache[pathname] || undefined}>
            <IconReload key={refreshSpin} className={refreshSpin ? classes.spin : undefined} size={16} stroke={ic.stroke} />
          </button>
          <Menu position="bottom-end" withinPortal shadow="none" classNames={{ dropdown: classes.moreTabsDropdown }}>
            <Menu.Target>
              <button type="button" className={classes.tabTool} title="탭 닫기"
                aria-label={overflowPageTabs.length ? `탭 메뉴 · 나머지 열린 화면 ${overflowPageTabs.length}개` : '탭 메뉴'}>
                <IconDots size={16} stroke={ic.stroke} />{overflowPageTabs.length > 0 && <span className={classes.moreCount}>{overflowPageTabs.length}</span>}
              </button>
            </Menu.Target>
            <Menu.Dropdown>
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
              <Menu.Item className={classes.closeAllItem} onClick={() => closeOtherTabs()}
                disabled={!workTabs.some((tab) => tab.path !== pathname)}>현재 탭 제외 모두 닫기</Menu.Item>
              <Menu.Item className={classes.closeAllItem} onClick={() => closeAllTabs()} disabled={!workTabs.length}>탭 모두 닫기</Menu.Item>
            </Menu.Dropdown>
          </Menu>
         </div>
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
                element={entry.element} setRibbons={setRibbons} />
            ))}
          </MenuAccessContext.Provider>
        </div>
      </AppShell.Main>
      {canUseAssistant && <AIAssistant hideTab={String(pathname || '').replace(/\/+$/, '').toLowerCase() === '/aiassistant'} />}
    </AppShell>
  </>
  );

}


// ── 헤더 알림 (종) — 시안 '헤더 알림' 기준 ─────────────────────────
// [결재 | 통제] 탭으로 나눈다. 결재 = 내가 결재할 전자결재 문서, 통제 = 승인자는 대기 중 요청 / 담당자는 최근 2주 내 내 요청 결과.
// 처리해야 할 줄(결재할 문서 · 승인 대기 · 반려된 내 요청)은 안 읽은 줄처럼 색 바탕 + 점. 줄을 누르면 그 화면에서 연다.
const BELL_RESULT = { APPROVED: '승인되었습니다', REJECTED: '반려되었습니다', CANCELED: '취소되었습니다' };
const KST_PARTS = (value) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).formatToParts(value).map((part) => [part.type, part.value]));
// 오늘 오전 09:12 · 어제 오후 04:40 · 11월 27일 오전 11:08 (한국 시간)
const bellTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const at = KST_PARTS(date);
  const now = KST_PARTS(new Date());
  const yesterday = KST_PARTS(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const sameDay = (a, b) => a.year === b.year && a.month === b.month && a.day === b.day;
  const hour = Number(at.hour);
  const clock = `${hour < 12 ? '오전' : '오후'} ${String(hour % 12 || 12).padStart(2, '0')}:${at.minute}`;
  const day = sameDay(at, now) ? '오늘' : sameDay(at, yesterday) ? '어제' : `${Number(at.month)}월 ${Number(at.day)}일`;
  return `${day} ${clock}`;
};

function ApprovalBell({ summary, eappr, onOpen, onOpenEappr }) {
  const [opened, setOpened] = useState(false);
  const approverView = Boolean(summary && (summary.can_manage || summary.is_approver));
  const controlCount = summary ? (approverView ? summary.pending : summary.my_rejected) : 0;
  const eapprCount = eappr ? (eappr.todo || 0) : 0;
  const count = controlCount + eapprCount;
  const label = [eappr && `결재할 문서 ${eapprCount}건`, summary && (approverView ? `승인 대기 ${summary.pending}건` : `최근 반려 ${summary.my_rejected}건`)].filter(Boolean).join(' · ');
  // 열 때: 결재할 게 있거나 통제 알림이 없으면 결재 탭, 아니면 통제 탭 (시안과 같음)
  const defaultTab = eappr && (eapprCount || !controlCount || !summary) ? 'a' : 'c';
  const [tab, setTab] = useState(defaultTab);
  const currentTab = (tab === 'a' && !eappr) ? 'c' : (tab === 'c' && !summary) ? 'a' : tab;
  const toggle = () => setOpened((value) => { if (!value) setTab(defaultTab); return !value; });
  const open = (item) => { setOpened(false); onOpen(item); };
  const openEappr = (item) => { setOpened(false); onOpenEappr(item); };

  const eapprRows = (eappr?.items || []).map((item) => ({
    key: item.docno, kind: 'a', pending: true,
    tag: item.formname,
    title: `${item.writer_name || ''}${item.title ? ` · ${item.title}` : ''}`,
    sub: bellTime(item.submitted_at),
    onClick: () => openEappr(item),
  }));
  const controlRows = (summary?.items || []).map((item) => {
    const kindLabel = `${item.target_label} ${item.action_label}`;
    const pending = approverView ? ['PENDING', 'PROCESSING'].includes(item.status) : item.status === 'REJECTED';
    // 내용(거래처 · 전표번호 등)은 빼고 사람만: 승인자에게는 요청자, 요청한 사람에게는 처리한 사람
    const title = approverView
      ? `승인 요청${item.requested_name ? ` · ${item.requested_name}` : ''}`
      : `${BELL_RESULT[item.status] || '승인 대기 중입니다'}${item.decided_name ? ` · ${item.decided_name}` : ''}`;
    return {
      key: item.requestno, kind: 'c', pending, tag: kindLabel, title,
      sub: bellTime(item.decided_at || item.requested_at),   // 시간만
      onClick: () => open(item),
    };
  });
  const rows = currentTab === 'a' ? eapprRows : controlRows;

  return <Popover opened={opened} onChange={setOpened} position="bottom-end" offset={6} width={360} shadow="none" withinPortal>
    <Popover.Target>
      <button type="button" className={classes.bell} title={label} aria-label={label} onClick={toggle}>
        <IconBell size={18} stroke={2} />
        {count > 0 && <span className={classes.bellBadge}>{count > 99 ? '99+' : count}</span>}
      </button>
    </Popover.Target>
    <Popover.Dropdown className={classes.bellPanel}>
      <div className={classes.bellTabs} role="tablist" aria-label="알림 구분">
        {eappr && <button type="button" role="tab" aria-selected={currentTab === 'a'} className={currentTab === 'a' ? classes.bellTabOn : ''} onClick={() => setTab('a')}>
          결재 <em className={classes.bellCountA}>{eapprCount}</em></button>}
        {summary && <button type="button" role="tab" aria-selected={currentTab === 'c'} className={currentTab === 'c' ? classes.bellTabOn : ''} onClick={() => setTab('c')}>
          통제 <em className={classes.bellCountC}>{controlCount}</em></button>}
      </div>
      {rows.length ? <div className={classes.bellList}>
        {rows.map((row) => <button key={row.key} type="button" onClick={row.onClick}
          className={`${classes.bellItem} ${row.kind === 'a' ? classes.bellItemA : classes.bellItemC} ${row.pending ? classes.bellUnread : classes.bellRead}`}>
          <span className={classes.bellDot} aria-hidden="true" />
          <span className={classes.bellBody}>
            <span className={classes.bellTitle}>{row.tag && <em className={classes.bellTag}>{row.tag}</em>}<span>{row.title}</span></span>
            <span className={classes.bellSub}>{row.sub}</span>
          </span>
        </button>)}
      </div> : <div className={classes.bellEmpty}>알림이 없습니다</div>}
      <button type="button" className={classes.bellFoot} onClick={() => (currentTab === 'a' ? openEappr(null) : open(null))}>
        {currentTab === 'a' ? '결재함에서 모두 보기 ›' : '통제관리에서 모두 보기 ›'}
      </button>
    </Popover.Dropdown>
  </Popover>;
}
