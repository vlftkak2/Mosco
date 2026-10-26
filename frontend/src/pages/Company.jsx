import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import {
  Badge,
  Box,
  Button,
  Group,
  Modal,
  NumberInput,
  Pagination,
  Paper,
  ScrollArea,
  Select,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconSearch, IconUsers } from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import useErpPageRibbon from '../components/common/useErpPageRibbon';
import sharedClasses from '../styles/pages/ManagementShared.module.css';
import classes from '../styles/pages/Company.module.css';

const PAGE_SIZE = 30;
let postcodeScriptPromise;
const COMPANY_COLUMNS = [
  { key: 'companyid', label: '고객사코드', width: '13%' },
  { key: 'companyname', label: '고객사명', width: '19%' },
  { key: 'plan_code', label: '서비스유형', width: '12%' },
  { key: 'company_status', label: '이용상태', width: '12%' },
  { key: 'licensed_seats', label: '허용계정', width: '10%' },
  { key: 'createdat', label: '등록일자', width: '17%' },
  { key: 'updatedat', label: '수정일자', width: '17%' },
];
const PLAN_OPTIONS = [
  { value: 'BASIC', label: '기본형' },
  { value: 'EXTENDED', label: '확장형' },
];
const STATUS_OPTIONS = [
  { value: 'PENDING', label: '승인대기' },
  { value: 'ACTIVE', label: '이용중' },
  { value: 'SUSPENDED', label: '이용정지' },
  { value: 'CLOSED', label: '종료' },
];
const STATUS_LABEL = Object.fromEntries(STATUS_OPTIONS.map((item) => [item.value, item.label]));
const PLAN_LABEL = Object.fromEntries(PLAN_OPTIONS.map((item) => [item.value, item.label]));

const authConfig = () => ({
  headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` },
});

const loadPostcodeService = () => {
  if (window.daum?.Postcode) return Promise.resolve();
  if (!postcodeScriptPromise) {
    postcodeScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
      script.onload = resolve;
      script.onerror = () => {
        postcodeScriptPromise = null;
        reject(new Error('주소 검색 서비스를 불러오지 못했습니다.'));
      };
      document.head.appendChild(script);
    });
  }
  return postcodeScriptPromise;
};

const emptyCompany = () => ({
  companyid: '',
  companyname: '',
  businessno: '',
  ceoname: '',
  phone: '',
  email: '',
  zipcode: '',
  address1: '',
  address2: '',
  plan_code: 'BASIC',
  company_status: 'PENDING',
  licensed_seats: 0,
  active_users: 0,
  total_users: 0,
});

const normalizeCompany = (row = {}) => ({
  ...emptyCompany(),
  ...row,
  companyid: String(row.companyid ?? ''),
  companyname: String(row.companyname ?? ''),
  businessno: String(row.businessno ?? ''),
  ceoname: String(row.ceoname ?? ''),
  phone: String(row.phone ?? ''),
  email: String(row.email ?? ''),
  zipcode: String(row.zipcode ?? ''),
  address1: String(row.address1 ?? ''),
  address2: String(row.address2 ?? ''),
  licensed_seats: Number(row.licensed_seats || 0),
  active_users: Number(row.active_users || 0),
  total_users: Number(row.total_users || 0),
});

const formatDateTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

const formatDate = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const pad = (part) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const errorMessage = (error, fallback) => {
  const detail = error.response?.data?.detail;
  if (Array.isArray(detail)) return detail.map((item) => item.msg).join(', ');
  return detail || error.message || fallback;
};

export default function Company() {
  const navigate = useNavigate();
  const [companies, setCompanies] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState(emptyCompany());
  const [isNew, setIsNew] = useState(false);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [planFilter, setPlanFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addressOpen, setAddressOpen] = useState(false);
  const postcodeContainerRef = useRef(null);
  const selectedIdRef = useRef(selectedId);
  const isNewRef = useRef(isNew);

  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  useEffect(() => { isNewRef.current = isNew; }, [isNew]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const loadCompanies = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get('/api/companies', {
        ...authConfig(),
        params: {
          q: search || undefined,
          plan_code: planFilter || undefined,
          company_status: statusFilter || undefined,
          page,
          page_size: PAGE_SIZE,
        },
      });
      const rows = (data.items || []).map(normalizeCompany);
      setCompanies(rows);
      setTotal(Number(data.total || 0));
      if (!isNewRef.current) {
        const selected = rows.find((item) => item.companyid === selectedIdRef.current) || rows[0];
        setSelectedId(selected?.companyid || '');
        setDraft(selected || emptyCompany());
        if (!selected) {
          isNewRef.current = true;
          setIsNew(true);
        }
      }
    } catch (error) {
      setCompanies([]);
      notifications.show({
        title: '조회 실패',
        message: errorMessage(error, '고객사 목록을 불러오지 못했습니다.'),
        color: 'red',
      });
    } finally {
      setLoading(false);
    }
  }, [page, planFilter, search, statusFilter]);

  useEffect(() => { void loadCompanies(); }, [loadCompanies]);

  const handleSearch = useCallback(() => {
    const nextSearch = query.trim();
    setPage(1);
    if (page === 1 && search === nextSearch) {
      void loadCompanies();
      return;
    }
    setSearch(nextSearch);
  }, [loadCompanies, page, query, search]);

  const handleAdd = useCallback(() => {
    selectedIdRef.current = '';
    isNewRef.current = true;
    setSelectedId('');
    setDraft(emptyCompany());
    setIsNew(true);
  }, []);

  const handleSelect = useCallback((company) => {
    selectedIdRef.current = company.companyid;
    isNewRef.current = false;
    setSelectedId(company.companyid);
    setDraft(company);
    setIsNew(false);
  }, []);

  const updateDraft = useCallback((field, value) => {
    setDraft((current) => ({ ...current, [field]: value }));
  }, []);

  const embedPostcode = useCallback(() => {
    if (!addressOpen) return;
    loadPostcodeService()
      .then(() => {
        const container = postcodeContainerRef.current;
        if (!addressOpen || !container || !window.daum?.Postcode) return;
        container.replaceChildren();
        new window.daum.Postcode({
          width: '100%',
          height: '100%',
          oncomplete: (data) => {
            updateDraft('zipcode', data.zonecode || '');
            updateDraft('address1', data.roadAddress || data.jibunAddress || '');
            setAddressOpen(false);
          },
        }).embed(container);
      })
      .catch((error) => {
        notifications.show({
          title: '주소 검색 실패',
          message: error.message || '주소 검색 서비스를 불러오지 못했습니다.',
          color: 'red',
        });
        setAddressOpen(false);
      });
  }, [addressOpen, updateDraft]);

  const handleSave = useCallback(async () => {
    const creating = isNew || !selectedId;
    if (!String(draft.companyid ?? '').trim() || !String(draft.companyname ?? '').trim()) {
      notifications.show({ title: '필수값 확인', message: '고객사 코드와 고객사명을 입력해 주세요.', color: 'red' });
      return;
    }
    if (draft.licensed_seats < draft.active_users) {
      notifications.show({
        title: '허용 계정 수 확인',
        message: `현재 활성 계정 ${draft.active_users}명보다 작게 설정할 수 없습니다.`,
        color: 'red',
      });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        companyid: String(draft.companyid ?? '').trim(),
        companyname: String(draft.companyname ?? '').trim(),
        businessno: String(draft.businessno ?? '').trim(),
        ceoname: String(draft.ceoname ?? '').trim(),
        phone: String(draft.phone ?? '').trim(),
        email: String(draft.email ?? '').trim(),
        zipcode: String(draft.zipcode ?? '').trim(),
        address1: String(draft.address1 ?? '').trim(),
        address2: String(draft.address2 ?? '').trim(),
        plan_code: draft.plan_code,
        company_status: draft.company_status,
        licensed_seats: Number(draft.licensed_seats || 0),
      };
      const request = creating
        ? axios.post('/api/companies', payload, authConfig())
        : axios.put(`/api/companies/${encodeURIComponent(selectedId)}`, payload, authConfig());
      const { data } = await request;
      selectedIdRef.current = data.item.companyid;
      isNewRef.current = false;
      setSelectedId(data.item.companyid);
      setDraft(normalizeCompany({ ...draft, ...data.item }));
      setIsNew(false);
      notifications.show({ title: creating ? '등록 완료' : '수정 완료', message: '고객사 정보를 저장했습니다.', color: 'teal' });
      await loadCompanies();
    } catch (error) {
      const message = errorMessage(error, '고객사 정보를 저장하지 못했습니다.');
      const isDuplicateCompanyCode = error.response?.status === 409
        && message.includes('이미 등록된 고객사 코드');
      notifications.show({
        title: isDuplicateCompanyCode ? '고객사 코드 중복' : '저장 실패',
        message: isDuplicateCompanyCode ? '이미 등록된 고객사 코드입니다. 다른 코드를 입력해 주세요.' : message,
        color: 'red',
      });
    } finally {
      setSaving(false);
    }
  }, [draft, isNew, loadCompanies, selectedId]);

  useErpPageRibbon({
    onSearch: handleSearch,
    onAdd: handleAdd,
    onSave: saving ? undefined : handleSave,
    showPrint: false,
    showExcel: false,
    useSaveColor: false,
  });

  const usageText = useMemo(
    () => `${draft.active_users || 0} / ${draft.licensed_seats || 0}명`,
    [draft.active_users, draft.licensed_seats],
  );

  return (
    <Box className={`${sharedClasses.pageShell} ${classes.page}`}>
      <Box component="nav" className={classes.breadcrumb}>
        <Text component="span" className={classes.breadcrumbParent}>시스템관리</Text>
        <Text component="span" className={classes.breadcrumbChevron}>›</Text>
        <Text component="span" className={classes.breadcrumbCurrent}>고객사등록</Text>
      </Box>

      <div className={classes.workspace}>
        <Paper className={classes.listPanel} withBorder>
          <Group className={classes.panelHeader} justify="space-between">
            <Group gap={7}>
              <Text className={classes.sectionTitle} fw={700}>고객사 목록</Text>
              <Badge variant="light" color="gray">{total}건</Badge>
            </Group>
          </Group>
          <Group className={classes.searchBar} gap={7} wrap="nowrap">
            <TextInput
              className={classes.searchInput}
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') handleSearch(); }}
              placeholder="고객사 코드, 고객사명, 사업자번호"
              leftSection={<IconSearch size={15} />}
            />
            <Select clearable w={112} placeholder="요금제" data={PLAN_OPTIONS} value={planFilter} onChange={(value) => { setPlanFilter(value || ''); setPage(1); }} />
            <Select clearable w={112} placeholder="상태" data={STATUS_OPTIONS} value={statusFilter} onChange={(value) => { setStatusFilter(value || ''); setPage(1); }} />
            <Button color="red" onClick={handleSearch} loading={loading}>조회</Button>
          </Group>
          <ScrollArea className={classes.tableWrap} type="auto">
            <Table className={`${sharedClasses.table} ${classes.table}`} highlightOnHover>
              <colgroup>
                {COMPANY_COLUMNS.map(({ key, width }) => <col key={key} style={{ width }} />)}
              </colgroup>
              <Table.Thead>
                <Table.Tr>
                  {COMPANY_COLUMNS.map(({ key, label }) => <Table.Th key={key}>{label}</Table.Th>)}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {companies.length ? companies.map((company) => (
                  <Table.Tr key={company.companyid} className={`${classes.clickableRow} ${selectedId === company.companyid ? classes.selectedRow : ''}`} onClick={() => handleSelect(company)}>
                    <Table.Td>{company.companyid}</Table.Td>
                    <Table.Td title={company.companyname}>{company.companyname}</Table.Td>
                    <Table.Td>{PLAN_LABEL[company.plan_code] || company.plan_code}</Table.Td>
                    <Table.Td><Badge size="sm" variant="light" color={company.company_status === 'ACTIVE' ? 'teal' : company.company_status === 'SUSPENDED' ? 'orange' : 'gray'}>{STATUS_LABEL[company.company_status] || company.company_status}</Badge></Table.Td>
                    <Table.Td>{company.licensed_seats}</Table.Td>
                    <Table.Td>{formatDate(company.createdat)}</Table.Td>
                    <Table.Td>{formatDate(company.updatedat)}</Table.Td>
                  </Table.Tr>
                )) : (
                  <Table.Tr><Table.Td colSpan={7} className={classes.empty}>{loading ? '조회 중...' : '등록된 고객사가 없습니다.'}</Table.Td></Table.Tr>
                )}
              </Table.Tbody>
            </Table>
          </ScrollArea>
          <Group className={sharedClasses.footer} justify="space-between">
            <Text size="xs" c="dimmed">총 {total}건</Text>
            <Pagination size="xs" value={page} total={pageCount} onChange={setPage} />
          </Group>
        </Paper>

        <Paper className={classes.formPanel} withBorder>
          <Group className={classes.panelHeader} justify="space-between">
            <Text className={classes.sectionTitle} fw={700}>고객사 정보</Text>
            <Group gap={8} wrap="nowrap">
              {!isNew && selectedId && (
                <Button
                  size="xs"
                  variant="light"
                  color="red"
                  leftSection={<IconUsers size={14} />}
                  onClick={() => navigate('/User', { state: { companyid: selectedId } })}
                >
                  계정 관리
                </Button>
              )}
              <Badge variant="light" color={isNew ? 'red' : 'gray'}>{isNew ? '신규' : '상세'}</Badge>
            </Group>
          </Group>
          <ScrollArea className={classes.formBody} type="auto">
            <div className={classes.formGrid}>
              <TextInput label="고객사 코드 *" value={draft.companyid} onChange={(event) => updateDraft('companyid', event.currentTarget.value)} disabled={!isNew} maxLength={50} />
              <TextInput label="고객사명 *" value={draft.companyname} onChange={(event) => updateDraft('companyname', event.currentTarget.value)} maxLength={100} />
              <TextInput label="사업자번호" value={draft.businessno} onChange={(event) => updateDraft('businessno', event.currentTarget.value)} maxLength={20} />
              <TextInput label="대표자명" value={draft.ceoname} onChange={(event) => updateDraft('ceoname', event.currentTarget.value)} maxLength={100} />
              <TextInput label="전화번호" value={draft.phone} onChange={(event) => updateDraft('phone', event.currentTarget.value)} maxLength={30} />
              <TextInput label="이메일" value={draft.email} onChange={(event) => updateDraft('email', event.currentTarget.value)} maxLength={255} />
              <Select label="서비스 유형 *" data={PLAN_OPTIONS} value={draft.plan_code} onChange={(value) => updateDraft('plan_code', value || 'BASIC')} allowDeselect={false} />
              <Select label="이용 상태 *" data={STATUS_OPTIONS} value={draft.company_status} onChange={(value) => updateDraft('company_status', value || 'PENDING')} allowDeselect={false} />
              <NumberInput label="허용 계정 수 *" min={0} allowDecimal={false} value={draft.licensed_seats} onChange={(value) => updateDraft('licensed_seats', Number(value || 0))} />
              <TextInput label="현재 활성 계정" value={usageText} readOnly disabled />
              <Group className={classes.addressField} align="flex-end" gap="xs" wrap="nowrap">
                <TextInput
                  label="우편번호"
                  value={draft.zipcode}
                  placeholder="자동 입력"
                  inputMode="numeric"
                  maxLength={5}
                  onChange={(event) => updateDraft('zipcode', event.currentTarget.value)}
                  style={{ flex: '0 0 120px' }}
                />
                <TextInput
                  label="기본주소"
                  value={draft.address1}
                  onChange={(event) => updateDraft('address1', event.currentTarget.value)}
                  style={{ flex: 1 }}
                />
                <Button variant="light" onClick={() => setAddressOpen(true)}>주소 검색</Button>
              </Group>
              <TextInput className={classes.fullWidth} label="상세주소" value={draft.address2} onChange={(event) => updateDraft('address2', event.currentTarget.value)} maxLength={300} />
              <TextInput label="등록일시" value={formatDateTime(draft.createdat)} readOnly disabled />
              <TextInput label="수정일시" value={formatDateTime(draft.updatedat)} readOnly disabled />
            </div>
          </ScrollArea>
        </Paper>
      </div>

      <Modal
        opened={addressOpen}
        onClose={() => setAddressOpen(false)}
        onEnterTransitionEnd={embedPostcode}
        title="주소 검색"
        centered
        size="lg"
      >
        <Box ref={postcodeContainerRef} h={520} w="100%" />
      </Modal>

    </Box>
  );
}
