import { useCallback, useRef, useState } from 'react';
import { Table } from '@mantine/core';
import classes from '../../styles/pages/InboundSearch.module.css';

export default function ResizableVirtualTable({ data, columns, computeItemKey, rowOffset = 0, minTableWidth }) {
  const [widths, setWidths] = useState({});
  const resizing = useRef(null);
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
  }, [columns, tableWidth, widths]);
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
  return <div className={classes.resizableVirtualScroller} style={{ height: '100%', width: '100%' }}>
    <Table className={classes.statusTable} withTableBorder withColumnBorders highlightOnHover style={{ width: '100%', minWidth: tableWidth, tableLayout: 'fixed' }}>
      <colgroup>{columns.map((column) => <col key={column.key} data-column-key={column.key} style={{ width: `${widths[column.key] || column.width}px` }} />)}</colgroup>
      <Table.Thead><Table.Tr>{columns.map((column) => <Table.Th key={column.key} style={{ width: widths[column.key] || column.width, position: 'sticky', top: 0, zIndex: 3 }}>{column.label}<span className={classes.columnResizeHandle} role="separator" aria-label={`${column.label} column width`} onPointerDown={(event) => startResize(event, column)} onPointerMove={moveResize} onPointerUp={stopResize} onPointerCancel={stopResize} /></Table.Th>)}</Table.Tr></Table.Thead>
      <Table.Tbody>{data.map((item, index) => <Table.Tr key={computeItemKey ? computeItemKey(index, item) : index}>{columns.map((column) => <Table.Td key={column.key}>{column.render(item, rowOffset + index)}</Table.Td>)}</Table.Tr>)}</Table.Tbody>
    </Table>
  </div>;
}
