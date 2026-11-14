/* STEEL119 — v2 interactions */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- GNB sliding ink ---------- */
  const gnb = $('.gnb'), ink = $('.gnb-ink');
  if (gnb && ink) {
    const links = $$('a', gnb);
    const home = links.find(a => a.getAttribute('aria-current') === 'page');
    const moveTo = (a) => {
      if (!a) { ink.style.opacity = 0; return; }
      ink.style.opacity = 1; ink.style.width = a.offsetWidth + 'px'; ink.style.transform = `translateX(${a.offsetLeft}px)`;
    };
    links.forEach(a => a.addEventListener('mouseenter', () => moveTo(a)));
    gnb.addEventListener('mouseleave', () => moveTo(home));
    window.addEventListener('load', () => moveTo(home)); moveTo(home);
  }

  /* ---------- Korea dot-map (hero) ---------- */
  const cv = $('#korea-map');
  if (cv) {
    // rough outline of the Korean peninsula (lon, lat)
    const poly = [[124.3,39.9],[125.1,39.6],[125.4,38.9],[125.0,38.5],[124.7,38.1],[125.6,37.8],[126.1,37.7],[126.6,37.4],[126.8,36.9],[126.3,36.6],[126.5,36.0],[126.6,35.5],[126.3,35.0],[126.3,34.5],[126.9,34.4],[127.5,34.6],[128.4,34.8],[129.0,35.1],[129.4,35.5],[129.5,36.0],[129.4,36.8],[129.3,37.4],[128.8,38.0],[128.4,38.6],[127.6,39.2],[127.5,39.8],[128.3,40.0],[129.0,40.7],[129.7,41.0],[129.9,41.8],[130.6,42.4],[129.6,42.4],[128.9,42.0],[128.0,42.0],[127.0,41.7],[126.3,41.6],[125.3,40.6]];
    const inPoly = (x, y) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
    const inJeju = (x, y) => ((x - 126.55) / 0.36) ** 2 + ((y - 33.38) / 0.17) ** 2 <= 1;
    const hubs = [
      { n: 'SEOUL', p: [126.98, 37.57], side: 'r' },
      { n: 'INCHEON', p: [126.62, 37.45], side: 'l' },
      { n: 'DANGJIN', p: [126.63, 36.89], side: 'l' },
      { n: 'POHANG', p: [129.36, 36.02], side: 'r' },
      { n: '', p: [129.31, 35.54], side: 'r' },
      { n: 'BUSAN', p: [129.07, 35.18], side: 'r' },
      { n: 'GWANGYANG', p: [127.70, 34.94], side: 'l' },
    ];
    const routes = [[3, 0], [6, 0], [2, 1], [4, 5], [3, 2], [6, 5], [1, 0]];
    const ctx = cv.getContext('2d');
    let W, H, dpr, dots = [], t0 = performance.now();
    const proj = ([lon, lat]) => {
      const cx = 129.4, cy = 37.6, s = H / 12.5; // degrees → px
      return [W / 2 + (lon - cx) * s * 0.8, H / 2 - (lat - cy) * s];
    };
    const build = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      const r = cv.getBoundingClientRect(); W = r.width; H = r.height || r.width;
      cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      dots = [];
      const step = Math.max(6, W / 64);
      for (let y = step / 2; y < H; y += step) for (let x = step / 2; x < W; x += step) {
        const dx = x - W / 2, dy = y - H / 2; const rr = Math.hypot(dx, dy) / (W / 2);
        if (rr > 0.98) continue;
        const cx = 129.4, cy = 37.6, s = H / 12.5;
        const lon = cx + dx / (s * 0.8), lat = cy - dy / s;
        const land = inPoly(lon, lat) || inJeju(lon, lat);
        dots.push({ x, y, land, edge: rr, ph: Math.random() * 6.28 });
      }
    };
    const arc = (a, b, k) => { // quadratic arc point
      const [x1, y1] = proj(hubs[a].p), [x2, y2] = proj(hubs[b].p);
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 - Math.hypot(x2 - x1, y2 - y1) * 0.35;
      return { x1, y1, x2, y2, mx, my, at: (t) => [(1 - t) ** 2 * x1 + 2 * (1 - t) * t * mx + t * t * x2, (1 - t) ** 2 * y1 + 2 * (1 - t) * t * my + t * t * y2] };
    };
    const draw = (now) => {
      const t = (now - t0) / 1000;
      ctx.clearRect(0, 0, W, H);
      for (const d of dots) {
        if (d.land) {
          const tw = 0.55 + 0.45 * Math.sin(t * 1.4 + d.ph);
          ctx.fillStyle = `rgba(170,190,255,${0.55 + 0.4 * tw})`;
          ctx.beginPath(); ctx.arc(d.x, d.y, 1.6, 0, 6.283); ctx.fill();
        } else {
          ctx.fillStyle = `rgba(120,140,220,${0.12 * (1 - d.edge * 0.7)})`;
          ctx.fillRect(d.x - .6, d.y - .6, 1.2, 1.2);
        }
      }
      routes.forEach(([a, b], i) => {
        const A = arc(a, b);
        ctx.strokeStyle = 'rgba(143,163,255,.28)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(A.x1, A.y1); ctx.quadraticCurveTo(A.mx, A.my, A.x2, A.y2); ctx.stroke();
        const p = ((t * 0.35 + i * 0.23) % 1);
        for (let k = 0; k < 10; k++) {
          const tt = p - k * 0.012; if (tt < 0) continue;
          const [x, y] = A.at(tt);
          ctx.fillStyle = `rgba(190,205,255,${0.9 - k * 0.09})`;
          ctx.beginPath(); ctx.arc(x, y, 2.2 - k * 0.15, 0, 6.283); ctx.fill();
        }
      });
      hubs.forEach((h, i) => {
        const [x, y] = proj(h.p); const main = i === 0;
        const pr = ((t * 0.6 + i * 0.3) % 1);
        ctx.strokeStyle = `rgba(143,163,255,${1 - pr})`; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, 4 + pr * (main ? 22 : 14), 0, 6.283); ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, main ? 5 : 3.2, 0, 6.283); ctx.fill();
        if (main) { ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 9, 0, 6.283); ctx.stroke(); }
        ctx.font = `${main ? 800 : 700} ${main ? 12.5 : 11}px Pretendard, sans-serif`;
        ctx.fillStyle = main ? '#fff' : 'rgba(200,212,255,.75)';
        const left = h.side === 'l';
        ctx.textAlign = left ? 'right' : 'left';
        if (h.n) ctx.fillText(h.n, x + (left ? -12 : 12), y + 4);
      });
      if (!reduce) requestAnimationFrame(draw);
    };
    build(); requestAnimationFrame(draw);
    window.addEventListener('resize', () => { build(); if (reduce) requestAnimationFrame(draw); });
  }

  /* ---------- Live feed (illustrative) ---------- */
  const feed = $('#feed-list');
  if (feed) {
    const items = [
      ['EGI', '인천 · 출고', 'EGI/코일 1×160', 277], ['HGI', '당진 · 견적', 'HGI/코일 3.2×135.8', 239],
      ['STS', '부산 · 출고', 'STS304 판재 2t', 412], ['H빔', '서울 · 견적', 'H빔 200×200', 1250],
      ['각관', '울산 · 출고', '각관 50×50×2.3', 186], ['EGI', '포항 · 가공', 'EGI 슬리팅 188mm×4', 335],
      ['AL', '광양 · 견적', '알루미늄 판 3t', 96], ['CR', '인천 · 출고', '냉연강판 1.2t', 520],
    ];
    const fmt = new Intl.NumberFormat('ko-KR');
    let i = 0;
    const push = () => {
      const [tag, loc, spec, kg] = items[i++ % items.length];
      const d = new Date(); const time = d.toTimeString().slice(0, 8);
      const li = document.createElement('li');
      li.innerHTML = `<span class="tag">${tag}</span><div><b>${loc}</b><small>${spec} · ${time}</small></div><em>${fmt.format(kg)}kg</em>`;
      feed.prepend(li);
      while (feed.children.length > 5) feed.lastElementChild.remove();
    };
    for (let k = 0; k < 4; k++) push();
    if (!reduce) setInterval(push, 2600);
  }

  /* ---------- 재고119 cards (examples from current steel119.com listing) ---------- */
  const st = $('#stock-track');
  if (st) {
    const stock = [
      ['EGI/코일', 'KS-SECC / 인산염', '1*160*(mm)', '1EA / 277KG', 1000, 277],
      ['EGI/코일', 'KS-SECC / 인산염', '1*130.8*(mm)', '1EA / 335KG', 1000, 335],
      ['HGI/코일', 'KS-SGHC /', '3.2*135.8*(mm)', '1EA / 239KG', 1000, 239],
      ['EGI/코일', 'KS-SECC / 인산염', '1.18*139*(mm)', '1EA / 312KG', 1000, 312],
    ];
    const fmt = new Intl.NumberFormat('ko-KR');
    const card = ([n, g, sz, q, p, kg]) => `<article class="stock-card"><h3>${n}</h3><dl><dd>${g}</dd><dd>${sz}</dd><dd>${q}</dd></dl><p class="price">${fmt.format(p)}원/kg<br />총 ${fmt.format(p * kg)}원 <small>(VAT별도)</small></p><a class="order" href="./inquiry.html">제품<br />발주</a></article>`;
    const set = `<div class="stock-set">${stock.concat(stock).map(card).join('')}</div>`;
    st.innerHTML = set + set.replace('class="stock-set"', 'class="stock-set" aria-hidden="true"');
  }

  /* ---------- Partner wordmarks ---------- */
  const lt = $('#logo-track');
  if (lt) {
    const logos = [
      `<svg viewBox="0 0 170 56" role="img" aria-label="POSCO"><text x="0" y="40" font-family="Pretendard, Arial Rounded MT Bold, sans-serif" font-size="44" font-weight="800" fill="#005a8c" letter-spacing="-1">posco</text></svg>`,
      `<svg viewBox="0 0 190 56" role="img" aria-label="현대제철 HYUNDAI STEEL"><defs><linearGradient id="hg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1fa0e0" /><stop offset="1" stop-color="#0b3f8f" /></linearGradient></defs><path d="M2 6h12v18h16V6h12v44H30V32H14v18H2z" fill="url(#hg)" /><text x="54" y="25" font-family="Pretendard, Arial, sans-serif" font-size="20" font-weight="800" fill="#123b7a" letter-spacing="1.5">HYUNDAI</text><text x="54" y="48" font-family="Pretendard, Arial, sans-serif" font-size="20" font-weight="800" fill="#123b7a" letter-spacing="1.5">STEEL</text></svg>`,
      `<svg viewBox="0 0 230 56" role="img" aria-label="동국제강그룹"><text x="0" y="42" font-family="Arial Black, Pretendard, sans-serif" font-size="38" font-weight="900" fill="#14285a">D</text><path d="M30 10l14 0-12 32-14 0z" fill="#e1262d" /><text x="36" y="42" font-family="Arial Black, Pretendard, sans-serif" font-size="38" font-weight="900" fill="#14285a">K</text><text x="74" y="40" font-family="Pretendard, sans-serif" font-size="26" font-weight="800" fill="#14285a" letter-spacing="-0.5">동국제강그룹</text></svg>`,
      `<svg viewBox="0 0 130 56" role="img" aria-label="KG스틸"><path d="M40 2l14 8-14 8z" fill="#ff7a00" /><path d="M40 12l14 8-14 8z" fill="#e8336b" opacity=".9" /><text x="0" y="52" font-family="Pretendard, Arial, sans-serif" font-size="30" font-weight="900" fill="#5a1e78">KG</text><text x="52" y="52" font-family="Pretendard, sans-serif" font-size="28" font-weight="800" fill="#5a1e78">스틸</text></svg>`,
    ];
    const one = `<div class="logo-set">${logos.concat(logos).map(s => `<span class="plogo">${s}</span>`).join('')}</div>`;
    lt.innerHTML = one + one.replace('class="logo-set"', 'class="logo-set" aria-hidden="true"').replace(/id="hg"/g, 'id="hg2"').replace(/url\(#hg\)/g, 'url(#hg2)');
  }

  /* ---------- ERP showcase (home) ---------- */
  const tabs = $$('#sc-tabs button');
  if (tabs.length) {
    const data = [
      { k: '01 / Dashboard', t: '오늘의 철강 업무,<br />한 화면에서.', p: '매출·매입·매출이익·미수금을 전월 같은 기간과 비교하고, 월별 이익 추이와 장기재고까지 한눈에 확인합니다.', l: ['전월 동기간 대비 증감 자동 비교', '월별 매출 · 이익 누적 차트', '입고 경과 기간별 장기재고 현황'], panel: 'dashboard', url: 'steel119-erp / dashboard' },
      { k: '02 / AI Order', t: '주문서 한 장을<br />AI가 읽습니다.', p: '발주서를 올리면 원본 옆에 AI 추출 결과가 바로 나옵니다. 발주처·납기·납품장소와 품명·강종·두께·폭·길이·수량·중량을 뽑아 주문서관리로 넘깁니다.', l: ['스캔 기울기 자동 보정 · 품목표 확대 인식', '원본 대조로 근거 위치 검증 · 확인 필요 표시', '주문별 현재고 후보 매칭 · 연결 재고 보호'], panel: 'ai', url: 'steel119-erp / ai-order' },
      { k: '03 / Processing', t: '코일 슬리팅·시트 절단,<br />로스를 줄이는 조합.', p: '필요량과 원자재 후보를 비교해 A·B·C안 추천조합을 제시합니다. 같은 소재의 다른 대기 품목을 섞는 혼합 조합으로 수율을 높입니다.', l: ['연결 원자재 → 현재고 → 과거 매입 규격 순 후보 탐색', '수율 · 로스 · 생산중량 자동 계산', '슬리팅 배치 · 시트 2D 배치도 시각화'], panel: 'opt', url: 'steel119-erp / optimization' },
      { k: '04 / Profit', t: '출고 한 건까지<br />원가를 추적합니다.', p: '출고 품목의 원래 출처(입고·기초재고·가공)까지 거슬러 매입단가를 붙이고, 가공비·부대비용을 반영해 실제 이익과 마진율을 계산합니다.', l: ['거래처별 손익 순위 · 전년 동월 비교', '톤당 매출 · 톤당 이익 분석', '숫자 기반 핵심 요약 문장 자동 생성'], panel: 'profit', url: 'steel119-erp / gross-profit' },
    ];
    const copy = $('#sc-copy'), panel = $('#sc-panel'), img = panel || { style: {} }, url = $('#sc-url'), wrap = $('#sc-tabs');
    let cur = 0, timer;
    const render = (i, anim = true) => {
      cur = i; const d = data[i];
      tabs.forEach((b, j) => { b.setAttribute('aria-selected', String(j === i)); b.tabIndex = j === i ? 0 : -1; });
      const apply = () => {
        copy.innerHTML = `<span class="kicker">${d.k}</span><h3>${d.t}</h3><p>${d.p}</p><ul class="check-list">${d.l.map(x => `<li>${x}</li>`).join('')}</ul><a class="btn btn-red" href="./erp.html">AI ERP 자세히 보기 <span class="ar">→</span></a>`;
        if (panel && window.SteelPanels) window.SteelPanels.render(panel, d.panel); url.textContent = d.url;
        copy.classList.remove('is-out'); img.style.transition = 'none'; img.style.transform = 'translateX(60px)'; img.style.opacity = 0; void img.offsetWidth; img.style.transition = ''; img.style.transform = ''; img.style.opacity = 1;
      };
      if (anim) { copy.classList.add('is-out'); img.style.transform = 'translateX(-60px)'; img.style.opacity = 0; setTimeout(apply, 350); } else apply();
    };
    const auto = () => { clearInterval(timer); if (!reduce) timer = setInterval(() => render((cur + 1) % data.length), 5000); };
    tabs.forEach((b, i) => b.addEventListener('click', () => { render(i); auto(); }));
    const box = $('.showcase'); box && box.addEventListener('mouseenter', () => { clearInterval(timer); wrap.classList.add('paused'); }); box && box.addEventListener('mouseleave', () => { wrap.classList.remove('paused'); auto(); });
    render(0, false); auto();
  }

  /* ---------- AI recognition demo (erp page) ---------- */
  const demo = $('#ai-demo');
  if (demo) {
    const run = () => { demo.classList.remove('is-run'); void demo.offsetWidth; demo.classList.add('is-run'); };
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { run(); io.disconnect(); } }), { threshold: .4 });
    io.observe(demo);
    const btn = $('#ai-demo-replay'); btn && btn.addEventListener('click', run);
  }

  /* ---------- Lightbox (click to zoom screenshots) ---------- */
  const lb = document.createElement('div'); lb.className = 'lightbox'; lb.setAttribute('role', 'dialog'); lb.setAttribute('aria-modal', 'true');
  lb.innerHTML = '<button type="button" aria-label="닫기">×</button><img alt="" />';
  document.body.appendChild(lb);
  const lbImg = $('img', lb);
  const close = () => lb.classList.remove('open');
  lb.addEventListener('click', close);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  document.addEventListener('click', e => {
    const img = e.target.closest('.zoomable img, .browser-view img');
    if (!img) return;
    lbImg.src = img.currentSrc || img.src; lbImg.alt = img.alt; lb.classList.add('open');
  });

  /* ---------- AI recognition 3-stage loop ---------- */
  const seq = $('#ai-seq');
  if (seq) {
    const dur = { 1: 2800, 2: 3400, 3: 7500 };
    let t;
    const sp = $('#seq-panel');
    const go = (s) => { seq.dataset.stage = 0; void seq.offsetWidth; seq.dataset.stage = s; if (s === 3 && sp && window.SteelPanels) window.SteelPanels.render(sp, 'ai'); clearTimeout(t); t = setTimeout(() => go(s % 3 + 1), dur[s]); };
    const io2 = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { go(1); io2.disconnect(); } }), { threshold: .35 });
    io2.observe(seq);
    $$('.seq-steps li', seq).forEach(li => li.addEventListener('click', () => go(+li.dataset.s)));
  }

  /* ---------- Optimization card: slitting animation when visible ---------- */
  const oc = $('#opt-card');
  if (oc) {
    const io3 = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { oc.classList.add('run'); io3.disconnect(); } }), { threshold: .4 });
    io3.observe(oc);
  }

  /* ---------- Inquiry hero: replay 10s loop ---------- */
  const iq = $('#iq-anim');
  if (iq) {
    const play = () => { iq.classList.remove('play'); void iq.offsetWidth; iq.classList.add('play'); };
    play(); if (!reduce) setInterval(play, 10500);
  }

  /* ---------- News ticker ---------- */
  const tk = $('#ticker');
  if (tk && !reduce) {
    let ti = 0; const n = tk.children.length;
    setInterval(() => { ti = (ti + 1) % n; tk.style.transform = `translateY(-${ti * 24}px)`; }, 3200);
  }

  /* ---------- Partner slides (5s) ---------- */
  const ps = $$('#pslides .pcard'), pd = $('#pdots');
  if (ps.length && pd) {
    let pi = 0, pt;
    pd.innerHTML = ps.map((_, i) => `<button type="button" aria-label="파트너 ${i + 1}"></button>`).join('');
    const dots = $$('button', pd);
    const show = (i) => { pi = i; ps.forEach((c, k) => c.classList.toggle('on', k === i)); dots.forEach((d, k) => d.setAttribute('aria-current', String(k === i))); clearTimeout(pt); if (!reduce) pt = setTimeout(() => show((pi + 1) % ps.length), 5000); };
    dots.forEach((d, i) => d.addEventListener('click', () => show(i)));
    show(0);
  }

  /* ---------- inquiry.html#ad → 광고·제휴 탭 선택 ---------- */
  if (location.hash === '#ad') { const b = $('.seg button[data-value="ad"]'); b && b.click(); }
})();
