import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import {
  Badge,
  Box,
  Button,
  Group,
  Modal,
  Pagination,
  Paper,
  Select,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconDeviceFloppy, IconDownload, IconPlus, IconSearch, IconUpload, IconX } from '@tabler/icons-react';
import * as XLSX from 'xlsx';
import classes from '../styles/pages/CustomPage.module.css';
import dashboardClasses from '../styles/pages/HomePage.module.css';

const PAGE_SIZE_OPTIONS = [
  { value: '15', label: '15개씩' },
  { value: '50', label: '50개씩' },
  { value: '100', label: '100개씩' },
  { value: '200', label: '200개씩' },
];

const emptyCustomer = () => ({
  companyid: localStorage.getItem('user_company') || '',
  companyname: localStorage.getItem('user_companyname') || '',
  customercode: '',
  customername: '',
  businessno: '',
  corporationno: '',
  ceoname: '',
  tradetype: '매입처',
  businesstype: '',
  industry: '',
  manager: '',
  zipcode: '',
  phone: '',
  fax: '',
  email: '',
  bankcode: '',
  bankname: '',
  accountno: '',
  address: '',
  address2: '',
  useyn: 'Y',
  remark: '',
});

const toCustomer = (row) => ({
  companyid: row.companyid ?? '',
  companyname: row.companyname ?? '',
  customercode: row.customercode ?? '',
  customername: row.customername ?? '',
  businessno: row.businessno ?? '',
  corporationno: row.corporationno ?? '',
  ceoname: row.ceoname ?? '',
  tradetype: row.tradetype || '매입처',
  businesstype: row.businesstype ?? '',
  industry: row.industry ?? '',
  manager: row.manager ?? '',
  zipcode: row.zipcode ?? '',
  phone: row.phone ?? '',
  fax: row.fax ?? '',
  email: row.email ?? '',
  bankcode: row.bankcode ?? '',
  bankname: row.bankname ?? '',
  accountno: row.accountno ?? '',
  address: row.address ?? '',
  address2: row.address2 ?? '',
  useyn: row.useyn ?? 'Y',
  remark: row.remark ?? '',
});

const errorMessage = (error, fallback) => {
  const detail = error.response?.data?.detail;
  if (Array.isArray(detail)) return detail.map((item) => item.msg).join(', ');
  return detail || error.response?.data?.message || error.message || fallback;
};

const CustomerTable = memo(function CustomerTable({ customers, selectedCode, loading, onSelect }) {
  return (
    <Table className={classes.partnerTable} highlightOnHover>
      <Table.Thead>
        <Table.Tr>
          <Table.Th w={34}></Table.Th>
          <Table.Th>코드</Table.Th>
          <Table.Th>거래처명 (상호)</Table.Th>
          <Table.Th>대표자</Table.Th>
          <Table.Th>사업자번호</Table.Th>
          <Table.Th>전화</Table.Th>
          <Table.Th>팩스</Table.Th>
          <Table.Th>사용여부</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {customers.length ? customers.map((customer) => (
          <Table.Tr
            key={`${customer.companyid}-${customer.customercode}`}
            className={customer.customercode === selectedCode ? classes.selectedRow : ''}
            onClick={() => onSelect(customer)}
          >
            <Table.Td><span className={`${classes.radio} ${customer.customercode === selectedCode ? classes.radioSelected : ''}`} /></Table.Td>
            <Table.Td className={classes.codeCell}>{customer.customercode}</Table.Td>
            <Table.Td className={classes.partnerNameCell}>{customer.customername}</Table.Td>
            <Table.Td>{customer.ceoname || '-'}</Table.Td>
            <Table.Td>{customer.businessno || '-'}</Table.Td>
            <Table.Td>{customer.phone || '-'}</Table.Td>
            <Table.Td>{customer.fax || '-'}</Table.Td>
            <Table.Td><Badge color={customer.useyn === 'Y' ? 'teal' : 'gray'} variant="light">{customer.useyn === 'Y' ? '사용' : '미사용'}</Badge></Table.Td>
          </Table.Tr>
        )) : (
          <Table.Tr><Table.Td colSpan={8} className={classes.emptyState}>{loading ? '불러오는 중...' : '검색 결과가 없습니다.'}</Table.Td></Table.Tr>
        )}
      </Table.Tbody>
    </Table>
  );
});

const CustomerListPanel = memo(function CustomerListPanel({
  customers,
  total,
  page,
  pageCount,
  pageSize,
  statusFilter,
  tradetypeFilter,
  query,
  loading,
  uploadProgress,
  exportLoading,
  uploadInputRef,
  onQueryChange,
  onSearch,
  onStatusChange,
  onTradetypeChange,
  onPageChange,
  onPageSizeChange,
  onStartNew,
  onDownloadTemplate,
  onExport,
  onUpload,
  onSelect,
  selectedCode,
}) {
  return (
    <Paper className={classes.listPanel} withBorder>
      <Group className={classes.panelHeader} justify="space-between" wrap="wrap">
        <Group gap="xs"><Text fw={700}>거래처 등록 목록</Text><Badge color="red" variant="light">{total}건</Badge></Group>
        <Group gap={6} wrap="wrap" align="flex-end">
          <Select label="사용 여부" aria-label="사용 여부 필터" value={statusFilter} onChange={onStatusChange} data={[{ value: '전체', label: '전체' }, { value: 'Y', label: '사용' }, { value: 'N', label: '미사용' }]} w={116} size="xs" />
          <Select label="거래 구분" aria-label="거래구분 필터" value={tradetypeFilter} onChange={onTradetypeChange} data={['전체', '매입처', '매출처', '매입매출처', '가공처']} w={132} size="xs" />
          <Button variant="default" size="xs" leftSection={<IconDownload size={14} />} onClick={onDownloadTemplate}>샘플양식</Button>
          <Button variant="light" size="xs" leftSection={<IconDownload size={14} />} onClick={onExport} loading={exportLoading}>엑셀 다운로드</Button>
        </Group>
      </Group>
      <Group className={classes.listToolbar} gap={6} wrap="nowrap">
        <TextInput
          className={classes.searchInput}
          placeholder="코드 또는 거래처명을 입력해주세요"
          value={query}
          onChange={(event) => onQueryChange(event.currentTarget.value)}
          onKeyDown={(event) => event.key === 'Enter' && onSearch()}
          leftSection={<IconSearch size={15} />}
          size="xs"
        />
        <Button size="xs" leftSection={<IconSearch size={14} />} onClick={onSearch} loading={loading} disabled={loading}>조회</Button>
        <Button size="xs" color="red" leftSection={<IconPlus size={14} />} onClick={onStartNew}>신규등록</Button>
        <Button size="xs" variant="light" leftSection={<IconUpload size={14} />} onClick={() => uploadInputRef.current?.click()} loading={Boolean(uploadProgress)} disabled={loading && !uploadProgress}>
          {uploadProgress || '엑셀 일괄등록'}
        </Button>
        <input ref={uploadInputRef} type="file" accept=".xlsx,.xls" onChange={onUpload} hidden />
      </Group>
      <Box className={classes.tableWrap}>
        <CustomerTable customers={customers} selectedCode={selectedCode} loading={loading} onSelect={onSelect} />
      </Box>
      <Group className={classes.listFooter} justify="space-between" wrap="wrap">
        <Group gap="xs">
          <Text size="xs" c="dimmed">총 {total}개 항목</Text>
          <Select aria-label="페이지당 표시 수" value={String(pageSize)} onChange={onPageSizeChange} data={PAGE_SIZE_OPTIONS} w={100} size="xs" />
        </Group>
        <Pagination total={pageCount} value={page} onChange={onPageChange} size="sm" disabled={loading} />
      </Group>
    </Paper>
  );
});

const CustomerFormPanel = memo(function CustomerFormPanel({ draft, isNew, saving, banks, managers, onChange, onBankChange, onReset, onSave }) {
  const [addressOpen, setAddressOpen] = useState(false);
  const [postcodeReady, setPostcodeReady] = useState(Boolean(window.kakao?.Postcode));
  const [postcodeError, setPostcodeError] = useState(false);
  const postcodeContainerRef = useRef(null);

  useEffect(() => {
    if (window.kakao?.Postcode) {
      const readyTimer = window.setTimeout(() => setPostcodeReady(true), 0);
      return () => window.clearTimeout(readyTimer);
    }
    const existingScript = document.querySelector('script[data-kakao-postcode]');
    const script = existingScript || document.createElement('script');
    const handleLoad = () => {
      if (window.kakao?.Postcode || window.daum?.Postcode) setPostcodeReady(true);
      else setPostcodeError(true);
    };
    const handleError = () => setPostcodeError(true);
    script.addEventListener('load', handleLoad);
    script.addEventListener('error', handleError);
    if (!existingScript) {
      script.src = 'https://t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
      script.async = true;
      script.dataset.kakaoPostcode = 'true';
      document.body.appendChild(script);
    }
    return () => {
      script.removeEventListener('load', handleLoad);
      script.removeEventListener('error', handleError);
    };
  }, []);

  useEffect(() => {
    if (!addressOpen || !postcodeReady) return;
    // Mantine mounts modal contents through a portal/transition; wait for its
    // container to be attached and sized before asking Kakao to embed the iframe.
    const mountTimer = window.setTimeout(() => {
      const container = postcodeContainerRef.current;
      const Postcode = window.kakao?.Postcode || window.daum?.Postcode;
      if (!container || !Postcode) {
        setPostcodeError(true);
        return;
      }
      container.replaceChildren();
      new Postcode({
        oncomplete: (data) => {
          onChange('zipcode', data.zonecode || '');
          onChange('address', data.address || data.roadAddress || data.jibunAddress || '');
          setAddressOpen(false);
        },
        width: '100%',
        height: '100%',
      }).embed(container);
    }, 100);
    return () => window.clearTimeout(mountTimer);
  }, [addressOpen, postcodeReady, onChange]);

  return (
    <Paper className={classes.formPanel} withBorder>
      <Group className={classes.panelHeader} justify="space-between">
        <Group gap="xs"><span className={classes.statusDot} /><Text fw={700}>상세 정보 입력 및 수정</Text></Group>
        <Badge color={isNew ? 'teal' : 'blue'} variant="light">{isNew ? '신규 등록' : '조회 모드'}</Badge>
      </Group>
      <Box className={classes.formBody}>
        <div className={classes.formGrid}>
          <TextInput label="거래처 코드" value={draft.customercode} onChange={(event) => onChange('customercode', event.currentTarget.value)} disabled={!isNew} />
          <Select label="거래구분" value={draft.tradetype} onChange={(value) => onChange('tradetype', value || '')} data={['매입처', '매출처', '매입매출처', '가공처']} />
          
          <TextInput label="거래처명 (상호)" value={draft.customername} onChange={(event) => onChange('customername', event.currentTarget.value)} required />
          <TextInput label="대표자" value={draft.ceoname} onChange={(event) => onChange('ceoname', event.currentTarget.value)} />

          <TextInput label="사업자번호" placeholder="000-00-00000" value={draft.businessno} onChange={(event) => onChange('businessno', event.currentTarget.value)} />
          <TextInput label="법인번호" placeholder="000000-0000000" value={draft.corporationno} onChange={(event) => onChange('corporationno', event.currentTarget.value)} />
        
          <TextInput label="업태" value={draft.businesstype} onChange={(event) => onChange('businesstype', event.currentTarget.value)} />
          <TextInput label="업종" value={draft.industry} onChange={(event) => onChange('industry', event.currentTarget.value)} />
        
          <Select className={classes.selectPointer} label="담당자" value={draft.manager || null} onChange={(value) => onChange('manager', value || '')} data={managers} searchable clearable nothingFoundMessage="담당자 데이터가 없습니다" />
          <Group className={`${classes.formWideField} ${classes.addressField}`} align="flex-end" wrap="nowrap">
            <TextInput className={classes.zipcodeInput} label="우편번호" value={draft.zipcode} readOnly />
            <TextInput className={classes.addressInput} label="주소" value={draft.address} onChange={(event) => onChange('address', event.currentTarget.value)} />
            <Button variant="light" onClick={() => setAddressOpen(true)}>주소 찾기</Button>
          </Group>
          <TextInput className={classes.formWideField} label="상세주소" value={draft.address2} onChange={(event) => onChange('address2', event.currentTarget.value)} />

          <TextInput label="전화번호" value={draft.phone} onChange={(event) => onChange('phone', event.currentTarget.value)} />
          <TextInput label="팩스" value={draft.fax} onChange={(event) => onChange('fax', event.currentTarget.value)} />

          <TextInput label="이메일" value={draft.email} onChange={(event) => onChange('email', event.currentTarget.value)} />
          <Select label="사용 여부" value={draft.useyn} onChange={(value) => onChange('useyn', value || 'Y')} data={[{ value: 'Y', label: '사용' }, { value: 'N', label: '미사용' }]} />

          <Select className={classes.selectPointer} label="은행" value={draft.bankcode || null} onChange={onBankChange} data={banks.map((bank) => ({ value: bank.bankcode, label: bank.bankname }))} searchable clearable nothingFoundMessage="등록된 은행이 없습니다" />
          <TextInput label="계좌번호" value={draft.accountno} onChange={(event) => onChange('accountno', event.currentTarget.value)} />
          <Textarea className={classes.formWideField} label="비고 사항" value={draft.remark} onChange={(event) => onChange('remark', event.currentTarget.value)} minRows={2} autosize maxRows={4} />
        </div>
      </Box>
      <Group className={classes.formFooter} justify="flex-end">
        <Button variant="default" onClick={onReset}>초기화</Button>
        <Button color="red" onClick={onSave} loading={saving} leftSection={<IconDeviceFloppy size={15} />}>저장 및 적용</Button>
      </Group>
      <Modal opened={addressOpen} onClose={() => setAddressOpen(false)} title="주소 찾기" centered size="lg">
        {postcodeError ? <Text size="sm" c="red">주소 검색을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</Text> : postcodeReady ? <div ref={postcodeContainerRef} className={classes.postcodeContainer} /> : <Text size="sm" c="dimmed">주소 검색을 불러오는 중...</Text>}
      </Modal>
    </Paper>
  );
});

export default function CustomerPage() {
  const companyid = localStorage.getItem('user_company') || '';
  const companyname = localStorage.getItem('user_companyname') || '';
  const [banks, setBanks] = useState([]);
  const [managers, setManagers] = useState([]);
  const [lookupsLoaded, setLookupsLoaded] = useState(false);
  const [lookupLoadError, setLookupLoadError] = useState(false);
  const [customers, setCustomers] = useState([]);
  const [selectedCode, setSelectedCode] = useState(null);
  const [draft, setDraft] = useState(emptyCustomer);
  const [isNew, setIsNew] = useState(false);
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('전체');
  const [tradetypeFilter, setTradetypeFilter] = useState('전체');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [total, setTotal] = useState(0);
  const [listLoading, setListLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [allocatingCode, setAllocatingCode] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [exportLoading, setExportLoading] = useState(false);
  const uploadInputRef = useRef(null);
  const pageCount = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [pageSize, total]);

  const loadCustomers = useCallback(async () => {
    if (!companyid) return;
    setListLoading(true);
    try {
      const { data } = await axios.get('/api/list', {
        params: {
          companyid,
          search_keyword: appliedQuery || undefined,
          status: statusFilter === '전체' ? undefined : statusFilter,
          tradetype: tradetypeFilter === '전체' ? undefined : tradetypeFilter,
          page,
          page_size: pageSize,
        },
      });
      if (data.success === false) throw new Error(data.error || '거래처 목록을 불러오지 못했습니다.');
      const rows = (data.data || []).map(toCustomer);
      setCustomers(rows);
      setTotal(data.total ?? rows.length);
      setSelectedCode((current) => current || rows[0]?.customercode || null);
    } catch (error) {
      notifications.show({ title: '목록 조회 실패', message: errorMessage(error, '서버 연결을 확인해 주세요.'), color: 'red', position: 'bottom-right' });
    } finally {
      setListLoading(false);
    }
  }, [appliedQuery, companyid, page, pageSize, statusFilter, tradetypeFilter]);

  useEffect(() => { loadCustomers(); }, [loadCustomers]);

  useEffect(() => {
    if (!companyid) return;
    Promise.all([
      axios.get('/api/banks', { params: { companyid } }),
      axios.get('/api/managers', { params: { companyid } }),
    ]).then(([bankResponse, managerResponse]) => {
      setBanks(bankResponse.data.data || []);
      setManagers(managerResponse.data.data || []);
      setLookupsLoaded(true);
    }).catch((error) => {
      setLookupLoadError(true);
      setLookupsLoaded(true);
      notifications.show({ title: '목록 조회 실패', message: errorMessage(error, '은행 또는 담당자 목록을 불러오지 못했습니다.'), color: 'red', position: 'bottom-right' });
    });
  }, [companyid]);

  useEffect(() => {
    if (isNew) return;
    const selected = customers.find((customer) => customer.customercode === selectedCode);
    if (selected) setDraft(selected);
    else if (customers.length === 0 && !selectedCode) setDraft(emptyCustomer());
  }, [customers, isNew, selectedCode]);

  const selectCustomer = useCallback((customer) => {
    setSelectedCode(customer.customercode);
    setDraft(customer);
    setIsNew(false);
  }, []);

  const handleQueryChange = useCallback((value) => setQuery(value), []);
  const handleSearch = useCallback(() => {
    setPage(1);
    setAppliedQuery(query.trim());
  }, [query]);
  const handleStatusChange = useCallback((value) => {
    setStatusFilter(value || '전체');
    setPage(1);
  }, []);
  const handleTradetypeChange = useCallback((value) => {
    setTradetypeFilter(value || '전체');
    setPage(1);
  }, []);
  const handlePageSizeChange = useCallback((value) => {
    setPageSize(Number(value) || 20);
    setPage(1);
  }, []);
  const updateDraft = useCallback((field, value) => {
    setDraft((current) => ({ ...current, [field]: value }));
  }, []);

  const updateBank = useCallback((bankcode) => {
    const bank = banks.find((item) => item.bankcode === bankcode);
    setDraft((current) => ({ ...current, bankcode: bank?.bankcode || '', bankname: bank?.bankname || '' }));
  }, [banks]);

  const startNewCustomer = useCallback(async () => {
    if (!companyid) {
      notifications.show({ title: '회사 정보 갱신 필요', message: '로그아웃한 뒤 다시 로그인해 주세요.', color: 'orange', position: 'bottom-right' });
      return;
    }
    setAllocatingCode(true);
    try {
      const { data } = await axios.get('/api/next-code', { params: { companyid } });
      setDraft({ ...emptyCustomer(), customercode: data.customercode });
      setSelectedCode(null);
      setIsNew(true);
    } catch (error) {
      notifications.show({ title: '거래처코드 발급 실패', message: errorMessage(error, '다시 시도해 주세요.'), color: 'red', position: 'bottom-right' });
    } finally {
      setAllocatingCode(false);
    }
  }, [companyid]);

  const refreshAfterWrite = useCallback(async (resetFilters = false) => {
    if (!resetFilters) return loadCustomers();
    const alreadyAtDefault = page === 1 && !appliedQuery && statusFilter === '전체' && tradetypeFilter === '전체';
    setPage(1);
    setAppliedQuery('');
    setQuery('');
    setStatusFilter('전체');
    setTradetypeFilter('전체');
    if (alreadyAtDefault) await loadCustomers();
  }, [appliedQuery, loadCustomers, page, statusFilter, tradetypeFilter]);

  const saveCustomer = useCallback(async () => {
    if (!draft.customername.trim()) {
      notifications.show({ title: '필수 항목 확인', message: '거래처명은 필수입니다.', color: 'red', position: 'bottom-right' });
      return;
    }
    if (!draft.companyid || !draft.companyname) {
      notifications.show({ title: '회사 정보 갱신 필요', message: '로그아웃한 뒤 다시 로그인해 주세요.', color: 'orange', position: 'bottom-right' });
      return;
    }
    const creating = isNew;
    const payload = { ...draft, customercode: draft.customercode.trim(), customername: draft.customername.trim() };
    setSaving(true);
    try {
      const { data } = await axios.post(creating ? '/api/create' : '/api/update', payload);
      if (data.success === false) throw new Error(data.message || '저장하지 못했습니다.');
      const savedCustomer = { ...payload, customercode: data.customercode || payload.customercode };
      notifications.show({ title: creating ? '등록 완료' : '수정 완료', message: data.message || '거래처 정보를 저장했습니다.', color: 'teal', position: 'bottom-right' });
      setIsNew(false);
      setSelectedCode(savedCustomer.customercode);
      setDraft(savedCustomer);
      await refreshAfterWrite(creating);
    } catch (error) {
      notifications.show({ title: creating ? '등록 실패' : '변경 실패', message: errorMessage(error, '거래처 저장에 실패했습니다.'), color: 'red', icon: <IconX size={18} />, position: 'bottom-right' });
    } finally {
      setSaving(false);
    }
  }, [draft, isNew, refreshAfterWrite]);

  const resetDraft = useCallback(() => {
    if (isNew) {
      setDraft({ ...emptyCustomer(), customercode: draft.customercode });
      return;
    }
    const selected = customers.find((customer) => customer.customercode === selectedCode);
    if (selected) setDraft(selected);
    else setDraft(emptyCustomer());
  }, [customers, draft.customercode, isNew, selectedCode]);

  const downloadTemplate = useCallback(() => {
    const headers = ['거래처코드(선택/자동채번)', '거래구분', '거래처명', '대표자명', '사업자번호', '법인번호', '업태', '업종', '담당자', '우편번호', '주소', '상세주소', '전화번호', '팩스', '이메일', '사용여부(Y/N)', '은행코드', '은행명', '계좌번호', '비고'];
    const worksheet = XLSX.utils.aoa_to_sheet([headers, ['', '매입처', '모스코', '김찬수', '', '', '', '', '', '', '', '', '', '', '', 'Y', '', '', '', '']]);
    worksheet['!cols'] = headers.map(() => ({ wch: 18 }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '거래처');
    XLSX.writeFile(workbook, '거래처_일괄등록_샘플.xlsx');
  }, []);

  const exportCustomers = useCallback(async () => {
    if (!companyid) return;
    setExportLoading(true);
    try {
      const { data } = await axios.get('/api/export', {
        params: {
          companyid,
          search_keyword: appliedQuery || undefined,
          status: statusFilter === '전체' ? undefined : statusFilter,
          tradetype: tradetypeFilter === '전체' ? undefined : tradetypeFilter,
        },
      });
      if (data.success === false) throw new Error(data.error || '엑셀 데이터를 불러오지 못했습니다.');
      const headers = ['거래처코드', '거래구분', '거래처명', '대표자명', '사업자번호', '법인번호', '업태', '업종', '담당자', '우편번호', '주소', '상세주소', '전화번호', '팩스', '이메일', '사용여부(Y/N)', '은행코드', '은행명', '계좌번호', '비고'];
      const worksheet = XLSX.utils.aoa_to_sheet([
        headers,
        ...(data.data || []).map((customer) => [
          customer.customercode ?? '', customer.tradetype ?? '', customer.customername ?? '', customer.ceoname ?? '',
          customer.businessno ?? '', customer.corporationno ?? '', customer.businesstype ?? '', customer.industry ?? '',
          customer.manager ?? '', customer.zipcode ?? '', customer.address ?? '', customer.address2 ?? '',
          customer.phone ?? '', customer.fax ?? '', customer.email ?? '', customer.useyn ?? '',
          customer.bankcode ?? '', customer.bankname ?? '', customer.accountno ?? '', customer.remark ?? '',
        ]),
      ]);
      worksheet['!cols'] = [24, 16, 26, 16, 18, 18, 18, 18, 16, 14, 36, 36, 18, 18, 26, 16, 16, 20, 24, 30].map((wch) => ({ wch }));
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, '거래처목록');
      const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
      XLSX.writeFile(workbook, `거래처목록_${date}.xlsx`);
      notifications.show({ title: '엑셀 다운로드 완료', message: `${(data.data || []).length.toLocaleString()}건을 저장했습니다.`, color: 'teal', position: 'bottom-right' });
    } catch (error) {
      notifications.show({ title: '엑셀 다운로드 실패', message: errorMessage(error, '거래처 데이터를 내려받지 못했습니다.'), color: 'red', position: 'bottom-right' });
    } finally {
      setExportLoading(false);
    }
  }, [appliedQuery, companyid, statusFilter, tradetypeFilter]);

  const uploadCustomers = useCallback(async (event) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    if (!companyid || !companyname) {
      notifications.show({ title: '회사 정보 갱신 필요', message: '로그아웃한 뒤 다시 로그인해 주세요.', color: 'orange', position: 'bottom-right' });
      return;
    }
    if (!lookupsLoaded || lookupLoadError) {
      notifications.show({ title: '목록 확인 필요', message: '담당자와 은행 목록을 불러온 뒤 다시 업로드해 주세요.', color: 'orange', position: 'bottom-right' });
      return;
    }

    setUploadProgress('엑셀 파일 읽는 중');
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      if (rows.length > 10000) throw new Error('한 번에 최대 10,000행까지 등록할 수 있습니다.');
      const aliases = {
        customercode: ['customercode', '거래처코드', '거래처 코드', '거래처코드(자동채번)', '거래처코드(선택/자동채번)'],
        customername: ['customername', '거래처명', '거래처명(상호)', '상호명'],
        businessno: ['businessno', '사업자번호', '사업자등록번호'],
        corporationno: ['corporationno', '법인번호'],
        ceoname: ['ceoname', '대표자명', '대표자', '대표자 성명'],
        tradetype: ['tradetype', '거래구분'],
        businesstype: ['businesstype', '업태'],
        industry: ['industry', '업종'],
        manager: ['manager', '담당자'],
        zipcode: ['zipcode', '우편번호'],
        phone: ['phone', '전화번호', '대표 연락처', '연락처'],
        fax: ['fax', '팩스'],
        email: ['email', '이메일'],
        bankcode: ['bankcode', 'bank_code', '은행코드', '은행 코드'],
        bankname: ['bankname', '은행'],
        accountno: ['accountno', '계좌번호'],
        address: ['address', '주소', '사업장 주소'],
        address2: ['address2', '상세주소', '상세 주소'],
        useyn: ['useyn', '사용여부', '사용 여부'],
        remark: ['remark', '비고'],
      };
      const imported = rows.map((row, rowIndex) => {
        const normalized = Object.fromEntries(Object.entries(row).map(([key, value]) => [key.trim().toLowerCase().replace(/\s+/g, ''), String(value).trim()]));
        const customer = emptyCustomer();
        customer.companyid = companyid;
        customer.companyname = companyname;
        Object.entries(aliases).forEach(([field, names]) => {
          const key = names.find((name) => normalized[name.toLowerCase().replace(/\s+/g, '')] !== undefined);
          if (key) customer[field] = normalized[key.toLowerCase().replace(/\s+/g, '')];
        });
        if (customer.useyn === '사용중') customer.useyn = 'Y';
        if (customer.useyn === '사용중지') customer.useyn = 'N';
        return { ...customer, _excelRow: rowIndex + 2 };
      }).filter((customer) => customer.customercode || customer.customername);

      if (!imported.length) throw new Error('업로드할 데이터가 없습니다. 샘플 양식의 첫 번째 시트를 확인해 주세요.');
      const failures = [];
      const validCustomers = [];
      imported.forEach((customer, index) => {
        const rowErrors = [];
        const rowNumber = customer._excelRow || index + 2;
        if (!customer.customername) rowErrors.push('거래처명 필수');

        const normalizedManager = customer.manager.trim().toLocaleLowerCase();
        if (normalizedManager) {
          const manager = managers.find((item) => item.trim().toLocaleLowerCase() === normalizedManager);
          if (!manager) rowErrors.push(`담당자 '${customer.manager}'가 DB에 없습니다`);
          else customer.manager = manager;
        }

        const code = customer.bankcode.trim();
        const name = customer.bankname.trim();
        const normalize = (value) => value.trim().toLocaleLowerCase();
        const bankByCode = code && banks.find((bank) => bank.bankcode.trim() === code);
        const bankByName = name && banks.find((bank) => normalize(bank.bankname) === normalize(name));
        if (code && !bankByCode) rowErrors.push(`은행코드 '${code}'가 DB에 없습니다`);
        if (name && !bankByName) rowErrors.push(`은행 '${name}'이 DB에 없습니다`);
        if (bankByCode && bankByName && bankByCode.bankcode !== bankByName.bankcode) {
          rowErrors.push(`은행코드 '${code}'와 은행명 '${name}'이 서로 다릅니다`);
        }
        const matchedBank = bankByCode || bankByName;
        if (matchedBank) {
          customer.bankcode = matchedBank.bankcode;
          customer.bankname = matchedBank.bankname;
        }
        if (customer.accountno.trim() && !matchedBank) rowErrors.push('계좌번호가 있으면 등록된 은행을 선택해야 합니다');

        if (rowErrors.length) failures.push(`${rowNumber}행: ${rowErrors.join(', ')}`);
        else {
          const { _excelRow, ...payload } = customer;
          validCustomers.push(payload);
        }
      });

      let generatedCodes = [];
      if (validCustomers.length) {
        setUploadProgress(`${validCustomers.length.toLocaleString()}건 서버 등록 중`);
        const { data } = await axios.post('/api/bulk-create', { customers: validCustomers });
        if (data.success === false) throw new Error(data.message || '일괄 등록에 실패했습니다.');
        generatedCodes = data.generated_codes || [];
      }
      notifications.show({
        title: validCustomers.length === 0 && failures.length ? '일괄 등록 중단' : failures.length ? '일괄 등록 완료 (일부 제외)' : '일괄 등록 완료',
        message: `${validCustomers.length}건 등록${generatedCodes.length ? ` (자동채번 ${generatedCodes.length}건: ${generatedCodes.slice(0, 3).join(', ')}${generatedCodes.length > 3 ? ' 외' : ''})` : ''}${failures.length ? `, ${failures.length}건 제외: ${failures.slice(0, 3).join(' / ')}` : ''}`,
        color: failures.length ? 'orange' : 'teal',
        position: 'bottom-right',
        autoClose: 7000,
      });
      if (validCustomers.length > 0) await refreshAfterWrite(true);
    } catch (error) {
      notifications.show({ title: '엑셀 업로드 실패', message: errorMessage(error, '파일을 읽지 못했습니다.'), color: 'red', icon: <IconX size={18} />, position: 'bottom-right' });
    } finally {
      setUploadProgress('');
    }
  }, [banks, companyid, companyname, lookupLoadError, lookupsLoaded, managers, refreshAfterWrite]);

  return (
    <Box className={classes.page}>
      <Paper className={dashboardClasses.dashboardHeader}>
        <Box className={dashboardClasses.headerCopy}>
          <Text className={classes.breadcrumb}>시스템 관리 <span>›</span> 거래처 등록</Text>
          <Title order={1} className={dashboardClasses.pageTitle}>거래처 <span>등록</span></Title>
          <Text className={dashboardClasses.pageSubtitle}>거래처 정보를 조회하고 등록·관리합니다.</Text>
          <Group className={dashboardClasses.sampleNotice} gap={8}>
            <span className={dashboardClasses.statusDot} />
            <Text size="xs">System Active</Text>
          </Group>
        </Box>
      </Paper>

      <div className={classes.workspace}>
        <CustomerListPanel
          customers={customers}
          total={total}
          page={page}
          pageCount={pageCount}
          pageSize={pageSize}
          statusFilter={statusFilter}
          tradetypeFilter={tradetypeFilter}
          query={query}
          loading={listLoading}
          uploadProgress={uploadProgress}
          exportLoading={exportLoading}
          uploadInputRef={uploadInputRef}
          onQueryChange={handleQueryChange}
          onSearch={handleSearch}
          onStatusChange={handleStatusChange}
          onTradetypeChange={handleTradetypeChange}
          onPageChange={setPage}
          onPageSizeChange={handlePageSizeChange}
          onStartNew={startNewCustomer}
          onDownloadTemplate={downloadTemplate}
          onExport={exportCustomers}
          onUpload={uploadCustomers}
          onSelect={selectCustomer}
          selectedCode={selectedCode}
        />
        <CustomerFormPanel
          draft={draft}
          isNew={isNew}
          saving={saving || allocatingCode}
          banks={banks}
          managers={managers}
          onChange={updateDraft}
          onBankChange={updateBank}
          onReset={resetDraft}
          onSave={saveCustomer}
        />
      </div>
    </Box>
  );
}
