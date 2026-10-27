import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import {
  Badge,
  Box,
  Checkbox,
  Group,
  Paper,
  ScrollArea,
  Select,
  Switch,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useLocation } from 'react-router-dom';
import useErpPageRibbon from '../components/common/useErpPageRibbon';
import sharedClasses from '../styles/pages/ManagementShared.module.css';
import classes from '../styles/pages/UserMenu.module.css';


const authConfig = () => ({
  headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` },
});

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

const STATUS_LABELS = {
  PENDING: '승인대기',
  ACTIVE: '이용중',
  SUSPENDED: '이용정지',
  CLOSED: '종료',
};


export default function UserMenu() {
  const location = useLocation();
  const currentAuthority = String(localStorage.getItem('user_authority') || 'USER').toUpperCase();
  const isPlatformMaster = currentAuthority === 'MASTER';
  const [companies, setCompanies] = useState([]);
  const [companyid, setCompanyid] = useState(() => (
    isPlatformMaster
      ? location.state?.companyid || ''
      : localStorage.getItem('user_company') || ''
  ));
  const [companyInfo, setCompanyInfo] = useState(null);
  const [users, setUsers] = useState([]);
  const [selectedEmail, setSelectedEmail] = useState('');
  const [menus, setMenus] = useState([]);
  const [selectedMenuids, setSelectedMenuids] = useState([]);
  const [loadingCompanies, setLoadingCompanies] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadingMenus, setLoadingMenus] = useState(false);
  const [saving, setSaving] = useState(false);
  const preferredEmailRef = useRef(location.state?.useremail || '');

  const selectedCompany = useMemo(
    () => companies.find((company) => company.companyid === companyid) || companyInfo,
    [companies, companyInfo, companyid],
  );
  const selectedUser = useMemo(
    () => users.find((user) => user.email === selectedEmail && user.companyid === companyid) || null,
    [companyid, selectedEmail, users],
  );
  const selectedMenuSet = useMemo(() => new Set(selectedMenuids), [selectedMenuids]);
  const allSelected = menus.length > 0 && menus.every((menu) => selectedMenuSet.has(menu.menuid));
  const partiallySelected = menus.some((menu) => selectedMenuSet.has(menu.menuid)) && !allSelected;

  const loadCompanies = useCallback(async () => {
    setLoadingCompanies(true);
    try {
      const { data } = await axios.get('/api/user-menu/companies', authConfig());
      const rows = data.items || [];
      setCompanies(rows);
      setCompanyid((current) => (
        rows.some((row) => row.companyid === current)
          ? current
          : rows[0]?.companyid || ''
      ));
    } catch (error) {
      setCompanies([]);
      setCompanyid('');
      notifications.show({
        title: '고객사 조회 실패',
        message: errorMessage(error, '관리 가능한 고객사를 불러오지 못했습니다.'),
        color: 'red',
      });
    } finally {
      setLoadingCompanies(false);
    }
  }, []);

  const loadUsers = useCallback(async (targetCompanyid, preferredEmail = '') => {
    if (!targetCompanyid) {
      setCompanyInfo(null);
      setUsers([]);
      setSelectedEmail('');
      return;
    }
    setLoadingUsers(true);
    setUsers([]);
    setSelectedEmail('');
    setMenus([]);
    setSelectedMenuids([]);
    try {
      const { data } = await axios.get('/api/user-menu/users', {
        ...authConfig(),
        params: { companyid: targetCompanyid },
      });
      const rows = data.items || [];
      const selected = rows.find((row) => row.email === preferredEmail) || rows[0] || null;
      setCompanyInfo(data.company || null);
      setUsers(rows);
      setSelectedEmail(selected?.email || '');
    } catch (error) {
      setCompanyInfo(null);
      notifications.show({
        title: '사용자 조회 실패',
        message: errorMessage(error, '고객사 계정을 불러오지 못했습니다.'),
        color: 'red',
      });
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  const loadPermissions = useCallback(async (targetCompanyid, useremail) => {
    if (!targetCompanyid || !useremail) {
      setMenus([]);
      setSelectedMenuids([]);
      return;
    }
    setLoadingMenus(true);
    try {
      const { data } = await axios.get('/api/user-menu/permissions', {
        ...authConfig(),
        params: { companyid: targetCompanyid, useremail },
      });
      const rows = data.items || [];
      setMenus(rows);
      setSelectedMenuids(rows.filter((menu) => menu.granted).map((menu) => menu.menuid));
    } catch (error) {
      setMenus([]);
      setSelectedMenuids([]);
      notifications.show({
        title: '메뉴 권한 조회 실패',
        message: errorMessage(error, '사용자의 메뉴 권한을 불러오지 못했습니다.'),
        color: 'red',
      });
    } finally {
      setLoadingMenus(false);
    }
  }, []);

  useEffect(() => { void loadCompanies(); }, [loadCompanies]);
  useEffect(() => {
    const preferredEmail = preferredEmailRef.current;
    preferredEmailRef.current = '';
    void loadUsers(companyid, preferredEmail);
  }, [companyid, loadUsers]);
  useEffect(() => {
    if (selectedUser) void loadPermissions(companyid, selectedUser.email);
  }, [companyid, loadPermissions, selectedUser]);

  const toggleMenu = useCallback((menuid, checked) => {
    setSelectedMenuids((current) => (
      checked
        ? Array.from(new Set([...current, menuid]))
        : current.filter((id) => id !== menuid)
    ));
  }, []);

  const handleSave = useCallback(async () => {
    if (!companyid || !selectedUser) {
      notifications.show({
        title: '사용자 선택 필요',
        message: '메뉴 권한을 저장할 사용자를 선택해 주세요.',
        color: 'orange',
      });
      return;
    }
    setSaving(true);
    try {
      await axios.put('/api/user-menu/permissions', {
        companyid,
        useremail: selectedUser.email,
        menuids: selectedMenuids,
      }, authConfig());
      notifications.show({
        title: '메뉴 권한 저장 완료',
        message: `${selectedUser.username} 계정에 ${selectedMenuids.length}개 메뉴 권한을 반영했습니다.`,
        color: 'teal',
      });
      await loadPermissions(companyid, selectedUser.email);
    } catch (error) {
      notifications.show({
        title: '메뉴 권한 저장 실패',
        message: errorMessage(error, '메뉴 권한을 저장하지 못했습니다.'),
        color: 'red',
      });
    } finally {
      setSaving(false);
    }
  }, [companyid, loadPermissions, selectedMenuids, selectedUser]);

  const handleSearch = useCallback(async () => {
    await loadUsers(companyid, selectedEmail);
  }, [companyid, loadUsers, selectedEmail]);

  useErpPageRibbon({
    onSearch: handleSearch,
    onSave: selectedUser && !saving ? handleSave : undefined,
    showPrint: false,
    showExcel: false,
    useSaveColor: false,
  });

  return (
    <Box className={`${sharedClasses.pageShell} ${classes.page}`}>
      <Box component="nav" className={classes.breadcrumb}>
        <Text component="span" className={classes.breadcrumbParent}>시스템관리</Text>
        <Text component="span" className={classes.breadcrumbChevron}>›</Text>
        <Text component="span" className={classes.breadcrumbCurrent}>사용자 메뉴권한</Text>
      </Box>

      <div className={classes.workspace}>
        <Paper className={classes.userPanel} withBorder>
          <Group className={classes.panelHeader} justify="space-between">
            <Group gap={7}>
              <Text className={classes.sectionTitle}>사용자 목록</Text>
              <Badge variant="light" color="gray">{users.length}건</Badge>
            </Group>
            {selectedCompany && (
              <Badge
                variant="light"
                color={selectedCompany.company_status === 'ACTIVE' ? 'teal' : 'orange'}
              >
                {STATUS_LABELS[selectedCompany.company_status] || selectedCompany.company_status}
              </Badge>
            )}
          </Group>

          <Group className={classes.companyBar} wrap="nowrap">
            {isPlatformMaster ? (
              <Select
                className={classes.companySelect}
                label="고객사"
                data={companies.map((company) => ({
                  value: company.companyid,
                  label: `${company.companyid} - ${company.companyname}`,
                }))}
                value={companyid || null}
                onChange={(value) => setCompanyid(value || '')}
                searchable
                allowDeselect={false}
                disabled={loadingCompanies}
              />
            ) : (
              <TextInput
                className={classes.companySelect}
                label="고객사"
                value={selectedCompany ? `${selectedCompany.companyid} - ${selectedCompany.companyname}` : ''}
                readOnly
                disabled
              />
            )}
          </Group>

          <ScrollArea className={classes.tableWrap} type="always" scrollbars="xy" scrollbarSize={10}>
            <Table className={`${sharedClasses.table} ${classes.userTable}`} highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>사용자명</Table.Th>
                  <Table.Th>이메일</Table.Th>
                  <Table.Th>권한</Table.Th>
                  <Table.Th>사용여부</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {users.length ? users.map((user) => (
                  <Table.Tr
                    key={`${user.companyid}:${user.email}`}
                    className={selectedEmail === user.email ? classes.selectedRow : ''}
                    onClick={() => setSelectedEmail(user.email)}
                  >
                    <Table.Td>{user.username}</Table.Td>
                    <Table.Td title={user.email}>{user.email}</Table.Td>
                    <Table.Td>{AUTHORITY_LABELS[user.authority] || user.authority}</Table.Td>
                    <Table.Td>
                      <Badge size="sm" variant="light" color={user.useyn === 'Y' ? 'teal' : 'gray'}>
                        {user.useyn === 'Y' ? '사용중' : '사용중지'}
                      </Badge>
                    </Table.Td>
                  </Table.Tr>
                )) : (
                  <Table.Tr>
                    <Table.Td colSpan={4} className={classes.empty}>
                      {loadingUsers
                        ? '조회 중...'
                        : !companyid
                          ? '고객사를 선택해 주세요.'
                          : isPlatformMaster && companyid === '001'
                            ? '플랫폼 관리자 계정은 전체 메뉴 권한이 있어 개별 설정 대상이 아닙니다.'
                            : isPlatformMaster
                              ? '선택한 고객사에 메뉴 권한을 관리할 계정이 없습니다.'
                              : '등록된 일반 사용자 계정이 없습니다. 고객사 계정관리에서 USER 계정을 추가해 주세요.'}
                    </Table.Td>
                  </Table.Tr>
                )}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </Paper>

        <Paper className={classes.menuPanel} withBorder>
          <Group className={classes.panelHeader} justify="space-between" wrap="nowrap">
            <Group gap={7} wrap="nowrap">
              <Text className={classes.sectionTitle}>메뉴 권한</Text>
              <Badge variant="light" color="gray">{selectedMenuids.length} / {menus.length}</Badge>
            </Group>
            {selectedUser && (
              <Group gap={7} wrap="nowrap" className={classes.selectedUserInfo}>
                <Text className={classes.selectedUser} title={selectedUser.email}>
                  {selectedUser.username} · {selectedUser.email}
                </Text>
                <Badge
                  size="sm"
                  variant="light"
                  color={selectedUser.useyn === 'Y' ? 'teal' : 'gray'}
                >
                  {selectedUser.useyn === 'Y' ? '사용중' : '사용중지'}
                </Badge>
              </Group>
            )}
          </Group>

          <Group className={classes.permissionBar} justify="space-between">
            <Text size="xs" c="dimmed">접근 스위치는 선택 사용자 권한만 변경합니다. 메뉴 운영상태는 그대로 유지됩니다.</Text>
            <Checkbox
              size="xs"
              label="전체 허용"
              checked={allSelected}
              indeterminate={partiallySelected}
              disabled={!selectedUser || menus.length === 0}
              onChange={(event) => setSelectedMenuids(
                event.currentTarget.checked ? menus.map((menu) => menu.menuid) : [],
              )}
            />
          </Group>

          <ScrollArea className={classes.tableWrap} type="auto">
            <Table className={`${sharedClasses.table} ${classes.menuTable}`} highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th className={classes.checkColumn}>사용자 접근</Table.Th>
                  <Table.Th>메뉴코드</Table.Th>
                  <Table.Th>메뉴명</Table.Th>
                  <Table.Th>메뉴 운영상태</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {menus.length ? menus.map((menu) => (
                  <Table.Tr
                    key={menu.menuid}
                    className={menu.useyn === 'Y' ? '' : classes.inactiveMenuRow}
                    title={menu.useyn === 'Y' ? undefined : '전역 메뉴 운영상태가 사용중지입니다. 사용자 권한과 별도로 유지됩니다.'}
                  >
                    <Table.Td className={classes.checkColumn}>
                      <Switch
                        size="xs"
                        color="red"
                        checked={selectedMenuSet.has(menu.menuid)}
                        disabled={!selectedUser}
                        onChange={(event) => toggleMenu(menu.menuid, event.currentTarget.checked)}
                        onClick={(event) => event.stopPropagation()}
                        aria-label={`${menu.menuname} 접근 허용`}
                      />
                    </Table.Td>
                    <Table.Td>{menu.menuid}</Table.Td>
                    <Table.Td>{menu.menuname}</Table.Td>
                    <Table.Td className={classes.statusColumn}>
                      <Badge size="sm" variant="light" color={menu.useyn === 'Y' ? 'teal' : 'gray'}>
                        {menu.useyn === 'Y' ? '사용중' : '사용중지'}
                      </Badge>
                    </Table.Td>
                  </Table.Tr>
                )) : (
                  <Table.Tr>
                    <Table.Td colSpan={4} className={classes.empty}>
                      {loadingMenus
                        ? '조회 중...'
                        : selectedUser
                          ? '권한을 부여할 수 있는 메뉴가 없습니다.'
                          : '왼쪽에서 사용자를 선택해 주세요.'}
                    </Table.Td>
                  </Table.Tr>
                )}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </Paper>
      </div>
    </Box>
  );
}
