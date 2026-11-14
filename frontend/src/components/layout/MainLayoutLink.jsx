import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ScrollArea } from '@mantine/core';
import {
  IconChevronDown, IconGripVertical, IconLayoutGrid, IconSearch, IconStar, IconStarFilled, IconX,
} from '@tabler/icons-react';
import classes from '../../styles/layout/MainLayoutLink.module.css';

function normalizePath(path) {
  return path === '/' ? path : String(path || '').replace(/\/+$/, '').toLowerCase();
}

function itemContainsPath(item, pathname) {
  if (item.link && normalizePath(item.link) === normalizePath(pathname)) return true;
  return (item.links || []).some((child) => itemContainsPath(child, pathname));
}

const includesText = (value, query) => String(value || '').toLowerCase().includes(query);

// 메뉴 트리를 거른다: 대메뉴 > 섹션 > 화면. keep(화면) 이 true 인 화면만 남기고, 비는 섹션 · 대메뉴는 뺀다.
// 검색어가 대메뉴나 섹션 이름과 맞으면 그 아래 화면은 모두 남긴다.
function filterTree(items, query, keep) {
  return items.map((group) => {
    const groupHit = query && includesText(group.label, query);
    const sections = (group.links || []).map((section) => {
      if (!Array.isArray(section.links)) {
        const ok = keep(section) && (!query || groupHit || includesText(section.label, query));
        return ok ? section : null;
      }
      const sectionHit = groupHit || (query && includesText(section.label, query));
      const links = section.links.filter((link) => keep(link) && (!query || sectionHit || includesText(link.label, query)));
      return links.length ? { ...section, links } : null;
    }).filter(Boolean);
    return sections.length ? { ...group, links: sections } : null;
  }).filter(Boolean);
}

function MenuRow({ item, pathname, navigate, favorite, onToggleFavorite, drag }) {
  const active = Boolean(item.link) && normalizePath(item.link) === normalizePath(pathname);
  const canStar = Boolean(item.MenuID) && !item.disabled && onToggleFavorite;
  return (
    <div className={`${classes.row} ${active ? classes.rowActive : ''} ${item.disabled ? classes.rowDisabled : ''} ${drag ? classes.favRow : ''} ${drag?.dragging ? classes.rowDragging : ''}`}
      draggable={drag ? true : undefined} onDragStart={drag?.onDragStart} onDragOver={drag?.onDragOver}
      onDrop={drag ? (event) => event.preventDefault() : undefined} onDragEnd={drag?.onDragEnd}>
      {drag && (
        <span className={classes.grip} tabIndex={0} role="button" title="끌어서 순서 변경 (Alt + ↑/↓)"
          aria-label={`${item.label} 순서 변경: Alt와 위/아래 방향키`} onKeyDown={drag.onKeyDown}>
          <IconGripVertical size={14} stroke={1.8} />
        </span>
      )}
      <button
        type="button"
        className={classes.link}
        aria-current={active ? 'page' : undefined}
        disabled={item.disabled || undefined}
        title={item.label}
        onClick={() => { if (!item.disabled && item.link) navigate(item.link); }}
      >
        <span className={classes.linkName}>{item.label}</span>
      </button>
      {canStar && (
        <button
          type="button"
          className={`${classes.star} ${favorite ? classes.starOn : ''}`}
          title={favorite ? '즐겨찾기 해제' : '즐겨찾기 등록'}
          aria-label={`${item.label} ${favorite ? '즐겨찾기 해제' : '즐겨찾기 등록'}`}
          aria-pressed={favorite}
          onClick={() => onToggleFavorite(item.MenuID)}
        >
          {favorite ? <IconStarFilled size={15} /> : <IconStar size={15} stroke={1.8} />}
        </button>
      )}
    </div>
  );
}

function MenuGroup({ group, open, onToggle, pathname, navigate, favorites, onToggleFavorite }) {
  return (
    <section className={`${classes.group} ${open ? '' : classes.groupClosed}`}>
      <button type="button" className={classes.groupTitle} aria-expanded={open} onClick={onToggle}>
        <span className={classes.groupIcon}>{group.icon}</span>
        <span className={classes.groupName}>{group.label}</span>
        <IconChevronDown className={classes.chevron} size={15} stroke={2} />
      </button>
      {open && (
        <div className={classes.groupItems}>
          {group.links.map((section) => (Array.isArray(section.links) ? (
            <div key={section.label}>
              <div className={classes.sectionTitle}>{section.label}</div>
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
    </section>
  );
}

// 즐겨찾기 탭: 대메뉴 없이 '즐겨찾기' 한 묶음 아래 등록한 순서대로. 손잡이를 끌거나 Alt+↑/↓ 로 순서를 바꾼다.
function FavoriteGroup({ favoriteItems, open, onToggle, pathname, navigate, onToggleFavorite, onReorder, query }) {
  const [order, setOrder] = useState(null); // 끄는 동안의 임시 순서
  const [dragging, setDragging] = useState(null);
  const orderRef = useRef(null);
  const ids = order || favoriteItems.map((item) => item.MenuID);
  const byId = new Map(favoriteItems.map((item) => [item.MenuID, item]));
  const shown = ids.map((id) => byId.get(id)).filter(Boolean)
    .filter((item) => !query || includesText(item.label, query));
  const canDrag = !query;

  const updateOrder = (next) => { orderRef.current = next; setOrder(next); };
  const dragFor = (item) => (canDrag ? {
    dragging: dragging === item.MenuID,
    onDragStart: (event) => {
      setDragging(item.MenuID);
      updateOrder(favoriteItems.map((x) => x.MenuID));
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', item.MenuID);
    },
    onDragOver: (event) => {
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
    },
    onDragEnd: () => {
      const finalOrder = orderRef.current;
      setDragging(null);
      updateOrder(null);
      if (finalOrder && finalOrder.some((x, i) => x !== favoriteItems[i]?.MenuID)) onReorder?.(finalOrder);
    },
    onKeyDown: (event) => {
      if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
      event.preventDefault();
      const list = favoriteItems.map((x) => x.MenuID);
      const index = list.indexOf(item.MenuID);
      const target = index + (event.key === 'ArrowUp' ? -1 : 1);
      if (target < 0 || target >= list.length) return;
      [list[index], list[target]] = [list[target], list[index]];
      onReorder?.(list);
    },
  } : undefined);

  return (
    <section className={`${classes.group} ${open ? '' : classes.groupClosed}`}>
      <button type="button" className={classes.groupTitle} aria-expanded={open} onClick={onToggle}>
        <span className={`${classes.groupIcon} ${classes.favGroupIcon}`}><IconStarFilled size={18} /></span>
        <span className={classes.groupName}>즐겨찾기</span>
        <IconChevronDown className={classes.chevron} size={15} stroke={2} />
      </button>
      {open && (
        <div className={classes.groupItems}>
          {shown.map((item) => (
            <MenuRow key={item.MenuID} item={item} pathname={pathname} navigate={navigate} favorite
              onToggleFavorite={onToggleFavorite} drag={dragFor(item)} />
          ))}
          {!favoriteItems.length && <div className={classes.empty}><strong>즐겨찾기가 비어 있습니다.</strong><br />전체 메뉴에서 ☆를 눌러 추가할 수 있어요.</div>}
          {favoriteItems.length > 0 && !shown.length && <div className={classes.empty}>검색된 즐겨찾기가 없습니다.</div>}
        </div>
      )}
    </section>
  );
}

// 왼쪽 네비게이션: [전체 | 즐겨찾기] 탭 · 메뉴 검색 · 모두 접기/펼치기 · 대메뉴별 접기 · 화면별 즐겨찾기(☆).
// 접힌 사이드바에서는 아이콘만 보이고, 아이콘을 누르면 펼치면서 그 메뉴(또는 즐겨찾기)를 연다.
export function SidebarNav({ items, pathname, collapsed = false, onExpand, favoriteIds = [], onToggleFavorite, onReorderFavorites }) {
  const navigate = useNavigate();
  const [view, setView] = useState('all');
  const [query, setQuery] = useState('');
  // 전체 탭: 펼친 대메뉴 (처음에는 지금 화면의 대메뉴만). 즐겨찾기 탭: 접은 대메뉴 (처음에는 모두 펼침).
  const [openLabels, setOpenLabels] = useState(() => new Set(
    items.filter((item) => itemContainsPath(item, pathname)).map((item) => item.label),
  ));
  const [favClosed, setFavClosed] = useState(() => new Set());

  // 다른 화면으로 가면 그 화면의 대메뉴를 펼쳐 둔다
  const [lastPathname, setLastPathname] = useState(pathname);
  if (lastPathname !== pathname) {
    setLastPathname(pathname);
    const owner = items.find((item) => itemContainsPath(item, pathname));
    if (owner && !openLabels.has(owner.label)) setOpenLabels(new Set(openLabels).add(owner.label));
  }

  const favorites = useMemo(() => new Set(favoriteIds), [favoriteIds]);
  const q = query.trim().toLowerCase();
  const tree = useMemo(() => filterTree(items, q, () => true), [items, q]);
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
  const FAV = '즐겨찾기';

  const isOpen = (label) => (q ? true : view === 'fav' ? !favClosed.has(label) : openLabels.has(label));
  const toggleGroup = (label) => {
    const flip = (current) => { const next = new Set(current); if (next.has(label)) next.delete(label); else next.add(label); return next; };
    if (view === 'fav') setFavClosed(flip); else setOpenLabels(flip);
  };
  const allFolded = view === 'fav' ? !isOpen(FAV) : tree.length > 0 && tree.every((group) => !isOpen(group.label));
  const toggleAll = () => {
    if (view === 'fav') setFavClosed(allFolded ? new Set() : new Set([FAV]));
    else setOpenLabels(allFolded ? new Set(tree.map((group) => group.label)) : new Set());
  };

  const openFromRail = (nextView, label) => {
    onExpand?.();
    setView(nextView);
    setQuery('');
    if (label) setOpenLabels((current) => new Set(current).add(label));
  };

  if (collapsed) {
    return (
      <nav className={classes.rail} aria-label="축소 네비게이션">
        <button type="button" className={`${classes.railButton} ${classes.railFav}`} title="즐겨찾기" aria-label="즐겨찾기"
          onClick={() => openFromRail('fav')}>
          <IconStarFilled size={19} />
        </button>
        {items.map((group) => (
          <button key={group.label} type="button" title={group.label} aria-label={group.label}
            className={`${classes.railButton} ${itemContainsPath(group, pathname) ? classes.railActive : ''}`}
            onClick={() => openFromRail('all', group.label)}>
            {group.icon}
          </button>
        ))}
      </nav>
    );
  }

  return (
    <div className={classes.sidebar}>
      <div className={classes.viewTabs} role="tablist" aria-label="메뉴 분류">
        {[['all', '전체', <IconLayoutGrid key="i" size={15} stroke={1.8} />], ['fav', '즐겨찾기', <IconStar key="i" size={15} stroke={1.8} />]].map(([key, label, icon]) => (
          <button key={key} type="button" role="tab" aria-selected={view === key}
            className={`${classes.viewTab} ${view === key ? classes.viewTabActive : ''}`}
            onClick={() => { setView(key); setQuery(''); }}>
            {icon}{label}
          </button>
        ))}
      </div>

      <div className={classes.searchArea}>
        <label className={classes.search}>
          <IconSearch size={16} stroke={1.8} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="메뉴 검색"
            autoComplete="off" aria-label="메뉴 검색"
            onKeyDown={(event) => { if (event.key === 'Escape') setQuery(''); }} />
          {query && (
            <button type="button" className={classes.clearSearch} aria-label="검색어 지우기" title="검색어 지우기" onClick={() => setQuery('')}>
              <IconX size={15} stroke={1.8} />
            </button>
          )}
        </label>
        <button type="button" className={classes.foldAll} onClick={toggleAll}
          title={allFolded ? '모두 펼치기' : '모두 접기'} aria-label={allFolded ? '모두 펼치기' : '모두 접기'}>
          {/* 가로선 3개: 펼친 상태는 위가 긴 선(모두 접기), 접힌 상태는 아래가 긴 선(모두 펼치기) */}
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d={allFolded ? 'M10 7h4M7 12h10M4 17h16' : 'M4 7h16M7 12h10M10 17h4'} />
          </svg>
        </button>
      </div>

      <ScrollArea className={classes.viewport} type="hover" scrollbars="y" scrollbarSize={6}>
        <nav className={classes.list}>
          {view === 'fav' ? (
            <FavoriteGroup favoriteItems={favoriteItems} open={isOpen(FAV)} onToggle={() => toggleGroup(FAV)} query={q}
              pathname={pathname} navigate={navigate} onToggleFavorite={onToggleFavorite} onReorder={onReorderFavorites} />
          ) : (<>
            {tree.map((group) => (
              <MenuGroup key={group.label} group={group} open={isOpen(group.label)} onToggle={() => toggleGroup(group.label)}
                pathname={pathname} navigate={navigate} favorites={favorites} onToggleFavorite={onToggleFavorite} />
            ))}
            {!tree.length && q && <div className={classes.empty}>검색된 메뉴가 없습니다.</div>}
          </>)}
        </nav>
      </ScrollArea>
    </div>
  );
}
