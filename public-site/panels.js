/* STEEL119 — HTML-rendered ERP panels (crisp, animated, example data)
   Usage: <div class="panel-host" data-panel="dashboard"></div>
   Panels animate when inserted (CSS keyframes) — re-render to replay. */
(() => {
  const fmt = (n) => new Intl.NumberFormat('ko-KR').format(n);
  const up = (v) => `<span class="pd up">▲ ${v}</span>`;
  const dn = (v) => `<span class="pd dn">▼ ${v}</span>`;
  const head = (title, sub) => `<div class="pn-head"><b>${title}</b><span>${sub}</span><em>화면 재구성 · 예시 데이터</em></div>`;
  const kpi = (label, value, unit, delta, i, tone = '') => `<div class="pn-kpi ${tone}" style="--i:${i}"><small>${label}</small><strong><span data-to="${value}">0</span>${unit}</strong>${delta}</div>`;

  const P = {
    dashboard() {
      const months = [['12월', 3080, 520], ['1월', 2946, 480], ['2월', 2325, 400], ['3월', 3002, 560], ['4월', 2590, 450], ['5월', 2372, 410], ['6월', 3396, 640], ['7월', 2379, 420], ['8월', 3514, 690], ['9월', 4036, 760], ['10월', 2476, 470], ['11월', 5729, 1090]];
      const max = 6000;
      return `<div class="pn">${head('대시보드', '조회기간 2026-11-01 ~ 11-12 · 전월 같은 기간 대비')}
        <div class="pn-kpis">${kpi('매출', 57293271, '원', up('131.3%'), 0, 'c1')}${kpi('매입', 45707580, '원', up('23.4%'), 1, 'c2')}${kpi('매출이익', 10902131, '원', up('262.1%'), 2, 'c3')}${kpi('미수금', 600000, '원', '<span class="pd">1곳 · 30일 경과 없음</span>', 3, 'c4')}</div>
        <div class="pn-box"><div class="pn-sub"><b>월별 매출 · 매출이익</b><span><i class="lg l1"></i>비용 <i class="lg l2"></i>매출이익 (만원)</span></div>
          <div class="bars">${months.map(([m, s, p], i) => `<div class="bar" style="--i:${i}"><em>${fmt(s)}</em><div class="stack" style="height:${(s / max) * 100}%"><span class="cost" style="flex:${s - p}"></span><span class="profit" style="flex:${p}"></span></div><small>${m}</small></div>`).join('')}</div>
        </div></div>`;
    },
    ai() {
      const rows = [['EGI 코일', 'KS-SECC', '인산염', '1.0', '160', '—', '1 EA', '277', 1], ['HGI 코일', 'KS-SGHC', '', '3.2', '135.8', '—', '1 EA', '239', 1], ['각관', 'SPSR400', '', '2.3', '50×50', '6,000', '20 본', '—', 0], ['STS 판재', 'STS304', '2B', '2.0', '1,219', '2,438', '5 매', '—', 0], ['냉연강판', 'SPCC', '', '1.2', '914', '1,829', '10 매', '—', 0]];
      return `<div class="pn pn-ai">${head('AI 주문서인식', 'sample-order.png · 분석 완료')}
        <div class="ai-split">
          <div class="ai-doc"><img src="./assets/sample-order.png" alt="샘플 주문서" /><span class="scanline"></span></div>
          <div class="ai-out">
            <div class="ai-fields">
              <div style="--i:0"><small>발주처 <i>AI 추출</i></small><b>(주)샘플건설</b></div>
              <div style="--i:1"><small>수신처 <i>AI 추출</i></small><b>(주)모스코 (스틸119)</b></div>
              <div style="--i:2"><small>발주일자 <i>AI 추출</i></small><b>2026-11-12</b></div>
              <div style="--i:3"><small>납기일자 <i>AI 추출</i></small><b>2026-11-19</b></div>
              <div class="w" style="--i:4"><small>납품 장소 <i>AI 추출</i></small><b>경기도 화성시 샘플로 123 (현장)</b></div>
            </div>
            <table class="pn-table"><thead><tr><th>품명</th><th>강종</th><th>표면</th><th>두께</th><th>폭</th><th>길이</th><th>수량</th><th>중량</th><th></th></tr></thead>
            <tbody>${rows.map((r, i) => `<tr style="--i:${i + 5}"><td><b>${r[0]}</b></td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td><td>${r[4]}</td><td>${r[5]}</td><td>${r[6]}</td><td>${r[7]}</td><td>${r[8] ? '<span class="tg ok">OK</span>' : '<span class="tg chk">확인 필요</span>'}</td></tr>`).join('')}</tbody></table>
          </div>
        </div></div>`;
    },
    opt() {
      return `<div class="pn">${head('가공최적화', '0.6 × 188mm · 필요 500kg · 원자재 후보 비교')}
        <table class="pn-table big"><thead><tr><th>순위</th><th>구분</th><th>후보 규격</th><th>투입</th><th>생산</th><th>로스</th><th>수율</th></tr></thead>
        <tbody><tr class="on" style="--i:0"><td><b>1순위</b></td><td>연결 원자재</td><td><b>0.6 × 810 × C</b></td><td>4,160kg</td><td>3,862.1kg</td><td>297.9kg</td><td><b class="hl">92.84%</b></td></tr>
        <tr style="--i:1"><td>2순위</td><td>현재고</td><td>0.6 × 914 × C</td><td>5,690kg</td><td>4,681.5kg</td><td>1,008.5kg</td><td>82.28%</td></tr></tbody></table>
        <div class="pn-box"><div class="pn-sub"><b>A안 · 단독가공 · 188mm × 4칼</b><span>원코일 810mm</span></div>
          <div class="slit run"><span>188</span><span>188</span><span>188</span><span>188</span><span class="rest">58</span></div>
          <div class="coil-label sub"><span>사용폭 752mm</span><span>잔여폭 58mm · 로스 297.9kg</span></div>
        </div></div>`;
    },
    profit() {
      const cs = [['A스틸', 18.2, 21.4], ['B철강', 12.6, 18.9], ['C메탈', 9.8, 16.2], ['D산업', 7.1, 22.8], ['E금속', 4.3, 12.5]];
      return `<div class="pn">${head('매출이익 현황', '출고 건별 원가 추적 · 전년 동월 대비')}
        <div class="pn-kpis">${kpi('매출', 57293271, '원', up('131.3%'), 0, 'c1')}${kpi('비용', 46391140, '원', up('113.3%'), 1, 'c2')}${kpi('순이익', 10902131, '원', up('262.1%'), 2, 'c3')}<div class="pn-kpi c4" style="--i:3"><small>마진율</small><strong>19.0%</strong><span class="pd up">▲ 6.9%p</span></div></div>
        <div class="pn-2">
          <div class="pn-box"><div class="pn-sub"><b>거래처별 매출 · 이익률</b><span>백만원</span></div>
            ${cs.map(([n, v, m], i) => `<div class="hbar" style="--i:${i}"><span>${n}</span><div><i style="width:${(v / 20) * 100}%"></i></div><b>${v}</b><em>${m}%</em></div>`).join('')}
          </div>
          <div class="pn-box insight"><div class="pn-sub"><b>한눈에 보는 요점</b></div>
            <p style="--i:0"><b>1</b>순이익이 전월 대비 <strong>+262.1%</strong> 늘었습니다.</p>
            <p style="--i:1"><b>2</b>톤당 이익이 가장 높은 거래처는 <strong>D산업</strong>입니다.</p>
            <p style="--i:2"><b>3</b>이익률이 떨어진 거래처 <strong>1곳</strong>을 확인하세요.</p>
          </div>
        </div></div>`;
    },
    balance() {
      const top = [['A스틸', 42], ['B철강', 26], ['C메탈', 15], ['D산업', 10], ['E금속', 7]];
      return `<div class="pn">${head('거래처 잔액 현황', '기준일 2026-11-12 · 전월말 대비')}
        <div class="pn-kpis k3">${kpi('미수금', 600000, '원', '<span class="pd">거래처 1곳</span>', 0, 'c1')}${kpi('미지급금', 50000000, '원', '<span class="pd">거래처 1곳</span>', 1, 'c2')}<div class="pn-kpi c3" style="--i:2"><small>순잔액</small><strong>−49,400,000원</strong><span class="pd dn">미지급이 더 큼</span></div></div>
        <div class="pn-2">
          <div class="pn-box"><div class="pn-sub"><b>미수금 상위 거래처</b><span>비중 %</span></div>
            ${top.map(([n, v], i) => `<div class="hbar" style="--i:${i}"><span>${n}</span><div><i style="width:${v * 2.2}%"></i></div><b>${v}%</b></div>`).join('')}
          </div>
          <div class="pn-box"><div class="pn-sub"><b>미수금 경과 기간</b></div>
            <div class="aging">${[['30일 이내', 72], ['31~60일', 18], ['61~90일', 7], ['90일 초과', 3]].map(([n, v], i) => `<div style="--i:${i}"><div class="col"><i style="height:${v}%"></i></div><b>${v}%</b><small>${n}</small></div>`).join('')}</div>
          </div>
        </div></div>`;
    },
    stock() {
      const rows = [['2026-11-02', '입고', 'A스틸', 'EGI SHEET', 'KS-SECC', '1.0 × 1219 × 2438', '1,240'], ['2026-11-03', '입고', 'B철강', 'EGI COIL', 'KS-SECC', '1.0 × 160 × C', '277'], ['2026-11-03', '입고', 'C메탈', 'EGI COIL', 'KS-SECC', '1.18 × 139 × C', '312'], ['2026-11-05', '가공', '자사', 'EGI COIL', 'KS-SECC', '0.6 × 188 × C', '965'], ['2026-11-08', '기초', '자사', 'AL COIL', 'A5052', '2.0 × 1000 × C', '820'], ['2026-11-09', '입고', 'D산업', '포스맥1.5', 'KS-SGMCC', '1.5 × 1219 × C', '2,410'], ['2026-11-10', '입고', 'E금속', 'HGI COIL', 'KS-SGHC', '3.2 × 135.8 × C', '239']];
      return `<div class="pn">${head('현재고 현황', '창고 전체 · 17건 · 단위 kg')}
        <table class="pn-table"><thead><tr><th>입고일자</th><th>구분</th><th>거래처</th><th>품명</th><th>강종</th><th>규격 (T × W × L)</th><th style="text-align:right">중량(kg)</th></tr></thead>
        <tbody>${rows.map((r, i) => `<tr style="--i:${i}"><td>${r[0]}</td><td><span class="tg ${r[1] === '입고' ? 'in' : r[1] === '가공' ? 'pr' : 'bs'}">${r[1]}</span></td><td>${r[2]}</td><td><b>${r[3]}</b></td><td>${r[4]}</td><td>${r[5]}</td><td style="text-align:right"><b>${r[6]}</b></td></tr>`).join('')}</tbody></table>
        <div class="pn-foot"><span>현재고 합계</span><b><span data-to="1075800">0</span>kg</b></div></div>`;
    },
  };

  const countUp = (root) => root.querySelectorAll('[data-to]').forEach(el => {
    const to = +el.dataset.to; const t0 = performance.now(); const d = 1100;
    const tick = (t) => { const p = Math.min(1, (t - t0) / d); el.textContent = fmt(Math.round(to * (1 - Math.pow(1 - p, 3)))); if (p < 1) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });

  const render = (host, key) => { host.innerHTML = P[key] ? P[key]() : ''; countUp(host); };
  window.SteelPanels = { render };

  // static hosts render when scrolled into view
  const hosts = [...document.querySelectorAll('.panel-host[data-panel]')];
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { render(e.target, e.target.dataset.panel); io.unobserve(e.target); } }), { threshold: .3 });
    hosts.forEach(h => { if (!h.closest('.browser-view.live')) io.observe(h); });
  } else hosts.forEach(h => render(h, h.dataset.panel));
})();
