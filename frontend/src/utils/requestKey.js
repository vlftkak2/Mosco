import { useEffect, useMemo, useRef } from 'react';

// 중복 저장 막기 키 (서버 request_key): 새 전표 하나에 키 하나.
// 같은 새 전표를 다시 저장하면(두 번 누름 · 응답이 늦어 다시 시도) 같은 키를 보내고, 서버가 두 번째를 거절한다.
// http 로 여는 사내 주소에서는 crypto.randomUUID 가 없어서 getRandomValues 로 만든다.
export function newRequestKey() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
  } catch { /* 아래 방식으로 */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * drafting: 지금 저장 안 한 새 전표를 입력 중인지 (입력한 내용이 있는 새 전표).
 *  - 새 전표를 저장할 때 take() 로 키를 받는다 (없으면 만든다, 있으면 같은 키)
 *  - 저장에 성공하면 reset(). 새 전표를 비우거나(신규 · 취소) 저장된 전표를 열면 drafting 이 false 가 되어 저절로 버린다
 *    → 다른 새 전표에 같은 키를 쓰지 않는다.
 */
export function useRequestKey(drafting) {
  const ref = useRef('');
  useEffect(() => { if (!drafting) ref.current = ''; }, [drafting]);
  return useMemo(() => ({
    take: () => {
      if (!ref.current) ref.current = newRequestKey();
      return ref.current;
    },
    reset: () => { ref.current = ''; },
  }), []);
}
