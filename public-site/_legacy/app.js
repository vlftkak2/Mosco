const slides = [
  { intro: '발주서 한 장이면 재고 매칭부터 견적·출고까지,', title: '철강 자재가 급할 땐', accent: '스틸119', ending: '가 출동합니다' },
  { intro: '필요한 자재를 찾는 가장 빠른 방법,', title: '자재 문의부터 출고까지', accent: '스틸119', ending: '와 함께하세요' },
  { intro: '철강 업무의 흐름을 더 간결하게,', title: '발주와 재고 확인을', accent: '한곳에서', ending: ' 연결합니다' },
];
let slideIndex = 0;
function showSlide(index) {
  slideIndex = (index + slides.length) % slides.length;
  const slide = slides[slideIndex];
  document.querySelector('.hero-intro').textContent = slide.intro;
  document.querySelector('#hero-title').innerHTML = `${slide.title}<br /><em>${slide.accent}</em>${slide.ending}`;
  document.querySelector('#slide-current').textContent = String(slideIndex + 1).padStart(2, '0');
  document.querySelector('#slide-progress').style.width = `${((slideIndex + 1) / slides.length) * 100}%`;
}
document.querySelector('#previous-slide').addEventListener('click', () => showSlide(slideIndex - 1));
document.querySelector('#next-slide').addEventListener('click', () => showSlide(slideIndex + 1));
showSlide(0);

document.querySelectorAll('[data-category]').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('[data-category]').forEach((item) => item.setAttribute('aria-selected', String(item === tab)));
  });
});

let toastTimer;
function showToast(message) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 4200);
}
document.querySelectorAll('[data-pending]').forEach((button) => button.addEventListener('click', () => showToast(button.dataset.pending)));
document.querySelector('#inquiry-form').addEventListener('submit', (event) => {
  event.preventDefault();
  document.querySelector('#form-message').textContent = '문의 접수 기능은 백엔드 연결 후 이용할 수 있습니다. 지금은 1600-2579로 연락해 주세요.';
});
