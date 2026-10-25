import { useMemo, useState } from 'react';
import { Box } from '@mantine/core';
import { IconFileDescription, IconPencil, IconPlayerPlay, IconSearch, IconX } from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import ErpBreadcrumb from '../components/common/ErpBreadcrumb';
import useErpPageRibbon from '../components/common/useErpPageRibbon';
import sharedClasses from '../styles/pages/ManagementShared.module.css';
import classes from '../styles/pages/AIOrderRegistry.module.css';

const initialOrders = [
  {
    id: 'AI2026102500001', date: '2026-10-25', customer: '동진', receiver: '모스코', due: '2026-11-05', place: '경북 구미시', note: '인식 확인 완료', status: '확정',
    items: [
      { name: 'ET', grade: '확인 필요', raw: '0.6 × 55 × C', t: 0.6, w: 55, l: 'C', qty: 1000, unit: 'KG', weight: 1000, stock: '확인 필요', processing: '검토 전', note: '강종 확인 필요' },
      { name: 'ET', grade: 'ET', raw: '0.6 × 78 × C', t: 0.6, w: 78, l: 'C', qty: 500, unit: 'KG', weight: 500, stock: '미조회', processing: '검토 전', note: '' },
      { name: 'ET', grade: 'ET', raw: '0.6 × 154 × C', t: 0.6, w: 154, l: 'C', qty: 700, unit: 'KG', weight: 700, stock: '일부 가능', processing: '재고 매칭 완료', note: '' },
      { name: 'ET', grade: 'ET', raw: '0.6 × 188 × C', t: 0.6, w: 188, l: 'C', qty: 500, unit: 'KG', weight: 500, stock: '미조회', processing: '검토 전', note: '' },
      { name: 'ET', grade: 'ET', raw: '0.6 × 191 × C', t: 0.6, w: 191, l: 'C', qty: 1000, unit: 'KG', weight: 1000, stock: '미조회', processing: '검토 전', note: '' },
      { name: 'ET', grade: 'ET', raw: '0.6 × 200 × C', t: 0.6, w: 200, l: 'C', qty: 500, unit: 'KG', weight: 500, stock: '미조회', processing: '검토 전', note: '' },
      { name: 'ET', grade: 'ET', raw: '0.6 × 210 × C', t: 0.6, w: 210, l: 'C', qty: 300, unit: 'KG', weight: 300, stock: '미조회', processing: '검토 전', note: '' },
    ],
  },
  {
    id: 'AI2026102500002', date: '2026-10-24', customer: '금영', receiver: '모스코', due: '2026-11-08', place: '경기도 화성시', note: '가공 검토 진행', status: '확정',
    items: [
      { name: '몰받이-포스맥(GIX)', grade: 'GIX', raw: '0.45 × 600 × C', t: 0.45, w: 600, l: 'C', qty: 7000, unit: 'KG', weight: 7000, stock: '가공 가능', processing: '가공 검토 중', note: '' },
      { name: '패드-소재-포스맥(GIX)', grade: 'GIX', raw: '0.78 × 67 × C', t: 0.78, w: 67, l: 'C', qty: 10000, unit: 'KG', weight: 10000, stock: '미조회', processing: '검토 전', note: '' },
    ],
  },
];

const number = (value) => Number(value || 0).toLocaleString('ko-KR');
function progression(order) {
  if (order.status === '취소') return '취소';
  const states = order.items.map((item) => item.processing);
  if (states.every((state) => state === '완료')) return '완료';
  if (states.some((state) => state === '가공 진행 중')) return '가공 진행 중';
  if (states.some((state) => state === '계획 확정')) return '계획 확정';
  if (states.some((state) => state === '가공 검토 중')) return '가공 검토 중';
  if (states.some((state) => state === '재고 매칭 완료')) return '재고 매칭 완료';
  return '검토 전';
}
function Badge({ value }) {
  const tone = ['확정', '완료', '가공 가능'].includes(value) ? 'green' : value === '취소' ? 'red' : ['확인 필요', '검토 전'].includes(value) ? 'orange' : 'blue';
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
  const navigate = useNavigate();
  const [orders, setOrders] = useState(() => initialOrders.map((order) => ({ ...order, items: order.items.map((item) => ({ ...item })) })));
  const [selectedId, setSelectedId] = useState(initialOrders[0].id);
  const [visibleIds, setVisibleIds] = useState(initialOrders.map(({ id }) => id));
  const [draftFilters, setDraftFilters] = useState({ from: '', to: '', customer: '', orderNo: '', status: '' });
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState('');
  const selectedOrder = orders.find(({ id }) => id === selectedId);
  const visibleOrders = useMemo(() => orders.filter(({ id }) => visibleIds.includes(id)), [orders, visibleIds]);
  const detailWeight = (order) => order.items.reduce((sum, item) => sum + item.weight, 0);
  const notify = (message) => { setToast(message); window.setTimeout(() => setToast(''), 2500); };
  useErpPageRibbon({ showPrint: false, useSaveColor: false });

  const applySearch = (criteria = draftFilters) => {
    const result = orders.filter((order) => (!criteria.from || order.date >= criteria.from)
      && (!criteria.to || order.date <= criteria.to)
      && order.customer.includes(criteria.customer.trim())
      && order.id.includes(criteria.orderNo.trim())
      && (!criteria.status || progression(order) === criteria.status));
    setVisibleIds(result.map(({ id }) => id));
    if (!result.some(({ id }) => id === selectedId)) setSelectedId(result[0]?.id || null);
  };
  const resetSearch = () => {
    const empty = { from: '', to: '', customer: '', orderNo: '', status: '' };
    setDraftFilters(empty); setVisibleIds(orders.map(({ id }) => id)); setSelectedId(orders[0]?.id || null);
  };
  const openPreview = () => {
    if (!selectedOrder) return notify('주문을 선택하세요.');
    setModal({ type: 'preview' });
  };
  const openEdit = () => {
    if (!selectedOrder) return notify('주문을 선택하세요.');
    if (selectedOrder.status === '취소') return notify('취소된 주문은 수정할 수 없습니다.');
    setModal({ type: 'edit', due: selectedOrder.due, place: selectedOrder.place });
  };
  const saveEdit = () => {
    if (!['검토 전', '재고 매칭 완료'].includes(progression(selectedOrder))) return notify('가공 진행상태 확인 및 변경승인이 필요합니다.');
    if (!modal.due) return notify('납기일을 입력하세요.');
    setOrders((current) => current.map((order) => order.id === selectedId ? { ...order, due: modal.due, place: modal.place, note: '변경 예시' } : order));
    setModal(null); notify('화면 데이터에만 변경되었습니다.');
  };
  const openCancel = () => {
    if (!selectedOrder) return notify('주문을 선택하세요.');
    if (selectedOrder.status === '취소') return notify('이미 취소된 주문입니다.');
    setModal({ type: 'cancel' });
  };
  const cancelOrder = () => {
    setOrders((current) => current.map((order) => order.id === selectedId ? { ...order, status: '취소', note: '취소 예시' } : order));
    setModal(null); notify('예시 주문이 취소 상태로 변경되었습니다.');
  };
  const openReview = () => {
    if (!selectedOrder) return notify('주문을 선택하세요.');
    setModal({ type: 'review' });
  };
  const moveToOptimization = () => {
    const unchecked = selectedOrder.items.filter((item) => item.grade === '확인 필요');
    if (unchecked.length) { notify('확인이 필요한 품목을 먼저 검토하세요.'); return; }
    navigate('/AIOrderOptimization');
  };
  const editField = (key, value) => setDraftFilters((current) => ({ ...current, [key]: value }));

  const renderModal = () => {
    if (!modal) return null;
    if (modal.type === 'preview') return <Modal title="원본 주문서 확인" onClose={() => setModal(null)} actions={<button type="button" className={classes.button} onClick={() => setModal(null)}>닫기</button>}>
      <div className={classes.info}>주문번호 <b>{selectedOrder.id}</b> · 발주처 {selectedOrder.customer}<br />AI 주문서 인식에서 보관한 원본 파일을 표시하는 영역입니다.</div>
      <div className={classes.preview}><IconFileDescription size={34} /><strong>원본 PDF · 이미지 미리보기 영역</strong><small>현재 샘플에는 원본 파일이 연결되지 않았습니다.</small></div>
    </Modal>;
    if (modal.type === 'edit') return <Modal title="주문 변경 (UI 예시)" onClose={() => setModal(null)} actions={<><button type="button" className={classes.button} onClick={() => setModal(null)}>닫기</button><button type="button" className={`${classes.button} ${classes.primary}`} onClick={saveEdit}>예시 변경 저장</button></>}>
      <div className={classes.info}>가공 검토가 진행된 주문은 변경할 수 없습니다. 주문번호와 발주처는 수정할 수 없습니다.</div>
      <div className={classes.formGrid}><label>발주처<input value={selectedOrder.customer} disabled /></label><label>주문번호<input value={selectedOrder.id} disabled /></label>
        <label>납기일<input type="date" value={modal.due} onChange={(event) => setModal((current) => ({ ...current, due: event.target.value }))} /></label>
        <label>납품장소<input value={modal.place} onChange={(event) => setModal((current) => ({ ...current, place: event.target.value }))} /></label></div>
      <p className={classes.note}>예시 상태만 수정됩니다. 실제 주문이나 DB에는 반영되지 않습니다.</p>
    </Modal>;
    if (modal.type === 'cancel') {
      const blocked = progression(selectedOrder) !== '검토 전';
      return <Modal title="주문 취소" onClose={() => setModal(null)} actions={<><button type="button" className={classes.button} onClick={() => setModal(null)}>닫기</button>{!blocked && <button type="button" className={`${classes.button} ${classes.dangerButton}`} onClick={cancelOrder}>예시 주문 취소</button>}</>}>
        <div className={classes.info}><b>{selectedOrder.id}</b> · {selectedOrder.customer}<br />{blocked ? '재고 매칭 또는 가공 검토가 진행된 주문입니다. 이 시안에서는 취소할 수 없습니다.' : '가공 검토 전 주문입니다. 취소하면 주문상태가 취소로 표시됩니다.'}</div>
      </Modal>;
    }
    const unchecked = selectedOrder.items.filter((item) => item.grade === '확인 필요');
    return <Modal title="가공 검토 요청" onClose={() => setModal(null)} actions={<><button type="button" className={classes.button} onClick={() => setModal(null)}>닫기</button><button type="button" className={`${classes.button} ${classes.primary}`} onClick={moveToOptimization}>가공 최적화 화면 이동</button></>}>
      <div className={classes.info}>주문번호 <b>{selectedOrder.id}</b><br />발주처 {selectedOrder.customer} · 상세 {selectedOrder.items.length}건</div>
      <div className={classes.flow}><span>주문 확정</span><b>→</b><span>규격 확인</span><b>→</b><span>재고매칭</span><b>→</b><span>가공 최적화</span></div>
      {unchecked.length > 0 ? <p className={classes.warning}>강종·규격 확인이 필요한 품목 {unchecked.length}건이 있습니다. 확인 완료 전에는 가공 최적화로 이동할 수 없습니다.</p> : <p className={classes.note}>선택 주문 정보를 기존 가공 최적화 화면으로 전달합니다. 실제 API·계산은 수행하지 않습니다.</p>}
    </Modal>;
  };

  return <Box className={`${sharedClasses.pageShell} ${classes.root}`}>
    <main className={classes.page}>
      <ErpBreadcrumb parent="가공관리" current="주문서 관리" />
      <div className={classes.toolbar}>
        <button type="button" className={classes.button} onClick={() => applySearch()}><IconSearch size={15} />조회</button>
        <span className={classes.separator} />
        <button type="button" className={classes.button} onClick={openPreview}><IconFileDescription size={15} />원본보기</button>
        <button type="button" className={classes.button} onClick={openEdit}><IconPencil size={15} />주문변경</button>
        <button type="button" className={`${classes.button} ${classes.dangerButton}`} onClick={openCancel}>⊘ 주문취소</button>
        <span className={classes.separator} />
        <button type="button" className={`${classes.button} ${classes.primary}`} onClick={openReview}><IconPlayerPlay size={15} />가공 검토</button>
        <span className={classes.toolbarHint}>확정 주문 조회 및 가공 진행 관리 · UI 목업</span>
      </div>

      <section className={`${classes.panel} ${classes.query}`}>
        <div className={classes.fields}>
          <label>주문일 시작<input type="date" value={draftFilters.from} onChange={(event) => editField('from', event.target.value)} /></label>
          <label>주문일 종료<input type="date" value={draftFilters.to} onChange={(event) => editField('to', event.target.value)} /></label>
          <label>발주처<input value={draftFilters.customer} placeholder="발주처 검색" onChange={(event) => editField('customer', event.target.value)} /></label>
          <label>주문번호<input value={draftFilters.orderNo} placeholder="주문번호 검색" onChange={(event) => editField('orderNo', event.target.value)} /></label>
          <label>진행상태<select value={draftFilters.status} onChange={(event) => editField('status', event.target.value)}><option value="">전체</option>{['검토 전', '재고 매칭 완료', '가공 검토 중', '계획 확정', '가공 진행 중', '완료', '취소'].map((status) => <option key={status}>{status}</option>)}</select></label>
        </div>
        <div className={classes.queryActions}><button type="button" className={classes.button} onClick={resetSearch}>초기화</button><button type="button" className={`${classes.button} ${classes.primary}`} onClick={() => applySearch()}>조회</button></div>
      </section>

      <section className={classes.panel}>
        <header className={classes.panelHeader}><strong>주문 기본</strong><span className={classes.count}>{visibleOrders.length}건</span><small>행을 선택하면 하단 주문 상세가 표시됩니다.</small></header>
        <div className={`${classes.tableScroll} ${classes.ordersScroll}`}><table className={classes.ordersTable}><thead><tr>{['주문일자', '주문번호', '발주처', '수신처', '납기일', '납품장소', '상세건수', '주문중량(KG)', '주문상태', '가공진행', '비고'].map((name) => <th key={name}>{name}</th>)}</tr></thead>
          <tbody>{visibleOrders.length ? visibleOrders.map((order) => <tr key={order.id} className={order.id === selectedId ? classes.selectedRow : ''} onClick={() => setSelectedId(order.id)}>
            <td>{order.date}</td><td>{order.id}</td><td>{order.customer}</td><td>{order.receiver}</td><td>{order.due}</td><td title={order.place}>{order.place}</td><td className={classes.center}>{order.items.length}</td><td className={classes.numeric}>{number(detailWeight(order))}</td><td><Badge value={order.status} /></td><td><Badge value={progression(order)} /></td><td>{order.note}</td>
          </tr>) : <tr><td colSpan="11" className={classes.empty}>조회된 주문이 없습니다.</td></tr>}</tbody></table></div>
        <footer className={classes.panelFooter}><span>총 {visibleOrders.length}건</span><div className={classes.pager}><button disabled>«</button><button disabled>‹</button><b>1</b><button disabled>›</button><button disabled>»</button></div></footer>
      </section>

      <section className={`${classes.panel} ${classes.detailPanel}`}>
        <header className={classes.panelHeader}><strong>주문 상세</strong><span className={`${classes.count} ${classes.blue}`}>{selectedOrder?.id || '주문을 선택하세요'}</span><small>{selectedOrder ? `${selectedOrder.customer} · ${selectedOrder.items.length}개 품목` : '품목별 가공 상태 관리'}</small></header>
        <div className={`${classes.tableScroll} ${classes.detailsScroll}`}><table className={classes.detailsTable}><thead><tr>{['순번', '품명', '강종', '규격 원문', '두께', '폭', '길이', '수량', '수량단위', '중량(KG)', '납기일', '재고매칭', '가공상태', '비고'].map((name) => <th key={name}>{name}</th>)}</tr></thead>
          <tbody>{selectedOrder ? selectedOrder.items.map((item, index) => <tr key={`${selectedOrder.id}-${index}`}><td className={classes.center}>{index + 1}</td><td title={item.name}>{item.name}</td><td>{item.grade === '확인 필요' ? <Badge value="확인 필요" /> : item.grade}</td><td>{item.raw}</td><td className={classes.numeric}>{item.t}</td><td className={classes.numeric}>{number(item.w)}</td><td className={classes.center}>{item.l}</td><td className={classes.numeric}>{number(item.qty)}</td><td>{item.unit}</td><td className={classes.numeric}>{number(item.weight)}</td><td>{selectedOrder.due}</td><td><Badge value={item.stock} /></td><td><Badge value={item.processing} /></td><td title={item.note}>{item.note}</td></tr>) : <tr><td colSpan="14" className={classes.empty}>주문을 선택하세요.</td></tr>}</tbody></table></div>
        <footer className={classes.panelFooter}><span>총 {selectedOrder?.items.length || 0}건 · 주문중량 {number(selectedOrder ? detailWeight(selectedOrder) : 0)} KG</span><small>규격 확인이 필요한 품목은 가공 최적화 대상에서 제외합니다.</small></footer>
      </section>
    </main>
    {renderModal()}
    {toast && <div className={classes.toast} role="status">{toast}</div>}
  </Box>;
}
