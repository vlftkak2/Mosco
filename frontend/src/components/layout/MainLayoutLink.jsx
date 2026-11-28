import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import usePointerSort from './usePointerSort';
import { HoverCard } from '@mantine/core';
import {
  IconChevronDown, IconChevronUp, IconChevronsDown, IconChevronsUp, IconGripVertical, IconMoon, IconStar, IconStarFilled, IconSun,
} from '@tabler/icons-react';
import classes from '../../styles/layout/MainLayoutLink.module.css';
import { preloadPage } from '../../utils/pagePreload';

// 메뉴에 마우스를 올리거나 포커스하면 그 화면 코드를 미리 받는다 → 누르면 바로 열림
const preloadProps = (link) => (link ? { onPointerEnter: () => preloadPage(link), onFocus: () => preloadPage(link) } : {});

function normalizePath(path) {
  return path === '/' ? path : String(path || '').replace(/\/+$/, '').toLowerCase();
}

function itemContainsPath(item, pathname) {
  if (item.link && normalizePath(item.link) === normalizePath(pathname)) return true;
  return (item.links || []).some((child) => itemContainsPath(child, pathname));
}

// 네비 아이콘 선 굵기: 대메뉴 아이콘(MainLayout 의 ic.stroke)과 같은 값
const ICON_STROKE = 2.25;
const includesText = (value, query) => String(value || '').toLowerCase().includes(query);
// 메뉴 누르기: 화면이면 그 화면으로, 동작(action)이면 그 동작 (AI 업무비서 → 오른쪽 대화창 열기)
const openItem = (item, navigate) => {
  if (item.action === 'ai-assistant') { window.dispatchEvent(new Event('open-ai-assistant')); return; }
  if (item.link) navigate(item.link);
};
const AiBadge = ({ item }) => (item?.ai ? <span className={classes.ai}>AI</span> : null);
// 전체메뉴 · 내메뉴가 같이 쓰는 메뉴 이름 (+AI 배지). 이름과 배지를 한 덩어리로 묶어 행의 gap 과 상관없이 간격은 배지의 3px 뿐.
// 배지가 있는 메뉴만 이름 칸에 최소 너비(--ai-nm, 두 목록 같은 값)를 줘서 모든 배지가 같은 x 에 선다.
const MenuName = ({ item }) => <span className={classes.lbl}>
  <span className={`${classes.nm} ${item?.ai ? classes.nmAi : ''}`}>{item.label}</span>
  {item?.ai && <span className={`${classes.ai} ${classes.aiInline}`}>AI</span>}
</span>;
// AI 배지 정렬: 배지 달린 메뉴 중 가장 긴 이름을 굵은 글자(700 · 13px)로 재서 --ai-nm 에 넣는다
// (굵은 글자 기준이라 메뉴를 골라 글자가 굵어져도 배지가 움직이지 않는다)
function alignAI(root, items) {
  if (!root) return;
  const labels = [];
  const walk = (list) => list.forEach((item) => { if (item.links) walk(item.links); else if (item.ai) labels.push(item.label); });
  walk(items);
  if (!labels.length) { root.style.removeProperty('--ai-nm'); return; }
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font-size:13px;font-weight:700;letter-spacing:normal';
  root.appendChild(probe);
  let width = 0;
  labels.forEach((label) => { probe.textContent = label; width = Math.max(width, probe.getBoundingClientRect().width); });
  probe.remove();
  root.style.setProperty('--ai-nm', `${Math.ceil(width)}px`);
}

// 메뉴 트리를 거른다: 대메뉴 > 섹션 > 화면. 검색어가 대메뉴나 섹션 이름과 맞으면 그 아래 화면은 모두 남긴다.
function filterTree(items, query) {
  return items.map((group) => {
    if (!group.links) return !query || includesText(group.label, query) ? group : null;
    const groupHit = query && includesText(group.label, query);
    const sections = (group.links || []).map((section) => {
      if (!Array.isArray(section.links)) {
        return !query || groupHit || includesText(section.label, query) ? section : null;
      }
      const sectionHit = groupHit || (query && includesText(section.label, query));
      const links = section.links.filter((link) => !query || sectionHit || includesText(link.label, query));
      return links.length ? { ...section, links } : null;
    }).filter(Boolean);
    return sections.length ? { ...group, links: sections } : null;
  }).filter(Boolean);
}

// 대메뉴 아래 화면만 펼친다 (섹션이 있어도 한 줄로)
const groupScreens = (group) => (group.links || []).flatMap((item) => (Array.isArray(item.links) ? item.links : [item]));

// 하위 메뉴 한 줄: 이름 (+AI) + (마우스를 올리면) 내메뉴 별
function MenuRow({ item, pathname, navigate, favorite, onToggleFavorite }) {
  const active = Boolean(item.link) && normalizePath(item.link) === normalizePath(pathname);
  const canStar = Boolean(item.MenuID) && !item.disabled && onToggleFavorite;
  return (
    <div className={`${classes.sm} ${active ? classes.on : ''} ${item.disabled ? classes.disabled : ''}`}>
      <button type="button" className={classes.smLink} aria-current={active ? 'page' : undefined} disabled={item.disabled || undefined}
        title={item.label} {...(item.disabled ? {} : preloadProps(item.link))} onClick={() => { if (!item.disabled) openItem(item, navigate); }}>
        <MenuName item={item} />
      </button>
      {canStar && (
        <button type="button" className={`${classes.star} ${favorite ? classes.starOn : ''}`}
          title={favorite ? '내메뉴에서 빼기' : '내메뉴에 추가'} aria-label={`${item.label} ${favorite ? '내메뉴에서 빼기' : '내메뉴에 추가'}`}
          aria-pressed={favorite} onClick={() => onToggleFavorite(item.MenuID)}>
          {favorite ? <IconStarFilled size={15} /> : <IconStar size={15} stroke={1.6} />}
        </button>
      )}
    </div>
  );
}

function MenuGroup({ group, open, onToggle, pathname, navigate, favorites, onToggleFavorite }) {
  const has = itemContainsPath(group, pathname);
  // 하위 없이 바로 열리는 대메뉴 (대시보드)
  if (!group.links) {
    return (
      <button type="button" className={`${classes.m} ${has ? classes.mOn : ''}`} aria-current={has ? 'page' : undefined}
        disabled={group.disabled || undefined} {...preloadProps(group.link)} onClick={() => { if (group.link) navigate(group.link); }}>
        <span className={classes.ic}>{group.icon}</span>
        <span className={classes.tx}>{group.label}</span>
      </button>
    );
  }
  const Chevron = open ? IconChevronUp : IconChevronDown;
  return (
    <div className={`${classes.g} ${open ? classes.open : ''} ${has ? classes.has : ''}`}>
      <button type="button" className={classes.m} aria-expanded={open} onClick={onToggle}>
        <span className={classes.ic}>{group.icon}</span>
        <span className={classes.tx}>{group.label}</span>
        <Chevron className={classes.chv} size={13} stroke={1.8} />
      </button>
      {open && (
        <div className={classes.subs}>
          {group.links.map((section) => (Array.isArray(section.links) ? (
            <div key={section.label}>
              <div className={classes.hd}>{section.label}</div>
              {section.links.map((link) => (
                <MenuRow key={link.label} item={link} pathname={pathname} navigate={navigate}
                  favorite={favorites.has(link.MenuID)} onToggleFavorite={onToggleFavorite} />
              ))}
            </div>
          ) : (
            <MenuRow key={section.label} item={section} pathname={pathname} navigate={navigate}
              favorite={favorites.has(section.MenuID)} onToggleFavorite={onToggleFavorite} />
          )))}
        </div>
      )}
    </div>
  );
}

// 내메뉴: 등록한 순서대로 한 줄씩 (별 · 이름 · 손잡이). 손잡이(점 여섯 개)를 끌거나 Alt+↑/↓ 로 순서를 바꾼다.
// 끄는 동안 원래 자리는 같은 크기의 빈 칸, 끄는 모습은 화면 위에 따로 띄운다 (탭 끌기와 같음).
function FavoriteList({ favoriteItems, pathname, navigate, onToggleFavorite, onReorder, query }) {
  const listRef = useRef(null);
  const canDrag = !query;
  const allIds = favoriteItems.map((item) => item.MenuID);
  const sort = usePointerSort({ ids: allIds, axis: 'y', containerRef: listRef, onCommit: (order) => onReorder?.(order), disabled: !canDrag });
  const byId = new Map(favoriteItems.map((item) => [item.MenuID, item]));
  const shown = sort.order.map((id) => byId.get(id)).filter(Boolean).filter((item) => !query || includesText(item.label, query));
  const draggingItem = sort.draggingId ? byId.get(sort.draggingId) : null;

  if (!favoriteItems.length) return <div className={classes.empty}>내 메뉴에 등록한 메뉴가 없습니다.<br />전체메뉴에서 별을 눌러 추가하세요.</div>;
  if (!shown.length) return <div className={classes.empty}>검색 결과가 없습니다.</div>;
  return (
    <div ref={listRef} className={classes.favList} onClickCapture={sort.onClickCapture}>
      {shown.map((item) => {
        // 끌리는 줄의 원래 자리: 같은 크기의 빈 칸 (별 · 이름 · 배지 없음)
        if (sort.draggingId === item.MenuID) return <div key={item.MenuID} data-sort-id={item.MenuID} className={classes.favPlaceholder} style={sort.placeholderSize} aria-hidden="true" />;
        const active = normalizePath(item.link) === normalizePath(pathname);
        return (
          <div key={item.MenuID} data-sort-id={item.MenuID} className={`${classes.fv} ${active ? classes.on : ''}`}>
            <button type="button" className={classes.fstar} title="내메뉴에서 빼기" aria-label={`${item.label} 내메뉴에서 빼기`}
              onClick={() => onToggleFavorite(item.MenuID)}><IconStarFilled size={15} /></button>
            <button type="button" className={classes.fvLink} aria-current={active ? 'page' : undefined} title={item.label}
              {...preloadProps(item.link)} onClick={() => openItem(item, navigate)}>
              <MenuName item={item} />
            </button>
            {canDrag && (
              // 끌기는 이 손잡이에서만 시작한다 (별 · 이름을 눌러도 끌리지 않음)
              <span className={classes.grip} tabIndex={0} role="button" title="끌어서 순서 변경 (Alt + ↑/↓)"
                aria-label={`${item.label} 순서 변경: Alt와 위/아래 방향키`}
                {...sort.handleProps(item.MenuID)}
                onKeyDown={(event) => {
                  if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
                  event.preventDefault();
                  const list = [...allIds];
                  const index = list.indexOf(item.MenuID);
                  const target = index + (event.key === 'ArrowUp' ? -1 : 1);
                  if (target < 0 || target >= list.length) return;
                  [list[index], list[target]] = [list[target], list[index]];
                  onReorder?.(list);
                }}>
                <IconGripVertical size={13} stroke={1.8} />
              </span>
            )}
          </div>
        );
      })}
      {/* 끌고 있는 줄: 화면 위에 따로 (그림자) */}
      {draggingItem && createPortal(<div className={`${classes.fv} ${classes.favFlying}`} style={sort.overlayStyle} aria-hidden="true">
        <span className={classes.fstar}><IconStarFilled size={15} /></span>
        <span className={classes.fvLink}><MenuName item={draggingItem} /></span>
        <span className={`${classes.grip} ${classes.gripShown}`}><IconGripVertical size={13} stroke={1.8} /></span>
      </div>, document.body)}
    </div>
  );
}

// 접힌 네비에서 마우스를 올리면 오른쪽에 뜨는 메뉴 (body 로 띄워 네비 밖으로 잘리지 않는다)
function Fly({ target, rows, navigate, pathname }) {
  return (
    <HoverCard position="right-start" offset={8} openDelay={40} closeDelay={120} withinPortal shadow="none"
      classNames={{ dropdown: classes.fly }}>
      <HoverCard.Target>{target}</HoverCard.Target>
      <HoverCard.Dropdown>
        {rows.length ? rows.map((item) => (
          <button key={item.MenuID || item.link} type="button"
            className={`${classes.flyItem} ${normalizePath(item.link) === normalizePath(pathname) ? classes.on : ''}`}
            {...preloadProps(item.link)} onClick={() => openItem(item, navigate)}>
            {item.fav && <IconStarFilled className={classes.flyStar} size={15} />}
            <span className={classes.nm}>{item.label}</span><AiBadge item={item} />
          </button>
        )) : <div className={classes.flyEmpty}>내 메뉴에 등록한 메뉴가 없습니다.</div>}
      </HoverCard.Dropdown>
    </HoverCard>
  );
}

// 라이트 / 다크 스위치: 테마 상태를 이 버튼 혼자 가진다 (이 브라우저에 기억).
// <html data-steel-theme · data-mantine-color-scheme> 속성만 바꿔 CSS 로 색이 바뀐다 → 전환할 때 React 는 이 버튼만 다시 그림.
// (Mantine setColorScheme 은 열린 탭의 Mantine 부품을 전부 다시 그려 느리므로 쓰지 않는다)
const THEME_KEY = 'steel119-nav-theme';
function ThemeSwitch({ collapsed }) {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'; } catch { return 'light'; }
  });
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.steelTheme = theme;
    root.dataset.mantineColorScheme = theme;
    return () => { delete root.dataset.steelTheme; root.dataset.mantineColorScheme = 'light'; };   // 로그아웃 → 로그인 화면은 라이트
  }, [theme]);
  const toggle = () => setTheme((current) => {
    const next = current === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(THEME_KEY, next); } catch { /* 기억 못 해도 지금 화면은 바뀐다 */ }
    return next;
  });
  const ThemeIcon = theme === 'dark' ? IconMoon : IconSun;
  return (
    <button type="button" className={classes.sw} role="switch" aria-checked={theme === 'dark'} aria-label="다크 모드"
      title={theme === 'dark' ? '라이트 모드로' : '다크 모드로'} onClick={toggle}>
      {collapsed ? <ThemeIcon size={19} stroke={ICON_STROKE} /> : <>
        <IconSun className={classes.s1} size={17} stroke={ICON_STROKE} /><IconMoon className={classes.s2} size={17} stroke={ICON_STROKE} /><b className={classes.kn} />
      </>}
    </button>
  );
}

// 왼쪽 네비게이션: [전체메뉴 | 내메뉴] · 모두 펼치기/접기 · 대메뉴별 접기 · 화면별 내메뉴(☆) · 아래 테마 스위치 / 내메뉴 버튼.
// 메뉴 검색어(query)는 위 헤더의 검색칸에서 받는다 (검색하면 전체메뉴로 돌아간다).
// 접힌 네비: 아이콘 + 짧은 이름. 마우스를 올리면 하위 메뉴가 뜨고, 대메뉴를 누르면 펼치면서 그 메뉴를 연다.
export function SidebarNav({
  items, pathname, collapsed = false, onExpand, favoriteIds = [], onToggleFavorite, onReorderFavorites, query = '',
}) {
  const navigate = useNavigate();
  const [view, setView] = useState('all');
  // 펼친 대메뉴 (처음에는 지금 화면의 대메뉴만)
  const [openLabels, setOpenLabels] = useState(() => new Set(
    items.filter((item) => itemContainsPath(item, pathname)).map((item) => item.label),
  ));

  // 다른 화면으로 가면 그 화면의 대메뉴를 펼쳐 둔다
  const [lastPathname, setLastPathname] = useState(pathname);
  if (lastPathname !== pathname) {
    setLastPathname(pathname);
    const owner = items.find((item) => itemContainsPath(item, pathname));
    if (owner && !openLabels.has(owner.label)) setOpenLabels(new Set(openLabels).add(owner.label));
  }

  const q = query.trim().toLowerCase();
  // 메뉴를 검색하기 시작하면 전체메뉴에서 찾는다
  const [lastQuery, setLastQuery] = useState(q);
  if (lastQuery !== q) {
    setLastQuery(q);
    if (q && view !== 'all') setView('all');
  }

  const favorites = useMemo(() => new Set(favoriteIds), [favoriteIds]);
  const tree = useMemo(() => filterTree(items, q), [items, q]);
  // 내메뉴: 저장된 순서대로, 지금 볼 수 있는 화면만
  const favoriteItems = useMemo(() => {
    const byId = new Map();
    const walk = (list) => list.forEach((item) => {
      if (item.links) walk(item.links);
      else if (item.MenuID && !item.disabled) byId.set(item.MenuID, item);
    });
    walk(items);
    return favoriteIds.map((id) => byId.get(id)).filter(Boolean);
  }, [items, favoriteIds]);

  const isOpen = (label) => (q ? true : openLabels.has(label));
  const toggleGroup = (label) => setOpenLabels((current) => {
    const next = new Set(current);
    if (next.has(label)) next.delete(label); else next.add(label);
    return next;
  });
  const foldable = tree.filter((group) => group.links);
  const allOpen = foldable.length > 0 && foldable.every((group) => isOpen(group.label));
  const toggleAll = () => setOpenLabels(allOpen ? new Set() : new Set(foldable.map((group) => group.label)));

  const openFromRail = (nextView, label) => {
    onExpand?.();
    setView(nextView);
    if (label) setOpenLabels((current) => new Set(current).add(label));
  };
  const favMode = view === 'fav';
  // 그린 뒤 AI 배지 위치를 맞춘다 (글꼴을 늦게 받으면 받은 뒤 한 번 더)
  const sidebarRef = useRef(null);
  useLayoutEffect(() => {
    if (collapsed) return undefined;
    let alive = true;
    alignAI(sidebarRef.current, items);
    document.fonts?.ready?.then(() => { if (alive) alignAI(sidebarRef.current, items); });
    return () => { alive = false; };
  }, [items, collapsed]);
  const favRows = favoriteItems.map((item) => ({ ...item, fav: true }));

  return (
    <div ref={sidebarRef} className={`${classes.sidebar} ${collapsed ? classes.col : ''}`}>
      {collapsed ? (
        <nav className={classes.rail} aria-label="축소 네비게이션">
          {items.map((group) => {
            const has = itemContainsPath(group, pathname);
            const target = (
              <button type="button" aria-label={group.label} className={`${classes.m} ${has ? classes.railOn : ''}`}
                {...(group.links ? {} : preloadProps(group.link))}
                onClick={() => (group.links ? openFromRail('all', group.label) : navigate(group.link))}>
                <span className={classes.ic}>{group.icon}</span>
                <span className={classes.tx}>{group.label}</span>
              </button>
            );
            return <Fly key={group.label} target={target} navigate={navigate} pathname={pathname}
              rows={group.links ? groupScreens(group).filter((item) => !item.disabled && (item.link || item.action)) : [group]} />;
          })}
        </nav>
      ) : (<>
        <div className={classes.nt}>
          <b>{favMode ? '내메뉴' : '전체메뉴'}</b>
          {!favMode && (
            <button type="button" className={classes.xall} title={allOpen ? '메뉴 모두 접기' : '메뉴 모두 펼치기'}
              aria-label={allOpen ? '메뉴 모두 접기' : '메뉴 모두 펼치기'} onClick={toggleAll}>
              {allOpen ? <IconChevronsUp size={17} stroke={ICON_STROKE} /> : <IconChevronsDown size={17} stroke={ICON_STROKE} />}
            </button>
          )}
        </div>
        <nav className={classes.ml} aria-label={favMode ? '내메뉴' : '전체메뉴'}>
          {favMode ? (
            <FavoriteList favoriteItems={favoriteItems} query={q} pathname={pathname} navigate={navigate}
              onToggleFavorite={onToggleFavorite} onReorder={onReorderFavorites} />
          ) : (<>
            {tree.map((group) => (
              <MenuGroup key={group.label} group={group} open={isOpen(group.label)} onToggle={() => toggleGroup(group.label)}
                pathname={pathname} navigate={navigate} favorites={favorites} onToggleFavorite={onToggleFavorite} />
            ))}
            {!tree.length && <div className={classes.empty}>{q ? '검색 결과가 없습니다.' : '열 수 있는 메뉴가 없습니다.'}</div>}
          </>)}
        </nav>
      </>)}

      {/* 아래: 라이트/다크 스위치 · 내메뉴 */}
      <div className={classes.ft}>
        <ThemeSwitch collapsed={collapsed} />
        {collapsed ? (
          <Fly navigate={navigate} pathname={pathname} rows={favRows}
            target={<button type="button" className={classes.gb} aria-label="내메뉴" onClick={() => openFromRail('fav')}>
              <IconStar size={19} stroke={ICON_STROKE} />
            </button>} />
        ) : (
          <button type="button" className={`${classes.gb} ${favMode ? classes.gbOn : ''}`} aria-pressed={favMode}
            title={favMode ? '전체메뉴 보기' : '내메뉴 보기'} aria-label={favMode ? '전체메뉴 보기' : '내메뉴 보기'}
            onClick={() => setView(favMode ? 'all' : 'fav')}>
            {favMode ? <IconStarFilled size={17} /> : <IconStar size={17} stroke={ICON_STROKE} />}
          </button>
        )}
      </div>
    </div>
  );
}
