// 가공 최적화 사용 안내 (공통 · 코일 · 시트 탭). 내용은 현재 계산 로직과 같게 유지할 것.
import { useState } from 'react';
import { Modal } from '@mantine/core';
import { IconBook2, IconX } from '@tabler/icons-react';
import classes from '../../styles/pages/AIOrderOptimization.module.css';

const FLOW = ['대기 품목', '① 원자재 후보', '② 원자재 · 가공방식', '③ 추천조합', '결과 · 계산 보기', '계획 확정', '재고가공등록'];

const COMMON = [
  { title: '대기 품목 담기', desc: '계획할 주문 품목을 고릅니다.', lines: [
    <>주문서 관리에서 보낸 품목이 <b>[대기 품목]</b>에 모입니다. 같은 <b>창고 · 소재 · 품명 · 두께</b>끼리 함께 담을 수 있습니다(시트는 폭까지 같아야 함).</>,
    <>선가공재고가 연결된 품목은 <b>필요 = 발주 − 선가공</b>만큼만 계산합니다.</>,
    <>이어서 작업하려면 <b>[계획 불러오기]</b>에서 임시저장한 계획을 엽니다.</>] },
  { title: '결과 · 계산 보기', desc: '숫자가 어떻게 나왔는지 확인합니다.', lines: [
    <>오른쪽 결과의 투입 · 생산 · 로스 · 수율 띠를 누르면 <b>계산 과정</b>이 실제 숫자로 나옵니다.</>,
    <>모든 중량은 이론중량이며, 실중량은 매출에서 조정합니다.</>] },
  { title: '저장 · 확정 · 가공등록', desc: '계획을 남기고 실제 가공으로 넘깁니다.', lines: [
    <><b>[임시저장]</b> 품목 상태는 그대로 두고, 언제든 다시 열어 수정합니다.</>,
    <><b>[계획 확정]</b> 품목은 계획확정, 현재고 원자재는 이 계획에 예약됩니다.</>,
    <><b>[재고가공등록으로 이동]</b> 계획이 채워진 가공전표가 열립니다. 저장하면 원자재가 차감되고 제품 재고가 생깁니다.</>,
    <><b>[계획 취소]</b> 품목은 대기로, 원자재 예약은 해제됩니다. <b>[돌려보내기]</b> 품목을 주문서 관리로 돌려 수정합니다.</>] },
];

const COIL = [
  { step: '1', title: '원자재 후보', desc: '슬리팅할 원코일을 고릅니다.', lines: [
    <>정렬: <b>연결 원자재 → 현재고 → 신규(매입이력 · 직접 입력)</b>, 같은 구분은 수율 높은 순.</>,
    <>다른 확정 계획이 쓰는 현재고는 <b>남은 중량</b>만 보입니다.</>] },
  { step: '2', title: '가공방식', desc: '얼마나, 몇 번에 나눠 자를지 정합니다.', lines: [
    <><b>원샷</b> 코일 전체를 한 번에 · <b>등분</b> 무게를 나눠 여러 차수로 · <b>일부가공</b> 일부만 자르고 나머지는 보관.</>,
    <><b>기본 로스</b>(mm)는 원코일 양쪽 끝에서 버리는 폭입니다. 현재고의 폭 · 중량은 바꿀 수 없습니다(회색 칸).</>] },
  { step: '3', title: '추천조합', desc: '칼 배치 안을 비교합니다.', lines: [
    <><b>단독</b> 한 번에 한 가지 폭 · <b>혼합</b> 여러 폭을 함께 배치.</>,
    <>추천 순서: 주문을 모두 채우는 안 → 부족 · 초과량 + 로스가 적은 안 → 수율 높은 안.</>,
    <>[과거 가공이력]에서 예전 칼 배치를 C안으로 반영할 수 있습니다.</>] },
  { step: '=', title: '계산식', desc: '재고가공등록과 같은 kg 정수로 나눕니다.', formula: [
    ['칼 1개 중량', '투입 × 제품 폭 ÷ 원코일 폭'],
    ['생산', '투입 × 사용폭 ÷ 원코일 폭 (사용폭 = Σ 제품 폭 × 칼수)'],
    ['로스', '투입 − 생산 (기본 로스 + 잔여폭 몫)'],
    ['수율', '생산 ÷ 투입 = 사용폭 ÷ 원코일 폭']] },
];

const SHEET = [
  { step: '1', title: '원자재 후보', desc: '자를 원판 또는 코일을 고릅니다.', lines: [
    <>발주와 <b>품명 · 두께가 같은</b> 현재고 원판 · 코일, 그리고 <b>과거 매입이력(입고 · 기초)</b> 규격이 신규로 자동 포함됩니다.</>,
    <>정렬: <b>연결 원자재 → 로스중량 적은 순</b>(현재고 · 신규 함께), 같으면 초과매수 적은 순 → 현재고 우선.</>,
    <>같은 규격은 창고가 달라도 <b>한 줄</b>(창고 · 수량은 계획 창고 기준). 펼치면 필요 매수 이상 재고가 있는 창고가 보이고, 줄을 눌러 계획 창고를 고릅니다.</>,
    <>계획은 창고 1곳에서, 그 창고의 같은 규격 로트를 <b>입고 순</b>으로 여러 개 씁니다. 재고가공등록에는 로트마다 원소재 1줄로 넘어갑니다.</>] },
  { step: '2', title: '원자재 · 가공방식', desc: '원판 규격과 여유를 정합니다.', lines: [
    <><b>폭 여유</b>는 원판(코일) 폭에서 양쪽 합으로 빼는 값, <b>비중 · 도금상수</b>는 이론중량에 씁니다(도금상수 기본 0).</>,
    <>코일을 고르면 <b>원샷(전량) / 일부</b>와 <b>길이 여유</b>(1장 절단 길이에 더함)를 정합니다.</>] },
  { step: '3', title: '추천조합', desc: '절단 안을 비교합니다.', lines: [
    <><b>A안</b> 제품 폭을 원판 폭 방향에 · <b>B안</b> 원판을 90도 돌려 원판 길이 방향에. 한 품목이라도 못 놓으면 그 방향은 배치 불가.</>,
    <><b>단독절단</b> 품목끼리 섞지 않고 품목마다 따로 계산해 합칩니다(혼합 시 절감 매수 안내).</>,
    <><b>혼합절단</b> 원판을 제품 폭 띠로 가르고 띠마다 여러 길이를 섞어 끊습니다. 남는 길이는 같은 그룹 제품으로 더 채웁니다(▲ 초과).</>,
    <><b>코일 길이 샤링</b> 코일 폭에 줄 수만큼 놓고 발주 순서대로 길이로 끊습니다. 남는 길이는 마지막 규격에 더합니다.</>] },
  { step: '=', title: '계산식', desc: '이론중량 기준입니다.', formula: [
    ['제품 이론중량', '폭 × 길이 × (두께 × 비중 + 도금상수) ÷ 1,000,000'],
    ['투입 (원판)', '원판 1장 중량 × 필요 원판 매수'],
    ['코일 단중', '코일 폭 × (두께 × 비중 + 도금상수) ÷ 1,000 (kg/m)'],
    ['줄 수', '⌊(코일 폭 − 폭 여유) ÷ 제품 폭⌋'],
    ['로스 · 수율', '투입 − 생산 · 생산 ÷ 투입 (초과 생산은 생산에 포함, 후보표 수율은 발주 기준)']] },
];

const TABS = [{ value: 'common', label: '공통 흐름', items: COMMON }, { value: 'coil', label: '코일 · 스켈프', items: COIL }, { value: 'sheet', label: '시트 · 판재', items: SHEET }];

export default function OptimizationGuideModal({ opened, onClose, material }) {
  const [tab, setTab] = useState(null);
  const current = tab || (material === 'SHEET' ? 'sheet' : 'common');
  const items = TABS.find((item) => item.value === current).items;
  return <Modal opened={opened} onClose={onClose} centered size={720} radius={16} padding={0} withCloseButton={false}
    overlayProps={{ backgroundOpacity: 0.25 }} classNames={{ body: `${classes.calcModalBody} ${classes.guideModal}` }}>
    <div className={classes.calcModalHead}>
      <span className={classes.calcModalIcon}><IconBook2 size={22} stroke={1.8} /></span>
      <div><h2>가공 최적화 사용 안내</h2><p>주문 품목을 어떤 원자재로 어떻게 자를지 계산하고, 계획을 확정해 재고가공등록으로 넘깁니다.</p></div>
      <button type="button" className={classes.calcClose} aria-label="닫기" onClick={onClose}><IconX size={18} /></button>
    </div>
    <div className={classes.guideFlowBar}>{FLOW.map((step, i) => <span key={step}>{i > 0 && <i>›</i>}{step}</span>)}</div>
    <div className={classes.guideTabs} role="tablist">{TABS.map((item) => <button key={item.value} type="button" role="tab" aria-selected={current === item.value}
      className={current === item.value ? classes.guideTabOn : ''} onClick={() => setTab(item.value)}>{item.label}</button>)}</div>
    <div className={classes.calcModalScroll}>
      <div className={classes.guideList}>{items.map((item, index) => <section key={item.title} className={classes.calcSection}>
        <div className={classes.calcHead}><span className={classes.calcStep}>{item.step || index + 1}</span><div><b>{item.title}</b><small>{item.desc}</small></div></div>
        {item.lines && <ul className={classes.guideLines}>{item.lines.map((line, i) => <li key={i}>{line}</li>)}</ul>}
        {item.formula && <table><tbody>{item.formula.map(([label, expr]) => <tr key={label}><th>{label}</th><td>{expr}</td></tr>)}</tbody></table>}
      </section>)}</div>
      {current === 'common' && <p className={classes.calcNote}>같은 창고 · 소재 · 품명 · 두께(시트는 폭까지) 품목만 함께 계산합니다. 다른 창고 품목은 [현재 작업 비우기] 후 따로 계획하세요.</p>}
    </div>
  </Modal>;
}
