
import { AppShell, Burger, Group, Text, Box, ScrollArea, Button, Stack, Modal, PasswordInput, Menu } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { SidebarNav } from './MainLayoutLink';
import classes from '../../styles/layout/MainLayout.module.css';
import { createContext, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation, useOutlet } from 'react-router-dom';
import { clearAIOrderPageSession } from '../../pages/ai/AIOrderPageSession';
import { clearAIOrderDraft } from '../../pages/ai/AIOrderDraft';
import {
  IconBox,
  IconCash,
  IconChevronDown,
  IconChevronsLeft,
  IconChevronsRight,
  IconClipboardText,
  IconCpu,
  IconHome,
  IconLogout,
  IconPackageExport,
  IconPackageImport,
  IconSettings,
  IconShieldLock,
  IconUser,
  IconUserCircle,
} from '@tabler/icons-react';
import '@mantine/notifications/styles.css';
import { notifications } from '@mantine/notifications';
import axios from 'axios'; // axios 추가
import { IconCheck, IconX } from '@tabler/icons-react'; // 아이콘 추가
import steel119Logo from '../../assets/img/logolast.png';

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
  return <div style={{ display: active ? 'contents' : 'none' }} data-tab-path={path} aria-hidden={active ? undefined : true}>
    <PageActiveContext.Provider value={active}>
      <PageActivationContext.Provider value={activation}>
        <PageRibbonContext.Provider value={ribbonContext}>{element}</PageRibbonContext.Provider>
      </PageActivationContext.Provider>
    </PageActiveContext.Provider>
  </div>;
});
export const MenuAccessContext = createContext({ menuids: [], loaded: false, authority: 'USER', fallbackPath: null });

// 메뉴 구성: 대메뉴 > 섹션(links 가 있는 항목) > 화면. 이름·순서는 네비게이션 시안(v185) 기준.
const ic = { size: 20, stroke: 1.8 };
const mockdata = [
  {
    label: '홈',
    icon: <IconHome {...ic} />,
    links: [
      { label: '업무현황', links: [
        { label: '대시보드', link: '/HomePage', MenuID: 'HOME' },
      ] },
    ],
  },
  {
    label: '매입',
    icon: <IconPackageImport {...ic} />,
    links: [
      { label: '매입관리', links: [
        { label: '매입등록', link: '/InboundRegisterPage', MenuID: 'INBOUND_REGISTER' },
        { label: '매입현황', link: '/InboundSearchPage', MenuID: 'INBOUND_SEARCH' },
      ] },
    ],
  },
  {
    label: '매출',
    icon: <IconPackageExport {...ic} />,
    links: [
      { label: '매출관리', links: [
        { label: '매출등록', link: '/OutboundRegisterPage', MenuID: 'OUTBOUND_REGISTER' },
        { label: '매출현황', link: '/OutboundSearchPage', MenuID: 'OUTBOUND_SEARCH' },
        { label: '매출이익 분석', link: '/GrossProfit', MenuID: 'GROSS_PROFIT' },
        { label: '매출이익 현황', link: '/GrossProfitDashboard', MenuID: 'GROSS_PROFIT_DASHBOARD' },
      ] },
    ],
  },
  {
    label: '가공',
    icon: <IconCpu {...ic} />,
    links: [
      { label: 'AI 가공솔루션', links: [
        { label: 'AI 주문서인식', link: '/AIOrderPage', MenuID: 'AI_ORDER_RECOGNITION' },
        { label: '주문서관리', link: '/AIOrderManage', MenuID: 'AI_ORDER_MANAGEMENT' },
        { label: '가공최적화', link: '/AIOrderOptimization', MenuID: 'AI_OPTIMIZATION' },
      ] },
      { label: '재고가공', links: [
        { label: '가공공정 관리', link: '/ItemProcessMaster', MenuID: 'ITEM_PROCESS_MASTER' },
        { label: '재고가공 등록', link: '/ItemProcessRegister', MenuID: 'ITEM_PROCESS_REGISTER' },
        { label: '재고가공 현황', link: '/ItemProcessSearch', MenuID: 'ITEM_PROCESS_SEARCH' },
      ] },
    ],
  },
  {
    label: '재고',
    icon: <IconBox {...ic} />,
    links: [
      { label: '재고관리', links: [
        { label: '기초재고 등록', link: '/StockStandPage', MenuID: 'STOCK_INITIAL' },
        { label: '현재고 현황', link: '/CurrentStockPage', MenuID: 'STOCK_CURRENT' },
        { label: '재고수불 현황', link: '/IniopStockPage', MenuID: 'STOCK_HISTORY' },
        { label: '재고이동 등록', link: '/InoutmoveRegister', MenuID: 'INOUTMOVE_REGISTER' },
        { label: '재고이동 현황', link: '/InoutmoveSearch', MenuID: 'INOUTMOVE_SEARCH' },
      ] },
    ],
  },
  {
    label: '자금',
    icon: <IconCash {...ic} />,
    links: [
      { label: '수금·지급', links: [
        { label: '수금·지급 등록', link: '/ReceiptPayment', MenuID: 'RECEIPT_PAYMENT' },
        { label: '수금·지급 현황', link: '/ReceiptPaymentSearch', MenuID: 'RECEIPT_PAYMENT_SEARCH' },
      ] },
      { label: '자금관리', links: [
        { label: '수표·어음 관리', link: '/InstrumentStatus', MenuID: 'INSTRUMENT_STATUS' },
        { label: '거래처원장', disabled: true },
      ] },
    ],
  },
  {
    label: '게시판',
    icon: <IconClipboardText {...ic} />,
    links: [
      { label: '상담관리', links: [
        { label: '상담게시판', link: '/CustomerSupport', MenuID: 'CUSTOMER_SUPPORT' },
      ] },
    ],
  },
  {
    label: '설정',
    icon: <IconSettings {...ic} />,
    links: [
      { label: '기준정보', links: [
        { label: '일반코드 관리', link: '/CodeMasterPage', MenuID: 'DATA_CODE' },
        { label: '품목코드 관리', link: '/ItemMasterPage', MenuID: 'DATA_ITEM' },
        { label: '거래처관리', link: '/CustomerPage', MenuID: 'DATA_CUSTOMER' },
      ] },
      { label: '운영정보', links: [
        { label: '사용자관리', disabled: true },
      ] },
    ],
  },
  {
    label: '어드민',
    icon: <IconShieldLock {...ic} />,
    links: [
      { label: '고객사정보', links: [
        { label: '고객사등록', link: '/Company', MenuID: 'COMPANY_REGISTRATION' },
        { label: '고객사관리', link: '/User', MenuID: 'COMPANY_USER_MANAGEMENT' },
        { label: '고객사 메뉴권한', link: '/UserMenu', MenuID: 'USER_MENU_PERMISSION' },
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
  };


  if (routeLabelAliases[normalizedPath]) return routeLabelAliases[normalizedPath];

  // 하위 섹션까지 내려가며 찾는다. 못 찾으면 '' (경로를 돌려주면 첫 섹션에서 바로 끝나 버린다)
  const found = flattenMenuLinks(items)
    .find((item) => item.link && normalizePath(item.link) === canonicalPath);
  if (found) return found.label;
  return canonicalPath === '/homepage' ? '대시보드' : path;
}

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
    '/currentstockpage', '/iniopstockpage', '/stockstandpage', '/aiordermanage', '/aiorderoptimization', '/itemprocessmaster', '/itemprocessregister', '/itemprocesssearch', '/customersupport',
    '/outboundregisterpage', '/outboundsearchpage', '/inoutmoveregister', '/inoutmovesearch', '/receiptpayment', '/receiptpaymentsearch', '/instrumentstatus', '/grossprofit', '/grossprofitdashboard', '/company', '/user', '/usermenu',
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
  const visiblePageTabs = useMemo(() => {
    const maxVisible = 10;
    if (pageTabs.length <= maxVisible) return pageTabs;
    const initialTabs = pageTabs.slice(0, maxVisible);
    if (initialTabs.some((tab) => tab.path === pathname)) return initialTabs;
    return [...pageTabs.slice(0, maxVisible - 1), pageTabs.find((tab) => tab.path === pathname)].filter(Boolean);
  }, [pageTabs, pathname]);
  const overflowPageTabs = useMemo(
    () => pageTabs.filter((tab) => !visiblePageTabs.some((visibleTab) => visibleTab.path === tab.path)),
    [pageTabs, visiblePageTabs],
  );

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
  // 화면별 리본의 [닫기]가 항상 최신 closePageTab 을 쓰도록
  const closeTabRef = useRef(closePageTab);
  useLayoutEffect(() => { closeTabRef.current = closePageTab; }, [closePageTab]);

  const [myPermissions, setMyPermissions] = useState([]);
  const [myPermissionsLoaded, setMyPermissionsLoaded] = useState(false);
  const [currentAuthority, setCurrentAuthority] = useState(() =>
    String(localStorage.getItem('user_authority') || 'USER').toUpperCase()
  );
  const [currentCompanyId, setCurrentCompanyId] = useState(() =>
    String(localStorage.getItem('user_company') || '')
  );

  const [userInfo, setUserInfo] = useState(() => {
    
    const name = localStorage.getItem('user_name');
    const email = localStorage.getItem('user_email');
    // 초기값이 있으면 그 값을 사용하고, 없으면 빈 문자열을 반환합니다.
    return { 
      name: name || '', 
      email: email || '' 
    };
  });

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
        setMyPermissions(data.menuids || []);
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
          navigate('/login', { replace: true });
        }
      }
    });

    return () => { cancelled = true; };
  }, [navigate, pathname, userInfo.email]);

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
  if (link.link === '/Company') return isPlatformMaster;
  if (link.link === '/User' || link.link === '/UserMenu') return ['MASTER', 'SUBMASTER'].includes(currentAuthority);
  if (link.link === '/CustomerSupport') return isPlatformMaster;
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

const menuAccessContextValue = {
  menuids: myPermissions,
  loaded: myPermissionsLoaded,
  authority: currentAuthority,
  companyid: currentCompanyId,
  fallbackPath: firstAccessiblePath || '/HomePage',
};

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
      className={`${isInboundWorkspace || isDashboard ? classes.appShellInbound : ''} ${sidebarCollapsed ? `${classes.sidebarCollapsed} steel119-sidebar-collapsed` : ''}`}
      header={{ height: 54 }}
      navbar={{
        width: sidebarCollapsed ? 62 : 210,
        breakpoint: 'sm',
        collapsed: { mobile: !opened },
      }}
      padding="sm"
    >
      <AppShell.Header className={classes.appHeader}>
        <Burger className={classes.mobileBurger} opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />

        <Box className={classes.headerActions}>
          {ribbons[pathname] ?? null}
        </Box>

        <Group className={classes.headerUser} gap={10} wrap="nowrap">
          <Group
            className={classes.userIdentity}
            gap={9}
            wrap="nowrap"
            onClick={openPwModal}
            title="비밀번호 변경"
            role="button"
            tabIndex={0}
            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') openPwModal(); }}
          >
            <IconUserCircle className={classes.userIcon} size={18} stroke={1.8} />
            <span className={classes.userName}>{userInfo.name ? `${userInfo.name}님` : <IconUser size={15} />}</span>
          </Group>
          <span className={classes.userDivider} aria-hidden="true">|</span>
          <button type="button" className={classes.logoutButton} onClick={handleLogout}>
            <IconLogout size={16} stroke={1.8} />
            <span>로그아웃</span>
          </button>
        </Group>

        <Modal opened={pwModalOpened} onClose={closePwModal} title={<Text fw={700} size="md">비밀번호 수정</Text>} centered size="sm" padding="md">
            <form onSubmit={handlePasswordChange}>
              <Stack gap="md">
                {/* [필수 수정] value와 onChange를 연결해야 pwdForm에 값이 담깁니다. */}
                <PasswordInput 
                  label="현재 비밀번호" 
                  size="sm"
                  required 
                  value={pwdForm.current}
                  onChange={(e) => setPwdForm({ ...pwdForm, current: e.target.value })}
                />
                <PasswordInput 
                  label="새 비밀번호" 
                  size="sm"
                  required 
                  value={pwdForm.next}
                  onChange={(e) => setPwdForm({ ...pwdForm, next: e.target.value })}
                />
                <PasswordInput 
                  label="새 비밀번호 확인" 
                  size="sm"
                  required 
                  value={pwdForm.confirm}
                  onChange={(e) => setPwdForm({ ...pwdForm, confirm: e.target.value })}
                />
                <Group justify="flex-end" mt="xs">
                  <Button size="sm" variant="outline" color="gray" onClick={closePwModal}>취소</Button>
                  <Button size="sm" type="submit" color="red.8">패스워드 변경</Button>
                </Group>
              </Stack>
            </form>
        </Modal>
      </AppShell.Header>

      <AppShell.Navbar className={classes.navBar} p={0}>
        <AppShell.Section className={classes.sideHead}>
          <div className={classes.logoSlot}>
            <img src={steel119Logo} alt="스틸119" />
          </div>
          <button
            type="button"
            className={classes.sidebarToggle}
            onClick={toggleSidebar}
            aria-label={sidebarCollapsed ? '네비게이션 펼치기' : '네비게이션 접기'}
            title={sidebarCollapsed ? '로고·네비게이션 함께 펼치기' : '로고·네비게이션 함께 접기'}
          >
            {sidebarCollapsed ? <IconChevronsRight size={20} stroke={1.8} /> : <IconChevronsLeft size={20} stroke={1.8} />}
          </button>
        </AppShell.Section>
        <AppShell.Section grow component={ScrollArea} type="hover" scrollbars="y" scrollbarSize={6} className={classes.navScroll}>
          <SidebarNav items={visibleMockdata} pathname={pathname} collapsed={sidebarCollapsed} onExpand={expandSidebar} />
        </AppShell.Section>
      </AppShell.Navbar>

      <AppShell.Main className={`${classes.appMain} ${isDashboard ? classes.appMainDashboard : isInboundWorkspace ? classes.appMainInbound : ''}`}>
        <div className={classes.pageTabs} role="tablist" aria-label="열린 메뉴">
          {visiblePageTabs.map((tab) => {
            const label = findMenuLabel(mockdata, tab.path);
            return (
              <div key={tab.path} role="tab" aria-selected={pathname === tab.path} tabIndex={0}
                className={`${classes.pageTab} ${pathname === tab.path ? classes.pageTabActive : ''} ${String(tab.path || '').replace(/\/+$/, '').toLowerCase() === '/user' ? classes.pageTabNoBold : ''}`}
                onClick={() => navigate(tab.path)} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) navigate(tab.path); }}>
                <span className={classes.pageTabLabel} title={label}>{label}</span>
                <button type="button" className={classes.pageTabClose} aria-label={`${label} 닫기`}
                  onClick={(event) => closePageTab(event, tab.path)}>×</button>
              </div>
            );
          })}
          {overflowPageTabs.length > 0 && <Menu position="bottom-end" withinPortal shadow="sm">
            <Menu.Target>
              <button type="button" className={classes.moreTabsButton} aria-label={`나머지 열린 화면 ${overflowPageTabs.length}개`}>
                더보기 <span>{overflowPageTabs.length}</span><IconChevronDown className={classes.moreTabsChevron} size={13} stroke={1.8} aria-hidden="true" />
              </button>
            </Menu.Target>
            <Menu.Dropdown className={classes.moreTabsDropdown}>
              <div className={classes.moreTabsHeading}>열린 화면 {pageTabs.length}개</div>
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
            </Menu.Dropdown>
          </Menu>}
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
