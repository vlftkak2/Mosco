"""Data-integrity invariant checker for one company.

    violations = check("T01")      # list of human readable problems (empty = consistent)
    assert_consistent("T01")       # raises AssertionError listing the problems

Every rule is computed straight from the document tables with SQL written for this checker
(it does not reuse the services' own SQL), so a service bug cannot hide itself.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import db

ZERO = Decimal("0")
TOL = Decimal("0.005")


def _rows(cursor, sql, params):
    cursor.execute(sql, params)
    columns = [c[0] for c in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


# Each rule: (name, sql returning offending rows). %(c)s = companyid.
RULES: list[tuple[str, str]] = [
    # ── stock lots ──────────────────────────────────────────────────────────
    ("lot qty/weight within 0..original",
     """SELECT sourcetype, sourceno, sourceline, qty, originalqty, weight, originalweight FROM currentstock01t
        WHERE companyid = %(c)s AND (qty < 0 OR weight < 0 OR qty > originalqty OR weight > originalweight)"""),
    ("lot cost not negative",
     """SELECT sourcetype, sourceno, sourceline, costamt, expamt, feeamt FROM currentstock01t
        WHERE companyid = %(c)s AND (costamt < 0 OR expamt < 0 OR feeamt < 0)"""),
    ("fully used lot keeps no cost (rounding leftovers)",
     """SELECT sourcetype, sourceno, sourceline, weight, costamt, expamt, feeamt FROM currentstock01t
        WHERE companyid = %(c)s AND weight = 0 AND (costamt <> 0 OR expamt <> 0 OR feeamt <> 0)"""),
    ("lot has its creating ledger row (ST/IN) with same original qty/weight/warehouse",
     """SELECT s.sourcetype, s.sourceno, s.sourceline, s.stockkind, s.originalqty, s.originalweight, i.qty AS ledger_qty,
               i.weight AS ledger_weight, s.warehousecode, i.warehousecode AS ledger_wh, i.iniokind
        FROM currentstock01t s
        LEFT JOIN iniop01t i ON i.companyid = s.companyid AND i.receiptno = s.sourceno AND i.lineno = s.sourceline
             AND i.iniotype = CASE WHEN s.sourcetype = 'OPENING' THEN 'ST' ELSE 'IN' END
        WHERE s.companyid = %(c)s
          AND (i.companyid IS NULL OR i.qty <> s.originalqty OR i.weight <> s.originalweight OR i.warehousecode <> s.warehousecode
               OR i.iniokind <> CASE s.stockkind WHEN 'OPENING' THEN 'ST' WHEN 'INBOUND' THEN 'IN'
                                                  WHEN 'TRANSFER' THEN 'MOVE_IN' WHEN 'PROCESS' THEN 'PROCESS_IN' END)"""),
    ("every IN/ST ledger row created a lot",
     """SELECT i.iniotype, i.iniokind, i.receiptno, i.lineno FROM iniop01t i
        WHERE i.companyid = %(c)s AND i.iniotype IN ('IN', 'ST')
          AND NOT EXISTS (SELECT 1 FROM currentstock01t s WHERE s.companyid = i.companyid AND s.sourceno = i.receiptno
                          AND s.sourceline = i.lineno AND s.sourcetype = CASE WHEN i.iniotype = 'ST' THEN 'OPENING' ELSE 'INBOUND' END)"""),
    ("lot consumption == outbound + transfer + process usage",
     """WITH used AS (
            SELECT stocksourcetype t, stocksourceno n, stocksourceline l, qty, weight FROM outbound02t WHERE companyid = %(c)s
            UNION ALL SELECT stocksourcetype, stocksourceno, stocksourceline, qty, weight FROM inoutmove02t WHERE companyid = %(c)s
            UNION ALL SELECT stocksourcetype, stocksourceno, stocksourceline, qty, weight FROM process02t
                      WHERE companyid = %(c)s AND linetype = 'SOURCE'
        ), u AS (SELECT t, n, l, SUM(qty) qty, SUM(weight) weight FROM used GROUP BY 1, 2, 3)
        SELECT s.sourcetype, s.sourceno, s.sourceline, s.originalqty - s.qty AS consumed_qty, COALESCE(u.qty, 0) AS used_qty,
               s.originalweight - s.weight AS consumed_weight, COALESCE(u.weight, 0) AS used_weight
        FROM currentstock01t s LEFT JOIN u ON u.t = s.sourcetype AND u.n = s.sourceno AND u.l = s.sourceline
        WHERE s.companyid = %(c)s
          AND (s.originalqty - s.qty <> COALESCE(u.qty, 0) OR s.originalweight - s.weight <> COALESCE(u.weight, 0))"""),
    ("usage points to an existing lot",
     """SELECT 'outbound' src, receiptno, lineno, stocksourcetype, stocksourceno, stocksourceline FROM outbound02t d
        WHERE companyid = %(c)s AND NOT EXISTS (SELECT 1 FROM currentstock01t s WHERE s.companyid = d.companyid
              AND s.sourcetype = d.stocksourcetype AND s.sourceno = d.stocksourceno AND s.sourceline = d.stocksourceline)
        UNION ALL
        SELECT 'transfer', receiptno, lineno, stocksourcetype, stocksourceno, stocksourceline FROM inoutmove02t d
        WHERE companyid = %(c)s AND NOT EXISTS (SELECT 1 FROM currentstock01t s WHERE s.companyid = d.companyid
              AND s.sourcetype = d.stocksourcetype AND s.sourceno = d.stocksourceno AND s.sourceline = d.stocksourceline)
        UNION ALL
        SELECT 'process', processno, lineno, stocksourcetype, stocksourceno, stocksourceline FROM process02t d
        WHERE companyid = %(c)s AND linetype = 'SOURCE' AND NOT EXISTS (SELECT 1 FROM currentstock01t s WHERE s.companyid = d.companyid
              AND s.sourcetype = d.stocksourcetype AND s.sourceno = d.stocksourceno AND s.sourceline = d.stocksourceline)"""),
    ("stock per item x warehouse == ledger IN + ST - OUT",
     """WITH l AS (
            SELECT itemcode, warehousecode,
                   SUM(CASE WHEN iniotype = 'OUT' THEN -qty ELSE qty END) qty,
                   SUM(CASE WHEN iniotype = 'OUT' THEN -weight ELSE weight END) weight
            FROM iniop01t WHERE companyid = %(c)s GROUP BY 1, 2
        ), s AS (
            SELECT itemcode, warehousecode, SUM(qty) qty, SUM(weight) weight FROM currentstock01t WHERE companyid = %(c)s GROUP BY 1, 2
        )
        SELECT COALESCE(l.itemcode, s.itemcode) itemcode, COALESCE(l.warehousecode, s.warehousecode) warehousecode,
               l.qty ledger_qty, s.qty stock_qty, l.weight ledger_weight, s.weight stock_weight
        FROM l FULL OUTER JOIN s ON s.itemcode = l.itemcode AND s.warehousecode = l.warehousecode
        WHERE COALESCE(l.qty, 0) <> COALESCE(s.qty, 0) OR COALESCE(l.weight, 0) <> COALESCE(s.weight, 0)"""),
    ("no orphan ledger rows (every iniop row belongs to a document line)",
     """SELECT i.iniotype, i.iniokind, i.receiptno, i.lineno FROM iniop01t i
        WHERE i.companyid = %(c)s AND NOT (
            (i.iniokind = 'IN' AND EXISTS (SELECT 1 FROM inbound02t d WHERE d.companyid = i.companyid AND d.receiptno = i.receiptno AND d.lineno = i.lineno))
         OR (i.iniokind = 'OUT' AND EXISTS (SELECT 1 FROM outbound02t d WHERE d.companyid = i.companyid AND d.receiptno = i.receiptno AND d.lineno = i.lineno))
         OR (i.iniokind = 'ST' AND EXISTS (SELECT 1 FROM standstock01t d JOIN currentstock01t s ON s.companyid = d.companyid
                 AND s.sourcetype = 'OPENING' AND s.sourceline = d.lineno
                 WHERE d.companyid = i.companyid AND d.lineno = i.lineno AND s.sourceno = i.receiptno))
         OR (i.iniokind IN ('MOVE_IN', 'MOVE_OUT') AND EXISTS (SELECT 1 FROM inoutmove02t d WHERE d.companyid = i.companyid
                 AND d.receiptno = i.receiptno AND i.lineno = d.lineno * 2 - CASE WHEN i.iniokind = 'MOVE_OUT' THEN 1 ELSE 0 END))
         OR (i.iniokind = 'PROCESS_OUT' AND EXISTS (SELECT 1 FROM process02t d WHERE d.companyid = i.companyid AND d.processno = i.receiptno
                 AND d.lineno = i.lineno AND d.linetype = 'SOURCE'))
         OR (i.iniokind = 'PROCESS_IN' AND EXISTS (SELECT 1 FROM process02t d WHERE d.companyid = i.companyid AND d.processno = i.receiptno
                 AND d.lineno = i.lineno AND d.linetype = 'PRODUCT'))
        )"""),
    # ── document lines vs ledger rows ─────────────────────────────────────────
    ("inbound line == ledger IN row (qty/weight/amounts/date/item/warehouse)",
     """SELECT d.receiptno, d.lineno, d.qty, i.qty lq, d.weight, i.weight lw, d.supplyamt, i.supplyamt ls, d.unitamt, i.unitamt lu,
               h.receptdate, i.iniodate
        FROM inbound02t d JOIN inbound01t h ON h.companyid = d.companyid AND h.receiptno = d.receiptno
        LEFT JOIN iniop01t i ON i.companyid = d.companyid AND i.iniotype = 'IN' AND i.receiptno = d.receiptno AND i.lineno = d.lineno
        WHERE d.companyid = %(c)s AND (i.companyid IS NULL OR i.qty <> d.qty OR i.weight <> d.weight
              OR i.supplyamt IS DISTINCT FROM d.supplyamt OR i.vat IS DISTINCT FROM d.vat OR i.unitamt IS DISTINCT FROM d.unitamt
              OR i.iniodate <> h.receptdate OR i.itemcode <> d.itemcode OR i.warehousecode <> d.warehousecode
              OR i.customcode IS DISTINCT FROM h.customcode)"""),
    ("outbound line == ledger OUT row (qty/weight/amounts/date/customer)",
     """SELECT d.receiptno, d.lineno, d.qty, i.qty lq, d.weight, i.weight lw, d.supplyamt, i.supplyamt ls, d.unitamt, i.unitamt lu,
               h.receptdate, i.iniodate, h.customcode, i.customcode lc
        FROM outbound02t d JOIN outbound01t h ON h.companyid = d.companyid AND h.receiptno = d.receiptno
        LEFT JOIN iniop01t i ON i.companyid = d.companyid AND i.iniotype = 'OUT' AND i.receiptno = d.receiptno AND i.lineno = d.lineno
        WHERE d.companyid = %(c)s AND (i.companyid IS NULL OR i.qty <> d.qty OR i.weight <> d.weight
              OR i.supplyamt IS DISTINCT FROM d.supplyamt OR i.vat IS DISTINCT FROM d.vat OR i.unitamt IS DISTINCT FROM d.unitamt
              OR i.iniodate <> h.receptdate OR i.itemcode <> d.itemcode OR i.customcode IS DISTINCT FROM h.customcode)"""),
    ("opening stock line == ledger ST row + lot",
     """SELECT d.lineno, d.qty, i.qty lq, d.weight, i.weight lw, d.unitamt, i.unitamt lu, d.standdate, i.iniodate
        FROM standstock01t d
        LEFT JOIN currentstock01t s ON s.companyid = d.companyid AND s.sourcetype = 'OPENING' AND s.sourceline = d.lineno
        LEFT JOIN iniop01t i ON i.companyid = d.companyid AND i.iniotype = 'ST' AND i.receiptno = s.sourceno AND i.lineno = d.lineno
        WHERE d.companyid = %(c)s AND (s.companyid IS NULL OR i.companyid IS NULL OR i.qty <> d.qty OR i.weight <> d.weight
              OR s.originalqty <> d.qty OR s.originalweight <> d.weight
              OR i.supplyamt IS DISTINCT FROM d.supplyamt OR i.unitamt IS DISTINCT FROM d.unitamt OR i.iniodate <> d.standdate
              OR s.unitprice IS DISTINCT FROM d.unitprice)"""),
    ("transfer line == ledger MOVE_OUT + MOVE_IN rows",
     """SELECT d.receiptno, d.lineno, d.qty, d.weight, o.qty oq, o.weight ow, n.qty nq, n.weight nw, h.receptdate, o.iniodate, n.iniodate,
               o.warehousecode o_wh, n.warehousecode n_wh, h.fromwarehousecode, h.towarehousecode
        FROM inoutmove02t d JOIN inoutmove01t h ON h.companyid = d.companyid AND h.receiptno = d.receiptno
        LEFT JOIN iniop01t o ON o.companyid = d.companyid AND o.iniotype = 'OUT' AND o.receiptno = d.receiptno AND o.lineno = d.lineno * 2 - 1
        LEFT JOIN iniop01t n ON n.companyid = d.companyid AND n.iniotype = 'IN' AND n.receiptno = d.receiptno AND n.lineno = d.lineno * 2
        WHERE d.companyid = %(c)s AND (o.companyid IS NULL OR n.companyid IS NULL OR o.qty <> d.qty OR n.qty <> d.qty
              OR o.weight <> d.weight OR n.weight <> d.weight OR o.iniodate <> h.receptdate OR n.iniodate <> h.receptdate
              OR o.warehousecode <> h.fromwarehousecode OR n.warehousecode <> h.towarehousecode)"""),
    ("process source line == ledger PROCESS_OUT row",
     """SELECT d.processno, d.lineno, d.qty, d.weight, i.qty lq, i.weight lw, h.processdate, i.iniodate
        FROM process02t d JOIN process01t h ON h.companyid = d.companyid AND h.processno = d.processno
        LEFT JOIN iniop01t i ON i.companyid = d.companyid AND i.iniotype = 'OUT' AND i.receiptno = d.processno AND i.lineno = d.lineno
        WHERE d.companyid = %(c)s AND d.linetype = 'SOURCE'
          AND (i.companyid IS NULL OR i.qty <> d.qty OR i.weight <> d.weight OR i.iniodate <> h.processdate)"""),
    ("process leaf product == ledger PROCESS_IN row (weight = product + loss)",
     """SELECT d.processno, d.lineno, d.qty, d.weight, d.lossweight, i.qty lq, i.weight lw, d.supplyamt, i.supplyamt ls
        FROM process02t d JOIN process01t h ON h.companyid = d.companyid AND h.processno = d.processno
        LEFT JOIN iniop01t i ON i.companyid = d.companyid AND i.iniotype = 'IN' AND i.receiptno = d.processno AND i.lineno = d.lineno
        WHERE d.companyid = %(c)s AND d.linetype = 'PRODUCT'
          AND NOT EXISTS (SELECT 1 FROM process02t c WHERE c.companyid = d.companyid AND c.processno = d.processno AND c.parentlineno = d.lineno)
          AND (i.companyid IS NULL OR i.qty <> d.qty OR i.weight <> d.weight + d.lossweight OR i.supplyamt <> d.supplyamt
               OR i.iniodate <> h.processdate OR i.warehousecode <> h.warehousecode)"""),
    ("process weight tree: source weight == sum(root products + loss)",
     """SELECT s.processno, s.lineno, s.weight, SUM(p.weight + p.lossweight) products
        FROM process02t s JOIN process02t p ON p.companyid = s.companyid AND p.processno = s.processno
             AND p.sourcelineno = s.lineno AND p.parentlineno = s.lineno AND p.linetype = 'PRODUCT'
        WHERE s.companyid = %(c)s AND s.linetype = 'SOURCE'
        GROUP BY s.processno, s.lineno, s.weight HAVING SUM(p.weight + p.lossweight) <> s.weight"""),
    # ── header ↔ detail completeness ─────────────────────────────────────────
    ("header without detail / detail without header",
     """SELECT 'inbound header w/o lines' k, receiptno FROM inbound01t h WHERE companyid = %(c)s
              AND NOT EXISTS (SELECT 1 FROM inbound02t d WHERE d.companyid = h.companyid AND d.receiptno = h.receiptno)
        UNION ALL SELECT 'inbound line w/o header', receiptno FROM inbound02t d WHERE companyid = %(c)s
              AND NOT EXISTS (SELECT 1 FROM inbound01t h WHERE h.companyid = d.companyid AND h.receiptno = d.receiptno)
        UNION ALL SELECT 'outbound header w/o lines', receiptno FROM outbound01t h WHERE companyid = %(c)s
              AND NOT EXISTS (SELECT 1 FROM outbound02t d WHERE d.companyid = h.companyid AND d.receiptno = h.receiptno)
        UNION ALL SELECT 'outbound line w/o header', receiptno FROM outbound02t d WHERE companyid = %(c)s
              AND NOT EXISTS (SELECT 1 FROM outbound01t h WHERE h.companyid = d.companyid AND h.receiptno = d.receiptno)
        UNION ALL SELECT 'outbound expense w/o header', receiptno FROM outbound03t d WHERE companyid = %(c)s
              AND NOT EXISTS (SELECT 1 FROM outbound01t h WHERE h.companyid = d.companyid AND h.receiptno = d.receiptno)
        UNION ALL SELECT 'transfer header w/o lines', receiptno FROM inoutmove01t h WHERE companyid = %(c)s
              AND NOT EXISTS (SELECT 1 FROM inoutmove02t d WHERE d.companyid = h.companyid AND d.receiptno = h.receiptno)
        UNION ALL SELECT 'process header w/o lines', processno FROM process01t h WHERE companyid = %(c)s
              AND NOT EXISTS (SELECT 1 FROM process02t d WHERE d.companyid = h.companyid AND d.processno = h.processno)
        UNION ALL SELECT 'process w/o product', processno FROM process01t h WHERE companyid = %(c)s
              AND NOT EXISTS (SELECT 1 FROM process02t d WHERE d.companyid = h.companyid AND d.processno = h.processno AND d.linetype = 'PRODUCT')
        UNION ALL SELECT 'receipt/payment header w/o lines', receiptno FROM receiptpayment01t h WHERE companyid = %(c)s
              AND NOT EXISTS (SELECT 1 FROM receiptpayment02t d WHERE d.companyid = h.companyid AND d.receiptno = h.receiptno)"""),
    ("detail company name / document customer exists in this company",
     """SELECT 'inbound' k, receiptno, customcode FROM inbound01t h WHERE companyid = %(c)s
              AND NOT EXISTS (SELECT 1 FROM customer01t c WHERE c.companyid = h.companyid AND c.customercode = h.customcode)
        UNION ALL SELECT 'outbound', receiptno, customcode FROM outbound01t h WHERE companyid = %(c)s
              AND NOT EXISTS (SELECT 1 FROM customer01t c WHERE c.companyid = h.companyid AND c.customercode = h.customcode)
        UNION ALL SELECT 'process', processno, customcode FROM process01t h WHERE companyid = %(c)s
              AND NOT EXISTS (SELECT 1 FROM customer01t c WHERE c.companyid = h.companyid AND c.customercode = h.customcode)
        UNION ALL SELECT 'receipt/payment', receiptno, customcode FROM receiptpayment01t h WHERE companyid = %(c)s
              AND NOT EXISTS (SELECT 1 FROM customer01t c WHERE c.companyid = h.companyid AND c.customercode = h.customcode)"""),
    # ── amounts ──────────────────────────────────────────────────────────────
    ("unitamt == supplyamt + vat and amounts at 2 decimals",
     """SELECT 'inbound02t' t, receiptno, lineno, supplyamt, vat, unitamt FROM inbound02t WHERE companyid = %(c)s
              AND (unitamt <> supplyamt + vat OR supplyamt <> ROUND(supplyamt, 2) OR vat <> ROUND(vat, 2))
        UNION ALL SELECT 'outbound02t', receiptno, lineno, supplyamt, vat, unitamt FROM outbound02t WHERE companyid = %(c)s
              AND (unitamt <> supplyamt + vat OR supplyamt <> ROUND(supplyamt, 2))
        UNION ALL SELECT 'standstock01t', 'ST', lineno, supplyamt, vat, unitamt FROM standstock01t WHERE companyid = %(c)s
              AND unitamt IS DISTINCT FROM supplyamt + vat
        UNION ALL SELECT 'process02t', processno, lineno, supplyamt, vat, unitamt FROM process02t WHERE companyid = %(c)s
              AND unitamt <> supplyamt + vat
        UNION ALL SELECT 'iniop01t', receiptno, lineno, supplyamt, vat, unitamt FROM iniop01t WHERE companyid = %(c)s
              AND unitamt IS DISTINCT FROM supplyamt + vat AND supplyamt IS NOT NULL
        UNION ALL SELECT 'inbound03t', receiptno, lineno, supplyamt, vat, totalamt FROM inbound03t WHERE companyid = %(c)s AND totalamt <> supplyamt + vat
        UNION ALL SELECT 'outbound03t', receiptno, lineno, supplyamt, vat, totalamt FROM outbound03t WHERE companyid = %(c)s AND totalamt <> supplyamt + vat"""),
    ("outbound vat == round(supply * 10%)",
     """SELECT receiptno, lineno, supplyamt, vat FROM outbound02t WHERE companyid = %(c)s AND vat <> ROUND(supplyamt * 0.1, 2)"""),
    ("receipt/payment line total == cash + instrument + bank + card; instrument rows consistent",
     """SELECT receiptno, lineno, totalamt, cashamt, instrumentamt, bankamt, cardamt, instrumentstatus FROM receiptpayment02t
        WHERE companyid = %(c)s AND (totalamt <> cashamt + instrumentamt + bankamt + cardamt
              OR (instrumentamt = 0 AND instrumentstatus IS NOT NULL)
              OR (instrumentstatus IN ('SETTLED', 'DISCOUNTED', 'DISHONORED') AND processdate IS NULL)
              OR (instrumentstatus IN ('HELD', 'ENDORSED') AND processdate IS NOT NULL AND source_receiptno IS NULL))"""),
    ("endorsed receipt instrument <-> exactly one payment line",
     """SELECT r.receiptno, r.lineno, r.instrumentstatus, COUNT(p.lineno) used_by
        FROM receiptpayment02t r JOIN receiptpayment01t h ON h.companyid = r.companyid AND h.receiptno = r.receiptno
        LEFT JOIN receiptpayment02t p ON p.companyid = r.companyid AND p.source_receiptno = r.receiptno AND p.source_lineno = r.lineno
        WHERE r.companyid = %(c)s AND h.transactiontype = 'RECEIPT' AND r.instrumentamt > 0
        GROUP BY r.receiptno, r.lineno, r.instrumentstatus
        HAVING COUNT(p.lineno) > 1
            OR (COUNT(p.lineno) = 1 AND r.instrumentstatus NOT IN ('ENDORSED', 'DISHONORED'))
            OR (COUNT(p.lineno) = 0 AND r.instrumentstatus = 'ENDORSED')"""),
    ("payment line using a receipt instrument copies its amount",
     """SELECT p.receiptno, p.lineno, p.instrumentamt, r.instrumentamt src_amt FROM receiptpayment02t p
        LEFT JOIN receiptpayment02t r ON r.companyid = p.companyid AND r.receiptno = p.source_receiptno AND r.lineno = p.source_lineno
        WHERE p.companyid = %(c)s AND p.source_receiptno IS NOT NULL AND (r.companyid IS NULL OR r.instrumentamt <> p.instrumentamt)"""),
]

RULES += [
    ("cost conservation: cost in (purchase+expense+opening+process fees) == stock cost + cost of sales",
     """WITH incoming AS (
            SELECT (SELECT COALESCE(SUM(supplyamt), 0) FROM inbound02t WHERE companyid = %(c)s)
                 + (SELECT COALESCE(SUM(supplyamt), 0) FROM inbound03t WHERE companyid = %(c)s)
                 + (SELECT COALESCE(SUM(supplyamt), 0) FROM standstock01t WHERE companyid = %(c)s)
                 + (SELECT COALESCE(SUM(supplyamt), 0) FROM process02t WHERE companyid = %(c)s AND linetype = 'PRODUCT') AS cost,
                   (SELECT COALESCE(SUM(supplyamt), 0) FROM inbound03t WHERE companyid = %(c)s) AS exp,
                   (SELECT COALESCE(SUM(supplyamt), 0) FROM process02t WHERE companyid = %(c)s AND linetype = 'PRODUCT') AS fee
        ), outgoing AS (
            SELECT (SELECT COALESCE(SUM(costamt), 0) FROM currentstock01t WHERE companyid = %(c)s)
                 + (SELECT COALESCE(SUM(costamt), 0) FROM iniop01t WHERE companyid = %(c)s AND iniokind = 'OUT') AS cost,
                   (SELECT COALESCE(SUM(expamt), 0) FROM currentstock01t WHERE companyid = %(c)s)
                 + (SELECT COALESCE(SUM(expamt), 0) FROM iniop01t WHERE companyid = %(c)s AND iniokind = 'OUT') AS exp,
                   (SELECT COALESCE(SUM(feeamt), 0) FROM currentstock01t WHERE companyid = %(c)s)
                 + (SELECT COALESCE(SUM(feeamt), 0) FROM iniop01t WHERE companyid = %(c)s AND iniokind = 'OUT') AS fee
        )
        SELECT i.cost AS cost_in, o.cost AS cost_out, i.exp AS exp_in, o.exp AS exp_out, i.fee AS fee_in, o.fee AS fee_out
        FROM incoming i, outgoing o WHERE i.cost <> o.cost OR i.exp <> o.exp OR i.fee <> o.fee"""),
    ("lot origin of a transfer lot points to a real first source",
     """SELECT s.sourceno, s.sourceline, s.origintype, s.originno, s.originline FROM currentstock01t s
        WHERE s.companyid = %(c)s AND s.stockkind = 'TRANSFER'
          AND NOT EXISTS (SELECT 1 FROM iniop01t i WHERE i.companyid = s.companyid AND i.receiptno = s.originno
                          AND i.lineno = s.originline AND i.iniotype IN ('IN', 'ST') AND i.iniokind <> 'MOVE_IN')"""),
]


def _gross_profit_violations(companyid: str) -> list[str]:
    from services.outbound import GrossProfit

    result = GrossProfit.analyze(companyid, date(2000, 1, 1), date(2099, 12, 31))
    total = result["total"]
    with db.connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """SELECT (SELECT COALESCE(SUM(supplyamt), 0) FROM outbound02t WHERE companyid = %(c)s),
                      (SELECT COALESCE(SUM(costamt), 0) FROM iniop01t WHERE companyid = %(c)s AND iniokind = 'OUT'),
                      (SELECT COALESCE(SUM(supplyamt), 0) FROM outbound03t WHERE companyid = %(c)s AND purchaseyn = 'Y'),
                      (SELECT COALESCE(SUM(supplyamt), 0) FROM outbound03t WHERE companyid = %(c)s AND purchaseyn <> 'Y'),
                      (SELECT COUNT(*) FROM outbound02t WHERE companyid = %(c)s)""",
            {"c": companyid},
        )
        sales, cost, minus, plus, lines = cursor.fetchone()
    problems = []
    got_cost = sum(Decimal(total[k] or 0) for k in ("purchase_amt", "purchase_cost", "process_amt", "material_amt"))
    checks = [("lines", Decimal(total["line_count"]), Decimal(lines)), ("sales", Decimal(total["sales_amt"]), Decimal(sales)),
              ("cost of sales", got_cost, Decimal(cost)), ("sales cost(-)", Decimal(total["sales_minus"]), Decimal(minus)),
              ("sales cost(+)", Decimal(total["sales_plus"]), Decimal(plus)),
              ("profit", Decimal(total["profit_amt"]), Decimal(sales) + Decimal(plus) - Decimal(cost) - Decimal(minus))]
    for name, got, want in checks:
        if abs(got - want) > Decimal("0.02"):
            problems.append(f"gross profit {name}: expected {want}, got {got}")
    return problems


# Independent ledger: receivable / payable per customer code (supply amount basis, all dates).
LEDGER_SQL = """
WITH moves AS (
    SELECT h.customcode code, d.supplyamt recv, 0::numeric pay FROM outbound02t d JOIN outbound01t h USING (companyid, receiptno) WHERE d.companyid = %(c)s
    UNION ALL SELECT h.customcode, x.supplyamt, 0 FROM outbound03t x JOIN outbound01t h USING (companyid, receiptno)
              WHERE x.companyid = %(c)s AND x.purchaseyn <> 'Y'
    UNION ALL SELECT x.customcode, 0, x.supplyamt FROM outbound03t x WHERE x.companyid = %(c)s AND x.purchaseyn = 'Y'
    UNION ALL SELECT h.customcode, 0, d.supplyamt FROM inbound02t d JOIN inbound01t h USING (companyid, receiptno) WHERE d.companyid = %(c)s
    UNION ALL SELECT COALESCE(NULLIF(BTRIM(x.customcode), ''), h.customcode), 0, x.supplyamt
              FROM inbound03t x JOIN inbound01t h USING (companyid, receiptno) WHERE x.companyid = %(c)s
    UNION ALL SELECT h.customcode, 0, d.supplyamt FROM process02t d JOIN process01t h USING (companyid, processno) WHERE d.companyid = %(c)s
    UNION ALL SELECT h.customcode,
                     CASE WHEN h.transactiontype = 'RECEIPT' THEN -(d.totalamt + d.offsetamt + d.lossamt - d.chargeamt) ELSE -d.offsetamt END,
                     CASE WHEN h.transactiontype = 'PAYMENT' THEN -(d.totalamt + d.offsetamt - d.lossamt + d.chargeamt) ELSE -d.offsetamt END
              FROM receiptpayment02t d JOIN receiptpayment01t h USING (companyid, receiptno) WHERE d.companyid = %(c)s
    UNION ALL SELECT h.customcode,
                     CASE WHEN h.transactiontype = 'RECEIPT' THEN d.instrumentamt ELSE 0 END,
                     CASE WHEN h.transactiontype = 'PAYMENT' THEN d.instrumentamt ELSE 0 END
              FROM receiptpayment02t d JOIN receiptpayment01t h USING (companyid, receiptno)
              WHERE d.companyid = %(c)s AND d.instrumentstatus = 'DISHONORED' AND d.processdate IS NOT NULL AND d.instrumentamt > 0
    UNION ALL SELECT customercode, openingreceivable, openingpayable FROM customer01t WHERE companyid = %(c)s
)
SELECT code, SUM(recv) recv, SUM(pay) pay FROM moves GROUP BY code
"""


def expected_ledger(companyid: str) -> dict[str, tuple[Decimal, Decimal]]:
    with db.connect() as connection, connection.cursor() as cursor:
        cursor.execute(LEDGER_SQL, {"c": companyid})
        return {code: (Decimal(recv or 0), Decimal(pay or 0)) for code, recv, pay in cursor.fetchall()}


def _ledger_violations(companyid: str) -> list[str]:
    from services.receiptpayment import CustomerLedger as ledger

    problems = []
    expected = expected_ledger(companyid)
    with db.connect() as connection, connection.cursor() as cursor:
        cursor.execute("SELECT ledgerstartdate FROM company01t WHERE companyid = %s", (companyid,))
        start = cursor.fetchone()[0]
    if start is not None:
        return []  # independent model assumes no ledger start date (test companies have none)
    balances = ledger.list_balances(companyid, date(2000, 1, 1), date(2099, 12, 31))
    listed = {row["customcode"]: (Decimal(row["recv_close"]), Decimal(row["pay_close"])) for row in balances["items"]}
    for code, (recv, pay) in expected.items():
        got = listed.get(code, (ZERO, ZERO))
        if abs(got[0] - recv) > TOL or abs(got[1] - pay) > TOL:
            problems.append(f"ledger list {code}: expected recv={recv} pay={pay}, got recv={got[0]} pay={got[1]}")
        if recv or pay or code in listed:
            single = ledger.get_ledger(companyid, code, date(2000, 1, 1), date(2099, 12, 31))
            closing = (Decimal(single["closing"]["recv"]), Decimal(single["closing"]["pay"]))
            if abs(closing[0] - recv) > TOL or abs(closing[1] - pay) > TOL:
                problems.append(f"ledger single {code}: expected recv={recv} pay={pay}, got {closing}")
        with db.connect() as connection, connection.cursor() as cursor:
            credit = Decimal(ledger.receivable_balance(cursor, companyid, code))
        if abs(credit - recv) > TOL:
            problems.append(f"credit-control receivable {code}: expected {recv}, got {credit}")
    for code in listed:
        if code not in expected:
            problems.append(f"ledger lists unknown customer {code}: {listed[code]}")
    total_recv = sum((v[0] for v in expected.values()), ZERO)
    total_pay = sum((v[1] for v in expected.values()), ZERO)
    if abs(Decimal(balances["totals"]["recv_close"]) - total_recv) > TOL or abs(Decimal(balances["totals"]["pay_close"]) - total_pay) > TOL:
        problems.append(f"ledger totals: expected {total_recv}/{total_pay}, got {balances['totals']['recv_close']}/{balances['totals']['pay_close']}")
    dash = ledger.dashboard(companyid, date(2099, 12, 31))
    if abs(Decimal(dash["summary"]["receivable"]) - total_recv) > TOL or abs(Decimal(dash["summary"]["payable"]) - total_pay) > TOL:
        problems.append(f"ledger dashboard: expected {total_recv}/{total_pay}, got {dash['summary']['receivable']}/{dash['summary']['payable']}")
    return problems


def check(companyid: str, ledger: bool = True) -> list[str]:
    problems = []
    with db.connect() as connection, connection.cursor() as cursor:
        for name, sql in RULES:
            bad = _rows(cursor, sql, {"c": companyid})
            if bad:
                problems.append(f"[{name}] {len(bad)} row(s): {bad[:3]}")
    if ledger:
        problems.extend(f"[ledger] {p}" for p in _ledger_violations(companyid))
        problems.extend(f"[gross-profit] {p}" for p in _gross_profit_violations(companyid))
    return problems


def assert_consistent(companyid: str, step: str = "", ledger: bool = True) -> None:
    problems = check(companyid, ledger=ledger)
    assert not problems, f"integrity violations after {step or 'step'} ({companyid}):\n  " + "\n  ".join(problems)
