import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box } from '@mantine/core';
import { IconArrowBack, IconAdjustments, IconInfoCircle, IconPlayerPlay, IconRefresh, IconX } from '@tabler/icons-react';
import ErpBreadcrumb from '../components/common/ErpBreadcrumb';
import useErpPageRibbon from '../components/common/useErpPageRibbon';
import sharedClasses from '../styles/pages/ManagementShared.module.css';
import classes from '../styles/pages/AIOrderOptimization.module.css';

const records = {
  coil: {
    amount: '7,000 KG',
    part: '몰받이-포스맥 · 0.45 × 600 × C',
    candidates: [
      { name: '보유 코일 A 가공', kind: '현재고 가공', spec: '0.45 × 1,250 × C', input: '7,500', output: '7,000', yield: '93.3', cost: 925, loss: '폐기 200 KG · 잔재 300 KG', reason: '현재고 활용 가능 · 총비용 최저', detail: '기존 재고를 사용해 주문을 충족하는 예시 후보입니다. 비용·납기 조건 재확인이 필요합니다.' },
      { name: '현재고 + 일부 매입', kind: '혼합 조달', spec: '보유 코일 + 신규 소재', input: '7,300', output: '7,000', yield: '95.9', cost: 938, loss: '폐기 100 KG · 잔재 200 KG', reason: '추가 매입 필요', detail: '일부 현재고로 공급하고 부족분을 구매하는 예시 조합입니다.' },
      { name: '신규 코일 B 매입', kind: '신규 매입', spec: '0.45 × 1,220 × C', input: '7,200', output: '7,000', yield: '97.2', cost: 948, loss: '폐기 80 KG · 잔재 120 KG', reason: '구매 납기 확인 필요', detail: '소재 폭 이용률은 높지만 구매 비용과 납기를 확인해야 합니다.' },
    ],
  },
  sheet: {
    amount: '90 EA',
    part: '냉연강판 · 0.8 × 300 × 600',
    candidates: [
      { name: '보유 원판 B 절단', kind: '현재고 가공', spec: '0.8 × 1,219 × 2,438', input: '39.25', output: '35.33', yield: '90.0', cost: 22, loss: '폐기 1.20 KG · 잔재 2.72 KG', reason: '총비용 최저 (가상)', detail: '원판 절단의 예상 비용이 가장 낮다고 가정한 화면 시안입니다.' },
      { name: '보유 원판 A 절단', kind: '현재고 가공', spec: '0.8 × 1,200 × 2,400', input: '45.22', output: '40.69', yield: '90.0', cost: 24, loss: '폐기 1.50 KG · 잔재 3.03 KG', reason: '다른 원판 규격 비교', detail: '다른 보유 원판을 활용하는 비교안입니다.' },
      { name: '신규 원판 매입', kind: '신규 매입', spec: '표준 원판 구매', input: '42.50', output: '40.69', yield: '95.7', cost: 26, loss: '폐기 0.80 KG · 잔재 1.01 KG', reason: '신규 견적 필요', detail: '신규 원판 구매안입니다. 가격은 가상입니다.' },
    ],
  },
};

const formatCost = (value) => `${Number(value).toLocaleString('ko-KR')}만원`;

function SheetLayout() {
  const width = 470;
  const height = 420;
  const pad = 20;
  const originalWidth = 1219;
  const originalLength = 2438;
  const partWidth = 300;
  const partLength = 600;
  const columns = 4;
  const rows = 4;
  const areaYield = (columns * rows * partWidth * partLength / (originalWidth * originalLength) * 100).toFixed(2);
  const drawWidth = width - pad * 2;
  const drawHeight = height - pad * 2;
  const scaleX = drawWidth / originalWidth;
  const scaleY = drawHeight / originalLength;
  const cells = Array.from({ length: columns * rows }, (_, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    return <g key={index}>
      <rect x={pad + column * partWidth * scaleX} y={pad + row * partLength * scaleY} width={partWidth * scaleX} height={partLength * scaleY} className={classes.productCut} />
      <text x={pad + (column + 0.5) * partWidth * scaleX} y={pad + (row + 0.5) * partLength * scaleY} className={classes.cellNumber}>{index + 1}</text>
    </g>;
  });

  return <div className={classes.sheetVisual}>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="원판 1,219 곱하기 2,438밀리미터에서 300 곱하기 600밀리미터 제품 16장을 절단하는 예시">
      <rect x={pad} y={pad} width={drawWidth} height={drawHeight} className={classes.sheetStock} />
      {cells}
      <text x={width / 2} y="13" className={classes.dimensionLabel}>원판 폭 1,219 mm (300 × 4 + 19)</text>
      <text x={width / 2} y={height - 3} className={classes.dimensionLabel}>원판 길이 2,438 mm (600 × 4 + 38)</text>
    </svg>
    <div className={classes.sheetFacts}>
      <strong>냉연강판 0.8T · 300 × 600mm</strong>
      <div>폭 방향: 300mm × 4열 → 잔여 폭 <b>19mm</b></div>
      <div>길이 방향: 600mm × 4행 → 잔여 길이 <b>38mm</b></div>
      <div>원판 1장당 생산: <b>16 EA</b></div>
      <div>면적 이용률: <b>{areaYield}%</b></div>
      <small>절단 간격·트리밍 0mm 가정. 실제 스크랩 중량은 별도 계산.</small>
    </div>
  </div>;
}

function CoilLayout({ selected }) {
  const stockWidth = selected === 2 ? 1220 : 1250;
  const remainingWidth = stockWidth - 1200;
  const yieldPercent = (1200 / stockWidth * 100).toFixed(2);
  return <>
    <div className={classes.coilVisual} aria-label={`원코일 ${stockWidth}밀리미터에서 600밀리미터 제품 2줄과 잔여 폭 ${remainingWidth}밀리미터`}>
      <div className={classes.coilLane}>600mm</div><div className={classes.coilLane}>600mm</div><div className={classes.coilOffcut} style={{ flexBasis: `${remainingWidth / stockWidth * 100}%` }} />
    </div>
    <div className={classes.visualStats}><span>폭 기준 이용률 {yieldPercent}%</span><span>미사용 폭 {remainingWidth}mm</span></div>
  </>;
}

function NoticeModal({ modal, onClose }) {
  useEffect(() => {
    if (!modal) return undefined;
    const closeOnEscape = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [modal, onClose]);

  if (!modal) return null;
  return <div className={classes.modalCover} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={classes.modal} role="dialog" aria-modal="true" aria-labelledby="optimization-modal-title">
      <header className={classes.modalHeader}><strong id="optimization-modal-title">{modal.title}</strong><button type="button" className={classes.iconButton} aria-label="닫기" onClick={onClose}><IconX size={17} /></button></header>
      <div className={classes.modalBody}>{modal.body}</div>
      <footer className={classes.modalFooter}><button type="button" className={`${classes.button} ${classes.primaryButton}`} onClick={onClose}>확인</button></footer>
    </section>
  </div>;
}

export default function AIOrderOptimization() {
  const navigate = useNavigate();
  useErpPageRibbon({ showPrint: false, useSaveColor: false });
  const [mode, setMode] = useState('coil');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [modal, setModal] = useState(null);
  const data = records[mode];
  const best = data.candidates[0];
  const selected = data.candidates[selectedIndex];
  const materialCost = Math.round(selected.cost * 0.92);

  const openModal = (title, body) => setModal({ title, body });

  return <Box className={`${sharedClasses.pageShell} ${classes.pageRoot}`}>
    <main className={classes.page}>
      <ErpBreadcrumb parent="가공솔루션" current="가공 최적화" />
      <div className={classes.toolbar}>
        <button type="button" className={classes.button} onClick={() => navigate('/AIOrderManage')}><IconArrowBack size={15} />주문서 관리</button>
        <button type="button" className={classes.button} onClick={() => openModal('재분석', '목업에서는 계산을 재실행하지 않습니다. 실제 API 연결 시 주문과 가용 재고를 다시 조회합니다.')}><IconRefresh size={15} />재분석</button>
        <button type="button" className={classes.button} onClick={() => openModal('적용 기준', '코일 슬리팅 · 시트 절단 / 총비용 최소 기준입니다. 설비 조건과 절단 간격은 실제 운영 시 가공기준 관리에서 가져오는 예시입니다.')}><IconAdjustments size={15} />적용 기준</button>
        <span className={classes.toolbarSpacer}>주문서 관리 → 가공 검토 · 예시 데이터</span>
        <button type="button" className={`${classes.button} ${classes.primaryButton}`} onClick={() => openModal('가공계획 선택', `${selected.name} 후보를 선택했습니다. 실제 저장이나 재고 예약은 수행하지 않습니다.`)}><IconPlayerPlay size={15} />가공계획 선택</button>
      </div>

      <section className={classes.panel}>
        <header className={classes.panelHeader}><strong>① 검토 대상 주문</strong><span className={`${classes.pill} ${classes.bluePill}`}>주문 확정</span><small className={classes.headerSpacer}>필요한 주문 정보만 표시</small></header>
        <div className={classes.summary}>
          <div className={classes.summaryValue}><label>주문번호 / 거래처</label><strong>AI2026102500002 · 금영</strong></div>
          <div className={classes.summaryValue}><label>납기일</label><strong>2026-11-08</strong></div>
          <label className={classes.summaryValue}>분석 대상 품목<select value={mode} onChange={(event) => { setMode(event.target.value); setSelectedIndex(0); }}><option value="coil">몰받이-포스맥 · 0.45 × 600 × C</option><option value="sheet">냉연강판 · 0.8 × 300 × 600</option></select></label>
          <div className={classes.summaryValue}><label>주문량</label><strong>{data.amount}</strong></div>
          <div className={classes.summaryValue}><label>최적화 기준</label><strong>총비용 최소</strong></div>
        </div>
      </section>

      <section className={classes.panel}>
        <header className={classes.panelHeader}><strong>② AI 추천 요약</strong><span className={`${classes.pill} ${classes.greenPill}`}>추천 1순위</span><small className={classes.headerSpacer}>결론부터 확인하고 아래에서 비교</small></header>
        <div className={classes.recommend}>
          <div className={classes.recommendBest}><div className={classes.recommendSubtitle}>가장 유리한 가공·조달 방법</div><strong>{best.name}</strong><p>{best.detail}</p></div>
          <div className={classes.metric}><span>예상 총비용</span><strong>{best.cost.toLocaleString('ko-KR')}<small> 만원</small></strong></div>
          <div className={classes.metric}><span>예상 생산중량</span><strong>{best.output}<small> KG</small></strong></div>
          <div className={classes.metric}><span>예상 수율</span><strong>{best.yield}<small> %</small></strong></div>
        </div>
      </section>

      <section className={classes.panel}>
        <header className={classes.panelHeader}><strong>③ 가공·조달 후보 비교</strong><span className={classes.pill}>{data.candidates.length}건</span><small className={classes.headerSpacer}>행 선택 시 하단 상세정보 변경</small></header>
        <div className={classes.tableScroll}><table className={classes.candidateTable}>
          <thead><tr><th className={classes.selectColumn}>선택</th><th>우선순위</th><th>가공·조달 방식</th><th>사용 소재</th><th className={classes.number}>투입량</th><th className={classes.number}>생산량</th><th className={classes.number}>수율</th><th className={classes.number}>로스중량</th><th className={classes.number}>예상 총비용</th><th>비고</th></tr></thead>
          <tbody>{data.candidates.map((candidate, index) => <tr key={`${mode}-${candidate.name}`} className={selectedIndex === index ? classes.chosenRow : ''} onClick={() => setSelectedIndex(index)}>
            <td className={classes.radioCell}><input type="radio" name="optimization-candidate" aria-label={`${candidate.name} 선택`} checked={selectedIndex === index} onChange={() => setSelectedIndex(index)} /></td>
            <td>{index === 0 ? <span className={classes.rankBadge}>추천 1순위</span> : `${index + 1}순위`}</td><td><strong>{candidate.name}</strong></td><td>{candidate.spec}</td>
            <td className={classes.number}>{candidate.input} KG</td><td className={classes.number}>{candidate.output} KG</td><td className={classes.number}>{candidate.yield}%</td><td className={classes.number}>{candidate.loss.match(/폐기 ([\d,.]+) KG/)?.[1] || '-'} KG</td><td className={classes.number}><strong>{formatCost(candidate.cost)}</strong></td><td>{candidate.reason}</td>
          </tr>)}</tbody>
        </table></div>
        <footer className={classes.panelFoot}>* 추천순위와 수치는 화면 디자인을 확인하기 위한 가상 값입니다. 실제 결과는 계산 엔진에서 전달받습니다.</footer>
      </section>

      <section className={classes.panel}>
        <details className={classes.costDetails}>
          <summary className={classes.panelHeader}><strong>④ 선택 후보 상세 및 원가</strong><span className={`${classes.pill} ${classes.bluePill}`}>{selected.name}</span><small className={classes.headerSpacer}>펼쳐서 세부 비용 확인</small><span className={classes.chevron}>⌄</span></summary>
          <div className={classes.detailsGrid}>
            <div><strong>중량 및 가공 정보</strong><div className={classes.detailRow}><span>투입중량</span><strong>{selected.input} KG</strong></div><div className={classes.detailRow}><span>생산중량</span><strong>{selected.output} KG</strong></div><div className={classes.detailRow}><span>폐기 및 재사용 잔재</span><strong>{selected.loss}</strong></div></div>
            <div><strong>원가 정보 (가상)</strong><div className={classes.detailRow}><span>재료비</span><strong>{formatCost(materialCost)}</strong></div><div className={classes.detailRow}><span>가공·부대비용</span><strong>{formatCost(selected.cost - materialCost)}</strong></div><div className={classes.detailRow}><span>회수가치 반영 후 총비용</span><strong>{formatCost(selected.cost)}</strong></div></div>
          </div>
        </details>
      </section>

      <section className={classes.panel}>
        <header className={classes.panelHeader}><strong>⑤ 절단 배치 시각화</strong><span className={classes.pill}>상세 참고</span><small className={classes.headerSpacer}>핵심 판단 정보 아래에 배치</small></header>
        <div className={classes.visualBody}>
          <div className={classes.visualTop}><strong>{mode === 'coil' ? '코일 슬리팅 · 폭 배치' : '시트·원판 절단 · 300 × 600 격자 배치'}</strong><span>{mode === 'coil' ? `원코일 폭 ${selectedIndex === 2 ? '1,220' : '1,250'}mm → 제품 600mm × 2줄` : '원판 1,219 × 2,438mm → 300 × 600mm · 폭 4열 × 길이 4행 = 16장'}</span></div>
          {mode === 'coil' ? <CoilLayout selected={selectedIndex} /> : <SheetLayout />}
          <div className={classes.legend}><span><i className={classes.productLegend} />생산 제품</span><span><i className={classes.offcutLegend} />남는 영역 (실제 폐기 여부 미확정)</span></div>
          <div className={classes.notice}><IconInfoCircle size={15} />{mode === 'coil'
            ? '배치는 시각화 예시입니다. 설비별 트리밍·칼 배열·선후단 손실과 잔재 재활용 여부를 반영하지 않았습니다.'
            : '배치는 레이아웃 확인용 예시이며 선택 후보와 실제 투입 수량이 정확히 연동된 계산 결과가 아닙니다. 절단 간격·트리밍·잔재는 별도 검증이 필요합니다.'}</div>
        </div>
      </section>
      <div className={classes.pageFootnote}>※ 본 문서는 UI 목업이며 실제 재고 예약, DB 저장, AI 분석은 하지 않습니다.</div>
    </main>
    <NoticeModal modal={modal} onClose={() => setModal(null)} />
  </Box>;
}
