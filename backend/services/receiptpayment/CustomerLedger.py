"""거래처원장 (메뉴: CUSTOMER_LEDGER).

원장용 테이블을 따로 두지 않고, 전표에서 바로 모아 계산한다 (전표를 고치거나 지우면 즉시 반영).

금액 기준: 기본은 공급가(부가세 제외), 화면의 '합계금액 기준'을 켜면 공급가 + 부가세 (기타비용도 같은 기준).
대시보드(채권채무요약 · 홈)도 같은 기준 (기본 공급가, 화면에서 합계금액 기준 선택).

받을 돈(미수금)
  + 매출      : 매출등록 전표 + 매출처 부담 기타비용 (비용여부 ≠ '예') → 매출금액에 합쳐서 표시
  - 수금      : 수금·지급 등록 '수금' 전표 (현금 + 증권 + 상계 + 잡손실 − 잡이익) + '지급' 전표의 상계
줄 돈(미지급금)
  + 매입      : 매입등록 전표 + 매입 기타비용 중 거래처가 비었거나 매입처와 같은 것 → 매입금액에 합쳐서 표시
  + 매입(비용): 매입 기타비용 중 거래처가 매입처와 다른 것 (운송사 등에 따로 줄 돈)
                + 매출 기타비용 중 비용여부 '예' → 그 기타비용의 거래처의 매입으로 표시
                (매입 기타비용은 어느 거래처에 주든 재고 원가에는 그대로 들어간다 — stock_cost)
  + 가공      : 재고가공 전표의 가공금액 → 가공처 거래처의 매입 (가공일자, 가공금액 0원 전표도 줄을 만든다)
  - 지급      : 수금·지급 등록 '지급' 전표 (현금 + 증권 + 상계 − 잡손실 + 잡이익) + '수금' 전표의 상계

잡손실 · 잡이익: 수금은 + 잡손실 − 잡이익, 지급은 − 잡손실 + 잡이익 (덜 받은/더 준 차액은 손실, 더 받은/덜 준 차액은 이익).
부도: 수금/지급등록에서 [부도] 처리한 어음은 처리일에 '부도' 줄로 되돌린다 (처리취소하면 사라짐).
  - 받은 어음(수금) 부도      → 그 거래처 수금 −어음금액 (미수가 다시 생김)
  - 넘겨준 어음(지급) 부도    → 받은 거래처 지급 −어음금액 (미지급이 다시 생김: 배서 · 타수 직접 입력)
상계는 받을 돈과 줄 돈을 서로 지우는 것이므로 수금/지급 구분과 관계없이 미수·미지급 양쪽에서 함께 뺀다.

회사별 원장 시작일(company01t.ledgerstartdate)이 있으면 그날부터의 전표만 쌓고, 그 이전 잔액은
거래처 기초잔액(customer01t.openingreceivable / openingpayable)으로 본다.
"""
from datetime import date
from decimal import Decimal

import db as _shared_db
from services.receiptpayment.ReceiptPayment import INSTRUMENT_OPTIONS

# 적요의 증권 이름: 입력한 수표/어음 종류 그대로 (외상매출채권 · 전자어음 · 약속어음 …)
INSTRUMENT_TYPE_NAMES = INSTRUMENT_OPTIONS["instrumenttype"]

_connect = _shared_db.connect
ZERO = Decimal("0")

# 거래처 키: 코드가 있으면 코드, 없으면(기타비용에 이름만 적은 경우) 이름으로 묶는다.
_KEY = "COALESCE(NULLIF(BTRIM({code}), ''), 'NAME:' || BTRIM(COALESCE({name}, '')))"


def _in_exp_separate(x: str, h: str) -> str:
    """매입 기타비용 줄(x)이 매입처(h)와 다른 거래처에 줄 돈인지: 줄에 거래처가 있고 그 키가 매입처 키와 다를 때.
    거래처가 비었거나 매입처와 같으면 매입처 매입에 합산한다."""
    line_key = _KEY.format(code=f"{x}.customcode", name=f"{x}.customname")
    head_key = _KEY.format(code=f"{h}.customcode", name=f"{h}.customname")
    return (f"((NULLIF(BTRIM({x}.customcode), '') IS NOT NULL OR NULLIF(BTRIM({x}.customname), '') IS NOT NULL)"
            f" AND {line_key} <> {head_key})")

ENTRIES_SQL = f"""
WITH
out_items AS (
    SELECT companyid, receiptno, COUNT(*) AS cnt, SUM(COALESCE(supplyamt, 0) + CASE WHEN %(with_vat)s THEN COALESCE(vat, 0) ELSE 0 END) AS amt,
           (ARRAY_AGG(itemname ORDER BY lineno))[1] AS firstname
    FROM Outbound02t WHERE companyid = %(companyid)s GROUP BY companyid, receiptno
),
out_exp AS (
    SELECT companyid, receiptno, SUM(CASE WHEN %(with_vat)s THEN COALESCE(totalamt, 0) ELSE COALESCE(supplyamt, 0) END) AS amt
    FROM Outbound03t
    WHERE companyid = %(companyid)s AND UPPER(COALESCE(purchaseyn, 'N')) <> 'Y'
    GROUP BY companyid, receiptno
),
in_items AS (
    SELECT companyid, receiptno, COUNT(*) AS cnt, SUM(COALESCE(supplyamt, 0) + CASE WHEN %(with_vat)s THEN COALESCE(vat, 0) ELSE 0 END) AS amt,
           (ARRAY_AGG(itemname ORDER BY lineno))[1] AS firstname
    FROM Inbound02t WHERE companyid = %(companyid)s GROUP BY companyid, receiptno
),
in_exp AS (
    SELECT x.companyid, x.receiptno, SUM(CASE WHEN %(with_vat)s THEN COALESCE(x.totalamt, 0) ELSE COALESCE(x.supplyamt, 0) END) AS amt
    FROM Inbound03t x
    JOIN Inbound01t h ON h.companyid = x.companyid AND h.receiptno = x.receiptno
    WHERE x.companyid = %(companyid)s AND NOT {_in_exp_separate('x', 'h')}
    GROUP BY x.companyid, x.receiptno
),
rp AS (
    SELECT companyid, receiptno,
           SUM(COALESCE(cashamt, 0)) AS cashamt, SUM(COALESCE(instrumentamt, 0)) AS instrumentamt,
           SUM(COALESCE(bankamt, 0)) AS bankamt, SUM(COALESCE(cardamt, 0)) AS cardamt,
           SUM(COALESCE(offsetamt, 0)) AS offsetamt, SUM(COALESCE(lossamt, 0)) AS lossamt,
           SUM(COALESCE(chargeamt, 0)) AS chargeamt,
           COUNT(*) FILTER (WHERE COALESCE(instrumentamt, 0) > 0) AS instrumentcnt,
           (ARRAY_AGG(instrumentno ORDER BY lineno) FILTER (WHERE COALESCE(instrumentamt, 0) > 0))[1] AS instrumentno,
           (ARRAY_AGG(instrumenttype ORDER BY lineno) FILTER (WHERE COALESCE(instrumentamt, 0) > 0))[1] AS instrumenttype,
           COUNT(DISTINCT NULLIF(instrumenttype, '')) FILTER (WHERE COALESCE(instrumentamt, 0) > 0) AS instrumenttypecnt,
           (ARRAY_AGG(maturitydate ORDER BY lineno) FILTER (WHERE COALESCE(instrumentamt, 0) > 0))[1] AS maturitydate
    FROM ReceiptPayment02t WHERE companyid = %(companyid)s GROUP BY companyid, receiptno
),
entries AS (
    -- 매출 (+ 매출처 부담 기타비용)
    SELECT {_KEY.format(code='h.customcode', name='h.customname')} AS ckey, h.customcode, h.customname,
           h.receptdate AS entrydate, 1 AS kindorder, 'SALES' AS kind, h.receiptno AS docno,
           i.firstname, COALESCE(i.cnt, 0) AS cnt, COALESCE(e.amt, 0) AS extraamt,
           COALESCE(i.amt, 0) + COALESCE(e.amt, 0) AS sales, 0::numeric AS receipt, 0::numeric AS purchase, 0::numeric AS payment,
           NULL::numeric AS cashamt, NULL::numeric AS instrumentamt, NULL::numeric AS bankamt, NULL::numeric AS cardamt,
           NULL::numeric AS offsetamt, NULL::numeric AS lossamt, NULL::numeric AS chargeamt,
           NULL::bigint AS instrumentcnt, NULL::varchar AS instrumentno, NULL::varchar AS instrumenttype, NULL::bigint AS instrumenttypecnt,
           NULL::date AS maturitydate, h.description
    FROM Outbound01t h
    LEFT JOIN out_items i ON i.companyid = h.companyid AND i.receiptno = h.receiptno
    LEFT JOIN out_exp e ON e.companyid = h.companyid AND e.receiptno = h.receiptno
    WHERE h.companyid = %(companyid)s
    UNION ALL
    -- 매입 (+ 매입처 부담 기타비용)
    SELECT {_KEY.format(code='h.customcode', name='h.customname')}, h.customcode, h.customname,
           h.receptdate, 3, 'PURCHASE', h.receiptno,
           i.firstname, COALESCE(i.cnt, 0), COALESCE(e.amt, 0),
           0, 0, COALESCE(i.amt, 0) + COALESCE(e.amt, 0), 0,
           NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, h.description
    FROM Inbound01t h
    LEFT JOIN in_items i ON i.companyid = h.companyid AND i.receiptno = h.receiptno
    LEFT JOIN in_exp e ON e.companyid = h.companyid AND e.receiptno = h.receiptno
    WHERE h.companyid = %(companyid)s
    UNION ALL
    -- 기타비용으로 그 거래처(운송사 등)에 줄 돈: 매출 기타비용 비용여부 '예' + 매입 기타비용 중 매입처와 다른 거래처
    SELECT {_KEY.format(code='x.customcode', name='x.customname')}, MAX(x.customcode), MAX(x.customname),
           h.receptdate, 4, 'COST', h.receiptno,
           (ARRAY_AGG(x.costname ORDER BY x.lineno))[1], COUNT(*), 0,
           0, 0, SUM(CASE WHEN %(with_vat)s THEN COALESCE(x.totalamt, 0) ELSE COALESCE(x.supplyamt, 0) END), 0,
           NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
           CASE WHEN x.src = 'OUT' THEN '매출 ' ELSE '매입 ' END || h.receiptno
    FROM (
        SELECT 'OUT' AS src, companyid, receiptno, lineno, customcode, customname, costname, supplyamt, totalamt, purchaseyn FROM Outbound03t
        UNION ALL
        SELECT 'IN', e.companyid, e.receiptno, e.lineno, e.customcode, e.customname, e.costname, e.supplyamt, e.totalamt, 'Y'
        FROM Inbound03t e JOIN Inbound01t eh ON eh.companyid = e.companyid AND eh.receiptno = e.receiptno
        WHERE e.companyid = %(companyid)s AND {_in_exp_separate('e', 'eh')}
    ) x
    JOIN (
        SELECT 'OUT' AS src, companyid, receiptno, receptdate FROM Outbound01t
        UNION ALL
        SELECT 'IN', companyid, receiptno, receptdate FROM Inbound01t
    ) h ON h.src = x.src AND h.companyid = x.companyid AND h.receiptno = x.receiptno
    WHERE x.companyid = %(companyid)s AND UPPER(COALESCE(x.purchaseyn, 'N')) = 'Y'
      AND (NULLIF(BTRIM(x.customcode), '') IS NOT NULL OR NULLIF(BTRIM(x.customname), '') IS NOT NULL)
    GROUP BY 1, h.receptdate, h.receiptno, x.src
    UNION ALL
    -- 가공: 가공처에 줄 돈 (가공품 줄의 가공금액 합계, 0원도 표시)
    SELECT {_KEY.format(code='p.customcode', name='p.customname')}, p.customcode, p.customname,
           p.processdate, 4, 'PROCESS', p.processno,
           (ARRAY_AGG(COALESCE(NULLIF(BTRIM(d.processcodename), ''), '가공') ORDER BY d.lineno) FILTER (WHERE d.linetype = 'PRODUCT'))[1],
           COUNT(*) FILTER (WHERE d.linetype = 'PRODUCT'), 0,
           0, 0, COALESCE(SUM(COALESCE(d.supplyamt, 0) + CASE WHEN %(with_vat)s THEN COALESCE(d.vat, 0) ELSE 0 END), 0), 0,
           NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, p.description
    FROM Process01t p
    LEFT JOIN Process02t d ON d.companyid = p.companyid AND d.processno = p.processno
    WHERE p.companyid = %(companyid)s
      AND (NULLIF(BTRIM(p.customcode), '') IS NOT NULL OR NULLIF(BTRIM(p.customname), '') IS NOT NULL)
    GROUP BY p.companyid, p.processno, p.processdate, p.customcode, p.customname, p.description
    UNION ALL
    -- 수금 / 지급
    SELECT {_KEY.format(code='h.customcode', name='h.customname')}, h.customcode, h.customname,
           h.receiptdate, CASE WHEN h.transactiontype = 'RECEIPT' THEN 2 ELSE 5 END, h.transactiontype, h.receiptno,
           NULL, 0, 0,
           0,
           r.offsetamt + CASE WHEN h.transactiontype = 'RECEIPT' THEN r.cashamt + r.instrumentamt + r.bankamt + r.cardamt + r.lossamt - r.chargeamt ELSE 0 END,
           0,
           r.offsetamt + CASE WHEN h.transactiontype = 'PAYMENT' THEN r.cashamt + r.instrumentamt + r.bankamt + r.cardamt - r.lossamt + r.chargeamt ELSE 0 END,
           r.cashamt, r.instrumentamt, r.bankamt, r.cardamt, r.offsetamt, r.lossamt, r.chargeamt,
           r.instrumentcnt, r.instrumentno, r.instrumenttype, r.instrumenttypecnt, r.maturitydate, h.description
    FROM ReceiptPayment01t h
    JOIN rp r ON r.companyid = h.companyid AND r.receiptno = h.receiptno
    WHERE h.companyid = %(companyid)s AND h.transactiontype IN ('RECEIPT', 'PAYMENT')
    UNION ALL
    -- 부도: 처리일에 수금(받은 어음) / 지급(넘겨준 어음)을 어음금액만큼 되돌린다
    SELECT {_KEY.format(code='h.customcode', name='h.customname')}, h.customcode, h.customname,
           d.processdate, 6, 'DISHONOR', h.receiptno,
           NULL, 0, 0,
           0,
           CASE WHEN h.transactiontype = 'RECEIPT' THEN -d.instrumentamt ELSE 0 END,
           0,
           CASE WHEN h.transactiontype = 'PAYMENT' THEN -d.instrumentamt ELSE 0 END,
           NULL, d.instrumentamt, NULL, NULL, NULL, NULL, NULL,
           1, d.instrumentno, d.instrumenttype, 1, d.maturitydate, d.processmemo
    FROM ReceiptPayment02t d
    JOIN ReceiptPayment01t h ON h.companyid = d.companyid AND h.receiptno = d.receiptno
    WHERE d.companyid = %(companyid)s AND h.transactiontype IN ('RECEIPT', 'PAYMENT')
      AND d.instrumentstatus = 'DISHONORED' AND d.instrumentamt > 0 AND d.processdate IS NOT NULL
)
"""

# ── 거래처 한 곳만 볼 때(원장 단건 · 여신 통제): 전표 헤더를 그 거래처로 먼저 거르고 상세는 그 전표만 집계한다.
# 결과는 ENTRIES_SQL 에 "WHERE ckey = %(ckey)s" 를 건 것과 같다 (바깥 조건도 그대로 남겨 둔다).
# 안쪽 조건은 읽는 범위만 줄이는 용도이며 (companyid, BTRIM(customcode)) 식 인덱스를 탄다.
def _customer_match(code: str, name: str, by_name: bool) -> str:
    if by_name:
        return f"(NULLIF(BTRIM({code}), '') IS NULL AND 'NAME:' || BTRIM(COALESCE({name}, '')) = %(ckey)s)"
    return f"BTRIM({code}) = %(ckey)s"


def _build_customer_entries_sql(by_name: bool) -> str:
    def m(alias: str) -> str:
        return _customer_match(f"{alias}.customcode", f"{alias}.customname", by_name)

    def headers(table: str) -> str:
        return f"receiptno IN (SELECT h.receiptno FROM {table} h WHERE h.companyid = %(companyid)s AND {m('h')})"

    nl = "\n"
    sql = ENTRIES_SQL
    replacements = [
        ("FROM Outbound02t WHERE companyid = %(companyid)s GROUP BY companyid, receiptno",
         f"FROM Outbound02t WHERE companyid = %(companyid)s AND {headers('Outbound01t')} GROUP BY companyid, receiptno"),
        ("    WHERE companyid = %(companyid)s AND UPPER(COALESCE(purchaseyn, 'N')) <> 'Y'" + nl + "    GROUP BY companyid, receiptno",
         f"    WHERE companyid = %(companyid)s AND UPPER(COALESCE(purchaseyn, 'N')) <> 'Y' AND {headers('Outbound01t')}" + nl + "    GROUP BY companyid, receiptno"),
        ("FROM Inbound02t WHERE companyid = %(companyid)s GROUP BY companyid, receiptno",
         f"FROM Inbound02t WHERE companyid = %(companyid)s AND {headers('Inbound01t')} GROUP BY companyid, receiptno"),
        (f"    WHERE x.companyid = %(companyid)s AND NOT {_in_exp_separate('x', 'h')}" + nl + "    GROUP BY x.companyid, x.receiptno",
         f"    WHERE x.companyid = %(companyid)s AND NOT {_in_exp_separate('x', 'h')} AND {m('h')}" + nl + "    GROUP BY x.companyid, x.receiptno"),
        (f"        WHERE e.companyid = %(companyid)s AND {_in_exp_separate('e', 'eh')}" + nl,
         f"        WHERE e.companyid = %(companyid)s AND {_in_exp_separate('e', 'eh')} AND {m('e')}" + nl),
        ("    FROM ReceiptPayment02t WHERE companyid = %(companyid)s GROUP BY companyid, receiptno",
         f"    FROM ReceiptPayment02t WHERE companyid = %(companyid)s AND {headers('ReceiptPayment01t')} GROUP BY companyid, receiptno"),
        ("    LEFT JOIN out_exp e ON e.companyid = h.companyid AND e.receiptno = h.receiptno" + nl + "    WHERE h.companyid = %(companyid)s" + nl,
         "    LEFT JOIN out_exp e ON e.companyid = h.companyid AND e.receiptno = h.receiptno" + nl + f"    WHERE h.companyid = %(companyid)s AND {m('h')}" + nl),
        ("    LEFT JOIN in_exp e ON e.companyid = h.companyid AND e.receiptno = h.receiptno" + nl + "    WHERE h.companyid = %(companyid)s" + nl,
         "    LEFT JOIN in_exp e ON e.companyid = h.companyid AND e.receiptno = h.receiptno" + nl + f"    WHERE h.companyid = %(companyid)s AND {m('h')}" + nl),
        ("    WHERE x.companyid = %(companyid)s AND UPPER(COALESCE(x.purchaseyn, 'N')) = 'Y'" + nl,
         f"    WHERE x.companyid = %(companyid)s AND UPPER(COALESCE(x.purchaseyn, 'N')) = 'Y' AND {m('x')}" + nl),
        ("    WHERE p.companyid = %(companyid)s" + nl + "      AND (NULLIF(BTRIM(p.customcode), '') IS NOT NULL",
         f"    WHERE p.companyid = %(companyid)s AND {m('p')}" + nl + "      AND (NULLIF(BTRIM(p.customcode), '') IS NOT NULL"),
        ("    WHERE h.companyid = %(companyid)s AND h.transactiontype IN ('RECEIPT', 'PAYMENT')" + nl + "    UNION ALL",
         f"    WHERE h.companyid = %(companyid)s AND h.transactiontype IN ('RECEIPT', 'PAYMENT') AND {m('h')}" + nl + "    UNION ALL"),
        ("    WHERE d.companyid = %(companyid)s AND h.transactiontype IN ('RECEIPT', 'PAYMENT')" + nl + "      AND d.instrumentstatus = 'DISHONORED'",
         f"    WHERE d.companyid = %(companyid)s AND h.transactiontype IN ('RECEIPT', 'PAYMENT') AND {m('h')}" + nl + "      AND d.instrumentstatus = 'DISHONORED'"),
    ]
    for old, new in replacements:
        if sql.count(old) != 1:
            raise RuntimeError(f"ENTRIES_SQL layout changed; cannot build customer filter: {old[:60]!r}")
        sql = sql.replace(old, new)
    return sql


_CUSTOMER_ENTRIES_SQL = {False: _build_customer_entries_sql(False), True: _build_customer_entries_sql(True)}


def _entries_for_customer(ckey: str) -> str:
    return _CUSTOMER_ENTRIES_SQL[str(ckey or "").startswith("NAME:")]


# 대시보드용 가벼운 집계: ENTRIES_SQL 과 금액·일자·순서 칸은 같고, 적요용 칸(첫 품목명·건수·증권번호)은 뺀다.
DASHBOARD_ENTRIES_SQL = f"""
WITH
out_amt AS (
    SELECT receiptno, SUM(COALESCE(supplyamt, 0) + CASE WHEN %(with_vat)s THEN COALESCE(vat, 0) ELSE 0 END) AS amt
    FROM Outbound02t WHERE companyid = %(companyid)s GROUP BY receiptno
),
out_exp AS (
    SELECT receiptno, SUM(CASE WHEN %(with_vat)s THEN COALESCE(totalamt, 0) ELSE COALESCE(supplyamt, 0) END) AS amt
    FROM Outbound03t WHERE companyid = %(companyid)s AND UPPER(COALESCE(purchaseyn, 'N')) <> 'Y' GROUP BY receiptno
),
in_amt AS (
    SELECT receiptno, SUM(COALESCE(supplyamt, 0) + CASE WHEN %(with_vat)s THEN COALESCE(vat, 0) ELSE 0 END) AS amt
    FROM Inbound02t WHERE companyid = %(companyid)s GROUP BY receiptno
),
in_exp AS (
    SELECT x.receiptno, SUM(CASE WHEN %(with_vat)s THEN COALESCE(x.totalamt, 0) ELSE COALESCE(x.supplyamt, 0) END) AS amt
    FROM Inbound03t x JOIN Inbound01t h ON h.companyid = x.companyid AND h.receiptno = x.receiptno
    WHERE x.companyid = %(companyid)s AND NOT {_in_exp_separate('x', 'h')} GROUP BY x.receiptno
),
rp AS (
    SELECT receiptno, SUM(COALESCE(cashamt, 0) + COALESCE(instrumentamt, 0) + COALESCE(bankamt, 0)
                          + COALESCE(cardamt, 0)) AS amt,
           SUM(COALESCE(lossamt, 0)) AS lossamt, SUM(COALESCE(chargeamt, 0)) AS chargeamt, SUM(COALESCE(offsetamt, 0)) AS offsetamt
    FROM ReceiptPayment02t WHERE companyid = %(companyid)s GROUP BY receiptno
),
entries AS (
    SELECT {_KEY.format(code='h.customcode', name='h.customname')} AS ckey, h.customcode, h.customname,
           h.receptdate AS entrydate, 1 AS kindorder, h.receiptno AS docno,
           COALESCE(i.amt, 0) + COALESCE(e.amt, 0) AS sales, 0::numeric AS receipt, 0::numeric AS purchase, 0::numeric AS payment
    FROM Outbound01t h
    LEFT JOIN out_amt i ON i.receiptno = h.receiptno
    LEFT JOIN out_exp e ON e.receiptno = h.receiptno
    WHERE h.companyid = %(companyid)s
    UNION ALL
    SELECT {_KEY.format(code='h.customcode', name='h.customname')}, h.customcode, h.customname,
           h.receptdate, 3, h.receiptno, 0, 0, COALESCE(i.amt, 0) + COALESCE(e.amt, 0), 0
    FROM Inbound01t h
    LEFT JOIN in_amt i ON i.receiptno = h.receiptno
    LEFT JOIN in_exp e ON e.receiptno = h.receiptno
    WHERE h.companyid = %(companyid)s
    UNION ALL
    SELECT {_KEY.format(code='x.customcode', name='x.customname')}, MAX(x.customcode), MAX(x.customname),
           h.receptdate, 4, h.receiptno, 0, 0, SUM(CASE WHEN %(with_vat)s THEN COALESCE(x.totalamt, 0) ELSE COALESCE(x.supplyamt, 0) END), 0
    FROM (
        SELECT 'OUT' AS src, companyid, receiptno, customcode, customname, supplyamt, totalamt, purchaseyn FROM Outbound03t
        UNION ALL
        SELECT 'IN', e.companyid, e.receiptno, e.customcode, e.customname, e.supplyamt, e.totalamt, 'Y'
        FROM Inbound03t e JOIN Inbound01t eh ON eh.companyid = e.companyid AND eh.receiptno = e.receiptno
        WHERE e.companyid = %(companyid)s AND {_in_exp_separate('e', 'eh')}
    ) x
    JOIN (
        SELECT 'OUT' AS src, companyid, receiptno, receptdate FROM Outbound01t
        UNION ALL
        SELECT 'IN', companyid, receiptno, receptdate FROM Inbound01t
    ) h ON h.src = x.src AND h.companyid = x.companyid AND h.receiptno = x.receiptno
    WHERE x.companyid = %(companyid)s AND UPPER(COALESCE(x.purchaseyn, 'N')) = 'Y'
      AND (NULLIF(BTRIM(x.customcode), '') IS NOT NULL OR NULLIF(BTRIM(x.customname), '') IS NOT NULL)
    GROUP BY 1, h.receptdate, h.receiptno, x.src
    UNION ALL
    SELECT {_KEY.format(code='p.customcode', name='p.customname')}, p.customcode, p.customname,
           p.processdate, 4, p.processno, 0, 0, COALESCE(SUM(COALESCE(d.supplyamt, 0) + CASE WHEN %(with_vat)s THEN COALESCE(d.vat, 0) ELSE 0 END), 0), 0
    FROM Process01t p
    LEFT JOIN Process02t d ON d.companyid = p.companyid AND d.processno = p.processno
    WHERE p.companyid = %(companyid)s
      AND (NULLIF(BTRIM(p.customcode), '') IS NOT NULL OR NULLIF(BTRIM(p.customname), '') IS NOT NULL)
    GROUP BY p.companyid, p.processno, p.processdate, p.customcode, p.customname
    UNION ALL
    SELECT {_KEY.format(code='h.customcode', name='h.customname')}, h.customcode, h.customname,
           h.receiptdate, CASE WHEN h.transactiontype = 'RECEIPT' THEN 2 ELSE 5 END, h.receiptno,
           0, r.offsetamt + CASE WHEN h.transactiontype = 'RECEIPT' THEN r.amt + r.lossamt - r.chargeamt ELSE 0 END,
           0, r.offsetamt + CASE WHEN h.transactiontype = 'PAYMENT' THEN r.amt - r.lossamt + r.chargeamt ELSE 0 END
    FROM ReceiptPayment01t h
    JOIN rp r ON r.receiptno = h.receiptno
    WHERE h.companyid = %(companyid)s AND h.transactiontype IN ('RECEIPT', 'PAYMENT')
    UNION ALL
    SELECT {_KEY.format(code='h.customcode', name='h.customname')}, h.customcode, h.customname,
           d.processdate, 6, h.receiptno,
           0, CASE WHEN h.transactiontype = 'RECEIPT' THEN -d.instrumentamt ELSE 0 END,
           0, CASE WHEN h.transactiontype = 'PAYMENT' THEN -d.instrumentamt ELSE 0 END
    FROM ReceiptPayment02t d
    JOIN ReceiptPayment01t h ON h.companyid = d.companyid AND h.receiptno = d.receiptno
    WHERE d.companyid = %(companyid)s AND h.transactiontype IN ('RECEIPT', 'PAYMENT')
      AND d.instrumentstatus = 'DISHONORED' AND d.instrumentamt > 0 AND d.processdate IS NOT NULL
)
"""

# 비용여부 '예' 기타비용(COST)은 그 거래처의 매입으로 표시한다
KIND_NAMES = {"SALES": "매출", "RECEIPT": "수금", "PURCHASE": "매입", "PAYMENT": "지급", "COST": "매입", "DISHONOR": "부도", "PROCESS": "가공"}


def _num(value) -> Decimal:
    return Decimal(str(value)) if value is not None else ZERO


def _money(value) -> str:
    return f"{_num(value):,.0f}"


def _summary(row: dict) -> str:
    kind = row["kind"]
    if kind == "PROCESS":
        name = str(row.get("firstname") or "가공").strip()
        count = int(row.get("cnt") or 0)
        return f"가공 {name}{f' 외 {count - 1}건' if count > 1 else ''}"
    if kind in ("SALES", "PURCHASE", "COST"):
        name = str(row.get("firstname") or "").strip()
        count = int(row.get("cnt") or 0)
        if kind == "COST":
            text = f"{name or '기타비용'}{f' 외 {count - 1}건' if count > 1 else ''} ({row.get('description') or ''})"
            return text.replace(' ()', '')
        text = f"{name}{f' 외 {count - 1}건' if count > 1 else ''}" if name else "(품목 없음)"
        if _num(row.get("extraamt")) > 0:
            text += f" + 기타비용 {_money(row['extraamt'])}"
        return text
    if kind == "DISHONOR":
        code = str(row.get("instrumenttype") or "").strip()
        name = INSTRUMENT_TYPE_NAMES.get(code, code) or "수표/어음"
        detail = ", ".join(filter(None, [str(row.get("instrumentno") or "").strip(),
                                         f"만기 {row['maturitydate']}" if row.get("maturitydate") else ""]))
        return f"{name} {_money(row['instrumentamt'])} 부도{f' ({detail})' if detail else ''}"
    parts = []
    # 적요: 현금 · 증권 · 상계 · 잡손실 · 잡이익 (은행예금 · 카드는 수금/지급등록에서 쓰지 않아 적요에 넣지 않는다. 금액 합계에는 그대로 포함)
    for field, label in (("cashamt", "현금"), ("offsetamt", "상계"), ("lossamt", "잡손실")):
        if _num(row.get(field)) > 0:
            parts.append(f"{label} {_money(row[field])}")
    if _num(row.get("instrumentamt")) > 0:
        detail = str(row.get("instrumentno") or "").strip()
        maturity = row.get("maturitydate")
        extra = ", ".join(filter(None, [detail, f"만기 {maturity}" if maturity else ""]))
        count = int(row.get("instrumentcnt") or 0)
        more = f" 외 {count - 1}장" if count > 1 else ""
        code = str(row.get("instrumenttype") or "").strip()
        name = INSTRUMENT_TYPE_NAMES.get(code, code) or "수표/어음"
        if int(row.get("instrumenttypecnt") or 0) > 1:
            name = "수표/어음"  # 종류가 섞인 전표
        parts.insert(1, f"{name} {_money(row['instrumentamt'])}{f' ({extra}{more})' if extra or more else ''}")
    if _num(row.get("chargeamt")) > 0:
        parts.append(f"잡이익 {_money(row['chargeamt'])}")
    return " · ".join(parts)


def _row_dict(cursor, row):
    return dict(zip((column[0] for column in cursor.description), row))


def get_settings(companyid: str) -> dict:
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute("SELECT ledgerstartdate FROM company01t WHERE companyid = %s", (companyid,))
        row = cursor.fetchone()
    return {"ledgerstartdate": row[0] if row else None}


def update_start_date(companyid: str, start: date | None, actor: str) -> dict:
    """원장 시작일은 모든 잔액의 기준이므로, 월마감이 있으면 마감된 달에 영향을 주는 변경을 막는다."""
    from services.closing import MonthClose as month_close_module

    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute("SELECT ledgerstartdate FROM company01t WHERE companyid = %s FOR UPDATE", (companyid,))
        row = cursor.fetchone()
        current = row[0] if row else None
        through = month_close_module.closed_through(cursor, companyid)
        if through and current != start and (current is None or start is None or min(current, start) <= through):
            raise ValueError(
                f"{through:%Y-%m}월까지 월마감되어 그 기간에 영향을 주는 원장 시작일 변경은 할 수 없습니다. "
                "월마감을 취소한 뒤 바꿔 주세요."
            )
        cursor.execute(
            "UPDATE company01t SET ledgerstartdate = %s, updatedat = NOW(), updated_by = %s WHERE companyid = %s",
            (start, actor or None, companyid),
        )
    return get_settings(companyid)


def list_balances(companyid: str, date_from: date, date_to: date, keyword: str = "", balance_only: bool = False,
                  with_vat: bool = False) -> dict:
    """거래처별 기초 · 기간 증감 · 기말 잔액. with_vat=False: 공급가 기준, True: 합계금액(공급가 + 부가세) 기준."""
    start = get_settings(companyid)["ledgerstartdate"]
    params = {"companyid": companyid, "start": start, "date_from": date_from, "date_to": date_to,
              "keyword": f"%{keyword.strip().lower()}%", "with_vat": bool(with_vat)}
    with _connect() as connection, connection.cursor() as cursor:
        _shared_db.use_report_memory(cursor)   # 전체 전표 집계: 이 트랜잭션만 정렬 메모리 확대
        cursor.execute(
            ENTRIES_SQL + """,
            scoped AS (
                SELECT * FROM entries
                WHERE (%(start)s::date IS NULL OR entrydate >= %(start)s::date) AND entrydate <= %(date_to)s
            ),
            moves AS (
                SELECT ckey, MAX(customcode) AS customcode, MAX(customname) AS customname,
                       SUM(sales - receipt) FILTER (WHERE entrydate < %(date_from)s) AS recv_before,
                       SUM(purchase - payment) FILTER (WHERE entrydate < %(date_from)s) AS pay_before,
                       SUM(sales) FILTER (WHERE entrydate >= %(date_from)s) AS sales,
                       SUM(receipt) FILTER (WHERE entrydate >= %(date_from)s) AS receipt,
                       SUM(purchase) FILTER (WHERE entrydate >= %(date_from)s) AS purchase,
                       SUM(payment) FILTER (WHERE entrydate >= %(date_from)s) AS payment
                FROM scoped GROUP BY ckey
            ),
            customers AS (
                SELECT customercode AS ckey, customercode, customername,
                       COALESCE(openingreceivable, 0) AS openingreceivable, COALESCE(openingpayable, 0) AS openingpayable
                FROM customer01t WHERE companyid = %(companyid)s
            )
            SELECT COALESCE(c.ckey, m.ckey) AS ckey,
                   COALESCE(c.customercode, m.customcode, '') AS customcode,
                   COALESCE(c.customername, m.customname, '') AS customname,
                   COALESCE(c.openingreceivable, 0) + COALESCE(m.recv_before, 0) AS recv_open,
                   COALESCE(m.sales, 0) AS sales, COALESCE(m.receipt, 0) AS receipt,
                   COALESCE(c.openingpayable, 0) + COALESCE(m.pay_before, 0) AS pay_open,
                   COALESCE(m.purchase, 0) AS purchase, COALESCE(m.payment, 0) AS payment
            FROM customers c
            FULL OUTER JOIN moves m ON m.ckey = c.ckey
            WHERE (%(keyword)s = '%%%%' OR LOWER(COALESCE(c.customercode, m.customcode, '')) LIKE %(keyword)s
                   OR LOWER(COALESCE(c.customername, m.customname, '')) LIKE %(keyword)s)
            ORDER BY 3, 2""",
            params,
        )
        rows = [_row_dict(cursor, row) for row in cursor.fetchall()]
    result = []
    totals = {key: ZERO for key in ("recv_open", "sales", "receipt", "recv_close", "pay_open", "purchase", "payment", "pay_close")}
    for row in rows:
        row["recv_close"] = _num(row["recv_open"]) + _num(row["sales"]) - _num(row["receipt"])
        row["pay_close"] = _num(row["pay_open"]) + _num(row["purchase"]) - _num(row["payment"])
        values = [row[key] for key in totals]
        if not any(_num(value) for value in values):
            continue  # 기초도 거래도 없는 거래처는 목록에서 뺀다
        if balance_only and not (_num(row["recv_close"]) or _num(row["pay_close"])):
            continue
        for key in totals:
            totals[key] += _num(row[key])
        result.append(row)
    return {"items": result, "totals": totals, "ledgerstartdate": start}


def get_ledger(companyid: str, ckey: str, date_from: date, date_to: date, with_vat: bool = False) -> dict:
    """한 거래처의 원장: 이월 잔액 + 기간 내 전표 (일자순) + 미수·미지급 잔액 누계. 금액 기준은 list_balances 와 같다."""
    start = get_settings(companyid)["ledgerstartdate"]
    params = {"companyid": companyid, "ckey": ckey, "start": start, "date_from": date_from, "date_to": date_to, "with_vat": bool(with_vat)}
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """SELECT customercode, customername, COALESCE(openingreceivable, 0), COALESCE(openingpayable, 0)
               FROM customer01t WHERE companyid = %s AND customercode = %s""",
            (companyid, ckey),
        )
        customer = cursor.fetchone()
        cursor.execute(
            _entries_for_customer(ckey) + """
            SELECT * FROM entries
            WHERE ckey = %(ckey)s AND (%(start)s::date IS NULL OR entrydate >= %(start)s::date) AND entrydate <= %(date_to)s
            ORDER BY entrydate, kindorder, docno""",
            params,
        )
        rows = [_row_dict(cursor, row) for row in cursor.fetchall()]
    recv = _num(customer[2]) if customer else ZERO
    pay = _num(customer[3]) if customer else ZERO
    name = customer[1] if customer else (rows[0]["customname"] if rows else "")
    lines = []
    for row in rows:
        if row["entrydate"] < date_from:
            recv += _num(row["sales"]) - _num(row["receipt"])
            pay += _num(row["purchase"]) - _num(row["payment"])
    # 이월 = 거래처관리 기초잔액(base) + 시작일~조회 시작 전 거래 (화면에서 둘을 나눠 보여준다)
    opening = {"recv": recv, "pay": pay, "base_recv": _num(customer[2]) if customer else ZERO, "base_pay": _num(customer[3]) if customer else ZERO}
    for row in rows:
        if row["entrydate"] < date_from:
            continue
        recv += _num(row["sales"]) - _num(row["receipt"])
        pay += _num(row["purchase"]) - _num(row["payment"])
        lines.append({
            "entrydate": row["entrydate"], "kind": row["kind"], "kindname": KIND_NAMES.get(row["kind"], row["kind"]),
            "docno": row["docno"], "summary": _summary(row), "description": row["description"] if row["kind"] != "COST" else "",
            "sales": row["sales"], "receipt": row["receipt"], "recv_balance": recv,
            "purchase": row["purchase"], "payment": row["payment"], "pay_balance": pay,
        })
    totals = {key: sum((_num(line[key]) for line in lines), ZERO) for key in ("sales", "receipt", "purchase", "payment")}
    return {
        "customer": {"ckey": ckey, "customcode": customer[0] if customer else ("" if ckey.startswith("NAME:") else ckey), "customname": name},
        "ledgerstartdate": start, "opening": opening, "lines": lines, "totals": totals,
        "closing": {"recv": recv, "pay": pay},
    }


# ---------------------------------------------------------------------------
# 거래처 잔액 현황 (메뉴: CUSTOMER_BALANCE_DASHBOARD)
# 원장과 같은 전표 집계(ENTRIES_SQL)를 쓰므로 숫자가 거래처원장과 항상 같다.
# ---------------------------------------------------------------------------
AGING_BUCKETS = [("d30", "30일 이내", 0, 30), ("d60", "31~60일", 31, 60), ("d90", "61~90일", 61, 90), ("over90", "90일 초과", 91, None)]


def _month_start(value: date) -> date:
    return value.replace(day=1)


def _add_months(value: date, months: int) -> date:
    index = value.year * 12 + value.month - 1 + months
    return date(index // 12, index % 12 + 1, 1)


# 채권채무요약 거래처 조건: ckey 가 없으면 전체 (ENTRIES 의 거래처 키와 같은 식)
def _ckey_filter(code: str, name: str) -> str:
    return f"AND (%(ckey)s::varchar IS NULL OR {_KEY.format(code=code, name=name)} = %(ckey)s::varchar)"


# 채권채무요약 카드 마우스 올림: 기간 합계를 어디서 왔는지 나눠서 (ENTRIES 와 같은 규칙 · 같은 금액 기준)
_PERIOD_PARTS_SQL = f"""
WITH rp AS (
    SELECT h.transactiontype AS t,
           COALESCE(d.cashamt, 0) + COALESCE(d.bankamt, 0) + COALESCE(d.cardamt, 0) AS cash,
           COALESCE(d.instrumentamt, 0) AS inst, COALESCE(d.offsetamt, 0) AS offs,
           COALESCE(d.lossamt, 0) AS loss, COALESCE(d.chargeamt, 0) AS gain
    FROM ReceiptPayment02t d JOIN ReceiptPayment01t h ON h.companyid = d.companyid AND h.receiptno = d.receiptno
    WHERE d.companyid = %(companyid)s AND h.receiptdate BETWEEN %(pf)s AND %(as_of)s {_ckey_filter('h.customcode', 'h.customname')}
),
dish AS (
    SELECT h.transactiontype AS t, COALESCE(d.instrumentamt, 0) AS amt
    FROM ReceiptPayment02t d JOIN ReceiptPayment01t h ON h.companyid = d.companyid AND h.receiptno = d.receiptno
    WHERE d.companyid = %(companyid)s AND d.instrumentstatus = 'DISHONORED' AND d.instrumentamt > 0
      AND d.processdate BETWEEN %(pf)s AND %(as_of)s {_ckey_filter('h.customcode', 'h.customname')}
)
SELECT
  (SELECT COALESCE(SUM(COALESCE(d.supplyamt, 0) + CASE WHEN %(with_vat)s THEN COALESCE(d.vat, 0) ELSE 0 END), 0)
     FROM Outbound02t d JOIN Outbound01t h ON h.companyid = d.companyid AND h.receiptno = d.receiptno
    WHERE h.companyid = %(companyid)s AND h.receptdate BETWEEN %(pf)s AND %(as_of)s {_ckey_filter('h.customcode', 'h.customname')}) AS sales_goods,
  (SELECT COALESCE(SUM(CASE WHEN %(with_vat)s THEN COALESCE(x.totalamt, 0) ELSE COALESCE(x.supplyamt, 0) END), 0)
     FROM Outbound03t x JOIN Outbound01t h ON h.companyid = x.companyid AND h.receiptno = x.receiptno
    WHERE h.companyid = %(companyid)s AND h.receptdate BETWEEN %(pf)s AND %(as_of)s AND UPPER(COALESCE(x.purchaseyn, 'N')) <> 'Y' {_ckey_filter('h.customcode', 'h.customname')}) AS sales_plus,
  (SELECT COALESCE(SUM(COALESCE(d.supplyamt, 0) + CASE WHEN %(with_vat)s THEN COALESCE(d.vat, 0) ELSE 0 END), 0)
     FROM Inbound02t d JOIN Inbound01t h ON h.companyid = d.companyid AND h.receiptno = d.receiptno
    WHERE h.companyid = %(companyid)s AND h.receptdate BETWEEN %(pf)s AND %(as_of)s {_ckey_filter('h.customcode', 'h.customname')}) AS purchase_goods,
  (SELECT COALESCE(SUM(CASE WHEN %(with_vat)s THEN COALESCE(x.totalamt, 0) ELSE COALESCE(x.supplyamt, 0) END), 0)
     FROM Inbound03t x JOIN Inbound01t h ON h.companyid = x.companyid AND h.receiptno = x.receiptno
    WHERE h.companyid = %(companyid)s AND h.receptdate BETWEEN %(pf)s AND %(as_of)s AND NOT {_in_exp_separate('x', 'h')}
      {_ckey_filter('h.customcode', 'h.customname')}) AS purchase_exp,
  (SELECT COALESCE(SUM(CASE WHEN %(with_vat)s THEN COALESCE(x.totalamt, 0) ELSE COALESCE(x.supplyamt, 0) END), 0)
     FROM Inbound03t x JOIN Inbound01t h ON h.companyid = x.companyid AND h.receiptno = x.receiptno
    WHERE h.companyid = %(companyid)s AND h.receptdate BETWEEN %(pf)s AND %(as_of)s AND {_in_exp_separate('x', 'h')}
      {_ckey_filter('x.customcode', 'x.customname')}) AS purchase_exp_other,
  (SELECT COALESCE(SUM(CASE WHEN %(with_vat)s THEN COALESCE(x.totalamt, 0) ELSE COALESCE(x.supplyamt, 0) END), 0)
     FROM Outbound03t x JOIN Outbound01t h ON h.companyid = x.companyid AND h.receiptno = x.receiptno
    WHERE h.companyid = %(companyid)s AND h.receptdate BETWEEN %(pf)s AND %(as_of)s AND UPPER(COALESCE(x.purchaseyn, 'N')) = 'Y'
      AND (NULLIF(BTRIM(x.customcode), '') IS NOT NULL OR NULLIF(BTRIM(x.customname), '') IS NOT NULL)
      {_ckey_filter('x.customcode', 'x.customname')}) AS purchase_cost,
  (SELECT COALESCE(SUM(COALESCE(d.supplyamt, 0) + CASE WHEN %(with_vat)s THEN COALESCE(d.vat, 0) ELSE 0 END), 0)
     FROM Process02t d JOIN Process01t p ON p.companyid = d.companyid AND p.processno = d.processno
    WHERE p.companyid = %(companyid)s AND p.processdate BETWEEN %(pf)s AND %(as_of)s
      AND (NULLIF(BTRIM(p.customcode), '') IS NOT NULL OR NULLIF(BTRIM(p.customname), '') IS NOT NULL)
      {_ckey_filter('p.customcode', 'p.customname')}) AS purchase_process,
  (SELECT COALESCE(SUM(cash), 0) FROM rp WHERE t = 'RECEIPT') AS r_cash,
  (SELECT COALESCE(SUM(inst), 0) FROM rp WHERE t = 'RECEIPT') AS r_inst,
  (SELECT COALESCE(SUM(offs), 0) FROM rp WHERE t = 'RECEIPT') AS r_offset,
  (SELECT COALESCE(SUM(loss), 0) FROM rp WHERE t = 'RECEIPT') AS r_loss,
  (SELECT COALESCE(SUM(gain), 0) FROM rp WHERE t = 'RECEIPT') AS r_gain,
  (SELECT COALESCE(SUM(offs), 0) FROM rp WHERE t = 'PAYMENT') AS r_cross_offset,
  (SELECT COALESCE(SUM(amt), 0) FROM dish WHERE t = 'RECEIPT') AS r_dishonor,
  (SELECT COALESCE(SUM(cash), 0) FROM rp WHERE t = 'PAYMENT') AS p_cash,
  (SELECT COALESCE(SUM(inst), 0) FROM rp WHERE t = 'PAYMENT') AS p_inst,
  (SELECT COALESCE(SUM(offs), 0) FROM rp WHERE t = 'PAYMENT') AS p_offset,
  (SELECT COALESCE(SUM(loss), 0) FROM rp WHERE t = 'PAYMENT') AS p_loss,
  (SELECT COALESCE(SUM(gain), 0) FROM rp WHERE t = 'PAYMENT') AS p_gain,
  (SELECT COALESCE(SUM(offs), 0) FROM rp WHERE t = 'RECEIPT') AS p_cross_offset,
  (SELECT COALESCE(SUM(amt), 0) FROM dish WHERE t = 'PAYMENT') AS p_dishonor
"""

TREND_MIN_MONTHS = 6    # 기간이 짧아도 월말 잔액 추이는 최소 6개월을 보여 준다
TREND_MAX_MONTHS = 36   # 기간이 길면 마지막 36개월만


def _months_between(first: date, last: date) -> int:
    return (last.year - first.year) * 12 + last.month - first.month + 1


def dashboard(companyid: str, as_of: date, top_n: int = 10, with_vat: bool = False, date_from: date | None = None,
              ckey: str | None = None) -> dict:
    """회사 전체 받을 돈 / 줄 돈 현황.

    - 잔액(미수금 · 미지급금 · 순잔액 · 상위 거래처 · 경과 기간): 종료일(as_of) 시점
    - 기간 합계(매출 · 수금 · 매입 · 지급): date_from ~ as_of (date_from 이 없으면 종료일이 속한 달 1일부터 = 예전 '이번 달')
    - 비교 기준: 시작일 전날 잔액 (summary.open_*)
    - 월말 잔액 추이: 기간의 월 (최소 6개월, 최대 36개월). date_from 이 없으면 최근 12개월 (홈 화면)
    - ckey 가 있으면 그 거래처 하나만 (거래처원장의 그 거래처와 같은 숫자)
    전표를 한 줄씩 가져오지 않고 SQL 에서 (거래처 x 월 x 기간 전/후) 합계와 선입선출 미수 잔여분만 계산해 가져온다.
    """
    start = get_settings(companyid)["ledgerstartdate"]
    end_month = _month_start(as_of)
    if date_from is None:
        period_from = end_month
        month_from = _add_months(end_month, -11)
    else:
        period_from = min(date_from, as_of)
        month_from = _month_start(period_from)
        span = _months_between(month_from, end_month)
        if span < TREND_MIN_MONTHS:
            month_from = _add_months(end_month, -(TREND_MIN_MONTHS - 1))
        elif span > TREND_MAX_MONTHS:
            month_from = _add_months(end_month, -(TREND_MAX_MONTHS - 1))
    params = {"companyid": companyid, "start": start, "as_of": as_of, "month_from": month_from, "period_from": period_from,
              "with_vat": bool(with_vat), "ckey": ckey or None}
    with _connect() as connection, connection.cursor() as cursor:
        _shared_db.use_report_memory(cursor)   # 전체 전표 집계: 이 트랜잭션만 정렬 메모리 확대
        cursor.execute(
            DASHBOARD_ENTRIES_SQL + """,
            scoped AS MATERIALIZED (
                SELECT ckey, customcode, customname, entrydate, kindorder, docno, sales, receipt, purchase, payment
                FROM entries
                WHERE (%(start)s::date IS NULL OR entrydate >= %(start)s::date) AND entrydate <= %(as_of)s
                  AND (%(ckey)s::varchar IS NULL OR ckey = %(ckey)s::varchar)
            ),
            -- 미수금 선입선출: 기초미수 -> 매출(일자·종류·전표순) 순으로 쌓고, 그 거래처의 수금 합계만큼 앞에서부터 지운다
            debits AS (
                SELECT customercode::varchar AS ckey, %(start)s::date AS d, 0 AS o1, 0 AS o2, ''::varchar AS o3,
                       openingreceivable AS amt
                FROM customer01t
                WHERE companyid = %(companyid)s AND COALESCE(openingreceivable, 0) > 0
                  AND (%(ckey)s::varchar IS NULL OR customercode = %(ckey)s::varchar)
                UNION ALL
                SELECT ckey, entrydate, 1, kindorder, docno::varchar, sales FROM scoped WHERE sales <> 0
            ),
            credits AS (SELECT ckey, SUM(receipt) AS credit FROM scoped GROUP BY ckey),
            fifo AS (
                SELECT d.ckey, d.d, d.amt,
                       SUM(d.amt) OVER (PARTITION BY d.ckey ORDER BY d.o1, d.d, d.o2, d.o3
                                        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum,
                       COALESCE(c.credit, 0) AS credit
                FROM debits d LEFT JOIN credits c ON c.ckey = d.ckey
            )
            SELECT 'M' AS tag, ckey,
                   (ARRAY_AGG(customcode ORDER BY entrydate, kindorder, docno))[1] AS customcode,
                   (ARRAY_AGG(customname ORDER BY entrydate, kindorder, docno))[1] AS customname,
                   CASE WHEN entrydate < %(month_from)s THEN NULL
                        ELSE date_trunc('month', entrydate)::date END AS month,
                   entrydate < %(period_from)s AS before_period,
                   MIN(entrydate) AS first_date, MAX(entrydate) AS last_date,
                   SUM(sales) AS sales, SUM(receipt) AS receipt, SUM(purchase) AS purchase, SUM(payment) AS payment
            FROM scoped
            GROUP BY ckey, 5, 6
            UNION ALL
            SELECT 'F', ckey, NULL, NULL, d, NULL, NULL, NULL, LEAST(amt, cum - credit), NULL, NULL, NULL
            FROM fifo
            WHERE cum - credit > 0""",
            params,
        )
        rows = cursor.fetchall()
        cursor.execute(
            """SELECT customercode, customername, COALESCE(openingreceivable, 0), COALESCE(openingpayable, 0)
               FROM customer01t WHERE companyid = %s""",
            (companyid,),
        )
        customers = {code: {"name": name, "recv": _num(recv), "pay": _num(pay)} for code, name, recv, pay in cursor.fetchall()
                     if not ckey or code == ckey}
        # 기간 합계 구성 (원장 시작일 이전 전표는 원장과 같이 뺀다)
        part_from = max(start, period_from) if start else period_from
        cursor.execute(_PERIOD_PARTS_SQL, {"companyid": companyid, "pf": part_from, "as_of": as_of, "with_vat": bool(with_vat),
                                           "ckey": ckey or None})
        parts = {key: _num(value) for key, value in zip((column[0] for column in cursor.description), cursor.fetchone())}

    book = {}

    def account(ckey, code="", name=""):
        if ckey not in book:
            base = customers.get(ckey, {})
            book[ckey] = {
                "ckey": ckey, "customcode": code or ("" if ckey.startswith("NAME:") else ckey),
                "customname": base.get("name") or name or "",
                "opening_recv": base.get("recv", ZERO), "opening_pay": base.get("pay", ZERO),
                "recv": base.get("recv", ZERO), "pay": base.get("pay", ZERO),
                "credit": ZERO, "last": None,
            }
        return book[ckey]

    for ckey, info in customers.items():
        if info["recv"] or info["pay"]:
            account(ckey)

    months = {}
    for offset in range(_months_between(month_from, end_month)):
        key = _add_months(month_from, offset)
        months[key] = {"month": key.strftime("%Y-%m"), "sales": ZERO, "receipt": ZERO, "purchase": ZERO, "payment": ZERO}

    # 거래처별 (추이 첫 달 이전 합계 + 월별 증감) -> 월말 잔액 추이
    #  + 시작일 전 증감 -> 비교 기준(시작일 전날 잔액), 시작일 이후 -> 기간 합계
    before = {}
    per_month = {}
    pre_period = {}
    period = {"sales": ZERO, "receipt": ZERO, "purchase": ZERO, "payment": ZERO}
    fifo_rows = [(row[1], row[4], _num(row[8])) for row in rows if row[0] == "F"]
    # 거래처 이름·코드는 그 거래처의 가장 이른 전표 기준 (예전과 같은 결과)
    month_rows = sorted((row for row in rows if row[0] == "M"), key=lambda row: row[6])
    for _tag, ckey, code, name, month, before_period, _first, last_date, sales, receipt, purchase, payment in month_rows:
        acc = account(ckey, code, name)
        sales, receipt, purchase, payment = _num(sales), _num(receipt), _num(purchase), _num(payment)
        if before_period:
            pre = pre_period.setdefault(ckey, [ZERO, ZERO])
            pre[0] += sales - receipt
            pre[1] += purchase - payment
        else:
            period["sales"] += sales
            period["receipt"] += receipt
            period["purchase"] += purchase
            period["payment"] += payment
        acc["recv"] += sales - receipt
        acc["pay"] += purchase - payment
        acc["credit"] += receipt
        if acc["last"] is None or last_date > acc["last"]:
            acc["last"] = last_date
        if month is None:
            delta = before.setdefault(ckey, [ZERO, ZERO])
        else:
            bucket = months.get(month)
            if bucket:
                bucket["sales"] += sales
                bucket["receipt"] += receipt
                bucket["purchase"] += purchase
                bucket["payment"] += payment
            delta = per_month.setdefault(month, {}).setdefault(ckey, [ZERO, ZERO])
        delta[0] += sales - receipt
        delta[1] += purchase - payment

    # 월말 잔액 추이: 요약 카드와 같은 기준 = 거래처원장 합계 (선수금 · 선급금 거래처의 마이너스 잔액도 그대로 더한다)
    running = {ckey: [acc["opening_recv"], acc["opening_pay"]] for ckey, acc in book.items()}
    for ckey, (recv_delta, pay_delta) in before.items():
        balance = running.setdefault(ckey, [ZERO, ZERO])
        balance[0] += recv_delta
        balance[1] += pay_delta
    trend = []
    for key in sorted(months):
        for ckey, (recv_delta, pay_delta) in per_month.get(key, {}).items():
            balance = running.setdefault(ckey, [ZERO, ZERO])
            balance[0] += recv_delta
            balance[1] += pay_delta
        trend.append({**months[key],
                      "recv_balance": sum((v[0] for v in running.values()), ZERO),
                      "pay_balance": sum((v[1] for v in running.values()), ZERO)})

    # 미수금 경과 기간 (선입선출): 수금은 가장 오래된 매출(기초잔액 포함)부터 갚은 것으로 본다. (잔여분은 SQL 에서 계산)
    aging = {key: ZERO for key, *_ in AGING_BUCKETS}
    aging["unknown"] = ZERO  # 원장 시작일이 없을 때의 기초잔액 (언제 생긴 돈인지 모름)
    per_account = {}
    oldest_date = {}  # (거래처, 구간) -> 아직 남은 가장 오래된 매출일 (마우스 올림 창)
    for ckey, debit_date, left in fifo_rows:
        if left <= 0:
            continue
        per = per_account.setdefault(ckey, {key: ZERO for key in aging})
        if debit_date is None:
            per["unknown"] += left
            continue
        days = (as_of - debit_date).days
        for key, _label, low, high in AGING_BUCKETS:
            if days >= low and (high is None or days <= high):
                per[key] += left
                previous = oldest_date.get((ckey, key))
                oldest_date[(ckey, key)] = debit_date if previous is None or debit_date < previous else previous
                break
    overdue = []
    for ckey, acc in book.items():  # 거래처 순서(동점 정렬)를 예전과 같게
        per = per_account.get(ckey)
        if not per:
            continue
        for key in aging:
            aging[key] += per[key]
        late = per["d60"] + per["d90"] + per["over90"]
        if late > 0:
            overdue.append({"ckey": acc["ckey"], "customcode": acc["customcode"], "customname": acc["customname"],
                            "recv": acc["recv"], "over30": late, "over90": per["over90"]})

    def aging_customers(key, limit=10):
        # 경과 구간 마우스 올림: 그 구간에 남은 미수금이 큰 거래처 순 (최대 10곳)
        rows = [{"ckey": acc["ckey"], "customcode": acc["customcode"], "customname": acc["customname"],
                 "amount": per_account[ckey][key], "oldest": oldest_date.get((ckey, key))}
                for ckey, acc in book.items() if ckey in per_account and per_account[ckey][key] > 0]
        rows.sort(key=lambda row: row["amount"], reverse=True)
        return {"customer_count": len(rows), "customers": rows[:limit]}

    accounts = list(book.values())
    # 기초: 시작일 전날 잔액 (거래처원장의 기초 합계와 같음)
    opening = [(acc["opening_recv"] + pre_period.get(acc["ckey"], [ZERO, ZERO])[0],
                acc["opening_pay"] + pre_period.get(acc["ckey"], [ZERO, ZERO])[1]) for acc in accounts]
    open_recv = sum((recv for recv, _ in opening), ZERO)
    open_pay = sum((pay for _, pay in opening), ZERO)
    # 카드 마우스 올림: 잔액 = 전체 거래처 합계(마이너스 포함) + 마이너스 거래처(선수 · 선급)를 뺀 만큼
    breakdown = {
        **parts,
        "recv_open_all": sum((recv for recv, _ in opening), ZERO), "pay_open_all": sum((pay for _, pay in opening), ZERO),
        "recv_close_all": sum((a["recv"] for a in accounts), ZERO), "pay_close_all": sum((a["pay"] for a in accounts), ZERO),
        "advance_amount": sum((-a["recv"] for a in accounts if a["recv"] < 0), ZERO), "advance_count": sum(1 for a in accounts if a["recv"] < 0),
        "prepaid_amount": sum((-a["pay"] for a in accounts if a["pay"] < 0), ZERO), "prepaid_count": sum(1 for a in accounts if a["pay"] < 0),
    }
    # 기말: 거래처원장의 기말 미수금 · 기말 미지급금 합계와 같음 (선수금 · 선급금 거래처의 마이너스도 포함)
    recv_pos = sum((a["recv"] for a in accounts), ZERO)
    pay_pos = sum((a["pay"] for a in accounts), ZERO)
    this_month = months.get(_month_start(as_of), {})

    def top(field):
        rows = sorted((a for a in accounts if a[field] > 0), key=lambda a: a[field], reverse=True)[:top_n]
        return [{"ckey": a["ckey"], "customcode": a["customcode"], "customname": a["customname"], "amount": a[field]} for a in rows]

    attention = []
    for a in accounts:
        if a["recv"] < 0:
            attention.append(("선수금", "매출보다 " + _money(-a["recv"]) + "원 더 수금", a))
        if a["pay"] < 0:
            attention.append(("선급금", "매입보다 " + _money(-a["pay"]) + "원 더 지급", a))
        if (a["recv"] > 0 or a["pay"] > 0) and (a["last"] is None or (as_of - a["last"]).days > 90):
            attention.append(("장기 미정리", "90일 넘게 거래 없이 잔액이 남아 있음" if a["last"] else "기초잔액만 남아 있음", a))
    attention_rows = [{"ckey": a["ckey"], "customcode": a["customcode"], "customname": a["customname"],
                       "kind": kind, "text": text, "recv": a["recv"], "pay": a["pay"], "last": a["last"]}
                      for kind, text, a in attention]

    return {
        "as_of": as_of, "date_from": period_from, "ledgerstartdate": start, "with_vat": bool(with_vat),
        "customer": ({"ckey": ckey, "customname": (customers.get(ckey) or {}).get("name") or (book.get(ckey) or {}).get("customname") or ""}
                     if ckey else None),
        "summary": {
            "receivable": recv_pos, "payable": pay_pos, "net": recv_pos - pay_pos,
            "receivable_customers": sum(1 for a in accounts if a["recv"] > 0),
            "payable_customers": sum(1 for a in accounts if a["pay"] > 0),
            "month_receipt": this_month.get("receipt", ZERO), "month_payment": this_month.get("payment", ZERO),
            "month_sales": this_month.get("sales", ZERO), "month_purchase": this_month.get("purchase", ZERO),
            # 기간(시작일 ~ 종료일) 합계 · 시작일 전날 잔액
            "period_sales": period["sales"], "period_receipt": period["receipt"],
            "period_purchase": period["purchase"], "period_payment": period["payment"],
            "open_receivable": open_recv, "open_payable": open_pay, "open_net": open_recv - open_pay,
        },
        "breakdown": breakdown,
        "top_receivable": top("recv"), "top_payable": top("pay"),
        "trend": trend,
        "aging": [{"key": key, "label": label, "amount": aging[key], **aging_customers(key)} for key, label, *_ in AGING_BUCKETS]
                 + ([{"key": "unknown", "label": "기초잔액(날짜 미상)", "amount": aging["unknown"], **aging_customers("unknown")}] if aging["unknown"] else []),
        "overdue": sorted(overdue, key=lambda r: r["over30"], reverse=True)[:top_n],
        "attention": sorted(attention_rows, key=lambda r: (r["kind"], -abs(r["recv"] or r["pay"])))[:30],
    }


def search_customers(companyid: str, keyword: str, limit: int = 10) -> list[dict]:
    """채권채무요약 거래처 자동완성: 거래처명 · 코드에 글자가 들어간 거래처 (이름이 같은 것 → 앞이 같은 것 → 이름순)."""
    text = (keyword or "").strip()
    if not text:
        return []
    escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """SELECT customercode, customername
               FROM customer01t
               WHERE companyid = %(companyid)s AND (customername ILIKE %(like)s OR customercode ILIKE %(like)s)
               ORDER BY (customername = %(text)s) DESC, (customername ILIKE %(prefix)s) DESC, customername, customercode
               LIMIT %(limit)s""",
            {"companyid": companyid, "like": f"%{escaped}%", "prefix": f"{escaped}%", "text": text, "limit": limit},
        )
        return [{"ckey": code, "customcode": code, "customname": name or ""} for code, name in cursor.fetchall()]


def receivable_balance(cursor, companyid: str, customercode: str, exclude_docno: str | None = None) -> Decimal:
    """여신 통제용: 거래처 한 곳의 현재 미수 잔액 (공급가 기준, 거래처원장의 기말 미수와 같은 계산).
    = 기초 미수금 + 원장 시작일 이후 (매출 + 매출처 부담 기타비용 − 수금 − 상계 …), 날짜 제한 없이 지금까지 저장된 전표 전부.
    exclude_docno: 수정 중인 매출전표 (새 금액으로 다시 더하므로 기존 금액은 뺀다)."""
    code = str(customercode or "").strip()
    if not code:
        return ZERO
    cursor.execute("SELECT ledgerstartdate FROM company01t WHERE companyid = %s", (companyid,))
    row = cursor.fetchone()
    params = {"companyid": companyid, "with_vat": False, "ckey": code, "start": row[0] if row else None,
              "exclude": str(exclude_docno or "").strip()}
    cursor.execute(
        _entries_for_customer(code) + """
        SELECT COALESCE((SELECT openingreceivable FROM customer01t WHERE companyid = %(companyid)s AND customercode = %(ckey)s), 0)
             + COALESCE((SELECT SUM(sales - receipt) FROM entries
                         WHERE ckey = %(ckey)s
                           AND (%(start)s::date IS NULL OR entrydate >= %(start)s::date)
                           AND NOT (kind = 'SALES' AND docno = %(exclude)s)), 0)""",
        params,
    )
    return _num(cursor.fetchone()[0])
