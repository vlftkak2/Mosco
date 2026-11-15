// 가공 최적화 (메뉴: AI_OPTIMIZATION)
// 주문서 관리에서 보낸 "최적화 대기" 품목 → ① 발주·원자재 확인 → ② 원자재 후보 → ③ 원자재·가공방식 → ④ 추천조합
// → 임시저장 / 계획 확정 (품목 계획확정, 원자재 현재고 예약) / 계획 취소 / 주문서 관리로 돌려보내기.
// 계산은 서버(backend/services/ai/AIOrderOptimization.py)에서 하고 화면은 결과를 보여준다.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import m from '../../styles/pages/AIOrderManage.module.css';
import { HistoryModal } from './AIOrderOptimizationHistory';
import PickerModal, { ColumnResizeHandle, PickerEmpty as SharedPickerEmpty, pickerClasses, useResizableColumns } from '../../components/common/PickerModal';

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
// 가공 최적화 사용 안내 (서버 계산 규칙 기준: AIOrderOptimization.py)
const OPT_GUIDE = [
  { step: '0', title: '대기 품목 담기', desc: '계획할 주문 품목을 고릅니다.',
    lines: [<>주문서 관리에서 보낸 품목이 <b>[대기 품목]</b>에 모입니다. 같은 창고 · 품명 · 두께(시트는 폭까지)끼리 함께 담을 수 있어요.</>,
      <>선가공재고가 연결된 품목은 <b>필요 = 발주 − 선가공</b>만큼만 계산합니다.</>,
      <>이어서 작업하려면 <b>[계획 불러오기]</b>에서 임시저장한 계획을 여세요.</>] },
  { step: '1', title: '원자재 후보 추천', desc: '잘라 쓸 원자재를 고릅니다.',
    lines: [<><b>연결 원자재 → 현재고 → 신규(매입이력 · 직접 입력)</b> 순으로, 같은 구분 안에서는 수율이 높은 순으로 상위 5개를 보여 줍니다.</>,
      <>다른 확정 계획이 쓰고 있는 현재고는 <b>남은 중량</b>만 보입니다.</>] },
  { step: '2', title: '원자재 · 가공방식', desc: '얼마나, 몇 번에 나눠 자를지 정합니다.',
    lines: [<><b>원샷</b> 한 번에 전부 · <b>등분</b> 무게를 나눠 여러 차수로 · <b>일부가공</b> 일부만 자르고 나머지는 보관</>,
      <>현재고 원자재의 폭 · 중량은 실물 값이라 바꿀 수 없어요(회색 칸). 가공할 양은 가공방식으로 정합니다.</>,
      '기본 로스(mm)는 원코일 양쪽 끝에서 버리는 폭입니다.'] },
  { step: '3', title: '가공 추천조합', desc: '칼 배치 안을 비교해 고릅니다.',
    lines: [<><b>단독</b> 한 번에 한 가지 폭 · <b>혼합</b> 여러 폭을 함께. 폭이 다른 품목을 원샷 · 일부가공으로 단독 가공할 수는 없어요.</>,
      <>추천 순서: 주문을 모두 채우는 안 → 부족 · 초과량과 로스가 적은 안 → 수율이 높은 안. 가장 좋은 안에 <b>추천</b>이 붙습니다.</>,
      <>[과거 가공이력]에서 예전 칼 배치를 반영하거나, 가공매출이력 · 직접 입력으로 함께 만들 폭을 더할 수 있어요.</>] },
  { step: 'kg', title: '투입 · 생산 · 로스 · 수율 계산', desc: '재고가공등록과 같은 kg 정수로 보여 줍니다.',
    lines: [<><b>투입</b> = 차수별 가공중량의 합 (원샷은 원코일 전체, 일부가공은 입력한 가공중량)</>,
      <><b>생산</b> = 투입 × 사용폭 ÷ 원코일 폭 (차수마다 kg 반올림) · 사용폭 = 제품 폭 × 칼수의 합</>,
      <><b>로스</b> = 투입 − 생산 (기본 로스와 잔여폭에 해당하는 무게)</>,
      <><b>수율</b> = 생산 ÷ 투입 × 100</>,
      <>폭별 · 칼별 중량은 폭 비율로 kg 단위로 나누고, 같은 폭에서 남는 kg는 첫 줄에 더합니다. 이론값이며 실중량은 매출에서 조정합니다.</>] },
  { step: '✓', title: '저장 · 확정 · 가공등록', desc: '계획을 남기고 실제 가공으로 넘깁니다.',
    lines: [<><b>[임시저장]</b> 품목 상태는 그대로, 언제든 다시 열어 수정할 수 있어요.</>,
      <><b>[계획 확정]</b> 품목은 계획확정, 현재고 원자재는 가공중량만큼 이 계획에 예약됩니다.</>,
      <><b>[재고가공등록으로 이동]</b> 계획이 그대로 채워진 가공전표가 열립니다. 가공처를 고르고 저장하면 원자재 차감 · 가공품 입고가 되고, 계획과 품목이 <b>가공완료</b>가 됩니다.</>,
      <><b>[계획 취소]</b> 품목은 최적화 대기로, 원자재 예약은 해제됩니다(담은 품목과 조건은 화면에 남아요). 가공등록이 끝난 계획은 가공전표를 먼저 삭제해야 취소할 수 있어요.</>,
      <><b>[돌려보내기]</b> 품목을 주문서 관리(미전송)로 돌려 수정할 수 있게 합니다.</>] },
];
function OptimizationGuideModal({ opened, onClose }) {
  return <Modal opened={opened} onClose={onClose} centered size={640} className={classes.optScope} classNames={MODAL_LOOK} title="가공 최적화 사용 안내">
    <div className={m.guideFlow}>대기 품목 <i>→</i> ① 원자재 <i>→</i> ② 가공방식 <i>→</i> ③ 조합 <i>→</i> 계획 확정 <i>→</i> 재고가공등록</div>
    {OPT_GUIDE.map((item) => <div key={item.title} className={m.guideItem}>
      <div className={m.guideHead}><span className={m.guideStep}>{item.step}</span><span>{item.title} <em>- {item.desc}</em></span></div>
      <ul className={m.guideBox}>{item.lines.map((line, index) => <li key={index}>{line}</li>)}</ul>
    </div>)}
    <div className={m.guideItem}>
      <div className={m.guideHead}><span className={m.guideStep}>!</span><span>함께 계산하는 조건</span></div>
      <ul className={m.guideBox}>
        <li>같은 <b>창고 · 소재(코일/시트) · 품명 · 두께</b>의 품목만 함께 담을 수 있습니다. 시트는 폭도 같아야 합니다.</li>
        <li>다른 창고 품목은 <b>[현재 작업 비우기]</b> 후 따로 계획합니다.</li>
      </ul>
    </div>
    <div className={m.mModalFooter}><button type="button" className={btn('btnLine')} onClick={onClose}>닫기</button></div>
  </Modal>;
}
// ② 매입 후보 추가의 기본규격 (기준정보 연동 전 임시값, 시안 v10)
const STANDARD_COIL_WIDTHS = ['810', '914', '1000', '1219', '1250'];
const STANDARD_SHEET_SIZES = ['1219x2438', '1524x3048', '1000x2000'];
const MATERIAL_TABS = [{ value: 'COIL', label: '코일·스켈프' }, { value: 'SHEET', label: '시트·판재' }];
// 상태 배지 · 버튼 모양은 가공주문관리와 같은 것을 쓴다 (표시만, 동작은 그대로)
const badge = (tone) => `${m.status} ${m[`status_${tone || 'gray'}`] || m.status_gray}`;
const btn = (...kinds) => [m.btn, ...kinds.map((kind) => m[kind])].join(' ');
const STOCK_LOCK_TIP = '현재고 값입니다. 바꾸려면 재고를 수정해 주세요. 가공할 양은 가공방식(일부가공 · 등분)으로 정합니다.';
const MODAL_LOOK = { content: m.mModalContent, header: m.mModalHeader, title: m.mModalTitle, body: m.mModalBody };
const PLAN_STATUS = { DRAFT: { label: '임시저장', tone: 'blue' }, CONFIRMED: { label: '계획확정', tone: 'green' }, CANCELLED: { label: '취소', tone: '' }, DONE: { label: '가공완료', tone: 'green' } };
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
  SHEET: {
    input: '원판 1매 중량 × 필요 원판 매수',
    production: 'Σ(절단제품 면적 × 생산수량) × 두께 × 7.85',
    loss: '투입중량 − 생산중량',
    yield: '(제품 면적 ÷ 원판 면적) × 100',
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
  { key: 'warehouse', label: '창고', width: 100, minWidth: 60 },
  { key: 'order', label: '주문번호', width: 150, minWidth: 100 },
  { key: 'status', label: '상태', width: 100, minWidth: 64 },   // [대기] [빼기] 한 줄. [확인 필요][수정][빼기]는 줄바꿈
  { key: 'duedate', label: '납기일', width: 96, minWidth: 80 },
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
  return <>{runs.map((run, index) => <div key={index}>
    <div className={classes.rowTitle}>{run.label || (runs.length > 1 ? `${index + 1}차 가공` : '가공')} · 투입 {fmt(run.weight)}kg</div>
    <div className={classes.coilBar} role="img" aria-label={`${run.pieces.map((piece) => `${piece.width}×${piece.cuts}`).join(', ')} 배치`}>
      {run.pieces.flatMap((piece) => Array.from({ length: piece.cuts }, (_, n) => (
        <span key={`${piece.width}-${n}`} className={`${classes.piece} ${toneOf(piece.width)}`} style={{ flex: piece.width }} title={`${fmt(piece.width)}mm`}>{fmt(piece.width)}</span>
      )))}
      {run.remain > 0.001 && <span className={`${classes.piece} ${classes.loss}`} style={{ flex: run.remain }} title={`기본 로스 ${fmt(run.trim)}mm + 잔여폭 ${fmt(run.spare)}mm`} />}
    </div>
    <div className={classes.subMetric}><span>사용폭 {fmt(run.used)}mm · {run.pieces.reduce((sum, piece) => sum + piece.cuts, 0)}칼</span><span>원코일 {fmt(rawWidth)}mm</span><span>{run.trim > 0 ? `기본 로스 ${fmt(run.trim)}mm · ` : ''}잔여폭 {fmt(run.spare)}mm</span></div>
  </div>)}</>;
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

// ④ 오른쪽 결과: 투입 = 생산 + 로스 띠 + 폭(길이)별 생산 표. 예전에 저장된 계획(과부족 값 없음)도 그대로 보인다.
const PlanResult = memo(function PlanResult({ plan, material, notes }) {
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
      <div className={classes.flow}><span><small>투입</small><b>{fmt(plan.input_weight)}kg</b></span><span><small>생산</small><b>{fmt(production, digits ? 1 : 0)}kg</b></span>
        <span><small>로스</small><b>{fmt(lossTotal, digits ? 1 : 0)}kg</b></span><span><small>수율</small><b>{fmt(plan.yield_rate, 2)}%</b></span></div>
      <div className={classes.resultTitle}>폭별 생산중량{multi ? <small>{runs.map(runLabel).join(' + ')} 합계 · 재고가공등록과 같은 kg 배부</small> : <small>재고가공등록과 같은 kg 배부</small>}</div>
      <div className={classes.resultScroll}><table className={`${classes.resultTable} ${multi ? classes.resultTableRuns : ''}`}>
        <thead><tr><th>제품폭</th><th>주문</th><th>칼수</th><th>칼당</th>
          {multi && runs.map((run, index) => <th key={index} title={`${runLabel(run, index)} 투입 ${fmt(run.weight)}kg`}>{runLabel(run, index)}</th>)}
          <th>{multi ? '합계' : '생산중량'}</th><th title="차수 로스를 폭별 생산 비율로 나눈 값 (재고가공등록 로스 배부와 같음)">로스</th><th>과부족</th></tr></thead>
        <tbody>{plan.pieces.map((piece) => {
          const count = piece.knives ?? piece.cuts;
          const produced = hasInt ? piece.int_produced : piece.produced_weight;
          const loss = hasInt ? piece.int_loss
            : (plan.production_weight > 0 ? (plan.loss_weight || 0) * (piece.produced_weight || 0) / plan.production_weight : 0);
          const cut = count ? perCut(piece) : { text: '–', title: '' };
          const deltaPiece = hasInt && piece.int_delta !== null && piece.int_delta !== undefined ? { ...piece, delta: piece.int_delta } : piece;
          return <tr key={piece.width}>
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
  const orderPieces = plan.pieces.filter((piece) => !piece.extra);
  const producedTotal = plan.pieces.reduce((sum, piece) => sum + (piece.produced_qty || 0), 0);
  const needTotal = orderPieces.reduce((sum, piece) => sum + (piece.need_qty || 0), 0);
  const deltaTotal = orderPieces.reduce((sum, piece) => sum + (piece.produced_qty - piece.need_qty), 0);
  return <div className={classes.result}>
    <div className={classes.flow}><span><small>투입 · 원판 {fmt(plan.sheets, 0)}매</small><b>{fmt(plan.input_weight, 2)}kg</b></span><span><small>생산 · {fmt(producedTotal, 0)}매</small><b>{fmt(plan.production_weight, 2)}kg</b></span>
      <span><small>로스</small><b>{fmt(plan.loss_weight, 2)}kg</b></span><span><small>수율</small><b>{fmt(plan.yield_rate, 2)}%</b></span></div>
    <div className={classes.resultTitle}>품목별 생산 <small>제품폭 {fmt(plan.pieces[0]?.width)}mm</small></div>
    <table className={classes.resultTable}>
      <thead><tr><th>제품 길이</th><th>발주</th><th>생산</th><th>과부족</th></tr></thead>
      <tbody>{plan.pieces.map((piece) => <tr key={`${piece.length}-${piece.lineno ?? 'x'}`}>
        <td>{fmt(piece.length)}mm{piece.extra ? <span className={classes.tag}>후보</span> : null}</td>
        <td>{piece.extra ? '가공 후보' : `${fmt(piece.need_qty, 0)}매`}</td><td>{fmt(piece.produced_qty, 0)}매</td>
        <td>{piece.extra ? <span className={classes.muted}>후보 생산</span> : piece.over_qty > 0 ? <span className={classes.over}>▲ {fmt(piece.over_qty, 0)}매 초과</span>
          : piece.over_qty < 0 ? <span className={classes.under}>▼ {fmt(-piece.over_qty, 0)}매 부족</span> : <span className={classes.ok}>일치</span>}</td>
      </tr>)}</tbody>
      <tfoot><tr><td>합계</td><td>{fmt(needTotal, 0)}매</td><td>{fmt(producedTotal, 0)}매</td><td>{deltaTotal > 0 ? <span className={classes.over}>▲ {fmt(deltaTotal, 0)}매</span> : deltaTotal < 0 ? <span className={classes.under}>▼ {fmt(-deltaTotal, 0)}매</span> : null}</td></tr></tfoot>
    </table>
    {(notes || []).map((note) => <div key={note} className={classes.warn}>{note}</div>)}
    <p className={classes.estimate}>※ 원판 폭×길이 비율로 계산한 이론값입니다. 절단날 간격·가공여유·설비제약은 빼고 계산하며, 원판마다 같은 패턴을 반복합니다.</p>
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
    setPlanId('A');
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
  const [planId, setPlanId] = useState('A');
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
  const queuePickerColumnsDef = useMemo(() => [...QUEUE_PICKER_COLUMNS, ...TARGET_COLUMNS.filter((column) => !column.sheetOnly || material === 'SHEET')], [material]);
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
          const inPlans = orderRows.filter((row) => planOf(row)).map((row) => ({ row, reason: `${planLabel(planOf(row))} 계획에 포함` }));
          setOrderGroups({ orderid, groups: grouped?.groups || [], excluded: [...(grouped?.excluded || []), ...inPlans] });
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

  const resetWork = () => { setSelectedKeys([]); setGroupOff([]); setSettings(DEFAULT_SETTINGS); setActivePlan(null); setPlanId('A'); };
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
      setPlanId(pattern.plan?.id || 'A');
    } catch (error) {
      notifications.show({ title: '계획 조회 실패', message: errorText(error, '계획을 불러오지 못했습니다.'), color: 'red' });
    }
  };

  const savePlan = async (status) => {
    if (!groupKeys.length || !chosenPlan || saving) return;
    setSaving(true);
    try {
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
  const addNewCandidate = () => {
    const width = Number(newWidth);
    if (!(width > 0)) { notifications.show({ title: '후보 추가', message: '원자재 폭을 입력하거나 기본규격을 골라 주세요.', color: 'orange' }); return; }
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
    setPlanId('A');
  };
  // 이력 창에서 여러 건 선택 → 한 번에 반영
  const applyHistory = (rows) => {
    const list = Array.isArray(rows) ? rows : [rows];
    if (!list.length) return;
    if (historyKind === 'purchase') {
      // 매입이력: 각 규격을 ② 후보로 추가하고 첫 번째를 선택
      const added = list.map((row) => (material === 'COIL'
        ? { width: row.width, weight: row.weight || null, source: `매입이력 ${row.id}` }
        : { width: row.width, length: row.length, source: `매입이력 ${row.id}` }));
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
    setPlanId('A');
  };
  const removeRef = (kind, value) => {
    if (kind === 'width') updateSettings({ extrawidths: (settings.extrawidths || []).filter((item) => item !== value) });
    else if (kind === 'length') updateSettings({ extralengths: (settings.extralengths || []).filter((item) => item !== value) });
    else updateSettings({ history_patterns: historyPatterns.filter((item) => item.source !== value), history_pattern: undefined });
    setPlanId('A');
  };

  // ---------------- 화면 조각 ----------------
  const targetColumns = TARGET_COLUMNS.filter((column) => !column.sheetOnly || material === 'SHEET');
  const targetTableWidth = targetColumns.reduce((sum, column) => sum + targetWidths.widthOf(column), 0);
  const targetTableStyle = { width: `max(100%, ${targetTableWidth}px)`, minWidth: `${targetTableWidth}px` };
  // 최적화 대상 표: 맨 앞에 가공그룹 '계산' 체크 열을 따로 둔다 (불러오기 창은 그대로)
  const mainTargetColumns = [{ key: 'group', label: '계산', width: 46, minWidth: 40, align: 'center' }, ...targetColumns];
  const targetHead = (first) => <ResizableHead columns={targetColumns} {...targetWidths}
    labelOf={(column) => (column.key === 'mark' ? first : column.unit ? `${column.label}(${unit})` : column.label)} />;
  const candidateColumns = CANDIDATE_COLUMNS.filter((column) => !column.sheetOnly || material === 'SHEET');
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
  const pickerModal = <PickerModal opened={pickerOpen} onClose={() => setPickerOpen(false)}
    title="대기 품목" badge={materialBadge} description="주문서 관리에서 보낸 대기 품목을 선택해 최적화 대상에 담습니다." icon={<IconListCheck size={22} stroke={1.7} />}
    filters={<>
      <TextInput size="sm" label="발주처" placeholder="발주처명 검색" leftSection={<IconSearch size={14} />} value={pickerFilter.buyer} onChange={(event) => { const { value } = event.currentTarget; setPickerFilter((current) => ({ ...current, buyer: value })); setPickerPage(1); }} />
      <TextInput size="sm" label="품명" placeholder="품명 검색" value={pickerFilter.itemname} onChange={(event) => { const { value } = event.currentTarget; setPickerFilter((current) => ({ ...current, itemname: value })); setPickerPage(1); }} />
      <TextInput size="sm" label="두께 (mm)" placeholder="예: 1.2" style={{ width: 120 }} value={pickerFilter.thickness} onChange={(event) => { const { value } = event.currentTarget; setPickerFilter((current) => ({ ...current, thickness: value })); setPickerPage(1); }} />
      <Button size="sm" variant="default" onClick={() => { setPickerFilter({ buyer: '', itemname: '', thickness: '' }); setPickerPage(1); }}>초기화</Button>
    </>}
    guide={<>
      <p>같은 창고·품명·두께{material === 'SHEET' ? '·폭' : ''}의 품목을 함께 담을 수 있습니다. 첫 품목이 기준이 됩니다.</p>
      {/* 선택 전에도 같은 줄을 그려 두어 첫 선택 때 안내 상자 높이가 바뀌지 않게 한다 */}
      <div className={pickerClasses.criteria}>
        <span className={pickerBase ? undefined : pickerClasses.criteriaEmpty}><b>기준 품목</b>{pickerBase ? `${pickerBase.itemname} ${fmt(pickerBase.thickness, 3)}T${material === 'SHEET' ? ` × ${fmt(pickerBase.width)}mm` : ''}` : '품목을 선택하면 표시됩니다'}</span>
        <span className={pickerBase ? undefined : pickerClasses.criteriaEmpty}><b>연결 창고</b>{pickerBase ? (pickerWarehouses.length ? queue.flatMap((row) => row.warehouses || []).find((item) => item.code === pickerWarehouses[0])?.name || pickerWarehouses[0] : '연결 재고 없음') : '-'}</span>
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
          <td className={pickerClasses.center}>{pickerBase && keyOf(pickerBase) === key ? <span className={badge('orange')}>기준</span> : ''}</td>
          {lineCells(row, <td>{reason ? <span className={badge(planOf(row) ? 'blue' : undefined)} title={reason}>{planOf(row) ? planLabel(planOf(row)) : '함께 선택 불가'}</span> : row.missing?.length ? <span className={badge('orange')} title={`빠진 값: ${row.missing.join(', ')}`}>확인 필요</span> : picked ? <span className={badge('red')}>선택됨</span> : <span className={badge()}>대기</span>}</td>)}
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
  const planPickerModal = <PickerModal opened={planPickerOpen} onClose={() => setPlanPickerOpen(false)}
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
  // 확정된 현재고 코일 계획 → 재고가공등록에서 차수별로 불러와 등록
  const canGoProcess = activePlan?.status === 'CONFIRMED' && confirmedDetail?.header.rawkind === 'STOCK' && confirmedDetail?.header.materialtype === 'COIL';
  // 이력 창 · 가공 후보 창이 적합 여부를 판단하는 현재 값 (③ 입력값 우선)
  const baseRow = groupRows[0] || null;
  // 현재고(연결 포함) 원자재는 폭 · 중량(원판은 폭 · 길이)이 실물 값이라 수정 불가. 가공할 양은 가공방식(일부가공 · 등분)으로 정한다
  const rawLocked = raw?.kind === 'STOCK';
  const historyContext = useMemo(() => ({
    itemname: baseRow?.itemname || '', thickness: baseRow?.thickness, itemWidth: baseRow?.width,
    rawWidth: Number(rawLocked ? raw?.raw_width : settings.raw_width ?? raw?.raw_width) || 0, rawLength: Number(rawLocked ? raw?.raw_length : settings.raw_length ?? raw?.raw_length) || 0,
    trim: Number(settings.trimloss) || 0, orientation: settings.orientation,
    lengths: [...groupRows.map((row) => row.length), ...(settings.extralengths || [])],
    orderValues: groupRows.map((row) => (material === 'COIL' ? row.width : row.length)),
    extraValues: material === 'COIL' ? settings.extrawidths || [] : settings.extralengths || [],
  }), [baseRow, groupRows, settings, raw, material, rawLocked]);
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
    setPlanId('A');
  };
  const processWeight = Number(rawLocked ? raw?.raw_weight : settings.raw_weight ?? raw?.raw_weight) || 0;
  const targetTable = <div className={`${reg.tableScroll} ${classes.tableScroll}`}>
    <table className={`${reg.ordersTable} ${classes.table}`} style={{ width: `max(100%, ${targetTableWidth + 46}px)`, minWidth: `${targetTableWidth + 46}px` }}>
      <ResizableHead columns={mainTargetColumns} {...targetWidths}
        labelOf={(column) => (column.key === 'mark' ? '구분' : column.unit ? `${column.label}(${unit})` : column.label)} />
      <tbody>{selectedRows.length ? selectedRows.map((row, index) => {
        const key = keyOf(row);
        const inGroup = !groupOff.includes(key);
        return <tr key={key} className={inGroup ? '' : classes.groupOffRow}>
          <td className={classes.center}><input type="checkbox" className={classes.pickerCheckbox} checked={inGroup} disabled={Boolean(activePlan)} onChange={() => toggleGroup(key)}
            aria-label={`${row.orderid}-${row.lineno} 가공그룹 포함`} title="체크를 풀면 계산 · 저장에서 빠집니다 (작업 목록에는 남음)" /></td>
          <td className={classes.center}>{index === 0 ? <span className={badge('orange')}>기준</span> : index + 1}</td>
          {lineCells(row, <td>{row.missing?.length
            ? <><span className={badge('orange')} title={`빠진 값: ${row.missing.join(', ')}`}>확인 필요</span>
              <button type="button" className={`${m.rowMatchButton} ${m.small}`} style={{ marginLeft: 6 }} onClick={() => setEditLine({ row, values: { thickness: row.thickness ?? '', width: row.width ?? '', length: row.length ?? '', quantity: row.quantity ?? '', weight_kg: row.weight ?? '' } })}>수정</button></>
            : row.optimize_status === 'PLANNED' ? <span className={badge('green')}>계획확정</span>
              : row.optimize_status === 'DONE' ? <span className={badge('green')}>가공완료</span>
              : inGroup ? <span className={badge()}>대기</span> : <span className={badge()}>그룹 제외</span>}
            {!activePlan && <button type="button" className={m.rowGrayButton} style={{ marginLeft: 6 }} onClick={() => removeRow(key)}>빼기</button>}</td>)}
        </tr>;
      }) : <tr><td colSpan={mainTargetColumns.length} className={classes.empty}>{loading ? '대기 품목을 불러오는 중입니다.'
        : materialQueue.length ? '[대기 품목]에서 최적화할 품목을 담아 주세요.' : '최적화 대기 품목이 없습니다. 주문서 관리에서 [가공 최적화로 보내기]를 해 주세요.'}</td></tr>}</tbody>
    </table>
  </div>;

  return <Box className={`${simpleTheme.simple} ${sharedClasses.pageShell} ${reg.page} ${classes.optScope}`}>
    <Box component="nav" aria-label="현재 위치" className={inboundClasses.pageBreadcrumb}>
      <Group className={inboundClasses.breadcrumbTrail} gap={7}>
        <Text component="span" className={inboundClasses.breadcrumbParent}>AI가공솔루션</Text>
        <Text component="span" className={inboundClasses.breadcrumbChevron}>›</Text>
        <Text component="span" className={inboundClasses.breadcrumbCurrent}>가공최적화</Text>
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
            {activePlan && <span className={badge(PLAN_STATUS[activePlan.status]?.tone)}>{activePlan.planno} · {PLAN_STATUS[activePlan.status]?.label}</span>}
            <button type="button" className={m.guideTrigger} onClick={() => setGuideOpen(true)}><IconHelpCircle size={15} stroke={2} />사용 안내</button>
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
          {material === 'COIL'
            ? <CoilViz plan={confirmedDetail.header.pattern?.plan} rawWidth={confirmedDetail.header.width} />
            : <SheetViz plan={confirmedDetail.header.pattern?.plan} rawWidth={confirmedDetail.header.width} rawLength={confirmedDetail.header.length} />}
          <PlanResult plan={confirmedDetail.header.pattern?.plan} material={material} />
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
              <span className={`${classes.muted} ${classes.toolsNote}`}>연결 원자재 → 현재고 → 신규(매입이력·직접 입력) 순, 수율 높은 순</span>
            </div>
            {shownAnalysis?.candidates?.length ? <div className={`${reg.tableScroll} ${classes.candidateScroll}`}><table className={`${reg.ordersTable} ${classes.candidateTable}`} style={{ width: `max(100%, ${candidateTableWidth}px)`, minWidth: `${candidateTableWidth}px` }}>
              <ResizableHead columns={candidateColumns} {...candidateWidths}
                labelOf={(column) => (column.key === 'stock' ? (material === 'COIL' ? '중량(재고)' : '수량(재고)')
                  : column.info ? <>{column.label}<Info text={FORMULAS[material][column.info]} /></> : column.label)} />
              <tbody>{shownAnalysis.candidates.map((c) => <tr key={c.id} className={(settings.raw_id ?? raw?.id) === c.id ? reg.selectedRow : ''} onClick={() => { if ((settings.raw_id ?? raw?.id) !== c.id) chooseRaw(c.id); }}>
                <td>{c.rank}순위</td><td title={c.source || ''}>{c.label}</td><td>{c.itemname}</td>
                <td>{fmt(c.thickness, 3)} × {fmt(c.width)}{material === 'SHEET' ? ` × ${fmt(c.length)}` : ' × C'}</td>
                <td>{c.kind === 'STOCK' ? c.warehouse : '–'}</td>
                <td>{c.kind === 'STOCK' ? (material === 'COIL' ? `${fmt(c.weight)}kg` : `${fmt(c.qty, 0)}매`) : '신규'}</td>
                {c.input_weight === null || c.input_weight === undefined
                  ? <><td><span className={classes.shortTag} title="발주 폭을 배치할 수 없거나, 목표 중량이 없는 '나머지' 품목뿐이라 투입중량을 정할 수 없습니다">{c.placeable === false && c.kind === 'NEW' ? '중량 입력' : '배치 불가'}</span></td><td>–</td><td>–</td><td>–</td></>
                  : <><td>{fmt(c.input_weight)}kg{c.weight_tag ? <small className={classes.estTag} title={c.weight_tag === '필요' ? '발주 필요중량을 모두 채우는 최소 투입중량(계산값)' : '매입이력·직접 입력한 계산용 가정 중량'}>{c.weight_tag}</small> : null}</td>
                    <td>{fmt(c.production_weight)}kg</td><td>{fmt(c.loss_weight)}kg</td><td><b>{fmt(c.yield_rate, 2)}%</b></td></>}
                {material === 'SHEET' && <td>{fmt(c.sheets, 0)}매{c.short_sheets > 0 ? <span className={classes.under}>부족 {c.short_sheets}</span> : null}</td>}
              </tr>)}</tbody>
            </table></div> : <div className={classes.empty}>{analyzing ? '후보를 찾는 중입니다.' : '후보가 없습니다. 원자재 규격을 직접 입력해 후보를 추가해 주세요.'}</div>}
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
                      합계 {fmt(splitTotal)}kg / 가공중량 {fmt(processWeight)}kg{balanced ? '' : ' · 합계를 맞춰 주세요'}
                    </span>
                  </div>
                  <div className={classes.runs}>
                    {splits.map((weight, index, list) => <NumberInput key={index} size="xs" label={`${index + 1}차 가공중량 (kg)`} value={weight} hideControls thousandSeparator=","
                      onChange={(value) => typeSettings({ splitweights: list.map((item, i) => (i === index ? Number(value) || 0 : item)) })} />)}
                    <div className={classes.splitActions}>
                      <button type="button" className={btn('btnSoftBlue', 'btnSm')} onClick={() => updateSettings({ splitweights: [...splits, 0] })}>+ 등분 추가</button>
                      {splits.length > 2 && <button type="button" className={btn('btnSoftGray', 'btnSm')} onClick={() => updateSettings({ splitweights: splits.slice(0, -1) })}>− 마지막 등분 빼기</button>}
                    </div>
                  </div>
                </div>;
              })()}
            </> : <div className={classes.fields}>
              {rawLocked ? <>
                <TextInput label="원판 폭 (mm)" value={fmt(raw.raw_width)} readOnly title={STOCK_LOCK_TIP} />
                <TextInput label="원판 길이 (mm)" value={fmt(raw.raw_length)} readOnly title={STOCK_LOCK_TIP} />
              </> : <>
                <NumberInput label="원판 폭 (mm)" value={settings.raw_width ?? raw.raw_width} onChange={(value) => typeSettings({ raw_width: value === '' ? undefined : value })} hideControls min={1} />
                <NumberInput label="원판 길이 (mm)" value={settings.raw_length ?? raw.raw_length} onChange={(value) => typeSettings({ raw_length: value === '' ? undefined : value })} hideControls min={1} />
              </>}
              <TextInput label="원판 두께 (mm)" value={fmt(raw.thickness, 3)} readOnly />
              <TextInput label="원판 재고 (매)" value={raw.raw_sheets === null || raw.raw_sheets === undefined ? '신규' : fmt(raw.raw_sheets, 0)} readOnly />
              <Select label="절단방향" value={settings.orientation} allowDeselect={false} onChange={(value) => updateSettings({ orientation: value })}
                data={[{ value: 'NORMAL', label: '기본' }, { value: 'ROTATED', label: '90도 회전' }]} />
            </div> : <div className={classes.empty}>① 에서 원자재 후보를 선택해 주세요.</div>}
            {shownAnalysis?.warnings?.map((warning) => <div key={warning} className={classes.warn}>{warning}</div>)}
          </Card>

          <Card number="3" title="가공 추천조합" bodyClass={classes.recommendBody}
            actions={historyButtons('processing')}>
            <div className={classes.box}>
              <div className={classes.methodRow}>
                <SegmentedControl size="xs" color="red" value={settings.combo} onChange={(value) => { updateSettings({ combo: value }); setPlanId('A'); }}
                  data={material === 'COIL' ? [{ value: 'SINGLE', label: '단독' }, { value: 'MIXED', label: '혼합' }] : [{ value: 'SINGLE', label: '단독절단' }, { value: 'MIXED', label: '혼합절단' }]} />
                <span className={classes.muted}>{material === 'COIL' ? '주문 충족 → 부족·초과량 + 로스 → 수율 순' : '모든 원판에 선택 품목을 1개 이상 · 같은 패턴 반복'}</span>
              </div>
              {refs.length > 0 && <div className={classes.refs}>{refs.map((ref) => <span key={`${ref.kind}-${ref.value}`} className={classes.ref}>{ref.label}
                <button type="button" aria-label={`${ref.label} 해제`} title="참고 해제" onClick={() => removeRef(ref.kind, ref.value)}>×</button></span>)}</div>}
              <div className={classes.plans}>{plansList.length ? plansList.map((plan) => <button key={plan.id} type="button" className={`${classes.plan} ${chosenPlan?.id === plan.id ? classes.planSelected : ''}`} onClick={() => setPlanId(plan.id)}>
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
              </button>) : !analyzing && shownAnalysis?.no_combo
                ? <div className={classes.noCombo}><strong>{shownAnalysis.no_combo.title}</strong><span>{shownAnalysis.no_combo.desc}</span></div>
                : <div className={classes.empty}>{analyzing ? '조합을 계산하는 중입니다.' : '추천 가능한 조합이 없습니다.'}</div>}</div>
              {(shownAnalysis?.notes?.length > 0 || chosenPlan?.rec_weights) && material === 'COIL' && <div className={`${classes.status} ${shownAnalysis?.notes_warn ? classes.statusWarn : ''}`}>
                {(shownAnalysis?.notes || []).map((note) => <div key={note}>{note}</div>)}
                {chosenPlan?.rec_weights && <button type="button" className={classes.recButton}
                  onClick={() => updateSettings({ processmode: 'SPLIT', splitweights: chosenPlan.rec_weights })}>권장 등분중량 적용 ({chosenPlan.rec_weights.map((v) => fmt(v, 0)).join(' / ')}kg)</button>}
              </div>}
            </div>
            <div className={classes.box}>
              {chosenPlan && raw ? <>
                <div className={classes.vizHead}><span className={classes.vizName}>선택안 · {chosenPlan.id}안</span>
                  <span className={classes.muted}>{material === 'COIL' ? `원코일 ${fmt(raw.raw_width)}mm` : `원판 ${fmt(raw.raw_width)} × ${fmt(raw.raw_length)}mm · ${settings.orientation === 'ROTATED' ? '90도 회전' : '기본'}`}</span></div>
                {material === 'COIL' ? <CoilViz plan={chosenPlan} rawWidth={raw.raw_width} /> : <SheetViz plan={chosenPlan} rawWidth={raw.raw_width} rawLength={raw.raw_length} />}
                <PlanResult plan={chosenPlan} material={material} notes={material === 'SHEET' ? shownAnalysis?.notes : null} />
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

    <OptimizationGuideModal opened={guideOpen} onClose={() => setGuideOpen(false)} />
    {pickerModal}
    {planPickerModal}
    <Modal opened={Boolean(orderGroups)} onClose={() => setOrderGroups(null)} centered size={720} className={classes.optScope} classNames={MODAL_LOOK}
      title={orderGroups ? `${orderGroups.orderid} · 작업할 품목 선택` : ''}>
      {orderGroups && <div>
        <p className={m.mModalText}>창고 · 품명 · 두께가 같은 품목끼리만 함께 최적화할 수 있습니다. 먼저 작업할 묶음을 선택해 주세요. 나머지 묶음은 대기 목록에 남아 [대기 품목]에서 이어서 작업할 수 있습니다.</p>
        <table className={classes.groupTable}>
          <thead><tr><th>창고</th><th>소재</th><th>품명</th><th>규격</th><th className={classes.num}>품목</th><th className={classes.num}>주문량</th><th /></tr></thead>
          <tbody>{orderGroups.groups.map((group) => <tr key={group.key}>
            <td><b>{group.warehouse}</b></td>
            <td>{group.material === 'COIL' ? '코일' : '시트'}</td>
            <td title={group.itemname}>{group.itemname}</td>
            <td>{fmt(group.thickness, 3)}T{group.width != null ? ` × ${fmt(group.width)}` : ''}</td>
            <td className={classes.num}>{group.rows.length}건</td>
            <td className={classes.num}>{fmt(group.rows.reduce((sum, row) => sum + (Number(row.order_amount) || 0), 0))}{group.material === 'COIL' ? 'kg' : '매'}</td>
            <td className={classes.center}><button type="button" className={btn('btnPrimary', 'btnSm')} onClick={() => startGroup(group)}>선택</button></td>
          </tr>)}</tbody>
        </table>
        {orderGroups.excluded.length > 0 && <div className={classes.groupExcluded}>
          <strong>최적화할 수 없는 품목</strong>
          <ul>{orderGroups.excluded.map(({ row, reason }) => <li key={keyOf(row)}>{row.orderid}-{row.lineno} {row.itemname} · {reason}</li>)}</ul>
        </div>}
        <div className={m.mModalFooter}><button type="button" className={btn('btnLine')} onClick={() => setOrderGroups(null)}>닫기</button></div>
      </div>}
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
              <span className={badge(editingDraft ? 'blue' : 'green')}>{editingDraft ? '임시저장' : '계획확정'}</span>
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
