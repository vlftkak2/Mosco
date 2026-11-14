import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { apiErrorMessage } from '../../utils/apiError';
import usePageReactivated from '../../components/common/usePageReactivated';
import {
  Badge, Box, Checkbox, Group, Pagination, Paper, ScrollArea, Select, Table, Text, TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconBuilding, IconInbox, IconSearch, IconShieldLock, IconUsersGroup,
} from '@tabler/icons-react';
import { useLocation } from 'react-router-dom';
import useErpPageRibbon from '../../components/common/useErpPageRibbon';
import sharedClasses from '../../styles/pages/ManagementShared.module.css';
import { ColumnResizeHandle, pickerClasses, useResizableColumns } from '../../components/common/PickerModal';
import simpleTheme from '../../styles/pages/SimpleTheme.module.css';
import classes from '../../styles/pages/UserMenu.module.css';


const authConfig = () => ({
  headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` },
});

const errorMessage = (error, fallback) => apiErrorMessage(error, fallback);

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

const AUTHORITY_COLORS = { MASTER: 'red', SUBMASTER: 'indigo', USER: 'gray' };
const PAGE_SIZE_OPTIONS = [15, 20, 50, 100].map((value) => ({ value: String(value), label: `${value}개씩` }));
const DEFAULT_PAGE_SIZE = 15;

// 화면 표시용 묶음: 사이드 메뉴의 대메뉴 구성과 같은 순서 (권한 저장 값과는 무관)
const MENU_SECTIONS = [
  { label: '홈', menuids: ['HOME'] },
  { label: '매입', menuids: ['INBOUND_REGISTER', 'INBOUND_SEARCH'] },
  { label: '매출', menuids: ['OUTBOUND_REGISTER', 'OUTBOUND_SEARCH', 'GROSS_PROFIT', 'GROSS_PROFIT_DASHBOARD'] },
  {
    label: '가공',
    menuids: ['AI_ORDER_RECOGNITION', 'AI_ORDER_MANAGEMENT', 'AI_OPTIMIZATION', 'ITEM_PROCESS_MASTER', 'ITEM_PROCESS_REGISTER', 'ITEM_PROCESS_SEARCH'],
  },
  { label: '재고', menuids: ['STOCK_INITIAL', 'STOCK_CURRENT', 'STOCK_HISTORY', 'INOUTMOVE_REGISTER', 'INOUTMOVE_SEARCH'] },
  {
    label: '자금',
    menuids: ['RECEIPT_PAYMENT', 'RECEIPT_PAYMENT_SEARCH', 'INSTRUMENT_STATUS', 'CUSTOMER_LEDGER', 'CUSTOMER_BALANCE_DASHBOARD'],
  },
  { label: '게시판', menuids: ['CUSTOMER_SUPPORT'] },
  { label: '설정', menuids: ['DATA_CODE', 'DATA_ITEM', 'DATA_CUSTOMER', 'WORKPLACE_MANAGEMENT', 'MONTH_CLOSING', 'USER_MANAGEMENT'] },
];
const MENU_SECTION_BY_ID = Object.fromEntries(
  MENU_SECTIONS.flatMap((section, index) => section.menuids.map((menuid) => [menuid, index])),
);
const OTHER_SECTION_LABEL = '기타';


const MENU_USER_COLUMNS = [
  { key: 'username', label: '사용자명', width: 130 },
  { key: 'email', label: '이메일', width: 240 },
  { key: 'authority', label: '권한', width: 110 },
  { key: 'useyn', label: '사용여부', width: 90 },
];
const PERM_COLUMNS = [
  { key: 'menu', label: '메뉴', width: 240 },
  { key: 'access', label: '접근', width: 84, minWidth: 70 },
  { key: 'status', label: '운영상태', width: 88 },
  { key: 'created_by', label: '등록자', width: 90 },
  { key: 'updated_by', label: '수정자', width: 90 },
];

export default function UserMenu() {
  // 표 열: 머리글 오른쪽 끝을 끌어 너비 조절 (두 번 누르면 기본 너비)
  const userCols = useResizableColumns(MENU_USER_COLUMNS);
  const permCols = useResizableColumns(PERM_COLUMNS);
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
  const [userPage, setUserPage] = useState(1);
  const [userPageSize, setUserPageSize] = useState(DEFAULT_PAGE_SIZE);
  const userPageSizeRef = useRef(DEFAULT_PAGE_SIZE);

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
  const menuGroups = useMemo(() => {
    const groups = new Map();
    menus.forEach((menu) => {
      const index = MENU_SECTION_BY_ID[menu.menuid] ?? MENU_SECTIONS.length;
      if (!groups.has(index)) {
        groups.set(index, { key: index, label: MENU_SECTIONS[index]?.label || OTHER_SECTION_LABEL, items: [] });
      }
      groups.get(index).items.push(menu);
    });
    return Array.from(groups.values()).sort((a, b) => a.key - b.key);
  }, [menus]);
  const userPageCount = Math.max(1, Math.ceil(users.length / userPageSize));
  const currentUserPage = Math.min(userPage, userPageCount);
  const pagedUsers = useMemo(
    () => users.slice((currentUserPage - 1) * userPageSize, currentUserPage * userPageSize),
    [currentUserPage, userPageSize, users],
  );

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
      if (![401, 403].includes(error.response?.status)) {
        notifications.show({
          title: '고객사 조회 실패',
          message: errorMessage(error, '관리 가능한 고객사를 불러오지 못했습니다.'),
          color: 'red',
        });
      }
    } finally {
      setLoadingCompanies(false);
    }
  }, []);

  const loadUsers = useCallback(async (targetCompanyid, preferredEmail = '') => {
    if (!targetCompanyid) {
      setCompanyInfo(null);
      setUsers([]);
      setUserPage(1);
      setSelectedEmail('');
      return;
    }
    setLoadingUsers(true);
    setUsers([]);
    setUserPage(1);
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
      // 선택된 사용자가 있는 페이지를 보여준다
      const selectedIndex = selected ? rows.indexOf(selected) : -1;
      setUserPage(selectedIndex >= 0 ? Math.floor(selectedIndex / userPageSizeRef.current) + 1 : 1);
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

  // 탭에 돌아오면 지금 조건 그대로 다시 불러온다 (다른 탭에서 데이터가 바뀌었을 수 있음)
  usePageReactivated(() => { void loadCompanies(); });
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
      // 내 권한을 바꿨으면 왼쪽 메뉴도 바로 다시 읽는다
      if (selectedUser.email.toLowerCase() === String(localStorage.getItem('user_email') || '').toLowerCase()) {
        window.dispatchEvent(new Event('menu-permissions-changed'));
      }
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
    <Box className={`${simpleTheme.simple} ${simpleTheme.noIcons} ${sharedClasses.pageShell} ${classes.page}`}>
      <Box component="nav" className={classes.breadcrumb}>
        <Text component="span" className={classes.breadcrumbParent}>고객사정보</Text>
        <Text component="span" className={classes.breadcrumbChevron}>›</Text>
        <Text component="span" className={classes.breadcrumbCurrent}>고객사 메뉴권한</Text>
      </Box>

      <div className={classes.workspace}>
        <Paper className={classes.userPanel} withBorder>
          <Group className={classes.panelHeader} justify="space-between" wrap="nowrap">
            <Group gap={8} wrap="nowrap">
              <span className={classes.titleIcon}><IconUsersGroup size={15} /></span>
              <Text className={classes.sectionTitle}>사용자 목록</Text>
              <Badge className={classes.countBadge} variant="light" color="gray" radius="sm">{users.length.toLocaleString('ko-KR')}건</Badge>
            </Group>
            {selectedCompany && (
              <Badge
                variant="light"
                radius="sm"
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
                leftSection={<IconBuilding size={15} />}
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
                leftSection={<IconBuilding size={15} />}
                value={selectedCompany ? `${selectedCompany.companyid} - ${selectedCompany.companyname}` : ''}
                readOnly
                disabled
              />
            )}
          </Group>

          <ScrollArea className={classes.tableWrap} type="always" scrollbars="xy" scrollbarSize={10}>
            <Table className={`${sharedClasses.table} ${classes.userTable}`} highlightOnHover style={{ width: `max(100%, ${userCols.tableWidth}px)` }}>
              <colgroup>{MENU_USER_COLUMNS.map((column) => <col key={column.key} data-column-key={column.key} style={{ width: userCols.widthOf(column) }} />)}</colgroup>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th className={pickerClasses.resizableHead}>사용자명<ColumnResizeHandle column={MENU_USER_COLUMNS[0]} columns={userCols} /></Table.Th>
                  <Table.Th className={pickerClasses.resizableHead}>이메일<ColumnResizeHandle column={MENU_USER_COLUMNS[1]} columns={userCols} /></Table.Th>
                  <Table.Th className={pickerClasses.resizableHead}>권한<ColumnResizeHandle column={MENU_USER_COLUMNS[2]} columns={userCols} /></Table.Th>
                  <Table.Th className={pickerClasses.resizableHead}>사용여부<ColumnResizeHandle column={MENU_USER_COLUMNS[3]} columns={userCols} /></Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {pagedUsers.length ? pagedUsers.map((user) => (
                  <Table.Tr
                    key={`${user.companyid}:${user.email}`}
                    className={selectedEmail === user.email ? classes.selectedRow : ''}
                    onClick={() => setSelectedEmail(user.email)}
                  >
                    <Table.Td className={classes.nameCell} title={user.username}>{user.username}</Table.Td>
                    <Table.Td title={user.email}>{user.email}</Table.Td>
                    <Table.Td>
                      <Badge size="sm" variant="light" radius="sm" color={AUTHORITY_COLORS[user.authority] || 'gray'}>
                        {AUTHORITY_LABELS[user.authority] || user.authority}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Badge size="sm" variant="light" color={user.useyn === 'Y' ? 'teal' : 'gray'}>
                        {user.useyn === 'Y' ? '사용중' : '사용중지'}
                      </Badge>
                    </Table.Td>
                  </Table.Tr>
                )) : (
                  <Table.Tr className={classes.emptyRow}>
                    <Table.Td colSpan={4} className={classes.emptyCell}>
                      <div className={classes.empty}>
                        <span className={classes.emptyIcon}>
                          {loadingUsers ? <IconSearch size={20} /> : !companyid ? <IconBuilding size={20} /> : <IconInbox size={22} />}
                        </span>
                        <strong>
                          {loadingUsers
                            ? '조회 중...'
                            : !companyid
                              ? '고객사를 선택해 주세요.'
                              : isPlatformMaster && companyid === '001'
                                ? '플랫폼 관리자 계정은 전체 메뉴 권한이 있어 개별 설정 대상이 아닙니다.'
                                : isPlatformMaster
                                  ? '선택한 고객사에 메뉴 권한을 관리할 계정이 없습니다.'
                                  : '등록된 계정이 없습니다. 고객사관리에서 계정을 추가해 주세요.'}
                        </strong>
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
                value={String(userPageSize)}
                w={96}
                size="xs"
                allowDeselect={false}
                onChange={(value) => {
                  if (!value) return;
                  userPageSizeRef.current = Number(value);
                  setUserPageSize(Number(value));
                  setUserPage(1);
                }}
              />
            </Group>
            <Pagination size="sm" color="red" withEdges value={currentUserPage} total={userPageCount} onChange={setUserPage} disabled={loadingUsers || !users.length} />
          </Group>
        </Paper>

        <Paper className={classes.menuPanel} withBorder>
          <Group className={classes.panelHeader} justify="space-between" wrap="nowrap">
            <Group gap={8} wrap="nowrap">
              <span className={classes.titleIcon}><IconShieldLock size={15} /></span>
              <Text className={classes.sectionTitle}>메뉴 권한</Text>
              <Badge className={classes.countBadge} variant="light" color={selectedMenuids.length ? 'red' : 'gray'} radius="sm">{selectedMenuids.length} / {menus.length}</Badge>
            </Group>
            {selectedUser && (
              <Group gap={7} wrap="nowrap" className={classes.selectedUserInfo}>
                <Text className={classes.selectedUser} title={selectedUser.email}>
                  <b>{selectedUser.username}</b> · {selectedUser.email}
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

          <Group className={classes.permissionBar} justify="flex-end" wrap="nowrap">
            <Text className={classes.permissionHint}>※ 수정 후 위쪽 [저장]을 눌러 주세요. 선택한 사용자 권한만 바뀝니다.</Text>
          </Group>

          {/* 권한 표 (파로스 권한관리 모양): 머리글 체크로 모든 메뉴를 한 번에 체크 */}
          <ScrollArea className={classes.tableWrap} type="auto">
            <Table className={`${sharedClasses.table} ${classes.menuTable} ${classes.permMatrix}`} style={{ width: `max(100%, ${permCols.tableWidth}px)` }}>
              <colgroup>{PERM_COLUMNS.map((column) => <col key={column.key} data-column-key={column.key} style={{ width: permCols.widthOf(column) }} />)}</colgroup>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th className={pickerClasses.resizableHead}>메뉴<ColumnResizeHandle column={PERM_COLUMNS[0]} columns={permCols} /></Table.Th>
                  <Table.Th className={`${pickerClasses.resizableHead} ${classes.checkColumn}`}>
                    <span className={classes.headCheck}>
                      <Checkbox size="xs" color="red" radius={3} aria-label="모든 메뉴 접근 허용"
                        checked={allSelected} indeterminate={partiallySelected} disabled={!selectedUser || menus.length === 0}
                        onChange={(event) => setSelectedMenuids(event.currentTarget.checked ? menus.map((menu) => menu.menuid) : [])} />
                      접근
                    </span>
                    <ColumnResizeHandle column={PERM_COLUMNS[1]} columns={permCols} />
                  </Table.Th>
                  <Table.Th className={`${pickerClasses.resizableHead} ${classes.statusColumn}`}>운영상태<ColumnResizeHandle column={PERM_COLUMNS[2]} columns={permCols} /></Table.Th>
                  <Table.Th className={pickerClasses.resizableHead}>등록자<ColumnResizeHandle column={PERM_COLUMNS[3]} columns={permCols} /></Table.Th>
                  <Table.Th className={pickerClasses.resizableHead}>수정자<ColumnResizeHandle column={PERM_COLUMNS[4]} columns={permCols} /></Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {menus.length ? menuGroups.map((group) => {
                  const grantedCount = group.items.filter((menu) => selectedMenuSet.has(menu.menuid)).length;
                  return [
                    <Table.Tr key={`group:${group.key}`} className={classes.groupRow}>
                      <Table.Td><span className={classes.groupLabel}>{group.label}</span><span className={classes.groupCount}>{grantedCount} / {group.items.length}</span></Table.Td>
                      <Table.Td />
                      <Table.Td /><Table.Td /><Table.Td />
                    </Table.Tr>,
                    ...group.items.map((menu) => (
                      <Table.Tr
                        key={menu.menuid}
                        className={`${menu.useyn === 'Y' ? '' : classes.inactiveMenuRow}`}
                        title={menu.useyn === 'Y' ? undefined : '전역 메뉴 운영상태가 사용중지입니다. 사용자 권한과 별도로 유지됩니다.'}
                      >
                        <Table.Td className={classes.nameCell} title={menu.menuname}><span className={classes.treeMark}>└</span>{menu.menuname}</Table.Td>
                        <Table.Td className={classes.checkColumn}>
                          <Checkbox size="xs" color="red" radius={3}
                            checked={selectedMenuSet.has(menu.menuid)}
                            disabled={!selectedUser}
                            onChange={(event) => toggleMenu(menu.menuid, event.currentTarget.checked)}
                            onClick={(event) => event.stopPropagation()}
                            aria-label={`${menu.menuname} 접근 허용`} />
                        </Table.Td>
                        <Table.Td className={`${classes.statusColumn} ${menu.useyn === 'Y' ? classes.statusOn : classes.statusOff}`}>{menu.useyn === 'Y' ? '사용중' : '사용중지'}</Table.Td>
                        <Table.Td className={classes.auditCell} title={menu.created_by || ''}>{menu.created_by || ''}</Table.Td>
                        <Table.Td className={classes.auditCell} title={menu.updated_by || ''}>{menu.updated_by || ''}</Table.Td>
                      </Table.Tr>
                    )),
                  ];
                }) : (
                  <Table.Tr className={classes.emptyRow}>
                    <Table.Td colSpan={PERM_COLUMNS.length} className={classes.emptyCell}>
                      <div className={classes.empty}>
                        <strong>
                          {loadingMenus
                            ? '조회 중...'
                            : selectedUser
                              ? '권한을 부여할 수 있는 메뉴가 없습니다.'
                              : '왼쪽에서 사용자를 선택해 주세요.'}
                        </strong>
                      </div>
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
