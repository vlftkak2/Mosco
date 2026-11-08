from datetime import date

import xlsxwriter

from services.inoutmove import inoutmoveRegister as transfer_register_module
from services.inventory.CurrentStock import user_name_sql


def list_transfer_documents(
    companyid: str, page: int, page_size: int,
    date_from: date | None = None, date_to: date | None = None,
    receiptno: str = "", fromwarehouse: str = "", towarehouse: str = "",
    iteminfo: str = "", productinfo: str = "",
):
    where_sql, params = _search_conditions(
        companyid, date_from, date_to, receiptno, fromwarehouse,
        towarehouse, iteminfo, productinfo,
    )
    with transfer_register_module._connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            f"""SELECT COUNT(DISTINCT h.receiptno)
                FROM inoutmove01t h
                JOIN inoutmove02t d
                  ON d.companyid = h.companyid AND d.receiptno = h.receiptno
                WHERE {where_sql}""",
            params,
        )
        total = cursor.fetchone()[0]
        cursor.execute(
            f"""SELECT h.receiptno, h.receptdate,
                       h.fromwarehousecode, h.fromwarehousename,
                       h.towarehousecode, h.towarehousename,
                       h.manager, h.description, h.subulyn,
                       h.created_at, h.updated_at,
                       {user_name_sql('h.created_by')} AS created_by,
                       {user_name_sql('h.updated_by')} AS updated_by,
                       COUNT(d.lineno)::integer AS line_count,
                       COALESCE(SUM(d.qty), 0)::numeric(15, 3) AS total_qty,
                       STRING_AGG(DISTINCT NULLIF(d.qtyunit, ''), ', ') AS qtyunit,
                       COALESCE(SUM(d.weight), 0)::numeric(15, 3) AS total_weight
                FROM inoutmove01t h
                JOIN inoutmove02t d
                  ON d.companyid = h.companyid AND d.receiptno = h.receiptno
                WHERE {where_sql}
                GROUP BY h.companyid, h.receiptno
                ORDER BY h.receptdate DESC, h.receiptno DESC
                LIMIT %s OFFSET %s""",
            (*params, page_size, (page - 1) * page_size),
        )
        items = [transfer_register_module._row_dict(cursor, row) for row in cursor.fetchall()]
    return {"items": items, "total": total, "page": page, "page_size": page_size}


def get_transfer_document(companyid: str, receiptno: str):
    return transfer_register_module.get_transfer(companyid, receiptno)


def _search_conditions(
    companyid: str,
    date_from: date | None = None,
    date_to: date | None = None,
    receiptno: str = "",
    fromwarehouse: str = "",
    towarehouse: str = "",
    iteminfo: str = "",
    productinfo: str = "",
):
    where = ["h.companyid = %s"]
    params: list = [companyid]

    if date_from:
        where.append("h.receptdate >= %s")
        params.append(date_from)
    if date_to:
        where.append("h.receptdate <= %s")
        params.append(date_to)
    if receiptno.strip():
        where.append("h.receiptno ILIKE %s")
        params.append(f"%{receiptno.strip()}%")
    if fromwarehouse.strip():
        pattern = f"%{fromwarehouse.strip()}%"
        where.append("(h.fromwarehousecode ILIKE %s OR h.fromwarehousename ILIKE %s)")
        params.extend((pattern, pattern))
    if towarehouse.strip():
        pattern = f"%{towarehouse.strip()}%"
        where.append("(h.towarehousecode ILIKE %s OR h.towarehousename ILIKE %s)")
        params.extend((pattern, pattern))
    if iteminfo.strip():
        pattern = f"%{iteminfo.strip()}%"
        where.append("(d.itemcode ILIKE %s OR d.itemname ILIKE %s)")
        params.extend((pattern, pattern))
    if productinfo.strip():
        where.append("d.productname ILIKE %s")
        params.append(f"%{productinfo.strip()}%")

    return " AND ".join(where), params


_DETAIL_SELECT = f"""
    SELECT h.receptdate, h.receiptno,
           h.fromwarehousecode, h.fromwarehousename,
           h.towarehousecode, h.towarehousename,
           d.lineno, d.stocksourcetype, d.stocksourceno, d.stocksourceline,
           d.itemcode, d.itemname, d.productname,
           d.materialname, d.surfacename, d.myrtle,
           d.thickness, d.width, d.length, d.qty,
           COALESCE(NULLIF(BTRIM(qty_code.code_name), ''), d.qtyunit) AS qtyunit,
           d.weight, source_stock.customname AS customname,
           source_stock.receiptdate AS stock_receiptdate,
           h.manager, h.description,
           d.created_at, COALESCE(d.updated_at, h.updated_at) AS updated_at,
           {user_name_sql('COALESCE(d.created_by, h.created_by)')} AS created_by,
           {user_name_sql('COALESCE(d.updated_by, h.updated_by)')} AS updated_by
    FROM inoutmove01t AS h
    JOIN inoutmove02t AS d
      ON d.companyid = h.companyid
     AND d.receiptno = h.receiptno
    LEFT JOIN CurrentStock01t AS source_stock
      ON source_stock.companyid = d.companyid
     AND source_stock.sourcetype = d.stocksourcetype
     AND source_stock.sourceno = d.stocksourceno
     AND source_stock.sourceline = d.stocksourceline
    LEFT JOIN CodeMaster01t AS qty_code
      ON qty_code.companyid = d.companyid
     AND qty_code.groupcode = 'QTY'
     AND qty_code.code = d.qtyunit
"""


def list_transfer_details(
    companyid: str,
    page: int,
    page_size: int,
    date_from: date | None = None,
    date_to: date | None = None,
    receiptno: str = "",
    fromwarehouse: str = "",
    towarehouse: str = "",
    iteminfo: str = "",
    productinfo: str = "",
):
    where_sql, params = _search_conditions(
        companyid, date_from, date_to, receiptno, fromwarehouse,
        towarehouse, iteminfo, productinfo,
    )
    with transfer_register_module._connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            f"""SELECT COUNT(DISTINCT h.receiptno), COUNT(d.lineno),
                       COALESCE(SUM(d.qty), 0), COALESCE(SUM(d.weight), 0)
                FROM inoutmove01t AS h
                JOIN inoutmove02t AS d
                  ON d.companyid = h.companyid AND d.receiptno = h.receiptno
                WHERE {where_sql}""",
            params,
        )
        receipt_count, detail_count, total_qty, total_weight = cursor.fetchone()

        cursor.execute(
            f"""{_DETAIL_SELECT}
                WHERE {where_sql}
                ORDER BY h.receptdate DESC, h.receiptno DESC, d.lineno
                LIMIT %s OFFSET %s""",
            (*params, page_size, (page - 1) * page_size),
        )
        items = [transfer_register_module._row_dict(cursor, row) for row in cursor.fetchall()]

    return {
        "items": items,
        "total": detail_count,
        "page": page,
        "page_size": page_size,
        "summary": {
            "receipt_count": receipt_count,
            "detail_count": detail_count,
            "total_qty": total_qty,
            "total_weight": total_weight,
        },
    }


def write_transfer_details_excel(
    companyid: str,
    output_path: str,
    date_from: date | None = None,
    date_to: date | None = None,
    receiptno: str = "",
    fromwarehouse: str = "",
    towarehouse: str = "",
    iteminfo: str = "",
    productinfo: str = "",
):
    where_sql, params = _search_conditions(
        companyid, date_from, date_to, receiptno, fromwarehouse,
        towarehouse, iteminfo, productinfo,
    )
    headers = [
        "No.", "재고이전일자", "재고이전전표", "출고창고", "입고창고", "상세순번",
        "품목코드", "품명", "제품번호", "강종", "표면", "도금량(g/㎡)",
        "두께", "폭", "길이", "이전수량", "수량단위", "이전중량(KG)",
        "매입처", "재고입고일자", "재고구분", "원천전표", "원천순번",
        "담당자", "비고", "상세 등록일자", "상세 수정일자", "등록자", "수정자",
    ]
    query = f"""{_DETAIL_SELECT}
        WHERE {where_sql}
        ORDER BY h.receptdate DESC, h.receiptno DESC, d.lineno"""

    workbook = xlsxwriter.Workbook(output_path, {"constant_memory": True})
    worksheet = workbook.add_worksheet("재고이전현황")
    # Same header style as the other search exports (입고/출고현황, 현재고, 재고수불).
    header_format = workbook.add_format({
        "bold": True, "font_color": "#B4232D", "bg_color": "#FFF3F3",
        "border": 1, "border_color": "#E5BFC2", "valign": "vcenter",
    })
    date_format = workbook.add_format({"num_format": "yyyy-mm-dd"})
    datetime_format = workbook.add_format({"num_format": "yyyy-mm-dd hh:mm"})
    number_format = workbook.add_format({"num_format": "#,##0.###"})
    worksheet.write_row(0, 0, headers, header_format)
    worksheet.freeze_panes(1, 0)
    worksheet.set_column("A:A", 8)
    worksheet.set_column("B:C", 17)
    worksheet.set_column("D:E", 18)
    worksheet.set_column("F:F", 10)
    worksheet.set_column("G:I", 22)
    worksheet.set_column("J:K", 16)
    worksheet.set_column("L:R", 15, number_format)
    worksheet.set_column("S:S", 22)
    worksheet.set_column("T:T", 16, date_format)
    worksheet.set_column("U:W", 18)
    worksheet.set_column("X:Y", 22)
    worksheet.set_column("Z:AA", 22, datetime_format)
    worksheet.set_column("AB:AC", 14)
    # columns: A No. … Z/AA 상세 등록/수정일자, AB/AC 등록자/수정자

    row_number = 1
    try:
        with transfer_register_module._connect() as connection:
            with connection.cursor(name="inoutmove_search_excel_cursor") as cursor:
                cursor.itersize = 2000
                cursor.execute(query, params)
                while rows := cursor.fetchmany(2000):
                    for row in rows:
                        values = list(row)
                        # The displayed quantity unit is resolved from the tenant code table.
                        source_type = values[7]
                        source_type_name = {"OPENING": "기초", "INBOUND": "입고", "PROCESS": "가공"}.get(source_type, source_type or "")
                        # One value per header after "No." (출고/입고창고 show the warehouse names).
                        ordered = [
                            values[0], values[1], values[3], values[5], values[6],
                            values[10], values[11], values[12], values[13], values[14], values[15],
                            values[16], values[17], values[18], values[19], values[20], values[21],
                            values[22], values[23], source_type_name, values[8], values[9],
                            values[24], values[25], values[26], values[27], values[28], values[29],
                        ]
                        worksheet.write_number(row_number, 0, row_number)
                        for column_index, value in enumerate(ordered, start=1):
                            if value is None:
                                continue
                            if column_index in (1, 19) and isinstance(value, date):
                                worksheet.write_datetime(row_number, column_index, value, date_format)
                            elif column_index in (25, 26) and hasattr(value, "tzinfo"):
                                worksheet.write_datetime(row_number, column_index, value.replace(tzinfo=None), datetime_format)
                            elif column_index in (11, 12, 13, 14, 15, 17):
                                worksheet.write_number(row_number, column_index, float(value), number_format)
                            else:
                                worksheet.write(row_number, column_index, value)
                        row_number += 1
        worksheet.autofilter(0, 0, max(0, row_number - 1), len(headers) - 1)
    finally:
        workbook.close()
    return row_number - 1
