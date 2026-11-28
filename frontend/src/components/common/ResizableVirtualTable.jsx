import { forwardRef, memo, useCallback, useRef, useState } from 'react';
import { Table } from '@mantine/core';
import { TableVirtuoso } from 'react-virtuoso';
import classes from '../../styles/pages/InboundSearch.module.css';

// 행이 VIRTUALIZE_FROM 개를 넘으면 보이는 행(+앞뒤 여유)만 그린다 → 한 쪽 200~500건도 바로 뜨고 스크롤이 가볍다.
// 그 이하는 예전과 똑같이 모두 그린다. 스크롤은 지금처럼 바깥 div 가 맡고(customScrollParent), 머리글 고정·열 너비 조절도 그대로.
const VIRTUALIZE_FROM = 100;
const VirtualTable = forwardRef(function VirtualTable({ style, context, children, ...props }, ref) {
  return <Table ref={ref} {...props} className={classes.statusTable} withTableBorder withColumnBorders highlightOnHover
    style={{ ...style, width: '100%', minWidth: context.tableWidth, tableLayout: 'fixed' }}>
    <colgroup>{context.columns.map((column) => <col key={column.key} data-column-key={column.key} style={{ width: `${context.widths[column.key] || column.width}px` }} />)}</colgroup>
    {children}
  </Table>;
});
const VirtualHead = forwardRef(function VirtualHead({ context: _context, ...props }, ref) { return <Table.Thead ref={ref} {...props} />; });
const VirtualBody = forwardRef(function VirtualBody({ context: _context, ...props }, ref) { return <Table.Tbody ref={ref} {...props} />; });
function VirtualRow({ item, context, ...props }) {
  const { onRowDoubleClick, rowTitle } = context;
  return <Table.Tr {...props} onDoubleClick={onRowDoubleClick ? () => onRowDoubleClick(item) : undefined}
    title={rowTitle ? rowTitle(item) : undefined} style={onRowDoubleClick ? { cursor: 'pointer' } : undefined} />;
}
const VIRTUAL_COMPONENTS = { Table: VirtualTable, TableHead: VirtualHead, TableBody: VirtualBody, TableRow: VirtualRow };

// memo: 받은 값(data · columns 등)이 같으면 다시 그리지 않는다 (탭을 옮겨 화면만 다시 보일 때 행 전체를 다시 그리지 않게)
// onRowDoubleClick(item): 선택. 넘기지 않으면 지금과 같다
export default memo(function ResizableVirtualTable({ data, columns, computeItemKey, rowOffset = 0, minTableWidth, onRowDoubleClick, rowTitle }) {
  const [widths, setWidths] = useState({});
  const resizing = useRef(null);
  const [scroller, setScroller] = useState(null);
  const tableWidth = Math.max(columns.reduce((total, column) => total + (widths[column.key] || column.width), 0), minTableWidth || 0);
  const startResize = useCallback((event, column) => {
    event.preventDefault();
    event.stopPropagation();
    const table = event.currentTarget.closest('table');
    const col = [...(table?.querySelectorAll('col[data-column-key]') || [])]
      .find((element) => element.dataset.columnKey === column.key);
    const startWidth = widths[column.key] || column.width;
    resizing.current = {
      key: column.key,
      min: column.minWidth || 70,
      startX: event.clientX,
      startWidth,
      nextWidth: startWidth,
      baseTableWidth: tableWidth,
      table,
      col,
      animationFrame: 0,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [tableWidth, widths]);
  const moveResize = useCallback((event) => {
    if (!resizing.current) return;
    const active = resizing.current;
    active.nextWidth = Math.max(active.min, Math.min(1600, active.startWidth + event.clientX - active.startX));
    if (active.animationFrame) return;
    active.animationFrame = window.requestAnimationFrame(() => {
      const current = resizing.current;
      if (!current) return;
      current.animationFrame = 0;
      const nextTableWidth = current.baseTableWidth + current.nextWidth - current.startWidth;
      if (current.col) current.col.style.width = `${current.nextWidth}px`;
      if (current.table) {
        const parentWidth = current.table.parentElement?.clientWidth || 0;
        current.table.style.width = `${Math.max(parentWidth, nextTableWidth)}px`;
        current.table.style.minWidth = `${nextTableWidth}px`;
      }
    });
  }, []);
  const stopResize = useCallback(() => {
    const active = resizing.current;
    if (!active) return;
    if (active.animationFrame) window.cancelAnimationFrame(active.animationFrame);
    const nextTableWidth = active.baseTableWidth + active.nextWidth - active.startWidth;
    if (active.col) active.col.style.width = `${active.nextWidth}px`;
    if (active.table) {
      const parentWidth = active.table.parentElement?.clientWidth || 0;
      active.table.style.width = `${Math.max(parentWidth, nextTableWidth)}px`;
      active.table.style.minWidth = `${nextTableWidth}px`;
    }
    setWidths((current) => ({ ...current, [active.key]: active.nextWidth }));
    resizing.current = null;
  }, []);
  const headerRow = <Table.Tr>{columns.map((column) => <Table.Th key={column.key} style={{ width: widths[column.key] || column.width, position: 'sticky', top: 0, zIndex: 3 }}>{column.label}<span className={classes.columnResizeHandle} role="separator" aria-label={`${column.label} column width`} onPointerDown={(event) => startResize(event, column)} onPointerMove={moveResize} onPointerUp={stopResize} onPointerCancel={stopResize} /></Table.Th>)}</Table.Tr>;

  if (data.length > VIRTUALIZE_FROM) {
    return <div ref={setScroller} className={classes.resizableVirtualScroller} style={{ height: '100%', width: '100%' }}>
      {scroller && <TableVirtuoso
        customScrollParent={scroller}
        data={data}
        components={VIRTUAL_COMPONENTS}
        context={{ columns, widths, tableWidth, onRowDoubleClick, rowTitle }}
        computeItemKey={computeItemKey}
        increaseViewportBy={{ top: 400, bottom: 400 }}
        fixedHeaderContent={() => headerRow}
        itemContent={(index, item) => columns.map((column) => <Table.Td key={column.key}>{column.render(item, rowOffset + index)}</Table.Td>)}
      />}
    </div>;
  }
  return <div className={classes.resizableVirtualScroller} style={{ height: '100%', width: '100%' }}>
    <Table className={classes.statusTable} withTableBorder withColumnBorders highlightOnHover style={{ width: '100%', minWidth: tableWidth, tableLayout: 'fixed' }}>
      <colgroup>{columns.map((column) => <col key={column.key} data-column-key={column.key} style={{ width: `${widths[column.key] || column.width}px` }} />)}</colgroup>
      <Table.Thead>{headerRow}</Table.Thead>
      <Table.Tbody>{data.map((item, index) => <Table.Tr key={computeItemKey ? computeItemKey(index, item) : index} onDoubleClick={onRowDoubleClick ? () => onRowDoubleClick(item) : undefined} title={rowTitle ? rowTitle(item) : undefined} style={onRowDoubleClick ? { cursor: 'pointer' } : undefined}>{columns.map((column) => <Table.Td key={column.key}>{column.render(item, rowOffset + index)}</Table.Td>)}</Table.Tr>)}</Table.Tbody>
    </Table>
  </div>;
});
