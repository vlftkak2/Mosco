"""매출이익분석 (메뉴: GROSS_PROFIT)

출고(매출) 상세 행마다 원가를 붙여 이익과 마진율을 계산한다. 모든 금액은 공급가액(부가세 제외) 기준.

  출고 행 ─(출처 재고)─> 현재고 행 ─(원래 출처 칸)─> 원래 출처 = 입고 / 기초재고 / 가공
      현재고.originno/origintype/originline 은 재고이전으로 생긴 재고에만 채워진다 (비어 있으면 자기 자신이 원래 출처).
      재고이전을 여러 번 해도 처음 출처를 그대로 복사해 두므로 거슬러 올라갈 필요가 없다.

  원가기준(단가기준) / 기준수량 — 입고 금액 계산과 같은 규칙
      KG   : 출고 중량(kg)
      TON  : 출고 중량 ÷ 1000
      수량  : 출고 수량
      길이  : 재고 길이 × (출고 수량 ÷ 재고 최초수량)   (일부만 출고하면 그 비율만큼)

  매입금액   = 재고 매입단가 × 기준수량                                    (입고·기초재고)
  매입비용   = 원래 입고 전표의 기타비용 합계 ÷ 그 입고 전표 총중량 × 출고 중량  (입고에서 온 재고만)
  가공비     = 가공품 단가 × 기준수량 + 중간 공정 가공비 배분액              (가공품)
  원자재원가 = 가공에 투입된 원자재 원가 ÷ 산출 제품 총중량 × 출고 중량       (가공품)
      투입 원자재 원가 = 원자재 매입단가 × 투입 기준수량 + 원자재 매입비용(입고 기타비용 kg당 × 투입 중량)
                       (원자재가 다시 가공품이면 그 가공의 원자재원가·가공비까지 따라 올라간다)
      중간 공정(하위 제품이 있는 공정)의 가공비는 그 아래 최종 제품에 중량 비율로 나눈다.
  매출비용(−) = 출고 기타비용 중 비용여부 '예'   → 출고 전표 안에서 중량 비율로 행별 배분
  매출비용(+) = 출고 기타비용 중 비용여부 '아니오' → 같은 방식으로 배분 (매출에 더함)
  이익금액   = 매출금액 + 매출비용(+) − 매입금액 − 매입비용 − 가공비 − 원자재원가 − 매출비용(−)
  마진율     = 이익금액 ÷ (매출금액 + 매출비용(+)) × 100   (매출비용(+)도 매출처에게 받는 매출로 본다)
"""
from datetime import date
from decimal import Decimal

import db as _shared_db

_connect = _shared_db.connect

MAX_ROWS = 5000  # 화면에 한 번에 보내는 최대 행 수 (합계는 항상 전체 기준)
ORIGIN_KINDS = ("INBOUND", "OPENING", "PROCESS")
PROFIT_FILTERS = ("GAIN", "LOSS")
MAX_PROCESS_DEPTH = 10  # 가공품을 다시 가공한 단계를 이만큼까지 따라 올라간다

# 금액 칸 (행·소계·총계 공통)
AMOUNT_FIELDS = ("sales_amt", "sales_plus", "purchase_amt", "purchase_cost", "process_amt", "material_amt",
                 "sales_minus", "profit_amt")
ZERO = Decimal("0")


# ---------------------------------------------------------------------------
# 단가기준 판별 (입고등록 _calculate_unit_amount 와 같은 규칙: 수량 → 길이 → 톤 → 그 외 중량)
# ---------------------------------------------------------------------------
def price_kind(token: str) -> str:
    text = str(token or "").upper().strip()
    words = set(text.split())
    if "수량" in text or "QTY" in text or "COUNT" in text or words & {"EA", "PCS"}:
        return "QTY"
    if "길이" in text or "LENGTH" in text or "METER" in text or words & {"M", "MTR"}:
        return "LENGTH"
    if "TON" in text or "톤" in text:
        return "TON"
    return "KG"


def _kind_sql(token_sql: str) -> str:
    """price_kind() 와 같은 판별을 SQL 로. (psycopg2 dict 파라미터용으로 % 는 %% 로 적는다)"""
    return f"""CASE
        WHEN {token_sql} LIKE '%%수량%%' OR {token_sql} LIKE '%%QTY%%' OR {token_sql} LIKE '%%COUNT%%'
             OR {token_sql} ~ '(^| )(EA|PCS)( |$)' THEN 'QTY'
        WHEN {token_sql} LIKE '%%길이%%' OR {token_sql} LIKE '%%LENGTH%%' OR {token_sql} LIKE '%%METER%%'
             OR {token_sql} ~ '(^| )(M|MTR)( |$)' THEN 'LENGTH'
        WHEN {token_sql} LIKE '%%TON%%' OR {token_sql} LIKE '%%톤%%' THEN 'TON'
        ELSE 'KG' END"""


def _basis(kind: str, weight, qty, length, originalqty) -> Decimal:
    weight, qty = Decimal(str(weight or 0)), Decimal(str(qty or 0))
    if kind == "TON":
        return weight / Decimal("1000")
    if kind == "QTY":
        return qty
    if kind == "LENGTH":
        original = Decimal(str(originalqty or 0))
        return Decimal(str(length or 0)) * (qty / original if original > 0 else Decimal("1"))
    return weight


# ---------------------------------------------------------------------------
# 가공품 원가: (가공번호, 제품 순번) → (kg당 원자재원가, kg당 중간공정 가공비)
# ---------------------------------------------------------------------------
def _price_tokens(cursor, companyid: str) -> dict:
    cursor.execute(
        "SELECT code, code_name FROM CodeMaster01t WHERE companyid = %s AND groupcode = 'PRICE_UNIT'",
        (companyid,),
    )
    tokens = {}
    for code, name in cursor.fetchall():
        token = f"{str(code or '').strip()} {str(name or '').strip()}"
        for key in (str(code or "").strip(), str(name or "").strip()):
            if key:
                tokens.setdefault(key, token)
    return tokens


def process_rates(cursor, companyid: str, processnos) -> dict:
    """가공 제품(최종 산출물)별 kg당 원자재원가·중간공정 가공비.

    원자재가 다른 가공의 제품이면 그 가공도 읽어 원가를 이어 붙인다 (MAX_PROCESS_DEPTH 단계까지).
    """
    lines: dict[str, list[dict]] = {}
    stocks: dict[tuple, dict] = {}
    pending = {str(no) for no in processnos if no}
    for _ in range(MAX_PROCESS_DEPTH):
        pending -= set(lines)
        if not pending:
            break
        cursor.execute(
            """SELECT processno, lineno, linetype, parentlineno, sourcelineno,
                      stocksourcetype, stocksourceno, stocksourceline, qty, weight, COALESCE(supplyamt, 0)
               FROM Process02t WHERE companyid = %s AND processno = ANY(%s)""",
            (companyid, sorted(pending)),
        )
        new_keys = set()
        for row in cursor.fetchall():
            record = dict(zip(("processno", "lineno", "linetype", "parentlineno", "sourcelineno", "stype", "sno", "sline",
                               "qty", "weight", "fee"), row))
            lines.setdefault(record["processno"], []).append(record)
            if record["linetype"] == "SOURCE" and record["sno"]:
                new_keys.add((record["stype"], record["sno"], int(record["sline"])))
        for processno in pending:
            lines.setdefault(processno, [])
        new_keys -= set(stocks)
        if not new_keys:
            break
        keys = sorted(new_keys)
        cursor.execute(
            """SELECT sourcetype, sourceno, sourceline, unitprice, unit, length, originalqty,
                      COALESCE(origintype, sourcetype), COALESCE(originno, sourceno), COALESCE(originline, sourceline)
               FROM CurrentStock01t
               WHERE companyid = %s
                 AND (sourcetype, sourceno, sourceline) IN (SELECT * FROM unnest(%s::varchar[], %s::varchar[], %s::integer[]))""",
            (companyid, [k[0] for k in keys], [k[1] for k in keys], [k[2] for k in keys]),
        )
        origin_nos = set()
        for row in cursor.fetchall():
            stocks[(row[0], row[1], row[2])] = {
                "unitprice": row[3], "unit": row[4], "length": row[5], "originalqty": row[6],
                "origin": (row[7], row[8], row[9]),
            }
            origin_nos.add(row[8])
        if origin_nos:
            cursor.execute(
                "SELECT processno FROM Process01t WHERE companyid = %s AND processno = ANY(%s)",
                (companyid, sorted(origin_nos)),
            )
            pending |= {row[0] for row in cursor.fetchall()}

    # 원자재가 입고에서 왔으면 그 입고 전표의 kg당 매입비용
    origin_receipts = sorted({stock["origin"][1] for stock in stocks.values()} - set(lines))
    expense_per_kg = {}
    if origin_receipts:
        cursor.execute(
            """SELECT d.receiptno, COALESCE(MAX(c.cost), 0) / NULLIF(SUM(COALESCE(d.weight, 0)), 0)
               FROM Inbound02t d
               LEFT JOIN (SELECT receiptno, SUM(supplyamt) AS cost FROM Inbound03t
                          WHERE companyid = %s AND receiptno = ANY(%s) GROUP BY receiptno) c ON c.receiptno = d.receiptno
               WHERE d.companyid = %s AND d.receiptno = ANY(%s)
               GROUP BY d.receiptno""",
            (companyid, origin_receipts, companyid, origin_receipts),
        )
        expense_per_kg = {row[0]: Decimal(str(row[1] or 0)) for row in cursor.fetchall()}
    tokens = _price_tokens(cursor, companyid)

    rates: dict[tuple, tuple[Decimal, Decimal]] = {}
    done: set[str] = set()
    visiting: set[str] = set()

    def compute(processno: str):
        if processno in done or processno in visiting:
            return
        visiting.add(processno)
        rows = lines.get(processno, [])
        parents = {row["parentlineno"] for row in rows if row["linetype"] == "PRODUCT" and row["parentlineno"] is not None}
        products = [row for row in rows if row["linetype"] == "PRODUCT"]
        children: dict[int, list[dict]] = {}
        for product in products:
            children.setdefault(product["parentlineno"], []).append(product)

        def leaves_under(lineno):
            found = []
            for child in children.get(lineno, []):
                found.extend(leaves_under(child["lineno"]) if child["lineno"] in parents else [child])
            return found

        for source in (row for row in rows if row["linetype"] == "SOURCE"):
            leaves = leaves_under(source["lineno"])
            leaf_weight = sum((Decimal(str(leaf["weight"] or 0)) for leaf in leaves), ZERO)
            if leaf_weight <= 0:
                continue
            raw_cost = ZERO
            stock = stocks.get((source["stype"], source["sno"], int(source["sline"] or 0)))
            consumed_weight = Decimal(str(source["weight"] or 0))
            if stock:
                kind = price_kind(tokens.get(str(stock["unit"] or "").strip(), stock["unit"]))
                raw_cost += Decimal(str(stock["unitprice"] or 0)) * _basis(
                    kind, consumed_weight, source["qty"], stock["length"], stock["originalqty"])
                origin_type, origin_no, origin_line = stock["origin"]
                if origin_no in lines:  # 원자재가 다른 가공의 제품
                    compute(origin_no)
                    material, fee = rates.get((origin_no, int(origin_line)), (ZERO, ZERO))
                    raw_cost += (material + fee) * consumed_weight
                elif origin_type != "OPENING":
                    raw_cost += expense_per_kg.get(origin_no, ZERO) * consumed_weight
            extra = {leaf["lineno"]: ZERO for leaf in leaves}
            for middle in products:
                if middle["lineno"] in parents and middle["sourcelineno"] == source["lineno"] and middle["fee"]:
                    below = leaves_under(middle["lineno"])
                    below_weight = sum((Decimal(str(leaf["weight"] or 0)) for leaf in below), ZERO)
                    for leaf in below:
                        if below_weight > 0:
                            extra[leaf["lineno"]] += Decimal(str(middle["fee"])) * Decimal(str(leaf["weight"] or 0)) / below_weight
            material_per_kg = raw_cost / leaf_weight
            for leaf in leaves:
                weight = Decimal(str(leaf["weight"] or 0))
                rates[(processno, int(leaf["lineno"]))] = (
                    material_per_kg, extra[leaf["lineno"]] / weight if weight > 0 else ZERO)
        visiting.discard(processno)
        done.add(processno)

    for processno in list(lines):
        compute(processno)
    return rates


def _build_query(filters: dict, cursor):
    """Returns (cte_sql, params). The CTE ends with a `filtered` relation holding one row per outbound line.

    cursor: 가공품 원자재원가를 먼저 계산(파이썬)해 쿼리에 넘기기 위해 쓴다.
    """
    params = {
        "companyid": filters["companyid"],
        "date_from": filters["date_from"],
        "date_to": filters["date_to"],
    }
    head_where = ["h.companyid = %(companyid)s", "h.receptdate BETWEEN %(date_from)s AND %(date_to)s"]
    if filters.get("customer"):
        head_where.append("(h.customcode ILIKE %(customer)s OR h.customname ILIKE %(customer)s)")
        params["customer"] = f"%{filters['customer']}%"

    # 이 기간 출고에 쓰인 가공품의 가공번호 → 원자재원가·중간공정 가공비 (kg당)
    cursor.execute(
        f"""SELECT DISTINCT COALESCE(s.originno, d.stocksourceno)
            FROM Outbound01t h
            JOIN Outbound02t d ON d.companyid = h.companyid AND d.receiptno = h.receiptno
            LEFT JOIN CurrentStock01t s ON s.companyid = d.companyid AND s.sourcetype = d.stocksourcetype
                                       AND s.sourceno = d.stocksourceno AND s.sourceline = d.stocksourceline
            JOIN Process01t p ON p.companyid = h.companyid AND p.processno = COALESCE(s.originno, d.stocksourceno)
            WHERE {" AND ".join(head_where)}""",
        params,
    )
    rates = process_rates(cursor, filters["companyid"], [row[0] for row in cursor.fetchall()])
    rate_keys = sorted(rates)
    params["rate_no"] = [key[0] for key in rate_keys]
    params["rate_line"] = [key[1] for key in rate_keys]
    params["rate_material"] = [rates[key][0] for key in rate_keys]
    params["rate_fee"] = [rates[key][1] for key in rate_keys]

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
price_units AS MATERIALIZED (
    SELECT code, code_name, UPPER(BTRIM(code) || ' ' || COALESCE(BTRIM(code_name), '')) AS token
    FROM CodeMaster01t WHERE companyid = %(companyid)s AND groupcode = 'PRICE_UNIT'
),
origin AS MATERIALIZED (
    -- 출고 행의 출처 재고 → 단가·단가기준·원래 출처 (조인 한 번)
    SELECT l.receiptno, l.lineno, s.unitprice, s.length AS stock_length, s.originalqty AS stock_originalqty,
           {_kind_sql("COALESCE(pu.token, UPPER(BTRIM(COALESCE(s.unit, l.unit, ''))))")} AS cost_unit,
           COALESCE(s.origintype, l.stocksourcetype) AS st,
           COALESCE(s.originno, l.stocksourceno) AS sn,
           COALESCE(s.originline, l.stocksourceline) AS sl
    FROM lines l
    LEFT JOIN CurrentStock01t s ON s.companyid = %(companyid)s AND s.sourcetype = l.stocksourcetype
                                AND s.sourceno = l.stocksourceno AND s.sourceline = l.stocksourceline
    LEFT JOIN LATERAL (
        SELECT token FROM price_units
        WHERE BTRIM(code) = BTRIM(COALESCE(s.unit, l.unit)) OR BTRIM(code_name) = BTRIM(COALESCE(s.unit, l.unit))
        ORDER BY (BTRIM(code) = BTRIM(COALESCE(s.unit, l.unit))) DESC
        LIMIT 1
    ) pu ON TRUE
),
doc_list AS MATERIALIZED (SELECT DISTINCT receiptno FROM lines),
origin_list AS MATERIALIZED (SELECT DISTINCT sn FROM origin),
process_rate AS MATERIALIZED (
    SELECT * FROM unnest(%(rate_no)s::varchar[], %(rate_line)s::integer[], %(rate_material)s::numeric[], %(rate_fee)s::numeric[])
        AS r(processno, lineno, material_per_kg, fee_per_kg)
),
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
    SELECT l.*, o.sn AS origin_no, o.cost_unit,
           CASE WHEN o.st = 'OPENING' THEN 'OPENING'
                WHEN p.processno IS NOT NULL THEN 'PROCESS'
                WHEN ib.receiptno IS NOT NULL THEN 'INBOUND'
                ELSE 'UNKNOWN' END AS origin_kind,
           COALESCE(o.unitprice, 0) AS purchase_price,
           CASE o.cost_unit
                WHEN 'TON' THEN COALESCE(l.weight, 0) / 1000
                WHEN 'QTY' THEN COALESCE(l.qty, 0)
                WHEN 'LENGTH' THEN COALESCE(o.stock_length, l.length, 0)
                                   * CASE WHEN COALESCE(o.stock_originalqty, 0) > 0
                                          THEN COALESCE(l.qty, 0) / o.stock_originalqty ELSE 1 END
                ELSE COALESCE(l.weight, 0) END AS cost_qty,
           COALESCE(pr.per_kg, 0) AS purchase_cost_per_kg,
           COALESCE(rt.material_per_kg, 0) AS material_per_kg,
           COALESCE(rt.fee_per_kg, 0) AS fee_per_kg,
           COALESCE(sc.cost_minus, 0) AS doc_cost_minus, COALESCE(sc.cost_plus, 0) AS doc_cost_plus,
           CASE WHEN l.doc_w > 0 THEN l.cum_w / l.doc_w WHEN l.doc_a > 0 THEN l.cum_a / l.doc_a ELSE l.rn::numeric / l.doc_n END AS frac_cum,
           CASE WHEN l.doc_w > 0 THEN (l.cum_w - l.w) / l.doc_w WHEN l.doc_a > 0 THEN (l.cum_a - l.a) / l.doc_a ELSE (l.rn - 1)::numeric / l.doc_n END AS frac_prev
    FROM lines l
    JOIN origin o ON o.receiptno = l.receiptno AND o.lineno = l.lineno
    LEFT JOIN Process01t p ON p.companyid = %(companyid)s AND p.processno = o.sn
    LEFT JOIN Inbound01t ib ON ib.companyid = %(companyid)s AND ib.receiptno = o.sn
    LEFT JOIN purchase_rate pr ON pr.receiptno = o.sn
    LEFT JOIN process_rate rt ON rt.processno = o.sn AND rt.lineno = o.sl
    LEFT JOIN sales_cost sc ON sc.receiptno = l.receiptno
),
amounts AS (
    SELECT c.*,
           CASE WHEN c.origin_kind = 'PROCESS' THEN 0 ELSE ROUND(c.purchase_price * c.cost_qty) END AS purchase_amt,
           CASE WHEN c.origin_kind = 'PROCESS'
                THEN ROUND(c.purchase_price * c.cost_qty) + ROUND(c.fee_per_kg * COALESCE(c.weight, 0))
                ELSE 0 END AS process_amt,
           CASE WHEN c.origin_kind = 'PROCESS' THEN ROUND(c.material_per_kg * COALESCE(c.weight, 0)) ELSE 0 END AS material_amt,
           CASE WHEN c.origin_kind = 'INBOUND' THEN ROUND(c.purchase_cost_per_kg * COALESCE(c.weight, 0)) ELSE 0 END AS purchase_cost,
           ROUND(c.doc_cost_minus * c.frac_cum) - ROUND(c.doc_cost_minus * c.frac_prev) AS sales_minus,
           ROUND(c.doc_cost_plus * c.frac_cum) - ROUND(c.doc_cost_plus * c.frac_prev) AS sales_plus
    FROM calc c
),
result AS (
    SELECT a.*,
           a.sales_amt + a.sales_plus - a.purchase_amt - a.purchase_cost - a.process_amt - a.material_amt - a.sales_minus AS profit_amt
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
    sums = ", ".join(f"COALESCE(SUM({field}), 0) AS {field}" for field in AMOUNT_FIELDS)
    with _connect() as connection, connection.cursor() as cursor:
        cte, params = _build_query(filters, cursor)
        cursor.execute(
            f"""{cte}
            SELECT receiptno, lineno, receptdate, customcode, customname, manager,
                   itemcode, itemname, productname, materialname, surfacename, myrtle,
                   thickness, width, length, qty, weight, unit, unitprice AS sales_price,
                   purchase_price, cost_unit, ROUND(cost_qty, 3) AS cost_qty,
                   warehousecodename, origin_kind, origin_no,
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
