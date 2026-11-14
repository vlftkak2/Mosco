const previews = {
  dashboard: ['erp-dashboard-live.png', 'STEEL119 / DASHBOARD', '실제 업무 데이터가 표시된 대시보드 화면입니다.'],
  ledger: ['erp-customer-ledger.png', 'STEEL119 / CUSTOMER LEDGER', '실제 거래처의 잔액과 원장을 조회한 화면입니다.'],
  ai: ['erp-ai-optimization.png', 'STEEL119 / AI PROCESSING', '실제 주문의 원자재 후보와 가공 추천조합을 확인한 화면입니다.'],
};
const tabs = [...document.querySelectorAll('[data-screen]')];
function selectPreview(tab) {
  tabs.forEach(item => { const active = item === tab; item.setAttribute('aria-selected', String(active)); item.tabIndex = active ? 0 : -1; });
  const [file, label, description] = previews[tab.dataset.screen];
  const image = document.querySelector('#product-screen-image');
  image.src = `./assets/${file}`; image.alt = description;
  document.querySelector('#screen-label').textContent = label;
  const panel = document.querySelector('#preview-panel'); panel.textContent = description; panel.setAttribute('aria-labelledby', tab.id);
}
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectPreview(tab));
  tab.addEventListener('keydown', event => {
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    if (next !== undefined) { event.preventDefault(); tabs[next].focus(); selectPreview(tabs[next]); }
  });
});
const countInput = document.querySelector('#user-count');
function updatePrice() {
  const count = Math.max(1, Math.floor(Number(countInput.value) || 1));
  countInput.value = String(count);
  document.querySelector('#monthly-total').textContent = `${(200000 + count * 5000).toLocaleString('ko-KR')}원`;
  document.querySelector('#price-breakdown').textContent = `기본 200,000원 + 사용자 ${count.toLocaleString('ko-KR')}명 × 5,000원`;
  document.querySelector('#user-minus').disabled = count === 1;
}
countInput.addEventListener('input', () => { if (countInput.value !== '') updatePrice(); });
countInput.addEventListener('blur', updatePrice);
document.querySelector('#user-minus').addEventListener('click', () => { countInput.value = String(Number(countInput.value) - 1); updatePrice(); });
document.querySelector('#user-plus').addEventListener('click', () => { countInput.value = String(Number(countInput.value) + 1); updatePrice(); });
updatePrice();
if (!matchMedia('(prefers-reduced-motion: reduce)').matches && 'IntersectionObserver' in window) {
  const observer = new IntersectionObserver(entries => entries.forEach(entry => { if (entry.isIntersecting) { entry.target.classList.add('visible'); observer.unobserve(entry.target); } }), {threshold: 0.08});
  document.querySelectorAll('.reveal').forEach(item => { item.classList.add('will-reveal'); observer.observe(item); });
}
