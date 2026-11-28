import { createContext, useContext, useEffect } from 'react';

// 저장하지 않은 변경이 있는 화면(탭) 목록.
//  - 화면: useUnsavedChanges(dirty) 한 줄로 알린다 (탭 경로는 MainLayout 이 PagePathContext 로 넘겨 준다)
//  - MainLayout: 탭 닫기 · 모두 닫기 전에 isDirty 로 확인
//  - 브라우저 닫기 · 새로고침: 하나라도 있으면 beforeunload 경고
export const PagePathContext = createContext(null);

const dirtyPages = new Set();

function onBeforeUnload(event) {
  if (!dirtyPages.size) return undefined;
  event.preventDefault();
  event.returnValue = '';   // 옛 브라우저용
  return '';
}

function syncListener() {
  if (typeof window === 'undefined') return;
  window.removeEventListener('beforeunload', onBeforeUnload);
  if (dirtyPages.size) window.addEventListener('beforeunload', onBeforeUnload);
}

export function setDirty(pageKey, dirty) {
  if (!pageKey) return;
  if (dirty) dirtyPages.add(pageKey); else dirtyPages.delete(pageKey);
  syncListener();
}

export function isDirty(pageKey) {
  return dirtyPages.has(pageKey);
}

export function anyDirty(pageKeys) {
  return (pageKeys || []).some((key) => dirtyPages.has(key));
}

// 강제 로그아웃(세션 종료)처럼 어차피 저장할 수 없는 이동: 경고 없이 떠난다
export function clearAllDirty() {
  dirtyPages.clear();
  syncListener();
}

export function clearDirty(pageKey) {
  setDirty(pageKey, false);
}

// 화면에서: useUnsavedChanges(hasPendingChanges)
export function useUnsavedChanges(dirty) {
  const pageKey = useContext(PagePathContext);
  const flag = Boolean(dirty);
  useEffect(() => {
    if (!pageKey) return undefined;
    setDirty(pageKey, flag);
    return () => setDirty(pageKey, false);
  }, [pageKey, flag]);
}
