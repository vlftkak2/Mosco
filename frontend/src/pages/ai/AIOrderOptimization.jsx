// 가공 최적화 (메뉴: AI_OPTIMIZATION)
// 주문서 관리에서 보낸 "최적화 대기" 품목 → ① 발주·원자재 확인 → ② 원자재 후보 → ③ 원자재·가공방식 → ④ 추천조합
// → 임시저장 / 계획 확정 (품목 계획확정, 원자재 현재고 예약) / 계획 취소 / 주문서 관리로 돌려보내기.
// 계산은 서버(backend/services/ai/AIOrderOptimization.py)에서 하고 화면은 결과를 보여준다.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { useSearchParams } from 'react-router-dom';
import { ActionIcon, Box, Button, Group, Modal, NumberInput, Pagination, Paper, Popover, SegmentedControl, Select, Stack, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconDeviceFloppy, IconFilter, IconFolderOpen, IconInfoCircle, IconListCheck, IconPlus, IconSearch, IconX } from '@tabler/icons-react';
import useErpPageRibbon from '../../components/common/useErpPageRibbon';
import usePageReactivated from '../../components/common/usePageReactivated';
import sharedClasses from '../../styles/pages/ManagementShared.module.css';
import inboundClasses from '../../styles/pages/InboundRegister.module.css';
// 주문서 관리와 같은 틀(패널·표·배지·버튼)을 그대로 쓴다
import reg from '../../styles/pages/AIOrderRegistry.module.css';
import outboundClasses from '../../styles/pages/OutboundRegister.module.css';
import classes from '../../styles/pages/AIOrderOptimization.module.css';

const API = '/api/ai-optimization';
const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });
const errorText = (error, fallback) => (typeof error?.response?.data?.detail === 'string' ? error.response.data.detail : fallback);
const fmt = (value, digits = 1) => (value === null || value === undefined || value === '' ? '–'
  : Number(value).toLocaleString('ko-KR', { maximumFractionDigits: digits }));
const dateText = (value) => (value ? String(value).slice(0, 10) : '');
const keyOf = (row) => `${row.orderid}|${row.lineno}`;
const PICKER_PAGE_SIZE = 20;
// 품목의 창고 = 재고매칭으로 연결한 재고의 창고 (없으면 아직 정해지지 않음)
const warehouseCodes = (row) => (row?.warehouses || []).map((item) => item.code);
const warehouseNames = (row) => (row?.warehouses || []).map((item) => item.name || item.code).join(', ');
// 함께 계산할 수 있는지: 같은 품명·두께 (시트는 폭까지) + 같은 창고. 안 되면 이유를 돌려준다
const incompatibleReason = (base, row, baseWarehouses = []) => {
  const rowCodes = warehouseCodes(row);
  if (rowCodes.length > 1) return `연결 재고가 여러 창고(${warehouseNames(row)})에 있습니다`;
  if (rowCodes.length && baseWarehouses.length && !baseWarehouses.includes(rowCodes[0])) return '창고가 다릅니다 (같은 창고에서만 가공 최적화)';
  if (!base) return '';
  if (String(base.itemname).trim().toLowerCase() !== String(row.itemname).trim().toLowerCase() || Number(base.thickness) !== Number(row.thickness)) {
    return `기준 품목(${base.itemname} ${fmt(base.thickness, 3)}T)과 품명·두께가 다릅니다`;
  }
  if (base.material === 'SHEET' && Number(base.width) !== Number(row.width)) return `시트는 폭이 같아야 합니다 (기준 ${fmt(base.width)}mm)`;
  return '';
};
const toKeys = (keys) => keys.map((key) => { const [orderid, lineno] = key.split('|'); return { orderid, lineno: Number(lineno) }; });
const MATERIAL_TABS = [{ value: 'COIL', label: '코일·스켈프' }, { value: 'SHEET', label: '시트·판재' }];
const PLAN_STATUS = { DRAFT: { label: '임시저장', tone: 'blue' }, CONFIRMED: { label: '계획확정', tone: 'green' }, CANCELLED: { label: '취소', tone: '' }, DONE: { label: '가공완료', tone: 'green' } };
const DEFAULT_SETTINGS = { combo: 'SINGLE', processmode: 'ONE', trimloss: 4, orientation: 'NORMAL', newwidths: [], newsizes: [], extrawidths: [] };
const FORMULAS = {
  COIL: {
    input: '신규: 필요중량 × (후보폭 ÷ 사용폭) / 현재고: 원코일 실제중량',
    production: '투입중량 × (사용폭 ÷ 후보폭)',
    loss: '투입중량 − 생산중량',
    yield: '(생산중량 ÷ 투입중량) × 100',
  },
  SHEET: {
    input: '원판 1매 중량 × 필요 원판 매수',
    production: 'Σ(절단제품 면적 × 생산수량) × 두께 × 7.85',
    loss: '투입중량 − 생산중량',
    yield: '(제품 면적 ÷ 원판 면적) × 100',
  },
};

// 표 칸 정의 (너비는 머리 경계를 끌어 조절, 합계보다 화면이 좁으면 좌우 스크롤)
const TARGET_COLUMNS = [
  { key: 'mark', label: '구분', width: 58, minWidth: 44, align: 'center' },
  { key: 'duedate', label: '납기일', width: 90, minWidth: 70 },
  { key: 'order', label: '주문번호', width: 160, minWidth: 100 },
  { key: 'buyer', label: '발주처', width: 130, minWidth: 70 },
  { key: 'warehouse', label: '창고', width: 100, minWidth: 60 },
  { key: 'itemname', label: '품명', width: 100, minWidth: 60 },
  { key: 'steelgrade', label: '강종', width: 74, minWidth: 50 },
  { key: 'surface', label: '표면', width: 64, minWidth: 50 },
  { key: 'thickness', label: '두께', width: 64, minWidth: 50, align: 'right' },
  { key: 'width', label: '폭', width: 70, minWidth: 50, align: 'right' },
  { key: 'length', label: '길이', width: 70, minWidth: 50, align: 'right', sheetOnly: true },
  { key: 'order_amount', label: '발주', width: 92, minWidth: 70, align: 'right', unit: true },
  { key: 'ready_amount', label: '선가공', width: 92, minWidth: 70, align: 'right', unit: true },
  { key: 'need_amount', label: '필요', width: 92, minWidth: 70, align: 'right', unit: true },
  { key: 'status', label: '상태', width: 160, minWidth: 100 },
];
const CANDIDATE_COLUMNS = [
  { key: 'rank', label: '우선순위', width: 80, minWidth: 60 },
  { key: 'label', label: '구분', width: 110, minWidth: 70 },
  { key: 'itemname', label: '품명', width: 110, minWidth: 60 },
  { key: 'size', label: '후보규격', width: 150, minWidth: 90 },
  { key: 'warehouse', label: '창고', width: 100, minWidth: 60 },
  { key: 'stock', label: '재고', width: 100, minWidth: 70 },
  { key: 'input', label: '투입중량', width: 110, minWidth: 80, info: 'input' },
  { key: 'production', label: '생산중량', width: 110, minWidth: 80, info: 'production' },
  { key: 'loss', label: '로스중량', width: 110, minWidth: 80, info: 'loss' },
  { key: 'yield', label: '수율', width: 90, minWidth: 70, info: 'yield' },
  { key: 'sheets', label: '필요 원판', width: 110, minWidth: 80, sheetOnly: true },
];

function useColumnWidths() {
  const [widths, setWidths] = useState({});
  const widthOf = useCallback((column) => widths[column.key] ?? column.width, [widths]);
  const startResize = useCallback((event, column, current) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    let frame = 0;
    let next = current;
    const move = (pointer) => {
      next = Math.max(column.minWidth || 40, Math.min(700, current + pointer.clientX - startX));
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; setWidths((state) => ({ ...state, [column.key]: next })); });
    };
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      if (frame) cancelAnimationFrame(frame);
      setWidths((state) => ({ ...state, [column.key]: next }));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  }, []);
  return { widthOf, startResize };
}

function ResizableHead({ columns, widthOf, startResize, labelOf }) {
  return <>
    <colgroup>{columns.map((column) => <col key={column.key} style={{ width: `${widthOf(column)}px` }} />)}</colgroup>
    <thead><tr>{columns.map((column) => <th key={column.key} className={reg.resizableHeader}
      style={{ width: widthOf(column), textAlign: column.align || 'left' }}>
      <span>{labelOf ? labelOf(column) : column.label}</span>
      <span className={reg.columnResizeHandle} role="separator" aria-label={`${column.label} 열 너비 조절`}
        onPointerDown={(event) => startResize(event, column, widthOf(column))} />
    </th>)}</tr></thead>
  </>;
}

function Info({ text }) {
  return <span title={text} style={{ display: 'inline-flex', marginLeft: 3, verticalAlign: '-2px', color: '#8b9aad', cursor: 'help' }}><IconInfoCircle size={13} /></span>;
}

function Card({ number, title, actions, children, bodyClass = classes.cardBody }) {
  return <section className={`${reg.panel} ${classes.card}`}>
    <header className={reg.panelHeader}>{number && <span className={classes.number}>{number}</span>}<strong>{title}</strong>{actions && <div className={classes.actions}>{actions}</div>}</header>
    <div className={bodyClass}>{children}</div>
  </section>;
}

// 코일 슬리팅 배치 (회차별 막대)
const CoilViz = memo(function CoilViz({ plan, rawWidth }) {
  if (!plan) return null;
  const extraIndex = (piece) => (piece.extra ? classes.pieceExtra : classes[`piece${plan.pieces.indexOf(piece) % 4}`]);
  return <>{(plan.runs || [{ weight: plan.input_weight }]).map((run, index) => <div key={index}>
    <div className={classes.rowTitle}>{(plan.runs || []).length > 1 ? `${index + 1}차 가공` : '가공'} · 투입 {fmt(run.weight)}kg</div>
    <div className={classes.coilBar} role="img" aria-label={`${plan.pattern} 배치`}>
      {plan.pieces.flatMap((piece) => Array.from({ length: piece.cuts }, (_, n) => (
        <span key={`${piece.width}-${n}`} className={`${classes.piece} ${extraIndex(piece)}`} style={{ flex: piece.width }} title={`${fmt(piece.width)}mm`}>{fmt(piece.width)}</span>
      )))}
      {plan.remain_width > 0.001 && <span className={`${classes.piece} ${classes.loss}`} style={{ flex: plan.remain_width }} title={`잔여폭 ${fmt(plan.remain_width)}mm`} />}
    </div>
    <div className={classes.subMetric}><span>사용폭 {fmt(plan.used_width)}mm</span><span>원코일 {fmt(rawWidth)}mm</span><span>잔여폭 {fmt(plan.remain_width)}mm</span></div>
  </div>)}</>;
});

// 시트 2D 절단 배치 (원판 1매)
const SheetViz = memo(function SheetViz({ plan, rawWidth, rawLength }) {
  if (!plan || !rawWidth || !rawLength) return null;
  const sh = 170;
  const sw = Math.max(300, Math.min(620, sh * rawLength / rawWidth));
  const xr = sw / rawLength;
  const yr = sh / rawWidth;
  const colors = ['#cfe3f5', '#cfe9dd', '#f7e7bb', '#e6dbf6', '#f9d9cf'];
  const rects = [];
  const itemW = plan.pieces[0]?.width || 0;
  for (let strip = 0; strip < plan.strips; strip += 1) {
    let cursor = 0;
    plan.pieces.forEach((piece, i) => {
      for (let n = 0; n < piece.per_strip; n += 1) {
        const normal = plan.orientation !== 'ROTATED';
        const x = (normal ? cursor : strip * itemW) * xr;
        const y = (normal ? strip * itemW : cursor) * yr;
        const w = (normal ? piece.length : itemW) * xr;
        const h = (normal ? itemW : piece.length) * yr;
        cursor += piece.length;
        rects.push(<g key={`${strip}-${i}-${n}`}><rect x={x} y={y} width={w} height={h} fill={colors[i % colors.length]} stroke="#fff" strokeWidth="0.8" />
          <text x={x + w / 2} y={y + h / 2} textAnchor="middle" dominantBaseline="middle" fontSize={Math.min(10, Math.max(7, Math.min(w, h) * 0.33))} fill="#34485d" fontWeight="700">{fmt(piece.length)}</text></g>);
      }
    });
  }
  return <svg className={classes.sheetSvg} viewBox={`0 0 ${sw} ${sh}`} role="img" aria-label="원판 절단 배치">
    <defs><pattern id="sheetHatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="#e5e9ed" /><rect width="2" height="7" fill="#cfd6dc" /></pattern></defs>
    <rect x="0" y="0" width={sw} height={sh} fill="url(#sheetHatch)" />{rects}
    <rect x=".5" y=".5" width={sw - 1} height={sh - 1} fill="none" stroke="#c5d1df" />
  </svg>;
});

const PieceSummary = memo(function PieceSummary({ plan, material }) {
  if (!plan) return null;
  return <div className={classes.summary}>
    {material === 'COIL' ? <>
      <div><span>가공 투입중량</span><strong>{fmt(plan.input_weight)}kg</strong></div>
      {plan.pieces.map((piece) => {
        const diff = piece.produced_weight - piece.need_weight;
        return <div key={piece.width}><span>{fmt(piece.width)}mm {piece.extra ? '(추가 폭)' : ''} 생산</span>
          <strong>{fmt(piece.produced_weight)}kg{!piece.extra && (diff > 0.05 ? <span className={classes.over}>필요 {fmt(piece.need_weight)} · ▲{fmt(diff)}</span>
            : diff < -0.05 ? <span className={classes.under}>필요 {fmt(piece.need_weight)} · ▼{fmt(-diff)}</span> : null)}</strong></div>;
      })}
      <div><span>예상 로스중량</span><strong>{fmt(plan.loss_weight)}kg</strong></div>
    </> : <>
      <div><span>필요 원판</span><strong>{fmt(plan.sheets, 0)}매</strong></div>
      {plan.pieces.map((piece) => <div key={`${piece.orderid}-${piece.lineno}`}><span>{fmt(piece.width)} × {fmt(piece.length)} 생산</span>
        <strong>{fmt(piece.produced_qty, 0)}매{piece.over_qty > 0 ? <span className={classes.over}>필요 {fmt(piece.need_qty, 0)} · ▲{fmt(piece.over_qty, 0)}</span> : null}</strong></div>)}
      <div><span>가공 투입중량</span><strong>{fmt(plan.input_weight, 2)}kg</strong></div>
      <div><span>예상 로스중량</span><strong>{fmt(plan.loss_weight, 2)}kg</strong></div>
    </>}
  </div>;
});

export default function AIOrderOptimization() {
  // 주문서 관리 [가공 최적화] 버튼으로 열면 그 주문의 대기 품목을 미리 선택한다 (한 번만)
  const [searchParams] = useSearchParams();
  const pendingOrderRef = useRef(searchParams.get('orderid') || '');
  const [filterOpen, setFilterOpen] = useState(true);
  const [filterInputs, setFilterInputs] = useState({ buyer: '', itemname: '' });
  const [filters, setFilters] = useState({ buyer: '', itemname: '' });
  const [material, setMaterial] = useState('COIL');
  // 대기 품목 불러오기 / 계획 불러오기 창
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerKeys, setPickerKeys] = useState([]);
  const [pickerFilter, setPickerFilter] = useState({ buyer: '', itemname: '', thickness: '' });
  const [pickerPage, setPickerPage] = useState(1);
  const [planPickerOpen, setPlanPickerOpen] = useState(false);
  const [queue, setQueue] = useState([]);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [analysis, setAnalysis] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [planId, setPlanId] = useState('A');
  const [activePlan, setActivePlan] = useState(null); // { planno, status, detail }
  const [saving, setSaving] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);
  const [editLine, setEditLine] = useState(null);
  const [newWidth, setNewWidth] = useState('');
  const [newLength, setNewLength] = useState('');
  const [extraWidth, setExtraWidth] = useState('');
  const requestRef = useRef(0);
  const delayRef = useRef(0); // 다음 계산까지 기다릴 시간 (숫자 입력 중에만 잠깐 기다림)
  const targetWidths = useColumnWidths();
  const candidateWidths = useColumnWidths();

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [queueResponse, planResponse] = await Promise.all([
        // 계획확정 품목도 받아 둔다 (확정 계획을 열 때 품목을 보여주기 위해). 불러오기 창은 대기 품목만.
        axios.get(`${API}/queue`, { ...authConfig(), params: { status: 'ALL', ...filters } }),
        axios.get(`${API}/plans`, { ...authConfig(), params: { status: 'OPEN' } }),
      ]);
      const items = queueResponse.data.items || [];
      setQueue(items);
      // 주문서 관리에서 되돌린 품목 등, 목록에 없는 품목은 담은 목록에서도 뺀다
      const alive = new Set(items.map(keyOf));
      setSelectedKeys((current) => (current.every((key) => alive.has(key)) ? current : current.filter((key) => alive.has(key))));
      setPlans(planResponse.data.items || []);
      const orderid = pendingOrderRef.current;
      if (orderid) {
        pendingOrderRef.current = '';
        const lines = items.filter((row) => row.orderid === orderid);
        const base = lines[0];
        if (base) {
          // 기준 품목과 같은 소재(코일/시트) · 품명 · 두께 (시트는 폭까지) 인 품목만 함께 선택
          const group = [];
          lines.forEach((row) => {
            const codes = [...new Set(group.flatMap(warehouseCodes))];
            if (row.material === base.material && !row.missing?.length && !incompatibleReason(group[0] || null, row, codes)) group.push(row);
          });
          setMaterial(base.material);
          setActivePlan(null);
          setSelectedKeys(group.map(keyOf));
          setSettings({ ...DEFAULT_SETTINGS, combo: group.length > 1 ? 'MIXED' : 'SINGLE' });
          if (group.length < lines.length) {
            notifications.show({ title: `${orderid} 품목을 선택했습니다`, message: `함께 계산할 수 있는 ${group.length}개 품목을 선택했습니다. 나머지(창고·소재·품명·두께가 다르거나 값이 빠진 품목)는 따로 선택해 주세요.`, color: 'blue' });
          }
        } else {
          notifications.show({ title: '최적화 대기 품목 없음', message: `${orderid} 주문에는 최적화 대기 품목이 없습니다. 이미 계획에 들어갔거나 아직 보내지 않았습니다.`, color: 'orange' });
        }
      }
    } catch (error) {
      notifications.show({ title: '가공 최적화 조회 실패', message: errorText(error, '대기 품목을 불러오지 못했습니다.'), color: 'red' });
    } finally {
      setLoading(false);
    }
  }, [filters]);
  useEffect(() => { void loadData(); }, [loadData]);
  usePageReactivated(() => { void loadData(); });

  const materialQueue = useMemo(() => queue.filter((row) => row.material === material && row.optimize_status === 'WAITING'), [queue, material]);
  const materialPlans = useMemo(() => plans.filter((row) => row.materialtype === material), [plans, material]);
  const selectedRows = useMemo(() => selectedKeys.map((key) => queue.find((row) => keyOf(row) === key)).filter(Boolean), [selectedKeys, queue]);
  const editingDraft = activePlan?.status === 'DRAFT';
  const viewingConfirmed = activePlan?.status === 'CONFIRMED';
  const analyzeKeys = useMemo(() => (viewingConfirmed ? [] : selectedKeys), [viewingConfirmed, selectedKeys]);

  // 선택·설정이 바뀌면 서버에서 다시 계산 (잠깐 기다렸다가)
  const runAnalyze = useCallback(async (keys, nextSettings, planno) => {
    const id = ++requestRef.current;
    setAnalyzing(true);
    try {
      const { data } = await axios.post(`${API}/analyze`, { keys: toKeys(keys), settings: nextSettings, planno: planno || '' }, authConfig());
      if (id === requestRef.current) setAnalysis(data);
    } catch (error) {
      if (id === requestRef.current) {
        setAnalysis(null);
        notifications.show({ title: '계산할 수 없습니다', message: errorText(error, '가공 최적화 계산에 실패했습니다.'), color: 'orange' });
      }
    } finally {
      if (id === requestRef.current) setAnalyzing(false);
    }
  }, []);
  useEffect(() => {
    if (!analyzeKeys.length) return undefined;
    const timer = setTimeout(() => { void runAnalyze(analyzeKeys, settings, editingDraft ? activePlan.planno : ''); }, delayRef.current);
    delayRef.current = 0;
    return () => clearTimeout(timer);
  }, [analyzeKeys, settings, runAnalyze, editingDraft, activePlan]);
  const shownAnalysis = analyzeKeys.length ? analysis : null;
  const plansList = shownAnalysis?.plans || [];
  const chosenPlan = plansList.find((plan) => plan.id === planId) || plansList[0] || null;
  const raw = shownAnalysis?.raw || null;
  const unit = material === 'COIL' ? 'kg' : '매';

  const resetWork = () => { setSelectedKeys([]); setSettings(DEFAULT_SETTINGS); setActivePlan(null); setPlanId('A'); };
  const changeMaterial = (value) => { setMaterial(value); resetWork(); };
  const updateSettings = (patch, delay = 0) => { delayRef.current = delay; setSettings((current) => ({ ...current, ...patch })); };
  const typeSettings = (patch) => updateSettings(patch, 400); // 숫자 입력: 입력이 멈추면 계산
  const chooseRaw = (id) => updateSettings({ raw_id: id, raw_width: undefined, raw_weight: undefined, raw_length: undefined, splitweights: undefined, partialweight: undefined });

  const removeRow = (key) => {
    if (activePlan) return;
    const next = selectedKeys.filter((item) => item !== key);
    setSelectedKeys(next);
    if (next.length <= 1) updateSettings({ combo: 'SINGLE' });
  };

  // 대기 품목 불러오기: 이미 담은 품목 + 창에서 고른 품목의 첫 품목이 기준
  const openPicker = () => { setPickerKeys([]); setPickerPage(1); setPickerOpen(true); };
  const pickerBase = selectedRows[0] || queue.find((row) => keyOf(row) === pickerKeys[0]) || null;
  const pickerWarehouses = [...new Set([...selectedRows, ...pickerKeys.map((key) => queue.find((row) => keyOf(row) === key))].filter(Boolean).flatMap(warehouseCodes))];
  const pickerRows = useMemo(() => {
    const buyer = pickerFilter.buyer.trim().toLowerCase();
    const item = pickerFilter.itemname.trim().toLowerCase();
    const thickness = pickerFilter.thickness.trim();
    return materialQueue.filter((row) => !selectedKeys.includes(keyOf(row))
      && (!buyer || String(row.buyer || '').toLowerCase().includes(buyer))
      && (!item || String(row.itemname || '').toLowerCase().includes(item))
      && (!thickness || Number(row.thickness) === Number(thickness)));
  }, [materialQueue, selectedKeys, pickerFilter]);
  const pickerPageRows = pickerRows.slice((pickerPage - 1) * PICKER_PAGE_SIZE, pickerPage * PICKER_PAGE_SIZE);
  const togglePick = (row) => {
    const key = keyOf(row);
    if (pickerKeys.includes(key)) { setPickerKeys(pickerKeys.filter((item) => item !== key)); return; }
    if (incompatibleReason(pickerBase, row, pickerWarehouses)) return;
    setPickerKeys([...pickerKeys, key]);
  };
  const applyPicker = () => {
    if (!pickerKeys.length) return;
    const next = [...selectedKeys, ...pickerKeys];
    setSelectedKeys(next);
    if (next.length > 1) updateSettings({ combo: 'MIXED' });
    setPickerOpen(false);
  };

  const openPlan = async (planno) => {
    try {
      const { data } = await axios.get(`${API}/plans/${encodeURIComponent(planno)}`, authConfig());
      const pattern = data.header.pattern || {};
      setPlanPickerOpen(false);
      setActivePlan({ planno, status: data.header.status, detail: data });
      setSelectedKeys((pattern.keys || []).map(([orderid, lineno]) => `${orderid}|${lineno}`));
      setSettings({ ...DEFAULT_SETTINGS, ...(pattern.settings || {}) });
      setPlanId(pattern.plan?.id || 'A');
    } catch (error) {
      notifications.show({ title: '계획 조회 실패', message: errorText(error, '계획을 불러오지 못했습니다.'), color: 'red' });
    }
  };

  const savePlan = async (status) => {
    if (!selectedKeys.length || !chosenPlan || saving) return;
    setSaving(true);
    try {
      const { data } = await axios.post(`${API}/plans`, {
        keys: toKeys(selectedKeys), settings, planno: editingDraft ? activePlan.planno : '', status, plan_id: chosenPlan.id,
      }, authConfig());
      notifications.show({ title: status === 'CONFIRMED' ? '계획 확정 완료' : '임시저장 완료', message: `${data.planno} · ${status === 'CONFIRMED' ? '품목은 계획확정, 원자재는 이 계획에 잡혔습니다.' : '임시저장했습니다.'}`, color: 'teal' });
      if (status === 'CONFIRMED') resetWork(); else setActivePlan({ planno: data.planno, status: 'DRAFT' });
      await loadData();
    } catch (error) {
      notifications.show({ title: '저장 실패', message: errorText(error, '가공 계획을 저장하지 못했습니다.'), color: 'red' });
    } finally {
      setSaving(false);
      setConfirmAction(null);
    }
  };

  const cancelPlan = async () => {
    if (!activePlan || saving) return;
    setSaving(true);
    try {
      await axios.post(`${API}/plans/${encodeURIComponent(activePlan.planno)}/cancel`, {}, authConfig());
      notifications.show({ title: activePlan.status === 'DRAFT' ? '임시저장 삭제' : '계획 취소', message: `${activePlan.planno} · 품목은 최적화 대기로 돌아갔습니다.`, color: 'teal' });
      resetWork();
      await loadData();
    } catch (error) {
      notifications.show({ title: '취소 실패', message: errorText(error, '계획을 취소하지 못했습니다.'), color: 'red' });
    } finally {
      setSaving(false);
      setConfirmAction(null);
    }
  };

  const returnToOrders = async () => {
    if (!selectedKeys.length || saving) return;
    setSaving(true);
    try {
      const { data } = await axios.post(`${API}/return`, { keys: toKeys(selectedKeys) }, authConfig());
      notifications.show({ title: '주문서 관리로 돌려보냄', message: `${data.returned}개 품목을 미전송으로 돌렸습니다. 주문서 관리에서 수정할 수 있습니다.`, color: 'teal' });
      resetWork();
      await loadData();
    } catch (error) {
      notifications.show({ title: '돌려보내기 실패', message: errorText(error, '주문서 관리로 돌려보내지 못했습니다.'), color: 'red' });
    } finally {
      setSaving(false);
      setConfirmAction(null);
    }
  };

  const saveLineValues = async () => {
    if (!editLine || saving) return;
    const payload = Object.fromEntries(['thickness', 'width', 'length', 'quantity', 'weight_kg']
      .filter((key) => editLine.values[key] !== '' && editLine.values[key] !== null && editLine.values[key] !== undefined)
      .map((key) => [key, Number(editLine.values[key])]));
    setSaving(true);
    try {
      await axios.put(`${API}/lines/${encodeURIComponent(editLine.row.orderid)}/${editLine.row.lineno}`, payload, authConfig());
      notifications.show({ title: '품목 값 저장', message: `${editLine.row.orderid}-${editLine.row.lineno} 값을 저장했습니다.`, color: 'teal' });
      setEditLine(null);
      await loadData();
      setSettings((current) => ({ ...current }));
    } catch (error) {
      notifications.show({ title: '저장 실패', message: errorText(error, '품목 값을 저장하지 못했습니다.'), color: 'red' });
    } finally {
      setSaving(false);
    }
  };

  const canSave = Boolean(selectedKeys.length && chosenPlan && !viewingConfirmed && !analyzing);
  const actionsRef = useRef({});
  useEffect(() => { actionsRef.current = { loadData, savePlan }; });
  useErpPageRibbon({
    showPrint: false,
    useSaveColor: false,
    onSearch: () => actionsRef.current.loadData(),
    onSave: canSave ? () => actionsRef.current.savePlan('DRAFT') : undefined,
  });

  const runSearch = () => setFilters({ ...filterInputs });
  const addNewCandidate = () => {
    const width = Number(newWidth);
    if (!(width > 0)) return;
    if (material === 'COIL') updateSettings({ newwidths: [...new Set([...(settings.newwidths || []), width])], raw_id: `NEW|${width}`, raw_width: undefined, raw_weight: undefined });
    else {
      const length = Number(newLength);
      if (!(length > 0)) return;
      updateSettings({ newsizes: [...(settings.newsizes || []), { width, length }], raw_id: `NEW|${width}x${length}`, raw_width: undefined, raw_length: undefined });
    }
    setNewWidth(''); setNewLength('');
  };
  const addExtraWidth = () => {
    const width = Number(extraWidth);
    if (!(width > 0)) return;
    updateSettings({ extrawidths: [...new Set([...(settings.extrawidths || []), width])], combo: 'MIXED' });
    setExtraWidth('');
  };

  // ---------------- 화면 조각 ----------------
  const targetColumns = TARGET_COLUMNS.filter((column) => !column.sheetOnly || material === 'SHEET');
  const targetTableWidth = targetColumns.reduce((sum, column) => sum + targetWidths.widthOf(column), 0);
  const targetTableStyle = { width: `max(100%, ${targetTableWidth}px)`, minWidth: `${targetTableWidth}px` };
  const targetHead = (first) => <ResizableHead columns={targetColumns} {...targetWidths}
    labelOf={(column) => (column.key === 'mark' ? first : column.unit ? `${column.label}(${unit})` : column.label)} />;
  const candidateColumns = CANDIDATE_COLUMNS.filter((column) => !column.sheetOnly || material === 'SHEET');
  const candidateTableWidth = candidateColumns.reduce((sum, column) => sum + candidateWidths.widthOf(column), 0);
  const lineCells = (row) => <>
    <td>{dateText(row.duedate)}</td><td title={`${row.orderid}-${row.lineno}`}>{row.orderid}-{row.lineno}</td>
    <td title={row.buyer || ''}>{row.buyer}</td><td title={warehouseNames(row) || '연결 재고 없음'}>{warehouseNames(row) || '–'}</td><td title={row.itemname || ''}>{row.itemname}</td><td>{row.steelgrade}</td><td>{row.surface}</td>
    <td className={classes.num}>{fmt(row.thickness, 3)}</td><td className={classes.num}>{fmt(row.width, 3)}</td>{material === 'SHEET' && <td className={classes.num}>{fmt(row.length, 3)}</td>}
    <td className={classes.num} title={row.converted?.join(' · ') || ''}>{fmt(row.order_amount)}{row.converted?.length ? '*' : ''}</td>
    <td className={classes.num}>{fmt(row.ready_amount)}</td><td className={classes.num}><b>{fmt(row.need_amount)}</b></td>
  </>;

  // 최적화 대상: 담은 품목만 (주문서 관리에서 넘긴 품목은 바로 담겨 있음)
  const targetTable = <div className={`${reg.tableScroll} ${classes.tableScroll}`}>
    <table className={`${reg.ordersTable} ${classes.table}`} style={targetTableStyle}>
      {targetHead('구분')}
      <tbody>{selectedRows.length ? selectedRows.map((row, index) => <tr key={keyOf(row)}>
        <td className={classes.center}>{index === 0 ? <span className={`${reg.badge} ${reg.orange}`}>기준</span> : index + 1}</td>
        {lineCells(row)}
        <td>{row.missing?.length
          ? <><span className={`${reg.badge} ${reg.orange}`} title={`빠진 값: ${row.missing.join(', ')}`}>확인 필요</span>
            <button type="button" className={classes.linkButton} onClick={() => setEditLine({ row, values: { thickness: row.thickness ?? '', width: row.width ?? '', length: row.length ?? '', quantity: row.quantity ?? '', weight_kg: row.weight ?? '' } })}>수정</button></>
          : row.optimize_status === 'PLANNED' ? <span className={`${reg.badge} ${reg.green}`}>계획확정</span>
            : <span className={reg.badge}>대기</span>}
          {!activePlan && <button type="button" className={classes.linkButton} style={{ marginLeft: 6 }} onClick={() => removeRow(keyOf(row))}>빼기</button>}</td>
      </tr>) : <tr><td colSpan={material === 'SHEET' ? 14 : 13} className={reg.empty}>{loading ? '불러오는 중입니다.'
        : materialQueue.length ? '[대기 품목 불러오기]로 최적화할 품목을 담아 주세요.' : '최적화 대기 품목이 없습니다. 주문서 관리에서 [가공 최적화로 보내기]를 해 주세요.'}</td></tr>}</tbody>
    </table>
  </div>;

  // 대기 품목 불러오기 창 (출고등록 현재고 조회와 같은 방식)
  const pickerModal = <Modal opened={pickerOpen} onClose={() => setPickerOpen(false)} centered size="90%" title={<Text fw={700}>대기 품목 불러오기 · {material === 'COIL' ? '코일·스켈프' : '시트·판재'}</Text>}>
    <Stack gap="sm">
      <div className={reg.info}>주문서 관리에서 보낸 최적화 대기 품목입니다. 같은 창고 · 같은 품명·두께(시트는 폭까지) 품목끼리만 함께 담을 수 있고, 첫 품목이 기준이 됩니다. 창고는 재고매칭으로 연결한 재고의 창고입니다.{pickerWarehouses.length ? ` 창고: ${queue.flatMap((row) => row.warehouses || []).find((item) => item.code === pickerWarehouses[0])?.name || pickerWarehouses[0]}` : ''}{pickerBase ? ` 기준: ${pickerBase.itemname} ${fmt(pickerBase.thickness, 3)}T${pickerBase.material === 'SHEET' ? ` × ${fmt(pickerBase.width)}` : ''}` : ''}</div>
      <Group gap="xs" align="end" className={classes.candidateTools}>
        <TextInput size="xs" label="발주처" w={160} value={pickerFilter.buyer} onChange={(event) => { const { value } = event.currentTarget; setPickerFilter((current) => ({ ...current, buyer: value })); setPickerPage(1); }} />
        <TextInput size="xs" label="품명" w={160} value={pickerFilter.itemname} onChange={(event) => { const { value } = event.currentTarget; setPickerFilter((current) => ({ ...current, itemname: value })); setPickerPage(1); }} />
        <TextInput size="xs" label="두께" w={90} value={pickerFilter.thickness} onChange={(event) => { const { value } = event.currentTarget; setPickerFilter((current) => ({ ...current, thickness: value })); setPickerPage(1); }} />
      </Group>
      <div className={reg.tableScroll} style={{ maxHeight: '55vh' }}>
        <table className={`${reg.ordersTable} ${classes.table}`} style={targetTableStyle}>
          {targetHead('선택')}
          <tbody>{pickerPageRows.length ? pickerPageRows.map((row) => {
            const key = keyOf(row);
            const picked = pickerKeys.includes(key);
            const reason = picked ? '' : incompatibleReason(pickerBase, row, pickerWarehouses);
            return <tr key={key} className={picked ? reg.selectedRow : ''} title={reason || undefined} style={reason ? { color: '#a6b0bd', cursor: 'not-allowed' } : undefined} onClick={() => togglePick(row)}>
              <td className={classes.center}><input type="checkbox" checked={picked} disabled={Boolean(reason)} readOnly aria-label={`${key} 선택`} /></td>
              {lineCells(row)}
              <td>{row.missing?.length ? <span className={`${reg.badge} ${reg.orange}`} title={`빠진 값: ${row.missing.join(', ')}`}>확인 필요</span> : reason ? <span className={reg.badge}>함께 불가</span> : <span className={reg.badge}>대기</span>}</td>
            </tr>;
          }) : <tr><td colSpan={material === 'SHEET' ? 14 : 13} className={reg.empty}>불러올 대기 품목이 없습니다.</td></tr>}</tbody>
        </table>
      </div>
      <Group justify="space-between">
        <Text size="xs" c="dimmed">총 {pickerRows.length}건 · {pickerKeys.length}개 선택</Text>
        <Group gap="xs">
          <Pagination size="sm" color="red" total={Math.max(1, Math.ceil(pickerRows.length / PICKER_PAGE_SIZE))} value={pickerPage} onChange={setPickerPage} withEdges />
          <Button size="xs" variant="default" className={reg.secondaryActionButton} onClick={() => setPickerOpen(false)}>취소</Button>
          <Button size="xs" variant="filled" color="red" className={reg.detailActionButton} onClick={applyPicker} disabled={!pickerKeys.length}>선택 반영</Button>
        </Group>
      </Group>
    </Stack>
  </Modal>;

  // 계획 불러오기 창
  const planPickerModal = <Modal opened={planPickerOpen} onClose={() => setPlanPickerOpen(false)} centered size="80%" title={<Text fw={700}>계획 불러오기 · {material === 'COIL' ? '코일·스켈프' : '시트·판재'}</Text>}>
    <div className={reg.tableScroll} style={{ maxHeight: '60vh' }}>
      <table className={`${reg.ordersTable} ${classes.table}`}>
        <colgroup><col style={{ width: 140 }} /><col style={{ width: 84 }} /><col style={{ width: 90 }} /><col style={{ width: 170 }} /><col style={{ width: 80 }} /><col style={{ width: 70 }} /><col /><col style={{ width: 90 }} /></colgroup>
        <thead><tr><th>계획번호</th><th>상태</th><th>원자재</th><th>규격</th><th>조합</th><th className={classes.num}>수율</th><th>주문 품목</th><th>등록자</th></tr></thead>
        <tbody>{materialPlans.length ? materialPlans.map((plan) => <tr key={plan.planno} className={activePlan?.planno === plan.planno ? reg.selectedRow : ''} onClick={() => void openPlan(plan.planno)}>
          <td>{plan.planno}</td><td><span className={`${reg.badge} ${reg[PLAN_STATUS[plan.status]?.tone] || ''}`}>{PLAN_STATUS[plan.status]?.label || plan.status}</span></td>
          <td>{plan.rawkind === 'STOCK' ? '현재고' : '신규'}</td><td>{plan.itemname} {fmt(plan.thickness, 3)} × {fmt(plan.width)}{plan.length ? ` × ${fmt(plan.length)}` : ''}</td>
          <td>{plan.combo === 'MIXED' ? '혼합' : '단독'}</td><td className={classes.num}>{fmt(plan.yieldrate, 2)}%</td><td title={plan.lines || ''}>{plan.lines}</td><td>{plan.created_by}</td>
        </tr>) : <tr><td colSpan={8} className={reg.empty}>임시저장·확정된 계획이 없습니다.</td></tr>}</tbody>
      </table>
    </div>
  </Modal>;

  const summary = shownAnalysis?.summary;
  const confirmedDetail = viewingConfirmed ? activePlan.detail : null;

  return <Box className={`${sharedClasses.pageShell} ${reg.page}`}>
    <Box component="nav" aria-label="현재 위치" className={inboundClasses.pageBreadcrumb}>
      <Group className={inboundClasses.breadcrumbTrail} gap={7}>
        <Text component="span" className={inboundClasses.breadcrumbParent}>가공관리</Text>
        <Text component="span" className={inboundClasses.breadcrumbChevron}>›</Text>
        <Text component="span" className={inboundClasses.breadcrumbCurrent}>가공 최적화</Text>
      </Group>
      {!filterOpen && <Button className={inboundClasses.receiptFilterToggle} variant="subtle" size="xs"
        leftSection={<IconFilter size={15} />} onClick={() => setFilterOpen(true)}>조회조건</Button>}
    </Box>
    <Box className={`${inboundClasses.inboundWorkspace} ${reg.orderWorkspace}`}>
      <Box className={`${inboundClasses.inboundPrimaryColumn} ${reg.orderPrimaryColumn} ${classes.main}`}>
        <section className={`${reg.panel} ${classes.card}`}>
          <header className={reg.panelHeader}>
            <strong>최적화 대상</strong>
            <span className={reg.count}>{selectedRows.length}건</span>
            <div className={classes.queueTabs}>
              <SegmentedControl size="xs" color="red" value={material} onChange={changeMaterial} data={MATERIAL_TABS} />
            </div>
            {activePlan && <span className={`${reg.badge} ${reg[PLAN_STATUS[activePlan.status]?.tone] || ''}`}>{activePlan.planno} · {PLAN_STATUS[activePlan.status]?.label}</span>}
            {shownAnalysis?.warehouse && <span className={`${reg.badge} ${reg.blue}`}>창고 {shownAnalysis.warehouse.name || shownAnalysis.warehouse.code}</span>}
          </header>
          {targetTable}
        </section>

        {confirmedDetail && <Card number="✓" title={`확정 계획 ${activePlan.planno}`}>
          <Group gap="lg" mb={8}>
            <Text size="sm">원자재 <b>{confirmedDetail.header.rawkind === 'STOCK' ? `현재고 ${confirmedDetail.header.stocksourceno}-${confirmedDetail.header.stocksourceline}` : '신규 매입'}</b></Text>
            <Text size="sm">규격 <b>{confirmedDetail.header.itemname} {fmt(confirmedDetail.header.thickness, 3)} × {fmt(confirmedDetail.header.width)}{confirmedDetail.header.length ? ` × ${fmt(confirmedDetail.header.length)}` : ''}</b></Text>
            <Text size="sm">수율 <b>{fmt(confirmedDetail.header.yieldrate, 2)}%</b></Text>
          </Group>
          {material === 'COIL'
            ? <CoilViz plan={confirmedDetail.header.pattern?.plan} rawWidth={confirmedDetail.header.width} />
            : <SheetViz plan={confirmedDetail.header.pattern?.plan} rawWidth={confirmedDetail.header.width} rawLength={confirmedDetail.header.length} />}
          <PieceSummary plan={confirmedDetail.header.pattern?.plan} material={material} />
        </Card>}

        {!viewingConfirmed && selectedKeys.length > 0 && <>
          {shownAnalysis?.message && <Paper withBorder p="sm" className={classes.warn}>{shownAnalysis.message}</Paper>}

          <Card number="1" title="발주·원자재 확인" actions={analyzing ? <span className={classes.muted}>계산 중…</span> : null}>
            {summary ? <div className={classes.tiles}>
              <div className={classes.tile}><div className={classes.tileTitle}>발주처</div><div className={classes.tileValue}><strong title={summary.buyers.join(', ')}>{summary.buyers.join(', ') || '–'}</strong></div></div>
              <div className={classes.tile}><div className={classes.tileTitle}>발주{material === 'COIL' ? '중량' : '수량'}</div><div className={classes.tileValue}><strong>{fmt(summary.order_amount)}{unit}</strong></div></div>
              <div className={classes.tile}><div className={classes.tileTitle}>선가공재고</div><div className={classes.tileValue}><strong>{fmt(summary.ready_amount)}{unit}</strong>
                <Popover withArrow shadow="sm" withinPortal><Popover.Target><ActionIcon size="sm" variant="default" aria-label="선가공재고 상세">▾</ActionIcon></Popover.Target>
                  <Popover.Dropdown><div className={classes.popList}>{summary.ready.length ? summary.ready.map((s) => <div key={`${s.sourceno}-${s.sourceline}`}>{s.itemname} {fmt(s.thickness, 3)} × {fmt(s.width)} · {material === 'COIL' ? `${fmt(s.weight)}kg` : `${fmt(s.qty, 0)}매`}</div>) : '주문서 관리에서 같은 규격으로 연결한 재고가 없습니다.'}</div></Popover.Dropdown></Popover></div></div>
              <div className={`${classes.tile} ${classes.tileNeed}`}><div className={classes.tileTitle}>필요{material === 'COIL' ? '중량' : '수량'}</div><div className={classes.tileValue}><strong>{fmt(summary.need_amount)}{unit}</strong></div></div>
              <div className={classes.tile}><div className={classes.tileTitle}>{material === 'COIL' ? '원코일재고' : '원판재고'}</div><div className={classes.tileValue}><strong>{fmt(summary.raw_stock_amount)}{unit}</strong>
                <Popover withArrow shadow="sm" withinPortal position="bottom-end"><Popover.Target><ActionIcon size="sm" variant="default" aria-label="원자재재고 상세">▾</ActionIcon></Popover.Target>
                  <Popover.Dropdown><div className={classes.popList}>{summary.raw_stock.length ? summary.raw_stock.map((s) => <div key={s.id}>{s.label} · {s.itemname} {fmt(s.thickness, 3)} × {fmt(s.width)}{s.length ? ` × ${fmt(s.length)}` : ''} · {material === 'COIL' ? `${fmt(s.weight)}kg` : `${fmt(s.qty, 0)}매`}</div>) : '쓸 수 있는 원자재 현재고가 없습니다.'}</div></Popover.Dropdown></Popover></div></div>
            </div> : <div className={classes.empty}>{analyzing ? '계산 중입니다.' : '품목 값을 확인해 주세요.'}</div>}
          </Card>

          <Card number="2" title="원자재 후보 추천" actions={<span className={classes.muted}>연결 원자재 → 현재고 → 과거 매입 규격 순, 수율 높은 순</span>}>
            <div className={classes.candidateTools}>
              <NumberInput size="xs" w={110} label={material === 'COIL' ? '원자재 폭 직접 입력' : '원판 폭'} placeholder="mm" value={newWidth} onChange={setNewWidth} hideControls min={0} />
              {material === 'SHEET' && <NumberInput size="xs" w={110} label="원판 길이" placeholder="mm" value={newLength} onChange={setNewLength} hideControls min={0} />}
              <Button size="xs" variant="default" className={reg.secondaryActionButton} leftSection={<IconPlus size={13} />} onClick={addNewCandidate}>후보 추가</Button>
            </div>
            {shownAnalysis?.candidates?.length ? <div className={`${reg.tableScroll} ${classes.candidateScroll}`}><table className={`${reg.ordersTable} ${classes.candidateTable}`} style={{ width: `max(100%, ${candidateTableWidth}px)`, minWidth: `${candidateTableWidth}px` }}>
              <ResizableHead columns={candidateColumns} {...candidateWidths}
                labelOf={(column) => (column.key === 'stock' ? (material === 'COIL' ? '중량(재고)' : '수량(재고)')
                  : column.info ? <>{column.label}<Info text={FORMULAS[material][column.info]} /></> : column.label)} />
              <tbody>{shownAnalysis.candidates.map((c) => <tr key={c.id} className={(settings.raw_id ?? raw?.id) === c.id ? reg.selectedRow : ''} onClick={() => { if ((settings.raw_id ?? raw?.id) !== c.id) chooseRaw(c.id); }}>
                <td>{c.rank}순위</td><td>{c.label}</td><td>{c.itemname}</td>
                <td>{fmt(c.thickness, 3)} × {fmt(c.width)}{material === 'SHEET' ? ` × ${fmt(c.length)}` : ' × C'}</td>
                <td>{c.kind === 'STOCK' ? c.warehouse : '–'}</td>
                <td>{c.kind === 'STOCK' ? (material === 'COIL' ? `${fmt(c.weight)}kg` : `${fmt(c.qty, 0)}매`) : '신규'}</td>
                <td>{fmt(c.input_weight)}kg</td><td>{fmt(c.production_weight)}kg</td><td>{fmt(c.loss_weight)}kg</td><td><b>{fmt(c.yield_rate, 2)}%</b></td>
                {material === 'SHEET' && <td>{fmt(c.sheets, 0)}매{c.short_sheets > 0 ? <span className={classes.under}>부족 {c.short_sheets}</span> : null}</td>}
              </tr>)}</tbody>
            </table></div> : <div className={classes.empty}>{analyzing ? '후보를 찾는 중입니다.' : '후보가 없습니다. 원자재 규격을 직접 입력해 후보를 추가해 주세요.'}</div>}
          </Card>

          <Card number="3" title="원자재·가공방식">
            {raw ? material === 'COIL' ? <>
              <div className={classes.fields}>
                <NumberInput label="가공폭 (mm)" value={settings.raw_width ?? raw.raw_width} onChange={(value) => typeSettings({ raw_width: value === '' ? undefined : value })} hideControls min={1} />
                <NumberInput label="가공중량 (kg)" value={settings.raw_weight ?? raw.raw_weight} onChange={(value) => typeSettings({ raw_weight: value === '' ? undefined : value })} hideControls min={1} thousandSeparator="," />
                <TextInput label="두께 (mm)" value={fmt(raw.thickness, 3)} readOnly />
                <NumberInput label="기본 로스 (mm)" value={settings.trimloss} onChange={(value) => typeSettings({ trimloss: value === '' ? 4 : value })} hideControls min={0} />
                <Select label="가공방식" value={settings.processmode} allowDeselect={false} onChange={(value) => updateSettings({ processmode: value, splitweights: undefined, partialweight: undefined })}
                  data={[{ value: 'ONE', label: '원샷' }, { value: 'SPLIT', label: '등분' }, { value: 'PARTIAL', label: '일부가공' }]} />
              </div>
              {settings.processmode === 'SPLIT' && <div className={classes.runs}>
                {(settings.splitweights || raw.runs).map((weight, index, list) => <NumberInput key={index} size="xs" label={`${index + 1}차 가공중량 (kg)`} value={weight} hideControls thousandSeparator=","
                  onChange={(value) => typeSettings({ splitweights: list.map((item, i) => (i === index ? Number(value) || 0 : item)) })} />)}
                <Button size="xs" variant="subtle" color="red" onClick={() => updateSettings({ splitweights: [...(settings.splitweights || raw.runs), 0] })}>+ 등분 추가</Button>
                {(settings.splitweights || raw.runs).length > 2 && <Button size="xs" variant="subtle" color="gray" onClick={() => updateSettings({ splitweights: (settings.splitweights || raw.runs).slice(0, -1) })}>마지막 등분 빼기</Button>}
              </div>}
              {settings.processmode === 'PARTIAL' && <div className={classes.runs}>
                <NumberInput size="xs" label="가공중량 (kg)" value={settings.partialweight ?? raw.process_weight} hideControls thousandSeparator="," onChange={(value) => typeSettings({ partialweight: Number(value) || 0 })} />
                <TextInput size="xs" label="보관중량 (kg)" value={fmt(raw.storage_weight)} readOnly />
              </div>}
            </> : <div className={classes.fields}>
              <NumberInput label="원판 폭 (mm)" value={settings.raw_width ?? raw.raw_width} onChange={(value) => typeSettings({ raw_width: value === '' ? undefined : value })} hideControls min={1} />
              <NumberInput label="원판 길이 (mm)" value={settings.raw_length ?? raw.raw_length} onChange={(value) => typeSettings({ raw_length: value === '' ? undefined : value })} hideControls min={1} />
              <TextInput label="원판 두께 (mm)" value={fmt(raw.thickness, 3)} readOnly />
              <TextInput label="원판 재고 (매)" value={raw.raw_sheets === null || raw.raw_sheets === undefined ? '신규' : fmt(raw.raw_sheets, 0)} readOnly />
              <Select label="절단방향" value={settings.orientation} allowDeselect={false} onChange={(value) => updateSettings({ orientation: value })}
                data={[{ value: 'NORMAL', label: '기본' }, { value: 'ROTATED', label: '90도 회전' }]} />
            </div> : <div className={classes.empty}>② 에서 원자재 후보를 선택해 주세요.</div>}
            {shownAnalysis?.warnings?.map((warning) => <div key={warning} className={classes.warn}>{warning}</div>)}
          </Card>

          <Card number="4" title="가공 추천조합" bodyClass={classes.recommendBody}>
            <div className={classes.box}>
              <div className={classes.methodRow}>
                <SegmentedControl size="xs" color="red" value={settings.combo} onChange={(value) => updateSettings({ combo: value })}
                  data={material === 'COIL' ? [{ value: 'SINGLE', label: '단독' }, { value: 'MIXED', label: '혼합' }] : [{ value: 'SINGLE', label: '단독절단' }, { value: 'MIXED', label: '혼합절단' }]} />
                {material === 'COIL' && settings.combo === 'MIXED' && <Group gap={4} wrap="nowrap">
                  <NumberInput size="xs" w={90} placeholder="추가 폭" value={extraWidth} onChange={setExtraWidth} hideControls min={1} />
                  <Button size="xs" variant="default" className={reg.secondaryActionButton} onClick={addExtraWidth}>폭 추가</Button>
                </Group>}
              </div>
              {material === 'COIL' && settings.extrawidths?.length > 0 && <Group gap={4} mb={8}>{settings.extrawidths.map((width) => <span key={width} className={reg.badge}>추가 {fmt(width)}mm
                <button type="button" className={classes.linkButton} aria-label={`추가 폭 ${width} 빼기`} onClick={() => updateSettings({ extrawidths: settings.extrawidths.filter((item) => item !== width) })}>×</button></span>)}</Group>}
              <div className={classes.plans}>{plansList.length ? plansList.map((plan) => <button key={plan.id} type="button" className={`${classes.plan} ${chosenPlan?.id === plan.id ? classes.planSelected : ''}`} onClick={() => setPlanId(plan.id)}>
                <span className={classes.planHead}><span>{plan.id}안 · {plan.combo === 'MIXED' ? (material === 'COIL' ? '혼합가공' : '혼합절단') : (material === 'COIL' ? '단독가공' : '단독절단')}</span><span>수율 <b>{fmt(plan.yield_rate, 2)}%</b></span></span>
                <div className={classes.planPattern}>{plan.pattern}</div>
                <span className={classes.planMeta}>{material === 'COIL' ? `사용폭 ${fmt(plan.used_width)}mm · 잔여폭 ${fmt(plan.remain_width)}mm · 로스 ${fmt(plan.loss_weight)}kg`
                  : `필요 원판 ${fmt(plan.sheets, 0)}매 · 로스 ${fmt(plan.loss_weight, 2)}kg`}</span>
              </button>) : <div className={classes.empty}>{analyzing ? '조합을 계산하는 중입니다.' : '추천 가능한 조합이 없습니다.'}</div>}</div>
            </div>
            <div className={classes.box}>
              {chosenPlan && raw ? <>
                <div className={classes.vizHead}><span className={classes.vizName}>선택안 · {chosenPlan.id}안</span>
                  <span className={classes.muted}>{material === 'COIL' ? `원코일 ${fmt(raw.raw_width)}mm` : `원판 ${fmt(raw.raw_width)} × ${fmt(raw.raw_length)}mm · ${settings.orientation === 'ROTATED' ? '90도 회전' : '기본'}`}</span></div>
                {material === 'COIL' ? <CoilViz plan={chosenPlan} rawWidth={raw.raw_width} /> : <SheetViz plan={chosenPlan} rawWidth={raw.raw_width} rawLength={raw.raw_length} />}
                <PieceSummary plan={chosenPlan} material={material} />
              </> : <div className={classes.empty}>조합을 선택하면 배치가 표시됩니다.</div>}
            </div>
          </Card>
        </>}

        {(selectedKeys.length > 0 || activePlan) && <div className={classes.footer}>
          <span className={classes.note}>{activePlan ? `${activePlan.planno} · ${PLAN_STATUS[activePlan.status]?.label || ''}` : `${selectedKeys.length}개 품목 선택`}</span>
          {!activePlan && <Button size="xs" variant="default" className={reg.secondaryActionButton} onClick={() => setConfirmAction('return')} disabled={saving}>주문서 관리로 돌려보내기</Button>}
          {activePlan && <Button size="xs" variant="default" className={reg.secondaryActionButton} onClick={() => setConfirmAction('cancel')} disabled={saving}>{editingDraft ? '임시저장 삭제' : '계획 취소'}</Button>}
          {!viewingConfirmed && <Button size="xs" variant="default" className={reg.secondaryActionButton} leftSection={<IconDeviceFloppy size={14} />} onClick={() => void savePlan('DRAFT')} disabled={!canSave || saving}>임시저장</Button>}
          {!viewingConfirmed && <Button size="xs" variant="filled" color="red" className={reg.detailActionButton} leftSection={<IconCheck size={14} />} onClick={() => setConfirmAction('confirm')} disabled={!canSave || saving}>계획 확정</Button>}
          {activePlan && <Button size="xs" variant="default" className={reg.secondaryActionButton} onClick={resetWork}>닫기</Button>}
        </div>}
      </Box>

      {filterOpen && <Paper component="aside" className={`${inboundClasses.receiptFilterSidebar} ${reg.orderFilterSidebar}`} withBorder>
        <Group className={inboundClasses.receiptFilterHeader} justify="space-between" align="center">
          <Text fw={700}>조회조건</Text>
          <ActionIcon variant="subtle" color="gray" aria-label="조회조건 닫기" onClick={() => setFilterOpen(false)}><IconX size={16} /></ActionIcon>
        </Group>
        <Stack gap="sm" className={inboundClasses.receiptFilterFields}>
          <TextInput label="발주처" placeholder="발주처명" value={filterInputs.buyer} onChange={(event) => { const { value } = event.currentTarget; setFilterInputs((current) => ({ ...current, buyer: value })); }} onKeyDown={(event) => event.key === 'Enter' && runSearch()} />
          <TextInput label="품명" placeholder="품명" value={filterInputs.itemname} onChange={(event) => { const { value } = event.currentTarget; setFilterInputs((current) => ({ ...current, itemname: value })); }} onKeyDown={(event) => event.key === 'Enter' && runSearch()} />
        </Stack>
        <Box className={outboundClasses.outboundStockLookup}>
          <Text fw={700} size="sm">대기 품목 조회</Text>
          <Text size="xs" c="dimmed">주문서 관리에서 보낸 품목을 불러옵니다. 같은 창고 품목끼리만 함께 계산합니다.</Text>
          <Button fullWidth color="red" leftSection={<IconListCheck size={15} />} onClick={openPicker}
            disabled={Boolean(activePlan)} title={activePlan ? '계획을 닫은 뒤 불러올 수 있습니다' : undefined}>품목 불러오기 ({materialQueue.length})</Button>
          <Button fullWidth variant="default" leftSection={<IconFolderOpen size={15} />} onClick={() => setPlanPickerOpen(true)}>계획 불러오기 ({materialPlans.length})</Button>
        </Box>
      </Paper>}
    </Box>

    {pickerModal}
    {planPickerModal}
    <Modal opened={Boolean(confirmAction)} onClose={() => !saving && setConfirmAction(null)} centered size="sm"
      title={<Text fw={700}>{confirmAction === 'confirm' ? '계획 확정' : confirmAction === 'cancel' ? (editingDraft ? '임시저장 삭제' : '계획 취소') : '주문서 관리로 돌려보내기'}</Text>}>
      <Stack gap="md">
        <Text size="sm" c="dimmed">{confirmAction === 'confirm' ? `${chosenPlan?.id || ''}안으로 계획을 확정합니다. 품목은 계획확정이 되고, 현재고 원자재는 이 계획에 잡혀 다른 메뉴에서 쓸 수 없습니다.`
          : confirmAction === 'cancel' ? (editingDraft ? '임시저장한 계획을 삭제합니다.' : '확정한 계획을 취소합니다. 품목은 최적화 대기로, 원자재는 다시 쓸 수 있게 됩니다.')
            : '선택한 품목을 주문서 관리로 돌려보냅니다 (미전송). 주문서 관리에서 수정 후 다시 보낼 수 있습니다.'}</Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setConfirmAction(null)} disabled={saving}>취소</Button>
          <Button color="red" loading={saving} onClick={() => { if (confirmAction === 'confirm') void savePlan('CONFIRMED'); else if (confirmAction === 'cancel') void cancelPlan(); else void returnToOrders(); }}>확인</Button>
        </Group>
      </Stack>
    </Modal>

    <Modal opened={Boolean(editLine)} onClose={() => !saving && setEditLine(null)} centered size="sm" title={<Text fw={700}>품목 값 보완 {editLine ? `· ${editLine.row.orderid}-${editLine.row.lineno}` : ''}</Text>}>
      {editLine && <Stack gap="sm">
        <Text size="xs" c="dimmed">빠진 값: {editLine.row.missing.join(', ')}. 코일은 중량, 시트(길이 있음)는 수량이 필요합니다.</Text>
        {[['thickness', '두께 (mm)'], ['width', '폭 (mm)'], ['length', '길이 (mm, 코일은 비움)'], ['quantity', '수량'], ['weight_kg', '중량 (kg)']].map(([key, label]) => <NumberInput key={key} label={label} hideControls min={0}
          value={editLine.values[key]} onChange={(value) => setEditLine((current) => ({ ...current, values: { ...current.values, [key]: value } }))} />)}
        <Group justify="flex-end"><Button variant="default" onClick={() => setEditLine(null)} disabled={saving}>취소</Button><Button color="red" loading={saving} onClick={() => void saveLineValues()}>저장</Button></Group>
      </Stack>}
    </Modal>
  </Box>;
}
