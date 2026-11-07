import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { ActionIcon, Box, Button, Group, Modal as MantineModal, Paper, Select, Stack, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconFilter, IconPencil, IconTrash, IconX } from '@tabler/icons-react';
import { useSearchParams } from 'react-router-dom';
import ErpDateInput from '../../components/common/ErpDateInput';
import useErpPageRibbon from '../../components/common/useErpPageRibbon';
import sharedClasses from '../../styles/pages/ManagementShared.module.css';
import inboundClasses from '../../styles/pages/InboundRegister.module.css';
import classes from '../../styles/pages/AIOrderRegistry.module.css';

const PAGE_SIZE_OPTIONS = [
  { value: '15', label: '15개씩' },
  { value: '50', label: '50개씩' },
  { value: '100', label: '100개씩' },
  { value: '200', label: '200개씩' },
];
const DETAIL_NAV_FIELDS = ['itemname', 'steelgrade', 'size', 'thickness', 'width', 'length', 'quantity', 'quantity_unit', 'weight_kg', 'notes'];
const ORDER_COLUMNS = [
  { key: 'orderdate', label: '주문일자', width: 105, minWidth: 78 },
  { key: 'orderid', label: '주문번호', width: 175, minWidth: 110 },
  { key: 'buyer', label: '발주처', width: 105, minWidth: 80 },
  { key: 'receiver', label: '수신처', width: 100, minWidth: 75 },
  { key: 'duedate', label: '납기일', width: 105, minWidth: 78 },
  { key: 'deliverylocation', label: '납품장소', width: 170, minWidth: 100 },
  { key: 'detailcount', label: '상세건수', width: 80, minWidth: 65 },
  { key: 'weight', label: '주문중량(KG)', width: 120, minWidth: 90 },
  { key: 'progress', label: '가공진행', width: 125, minWidth: 85 },
  { key: 'notes', label: '비고', width: 130, minWidth: 80 },
];
const DETAIL_COLUMNS = [
  { key: 'select', label: '', width: 40, minWidth: 34 },
  { key: 'lineno', label: '순번', width: 55, minWidth: 42 },
  { key: 'itemname', label: '품명', width: 150, minWidth: 90 },
  { key: 'steelgrade', label: '강종', width: 100, minWidth: 65 },
  { key: 'size', label: '규격 원문', width: 150, minWidth: 90 },
  { key: 'thickness', label: '두께', width: 75, minWidth: 55 },
  { key: 'width', label: '폭', width: 75, minWidth: 55 },
  { key: 'length', label: '길이', width: 75, minWidth: 55 },
  { key: 'quantity', label: '수량', width: 95, minWidth: 65 },
  { key: 'quantity_unit', label: '수량단위', width: 85, minWidth: 65 },
  { key: 'weight_kg', label: '중량(KG)', width: 110, minWidth: 75 },
  { key: 'stock', label: '재고매칭', width: 115, minWidth: 80 },
  { key: 'processing', label: '가공상태', width: 125, minWidth: 85 },
  { key: 'notes', label: '비고', width: 125, minWidth: 80 },
];
const createDefaultOrderFilters = (orderNo = '', orderDate = '') => {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const pad = (value) => String(value).padStart(2, '0');
  return {
    from: /^\d{4}-\d{2}-\d{2}$/.test(orderDate) ? orderDate : `${year}-${pad(month + 1)}-01`,
    to: `${year}-${pad(month + 1)}-${pad(new Date(year, month + 1, 0).getDate())}`,
    customer: '',
    orderNo,
  };
};
const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });
const dateText = (value) => value ? String(value).slice(0, 10) : '';
const number = (value) => Number(value || 0).toLocaleString('ko-KR');
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

function Badge({ value, tone = 'blue' }) {
  return <span className={`${classes.badge} ${classes[tone]}`}>{value}</span>;
}

function Modal({ title, children, actions, onClose }) {
  return <div className={classes.modalBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={classes.modal} role="dialog" aria-modal="true" aria-label={title}>
      <header className={classes.modalHeader}><strong>{title}</strong><button type="button" className={classes.closeIcon} aria-label="닫기" onClick={onClose}><IconX size={18} /></button></header>
      <div className={classes.modalBody}>{children}</div>
      <footer className={classes.modalFooter}>{actions}</footer>
    </section>
  </div>;
}

export default function AIOrderManage() {
  const [searchParams] = useSearchParams();
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
  const [filterOpen, setFilterOpen] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [applied, setApplied] = useState(() => createDefaultOrderFilters(initialOrderId, initialOrderDate));
  const [draftFilters, setDraftFilters] = useState(() => createDefaultOrderFilters(initialOrderId, initialOrderDate));
  const [modal, setModal] = useState(null);
  const selectedOrder = orders.find(({ orderid }) => orderid === selectedId) || null;
  const detailWeight = useMemo(() => itemDrafts.reduce((sum, item) => {
    const value = Number(item.weight_kg || 0);
    return Number.isFinite(value) ? sum + value : sum;
  }, 0), [itemDrafts]);
  const syncOrdersHorizontalScroll = (source) => {
    const left = source.currentTarget.scrollLeft;
    for (const element of [ordersScrollRef.current, ordersHorizontalScrollRef.current]) {
      if (element && element !== source.currentTarget && Math.abs(element.scrollLeft - left) > 0.5) {
        element.scrollLeft = left;
      }
    }
  };
  const resizeTableColumn = (event, tableType, column) => {
    event.preventDefault();
    event.stopPropagation();
    const columns = tableType === 'orders' ? ORDER_COLUMNS : DETAIL_COLUMNS;
    const widthState = tableType === 'orders' ? orderColumnWidths : detailColumnWidths;
    const setWidthState = tableType === 'orders' ? setOrderColumnWidths : setDetailColumnWidths;
    const minTableWidth = tableType === 'orders' ? 1315 : 1440;
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
  const orderTableWidth = Math.max(1315, ORDER_COLUMNS.reduce((sum, column) => sum + (orderColumnWidths[column.key] ?? column.width), 0));
  const detailTableWidth = Math.max(1440, DETAIL_COLUMNS.reduce((sum, column) => sum + (detailColumnWidths[column.key] ?? column.width), 0));

  useEffect(() => {
    setSelectedItemKeys([]);
    const rows = detail?.header?.orderid === selectedId && Array.isArray(detail.items)
      ? detail.items.map((item) => ({
        ...item,
        _rowKey: `saved-${selectedId}-${item.lineno}`,
        itemname: item.itemname || '',
        steelgrade: item.steelgrade || '',
        size: item.size || '',
        thickness: item.thickness ?? '',
        width: item.width ?? '',
        length: item.length ?? '',
        quantity: item.quantity ?? item.quantity_raw ?? '',
        quantity_unit: item.quantity_unit || '',
        weight_kg: item.weight_kg ?? item.weight_raw ?? '',
        notes: item.notes || '',
      }))
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
      }).filter(([, value]) => value));
      const { data } = await axios.get('/api/ai-order/confirmed', {
        ...authConfig(), params: { ...params, page, page_size: pageSize },
      });
      const rows = Array.isArray(data?.items) ? data.items : [];
      setOrders(rows);
      setTotal(Number(data?.total || 0));
      setSelectedId((current) => rows.some((row) => row.orderid === current) ? current : (rows[0]?.orderid || ''));
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

  useEffect(() => {
    if (!selectedId) { setDetail(null); return undefined; }
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

  const saveEdit = async () => {
    if (!selectedOrder || !modal || saving) return;
    if (!modal.due) return notify('납기일을 입력해 주세요.', '필수 항목 확인');
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
      _rowKey, lineno: null, itemname: '', steelgrade: '', size: '', thickness: '',
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
    const activeDrafts = itemDrafts.filter((row) => row.lineno || ['itemname', 'steelgrade', 'size', 'thickness', 'width', 'length', 'quantity', 'quantity_unit', 'weight_kg', 'notes']
      .some((key) => String(row[key] ?? '').trim()));
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
        <Text size="sm" c="dimmed">{selectedOrder.orderid} 주문과 상세 내역을 삭제합니다. 삭제한 주문은 복구할 수 없습니다.</Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setModal(null)} disabled={saving}>취소</Button>
          <Button color="red" leftSection={<IconTrash size={15} />} onClick={() => void deleteOrder()} loading={saving}>삭제</Button>
        </Group>
      </Stack>
    </MantineModal>;
    if (modal.type === 'edit') return <Modal title="주문 변경" onClose={() => !saving && setModal(null)} actions={<><button type="button" className={classes.button} onClick={() => setModal(null)} disabled={saving}>닫기</button><button type="button" className={`${classes.button} ${classes.primary}`} onClick={() => void saveEdit()} disabled={saving}>{saving ? '저장 중…' : '저장'}</button></>}>
      <div className={classes.formGrid}>
        <label className={classes.formGridFull}>주문번호<input value={selectedOrder.orderid} disabled /></label>
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
        <header className={classes.panelHeader}><strong>주문 기본</strong><span className={classes.count}>{number(total)}건</span>{loading && <small>주문을 불러오는 중입니다.</small>}</header>
        <div ref={ordersScrollRef} className={`${classes.tableScroll} ${classes.ordersScroll}`} onScroll={syncOrdersHorizontalScroll}><table className={classes.ordersTable} style={{ width: `max(100%, ${orderTableWidth}px)`, minWidth: `${orderTableWidth}px` }}><colgroup>{ORDER_COLUMNS.map((column) => <col key={column.key} data-column-key={column.key} style={{ width: `${orderColumnWidths[column.key] ?? column.width}px` }} />)}</colgroup><thead><tr>{ORDER_COLUMNS.map((column) => <th key={column.key} className={classes.resizableHeader} style={{ width: orderColumnWidths[column.key] ?? column.width }}><span>{column.label}</span><span className={classes.columnResizeHandle} onPointerDown={(event) => resizeTableColumn(event, 'orders', column)} role="separator" aria-label={`Resize ${column.label} column`} /></th>)}</tr></thead>
          <tbody>{orders.length ? orders.map((order) => <tr key={order.orderid} className={order.orderid === selectedId ? classes.selectedRow : ''} onClick={() => setSelectedId(order.orderid)}>
            <td>{dateText(order.orderdate)}</td><td>{order.orderid}</td><td>{order.buyer || ''}</td><td>{order.recipient || ''}</td><td>{dateText(order.duedate)}</td><td title={order.deliverylocation || ''}>{order.deliverylocation || ''}</td><td className={classes.center}>{number(order.item_count)}</td><td className={classes.numeric}>{number(order.total_weight)}</td><td><Badge value="검토 대기" tone="orange" /></td><td /></tr>
          ) : <tr><td colSpan="10" className={classes.empty}>{loading ? '주문을 불러오는 중입니다.' : '조회된 확정 주문이 없습니다.'}</td></tr>}</tbody></table></div>
        <div ref={ordersHorizontalScrollRef} className={classes.ordersHorizontalScroll} onScroll={syncOrdersHorizontalScroll} aria-label="주문 기본 가로 스크롤">
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
        <header className={classes.panelHeader}><strong>주문 상세</strong><span className={`${classes.count} ${classes.blue}`}>{selectedOrder?.orderid || '주문을 선택하세요'}</span>
          <Group className={classes.detailActions} gap={5}>
            <Button size="compact-xs" variant="filled" color="red" className={classes.detailActionButton} leftSection={<IconPencil size={14} />} onClick={openEdit} disabled={!selectedOrder}>주문변경</Button>
          </Group>
        </header>
        <div className={`${classes.tableScroll} ${classes.detailsScroll}`}><table className={classes.detailsTable} style={{ width: `max(100%, ${detailTableWidth}px)`, minWidth: `${detailTableWidth}px` }}><colgroup>{DETAIL_COLUMNS.map((column) => <col key={column.key} data-column-key={column.key} style={{ width: `${detailColumnWidths[column.key] ?? column.width}px` }} />)}</colgroup><thead><tr>{DETAIL_COLUMNS.map((column) => column.key === 'select' ? <th key={column.key} className={`${classes.checkColumn} ${classes.resizableHeader}`} style={{ width: detailColumnWidths[column.key] ?? column.width }}><input type="checkbox" aria-label="Select all order details" checked={itemDrafts.length > 0 && selectedItemKeys.length === itemDrafts.length} onChange={toggleAllItemSelection} disabled={!itemDrafts.length || detailLoading} /><span className={classes.columnResizeHandle} onPointerDown={(event) => resizeTableColumn(event, 'details', column)} role="separator" aria-label="Resize selection column" /></th> : <th key={column.key} className={classes.resizableHeader} style={{ width: detailColumnWidths[column.key] ?? column.width }}><span>{column.label}</span><span className={classes.columnResizeHandle} onPointerDown={(event) => resizeTableColumn(event, 'details', column)} role="separator" aria-label={`Resize ${column.label} column`} /></th>)}</tr></thead>
          <tbody>{itemDrafts.length ? itemDrafts.map((item, index) => <tr key={item._rowKey} className={selectedItemKeys.includes(item._rowKey) ? classes.selectedDetailRow : ''}>
            <td className={classes.checkColumn}><input type="checkbox" aria-label={`${index + 1}행 선택`} checked={selectedItemKeys.includes(item._rowKey)} onChange={(event) => toggleItemSelection(item._rowKey, event.nativeEvent.shiftKey)} /></td>
            <td className={`${classes.center} ${classes.detailTextCell}`}>{index + 1}</td>
            <td title={item.itemname || ''}>{detailInput(item, 'itemname', false, index)}</td>
            <td>{detailInput(item, 'steelgrade', false, index)}</td>
            <td>{detailInput(item, 'size', false, index)}</td>
            <td className={classes.numeric}>{detailInput(item, 'thickness', true, index)}</td>
            <td className={classes.numeric}>{detailInput(item, 'width', true, index)}</td>
            <td className={classes.numeric}>{detailInput(item, 'length', true, index)}</td>
            <td className={classes.numeric}>{detailInput(item, 'quantity', true, index)}</td>
            <td>{detailInput(item, 'quantity_unit', false, index)}</td>
            <td className={classes.numeric}>{detailInput(item, 'weight_kg', true, index)}</td>
            <td className={classes.detailTextCell}>미조회</td><td className={classes.detailTextCell}>검토 대기</td>
            <td title={item.notes || ''}>{detailInput(item, 'notes', false, index)}</td>
          </tr>)
            : <tr><td colSpan="14" className={classes.empty}>{selectedOrder ? (detailLoading ? '상세 품목을 불러오는 중입니다.' : '상세 품목이 없습니다. 행 추가로 품목을 등록하세요.') : '주문을 선택하세요.'}</td></tr>}</tbody></table></div>
        <footer className={classes.panelFooter}><span>총 {number(selectedOrder ? itemDrafts.length : itemCount)}건 · 주문중량 {number(detailWeight)} KG</span></footer>
      </section>
        </Box>
        {filterOpen && <Paper component="aside" className={`${inboundClasses.receiptFilterSidebar} ${classes.orderFilterSidebar}`} withBorder>
          <Group className={inboundClasses.receiptFilterHeader} justify="space-between" align="center">
            <Text fw={700}>조회조건</Text>
            <ActionIcon variant="subtle" color="gray" aria-label="조회조건 닫기" onClick={() => setFilterOpen(false)}><IconX size={16} /></ActionIcon>
          </Group>
          <form className={classes.filterForm} onSubmit={(event) => { event.preventDefault(); applySearch(); }}>
            <Stack gap="sm" className={inboundClasses.receiptFilterFields}>
              <Box>
                <Text size="xs" fw={700} mb={5}>주문일 기간</Text>
                <Stack gap={6}>
                  <ErpDateInput aria-label="주문일 시작" value={draftFilters.from}
                    onChange={(event) => editField('from', event.currentTarget.value)} onKeyDown={(event) => { if (event.key === 'Enter') applySearch(); }} />
                  <ErpDateInput aria-label="주문일 종료" value={draftFilters.to}
                    onChange={(event) => editField('to', event.currentTarget.value)} onKeyDown={(event) => { if (event.key === 'Enter') applySearch(); }} />
                </Stack>
              </Box>
              <TextInput label="발주처" placeholder="발주처 검색" value={draftFilters.customer}
                onChange={(event) => editField('customer', event.currentTarget.value)} />
              <TextInput label="주문번호" placeholder="주문번호 검색" value={draftFilters.orderNo}
                onChange={(event) => editField('orderNo', event.currentTarget.value)} />
            </Stack>
          </form>
        </Paper>}
      </Box>
    {renderModal()}
  </Box>;
}
