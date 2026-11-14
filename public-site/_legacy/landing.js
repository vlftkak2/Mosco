document.querySelector('#inquiry-form').addEventListener('submit', (event) => { event.preventDefault(); document.querySelector('#form-message').textContent = '현재 온라인 접수는 준비 중입니다. 1600-2579로 문의해주세요. 입력 내용은 전송되지 않았습니다.'; });
let toastTimer;
document.querySelectorAll('[data-pending]').forEach((button) => button.addEventListener('click', () => { const toast = document.querySelector('#toast'); toast.textContent = button.dataset.pending; toast.classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('visible'), 4000); }));
if (!matchMedia('(prefers-reduced-motion: reduce)').matches && 'IntersectionObserver' in window) {
  const observer = new IntersectionObserver((entries) => entries.forEach((entry) => { if (entry.isIntersecting) { entry.target.classList.add('visible'); observer.unobserve(entry.target); } }), { threshold: 0.1 });
  document.querySelectorAll('.reveal').forEach((item) => { item.classList.add('will-reveal'); observer.observe(item); });
}
