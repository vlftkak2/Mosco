import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import {
  Badge, Box, Button, Code, Group, Loader, Progress,
  Modal, Paper, ScrollArea, SimpleGrid, Table, Text, TextInput, Textarea, ThemeIcon, Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconBraces, IconChevronDown, IconChevronUp, IconFileUpload, IconPlus, IconPlayerPlay, IconRefresh, IconTrash } from '@tabler/icons-react';
import sharedClasses from '../styles/pages/ManagementShared.module.css';
import dashboardClasses from '../styles/pages/HomePage.module.css';
import classes from '../styles/pages/AIOrder.module.css';

const MAX_FILE_BYTES = 30 * 1024 * 1024;
const MAX_PDF_PAGES = 10;
const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });
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

async function detectImageContentType(file) {
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'PNG';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'JPEG';
  if ((bytes[0] === 0x49 && bytes[1] === 0x49 && ((bytes[2] === 0x2a && bytes[3] === 0x00) || (bytes[2] === 0x2b && bytes[3] === 0x00)))
    || (bytes[0] === 0x4d && bytes[1] === 0x4d && ((bytes[2] === 0x00 && bytes[3] === 0x2a) || (bytes[2] === 0x00 && bytes[3] === 0x2b)))) return 'TIFF';
  const brand = String.fromCharCode(...bytes.slice(8, 12)).toLowerCase();
  if (String.fromCharCode(...bytes.slice(4, 8)) === 'ftyp' && ['heic', 'heix', 'heif', 'hevc', 'hevx', 'mif1', 'msf1', 'heim', 'heis'].includes(brand)) return 'HEIF';
  return null;
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
  if (source.verification_status === 'verified' && source.page_number) {
    const box = source.bounding_box?.map((value) => Number(value).toFixed(3)).join(', ');
    return `${source.page_number}페이지 · 원문 “${source.raw_text || ''}” · PDF 텍스트 위치 검증 완료${box ? ` · 정규화 좌표 [${box}]` : ''}`;
  }
  return `${source.page_number ? `${source.page_number}페이지 · ` : ''}AI가 제시한 원문 “${source.raw_text || ''}” · 원본 위치를 독립적으로 검증하지 못해 강조 표시하지 않습니다.`;
}

function scorePageRotation(canvas, angle) {
  const radians = angle * Math.PI / 180;
  const width = Math.round(Math.abs(canvas.width * Math.cos(radians)) + Math.abs(canvas.height * Math.sin(radians)));
  const height = Math.round(Math.abs(canvas.height * Math.cos(radians)) + Math.abs(canvas.width * Math.sin(radians)));
  const rotated = document.createElement('canvas');
  rotated.width = width; rotated.height = height;
  const context = rotated.getContext('2d', { willReadFrequently: true });
  context.fillStyle = '#fff'; context.fillRect(0, 0, width, height);
  context.translate(width / 2, height / 2); context.rotate(radians);
  context.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  const pixels = context.getImageData(0, 0, width, height).data;
  const rows = new Float64Array(height);
  let total = 0;
  for (let y = 0; y < height; y += 1) {
    let rowInk = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      if ((pixels[offset] + pixels[offset + 1] + pixels[offset + 2]) / 3 < 190) rowInk += 1;
    }
    rows[y] = rowInk; total += rowInk;
  }
  let mean = total / Math.max(height, 1); let variance = 0; let topBias = 0;
  for (let y = 0; y < height; y += 1) {
    variance += (rows[y] - mean) ** 2;
    topBias += rows[y] * (0.5 - y / Math.max(height - 1, 1));
  }
  return { angle, score: variance / Math.max(height, 1) / (total + 1), topBias, ink: total };
}

async function detectPdfPageOrientation(page) {
  const text = await page.getTextContent();
  if (text.items?.some((item) => String(item.str || '').trim())) return { rotation_degrees: 0, deskew_degrees: 0 };
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(1.67, 1400 / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  await page.render({ canvasContext: context, viewport }).promise;
  const candidates = [0, 90, 180, 270].map((angle) => scorePageRotation(canvas, angle));
  const bestScore = Math.max(...candidates.map((candidate) => candidate.score));
  const plausible = candidates.filter((candidate) => candidate.score >= bestScore * 0.97);
  let chosen = plausible.reduce((best, candidate) => candidate.topBias > best.topBias ? candidate : best);
  const rotate90 = candidates.find((candidate) => candidate.angle === 90);
  const rotate270 = candidates.find((candidate) => candidate.angle === 270);
  if (rotate90.score >= bestScore * 0.97 && rotate270.score >= bestScore * 0.97
    && Math.abs(rotate90.score - rotate270.score) <= bestScore * 0.03) chosen = rotate90;
  const original = candidates.find((candidate) => candidate.angle === 0);
  if (chosen.angle !== 0 && bestScore < original.score * 1.2) chosen = original;
  return { rotation_degrees: chosen.angle, deskew_degrees: 0 };
}

function PdfPreview({ file, selectedLocation, currentPage, setCurrentPage, pageCount, setPageCount, correctedPages = [] }) {
  const [pdfDocument, setPdfDocument] = useState(null);
  const [pageCorrections, setPageCorrections] = useState({});
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const serverCorrection = correctedPages.find((entry) => entry.page_number === currentPage);
  const correction = serverCorrection || pageCorrections[currentPage];
  const orientationChecked = Boolean(serverCorrection) || Object.hasOwn(pageCorrections, currentPage);
  // CSS positive angles are clockwise; backend PIL rotations are counter-clockwise.
  const previewRotation = -((correction?.rotation_degrees || 0) + (correction?.deskew_degrees || 0));
  const rotationRadians = Math.abs(previewRotation) * Math.PI / 180;
  const rotatedWidth = canvasSize.width * Math.abs(Math.cos(rotationRadians)) + canvasSize.height * Math.abs(Math.sin(rotationRadians));
  const rotatedHeight = canvasSize.height * Math.abs(Math.cos(rotationRadians)) + canvasSize.width * Math.abs(Math.sin(rotationRadians));
  useEffect(() => {
    let active = true;
    let loadingTask;
    setPdfDocument(null);
    setPageCorrections({});
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
    if (!pdfDocument || serverCorrection || orientationChecked) return undefined;
    let active = true;
    pdfDocument.getPage(currentPage).then(detectPdfPageOrientation).then((detected) => {
      if (active) setPageCorrections((current) => ({ ...current, [currentPage]: detected }));
    }).catch(() => {
      if (active) setPageCorrections((current) => ({ ...current, [currentPage]: { rotation_degrees: 0, deskew_degrees: 0 } }));
    });
    return () => { active = false; };
  }, [pdfDocument, currentPage, serverCorrection, orientationChecked]);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => {
      setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, [pdfDocument]);
  useEffect(() => {
    if (!pdfDocument || !canvasRef.current || !orientationChecked) return undefined;
    let active = true;
    let renderTask;
    pdfDocument.getPage(currentPage).then((page) => {
      if (!active) return;
      const baseViewport = page.getViewport({ scale: 1 });
      const radians = Math.abs(previewRotation) * Math.PI / 180;
      const displayWidth = baseViewport.width * Math.abs(Math.cos(radians)) + baseViewport.height * Math.abs(Math.sin(radians));
      const displayHeight = baseViewport.height * Math.abs(Math.cos(radians)) + baseViewport.width * Math.abs(Math.sin(radians));
      const widthScale = stageSize.width ? (stageSize.width - 28) / displayWidth : 1.4;
      const heightScale = stageSize.height ? (stageSize.height - 28) / displayHeight : 1.4;
      const scale = Math.max(0.1, Math.min(1.4, widthScale, heightScale));
      const viewport = page.getViewport({ scale: Number.isFinite(scale) ? scale : 1.4 });
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      setCanvasSize({ width: viewport.width, height: viewport.height });
      renderTask = page.render({ canvasContext: context, viewport });
      return renderTask.promise;
    }).catch(() => {});
    return () => { active = false; renderTask?.cancel(); };
  }, [pdfDocument, currentPage, previewRotation, orientationChecked, stageSize.width, stageSize.height]);
  const box = selectedLocation?.verification_status === 'verified' && selectedLocation?.page_number === currentPage
    ? selectedLocation.bounding_box : null;
  return <Box className={classes.pdfViewer}>
    <Group justify="center" gap="xs" className={classes.pdfControls}>
      <Button size="xs" variant="default" disabled={currentPage <= 1} onClick={() => setCurrentPage((page) => page - 1)}>이전</Button>
      <Text size="xs">{currentPage} / {pageCount || '—'} 페이지</Text>
      <Button size="xs" variant="default" disabled={!pageCount || currentPage >= pageCount} onClick={() => setCurrentPage((page) => page + 1)}>다음</Button>
    </Group>
    {!pdfDocument ? <Box className={classes.previewEmpty}>PDF를 불러오는 중이거나 미리보기를 표시할 수 없습니다.</Box> : <Box ref={stageRef} className={classes.pdfPageStage}>
      {!orientationChecked && <Box className={classes.previewEmpty}>페이지 방향을 확인하고 있습니다.</Box>}
      <Box className={classes.pdfCanvasWrap} style={{ display: orientationChecked ? undefined : 'none', width: rotatedWidth || undefined, height: rotatedHeight || undefined }}>
        <Box className={classes.pdfCanvasContent} style={{ width: canvasSize.width || undefined, height: canvasSize.height || undefined, transform: `rotate(${previewRotation}deg)` }}>
          <canvas ref={canvasRef} className={classes.pdfCanvas} />
          {box && <Box className={classes.sourceHighlight} style={{ left: `${box[0] * 100}%`, top: `${box[1] * 100}%`, width: `${(box[2] - box[0]) * 100}%`, height: `${(box[3] - box[1]) * 100}%` }} />}
        </Box>
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

function Preview({ file, previewUrl, selectedLocation, currentPage, setCurrentPage, pageCount, setPageCount, correctedPages }) {
  if (!file) return <Box className={classes.previewEmpty}>주문서 파일을 선택하면 원본 미리보기가 여기에 표시됩니다.</Box>;
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension === 'pdf') return <PdfPreview file={file} selectedLocation={selectedLocation} currentPage={currentPage} setCurrentPage={setCurrentPage} pageCount={pageCount} setPageCount={setPageCount} correctedPages={correctedPages} />;
  if (['jpg', 'jpeg', 'png'].includes(extension)) return <ImagePreview previewUrl={previewUrl} selectedLocation={selectedLocation} />;
  return <Box className={classes.previewEmpty}>지원하지 않는 파일 형식입니다.</Box>;
}

function UsageValue({ label, value }) {
  return <Box className={classes.usageValue}><Text size="xs" c="dimmed">{label}</Text><Text size="sm" fw={700}>{value}</Text></Box>;
}


const MAX_FILES = 10;
const USER_CONCURRENCY = 2;

function makeDocument(file, previewFile = null) {
  return {
    id: globalThis.crypto?.randomUUID?.() || `file-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    file, previewFile, status: 'ready', error: '', extraction: null, originalResponse: null, usage: null,
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
  const previewFile = doc.previewFile || doc.file;
  const previewUrl = useMemo(() => previewFile ? URL.createObjectURL(previewFile) : '', [previewFile]);
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [originMessage, setOriginMessage] = useState('AI 추출 라벨을 누르면 원본 출처와 위치 확인 상태를 표시합니다.');
  const [selectedRows, setSelectedRows] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const extraction = doc.extraction;
  const completeness = getExtractionCompleteness(extraction);
  const updateExtraction = (transform) => updateDocument(doc.id, (current) => ({ ...current, extraction: transform(current.extraction) }));

  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, [previewUrl]);



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
    if (source.page_number && (source.verification_status === 'verified' || previewFile?.name.toLowerCase().endsWith('.pdf'))) setCurrentPage(source.page_number);
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
        {doc.usage && <Badge color="blue" variant="light">{doc.usage.model} &middot; ${Number(doc.usage.estimated_cost_usd || 0).toFixed(6)}</Badge>}
        {!!doc.originalResponse?.preprocessing?.corrected_pages?.length && <Badge color="cyan" variant="light">PDF 자동 보정 {doc.originalResponse.preprocessing.corrected_pages.length}페이지</Badge>}
        {doc.extraction && <Button size="xs" variant="default" leftSection={<IconRefresh size={14} />} onClick={() => reanalyze(doc)} disabled={['queued', 'analyzing'].includes(doc.status)}>재분석</Button>}
        <Button size="xs" variant="default" leftSection={<IconBraces size={14} />} onClick={() => openJson(doc)} disabled={!doc.originalResponse}>원본 JSON</Button>
      </Group>
    </Group>
    {doc.error && <Text className={classes.documentError} size="sm" c="red">{doc.error}</Text>}
    <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="md" className={classes.workspace}>
      <Paper className={`${sharedClasses.panel} ${classes.workPanel}`} withBorder>
        <Group className={classes.panelHeader} justify="space-between"><Text fw={700}>원본 주문서</Text><Badge variant="light" color="gray">{doc.file.name.split('.').pop()?.toUpperCase()}</Badge></Group>
        <Box className={`${classes.originStatus} ${selectedLocation?.verification_status === 'verified' ? classes.originStatusVerified : selectedLocation ? classes.originStatusUnverified : ''}`} role="status" aria-live="polite">
          <ThemeIcon className={classes.originStatusIcon} size={30} radius="xl" variant="light" color={selectedLocation?.verification_status === 'verified' ? 'teal' : selectedLocation ? 'orange' : 'gray'}>
            {selectedLocation?.verification_status === 'verified' ? '✓' : selectedLocation ? '!' : 'i'}
          </ThemeIcon>
          <Box className={classes.originStatusCopy}>
            <Text className={classes.originStatusTitle} size="xs" fw={700}>
              {selectedLocation ? (selectedLocation.verification_status === 'verified' ? '원본 위치 확인됨' : '원본 위치 확인 불가') : 'AI 추출값의 원본 위치'}
            </Text>
            <Text className={classes.originStatusText} size="sm">{originMessage || 'AI 추출 라벨을 누르면 원본 출처와 위치 확인 상태를 표시합니다.'}</Text>
          </Box>
        </Box>
        <Box className={classes.previewArea}><Preview file={previewFile} previewUrl={previewUrl} selectedLocation={selectedLocation} currentPage={currentPage} setCurrentPage={setCurrentPage} pageCount={pageCount} setPageCount={setPageCount} correctedPages={doc.originalResponse?.preprocessing?.corrected_pages || []} /></Box>
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
                  <Table.Td ta="center" className={classes.selectColumn}><input type="checkbox" aria-label={`${index + 1}행 선택`} checked={selectedRows.includes(index)} onChange={() => toggleRowSelection(index)} /></Table.Td><Table.Td ta="center" className={classes.rowNumber}>{index + 1}</Table.Td>
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
  const [analysisConfirm, setAnalysisConfirm] = useState(null);
  const [validating, setValidating] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const updateDocument = useCallback((id, updater) => setDocuments((current) => current.map((doc) => doc.id === id ? (typeof updater === 'function' ? updater(doc) : { ...doc, ...updater }) : doc)), []);
  const selectedDoc = documents.find((doc) => doc.id === selectedId) || documents[0] || null;

  const validateAndAdd = async (fileList) => {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;
    setValidating(true);
    setUploadProgress({ current: 0, total: incoming.length, name: '' });
    const accepted = [];
    for (const [fileIndex, file] of incoming.entries()) {
      setUploadProgress({ current: fileIndex + 1, total: incoming.length, name: file.name });
      if (documents.length + accepted.length >= MAX_FILES) { notifications.show({ title: '업로드 제한', message: `발주서는 한 번에 최대 ${MAX_FILES}개까지 등록할 수 있습니다.`, color: 'orange' }); break; }
      if (file.size > MAX_FILE_BYTES || !/\.(pdf|jpe?g|png|heic|heif|tif|tiff)$/i.test(file.name)) {
        notifications.show({ title: '업로드할 수 없는 파일', message: `${file.name}: PDF, JPG, PNG, HEIC, TIFF 및 30MB 이하 파일만 지원합니다.`, color: 'orange' }); continue;
      }
      let previewFile = null;
      const extension = file.name.split('.').pop()?.toLowerCase();
      if (['jpg', 'jpeg', 'png', 'heic', 'heif', 'tif', 'tiff'].includes(extension)) {
        try {
          const actualType = await detectImageContentType(file);
          const needsConversion = ['heic', 'heif', 'tif', 'tiff'].includes(extension) || ['HEIF', 'TIFF'].includes(actualType);
          if (needsConversion) {
            const form = new FormData(); form.append('file', file);
            const converted = await axios.post('/api/ai-order/convert-preview', form, {
              ...authConfig(), responseType: 'blob', timeout: 120000,
            });
            const mediaType = String(converted.headers['content-type'] || '').split(';')[0].toLowerCase();
            if (!['image/png', 'application/pdf'].includes(mediaType)) throw new Error('변환된 미리보기 형식이 올바르지 않습니다.');
            const previewName = mediaType === 'application/pdf' ? 'converted-preview.pdf' : 'converted-preview.png';
            previewFile = new File([converted.data], previewName, { type: mediaType });
          }
        } catch (error) {
          let message = error.message || '서버에서 HEIC/TIFF 이미지를 변환하지 못했습니다.';
          if (error.response?.data instanceof Blob) {
            try { message = JSON.parse(await error.response.data.text()).detail || message; } catch { /* Keep the HTTP error message. */ }
          } else {
            message = error.response?.data?.detail || message;
          }
          notifications.show({ title: '이미지 변환 실패', message: `${file.name}: ${message}`, color: 'red' });
          continue;
        }
      }
      if (file.name.toLowerCase().endsWith('.pdf')) {
        let task;
        try {
          const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
          pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
          task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
          const pdf = await task.promise;
          if (pdf.numPages > MAX_PDF_PAGES) { notifications.show({ title: 'PDF 페이지 제한', message: `${file.name}: 최대 ${MAX_PDF_PAGES}페이지까지 올릴 수 있습니다.`, color: 'orange' }); continue; }
        } catch { notifications.show({ title: 'PDF 확인 실패', message: `${file.name}: PDF 파일을 읽을 수 없습니다.`, color: 'red' }); continue; }
        finally { await task?.destroy().catch(() => {}); }
      }
      accepted.push(makeDocument(file, previewFile));
    }
    if (accepted.length) {
      setDocuments((current) => [...current, ...accepted]);
      setSelectedId((current) => current || accepted[0].id);
    }
    setValidating(false);
    setUploadProgress(null);
  };

  const processDocument = useCallback(async (doc) => {
    updateDocument(doc.id, { status: 'analyzing', error: '' });
    try {
      const form = new FormData(); form.append('file', doc.file);
      const controller = new AbortController(); abortControllers.current.set(doc.id, controller);
      const response = await axios.post('/api/ai-order/analyze', form, {
        ...authConfig(), timeout: 120000, signal: controller.signal,
        headers: { ...authConfig().headers, 'Idempotency-Key': globalThis.crypto?.randomUUID?.() || `ai-order-${Date.now()}-${Math.random().toString(36).slice(2)}` },
      });
      const payload = response.data;
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
    setAnalysisConfirm({ ids: targets.map((doc) => doc.id), type: 'batch' });
  };
  const reanalyze = (doc) => {
    setAnalysisConfirm({ ids: [doc.id], type: 'single', fileName: doc.file.name });
  };
  const confirmAnalysis = () => {
    if (!analysisConfirm) return;
    const idSet = new Set(analysisConfirm.ids);
    setDocuments((current) => current.map((doc) => idSet.has(doc.id)
      ? { ...doc, status: 'queued', error: '', extraction: null, originalResponse: null, usage: null }
      : doc));
    setAnalysisConfirm(null);
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
      <Group className={dashboardClasses.sampleNotice} gap={8}><span className={dashboardClasses.statusDot} /><Text size="xs">OpenAI API 분석 · 파일별 독립 처리</Text></Group>
    </Box></Paper>

    <Paper className={`${sharedClasses.panel} ${classes.uploadPanel}`} withBorder>
      <Group justify="space-between" align="center" wrap="wrap" gap="md">
        <Box className={classes.uploadDropzone} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void validateAndAdd(event.dataTransfer.files); }}>
          <input ref={fileInputRef} className={classes.hiddenFileInput} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.heic,.heif,.tif,.tiff" onChange={(event) => { void validateAndAdd(event.currentTarget.files); event.currentTarget.value = ''; }} />
          <Box className={classes.uploadIcon}><IconFileUpload size={22} /></Box><Box className={classes.uploadCopy}>
            <Text size="sm" fw={700}>{validating ? '파일 형식과 PDF 페이지를 확인하고 있습니다.' : '주문서 여러 개를 선택하거나 여기에 끌어놓으세요.'}</Text>
            <Text size="xs" c="dimmed">PDF · JPG · PNG · HEIC · TIFF · 파일당 최대 30MB · 문서 최대 10페이지 · 최대 {MAX_FILES}개</Text>
          </Box><Button variant="default" size="sm" onClick={() => fileInputRef.current?.click()} disabled={validating}>파일 선택</Button>
        </Box>
        <Group gap="xs"><Button variant="default" leftSection={<IconTrash size={15} />} onClick={clearDocuments} disabled={!documents.length || activeRequests.current.size > 0}>목록 비우기</Button>
          <Button color="red" leftSection={<IconPlayerPlay size={15} />} onClick={startBatch} disabled={validating || !documents.some((doc) => ['ready', 'failed'].includes(doc.status))}>AI 일괄 분석</Button>
        </Group>
      </Group>
      {validating && uploadProgress && <Box className={classes.uploadProgress} role="status" aria-live="polite">
        <Group justify="space-between" gap="xs" mb={6} wrap="nowrap">
          <Text size="xs" fw={600}>{'\ucca8\ubd80\ud30c\uc77c \ud655\uc778 \uc911'} &middot; {uploadProgress.current}/{uploadProgress.total}</Text>
          <Text size="xs" c="dimmed" lineClamp={1}>{uploadProgress.name}</Text>
        </Group>
        <Progress value={uploadProgress.total ? Math.max(4, ((uploadProgress.current - 0.5) / uploadProgress.total) * 100) : 4} animated striped color="red" size="sm" radius="xl" />
      </Box>}
      {documents.length > 0 && <Group gap="xs" mt="sm">{Object.entries(statusCounts).map(([label, count]) => <Badge key={label} variant="light" color={label === '실패' ? 'red' : label === '확인 필요' ? 'orange' : 'gray'}>{label} {count}</Badge>)}<Text size="xs" c="dimmed">동시 분석 최대 {USER_CONCURRENCY}건, 나머지는 대기합니다.</Text></Group>}
    </Paper>

    <Paper className={`${sharedClasses.panel} ${classes.batchListPanel}`} withBorder>
      <Group justify="space-between" className={classes.listHeader}><Text fw={700}>발주서 목록 <Badge ml="xs" variant="light" color="gray">{documents.length}건</Badge></Text><Group gap="xs"><Text size="xs" c="dimmed">{documents.filter((doc) => doc.extraction?.items?.some((item) => item.needs_review)).length}건 확인 필요</Text>{documents.length > 5 && <Button size="compact-xs" variant="subtle" rightSection={expandedList ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />} onClick={() => setExpandedList((value) => !value)}>{expandedList ? '접기' : '펼치기'}</Button>}</Group></Group>
      {!documents.length ? <Text className={classes.listEmpty} size="sm" c="dimmed">분석할 주문서 파일을 추가해주세요.</Text> : <ScrollArea className={expandedList ? classes.orderListScrollExpanded : classes.orderListScroll} type="always" scrollbarSize={8}><Table highlightOnHover withTableBorder withColumnBorders className={classes.orderListTable}>
        <Table.Thead><Table.Tr><Table.Th>파일명</Table.Th><Table.Th>인식 거래처</Table.Th><Table.Th>발주번호</Table.Th><Table.Th>상태</Table.Th><Table.Th ta="right">품목 수</Table.Th><Table.Th ta="right">확인 필요</Table.Th><Table.Th ta="right">비용</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>{documents.map((doc) => { const [label, color] = documentStatus(doc); return <Table.Tr key={doc.id} className={doc.id === selectedDoc?.id ? classes.activeDocumentRow : undefined} onClick={() => setSelectedId(doc.id)} style={{ cursor: 'pointer' }}>
          <Table.Td><Group gap="xs" wrap="nowrap">{doc.status === 'analyzing' && <Loader size={12} />}<Text size="sm" lineClamp={1} title={doc.file.name}>{doc.file.name}</Text></Group>{doc.error && <Text size="xs" c="red" lineClamp={1}>{doc.error}</Text>}</Table.Td>
          <Table.Td>{doc.extraction?.header?.buyer || (doc.status === 'analyzing' ? '분석 중' : '미확인')}</Table.Td><Table.Td>{doc.extraction?.header?.order_number || '—'}</Table.Td>
          <Table.Td><Badge color={color} variant="light">{label}</Badge></Table.Td><Table.Td ta="right">{doc.extraction ? doc.extraction.items.length.toLocaleString() : '—'}</Table.Td>
          <Table.Td ta="right">{doc.extraction ? doc.extraction.items.filter((item) => item.needs_review).length.toLocaleString() : '—'}</Table.Td><Table.Td ta="right">{doc.usage ? `$${Number(doc.usage.estimated_cost_usd || 0).toFixed(6)}` : '—'}</Table.Td>
        </Table.Tr>; })}</Table.Tbody>
      </Table></ScrollArea>}
    </Paper>

    <Box className={classes.comparisonArea}>{selectedDoc ? <OrderDocumentWorkspace key={selectedDoc.id} doc={selectedDoc} updateDocument={updateDocument} openJson={setJsonDoc} reanalyze={reanalyze} /> : <Paper withBorder className={classes.noSelection}>
      <Box className={classes.emptyState}>
        <ThemeIcon className={classes.emptyStateIcon} size={54} radius="xl" variant="light" color="red"><IconFileUpload size={27} /></ThemeIcon>
        <Badge variant="light" color="red" mt="md">원본 · AI 추출 결과 비교</Badge>
        <Title order={3} mt="xs">주문서 검토를 시작해보세요</Title>
        <Text className={classes.emptyStateDescription} size="sm" c="dimmed">
          {documents.length
            ? <>중단 목록에서 검토할 발주서를 선택하세요.<br />원본과 AI 추출 결과를 함께 보여드립니다.</>
            : <>주문서를 추가한 뒤 AI 일괄 분석을 실행하세요.<br />원본과 추출 결과를 좌우로 비교할 수 있습니다.</>}
        </Text>
        <SimpleGrid className={classes.emptyStatePreview} cols={{ base: 1, sm: 2 }} spacing="sm">
          <Box className={classes.emptyStatePreviewCard}><Group gap="xs"><ThemeIcon size="sm" variant="light" color="gray"><IconFileUpload size={14} /></ThemeIcon><Text size="sm" fw={700}>원본 주문서</Text></Group><Text size="xs" c="dimmed" mt={8}>PDF · 이미지 · 이미지 미리보기와 원본 위치 확인</Text><Box className={classes.emptyStateLines}><i /><i /><i /></Box></Box>
          <Box className={classes.emptyStatePreviewCard}><Group gap="xs"><ThemeIcon size="sm" variant="light" color="red"><IconBraces size={14} /></ThemeIcon><Text size="sm" fw={700}>AI 추출 결과</Text></Group><Text size="xs" c="dimmed" mt={8}>발주 정보와 상세 품목을 검토하고 수정</Text><Box className={classes.emptyStateLines}><i /><i /><i /></Box></Box>
        </SimpleGrid>
        <Text className={classes.emptyStateFootnote} size="xs" c="dimmed">분석 결과는 확인용이며 ERP 전표와 재고에는 반영되지 않습니다.</Text>
      </Box>
    </Paper>}</Box>
    <Modal opened={Boolean(analysisConfirm)} onClose={() => setAnalysisConfirm(null)} title="AI 분석 실행 확인" size="md" centered radius="md" overlayProps={{ backgroundOpacity: 0.5, blur: 2 }}>
      <Box className={classes.analysisConfirmBody}>
        <Group align="flex-start" gap="md" wrap="nowrap">
          <ThemeIcon size={44} radius="xl" variant="light" color="red"><IconPlayerPlay size={21} /></ThemeIcon>
          <Box>
            <Text fw={700} size="md">{analysisConfirm?.type === 'single' ? '이 발주서를 다시 분석할까요?' : '선택한 발주서 분석을 시작할까요?'}</Text>
            <Text size="sm" c="dimmed" mt={5}>{analysisConfirm?.type === 'single' ? analysisConfirm.fileName : `${analysisConfirm?.ids.length || 0}개 파일을 분석 대기열에 추가합니다.`}</Text>
          </Box>
        </Group>
        <Box className={classes.analysisCostNotice}>
          <Text size="sm" fw={600}>실제 OpenAI API를 호출합니다.</Text>
          <Text size="sm" c="dimmed" mt={3}>분석 파일마다 사용량에 따른 비용이 발생합니다. 재분석도 새 API 호출로 계산됩니다.</Text>
        </Box>
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={() => setAnalysisConfirm(null)}>취소</Button>
          <Button color="red" leftSection={<IconPlayerPlay size={15} />} onClick={confirmAnalysis}>AI 분석 실행</Button>
        </Group>
      </Box>
    </Modal>
    <Modal opened={Boolean(jsonDoc)} onClose={() => setJsonDoc(null)} title="AI 원본 응답 JSON" size="xl" centered>
      {jsonDoc?.originalResponse ? <ScrollArea h="70vh"><Code block className={classes.jsonBlock}>{JSON.stringify(jsonDoc.originalResponse, null, 2)}</Code></ScrollArea> : <Text c="dimmed">분석 결과가 없습니다.</Text>}
      {jsonDoc?.originalResponse && <Text size="xs" c="dimmed" mt="sm">파일: {jsonDoc.file.name} · Grid에서 수정한 값은 원본 응답과 별도로 유지됩니다.</Text>}
    </Modal>
  </Box>;
}
