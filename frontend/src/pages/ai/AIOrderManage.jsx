import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { ActionIcon, Box, Button, Group, Modal as MantineModal, Pagination, Paper, Popover, Select, Stack, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAdjustments, IconFilter, IconPencil, IconSearch, IconTrash, IconX } from '@tabler/icons-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import ErpDateInput from '../../components/common/ErpDateInput';
import useErpPageRibbon from '../../components/common/useErpPageRibbon';
import usePageReactivated from '../../components/common/usePageReactivated';
import { clearAIOrderDraft, readAIOrderDraft, writeAIOrderDraft } from './AIOrderDraft';
import sharedClasses from '../../styles/pages/ManagementShared.module.css';
import inboundClasses from '../../styles/pages/InboundRegister.module.css';
import classes from '../../styles/pages/AIOrderRegistry.module.css';

const PAGE_SIZE_OPTIONS = [
  { value: '15', label: '15개씩' },
  { value: '50', label: '50개씩' },
  { value: '100', label: '100개씩' },
  { value: '200', label: '200개씩' },
];
const DETAIL_NAV_FIELDS = ['itemname', 'steelgrade', 'surface', 'thickness', 'width', 'length', 'quantity', 'weight_kg', 'notes'];
const ORDER_COLUMNS = [
  { key: 'orderdate', label: '주문일자', width: 105, minWidth: 78 },
  { key: 'orderid', label: '주문번호', width: 110, minWidth: 110 },
  { key: 'buyer', label: '발주처', width: 105, minWidth: 80 },
  { key: 'receiver', label: '수신처', width: 70, minWidth: 70 },
  { key: 'duedate', label: '납기일', width: 70, minWidth: 70 },
  { key: 'deliverylocation', label: '납품장소', width: 170, minWidth: 100 },
  { key: 'detailcount', label: '상세건수', width: 60, minWidth: 60 },
  { key: 'weight', label: '주문중량(KG)', width: 70, minWidth: 70 },
  { key: 'progress', label: '진행', width: 80, minWidth: 70 },
  { key: 'notes', label: '비고', width: 110, minWidth: 100 },
  { key: 'created_by', label: '등록자', width: 80, minWidth: 70 },
  { key: 'updated_by', label: '수정자', width: 80, minWidth: 70 },
];
const ORDER_TABLE_MIN_WIDTH = 1315;
const DETAIL_TABLE_MIN_WIDTH = 1120;
const DETAIL_COLUMNS = [
  { key: 'select', label: '', width: 40, minWidth: 34 },
  { key: 'lineno', label: '순번', width: 40, minWidth: 40 },
  { key: 'itemname', label: '품명', width: 75, minWidth: 75, required: true },
  { key: 'steelgrade', label: '강종', width: 70, minWidth: 55 },
  { key: 'surface', label: '표면', width: 60, minWidth: 50 },
  { key: 'thickness', label: '두께', width: 50, minWidth: 50 },
  { key: 'width', label: '폭', width: 50, minWidth: 50 },
  { key: 'length', label: '길이', width: 50, minWidth: 50 },
  { key: 'quantity', label: '수량', width: 50, minWidth: 50, required: true },
  { key: 'weight_kg', label: '중량(KG)', width: 50, minWidth: 50, required: true },
  { key: 'stock', label: '재고매칭', width: 120, minWidth: 80 },
  { key: 'progress', label: '진행', width: 80, minWidth: 70 },
  { key: 'work', label: '작업', width: 70, minWidth: 70 },
  { key: 'notes', label: '비고', width: 125, minWidth: 80 },
];
const createDefaultOrderFilters = (orderNo = '', orderDate = '') => {
  const hasOrderDate = /^\d{4}-\d{2}-\d{2}$/.test(orderDate);
  return {
    // 일반 메뉴 진입은 날짜 제한 없이 전체 주문을 조회한다.
    // AI 주문확정에서 전달된 주문일은 시작일에 반영한다.
    from: hasOrderDate ? orderDate : '',
    to: '',
    customer: '',
    orderNo,
    progress: 'ALL',
  };
};
const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });
const dateText = (value) => value ? String(value).slice(0, 10) : '';
const number = (value) => Number(value || 0).toLocaleString('ko-KR');
const dimension = (value) => (value === null || value === undefined || value === ''
  ? '' : Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 3 }));
const STOCK_MATCH_PAGE_SIZE = 50;
// Stock source type shown as 입고유형 (same wording as the outbound stock picker).
const STOCK_SOURCE_LABELS = { OPENING: '기초', INBOUND: '입고', PROCESS: '가공' };
// Stock matching modal search conditions (empty = not applied).
const EMPTY_STOCK_FILTERS = { name: '', surface: '', thicknessFrom: '', thicknessTo: '', width: '', length: '', warehouse: '' };
const STOCK_MATCH_PAGE_OPTIONS = [
  { value: '25', label: '25개씩' }, { value: '50', label: '50개씩' }, { value: '100', label: '100개씩' },
];
// Stock matching modal columns (widths can be dragged; see resizeMatchColumn).
const MATCH_COLUMNS = [
  { key: 'select', label: '선택', width: 44, minWidth: 40, align: 'center' },
  { key: 'itemname', label: '품명', width: 130, minWidth: 70 },
  { key: 'productname', label: '제품명', width: 110, minWidth: 60 },
  { key: 'material', label: '강종', width: 80, minWidth: 50 },
  { key: 'surface', label: '표면', width: 80, minWidth: 50 },
  { key: 'thickness', label: '두께', width: 66, minWidth: 50, align: 'right' },
  { key: 'width', label: '폭', width: 76, minWidth: 50, align: 'right' },
  { key: 'length', label: '길이', width: 76, minWidth: 50, align: 'right' },
  { key: 'warehouse', label: '창고', width: 120, minWidth: 60 },
  { key: 'qty', label: '현재고 수량', width: 92, minWidth: 60, align: 'right' },
  { key: 'weight', label: '중량(KG)', width: 92, minWidth: 60, align: 'right' },
  { key: 'sourceno', label: '원천전표', width: 140, minWidth: 80 },
  { key: 'sourcetype', label: '입고유형', width: 70, minWidth: 50, align: 'center' },
  { key: 'receiptdate', label: '입고일자', width: 92, minWidth: 70, align: 'center' },
  { key: 'sourceline', label: '순번', width: 56, minWidth: 40, align: 'center' },
];
const formatNumericValue = (value) => {
  const raw = String(value ?? '');
  if (!raw) return '';
  const [integer, fraction] = raw.split('.');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
};
const errorMessage = (error, fallback) => {
  const detail = error?.response?.data?.detail;
  return typeof detail === 'string' ? detail : fallback;
};
const stockKey = (source) => [source.sourcetype, source.sourceno, source.sourceline].join('|');
const stockSize = (source) => [source.thickness, source.width, source.length]
  .filter((value, index) => value !== null && value !== undefined && value !== '' && !(index === 2 && Number(value) === 0))
  .map(dimension)
  .join(' × ');
// 주문 진행 (품목 진행상태를 모은 값) · 품목 진행상태는 가공 최적화가 관리한다
const DRAFT_ID = '__draft__';
const ORDER_PROGRESS = {
  DRAFT: { label: '저장 전', tone: 'orange' },
  NONE: { label: '미전송', tone: 'gray' }, PARTIAL: { label: '일부 전송', tone: 'orange' },
  SENT: { label: '최적화 진행', tone: 'blue' }, DONE: { label: '가공 완료', tone: 'green' },
};
const LINE_PROGRESS = {
  WAITING: { label: '최적화 대기', tone: 'blue' }, PLANNED: { label: '계획확정', tone: 'orange' }, DONE: { label: '가공완료', tone: 'green' },
};
const isLocked = (item) => Boolean(item?.optimize_status && item.optimize_status !== 'NONE');
const EDIT_KEYS = ['itemname', 'steelgrade', 'surface', 'thickness', 'width', 'length', 'quantity', 'weight_kg', 'notes'];
// 저장된 품목 → 화면 편집값 (수량·중량은 숫자가 없으면 원문 값을 보여준다)
const toItemDraft = (item) => ({
  ...item,
  itemname: item.itemname || '',
  steelgrade: item.steelgrade || '',
  surface: item.surface || '',
  size: item.size || '',
  thickness: item.thickness ?? '',
  width: item.width ?? '',
  length: item.length ?? '',
  quantity: item.quantity ?? item.quantity_raw ?? '',
  quantity_unit: item.quantity_unit || '',
  weight_kg: item.weight_kg ?? item.weight_raw ?? '',
  notes: item.notes || '',
  stock_matches: Array.isArray(item.stock_matches) ? item.stock_matches : [],
  optimize_status: item.optimize_status || 'NONE',
});

function Badge({ value, tone = 'blue' }) {
  return <span className={`${classes.badge} ${classes[tone]}`}>{value}</span>;
}

function Modal({ title, children, actions, onClose, wide = false }) {
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // body 로 띄워서 화면 전체(사이드바·헤더 위) 기준 가운데에 오게 한다
  return createPortal(<div className={classes.modalBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={`${classes.modal} ${wide ? classes.wideModal : ''}`} role="dialog" aria-modal="true" aria-label={title}>
      <header className={classes.modalHeader}><strong>{title}</strong><button type="button" className={classes.closeIcon} aria-label="닫기" onClick={onClose}><IconX size={18} /></button></header>
      <div className={classes.modalBody}>{children}</div>
      {actions && <footer className={classes.modalFooter}>{actions}</footer>}
    </section>
  </div>, document.body);
}

export default function AIOrderManage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const initialOrderId = searchParams.get('orderid')?.trim() || '';
  const initialOrderDate = searchParams.get('orderdate')?.trim() || '';
  const [orders, setOrders] = useState([]);
  const [total, setTotal] = useState(0);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [itemDrafts, setItemDrafts] = useState([]);
  const [selectedItemKeys, setSelectedItemKeys] = useState([]);
  const nextDraftKey = useRef(1);
  const itemSelectionAnchor = useRef(null);
  const ordersScrollRef = useRef(null);
  const ordersHorizontalScrollRef = useRef(null);
  const [orderColumnWidths, setOrderColumnWidths] = useState({});
  const [detailColumnWidths, setDetailColumnWidths] = useState({});
  const [matchColumnWidths, setMatchColumnWidths] = useState({});
  const [filterOpen, setFilterOpen] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [applied, setApplied] = useState(() => createDefaultOrderFilters(initialOrderId, initialOrderDate));
  const [draftFilters, setDraftFilters] = useState(() => createDefaultOrderFilters(initialOrderId, initialOrderDate));
  const [modal, setModal] = useState(null);
  // AI 주문서 인식에서 넘어온 저장 전 주문 (저장하면 사라진다)
  const [orderDraft, setOrderDraft] = useState(() => readAIOrderDraft());
  const draftRow = useMemo(() => orderDraft ? {
    orderid: DRAFT_ID, isDraft: true, progress: 'DRAFT',
    orderdate: orderDraft.header?.order_date || '', duedate: orderDraft.header?.due_date || '',
    buyer: orderDraft.header?.buyer || '', recipient: orderDraft.header?.recipient || '',
    deliverylocation: orderDraft.header?.delivery_location || '',
    item_count: orderDraft.items.length,
    total_weight: orderDraft.items.reduce((sum, item) => sum + (Number(item.weight_kg) || 0), 0),
  } : null, [orderDraft]);
  const displayOrders = useMemo(() => (draftRow ? [draftRow, ...orders] : orders), [draftRow, orders]);
  const selectedOrder = displayOrders.find(({ orderid }) => orderid === selectedId) || null;
  const isDraftSelected = Boolean(selectedOrder?.isDraft);
  // 저장 전 주문을 고치는 동안 내용을 보관 → 다른 화면에 다녀와도 그대로 (탭을 닫으면 지워짐)
  useEffect(() => {
    if (selectedId !== DRAFT_ID || !orderDraft || detail?.header?.orderid !== DRAFT_ID) return;
    writeAIOrderDraft({
      ...orderDraft,
      items: itemDrafts.map((row) => ({
        source_product_name: row.itemname || null, steel_grade: row.steelgrade || null, surface: row.surface || null,
        spec_raw: row.size || null, thickness: row.thickness, width: row.width, length: row.length,
        quantity: row.quantity, quantity_unit: row.quantity_unit || null, weight_kg: row.weight_kg,
        notes: row.notes || null, quantity_raw: row.quantity_raw ?? null, weight_raw: row.weight_raw ?? null,
      })),
    });
  }, [itemDrafts, selectedId, orderDraft, detail]);
  // 보내기 / 보내기 취소 대상: 체크한 품목(없으면 전체) 중 해당 상태인 품목이 있을 때만 버튼을 켠다
  const optimizeTargets = useMemo(() => {
    const picked = selectedItemKeys.length ? itemDrafts.filter((row) => selectedItemKeys.includes(row._rowKey)) : itemDrafts;
    return {
      send: picked.some((row) => row.lineno && row.optimize_status === 'NONE'),
      recall: picked.some((row) => row.lineno && row.optimize_status === 'WAITING'),
    };
  }, [itemDrafts, selectedItemKeys]);
  const detailWeight = useMemo(() => itemDrafts.reduce((sum, item) => {
    const value = Number(item.weight_kg || 0);
    return Number.isFinite(value) ? sum + value : sum;
  }, 0), [itemDrafts]);
  // The bottom scrollbar drives the table (the table itself hides its horizontal scrollbar).
  // The table position we last applied is remembered, so the table's resulting scroll event is
  // recognised as our own and never written back to the scrollbar. Writing it back interrupted
  // the browser's smooth scroll when the scrollbar track was clicked, and fought with dragging.
  // The table only updates the scrollbar when it moved by itself (e.g. Tab focus into a cell).
  const appliedTableScrollLeftRef = useRef(0);
  const syncOrdersFromScrollbar = (event) => {
    const table = ordersScrollRef.current;
    if (!table) return;
    table.scrollLeft = event.currentTarget.scrollLeft;
    appliedTableScrollLeftRef.current = table.scrollLeft;
  };
  const syncScrollbarFromOrders = (event) => {
    const table = event.currentTarget;
    if (Math.abs(table.scrollLeft - appliedTableScrollLeftRef.current) <= 1) return;
    appliedTableScrollLeftRef.current = table.scrollLeft;
    const scrollbar = ordersHorizontalScrollRef.current;
    if (scrollbar) scrollbar.scrollLeft = table.scrollLeft;
  };
  const resizeTableColumn = (event, tableType, column) => {
    event.preventDefault();
    event.stopPropagation();
    const columns = tableType === 'orders' ? ORDER_COLUMNS : DETAIL_COLUMNS;
    const widthState = tableType === 'orders' ? orderColumnWidths : detailColumnWidths;
    const setWidthState = tableType === 'orders' ? setOrderColumnWidths : setDetailColumnWidths;
    // 그릴 때와 같은 최소 너비 (다르면 끌기 시작하는 순간 표 전체가 갑자기 커진다)
    const minTableWidth = tableType === 'orders' ? ORDER_TABLE_MIN_WIDTH : DETAIL_TABLE_MIN_WIDTH;
    const startX = event.clientX;
    const startWidth = widthState[column.key] ?? column.width;
    const table = event.currentTarget.closest('table');
    const widthOf = (item) => widthState[item.key] ?? item.width;
    const startTableWidth = Math.max(minTableWidth, columns.reduce((sum, item) => sum + widthOf(item), 0), table?.clientWidth || 0);
    let nextWidth = startWidth;
    let animationFrame = 0;

    const applyWidth = () => {
      const tableWidth = Math.max(minTableWidth, startTableWidth + nextWidth - startWidth);
      const targetColumn = table?.querySelector(`col[data-column-key="${column.key}"]`);
      if (targetColumn) targetColumn.style.width = `${nextWidth}px`;
      if (table) {
        table.style.width = `max(100%, ${tableWidth}px)`;
        table.style.minWidth = `${tableWidth}px`;
      }
      if (tableType === 'orders' && ordersHorizontalScrollRef.current?.firstElementChild) {
        ordersHorizontalScrollRef.current.firstElementChild.style.width = `${Math.max(tableWidth, ordersScrollRef.current?.clientWidth || 0)}px`;
      }
    };
    const move = (pointerEvent) => {
      nextWidth = Math.max(column.minWidth, Math.min(1200, startWidth + pointerEvent.clientX - startX));
      if (!animationFrame) {
        animationFrame = window.requestAnimationFrame(() => {
          animationFrame = 0;
          applyWidth();
        });
      }
    };
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      applyWidth();
      setWidthState((current) => ({ ...current, [column.key]: nextWidth }));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  };
  const resizeMatchColumn = (event, column) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = matchColumnWidths[column.key] ?? column.width;
    const table = event.currentTarget.closest('table');
    const otherWidth = MATCH_COLUMNS.reduce((sum, item) => (item.key === column.key ? sum : sum + (matchColumnWidths[item.key] ?? item.width)), 0);
    let nextWidth = startWidth;
    let frame = 0;
    const apply = () => {
      const col = table?.querySelector(`col[data-column-key="${column.key}"]`);
      if (col) col.style.width = `${nextWidth}px`;
      if (table) table.style.width = `${otherWidth + nextWidth}px`;
    };
    const move = (pointerEvent) => {
      nextWidth = Math.max(column.minWidth, Math.min(600, startWidth + pointerEvent.clientX - startX));
      if (!frame) frame = window.requestAnimationFrame(() => { frame = 0; apply(); });
    };
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      if (frame) window.cancelAnimationFrame(frame);
      apply();
      setMatchColumnWidths((current) => ({ ...current, [column.key]: nextWidth }));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  };
  const matchTableWidth = MATCH_COLUMNS.reduce((sum, column) => sum + (matchColumnWidths[column.key] ?? column.width), 0);
  const orderTableWidth = Math.max(ORDER_TABLE_MIN_WIDTH, ORDER_COLUMNS.reduce((sum, column) => sum + (orderColumnWidths[column.key] ?? column.width), 0));
  const detailTableWidth = Math.max(DETAIL_TABLE_MIN_WIDTH, DETAIL_COLUMNS.reduce((sum, column) => sum + (detailColumnWidths[column.key] ?? column.width), 0));

  useEffect(() => {
    setSelectedItemKeys([]);
    const rows = detail?.header?.orderid === selectedId && Array.isArray(detail.items)
      ? detail.items.map((item, index) => ({ ...toItemDraft(item), _rowKey: item.lineno ? `saved-${selectedId}-${item.lineno}` : `draft-${index}` }))
      : [];
    setItemDrafts(rows);
  }, [selectedId, detail]);
  const notify = useCallback((message, title, color = 'orange') => {
    notifications.show({ title, message, color });
  }, []);
  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const params = Object.fromEntries(Object.entries({
        start_date: applied.from,
        end_date: applied.to,
        buyer: applied.customer,
        orderid: applied.orderNo,
        progress: applied.progress && applied.progress !== 'ALL' ? applied.progress : '',
      }).filter(([, value]) => value));
      const { data } = await axios.get('/api/ai-order/confirmed', {
        ...authConfig(), params: { ...params, page, page_size: pageSize },
      });
      const rows = Array.isArray(data?.items) ? data.items : [];
      setOrders(rows);
      setTotal(Number(data?.total || 0));
      setSelectedId((current) => (current === DRAFT_ID && readAIOrderDraft()) || rows.some((row) => row.orderid === current)
        ? current : (readAIOrderDraft() ? DRAFT_ID : (rows[0]?.orderid || '')));
    } catch (error) {
      notify(errorMessage(error, '확정 주문을 불러오지 못했습니다. 다시 조회해 주세요.'), '확정 주문 조회 실패', 'red');
      setOrders([]);
      setTotal(0);
      setSelectedId('');
    } finally {
      setLoading(false);
    }
  }, [applied, page, pageSize, notify]);

  useEffect(() => { void loadOrders(); }, [loadOrders]);
  // 다른 탭(가공 최적화 등)에서 상태가 바뀌었을 수 있으니 돌아오면 다시 불러온다
  usePageReactivated(() => {
    void loadOrders();
    if (selectedId && selectedId !== DRAFT_ID && !hasUnsavedItems()) {
      axios.get(`/api/ai-order/confirmed/${encodeURIComponent(selectedId)}`, authConfig())
        .then(({ data }) => setDetail(data))
        .catch(() => {});
    }
  });

  useEffect(() => {
    if (!selectedId) { setDetail(null); return undefined; }
    if (selectedId === DRAFT_ID) {
      // 저장 전 주문: AI 인식 결과를 주문 상세 모양으로 바꿔 보여준다 (lineno 없음 = 새 행)
      const draft = readAIOrderDraft();
      setDetail(draft ? {
        header: { orderid: DRAFT_ID },
        items: draft.items.map((item) => ({
          lineno: null, itemname: item.source_product_name, steelgrade: item.steel_grade, surface: item.surface,
          size: item.spec_raw, thickness: item.thickness, width: item.width, length: item.length,
          quantity: item.quantity, quantity_unit: item.quantity_unit, weight_kg: item.weight_kg, notes: item.notes,
          quantity_raw: item.quantity_raw, weight_raw: item.weight_raw, optimize_status: 'NONE', stock_matches: [],
        })),
      } : null);
      setDetailLoading(false);
      return undefined;
    }
    let active = true;
    setDetail(null);
    setDetailLoading(true);
    axios.get(`/api/ai-order/confirmed/${encodeURIComponent(selectedId)}`, authConfig())
      .then(({ data }) => { if (active) setDetail(data); })
      .catch((error) => { if (active) notify(errorMessage(error, '주문 상세를 불러오지 못했습니다.'), '주문 상세 조회 실패', 'red'); })
      .finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [selectedId, notify]);

  function applySearch(criteria = draftFilters) {
    if (criteria.from && criteria.to && criteria.from > criteria.to) {
      notify('주문 시작일은 종료일보다 늦을 수 없습니다.', '날짜 범위 확인');
      return;
    }
    setPage(1);
    setSelectedId('');
    setApplied({ ...criteria, customer: criteria.customer.trim(), orderNo: criteria.orderNo.trim() });
  }

  const openEdit = () => {
    if (!selectedOrder) return notify('주문을 먼저 선택해 주세요.', '주문 선택 확인');
    setModal({ type: 'edit', buyer: selectedOrder.buyer || '', recipient: selectedOrder.recipient || '', orderDate: dateText(selectedOrder.orderdate), due: dateText(selectedOrder.duedate), place: selectedOrder.deliverylocation || '' });
  };

  // Current stock list for the person in charge to pick from. Filters entered in the modal:
  // 품명 (LIKE %품명%, empty = all) and optional thickness from / to (no default range).
  const loadStockCandidates = async (lineno, query = {}) => {
    const page = query.page || 1;
    const pageSize = query.pageSize || STOCK_MATCH_PAGE_SIZE;
    const filters = { ...EMPTY_STOCK_FILTERS, ...(query.filters || {}) };
    const text = (value) => String(value ?? '').trim();
    const params = { page, page_size: pageSize, itemname: text(filters.name) };
    // Optional filters are sent only when entered.
    if (text(filters.surface)) params.surface = text(filters.surface);
    if (text(filters.thicknessFrom)) params.thickness_from = text(filters.thicknessFrom);
    if (text(filters.thicknessTo)) params.thickness_to = text(filters.thicknessTo);
    if (text(filters.width)) params.width = text(filters.width);
    if (text(filters.length)) params.length = text(filters.length);
    if (text(filters.warehouse)) params.warehouse = text(filters.warehouse);
    setModal((current) => current?.type === 'stock-match' && current.lineno === lineno ? { ...current, loading: true } : current);
    try {
      const { data } = await axios.get(`/api/ai-order/confirmed/${encodeURIComponent(selectedId)}/items/${lineno}/stock-candidates`, { ...authConfig(), params });
      setModal((current) => current?.type === 'stock-match' && current.lineno === lineno
        ? {
          ...current,
          loading: false,
          candidates: Array.isArray(data?.candidates) ? data.candidates : [],
          total: Number(data?.total_candidates || 0),
          page,
          pageSize,
          // The filters actually queried (paging keeps using them even if the inputs are edited).
          appliedFilters: filters,
        }
        : current);
      return true;
    } catch (error) {
      setModal((current) => current?.type === 'stock-match' && current.lineno === lineno ? { ...current, loading: false } : current);
      notify(errorMessage(error, '현재고 후보를 불러오지 못했습니다.'), '재고 후보 조회 실패', 'red');
      return false;
    }
  };

  const openStockMatcher = async (item) => {
    if (!item.lineno) return notify('상세를 먼저 저장한 뒤 재고를 연결해 주세요.', '상세 저장 필요');
    // Selected sources are kept by key across pages (and include links saved earlier).
    const selectedSources = Object.fromEntries((item.stock_matches || []).map((match) => [stockKey(match), { ...match }]));
    const initialFilters = { ...EMPTY_STOCK_FILTERS, name: String(item.itemname || '').trim() };
    setModal({
      type: 'stock-match', lineno: item.lineno, loading: true, saving: false, candidates: [],
      selectedKeys: Object.keys(selectedSources), selectedSources,
      filters: initialFilters, appliedFilters: initialFilters,
      page: 1, pageSize: STOCK_MATCH_PAGE_SIZE, total: 0,
    });
    const loaded = await loadStockCandidates(item.lineno, { filters: initialFilters });
    if (!loaded) setModal(null);
  };

  const changeStockCandidatePage = (page, pageSize) => {
    if (modal?.type !== 'stock-match' || modal.loading) return;
    void loadStockCandidates(modal.lineno, { filters: modal.appliedFilters, page, pageSize: pageSize || modal.pageSize });
  };

  const searchStockCandidates = () => {
    if (modal?.type !== 'stock-match' || modal.loading) return;
    const filters = modal.filters || EMPTY_STOCK_FILTERS;
    const numeric = { thicknessFrom: '두께 시작', thicknessTo: '두께 끝', width: '폭', length: '길이' };
    for (const [field, label] of Object.entries(numeric)) {
      const value = String(filters[field] ?? '').trim();
      if (value && (!Number.isFinite(Number(value)) || Number(value) < 0)) {
        notify(`${label}은(는) 0 이상의 숫자로 입력해 주세요.`, '조회조건 확인');
        return;
      }
    }
    const from = String(filters.thicknessFrom ?? '').trim();
    const to = String(filters.thicknessTo ?? '').trim();
    if (from && to && Number(from) > Number(to)) {
      notify('두께 시작값이 끝값보다 클 수 없습니다.', '조회조건 확인');
      return;
    }
    void loadStockCandidates(modal.lineno, { filters, page: 1, pageSize: modal.pageSize });
  };

  const toggleStockCandidate = (candidate) => {
    const key = stockKey({ sourcetype: candidate.stocksourcetype, sourceno: candidate.stocksourceno, sourceline: candidate.stocksourceline });
    setModal((current) => {
      if (current?.type !== 'stock-match') return current;
      const selected = new Set(current.selectedKeys);
      const sources = { ...(current.selectedSources || {}) };
      if (selected.has(key)) {
        selected.delete(key);
        delete sources[key];
      } else {
        selected.add(key);
        sources[key] = {
          ...candidate,
          sourcetype: candidate.stocksourcetype,
          sourceno: candidate.stocksourceno,
          sourceline: candidate.stocksourceline,
        };
      }
      return { ...current, selectedKeys: [...selected], selectedSources: sources };
    });
  };

  // reset = 연결 초기화 (빈 목록 저장)
  const saveStockLinks = async (reset = false) => {
    if (modal?.type !== 'stock-match' || modal.saving) return;
    // Every selected source on any page (not only the rows of the current page).
    const selected = reset ? [] : modal.selectedKeys.map((key) => modal.selectedSources?.[key]).filter(Boolean);
    if (!reset && !selected.length) return notify('연결할 현재고를 선택해 주세요.', '재고 선택 확인');
    setModal((current) => ({ ...current, saving: true }));
    try {
      await axios.put(`/api/ai-order/confirmed/${encodeURIComponent(selectedId)}/items/${modal.lineno}/stock-matches`, {
        sources: selected.map((source) => ({
          sourcetype: source.sourcetype,
          sourceno: source.sourceno,
          sourceline: source.sourceline,
        })),
      }, authConfig());
      const stockMatches = selected.map((candidate, index) => ({
        ...candidate,
        matchlineno: index + 1,
      }));
      setItemDrafts((rows) => rows.map((row) => row.lineno === modal.lineno ? { ...row, stock_matches: stockMatches } : row));
      setDetail((current) => current ? ({ ...current, items: current.items.map((row) => row.lineno === modal.lineno ? { ...row, stock_matches: stockMatches } : row) }) : current);
      setModal(null);
      notify(reset ? '재고 연결을 초기화했습니다.' : `현재고 ${selected.length}건을 연결했습니다.`, '재고매칭 저장 완료', 'teal');
    } catch (error) {
      setModal((current) => current?.type === 'stock-match' ? { ...current, saving: false } : current);
      notify(errorMessage(error, '재고매칭 저장에 실패했습니다.'), '재고매칭 저장 실패', 'red');
    }
  };

  // 저장 안 된 상세 변경이 있으면 보내기 전에 저장하도록 한다
  const hasUnsavedItems = () => {
    // 화면에 처음 보여준 값과 비교한다 (DB 원값과 비교하면 원문 수량 등이 변경으로 잘못 잡힌다)
    const saved = new Map((detail?.items || []).map((row) => [row.lineno, toItemDraft(row)]));
    return itemDrafts.length !== saved.size || itemDrafts.some((row) => {
      const original = row.lineno ? saved.get(row.lineno) : null;
      return !original || EDIT_KEYS.some((key) => String(row[key] ?? '') !== String(original[key] ?? ''));
    });
  };

  // 선택한 품목(없으면 전체)을 가공 최적화로 보내기 / 보내기 취소
  const changeOptimizeStatus = async (send) => {
    if (!selectedOrder || saving || detailLoading) return;
    if (hasUnsavedItems()) return notify('저장하지 않은 상세 변경이 있습니다. 먼저 저장해 주세요.', '상세 저장 필요');
    const picked = selectedItemKeys.length ? itemDrafts.filter((row) => selectedItemKeys.includes(row._rowKey)) : itemDrafts;
    const targets = picked.filter((row) => row.lineno && row.optimize_status === (send ? 'NONE' : 'WAITING'));
    if (!targets.length) {
      return notify(send ? '보낼 수 있는 품목이 없습니다. (이미 보낸 품목은 제외됩니다)' : '되돌릴 수 있는 품목이 없습니다. 최적화 대기 품목만 되돌릴 수 있습니다.', '품목 확인');
    }
    setSaving(true);
    try {
      const { data } = await axios.post(`/api/ai-order/confirmed/${encodeURIComponent(selectedOrder.orderid)}/${send ? 'send-to-optimization' : 'recall-from-optimization'}`,
        { linenos: targets.map((row) => row.lineno) }, authConfig());
      setSelectedItemKeys([]);
      notify(send ? `${number(data?.changed?.length)}개 품목을 가공 최적화로 보냈습니다.` : `${number(data?.changed?.length)}개 품목을 되돌렸습니다.`,
        send ? '가공 최적화로 보내기 완료' : '보내기 취소 완료', 'teal');
      await loadOrders();
      const response = await axios.get(`/api/ai-order/confirmed/${encodeURIComponent(selectedOrder.orderid)}`, authConfig());
      setDetail(response.data);
    } catch (error) {
      notify(errorMessage(error, send ? '가공 최적화로 보내지 못했습니다.' : '보내기 취소에 실패했습니다.'), '저장 실패', 'red');
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async () => {
    if (!selectedOrder || !modal || saving) return;
    if (!modal.due) return notify('납기일을 입력해 주세요.', '필수 항목 확인');
    if (selectedOrder.isDraft) {
      const next = { ...orderDraft, header: { ...orderDraft.header, buyer: modal.buyer.trim() || null, recipient: modal.recipient.trim() || null,
        order_date: modal.orderDate || null, due_date: modal.due, delivery_location: modal.place.trim() || null } };
      writeAIOrderDraft(next);
      setOrderDraft(next);
      setModal(null);
      return notify('주문 정보를 바꿨습니다. [저장]하면 주문과 함께 저장됩니다.', '주문 정보 변경', 'teal');
    }
    setSaving(true);
    try {
      await axios.put(`/api/ai-order/confirmed/${encodeURIComponent(selectedOrder.orderid)}`, {
        buyer: modal.buyer.trim() || null,
        recipient: modal.recipient.trim() || null,
        order_date: modal.orderDate || null,
        due_date: modal.due,
        delivery_location: modal.place.trim() || null,
      }, authConfig());
      setModal(null);
      notify('주문 정보가 저장되었습니다.', '주문 정보 저장 완료', 'teal');
      await loadOrders();
      const { data } = await axios.get(`/api/ai-order/confirmed/${encodeURIComponent(selectedOrder.orderid)}`, authConfig());
      setDetail(data);
    } catch (error) {
      notify(errorMessage(error, '주문 정보를 저장하지 못했습니다.'), '주문 정보 저장 실패', 'red');
    } finally {
      setSaving(false);
    }
  };

  const addItemDraft = () => {
    if (!selectedOrder) return notify('주문을 먼저 선택해 주세요.', '주문 선택 확인');
    const _rowKey = `new-${selectedId}-${nextDraftKey.current++}`;
    setItemDrafts((rows) => [...rows, {
      _rowKey, lineno: null, itemname: '', steelgrade: '', surface: '', size: '', thickness: '',
      width: '', length: '', quantity: '', quantity_unit: '', weight_kg: '', notes: '',
    }]);
  };

  const changeItemDraft = (_rowKey, key, value) => {
    setItemDrafts((rows) => rows.map((row) => row._rowKey === _rowKey ? {
      ...row,
      [key]: value,
      ...(key === 'quantity' ? { quantity_raw: null } : {}),
      ...(key === 'weight_kg' ? { weight_raw: null } : {}),
    } : row));
  };

  const toggleItemSelection = (_rowKey, shiftKey = false) => {
    const index = itemDrafts.findIndex((row) => row._rowKey === _rowKey);
    setSelectedItemKeys((keys) => {
      if (shiftKey && itemSelectionAnchor.current !== null) {
        const start = Math.min(index, itemSelectionAnchor.current);
        const end = Math.max(index, itemSelectionAnchor.current);
        const range = itemDrafts.slice(start, end + 1).map((row) => row._rowKey);
        return [...new Set([...keys, ...range])];
      }
      itemSelectionAnchor.current = index;
      return keys.includes(_rowKey) ? keys.filter((key) => key !== _rowKey) : [...keys, _rowKey];
    });
  };

  const toggleAllItemSelection = () => {
    setSelectedItemKeys((keys) => keys.length === itemDrafts.length ? [] : itemDrafts.map((row) => row._rowKey));
  };

  const deleteSelectedItemDrafts = () => {
    if (!selectedItemKeys.length) return;
    const selected = new Set(selectedItemKeys);
    if (itemDrafts.some((row) => selected.has(row._rowKey) && isLocked(row))) {
      notify('가공 최적화로 보낸 품목은 삭제할 수 없습니다.', '삭제 불가');
      return;
    }
    setItemDrafts((rows) => rows.filter((row) => !selected.has(row._rowKey)));
    setSelectedItemKeys([]);
  };

  const requestDelete = () => {
    if (selectedItemKeys.length) {
      deleteSelectedItemDrafts();
      return;
    }
    if (!selectedOrder || saving) return;
    setModal({ type: 'delete-order' });
  };

  const deleteOrder = async () => {
    const target = selectedOrder;
    if (!target || saving) return;
    if (target.isDraft) {
      clearAIOrderDraft();
      setOrderDraft(null);
      setModal(null);
      setDetail(null);
      setItemDrafts([]);
      setSelectedItemKeys([]);
      setSelectedId(orders[0]?.orderid || '');
      return notify('저장 전 주문을 취소했습니다.', '주문 취소', 'teal');
    }
    setSaving(true);
    try {
      await axios.delete(`/api/ai-order/confirmed/${encodeURIComponent(target.orderid)}`, authConfig());
      setModal(null);
      setDetail(null);
      setItemDrafts([]);
      setSelectedItemKeys([]);
      notify(`${target.orderid} 주문을 삭제했습니다.`, '주문 삭제 완료', 'teal');
      await loadOrders();
    } catch (error) {
      notify(errorMessage(error, '주문 삭제에 실패했습니다.'), '주문 삭제 실패', 'red');
    } finally {
      setSaving(false);
    }
  };

  const saveItemEdits = async () => {
    if (!selectedOrder || saving) return;
    const numericFields = ['thickness', 'width', 'length', 'quantity', 'weight_kg'];
    const rows = [];
    const activeDrafts = itemDrafts.filter((row) => row.lineno || ['itemname', 'steelgrade', 'surface', 'thickness', 'width', 'length', 'quantity', 'weight_kg', 'notes']
      .some((key) => String(row[key] ?? '').trim()));
    // 필수값: 품명 · 수량 · 중량 (보낸 품목은 잠겨 있어 제외)
    const missingRows = activeDrafts.filter((row) => !isLocked(row)).map((row) => {
      const missing = [['itemname', '품명'], ['quantity', '수량'], ['weight_kg', '중량']]
        .filter(([key]) => !String(row[key] ?? '').trim()).map(([, label]) => label);
      return missing.length ? `${itemDrafts.indexOf(row) + 1}행 ${missing.join(', ')}` : null;
    }).filter(Boolean);
    if (missingRows.length) return notify(missingRows.slice(0, 5).join(' / '), '필수값을 입력해 주세요');
    for (const row of activeDrafts) {
      const converted = { ...row };
      for (const key of numericFields) {
        const raw = String(row[key] ?? '').replaceAll(',', '').trim();
        const rawKey = key === 'quantity' ? 'quantity_raw' : key === 'weight_kg' ? 'weight_raw' : null;
        if (!raw) { converted[key] = null; if (rawKey) converted[rawKey] = null; continue; }
        if (rawKey && row[rawKey] != null && raw === String(row[rawKey])) {
          converted[key] = null;
          continue;
        }
        if (!/^\d+(?:\.\d{1,3})?$/.test(raw) || !Number.isFinite(Number(raw))) {
          return notify(`${row.lineno || itemDrafts.indexOf(row) + 1}행 ${key === 'weight_kg' ? '중량' : key === 'quantity' ? '수량' : key === 'thickness' ? '두께' : key === 'width' ? '폭' : '길이'}은 숫자만 입력해 주세요. 소수점은 셋째 자리까지 가능합니다.`, '숫자 입력 확인');
        }
        converted[key] = Number(raw);
        if (rawKey) converted[rawKey] = null;
      }
      rows.push(converted);
    }

    if (selectedOrder.isDraft) {
      if (!rows.length) return notify('상세 품목을 1건 이상 입력해 주세요.', '상세 확인');
      setSaving(true);
      try {
        const { data } = await axios.post('/api/ai-order/confirmed', {
          analysis_request_id: orderDraft.analysis_request_id,
          sourcefilename: orderDraft.sourcefilename,
          header: orderDraft.header,
          items: rows.map((row) => ({
            source_product_name: row.itemname || null, steel_grade: row.steelgrade || null, surface: row.surface || null,
            spec_raw: row.size || null, thickness: row.thickness, width: row.width, length: row.length,
            quantity: row.quantity, quantity_unit: row.quantity_unit || null, weight_kg: row.weight_kg,
            notes: row.notes || null, quantity_raw: row.quantity_raw ?? null, weight_raw: row.weight_raw ?? null,
          })),
        }, authConfig());
        clearAIOrderDraft();
        setOrderDraft(null);
        setSelectedItemKeys([]);
        notify(data.already_confirmed ? `이미 저장된 주문 ${data.orderid}을(를) 불러왔습니다.` : `${data.orderid} 주문과 상세 ${rows.length}건을 저장했습니다.`,
          data.already_confirmed ? '이미 저장된 주문' : '주문 저장 완료', 'teal');
        const filters = createDefaultOrderFilters(data.orderid, '');
        setDraftFilters(filters);
        setPage(1);
        setSelectedId(data.orderid);
        setApplied(filters);
      } catch (error) {
        notify(errorMessage(error, '주문을 저장하지 못했습니다.'), '주문 저장 실패', 'red');
      } finally {
        setSaving(false);
      }
      return;
    }
    setSaving(true);
    try {
      await axios.put(`/api/ai-order/confirmed/${encodeURIComponent(selectedOrder.orderid)}/items`, { items: rows }, authConfig());
      setSelectedItemKeys([]);
      notify('주문 상세가 저장되었습니다.', '주문 상세 저장 완료', 'teal');
      await loadOrders();
      const { data } = await axios.get(`/api/ai-order/confirmed/${encodeURIComponent(selectedOrder.orderid)}`, authConfig());
      setDetail(data);
    } catch (error) {
      notify(errorMessage(error, '주문 상세를 저장하지 못했습니다.'), '주문 상세 저장 실패', 'red');
    } finally {
      setSaving(false);
    }
  };

  const detailInput = (item, key, numeric = false, displayIndex = 0) => (
    <input
      className={classes.editInput}
      readOnly={isLocked(item)}
      title={isLocked(item) ? '가공 최적화로 보낸 품목은 수정할 수 없습니다.' : undefined}
      data-detail-row={displayIndex}
      data-detail-column={DETAIL_NAV_FIELDS.indexOf(key)}
      value={numeric ? formatNumericValue(item[key]) : item[key] ?? ''}
      inputMode={numeric ? 'decimal' : undefined}
      onChange={(event) => {
        const input = event.currentTarget;
        const displayValue = input.value;
        const cursor = input.selectionStart ?? displayValue.length;
        const value = numeric ? displayValue.replaceAll(',', '') : displayValue;
        if (numeric && value !== '' && !/^\d*(?:\.\d{0,3})?$/.test(value)) return;
        changeItemDraft(item._rowKey, key, value);
        if (numeric) {
          const rawCursor = displayValue.slice(0, cursor).replaceAll(',', '').length;
          requestAnimationFrame(() => {
            const nextCursor = formatNumericValue(value.slice(0, rawCursor)).length;
            input.setSelectionRange(nextCursor, nextCursor);
          });
        }
      }}
      onKeyDown={handleDetailGridKeyDown}
      aria-label={`${displayIndex + 1}행 ${key}`}
    />
  );

  function handleDetailGridKeyDown(event) {
    const input = event.currentTarget;
    const rowIndex = Number(input.dataset.detailRow);
    const columnIndex = Number(input.dataset.detailColumn);
    if (!Number.isInteger(rowIndex) || !Number.isInteger(columnIndex) || columnIndex < 0) return;

    let nextRow = rowIndex;
    let nextColumn = columnIndex;
    if (event.key === 'ArrowUp') nextRow -= 1;
    else if (event.key === 'ArrowDown') nextRow += 1;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const hasSelection = input.selectionStart !== input.selectionEnd;
      const atBoundary = hasSelection
        ? false
        : event.key === 'ArrowLeft'
          ? input.selectionStart === 0
          : input.selectionEnd === input.value.length;
      if (!atBoundary) return;
      nextColumn += event.key === 'ArrowLeft' ? -1 : 1;
      if (nextColumn < 0) { nextRow -= 1; nextColumn = DETAIL_NAV_FIELDS.length - 1; }
      if (nextColumn >= DETAIL_NAV_FIELDS.length) { nextRow += 1; nextColumn = 0; }
    } else return;

    if (nextRow < 0 || nextRow >= itemDrafts.length) return;
    const nextInput = input.closest('table')?.querySelector(
      `input[data-detail-row="${nextRow}"][data-detail-column="${nextColumn}"]`,
    );
    if (!nextInput) return;
    event.preventDefault();
    nextInput.focus();
  }

  const editField = (key, value) => setDraftFilters((current) => ({ ...current, [key]: value }));
  useErpPageRibbon({
    showPrint: false,
    useSaveColor: false,
    onSearch: () => applySearch(),
    onAdd: selectedOrder && !detailLoading ? addItemDraft : undefined,
    onDelete: selectedOrder && !saving ? requestDelete : undefined,
    onSave: selectedOrder && !saving && !detailLoading ? saveItemEdits : undefined,
  });

  const renderModal = () => {
    if (!modal || !selectedOrder) return null;
    if (modal.type === 'delete-order') return <MantineModal opened onClose={() => !saving && setModal(null)} title="주문 삭제" centered size="sm">
      <Stack gap="md">
        <Text size="sm" c="dimmed">{selectedOrder.isDraft
          ? '저장하지 않은 주문을 취소합니다. AI 주문서 인식의 분석 결과는 그대로 남아 있어 다시 넘길 수 있습니다.'
          : `${selectedOrder.orderid} 주문과 상세 내역을 삭제합니다. 삭제한 주문은 복구할 수 없습니다.`}</Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setModal(null)} disabled={saving}>취소</Button>
          <Button color="red" leftSection={<IconTrash size={15} />} onClick={() => void deleteOrder()} loading={saving}>삭제</Button>
        </Group>
      </Stack>
    </MantineModal>;
    if (modal.type === 'stock-match') {
      const targetItem = itemDrafts.find((item) => item.lineno === modal.lineno);
      const setFilter = (field) => (event) => {
        const value = event.currentTarget.value;
        setModal((current) => current?.type === 'stock-match'
          ? { ...current, filters: { ...(current.filters || EMPTY_STOCK_FILTERS), [field]: value } } : current);
      };
      return <Modal wide title="재고 선택" onClose={() => !modal.saving && setModal(null)}>
        <div className={classes.info}>현재고를 조회해 주문 상세에 연결할 재고를 선택하세요. 연결은 재고를 예약하거나 차감하지 않습니다.</div>
        <div className={classes.matchSummary}>
          <span>주문 품명 <strong>{targetItem?.itemname || '—'}</strong></span>
          <span>주문 규격 <strong>{targetItem?.size || '—'}</strong></span>
          <span>두께 <strong>{targetItem?.thickness || '—'}</strong></span>
        </div>
        <form className={classes.matchFilter} onSubmit={(event) => { event.preventDefault(); searchStockCandidates(); }}>
          <TextInput size="xs" label="품명" className={classes.matchFilterName}
            value={modal.filters?.name ?? ''} onChange={setFilter('name')} disabled={modal.saving} />
          <TextInput size="xs" label="표면" className={classes.matchFilterText}
            value={modal.filters?.surface ?? ''} onChange={setFilter('surface')} disabled={modal.saving} />
          <TextInput size="xs" label="두께 시작" type="number" step="0.01" min="0" className={classes.matchFilterThickness}
            value={modal.filters?.thicknessFrom ?? ''} onChange={setFilter('thicknessFrom')} disabled={modal.saving} />
          <TextInput size="xs" label="두께 끝" type="number" step="0.01" min="0" className={classes.matchFilterThickness}
            value={modal.filters?.thicknessTo ?? ''} onChange={setFilter('thicknessTo')} disabled={modal.saving} />
          <TextInput size="xs" label="폭" type="number" step="0.1" min="0" className={classes.matchFilterThickness}
            value={modal.filters?.width ?? ''} onChange={setFilter('width')} disabled={modal.saving} />
          <TextInput size="xs" label="길이" type="number" step="0.1" min="0" className={classes.matchFilterThickness}
            value={modal.filters?.length ?? ''} onChange={setFilter('length')} disabled={modal.saving} />
          <TextInput size="xs" label="창고" className={classes.matchFilterText}
            value={modal.filters?.warehouse ?? ''} onChange={setFilter('warehouse')} disabled={modal.saving} />
          <Button type="submit" size="xs" color="red" leftSection={<IconSearch size={14} />} loading={modal.loading} disabled={modal.saving}>조회</Button>
        </form>
        <div className={classes.matchTableScroll}><table className={classes.matchTable} style={{ width: `max(100%, ${matchTableWidth}px)`, minWidth: `${matchTableWidth}px` }}>
          <colgroup>{MATCH_COLUMNS.map((column) => <col key={column.key} data-column-key={column.key} style={{ width: `${matchColumnWidths[column.key] ?? column.width}px` }} />)}</colgroup>
          <thead><tr>{MATCH_COLUMNS.map((column) => <th key={column.key} className={classes.resizableHeader} style={{ textAlign: column.align || 'left' }}>
            {column.label}<span className={classes.columnResizeHandle} onPointerDown={(event) => resizeMatchColumn(event, column)} role="separator" aria-label={`${column.label} 열 너비 조절`} />
          </th>)}</tr></thead>
          <tbody>{modal.loading ? <tr><td colSpan={MATCH_COLUMNS.length} className={classes.empty}>현재고 후보를 불러오는 중입니다.</td></tr>
            : modal.candidates.length ? modal.candidates.map((candidate) => {
              const key = stockKey({ sourcetype: candidate.stocksourcetype, sourceno: candidate.stocksourceno, sourceline: candidate.stocksourceline });
              const checked = modal.selectedKeys.includes(key);
              const unavailable = Boolean(candidate.matched_elsewhere) && !checked;
              const rowClass = [checked ? classes.matchSelectedRow : '', unavailable ? classes.matchUnavailableRow : ''].filter(Boolean).join(' ');
              const toggleCandidate = () => { if (!unavailable) toggleStockCandidate(candidate); };
              return <tr key={key} className={rowClass} title={unavailable ? '다른 주문 품목에 이미 연결된 현재고입니다.' : undefined} onClick={toggleCandidate}>
                <td className={classes.center}><input type="checkbox" checked={checked} disabled={unavailable} onChange={toggleCandidate} onClick={(event) => event.stopPropagation()} /></td>
                <td title={candidate.master_itemname || candidate.itemname || ''}>{candidate.master_itemname || candidate.itemname || ''}</td>
                <td title={candidate.productname || ''}>{candidate.productname || ''}</td>
                <td title={candidate.materialname || candidate.materialcode || ''}>{candidate.materialname || candidate.materialcode || ''}</td>
                <td title={candidate.surfacename || candidate.surfacecode || ''}>{candidate.surfacename || candidate.surfacecode || ''}</td>
                <td className={classes.numeric}>{dimension(candidate.thickness)}</td>
                <td className={classes.numeric}>{dimension(candidate.width)}</td>
                <td className={classes.numeric}>{dimension(candidate.length)}</td>
                <td title={candidate.warehousecodename || candidate.warehousecode || ''}>{candidate.warehousecodename || candidate.warehousecode || ''}</td>
                <td className={classes.numeric}>{number(candidate.qty)} {candidate.qtyunit || ''}</td>
                <td className={classes.numeric}>{number(candidate.weight)}</td>
                <td title={candidate.stocksourceno || ''}>{candidate.stocksourceno}</td>
                <td className={classes.center}>{STOCK_SOURCE_LABELS[candidate.stocksourcetype] || candidate.stocksourcetype || ''}</td>
                <td className={classes.center}>{dateText(candidate.receiptdate)}</td>
                <td className={classes.center}>{candidate.stocksourceline}</td>
              </tr>;
            }) : <tr><td colSpan={MATCH_COLUMNS.length} className={classes.empty}>연결 가능한 현재고 후보가 없습니다. 두께 범위를 넓혀 조회하거나 재고 없음으로 처리할 수 있습니다.</td></tr>}
          </tbody></table></div>
        <div className={classes.matchPager}>
          <div className={classes.matchPagerGroup}>
            <span>총 {number(modal.total)}건</span>
            <Select size="xs" w={100} aria-label="페이지당 표시 건수" data={STOCK_MATCH_PAGE_OPTIONS} value={String(modal.pageSize)}
              allowDeselect={false} disabled={modal.loading || modal.saving}
              onChange={(value) => { if (value) changeStockCandidatePage(1, Number(value)); }} />
          </div>
          <div className={classes.matchPagerGroup}>
            <span>{number(modal.selectedKeys.length)}개 선택</span>
            <Pagination size="sm" total={Math.max(1, Math.ceil(modal.total / modal.pageSize))} value={modal.page}
              onChange={(page) => changeStockCandidatePage(page)} withEdges color="red" disabled={modal.loading || modal.saving || !modal.total} />
            <Button variant="default" className={classes.matchActionButton} onClick={() => setModal(null)} disabled={modal.saving}>취소</Button>
            <Button variant="default" className={classes.matchActionButton} onClick={() => void saveStockLinks(true)} disabled={modal.saving}>연결 초기화</Button>
            <Button color="red" onClick={() => void saveStockLinks(false)} loading={modal.saving}
              disabled={modal.loading || !modal.selectedKeys.length}>선택 재고 연결</Button>
          </div>
        </div>
      </Modal>;
    }
    if (modal.type === 'edit') return <Modal title="주문 변경" onClose={() => !saving && setModal(null)} actions={<><button type="button" className={classes.button} onClick={() => setModal(null)} disabled={saving}>닫기</button><button type="button" className={`${classes.button} ${classes.primary}`} onClick={() => void saveEdit()} disabled={saving}>{saving ? '저장 중…' : '저장'}</button></>}>
      <div className={classes.formGrid}>
        <label className={classes.formGridFull}>주문번호<input value={selectedOrder.isDraft ? '저장할 때 자동 부여' : selectedOrder.orderid} disabled /></label>
        <label>발주처<input value={modal.buyer} onChange={(event) => setModal((current) => ({ ...current, buyer: event.target.value }))} /></label>
        <label>수신처<input value={modal.recipient} onChange={(event) => setModal((current) => ({ ...current, recipient: event.target.value }))} /></label>
        <label>발주일자<input type="date" value={modal.orderDate} onChange={(event) => setModal((current) => ({ ...current, orderDate: event.target.value }))} /></label>
        <label>납기일자<input type="date" value={modal.due} onChange={(event) => setModal((current) => ({ ...current, due: event.target.value }))} /></label>
        <label className={classes.formGridFull}>납품장소<input value={modal.place} onChange={(event) => setModal((current) => ({ ...current, place: event.target.value }))} /></label>
      </div>
    </Modal>;
    return null;
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const itemCount = Number(selectedOrder?.item_count || 0);

  return <Box className={`${sharedClasses.pageShell} ${classes.page}`}>
      <Box component="nav" aria-label="현재 위치" className={inboundClasses.pageBreadcrumb}>
        <Group className={inboundClasses.breadcrumbTrail} gap={7}>
          <Text component="span" className={inboundClasses.breadcrumbParent}>가공관리</Text>
          <Text component="span" className={inboundClasses.breadcrumbChevron}>›</Text>
          <Text component="span" className={inboundClasses.breadcrumbCurrent}>주문관리</Text>
        </Group>
        {!filterOpen && <Button className={inboundClasses.receiptFilterToggle} variant="subtle" size="xs"
          leftSection={<IconFilter size={15} />} onClick={() => setFilterOpen(true)}>조회조건</Button>}
      </Box>

      <Box className={`${inboundClasses.inboundWorkspace} ${classes.orderWorkspace}`}>
        <Box className={`${inboundClasses.inboundPrimaryColumn} ${classes.orderPrimaryColumn}`}>
      <section className={`${classes.panel} ${classes.ordersPanel}`}>
        <header className={classes.panelHeader}><strong>주문 기본</strong><span className={classes.count}>{number(total)}건</span>{loading && <small>주문을 불러오는 중입니다.</small>}<Button size="compact-xs" variant="filled" color="red" className={`${classes.detailActionButton} ${classes.orderHeaderEditButton}`} leftSection={<IconPencil size={14} />} onClick={openEdit} disabled={!selectedOrder}>주문변경</Button>
          {/* 선택한 주문의 최적화 대기 품목을 가공 최적화에서 바로 연다 */}
          <Button size="compact-xs" variant="filled" color="red" className={classes.detailActionButton} leftSection={<IconAdjustments size={14} />}
            disabled={!selectedOrder || selectedOrder.isDraft || !['PARTIAL', 'SENT'].includes(selectedOrder.progress)}
            title={selectedOrder && !['PARTIAL', 'SENT'].includes(selectedOrder.progress) ? '가공 최적화로 보낸 품목이 없습니다' : '선택한 주문의 대기 품목으로 가공 최적화를 엽니다'}
            onClick={() => navigate(`/AIOrderOptimization?orderid=${encodeURIComponent(selectedOrder.orderid)}`)}>가공 최적화 이동</Button></header>
        <div ref={ordersScrollRef} className={`${classes.tableScroll} ${classes.ordersScroll}`} onScroll={syncScrollbarFromOrders}><table className={classes.ordersTable} style={{ width: `max(100%, ${orderTableWidth}px)`, minWidth: `${orderTableWidth}px` }}><colgroup>{ORDER_COLUMNS.map((column) => <col key={column.key} data-column-key={column.key} style={{ width: `${orderColumnWidths[column.key] ?? column.width}px` }} />)}</colgroup><thead><tr>{ORDER_COLUMNS.map((column) => <th key={column.key} className={classes.resizableHeader} style={{ width: orderColumnWidths[column.key] ?? column.width }}><span>{column.label}</span><span className={classes.columnResizeHandle} onPointerDown={(event) => resizeTableColumn(event, 'orders', column)} role="separator" aria-label={`Resize ${column.label} column`} /></th>)}</tr></thead>
          <tbody>{displayOrders.length ? displayOrders.map((order) => <tr key={order.orderid} className={order.orderid === selectedId ? classes.selectedRow : ''} onClick={() => setSelectedId(order.orderid)}>
            <td>{dateText(order.orderdate)}</td><td>{order.isDraft ? <Badge value="저장 전" tone="orange" /> : order.orderid}</td><td>{order.buyer || ''}</td><td>{order.recipient || ''}</td><td>{dateText(order.duedate)}</td><td title={order.deliverylocation || ''}>{order.deliverylocation || ''}</td><td className={classes.center}>{number(order.item_count)}</td><td className={classes.numeric}>{number(order.total_weight)}</td><td><Badge value={(ORDER_PROGRESS[order.progress] || ORDER_PROGRESS.NONE).label} tone={(ORDER_PROGRESS[order.progress] || ORDER_PROGRESS.NONE).tone} /></td><td>{order.notes || ''}</td><td>{order.created_by || ''}</td><td>{order.updated_by || ''}</td></tr>
          ) : <tr><td colSpan={ORDER_COLUMNS.length} className={classes.empty}>{loading ? '주문을 불러오는 중입니다.' : '조회된 확정 주문이 없습니다.'}</td></tr>}</tbody></table></div>
        <div ref={ordersHorizontalScrollRef} className={classes.ordersHorizontalScroll} onScroll={syncOrdersFromScrollbar} aria-label="주문 기본 가로 스크롤">
          <div className={classes.ordersHorizontalContent} style={{ width: `max(100%, ${orderTableWidth}px)` }} />
        </div>
        <footer className={classes.panelFooter}>
          <Group gap="xs">
            <Select aria-label="페이지당 표시 건수" data={PAGE_SIZE_OPTIONS} value={String(pageSize)} w={100} size="xs"
              onChange={(value) => { if (value) { setPageSize(Number(value)); setPage(1); } }} />
          </Group>
          <div className={classes.pager}><button type="button" disabled={page <= 1 || loading} onClick={() => setPage(1)}>«</button><button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>‹</button><b>{page}</b><button type="button" disabled={page >= totalPages || loading} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>›</button><button type="button" disabled={page >= totalPages || loading} onClick={() => setPage(totalPages)}>»</button></div>
        </footer>
      </section>

      <section className={`${classes.panel} ${classes.detailPanel}`}>
        <header className={classes.panelHeader}><strong>주문 상세</strong><span className={`${classes.count} ${isDraftSelected ? classes.orange : classes.blue}`}>{isDraftSelected ? '저장 전 · 확인 후 [저장]' : selectedOrder?.orderid || '주문을 선택하세요'}</span>
          <Group gap={6} wrap="nowrap" className={classes.detailHeaderActions}>
            <Button size="compact-xs" variant="default" className={classes.secondaryActionButton} onClick={() => void changeOptimizeStatus(false)}
              disabled={!selectedOrder || saving || detailLoading || !optimizeTargets.recall}
              title="최적화 대기 품목을 주문서 관리로 되돌립니다 (선택 없으면 전체)">보내기 취소</Button>
            <Button size="compact-xs" variant="filled" color="red" className={classes.detailActionButton} onClick={() => void changeOptimizeStatus(true)}
              disabled={!selectedOrder || saving || detailLoading || !optimizeTargets.send}
              title="선택한 품목을 가공 최적화로 보냅니다 (선택 없으면 미전송 전체)">가공 최적화로 보내기</Button>
          </Group>
        </header>
        <div className={`${classes.tableScroll} ${classes.detailsScroll}`}><table className={classes.detailsTable} style={{ width: `max(100%, ${detailTableWidth}px)`, minWidth: `${detailTableWidth}px` }}><colgroup>{DETAIL_COLUMNS.map((column) => <col key={column.key} data-column-key={column.key} style={{ width: `${detailColumnWidths[column.key] ?? column.width}px` }} />)}</colgroup><thead><tr>{DETAIL_COLUMNS.map((column) => column.key === 'select' ? <th key={column.key} className={`${classes.checkColumn} ${classes.resizableHeader}`} style={{ width: detailColumnWidths[column.key] ?? column.width }}><input type="checkbox" aria-label="Select all order details" checked={itemDrafts.length > 0 && selectedItemKeys.length === itemDrafts.length} onChange={toggleAllItemSelection} disabled={!itemDrafts.length || detailLoading} /><span className={classes.columnResizeHandle} onPointerDown={(event) => resizeTableColumn(event, 'details', column)} role="separator" aria-label="Resize selection column" /></th> : <th key={column.key} className={classes.resizableHeader} style={{ width: detailColumnWidths[column.key] ?? column.width }}><span>{column.label}{column.required && <span className={classes.requiredMark}> *</span>}</span><span className={classes.columnResizeHandle} onPointerDown={(event) => resizeTableColumn(event, 'details', column)} role="separator" aria-label={`Resize ${column.label} column`} /></th>)}</tr></thead>
          <tbody>{itemDrafts.length ? itemDrafts.map((item, index) => <tr key={item._rowKey} className={selectedItemKeys.includes(item._rowKey) ? classes.selectedDetailRow : ''}>
            <td className={classes.checkColumn}><input type="checkbox" aria-label={`${index + 1}행 선택`} checked={selectedItemKeys.includes(item._rowKey)} onChange={(event) => toggleItemSelection(item._rowKey, event.nativeEvent.shiftKey)} /></td>
            <td className={`${classes.center} ${classes.detailTextCell}`}>{index + 1}</td>
            <td title={item.itemname || ''}>{detailInput(item, 'itemname', false, index)}</td>
            <td title={item.steelgrade || ''}>{detailInput(item, 'steelgrade', false, index)}</td>
            <td title={item.surface || ''}>{detailInput(item, 'surface', false, index)}</td>
            <td className={classes.numeric}>{detailInput(item, 'thickness', true, index)}</td>
            <td className={classes.numeric}>{detailInput(item, 'width', true, index)}</td>
            <td className={classes.numeric}>{detailInput(item, 'length', true, index)}</td>
            <td className={classes.numeric}>{detailInput(item, 'quantity', true, index)}</td>
            <td className={classes.numeric}>{detailInput(item, 'weight_kg', true, index)}</td>
            <td className={classes.detailTextCell}>{item.stock_matches?.length
              ? <Popover position="bottom-start" withArrow shadow="sm" withinPortal>
                <Popover.Target>
                  <button type="button" className={classes.stockMatchTrigger} title="연결된 재고 확인">
                    <span>{item.stock_matches?.length
                      ? `${item.stock_matches[0].itemname || item.stock_matches[0].productname || item.stock_matches[0].sourceno}${stockSize(item.stock_matches[0]) ? ` ${stockSize(item.stock_matches[0])}` : ''}${item.stock_matches.length > 1 ? ` 외 ${item.stock_matches.length - 1}건` : ''}`
                      : '연결 재고 확인'}</span>
                  </button>
                </Popover.Target>
                <Popover.Dropdown className={classes.stockMatchPopover}>
                  {(item.stock_matches || []).map((match, matchIndex) => {
                    const itemLabel = match.itemname || match.productname || '현재고 품목';
                    const sizeLabel = stockSize(match);
                    const meta = [
                      match.weight_kg !== null && match.weight_kg !== undefined ? `${dimension(match.weight_kg)}kg` : null,
                      match.warehouse || null,
                      match.itemname || null,
                    ].filter(Boolean).join(' · ');
                    return <div className={classes.stockMatchItem} key={`${match.sourcetype}|${match.sourceno}|${match.sourceline}|${matchIndex}`}>
                      <div className={classes.stockMatchNameLine}>
                        <strong>{itemLabel}{sizeLabel ? ` ${sizeLabel}` : ''}</strong>
                      </div>
                      <div className={classes.stockMatchMeta}>{meta || '품명 정보 없음'}</div>
                    </div>;
                  })}
                </Popover.Dropdown>
              </Popover>
              : <span className={classes.unmatchedStock}>미선택</span>}</td>
            <td className={classes.detailTextCell}>{LINE_PROGRESS[item.optimize_status]
              ? <Badge value={LINE_PROGRESS[item.optimize_status].label} tone={LINE_PROGRESS[item.optimize_status].tone} />
              : <span className={classes.unmatchedStock}>미전송</span>}</td>
            <td className={classes.center}><button type="button" className={classes.matchButton} onClick={() => void openStockMatcher(item)} disabled={!item.lineno || detailLoading || isLocked(item)}
              title={isLocked(item) ? '가공 최적화로 보낸 품목은 재고매칭을 바꿀 수 없습니다.' : undefined}>재고매칭</button></td>
            <td title={item.notes || ''}>{detailInput(item, 'notes', false, index)}</td>
          </tr>)
            : <tr><td colSpan={DETAIL_COLUMNS.length} className={classes.empty}>{selectedOrder ? (detailLoading ? '상세 품목을 불러오는 중입니다.' : '상세 품목이 없습니다. 행 추가로 품목을 등록하세요.') : '주문을 선택하세요.'}</td></tr>}</tbody></table></div>
        <footer className={classes.panelFooter}><span>총 {number(selectedOrder ? itemDrafts.length : itemCount)}건 · 주문중량 {number(detailWeight)} KG</span></footer>
      </section>
        </Box>
        {filterOpen && <Paper component="aside" className={`${inboundClasses.receiptFilterSidebar} ${classes.orderFilterSidebar}`} withBorder>
          <Group className={inboundClasses.receiptFilterHeader} justify="space-between" align="center">
            <Text fw={700}>조회조건</Text>
            <ActionIcon variant="subtle" color="gray" aria-label="조회조건 닫기" onClick={() => setFilterOpen(false)}><IconX size={16} /></ActionIcon>
          </Group>
          <form className={classes.filterForm} onSubmit={(event) => { event.preventDefault(); }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              // 날짜 입력은 Enter로 조회하지 않는다.
              if (event.target instanceof HTMLInputElement && event.target.type === 'date') return;
              applySearch();
            }}>
            <Stack gap="sm" className={inboundClasses.receiptFilterFields}>
              <Box>
                <Text size="xs" fw={700} mb={5}>주문일 기간</Text>
                <Stack gap={6}>
                  <ErpDateInput aria-label="주문일 시작" value={draftFilters.from}
                    onChange={(event) => editField('from', event.currentTarget.value)}
                    onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); } }} />
                  <ErpDateInput aria-label="주문일 종료" value={draftFilters.to}
                    onChange={(event) => editField('to', event.currentTarget.value)}
                    onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); } }} />
                </Stack>
              </Box>
              <TextInput label="발주처" placeholder="발주처 검색" value={draftFilters.customer}
                onChange={(event) => editField('customer', event.currentTarget.value)} />
              <TextInput label="주문번호" placeholder="주문번호 검색" value={draftFilters.orderNo}
                onChange={(event) => editField('orderNo', event.currentTarget.value)} />
              <Select label="진행상태" aria-label="진행상태" allowDeselect={false} value={draftFilters.progress || 'ALL'}
                data={[{ value: 'ALL', label: '전체' }, ...Object.entries(ORDER_PROGRESS).map(([value, { label }]) => ({ value, label }))]}
                onChange={(value) => editField('progress', value || 'ALL')} comboboxProps={{ withinPortal: true }} />
            </Stack>
          </form>
        </Paper>}
      </Box>
    {renderModal()}
  </Box>;
}
