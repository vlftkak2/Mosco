
import { AppShell, Burger, Group, Text, Box, ScrollArea, Avatar, Button, Divider, Stack, Modal, TextInput, PasswordInput } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { LinksGroup } from './MainLayoutLink';
import classes from '../../styles/layout/MainLayout.module.css';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate,useLocation } from 'react-router-dom';
import { 
  IconLogout,
  IconPackage,
  IconUser
} from '@tabler/icons-react';
import '@mantine/notifications/styles.css';
import { Notifications, notifications } from '@mantine/notifications';
import axios from 'axios'; // axios 추가
import { IconCheck, IconX } from '@tabler/icons-react'; // 아이콘 추가
import steel119HomeLogo from '../../assets/img/steel119-home.png';

const mockdata = [
  {
    label: '대시보드',
    icon: <IconPackage size={17} stroke={1.8} />,
    link: '/HomePage',
    initiallyOpened: false,
    MenuID:null,
  },
  {
    label: '매입 관리',
    icon: <IconPackage size={17} stroke={1.8} />,
    initiallyOpened: false,
    links: [
      { label: '매입등록', link: '/InventoryMonitorPage', icon: '', MenuID:'M-9' },
      { label: '매입현황', link: '/InventoryMonitorPage', icon: '', MenuID:'M-10' },
    ],
  },  
  {
    label: '매출 관리',
    icon: <IconPackage size={17} stroke={1.8} />,
    initiallyOpened: false,
    links: [
      { label: '매출등록', link: '/OMSSAPVerifPage', icon: '', MenuID:'M-11' },
      { label: '매출현황', link: '/WMSOMSVerifPage', icon: '', MenuID:'M-12' },
      { label: '매출이익률', link: '/WMSOMSVerifPage', icon: '', MenuID:'M-13' },
    ],
  },  

  {
    label: '재고 관리',
    icon: <IconPackage size={17} stroke={1.8} />,
    initiallyOpened: false,
    links: [
      { label: '재고조회', link: '/OMSSAPVerifPage', icon: '', MenuID:'M-11' },
      { label: '재고가공', link: '/WMSOMSVerifPage', icon: '', MenuID:'M-12' },
    ],
  },    

  {
    label: '거래처 관리',
    icon: <IconPackage size={17} stroke={1.8} />,
    initiallyOpened: false,
    links: [
      { label: '거래처등록', link: '/CustomerPage', icon: '', MenuID:'M-11' },
      { label: '거래처원장', link: '/WMSOMSVerifPage', icon: '', MenuID:'M-12' },
    ],
  },   
  {
    label: '자금 관리',
    icon: <IconPackage size={17} stroke={1.8} />,
    initiallyOpened: false,
    links: [
      { label: '수금/지급', link: '/UserPage', icon: '✔️', MenuID:'M-14' },
      { label: '계산서등록', link: '/DepartmentPage', icon: '✔️', MenuID:'M-16' },
    ],
  },

    {
    label: '기본정보 관리',
    icon: <IconPackage size={17} stroke={1.8} />,
    initiallyOpened: false,
    links: [
      { label: '품목코드', link: '/ItemMasterPage', icon: '', MenuID: 'M7' },
      {
        label: '일반코드',
        link: '/CodeMasterPage',
        icon: '',
        MenuID: 'M1',
      },
    ],
  },

  {
    label: '사용자 관리',
    icon: <IconPackage size={17} stroke={1.8} />,
    initiallyOpened: false,
    links: [
      { label: '사용자 관리', link: '/UserPage', icon: '✔️', MenuID:'M-17' },
      { label: '사용자 권한 관리', link: '/UserAuthPage', icon: '✔️', MenuID:'M-18' },
      { label: '부서 관리', link: '/DepartmentPage', icon: '✔️', MenuID:'M-19' },
      { label: '부서 권한 관리', link: '/DepartmentAuthPage', icon: '✔️', MenuID:'M-20' },
      { label: '설정', link: '/settings', icon: '✔️', MenuID:'M-21' },
    ],
  },

];

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


const links = useMemo(()=>{
  return mockdata.map((item) => <LinksGroup {...item} key={item.label} />);
}, []);

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
      header={{ height: 68 }}
      navbar={{
        width: 224,
        breakpoint: 'sm',
        collapsed: { mobile: !opened },
      }}
      padding="sm"
    >
      <AppShell.Header className={classes.appHeader}>
        <Group h="100%" px="md" justify="space-between">
          <Group>
            <Box className={classes.headerBrand}>
              <Box className={classes.logoMark}>
                <img src={steel119HomeLogo} alt="Steel119" />
              </Box>
              <Box className={classes.brandCopy}>
                <Text className={classes.brandName}>STEEL119</Text>
              </Box>
            </Box>
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
          </Group>

          {/* --- 우측 사용자 영역 추가 --- */}
          <Group gap="md">
            <Group 
              gap="sm"
              onClick={openPwModal}        // [수정] 클릭 시 모달 열기 함수 호출
              style={{ cursor: 'pointer' }}
            >
              <Avatar color="red.8" radius="xl" size="md" variant="light">
                {userInfo.name ? userInfo.name.charAt(0) : <IconUser size={20} />}
              </Avatar>
              <Stack gap={0}>
                <Text size="sm" fw={600} c="red.8">{userInfo.name}님</Text>
              </Stack>
            </Group>

           <Modal opened={pwModalOpened} onClose={closePwModal} title={<Text fw={700} size="xl">비밀번호 수정</Text>} centered size="lg" padding="xl" >
            <form onSubmit={handlePasswordChange}>
              <Stack gap="xl">
                {/* [필수 수정] value와 onChange를 연결해야 pwdForm에 값이 담깁니다. */}
                <PasswordInput 
                  label="현재 비밀번호" 
                  size="md"
                  required 
                  value={pwdForm.current}
                  onChange={(e) => setPwdForm({ ...pwdForm, current: e.target.value })}
                />
                <PasswordInput 
                  label="새 비밀번호" 
                  size="md"
                  required 
                  value={pwdForm.next}
                  onChange={(e) => setPwdForm({ ...pwdForm, next: e.target.value })}
                />
                <PasswordInput 
                  label="새 비밀번호 확인" 
                  size="md"
                  required 
                  value={pwdForm.confirm}
                  onChange={(e) => setPwdForm({ ...pwdForm, confirm: e.target.value })}
                />
                <Group justify="flex-end" mt="md">
                  <Button variant="outline" color="gray" onClick={closePwModal}>취소</Button>
                  <Button type="submit" color="red.8">패스워드 변경</Button>
                </Group>
              </Stack>
            </form>
          </Modal>

            <Divider orientation="vertical" h={30} />

            <Button 
              variant="subtle" 
              color="gray" 
              leftSection={<IconLogout size={20} />}
              onClick={handleLogout}
            >
              로그아웃
            </Button>
          </Group>   
        </Group>
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

      <AppShell.Main bg="gray.0">
        {/* 클래스 적용 */}
        <div className={classes.contentCard}>
          {children}
        </div>
      </AppShell.Main>
    </AppShell>
  </>
  );

}
