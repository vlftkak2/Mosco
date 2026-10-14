import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Group,
  Loader,
  Modal,
  Pagination,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconCheck,
  IconChevronRight,
  IconDeviceFloppy,
  IconDownload,
  IconPlus,
  IconSearch,
  IconTrash,
  IconUpload,
} from '@tabler/icons-react';
import * as XLSX from 'xlsx';
import sharedClasses from '../styles/pages/ManagementShared.module.css';
import classes from '../styles/pages/CodeMasterPage.module.css';
import dashboardClasses from '../styles/pages/HomePage.module.css';

// 공통코드 API는 로그인 토큰으로 보호되므로 모든 요청에 인증 헤더를 붙입니다.
const authHeaders = () => ({
  Authorization: `Bearer ${localStorage.getItem('access_token') || ''}`,
});

// FastAPI 검증 오류와 일반 서버 오류를 사용자가 읽을 수 있는 문장으로 정리합니다.
const errorMessage = (error) => {
  const detail = error.response?.data?.detail;
  if (Array.isArray(detail)) return detail.map((item) => item.msg || String(item)).join(', ');
  return detail || error.response?.data?.message || error.message || '공통코드 요청에 실패했습니다.';
};

// 서버와 같은 고정 그룹 목록입니다. DB에 항목이 없어도 그룹은 화면에 표시합니다.
const FIXED_GROUPS = [
  { groupcode: 'MATERIAL', name: '강종' },
  { groupcode: 'PROCESS', name: '공정' },
  { groupcode: 'OTHER_COST', name: '기타비용' },
  { groupcode: 'WAREHOUSE', name: '창고' },
  { groupcode: 'SURFACE', name: '표면' },
  { groupcode: 'DELIVERY', name: '착지' },
  { groupcode: 'TRADE_TYPE', name: '거래구분' },
];

// 최초 렌더와 조회 응답 정규화에 사용할 빈 그룹 상태를 생성합니다.
const emptyGroups = () => FIXED_GROUPS.map(({ groupcode, name }) => ({
  id: groupcode,
  groupcode,
  name,
  description: `${name} 회사 공통 코드`,
  rows: [],
}));

// 숫자 코드의 최댓값에 1을 더하고 기존 자릿수(최소 3자리)를 보존합니다.
const nextCode = (rows) => {
  const numericCodes = rows.map((row) => row.code).filter((code) => /^\d+$/.test(code || ''));
  const maxCode = numericCodes.reduce((max, code) => Math.max(max, Number(code)), 0);
  const width = Math.max(3, ...numericCodes.map((code) => code.length));
  return String(maxCode + 1).padStart(width, '0');
};

const PAGE_SIZE_OPTIONS = [
  { value: '15', label: '15개씩' },
  { value: '50', label: '50개씩' },
  { value: '100', label: '100개씩' },
  { value: '200', label: '200개씩' },
];

// 현재 페이지에서 보이는 행만 렌더링하고, 일반 코드 수정 시에는 변경된 행만 다시 렌더링합니다.
const CodeMasterTableRow = memo(function CodeMasterTableRow({ row, index, selected, disabled, saving, onToggleSelection, onUpdateRow, onDelete }) {
  return (
    <Table.Tr className={row.isNew ? classes.newRow : ''}>
      <Table.Td className={classes.checkCol}><input aria-label={`${row.name || '새 코드'} 선택`} type="checkbox" checked={selected} onChange={() => onToggleSelection(row.id)} /></Table.Td>
      <Table.Td className={classes.rowNumber}>{index + 1}</Table.Td>
      <Table.Td><TextInput aria-label="코드" value={row.code} disabled={!row.isNew || disabled} onChange={(event) => onUpdateRow(row.id, 'code', event.currentTarget.value)} placeholder="코드" size="sm" /></Table.Td>
      <Table.Td><TextInput aria-label="코드명" value={row.name} disabled={disabled} onChange={(event) => onUpdateRow(row.id, 'name', event.currentTarget.value)} placeholder="코드명 입력" size="sm" /></Table.Td>
      <Table.Td><TextInput aria-label="정렬 순서" type="number" min={0} value={String(row.order)} disabled={disabled} onChange={(event) => onUpdateRow(row.id, 'order', Number(event.currentTarget.value))} size="sm" /></Table.Td>
      <Table.Td>
        <Select
          className={classes.statusSelect}
          aria-label={`${row.code} 사용 여부`}
          data={[{ value: 'Y', label: '사용' }, { value: 'N', label: '미사용' }]}
          value={row.use ? 'Y' : 'N'}
          onChange={(value) => onUpdateRow(row.id, 'use', value === 'Y')}
          size="xs"
          allowDeselect={false}
          disabled={saving || disabled}
        />
      </Table.Td>
      <Table.Td><Tooltip label="코드 삭제"><ActionIcon variant="subtle" color="red" aria-label="코드 삭제" disabled={saving || disabled} onClick={() => onDelete(row)}><IconTrash size={16} /></ActionIcon></Tooltip></Table.Td>
    </Table.Tr>
  );
});

export default function CodeMasterPage() {
  // groups에는 서버 자료와 아직 저장하지 않은 편집 내용이 함께 들어갑니다.
  // selectedRows는 행 id 목록이며, deleteRequest는 삭제 확인 모달의 대상입니다.
  const [groups, setGroups] = useState(emptyGroups);
  const [selectedId, setSelectedId] = useState('');
  const [groupQuery, setGroupQuery] = useState('');
  const [codeQuery, setCodeQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [selectedRows, setSelectedRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [exportLoading, setExportLoading] = useState(false);
  const [deleteRequest, setDeleteRequest] = useState(null);
  const uploadInputRef = useRef(null);

  // 서버에서 그룹 전체를 다시 받아 로컬 편집 상태를 동기화합니다.
  // 저장/삭제 후 호출될 때는 작업한 그룹을 계속 선택하도록 코드값을 받습니다.
  const loadGroups = useCallback(async (selectGroupCode = '') => {
    setLoading(true);
    try {
      const { data } = await axios.get('/api/code-master/groups', { headers: authHeaders() });
      const responseGroups = new Map((data.groups || []).map((group) => [group.groupcode, group]));
      const loadedGroups = FIXED_GROUPS.map(({ groupcode, name }) => {
        const group = responseGroups.get(groupcode);
        return {
          id: groupcode,
          groupcode,
          name,
          description: group?.description || `${name} 회사 공통 코드`,
          rows: (group?.rows || []).map((row) => ({ ...row, isNew: false, isDirty: false })),
        };
      });
      setGroups(loadedGroups);
      setSelectedId((current) => {
        if (selectGroupCode && loadedGroups.some((group) => group.groupcode === selectGroupCode)) return selectGroupCode;
        if (loadedGroups.some((group) => group.groupcode === current)) return current;
        return loadedGroups[0]?.groupcode || '';
      });
      setSelectedRows([]);
    } catch (error) {
      notifications.show({ title: '공통코드에 데이터 0건', color: 'red' });
    } finally {
      setLoading(false);
    }
  }, []);

  // CustomerPage와 같은 방식으로 업로드용 엑셀 템플릿을 내려받습니다.
  const downloadTemplate = useCallback(() => {
    const headers = ['그룹코드', '코드명', '정렬순서', '사용여부(Y/N)', '설명'];
    const worksheet = XLSX.utils.aoa_to_sheet([
      headers,
      ['강종', '001', 1, 'Y', '설명을 입력 해주세요'],
    ]);
    worksheet['!cols'] = [48, 28, 14, 18, 36].map((wch) => ({ wch }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '공통코드');
    XLSX.writeFile(workbook, '공통코드_일괄등록_샘플.xlsx');
  }, []);

  // 현재 조회된 전체 고정 그룹을 CustomerPage처럼 XLSX 워크북으로 내보냅니다.
  const exportCodes = useCallback(() => {
    setExportLoading(true);
    try {
      const headers = ['그룹코드', '그룹명', '코드', '코드명', '정렬순서', '사용여부(Y/N)', '설명'];
      const worksheet = XLSX.utils.aoa_to_sheet([
        headers,
        ...groups.flatMap((group) => group.rows.map((row) => [
          group.groupcode,
          group.name,
          row.code ?? '',
          row.name ?? '',
          Number(row.order) || 0,
          row.use ? 'Y' : 'N',
          row.description ?? '',
        ])),
      ]);
      worksheet['!cols'] = [20, 18, 18, 28, 14, 18, 36].map((wch) => ({ wch }));
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, '공통코드목록');
      const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
      XLSX.writeFile(workbook, `공통코드목록_${date}.xlsx`);
      const total = groups.reduce((sum, group) => sum + group.rows.length, 0);
      notifications.show({ title: '엑셀 다운로드 완료', message: `${total.toLocaleString()}건을 저장했습니다.`, color: 'teal', position: 'bottom-right' });
    } catch (error) {
      notifications.show({ title: '엑셀 다운로드 실패', message: errorMessage(error), color: 'red', position: 'bottom-right' });
    } finally {
      setExportLoading(false);
    }
  }, [groups]);

  // 첫 번째 시트의 행을 검증한 다음 고정 그룹별로 나눠 기존 일괄 저장 API에 등록합니다.
  const uploadCodes = useCallback(async (event) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;

    const hasPendingChanges = groups.some((group) => group.rows.some((row) => row.isNew || row.isDirty));
    if (hasPendingChanges) {
      notifications.show({ title: '저장되지 않은 변경 사항', message: '현재 화면의 변경 사항을 먼저 저장한 뒤 엑셀을 등록해 주세요.', color: 'orange', position: 'bottom-right' });
      return;
    }

    setUploadProgress('엑셀 파일 읽는 중');
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!sheet) throw new Error('엑셀 첫 번째 시트를 확인해 주세요.');
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      if (rows.length > 10000) throw new Error('한 번에 최대 10,000행까지 등록할 수 있습니다.');

      const normalizeKey = (value) => String(value).trim().toLowerCase().replace(/\s+/g, '');
      const aliases = {
        groupcode: ['groupcode', '그룹코드', '그룹 코드', '그룹', '그룹명'],
        code: ['code', '코드', '코드값'],
        codename: ['codename', '코드명', '코드 이름'],
        sortorder: ['sortorder', '정렬순서', '정렬 순서', '순서'],
        use: ['use', '사용여부', '사용 여부', 'use_yn'],
        description: ['description', '설명', '비고'],
      };
      const groupByName = new Map(FIXED_GROUPS.map((group) => [normalizeKey(group.name), group.groupcode]));
      const normalizedRows = rows.map((row, index) => {
        const cells = Object.fromEntries(Object.entries(row).map(([key, value]) => [normalizeKey(key), String(value).trim()]));
        const valueFor = (field) => {
          const alias = aliases[field].find((name) => cells[normalizeKey(name)] !== undefined);
          return alias ? cells[normalizeKey(alias)] : '';
        };
        const groupValue = valueFor('groupcode');
        const groupcode = FIXED_GROUPS.find((group) => normalizeKey(group.groupcode) === normalizeKey(groupValue))?.groupcode
          || groupByName.get(normalizeKey(groupValue))
          || '';
        const useValue = valueFor('use').toUpperCase();
        const sortText = valueFor('sortorder');
        const sortorder = sortText === '' ? 0 : Number(sortText);
        return {
          excelRow: index + 2,
          groupcode,
          code: valueFor('code'),
          codename: valueFor('codename'),
          sortorder,
          use: useValue === '' || useValue === 'Y' || useValue === '사용' || useValue === '사용함',
          useValue,
          description: valueFor('description'),
        };
      }).filter((row) => row.groupcode || row.code || row.codename);

      if (!normalizedRows.length) throw new Error('업로드할 데이터가 없습니다. 샘플 양식의 첫 번째 시트를 확인해 주세요.');
      const failures = [];
      const candidates = [];
      const seen = new Set();
      let excludedCount = 0;
      normalizedRows.forEach((row) => {
        const rowErrors = [];
        if (!row.groupcode) rowErrors.push('그룹코드 확인 필요');
        if (!row.codename) rowErrors.push('코드명 필수');
        if (!Number.isInteger(row.sortorder) || row.sortorder < 0 || row.sortorder > 2_147_483_647) rowErrors.push('정렬순서는 0 이상의 정수여야 함');
        if (row.useValue && !['Y', 'N', '사용', '미사용', '사용함', '사용안함'].includes(row.useValue)) rowErrors.push('사용여부는 Y 또는 N이어야 함');
        const key = row.code ? `${row.groupcode}:${row.code}` : '';
        if (key && seen.has(key)) rowErrors.push('엑셀 파일 안에 코드 중복');
        if (row.groupcode && row.code && groups.find((group) => group.groupcode === row.groupcode)?.rows.some((item) => item.code === row.code)) {
          rowErrors.push('이미 등록된 코드');
        }
        if (rowErrors.length) {
          excludedCount += 1;
          failures.push(`${row.excelRow}행: ${rowErrors.join(', ')}`);
        }
        else {
          if (key) seen.add(key);
          candidates.push(row);
        }
      });

      let inserted = 0;
      const occupiedByGroup = new Map(groups.map((group) => [
        group.groupcode,
        new Set([
          ...group.rows.map((row) => row.code),
          ...candidates.filter((row) => row.groupcode === group.groupcode && row.code).map((row) => row.code),
        ]),
      ]));
      const readyCandidates = candidates.map((row) => {
        const occupied = occupiedByGroup.get(row.groupcode);
        let code = row.code;
        if (!code) {
          code = nextCode([...occupied].map((value) => ({ code: value })));
          while (occupied.has(code)) {
            occupied.add(code);
            code = nextCode([...occupied].map((value) => ({ code: value })));
          }
        }
        occupied.add(code);
        return { ...row, code };
      });
      const groupCodes = [...new Set(readyCandidates.map((row) => row.groupcode))];
      for (const [groupIndex, groupcode] of groupCodes.entries()) {
        const groupRows = readyCandidates.filter((row) => row.groupcode === groupcode);
        const chunks = [];
        for (let offset = 0; offset < groupRows.length; offset += 1000) chunks.push(groupRows.slice(offset, offset + 1000));
        for (const [chunkIndex, chunk] of chunks.entries()) {
          setUploadProgress(`${inserted.toLocaleString()}건 서버 등록 중`);
          try {
            await axios.put(`/api/code-master/groups/${encodeURIComponent(groupcode)}`, {
              items: chunk.map(({ code, codename, sortorder, use, description }) => ({
                code, codename, sortorder, use, description, is_new: true,
              })),
            }, { headers: authHeaders() });
            inserted += chunk.length;
          } catch (error) {
            const detail = errorMessage(error);
            excludedCount += chunk.length;
            failures.push(`${groupcode} 그룹 ${chunk[0].excelRow}~${chunk[chunk.length - 1].excelRow}행: ${detail}`);
          }
        }
      }

      if (inserted) await loadGroups(selectedId);
      notifications.show({
        title: inserted === 0 && failures.length ? '일괄 등록 중단' : failures.length ? '일괄 등록 완료 (일부 제외)' : '일괄 등록 완료',
        message: `${inserted}건 등록${failures.length ? `, ${excludedCount}건 제외: ${failures.slice(0, 3).join(' / ')}` : ''}`,
        color: failures.length ? 'orange' : 'teal',
        position: 'bottom-right',
        autoClose: 7000,
      });
    } catch (error) {
      notifications.show({ title: '엑셀 업로드 실패', message: errorMessage(error), color: 'red', position: 'bottom-right' });
    } finally {
      setUploadProgress('');
    }
  }, [groups, loadGroups, selectedId]);

  useEffect(() => {
    // 화면 진입 시 인증된 사용자의 회사 공통코드를 최초 조회합니다.
    loadGroups();
  }, [loadGroups]);

  // 그룹/코드 검색은 표시용 목록만 필터링하며 원본 groups 데이터는 유지합니다.
  const selectedGroup = groups.find((group) => group.groupcode === selectedId) || null;
  const visibleGroups = useMemo(
    () => groups.filter((group) => group.name.toLowerCase().includes(groupQuery.trim().toLowerCase())),
    [groups, groupQuery],
  );
  const visibleRows = useMemo(() => (selectedGroup?.rows || []).filter((row) =>
    `${row.code} ${row.name}`.toLowerCase().includes(codeQuery.trim().toLowerCase())), [selectedGroup, codeQuery]);
  const pageCount = Math.max(1, Math.ceil(visibleRows.length / pageSize));
  const offset = (page - 1) * pageSize;
  const pageRows = useMemo(() => visibleRows.slice(offset, offset + pageSize), [visibleRows, offset, pageSize]);
  const totalCodes = groups.reduce((sum, group) => sum + group.rows.length, 0);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  // 선택된 그룹에서 지정 행의 한 필드만 불변 방식으로 갱신합니다.
  const updateRow = useCallback((rowId, key, value) => {
    setGroups((current) => current.map((group) => group.groupcode !== selectedId ? group : {
      ...group,
      rows: group.rows.map((row) => row.id === rowId ? { ...row, [key]: value, isDirty: !row.isNew } : row),
    }));
  }, [selectedId]);

  // 정렬 순서는 현재 최댓값 다음으로, 코드는 다음 숫자값으로 새 행을 만듭니다.
  const addRow = () => {
    if (!selectedGroup) return;
    const nextOrder = Math.max(0, ...selectedGroup.rows.map((row) => Number(row.order) || 0)) + 1;
    const id = `new-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setGroups((current) => current.map((group) => group.groupcode === selectedId
      ? { ...group, rows: [...group.rows, { id, code: nextCode(group.rows), name: '', order: nextOrder, use: true, description: '', isNew: true }] }
      : group));
    setSelectedRows([]);
    setCodeQuery('');
    setPage(Math.max(1, Math.ceil((selectedGroup.rows.length + 1) / pageSize)));
  };

  // 확인된 대상 중 저장된 코드는 서버에서, 미저장 행은 화면 상태에서 삭제합니다.
  const confirmDelete = async () => {
    const targets = deleteRequest?.rows || [];
    if (!targets.length) return;
    const savedCodes = targets.filter((row) => !row.isNew).map((row) => row.code);
    const newIds = new Set(targets.filter((row) => row.isNew).map((row) => row.id));
    setSaving(true);
    try {
      if (savedCodes.length) {
        await axios.post(`/api/code-master/groups/${encodeURIComponent(deleteRequest.groupcode)}/items/delete`, { codes: savedCodes }, { headers: authHeaders() });
      }
      if (newIds.size) {
        setGroups((current) => current.map((group) => group.groupcode !== deleteRequest.groupcode
          ? group
          : { ...group, rows: group.rows.filter((row) => !newIds.has(row.id)) }));
      }
      if (savedCodes.length) await loadGroups(deleteRequest.groupcode);
      else setSelectedRows([]);
      notifications.show({ title: '삭제 완료', message: `공통코드 ${targets.length}건을 삭제했습니다.`, color: 'teal' });
      setDeleteRequest(null);
    } catch (error) {
      notifications.show({ title: '삭제 실패', message: errorMessage(error), color: 'red' });
    } finally {
      setSaving(false);
    }
  };

  // 실제 삭제는 모달에서 사용자가 확인한 뒤 수행되도록 대상만 기록합니다.
  const requestDeleteRow = useCallback((row) => setDeleteRequest({ groupcode: selectedId, rows: [row] }), [selectedId]);
  const requestDeleteSelected = () => {
    // 행마다 배열 includes를 반복하지 않고, 선택 id Set으로 한 번에 확인합니다.
    const rows = selectedGroup?.rows.filter((row) => selectedRowIds.has(row.id)) || [];
    if (rows.length) setDeleteRequest({ groupcode: selectedId, rows });
  };

  // 현재 그룹 전체를 API에 전송합니다. 서버는 is_new로 생성/갱신을 구분합니다.
  const saveRows = async () => {
    if (!selectedGroup) return;
    const trimmedCodes = selectedGroup.rows.map((row) => row.code.trim());
    const invalid = selectedGroup.rows.some((row) => !row.code.trim() || !row.name.trim());
    if (invalid) {
      notifications.show({ title: '입력값을 확인해 주세요', message: '코드와 코드명은 필수 항목입니다.', color: 'orange' });
      return;
    }
    if (new Set(trimmedCodes).size !== trimmedCodes.length) {
      notifications.show({ title: '코드 중복', message: '같은 그룹 안에서 코드는 중복될 수 없습니다.', color: 'orange' });
      return;
    }

    setSaving(true);
    try {
      await axios.put(`/api/code-master/groups/${encodeURIComponent(selectedGroup.groupcode)}`, {
        items: selectedGroup.rows.map((row) => ({
          code: row.code.trim(),
          codename: row.name.trim(),
          sortorder: Number(row.order) || 0,
          use: Boolean(row.use),
          description: row.description || '',
          is_new: Boolean(row.isNew),
        })),
      }, { headers: authHeaders() });
      await loadGroups(selectedGroup.groupcode);
      notifications.show({ title: '저장 완료', message: '공통코드가 저장되었습니다.', color: 'teal', icon: <IconCheck size={16} /> });
    } catch (error) {
      notifications.show({ title: '저장 실패', message: errorMessage(error), color: 'red' });
    } finally {
      setSaving(false);
    }
  };

  // 체크 상태를 행 id 집합처럼 토글해 선택 삭제에 사용합니다.
  const toggleRowSelection = useCallback((rowId) => setSelectedRows((current) => current.includes(rowId)
    ? current.filter((id) => id !== rowId)
    : [...current, rowId]), []);
  const selectedRowIds = useMemo(() => new Set(selectedRows), [selectedRows]);
  const toggleCurrentPageSelection = (checked) => {
    const currentPageIds = new Set(pageRows.map((row) => row.id));
    setSelectedRows((current) => {
      const next = new Set(current);
      currentPageIds.forEach((id) => (checked ? next.add(id) : next.delete(id)));
      return [...next];
    });
  };
  const handlePageSizeChange = (value) => {
    setPageSize(Number(value) || 15);
    setPage(1);
  };

  // 좌측 그룹 탐색, 우측 코드 편집 표, 하단 삭제 확인 모달로 구성됩니다.
  return (
    <Box className={`${sharedClasses.pageShell} ${classes.page}`}>
      <Paper className={dashboardClasses.dashboardHeader}>
        <Box className={dashboardClasses.headerCopy}>
          <Text className={sharedClasses.breadcrumb}>시스템 관리 <span>›</span> 기준정보 관리</Text>
          <Title order={1} className={dashboardClasses.pageTitle}>일반코드 <span>관리</span></Title>
          <Text className={dashboardClasses.pageSubtitle}>회사에서 공통으로 사용하는 코드 그룹과 코드 항목을 관리합니다.</Text>
          <Group className={dashboardClasses.sampleNotice} gap={8}>
            <span className={dashboardClasses.statusDot} />
            <Text size="xs">System Active</Text>
          </Group>
        </Box>
      </Paper>

      <div className={classes.workspace}>
        <Paper className={`${sharedClasses.panel} ${classes.groupPanel}`} withBorder>
          <Group className={`${sharedClasses.panelHeader} ${classes.groupHeader}`} justify="space-between" align="center">
            <Box><Text fw={700}>코드 그룹</Text><Text size="xs" c="dimmed" mt={3}>종류별 공통코드를 선택하세요</Text></Box>
            <Badge color="gray" variant="light">{groups.length}개</Badge>
          </Group>
          <TextInput
            className={classes.groupSearch}
            placeholder="그룹 검색"
            aria-label="코드 그룹 검색"
            leftSection={<IconSearch size={15} />}
            value={groupQuery}
            onChange={(event) => setGroupQuery(event.currentTarget.value)}
            size="sm"
          />
          <ScrollArea className={classes.groupList} type="always" scrollbarSize={6} offsetScrollbars="y">
            {loading ? <Box className={classes.loadingState}><Loader size="sm" color="red" /></Box> : visibleGroups.map((group) => (
              <button
                className={`${classes.groupItem} ${group.groupcode === selectedId ? classes.groupItemActive : ''}`}
                key={group.groupcode}
                onClick={() => { setSelectedId(group.groupcode); setCodeQuery(''); setSelectedRows([]); setPage(1); }}
                disabled={Boolean(uploadProgress)}
                type="button"
              >
                <span className={classes.groupItemCopy}>
                  <span className={classes.groupName}>{group.name}</span>
                  <span className={classes.groupMeta}>{group.rows.length}개 코드</span>
                </span>
                <IconChevronRight size={16} />
              </button>
            ))}
            {!loading && !visibleGroups.length && <Text className={classes.noGroups}>검색 결과가 없습니다.</Text>}
          </ScrollArea>
          <Group className={`${sharedClasses.footer} ${classes.groupFooter}`} justify="space-between">
            <Text size="xs" c="dimmed">전체 코드</Text><Text size="xs" fw={700}>{totalCodes}개</Text>
          </Group>
        </Paper>

        <Paper className={`${sharedClasses.panel} ${classes.codePanel}`} withBorder>
          <Group className={`${sharedClasses.panelHeader} ${classes.codeHeader}`} justify="space-between" align="flex-start" wrap="wrap" gap="sm">
            <Box>
              <Group gap={9} align="center"><Text className={classes.codeTitle}>{selectedGroup?.name || '코드 그룹'}</Text><Badge color="red" variant="light">{selectedGroup?.rows.length || 0}개</Badge></Group>
              <Text size="xs" c="dimmed" mt={5}>{selectedGroup?.description || (selectedGroup ? `${selectedGroup.groupcode} · 회사 공통 코드` : '그룹을 추가하거나 왼쪽에서 선택하세요.')}</Text>
            </Box>
            <Group gap={7}>
              <Button variant="default" size="xs" leftSection={<IconDownload size={14} />} onClick={downloadTemplate}>샘플양식</Button>
              <Button variant="light" size="xs" leftSection={<IconDownload size={14} />} onClick={exportCodes} loading={exportLoading} disabled={loading}>엑셀 다운로드</Button>
              <Button variant="default" size="sm" leftSection={<IconPlus size={15} />} onClick={addRow} disabled={!selectedGroup || loading || Boolean(uploadProgress)}>행 추가</Button>
              <Button color="red" size="sm" leftSection={<IconDeviceFloppy size={15} />} onClick={saveRows} loading={saving} disabled={!selectedGroup || loading || Boolean(uploadProgress)}>저장</Button>
            </Group>
          </Group>

          <Group className={`${sharedClasses.toolbar} ${classes.toolbar}`} justify="space-between" wrap="wrap" gap="sm">
            <TextInput
              className={classes.codeSearch}
              placeholder="코드 또는 코드명 검색"
              aria-label="코드 검색"
              leftSection={<IconSearch size={15} />}
              value={codeQuery}
              onChange={(event) => { setCodeQuery(event.currentTarget.value); setSelectedRows([]); setPage(1); }}
              size="sm"
              disabled={!selectedGroup}
            />
            <Group gap={7}>
              {selectedRows.length > 0 && <Text size="xs" c="dimmed">{selectedRows.length}개 선택</Text>}
              <Button variant="subtle" color="red" size="xs" leftSection={<IconTrash size={14} />} disabled={!selectedRows.length || saving || Boolean(uploadProgress)} onClick={requestDeleteSelected}>선택 삭제</Button>
              <Button size="xs" variant="light" leftSection={<IconUpload size={14} />} onClick={() => uploadInputRef.current?.click()} loading={Boolean(uploadProgress)} disabled={loading || saving}>
                {uploadProgress || '엑셀 일괄등록'}
              </Button>
              <input ref={uploadInputRef} type="file" accept=".xlsx,.xls" onChange={uploadCodes} hidden />
            </Group>
          </Group>

          <ScrollArea className={`${sharedClasses.tableWrap} ${classes.tableWrap}`} type="always" scrollbarSize={6} offsetScrollbars="y">
            <Table className={`${sharedClasses.table} ${classes.codeTable}`} highlightOnHover withTableBorder withColumnBorders={false} verticalSpacing="sm" horizontalSpacing="md">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th className={classes.checkCol}><input aria-label="현재 페이지 전체 선택" type="checkbox" checked={pageRows.length > 0 && pageRows.every((row) => selectedRowIds.has(row.id))} onChange={(event) => toggleCurrentPageSelection(event.currentTarget.checked)} /></Table.Th>
                  <Table.Th className={classes.numberCol}>No.</Table.Th>
                  <Table.Th className={classes.codeCol}>코드</Table.Th>
                  <Table.Th>코드명</Table.Th>
                  <Table.Th className={classes.orderCol}>정렬 순서</Table.Th>
                  <Table.Th className={classes.statusCol}>사용 여부</Table.Th>
                  <Table.Th className={classes.actionCol}>관리</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {pageRows.length ? pageRows.map((row, index) => (
                  <CodeMasterTableRow
                    key={row.id}
                    row={row}
                    index={offset + index}
                    selected={selectedRowIds.has(row.id)}
                    disabled={Boolean(uploadProgress)}
                    saving={saving}
                    onToggleSelection={toggleRowSelection}
                    onUpdateRow={updateRow}
                    onDelete={requestDeleteRow}
                  />
                )) : (
                  <Table.Tr><Table.Td colSpan={7} className={classes.emptyState}>표시할 코드가 없습니다.</Table.Td></Table.Tr>
                )}
              </Table.Tbody>
            </Table>
          </ScrollArea>

          <Group className={`${sharedClasses.footer} ${classes.tableFooter}`} justify="space-between" wrap="wrap">
            <Group gap="xs">
              <Text size="xs" c="dimmed">총 {visibleRows.length}개 · {selectedGroup?.name || '코드 그룹'}</Text>
              <Select aria-label="페이지당 표시 수" value={String(pageSize)} onChange={handlePageSizeChange} data={PAGE_SIZE_OPTIONS} w={100} size="xs" />
            </Group>
            <Pagination total={pageCount} value={page} onChange={setPage} size="sm" disabled={loading} />
          </Group>
        </Paper>
      </div>

      <Modal opened={Boolean(deleteRequest)} onClose={() => !saving && setDeleteRequest(null)} title="공통코드 삭제" centered size="sm">
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            선택한 {deleteRequest?.rows.length || 0}개 코드를 삭제합니다. 삭제한 코드는 복구할 수 없습니다.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeleteRequest(null)} disabled={saving}>취소</Button>
            <Button color="red" leftSection={<IconTrash size={15} />} onClick={confirmDelete} loading={saving}>삭제</Button>
          </Group>
        </Stack>
      </Modal>
    </Box>
  );
}
