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
  IconDownload,
  IconSearch,
  IconTrash,
  IconUpload,
} from '@tabler/icons-react';
import * as XLSX from 'xlsx';
import { applyExcelHeaderStyle } from '../utils/excelHeaderStyle';
import useErpPageRibbon from '../components/common/useErpPageRibbon';
import ErpBreadcrumb from '../components/common/ErpBreadcrumb';
import { TableVirtuoso } from 'react-virtuoso';
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
  { groupcode: 'MATERIAL', name: '강종구분', codeLabel: '강종코드', nameLabel: '강종코드명', properties: ['비중'] },
  { groupcode: 'SHAPE', name: '형태구분', codeLabel: '형태구분코드', nameLabel: '형태구분명', properties: ['속성'] },
  { groupcode: 'PROCESS', name: '공정구분', codeLabel: '공정코드', nameLabel: '공정코드명', properties: ['속성'] },
  { groupcode: 'OTHER_COST', name: '기타비용코드', codeLabel: '기타비용코드', nameLabel: '기타비용코드명', properties: ['속성'] },
  { groupcode: 'PRICE_UNIT', name: '단가단위', codeLabel: '단가단위코드', nameLabel: '단가단위명', properties: ['속성'], helpText: '코드명 예: Kg, 수량, 길이' },
  { groupcode: 'QTY', name: '수량단위', codeLabel: '수량단위코드', nameLabel: '수량단위명', properties: ['속성'], helpText: '코드명 예: EA' },
  { groupcode: 'BANK', name: '은행코드', codeLabel: '은행코드', nameLabel: '은행명', properties: ['속성'] },
  { groupcode: 'JOB', name: '직위구분', codeLabel: '직위코드', nameLabel: '직위명', properties: ['속성'] },
  { groupcode: 'WAREHOUSE', name: '창고', codeLabel: '창고코드', nameLabel: '창고명', properties: ['소속사업장'] },
  { groupcode: 'SURFACE', name: '표면', codeLabel: '표면코드', nameLabel: '표면명', properties: ['속성'] },
];

// 최초 렌더와 조회 응답 정규화에 사용할 빈 그룹 상태를 생성합니다.
const emptyGroups = () => FIXED_GROUPS.map(({ groupcode, name, codeLabel, nameLabel, properties }) => ({
  id: groupcode,
  groupcode,
  name,
  codeLabel: codeLabel || '코드',
  nameLabel: nameLabel || '코드명',
  propertyLabels: properties || [],
  propertyIndex: 1,
  rowCount: 0,
  maxOrder: 0,
  rows: [],
  description: `${name} 회사 공통 코드`,
}));

const propertyValue = (row, index) => row[`property${index + 1}`] ?? row.properties?.[index] ?? '';
const groupPropertyIndex = (group) => Number(group?.propertyIndex || group?.property_index || 1) - 1;
const PASTE_FIELDS = ['code', 'name', 'property', 'order', 'use', 'description'];

// 화면에 보이는 행만 렌더링하고, 일반 코드 수정 시에는 변경된 행만 다시 렌더링합니다.
const CodeMasterTableCells = memo(function CodeMasterTableCells({ row, index, codeLabel, nameLabel, propertyLabel, selected, disabled, saving, onToggleSelection, onUpdateRow, onPasteRange, onRegisterCodeInput, onRegisterCellInput, onFocusCell, onDelete }) {
  const paste = (field) => (event) => {
    if (!event.clipboardData.getData('text/plain').includes('\t') && !event.clipboardData.getData('text/plain').includes('\n')) return;
    event.preventDefault();
    onPasteRange(row.id, field, event.clipboardData.getData('text/plain'));
  };
  return (
    <>
      <Table.Td className={classes.checkCol}><input aria-label={`${row.name || '새 코드'} 선택`} type="checkbox" checked={selected} disabled={disabled} onChange={(event) => onToggleSelection(row.id, event.nativeEvent.shiftKey)} /></Table.Td>
      <Table.Td className={classes.rowNumber}>{index + 1}</Table.Td>
      <Table.Td><input ref={(element) => { onRegisterCodeInput(row.id, element); onRegisterCellInput(row.id, 'code', element); }} className={classes.cellInput} aria-label={codeLabel} data-row-id={row.id} data-field="code" value={row.code ?? ''} readOnly={!row.isNew} disabled={disabled} onFocus={() => onFocusCell(row.id, 'code')} onPaste={paste('code')} onChange={(event) => onUpdateRow(row.id, 'code', event.currentTarget.value)} placeholder={codeLabel} /></Table.Td>
      <Table.Td><input ref={(element) => onRegisterCellInput(row.id, 'name', element)} className={classes.cellInput} aria-label={nameLabel} data-row-id={row.id} data-field="name" value={row.name ?? ''} disabled={disabled} onFocus={() => onFocusCell(row.id, 'name')} onPaste={paste('name')} onChange={(event) => onUpdateRow(row.id, 'name', event.currentTarget.value)} placeholder={`${nameLabel} 입력`} /></Table.Td>
      {propertyLabel && <Table.Td><input ref={(element) => onRegisterCellInput(row.id, 'property', element)} className={classes.cellInput} aria-label={propertyLabel} data-row-id={row.id} data-field="property" value={row.property ?? ''} disabled={disabled} onFocus={() => onFocusCell(row.id, 'property')} onPaste={paste('property')} onChange={(event) => onUpdateRow(row.id, 'property', event.currentTarget.value)} /></Table.Td>}
      <Table.Td><input ref={(element) => onRegisterCellInput(row.id, 'order', element)} className={classes.cellInput} aria-label="정렬 순서" data-row-id={row.id} data-field="order" type="number" min={0} value={String(row.order)} disabled={disabled} onFocus={() => onFocusCell(row.id, 'order')} onPaste={paste('order')} onChange={(event) => onUpdateRow(row.id, 'order', Number(event.currentTarget.value))} /></Table.Td>
      <Table.Td><select ref={(element) => onRegisterCellInput(row.id, 'use', element)} className={classes.cellSelect} aria-label={`${row.code || '코드'} 사용여부`} data-row-id={row.id} data-field="use" value={row.use ? 'Y' : 'N'} disabled={disabled} onFocus={() => onFocusCell(row.id, 'use')} onPaste={paste('use')} onChange={(event) => onUpdateRow(row.id, 'use', event.currentTarget.value === 'Y')}><option value="Y">사용중</option><option value="N">사용중지</option></select></Table.Td>
      <Table.Td><input ref={(element) => onRegisterCellInput(row.id, 'description', element)} className={classes.cellInput} aria-label="비고" data-row-id={row.id} data-field="description" value={row.description ?? ''} disabled={disabled} onFocus={() => onFocusCell(row.id, 'description')} onPaste={paste('description')} onChange={(event) => onUpdateRow(row.id, 'description', event.currentTarget.value)} /></Table.Td>
      <Table.Td className={classes.actionCol}><Tooltip label="코드 삭제"><ActionIcon variant="subtle" color="red" aria-label="코드 삭제" disabled={saving || disabled} onClick={() => onDelete(row)}><IconTrash size={16} /></ActionIcon></Tooltip></Table.Td>
    </>
  );
});

const CodeMasterVirtualRow = ({ item, className, ...props }) => (
  <Table.Tr {...props} className={[className, item?.isNew && classes.newRow].filter(Boolean).join(' ')} />
);

const codeMasterVirtuosoComponents = {
  Table: ({ style, ...props }) => (
    <Table {...props} className={`${sharedClasses.table} ${classes.codeTable}`} highlightOnHover withTableBorder withColumnBorders verticalSpacing="xs" horizontalSpacing={0} style={{ ...style, width: '100%', tableLayout: 'fixed' }} />
  ),
  TableHead: Table.Thead,
  TableBody: Table.Tbody,
  TableRow: CodeMasterVirtualRow,
  EmptyPlaceholder: ({ context }) => (
    <Table.Tbody>
      <Table.Tr>
        <Table.Td colSpan={context.columnCount} className={classes.emptyPlaceholder}>
          {context.emptyMessage}
        </Table.Td>
      </Table.Tr>
    </Table.Tbody>
  ),
};

const CodeMasterGroupPanel = memo(function CodeMasterGroupPanel({ groups, visibleGroups, groupQuery, setGroupQuery, totalCodes, loading, uploadProgress, selectedId, onSelectGroup }) {
  return (
        <Paper className={`${sharedClasses.panel} ${classes.groupPanel}`} withBorder>
          <Group className={`${sharedClasses.panelHeader} ${classes.groupHeader}`} justify="space-between" align="center">
            <Box>
              <Group gap={7} align="center" wrap="nowrap">
                <Text fw={700}>코드 그룹</Text>
                <Badge color="gray" variant="light">{groups.length}개</Badge>
              </Group>
              <Text size="xs" c="dimmed" mt={3}>종류별 공통코드를 선택하세요</Text>
            </Box>
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
                onClick={() => onSelectGroup(group.groupcode)}
                disabled={Boolean(uploadProgress)}
                type="button"
              >
                <span className={classes.groupItemCopy}>
                  <span className={classes.groupName}>{group.name}</span>
                  <span className={classes.groupMeta}>{group.rowCount}개</span>
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

  );
});

export default function CodeMasterPage() {
  // groups에는 서버 자료와 아직 저장하지 않은 편집 내용이 함께 들어갑니다.
  // selectedRows는 행 id 목록이며, deleteRequest는 삭제 확인 모달의 대상입니다.
  const [groups, setGroups] = useState(emptyGroups);
  const [selectedId, setSelectedId] = useState('');
  const [groupQuery, setGroupQuery] = useState('');
  const [codeQueryInput, setCodeQueryInput] = useState('');
  const [codeQuery, setCodeQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dirtyRows, setDirtyRows] = useState({});
  const [selectedRows, setSelectedRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [exportLoading, setExportLoading] = useState(false);
  const [deleteRequest, setDeleteRequest] = useState(null);
  const [columnWidths, setColumnWidths] = useState({});
  const uploadInputRef = useRef(null);
  const tableRef = useRef(null);
  const codeInputRefs = useRef(new Map());
  const cellInputRefs = useRef(new Map());
  const activeCellRef = useRef(null);
  const pendingCellFocusRef = useRef(null);
  const pendingCodeFocusRef = useRef('');
  const selectionAnchorRef = useRef('');
  const groupsRef = useRef(groups);
  const selectedIdRef = useRef(selectedId);
  groupsRef.current = groups;
  selectedIdRef.current = selectedId;
  const selectedGroup = groups.find((group) => group.groupcode === selectedId) || null;
  const navigationFields = useMemo(() => selectedGroup
    ? ['code', 'name', ...((selectedGroup.propertyLabels || [])[0] ? ['property'] : []), 'order', 'use', 'description']
    : [], [selectedGroup]);
  const resizeColumn = useCallback((event, columnKey, defaultWidth, minimumWidth, tableWidth) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = columnWidths[columnKey] ?? defaultWidth;
    const resizeRoot = event.currentTarget.closest(`.${classes.tableWrap}`);
    const resizeHeader = event.currentTarget.parentElement;
    let currentWidth = startWidth;
    const updateWidth = (pointerEvent) => {
      currentWidth = Math.max(minimumWidth, Math.min(1600, startWidth + pointerEvent.clientX - startX));
      if (resizeHeader) resizeHeader.style.width = `${currentWidth}px`;
      resizeRoot?.style.setProperty('--code-table-min-width', `${Math.max(900, tableWidth + currentWidth - startWidth)}px`);
    };
    const finishResize = () => {
      window.removeEventListener('pointermove', updateWidth);
      window.removeEventListener('pointerup', finishResize);
      window.removeEventListener('pointercancel', finishResize);
      setColumnWidths((current) => ({ ...current, [columnKey]: currentWidth }));
    };
    window.addEventListener('pointermove', updateWidth);
    window.addEventListener('pointerup', finishResize);
    window.addEventListener('pointercancel', finishResize);
  }, [columnWidths]);
  const registerCodeInput = useCallback((rowId, element) => {
    if (!element) {
      codeInputRefs.current.delete(rowId);
      return;
    }
    codeInputRefs.current.set(rowId, element);
    if (pendingCodeFocusRef.current === rowId) {
      element.focus();
      pendingCodeFocusRef.current = '';
    }
  }, []);
  const registerCellInput = useCallback((rowId, field, element) => {
    const key = `${rowId}:${field}`;
    if (element) {
      cellInputRefs.current.set(key, element);
      if (pendingCellFocusRef.current === key) {
        element.focus();
        pendingCellFocusRef.current = null;
      }
    } else cellInputRefs.current.delete(key);
  }, []);
  const setActiveCell = useCallback((rowId, field) => {
    activeCellRef.current = { rowId, field };
  }, []);
  const handleSelectGroup = useCallback((groupcode) => {
    setSelectedId(groupcode);
    setCodeQueryInput('');
    setCodeQuery('');
    setStatusFilter('all');
    setSelectedRows([]);
    selectionAnchorRef.current = '';
  }, []);

  // 최초 로딩 때 회사의 코드 목록 전체를 받아 메모리에 두고, 이후 그룹 선택과 페이징은 로컬에서 처리합니다.
  const loadGroups = useCallback(async (selectGroupCode = '') => {
    setLoading(true);
    try {
      const { data } = await axios.get('/api/code-master/groups', { headers: authHeaders() });
      const responseGroups = new Map((data.groups || []).map((group) => [group.groupcode, group]));
      const loadedGroups = FIXED_GROUPS.map(({ groupcode, name, codeLabel, nameLabel, properties }) => {
        const group = responseGroups.get(groupcode);
        const propertyLabels = group?.property_labels || properties;
        const propertyIndex = Number(group?.property_index || 1);
        const rows = (group?.rows || []).map((row) => ({
          ...row,
          groupcode,
          property: propertyValue(row, propertyIndex - 1),
          isNew: false,
          isDirty: false,
        }));
        return {
          id: groupcode, groupcode, name, codeLabel: codeLabel || 'Code',
          nameLabel: nameLabel || 'Code name',
          propertyLabels,
          propertyIndex,
          helpText: FIXED_GROUPS.find((fixedGroup) => fixedGroup.groupcode === groupcode)?.helpText || '',
          description: group?.description || `${name} ${groupcode}`,
          rowCount: rows.length,
          maxOrder: rows.reduce((maximum, row) => Math.max(maximum, Number(row.order) || 0), 0),
          rows,
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
      notifications.show({ title: 'Unable to load code groups', message: errorMessage(error), color: 'red' });
    } finally {
      setLoading(false);
    }
  }, []);


  // CustomerPage와 같은 방식으로 업로드용 엑셀 템플릿을 내려받습니다.
  const downloadTemplate = useCallback(() => {
    const group = selectedGroup || FIXED_GROUPS.find(({ groupcode }) => groupcode === selectedId);
    if (!group) return;
    const codeLabel = group.codeLabel || '코드';
    const nameLabel = group.nameLabel || '코드명';
    const propertyLabel = (group.propertyLabels || group.properties || [])[0];
    const headers = ['그룹코드', codeLabel, nameLabel, ...(propertyLabel ? [propertyLabel] : []), '정렬', '사용 여부', '비고'];
    const worksheet = XLSX.utils.aoa_to_sheet([
      headers,
      [group.groupcode, '', '', ...(propertyLabel ? [''] : []), 0, 'Y', ''],
    ]);
    applyExcelHeaderStyle(worksheet, headers.length);
    worksheet['!cols'] = headers.map(() => ({ wch: 20 }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '공통코드');
    XLSX.writeFile(workbook, `공통코드_일괄등록_${group.name}_샘플.xlsx`);
  }, [selectedGroup, selectedId]);

  // 현재 선택된 그룹의 목록과 같은 헤더로 XLSX를 내보냅니다.
  const exportCodes = useCallback(async () => {
    if (!selectedGroup) return;
    setExportLoading(true);
    try {
      const allRows = selectedGroup.rows || [];
      const exportRows = allRows.map((row) => dirtyRows[row.id] || row);
      exportRows.push(...Object.values(dirtyRows).filter((row) => row.groupcode === selectedGroup.groupcode && row.isNew));
      const headers = [
        '그룹코드',
        selectedGroup.codeLabel || '코드',
        selectedGroup.nameLabel || '코드명',
        ...((selectedGroup.propertyLabels || [])[0] ? [selectedGroup.propertyLabels[0]] : []),
        '정렬',
        '사용 여부',
        '비고',
      ];
      const worksheet = XLSX.utils.aoa_to_sheet([
        headers,
        ...exportRows.map((row) => [
          selectedGroup.groupcode,
          row.code ?? '',
          row.name ?? '',
          ...((selectedGroup.propertyLabels || [])[0] ? [row.property ?? propertyValue(row, groupPropertyIndex(selectedGroup))] : []),
          Number(row.order) || 0,
          row.use ? 'Y' : 'N',
          row.description ?? '',
        ]),
      ]);
      applyExcelHeaderStyle(worksheet, headers.length);
      worksheet['!cols'] = headers.map(() => ({ wch: 20 }));
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, '공통코드목록');
      const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
      XLSX.writeFile(workbook, `공통코드목록_${selectedGroup.name}_${date}.xlsx`);
      const total = exportRows.length;
      notifications.show({ title: '엑셀 다운로드 완료', message: `${selectedGroup.name} ${total.toLocaleString()}건을 다운로드했습니다.`, color: 'teal', position: 'bottom-right' });
    } catch (error) {
      notifications.show({ title: '엑셀 다운로드 실패', message: errorMessage(error), color: 'red', position: 'bottom-right' });
    } finally {
      setExportLoading(false);
    }
  }, [selectedGroup, dirtyRows]);

  // 첫 번째 시트의 행을 검증한 다음 고정 그룹별로 나눠 기존 일괄 저장 API에 등록합니다.
  const uploadCodes = useCallback(async (event) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    const hasPendingChanges = Object.values(dirtyRows).some((row) => row.isNew || row.isDirty);
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
        code: ['code', '코드', '코드값', ...FIXED_GROUPS.map((group) => group.codeLabel).filter(Boolean)],
        codename: ['codename', '코드명', '코드 이름', ...FIXED_GROUPS.map((group) => group.nameLabel).filter(Boolean)],
        sortorder: ['sortorder', '정렬', '정렬순서', '정렬 순서', '순서'],
        use: ['use', '사용여부', '사용 여부', 'use_yn'],
        description: ['description', '설명', '비고'],
        property: ['property', '속성', '비중', '소속사업장'],
      };
      const headerKeys = new Set(Object.keys(rows[0] || {}).map(normalizeKey));
      const headerGroupcodes = FIXED_GROUPS
        .filter((group) => [group.codeLabel, group.nameLabel]
          .some((label) => label && headerKeys.has(normalizeKey(label))))
        .map((group) => group.groupcode);
      if (headerGroupcodes.length > 1) {
        throw new Error('엑셀의 코드/코드명 열이 여러 그룹에 해당합니다. 한 그룹에 맞는 양식으로 정리해 주세요.');
      }
      const headerGroupcode = headerGroupcodes[0] || '';
      const groupByName = new Map(FIXED_GROUPS.flatMap((group) => [
        [normalizeKey(group.name), group.groupcode],
        [normalizeKey(group.groupcode), group.groupcode],
        ...(group.groupcode === 'MATERIAL' ? [[normalizeKey('강종'), group.groupcode]] : []),
        ...(group.groupcode === 'SHAPE' ? [[normalizeKey('형태'), group.groupcode], [normalizeKey('형태구분코드'), group.groupcode]] : []),
        ...(group.groupcode === 'PROCESS' ? [[normalizeKey('공정'), group.groupcode]] : []),
        ...(group.groupcode === 'OTHER_COST' ? [[normalizeKey('기타비용'), group.groupcode]] : []),
        ...(group.groupcode === 'WAREHOUSE' ? [[normalizeKey('창고'), group.groupcode]] : []),
        ...(group.groupcode === 'SURFACE' ? [[normalizeKey('표면'), group.groupcode]] : []),
        ...(group.groupcode === 'QTY' ? [[normalizeKey('수량단위'), group.groupcode]] : []),
        ...(group.groupcode === 'PRICE_UNIT' ? [[normalizeKey('단가'), group.groupcode]] : []),
        ...(group.groupcode === 'BANK' ? [[normalizeKey('은행'), group.groupcode]] : []),
        ...(group.groupcode === 'JOB' ? [[normalizeKey('직위'), group.groupcode]] : []),
      ]));
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
        const sortText = valueFor('sortorder');
        const sortorder = sortText === '' ? 0 : Number(sortText);
        const useText = valueFor('use').trim().toUpperCase();
        const use = ['Y', '사용', '사용중', '사용함'].includes(useText) ? true
          : ['N', '미사용', '사용중지', '사용안함'].includes(useText) ? false
            : null;
        return {
          excelRow: index + 2,
          groupcode,
          code: valueFor('code'),
          codename: valueFor('codename'),
          property: valueFor('property'),
          sortorder,
          use,
          description: valueFor('description'),
        };
      }).filter((row) => row.groupcode || row.code || row.codename);

      if (!normalizedRows.length) throw new Error('업로드할 데이터가 없습니다. 샘플 양식의 첫 번째 시트를 확인해 주세요.');
      const sheetGroupcodes = [...new Set(normalizedRows.map((row) => row.groupcode).filter(Boolean))];
      if (sheetGroupcodes.length === 1 && sheetGroupcodes[0] !== selectedId) {
        notifications.show({
          title: '그룹코드 불일치',
          message: `현재 선택한 그룹은 ${selectedId}, 엑셀 그룹코드는 ${sheetGroupcodes[0]}입니다. 같은 그룹에서 업로드해 주세요.`,
          color: 'red',
          position: 'bottom-right',
        });
        return;
      }
      const failures = [];
      const candidates = [];
      const seen = new Set();
      const existingCodesByGroup = new Map(groups.map((group) => [
        group.groupcode,
        new Set((group.rows || []).map((item) => String(item.code || '').trim())),
      ]));
      let excludedCount = 0;
      normalizedRows.forEach((row) => {
        const rowErrors = [];
        if (!row.groupcode) rowErrors.push('그룹코드 확인 필요');
        if (headerGroupcode && row.groupcode && row.groupcode !== headerGroupcode) rowErrors.push('엑셀 열 이름과 그룹코드가 일치하지 않음');
        if (!row.codename) rowErrors.push('코드명 필수');
        if (!Number.isInteger(row.sortorder) || row.sortorder < 0 || row.sortorder > 2_147_483_647) rowErrors.push('정렬순서는 0 이상의 정수여야 함');
        if (row.use === null) rowErrors.push('사용 여부는 Y 또는 N으로 입력');
        const key = row.code ? `${row.groupcode}:${row.code}` : '';
        if (key && seen.has(key)) rowErrors.push('엑셀 파일 안에 코드 중복');
        if (row.code && existingCodesByGroup.get(row.groupcode)?.has(row.code)) rowErrors.push('이미 등록된 코드');
        if (rowErrors.length) {
          excludedCount += 1;
          failures.push(`${row.excelRow}행: ${rowErrors.join(', ')}`);
        }
        else {
          if (key) seen.add(key);
          candidates.push(row);
        }
      });

      if (failures.length) {
        notifications.show({
          title: '일괄 등록 중단',
          message: `오류 ${failures.length}건이 있어 등록하지 않았습니다: ${failures.slice(0, 5).join(' / ')}`,
          color: 'red',
          position: 'bottom-right',
          autoClose: 9000,
        });
        return;
      }

      let inserted = 0;
      setUploadProgress('전체 항목을 한 번에 등록하는 중');
      const response = await axios.post('/api/code-master/bulk', {
        items: candidates.map(({ groupcode, code, codename, property, sortorder, use, description }) => ({
          groupcode, code, codename, property, sortorder, use, description,
        })),
      }, { headers: authHeaders() });
      inserted = response.data.inserted_count;
      await loadGroups(selectedId);
      notifications.show({
        title: inserted === 0 && failures.length ? '일괄 등록 중단' : failures.length ? '일괄 등록 완료 (일부 제외)' : '일괄 등록 완료',
        message: `${inserted}건 등록${failures.length ? `, ${excludedCount}건 제외: ${failures.slice(0, 5).join(' / ')}` : ''}`,
        color: failures.length ? 'orange' : 'teal',
        position: 'bottom-right',
        autoClose: 7000,
      });
    } catch (error) {
      notifications.show({ title: '엑셀 업로드 실패', message: errorMessage(error), color: 'red', position: 'bottom-right' });
    } finally {
      setUploadProgress('');
    }
  }, [dirtyRows, groups, loadGroups, selectedId]);

  useEffect(() => {
    // 화면 진입 시 인증된 사용자의 회사 공통코드를 최초 조회합니다.
    loadGroups();
  }, [loadGroups]);

  // 그룹/코드 검색은 표시용 목록만 필터링하며 원본 groups 데이터는 유지합니다.
  const visibleGroups = useMemo(
    () => groups.filter((group) => group.name.toLowerCase().includes(groupQuery.trim().toLowerCase())),
    [groups, groupQuery],
  );
  const newRows = useMemo(() => Object.values(dirtyRows).filter((row) => row.isNew && row.groupcode === selectedId), [dirtyRows, selectedId]);
  const filteredRows = useMemo(() => {
    const rows = [...(selectedGroup?.rows || []).map((row) => dirtyRows[row.id] || row), ...newRows];
    const query = codeQuery.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesQuery = !query || `${row.code || ''} ${row.name || ''}`.toLowerCase().includes(query);
      const matchesStatus = statusFilter === 'all' || row.use === (statusFilter === 'Y');
      return matchesQuery && matchesStatus;
    });
  }, [selectedGroup, dirtyRows, newRows, codeQuery, statusFilter]);
  const totalForView = filteredRows.length;
  const visibleRows = filteredRows;
  const totalCodes = groups.reduce((sum, group) => sum + group.rowCount, 0);

  const focusGridCell = useCallback((rowId, field) => {
    const key = `${rowId}:${field}`;
    const input = cellInputRefs.current.get(key);
    if (input) { input.focus(); return; }
    const rowIndex = visibleRows.findIndex((row) => row.id === rowId);
    if (rowIndex < 0) return;
    pendingCellFocusRef.current = key;
    tableRef.current?.scrollToIndex({ index: rowIndex, align: 'center', behavior: 'auto' });
  }, [visibleRows]);

  const moveGridCell = useCallback((rowId, field, rowDelta, columnDelta) => {
    const rowIndex = visibleRows.findIndex((row) => row.id === rowId);
    const columnIndex = navigationFields.indexOf(field);
    if (rowIndex < 0 || columnIndex < 0 || !navigationFields.length) return false;
    let nextRow = rowIndex + rowDelta;
    let nextColumn = columnIndex + columnDelta;
    if (nextColumn < 0) { nextRow -= 1; nextColumn = navigationFields.length - 1; }
    if (nextColumn >= navigationFields.length) { nextRow += 1; nextColumn = 0; }
    if (nextRow < 0 || nextRow >= visibleRows.length) return false;
    focusGridCell(visibleRows[nextRow].id, navigationFields[nextColumn]);
    return true;
  }, [visibleRows, navigationFields, focusGridCell]);

  const handleTableKeyDown = useCallback((event) => {
    const target = event.target instanceof HTMLElement && event.target.dataset.field ? event.target : null;
    if (!target || target.dataset.field === 'action') return;
    if (target.tagName === 'SELECT' && event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const field = target.dataset.field;
    const rowId = target.dataset.rowId;
    let rowDelta = 0;
    let columnDelta = 0;
    if (event.key === 'Enter') rowDelta = event.shiftKey ? -1 : 1;
    else if (event.key === 'Tab') columnDelta = event.shiftKey ? -1 : 1;
    else if (event.key === 'ArrowDown') rowDelta = 1;
    else if (event.key === 'ArrowUp') rowDelta = -1;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const hasSelection = 'selectionStart' in target && target.selectionStart !== target.selectionEnd;
      const atBoundary = !('selectionStart' in target) || target.readOnly || hasSelection
        ? !hasSelection
        : event.key === 'ArrowLeft' ? target.selectionStart === 0 : target.selectionEnd === target.value.length;
      if (!atBoundary) return;
      columnDelta = event.key === 'ArrowLeft' ? -1 : 1;
    } else return;
    if (moveGridCell(rowId, field, rowDelta, columnDelta)) event.preventDefault();
  }, [moveGridCell]);

  // 선택된 그룹에서 지정 행의 한 필드만 불변 방식으로 갱신합니다.
  const updateRow = useCallback((rowId, key, value) => {
    setDirtyRows((current) => {
      const original = groupsRef.current.find((group) => group.groupcode === selectedIdRef.current)?.rows.find((row) => row.id === rowId);
      const row = current[rowId] || original;
      if (!row) return current;
      return { ...current, [rowId]: { ...row, groupcode: row.groupcode || selectedIdRef.current, [key]: value, isDirty: !row.isNew } };
    });
  }, []);

  // 엑셀에서 복사한 탭 구분 범위를 현재 셀부터 반영하고, 범위가 끝을 넘으면 새 행을 만듭니다.
  const pasteRange = useCallback((startRowId, startField, clipboardText) => {
    const startRowIndex = filteredRows.findIndex((row) => row.id === startRowId);
    const startFieldIndex = PASTE_FIELDS.indexOf(startField);
    if (startRowIndex < 0 || startFieldIndex < 0) return;

    const matrix = clipboardText.replace(/\r/g, '').split('\n');
    while (matrix.length && matrix[matrix.length - 1] === '') matrix.pop();
    if (!matrix.length) return;
    const additions = [];
    let codeChangeBlocked = false;
    let orderValueInvalid = false;
    let skippedHeaderRows = 0;
    const nextOrderBase = Math.max(selectedGroup?.maxOrder || 0, ...newRows.map((row) => Number(row.order) || 0));
    const changes = [];

    matrix.forEach((line, rowOffset) => {
      const values = line.split('\t');
      if (values.every((value) => value === '')) return;
      const firstValue = values[0].trim().toUpperCase();
      if (startFieldIndex === 0 && ['그룹코드', 'GROUPCODE'].includes(firstValue)) {
        skippedHeaderRows += 1;
        return;
      }
      const fieldOffset = startFieldIndex === 0 && firstValue === selectedId.toUpperCase() ? 1 : 0;
      const targetIndex = startRowIndex + rowOffset - skippedHeaderRows;
      let target = filteredRows[targetIndex];
      if (!target) {
        const id = `paste-${Date.now()}-${rowOffset}-${Math.random().toString(36).slice(2)}`;
        target = {
          id, groupcode: selectedId, code: '', name: '', property: '', properties: ['', '', '', ''],
          order: nextOrderBase + additions.length + 1,
          use: true, description: '', isNew: true, isDirty: false,
        };
        additions.push(target);
      }
      let next = { ...target };
      values.forEach((rawValue, valueOffset) => {
        if (fieldOffset && valueOffset === 0) return;
        const field = PASTE_FIELDS[startFieldIndex + valueOffset - fieldOffset];
        if (!field) return;
        const value = rawValue.trim();
        if (field === 'code') {
          if (target.isNew) next.code = value;
          else if (value && value !== target.code) codeChangeBlocked = true;
        } else if (field === 'order') {
          const order = value === '' ? 0 : Number(value);
          if (Number.isInteger(order) && order >= 0 && order <= 2_147_483_647) next.order = order;
          else orderValueInvalid = true;
        } else if (field === 'use') {
          const normalizedUse = value.toUpperCase();
          if (['Y', '사용', '사용중', '사용함'].includes(normalizedUse)) next.use = true;
          else if (['N', '미사용', '사용중지', '사용안함'].includes(normalizedUse)) next.use = false;
          else orderValueInvalid = true;
        } else {
          next[field] = rawValue;
        }
      });
      next.isDirty = !next.isNew;
      changes.push(next);
    });

    setDirtyRows((current) => {
      const next = { ...current };
      changes.forEach((row) => { next[row.id] = row; });
      return next;
    });
    if (additions.length) {
      setGroups((current) => current.map((group) => group.groupcode === selectedId
        ? { ...group, rowCount: group.rowCount + additions.length }
        : group));
      setCodeQueryInput('');
      setCodeQuery('');
      setSelectedRows([]);
    }
    if (codeChangeBlocked || orderValueInvalid) {
      notifications.show({
        title: '일부 셀을 확인해 주세요',
        message: [
          codeChangeBlocked && '저장된 코드값은 변경할 수 없어 해당 셀은 건너뛰었습니다.',
          orderValueInvalid && '정렬 순서는 0 이상의 정수, 사용 여부는 Y 또는 N으로 입력해 주세요.',
        ].filter(Boolean).join(' '),
        color: 'orange', position: 'bottom-right',
      });
    }
  }, [filteredRows, newRows, selectedGroup, selectedId]);

  // 정렬 순서는 현재 최댓값 다음으로, 코드는 다음 숫자값으로 새 행을 만듭니다.
  const addRow = () => {
    if (!selectedGroup) return;
    const targetIndex = (selectedGroup.rows?.length || 0) + newRows.length;
    const nextOrder = Math.max(selectedGroup.maxOrder || 0, ...newRows.map((row) => Number(row.order) || 0)) + 1;
    const id = `new-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const row = { id, groupcode: selectedId, code: '', name: '', property: '', properties: ['', '', '', ''], order: nextOrder, use: true, description: '', isNew: true };
    pendingCodeFocusRef.current = id;
    setDirtyRows((current) => ({ ...current, [id]: row }));
    setGroups((current) => current.map((group) => group.groupcode === selectedId ? { ...group, rowCount: group.rowCount + 1 } : group));
    setSelectedRows([]);
    setCodeQueryInput('');
    setCodeQuery('');
    requestAnimationFrame(() => {
      tableRef.current?.scrollToIndex({ index: targetIndex, align: 'end', behavior: 'auto' });
      codeInputRefs.current.get(id)?.focus();
    });
  };

  // 확인된 대상 중 저장된 코드는 서버에서, 미저장 행은 화면 상태에서 삭제합니다.
  const confirmDelete = async (groupcode = deleteRequest?.groupcode, requestedRows = deleteRequest?.rows) => {
    const targets = requestedRows || [];
    if (!targets.length) return;
    const savedCodes = targets.filter((row) => !row.isNew).map((row) => row.code);
    const newIds = new Set(targets.filter((row) => row.isNew).map((row) => row.id));
    const targetIds = new Set(targets.map((row) => row.id));
    setSaving(true);
    try {
      if (savedCodes.length) {
        await axios.post(`/api/code-master/groups/${encodeURIComponent(groupcode)}/items/delete`, { codes: savedCodes }, { headers: authHeaders() });
      }
      setDirtyRows((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !targetIds.has(id))));
      if (newIds.size) {
        setGroups((current) => current.map((group) => group.groupcode !== groupcode
          ? group : { ...group, rowCount: Math.max(0, group.rowCount - newIds.size) }));
      }
      if (savedCodes.length) {
        await loadGroups(groupcode);
      }
      setSelectedRows([]);
      notifications.show({ title: '삭제 완료', message: `공통코드 ${targets.length}건을 삭제했습니다.`, color: 'teal' });
      setDeleteRequest(null);
    } catch (error) {
      notifications.show({ title: '삭제 실패', message: errorMessage(error), color: 'red' });
    } finally {
      setSaving(false);
    }
  };

  // 실제 삭제는 모달에서 사용자가 확인한 뒤 수행되도록 대상만 기록합니다.
  const deleteUnsavedRows = useCallback((groupcode, rows) => {
    const unsavedRows = rows.filter((row) => row.isNew);
    if (!unsavedRows.length) return;
    const ids = new Set(unsavedRows.map((row) => row.id));
    setDirtyRows((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !ids.has(id))));
    setGroups((current) => current.map((group) => group.groupcode !== groupcode
      ? group : { ...group, rowCount: Math.max(0, group.rowCount - unsavedRows.length) }));
    setSelectedRows((current) => current.filter((id) => !ids.has(id)));
    notifications.show({ title: '삭제 완료', message: `공통코드 ${unsavedRows.length}건을 삭제했습니다.`, color: 'teal' });
  }, []);
  const requestDeleteRow = useCallback((row) => {
    if (saving) return;
    if (row.isNew) {
      deleteUnsavedRows(selectedId, [row]);
      return;
    }
    setDeleteRequest({ groupcode: selectedId, rows: [row] });
  }, [selectedId, saving, deleteUnsavedRows]);
  const requestDeleteSelected = () => {
    if (saving) return;
    // 행마다 배열 includes를 반복하지 않고, 선택 id Set으로 한 번에 확인합니다.
    const rows = visibleRows.filter((row) => selectedRowIds.has(row.id));
    if (!rows.length) return;
    void confirmDelete(selectedId, rows);
  };

  // 현재 그룹에서 변경된 행만 API에 전송합니다.
  const saveRows = async () => {
    if (!selectedGroup) return;
    const rowsToSave = Object.values(dirtyRows).filter((row) => row.groupcode === selectedGroup.groupcode && (row.isNew || row.isDirty));
    if (!rowsToSave.length) {
      notifications.show({ title: '저장할 내용 없음', message: '변경된 공통코드가 없습니다.', color: 'gray' });
      return;
    }
    const trimmedCodes = rowsToSave.map((row) => row.code.trim());
    const invalid = rowsToSave.some((row) => !row.code.trim() || !row.name.trim());
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
        items: rowsToSave.map((row) => ({
          code: row.code.trim(),
          codename: row.name.trim(),
          property: row.property ?? propertyValue(row, groupPropertyIndex(selectedGroup)),
          sortorder: Number(row.order) || 0,
          use: Boolean(row.use),
          description: row.description || '',
          is_new: Boolean(row.isNew),
        })),
      }, { headers: authHeaders() });
      setDirtyRows((current) => Object.fromEntries(Object.entries(current).filter(([, row]) => row.groupcode !== selectedGroup.groupcode)));
      await loadGroups(selectedGroup.groupcode);
      notifications.show({ title: '저장 완료', message: `${rowsToSave.length.toLocaleString()}개 공통코드를 저장했습니다.`, color: 'teal', icon: <IconCheck size={16} /> });
    } catch (error) {
      notifications.show({ title: '저장 실패', message: errorMessage(error), color: 'red' });
    } finally {
      setSaving(false);
    }
  };

  // 체크 상태를 행 id 집합처럼 토글해 선택 삭제에 사용합니다.
  const toggleRowSelection = useCallback((rowId, extendRange = false) => {
    const anchorIndex = visibleRows.findIndex((row) => row.id === selectionAnchorRef.current);
    const targetIndex = visibleRows.findIndex((row) => row.id === rowId);
    if (extendRange && anchorIndex >= 0 && targetIndex >= 0) {
      const [start, end] = [anchorIndex, targetIndex].sort((left, right) => left - right);
      const rangeIds = visibleRows.slice(start, end + 1).map((row) => row.id);
      setSelectedRows((current) => [...new Set([...current, ...rangeIds])]);
      return;
    }
    setSelectedRows((current) => current.includes(rowId)
      ? current.filter((id) => id !== rowId)
      : [...current, rowId]);
    selectionAnchorRef.current = rowId;
  }, [visibleRows]);
  const selectedRowIds = useMemo(() => new Set(selectedRows), [selectedRows]);
  const renderCodeCells = useCallback((index, row) => (
    <CodeMasterTableCells
      row={row}
      index={index}
      codeLabel={selectedGroup?.codeLabel || '??'}
      nameLabel={selectedGroup?.nameLabel || '???'}
      propertyLabel={(selectedGroup?.propertyLabels || [])[0] || ''}
      selected={selectedRowIds.has(row.id)}
      disabled={Boolean(uploadProgress)}
      saving={saving}
      onToggleSelection={toggleRowSelection}
      onUpdateRow={updateRow}
      onPasteRange={pasteRange}
      onRegisterCodeInput={registerCodeInput}
      onRegisterCellInput={registerCellInput}
      onFocusCell={setActiveCell}
      onDelete={requestDeleteRow}
    />
  ), [selectedGroup, selectedRowIds, uploadProgress, saving, toggleRowSelection, updateRow, pasteRange, registerCodeInput, registerCellInput, setActiveCell, requestDeleteRow]);
  const headerColumns = [
    { key: 'select', width: 46, minWidth: 42, className: classes.checkCol, label: <input aria-label="현재 목록 전체 선택" type="checkbox" checked={visibleRows.length > 0 && visibleRows.every((row) => selectedRowIds.has(row.id))} onChange={(event) => toggleCurrentPageSelection(event.currentTarget.checked)} /> },
    { key: 'number', width: 62, minWidth: 48, className: classes.numberCol, label: 'No.' },
    { key: 'code', width: 170, minWidth: 80, className: classes.codeCol, label: selectedGroup?.codeLabel || '코드' },
    { key: 'name', width: 180, minWidth: 80, label: selectedGroup?.nameLabel || '코드명' },
    ...((selectedGroup?.propertyLabels || [])[0] ? [{ key: 'property', width: 120, minWidth: 70, label: selectedGroup.propertyLabels[0] }] : []),
    { key: 'order', width: 126, minWidth: 74, className: classes.orderCol, label: '정렬' },
    { key: 'use', width: 105, minWidth: 90, className: classes.statusCol, label: '사용여부' },
    { key: 'description', width: 180, minWidth: 90, label: '비고' },
    { key: 'action', width: 76, minWidth: 50, className: classes.actionCol, label: '관리' },
  ];
  const tableWidth = headerColumns.reduce((total, column) => total + (columnWidths[column.key] ?? column.width), 0);
  const renderResizableHeader = (column) => {
    const width = columnWidths[column.key] ?? column.width;
    return (
      <Table.Th key={column.key} className={[classes.resizableHeader, column.className].filter(Boolean).join(' ')} style={{ width }}>
        {column.label}
        <span className={classes.columnResizeHandle} onPointerDown={(event) => resizeColumn(event, column.key, column.width, column.minWidth, tableWidth)} role="separator" aria-label={`${typeof column.label === 'string' ? column.label : '선택'} 열 너비 조절`} />
      </Table.Th>
    );
  };
  const toggleCurrentPageSelection = (checked) => {
    const currentPageIds = new Set(visibleRows.map((row) => row.id));
    setSelectedRows((current) => {
      const next = new Set(current);
      currentPageIds.forEach((id) => (checked ? next.add(id) : next.delete(id)));
      return [...next];
    });
    selectionAnchorRef.current = '';
  };
  // 좌측 그룹 탐색, 우측 코드 편집 표, 하단 삭제 확인 모달로 구성됩니다.
  useErpPageRibbon({
    onSearch: () => {
      setCodeQuery(codeQueryInput);
      setSelectedRows([]);
      selectionAnchorRef.current = '';
      return loadGroups(selectedId);
    },
    onAdd: addRow,
    onSave: saveRows,
    onDelete: requestDeleteSelected,
    onExcel: exportCodes,
    showPrint: false,
    useSaveColor: false,
  });

  return (
    <Box className={`${sharedClasses.pageShell} ${classes.page}`}>
      <ErpBreadcrumb parent="기본정보관리" current="일반코드관리" />

      <div className={classes.workspace}>
        <CodeMasterGroupPanel groups={groups} visibleGroups={visibleGroups} groupQuery={groupQuery} setGroupQuery={setGroupQuery} totalCodes={totalCodes} loading={loading} uploadProgress={uploadProgress} selectedId={selectedId} onSelectGroup={handleSelectGroup} />

        <Paper className={`${sharedClasses.panel} ${classes.codePanel}`} withBorder>
          <Group className={`${sharedClasses.panelHeader} ${classes.codeHeader}`} justify="space-between" align="flex-start" wrap="wrap" gap="sm">
            <Box>
              <Group gap={9} align="center"><Text className={classes.codeTitle} fw={800}>{selectedGroup?.name || '코드 그룹'}</Text><Badge color="gray" variant="light">{selectedGroup?.rowCount || 0}개</Badge></Group>
              <Text size="xs" c="dimmed" mt={5}>{selectedGroup?.helpText || selectedGroup?.description || (selectedGroup ? `${selectedGroup.groupcode} · 회사 공통 코드` : '그룹을 추가하거나 왼쪽에서 선택하세요.')}</Text>
            </Box>
            <Group gap={7} align="flex-end" wrap="wrap">
              <Select
                className={classes.statusFilter}
                id="code-status-filter"
                label="사용 여부"
                aria-label="사용 여부 필터"
                value={statusFilter === 'Y' ? '사용중' : statusFilter === 'N' ? '사용중지' : '전체'}
                onChange={(value) => {
                  setStatusFilter(value === '사용중' ? 'Y' : value === '사용중지' ? 'N' : 'all');
                  setSelectedRows([]);
                  selectionAnchorRef.current = '';
                }}
                data={['전체', '사용중', '사용중지']}
                w={126}
                size="sm"
                allowDeselect={false}
                disabled={!selectedGroup || loading}
              />
              <Group gap={7} align="center" wrap="nowrap">
                <Button variant="default" size="sm" leftSection={<IconDownload size={15} />} onClick={downloadTemplate} disabled={!selectedGroup}>샘플양식</Button>
                <Button size="sm" variant="light" leftSection={<IconUpload size={15} />} onClick={() => uploadInputRef.current?.click()} loading={Boolean(uploadProgress)} disabled={loading || saving}>
                  {uploadProgress || '엑셀 일괄등록'}
                </Button>
                <input ref={uploadInputRef} type="file" accept=".xlsx,.xls" onChange={uploadCodes} hidden />
              </Group>
            </Group>
          </Group>

          <Group className={`${sharedClasses.toolbar} ${classes.toolbar}`} justify="space-between" wrap="wrap" gap={6}>
            <Group className={classes.searchGroup} gap={6} wrap="nowrap">
              <TextInput
                className={classes.codeSearch}
                placeholder="코드 또는 코드명 검색"
                aria-label="코드 검색"
                leftSection={<IconSearch size={15} />}
                value={codeQueryInput}
                onChange={(event) => setCodeQueryInput(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    setCodeQuery(codeQueryInput);
                    setSelectedRows([]);
                    selectionAnchorRef.current = '';
                  }
                }}
                size="sm"
                disabled={!selectedGroup}
              />
            </Group>
            <Group gap={7} wrap="nowrap">
              {selectedRows.length > 0 && <Text size="xs" c="dimmed">{selectedRows.length}개 선택</Text>}
            </Group>
          </Group>

          <Box className={`${sharedClasses.tableWrap} ${classes.tableWrap}`} style={{ '--code-table-min-width': `${Math.max(900, tableWidth)}px` }} onKeyDown={handleTableKeyDown}>
            <TableVirtuoso
              ref={tableRef}
              data={visibleRows}
              context={{
                columnCount: headerColumns.length,
                emptyMessage: codeQuery.trim() ? '검색 결과가 없습니다.' : '표시할 코드가 없습니다.',
              }}
              style={{ height: '100%' }}
              components={codeMasterVirtuosoComponents}
              computeItemKey={(_index, row) => row.id}
              defaultItemHeight={58}
              increaseViewportBy={{ top: 160, bottom: 320 }}
              key={`${selectedId}-${codeQuery}`}
              fixedHeaderContent={() => <Table.Tr>{headerColumns.map(renderResizableHeader)}</Table.Tr>}
              itemContent={renderCodeCells}
            />
          </Box>

          <Group className={`${sharedClasses.footer} ${classes.tableFooter}`} justify="space-between" wrap="wrap">
            <Text size="xs" c="dimmed">총 {totalForView}개</Text>
          </Group>
        </Paper>
      </div>

      <Modal opened={Boolean(deleteRequest)} onClose={() => !saving && setDeleteRequest(null)} title="공통코드 삭제" centered size="xs" padding="sm">
        <Stack gap="sm">
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
