import { forwardRef, useMemo, useRef, useState } from 'react';
import { Table } from '@mantine/core';
import { TableVirtuoso } from 'react-virtuoso';
import classes from '../../styles/pages/InboundSearch.module.css';

const HorizontalScroller = forwardRef(function HorizontalScroller({ style, ...props }, ref) {
  return <div {...props} ref={ref} className={classes.virtuosoScroller} style={{ ...style, overflowX: 'auto' }} />;
});

export default function ResizableVirtualTable({ data, columns, computeItemKey, rowOffset = 0, minTableWidth }) {
  const [widths, setWidths] = useState({});
  const resizing = useRef(null);
  const tableWidth = Math.max(columns.reduce((total, column) => total + (widths[column.key] || column.width), 0), minTableWidth || 0);
  const components = useMemo(() => ({
    Scroller: HorizontalScroller,
    Table: ({ style, ...props }) => <Table {...props} className={classes.statusTable} withTableBorder withColumnBorders highlightOnHover style={{ ...style, width: 'var(--resizable-table-width)', minWidth: 'var(--resizable-table-width)', tableLayout: 'fixed' }} />,
    TableHead: Table.Thead,
    TableBody: Table.Tbody,
    TableRow: Table.Tr,
  }), []);

  const startResize = (event, column) => {
    event.preventDefault();
    event.stopPropagation();
    resizing.current = { key: column.key, min: column.minWidth || 70, startX: event.clientX, startWidth: event.currentTarget.parentElement.getBoundingClientRect().width };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveResize = (event) => {
    if (!resizing.current) return;
    const { key, min, startX, startWidth } = resizing.current;
    setWidths((current) => ({ ...current, [key]: Math.max(min, startWidth + event.clientX - startX) }));
  };
  const stopResize = () => { resizing.current = null; };

  return <div style={{ height: '100%', width: '100%', '--resizable-table-width': `${tableWidth}px` }}>
    <TableVirtuoso
      data={data}
      style={{ height: '100%', width: '100%' }}
      components={components}
      computeItemKey={computeItemKey}
      fixedHeaderContent={() => <Table.Tr>{columns.map((column) => <Table.Th key={column.key} style={{ width: widths[column.key] || column.width, position: 'relative' }}>{column.label}<span className={classes.columnResizeHandle} role="separator" aria-label={`${column.label} column width`} onPointerDown={(event) => startResize(event, column)} onPointerMove={moveResize} onPointerUp={stopResize} onPointerCancel={stopResize} /></Table.Th>)}</Table.Tr>}
      itemContent={(index, item) => columns.map((column) => <Table.Td key={column.key}>{column.render(item, rowOffset + index)}</Table.Td>)}
    />
  </div>;
}
