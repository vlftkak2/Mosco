import { Link } from 'react-router-dom';
import { PendingLink } from '../components/Toast';
import { usePageMeta } from '../hooks';

const GO_ICON = <span className="go"><svg viewBox="0 0 24 24"><path d="M7 17L17 7M8 7h9v9" /></svg></span>;
const MARQUEE = ['POSMAC', '각형강관', 'STAINLESS', '컬러강판', 'H-BEAM', '도금강판', 'ALUMINUM', '열연강판'];

function MarqueeSet({ hidden }) {
  return (
    <div aria-hidden={hidden || undefined}>
      {MARQUEE.flatMap((word) => [<span key={word}>{word}</span>, <i key={`${word}-dot`} />])}
    </div>
  );
}

export default function Company() {
  usePageMeta('회사소개 | 스틸119', '(주)모스코가 운영하는 소량 전문 철강 자재 서비스 스틸119을 소개합니다.');

  return (
    <>
      <section className="hero page-hero on-dark">
        <div className="wrap hero-grid">
          <div className="hero-in">
            <p className="crumb"><Link to="/">HOME</Link> / 회사소개</p>
            <h1>우리는 철강과 현장의<br /><em className="hl">연결</em>을 설계합니다.</h1>
            <p className="hero-lead">스틸119은 (주)모스코가 운영하는 소량 전문 철강 자재 서비스입니다.<br />자재 문의부터 견적, 가공, 출고까지. 그리고 그 흐름을 담은 AI ERP까지 만듭니다.</p>
            <div className="hero-cta"><Link className="btn btn-red btn-lg" to="/inquiry">발주 문의하기 <span className="ar">→</span></Link><a className="btn btn-line-light btn-lg" href="#products">취급 품목 보기</a></div>
          </div>
        </div>
      </section>

      <section className="sec">
        <div className="wrap split">
          <div className="split-sticky reveal">
            <span className="kicker">Who We Are</span>
            <h2 className="sec-title">철강 자재를 찾는 일에<br />집중할 수 있도록.</h2>
            <p className="sec-desc">필요한 자재를 찾고, 문의하고, 발주하는 과정은 생각보다 많은 시간이 듭니다. 스틸119은 그 과정을 줄여 고객이 본업에 집중할 수 있도록 돕습니다.</p>
            <p className="sec-desc">강관, 열연·냉연 강판, 도금·컬러 강판, 알루미늄, 스테인리스 등 다양한 품목을 다루며, 현장에서 쌓은 경험을 바탕으로 철강 업무용 AI ERP를 직접 개발해 운영하고 있습니다.</p>
          </div>
          <ol className="num-list reveal-group">
            <li><span className="n">01</span><div><h3>Small but Fast</h3><p>소량 주문도 규모와 상관없이 같은 속도로 대응합니다. 한 본, 한 장의 자재도 재고부터 확인합니다.</p></div></li>
            <li><span className="n">02</span><div><h3>Connected End to End</h3><p>상담 · 견적 · 발주 · 가공 · 출고 · 명세서까지 각 단계를 끊김 없이 연결합니다.</p></div></li>
            <li><span className="n">03</span><div><h3>Built on Data</h3><p>직접 쓰는 ERP의 재고·거래 데이터를 바탕으로 더 정확한 견적과 가공 조합을 제안합니다.</p></div></li>
            <li><span className="n">04</span><div><h3>With You, All the Way</h3><p>거래 이후에도 담당자가 끝까지 책임지고 안내합니다. 급한 문의는 1600-2579로 바로 연결됩니다.</p></div></li>
          </ol>
        </div>
      </section>

      <section className="sec sec-tint">
        <div className="wrap">
          <div className="reveal" style={{ textAlign: 'center' }}>
            <span className="kicker">How It Works</span>
            <h2 className="sec-title">문의에서 제품 수령까지 4단계</h2>
            <p className="sec-desc">발주서 한 장이면 시작할 수 있습니다.</p>
          </div>
          <div className="steps reveal-group">
            <div className="step"><b>01</b><h3>자재 문의 · 상담</h3><p>필요한 품목·규격·수량을 전달하거나 발주서를 보내주세요.</p></div>
            <div className="step"><b>02</b><h3>재고 확인 · 견적</h3><p>재고를 매칭해 견적서를 회신해드립니다.</p></div>
            <div className="step"><b>03</b><h3>발주 · 가공</h3><p>발주를 확정하면 필요한 절단·가공을 진행합니다.</p></div>
            <div className="step"><b>04</b><h3>출고 · 수령</h3><p>거래명세서를 확인하고 제품을 수령합니다.</p></div>
          </div>
        </div>
      </section>

      <section className="sec" id="products">
        <div className="wrap">
          <div className="reveal">
            <span className="kicker">Products</span>
            <h2 className="sec-title">필요한 철강 자재를<br />폭넓게 취급합니다.</h2>
          </div>
          <div className="product-grid reveal-group">
            <article className="product p-pipe"><small>STEEL PIPE</small><h3>강관 · 배관</h3><p>원형·각형 강관, 배관용 파이프</p></article>
            <article className="product p-plate"><small>HOT / COLD ROLLED</small><h3>열연 · 냉연 강판</h3><p>판재, 코일, 규격 절단 상담</p></article>
            <article className="product p-coat"><small>COATED STEEL</small><h3>도금 강판</h3><p>아연도금, 포스맥 등</p></article>
            <article className="product p-color"><small>COLOR STEEL</small><h3>컬러 강판</h3><p>색상·두께별 컬러 강판</p></article>
            <article className="product p-al"><small>ALUMINUM</small><h3>알루미늄</h3><p>판재 및 각종 규격재</p></article>
            <article className="product p-sts"><small>STAINLESS</small><h3>스테인리스</h3><p>STS 판재·파이프</p></article>
          </div>
          <p className="placeholder-note reveal">※ 품목별 세부 규격과 재고는 문의 시 확인해드립니다.</p>
        </div>
      </section>

      <section className="sec sec-tint">
        <div className="wrap">
          <div className="reveal"><span className="kicker">Business</span><h2 className="sec-title">스틸119의 사업 영역</h2></div>
          <div className="rows reveal-group">
            <Link className="row" to="/inquiry"><span className="idx">01</span><div><h3>철강 자재 유통 · 소량 공급</h3><p>현장에 필요한 만큼, 필요한 규격으로. 소량 자재를 빠르게 공급합니다.</p><div className="tags"><span>#소량주문</span><span>#재고확인</span><span>#당일출고</span></div></div>{GO_ICON}</Link>
            <Link className="row" to="/inquiry"><span className="idx">02</span><div><h3>절단 · 가공 서비스</h3><p>주문 규격에 맞춘 절단과 가공을 상담하고, 가공 조합을 검토해 로스를 줄입니다.</p><div className="tags"><span>#절단</span><span>#슬리팅</span><span>#가공상담</span></div></div>{GO_ICON}</Link>
            <Link className="row" to="/erp"><span className="idx">03</span><div><h3>철강 AI ERP</h3><p>철강 회사를 위한 ERP. 월 기본 200,000원 + 사용자 1인당 5,000원으로 시작하세요.</p><div className="tags"><span>#AI발주서인식</span><span>#재고·원장</span><span>#가공최적화</span></div></div>{GO_ICON}</Link>
          </div>
        </div>
      </section>

      <section className="marquee rev" aria-label="취급 품목">
        <div className="marquee-track">
          <MarqueeSet />
          <MarqueeSet hidden />
        </div>
      </section>

      <section className="cta on-dark">
        <div className="wrap reveal">
          <span className="kicker light">Contact</span>
          <h2>필요한 철강 자재가 있으신가요?</h2>
          <p>자재와 규격을 알려주시면 바로 상담을 시작합니다.</p>
          <div className="hero-cta">
            <Link className="btn btn-red btn-lg" to="/inquiry">발주 문의하기 <span className="ar">→</span></Link>
            <a className="btn btn-line-light btn-lg" href="tel:16002579">전화 1600-2579</a>
            <PendingLink className="btn btn-kakao btn-lg" msg="카카오톡 채널 주소는 등록 후 연결됩니다.">카카오톡 상담</PendingLink>
          </div>
        </div>
      </section>
    </>
  );
}
