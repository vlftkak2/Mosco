// 통제관리 (기준정보 › 통제관리) — backend/services/control/Approval.py
// 담당자가 거래처 · 매입 · 매출 · 수금/지급을 등록 · 수정 · 삭제하면 승인요청으로 보관되고, 승인자가 승인해야 반영된다.
//  승인함   : 승인자 — 대기 건을 보고 승인 / 반려(사유)
//  내 요청  : 모든 직원 — 내가 요청한 건의 결과, 대기 건 취소
//  통제 설정: 관리자(MASTER · SUBMASTER) — 대상 · 동작별 켜기, 승인자 지정(본인 가능), 본인 승인 허용(승인자 1명일 때만)
//  이력     : 관리자 · 승인자 — 요청 · 승인 · 반려 · 취소 · 설정 변경 기록
import { useCallback, useEffect, useEffectEvent, useMemo, useState } from 'react';
import axios from 'axios';
import { Box, Group, Loader, Pagination, Paper, Select, Switch, Text, TextInput, Textarea } from '@mantine/core';
import { notifications } from '@mantine/notifications';
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
// 시각은 한국시간으로 'YYYY-MM-DD HH:mm'
const kst = (value) => {
  if (!value) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
};
const num = (value, digits = 3) => (value === null || value === undefined || value === '' ? ''
  : Number(value).toLocaleString('ko-KR', { maximumFractionDigits: digits }));
const STATUS_OPTIONS = [
  { value: '', label: '전체' }, { value: 'PENDING', label: '대기' }, { value: 'APPROVED', label: '승인' },
  { value: 'REJECTED', label: '반려' }, { value: 'CANCELED', label: '취소' },
];
const TARGET_OPTIONS = [
  { value: '', label: '전체' }, { value: 'CUSTOMER', label: '거래처' }, { value: 'INBOUND', label: '매입' },
  { value: 'OUTBOUND', label: '매출' }, { value: 'RECEIPT_PAYMENT', label: '수금/지급' },
];
const STATUS_CLASS = { PENDING: own.wait, PROCESSING: own.wait, APPROVED: own.ok, REJECTED: own.no, CANCELED: own.muted };
const PAGE_SIZE = 30;

const StatusPill = ({ status, label }) => <span className={`${own.pill} ${STATUS_CLASS[status] || ''}`}>{label}</span>;

// 요청 내용 보기: 대상마다 알아보기 쉬운 칸만
function RequestData({ item }) {
  const data = item.data || {};
  const body = data.item || {};
  if (item.op === 'delete') return <div className={own.kv}><span>대상 전표</span><b>{data.receiptno}</b></div>;
  if (item.op === 'manager') return <div className={own.kv}><span>대상 전표</span><b>{data.receiptno}</b><span>바꿀 담당자</span><b>{data.manager || '(없음)'}</b></div>;
  if (item.target === 'CUSTOMER') {
    const rows = item.op === 'bulk_create' ? (data.items || []) : [body];
    return <div className={own.tableWrap}><table className={own.table}>
      <thead><tr><th>거래처코드</th><th>거래처명</th><th>사업자번호</th><th>대표자</th><th>담당자</th><th>전화</th></tr></thead>
      <tbody>{rows.slice(0, 200).map((row, index) => <tr key={index}>
        <td>{row.customercode || '자동'}</td><td>{row.customername}</td><td>{row.businessno}</td><td>{row.ceoname}</td><td>{row.manager}</td><td>{row.phone}</td>
      </tr>)}</tbody>
    </table>{rows.length > 200 && <div className={own.more}>외 {rows.length - 200}건</div>}</div>;
  }
  if (item.op === 'sales_fields') {
    return <div className={own.kv}>
      <span>대상 전표</span><b>{data.receiptno}</b>
      {body.manager !== null && body.manager !== undefined && <><span>담당자</span><b>{body.manager || '(없음)'}</b></>}
      {body.destination !== null && body.destination !== undefined && <><span>착지</span><b>{body.destination || '(없음)'}</b></>}
      {(body.prices || []).length > 0 && <><span>판매단가</span><b>{body.prices.map((p) => `${p.lineno}행 ${num(p.unitprice, 2)}`).join(', ')}</b></>}
    </div>;
  }
  const lines = body.items || [];
  const header = <div className={own.kv}>
    <span>일자</span><b>{String(body.receptdate || body.receiptdate || '').slice(0, 10)}</b>
    <span>거래처</span><b>{body.customname || lines[0]?.customname || ''}</b>
    {body.receiptno ? <><span>수정 전표</span><b>{body.receiptno}</b></> : null}
    {body.manager ? <><span>담당자</span><b>{body.manager}</b></> : null}
    {body.transactiontype ? <><span>구분</span><b>{body.transactiontype === 'RECEIPT' ? '수금' : '지급'}</b></> : null}
  </div>;
  if (item.target === 'RECEIPT_PAYMENT') {
    return <>{header}<div className={own.tableWrap}><table className={own.table}>
      <thead><tr><th>현금</th><th>어음/수표</th><th>은행</th><th>카드</th><th>상계</th><th>잡손실</th><th>수수료</th><th>비고</th></tr></thead>
      <tbody>{lines.map((row, index) => <tr key={index}>
        {['cashamt', 'instrumentamt', 'bankamt', 'cardamt', 'offsetamt', 'lossamt', 'chargeamt'].map((key) => <td key={key} className={own.num}>{num(row[key], 0)}</td>)}
        <td>{row.description}</td>
      </tr>)}</tbody>
    </table></div></>;
  }
  const isOut = item.target === 'OUTBOUND';
  return <>{header}<div className={own.tableWrap}><table className={own.table}>
    <thead><tr>{isOut ? <><th>원천전표</th><th>순번</th></> : <><th>품명</th><th>두께</th><th>폭</th><th>길이</th></>}<th>수량</th><th>중량(kg)</th><th>단가</th></tr></thead>
    <tbody>{lines.map((row, index) => <tr key={index}>
      {isOut ? <><td>{row.stocksourceno}</td><td className={own.num}>{row.stocksourceline}</td></>
        : <><td>{row.itemname}</td><td className={own.num}>{num(row.thickness)}</td><td className={own.num}>{num(row.width)}</td><td className={own.num}>{num(row.length)}</td></>}
      <td className={own.num}>{num(row.qty)}</td><td className={own.num}>{num(row.weight)}</td><td className={own.num}>{num(row.unitprice, 2)}</td>
    </tr>)}</tbody>
  </table></div>{(body.expenses || []).length > 0 && <div className={own.more}>기타비용 {body.expenses.length}건 포함</div>}</>;
}

function RequestDetail({ requestno, onChanged }) {
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    if (!requestno) { setItem(null); return; }
    setLoading(true);
    try {
      const { data } = await axios.get(`/api/control/requests/${encodeURIComponent(requestno)}`, authConfig());
      setItem(data);
    } catch (error) {
      notifications.show({ title: '요청 조회 실패', message: errorText(error), color: 'red' });
    } finally { setLoading(false); }
  }, [requestno]);
  useEffect(() => { setRejecting(false); setReason(''); void load(); }, [load]);

  const act = async (kind) => {
    setBusy(true);
    try {
      const url = `/api/control/requests/${encodeURIComponent(requestno)}/${kind}`;
      const { data } = await axios.post(url, kind === 'reject' ? { reason } : {}, authConfig());
      const text = kind === 'approve'
        ? `승인했습니다.${data.result_no ? ` 반영: ${data.result_no}` : ''}${data.self_approved ? ' (본인 승인)' : ''}`
        : kind === 'reject' ? '반려했습니다.' : '요청을 취소했습니다.';
      notifications.show({ title: '처리 완료', message: text, color: 'teal' });
      window.dispatchEvent(new Event('approval-changed'));
      setRejecting(false); setReason('');
      await load();
      onChanged?.();
    } catch (error) {
      notifications.show({ title: '처리 실패', message: errorText(error), color: 'red', autoClose: 9000 });
      await load();
    } finally { setBusy(false); }
  };

  if (!requestno) return <div className={own.empty}>왼쪽 목록에서 요청을 선택하세요.</div>;
  if (!item) return <div className={own.empty}>{loading ? <Loader size="sm" color="red" /> : '요청을 불러오지 못했습니다.'}</div>;
  return <div className={own.detail}>
    <div className={own.detailHead}>
      <h4>{item.target_label} {item.action_label}</h4>
      <StatusPill status={item.status} label={item.status_label} />
      {item.self_approved === 'Y' && <span className={`${own.pill} ${own.muted}`}>본인 승인</span>}
      <span className={own.reqNo}>{item.requestno}</span>
    </div>
    <div className={own.kv}>
      <span>내용</span><b>{item.summary}</b>
      <span>요청</span><b>{item.requested_name} · {kst(item.requested_at)}</b>
      {item.decided_at && <><span>처리</span><b>{item.decided_name} · {kst(item.decided_at)}</b></>}
      {item.result_no && <><span>반영 번호</span><b>{item.result_no}</b></>}
      {item.reject_reason && <><span>반려 사유</span><b className={own.reason}>{item.reject_reason}</b></>}
    </div>
    <div className={own.sectionTitle}>요청 내용</div>
    <RequestData item={item} />
    {item.reservations?.length > 0 && <>
      <div className={own.sectionTitle}>예약 재고 <small>승인 · 반려 · 취소되면 풀립니다</small></div>
      <div className={own.tableWrap}><table className={own.table}>
        <thead><tr><th>원천전표</th><th>순번</th><th>품명</th><th>규격</th><th>수량</th><th>중량(kg)</th></tr></thead>
        <tbody>{item.reservations.map((row) => <tr key={`${row.sourcetype}:${row.sourceno}:${row.sourceline}`}>
          <td>{row.sourceno}</td><td className={own.num}>{row.sourceline}</td><td>{row.itemname}</td>
          <td>{[row.thickness, row.width, row.length].filter((v) => Number(v) > 0).map((v) => num(v)).join('×')}</td>
          <td className={own.num}>{num(row.qty)}</td><td className={own.num}>{num(row.weight)}</td>
        </tr>)}</tbody>
      </table></div>
    </>}
    <div className={own.sectionTitle}>처리 이력</div>
    <ul className={own.timeline}>{(item.history || []).map((row, index) => <li key={index}>
      <b>{row.event_label}</b><span>{row.actor_name} · {kst(row.createdat)}</span>{row.detail && <em>{row.detail}</em>}
    </li>)}</ul>
    {(item.can_approve || item.can_reject || item.can_cancel) && <div className={own.actions}>
      {rejecting ? <>
        <Textarea className={own.reasonInput} placeholder="반려 사유 (요청자에게 보입니다)" autosize minRows={2} maxLength={500}
          value={reason} onChange={(event) => setReason(event.currentTarget.value)} />
        <Group gap={6}>
          <button type="button" className={`${own.btn} ${own.navy}`} disabled={busy || !reason.trim()} onClick={() => act('reject')}>반려 확정</button>
          <button type="button" className={`${own.btn} ${own.gray}`} disabled={busy} onClick={() => setRejecting(false)}>닫기</button>
        </Group>
      </> : <Group gap={6}>
        {item.can_approve && <button type="button" className={`${own.btn} ${own.red}`} disabled={busy} onClick={() => act('approve')}>승인</button>}
        {item.can_reject && <button type="button" className={`${own.btn} ${own.navy}`} disabled={busy} onClick={() => setRejecting(true)}>반려</button>}
        {item.can_cancel && <button type="button" className={`${own.btn} ${own.gray}`} disabled={busy} onClick={() => act('cancel')}>요청 취소</button>}
        {item.status === 'PENDING' && item.mine && item.can_reject && !item.can_approve && <span className={own.hint}>본인 요청은 다른 승인자가 승인합니다.</span>}
      </Group>}
    </div>}
  </div>;
}

function RequestsTab({ scope, reloadKey }) {
  const [filters, setFilters] = useState({ status: scope === 'inbox' ? 'PENDING' : '', target: '', q: '' });
  const [query, setQuery] = useState(filters);
  const [result, setResult] = useState({ items: [], total: 0 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState('');

  const load = useCallback(async (nextPage = page, nextQuery = query) => {
    setLoading(true);
    try {
      const { data } = await axios.get('/api/control/requests', { ...authConfig(), params: { scope, ...nextQuery, page: nextPage, page_size: PAGE_SIZE } });
      setResult(data);
      setPage(nextPage);
    } catch (error) {
      notifications.show({ title: '목록 조회 실패', message: errorText(error), color: 'red' });
    } finally { setLoading(false); }
  }, [scope, page, query]);
  useEffect(() => { void load(1, query); }, [query, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps
  usePageReactivated(() => { void load(page, query); });
  useEffect(() => {
    const refresh = () => { void load(page, query); };
    window.addEventListener('approval-changed', refresh);
    return () => window.removeEventListener('approval-changed', refresh);
  }, [load, page, query]);

  return <div className={own.split}>
    <Paper className={`${sharedClasses.panel} ${own.listPanel}`} withBorder>
      <div className={own.filterRow}>
        <Select className={own.smallSelect} data={STATUS_OPTIONS} value={filters.status} allowDeselect={false} aria-label="상태"
          onChange={(value) => { const next = { ...filters, status: value || '' }; setFilters(next); setQuery(next); }} />
        <Select className={own.smallSelect} data={TARGET_OPTIONS} value={filters.target} allowDeselect={false} aria-label="구분"
          onChange={(value) => { const next = { ...filters, target: value || '' }; setFilters(next); setQuery(next); }} />
        <TextInput className={own.search} placeholder="요청번호 · 내용 · 전표번호 · 요청자" value={filters.q}
          onChange={(event) => { const value = event.currentTarget.value; setFilters((current) => ({ ...current, q: value })); }}
          onKeyDown={(event) => { if (event.key === 'Enter') setQuery({ ...filters }); }} />
        <span className={own.count}>{result.total.toLocaleString('ko-KR')}건</span>
      </div>
      <div className={own.listScroll}>
        <table className={own.table}>
          <colgroup><col style={{ width: 128 }} /><col style={{ width: 98 }} /><col /><col style={{ width: 76 }} /><col style={{ width: 60 }} /></colgroup>
          <thead><tr><th>요청일시</th><th>구분</th><th>내용</th><th>요청자</th><th>상태</th></tr></thead>
          <tbody>
            {result.items.map((row) => <tr key={row.requestno} className={`${own.clickRow} ${selected === row.requestno ? own.selected : ''}`}
              onClick={() => setSelected(row.requestno)} tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') setSelected(row.requestno); }}>
              <td className={own.mono}>{kst(row.requested_at)}</td>
              <td>{row.target_label} {row.action_label}</td>
              <td className={own.ellipsis} title={row.summary}>{row.summary}</td>
              <td className={own.ellipsis}>{row.requested_name}</td>
              <td><StatusPill status={row.status} label={row.status_label} /></td>
            </tr>)}
            {!result.items.length && <tr><td colSpan={5} className={own.emptyCell}>{loading ? '조회 중입니다.' : scope === 'inbox' ? '처리할 승인요청이 없습니다.' : '요청한 내역이 없습니다.'}</td></tr>}
          </tbody>
        </table>
      </div>
      <div className={own.pager}>
        <Pagination size="sm" color="red" total={Math.max(1, Math.ceil(result.total / PAGE_SIZE))} value={page} onChange={(next) => load(next, query)} />
      </div>
    </Paper>
    <Paper className={`${sharedClasses.panel} ${own.detailPanel}`} withBorder>
      <RequestDetail requestno={selected} onChanged={() => load(page, query)} />
    </Paper>
  </div>;
}

function SettingsTab({ reloadKey }) {
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
  useEffect(() => { void load(); }, [load, reloadKey]);

  if (!settings) return <div className={own.empty}><Loader size="sm" color="red" /></div>;
  const editable = settings.can_edit;
  const approverCount = settings.users.filter((user) => user.approver).length;
  const setPolicy = (target, key, value) => setSettings((current) => ({
    ...current, policies: current.policies.map((policy) => (policy.target === target ? { ...policy, [key]: value } : policy)),
  }));
  const setApprover = (email, value) => setSettings((current) => {
    const users = current.users.map((user) => (user.email === email ? { ...user, approver: value } : user));
    const count = users.filter((user) => user.approver).length;
    return { ...current, users, self_approve: count === 1 ? current.self_approve : false };
  });
  const save = async () => {
    setSaving(true);
    try {
      const { data } = await axios.put('/api/control/settings', {
        policies: settings.policies.map(({ target, on_create, on_update, on_delete }) => ({ target, on_create, on_update, on_delete })),
        self_approve: settings.self_approve,
        approvers: settings.users.filter((user) => user.approver).map((user) => user.email),
      }, authConfig());
      setSettings(data);
      window.dispatchEvent(new Event('approval-changed'));
      notifications.show({ title: '저장 완료', message: '통제 설정을 저장했습니다. 변경 내용은 이력에 남습니다.', color: 'teal' });
    } catch (error) {
      notifications.show({ title: '저장 실패', message: errorText(error), color: 'red' });
    } finally { setSaving(false); }
  };

  return <Paper className={`${sharedClasses.panel} ${own.sheet}`} withBorder>
    <div className={own.blockHead}>
      <h3>승인받을 대상</h3><span>켜 둔 동작은 저장하면 바로 반영되지 않고 승인요청으로 들어갑니다.</span>
      {editable && <button type="button" className={`${own.btn} ${own.red} ${own.headBtn}`} disabled={saving} onClick={save}>저장</button>}
    </div>
    <div className={`${own.tableWrap} ${own.policyWrap}`}><table className={own.table}>
      <thead><tr><th>대상</th><th>등록</th><th>수정</th><th>삭제</th></tr></thead>
      <tbody>{settings.policies.map((policy) => <tr key={policy.target}>
        <td><b>{policy.label}</b></td>
        {['on_create', 'on_update', 'on_delete'].map((key) => <td key={key} className={own.center}>
          <Switch color="red" size="sm" checked={policy[key]} disabled={!editable} onChange={(event) => setPolicy(policy.target, key, event.currentTarget.checked)}
            aria-label={`${policy.label} ${key === 'on_create' ? '등록' : key === 'on_update' ? '수정' : '삭제'} 승인`} />
        </td>)}
      </tr>)}</tbody>
    </table></div>

    <div className={own.blockHead}>
      <h3>승인자</h3><span>체크한 직원이 승인함에서 승인 · 반려합니다. 본인도 지정할 수 있습니다. (현재 {approverCount}명)</span>
    </div>
    <label className={`${own.selfApprove} ${approverCount !== 1 ? own.disabledText : ''}`}>
      <input type="checkbox" checked={settings.self_approve} disabled={!editable || approverCount !== 1}
        onChange={(event) => { const { checked } = event.currentTarget; setSettings((current) => ({ ...current, self_approve: checked })); }} />
      본인 승인 허용 <small>승인자가 1명뿐일 때만 켤 수 있습니다. 본인이 요청한 건을 본인이 승인하면 이력에 '본인 승인'으로 남습니다.</small>
    </label>
    <div className={`${own.tableWrap} ${own.userTableWrap}`}><table className={own.table}>
      <colgroup><col style={{ width: 70 }} /><col style={{ width: 120 }} /><col /><col style={{ width: 120 }} /><col style={{ width: 100 }} /><col style={{ width: 100 }} /></colgroup>
      <thead><tr><th>승인자</th><th>이름</th><th>이메일</th><th>부서</th><th>직급</th><th>권한</th></tr></thead>
      <tbody>{settings.users.map((user) => <tr key={user.email} className={user.approver ? own.selected : ''}>
        <td className={own.center}><input type="checkbox" checked={user.approver} disabled={!editable} onChange={(event) => setApprover(user.email, event.currentTarget.checked)} aria-label={`${user.username} 승인자`} /></td>
        <td>{user.username}</td><td className={own.ellipsis}>{user.email}</td><td>{user.team}</td><td>{user.position}</td><td>{user.authority}</td>
      </tr>)}</tbody>
    </table></div>
    {!editable && <div className={own.hint}>통제 설정은 관리자(MASTER · SUBMASTER)만 바꿀 수 있습니다.</div>}
  </Paper>;
}

function HistoryTab({ reloadKey }) {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [result, setResult] = useState({ items: [], total: 0 });
  const [page, setPage] = useState(1);
  const load = useCallback(async (nextPage, nextQuery) => {
    try {
      const { data } = await axios.get('/api/control/history', { ...authConfig(), params: { q: nextQuery, page: nextPage, page_size: 50 } });
      setResult(data); setPage(nextPage);
    } catch (error) {
      notifications.show({ title: '이력 조회 실패', message: errorText(error), color: 'red' });
    }
  }, []);
  const runLoad = useEffectEvent((nextPage, nextQuery) => { void load(nextPage, nextQuery); });
  useEffect(() => { runLoad(1, query); }, [query, reloadKey]);
  return <Paper className={`${sharedClasses.panel} ${own.sheet}`} withBorder>
    <div className={own.filterRow}>
      <TextInput className={own.search} placeholder="요청번호 · 내용 · 처리자" value={q} onChange={(event) => setQ(event.currentTarget.value)}
        onKeyDown={(event) => { if (event.key === 'Enter') setQuery(q); }} />
      <span className={own.count}>{result.total.toLocaleString('ko-KR')}건</span>
    </div>
    <div className={own.listScroll}><table className={own.table}>
      <colgroup><col style={{ width: 130 }} /><col style={{ width: 110 }} /><col style={{ width: 150 }} /><col /><col style={{ width: 110 }} /></colgroup>
      <thead><tr><th>일시</th><th>구분</th><th>요청번호</th><th>내용</th><th>처리자</th></tr></thead>
      <tbody>
        {result.items.map((row) => <tr key={row.id}>
          <td className={own.mono}>{kst(row.createdat)}</td><td><b>{row.event_label}</b></td><td className={own.mono}>{row.requestno || ''}</td>
          <td className={own.ellipsis} title={row.detail}>{row.detail}</td><td>{row.actor_name}</td>
        </tr>)}
        {!result.items.length && <tr><td colSpan={5} className={own.emptyCell}>이력이 없습니다.</td></tr>}
      </tbody>
    </table></div>
    <div className={own.pager}>
      <Pagination size="sm" color="red" total={Math.max(1, Math.ceil(result.total / 50))} value={page} onChange={(next) => load(next, query)} />
    </div>
  </Paper>;
}

export default function ControlManagement() {
  const [summary, setSummary] = useState(null);
  const [tab, setTab] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const loadSummary = useCallback(async () => {
    try {
      const { data } = await axios.get('/api/control/summary', authConfig());
      setSummary(data);
    } catch {
      setSummary({ enabled: false });
    }
  }, []);
  const loadFirst = useEffectEvent(() => { void loadSummary(); });
  useEffect(() => { loadFirst(); }, []);
  usePageReactivated(() => { void loadSummary(); });
  useEffect(() => {
    const refresh = () => { void loadSummary(); };
    window.addEventListener('approval-changed', refresh);
    return () => window.removeEventListener('approval-changed', refresh);
  }, [loadSummary]);

  const tabs = useMemo(() => {
    if (!summary?.enabled) return [];
    return [
      (summary.is_approver || summary.is_admin) && { key: 'inbox', label: '승인함', badge: summary.pending },
      { key: 'mine', label: '내 요청', badge: summary.my_pending },
      { key: 'settings', label: '통제 설정' },
      (summary.is_approver || summary.is_admin) && { key: 'history', label: '이력' },
    ].filter(Boolean);
  }, [summary]);
  const activeTab = tabs.some((item) => item.key === tab) ? tab : tabs[0]?.key;
  useErpPageRibbon({ onSearch: () => { setReloadKey((value) => value + 1); void loadSummary(); }, showPrint: false, useSaveColor: false });

  return (
    <Box className={`${sharedClasses.pageShell} ${classes.page} ${simpleTheme.simple} ${own.page}`}>
      <Box component="nav" aria-label="현재 위치" className={classes.pageBreadcrumb}>
        <Group className={classes.breadcrumbTrail} gap={7}>
          <Text component="span" className={classes.breadcrumbParent}>기준정보</Text>
          <Text component="span" className={classes.breadcrumbChevron}>›</Text>
          <Text component="span" className={classes.breadcrumbCurrent}>통제관리</Text>
        </Group>
      </Box>
      {!summary ? <div className={own.empty}><Loader size="sm" color="red" /></div>
        : !summary.enabled ? <Paper className={`${sharedClasses.panel} ${own.sheet}`} withBorder><div className={own.empty}>이 고객사는 승인 통제를 사용하지 않습니다. (고객사등록에서 허용해야 쓸 수 있습니다)</div></Paper>
          : <>
            <div className={own.tabs} role="tablist">
              {tabs.map((item) => <button key={item.key} type="button" role="tab" aria-selected={activeTab === item.key}
                className={`${own.tab} ${activeTab === item.key ? own.tabOn : ''}`} onClick={() => setTab(item.key)}>
                {item.label}{item.badge > 0 && <span className={own.badge}>{item.badge}</span>}
              </button>)}
            </div>
            <div className={own.body}>
              {activeTab === 'inbox' && <RequestsTab key="inbox" scope="inbox" reloadKey={reloadKey} />}
              {activeTab === 'mine' && <RequestsTab key="mine" scope="mine" reloadKey={reloadKey} />}
              {activeTab === 'settings' && <SettingsTab reloadKey={reloadKey} />}
              {activeTab === 'history' && <HistoryTab reloadKey={reloadKey} />}
            </div>
          </>}
    </Box>
  );
}
