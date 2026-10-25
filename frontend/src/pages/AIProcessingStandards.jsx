import { useMemo, useState } from 'react';
import { Box } from '@mantine/core';
import { IconChevronDown, IconInfoCircle, IconPlus, IconRefresh, IconDeviceFloppy, IconTrash, IconX } from '@tabler/icons-react';
import useErpPageRibbon from '../components/common/useErpPageRibbon';
import ErpBreadcrumb from '../components/common/ErpBreadcrumb';
import sharedClasses from '../styles/pages/ManagementShared.module.css';
import classes from '../styles/pages/AIOrderManage.module.css';

const STORAGE_KEY = 'steel119_processing_ux_v3_demo';

const initialModel = {
  coilWidths: [810, 814, 914, 1250],
  sheetSizes: [
    { id: 's914-2438', width: 914, length: 2438 },
    { id: 's1020-2438', width: 1020, length: 2438 },
    { id: 's1060-3048', width: 1060, length: 3048 },
    { id: 's1219-2438', width: 1219, length: 2438 },
    { id: 's1524-3048', width: 1524, length: 3048 },
  ],
  rules: [
    { id: 'rule-coil-demo', kind: 'coil', item: 'GIX 스켈프', customer: '거래처 A (예시)', policy: 'whole' },
  ],
  fields: {
    useExtra: false, extraLen: '100', coilTrimL: '', coilTrimR: '', coilMinSplit: '', coilCost: '',
    sheetKerf: '', sheetRemW: '', sheetRemL: '', sheetCost: '', sheetCostUnit: 'EA',
  },
};

const policyOptions = {
  coil: [
    ['whole', '원코일 전량 가공·출고'], ['no_mix', '다른 주문과 폭 조합 금지'],
    ['no_split', '중량 분할 금지'], ['reserve_remain', '남은 중량 일부 보관'],
  ],
  sheet: [
    ['no_rotate', '제품 90° 회전 금지'], ['no_mix', '다른 주문과 혼합 절단 금지'],
    ['standard_only', '표준 원판만 사용'], ['custom_length', '특수 길이 후보 검토'],
  ],
};

function copyInitial() {
  return JSON.parse(JSON.stringify(initialModel));
}

function loadInitial() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.coilWidths) && Array.isArray(saved.sheetSizes) && Array.isArray(saved.rules)) {
      return { ...copyInitial(), ...saved, fields: { ...copyInitial().fields, ...(saved.fields || {}) } };
    }
  } catch {
    // Local storage is optional for this UI mockup.
  }
  return copyInitial();
}

function formatNumber(value) {
  return Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
}

function MaterialTabs({ active, onChange }) {
  return (
    <div className={classes.materialTabs} role="tablist" aria-label="가공 소재 구분">
      <button type="button" role="tab" aria-selected={active === 'coil'} className={active === 'coil' ? classes.activeTab : ''} onClick={() => onChange('coil')}>
        <strong>코일 · 스켈프</strong><small>원코일 · 슬리팅 · 중량 분할</small>
      </button>
      <button type="button" role="tab" aria-selected={active === 'sheet'} className={active === 'sheet' ? classes.activeTab : ''} onClick={() => onChange('sheet')}>
        <strong>시트 · 판재</strong><small>표준 원판 · 정척 · 복수 규격</small>
      </button>
    </div>
  );
}

function SheetPreview({ sheet }) {
  if (!sheet) return <div className={classes.previewEmpty}>원판 규격을 등록하면 미리보기가 표시됩니다.</div>;
  const ratio = Math.min(150 / sheet.width, 180 / sheet.length);
  const sheetWidth = sheet.width * ratio;
  const sheetLength = sheet.length * ratio;
  const partWidth = 790.1 * ratio;
  const partLength = 2000 * ratio;
  const columns = Math.min(4, Math.max(1, Math.floor(sheet.width / 790.1)));
  const rows = Math.min(4, Math.max(1, Math.floor(sheet.length / 2000)));
  return (
    <svg className={classes.sheetSvg} viewBox={`0 0 ${sheetWidth + 28} ${sheetLength + 44}`} role="img" aria-label={`${formatNumber(sheet.width)} x ${formatNumber(sheet.length)} 원판 예시 미리보기`}>
      <rect x="14" y="10" width={sheetWidth} height={sheetLength} fill="#f1f4f7" stroke="#8da0b4" />
      {Array.from({ length: rows * columns }, (_, index) => {
        const x = 14 + (index % columns) * partWidth;
        const y = 10 + Math.floor(index / columns) * partLength;
        if (x + partWidth > 14 + sheetWidth || y + partLength > 10 + sheetLength) return null;
        return <rect key={index} x={x} y={y} width={partWidth} height={partLength} fill="#c9dced" stroke="#fff" strokeWidth="1.5" />;
      })}
      <text x={14 + sheetWidth / 2} y={sheetLength + 28} textAnchor="middle">{formatNumber(sheet.width)} × {formatNumber(sheet.length)} mm</text>
    </svg>
  );
}

function RuleModal({ rule, onClose, onSave }) {
  const [draft, setDraft] = useState(() => rule || { kind: 'coil', item: '', customer: '', policy: 'whole' });
  const options = policyOptions[draft.kind];
  const save = () => {
    if (!draft.item.trim()) return;
    onSave({ ...draft, item: draft.item.trim(), customer: draft.customer.trim() || '전체' });
  };
  return (
    <div className={classes.modalBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className={classes.modal} role="dialog" aria-modal="true" aria-labelledby="rule-modal-title">
        <header className={classes.modalHeader}><strong id="rule-modal-title">{rule ? '특별조건 수정' : '특별조건 추가'}</strong><button type="button" className={classes.iconButton} aria-label="닫기" onClick={onClose}><IconX size={18} /></button></header>
        <div className={classes.modalBody}>
          <div className={classes.formGrid}>
            <label>적용 소재<select value={draft.kind} onChange={(event) => { const kind = event.target.value; setDraft((current) => ({ ...current, kind, policy: policyOptions[kind][0][0] })); }}><option value="coil">코일 · 스켈프</option><option value="sheet">시트 · 판재</option></select></label>
            <label>품목 / 품목그룹<input autoFocus value={draft.item} placeholder="예: GIX 스켈프" onChange={(event) => setDraft((current) => ({ ...current, item: event.target.value }))} /></label>
            <label>거래처 (필요 시)<input value={draft.customer} placeholder="미입력 시 해당 품목 전체" onChange={(event) => setDraft((current) => ({ ...current, customer: event.target.value }))} /></label>
            <label>특별조건<select value={draft.policy} onChange={(event) => setDraft((current) => ({ ...current, policy: event.target.value }))}>{options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          </div>
          <p className={classes.modalHint}>특정 품목이나 거래처에만 적용할 예외 조건을 등록합니다. 일반 주문은 기본 분석 기준을 따릅니다.</p>
        </div>
        <footer className={classes.modalFooter}><button type="button" className={classes.button} onClick={onClose}>취소</button><button type="button" className={`${classes.button} ${classes.primaryButton}`} disabled={!draft.item.trim()} onClick={save}>저장</button></footer>
      </section>
    </div>
  );
}

export default function AIProcessingStandards() {
  useErpPageRibbon({ showPrint: false, useSaveColor: false });
  const [model, setModel] = useState(loadInitial);
  const [activeTab, setActiveTab] = useState('coil');
  const [newWidth, setNewWidth] = useState('');
  const [newSheet, setNewSheet] = useState({ width: '', length: '' });
  const [selectedSheetId, setSelectedSheetId] = useState(model.sheetSizes[0]?.id || null);
  const [modalRule, setModalRule] = useState(undefined);
  const [toast, setToast] = useState('');
  const selectedSheet = useMemo(() => model.sheetSizes.find((item) => item.id === selectedSheetId) || model.sheetSizes[0] || null, [model.sheetSizes, selectedSheetId]);
  const visibleRules = model.rules.filter((rule) => rule.kind === activeTab);
  const notify = (message) => { setToast(message); window.setTimeout(() => setToast(''), 2600); };
  const updateFields = (key, value) => setModel((current) => ({ ...current, fields: { ...current.fields, [key]: value } }));

  const addCoilWidth = () => {
    const width = Number(newWidth);
    if (!Number.isFinite(width) || width <= 0) return notify('0보다 큰 원코일 폭을 입력해 주세요.');
    if (model.coilWidths.includes(width)) return notify('이미 등록된 폭입니다.');
    setModel((current) => ({ ...current, coilWidths: [...current.coilWidths, width].sort((a, b) => a - b) }));
    setNewWidth('');
  };

  const addSheetSize = () => {
    const width = Number(newSheet.width);
    const length = Number(newSheet.length);
    if (width <= 0 || length <= 0) return notify('원판 폭과 길이를 모두 입력해 주세요.');
    if (model.sheetSizes.some((sheet) => sheet.width === width && sheet.length === length)) return notify('이미 등록된 원판 규격입니다.');
    const next = { id: `sheet-${Date.now()}`, width, length };
    setModel((current) => ({ ...current, sheetSizes: [...current.sheetSizes, next] }));
    setSelectedSheetId(next.id);
    setNewSheet({ width: '', length: '' });
  };

  const saveModel = () => {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(model)); notify('현재 브라우저에 목업 기준을 저장했습니다.'); }
    catch { notify('브라우저 저장을 사용할 수 없습니다.'); }
  };

  const resetModel = () => {
    setModel(copyInitial());
    setSelectedSheetId(initialModel.sheetSizes[0].id);
    setNewWidth('');
    setNewSheet({ width: '', length: '' });
    try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* Local storage is optional. */ }
    notify('예시 기준으로 초기화했습니다.');
  };

  const saveRule = (draft) => {
    setModel((current) => ({ ...current, rules: draft.id
      ? current.rules.map((item) => item.id === draft.id ? draft : item)
      : [...current.rules, { ...draft, id: `rule-${Date.now()}` }] }));
    setActiveTab(draft.kind);
    setModalRule(undefined);
  };

  const advancedInput = (label, field, unit, placeholder = '미등록') => (
    <label className={classes.field}>{label}<div className={classes.inputWithUnit}><input type="number" min="0" step="0.1" value={model.fields[field]} placeholder={placeholder} onChange={(event) => updateFields(field, event.target.value)} /><span>{unit}</span></div></label>
  );

  return (
    <Box className={`${sharedClasses.pageShell} ${classes.pageRoot}`}>
      <main className={classes.page}>
      <ErpBreadcrumb parent="가공솔루션" current="가공기준 관리" />
      <header className={classes.titleBar}>
        <div><h1>가공기준 관리 <span className={classes.mockBadge}>UI 목업</span></h1><p>자주 사용하는 원자재 규격과 특별한 작업조건을 등록합니다.</p></div>
        <div className={classes.titleActions}><button type="button" className={classes.button} onClick={resetModel}><IconRefresh size={15} />예시 초기화</button><button type="button" className={`${classes.button} ${classes.primaryButton}`} onClick={saveModel}><IconDeviceFloppy size={15} />기준 저장</button></div>
      </header>

      <div className={classes.notice}><IconInfoCircle size={18} /><span><strong>복잡한 가공방식은 미리 정하지 않습니다.</strong> 주문과 현재고를 기준으로 가공안을 비교하고, 회사별 예외 조건을 등록하는 화면 목업입니다.</span></div>
      <MaterialTabs active={activeTab} onChange={setActiveTab} />

      {activeTab === 'coil' ? <>
        <div className={classes.sectionIntro}><div><h2>코일 · 스켈프 기준</h2><p>실제 재고 폭은 자동 조회하고, 자주 쓰는 원코일 폭은 매입 후보 기준으로 관리합니다.</p></div><span className={classes.status}>현재고 자동 조회</span></div>
        <div className={classes.columns}>
          <section className={classes.panel}>
            <header className={classes.panelHeader}><strong>원코일 표준 폭</strong><span>신규 매입 후보 기준 · mm</span></header>
            <div className={classes.panelBody}>
              <p className={classes.muted}>등록된 폭은 매입 후보를 만들 때 참고합니다. 현재고 조회 범위에는 영향을 주지 않습니다.</p>
              <div className={classes.inlineEntry}><input type="number" min="1" step="1" aria-label="추가할 원코일 폭(mm)" placeholder="폭 입력" value={newWidth} onChange={(event) => setNewWidth(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addCoilWidth(); }} /><span>mm</span><button type="button" className={`${classes.button} ${classes.primaryButton}`} onClick={addCoilWidth}><IconPlus size={15} />폭 추가</button></div>
              <div className={classes.tokens}>{model.coilWidths.length ? model.coilWidths.map((width) => <span key={width} className={classes.token}><b>{formatNumber(width)}</b> mm <button type="button" aria-label={`${width}mm 삭제`} onClick={() => setModel((current) => ({ ...current, coilWidths: current.coilWidths.filter((value) => value !== width) }))}><IconX size={14} /></button></span>) : <span className={classes.empty}>등록된 폭이 없습니다.</span>}</div>
              <div className={classes.note}><strong>원코일 슬리팅 안내</strong><p>주문 폭을 기준으로 원코일의 절단 조합을 비교합니다. 최소 트리밍 폭과 중량 조건은 아래 상세 가공조건에서 설정할 수 있습니다.</p></div>
            </div>
            <footer className={classes.panelFooter}>표준 폭은 화면 목업 데이터이며 실제 매입·재고 정보와 연결되지 않습니다.</footer>
          </section>
          <section className={classes.panel}>
            <header className={classes.panelHeader}><strong>자동 검토 항목</strong><span>주문·현재고 기준 예시</span></header>
            <div className={classes.panelBody}>
              <ol className={classes.guideList}>
                <li><b>폭 기준 조회</b><span>등록한 폭과 보유 재고를 확인해 가공 후보를 구성합니다.</span></li>
                <li><b>중량 분할 및 일부 보관</b><span>필요 중량을 나누거나 남은 중량을 보관하는 조건을 비교합니다.</span></li>
                <li><b>다른 주문과 폭 조합</b><span>조합 가능 여부와 주문별 특별조건을 함께 검토합니다.</span></li>
              </ol>
              <div className={classes.exampleBox}><span className={classes.exampleLabel}>예시</span><span>폭 300mm 주문 2건이 있으면 원코일 폭 안에서 함께 슬리팅할 수 있는지 확인합니다.</span></div>
            </div>
          </section>
        </div>
      </> : <>
        <div className={classes.sectionIntro}><div><h2>시트 · 판재 기준</h2><p>표준 원판 규격을 등록하고 주문 길이와 절단 여유 조건을 설정합니다.</p></div><span className={classes.status}>원판 규격 미리보기</span></div>
        <div className={classes.columns}>
          <section className={classes.panel}>
            <header className={classes.panelHeader}><strong>표준 원판 규격</strong><span>폭 × 길이 · mm</span></header>
            <div className={classes.panelBody}>
              <p className={classes.muted}>구매할 수 있는 표준 원판 규격을 추가하세요.</p>
              <div className={classes.sheetEntry}><label>폭<input type="number" min="1" step="0.1" value={newSheet.width} placeholder="예: 1219" onChange={(event) => setNewSheet((current) => ({ ...current, width: event.target.value }))} /></label><span>×</span><label>길이<input type="number" min="1" step="0.1" value={newSheet.length} placeholder="예: 2438" onChange={(event) => setNewSheet((current) => ({ ...current, length: event.target.value }))} /></label><span>mm</span><button type="button" className={`${classes.button} ${classes.primaryButton}`} onClick={addSheetSize}><IconPlus size={15} />추가</button></div>
              <div className={classes.sheetSizeList}>{model.sheetSizes.map((sheet) => <div key={sheet.id} className={`${classes.sheetSizeRow} ${selectedSheet?.id === sheet.id ? classes.selectedSheet : ''}`}>
                <button type="button" className={classes.sheetPick} aria-pressed={selectedSheet?.id === sheet.id} onClick={() => setSelectedSheetId(sheet.id)}><span className={classes.radioDot} /><strong>{formatNumber(sheet.width)} × {formatNumber(sheet.length)} mm</strong><small>표준 원판</small></button>
                <button type="button" className={classes.iconButton} aria-label={`${sheet.width} x ${sheet.length} 삭제`} onClick={() => { const next = model.sheetSizes.filter((item) => item.id !== sheet.id); setModel((current) => ({ ...current, sheetSizes: next })); if (selectedSheet?.id === sheet.id) setSelectedSheetId(next[0]?.id || null); }}><IconTrash size={15} /></button>
              </div>)}{!model.sheetSizes.length && <div className={classes.empty}>등록된 원판 규격이 없습니다.</div>}</div>
              <label className={classes.checkLine}><input type="checkbox" checked={model.fields.useExtra} onChange={(event) => updateFields('useExtra', event.target.checked)} />주문 길이에 추가 여유분 적용</label>
              <div className={classes.extraLength}><span>추가 여유분</span><input type="number" min="0" step="1" disabled={!model.fields.useExtra} value={model.fields.extraLen} onChange={(event) => updateFields('extraLen', event.target.value)} /><span>mm</span></div>
            </div>
          </section>
          <section className={classes.panel}>
            <header className={classes.panelHeader}><strong>원판 선택 미리보기</strong><span>{selectedSheet ? `${formatNumber(selectedSheet.width)} × ${formatNumber(selectedSheet.length)} mm` : '선택된 원판 없음'}</span></header>
            <div className={classes.previewBody}><SheetPreview sheet={selectedSheet} /><div className={classes.previewCaption}>예시 절단 배치 · 품목 790.1 × 2,000mm 기준<br />실제 최적화 계산은 연결되지 않은 화면 목업입니다.</div></div>
            <footer className={classes.panelFooter}>복수 규격이 필요한 주문은 등록한 원판 후보를 기준으로 검토하는 흐름을 보여줍니다.</footer>
          </section>
        </div>
      </>}

      <section className={classes.panel}>
        <header className={classes.panelHeader}><div><strong>거래처 · 품목별 특별조건</strong><span className={classes.countBadge}>{visibleRules.length}건</span></div><button type="button" className={`${classes.button} ${classes.primaryButton}`} onClick={() => setModalRule(null)}><IconPlus size={15} />조건 추가</button></header>
        <div className={classes.tableScroll}><table className={classes.ruleTable}><thead><tr><th>구분</th><th>품목 / 품목그룹</th><th>거래처</th><th>특별조건</th><th>작업</th></tr></thead><tbody>
          {visibleRules.length ? visibleRules.map((rule) => <tr key={rule.id}><td><span className={classes.typeBadge}>{rule.kind === 'coil' ? '코일 · 스켈프' : '시트 · 판재'}</span></td><td>{rule.item}</td><td>{rule.customer || '전체'}</td><td>{policyOptions[rule.kind].find(([value]) => value === rule.policy)?.[1] || rule.policy}</td><td className={classes.rowActions}><button type="button" className={classes.textButton} onClick={() => setModalRule(rule)}>수정</button><button type="button" className={`${classes.textButton} ${classes.deleteText}`} onClick={() => { if (window.confirm('이 특별조건을 삭제할까요?')) setModel((current) => ({ ...current, rules: current.rules.filter((item) => item.id !== rule.id) })); }}>삭제</button></td></tr>) : <tr><td colSpan="5" className={classes.empty}>등록된 특별조건이 없습니다. 일반 주문은 기본 기준으로 검토합니다.</td></tr>}
        </tbody></table></div>
        <footer className={classes.panelFooter}>현재 {activeTab === 'coil' ? '코일 · 스켈프' : '시트 · 판재'} 조건만 표시합니다. 조건 추가 시 적용 소재를 바꿀 수 있습니다.</footer>
      </section>

      <details className={classes.advanced}>
        <summary><span><strong>상세 가공조건</strong><small>필요한 경우에만 입력하세요. 기본 상태에서는 접혀 있습니다.</small></span><IconChevronDown size={18} /></summary>
        {activeTab === 'coil' ? <div className={classes.advancedGrid}>
          {advancedInput('좌측 트리밍 여유', 'coilTrimL', 'mm')}{advancedInput('우측 트리밍 여유', 'coilTrimR', 'mm')}{advancedInput('최소 분할중량', 'coilMinSplit', 'kg')}{advancedInput('가공비', 'coilCost', '원/kg')}
          <p className={classes.advancedFoot}>트리밍·분할·가공비는 코일 작업 검토에 사용할 예시 항목입니다.</p>
        </div> : <div className={classes.advancedGrid}>
          {advancedInput('절단 간격 (Kerf)', 'sheetKerf', 'mm')}{advancedInput('잔재 최소 폭', 'sheetRemW', 'mm')}{advancedInput('잔재 최소 길이', 'sheetRemL', 'mm')}
          <label className={classes.field}>가공비<div className={classes.inputWithUnit}><input type="number" min="0" step="0.1" value={model.fields.sheetCost} placeholder="미등록" onChange={(event) => updateFields('sheetCost', event.target.value)} /><select value={model.fields.sheetCostUnit} onChange={(event) => updateFields('sheetCostUnit', event.target.value)}><option value="EA">원/EA</option><option value="CUT">원/절단</option><option value="KG">원/kg</option></select></div></label>
          <p className={classes.advancedFoot}>절단 간격, 잔재 기준, 가공비를 설정하는 UI 목업입니다.</p>
        </div>}
      </details>
      <footer className={classes.bottomNote}>이 화면은 UI 검토용 목업입니다. 저장값은 이 브라우저에만 남고 실제 ERP에는 반영되지 않습니다.<button type="button" className={`${classes.button} ${classes.primaryButton}`} onClick={saveModel}><IconDeviceFloppy size={15} />기준 저장</button></footer>
      {toast && <div className={classes.toast} role="status">{toast}</div>}
      {modalRule !== undefined && <RuleModal rule={modalRule || null} onClose={() => setModalRule(undefined)} onSave={saveRule} />}
      </main>
    </Box>
  );
}
