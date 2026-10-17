from datetime import date

import OutboundRegister as outbound_register_module
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
):
    where_sql, params = _search_conditions(
        companyid, date_from, date_to, receiptno, customcode, customname, itemcode, itemname,
    )
    with outbound_register_module._connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            f"""
            SELECT COUNT(*)
            FROM Outbound01t AS h
            JOIN Outbound02t AS d
              ON d.companyid = h.companyid
             AND d.receiptno = h.receiptno
            WHERE {where_sql}
            """,
            params,
        )
        total = cursor.fetchone()[0]

        cursor.execute(
            f"""
            SELECT h.receiptno, h.receptdate, h.customcode, h.customname,
                   d.lineno, d.itemcode, d.itemname, d.size,
                   d.qty, d.qtyunit, d.warehousecode, d.warehousecodename,
                   d.weight, d.unit, d.unitprice, d.unitamt, d.description,
                   d.created_at, d.updated_at
            FROM Outbound01t AS h
            JOIN Outbound02t AS d
              ON d.companyid = h.companyid
             AND d.receiptno = h.receiptno
            WHERE {where_sql}
            ORDER BY h.receptdate DESC, h.receiptno DESC, d.lineno
            LIMIT %s OFFSET %s
            """,
            (*params, page_size, (page - 1) * page_size),
        )
        rows = [outbound_register_module._row_dict(cursor, row) for row in cursor.fetchall()]

    return {"items": rows, "total": total, "page": page, "page_size": page_size}


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
):
    where_sql, params = _search_conditions(
        companyid, date_from, date_to, receiptno, customcode, customname, itemcode, itemname,
    )
    headers = [
        "No.", "출고일자", "출고전표번호", "거래처코드", "거래처명", "품목코드", "품목명", "규격",
        "수량", "수량단위", "창고코드", "창고명", "출고중량", "단가기준", "판매단가", "금액", "비고",
    ]
    query = f"""
        SELECT h.receptdate, h.receiptno, h.customcode, h.customname,
               d.itemcode, d.itemname, d.size, d.qty, d.qtyunit,
               d.warehousecode, d.warehousecodename, d.weight, d.unit,
               d.unitprice, d.unitamt, d.description
        FROM Outbound01t AS h
        JOIN Outbound02t AS d
          ON d.companyid = h.companyid
         AND d.receiptno = h.receiptno
        WHERE {where_sql}
        ORDER BY h.receptdate DESC, h.receiptno DESC, d.lineno
    """

    workbook = xlsxwriter.Workbook(output_path, {"constant_memory": True})
    worksheet = workbook.add_worksheet("출고현황")
    header_format = workbook.add_format({
        "bold": True,
        "font_color": "#B4232D",
        "bg_color": "#FFF3F3",
        "border": 1,
        "border_color": "#E5BFC2",
        "valign": "vcenter",
    })
    date_format = workbook.add_format({"num_format": "yyyy-mm-dd"})
    number_format = workbook.add_format({"num_format": "#,##0.###"})
    money_format = workbook.add_format({"num_format": "#,##0.##"})
    worksheet.write_row(0, 0, headers, header_format)
    worksheet.freeze_panes(1, 0)
    worksheet.autofilter(0, 0, 0, len(headers) - 1)
    worksheet.set_column("A:A", 8)
    worksheet.set_column("B:B", 13, date_format)
    worksheet.set_column("C:C", 24)
    worksheet.set_column("D:D", 16)
    worksheet.set_column("E:E", 24)
    worksheet.set_column("F:F", 18)
    worksheet.set_column("G:G", 28)
    worksheet.set_column("H:H", 18)
    worksheet.set_column("I:I", 13, number_format)
    worksheet.set_column("J:J", 15)
    worksheet.set_column("K:K", 16)
    worksheet.set_column("L:L", 20)
    worksheet.set_column("M:M", 15, number_format)
    worksheet.set_column("N:N", 15)
    worksheet.set_column("O:P", 16, money_format)
    worksheet.set_column("Q:Q", 30)

    row_number = 1
    try:
        with outbound_register_module._connect() as connection:
            with connection.cursor(name="outbound_search_excel_cursor") as cursor:
                cursor.itersize = 2000
                cursor.execute(query, params)
                while rows := cursor.fetchmany(2000):
                    for row in rows:
                        worksheet.write_number(row_number, 0, row_number)
                        for column_index, value in enumerate(row, start=1):
                            if value is None:
                                continue
                            if column_index == 1 and isinstance(value, date):
                                worksheet.write_datetime(row_number, column_index, value, date_format)
                            elif column_index in (8, 12, 14, 15):
                                worksheet.write_number(row_number, column_index, float(value), number_format if column_index in (8, 12) else money_format)
                            else:
                                worksheet.write(row_number, column_index, value)
                        row_number += 1
        worksheet.autofilter(0, 0, max(0, row_number - 1), len(headers) - 1)
    finally:
        workbook.close()

    return row_number - 1
