"""매입현황 (메뉴: INBOUND_SEARCH)

조회 행 = 매입 상세 + 그 전표의 기타비용(같은 전표번호, 품명 = 비용구분)
        (+ '매출 비용 포함': 매출 기타비용 중 비용여부 '예')
        (+ '가공 비용 포함': 가공 전표 1건 = 1행, 그 전표 가공금액 합계)
조회조건은 모든 행에 똑같이 적용하고(바깥 WHERE 가 각 묶음 안으로 내려가 인덱스를 쓴다), 페이지 단위로만 가져온다.
"""
from datetime import date, datetime
from zoneinfo import ZoneInfo

from services.inbound import InboundRegister as inbound_register_module
import xlsxwriter

KIND_LABELS = {"INBOUND": "매입", "EXPENSE": "기타비용", "SALES_COST": "매출비용", "PROCESS_COST": "가공비"}


def _rows_sql(include_sales_cost: bool, include_process_cost: bool) -> str:
    """매입현황 한 행 = 아래 묶음들을 합친 것. 모든 묶음의 칸 이름·형식이 같다."""
    parts = [
        # 매입 상세
        """SELECT 'INBOUND'::varchar AS kind, 1 AS kind_order, h.companyid, h.receptdate, h.receiptno, d.lineno,
                  h.customcode, h.customname, d.warehousecode, d.warehousecodename, d.productname,
                  d.itemcode, d.itemname, d.materialname, d.surfacename, d.myrtle,
                  d.thickness, d.width, d.length, d.qty,
                  CASE WHEN UPPER(BTRIM(COALESCE(d.unit, ''))) LIKE '%%TON%%' OR BTRIM(COALESCE(d.unit, '')) LIKE '%%톤%%'
                       THEN d.weight / 1000 ELSE d.weight END AS weight,
                  d.unitprice, d.supplyamt, d.vat, d.unitamt, d.qtyunit, d.unit, h.manager,
                  d.description AS description,   -- 매입 상세 비고만 (헤더 비고는 쓰지 않음)
                  d.created_at, COALESCE(d.updated_at, h.updated_at) AS updated_at,
                  d.created_by, COALESCE(d.updated_by, h.updated_by) AS updated_by
           FROM Inbound01t AS h
           JOIN Inbound02t AS d ON d.companyid = h.companyid AND d.receiptno = h.receiptno""",
        # 매입 기타비용: 같은 전표번호, 품명 = 비용구분, 거래처 = 비용 거래처(없으면 매입처), 창고 = 전표 첫 상세 창고
        """SELECT 'EXPENSE', 2, h.companyid, h.receptdate, h.receiptno, e.lineno,
                  COALESCE(NULLIF(BTRIM(e.customcode), ''), h.customcode), COALESCE(NULLIF(BTRIM(e.customname), ''), h.customname),
                  w.warehousecode, w.warehousecodename, NULL::varchar,
                  NULL::varchar, e.costname, NULL::varchar, NULL::varchar, NULL::numeric,
                  NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric,
                  NULL::numeric, e.supplyamt, e.vat, e.totalamt, NULL::varchar, NULL::varchar, h.manager,
                  e.description, e.created_at, e.updated_at, e.created_by, e.updated_by
           FROM Inbound01t AS h
           JOIN Inbound03t AS e ON e.companyid = h.companyid AND e.receiptno = h.receiptno
           LEFT JOIN LATERAL (SELECT d.warehousecode, d.warehousecodename FROM Inbound02t d
                              WHERE d.companyid = h.companyid AND d.receiptno = h.receiptno ORDER BY d.lineno LIMIT 1) w ON TRUE""",
    ]
    if include_sales_cost:
        # 매출 기타비용 중 비용여부 '예' (우리가 운송사 등에 지급하는 비용)
        parts.append(
            """SELECT 'SALES_COST', 3, h.companyid, h.receptdate, h.receiptno, e.lineno,
                      e.customcode, e.customname, w.warehousecode, w.warehousecodename, NULL::varchar,
                      NULL::varchar, e.costname, NULL::varchar, NULL::varchar, NULL::numeric,
                      NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric,
                      NULL::numeric, e.supplyamt, e.vat, e.totalamt, NULL::varchar, NULL::varchar, h.manager,
                      e.description, e.created_at, e.updated_at, e.created_by, e.updated_by
               FROM Outbound01t AS h
               JOIN Outbound03t AS e ON e.companyid = h.companyid AND e.receiptno = h.receiptno
                                    AND UPPER(COALESCE(e.purchaseyn, 'N')) = 'Y'
               LEFT JOIN LATERAL (SELECT d.warehousecode, d.warehousecodename FROM Outbound02t d
                                  WHERE d.companyid = h.companyid AND d.receiptno = h.receiptno ORDER BY d.lineno LIMIT 1) w ON TRUE""")
    if include_process_cost:
        # 가공 전표 1건 = 1행: 그 전표 가공품들의 가공금액 합계 (원소재 투입으로 발생한 총 가공금액)
        parts.append(
            """SELECT 'PROCESS_COST', 4, p.companyid, p.processdate, p.processno, 0,
                      p.customcode, p.customname, p.warehousecode, p.warehousecodename, NULL::varchar,
                      NULL::varchar, '가공비'::varchar, NULL::varchar, NULL::varchar, NULL::numeric,
                      NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric,
                      NULL::numeric, f.supplyamt, f.vat, f.unitamt, NULL::varchar, NULL::varchar, p.manager,
                      p.description, p.createdat, p.updatedat, p.created_by, p.updated_by
               FROM Process01t AS p
               JOIN LATERAL (SELECT SUM(COALESCE(x.supplyamt, 0)) AS supplyamt, SUM(COALESCE(x.vat, 0)) AS vat,
                                    SUM(COALESCE(x.unitamt, 0)) AS unitamt
                             FROM Process02t x WHERE x.companyid = p.companyid AND x.processno = p.processno
                               AND x.linetype = 'PRODUCT') f ON TRUE""")
    return "\n UNION ALL \n".join(parts)


def _search_conditions(companyid: str, date_from: date | None, date_to: date | None, receiptno: str, customer: str,
                       warehouse: str, customcode: str, customname: str, itemcode: str, itemname: str, iteminfo: str):
    """합친 행(r)에 거는 조건. 각 묶음 안으로 내려가 적용된다."""
    where = ["r.companyid = %s"]
    params: list = [companyid]
    for column, value in (("r.receiptno", receiptno), ("r.customcode", customcode), ("r.customname", customname),
                          ("r.itemcode", itemcode), ("r.itemname", itemname)):
        normalized = value.strip()
        if normalized:
            where.append(f"{column} ILIKE %s")
            params.append(f"%{normalized}%")
    if iteminfo.strip():
        pattern = f"%{iteminfo.strip()}%"
        where.append("(r.itemcode ILIKE %s OR r.itemname ILIKE %s)")
        params.extend((pattern, pattern))
    if customer.strip():
        # 매입처 = 행의 거래처 (매입처 / 기타비용 거래처 / 매출 기타비용 '예'의 거래처 / 가공처)
        pattern = f"%{customer.strip()}%"
        where.append("(r.customcode ILIKE %s OR r.customname ILIKE %s)")
        params.extend((pattern, pattern))
    if warehouse.strip():
        pattern = f"%{warehouse.strip()}%"
        where.append("(r.warehousecode ILIKE %s OR r.warehousecodename ILIKE %s)")
        params.extend((pattern, pattern))
    if date_from:
        where.append("r.receptdate >= %s")
        params.append(date_from)
    if date_to:
        where.append("r.receptdate <= %s")
        params.append(date_to)
    return " AND ".join(where), params


# 화면·엑셀 칸 순서: 입고일자/매입처/품명/강종/표면/도금량/두께/폭/길이/수량/중량/공급가/부가세/합계금액/창고/제품번호/구분/매입단가/수량단위/단가기준/담당자/비고/입고전표/순번/등록·수정 (전표·순번은 등록일자 왼쪽)
OUTPUT_COLUMNS = (
    ("receptdate", "입고일자"), ("customname", "매입처"), ("itemname", "품명"), ("materialname", "강종"),
    ("surfacename", "표면"), ("myrtle", "도금량(g/㎡)"), ("thickness", "두께"), ("width", "폭"), ("length", "길이"),
    ("qty", "수량"), ("weight", "중량"), ("supplyamt", "공급가"), ("vat", "부가세"), ("unitamt", "합계금액"),
    ("warehousecodename", "창고"), ("productname", "제품번호"), ("kind_label", "구분"),
    ("unitprice", "매입단가"), ("qtyunit", "수량단위"), ("unit", "단가기준"), ("manager", "담당자"), ("description", "비고"),
    ("receiptno", "입고전표"), ("lineno", "순번"),
    ("created_at", "등록일자"), ("created_by", "등록자"), ("updated_at", "수정일자"), ("updated_by", "수정자"),
)
_KIND_LABEL_SQL = ("CASE r.kind WHEN 'INBOUND' THEN '매입' WHEN 'EXPENSE' THEN '기타비용' "
                   "WHEN 'SALES_COST' THEN '매출비용' ELSE '가공비' END")
_SELECT_SQL = ", ".join(
    f"{_KIND_LABEL_SQL} AS kind_label" if key == "kind_label"
    else "COALESCE(cu.username, r.created_by) AS created_by" if key == "created_by"
    else "COALESCE(uu.username, r.updated_by) AS updated_by" if key == "updated_by"
    else "COALESCE(qty_code.code_name, r.qtyunit) AS qtyunit" if key == "qtyunit"   # 코드 → 코드명
    else "COALESCE(price_code.code_name, r.unit) AS unit" if key == "unit"
    else "NULLIF(r.lineno, 0) AS lineno" if key == "lineno"   # 가공비 행(전표 1건 = 1행)은 순번 없음
    else f"r.{key}"
    for key, _label in OUTPUT_COLUMNS
)
_ORDER_SQL = "r.receptdate ASC, r.receiptno ASC, r.kind_order ASC, r.lineno ASC"
_USER_JOINS = """LEFT JOIN user01t AS cu ON cu.email = r.created_by
                 LEFT JOIN user01t AS uu ON uu.email = r.updated_by
                 LEFT JOIN CodeMaster01t AS qty_code
                   ON qty_code.companyid = r.companyid AND qty_code.groupcode = 'QTY' AND qty_code.code = r.qtyunit
                 LEFT JOIN CodeMaster01t AS price_code
                   ON price_code.companyid = r.companyid AND price_code.groupcode = 'PRICE_UNIT' AND price_code.code = r.unit"""


# 엑셀: 행이 이만큼 이하면 메모리에서 바로 만든다 (임시파일로 나눠 쓰는 것보다 2~3배 빠름). 넘으면 메모리를 아끼려고 나눠 쓴다.
IN_MEMORY_EXCEL_ROWS = 60000


def _excel_options(cursor, count_sql: str, params) -> dict:
    cursor.execute(count_sql, params)
    return {"in_memory": True} if cursor.fetchone()[0] <= IN_MEMORY_EXCEL_ROWS else {"constant_memory": True}


def list_inbound_details(
    companyid: str,
    page: int,
    page_size: int,
    date_from: date | None = None,
    date_to: date | None = None,
    receiptno: str = "",
    customer: str = "",
    warehouse: str = "",
    customcode: str = "",
    customname: str = "",
    itemcode: str = "",
    itemname: str = "",
    iteminfo: str = "",
    include_sales_cost: bool = False,
    include_process_cost: bool = False,
    with_summary: bool = True,
):
    where_sql, params = _search_conditions(
        companyid, date_from, date_to, receiptno, customer, warehouse, customcode, customname, itemcode, itemname, iteminfo,
    )
    rows_sql = _rows_sql(include_sales_cost, include_process_cost)
    with inbound_register_module._connect() as connection, connection.cursor() as cursor:
        receipt_count = detail_count = total_qty = total_weight = total_amount = None
        if with_summary:
            # 요약(전표 수·행 수·합계)은 조회조건이 바뀔 때만 계산한다 (쪽 넘김 때는 화면이 이전 값을 그대로 씀).
            # 전표별로 먼저 묶어(해시 집계) 전표 수를 센다 → COUNT(DISTINCT) 정렬보다 가볍다.
            cursor.execute(
                f"""SELECT COUNT(*), COALESCE(SUM(g.n), 0), COALESCE(SUM(g.qty), 0), COALESCE(SUM(g.weight), 0),
                           COALESCE(SUM(g.amount), 0)
                    FROM (SELECT r.receiptno, COUNT(*) AS n, SUM(r.qty) AS qty, SUM(r.weight) AS weight,
                                 SUM(r.unitamt) AS amount
                          FROM ({rows_sql}) AS r WHERE {where_sql}
                          GROUP BY r.receiptno) AS g""",
                params,
            )
            receipt_count, detail_count, total_qty, total_weight, total_amount = cursor.fetchone()
        cursor.execute(
            f"""SELECT r.kind, r.lineno, {_SELECT_SQL}
                FROM (SELECT r.* FROM ({rows_sql}) AS r WHERE {where_sql}
                      ORDER BY {_ORDER_SQL} LIMIT %s OFFSET %s) AS r
                {_USER_JOINS}
                ORDER BY {_ORDER_SQL}""",
            (*params, page_size, (page - 1) * page_size),
        )
        rows = [inbound_register_module._row_dict(cursor, row) for row in cursor.fetchall()]

    return {
        "items": rows,
        "total": detail_count,   # 요약을 건너뛰면 None (화면은 이전 값 유지)
        "page": page,
        "page_size": page_size,
        "summary": None if not with_summary else {
            "receipt_count": receipt_count,
            "detail_count": detail_count,
            "total_qty": total_qty,
            "total_weight": total_weight,
            "total_amount": total_amount,
        },
    }


def write_inbound_details_excel(
    companyid: str,
    output_path: str,
    date_from: date | None = None,
    date_to: date | None = None,
    receiptno: str = "",
    customer: str = "",
    warehouse: str = "",
    customcode: str = "",
    customname: str = "",
    itemcode: str = "",
    itemname: str = "",
    iteminfo: str = "",
    include_sales_cost: bool = False,
    include_process_cost: bool = False,
):
    where_sql, params = _search_conditions(
        companyid, date_from, date_to, receiptno, customer, warehouse, customcode, customname, itemcode, itemname, iteminfo,
    )
    headers = ["No.", *(label for _key, label in OUTPUT_COLUMNS)]
    keys = [key for key, _label in OUTPUT_COLUMNS]
    number_keys = {"myrtle", "thickness", "width", "length", "qty", "weight", "lineno"}
    money_keys = {"supplyamt", "vat", "unitamt", "unitprice"}
    rows_sql = _rows_sql(include_sales_cost, include_process_cost)
    query = f"""SELECT {_SELECT_SQL}
                FROM ({rows_sql}) AS r
                {_USER_JOINS}
                WHERE {where_sql}
                ORDER BY {_ORDER_SQL}"""

    with inbound_register_module._connect() as connection, connection.cursor() as cursor:
        options = _excel_options(cursor, f"SELECT COUNT(*) FROM ({rows_sql}) AS r WHERE {where_sql}", params)
    workbook = xlsxwriter.Workbook(output_path, options)
    worksheet = workbook.add_worksheet("매입현황")
    header_format = workbook.add_format({
        "bold": True, "font_color": "#B4232D", "bg_color": "#FFF3F3", "border": 1, "border_color": "#E5BFC2", "valign": "vcenter",
    })
    date_format = workbook.add_format({"num_format": "yyyy-mm-dd"})
    datetime_format = workbook.add_format({"num_format": "yyyy-mm-dd hh:mm:ss"})
    integer_format = workbook.add_format({"num_format": "#,##0;[Red]-#,##0;0"})
    number_format = workbook.add_format({"num_format": "#,##0.###"})
    money_format = workbook.add_format({"num_format": "#,##0.##"})
    worksheet.write_row(0, 0, headers, header_format)
    worksheet.freeze_panes(1, 0)
    worksheet.set_column(0, 0, 8)
    for index, key in enumerate(keys, start=1):
        width = 13 if key in number_keys else 16 if key in money_keys else 22 if key in ("created_at", "updated_at") else 18
        worksheet.set_column(index, index, width)

    row_number = 1
    try:
        with inbound_register_module._connect() as connection:
            with connection.cursor(name="inbound_search_excel_cursor") as cursor:
                cursor.itersize = 2000
                cursor.execute(query, params)
                while rows := cursor.fetchmany(2000):
                    for row in rows:
                        worksheet.write_number(row_number, 0, row_number)
                        for column_index, (key, value) in enumerate(zip(keys, row), start=1):
                            if value is None:
                                continue
                            if isinstance(value, datetime):
                                excel_datetime = value.astimezone(ZoneInfo("Asia/Seoul")).replace(tzinfo=None) if value.tzinfo else value
                                worksheet.write_datetime(row_number, column_index, excel_datetime, datetime_format)
                            elif key == "receptdate" and isinstance(value, date):
                                worksheet.write_datetime(row_number, column_index, value, date_format)
                            elif key in number_keys or key in money_keys:
                                numeric_value = float(value)
                                if numeric_value.is_integer():
                                    worksheet.write_number(row_number, column_index, int(numeric_value), integer_format)
                                else:
                                    worksheet.write_number(row_number, column_index, numeric_value,
                                                           number_format if key in number_keys else money_format)
                            else:
                                worksheet.write(row_number, column_index, value)
                        row_number += 1
        worksheet.autofilter(0, 0, max(0, row_number - 1), len(headers) - 1)
    finally:
        workbook.close()
    return row_number - 1
