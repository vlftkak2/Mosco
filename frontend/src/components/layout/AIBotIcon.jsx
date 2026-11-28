// AI 업무비서 챗봇 얼굴 (화면 오른쪽 가장자리 탭 · 'AI 업무비서' 화면이 같이 쓴다). 색은 currentColor.
export default function AIBotIcon({ size = 24, stroke = 1.5, className }) {
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2z" /><path d="M12 2v2" /><path d="M9 12v9" /><path d="M15 12v9" />
    <path d="M5 16l4-2" /><path d="M15 14l4 2" /><path d="M9 18h6" /><path d="M10 8v.01" /><path d="M14 8v.01" />
  </svg>;
}
