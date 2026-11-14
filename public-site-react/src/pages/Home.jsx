import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import KoreaMap from '../components/KoreaMap';
import Showcase from '../components/Showcase';
import { LazyPanel } from '../components/Panels';
import { DemoForm, PendingLink } from '../components/Toast';
import { fmt, reduceMotion, useCountUp, useInView, usePageMeta } from '../hooks';

// 화면에 보이면 0 부터 올라가는 숫자 (통계 카드)
function CountOnView({ to }) {
  const ref = useRef(null);
  const inView = useInView(ref, 0.15);
  const value = useCountUp(to, inView, 1400);
  return <span ref={ref}>{fmt(value)}</span>;
}

// 실시간 출고 · 견적 현황 (예시 데이터를 2.6초마다 하나씩 올린다)
const FEED = [
  ['EGI', '인천 · 출고', 'EGI/코일 1×160', 277], ['HGI', '당진 · 견적', 'HGI/코일 3.2×135.8', 239],
  ['STS', '부산 · 출고', 'STS304 판재 2t', 412], ['H빔', '서울 · 견적', 'H빔 200×200', 1250],
  ['각관', '울산 · 출고', '각관 50×50×2.3', 186], ['EGI', '포항 · 가공', 'EGI 슬리팅 188mm×4', 335],
  ['AL', '광양 · 견적', '알루미늄 판 3t', 96], ['CR', '인천 · 출고', '냉연강판 1.2t', 520],
];
const feedEntry = (n) => ({ id: n, data: FEED[n % FEED.length], time: new Date().toTimeString().slice(0, 8) });

function LiveFeed() {
  const [entries, setEntries] = useState(() => [3, 2, 1, 0].map(feedEntry));
  useEffect(() => {
    if (reduceMotion) return undefined;
    const timer = setInterval(() => {
      setEntries((list) => [feedEntry(list[0].id + 1), ...list].slice(0, 5));
    }, 2600);
    return () => clearInterval(timer);
  }, []);
  return (
    <ul id="feed-list">
      {entries.map(({ id, data: [tag, loc, spec, kg], time }) => (
        <li key={id}><span className="tag">{tag}</span><div><b>{loc}</b><small>{spec} · {time}</small></div><em>{fmt(kg)}kg</em></li>
      ))}
    </ul>
  );
}

const NEWS = [
  { cat: 'price', label: '가격동향', title: 'H형강 유통가격 보합세… 수요 회복 시점은?' },
  { cat: 'market', label: '시황', title: '열연강판 수입재 가격 흐름 점검' },
  { cat: 'policy', label: '정책', title: '건설자재 관련 제도 변경 사항 정리' },
  { cat: 'news', label: '스틸119 소식', title: 'AI 주문서 인식 기능 안내', to: '/erp#ai-order' },
];
const NEWS_CHIPS = [['all', '전체'], ['market', '시황'], ['price', '가격동향'], ['policy', '정책'], ['news', '스틸119 소식']];

function Ticker() {
  const items = [['가격동향', NEWS[0].title], ['시황', NEWS[1].title], ['정책', NEWS[2].title], ['스틸119', NEWS[3].title]];
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (reduceMotion) return undefined;
    const timer = setInterval(() => setIndex((i) => (i + 1) % items.length), 3200);
    return () => clearInterval(timer);
  }, [items.length]);
  return (
    <ul id="ticker" style={{ transform: index ? `translateY(-${index * 24}px)` : undefined }}>
      {items.map(([cat, title]) => <li key={title}><span className="cat">{cat}</span>{title}</li>)}
    </ul>
  );
}

function NewsCard() {
  const [cat, setCat] = useState('all');
  return (
    <div className="card news-card reveal">
      <div className="card-head"><div><span className="kicker">Steel News</span><h2>최신 철강뉴스</h2></div><PendingLink msg="뉴스 게시판은 준비 중입니다.">전체보기 +</PendingLink></div>
      <div className="chips" role="group" aria-label="뉴스 분류">
        {NEWS_CHIPS.map(([value, label]) => (
          <button key={value} type="button" aria-pressed={cat === value} onClick={() => setCat(value)}>{label}</button>
        ))}
      </div>
      <ul className="news-list">
        {NEWS.map((n) => (
          <li key={n.title} hidden={cat !== 'all' && n.cat !== cat}>
            <span className="cat">{n.label}</span>
            {n.to ? <Link to={n.to}>{n.title}</Link> : <PendingLink msg="뉴스 상세는 준비 중입니다.">{n.title}</PendingLink>}
            <time>예시</time>
          </li>
        ))}
      </ul>
      <p className="placeholder-note">※ 레이아웃 예시입니다. 게시판 연동 후 실제 기사로 표시됩니다.</p>
    </div>
  );
}

const PARTNERS = [
  { g1: '#1e35c8', g2: '#5a73ff', small: '철강 가공 · 절단', title: '정밀 절단 · 레이저 가공 파트너', desc: '이 자리에 귀사의 서비스를 소개하세요.' },
  { g1: '#0f766e', g2: '#14b8a6', small: '운송 · 물류', title: '소량 철강 당일 운송 파트너', desc: '현장까지 빠른 배송 서비스를 알려보세요.' },
  { g1: '#9a3412', g2: '#f97316', small: '장비 · 공구 · 소모품', title: '현장 장비 · 소모품 파트너', desc: '철강 현장에 필요한 제품을 소개하세요.' },
];

function PartnerSlides() {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (reduceMotion) return undefined;
    const timer = setTimeout(() => setIndex((i) => (i + 1) % PARTNERS.length), 5000);
    return () => clearTimeout(timer);
  }, [index]);
  return (
    <aside className="partners reveal" aria-label="파트너 소개">
      <div className="partners-head">
        <span className="kicker">Partners</span><h3>스틸119 파트너</h3>
        <div className="pdots">
          {PARTNERS.map((p, i) => (
            <button key={p.title} type="button" aria-label={`파트너 ${i + 1}`} aria-current={String(i === index)} onClick={() => setIndex(i)} />
          ))}
        </div>
      </div>
      <div className="pslides">
        {PARTNERS.map((p, i) => (
          <Link key={p.title} className={`pcard${i === index ? ' on' : ''}`} to="/inquiry#ad" style={{ '--g1': p.g1, '--g2': p.g2 }}>
            <span className="ptag">파트너</span>
            <div className="pc-visual"><b>YOUR BRAND</b><small>{p.small}</small></div>
            <div className="pc-body"><b>{p.title}</b><p>{p.desc}</p><em>자세히 보기 →</em></div>
          </Link>
        ))}
      </div>
      <Link className="partners-cta" to="/inquiry#ad">파트너 · 광고 제휴 문의 <b>1600-2579</b></Link>
    </aside>
  );
}

// 재고119 카드 (steel119.com 현재 목록의 예시). 무한 흐름을 위해 같은 묶음을 두 번 그린다.
const STOCK = [
  ['EGI/코일', 'KS-SECC / 인산염', '1*160*(mm)', '1EA / 277KG', 1000, 277],
  ['EGI/코일', 'KS-SECC / 인산염', '1*130.8*(mm)', '1EA / 335KG', 1000, 335],
  ['HGI/코일', 'KS-SGHC /', '3.2*135.8*(mm)', '1EA / 239KG', 1000, 239],
  ['EGI/코일', 'KS-SECC / 인산염', '1.18*139*(mm)', '1EA / 312KG', 1000, 312],
];

function StockSet({ hidden }) {
  return (
    <div className="stock-set" aria-hidden={hidden || undefined}>
      {STOCK.concat(STOCK).map(([n, g, sz, q, p, kg], i) => (
        <article className="stock-card" key={i}>
          <h3>{n}</h3>
          <dl><dd>{g}</dd><dd>{sz}</dd><dd>{q}</dd></dl>
          <p className="price">{fmt(p)}원/kg<br />총 {fmt(p * kg)}원 <small>(VAT별도)</small></p>
          <Link className="order" to="/inquiry" tabIndex={hidden ? -1 : undefined}>제품<br />발주</Link>
        </article>
      ))}
    </div>
  );
}

// 제철사 워드마크 (SVG 근사 재현 — 공식 로고 파일로 교체 권장)
function PartnerLogos({ gradientId }) {
  return [
    <svg key="posco" viewBox="0 0 170 56" role="img" aria-label="POSCO"><text x="0" y="40" fontFamily="Pretendard, Arial Rounded MT Bold, sans-serif" fontSize="44" fontWeight="800" fill="#005a8c" letterSpacing="-1">posco</text></svg>,
    <svg key="hyundai" viewBox="0 0 190 56" role="img" aria-label="현대제철 HYUNDAI STEEL"><defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1fa0e0" /><stop offset="1" stopColor="#0b3f8f" /></linearGradient></defs><path d="M2 6h12v18h16V6h12v44H30V32H14v18H2z" fill={`url(#${gradientId})`} /><text x="54" y="25" fontFamily="Pretendard, Arial, sans-serif" fontSize="20" fontWeight="800" fill="#123b7a" letterSpacing="1.5">HYUNDAI</text><text x="54" y="48" fontFamily="Pretendard, Arial, sans-serif" fontSize="20" fontWeight="800" fill="#123b7a" letterSpacing="1.5">STEEL</text></svg>,
    <svg key="dk" viewBox="0 0 230 56" role="img" aria-label="동국제강그룹"><text x="0" y="42" fontFamily="Arial Black, Pretendard, sans-serif" fontSize="38" fontWeight="900" fill="#14285a">D</text><path d="M30 10l14 0-12 32-14 0z" fill="#e1262d" /><text x="36" y="42" fontFamily="Arial Black, Pretendard, sans-serif" fontSize="38" fontWeight="900" fill="#14285a">K</text><text x="74" y="40" fontFamily="Pretendard, sans-serif" fontSize="26" fontWeight="800" fill="#14285a" letterSpacing="-0.5">동국제강그룹</text></svg>,
    <svg key="kg" viewBox="0 0 130 56" role="img" aria-label="KG스틸"><path d="M40 2l14 8-14 8z" fill="#ff7a00" /><path d="M40 12l14 8-14 8z" fill="#e8336b" opacity=".9" /><text x="0" y="52" fontFamily="Pretendard, Arial, sans-serif" fontSize="30" fontWeight="900" fill="#5a1e78">KG</text><text x="52" y="52" fontFamily="Pretendard, sans-serif" fontSize="28" fontWeight="800" fill="#5a1e78">스틸</text></svg>,
  ];
}

function LogoSet({ hidden, gradientId }) {
  const logos = PartnerLogos({ gradientId });
  return (
    <div className="logo-set" aria-hidden={hidden || undefined}>
      {logos.concat(logos).map((svg, i) => <span className="plogo" key={i}>{svg}</span>)}
    </div>
  );
}

export default function Home() {
  usePageMeta('스틸119 | 철강 자재가 급할 땐', '철강 자재가 급할 땐 스틸119. 소량 철강 자재의 발주 문의부터 재고 확인, 견적, 가공, 출고까지. 철강 업무를 위한 AI ERP도 함께 제공합니다.');

  return (
    <>
      {/* HERO */}
      <section className="hero2 on-dark">
        <div className="wrap">
          <div className="hero2-grid">
            <div className="hero-in">
              <span className="hero-badge"><i />소량 전문 철강 자재 · (주)모스코</span>
              <h1 style={{ marginTop: 24 }}>철강 자재가 급할 땐,<br />필요한 만큼 가장 빠르게<br /><em className="hl">스틸119</em></h1>
              <p className="hero-lead">한 본, 한 장의 소량 주문도 재고부터 확인합니다.<br />문의부터 견적·가공·출고까지 막힘없이 연결하세요.</p>
              <div className="hero-cta">
                <Link className="btn btn-red btn-lg" to="/inquiry">발주 문의하기 <span className="ar">→</span></Link>
                <Link className="btn btn-line-light btn-lg" to="/company">회사소개</Link>
              </div>
            </div>
            <div className="mapviz" aria-hidden="true">
              <div className="orbit-ring" />
              <div className="sphere"><KoreaMap /></div>
              <div className="feed">
                <div className="feed-head"><span><i />실시간 출고 · 견적 현황</span><span>LIVE</span></div>
                <LiveFeed />
                <p className="feed-note">화면 예시 · ERP 연동 예정</p>
              </div>
            </div>
          </div>
          <div className="stat-cards reveal-group">
            <div className="stat-card"><b><CountOnView to={2568} /><small>건+</small></b><p>누적 거래 완료</p></div>
            <div className="stat-card"><b><CountOnView to={940896} /><small>kg</small></b><p>누적 출고 중량</p></div>
            <div className="stat-card"><b><CountOnView to={89} /><small>건</small></b><p>이번 달 발주 문의</p></div>
            <div className="stat-card"><b>24<small>h</small></b><p>견적 회신 목표</p></div>
          </div>
          <p className="stat-src">steel119.com 실시간 현황 기준 (2026.11)</p>
        </div>
      </section>

      {/* NEWS + PARTNERS */}
      <section className="newsbar">
        <div className="wrap">
          <div className="ticker reveal"><b><i />STEEL NEWS</b><div className="ticker-win"><Ticker /></div><a href="#news">전체보기 +</a></div>
          <div className="np-grid" id="news">
            <NewsCard />
            <PartnerSlides />
          </div>
        </div>
      </section>

      {/* 재고119 + 간편문의 */}
      <section className="stock-sec" id="stock">
        <div className="wrap stock-grid">
          <div className="stock-left reveal">
            <div className="stock-panel">
              <div className="stock-top"><h2>재고<span style={{ color: '#8fa3ff' }}>119</span><small>READY STOCK</small></h2><p># 소량 # 다품종 # 납기준수 &nbsp;# 열연 # 냉연 # STS # 알루미늄 # 코일 # 판재</p></div>
              <div className="stock-track-wrap">
                <div className="stock-track" id="stock-track"><StockSet /><StockSet hidden /></div>
              </div>
              <p className="stock-note">※ 재고 예시입니다. 실제 재고·단가는 문의 시 확인해드립니다. (VAT 별도)</p>
            </div>
            <div className="sub-row">
              <aside className="fx">
                <div className="fx-head"><h3>오늘의 환율</h3><small>연동 예정</small></div>
                <dl><div><dt>USD</dt><dd>—</dd></div><div><dt>CNY</dt><dd>—</dd></div><div><dt>JPY(100)</dt><dd>—</dd></div><div><dt>EUR</dt><dd>—</dd></div></dl>
              </aside>
              <Link className="partner-wide" to="/inquiry#ad"><span className="ptag">파트너</span><div className="pw-logo">YOUR<br />BRAND</div><div><b>철강 현장에 꼭 맞는 파트너를 소개합니다</b><small>가공 · 운송 · 장비 · 소모품 업체를 스틸119 고객에게 알려보세요</small></div><em>제휴 문의 →</em></Link>
            </div>
          </div>

          <div className="quick reveal" id="inquiry">
            <span className="kicker light">Quick Inquiry</span>
            <h2>간편문의</h2>
            <p>필요한 자재와 사이즈만 남겨주세요.<br />재고 확인 후 빠르게 연락드립니다.</p>
            <DemoForm>
              <div className="form-2">
                <div className="field"><label htmlFor="q-name">이름<em>*</em></label><input id="q-name" name="name" autoComplete="name" placeholder="홍길동" required /></div>
                <div className="field"><label htmlFor="q-phone">연락처<em>*</em></label><input id="q-phone" name="phone" type="tel" autoComplete="tel" placeholder="010-0000-0000" required /></div>
              </div>
              <div className="field"><label htmlFor="q-mat">필요 자재 (규격)<em>*</em></label><input id="q-mat" name="material" placeholder="예) EGI/코일 1 × 160mm" required /></div>
              <div className="field"><label htmlFor="q-size">사이즈 · 수량<em>*</em></label><input id="q-size" name="size" placeholder="예) 길이 6m / 수량 20본" required /></div>
              <label className="consent"><input type="checkbox" required /><span><b>(필수)</b> 개인정보 수집·이용 동의</span><PendingLink msg="개인정보처리방침 전문은 준비 중입니다.">전문</PendingLink></label>
              <button className="btn btn-red" type="submit">문의 접수하기 <span className="ar">→</span></button>
              <p className="form-foot">급한 문의는<a href="tel:16002579">1600-2579</a></p>
            </DemoForm>
          </div>
        </div>
      </section>

      {/* 제철사 로고 */}
      <section className="logos">
        <div className="wrap reveal">
          <h2>국내 최고의 철강회사와 함께합니다.</h2>
          <p>포스코, 현대제철, 동국제강, KG스틸</p>
        </div>
        <div className="logo-marquee">
          <div className="logo-track" id="logo-track"><LogoSet gradientId="hg" /><LogoSet hidden gradientId="hg2" /></div>
        </div>
      </section>

      {/* WHY */}
      <section className="sec sec-tint">
        <div className="wrap center">
          <div className="reveal">
            <h2 className="sec-title" style={{ marginTop: 0 }}>소량 철강 구매,<br />더 이상 번거롭지 않게.</h2>
            <p className="sec-desc">필요한 건 몇 본인데 최소 주문량에 막히고, 견적 하나 받으려 여러 곳에 전화하셨나요?<br />스틸119은 <strong>소량·다품종 주문을 하나의 창구에서</strong> 재고 확인부터 출고까지 처리합니다.</p>
          </div>
          <div className="feat5 reveal-group">
            <article className="feat"><div className="ico"><svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h10M4 17h6" /></svg></div><h3>소량 · 다품종</h3><p>한 본, 한 장부터. 여러 품목도 한 번에 문의하세요.</p></article>
            <article className="feat"><div className="ico"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg></div><h3>빠른 견적</h3><p>재고를 먼저 확인하고 견적을 신속하게 회신합니다.</p></article>
            <article className="feat"><div className="ico"><svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M8.5 7.5L20 18M8.5 16.5L20 6" /></svg></div><h3>맞춤 절단 · 가공</h3><p>필요한 길이·폭으로 절단·슬리팅해 바로 쓰게 보내드립니다.</p></article>
            <article className="feat"><div className="ico"><svg viewBox="0 0 24 24"><path d="M2 6h12v10H2zM14 10h4l4 4v2h-8" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="18" r="2" /></svg></div><h3>납기 준수</h3><p>약속한 날짜에 맞춰 출고하고 진행 상황을 안내합니다.</p></article>
            <article className="feat"><div className="ico"><svg viewBox="0 0 24 24"><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5M10 13h6M10 17h4" /></svg></div><h3>명확한 거래</h3><p>kg 단가와 총액, 거래명세서까지 투명하게 정리합니다.</p></article>
          </div>
          <div className="banner reveal">
            <svg viewBox="0 0 24 24"><path d="M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2M9 15l-3-3 7-7c2-2 5-2 6-2 0 1 0 4-2 6l-7 7z" /><circle cx="15" cy="9" r="1.5" /></svg>
            <div><strong>문의에서 출고까지 끊김 없이 이어집니다.</strong><br /><span>발주요청 · 샘플(개발)요청 · 상담</span></div>
            <Link className="btn" to="/inquiry">발주 문의 <span className="ar">→</span></Link>
          </div>
        </div>
      </section>

      {/* AI ERP SHOWCASE */}
      <section className="sec" id="erp">
        <div className="wrap">
          <div className="center reveal">
            <span className="kicker">And More · STEEL119 AI ERP</span>
            <h2 className="sec-title">철강을 다루며 만든 ERP,<br />같은 업계와 함께 씁니다.</h2>
          </div>
          <Showcase />
        </div>
      </section>

      {/* PHOTO BAND */}
      <section className="photo-band on-dark">
        <div className="wrap reveal">
          <span className="kicker light">Steel Supply</span>
          <h2 style={{ marginTop: 12 }}>현장에 필요한 만큼,<br />필요한 규격으로.</h2>
          <p>강관, 열연·냉연 강판, 도금·컬러 강판, 알루미늄, 스테인리스까지. 철강 자재를 소량으로 공급하고 원하는 규격으로 가공합니다.</p>
          <ul className="check-list"><li>코일 · 판재 · 강관 소량 공급</li><li>절단 · 슬리팅 맞춤 가공</li><li>거래명세서 · 납품송장 발행</li></ul>
          <Link className="btn btn-red btn-lg" to="/company#products">취급 품목 보기 <span className="ar">→</span></Link>
        </div>
      </section>

      {/* ERP SUPPORT */}
      <section className="sec">
        <div className="wrap support">
          <div className="reveal">
            <span className="kicker">ERP Onboarding</span>
            <h2 style={{ marginTop: 12 }}>도입 지원</h2>
            <p>철강 회사의 업무 방식을 아는 팀이 ERP 도입과 데이터 이관을 함께합니다.</p>
            <ul className="check-list dark">
              <li>품목 · 거래처 · 기초재고 엑셀 일괄 등록</li>
              <li>사업장 · 사용자별 메뉴 권한 설정</li>
              <li>월 200,000원 + 사용자 1인당 5,000원</li>
            </ul>
            <Link className="btn btn-navy" style={{ marginTop: 28 }} to="/erp#pricing">요금 확인하기 <span className="ar">→</span></Link>
          </div>
          <div className="panel-card reveal"><LazyPanel name="balance" /></div>
        </div>
      </section>

      {/* CTA */}
      <section className="cta on-dark">
        <svg className="net" viewBox="0 0 1440 460" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <g><line x1="160" y1="110" x2="520" y2="200" /><line x1="520" y1="200" x2="760" y2="90" /><line x1="760" y1="90" x2="1080" y2="170" /><line x1="1080" y1="170" x2="1300" y2="80" /><line x1="520" y1="200" x2="420" y2="370" /><line x1="1080" y1="170" x2="980" y2="380" /><line x1="160" y1="110" x2="260" y2="330" /><line x1="1300" y1="80" x2="1260" y2="330" /></g>
          <g><circle className="dot" cx="160" cy="110" r="4" /><circle className="dot" cx="520" cy="200" r="4" /><circle className="dot" cx="760" cy="90" r="4" /><circle className="dot" cx="1080" cy="170" r="4" /><circle className="dot" cx="1300" cy="80" r="4" /><circle className="dot" cx="420" cy="370" r="4" /><circle className="dot" cx="980" cy="380" r="4" /><circle className="dot" cx="260" cy="330" r="4" /><circle className="dot" cx="1260" cy="330" r="4" /><circle className="pulse" cx="760" cy="90" r="6" /><circle className="pulse" cx="260" cy="330" r="6" style={{ animationDelay: '1.2s' }} /></g>
          <g><text x="176" y="104">INCHEON</text><text x="536" y="194">DANGJIN</text><text x="776" y="84">SEOUL</text><text x="1096" y="164">POHANG</text><text x="1316" y="74">ULSAN</text><text x="276" y="324">GWANGYANG</text><text x="996" y="374">BUSAN</text></g>
        </svg>
        <div className="wrap reveal">
          <span className="kicker light">Let&apos;s Connect</span>
          <h2>필요한 철강 자재가 있으신가요?</h2>
          <p>발주서 한 장이면 충분합니다. 스틸119이 재고부터 확인하겠습니다.</p>
          <div className="hero-cta"><Link className="btn btn-red btn-lg" to="/inquiry">발주 문의하기 <span className="ar">→</span></Link><a className="btn btn-line-light btn-lg" href="tel:16002579">전화 1600-2579</a></div>
        </div>
      </section>
    </>
  );
}
