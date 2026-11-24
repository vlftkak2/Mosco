// 가공 최적화 사용 안내. 가공주문관리 '진행 상태 안내'와 같은 디자인 · 핵심만.
// 내용은 현재 계산 로직과 같게 유지할 것.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconX } from '@tabler/icons-react';
import m from '../../styles/pages/AIOrderManage.module.css';
import classes from '../../styles/pages/AIOrderOptimization.module.css';

const B = ({ children }) => <b>{children}</b>;

// 단계: 번호 · 제목 · 한 줄 설명 · 핵심 2~3줄
const STEPS = {
  COIL: [
    { no: '1', title: '원자재 후보', desc: '슬리팅할 원코일 고르기', lines: [
      <>현재고 → 신규(매입이력 · 직접 입력) 순, <B>수율 높은 순</B>으로 추천합니다.</>,
      <>목록에 없는 폭은 직접 입력하고 <B>[후보 추가]</B>.</>] },
    { no: '2', title: '원자재 · 가공방식', desc: '얼마나, 몇 번에 나눠 자를지', lines: [
      <><B>원샷</B> 전량 한 번에 · <B>등분</B> 여러 차수로 · <B>일부가공</B> 일부만 자르고 나머지 보관</>,
      <><B>기본 로스</B>는 원코일 양쪽 끝에서 버리는 폭(mm)입니다.</>] },
    { no: '3', title: '추천조합', desc: '칼 배치 안 고르기', lines: [
      <><B>단독</B> 한 가지 폭 · <B>혼합</B> 여러 폭을 함께</>,
      <>주문 충족 → 부족 · 초과 + 로스 적은 안 → 수율 순으로 추천합니다.</>] },
  ],
  SHEET: [
    { no: '1', title: '원자재 후보', desc: '자를 원판 · 코일 고르기', lines: [
      <>품명 · 두께가 같은 재고와 과거 매입 규격을 <B>로스중량 적은 순</B>으로 추천합니다.</>,
      <>같은 규격은 한 줄로 묶입니다. 펼쳐서 <B>창고</B>를 고릅니다.</>] },
    { no: '2', title: '원자재 · 가공방식', desc: '여유 · 이론중량 기준', lines: [
      <><B>폭 여유</B> · <B>비중</B> · <B>도금상수</B>(기본 0)를 정합니다.</>,
      <>코일을 고르면 <B>원샷 / 일부</B>와 <B>길이 여유</B>를 정합니다.</>] },
    { no: '3', title: '추천조합', desc: '절단 안 고르기', lines: [
      <><B>단독절단</B> 품목마다 따로 · <B>혼합절단</B> 여러 규격을 섞어 원판 절약</>,
      <><B>A안</B> 기본 방향 · <B>B안</B> 90도 회전</>] },
  ],
};

// 저장 단계: 가공주문관리와 같은 상태 뱃지
const SAVE = [
  { tone: 'blue', label: '임시저장', desc: '중간 저장', lines: [<>품목 상태는 그대로, <B>[계획 불러오기]</B>에서 다시 엽니다.</>] },
  { tone: 'orange', label: '계획확정', desc: '원자재 예약', lines: [<>현재고 원자재가 이 계획에 예약됩니다. <B>[계획 취소]</B> 시 해제.</>] },
  { tone: 'green', label: '재고가공등록', desc: '실제 가공', lines: [<>계획이 채워진 전표가 열립니다. 저장하면 원자재 차감 · 제품 입고.</>] },
];

export default function OptimizationGuideModal({ opened, onClose, material }) {
  const [tab, setTab] = useState(null);
  const current = tab || (material === 'SHEET' ? 'SHEET' : 'COIL');
  useEffect(() => {
    if (!opened) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [opened, onClose]);
  if (!opened) return null;
  return createPortal(<div className={m.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={`${m.modal} ${m.guideModal}`} role="dialog" aria-modal="true" aria-label="가공 최적화 사용 안내">
      <header className={m.modalHeader}>
        <div><h2>가공 최적화 사용 안내</h2><p>주문 품목을 어떤 원자재로 어떻게 자를지 정해 재고가공등록으로 넘깁니다.</p></div>
        <button type="button" className={m.modalClose} aria-label="닫기" onClick={onClose}><IconX size={18} /></button>
      </header>
      <div className={m.modalBody}>
        <div className={m.guideFlow}>
          {['대기 품목', '① 원자재 후보', '② 가공방식', '③ 추천조합', '계획 확정', '재고가공등록'].map((step, i) => <span key={step}>{i > 0 && <i>›</i>} {step}</span>)}
        </div>

        <div className={m.guideSection}>
          <h3 className={`${m.guideSectionTitle} ${classes.guideTitleRow}`}>
            계산 단계
            <span className={classes.guideSwitch} role="tablist">
              {[['COIL', '코일 · 스켈프'], ['SHEET', '시트 · 판재']].map(([value, label]) => <button key={value} type="button" role="tab"
                aria-selected={current === value} className={current === value ? classes.guideSwitchOn : ''} onClick={() => setTab(value)}>{label}</button>)}
            </span>
          </h3>
          <p className={m.guideHint}>같은 창고 · 품명 · 두께 품목끼리 함께 계산합니다.</p>
          {STEPS[current].map((step) => <div key={step.no} className={m.guideItem}>
            <div className={m.guideHead}><span className={m.guideStep}>{step.no}</span>{step.title}<em>{step.desc}</em></div>
            <ul className={m.guideBox}>{step.lines.map((line, i) => <li key={i}>{line}</li>)}</ul>
          </div>)}
        </div>

        <div className={m.guideSection}>
          <h3 className={m.guideSectionTitle}>저장 · 확정</h3>
          <p className={m.guideHint}>결과의 투입 · 생산 · 로스 · 수율에서 <b>[계산 보기]</b>를 누르면 실제 숫자로 계산 과정을 볼 수 있습니다.</p>
          {SAVE.map((item) => <div key={item.label} className={m.guideItem}>
            <div className={m.guideHead}><span className={`${m.status} ${m[`status_${item.tone}`]}`}>{item.label}</span><span>{item.desc}</span></div>
            <ul className={m.guideBox}>{item.lines.map((line, i) => <li key={i}>{line}</li>)}</ul>
          </div>)}
        </div>
      </div>
      <footer className={m.modalFooter}><button type="button" className={`${m.btn} ${m.btnLine}`} onClick={onClose}>닫기</button></footer>
    </section>
  </div>, document.body);
}
