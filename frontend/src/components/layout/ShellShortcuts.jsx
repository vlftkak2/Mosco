// 단축키: 셸 한 곳에서 받는다 (화면마다 따로 만들지 않음).
//  - 화면 동작(조회 · 추가 · 저장 …)은 헤더 리본의 같은 버튼을 누른 것과 똑같이 동작한다.
//    → 버튼이 꺼져 있으면(권한 · 상태) 단축키도 아무 일도 하지 않는다. 화면마다 따로 막을 필요 없음.
//  - 입력 중인 칸의 값이 먼저 반영되도록, 버튼을 누르기 전에 입력칸에서 포커스를 뺀다 (마우스로 누를 때와 같은 순서).
//  - 창(모달)이 열려 있으면 뒤 화면의 리본 · 탭 단축키는 받지 않는다.
//  - 화면이 이미 처리한 키(event.defaultPrevented, 예: F2 코드 도움)는 건드리지 않는다.
import { useEffect, useRef } from 'react';
import { Popover } from '@mantine/core';
import { IconBook } from '@tabler/icons-react';
import classes from '../../styles/layout/ShellShortcuts.module.css';

// 리본 버튼 (글자 = 리본 버튼 이름)
export const RIBBON_SHORTCUTS = [
  { label: '조회', keys: ['F3', 'F5'] },
  { label: '추가', keys: ['F4'] },
  { label: '복사', keys: ['Shift+F4'] },
  { label: '저장', keys: ['F8', 'Ctrl+S'] },
  { label: '삭제', keys: ['F9'] },
  { label: '엑셀', keys: ['Shift+F8'] },
  { label: '인쇄', keys: ['Ctrl+P'] },
];
const RIBBON_BY_KEY = Object.fromEntries(RIBBON_SHORTCUTS.flatMap((item) => item.keys.map((key) => [key, item.label])));
// 브라우저 기본 동작(새로고침 · 페이지 저장 · 페이지 인쇄)은 ERP 안에서 쓸 일이 없어 항상 막는다 (새로고침하면 열린 탭이 모두 닫힘)
const ALWAYS_BLOCK = new Set(['F5', 'Ctrl+S', 'Ctrl+P', 'F1']);

const HELP_GROUPS = [
  { title: '화면 동작', rows: RIBBON_SHORTCUTS.map((item) => [item.label, item.keys]) },
  {
    title: '탭 · 메뉴',
    rows: [
      ['메뉴 검색', ['/']],
      ['이전 · 다음 탭', ['Alt+PgUp', 'Alt+PgDn']],
      ['현재 탭 새로고침', ['Alt+R']],
      ['현재 탭 닫기', ['Alt+W']],
      ['대시보드', ['Alt+Home']],
      ['내메뉴 1 ~ 9번째', ['Alt+1~9']],
    ],
  },
  { title: '입력', rows: [['코드 도움 (거래처 · 품목 칸)', ['F2']], ['단축키 보기', ['F1']]] },
];

// 누른 키 → 'Shift+F4' · 'Ctrl+S' · 'Alt+1' 같은 이름 (글자 · 숫자는 자판 위치로: 한글 입력 상태여도 같게)
const comboOf = (event) => {
  const { code, key } = event;
  let name = key;
  if (/^Key[A-Z]$/.test(code)) name = code.slice(3);
  else if (/^Digit\d$/.test(code)) name = code.slice(5);
  const mods = [(event.ctrlKey || event.metaKey) && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift'].filter(Boolean);
  return [...mods, name].join('+');
};
const modalOpen = () => Boolean(document.querySelector('.mantine-Modal-content, [role="dialog"][aria-modal="true"]'));
const isOn = (button) => button && !button.disabled && !button.hasAttribute('data-disabled');
const ribbonButton = (container, label) => [...(container?.querySelectorAll('button') || [])]
  .find((button) => button.textContent.trim() === label);

// actionsRef: 헤더 리본이 들어 있는 상자 · handlers: { toggleHelp, prevTab, nextTab, refreshTab, closeTab, home, favorite(n) }
export function useShellShortcuts(actionsRef, handlers) {
  const handlersRef = useRef(handlers);
  useEffect(() => { handlersRef.current = handlers; });
  useEffect(() => {
    const onKey = (event) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.repeat) return;
      const combo = comboOf(event);
      const h = handlersRef.current;
      if (ALWAYS_BLOCK.has(combo)) event.preventDefault();
      if (combo === 'F1') { h.toggleHelp?.(); return; }
      const label = RIBBON_BY_KEY[combo];
      const tabAction = {
        'Alt+PageUp': h.prevTab, 'Alt+PageDown': h.nextTab, 'Alt+R': h.refreshTab, 'Alt+W': h.closeTab, 'Alt+Home': h.home,
      }[combo] || (/^Alt\+[1-9]$/.test(combo) ? () => h.favorite?.(Number(combo.slice(4)) - 1) : null);
      if (!label && !tabAction) return;
      event.preventDefault();
      if (modalOpen()) return;
      if (tabAction) { tabAction(); return; }
      const button = ribbonButton(actionsRef.current, label);
      if (!isOn(button)) return;
      // 입력 중인 칸의 값을 먼저 반영 (blur → 화면 상태 갱신) 한 뒤 버튼을 누른다
      const active = document.activeElement;
      if (active && active !== document.body && !actionsRef.current?.contains(active)) active.blur?.();
      window.setTimeout(() => { if (isOn(button) && button.isConnected) button.click(); }, 0);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actionsRef]);
}

// 리본 버튼에 마우스를 올리면 단축키가 보이게 (화면이 리본을 바꿀 때마다 다시 붙인다)
export function useRibbonShortcutTitles(actionsRef, deps) {
  useEffect(() => {
    const container = actionsRef.current;
    if (!container) return undefined;
    const apply = () => RIBBON_SHORTCUTS.forEach(({ label, keys }) => {
      const button = ribbonButton(container, label);
      const title = `${label} (${keys.join(' · ')})`;
      if (button && button.title !== title) button.title = title;
    });
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(container, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, deps);   // eslint-disable-line react-hooks/exhaustive-deps
}

const Keys = ({ keys }) => <span className={classes.keys}>
  {keys.map((combo, index) => <span key={combo} className={classes.combo}>
    {index > 0 && <i className={classes.or}>/</i>}
    {combo.split('+').map((part) => <kbd key={part}>{part}</kbd>)}
  </span>)}
</span>;

// 헤더의 키보드 버튼 + 단축키 표 (F1 로도 열고 닫음)
export function ShortcutHelp({ opened, onChange }) {
  return <Popover opened={opened} onChange={onChange} position="bottom-end" offset={8} width={330} shadow="md" withinPortal>
    <Popover.Target>
      <button type="button" className={classes.btn} title="단축키 (F1)" aria-label="단축키 보기 (F1)" aria-expanded={opened}
        data-expanded={opened || undefined} onClick={() => onChange(!opened)}>
        <IconBook size={18} stroke={2} />
      </button>
    </Popover.Target>
    <Popover.Dropdown className={classes.pop}>
      <div className={classes.head}><b>단축키</b><span>꺼진 버튼은 단축키도 동작하지 않습니다</span></div>
      {HELP_GROUPS.map((group) => <section key={group.title} className={classes.group}>
        <h4>{group.title}</h4>
        {group.rows.map(([name, keys]) => <div key={name} className={classes.row}><span>{name}</span><Keys keys={keys} /></div>)}
      </section>)}
    </Popover.Dropdown>
  </Popover>;
}
