import { useEffect, useState, useMemo, memo, useCallback } from 'react';
import { 
  Title, Text, Paper, Group, Stack, Container, ThemeIcon, Grid, 
  Button, Badge, Box, LoadingOverlay, Tabs, Table, ScrollArea, Select, SimpleGrid,Progress,TextInput ,Divider,
  Modal, PasswordInput
} from '@mantine/core';
import { MonthPickerInput } from '@mantine/dates';
import { 
  IconCircleCheck, IconAlertCircle, IconRefresh, IconWorld, IconSearch , IconFilter ,IconCalendar ,IconClock ,IconUser ,
  IconShieldCheck, IconTableAlias, IconCoin, IconWallet, IconChartBar, IconDeviceDesktop,  IconArrowUpRight,IconUpload,IconChecklist,IconAlertTriangle,IconInfoCircle,IconChartLine,IconX 
} from '@tabler/icons-react';
import axios from 'axios';
import 'dayjs/locale/ko';
import dayjs from 'dayjs';
import '@mantine/dates/styles.css';
import { notifications } from '@mantine/notifications';
import { useForm } from '@mantine/form'; // 추가
import { TableVirtuoso } from 'react-virtuoso';
import * as XLSX from 'xlsx';
import { ResponsiveContainer,LineChart,Line,LabelList, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { modals } from '@mantine/modals';

export default function UserPage() {

  const storedUserName = localStorage.getItem('user_name') || '미인증 사용자';

  // 날짜 정보
  const formattedDate = useMemo(() => {
   
    const week = ['일', '월', '화', '수', '목', '금', '토'];
    const now = new Date();
    return `${now.toISOString().split('T')[0]} (${week[now.getDay()]})`;
  }, []);

  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState('');
  const [userOptions, setuserOptions] = useState([{ value: 'ALL', label: 'ALL' }]);
  const [userList, setuserList] = useState([]);
  const [editModalOpened, setEditModalOpened] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);

  const memoizedOptions = useMemo(() => ({
    username: userOptions,
}), [userOptions]);


  useEffect(() => {
  const effectfecth = async () => {
    try {
      const [userRes] = await Promise.all([
        axios.get(`http://${window.location.hostname}/api/user-list`,{
            params:{
                username:''
            }
        }),  //`http://${window.location.hostname}:8000/api/d2cmon-brand`
      ]);

      // 1.사용자 리스트
      if (userRes.data.success) {

        const uniqueNames = [...new Set(userRes.data.data.map(item => item.사용자))];

        const users = uniqueNames
          .filter(name => name) // 혹시 모를 null/undefined 제거
          .map(name => ({
              value: name, // name 자체가 이름 문자열입니다
              label: name
          }));
        setuserOptions([{ value: 'ALL', label: 'ALL' }, ...users]);
      }
   
    } catch (error) {
      console.error("데이터 로드 실패:", error);
    }
  };
  effectfecth();
}, []);

    const form = useForm({
    initialValues: {
        user: 'ALL',
    },
    validateInputOnChange: false,
    });

    
    const editForm = useForm({
        initialValues: {
        사용자: '',
        이메일: '',
        비밀번호: '',
        권한: 'USER',
        }
    });

    //사용자 추가
    // 신규 추가 버튼 클릭 시
  const handleCreateOpen = () => {
    setSelectedUser(null); // 선택된 유저 없음 (추가 모드)
    editForm.reset();      // 폼 초기화
    editForm.setValues({
      이메일: '',
      부서: '',
      사용자: '',
      비밀번호: '',
      권한: 'USER',
    });
    setEditModalOpened(true);
  };

    // 사용자 편집
    const handleEditOpen = (userData) => {
    setSelectedUser(userData);
    editForm.setValues({
      이메일: userData.이메일 || '',
      사용자: userData.사용자 || '',
      비밀번호: '', // 보안상 비워둠
      부서:userData.부서 || '',
      권한: userData.사용자권한 ? userData.사용자권한.toUpperCase() : 'USER',
    });
    setEditModalOpened(true);
  };
 
  const handleUpdate = async (values) => {
    const company = localStorage.getItem('user_company');
    if (!company) {
      notifications.show({
        title: '로그인 정보 갱신 필요',
        message: '회사 정보가 없습니다. 로그아웃한 뒤 다시 로그인해 주세요.',
        color: 'orange',
      });
      return;
    }

    try {
      setLoading(true);

      const apiUrl = selectedUser 
      ? `http://${window.location.hostname}/api/user-modify` 
      : `http://${window.location.hostname}/api/user-create`;

       const res = await axios.post(apiUrl, {
        company,
        email: values.이메일,
        team: values.부서,
        username: values.사용자, 
        userpassword : values.비밀번호,
        authority: values.권한, 
      });

      console.log("서버 응답:", res.data);
      if (res.data.success === false) {
        notifications.show({
          title: selectedUser ? '변경 실패' : '등록 실패',
          message: res.data.message, 
          color: 'red',
          icon: <IconX size={18} />,
          position: 'bottom-right',
        });
        return; // 여기서 중단
      }

      notifications.show(
          { title: selectedUser ? '수정 완료' : '등록 완료', 
        message: selectedUser 
          ? `${values.사용자} 님의 정보가 성공적으로 변경되었습니다.` 
          : `${values.사용자} 님이 신규 사용자로 등록되었습니다.`,
            color: 'teal' });
      setEditModalOpened(false);

      handleSearch(form.values);

    } catch (error) {
      console.error(error);
      const detail = error.response?.data?.detail;
      const errorMessage = Array.isArray(detail)
        ? detail.map((item) => item.msg).join(', ')
        : detail || error.message || '사용자 정보 수정에 실패했습니다.';
      notifications.show({
        title: selectedUser ? '변경 실패' : '등록 실패',
        message: errorMessage,
        color: 'red',
        icon: <IconX size={18} />,
        position: 'bottom-right',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = () => {
  if (!selectedUser) return;

  modals.openConfirmModal({
    title: <Text fw={700} fz="lg">사용자 삭제 확인</Text>,
    centered: true,
    children: (
      <Text size="sm">
        <Text span fw={700} c="red">{selectedUser.사용자}</Text> 님을 정말 삭제하시겠습니까? 
        이 작업은 되돌릴 수 없으며 모든 데이터가 삭제됩니다.
      </Text>
    ),
    labels: { confirm: '삭제하기', cancel: '취소' },
    confirmProps: { color: 'red', radius: 'md' },
    cancelProps: { radius: 'md' },
    onConfirm: async () => {
      // 실제 삭제 로직을 여기에 넣습니다.
      try {
        setLoading(true);
        const res = await axios.post(`http://${window.location.hostname}/api/user-delete`, {
          company: localStorage.getItem('user_company'),
          email: selectedUser.이메일
        });

        if (res.data.success) {
          notifications.show({
            title: '삭제 성공',
            message: '사용자 정보 삭제 완료!',
            color: 'teal',
            icon: <IconCircleCheck size={18} />,
          });
          setEditModalOpened(false);
          handleSearch(form.values);
        }
      } catch (error) {
        console.error(error);
        notifications.show({ title: '오류', message: '삭제 중 문제가 발생했습니다.', color: 'red' });
      } finally {
        setLoading(false);
      }
    },
  });
};

    useEffect(() => {
        setLastUpdated('');      
        setuserList([]);        
        }, [
        form.values.user, 
    ]);    

 const handleSearch = async (values) => {
    const searchparams = {
        username:values.user === 'ALL' ? '' : values.user,
    };

    setLoading(true);
    try {

      const responsecollect = await Promise.all([
      axios.get(`http://${window.location.hostname}/api/user-list`,{
        params:{
            username:searchparams.username
        }
      }),
      
      ])

      if (responsecollect[0].data.success) {
      setuserList(responsecollect[0].data.data);
    }

      setLastUpdated(new Date().toLocaleTimeString());

    } catch (error) {
      console.error("데이터 로드 에러:", error);
    } finally {
      setLoading(false);
    }
  };
      
  // 3. 에러 발생 시 노티 함수
  const handleError = (errors) => {
    if (errors.manager) {
      notifications.show({
        title: '입력 오류',
        message: errors.manager,
        color: 'red',
        icon: <IconAlertCircle size={20} />,
        autoClose: 2000,
        style: { minHeight: '100px', padding: '15px' },
        styles: { title: { fontSize: '20px', fontWeight: 800 }, description: { fontSize: '16px' } }
      });
    }
  };

  return (
    <Box style={{ backgroundColor: '#f1f3f5', minHeight: '100vh', paddingBottom: '40px' }}>
      <Box style={{ height: '200px', background: 'linear-gradient(135deg, #ee7373 0%, #ec0a0a 100%)', position: 'absolute', top: 0, left: 0, right: 0 }} />
      <Container size="100%" style={{ position: 'relative', paddingTop: '40px' }}>
        <Stack gap="lg">
          <LoadingOverlay visible={loading} overlayProps={{ radius: "lg", blur: 2 }} loaderProps={{ size: 'xl', color: 'red', type: 'bars' }} />
          <Paper p="xl" radius="lg" shadow="md" withBorder style={{ backdropFilter: 'blur(10px)', backgroundColor: 'rgba(255, 255, 255, 0.9)' }}>
            <Group justify="space-between">
              <Stack gap={5}>
                <Group gap="sm">
                  <Title order={1} fz="40px" fw={900}>APR 사용자 관리 <span style={{ color: '#e62222' }}>Monitor</span></Title>
                </Group>
                <Group gap="xs">
                  <Badge variant="dot" c="teal" size="lg">System Active</Badge>
                  <Text size="md" c="dimmed" fw={500}>{formattedDate}</Text>
                </Group>
              </Stack>
            </Group>
          </Paper>

          {/* Form 영역 시작 */}
          <Paper 
            component="form" 
            onSubmit={form.onSubmit(handleSearch, handleError)}
            p="xl" radius="lg" shadow="md" withBorder 
            style={{ backgroundColor: '#fff', borderTop: '4px solid #ec0a0a' }}
          >
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
            {/* 헤더 섹션: 고정 높이 */}
            <Box p="md" style={{ borderTop: '5px solid #fa5252', borderBottom: '1px solid #eee' }}>
            <Group justify="space-between">
            <Group gap="xs">
                <ThemeIcon variant="light" color="red" size="md">
                <IconUser size={28} />
                </ThemeIcon>
                <Title order={3} fz="28px" fw={900}>
                사용자 정보 <span style={{ color: '#fa5252' }}>상세</span>
                </Title>
            </Group>

        <Button 
            leftSection={<IconUser size={18} />} 
            color="red" 
            variant="filled" 
            radius="md"
            onClick={handleCreateOpen} // 기존에 정의하신 함수 호출
          >
            사용자 추가
          </Button>

                </Group>
              </Box>
            <DynamicDataTable data={userList} onEdit={handleEditOpen} />

    <Modal 
        opened={editModalOpened} 
        onClose={() => setEditModalOpened(false)}
        title={
     <Text fw={900} fz="24px">
      {selectedUser ? `${selectedUser.사용자} 정보 수정` : '신규 사용자 등록'}
    </Text>
  }
        centered
        radius="lg"
        padding="xl"
        size="500px"
      >
        <form onSubmit={editForm.onSubmit(handleUpdate)}>
          <Stack gap="lg">
            <TextInput label="이메일"  placeholder="hmchoi@apr.com" size="md" {...editForm.getInputProps('이메일')} disabled={!!selectedUser} styles={{
                input: {
                backgroundColor: selectedUser ? '#f8f9fa' : '#fff',
                cursor: selectedUser ? 'not-allowed' : 'default',
                opacity: 1, // disabled여도 글자색이 너무 흐려지지 않게 함
                color: selectedUser ? '#868e96' : '#000',
                }
            }} required />
            <TextInput label="부서" placeholder="부서를 입력하세요" size="md" {...editForm.getInputProps('부서')} required />
            <TextInput label="사용자 이름" placeholder="이름을 입력하세요" size="md"  {...editForm.getInputProps('사용자')} required />
            <PasswordInput 
              label={selectedUser ? "새 비밀번호" : "비밀번호"} 
              size="md" 
              placeholder={selectedUser ? "변경 시에만 입력하세요" : "비밀번호를 입력하세요"} 
              {...editForm.getInputProps('비밀번호')} 
              autoComplete="new-password" 
              required={!selectedUser} // 신규 추가 시에는 필수 입력
            />
            <Select 
              label="권한 설정" 
              size="md" 
              data={[
                { value: 'MASTER', label: 'MASTER' },
                { value: 'USER', label: 'USER' }
              ]}
              {...editForm.getInputProps('권한')}  required
            />
            <Group justify="flex-end" mt="xl">
              
              <Button type="submit" color={selectedUser ? "red" : "red"}>
               {selectedUser ? '사용자 수정' : '신규 사용자 등록'}
             </Button>
             

          {selectedUser && (
            <Button 
              color="blue" // 기본 variant가 filled입니다
              onClick={handleDelete}
            >
              사용자 삭제
            </Button>
          )}
          <Button variant="outline"  onClick={() => setEditModalOpened(false)}>취소</Button>
            </Group>
          </Stack>
        </form>
      </Modal>

            </Paper>
        </>
        )}
        </Stack>
      </Container>
    </Box>
  );  
}

const DynamicDataTable = memo(({ data ,onEdit}) => {
  if (!data || data.length === 0) {
    return (
      <Box style={{ height: '250px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Stack align="center" gap="xs">
          <ThemeIcon size={80} radius="xl" color="gray.1" c="gray.4" variant="light">
            <IconInfoCircle size={40} />
          </ThemeIcon>
          <Text c="dimmed" fz="lg" fw={600}>조회된 상세 데이터가 없습니다.</Text>
          <Text c="dimmed" fz="sm">필터를 설정하고 조회 버튼을 눌러주세요.</Text>
        </Stack>
      </Box>
    );
  }

  const columns = Object.keys(data[0]);

  // 셀 렌더링 헬퍼 함수
  const renderCell = (col, value,row) => {
    if (value === null || value === undefined || value === '') return <Text c="dimmed">-</Text>;

    const passwordCols = ['Password', '패스워드', '비밀번호', 'PWD', 'pwd'];
    if (passwordCols.includes(col)) {
      return <Text fz="15px" fw={500} c="dimmed">********</Text>;
    }

    // 2. 사용자/이름 관련
    if (col === '사용자') {
      return (
        <Group 
            gap="xs"
            onClick={() => onEdit && onEdit(row)}
            style={{ cursor: 'pointer' }}
            >
          <ThemeIcon size="lg" radius="xl" color="red.1" c="red.7">
            <IconUser size={12} />
          </ThemeIcon>
          <Text fz="16px" fw={700} c="red.9">{value}</Text>
        </Group>
      );
    }

    // 2. 이메일 (배지 스타일)
    if (col.toLowerCase().includes('email') || col.includes('이메일')) {
      return <Text fz="16px" c="dimmed" style={{ textDecoration: 'underline' }}>{value}</Text>;
    }

    return <Text fz="16px" fw={500}>{value.toString()}</Text>;
  };

  return (
    <ScrollArea h={800} scrollbars="xy" offsetScrollbars scrollbarSize={8}>
      <Table 
        highlightOnHover 
        verticalSpacing="md" 
        horizontalSpacing="xl"
        withColumnBorders={false} // 깔끔한 디자인을 위해 세로선 제거
        striped
        stickyHeader
      >
        <Table.Thead>
          <Table.Tr style={{ backgroundColor: '#f8f9fa' }}>
            
            {columns.map((col) => (
              <Table.Th 
                key={col} 
                style={{ 
                  whiteSpace: 'nowrap', 
                  fontSize: '16px', 
                  color: '#495057',
                  fontWeight: 800,
                  borderBottom: '2px solid #edeff1'
                }}
              >
                {col}
              </Table.Th>
            ))}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {data.map((row, index) => (
            <Table.Tr key={index}>
              {columns.map((col) => (
                <Table.Td 
                  key={`${index}-${col}`}
                  
                  style={{ 
                    textAlign: typeof row[col] === 'number' ? 'right' : 'left' 
                  }}
                >
                  {renderCell(col, row[col],row)}
                </Table.Td>
              ))}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </ScrollArea>
  );
});
