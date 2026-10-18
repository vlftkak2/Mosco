import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import * as XLSX from 'xlsx';
import {
  Badge, Box, Button, Code, Group, Loader,
  Modal, Paper, ScrollArea, SimpleGrid, Table, Text, TextInput, Textarea, Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconBraces, IconChevronDown, IconChevronUp, IconFileUpload, IconPlus, IconPlayerPlay, IconRefresh, IconTrash } from '@tabler/icons-react';
import sharedClasses from '../styles/pages/ManagementShared.module.css';
import dashboardClasses from '../styles/pages/HomePage.module.css';
import classes from '../styles/pages/AIOrder.module.css';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_PDF_PAGES = 10;
const MOCK_MODE = import.meta.env.VITE_AI_ORDER_MOCK_MODE === 'true';
const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });
const MOCK_RESULT = {
  success: true,
  extraction: {
    header: {
      order_number: 'MOCK-20261018-001', order_date: '2026-10-18', buyer: '샘플 발주처',
      seller: '샘플 수주처', due_date: '2026-10-25', title: '철강 주문서 Mock',
      common_notes: 'UI 확인용 샘플입니다.',
      source_locations: [
        { field_name: 'order_number', raw_text: 'MOCK-20261018-001', page_number: 1, verification_status: 'demo', coordinate_system: 'normalized_top_left_0_1', bounding_box: [0.06, 0.25, 0.50, 0.35] },
        { field_name: 'order_date', raw_text: '2026-10-18', page_number: 1, verification_status: 'demo', coordinate_system: 'normalized_top_left_0_1', bounding_box: [0.50, 0.25, 0.94, 0.35] },
        { field_name: 'buyer', raw_text: '샘플 발주처', page_number: 1, verification_status: 'demo', coordinate_system: 'normalized_top_left_0_1', bounding_box: [0.06, 0.35, 0.50, 0.45] },
        { field_name: 'due_date', raw_text: '2026-10-25', page_number: 1, verification_status: 'demo', coordinate_system: 'normalized_top_left_0_1', bounding_box: [0.50, 0.35, 0.94, 0.45] },
        { field_name: 'seller', raw_text: '샘플 수주처', page_number: 1, verification_status: 'demo', coordinate_system: 'normalized_top_left_0_1', bounding_box: [0.06, 0.45, 0.50, 0.55] },
        { field_name: 'title', raw_text: '철강 주문서 Mock', page_number: 1, verification_status: 'demo', coordinate_system: 'normalized_top_left_0_1', bounding_box: [0.50, 0.45, 0.94, 0.55] },
        { field_name: 'common_notes', raw_text: 'UI 확인용 샘플입니다.', page_number: 1, verification_status: 'demo', coordinate_system: 'normalized_top_left_0_1', bounding_box: [0.06, 0.55, 0.94, 0.62] },
      ],
    },
    items: [{
      source_product_name: '냉연강판', steel_grade: 'SPCC', spec_raw: '0.6 × 191',
      thickness: 0.6, width: 191, length: null, quantity: 100, quantity_unit: 'EA',
      weight_kg: 1250, unit_price: null, amount: null, notes: null, quantity_raw: '100',
      weight_raw: '1,250 KG', source_reference: 'Mock 예시', source_locations: [
        { field_name: 'source_product_name', raw_text: '냉연강판', page_number: 1, verification_status: 'demo', coordinate_system: 'normalized_top_left_0_1', bounding_box: [0.06, 0.75, 0.44, 0.89] },
        { field_name: 'steel_grade', raw_text: 'SPCC', page_number: 1, verification_status: 'demo', coordinate_system: 'normalized_top_left_0_1', bounding_box: [0.06, 0.75, 0.44, 0.89] },
        { field_name: 'spec_raw', raw_text: '0.6 × 191', page_number: 1, verification_status: 'demo', coordinate_system: 'normalized_top_left_0_1', bounding_box: [0.44, 0.75, 0.72, 0.89] },
        { field_name: 'quantity_raw', raw_text: '100', page_number: 1, verification_status: 'demo', coordinate_system: 'normalized_top_left_0_1', bounding_box: [0.72, 0.75, 0.94, 0.89] },
        { field_name: 'quantity_unit', raw_text: 'EA', page_number: 1, verification_status: 'demo', coordinate_system: 'normalized_top_left_0_1', bounding_box: [0.72, 0.75, 0.94, 0.89] },
        { field_name: 'weight_raw', raw_text: '1,250 KG', page_number: 1, verification_status: 'demo', coordinate_system: 'normalized_top_left_0_1', bounding_box: [0.72, 0.75, 0.94, 0.89] },
      ], needs_review: true,
      review_reasons: ['Mock 데이터입니다. 실제 문서와 대조해주세요.'],
    }],
  },
  erp_matching: { status: 'not_run', items: [{ line_no: 1, itemcode: null, candidates: [] }] },
  usage: {
    model: 'Mock', input_tokens: 0, output_tokens: 0, reasoning_tokens: 0,
    cached_input_tokens: 0, estimated_cost_usd: 0, monthly_budget_usd: 0,
    month_to_date_usd: 0, daily_limit: 0, daily_used: 0, mode: 'mock',
  },
};

const HEADER_FIELDS = [
  ['order_number', '발주번호'], ['order_date', '발주일자'], ['buyer', '발주처'],
  ['seller', '수주처'], ['due_date', '납기일'], ['title', '제목'],
];
const LINE_COLUMNS = [
  ['source_product_name', '품명', 180], ['steel_grade', '강종', 100], ['spec_raw', '규격 원본', 190],
  ['thickness', '두께', 90], ['width', '폭', 90], ['length', '길이', 90],
  ['quantity', '정규화 수량', 110], ['quantity_raw', '수량 원문', 130], ['quantity_unit', '수량단위', 100], ['weight_kg', '중량(KG)', 115], ['weight_raw', '중량 원문', 130],
  ['unit_price', '단가', 110], ['amount', '금액', 120], ['notes', '비고', 180],
];

function numberInputValue(value) {
  return value === null || value === undefined ? '' : String(value);
}

function numericValue(raw) {
  const cleaned = String(raw).replaceAll(',', '').trim();
  if (!cleaned || !/^-?(?:\d+\.?\d*|\.\d+)$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function formatBytes(size) {
  return size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(2)} MB` : `${(size / 1024).toFixed(1)} KB`;
}

function getExtractionCompleteness(extraction) {
  if (!extraction) return { percent: 0, filled: 0, total: 0 };
  const headerKeys = ['order_number', 'order_date', 'buyer', 'seller', 'due_date'];
  const values = headerKeys.map((key) => extraction.header?.[key]);
  for (const item of extraction.items || []) {
    values.push(item.source_product_name, item.spec_raw, item.quantity ?? item.quantity_raw, item.quantity_unit);
  }
  const filled = values.filter((value) => value !== null && value !== undefined && String(value).trim() !== '').length;
  const total = values.length;
  return { percent: total ? Math.round((filled / total) * 100) : 0, filled, total };
}

function sourceFieldFor(field) {
  if (field === 'quantity') return 'quantity_raw';
  if (field === 'weight_kg') return 'weight_raw';
  if (['thickness', 'width', 'length'].includes(field)) return 'spec_raw';
  return field;
}

function ExtractionFieldLabel({ label, source, onClick }) {
  return <Group className={classes.extractionFieldLabel} justify="space-between" gap={6} wrap="nowrap">
    <Text component="span" size="xs" fw={600}>{label}</Text>
    {source?.verification_status === 'verified' && <button type="button" className={classes.aiExtractTag} onClick={onClick} title="검증된 AI 원본 좌표 보기">AI 추출</button>}
  </Group>;
}

function originDescription(source) {
  if (!source) return '';
  if (source.verification_status === 'demo') return `Mock 예시 문서 · ${source.page_number || 1}페이지 · “${source.raw_text || ''}” (실제 업로드 문서의 출처가 아닙니다)`;
  if (source.verification_status === 'verified' && source.sheet_name) return `${source.sheet_name}!${source.cell_address || '셀 위치'} · 원문 “${source.raw_text || ''}” · 셀 검증 완료`;
  if (source.verification_status === 'verified' && source.page_number) {
    const box = source.bounding_box?.map((value) => Number(value).toFixed(3)).join(', ');
    return `${source.page_number}페이지 · 원문 “${source.raw_text || ''}” · PDF 텍스트 위치 검증 완료${box ? ` · 정규화 좌표 [${box}]` : ''}`;
  }
  return `${source.page_number ? `${source.page_number}페이지 · ` : ''}AI가 제시한 원문 “${source.raw_text || ''}” · 원본 위치를 독립적으로 검증하지 못해 강조 표시하지 않습니다.`;
}

function MockCoordinatePreview({ selectedLocation }) {
  const box = selectedLocation?.bounding_box;
  return <Box className={classes.mockCoordinatePreview}>
    <Group justify="space-between" mb="xs" wrap="wrap">
      <Text size="sm" fw={700}>Mock 원본 좌표 예시</Text>
      <Badge color="orange" variant="light">실제 업로드 문서의 좌표가 아닙니다</Badge>
    </Group>
    <Box className={classes.mockDocument}>
      <Text className={classes.mockDocumentTitle}>철강 주문서 · 좌표 동작 예시</Text>
      <Box className={classes.mockDocumentHeaderFields}>
        <Box>발주번호 <b>MOCK-20261018-001</b></Box><Box>발주일자 <b>2026-10-18</b></Box>
        <Box>발주처 <b>샘플 발주처</b></Box><Box>납기일 <b>2026-10-25</b></Box>
        <Box>수주처 <b>샘플 수주처</b></Box><Box>제목 <b>철강 주문서 Mock</b></Box>
      </Box>
      <Box className={classes.mockDocumentNote}>공통 비고 · UI 확인용 샘플입니다.</Box>
      <Box className={classes.mockDocumentTable}>
        <Box className={classes.mockDocumentHeader}><span>품명</span><span>규격</span><span>수량</span></Box>
        <Box className={classes.mockDocumentRow}><span>냉연강판 · SPCC</span><span>0.6 × 191</span><span>100 EA · 1,250 KG</span></Box>
      </Box>
      {box && <Box className={classes.mockCoordinateHighlight} style={{ left: `${box[0] * 100}%`, top: `${box[1] * 100}%`, width: `${(box[2] - box[0]) * 100}%`, height: `${(box[3] - box[1]) * 100}%` }} />}
    </Box>
    <Text size="xs" c="dimmed" mt="xs">선택한 항목: {selectedLocation?.raw_text || '—'} · 정규화 좌표 (0~1). 이 예시는 화면 동작 확인용이며 업로드 파일을 분석한 위치 정보가 아닙니다.</Text>
  </Box>;
}

function PdfPreview({ file, selectedLocation, currentPage, setCurrentPage, pageCount, setPageCount }) {
  const [pdfDocument, setPdfDocument] = useState(null);
  const canvasRef = useRef(null);
  useEffect(() => {
    let active = true;
    let loadingTask;
    setPdfDocument(null);
    setPageCount(0);
    file.arrayBuffer().then(async (buffer) => {
      if (!active) return;
      const [pdfjsLib, worker] = await Promise.all([
        import('pdfjs-dist'),
        import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
      ]);
      if (!active) return;
      pdfjsLib.GlobalWorkerOptions.workerSrc = worker.default;
      loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
      return loadingTask.promise;
    }).then((document) => {
      if (!active || !document) return;
      setPdfDocument(document);
      setPageCount(document.numPages);
      setCurrentPage((page) => Math.min(Math.max(1, page), document.numPages));
    }).catch(() => { if (active) setPdfDocument(null); });
    return () => { active = false; loadingTask?.destroy(); };
  }, [file, setCurrentPage, setPageCount]);
  useEffect(() => {
    if (!pdfDocument || !canvasRef.current) return undefined;
    let active = true;
    let renderTask;
    pdfDocument.getPage(currentPage).then((page) => {
      if (!active) return;
      const viewport = page.getViewport({ scale: 1.4 });
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      renderTask = page.render({ canvasContext: context, viewport });
      return renderTask.promise;
    }).catch(() => {});
    return () => { active = false; renderTask?.cancel(); };
  }, [pdfDocument, currentPage]);
  const box = selectedLocation?.verification_status === 'verified' && selectedLocation?.page_number === currentPage
    ? selectedLocation.bounding_box : null;
  return <Box className={classes.pdfViewer}>
    <Group justify="center" gap="xs" className={classes.pdfControls}>
      <Button size="xs" variant="default" disabled={currentPage <= 1} onClick={() => setCurrentPage((page) => page - 1)}>이전</Button>
      <Text size="xs">{currentPage} / {pageCount || '—'} 페이지</Text>
      <Button size="xs" variant="default" disabled={!pageCount || currentPage >= pageCount} onClick={() => setCurrentPage((page) => page + 1)}>다음</Button>
    </Group>
    {!pdfDocument ? <Box className={classes.previewEmpty}>PDF를 불러오는 중이거나 미리보기를 표시할 수 없습니다.</Box> : <Box className={classes.pdfPageStage}>
      <Box className={classes.pdfCanvasWrap}>
        <canvas ref={canvasRef} className={classes.pdfCanvas} />
        {box && <Box className={classes.sourceHighlight} style={{ left: `${box[0] * 100}%`, top: `${box[1] * 100}%`, width: `${(box[2] - box[0]) * 100}%`, height: `${(box[3] - box[1]) * 100}%` }} />}
      </Box>
    </Box>}
  </Box>;
}

function ImagePreview({ previewUrl, selectedLocation }) {
  const box = selectedLocation?.verification_status === 'verified' ? selectedLocation.bounding_box : null;
  return <Box className={classes.imageViewer}>
    <Box className={classes.imageStage}>
      <img src={previewUrl} alt="주문서 원본" />
      {box && <Box className={classes.sourceHighlight} style={{ left: `${box[0] * 100}%`, top: `${box[1] * 100}%`, width: `${(box[2] - box[0]) * 100}%`, height: `${(box[3] - box[1]) * 100}%` }} />}
    </Box>
  </Box>;
}

function Preview({ file, previewUrl, workbook, selectedLocation, currentPage, setCurrentPage, pageCount, setPageCount, activeSheet, setActiveSheet }) {
  if (!file) return <Box className={classes.previewEmpty}>주문서 파일을 선택하면 원본 미리보기가 여기에 표시됩니다.</Box>;
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension === 'pdf') return <PdfPreview file={file} selectedLocation={selectedLocation} currentPage={currentPage} setCurrentPage={setCurrentPage} pageCount={pageCount} setPageCount={setPageCount} />;
  if (['jpg', 'jpeg', 'png'].includes(extension)) return <ImagePreview previewUrl={previewUrl} selectedLocation={selectedLocation} />;
  if (extension === 'xlsx' && workbook) {
    const sourceSheet = selectedLocation?.verification_status === 'verified' ? selectedLocation.sheet_name : null;
    const sheetName = activeSheet && workbook.Sheets[activeSheet] ? activeSheet : (sourceSheet && workbook.Sheets[sourceSheet] ? sourceSheet : workbook.SheetNames[0]);
    const worksheet = workbook.Sheets[sheetName];
    const range = worksheet?.['!ref'] ? XLSX.utils.decode_range(worksheet['!ref']) : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
    const highlightedCell = selectedLocation?.verification_status === 'verified' && selectedLocation.sheet_name === sheetName ? selectedLocation.cell_address : null;
    return <Box className={classes.excelPreview}>
      <Group gap={4} className={classes.sheetTabs} wrap="nowrap">
        {workbook.SheetNames.map((name) => <Button key={name} size="compact-xs" variant={name === sheetName ? 'light' : 'subtle'} onClick={() => setActiveSheet(name)}>{name}</Button>)}
      </Group>
      <ScrollArea type="auto" className={classes.excelGridScroll}>
        <Table withTableBorder withColumnBorders striped className={classes.excelGrid}>
          <Table.Thead><Table.Tr><Table.Th className={classes.excelRowNumber}>행</Table.Th>{Array.from({ length: range.e.c - range.s.c + 1 }, (_, offset) => <Table.Th key={offset}>{XLSX.utils.encode_col(range.s.c + offset)}</Table.Th>)}</Table.Tr></Table.Thead>
          <Table.Tbody>{Array.from({ length: range.e.r - range.s.r + 1 }, (_, rowOffset) => {
            const row = range.s.r + rowOffset;
            return <Table.Tr key={row}><Table.Th className={classes.excelRowNumber}>{row + 1}</Table.Th>{Array.from({ length: range.e.c - range.s.c + 1 }, (_, colOffset) => {
              const address = XLSX.utils.encode_cell({ r: row, c: range.s.c + colOffset });
              return <Table.Td key={address} className={address === highlightedCell ? classes.highlightedCell : undefined}>{String(worksheet?.[address]?.w ?? worksheet?.[address]?.v ?? '')}</Table.Td>;
            })}</Table.Tr>;
          })}</Table.Tbody>
        </Table>
      </ScrollArea>
    </Box>;
  }
  return <Box className={classes.previewEmpty}>이 Excel 파일은 표 미리보기로 표시할 수 없습니다.</Box>;
}

function UsageValue({ label, value }) {
  return <Box className={classes.usageValue}><Text size="xs" c="dimmed">{label}</Text><Text size="sm" fw={700}>{value}</Text></Box>;
}


const MAX_FILES = 10;
const USER_CONCURRENCY = 2;

function makeDocument(file) {
  return {
    id: globalThis.crypto?.randomUUID?.() || `file-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    file, status: 'ready', error: '', extraction: null, originalResponse: null, usage: null,
  };
}

function documentStatus(doc) {
  if (doc.status === 'analyzing') return ['분석 중', 'blue'];
  if (doc.status === 'queued') return ['대기', 'gray'];
  if (doc.status === 'failed') return ['실패', 'red'];
  if (doc.extraction?.items?.some((item) => item.needs_review)) return ['확인 필요', 'orange'];
  if (doc.status === 'completed') return ['검토 완료', 'teal'];
  return ['분석 전', 'gray'];
}

function OrderDocumentWorkspace({ doc, updateDocument, openJson, reanalyze }) {
  const previewUrl = useMemo(() => doc.file ? URL.createObjectURL(doc.file) : '', [doc.file]);
  const [workbook, setWorkbook] = useState(null);
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [originMessage, setOriginMessage] = useState('AI 추출 라벨을 누르면 원본 출처와 위치 확인 상태를 표시합니다.');
  const [selectedRows, setSelectedRows] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [activeSheet, setActiveSheet] = useState('');
  const extraction = doc.extraction;
  const completeness = getExtractionCompleteness(extraction);
  const updateExtraction = (transform) => updateDocument(doc.id, (current) => ({ ...current, extraction: transform(current.extraction) }));

  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, [previewUrl]);

  useEffect(() => {
    if (!doc.file) return undefined;
    let active = true;
    if (doc.file.name.toLowerCase().endsWith('.xlsx')) {
      doc.file.arrayBuffer().then((buffer) => { if (active) setWorkbook(XLSX.read(buffer, { type: 'array', cellDates: true })); })
        .catch(() => { if (active) setWorkbook(null); });
    }
    return () => { active = false; };
  }, [doc.id, doc.file]);

  const updateHeader = (key, value) => updateExtraction((current) => ({ ...current, header: { ...current.header, [key]: value || null } }));
  const updateLine = (index, key, rawValue) => updateExtraction((current) => ({
    ...current,
    items: current.items.map((item, itemIndex) => itemIndex !== index ? item : {
      ...item,
      [key]: ['thickness', 'width', 'length', 'quantity', 'weight_kg', 'unit_price', 'amount'].includes(key) ? numericValue(rawValue) : (rawValue || null),
      __draft: { ...(item.__draft || {}), [key]: rawValue },
    }),
  }));
  const addLine = () => updateExtraction((current) => ({ ...current, items: [...current.items, {
    source_product_name: null, steel_grade: null, spec_raw: null, thickness: null, width: null, length: null,
    quantity: null, quantity_raw: null, quantity_unit: null, weight_kg: null, weight_raw: null,
    unit_price: null, amount: null, notes: null, source_reference: null, source_locations: [],
    needs_review: true, review_reasons: ['사용자가 추가한 행입니다. 원본과 대조해주세요.'],
  }] }));
  const toggleRowSelection = (index) => setSelectedRows((current) => current.includes(index) ? current.filter((rowIndex) => rowIndex !== index) : [...current, index]);
  const deleteSelectedRows = () => {
    const selected = new Set(selectedRows);
    updateExtraction((current) => ({ ...current, items: current.items.filter((_, index) => !selected.has(index)) }));
    setSelectedRows([]); setSelectedLocation(null);
  };
  const selectSource = (lineIndex, source) => {
    setSelectedLocation({ lineIndex, ...source }); setOriginMessage(originDescription(source));
    if (source.verification_status === 'verified' && source.page_number) setCurrentPage(source.page_number);
    if (source.verification_status === 'verified' && source.sheet_name) setActiveSheet(source.sheet_name);
  };
  const selectHeaderSource = (field, label) => {
    const source = extraction?.header?.source_locations?.find((location) => location.field_name === sourceFieldFor(field));
    if (source) selectSource(-1, source);
    else { setSelectedLocation(null); setOriginMessage(`${label}: 원본 출처 정보가 없습니다.`); }
  };
  const selectItemSource = (index, field, label) => {
    const source = extraction?.items?.[index]?.source_locations?.find((location) => location.field_name === sourceFieldFor(field));
    if (source) selectSource(index, source);
    else { setSelectedLocation(null); setOriginMessage(`${label}: 원본 출처 정보가 없습니다.`); }
  };
  const [statusLabel, statusColor] = documentStatus(doc);

  return <>
    <Group className={classes.selectedDocumentHeader} justify="space-between" wrap="wrap">
      <Box><Text size="xs" c="dimmed">선택한 발주서</Text><Text fw={700} lineClamp={1}>{doc.file.name}</Text><Text size="xs" c="dimmed">파일 ID {doc.id}{doc.originalResponse?.request_id ? ` · 분석 요청 ID ${doc.originalResponse.request_id}` : ''}</Text></Box>
      <Group gap="xs"><Badge color={statusColor} variant="light">{statusLabel}</Badge>
        {doc.usage && <Badge color={doc.usage.mode === 'mock' ? 'gray' : 'blue'} variant="light">{doc.usage.mode === 'mock' ? 'Mock' : doc.usage.model} · ${Number(doc.usage.estimated_cost_usd || 0).toFixed(6)}</Badge>}
        {doc.extraction && <Button size="xs" variant="default" leftSection={<IconRefresh size={14} />} onClick={() => reanalyze(doc)} disabled={['queued', 'analyzing'].includes(doc.status)}>재분석</Button>}
        <Button size="xs" variant="default" leftSection={<IconBraces size={14} />} onClick={() => openJson(doc)} disabled={!doc.originalResponse}>원본 JSON</Button>
      </Group>
    </Group>
    {doc.error && <Text className={classes.documentError} size="sm" c="red">{doc.error}</Text>}
    <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="md" className={classes.workspace}>
      <Paper className={`${sharedClasses.panel} ${classes.workPanel}`} withBorder>
        <Group className={classes.panelHeader} justify="space-between"><Text fw={700}>원본 주문서</Text><Badge variant="light" color="gray">{doc.file.name.split('.').pop()?.toUpperCase()}</Badge></Group>
        <Text className={classes.originStatus} size="xs" title={originMessage}>{originMessage}</Text>
        <Box className={classes.previewArea}>{selectedLocation?.verification_status === 'demo'
          ? <MockCoordinatePreview selectedLocation={selectedLocation} />
          : <Preview file={doc.file} previewUrl={previewUrl} workbook={workbook} selectedLocation={selectedLocation} currentPage={currentPage} setCurrentPage={setCurrentPage} pageCount={pageCount} setPageCount={setPageCount} activeSheet={activeSheet} setActiveSheet={setActiveSheet} />}</Box>
      </Paper>
      <Paper className={`${sharedClasses.panel} ${classes.workPanel}`} withBorder>
        <Group className={classes.panelHeader} justify="space-between"><Text fw={700}>AI 추출 결과</Text><Group gap="xs">
          {extraction && <Badge color="blue" variant="light" title="필수 필드가 채워진 비율이며 인식 정확도 점수는 아닙니다.">추출 정보 {completeness.percent}%</Badge>}
          {extraction && <Badge color={extraction.items.some((item) => item.needs_review) ? 'orange' : 'teal'} variant="light">{extraction.items.filter((item) => item.needs_review).length}건 확인 필요</Badge>}
        </Group></Group>
        {!extraction ? <Box className={classes.resultEmpty}>{doc.status === 'analyzing' ? <Group><Loader size="sm" /> AI 분석 중입니다.</Group> : doc.status === 'queued' ? '분석 대기 중입니다.' : '목록에서 발주서를 선택하고 분석을 실행해주세요.'}</Box> : <ScrollArea className={classes.resultScroll} type="auto">
          <Box p="md"><Text size="sm" fw={700} mb="xs">주문서 헤더</Text>
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="xs">
              {HEADER_FIELDS.map(([key, label]) => <TextInput key={key} label={<ExtractionFieldLabel label={label} source={extraction.header.source_locations?.find((location) => location.field_name === sourceFieldFor(key))} onClick={() => selectHeaderSource(key, label)} />} value={extraction.header[key] || ''} onChange={(event) => updateHeader(key, event.currentTarget.value)} />)}
            </SimpleGrid>
            <Textarea mt="xs" label={<ExtractionFieldLabel label="공통 비고" source={extraction.header.source_locations?.find((location) => location.field_name === 'common_notes')} onClick={() => selectHeaderSource('common_notes', '공통 비고')} />} minRows={2} value={extraction.header.common_notes || ''} onChange={(event) => updateHeader('common_notes', event.currentTarget.value)} />
            <Group justify="space-between" mt="lg" mb="xs"><Group gap="xs"><Text size="sm" fw={700}>상세 품목</Text><Badge variant="light" color="gray">{extraction.items.length.toLocaleString()}행</Badge></Group><Group gap="xs">
              <Text size="xs" c="dimmed">선택 {selectedRows.length}건</Text><Button size="xs" variant="light" color="red" leftSection={<IconTrash size={14} />} disabled={!selectedRows.length} onClick={deleteSelectedRows}>선택 삭제</Button><Button size="xs" color="red" leftSection={<IconPlus size={14} />} onClick={addLine}>행 추가</Button>
            </Group></Group>
            {!extraction.items.length ? <Box className={classes.resultEmpty}>인식된 품목 행이 없습니다.</Box> : <ScrollArea type="auto" className={classes.gridScroll}>
              <Table withTableBorder withColumnBorders highlightOnHover className={classes.resultGrid}>
                <Table.Thead><Table.Tr><Table.Th className={classes.selectColumn}><input type="checkbox" aria-label="상세 전체 선택" checked={extraction.items.length > 0 && selectedRows.length === extraction.items.length} onChange={(event) => setSelectedRows(event.currentTarget.checked ? extraction.items.map((_, index) => index) : [])} /></Table.Th><Table.Th className={classes.rowNumber}>No.</Table.Th>{LINE_COLUMNS.map(([key, label, width]) => <Table.Th key={key} style={{ minWidth: width }}>{label}</Table.Th>)}</Table.Tr></Table.Thead>
                <Table.Tbody>{extraction.items.map((item, index) => <Table.Tr key={`${index}-${item.source_reference || ''}`} className={`${item.needs_review ? classes.reviewRow : ''} ${selectedLocation?.lineIndex === index ? classes.selectedRow : ''}`}>
                  <Table.Td ta="center" className={classes.selectColumn}><input type="checkbox" aria-label={`${index + 1}행 선택`} checked={selectedRows.includes(index)} onChange={() => toggleRowSelection(index)} /></Table.Td><Table.Td ta="center" className={classes.rowNumber}>{index + 1}{item.needs_review && <Badge className={classes.reviewBadge} size="xs" color="orange" variant="light">확인</Badge>}</Table.Td>
                  {LINE_COLUMNS.map(([key, label]) => { const source = item.source_locations?.find((location) => location.field_name === sourceFieldFor(key)); return <Table.Td key={key}><Box className={classes.detailInputCell}><ExtractionFieldLabel label={label} source={source} onClick={() => selectItemSource(index, key, label)} /><input className={classes.cellInput} aria-label={`${index + 1}행 ${label}`} value={item.__draft?.[key] ?? (['quantity_raw', 'weight_raw'].includes(key) ? (item[key] || '') : numberInputValue(item[key]))} onFocus={() => selectItemSource(index, key, label)} onChange={(event) => updateLine(index, key, event.currentTarget.value)} /></Box></Table.Td>; })}
                </Table.Tr>)}</Table.Tbody>
              </Table>
            </ScrollArea>}
            {doc.usage && <SimpleGrid cols={{ base: 2, sm: 4 }} mt="md" spacing="xs"><UsageValue label="입력 토큰" value={Number(doc.usage.input_tokens || 0).toLocaleString()} /><UsageValue label="출력 토큰" value={Number(doc.usage.output_tokens || 0).toLocaleString()} /><UsageValue label="추론 토큰" value={Number(doc.usage.reasoning_tokens || 0).toLocaleString()} /><UsageValue label="예상 비용" value={`$${Number(doc.usage.estimated_cost_usd || 0).toFixed(6)}`} /></SimpleGrid>}
          </Box>
        </ScrollArea>}
      </Paper>
    </SimpleGrid>
  </>;
}

export default function AIOrderPage() {
  const fileInputRef = useRef(null);
  const activeRequests = useRef(new Set());
  const abortControllers = useRef(new Map());
  const [documents, setDocuments] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [expandedList, setExpandedList] = useState(false);
  const [jsonDoc, setJsonDoc] = useState(null);
  const [validating, setValidating] = useState(false);
  const updateDocument = useCallback((id, updater) => setDocuments((current) => current.map((doc) => doc.id === id ? (typeof updater === 'function' ? updater(doc) : { ...doc, ...updater }) : doc)), []);
  const selectedDoc = documents.find((doc) => doc.id === selectedId) || documents[0] || null;

  const validateAndAdd = async (fileList) => {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;
    setValidating(true);
    const accepted = [];
    for (const file of incoming) {
      if (documents.length + accepted.length >= MAX_FILES) { notifications.show({ title: '업로드 제한', message: `발주서는 한 번에 최대 ${MAX_FILES}개까지 등록할 수 있습니다.`, color: 'orange' }); break; }
      if (file.size > MAX_FILE_BYTES || !/\.(pdf|jpe?g|png|xlsx)$/i.test(file.name)) {
        notifications.show({ title: '업로드할 수 없는 파일', message: `${file.name}: PDF, JPG, PNG, XLSX 및 10MB 이하 파일만 지원합니다.`, color: 'orange' }); continue;
      }
      if (file.name.toLowerCase().endsWith('.pdf')) {
        let task;
        try {
          const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
          pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
          task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
          const pdf = await task.promise;
          if (pdf.numPages > MAX_PDF_PAGES) { notifications.show({ title: 'PDF 페이지 제한', message: `${file.name}: 최대 ${MAX_PDF_PAGES}페이지까지 가능합니다.`, color: 'orange' }); continue; }
        } catch { notifications.show({ title: 'PDF 확인 실패', message: `${file.name}: PDF 파일을 읽을 수 없습니다.`, color: 'red' }); continue; }
        finally { await task?.destroy().catch(() => {}); }
      }
      accepted.push(makeDocument(file));
    }
    if (accepted.length) {
      setDocuments((current) => [...current, ...accepted]);
      setSelectedId((current) => current || accepted[0].id);
    }
    setValidating(false);
  };

  const processDocument = useCallback(async (doc) => {
    updateDocument(doc.id, { status: 'analyzing', error: '' });
    try {
      let payload;
      if (MOCK_MODE) {
        await new Promise((resolve) => window.setTimeout(resolve, 450));
        payload = structuredClone(MOCK_RESULT);
      } else {
        const form = new FormData(); form.append('file', doc.file);
        const controller = new AbortController(); abortControllers.current.set(doc.id, controller);
        const response = await axios.post('/api/ai-order/analyze', form, {
          ...authConfig(), timeout: 120000, signal: controller.signal,
          headers: { ...authConfig().headers, 'Idempotency-Key': globalThis.crypto?.randomUUID?.() || `ai-order-${Date.now()}-${Math.random().toString(36).slice(2)}` },
        });
        payload = response.data;
      }
      updateDocument(doc.id, { status: 'completed', originalResponse: payload, extraction: structuredClone(payload.extraction), usage: payload.usage, error: '' });
    } catch (error) {
      const message = error.response?.data?.detail || '분석 요청에 실패했습니다. 파일과 서버 설정을 확인해주세요.';
      updateDocument(doc.id, { status: 'failed', error: message });
    } finally {
      abortControllers.current.delete(doc.id);
      activeRequests.current.delete(doc.id);
    }
  }, [updateDocument]);

  useEffect(() => {
    const queue = documents.filter((doc) => doc.status === 'queued' && !activeRequests.current.has(doc.id));
    for (const doc of queue) {
      if (activeRequests.current.size >= USER_CONCURRENCY) break;
      activeRequests.current.add(doc.id);
      void processDocument(doc);
    }
  }, [documents, processDocument]);

  useEffect(() => () => { abortControllers.current.forEach((controller) => controller.abort()); }, []);

  const startBatch = () => {
    const targets = documents.filter((doc) => ['ready', 'failed'].includes(doc.status));
    if (!targets.length) return;
    const actualCount = targets.filter((doc) => !MOCK_MODE && doc.usage?.mode !== 'mock').length;
    if (actualCount && !window.confirm(`${targets.length}개 파일을 분석 대기열에 넣습니다. 실제 API 분석은 파일별 비용이 발생할 수 있습니다. 계속할까요?`)) return;
    const idSet = new Set(targets.map((doc) => doc.id));
    setDocuments((current) => current.map((doc) => idSet.has(doc.id) ? { ...doc, status: 'queued', error: '' } : doc));
  };
  const reanalyze = (doc) => {
    if (!MOCK_MODE && !window.confirm('이 파일을 다시 분석하면 OpenAI API가 다시 호출되어 추가 비용이 발생합니다. 계속할까요?')) return;
    updateDocument(doc.id, { status: 'queued', error: '', extraction: null, originalResponse: null, usage: null });
  };
  const clearDocuments = () => {
    if (activeRequests.current.size) return;
    setDocuments([]); setSelectedId(null); setJsonDoc(null);
  };
  const statusCounts = documents.reduce((counts, doc) => { const [label] = documentStatus(doc); counts[label] = (counts[label] || 0) + 1; return counts; }, {});

  return <Box className={`${sharedClasses.pageShell} ${classes.page} ${classes.batchPage}`}>
    <Paper className={dashboardClasses.dashboardHeader}><Box className={dashboardClasses.headerCopy}>
      <Text className={sharedClasses.breadcrumb}>가공관리 <span>›</span> AI 가공솔루션 <span>›</span> 주문서 인식</Text>
      <Title order={1} className={`${dashboardClasses.pageTitle} ${classes.pageTitle}`}>AI <span>주문서 인식</span></Title>
      <Text className={dashboardClasses.pageSubtitle}>여러 거래처의 주문서를 파일별로 분석하고 원본과 결과를 비교합니다. 분석 결과는 ERP 전표나 재고에 저장되지 않습니다.</Text>
      <Group className={dashboardClasses.sampleNotice} gap={8}><span className={dashboardClasses.statusDot} /><Text size="xs">{MOCK_MODE ? '브라우저 Mock 모드 · API 호출 없음' : 'OpenAI API 분석 · 파일별 독립 처리'}</Text></Group>
    </Box></Paper>

    <Paper className={`${sharedClasses.panel} ${classes.uploadPanel}`} withBorder>
      <Group justify="space-between" align="center" wrap="wrap" gap="md">
        <Box className={classes.uploadDropzone} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void validateAndAdd(event.dataTransfer.files); }}>
          <input ref={fileInputRef} className={classes.hiddenFileInput} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.xlsx" onChange={(event) => { void validateAndAdd(event.currentTarget.files); event.currentTarget.value = ''; }} />
          <Box className={classes.uploadIcon}><IconFileUpload size={22} /></Box><Box className={classes.uploadCopy}>
            <Text size="sm" fw={700}>{validating ? '파일 형식과 PDF 페이지를 확인하고 있습니다.' : '주문서 여러 개를 선택하거나 여기에 끌어놓으세요.'}</Text>
            <Text size="xs" c="dimmed">PDF · JPG · PNG · XLSX · 파일당 최대 10MB · PDF 최대 10페이지 · 최대 {MAX_FILES}개</Text>
          </Box><Button variant="default" size="sm" onClick={() => fileInputRef.current?.click()} disabled={validating}>파일 선택</Button>
        </Box>
        <Group gap="xs"><Button variant="default" leftSection={<IconTrash size={15} />} onClick={clearDocuments} disabled={!documents.length || activeRequests.current.size > 0}>목록 비우기</Button>
          <Button color="red" leftSection={<IconPlayerPlay size={15} />} onClick={startBatch} disabled={validating || !documents.some((doc) => ['ready', 'failed'].includes(doc.status))}>AI 일괄 분석</Button>
        </Group>
      </Group>
      {documents.length > 0 && <Group gap="xs" mt="sm">{Object.entries(statusCounts).map(([label, count]) => <Badge key={label} variant="light" color={label === '실패' ? 'red' : label === '확인 필요' ? 'orange' : 'gray'}>{label} {count}</Badge>)}<Text size="xs" c="dimmed">동시 분석 최대 {USER_CONCURRENCY}건, 나머지는 대기합니다.</Text></Group>}
    </Paper>

    <Paper className={`${sharedClasses.panel} ${classes.batchListPanel}`} withBorder>
      <Group justify="space-between" className={classes.listHeader}><Text fw={700}>발주서 목록 <Badge ml="xs" variant="light" color="gray">{documents.length}건</Badge></Text><Group gap="xs"><Text size="xs" c="dimmed">{documents.filter((doc) => doc.extraction?.items?.some((item) => item.needs_review)).length}건 확인 필요</Text>{documents.length > 5 && <Button size="compact-xs" variant="subtle" rightSection={expandedList ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />} onClick={() => setExpandedList((value) => !value)}>{expandedList ? '접기' : '펼치기'}</Button>}</Group></Group>
      {!documents.length ? <Text className={classes.listEmpty} size="sm" c="dimmed">분석할 주문서 파일을 추가해주세요.</Text> : <ScrollArea className={classes.orderListScroll} type="auto"><Table highlightOnHover withTableBorder withColumnBorders className={classes.orderListTable}>
        <Table.Thead><Table.Tr><Table.Th>파일명</Table.Th><Table.Th>인식 거래처</Table.Th><Table.Th>발주번호</Table.Th><Table.Th>상태</Table.Th><Table.Th ta="right">품목 수</Table.Th><Table.Th ta="right">확인 필요</Table.Th><Table.Th ta="right">비용</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>{documents.slice(0, expandedList ? documents.length : 5).map((doc) => { const [label, color] = documentStatus(doc); return <Table.Tr key={doc.id} className={doc.id === selectedDoc?.id ? classes.activeDocumentRow : undefined} onClick={() => setSelectedId(doc.id)} style={{ cursor: 'pointer' }}>
          <Table.Td><Group gap="xs" wrap="nowrap">{doc.status === 'analyzing' && <Loader size={12} />}<Text size="sm" lineClamp={1} title={doc.file.name}>{doc.file.name}</Text></Group>{doc.error && <Text size="xs" c="red" lineClamp={1}>{doc.error}</Text>}</Table.Td>
          <Table.Td>{doc.extraction?.header?.buyer || (doc.status === 'analyzing' ? '분석 중' : '미확인')}</Table.Td><Table.Td>{doc.extraction?.header?.order_number || '—'}</Table.Td>
          <Table.Td><Badge color={color} variant="light">{label}</Badge></Table.Td><Table.Td ta="right">{doc.extraction ? doc.extraction.items.length.toLocaleString() : '—'}</Table.Td>
          <Table.Td ta="right">{doc.extraction ? doc.extraction.items.filter((item) => item.needs_review).length.toLocaleString() : '—'}</Table.Td><Table.Td ta="right">{doc.usage ? `$${Number(doc.usage.estimated_cost_usd || 0).toFixed(6)}` : '—'}</Table.Td>
        </Table.Tr>; })}</Table.Tbody>
      </Table></ScrollArea>}
    </Paper>

    <Box className={classes.comparisonArea}>{selectedDoc ? <OrderDocumentWorkspace key={selectedDoc.id} doc={selectedDoc} updateDocument={updateDocument} openJson={setJsonDoc} reanalyze={reanalyze} /> : <Paper withBorder className={classes.noSelection}><Text c="dimmed">발주서 목록에서 파일을 선택하면 원본과 추출 결과를 표시합니다.</Text></Paper>}</Box>
    <Modal opened={Boolean(jsonDoc)} onClose={() => setJsonDoc(null)} title="AI 원본 응답 JSON" size="xl" centered>
      {jsonDoc?.originalResponse ? <ScrollArea h="70vh"><Code block className={classes.jsonBlock}>{JSON.stringify(jsonDoc.originalResponse, null, 2)}</Code></ScrollArea> : <Text c="dimmed">분석 결과가 없습니다.</Text>}
      {jsonDoc?.originalResponse && <Text size="xs" c="dimmed" mt="sm">파일: {jsonDoc.file.name} · Grid에서 수정한 값은 원본 응답과 별도로 유지됩니다.</Text>}
    </Modal>
  </Box>;
}
