import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { apiErrorMessage } from '../../utils/apiError';
import usePageReactivated from '../../components/common/usePageReactivated';
import {
  Badge,
  Box,
  Button,
  Group,
  Pagination,
  Paper,
  PasswordInput,
  ScrollArea,
  Select,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { modals } from '@mantine/modals';
import { IconRefresh,
  IconBuilding,
  IconInbox,
  IconKey,
  IconLock,
  IconSearch,
  IconUserCircle,
  IconUsersGroup,
} from '@tabler/icons-react';
import { useLocation, useNavigate } from 'react-router-dom';
import useErpPageRibbon from '../../components/common/useErpPageRibbon';
import sharedClasses from '../../styles/pages/ManagementShared.module.css';
import { ColumnResizeHandle, pickerClasses, useResizableColumns } from '../../components/common/PickerModal';
import simpleTheme from '../../styles/pages/SimpleTheme.module.css';
import classes from '../../styles/pages/User.module.css';

const authConfig = () => ({
  headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` },
});

const emptyUser = () => ({ companyid: '', username: '', email: '', authority: 'USER', password: '', useyn: 'Y' });
const COMPANY_STATUS_LABELS = {
  PENDING: '승인대기',
  ACTIVE: '이용중',
  SUSPENDED: '이용정지',
  CLOSED: '종료',
};
const errorMessage = (error, fallback) => apiErrorMessage(error, fallback);

const AUTHORITY_LABELS = {
  MASTER: '플랫폼 관리자',
  SUBMASTER: '고객사 관리자',
  USER: '일반 사용자',
};
const AUTHORITY_COLORS = { MASTER: 'red', SUBMASTER: 'indigo', USER: 'gray' };
const PAGE_SIZE_OPTIONS = [15, 20, 50, 100].map((value) => ({ value: String(value), label: `${value}개씩` }));
const DEFAULT_PAGE_SIZE = 15;

const USER_COLUMNS = [
  { key: 'username', label: '사용자명', width: 120 },
  { key: 'email', label: '이메일', width: 220 },
  { key: 'authority', label: '권한', width: 110 },
  { key: 'useyn', label: '사용여부', width: 90 },
  { key: 'created_by', label: '등록자', width: 90 },
  { key: 'updated_by', label: '수정자', width: 90 },
];

export default function User() {
  const userCols = useResizableColumns(USER_COLUMNS); // 목록 열: 머리글 오른쪽 끝을 끌어 너비 조절
  const location = useLocation();
  const navigate = useNavigate();
  const currentAuthority = String(localStorage.getItem('user_authority') || 'USER').toUpperCase();
  const isPlatformMaster = currentAuthority === 'MASTER';
  const isSubmaster = currentAuthority === 'SUBMASTER';
  const currentEmail = String(localStorage.getItem('user_email') || '').toLowerCase();
  const [companies, setCompanies] = useState([]);
  const [companyid, setCompanyid] = useState(() => (
    isSubmaster ? localStorage.getItem('user_company') || '' : location.state?.companyid || ''
  ));
  const [companyInfo, setCompanyInfo] = useState(null);
  const [companyname, setCompanyname] = useState('');
  const [users, setUsers] = useState([]);
  const [selectedEmail, setSelectedEmail] = useState('');
  const [draft, setDraft] = useState(emptyUser());
  const [isNew, setIsNew] = useState(false);
  const [loadingCompanies, setLoadingCompanies] = useState(false);
  const [companyDropdownOpen, setCompanyDropdownOpen] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const selectedEmailRef = useRef(selectedEmail);
  const isNewRef = useRef(isNew);
  const companyDropdownWasOpen = useRef(false);
  const saveInProgressRef = useRef(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const pageSizeRef = useRef(DEFAULT_PAGE_SIZE);

  useEffect(() => { selectedEmailRef.current = selectedEmail; }, [selectedEmail]);
  useEffect(() => { isNewRef.current = isNew; }, [isNew]);

  const selectedCompany = useMemo(
    () => companies.find((company) => company.companyid === companyid) || null,
    [companies, companyid],
  );
  const accountCompany = selectedCompany || companyInfo;
  const canCreateUser = accountCompany?.company_status === 'ACTIVE'
    && Number(accountCompany.active_users || 0) < Number(accountCompany.licensed_seats || 0);
  const isSelectedSelf = Boolean(selectedEmail) && selectedEmail.toLowerCase() === currentEmail;
  const canSubmasterEditSelected = isSubmaster
    && Boolean(selectedEmail)
    && ['USER', 'SUBMASTER'].includes(String(draft.authority || '').toUpperCase());
  const readOnlyExisting = isSubmaster && !isNew && !canSubmasterEditSelected;
  const selectedAccount = users.find((item) => item.email === selectedEmail) || null;
  const canSubmasterDeleteSelected = isSubmaster
    && selectedAccount?.authority === 'USER'
    && !isSelectedSelf;

  const loadCompanies = useCallback(async () => {
    if (isSubmaster) {
      setCompanies([]);
      setCompanyid(localStorage.getItem('user_company') || '');
      return;
    }
    setLoadingCompanies(true);
    try {
      const { data } = await axios.get('/api/companies', {
        ...authConfig(),
        params: { page: 1, page_size: 200 },
      });
      const rows = data.items || [];
      setCompanies(rows);
      setCompanyid((current) => (rows.some((row) => row.companyid === current) ? current : rows[0]?.companyid || ''));
    } catch (error) {
      if (![401, 403].includes(error.response?.status)) {
        notifications.show({ title: '고객사 조회 실패', message: errorMessage(error, '고객사 목록을 불러오지 못했습니다.'), color: 'red' });
      }
      setCompanies([]);
      setCompanyid('');
    } finally {
      setLoadingCompanies(false);
    }
  }, [isSubmaster]);

  const loadUsers = useCallback(async (targetCompanyId = companyid, preferredEmail = selectedEmailRef.current, preserveDraft = false) => {
    if (!targetCompanyId) {
      setCompanyInfo(null);
      setCompanyname('');
      setUsers([]);
      setPage(1);
      setSelectedEmail('');
      setDraft(emptyUser());
      return;
    }
    setLoadingUsers(true);
    try {
      const { data } = await axios.get('/api/company-users', {
        ...authConfig(),
        params: { companyid: targetCompanyId },
      });
      setCompanyInfo({
        ...data.company,
        active_users: Number(data.active_users || 0),
      });
      setCompanyname(data.company.companyname || '');
      setUsers(data.items || []);
      // 선택된 계정이 있는 페이지를 보여준다 (없으면 첫 페이지)
      const preferredIndex = (data.items || []).findIndex((item) => item.email === preferredEmail);
      setPage(preferredIndex >= 0 ? Math.floor(preferredIndex / pageSizeRef.current) + 1 : 1);
      if (!preserveDraft && !isNewRef.current) {
        const selected = (data.items || []).find((item) => item.email === preferredEmail) || null;
        setSelectedEmail(selected?.email || '');
        setDraft(selected ? { ...selected, password: '' } : { ...emptyUser(), companyid: targetCompanyId });
      }
    } catch (error) {
      notifications.show({ title: '계정 조회 실패', message: errorMessage(error, '고객사 계정을 불러오지 못했습니다.'), color: 'red' });
      setCompanyInfo(null);
      setCompanyname('');
      setUsers([]);
      setPage(1);
    } finally {
      setLoadingUsers(false);
    }
  }, [companyid]);

  // 탭에 돌아오면 지금 조건 그대로 다시 불러온다 (다른 탭에서 데이터가 바뀌었을 수 있음)
  usePageReactivated(() => { void loadCompanies(); });
  useEffect(() => { void loadCompanies(); }, [loadCompanies]);
  useEffect(() => {
    isNewRef.current = false;
    setIsNew(false);
    selectedEmailRef.current = '';
    setSelectedEmail('');
    setDraft({ ...emptyUser(), companyid });
    void loadUsers(companyid);
  }, [companyid, loadUsers]);

  const handleAdd = useCallback(() => {
    if (!companyid) {
      notifications.show({ title: '고객사를 선택해 주세요', message: '계정을 등록할 고객사를 먼저 선택해 주세요.', color: 'orange' });
      return;
    }
    if (!canCreateUser) {
      notifications.show({
        title: '계정 등록 불가',
        message: accountCompany?.company_status !== 'ACTIVE'
          ? '이용 상태가 ACTIVE인 고객사에만 계정을 등록할 수 있습니다.'
          : '허용된 계정 수를 모두 사용 중입니다.',
        color: 'orange',
      });
      return;
    }
    selectedEmailRef.current = '';
    isNewRef.current = true;
    setSelectedEmail('');
    setDraft({ ...emptyUser(), companyid });
    setIsNew(true);
  }, [accountCompany?.company_status, canCreateUser, companyid]);

  const handleSelectUser = useCallback((user) => {
    if (isSubmaster && user.authority === 'MASTER') return;
    selectedEmailRef.current = user.email;
    isNewRef.current = false;
    setSelectedEmail(user.email);
    setDraft({ ...user, password: '' });
    setIsNew(false);
  }, [isSubmaster]);

  const updateDraft = useCallback((field, value) => {
    setDraft((current) => ({ ...current, [field]: value }));
  }, []);

  const generateTemporaryPassword = useCallback(() => {
    const bytes = new Uint8Array(12);
    window.crypto.getRandomValues(bytes);
    const randomPart = window.btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '').slice(0, 12);
    updateDraft('password', `S119!${randomPart}`);
    notifications.show({
      title: '임시 비밀번호 생성',
      message: '저장한 뒤 새 비밀번호를 사용자에게 안전하게 전달해 주세요.',
      color: 'blue',
    });
  }, [updateDraft]);

  const handleSave = useCallback(async () => {
    if (isSubmaster && !isNew && readOnlyExisting) {
      notifications.show({ title: '수정할 수 없습니다', message: '고객사 관리자는 고객사 관리자 또는 일반 사용자 계정만 수정할 수 있습니다.', color: 'orange' });
      return;
    }
    const username = String(draft.username ?? '').trim();
    const email = String(draft.email ?? '').trim();
    const password = String(draft.password ?? '');
    if (!companyid || !username || !email || (isNew && !password)) {
      notifications.show({ title: '필수값 확인', message: '고객사, 사용자명, 이메일과 신규 계정 비밀번호를 입력해 주세요.', color: 'red' });
      return;
    }
    if (isNew && !canCreateUser) {
      notifications.show({ title: '계정 등록 불가', message: '고객사 상태와 허용 계정 수를 확인해 주세요.', color: 'orange' });
      return;
    }
    if (saveInProgressRef.current) return;
    saveInProgressRef.current = true;
    setSaving(true);
    try {
      const payload = {
        companyid,
        companyname: '',
        username,
        email,
        authority: draft.authority || 'USER',
        useyn: isSubmaster && isNew ? 'Y' : draft.useyn || 'Y',
        password,
      };
      const { data } = isNew
        ? await axios.post('/api/company-users', payload, authConfig())
        : await axios.put('/api/company-users', { ...payload, original_email: selectedEmail }, authConfig());
      const updatingSelf = isSubmaster && selectedEmail.toLowerCase() === currentEmail;
      if (updatingSelf && (
        data.item.email.toLowerCase() !== currentEmail
        || data.item.authority !== 'SUBMASTER'
        || data.item.useyn !== 'Y'
      )) {
        const changedToUser = data.item.authority === 'USER';
        notifications.show({
          title: changedToUser ? '권한 변경 완료' : '계정 정보 변경 완료',
          message: changedToUser
            ? '일반 사용자로 권한이 변경되었습니다. 다시 로그인해 주세요.'
            : '로그인 정보가 변경되었습니다. 다시 로그인해 주세요.',
          color: 'teal',
        });
        ['access_token', 'user_name', 'user_email', 'user_company', 'user_companyname', 'user_authority'].forEach((key) => localStorage.removeItem(key));
        navigate('/login');
        return;
      }
      if (updatingSelf) localStorage.setItem('user_name', data.item.username);
      isNewRef.current = false;
      selectedEmailRef.current = data.item.email;
      setIsNew(false);
      setSelectedEmail(data.item.email);
      setDraft({ ...data.item, password: '' });
      notifications.show({ title: isNew ? '계정 등록 완료' : '계정 수정 완료', message: `${data.item.username} 계정을 저장했습니다.`, color: 'teal' });
      await Promise.all([loadUsers(companyid, data.item.email, true), loadCompanies()]);
    } catch (error) {
      notifications.show({ title: '저장 실패', message: errorMessage(error, '고객사 계정을 저장하지 못했습니다.'), color: 'red' });
    } finally {
      saveInProgressRef.current = false;
      setSaving(false);
    }
  }, [canCreateUser, companyid, currentEmail, draft, isNew, isSubmaster, loadCompanies, loadUsers, navigate, readOnlyExisting, selectedEmail]);

  const handleDelete = useCallback(() => {
    if (!companyid || !selectedEmail || isNew) return;
    const target = users.find((item) => item.email === selectedEmail);
    if (!target) return;
    if (isSubmaster && (target.authority !== 'USER' || selectedEmail.toLowerCase() === currentEmail)) {
      notifications.show({ title: '삭제할 수 없습니다', message: '고객사 관리자는 본인 계정을 삭제할 수 없으며 일반 사용자 계정만 삭제할 수 있습니다.', color: 'red' });
      return;
    }

    modals.openConfirmModal({
      title: '고객사 계정 삭제 확인',
      centered: true,
      children: (
        <Text size="sm">
          <Text span fw={700} c="red">{target.username} ({target.email})</Text> 계정을 삭제하시겠습니까?
          <br />삭제한 계정은 로그인할 수 없으며 복구할 수 없습니다.
        </Text>
      ),
      labels: { confirm: '삭제', cancel: '취소' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        setDeleting(true);
        try {
          await axios.delete('/api/company-users', {
            ...authConfig(),
            params: { companyid, email: selectedEmail },
          });
          selectedEmailRef.current = '';
          isNewRef.current = false;
          setSelectedEmail('');
          setIsNew(false);
          setDraft({ ...emptyUser(), companyid });
          notifications.show({ title: '계정 삭제 완료', message: `${target.username} 계정을 삭제했습니다.`, color: 'teal' });
          await Promise.all([loadUsers(companyid, ''), loadCompanies()]);
        } catch (error) {
          notifications.show({ title: '삭제 실패', message: errorMessage(error, '고객사 계정을 삭제하지 못했습니다.'), color: 'red' });
        } finally {
          setDeleting(false);
        }
      },
    });
  }, [companyid, currentEmail, isNew, isSubmaster, loadCompanies, loadUsers, selectedEmail, users]);

  useErpPageRibbon({
    onSearch: () => loadUsers(companyid),
    onAdd: handleAdd,
    onSave: saving || (!isNew && !selectedEmail) || (isSubmaster && !isNew && readOnlyExisting) ? undefined : handleSave,
    onDelete: !isNew && selectedEmail && !deleting && (isPlatformMaster || canSubmasterDeleteSelected) ? handleDelete : undefined,
    showPrint: false,
    showExcel: false,
    useSaveColor: false,
  });

  const pageCount = Math.max(1, Math.ceil(users.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pagedUsers = useMemo(
    () => users.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [currentPage, pageSize, users],
  );
  const remainingSeats = companyInfo
    ? Math.max(0, Number(companyInfo.licensed_seats || 0) - Number(companyInfo.active_users || 0))
    : 0;

  return (
    <Box className={`${simpleTheme.simple} ${simpleTheme.noIcons} ${sharedClasses.pageShell} ${classes.page}`}>
      <Box component="nav" className={classes.breadcrumb}>
        <Text component="span" className={classes.breadcrumbParent}>고객사정보</Text>
        <Text component="span" className={classes.breadcrumbChevron}>›</Text>
        <Text component="span" className={classes.breadcrumbCurrent}>고객사관리</Text>
      </Box>

      <div className={classes.workspace}>
        <Paper className={classes.listPanel} withBorder>
          <Group className={classes.panelHeader} justify="space-between" wrap="wrap">
            <Group gap={8} wrap="nowrap">
              <span className={classes.titleIcon}><IconUsersGroup size={15} /></span>
              <Text className={classes.sectionTitle} fw={700}>고객사 계정 목록</Text>
              <Badge className={classes.countBadge} variant="light" color="gray" radius="sm">{users.length.toLocaleString('ko-KR')}건</Badge>
            </Group>
            {companyInfo && (
              <span className={classes.seatText}>
                <span className={companyInfo.company_status === 'ACTIVE' ? classes.seatStatusOn : classes.seatStatusOff}>
                  {COMPANY_STATUS_LABELS[companyInfo.company_status] || companyInfo.company_status}
                </span>
                <i className={classes.seatDivider} aria-hidden="true" />
                활성 계정 <b>{Number(companyInfo.active_users || 0).toLocaleString('ko-KR')}</b>명
                <i className={classes.seatDivider} aria-hidden="true" />
                허용 계정 <b>{Number(companyInfo.licensed_seats || 0).toLocaleString('ko-KR')}</b>명
              </span>
            )}
          </Group>
          <Group className={classes.searchBar} gap={8} align="flex-end" wrap="nowrap">
            {isPlatformMaster ? (
            <Select
              className={classes.companySelect}
              label="고객사"
              placeholder="고객사 선택"
              leftSection={<IconBuilding size={15} />}
              data={companies.map((company) => ({ value: company.companyid, label: `${company.companyid} - ${company.companyname}` }))}
              renderOption={({ option }) => {
                const company = companies.find((item) => item.companyid === option.value);
                return company ? (
                  <Group gap="sm" wrap="nowrap">
                    <Text size="xs" fw={600}>{company.companyid}</Text>
                    <Text size="xs" truncate>{company.companyname}</Text>
                  </Group>
                ) : option.label;
              }}
              value={companyid || null}
              onChange={(value) => {
                const selected = companies.find((company) => company.companyid === value);
                setCompanyname(selected?.companyname || '');
                setCompanyid(value || '');
              }}
              dropdownOpened={companyDropdownOpen}
              onDropdownOpen={() => setCompanyDropdownOpen(true)}
              onDropdownClose={() => setCompanyDropdownOpen(false)}
              onMouseDown={() => { companyDropdownWasOpen.current = companyDropdownOpen; }}
              onClick={() => setCompanyDropdownOpen(!companyDropdownWasOpen.current)}
              searchable
              allowDeselect={false}
              disabled={loadingCompanies}
            />
            ) : (
              <TextInput
                className={classes.companySelect}
                label="고객사"
                leftSection={<IconBuilding size={15} />}
                value={`${companyid} - ${companyInfo?.companyname || ''}`}
                readOnly
                disabled
              />
            )}
          </Group>
          <ScrollArea className={classes.tableWrap} type="always" scrollbars="xy" scrollbarSize={12}>
            <Table className={`${sharedClasses.table} ${classes.table}`} highlightOnHover style={{ width: `max(100%, ${userCols.tableWidth}px)` }}>
              <colgroup>
                {USER_COLUMNS.map((column) => <col key={column.key} data-column-key={column.key} style={{ width: userCols.widthOf(column) }} />)}
              </colgroup>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th className={pickerClasses.resizableHead}>사용자명<ColumnResizeHandle column={USER_COLUMNS[0]} columns={userCols} /></Table.Th>
                  <Table.Th className={pickerClasses.resizableHead}>이메일<ColumnResizeHandle column={USER_COLUMNS[1]} columns={userCols} /></Table.Th>
                  <Table.Th className={pickerClasses.resizableHead}>권한<ColumnResizeHandle column={USER_COLUMNS[2]} columns={userCols} /></Table.Th>
                  <Table.Th className={pickerClasses.resizableHead}>사용여부<ColumnResizeHandle column={USER_COLUMNS[3]} columns={userCols} /></Table.Th>
                  <Table.Th className={pickerClasses.resizableHead}>등록자<ColumnResizeHandle column={USER_COLUMNS[4]} columns={userCols} /></Table.Th>
                  <Table.Th className={pickerClasses.resizableHead}>수정자<ColumnResizeHandle column={USER_COLUMNS[5]} columns={userCols} /></Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {pagedUsers.length ? pagedUsers.map((user) => (
                  <Table.Tr
                    key={`${user.companyid}:${user.email}`}
                    className={selectedEmail === user.email ? classes.selectedRow : ''}
                    onClick={() => handleSelectUser(user)}
                  >
                    <Table.Td className={classes.nameCell} title={user.username}>{user.username}</Table.Td>
                    <Table.Td title={user.email}>{user.email}</Table.Td>
                    <Table.Td>
                      <Badge size="sm" variant="light" radius="sm" color={AUTHORITY_COLORS[user.authority] || 'gray'}>
                        {AUTHORITY_LABELS[user.authority] || user.authority || AUTHORITY_LABELS.USER}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Badge size="sm" variant="light" color={user.useyn === 'Y' ? 'teal' : 'gray'}>
                        {user.useyn === 'Y' ? '사용중' : '사용중지'}
                      </Badge>
                    </Table.Td>
                    <Table.Td title={user.created_by || ''}>{user.created_by || ''}</Table.Td>
                    <Table.Td title={user.updated_by || ''}>{user.updated_by || ''}</Table.Td>
                  </Table.Tr>
                )) : (
                  <Table.Tr className={classes.emptyRow}>
                    <Table.Td colSpan={7} className={classes.emptyCell}>
                      <div className={classes.empty}>
                        <span className={classes.emptyIcon}>
                          {loadingUsers ? <IconSearch size={20} /> : companyid ? <IconInbox size={22} /> : <IconBuilding size={20} />}
                        </span>
                        <strong>{loadingUsers ? '조회 중...' : companyid ? '등록된 계정이 없습니다.' : '고객사를 선택해 주세요.'}</strong>
                      </div>
                    </Table.Td>
                  </Table.Tr>
                )}
              </Table.Tbody>
            </Table>
          </ScrollArea>
          <Group className={classes.paginationBar} justify="space-between" wrap="wrap">
            <Group gap="xs" wrap="nowrap">
              <Text component="span" className={classes.totalText}>총 <b>{users.length.toLocaleString('ko-KR')}</b>건</Text>
              <Select
                aria-label="페이지당 표시 건수"
                data={PAGE_SIZE_OPTIONS}
                value={String(pageSize)}
                w={96}
                size="xs"
                allowDeselect={false}
                onChange={(value) => {
                  if (!value) return;
                  pageSizeRef.current = Number(value);
                  setPageSize(Number(value));
                  setPage(1);
                }}
              />
              <Text component="span" className={classes.seatHint}>
                {companyInfo?.company_status === 'ACTIVE'
                  ? <>남은 계정 <b>{Number(remainingSeats || 0).toLocaleString('ko-KR')}</b>개</>
                  : 'ACTIVE 고객사만 계정 등록 가능'}
              </Text>
            </Group>
            <Pagination size="sm" color="red" withEdges value={currentPage} total={pageCount} onChange={setPage} disabled={loadingUsers || !users.length} />
          </Group>
        </Paper>

        <Paper className={classes.formPanel} withBorder>
          <Group className={classes.panelHeader} justify="space-between" wrap="nowrap">
            <Group gap={8} wrap="nowrap">
              <Text className={classes.sectionTitle} fw={700}>사용자 계정 정보</Text>
              <Badge variant="light" radius="sm" color={isNew ? 'red' : 'gray'}>
                {isNew ? '신규 등록' : draft.email ? '수정' : '선택 대기'}
              </Badge>
            </Group>
            {companyid && (
              <Button
                size="xs"
                variant="default"
                className={classes.softButton}
                leftSection={<IconKey size={14} />}
                onClick={() => {
                  if (selectedEmail && String(draft.authority || '').toUpperCase() === 'MASTER') {
                    notifications.show({
                      title: '메뉴 권한 설정 불필요',
                      message: '플랫폼 관리자는 모든 메뉴 권한을 가지고 있어 개별 메뉴 권한을 설정하지 않습니다.',
                      color: 'red',
                    });
                    return;
                  }
                  navigate('/UserMenu', {
                    state: { companyid, useremail: selectedEmail || undefined },
                  });
                }}
              >
                메뉴 권한
              </Button>
            )}
          </Group>
          <ScrollArea className={classes.formBody} type="auto">
            <div className={classes.formSections}>
              <section className={classes.formSection}>
                <div className={classes.formSectionHead}><IconBuilding size={15} />소속 고객사</div>
                <div className={classes.formGrid}>
                  <TextInput label="고객사코드" value={companyid} readOnly disabled />
                  <TextInput
                    label="고객사명"
                    withAsterisk
                    value={companyname}
                    maxLength={100}
                    readOnly
                    disabled
                  />
                </div>
              </section>

              <section className={classes.formSection}>
                <div className={classes.formSectionHead}>
                  <IconUserCircle size={15} />계정 정보
                  {readOnlyExisting && <span className={classes.formSectionHint}>조회 전용 계정</span>}
                </div>
                <div className={classes.formGrid}>
                  <TextInput label="사용자명" withAsterisk value={draft.username} onChange={(event) => updateDraft('username', event.currentTarget.value)} maxLength={20} disabled={readOnlyExisting} />
                  <TextInput label="이메일" withAsterisk type="email" value={draft.email} onChange={(event) => updateDraft('email', event.currentTarget.value)} maxLength={50} disabled={readOnlyExisting} />
                  <Select
                    label="권한"
                    withAsterisk
                    data={companyid === '001'
                      ? [
                        { value: 'MASTER', label: '플랫폼 관리자' },
                        { value: 'USER', label: '일반 사용자' },
                      ]
                      : [
                        { value: 'SUBMASTER', label: '고객사 관리자' },
                        { value: 'USER', label: '일반 사용자' },
                      ]}
                    value={draft.authority || 'USER'}
                    onChange={(value) => updateDraft('authority', value || 'USER')}
                    allowDeselect={false}
                    disabled={readOnlyExisting}
                  />
                  <Select
                    label="사용여부"
                    data={[{ value: 'Y', label: '사용중' }, { value: 'N', label: '사용중지' }]}
                    value={draft.useyn || 'Y'}
                    onChange={(value) => updateDraft('useyn', value || 'Y')}
                    allowDeselect={false}
                    disabled={isSubmaster && (isNew || readOnlyExisting)}
                  />
                </div>
              </section>

              {(isNew || (draft.email && (isPlatformMaster || (isSubmaster && !readOnlyExisting)))) && (
                <section className={classes.formSection}>
                  <div className={classes.formSectionHead}><IconLock size={15} />비밀번호</div>
                  <div className={classes.formGrid}>
                    <Group className={classes.fullWidth} align="flex-end" gap="xs" wrap="nowrap">
                      <PasswordInput
                        style={{ flex: 1 }}
                        label={isNew ? '초기 비밀번호' : '새 비밀번호 / 관리자 재설정'}
                        withAsterisk={isNew}
                        description={isNew ? '초기 비밀번호를 입력해 주세요.' : <>변경할 때만 입력 후 저장하세요.<br />비워두면 기존 비밀번호를 유지합니다.</>}
                        value={draft.password}
                        onChange={(event) => updateDraft('password', event.currentTarget.value)}
                        autoComplete="new-password"
                      />
                      <Button size="xs" variant="default" className={classes.softButton} leftSection={<IconRefresh size={14} />} onClick={generateTemporaryPassword}>
                        임시값 생성
                      </Button>
                    </Group>
                  </div>
                </section>
              )}
            </div>
          </ScrollArea>
        </Paper>
      </div>
    </Box>
  );
}
