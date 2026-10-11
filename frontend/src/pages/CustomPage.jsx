import { useMemo, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  Group,
  Paper,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconDeviceFloppy, IconDownload, IconPlus, IconSearch, IconTrash } from '@tabler/icons-react';
import classes from '../styles/pages/CustomPage.module.css';
import dashboardClasses from '../styles/pages/HomePage.module.css';

const emptyPartner = () => ({
  partnerCode: '',
  partnerName: '',
  businessNumber: '',
  representative: '',
  partnerType: '매입처',
  phone: '',
  address: '',
  active: '사용중',
  note: '',
});

const demoPartners = [
  { ...emptyPartner(), partnerCode: 'CUST-001', partnerName: '한빛스틸', businessNumber: '000-00-00001', representative: '홍길동', partnerType: '매입처', phone: '02-555-0001', address: '서울특별시 중구 세종대로 1', active: '사용중', note: '' },
  { ...emptyPartner(), partnerCode: 'CUST-002', partnerName: '가온메탈', businessNumber: '000-00-00002', representative: '김민수', partnerType: '매출처', phone: '02-555-0002', address: '서울특별시 강남구 테헤란로 2', active: '사용중', note: '' },
  { ...emptyPartner(), partnerCode: 'CUST-003', partnerName: '미래금속', businessNumber: '000-00-00003', representative: '이서연', partnerType: '매입처', phone: '02-555-0003', address: '경기도 성남시 분당구 3', active: '사용중', note: '' },
  { ...emptyPartner(), partnerCode: 'CUST-004', partnerName: '동해산업', businessNumber: '000-00-00004', representative: '박지훈', partnerType: '매입처', phone: '02-555-0004', address: '부산광역시 해운대구 4', active: '사용중지', note: '' },
  { ...emptyPartner(), partnerCode: 'CUST-005', partnerName: '새길유통', businessNumber: '000-00-00005', representative: '최유진', partnerType: '매출처', phone: '02-555-0005', address: '인천광역시 연수구 5', active: '사용중', note: '' },
];

export default function PartnerRegistrationPage() {
  const [partners, setPartners] = useState(demoPartners);
  const [selectedCode, setSelectedCode] = useState(demoPartners[0].partnerCode);
  const [draft, setDraft] = useState({ ...demoPartners[0] });
  const [isNew, setIsNew] = useState(false);
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('전체');

  const filteredPartners = useMemo(() => {
    const normalizedQuery = appliedQuery.trim().toLocaleLowerCase();
    return partners.filter((partner) => {
      const matchesQuery = !normalizedQuery
        || partner.partnerCode.toLocaleLowerCase().includes(normalizedQuery)
        || partner.partnerName.toLocaleLowerCase().includes(normalizedQuery);
      const matchesStatus = statusFilter === '전체' || partner.active === statusFilter;
      return matchesQuery && matchesStatus;
    });
  }, [appliedQuery, partners, statusFilter]);

  const selectPartner = (partner) => {
    setSelectedCode(partner.partnerCode);
    setDraft({ ...partner });
    setIsNew(false);
  };

  const startNewPartner = () => {
    setDraft(emptyPartner());
    setSelectedCode(null);
    setIsNew(true);
  };

  const updateDraft = (field) => (eventOrValue) => {
    const value = typeof eventOrValue === 'string'
      ? eventOrValue
      : eventOrValue?.currentTarget?.value ?? '';
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const savePartner = () => {
    if (!draft.partnerCode.trim() || !draft.partnerName.trim()) {
      notifications.show({ title: '필수 항목 확인', message: '거래처코드와 거래처명은 필수입니다.', color: 'red' });
      return;
    }
    if (isNew && partners.some((partner) => partner.partnerCode === draft.partnerCode.trim())) {
      notifications.show({ title: '중복 코드', message: '이미 등록된 거래처코드입니다.', color: 'red' });
      return;
    }

    const saved = { ...draft, partnerCode: draft.partnerCode.trim(), partnerName: draft.partnerName.trim() };
    setPartners((current) => isNew
      ? [...current, saved]
      : current.map((partner) => partner.partnerCode === selectedCode ? saved : partner));
    setSelectedCode(saved.partnerCode);
    setDraft(saved);
    setIsNew(false);
    notifications.show({ title: '화면 시안', message: '입력 내용은 현재 화면에서만 반영됩니다.', color: 'teal' });
  };

  const deletePartner = () => {
    if (!selectedCode || isNew) return;
    const remaining = partners.filter((partner) => partner.partnerCode !== selectedCode);
    setPartners(remaining);
    if (remaining.length) selectPartner(remaining[0]);
    else startNewPartner();
  };

  const resetDraft = () => {
    if (isNew) {
      setDraft(emptyPartner());
      return;
    }
    const selected = partners.find((partner) => partner.partnerCode === selectedCode);
    if (selected) selectPartner(selected);
    else startNewPartner();
  };

  return (
    <Box className={classes.page}>
      <Paper className={dashboardClasses.dashboardHeader}>
        <Box className={dashboardClasses.headerCopy}>
          <Text className={classes.breadcrumb}>시스템 관리 <span>›</span> 거래처 등록</Text>
          <Title order={1} className={dashboardClasses.pageTitle}>거래처 <span>등록</span></Title>
          <Text className={dashboardClasses.pageSubtitle}>거래처 정보를 조회하고 등록·관리합니다.</Text>
          <Group className={dashboardClasses.sampleNotice} gap={8}>
            <span className={dashboardClasses.statusDot} />
            <Text size="xs">화면 시안</Text>
            <span className={dashboardClasses.noticeDivider} />
            <Text size="xs">FastAPI 연결 전 임시 데이터</Text>
          </Group>
        </Box>
      </Paper>

      <div className={classes.workspace}>
        <Paper className={classes.listPanel} withBorder>
          <Group className={classes.panelHeader} justify="space-between" wrap="wrap">
            <Group gap="xs">
              <Text fw={700}>거래처 등록 목록</Text>
              <Badge color="red" variant="light">{filteredPartners.length}건</Badge>
            </Group>
            <Group gap={6} wrap="wrap">
              <Select
                aria-label="사용 여부 필터"
                value={statusFilter}
                onChange={setStatusFilter}
                data={['전체', '사용중', '사용중지']}
                w={116}
                size="xs"
              />
              <Button variant="default" size="xs" leftSection={<IconDownload size={14} />}>엑셀다운</Button>
            </Group>
          </Group>

          <Group className={classes.listToolbar} gap={6} wrap="nowrap">
            <TextInput
              className={classes.searchInput}
              placeholder="코드 또는 상호명 통합 검색..."
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              onKeyDown={(event) => event.key === 'Enter' && setAppliedQuery(query)}
              leftSection={<IconSearch size={15} />}
              size="xs"
            />
            <Button size="xs" leftSection={<IconSearch size={14} />} onClick={() => setAppliedQuery(query)}>조회</Button>
            <Button size="xs" color="red" leftSection={<IconPlus size={14} />} onClick={startNewPartner}>신규등록</Button>
          </Group>

          <Box className={classes.tableWrap}>
            <Table className={classes.partnerTable} highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={34}></Table.Th>
                  <Table.Th>코드</Table.Th>
                  <Table.Th>거래처명 (상호)</Table.Th>
                  <Table.Th>사업자번호</Table.Th>
                  <Table.Th>대표자</Table.Th>
                  <Table.Th>상태</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {filteredPartners.length ? filteredPartners.map((partner) => (
                  <Table.Tr
                    key={partner.partnerCode}
                    className={partner.partnerCode === selectedCode ? classes.selectedRow : ''}
                    onClick={() => selectPartner(partner)}
                  >
                    <Table.Td><span className={`${classes.radio} ${partner.partnerCode === selectedCode ? classes.radioSelected : ''}`} /></Table.Td>
                    <Table.Td className={classes.codeCell}>{partner.partnerCode}</Table.Td>
                    <Table.Td className={classes.partnerNameCell}>{partner.partnerName}</Table.Td>
                    <Table.Td>{partner.businessNumber || '-'}</Table.Td>
                    <Table.Td>{partner.representative || '-'}</Table.Td>
                    <Table.Td><Badge color={partner.active === '사용중' ? 'teal' : 'gray'} variant="light">{partner.active}</Badge></Table.Td>
                  </Table.Tr>
                )) : (
                  <Table.Tr><Table.Td colSpan={6} className={classes.emptyState}>검색 결과가 없습니다.</Table.Td></Table.Tr>
                )}
              </Table.Tbody>
            </Table>
          </Box>
          <Group className={classes.listFooter} justify="space-between">
            <Text size="xs" c="dimmed">총 {filteredPartners.length}개 항목</Text>
            <Text size="xs" c="dimmed">현재 화면 임시 데이터</Text>
          </Group>
        </Paper>

        <Paper className={classes.formPanel} withBorder>
          <Group className={classes.panelHeader} justify="space-between">
            <Group gap="xs"><span className={classes.statusDot} /><Text fw={700}>상세 정보 입력 및 수정</Text></Group>
            <Badge color={isNew ? 'teal' : 'blue'} variant="light">{isNew ? '신규 등록' : '조회 모드'}</Badge>
          </Group>
          <Box className={classes.formBody}>
            <Stack gap="sm">
              <TextInput label="거래처 코드" value={draft.partnerCode} onChange={updateDraft('partnerCode')} required />
              <TextInput label="거래처명 (상호)" value={draft.partnerName} onChange={updateDraft('partnerName')} required />
              <TextInput label="사업자등록번호" value={draft.businessNumber} onChange={updateDraft('businessNumber')} />
              <TextInput label="대표자 성명" value={draft.representative} onChange={updateDraft('representative')} />
              <Select label="거래구분" value={draft.partnerType} onChange={updateDraft('partnerType')} data={['매입처', '매출처', '매입·매출처']} />
              <TextInput label="대표 연락처" value={draft.phone} onChange={updateDraft('phone')} />
              <TextInput label="사업장 주소" value={draft.address} onChange={updateDraft('address')} />
              <Select label="사용 여부" value={draft.active} onChange={updateDraft('active')} data={['사용중', '사용중지']} />
              <Textarea label="비고 사항" value={draft.note} onChange={updateDraft('note')} minRows={2} autosize maxRows={4} />
            </Stack>
          </Box>
          <Group className={classes.formFooter} justify="space-between">
            <Button variant="default" onClick={deletePartner} disabled={!selectedCode || isNew} leftSection={<IconTrash size={15} />} color="red">삭제</Button>
            <Group gap="xs">
              <Button variant="default" onClick={resetDraft}>초기화</Button>
              <Button color="red" onClick={savePartner} leftSection={<IconDeviceFloppy size={15} />}>저장 및 적용</Button>
            </Group>
          </Group>
        </Paper>
      </div>
    </Box>
  );
}
