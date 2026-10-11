import { useEffect, useState, useMemo, memo, useCallback } from 'react';
import { 
  Title, Text, Paper, Group, Stack, Container, ThemeIcon, Grid, 
  Button, Badge, Box, LoadingOverlay, Tabs, Table, ScrollArea 
} from '@mantine/core';
import { 
  IconCircleCheck, IconAlertCircle, IconRefresh, IconWorld, IconSearch,
  IconShieldCheck, IconTableAlias ,IconChartBar,IconChecklist,IconAlertTriangle 
} from '@tabler/icons-react';
import axios from 'axios';
import { TableVirtuoso } from 'react-virtuoso';
import { notifications } from '@mantine/notifications';
import * as XLSX from 'xlsx';
import 'dayjs/locale/ko';
import dayjs from 'dayjs';

const COUNTRY_MAP = ["미국", "홍콩", "일본", "대만", "싱가포르", "말레이시아","네덜란드"];

export default function InventoryMonitorPage() {
  const [monitorData, setMonitorData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState('');
  const [detailData,setDetailData] = useState({
    shortage:[],
    etcAllSearch:[],
    exceptAllSearch:[],
    moveAllSearch:[],
    notinAllSearch:[],
    notoutAllSearch:[],
  })

  const fetchMonitorStatus = async () => {
    setLoading(true);
    try {
      const collectRes = await axios.get(`http://${window.location.hostname}/api/get-inventory-collect`); //`http://${window.location.hostname}:8000/api/get-inventory-collect`
      
      if (collectRes.data.success) {
        const responses = await Promise.all([
          axios.get(`http://${window.location.hostname}/api/sap-monitor-shortage`), //http://127.0.0.1:8000/api/sap-monitor-shortage
          axios.get(`http://${window.location.hostname}/api/sap-monitor-instockerror`),
          axios.get(`http://${window.location.hostname}/api/sap-monitor-outstockerror`),
          axios.get(`http://${window.location.hostname}/api/sap-monitor-progrestockerror`),
          axios.get(`http://${window.location.hostname}/api/sap-monitor-cancel-etcsearch`),
          axios.get(`http://${window.location.hostname}/api/sap-monitor-cancel-exceptsearch`),
          axios.get(`http://${window.location.hostname}/api/sap-monitor-cancel-movesearch`),
          axios.get(`http://${window.location.hostname}/api/sap-monitor-request-notinsearch`),
          axios.get(`http://${window.location.hostname}/api/sap-monitor-request-notoutsearch`)
        ]);

        // 2. 메인 대시보드 요약 데이터 가공
        const createMap = (data) => Object.fromEntries((data || []).map(item => [item.country, item.is_normal]));
        const formattedData = COUNTRY_MAP.map((country) => ({
          country,
          inventory: createMap(responses[0].data.data)[country] ?? true,
          incoming: createMap(responses[1].data.data)[country] ?? true,
          outgoing: createMap(responses[2].data.data)[country] ?? true,
          progregoing: createMap(responses[3].data.data)[country] ?? true,
          canceletc: createMap(responses[4].data.data)[country] ?? true,
          cancelexcept: createMap(responses[5].data.data)[country] ?? true,
          cancelmove: createMap(responses[6].data.data)[country] ?? true,
          reqnotin: createMap(responses[7].data.data)[country] ?? true,
          reqnotout: createMap(responses[8].data.data)[country] ?? true,
        }));

        const detailresponses = await Promise.all([
          axios.get(`http://${window.location.hostname}/api/sap-monitor-Allshortage`),
          axios.get(`http://${window.location.hostname}/api/sap-monitor-cancel-etcAllsearch`),
          axios.get(`http://${window.location.hostname}/api/sap-monitor-cancel-exceptAllsearch`),
          axios.get(`http://${window.location.hostname}/api/sap-monitor-cancel-moveAllsearch`),
          axios.get(`http://${window.location.hostname}/api/sap-monitor-request-notinAllsearch`),
          axios.get(`http://${window.location.hostname}/api/sap-monitor-request-notoutAllsearch`),          
        ]);

        setDetailData({
          ...detailData,
          shortage:detailresponses[0].data.data,
          etcAllSearch:detailresponses[1].data.data,
          exceptAllSearch:detailresponses[2].data.data,
          moveAllSearch:detailresponses[3].data.data,
          notinAllSearch:detailresponses[4].data.data,
          notoutAllSearch:detailresponses[5].data.data,
        })

        setMonitorData(formattedData);
        setLastUpdated(new Date().toLocaleTimeString());
      }
    } catch (error) {
      console.error("데이터 로드 에러:", error);
    } finally {
      setLoading(false);
    }
  };

const [activeTab, setActiveTab] = useState('a');

const downloadExcel = (data, title) => {
  if (!data || data.length === 0) {
    notifications.show({
      title: '다운로드 실패',
      message: '조회된 데이터가 없습니다.',
      color: 'red',
    });
    return;
  }

  try {
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Result");

    const fileName = `${title}_${dayjs().format('YYYYMMDD_HHmm')}.xlsx`;
    XLSX.writeFile(workbook, fileName);

    notifications.show({
      title: '다운로드 완료',
      message: `${fileName} 파일이 생성되었습니다.`,
      color: 'teal',
      icon: <IconCircleCheck size={20} />,
    });
  } catch (err) {
    console.error('Excel Download Error:', err);
  }
};  


  // 날짜 정보
  const formattedDate = useMemo(() => {
    const week = ['일', '월', '화', '수', '목', '금', '토'];
    const now = new Date();
    return `${now.toISOString().split('T')[0]} (${week[now.getDay()]})`;
  }, []);

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
                  <Title order={1} fz="40px" fw={900}>APR 해외 물류 <span style={{ color: '#e62222' }}>Monitor</span></Title>
                </Group>
                <Group gap="xs">
                  <Badge variant="dot" c="teal" size="lg">System Active</Badge>
                  <Text size="md" c="dimmed" fw={500}>{formattedDate}</Text>
                </Group>
              </Stack>

              <Group gap="md">
                <Stack align="flex-end" gap={0}>
                  <Text size="md" c="dimmed" fw={700}>LAST UPDATED</Text>
                  <Text size="md" fw={500}>{lastUpdated}</Text>
                </Stack>
                <Button variant="filled" color="red" size="lg" radius="md" leftSection={<IconSearch size={24} />} onClick={fetchMonitorStatus} loading={loading}                 onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
                onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}>조회</Button>
              </Group>
              
            </Group>
          </Paper>

            {lastUpdated && (
          <Box style={{ position: 'relative' }}>
            <Stack gap="md">
              <Grid gutter="md">
                <Grid.Col span={{ base: 12, md: 3 }}><MonitorSection title="Inventory" subtitle="SAP 재고부족" data={monitorData} field="inventory" /></Grid.Col>
                <Grid.Col span={{ base: 12, md: 3 }}><MonitorSection title="Incoming" subtitle="SAP 입고에러" data={monitorData} field="incoming" /></Grid.Col>
                <Grid.Col span={{ base: 12, md: 3 }}><MonitorSection title="Outgoing" subtitle="SAP 출고에러" data={monitorData} field="outgoing" /></Grid.Col>
                <Grid.Col span={{ base: 12, md: 3 }}><MonitorSection title="Progress" subtitle="SAP 문서생성" data={monitorData} field="progregoing" /></Grid.Col>
              </Grid>
              <Grid gutter="md">
                <Grid.Col span={{ base: 12, md: 3 }}><MonitorSection title="Cancel ETC" subtitle="기타출고 취소" data={monitorData} field="canceletc" /></Grid.Col>
                <Grid.Col span={{ base: 12, md: 3 }}><MonitorSection title="Cancel EXCP" subtitle="예외주문 취소" data={monitorData} field="cancelexcept" /></Grid.Col>
                <Grid.Col span={{ base: 12, md: 3 }}><MonitorSection title="Cancel MOVE" subtitle="재고이전 취소" data={monitorData} field="cancelmove" /></Grid.Col>
                <Grid.Col span={{ base: 12, md: 3 }}><MonitorSection title="Request IN" subtitle="입고요청 미수신" data={monitorData} field="reqnotin" /></Grid.Col>
              </Grid>
              <Grid gutter="md">
                <Grid.Col span={{ base: 12, md: 3 }}><MonitorSection title="Request OUT" subtitle="출고요청 미수신" data={monitorData} field="reqnotout" /></Grid.Col>
              </Grid>
            </Stack>
          </Box>
          )}

          {lastUpdated
           && (
            <Paper radius="lg" shadow="md" withBorder mt={50} style={{ overflow: 'hidden', backgroundColor: '#fff' }}>
              {/* 헤더 섹션: 고정 높이 */}
              <Box p="md" style={{ borderTop: '5px solid #fa5252', borderBottom: '1px solid #eee' }}>
                <Group gap="xs">
                  <ThemeIcon variant="light" color="red" size="md">
                    <IconChartBar size={28} />
                  </ThemeIcon>
                  <Title order={3} fz="28px" fw={900}>
                    해외 물류 진행상황 <span style={{ color: '#fa5252' }}>상세</span>
                  </Title>
                </Group>
              </Box>

              {/* Tabs 전체를 감싸는 영역에 minHeight를 주어 스크롤 튐 방지 */}
              <Box style={{ minHeight: '650px', position: 'relative' }}>
                <Tabs value={activeTab} onChange={setActiveTab} color="red" variant="outline" keepMounted={false}>
                  
                  {/* 탭 버튼 리스트 */}
                  <Box p="md" style={{ borderBottom: '1px solid #eee', backgroundColor: '#fafafa' }}>
                    <Group justify="space-between">
                    <Tabs.List>
                      <Tabs.Tab fz="18px" value="a" leftSection={<IconChecklist size={20} />}>
                        재고부족 ({detailData.shortage.length})
                      </Tabs.Tab>
                      <Tabs.Tab fz="18px" value="b" leftSection={<IconChecklist size={20} />}>
                        기타출고-선택마감 ({detailData.etcAllSearch.length})
                      </Tabs.Tab>
                      <Tabs.Tab fz="18px" value="c" leftSection={<IconChecklist size={20} />}>
                        예외주문-선택마감 ({detailData.exceptAllSearch.length})
                      </Tabs.Tab>    
                      <Tabs.Tab fz="18px" value="d" leftSection={<IconChecklist size={20} />}>
                        재고이전-선택마감 ({detailData.moveAllSearch.length})
                      </Tabs.Tab>          
                      <Tabs.Tab fz="18px" value="e" leftSection={<IconChecklist size={20} />}>
                        입고요청-실적미수신 ({detailData.notinAllSearch.length})
                      </Tabs.Tab>
                      <Tabs.Tab fz="18px" value="f" leftSection={<IconChecklist size={20} />}>
                        출고요청-실적미수신 ({detailData.notoutAllSearch.length})
                      </Tabs.Tab>                                                                              
                    </Tabs.List>

                    <Button 
                        variant="filled" 
                        color="green.7" 
                        size="md" 
                        radius="md"
                        leftSection={<IconTableAlias size={20} />}
                        onClick={() => {
                            const tabConfig = {
                              a: { data: detailData.shortage, label: '재고부족_리스트' },
                              b: { data: detailData.etcAllSearch, label: '기타출고-선택마감' },
                              c: { data: detailData.exceptAllSearch, label: '예외주문-선택마감' },
                              d: { data: detailData.moveAllSearch, label: '재고이전-선택마감' },
                              e: { data: detailData.notinAllSearch, label: '입고요청-실적미수신' },
                              f: { data: detailData.notoutAllSearch, label: '출고요청-실적미수신' },
                            };
                            const current = tabConfig[activeTab];
                            if(current) downloadExcel(current.data, current.label);
                          }}
                        // 데이터가 없으면 버튼을 비활성화해서 실수를 방지합니다
                        disabled={(() => {
                          const tabDataMap = {
                            a: detailData.shortage,
                            b: detailData.etcAllSearch,
                            c: detailData.exceptAllSearch,
                            d: detailData.moveAllSearch,
                            e: detailData.notinAllSearch,
                            f: detailData.notoutAllSearch,
                          };
                          const currentData = tabDataMap[activeTab];
                          return !currentData || currentData.length === 0;
                        })()}
                        style={{ 
                        boxShadow: '0 4px 10px rgba(40, 167, 69, 0.15)',
                        borderBottom: '2px solid #2b8a3e'
                        }}
                    >
                        전체 결과 Excel 다운로드
                    </Button>     

                    </Group>
                  </Box>

                  {/* 로딩 중에도 테이블 영역이 사라지지 않도록 Panel의 패딩과 높이 관리 */}
                  <Tabs.Panel value="a" p="md">
                    <Box style={{ minHeight: '520px' }}> {/* 테이블 높이(500px) + 여유분 */}
                      <DynamicDataTable 
                        data={detailData.shortage} 
                      />
                    </Box>
                  </Tabs.Panel>

                  <Tabs.Panel value="b" p="md">
                    <Box style={{ minHeight: '520px' }}>
                      <DynamicDataTable 
                        data={detailData.etcAllSearch} 
                      />
                    </Box>
                  </Tabs.Panel>

                  <Tabs.Panel value="c" p="md">
                    <Box style={{ minHeight: '520px' }}>
                      <DynamicDataTable 
                        data={detailData.exceptAllSearch} 
                      />
                    </Box>
                  </Tabs.Panel>

                  <Tabs.Panel value="d" p="md">
                    <Box style={{ minHeight: '520px' }}>
                      <DynamicDataTable 
                        data={detailData.moveAllSearch} 
                      />
                    </Box>
                  </Tabs.Panel>

                  <Tabs.Panel value="e" p="md">
                    <Box style={{ minHeight: '520px' }}>
                      <DynamicDataTable 
                        data={detailData.notinAllSearch} 
                      />
                    </Box>
                  </Tabs.Panel>

                  <Tabs.Panel value="f" p="md">
                    <Box style={{ minHeight: '520px' }}>
                      <DynamicDataTable 
                        data={detailData.notoutAllSearch} 
                      />
                    </Box>
                  </Tabs.Panel>                                                      

                </Tabs>
              </Box>
            </Paper>
          )}
          

        </Stack>
      </Container>
    </Box>
  );
}

// 모니터링 섹션 컴포넌트
function MonitorSection({ title, subtitle, data, field }) {
  return (
    <Paper p="xl" radius="lg" withBorder shadow="xs" style={{ backgroundColor: '#fff' }}>
      <Stack gap="md">
        <Group justify="space-between">
          <div>
            <Text fw={900} fz="24px" c="red" tt="uppercase">{title}</Text>
            <Title order={3} fz="20px">{subtitle}</Title>
          </div>
          <IconShieldCheck size={24} color="#e62222" />
        </Group>
        <Stack gap="xs">
          {data.map((item) => (
            <Box key={item.country} style={{ padding: '10px 14px', borderRadius: '10px', backgroundColor: item[field] ? '#f8f9fa' : '#fff5f5', border: `1px solid ${item[field] ? '#e9ecef' : '#ffc9c9'}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Group gap="sm">
                <Text fw={700} fz="20px">{item.country}</Text>
                <Text fw={800} fz="20px" c={item[field] ? 'teal.7' : 'red.7'}>{item[field] ? '정상' : '이상'}</Text>
              </Group>
              <ThemeIcon variant="light" color={item[field] ? 'teal' : 'red'} radius="xl" size="md">
                {item[field] ? <IconCircleCheck size={16} /> : <IconAlertCircle size={16} />}
              </ThemeIcon>
            </Box>
          ))}
        </Stack>
      </Stack>
    </Paper>
  );
}

const DynamicDataTable = memo(({ data }) => {

  const columns = useMemo(() => {
    return data && data.length > 0 ? Object.keys(data[0]) : [];
  }, [data]);

  // 2. 컬럼 너비 계산 (Hook 규칙 준수를 위해 항상 최상단 위치)
  const columnWidths = useMemo(() => {
    const widths = {};
    if (columns.length === 0) return widths;

    columns.forEach(col => {
      let maxLength = col.length; 
      data.forEach(row => {
        const val = row[col] ? String(row[col]) : "";
        if (val.length > maxLength) maxLength = val.length;
      });
      widths[col] = Math.min(Math.max(maxLength * 10 + 40, 120), 500);
    });
    
    return widths;
  }, [data, columns]);

  if (!data || data.length === 0) {
      return (
        <Box style={{ height: '500px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Stack align="center" gap="0">
            <ThemeIcon size={100} radius="xl" color="teal.0" c="teal.6" variant="light">
              <IconCircleCheck size={60} />
            </ThemeIcon>
            <Stack gap={0} align="center">
              <Text fz="28px" fw={900} c="teal.9">
                No Issues Detected
              </Text>
              <Text c="dimmed" fz="lg" fw={500}>
                이슈데이터 없음!
              </Text>
            </Stack>
          </Stack>
        </Box>
      );
    }  

  return (
    <Box style={{ height: 500, border: '1px solid #eee', borderRadius: '8px', overflow: 'hidden' }}>
      <TableVirtuoso
        data={data}
        style={{ height: 500 }}
        components={{
          Table: (props) => (
            <Table 
              {...props} 
              highlightOnHover 
              withColumnBorders 
              striped 
              // Autofit을 위해 tableLayout: 'auto' 사용 (또는 fixed 유지하고 width 지정)
              style={{ tableLayout: 'fixed', width: 'max-content', minWidth: '100%', borderCollapse: 'collapse' }} 
            />
          ),
          TableHead: Table.Thead,
          TableRow: Table.Tr,
          TableBody: Table.Tbody,
        }}
        fixedHeaderContent={() => (
          <Table.Tr style={{ backgroundColor: '#f8f9fa' }}>
            {columns.map((col) => (
              <Table.Th 
                key={col} 
                style={{ 
                  width: `${columnWidths[col]}px`, 
                  backgroundColor: '#f8f9fa', 
                  zIndex: 2,
                  whiteSpace: 'nowrap'
                }}
              >
                {col.toUpperCase()}
              </Table.Th>
            ))}
          </Table.Tr>
        )}
        itemContent={(index, row) => (
          <>
            {columns.map((col) => (
              <Table.Td 
                key={`${index}-${col}`} 
                style={{ 
                  width: `${columnWidths[col]}px`, 
                  whiteSpace: 'nowrap', 
                  overflow: 'hidden', 
                  textOverflow: 'ellipsis' 
                }}
              >
                {typeof row[col] === 'number' 
                  ? row[col].toLocaleString() 
                  : (row[col]?.toString() || '-')}
              </Table.Td>
            ))}
          </>
        )}
      />
    </Box>
  );
});


// const DynamicDataTable = memo(({data}) => {
  
//   if (!data || data.length === 0) {
//       return (
//         <Box style={{ height: '500px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
//           <Stack align="center" gap="0">
//             <ThemeIcon size={100} radius="xl" color="teal.0" c="teal.6" variant="light">
//               <IconCircleCheck size={60} />
//             </ThemeIcon>
//             <Stack gap={0} align="center">
//               <Text fz="28px" fw={900} c="teal.9">
//                 No Issues Detected
//               </Text>
//               <Text c="dimmed" fz="lg" fw={500}>
//                 이슈데이터 없음!
//               </Text>
//             </Stack>
//           </Stack>
//         </Box>
//       );
//     }

//   // 1. 첫 번째 데이터를 기준으로 모든 컬럼명(Key) 추출
//   const columns = Object.keys(data[0]);

//   return (
//     <Stack gap="xs">
//       <ScrollArea h={500} scrollbars="xy" offsetScrollbars>
//         <Table highlightOnHover withTableBorder withColumnBorders striped >
//           {/* 헤더 자동 생성 */}
//           <Table.Thead style={{ backgroundColor: 'var(--mantine-color-gray-0)', position: 'sticky', top: 0, zIndex: 1 }}>
//             <Table.Tr>
//               {columns.map((col) => (
//                 <Table.Th key={col} style={{ whiteSpace: 'nowrap' }}>
//                   {col.toUpperCase()} {/* 컬럼명을 대문자로 표시 */}
//                 </Table.Th>
//               ))}
//             </Table.Tr>
//           </Table.Thead>

//           {/* 데이터 행 자동 생성 */}
//           <Table.Tbody>
//             {data.map((row, index) => (
//               <Table.Tr key={index}>
//                 {columns.map((col) => (
//                   <Table.Td key={`${index}-${col}`} style={{ whiteSpace: 'nowrap' }}>
//                     {typeof row[col] === 'number' 
//                       ? row[col].toLocaleString() 
//                       : (row[col]?.toString() || '-')}
//                   </Table.Td>
//                 ))}
//               </Table.Tr>
//             ))}
//           </Table.Tbody>
//         </Table>
//       </ScrollArea>
//     </Stack>
//   );
// })
