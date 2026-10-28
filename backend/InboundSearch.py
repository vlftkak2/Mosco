from datetime import date, datetime
from zoneinfo import ZoneInfo

import InboundRegister as inbound_register_module
import xlsxwriter


def _search_conditions(
    companyid: str,
    date_from: date | None,
    date_to: date | None,
    receiptno: str,
    customer: str,
    warehouse: str,
    customcode: str,
    customname: str,
    itemcode: str,
    itemname: str,
    iteminfo: str,
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

    if iteminfo.strip():
        pattern = f"%{iteminfo.strip()}%"
        where.append("(d.itemcode ILIKE %s OR d.itemname ILIKE %s)")
        params.extend((pattern, pattern))

    if customer.strip():
        pattern = f"%{customer.strip()}%"
        where.append("(h.customcode ILIKE %s OR h.customname ILIKE %s)")
        params.extend((pattern, pattern))

    if warehouse.strip():
        pattern = f"%{warehouse.strip()}%"
        where.append("(d.warehousecode ILIKE %s OR d.warehousecodename ILIKE %s)")
        params.extend((pattern, pattern))

    if date_from:
        where.append("h.receptdate >= %s")
        params.append(date_from)
    if date_to:
        where.append("h.receptdate <= %s")
        params.append(date_to)

    return " AND ".join(where), params


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
):
    where_sql, params = _search_conditions(
        companyid, date_from, date_to, receiptno, customer, warehouse, customcode, customname, itemcode, itemname, iteminfo,
    )
    with inbound_register_module._connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            f"""
            SELECT COUNT(DISTINCT h.receiptno), COUNT(*),
                   COALESCE(SUM(d.qty), 0),
                   COALESCE(SUM(d.weight), 0),
                   COALESCE(SUM(d.unitamt), 0)
            FROM Inbound01t AS h
            JOIN Inbound02t AS d
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
            SELECT h.receiptno, h.receptdate,
               h.customname AS customname,
               d.warehousecodename, d.productname, d.itemname, d.materialname, d.surfacename, d.myrtle,
                   d.thickness, d.width, d.length, d.qty,
                   CASE WHEN UPPER(BTRIM(COALESCE(d.unit, ''))) LIKE '%%TON%%'
                          OR BTRIM(COALESCE(d.unit, '')) LIKE '%%톤%%'
                        THEN d.weight / 1000 ELSE d.weight END AS weight,
                   d.unitprice, d.supplyamt, d.vat, d.unitamt, d.qtyunit, d.unit, d.manager, d.description,
                   d.created_at, d.updated_at
            FROM Inbound01t AS h
            JOIN Inbound02t AS d
              ON d.companyid = h.companyid
             AND d.receiptno = h.receiptno
            WHERE {where_sql}
            ORDER BY h.receptdate ASC, h.receiptno ASC, d.lineno
            LIMIT %s OFFSET %s
            """,
            (*params, page_size, (page - 1) * page_size),
        )
        rows = [inbound_register_module._row_dict(cursor, row) for row in cursor.fetchall()]

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
):
    where_sql, params = _search_conditions(
        companyid, date_from, date_to, receiptno, customer, warehouse, customcode, customname, itemcode, itemname, iteminfo,
    )
    headers = [
        "No.", "입고일자", "입고전표", "매입처", "창고", "제품번호", "품명", "강종", "표면",
        "도금량(g/㎡)", "두께", "폭", "길이", "수량", "중량", "매입단가", "공급가", "부가세",
        "합계금액", "수량단위", "단가기준", "담당자", "비고",
        "등록일자", "수정일자",
    ]
    query = f"""
        SELECT h.receptdate, h.receiptno,
               h.customname, d.warehousecodename, d.productname, d.itemname,
               d.materialname, d.surfacename, d.myrtle,
               d.thickness, d.width, d.length, d.qty,
               CASE WHEN UPPER(BTRIM(COALESCE(d.unit, ''))) LIKE '%%TON%%'
                          OR BTRIM(COALESCE(d.unit, '')) LIKE '%%톤%%'
                    THEN d.weight / 1000 ELSE d.weight END AS weight,
               d.unitprice, d.supplyamt, d.vat, d.unitamt, d.qtyunit, d.unit, d.manager, d.description,
               d.created_at, d.updated_at
        FROM Inbound01t AS h
        JOIN Inbound02t AS d
          ON d.companyid = h.companyid
         AND d.receiptno = h.receiptno
        WHERE {where_sql}
        ORDER BY h.receptdate ASC, h.receiptno ASC, d.lineno
    """

    workbook = xlsxwriter.Workbook(output_path, {"constant_memory": True})
    worksheet = workbook.add_worksheet("입고현황")
    header_format = workbook.add_format({
        "bold": True,
        "font_color": "#B4232D",
        "bg_color": "#FFF3F3",
        "border": 1,
        "border_color": "#E5BFC2",
        "valign": "vcenter",
    })
    date_format = workbook.add_format({"num_format": "yyyy-mm-dd"})
    datetime_format = workbook.add_format({"num_format": "yyyy-mm-dd hh:mm:ss"})
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
    worksheet.set_column("C:C", 24)
    worksheet.set_column("D:E", 24)
    worksheet.set_column("F:F", 18)
    worksheet.set_column("G:G", 28)
    worksheet.set_column("H:I", 18)
    worksheet.set_column("J:N", 13, number_format)
    worksheet.set_column("O:O", 15, number_format)
    worksheet.set_column("P:S", 16, money_format)
    worksheet.set_column("T:U", 14)
    worksheet.set_column("V:V", 18)
    worksheet.set_column("W:W", 30)
    worksheet.set_column("X:Y", 22, datetime_format)

    row_number = 1
    try:
        with inbound_register_module._connect() as connection:
            with connection.cursor(name="inbound_search_excel_cursor") as cursor:
                cursor.itersize = 2000
                cursor.execute(query, params)
                while rows := cursor.fetchmany(2000):
                    for row in rows:
                        worksheet.write_number(row_number, 0, row_number)
                        for column_index, value in enumerate(row, start=1):
                            if value is None:
                                continue
                            if isinstance(value, datetime):
                                excel_datetime = value.astimezone(ZoneInfo("Asia/Seoul")).replace(tzinfo=None) if value.tzinfo else value
                                worksheet.write_datetime(row_number, column_index, excel_datetime, datetime_format)
                            elif column_index == 1 and isinstance(value, date):
                                worksheet.write_datetime(row_number, column_index, value, date_format)
                            elif column_index in range(9, 19):
                                numeric_value = float(value)
                                format_for_value = number_format if column_index in range(9, 15) else money_format
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
