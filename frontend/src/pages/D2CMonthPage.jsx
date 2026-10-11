import { useEffect, useState, useMemo, memo, useCallback } from 'react';
import { 
  Title, Text, Paper, Group, Stack, Container, ThemeIcon, Grid, 
  Button, Badge, Box, LoadingOverlay, Tabs, Table, ScrollArea, Select, SimpleGrid,Progress,TextInput ,Divider 
} from '@mantine/core';
import { MonthPickerInput } from '@mantine/dates';
import { 
  IconCircleCheck, IconAlertCircle, IconRefresh, IconWorld, IconSearch , IconFilter ,IconCalendar ,IconClock ,IconUser ,
  IconShieldCheck, IconTableAlias, IconCoin, IconWallet, IconChartBar, IconDeviceDesktop,  IconArrowUpRight,IconUpload,IconChecklist,IconAlertTriangle,IconInfoCircle,IconChartLine 
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


export default function D2CMonthPage() {

  const storedUserName = localStorage.getItem('user_name') || '미인증 사용자';
  const minStartDate = new Date(2014, 1, 1);

  // 날짜 정보
  const formattedDate = useMemo(() => {
   
    const week = ['일', '월', '화', '수', '목', '금', '토'];
    const now = new Date();
    return `${now.toISOString().split('T')[0]} (${week[now.getDay()]})`;
  }, []);

  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState('');
  const [brandOptions, setBrandOptions] = useState([{ value: 'ALL', label: 'ALL' }]);
  const [itemCodeOptions, setitemCodeOptions] = useState([{ value: 'ALL', label: 'ALL' }]);
  const [itemnmOptions, setitemnmOptions] = useState([{ value: 'ALL', label: 'ALL' }]);
  const [chartData, setChartData] = useState([]);
  const [SearchListData, setSearchListData] = useState([]);

    const memoizedOptions = useMemo(() => ({
  brand: brandOptions,
  itemCode: itemCodeOptions,
  itemName: itemnmOptions,
}), [brandOptions, itemCodeOptions, itemnmOptions]);


  useEffect(() => {
  const effectfecth = async () => {
    try {
      const [brandRes, itemRes] = await Promise.all([
        axios.get(`http://${window.location.hostname}/api/d2cmon-brand`), //`http://${window.location.hostname}:8000/api/d2cmon-brand`
        axios.get(`http://${window.location.hostname}/api/d2cmon-itemlist`),
      ]);

      // 1. 브랜드 데이터 처리 (기존과 동일하거나 중복제거 추가 가능)
      if (brandRes.data.success) {
        const brands = brandRes.data.data.map(item => ({
          value: item.Brand,
          label: item.BrandName
        }));
        setBrandOptions([{ value: 'ALL', label: 'ALL' }, ...brands]);
      }

      // 2. 품목 데이터 처리 (중복 제거 핵심)
      if (itemRes.data.success) {
        const rawData = itemRes.data.data;

        // [중복 제거 로직]
        // Set은 중복을 허용하지 않는 특성이 있습니다.
        const uniqueCodes = Array.from(new Set(rawData.map(item => item.ItemCode)));
        const uniqueNames = Array.from(new Set(rawData.map(item => item.ItemName)));

        // 품목코드 옵션 생성
        const codeOptions = uniqueCodes.map(code => ({
          value: code,
          label: code
        }));

        // 품목명 옵션 생성
        const nameOptions = uniqueNames.map(name => ({
          value: name,
          label: name
        }));

        setitemCodeOptions([{ value: 'ALL', label: 'ALL' }, ...codeOptions]);
        setitemnmOptions([{ value: 'ALL', label: 'ALL' }, ...nameOptions]);
      }
      
    } catch (error) {
      console.error("데이터 로드 실패:", error);
    }
  };
  effectfecth();
}, []);

    const form = useForm({
    initialValues: {
        startDate: dayjs().subtract(1, 'month').toDate(),
        endDate: dayjs().toDate(),
        brand: 'ALL',
        itemcode: 'ALL',
        itemname: 'ALL',
        manager: storedUserName,
    },
    validateInputOnChange: false,
    validate: {
        manager: (value) => (value.trim().length === 0 ? '담당자명을 입력해 주세요' : null),
        // [추가] 브랜드, 품목코드, 품목명 공백 체크 (ALL도 허용하지 않으려면 조건 수정 가능)
        brand: (value) => (!value || value === '' ? '브랜드를 선택해 주세요' : null),
        
        endDate: (value, values) => {
        if (!value || !values.startDate) return null;
        const startD = dayjs(values.startDate).startOf('month');
        const endD = dayjs(value).startOf('month');
        if (endD.isBefore(startD)) return '종료월은 시작월보다 빠를 수 없습니다.';
        return null;
        },
    },
    });

    const minusOneMonth = (yyyymm) => {
    return dayjs(yyyymm, 'YYYYMM').subtract(1, 'month').format('YYYYMM');
    };

useEffect(() => {
  setLastUpdated('');      // '조회' 버튼 누르기 전까지 시간 숨기기
  setChartData([]);        // 차트 데이터 비우기
  setSearchListData([]);   // 표 데이터 비우기
}, [
  form.values.startDate, 
  form.values.endDate, 
  form.values.brand, 
  form.values.itemcode, 
  form.values.itemname
]);    

 const handleSearch = async (values) => {

    const searchparams = {
        stdt:dayjs(values.startDate).format('YYYYMM'),
        etdt:dayjs(values.endDate).format('YYYYMM'),
        Brand:values.brand === 'ALL' ? '' : values.brand,
        itemCode:values.itemcode === 'ALL' ? '' : values.itemcode,
        itemName:values.itemname === 'ALL' ? '' : values.itemname,
        prestdt:minusOneMonth(dayjs(values.startDate).format('YYYYMM')),
        etdt2:dayjs(values.endDate).format('YYYYMM'),
    };

    setLoading(true);
    try {

      const responsecollect = await Promise.all([
      axios.get(`http://${window.location.hostname}/api/d2cmon-outmonthchart`,{
        params:{
          stdt:searchparams.stdt,
          etdt:searchparams.etdt,
          itemCode:searchparams.itemCode,
          Brand:searchparams.Brand,
          itemName:searchparams.itemName,
        },
      }),

    axios.get(`http://${window.location.hostname}/api/d2cmon-Outmonthrow`,{
        params:{
          prestdt:searchparams.prestdt,
          etdt:searchparams.etdt,
          stdt:searchparams.stdt,
          etdt2:searchparams.etdt2,
          itemCode:searchparams.itemCode,
          Brand:searchparams.Brand,
          itemName:searchparams.itemName,
        },
      }),
      
      ])

      if(responsecollect[0].data.success){        
        setChartData(responsecollect[0].data.data);
      }

     if(responsecollect[1].data.success){        
        setSearchListData(responsecollect[1].data.data);
      }

      setLastUpdated(new Date().toLocaleTimeString());

    } catch (error) {
      console.error("데이터 로드 에러:", error);
    } finally {
      setLoading(false);
    }
  };

  const yesterdayDate = useMemo(() => {
  const week = ['일', '월', '화', '수', '목', '금', '토'];
  const date = new Date();
  
  // 현재 날짜에서 -1일을 설정
  date.setDate(date.getDate() - 1);
  
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0'); // 월은 0부터 시작하므로 +1
  const dd = String(date.getDate()).padStart(2, '0');
  const day = week[date.getDay()];

  return `${yyyy}-${mm}-${dd}(${day})`;
}, []);
      
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

 const downloadExcel = () => {
  if (!SearchListData || SearchListData.length === 0) {
    notifications.show({
      title: '다운로드 실패',
      message: '조회된 데이터가 없습니다.',
      color: 'red',
    });
    return;
  }

  try {
    // [핵심] 엑셀용 데이터 가공: 전월대비증감량 컬럼에 % 추가
    const excelData = SearchListData.map(item => ({
      ...item,
      // 해당 컬럼이 존재하고 숫자 타입일 경우 %를 붙인 문자열로 변환
      '전월대비증감량': typeof item['전월대비증감량'] === 'number' 
        ? `${Math.round(item['전월대비증감량'])}%`
        : item['전월대비증감량']
    }));

    const worksheet = XLSX.utils.json_to_sheet(excelData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Result");

    const fileName = `월별_출고량_${dayjs().format('YYYYMMDD_HHmm')}.xlsx`;

    // 다운로드 실행
    XLSX.writeFile(workbook, fileName);

    notifications.show({
      title: '다운로드 시작',
      message: `${fileName} 파일이 생성되었습니다.`,
      color: 'teal',
      icon: <IconCircleCheck size={20} />,
    });
  } catch (err) {
    console.error('Excel Download Error:', err);
    notifications.show({
      title: '에러 발생',
      message: '엑셀 파일 생성 중 오류가 발생했습니다.',
      color: 'red',
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
                  <Title order={1} fz="40px" fw={900}>APR 자사몰 월별 출고량 <span style={{ color: '#e62222' }}>Monitor</span></Title>
                </Group>
                <Group gap="xs">
                  <Badge variant="dot" c="teal" size="lg">System Active</Badge>
                  <Text size="md" c="dimmed" fw={500}>{formattedDate}</Text>

                   <Divider orientation="vertical" h={30} /> 
                   <Text size="md" c="red.7" fw={700}>데이터 기준일: {yesterdayDate}</Text>

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
            <Stack gap="xl" style={{ maxWidth: '600px' }}>
              <Group gap="xs">
                <IconFilter size={20} color="#e84848ff" />
                <Text fw={800} fz="20px">조회 필터 설정</Text>
              </Group>


              <Stack gap="sm">
                <Group gap="xs">
                  <IconCalendar size={20} color="#e84848ff" />
                  <Text fz="20px" fw={700}>기간 및 시간 설정</Text>
                </Group>
                
                <SimpleGrid cols={2} spacing="md">
                  <MonthPickerInput
                    locale="ko"
                    label="시작월"
                    placeholder="시작년월 선택"
                    size="md"
                    valueFormat="YYYY년-MM월" // 화면 표시 형식
                    minDate={minStartDate} // 2014-01 제한
                    leftSection={<IconCalendar size={20} />}
                    {...form.getInputProps('startDate')}
                    onChange={(val) => {
                    form.setFieldValue('startDate', val);
                    setTimeout(() => form.validateField('endDate'), 0);
                    }}
                    styles={{ input: { backgroundColor: '#f8f9fa', borderRadius: '8px' } }}
                    labelProps={{ style: { fontWeight: 700, marginBottom: '6px', fontSize: '20px' } }}
                />
                  <MonthPickerInput
                    locale="ko"
                    label="종료월"
                    placeholder="종료년월 선택"
                    size="md"
                    valueFormat="YYYY년-MM월"
                    minDate={minStartDate}
                    maxDate={new Date()} // 미래 월 선택 방지 (필요시)
                    leftSection={<IconCalendar size={20} />}
                    {...form.getInputProps('endDate')}
                    onChange={(val) => {
                    form.setFieldValue('endDate', val);
                    setTimeout(() => form.validateField('endDate'), 0);
                    }}
                    styles={{ input: { backgroundColor: '#f8f9fa', borderRadius: '8px' } }}
                    labelProps={{ style: { fontWeight: 700, marginBottom: '6px', fontSize: '20px' } }}
                />
                </SimpleGrid>

                <SimpleGrid cols={2} spacing="lg">
                  <Select
                    mt="lg"
                    label="브랜드 선택"
                    placeholder="브랜드를 선택하세요"
                    data={memoizedOptions.brand}
                    size="md"
                    leftSection={<IconFilter size={20} />}
                    {...form.getInputProps('brand')}                         
                    styles={{ input: { backgroundColor: '#f8f9fa', borderRadius: '8px' } }}
                    labelProps={{ style: { fontWeight: 700, marginBottom: '6px', fontSize: '20px' } }}
                  />

                  <Select
                    mt="lg"
                    label="품목코드 선택"
                    placeholder="품목코드를 입력하세요"
                    searchable
                    limit={50}
                    nothingFoundMessage="일치하는 품목이 없습니다."
                    data={memoizedOptions.itemCode}
                    size="md"
                    leftSection={<IconFilter size={20} />}
                    {...form.getInputProps('itemcode')}    
                    styles={{ input: { backgroundColor: '#f8f9fa', borderRadius: '8px' } }}
                    labelProps={{ style: { fontWeight: 700, marginBottom: '6px', fontSize: '20px' } }}
                  />

                </SimpleGrid>

                <SimpleGrid cols={1} spacing="lg">
                  <Select
                    mt="lg"
                    label="품목코드명 선택"
                    placeholder="품목코드명을 입력하세요"
                    limit={50}
                    searchable
                    nothingFoundMessage="일치하는 품목명이 없습니다."
                    data={memoizedOptions.itemName}
                    size="md"
                    leftSection={<IconFilter size={20} />}
                    {...form.getInputProps('itemname')}    
                    styles={{ input: { backgroundColor: '#f8f9fa', borderRadius: '8px' } }}
                    labelProps={{ style: { fontWeight: 700, marginBottom: '6px', fontSize: '20px' } }}
                  />
                </SimpleGrid>  

              </Stack>

              <Divider />

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
            <Stack gap="lg">
              {/* 1. 차트 영역 */}
              <MonthlyChart data={chartData} />
            </Stack>


        <Paper radius="lg" shadow="md" withBorder mt={50} style={{ overflow: 'hidden', backgroundColor: '#fff' }}>
            {/* 헤더 섹션: 고정 높이 */}
            <Box p="md" style={{ borderTop: '5px solid #fa5252', borderBottom: '1px solid #eee' }}>
            <Group justify="space-between">
            <Group gap="xs">
                <ThemeIcon variant="light" color="red" size="md">
                <IconChartBar size={28} />
                </ThemeIcon>
                <Title order={3} fz="22px" fw={900}>
                월별 출고량 추이 <span style={{ color: '#fa5252' }}>상세</span>
                </Title>
            </Group>

            <Button 
                variant="filled" 
                color="green.7" 
                size="md" 
                radius="md"
                leftSection={<IconTableAlias size={20} />}
                onClick={downloadExcel}
                // 데이터가 없으면 버튼을 비활성화해서 실수를 방지합니다
                disabled={!SearchListData || SearchListData.length === 0}
                style={{ 
                boxShadow: '0 4px 10px rgba(40, 167, 69, 0.15)',
                borderBottom: '2px solid #2b8a3e'
                }}
            >
                전체 결과 Excel 다운로드
            </Button>
                </Group>
              </Box>
            <DynamicDataTable data={SearchListData} />
            </Paper>
    
        </>
        )}
        </Stack>
      </Container>
    </Box>
  );  
}

const MonthlyChart = memo(({ data }) => {
  if (!data || data.length === 0) return null;

  return (
    <Paper radius="lg" shadow="md" withBorder style={{ overflow: 'hidden', backgroundColor: '#fff' }}>
      {/* 1. 상단 포인트 라인 (5px 두께) */}
      <Box h={5} style={{ backgroundColor: '#fa5252' }} />
      
      {/* 2. 제목 영역 (Divider 포함) */}
      <Box p="md" style={{ borderBottom: '1px solid #f1f3f5' }}>
        <Group justify="space-between">
          <Group gap="xs">
            <ThemeIcon variant="light" color="red" size="md">
              <IconChartLine size={24} />
            </ThemeIcon>
            <Title order={3} fz="22px" fw={900}>
              월별 <span style={{ color: '#fa5252' }}>출고량 추이</span>
            </Title>
          </Group>
          <Badge size="md" color="red" variant="light">Monthly Trend</Badge>
        </Group>
      </Box>

      {/* 3. 차트 영역 */}
      <Box p="xl" style={{ height: '450px' }}>
        <ResponsiveContainer width="100%" height="100%" debounce={0}>
          <LineChart data={data} margin={{ top: 40, right: 30, left: 20, bottom: 30 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f3f5" />
            <XAxis 
              dataKey="년월" 
              tick={{ fontSize: 12, fontWeight: 500, fill: '#495057' }}
              padding={{ left: 30, right: 30 }}
              axisLine={{ stroke: '#dee2e6' }}
              label={{ value: '년월', position: 'insideBottom', offset: -10, fontSize: 12, fontWeight: 700 }}
            />
            <YAxis 
              tickFormatter={(value) => value.toLocaleString()}
              tick={{ fontSize: 12, fontWeight: 500, fill: '#495057' }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip 
              formatter={(value) => [value.toLocaleString() + ' 개', '출고수량']}
              contentStyle={{ 
                borderRadius: '8px', 
                border: '1px solid #eee', 
                boxShadow: '0 4px 12px rgba(0,0,0,0.08)' 
              }}
            />
            
            
           <Line 
              type="monotone" 
              dataKey="출고수량" 
              stroke="#fa5252" 
              strokeWidth={3} 
              dot={{ r: 5, fill: '#fa5252', strokeWidth: 2, stroke: '#fff' }}
              activeDot={{ r: 7 }}
              animationDuration={500}
            >
              {/* 동그라미 아래에 수치 표시 */}
              <LabelList 
                dataKey="출고수량" 
                position="top" 
                offset={15}
                formatter={(val) => val.toLocaleString()}
                style={{ fontSize: '12px', fontWeight: 700, fill: '#fa5252' }}
              />
            </Line>
          </LineChart>
        </ResponsiveContainer>
      </Box>
    </Paper>
  );
});

const DynamicDataTable = memo(({ data }) => {
  if (!data || data.length === 0) {
    return (
      <Box style={{ height: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Stack align="center" gap="xs">
          <ThemeIcon size={80} radius="xl" color="teal.0" c="teal.6" variant="light"><IconCircleCheck size={40} /></ThemeIcon>
          <Text c="dimmed" fz="lg" fw={500}>No Data!</Text>
        </Stack>
      </Box>
    );
  }

  const columns = Object.keys(data[0]);

  return (
    <ScrollArea h={500} scrollbars="xy" offsetScrollbars>
      <Table highlightOnHover withTableBorder withColumnBorders striped fontSize="xs" verticalSpacing="7px">
        <Table.Thead style={{ backgroundColor: '#f8f9fa', position: 'sticky', top: 0, zIndex: 1 }}>
          <Table.Tr>
            {columns.map((col) => (
              <Table.Th key={col} style={{ whiteSpace: 'nowrap' }}>{col.toUpperCase()}</Table.Th>
            ))}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {data.map((row, index) => (
            <Table.Tr key={index}>
              {columns.map((col) => {
                const value = row[col];
                const isCompareCol = col === '전월대비증감량';
                const isItemName = col === '품목명';
                return (
                  <Table.Td 
                    key={`${index}-${col}`} 
                    style={{ 
                      whiteSpace: isItemName ? 'normal' : 'nowrap',
                      maxWidth: isItemName ? '200px' : 'auto',
                      wordBreak: 'break-all',
                      fontSize: '12px'
                    }}
                  >
                    {typeof value === 'number' 
                      ? (isCompareCol 
                          ? <Text fz="12px" span fw={700} c={value < 0 ? 'blue.7' : value > 0 ? 'red.7' : 'inherit'}>{value.toLocaleString()}%</Text>
                          : value.toLocaleString())
                      : (value?.toString() || '-')}
                  </Table.Td>
                );
              })}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </ScrollArea>
  );
});