from datetime import date, datetime

import xlsxwriter

from services.process import ItemProcessRegister as process_register_module
from services.inventory.CurrentStock import user_name_sql

_CREATED_BY = f"{user_name_sql('h.created_by')} AS created_by"
_UPDATED_BY = f"{user_name_sql('h.updated_by')} AS updated_by"


def _conditions(
    companyid: str,
    date_from: date | None = None,
    date_to: date | None = None,
    processno: str = "",
    customer: str = "",
    warehouse: str = "",
    iteminfo: str = "",
    processmethod: str = "",
):
    clauses = ["h.companyid = %s"]
    params: list = [companyid]

    if date_from:
        clauses.append("h.processdate >= %s")
        params.append(date_from)
    if date_to:
        clauses.append("h.processdate <= %s")
        params.append(date_to)

    for column, value in (
        ("h.processno", processno),
        ("h.customname", customer),
        ("h.warehousecodename", warehouse),
    ):
        normalized = value.strip()
        if normalized:
            clauses.append(f"{column} ILIKE %s")
            params.append(f"%{normalized}%")

    if iteminfo.strip():
        pattern = f"%{iteminfo.strip()}%"
        clauses.append(
            "EXISTS (SELECT 1 FROM Process02t d WHERE d.companyid=h.companyid "
            "AND d.processno=h.processno AND d.linetype='PRODUCT' "
            "AND (d.itemcode ILIKE %s OR d.itemname ILIKE %s OR d.productname ILIKE %s))"
        )
        params.extend((pattern, pattern, pattern))

    if processmethod.strip():
        clauses.append(
            "EXISTS (SELECT 1 FROM Process02t d WHERE d.companyid=h.companyid "
            "AND d.processno=h.processno AND d.linetype='PRODUCT' AND d.processcodename ILIKE %s)"
        )
        params.append(f"%{processmethod.strip()}%")

    return " AND ".join(clauses), params


_TOTALS_LATERAL = """
    LEFT JOIN LATERAL (
        SELECT COUNT(*) FILTER (WHERE d.linetype='PRODUCT') AS detail_count,
               SUM(d.qty) FILTER (WHERE d.linetype='PRODUCT' AND d.is_leaf) AS qty,
               SUM(d.weight) FILTER (WHERE d.linetype='PRODUCT' AND d.is_leaf) AS weight,
               SUM(d.supplyamt) FILTER (WHERE d.linetype='PRODUCT' AND d.is_leaf) AS supplyamt,
               SUM(d.vat) FILTER (WHERE d.linetype='PRODUCT' AND d.is_leaf) AS vat,
               SUM(d.unitamt) FILTER (WHERE d.linetype='PRODUCT' AND d.is_leaf) AS unitamt
        FROM (
            SELECT line.linetype, line.qty, line.weight, line.supplyamt, line.vat, line.unitamt,
                   NOT EXISTS (
                       SELECT 1 FROM Process02t child
                       WHERE child.companyid=line.companyid AND child.processno=line.processno
                         AND child.parentlineno=line.lineno
                   ) AS is_leaf
            FROM Process02t line
            WHERE line.companyid=h.companyid AND line.processno=h.processno
        ) d
    ) totals ON TRUE
"""


def list_documents(
    companyid: str,
    page: int,
    page_size: int,
    date_from: date | None = None,
    date_to: date | None = None,
    processno: str = "",
    customer: str = "",
    warehouse: str = "",
    iteminfo: str = "",
    processmethod: str = "",
):
    where_sql, params = _conditions(
        companyid, date_from, date_to, processno, customer, warehouse, iteminfo, processmethod
    )
    with process_register_module._connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            f"""SELECT COUNT(*),
                       COALESCE(SUM(totals.detail_count), 0),
                       COALESCE(SUM(totals.qty), 0),
                       COALESCE(SUM(totals.weight), 0),
                       COALESCE(SUM(totals.supplyamt), 0),
                       COALESCE(SUM(totals.vat), 0),
                       COALESCE(SUM(totals.unitamt), 0)
                FROM Process01t h
                {_TOTALS_LATERAL}
                WHERE {where_sql}""",
            params,
        )
        process_count, detail_count, total_qty, total_weight, supplyamt, vat, unitamt = cursor.fetchone()

        cursor.execute(
            f"""SELECT h.processno, h.processdate, h.customname, h.warehousecodename,
                       COALESCE(totals.detail_count, 0) AS detail_count,
                       COALESCE(totals.qty, 0) AS qty,
                       COALESCE(totals.weight, 0) AS weight,
                       COALESCE(totals.supplyamt, 0) AS supplyamt,
                       COALESCE(totals.vat, 0) AS vat,
                       COALESCE(totals.unitamt, 0) AS unitamt,
                       h.manager, h.description, h.createdat, h.updatedat,
                       {_CREATED_BY}, {_UPDATED_BY}
                FROM Process01t h
                {_TOTALS_LATERAL}
                WHERE {where_sql}
                ORDER BY h.processdate DESC, h.processno DESC
                LIMIT %s OFFSET %s""",
            (*params, page_size, (page - 1) * page_size),
        )
        rows = [process_register_module._row_dict(cursor, row) for row in cursor.fetchall()]

    return {
        "items": rows,
        "total": process_count,
        "page": page,
        "page_size": page_size,
        "summary": {
            "process_count": process_count,
            "detail_count": detail_count,
            "total_qty": total_qty,
            "total_weight": total_weight,
            "supplyamt": supplyamt,
            "vat": vat,
            "total_amount": unitamt,
        },
    }


def write_documents_excel(
    companyid: str,
    output_path: str,
    date_from: date | None = None,
    date_to: date | None = None,
    processno: str = "",
    customer: str = "",
    warehouse: str = "",
    iteminfo: str = "",
    processmethod: str = "",
):
    where_sql, params = _conditions(
        companyid, date_from, date_to, processno, customer, warehouse, iteminfo, processmethod
    )
    headers = [
        "No.", "가공일자", "가공처", "창고", "상세건수", "수량", "중량(KG)",
        "공급가", "부가세", "합계금액", "가공전표", "담당자", "비고", "등록일자", "수정일자",
        "등록자", "수정자",
    ]
    query = f"""
        SELECT h.processdate, h.customname, h.warehousecodename,
               COALESCE(totals.detail_count, 0), COALESCE(totals.qty, 0),
               COALESCE(totals.weight, 0), COALESCE(totals.supplyamt, 0),
               COALESCE(totals.vat, 0), COALESCE(totals.unitamt, 0), h.processno,
               h.manager, h.description, h.createdat, h.updatedat,
               {_CREATED_BY}, {_UPDATED_BY}
        FROM Process01t h
        {_TOTALS_LATERAL}
        WHERE {where_sql}
        ORDER BY h.processdate DESC, h.processno DESC
    """

    workbook = xlsxwriter.Workbook(output_path, {"constant_memory": True})
    worksheet = workbook.add_worksheet("가공현황")
    header_format = workbook.add_format({
        "bold": True, "font_color": "#B4232D", "bg_color": "#FFF3F3",
        "border": 1, "border_color": "#E5BFC2", "valign": "vcenter",
    })
    date_format = workbook.add_format({"num_format": "yyyy-mm-dd"})
    datetime_format = workbook.add_format({"num_format": "yyyy-mm-dd hh:mm"})
    integer_format = workbook.add_format({"num_format": "#,##0;[Red]-#,##0;0"})
    number_format = workbook.add_format({"num_format": "#,##0.###"})
    money_format = workbook.add_format({"num_format": "#,##0.##"})
    worksheet.write_row(0, 0, headers, header_format)
    worksheet.freeze_panes(1, 0)
    worksheet.set_column("A:A", 8)
    worksheet.set_column("B:B", 13, date_format)
    worksheet.set_column("C:D", 22)
    worksheet.set_column("E:E", 12, integer_format)
    worksheet.set_column("F:G", 15, number_format)
    worksheet.set_column("H:J", 17, money_format)
    worksheet.set_column("K:K", 21)
    worksheet.set_column("L:L", 14)
    worksheet.set_column("M:M", 16)
    worksheet.set_column("N:N", 32)
    worksheet.set_column("N:O", 22, datetime_format)
    worksheet.set_column("P:Q", 14)

    row_number = 1
    try:
        with process_register_module._connect() as connection:
            with connection.cursor(name="item_process_search_excel_cursor") as cursor:
                cursor.itersize = 2000
                cursor.execute(query, params)
                while rows := cursor.fetchmany(2000):
                    for row in rows:
                        worksheet.write_number(row_number, 0, row_number, integer_format)
                        for column_index, value in enumerate(row, start=1):
                            if value is None:
                                continue
                            if column_index == 1 and isinstance(value, date):
                                worksheet.write_datetime(row_number, column_index, value, date_format)
                            elif column_index in (13, 14) and isinstance(value, datetime):
                                worksheet.write_datetime(row_number, column_index, value.replace(tzinfo=None), datetime_format)
                            elif column_index in (4, 5, 6, 7, 8, 9):
                                number_value = float(value)
                                number_cell_format = integer_format if number_value.is_integer() else (
                                    number_format if column_index in (4, 5, 6) else money_format
                                )
                                worksheet.write_number(row_number, column_index, number_value, number_cell_format)
                            else:
                                worksheet.write(row_number, column_index, value)
                        row_number += 1
        worksheet.autofilter(0, 0, max(0, row_number - 1), len(headers) - 1)
    finally:
        workbook.close()
    return row_number - 1
