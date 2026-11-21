import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Group, Loader, Modal, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconFileInvoice, IconPencil, IconPrinter, IconRestore, IconTruckDelivery, IconX } from '@tabler/icons-react';
import bar from '../../styles/pages/OutboundPrintDocument.module.css';

// 매출등록 > 거래명세서 / 송장 출력.
// - 출력할 때마다 서버에서 저장된 전표를 다시 읽는다 (화면에서 고치고 저장하지 않은 값은 출력되지 않는다).
// - 거래명세서: 금액 포함. 송장: 납품 수량·중량과 인수 확인 중심, 금액 없음.
// - 송장은 출하증(공급자 보관) · 인수증(받는 곳 보관). 품목이 적으면 A4 한 장에 위아래로(절취선), 많으면 각 한 장씩 새 쪽.
// - 매입단가와 기타비용은 어느 서류에도 표시하지 않는다.
// - 미리보기와 인쇄가 같은 CSS(DOC_CSS)를 쓴다. 인쇄는 서류만 담은 숨은 iframe 으로 해서 화면의 다른 요소가 섞이지 않는다.

export const DOCUMENT_KINDS = { statement: '거래명세서', delivery: '송장' };
const MIN_ROWS = { statement: 12, delivery: 12 };
// 송장: 품목이 이 개수 이하이면 A4 한 장에 출하증(위) + 인수증(아래), 넘으면 출하증 · 인수증 각 한 장
const DELIVERY_COMPACT_MAX_ITEMS = 8;

const DOC_CSS = `
.s119doc{width:794px;min-height:1080px;margin:0 auto;padding:40px 36px 34px;background:#fff;color:#1c2b3f;font-family:'Malgun Gothic','맑은 고딕',Pretendard,Arial,sans-serif;font-size:11px;line-height:1.45;box-sizing:border-box}
.s119doc *{box-sizing:border-box}
.s119doc-top{position:relative;display:flex;align-items:flex-start;justify-content:center;min-height:52px;margin-bottom:16px}
.s119doc-title{margin:4px 0 0;color:#1f5fd1;font-size:25px;font-weight:800;letter-spacing:12px;text-indent:12px}
.s119doc-kind{position:absolute;top:0;left:0;color:#4a5a70;font-size:10.5px;font-weight:700;letter-spacing:1px}
.s119doc-no{position:absolute;top:0;right:0;text-align:right;color:#4a5a70;font-size:10.5px;line-height:1.8}
.s119doc-no b{color:#1c2b3f;font-weight:700}
.s119doc-parties{width:100%;border-collapse:collapse;table-layout:fixed;border:1px solid #8eaadf;margin-bottom:12px}
.s119doc-parties th.head{height:28px;padding:5px 8px;border:1px solid #b3c7ea;background:#eaf1fc;color:#24426e;font-weight:700;text-align:center;letter-spacing:4px}
.s119doc-parties th.label{padding:4px 8px;border:1px solid #e1e7ef;background:#f6f8fb;color:#56677e;font-weight:400;text-align:left;white-space:nowrap}
.s119doc-parties td{height:26px;padding:4px 8px;border:1px solid #e1e7ef;word-break:break-all}
.s119doc-parties .split{border-left:1px solid #8eaadf}
.s119doc-sum{width:100%;border-collapse:collapse;table-layout:fixed;border:1px solid #8eaadf;margin-bottom:12px}
.s119doc-sum th{padding:9px 12px;border:1px solid #b3c7ea;background:#eaf1fc;color:#24426e;font-size:12px;font-weight:700;text-align:center}
.s119doc-sum td{padding:9px 12px;border:1px solid #e1e7ef}
.s119doc-sum .value{text-align:center;font-size:16px;font-weight:800;letter-spacing:.5px}
.s119doc-sum .part{color:#56677e;font-size:10.5px;white-space:nowrap}
.s119doc-sum .part b{margin-left:6px;color:#1c2b3f;font-weight:600}
.s119doc-table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:10px;border-top:1px solid #8eaadf;border-bottom:1px solid #8eaadf}
.s119doc-table th{height:27px;padding:4px 3px;border:1px solid #c9d6ea;background:#eaf1fc;color:#24426e;font-weight:700;text-align:center;white-space:nowrap}
.s119doc-table td{height:25px;padding:3px 4px;border:1px solid #dfe5ee;vertical-align:middle;overflow:hidden;word-break:break-all}
.s119doc-table .c{text-align:center}
.s119doc-table .r{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.s119doc-table .sub{display:block;margin-top:1px;color:#7a889b;font-size:9.5px}
.s119doc-table .basis{color:#7a889b;font-size:9px;margin-left:2px}
.s119doc-table tfoot td{height:28px;background:#f3f6fb;font-weight:700}
/* 바깥 테두리: 같은 1px 이면 칸 선(회색)이 표 선을 이기므로, 가장자리 칸의 선 색을 직접 지정해 한 색으로 맞춘다 */
.s119doc-parties tr>:first-child,.s119doc-sum tr>:first-child,.s119doc-table tr>:first-child{border-left-color:#8eaadf}
.s119doc-parties tr>:last-child,.s119doc-sum tr>:last-child,.s119doc-table tr>:last-child{border-right-color:#8eaadf}
.s119doc-parties thead tr:first-child>*,.s119doc-sum tr:first-child>*,.s119doc-table thead tr:first-child>*{border-top-color:#8eaadf}
.s119doc-parties tbody tr:last-child>*,.s119doc-sum tr:last-child>*,.s119doc-table tfoot tr:last-child>*{border-bottom-color:#8eaadf}
.s119doc-parties .split{border-left-color:#8eaadf}
.s119doc-sign{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:22px;padding-top:12px;border-top:1px solid #c9d6ea;color:#3d4f67}
.s119doc-sign div{display:flex;align-items:flex-end;gap:8px}
.s119doc-sign i{flex:1;border-bottom:1px solid #8a9ab0;height:18px}
.s119doc-receive{margin-top:18px;border:1px solid #8eaadf}
.s119doc-receive-head{padding:6px 10px;background:#eaf1fc;border-bottom:1px solid #b3c7ea;color:#24426e;font-weight:700}
.s119doc-receive-body{padding:10px 14px;line-height:2.3;color:#3d4f67}
.s119doc-receive-body div{display:flex;align-items:flex-end;gap:8px}
.s119doc-receive-body i{display:inline-block;min-width:120px;border-bottom:1px solid #8a9ab0;height:18px}
.s119doc-note{margin-top:14px;color:#7a889b;font-size:9.5px}
/* 송장 한 장 양식: 출하증 · 인수증을 반쪽씩 */
.s119doc-compact .s119doc-top{min-height:34px;margin-bottom:8px}
.s119doc-compact .s119doc-title{margin-top:0;font-size:20px;letter-spacing:10px;text-indent:10px}
.s119doc-compact .s119doc-no{font-size:9.5px;line-height:1.6}
.s119doc-compact .s119doc-parties{margin-bottom:8px}
.s119doc-compact .s119doc-parties th.head{height:21px;padding:2px 8px}
.s119doc-compact .s119doc-parties th.label,.s119doc-compact .s119doc-parties td{height:20px;padding:2px 8px;font-size:10px}
.s119doc-compact .s119doc-table th{height:21px;padding:2px 3px}
.s119doc-compact .s119doc-table td{height:20px;padding:2px 4px;white-space:nowrap;text-overflow:ellipsis}
.s119doc-compact .s119doc-table tfoot td{height:21px}
.s119doc-compact .s119doc-receive{margin-top:8px}
.s119doc-compact .s119doc-receive-head{padding:3px 10px}
.s119doc-compact .s119doc-receive-body{padding:4px 12px;line-height:1.85}
.s119doc-compact .s119doc-receive-body i{height:15px}
.s119doc-compact .s119doc-sign{margin-top:6px;padding-top:6px}
.s119doc-compact .s119doc-sign i{height:15px}
.s119doc-cut{display:flex;align-items:center;gap:10px;margin:10px 0;color:#9aa6b6;font-size:9.5px;letter-spacing:2px}
.s119doc-cut::before,.s119doc-cut::after{content:'';flex:1;border-top:1px dashed #b7c3d4}
`;

const PRINT_CSS = `
/* 페이지 여백을 0 으로 두면 브라우저가 머리글·바닥글(주소·날짜·쪽번호)을 찍을 자리가 없어 나오지 않는다. 여백은 서류 안쪽 padding 으로 대신하고, 여러 장이면 장마다 반복한다. */
@page{size:A4 portrait;margin:0}
html,body{margin:0;padding:0;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.s119doc{width:100%;min-height:0;padding:10mm 9mm;-webkit-box-decoration-break:clone;box-decoration-break:clone}
.s119doc-table thead{display:table-header-group}
.s119doc-table tr{page-break-inside:avoid;break-inside:avoid}
.s119doc+.s119doc{break-before:page;page-break-before:always}
`;

const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });
const toNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};
const amount = (value) => Math.round(toNumber(value)).toLocaleString('ko-KR');
const quantity = (value) => toNumber(value).toLocaleString('ko-KR', { maximumFractionDigits: 3 });
const dimension = (value) => (toNumber(value) > 0 ? toNumber(value).toLocaleString('ko-KR', { maximumFractionDigits: 3 }) : '');
const text = (value) => String(value ?? '').trim();
const join = (...values) => values.map(text).filter(Boolean).join(' / ');
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const fileSafe = (value) => text(value).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60);

// 공급자·공급받는자 칸 (한 표로 그려 인쇄·PDF 에서도 선이 어긋나지 않게).
// 수정 모드이면 값을 바로 고칠 수 있다 (이번 출력에만 쓰이고 DB 에는 저장하지 않는다).
// rows: [label, field, value]  → 수정한 값은 `${side}.${field}` 로 보관되어 거래명세서·송장 전환 후에도 유지된다.
function PartyTable({ left, right, edits }) {
  const cells = (party, row, split) => {
    if (!row) return [<th key="l" className={`label${split ? ' split' : ''}`} />, <td key="v" />];
    const [label, field, value] = row;
    const key = `${party.side}.${field}`;
    const shown = edits.values[key] ?? text(value);
    return [
      <th key="l" className={`label${split ? ' split' : ''}`}>{label}</th>,
      <td key={`${key}:${edits.enabled}:${shown}`} contentEditable={edits.enabled || undefined} suppressContentEditableWarning
        className={edits.enabled ? 's119doc-editable' : undefined}
        onBlur={edits.enabled ? (event) => edits.change(key, event.currentTarget.textContent.trim()) : undefined}
        onKeyDown={edits.enabled ? (event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } } : undefined}>{shown}</td>,
    ];
  };
  const count = Math.max(left.rows.length, right.rows.length);
  return <table className="s119doc-parties">
    <colgroup><col style={{ width: 92 }} /><col /><col style={{ width: 92 }} /><col /></colgroup>
    <thead><tr><th className="head" colSpan={2}>{left.title}</th><th className="head split" colSpan={2}>{right.title}</th></tr></thead>
    <tbody>{Array.from({ length: count }, (_, index) => <tr key={index}>
      {cells(left, left.rows[index], false)}
      {cells(right, right.rows[index], true)}
    </tr>)}</tbody>
  </table>;
}

// 상세 표 칸: 수정 모드이면 바로 고칠 수 있다 (이번 출력에만 사용, DB 저장 안 함).
// field 키(`item.<순번>.<칸>`, 합계는 `total.<칸>`)로 보관해 거래명세서·송장 전환 후에도 유지된다. 금액·합계는 다시 계산하지 않는다.
function EditCell({ edits, field, value, className }) {
  const shown = edits.values[field] ?? value;
  const classNames = [className, edits.enabled && 's119doc-editable'].filter(Boolean).join(' ') || undefined;
  return <td key={`${field}:${edits.enabled}:${shown}`} className={classNames} contentEditable={edits.enabled || undefined} suppressContentEditableWarning
    onBlur={edits.enabled ? (event) => edits.change(field, event.currentTarget.textContent.trim()) : undefined}
    onKeyDown={edits.enabled ? (event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } } : undefined}>{shown}</td>;
}

function DocumentTop({ title, header, kindLabel }) {
  return <div className="s119doc-top">
    {kindLabel && <div className="s119doc-kind">{kindLabel}</div>}
    <h1 className="s119doc-title">{title}</h1>
    <div className="s119doc-no"><div><b>No. {header.receiptno}</b></div><div>출고일자 {text(header.receptdate).slice(0, 10)}</div></div>
  </div>;
}

// 두 서류 모두 합계금액 · 공급가액 · 세액을 보여준다.
function AmountSummary({ totals }) {
  return <table className="s119doc-sum">
    <colgroup><col style={{ width: 118 }} /><col /><col style={{ width: 150 }} /><col style={{ width: 130 }} /></colgroup>
    <tbody><tr>
      <th>합계금액</th>
      <td className="value">₩ {amount(totals.totalamt)}</td>
      <td className="part">공급가액<b>{amount(totals.supplyamt)}</b></td>
      <td className="part">세액<b>{amount(totals.vat)}</b></td>
    </tr></tbody>
  </table>;
}

const blankRows = (count, cells) => Array.from({ length: count }, (_, index) => <tr key={`blank-${index}`}>{Array.from({ length: cells }, (__, cell) => <td key={cell} />)}</tr>);

const supplierRows = (supplier) => [
  ['사업자번호', 'businessno', supplier.businessno], ['상호(법인명)', 'companyname', supplier.companyname], ['대표자', 'ceoname', supplier.ceoname],
  ['업태 / 종목', 'bizclass', join(supplier.businesstype, supplier.industry)], ['주소', 'address', supplier.address], ['연락처', 'phone', supplier.phone],
];
const buyerRows = (buyer) => [
  ['사업자번호', 'businessno', buyer.businessno], ['상호(법인명)', 'customername', buyer.customername], ['대표자', 'ceoname', buyer.ceoname],
  ['업태 / 종목', 'bizclass', join(buyer.businesstype, buyer.industry)], ['주소', 'address', buyer.address], ['연락처', 'phone', buyer.phone],
];

function StatementPaper({ document, edits }) {
  const { header, supplier, buyer, items, totals } = document;
  return <div className="s119doc">
    <DocumentTop title="거래명세서" header={header} />
    <PartyTable edits={edits}
      left={{ title: '공급자', side: 'supplier', rows: supplierRows(supplier) }}
      right={{ title: '공급받는자', side: 'buyer', rows: buyerRows(buyer) }} />
    <AmountSummary totals={totals} />
    <table className="s119doc-table">
      <colgroup>
        <col style={{ width: 22 }} /><col /><col style={{ width: 48 }} /><col style={{ width: 38 }} /><col style={{ width: 32 }} />
        <col style={{ width: 38 }} /><col style={{ width: 38 }} /><col style={{ width: 28 }} /><col style={{ width: 36 }} /><col style={{ width: 46 }} />
        <col style={{ width: 54 }} /><col style={{ width: 62 }} /><col style={{ width: 50 }} /><col style={{ width: 64 }} /><col style={{ width: 72 }} />
      </colgroup>
      <thead><tr><th>No</th><th>품명</th><th>강종</th><th>표면</th><th>두께</th><th>폭</th><th>길이</th><th>단위</th><th>수량</th><th>중량(kg)</th><th>단가</th><th>공급가액</th><th>세액</th><th>합계</th><th>비고</th></tr></thead>
      <tbody>
        {items.map((item, index) => {
          const cell = (name, value, className) => <EditCell edits={edits} field={`item.${item.lineno ?? index}.${name}`} value={value} className={className} />;
          return <tr key={item.lineno ?? index}>
            <td className="c">{index + 1}</td>
            {cell('itemname', text(item.itemname))}
            {cell('materialname', text(item.materialname))}
            {cell('surfacename', text(item.surfacename))}
            {cell('thickness', dimension(item.thickness), 'r')}
            {cell('width', dimension(item.width), 'r')}
            {cell('length', dimension(item.length), 'r')}
            {cell('qtyunitname', text(item.qtyunitname), 'c')}
            {cell('qty', quantity(item.qty), 'r')}
            {cell('weight', quantity(item.weight), 'r')}
            {cell('unitprice', amount(item.unitprice), 'r')}
            {cell('supplyamt', amount(item.supplyamt), 'r')}
            {cell('vat', amount(item.vat), 'r')}
            {cell('totalamt', amount(item.totalamt), 'r')}
            {cell('description', text(item.description))}
          </tr>;
        })}
        {blankRows(Math.max(0, MIN_ROWS.statement - items.length), 15)}
      </tbody>
      <tfoot><tr>
        <td className="c" colSpan={8}>합 계</td>
        <EditCell edits={edits} field="total.qty" value={quantity(totals.qty)} className="r" />
        <EditCell edits={edits} field="total.weight" value={quantity(totals.weight)} className="r" />
        <td />
        <EditCell edits={edits} field="total.supplyamt" value={amount(totals.supplyamt)} className="r" />
        <EditCell edits={edits} field="total.vat" value={amount(totals.vat)} className="r" />
        <EditCell edits={edits} field="total.totalamt" value={amount(totals.totalamt)} className="r" />
        <td />
      </tr></tfoot>
    </table>
    <div className="s119doc-sign">
      <div>공급자 확인<i /></div>
      <div>공급받는자 확인<i /></div>
    </div>
  </div>;
}

// 송장 두 장: 같은 내용 · 같은 수정값(edits)을 쓰고 제목만 다르다.
const DELIVERY_COPIES = ['출하증', '인수증'];

function DeliveryPaper({ document, edits, copy, compact = false }) {
  const { header, supplier, buyer, items, totals } = document;
  return <div className={compact ? 's119doc-copy s119doc-compact' : 's119doc'}>
    <DocumentTop title={copy} kindLabel="납품송장" header={header} />
    <PartyTable edits={edits}
      left={{ title: '공급자', side: 'supplier', rows: [
        ['상호(법인명)', 'companyname', supplier.companyname], ['사업자번호', 'businessno', supplier.businessno], ['주소', 'address', supplier.address],
        ['연락처', 'phone', supplier.phone], ['출고창고', 'warehouses', (header.warehouses || []).join(', ')],
      ] }}
      right={{ title: '받는 곳', side: 'buyer', rows: [
        ['상호(법인명)', 'customername', buyer.customername], ['담당자', 'manager', header.manager], ['주소', 'address', buyer.delivery_address ?? buyer.address],
        ['연락처', 'phone', buyer.phone], ['출고일자', 'receptdate', text(header.receptdate).slice(0, 10)],
      ] }} />
    <table className="s119doc-table">
      <colgroup>
        <col style={{ width: 24 }} /><col /><col style={{ width: 60 }} /><col style={{ width: 46 }} /><col style={{ width: 40 }} /><col style={{ width: 50 }} />
        <col style={{ width: 50 }} /><col style={{ width: 32 }} /><col style={{ width: 46 }} /><col style={{ width: 60 }} /><col style={{ width: compact ? 140 : 90 }} /><col style={{ width: 60 }} />
      </colgroup>
      <thead><tr><th>No</th><th>품명</th><th>강종</th><th>표면</th><th>두께</th><th>폭</th><th>길이</th><th>단위</th><th>수량</th><th>중량(kg)</th><th>제품번호</th><th>비고</th></tr></thead>
      <tbody>
        {items.map((item, index) => {
          const cell = (name, value, className) => <EditCell edits={edits} field={`item.${item.lineno ?? index}.${name}`} value={value} className={className} />;
          return <tr key={item.lineno ?? index}>
            <td className="c">{index + 1}</td>
            {cell('itemname', text(item.itemname))}
            {cell('materialname', text(item.materialname))}
            {cell('surfacename', text(item.surfacename))}
            {cell('thickness', dimension(item.thickness), 'r')}
            {cell('width', dimension(item.width), 'r')}
            {cell('length', dimension(item.length), 'r')}
            {cell('qtyunitname', text(item.qtyunitname), 'c')}
            {cell('qty', quantity(item.qty), 'r')}
            {cell('weight', quantity(item.weight), 'r')}
            {cell('productname', text(item.productname))}
            {cell('description', text(item.description))}
          </tr>;
        })}
        {blankRows(Math.max(0, (compact ? DELIVERY_COMPACT_MAX_ITEMS : MIN_ROWS.delivery) - items.length), 12)}
      </tbody>
      <tfoot><tr>
        <td className="c" colSpan={8}>합 계</td>
        <EditCell edits={edits} field="total.qty" value={quantity(totals.qty)} className="r" />
        <EditCell edits={edits} field="total.weight" value={quantity(totals.weight)} className="r" />
        <td colSpan={2} />
      </tr></tfoot>
    </table>
    {/* 출하증 = 출고자 확인, 인수증 = 인수자 확인 */}
    {(() => {
      const shipping = copy === '출하증';
      const verb = shipping ? '출고' : '인수';
      const when = <>{verb} 일시 : <i style={{ minWidth: 56 }} />년 <i style={{ minWidth: 32 }} />월 <i style={{ minWidth: 32 }} />일 <i style={{ minWidth: 32 }} />시</>;
      const who = <>{verb}자 : <i style={{ minWidth: compact ? 150 : 200 }} /> (인)</>;
      return <div className="s119doc-receive">
        <div className="s119doc-receive-head">{verb} 확인</div>
        <div className="s119doc-receive-body">
          <div>{shipping ? '위 품목을 위와 같이 출고합니다.' : '위 품목의 납품 수량과 제품 상태를 확인하고 인수합니다.'}</div>
          {/* 한 장 양식은 일시와 서명을 한 줄에 */}
          {compact ? <div>{when}<span style={{ marginLeft: 24 }} />{who}</div> : <><div>{when}</div><div>{who}</div></>}
        </div>
      </div>;
    })()}
    <div className="s119doc-sign">
      <div>차량번호<i /></div>
      <div>{copy === '인수증' ? '인수담당' : '출고담당'}<i /></div>
    </div>
  </div>;
}

// 송장: 품목이 적으면 한 장(출하증 / 절취선 / 인수증), 많으면 출하증 · 인수증 각 한 장
function DeliveryPapers({ document, edits }) {
  if (document.items.length <= DELIVERY_COMPACT_MAX_ITEMS) {
    return <div className="s119doc">
      <DeliveryPaper compact copy="출하증" document={document} edits={edits} />
      <div className="s119doc-cut">절 취 선</div>
      <DeliveryPaper compact copy="인수증" document={document} edits={edits} />
    </div>;
  }
  return DELIVERY_COPIES.map((copy) => <DeliveryPaper key={copy} copy={copy} document={document} edits={edits} />);
}

// 서류만 담은 숨은 iframe 에서 인쇄한다 (브라우저 인쇄 창에서 'PDF로 저장'도 가능).
function printPaper(papers, title) {
  const iframe = window.document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
  window.document.body.appendChild(iframe);
  const frameDocument = iframe.contentDocument;
  frameDocument.open();
  frameDocument.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${DOC_CSS}${PRINT_CSS}</style></head><body>${papers.innerHTML}</body></html>`);
  frameDocument.close();
  const frameWindow = iframe.contentWindow;
  let removed = false;
  const cleanup = () => { if (!removed) { removed = true; iframe.remove(); } };
  frameWindow.addEventListener('afterprint', () => window.setTimeout(cleanup, 300));
  window.setTimeout(() => {
    frameWindow.focus();
    frameWindow.print();
    window.setTimeout(cleanup, 60000);
  }, 120);
}

export default function OutboundPrintDocument({ opened, receiptno, initialKind = 'statement', onClose }) {
  const [kind, setKind] = useState(initialKind);
  const [document, setDocument] = useState(null);
  const requestIdRef = useRef(0);
  const paperRef = useRef(null);
  // 미리보기 안에서 고친 공급자·공급받는자 값 (이번 출력에만 사용, DB 저장 안 함)
  const [editing, setEditing] = useState(false);
  const [editValues, setEditValues] = useState({});
  const edits = { enabled: editing, values: editValues, change: (key, value) => setEditValues((current) => ({ ...current, [key]: value })) };

  // 버튼으로 연 서류 종류를 따라간다 (창 안에서는 자유롭게 전환).
  const [openedFor, setOpenedFor] = useState({ opened: false, initialKind });
  if (openedFor.opened !== opened || openedFor.initialKind !== initialKind) {
    setOpenedFor({ opened, initialKind });
    if (opened) { setKind(initialKind); setDocument(null); setEditing(false); setEditValues({}); }
  }
  const loading = opened && !document;

  useEffect(() => {
    if (!opened || !receiptno) return undefined;
    const requestId = ++requestIdRef.current;
    axios.get(`/api/outbound-register/receipts/${encodeURIComponent(receiptno)}/print`, authConfig())
      .then(({ data }) => { if (requestId === requestIdRef.current) setDocument(data.document); })
      .catch((error) => {
        if (requestId !== requestIdRef.current) return;
        notifications.show({ title: '출력 정보 조회 실패', message: error.response?.data?.detail || '출력할 전표 정보를 불러오지 못했습니다.', color: 'red' });
        onClose();
      });
    return () => { requestIdRef.current += 1; };
  }, [opened, receiptno, onClose]);

  const print = useCallback(() => {
    if (!paperRef.current || !document) return;
    // 수정 중인 칸이 있으면 먼저 확정한다 (입력한 글자는 이미 화면에 있으므로 그대로 인쇄된다).
    if (window.document.activeElement instanceof HTMLElement) window.document.activeElement.blur();
    const title = `${DOCUMENT_KINDS[kind]}_${fileSafe(document.buyer?.customername || document.header.customname)}_${document.header.receiptno}`;
    printPaper(paperRef.current, title);
  }, [document, kind]);

  return <Modal opened={opened} onClose={onClose} centered size="min(900px, calc(100vw - 32px))" padding={0} withCloseButton={false}
    styles={{ content: { display: 'flex', flexDirection: 'column', height: 'min(940px, calc(100dvh - 32px))', overflow: 'hidden', borderRadius: 10 }, body: { display: 'flex', flex: '1 1 0', minHeight: 0, flexDirection: 'column', padding: 0 } }}>
    <div className={bar.bar}>
      <div className={bar.titleBlock} tabIndex={-1} data-autofocus>
        <span className={bar.titleIcon}><IconPrinter size={18} stroke={1.9} /></span>
        <div className={bar.titleText}>
          <span className={bar.title}>출력 미리보기</span>
          <span className={bar.receipt}>{receiptno}</span>
        </div>
      </div>
      <div className={bar.kindTabs} role="tablist" aria-label="서류 종류">
        {[{ value: 'statement', label: '거래명세서', icon: IconFileInvoice }, { value: 'delivery', label: '송장', icon: IconTruckDelivery }].map(({ value, label, icon: Icon }) => (
          <button key={value} type="button" role="tab" aria-selected={kind === value} className={`${bar.kindTab} ${kind === value ? bar.kindTabActive : ''}`} onClick={() => setKind(value)}>
            <Icon size={15} stroke={1.9} />{label}
          </button>
        ))}
      </div>
      <div className={bar.actions}>
        {/* 자리를 항상 잡아 두고 보이기만 바꾼다: 칸 수정 직후 버튼이 생기며 옆 버튼이 밀려 클릭이 빗나가지 않게 */}
        <button type="button" className={bar.resetButton} onClick={() => setEditValues({})} tabIndex={Object.keys(editValues).length ? 0 : -1}
          aria-hidden={Object.keys(editValues).length ? undefined : true}
          style={{ visibility: Object.keys(editValues).length ? 'visible' : 'hidden' }}><IconRestore size={14} stroke={2} />원래대로</button>
        <button type="button" className={`${bar.editButton} ${editing ? bar.editButtonOn : ''}`} onClick={() => setEditing((value) => !value)} disabled={!document || loading}>
          {editing ? <IconCheck size={15} stroke={2.2} /> : <IconPencil size={15} stroke={1.9} />}{editing ? '수정 완료' : '정보 수정'}
        </button>
        <button type="button" className={bar.printButton} onClick={print} disabled={!document || loading}>
          <IconPrinter size={16} stroke={2} />인쇄 / PDF 저장
        </button>
        <span className={bar.divider} />
        <button type="button" className={bar.closeButton} onClick={onClose} aria-label="닫기" title="닫기"><IconX size={17} stroke={2} /></button>
      </div>
    </div>
    <div style={{ flex: '1 1 0', minHeight: 0, overflow: 'auto', padding: 20, background: '#eef1f5' }}>
      <style>{DOC_CSS}{'.s119doc{box-shadow:0 3px 14px #8c9db333}.s119doc+.s119doc{margin-top:20px}.s119doc-editable{outline:1px dashed #6f93d6;outline-offset:-3px;background:#fffbe6;cursor:text;min-height:21px}.s119doc-editable:focus{outline:2px solid #1f5fd1;background:#fff}'}</style>
      {editing && <Text size="xs" ta="center" mb={10} c="#8a6d1f" style={{ background: '#fff8e1', border: '1px solid #f1dfa8', borderRadius: 6, padding: '7px 10px', maxWidth: 794, margin: '0 auto 10px' }}>
        노란 칸을 눌러 공급자·공급받는자 정보와 상세 표 내용을 고칠 수 있습니다. 고친 값은 이번 출력에만 쓰이고 저장되지 않으며, 합계는 자동으로 다시 계산되지 않습니다.
      </Text>}
      {loading || !document
        ? <Group justify="center" mt={80}><Loader color="red" size="sm" /><Text size="sm" c="dimmed">저장된 전표를 불러오고 있습니다.</Text></Group>
        : <div ref={paperRef}>{kind === 'delivery'
          ? <DeliveryPapers document={document} edits={edits} />
          : <StatementPaper document={document} edits={edits} />}</div>}
    </div>
  </Modal>;
}
