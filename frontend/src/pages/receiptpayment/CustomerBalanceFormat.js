// 채권채무요약 화면 · 차트가 같이 쓰는 숫자 표시와 색 (화면과 차트 파일이 같은 규칙을 쓰도록 한 곳에)
export const COLOR = { recv: '#2a78d6', pay: '#eb6834', sales: '#2a78d6', receipt: '#1baf7a', purchase: '#eb6834', payment: '#eda100' };

export const toNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};
export const won = (value) => `${Math.round(toNumber(value)).toLocaleString('ko-KR')}원`;
export const compact = (value) => {
  const number = toNumber(value);
  const abs = Math.abs(number);
  if (abs >= 100000000) return `${(number / 100000000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}억`;
  if (abs >= 10000) return `${Math.round(number / 10000).toLocaleString('ko-KR')}만`;
  return Math.round(number).toLocaleString('ko-KR');
};
export const pct = (value, digits = 1) => `${toNumber(value).toLocaleString('ko-KR', { maximumFractionDigits: digits })}%`;
export const shortName = (name, max = 9) => (String(name || '').length > max ? `${String(name).slice(0, max)}…` : String(name || ''));
export const monthLabel = (month) => `${month.slice(2, 4)}.${month.slice(5)}`;
