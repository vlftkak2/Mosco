// 내 휴가현황 (메뉴: 전자결재 › 휴가현황, 보이는 권한은 전자결재와 같음)
// 결재가 끝난(승인) 휴가만 보여 준다. 왼쪽: 연도 목록(연도별 잔여 · 막대) / 오른쪽: 선택한 해의 요약 + 휴가 내역.
// 화면 높이는 고정, 목록만 안에서 스크롤.
// 서버: backend/services/eapproval/EApproval.py (my_leave)
import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import axios from 'axios';
import { Box, Group, Loader, Paper, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import useErpPageRibbon from '../../components/common/useErpPageRibbon';
import usePageReactivated from '../../components/common/usePageReactivated';
import { ColumnResizeHandle, pickerClasses, useResizableColumns } from '../../components/common/PickerModal';
import sharedClasses from '../../styles/pages/ManagementShared.module.css';
import simpleTheme from '../../styles/pages/SimpleTheme.module.css';
import classes from '../../styles/pages/InboundRegister.module.css';
import own from '../../styles/pages/ControlManagement.module.css';
import ea from '../../styles/pages/EApproval.module.css';
import { apiErrorMessage } from '../../utils/apiError';

const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });
const errorText = (error, fallback = '조회하지 못했습니다.') => apiErrorMessage(error, fallback);
const num = (value) => Number(value || 0).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
const alignOf = (column) => (column.align === 'right' ? own.num : column.align === 'center' ? own.center : '');
const pct = (value, total) => (total > 0 ? Math.max(0, Math.min(100, (value / total) * 100)) : 0);

// 막대: 발생 대비 사용 (넘으면 빨강)
function UsageBar({ row, thin = false }) {
  const over = row.used > row.granted;
  return <div className={`${ea.lsBar} ${thin ? ea.lsBarThin : ''}`} aria-hidden="true">
    <span className={over ? ea.lsSegOver : ea.lsSegUsed} style={{ width: `${pct(row.used, Math.max(row.granted, row.used))}%` }} />
  </div>;
}

const ITEM_COLUMNS = [
  { key: 'kind', label: '휴가 종류', width: 96, align: 'center' },
  { key: 'period', label: '기간', width: 220 },
  { key: 'days', label: '일수', width: 70, align: 'right' },
  { key: 'deduct', label: '연차 차감', width: 84, align: 'center' },
  { key: 'reason', label: '사유', width: 240 },
  { key: 'approved', label: '승인일', width: 110, align: 'center' },
  { key: 'docno', label: '문서번호', width: 124 },
];
const kstDate = (value) => (value ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(value)) : '');

function ItemTable({ items }) {
  const cols = useResizableColumns(ITEM_COLUMNS);
  const rows = items;
  return <table className={own.table} style={{ width: `max(100%, ${cols.tableWidth}px)` }}>
    <colgroup>{ITEM_COLUMNS.map((column) => <col key={column.key} data-column-key={column.key} style={{ width: cols.widthOf(column) }} />)}</colgroup>
    <thead><tr>{ITEM_COLUMNS.map((column) => <th key={column.key} className={`${pickerClasses.resizableHead} ${alignOf(column)}`}>
      {column.label}<ColumnResizeHandle column={column} columns={cols} />
    </th>)}</tr></thead>
    <tbody>
      {rows.map((item) => <tr key={item.docno}>
        <td className={own.center}>{item.kind_label}</td>
        <td className={own.ellipsis}>{item.date_from}{item.date_to && item.date_to !== item.date_from ? ` ~ ${item.date_to}` : ''}
          {item.time_from ? <span className={ea.subText}> {item.time_from}~{item.time_to}</span> : null}</td>
        <td className={own.num}>{num(item.days)}</td>
        <td className={own.center}>{item.deduct ? '차감' : <span className={ea.subText}>차감 안 함</span>}</td>
        <td className={own.ellipsis} title={item.reason}>{item.reason}</td>
        <td className={`${own.mono} ${own.center}`}>{kstDate(item.approved_at)}</td>
        <td className={own.mono}>{item.docno}</td>
      </tr>)}
      {!rows.length && <tr><td colSpan={ITEM_COLUMNS.length} className={ea.lsEmptyCell}>승인된 휴가가 없습니다</td></tr>}
    </tbody>
  </table>;
}

export default function LeaveStatus() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const load = useCallback(async (targetYear) => {
    const mySeq = ++seq.current;
    setLoading(true);
    try {
      const { data: result } = await axios.get('/api/eapproval/my-leave', { ...authConfig(), params: targetYear ? { year: targetYear } : {} });
      if (mySeq !== seq.current) return;
      setData(result);
    } catch (error) {
      if (mySeq === seq.current) notifications.show({ title: '휴가현황 조회 실패', message: errorText(error), color: 'red' });
    } finally { if (mySeq === seq.current) setLoading(false); }
  }, []);
  const runLoad = useEffectEvent(() => { void load(null); });
  useEffect(() => { runLoad(); }, []);
  usePageReactivated(() => { void load(data?.year); });
  useErpPageRibbon({ onSearch: () => { void load(data?.year); }, showPrint: false });
  const pickYear = (year) => { if (year !== data?.year) void load(year); };

  const cur = data?.current;
  const stats = cur ? [
    { key: 'granted', label: '발생', value: cur.granted, note: cur.registered ? `${cur.year}년에 생긴 연차` : '미등록' },
    { key: 'used', label: '사용', value: cur.used, dot: ea.lsDotUsed, note: `승인된 휴가 ${data.items.filter((i) => i.deduct).length}건` },
    { key: 'rate', label: '사용률', value: cur.granted > 0 ? Math.round((cur.used / cur.granted) * 100) : 0, unit: '%' },
  ] : [];

  return <Box className={`${sharedClasses.pageShell} ${classes.page} ${simpleTheme.simple} ${own.page}`}>
    <Box component="nav" aria-label="현재 위치" className={classes.pageBreadcrumb}>
      <Group className={classes.breadcrumbTrail} gap={7}>
        <Text component="span" className={classes.breadcrumbParent}>전자결재</Text>
        <Text component="span" className={classes.breadcrumbChevron}>›</Text>
        <Text component="span" className={classes.breadcrumbCurrent}>휴가현황</Text>
      </Group>
    </Box>
    <div className={own.body}>
      {!data ? <div className={own.empty}><Loader size="sm" color="red" /></div> : <div className={ea.lsLayout}>
        {/* 왼쪽: 연도 목록 */}
        <Paper className={`${sharedClasses.panel} ${ea.lsYears}`} withBorder>
          <div className={ea.lsPanelHead}>연도</div>
          <div className={ea.lsYearList} role="listbox" aria-label="연도">
            {data.years.map((row) => <button key={row.year} type="button" role="option" aria-selected={row.year === data.year}
              className={`${ea.lsYear} ${row.year === data.year ? ea.lsYearOn : ''}`} onClick={() => pickYear(row.year)}>
              <span className={ea.lsYearTop}>
                <b>{row.year}년</b>
                {row.year === Number(data.today.slice(0, 4)) && <em>올해</em>}
                <span className={`${ea.lsYearRemain} ${row.remain < 0 ? ea.lsOverText : ''}`}>{row.registered ? `잔여 ${num(row.remain)}일` : '미등록'}</span>
              </span>
              <UsageBar row={row} thin />
              <span className={ea.lsYearSub}>발생 {row.registered ? `${num(row.granted)}일` : '-'} · 사용 {num(row.used)}일</span>
            </button>)}
          </div>
        </Paper>

        {/* 오른쪽: 요약 + 내역 */}
        <Paper className={`${sharedClasses.panel} ${ea.lsMain}`} withBorder>
          <div className={ea.lsSummary}>
            <div className={ea.lsHero}>
              <span className={ea.lsHeroLabel}>{cur.year}년 잔여 연차{loading && <Loader size={11} color="red" className={ea.lsLoading} />}</span>
              <span className={`${ea.lsHeroValue} ${cur.remain < 0 ? ea.lsOverText : ''}`}>{num(cur.remain)}<small>일</small></span>
              <span className={ea.lsHeroSub}>{cur.registered ? <>발생 <b>{num(cur.granted)}일</b> − 사용 <b>{num(cur.used)}일</b></> : <span className={ea.lsWarnText}>발생 일수가 아직 등록되지 않았습니다</span>}</span>
            </div>
            <div className={ea.lsSummaryRight}>
              <UsageBar row={cur} />
              <div className={ea.lsStats}>
                {stats.map((stat) => <div key={stat.key} className={ea.lsStat}>
                  <span className={ea.lsStatLabel}>{stat.dot && <i className={stat.dot} />}{stat.label}</span>
                  <b>{num(stat.value)}<small>{stat.unit || '일'}</small></b>
                  {stat.note && <span className={ea.lsStatNote}>{stat.note}</span>}
                </div>)}
              </div>
            </div>
          </div>
          <div className={ea.lsListHead}>
            <h3>승인된 휴가</h3><span className={ea.lsListCount}>{data.items.length}건</span>
          </div>
          <div className={ea.lsTableArea}>
            <ItemTable items={data.items} />
          </div>
        </Paper>
      </div>}
    </div>
  </Box>;
}
