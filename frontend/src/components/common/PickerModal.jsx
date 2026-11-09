import { Button, Group, Loader, Modal, Pagination, TextInput } from '@mantine/core';
import { IconCheck, IconChevronRight, IconInfoCircle, IconListCheck, IconSearch } from '@tabler/icons-react';
import classes from './PickerModal.module.css';

// 불러오기/선택 창 공통 틀 (가공최적화 > 품목 불러오기 창 디자인).
// 화면마다 다른 것은 검색 칸(filters)과 표(children)뿐이고, 제목·안내·목록 틀·하단 바는 여기서 같은 모양으로 그린다.
// 표는 <table className={pickerClasses.table}> + <colgroup> 로 그리면 같은 스타일이 적용된다.
export const pickerClasses = classes;

const MODAL_CLASSES = { content: classes.content, header: classes.header, title: classes.title, body: classes.body, close: classes.close };

export function PickerEmpty({ title, description }) {
  return <div className={classes.empty}>
    <span className={classes.emptyIcon}><IconSearch size={23} stroke={1.5} aria-hidden="true" /></span>
    <strong>{title}</strong>{description && <span>{description}</span>}
  </div>;
}

const SINGLE_SIZES = { sm: 520, md: 640, lg: 800, xl: 960 };

// 단일 선택 창: 검색 → 목록 → 행을 누르면 바로 onSelect 후 닫힌다 (거래처·품목·코드 선택 등).
// columns: [{ key, label, width, align: 'center' | 'right', render(row) }]
// 서버 검색이면 onSearch 를 넘기고(Enter/조회 버튼), 넘기지 않으면 입력하는 즉시 걸러지는 검색으로 쓴다.
export function SelectPickerModal({
  opened, onClose, title, description, icon = <IconSearch size={21} stroke={1.8} />, badge, size = 'md',
  searchValue, onSearchChange, onSearch, searchPlaceholder = '코드 또는 이름 검색', searchLabel, extraFilters, autoFocus = true,
  columns, rows, rowKey, onSelect, currentKey, loading = false,
  listTitle = '검색 결과', total, page, pageCount, onPageChange, emptyTitle = '조회된 항목이 없습니다', emptyDescription,
}) {
  const width = SINGLE_SIZES[size] || size;
  const tableWidth = columns.reduce((sum, column) => sum + (column.width || 120), 0);
  const choose = (row) => onSelect(row);
  return <Modal opened={opened} onClose={onClose} centered size={`min(${width}px, calc(100vw - 32px))`} xOffset={16} yOffset={16}
    classNames={{ ...MODAL_CLASSES, content: `${classes.content} ${classes.singleContent}` }} closeButtonProps={{ 'aria-label': `${title} 닫기` }}
    title={<div className={classes.heading}>
      <span className={classes.headingIcon} aria-hidden="true">{icon}</span>
      <div>
        <div className={classes.headingLine}><strong>{title}</strong>{badge && <span className={classes.badge}>{badge}</span>}</div>
        {description && <p>{description}</p>}
      </div>
    </div>}>
    <div className={classes.workspace}>
      <div className={classes.searchRow}>
        <TextInput className={classes.searchGrow} size="sm" label={searchLabel} placeholder={searchPlaceholder} leftSection={<IconSearch size={14} />}
          value={searchValue} onChange={(event) => onSearchChange(event.currentTarget.value)} data-autofocus={autoFocus || undefined}
          onKeyDown={(event) => { if (event.key === 'Enter' && onSearch) onSearch(); }} />
        {extraFilters}
        {onSearch && <Button size="sm" color="red" leftSection={<IconSearch size={15} />} onClick={onSearch} loading={loading}>조회</Button>}
      </div>
      <div className={classes.list}>
        <div className={classes.listHeader}>
          <div><strong>{listTitle}</strong><span className={classes.count}>{Number(total ?? rows.length).toLocaleString()}건</span></div>
          <span>행을 누르면 바로 선택됩니다</span>
        </div>
        {loading && <Loader className={classes.loader} size="sm" color="red" />}
        <div className={classes.tableScroll}>
          <table className={classes.table} style={{ width: `max(100%, ${tableWidth}px)` }} aria-label={`${title} 목록`}>
            <colgroup>{columns.map((column) => <col key={column.key} style={{ width: column.width || 120 }} />)}</colgroup>
            <thead><tr>{columns.map((column) => <th key={column.key} className={column.align ? classes[column.align] : undefined}>{column.label}</th>)}</tr></thead>
            <tbody>
              {rows.map((row) => {
                const key = rowKey(row);
                return <tr key={key} className={`${classes.pickRow} ${currentKey !== undefined && currentKey === key ? classes.currentRow : ''}`} tabIndex={0}
                  onClick={() => choose(row)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(row); } }}>
                  {columns.map((column, index) => {
                    const value = column.render ? column.render(row) : row[column.key];
                    return <td key={column.key} className={column.align ? classes[column.align] : undefined} title={typeof value === 'string' ? value : undefined}>
                      {value}{index === columns.length - 1 && <IconChevronRight className={classes.pickArrow} size={15} aria-hidden="true" />}
                    </td>;
                  })}
                </tr>;
              })}
              {!rows.length && <tr><td colSpan={columns.length} className={classes.emptyCell}>
                <PickerEmpty title={loading ? '조회하고 있습니다' : emptyTitle} description={loading ? '' : emptyDescription} />
              </td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
    <div className={classes.footer}>
      <span className={classes.footerNote}>{currentKey ? '빨간 표시는 현재 입력된 값입니다' : ''}</span>
      <div className={classes.pagination}>
        {pageCount > 1 && <Pagination size="sm" color="red" total={pageCount} value={page} onChange={onPageChange} siblings={1} disabled={loading} />}
      </div>
      <Group gap={8} className={classes.footerActions}><Button size="sm" variant="default" onClick={onClose}>닫기</Button></Group>
    </div>
  </Modal>;
}

export default function PickerModal({
  opened, onClose, closeDisabled = false,
  title, description, icon = <IconListCheck size={22} stroke={1.7} />, badge,
  filters, guide,
  listTitle, count, listHint = '행 또는 체크박스를 눌러 선택하세요', loading = false,
  children,
  selectedCount = 0, selectionLabel = '선택', onClearSelection,
  pagination,
  onApply, applyLabel = '선택 반영', applyDisabled, applying = false,
  footerActions,
}) {
  const close = () => { if (!closeDisabled) onClose(); };
  return <Modal opened={opened} onClose={close} centered size="min(1440px, calc(100vw - 32px))" xOffset={16} yOffset={16}
    classNames={MODAL_CLASSES} closeButtonProps={{ 'aria-label': `${title} 닫기` }}
    title={<div className={classes.heading}>
      <span className={classes.headingIcon} aria-hidden="true">{icon}</span>
      <div>
        <div className={classes.headingLine}><strong>{title}</strong>{badge && <span className={classes.badge}>{badge}</span>}</div>
        {description && <p>{description}</p>}
      </div>
    </div>}>
    <div className={classes.workspace}>
      {filters && <div className={classes.filters}>{filters}</div>}
      {guide && <div className={classes.guide}><IconInfoCircle size={16} aria-hidden="true" /><div>{guide}</div></div>}
      <div className={classes.list}>
        <div className={classes.listHeader}>
          <div><strong>{listTitle}</strong>{count !== undefined && <span className={classes.count}>{Number(count || 0).toLocaleString()}건</span>}</div>
          {listHint && <span>{listHint}</span>}
        </div>
        {loading && <Loader className={classes.loader} size="sm" color="red" />}
        <div className={classes.tableScroll}>{children}</div>
      </div>
    </div>
    <div className={classes.footer}>
      <div className={classes.selection} aria-live="polite">
        <IconListCheck size={17} aria-hidden="true" /><span><strong>{Number(selectedCount).toLocaleString()}개</strong> {selectionLabel}</span>
        {selectedCount > 0 && onClearSelection && <button type="button" className={classes.linkButton} onClick={onClearSelection}>선택 해제</button>}
      </div>
      <div className={classes.pagination}>{pagination}</div>
      <Group gap={8} className={classes.footerActions}>
        {footerActions ?? <>
          <Button size="sm" variant="default" onClick={close} disabled={closeDisabled}>취소</Button>
          <Button size="sm" color="red" leftSection={<IconCheck size={15} />} onClick={onApply} loading={applying}
            disabled={applyDisabled ?? !selectedCount}>{applyLabel}{selectedCount ? ` (${Number(selectedCount).toLocaleString()})` : ''}</Button>
        </>}
      </Group>
    </div>
  </Modal>;
}
