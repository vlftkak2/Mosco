from datetime import date

from services.outbound import OutboundRegister as outbound_register_module
import xlsxwriter


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
    where = ["h.companyid = %s"]
    params: list = [companyid]

    for column, value in (
        ("h.receiptno", receiptno),
        ("h.customcode", customcode),
        ("h.customname", customname),
        ("d.itemcode", itemcode),
        ("d.itemname", itemname),
    ):
        normalized = value.strip()
        if normalized:
            where.append(f"{column} ILIKE %s")
            params.append(f"%{normalized}%")

    if customer.strip():
        pattern = f"%{customer.strip()}%"
        where.append("(h.customcode ILIKE %s OR h.customname ILIKE %s)")
        params.extend((pattern, pattern))

    if warehouse.strip():
        pattern = f"%{warehouse.strip()}%"
        where.append("(d.warehousecode ILIKE %s OR d.warehousecodename ILIKE %s)")
        params.extend((pattern, pattern))

    if iteminfo.strip():
        pattern = f"%{iteminfo.strip()}%"
        where.append("(d.itemcode ILIKE %s OR d.itemname ILIKE %s)")
        params.extend((pattern, pattern))

    if date_from:
        where.append("h.receptdate >= %s")
        params.append(date_from)
    if date_to:
        where.append("h.receptdate <= %s")
        params.append(date_to)

    return " AND ".join(where), params


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
):
    where_sql, params = _search_conditions(
        companyid, date_from, date_to, receiptno, customcode, customname, itemcode, itemname,
        customer, warehouse, iteminfo,
    )
    with outbound_register_module._connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            f"""
            SELECT COUNT(DISTINCT h.receiptno), COUNT(*),
                   COALESCE(SUM(d.qty), 0), COALESCE(SUM(d.weight), 0), COALESCE(SUM(d.unitamt), 0)
            FROM Outbound01t AS h
            JOIN Outbound02t AS d
              ON d.companyid = h.companyid
             AND d.receiptno = h.receiptno
            WHERE {where_sql}
            """,
            params,
        )
        receipt_count, detail_count, total_qty, total_weight, total_amount = cursor.fetchone()
        total = detail_count

        cursor.execute(
            f"""
            WITH matched_receipts AS (
                SELECT DISTINCT h.companyid, h.receiptno
                FROM Outbound01t AS h
                JOIN Outbound02t AS d
                  ON d.companyid = h.companyid
                 AND d.receiptno = h.receiptno
                WHERE {where_sql}
            ), expense_totals AS (
                SELECT e.companyid, e.receiptno, SUM(e.totalamt) AS other_cost_amount
                FROM Outbound03t AS e
                JOIN matched_receipts AS mr
                  ON mr.companyid = e.companyid
                 AND mr.receiptno = e.receiptno
                GROUP BY e.companyid, e.receiptno
            )
            SELECT h.receiptno, h.receptdate AS receptdate,
                   h.customname AS customname,
                   d.lineno, d.warehousecodename, d.productname, d.itemname,
                   d.materialname, d.surfacename, d.myrtle,
                   d.thickness, d.width, d.length, d.qty, d.weight,
                   d.unitprice, d.supplyamt, d.vat, d.unitamt,
                   COALESCE(et.other_cost_amount, 0) AS other_cost_amount,
                   d.qtyunit, d.unit,
                    COALESCE(NULLIF(BTRIM(h.manager), ''), d.manager) AS manager,
                    COALESCE(NULLIF(BTRIM(h.description), ''), d.description) AS description,
                   d.created_at, COALESCE(d.updated_at, h.updated_at) AS updated_at,
                   COALESCE((SELECT u.username FROM user01t u WHERE u.email = d.created_by LIMIT 1), d.created_by) AS created_by,
                   COALESCE((SELECT u.username FROM user01t u WHERE u.email = COALESCE(d.updated_by, h.updated_by) LIMIT 1),
                            COALESCE(d.updated_by, h.updated_by)) AS updated_by
            FROM Outbound01t AS h
            JOIN Outbound02t AS d
              ON d.companyid = h.companyid
             AND d.receiptno = h.receiptno
            LEFT JOIN expense_totals AS et
              ON et.companyid = h.companyid
             AND et.receiptno = h.receiptno
            WHERE {where_sql}
            ORDER BY h.receptdate ASC, h.receiptno ASC, d.lineno
            LIMIT %s OFFSET %s
            """,
            (*params, *params, page_size, (page - 1) * page_size),
        )
        rows = [outbound_register_module._row_dict(cursor, row) for row in cursor.fetchall()]

    return {
        "items": rows,
        "total": total,
        "page": page,
        "page_size": page_size,
        "summary": {
            "receipt_count": receipt_count,
            "detail_count": detail_count,
            "total_qty": total_qty,
            "total_weight": total_weight,
            "total_amount": total_amount,
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
    headers = [
        "No.", "출고일자", "출고전표", "거래처", "창고", "제품번호", "품명", "강종", "표면",
        "도금량(g/㎡)", "두께", "폭", "길이", "출고수량", "출고중량", "판매단가", "공급가", "부가세",
        "합계금액", "수량단위", "단가기준", "담당자", "비고", "상세 등록일자", "상세 수정일자", "등록자", "수정자",
    ]
    headers.insert(19, "\uAE30\uD0C0\uBE44\uC6A9 \uD569\uACC4")
    query = f"""
            WITH matched_receipts AS (
                SELECT DISTINCT h.companyid, h.receiptno
                FROM Outbound01t AS h
                JOIN Outbound02t AS d
                  ON d.companyid = h.companyid
                 AND d.receiptno = h.receiptno
                WHERE {where_sql}
            ), expense_totals AS (
                SELECT e.companyid, e.receiptno, SUM(e.totalamt) AS other_cost_amount
                FROM Outbound03t AS e
                JOIN matched_receipts AS mr
                  ON mr.companyid = e.companyid
                 AND mr.receiptno = e.receiptno
                GROUP BY e.companyid, e.receiptno
            )
        SELECT h.receptdate AS receptdate, h.receiptno, h.customname,
               d.warehousecodename, d.productname, d.itemname, d.materialname, d.surfacename,
               d.myrtle, d.thickness, d.width, d.length, d.qty, d.weight,
               d.unitprice, d.supplyamt, d.vat, d.unitamt,
               COALESCE(et.other_cost_amount, 0) AS other_cost_amount,
               d.qtyunit, d.unit,
                COALESCE(NULLIF(BTRIM(h.manager), ''), d.manager) AS manager,
                COALESCE(NULLIF(BTRIM(h.description), ''), d.description) AS description,
                d.created_at, COALESCE(d.updated_at, h.updated_at) AS updated_at,
                COALESCE((SELECT u.username FROM user01t u WHERE u.email = d.created_by LIMIT 1), d.created_by) AS created_by,
                COALESCE((SELECT u.username FROM user01t u WHERE u.email = COALESCE(d.updated_by, h.updated_by) LIMIT 1),
                         COALESCE(d.updated_by, h.updated_by)) AS updated_by
        FROM Outbound01t AS h
        JOIN Outbound02t AS d
          ON d.companyid = h.companyid
         AND d.receiptno = h.receiptno
        LEFT JOIN expense_totals AS et
          ON et.companyid = h.companyid
         AND et.receiptno = h.receiptno
        WHERE {where_sql}
        ORDER BY h.receptdate ASC, h.receiptno ASC, d.lineno
    """

    workbook = xlsxwriter.Workbook(output_path, {"constant_memory": True})
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
    number_format = workbook.add_format({"num_format": "#,##0.###"})
    money_format = workbook.add_format({"num_format": "#,##0.##"})
    worksheet.write_row(0, 0, headers, header_format)
    worksheet.freeze_panes(1, 0)
    worksheet.autofilter(0, 0, 0, len(headers) - 1)
    worksheet.set_column("A:A", 8)
    worksheet.set_column("B:B", 13, date_format)
    worksheet.set_column("C:D", 20)
    worksheet.set_column("E:F", 18)
    worksheet.set_column("G:I", 20)
    worksheet.set_column("J:M", 14, number_format)
    worksheet.set_column("N:O", 14, number_format)
    worksheet.set_column("P:T", 16, money_format)
    worksheet.set_column("U:V", 14)
    worksheet.set_column("W:W", 18)
    worksheet.set_column("X:X", 30)
    worksheet.set_column("Y:Z", 22, datetime_format)
    worksheet.set_column("AA:AB", 14)

    row_number = 1
    try:
        with outbound_register_module._connect() as connection:
            with connection.cursor(name="outbound_search_excel_cursor") as cursor:
                cursor.itersize = 2000
                cursor.execute(query, (*params, *params))
                while rows := cursor.fetchmany(2000):
                    for row in rows:
                        worksheet.write_number(row_number, 0, row_number)
                        for column_index, value in enumerate(row, start=1):
                            if value is None:
                                continue
                            if column_index == 1 and isinstance(value, date):
                                worksheet.write_datetime(row_number, column_index, value, date_format)
                            elif column_index in (24, 25):
                                worksheet.write_datetime(row_number, column_index, value.replace(tzinfo=None), datetime_format)
                            elif column_index in (9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19):
                                numeric_value = float(value)
                                format_for_value = number_format if column_index in (9, 10, 11, 12, 13, 14) else money_format
                                if numeric_value.is_integer():
                                    worksheet.write_number(row_number, column_index, int(numeric_value), integer_format)
                                else:
                                    worksheet.write_number(row_number, column_index, numeric_value, format_for_value)
                            else:
                                worksheet.write(row_number, column_index, value)
                        row_number += 1
        worksheet.autofilter(0, 0, max(0, row_number - 1), len(headers) - 1)
    finally:
        workbook.close()

    return row_number - 1
