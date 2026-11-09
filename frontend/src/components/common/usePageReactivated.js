// 탭 유지 화면의 데이터 새로고침용.
//  usePageActivation()      : 탭이 다시 나타난 횟수. 목록(거래처·코드 등)을 불러오는 useEffect 의 의존값에 넣으면
//                             탭에 돌아올 때마다 다시 불러온다.
//  usePageReactivated(fn)   : 탭이 숨었다가 다시 나타날 때 한 번 fn 을 부른다 (처음 열 때는 부르지 않음).
import { useContext, useEffect, useRef } from 'react';
import { PageActivationContext } from '../layout/MainLayout';

export function usePageActivation() {
  return useContext(PageActivationContext);
}

export default function usePageReactivated(onReactivate) {
  const activation = useContext(PageActivationContext);
  const seen = useRef(activation);
  const callback = useRef(onReactivate);
  useEffect(() => { callback.current = onReactivate; });
  useEffect(() => {
    if (activation > seen.current) callback.current?.();
    seen.current = activation;
  }, [activation]);
}
