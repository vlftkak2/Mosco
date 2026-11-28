// Intl.DateTimeFormat 은 만들 때 비용이 크다 (표의 칸마다 새로 만들면 화면 그리기가 눈에 띄게 느려진다).
// 같은 언어 · 옵션이면 한 번 만든 것을 다시 쓴다. 사용법은 new Intl.DateTimeFormat(locale, options) 과 같다.
const cache = new Map();

export function cachedDateFormat(locale, options = {}) {
  const key = `${locale}|${JSON.stringify(options)}`;
  let formatter = cache.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    cache.set(key, formatter);
  }
  return formatter;
}

// ── 한국 시간(KST) 기준 날짜 ─────────────────────────────────────
// 브라우저 시간대가 한국이 아니어도(해외 출장 · 시간대 설정이 다른 PC) 기본 조회기간 · 오늘 날짜가 서버(KST)와 같게.
const KST_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
const pad2 = (value) => String(value).padStart(2, '0');

/** 한국 시간 오늘 'YYYY-MM-DD' */
export function todayKST() {
  return KST_DATE.format(new Date());
}

/**
 * 한국 시간 오늘 날짜를 이 브라우저의 Date 로 (자정 기준).
 * getFullYear / getMonth / getDate 가 한국 날짜를 돌려주므로, 기존 `new Date()` 로 날짜를 계산하던 곳에 그대로 바꿔 쓸 수 있다.
 */
export function kstDate() {
  const [year, month, day] = todayKST().split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** 한국 시간 이번 달 1일 'YYYY-MM-01' */
export function monthStartKST() {
  return `${todayKST().slice(0, 8)}01`;
}

/** 한국 시간 이번 달 말일 'YYYY-MM-DD' */
export function monthEndKST() {
  const [year, month] = todayKST().split('-').map(Number);
  return `${year}-${pad2(month)}-${pad2(new Date(year, month, 0).getDate())}`;
}

/** 한국 시간 올해 (숫자) */
export function yearKST() {
  return Number(todayKST().slice(0, 4));
}
