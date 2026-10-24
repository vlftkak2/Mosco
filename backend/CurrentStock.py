import logging
from contextlib import contextmanager
from datetime import date, datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from psycopg2.pool import ThreadedConnectionPool
from psycopg2.extras import execute_values
from pydantic import BaseModel, Field, field_validator
import xlsxwriter

from config import DB_CONFIG

logger = logging.getLogger(__name__)

_CONNECTION_POOL = ThreadedConnectionPool(
    minconn=1,
    maxconn=15,
    host=DB_CONFIG["host"],
    port=DB_CONFIG["port"],
    dbname=DB_CONFIG["database"],
    user=DB_CONFIG["user"],
    password=DB_CONFIG["password"],
    connect_timeout=5,
)


@contextmanager
def _connect():
    connection = _CONNECTION_POOL.getconn()
    try:
        with connection:
            yield connection
    except Exception:
        _CONNECTION_POOL.putconn(connection, close=True)
        connection = None
        raise
    finally:
        if connection is not None:
            _CONNECTION_POOL.putconn(connection)


def _row_dict(cursor, row):
    return dict(zip((column[0] for column in cursor.description), row))


class StockLookupItem(BaseModel):
    itemcode: str = Field(min_length=1, max_length=100)
    thickness: Decimal | None = Field(default=None, ge=0, max_digits=15, decimal_places=3)
    width: Decimal | None = Field(default=None, ge=0, max_digits=15, decimal_places=3)
    length: Decimal | None = Field(default=None, ge=0, max_digits=15, decimal_places=3)
    warehousecode: str = Field(min_length=1, max_length=50)
    qtyunit: str = Field(min_length=1, max_length=20)

    @field_validator("itemcode", "warehousecode", "qtyunit")
    @classmethod
    def strip_text(cls, value: str) -> str:
        return value.strip()

    @field_validator("thickness", "width", "length", mode="before")
    @classmethod
    def blank_dimension_to_none(cls, value):
        return None if value is None or not str(value).strip() else value


class StockLookupRequest(BaseModel):
    items: list[StockLookupItem] = Field(min_length=1, max_length=10000)


def _stock_key(line: dict):
    return (
        str(line.get("itemcode") or "").strip(),
        Decimal(str(line.get("thickness") or 0)),
        Decimal(str(line.get("width") or 0)),
        Decimal(str(line.get("length") or 0)),
        str(line.get("warehousecode") or "").strip(),
        str(line.get("qtyunit") or "").strip(),
    )


def _normalized_movement(line: dict):
    itemcode, thickness, width, length, warehousecode, qtyunit = _stock_key(line)
    itemname = str(line.get("itemname") or "").strip()
    warehouse_name = str(line.get("warehousecodename") or "").strip()
    qty = line.get("qty")
    weight = line.get("weight")
    if not itemcode or not itemname or not warehousecode or not warehouse_name or not qtyunit:
        raise ValueError("재고 반영에 필요한 품목·창고·수량단위 정보가 없습니다.")
    if qty is None or Decimal(str(qty)) <= 0:
        raise ValueError(f"재고 반영 수량은 0보다 커야 합니다: {itemcode}")
    if weight is None or Decimal(str(weight)) < 0:
        raise ValueError(f"재고 반영 중량은 0 이상이어야 합니다: {itemcode}")
    return {
        "itemcode": itemcode,
        "itemname": itemname,
        "thickness": thickness,
        "width": width,
        "length": length,
        "qty": Decimal(str(qty)),
        "qtyunit": qtyunit,
        "weight": Decimal(str(weight)),
        "warehousecode": warehousecode,
        "warehousecodename": warehouse_name,
    }


def next_opening_receiptno(cursor, companyid: str) -> str:
    date_token = datetime.now(ZoneInfo("Asia/Seoul")).strftime("%Y%m%d")
    prefix = f"ST{date_token}"
    suffix_start = len(prefix) + 1
    cursor.execute(
        """SELECT COALESCE(MAX(substring(receiptno FROM %s)::integer), 0)
           FROM Iniop01t
           WHERE companyid = %s AND iniotype = 'ST'
             AND LEFT(receiptno, %s) = %s
             AND substring(receiptno FROM %s) ~ '^[0-9]{4}$'""",
        (suffix_start, companyid, len(prefix), prefix, suffix_start),
    )
    return f"{prefix}{cursor.fetchone()[0] + 1:04d}"


def _uses_source_lines(cursor) -> bool:
    cursor.execute(
        """SELECT EXISTS (
               SELECT 1 FROM pg_attribute
               WHERE attrelid = 'currentstock01t'::regclass
                 AND attname = 'sourcetype' AND NOT attisdropped
           )"""
    )
    return cursor.fetchone()[0]


def _insert_source_stock(cursor, companyid, companyname, source_type, source_no, source_line,
                         receipt_date, customcode, customname, movement, line):
    if source_type not in {"OPENING", "INBOUND"}:
        raise ValueError("현재고 원천구분을 확인해 주세요.")
    if not source_no or source_line <= 0:
        raise ValueError("현재고 원천전표와 상세 순번을 확인해 주세요.")
    cursor.execute(
        """INSERT INTO CurrentStock01t
               (companyid, companyname, customcode, customname, sourcetype, sourceno, sourceline,
                receiptdate, itemcode, itemname, productname, materialcode, materialname,
                surfacecode, surfacename, myrtle, manager, thickness, width, length, originalqty, qty, qtyunit,
                originalweight, weight, unit, unitprice, warehousecode, warehousecodename)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
           ON CONFLICT (companyid, sourcetype, sourceno, sourceline) DO NOTHING""",
        (companyid, companyname, customcode or None, customname or None,
         source_type, source_no, source_line, receipt_date,
         movement["itemcode"], movement["itemname"],
         (line.get("productname") or "").strip() or None,
         (line.get("materialcode") or "").strip(), (line.get("materialname") or "").strip(),
         (line.get("surfacecode") or "").strip() or None,
         (line.get("surfacename") or "").strip() or None,
         line.get("myrtle"), (line.get("manager") or "").strip() or None,
         movement["thickness"], movement["width"], movement["length"],
         movement["qty"], movement["qty"], movement["qtyunit"],
         movement["weight"], movement["weight"], line.get("unit") or None,
         line.get("unitprice"), movement["warehousecode"], movement["warehousecodename"]),
    )
    if cursor.rowcount != 1:
        raise ValueError(f"이미 현재고에 반영된 원천 라인입니다: {source_type} / {source_no} / {source_line}")


def _delete_source_stock(cursor, companyid, source_type, source_no, source_line):
    cursor.execute(
        """DELETE FROM CurrentStock01t
           WHERE companyid = %s AND sourcetype = %s AND sourceno = %s AND sourceline = %s
             AND qty = originalqty AND weight = originalweight""",
        (companyid, source_type, source_no, source_line),
    )
    if cursor.rowcount != 1:
        raise ValueError(f"출고 이력이 있거나 현재고 원천 라인이 없습니다: {source_type} / {source_no} / {source_line}")


def _single_source_key(cursor, companyid, movement):
    cursor.execute(
        """SELECT sourcetype, sourceno, sourceline
           FROM CurrentStock01t
           WHERE companyid = %s AND itemcode = %s AND COALESCE(thickness, 0) = %s
             AND COALESCE(width, 0) = %s AND COALESCE(length, 0) = %s
             AND warehousecode = %s AND qtyunit = %s
           ORDER BY receiptdate, sourcetype, sourceno, sourceline
           LIMIT 2 FOR UPDATE""",
        (companyid, movement["itemcode"], movement["thickness"], movement["width"], movement["length"],
         movement["warehousecode"], movement["qtyunit"]),
    )
    keys = cursor.fetchall()
    if len(keys) != 1:
        raise ValueError("출고 원천 재고 라인을 특정할 수 없습니다. 원천 라인 선택 연동이 필요합니다.")
    return keys[0]


def _change_single_source_stock(cursor, companyid, movement, reverse=False, source_key=None):
    source_key = source_key or movement.get("stock_source_key")
    source_type, source_no, source_line = source_key or _single_source_key(cursor, companyid, movement)
    if reverse:
        cursor.execute(
            """UPDATE CurrentStock01t SET qty = qty + %s, weight = weight + %s,
                      updated_at = CURRENT_TIMESTAMP
               WHERE companyid = %s AND sourcetype = %s AND sourceno = %s AND sourceline = %s
                 AND qty + %s <= originalqty AND weight + %s <= originalweight""",
            (movement["qty"], movement["weight"], companyid, source_type, source_no, source_line,
             movement["qty"], movement["weight"]),
        )
    else:
        cursor.execute(
            """UPDATE CurrentStock01t SET qty = qty - %s, weight = weight - %s,
                      updated_at = CURRENT_TIMESTAMP
               WHERE companyid = %s AND sourcetype = %s AND sourceno = %s AND sourceline = %s
                 AND qty >= %s AND weight >= %s""",
            (movement["qty"], movement["weight"], companyid, source_type, source_no, source_line,
             movement["qty"], movement["weight"]),
        )
    if cursor.rowcount != 1:
        raise ValueError("선택된 원천 재고 라인의 잔량 또는 복원 가능 수량을 확인해 주세요.")


def record_document(
    cursor,
    companyid: str,
    companyname: str,
    iniodate: date,
    iniotype: str,
    receiptno: str,
    lines: list[dict],
    customcode: str = "",
    customname: str = "",
):
    if iniotype not in {"ST", "IN", "OUT"}:
        raise ValueError("지원하지 않는 수불 유형입니다.")
    movements = [_normalized_movement(line) for line in lines]
    if not _uses_source_lines(cursor):
        raise ValueError("현재고 테이블에 원천 라인 구조가 적용되지 않았습니다.")
    for line_no, movement in enumerate(movements, start=1):
        line = lines[line_no - 1]
        source_lineno = int(line.get("lineno") or line_no)
        movement_date = line.get("receptdate") or iniodate
        movement_customcode = line.get("customcode") or customcode
        movement_customname = line.get("customname") or customname
        source_key = None
        metadata = line
        if iniotype == "OUT":
            source_key = (
                line.get("stocksourcetype"),
                line.get("stocksourceno"),
                int(line.get("stocksourceline") or 0),
            )
            if not all(source_key) or source_key[2] <= 0:
                raise ValueError("출고할 현재고 원천 구분·전표·순번이 필요합니다.")
            cursor.execute(
                """SELECT productname, materialcode, materialname, surfacecode, surfacename, myrtle, manager
                   FROM CurrentStock01t
                   WHERE companyid = %s AND sourcetype = %s AND sourceno = %s AND sourceline = %s
                   FOR UPDATE""",
                (companyid, *source_key),
            )
            source_row = cursor.fetchone()
            if not source_row:
                raise ValueError("선택한 원천 재고 행을 현재 회사에서 찾을 수 없습니다.")
            source_metadata = _row_dict(cursor, source_row)
            metadata = {**line, **source_metadata}
        cursor.execute(
            """INSERT INTO Iniop01t
                   (companyid, companyname, iniodate, iniotype, receiptno, lineno, customcode, customname,
                    itemcode, itemname, productname, materialcode, materialname, surfacecode, surfacename,
                    myrtle, manager, thickness, width, length, qty, qtyunit, weight,
                    warehousecode, warehousecodename)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (
                companyid, companyname, movement_date, iniotype, receiptno, source_lineno, movement_customcode, movement_customname or None,
                movement["itemcode"], movement["itemname"],
                (metadata.get("productname") or "").strip() or None,
                (metadata.get("materialcode") or "").strip(), (metadata.get("materialname") or "").strip(),
                (metadata.get("surfacecode") or "").strip() or None,
                (metadata.get("surfacename") or "").strip() or None,
                metadata.get("myrtle"), (metadata.get("manager") or "").strip() or None,
                movement["thickness"], movement["width"], movement["length"], movement["qty"],
                movement["qtyunit"], movement["weight"], movement["warehousecode"],
                movement["warehousecodename"],
            ),
        )
        if iniotype == "OUT":
            _change_single_source_stock(cursor, companyid, movement, source_key=source_key)
        else:
            _insert_source_stock(
                cursor, companyid, companyname, "OPENING" if iniotype == "ST" else "INBOUND",
                receiptno, source_lineno, movement_date, movement_customcode, movement_customname,
                movement, line,
            )
    return len(movements)


def reverse_document(cursor, companyid: str, iniotype: str, receiptno: str):
    cursor.execute(
        """SELECT companyname, lineno, itemcode, itemname, thickness, width, length, qty, qtyunit, weight,
                  warehousecode, warehousecodename
           FROM Iniop01t
           WHERE companyid = %s AND iniotype = %s AND receiptno = %s
           ORDER BY lineno
           FOR UPDATE""",
        (companyid, iniotype, receiptno),
    )
    columns = [column[0] for column in cursor.description]
    movements = [dict(zip(columns, row)) for row in cursor.fetchall()]
    if not movements:
        raise ValueError("삭제할 수불장 내역을 찾을 수 없습니다. 현재고와 수불장을 확인해 주세요.")
    if not _uses_source_lines(cursor):
        raise ValueError("현재고 테이블에 원천 라인 구조가 적용되지 않았습니다.")
    for movement in movements:
        if iniotype == "OUT":
            cursor.execute(
                """SELECT stocksourcetype, stocksourceno, stocksourceline
                   FROM Outbound02t
                   WHERE companyid = %s AND receiptno = %s AND lineno = %s
                   FOR UPDATE""",
                (companyid, receiptno, movement["lineno"]),
            )
            source_key = cursor.fetchone()
            if not source_key or not all(source_key) or int(source_key[2]) <= 0:
                raise ValueError("출고 상세에서 원천 재고 연결 정보를 찾을 수 없습니다.")
            _change_single_source_stock(cursor, companyid, movement, reverse=True, source_key=source_key)
        else:
            _delete_source_stock(
                cursor, companyid, "OPENING" if iniotype == "ST" else "INBOUND",
                receiptno, movement["lineno"],
            )
    cursor.execute(
        "DELETE FROM Iniop01t WHERE companyid = %s AND iniotype = %s AND receiptno = %s",
        (companyid, iniotype, receiptno),
    )
    return len(movements)


def reverse_all_opening_stock(cursor, companyid: str):
    cursor.execute(
        "SELECT DISTINCT receiptno FROM Iniop01t WHERE companyid = %s AND iniotype = 'ST' ORDER BY receiptno",
        (companyid,),
    )
    receipt_numbers = [row[0] for row in cursor.fetchall()]
    total = 0
    for receiptno in receipt_numbers:
        total += reverse_document(cursor, companyid, "ST", receiptno)
    return total


def lookup_stock(companyid: str, items: list[dict]):
    requested = []
    for index, item in enumerate(items):
        itemcode, thickness, width, length, warehousecode, qtyunit = _stock_key(item)
        requested.append((index, companyid, itemcode, thickness, width, length, warehousecode, qtyunit))
    with _connect() as connection, connection.cursor() as cursor:
        execute_values(
            cursor,
            """SELECT requested.request_no, requested.itemcode, requested.thickness,
                      requested.width, requested.length, requested.warehousecode, requested.qtyunit,
                      COALESCE(stock.qty, 0), COALESCE(stock.weight, 0)
               FROM (VALUES %s) AS requested(request_no, companyid, itemcode, thickness, width, length, warehousecode, qtyunit)
               LEFT JOIN LATERAL (
                   SELECT SUM(qty) AS qty, SUM(weight) AS weight
                   FROM CurrentStock01t
                   WHERE companyid = requested.companyid
                     AND itemcode = requested.itemcode
                     AND COALESCE(thickness, 0) = requested.thickness
                     AND COALESCE(width, 0) = requested.width
                     AND COALESCE(length, 0) = requested.length
                     AND warehousecode = requested.warehousecode
                     AND qtyunit = requested.qtyunit
               ) stock ON TRUE
               ORDER BY requested.request_no""",
            requested,
            template="(%s, %s, %s, %s, %s, %s, %s, %s)",
            page_size=1000,
            fetch=False,
        )
        rows = cursor.fetchall()
    return [{
        "itemcode": row[1], "thickness": row[2], "width": row[3], "length": row[4],
        "warehousecode": row[5], "qtyunit": row[6], "current_qty": row[7], "current_weight": row[8],
    } for row in rows]


def _current_stock_conditions(companyid, itemcode, itemname, thickness, width, length,
                              warehousecode, warehousecodename, sourcetype="", customname="",
                              include_zero=False, source_lines=False, item_search="",
                              warehouse_search="", date_from=None, date_to=None):
    where = ["stock.companyid = %s"]
    params = [companyid]
    if source_lines:
        if not include_zero:
            where.append("(stock.qty > 0 OR stock.weight > 0)")
        if sourcetype.strip():
            where.append("stock.sourcetype = %s")
            params.append(sourcetype.strip().upper())
        if customname.strip():
            where.append("stock.customname ILIKE %s")
            params.append(f"%{customname.strip()}%")
        if date_from:
            where.append("stock.receiptdate >= %s")
            params.append(date_from)
        if date_to:
            where.append("stock.receiptdate <= %s")
            params.append(date_to)
    elif date_from or date_to:
        # The legacy aggregate table has no source receipt date to filter by.
        where.append("FALSE")
    if item_search.strip():
        where.append("(stock.itemcode ILIKE %s OR stock.itemname ILIKE %s)")
        params.extend([f"%{item_search.strip()}%", f"%{item_search.strip()}%"])
    if warehouse_search.strip():
        where.append("(stock.warehousecode ILIKE %s OR stock.warehousecodename ILIKE %s)")
        params.extend([f"%{warehouse_search.strip()}%", f"%{warehouse_search.strip()}%"])
    for column, value in (
        ("itemcode", itemcode), ("itemname", itemname),
        ("warehousecode", warehousecode), ("warehousecodename", warehousecodename),
    ):
        normalized = value.strip()
        if normalized:
            where.append(f"stock.{column} ILIKE %s")
            params.append(f"%{normalized}%")
    for column, value in (("thickness", thickness), ("width", width), ("length", length)):
        normalized = str(value or "").strip()
        if normalized:
            where.append(f"CAST(stock.{column} AS TEXT) ILIKE %s")
            params.append(f"%{normalized}%")
    return " AND ".join(where), params


def _current_stock_select(source_lines: bool):
    source_fields = (
        "stock.sourcetype, stock.sourceno, stock.sourceline, stock.receiptdate, "
        "stock.customcode, stock.customname, stock.originalqty, stock.originalweight, "
        "stock.unit, stock.unitprice"
        if source_lines else
        "NULL::text AS sourcetype, NULL::text AS sourceno, NULL::integer AS sourceline, "
        "NULL::date AS receiptdate, NULL::text AS customcode, NULL::text AS customname, "
        "stock.qty AS originalqty, stock.weight AS originalweight, "
        "NULL::text AS unit, NULL::numeric AS unitprice"
    )
    return (
        f"{source_fields}, stock.itemcode, stock.itemname, stock.productname, stock.materialcode, "
        "stock.materialname, stock.surfacecode, stock.surfacename, stock.myrtle, stock.manager, "
        "stock.thickness, stock.width, "
        "stock.length, stock.qty, COALESCE(qty_code.code_name, stock.qtyunit) AS qtyunit, "
        "stock.weight, stock.warehousecode, stock.warehousecodename, "
        "stock.created_at, stock.updated_at"
    )


def list_current_stock(companyid: str, page: int, page_size: int, **filters):
    with _connect() as connection, connection.cursor() as cursor:
        source_lines = _uses_source_lines(cursor)
        where, params = _current_stock_conditions(companyid, source_lines=source_lines, **filters)
        cursor.execute(f"SELECT COUNT(*) FROM CurrentStock01t AS stock WHERE {where}", params)
        total = cursor.fetchone()[0]
        cursor.execute(
            f"""SELECT {_current_stock_select(source_lines)}
                FROM CurrentStock01t AS stock
                LEFT JOIN CodeMaster01t AS qty_code
                  ON qty_code.companyid = stock.companyid
                 AND qty_code.groupcode = 'QTY'
                 AND qty_code.code = stock.qtyunit
                WHERE {where}
                ORDER BY {('stock.receiptdate DESC, stock.sourcetype, stock.sourceno, stock.sourceline' if source_lines else 'stock.itemcode, stock.thickness, stock.width, stock.length, stock.warehousecode, stock.qtyunit')}
                LIMIT %s OFFSET %s""",
            (*params, page_size, (page - 1) * page_size),
        )
        items = [_row_dict(cursor, row) for row in cursor.fetchall()]
    return {"items": items, "total": total, "page": page, "page_size": page_size}


def write_current_stock_excel(companyid: str, output_path: str, **filters):
    with _connect() as connection, connection.cursor() as cursor:
        source_lines = _uses_source_lines(cursor)
    where, params = _current_stock_conditions(companyid, source_lines=source_lines, **filters)
    query = f"""SELECT {_current_stock_select(source_lines)}
                FROM CurrentStock01t AS stock
                LEFT JOIN CodeMaster01t AS qty_code
                  ON qty_code.companyid = stock.companyid
                 AND qty_code.groupcode = 'QTY'
                 AND qty_code.code = stock.qtyunit
                WHERE {where}
                ORDER BY {('stock.receiptdate DESC, stock.sourcetype, stock.sourceno, stock.sourceline' if source_lines else 'stock.itemcode, stock.thickness, stock.width, stock.length, stock.warehousecode, stock.qtyunit')}"""
    headers = ["No.", "재고구분", "원천전표", "원천순번", "입고일자", "거래처코드", "거래처명",
               "최초수량", "최초중량", "단가기준", "매입단가", "품목코드", "품목명", "Lot번호",
               "강판코드", "강판", "표면코드", "표면", "도금량(g/㎡)", "담당자", "두께", "폭", "길이",
               "현재수량", "수량단위", "현재중량", "창고코드", "창고명", "등록일자", "수정일자"]
    workbook = xlsxwriter.Workbook(output_path, {"constant_memory": True})
    worksheet = workbook.add_worksheet("현재고")
    header_format = workbook.add_format({"bold": True, "font_color": "#B4232D", "bg_color": "#FFF3F3", "border": 1, "border_color": "#E5BFC2"})
    integer_format = workbook.add_format({"num_format": "#,##0;[Red]-#,##0;0"})
    number_format = workbook.add_format({"num_format": "#,##0.###"})
    date_format = workbook.add_format({"num_format": "yyyy-mm-dd"})
    datetime_format = workbook.add_format({"num_format": "yyyy-mm-dd hh:mm"})
    worksheet.write_row(0, 0, headers, header_format)
    worksheet.freeze_panes(1, 0)
    worksheet.set_column("A:A", 8)
    worksheet.set_column("B:W", 16)
    worksheet.set_column("C:C", 26)
    worksheet.set_column("G:G", 24)
    worksheet.set_column("L:M", 20)
    worksheet.set_column("V:W", 20, datetime_format)
    row_no = 1
    try:
        with _connect() as connection, connection.cursor(name="current_stock_excel_cursor") as cursor:
            cursor.itersize = 2000
            cursor.execute(query, params)
            while rows := cursor.fetchmany(2000):
                for row in rows:
                    worksheet.write_number(row_no, 0, row_no)
                    for index, value in enumerate(row, start=1):
                        if value is None:
                            continue
                        if index in (3, 7, 8, 10, 18, 20, 21, 22, 23, 25):
                            numeric_value = float(value)
                            if numeric_value.is_integer():
                                worksheet.write_number(row_no, index, int(numeric_value), integer_format)
                            else:
                                worksheet.write_number(row_no, index, numeric_value, number_format)
                        elif index in (28, 29):
                            worksheet.write_datetime(row_no, index, value.replace(tzinfo=None), datetime_format)
                        elif index == 4:
                            worksheet.write_datetime(row_no, index, value, date_format)
                        else:
                            worksheet.write(row_no, index, value)
                    row_no += 1
    finally:
        workbook.close()
    return row_no - 1
