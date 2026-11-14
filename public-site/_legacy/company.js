const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
if (!reducedMotion && 'IntersectionObserver' in window) {
  const sections = document.querySelectorAll('.company-intro, .company-section-heading, .service-card, .erp-showcase, .product-list, .company-contact .wrap');
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });
  sections.forEach((section) => { section.classList.add('scroll-reveal'); observer.observe(section); });
}
