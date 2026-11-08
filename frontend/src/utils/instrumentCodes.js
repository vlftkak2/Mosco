// 수금/지급 수표·어음 선택값 (프로그램 고정값). DB에는 value(코드)를 저장하고 화면에는 label을 보여 줍니다.
// 발행구분·어음처리상태는 업무 로직(보유어음 불러오기, 배서 처리)이 코드로 판단하므로 사용자가 바꿀 수 없게 고정합니다.
// 백엔드 services/receiptpayment/ReceiptPayment.py 의 같은 목록과 함께 유지해야 합니다.

export const INSTRUMENT_TYPE_OPTIONS = [
  { value: 'RECEIVABLE', label: '외상매출채권' },
  { value: 'ELECTRONIC', label: '전자어음' },
  { value: 'PROMISSORY', label: '약속어음' },
  { value: 'CURRENT_CHECK', label: '당좌수표' },
  { value: 'HOUSEHOLD_CHECK', label: '가계수표' },
  { value: 'CASHIER_CHECK', label: '자기앞수표' },
  { value: 'OTHER', label: '기타' },
];

export const ISSUE_KIND_OPTIONS = [
  { value: 'OWN', label: '자수' },
  { value: 'OTHER', label: '타수' },
];

export const INSTRUMENT_STATUS_OPTIONS = [
  { value: 'HELD', label: '보관' },
  { value: 'ENDORSED', label: '배서' },
  { value: 'DISCOUNTED', label: '할인' },
  { value: 'SETTLED', label: '결제' },
  { value: 'DISHONORED', label: '부도' },
];

export const INSTRUMENT_OPTIONS_BY_FIELD = {
  instrumenttype: INSTRUMENT_TYPE_OPTIONS,
  issuekind: ISSUE_KIND_OPTIONS,
  instrumentstatus: INSTRUMENT_STATUS_OPTIONS,
};

/** Display label for a stored code (falls back to the stored text for older free-text values). */
export const instrumentLabel = (field, value) => {
  if (value === null || value === undefined || value === '') return '';
  return INSTRUMENT_OPTIONS_BY_FIELD[field]?.find((option) => option.value === value)?.label ?? String(value);
};
