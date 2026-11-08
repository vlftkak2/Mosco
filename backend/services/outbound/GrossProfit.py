"""매출이익분석 (메뉴: GROSS_PROFIT)

출고(매출) 상세 행마다 원가를 붙여 이익과 마진율을 계산한다. 모든 금액은 공급가액(부가세 제외) 기준.

  출고 행 ─(출처 재고)─> 현재고 행 ─(원래 출처 칸)─> 원래 출처 = 입고 / 기초재고 / 가공
      현재고.originno/origintype/originline 은 재고이전으로 생긴 재고에만 채워진다 (비어 있으면 자기 자신이 원래 출처).
      재고이전을 여러 번 해도 처음 출처를 그대로 복사해 두므로 거슬러 올라갈 필요가 없다.

  매입금액   = 재고 매입단가 × 출고 중량(단위 KG) 또는 수량        (입고·기초재고)
  가공비     = 재고 매입단가(가공등록 가공비) × 출고 중량 또는 수량   (가공품; 원자재는 따라가지 않음)
  매입비용   = 원래 입고 전표의 기타비용 합계 ÷ 그 입고 전표 총중량 × 출고 중량  (입고에서 온 재고만)
  매출비용(−) = 출고 기타비용 중 비용여부 '예'   → 출고 전표 안에서 중량 비율로 행별 배분
  매출비용(+) = 출고 기타비용 중 비용여부 '아니오' → 같은 방식으로 배분 (매출에 더함)
  이익금액   = 매출금액 + 매출비용(+) − 매입금액 − 매입비용 − 가공비 − 매출비용(−)
  마진율     = 이익금액 ÷ (매출금액 + 매출비용(+)) × 100   (매출비용(+)도 매출처에게 받는 매출로 본다)
"""
from datetime import date

import db as _shared_db

_connect = _shared_db.connect

MAX_ROWS = 5000  # 화면에 한 번에 보내는 최대 행 수 (합계는 항상 전체 기준)
ORIGIN_KINDS = ("INBOUND", "OPENING", "PROCESS")
PROFIT_FILTERS = ("GAIN", "LOSS")

# 금액 칸 (행·소계·총계 공통)
AMOUNT_FIELDS = ("sales_amt", "sales_plus", "purchase_amt", "purchase_cost", "process_amt", "sales_minus", "profit_amt")


def _build_query(filters: dict):
    """Returns (cte_sql, params). The CTE ends with a `result` relation holding one row per outbound line."""
    params = {
        "companyid": filters["companyid"],
        "date_from": filters["date_from"],
        "date_to": filters["date_to"],
    }
    head_where = ["h.companyid = %(companyid)s", "h.receptdate BETWEEN %(date_from)s AND %(date_to)s"]
    if filters.get("customer"):
        head_where.append("(h.customcode ILIKE %(customer)s OR h.customname ILIKE %(customer)s)")
        params["customer"] = f"%{filters['customer']}%"

    # 줄 단위 조건은 비용 배분이 끝난 뒤 적용한다 (배분은 출고 전표의 모든 행 기준)
    line_where = ["TRUE"]
    if filters.get("keyword"):
        line_where.append("(r.itemname ILIKE %(keyword)s OR r.productname ILIKE %(keyword)s OR r.itemcode ILIKE %(keyword)s OR r.receiptno ILIKE %(keyword)s)")
        params["keyword"] = f"%{filters['keyword']}%"
    if filters.get("material"):
        line_where.append("r.materialname ILIKE %(material)s")
        params["material"] = f"%{filters['material']}%"
    if filters.get("warehouse"):
        line_where.append("(r.warehousecode ILIKE %(warehouse)s OR r.warehousecodename ILIKE %(warehouse)s)")
        params["warehouse"] = f"%{filters['warehouse']}%"
    if filters.get("origin") in ORIGIN_KINDS:
        line_where.append("r.origin_kind = %(origin)s")
        params["origin"] = filters["origin"]
    if filters.get("profit") == "GAIN":
        line_where.append("r.profit_amt >= 0")
    elif filters.get("profit") == "LOSS":
        line_where.append("r.profit_amt < 0")

    sql = f"""
WITH lines AS MATERIALIZED (
    -- 출고 전표 안에서의 누적 비율 (매출비용을 중량 비율로 배분, 끝전은 마지막 행에 맞춰 합계가 정확히 일치)
    SELECT d.receiptno, d.lineno, h.receptdate, h.customcode, h.customname, h.manager,
           d.stocksourcetype, d.stocksourceno, d.stocksourceline,
           d.itemcode, d.itemname, d.productname, d.materialname, d.surfacename, d.myrtle,
           d.thickness, d.width, d.length, d.qty, d.weight, d.unit, d.unitprice,
           COALESCE(d.supplyamt, 0) AS sales_amt, d.warehousecode, d.warehousecodename,
           COALESCE(d.weight, 0) AS w, COALESCE(d.supplyamt, 0) AS a,
           SUM(COALESCE(d.weight, 0)) OVER doc AS doc_w,
           SUM(COALESCE(d.weight, 0)) OVER doc_cum AS cum_w,
           SUM(COALESCE(d.supplyamt, 0)) OVER doc AS doc_a,
           SUM(COALESCE(d.supplyamt, 0)) OVER doc_cum AS cum_a,
           COUNT(*) OVER doc AS doc_n,
           ROW_NUMBER() OVER doc_cum AS rn
    FROM Outbound01t h
    JOIN Outbound02t d ON d.companyid = h.companyid AND d.receiptno = h.receiptno
    WHERE {" AND ".join(head_where)}
    WINDOW doc AS (PARTITION BY d.receiptno),
           doc_cum AS (PARTITION BY d.receiptno ORDER BY d.lineno ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
),
origin AS MATERIALIZED (
    -- 출고 행의 출처 재고 → 단가·단위·원래 출처 (조인 한 번)
    SELECT l.receiptno, l.lineno, s.unitprice, s.unit AS stock_unit,
           COALESCE(s.origintype, l.stocksourcetype) AS st,
           COALESCE(s.originno, l.stocksourceno) AS sn,
           COALESCE(s.originline, l.stocksourceline) AS sl
    FROM lines l
    LEFT JOIN CurrentStock01t s ON s.companyid = %(companyid)s AND s.sourcetype = l.stocksourcetype
                                AND s.sourceno = l.stocksourceno AND s.sourceline = l.stocksourceline
),
doc_list AS MATERIALIZED (SELECT DISTINCT receiptno FROM lines),
origin_list AS MATERIALIZED (SELECT DISTINCT sn FROM origin),
sales_cost AS MATERIALIZED (
    -- 출고 기타비용: 비용여부 예 = 매출비용(−), 아니오 = 매출비용(+)
    SELECT receiptno,
           COALESCE(SUM(supplyamt) FILTER (WHERE UPPER(COALESCE(purchaseyn, 'N')) = 'Y'), 0) AS cost_minus,
           COALESCE(SUM(supplyamt) FILTER (WHERE UPPER(COALESCE(purchaseyn, 'N')) <> 'Y'), 0) AS cost_plus
    FROM Outbound03t
    WHERE companyid = %(companyid)s AND receiptno IN (SELECT receiptno FROM doc_list)
    GROUP BY receiptno
),
purchase_rate AS MATERIALIZED (
    -- 입고 기타비용(매입비용) ÷ 입고 전표 총중량 = kg당 매입비용
    SELECT d.receiptno, COALESCE(MAX(c.cost), 0) / NULLIF(SUM(COALESCE(d.weight, 0)), 0) AS per_kg
    FROM Inbound02t d
    LEFT JOIN (SELECT receiptno, SUM(supplyamt) AS cost FROM Inbound03t
               WHERE companyid = %(companyid)s AND receiptno IN (SELECT sn FROM origin_list)
               GROUP BY receiptno) c ON c.receiptno = d.receiptno
    WHERE d.companyid = %(companyid)s AND d.receiptno IN (SELECT sn FROM origin_list)
    GROUP BY d.receiptno
),
calc AS MATERIALIZED (
    SELECT l.*, o.sn AS origin_no,
           CASE WHEN o.st = 'OPENING' THEN 'OPENING'
                WHEN p.processno IS NOT NULL THEN 'PROCESS'
                WHEN ib.receiptno IS NOT NULL THEN 'INBOUND'
                ELSE 'UNKNOWN' END AS origin_kind,
           COALESCE(o.unitprice, 0) AS purchase_price,
           CASE WHEN UPPER(COALESCE(o.stock_unit, l.unit, '')) = 'KG' THEN COALESCE(l.weight, 0) ELSE COALESCE(l.qty, 0) END AS cost_basis,
           COALESCE(pr.per_kg, 0) AS purchase_cost_per_kg,
           COALESCE(sc.cost_minus, 0) AS doc_cost_minus, COALESCE(sc.cost_plus, 0) AS doc_cost_plus,
           CASE WHEN l.doc_w > 0 THEN l.cum_w / l.doc_w WHEN l.doc_a > 0 THEN l.cum_a / l.doc_a ELSE l.rn::numeric / l.doc_n END AS frac_cum,
           CASE WHEN l.doc_w > 0 THEN (l.cum_w - l.w) / l.doc_w WHEN l.doc_a > 0 THEN (l.cum_a - l.a) / l.doc_a ELSE (l.rn - 1)::numeric / l.doc_n END AS frac_prev
    FROM lines l
    JOIN origin o ON o.receiptno = l.receiptno AND o.lineno = l.lineno
    LEFT JOIN Process01t p ON p.companyid = %(companyid)s AND p.processno = o.sn
    LEFT JOIN Inbound01t ib ON ib.companyid = %(companyid)s AND ib.receiptno = o.sn
    LEFT JOIN purchase_rate pr ON pr.receiptno = o.sn
    LEFT JOIN sales_cost sc ON sc.receiptno = l.receiptno
),
amounts AS (
    SELECT c.*,
           CASE WHEN c.origin_kind = 'PROCESS' THEN 0 ELSE ROUND(c.purchase_price * c.cost_basis) END AS purchase_amt,
           CASE WHEN c.origin_kind = 'PROCESS' THEN ROUND(c.purchase_price * c.cost_basis) ELSE 0 END AS process_amt,
           CASE WHEN c.origin_kind = 'INBOUND' THEN ROUND(c.purchase_cost_per_kg * COALESCE(c.weight, 0)) ELSE 0 END AS purchase_cost,
           ROUND(c.doc_cost_minus * c.frac_cum) - ROUND(c.doc_cost_minus * c.frac_prev) AS sales_minus,
           ROUND(c.doc_cost_plus * c.frac_cum) - ROUND(c.doc_cost_plus * c.frac_prev) AS sales_plus
    FROM calc c
),
result AS (
    SELECT a.*,
           a.sales_amt + a.sales_plus - a.purchase_amt - a.purchase_cost - a.process_amt - a.sales_minus AS profit_amt
    FROM amounts a
),
filtered AS (
    SELECT r.* FROM result r WHERE {" AND ".join(line_where)}
)
"""
    return sql, params


def analyze(companyid: str, date_from: date, date_to: date, customer: str = "", keyword: str = "",
            material: str = "", warehouse: str = "", origin: str = "", profit: str = ""):
    filters = {"companyid": companyid, "date_from": date_from, "date_to": date_to, "customer": customer.strip(),
               "keyword": keyword.strip(), "material": material.strip(), "warehouse": warehouse.strip(),
               "origin": origin, "profit": profit}
    cte, params = _build_query(filters)
    sums = ", ".join(f"COALESCE(SUM({field}), 0) AS {field}" for field in AMOUNT_FIELDS)
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            f"""{cte}
            SELECT receiptno, lineno, receptdate, customcode, customname, manager,
                   itemcode, itemname, productname, materialname, surfacename, myrtle,
                   thickness, width, length, qty, weight, unit, unitprice AS sales_price,
                   purchase_price, warehousecodename, origin_kind, origin_no,
                   {", ".join(AMOUNT_FIELDS)}
            FROM filtered
            ORDER BY customname, customcode, receptdate, receiptno, lineno
            LIMIT %(row_limit)s""",
            {**params, "row_limit": MAX_ROWS + 1},
        )
        columns = [column[0] for column in cursor.description]
        rows = [dict(zip(columns, row)) for row in cursor.fetchall()]
        truncated = len(rows) > MAX_ROWS
        rows = rows[:MAX_ROWS]

        # 매출처 소계 + 총계 (화면 행 수 제한과 상관없이 조건 전체 기준)
        cursor.execute(
            f"""{cte}
            SELECT customcode, customname, GROUPING(customcode) AS is_total,
                   COUNT(*) AS line_count, COALESCE(SUM(qty), 0) AS qty, COALESCE(SUM(weight), 0) AS weight, {sums}
            FROM filtered
            GROUP BY GROUPING SETS ((customcode, customname), ())""",
            params,
        )
        columns = [column[0] for column in cursor.description]
        aggregates = [dict(zip(columns, row)) for row in cursor.fetchall()]

    def with_margin(entry):
        sales = (entry.get("sales_amt") or 0) + (entry.get("sales_plus") or 0)  # 매출비용(+)도 매출
        entry["margin_rate"] = round(float(entry["profit_amt"]) / float(sales) * 100, 2) if sales else None
        return entry

    groups = [with_margin(entry) for entry in aggregates if not entry["is_total"]]
    groups.sort(key=lambda entry: (entry["customname"] or "", entry["customcode"] or ""))
    total = next((with_margin(entry) for entry in aggregates if entry["is_total"]), None) or with_margin(
        {"line_count": 0, "qty": 0, "weight": 0, **{field: 0 for field in AMOUNT_FIELDS}})
    for row in rows:
        with_margin(row)
    return {"items": rows, "groups": groups, "total": total, "truncated": truncated, "max_rows": MAX_ROWS}
