import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UnstyledButton, Collapse, Group, Box, Text } from '@mantine/core';
import classes from '../../styles/layout/MainLayoutLink.module.css';
import { Notifications, notifications } from '@mantine/notifications';
import axios from 'axios';

function normalizePath(path) {
  return path === '/' ? path : (path || '').replace(/\/+$/, '');
}

function itemContainsPath(item, pathname) {
  if (normalizePath(item.link) === normalizePath(pathname)) return true;
  return (item.links || []).some((child) => itemContainsPath(child, pathname));
}

function NestedMenuItem({ item, pathname, navigate, depth = 0 }) {
  const hasChildren = Array.isArray(item.links);
  const [opened, setOpened] = useState(() => hasChildren && item.links.some((child) => itemContainsPath(child, pathname)));

  if (hasChildren) {
    return (
      <Box className={classes.subGroup}>
        <UnstyledButton
          className={classes.subGroupControl}
          onClick={() => setOpened((value) => !value)}
          aria-expanded={opened}
        >
          <span
            className={classes.subGroupLabel}
            style={{ fontSize: '13px', fontWeight: 400, lineHeight: 1.2 }}
          >
            {item.label}
          </span>
          <span className={`${classes.chevron} ${opened ? classes.chevronOpened : ''}`}>▼</span>
        </UnstyledButton>
        <Collapse in={opened}>
          <div className={classes.subGroupChildren}>
            {item.links.map((child) => (
              <NestedMenuItem
                key={child.label}
                item={child}
                pathname={pathname}
                navigate={navigate}
                depth={depth + 1}
              />
            ))}
          </div>
        </Collapse>
      </Box>
    );
  }

  return (
    <Text
      component="a"
      key={item.label}
      className={`${classes.subLink} ${normalizePath(item.link) === normalizePath(pathname) ? classes.subLinkActive : ''}`}
      aria-current={normalizePath(item.link) === normalizePath(pathname) ? 'page' : undefined}
      onClick={(event) => {
        event.preventDefault();
        if (!item.disabled && item.link) navigate(item.link);
      }}
      style={{
        cursor: item.disabled || !item.link ? 'default' : 'pointer',
        opacity: item.disabled ? 0.5 : 1,
        marginLeft: depth ? 4 : 0,
      }}
    >
      {item.label}
    </Text>
  );
}

// 1. props에 'disabled'를 추가합니다.
export function LinksGroup({ icon: Icon, label, initiallyOpened, links, link, disabled, pathname }) {
  const hasLinks = Array.isArray(links);
  const navigate = useNavigate();
  const isActive = normalizePath(link) === normalizePath(pathname) || (links || []).some((item) => itemContainsPath(item, pathname));
  const [opened, setOpened] = useState(() => Boolean(initiallyOpened || isActive));

  
  // 2. 서브 메뉴 아이템들 처리
  const items = (hasLinks ? links : []).map((item) => (
    <NestedMenuItem key={item.label} item={item} pathname={pathname} navigate={navigate} />
  ));

  return (
    <>
      <UnstyledButton 
        onClick={() => {
          // ✅ 대메뉴(Home 등) 자체가 비활성이면 아무것도 안 함
          if (disabled) return; 

          if (hasLinks) {
            setOpened((value) => !value);
          } else if (link) {
            navigate(link);
          }
        }} 
        className={`${classes.control} ${isActive ? classes.controlActive : ''} ${opened ? classes.controlOpen : ''}`}
        aria-expanded={hasLinks ? opened : undefined}
        aria-current={normalizePath(link) === normalizePath(pathname) ? 'page' : undefined}
        style={{
          // ✅ 대메뉴 비활성 스타일 (필요한 경우)
          opacity: disabled ? 0.5 : 1,
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        <Group justify="space-between" gap={0}>
          <Box className={classes.innerControl}>
            <Box className={classes.icon} style={{ filter: disabled ? 'grayscale(1)' : 'none' }}>
              {Icon}
            </Box>
            <Box className={classes.label} style={{ color: disabled ? '#adb5bd' : 'inherit' }}>
              {label}
            </Box>
          </Box>

          {hasLinks && (
            <span 
              className={`${classes.chevron} ${opened ? classes.chevronOpened : ''}`}
              style={{ display: disabled ? 'none' : 'inline-block' }} // 권한 없으면 화살표 숨김
            >
              ▼
            </span>
          )}
        </Group>
      </UnstyledButton>

      {/* 대메뉴가 활성화되어 있을 때만 하위 메뉴를 보여줍니다 */}
      {hasLinks && !disabled ? (
        <Collapse in={opened}>
          <div className={classes.subLinkContainer}>
            {items}
          </div>
        </Collapse>
      ) : null}
    </>
  );
}
