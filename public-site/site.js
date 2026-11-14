/* STEEL119 public site — shared behaviour (no backend yet) */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  /* toast */
  const toast = document.createElement('div');
  toast.className = 'toast'; toast.setAttribute('role', 'status'); toast.setAttribute('aria-live', 'polite');
  document.body.appendChild(toast);
  let tTimer;
  const notify = (msg) => { toast.textContent = msg; toast.classList.add('show'); clearTimeout(tTimer); tTimer = setTimeout(() => toast.classList.remove('show'), 3200); };
  window.steelNotify = notify;

  /* header: scrolled state + mobile menu */
  const hd = $('.hd');
  const topBtn = $('.fab .top');
  const onScroll = () => {
    const y = window.scrollY;
    hd && hd.classList.toggle('is-scrolled', y > 8);
    topBtn && topBtn.classList.toggle('is-show', y > 600);
  };
  window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
  const menuBtn = $('.menu-btn');
  if (menuBtn) {
    menuBtn.addEventListener('click', () => {
      const open = document.body.classList.toggle('menu-open');
      menuBtn.setAttribute('aria-expanded', String(open));
      menuBtn.setAttribute('aria-label', open ? '메뉴 닫기' : '메뉴 열기');
    });
    $$('.gnb a, .hd-actions a').forEach(a => a.addEventListener('click', () => {
      document.body.classList.remove('menu-open'); menuBtn.setAttribute('aria-expanded', 'false');
    }));
  }
  topBtn && topBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

  /* pending links (kakao etc.) */
  $$('[data-pending]').forEach(el => el.addEventListener('click', e => { e.preventDefault(); notify(el.dataset.pending); }));

  /* reveal on scroll + counters */
  const animateCount = (el) => {
    const to = parseFloat(el.dataset.count); const dur = 1400; const t0 = performance.now();
    const fmt = new Intl.NumberFormat('ko-KR');
    const tick = (t) => { const p = Math.min(1, (t - t0) / dur); const v = to * (1 - Math.pow(1 - p, 3)); el.textContent = fmt.format(Math.round(v)); if (p < 1) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  };
  const targets = $$('.reveal, .reveal-group, .steps, [data-count]');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => entries.forEach(en => {
      if (!en.isIntersecting) return;
      en.target.classList.add('is-in');
      if (en.target.dataset.count) animateCount(en.target);
      io.unobserve(en.target);
    }), { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
    targets.forEach(t => io.observe(t));
  } else targets.forEach(t => t.classList.add('is-in'));

  /* news category filter */
  const chips = $$('.chips button');
  chips.forEach(btn => btn.addEventListener('click', () => {
    chips.forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
    const cat = btn.dataset.cat;
    $$('.news-list li').forEach(li => { li.hidden = cat !== 'all' && li.dataset.cat !== cat; });
  }));

  /* forms: front-end only. Validate, then explain that the backend is not connected yet. */
  $$('form[data-demo]').forEach(form => {
    form.addEventListener('submit', e => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      notify('문의 접수 기능은 서버 연결 후 활성화됩니다. 급한 문의는 1600-2579로 전화해주세요.');
    });
  });

  /* file drop zone */
  $$('.drop').forEach(drop => {
    const input = $('input[type=file]', drop); const label = $('b', drop);
    if (!input) return;
    const show = (files) => { if (files && files.length) label.textContent = [...files].map(f => f.name).join(', '); };
    input.addEventListener('change', () => show(input.files));
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('is-over'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('is-over'); }));
    drop.addEventListener('drop', e => { input.files = e.dataTransfer.files; show(input.files); });
  });

  /* segmented inquiry type */
  $$('.seg').forEach(seg => {
    const btns = $$('button', seg); const hidden = $(seg.dataset.target);
    btns.forEach(b => b.addEventListener('click', () => {
      btns.forEach(x => x.setAttribute('aria-selected', String(x === b)));
      if (hidden) hidden.value = b.dataset.value;
      $$('[data-show-for]').forEach(el => { el.hidden = !el.dataset.showFor.split(' ').includes(b.dataset.value); });
    }));
  });
  if (location.hash === '#erp') { const b = $('.seg button[data-value="erp"]'); b && b.click(); }

  /* ERP price calculator: 200,000 base + 5,000 per user (monthly, VAT excluded) */
  const BASE = 200000, PER = 5000;
  const users = $('#user-count');
  if (users) {
    const out = $('#monthly-total'), note = $('#price-breakdown');
    const fmt = n => new Intl.NumberFormat('ko-KR').format(n);
    const update = () => {
      let n = Math.max(1, Math.min(999, parseInt(users.value, 10) || 1));
      users.value = n;
      out.textContent = fmt(BASE + PER * n) + '원';
      note.textContent = `기본 ${fmt(BASE)}원 + 사용자 ${n}명 × ${fmt(PER)}원 (월, VAT 별도)`;
    };
    $('#user-minus').addEventListener('click', () => { users.value = (+users.value || 1) - 1; update(); });
    $('#user-plus').addEventListener('click', () => { users.value = (+users.value || 0) + 1; update(); });
    users.addEventListener('input', update); update();
  }

  /* ERP screen tabs */
  const tabs = $$('[data-screen]');
  if (tabs.length) {
    const img = $('#screen-img'), lbl = $('#screen-label');
    const select = (tab) => {
      tabs.forEach(t => { const a = t === tab; t.setAttribute('aria-selected', String(a)); t.tabIndex = a ? 0 : -1; });
      img.style.opacity = 0;
      setTimeout(() => { img.src = tab.dataset.screen; img.alt = tab.dataset.alt; lbl.textContent = tab.dataset.label; img.style.opacity = 1; }, 180);
    };
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => select(t));
      t.addEventListener('keydown', e => {
        const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (d) { const n = tabs[(i + d + tabs.length) % tabs.length]; n.focus(); select(n); }
      });
    });
  }
})();
