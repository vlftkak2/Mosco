import { useEffect, useState } from 'react';

// 화면 캡처 이미지를 누르면 크게 보여준다 (.zoomable img, .browser-view img)
export default function Lightbox() {
  // 닫을 때 흐려지며 사라지도록 이미지는 남겨 두고 open 만 끈다
  const [image, setImage] = useState({ src: '', alt: '', open: false });
  const close = () => setImage((v) => ({ ...v, open: false }));

  useEffect(() => {
    const onClick = (e) => {
      const img = e.target.closest?.('.zoomable img, .browser-view img');
      if (img) setImage({ src: img.currentSrc || img.src, alt: img.alt, open: true });
    };
    const onKey = (e) => { if (e.key === 'Escape') setImage((v) => ({ ...v, open: false })); };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <div className={`lightbox${image.open ? ' open' : ''}`} role="dialog" aria-modal="true" onClick={close}>
      <button type="button" aria-label="닫기">×</button>
      <img src={image.src || undefined} alt={image.alt} />
    </div>
  );
}
