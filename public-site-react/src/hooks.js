import { useEffect, useState } from 'react';

// 움직임 줄이기(접근성 설정)를 켠 사용자는 자동 전환 · 반복 애니메이션을 끈다.
export const reduceMotion =
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const numberFormat = new Intl.NumberFormat('ko-KR');
export const fmt = (n) => numberFormat.format(n);

// 요소가 화면에 한 번 들어오면 true (이후 계속 true)
export function useInView(ref, threshold = 0.3) {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setInView(true); io.disconnect(); }
    }, { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, threshold, inView]);
  return inView;
}

// 0 → to 까지 숫자가 올라가는 애니메이션 (start 가 true 가 되면 시작)
export function useCountUp(to, start = true, duration = 1100) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!start) return undefined;
    let frame;
    const t0 = performance.now();
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / duration);
      setValue(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [to, start, duration]);
  return value;
}

// 화면마다 브라우저 탭 제목과 설명을 바꾼다
export function usePageMeta(title, description) {
  useEffect(() => {
    document.title = title;
    if (description) document.querySelector('meta[name="description"]')?.setAttribute('content', description);
  }, [title, description]);
}

// 스크롤해서 보이면 .reveal / .reveal-group / .steps 에 is-in 을 붙여 나타나게 한다 (페이지가 바뀔 때마다 다시 연결)
export function useReveal(rootRef, pageKey) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const targets = [...root.querySelectorAll('.reveal, .reveal-group, .steps')];
    if (!('IntersectionObserver' in window)) { targets.forEach((t) => t.classList.add('is-in')); return undefined; }
    const io = new IntersectionObserver((entries) => entries.forEach((en) => {
      if (!en.isIntersecting) return;
      en.target.classList.add('is-in');
      io.unobserve(en.target);
    }), { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
    targets.forEach((t) => io.observe(t));
    return () => io.disconnect();
  }, [rootRef, pageKey]);
}
