// 사용자관리 (메뉴: USER_MANAGEMENT) — 자기 회사 사용자의 인사 기본정보(사원번호 · 근무유형 · 부서 · 직급 · 생년월일 · 연락처 · 입퇴사일 · 사진)를 입력한다.
// backend: routes/system/User_routes.py · services/system/User.py
// 계정 등록 · 삭제 · 권한 · 비밀번호 · 사용여부는 어드민 > 고객사관리에서 한다. 이름 · 아이디(이메일)는 보기만 한다.
// 화면 골격은 고객사관리(User.jsx)와 같고(왼쪽 직원 목록 · 오른쪽 기본정보), 모양은 파로스형 간결 디자인.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { apiErrorMessage } from '../../utils/apiError';
import { Box, Group, Pagination, Paper, ScrollArea, Select, Table, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import usePageReactivated from '../../components/common/usePageReactivated';
import useErpPageRibbon from '../../components/common/useErpPageRibbon';
import sharedClasses from '../../styles/pages/ManagementShared.module.css';
import simpleTheme from '../../styles/pages/SimpleTheme.module.css';
import codeClasses from '../../styles/pages/CodeMasterPage.module.css';
import classes from '../../styles/pages/User.module.css';
import own from '../../styles/pages/UserInfo.module.css';

const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });
const errorMessage = (error, fallback) => apiErrorMessage(error, fallback);

const WORKTYPE_LABELS = { REGULAR: '정규직', CONTRACT: '계약직' };
const STATUS_LABELS = { ACTIVE: '재직', RETIRED: '퇴사' };
const USER_COLUMNS = [
  { key: 'username', label: '이름', width: 90, minWidth: 60 },
  { key: 'empno', label: '사원번호', width: 90, minWidth: 60 },
  { key: 'team', label: '부서', width: 110, minWidth: 60 },
  { key: 'position', label: '직급', width: 80, minWidth: 50 },
  { key: 'worktype', label: '근무유형', width: 80, minWidth: 60 },
  { key: 'workstatus', label: '상태', width: 64, minWidth: 50 },
  { key: 'useyn', label: '계정사용', width: 76, minWidth: 60 },
];
const USEYN_FILTER = [{ value: '', label: '전체' }, { value: 'Y', label: '사용' }, { value: 'N', label: '중지' }];
const PAGE_SIZE_OPTIONS = [15, 20, 50, 100].map((value) => ({ value: String(value), label: `${value}개씩` }));
const PHOTO_MAX_BYTES = 500 * 1024;

const splitMobile = (value) => {
  const parts = String(value || '').split('-');
  return parts.length === 3 ? parts : ['', '', ''];
};
const toDraft = (item) => ({
  empno: item.empno || '',
  team: item.team || '',
  position: item.position || '',
  worktype: item.worktype || 'REGULAR',
  birthdate: item.birthdate || '',
  mobile: splitMobile(item.mobile),
  hiredate: item.hiredate || '',
  retiredate: item.retiredate || '',
  photo: item.photo || '',
});
const digitsOnly = (value, max) => String(value || '').replace(/\D/g, '').slice(0, max);

function Field({ label, required, children, wide }) {
  return (
    <>
      <span className={own.label}>{label}{required && <i className={own.required}>*</i>}</span>
      <div className={`${own.control} ${wide ? own.wide : ''}`}>{children}</div>
    </>
  );
}

export default function UserInfo() {
  const [users, setUsers] = useState([]);
  const [keyword, setKeyword] = useState('');
  const [useynFilter, setUseynFilter] = useState('');
  const [selectedEmail, setSelectedEmail] = useState('');
  const [detail, setDetail] = useState(null);
  const [draft, setDraft] = useState(null);
  const [photoChanged, setPhotoChanged] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [columnWidths, setColumnWidths] = useState({});
  const filterRef = useRef({ keyword: '', useyn: '' });
  filterRef.current = { keyword, useyn: useynFilter };
  const requestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const tableRef = useRef(null);
  const fileRef = useRef(null);

  const loadDetail = useCallback(async (email) => {
    const requestId = ++detailRequestRef.current;
    if (!email) { setDetail(null); setDraft(null); return; }
    try {
      const { data } = await axios.get('/api/users/detail', { ...authConfig(), params: { email } });
      if (requestId !== detailRequestRef.current) return;
      setDetail(data.item);
      setDraft(toDraft(data.item));
      setPhotoChanged(false);
    } catch (error) {
      if (requestId === detailRequestRef.current) notifications.show({ title: '상세 조회 실패', message: errorMessage(error, '사용자 정보를 불러오지 못했습니다.'), color: 'red' });
    }
  }, []);

  const load = useCallback(async (preferredEmail = '') => {
    const requestId = ++requestRef.current;
    setLoading(true);
    try {
      const { data } = await axios.get('/api/users', { ...authConfig(), params: filterRef.current });
      if (requestId !== requestRef.current) return;
      const rows = data.items || [];
      setUsers(rows);
      const index = rows.findIndex((row) => row.email === preferredEmail);
      const email = index >= 0 ? preferredEmail : '';
      setSelectedEmail(email);
      setPage(index >= 0 ? Math.floor(index / pageSize) + 1 : 1);
      void loadDetail(email);
    } catch (error) {
      if (requestId === requestRef.current) notifications.show({ title: '사용자 조회 실패', message: errorMessage(error, '사용자 목록을 불러오지 못했습니다.'), color: 'red' });
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [loadDetail, pageSize]);

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  usePageReactivated(() => { void load(selectedEmail); });

  const search = useCallback(() => { void load(selectedEmail); }, [load, selectedEmail]);

  const select = (row) => {
    if (row.email === selectedEmail) return;
    setSelectedEmail(row.email);
    setDetail(null);
    setDraft(null);
    void loadDetail(row.email);
  };

  const set = (key) => (event) => {
    const value = typeof event === 'object' && event?.currentTarget ? event.currentTarget.value : event;
    setDraft((current) => ({ ...current, [key]: value ?? '' }));
  };
  const setMobile = (index) => (event) => {
    const value = digitsOnly(event.currentTarget.value, index === 0 ? 3 : 4);
    setDraft((current) => ({ ...current, mobile: current.mobile.map((part, i) => (i === index ? value : part)) }));
  };

  const pickPhoto = (event) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      notifications.show({ title: '사진 등록', message: 'jpg, png 파일만 등록할 수 있습니다.', color: 'red' });
      return;
    }
    if (file.size > PHOTO_MAX_BYTES) {
      notifications.show({ title: '사진 등록', message: '사진은 500KB 이하로 올려 주세요.', color: 'red' });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => { setDraft((current) => ({ ...current, photo: String(reader.result || '') })); setPhotoChanged(true); };
    reader.readAsDataURL(file);
  };
  const removePhoto = () => { setDraft((current) => ({ ...current, photo: '' })); setPhotoChanged(true); };

  const handleSave = useCallback(async () => {
    if (!detail || !draft) return;
    const mobileParts = draft.mobile.map((part) => part.trim());
    const filled = mobileParts.filter(Boolean).length;
    if (filled && filled < 3) {
      notifications.show({ title: '저장 확인', message: '휴대폰번호를 세 칸 모두 입력해 주세요.', color: 'red' });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        email: detail.email,
        empno: draft.empno,
        team: draft.team,
        position: draft.position,
        worktype: draft.worktype,
        birthdate: draft.birthdate || null,
        mobile: filled ? mobileParts.join('-') : '',
        hiredate: draft.hiredate || null,
        retiredate: draft.retiredate || null,
        ...(photoChanged ? { photo: draft.photo } : {}),
      };
      const { data } = await axios.put('/api/users', payload, authConfig());
      notifications.show({ title: '저장 완료', message: `${data.item.username} 님의 정보를 저장했습니다.`, color: 'teal' });
      await load(data.item.email);
    } catch (error) {
      notifications.show({ title: '저장 실패', message: errorMessage(error, '사용자 정보를 저장하지 못했습니다.'), color: 'red' });
    } finally {
      setSaving(false);
    }
  }, [detail, draft, load, photoChanged]);

  useErpPageRibbon({
    onSearch: search,
    onSave: detail && draft && !saving ? handleSave : undefined,
    showPrint: false,
    showExcel: false,
    useSaveColor: false,
  });

  // 열 너비 조절: 입고등록 표와 같이 끈 열만 늘고 줄며, 표 전체 너비가 그만큼 바뀐다 (넘치면 가로 스크롤)
  const widthOf = (column) => columnWidths[column.key] ?? column.width;
  const tableWidth = USER_COLUMNS.reduce((sum, column) => sum + widthOf(column), 0);
  const resizeColumn = (event, column) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = widthOf(column);
    const table = tableRef.current;
    const col = table?.querySelector(`col[data-column-key="${column.key}"]`);
    let nextWidth = startWidth;
    const move = (pointerEvent) => {
      nextWidth = Math.max(column.minWidth, Math.min(1600, startWidth + pointerEvent.clientX - startX));
      if (col) col.style.width = `${nextWidth}px`;
      if (table) table.style.setProperty('--user-table-width', `${tableWidth + nextWidth - startWidth}px`);
    };
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      setColumnWidths((current) => ({ ...current, [column.key]: nextWidth }));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  };

  const pageCount = Math.max(1, Math.ceil(users.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pagedUsers = useMemo(() => users.slice((currentPage - 1) * pageSize, currentPage * pageSize), [currentPage, pageSize, users]);

  return (
    <Box className={`${simpleTheme.simple} ${simpleTheme.noIcons} ${sharedClasses.pageShell} ${classes.page}`}>
      <Box component="nav" className={classes.breadcrumb}>
        <Text component="span" className={classes.breadcrumbParent}>운영관리</Text>
        <Text component="span" className={classes.breadcrumbChevron}>›</Text>
        <Text component="span" className={classes.breadcrumbCurrent}>직원관리</Text>
      </Box>

      <div className={`${classes.workspace} ${own.workspace}`}>
        <Paper className={classes.listPanel} withBorder>
          <Group className={classes.panelHeader} gap={8} wrap="nowrap">
            <Text className={classes.sectionTitle} fw={700}>직원 목록</Text>
            <span className={own.count}>전체 {users.length.toLocaleString('ko-KR')}명</span>
          </Group>
          <div className={own.searchBar}>
            <TextInput className={own.keyword} placeholder="이름 · 사원번호 · 부서 · 직급" value={keyword}
              onChange={(event) => setKeyword(event.currentTarget.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') search(); }} />
            <label className={own.inlineLabel}>계정사용</label>
            <Select className={own.useynSelect} data={USEYN_FILTER} value={useynFilter} allowDeselect={false}
              onChange={(value) => { filterRef.current = { ...filterRef.current, useyn: value || '' }; setUseynFilter(value || ''); void load(selectedEmail); }} />
          </div>
          <ScrollArea className={classes.tableWrap} type="auto" scrollbars="xy">
            <Table ref={tableRef} className={`${sharedClasses.table} ${classes.table} ${own.userTable}`} style={{ '--user-table-width': `${tableWidth}px` }}>
              <colgroup>{USER_COLUMNS.map((column) => <col key={column.key} data-column-key={column.key} style={{ width: `${widthOf(column)}px` }} />)}</colgroup>
              <Table.Thead>
                <Table.Tr>
                  {USER_COLUMNS.map((column) => (
                    <Table.Th key={column.key} className={codeClasses.resizableHeader}>
                      <span style={{ whiteSpace: 'nowrap' }}>{column.label}</span>
                      <span className={codeClasses.columnResizeHandle} onPointerDown={(event) => resizeColumn(event, column)} role="separator" aria-label={`${column.label} 열 너비 조절`} />
                    </Table.Th>
                  ))}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {pagedUsers.length ? pagedUsers.map((row) => (
                  <Table.Tr key={row.email} className={`${selectedEmail === row.email ? classes.selectedRow : ''} ${row.useyn === 'Y' && row.workstatus === 'ACTIVE' ? '' : own.inactiveRow}`} onClick={() => select(row)}>
                    <Table.Td title={row.username}>{row.username}</Table.Td>
                    <Table.Td title={row.empno}>{row.empno}</Table.Td>
                    <Table.Td title={row.team}>{row.team}</Table.Td>
                    <Table.Td title={row.position}>{row.position}</Table.Td>
                    <Table.Td>{WORKTYPE_LABELS[row.worktype] || ''}</Table.Td>
                    <Table.Td>{STATUS_LABELS[row.workstatus] || ''}</Table.Td>
                    <Table.Td>{row.useyn === 'Y' ? '사용' : '중지'}</Table.Td>
                  </Table.Tr>
                )) : (
                  <Table.Tr className={classes.emptyRow}>
                    <Table.Td colSpan={USER_COLUMNS.length} className={classes.emptyCell}>
                      <div className={classes.empty}><strong>{loading ? '조회 중...' : '조회된 직원이 없습니다.'}</strong></div>
                    </Table.Td>
                  </Table.Tr>
                )}
              </Table.Tbody>
            </Table>
          </ScrollArea>
          <Group className={classes.paginationBar} justify="space-between" wrap="wrap">
            <Group gap="xs" wrap="nowrap">
              <Text component="span" className={classes.totalText}>총 <b>{users.length.toLocaleString('ko-KR')}</b>건</Text>
              <Select aria-label="페이지당 표시 건수" data={PAGE_SIZE_OPTIONS} value={String(pageSize)} w={96} size="xs" allowDeselect={false}
                onChange={(value) => { if (value) { setPageSize(Number(value)); setPage(1); } }} />
            </Group>
            <Pagination size="sm" color="red" withEdges value={currentPage} total={pageCount} onChange={setPage} disabled={loading || !users.length} />
          </Group>
        </Paper>

        <Paper className={classes.formPanel} withBorder>
          <div className={own.detailHead}>
            <h3>기본정보</h3>
            <span>이름 · 아이디 · 계정사용은 고객사관리에서 관리합니다.</span>
          </div>
          <ScrollArea className={own.detailBody} type="auto">
            {!selectedEmail && <div className={own.placeholder}>왼쪽 목록에서 직원을 선택하세요.</div>}
            {selectedEmail && !draft && <div className={own.placeholder}>불러오는 중...</div>}
            {detail && draft && (
              <div className={own.form}>
                <Field label="사진" wide>
                  <div className={own.photoRow}>
                    <div className={own.photoBox}>
                      {draft.photo ? <img src={draft.photo} alt={`${detail.username} 사진`} /> : <span>사진 없음</span>}
                    </div>
                    <div className={own.photoSide}>
                      <span className={own.photoSize}>120px × 160px</span>
                      <div className={own.photoButtons}>
                        <button type="button" className={own.lineButton} onClick={() => fileRef.current?.click()}>업로드</button>
                        {draft.photo && <button type="button" className={own.lineButton} onClick={removePhoto}>삭제</button>}
                      </div>
                      <span className={own.photoNote}>* jpg, png만 등록 가능합니다. (500KB 이하)</span>
                      <input ref={fileRef} type="file" accept="image/jpeg,image/png" hidden onChange={pickPhoto} />
                    </div>
                  </div>
                </Field>

                <Field label="근무유형" required wide>
                  <div className={own.radioRow}>
                    {Object.entries(WORKTYPE_LABELS).map(([value, label]) => (
                      <label key={value} className={own.radio}>
                        <input type="radio" name="worktype" value={value} checked={draft.worktype === value} onChange={() => set('worktype')(value)} />
                        {label}
                      </label>
                    ))}
                  </div>
                </Field>

                <Field label="이름"><TextInput aria-label="이름" value={detail.username} disabled /></Field>
                <Field label="사원번호"><TextInput aria-label="사원번호" value={draft.empno} onChange={set('empno')} maxLength={20} /></Field>

                <Field label="아이디"><TextInput aria-label="아이디" value={detail.email} disabled /></Field>
                <Field label="부서"><TextInput aria-label="부서" value={draft.team} onChange={set('team')} maxLength={50} /></Field>

                <Field label="직급"><TextInput aria-label="직급" value={draft.position} onChange={set('position')} maxLength={30} placeholder="예) 대리" /></Field>
                <Field label="휴대폰번호">
                  <div className={own.mobile}>
                    <TextInput aria-label="휴대폰 앞자리" value={draft.mobile[0]} onChange={setMobile(0)} inputMode="numeric" />
                    <span>-</span>
                    <TextInput aria-label="휴대폰 가운데" value={draft.mobile[1]} onChange={setMobile(1)} inputMode="numeric" />
                    <span>-</span>
                    <TextInput aria-label="휴대폰 끝자리" value={draft.mobile[2]} onChange={setMobile(2)} inputMode="numeric" />
                  </div>
                </Field>

                <Field label="생년월일"><TextInput aria-label="생년월일" type="date" value={draft.birthdate} onChange={set('birthdate')} /></Field>
                <span /><span />

                <Field label="입사일"><TextInput aria-label="입사일" type="date" value={draft.hiredate} onChange={set('hiredate')} /></Field>
                <Field label="퇴사일"><TextInput aria-label="퇴사일" type="date" value={draft.retiredate} onChange={set('retiredate')} min={draft.hiredate || undefined} /></Field>
              </div>
            )}
          </ScrollArea>
        </Paper>
      </div>
    </Box>
  );
}
