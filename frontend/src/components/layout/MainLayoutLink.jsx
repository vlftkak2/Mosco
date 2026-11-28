import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Tooltip } from '@mantine/core';
import { IconChevronDown, IconGripVertical, IconStar, IconStarFilled } from '@tabler/icons-react';
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

const includesText = (value, query) => String(value || '').toLowerCase().includes(query);

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

// 하위 메뉴 한 줄: 이름 + (마우스를 올리면) 즐겨찾기 별
function MenuRow({ item, pathname, navigate, favorite, onToggleFavorite }) {
  const active = Boolean(item.link) && normalizePath(item.link) === normalizePath(pathname);
  const canStar = Boolean(item.MenuID) && !item.disabled && onToggleFavorite;
  return (
    <div className={`${classes.si} ${active ? classes.on : ''} ${item.disabled ? classes.disabled : ''}`}>
      <button type="button" className={classes.siLink} aria-current={active ? 'page' : undefined} disabled={item.disabled || undefined}
        title={item.label} {...(item.disabled ? {} : preloadProps(item.link))} onClick={() => { if (!item.disabled && item.link) navigate(item.link); }}>
        {item.label}
      </button>
      {canStar && (
        <button type="button" className={`${classes.star} ${favorite ? classes.starOn : ''}`}
          title={favorite ? '즐겨찾기 해제' : '즐겨찾기 추가'} aria-label={`${item.label} ${favorite ? '즐겨찾기 해제' : '즐겨찾기 추가'}`}
          aria-pressed={favorite} onClick={() => onToggleFavorite(item.MenuID)}>
          {favorite ? <IconStarFilled size={14} /> : <IconStar size={14} stroke={1.6} />}
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
      <button type="button" className={`${classes.mi} ${has ? classes.miOn : ''}`} aria-current={has ? 'page' : undefined}
        disabled={group.disabled || undefined} {...preloadProps(group.link)} onClick={() => { if (group.link) navigate(group.link); }}>
        <span className={classes.ic}>{group.icon}</span>
        <span className={classes.tx}>{group.label}</span>
      </button>
    );
  }
  return (
    <div className={`${classes.grp} ${open ? classes.open : ''} ${has ? classes.has : ''}`}>
      <button type="button" className={classes.mi} aria-expanded={open} onClick={onToggle}>
        <span className={classes.ic}>{group.icon}</span>
        <span className={classes.tx}>{group.label}</span>
        <IconChevronDown className={classes.chv} size={14} stroke={1.8} />
      </button>
      {open && (
        <div className={classes.subs}>
          {group.links.map((section) => (Array.isArray(section.links) ? (
            <div key={section.label}>
              <div className={classes.secTitle}>{section.label}</div>
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

// 즐겨찾기 탭: 등록한 순서대로 한 줄씩 (별 · 이름 · 손잡이). 손잡이를 끌거나 Alt+↑/↓ 로 순서를 바꾼다.
function FavoriteList({ favoriteItems, pathname, navigate, onToggleFavorite, onReorder, query }) {
  const [order, setOrder] = useState(null); // 끄는 동안의 임시 순서
  const [dragging, setDragging] = useState(null);
  const orderRef = useRef(null);
  const ids = order || favoriteItems.map((item) => item.MenuID);
  const byId = new Map(favoriteItems.map((item) => [item.MenuID, item]));
  const shown = ids.map((id) => byId.get(id)).filter(Boolean).filter((item) => !query || includesText(item.label, query));
  const canDrag = !query;
  const updateOrder = (next) => { orderRef.current = next; setOrder(next); };

  if (!favoriteItems.length) return <div className={classes.empty}>즐겨찾기한 메뉴가 없습니다.<br />메뉴 탭에서 하위 메뉴의 별을 눌러 추가하세요.</div>;
  if (!shown.length) return <div className={classes.empty}>검색 결과가 없습니다.</div>;
  return (
    <div className={classes.fv}>
      {shown.map((item) => {
        const active = normalizePath(item.link) === normalizePath(pathname);
        return (
          <div key={item.MenuID} className={`${classes.si} ${classes.favItem} ${active ? classes.on : ''} ${dragging === item.MenuID ? classes.dragging : ''}`}
            draggable={canDrag || undefined}
            onDragStart={canDrag ? (event) => {
              setDragging(item.MenuID);
              updateOrder(favoriteItems.map((x) => x.MenuID));
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', item.MenuID);
            } : undefined}
            onDragOver={canDrag ? (event) => {
              const current = orderRef.current;
              if (!dragging || !current) return;
              event.preventDefault();
              if (dragging === item.MenuID) return;
              const rect = event.currentTarget.getBoundingClientRect();
              const after = event.clientY > rect.top + rect.height / 2;
              const rest = current.filter((x) => x !== dragging);
              let index = rest.indexOf(item.MenuID);
              if (index < 0) return;
              if (after) index += 1;
              rest.splice(index, 0, dragging);
              if (rest.some((x, i) => x !== current[i])) updateOrder(rest);
            } : undefined}
            onDrop={canDrag ? (event) => event.preventDefault() : undefined}
            onDragEnd={canDrag ? () => {
              const finalOrder = orderRef.current;
              setDragging(null);
              updateOrder(null);
              if (finalOrder && finalOrder.some((x, i) => x !== favoriteItems[i]?.MenuID)) onReorder?.(finalOrder);
            } : undefined}>
            <button type="button" className={`${classes.star} ${classes.starOn}`} title="즐겨찾기 해제" aria-label={`${item.label} 즐겨찾기 해제`}
              onClick={() => onToggleFavorite(item.MenuID)}><IconStarFilled size={14} /></button>
            <button type="button" className={classes.siLink} aria-current={active ? 'page' : undefined} title={item.label}
              {...preloadProps(item.link)} onClick={() => navigate(item.link)}>{item.label}</button>
            {canDrag && (
              <span className={classes.grip} tabIndex={0} role="button" title="끌어서 순서 변경 (Alt + ↑/↓)"
                aria-label={`${item.label} 순서 변경: Alt와 위/아래 방향키`}
                onKeyDown={(event) => {
                  if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
                  event.preventDefault();
                  const list = favoriteItems.map((x) => x.MenuID);
                  const index = list.indexOf(item.MenuID);
                  const target = index + (event.key === 'ArrowUp' ? -1 : 1);
                  if (target < 0 || target >= list.length) return;
                  [list[index], list[target]] = [list[target], list[index]];
                  onReorder?.(list);
                }}>
                <IconGripVertical size={14} stroke={1.8} />
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// 왼쪽 네비게이션: [메뉴 | 즐겨찾기] 탭 · 모두 펼치기/접기 · 대메뉴별 접기 · 화면별 즐겨찾기(☆).
// 메뉴 검색어(query)는 위 헤더의 검색칸에서 받는다.
// 접힌 사이드바에서는 아이콘만 보이고(마우스를 올리면 이름), 아이콘을 누르면 펼치면서 그 메뉴(또는 즐겨찾기)를 연다.
export function SidebarNav({ items, pathname, collapsed = false, onExpand, favoriteIds = [], onToggleFavorite, onReorderFavorites, query = '' }) {
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

  const favorites = useMemo(() => new Set(favoriteIds), [favoriteIds]);
  const q = query.trim().toLowerCase();
  const tree = useMemo(() => filterTree(items, q), [items, q]);
  // 즐겨찾기: 저장된 순서대로, 지금 볼 수 있는 화면만
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

  if (collapsed) {
    return (
      <nav className={classes.rail} aria-label="축소 네비게이션">
        <Tooltip label="즐겨찾기" position="right" color="dark" offset={10}>
          <button type="button" className={`${classes.mi} ${classes.miniFav}`} aria-label="즐겨찾기" onClick={() => openFromRail('fav')}>
            <IconStarFilled size={20} />
          </button>
        </Tooltip>
        {items.map((group) => (
          <Tooltip key={group.label} label={group.label} position="right" color="dark" offset={10}>
            <button type="button" aria-label={group.label}
              className={`${classes.mi} ${itemContainsPath(group, pathname) ? classes.railActive : ''}`}
              onClick={() => (group.links ? openFromRail('all', group.label) : navigate(group.link))}>
              <span className={classes.ic}>{group.icon}</span>
            </button>
          </Tooltip>
        ))}
      </nav>
    );
  }

  return (
    <div className={classes.sidebar}>
      <div className={classes.stabs} role="tablist" aria-label="메뉴 분류">
        <button type="button" role="tab" aria-selected={view === 'all'} className={view === 'all' ? classes.tabOn : ''} onClick={() => setView('all')}>메뉴</button>
        <button type="button" role="tab" aria-selected={view === 'fav'} className={view === 'fav' ? classes.tabOn : ''} onClick={() => setView('fav')}>
          즐겨찾기<em>{favoriteItems.length}</em>
        </button>
        {view === 'all' && (
          <Tooltip label={allOpen ? '메뉴 접기' : '메뉴 펼치기'} position="bottom" color="dark">
            <button type="button" className={classes.xall} aria-label={allOpen ? '메뉴 접기' : '메뉴 펼치기'} onClick={toggleAll}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d={allOpen ? 'm7 11 5-5 5 5' : 'm7 7 5 5 5-5'} />
                <path d={allOpen ? 'm7 17 5-5 5 5' : 'm7 13 5 5 5-5'} />
              </svg>
            </button>
          </Tooltip>
        )}
      </div>

      <nav className={classes.nav}>
        {view === 'fav' ? (
          <FavoriteList favoriteItems={favoriteItems} query={q} pathname={pathname} navigate={navigate}
            onToggleFavorite={onToggleFavorite} onReorder={onReorderFavorites} />
        ) : (<>
          {tree.map((group) => (
            <MenuGroup key={group.label} group={group} open={isOpen(group.label)} onToggle={() => toggleGroup(group.label)}
              pathname={pathname} navigate={navigate} favorites={favorites} onToggleFavorite={onToggleFavorite} />
          ))}
          {!tree.length && q && <div className={classes.empty}>검색 결과가 없습니다.</div>}
        </>)}
      </nav>
    </div>
  );
}
