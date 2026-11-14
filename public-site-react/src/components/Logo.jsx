import { Link } from 'react-router-dom';

// 엠블럼 + STEEL119 워드마크. 머리말은 밝은 엠블럼, 꼬리말은 어두운 엠블럼.
export default function Logo({ dark = false }) {
  return (
    <Link className="logo" to="/" aria-label="스틸119 홈">
      <img src={dark ? '/assets/emblem-dark.png' : '/assets/emblem-light.png'} alt="" />
      <svg className="wm-svg" viewBox="0 0 176 48" aria-hidden="true">
        <text x="1.5" y="8.5" fontSize="7.6" fontWeight="800" letterSpacing="3.2" fill="currentColor" opacity=".7">MOSCO</text>
        <text x="0" y="35" fontSize="31" fontWeight="900" letterSpacing="-1.2" fill="currentColor" textLength="122" lengthAdjust="spacingAndGlyphs">STEEL</text>
        <text x="124" y="35" fontSize="31" fontWeight="900" letterSpacing="-1.4" fill="#e1262d">119</text>
        <text x="170" y="44.5" textAnchor="end" fontSize="6.4" fontWeight="800" letterSpacing="2.3" fill="currentColor">AI ERP</text>
        <path d="M126 46.8H169" stroke="currentColor" strokeWidth="1.1" />
        <circle className="wm-dot" cx="172.5" cy="46.8" r="2.3" fill="#2d4bff" />
      </svg>
    </Link>
  );
}
