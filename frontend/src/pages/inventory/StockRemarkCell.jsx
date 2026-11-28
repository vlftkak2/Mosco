import { createContext, memo, useContext, useEffect, useState } from 'react';
import classes from '../../styles/pages/StockRemark.module.css';

// 현재고 비고 칸.
// - 입력값은 칸이 스스로 들고 있어 글자를 칠 때 표 전체가 다시 그려지지 않는다.
// - 바뀐 값은 RemarkContext.change 로 화면(ref)에 모으고, 리본 [저장]으로 한 번에 저장한다.
// - ↑/↓ 또는 Enter 로 위·아래 행 비고로 옮긴다 (한글 입력 조합 중 Enter 는 무시).
export const RemarkContext = createContext(null);

export const lotKey = (item) => `${item.sourcetype}:${item.sourceno}:${item.sourceline}`;

// 화면에 그려진 비고 칸의 값 바꾸기 (엑셀 붙여넣기 · Ctrl+D 로 다른 행 비고를 바꿀 때). 값 모으기는 RemarkContext.change 가 한다.
const mountedSetters = new Map();
export const setRemarkInCell = (key, value) => mountedSetters.get(key)?.(value);

function moveFocus(input, step) {
  const inputs = [...(input.closest('tbody')?.querySelectorAll('input[data-remark-input]') || [])];
  const next = inputs[inputs.indexOf(input) + step];
  if (!next) return;
  next.focus();
  next.select();
  next.scrollIntoView({ block: 'nearest' });
}

const StockRemarkCell = memo(function StockRemarkCell({ item }) {
  const context = useContext(RemarkContext);
  const key = lotKey(item);
  const original = item.remark || '';
  const [value, setValue] = useState(() => context?.draftOf(key) ?? original);
  const dirty = value !== original;
  useEffect(() => {
    mountedSetters.set(key, setValue);
    return () => { if (mountedSetters.get(key) === setValue) mountedSetters.delete(key); };
  }, [key]);
  return <input
    data-remark-input
    className={`${classes.remarkInput} ${dirty ? classes.remarkDirty : ''}`}
    aria-label="비고"
    title={value || '비고 입력 (↑↓ · Enter 로 이동, Ctrl+D 윗행 값, 엑셀 여러 행 붙여넣기, 리본 [저장]으로 저장)'}
    value={value}
    maxLength={500}
    onChange={(event) => {
      const next = event.currentTarget.value;
      setValue(next);
      context?.change(item, next);
    }}
    onPaste={(event) => {
      // 엑셀 여러 행: 이 행부터 아래로 비고를 채운다 (줄마다 첫 칸). 값 하나는 칸 기본 붙여넣기
      const lines = event.clipboardData.getData('text/plain').replace(/\r/g, '').split('\n').filter((line, index, all) => line || index < all.length - 1);
      if (lines.length < 2 && !lines.some((line) => line.includes('\t'))) return;
      event.preventDefault();
      context?.pasteDown?.(item, lines.map((line) => line.split('\t')[0]));
    }}
    onKeyDown={(event) => {
      if (event.nativeEvent.isComposing) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
        // Ctrl+D: 바로 윗행 비고를 이 칸에 (엑셀과 같음)
        event.preventDefault();
        const above = context?.valueAbove?.(item);
        if (above !== undefined) { setValue(above); context.change(item, above); }
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'Enter') { event.preventDefault(); moveFocus(event.currentTarget, 1); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); moveFocus(event.currentTarget, -1); }
      else if (event.key === 'Escape') { setValue(original); context?.change(item, original); }
    }}
    // 비고 칸 더블클릭은 글자 선택용 (행 더블클릭 = 원가 이력 창이 열리지 않게)
    onDoubleClick={(event) => event.stopPropagation()}
  />;
});

export default StockRemarkCell;
