import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { TableVirtuoso } from 'react-virtuoso';
import {
  Badge, Box, Button, Group, Loader, Progress,
  Modal, Paper, ScrollArea, SimpleGrid, Stack, Table, Text, TextInput, Textarea, ThemeIcon, Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconBraces, IconFileTypePdf, IconPhoto, IconFileUpload, IconPlus, IconPlayerPlay, IconTrash, IconZoomIn, IconZoomOut } from '@tabler/icons-react';
import sharedClasses from '../styles/pages/ManagementShared.module.css';
import useErpPageRibbon from '../components/common/useErpPageRibbon';
import ErpBreadcrumb from '../components/common/ErpBreadcrumb';
import dashboardClasses from '../styles/pages/HomePage.module.css';
import outboundTableClasses from '../styles/pages/CodeMasterPage.module.css';
import classes from '../styles/pages/AIOrder.module.css';

const MAX_FILE_BYTES = 30 * 1024 * 1024;
const MAX_PDF_PAGES = 10;
const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });
const HEADER_FIELDS = [
  ['buyer', '발주처'], ['recipient', '수신처'], ['order_date', '발주일자'],
  ['due_date', '납기일자'], ['delivery_location', '납품 장소'],
];
const LINE_COLUMNS = [
  ['source_product_name', '품명', 180], ['steel_grade', '강종', 100], ['spec_raw', '규격 원문', 190],
  ['thickness', '두께', 90], ['width', '폭', 90], ['length', '길이', 90],
  ['quantity', '수량', 110], ['quantity_unit', '단위', 90], ['weight_kg', '중량', 115], ['notes', '비고', 180],
];

function numberInputValue(value) {
  return value === null || value === undefined ? '' : String(value);
}

function orderLineDisplayValue(item, key) {
  if (key === 'quantity') return item.quantity ?? item.quantity_raw;
  if (key === 'weight_kg') return item.weight_kg ?? item.weight_raw;
  return item[key];
}

function measureOrderColumnWidths(items) {
  if (!items?.length || typeof document === 'undefined') return {};
  const context = document.createElement('canvas').getContext('2d');
  if (!context) return {};
  context.font = '13px Arial, sans-serif';
  const maximumWidths = {
    source_product_name: 320, steel_grade: 200, spec_raw: 320,
    thickness: 150, width: 150, length: 150, quantity: 150,
    quantity_unit: 150, weight_kg: 170, notes: 420,
  };
  return Object.fromEntries(LINE_COLUMNS.map(([key, label]) => {
    const textWidth = Math.max(
      context.measureText(label).width,
      ...items.map((item) => context.measureText(numberInputValue(orderLineDisplayValue(item, key))).width),
    );
    return [key, Math.max(70, Math.min(maximumWidths[key] || 260, Math.ceil(textWidth + 30)))];
  }));
}

function dateInputValue(value) {
  const text = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const match = text.match(/^(\d{4})[./](\d{1,2})[./](\d{1,2})$/);
  return match ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : '';
}

function numericValue(raw) {
  const cleaned = String(raw).replaceAll(',', '').trim();
  if (!cleaned || !/^-?(?:\d+\.?\d*|\.\d+)$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function createManualOrderLine() {
  return {
    source_product_name: null, steel_grade: null, spec_raw: null, thickness: null, width: null, length: null,
    quantity: null, quantity_raw: null, quantity_unit: null, weight_kg: null, weight_raw: null,
    notes: null, source_reference: null, source_locations: [],
    __manual: true,
    needs_review: true, review_reasons: ['사용자가 추가한 행입니다. 원본과 대조해주세요.'],
  };
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

function sourceFieldFor(field) {
  if (field === 'quantity') return 'quantity_raw';
  if (field === 'weight_kg') return 'weight_raw';
  if (['thickness', 'width', 'length'].includes(field)) return 'spec_raw';
  return field;
}

function hasExtractedValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function aiSourceFor(owner, field) {
  if (!hasExtractedValue(owner?.[field])) return null;
  return owner?.source_locations?.find((location) => location.field_name === sourceFieldFor(field)) || null;
}

function ExtractionFieldLabel({ label, source, showLabel = true }) {
  if (!showLabel && !source) return null;
  return <Box className={`${classes.extractionFieldLabel} ${!showLabel ? classes.sourceOnlyLabel : ''}`}>
    {showLabel && <Text component="span" size="xs" fw={700}>{label}</Text>}
    {source && <span className={classes.aiExtractTag}>AI 추출</span>}
  </Box>;
}

const OrderLineCells = memo(function OrderLineCells({ item, index, selected, onToggle, onChange, onPaste }) {
  return <>
    <Table.Td ta="center" className={outboundTableClasses.checkCol}><input type="checkbox" aria-label={`${index + 1}행 선택`} checked={selected} onChange={(event) => onToggle(index, event.nativeEvent.shiftKey)} /></Table.Td>
    <Table.Td ta="center" className={outboundTableClasses.numberCol}>{index + 1}</Table.Td>
    {LINE_COLUMNS.map(([key, label]) => {
      const source = item.__manual ? null : aiSourceFor(item, key);
      const hasAiSource = Boolean(source);
      return <Table.Td key={key} className={hasAiSource ? classes.aiExtractedCell : undefined} title={hasAiSource ? 'AI가 읽어 추출한 값입니다.' : undefined}>
        <input className={`${outboundTableClasses.cellInput} ${classes.cellInput}`} aria-label={`${index + 1}행 ${label}`} data-row-index={index} data-field={key} value={item.__draft?.[key] ?? numberInputValue(orderLineDisplayValue(item, key))} onChange={(event) => onChange(index, key, event.currentTarget.value)} onPaste={(event) => {
          const text = event.clipboardData.getData('text/plain');
          if (text.includes('\t') || text.includes('\n')) {
            event.preventDefault();
            onPaste(index, key, text);
          }
        }} />
      </Table.Td>;
    })}
  </>;
});

const AIOrderVirtualRow = ({ item, className, ...props }) => (
  <Table.Tr
    {...props}
    title={item?.needs_review ? (item.review_reasons || []).join(' · ') || '원본과 대조가 필요합니다.' : undefined}
    className={[className, item?.needs_review && classes.reviewRow, item?.__manual && outboundTableClasses.newRow].filter(Boolean).join(' ')}
  />
);

const aiOrderTableComponents = {
  Table: ({ style, ...props }) => <Table {...props} className={`${sharedClasses.table} ${outboundTableClasses.codeTable} ${classes.resultGrid}`} highlightOnHover withTableBorder withColumnBorders verticalSpacing="xs" horizontalSpacing={0} style={{ ...style, width: '100%', tableLayout: 'fixed' }} />,
  TableHead: Table.Thead,
  TableBody: Table.Tbody,
  TableRow: AIOrderVirtualRow,
};

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

function usePreviewPan(stageRef) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const offsetRef = useRef({ x: 0, y: 0 });
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    let drag = null;
    const stopPan = (event) => {
      if (!drag || (event.pointerId !== undefined && drag.pointerId !== event.pointerId)) return;
      drag = null;
      stage.classList.remove(classes.previewPanning);
      window.removeEventListener('pointermove', movePreview);
      window.removeEventListener('pointerup', stopPan);
      window.removeEventListener('pointercancel', stopPan);
    };
    const movePreview = (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      const nextOffset = {
        x: drag.xOffset + event.clientX - drag.x,
        y: drag.yOffset + event.clientY - drag.y,
      };
      offsetRef.current = nextOffset;
      setOffset(nextOffset);
      event.preventDefault();
    };
    const startPan = (event) => {
      if (event.button !== 0) return;
      drag = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        xOffset: offsetRef.current.x,
        yOffset: offsetRef.current.y,
      };
      stage.classList.add(classes.previewPanning);
      window.addEventListener('pointermove', movePreview, { passive: false });
      window.addEventListener('pointerup', stopPan);
      window.addEventListener('pointercancel', stopPan);
      event.preventDefault();
    };
    stage.addEventListener('pointerdown', startPan);
    return () => {
      stage.removeEventListener('pointerdown', startPan);
      stopPan({});
    };
  }, [stageRef]);
  const resetPan = () => {
    const initialOffset = { x: 0, y: 0 };
    offsetRef.current = initialOffset;
    setOffset(initialOffset);
  };
  return { offset, resetPan };
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

function PdfPreview({ file, currentPage, setCurrentPage, pageCount, setPageCount, correctedPages = [] }) {
  const [pdfDocument, setPdfDocument] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [renderError, setRenderError] = useState('');
  const [pageCorrections, setPageCorrections] = useState({});
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const canvasRef = useRef(null);
  const renderTaskRef = useRef(null);
  const stageRef = useRef(null);
  const pan = usePreviewPan(stageRef);
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
    setLoadError('');
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
    }).catch(() => {
      if (active) {
        setPdfDocument(null);
        setLoadError('PDF 미리보기를 불러오지 못했습니다. 파일을 확인해 주세요.');
      }
    });
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
      const nextSize = { width: Math.round(entry.contentRect.width), height: Math.round(entry.contentRect.height) };
      setStageSize((current) => current.width === nextSize.width && current.height === nextSize.height ? current : nextSize);
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, [pdfDocument]);
  useEffect(() => {
    if (!pdfDocument || !canvasRef.current) return undefined;
    let active = true;
    let renderTask;
    setRenderError('');
    const renderPage = async () => {
      try {
        const page = await pdfDocument.getPage(currentPage);
        if (!active) return;
        const previousTask = renderTaskRef.current;
        if (previousTask) {
          previousTask.cancel();
          try { await previousTask.promise; } catch { /* cancelled render */ }
        }
        if (!active || !canvasRef.current) return;
        const baseViewport = page.getViewport({ scale: 1 });
        const radians = Math.abs(previewRotation) * Math.PI / 180;
        const displayWidth = baseViewport.width * Math.abs(Math.cos(radians)) + baseViewport.height * Math.abs(Math.sin(radians));
        const displayHeight = baseViewport.height * Math.abs(Math.cos(radians)) + baseViewport.width * Math.abs(Math.sin(radians));
        const widthScale = stageSize.width ? (stageSize.width - 28) / displayWidth : 1.4;
        const heightScale = stageSize.height ? (stageSize.height - 28) / displayHeight : 1.4;
        const fitScale = Math.max(0.1, Math.min(1.4, widthScale, heightScale));
        const scale = fitScale * zoom;
        const viewport = page.getViewport({ scale: Number.isFinite(scale) ? scale : 1.4 });
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        setCanvasSize((current) => current.width === viewport.width && current.height === viewport.height
          ? current
          : { width: viewport.width, height: viewport.height });
        renderTask = page.render({ canvasContext: context, viewport });
        renderTaskRef.current = renderTask;
        await renderTask.promise;
      } catch (error) {
        if (active && error?.name !== 'RenderingCancelledException') {
          setRenderError('PDF 페이지를 표시하지 못했습니다. 다른 PDF 파일로 다시 시도해 주세요.');
        }
      }
      finally {
        if (renderTaskRef.current === renderTask) renderTaskRef.current = null;
      }
    };
    void renderPage();
    return () => { active = false; renderTask?.cancel(); };
  }, [pdfDocument, currentPage, previewRotation, stageSize.width, stageSize.height, zoom]);
  return <Box className={classes.pdfViewer}>
    <Group justify="space-between" gap="xs" className={classes.pdfControls}>
      <Group gap={5} wrap="nowrap">
      <Button size="xs" variant="default" disabled={currentPage <= 1} onClick={() => setCurrentPage((page) => page - 1)}>이전</Button>
      <Text size="xs">{currentPage} / {pageCount || '—'} 페이지</Text>
      <Button size="xs" variant="default" disabled={!pageCount || currentPage >= pageCount} onClick={() => setCurrentPage((page) => page + 1)}>다음</Button>
      </Group>
      <Group gap={5} wrap="nowrap">
        <Button size="xs" variant="default" aria-label="축소" title="축소" disabled={zoom <= 0.5} onClick={() => setZoom((value) => Math.max(0.5, Math.round((value - 0.25) * 100) / 100))}><IconZoomOut size={15} /></Button>
        <Text size="xs" className={classes.zoomValue}>{Math.round(zoom * 100)}%</Text>
        <Button size="xs" variant="default" aria-label="확대" title="확대" disabled={zoom >= 3} onClick={() => setZoom((value) => Math.min(3, Math.round((value + 0.25) * 100) / 100))}><IconZoomIn size={15} /></Button>
        <Button size="xs" variant="subtle" onClick={() => { setZoom(1); pan.resetPan(); }}>맞춤</Button>
      </Group>
    </Group>
    {!pdfDocument ? <Box className={classes.previewEmpty}>{loadError || 'PDF를 불러오는 중입니다.'}</Box> : <Box ref={stageRef} className={classes.pdfPageStage}>
      {renderError && <Box role="alert" className={classes.pdfPreviewError}>{renderError}</Box>}
      <Box className={classes.pdfCanvasWrap} style={{ width: rotatedWidth || undefined, height: rotatedHeight || undefined, transform: `translate(${pan.offset.x}px, ${pan.offset.y}px)` }}>
        <Box className={classes.pdfCanvasContent} style={{ width: canvasSize.width || undefined, height: canvasSize.height || undefined, transform: `rotate(${previewRotation}deg)` }}>
          <canvas ref={canvasRef} className={classes.pdfCanvas} />
        </Box>
      </Box>
    </Box>}
  </Box>;
}

function ImagePreview({ previewUrl }) {
  const [zoom, setZoom] = useState(1);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [imageLoadError, setImageLoadError] = useState(false);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const stageRef = useRef(null);
  const pan = usePreviewPan(stageRef);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const nextSize = { width: Math.round(entry.contentRect.width), height: Math.round(entry.contentRect.height) };
      setStageSize((current) => current.width === nextSize.width && current.height === nextSize.height ? current : nextSize);
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, [previewUrl]);

  const fitScale = imageSize.width && imageSize.height && stageSize.width && stageSize.height
    ? Math.min(1, (stageSize.width - 24) / imageSize.width, (stageSize.height - 24) / imageSize.height)
    : 1;
  const displayWidth = Math.max(1, imageSize.width * fitScale * zoom);
  const displayHeight = Math.max(1, imageSize.height * fitScale * zoom);

  return <Box className={classes.imageViewer}>
    <Group justify="flex-end" gap={5} wrap="nowrap" className={classes.imageControls}>
      <Button size="xs" variant="default" aria-label="축소" title="축소" disabled={zoom <= 0.5} onClick={() => setZoom((value) => Math.max(0.5, Math.round((value - 0.25) * 100) / 100))}><IconZoomOut size={15} /></Button>
      <Text size="xs" className={classes.zoomValue}>{Math.round(zoom * 100)}%</Text>
      <Button size="xs" variant="default" aria-label="확대" title="확대" disabled={zoom >= 3} onClick={() => setZoom((value) => Math.min(3, Math.round((value + 0.25) * 100) / 100))}><IconZoomIn size={15} /></Button>
      <Button size="xs" variant="subtle" onClick={() => { setZoom(1); pan.resetPan(); }}>맞춤</Button>
    </Group>
    <Box ref={stageRef} className={classes.imagePageStage}>
      <Box className={classes.imageStage} style={{ width: displayWidth, height: displayHeight, transform: `translate(${pan.offset.x}px, ${pan.offset.y}px)` }}>
        {previewUrl && <img src={previewUrl} alt="주문서 원본" onLoad={(event) => { setImageLoadError(false); setImageSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }); }} onError={() => setImageLoadError(true)} style={{ width: displayWidth, height: displayHeight }} />}
      </Box>
      {imageLoadError && <Box role="alert" className={classes.pdfPreviewError}>이미지를 불러오지 못했습니다. 파일을 다시 선택해 주세요.</Box>}
    </Box>
  </Box>;
}

function Preview({ file, previewUrl, currentPage, setCurrentPage, pageCount, setPageCount, correctedPages }) {
  if (!file) return <Box className={classes.previewEmpty}>주문서 파일을 선택하면 원본 미리보기가 여기에 표시됩니다.</Box>;
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension === 'pdf') return <PdfPreview file={file} currentPage={currentPage} setCurrentPage={setCurrentPage} pageCount={pageCount} setPageCount={setPageCount} correctedPages={correctedPages} />;
  if (['jpg', 'jpeg', 'png'].includes(extension)) return <ImagePreview key={previewUrl} previewUrl={previewUrl} />;
  return <Box className={classes.previewEmpty}>지원하지 않는 파일 형식입니다.</Box>;
}

const MAX_FILES = 10;
const USER_CONCURRENCY = 2;

function makeDocument(file, previewFile = null) {
  return {
    id: globalThis.crypto?.randomUUID?.() || `file-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    file, previewFile, status: 'ready', error: '', extraction: null, analysisRequestId: null, correctedPages: [], reviewed: false,
    cacheHit: false,
  };
}

function documentStatus(doc) {
  if (doc.status === 'analyzing') return ['분석 중', 'blue'];
  if (doc.status === 'queued') return ['분석 대기', 'gray'];
  if (doc.status === 'failed') return ['분석 실패', 'red'];
  if (doc.status === 'completed' && doc.reviewed) return ['검토 완료', 'teal'];
  if (doc.status === 'completed' && doc.extraction?.items?.some((item) => item.needs_review)) return ['확인 필요', 'orange'];
  if (doc.status === 'completed') return ['분석 완료', 'indigo'];
  return ['분석 전', 'gray'];
}

function canAnalyzeDocument(doc) {
  return ['ready', 'failed'].includes(doc.status) && !doc.extraction;
}

function documentFileIcon(file) {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension === 'pdf') return <IconFileTypePdf size={20} />;
  const label = ['jpg', 'jpeg'].includes(extension) ? 'JPG' : (extension || 'IMG').toUpperCase();
  return <span className={classes.fileTypeImageIcon}>
    <IconPhoto size={19} />
    <span>{label}</span>
  </span>;
}

function AnalysisLoading({ queued = false }) {
  return <Box className={classes.analysisLoading} role="status" aria-live="polite">
    <Group gap="sm" wrap="nowrap">
      <ThemeIcon size={42} radius="xl" variant="light" color={queued ? 'gray' : 'red'}>{queued ? '…' : <Loader size={20} color="red" />}</ThemeIcon>
      <Box className={classes.analysisLoadingCopy}>
        <Text size="sm" fw={700}>{queued ? '분석 대기 중' : 'AI가 주문서를 분석하고 있습니다'}</Text>
        <Text size="xs" c="dimmed" mt={3}>{queued ? '앞선 요청이 끝나면 자동으로 시작합니다.' : '문서의 품목 표와 숫자를 읽는 중입니다. 문서에 따라 시간이 걸릴 수 있습니다.'}</Text>
      </Box>
    </Group>
    {!queued && <Box className={classes.analysisLoadingTrack}><span /></Box>}
  </Box>;
}

function OrderDocumentWorkspace({ doc, updateDocument, onConfirm, confirming }) {
  const previewFile = doc.previewFile || doc.file;
  const [previewSource, setPreviewSource] = useState({ file: null, url: '' });
  const previewUrl = previewSource.file === previewFile ? previewSource.url : '';
  const [selectedRows, setSelectedRows] = useState([]);
  const [deleteRowsRequest, setDeleteRowsRequest] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [columnWidthOverrides, setColumnWidthOverrides] = useState({});
  const tableWrapRef = useRef(null);
  const virtuosoRef = useRef(null);
  const scrollToAddedLine = useRef(false);
  const focusAddedRowRef = useRef(null);
  const rowSelectionAnchor = useRef(null);
  const extraction = doc.extraction;
  const extractedItems = extraction?.items;
  const autoColumnWidths = useMemo(() => measureOrderColumnWidths(extractedItems), [extractedItems]);
  const columnWidths = useMemo(() => ({ ...autoColumnWidths, ...columnWidthOverrides }), [autoColumnWidths, columnWidthOverrides]);
  const itemCount = extraction?.items?.length ?? 0;
  const updateExtraction = useCallback((transform) => updateDocument(doc.id, (current) => ({ ...current, extraction: transform(current.extraction), reviewed: false })), [doc.id, updateDocument]);
  const tableColumns = [
    { key: '__select', label: '', width: 44, minWidth: 42, className: outboundTableClasses.checkCol },
    { key: '__number', label: 'No.', width: 58, minWidth: 48, className: outboundTableClasses.numberCol },
    ...LINE_COLUMNS.map(([key, label, width]) => ({ key, label, width, minWidth: 70 })),
  ];
  const tableWidth = tableColumns.reduce((total, column) => total + (columnWidths[column.key] ?? column.width), 0);

  useEffect(() => {
    if (!previewFile) return undefined;
    let active = true;
    const objectUrl = URL.createObjectURL(previewFile);
    queueMicrotask(() => {
      if (active) setPreviewSource({ file: previewFile, url: objectUrl });
    });
    return () => {
      active = false;
      URL.revokeObjectURL(objectUrl);
    };
  }, [previewFile]);

  useEffect(() => {
    if (!scrollToAddedLine.current && focusAddedRowRef.current === null) return;
    const shouldScroll = scrollToAddedLine.current;
    const focusRow = focusAddedRowRef.current;
    scrollToAddedLine.current = false;
    focusAddedRowRef.current = null;
    requestAnimationFrame(() => {
      if (shouldScroll && focusRow !== null) virtuosoRef.current?.scrollToIndex({ index: focusRow, align: 'end', behavior: 'auto' });
      const focusAddedInput = (attempt = 0) => {
        const input = tableWrapRef.current?.querySelector(`[data-row-index="${focusRow}"][data-field="source_product_name"]`);
        if (input) input.focus();
        else if (attempt < 5) requestAnimationFrame(() => focusAddedInput(attempt + 1));
      };
      if (focusRow !== null) requestAnimationFrame(() => focusAddedInput());
    });
  }, [extraction?.items?.length]);

  const updateHeader = (key, value) => updateExtraction((current) => ({ ...current, header: { ...current.header, [key]: value || null } }));
  const startColumnResize = (event, column) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = columnWidths[column.key] ?? column.width;
    const root = event.currentTarget.closest(`.${outboundTableClasses.tableWrap}`);
    const headerCell = event.currentTarget.parentElement;
    let nextWidth = startWidth;
    const move = (pointerEvent) => {
      nextWidth = Math.max(column.minWidth, Math.min(1600, startWidth + pointerEvent.clientX - startX));
      if (headerCell) headerCell.style.width = `${nextWidth}px`;
      root?.style.setProperty('--code-table-min-width', `${Math.max(900, tableWidth + nextWidth - startWidth)}px`);
    };
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      setColumnWidthOverrides((current) => ({ ...current, [column.key]: nextWidth }));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  };
  const focusGridCell = useCallback((rowIndex, field) => {
    const cell = tableWrapRef.current?.querySelector(`[data-row-index="${rowIndex}"][data-field="${field}"]`);
    if (cell) {
      cell.focus();
      return;
    }
    virtuosoRef.current?.scrollToIndex({ index: rowIndex, align: 'center', behavior: 'auto' });
    const focusCell = (attempt = 0) => {
      const nextCell = tableWrapRef.current?.querySelector(`[data-row-index="${rowIndex}"][data-field="${field}"]`);
      if (nextCell) nextCell.focus();
      else if (attempt < 5) requestAnimationFrame(() => focusCell(attempt + 1));
    };
    requestAnimationFrame(() => focusCell());
  }, []);
  const handleGridKeyDown = useCallback((event) => {
    const target = event.target instanceof HTMLInputElement ? event.target : null;
    const rowIndex = Number(target?.dataset.rowIndex);
    const field = target?.dataset.field;
    if (!target || !Number.isInteger(rowIndex) || !field) return;
    let rowDelta = 0;
    let columnDelta = 0;
    if (event.key === 'Enter') rowDelta = event.shiftKey ? -1 : 1;
    else if (event.key === 'Tab') columnDelta = event.shiftKey ? -1 : 1;
    else if (event.key === 'ArrowDown') rowDelta = 1;
    else if (event.key === 'ArrowUp') rowDelta = -1;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const hasSelection = target.selectionStart !== target.selectionEnd;
      const atBoundary = hasSelection ? false : event.key === 'ArrowLeft' ? target.selectionStart === 0 : target.selectionEnd === target.value.length;
      if (!atBoundary) return;
      columnDelta = event.key === 'ArrowLeft' ? -1 : 1;
    } else return;
    let nextRow = rowIndex + rowDelta;
    let nextColumn = LINE_COLUMNS.findIndex(([key]) => key === field) + columnDelta;
    if (nextColumn < 0) { nextRow -= 1; nextColumn = LINE_COLUMNS.length - 1; }
    if (nextColumn >= LINE_COLUMNS.length) { nextRow += 1; nextColumn = 0; }
    if (nextRow < 0 || nextRow >= itemCount) return;
    event.preventDefault();
    focusGridCell(nextRow, LINE_COLUMNS[nextColumn][0]);
  }, [itemCount, focusGridCell]);
  const updateLine = useCallback((index, key, rawValue) => updateExtraction((current) => ({
    ...current,
    items: current.items.map((item, itemIndex) => itemIndex !== index ? item : {
      ...item,
      [key]: ['thickness', 'width', 'length', 'quantity', 'weight_kg'].includes(key) ? numericValue(rawValue) : (rawValue || null),
      ...(key === 'quantity' ? { quantity_raw: rawValue || null } : {}),
      ...(key === 'weight_kg' ? { weight_raw: rawValue || null } : {}),
      __draft: { ...(item.__draft || {}), [key]: rawValue },
    }),
  })), [updateExtraction]);
  const addLine = () => {
    scrollToAddedLine.current = true;
    focusAddedRowRef.current = extraction.items.length;
    updateExtraction((current) => ({ ...current, items: [...current.items, createManualOrderLine()] }));
  };
  const toggleRowSelection = useCallback((index, shiftKey = false) => setSelectedRows((current) => {
    const anchor = rowSelectionAnchor.current;
    rowSelectionAnchor.current = index;
    if (shiftKey && anchor !== null) {
      const range = Array.from({ length: Math.abs(index - anchor) + 1 }, (_, offset) => Math.min(index, anchor) + offset);
      return [...new Set([...current, ...range])];
    }
    return current.includes(index) ? current.filter((rowIndex) => rowIndex !== index) : [...current, index];
  }), []);
  const pasteLineRange = useCallback((startIndex, startField, pastedText) => {
    const matrix = pastedText.replace(/\r/g, '').split('\n').filter((line, index, all) => line || index < all.length - 1).map((line) => line.split('\t'));
    const startColumn = LINE_COLUMNS.findIndex(([key]) => key === startField);
    if (startIndex < 0 || startColumn < 0 || !matrix.length) return;
    updateExtraction((current) => {
      const items = [...current.items];
      matrix.forEach((line, rowOffset) => {
        const itemIndex = startIndex + rowOffset;
        const item = { ...(items[itemIndex] || createManualOrderLine()) };
        line.forEach((rawValue, columnOffset) => {
          const key = LINE_COLUMNS[startColumn + columnOffset]?.[0];
          if (!key) return;
          const value = String(rawValue ?? '');
          item[key] = ['thickness', 'width', 'length', 'quantity', 'weight_kg'].includes(key) ? numericValue(value) : (value || null);
          if (key === 'quantity') item.quantity_raw = value || null;
          if (key === 'weight_kg') item.weight_raw = value || null;
          item.__draft = { ...(item.__draft || {}), [key]: value };
        });
        if (itemIndex >= items.length) items.push(item);
        else items[itemIndex] = item;
      });
      return { ...current, items };
    });
  }, [updateExtraction]);
  const requestDeleteSelectedRows = () => {
    if (selectedRows.length) setDeleteRowsRequest([...selectedRows]);
  };
  const confirmDeleteSelectedRows = () => {
    const requestedRows = deleteRowsRequest || [];
    if (!requestedRows.length) return;
    const selected = new Set(requestedRows);
    updateExtraction((current) => ({ ...current, items: current.items.filter((_, index) => !selected.has(index)) }));
    setSelectedRows([]);
    rowSelectionAnchor.current = null;
    setDeleteRowsRequest(null);
    notifications.show({ title: '삭제 완료', message: `상세 품목 ${requestedRows.length}개를 삭제했습니다.`, color: 'teal' });
  };
  return <>
    {doc.error && <Text className={classes.documentError} size="sm" c="red">{doc.error}</Text>}
    <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="md" className={classes.workspace}>
      <Paper className={`${sharedClasses.panel} ${classes.workPanel}`} withBorder>
        <Group className={classes.panelHeader} justify="space-between"><Text fw={700}>원본 주문서</Text><Badge variant="light" color="gray">{doc.file.name.split('.').pop()?.toUpperCase()}</Badge></Group>
        <Box className={classes.previewArea}><Preview file={previewFile} previewUrl={previewUrl} currentPage={currentPage} setCurrentPage={setCurrentPage} pageCount={pageCount} setPageCount={setPageCount} correctedPages={doc.correctedPages || []} /></Box>
      </Paper>
      <Paper className={`${sharedClasses.panel} ${classes.workPanel}`} withBorder>
        <Group className={classes.panelHeader} justify="space-between"><Text fw={700}>AI 추출 결과</Text><Group gap="sm">{doc.cacheHit && <Badge size="md" fw={700} variant="light" color="gray">저장된 분석 결과</Badge>}{extraction && <Button size="xs" color="red" loading={confirming} disabled={!doc.analysisRequestId || !extraction.items?.length} onClick={() => onConfirm(doc)}>주문확정</Button>}</Group></Group>
        {!extraction
          ? doc.status === 'analyzing'
            ? <AnalysisLoading />
            : doc.status === 'queued'
              ? <AnalysisLoading queued />
              : doc.status === 'failed'
                ? <Box className={classes.selectOrderPrompt}>분석에 실패했습니다. 오류 내용을 확인하고 다시 실행해주세요.</Box>
                : <Box className={classes.selectOrderPrompt}>목록에서 발주서를 선택하고 분석을 실행해주세요.</Box> : <Box className={classes.resultContent}>
          <Box className={classes.resultContentInner}><Box className={classes.orderHeaderSection}><Text size="sm" fw={700} mb="xs">주문서 헤더</Text>
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
              {HEADER_FIELDS.map(([key, label]) => <TextInput key={key} type={['order_date', 'due_date'].includes(key) ? 'date' : 'text'} style={key === 'delivery_location' ? { gridColumn: '1 / -1' } : undefined} label={<ExtractionFieldLabel label={label} source={aiSourceFor(extraction.header, key)} />} value={['order_date', 'due_date'].includes(key) ? dateInputValue(extraction.header[key]) : (extraction.header[key] || '')} onChange={(event) => updateHeader(key, event.currentTarget.value)} />)}
            </SimpleGrid>
            </Box><Paper className={classes.detailSection} withBorder>
            <Group className={`${sharedClasses.toolbar} ${outboundTableClasses.toolbar} ${classes.detailToolbar}`} justify="space-between" align="center" wrap="wrap"><Group gap={8}><Text size="sm" fw={700}>상세 품목</Text>{extraction.items.some((item) => !item.__manual && LINE_COLUMNS.some(([key]) => aiSourceFor(item, key))) && <Badge className={classes.sectionAiBadge} size="sm" variant="light" color="gray">AI 추출</Badge>}</Group><Group gap={7} wrap="nowrap">
              {selectedRows.length > 0 && <Text size="xs" c="dimmed">{selectedRows.length}개 선택</Text>}<Button size="xs" variant="subtle" color="red" leftSection={<IconTrash size={14} />} disabled={!selectedRows.length} onClick={requestDeleteSelectedRows}>선택 삭제</Button><Button size="xs" color="red" leftSection={<IconPlus size={14} />} onClick={addLine}>행 추가</Button>
            </Group></Group>
            {!extraction.items.length ? <Box className={classes.resultEmpty}>인식된 품목 행이 없습니다.</Box> : <Box ref={tableWrapRef} className={`${outboundTableClasses.tableWrap} ${classes.gridScroll}`} style={{ '--code-table-min-width': `${Math.max(900, tableWidth)}px` }} onKeyDown={handleGridKeyDown}>
              <TableVirtuoso
                ref={virtuosoRef}
                data={extraction.items}
                style={{ height: '100%' }}
                components={aiOrderTableComponents}
                computeItemKey={(index, item) => `${index}-${item.source_reference || (item.__manual ? 'manual' : 'ai')}`}
                defaultItemHeight={40}
                increaseViewportBy={{ top: 100, bottom: 220 }}
                fixedHeaderContent={() => <Table.Tr>{tableColumns.map((column) => <Table.Th key={column.key} className={`${outboundTableClasses.resizableHeader} ${column.className || ''}`} style={{ width: columnWidths[column.key] ?? column.width }}>
                  {column.key === '__select' ? <input type="checkbox" aria-label="상세 전체 선택" checked={extraction.items.length > 0 && selectedRows.length === extraction.items.length} onChange={(event) => { setSelectedRows(event.currentTarget.checked ? extraction.items.map((_, index) => index) : []); rowSelectionAnchor.current = null; }} /> : column.label}
                  <span className={outboundTableClasses.columnResizeHandle} role="separator" aria-label={`${column.label || '선택'} 열 너비 조절`} onPointerDown={(event) => startColumnResize(event, column)} />
                </Table.Th>)}</Table.Tr>}
                itemContent={(index, item) => <OrderLineCells item={item} index={index} selected={selectedRows.includes(index)} onToggle={toggleRowSelection} onChange={updateLine} onPaste={pasteLineRange} />}
              />
            </Box>}
          </Paper>
        </Box>
      </Box>}
      </Paper>
    </SimpleGrid>
    <Modal opened={Boolean(deleteRowsRequest)} onClose={() => setDeleteRowsRequest(null)} title="상세 품목 삭제" centered size="sm">
      <Stack gap="md">
        <Text size="sm" c="dimmed">선택한 {deleteRowsRequest?.length || 0}개 품목 행을 삭제합니다. 삭제한 행은 복구할 수 없습니다.</Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setDeleteRowsRequest(null)}>취소</Button>
          <Button color="red" leftSection={<IconTrash size={15} />} onClick={confirmDeleteSelectedRows}>삭제</Button>
        </Group>
      </Stack>
    </Modal>
  </>;
}

export default function AIOrderPage() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const activeRequests = useRef(new Set());
  const abortControllers = useRef(new Map());
  const cacheLookupRequests = useRef(new Set());
  const [documents, setDocuments] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [analysisConfirm, setAnalysisConfirm] = useState(null);
  const [validating, setValidating] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [confirmingId, setConfirmingId] = useState(null);
  const [orderConfirmTargetId, setOrderConfirmTargetId] = useState(null);
  const updateDocument = useCallback((id, updater) => setDocuments((current) => current.map((doc) => doc.id === id ? (typeof updater === 'function' ? updater(doc) : { ...doc, ...updater }) : doc)), []);
  const selectedDoc = documents.find((doc) => doc.id === selectedId) || documents[0] || null;
  const orderConfirmTarget = documents.find((doc) => doc.id === orderConfirmTargetId) || null;
  const requestOrderConfirmation = (doc) => setOrderConfirmTargetId(doc.id);
  const confirmDocument = async () => {
    const doc = orderConfirmTarget;
    if (!doc || !doc.analysisRequestId || !doc.extraction?.items?.length || confirmingId) return;
    setConfirmingId(doc.id);
    try {
      const { data } = await axios.post('/api/ai-order/confirmed', {
        analysis_request_id: doc.analysisRequestId,
        sourcefilename: doc.file.name,
        header: doc.extraction.header,
        items: doc.extraction.items,
      }, authConfig());
      notifications.show({
        title: data.already_confirmed ? '이미 확정된 주문' : '주문확정 완료',
        message: data.already_confirmed
          ? `${data.orderid} 주문을 불러왔습니다.`
          : `${data.orderid} 주문과 상세 ${doc.extraction.items.length}건을 저장했습니다.`,
        color: 'teal',
      });
      setOrderConfirmTargetId(null);
      navigate(`/AIOrderConfirmPage?orderid=${encodeURIComponent(data.orderid)}`);
    } catch (error) {
      const detail = error.response?.data?.detail;
      notifications.show({ title: '주문확정 실패', message: typeof detail === 'string' ? detail : '입력값과 서버 상태를 확인해주세요.', color: 'red' });
    } finally {
      setConfirmingId(null);
    }
  };
  const orderListHeight = Math.min(Math.max(documents.length, 1), 5) * 52 + 36;

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
        headers: {
          ...authConfig().headers,
          'Idempotency-Key': globalThis.crypto?.randomUUID?.() || `ai-order-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        },
      });
      const payload = response.data;
      if (!payload?.extraction || typeof payload.extraction.header !== 'object' || !Array.isArray(payload.extraction.items)) {
        throw new Error('AI_ORDER_EMPTY_EXTRACTION');
      }
      updateDocument(doc.id, {
        status: 'completed', analysisRequestId: payload.request_id || null,
        correctedPages: payload.preprocessing?.corrected_pages || [],
        extraction: structuredClone(payload.extraction),
        cacheHit: payload.usage?.mode === 'cached', error: '',
      });
    } catch (error) {
      const message = error.message === 'AI_ORDER_EMPTY_EXTRACTION'
        ? '분석 응답에 표시할 추출 데이터가 없습니다. 서버 응답과 백엔드 로그를 확인해주세요.'
        : error.response?.data?.detail || '분석 요청에 실패했습니다. 파일과 서버 설정을 확인해주세요.';
      updateDocument(doc.id, { status: 'failed', cacheHit: false, error: message });
    } finally {
      abortControllers.current.delete(doc.id);
      activeRequests.current.delete(doc.id);
    }
  }, [updateDocument]);

  const showDocumentResult = useCallback(async (doc) => {
    setSelectedId(doc.id);
    if (doc.extraction || ['analyzing', 'queued'].includes(doc.status) || cacheLookupRequests.current.has(doc.id)) return;

    cacheLookupRequests.current.add(doc.id);
    updateDocument(doc.id, { cacheChecking: true });
    try {
      const form = new FormData();
      form.append('file', doc.file);
      const { data } = await axios.post('/api/ai-order/cached-result', form, {
        ...authConfig(), timeout: 30000,
      });
      if (data?.found && data.extraction && Array.isArray(data.extraction.items)) {
        updateDocument(doc.id, {
          status: 'completed',
          extraction: structuredClone(data.extraction),
          analysisRequestId: data.request_id || null,
          correctedPages: data.preprocessing?.corrected_pages || [],
          cacheHit: true,
          error: '',
        });
      } else {
        notifications.show({
          title: '저장된 분석 결과가 없습니다',
          message: <>이 파일을 분석하려면 AI 일괄 분석을 실행해주세요.</>,
          color: 'gray',
        });
      }
    } catch (error) {
      notifications.show({
        title: '저장 결과 조회 실패',
        message: error.response?.data?.detail || '기존 분석 결과를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.',
        color: 'red',
      });
    } finally {
      cacheLookupRequests.current.delete(doc.id);
      updateDocument(doc.id, { cacheChecking: false });
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
    const targets = documents.filter(canAnalyzeDocument);
    if (!targets.length) {
      notifications.show({
        title: '분석할 파일이 없습니다',
        message: '분석 완료된 파일은 저장된 결과를 사용하며 AI 분석을 다시 요청하지 않습니다.',
        color: 'gray',
      });
      return;
    }
    setAnalysisConfirm({ ids: targets.map((doc) => doc.id) });
  };
  const confirmAnalysis = () => {
    if (!analysisConfirm) return;
    const targetIds = analysisConfirm.ids.filter((id) => {
      const doc = documents.find((item) => item.id === id);
      return doc && canAnalyzeDocument(doc);
    });
    if (!targetIds.length) {
      setAnalysisConfirm(null);
      return;
    }
    const idSet = new Set(targetIds);
    setDocuments((current) => current.map((doc) => idSet.has(doc.id)
      ? { ...doc, status: 'queued', error: '', extraction: null, analysisRequestId: null, correctedPages: [], reviewed: false, cacheHit: false }
      : doc));
    setSelectedId((current) => targetIds.includes(current) ? current : (targetIds[0] || current));
    setAnalysisConfirm(null);
  };
  const clearDocuments = () => {
    if (activeRequests.current.size) return;
    setDocuments([]); setSelectedId(null);
  };
  const statusCounts = documents.reduce((counts, doc) => {
    const [label, color] = documentStatus(doc);
    counts[label] = { count: (counts[label]?.count || 0) + 1, color };
    return counts;
  }, {});

  useErpPageRibbon({
    onAdd: () => fileInputRef.current?.click(),
    onDelete: clearDocuments,
    showPrint: false,
    useSaveColor: false,
  });

  return <Box className={`${sharedClasses.pageShell} ${classes.page} ${classes.batchPage} ${documents.length ? classes.batchPageWithDocuments : ''}`}>
    <ErpBreadcrumb parent="가공관리" current="AI 가공솔루션" />

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
          <Button color="red" leftSection={<IconPlayerPlay size={15} />} onClick={startBatch} disabled={validating || !documents.length}>AI 일괄 분석</Button>
        </Group>
      </Group>
      {validating && uploadProgress && <Box className={classes.uploadProgress} role="status" aria-live="polite">
        <Group justify="space-between" gap="xs" mb={6} wrap="nowrap">
          <Text size="xs" fw={600}>{'첨부파일 확인 중'} &middot; {uploadProgress.current}/{uploadProgress.total}</Text>
          <Text size="xs" c="dimmed" lineClamp={1}>{uploadProgress.name}</Text>
        </Group>
        <Progress value={uploadProgress.total ? Math.max(4, ((uploadProgress.current - 0.5) / uploadProgress.total) * 100) : 4} animated striped color="red" size="sm" radius="xl" />
      </Box>}
      {documents.length > 0 && <Group gap="xs" mt="sm">{Object.entries(statusCounts).map(([label, value]) => <Badge key={label} variant="light" color={value.color}>{label} {value.count}</Badge>)}<Text size="xs" c="dimmed">동시 분석 최대 {USER_CONCURRENCY}건, 나머지는 대기합니다.</Text></Group>}
    </Paper>

    {documents.length > 0 && <Paper className={`${sharedClasses.panel} ${classes.batchListPanel}`} withBorder>
      <Group justify="space-between" className={classes.listHeader}>
        <Group gap="xs"><Text fw={700}>발주서 목록</Text><Badge variant="light" color="gray">{documents.length}건</Badge></Group>
        <Text size="xs" c="dimmed">{documents.length > 5 ? '목록을 스크롤해 전체 파일을 확인하세요.' : '파일을 선택해 원본과 분석 결과를 확인하세요.'}</Text>
      </Group>
      {!documents.length ? <Text className={classes.listEmpty} size="sm" c="dimmed">분석할 주문서 파일을 추가해주세요.</Text> : <ScrollArea className={classes.orderListScroll} style={{ height: orderListHeight }} type={documents.length > 5 ? 'auto' : 'never'} scrollbarSize={7}>
        <Table highlightOnHover className={classes.orderListTable}>
          <Table.Thead><Table.Tr><Table.Th>파일명</Table.Th><Table.Th>인식 거래처</Table.Th><Table.Th>품목 수</Table.Th><Table.Th>분석 상태</Table.Th><Table.Th>작업</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>{documents.map((doc) => {
            const [label, color] = documentStatus(doc);
            const selected = doc.id === selectedDoc?.id;
            const extension = doc.file.name.split('.').pop()?.toUpperCase() || 'FILE';
            return <Table.Tr key={doc.id} className={selected ? classes.activeDocumentRow : undefined} aria-selected={selected} onClick={() => void showDocumentResult(doc)}>
              <Table.Td><Group gap="sm" wrap="nowrap" className={classes.fileNameCell}>
                <ThemeIcon className={classes.fileTypeIcon} size={34} radius="md" variant="light" color="red">{documentFileIcon(doc.file)}</ThemeIcon>
                <Box className={classes.fileNameCopy}>
                  <Text size="sm" fw={600} lineClamp={1} title={doc.file.name}>{doc.file.name}</Text>
                  <Text size="xs" c="dimmed">{extension} · {formatBytes(doc.file.size)}</Text>
                </Box>
              </Group></Table.Td>
              <Table.Td ta="center"><Text size="sm" lineClamp={1}>{doc.extraction?.header?.buyer || (doc.status === 'analyzing' ? '분석 중' : '미확인')}</Text></Table.Td>
              <Table.Td ta="center"><Text size="sm" fw={600}>{doc.extraction ? doc.extraction.items.length.toLocaleString() : '—'}</Text></Table.Td>
              <Table.Td ta="center"><Group gap={7} wrap="nowrap" justify="center">{doc.status === 'analyzing' && <Loader size={13} />}<Badge color={color} variant="light">{label}</Badge></Group></Table.Td>
              <Table.Td ta="center"><Button size="xs" variant={selected ? 'light' : 'subtle'} color={selected ? 'indigo' : 'gray'} loading={doc.cacheChecking} disabled={['analyzing', 'queued'].includes(doc.status)} onClick={(event) => { event.stopPropagation(); void showDocumentResult(doc); }}>결과 확인</Button></Table.Td>
            </Table.Tr>;
          })}</Table.Tbody>
        </Table>
      </ScrollArea>}
    </Paper>}

    <Box className={classes.comparisonArea}>{selectedDoc ? <OrderDocumentWorkspace key={selectedDoc.id} doc={selectedDoc} updateDocument={updateDocument} onConfirm={requestOrderConfirmation} confirming={confirmingId === selectedDoc.id} /> : <Paper withBorder className={classes.noSelection}>
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
    <Modal opened={Boolean(orderConfirmTarget)} onClose={() => !confirmingId && setOrderConfirmTargetId(null)} title="주문확정 저장" size="sm" centered radius="md" overlayProps={{ backgroundOpacity: 0.5, blur: 2 }}>
      <Stack gap="md">
        <Stack gap={3}>
          <Text size="sm" c="dimmed">검토한 발주서와 상세 품목을 확정 주문으로 저장합니다.</Text>
          <Text size="sm" c="dimmed">저장 후 주문서 확정 화면으로 이동합니다.</Text>
        </Stack>
        <Paper withBorder p="sm" radius="sm" className={classes.analysisCostNotice}>
          <Group justify="space-between" gap="md"><Text size="sm" fw={700}>발주처</Text><Text size="sm">{orderConfirmTarget?.extraction?.header?.buyer || '미입력'}</Text></Group>
          <Group justify="space-between" gap="md" mt={6}><Text size="sm" fw={700}>수신처</Text><Text size="sm">{orderConfirmTarget?.extraction?.header?.recipient || '미입력'}</Text></Group>
          <Group justify="space-between" gap="md" mt={6}><Text size="sm" fw={700}>상세 품목</Text><Text size="sm">{(orderConfirmTarget?.extraction?.items || []).length.toLocaleString()}행</Text></Group>
        </Paper>
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setOrderConfirmTargetId(null)} disabled={Boolean(confirmingId)}>취소</Button>
          <Button color="red" leftSection={<IconPlayerPlay size={15} />} onClick={() => void confirmDocument()} loading={confirmingId === orderConfirmTargetId}>저장 후 이동</Button>
        </Group>
      </Stack>
    </Modal>
    <Modal opened={Boolean(analysisConfirm)} onClose={() => setAnalysisConfirm(null)} title="AI 분석 실행 확인" size="md" centered radius="md" overlayProps={{ backgroundOpacity: 0.5, blur: 2 }}>
      <Box className={classes.analysisConfirmBody}>
        <Group align="flex-start" gap="md" wrap="nowrap">
          <ThemeIcon size={44} radius="xl" variant="light" color="red"><IconPlayerPlay size={21} /></ThemeIcon>
          <Box>
            <Text fw={700} size="md">선택한 파일 분석을 시작할까요?</Text>
            <Text size="sm" c="dimmed" mt={5}>{`${analysisConfirm?.ids.length || 0}개 파일을 분석 대기열에 추가합니다.`}</Text>
          </Box>
        </Group>
        <Box className={classes.analysisCostNotice}>
          <>
            <Text size="sm" fw={600}>이전에 분석한 주문서는 자동으로 불러옵니다.</Text>
            <Text size="sm" c="dimmed" mt={3}>동일한 주문서를 다시 등록하면 기존 분석 결과를 불러옵니다. 분석에 실패한 파일만 다시 분석할 수 있습니다.</Text>
          </>
        </Box>
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={() => setAnalysisConfirm(null)}>취소</Button>
          <Button color="red" leftSection={<IconPlayerPlay size={15} />} onClick={confirmAnalysis}>AI 분석 실행</Button>
        </Group>
      </Box>
    </Modal>
  </Box>;
}
