"""매출현황 (메뉴: OUTBOUND_SEARCH)

조회 행 = 매출 상세 + 그 전표의 기타비용(같은 전표번호, 품명 = 비용구분, 매출처 = 전표에 입력한 매출처)
  - 기타비용 비용여부 '예'  (우리가 운송사 등에 지급) → 공급가·부가세·합계금액은 비우고 '비용(-)' 칸에 입력한 합계금액 그대로
  - 기타비용 비용여부 '아니오' (매출처 부담)          → 공급가·부가세·합계금액 그대로
조회조건은 모든 행에 똑같이 적용하고(바깥 WHERE 가 각 묶음 안으로 내려가 인덱스를 쓴다), 페이지 단위로만 가져온다.
매출등록·현재고·수불장·원가는 읽기만 하고 바꾸지 않는다.
"""
from datetime import date, datetime
from zoneinfo import ZoneInfo

from services.outbound import OutboundRegister as outbound_register_module
import xlsxwriter

# 매출 상세 + 기타비용. 두 묶음의 칸 이름·형식이 같다.
# Outbound02t.weight = 총중량(현재고·수불장 반영), 중량 = 총중량 - 조정.
_ROWS_SQL = """
    SELECT 'SALES'::varchar AS kind, 1 AS kind_order, h.companyid, h.receptdate, h.receiptno, d.lineno,
           h.customcode, h.customname, d.itemcode, d.itemname, d.materialname,
           d.thickness, d.width, d.length, d.qty,
           d.weight - d.adjweight AS weight, d.adjweight, d.weight AS totalweight,
           d.unitprice, d.supplyamt, d.vat, d.unitamt, NULL::numeric AS costamt, NULL::varchar AS purchaseyn,
           d.productname, d.warehousecode, d.warehousecodename, d.surfacename, d.myrtle, d.qtyunit, d.unit,
           COALESCE(NULLIF(BTRIM(h.manager), ''), d.manager) AS manager,
           COALESCE(NULLIF(BTRIM(d.description), ''), h.description) AS description,
           d.created_at, COALESCE(d.updated_at, h.updated_at) AS updated_at,
           d.created_by, COALESCE(d.updated_by, h.updated_by) AS updated_by
    FROM Outbound01t AS h
    JOIN Outbound02t AS d ON d.companyid = h.companyid AND d.receiptno = h.receiptno
    UNION ALL
    SELECT 'EXPENSE', 2, h.companyid, h.receptdate, h.receiptno, e.lineno,
           h.customcode, h.customname,
           e.costcode, e.costname, NULL::varchar,
           NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric,
           NULL::numeric, NULL::numeric, NULL::numeric,
           NULL::numeric,
           CASE WHEN s.purchaseyn = 'Y' THEN NULL ELSE e.supplyamt END,
           CASE WHEN s.purchaseyn = 'Y' THEN NULL ELSE e.vat END,
           CASE WHEN s.purchaseyn = 'Y' THEN NULL ELSE e.totalamt END,
           CASE WHEN s.purchaseyn = 'Y' THEN e.totalamt END,
           s.purchaseyn,
           NULL::varchar, w.warehousecode, w.warehousecodename, NULL::varchar, NULL::numeric, NULL::varchar, NULL::varchar,
           h.manager, e.description,
           e.created_at, e.updated_at, e.created_by, e.updated_by
    FROM Outbound01t AS h
    JOIN Outbound03t AS e ON e.companyid = h.companyid AND e.receiptno = h.receiptno
    CROSS JOIN LATERAL (SELECT CASE WHEN UPPER(COALESCE(e.purchaseyn, 'N')) = 'Y' THEN 'Y' ELSE 'N' END AS purchaseyn) AS s
    LEFT JOIN LATERAL (SELECT d.warehousecode, d.warehousecodename FROM Outbound02t d
                       WHERE d.companyid = h.companyid AND d.receiptno = h.receiptno ORDER BY d.lineno LIMIT 1) AS w ON TRUE
"""


def _search_conditions(
    companyid: str,
    date_from: date | None,
    date_to: date | None,
    receiptno: str,
    customcode: str,
    customname: str,
    itemcode: str,
    itemname: str,
    customer: str = "",
    warehouse: str = "",
    iteminfo: str = "",
):
    """합친 행(r)에 거는 조건. 각 묶음 안으로 내려가 적용된다.
    기타비용 행: 매출처 = 전표 매출처, 창고 = 전표 첫 상세 창고, 품목 = 비용구분."""
    where = ["r.companyid = %s"]
    params: list = [companyid]

    for column, value in (
        ("r.receiptno", receiptno),
        ("r.customcode", customcode),
        ("r.customname", customname),
        ("r.itemcode", itemcode),
        ("r.itemname", itemname),
    ):
        normalized = value.strip()
        if normalized:
            where.append(f"{column} ILIKE %s")
            params.append(f"%{normalized}%")

    if customer.strip():
        pattern = f"%{customer.strip()}%"
        where.append("(r.customcode ILIKE %s OR r.customname ILIKE %s)")
        params.extend((pattern, pattern))

    if warehouse.strip():
        pattern = f"%{warehouse.strip()}%"
        where.append("(r.warehousecode ILIKE %s OR r.warehousecodename ILIKE %s)")
        params.extend((pattern, pattern))

    if iteminfo.strip():
        pattern = f"%{iteminfo.strip()}%"
        where.append("(r.itemcode ILIKE %s OR r.itemname ILIKE %s)")
        params.extend((pattern, pattern))

    if date_from:
        where.append("r.receptdate >= %s")
        params.append(date_from)
    if date_to:
        where.append("r.receptdate <= %s")
        params.append(date_to)

    return " AND ".join(where), params


# 매출현황 칸 순서 (화면·엑셀 공통): 매입현황과 같은 순서
#   출고일자/매출처/품명/강종/표면/도금량/두께/폭/길이/수량/중량/[조정/총중량]/공급가/부가세/합계금액/[비용(-)]/
#   창고/제품번호/구분/매출단가/수량단위/단가기준/담당자/비고/출고전표/순번/등록·수정 (전표·순번은 등록일자 왼쪽).  [ ] = 매출현황에만 있는 칸
# (key, 엑셀 제목, 엑셀 형식)
OUTPUT_COLUMNS = [
    ("receptdate", "출고일자", "date"),
    ("customname", "매출처", "text"),
    ("itemname", "품명", "text"),
    ("materialname", "강종", "text"),
    ("surfacename", "표면", "text"),
    ("myrtle", "도금량(g/㎡)", "number"),
    ("thickness", "두께", "number"),
    ("width", "폭", "number"),
    ("length", "길이", "number"),
    ("qty", "수량", "number"),
    ("weight", "중량", "number"),
    ("adjweight", "조정(Kg)", "number"),
    ("totalweight", "총중량", "number"),
    ("supplyamt", "공급가", "money"),
    ("vat", "부가세", "money"),
    ("unitamt", "합계금액", "money"),
    ("costamt", "비용(-)", "money"),
    ("warehousecodename", "창고", "text"),
    ("productname", "제품번호", "text"),
    ("kind_label", "구분", "text"),
    ("unitprice", "매출단가", "money"),
    ("qtyunit", "수량단위", "text"),
    ("unit", "단가기준", "text"),
    ("manager", "담당자", "text"),
    ("description", "비고", "text"),
    ("receiptno", "출고전표", "text"),
    ("lineno", "순번", "number"),
    ("created_at", "등록일자", "datetime"),
    ("created_by", "등록자", "text"),
    ("updated_at", "수정일자", "datetime"),
    ("updated_by", "수정자", "text"),
]
_KIND_LABEL_SQL = ("CASE WHEN r.kind = 'SALES' THEN '매출' "
                   "WHEN r.purchaseyn = 'Y' THEN '기타비용(예)' ELSE '기타비용(아니오)' END")
_SELECT_SQL = ", ".join(
    f"{_KIND_LABEL_SQL} AS kind_label" if key == "kind_label"
    else "COALESCE(cu.username, r.created_by) AS created_by" if key == "created_by"
    else "COALESCE(uu.username, r.updated_by) AS updated_by" if key == "updated_by"
    else f"r.{key}"
    for key, _title, _kind in OUTPUT_COLUMNS
)
_ORDER_SQL = "r.receptdate ASC, r.receiptno ASC, r.kind_order ASC, r.lineno ASC"
# 등록자·수정자 이름은 페이지로 자른 행에만 붙인다
_USER_JOINS = """LEFT JOIN user01t AS cu ON cu.email = r.created_by
                 LEFT JOIN user01t AS uu ON uu.email = r.updated_by"""


# 엑셀: 행이 이만큼 이하면 메모리에서 바로 만든다 (임시파일로 나눠 쓰는 것보다 2~3배 빠름). 넘으면 메모리를 아끼려고 나눠 쓴다.
IN_MEMORY_EXCEL_ROWS = 60000


def _excel_options(cursor, count_sql: str, params) -> dict:
    cursor.execute(count_sql, params)
    return {"in_memory": True} if cursor.fetchone()[0] <= IN_MEMORY_EXCEL_ROWS else {"constant_memory": True}


def list_outbound_details(
    companyid: str,
    page: int,
    page_size: int,
    date_from: date | None = None,
    date_to: date | None = None,
    receiptno: str = "",
    customcode: str = "",
    customname: str = "",
    itemcode: str = "",
    itemname: str = "",
    customer: str = "",
    warehouse: str = "",
    iteminfo: str = "",
    with_summary: bool = True,
):
    where_sql, params = _search_conditions(
        companyid, date_from, date_to, receiptno, customcode, customname, itemcode, itemname,
        customer, warehouse, iteminfo,
    )
    with outbound_register_module._connect() as connection, connection.cursor() as cursor:
        # 수량·중량은 매출 행만(기타비용 행은 비어 있음). 합계금액 = 매출 + 기타비용 '아니오' ('예'는 비용(-) 칸이라 제외)
        receipt_count = detail_count = total_qty = total_weight = total_amount = total_cost = None
        if with_summary:
            # 요약(전표 수·행 수·합계)은 조회조건이 바뀔 때만 계산한다 (쪽 넘김 때는 화면이 이전 값을 그대로 씀).
            # 전표별로 먼저 묶어(해시 집계) 전표 수를 센다 → COUNT(DISTINCT) 정렬보다 가볍다.
            cursor.execute(
                f"""SELECT COUNT(*), COALESCE(SUM(g.n), 0), COALESCE(SUM(g.qty), 0), COALESCE(SUM(g.weight), 0),
                           COALESCE(SUM(g.amount), 0), COALESCE(SUM(g.cost), 0)
                    FROM (SELECT r.receiptno, COUNT(*) AS n, SUM(r.qty) AS qty, SUM(r.totalweight) AS weight,
                                 SUM(r.unitamt) AS amount, SUM(r.costamt) AS cost
                          FROM ({_ROWS_SQL}) AS r WHERE {where_sql}
                          GROUP BY r.receiptno) AS g""",
                params,
            )
            receipt_count, detail_count, total_qty, total_weight, total_amount, total_cost = cursor.fetchone()
        cursor.execute(
            f"""SELECT r.kind, r.lineno, {_SELECT_SQL}
                FROM (SELECT r.* FROM ({_ROWS_SQL}) AS r WHERE {where_sql}
                      ORDER BY {_ORDER_SQL} LIMIT %s OFFSET %s) AS r
                {_USER_JOINS}
                ORDER BY {_ORDER_SQL}""",
            (*params, page_size, (page - 1) * page_size),
        )
        rows = [outbound_register_module._row_dict(cursor, row) for row in cursor.fetchall()]

    return {
        "items": rows,
        "total": detail_count,   # 요약을 건너뛰면 None (화면은 이전 값 유지)
        "page": page,
        "page_size": page_size,
        "summary": None if not with_summary else {
            "receipt_count": receipt_count,
            "detail_count": detail_count,
            "total_qty": total_qty,
            "total_weight": total_weight,  # 총중량 합계
            "total_amount": total_amount,  # 매출 합계 + 기타비용 '아니오'
            "total_cost": total_cost,      # 비용(-) 합계 (기타비용 '예', 입력한 금액 그대로)
        },
    }


def write_outbound_details_excel(
    companyid: str,
    output_path: str,
    date_from: date | None = None,
    date_to: date | None = None,
    receiptno: str = "",
    customcode: str = "",
    customname: str = "",
    itemcode: str = "",
    itemname: str = "",
    customer: str = "",
    warehouse: str = "",
    iteminfo: str = "",
):
    where_sql, params = _search_conditions(
        companyid, date_from, date_to, receiptno, customcode, customname, itemcode, itemname,
        customer, warehouse, iteminfo,
    )
    headers = ["No.", *(title for _, title, _ in OUTPUT_COLUMNS)]
    kinds = [kind for _, _, kind in OUTPUT_COLUMNS]
    widths = {"date": 13, "datetime": 18, "number": 12, "money": 15, "text": 18}
    query = f"""SELECT {_SELECT_SQL}
                FROM ({_ROWS_SQL}) AS r
                {_USER_JOINS}
                WHERE {where_sql}
                ORDER BY {_ORDER_SQL}"""

    with outbound_register_module._connect() as connection, connection.cursor() as cursor:
        options = _excel_options(cursor, f"SELECT COUNT(*) FROM ({_ROWS_SQL}) AS r WHERE {where_sql}", params)
    workbook = xlsxwriter.Workbook(output_path, options)
    worksheet = workbook.add_worksheet("매출현황")
    header_format = workbook.add_format({
        "bold": True,
        "font_color": "#B4232D",
        "bg_color": "#FFF3F3",
        "border": 1,
        "border_color": "#E5BFC2",
        "valign": "vcenter",
    })
    date_format = workbook.add_format({"num_format": "yyyy-mm-dd"})
    datetime_format = workbook.add_format({"num_format": "yyyy-mm-dd hh:mm"})
    # Give numeric columns an integer default so blank/untouched cells never
    # inherit an optional-decimal format that can render a dangling decimal mark.
    integer_format = workbook.add_format({"num_format": "#,##0;[Red]-#,##0;0"})
    number_format = workbook.add_format({"num_format": "#,##0.###;[Red]-#,##0.###"})
    money_format = workbook.add_format({"num_format": "#,##0.##;[Red]-#,##0.##"})
    worksheet.write_row(0, 0, headers, header_format)
    worksheet.freeze_panes(1, 0)
    worksheet.set_column(0, 0, 8)
    for index, kind in enumerate(kinds, start=1):
        worksheet.set_column(index, index, widths[kind])

    row_number = 1
    try:
        with outbound_register_module._connect() as connection:
            with connection.cursor(name="outbound_search_excel_cursor") as cursor:
                cursor.itersize = 2000
                cursor.execute(query, params)
                while rows := cursor.fetchmany(2000):
                    for row in rows:
                        worksheet.write_number(row_number, 0, row_number)
                        for column_index, (value, kind) in enumerate(zip(row, kinds), start=1):
                            if value is None:
                                continue
                            if kind == "date":
                                worksheet.write_datetime(row_number, column_index, value, date_format)
                            elif kind == "datetime" and isinstance(value, datetime):
                                excel_datetime = value.astimezone(ZoneInfo("Asia/Seoul")).replace(tzinfo=None) if value.tzinfo else value
                                worksheet.write_datetime(row_number, column_index, excel_datetime, datetime_format)
                            elif kind in ("number", "money"):
                                numeric_value = float(value)
                                if numeric_value.is_integer():
                                    worksheet.write_number(row_number, column_index, int(numeric_value), integer_format)
                                else:
                                    worksheet.write_number(row_number, column_index, numeric_value,
                                                           number_format if kind == "number" else money_format)
                            else:
                                worksheet.write(row_number, column_index, value)
                        row_number += 1
        worksheet.autofilter(0, 0, max(0, row_number - 1), len(headers) - 1)
    finally:
        workbook.close()

    return row_number - 1
