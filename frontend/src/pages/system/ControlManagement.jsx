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
import { Box, Group, Loader, NumberInput, Pagination, Paper, Popover, Select, Switch, Text, TextInput, Textarea } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import ErpDateInput from '../../components/common/ErpDateInput';
import { ColumnResizeHandle, pickerClasses, useResizableColumns } from '../../components/common/PickerModal';
import useErpPageRibbon from '../../components/common/useErpPageRibbon';
import usePageReactivated from '../../components/common/usePageReactivated';
import sharedClasses from '../../styles/pages/ManagementShared.module.css';
import simpleTheme from '../../styles/pages/SimpleTheme.module.css';
import classes from '../../styles/pages/InboundRegister.module.css';
import own from '../../styles/pages/ControlManagement.module.css';
import { apiErrorMessage } from '../../utils/apiError';
import { loadMaster, peekMaster } from '../../utils/masterCache';

const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });
const CONTROL_SUMMARY_KEY = 'control:summary';
const errorText = (error, fallback = '처리하지 못했습니다.') => apiErrorMessage(error, fallback);
// 시각은 한국시간 'YYYY-MM-DD HH:mm' (포맷터는 한 번만 만든다)
const KST_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const kst = (value) => {
  if (!value) return '';
  const p = Object.fromEntries(KST_FORMAT.formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
};
const num = (value, digits = 2) => (value === null || value === undefined || value === '' ? ''
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
const DETAIL_INFLIGHT = new Map();
function fetchDetail(requestno) {
  if (DETAIL_INFLIGHT.has(requestno)) return DETAIL_INFLIGHT.get(requestno);
  const promise = axios.get(`/api/control/requests/${encodeURIComponent(requestno)}`, authConfig())
    .then(({ data }) => { DETAIL_CACHE.set(requestno, data); return data; })
    .finally(() => DETAIL_INFLIGHT.delete(requestno));
  DETAIL_INFLIGHT.set(requestno, promise);
  return promise;
}
const prefetchDetail = (requestno) => { if (requestno && !DETAIL_CACHE.has(requestno)) fetchDetail(requestno).catch(() => {}); };

// ── 표 칸 (너비는 끌어서 바꿈) ──
const listColumns = (personLabel) => [
  { key: 'status', label: '상태', width: 60, align: 'center' },
  { key: 'requestno', label: '요청번호', width: 168 },
  { key: 'kind', label: '구분', width: 70 },
  { key: 'action', label: '유형', width: 56, align: 'center' },
  { key: 'party', label: '거래처', width: 124 },
  { key: 'docdate', label: '전표일자', width: 98, align: 'center' },
  { key: 'lines', label: '건수', width: 48, align: 'right' },
  { key: 'weight', label: '중량(kg)', width: 84, align: 'right' },
  { key: 'amount', label: '금액', width: 104, align: 'right' },
  { key: 'note', label: '내용', width: 140 },
  { key: 'person', label: personLabel, width: 62 },
  { key: 'requested_at', label: '요청일시', width: 134 },
];
const LIST_COLUMNS = { inbox: listColumns('요청자'), mine: listColumns('처리자') };
const APPROVER_COLUMNS = [
  { key: 'check', label: '승인자', width: 90, align: 'center' },
  { key: 'name', label: '이름', width: 130 }, { key: 'email', label: '이메일', width: 280 }, { key: 'team', label: '부서', width: 180 },
  { key: 'position', label: '직급', width: 120 }, { key: 'action', label: '설정', width: 100, align: 'center' },
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
  if (item.target === 'CUSTOMER') {
    if (item.op === 'bulk_create') {
      const rows = data.items || [];
      const count = (type) => rows.filter((row) => (row.tradetype || '매입처') === type).length;
      return [['등록', `${rows.length.toLocaleString('ko-KR')}곳`], ['매출처', `${count('매출처')}곳`], ['매입처', `${count('매입처')}곳`], ['매입매출처', `${count('매입매출처')}곳`]];
    }
    // 거래처 공용 양식 (등록 · 수정): 코드 · 거래구분 · 사업자 · 대표자 · 업태/업종 · 담당자 · 사용여부
    return [
      ['거래처코드', body.customercode || item.ref_no || '자동 부여'],
      ['거래구분', body.tradetype || '-'],
      ['사업자유형', body.ownertype === 'INDIV' ? '개인사업자' : '법인사업자'],
      ['사업자번호', body.businessno || '-'],
      ['대표자', body.ceoname || '-'],
      ['업태 · 업종', [body.businesstype, body.industry].filter(Boolean).join(' · ') || '-'],
      ['업체 담당자', body.manager || '-'],
      ['사용여부', String(body.useryn || 'Y').toUpperCase() === 'N' || body.useryn === '사용중지' ? '사용중지' : '사용중'],
    ];
  }
  // 전표 공용 양식: 등록 · 수정 · 삭제 모두 같은 칸 · 같은 순서
  //  등록 · 수정 = 입력한 내용, 삭제 · 담당자 변경 · 단가 수정 = 요청 때 보관한 전표 머리
  const lines = item.lines || [];
  const header = item.op === 'save'
    ? { date: body.receptdate || body.receiptdate, party: body.customname || (body.items || [])[0]?.customname, manager: body.manager,
      destination: body.destination, description: body.description, transactiontype: body.transactiontype }
    : (item.doc_header || {});
  const docno = item.ref_no || item.result_no || '승인 후 부여';
  const facts = [
    ['거래처', header.party || item.party || '-'],
    ['전표일자', String(header.date || item.doc_date || '').slice(0, 10) || '-'],
    ['전표', docno],
  ];
  if (item.target === 'RECEIPT_PAYMENT') {
    facts.push(['구분', header.transactiontype === 'RECEIPT' ? '수금' : header.transactiontype === 'PAYMENT' ? '지급' : '-']);
  } else {
    facts.push(['품목', `${lines.length.toLocaleString('ko-KR')}건`]);
    facts.push(['중량', `${num(lines.reduce((sum, row) => sum + Number(row.weight || 0), 0), 1)}kg`]);
  }
  facts.push(['담당자', header.manager || '-']);
  if (item.target === 'OUTBOUND') facts.push(['착지', header.destination || '-']);
  return facts;
}

// 품목 · 수금 내역 표 (거래처 일괄 등록이면 거래처 표)
function RequestLines({ item }) {
  const data = item.data || {};
  const body = data.item || {};
  if (item.target === 'CUSTOMER') {
    if (item.op === 'bulk_create') {
      const rows = data.items || [];
      return <>
        <div className={own.sectionTitle}>거래처 <small>{rows.length}곳</small></div>
        <div className={own.lineList}>
          {rows.slice(0, 200).map((row, index) => <div key={index} className={own.lineItem}>
            <div className={own.lineTop}>
              <b className={own.lineName}>{row.customername}</b>
              <span className={own.lineSpec}>{row.customercode || '코드 자동'}</span>
              <span className={own.lineAmount}>{row.tradetype || '매입처'}</span>
            </div>
            <div className={own.lineSub}>
              {row.businessno && <span>{row.businessno}</span>}{row.ceoname && <span>대표 {row.ceoname}</span>}{row.phone && <span>{row.phone}</span>}
            </div>
          </div>)}
        </div>
        {rows.length > 200 && <div className={own.more}>외 {rows.length - 200}곳</div>}
      </>;
    }
    const bank = body.bankcode ? (item.bank_names?.[body.bankcode] || body.bankcode) : '';
    const money = (value) => (Number(value || 0) ? won(value) : '-');
    const info = [
      ['주소', [body.zipcode && `(${body.zipcode})`, body.address, body.address2].filter(Boolean).join(' ')],
      ['연락처', [body.phone && `전화 ${body.phone}`, body.fax && `팩스 ${body.fax}`, body.email].filter(Boolean).join(' · ')],
      ['은행', [bank, body.accountno].filter(Boolean).join(' ')],
      ['비고', body.remark],
    ];
    return <>
      <div className={own.sectionTitle}>거래처 정보</div>
      <div className={own.lineList}>
        {info.map(([label, value]) => <div key={label} className={own.lineItem}>
          <div className={own.lineTop}><b className={own.lineName}>{label}</b><span className={own.lineValue}>{value || '-'}</span></div>
        </div>)}
        {[['기초 미수금', body.openingreceivable], ['기초 미지급금', body.openingpayable], ['여신한도', body.creditlimit]].map(([label, value]) => <div key={label} className={own.lineItem}>
          <div className={own.lineTop}><b className={own.lineName}>{label}</b><b className={own.lineAmount}>{label === '여신한도' && !Number(value || 0) ? '한도 없음' : money(value)}</b></div>
        </div>)}
      </div>
    </>;
  }
  if (['delete', 'manager', 'sales_fields'].includes(item.op) && !(item.lines || []).length) return null;   // 수금/지급 삭제 등 품목 없는 전표
  if (item.target === 'RECEIPT_PAYMENT') {
    // 매입처럼 한 줄씩: [결제수단 · 어음 종류/번호 ······ 금액] / [수단별 금액 · 만기 · 발행처 · 비고]
    const rpRows = item.lines || [];
    return <>
      <div className={own.sectionTitle}>{item.target_label === '지급' ? '지급' : item.target_label === '수금' ? '수금' : '결제'} 내역 <small>{rpRows.length}건</small></div>
      <div className={own.lineList}>
        {rpRows.map((row, index) => <div key={index} className={own.lineItem}>
          <div className={own.lineTop}>
            <b className={own.lineName}>{(row.methods || []).map((m) => m.label).join(' · ') || '결제'}</b>
            {row.instrumenttype && <span className={own.lineSpec}>{row.instrumenttype}{row.instrumentno ? ` ${row.instrumentno}` : ''}</span>}
            <b className={own.lineAmount}>{won(row.supply)}</b>
          </div>
          <div className={own.lineSub}>
            {(row.methods || []).length > 1 && row.methods.map((m) => <span key={m.label}>{m.label} {num(m.amount, 0)}</span>)}
            {row.maturitydate && <span>만기 {row.maturitydate}</span>}
            {row.issuer && <span>발행 {row.issuer}</span>}
            {row.description && <span>{row.description}</span>}
          </div>
        </div>)}
      </div>
    </>;
  }
  // 품목: (매출은 원천 전표번호 · 순번) 품명 · 두께 · 폭 · 길이 · 수량 · 중량 · 단가 · 공급가 — 매출 품명 · 규격은 서버가 재고에서 찾아 붙인다
  const rows = item.lines || [];
  const reserved = (item.reservations || []).length > 0;
  return <>
    <div className={own.sectionTitle}>품목 <small>{rows.length}건</small>{reserved && <span className={own.reserveTag}>재고 예약 중</span>}</div>
    {/* 승인자가 한눈에: 줄마다 [품명 · 규격 ······ 공급가] / [수량 · 중량 · 단가 · 원천 전표] — 가로 스크롤 없음 */}
    <div className={own.lineList}>
      {rows.map((row, index) => {
        const spec = [row.thickness, row.width, row.length].filter((v) => Number(v) > 0).map((v, i) => num(v, i ? 0 : 3)).join(' × ');
        return <div key={index} className={own.lineItem}>
          <div className={own.lineTop}>
            <b className={own.lineName}>{row.itemname || '품명 없음'}</b>
            {spec && <span className={own.lineSpec}>{spec}</span>}
            <b className={own.lineAmount}>{won(row.supply)}</b>
          </div>
          <div className={own.lineSub}>
            <span>{num(row.qty, 0)}개</span><span>{num(row.weight, 1)}kg</span><span>단가 {num(row.unitprice, 0)}</span>
            {row.sourceno && <span className={own.lineSource}>{row.sourceno} · {row.sourceline}</span>}
          </div>
        </div>;
      })}
    </div>
    {(body.expenses || []).length > 0 && <>
      <div className={own.sectionTitle}>기타비용</div>
      <div className={own.lineList}>
        {body.expenses.map((row, index) => <div key={index} className={own.lineItem}>
          <div className={own.lineTop}>
            <b className={own.lineName}>{row.costname || '기타비용'}</b>
            {row.customname && <span className={own.lineSpec}>{row.customname}</span>}
            <b className={own.lineAmount}>{won(row.supplyamt)}</b>
          </div>
          {(row.description || String(row.purchaseyn || '').toUpperCase() === 'Y') && <div className={own.lineSub}>
            {String(row.purchaseyn || '').toUpperCase() === 'Y' && <span>비용 처리</span>}{row.description && <span>{row.description}</span>}
          </div>}
        </div>)}
      </div>
    </>}</>;
}

// 상세: 목록 행(preview)을 먼저 보여 주고, 내용은 받아오는 대로 채운다
function RequestDetail({ preview }) {
  const requestno = preview?.requestno;
  const [item, setItem] = useState(null);
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  const currentNo = useRef(requestno);
  currentNo.current = requestno;
  const load = useCallback(async (force = false) => {
    if (!requestno) return;
    const cached = DETAIL_CACHE.get(requestno);
    if (cached) setItem(cached);          // 받아 둔 내용은 바로
    if (cached && !force) return;
    if (force) DETAIL_CACHE.delete(requestno);
    try {
      const data = await fetchDetail(requestno);
      if (currentNo.current === requestno) setItem(data);   // 그새 다른 요청을 골랐으면 버린다
    } catch (error) {
      if (currentNo.current === requestno) notifications.show({ title: '요청 조회 실패', message: errorText(error), color: 'red' });
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
  // 새 요청을 받는 동안에는 이전 화면을 흐리게 그대로 두고, 오면 부드럽게 바꾼다 (글자가 사라졌다 나타나지 않게)
  const shown = view || item;
  if (!shown) return <div className={own.detail}><div className={own.loadingRow}><Loader size="xs" color="red" /></div></div>;
  const head = shown;
  const facts = requestFacts(shown);
  const hasAmount = head.amount !== null && head.amount !== undefined;
  // 매입 · 매출: 금액 아래에 물품 / 기타비용 (예전 요청은 품목 · 기타비용을 더해서)
  const methodTotals = head.target === 'RECEIPT_PAYMENT'
    ? Object.entries((head.lines || []).flatMap((row) => row.methods || []).reduce((acc, m) => ({ ...acc, [m.label]: (acc[m.label] || 0) + Number(m.amount || 0) }), {}))
    : [];
  const split = hasAmount && ['INBOUND', 'OUTBOUND'].includes(head.target)
    ? (head.amounts || {
      goods: (head.lines || []).reduce((sum, row) => sum + Number(row.supply || 0), 0),
      expenses: (head.data?.item?.expenses || []).reduce((sum, row) => sum + Number(row.supplyamt || 0), 0),
    })
    : null;
  // 머리 큰 글씨: 전표는 금액(수금 · 지급은 그 이름으로), 거래처는 거래처명
  const isCustomer = head.target === 'CUSTOMER';
  const heroLabel = isCustomer ? (head.op === 'bulk_create' ? '일괄 등록' : '거래처')
    : head.target === 'RECEIPT_PAYMENT' ? `${head.target_label === '지급' ? '지급' : '수금'}액` : '금액';
  const heroValue = isCustomer
    ? (head.op === 'bulk_create' ? `${(head.data?.items || []).length.toLocaleString('ko-KR')}곳` : (head.data?.item?.customername || head.party || '-'))
    : hasAmount ? won(head.amount) : '-';
  const creditOver = head.credit && Number(head.credit.over) > 0;
  // 확인할 것: 모든 요청에서 같은 자리 · 같은 모양 (위험한 것부터)
  const alerts = [
    head.action === 'DELETE' && { tone: 'danger', label: '삭제 요청', text: `승인하면 ${isCustomer ? '거래처' : '전표'}가 삭제됩니다.` },
    creditOver && { tone: 'danger', label: '여신 초과', text: `한도를 ${won(head.credit.over)} 넘습니다.` },
    head.status === 'PENDING' && head.last_error && { tone: 'danger', label: '승인 실패', text: head.last_error },
    head.reject_reason && { tone: 'muted', label: '반려 사유', text: head.reject_reason },
    (head.reservations || []).length > 0 && { tone: 'warn', label: '재고 예약', text: '승인 전까지 이 품목들의 재고를 잡아 두고 있습니다.' },
    head.action === 'UPDATE' && head.op !== 'delete' && !(head.changes || []).length && { tone: 'muted', label: '변경 내용', text: '바뀐 내용이 없거나, 변경 내용 기록 전에 요청된 건입니다.' },
  ].filter(Boolean);
  return <div key={shown.requestno} className={`${own.detail} ${own.detailFade} ${view ? '' : own.detailSwitching}`}>
    {/* ① 무엇을 · 상태 */}
    <div className={own.detailHead}>
      <div className={own.detailTitle}>
        <span className={own.kind}>{head.target_label} <em className={own[`act_${head.action}`] || ''}>{head.action_label}</em></span>
        <StatusPill status={head.status} label={head.status_label} />
      </div>
      <span className={own.reqNo}>{head.requestno}</span>
    </div>
    {/* ② 누가 · 언제 (한 줄) */}
    <div className={own.metaLine}>
      <span><b>{head.requested_name}</b> 요청 · {kst(head.requested_at)}</span>
      {head.decided_at && <span><b>{head.decided_name}</b> {head.self_approved ? '본인 승인' : head.status_label} · {kst(head.decided_at)}</span>}
      {head.result_no && <span>반영 번호 <b>{head.result_no}</b></span>}
    </div>
    {/* ③ 확인할 것 */}
    {alerts.length > 0 && <div className={own.alerts}>
      {alerts.map((a) => <div key={a.label} className={`${own.alert} ${own[`alert_${a.tone}`] || ''}`}><b>{a.label}</b><span>{a.text}</span></div>)}
    </div>}

    {/* ④ 요약: 큰 글씨 + 같은 순서의 칸 */}
    <div className={own.factCard}>
      <div className={own.factAmount}>
        <span>{heroLabel}{!isCustomer && hasAmount && head.target !== 'RECEIPT_PAYMENT' && <small>공급가</small>}</span>
        <b className={isCustomer ? own.heroText : ''} title={String(heroValue)}>{heroValue}</b>
      </div>
      {methodTotals.length > 0 && <div className={own.factSplit}>
        {methodTotals.map(([label, amount]) => <span key={label}>{label} <b>{won(amount)}</b></span>)}
      </div>}
      {split && <div className={own.factSplit}>
        <span>물품 <b>{won(split.goods)}</b></span><span>기타비용 <b>{won(split.expenses)}</b></span>
      </div>}
      <div className={own.factGrid}>
        {facts.map(([label, value, wide]) => <div key={label} className={`${own.fact} ${wide ? own.factWide : ''}`}><span>{label}</span><b title={String(value ?? '')}>{value}</b></div>)}
      </div>
    </div>

    {/* ⑤ 수정 요청: 무엇을 바꾸는지 (변경 전 → 변경 후) */}
    {(head.changes || []).length > 0 && <div className={own.changeBox}>
      <div className={own.changeHead}>변경 내용 <small>{head.changes.length}건</small></div>
      {head.changes.map((change, index) => <div key={index} className={own.changeRow}>
        <span className={own.changeLabel} title={change.label}>{change.label}</span>
        <span className={own.changeBefore} title={String(change.before)}>{change.before}</span>
        <span className={own.changeArrow} aria-hidden="true">→</span>
        <span className={own.changeAfter} title={String(change.after)}>{change.after}</span>
      </div>)}
    </div>}

    {/* ⑥ 여신: 한도 · 미수 잔액 · 대기 중 매출요청 · 이번 매출 → 합계 */}
    {head.credit && <div className={`${own.creditCard} ${creditOver ? own.creditOver : ''}`}>
      <div className={own.creditHead}><b>여신</b>{creditOver ? <span>한도 {won(head.credit.over)} 초과</span> : <span className={own.creditOk}>한도 안</span>}</div>
      <div className={own.creditGrid}>
        <div className={own.fact}><span>여신한도</span><b>{won(head.credit.limit)}</b></div>
        <div className={own.fact}><span>미수 잔액</span><b>{won(head.credit.balance)}</b></div>
        <div className={own.fact}><span>대기 중 매출요청</span><b>{won(head.credit.pending)}</b></div>
        <div className={own.fact}><span>이번 매출</span><b>{won(head.credit.this)}</b></div>
        <div className={own.fact}><span>합계</span><b>{won(head.credit.used)}</b></div>
      </div>
    </div>}

    {/* ⑦ 내역 */}
    <RequestLines item={shown} />
    {/* ⑧ 승인 · 반려: 창 아래에 붙어 있다 */}
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

const RequestRow = memo(function RequestRow({ row, scope, selected, onSelect }) {
  const person = scope === 'mine' ? (row.decided_name || '') : row.requested_name;
  // 다른 화면에서 넘어와 골라진 요청이 목록 아래쪽에 있어도 보이게
  const rowRef = useRef(null);
  useEffect(() => { if (selected) rowRef.current?.scrollIntoView({ block: 'nearest' }); }, [selected]);
  return <tr ref={rowRef} className={`${own.clickRow} ${selected ? own.selected : ''}`} onClick={() => onSelect(row)} tabIndex={0}
    onMouseEnter={() => prefetchDetail(row.requestno)}
    onKeyDown={(event) => { if (event.key === 'Enter') onSelect(row); }}>
    <td className={own.center}><StatusPill status={row.status} label={row.status_label} /></td>
    <td className={own.mono} title={row.requestno}>{row.requestno}</td>
    <td>{row.target_label}</td>
    <td className={`${own.center} ${own[`act_${row.action}`] || ''}`}>{row.action_label}</td>
    <td className={`${own.ellipsis} ${own.party}`} title={row.party || ''}>{row.party || <span className={own.emptyDash}>-</span>}</td>
    <td className={`${own.center} ${own.mono}`}>{row.doc_date || ''}</td>
    <td className={own.num}>{row.lines ?? ''}</td>
    <td className={own.num}>{row.weight === null || row.weight === undefined ? '' : num(row.weight, 1)}</td>
    <td className={own.num}>{row.amount === null || row.amount === undefined ? '' : num(row.amount, 0)}</td>
    <td className={own.ellipsis} title={row.summary}>
      {String(row.note || '').replace(' · 여신 초과', '')}{(row.reasons || []).includes('CREDIT') && <span className={own.creditTag}>여신 초과</span>}
    </td>
    <td className={own.ellipsis}>{person}</td>
    <td className={own.mono}>{kst(row.requested_at)}</td>
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
        <GridTable columns={LIST_COLUMNS[scope] || LIST_COLUMNS.inbox} empty={result.items.length ? null : loading ? '조회 중' : scope === 'inbox' ? '승인요청이 없습니다' : '요청 내역이 없습니다'}>
          {result.items.map((row) => <RequestRow key={row.requestno} row={row} scope={scope} selected={selected?.requestno === row.requestno} onSelect={select} />)}
        </GridTable>
      </div>
      {result.total > PAGE_SIZE && <div className={own.pager}>
        <Pagination size="sm" color="red" total={Math.ceil(result.total / PAGE_SIZE)} value={page} onChange={(next) => load(next, query)} />
      </div>}
    </Paper>
    <Paper className={`${sharedClasses.panel} ${own.detailPanel}`} withBorder>
      <RequestDetail preview={selected} />
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

// 표의 칸 하나: [스위치] 조건 한 줄. 금액 대상은 조건 글자를 누르면 작은 창에서 [모든 금액 | 금액 이상] · 금액 · 빠른 선택
function RuleCell({ policy, action, label, onChange }) {
  const [opened, setOpened] = useState(false);
  const on = policy[`on_${action}`];
  const min = policy[`${action}_min`];
  const withAmount = min !== null && min !== undefined;
  const text = !on ? '바로 저장' : !policy.amount_enabled || !withAmount ? '모든 건' : `${koreanWon(min) || '금액'} 이상`;
  return <div className={`${own.cell} ${on ? own.cellOn : ''}`}>
    <Switch color="red" size="sm" checked={on} className={own.switch} withThumbIndicator={false}
      onChange={(event) => onChange(`on_${action}`, event.currentTarget.checked)} aria-label={`${policy.label} ${label} 승인`} />
    {on && policy.amount_enabled ? <Popover opened={opened} onChange={setOpened} position="bottom-start" offset={6} width={250} shadow="md" withinPortal>
      <Popover.Target>
        <button type="button" className={own.cellText} onClick={() => setOpened((value) => !value)} title="금액 조건 바꾸기">
          {text}<span className={own.cellEdit} aria-hidden="true">✎</span>
        </button>
      </Popover.Target>
      <Popover.Dropdown className={own.cellPop}>
        <div className={own.cellPopTitle}>{policy.label} · {label}</div>
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
      </Popover.Dropdown>
    </Popover> : <span className={own.cellText} data-static="true">{text}</span>}
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
    // 승인 대상(또는 여신 통제)을 켰는데 승인자가 없으면 아무도 승인할 수 없다 → 저장 전에 알려 준다 (서버도 같은 규칙)
    const anyOn = Boolean(settings.credit?.on) || settings.policies.some((policy) => policy.on_create || policy.on_update || policy.on_delete);
    if (anyOn && !settings.users.some((user) => user.approver)) {
      notifications.show({ title: '승인자 미지정', message: '승인자 1명 이상 지정 필요', color: 'red' });
      return;
    }
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
        credit_on: Boolean(settings.credit?.on),
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
      {/* 한 장의 표: 대상 × 등록 · 수정 · 삭제 + 여신 통제 (켜진 칸만 빨간 스위치, 금액 조건은 글자를 눌러 바꿈) */}
      <table className={own.ruleTable}>
        <colgroup><col style={{ width: 150 }} /><col /><col /><col /></colgroup>
        <thead><tr><th>대상</th>{ACTIONS.map(([action, label]) => <th key={action}>{label}</th>)}</tr></thead>
        <tbody>
          {settings.policies.map((policy) => <tr key={policy.target}>
            <th scope="row">{policy.label}</th>
            {ACTIONS.map(([action, label]) => <td key={action}>
              {/* 거래처는 삭제 기능이 없다 (사용중지로 관리) */}
              {policy.target === 'CUSTOMER' && action === 'delete'
                ? <span className={own.cellNone}>—</span>
                : <RuleCell policy={policy} action={action} label={label} onChange={(key, value) => setPolicy(policy.target, key, value)} />}
            </td>)}
          </tr>)}
          <tr className={own.creditRow}>
            <th scope="row">여신 통제</th>
            <td colSpan={3}>
              <div className={`${own.cell} ${settings.credit?.on ? own.cellOn : ''}`}>
                <Switch color="red" size="sm" checked={Boolean(settings.credit?.on)} className={own.switch} withThumbIndicator={false}
                  onChange={(event) => { const on = event.currentTarget.checked; setSettings((current) => ({ ...current, credit: { ...(current.credit || {}), on } })); }}
                  aria-label="여신 통제" />
                <span className={own.cellText} data-static="true">{settings.credit?.on ? '한도 초과 시 승인' : '사용 안 함'}</span>
                <span className={own.creditHint}>여신한도를 넘는 매출은 승인 후 등록</span>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <section className={own.block}>
      <div className={own.blockHead}><h3>승인자</h3>
      </div>
      {/* 현재 승인자: 이름 칩 (× 로 바로 해제) */}
      <div className={own.approverBar}>
        <span className={own.approverBarLabel}>현재 승인자</span>
        {settings.users.filter((user) => user.approver).map((user) => <span key={user.email} className={own.approverChip}>
          {user.username}
          <button type="button" aria-label={`${user.username} 승인자 해제`} onClick={() => setApprover(user.email, false)}>×</button>
        </span>)}
        {!settings.users.some((user) => user.approver) && <span className={own.approverNone}>지정된 승인자가 없습니다</span>}
      </div>
      <div className={`${own.tableWrap} ${own.userTableWrap}`}><GridTable columns={APPROVER_COLUMNS} empty={settings.users.length ? null : '사용 중인 직원이 없습니다'}>
        {settings.users.map((user) => <tr key={user.email} className={user.approver ? own.selected : ''}>
          <td className={own.center}>{user.approver ? <span className={own.approverBadge}>승인자</span> : <span className={own.approverDash}>-</span>}</td>
          <td><b>{user.username}</b></td><td className={own.ellipsis}>{user.email}</td><td>{user.team}</td><td>{user.position}</td>
          <td className={own.center}>
            <button type="button" className={`${own.approverBtn} ${user.approver ? own.approverBtnOff : ''}`} onClick={() => setApprover(user.email, !user.approver)}>
              {user.approver ? '해제' : '지정'}
            </button>
          </td>
        </tr>)}
      </GridTable></div>
    </section>
  </Paper>;
}

export default function ControlManagement() {
  // 탭 구성(승인함 · 내 요청 · 통제 설정)은 지난번 요약으로 바로 그려 목록을 곧바로 부른다 (요약 응답을 기다리지 않음).
  // 서버 요약이 오면 그 값으로 바뀌고, 권한은 목록 · 설정 API 가 다시 확인한다.
  const [summary, setSummary] = useState(() => peekMaster(CONTROL_SUMMARY_KEY) || null);
  const location = useLocation();
  const [tab, setTab] = useState(() => new URLSearchParams(location.search).get('tab') || '');   // 승인요청 안내 창 → ?tab=mine
  const [reloadKey, setReloadKey] = useState(0);
  const loadSummary = useCallback(async () => {
    try {
      setSummary(await loadMaster(CONTROL_SUMMARY_KEY, async () => (await axios.get('/api/control/summary', authConfig())).data));
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
  });

  return (
    <Box className={`${sharedClasses.pageShell} ${classes.page} ${simpleTheme.simple} ${own.page}`}>
      <Box component="nav" aria-label="현재 위치" className={classes.pageBreadcrumb}>
        <Group className={classes.breadcrumbTrail} gap={7}>
          <Text component="span" className={classes.breadcrumbParent}>관리</Text>
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
