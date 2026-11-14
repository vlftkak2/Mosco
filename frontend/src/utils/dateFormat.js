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
