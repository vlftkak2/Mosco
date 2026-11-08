// 2단 네비게이션 (steel119_erp_sidebar_concept)
//  1단: 다크 대메뉴 레일 (로고 + 카테고리 아이콘)  2단: 흰색 상세 메뉴 패널 (접기/펼치기)
import { IconChevronRight, IconChevronsLeft, IconLayoutSidebarLeftExpand, IconLayoutSidebarLeftCollapse } from '@tabler/icons-react';
import classes from '../../styles/layout/MainLayoutNav.module.css';
import logo from '../../assets/img/logolast.png';

export const normalizePath = (path) => (path === '/' ? path : String(path || '').replace(/\/+$/, '').toLowerCase());

export const categoryOfPath = (categories, pathname) => categories.find((category) => category.groups
  .some((group) => group.links.some((link) => normalizePath(link.link) === normalizePath(pathname))))?.key ?? null;

export default function MainLayoutNav({ categories, pathname, activeKey, currentKey, panelOpen, onSelect, onTogglePanel, onNavigate }) {
  const active = categories.find((category) => category.key === activeKey);
  return (
    <div className={classes.nav}>
      <aside className={classes.rail} aria-label="대메뉴">
        <button type="button" className={classes.logo} onClick={() => onNavigate('/HomePage')} title="STEEL119 메인">
          <img src={logo} alt="STEEL119" />
        </button>
        <nav className={classes.railMenu}>
          {categories.map((category) => {
            const Icon = category.icon;
            const highlighted = category.key === activeKey && (panelOpen || category.key === currentKey);
            return (
              <button type="button" key={category.key} onClick={() => onSelect(category.key)} title={category.label}
                className={`${classes.railButton} ${highlighted ? classes.railActive : ''} ${!highlighted && category.key === currentKey ? classes.railCurrent : ''}`}
                aria-pressed={highlighted} aria-expanded={category.key === activeKey && panelOpen}>
                <Icon size={21} stroke={1.8} />
                <span>{category.label}</span>
              </button>
            );
          })}
        </nav>
        <button type="button" className={classes.railToggle} onClick={onTogglePanel} title={panelOpen ? '상세 메뉴 접기' : '상세 메뉴 펼치기'}
          aria-label={panelOpen ? '상세 메뉴 접기' : '상세 메뉴 펼치기'}>
          {panelOpen ? <IconLayoutSidebarLeftCollapse size={19} stroke={1.8} /> : <IconLayoutSidebarLeftExpand size={19} stroke={1.8} />}
        </button>
      </aside>

      {panelOpen && active && (
        <aside className={classes.panel} aria-label={`${active.label} 메뉴`}>
          <div className={classes.panelHeader}>
            <h2 className={classes.panelTitle}>{active.label}</h2>
            <button type="button" className={classes.panelClose} onClick={onTogglePanel} title="상세 메뉴 접기" aria-label="상세 메뉴 접기">
              <IconChevronsLeft size={17} stroke={1.8} />
            </button>
          </div>
          <div className={classes.panelBody}>
            {active.groups.map((group) => (
              <div key={group.label} className={classes.group}>
                <div className={classes.groupLabel}>{group.label}</div>
                {group.links.map((link) => {
                  const current = normalizePath(link.link) === normalizePath(pathname);
                  return (
                    <button type="button" key={link.link} className={`${classes.item} ${current ? classes.itemActive : ''}`}
                      onClick={() => !link.disabled && onNavigate(link.link)} disabled={link.disabled} aria-current={current ? 'page' : undefined}>
                      <span>{link.label}</span>
                      {link.badge && <span className={classes.itemBadge}>{link.badge}</span>}
                      {current && <IconChevronRight size={14} stroke={2} />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </aside>
      )}
    </div>
  );
}
