// 가공 최적화 (메뉴: AI_OPTIMIZATION)
// 주문서 관리에서 보낸 "최적화 대기" 품목 → ① 발주·원자재 확인 → ② 원자재 후보 → ③ 원자재·가공방식 → ④ 추천조합
// → 임시저장 / 계획 확정 (품목 계획확정, 원자재 현재고 예약) / 계획 취소 / 주문서 관리로 돌려보내기.
// 계산은 서버(backend/services/ai/AIOrderOptimization.py)에서 하고 화면은 결과를 보여준다.
import { Fragment, memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ActionIcon, Box, Button, Group, Modal, NumberInput, Pagination, Paper, Popover, SegmentedControl, Select, Stack, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconChevronDown, IconFilter, IconHelpCircle, IconFolderOpen, IconInfoCircle, IconListCheck, IconSearch, IconX } from '@tabler/icons-react';
import useErpPageRibbon from '../../components/common/useErpPageRibbon';
import usePageReactivated from '../../components/common/usePageReactivated';
import sharedClasses from '../../styles/pages/ManagementShared.module.css';
import simpleTheme from '../../styles/pages/SimpleTheme.module.css';
import inboundClasses from '../../styles/pages/InboundRegister.module.css';
// 주문서 관리와 같은 틀(패널·표·배지·버튼)을 그대로 쓴다
import reg from '../../styles/pages/AIOrderRegistry.module.css';
import outboundClasses from '../../styles/pages/OutboundRegister.module.css';
import classes from '../../styles/pages/AIOrderOptimization.module.css';
import confirmBase from '../../styles/components/ConfirmDeleteModal.module.css';
import m from '../../styles/pages/AIOrderManage.module.css';
import { HistoryModal, prefetchHistory } from './AIOrderOptimizationHistory';
import { CalcPopover, coilCalcSections, sheetCalcSections } from './AIOrderCalcExplain';
import OptimizationGuideModal from './AIOrderOptimizationGuide';
import PickerModal, { ColumnResizeHandle, PickerEmpty as SharedPickerEmpty, pickerClasses, useResizableColumns } from '../../components/common/PickerModal';
import { apiErrorMessage } from '../../utils/apiError';

const API = '/api/ai-optimization';
const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });
const errorText = (error, fallback) => apiErrorMessage(error, fallback);
const fmt = (value, digits = 1) => (value === null || value === undefined || value === '' ? '–'
  : Number(value).toLocaleString('ko-KR', { maximumFractionDigits: digits }));
const dateText = (value) => (value ? String(value).slice(0, 10) : '');
const keyOf = (row) => `${row.orderid}|${row.lineno}`;
const PICKER_PAGE_SIZE = 20;
// 품목의 창고 = 재고매칭으로 연결한 재고의 창고 (없으면 아직 정해지지 않음)
const warehouseCodes = (row) => (row?.warehouses || []).map((item) => item.code);
const warehouseNames = (row) => (row?.warehouses || []).map((item) => item.name || item.code).join(', ');
// 함께 계산할 수 있는지: 같은 품명·두께 (시트는 폭까지) + 같은 창고. 안 되면 이유를 돌려준다
// 이미 임시저장 · 확정 계획에 들어 있는 품목 (같은 품목을 두 계획에 담을 수 없음)
const planOf = (row) => (row?.plans || [])[0] || null;
const planLabel = (plan) => `${plan.status === 'CONFIRMED' ? '계획확정' : plan.status === 'DONE' ? '가공완료' : '임시저장'} ${plan.planno}`;
const incompatibleReason = (base, row, baseWarehouses = []) => {
  if (planOf(row)) return `${planLabel(planOf(row))} 계획에 들어 있습니다. [계획 불러오기]에서 열어 주세요`;
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
// 주문서 관리에서 넘어온 주문의 대기 품목을 함께 계산할 수 있는 묶음으로 나눈다
// (같은 소재 · 창고 · 품명 · 두께, 시트는 폭까지 — incompatibleReason 과 같은 기준)
const groupOrderLines = (lines) => {
  const groups = new Map();
  const excluded = [];
  lines.forEach((row) => {
    const codes = warehouseCodes(row);
    if (row.missing?.length) { excluded.push({ row, reason: `값 누락 (${row.missing.join(', ')})` }); return; }
    if (planOf(row)) { excluded.push({ row, reason: `${planLabel(planOf(row))} 계획에 포함` }); return; }
    if (codes.length > 1) { excluded.push({ row, reason: `연결 재고가 여러 창고 (${warehouseNames(row)})` }); return; }
    const key = [row.material, codes[0] || '', String(row.itemname || '').trim().toLowerCase(), Number(row.thickness), row.material === 'SHEET' ? Number(row.width) : ''].join('|');
    if (!groups.has(key)) groups.set(key, { key, material: row.material, warehouse: warehouseNames(row) || '연결 재고 없음', itemname: row.itemname, thickness: row.thickness, width: row.material === 'SHEET' ? row.width : null, rows: [] });
    groups.get(key).rows.push(row);
  });
  return { groups: [...groups.values()], excluded };
};
// ② 매입 후보 추가의 기본규격 (기준정보 연동 전 임시값, 시안 v10)
const STANDARD_COIL_WIDTHS = ['810', '914', '1000', '1219', '1250'];
const STANDARD_SHEET_SIZES = ['1219x2438', '1524x3048', '1000x2000'];
const MATERIAL_TABS = [{ value: 'COIL', label: '코일·스켈프' }, { value: 'SHEET', label: '시트·판재' }];
// 상태 배지 · 버튼 모양은 가공주문관리와 같은 것을 쓴다 (표시만, 동작은 그대로)
const badge = (tone) => `${m.status} ${m[`status_${tone || 'gray'}`] || m.status_gray}`;
const btn = (...kinds) => [m.btn, ...kinds.map((kind) => m[kind])].join(' ');
const STOCK_LOCK_TIP = '현재고 값입니다. 바꾸려면 재고를 수정해 주세요. 가공할 양은 가공방식(일부가공 · 등분)으로 정합니다.';
const MODAL_LOOK = { content: m.mModalContent, header: m.mModalHeader, title: m.mModalTitle, body: m.mModalBody };
// 계산 결과 캐시: 단독 ↔ 혼합처럼 같은 조건을 다시 고르면 서버를 기다리지 않고 바로 보여 준다 (30초 · 저장 · 취소 · 수정 시 비움)
const ANALYZE_TTL = 30 * 1000;
const analyzeCache = new Map();
const PLAN_STATUS = { DRAFT: { label: '임시저장', tone: 'blue' }, CONFIRMED: { label: '계획확정', tone: 'orange' }, CANCELLED: { label: '취소', tone: '' }, DONE: { label: '가공완료', tone: 'green' } };
// newcandidates = ② 직접 입력·매입이력 후보, excluded_raw = ② 목록에서 뺀 후보, extrawidths/extralengths = ④ 가공 후보, history_patterns = ④ 가공이력 반영(여러 개)
const DEFAULT_SETTINGS = { combo: 'SINGLE', processmode: 'ONE', trimloss: 4, orientation: 'NORMAL', newcandidates: [], excluded_raw: [], extrawidths: [], extralengths: [], history_patterns: [] };
// 대기 품목 · 계획 불러오기 창 열 (공용 선택 창 틀 · 열 너비 조절)
const QUEUE_PICKER_COLUMNS = [{ key: 'select', label: '선택', width: 52, align: 'center' }];
const PLAN_PICKER_COLUMNS = [
  { key: 'planno', label: '계획번호', width: 150 },
  { key: 'status', label: '상태', width: 96, align: 'center' },
  { key: 'rawkind', label: '원자재', width: 84 },
  { key: 'spec', label: '품명 / 규격 (mm)', width: 220 },
  { key: 'mode', label: '가공방식', width: 110 },
  { key: 'yield', label: '수율', width: 80, align: 'right' },
  { key: 'lines', label: '주문 품목', width: 260 },
  { key: 'created', label: '등록자', width: 110 },
];
const PICKER_MODAL_CLASSES = { content: classes.pickerContent, header: classes.pickerHeader, title: classes.pickerTitle, body: classes.pickerBody, close: classes.pickerClose };
const FORMULAS = {
  COIL: {
    input: '현재고: 원코일 실제중량 / 신규(가정): 매입이력·직접 입력 중량 / 신규(필요): 발주 폭별 필요중량을 모두 채우는 최소 투입중량',
    production: '투입중량 × (사용폭 ÷ 후보폭)',
    loss: '투입중량 − 생산중량',
    yield: '(생산중량 ÷ 투입중량) × 100',
  },
  SHEET: {   // 시안 시트가공 v5
    input: '원판 1매 단중 × 투입매수 = 투입중량',
    production: 'Σ(절단제품 단중 × 생산수량) = 생산중량',
    loss: '투입중량 − 생산중량 = 로스중량',
    yield: '발주 수량 기준: (발주분 생산중량 ÷ 투입중량) × 100 · 초과 생산분은 제외',
    over: '발주 수량보다 더 생산되는 매수 합계 (없으면 -)',
  },
};

// 표 칸 정의 (너비는 머리 경계를 끌어 조절, 합계보다 화면이 좁으면 좌우 스크롤)
// 최적화 대상 · 불러오기 창 열 순서: 무엇을(품목 규격) → 얼마나(발주 · 선가공 · 필요) → 상태 → 어디서 · 누구(창고 · 발주처 · 납기) → 주문번호
const TARGET_COLUMNS = [   // 너비 = 가장 긴 값(예: 신영정밀금속 · 2026-09-15 · 선가공(kg)) 기준
  { key: 'mark', label: '구분', width: 64, minWidth: 58, align: 'center' },
  { key: 'buyer', label: '발주처', width: 112, minWidth: 70 },
  { key: 'itemname', label: '품명', width: 120, minWidth: 60 },
  { key: 'steelgrade', label: '강종', width: 70, minWidth: 50 },
  { key: 'surface', label: '표면', width: 60, minWidth: 46 },
  { key: 'thickness', label: '두께', width: 58, minWidth: 46, align: 'right' },
  { key: 'width', label: '폭', width: 64, minWidth: 46, align: 'right' },
  { key: 'length', label: '길이', width: 64, minWidth: 46, align: 'right', sheetOnly: true },
  { key: 'order_amount', label: '발주', width: 84, minWidth: 66, align: 'right', unit: true },
  { key: 'ready_amount', label: '선가공', width: 88, minWidth: 70, align: 'right', unit: true },
  { key: 'need_amount', label: '필요', width: 84, minWidth: 66, align: 'right', unit: true },
  { key: 'warehouse', label: '창고', width: 160, minWidth: 90 },
  { key: 'order', label: '주문번호', width: 150, minWidth: 100 },
  { key: 'status', label: '상태', width: 96, minWidth: 64 },   // 점 + 글자 (값 확인은 [입력] 링크). 목록에서 빼기는 맨 끝 × 칸
  { key: 'duedate', label: '납기일', width: 96, minWidth: 80 },
];
const CANDIDATE_COLUMNS = [
  { key: 'rank', label: '우선순위', width: 80, minWidth: 60 },
  { key: 'label', label: '구분', width: 110, minWidth: 70 },
  { key: 'itemname', label: '품명', width: 110, minWidth: 60 },
  { key: 'size', label: '후보규격', width: 150, minWidth: 90 },
  { key: 'warehouse', label: '창고', width: 160, minWidth: 90 },
  { key: 'stock', label: '재고', width: 100, minWidth: 70 },
  { key: 'input', label: '투입중량', width: 110, minWidth: 80, info: 'input' },
  { key: 'production', label: '생산중량', width: 110, minWidth: 80, info: 'production' },
  { key: 'loss', label: '로스중량', width: 110, minWidth: 80, info: 'loss' },
  { key: 'yield', label: '수율', width: 90, minWidth: 70, info: 'yield' },
  { key: 'sheets', label: '필요 원판', width: 110, minWidth: 80, sheetOnly: true },
];
// 시트 ① 후보표: 시안 v5 순서 (재고 다음에 필요 원판 → 투입 · 생산 · 로스 · 수율)
const SHEET_CANDIDATE_COLUMNS = (() => {
  const list = CANDIDATE_COLUMNS.filter((column) => column.key !== 'sheets');
  const at = list.findIndex((column) => column.key === 'input');
  return [...list.slice(0, at), CANDIDATE_COLUMNS.find((column) => column.key === 'sheets'), ...list.slice(at)];
})();
// 초과매수 열: 초과가 생기는 후보가 있을 때만 (필요 원판 다음)
const SHEET_OVER_COLUMN = { key: 'over', label: '초과매수', width: 90, minWidth: 70, info: 'over' };
const withOverColumn = (columns) => {
  const at = columns.findIndex((column) => column.key === 'sheets') + 1;
  return [...columns.slice(0, at), SHEET_OVER_COLUMN, ...columns.slice(at)];
};

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

function PickerTitle({ title, description, material, icon }) {
  return <div className={classes.pickerHeading}>
    <span className={classes.pickerHeadingIcon} aria-hidden="true">{icon}</span>
    <div>
      <div className={classes.pickerHeadingLine}><strong>{title}</strong><span className={classes.pickerMaterial}>{material === 'COIL' ? '코일·스켈프' : '시트·판재'}</span></div>
      <p>{description}</p>
    </div>
  </div>;
}

function PickerEmpty({ title, description }) {
  return <div className={classes.pickerEmpty}>
    <span className={classes.pickerEmptyIcon}><IconSearch size={23} stroke={1.5} aria-hidden="true" /></span>
    <strong>{title}</strong><span>{description}</span>
  </div>;
}

// 카드 머리글의 제목(또는 오른쪽 끝 화살표)을 누르면 본문을 접고 펼친다
function Card({ number, title, actions, children, bodyClass = classes.cardBody }) {
  const [open, setOpen] = useState(true);
  const toggle = () => setOpen((value) => !value);
  return <section className={`${reg.panel} ${classes.card} ${open ? '' : classes.cardClosed}`}>
    <header className={reg.panelHeader}>
      <button type="button" className={classes.cardToggle} onClick={toggle} aria-expanded={open} title={open ? '접기' : '펼치기'}>
        {number && <span className={classes.number}>{number}</span>}<strong>{title}</strong>
      </button>
      {actions && <div className={classes.actions}>{actions}</div>}
      <button type="button" className={classes.cardChevron} onClick={toggle} aria-expanded={open} aria-label={open ? `${title} 접기` : `${title} 펼치기`}>
        <IconChevronDown size={16} stroke={2} aria-hidden="true" />
      </button>
    </header>
    {open && <div className={bodyClass}>{children}</div>}
  </section>;
}

// 코일 슬리팅 배치 (차수별 막대). 차수마다 칼 배치가 다를 수 있다 (단독 + 등분 = 품목별 차수)
const CoilViz = memo(function CoilViz({ plan, rawWidth }) {
  if (!plan) return null;
  const order = plan.pieces.map((piece) => piece.width);
  const toneOf = (width) => {
    const piece = plan.pieces.find((item) => item.width === width);
    return piece?.extra ? classes.pieceExtra : classes[`piece${Math.max(0, order.indexOf(width)) % 4}`];
  };
  const runs = (plan.runs?.length ? plan.runs : [{ weight: plan.input_weight }]).map((run) => {
    const pieces = run.pieces || plan.pieces.filter((piece) => piece.cuts > 0);
    const remain = run.remain_width ?? plan.remain_width;   // 막대의 빗금 = 기본 로스 + 잔여폭
    const trim = plan.trim_width ?? 0;
    return { ...run, pieces, used: run.used_width ?? plan.used_width, remain, trim, spare: run.spare_width ?? Math.max(0, remain - trim) };
  });
  // 도면형: 위 = 원코일 폭 치수선 / 막대 = 칼 배치(칼 사이 절단선) / 아래 = 폭별 구간 치수(폭 × 칼수 = mm) + 로스
  return <>{runs.map((run, index) => {
    const total = (run.used || 0) + (run.remain || 0) || Number(rawWidth) || 1;
    const pct = (mm) => `${(mm / total) * 100}%`;
    return <div key={index} className={classes.cvRun}>
      <div className={classes.cvRunHead}><b>{run.label || (runs.length > 1 ? `${index + 1}차 가공` : '가공')}</b><span>투입 {fmt(run.weight)}kg · {run.pieces.reduce((sum, piece) => sum + piece.cuts, 0)}칼</span></div>
      <div className={classes.cvDimTop}><span>원코일 {fmt(total)}mm</span></div>
      <div className={classes.coilBar} role="img" aria-label={`${run.pieces.map((piece) => `${piece.width}×${piece.cuts}`).join(', ')} 배치`}>
        {run.pieces.flatMap((piece) => Array.from({ length: piece.cuts }, (_, n) => (
          <span key={`${piece.width}-${n}`} className={`${classes.piece} ${toneOf(piece.width)}`} style={{ width: pct(piece.width) }} title={`${fmt(piece.width)}mm`}>{fmt(piece.width)}</span>
        )))}
        {run.remain > 0.001 && <span className={`${classes.piece} ${classes.loss}`} style={{ width: pct(run.remain) }} title={`기본 로스 ${fmt(run.trim)}mm + 잔여폭 ${fmt(run.spare)}mm`} />}
      </div>
      <div className={classes.cvDimGroups}>
        {run.pieces.map((piece) => <div key={piece.width} className={classes.cvDimSeg} style={{ width: pct(piece.width * piece.cuts) }}>
          <span>{fmt(piece.width)} × {piece.cuts} = {fmt(piece.width * piece.cuts)}</span></div>)}
        {run.remain > 0.001 && <div className={`${classes.cvDimSeg} ${classes.cvDimLoss}`} style={{ width: pct(run.remain) }}><span>로스 {fmt(run.remain)}</span></div>}
      </div>
      <div className={classes.subMetric}><span>사용폭 <b>{fmt(run.used)}mm</b></span><span>{run.trim > 0 ? `기본 로스 ${fmt(run.trim)}mm · ` : ''}잔여폭 {fmt(run.spare)}mm</span></div>
    </div>;
  })}</>;
});

// 과부족 표시 (주문 대비): 미생산 / 잔여 생산 / 일치 / ▼부족 / ▲초과
function DeltaText({ piece }) {
  if (piece.state === 'none') return <span className={classes.over}>미생산</span>;
  if (piece.extra) return <span className={classes.muted}>{piece.candidate ? '후보 생산' : '예측생산'}</span>;
  if (piece.remainder) return <span className={classes.muted}>잔여 생산</span>;
  const delta = piece.delta ?? 0;
  if (Math.abs(delta) < 0.05) return <span className={classes.ok}>일치</span>;
  return delta < 0 ? <span className={classes.under}>▼ {fmt(-delta)}kg 부족</span> : <span className={classes.over}>▲ {fmt(delta)}kg 초과</span>;
}

// ④ 추천안 카드 안: 폭별 주문 충족 한 줄씩 + 소코일 중량 경고
// 정수 배부(int_produced)가 있으면 그 값으로 (결과 표 · 재고가공등록과 같은 kg)
function CoilFillLines({ plan }) {
  return <>{plan.pieces.filter((piece) => !piece.extra && piece.state).map((piece) => {
    const hasInt = piece.int_produced !== undefined;
    const produced = hasInt ? fmt(piece.int_produced, 0) : fmt(piece.produced_weight);
    const shown = hasInt && piece.int_delta !== null && piece.int_delta !== undefined ? { ...piece, delta: piece.int_delta } : piece;
    return <span key={piece.width} className={`${classes.fill} ${piece.state === 'none' ? classes.fillBad : ''}`}>
      {fmt(piece.width)}mm {piece.state === 'none' ? `미생산${piece.need_weight !== null && piece.need_weight !== undefined ? ` (주문 ${fmt(piece.need_weight)}kg)` : ''}`
        : piece.remainder ? <>{produced}kg · 잔여 생산</> : <>{produced} / {fmt(piece.need_weight)}kg <DeltaText piece={shown} /></>}
    </span>;
  })}
  {(plan.issues || []).map((issue) => <span key={issue} className={`${classes.fill} ${classes.fillWarn}`}>⚠ {issue}</span>)}</>;
}

// 시트 색상 (시안 v5): 발주 품목은 순서대로 4색, 가공 후보 길이는 별도 3색
const SHEET_COLORS = ['#cfe3f5', '#cfe9dd', '#f7e7bb', '#e6dbf6'];
const SHEET_EXTRA_COLORS = ['#f6d7d2', '#d4e4f7', '#e2ecc9'];
const sheetColor = (key) => (typeof key === 'number' ? SHEET_COLORS[key % SHEET_COLORS.length] : SHEET_EXTRA_COLORS[(Number(String(key).slice(1)) || 0) % SHEET_EXTRA_COLORS.length]);
const sheetPatternOf = (plan, index) => {
  const pats = plan?.sheet_patterns || [];
  return pats.length ? pats[Math.min(Math.max(0, index || 0), pats.length - 1)] : null;
};
const perSheetOf = (sp, key) => (sp ? sp.columns.reduce((sum, col) => sum + col.pieces.filter(([k]) => k === key).length, 0) : 0);
// 과부족 (매): 일치 / ▲ 초과 / ▼ 부족
function SheetDelta({ value }) {
  if (!value) return <span className={classes.ok}>일치</span>;
  return value > 0 ? <span className={classes.over}>▲ {fmt(value, 0)}매 초과</span> : <span className={classes.under}>▼ {fmt(-value, 0)}매 부족</span>;
}

// 시트 2D 절단 배치 (원판 1매 · 패턴별). 원판을 열(제품 폭)로 가르고 열마다 제품 길이로 자른다 (2단 기요틴, 시안 v5 drawPattern)
const SheetViz = memo(function SheetViz({ plan, rawWidth, rawLength, patIdx = 0, onPattern }) {
  const hatchId = `sheetHatch${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  // 그림이 화면에 실제로 그려진 폭 (글자를 화면 기준 같은 크기로 쓰려고)
  const svgRef = useRef(null);
  const [drawnW, setDrawnW] = useState(400);
  useEffect(() => {
    const el = svgRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => { const w = Math.round(entry.contentRect.width); if (w > 0) setDrawnW(w); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const sp = sheetPatternOf(plan, patIdx);
  if (!sp || !rawWidth || !rawLength) return null;
  const pats = plan.sheet_patterns;
  const index = pats.indexOf(sp);
  const normal = plan.orientation !== 'ROTATED';
  const sh = 170;
  const sw = Math.max(320, Math.min(620, sh * rawLength / rawWidth));
  const sx = sw / rawLength;
  const sy = sh / rawWidth;
  const rects = [];
  const fullAlong = normal ? rawLength : rawWidth;
  // 칸 안 글씨 = 제품 폭 × 길이 (계산 결과의 품목 규격). 좁으면 두 줄, 더 좁으면 길이만
  const sizeOf = (key, cw, len) => {
    const piece = (plan.pieces || []).find((item) => item.key === key);
    return piece ? [piece.width, piece.length] : [cw, len];
  };
  // 그림 안 글씨는 화면 기준 12px 로 통일 (그림 배율과 관계없이 같은 크기). 칸이 좁으면 두 줄 → 길이만 → 생략
  const unit = sw / Math.max(160, drawnW);   // 화면 1px = 그림 좌표 unit
  const fs = 11 * unit;
  const textW = (text) => String(text).length * 0.6 * fs + 10 * unit;   // 양옆 5px 여유
  const fits = (w, h, text) => w >= textW(text) && h >= fs * 2;
  const pieceLabel = (x, y, w, h, key, cw, len) => {
    const [pw, pl] = sizeOf(key, cw, len);
    const one = `${fmt(pw)} × ${fmt(pl)}`;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const common = { textAnchor: 'middle', dominantBaseline: 'middle', fill: '#1f3550', fontWeight: 600, fontSize: fs };
    // 한 그림 안에서는 같은 방식으로: 모든 칸에 '폭 × 길이'가 들어가면 그렇게, 아니면 길이만
    if (labelMode === 'full' && fits(w, h, one)) return <text x={cx} y={cy} {...common}>{one}</text>;
    return fits(w, h, fmt(pl)) ? <text x={cx} y={cy} {...common}>{fmt(pl)}</text> : null;
  };
  const labelMode = sp.columns.every((col) => col.pieces.every(([key, len]) => {
    const [pw, pl] = sizeOf(key, col.cw, len);
    return fits((normal ? len : col.cw) * sx, (normal ? col.cw : len) * sy, `${fmt(pw)} × ${fmt(pl)}`);
  })) ? 'full' : 'length';
  const across = sp.columns.reduce((start, col, ci) => {
    const usedAlong = col.pieces.reduce((along, [key, len], pi) => {
      const x = (normal ? along : start) * sx;
      const y = (normal ? start : along) * sy;
      const w = (normal ? len : col.cw) * sx;
      const h = (normal ? col.cw : len) * sy;
      rects.push(<g key={`${ci}-${pi}`}><rect x={x} y={y} width={w} height={h} fill={sheetColor(key)} stroke="#fff" strokeWidth="0.6" />
        {pieceLabel(x, y, w, h, key, col.cw, len)}</g>);
      return along + len;
    }, 0);
    // 열 끝에 남는 길이도 '잔여'로 표시 (기본 방향은 오른쪽 끝, 90도 회전은 아래쪽 끝)
    const restAlong = fullAlong - usedAlong;
    const restW = (normal ? restAlong : col.cw) * sx;
    const restH = (normal ? col.cw : restAlong) * sy;
    if (restAlong > 0.5 && Math.min(restW, restH) >= fs * 1.4) {
      const cx = (normal ? usedAlong + restAlong / 2 : start + col.cw / 2) * sx;
      const cy = (normal ? start + col.cw / 2 : usedAlong + restAlong / 2) * sy;
      const vertical = restW < textW(`잔여 ${fmt(restAlong)}`) && restH > restW;   // 가로로 안 들어가면 세로 글씨
      rects.push(<text key={`rest-${ci}`} x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fontSize={fs} fill="#64748b" fontWeight="700"
        transform={vertical ? `rotate(-90 ${cx} ${cy})` : undefined}>잔여 {fmt(restAlong)}</text>);
    }
    return start + col.cw;
  }, 0);
  const remain = (normal ? rawWidth : rawLength) - across;
  const remainPx = normal ? remain * sy : remain * sx;
  const perTotal = sp.columns.reduce((sum, col) => sum + col.pieces.length, 0);
  // 치수선 구간 (계산 결과 그대로): 열 방향 = 열 폭들 + 잔여, 열 안 방향 = 첫 열의 제품 길이들 + 잔여
  const withRest = (values, full) => {
    const segs = [];
    for (const value of values) {   // 이어지는 같은 길이는 한 구간 (겹치지 않게)
      const last = segs[segs.length - 1];
      if (last && Math.abs(last.each - value) < 1e-6) { last.count += 1; last.value += value; } else segs.push({ value, each: value, count: 1, rest: false });
    }
    const rest = full - values.reduce((sum, value) => sum + value, 0);
    if (rest > 0.5) segs.push({ value: rest, rest: true });
    return segs;
  };
  const colSegs = withRest(sp.columns.map((col) => col.cw), normal ? rawWidth : rawLength);
  const pieceSegs = withRest((sp.columns[0]?.pieces || []).map(([, len]) => len), fullAlong);
  const topSegs = normal ? pieceSegs : colSegs;   // 위쪽 = 원판 길이
  const sideSegs = normal ? colSegs : pieceSegs;  // 왼쪽 = 원판 폭
  const segLabel = (seg) => (seg.rest ? `잔여 ${fmt(seg.value)}` : seg.count > 1 ? `${fmt(seg.each)} × ${seg.count}` : fmt(seg.value));
  // 위쪽 치수 글씨 폭(약 7px/글자)이 구간 폭(그림 폭 약 340px 기준)보다 넓으면 위로 올림
  const topTiny = topSegs.map((seg) => segLabel(seg).length * 7 + 8 > 340 * (seg.value / rawLength));
  const anyTopTiny = topTiny.some(Boolean);
  return <div>
    <div className={classes.sheetMeta}>원판 {fmt(rawWidth)} × {fmt(rawLength)}mm · 열 {sp.columns.length}개 · 사용폭 {fmt(across)}mm · 잔여폭 {fmt(Math.max(0, (plan.sheet_w || 0) - across))}mm</div>
    {pats.length > 1 && onPattern && <div className={classes.patTabs}>{pats.map((item, i) => <button key={i} type="button" className={`${classes.patTab} ${i === index ? classes.patTabOn : ''}`}
      onClick={() => onPattern?.(i)}>패턴 {i + 1}{plan.pattern_lengths?.[i] ? ` · ${fmt(plan.pattern_lengths[i])}` : ''} · {fmt(item.sheets, 0)}매</button>)}</div>}
    <div className={classes.dim}><div className={classes.dimMain}>
      <div className={classes.dimTopLabel}>원판 길이 {fmt(rawLength)}</div>
      <div className={`${classes.dimSegs} ${anyTopTiny ? classes.dimSegsRaised : ''}`} aria-label={`원판 길이 방향 구간 ${topSegs.map(segLabel).join(' / ')}`}>
        {/* 글씨가 구간보다 넓으면(작은 잔여 등) 한 줄 위로 올려 옆 숫자와 겹치지 않게 */}
        {topSegs.map((seg, i) => <div key={i} className={`${classes.dimSeg} ${seg.rest ? classes.dimSegRest : ''} ${topTiny[i] ? classes.dimSegTiny : ''}`} style={{ width: `${(seg.value / rawLength) * 100}%` }}>
          <span>{segLabel(seg)}</span></div>)}
      </div>
      <div className={classes.dimRow}>
        <div className={classes.dimSideWrap}>
          <div className={classes.dimSideLabel}>원판 폭 {fmt(rawWidth)}</div>
          <div className={classes.dimSegsV} aria-label={`원판 폭 방향 구간 ${sideSegs.map(segLabel).join(' / ')}`}>
            {/* 짧은 구간(화면 약 44px 미만)은 가로 글씨 */}
            {sideSegs.map((seg, i) => <div key={i} className={`${classes.dimSegV} ${seg.rest ? classes.dimSegRest : ''} ${(416 * sh / sw) * (seg.value / rawWidth) < 44 ? classes.dimSegVShort : ''}`}
              style={{ height: `${(seg.value / rawWidth) * 100}%` }}>
              <span>{segLabel(seg)}</span></div>)}
          </div>
        </div>
        <svg ref={svgRef} className={classes.sheetSvg} viewBox={`0 0 ${sw} ${sh}`} role="img" aria-label={`원판 ${fmt(rawWidth)} x ${fmt(rawLength)}mm, ${normal ? '기본' : '90도 회전'} 절단배치`}>
          <defs><pattern id={hatchId} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="#e5e9ed" /><rect width="2" height="7" fill="#cfd6dc" /></pattern></defs>
          <rect x="0" y="0" width={sw} height={sh} fill={`url(#${hatchId})`} />{rects}
          {remain > 0.5 && remainPx >= fs * 1.4 && (normal
            ? <text x={sw / 2} y={sh - remainPx / 2} textAnchor="middle" dominantBaseline="middle" fontSize={fs} fill="#64748b" fontWeight="700">잔여 {fmt(remain)}</text>
            : <text x={sw - remainPx / 2} y={sh / 2} textAnchor="middle" dominantBaseline="middle" fontSize={fs} fill="#64748b" fontWeight="700" transform={`rotate(-90 ${sw - remainPx / 2} ${sh / 2})`}>잔여 {fmt(remain)}</text>)}
          <rect x=".5" y=".5" width={sw - 1} height={sh - 1} fill="none" stroke="#c5d1df" />
        </svg>
      </div>
    </div>
    <div className={classes.dimNote}>
      <b>{normal ? '기본 방향' : '90도 회전'}</b>
      <span>제품 폭 → 원판 {normal ? '폭' : '길이'} 방향</span>
      <span>제품 길이 → 원판 {normal ? '길이' : '폭'} 방향</span>
      <small>빗금 = 남는 구간</small>
    </div></div>
    <div className={classes.sheetFoot}>원판 1장당 제품 {perTotal}장 · {pats.length > 1 ? `패턴 ${index + 1}/${pats.length} : 원판 ${fmt(sp.sheets, 0)}매에 적용` : `원판 ${fmt(sp.sheets, 0)}매 모두 동일 패턴`}{labelMode === 'full' ? ' · 칸 안 숫자는 제품 폭 × 길이(mm)' : ` · 칸 안 숫자는 제품 길이(mm) · 제품 폭 ${fmt(sp.columns[0]?.cw)}mm`}{sp.columns.length > 1 && sp.columns.some((col) => col.pieces.map(([, len]) => len).join() !== sp.columns[0].pieces.map(([, len]) => len).join()) ? ` · ${normal ? '위쪽' : '왼쪽'} 치수는 첫 열 기준` : ''}</div>
  </div>;
});

// 시트를 현재고 코일에서 길이로 자르는 경우 (코일 길이 샤링 · 최적화 없음): ③ 카드 / 오른쪽 결과
const meter = (mm) => `${fmt((mm || 0) / 1000)}m`;
function CoilShearCard({ plan, selected }) {
  return <div className={`${classes.plan} ${selected ? classes.planSelected : ''}`} style={{ cursor: 'default' }}>
    <span className={classes.planHead}><span>코일 길이 절단{plan.short_pcs > 0 ? <span className={classes.shortBadge}>{fmt(plan.short_pcs, 0)}매 부족</span> : null}</span>
      <span>수율 <b>{fmt(plan.yield_rate, 2)}%</b></span></span>
    <div className={classes.planPattern}>{plan.pieces.map((piece) => <span key={piece.key} style={{ display: 'block' }}>
      {fmt(piece.width)} × {fmt(piece.length)}{piece.extra ? <span className={classes.tag}>후보</span> : null} : {fmt(piece.produced_qty, 0)}매 = {meter(piece.used_mm)}
      {piece.short_qty > 0 ? <span className={classes.under}>▼ {fmt(piece.short_qty, 0)}매 부족</span> : null}</span>)}</div>
    <span className={classes.planMeta}>{plan.short_pcs > 0 ? `코일을 다 쓰고도 ${plan.short_text} 부족`
      : `남는 코일 ${meter(plan.remain_mm)} · ${fmt(plan.remain_kg, 2)}kg${plan.pieces.some((piece) => piece.extra) ? '' : ' · "가공 후보"로 남는 코일에 쓸 길이를 넣을 수 있습니다'}`}</span>
  </div>;
}
// ③ 코일 길이 샤링: 코일 전체 길이를 가로 바 한 줄로 (발주 순서대로 규격별 사용 구간 · 주문 초과 · 보관 코일)
const COIL_SEG_STYLE = { over: '#f6d7b0', tail: '#e5e9ed' };
function CoilBar({ plan }) {
  const total = Number(plan.total_m) || 0;
  const segs = (plan.segments || []).filter((seg) => seg.m > 0);
  if (!total || !segs.length) return null;
  const hatch = (seg) => seg.kind === 'keep' || seg.kind === 'tail';
  const bg = (seg) => (seg.kind === 'order' || seg.kind === 'extra' ? sheetColor(seg.key) : COIL_SEG_STYLE[seg.kind] || '#fff');
  const segKey = (seg) => (seg.kind === 'order' || seg.kind === 'extra' ? `k${seg.key}` : seg.kind);
  const diffs = (plan.pieces || []).filter((piece) => !piece.extra && (piece.over_qty || piece.short_qty));
  const legend = [...new Map(segs.map((seg) => [segKey(seg), seg])).values()];
  return <div className={classes.coilBarWrap}>
    <div className={classes.coilBar}>{segs.map((seg, i) => <div key={i} className={`${classes.coilSeg} ${hatch(seg) ? classes.coilSegHatch : ''}`}
      style={{ width: `${(seg.m / total) * 100}%`, background: hatch(seg) ? undefined : bg(seg) }} title={`${seg.label} · ${fmt(seg.m)}m`}>
      {(seg.m / total) * 100 >= 7 ? <span>{seg.kind === 'over' ? `+${fmt(seg.m)}m` : `${fmt(seg.m)}m`}</span> : null}</div>)}</div>
    <div className={classes.coilBarScale}><span>0m</span><span>코일 전체 {fmt(plan.total_m)}m ({fmt(plan.coil_weight)}kg)</span></div>
    <div className={classes.coilLegend}>{legend.map((seg) => <span key={segKey(seg)}>
      <i className={hatch(seg) ? classes.coilSegHatch : ''} style={{ background: hatch(seg) ? undefined : bg(seg) }} />{seg.label}</span>)}</div>
    <div className={classes.coilBarSum}>가공 <b>{fmt(plan.process_m)}m ({fmt(plan.input_weight)}kg)</b> · 보관 <b>{fmt(plan.keep_m)}m ({fmt(plan.keep_kg)}kg)</b>
      <span> · 주문 소요 길이 {fmt(plan.need_m)}m ({fmt(plan.need_kg)}kg)</span>
      {diffs.map((piece) => <span key={piece.key} className={piece.short_qty ? classes.under : classes.over}> · {fmt(piece.width)} × {fmt(piece.length)} {piece.short_qty ? `▼ ${fmt(piece.short_qty, 0)}매 부족` : `▲ ${fmt(piece.over_qty, 0)}매 초과`}</span>)}</div>
  </div>;
}
function CoilShearResult({ plan, thickness }) {
  // 제품 이론중량 = 폭 × 길이 × (두께 × 비중 + 도금상수) ÷ 1,000,000 (계획 값 factor · 예전 계획은 두께 × 7.85)
  const factor = Number(plan.factor) || Number(thickness || 0) * 7.85;
  const unit = (piece) => (Number(piece.width) * Number(piece.length) * factor) / 1e6;
  const orders = plan.pieces.filter((piece) => !piece.extra);
  const extras = plan.pieces.filter((piece) => piece.extra);
  const produced = plan.pieces.reduce((sum, piece) => sum + (piece.produced_qty || 0), 0);
  const orderQty = orders.reduce((sum, piece) => sum + (piece.need_qty || 0), 0);
  const orderKg = orders.reduce((sum, piece) => sum + unit(piece) * (piece.need_qty || 0), 0);
  return <div className={classes.result}>
    <div className={classes.flow}>
      <span><small>코일 재고</small><b>{fmt(plan.coil_weight, 2)}kg</b></span>
      <span><small>가공 · {meter(plan.used_mm)}</small><b>{fmt(plan.input_weight, 2)}kg</b></span>
      <span><small>보관 코일 · {meter(plan.remain_mm)}</small><b>{fmt(plan.remain_kg, 2)}kg</b></span>
      {plan.short_pcs > 0 && <span><small>부족 · {fmt(plan.short_pcs, 0)}매</small><b>{fmt(plan.short_kg, 2)}kg</b></span>}
      {plan.int_production != null ? <><span><small>생산</small><b>{fmt(plan.int_production, 3)}kg</b></span><span><small>로스</small><b>{fmt(plan.int_loss, 3)}kg</b></span></>
        : plan.loss_weight > 0.5 && <span><small>로스</small><b>{fmt(plan.loss_weight, 2)}kg</b></span>}
    </div>
    <div className={classes.resultTitle}>품목별 절단 <small>규격은 폭 × 길이(mm) · 이론중량 = 폭 × 길이 × (두께 × 비중 + 도금상수) ÷ 1,000,000</small></div>
    <div className={classes.resultScroll}><table className={classes.resultTable}>
      <thead><tr><th>제품 규격 (폭 × 길이)</th><th>절단 길이</th><th>발주</th><th>발주 이론중량</th><th>생산</th><th>생산중량</th><th>과부족</th></tr></thead>
      <tbody>
        {orders.map((piece) => <tr key={`o-${piece.key}`}><td>{fmt(piece.width)} × {fmt(piece.length)}</td><td>{meter(piece.used_mm)}</td><td>{fmt(piece.need_qty, 0)}매</td>
          <td>{fmt(unit(piece) * piece.need_qty)}kg</td><td>{fmt(piece.produced_qty, 0)}매</td><td>{piece.int_produced != null ? `${fmt(piece.int_produced, 3)}kg` : `${fmt(unit(piece) * piece.produced_qty)}kg`}</td><td><SheetDelta value={piece.over_qty} /></td></tr>)}
        {extras.map((piece) => <tr key={`x-${piece.key}`}><td>{fmt(piece.width)} × {fmt(piece.length)}<span className={classes.tag}>후보</span></td><td>{meter(piece.used_mm)}</td><td>잔량 활용</td>
          <td>–</td><td>{fmt(piece.produced_qty, 0)}매</td><td>{fmt(unit(piece) * piece.produced_qty)}kg</td><td><span className={classes.muted}>후보 생산</span></td></tr>)}
      </tbody>
      <tfoot><tr><td>합계</td><td>{meter(plan.used_mm)}</td><td>{fmt(orderQty, 0)}매</td><td>{fmt(orderKg)}kg</td><td>{fmt(produced, 0)}매</td><td>{plan.int_production != null ? `${fmt(plan.int_production, 3)}kg` : `${fmt(plan.production_weight)}kg`}</td><td /></tr></tfoot>
    </table></div>
    <p className={classes.estimate}>※ 코일 단중(kg/m) = 코일 폭 × (두께 × 비중 + 도금상수) ÷ 1,000 = {fmt(plan.unit_kg_m, 4)}kg/m · 가공 길이 = 가공중량 ÷ 단중. 폭 방향 줄 수 = ⌊(코일 폭 − 폭 여유 {fmt(plan.side_trim ?? 0)}) ÷ 제품 폭⌋, 1장 절단 길이 = 제품 길이 + 길이 여유 {fmt(plan.len_allow ?? 0)}mm. 발주 순서대로 채우고 남는 길이는 마지막 규격에 더합니다(▲ 초과).</p>
  </div>;
}

// ③ 추천안 카드 안 (시트): 품목별 과부족 · 가공 후보 생산
function SheetFillLines({ plan }) {
  const orders = (plan.pieces || []).filter((piece) => !piece.extra);
  const diffs = orders.filter((piece) => piece.over_qty);
  const extras = (plan.pieces || []).filter((piece) => piece.extra && piece.produced_qty > 0);
  const single = plan.combo !== 'MIXED';
  return <>
    {diffs.length ? diffs.map((piece) => <span key={piece.key} className={classes.fill}>{single ? `${fmt(piece.width)} × ${fmt(piece.length)} ` : `${fmt(piece.length)}mm `}<SheetDelta value={piece.over_qty} /></span>)
      : <span className={classes.fill}><span className={classes.ok} style={{ marginLeft: 0 }}>전 품목 발주수량과 일치</span></span>}
    {extras.length > 0 && <span className={classes.fill}>가공 후보 {extras.map((piece) => `${fmt(piece.length)}mm ${fmt(piece.produced_qty, 0)}매`).join(' / ')} <span className={classes.muted}>후보 생산</span></span>}
  </>;
}

// ④ 오른쪽 결과: 투입 = 생산 + 로스 띠 + 폭(길이)별 생산 표. 예전에 저장된 계획(과부족 값 없음)도 그대로 보인다.
const PlanResult = memo(function PlanResult({ plan, material, notes, patIdx = 0 }) {
  if (!plan) return null;
  if (material === 'COIL') {
    const knives = plan.knives ?? plan.pieces.reduce((sum, piece) => sum + (piece.knives ?? piece.cuts), 0);
    // 등분(차수 2개 이상)이면 차수별 열을 보여 주고, 오른쪽 '합계' 열이 차수 합계
    const runs = (plan.runs || []).filter((run) => (run.weight || 0) > 0);
    const multi = runs.length > 1;
    const runLabel = (run, index) => `${index + 1}차`;
    // 숫자는 재고가공등록과 같은 kg 정수 배부 (서버 alloc: 차수 → 폭 → 칼, 같은 폭의 남는 kg 는 첫 줄).
    // 예전에 저장된 계획(alloc 없음)은 폭 비율 이론값으로 보여 준다.
    const hasInt = runs.length > 0 && runs.every((run) => run.alloc);
    const rawWidthOf = (run) => (run.used_width || 0) + (run.remain_width || 0);
    const groupOf = (run, width) => run.alloc?.widths.find((item) => item.width === width) || null;
    const runWidthWeight = (run, width) => {
      if (hasInt) return groupOf(run, width)?.weight ?? null;
      const piece = run.pieces?.find((item) => item.width === width);
      return piece && rawWidthOf(run) > 0 ? (run.weight * width * piece.cuts) / rawWidthOf(run) : null;
    };
    const runProduced = (run) => (hasInt ? run.alloc.produced : (run.pieces || []).reduce((sum, item) => sum + (runWidthWeight(run, item.width) || 0), 0));
    const runLoss = (run) => (hasInt ? run.alloc.loss : run.weight - runProduced(run));
    const production = hasInt ? plan.int_production : plan.production_weight;
    const lossTotal = hasInt ? plan.int_loss : plan.loss_weight;
    const digits = hasInt ? 0 : 2;
    // 칼당: 같은 폭은 첫 줄만 남는 kg 를 더 받는다 → 나머지 줄 값을 보여 주고 첫 줄은 툴팁
    const perCut = (piece) => {
      if (!hasInt) return { text: `${fmt(piece.per_cut ?? piece.produced_weight / (piece.knives ?? piece.cuts))}kg`, title: '' };
      const groups = runs.map((run) => groupOf(run, piece.width)).filter(Boolean);
      if (!groups.length) return { text: '–', title: '' };
      const each = groups.map((group) => group.lines[group.lines.length - 1]);
      return { text: `${each.map((value) => fmt(value, 0)).join(' / ')}kg`,
        title: groups.map((group, index) => `${multi ? `${index + 1}차 ` : ''}첫 줄 ${fmt(group.lines[0], 0)}kg · 나머지 ${fmt(group.lines[group.lines.length - 1], 0)}kg`).join('\n') };
    };
    return <div className={classes.result}>
      <CalcPopover sections={coilCalcSections(plan)} title="코일 슬리팅 계산 과정" subtitle={`${plan.pattern || ''}${plan.used_width ? ` · 원코일 ${fmt((plan.used_width || 0) + (plan.remain_width || 0))}mm` : ''}`}><div className={classes.flow}><span><small>투입</small><b>{fmt(plan.input_weight)}kg</b></span><span><small>생산</small><b>{fmt(production, digits ? 1 : 0)}kg</b></span>
        <span><small>로스</small><b>{fmt(lossTotal, digits ? 1 : 0)}kg</b></span><span><small>수율</small><b>{fmt(plan.yield_rate, 2)}%</b></span></div></CalcPopover>
      <div className={classes.resultTitle}>폭별 생산중량{multi ? <small>{runs.map(runLabel).join(' + ')} 합계 · 재고가공등록과 같은 kg 배부</small> : <small>재고가공등록과 같은 kg 배부</small>}</div>
      <div className={classes.resultScroll}><table className={`${classes.resultTable} ${multi ? classes.resultTableRuns : ''}`}>
        <thead><tr><th>제품폭</th><th>주문</th><th>칼수</th><th>칼당</th>
          {multi && runs.map((run, index) => <th key={index} title={`${runLabel(run, index)} 투입 ${fmt(run.weight)}kg`}>{runLabel(run, index)}</th>)}
          <th>{multi ? '합계' : '생산중량'}</th><th title="차수 로스를 폭별 생산 비율로 나눈 값 (재고가공등록 로스 배부와 같음)">로스</th><th>과부족</th></tr></thead>
        <tbody>{plan.pieces.map((piece, pieceIndex) => {
          const count = piece.knives ?? piece.cuts;
          const produced = hasInt ? piece.int_produced : piece.produced_weight;
          const loss = hasInt ? piece.int_loss
            : (plan.production_weight > 0 ? (plan.loss_weight || 0) * (piece.produced_weight || 0) / plan.production_weight : 0);
          const cut = count ? perCut(piece) : { text: '–', title: '' };
          const deltaPiece = hasInt && piece.int_delta !== null && piece.int_delta !== undefined ? { ...piece, delta: piece.int_delta } : piece;
          return <tr key={`${piece.width}-${pieceIndex}`}>
            <td>{fmt(piece.width)}mm{piece.extra && piece.candidate ? <span className={classes.tag}>후보</span> : null}</td>
            <td>{piece.extra ? (piece.candidate ? '가공 후보' : '발주 외') : piece.remainder ? '잔여' : `${fmt(piece.need_weight)}kg`}</td>
            <td>{count ? `${count}칼` : '–'}</td><td title={cut.title || undefined}>{cut.text}</td>
            {multi && runs.map((run, index) => { const value = runWidthWeight(run, piece.width); return <td key={index} className={classes.runCell}>{value ? `${fmt(value, digits)}kg` : '–'}</td>; })}
            <td>{fmt(produced, digits ? 1 : 0)}kg</td><td className={classes.lossCell}>{fmt(loss, digits ? 1 : 0)}kg</td><td>{piece.state ? <DeltaText piece={deltaPiece} /> : null}</td>
          </tr>;
        })}</tbody>
        {multi
          // 등분: 소계를 투입 → 생산 → 로스 순으로 (투입 = 생산 + 로스), 오른쪽 '합계' 열이 차수 합계
          ? <tfoot>
            <tr className={classes.runSubRow}><td>투입</td><td /><td /><td />
              {runs.map((run, index) => <td key={index}>{fmt(run.weight, digits)}kg</td>)}
              <td>{fmt(plan.input_weight)}kg</td><td /><td /></tr>
            <tr className={classes.runSubRow}><td>생산</td><td /><td>{knives}칼</td><td />
              {runs.map((run, index) => <td key={index}>{fmt(runProduced(run), digits)}kg</td>)}
              <td>{fmt(production, digits ? 1 : 0)}kg</td><td /><td /></tr>
            <tr className={classes.runSubRow}><td>로스</td><td /><td /><td />
              {runs.map((run, index) => <td key={index} className={classes.lossCell}>{fmt(runLoss(run), digits)}kg</td>)}
              <td className={classes.lossCell}>{fmt(lossTotal, digits ? 1 : 0)}kg</td><td /><td /></tr>
          </tfoot>
          : <tfoot><tr><td>합계</td><td /><td>{knives}칼</td><td />
            <td>{fmt(production, digits ? 1 : 0)}kg</td><td className={classes.lossCell}>{fmt(lossTotal, digits ? 1 : 0)}kg</td><td /></tr></tfoot>}
      </table></div>
      {(plan.issues || []).map((issue) => <div key={issue} className={classes.warn}>⚠ 소코일 중량 확인: {issue}</div>)}
      <p className={classes.estimate}>※ 차수 투입을 폭 비율로 kg 단위로 나눈 이론값입니다 (같은 폭에서 남는 kg 는 첫 줄). 생산 + 로스 = 투입이며, 실중량은 매출에서 조정합니다.</p>
    </div>;
  }
  if (plan.coil) return <CoilShearResult plan={plan} thickness={plan.thickness} />;
  // 시트 (시안 v5): 투입 → 생산 → 로스 → 수율 띠 + 한 줄 요약 + 품목별 생산 표 (원판 1장당은 선택한 패턴 기준)
  const sp = sheetPatternOf(plan, patIdx);
  const patCount = plan.sheet_patterns?.length || 0;
  // 단독 여러 품목: 품목마다 자기 패턴 기준 (서버 per_sheet) / 혼합: 선택한 패턴 기준
  const perSheet = (piece) => (plan.single_multi ? piece.per_sheet || 0 : sp ? perSheetOf(sp, piece.key) : piece.per_sheet || 0);
  const intKg = plan.int_production !== undefined && plan.int_production !== null;   // 현재고 원판: 재고가공등록과 같은 kg 정수
  const orderPieces = plan.pieces.filter((piece) => !piece.extra);
  const extraPieces = plan.pieces.filter((piece) => piece.extra);
  const producedTotal = plan.pieces.reduce((sum, piece) => sum + (piece.produced_qty || 0), 0);
  const needTotal = orderPieces.reduce((sum, piece) => sum + (piece.need_qty || 0), 0);
  const orderProduced = orderPieces.reduce((sum, piece) => sum + (piece.produced_qty || 0), 0);
  const deltaTotal = orderProduced - needTotal;
  const perTotal = sp ? sp.columns.reduce((sum, col) => sum + col.pieces.length, 0) : plan.pieces.reduce((sum, piece) => sum + (piece.per_sheet || 0), 0);
  const single = plan.combo !== 'MIXED' && orderPieces.length === 1;
  const one = single ? orderPieces[0] : null;
  const notesList = [plan.lb_text, plan.excess_weight > 0.005 ? `초과생산 ${fmt(plan.excess_weight, 2)}kg (로스에 포함하지 않음)` : '',
    plan.side_trim !== undefined ? `폭 여유 ${fmt(plan.side_trim)}mm 반영` : ''].filter(Boolean);
  const dot = (key) => <i className={classes.dot} style={{ background: sheetColor(key) }} />;
  return <div className={classes.result}>
    <CalcPopover sections={sheetCalcSections(plan)} title="시트 절단 계산 과정" subtitle={`${plan.combo === 'MIXED' ? '혼합절단' : '단독절단'} · ${plan.olabel || ''} · 원판 ${fmt(plan.sheet_w)} × ${fmt(plan.sheet_l)}mm`}><div className={classes.flow}><span><small>투입 · 원판 {fmt(plan.sheets, 0)}매</small><b>{intKg ? fmt(plan.int_input, 3) : fmt(plan.input_weight, 2)}kg</b></span><span><small>생산 · {fmt(producedTotal, 0)}매</small><b>{intKg ? fmt(plan.int_production, 3) : fmt(plan.production_weight, 2)}kg</b></span>
      <span><small>로스</small><b>{intKg ? fmt(plan.int_loss, 3) : fmt(plan.loss_weight, 2)}kg</b></span><span><small>수율</small><b>{fmt(intKg && plan.int_input > 0 ? (plan.int_production / plan.int_input) * 100 : plan.yield_rate, 2)}%</b></span></div></CalcPopover>
    {one ? <div className={classes.sumLine}><b>{fmt(one.width)} × {fmt(one.length)}</b> : 원판 1장당 <b>{perSheet(one)}장</b> × 원판 <b>{fmt(plan.sheets, 0)}장</b> = {fmt(one.produced_qty, 0)}장 생산 <span>(발주 {fmt(one.need_qty, 0)}장{one.produced_qty > one.need_qty ? ` · 초과 ${fmt(one.produced_qty - one.need_qty, 0)}장` : ''})</span></div>
      : plan.single_multi ? <div className={classes.sumLine}>품목별로 따로 계산 · 원판 <b>{fmt(plan.sheets, 0)}장</b> 투입 → 제품 <b>{fmt(producedTotal, 0)}장</b> 생산 <span>(품목별 필요 원판의 합)</span></div>
      : <div className={classes.sumLine}>원판 <b>{fmt(plan.sheets, 0)}장</b> 투입 → 제품 <b>{fmt(producedTotal, 0)}장</b> 생산 <span>(원판 1장당 {perTotal}장 · 투입 원판은 품목이 공용으로 사용)</span></div>}
    <div className={classes.resultTitle}>품목별 생산 <small>규격은 폭 × 길이(mm)</small></div>
    <div className={classes.resultScroll}><table className={classes.resultTable}>
      <thead><tr><th>제품 규격 (폭 × 길이)</th><th>원판 1장당{patCount > 1 && !plan.single_multi ? <small> (패턴 {(plan.sheet_patterns.indexOf(sp)) + 1})</small> : null}</th><th>투입 원판</th><th>발주</th><th>생산</th>{intKg && <><th>생산중량</th><th>로스</th></>}<th>과부족</th></tr></thead>
      <tbody>
        {orderPieces.map((piece) => <tr key={`o-${piece.key ?? piece.length}`}>
          <td>{dot(piece.key)}{fmt(piece.width)} × {fmt(piece.length)}</td><td><b>{perSheet(piece)}장</b></td><td><b>{fmt(piece.sheets_used ?? plan.sheets, 0)}장</b></td>
          <td>{fmt(piece.need_qty, 0)}매</td><td>{fmt(piece.produced_qty, 0)}매</td>{intKg && <><td>{fmt(piece.int_produced, 3)}kg</td><td className={classes.lossCell}>{fmt(piece.int_loss, 3)}kg</td></>}<td><SheetDelta value={piece.over_qty} /></td>
        </tr>)}
        {extraPieces.map((piece) => <tr key={`x-${piece.key ?? piece.length}`}>
          <td>{dot(piece.key)}{fmt(piece.width)} × {fmt(piece.length)}<span className={classes.tag}>후보</span></td><td><b>{perSheet(piece)}장</b></td><td>{fmt(piece.sheets_used ?? 0, 0)}장</td>
          <td>가공 후보</td><td>{fmt(piece.produced_qty, 0)}매</td>{intKg && <><td>{fmt(piece.int_produced, 3)}kg</td><td className={classes.lossCell}>{fmt(piece.int_loss, 3)}kg</td></>}<td><span className={classes.muted}>후보 생산</span></td>
        </tr>)}
      </tbody>
      <tfoot><tr><td>합계</td><td>{plan.single_multi ? '' : `${perTotal}장`}</td><td>{fmt(plan.sheets, 0)}장</td><td>{fmt(needTotal, 0)}매</td><td>{fmt(orderProduced, 0)}매</td>{intKg && <><td>{fmt(plan.int_production, 3)}kg</td><td className={classes.lossCell}>{fmt(plan.int_loss, 3)}kg</td></>}
        <td>{deltaTotal > 0 ? <span className={classes.over}>▲ {fmt(deltaTotal, 0)}매</span> : deltaTotal < 0 ? <span className={classes.under}>▼ {fmt(-deltaTotal, 0)}매</span> : null}</td></tr></tfoot>
    </table></div>
    {plan.single_multi && plan.mixed_sheets != null && <div className={classes.mixCompare}>{plan.mixed_sheets < plan.sheets
      ? `혼합절단으로 하면 원판 ${fmt(plan.mixed_sheets, 0)}매로 가능합니다 (${fmt(plan.sheets - plan.mixed_sheets, 0)}매 절감)`
      : `혼합절단도 원판 ${fmt(plan.mixed_sheets, 0)}매로 같습니다`}</div>}
    {(notes || []).map((note) => <div key={note} className={classes.warn}>{note}</div>)}
    {notesList.length > 0 && <p className={classes.estimate}>{notesList.map((note) => <span key={note} style={{ display: 'block' }}>{note}</span>)}</p>}
    <p className={classes.estimate}>※ 폭 × 길이 × (두께 × 비중 {fmt(plan.sg ?? 7.85, 3)} + 도금상수 {fmt(plan.coat ?? 0, 3)}) ÷ 1,000,000으로 계산한 이론 중량입니다.
      {Number(plan.len_allow) > 0 ? ` 제품 1장당 길이 여유 ${fmt(plan.len_allow)}mm를 더해 열 안의 장수를 계산했습니다.` : ' 길이 여유는 0으로 계산합니다.'}</p>
  </div>;
});

export default function AIOrderOptimization() {
  // 주문서 관리 [가공 최적화] 버튼으로 열면 그 주문의 대기 품목을 미리 선택한다 (한 번만)
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const pendingOrderRef = useRef(searchParams.get('orderid') || '');
  const [guideOpen, setGuideOpen] = useState(false);
  const [groupOff, setGroupOff] = useState([]);   // ① 가공그룹에서 체크를 푼 품목 (계산에서만 제외)
  const [orderGroups, setOrderGroups] = useState(null); // 창고 등이 달라 묶음이 여러 개일 때 고르는 창
  function startGroup(group) {
    setMaterial(group.material);
    setActivePlan(null);
    setPlanId(null);
    setSelectedKeys(group.rows.map(keyOf));
    setGroupOff([]);
    setSettings({ ...DEFAULT_SETTINGS, combo: group.rows.length > 1 ? 'MIXED' : 'SINGLE' });
    setOrderGroups(null);
  }
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
  const [planPickerFilter, setPlanPickerFilter] = useState({ query: '', status: 'ALL' });
  const [queue, setQueue] = useState([]);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [analysis, setAnalysis] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const recommendRef = useRef(null);
  const [lockHeight, setLockHeight] = useState(0);
  useEffect(() => { if (!analyzing && lockHeight) { const id = requestAnimationFrame(() => setLockHeight(0)); return () => cancelAnimationFrame(id); } return undefined; }, [analyzing, lockHeight]);
  const [planId, setPlanId] = useState(null);   // null = 추천안 (코일은 A안, 시트는 로스가 적은 방향 안)
  const [activePlan, setActivePlan] = useState(null); // { planno, status, detail }
  const [saving, setSaving] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);
  const [editLine, setEditLine] = useState(null);
  const [newWidth, setNewWidth] = useState('');
  const [newLength, setNewLength] = useState('');
  const [newWeight, setNewWeight] = useState('');
  const [historyKind, setHistoryKind] = useState(null); // 'purchase' | 'processing' | null
  const requestRef = useRef(0);
  const delayRef = useRef(0); // 다음 계산까지 기다릴 시간 (숫자 입력 중에만 잠깐 기다림)
  const targetWidths = useColumnWidths();
  const queuePickerColumnsDef = useMemo(() => [...QUEUE_PICKER_COLUMNS, ...TARGET_COLUMNS.filter((column) => column.key !== 'mark' && (!column.sheetOnly || material === 'SHEET'))], [material]);
  const queuePickerColumns = useResizableColumns(queuePickerColumnsDef);
  const planPickerColumns = useResizableColumns(PLAN_PICKER_COLUMNS);
  const [planPicked, setPlanPicked] = useState('');
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
        // 계획(임시저장 · 확정)에 들어간 품목은 그 계획을 바로 연다. 계획 밖 대기 품목만 있으면 묶음으로 담는다.
        // 둘이 섞였거나 묶음이 여러 개일 때만 고르는 창을 띄운다.
        const orderRows = items.filter((row) => row.orderid === orderid);
        const plannos = [...new Set(orderRows.flatMap((row) => (row.plans || []).map((plan) => plan.planno)))];
        const lines = orderRows.filter((row) => row.optimize_status === 'WAITING' && !planOf(row));
        const grouped = lines.length ? groupOrderLines(lines) : null;
        if (!lines.length && plannos.length === 1) void openPlan(plannos[0]);
        else if (lines.length && !plannos.length && grouped.groups.length === 1 && !grouped.excluded.length) startGroup(grouped.groups[0]);
        else if (lines.length || plannos.length) {
          // 계획(임시저장 · 계획확정)에 들어간 품목은 계획별 카드로 (상태 표시 · [열기])
          const planCards = new Map();
          orderRows.filter((row) => planOf(row)).forEach((row) => {
            const plan = planOf(row);
            if (!planCards.has(plan.planno)) planCards.set(plan.planno, { planno: plan.planno, status: plan.status, rows: [] });
            planCards.get(plan.planno).rows.push(row);
          });
          setOrderGroups({ orderid, groups: grouped?.groups || [], plans: [...planCards.values()], excluded: grouped?.excluded || [] });
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
  const filteredPlans = useMemo(() => {
    const query = planPickerFilter.query.trim().toLowerCase();
    return materialPlans.filter((plan) => (planPickerFilter.status === 'ALL' || plan.status === planPickerFilter.status)
      && (!query || [plan.planno, plan.itemname, plan.lines, plan.created_by].some((value) => String(value || '').toLowerCase().includes(query))));
  }, [materialPlans, planPickerFilter]);
  const selectedRows = useMemo(() => selectedKeys.map((key) => queue.find((row) => keyOf(row) === key)).filter(Boolean), [selectedKeys, queue]);
  const editingDraft = activePlan?.status === 'DRAFT';
  // ④ 가공이력 (여러 개). 예전 임시저장 형식(history_pattern 1개)도 읽는다
  const historyPatterns = Array.isArray(settings.history_patterns) ? settings.history_patterns : (settings.history_pattern ? [settings.history_pattern] : []);
  const viewingConfirmed = activePlan?.status === 'CONFIRMED' || activePlan?.status === 'DONE';
  const groupKeys = useMemo(() => selectedKeys.filter((key) => !groupOff.includes(key)), [selectedKeys, groupOff]);
  const groupRows = useMemo(() => selectedRows.filter((row) => groupKeys.includes(keyOf(row))), [selectedRows, groupKeys]);
  const analyzeKeys = useMemo(() => (viewingConfirmed ? [] : groupKeys), [viewingConfirmed, groupKeys]);

  // 선택·설정이 바뀌면 서버에서 다시 계산 (잠깐 기다렸다가)
  const runAnalyze = useCallback(async (keys, nextSettings, planno) => {
    const id = ++requestRef.current;
    const cacheKey = JSON.stringify([toKeys(keys), nextSettings, planno || '']);
    const hit = analyzeCache.get(cacheKey);
    if (hit && Date.now() - hit.at < ANALYZE_TTL) { setAnalysis(hit.data); setAnalyzing(false); return; }
    setAnalyzing(true);
    try {
      const { data } = await axios.post(`${API}/analyze`, { keys: toKeys(keys), settings: nextSettings, planno: planno || '' }, authConfig());
      analyzeCache.set(cacheKey, { at: Date.now(), data });
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
  // 탭(코일 ↔ 시트)을 바꾼 직후 새 계산이 오기 전에는 이전 탭 결과를 그리지 않는다 (시트 안을 코일 표로 그리던 문제)
  const shownAnalysis = analyzeKeys.length && (!analysis?.material || analysis.material === material) ? analysis : null;
  // 시트 혼합절단: 같은 품명 · 두께 · 폭의 다른 길이 발주가 2개 미만이면 탭은 열되 안 대신 안내만 보여 준다
  const sheetMixBlocked = material === 'SHEET' && settings.combo === 'MIXED' && !(shownAnalysis?.raw?.coil) && groupRows.length < 2;
  const plansList = sheetMixBlocked ? [] : shownAnalysis?.plans || [];
  const chosenPlan = plansList.find((plan) => plan.id === planId) || plansList.find((plan) => plan.recommended) || plansList[0] || null;
  const raw = shownAnalysis?.raw || null;
  const unit = material === 'COIL' ? 'kg' : '매';
  // 시트 배치 패턴 탭: 고른 안이 바뀌면 패턴 1로
  const [patPick, setPatPick] = useState({ key: '', index: 0 });
  const patKey = chosenPlan ? `${chosenPlan.id}|${chosenPlan.sheets}|${chosenPlan.pattern_count}|${chosenPlan.combo}` : '';
  const patIdx = patPick.key === patKey ? patPick.index : 0;
  const pickPattern = (index) => setPatPick({ key: patKey, index });
  // 시트: 안을 고르면 ② 절단방향도 그 안의 방향으로 (가공이력 안은 지금 절단방향 기준으로 계산됨)
  const choosePlan = (plan) => {
    setPlanId(plan.id);
    if (material === 'SHEET' && plan.orientation && plan.orientation !== (settings.orientation || 'NORMAL')) updateSettings({ orientation: plan.orientation });
  };

  const resetWork = () => { setSelectedKeys([]); setGroupOff([]); setSettings(DEFAULT_SETTINGS); setActivePlan(null); setPlanId(null); };
  const changeMaterial = (value) => { setMaterial(value); resetWork(); };
  const updateSettings = (patch, delay = 0) => { delayRef.current = delay; setSettings((current) => ({ ...current, ...patch })); };
  const typeSettings = (patch) => updateSettings(patch, 400); // 숫자 입력: 입력이 멈추면 계산
  // 시트 탭에서 코일 후보를 고르면 ③ 기본 탭 = 혼합절단 (코일 길이 절단은 담은 품목을 묶어 한 번에 자른다)
  // ① 같은 규격 합친 줄: 펼치면 창고별 재고 · 줄을 누르면 그 창고로 계획 (계획은 창고 1곳 · 그 창고 로트를 입고 순으로)
  const [openGroups, setOpenGroups] = useState({});
  const candidateSubRows = (c) => (c.warehouses?.length > 1 && openGroups[c.id] ? c.warehouses.map((w) => {
    const on = (settings.raw_id ?? raw?.id) === c.id && w.chosen;
    return <tr key={`${c.id}-${w.code}`} className={`${classes.candSubRow} ${on ? classes.candSubOn : ''}`}
      onClick={() => updateSettings({ raw_id: c.id, raw_wh: w.code, raw_width: undefined, raw_length: undefined })}>
      <td colSpan={candidateColumns.length}><span className={classes.candSubLabel}>└ {w.name}</span>
        <span>재고 <b>{fmt(w.qty, 0)}매</b> · 로트 {w.lot_count}개</span>
        {w.chosen ? <span className={classes.candSubPick}>계획 창고</span> : <span className={classes.candSubHint}>이 창고로 계획</span>}</td>
    </tr>;
  }) : null);
  const chooseRaw = (id) => {
    const coil = material === 'SHEET' && (shownAnalysis?.candidates || []).some((c) => c.id === id && c.coil);
    updateSettings({ raw_id: id, raw_width: undefined, raw_weight: undefined, raw_length: undefined, splitweights: undefined, partialweight: undefined,
      ...(coil ? { combo: 'MIXED' } : {}) });
  };
  // 계산이 코일 후보를 자동으로 고른 경우도 같은 규칙 (그 코일에서 한 번만 · 이후 사용자가 단독절단을 누르면 그대로 둔다)
  const coilTabRef = useRef('');
  const autoCoilId = material === 'SHEET' && raw?.coil ? raw.id : '';
  useEffect(() => {
    if (!autoCoilId || coilTabRef.current === autoCoilId) return;
    coilTabRef.current = autoCoilId;
    if (settings.combo !== 'MIXED') updateSettings({ combo: 'MIXED' });
  }, [autoCoilId]); // eslint-disable-line react-hooks/exhaustive-deps

  const removeRow = (key) => {
    if (activePlan) return;
    const next = selectedKeys.filter((item) => item !== key);
    setSelectedKeys(next);
    if (next.length <= 1) updateSettings({ combo: 'SINGLE' });
  };

  // 대기 품목 불러오기: 이미 담은 품목 + 창에서 고른 품목의 첫 품목이 기준
  const openPicker = () => {
    if (activePlan) {
      notifications.show({ title: `${activePlan.planno} 계획을 닫았습니다`, message: '새 작업으로 품목을 불러옵니다. 닫은 계획은 [계획 불러오기]에서 다시 열 수 있습니다.', color: 'blue' });
      resetWork();
    }
    setPickerKeys([]); setPickerPage(1); setPickerOpen(true);
  };
  const pickerBase = selectedRows[0] || queue.find((row) => keyOf(row) === pickerKeys[0]) || null;
  const pickerWarehouses = [...new Set([...selectedRows, ...pickerKeys.map((key) => queue.find((row) => keyOf(row) === key))].filter(Boolean).flatMap(warehouseCodes))];
  const pickerRows = useMemo(() => {
    const buyer = pickerFilter.buyer.trim().toLowerCase();
    const item = pickerFilter.itemname.trim().toLowerCase();
    const thickness = pickerFilter.thickness.trim();
    return materialQueue.filter((row) => !selectedKeys.includes(keyOf(row))
      && (!buyer || String(row.buyer || '').toLowerCase().includes(buyer))
      && (!item || String(row.itemname || '').toLowerCase().includes(item))
      && (!thickness || Number(row.thickness) === Number(thickness)))
      .sort((a, b) => Number(Boolean(planOf(a))) - Number(Boolean(planOf(b)))); // 계획에 들어 있는 품목은 아래로
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
      if (data.header.materialtype) setMaterial(data.header.materialtype);
      setActivePlan({ planno, status: data.header.status, detail: data });
      setSelectedKeys((pattern.keys || []).map(([orderid, lineno]) => `${orderid}|${lineno}`));
      setGroupOff([]);
      setSettings({ ...DEFAULT_SETTINGS, ...(pattern.settings || {}), excluded_raw: [] });
      setPlanId(pattern.plan?.id || null);
    } catch (error) {
      notifications.show({ title: '계획 조회 실패', message: errorText(error, '계획을 불러오지 못했습니다.'), color: 'red' });
    }
  };

  const savePlan = async (status) => {
    if (!groupKeys.length || !chosenPlan || saving) return;
    setSaving(true);
    try {
      analyzeCache.clear();
      const { data } = await axios.post(`${API}/plans`, {
        keys: toKeys(groupKeys), settings, planno: editingDraft ? activePlan.planno : '', status, plan_id: chosenPlan.id,
      }, authConfig());
      notifications.show({ title: status === 'CONFIRMED' ? '계획 확정 완료' : '임시저장 완료', message: `${data.planno} · ${status === 'CONFIRMED' ? '품목은 계획확정, 원자재는 이 계획에 잡혔습니다.' : '임시저장했습니다.'}`, color: 'teal' });
      if (status !== 'CONFIRMED') setActivePlan({ planno: data.planno, status: 'DRAFT' });
      await loadData();
      if (status === 'CONFIRMED') await openPlan(data.planno);   // 확정 직후 확정 계획을 그대로 보여 준다
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
      analyzeCache.clear();
      await axios.post(`${API}/plans/${encodeURIComponent(activePlan.planno)}/cancel`, {}, authConfig());
      notifications.show({ title: activePlan.status === 'DRAFT' ? '임시저장 삭제' : '계획 취소', message: `${activePlan.planno} · 같은 품목과 조건으로 바로 다시 계획할 수 있습니다.`, color: 'teal' });
      // 처음부터 다시 담지 않게: 품목 · 조건은 그대로 두고 계획 연결만 끊는다 (새 작업으로 계속)
      setActivePlan(null);
      await loadData();
    } catch (error) {
      notifications.show({ title: '취소할 수 없습니다', message: errorText(error, '계획을 취소하지 못했습니다.'), color: 'orange' });
      void openPlan(activePlan.planno);   // 다른 화면(재고가공등록)에서 상태가 바뀌었을 수 있다 → 최신 상태로 다시 보여 준다
      void loadData();
    } finally {
      setSaving(false);
      setConfirmAction(null);
    }
  };

  const returnToOrders = async () => {
    if (!groupKeys.length || saving) return;
    setSaving(true);
    try {
      analyzeCache.clear();
      const { data } = await axios.post(`${API}/return`, { keys: toKeys(groupKeys) }, authConfig());
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
      analyzeCache.clear();
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

  const canSave = Boolean(groupKeys.length && chosenPlan && !viewingConfirmed && !analyzing);
  const actionsRef = useRef({});
  useEffect(() => { actionsRef.current = { loadData, savePlan }; });
  useErpPageRibbon({
    showPrint: false,
    useSaveColor: false,
    onSearch: () => actionsRef.current.loadData(),
    onSave: canSave ? () => actionsRef.current.savePlan('DRAFT') : undefined,
  });

  const runSearch = () => setFilters({ ...filterInputs });
  // ② 신규 원자재 후보 추가 (직접 입력 · 과거 매입이력). 같은 규격이 있으면 새 값으로 바꾸고 바로 선택한다.
  const addRawCandidate = (candidate) => {
    const id = material === 'COIL' ? `NEW|${candidate.width}` : `NEW|${candidate.width}x${candidate.length}`;
    const sameSize = (item) => Number(item.width) === Number(candidate.width) && (material === 'COIL' || Number(item.length) === Number(candidate.length));
    updateSettings({ newcandidates: [candidate, ...(settings.newcandidates || []).filter((item) => !sameSize(item))], raw_id: id,
      raw_width: undefined, raw_weight: undefined, raw_length: undefined, splitweights: undefined, partialweight: undefined });
  };
  // ② 매입 후보 추가 (기본규격 선택 → 폭 · 길이 칸을 채움, 또는 직접 입력)
  // 코일 신규 후보 최소 폭 = 담은 품목 중 가장 넓은 제품 폭 + 기본 로스 (서버도 이보다 좁은 신규 후보는 계산에서 뺀다)
  const coilMinWidth = () => Math.max(0, ...groupRows.map((row) => Number(row.width) || 0)) + (Number(settings.trimloss) || 0);
  const narrowCoilText = (width) => {
    const maxWidth = Math.max(0, ...groupRows.map((row) => Number(row.width) || 0));
    return `원자재 폭 ${fmt(width)}mm는 가장 넓은 제품 폭 ${fmt(maxWidth)}mm + 기본 로스 ${fmt(Number(settings.trimloss) || 0)}mm = ${fmt(coilMinWidth())}mm 이상이어야 후보로 추가할 수 있습니다.`;
  };
  const addNewCandidate = () => {
    const width = Number(newWidth);
    if (!(width > 0)) { notifications.show({ title: '후보 추가', message: '원자재 폭을 입력하거나 기본규격을 골라 주세요.', color: 'orange' }); return; }
    if (material === 'COIL' && width < coilMinWidth() - 1e-6) { notifications.show({ title: '후보로 추가할 수 없습니다', message: narrowCoilText(width), color: 'orange' }); return; }
    if (material === 'COIL') addRawCandidate({ width, weight: Number(newWeight) > 0 ? Number(newWeight) : null, source: '직접 입력' });
    else {
      const length = Number(newLength);
      if (!(length > 0)) { notifications.show({ title: '후보 추가', message: '원판 길이를 입력해 주세요.', color: 'orange' }); return; }
      addRawCandidate({ width, length, source: '직접 입력' });
    }
    setNewWidth(''); setNewLength(''); setNewWeight('');
  };
  // ④ 가공 후보 (발주 외 폭 · 길이) → 혼합으로 다시 계산
  const addProcessCandidate = (value) => {
    if (material === 'COIL') updateSettings({ extrawidths: [...new Set([...(settings.extrawidths || []), value])], combo: 'MIXED' });
    else updateSettings({ extralengths: [...new Set([...(settings.extralengths || []), value])], combo: 'MIXED' });
    setPlanId(null);
  };
  // 이력 창에서 여러 건 선택 → 한 번에 반영
  // ① 표의 × : 직접 입력 · 매입이력 · 가공이력으로 넣은 신규 후보를 뺀다 (고른 후보였으면 추천 순위 1위로)
  const removeRawCandidate = (candidate) => {
    const same = (item) => Number(item.width) === Number(candidate.width) && (material === 'COIL' || Number(item.length) === Number(candidate.length));
    const wasChosen = (settings.raw_id ?? raw?.id) === candidate.id;
    updateSettings({ newcandidates: (settings.newcandidates || []).filter((item) => !same(item)),
      ...(wasChosen ? { raw_id: undefined, raw_width: undefined, raw_weight: undefined, raw_length: undefined, splitweights: undefined, partialweight: undefined } : {}) });
  };
  // mode 'raw' = 이력의 원자재 규격을 ① 원자재 후보로 (매입이력은 항상 이 방식, 가공이력은 [원자재 후보로 추가])
  const applyHistory = (rows, mode) => {
    const list = Array.isArray(rows) ? rows : [rows];
    if (!list.length) return;
    if (historyKind === 'purchase' || mode === 'raw') {
      // 각 규격을 ① 후보로 추가하고 첫 번째를 선택. 가공이력은 그때 쓴 원자재(원코일 1개 중량 · 원판 규격)
      const fromProcess = historyKind !== 'purchase';
      const added = list.map((row) => {
        const width = fromProcess ? row.raw_width : row.width;
        const source = fromProcess ? `가공이력 ${row.no}` : `매입이력 ${row.id}`;
        if (material === 'COIL') {
          const weight = fromProcess ? (row.raw_weight && row.raw_qty ? row.raw_weight / row.raw_qty : row.raw_weight) : row.weight;
          return { width, weight: weight || null, source };
        }
        return { width, length: fromProcess ? row.raw_length : row.length, source };
      }).filter((item) => Number(item.width) > 0 && (material === 'COIL' || Number(item.length) > 0));
      // 코일: 제품 폭 + 기본 로스보다 좁은 원자재는 빼고 알린다
      const narrow = material === 'COIL' ? added.filter((item) => Number(item.width) < coilMinWidth() - 1e-6) : [];
      if (narrow.length) notifications.show({ title: `${narrow.length}건은 후보로 추가하지 않았습니다`, color: 'orange',
        message: narrow.length === 1 ? narrowCoilText(narrow[0].width) : `${narrow.map((item) => `${fmt(item.width)}mm`).join(', ')} · ${narrowCoilText(narrow[0].width).replace(/^원자재 폭 [^ ]+는 /, '원자재 폭은 ')}` });
      added.splice(0, added.length, ...added.filter((item) => !narrow.includes(item)));
      if (!added.length) return;
      const sameSize = (a, b) => Number(a.width) === Number(b.width) && (material === 'COIL' || Number(a.length) === Number(b.length));
      const unique = added.filter((item, index) => added.findIndex((other) => sameSize(item, other)) === index);
      const first = unique[0];
      updateSettings({ newcandidates: [...unique, ...(settings.newcandidates || []).filter((item) => !unique.some((u) => sameSize(u, item)))],
        raw_id: material === 'COIL' ? `NEW|${first.width}` : `NEW|${first.width}x${first.length}`,
        raw_width: undefined, raw_weight: undefined, raw_length: undefined, splitweights: undefined, partialweight: undefined });
      return;
    }
    // 과거 가공이력: 칼 배치(코일) / 절단 패턴(시트)을 ④ 후보 안으로 넣는다. 서버가 현재 원자재로 다시 검증한다.
    const added = list.map((row) => ({ pattern: row.pattern, source: row.no, actual_loss: row.actual_loss ?? null }));
    const merged = [...historyPatterns.filter((item) => !added.some((a) => a.source === item.source)), ...added];
    const mixed = list.some((row) => (material === 'COIL' ? row.mode === 'MIXED' : new Set((row.pattern || []).map((item) => item[1])).size > 1));
    updateSettings({ history_patterns: merged, history_pattern: undefined, ...(mixed ? { combo: 'MIXED' } : {}) });
    setPlanId(null);
  };
  const removeRef = (kind, value) => {
    if (kind === 'width') updateSettings({ extrawidths: (settings.extrawidths || []).filter((item) => item !== value) });
    else if (kind === 'length') updateSettings({ extralengths: (settings.extralengths || []).filter((item) => item !== value) });
    else updateSettings({ history_patterns: historyPatterns.filter((item) => item.source !== value), history_pattern: undefined });
    setPlanId(null);
  };

  // ---------------- 화면 조각 ----------------
  const targetColumns = TARGET_COLUMNS.filter((column) => !column.sheetOnly || material === 'SHEET');
  const targetTableWidth = targetColumns.reduce((sum, column) => sum + targetWidths.widthOf(column), 0);
  const targetTableStyle = { width: `max(100%, ${targetTableWidth}px)`, minWidth: `${targetTableWidth}px` };
  // 최적화 대상 표: 맨 앞에 가공그룹 '계산' 체크 열을 따로 둔다 (불러오기 창은 그대로)
  const mainTargetColumns = [{ key: 'group', label: '계산', width: 46, minWidth: 40, align: 'center' },
    ...targetColumns.map((column) => (column.key === 'status' ? { ...column, align: 'center' } : column)),
    ...(activePlan ? [] : [{ key: 'remove', label: '', width: 44, minWidth: 44, align: 'center' }])];
  const targetHead = (first) => <ResizableHead columns={targetColumns} {...targetWidths}
    labelOf={(column) => (column.key === 'mark' ? first : column.unit ? `${column.label}(${unit})` : column.label)} />;
  const showOver = material === 'SHEET' && (shownAnalysis?.candidates || []).some((c) => (c.over_pcs || 0) > 0);
  const candidateColumns = material === 'SHEET' ? (showOver ? withOverColumn(SHEET_CANDIDATE_COLUMNS) : SHEET_CANDIDATE_COLUMNS) : CANDIDATE_COLUMNS.filter((column) => !column.sheetOnly);
  const candidateTableWidth = candidateColumns.reduce((sum, column) => sum + candidateWidths.widthOf(column), 0);
  // status = 상태 칸 (화면마다 다름). 주문번호는 맨 끝
  const lineCells = (row, status) => <>
    <td title={row.buyer || ''}>{row.buyer}</td>
    <td title={row.itemname || ''}><b>{row.itemname}</b></td><td>{row.steelgrade}</td><td>{row.surface}</td>
    <td className={classes.num}>{fmt(row.thickness, 3)}</td><td className={classes.num}>{fmt(row.width, 3)}</td>{material === 'SHEET' && <td className={classes.num}>{fmt(row.length, 3)}</td>}
    <td className={classes.num} title={row.remainder ? `원문 '${row.remainder_text}' · 목표 중량 없이 남는 만큼 생산` : row.converted?.join(' · ') || ''}>{row.remainder ? '나머지' : <>{fmt(row.order_amount)}{row.converted?.length ? '*' : ''}</>}</td>
    <td className={classes.num}>{fmt(row.ready_amount)}</td><td className={classes.num}><b>{row.remainder ? '잔여' : fmt(row.need_amount)}</b></td>
    <td title={warehouseNames(row) || '연결 재고 없음'}>{warehouseNames(row) || '–'}</td>
    <td title={`${row.orderid}-${row.lineno}`}>{row.orderid}-{row.lineno}</td>
    {status}
    <td>{dateText(row.duedate)}</td>
  </>;

  // 대기 품목 · 계획 불러오기 창: 수금/지급등록 '보유증권 불러오기'와 같은 공용 선택 창 틀 (검색 · 안내 · 목록 · 하단 선택)
  const materialBadge = material === 'COIL' ? '코일·스켈프' : '시트·판재';
  const pickerModal = <PickerModal look="saas" opened={pickerOpen} onClose={() => setPickerOpen(false)}
    title="대기 품목" badge={materialBadge} description="주문서 관리에서 보낸 대기 품목을 선택해 최적화 대상에 담습니다." icon={<IconListCheck size={22} stroke={1.7} />}
    filters={<>
      <TextInput size="sm" label="발주처" placeholder="발주처명 검색" leftSection={<IconSearch size={14} />} value={pickerFilter.buyer} onChange={(event) => { const { value } = event.currentTarget; setPickerFilter((current) => ({ ...current, buyer: value })); setPickerPage(1); }} />
      <TextInput size="sm" label="품명" placeholder="품명 검색" value={pickerFilter.itemname} onChange={(event) => { const { value } = event.currentTarget; setPickerFilter((current) => ({ ...current, itemname: value })); setPickerPage(1); }} />
      <TextInput size="sm" label="두께 (mm)" placeholder="예: 1.2" style={{ width: 120 }} value={pickerFilter.thickness} onChange={(event) => { const { value } = event.currentTarget; setPickerFilter((current) => ({ ...current, thickness: value })); setPickerPage(1); }} />
    </>}
    guide={<>
      <p>같은 창고 · 품명 · 두께{material === 'SHEET' ? ' · 폭' : ''} 품목끼리 함께 담아 계산합니다. 처음 고른 품목과 맞지 않는 품목은 흐리게 표시됩니다.</p>
      {/* 선택 전에도 같은 줄을 그려 두어 첫 선택 때 안내 상자 높이가 바뀌지 않게 한다 */}
      <div className={pickerClasses.criteria}>
        <span className={pickerBase ? undefined : pickerClasses.criteriaEmpty}><b>담는 품목</b>{pickerBase ? `${pickerBase.itemname} ${fmt(pickerBase.thickness, 3)}T${material === 'SHEET' ? ` × ${fmt(pickerBase.width)}mm` : ''}` : '품목을 고르면 표시됩니다'}</span>
        <span className={pickerBase ? undefined : pickerClasses.criteriaEmpty}><b>창고</b>{pickerBase ? (pickerWarehouses.length ? queue.flatMap((row) => row.warehouses || []).find((item) => item.code === pickerWarehouses[0])?.name || pickerWarehouses[0] : '미지정') : '-'}</span>
      </div>
    </>}
    listTitle="대기 품목" count={pickerRows.length} loading={loading}
    selectedCount={pickerKeys.length} onClearSelection={() => setPickerKeys([])}
    pagination={<Pagination size="sm" color="red" total={Math.max(1, Math.ceil(pickerRows.length / PICKER_PAGE_SIZE))} value={pickerPage} onChange={setPickerPage} siblings={1} />}
    onApply={applyPicker} applyLabel="담기">
    <table className={pickerClasses.table} style={{ width: `max(100%, ${queuePickerColumns.tableWidth}px)` }} aria-label="최적화 대기 품목">
      <colgroup>{queuePickerColumnsDef.map((column) => <col key={column.key} data-column-key={column.key} style={{ width: queuePickerColumns.widthOf(column) }} />)}</colgroup>
      <thead><tr>{queuePickerColumnsDef.map((column, index) => <th key={column.key} className={`${index ? pickerClasses.resizableHead : ''} ${column.align ? pickerClasses[column.align] : ''}`}>
        {column.key === 'mark' ? '구분' : column.unit ? `${column.label}(${unit})` : column.label}{index > 0 && <ColumnResizeHandle column={column} columns={queuePickerColumns} />}</th>)}</tr></thead>
      <tbody>{pickerPageRows.map((row) => {
        const key = keyOf(row);
        const picked = pickerKeys.includes(key);
        const reason = picked ? '' : incompatibleReason(pickerBase, row, pickerWarehouses);
        return <tr key={key} className={picked ? pickerClasses.selectedRow : reason ? pickerClasses.disabledRow : ''} title={reason || undefined} onClick={() => togglePick(row)}>
          <td className={pickerClasses.center}><input className={pickerClasses.checkbox} type="checkbox" checked={picked} disabled={Boolean(reason)} onClick={(event) => event.stopPropagation()} onChange={() => togglePick(row)} aria-label={`${row.orderid}-${row.lineno} 선택`} /></td>
          {lineCells(row, <td>{reason
            ? (planOf(row) ? <span className={`${classes.state} ${classes[`statePlan_${planOf(row).status}`] || classes.stateOff}`} title={reason}>{PLAN_STATUS[planOf(row).status]?.label || '계획'}</span>
              : <span className={`${classes.state} ${classes.stateOff}`} title={reason}>추가 불가</span>)
            : row.missing?.length ? <span className={`${classes.state} ${classes.stateWarn}`} title={`빠진 값: ${row.missing.join(', ')}`}>값 확인</span>
              : picked ? <span className={`${classes.state} ${classes.statePicked}`}>추가</span> : <span className={`${classes.state} ${classes.stateWait}`}>대기</span>}</td>)}
        </tr>;
      })}
      {!pickerPageRows.length && <tr><td colSpan={queuePickerColumnsDef.length} className={pickerClasses.emptyCell}>
        <SharedPickerEmpty title={loading ? '대기 품목을 불러오는 중입니다' : '담을 대기 품목이 없습니다'} description={materialQueue.length ? '검색 조건을 바꾸거나 이미 담은 품목을 확인해 주세요.' : '주문서 관리에서 품목을 가공 최적화로 보내 주세요.'} />
      </td></tr>}
      </tbody>
    </table>
  </PickerModal>;

  // 계획 불러오기 창: 한 줄 고르고 [불러오기] (행을 두 번 누르면 바로 불러오기)
  const pickedPlan = filteredPlans.find((plan) => plan.planno === planPicked) || null;
  const planPickerModal = <PickerModal look="saas" opened={planPickerOpen} onClose={() => setPlanPickerOpen(false)}
    title="계획 불러오기" badge={materialBadge} description="임시저장한 계획을 이어서 작업하거나 확정 · 가공완료 계획을 확인합니다." icon={<IconFolderOpen size={22} stroke={1.7} />}
    filters={<>
      <TextInput size="sm" label="계획 검색" placeholder="계획번호 · 품명 · 주문 품목 · 등록자" leftSection={<IconSearch size={14} />} style={{ width: 320 }} value={planPickerFilter.query} onChange={(event) => { const { value } = event.currentTarget; setPlanPickerFilter((current) => ({ ...current, query: value })); }} />
      <Select size="sm" label="계획 상태" value={planPickerFilter.status} allowDeselect={false} style={{ width: 140 }} onChange={(value) => setPlanPickerFilter((current) => ({ ...current, status: value }))}
        data={[{ value: 'ALL', label: '전체 상태' }, { value: 'DRAFT', label: '임시저장' }, { value: 'CONFIRMED', label: '계획확정' }, { value: 'DONE', label: '가공완료' }]} />
      <Button size="sm" variant="default" onClick={() => setPlanPickerFilter({ query: '', status: 'ALL' })}>초기화</Button>
    </>}
    guide={<p>임시저장 계획은 조건을 수정할 수 있습니다. 확정 · 가공완료 계획은 저장된 가공 결과를 조회합니다. 행을 두 번 누르면 바로 불러옵니다.</p>}
    listTitle="저장된 계획" count={filteredPlans.length} loading={loading} listHint="행을 눌러 계획을 고르세요"
    selectedCount={pickedPlan ? 1 : 0} onClearSelection={() => setPlanPicked('')}
    onApply={() => { if (pickedPlan) { setPlanPicked(''); void openPlan(pickedPlan.planno); } }} applyLabel="불러오기" applyDisabled={!pickedPlan}>
    <table className={pickerClasses.table} style={{ width: `max(100%, ${planPickerColumns.tableWidth}px)` }} aria-label="저장된 가공 계획">
      <colgroup><col style={{ width: 52 }} />{PLAN_PICKER_COLUMNS.map((column) => <col key={column.key} data-column-key={column.key} style={{ width: planPickerColumns.widthOf(column) }} />)}</colgroup>
      <thead><tr><th className={pickerClasses.center}>선택</th>{PLAN_PICKER_COLUMNS.map((column) => <th key={column.key} className={`${pickerClasses.resizableHead} ${column.align ? pickerClasses[column.align] : ''}`}>
        {column.label}<ColumnResizeHandle column={column} columns={planPickerColumns} /></th>)}</tr></thead>
      <tbody>{filteredPlans.map((plan) => {
        const picked = planPicked === plan.planno;
        return <tr key={plan.planno} className={picked || (!planPicked && activePlan?.planno === plan.planno) ? pickerClasses.selectedRow : ''}
          onClick={() => setPlanPicked(plan.planno)} onDoubleClick={() => { setPlanPicked(''); void openPlan(plan.planno); }}>
          <td className={pickerClasses.center}><input className={pickerClasses.checkbox} type="radio" name="opt-plan-pick" checked={picked} onClick={(event) => event.stopPropagation()} onChange={() => setPlanPicked(plan.planno)} aria-label={`${plan.planno} 선택`} /></td>
          <td><b>{plan.planno}</b></td>
          <td className={pickerClasses.center}><span className={badge(PLAN_STATUS[plan.status]?.tone)}>{PLAN_STATUS[plan.status]?.label || plan.status}</span></td>
          <td>{plan.rawkind === 'STOCK' ? '현재고' : '신규 매입'}</td>
          <td title={plan.itemname || ''}>{plan.itemname} {fmt(plan.thickness, 3)} × {fmt(plan.width)}{plan.length ? ` × ${fmt(plan.length)}` : ' × C'}</td>
          <td>{plan.processmode === 'SPLIT' ? '등분' : plan.processmode === 'PARTIAL' ? '일부가공' : plan.materialtype === 'COIL' ? '원샷' : '절단'} · {plan.combo === 'MIXED' ? '혼합' : '단독'}</td>
          <td className={pickerClasses.right}><b>{fmt(plan.yieldrate, 2)}%</b></td>
          <td title={plan.lines || ''}>{plan.lines || '–'}</td>
          <td title={plan.created_by || ''}>{plan.created_by || '–'}</td>
        </tr>;
      })}
      {!filteredPlans.length && <tr><td colSpan={PLAN_PICKER_COLUMNS.length + 1} className={pickerClasses.emptyCell}>
        <SharedPickerEmpty title={loading ? '계획을 불러오는 중입니다' : materialPlans.length ? '검색 조건에 맞는 계획이 없습니다' : '저장된 계획이 없습니다'} description={materialPlans.length ? '검색어 또는 계획 상태를 바꿔 주세요.' : '가공 조합을 선택해 임시저장하거나 계획을 확정해 주세요.'} />
      </td></tr>}
      </tbody>
    </table>
  </PickerModal>;

  const summary = shownAnalysis?.summary;
  const confirmedDetail = viewingConfirmed ? activePlan.detail : null;
  // 확정된 현재고 계획(코일 · 시트) → 재고가공등록에서 전표 1장으로 불러와 등록
  const canGoProcess = activePlan?.status === 'CONFIRMED' && confirmedDetail?.header.rawkind === 'STOCK' && ['COIL', 'SHEET'].includes(confirmedDetail?.header.materialtype);
  // 이력 창 · 가공 후보 창이 적합 여부를 판단하는 현재 값 (③ 입력값 우선)
  const baseRow = groupRows[0] || null;
  // 품목을 담으면 과거 매입 · 가공 · 매출이력을 미리 불러 둔다 → 이력 창을 열면 바로 목록이 나온다
  const prefetchName = baseRow?.itemname || '';
  const prefetchThickness = baseRow?.thickness ?? '';
  useEffect(() => { prefetchHistory(material, prefetchName, prefetchThickness); }, [material, prefetchName, prefetchThickness]);
  // 현재고(연결 포함) 원자재는 폭 · 중량(원판은 폭 · 길이)이 실물 값이라 수정 불가. 가공할 양은 가공방식(일부가공 · 등분)으로 정한다
  const rawLocked = raw?.kind === 'STOCK';
  const historyContext = useMemo(() => ({
    itemname: baseRow?.itemname || '', thickness: baseRow?.thickness, itemWidth: baseRow?.width,
    rawWidth: Number(rawLocked ? raw?.raw_width : settings.raw_width ?? raw?.raw_width) || 0, rawLength: Number(rawLocked ? raw?.raw_length : settings.raw_length ?? raw?.raw_length) || 0,
    trim: Number(settings.trimloss) || 0, orientation: settings.orientation,
    lengths: [...groupRows.map((row) => row.length), ...(settings.extralengths || [])],
    orderValues: groupRows.map((row) => (material === 'COIL' ? row.width : row.length)),
    extraValues: material === 'COIL' ? settings.extrawidths || [] : settings.extralengths || [],
    // ① 에 이미 연결 원자재로 잡힌 현재고 (전표-순번) → 매입이력 창에서 비활성
    linkedKeys: (shownAnalysis?.candidates || []).filter((c) => c.linked).map((c) => `${c.sourceno}-${c.sourceline}`),
    // ① 에 현재고로 이미 추천된 원자재 (과거 매입이력에서 '이미 추천됨'). 같은 규격 여러 창고 · 로트로 묶인 줄은 로트 전부
    stockKeys: (shownAnalysis?.candidates || []).filter((c) => c.kind === 'STOCK').flatMap((c) => [`${c.sourceno}-${c.sourceline}`, ...(c.lots || []).map((lot) => `${lot.sourceno}-${lot.sourceline}`)]),
  }), [baseRow, groupRows, settings, raw, material, rawLocked, shownAnalysis]);
  const refs = [
    ...(material === 'COIL' ? (settings.extrawidths || []).map((value) => ({ kind: 'width', value, label: `가공 후보 ${fmt(value)}mm` }))
      : (settings.extralengths || []).map((value) => ({ kind: 'length', value, label: `가공 후보 길이 ${fmt(value)}mm` }))),
    ...historyPatterns.map((item) => ({ kind: 'history', value: item.source, label: `가공이력 ${item.source || ''}` })),
  ];
  const historyButtons = (kind) => <button type="button" className={btn('btnBlue', 'btnSm')}
    disabled={!baseRow} onClick={() => setHistoryKind(kind)}>{kind === 'purchase' ? '과거 매입이력' : '과거 가공이력'}</button>;

  // ── 화면 (이전 배치 + 시안 v10 로직: 가공그룹 · 발주품목 선택 · 기본규격 · 가공방식별 입력줄) ──
  const amountText = (row) => (row.remainder ? '나머지' : `${fmt(row.order_amount)}${unit}`);
  const toggleGroup = (key) => {
    setGroupOff((current) => {
      if (current.includes(key)) return current.filter((item) => item !== key);
      if (selectedKeys.filter((item) => !current.includes(item)).length <= 1) return current; // 최소 1개는 계산
      return [...current, key];
    });
    setPlanId(null);
  };
  const processWeight = Number(rawLocked ? raw?.raw_weight : settings.raw_weight ?? raw?.raw_weight) || 0;
  const targetTable = <div className={`${reg.tableScroll} ${classes.tableScroll}`}>
    <table className={`${reg.ordersTable} ${classes.table}`} style={{ width: `max(100%, ${targetTableWidth + 46 + (activePlan ? 0 : 44)}px)`, minWidth: `${targetTableWidth + 46 + (activePlan ? 0 : 44)}px` }}>
      <ResizableHead columns={mainTargetColumns} {...targetWidths}
        labelOf={(column) => (column.key === 'mark' ? '순번' : column.unit ? `${column.label}(${unit})` : column.label)} />
      <tbody>{selectedRows.length ? selectedRows.map((row, index) => {
        const key = keyOf(row);
        const inGroup = !groupOff.includes(key);
        return <tr key={key} className={inGroup ? '' : classes.groupOffRow}>
          <td className={classes.center}><input type="checkbox" className={classes.pickerCheckbox} checked={inGroup} disabled={Boolean(activePlan)} onChange={() => toggleGroup(key)}
            aria-label={`${row.orderid}-${row.lineno} 가공그룹 포함`} title="체크를 풀면 계산 · 저장에서 빠집니다 (작업 목록에는 남음)" /></td>
          <td className={classes.center}>{index + 1}</td>
          {lineCells(row, <td className={classes.center}>{row.missing?.length
            ? <><span className={`${classes.state} ${classes.stateWarn}`} title={`빠진 값: ${row.missing.join(', ')}`}>값 확인</span>
              <button type="button" className={classes.stateFix} onClick={() => setEditLine({ row, values: { thickness: row.thickness ?? '', width: row.width ?? '', length: row.length ?? '', quantity: row.quantity ?? '', weight_kg: row.weight ?? '' } })}>입력</button></>
            : row.optimize_status === 'PLANNED' ? <span className={`${classes.state} ${classes.stateConfirmed}`}>계획확정</span>
              : row.optimize_status === 'DONE' ? <span className={`${classes.state} ${classes.stateDone}`}>가공완료</span>
              : inGroup ? <span className={`${classes.state} ${classes.stateWait}`}>대기</span>
                : <span className={`${classes.state} ${classes.stateOff}`} title="계산 체크를 풀어 이번 계산에서 빠진 품목">계산 제외</span>}</td>)}
          {!activePlan && <td className={classes.removeCell}><button type="button" className={classes.rowRemove} onClick={() => removeRow(key)}
            aria-label={`${row.orderid}-${row.lineno} 작업 목록에서 제외`} title="작업 목록에서 제외 (대기 품목으로 돌아갑니다)"><IconX size={14} stroke={2} /></button></td>}
        </tr>;
      }) : <tr><td colSpan={mainTargetColumns.length} className={classes.empty}>{loading ? '대기 품목을 불러오는 중입니다.'
        : materialQueue.length ? '[대기 품목]에서 최적화할 품목을 담아 주세요.' : '최적화 대기 품목이 없습니다. 주문서 관리에서 [가공 최적화로 보내기]를 해 주세요.'}</td></tr>}</tbody>
    </table>
  </div>;

  return <Box className={`${simpleTheme.simple} ${sharedClasses.pageShell} ${reg.page} ${classes.optScope}`}>
    <Box component="nav" aria-label="현재 위치" className={inboundClasses.pageBreadcrumb}>
      <Group className={inboundClasses.breadcrumbTrail} gap={7}>
        <Text component="span" className={inboundClasses.breadcrumbParent}>가공관리</Text>
        <Text component="span" className={inboundClasses.breadcrumbChevron}>›</Text>
        <Text component="span" className={inboundClasses.breadcrumbCurrent}>가공최적화</Text>
        {/* 화면 안내: 메뉴 이름 바로 옆 */}
        <button type="button" className={`${m.guideLink} ${m.guideLinkCrumb} ${classes.guideLinkOpt}`} onClick={() => setGuideOpen(true)}><IconHelpCircle size={14} stroke={2} />사용 안내</button>
      </Group>
      {!filterOpen && <Button className={inboundClasses.receiptFilterToggle} variant="subtle" size="xs"
        leftSection={<IconFilter size={15} />} onClick={() => setFilterOpen(true)}>조회조건</Button>}
    </Box>
    <Box className={`${inboundClasses.inboundWorkspace} ${reg.orderWorkspace}`}>
      <Box className={`${inboundClasses.inboundPrimaryColumn} ${reg.orderPrimaryColumn} ${classes.main}`}>
        <section className={`${reg.panel} ${classes.card}`}>
          <header className={reg.panelHeader}>
            <strong>최적화 대상</strong>
            <span className={reg.count}>{groupRows.length !== selectedRows.length ? `${groupRows.length} / ${selectedRows.length}건` : `${selectedRows.length}건`}</span>
            <div className={classes.queueTabs}>
              <SegmentedControl size="xs" color="red" value={material} onChange={changeMaterial} data={MATERIAL_TABS} />
            </div>
            {activePlan && <span className={`${classes.planTag} ${classes[`planTag_${activePlan.status}`] || ''}`} title="지금 열려 있는 계획">
              <i aria-hidden="true" />{PLAN_STATUS[activePlan.status]?.label}<b>{activePlan.planno}</b></span>}
            {canGoProcess && <button type="button" className={btn('btnPrimary', 'btnSm', 'pushRight')} title="이 계획을 재고가공등록에서 차수별로 불러와 등록합니다"
              onClick={() => navigate(`/ItemProcessRegister?planno=${encodeURIComponent(activePlan.planno)}`)}>재고가공등록으로 이동</button>}
            {(selectedKeys.length > 0 || activePlan) && <button type="button" className={btn('btnDark', 'btnSm', canGoProcess ? '' : 'pushRight')} onClick={resetWork} disabled={saving}
              title="담은 품목을 비우고 다른 창고 · 품목으로 새로 작업합니다 (저장된 계획 · 품목 상태는 그대로)">{activePlan ? '계획 닫기' : '현재 작업 비우기'}</button>}
          </header>
          {targetTable}
        </section>

        {confirmedDetail && <Card number="✓" title={`${activePlan.status === 'DONE' ? '가공완료' : '확정'} 계획 ${activePlan.planno}`}>
          <Group gap="lg" mb={8}>
            <Text size="sm">원자재 <b>{confirmedDetail.header.rawkind === 'STOCK' ? `현재고 ${confirmedDetail.header.stocksourceno}-${confirmedDetail.header.stocksourceline}` : '신규 매입'}</b></Text>
            <Text size="sm">규격 <b>{confirmedDetail.header.itemname} {fmt(confirmedDetail.header.thickness, 3)} × {fmt(confirmedDetail.header.width)}{confirmedDetail.header.length ? ` × ${fmt(confirmedDetail.header.length)}` : ''}</b></Text>
            <Text size="sm">수율 <b>{fmt(confirmedDetail.header.yieldrate, 2)}%</b></Text>
          </Group>
          {(confirmedDetail.header.materialtype || material) === 'COIL'
            ? <CoilViz plan={confirmedDetail.header.pattern?.plan} rawWidth={confirmedDetail.header.width} />
            : <SheetViz plan={confirmedDetail.header.pattern?.plan} rawWidth={confirmedDetail.header.width} rawLength={confirmedDetail.header.length} />}
          <PlanResult plan={confirmedDetail.header.pattern?.plan} material={confirmedDetail.header.materialtype || material} />
        </Card>}

        {!viewingConfirmed && selectedKeys.length > 0 && <>
          {shownAnalysis?.message && <Paper withBorder p="sm" className={classes.warn}>{shownAnalysis.message}</Paper>}

          <Card number="1" title="원자재 후보 추천" actions={historyButtons('purchase')}>
            <div className={classes.candidateTools}>
              <Select size="xs" w={140} label="기본규격" placeholder="선택" value={null} clearable={false} allowDeselect
                data={(material === 'COIL' ? STANDARD_COIL_WIDTHS : STANDARD_SHEET_SIZES).map((value) => ({ value, label: `${value.replace('x', ' × ')}mm` }))}
                onChange={(value) => { if (!value) return; const [w, l] = value.split('x'); setNewWidth(Number(w)); if (l) setNewLength(Number(l)); }} />
              <NumberInput size="xs" w={110} label={material === 'COIL' ? '원자재 폭 직접 입력' : '원판 폭'} placeholder="mm" value={newWidth} onChange={setNewWidth} hideControls min={0} />
              {material === 'SHEET' && <NumberInput size="xs" w={110} label="원판 길이" placeholder="mm" value={newLength} onChange={setNewLength} hideControls min={0} />}
              {material === 'COIL' && <NumberInput size="xs" w={130} label="예상 투입중량 (선택)" placeholder="비우면 필요중량" value={newWeight} onChange={setNewWeight} hideControls min={0} thousandSeparator="," />}
              <button type="button" className={btn('btnDark', 'btnSm')} style={{ alignSelf: 'flex-end' }} onClick={addNewCandidate}>후보 추가</button>
              <span className={`${classes.muted} ${classes.toolsNote}`}>{material === 'COIL' ? '현재고 → 신규(매입이력·직접 입력) 순, 수율 높은 순' : (shownAnalysis?.candidates || []).some((c) => c.coil) ? '코일 후보: 수율 높은 순 · 원판 후보: 로스중량 적은 순 (동률 시 연결 원자재 우선)' : '로스중량 적은 순 (동률 시 연결 원자재 우선)'}</span>
            </div>
            {shownAnalysis?.candidates?.length ? <div className={`${reg.tableScroll} ${classes.candidateScroll}`}><table className={`${reg.ordersTable} ${classes.candidateTable}`} style={{ width: `max(100%, ${candidateTableWidth}px)`, minWidth: `${candidateTableWidth}px` }}>
              <ResizableHead columns={candidateColumns} {...candidateWidths}
                labelOf={(column) => (column.key === 'stock' ? (material === 'COIL' ? '중량(재고)' : '수량(재고)')
                  : column.info ? <>{column.label}<Info text={FORMULAS[material][column.info]} /></> : column.label)} />
              <tbody>{shownAnalysis.candidates.map((c) => <Fragment key={c.id}><tr className={(settings.raw_id ?? raw?.id) === c.id ? reg.selectedRow : ''} onClick={() => { if ((settings.raw_id ?? raw?.id) !== c.id) chooseRaw(c.id); }}>
                <td>{c.rank}순위</td><td title={c.source || c.source_note || ''}>{c.label}
                  {c.kind === 'NEW' && c.source && <button type="button" className={classes.candRemove} aria-label={`${c.label} 후보 빼기`} title={`${c.source} · 후보에서 빼기`}
                    onClick={(event) => { event.stopPropagation(); removeRawCandidate(c); }}>×</button>}</td><td>{c.itemname}</td>
                <td>{fmt(c.thickness, 3)} × {fmt(c.width)}{material === 'SHEET' && !c.coil ? ` × ${fmt(c.length)}` : ' × C'}</td>
                <td>{c.kind === 'STOCK' ? <>{c.warehouse}{c.warehouses?.length > 1 && <button type="button" className={classes.candExpand} aria-expanded={Boolean(openGroups[c.id])}
                  title="필요 매수 이상 재고가 있는 창고 보기 · 계획 창고 고르기" onClick={(event) => { event.stopPropagation(); setOpenGroups((s) => ({ ...s, [c.id]: !s[c.id] })); }}>{openGroups[c.id] ? '접기' : '펼치기'}</button>}</> : '–'}</td>
                <td>{c.kind === 'STOCK' ? (material === 'COIL' || c.coil ? `${fmt(c.weight)}kg` : `${fmt(c.qty, 0)}매`) : '신규'}{c.lot_count > 1 ? <small className={classes.estTag} title={`계획 창고 ${c.wh_name || ''}: 재고 ${fmt(c.wh_qty, 0)}매 · 로트 ${c.lot_count}개를 입고 순으로 씁니다`}>로트 {c.lot_count}</small> : null}</td>
                {material === 'SHEET' ? (c.placeable === false || c.input_weight === null || c.input_weight === undefined
                  // 시트 (시안 v5): 두 절단방향 중 로스중량이 적은 쪽으로 계산 · 90° = 원판을 돌려 놓는 쪽이 유리
                  ? <><td><span className={classes.shortTag} title="발주 규격을 배치할 수 없어 계산되지 않습니다">배치 불가</span></td>{showOver && <td>–</td>}<td>–</td><td>–</td><td>–</td><td>–</td></>
                  : <><td>{c.coil ? <><b>{fmt(c.coil_length_m)}m</b><small className={classes.estTag} title="시트를 이 코일에서 길이로 잘라 만듭니다 (주문 소요 길이)">코일</small>{c.short_pcs > 0 ? <span className={classes.under}>부족 {c.short_pcs}매</span> : null}</> : <><b>{fmt(c.sheets, 0)}매</b>{c.orientation === 'ROTATED' ? <small className={classes.estTag} title="이 원판은 90도 회전 배치가 더 유리/가능합니다">90°</small> : null}{c.short_sheets > 0 ? <span className={classes.under}>부족 {c.short_sheets}</span> : null}</>}</td>
                    {showOver && <td>{c.over_eff > 0 ? <span className={classes.over} title={`발주보다 ${c.over_pcs}매 더 생산`}>▲{fmt(c.over_pcs, 0)}매</span>
                      : <span className={classes.muted} title="초과 없음">-</span>}</td>}
                    <td>{fmt(c.input_weight, 2)}kg</td><td>{fmt(c.production_weight, 2)}kg</td><td>{fmt(c.loss_weight, 2)}kg</td><td><b>{fmt(c.yield_rate, 2)}%</b></td></>)
                : c.input_weight === null || c.input_weight === undefined
                  ? <><td><span className={classes.shortTag} title="발주 폭을 배치할 수 없거나, 목표 중량이 없는 '나머지' 품목뿐이라 투입중량을 정할 수 없습니다">{c.placeable === false && c.kind === 'NEW' ? '중량 입력' : '배치 불가'}</span></td><td>–</td><td>–</td><td>–</td></>
                  : <><td>{fmt(c.input_weight)}kg{c.weight_tag ? <small className={classes.estTag} title={c.weight_tag === '필요' ? '발주 필요중량을 모두 채우는 최소 투입중량(계산값)' : '매입이력·직접 입력한 계산용 가정 중량'}>{c.weight_tag}</small> : null}</td>
                    <td>{fmt(c.production_weight)}kg</td><td>{fmt(c.loss_weight)}kg</td><td><b>{fmt(c.yield_rate, 2)}%</b></td></>}
              </tr>{candidateSubRows(c)}</Fragment>)}</tbody>
            </table></div> : <div className={classes.empty}>{analyzing ? '후보를 찾는 중입니다.' : (shownAnalysis?.empty_message || '후보가 없습니다. 원자재 규격을 직접 입력해 후보를 추가해 주세요.')}</div>}
          </Card>

          <Card number="2" title="원자재·가공방식">
            {raw ? material === 'COIL' ? <>
              <div className={classes.fields}>
                {rawLocked ? <>
                  <TextInput label="가공폭 (mm)" value={fmt(raw.raw_width)} readOnly title={STOCK_LOCK_TIP} />
                  <TextInput label="가공중량 (kg)" value={fmt(raw.raw_weight)} readOnly title={STOCK_LOCK_TIP} />
                </> : <>
                  <NumberInput label="가공폭 (mm)" value={settings.raw_width ?? raw.raw_width} onChange={(value) => typeSettings({ raw_width: value === '' ? undefined : value })} hideControls min={1} />
                  <NumberInput label="가공중량 (kg)" value={settings.raw_weight ?? raw.raw_weight} onChange={(value) => typeSettings({ raw_weight: value === '' ? undefined : value })} hideControls min={1} thousandSeparator="," />
                </>}
                <TextInput label="두께 (mm)" value={fmt(raw.thickness, 3)} readOnly />
                <NumberInput label="기본 로스 (mm)" value={settings.trimloss} onChange={(value) => typeSettings({ trimloss: value === '' ? 4 : value })} hideControls min={0} />
              </div>
              <div className={`${classes.fields} ${classes.modeFields}`}>
                <Select label="가공방식" value={settings.processmode} allowDeselect={false} onChange={(value) => updateSettings({ processmode: value, splitweights: undefined, partialweight: undefined })}
                  data={[{ value: 'ONE', label: '원샷' }, { value: 'SPLIT', label: '등분' }, { value: 'PARTIAL', label: '일부가공' }]} />
              {settings.processmode === 'ONE' && <>
                <TextInput label="가공중량 (kg)" value={fmt(processWeight)} readOnly />
                <TextInput label="보관중량 (kg)" value="0" readOnly />
              </>}
              {settings.processmode === 'PARTIAL' && <>
                <NumberInput label="가공중량 (kg)" value={settings.partialweight ?? raw.process_weight} hideControls thousandSeparator="," onChange={(value) => typeSettings({ partialweight: Number(value) || 0 })} />
                <TextInput label="보관중량 (kg)" value={fmt(raw.storage_weight)} readOnly />
              </>}
              </div>
              {settings.processmode === 'SPLIT' && (() => {
                const splits = settings.splitweights || raw.runs;
                const splitTotal = splits.reduce((sum, value) => sum + (Number(value) || 0), 0);
                const balanced = Math.abs(splitTotal - processWeight) <= 0.1;
                return <div className={classes.splitPanel}>
                  <div className={classes.splitHead}>
                    <strong>등분 설정</strong><span>{splits.length}차</span>
                    <span className={`${classes.splitSum} ${balanced ? classes.splitSumOk : classes.splitSumWarn}`}>
                      {balanced ? '✓ ' : ''}합계 <b>{fmt(splitTotal)}</b> / {fmt(processWeight)}kg{balanced ? '' : splitTotal > processWeight ? ` · ${fmt(splitTotal - processWeight)}kg 초과` : ` · ${fmt(processWeight - splitTotal)}kg 남음`}
                    </span>
                  </div>
                  {/* 등분 합계가 가공중량을 얼마나 채웠는지 (맞으면 초록 · 모자라면 주황 · 넘치면 빨강) */}
                  <div className={classes.splitMeter} aria-hidden="true">
                    <i className={balanced ? classes.splitMeterOk : splitTotal > processWeight ? classes.splitMeterOver : classes.splitMeterShort}
                      style={{ width: `${processWeight > 0 ? Math.min(100, (splitTotal / processWeight) * 100) : 0}%` }} />
                  </div>
                  <div className={`${classes.splitActions} ${classes.splitActionsTop}`}>
                    <button type="button" className={btn('btnSoftBlue', 'btnSm')} onClick={() => updateSettings({ splitweights: [...splits, 0] })} title="차수를 하나 더 나눕니다">+ 차수 추가</button>
                    {splits.length > 2 && <button type="button" className={btn('btnSoftGray', 'btnSm')} onClick={() => updateSettings({ splitweights: splits.slice(0, -1) })} title="마지막 차수를 지웁니다">− 차수 삭제</button>}
                  </div>
                  <div className={classes.runs}>
                    {splits.map((weight, index, list) => <NumberInput key={index} size="xs" label={`${index + 1}차 가공중량 (kg)`} value={weight} hideControls thousandSeparator=","
                      onChange={(value) => typeSettings({ splitweights: list.map((item, i) => (i === index ? Number(value) || 0 : item)) })} />)}
                  </div>
                </div>;
              })()}
            </> : raw.coil ? (() => {
              // 시트를 현재고 코일에서 길이로 자르는 경우 (코일 길이 샤링): 실물 값 읽기 전용 + 비중 · 도금상수 · 여유 · 원샷/일부
              const cp = shownAnalysis?.coil_params || {};
              const one = settings.coil_mode !== 'PART';   // 기본 = 원샷 (코일 재고 전량)
              return <div className={`${classes.fields} ${classes.coilShearFields}`}>
                <TextInput label="코일 폭 (mm)" value={fmt(raw.raw_width)} readOnly title={STOCK_LOCK_TIP} />
                <TextInput label="코일 재고 (kg)" value={fmt(raw.raw_weight)} readOnly title={STOCK_LOCK_TIP} />
                <TextInput label="두께 (mm)" value={fmt(raw.thickness, 3)} readOnly />
                <NumberInput label="비중" value={settings.coil_sg ?? cp.sg ?? 7.85} onChange={(value) => typeSettings({ coil_sg: value === '' ? null : value })}
                  hideControls min={0} step={0.01} decimalScale={3} title={`기본값 ${cp.sg_default ?? 7.85} (강종 코드의 비중)`} />
                <NumberInput label="도금상수" value={settings.coil_coat ?? cp.coat ?? 0} onChange={(value) => typeSettings({ coil_coat: value === '' ? null : value })}
                  hideControls min={0} step={0.001} decimalScale={3} title="기본값 0 · 도금 제품이면 담당자가 입력 (예: CCGI 0.7t → 0.305)" />
                <NumberInput label="폭 여유 (mm · 양쪽 합)" value={settings.sidetrim ?? 0} onChange={(value) => typeSettings({ sidetrim: value === '' ? 0 : value })} hideControls min={0} step={0.5} />
                <NumberInput label="길이 여유 (mm)" value={settings.coil_len_allow ?? 0} onChange={(value) => typeSettings({ coil_len_allow: value === '' ? 0 : value })}
                  hideControls min={0} step={0.5} title="제품 1장당 절단 길이에 더합니다" />
                <Select label="가공방식" value={one ? 'ONE' : 'PART'} allowDeselect={false}
                  data={[{ value: 'ONE', label: '원샷 (전량)' }, { value: 'PART', label: '일부' }]}
                  onChange={(value) => updateSettings({ coil_mode: value, coil_process_kg: null })} />
                {one ? <TextInput label="가공중량 (kg)" value={fmt(raw.raw_weight)} readOnly title="원샷은 코일 재고 전량을 가공합니다" />
                  : <NumberInput label="가공중량 (kg)" value={settings.coil_process_kg ?? chosenPlan?.input_weight ?? ''} thousandSeparator=","
                    onChange={(value) => typeSettings({ coil_process_kg: value === '' ? null : value })} hideControls min={0} max={Number(raw.raw_weight) || undefined}
                    title={`비우면 주문 소요 중량 (${fmt(chosenPlan?.need_kg)}kg)`} />}
                <TextInput label="보관중량 (kg)" value={chosenPlan ? fmt(chosenPlan.keep_kg) : '–'} readOnly title="코일 재고 − 가공중량 (원래 재고 줄에 남음)" />
              </div>;
            })()
            : <div className={`${classes.fields} ${classes.sheetFields}`}>
              {rawLocked ? <>
                <TextInput label="원판 폭 (mm)" value={fmt(raw.raw_width)} readOnly title={STOCK_LOCK_TIP} />
                <TextInput label="원판 길이 (mm)" value={fmt(raw.raw_length)} readOnly title={STOCK_LOCK_TIP} />
              </> : <>
                <NumberInput label="원판 폭 (mm)" value={settings.raw_width ?? raw.raw_width} onChange={(value) => typeSettings({ raw_width: value === '' ? undefined : value })} hideControls min={1} />
                <NumberInput label="원판 길이 (mm)" value={settings.raw_length ?? raw.raw_length} onChange={(value) => typeSettings({ raw_length: value === '' ? undefined : value })} hideControls min={1} />
              </>}
              <TextInput label="원판 두께 (mm)" value={fmt(raw.thickness, 3)} readOnly />
              {/* 현재고 = 재고 매수, 신규 = 고른 안의 필요 매수 (시안 v5) */}
              <TextInput label="원판 매수 (EA)" value={raw.raw_sheets === null || raw.raw_sheets === undefined ? (chosenPlan ? `${fmt(chosenPlan.sheets, 0)} (필요)` : '신규') : fmt(raw.raw_sheets, 0)} readOnly
                title={raw.raw_sheets === null || raw.raw_sheets === undefined ? '신규 매입 후보 · 고른 안의 필요 원판 매수' : '현재고 원판 매수'} />
              {/* 절단방향 = 고른 안의 방향. 바꾸면 그 방향 대표안(A 기본 · B 90도 회전)을 고른다 */}
              <Select label="절단방향" value={chosenPlan?.orientation || settings.orientation || 'NORMAL'} allowDeselect={false}
                onChange={(value) => {
                  // 배치할 수 없는 방향은 막지 않고 고를 때 사유만 알린다 (지금 안 그대로)
                  const bad = (shownAnalysis?.bad || []).find((item) => item.orientation === value);
                  if (bad) { notifications.show({ title: `${bad.label} · 배치 불가`, message: `${bad.why}. 이 원판으로는 이 방향으로 자를 수 없습니다.`, color: 'orange' }); return; }
                  updateSettings({ orientation: value }); setPlanId(value === 'ROTATED' ? 'B' : 'A');
                }}
                data={[{ value: 'NORMAL', label: '기본' }, { value: 'ROTATED', label: '90도 회전' }]} />
              {/* 코일 길이 샤링과 같은 항목 · 같은 설정 키: 이론중량 = 폭 × 길이 × (두께 × 비중 + 도금상수) ÷ 1,000,000 */}
              <NumberInput label="비중" value={settings.coil_sg ?? shownAnalysis?.sheet_params?.sg ?? 7.85} onChange={(value) => typeSettings({ coil_sg: value === '' ? null : value })}
                hideControls min={0} step={0.01} decimalScale={3} title={`기본값 ${shownAnalysis?.sheet_params?.sg_default ?? 7.85} (강종 코드의 비중)`} />
              <NumberInput label="도금상수" value={settings.coil_coat ?? shownAnalysis?.sheet_params?.coat ?? 0} onChange={(value) => typeSettings({ coil_coat: value === '' ? null : value })}
                hideControls min={0} step={0.001} decimalScale={3} title="기본값 0 · 도금 제품이면 담당자가 입력 (예: CCGI 0.7t → 0.305)" />
              <NumberInput label="폭 여유 (mm · 양쪽 합)" value={settings.sidetrim ?? 0} onChange={(value) => typeSettings({ sidetrim: value === '' ? 0 : value })} hideControls min={0} step={0.5} />
              <NumberInput label="길이 여유 (mm)" value={settings.coil_len_allow ?? 0} onChange={(value) => typeSettings({ coil_len_allow: value === '' ? 0 : value })}
                hideControls min={0} step={0.5} title="제품 1장당 절단 길이에 더합니다 (열 안에 들어가는 장수 = 원판 길이 ÷ (제품 길이 + 길이 여유))" />
            </div> : <div className={classes.empty}>① 에서 원자재 후보를 선택해 주세요.</div>}
            {shownAnalysis?.warnings?.map((warning) => <div key={warning} className={classes.warn}>{warning}</div>)}
          </Card>

          <Card number="3" title="가공 추천조합" bodyClass={`${classes.recommendBody} ${analyzing ? classes.recalcBody : ''}`}
            actions={historyButtons('processing')}>
            <div className={classes.box} ref={recommendRef} style={lockHeight ? { minHeight: lockHeight } : undefined}>
              <div className={classes.methodRow}>
                <SegmentedControl size="xs" color="red" value={settings.combo} onChange={(value) => {
                  // 탭은 막지 않는다. 시트에서 안 되는 경우는 탭 안에 안내로 보여 준다 (코일 탭 '추천 가능한 조합 없음' 안내와 같은 모양)
                  setLockHeight(recommendRef.current?.offsetHeight || 0);   // 새 결과가 올 때까지 높이 유지 (아래 화면이 튀지 않게)
                  updateSettings({ combo: value }); setPlanId(null);
                }}
                  data={material === 'COIL' ? [{ value: 'SINGLE', label: '단독' }, { value: 'MIXED', label: '혼합' }]
                    // 시트 혼합절단은 품명·두께·폭이 같은 길이 2개 이상일 때만 (시안 v5)
                    : [{ value: 'SINGLE', label: '단독절단' }, { value: 'MIXED', label: '혼합절단' }]} />
                <span className={classes.muted}>{material === 'COIL' ? '주문 충족 → 부족·초과량 + 로스 → 수율 순' : raw?.coil ? '코일 후보 · 발주 순서대로 길이 절단 (최적화 없음)' : 'A안 기본 방향 · B안 90도 회전 · 로스중량이 적은 안 추천'}</span>
              </div>
              {refs.length > 0 && <div className={classes.refs}>{refs.map((ref) => <span key={`${ref.kind}-${ref.value}`} className={classes.ref}>{ref.label}
                <button type="button" aria-label={`${ref.label} 해제`} title="참고 해제" onClick={() => removeRef(ref.kind, ref.value)}>×</button></span>)}</div>}
              {material === 'SHEET' && raw?.coil && <div className={classes.orientNote}>코일 후보는 담은 품목을 묶어 발주 순서대로 코일에서 길이로 자릅니다 (최적화 없음).</div>}
              <div className={classes.plans}>{sheetMixBlocked
                ? <div className={classes.noCombo}><strong>혼합절단을 할 수 없습니다</strong>
                  <span>혼합절단은 품명 · 두께 · 폭이 같은 다른 길이의 발주품목이 2개 이상일 때만 됩니다. [대기 품목]에서 함께 담거나 [단독절단]으로 계산해 주세요.</span></div>
                : material === 'SHEET' && shownAnalysis?.coil_single_blocked
                ? <div className={classes.noCombo}><strong>단독절단을 지원하지 않습니다</strong>
                  <span>코일 길이 절단은 품목을 묶어서 한 번에 처리합니다. 단독절단은 지원하지 않습니다.</span></div>
                : plansList.length ? plansList.map((plan) => (material === 'SHEET' && plan.coil
                ? <CoilShearCard key={plan.id} plan={plan} selected={chosenPlan?.id === plan.id} />
                : material === 'SHEET'
                // 시트 추천안 (시안 v5): 방향 · 방식 · 태그 / 배치 설명 / 원판 1장당 구성 / 필요 원판 · 로스 · 초과생산 / 품목별 과부족
                ? <button key={plan.id} type="button" className={`${classes.plan} ${chosenPlan?.id === plan.id ? classes.planSelected : ''}`} onClick={() => choosePlan(plan)}>
                  <span className={classes.planHead}><span>{plan.id}안 · {plan.olabel} · {plan.combo === 'MIXED' ? '혼합절단' : '단독절단'}{plan.tag ? ` · ${plan.tag}` : ''}
                    {plan.recommended ? <span className={classes.recBadge}>추천</span> : null}
                    {plan.short_sheets > 0 ? <span className={classes.shortBadge}>원판 {plan.short_sheets}매 부족</span> : null}</span>
                    <span>수율 <b>{fmt(plan.int_input > 0 ? (plan.int_production / plan.int_input) * 100 : plan.yield_rate, 2)}%</b></span></span>
                  <div className={classes.orientNote}>{plan.odesc}</div>
                  <div className={classes.planPattern}><span className={classes.planCaption}>{plan.single_multi ? '품목별 원판 1장당 구성 · 길이 × 장수 (품목끼리 섞지 않음)' : '원판 1장당 구성 · 길이 × 장수'}</span>{plan.pattern}
                    {plan.pattern_count > 1 && !plan.single_multi ? <span className={classes.muted}> 외 {plan.pattern_count - 1}개 패턴</span> : null}</div>
                  <span className={classes.planMeta}>필요 원판 {fmt(plan.sheets, 0)}매{plan.lb_text ? ` (${plan.lb_text})` : ''} · 로스중량 {fmt(plan.int_loss ?? plan.loss_weight, 2)}kg{plan.excess_weight > 0.005 ? ` · 초과생산 ${fmt(plan.excess_weight, 2)}kg` : ''}</span>
                  <SheetFillLines plan={plan} />
                </button>
                : <button key={plan.id} type="button" className={`${classes.plan} ${chosenPlan?.id === plan.id ? classes.planSelected : ''}`} onClick={() => setPlanId(plan.id)}>
                <span className={classes.planHead}><span>{plan.id}안 · {plan.combo === 'MIXED' ? (material === 'COIL' ? '혼합가공' : '혼합절단') : (material === 'COIL' ? (plan.item_pass ? '품목별 차수' : '단독가공') : '단독절단')}
                  {plan.id === plansList[0].id ? <span className={classes.recBadge}>추천</span> : null}
                  {material === 'COIL' && plan.ok_all ? <span className={classes.okBadge}>주문 충족</span> : null}
                  {material === 'SHEET' && plan.short_sheets > 0 ? <span className={classes.shortBadge}>원판 {plan.short_sheets}매 부족</span> : null}</span>
                  <span>수율 <b>{fmt(plan.yield_rate, 2)}%</b></span></span>
                <div className={classes.planPattern}>{plan.pattern}</div>
                <span className={classes.planMeta}>{material === 'COIL'
                  ? `사용폭 ${(plan.used_widths || [plan.used_width]).map((v) => fmt(v)).join(' / ')}mm · 잔여폭 ${(plan.spare_widths || plan.remain_widths || [plan.remain_width]).map((v) => fmt(v)).join(' / ')}mm · 로스 ${plan.int_loss !== undefined ? fmt(plan.int_loss, 0) : fmt(plan.loss_weight)}kg`
                  : `필요 원판 ${fmt(plan.sheets, 0)}매 · 로스 ${fmt(plan.loss_weight, 2)}kg`}</span>
                {material === 'COIL' && <CoilFillLines plan={plan} />}
                {plan.source && <span className={classes.planMeta}>가공이력 {plan.source} 반영{plan.actual_loss ? ` · 당시 실적 로스 ${fmt(plan.actual_loss, 0)}kg` : ''}</span>}
                {plan.candidate_widths?.length > 0 && <span className={classes.planMeta}>가공 후보 {plan.candidate_widths.map((v) => `${fmt(v)}mm`).join(', ')} 포함 (발주품목 아님)</span>}
              </button>)) : !analyzing && shownAnalysis?.no_combo
                ? <div className={classes.noCombo}><strong>{shownAnalysis.no_combo.title}</strong><span>{shownAnalysis.no_combo.desc}</span></div>
                : <div className={classes.empty}>{analyzing ? '조합을 계산하는 중입니다.' : '추천 가능한 조합이 없습니다.'}</div>}
                {material === 'SHEET' && !sheetMixBlocked && (shownAnalysis?.bad || []).map((bad) => <div key={bad.orientation} className={classes.orientNote}>{bad.label} : 배치 불가 ({bad.why})</div>)}</div>
              {material === 'SHEET' && chosenPlan?.coil && chosenPlan.short_pcs > 0 && <div className={`${classes.status} ${classes.statusWarn}`}>
                코일 재고로 {chosenPlan.short_text} 부족 (약 {fmt(chosenPlan.short_kg)}kg) → 시트 재고 또는 신규 매입으로 보충</div>}
              {(shownAnalysis?.notes?.length > 0 || chosenPlan?.rec_weights) && material === 'COIL' && <div className={`${classes.status} ${classes.noteBox} ${shownAnalysis?.notes_warn ? classes.statusWarn : ''}`}>
                {/* 첫 줄 = 계산 기준(머리표), 나머지 = 한 문장씩 줄바꿈 */}
                {(shownAnalysis?.notes || []).map((note, i) => (i === 0 ? <div key={note} className={classes.noteHead}>{note}</div> : <p key={note} className={classes.noteLine}>{note}</p>))}
                {chosenPlan?.rec_weights && <button type="button" className={classes.recButton}
                  onClick={() => updateSettings({ processmode: 'SPLIT', splitweights: chosenPlan.rec_weights })}>권장 등분중량 적용 ({chosenPlan.rec_weights.map((v) => fmt(v, 0)).join(' / ')}kg)</button>}
              </div>}
            </div>
            <div className={classes.box}>
              {chosenPlan && raw ? <>
                <div className={classes.vizHead}><span className={classes.vizName}>{chosenPlan.coil ? '코일 길이 절단' : `선택안 · ${chosenPlan.id}안`}</span>
                  <span className={classes.muted}>{material === 'COIL' ? `원코일 ${fmt(raw.raw_width)}mm` : chosenPlan.coil ? `${raw.itemname || ''} COIL · 폭 ${fmt(raw.raw_width)}mm` : `${chosenPlan.combo === 'MIXED' ? '혼합절단' : '단독절단'} · ${chosenPlan.olabel || ''}${chosenPlan.single_multi ? ' · 품목별로 따로 계산' : ''}`}</span></div>
                {material === 'COIL' ? <CoilViz plan={chosenPlan} rawWidth={raw.raw_width} />
                  : chosenPlan.coil ? <CoilBar plan={chosenPlan} /> : <SheetViz plan={chosenPlan} rawWidth={raw.raw_width} rawLength={raw.raw_length} patIdx={patIdx} onPattern={pickPattern} />}
                <PlanResult plan={chosenPlan} material={material} notes={material === 'SHEET' ? shownAnalysis?.notes : null} patIdx={patIdx} />
              </> : <div className={classes.empty}>조합을 선택하면 배치가 표시됩니다.</div>}
            </div>
          </Card>
        </>}

        {(selectedKeys.length > 0 || activePlan) && <div className={classes.footer}>
          <span className={classes.note}>{activePlan ? `${activePlan.planno} · ${PLAN_STATUS[activePlan.status]?.label || ''}` : `가공그룹 ${groupRows.length}개 품목${groupRows.length !== selectedKeys.length ? ` (담은 품목 ${selectedKeys.length}개)` : ''}`}</span>
          {!activePlan && <button type="button" className={btn('btnGray')} onClick={() => setConfirmAction('return')} disabled={saving}>주문서 관리로 돌려보내기</button>}
          {activePlan && activePlan.status !== 'DONE' && <button type="button" className={btn('btnGray')} onClick={() => setConfirmAction('cancel')} disabled={saving}>{editingDraft ? '임시저장 삭제' : '계획 취소'}</button>}
          {!viewingConfirmed && <button type="button" className={btn('btnDark')} onClick={() => void savePlan('DRAFT')} disabled={!canSave || saving}>임시저장</button>}
          {!viewingConfirmed && <button type="button" className={btn('btnPrimary')} onClick={() => setConfirmAction('confirm')} disabled={!canSave || saving}>계획 확정</button>}
          {activePlan && <button type="button" className={btn('btnLine')} onClick={resetWork}>닫기</button>}
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
          <button type="button" className={btn('btnPrimary', 'btnBlock')} onClick={openPicker}
            title={activePlan ? '열린 계획을 닫고 새 작업으로 불러옵니다' : undefined}>대기 품목 ({materialQueue.length})</button>
          <button type="button" className={btn('btnDark', 'btnBlock')} onClick={() => setPlanPickerOpen(true)}>계획 불러오기 ({materialPlans.length})</button>
        </Box>
      </Paper>}
    </Box>

    <OptimizationGuideModal opened={guideOpen} onClose={() => setGuideOpen(false)} material={material} />
    {pickerModal}
    {planPickerModal}
    {/* 주문서 관리 [가공 최적화 이동] → 이 주문의 대기 품목을 묶음별로 고르는 창 (공통 확인 창 디자인) */}
    <Modal opened={Boolean(orderGroups)} onClose={() => setOrderGroups(null)} centered size={560} withCloseButton={false} padding={0} radius={16}
      returnFocus={false} overlayProps={{ backgroundOpacity: 0.2 }} classNames={{ content: confirmBase.content }} className={classes.optScope}>
      {orderGroups && <>
        <div className={confirmBase.top}>
          <span className={confirmBase.icon} aria-hidden="true"><IconListCheck size={24} stroke={1.8} /></span>
          <h2>작업할 품목을 골라 주세요</h2>
          <span className={confirmBase.target}>{orderGroups.orderid}</span>
          <p>창고 · 품명 · 두께가 같은 품목끼리 묶었습니다.<br />한 번에 한 묶음씩 계획합니다.</p>
        </div>
        <div className={classes.ogList}>
          {orderGroups.groups.map((group) => <button key={group.key} type="button" className={classes.ogCard} onClick={() => startGroup(group)}>
            <span className={`${classes.ogBadge} ${group.material === 'COIL' ? classes.ogBadgeCoil : classes.ogBadgeSheet}`}>{group.material === 'COIL' ? '코일' : '시트'}</span>
            <span className={classes.ogMain}>
              <b title={group.itemname}>{group.itemname} <em>{fmt(group.thickness, 3)}T{group.width != null ? ` × ${fmt(group.width)}` : ''}</em></b>
              <small>{group.warehouse} · 품목 {group.rows.length}건 · 주문 {fmt(group.rows.reduce((sum, row) => sum + (Number(row.order_amount) || 0), 0))}{group.material === 'COIL' ? 'kg' : '매'}</small>
            </span>
            <span className={classes.ogPick}>선택</span>
          </button>)}
          {!orderGroups.groups.length && !(orderGroups.plans || []).length && <div className={classes.ogEmpty}>지금 계획할 수 있는 대기 품목이 없습니다.</div>}
          {(orderGroups.plans || []).length > 0 && <div className={classes.ogSectionTitle}>저장된 계획</div>}
          {(orderGroups.plans || []).map((plan) => {
            const first = plan.rows[0];
            const tone = plan.status === 'CONFIRMED' ? classes.ogBadgeConfirmed : plan.status === 'DONE' ? classes.ogBadgeDone : classes.ogBadgeDraft;
            return <button key={plan.planno} type="button" className={classes.ogCard} onClick={() => { setOrderGroups(null); void openPlan(plan.planno); }}>
              <span className={`${classes.ogBadge} ${tone}`}>{plan.status === 'CONFIRMED' ? '계획확정' : plan.status === 'DONE' ? '가공완료' : '임시저장'}</span>
              <span className={classes.ogMain}>
                <b title={first.itemname}>{first.itemname} <em>{fmt(first.thickness, 3)}T{first.material === 'SHEET' && first.width != null ? ` × ${fmt(first.width)}` : ''}</em></b>
                <small>{plan.planno} · 품목 {plan.rows.length}건 ({plan.rows.map((row) => `${row.orderid}-${row.lineno}`).join(', ')})</small>
              </span>
              <span className={classes.ogOpen}>열기</span>
            </button>;
          })}
          {orderGroups.excluded.length > 0 && <div className={classes.groupExcluded}>
            <strong>최적화할 수 없는 품목 {orderGroups.excluded.length}건</strong>
            <ul>{orderGroups.excluded.map(({ row, reason }) => <li key={keyOf(row)}>{row.orderid}-{row.lineno} {row.itemname} · {reason}</li>)}</ul>
          </div>}
        </div>
        <div className={classes.ogGuide}>
          <b>가공 최적화란?</b>
          <span>주문 품목을 어떤 원자재로 어떻게 자를지 계산하는 화면입니다.<br />
            묶음을 고르면 ① 원자재 후보 → ② 원자재 · 가공방식 → ③ 추천조합 순서로 계산됩니다.<br />
            안을 골라 [계획 확정]하면 재고가공등록으로 넘길 수 있습니다.<br />
            고르지 않은 묶음은 [대기 품목]에, 저장된 계획은 [계획 불러오기]에 남습니다.</span>
        </div>
        <div className={classes.ogFooter}><button type="button" className={confirmBase.cancel} onClick={() => setOrderGroups(null)}>닫기</button></div>
      </>}
    </Modal>
    {historyKind && <HistoryModal opened={Boolean(historyKind)} kind={historyKind} material={material} context={historyContext}
      onClose={() => setHistoryKind(null)} onApply={applyHistory} onAdd={addProcessCandidate} />}
    <Modal opened={Boolean(confirmAction)} onClose={() => !saving && setConfirmAction(null)} centered size={520} className={classes.optScope} classNames={MODAL_LOOK}
      title={confirmAction === 'confirm' ? '계획 확정' : confirmAction === 'cancel' ? (editingDraft ? '임시저장 삭제' : '계획 취소') : '주문서 관리로 돌려보내기'}>
      {confirmAction && (() => {
        const unit = material === 'COIL' ? 'kg' : '매';
        const shortPieces = material === 'COIL' ? (chosenPlan?.pieces || []).filter((piece) => !piece.extra && piece.state === 'short') : [];
        const shortTotal = shortPieces.reduce((sum, piece) => sum + Math.abs(Number(piece.delta) || 0), 0);
        const issues = chosenPlan?.issues || [];
        const actionLabel = confirmAction === 'confirm' ? '계획 확정' : confirmAction === 'cancel' ? (editingDraft ? '삭제' : '계획 취소') : '돌려보내기';
        const run = () => { if (confirmAction === 'confirm') void savePlan('CONFIRMED'); else if (confirmAction === 'cancel') void cancelPlan(); else void returnToOrders(); };
        return <div>
          {confirmAction === 'confirm' && chosenPlan && <>
            <div className={classes.confirmHead}>
              <span className={badge('red')}>{chosenPlan.id}안</span>
              <strong>{raw?.itemname} {fmt(raw?.thickness, 3)}T × {fmt(raw?.raw_width)}{material === 'SHEET' ? ` × ${fmt(raw?.raw_length)}` : ' × C'}</strong>
              <span className={classes.confirmMeta}>{raw?.label}{raw?.warehouse ? ` · ${raw.warehouse}` : ''} · 품목 {groupRows.length}건</span>
            </div>
            <div className={classes.confirmStats}>
              <div><span>투입</span><b>{fmt(chosenPlan.input_weight)}<small>kg</small></b></div>
              <div><span>생산</span><b>{fmt(chosenPlan.production_weight)}<small>kg</small></b></div>
              <div><span>손실</span><b>{fmt(chosenPlan.loss_weight)}<small>kg</small></b></div>
              <div className={classes.confirmYield}><span>수율</span><b>{fmt(chosenPlan.yield_rate, 2)}<small>%</small></b></div>
            </div>
            {(shortPieces.length > 0 || issues.length > 0) && <div className={classes.confirmWarn}>
              <strong>확인이 필요합니다</strong>
              <ul>
                {shortPieces.length > 0 && <li>주문 대비 {fmt(shortTotal)}{unit} 부족합니다. 부족분은 별도 계획이 필요합니다.</li>}
                {issues.map((issue) => <li key={issue}>{issue}</li>)}
              </ul>
            </div>}
            <ul className={classes.confirmNotes}>
              <li>담은 품목이 <b>계획확정</b>으로 바뀌고, 주문서 관리에서 되돌릴 수 없습니다.</li>
              {raw?.kind === 'STOCK' && <li>선택한 현재고 원자재가 이 계획에 배정되어 다른 계획에서 쓸 수 없습니다.</li>}
              <li>확정 후 변경이 필요하면 [계획 취소] 후 다시 계획합니다.</li>
            </ul>
          </>}
          {confirmAction === 'cancel' && <>
            <div className={classes.confirmHead}>
              <span className={badge(editingDraft ? 'blue' : 'orange')}>{editingDraft ? '임시저장' : '계획확정'}</span>
              <strong>{activePlan?.planno}</strong>
              <span className={classes.confirmMeta}>품목 {groupRows.length}건</span>
            </div>
            <ul className={classes.confirmNotes}>
              {editingDraft ? <li>임시저장한 계획을 삭제합니다. 품목은 <b>최적화 대기</b> 그대로입니다.</li>
                : <><li>품목이 <b>최적화 대기</b>로 돌아갑니다.</li><li>배정된 원자재가 해제되어 다시 쓸 수 있습니다.</li></>}
              <li>담은 품목과 조건은 화면에 그대로 남아 바로 다시 계획할 수 있습니다.</li>
            </ul>
          </>}
          {confirmAction === 'return' && <>
            <div className={classes.confirmHead}>
              <strong>선택 품목 {groupRows.length}건</strong>
              <span className={classes.confirmMeta}>{[...new Set(groupRows.map((row) => row.orderid))].join(', ')}</span>
            </div>
            <ul className={classes.confirmNotes}>
              <li>품목이 <b>미전송</b>으로 바뀌어 가공 최적화 대기 목록에서 빠집니다.</li>
              <li>주문서 관리에서 수정한 뒤 다시 보낼 수 있습니다.</li>
            </ul>
          </>}
          <div className={m.mModalFooter}>
            <button type="button" className={btn('btnLine')} onClick={() => setConfirmAction(null)} disabled={saving}>취소</button>
            <button type="button" className={btn(confirmAction === 'confirm' ? 'btnPrimary' : 'btnDark')} disabled={saving} onClick={run}>{saving ? '처리 중…' : actionLabel}</button>
          </div>
        </div>;
      })()}
    </Modal>

    <Modal opened={Boolean(editLine)} onClose={() => !saving && setEditLine(null)} centered size="sm" className={classes.optScope} classNames={MODAL_LOOK} title={`품목 값 보완${editLine ? ` · ${editLine.row.orderid}-${editLine.row.lineno}` : ''}`}>
      {editLine && <Stack gap="sm">
        <p className={m.mModalText}>빠진 값: {editLine.row.missing.join(', ')}. 코일은 중량, 시트(길이 있음)는 수량이 필요합니다.</p>
        {[['thickness', '두께 (mm)'], ['width', '폭 (mm)'], ['length', '길이 (mm, 코일은 비움)'], ['quantity', '수량'], ['weight_kg', '중량 (kg)']].map(([key, label]) => <NumberInput key={key} label={label} hideControls min={0} classNames={{ input: m.mInput, label: m.mLabel }}
          value={editLine.values[key]} onChange={(value) => setEditLine((current) => ({ ...current, values: { ...current.values, [key]: value } }))} />)}
        <div className={m.mModalFooter}><button type="button" className={btn('btnLine')} onClick={() => setEditLine(null)} disabled={saving}>취소</button><button type="button" className={btn('btnPrimary')} disabled={saving} onClick={() => void saveLineValues()}>{saving ? '저장 중…' : '저장'}</button></div>
      </Stack>}
    </Modal>
  </Box>;
}
