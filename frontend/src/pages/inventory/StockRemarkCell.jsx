import { createContext, memo, useContext, useState } from 'react';
import classes from '../../styles/pages/StockRemark.module.css';

// 현재고 비고 칸.
// - 입력값은 칸이 스스로 들고 있어 글자를 칠 때 표 전체가 다시 그려지지 않는다.
// - 바뀐 값은 RemarkContext.change 로 화면(ref)에 모으고, 리본 [저장]으로 한 번에 저장한다.
// - ↑/↓ 또는 Enter 로 위·아래 행 비고로 옮긴다 (한글 입력 조합 중 Enter 는 무시).
export const RemarkContext = createContext(null);

export const lotKey = (item) => `${item.sourcetype}:${item.sourceno}:${item.sourceline}`;

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
  return <input
    data-remark-input
    className={`${classes.remarkInput} ${dirty ? classes.remarkDirty : ''}`}
    aria-label="비고"
    title={value || '비고 입력 (↑↓ · Enter 로 이동, 리본 [저장]으로 저장)'}
    value={value}
    maxLength={500}
    onChange={(event) => {
      const next = event.currentTarget.value;
      setValue(next);
      context?.change(item, next);
    }}
    onKeyDown={(event) => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === 'ArrowDown' || event.key === 'Enter') { event.preventDefault(); moveFocus(event.currentTarget, 1); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); moveFocus(event.currentTarget, -1); }
      else if (event.key === 'Escape') { setValue(original); context?.change(item, original); }
    }}
    // 비고 칸 더블클릭은 글자 선택용 (행 더블클릭 = 원가 이력 창이 열리지 않게)
    onDoubleClick={(event) => event.stopPropagation()}
  />;
});

export default StockRemarkCell;
