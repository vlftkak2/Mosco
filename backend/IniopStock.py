from datetime import date

import xlsxwriter

import CurrentStock as current_stock_module


def _conditions(
    companyid: str,
    date_from: date | None,
    date_to: date | None,
    iniotype: str,
    receiptno: str,
    customcode: str,
    customname: str,
    itemcode: str,
    itemname: str,
    size: str,
    warehousecode: str,
    warehousecodename: str,
):
    where = ["i.companyid = %s"]
    params: list = [companyid]
    if date_from:
        where.append("i.iniodate >= %s")
        params.append(date_from)
    if date_to:
        where.append("i.iniodate <= %s")
        params.append(date_to)
    if iniotype.strip():
        where.append("i.iniotype = %s")
        params.append(iniotype.strip().upper())
    for column, value in (
        ("receiptno", receiptno), ("customcode", customcode), ("customname", customname),
        ("itemcode", itemcode), ("itemname", itemname),
        ("size", size), ("warehousecode", warehousecode),
        ("warehousecodename", warehousecodename),
    ):
        normalized = value.strip()
        if normalized:
            where.append(f"i.{column} ILIKE %s")
            params.append(f"%{normalized}%")
    return " AND ".join(where), params


def list_iniop_stock(companyid: str, page: int, page_size: int, **filters):
    where, params = _conditions(companyid, **filters)
    with current_stock_module._connect() as connection, connection.cursor() as cursor:
        cursor.execute(f"SELECT COUNT(*) FROM Iniop01t AS i WHERE {where}", params)
        total = cursor.fetchone()[0]
        cursor.execute(
            f"""SELECT i.iniodate, i.iniotype, i.receiptno, i.customcode, i.customname, i.lineno, i.itemcode, i.itemname, i.size,
                       i.qty, COALESCE(qty_code.code_name, i.qtyunit) AS qtyunit, i.weight, i.warehousecode, i.warehousecodename,
                       i.created_at, i.updated_at
                FROM Iniop01t AS i
                LEFT JOIN CodeMaster01t AS qty_code
                  ON qty_code.companyid = i.companyid
                 AND qty_code.groupcode = 'QTY'
                 AND qty_code.code = i.qtyunit
                WHERE {where}
                ORDER BY i.iniodate ASC, i.receiptno ASC, i.lineno
                LIMIT %s OFFSET %s""",
            (*params, page_size, (page - 1) * page_size),
        )
        items = [current_stock_module._row_dict(cursor, row) for row in cursor.fetchall()]
    return {"items": items, "total": total, "page": page, "page_size": page_size}


def write_iniop_stock_excel(companyid: str, output_path: str, **filters):
    where, params = _conditions(companyid, **filters)
    query = f"""SELECT i.iniodate, i.iniotype, i.receiptno, i.customcode, i.customname, i.lineno, i.itemcode, i.itemname, i.size,
                       i.qty, COALESCE(qty_code.code_name, i.qtyunit) AS qtyunit, i.weight, i.warehousecode, i.warehousecodename,
                       i.created_at, i.updated_at
                FROM Iniop01t AS i
                LEFT JOIN CodeMaster01t AS qty_code
                  ON qty_code.companyid = i.companyid
                 AND qty_code.groupcode = 'QTY'
                 AND qty_code.code = i.qtyunit
                WHERE {where}
                ORDER BY i.iniodate ASC, i.receiptno ASC, i.lineno"""
    headers = [
        "No.", "수불일자", "수불유형", "수불전표", "거래처코드", "거래처명", "라인", "품목코드", "품목명", "규격",
        "수량", "수량단위", "중량", "창고코드", "창고명", "등록일자", "수정일자",
    ]
    workbook = xlsxwriter.Workbook(output_path, {"constant_memory": True})
    worksheet = workbook.add_worksheet("수불장")
    header_format = workbook.add_format({"bold": True, "font_color": "#B4232D", "bg_color": "#FFF3F3", "border": 1, "border_color": "#E5BFC2"})
    date_format = workbook.add_format({"num_format": "yyyy-mm-dd"})
    integer_format = workbook.add_format({"num_format": "#,##0;[Red]-#,##0;0"})
    number_format = workbook.add_format({"num_format": "#,##0.###"})
    datetime_format = workbook.add_format({"num_format": "yyyy-mm-dd hh:mm"})
    worksheet.write_row(0, 0, headers, header_format)
    worksheet.freeze_panes(1, 0)
    worksheet.set_column("A:A", 8)
    worksheet.set_column("B:B", 13, date_format)
    worksheet.set_column("C:C", 11)
    worksheet.set_column("D:D", 27)
    worksheet.set_column("E:E", 16)
    worksheet.set_column("F:F", 24)
    worksheet.set_column("G:G", 9)
    worksheet.set_column("H:I", 20)
    worksheet.set_column("J:J", 16)
    worksheet.set_column("K:K", 14, integer_format)
    worksheet.set_column("L:L", 12)
    worksheet.set_column("M:M", 14, integer_format)
    worksheet.set_column("N:O", 18)
    worksheet.set_column("P:Q", 22, datetime_format)
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
                        elif index in (10, 12):
                            numeric_value = float(value)
                            if numeric_value.is_integer():
                                worksheet.write_number(row_no, index, int(numeric_value), integer_format)
                            else:
                                worksheet.write_number(row_no, index, numeric_value, number_format)
                        elif index in (15, 16):
                            worksheet.write_datetime(row_no, index, value.replace(tzinfo=None), datetime_format)
                        else:
                            worksheet.write(row_no, index, value)
                    row_no += 1
    finally:
        workbook.close()
    return row_no - 1
