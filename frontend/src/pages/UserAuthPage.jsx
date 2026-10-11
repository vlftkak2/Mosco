import React,{ useEffect, useState, useMemo, memo,useCallback,startTransition } from 'react';
import { 
  Title, Text, Paper, Group, Stack, Container, ThemeIcon, Box, 
  LoadingOverlay, Table, ScrollArea, Select, Button, Badge, 
  Divider, Modal, TextInput, PasswordInput, Checkbox, Tooltip, ActionIcon, Center, SimpleGrid,UnstyledButton
} from '@mantine/core';
import { 
  IconSearch, IconUser, IconLock, IconDatabase, IconCircleCheck, IconCircleX, IconAlertCircle,IconFilter,IconChartBar,IconUserCircle,IconX
} from '@tabler/icons-react';
import axios from 'axios';
import { notifications } from '@mantine/notifications';

import { useForm } from '@mantine/form';

export default function UserAuthPage() {

    const formattedDate = useMemo(() => {
   
    const week = ['일', '월', '화', '수', '목', '금', '토'];
    const now = new Date();
    return `${now.toISOString().split('T')[0]} (${week[now.getDay()]})`;
  }, []);

  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState('');

  const [menuList,setmenuList] = useState([]);
  const [menuUserAuthList,setmenuUserAuthList] = useState([]);
  const [userList, setUserList] = useState([]);

  const [editModalOpened, setEditModalOpened] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [userOptions, setuserOptions] = useState([{ value: 'ALL', label: 'ALL' }]);
  
  const memoizedOptions = useMemo(() => ({
    username: userOptions,
}), [userOptions]);

const fetchAllData = useCallback(async () => {
    try {
      const [userRes, MenuRes] = await Promise.all([
        axios.get(`http://${window.location.hostname}/api/menu-user-Authlist`, {
          params: { manager: '' }
        }),
        axios.get(`http://${window.location.hostname}/api/menu-list`),
      ]);

      if (MenuRes.data?.data) setmenuList(MenuRes.data.data);

      if (userRes.data.success) {
        const processed = userRes.data.data.map(user => {
          const teamAuths = user.TeamAuths || [];
          const userExceptions = user.UserExceptions || [];
          
          const finalSet = new Set(teamAuths.map(t => t.MenuID));
          userExceptions.forEach(ex => {
            if (ex.AuthType === 'GRANT') finalSet.add(ex.MenuID);
            if (ex.AuthType === 'DENY') finalSet.delete(ex.MenuID);
          });

          return {
            ...user,
            Permissions: Array.from(finalSet),
          };
        });

        setmenuUserAuthList(processed);
        setUserList(processed); 
        
        const uniqueNames = [...new Set(processed.map(item => item.사용자))].filter(Boolean);
        setuserOptions([{ value: 'ALL', label: 'ALL' }, ...uniqueNames.map(n => ({ value: n, label: n }))]);
        
        // ★ 핵심: 가공된 데이터를 외부(handleSearch 등)에서 즉시 쓸 수 있게 반환합니다.
        return processed; 
      }
      return []; // 성공 케이스가 아닐 때 빈 배열 반환
    } catch (error) {
      console.error("초기 로드 실패:", error);
      return []; // 에러 시 빈 배열 반환
    }
  }, []);

// useEffect(() => {
//   const run = async () => {
//     await fetchAllData();
//   };
//   run();
// }, [fetchAllData]);

const refreshAndSearch = async () => {
  // 최신 데이터를 가져오고 (return processed;가 있어야 함)
  const latestData = await fetchAllData(); 
  // 그 데이터로 현재 검색 조건에 맞춰 화면 갱신
  handleSearch(form.values, latestData); 
};

  const form = useForm({
  initialValues: {
      user: 'ALL',
  },
  validateInputOnChange: false,
  });

  const handleSearch = async (values) => {

  setLoading(true);

  try{

  const dataFromServer = await fetchAllData();
  const target = values?.user === 'ALL' ? '' : values?.user || '';

  const result = target === '' 
      ? dataFromServer 
      : dataFromServer.filter(u => u.사용자 === target);

  // const result = target === '' 
  //   ? menuUserAuthList 
  //   : menuUserAuthList.filter(u => u.사용자 === target);

  // 결과만 '출력용 바구니'에 담아서 화면을 바꿉니다.
  setUserList(result);
  setLastUpdated(new Date().toLocaleTimeString());
  setLoading(false);
  } catch (error) {
    console.error("검색 중 오류 발생:", error);
  } finally {
    // 3. 작업이 모두 끝나면 로딩 해제
    setLoading(false);
  }
};


  // 모달  
const onEditUser = useCallback((user) => {
    setSelectedUser(user);
    setEditModalOpened(true);
  }, []);

  return (
   <Box style={{ backgroundColor: '#f1f3f5', minHeight: '100vh', paddingBottom: '40px' }}>
      <Box style={{ height: '200px', background: 'linear-gradient(135deg, #ee7373 0%, #ec0a0a 100%)', position: 'absolute', top: 0, left: 0, right: 0 }} />
      <Container size="100%" style={{ position: 'relative', paddingTop: '40px' }}>
        <LoadingOverlay visible={loading} overlayProps={{ radius: "lg", blur: 2 }} loaderProps={{ size: 'xl', color: 'red', type: 'bars' }} />
        <Stack gap="lg">
          <Paper p="xl" radius="lg" shadow="md" withBorder style={{ backdropFilter: 'blur(10px)', backgroundColor: 'rgba(255, 255, 255, 0.9)' }}>
            <Group justify="space-between">
              <Stack gap={5}>
                <Group gap="sm">
                  <Title order={1} fz="40px" fw={900}>APR 사용자 권한 관리 <span style={{ color: '#e62222' }}>Monitor</span></Title>
                  
                </Group>
                <Group gap="xs">
                  <Badge variant="dot" c="teal" size="lg">System Active</Badge>
                  <Text size="md" c="dimmed" fw={500}>{formattedDate}</Text>
                </Group>
              </Stack>
            </Group>
          </Paper>

        <Paper 
            component="form" 
            onSubmit={form.onSubmit(handleSearch)}
            p="xl" radius="lg" shadow="md" withBorder 
            style={{ backgroundColor: '#fff', borderTop: '4px solid #ec0a0a' }}
          >
            <LoadingOverlay visible={loading} overlayProps={{ radius: "lg", blur: 2 }} loaderProps={{ size: 'xl', color: 'red', type: 'bars' }} />
            <Stack gap="sm" style={{ maxWidth: '300px' }}>
              <Group gap="xs">
                <IconFilter size={20} color="#e84848ff" />
                <Text fw={800} fz="20px">조회 필터 설정</Text>
              </Group>

              <Stack gap="sm">
                <SimpleGrid cols={1} spacing="lg">
                  <Select
                    mt="lg"
                    label="사용자명 입력"
                    placeholder="사용자 정보를 입력해주세요"
                    limit={50}
                    searchable
                    nothingFoundMessage="일치하는 사용자가 없습니다."
                    data={memoizedOptions.username}
                    size="md"
                    leftSection={<IconFilter size={20} />}
                    {...form.getInputProps('user')}    
                    styles={{ input: { backgroundColor: '#f8f9fa', borderRadius: '8px' } }}
                    labelProps={{ style: { fontWeight: 700, marginBottom: '6px', fontSize: '20px' } }}
                  />
                </SimpleGrid>  

              </Stack>

              <Stack mt="sm" align="flex-start" gap={0}>
                <Button 
                  type="submit" 
                  variant="filled" 
                  color="red" 
                  size="lg" 
                  radius="md"
                  leftSection={<IconSearch size={20} 
                  />}
                >
                  조회
                </Button>
                <Group mt="sm">
                  <Text size="md" c="dimmed" fw={700}>LAST UPDATED</Text>
                  <Text size="md" fw={500}>{lastUpdated}</Text>
                </Group>
              </Stack>
            </Stack>
          </Paper>

        {lastUpdated && (
          <>
         <Paper radius="lg" shadow="md" withBorder mt={50} style={{ overflow: 'hidden', backgroundColor: '#fff' }}>
          {/* 1. 헤더 섹션: 상단 빨간 라인과 제목 */}
          <Box p="md" style={{ borderTop: '5px solid #fa5252', borderBottom: '1px solid #eee' }}>
            <Group justify="space-between">
              <Group gap="xs">
                <ThemeIcon variant="light" color="red" size="lg">
                  <IconUser size={28} />
                </ThemeIcon>
                <Title order={3} fz="28px" fw={900}>
                사용자 권한 <span style={{ color: '#fa5252' }}>상세</span>
                </Title>
              </Group>
            </Group>
          </Box>

          {/* 2. 데이터 섹션: 로딩 오버레이와 테이블 */}
          <Box style={{ position: 'relative' }}> 
                       
            <AuthMatrixTable 
              data={userList} 
              menuMaster={menuList} 
              onEditUser={onEditUser}
            />
          </Box>
          
        </Paper>
        </>)}
        </Stack>
      </Container>

 <UserPermissionModal 
        opened={editModalOpened} 
        onClose={() => setEditModalOpened(false)} 
        user={selectedUser} 
        menuList={menuList} 
        onSuccess={refreshAndSearch}
      />

    </Box>
  );
}

const AuthMatrixTable = memo(({ data, menuMaster, onEditUser }) => {
  const USER_COL_WIDTH = 150; 

  // 1. 그룹 헤더 데이터 계산
  const groupedHeader = useMemo(() => {
    const groups = [];
    menuMaster.forEach((m) => {
      const last = groups[groups.length - 1];
      if (last && last.name === m.MenuGroup) {
        last.count += 1;
      } else {
        groups.push({ name: m.MenuGroup, count: 1 });
      }
    });
    return groups;
  }, [menuMaster]);

  if (data.length === 0) return <Center h={300}><Text c="dimmed">데이터가 없습니다.</Text></Center>;

  // 💡 CSS 포인트: 상단 행 높이를 약 50px로 고정하고, 하단 행을 그만큼 띄웁니다.
  const ROW_1_HEIGHT = 50; 

  return (
    <ScrollArea h={800} offsetScrollbars>
      <Table 
        withTableBorder 
        // 💡 중요: Mantine의 stickyHeader는 2단 대응이 안 되므로 제거하거나 false 설정
        stickyHeader={false} 
        style={{ tableLayout: 'auto', minWidth: 'max-content', borderCollapse: 'separate', borderSpacing: 0 }}
      >
        <Table.Thead>
          {/* -----------------------------------------------------------
            * 1단: 그룹 메뉴 행 (top: 0 고정)
            * ----------------------------------------------------------- */}
          <Table.Tr>
            <Table.Th 
              style={{ 
                position: 'sticky',
                top: 0,
                left: 0,
                zIndex: 100, // 가장 높게
                width: USER_COL_WIDTH,
                minWidth: USER_COL_WIDTH,
                backgroundColor: '#f1f3f5',
                borderRight: '2px solid #dee2e6',
                borderBottom: '1px solid #dee2e6',
                height: ROW_1_HEIGHT
              }} 
            />
            {groupedHeader.map((group, idx) => (
              <Table.Th 
                key={`group-${idx}`} 
                colSpan={group.count}
                ta="center"
                style={{ 
                  position: 'sticky',
                  top: 0,
                  zIndex: 90,
                  backgroundColor: '#f1f3f5', 
                  fontSize: 16, 
                  fontWeight: 900, 
                  color: '#e03131',
                  borderBottom: '1px solid #dee2e6',
                  height: ROW_1_HEIGHT
                }}
              >
                {group.name}
              </Table.Th>
            ))}
          </Table.Tr>

          {/* -----------------------------------------------------------
            * 2단: 상세 메뉴 행 (top: ROW_1_HEIGHT 고정)
            * ----------------------------------------------------------- */}
          <Table.Tr>
            <Table.Th 
              style={{ 
                position: 'sticky',
                top: ROW_1_HEIGHT, // 💡 1단 높이만큼 내려서 고정
                left: 0,
                zIndex: 100,
                width: USER_COL_WIDTH,
                minWidth: USER_COL_WIDTH,
                backgroundColor: '#f8f9fa',
                borderRight: '2px solid #dee2e6',
                borderBottom: '2px solid #dee2e6',
                textAlign: 'center',       // 텍스트 정렬
                fontSize: '16px',
                fontWeight: 700
              }}
            >
              사용자 정보
            </Table.Th>
            {menuMaster.map((m) => (
              <Table.Th 
                key={m.MenuID} 
                ta="center" 
                style={{ 
                  position: 'sticky',
                  top: ROW_1_HEIGHT, // 💡 1단 높이만큼 내려서 고정
                  zIndex: 80,
                  backgroundColor: '#f8f9fa',
                  whiteSpace: 'nowrap',
                  padding: '10px 15px',
                  minWidth: '110px',
                  fontSize: 16,
                  fontWeight: 600,
                  borderBottom: '2px solid #dee2e6'
                }}
              >
                {m.MenuDetail}
              </Table.Th>
            ))}
          </Table.Tr>
        </Table.Thead>

        <Table.Tbody>
          {data.map((user) => (
            <AuthMatrixRow 
              key={user.이메일} 
              user={user} 
              menuMaster={menuMaster} 
              onEditUser={onEditUser} 
              colWidth={USER_COL_WIDTH} 
            />
          ))}
        </Table.Tbody>
      </Table>
    </ScrollArea>
  );
});


//   return (
//     <ScrollArea h={600} offsetScrollbars>
//       <Table 
//         withTableBorder 
//         stickyHeader 
//         style={{ 
//           // 💡 핵심 1: fixed를 제거하거나 auto로 설정하여 글자수에 맞게 너비 조절
//           tableLayout: 'auto', 
//           minWidth: 'max-content' 
//         }}
//       >
        
//         <Table.Thead>
//           <Table.Tr>
//             <Table.Th 
//               style={{ 
//                 zIndex: 300, 
//                 left: 0, 
//                 position: 'sticky', 
//                 backgroundColor: '#f8f9fa',
//                 width: USER_COL_WIDTH,
//                 minWidth: USER_COL_WIDTH,
//                 borderRight: '2px solid #dee2e6',
//                 paddingLeft: '20px'
//               }}
//             >
//               사용자 정보
//             </Table.Th>
//             {menuMaster.map(m => (
//               <Table.Th 
//                 key={m.MenuID} 
//                 ta="center" 
//                 style={{ 
//                   backgroundColor: '#f8f9fa',
//                   whiteSpace: 'nowrap',
//                   padding: '0 15px',
//                   borderBottom: '1px solid #dee2e6',
//                   minWidth: '100px' 
//                 }}
//               >
//                 {m.MenuDetail}
//               </Table.Th>
//             ))}
//           </Table.Tr>
//         </Table.Thead>
//         <Table.Tbody>
//           {data.map((user) => (
//             <AuthMatrixRow 
//               key={user.이메일} 
//               user={user} 
//               menuMaster={menuMaster} 
//               onEditUser={onEditUser} 
//               colWidth={USER_COL_WIDTH} 
//             />
//           ))}
//         </Table.Tbody>
//       </Table>
//     </ScrollArea>
//   );
// });


const AuthMatrixRow = memo(({ user, menuMaster, onEditUser, colWidth }) => {
  const permissionSet = useMemo(() => new Set(user.Permissions || []), [user.Permissions]);
  const exceptionSet = useMemo(() => new Set((user.UserExceptions || []).map(ex => ex.MenuID)), [user.UserExceptions]);

  return (
    <Table.Tr>
     <Table.Td 
  onClick={() => onEditUser(user)}
  style={{ 
    zIndex: 10, 
    left: 0, 
    position: 'sticky', 
    backgroundColor: '#fff', 
    borderRight: '2px solid #dee2e6', 
    cursor: 'pointer',
    width: colWidth,
    minWidth: colWidth,
    padding: '12px 20px'
  }} 
>
  <Group gap="md" wrap="nowrap">
    <ThemeIcon size="lg" radius="xl" color="red" variant="light">
      <IconUser size={18} />
    </ThemeIcon>
    <Stack gap={0}>
      <Text fz="md" fw={800} c="red.9" style={{ whiteSpace: 'nowrap' }}>
        {user.사용자 || '이름 없음'}
      </Text>
      <Text fz="md" c="dimmed" fw={500} style={{ whiteSpace: 'nowrap' }}>
        {user.부서 || '부서 없음'}
      </Text>
    </Stack>
  </Group>
</Table.Td>

      {/* 권한 체크박스 영역 동일 */}
      {menuMaster.map(menu => (
        <Table.Td key={menu.MenuID} ta="center" bg={permissionSet.has(menu.MenuID) ? '#fff' : '#fafafa'}
        style={{ 
        verticalAlign: 'middle', // 세로 중앙 정렬
        padding: 0               // 셀 안에서 꽉 차게 조절 (선택사항)
      }}>
        <Group justify="center" align="center" h="100%" style={{ minHeight: '40px' }}>
          <Checkbox 
            checked={permissionSet.has(menu.MenuID)} 
            readOnly 
            color={exceptionSet.has(menu.MenuID) ? "orange" : "blue"} 
            size="sm" 
            
          />
          </Group>
        </Table.Td>
      ))}
    </Table.Tr>
  );
});

const AuthRow = memo(({ menu, isChecked, isBase, onToggle }) => {
  
  const getStatus = () => {
    if (isBase && isChecked) return { label: "기본", color: "red", bg: "red.0" };
    if (!isBase && isChecked) return { label: "추가", color: "red", bg: "red.0" };
    if (isBase && !isChecked) return { label: "제외", color: "teal", bg: "white" };
    return { label: "미부여", color: "gray", bg: "white" }; // 둘 다 아님
  };

  const status = getStatus();

  return (
    <Paper p="xs" withBorder bg={status.bg} style={{ transition: 'background-color 0.2s' }}>
      <Group justify="space-between" wrap="nowrap">
        <Checkbox 
          label={
            <Text fz="md" fw={isChecked ? 700 : 400}>
              {menu.MenuDetail}
            </Text>
          }
          checked={isChecked} 
          onChange={(e) => onToggle(menu.MenuID, e.currentTarget.checked)}
          color={status.color}
          styles={{ input: { cursor: 'pointer' } }}
        />
        
        {/* 상태 배지 표시 */}
        <Badge size="md" variant="filled" color={status.color}>
          {status.label}
        </Badge>
      </Group>
    </Paper>
  );
});

const UserPermissionModal = memo(({ opened, onClose, user, menuList,onSuccess }) => {
  // 모달 내부에서만 사용하는 상태 (이게 바뀌어도 부모 테이블은 리렌더링 안됨)
  const [tempPerms, setTempPerms] = useState(new Set());

  // 유저가 바뀔 때마다 권한 Set 초기화
  useEffect(() => {
  if (opened && user) {
    // 열릴 때 초기화
    setTimeout(() => {
      setTempPerms(new Set(user.Permissions || []));
    }, 0);
  } else if (!opened) {
    // 닫힐 때 비우기 (여기도 미루기)
    setTimeout(() => {
      setTempPerms(new Set());
    }, 0);
  }
}, [opened, user]);

  // [최적화] 메뉴 그룹화 로직을 모달 안으로 이동 (부모에서 계산 안함)
  const groupedMenus = useMemo(() => {
    return Object.entries(
      menuList.reduce((acc, m) => {
        (acc[m.MenuGroup] = acc[m.MenuGroup] || []).push(m);
        return acc;
      }, {})
    );
  }, [menuList]);

  // [최적화] 기본 권한(팀 권한) 판단 로직
  const baseAuthSet = useMemo(() => {
    if (!user?.TeamAuths) return new Set();
    return new Set(user.TeamAuths.map(t => t.MenuID));
  }, [user]);

  // 권한 토글 함수 (모달 안에서만 동작)
  const handleToggle = useCallback((menuID, checked) => {
    setTempPerms(prev => {
      const next = new Set(prev);
      checked ? next.add(menuID) : next.delete(menuID);
      return next;
    });
  }, []);

  const handleSave = async () => {

    const currentArray = Array.from(tempPerms); // 현재 체크 상태
    const basePermsArray = Array.from(baseAuthSet); // 팀 기본 권한
    const initialPermsArray = user.Permissions || []; // ★ 모달 열 때의 초기 상태

    // [Case 1] 추가(GRANT): 팀 권한에 없는데 새로 체크함
    const addList = currentArray.filter(id => !baseAuthSet.has(id));

    // [Case 2] 제외(DENY): 팀 권한에 있는데 체크 해제함
    const removeList = basePermsArray.filter(id => !tempPerms.has(id));

    // 3. [변경 여부 체크]
    const isChanged = 
      initialPermsArray.length !== currentArray.length || 
      initialPermsArray.some(id => !tempPerms.has(id)) ||
      currentArray.some(id => !initialPermsArray.includes(id));
 
   if (!isChanged) {
      notifications.show({
        title: '변경 사항 없음',
        message: '수정된 권한 내용이 없습니다.',
        color: 'red',
        icon: <IconX size={18} />,
        position: 'bottom-right',
      });
      return;
    }

    const apiUrl =  `http://${window.location.hostname}/api/user-AuthUpdate` 
    const res = await axios.post(apiUrl, {
          userName:user.사용자,
          userEmail:user.이메일,
          addList:addList,
          removeList:removeList
      });

    if (res.data.success) {

      if (onSuccess) {
          await onSuccess(); 
        }

        notifications.show({
          title: '저장 완료',
          message: '예외 권한 설정이 반영되었습니다.',
          color: 'teal',
          icon: <IconCircleCheck size={18} />,
          position: 'bottom-right',
        });  

    onClose();
      }
  };

  if (!user) return null;

  return (
    <Modal 
      opened={opened} 
      onClose={onClose} 
      title={<Text fw={900} fz="xl">사용자 정보 및 권한 수정</Text>}
      size="lg" centered radius="md"
      transitionProps={{ transition: 'pop', duration: 200 }}
    >
      <Stack gap="md">
        <SimpleGrid cols={2} spacing="md">
          <TextInput label="사용자명" value={user.사용자 || ''} readOnly variant="filled" />
          <TextInput label="소속 부서" value={user.부서 || ''} readOnly variant="filled" />
        </SimpleGrid>

        <Divider label={<Text fz="md" fw={700} c="dimmed">메뉴별 권한 상세 설정</Text>} labelPosition="center" my="md" />
        
        <ScrollArea.Autosize mah={450} offsetScrollbars>
          <Stack gap="xs">
            {groupedMenus.map(([group, menus]) => (
              <Paper key={group} withBorder p="sm" bg="gray.0">
                <Text fw={800} fz="md" mb="xs" c="red.7">{group}</Text>
                <SimpleGrid cols={2} spacing="xs">
                  {menus.map((menu) => (
                    <AuthRow 
                      key={menu.MenuID}
                      menu={menu}
                      isChecked={tempPerms.has(menu.MenuID)} 
                      isBase={baseAuthSet.has(menu.MenuID)} 
                      onToggle={handleToggle}
                    />
                  ))}
                </SimpleGrid>
              </Paper>
            ))}
          </Stack>
        </ScrollArea.Autosize>
        
        <Group justify="flex-end" gap="sm" pt="xs">
          <Button color="red" onClick={handleSave}>사용자 권한 변경</Button>
          <Button variant="outline" onClick={onClose}>취소</Button>
        </Group>
      </Stack>
    </Modal>
  );
});

