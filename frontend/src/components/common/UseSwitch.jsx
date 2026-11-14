// 표 안의 사용여부 스위치 (켜짐 = 사용, 꺼짐 = 중지). 글자 없이 스위치만, 화면 낭독기는 aria-checked 로 읽는다. 일반코드 · 품목코드 관리에서 select 대신 쓴다.
// 표의 키보드 이동 · 붙여넣기는 그대로: inputRef 로 칸을 등록하고 onFocus · onKeyDown · onPaste 를 그대로 받는다.
// 누르거나 Space 를 누르면 바뀐다.
import classes from '../../styles/components/UseSwitch.module.css';

export default function UseSwitch({ checked, onToggle, disabled, inputRef, label, onFocus, onKeyDown, onPaste, ...rest }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} ref={inputRef} disabled={disabled}
    className={`${classes.switch} ${checked ? classes.on : classes.off}`}
    title={checked ? '사용' : '중지'} onClick={() => onToggle(!checked)} onFocus={onFocus} onKeyDown={onKeyDown} onPaste={onPaste} {...rest}>
    <span className={classes.track} aria-hidden="true"><span className={classes.thumb} /></span>
  </button>;
}
