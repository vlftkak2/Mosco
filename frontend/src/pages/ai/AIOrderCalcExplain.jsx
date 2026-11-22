// 가공 최적화: 투입 · 생산 · 로스 · 수율이 어떻게 나왔는지 실제 숫자로 풀어 보여 준다 (표시 전용 · 계산 로직 없음)
// ④ 결과 띠의 [계산 보기] → 모달
import { useState } from 'react';
import { Modal } from '@mantine/core';
import { IconCalculator, IconX } from '@tabler/icons-react';
import classes from '../../styles/pages/AIOrderOptimization.module.css';

const RHO = 7.85 / 1e6;
// 모달 위 '투입 = 생산 + 로스' 막대용 숫자 (코일은 kg 정수 배부가 있으면 그 값)
function withTotals(sections, plan, coil) {
  const hasInt = plan.int_production !== undefined && plan.int_production !== null;
  const input = Number(hasInt && plan.int_input != null ? plan.int_input : plan.input_weight) || 0;
  const production = Number(hasInt ? plan.int_production : plan.production_weight) || 0;
  sections.totals = { input, production, loss: Number(hasInt ? plan.int_loss : plan.loss_weight) || 0,
    yieldRate: hasInt && input > 0 ? (production / input) * 100 : Number(plan.yield_rate) || 0 };
  return sections;
}
const n = (value, digits = 1) => (value === null || value === undefined || Number.isNaN(Number(value)) ? '–'
  : Number(value).toLocaleString('ko-KR', { maximumFractionDigits: digits }));

// 코일 계획 (원샷 · 일부가공 · 등분)
export function coilCalcSections(plan) {
  const sections = withTotals(coilSections(plan), plan, true);
  sections.coil = true;   // 코일 슬리팅 모달: 하단 이론중량 안내 문구 없음
  return sections;
}
function coilSections(plan) {
  const runs = (plan.runs || []).filter((run) => (run.weight || 0) > 0);
  const rawWidth = (plan.used_width || 0) + (plan.remain_width || 0);
  const trim = plan.trim_width ?? 0;
  const spare = Math.max(0, (plan.remain_width || 0) - trim);
  const hasInt = runs.length > 0 && runs.every((run) => run.alloc);
  const multi = runs.length > 1;
  const pieces = (plan.pieces || []).filter((piece) => (piece.knives ?? piece.cuts) > 0);
  return [
    { title: '투입', value: `${n(plan.input_weight)}kg`, rows: multi
      ? runs.map((run, i) => [`${i + 1}차`, '차수 투입중량', `${n(run.weight)}kg`]).concat([['합계', runs.map((run) => n(run.weight)).join(' + '), `${n(plan.input_weight)}kg`]])
      : [['가공중량', runs[0]?.label === '원샷' ? '원샷 = 코일 전체를 한 번에 슬리팅' : '② 에서 정한 가공중량', `${n(plan.input_weight)}kg`]] },
    { title: '칼수 · 사용폭', value: `${n(plan.used_width)}mm`, rows: [
      ...pieces.map((piece) => [`${n(piece.width)}mm`, `${n(piece.width)} × ${piece.knives ?? piece.cuts}칼`, `${n(piece.width * (piece.knives ?? piece.cuts))}mm`]),
      ['사용폭', '칼 폭 합계', `${n(plan.used_width)}mm`],
      ['남는 폭', `원코일 ${n(rawWidth)} − 사용폭 ${n(plan.used_width)} = 기본 로스 ${n(trim)} + 잔여 ${n(spare)}`, `${n(plan.remain_width)}mm`]] },
    { title: '생산', value: `${n(hasInt ? plan.int_production : plan.production_weight, hasInt ? 0 : 1)}kg`, rows: [
      ...pieces.map((piece) => [`${n(piece.width)}mm 칼당`, `투입 × ${n(piece.width)} ÷ 원코일 ${n(rawWidth)}`, `${n(piece.per_cut ?? (plan.input_weight * piece.width) / rawWidth)}kg`]),
      ['이론 생산', `투입 ${n(plan.input_weight)} × 사용폭 ${n(plan.used_width)} ÷ ${n(rawWidth)}`, `${n(plan.production_weight)}kg`],
      ...(hasInt ? [['kg 정수 배부', <>칼마다 kg 정수로 나눔 (같은 폭에서 남는 kg는 첫 줄)<br /><span className={classes.calcExprSub}>재고가공등록과 같은 값</span></>, `${n(plan.int_production, 0)}kg`]] : [])] },
    { title: '로스', value: `${n(hasInt ? plan.int_loss : plan.loss_weight, hasInt ? 0 : 1)}kg`, rows: [
      ['로스', `투입 ${n(plan.input_weight)} − 생산 ${n(hasInt ? plan.int_production : plan.production_weight, hasInt ? 0 : 1)}`, `${n(hasInt ? plan.int_loss : plan.loss_weight, hasInt ? 0 : 1)}kg`],
      ['= 남는 폭 몫', `투입 × 남는 폭 ${n(plan.remain_width)} ÷ ${n(rawWidth)}`, `${n((plan.input_weight * (plan.remain_width || 0)) / (rawWidth || 1))}kg`]] },
    { title: '수율', value: `${n(plan.yield_rate, 2)}%`, rows: [
      ['수율', `생산 ÷ 투입 = 사용폭 ${n(plan.used_width)} ÷ 원코일 ${n(rawWidth)}`, `${n(plan.yield_rate, 2)}%`]] },
  ];
}

// 시트 계획 (원판 × 매수 · 2단 절단)
export function sheetCalcSections(plan) {
  return withTotals(sheetSections(plan), plan, false);
}
function sheetSections(plan) {
  const W = Number(plan.sheet_w) || 0;
  const L = Number(plan.sheet_l) || 0;
  const sheetKg = plan.sheets ? plan.input_weight / plan.sheets : 0;
  // 계수 = 두께 × 비중 + 도금상수 (계획 값). 예전 계획은 계수가 없어 투입중량에서 두께를 역산 (× 7.85)
  const hasFactor = Number(plan.factor) > 0;
  const t = hasFactor ? Number(plan.thickness) || 0 : (W && L ? sheetKg / (W * L * RHO) : 0);
  const factor = hasFactor ? Number(plan.factor) : t * 7.85;
  const unit = (piece) => (piece.width * piece.length * factor) / 1e6;
  const made = (plan.pieces || []).filter((piece) => piece.produced_qty > 0);
  const factorText = hasFactor ? `(${n(t, 3)}T × ${n(plan.sg, 3)} + ${n(plan.coat, 3)})` : `${n(t, 3)}T × 7.85`;
  return [
    { title: '투입', value: `${n(plan.input_weight, 2)}kg`, rows: [
      ['원판 1장', `${n(W)} × ${n(L)} × ${factorText} ÷ 1,000,000`, `${n(sheetKg, 2)}kg`],
      ['투입', `원판 ${n(plan.sheets, 0)}매 × ${n(sheetKg, 2)}kg`, `${n(plan.input_weight, 2)}kg`]] },
    { title: '생산', value: `${n(plan.production_weight, 2)}kg`, rows: [
      ...made.map((piece) => [`${n(piece.width)} × ${n(piece.length)}`, `${n(piece.produced_qty, 0)}매 × ${n(unit(piece), 3)}kg${piece.over_qty > 0 ? ` (초과 ${n(piece.over_qty, 0)}매 포함)` : ''}`, `${n(piece.produced_qty * unit(piece), 2)}kg`]),
      ['생산', '제품 이론중량 합계 (초과 생산도 생산에 포함)', `${n(plan.production_weight, 2)}kg`],
      ...(plan.int_production != null && Math.abs(plan.int_production - plan.production_weight) > 0.01 ? [['kg 정수 배부', <>품목별 이론중량을 kg 정수로<br /><span className={classes.calcExprSub}>재고가공등록과 같은 값</span></>, `${n(plan.int_production, 0)}kg`]] : [])] },
    { title: '로스', value: `${n(plan.loss_weight, 2)}kg`, rows: [
      ['로스', `투입 ${n(plan.input_weight, 2)} − 생산 ${n(plan.production_weight, 2)}`, `${n(plan.loss_weight, 2)}kg`],
      ...(plan.int_production != null ? [['로스 (정수 배부)', `실제 투입 ${n(plan.int_input, 3)} − 생산 ${n(plan.int_production, 0)} (실제 로트 재고 중량 기준)`, `${n(plan.int_loss, 3)}kg`]] : []),
      ['', '= 원판에서 제품을 놓고 남는 부분 (④ 그림의 빗금)', '']] },
    { title: '수율', value: `${n(plan.yield_rate, 2)}%`, rows: [
      ['수율', `생산 ${n(plan.production_weight, 2)} ÷ 투입 ${n(plan.input_weight, 2)}`, `${n(plan.yield_rate, 2)}%`]] },
  ];
}

const STEP_HINT = {
  투입: '원자재에서 가공에 넣는 중량',
  '칼수 · 사용폭': '코일 폭 안에 칼을 몇 개 넣었는지',
  생산: '잘라서 나온 제품 중량',
  로스: '버려지는 부분 (투입 − 생산)',
  수율: '투입 중 제품이 된 비율',
};

const STEP_TONE = { 투입: 'toneInput', '칼수 · 사용폭': 'toneWidth', 생산: 'toneProd', 로스: 'toneLoss', 수율: 'toneYield' };

function Balance({ totals }) {
  if (!totals || !totals.input) return null;
  const prodPct = Math.max(0, Math.min(100, (totals.production / totals.input) * 100));
  const lossPct = Math.max(0, 100 - prodPct);
  return <div className={classes.calcBalance}>
    <div className={classes.calcBalanceHead}><b>투입 {n(totals.input)}kg</b><span>= 생산 {n(totals.production)}kg + 로스 {n(totals.loss)}kg</span></div>
    <div className={classes.calcBalanceBar} role="img" aria-label={`생산 ${n(prodPct, 2)}%, 로스 ${n(lossPct, 2)}%`}>
      <span className={classes.calcBalanceProd} style={{ width: `${prodPct}%` }}>{prodPct >= 12 ? `생산 ${n(prodPct, 2)}%` : ''}</span>
      {lossPct > 0.0001 && <span className={classes.calcBalanceLoss} style={{ width: `${lossPct}%` }} title={`로스 ${n(lossPct, 2)}%`}>{lossPct >= 12 ? `로스 ${n(lossPct, 2)}%` : ''}</span>}
    </div>
    <div className={classes.calcBalanceLegend}><span><i className={classes.calcBalanceProd} />생산 (수율 {n(totals.yieldRate, 2)}%)</span><span><i className={classes.calcBalanceLoss} />로스 {n(lossPct, 2)}%</span></div>
  </div>;
}

function CalcBody({ sections }) {
  const summary = sections.filter((section) => ['투입', '생산', '로스', '수율'].includes(section.title));
  return <div className={classes.calcBody}>
    <div className={classes.calcSummary}>{summary.map((section) => <div key={section.title} className={`${classes[STEP_TONE[section.title]] || ''} ${section.title === '수율' ? classes.calcSumAccent : ''}`}>
      <small>{section.title}</small><b>{section.value}</b></div>)}</div>
    <Balance totals={sections.totals} />
    {sections.map((section, index) => <section key={section.title} className={`${classes.calcSection} ${classes[STEP_TONE[section.title]] || ''}`}>
      <div className={classes.calcHead}>
        <span className={classes.calcStep}>{index + 1}</span>
        <div><b>{section.title}</b><small>{STEP_HINT[section.title] || ''}</small></div>
        <strong>{section.value}</strong>
      </div>
      <table><tbody>{section.rows.map(([label, expr, value], i) => <tr key={i} className={i === section.rows.length - 1 && section.rows.length > 1 ? classes.calcTotal : ''}>
        <th>{label}</th><td>{expr ? <code className={classes.calcExpr}>{expr}</code> : null}</td><td>{value}</td></tr>)}</tbody></table>
    </section>)}
    {!sections.coil && <p className={classes.calcNote}>이론중량 = 폭 × 길이 × 두께 × 7.85 ÷ 1,000,000. 실중량은 매출에서 조정합니다.</p>}
  </div>;
}

// ④ 결과 띠를 감싼다: 띠 또는 [계산 보기]를 누르면 계산 과정 모달
export function CalcPopover({ sections, title = '계산 과정', subtitle = '', children }) {
  const [open, setOpen] = useState(false);
  if (!sections) return children;
  return <>
    <div className={classes.calcTarget} role="button" tabIndex={0} title="계산 과정 보기" onClick={() => setOpen(true)}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setOpen(true); } }}>
      {children}<span className={classes.calcHint}><IconCalculator size={12} stroke={2} />계산 보기</span>
    </div>
    <Modal opened={open} onClose={() => setOpen(false)} centered size={640} radius={16} padding={0} withCloseButton={false}
      overlayProps={{ backgroundOpacity: 0.25 }} classNames={{ body: classes.calcModalBody }}>
      <div className={classes.calcModalHead}>
        <span className={classes.calcModalIcon}><IconCalculator size={22} stroke={1.8} /></span>
        <div><h2>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div>
        <button type="button" className={classes.calcClose} aria-label="닫기" onClick={() => setOpen(false)}><IconX size={18} /></button>
      </div>
      <div className={classes.calcModalScroll}><CalcBody sections={sections} /></div>
    </Modal>
  </>;
}
