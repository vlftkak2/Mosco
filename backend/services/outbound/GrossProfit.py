"""매출이익분석 (메뉴: GROSS_PROFIT)

출고(매출) 상세 행마다 원가를 붙여 이익과 마진율을 계산한다. 모든 금액은 공급가액(부가세 제외) 기준.

  매입원가(합계) = 출고할 때 재고에서 빠진 원가금액 (Iniop01t.costamt, 출고 수불 행)
      재고 원가는 금액 잔액 방식으로 관리한다 (services/inventory/stock_cost.py):
        입고 = 공급가 + 입고 기타비용 배부액,  기초 = 공급가,  이동 = 원래 재고에서 빠진 원가,
        가공 = 원소재에서 빠진 원가 + 모든 단계 가공비 (로스 포함 중량으로 배부)
        출고 = 남은 원가 × 출고중량 ÷ 남은 중량 (다 쓰면 남은 원가 전부)
      → 매출원가 합계 + 현재고 재고금액 = 들어온 원가 합계 (끝전까지 일치).

  매입원가를 아래 네 칸으로 나눠 보여준다 (네 칸 합계 = 매입원가). 출고 수불 행에 함께 기록된 구성 금액을 그대로 쓴다:
      매입비용 = 빠진 원가 중 매입 기타비용(운반비 등) 몫 (Iniop01t.expamt)
      가공비   = 빠진 원가 중 누적 가공비 몫 — 여러 번 가공했으면 모든 단계 (Iniop01t.feeamt)
      매입금액 / 원자재원가 = 나머지 실제원가. 원가구분이 가공이면 원자재원가, 입고·기초면 매입금액 칸에 둔다.
      재고이전으로 생긴 재고는 원래 출처(originno/originline)의 구분을 따른다.

  원가기준 / 기준수량 / 매입단가 칸은 참고용 표시다 (입고 금액 계산과 같은 단가기준 규칙).
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

# 금액 칸 (행·소계·총계 공통)
AMOUNT_FIELDS = ("sales_amt", "sales_plus", "purchase_amt", "purchase_cost", "process_amt", "material_amt",
                 "sales_minus", "profit_amt")
ZERO = Decimal("0")


# ---------------------------------------------------------------------------
# 단가기준 판별 (입고등록 _calculate_unit_amount 와 같은 규칙: 수량 → 길이 → 톤 → 그 외 중량)
# ---------------------------------------------------------------------------
def _kind_sql(token_sql: str) -> str:
    """단가기준 판별(수량 → 길이 → 톤 → 그 외 중량, 입고등록과 같은 규칙)을 SQL 로. (psycopg2 dict 파라미터용으로 % 는 %% 로 적는다)"""
    return f"""CASE
        WHEN {token_sql} LIKE '%%수량%%' OR {token_sql} LIKE '%%QTY%%' OR {token_sql} LIKE '%%COUNT%%'
             OR {token_sql} ~ '(^| )(EA|PCS)( |$)' THEN 'QTY'
        WHEN {token_sql} LIKE '%%길이%%' OR {token_sql} LIKE '%%LENGTH%%' OR {token_sql} LIKE '%%METER%%'
             OR {token_sql} ~ '(^| )(M|MTR)( |$)' THEN 'LENGTH'
        WHEN {token_sql} LIKE '%%TON%%' OR {token_sql} LIKE '%%톤%%' THEN 'TON'
        ELSE 'KG' END"""


def _build_query(filters: dict, cursor):
    """Returns (cte_sql, params). The CTE ends with a `filtered` relation holding one row per outbound line.

    cursor: 호출 형식 유지용 (원가 구성은 출고 수불 행에 기록돼 있어 미리 계산할 것이 없다).
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
           COALESCE(os.stockkind, s.stockkind) AS origin_stockkind,
           io.costamt AS ledger_cost, io.expamt AS ledger_exp, io.feeamt AS ledger_fee,
           {_kind_sql("COALESCE(pu.token, UPPER(BTRIM(COALESCE(s.unit, l.unit, ''))))")} AS cost_unit,
           COALESCE(s.originno, l.stocksourceno) AS sn,
           COALESCE(s.originline, l.stocksourceline) AS sl
    FROM lines l
    LEFT JOIN CurrentStock01t s ON s.companyid = %(companyid)s AND s.sourcetype = l.stocksourcetype
                                AND s.sourceno = l.stocksourceno AND s.sourceline = l.stocksourceline
    -- 출고 수불 행에 적힌 원가금액 = 이 출고 줄의 매입원가
    LEFT JOIN Iniop01t io ON io.companyid = %(companyid)s AND io.iniotype = 'OUT'
                         AND io.receiptno = l.receiptno AND io.lineno = l.lineno
    -- 재고이전으로 생긴 재고면 원래 출처 재고의 구분(입고/기초/가공)을 따른다
    LEFT JOIN CurrentStock01t os ON s.originno IS NOT NULL AND os.companyid = s.companyid
                                AND os.sourcetype = s.origintype AND os.sourceno = s.originno AND os.sourceline = s.originline
    LEFT JOIN LATERAL (
        SELECT token FROM price_units
        WHERE BTRIM(code) = BTRIM(COALESCE(s.unit, l.unit)) OR BTRIM(code_name) = BTRIM(COALESCE(s.unit, l.unit))
        ORDER BY (BTRIM(code) = BTRIM(COALESCE(s.unit, l.unit))) DESC
        LIMIT 1
    ) pu ON TRUE
),
doc_list AS MATERIALIZED (SELECT DISTINCT receiptno FROM lines),
sales_cost AS MATERIALIZED (
    -- 출고 기타비용: 비용여부 예 = 매출비용(−), 아니오 = 매출비용(+)
    SELECT receiptno,
           COALESCE(SUM(supplyamt) FILTER (WHERE UPPER(COALESCE(purchaseyn, 'N')) = 'Y'), 0) AS cost_minus,
           COALESCE(SUM(supplyamt) FILTER (WHERE UPPER(COALESCE(purchaseyn, 'N')) <> 'Y'), 0) AS cost_plus
    FROM Outbound03t
    WHERE companyid = %(companyid)s AND receiptno IN (SELECT receiptno FROM doc_list)
    GROUP BY receiptno
),
calc AS MATERIALIZED (
    SELECT l.*, o.sn AS origin_no, o.cost_unit,
           CASE WHEN o.origin_stockkind IN ('OPENING', 'INBOUND', 'PROCESS') THEN o.origin_stockkind
                ELSE 'UNKNOWN' END AS origin_kind,
           COALESCE(o.unitprice, 0) AS purchase_price,
           CASE WHEN COALESCE(l.weight, 0) > 0 THEN ROUND(COALESCE(o.ledger_cost, 0) / l.weight, 2) END AS costprice,
           COALESCE(o.ledger_cost, 0) AS cost_total,
           CASE o.cost_unit
                WHEN 'TON' THEN COALESCE(l.weight, 0) / 1000
                WHEN 'QTY' THEN COALESCE(l.qty, 0)
                WHEN 'LENGTH' THEN COALESCE(o.stock_length, l.length, 0)
                                   * CASE WHEN COALESCE(o.stock_originalqty, 0) > 0
                                          THEN COALESCE(l.qty, 0) / o.stock_originalqty ELSE 1 END
                ELSE COALESCE(l.weight, 0) END AS cost_qty,
           COALESCE(o.ledger_exp, 0) AS cost_exp,
           COALESCE(o.ledger_fee, 0) AS cost_fee,
           COALESCE(sc.cost_minus, 0) AS doc_cost_minus, COALESCE(sc.cost_plus, 0) AS doc_cost_plus,
           CASE WHEN l.doc_w > 0 THEN l.cum_w / l.doc_w WHEN l.doc_a > 0 THEN l.cum_a / l.doc_a ELSE l.rn::numeric / l.doc_n END AS frac_cum,
           CASE WHEN l.doc_w > 0 THEN (l.cum_w - l.w) / l.doc_w WHEN l.doc_a > 0 THEN (l.cum_a - l.a) / l.doc_a ELSE (l.rn - 1)::numeric / l.doc_n END AS frac_prev
    FROM lines l
    JOIN origin o ON o.receiptno = l.receiptno AND o.lineno = l.lineno
    LEFT JOIN sales_cost sc ON sc.receiptno = l.receiptno
),
amounts AS (
    SELECT c.*,
           -- 네 칸 합계 = 매입원가. 기타비용·가공비 몫은 출고 수불 행 기록 그대로, 나머지 실제원가는 원가구분에 따라 한 칸에
           CASE WHEN c.origin_kind = 'PROCESS' THEN 0 ELSE c.cost_total - c.cost_exp - c.cost_fee END AS purchase_amt,
           c.cost_fee AS process_amt,
           CASE WHEN c.origin_kind = 'PROCESS' THEN c.cost_total - c.cost_exp - c.cost_fee ELSE 0 END AS material_amt,
           c.cost_exp AS purchase_cost,
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


def materialize(cursor, filters: dict, table: str = "gp_filtered") -> str:
    """_build_query 결과(`filtered`)를 이 트랜잭션 동안만 있는 임시 테이블로 한 번만 만든다.

    같은 요청에서 여러 번 묶어 볼 때 가공품 원가 계산·CTE 를 반복하지 않게 한다.
    반환값은 쿼리에 쓸 테이블 이름 (pg_temp 스키마로 고정해 같은 이름의 일반 테이블과 섞이지 않게 한다).
    """
    cte, params = _build_query(filters, cursor)
    # ON COMMIT DROP: 커밋/롤백 때 사라지므로 풀로 돌아간 연결에 남지 않는다 (한 트랜잭션에 한 번만 호출).
    cursor.execute(f"CREATE TEMP TABLE {table} ON COMMIT DROP AS {cte} SELECT * FROM filtered", params)
    return f"pg_temp.{table}"


def analyze(companyid: str, date_from: date, date_to: date, customer: str = "", keyword: str = "",
            material: str = "", warehouse: str = "", origin: str = "", profit: str = ""):
    filters = {"companyid": companyid, "date_from": date_from, "date_to": date_to, "customer": customer.strip(),
               "keyword": keyword.strip(), "material": material.strip(), "warehouse": warehouse.strip(),
               "origin": origin, "profit": profit}
    sums = ", ".join(f"COALESCE(SUM({field}), 0) AS {field}" for field in AMOUNT_FIELDS)
    with _connect() as connection, connection.cursor() as cursor:
        table = materialize(cursor, filters)
        cursor.execute(
            f"""SELECT receiptno, lineno, receptdate, customcode, customname, manager,
                   itemcode, itemname, productname, materialname, surfacename, myrtle,
                   thickness, width, length, qty, weight, unit, unitprice AS sales_price,
                   purchase_price, costprice, cost_unit, ROUND(cost_qty, 3) AS cost_qty,
                   warehousecodename, origin_kind, origin_no,
                   {", ".join(AMOUNT_FIELDS)}
            FROM {table}
            ORDER BY customname, customcode, receptdate, receiptno, lineno
            LIMIT %(row_limit)s""",
            {"row_limit": MAX_ROWS + 1},
        )
        columns = [column[0] for column in cursor.description]
        rows = [dict(zip(columns, row)) for row in cursor.fetchall()]
        truncated = len(rows) > MAX_ROWS
        rows = rows[:MAX_ROWS]

        # 매출처 소계 + 총계 (화면 행 수 제한과 상관없이 조건 전체 기준)
        cursor.execute(
            f"""SELECT customcode, customname, GROUPING(customcode) AS is_total,
                   COUNT(*) AS line_count, COALESCE(SUM(qty), 0) AS qty, COALESCE(SUM(weight), 0) AS weight, {sums}
            FROM {table}
            GROUP BY GROUPING SETS ((customcode, customname), ())"""
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
