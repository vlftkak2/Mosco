import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import {
  Badge,
  Box,
  Button,
  Group,
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
import { IconKey } from '@tabler/icons-react';
import { useLocation, useNavigate } from 'react-router-dom';
import useErpPageRibbon from '../components/common/useErpPageRibbon';
import sharedClasses from '../styles/pages/ManagementShared.module.css';
import classes from '../styles/pages/User.module.css';

const authConfig = () => ({
  headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` },
});

const emptyUser = () => ({ companyid: '', username: '', email: '', team: '', authority: 'USER', password: '', useyn: 'Y' });
const COMPANY_STATUS_LABELS = {
  PENDING: '승인대기',
  ACTIVE: '이용중',
  SUSPENDED: '이용정지',
  CLOSED: '종료',
};
const errorMessage = (error, fallback) => {
  const detail = error.response?.data?.detail;
  if (Array.isArray(detail)) return detail.map((item) => item.msg).join(', ');
  return detail || error.message || fallback;
};

const AUTHORITY_LABELS = {
  MASTER: '플랫폼 관리자',
  SUBMASTER: '고객사 관리자',
  USER: '일반 사용자',
};

export default function User() {
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
      notifications.show({ title: '고객사 조회 실패', message: errorMessage(error, '고객사 목록을 불러오지 못했습니다.'), color: 'red' });
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
      setCompanyInfo(data.company);
      setCompanyname(data.company.companyname || '');
      setUsers(data.items || []);
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
    } finally {
      setLoadingUsers(false);
    }
  }, [companyid]);

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
    setSaving(true);
    try {
      const payload = {
        companyid,
        companyname: '',
        username,
        email,
        team: String(draft.team ?? '').trim(),
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
        notifications.show({ title: '계정 정보 변경 완료', message: '이메일, 권한 또는 사용 상태가 변경되어 다시 로그인합니다.', color: 'teal' });
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

  return (
    <Box className={`${sharedClasses.pageShell} ${classes.page}`}>
      <Box component="nav" className={classes.breadcrumb}>
        <Text component="span" className={classes.breadcrumbParent}>시스템관리</Text>
        <Text component="span" className={classes.breadcrumbChevron}>›</Text>
        <Text component="span" className={classes.breadcrumbCurrent}>사용자 관리</Text>
      </Box>

      <div className={classes.workspace}>
        <Paper className={classes.listPanel} withBorder>
          <Group className={classes.panelHeader} justify="space-between">
            <Group gap={7}>
              <Text className={classes.sectionTitle} fw={700}>고객사 계정 목록</Text>
              <Badge variant="light" color="gray">{users.length}건</Badge>
            </Group>
            {companyInfo && (
              <Group gap={8} wrap="nowrap">
                <Badge
                  variant="light"
                  color={companyInfo.company_status === 'ACTIVE' ? 'teal' : companyInfo.company_status === 'SUSPENDED' ? 'orange' : 'gray'}
                >
                  {COMPANY_STATUS_LABELS[companyInfo.company_status] || companyInfo.company_status}
                </Badge>
                <Text size="xs" c="dimmed">
                  활성 계정 {companyInfo.active_users} / 허용 {companyInfo.licensed_seats}명
                </Text>
              </Group>
            )}
          </Group>
          <Group className={classes.searchBar} gap={8} align="flex-end" wrap="nowrap">
            {isPlatformMaster ? (
            <Select
              className={classes.companySelect}
              label="고객사"
              placeholder="고객사 선택"
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
                value={`${companyid} - ${companyInfo?.companyname || ''}`}
                readOnly
                disabled
              />
            )}
          </Group>
          <ScrollArea className={classes.tableWrap} type="always" scrollbars="xy" scrollbarSize={12}>
            <Table className={`${sharedClasses.table} ${classes.table}`} highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>사용자명</Table.Th>
                  <Table.Th>이메일</Table.Th>
                  <Table.Th>부서</Table.Th>
                  <Table.Th>권한</Table.Th>
                  <Table.Th>사용여부</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {users.length ? users.map((user) => (
                  <Table.Tr
                    key={`${user.companyid}:${user.email}`}
                    className={selectedEmail === user.email ? classes.selectedRow : ''}
                    onClick={() => handleSelectUser(user)}
                  >
                    <Table.Td>{user.username}</Table.Td>
                    <Table.Td title={user.email}>{user.email}</Table.Td>
                    <Table.Td>{user.team || '-'}</Table.Td>
                    <Table.Td>{AUTHORITY_LABELS[user.authority] || user.authority || AUTHORITY_LABELS.USER}</Table.Td>
                    <Table.Td>
                      <Badge size="sm" variant="light" color={user.useyn === 'Y' ? 'teal' : 'gray'}>
                        {user.useyn === 'Y' ? '사용중' : '사용중지'}
                      </Badge>
                    </Table.Td>
                  </Table.Tr>
                )) : (
                  <Table.Tr>
                    <Table.Td colSpan={5} className={classes.empty}>
                      {loadingUsers ? '조회 중...' : companyid ? '등록된 계정이 없습니다.' : '고객사를 선택해 주세요.'}
                    </Table.Td>
                  </Table.Tr>
                )}
              </Table.Tbody>
            </Table>
          </ScrollArea>
          <Group className={sharedClasses.footer} justify="space-between">
            <Text size="xs" c="dimmed">
              {companyInfo?.company_status === 'ACTIVE'
                ? `남은 계정 ${Math.max(0, Number(companyInfo.licensed_seats || 0) - Number(companyInfo.active_users || 0))}개`
                : 'ACTIVE 고객사만 계정 등록 가능'}
            </Text>
            <Text size="xs" c="dimmed">{users.length}개 계정</Text>
          </Group>
        </Paper>

        <Paper className={classes.formPanel} withBorder>
          <Group className={classes.panelHeader} justify="space-between">
            <Text className={classes.sectionTitle} fw={700}>사용자 계정 정보</Text>
            <Group gap={8} wrap="nowrap">
              {companyid && (
                <Button
                  size="xs"
                  variant="light"
                  color="red"
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
              <Badge variant="light" color={isNew ? 'red' : draft.email ? 'gray' : 'gray'}>
                {isNew ? '신규 등록' : draft.email ? '수정' : '선택 대기'}
              </Badge>
            </Group>
          </Group>
          <ScrollArea className={classes.formBody} type="auto">
            <div className={classes.formGrid}>
              <TextInput label="고객사코드" value={companyid} readOnly disabled />
              <TextInput
                label="고객사명 *"
                value={companyname}
                maxLength={100}
                readOnly
                disabled
              />
              <TextInput label="사용자명 *" value={draft.username} onChange={(event) => updateDraft('username', event.currentTarget.value)} maxLength={20} disabled={readOnlyExisting} />
              <TextInput label="이메일 *" type="email" value={draft.email} onChange={(event) => updateDraft('email', event.currentTarget.value)} maxLength={50} disabled={readOnlyExisting} />
              <TextInput label="부서" value={draft.team} onChange={(event) => updateDraft('team', event.currentTarget.value)} maxLength={50} disabled={readOnlyExisting} />
              <Select
                label="권한 *"
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
              {(isNew || (draft.email && (isPlatformMaster || (isSubmaster && !readOnlyExisting)))) && (
                <Group className={classes.fullWidth} align="flex-end" gap="xs" wrap="nowrap">
                  <PasswordInput
                    style={{ flex: 1 }}
                    label={isNew ? '초기 비밀번호 *' : '새 비밀번호 / 관리자 재설정'}
                    description={isNew ? '초기 비밀번호를 입력해 주세요.' : <>변경할 때만 입력 후 저장하세요.<br />비워두면 기존 비밀번호를 유지합니다.</>}
                    value={draft.password}
                    onChange={(event) => updateDraft('password', event.currentTarget.value)}
                    autoComplete="new-password"
                  />
                  <Button size="xs" variant="light" color="gray" onClick={generateTemporaryPassword}>
                    임시값 생성
                  </Button>
                </Group>
              )}
            </div>
          </ScrollArea>
        </Paper>
      </div>
    </Box>
  );
}
