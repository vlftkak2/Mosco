import { useEffect, useState } from 'react';
import axios from 'axios';
import { Loader, Modal } from '@mantine/core';
import classes from '../../styles/pages/StockCostHistoryModal.module.css';

// 현재고 > 행 더블클릭: 재고 원가 이력.
// - 원가 구성: 원 전표(매입 · 기초)부터 재고이전 · 가공을 거쳐 이 재고가 만들어지기까지
// - 출고 내역: 이 재고에서 매출 · 가공투입 · 이동출고로 빠진 원가 (저장 순서)
// 금액은 수불장에 기록된 값 그대로이고, 산식은 같은 규칙으로 다시 따라간 설명용 값이다.

const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });
const toNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};
const won = (value) => toNumber(value).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
const kg = (value) => toNumber(value).toLocaleString('ko-KR', { maximumFractionDigits: 3 });
const perKg = (amount, weight) => (toNumber(weight) > 0 ? (Math.round((toNumber(amount) / toNumber(weight)) * 100) / 100).toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-');
const day = (value) => String(value || '').slice(0, 10);
const docNo = (no, line) => (no ? `${no}-${line}` : '');
// 산식: 반올림 전 값과 기록 금액이 다를 때만 '→ 기록 금액'을 붙인다
const rounded = (raw, amount) => (toNumber(raw) === toNumber(amount) ? won(amount) : `${won(raw)} → ${won(amount)}`);

// 원가 구성 한 단계의 설명 문구
function originDetail(entry) {
  if (entry.is_out) {
    return entry.takes_all
      ? `직전 재고 ${kg(entry.before_weight)}kg 전부 → 직전 재고금액 ${won(entry.before_cost)}원 전부`
      : `직전 재고금액 ${won(entry.before_cost)} × ${kg(entry.weight)}kg ÷ ${kg(entry.before_weight)}kg = ${rounded(entry.raw_cost, entry.costamt)}원`;
  }
  const note = entry.note || {};
  if (note.basis === 'inbound') {
    const base = `매입가액 ${won(note.supplyamt)}`;
    return toNumber(note.expense_total) > 0
      ? `${base} + 매입부대비 ${won(entry.expamt)}  (매입 기타비용 ${won(note.expense_total)} × ${kg(note.line_weight)}kg ÷ ${kg(note.doc_weight)}kg)`
      : `${base}  (매입 기타비용 없음)`;
  }
  if (note.basis === 'opening') return `기초재고 공급가 ${won(note.supplyamt)}`;
  if (note.basis === 'transfer') return `이동출고 원가를 그대로 입고  (매입가액 ${won(entry.realamt)} · 매입부대비 ${won(entry.expamt)}${toNumber(entry.feeamt) ? ` · 가공비 ${won(entry.feeamt)}` : ''})`;
  if (note.basis === 'process') {
    const share = note.product_count > 1 ? `  (투입원가 ${won(note.input_cost)} × ${kg(note.product_weight)}kg ÷ 가공품 합계 ${kg(note.leaf_weight)}kg)` : '';
    return `원재료 ${won(note.material)} + 가공비 ${won(note.process_fee)}${note.process_name ? ` (${note.process_name})` : ''}${share}`;
  }
  return '';
}

export default function StockCostHistoryModal({ lot, onClose }) {
  const [state, setState] = useState({ key: '', data: null, error: '' });
  const key = lot ? `${lot.sourcetype}:${lot.sourceno}:${lot.sourceline}` : '';

  useEffect(() => {
    if (!lot) return undefined;
    let cancelled = false;
    axios.get('/api/current-stock/lots/cost-history', { ...authConfig(), params: lot })
      .then(({ data }) => {
        if (cancelled) return;
        // 서버가 예전 버전이거나 응답이 비정상이면 화면이 멈추지 않게 오류로 보여 준다
        if (!data || typeof data !== 'object' || !data.summary || !data.lot || !Array.isArray(data.origin)) {
          setState({ key, data: null, error: '원가 이력 응답을 읽지 못했습니다. 서버가 최신 버전인지 확인한 뒤 다시 열어 주세요.' });
          return;
        }
        setState({ key, data, error: '' });
      })
      .catch((error) => { if (!cancelled) setState({ key, data: null, error: error.response?.data?.detail || '원가 이력을 불러오지 못했습니다.' }); });
    return () => { cancelled = true; };
  }, [lot, key]);

  // 창이 닫혀 있으면(lot 없음) 아무것도 읽지 않는다
  const ready = Boolean(lot) && state.key === key && (Boolean(state.data) || Boolean(state.error));
  const data = ready ? state.data : null;
  const info = data?.lot;
  const summary = data?.summary;
  const steps = data?.steps || [];

  return <Modal opened={Boolean(lot)} onClose={onClose} centered size="min(1200px, calc(100vw - 32px))" padding={0} withCloseButton={false}
    styles={{ content: { borderRadius: 6, overflow: 'hidden' }, body: { padding: 0 } }}>
    <div className={classes.wrap}>
      <header className={classes.head}>
        <div className={classes.headText}>
          <h2 className={classes.title}>재고 원가 이력</h2>
          {info && <p className={classes.subtitle}>
            <b>{info.itemname}</b>
            {info.productname && <span>{info.productname}</span>}
            <span>{info.warehousecodename}</span>
            <span>{info.kindname} 재고</span>
            <span className={classes.mono}>{docNo(info.sourceno, info.sourceline)}</span>
          </p>}
        </div>
        <button type="button" className={classes.closeButton} onClick={onClose}>닫기</button>
      </header>

      {!ready ? <div className={classes.message}><Loader color="red" size="sm" />불러오는 중</div>
        : (state.error || !data) ? <div className={classes.message}>{state.error || '원가 이력이 없습니다.'}</div>
          : <div className={classes.body}>
            <section className={classes.summary}>
              <div className={classes.metric}><span>입고원가</span><b>{won(summary.in_cost)}<small>원</small></b><em>{kg(summary.in_weight)} kg</em></div>
              <div className={classes.metric}><span>출고원가</span><b>{won(summary.out_cost)}<small>원</small></b><em>{kg(summary.out_weight)} kg</em></div>
              <div className={`${classes.metric} ${classes.metricMain}`}><span>재고금액</span><b>{won(summary.stock_cost)}<small>원</small></b><em>{kg(summary.stock_weight)} kg</em></div>
              <div className={classes.metric}><span>kg당 원가</span><b>{perKg(summary.stock_cost, summary.stock_weight)}<small>원</small></b>
                <em className={summary.balanced ? classes.checkOk : classes.checkBad}>{summary.balanced ? '원가 검증 정상 (입고 = 출고 + 재고)' : '원가 합계 불일치 — 확인 필요'}</em></div>
            </section>

            <section className={classes.section}>
              <div className={classes.sectionHead}>
                <h3>원가 구성</h3>
                <p>원 전표부터 이 재고가 만들어지기까지 원가가 어떻게 정해졌는지 보여줍니다.</p>
              </div>
              <ol className={classes.timeline}>
                {data.origin.map((entry) => <li key={`${entry.is_out ? 'out' : 'lot'}:${entry.receiptno}:${entry.lineno}`}
                  className={`${classes.step} ${entry.is_out ? classes.stepOut : ''} ${entry.is_this ? classes.stepThis : ''}`}>
                  <div className={classes.stepMain}>
                    <span className={classes.stepDate}>{day(entry.iniodate)}</span>
                    <span className={classes.stepKind}>{entry.kindname}</span>
                    <span className={classes.stepDoc}>
                      <span className={classes.mono}>{docNo(entry.receiptno, entry.lineno)}</span>
                      {entry.customname && <span>{entry.customname}</span>}
                      {entry.is_this && <span className={classes.thisTag}>현재 재고</span>}
                    </span>
                    <span className={classes.stepWeight}>{entry.is_out ? '−' : ''}{kg(entry.weight)} kg</span>
                    <span className={classes.stepAmount}>{entry.is_out ? '−' : ''}{won(entry.costamt)}<small>원</small></span>
                  </div>
                  <div className={classes.stepDetail}>{originDetail(entry)}</div>
                </li>)}
              </ol>
            </section>

            <section className={classes.section}>
              <div className={classes.sectionHead}>
                <h3>출고 내역</h3>
                <p>출고원가 = 직전 재고금액 × 출고중량 ÷ 직전 재고중량 (원 단위 반올림, 잔량을 모두 출고하면 남은 금액 전부)</p>
              </div>
              {steps.length ? <div className={classes.tableBox}>
                <table className={classes.table}>
                  <colgroup>
                    <col style={{ width: 86 }} /><col style={{ width: 64 }} /><col style={{ width: 156 }} /><col style={{ width: 92 }} />
                    <col style={{ width: 64 }} /><col /><col style={{ width: 86 }} /><col style={{ width: 80 }} /><col style={{ width: 76 }} />
                    <col style={{ width: 56 }} /><col style={{ width: 80 }} /><col style={{ width: 64 }} />
                  </colgroup>
                  <thead><tr>
                    <th>일자</th><th>구분</th><th>전표번호</th><th>거래처</th><th className={classes.r}>출고중량</th><th>산식</th>
                    <th className={classes.r}>출고원가</th><th className={classes.r}>매입가액</th><th className={classes.r}>매입부대비</th>
                    <th className={classes.r}>가공비</th><th className={classes.r}>재고금액</th><th className={classes.r}>재고중량</th>
                  </tr></thead>
                  <tbody>{steps.map((step) => <tr key={`${step.receiptno}:${step.lineno}`}>
                    <td>{day(step.iniodate)}</td>
                    <td>{step.kindname}</td>
                    <td className={classes.mono}>{docNo(step.receiptno, step.lineno)}</td>
                    <td className={classes.ellipsis} title={step.customname || ''}>{step.customname || ''}</td>
                    <td className={classes.r}>{kg(step.weight)}</td>
                    <td className={classes.formula} title={step.matches ? undefined : '전표 수정 순서 등으로 다시 계산한 값과 기록 금액이 다릅니다. 기록 금액이 기준입니다.'}>
                      {step.takes_all ? `잔량 전부 → ${won(step.before_cost)}` : `${won(step.before_cost)} × ${kg(step.weight)} ÷ ${kg(step.before_weight)} = ${won(step.raw_cost)}`}
                      {!step.matches && <span className={classes.warnText}> · 기록 금액 기준</span>}
                    </td>
                    <td className={`${classes.r} ${classes.strong}`}>{won(step.costamt)}</td>
                    <td className={classes.r}>{won(step.realamt)}</td>
                    <td className={classes.r}>{won(step.expamt)}</td>
                    <td className={classes.r}>{won(step.feeamt)}</td>
                    <td className={classes.r}>{won(step.after_cost)}</td>
                    <td className={classes.r}>{kg(step.after_weight)}</td>
                  </tr>)}</tbody>
                </table>
              </div> : <div className={classes.empty}>아직 출고된 내역이 없습니다.</div>}
            </section>
          </div>}
    </div>
  </Modal>;
}
