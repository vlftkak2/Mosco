import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UnstyledButton } from '@mantine/core';
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react';
import classes from '../../styles/layout/MainLayoutLink.module.css';

function normalizePath(path) {
  return path === '/' ? path : String(path || '').replace(/\/+$/, '').toLowerCase();
}

function itemContainsPath(item, pathname) {
  if (item.link && normalizePath(item.link) === normalizePath(pathname)) return true;
  return (item.links || []).some((child) => itemContainsPath(child, pathname));
}

function MenuLink({ item, pathname, navigate }) {
  const active = Boolean(item.link) && normalizePath(item.link) === normalizePath(pathname);
  return (
    <div className={classes.linkRow}>
      <button
        type="button"
        className={`${classes.link} ${active ? classes.linkActive : ''} ${item.disabled ? classes.linkDisabled : ''}`}
        aria-current={active ? 'page' : undefined}
        disabled={item.disabled || undefined}
        onClick={() => { if (!item.disabled && item.link) navigate(item.link); }}
      >
        <span className={classes.linkName}>{item.label}</span>
      </button>
    </div>
  );
}

// 하위 메뉴: 항목에 links 가 있으면 섹션 제목 + 그 아래 메뉴로 그린다 (예: AI 가공솔루션 / 재고가공).
function SubMenus({ links, pathname, navigate }) {
  return (
    <div className={classes.submenus}>
      {links.map((item) => (Array.isArray(item.links) ? (
        <div key={item.label} className={classes.section}>
          <div className={classes.sectionHead}>{item.label}</div>
          {item.links.map((child) => <MenuLink key={child.label} item={child} pathname={pathname} navigate={navigate} />)}
        </div>
      ) : (
        <MenuLink key={item.label} item={item} pathname={pathname} navigate={navigate} />
      )))}
    </div>
  );
}

// 대메뉴는 여러 개를 동시에 펼칠 수 있다. 접힌 상태에서 대메뉴 아이콘을 누르면 사이드바를 펼치고 그 메뉴를 연다.
export function SidebarNav({ items, pathname, collapsed = false, onExpand }) {
  const navigate = useNavigate();
  const [openLabels, setOpenLabels] = useState(() => new Set(
    items.filter((item) => item.links && itemContainsPath(item, pathname)).map((item) => item.label),
  ));

  // 다른 경로(탭 이동 등)로 가면 그 화면의 대메뉴를 열어 둔다 (경로가 바뀐 렌더에서 바로 반영).
  const [lastPathname, setLastPathname] = useState(pathname);
  if (lastPathname !== pathname) {
    setLastPathname(pathname);
    const owner = items.find((item) => item.links && itemContainsPath(item, pathname));
    if (owner && !openLabels.has(owner.label)) setOpenLabels(new Set(openLabels).add(owner.label));
  }

  const handleCategory = (item) => {
    if (item.disabled) return;
    if (!item.links) {
      if (item.link) navigate(item.link);
      return;
    }
    if (collapsed) {
      onExpand?.();
      setOpenLabels((current) => new Set(current).add(item.label));
      return;
    }
    setOpenLabels((current) => {
      const next = new Set(current);
      if (next.has(item.label)) next.delete(item.label); else next.add(item.label);
      return next;
    });
  };

  return (
    <nav className={classes.nav}>
      {items.map((item) => {
        const hasLinks = Array.isArray(item.links);
        const isOpen = hasLinks && openLabels.has(item.label);
        const isCurrent = itemContainsPath(item, pathname);
        return (
          <div key={item.label}>
            <UnstyledButton
              className={`${classes.category} ${isOpen ? classes.categoryOpen : ''} ${isCurrent ? classes.categoryCurrent : ''}`}
              onClick={() => handleCategory(item)}
              aria-expanded={hasLinks ? isOpen : undefined}
              aria-current={!hasLinks && isCurrent ? 'page' : undefined}
              title={item.label}
              disabled={item.disabled || undefined}
            >
              <span className={classes.categoryIcon}>{item.icon}</span>
              <span className={classes.categoryName}>{item.label}</span>
              {hasLinks && (isOpen
                ? <IconChevronDown className={classes.arrow} size={13} stroke={2} />
                : <IconChevronRight className={classes.arrow} size={13} stroke={2} />)}
            </UnstyledButton>
            {isOpen && !collapsed && <SubMenus links={item.links} pathname={pathname} navigate={navigate} />}
          </div>
        );
      })}
    </nav>
  );
}
