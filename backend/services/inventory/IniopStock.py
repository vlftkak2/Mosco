from datetime import date

import xlsxwriter

from services.inventory import CurrentStock as current_stock_module

# 등록자/수정자 이름: 행마다 하위 조회하지 않고 user01t 를 한 번 조인한다 (email 은 전역 유일).
_USER_JOINS = """
                LEFT JOIN user01t AS created_user ON created_user.email = i.created_by
                LEFT JOIN user01t AS updated_user ON updated_user.email = i.updated_by"""
_CREATED_BY = "COALESCE(created_user.username, i.created_by) AS created_by"
_UPDATED_BY = "COALESCE(updated_user.username, i.updated_by) AS updated_by"
_ORDER_BY = "i.iniodate ASC, i.receiptno ASC, i.lineno ASC, i.iniotype ASC"
# 수불 상세구분 (Iniop01t.iniokind, 저장할 때 기록): 가공·창고이동도 수불유형은 IN/OUT 이라 따로 둔다.
#   ST 기초 / IN 매입입고 / OUT 매출출고 / PROCESS_OUT 가공투입 / PROCESS_IN 가공입고 / MOVE_OUT 이동출고 / MOVE_IN 이동입고
KIND_NAMES = {"ST": "기초", "IN": "매입입고", "OUT": "매출출고", "PROCESS_OUT": "가공투입",
              "PROCESS_IN": "가공입고", "MOVE_OUT": "이동출고", "MOVE_IN": "이동입고"}
IN_MEMORY_EXCEL_ROWS = 30000  # 이 행 수까지는 엑셀을 메모리에서 만든다 (그 이상은 constant_memory)


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
    thickness: str,
    width: str,
    length: str,
    warehousecode: str,
    warehousecodename: str,
    item_search: str = "",
    product_search: str = "",
    warehouse_search: str = "",
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
        kind = iniotype.strip().upper()
        # 상세구분 값이면 iniokind 로(인덱스 companyid, iniokind, iniodate), 그 밖의 값은 기본 유형으로 거른다
        if kind in KIND_NAMES:
            where.append("i.iniokind = %s")
        else:
            where.append("i.iniotype = %s")
        params.append(kind)
    for column, value in (
        ("receiptno", receiptno), ("customcode", customcode), ("customname", customname),
        ("itemcode", itemcode), ("itemname", itemname),
        ("warehousecode", warehousecode),
        ("warehousecodename", warehousecodename),
    ):
        normalized = value.strip()
        if normalized:
            where.append(f"i.{column} ILIKE %s")
            params.append(f"%{normalized}%")
    if item_search.strip():
        pattern = f"%{item_search.strip()}%"
        where.append("(i.itemcode ILIKE %s OR i.itemname ILIKE %s OR i.productname ILIKE %s)")
        params.extend((pattern, pattern, pattern))
    if product_search.strip():
        where.append("i.productname ILIKE %s")
        params.append(f"%{product_search.strip()}%")
    if warehouse_search.strip():
        pattern = f"%{warehouse_search.strip()}%"
        where.append("(i.warehousecode ILIKE %s OR i.warehousecodename ILIKE %s)")
        params.extend((pattern, pattern))
    for column, value in (("thickness", thickness), ("width", width), ("length", length)):
        normalized = str(value or "").strip()
        if normalized:
            where.append(f"CAST(i.{column} AS TEXT) ILIKE %s")
            params.append(f"%{normalized}%")
    return " AND ".join(where), params


def list_iniop_stock(companyid: str, page: int, page_size: int, **filters):
    where, params = _conditions(companyid, **filters)
    with current_stock_module._connect() as connection, connection.cursor() as cursor:
        cursor.execute(f"SELECT COUNT(*) FROM Iniop01t AS i WHERE {where}", params)
        total = cursor.fetchone()[0]
        # 1) 정렬 인덱스(companyid, iniodate, receiptno, lineno INCLUDE iniotype)만으로 페이지 키를 고르고
        # 2) 고른 50행에만 코드명·사용자명을 붙인다. 뒤 페이지도 건너뛴 행마다 조인·조회를 하지 않는다.
        cursor.execute(
            f"""WITH page_keys AS (
                    SELECT i.companyid, i.iniotype, i.receiptno, i.lineno
                    FROM Iniop01t AS i
                    WHERE {where}
                    ORDER BY {_ORDER_BY}
                    LIMIT %s OFFSET %s
                )
                SELECT i.iniodate, i.iniotype, i.receiptno, i.customcode, i.customname, i.lineno, i.itemcode, i.itemname,
                       i.productname, i.materialcode, i.materialname, i.surfacecode, i.surfacename, i.myrtle, i.manager,
                       i.thickness, i.width, i.length,
                       i.qty, COALESCE(qty_code.code_name, i.qtyunit) AS qtyunit, i.weight,
                       COALESCE(price_code.code_name, i.unit) AS unit, i.unitprice, i.supplyamt, i.vat, i.unitamt,
                       CASE WHEN i.weight > 0 THEN ROUND(i.costamt / i.weight, 2) END AS costprice, i.costamt,
                       i.warehousecode, i.warehousecodename,
                       i.created_at, i.updated_at,
                       {_CREATED_BY}, {_UPDATED_BY}, i.iniokind
                FROM page_keys AS k
                JOIN Iniop01t AS i
                  ON i.companyid = k.companyid AND i.iniotype = k.iniotype
                 AND i.receiptno = k.receiptno AND i.lineno = k.lineno
                LEFT JOIN CodeMaster01t AS qty_code
                  ON qty_code.companyid = i.companyid
                 AND qty_code.groupcode = 'QTY'
                 AND qty_code.code = i.qtyunit
                LEFT JOIN CodeMaster01t AS price_code
                  ON price_code.companyid = i.companyid
                 AND price_code.groupcode = 'PRICE_UNIT'
                 AND price_code.code = i.unit{_USER_JOINS}
                ORDER BY {_ORDER_BY}""",
            (*params, page_size, (page - 1) * page_size),
        )
        items = [current_stock_module._row_dict(cursor, row) for row in cursor.fetchall()]
    return {"items": items, "total": total, "page": page, "page_size": page_size}


def write_iniop_stock_excel(companyid: str, output_path: str, **filters):
    where, params = _conditions(companyid, **filters)
    query = f"""SELECT i.iniodate, i.iniotype, i.receiptno, i.customcode, i.customname, i.lineno, i.itemcode, i.itemname,
                       i.productname, i.materialcode, i.materialname, i.surfacecode, i.surfacename, i.myrtle, i.manager,
                       i.thickness, i.width, i.length,
                       i.qty, COALESCE(qty_code.code_name, i.qtyunit) AS qtyunit, i.weight, i.warehousecode, i.warehousecodename,
                       i.created_at, i.updated_at,
                       {_CREATED_BY}, {_UPDATED_BY}, CASE WHEN i.weight > 0 THEN ROUND(i.costamt / i.weight, 2) END AS costprice, i.costamt, i.iniokind
                FROM Iniop01t AS i
                LEFT JOIN CodeMaster01t AS qty_code
                  ON qty_code.companyid = i.companyid
                 AND qty_code.groupcode = 'QTY'
                 AND qty_code.code = i.qtyunit{_USER_JOINS}
                WHERE {where}
                ORDER BY {_ORDER_BY}"""
    headers = [
        "No.", "수불일자", "수불유형", "수불전표", "거래처코드", "거래처명", "라인", "품목코드", "품목명",
        "제품번호", "강판코드", "강판", "표면코드", "표면", "도금량(g/㎡)", "담당자",
        "두께", "폭", "길이", "수량", "수량단위", "중량", "창고코드", "창고명", "등록일자", "수정일자",
        "등록자", "수정자", "원가단가(원/kg)", "원가금액",
    ]
    # 작은 파일(약 한 달치)은 메모리에서 바로 써서 2~3배 빠르게, 큰 파일은 행마다 임시파일로 흘려 메모리를 아낀다.
    with current_stock_module._connect() as connection, connection.cursor() as cursor:
        cursor.execute(f"SELECT COUNT(*) FROM Iniop01t AS i WHERE {where}", params)
        row_count = cursor.fetchone()[0]
    workbook = xlsxwriter.Workbook(
        output_path, {"in_memory": True} if row_count <= IN_MEMORY_EXCEL_ROWS else {"constant_memory": True},
    )
    worksheet = workbook.add_worksheet("재고수불현황")
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
    worksheet.set_column("J:O", 18)
    worksheet.set_column("P:P", 14, number_format)
    worksheet.set_column("Q:Q", 16)
    worksheet.set_column("R:T", 12, number_format)
    worksheet.set_column("U:U", 14, integer_format)
    worksheet.set_column("V:V", 14, number_format)
    worksheet.set_column("W:X", 18)
    worksheet.set_column("Y:Z", 22, datetime_format)
    worksheet.set_column("AA:AB", 14)
    worksheet.set_column("AC:AD", 15, number_format)
    row_no = 1
    try:
        with current_stock_module._connect() as connection, connection.cursor(name="iniop_stock_excel_cursor") as cursor:
            cursor.itersize = 2000
            cursor.execute(query, params)
            while rows := cursor.fetchmany(2000):
                for row in rows:
                    worksheet.write_number(row_no, 0, row_no)
                    # 수불유형 칸에는 상세구분(매입입고·가공입고·이동출고 …)을 쓴다
                    row = (*row[:1], KIND_NAMES.get(row[-1], row[1]), *row[2:-1])
                    for index, value in enumerate(row, start=1):
                        if value is None:
                            continue
                        if index == 1:
                            worksheet.write_datetime(row_no, index, value, date_format)
                        elif index in (14, 16, 17, 18, 19, 21):
                            numeric_value = float(value)
                            if numeric_value.is_integer():
                                worksheet.write_number(row_no, index, int(numeric_value), integer_format)
                            else:
                                worksheet.write_number(row_no, index, numeric_value, number_format)
                        elif index in (28, 29):
                            worksheet.write_number(row_no, index, float(value), number_format)
                        elif index in (24, 25):
                            worksheet.write_datetime(row_no, index, value.replace(tzinfo=None), datetime_format)
                        else:
                            worksheet.write(row_no, index, value)
                    row_no += 1
    finally:
        workbook.close()
    return row_no - 1
