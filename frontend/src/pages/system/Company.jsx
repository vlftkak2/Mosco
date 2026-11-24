import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { apiErrorMessage } from '../../utils/apiError';
import usePageReactivated from '../../components/common/usePageReactivated';
import {
  Badge,
  Box,
  Button,
  Group,
  Modal,
  NumberInput,
  Pagination,
  Paper,
  Progress,
  ScrollArea,
  Select,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconBuildingSkyscraper,
  IconId,
  IconInbox,
  IconMapPin,
  IconSearch,
  IconSettings,
  IconUsers,
} from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import useErpPageRibbon from '../../components/common/useErpPageRibbon';
import ErpDateInput from '../../components/common/ErpDateInput';
import ConfirmDeleteModal from '../../components/common/ConfirmDeleteModal';
import sharedClasses from '../../styles/pages/ManagementShared.module.css';
import { ColumnResizeHandle, pickerClasses, useResizableColumns } from '../../components/common/PickerModal';
import simpleTheme from '../../styles/pages/SimpleTheme.module.css';
import classes from '../../styles/pages/Company.module.css';
import { cachedDateFormat } from '../../utils/dateFormat';

const PAGE_SIZE_OPTIONS = [15, 20, 50, 100].map((value) => ({ value: String(value), label: `${value}개씩` }));
const DEFAULT_PAGE_SIZE = 15;
let postcodeScriptPromise;
const COMPANY_COLUMNS = [
  { key: 'companyid', label: '고객사코드', width: 90 },
  { key: 'companyname', label: '고객사명', width: 150 },
  { key: 'plan_code', label: '서비스유형', width: 90 },
  { key: 'company_status', label: '이용상태', width: 90 },
  { key: 'licensed_seats', label: '라이선스', width: 80 },
  { key: 'license_fee', label: '월 라이선스', width: 100 },
  { key: 'createdat', label: '등록일자', width: 150 },
  { key: 'created_by', label: '등록자', width: 80 },
  { key: 'updatedat', label: '수정일자', width: 150 },
  { key: 'updated_by', label: '수정자', width: 80 },
];
// 서비스 유형: 지금은 기본형만 판매 (확장형은 이름표만 남겨 이미 확장형인 고객사가 그대로 보이게)
const PLAN_LABELS = [
  { value: 'BASIC', label: '기본형' },
  { value: 'EXTENDED', label: '확장형' },
];
const PLAN_OPTIONS = PLAN_LABELS.filter((item) => item.value === 'BASIC');
const STATUS_OPTIONS = [
  { value: 'PENDING', label: '승인대기' },
  { value: 'ACTIVE', label: '이용중' },
  { value: 'SUSPENDED', label: '이용정지' },
  { value: 'CLOSED', label: '종료' },
];
const STOCK_OPEN_OPTIONS = [{ value: 'N', label: '비공개' }, { value: 'Y', label: '공개' }];
const APPROVAL_OPTIONS = [{ value: 'N', label: '미허용' }, { value: 'Y', label: '허용' }];
const PLAN_FILTER_OPTIONS = [{ value: 'ALL', label: '전체' }, ...PLAN_OPTIONS];
const STATUS_FILTER_OPTIONS = [{ value: 'ALL', label: '전체' }, ...STATUS_OPTIONS];
const STATUS_LABEL = Object.fromEntries(STATUS_OPTIONS.map((item) => [item.value, item.label]));
const PLAN_LABEL = Object.fromEntries(PLAN_LABELS.map((item) => [item.value, item.label]));
const PLAN_COLOR = { BASIC: 'gray', EXTENDED: 'violet' };

const authConfig = () => ({
  headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` },
});

const loadPostcodeService = () => {
  if (window.daum?.Postcode) return Promise.resolve();
  if (!postcodeScriptPromise) {
    postcodeScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
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
  corporationno: '',
  ceoname: '',
  phone: '',
  zipcode: '',
  address1: '',
  address2: '',
  plan_code: 'BASIC',
  company_status: 'PENDING',
  licensed_seats: 0,
  license_start: '',
  license_end: '',
  stock_open_yn: 'N',
  stock_open_date: '',
  approval_yn: 'N',
  license_unit_price: 0,
  active_users: 0,
  total_users: 0,
});

const normalizeCompany = (row = {}) => ({
  ...emptyCompany(),
  ...row,
  companyid: String(row.companyid ?? ''),
  companyname: String(row.companyname ?? ''),
  businessno: String(row.businessno ?? ''),
  corporationno: String(row.corporationno ?? ''),
  ceoname: String(row.ceoname ?? ''),
  phone: String(row.phone ?? ''),
  zipcode: String(row.zipcode ?? ''),
  address1: String(row.address1 ?? ''),
  address2: String(row.address2 ?? ''),
  licensed_seats: Number(row.licensed_seats || 0),
  license_fee: Number(row.license_fee || 0),
  license_unit_price: Number(row.license_unit_price || 0),
  license_start: String(row.license_start ?? '').slice(0, 10),
  license_end: String(row.license_end ?? '').slice(0, 10),
  stock_open_yn: row.stock_open_yn === 'Y' ? 'Y' : 'N',
  stock_open_date: String(row.stock_open_date ?? '').slice(0, 10),
  approval_yn: row.approval_yn === 'Y' ? 'Y' : 'N',
  active_users: Number(row.active_users || 0),
  total_users: Number(row.total_users || 0),
});

const formatDateTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return cachedDateFormat('ko-KR', {
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
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
// 목록 등록일자 · 수정일자: YYYY-MM-DD HH:mm (시간까지)
const formatListDateTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const pad = (part) => String(part).padStart(2, '0');
  return `${formatDate(value)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const errorMessage = (error, fallback) => apiErrorMessage(error, fallback);

export default function Company() {
  const companyCols = useResizableColumns(COMPANY_COLUMNS); // 목록 열: 머리글 오른쪽 끝을 끌어 너비 조절
  const navigate = useNavigate();
  const [companies, setCompanies] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState(emptyCompany());
  const [isNew, setIsNew] = useState(false);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [planFilter, setPlanFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [appliedPlanFilter, setAppliedPlanFilter] = useState('ALL');
  const [appliedStatusFilter, setAppliedStatusFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [addressOpen, setAddressOpen] = useState(false);
  const postcodeContainerRef = useRef(null);
  const selectedIdRef = useRef(selectedId);
  const isNewRef = useRef(isNew);

  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  useEffect(() => { isNewRef.current = isNew; }, [isNew]);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const loadCompanies = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get('/api/companies', {
        ...authConfig(),
        params: {
          q: search || undefined,
          plan_code: appliedPlanFilter === 'ALL' ? undefined : appliedPlanFilter,
          company_status: appliedStatusFilter === 'ALL' ? undefined : appliedStatusFilter,
          page,
          page_size: pageSize,
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
  }, [appliedPlanFilter, appliedStatusFilter, page, pageSize, search]);

  // 탭에 돌아오면 지금 조건 그대로 다시 불러온다 (다른 탭에서 데이터가 바뀌었을 수 있음)
  usePageReactivated(() => { void loadCompanies(); });
  useEffect(() => { void loadCompanies(); }, [loadCompanies]);

  const handleSearch = useCallback(() => {
    const nextSearch = query.trim();
    const filtersUnchanged = appliedPlanFilter === planFilter && appliedStatusFilter === statusFilter;
    setPage(1);
    setAppliedPlanFilter(planFilter);
    setAppliedStatusFilter(statusFilter);
    if (page === 1 && search === nextSearch && filtersUnchanged) {
      void loadCompanies();
      return;
    }
    setSearch(nextSearch);
  }, [appliedPlanFilter, appliedStatusFilter, loadCompanies, page, planFilter, query, search, statusFilter]);

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

  // 재고 공개: 공개로 바꾸면 동의일을 오늘(KST)로 채우고(고칠 수 있음), 비공개면 동의일을 비운다
  const changeStockOpen = useCallback((value) => {
    const next = value === 'Y' ? 'Y' : 'N';
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
    setDraft((current) => ({ ...current, stock_open_yn: next, stock_open_date: next === 'Y' ? (current.stock_open_date || today) : '' }));
  }, []);

  // 이용 상태: 이용정지 · 종료로 바꾸면 과금 종료일 = 오늘(KST), 이용중 · 승인대기로 바꾸면 과금 종료일을 비운다
  const changeStatus = useCallback((value) => {
    const next = value || 'PENDING';
    setDraft((current) => {
      if (next === current.company_status) return current;
      const stopped = (status) => status === 'SUSPENDED' || status === 'CLOSED';
      const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
      if (stopped(next)) return { ...current, company_status: next, license_end: stopped(current.company_status) && current.license_end ? current.license_end : today };
      return { ...current, company_status: next, license_end: '' };
    });
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
    if (Number(draft.licensed_seats || 0) * Number(draft.license_unit_price || 0) > 0 && !draft.license_start) {
      notifications.show({ title: '과금 시작일 확인', message: '라이선스 비용을 넣으면 과금 시작일도 입력해 주세요.', color: 'red' });
      return;
    }
    if (draft.license_start && draft.license_end && draft.license_end < draft.license_start) {
      notifications.show({ title: '과금 기간 확인', message: '과금 종료일은 과금 시작일보다 앞설 수 없습니다.', color: 'red' });
      return;
    }
    if (draft.licensed_seats < draft.active_users) {
      notifications.show({
        title: '라이선스 개수 확인',
        message: `라이선스 개수는 현재 활성 계정 ${draft.active_users}명보다 작게 설정할 수 없습니다.`,
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
        corporationno: String(draft.corporationno ?? '').trim(),
        ceoname: String(draft.ceoname ?? '').trim(),
        phone: String(draft.phone ?? '').trim(),
        zipcode: String(draft.zipcode ?? '').trim(),
        address1: String(draft.address1 ?? '').trim(),
        address2: String(draft.address2 ?? '').trim(),
        plan_code: draft.plan_code,
        company_status: draft.company_status,
        licensed_seats: Number(draft.licensed_seats || 0),
        license_start: draft.license_start || null,
        license_end: draft.license_end || null,
        stock_open_yn: draft.stock_open_yn === 'Y' ? 'Y' : 'N',
        stock_open_date: draft.stock_open_yn === 'Y' ? (draft.stock_open_date || null) : null,
        approval_yn: draft.approval_yn === 'Y' ? 'Y' : 'N',
        license_unit_price: Number(draft.license_unit_price || 0),
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

  // 삭제: 플랫폼 운영사(001)는 지울 수 없다. 업무 자료가 있는 고객사는 서버가 막고 '종료'를 안내한다.
  const canDelete = !isNew && Boolean(selectedId) && selectedId !== '001' && !deleting;
  const handleDelete = useCallback(async () => {
    setDeleting(true);
    try {
      await axios.delete(`/api/companies/${encodeURIComponent(selectedId)}`, authConfig());
      notifications.show({ title: '삭제 완료', message: `${draft.companyname || selectedId} 고객사를 삭제했습니다.`, color: 'teal' });
      setDeleteOpen(false);
      selectedIdRef.current = '';
      setSelectedId('');
      await loadCompanies();
    } catch (error) {
      setDeleteOpen(false);
      notifications.show({ title: '삭제 실패', message: errorMessage(error, '고객사를 삭제하지 못했습니다.'), color: 'red', autoClose: 7000 });
    } finally {
      setDeleting(false);
    }
  }, [draft.companyname, loadCompanies, selectedId]);

  useErpPageRibbon({
    onSearch: handleSearch,
    onAdd: handleAdd,
    onSave: saving ? undefined : handleSave,
    onDelete: canDelete ? () => setDeleteOpen(true) : undefined,
    showPrint: false,
    showExcel: false,
    useSaveColor: false,
  });

  const usageText = useMemo(
    () => `${Number(draft.active_users || 0).toLocaleString('ko-KR')} / ${Number(draft.licensed_seats || 0).toLocaleString('ko-KR')}명`,
    [draft.active_users, draft.licensed_seats],
  );

  const usagePercent = useMemo(() => {
    const seats = Number(draft.licensed_seats || 0);
    if (seats <= 0) return 0;
    return Math.min(100, Math.round((Number(draft.active_users || 0) / seats) * 100));
  }, [draft.active_users, draft.licensed_seats]);

  return (
    <Box className={`${simpleTheme.simple} ${simpleTheme.noIcons} ${sharedClasses.pageShell} ${classes.page}`}>
      <Box component="nav" className={classes.breadcrumb}>
        <Text component="span" className={classes.breadcrumbParent}>어드민</Text>
        <Text component="span" className={classes.breadcrumbChevron}>›</Text>
        <Text component="span" className={classes.breadcrumbCurrent}>고객사등록</Text>
      </Box>

      <div className={classes.workspace}>
        <Paper className={classes.listPanel} withBorder>
          <Group className={classes.panelHeader} justify="space-between" wrap="wrap">
            <Group gap={8} wrap="nowrap">
              <span className={classes.titleIcon}><IconBuildingSkyscraper size={15} /></span>
              <Text className={classes.sectionTitle} fw={700}>고객사 목록</Text>
              <Badge className={classes.countBadge} variant="light" color="gray" radius="sm">{total.toLocaleString('ko-KR')}건</Badge>
            </Group>
          </Group>
          <Group className={classes.searchBar} gap={8} align="flex-end" wrap="nowrap">
            <TextInput
              className={classes.searchInput}
              label="검색어"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') handleSearch(); }}
              placeholder="고객사 코드, 고객사명, 사업자번호"
              leftSection={<IconSearch size={15} />}
            />
            <Select
              className={classes.compactSelect}
              w={100}
              label="요금제"
              aria-label="요금제 필터"
              data={PLAN_FILTER_OPTIONS}
              value={planFilter}
              onChange={(value) => {
                const nextValue = value || 'ALL';
                setPlanFilter(nextValue);
                setAppliedPlanFilter(nextValue);
                setSearch(query.trim());
                setPage(1);
              }}
              allowDeselect={false}
              comboboxProps={{ width: 'max-content', position: 'bottom-start' }}
            />
            <Select
              className={classes.compactSelect}
              w={108}
              label="이용상태"
              aria-label="이용상태 필터"
              data={STATUS_FILTER_OPTIONS}
              value={statusFilter}
              onChange={(value) => {
                const nextValue = value || 'ALL';
                setStatusFilter(nextValue);
                setAppliedStatusFilter(nextValue);
                setSearch(query.trim());
                setPage(1);
              }}
              allowDeselect={false}
              comboboxProps={{ width: 'max-content', position: 'bottom-start' }}
            />
          </Group>
          <ScrollArea className={classes.tableWrap} type="auto">
            <Table className={`${sharedClasses.table} ${classes.table}`} highlightOnHover style={{ width: `max(100%, ${companyCols.tableWidth}px)` }}>
              <colgroup>
                {COMPANY_COLUMNS.map((column) => <col key={column.key} data-column-key={column.key} style={{ width: companyCols.widthOf(column) }} />)}
              </colgroup>
              <Table.Thead>
                <Table.Tr>
                  {COMPANY_COLUMNS.map((column) => <Table.Th key={column.key} className={pickerClasses.resizableHead}>{column.label}<ColumnResizeHandle column={column} columns={companyCols} /></Table.Th>)}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {companies.length ? companies.map((company) => (
                  <Table.Tr key={company.companyid} className={`${classes.clickableRow} ${selectedId === company.companyid ? classes.selectedRow : ''}`} onClick={() => handleSelect(company)}>
                    <Table.Td className={classes.codeCell} title={company.companyid}>{company.companyid}</Table.Td>
                    <Table.Td title={company.companyname}>{company.companyname}</Table.Td>
                    <Table.Td>
                      <Badge size="sm" variant="light" radius="sm" color={PLAN_COLOR[company.plan_code] || 'gray'}>{PLAN_LABEL[company.plan_code] || company.plan_code}</Badge>
                    </Table.Td>
                    <Table.Td><Badge size="sm" variant="light" color={company.company_status === 'ACTIVE' ? 'teal' : company.company_status === 'SUSPENDED' ? 'orange' : 'gray'}>{STATUS_LABEL[company.company_status] || company.company_status}</Badge></Table.Td>
                    <Table.Td>{Number(company.licensed_seats || 0).toLocaleString('ko-KR')}</Table.Td>
                    <Table.Td className={classes.numCell}>{company.license_fee ? Number(company.license_fee).toLocaleString('ko-KR') : '-'}</Table.Td>
                    <Table.Td className={classes.mutedCell} title={formatDateTime(company.createdat)}>{formatListDateTime(company.createdat)}</Table.Td>
                    <Table.Td title={company.created_by_name || company.created_by || ''}>{company.created_by_name || company.created_by || ''}</Table.Td>
                    <Table.Td className={classes.mutedCell} title={formatDateTime(company.updatedat)}>{formatListDateTime(company.updatedat)}</Table.Td>
                    <Table.Td title={company.updated_by_name || company.updated_by || ''}>{company.updated_by_name || company.updated_by || ''}</Table.Td>
                  </Table.Tr>
                )) : (
                  <Table.Tr className={classes.emptyRow}>
                    <Table.Td colSpan={COMPANY_COLUMNS.length} className={classes.emptyCell}>
                      <div className={classes.empty}>
                        <span className={classes.emptyIcon}>{loading ? <IconSearch size={20} /> : <IconInbox size={22} />}</span>
                        <strong>{loading ? '조회 중...' : '등록된 고객사가 없습니다.'}</strong>
                        {!loading && <span>검색 조건을 바꾸거나 상단의 추가 버튼으로 새 고객사를 등록해 주세요.</span>}
                      </div>
                    </Table.Td>
                  </Table.Tr>
                )}
              </Table.Tbody>
            </Table>
          </ScrollArea>
          <Group className={classes.paginationBar} justify="space-between" wrap="wrap">
            <Group gap="xs" wrap="nowrap">
              <Text component="span" className={classes.totalText}>총 <b>{total.toLocaleString('ko-KR')}</b>건</Text>
              <Select
                aria-label="페이지당 표시 건수"
                data={PAGE_SIZE_OPTIONS}
                value={String(pageSize)}
                w={96}
                size="xs"
                allowDeselect={false}
                onChange={(value) => {
                  if (!value) return;
                  setPageSize(Number(value));
                  setPage(1);
                }}
              />
            </Group>
            <Pagination size="sm" color="red" withEdges value={Math.min(page, pageCount)} total={pageCount} onChange={setPage} disabled={loading || !total} />
          </Group>
        </Paper>

        <Paper className={classes.formPanel} withBorder>
          <Group className={classes.panelHeader} justify="space-between" wrap="nowrap">
            <Group gap={8} wrap="nowrap">
              <Text className={classes.sectionTitle} fw={700}>고객사 정보</Text>
              <Badge variant="light" radius="sm" color={isNew ? 'red' : 'gray'}>{isNew ? '신규' : '상세'}</Badge>
            </Group>
            {!isNew && selectedId && (
              <Button
                size="xs"
                variant="default"
                className={classes.softButton}
                leftSection={<IconUsers size={14} />}
                onClick={() => navigate('/User', { state: { companyid: selectedId } })}
              >
                계정 관리
              </Button>
            )}
          </Group>
          <ScrollArea className={classes.formBody} type="auto">
            <div className={classes.formSections}>
              <section className={classes.formSection}>
                <div className={classes.formSectionHead}><IconId size={15} />기본 정보</div>
                <div className={classes.formGrid}>
                  <TextInput label="고객사 코드" withAsterisk value={draft.companyid} onChange={(event) => updateDraft('companyid', event.currentTarget.value)} disabled={!isNew} maxLength={50} />
                  <TextInput label="고객사명" withAsterisk value={draft.companyname} onChange={(event) => updateDraft('companyname', event.currentTarget.value)} maxLength={100} />
                  <TextInput label="대표자명" value={draft.ceoname} onChange={(event) => updateDraft('ceoname', event.currentTarget.value)} maxLength={100} />
                  <TextInput label="사업자번호" placeholder="000-00-00000" value={draft.businessno} onChange={(event) => updateDraft('businessno', event.currentTarget.value)} maxLength={20} />
                  {/* 법인번호: 사업장관리의 법인등록번호와 같은 값 (어느 쪽에서 고쳐도 함께 바뀐다) */}
                  <TextInput label="법인번호" placeholder="000000-0000000" value={draft.corporationno} onChange={(event) => updateDraft('corporationno', event.currentTarget.value)} maxLength={20} />
                  <TextInput label="전화번호" value={draft.phone} onChange={(event) => updateDraft('phone', event.currentTarget.value)} maxLength={30} />
                </div>
              </section>

              <section className={`${classes.formSection} ${classes.licenseSection}`}>
                <div className={classes.formSectionHead}><IconSettings size={15} />서비스 이용</div>
                <div className={classes.formGrid}>
                  <div className={classes.compactRow}>
                    <Select className={classes.compactField} label="서비스 유형" withAsterisk data={PLAN_OPTIONS.some((item) => item.value === draft.plan_code) ? PLAN_OPTIONS : [...PLAN_OPTIONS, PLAN_LABELS.find((item) => item.value === draft.plan_code) || { value: draft.plan_code, label: draft.plan_code }]} value={draft.plan_code} onChange={(value) => updateDraft('plan_code', value || 'BASIC')} allowDeselect={false} comboboxProps={{ width: 'max-content', position: 'bottom-start' }} />
                    <Select className={classes.compactField} label="이용 상태" withAsterisk data={STATUS_OPTIONS} value={draft.company_status} onChange={changeStatus} allowDeselect={false} comboboxProps={{ width: 'max-content', position: 'bottom-start' }} />
                    <NumberInput className={classes.compactField} label="라이선스 개수" withAsterisk min={0} allowDecimal={false} thousandSeparator="," suffix="개" value={draft.licensed_seats} onChange={(value) => updateDraft('licensed_seats', Number(value || 0))} />
                  </div>
                  <div className={classes.compactRow}>
                    <ErpDateInput className={classes.compactField} label="과금 시작일" value={draft.license_start}
                      onChange={(event) => updateDraft('license_start', event.currentTarget.value)} />
                    <ErpDateInput className={classes.compactField} label="과금 종료일" value={draft.license_end}
                      onChange={(event) => updateDraft('license_end', event.currentTarget.value)} />
                    <NumberInput className={classes.compactField} label="라이선스 비용" min={0} allowDecimal={false} allowNegative={false} thousandSeparator="," suffix="원"
                      value={draft.license_unit_price} onChange={(value) => updateDraft('license_unit_price', Number(value || 0))} />
                  </div>
                  <div className={classes.compactRow}>
                    <TextInput className={classes.compactField} label="현재 활성 계정" value={usageText} readOnly disabled />
                    <TextInput className={classes.compactField} label="월 청구액" readOnly disabled
                      value={`${(Number(draft.licensed_seats || 0) * Number(draft.license_unit_price || 0)).toLocaleString('ko-KR')}원`} />
                  </div>
                  {/* 재고 공개 (서면 계약으로 동의받은 고객사만 '공개'): 모스코(001)가 타사 재고현황에서 본다. 001 자신은 대상 아님 */}
                  {draft.companyid !== '001' && <div className={classes.compactRow}>
                    <Select className={classes.compactField} label="재고 공개" data={STOCK_OPEN_OPTIONS} value={draft.stock_open_yn} onChange={changeStockOpen}
                      allowDeselect={false} comboboxProps={{ width: 'max-content', position: 'bottom-start' }} />
                    <ErpDateInput className={classes.compactField} label="공개 동의일" value={draft.stock_open_date} disabled={draft.stock_open_yn !== 'Y'}
                      onChange={(event) => updateDraft('stock_open_date', event.currentTarget.value)} />
                  </div>}
                  {/* 승인 통제: 허용하면 이 고객사가 기준정보 › 통제관리에서 등록 · 수정 · 삭제 승인 절차를 설정해 쓴다 */}
                  <div className={classes.compactRow}>
                    <Select className={classes.compactField} label="승인 통제" data={APPROVAL_OPTIONS} value={draft.approval_yn}
                      onChange={(value) => updateDraft('approval_yn', value === 'Y' ? 'Y' : 'N')}
                      allowDeselect={false} comboboxProps={{ width: 'max-content', position: 'bottom-start' }} />
                  </div>
                  <div className={classes.usage}>
                    <span>계정 사용률</span>
                    <Progress className={classes.usageBar} value={usagePercent} size="sm" radius="xl" color={usagePercent >= 100 ? 'red' : usagePercent >= 80 ? 'orange' : 'teal'} />
                    <b>{usagePercent}%</b>
                  </div>
                </div>
              </section>

              <section className={classes.formSection}>
                <div className={classes.formSectionHead}><IconMapPin size={15} />주소</div>
                <div className={classes.formGrid}>
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
                    <Button variant="default" className={`${classes.softButton} ${classes.addressSearchButton}`} onClick={() => setAddressOpen(true)}>주소 검색</Button>
                  </Group>
                  <TextInput className={classes.fullWidth} label="상세주소" value={draft.address2} onChange={(event) => updateDraft('address2', event.currentTarget.value)} maxLength={300} />
                </div>
              </section>

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

      <ConfirmDeleteModal opened={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={handleDelete} loading={deleting}
        title="고객사를 삭제할까요?" target={`${selectedId} ${draft.companyname || ''}`.trim()}
        message="고객사와 소속 계정 · 메뉴권한이 모두 삭제되며" note="업무 자료가 있는 고객사는 삭제되지 않습니다." />
    </Box>
  );
}
