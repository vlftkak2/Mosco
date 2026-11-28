// 기준정보 목록(코드 그룹 · 사용 중 거래처 등) 메모리 캐시.
// 화면을 열 때 지난번 값으로 바로 채우고(peekMaster), 서버에서 새로 받은 값으로 곧바로 바꾼다(loadMaster).
// - 로그인 토큰(= 사용자 · 회사)마다 따로 보관 → 다른 회사 값이 섞이지 않는다.
// - 같은 목록을 여러 화면이 동시에 요청하면 요청 하나를 같이 쓴다.
// - 메모리에만 두므로 새로고침하면 비워진다. 저장할 때 검증은 서버가 다시 하므로 잠깐 지난 값이어도 정합성에는 영향 없음.
const store = new Map();
const scope = () => localStorage.getItem('access_token') || '';
const fullKey = (key) => `${scope()}::${key}`;

export function peekMaster(key) {
  return store.get(fullKey(key))?.value;
}

export function loadMaster(key, loader) {
  const k = fullKey(key);
  const entry = store.get(k) || {};
  if (entry.promise) return entry.promise;
  const promise = Promise.resolve().then(loader).then((value) => {
    store.set(k, { value });
    return value;
  }, (error) => {
    store.set(k, { value: entry.value });
    throw error;
  });
  store.set(k, { value: entry.value, promise });
  return promise;
}

// 기준정보를 저장한 뒤 부른다: 지난 값으로 미리 채우지 않게 비운다 (prefix 를 주면 그 이름으로 시작하는 것만).
// 이미 열려 있는 화면은 탭으로 돌아올 때 서버에서 새로 받는다 (캐시가 생기기 전과 같음).
export function invalidateMaster(prefix = '') {
  const start = fullKey(prefix);
  [...store.keys()].forEach((key) => { if (key.startsWith(start)) store.delete(key); });
}

// 쪽으로 나뉜 목록 전체: 첫 쪽에서 전체 건수를 보고 나머지 쪽은 한꺼번에(병렬) 받는다
export async function fetchAllPages(fetchPage, pageSize, maxPages = 100) {
  const first = await fetchPage(1);
  const total = Number(first.total) || 0;
  const pageCount = Math.min(maxPages, Math.max(1, Math.ceil(total / pageSize)));
  if (pageCount <= 1) return first.items;
  const rest = await Promise.all(Array.from({ length: pageCount - 1 }, (_, index) => fetchPage(index + 2)));
  return [...first.items, ...rest.flatMap((page) => page.items)];
}
