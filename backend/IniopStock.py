from datetime import date

import xlsxwriter

import CurrentStock as current_stock_module


def _conditions(
    companyid: str,
    date_from: date | None,
    date_to: date | None,
    iniotype: str,
    receiptno: str,
    itemcode: str,
    itemname: str,
    size: str,
    warehousecode: str,
    warehousecodename: str,
    qtyunit: str,
):
    where = ["companyid = %s"]
    params: list = [companyid]
    if date_from:
        where.append("iniodate >= %s")
        params.append(date_from)
    if date_to:
        where.append("iniodate <= %s")
        params.append(date_to)
    if iniotype.strip():
        where.append("iniotype = %s")
        params.append(iniotype.strip().upper())
    for column, value in (
        ("receiptno", receiptno), ("itemcode", itemcode), ("itemname", itemname),
        ("size", size), ("warehousecode", warehousecode),
        ("warehousecodename", warehousecodename), ("qtyunit", qtyunit),
    ):
        normalized = value.strip()
        if normalized:
            where.append(f"{column} ILIKE %s")
            params.append(f"%{normalized}%")
    return " AND ".join(where), params


def list_iniop_stock(companyid: str, page: int, page_size: int, **filters):
    where, params = _conditions(companyid, **filters)
    with current_stock_module._connect() as connection, connection.cursor() as cursor:
        cursor.execute(f"SELECT COUNT(*) FROM Iniop01t WHERE {where}", params)
        total = cursor.fetchone()[0]
        cursor.execute(
            f"""SELECT iniodate, iniotype, receiptno, lineno, itemcode, itemname, size,
                       qty, qtyunit, weight, warehousecode, warehousecodename,
                       created_at, updated_at
                FROM Iniop01t WHERE {where}
                ORDER BY iniodate DESC, receiptno DESC, lineno
                LIMIT %s OFFSET %s""",
            (*params, page_size, (page - 1) * page_size),
        )
        items = [current_stock_module._row_dict(cursor, row) for row in cursor.fetchall()]
    return {"items": items, "total": total, "page": page, "page_size": page_size}


def write_iniop_stock_excel(companyid: str, output_path: str, **filters):
    where, params = _conditions(companyid, **filters)
    query = f"""SELECT iniodate, iniotype, receiptno, lineno, itemcode, itemname, size,
                       qty, qtyunit, weight, warehousecode, warehousecodename,
                       created_at, updated_at
                FROM Iniop01t WHERE {where}
                ORDER BY iniodate DESC, receiptno DESC, lineno"""
    headers = [
        "No.", "수불일자", "수불유형", "수불전표", "라인", "품목코드", "품목명", "규격",
        "수량", "수량단위", "중량", "창고코드", "창고명", "등록일자", "수정일자",
    ]
    workbook = xlsxwriter.Workbook(output_path, {"constant_memory": True})
    worksheet = workbook.add_worksheet("수불장")
    header_format = workbook.add_format({"bold": True, "font_color": "#B4232D", "bg_color": "#FFF3F3", "border": 1, "border_color": "#E5BFC2"})
    date_format = workbook.add_format({"num_format": "yyyy-mm-dd"})
    number_format = workbook.add_format({"num_format": "#,##0.###"})
    datetime_format = workbook.add_format({"num_format": "yyyymmdd hh:mm"})
    worksheet.write_row(0, 0, headers, header_format)
    worksheet.freeze_panes(1, 0)
    worksheet.set_column("A:A", 8)
    worksheet.set_column("B:B", 13, date_format)
    worksheet.set_column("C:C", 11)
    worksheet.set_column("D:D", 22)
    worksheet.set_column("E:E", 9)
    worksheet.set_column("F:G", 20)
    worksheet.set_column("H:H", 16)
    worksheet.set_column("I:I", 14, number_format)
    worksheet.set_column("J:J", 12)
    worksheet.set_column("K:K", 14, number_format)
    worksheet.set_column("L:M", 18)
    worksheet.set_column("N:O", 20, datetime_format)
    row_no = 1
    try:
        with current_stock_module._connect() as connection, connection.cursor(name="iniop_stock_excel_cursor") as cursor:
            cursor.itersize = 2000
            cursor.execute(query, params)
            while rows := cursor.fetchmany(2000):
                for row in rows:
                    worksheet.write_number(row_no, 0, row_no)
                    for index, value in enumerate(row, start=1):
                        if value is None:
                            continue
                        if index == 1:
                            worksheet.write_datetime(row_no, index, value, date_format)
                        elif index in (8, 10):
                            worksheet.write_number(row_no, index, float(value), number_format)
                        elif index in (13, 14):
                            worksheet.write_datetime(row_no, index, value.replace(tzinfo=None), datetime_format)
                        else:
                            worksheet.write(row_no, index, value)
                    row_no += 1
    finally:
        workbook.close()
    return row_no - 1
