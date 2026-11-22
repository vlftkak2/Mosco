import { Link } from 'react-router-dom';

// 스틸119 로고 (엠블럼 + 스틸119). 머리말 = 라이트(검정 글자), 꼬리말 = 다크(흰 글자 · 어두운 바탕용).
export default function Logo({ dark = false }) {
  return (
    <Link className="logo" to="/" aria-label="스틸119 홈">
      <img className="logo-full" src={dark ? '/assets/steel119-logo-dark.svg' : '/assets/steel119-logo-light.svg'} alt="스틸119" />
    </Link>
  );
}
