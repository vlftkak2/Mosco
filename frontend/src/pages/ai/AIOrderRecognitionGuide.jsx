// AI 주문서인식 '진행 상태 안내'. 가공주문관리 · 가공최적화 안내와 같은 디자인.
// 내용은 현재 동작과 같게 유지할 것:
//   상태 = AIOrderPage.jsx documentStatus() · 확인 필요 표시 = 서버 needs_review (services/ai/AIOrder.py)
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { IconX } from '@tabler/icons-react';
import m from '../../styles/pages/AIOrderManage.module.css';

const B = ({ children }) => <b>{children}</b>;

const DOCUMENT_STATUS = [
  { tone: 'gray', label: '분석 전', desc: '목록에 올린 뒤 아직 분석하지 않은 파일', lines: [
    <><B>[AI 일괄 분석]</B> 시 분석 대기로 전환됩니다.</>,
    <><B>[결과 확인]</B> 시 같은 파일을 전에 분석한 결과가 있으면 불러옵니다. 이때는 AI 분석 횟수에 세지 않습니다.</>] },
  { tone: 'gray', label: '분석 대기', desc: '분석 순서를 기다리는 중', lines: [
    '한 번에 최대 2건씩 분석하며, 앞 요청이 끝나면 자동으로 시작합니다.'] },
  { tone: 'blue', label: '분석 중', desc: 'AI가 주문서를 읽는 중', lines: [
    '문서에 따라 시간이 걸릴 수 있습니다. 끝나면 분석 완료 또는 확인 필요로 전환됩니다.'] },
  { tone: 'red', label: '분석 실패', desc: '분석 중 오류 발생', lines: [
    <>오류 내용을 확인한 뒤 <B>[AI 일괄 분석]</B>으로 다시 실행할 수 있습니다.</>] },
  { tone: 'orange', label: '확인 필요', desc: '사람이 원본과 대조해야 할 값이 있음', lines: [
    '주문서 헤더나 상세 품목 중 하나라도 확인 필요 표시가 있으면 이 상태가 됩니다.',
    '상세 품목에서는 행 왼쪽 노란 줄로 표시되고, 행에 마우스를 올리면 사유가 보입니다.',
    <>원본과 대조해 고친 뒤 <B>[주문확정]</B>합니다. 확인 필요 상태라도 주문확정은 막지 않습니다.</>] },
  { tone: 'indigo', label: '분석 완료', desc: '확인 필요 표시 없이 분석됨', lines: [
    <>원본과 대조한 뒤 <B>[주문확정]</B>으로 가공주문관리에 넘깁니다.</>] },
];

const REVIEW_CAUSES = [
  <>숫자가 흐리거나 필기와 겹쳐 <B>확정할 수 없는 경우</B> → 숫자 칸은 비우고 읽은 원문만 남깁니다.</>,
  <>발주일자 · 납기일에 <B>연 · 월만 있고 일이 없는 경우</B> → 날짜를 비웁니다.</>,
  <>납품 장소를 <B>발주처 주소로 대신 채운 경우</B>, 또는 주소를 하나로 정할 수 없어 비운 경우.</>,
  <><B>회사별 규칙</B>(원본 항목 → 칸)의 근거를 못 찾았거나, 숫자로 바꿀 수 없거나, 기존 값을 바꿔 넣은 경우.</>,
  <>AI가 읽은 값의 <B>원본 위치를 검증하지 못한 경우</B>. 이미지 파일(JPG · PNG 등)은 위치를 검증할 수 없어 대부분 확인 필요가 됩니다.</>,
  <><B>[행 추가]</B> 또는 행 복제로 직접 만든 행.</>,
];

export default function AIOrderRecognitionGuide({ opened, onClose }) {
  useEffect(() => {
    if (!opened) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [opened, onClose]);
  if (!opened) return null;
  return createPortal(<div className={m.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={`${m.modal} ${m.guideModal}`} role="dialog" aria-modal="true" aria-label="진행 상태 안내">
      <header className={m.modalHeader}>
        <div><h2>진행 상태 안내</h2></div>
        <button type="button" className={m.modalClose} aria-label="닫기" onClick={onClose}><IconX size={18} /></button>
      </header>
      <div className={m.modalBody}>
        <div className={m.guideSection}>
          <h3 className={m.guideSectionTitle}>발주서 (분석 상태)</h3>
          <p className={m.guideHint}>분석 전 → 분석 대기 → 분석 중 → 분석 완료 · 확인 필요</p>
          {DOCUMENT_STATUS.map((item) => <div key={item.label} className={m.guideItem}>
            <div className={m.guideHead}><span className={`${m.status} ${m[`status_${item.tone}`] || m.status_gray}`}>{item.label}</span><span>{item.desc}</span></div>
            <ul className={m.guideBox}>{item.lines.map((line, index) => <li key={index}>{line}</li>)}</ul>
          </div>)}
        </div>

        <div className={m.guideSection}>
          <h3 className={m.guideSectionTitle}>확인 필요가 붙는 경우</h3>
          <p className={m.guideHint}>AI 분석 결과에 자동으로 붙습니다. 아래 중 하나라도 해당하면 확인 필요입니다.</p>
          <ul className={m.guideBox}>{REVIEW_CAUSES.map((line, index) => <li key={index}>{line}</li>)}</ul>
        </div>

        <div className={m.guideSection}>
          <h3 className={m.guideSectionTitle}>확인 후 · 주문확정</h3>
          <ul className={m.guideBox}>
            <li>확인 필요 표시는 값을 고쳐도 자동으로 풀리지 않습니다. 납품 장소를 고치면 헤더의 표시만 풀립니다.</li>
            <li>두께 · 폭 · 길이 · 수량 · 중량은 숫자만, 소수점 셋째 자리까지 입력할 수 있습니다. 형식이 맞지 않으면 <B>[주문확정]</B>할 수 없습니다.</li>
            <li><B>[주문확정]</B>은 저장이 아니라 가공주문관리로 넘기는 것입니다. 가공주문관리에서 <B>[저장]</B>해야 주문이 저장됩니다.</li>
          </ul>
        </div>
      </div>
      <footer className={m.modalFooter}><button type="button" className={`${m.btn} ${m.btnLine}`} onClick={onClose}>닫기</button></footer>
    </section>
  </div>, document.body);
}
