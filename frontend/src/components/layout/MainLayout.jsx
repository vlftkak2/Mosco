
import { AppShell, Burger, Group, Text, Box, Button, Stack, Modal, PasswordInput, Menu } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import MainLayoutNav, { categoryOfPath, normalizePath } from './MainLayoutNav';
import classes from '../../styles/layout/MainLayout.module.css';
import { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate,useLocation } from 'react-router-dom';
import { clearAIOrderPageSession } from '../../pages/ai/AIOrderPageSession';
import {
  IconArrowsDownUp,
  IconBox,
  IconCash,
  IconCheck,
  IconClipboardText,
  IconChevronDown,
  IconCpu,
  IconHome,
  IconLogout,
  IconSettings,
  IconShieldLock,
  IconUser,
  IconX,
} from '@tabler/icons-react';
import '@mantine/notifications/styles.css';
import { notifications } from '@mantine/notifications';
import axios from 'axios';

export const PageRibbonContext = createContext(null);
export const MenuAccessContext = createContext({ menuids: [], loaded: false, authority: 'USER', fallbackPath: null });

// 대메뉴(레일) > 그룹 > 상세 메뉴. MenuID 는 menucatalog01t 권한 키
const MENU = [
  { key: 'main', label: '메인', icon: IconHome, groups: [
    { label: '메인', links: [
      { label: '대시보드(EX)', link: '/HomePage', MenuID: 'HOME' },
    ] },
  ] },
  { key: 'inout', label: '입출고', icon: IconArrowsDownUp, groups: [
    { label: '입고 관리', links: [
      { label: '입고등록', link: '/InboundRegisterPage', MenuID: 'INBOUND_REGISTER' },
      { label: '입고현황', link: '/InboundSearchPage', MenuID: 'INBOUND_SEARCH' },
    ] },
    { label: '출고 관리', links: [
      { label: '출고등록', link: '/OutboundRegisterPage', MenuID: 'OUTBOUND_REGISTER' },
      { label: '출고현황', link: '/OutboundSearchPage', MenuID: 'OUTBOUND_SEARCH' },
    ] },
    { label: '매출 분석', links: [
      { label: '매출이익분석', link: '/GrossProfit', MenuID: 'GROSS_PROFIT' },
      { label: '매출이익 현황판', link: '/GrossProfitDashboard', MenuID: 'GROSS_PROFIT_DASHBOARD' },
    ] },
  ] },
  { key: 'process', label: '가공', icon: IconCpu, groups: [
    { label: 'AI 파이프라인', links: [
      { label: 'AI 주문서 인식', link: '/AIOrderPage', MenuID: 'AI_ORDER_RECOGNITION' },
      { label: '주문서 관리', link: '/AIOrderManage', MenuID: 'AI_ORDER_MANAGEMENT' },
      { label: '가공 최적화(EX)', link: '/AIOrderOptimization', MenuID: 'AI_OPTIMIZATION' },
      { label: '가공기준 관리(EX)', link: '/AIProcessingStandards', MenuID: 'AI_STANDARDS' },
    ] },
    { label: '공정', links: [
      { label: '가공공정 관리', link: '/ItemProcessMaster', MenuID: 'ITEM_PROCESS_MASTER' },
      { label: '가공등록', link: '/ItemProcessRegister', MenuID: 'ITEM_PROCESS_REGISTER' },
      { label: '가공현황', link: '/ItemProcessSearch', MenuID: 'ITEM_PROCESS_SEARCH' },
    ] },
  ] },
  { key: 'stock', label: '재고', icon: IconBox, groups: [
    { label: '재고 현황', links: [
      { label: '현재고현황', link: '/CurrentStockPage', MenuID: 'STOCK_CURRENT' },
      { label: '재고수불현황', link: '/IniopStockPage', MenuID: 'STOCK_HISTORY' },
    ] },
    { label: '재고 등록', links: [
      { label: '기초재고등록', link: '/StockStandPage', MenuID: 'STOCK_INITIAL' },
      { label: '재고이전등록', link: '/InoutmoveRegister', MenuID: 'INOUTMOVE_REGISTER' },
      { label: '재고이전현황', link: '/InoutmoveSearch', MenuID: 'INOUTMOVE_SEARCH' },
    ] },
  ] },
  { key: 'fund', label: '자금', icon: IconCash, groups: [
    { label: '수금/지급', links: [
      { label: '수금/지급 등록', link: '/ReceiptPayment', MenuID: 'RECEIPT_PAYMENT' },
      { label: '수금/지급 현황', link: '/ReceiptPaymentSearch', MenuID: 'RECEIPT_PAYMENT_SEARCH' },
      { label: '수표/어음 현황', link: '/InstrumentStatus', MenuID: 'INSTRUMENT_STATUS' },
    ] },
  ] },
  { key: 'board', label: '게시판', icon: IconClipboardText, groups: [
    { label: '커뮤니케이션', links: [
      { label: '고객지원(EX)', link: '/CustomerSupport', MenuID: 'CUSTOMER_SUPPORT' },
      { label: '공지사항', link: '/board/notice', disabled: true, badge: '준비중' },
      { label: '자료실', link: '/board/archive', disabled: true, badge: '준비중' },
      { label: '사내게시판', link: '/board/internal', disabled: true, badge: '준비중' },
    ] },
  ] },
  { key: 'settings', label: '설정', icon: IconSettings, groups: [
    { label: '기준정보', links: [
      { label: '일반코드', link: '/CodeMasterPage', MenuID: 'DATA_CODE' },
      { label: '품목코드', link: '/ItemMasterPage', MenuID: 'DATA_ITEM' },
      { label: '거래처관리', link: '/CustomerPage', MenuID: 'DATA_CUSTOMER' },
    ] },
    { label: '시스템설정', links: [
      { label: '사용자 관리', link: '/User', MenuID: 'COMPANY_USER_MANAGEMENT' },
      { label: '사용자 메뉴권한', link: '/UserMenu', MenuID: 'USER_MENU_PERMISSION' },
    ] },
  ] },
  { key: 'admin', label: '어드민', icon: IconShieldLock, groups: [
    { label: '플랫폼 관리', links: [
      { label: '고객사등록', link: '/Company', MenuID: 'COMPANY_REGISTRATION' },
    ] },
  ] },
];
const MENU_LINKS = MENU.flatMap((category) => category.groups.flatMap((group) => group.links));
const NAV_RAIL_WIDTH = 72;
const NAV_PANEL_WIDTH = 204;
const NAV_PANEL_STORAGE_KEY = 'steel119-nav-panel-open';

function findMenuLabel(items, path) {
  const normalizedPath = normalizePath(path);
  const canonicalPath = normalizedPath === '/inboundregister'
    ? '/inboundregisterpage'
    : normalizedPath;
  const routeLabelAliases = {
    '/iniopstockpage': '재고수불현황',
    '/stockstandpage': '기초재고등록',
    '/inboundregister': '입고등록',
    '/inboundregisterpage': '입고등록',
    '/inboundsearch': '입고현황',
    '/inboundsearchpage': '입고현황',
    '/currentstockpage': '현재고현황',
    '/outboundregisterpage': '출고등록',
    '/outboundsearchpage': '출고현황',
    '/receiptpayment': '수금/지급 등록',
    '/receiptpaymentsearch': '수금/지급 현황',
    '/instrumentstatus': '수표/어음 현황',
    '/grossprofit': '매출이익분석',
    '/grossprofitdashboard': '매출이익 현황판',
    '/inoutmoveregister': '재고이전등록',
    '/inoutmovesearch': '재고이전현황',
    '/aiorderpage': 'AI 가공솔루션',
    '/aiordermanage': '주문서 관리',
    '/aiorderoptimization': '가공 최적화',
    '/aiprocessingstandards': '가공기준 관리',
    '/itemprocessmaster': '가공공정 관리',
    '/itemprocessregister': '가공등록',
    '/itemprocesssearch': '가공현황',
    '/customersupport': '고객지원',
    '/company': '고객사등록',
    '/user': '사용자 관리',
    '/usermenu': '사용자 메뉴권한',
  };

  if (routeLabelAliases[normalizedPath]) return routeLabelAliases[normalizedPath];

  const found = items.find((item) => normalizePath(item.link) === canonicalPath);
  if (found) return found.label;
  return canonicalPath === '/homepage' ? '대시보드' : path;
}

export default function MainLayout({ children }) {
  const [opened, { toggle }] = useDisclosure();
  const [panelOpen, setPanelOpen] = useState(() => {
    try {
      return localStorage.getItem(NAV_PANEL_STORAGE_KEY) !== 'N';
    } catch {
      return true;
    }
  });
  const [pwModalOpened, { open: openPwModal, close: closePwModal }] = useDisclosure(false);

  const [pwdForm, setPwdForm] = useState({
    current: '',
    next: '',
    confirm: ''
  });

  const navigate = useNavigate();
  const changePanelOpen = useCallback((next) => {
    setPanelOpen(next);
    try {
      localStorage.setItem(NAV_PANEL_STORAGE_KEY, next ? 'Y' : 'N');
    } catch {
      // 저장 실패해도 현재 화면에서는 접기/펼치기가 동작한다.
    }
  }, []);
  const { pathname } = useLocation(); // 2. 현재 경로 가져오기
  const isDashboard = String(pathname || '').replace(/\/+$/, '').toLowerCase() === '/homepage';
  const isInboundWorkspace = [
    '/inboundregisterpage', '/inboundregister', '/inboundsearchpage', '/inboundsearch',
    '/customerpage', '/itemmasterpage', '/codemasterpage', '/aiorderpage',
    '/currentstockpage', '/iniopstockpage', '/stockstandpage', '/aiordermanage', '/aiorderoptimization', '/aiprocessingstandards', '/itemprocessmaster', '/itemprocessregister', '/itemprocesssearch', '/customersupport',
    '/outboundregisterpage', '/outboundsearchpage', '/inoutmoveregister', '/inoutmovesearch', '/receiptpayment', '/receiptpaymentsearch', '/instrumentstatus', '/grossprofit', '/grossprofitdashboard', '/company', '/user', '/usermenu',
  ].includes(String(pathname || '').replace(/\/+$/, '').toLowerCase());
  const [pageRibbon, setPageRibbon] = useState(null);
  const registerPageRibbon = useCallback((content) => setPageRibbon(() => content), []);
  const [tabState, setTabState] = useState(() => ({
    pathname,
    tabs: [{ path: pathname, label: findMenuLabel(MENU_LINKS, pathname) }],
  }));
  if (pathname !== tabState.pathname) {
    const tab = { path: pathname, label: findMenuLabel(MENU_LINKS, pathname) };
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
    const remaining = pageTabs.filter((tab) => tab.path !== path);
    if (!remaining.length) remaining.push({ path: '/HomePage', label: findMenuLabel(MENU_LINKS, '/HomePage') });
    setTabState({ pathname, tabs: remaining });
    if (pathname === path) navigate(remaining[remaining.length - 1].path);
  }, [pageTabs, pathname, navigate]);
  const closeActivePage = useCallback(() => closePageTab(null, pathname), [closePageTab, pathname]);
  const pageRibbonContextValue = useMemo(
    () => ({ registerPageRibbon, closeActivePage }),
    [registerPageRibbon, closeActivePage],
  );

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
    ['access_token', 'user_name', 'user_email', 'user_company', 'user_companyname', 'user_authority']
      .forEach((key) => localStorage.removeItem(key));
    navigate('/login');
  }


const isPlatformMaster = currentCompanyId === '001' && currentAuthority === 'MASTER';
const canSeeLink = (link) => {
  if (link.link === '/Company') return isPlatformMaster;
  if (link.link === '/User' || link.link === '/UserMenu') return ['MASTER', 'SUBMASTER'].includes(currentAuthority);
  if (isPlatformMaster) return true;
  if (link.link === '/CustomerSupport') return false;
  return !link.MenuID || myPermissions.includes(link.MenuID);
};
const visibleMenu = MENU
  .map((category) => ({
    ...category,
    groups: category.groups
      .map((group) => ({ ...group, links: group.links.filter(canSeeLink) }))
      .filter((group) => group.links.length > 0),
  }))
  .filter((category) => category.groups.length > 0);

const firstAccessiblePath = visibleMenu
  .flatMap((category) => category.groups.flatMap((group) => group.links))
  .find((link) => !link.disabled && link.link !== '/HomePage')?.link;
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

const currentCategoryKey = categoryOfPath(visibleMenu, pathname);
// 사용자가 고른 대메뉴. 화면을 이동하면 그 화면의 대메뉴로 돌아간다.
const [navSelection, setNavSelection] = useState({ pathname, key: null });
const selectedKey = navSelection.pathname === pathname && navSelection.key ? navSelection.key : null;
// 상세를 접으면 레일은 항상 현재 화면의 대메뉴를 표시
const activeCategoryKey = (panelOpen && selectedKey && visibleMenu.some((category) => category.key === selectedKey))
  ? selectedKey
  : currentCategoryKey || visibleMenu[0]?.key || null;

const handleSelectCategory = (key) => {
  if (key === activeCategoryKey && panelOpen) {
    changePanelOpen(false);
    return;
  }
  setNavSelection({ pathname, key });
  if (!panelOpen) changePanelOpen(true);
};
const handleNavigate = (link) => {
  if (opened) toggle();
  if (normalizePath(link) !== normalizePath(pathname)) navigate(link);
};
const navbarWidth = NAV_RAIL_WIDTH + (panelOpen && activeCategoryKey ? NAV_PANEL_WIDTH : 0);

const menuAccessContextValue = {
  menuids: myPermissions,
  loaded: myPermissionsLoaded,
  authority: currentAuthority,
  companyid: currentCompanyId,
  // 권한 없는 화면 → 첫 허용 메뉴, 하나도 없으면 대시보드(안내 문구)
  fallbackPath: firstAccessiblePath || '/HomePage',
};


  return (
    <>
    <AppShell
      className={isInboundWorkspace || isDashboard ? classes.appShellInbound : ''}
      layout="alt"
      header={{ height: 49 }}
      navbar={{
        width: navbarWidth,
        breakpoint: 'sm',
        collapsed: { mobile: !opened },
      }}
      padding="sm"
    >
      <AppShell.Header className={classes.appHeader}>
        <Box className={classes.mobileBurger} hiddenFrom="sm">
          <Burger opened={opened} onClick={toggle} size="sm" aria-label="메뉴 열기" />
        </Box>

        <Box className={classes.headerActions}>
          {pageRibbon}
        </Box>

        <Group className={classes.headerUser} gap={8} wrap="nowrap">
          <Group
            className={classes.userIdentity}
            gap={0}
            onClick={openPwModal}
            title="비밀번호 변경"
            role="button"
            tabIndex={0}
            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') openPwModal(); }}
          >
            <Text size="xs" fw={600}>{userInfo.name ? `${userInfo.name}님` : <IconUser size={15} />}</Text>
          </Group>
          <Box className={classes.userDivider} aria-hidden="true" />
          <Button
            className={classes.logoutButton}
            variant="subtle"
            size="xs"
            leftSection={<IconLogout size={15} />}
            onClick={handleLogout}
          >
            로그아웃
          </Button>
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
        <MainLayoutNav
          categories={visibleMenu}
          pathname={pathname}
          activeKey={activeCategoryKey}
          currentKey={currentCategoryKey}
          panelOpen={panelOpen}
          onSelect={handleSelectCategory}
          onTogglePanel={() => changePanelOpen(!panelOpen)}
          onNavigate={handleNavigate}
        />

      </AppShell.Navbar>

      <AppShell.Main className={`${classes.appMain} ${isDashboard ? classes.appMainDashboard : isInboundWorkspace ? classes.appMainInbound : ''}`}>
        <div className={classes.pageTabs} role="tablist" aria-label="열린 메뉴">
          {visiblePageTabs.map((tab) => {
            const label = findMenuLabel(MENU_LINKS, tab.path);
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
                const label = findMenuLabel(MENU_LINKS, tab.path);
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
          <PageRibbonContext.Provider value={pageRibbonContextValue}>
            {isDashboard && !isPlatformMaster && !myPermissionsLoaded
              ? <Text c="dimmed" ta="center" mt="xl">메뉴 권한을 확인하고 있습니다.</Text>
              : isDashboard && !isPlatformMaster && !myPermissions.includes('HOME')
                ? <Text c="dimmed" ta="center" mt="xl">
                    {noAccessibleMenus
                      ? '접근할 수 있는 메뉴가 없습니다. 관리자에게 메뉴 권한을 요청해 주세요.'
                      : '대시보드 권한이 없어 허용된 메뉴로 이동합니다.'}
                  </Text>
                : children}
          </PageRibbonContext.Provider>
          </MenuAccessContext.Provider>
        </div>
      </AppShell.Main>
    </AppShell>
  </>
  );

}
