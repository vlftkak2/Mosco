
import { AppShell, Burger, Group, Text, Box, ScrollArea, Button, Stack, Modal, TextInput, PasswordInput } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { LinksGroup } from './MainLayoutLink';
import classes from '../../styles/layout/MainLayout.module.css';
import { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate,useLocation } from 'react-router-dom';
import { 
  IconAddressBook,
  IconAdjustmentsHorizontal,
  IconBuildingWarehouse,
  IconFolder,
  IconHeadset,
  IconLayoutDashboard,
  IconLogout,
  IconPackage,
  IconTool,
  IconTruckDelivery,
  IconTruckLoading,
  IconUser,
  IconUsers,
  IconRobot
} from '@tabler/icons-react';
import '@mantine/notifications/styles.css';
import { Notifications, notifications } from '@mantine/notifications';
import axios from 'axios'; // axios 추가
import { IconCheck, IconX } from '@tabler/icons-react'; // 아이콘 추가
import steel119HomeLogo from '../../assets/img/steel119-home.png';

export const PageRibbonContext = createContext(null);

const mockdata = [
  {
    label: '대시보드(EX)',
    icon: <IconLayoutDashboard size={18} stroke={1.8} />,
    link: '/HomePage',
    initiallyOpened: false,
    MenuID:null,
  },

    {
    label: '기준정보',
    icon: <IconFolder size={18} stroke={1.8} />,
    initiallyOpened: false,
    links: [
      {label: '일반코드',link: '/CodeMasterPage',icon: '',MenuID: 'M1'},
      { label: '품목코드', link: '/ItemMasterPage', icon: '', MenuID: 'M7' },
      { label: '거래처관리', link: '/CustomerPage', icon: '', MenuID:'M-11' },

    ],
  },  
 
  {
    label: '입고관리',
    icon: <IconTruckDelivery size={18} stroke={1.8} />,
    initiallyOpened: false,
    links: [
      { label: '입고등록', link: '/InboundRegisterPage', icon: '✔️', MenuID:'M-14' },
      { label: '입고현황', link: '/InboundSearchPage', icon: '✔️', MenuID:'M-16' },
    ],
  },

  {
    label: 'AI 가공관리',
    icon: <IconRobot size={18} stroke={1.8} />,
    initiallyOpened: false,
    links: [
      { label: 'AI 주문서 인식', link: '/AIOrderPage', icon: '', MenuID: 'AI-ORDER-TEST' },
      { label: '주문서 관리(EX)', link: '/AIOrderManage', icon: '', MenuID: 'AI-ORDER-TEST' },
      { label: '가공 최적화(EX)', link: '/AIOrderOptimization', icon: '', MenuID: 'AI-ORDER-TEST' },
      { label: '가공기준 관리(EX)', link: '/AIProcessingStandards', icon: '', MenuID: 'AI-ORDER-TEST' },

      // { label: '가공 진행현황', link: '/AIOrderConfirmPage', icon: '', MenuID: 'AI-ORDER-TEST' },
        
    ],
  },  

  
  {
    label: '재고관리',
    icon: <IconPackage size={18} stroke={1.8} />,
    initiallyOpened: false,
    links: [
      { label: '기초재고등록', link: '/StockStandPage', icon: '', MenuID: 'M-24' },
      { label: '재고수불현황', link: '/IniopStockPage', icon: '', MenuID:'M-12' },
      { label: '현재고현황', link: '/CurrentStockPage', icon: '', MenuID:'M-11' },
    ],
  },     

  {
    label: '출고관리',
    icon: <IconTruckLoading size={18} stroke={1.8} />,
    initiallyOpened: false,
    links: [
      
      { label: '출고등록', link: '/OutboundRegisterPage', icon: '', MenuID: 'M-22' },
      { label: '출고현황', link: '/OutboundSearchPage', icon: '', MenuID: 'M-23' },
    ],
  },

  {
    label: '고객지원(EX)',
    icon: <IconHeadset size={18} stroke={1.8} />,
    initiallyOpened: false,
    link: '/CustomerSupport',
    MenuID: 'M-22',
  },



  {
    label: '시스템관리',
    icon: <IconAdjustmentsHorizontal size={18} stroke={1.8} />,
    initiallyOpened: false,
    links: [
      { label: '고객사등록', link: '/', icon: '✔️', MenuID:'M-17', disabled: true},
      { label: '고객사 권한관리', link: '/', icon: '✔️', MenuID:'M-18', disabled: true},
      { label: '설정', link: '/', icon: '✔️', MenuID:'M-19', disabled: true},
    ],
  },

];

function findMenuLabel(items, path) {
  const normalizePath = (value) => String(value || '').replace(/\/+$/, '').toLowerCase() || '/';
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
    '/aiorderpage': 'AI 가공솔루션',
    '/aiordermanage': '주문서 관리',
    '/aiorderoptimization': '가공 최적화',
    '/aiprocessingstandards': '가공기준 관리',
    '/customersupport': '고객지원',
  };

  if (routeLabelAliases[normalizedPath]) return routeLabelAliases[normalizedPath];

  for (const item of items) {
    if (item.link && normalizePath(item.link) === canonicalPath) return item.label;
    const nested = item.links ? findMenuLabel(item.links, path) : '';
    if (nested) return nested;
  }
  return canonicalPath === '/homepage' ? '대시보드' : path;
}

export default function MainLayout({ children }) {
  const [opened, { toggle }] = useDisclosure();
  const [pwModalOpened, { open: openPwModal, close: closePwModal }] = useDisclosure(false);

  const [pwdForm, setPwdForm] = useState({
    current: '',
    next: '',
    confirm: ''
  });

  const navigate = useNavigate();
  const { pathname } = useLocation(); // 2. 현재 경로 가져오기
  const isDashboard = String(pathname || '').replace(/\/+$/, '').toLowerCase() === '/homepage';
  const isInboundWorkspace = [
    '/inboundregisterpage', '/inboundregister', '/inboundsearchpage', '/inboundsearch',
    '/customerpage', '/itemmasterpage', '/codemasterpage', '/aiorderpage', '/aiorderconfirmpage',
    '/currentstockpage', '/iniopstockpage', '/stockstandpage', '/aiordermanage', '/aiorderoptimization', '/aiprocessingstandards', '/customersupport',
    '/outboundregisterpage', '/outboundsearchpage',
  ].includes(String(pathname || '').replace(/\/+$/, '').toLowerCase());
  const [pageRibbon, setPageRibbon] = useState(null);
  const registerPageRibbon = useCallback((content) => setPageRibbon(() => content), []);
  const [tabState, setTabState] = useState(() => ({
    pathname,
    tabs: [{ path: pathname, label: findMenuLabel(mockdata, pathname) }],
  }));
  if (pathname !== tabState.pathname) {
    const tab = { path: pathname, label: findMenuLabel(mockdata, pathname) };
    const tabs = tabState.tabs.some((item) => item.path === tab.path)
      ? tabState.tabs
      : [...tabState.tabs, tab];
    setTabState({ pathname, tabs });
  }
  const pageTabs = useMemo(
    () => tabState.tabs.filter((tab) => String(tab.path || '').replace(/\/+$/, '').toLowerCase() !== '/homepage'),
    [tabState.tabs],
  );

  const closePageTab = useCallback((event, path) => {
    event?.stopPropagation?.();
    const remaining = pageTabs.filter((tab) => tab.path !== path);
    if (!remaining.length) remaining.push({ path: '/HomePage', label: findMenuLabel(mockdata, '/HomePage') });
    setTabState({ pathname, tabs: remaining });
    if (pathname === path) navigate(remaining[remaining.length - 1].path);
  }, [pageTabs, pathname, navigate]);
  const closeActivePage = useCallback(() => closePageTab(null, pathname), [closePageTab, pathname]);
  const pageRibbonContextValue = useMemo(
    () => ({ registerPageRibbon, closeActivePage }),
    [registerPageRibbon, closeActivePage],
  );

  const [myPermissions, setMyPermissions] = useState([]);

  //   /* 잠시 주석처리 */
  // useEffect(() => {
  //   const fetchMyAuth = async () => {
  //     const myEmail = localStorage.getItem('user_email');
  //     if (!myEmail) return;

  //     try {
  //       // UserAuthPage에서 썼던 API를 그대로 활용해서 '나'의 권한만 추출
  //       //const res = await axios.get(`http://${window.location.hostname}/api/menu-user-Authemaillist`, {
  //       const res = await axios.get(`/api/menu-user-Authemaillist`, {
  //         params: { email: myEmail } // 내 이메일로 검색
  //       });

  //       if (res.data.success && res.data.data.length > 0) {
  //         const me = res.data.data[0];
  //         const teamAuths = me.TeamAuths || [];
  //         const userExceptions = me.UserExceptions || [];
          
  //         const finalSet = new Set(teamAuths.map(t => t.MenuID));
  //         userExceptions.forEach(ex => {
  //           if (ex.AuthType === 'GRANT') finalSet.add(ex.MenuID);
  //           if (ex.AuthType === 'DENY') finalSet.delete(ex.MenuID);
  //         });
  //         console.log("실제 내 권한 리스트:", Array.from(finalSet));
  //         setMyPermissions(Array.from(finalSet));
  //       }
  //     } catch (error) {
  //       console.error("내 권한 로드 실패:", error);
  //     }
  //   };

  //   fetchMyAuth();
  // }, []);

  

  const [userInfo, setUserInfo] = useState(() => {
    
    const name = localStorage.getItem('user_name');
    const email = localStorage.getItem('user_email');
    // 초기값이 있으면 그 값을 사용하고, 없으면 빈 문자열을 반환합니다.
    return { 
      name: name || '', 
      email: email || '' 
    };
  });

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
    localStorage.clear();
    navigate('/');
  }


const links = mockdata.map((item) => (
  <LinksGroup {...item} pathname={pathname} key={item.label} />
));

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
    <Notifications position="bottom-right" zIndex={2000} />
    <AppShell
      className={isInboundWorkspace || isDashboard ? classes.appShellInbound : undefined}
      header={{ height: 49 }}
      navbar={{
        width: 204,
        breakpoint: 'sm',
        collapsed: { mobile: !opened },
      }}
      padding="sm"
    >
      <AppShell.Header className={classes.appHeader}>
        <Box className={classes.headerBrand}>
          <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" color="white" />
          <Box className={classes.logoMark}>
            {/* <img src={steel119HomeLogo} alt="Steel119" /> */}
            <img src={steel119HomeLogo} alt="Steel119" />
          </Box>
          <Box className={classes.brandCopy}>
            <Text className={classes.brandName}>STEEL119</Text>
          </Box>
        </Box>

        <Box className={classes.headerActions}>
          {pageRibbon}
        </Box>

        <Group className={classes.headerUser} gap={16} wrap="nowrap">
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
        <AppShell.Section grow component={ScrollArea} offsetScrollbars>
          <div className={classes.linksContainer}>{links}</div>
        </AppShell.Section>

        <AppShell.Section className={classes.navFooter}>
          <Text className={classes.footer}>
            © Steel119 ERP
          </Text>
        </AppShell.Section>
      </AppShell.Navbar>

      <AppShell.Main className={`${classes.appMain} ${isDashboard ? classes.appMainDashboard : isInboundWorkspace ? classes.appMainInbound : ''}`}>
        {!isDashboard && <div className={classes.pageTabs} role="tablist" aria-label="열린 메뉴">
          {pageTabs.map((tab) => {
            const label = findMenuLabel(mockdata, tab.path);
            return (
              <div key={tab.path} role="tab" aria-selected={pathname === tab.path} tabIndex={0}
                className={`${classes.pageTab} ${pathname === tab.path ? classes.pageTabActive : ''}`}
                onClick={() => navigate(tab.path)} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) navigate(tab.path); }}>
                <span>{label}</span>
                <button type="button" className={classes.pageTabClose} aria-label={`${label} 닫기`}
                  onClick={(event) => closePageTab(event, tab.path)}>×</button>
              </div>
            );
          })}
        </div>}
        {/* 클래스 적용 */}
        <div className={`${classes.contentCard} ${isDashboard ? classes.dashboardContentCard : isInboundWorkspace ? classes.inboundContentCard : ''}`}>
          <PageRibbonContext.Provider value={pageRibbonContextValue}>{children}</PageRibbonContext.Provider>
        </div>
      </AppShell.Main>
    </AppShell>
  </>
  );

}
