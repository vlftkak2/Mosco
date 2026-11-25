// 통제관리 (어드민 › 통제관리) — backend/services/control/Approval.py
// 담당자가 거래처 · 매입 · 매출 · 수금/지급을 등록 · 수정 · 삭제하면 승인요청으로 보관되고, 승인자가 승인해야 반영된다.
//  메뉴권한 '통제관리' = 이 화면에 들어와 설정을 바꾸는 권한, 승인 · 반려는 통제 설정에서 체크한 승인자만 (본인 요청도 승인 가능)
//  승인함   : 대기 건을 보고 승인 / 반려(사유), 상태를 '전체'로 바꾸면 처리 기록 전체
//  내 요청  : 모든 직원 — 내가 요청한 건의 결과, 대기 건 취소 (헤더 알림을 누르면 열림)
//  통제 설정: 대상 × 등록 · 수정 · 삭제별 켜기 + 금액 조건(켜짐 AND 금액 이상), 승인자 체크, 저장은 위 리본
// 표는 모두 머리글 오른쪽 끝을 끌어 칸 너비를 바꿀 수 있다.
import { memo, useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { useLocation } from 'react-router-dom';
import { Box, Group, Loader, NumberInput, Pagination, Paper, Select, Switch, Text, TextInput, Textarea } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import ErpDateInput from '../../components/common/ErpDateInput';
import { ColumnResizeHandle, pickerClasses, useResizableColumns } from '../../components/common/PickerModal';
import useErpPageRibbon from '../../components/common/useErpPageRibbon';
import usePageReactivated from '../../components/common/usePageReactivated';
import sharedClasses from '../../styles/pages/ManagementShared.module.css';
import simpleTheme from '../../styles/pages/SimpleTheme.module.css';
import classes from '../../styles/pages/InboundRegister.module.css';
import own from '../../styles/pages/ControlManagement.module.css';

const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });
const errorText = (error, fallback = '처리하지 못했습니다.') => {
  const detail = error.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail) && detail[0]?.msg) return String(detail[0].msg).replace(/^Value error, /, '');
  return fallback;
};
// 시각은 한국시간 'YYYY-MM-DD HH:mm' (포맷터는 한 번만 만든다)
const KST_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const kst = (value) => {
  if (!value) return '';
  const p = Object.fromEntries(KST_FORMAT.formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
};
// 목록용 짧은 시각 'MM-DD HH:mm'
const kstShort = (value) => kst(value).slice(5);
const num = (value, digits = 3) => (value === null || value === undefined || value === '' ? ''
  : Number(value).toLocaleString('ko-KR', { maximumFractionDigits: digits }));
const won = (value) => (value === null || value === undefined ? '' : `${num(value, 0)}원`);

const STATUS_OPTIONS = [
  { value: '', label: '전체 상태' }, { value: 'PENDING', label: '대기' }, { value: 'APPROVED', label: '승인' },
  { value: 'REJECTED', label: '반려' }, { value: 'CANCELED', label: '취소' },
];
const TARGET_OPTIONS = [
  { value: '', label: '전체 구분' }, { value: 'CUSTOMER', label: '거래처' }, { value: 'INBOUND', label: '매입' },
  { value: 'OUTBOUND', label: '매출' }, { value: 'RECEIPT_PAYMENT', label: '수금/지급' },
];
const STATUS_CLASS = { PENDING: own.wait, PROCESSING: own.wait, APPROVED: own.ok, REJECTED: own.no, CANCELED: own.muted };
const PAGE_SIZE = 30;
// 기본 기간: 이번 달 (한국시간 1일 ~ 말일)
const thisMonth = () => {
  const today = kst(new Date()).slice(0, 10);
  const [y, m] = today.split('-').map(Number);
  return { date_from: `${today.slice(0, 8)}01`, date_to: `${today.slice(0, 8)}${String(new Date(y, m, 0).getDate()).padStart(2, '0')}` };
};
// 한 번 본 요청 상세는 바로 다시 보여 준다 (대기 건은 매번 새로 받고, 처리하면 지움)
const DETAIL_CACHE = new Map();

// ── 표 칸 (너비는 끌어서 바꿈) ──
const LIST_COLUMNS = [
  { key: 'requested_at', label: '요청일시', width: 108 },
  { key: 'kind', label: '구분', width: 78 },
  { key: 'summary', label: '내용', width: 164 },
  { key: 'amount', label: '금액', width: 92, align: 'right' },
  { key: 'requester', label: '요청자', width: 60 },
  { key: 'status', label: '상태', width: 58, align: 'center' },
];
const CUSTOMER_COLUMNS = [
  { key: 'code', label: '거래처코드', width: 100 }, { key: 'name', label: '거래처명', width: 150 }, { key: 'bizno', label: '사업자번호', width: 120 },
  { key: 'ceo', label: '대표자', width: 90 }, { key: 'manager', label: '담당자', width: 90 }, { key: 'phone', label: '전화', width: 120 },
];
const OUT_COLUMNS = [
  { key: 'sourceno', label: '원천전표', width: 124 }, { key: 'sourceline', label: '순번', width: 48, align: 'right' },
  { key: 'qty', label: '수량', width: 64, align: 'right' }, { key: 'weight', label: '중량(kg)', width: 92, align: 'right' },
  { key: 'price', label: '단가', width: 84, align: 'right' },
];
const IN_COLUMNS = [
  { key: 'item', label: '품명', width: 80 }, { key: 'thick', label: '두께', width: 46, align: 'right' }, { key: 'width', label: '폭', width: 56, align: 'right' },
  { key: 'length', label: '길이', width: 54, align: 'right' }, { key: 'qty', label: '수량', width: 48, align: 'right' },
  { key: 'weight', label: '중량(kg)', width: 70, align: 'right' }, { key: 'price', label: '단가', width: 66, align: 'right' },
];
const RP_KEYS = [['cashamt', '현금'], ['instrumentamt', '어음/수표'], ['bankamt', '은행'], ['cardamt', '카드'], ['offsetamt', '상계'], ['lossamt', '잡손실'], ['chargeamt', '수수료']];
const RP_COLUMNS = [...RP_KEYS.map(([key, label]) => ({ key, label, width: 92, align: 'right' })), { key: 'desc', label: '비고', width: 140 }];
const RESERVE_COLUMNS = [
  { key: 'sourceno', label: '원천전표', width: 124 }, { key: 'sourceline', label: '순번', width: 48, align: 'right' },
  { key: 'item', label: '품명', width: 96 }, { key: 'spec', label: '규격', width: 104 },
  { key: 'qty', label: '수량', width: 56, align: 'right' }, { key: 'weight', label: '중량(kg)', width: 84, align: 'right' },
];
const APPROVER_COLUMNS = [
  { key: 'check', label: '승인자', width: 64, align: 'center' },
  { key: 'name', label: '이름', width: 120 }, { key: 'email', label: '이메일', width: 220 }, { key: 'team', label: '부서', width: 120 },
  { key: 'position', label: '직급', width: 100 }, { key: 'authority', label: '권한', width: 110 },
];

const alignClass = (column) => (column.align === 'right' ? own.num : column.align === 'center' ? own.center : '');

// 칸 너비를 끌어서 바꾸는 표 (머리글 오른쪽 끝 손잡이)
function GridTable({ columns, children, empty }) {
  const cols = useResizableColumns(columns);
  return <table className={own.table} style={{ width: `max(100%, ${cols.tableWidth}px)` }}>
    <colgroup>{columns.map((column) => <col key={column.key} data-column-key={column.key} style={{ width: cols.widthOf(column) }} />)}</colgroup>
    <thead><tr>{columns.map((column) => <th key={column.key} className={`${pickerClasses.resizableHead} ${alignClass(column)}`}>
      {column.label}<ColumnResizeHandle column={column} columns={cols} />
    </th>)}</tr></thead>
    <tbody>{children}{empty ? <tr><td colSpan={columns.length} className={own.emptyCell}>{empty}</td></tr> : null}</tbody>
  </table>;
}

const StatusPill = ({ status, label }) => <span className={`${own.pill} ${STATUS_CLASS[status] || ''}`}>{label}</span>;

// 요청 내용의 핵심 정보 (일자 · 거래처 · 품목 수 · 중량 · 금액 …)를 칸으로 나눈다
function requestFacts(item) {
  const data = item.data || {};
  const body = data.item || {};
  const facts = [];
  if (item.op === 'delete' || item.op === 'manager' || item.op === 'sales_fields') {
    facts.push(['전표', data.receiptno]);
    if (item.op === 'manager') facts.push(['바꿀 담당자', data.manager || '(없음)']);
    if (item.op === 'sales_fields') {
      if (body.manager !== null && body.manager !== undefined) facts.push(['담당자', body.manager || '(없음)']);
      if (body.destination !== null && body.destination !== undefined) facts.push(['착지', body.destination || '(없음)']);
      if ((body.prices || []).length) facts.push(['단가 변경', `${body.prices.length}행`]);
    }
    return facts;
  }
  if (item.target === 'CUSTOMER') {
    const rows = item.op === 'bulk_create' ? (data.items || []) : [body];
    if (rows.length > 1) return [['일괄 등록', `${rows.length.toLocaleString('ko-KR')}곳`], ['첫 거래처', rows[0]?.customername]];
    return [['거래처명', body.customername], ['거래처코드', body.customercode || '자동'], ['사업자번호', body.businessno || '-'], ['대표자', body.ceoname || '-']];
  }
  const lines = body.items || [];
  facts.push(['일자', String(body.receptdate || body.receiptdate || '').slice(0, 10)]);
  facts.push(['거래처', body.customname || lines[0]?.customname || '-']);
  if (item.target === 'RECEIPT_PAYMENT') {
    facts.push(['구분', body.transactiontype === 'RECEIPT' ? '수금' : '지급']);
  } else {
    facts.push(['품목', `${lines.length.toLocaleString('ko-KR')}건`]);
    facts.push(['중량', `${num(lines.reduce((sum, row) => sum + Number(row.weight || 0), 0), 1)}kg`]);
  }
  if (body.receiptno) facts.push(['수정 전표', body.receiptno]);
  if (body.manager) facts.push(['담당자', body.manager]);
  return facts;
}

// 품목 · 수금 내역 표 (거래처 일괄 등록이면 거래처 표)
function RequestLines({ item }) {
  const data = item.data || {};
  const body = data.item || {};
  if (item.target === 'CUSTOMER') {
    const rows = item.op === 'bulk_create' ? (data.items || []) : [];
    if (rows.length < 2) return null;
    return <div className={own.tableWrap}><GridTable columns={CUSTOMER_COLUMNS}>
      {rows.slice(0, 200).map((row, index) => <tr key={index}>
        <td>{row.customercode || '자동'}</td><td>{row.customername}</td><td>{row.businessno}</td><td>{row.ceoname}</td><td>{row.manager}</td><td>{row.phone}</td>
      </tr>)}
    </GridTable>{rows.length > 200 && <div className={own.more}>외 {rows.length - 200}건</div>}</div>;
  }
  if (['delete', 'manager', 'sales_fields'].includes(item.op)) return null;
  const lines = body.items || [];
  if (item.target === 'RECEIPT_PAYMENT') {
    return <div className={own.tableWrap}><GridTable columns={RP_COLUMNS}>
      {lines.map((row, index) => <tr key={index}>
        {RP_KEYS.map(([key]) => <td key={key} className={own.num}>{num(row[key], 0)}</td>)}<td>{row.description}</td>
      </tr>)}
    </GridTable></div>;
  }
  const isOut = item.target === 'OUTBOUND';
  return <><div className={own.tableWrap}><GridTable columns={isOut ? OUT_COLUMNS : IN_COLUMNS}>
    {lines.map((row, index) => <tr key={index}>
      {isOut ? <><td>{row.stocksourceno}</td><td className={own.num}>{row.stocksourceline}</td></>
        : <><td title={row.itemname}>{row.itemname}</td><td className={own.num}>{num(row.thickness)}</td><td className={own.num}>{num(row.width)}</td><td className={own.num}>{num(row.length)}</td></>}
      <td className={own.num}>{num(row.qty)}</td><td className={own.num}>{num(row.weight)}</td><td className={own.num}>{num(row.unitprice, 2)}</td>
    </tr>)}
  </GridTable></div>{(body.expenses || []).length > 0 && <div className={own.more}>기타비용 {body.expenses.length}건 포함</div>}</>;
}

// 상세: 목록 행(preview)을 먼저 보여 주고, 내용은 받아오는 대로 채운다
function RequestDetail({ preview }) {
  const requestno = preview?.requestno;
  const [item, setItem] = useState(null);
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  const load = useCallback(async (force = false) => {
    if (!requestno) return;
    if (!force && DETAIL_CACHE.has(requestno)) { setItem(DETAIL_CACHE.get(requestno)); return; }
    try {
      const { data } = await axios.get(`/api/control/requests/${encodeURIComponent(requestno)}`, authConfig());
      DETAIL_CACHE.set(requestno, data);
      setItem(data);
    } catch (error) {
      notifications.show({ title: '요청 조회 실패', message: errorText(error), color: 'red' });
    }
  }, [requestno]);
  const runLoad = useEffectEvent((force) => { void load(force); });
  useEffect(() => { setRejecting(false); setReason(''); runLoad(preview?.status === 'PENDING'); }, [requestno, preview?.status]);

  const act = async (kind) => {
    setBusy(true);
    try {
      const { data } = await axios.post(`/api/control/requests/${encodeURIComponent(requestno)}/${kind}`, kind === 'reject' ? { reason } : {}, authConfig());
      const text = kind === 'approve'
        ? `승인했습니다.${data.result_no ? ` (${data.result_no})` : ''}`
        : kind === 'reject' ? '반려했습니다.' : '요청을 취소했습니다.';
      notifications.show({ title: '처리 완료', message: text, color: 'teal' });
      DETAIL_CACHE.delete(requestno);
      setRejecting(false); setReason('');
      await load(true);
      window.dispatchEvent(new Event('approval-changed'));   // 목록 · 헤더 알림 새로고침
    } catch (error) {
      notifications.show({ title: '처리 실패', message: errorText(error), color: 'red', autoClose: 9000 });
      DETAIL_CACHE.delete(requestno);
      await load(true);
    } finally { setBusy(false); }
  };

  if (!preview) return <div className={own.empty}>목록에서 요청을 선택하세요.</div>;
  const view = item?.requestno === requestno ? item : null;
  const head = view || preview;
  const facts = view ? requestFacts(view) : [];
  const hasAmount = head.amount !== null && head.amount !== undefined;
  return <div className={own.detail}>
    <div className={own.detailHead}>
      <div className={own.detailTitle}>
        <span className={own.kind}>{head.target_label} {head.action_label}</span>
        <StatusPill status={head.status} label={head.status_label} />
        {head.self_approved && <span className={`${own.pill} ${own.muted}`}>본인 승인</span>}
      </div>
      <span className={own.reqNo}>{head.requestno}</span>
    </div>

    {/* 핵심: 금액(있으면 크게) + 일자 · 거래처 · 품목 · 중량 칸 */}
    <div className={own.factCard}>
      {hasAmount && <div className={own.factAmount}><span>금액</span><b>{won(head.amount)}</b></div>}
      {view ? <div className={own.factGrid}>
        {facts.map(([label, value]) => <div key={label} className={own.fact}><span>{label}</span><b title={String(value ?? '')}>{value}</b></div>)}
      </div> : <div className={own.factPending}>{head.summary}</div>}
    </div>

    {/* 누가 · 언제 */}
    <div className={own.people}>
      <div className={own.fact}><span>요청자</span><b>{head.requested_name}</b></div>
      <div className={own.fact}><span>요청일시</span><b>{kst(head.requested_at)}</b></div>
      {head.decided_at && <>
        <div className={own.fact}><span>{head.self_approved ? '본인 승인' : `${head.status_label}자`}</span><b>{head.decided_name}</b></div>
        <div className={own.fact}><span>{head.status_label}일시</span><b>{kst(head.decided_at)}</b></div>
      </>}
      {head.result_no && <div className={own.fact}><span>반영 번호</span><b>{head.result_no}</b></div>}
    </div>
    {head.reject_reason && <div className={own.notice}><span>반려 사유</span>{head.reject_reason}</div>}
    {head.status === 'PENDING' && head.last_error && <div className={own.notice}><span>승인 실패</span>{head.last_error}</div>}

    {!view ? <div className={own.loadingRow}><Loader size="xs" color="red" /></div> : <>
      <RequestLines item={view} />
      {view.reservations?.length > 0 && <>
        <div className={own.sectionTitle}>예약 재고</div>
        <div className={own.tableWrap}><GridTable columns={RESERVE_COLUMNS}>
          {view.reservations.map((row) => <tr key={`${row.sourcetype}:${row.sourceno}:${row.sourceline}`}>
            <td>{row.sourceno}</td><td className={own.num}>{row.sourceline}</td><td>{row.itemname}</td>
            <td>{[row.thickness, row.width, row.length].filter((v) => Number(v) > 0).map((v) => num(v)).join('×')}</td>
            <td className={own.num}>{num(row.qty)}</td><td className={own.num}>{num(row.weight)}</td>
          </tr>)}
        </GridTable></div>
      </>}
    </>}
    {view && (view.can_approve || view.can_reject || view.can_cancel) && <div className={own.actions}>
      {rejecting ? <>
        <Textarea className={own.reasonInput} placeholder="반려 사유" autosize minRows={2} maxLength={500} data-autofocus
          value={reason} onChange={(event) => setReason(event.currentTarget.value)} />
        <Group gap={6} justify="flex-end">
          <button type="button" className={`${own.btn} ${own.gray}`} disabled={busy} onClick={() => setRejecting(false)}>닫기</button>
          <button type="button" className={`${own.btn} ${own.navy}`} disabled={busy || !reason.trim()} onClick={() => act('reject')}>반려</button>
        </Group>
      </> : <Group gap={6} justify="flex-end">
        {view.can_cancel && <button type="button" className={`${own.btn} ${own.gray}`} disabled={busy} onClick={() => act('cancel')}>요청 취소</button>}
        {view.can_reject && <button type="button" className={`${own.btn} ${own.navy}`} disabled={busy} onClick={() => setRejecting(true)}>반려</button>}
        {view.can_approve && <button type="button" className={`${own.btn} ${own.red}`} disabled={busy} onClick={() => act('approve')}>승인</button>}
      </Group>}
    </div>}
  </div>;
}

const RequestRow = memo(function RequestRow({ row, selected, onSelect }) {
  return <tr className={`${own.clickRow} ${selected ? own.selected : ''}`} onClick={() => onSelect(row)} tabIndex={0}
    onKeyDown={(event) => { if (event.key === 'Enter') onSelect(row); }}>
    <td className={own.mono} title={kst(row.requested_at)}>{kstShort(row.requested_at)}</td>
    <td>{row.target_label} {row.action_label}</td>
    <td className={own.ellipsis} title={row.summary}>{row.summary}</td>
    <td className={own.num}>{row.amount === null || row.amount === undefined ? '' : num(row.amount, 0)}</td>
    <td className={own.ellipsis}>{row.requested_name}</td>
    <td className={own.center}><StatusPill status={row.status} label={row.status_label} /></td>
  </tr>;
});

function RequestsTab({ scope, reloadKey, initialRequest = null }) {
  const [filters, setFilters] = useState(() => ({ ...thisMonth(), status: '', target: '', q: '' }));
  const [query, setQuery] = useState(filters);
  const [result, setResult] = useState({ items: [], total: 0 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(initialRequest);
  const requestId = useRef(0);

  const load = useCallback(async (nextPage, nextQuery) => {
    const id = ++requestId.current;   // 늦게 온 이전 응답은 버린다
    setLoading(true);
    try {
      const { data } = await axios.get('/api/control/requests', { ...authConfig(), params: { scope, ...nextQuery, page: nextPage, page_size: PAGE_SIZE } });
      if (id !== requestId.current) return;
      setResult(data);
      setPage(nextPage);
      // 고른 요청의 상태가 바뀌었으면 상세도 따라가게 목록 행으로 바꿔 끼운다
      setSelected((current) => (current ? data.items.find((row) => row.requestno === current.requestno) || current : current));
    } catch (error) {
      if (id === requestId.current) notifications.show({ title: '목록 조회 실패', message: errorText(error), color: 'red' });
    } finally { if (id === requestId.current) setLoading(false); }
  }, [scope]);
  const runLoad = useEffectEvent((nextPage, nextQuery) => { void load(nextPage, nextQuery); });
  useEffect(() => { runLoad(1, query); }, [query, reloadKey]);
  const refresh = useEffectEvent(() => { void load(page, query); });
  usePageReactivated(() => { void load(page, query); });
  useEffect(() => {
    const onChanged = () => refresh();
    window.addEventListener('approval-changed', onChanged);
    return () => window.removeEventListener('approval-changed', onChanged);
  }, []);
  const select = useCallback((row) => setSelected(row), []);

  return <div className={own.split}>
    <Paper className={`${sharedClasses.panel} ${own.listPanel}`} withBorder>
      <div className={own.filterRow}>
        <div className={own.period}>
          <ErpDateInput aria-label="시작일" value={filters.date_from}
            onChange={(event) => { const next = { ...filters, date_from: event.currentTarget.value }; setFilters(next); if (next.date_from && (!next.date_to || next.date_from <= next.date_to)) setQuery(next); }} />
          <span>~</span>
          <ErpDateInput aria-label="종료일" value={filters.date_to}
            onChange={(event) => { const next = { ...filters, date_to: event.currentTarget.value }; setFilters(next); if (next.date_to && (!next.date_from || next.date_from <= next.date_to)) setQuery(next); }} />
        </div>
        <Select className={own.smallSelect} data={STATUS_OPTIONS} value={filters.status} allowDeselect={false} aria-label="상태"
          onChange={(value) => { const next = { ...filters, status: value || '' }; setFilters(next); setQuery(next); }} />
        <Select className={own.smallSelect} data={TARGET_OPTIONS} value={filters.target} allowDeselect={false} aria-label="구분"
          onChange={(value) => { const next = { ...filters, target: value || '' }; setFilters(next); setQuery(next); }} />
        <TextInput className={own.search} placeholder="요청번호 · 내용 · 요청자 (Enter)" value={filters.q}
          onChange={(event) => { const value = event.currentTarget.value; setFilters((current) => ({ ...current, q: value })); }}
          onKeyDown={(event) => { if (event.key === 'Enter') setQuery({ ...filters }); }} />
        {loading && <Loader size={12} color="red" />}
      </div>
      <div className={own.listScroll}>
        <GridTable columns={LIST_COLUMNS} empty={result.items.length ? null : loading ? '조회 중' : scope === 'inbox' ? '승인요청이 없습니다' : '요청 내역이 없습니다'}>
          {result.items.map((row) => <RequestRow key={row.requestno} row={row} selected={selected?.requestno === row.requestno} onSelect={select} />)}
        </GridTable>
      </div>
      {result.total > PAGE_SIZE && <div className={own.pager}>
        <Pagination size="sm" color="red" total={Math.ceil(result.total / PAGE_SIZE)} value={page} onChange={(next) => load(next, query)} />
      </div>}
    </Paper>
    <Paper className={`${sharedClasses.panel} ${own.detailPanel}`} withBorder>
      <RequestDetail key={selected?.requestno || 'none'} preview={selected} />
    </Paper>
  </div>;
}

// 금액을 읽기 쉽게: 1,500,000 → '150만원', 120,000,000 → '1억 2,000만원'
const koreanWon = (value) => {
  const amount = Math.round(Number(value || 0));
  if (!amount) return '';
  const eok = Math.floor(amount / 100000000);
  const man = Math.floor((amount % 100000000) / 10000);
  const rest = amount % 10000;
  const parts = [];
  if (eok) parts.push(`${eok.toLocaleString('ko-KR')}억`);
  if (man) parts.push(`${man.toLocaleString('ko-KR')}만`);
  if (rest && !eok) parts.push(rest.toLocaleString('ko-KR'));
  return `${parts.join(' ')}원`;
};
const AMOUNT_PRESETS = [1000000, 5000000, 10000000];
const ACTIONS = [['create', '등록'], ['update', '수정'], ['delete', '삭제']];

// 동작 하나: [켜기] → (금액 대상이면) [모든 금액 | 금액 이상] → 금액 입력 · 빠른 선택
function ActionRule({ policy, action, label, onChange }) {
  const on = policy[`on_${action}`];
  const min = policy[`${action}_min`];
  const withAmount = min !== null && min !== undefined;
  return <div className={`${own.rule} ${on ? own.ruleOn : ''}`}>
    <label className={own.ruleHead}>
      <Switch color="red" size="sm" checked={on} className={own.switch} withThumbIndicator={false}
        onChange={(event) => onChange(`on_${action}`, event.currentTarget.checked)} aria-label={`${policy.label} ${label} 승인`} />
      <span className={own.ruleLabel}>{label}</span>
      <span className={own.ruleState}>{!on ? '바로 저장' : !policy.amount_enabled || !withAmount ? '모두 승인' : `${koreanWon(min) || '금액'} 이상 승인`}</span>
    </label>
    {on && policy.amount_enabled && <div className={own.ruleBody}>
      <div className={own.seg} role="radiogroup" aria-label={`${label} 금액 조건`}>
        <button type="button" role="radio" aria-checked={!withAmount} className={!withAmount ? own.segOn : ''} onClick={() => onChange(`${action}_min`, null)}>모든 금액</button>
        <button type="button" role="radio" aria-checked={withAmount} className={withAmount ? own.segOn : ''} onClick={() => onChange(`${action}_min`, min || 1000000)}>금액 이상</button>
      </div>
      {withAmount && <>
        <NumberInput className={own.amountInput} value={min ?? ''} min={0} step={100000} thousandSeparator="," hideControls
          rightSection={<span className={own.unit}>원</span>} rightSectionWidth={28}
          onChange={(value) => onChange(`${action}_min`, value === '' ? 0 : Number(value))} aria-label={`${policy.label} ${label} 금액 조건`} />
        <div className={own.presets}>
          {AMOUNT_PRESETS.map((value) => <button key={value} type="button" className={min === value ? own.presetOn : ''} onClick={() => onChange(`${action}_min`, value)}>{koreanWon(value).replace('원', '')}</button>)}
        </div>
      </>}
    </div>}
  </div>;
}

function SettingsTab({ reloadKey, saveRef }) {
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    try {
      const { data } = await axios.get('/api/control/settings', authConfig());
      setSettings(data);
    } catch (error) {
      notifications.show({ title: '설정 조회 실패', message: errorText(error), color: 'red' });
    }
  }, []);
  const runLoad = useEffectEvent(() => { void load(); });
  useEffect(() => { runLoad(); }, [reloadKey]);

  const save = useCallback(async () => {
    if (!settings || saving) return;
    setSaving(true);
    try {
      const { data } = await axios.put('/api/control/settings', {
        policies: settings.policies.map((policy) => ({
          target: policy.target,
          on_create: policy.on_create, create_min: policy.create_min || null,
          on_update: policy.on_update, update_min: policy.update_min || null,
          on_delete: policy.on_delete, delete_min: policy.delete_min || null,
        })),
        approvers: settings.users.filter((user) => user.approver).map((user) => user.email),
      }, authConfig());
      setSettings(data);
      window.dispatchEvent(new Event('approval-changed'));
      notifications.show({ title: '저장 완료', message: '통제 설정을 저장했습니다.', color: 'teal' });
    } catch (error) {
      notifications.show({ title: '저장 실패', message: errorText(error), color: 'red' });
    } finally { setSaving(false); }
  }, [settings, saving]);
  // 위 리본의 [저장] 이 이 화면의 저장을 부른다
  useEffect(() => { saveRef.current = save; return () => { saveRef.current = null; }; }, [save, saveRef]);

  if (!settings) return <div className={own.empty}><Loader size="sm" color="red" /></div>;
  const setPolicy = (target, key, value) => setSettings((current) => ({
    ...current, policies: current.policies.map((policy) => (policy.target === target ? { ...policy, [key]: value } : policy)),
  }));
  const setApprover = (email, value) => setSettings((current) => ({
    ...current, users: current.users.map((user) => (user.email === email ? { ...user, approver: value } : user)),
  }));

  return <Paper className={`${sharedClasses.panel} ${own.sheet}`} withBorder>
    <section className={own.block}>
      <div className={own.blockHead}><h3>승인 대상</h3></div>
      <div className={own.policyList}>
        {settings.policies.map((policy) => <div key={policy.target} className={own.policyRow}>
          <div className={own.policyName}>
            <b>{policy.label}</b>
          </div>
          {ACTIONS.map(([action, label]) => <ActionRule key={action} policy={policy} action={action} label={label}
            onChange={(key, value) => setPolicy(policy.target, key, value)} />)}
        </div>)}
      </div>
    </section>

    <section className={own.block}>
      <div className={own.blockHead}><h3>승인자</h3></div>
      <div className={`${own.tableWrap} ${own.userTableWrap}`}><GridTable columns={APPROVER_COLUMNS} empty={settings.users.length ? null : '사용 중인 직원이 없습니다'}>
        {settings.users.map((user) => <tr key={user.email} className={`${own.clickRow} ${user.approver ? own.selected : ''}`} onClick={() => setApprover(user.email, !user.approver)}>
          <td className={own.center} onClick={(event) => event.stopPropagation()}>
            <input type="checkbox" className={own.check} checked={user.approver} onChange={(event) => setApprover(user.email, event.currentTarget.checked)} aria-label={`${user.username} 승인자`} />
          </td>
          <td><b>{user.username}</b></td><td className={own.ellipsis}>{user.email}</td><td>{user.team}</td><td>{user.position}</td><td>{user.authority}</td>
        </tr>)}
      </GridTable></div>
    </section>
  </Paper>;
}

export default function ControlManagement() {
  const [summary, setSummary] = useState(null);
  const location = useLocation();
  const [tab, setTab] = useState(() => new URLSearchParams(location.search).get('tab') || '');   // 승인요청 안내 창 → ?tab=mine
  const [reloadKey, setReloadKey] = useState(0);
  const loadSummary = useCallback(async () => {
    try {
      const { data } = await axios.get('/api/control/summary', authConfig());
      setSummary(data);
    } catch {
      setSummary({ active: false, can_manage: false, pending: 0, my_pending: 0, my_rejected: 0 });
    }
  }, []);
  const runSummary = useEffectEvent(() => { void loadSummary(); });
  useEffect(() => { runSummary(); }, []);
  usePageReactivated(() => { void loadSummary(); });
  useEffect(() => {
    const onChanged = () => runSummary();
    window.addEventListener('approval-changed', onChanged);
    return () => window.removeEventListener('approval-changed', onChanged);
  }, []);

  const tabs = useMemo(() => {
    if (!summary) return [];
    return [
      (summary.can_manage || summary.is_approver) && { key: 'inbox', label: '승인함' },
      { key: 'mine', label: '내 요청' },
      summary.can_manage && { key: 'settings', label: '통제 설정' },
    ].filter(Boolean);
  }, [summary]);
  const activeTab = tabs.some((item) => item.key === tab) ? tab : tabs[0]?.key;
  const saveRef = useRef(null);
  useErpPageRibbon({
    onSearch: () => { setReloadKey((value) => value + 1); void loadSummary(); },
    onSave: activeTab === 'settings' ? () => saveRef.current?.() : undefined,   // 통제 설정 탭에서만 [저장]
    showPrint: false,
  });

  return (
    <Box className={`${sharedClasses.pageShell} ${classes.page} ${simpleTheme.simple} ${own.page}`}>
      <Box component="nav" aria-label="현재 위치" className={classes.pageBreadcrumb}>
        <Group className={classes.breadcrumbTrail} gap={7}>
          <Text component="span" className={classes.breadcrumbParent}>어드민</Text>
          <Text component="span" className={classes.breadcrumbChevron}>›</Text>
          <Text component="span" className={classes.breadcrumbCurrent}>통제관리</Text>
        </Group>
      </Box>
      {!summary ? <div className={own.empty}><Loader size="sm" color="red" /></div> : <>
        <div className={own.tabs} role="tablist">
          {tabs.map((item) => <button key={item.key} type="button" role="tab" aria-selected={activeTab === item.key}
            className={`${own.tab} ${activeTab === item.key ? own.tabOn : ''}`} onClick={() => setTab(item.key)}>
            {item.label}
          </button>)}
        </div>
        <div className={own.body}>
          {activeTab === 'inbox' && <RequestsTab key="inbox" scope="inbox" reloadKey={reloadKey} initialRequest={location.state?.request || null} />}
          {activeTab === 'mine' && <RequestsTab key="mine" scope="mine" reloadKey={reloadKey} initialRequest={location.state?.request || null} />}
          {activeTab === 'settings' && <SettingsTab reloadKey={reloadKey} saveRef={saveRef} />}
        </div>
      </>}
    </Box>
  );
}
