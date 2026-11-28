// 끌어서 순서 바꾸기 (탭 · 내메뉴 공용, 마우스·터치 포인터).
// - 끌리는 항목의 원래 자리는 같은 크기의 빈 칸(점선)으로 그리고, 끌고 있는 모습은 화면 위에 따로 띄운다 (overlay).
// - 6px 이상 움직여야 끌기가 시작된다 (그냥 누르기 · 클릭은 그대로).
// - 다른 항목은 끄는 위치에 따라 바로 밀려서 자리를 비워 준다. 놓으면 onCommit(새 순서).
//
// 사용: 각 항목 요소에 data-sort-id={id}, 끌기 시작할 요소(탭 전체 / 손잡이)에 {...handleProps(id)}.
//       끌기 직후의 클릭은 onClickCapture 로 막는다 (끈 뒤 탭이 열리지 않게).
import { useCallback, useEffect, useRef, useState } from 'react';

const START_DISTANCE = 6;

export default function usePointerSort({ ids, axis = 'x', containerRef, onCommit, disabled = false }) {
  const [drag, setDrag] = useState(null);   // { id, order, x, y, ox, oy, w, h, left, top }
  const pendingRef = useRef(null);
  const dragRef = useRef(null);
  const suppressClickRef = useRef(false);
  const idsRef = useRef(ids);
  const commitRef = useRef(onCommit);
  useEffect(() => { idsRef.current = ids; commitRef.current = onCommit; });

  useEffect(() => {
    const move = (event) => {
      const pending = pendingRef.current;
      if (!pending) return;
      let current = dragRef.current;
      if (!current) {
        if (Math.abs(event.clientX - pending.x) + Math.abs(event.clientY - pending.y) < START_DISTANCE) return;
        const rect = pending.element.getBoundingClientRect();
        current = {
          id: pending.id, order: [...idsRef.current],
          ox: pending.x - rect.left, oy: pending.y - rect.top, w: rect.width, h: rect.height, left: rect.left, top: rect.top,
        };
        document.body.style.userSelect = 'none';
      }
      // 끄는 항목 가운데가 지나간 첫 항목 앞으로 (가로 = 탭, 세로 = 내메뉴)
      const center = axis === 'x' ? event.clientX - current.ox + current.w / 2 : event.clientY - current.oy + current.h / 2;
      const others = [...(containerRef.current?.querySelectorAll('[data-sort-id]') || [])]
        .filter((element) => element.dataset.sortId !== current.id);
      const before = others.find((element) => {
        const box = element.getBoundingClientRect();
        return (axis === 'x' ? box.left + box.width / 2 : box.top + box.height / 2) > center;
      });
      const rest = current.order.filter((id) => id !== current.id);
      const index = before ? rest.indexOf(before.dataset.sortId) : rest.length;
      rest.splice(index < 0 ? rest.length : index, 0, current.id);
      current = { ...current, order: rest, x: event.clientX, y: event.clientY };
      dragRef.current = current;
      setDrag(current);
    };
    const end = () => {
      const current = dragRef.current;
      pendingRef.current = null;
      if (!current) return;
      dragRef.current = null;
      document.body.style.userSelect = '';
      suppressClickRef.current = true;
      window.setTimeout(() => { suppressClickRef.current = false; }, 0);
      setDrag(null);
      const before = idsRef.current;
      if (current.order.some((id, index) => id !== before[index])) commitRef.current?.(current.order);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [axis, containerRef]);

  const handleProps = useCallback((id) => (disabled ? {} : {
    onPointerDown: (event) => {
      if (event.button !== 0) return;
      const element = event.currentTarget.closest('[data-sort-id]');
      if (!element) return;
      pendingRef.current = { id, x: event.clientX, y: event.clientY, element };
    },
    // 브라우저 기본 끌기(그림 · 글자 끌기)는 쓰지 않는다
    onDragStart: (event) => event.preventDefault(),
  }), [disabled]);

  const onClickCapture = useCallback((event) => {
    if (!suppressClickRef.current) return;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  // 띄운 모습의 위치: 가로 목록은 가로로만, 세로 목록은 세로로만 따라 움직인다 (시안과 같음)
  const overlayStyle = drag ? {
    position: 'fixed', zIndex: 1000, pointerEvents: 'none', margin: 0, boxSizing: 'border-box',
    width: drag.w, height: drag.h,
    left: axis === 'x' ? drag.x - drag.ox : drag.left,
    top: axis === 'x' ? drag.top : drag.y - drag.oy,
  } : null;

  return { order: drag?.order || ids, draggingId: drag?.id || null, placeholderSize: drag ? { width: drag.w, height: drag.h } : null, overlayStyle, handleProps, onClickCapture };
}
