// 내 급여현황 (메뉴: PAYROLL_MY) — 로그인한 직원 본인의 급여만 본다. 마감된 달만 보인다.
// 위: 연도 고르기 + 연봉(환산) · 연간 누적 / 가운데: 월별 추이 차트 | 고른 달 명세서(인쇄) / 아래: 월별 상세 내역 표(칼럼 너비 조절)
// 차트 막대나 표 줄을 누르면 그달 명세서가 열린다.
// 서버: backend/services/payroll/Payroll.py (my_slips — 회사 + 본인 이메일로만 조회)
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Box, Loader, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import useErpPageRibbon from '../../components/common/useErpPageRibbon';
import usePageReactivated from '../../components/common/usePageReactivated';
import { ColumnResizeHandle, pickerClasses, useResizableColumns } from '../../components/common/PickerModal';
import { apiErrorMessage } from '../../utils/apiError';
import sharedClasses from '../../styles/pages/ManagementShared.module.css';
import simpleTheme from '../../styles/pages/SimpleTheme.module.css';
import classes from '../../styles/pages/User.module.css';
import pc from '../../styles/pages/Payroll.module.css';
import PayTrendChart from './PayTrendChart';
import { DED_ITEMS, PAY_ITEMS, authConfig, printPayslip, won, ymLabel } from './payrollCommon';

const sum = (rows, key) => rows.reduce((s, r) => s + Number(r[key] || 0), 0);

export default function MyPayroll() {
  const [items, setItems] = useState(null);
  const [year, setYear] = useState(null);
  const [picked, setPicked] = useState('');   // 고른 귀속월
  const seq = useRef(0);

  const load = useCallback(async () => {
    const my = ++seq.current;
    try {
      const { data } = await axios.get('/api/payroll/my', authConfig());
      if (my !== seq.current) return;
      setItems(data.items);
      const latest = data.items[0]?.payym || '';
      setYear((cur) => (cur && data.items.some((i) => i.payym.startsWith(String(cur))) ? cur : latest ? Number(latest.slice(0, 4)) : null));
      setPicked((cur) => (data.items.some((i) => i.payym === cur) ? cur : latest));
    } catch (error) {
      if (my === seq.current) {
        setItems([]);
        notifications.show({ title: '내 급여현황 조회 실패', message: apiErrorMessage(error, '급여를 불러오지 못했습니다.'), color: 'red' });
      }
    }
  }, []);
  const runLoad = useEffectEvent(() => { void load(); });
  useEffect(() => { runLoad(); }, []);
  usePageReactivated(() => { void load(); });

  const years = useMemo(() => [...new Set((items || []).map((i) => Number(i.payym.slice(0, 4))))].sort((a, b) => b - a), [items]);
  const yearRows = useMemo(() => (items || []).filter((i) => Number(i.payym.slice(0, 4)) === year).sort((a, b) => a.payym.localeCompare(b.payym)), [items, year]);
  const months = useMemo(() => Array.from({ length: 12 }, (_, m) => yearRows.find((r) => Number(r.payym.slice(5, 7)) === m + 1) || null), [yearRows]);
  const slip = (items || []).find((i) => i.payym === picked) || null;
  // 연봉: 그해 마지막으로 마감된 달의 기본급 × 12
  const lastBase = Number(yearRows[yearRows.length - 1]?.pay_base || 0);
  const totals = { pay: sum(yearRows, 'pay_total'), ded: sum(yearRows, 'ded_total'), net: sum(yearRows, 'net_pay') };

  const pickYear = (y) => {
    setYear(y);
    const rows = (items || []).filter((i) => Number(i.payym.slice(0, 4)) === y);
    setPicked(rows[0]?.payym || '');   // 그해 가장 최근 달 (목록이 최근 순)
  };
  const print = useCallback(() => {
    if (slip && !printPayslip(slip)) notifications.show({ title: '인쇄', message: '팝업이 막혀 있습니다. 브라우저에서 팝업을 허용해 주세요.', color: 'red' });
  }, [slip]);
  useErpPageRibbon({ onSearch: () => { void load(); }, onPrint: slip ? print : undefined });

  // 상세 표: 그해 한 번이라도 금액이 있는 항목만
  const tableColumns = useMemo(() => {
    const used = (c) => yearRows.some((r) => Number(r[c.key] || 0) !== 0);
    return [
      { key: 'payym', label: '귀속월', width: 92 },
      { key: 'paydate', label: '지급일', width: 96 },
      ...PAY_ITEMS.filter(used).map((c) => ({ ...c, width: 96, money: true })),
      { key: 'pay_total', label: '지급 합계', width: 104, money: true, strong: true },
      ...DED_ITEMS.filter(used).map((c) => ({ ...c, width: 92, money: true })),
      { key: 'ded_total', label: '공제 합계', width: 100, money: true, strong: true },
      { key: 'net_pay', label: '실지급액', width: 108, money: true, strong: true },
    ];
  }, [yearRows]);
  const cols = useResizableColumns(tableColumns);

  const payRows = slip ? PAY_ITEMS.filter((i) => Number(slip[i.key] || 0) !== 0) : [];
  const dedRows = slip ? DED_ITEMS.filter((i) => Number(slip[i.key] || 0) !== 0) : [];
  const lineCount = Math.max(payRows.length, dedRows.length, 1);

  return <Box className={`${simpleTheme.simple} ${simpleTheme.noIcons} ${sharedClasses.pageShell} ${classes.page}`}>
    <Box component="nav" className={classes.breadcrumb}>
      <Text component="span" className={classes.breadcrumbParent}>급여관리</Text>
      <Text component="span" className={classes.breadcrumbChevron}>›</Text>
      <Text component="span" className={classes.breadcrumbCurrent}>내 급여현황</Text>
    </Box>

    {!items ? <div className={pc.placeholder}><Loader size="sm" color="red" /></div>
      : !items.length ? <div className={pc.myEmpty}><h4>아직 받은 급여명세서가 없습니다</h4><p>회사에서 급여를 마감하면 여기에 보입니다.</p></div>
        : <div className={pc.myScroll}>
          <section className={pc.monthCard}>
            <div className={pc.monthTop}>
              <div className={pc.tabs} role="tablist" aria-label="연도">
                {years.map((y) => <button key={y} type="button" role="tab" aria-selected={y === year} className={y === year ? pc.tabOn : ''} onClick={() => pickYear(y)}>{y}년</button>)}
              </div>
            </div>
            <dl className={pc.kpis}>
              <div className={pc.kpiNet}><dt>{year}년 연봉</dt><dd>{won(lastBase * 12)}<small>원</small></dd></div>
              <div><dt>누적 지급</dt><dd>{won(totals.pay)}<small>원</small></dd></div>
              <div><dt>누적 공제</dt><dd>{won(totals.ded)}<small>원</small></dd></div>
              <div><dt>누적 실지급액</dt><dd>{won(totals.net)}<small>원</small></dd></div>
              <div><dt>월평균 실지급액</dt><dd>{won(yearRows.length ? Math.round(totals.net / yearRows.length) : 0)}<small>원</small></dd></div>
            </dl>
          </section>

          <div className={pc.myGrid}>
            <section className={`${pc.card} ${pc.chartCard}`}>
              <div className={pc.cardHead}>
                <h4>{year}년 월별 실지급액</h4>
              </div>
              <PayTrendChart year={year} months={months} measure="net_pay" measureLabel="실지급액"
                picked={slip && Number(slip.payym.slice(0, 4)) === year ? Number(slip.payym.slice(5, 7)) - 1 : null}
                onPick={(i) => setPicked(months[i].payym)} />
            </section>

            <section className={pc.card}>
              {!slip ? <div className={pc.placeholder}>달을 고르세요.</div> : <>
                <div className={pc.cardHead}>
                  <h4>{ymLabel(slip.payym)} 급여명세서</h4>
                </div>
                <table className={pc.items}>
                  <thead><tr><th>지급항목</th><th>금액</th><th>공제항목</th><th>금액</th></tr></thead>
                  <tbody>{Array.from({ length: lineCount }, (_, n) => <tr key={n}>
                    <td>{payRows[n]?.label || ''}</td><td className={pc.num}>{payRows[n] ? won(slip[payRows[n].key]) : ''}</td>
                    <td>{dedRows[n]?.label || ''}</td><td className={pc.num}>{dedRows[n] ? won(slip[dedRows[n].key]) : ''}</td>
                  </tr>)}</tbody>
                  <tfoot><tr><td>지급 합계</td><td className={pc.num}>{won(slip.pay_total)}</td><td>공제 합계</td><td className={pc.num}>{won(slip.ded_total)}</td></tr></tfoot>
                </table>
                <div className={pc.slipNet}>실지급액 <b>{won(slip.net_pay)}</b>원</div>
                <div className={pc.slipMeta}>{[slip.username, slip.empno, slip.team, slip.position].filter(Boolean).join(' · ')}{slip.bankname ? ` · ${slip.bankname} ${slip.accountno}` : ''}</div>
              </>}
            </section>
          </div>

          <section className={`${pc.card} ${pc.myTableCard}`}>
            <div className={pc.cardHead}><h4>{year}년 월별 상세 내역</h4></div>
            <div className={pc.gridWrap}>
              <table className={pc.grid} style={{ width: `max(100%, ${cols.tableWidth}px)` }}>
                <colgroup>{tableColumns.map((c) => <col key={c.key} data-column-key={c.key} style={{ width: cols.widthOf(c) }} />)}</colgroup>
                <thead><tr>{tableColumns.map((c) => <th key={c.key} className={pickerClasses.resizableHead}>{c.label}<ColumnResizeHandle column={c} columns={cols} /></th>)}</tr></thead>
                <tbody>{yearRows.map((r) => <tr key={r.payym} className={r.payym === picked ? pc.selected : ''} onClick={() => setPicked(r.payym)}>
                  {tableColumns.map((c) => <td key={c.key} className={c.money ? pc.num : pc.center}>
                    {c.key === 'payym' ? `${Number(r.payym.slice(5, 7))}월` : c.money ? (c.strong ? <b>{won(r[c.key])}</b> : Number(r[c.key] || 0) ? won(r[c.key]) : '') : r[c.key]}
                  </td>)}
                </tr>)}</tbody>
                <tfoot><tr>{tableColumns.map((c) => <td key={c.key} className={c.money ? pc.num : pc.center}>
                  {c.key === 'payym' ? '합계' : c.key === 'paydate' ? `${yearRows.length}개월` : c.money ? won(sum(yearRows, c.key)) : ''}
                </td>)}</tr></tfoot>
              </table>
            </div>
          </section>
        </div>}
  </Box>;
}
