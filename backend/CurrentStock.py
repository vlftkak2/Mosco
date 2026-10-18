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
    size: str = Field(default="", max_length=100)
    warehousecode: str = Field(min_length=1, max_length=50)
    qtyunit: str = Field(min_length=1, max_length=20)

    @field_validator("itemcode", "size", "warehousecode", "qtyunit")
    @classmethod
    def strip_text(cls, value: str) -> str:
        return value.strip()


class StockLookupRequest(BaseModel):
    items: list[StockLookupItem] = Field(min_length=1, max_length=10000)


def _stock_key(line: dict):
    return (
        str(line.get("itemcode") or "").strip(),
        str(line.get("size") or "").strip(),
        str(line.get("warehousecode") or "").strip(),
        str(line.get("qtyunit") or "").strip(),
    )


def _normalized_movement(line: dict):
    itemcode, size, warehousecode, qtyunit = _stock_key(line)
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
        "size": size,
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


def _increase_stock(cursor, companyid: str, companyname: str, movement: dict):
    cursor.execute(
        """INSERT INTO CurrentStock01t
               (companyid, companyname, itemcode, itemname, size, qty, qtyunit,
                weight, warehousecode, warehousecodename)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
           ON CONFLICT (companyid, itemcode, size, warehousecode, qtyunit)
           DO UPDATE SET
               companyname = EXCLUDED.companyname,
               itemname = EXCLUDED.itemname,
               warehousecodename = EXCLUDED.warehousecodename,
               qty = CurrentStock01t.qty + EXCLUDED.qty,
               weight = CurrentStock01t.weight + EXCLUDED.weight,
               updated_at = CURRENT_TIMESTAMP""",
        (
            companyid, companyname, movement["itemcode"], movement["itemname"], movement["size"],
            movement["qty"], movement["qtyunit"], movement["weight"],
            movement["warehousecode"], movement["warehousecodename"],
        ),
    )


def _decrease_stock(cursor, companyid: str, movement: dict):
    cursor.execute(
        """UPDATE CurrentStock01t
           SET qty = qty - %s,
               weight = GREATEST(weight - %s, 0),
               updated_at = CURRENT_TIMESTAMP
           WHERE companyid = %s AND itemcode = %s AND size = %s
             AND warehousecode = %s AND qtyunit = %s AND qty >= %s
           RETURNING qty""",
        (
            movement["qty"], movement["weight"], companyid, movement["itemcode"], movement["size"],
            movement["warehousecode"], movement["qtyunit"], movement["qty"],
        ),
    )
    result = cursor.fetchone()
    if result is None:
        cursor.execute(
            """SELECT qty FROM CurrentStock01t
               WHERE companyid = %s AND itemcode = %s AND size = %s
                 AND warehousecode = %s AND qtyunit = %s""",
            (companyid, movement["itemcode"], movement["size"], movement["warehousecode"], movement["qtyunit"]),
        )
        row = cursor.fetchone()
        current_qty = row[0] if row else Decimal("0")
        raise ValueError(
            f"현재고 수량이 부족합니다: {movement['itemcode']} / {movement['warehousecode']} "
            f"(현재 {current_qty} {movement['qtyunit']}, 요청 {movement['qty']} {movement['qtyunit']})"
        )


def record_document(
    cursor,
    companyid: str,
    companyname: str,
    iniodate: date,
    iniotype: str,
    receiptno: str,
    lines: list[dict],
):
    if iniotype not in {"ST", "IN", "OUT"}:
        raise ValueError("지원하지 않는 수불 유형입니다.")
    movements = [_normalized_movement(line) for line in lines]
    for line_no, movement in enumerate(movements, start=1):
        source_lineno = int(lines[line_no - 1].get("lineno") or line_no)
        cursor.execute(
            """INSERT INTO Iniop01t
                   (companyid, companyname, iniodate, iniotype, receiptno, lineno,
                    itemcode, itemname, size, qty, qtyunit, weight,
                    warehousecode, warehousecodename)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (
                companyid, companyname, iniodate, iniotype, receiptno, source_lineno,
                movement["itemcode"], movement["itemname"], movement["size"], movement["qty"],
                movement["qtyunit"], movement["weight"], movement["warehousecode"],
                movement["warehousecodename"],
            ),
        )
        if iniotype == "OUT":
            _decrease_stock(cursor, companyid, movement)
        else:
            _increase_stock(cursor, companyid, companyname, movement)
    return len(movements)


def reverse_document(cursor, companyid: str, iniotype: str, receiptno: str):
    cursor.execute(
        """SELECT companyname, itemcode, itemname, size, qty, qtyunit, weight,
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
    for movement in movements:
        if iniotype == "OUT":
            _increase_stock(cursor, companyid, movement["companyname"], movement)
        else:
            _decrease_stock(cursor, companyid, movement)
    cursor.execute(
        "DELETE FROM Iniop01t WHERE companyid = %s AND iniotype = %s AND receiptno = %s",
        (companyid, iniotype, receiptno),
    )
    cursor.execute(
        "DELETE FROM CurrentStock01t WHERE companyid = %s AND qty = 0 AND weight = 0",
        (companyid,),
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
        itemcode, size, warehousecode, qtyunit = _stock_key(item)
        requested.append((index, companyid, itemcode, size, warehousecode, qtyunit))
    with _connect() as connection, connection.cursor() as cursor:
        execute_values(
            cursor,
            """SELECT requested.request_no, requested.itemcode, requested.size,
                      requested.warehousecode, requested.qtyunit,
                      COALESCE(stock.qty, 0), COALESCE(stock.weight, 0)
               FROM (VALUES %s) AS requested(request_no, companyid, itemcode, size, warehousecode, qtyunit)
               LEFT JOIN CurrentStock01t stock
                 ON stock.companyid = requested.companyid
                AND stock.itemcode = requested.itemcode
                AND stock.size = requested.size
                AND stock.warehousecode = requested.warehousecode
                AND stock.qtyunit = requested.qtyunit
               ORDER BY requested.request_no""",
            requested,
            template="(%s, %s, %s, %s, %s, %s)",
            page_size=1000,
            fetch=False,
        )
        rows = cursor.fetchall()
    return [{
        "itemcode": row[1], "size": row[2], "warehousecode": row[3], "qtyunit": row[4],
        "current_qty": row[5], "current_weight": row[6],
    } for row in rows]


def _current_stock_conditions(companyid, itemcode, itemname, size, warehousecode, warehousecodename, qtyunit):
    where = ["companyid = %s"]
    params = [companyid]
    for column, value in (
        ("itemcode", itemcode), ("itemname", itemname), ("size", size),
        ("warehousecode", warehousecode), ("warehousecodename", warehousecodename), ("qtyunit", qtyunit),
    ):
        normalized = value.strip()
        if normalized:
            where.append(f"{column} ILIKE %s")
            params.append(f"%{normalized}%")
    return " AND ".join(where), params


def list_current_stock(companyid: str, page: int, page_size: int, **filters):
    where, params = _current_stock_conditions(companyid, **filters)
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(f"SELECT COUNT(*) FROM CurrentStock01t WHERE {where}", params)
        total = cursor.fetchone()[0]
        cursor.execute(
            f"""SELECT itemcode, itemname, size, qty, qtyunit, weight,
                       warehousecode, warehousecodename, created_at, updated_at
                FROM CurrentStock01t WHERE {where}
                ORDER BY itemcode, size, warehousecode, qtyunit
                LIMIT %s OFFSET %s""",
            (*params, page_size, (page - 1) * page_size),
        )
        items = [_row_dict(cursor, row) for row in cursor.fetchall()]
    return {"items": items, "total": total, "page": page, "page_size": page_size}


def write_current_stock_excel(companyid: str, output_path: str, **filters):
    where, params = _current_stock_conditions(companyid, **filters)
    query = f"""SELECT itemcode, itemname, size, qty, qtyunit, weight,
                       warehousecode, warehousecodename, created_at, updated_at
                FROM CurrentStock01t WHERE {where}
                ORDER BY itemcode, size, warehousecode, qtyunit"""
    headers = ["No.", "품목코드", "품목명", "규격", "현재수량", "수량단위", "현재중량", "창고코드", "창고명", "등록일자", "수정일자"]
    workbook = xlsxwriter.Workbook(output_path, {"constant_memory": True})
    worksheet = workbook.add_worksheet("현재고")
    header_format = workbook.add_format({"bold": True, "font_color": "#B4232D", "bg_color": "#FFF3F3", "border": 1, "border_color": "#E5BFC2"})
    number_format = workbook.add_format({"num_format": "#,##0.###"})
    datetime_format = workbook.add_format({"num_format": "yyyymmdd hh:mm"})
    worksheet.write_row(0, 0, headers, header_format)
    worksheet.freeze_panes(1, 0)
    worksheet.set_column("A:A", 8)
    worksheet.set_column("B:C", 20)
    worksheet.set_column("D:D", 16)
    worksheet.set_column("E:E", 14, number_format)
    worksheet.set_column("F:F", 12)
    worksheet.set_column("G:G", 14, number_format)
    worksheet.set_column("H:I", 18)
    worksheet.set_column("J:K", 20, datetime_format)
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
                        if index in (4, 6):
                            worksheet.write_number(row_no, index, float(value), number_format)
                        elif index in (9, 10):
                            worksheet.write_datetime(row_no, index, value.replace(tzinfo=None), datetime_format)
                        else:
                            worksheet.write(row_no, index, value)
                    row_no += 1
    finally:
        workbook.close()
    return row_no - 1
