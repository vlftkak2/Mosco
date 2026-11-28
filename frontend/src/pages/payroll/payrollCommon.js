// 급여관리 공통: 항목 이름 · 숫자 형식 · 급여명세서 인쇄 (급여입력 · 급여대장 · 내 급여현황이 같이 쓴다)
// 항목 칸은 backend/services/payroll/Payroll.py 의 PAY_FIELDS · DED_FIELDS 와 같다.

export const PAY_ITEMS = [
  { key: 'pay_base', label: '기본급' },
  { key: 'pay_position', label: '직책수당' },
  { key: 'pay_duty', label: '업무분담수당' },
  { key: 'pay_overtime', label: '연장근무수당' },
  { key: 'pay_bonus', label: '상여' },
  { key: 'pay_leave', label: '연차수당' },
  { key: 'pay_etc', label: '기타지급', signed: true },
  { key: 'pay_meal', label: '식대', nontax: true },
  { key: 'pay_car', label: '자가운전보조금', nontax: true },
  { key: 'pay_childcare', label: '보육수당', nontax: true },
  { key: 'pay_research', label: '연구수당', nontax: true, hint: '연구원 비과세 20만' },
];
export const DED_ITEMS = [
  { key: 'ded_pension', label: '국민연금' },
  { key: 'ded_health', label: '건강보험' },
  { key: 'ded_care', label: '장기요양보험' },
  { key: 'ded_employ', label: '고용보험' },
  { key: 'ded_income', label: '소득세' },
  { key: 'ded_local', label: '지방소득세' },
  { key: 'ded_etc', label: '기타공제', signed: true },
];
export const WORKTYPE_LABELS = { REGULAR: '정규직', CONTRACT: '계약직' };

export const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });
export const won = (value) => Number(value || 0).toLocaleString('ko-KR');
export const sumOf = (slip, items) => items.reduce((sum, item) => sum + (Number(slip?.[item.key]) || 0), 0);
// 생년월일 → YYMMDD (급여대장 · 목록 표시)
export const yymmdd = (value) => (value ? String(value).slice(2, 10).replaceAll('-', '') : '');
export const ymLabel = (payym) => (payym ? `${payym.slice(0, 4)}년 ${Number(payym.slice(5, 7))}월` : '');

// 오늘(한국 시간) 기준 이번 달 · 기본 지급일(그달 25일)
export const kstToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
export const defaultPaydate = (payym) => `${payym}-25`;

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

// 급여명세서(임금명세서) 인쇄: 새 창에 그려서 인쇄 대화상자를 연다.
// 법정 기재사항: 성명 · 생년월일(사원번호) · 지급일 · 임금총액 · 항목별 금액 · 공제 내역 · 계산방법(적요)
export function printPayslip(slip, companyName = '') {
  const payRows = PAY_ITEMS.filter((item) => Number(slip[item.key] || 0) !== 0);
  const dedRows = DED_ITEMS.filter((item) => Number(slip[item.key] || 0) !== 0);
  const lines = Math.max(payRows.length, dedRows.length, 1);
  const body = Array.from({ length: lines }, (_, i) => {
    const p = payRows[i];
    const d = dedRows[i];
    return `<tr><td>${p ? esc(p.label) + (p.nontax ? ' <small>(비과세 한도 20만원)</small>' : '') : ''}</td><td class="n">${p ? won(slip[p.key]) : ''}</td>
      <td>${d ? esc(d.label) : ''}</td><td class="n">${d ? won(slip[d.key]) : ''}</td></tr>`;
  }).join('');
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>급여명세서 ${esc(slip.payym)} ${esc(slip.username)}</title>
<style>
  body{font-family:'Pretendard','Malgun Gothic',sans-serif;color:#222;margin:32px;font-size:13px}
  h1{font-size:20px;text-align:center;margin:0 0 4px} .sub{text-align:center;color:#666;margin-bottom:18px}
  table{width:100%;border-collapse:collapse;margin-bottom:12px} th,td{border:1px solid #bbb;padding:7px 9px}
  th{background:#f3f4f6;font-weight:600} .n{text-align:right;font-variant-numeric:tabular-nums} small{color:#888}
  .info td:nth-child(odd){background:#f3f4f6;font-weight:600;width:14%} .sum td{font-weight:700;background:#fafafa}
  .net{font-size:16px;text-align:right;margin:14px 0} .net b{font-size:20px} .note{color:#555;font-size:12px;line-height:1.6}
</style></head><body>
<h1>${esc(ymLabel(slip.payym))} 급여명세서</h1>
<div class="sub">${esc(companyName || slip.companyname || '')}</div>
<table class="info"><tr><td>성명</td><td>${esc(slip.username)}</td><td>사원번호</td><td>${esc(slip.empno)}</td><td>생년월일</td><td>${esc(slip.birthdate || '')}</td></tr>
<tr><td>부서</td><td>${esc(slip.team)}</td><td>직급</td><td>${esc(slip.position)}</td><td>지급일</td><td>${esc(slip.paydate)}</td></tr></table>
<table><thead><tr><th>지급항목</th><th>금액</th><th>공제항목</th><th>금액</th></tr></thead><tbody>${body}</tbody>
<tfoot><tr class="sum"><td>지급 합계</td><td class="n">${won(slip.pay_total)}</td><td>공제 합계</td><td class="n">${won(slip.ded_total)}</td></tr></tfoot></table>
<div class="net">실지급액 <b>${won(slip.net_pay)}</b> 원</div>
<div class="note">계산방법: ${esc(slip.remark || '-')}<br>
국민연금 · 건강보험은 기본급 ${won(slip.pay_base)}원 기준, 고용보험 · 소득세는 과세 지급액 ${won(slip.taxable)}원 기준 (식대 · 자가운전보조금 · 보육수당 · 연구수당은 각 월 20만원까지 비과세).<br>
소득세는 근로소득 간이세액표(공제대상가족 ${esc(slip.family_cnt)}명 · 자녀 ${esc(slip.child_cnt)}명 · ${esc(slip.tax_rate)}%) 기준이며, 지방소득세는 소득세의 10%입니다.</div>
<script>window.onload=function(){window.print();}</script>
</body></html>`;
  const win = window.open('', '_blank', 'width=820,height=900');
  if (!win) return false;
  win.document.open();
  win.document.write(html);
  win.document.close();
  return true;
}
