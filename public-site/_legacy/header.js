const headerToggle = document.querySelector('.site-menu-toggle');
const siteNavigation = document.querySelector('.site-desktop-nav');
function closeSiteMenu() { headerToggle.setAttribute('aria-expanded', 'false'); headerToggle.setAttribute('aria-label', '메뉴 열기'); siteNavigation.classList.remove('is-open'); }
headerToggle.addEventListener('click', () => { const open = headerToggle.getAttribute('aria-expanded') !== 'true'; headerToggle.setAttribute('aria-expanded', String(open)); headerToggle.setAttribute('aria-label', open ? '메뉴 닫기' : '메뉴 열기'); siteNavigation.classList.toggle('is-open', open); });
siteNavigation.querySelectorAll('a').forEach(link => link.addEventListener('click', closeSiteMenu));
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeSiteMenu(); });
addEventListener('scroll', () => document.querySelector('.site-nav-header').classList.toggle('is-scrolled', scrollY > 10), { passive: true });
