import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { DemoForm, PendingLink } from '../components/Toast';
import { reduceMotion, usePageMeta } from '../hooks';

const TYPES = [['order', '자재 발주 · 견적'], ['erp', 'AI ERP 도입'], ['ad', '광고 · 제휴']];
const typeFromHash = (hash) => (hash === '#erp' || hash === '#ad' ? hash.slice(1) : 'order');

// 히어로 오른쪽: 문의 작성 → 견적 회신 10초 애니메이션 반복 (key 를 바꿔 처음부터 다시 재생)
function InquiryAnimation() {
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (reduceMotion) return undefined;
    const timer = setInterval(() => setRound((r) => r + 1), 10500);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="iq-anim play" id="iq-anim" aria-hidden="true" key={round}>
      <div className="iq-form">
        <h4>발주 문의 <span>1분 접수</span></h4>
        <div className="iq-f t1"><small>필요 자재 (규격)</small><div><span>EGI 코일 1.0 × 160mm</span></div></div>
        <div className="iq-f t2"><small>수량</small><div><span>1 EA (약 277kg)</span></div></div>
        <div className="iq-f t3"><small>희망 납기</small><div><span>2026-11-19 · 화성 현장</span></div></div>
        <div className="iq-file"><i>PDF</i>발주서_샘플건설.pdf 첨부</div>
        <div className="iq-btn">문의 접수하기 →</div>
      </div>
      <div className="iq-steps"><span><i />접수</span><span><i />재고 확인</span><span><i />견적 회신</span></div>
      <div className="iq-reply">
        <div className="who"><i>119</i><span><b>스틸119 담당자</b> · 방금</span></div>
        <p className="msg">재고 확인 완료했습니다. 견적서 보내드립니다 🙂</p>
        <div className="iq-quote">
          <div><span>EGI 코일 1.0 × 160</span><span>277kg</span></div>
          <div><span>단가</span><span>1,000원/kg</span></div>
          <div className="tot"><span>합계 (VAT 별도)</span><b>277,000원</b></div>
        </div>
      </div>
    </div>
  );
}

// 발주서 첨부: 끌어놓기 또는 클릭해서 선택 (서버 연결 전이라 파일 이름만 보여준다)
function DropZone() {
  const [names, setNames] = useState('');
  const [over, setOver] = useState(false);
  const show = (files) => { if (files?.length) setNames([...files].map((f) => f.name).join(', ')); };
  const onDragOver = (e) => { e.preventDefault(); setOver(true); };
  const onDragLeave = (e) => { e.preventDefault(); setOver(false); };
  const onDrop = (e) => {
    e.preventDefault();
    setOver(false);
    const input = e.currentTarget.querySelector('input[type=file]');
    input.files = e.dataTransfer.files;
    show(input.files);
  };
  return (
    <label className={`drop${over ? ' is-over' : ''}`} onDragEnter={onDragOver} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <svg viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5M4 16v4h16v-4" /></svg>
      <span><b>{names || '파일을 끌어놓거나 클릭해 선택'}</b><small>이미지 · PDF · 엑셀 (서버 연결 후 전송됩니다)</small></span>
      <input type="file" name="files" multiple accept="image/*,.pdf,.xls,.xlsx" onChange={(e) => show(e.target.files)} />
    </label>
  );
}

const NUM_STYLE = { padding: '18px 0', gridTemplateColumns: '52px 1fr' };

export default function Inquiry() {
  usePageMeta('발주 문의 | 스틸119', '필요한 철강 자재와 규격, 발주서를 보내주시면 재고 확인 후 견적을 회신해드립니다.');

  // 주소가 /inquiry#erp, #ad 이면 해당 문의 유형을 먼저 선택한다
  const { hash } = useLocation();
  const [type, setType] = useState(() => typeFromHash(hash));
  const [seenHash, setSeenHash] = useState(hash);
  if (seenHash !== hash) { setSeenHash(hash); setType(typeFromHash(hash)); }

  return (
    <>
      <section className="hero page-hero inq-hero on-dark">
        <div className="wrap hero-grid">
          <div className="hero-in">
            <p className="crumb"><Link to="/">HOME</Link> / 발주 문의</p>
            <h1>발주서 한 장이면<br /><em className="hl">충분합니다.</em></h1>
            <p className="hero-lead">필요한 자재와 규격을 남기거나 발주서를 첨부해주세요.<br />담당자가 재고를 확인한 뒤 견적을 회신해드립니다.</p>
          </div>
          <InquiryAnimation />
        </div>
      </section>

      <section className="sec">
        <div className="wrap ni-grid">
          <div className="card reveal light-form">
            <span className="kicker">Order Inquiry</span>
            <div className="card-head"><h2>문의 접수</h2></div>
            <div className="seg" role="tablist" aria-label="문의 유형" style={{ marginTop: 20 }}>
              {TYPES.map(([value, label]) => (
                <button key={value} type="button" role="tab" aria-selected={type === value} onClick={() => setType(value)}>{label}</button>
              ))}
            </div>
            <DemoForm>
              <input type="hidden" id="inq-type" name="type" value={type} />
              <div className="form-2">
                <div className="field"><label htmlFor="f-company">회사명</label><input id="f-company" name="company" autoComplete="organization" placeholder="(주)회사명" /></div>
                <div className="field"><label htmlFor="f-name">담당자<em>*</em></label><input id="f-name" name="name" autoComplete="name" placeholder="홍길동" required /></div>
              </div>
              <div className="form-2">
                <div className="field"><label htmlFor="f-phone">연락처<em>*</em></label><input id="f-phone" name="phone" type="tel" autoComplete="tel" placeholder="010-0000-0000" required /></div>
                <div className="field"><label htmlFor="f-email">이메일</label><input id="f-email" name="email" type="email" autoComplete="email" placeholder="name@company.com" /></div>
              </div>
              <div hidden={type !== 'order'}>
                <div className="field"><label htmlFor="f-mat">필요 자재 (품목 · 규격)</label><input id="f-mat" name="material" placeholder="예) H빔 200 × 200 × 8 × 12" /></div>
                <div className="form-2" style={{ marginTop: 16 }}>
                  <div className="field"><label htmlFor="f-size">사이즈 · 수량</label><input id="f-size" name="size" placeholder="예) 길이 6m / 20본" /></div>
                  <div className="field"><label htmlFor="f-date">희망 납기</label><input id="f-date" name="due" type="date" /></div>
                </div>
                <div className="field" style={{ marginTop: 16 }}>
                  <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, marginBottom: 7 }}>발주서 첨부</span>
                  <DropZone />
                </div>
              </div>
              <div hidden={type !== 'erp'}>
                <div className="field"><label htmlFor="f-users">예상 사용 인원</label><select id="f-users" name="users"><option>1~5명</option><option>6~10명</option><option>11~20명</option><option>21명 이상</option></select></div>
              </div>
              <div className="field"><label htmlFor="f-msg">문의 내용</label><textarea id="f-msg" name="message" placeholder="추가 요청사항이나 궁금한 점을 적어주세요." /></div>
              <label className="consent"><input type="checkbox" required /><span><b>(필수)</b> 개인정보 수집 및 이용에 동의합니다</span><PendingLink msg="개인정보처리방침 전문은 준비 중입니다.">전문보기</PendingLink></label>
              <button className="btn btn-red" type="submit">문의 접수하기 <span className="ar">→</span></button>
              <p className="form-foot">급한 문의는 전화로<a href="tel:16002579">1600-2579</a></p>
            </DemoForm>
          </div>

          <div className="reveal" style={{ display: 'grid', gap: 20, alignContent: 'start' }}>
            <div className="card dark">
              <span className="kicker light">Direct Contact</span>
              <h2 style={{ marginTop: 8, fontSize: 26, fontWeight: 800 }}>바로 상담하기</h2>
              <p>전화나 카카오톡으로 더 빠르게 상담받으세요.</p>
              <div className="ft-call" style={{ textAlign: 'left', marginTop: 22 }}><small style={{ color: '#aeb7d0' }}>고객센터</small><a href="tel:16002579" style={{ fontSize: 40 }}>1600-2579</a></div>
              <PendingLink className="btn btn-kakao btn-lg" style={{ width: '100%', marginTop: 22 }} msg="카카오톡 채널 주소는 등록 후 연결됩니다.">카카오톡으로 바로 상담 <span className="ar">→</span></PendingLink>
            </div>
            <div className="card">
              <span className="kicker">Process</span>
              <ol className="num-list" style={{ marginTop: 12 }}>
                <li style={NUM_STYLE}><span className="n" style={{ fontSize: 24 }}>01</span><div><h3 style={{ fontSize: 16 }}>문의 접수</h3><p style={{ marginTop: 4, fontSize: 14 }}>자재·규격 또는 발주서 전달</p></div></li>
                <li style={NUM_STYLE}><span className="n" style={{ fontSize: 24 }}>02</span><div><h3 style={{ fontSize: 16 }}>재고 확인 · 견적 회신</h3><p style={{ marginTop: 4, fontSize: 14 }}>담당자가 재고 매칭 후 연락</p></div></li>
                <li style={NUM_STYLE}><span className="n" style={{ fontSize: 24 }}>03</span><div><h3 style={{ fontSize: 16 }}>발주 확정 · 가공 · 출고</h3><p style={{ marginTop: 4, fontSize: 14 }}>거래명세서와 함께 제품 수령</p></div></li>
              </ol>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
