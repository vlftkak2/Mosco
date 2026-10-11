import { useEffect, useState, useMemo, memo, useCallback } from 'react';
import { 
  Title, Text, Paper, Group, Stack, Container, ThemeIcon, Grid, 
  Button, Badge, Box, LoadingOverlay, Tabs, Table, ScrollArea ,Divider 
} from '@mantine/core';
import { 
  IconCircleCheck, IconAlertCircle, IconRefresh, IconWorld, IconSearch,
  IconShieldCheck, IconTableAlias ,IconChartBar,IconChecklist,IconAlertTriangle 
} from '@tabler/icons-react';
import axios from 'axios';
import { TableVirtuoso } from 'react-virtuoso';
import { 
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, 
  CartesianGrid, Tooltip, LabelList 
} from 'recharts';

export default function D2CStatisticsPage() {
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState('');
  
  const [detailData,setdetailData] = useState({
    d2cday:[],
    d2cweek:[],
    d2cmonth:[],
    d2ccompare:[],
    d2cdaytop10:[],
    d2cweektop10:[],
    d2cmonthtop10:[],
    d2cweektop10title:[],
    d2cmonthtop10title:[],
  })

  const D2CStatisticsSearch = async () => {
    setLoading(true);
    try {
      const responseslist = await Promise.all([
          axios.get(`http://${window.location.hostname}/api/d2c-outday`), //`http://${window.location.hostname}:8000/api/d2c-outday`
          axios.get(`http://${window.location.hostname}/api/d2c-outweek`),
          axios.get(`http://${window.location.hostname}/api/d2c-outmonth`),
          axios.get(`http://${window.location.hostname}/api/d2c-outdaycompare`),
          axios.get(`http://${window.location.hostname}/api/d2c-outday-top10`),
          axios.get(`http://${window.location.hostname}/api/d2c-outweek-top10`),
          axios.get(`http://${window.location.hostname}/api/d2c-outmonth-top10`),
          axios.get(`http://${window.location.hostname}/api/d2c-outweektitle-top10`),
          axios.get(`http://${window.location.hostname}/api/d2c-outmonthtitle-top10`),
      ]);

      setdetailData({
        ...detailData,
          d2cday:responseslist[0].data.data,
          d2cweek:responseslist[1].data.data,
          d2cmonth:responseslist[2].data.data,
          d2ccompare:responseslist[3].data.data,
          d2cdaytop10:responseslist[4].data.data,
          d2cweektop10:responseslist[5].data.data,
          d2cmonthtop10:responseslist[6].data.data,
          d2cweektop10title:responseslist[7].data.data,
          d2cmonthtop10title:responseslist[8].data.data,
      })
      
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


  const formattedDate = useMemo(() => {
    const week = ['일', '월', '화', '수', '목', '금', '토'];
    const now = new Date();
    return `${now.toISOString().split('T')[0]} (${week[now.getDay()]})`;
  }, []);

  return (
    <Box style={{ backgroundColor: '#f1f3f5', minHeight: '100vh', paddingBottom: '40px' }}>
      <Box style={{ height: '200px', background: 'linear-gradient(135deg, #ee7373 0%, #ec0a0a 100%)', position: 'absolute', top: 0, left: 0, right: 0 }} />
      
      <Container size="100%" style={{ position: 'relative', paddingTop: '40px' }}>
        <LoadingOverlay visible={loading} overlayProps={{ radius: "lg", blur: 2 }} loaderProps={{ size: 'xl', color: 'red', type: 'bars' }} />
        <Stack gap="lg">
          
          {/* 헤더 섹션 */}
           <Paper p="xl" radius="lg" shadow="md" withBorder style={{ backdropFilter: 'blur(10px)', backgroundColor: 'rgba(255, 255, 255, 0.9)' }}>
            <Group justify="space-between">
              <Stack gap={5}>
                <Group gap="sm">
                  <Title order={1} fz="40px" fw={900}>APR 자사몰 통계 <span style={{ color: '#e62222' }}>Monitor</span></Title>
                </Group>
                <Group gap="xs">
                  <Badge variant="dot" c="teal" size="lg">System Active</Badge>
                  <Text size="md" c="dimmed" fw={500}>{formattedDate}</Text>

                  <Divider orientation="vertical" h={30} /> 
                  <Text size="md" c="red.7" fw={700}>데이터 기준일: {yesterdayDate}</Text>
                </Group>
              </Stack>
              <Group gap="md">
                <Stack align="flex-end" gap={0}>
                  <Text size="md" c="dimmed" fw={700}>LAST UPDATED</Text>
                  <Text size="md" fw={500}>{lastUpdated}</Text>
                </Stack>
                <Button variant="filled" color="red" size="lg" radius="md" leftSection={<IconSearch size={24} />} onClick={D2CStatisticsSearch} loading={loading}                 onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
                onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}>조회</Button>
              </Group>
    
            </Group>
          </Paper>

          {lastUpdated && (
            <>
          <Paper radius="lg" shadow="md" withBorder mt={50} style={{ overflow: 'hidden', backgroundColor: '#fff' }}>
          <Box p="md" style={{ borderTop: '5px solid #fa5252', borderBottom: '1px solid #eee' }}>
              <Group gap="xs">
                <ThemeIcon variant="light" color="red" size="md">
                  <IconChartBar size={28} />
                </ThemeIcon>
                <Title order={3} fz="22px" fw={900}>
                  통계 <span style={{ color: '#fa5252' }}>대시보드</span>
                </Title>
              </Group>
            </Box>

          <Box p="md" >
          <Stack gap="xs">
          <Box mt="md">
            <Grid gutter="lg">
              <Grid.Col span={{ base: 12, lg: 4 }}>
                <D2CBarChart 
                    title="일별 출고량(7일 평균 / 어제 / 오늘)" 
                    data={[
                      { name: detailData.d2cday[0]?.구분, value: detailData.d2cday[0]?.출고수량 || 0},
                      { name: detailData.d2cday[1]?.구분, value: detailData.d2cday[1]?.출고수량 || 0 },
                      { name: detailData.d2cday[2]?.구분, value: detailData.d2cday[2]?.출고수량 || 0 },
                    ]} 
                  />
                </Grid.Col>

                <Grid.Col span={{ base: 12, lg: 4 }}>
                  <D2CBarChart 
                    title="주별 출고량(4주 평균 / 지난주 / 이번주)" 
                    data={[
                      { name: detailData.d2cweek[0]?.구분, value: detailData.d2cweek[0]?.출고수량 || 0 },
                      { name: detailData.d2cweek[1]?.구분, value: detailData.d2cweek[1]?.출고수량 || 0 },
                      { name: detailData.d2cweek[2]?.구분, value: detailData.d2cweek[2]?.출고수량 || 0 },
                    ]} 
                  />
              </Grid.Col>

                <Grid.Col span={{ base: 12, lg: 4 }}>
                  <D2CBarChart 
                    title="월별 출고량(6개월 평균 / 지난달 / 이번달)" 
                    data={[
                      { name: detailData.d2cmonth[0]?.구분, value: detailData.d2cmonth[0]?.출고수량 || 0 },
                      { name: detailData.d2cmonth[1]?.구분, value: detailData.d2cmonth[1]?.출고수량 || 0 },
                      { name: detailData.d2cmonth[2]?.구분, value: detailData.d2cmonth[2]?.출고수량 || 0 },
                    ]} 
                  />
              </Grid.Col>

            </Grid>
          </Box>
          </Stack>
          </Box>     
        </Paper>

        <Paper p="md" radius="md" shadow="sm" withBorder w="33%" h="30vh" mah={300} mih={200} >
            <Stack gap="sm">
              <Group justify="space-between">
                <Group gap="xs">
                  <ThemeIcon variant="light" color="red" size="md">
                    <IconTableAlias size={22} />
                  </ThemeIcon>
                <Title order={3} fz="22px" fw={800}>
                  자사몰 <span style={{ color: '#fa5252' }}>출고비교 검증 현황</span>
                </Title>
                </Group>
                <Badge size="md" color="red" variant="light">전일 대비 증감</Badge>
              </Group>
              <Divider color="gray.1" />
              <DynamicDataTable data={detailData.d2ccompare} />
            </Stack>
          </Paper>
              
        <Grid gutter="md">
        {/* 첫 번째 테이블: 일별 */}
        <Grid.Col span={{ base: 12, md: 4 }}>
          <TableCard 
            title={yesterdayDate} 출고수량 TOP
            data={detailData.d2cdaytop10} 
            color="red" 
          />
        </Grid.Col>

        {/* 두 번째 테이블: 주별 */}
        <Grid.Col span={{ base: 12, md: 4 }}>
          <TableCard 
            title={`${detailData.d2cweektop10title[0]?.주차 || 0}주차 출고수량`}
            data={detailData.d2cweektop10} 
            color="red" 
          />
        </Grid.Col>

        {/* 세 번째 테이블: 월별 */}
        <Grid.Col span={{ base: 12, md: 4 }}>
          <TableCard 
            title={`${detailData.d2cmonthtop10title[0]?.월 || 0}월 출고수량`}
            data={detailData.d2cmonthtop10} 
            color="red" 
          />
        </Grid.Col>
      </Grid>
      </>
)}

        </Stack>
      </Container>
    </Box>
  );
}

const TableCard = ({ title, data, color }) => (
  <Paper p="md" radius="md" shadow="sm" withBorder h="100%">
    <Stack gap="sm" h="100%">
      <Group justify="space-between">
        <Group gap="xs">
          <ThemeIcon variant="light" color={color} size="md">
            <IconTableAlias size={22} />
          </ThemeIcon>
          <Title order={3} fz="22px" fw={900}>
            <span style={{ color: `var(--mantine-color-${color}-6)` }}>{title} TOP 10</span>
          </Title>
        </Group>
        <Badge size="sm" color={color} variant="light">현황</Badge>
      </Group>
      <Divider color="gray.1" />
      
      {/* 높이를 고정하여 가로 줄을 맞춤 */}
      <Box style={{ flex: 1,width:'100%',overflowX: 'auto', minHeight: '300px' }}>
        <DynamicDataTable data={data} />
      </Box>
    </Stack>
  </Paper>
);

const D2CBarChart = ({ title, data }) => {
  // 제목 색상 분리를 위한 처리
  const mainTitle = title.split('(')[0];
  const subTitle = title.includes('(') ? `(${title.split('(')[1]}` : '';

  return (
    <Paper radius="md" withBorder shadow="sm" style={{ backgroundColor: '#fff', overflow: 'hidden' }}>
      {/* 스크린샷의 무지개색 상단 라인 재현 */}
      <Box h={3} style={{ backgroundColor: 'var(--mantine-color-red-8)' }} />
      
      <Stack p="md" gap={0}>
        <Group justify="space-between" align="center" mb="xs">
          <Title order={3} fz="18px" fw={800}>
            <span style={{ color: '#e03131' }}>{mainTitle}</span>
            <span style={{ color: '#868e96', fontSize: '15px', fontWeight: 500, marginLeft: '8px' }}>{subTitle}</span>
          </Title>
        </Group>

        {/* ResponsiveContainer 에러 방지를 위해 확실한 높이 지정 */}
        <Box style={{ height: 200, minHeight: 220, position: 'relative' }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              layout="vertical"
              data={data}
              margin={{ top: 5, right: 60, left: 10, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f3f5" />
              <XAxis type="number" hide />
              <YAxis 
                dataKey="name" 
                type="category" 
                tick={{ fontSize: 13, fontWeight: 600, fill: '#495057' }} 
                width={80}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip 
                cursor={{ fill: '#f8f9fa' }}
                contentStyle={{ borderRadius: '8px', border: '1px solid #eee' }}
                formatter={(value) => [value.toLocaleString() + '개', '출고량']}
              />
              <Bar dataKey="value" fill="#e67e5f" radius={[0, 4, 4, 0]} barSize={35}>
                {/* 바 안쪽에 숫자 표시 (스크린샷 재현) */}
                <LabelList 
                  dataKey="value" 
                  position="insideRight" 
                  offset={10}
                  formatter={(v) => v.toLocaleString()} 
                  style={{ fontSize: '14px', fontWeight: 700, fill: '#333' }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Box>
        <Text align="center" fz="12px" c="dimmed" fw={700} mt="sm">출고수량</Text>
      </Stack>
    </Paper>



  );
};

function DynamicDataTable({ data }) {
  if (!data || data.length === 0) {
    return (
      <Box style={{ height: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Stack align="center" gap="xs">
          <ThemeIcon size={60} radius="xl" color="teal.0" c="teal.6" variant="light"><IconCircleCheck size={40} /></ThemeIcon>
          <Text c="dimmed" fz="sm" fw={500}>이슈 데이터 없음!</Text>
        </Stack>
      </Box>
    );
  }

  const columns = Object.keys(data[0]);

  return (
    <Stack gap="xs">
      {/* h={300} 고정을 제거하거나 유지하되, 가로 스크롤(x)을 허용합니다. */}
      <ScrollArea scrollbars="x" offsetScrollbars>
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
                  const isCompareCol = col === '전일대비증감량';
                  const isItemName = col === '품목명';

                  return (
                    <Table.Td 
                      key={`${index}-${col}`} 
                      style={{ 
                        /* 핵심: 품목명 열은 가로 길이를 제한하고 줄바꿈을 허용함 */
                        whiteSpace: isItemName ? 'normal' : 'nowrap',
                        maxWidth: isItemName ? '200px' : 'auto',
                        wordBreak: 'break-all',
                        fontSize: '12px'
                      }}
                    >
                      {typeof value === 'number' 
                        ? (isCompareCol 
                            ? <Text span fw={700} c={value < 0 ? 'blue.7' : value > 0 ? 'red.7' : 'inherit'}>{value.toLocaleString()}%</Text>
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
    </Stack>
  );
}