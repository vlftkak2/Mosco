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

export default function InventoryMonitorPage() {
  const [monitorData, setMonitorData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState('');

  const [detailData,setDetailData] = useState({
    exchrate:[],
    sapexchrate:[],
    rstin:[],
    rstout:[],
    wmsin:[],
    wmsout:[],
    rpcbotpassword:[],
    reqcheck:[],
    reqchecklist:[],
  })

  const fetchMonitorStatus = async () => {
    setLoading(true);
    try {
        const responses = await Promise.all([
          axios.get(`http://${window.location.hostname}/api/domestic-cms-exchrate`), //`http://${window.location.hostname}:8000/api/domestic-cms-exchrate`
          axios.get(`http://${window.location.hostname}/api/domestic-sap-exchrate`),
          axios.get(`http://${window.location.hostname}/api/domestic-inrst-check`),
          axios.get(`http://${window.location.hostname}/api/domestic-outrst-check`),
          axios.get(`http://${window.location.hostname}/api/domestic-wmsin-check`),
          axios.get(`http://${window.location.hostname}/api/domestic-wmsout-check`),
          axios.get(`http://${window.location.hostname}/api/domestic-password-check`),
          axios.get(`http://${window.location.hostname}/api/domestic-REQ-check`),
          axios.get(`http://${window.location.hostname}/api/domestic-REQlist-checklist`),
        ]);

        setDetailData({
          ...detailData,
          exchrate : responses[0].data.data,
          sapexchrate : responses[1].data.data,
          rstin : responses[2].data.data,
          rstout : responses[3].data.data,
          wmsin : responses[4].data.data,
          wmsout : responses[5].data.data,
          rpcbotpassword : responses[6].data.data,
          reqcheck : responses[7].data.data,
          reqchecklist : responses[8].data.data,
        })

        setLastUpdated(new Date().toLocaleTimeString());
      
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
                  <Title order={1} fz="40px" fw={900}>APR 국내 물류 <span style={{ color: '#e62222' }}>Monitor</span></Title>
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
                <Button variant="filled" color="red" size="lg" radius="md" leftSection={<IconSearch size={24} />} onClick={fetchMonitorStatus} loading={loading} onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
                onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}>조회</Button>
              </Group>
              
            </Group>
          </Paper>

          {lastUpdated && (
          <Box style={{ position: 'relative' }}>
            <Stack gap="md">
              <Grid gutter="md">

            <Grid.Col span={{ base: 12, md: 3 }}>
            {/* 1. MonitorSection을 한 번만 호출합니다. */}
            <MonitorSection 
              title="EXCHANGE" 
              subtitle="CMS 환율 수신 현황" 
              // 2. data 프롭스에 SEQ 1~7까지의 데이터를 배열로 만들어 한꺼번에 넘깁니다.
              data={[1, 2, 3, 4, 5, 6, 7].map((seq) => {
                const item = detailData.exchrate.find(ex => ex.SEQ === seq);
                const isValid = !!item && item.U_BASIC_DATE !== null && item.U_BASIC_DATE !== "";
                return {
                  content: item ? `${item.DT} (${item.WEEKNAME})` : `SEQ ${seq}`,
                  status: isValid
                };
              })} 
              field="status" 
            />
          </Grid.Col>

          <Grid.Col span={{ base: 12, md: 3 }}>
            {/* 1. MonitorSection을 한 번만 호출합니다. */}
            <MonitorSection 
              title="EXCHANGE" 
              subtitle="SAP 환율 수신 현황" 
              // 2. data 프롭스에 SEQ 1~7까지의 데이터를 배열로 만들어 한꺼번에 넘깁니다.
              data={[1, 2, 3, 4, 5, 6, 7].map((seq) => {
                const item = detailData.sapexchrate.find(ex => ex.SEQ === seq);
                const isValid = !!item && item.RateDate !== null && item.RateDate !== "";
                return {
                  content: item ? `${item.DT} (${item.WEEKNAME})` : `SEQ ${seq}`,
                  status: isValid
                };
              })} 
              field="status" 
            />
          </Grid.Col>          

          <Grid.Col span={{ base: 12, md: 3 }}>
            <Stack gap="md">
            <MonitorSection title="RST IN CHECK" subtitle="입고문서 생성 에러여부" data={[{
              content: 'RST 입고 : ',
              rstin : detailData.rstin.length===0
          }]} field="rstin" />

            <MonitorSection title="RST OUT CHECK" subtitle="출고문서 생성 에러여부" data={[{
              content: 'RST 출고 : ',
              rstout : detailData.rstout.length===0
          }]} field="rstout" />
          </Stack>

          </Grid.Col>

          <Grid.Col span={{ base: 12, md: 3 }}>
            <Stack gap="md">
            <MonitorSection title="WMS IN CHECK" subtitle="WMS 입고요청/실적미수신" data={[{
              content: 'RST 입고 : ',
              rstin : detailData.wmsin.length===0
          }]} field="rstin" />

            <MonitorSection title="WMS OUT CHECK" subtitle="WMS 출고요청/실적미수신" data={[{
              content: 'RST 출고 : ',
              rstout : detailData.wmsout.length===0
          }]} field="rstout" />
          </Stack>

          </Grid.Col>

          </Grid>

          <Grid gutter="md">

          <Grid.Col span={{ base: 12, md: 3 }}>
            <MonitorSection title="SAP RPA PASSWORD" subtitle="SAP RPA 비밀번호 갱신일자" data={[{
              content: `비밀번호 갱신일자 : ${detailData.rpcbotpassword[0]?.RemainingDay}일 남음`
          }]} field="" />
          </Grid.Col>

          <Grid.Col span={{ base: 12, md: 3 }}>
          <MonitorSection title="SAP REQ CHECK" subtitle="SAP REQ 이상문서 확인" data={[{
              content: 'REQ 확인 : ',
              reqcheck : detailData.reqcheck.length===0
          }]} field="reqcheck" />
          </Grid.Col>

          </Grid>

        </Stack>
      </Box>
      )}
      
    {lastUpdated && (
            <Paper radius="lg" shadow="md" withBorder mt={50} style={{ overflow: 'hidden', backgroundColor: '#fff' }}>
              {/* 헤더 섹션: 고정 높이 */}
              <Box p="md" style={{ borderTop: '5px solid #fa5252', borderBottom: '1px solid #eee' }}>
                <Group gap="xs">
                  <ThemeIcon variant="light" color="red" size="md">
                    <IconChartBar size={28} />
                  </ThemeIcon>
                  <Title order={3} fz="28px" fw={900}>
                    국내 물류 진행상황 <span style={{ color: '#fa5252' }}>상세</span>
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
                        RST입고 ({detailData.rstin.length})
                      </Tabs.Tab>                                                                           

                      <Tabs.Tab fz="18px" value="b" leftSection={<IconChecklist size={20} />}>
                        RST출고 ({detailData.rstout.length})
                      </Tabs.Tab>                                                                           

                      <Tabs.Tab fz="18px" value="c" leftSection={<IconChecklist size={20} />}>
                        WMS입고요청_실적미수신 ({detailData.wmsin.length})
                      </Tabs.Tab>                                                                           

                      <Tabs.Tab fz="18px" value="d" leftSection={<IconChecklist size={20} />}>
                        WMS출고요청_실적미수신 ({detailData.wmsout.length})
                      </Tabs.Tab>                                                                           

                      <Tabs.Tab fz="18px" value="e" leftSection={<IconChecklist size={20} />}>
                        SAP비밀번호_갱신 ({detailData.rpcbotpassword.length})
                      </Tabs.Tab>       

                      <Tabs.Tab fz="18px" value="f" leftSection={<IconChecklist size={20} />}>
                        REQ 확인 ({detailData.reqchecklist.length})
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
                              a: { data: detailData.rstin, label: 'RST입고_리스트' },
                              b: { data: detailData.rstout, label: 'RST출고_리스트' },
                              c: { data: detailData.wmsin, label: 'WMS입고_미수신' },
                              d: { data: detailData.wmsout, label: 'WMS출고_미수신' },
                              e: { data: detailData.rpcbotpassword, label: 'SAP_비밀번호 갱신' },
                              f: { data: detailData.reqchecklist, label: 'REQ_이상문서' },
                            };
                            const current = tabConfig[activeTab];
                            if(current) downloadExcel(current.data, current.label);
                          }}
                        // 데이터가 없으면 버튼을 비활성화해서 실수를 방지합니다
                        disabled={(() => {
                          const tabDataMap = {
                            a: detailData.rstin,
                            b: detailData.rstout,
                            c: detailData.wmsin,
                            d: detailData.wmsout,
                            e: detailData.rpcbotpassword,
                            f: detailData.reqchecklist,
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
                        data={detailData.rstin} 
                      />
                    </Box>
                  </Tabs.Panel>                                                 

                  <Tabs.Panel value="b" p="md">
                    <Box style={{ minHeight: '520px' }}> {/* 테이블 높이(500px) + 여유분 */}
                      <DynamicDataTable 
                        data={detailData.rstout} 
                      />
                    </Box>
                  </Tabs.Panel>                                                                   

                  <Tabs.Panel value="c" p="md">
                    <Box style={{ minHeight: '520px' }}> {/* 테이블 높이(500px) + 여유분 */}
                      <DynamicDataTable 
                        data={detailData.wmsin} 
                      />
                    </Box>
                  </Tabs.Panel>                                                                   

                  <Tabs.Panel value="d" p="md">
                    <Box style={{ minHeight: '520px' }}> {/* 테이블 높이(500px) + 여유분 */}
                      <DynamicDataTable 
                        data={detailData.wmsout} 
                      />
                    </Box>
                  </Tabs.Panel>         

                  <Tabs.Panel value="e" p="md">
                    <Box style={{ minHeight: '520px' }}> {/* 테이블 높이(500px) + 여유분 */}
                      <DynamicDataTable 
                        data={detailData.rpcbotpassword} 
                      />
                    </Box>
                  </Tabs.Panel>         

                  <Tabs.Panel value="f" p="md">
                    <Box style={{ minHeight: '520px' }}> {/* 테이블 높이(500px) + 여유분 */}
                      <DynamicDataTable 
                        data={detailData.reqchecklist} 
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
            <Box 
              key={item.content} 
              style={{ 
                padding: '10px 14px', 
                borderRadius: '10px', 
                // field가 없으면 기본 배경색, 있으면 성공/실패 색상 적용
                backgroundColor: field ? (item[field] ? '#f8f9fa' : '#fff5f5') : '#f8f9fa', 
                border: `1px solid ${field ? (item[field] ? '#e9ecef' : '#ffc9c9') : '#e9ecef'}`, 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center' 
              }}
            >
              <Group gap="sm">
                <Text fw={700} fz="20px">{item.content}</Text>
                
                {/* field가 있을 때만 '정상/이상' 텍스트를 보여줍니다 */}
                {field && (
                  <Text fw={800} fz="20px" c={item[field] ? 'teal.7' : 'red.7'}>
                    {item[field] ? '정상' : '이상'}
                  </Text>
                )}
              </Group>

              {/* field가 있을 때만 우측 체크/경고 아이콘을 보여줍니다 */}
              {field && (
                <ThemeIcon variant="light" color={item[field] ? 'teal' : 'red'} radius="xl" size="md">
                  {item[field] ? <IconCircleCheck size={16} /> : <IconAlertCircle size={16} />}
                </ThemeIcon>
              )}
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

