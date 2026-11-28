// 엑셀식 입력 (가공관리 화면 공용): 셀 범위 선택 · 복사/잘라내기 · 범위 붙여넣기 · Ctrl+D 채우기 · Delete 지우기 · 행 삽입/복제 · Ctrl+↑/↓
// 매입등록(InboundRegisterPage)과 같은 동작. 화면은 칸 입력에 data 속성(행 키 · 칸 이름)만 달고, 값을 쓰는 규칙은 화면이 넘겨준다
// (값 쓰기는 모두 화면의 직접 입력 · 붙여넣기 규칙을 거친다 → 정합성은 화면 규칙 그대로).
//
// 범위는 DOM 클래스로만 칠한다 (다시 그리기 없음). 포커스는 시작 칸에 둔다.
import { useCallback, useEffect, useRef } from 'react';

const parseMatrix = (text) => String(text || '').replace(/\r/g, '').split('\n')
  .filter((line, index, all) => line || index < all.length - 1).map((line) => line.split('\t'));
const isMultiCell = (text) => /[\t\n]/.test(String(text || '').replace(/\r?\n$/, ''));
const cssEscape = (value) => (window.CSS?.escape ? window.CSS.escape(String(value)) : String(value).replace(/["\\]/g, '\\$&'));

/**
 * @param {object} options
 * @param {{current: HTMLElement|null}} options.wrapRef  표를 감싼 요소
 * @param {string[]} options.rowKeys     화면 순서대로 행 키 (문자열)
 * @param {string[]} options.fields      화면 순서대로 칸 이름 (범위 · 복사 대상)
 * @param {string} [options.rowAttr='data-grid-row']   칸 입력의 행 키 속성
 * @param {string} [options.fieldAttr='data-grid-field'] 칸 입력의 칸 이름 속성
 * @param {(rowKey: string, field: string) => string} options.getCellText  복사 · 채우기 원본 글자
 * @param {(field: string) => boolean} [options.canWrite]   채우기 · 지우기 · 붙여넣기로 쓸 수 있는 칸
 * @param {(cells: {rowKey: string, field: string, text: string, sourceKey?: string}[], mode: 'fill'|'clear') => void} [options.writeCells]
 *        채우기(fill)는 sourceKey(원본 행)를 함께 준다 → 코드·이름 짝처럼 글자로 옮기면 안 되는 칸은 원본 행에서 그대로 복사
 * @param {(rowKey: string, field: string, text: string) => void} [options.pasteText]  붙여넣기 (모자란 행 추가는 화면이 정한다)
 * @param {(rowKey: string, field: string, duplicate: boolean) => void} [options.insertRow]  Ctrl+Enter · Ctrl+Shift+Enter
 * @param {(field: string) => void} [options.appendRow]  마지막 행에서 Enter
 * @param {boolean} [options.rowAttrOnRow]  행 키 속성을 칸 입력이 아니라 줄(tr)에 단 화면
 * @param {boolean} [options.commitFocusedFirst]  칸을 벗어날 때 값을 확정하는 칸이 있는 화면 (쓰기 전에 먼저 확정)
 * @param {boolean} [options.enterMoves]  Enter / Shift+Enter 로 아래·위 행 (화면에 Enter 이동이 없을 때)
 * @param {(rowKey: string, field: string) => void} [options.focusCell]  (가상 스크롤 표) 보이지 않는 칸으로 이동
 * @param {string[]} [options.checkedRowKeys]  체크한 행 (Ctrl+D: 현재 칸 값을 아래 체크한 행들에)
 * @param {boolean} [options.disabled]
 * @param {string} options.rangeClass  범위 칸(td)에 붙일 클래스
 */
export default function useExcelGrid(options) {
  // 그릴 때마다 최신 값으로 (칸이 확정된 직후의 상태를 바로 읽도록 effect 가 아니라 여기서 넣는다)
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const rangeRef = useRef(null);   // { anchorKey, anchorColumn, focusKey, focusColumn }
  const activeRef = useRef(null);  // { rowKey, field }
  const paintedRef = useRef(new Set());
  const frameRef = useRef(0);

  const attrs = () => ({ row: optionsRef.current.rowAttr || 'data-grid-row', field: optionsRef.current.fieldAttr || 'data-grid-field' });
  // rowAttrOnRow: 행 키를 칸 입력이 아니라 그 줄(tr)에 단 화면
  const cellOf = (element) => {
    const { row, field } = attrs();
    const onRow = optionsRef.current.rowAttrOnRow;
    const input = element instanceof Element ? element.closest(onRow ? `[${field}]` : `[${row}][${field}]`) : null;
    if (!input || !optionsRef.current.wrapRef.current?.contains(input)) return null;
    const rowKey = onRow ? input.closest(`tr[${row}]`)?.getAttribute(row) : input.getAttribute(row);
    const raw = input.getAttribute(field);
    return rowKey == null ? null : { rowKey, field: optionsRef.current.fieldAliases?.[raw] || raw, input };
  };
  // fieldAliases: 같은 열에 행마다 다른 칸 이름이 있는 화면 (예: 원소재 줄 sourceqty = 수량 열 qty)
  const inputAt = (rowKey, field) => {
    const { row, field: fieldAttr } = attrs();
    const aliases = optionsRef.current.fieldAliases || {};
    const names = [field, ...Object.keys(aliases).filter((name) => aliases[name] === field)];
    const selector = names.map((name) => (optionsRef.current.rowAttrOnRow
      ? `tr[${row}="${cssEscape(rowKey)}"] [${fieldAttr}="${cssEscape(name)}"]`
      : `[${row}="${cssEscape(rowKey)}"][${fieldAttr}="${cssEscape(name)}"]`)).join(', ');
    return optionsRef.current.wrapRef.current?.querySelector(selector) || null;
  };
  // commitFocusedFirst: 칸을 벗어날 때 값을 확정하는 칸이 있는 화면 → 먼저 포커스를 빼 확정시키고, 다음 차례(다시 그린 뒤)에 쓴 다음 그 칸으로 돌아온다
  const withCommittedFocus = (run) => {
    const element = document.activeElement;
    if (!optionsRef.current.commitFocusedFirst || !(element instanceof HTMLElement) || !optionsRef.current.wrapRef.current?.contains(element)) { run(); return; }
    element.blur();
    window.setTimeout(() => { run(); element.focus(); }, 0);
  };
  const bounds = () => {
    const range = rangeRef.current;
    if (!range) return null;
    const { rowKeys } = optionsRef.current;
    const anchor = rowKeys.indexOf(range.anchorKey);
    const focus = rowKeys.indexOf(range.focusKey);
    if (anchor < 0 || focus < 0) return null;
    return { top: Math.min(anchor, focus), bottom: Math.max(anchor, focus), left: Math.min(range.anchorColumn, range.focusColumn), right: Math.max(range.anchorColumn, range.focusColumn), focus };
  };
  const isMulti = (b = bounds()) => Boolean(b && (b.top !== b.bottom || b.left !== b.right));

  const paint = useCallback(() => {
    frameRef.current = 0;
    paintedRef.current.forEach((cell) => cell.classList.remove(optionsRef.current.rangeClass));
    paintedRef.current.clear();
    const b = bounds();
    if (!isMulti(b)) return;
    const { rowKeys, fields, rangeClass } = optionsRef.current;
    for (let r = b.top; r <= b.bottom; r += 1) {
      for (let c = b.left; c <= b.right; c += 1) {
        const cell = inputAt(rowKeys[r], fields[c])?.closest('td');
        if (cell) { cell.classList.add(rangeClass); paintedRef.current.add(cell); }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const schedulePaint = useCallback(() => {
    if (rangeRef.current && !frameRef.current) frameRef.current = requestAnimationFrame(paint);
  }, [paint]);
  const clearRange = useCallback(() => {
    if (!rangeRef.current && !paintedRef.current.size) return;
    rangeRef.current = null;
    paint();
  }, [paint]);
  // 행이 바뀌면(추가 · 삭제 · 다시 그리기) 범위를 다시 칠한다
  useEffect(() => { schedulePaint(); }, [options.rowKeys, schedulePaint]);
  useEffect(() => () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); }, []);

  const rangeFields = (b) => optionsRef.current.fields.slice(b.left, b.right + 1);
  const writable = (field) => (optionsRef.current.canWrite ? optionsRef.current.canWrite(field) : true);

  const fillDown = () => {
    const o = optionsRef.current;
    const active = activeRef.current;
    if (!active || o.disabled || !o.writeCells) return;
    const b = bounds();
    const activeIndex = o.rowKeys.indexOf(active.rowKey);
    if (activeIndex < 0) return;
    const fields = (b ? rangeFields(b) : [active.field]).filter(writable);
    let source;
    let targets;
    if (b && b.bottom > b.top) {
      source = o.rowKeys[b.top];
      targets = o.rowKeys.slice(b.top + 1, b.bottom + 1);
    } else if (o.checkedRowKeys?.length) {
      const checked = new Set(o.checkedRowKeys);
      source = active.rowKey;
      targets = o.rowKeys.filter((key, index) => index > activeIndex && checked.has(key));
    } else {
      source = o.rowKeys[activeIndex - 1];
      targets = [active.rowKey];
    }
    if (source == null || !targets.length || !fields.length) return;
    const cells = targets.flatMap((rowKey) => fields.map((field) => ({ rowKey, field, text: o.getCellText(source, field), sourceKey: source })));
    o.writeCells(cells, 'fill');
  };
  const clearCells = () => {
    const o = optionsRef.current;
    const b = bounds();
    if (!b || o.disabled || !o.writeCells) return;
    const fields = rangeFields(b).filter(writable);
    const cells = o.rowKeys.slice(b.top, b.bottom + 1).flatMap((rowKey) => fields.map((field) => ({ rowKey, field, text: '' })));
    if (cells.length) o.writeCells(cells, 'clear');
  };
  const copyText = () => {
    const o = optionsRef.current;
    const b = bounds();
    if (!b) return '';
    return o.rowKeys.slice(b.top, b.bottom + 1)
      .map((rowKey) => rangeFields(b).map((field) => String(o.getCellText(rowKey, field) ?? '').replace(/[\t\r\n]+/g, ' ')).join('\t'))
      .join('\n');
  };
  const focusCell = (rowKey, field) => {
    const input = inputAt(rowKey, field);
    if (input) { input.focus(); return; }
    optionsRef.current.focusCell?.(rowKey, field);
  };

  const onFocusCapture = useCallback((event) => {
    const cell = cellOf(event.target);
    if (!cell) return;
    const previous = activeRef.current;
    activeRef.current = { rowKey: cell.rowKey, field: cell.field };
    if (previous?.rowKey !== cell.rowKey || previous?.field !== cell.field) clearRange();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearRange]);

  const onKeyDownCapture = useCallback((event) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229 || event.altKey) return;
    const o = optionsRef.current;
    const ctrl = event.ctrlKey || event.metaKey;
    const { key } = event;
    if (ctrl && key.toLowerCase() === 'd') event.preventDefault();   // 브라우저 즐겨찾기로 넘기지 않는다
    const cell = cellOf(event.target);
    if (!cell) return;
    activeRef.current = { rowKey: cell.rowKey, field: cell.field };
    const stop = () => { event.preventDefault(); event.stopPropagation(); };
    const arrow = key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight';

    if (event.shiftKey && !ctrl && arrow) {
      const target = event.target;
      if ((key === 'ArrowLeft' || key === 'ArrowRight') && !isMulti() && target instanceof HTMLInputElement && !target.readOnly && target.selectionStart !== null) {
        const { selectionStart: start, selectionEnd: end, value } = target;
        const allSelected = start === 0 && end === value.length;
        if (!allSelected && (key === 'ArrowLeft' ? start !== 0 : end !== value.length)) return;
      }
      const column = o.fields.indexOf(cell.field);
      if (column < 0) return;
      const range = rangeRef.current || { anchorKey: cell.rowKey, anchorColumn: column, focusKey: cell.rowKey, focusColumn: column };
      const focusIndex = o.rowKeys.indexOf(range.focusKey);
      if (focusIndex < 0) return;
      const nextIndex = Math.max(0, Math.min(o.rowKeys.length - 1, focusIndex + (key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : 0)));
      const nextColumn = Math.max(0, Math.min(o.fields.length - 1, range.focusColumn + (key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0)));
      stop();
      rangeRef.current = { ...range, focusKey: o.rowKeys[nextIndex], focusColumn: nextColumn };
      paint();
      const focusTd = inputAt(o.rowKeys[nextIndex], o.fields[nextColumn])?.closest('td');
      if (focusTd) focusTd.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      else o.focusCell && requestAnimationFrame(schedulePaint);
      return;
    }
    if (ctrl && !event.shiftKey && (key === 'ArrowUp' || key === 'ArrowDown')) {
      if (!o.rowKeys.length) return;
      stop();
      focusCell(o.rowKeys[key === 'ArrowUp' ? 0 : o.rowKeys.length - 1], cell.field);
      return;
    }
    if (ctrl && key.toLowerCase() === 'd') { stop(); withCommittedFocus(fillDown); return; }
    if (ctrl && key === 'Enter') {
      stop();
      if (!o.disabled) o.insertRow?.(cell.rowKey, cell.field, event.shiftKey);
      return;
    }
    if (key === 'Delete' && !ctrl && isMulti()) { stop(); withCommittedFocus(clearCells); return; }
    if (key === 'Escape' && rangeRef.current) clearRange();
    const listOpen = event.target.getAttribute?.('aria-expanded') === 'true';   // 자동완성 목록이 열려 있으면 Enter 는 목록 선택
    if (key === 'Enter' && !ctrl && !listOpen) {
      const index = o.rowKeys.indexOf(cell.rowKey);
      if (!event.shiftKey && o.appendRow && !o.disabled && index === o.rowKeys.length - 1) {
        stop();
        o.appendRow(cell.field);
      } else if (o.enterMoves) {
        // Enter / Shift+Enter: 아래 · 위 행 같은 칸
        const next = index + (event.shiftKey ? -1 : 1);
        if (next >= 0 && next < o.rowKeys.length) { stop(); focusCell(o.rowKeys[next], cell.field); }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paint, schedulePaint, clearRange]);

  const onMouseDownCapture = useCallback((event) => {
    const cell = cellOf(event.target);
    if (!event.shiftKey || !cell) { if (rangeRef.current) clearRange(); return; }
    const o = optionsRef.current;
    const active = activeRef.current;
    if (!active) return;
    const anchorColumn = o.fields.indexOf(active.field);
    const focusColumn = o.fields.indexOf(cell.field);
    if (anchorColumn < 0 || focusColumn < 0) return;
    event.preventDefault();
    rangeRef.current = {
      anchorKey: rangeRef.current?.anchorKey ?? active.rowKey, anchorColumn: rangeRef.current?.anchorColumn ?? anchorColumn,
      focusKey: cell.rowKey, focusColumn,
    };
    paint();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearRange, paint]);

  const onCopyCapture = useCallback((event) => {
    if (!isMulti()) return;
    event.preventDefault();
    event.clipboardData.setData('text/plain', copyText());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const onCutCapture = useCallback((event) => {
    if (!isMulti()) return;
    event.preventDefault();
    event.clipboardData.setData('text/plain', copyText());
    clearCells();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const onPasteCapture = useCallback((event) => {
    const o = optionsRef.current;
    if (o.disabled || !o.pasteText) return;
    const text = event.clipboardData.getData('text/plain');
    if (!isMulti()) {
      // 범위 없이 한 칸에서 엑셀 범위(탭·줄바꿈)를 붙여넣으면 그 칸부터. 값 하나는 칸 기본 붙여넣기
      const cell = cellOf(event.target);
      if (!cell || !isMultiCell(text)) return;
      event.preventDefault();
      event.stopPropagation();
      withCommittedFocus(() => o.pasteText(cell.rowKey, cell.field, text));
      return;
    }
    const b = bounds();
    event.preventDefault();
    event.stopPropagation();
    const startKey = o.rowKeys[b.top];
    const startField = o.fields[b.left];
    if (isMultiCell(text)) { withCommittedFocus(() => o.pasteText(startKey, startField, text)); return; }
    const value = text.replace(/\r?\n$/, '');
    if (!value.trim()) { withCommittedFocus(clearCells); return; }
    const line = Array(b.right - b.left + 1).fill(value).join('\t');
    withCommittedFocus(() => o.pasteText(startKey, startField, Array(b.bottom - b.top + 1).fill(line).join('\n')));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    gridProps: { onFocusCapture, onKeyDownCapture, onMouseDownCapture, onCopyCapture, onCutCapture, onPasteCapture, onScrollCapture: schedulePaint },
    clearRange,
  };
}

export { parseMatrix, isMultiCell };
