// 월마감 관리 (메뉴: MONTH_CLOSING) — backend/services/closing/MonthClose.py
// 마감된 달까지의 입고 · 출고 · 기초재고 · 재고이동 · 가공 · 수금/지급 전표는 등록 · 수정 · 삭제할 수 없다.
// 마감은 순서대로(마지막 마감월의 다음 달만), 마감 취소는 마지막 마감월부터 거꾸로 한 달씩.
// 화면 골격 · 글자 · 표 모양은 매입등록(InboundRegister.module.css + SimpleTheme)과 같다.
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Box, Button, Group, Loader, Paper, Select, Table, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCopy, IconDeviceFloppy, IconFileSpreadsheet, IconPlus, IconSearch, IconTrash, IconX } from '@tabler/icons-react';
import ConfirmDeleteModal from '../../components/common/ConfirmDeleteModal';
import usePageReactivated from '../../components/common/usePageReactivated';
import { PageRibbonContext } from '../../components/layout/MainLayout';
import sharedClasses from '../../styles/pages/ManagementShared.module.css';
import simpleTheme from '../../styles/pages/SimpleTheme.module.css';
import classes from '../../styles/pages/InboundRegister.module.css';
import own from '../../styles/pages/MonthClose.module.css';

const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });
const errorText = (error, fallback) => {
  const detail = error.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail) && detail[0]?.msg) return String(detail[0].msg).replace(/^Value error, /, '');
  return fallback;
};
const dateTime = (value) => (value ? String(value).replace('T', ' ').slice(0, 16) : '');
const dateOnly = (value) => (value ? String(value).slice(0, 10) : '');
const monthLabel = (value) => (value ? `${value.slice(0, 4)}-${value.slice(5, 7)}` : '');
const count = (value) => Number(value || 0).toLocaleString('ko-KR');
const COUNT_KEYS = ['opening', 'inbound', 'outbound', 'transfer', 'process', 'receiptpayment'];
const COLUMNS = [
  { key: 'month', label: '마감월', width: 90 },
  { key: 'status', label: '상태', width: 70 },
  { key: 'opening', label: '기초재고', width: 80, align: 'right' },
  { key: 'inbound', label: '입고', width: 80, align: 'right' },
  { key: 'outbound', label: '출고', width: 80, align: 'right' },
  { key: 'transfer', label: '재고이동', width: 80, align: 'right' },
  { key: 'process', label: '가공', width: 80, align: 'right' },
  { key: 'receiptpayment', label: '수금·지급', width: 80, align: 'right' },
  { key: 'total', label: '전표 합계', width: 90, align: 'right' },
  { key: 'closed_at', label: '마감일시', width: 130 },
  { key: 'closed_by', label: '마감자', width: 100 },
  { key: 'action', label: '처리', width: 100 },
];
const TABLE_WIDTH = COLUMNS.reduce((sum, column) => sum + column.width, 0);
const thisYear = new Date().getFullYear();
// 조회 연도: 올해부터 7년 전까지 (아직 오지 않은 해는 마감할 수 없으므로 넣지 않는다)
const YEAR_OPTIONS = Array.from({ length: 8 }, (_, index) => String(thisYear - index)).map((value) => ({ value, label: `${value}년` }));

export default function MonthClose() {
  const ribbon = useContext(PageRibbonContext);
  const registerPageRibbon = ribbon?.registerPageRibbon;
  const closeActivePage = ribbon?.closeActivePage;
  const [year, setYear] = useState(String(thisYear));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dialog, setDialog] = useState(null); // { mode: 'close' | 'reopen', month }
  const requestRef = useRef(0);

  const load = useCallback(async (targetYear) => {
    const requestId = ++requestRef.current;
    setLoading(true);
    try {
      const response = await axios.get('/api/month-close', { ...authConfig(), params: { year: targetYear } });
      if (requestId === requestRef.current) setData(response.data);
    } catch (error) {
      if (requestId === requestRef.current) notifications.show({ title: '월마감 조회 실패', message: errorText(error, '월마감 현황을 불러오지 못했습니다.'), color: 'red' });
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, []);
  useEffect(() => { void load(year); }, [load, year]);
  usePageReactivated(() => { void load(year); });

  const ribbonActionsRef = useRef({});
  ribbonActionsRef.current = { search: () => void load(year), close: closeActivePage };
  useEffect(() => {
    if (!registerPageRibbon) return undefined;
    registerPageRibbon(
      <Group className={classes.commandRibbon} justify="flex-start" wrap="nowrap" gap={2}>
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconSearch size={15} />} onClick={() => ribbonActionsRef.current.search()} loading={loading}>조회</Button>
        <span className={classes.ribbonSeparator} />
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconPlus size={15} />} disabled>추가</Button>
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconCopy size={15} />} disabled>복사</Button>
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconFileSpreadsheet size={15} />} disabled>엑셀</Button>
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconDeviceFloppy size={15} />} disabled>저장</Button>
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconTrash size={15} />} disabled>삭제</Button>
        <span className={classes.ribbonSeparator} />
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconX size={15} />} onClick={() => ribbonActionsRef.current.close?.()}>닫기</Button>
      </Group>,
    );
    return () => registerPageRibbon(null);
  }, [registerPageRibbon, loading]);

  const submit = async () => {
    if (!dialog) return;
    setSaving(true);
    try {
      await axios.post(`/api/month-close/${dialog.mode}`, { month: dialog.month }, authConfig());
      notifications.show({
        title: dialog.mode === 'close' ? '마감 완료' : '마감 취소 완료',
        message: `${monthLabel(dialog.month)} ${dialog.mode === 'close' ? '마감되었습니다.' : '마감이 취소되었습니다.'}`,
        color: 'green',
      });
      setDialog(null);
      await load(year);
    } catch (error) {
      notifications.show({ title: dialog.mode === 'close' ? '마감 실패' : '마감 취소 실패', message: errorText(error, '처리하지 못했습니다.'), color: 'red' });
    } finally {
      setSaving(false);
    }
  };

  const months = useMemo(() => data?.months || [], [data]);
  const closedCount = months.filter((row) => row.closed).length;
  const totals = useMemo(() => months.reduce((sum, row) => {
    COUNT_KEYS.forEach((key) => { sum[key] += Number(row.counts[key] || 0); });
    sum.total += Number(row.total || 0);
    return sum;
  }, { ...Object.fromEntries(COUNT_KEYS.map((key) => [key, 0])), total: 0 }), [months]);

  const cell = (row, column) => {
    switch (column.key) {
      case 'month': return <b>{monthLabel(row.month)}</b>;
      case 'status': return <span className={row.closed ? own.closed : own.open}>{row.closed ? '마감' : '미마감'}</span>;
      case 'total': return <b>{count(row.total)}</b>;
      case 'closed_at': return dateTime(row.closed_at);
      case 'closed_by': return row.closed_by || '';
      case 'action':
        if (row.can_close) return <button type="button" className={`${own.rowButton} ${own.rowButtonPrimary}`} disabled={saving} onClick={() => setDialog({ mode: 'close', month: row.month })}>마감</button>;
        if (row.can_reopen) return <button type="button" className={own.rowButton} disabled={saving} onClick={() => setDialog({ mode: 'reopen', month: row.month })}>마감 취소</button>;
        return '';
      default: return <span className={row.counts[column.key] ? '' : own.zero}>{count(row.counts[column.key])}</span>;
    }
  };
  const colgroup = <colgroup>{COLUMNS.map((column) => <col key={column.key} style={{ width: `${column.width}px` }} />)}</colgroup>;

  return (
    <Box className={`${sharedClasses.pageShell} ${classes.page} ${simpleTheme.simple}`}>
      <Box component="nav" aria-label="현재 위치" className={classes.pageBreadcrumb}>
        <Group className={classes.breadcrumbTrail} gap={7}>
          <Text component="span" className={classes.breadcrumbParent}>운영정보</Text>
          <Text component="span" className={classes.breadcrumbChevron}>›</Text>
          <Text component="span" className={classes.breadcrumbCurrent}>월마감 관리</Text>
        </Group>
      </Box>

      <Box className={own.body}>
        <Paper className={`${sharedClasses.panel} ${own.sheet}`} withBorder>
          <div className={own.blockHead}>
            <div className={own.headText}>
              <h3>월별 마감 현황</h3>
              <span>마감한 달까지의 전표는 등록 · 수정 · 삭제할 수 없습니다.</span>
              {loading && <Loader size="xs" color="red" />}
            </div>
            <div className={own.headSide}>
              <span className={own.through}>
                마감 <b>{closedCount}</b>개월
                <i className={own.dot} />
                {data?.closed_through ? <>마감 기준일 <b>{dateOnly(data.closed_through)}</b></> : <span className={own.none}>마감된 달 없음</span>}
              </span>
              <Select className={own.yearSelect} data={YEAR_OPTIONS} value={year} allowDeselect={false}
                onChange={(value) => value && setYear(value)} aria-label="조회 연도" />
            </div>
          </div>
          <Box className={`${classes.topReceiptTable} ${own.tableBox}`}>
            <Table className={classes.receiptFinderTable} stickyHeader withTableBorder withColumnBorders
              style={{ width: '100%', minWidth: `${TABLE_WIDTH}px`, tableLayout: 'fixed' }}>
              {colgroup}
              <Table.Thead><Table.Tr>{COLUMNS.map((column) => <Table.Th key={column.key} ta="center">{column.label}</Table.Th>)}</Table.Tr></Table.Thead>
              <Table.Tbody>
                {months.map((row) => <Table.Tr key={row.month} className={`${classes.receiptFinderRow} ${row.closed ? own.closedRow : ''}`}>
                  {COLUMNS.map((column) => <Table.Td key={column.key} ta={column.align || 'center'}>{cell(row, column)}</Table.Td>)}
                </Table.Tr>)}
              </Table.Tbody>
            </Table>
            {!months.length && <Box className={classes.topReceiptEmptyMessage}>{loading ? '조회 중입니다.' : '조회된 내용이 없습니다.'}</Box>}
          </Box>
          <Box className={own.bottom}>
            {!!months.length && <Table className={`${classes.receiptFinderTable} ${classes.receiptSubtotalTable}`} withTableBorder withColumnBorders
              style={{ width: '100%', minWidth: `${TABLE_WIDTH}px`, tableLayout: 'fixed' }}>
              {colgroup}
              <Table.Tbody><Table.Tr>
                {COLUMNS.map((column, index) => <Table.Td key={column.key} className={`${classes.topReceiptSubtotalCell} ${column.align === 'right' ? classes.topReceiptSubtotalNumber : ''}`}>
                  {index === 0 ? '합계' : Object.hasOwn(totals, column.key) ? count(totals[column.key]) : ''}
                </Table.Td>)}
              </Table.Tr></Table.Tbody>
            </Table>}
          </Box>

          <div className={own.ruleBlock}>
            <div className={own.blockHead}><div className={own.headText}><h3>마감 규칙</h3></div></div>
            <ul className={own.rules}>
              <li>마감은 순서대로 합니다. 처음 마감할 달은 자유롭게 고르고, 그다음부터는 마지막 마감월의 다음 달만 마감할 수 있습니다.</li>
              <li>마감 취소는 마지막 마감월부터 한 달씩 거꾸로 합니다. 아직 오지 않은 달은 마감할 수 없습니다.</li>
              <li>마감된 달의 입고 · 출고(기타비용 포함) · 기초재고 · 재고이동 · 가공 · 수금/지급은 등록 · 수정 · 삭제 · 담당자 수정을 할 수 없습니다. 수표/어음 결제 · 할인 · 부도 처리와 처리취소는 처리일 기준입니다.</li>
              <li>전표를 수정할 때는 원래 일자와 바꾼 일자가 둘 다 마감 전이어야 합니다.</li>
            </ul>
          </div>
        </Paper>
      </Box>

      <ConfirmDeleteModal opened={Boolean(dialog)} onClose={() => setDialog(null)} onConfirm={() => void submit()} loading={saving}
        showIcon={false}
        title={dialog?.mode === 'reopen' ? '마감을 취소할까요?' : '이 달을 마감할까요?'}
        target={dialog ? monthLabel(dialog.month) : ''}
        message={dialog?.mode === 'reopen' ? '마감을 취소하면 이 달 전표를' : '마감 후에는 이 달까지의 전표를'}
        note={dialog?.mode === 'reopen' ? '다시 등록 · 수정 · 삭제할 수 있습니다.' : '등록 · 수정 · 삭제할 수 없습니다.'}
        confirmLabel={dialog?.mode === 'reopen' ? '마감 취소' : '마감'} />
    </Box>
  );
}
