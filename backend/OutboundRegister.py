import logging
from contextlib import contextmanager
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
from zoneinfo import ZoneInfo

from psycopg2 import IntegrityError
from psycopg2.pool import ThreadedConnectionPool
from pydantic import BaseModel, Field, field_validator, model_validator

from config import DB_CONFIG
import CurrentStock as current_stock_module

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


class OutboundDetailInput(BaseModel):
    stocksourcetype: str = Field(min_length=1, max_length=20)
    stocksourceno: str = Field(min_length=1, max_length=100)
    stocksourceline: int = Field(gt=0)
    qty: Decimal = Field(gt=0, max_digits=15, decimal_places=3)
    weight: Decimal = Field(gt=0, max_digits=15, decimal_places=3)
    unit: str = Field(min_length=1, max_length=20)
    unitprice: Decimal = Field(ge=0, max_digits=15, decimal_places=2)
    description: str = Field(default="", max_length=500)

    @field_validator("stocksourcetype", "stocksourceno", "unit", "description")
    @classmethod
    def strip_text(cls, value: str) -> str:
        return value.strip()

    @model_validator(mode="after")
    def require_source_fields(self):
        if self.stocksourcetype not in {"OPENING", "INBOUND"} or not self.stocksourceno:
            raise ValueError("출고 원천 재고 구분과 전표번호를 확인해 주세요.")
        return self


class OutboundSaveRequest(BaseModel):
    receiptno: str = Field(default="", max_length=100)
    receptdate: date
    customcode: str = Field(min_length=1, max_length=50)
    customname: str = Field(default="", max_length=100)
    description: str = Field(default="", max_length=500)
    is_new: bool = False
    items: list[OutboundDetailInput] = Field(min_length=1, max_length=10000)

    @field_validator("receiptno", "customcode", "customname", "description")
    @classmethod
    def strip_text(cls, value: str) -> str:
        return value.strip()

    @model_validator(mode="after")
    def require_header_fields(self):
        if not self.is_new and not self.receiptno:
            raise ValueError("수정할 출고전표번호가 없습니다.")
        if not self.customcode:
            raise ValueError("거래처코드는 필수입니다.")
        return self


def _row_dict(cursor, row):
    return dict(zip((column[0] for column in cursor.description), row))


def _calculate_unit_amount(weight: Decimal, unitprice: Decimal, unit_code: str, unit_name: str) -> Decimal:
    unit_token = f"{unit_code} {unit_name}".upper()
    priced_weight = weight / Decimal("1000") if "TON" in unit_token or "톤" in unit_token else weight
    return (priced_weight * unitprice).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def list_receipts(
    companyid: str,
    page: int,
    page_size: int,
    query: str = "",
    date_from: date | None = None,
    date_to: date | None = None,
    receiptno: str = "",
    customcode: str = "",
    customname: str = "",
    warehouse: str = "",
):
    search = query.strip()
    where = "h.companyid = %s"
    params: list = [companyid]
    for column, value in (
        ("h.receiptno", receiptno),
        ("h.customcode", customcode),
        ("h.customname", customname),
    ):
        if value.strip():
            where += f" AND {column} ILIKE %s"
            params.append(f"%{value.strip()}%")
    if date_from:
        where += " AND h.receptdate >= %s"
        params.append(date_from)
    if date_to:
        where += " AND h.receptdate <= %s"
        params.append(date_to)
    if warehouse.strip():
        where += " AND EXISTS (SELECT 1 FROM Outbound02t AS wd " \
                 "WHERE wd.companyid = h.companyid AND wd.receiptno = h.receiptno " \
                 "AND (wd.warehousecode ILIKE %s OR wd.warehousecodename ILIKE %s))"
        warehouse_pattern = f"%{warehouse.strip()}%"
        params.extend((warehouse_pattern, warehouse_pattern))
    if search:
        where += " AND (h.receiptno ILIKE %s OR h.customcode ILIKE %s OR h.customname ILIKE %s)"
        pattern = f"%{search}%"
        params.extend((pattern, pattern, pattern))

    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(f"SELECT COUNT(*) FROM Outbound01t AS h WHERE {where}", params)
        total = cursor.fetchone()[0]
        cursor.execute(
            f"""
            SELECT h.receiptno, h.receptdate, h.customcode, h.customname,
                   h.description, h.subulyn, h.created_at,
                   COUNT(d.lineno)::integer AS line_count,
                   STRING_AGG(DISTINCT NULLIF(d.warehousecode, ''), ', ') AS warehousecode,
                   STRING_AGG(DISTINCT NULLIF(d.warehousecodename, ''), ', ') AS warehousecodename,
                   COALESCE(SUM(d.qty), 0)::numeric(15, 3) AS total_qty,
                   COALESCE(SUM(d.weight), 0)::numeric(15, 3) AS total_weight,
                   COALESCE(SUM(d.supplyamt), 0)::numeric(15, 2) AS supply_amount,
                   COALESCE(SUM(d.vat), 0)::numeric(15, 2) AS vat_amount,
                   COALESCE(SUM(d.unitamt), 0)::numeric(15, 2) AS total_amount
            FROM Outbound01t AS h
            LEFT JOIN Outbound02t AS d
              ON d.companyid = h.companyid AND d.receiptno = h.receiptno
            WHERE {where}
            GROUP BY h.companyid, h.receiptno
            ORDER BY h.receptdate DESC, h.receiptno DESC
            LIMIT %s OFFSET %s
            """,
            (*params, page_size, (page - 1) * page_size),
        )
        receipts = [_row_dict(cursor, row) for row in cursor.fetchall()]
    return {"receipts": receipts, "total": total, "page": page, "page_size": page_size}


def get_receipt(companyid: str, receiptno: str):
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """SELECT companyid, companyname, receiptno, receptdate, customcode, customname,
                      description, COALESCE(subulyn, 'N') AS subulyn,
                      created_at, updated_at
               FROM Outbound01t WHERE companyid = %s AND receiptno = %s""",
            (companyid, receiptno),
        )
        header_row = cursor.fetchone()
        if not header_row:
            return None
        header = _row_dict(cursor, header_row)
        cursor.execute(
            """SELECT companyid, companyname, receiptno, lineno, stocksourcetype, stocksourceno, stocksourceline,
                      itemcode, itemname, productname, surfacecode, surfacename, materialcode, materialname,
                      myrtle, thickness, width, length, qty, qtyunit, warehousecode, warehousecodename,
                      weight, unit, unitprice, supplyamt, vat, unitamt, description, manager,
                      created_at, updated_at
               FROM Outbound02t
               WHERE companyid = %s AND receiptno = %s
               ORDER BY lineno""",
            (companyid, receiptno),
        )
        header["items"] = [_row_dict(cursor, row) for row in cursor.fetchall()]
    return header


def _next_receiptno(cursor, companyid: str) -> str:
    today = datetime.now(ZoneInfo("Asia/Seoul")).date()
    prefix = f"OUT{today:%Y%m%d}"
    cursor.execute(
        "SELECT pg_advisory_xact_lock(hashtext(%s)::bigint)",
        (f"outbound-sequence:{companyid}:{prefix}",),
    )
    suffix_start = len(prefix) + 1
    cursor.execute(
        """SELECT COALESCE(MAX(substring(receiptno FROM %s)::bigint), 0)
           FROM Outbound01t
           WHERE companyid = %s
             AND LEFT(receiptno, %s) = %s
             AND substring(receiptno FROM %s) ~ '^[0-9]{1,18}$'""",
        (suffix_start, companyid, len(prefix), prefix, suffix_start),
    )
    next_sequence = cursor.fetchone()[0] + 1
    return f"{prefix}{next_sequence:05d}"


def list_available_stock(
    companyid: str,
    page: int = 1,
    page_size: int = 50,
    item_search: str = "",
    warehouse_search: str = "",
    customname: str = "",
    date_from: date | None = None,
    date_to: date | None = None,
    sourcetype: str = "",
    receiptno: str = "",
):
    where = ["stock.companyid = %s"]
    params: list = [companyid]
    if item_search.strip():
        pattern = f"%{item_search.strip()}%"
        where.append("(stock.itemcode ILIKE %s OR stock.itemname ILIKE %s OR stock.productname ILIKE %s)")
        params.extend((pattern, pattern, pattern))
    if warehouse_search.strip():
        pattern = f"%{warehouse_search.strip()}%"
        where.append("(stock.warehousecode ILIKE %s OR stock.warehousecodename ILIKE %s)")
        params.extend((pattern, pattern))
    if customname.strip():
        where.append("stock.customname ILIKE %s")
        params.append(f"%{customname.strip()}%")
    if date_from:
        where.append("stock.receiptdate >= %s")
        params.append(date_from)
    if date_to:
        where.append("stock.receiptdate <= %s")
        params.append(date_to)
    if sourcetype.strip():
        where.append("stock.sourcetype = %s")
        params.append(sourcetype.strip().upper())
    where_sql = " AND ".join(where)
    own_receipt = receiptno.strip()

    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            f"""WITH own_allocation AS (
                    SELECT stocksourcetype, stocksourceno, stocksourceline,
                           SUM(qty) AS qty, SUM(weight) AS weight
                    FROM Outbound02t
                    WHERE companyid = %s AND receiptno = %s
                    GROUP BY stocksourcetype, stocksourceno, stocksourceline
                )
                SELECT COUNT(*)
                FROM CurrentStock01t AS stock
                LEFT JOIN own_allocation AS own
                  ON own.stocksourcetype = stock.sourcetype
                 AND own.stocksourceno = stock.sourceno
                 AND own.stocksourceline = stock.sourceline
                WHERE {where_sql}
                  AND (stock.qty + COALESCE(own.qty, 0) > 0
                       OR stock.weight + COALESCE(own.weight, 0) > 0)""",
            (companyid, own_receipt, *params),
        )
        total = cursor.fetchone()[0]
        cursor.execute(
            f"""WITH own_allocation AS (
                    SELECT stocksourcetype, stocksourceno, stocksourceline,
                           SUM(qty) AS qty, SUM(weight) AS weight
                    FROM Outbound02t
                    WHERE companyid = %s AND receiptno = %s
                    GROUP BY stocksourcetype, stocksourceno, stocksourceline
                )
                SELECT stock.sourcetype, stock.sourceno, stock.sourceline, stock.receiptdate,
                       stock.customcode, stock.customname, stock.itemcode, stock.itemname,
                       stock.productname, stock.materialcode, stock.materialname,
                       stock.surfacecode, stock.surfacename, stock.myrtle, stock.manager,
                       stock.thickness, stock.width, stock.length,
                       stock.qty + COALESCE(own.qty, 0) AS available_qty,
                       stock.qtyunit, COALESCE(qty_code.code_name, stock.qtyunit) AS qtyunit_name,
                       stock.weight + COALESCE(own.weight, 0) AS available_weight,
                       stock.unit, stock.unitprice, stock.warehousecode, stock.warehousecodename
                FROM CurrentStock01t AS stock
                LEFT JOIN own_allocation AS own
                  ON own.stocksourcetype = stock.sourcetype
                 AND own.stocksourceno = stock.sourceno
                 AND own.stocksourceline = stock.sourceline
                LEFT JOIN CodeMaster01t AS qty_code
                  ON qty_code.companyid = stock.companyid
                 AND qty_code.groupcode = 'QTY'
                 AND qty_code.code = stock.qtyunit
                WHERE {where_sql}
                  AND (stock.qty + COALESCE(own.qty, 0) > 0
                       OR stock.weight + COALESCE(own.weight, 0) > 0)
                ORDER BY stock.receiptdate, stock.sourcetype, stock.sourceno, stock.sourceline
                LIMIT %s OFFSET %s""",
            (companyid, own_receipt, *params, page_size, (page - 1) * page_size),
        )
        items = [_row_dict(cursor, row) for row in cursor.fetchall()]
    return {"items": items, "total": total, "page": page, "page_size": page_size}


def save_receipt(companyid: str, companyname: str, payload: dict):
    receiptno = (payload.get("receiptno") or "").strip()
    customcode = payload["customcode"].strip()
    items = payload["items"]
    try:
        with _connect() as connection, connection.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_xact_lock(hashtext(%s)::bigint)", (f"stand-stock:{companyid}",))
            cursor.execute(
                "SELECT customername FROM customer01t WHERE companyid = %s AND customercode = %s AND UPPER(BTRIM(useyn)) = 'Y' LIMIT 1",
                (companyid, customcode),
            )
            customer_row = cursor.fetchone()
            if not customer_row:
                raise ValueError(f"사용중 상태의 거래처가 아니거나 현재 회사에 등록되지 않은 거래처코드입니다: {customcode}")
            customer_name = customer_row[0] or ""
            supplied_customer_name = (payload.get("customname") or "").strip()
            if supplied_customer_name and supplied_customer_name != customer_name:
                raise ValueError(f"거래처코드 '{customcode}'와 거래처명이 일치하지 않습니다. 등록된 거래처명: {customer_name}")

            if payload.get("is_new"):
                receiptno = _next_receiptno(cursor, companyid)
            else:
                cursor.execute(
                    "SELECT pg_advisory_xact_lock(hashtext(%s)::bigint)",
                    (f"outbound:{companyid}:{receiptno}",),
                )

            cursor.execute(
                """SELECT groupcode, code, code_name FROM CodeMaster01t
                   WHERE companyid = %s AND groupcode = ANY(%s)
                     AND UPPER(BTRIM(use_yn)) = 'Y'""",
                (companyid, ["PRICE_UNIT"]),
            )
            price_unit_names = {}
            for groupcode, code, code_name in cursor.fetchall():
                price_unit_names[code] = code_name or ""
            unit_errors = [
                f"{index}행 판매 단가기준 미등록 또는 사용중지({item['unit'].strip()})"
                for index, item in enumerate(items, start=1)
                if item["unit"].strip() not in price_unit_names
            ]
            if unit_errors:
                raise ValueError("단가 기준을 확인해 주세요: " + " / ".join(unit_errors[:5]))

            cursor.execute(
                "SELECT COALESCE(subulyn, 'N') FROM Outbound01t WHERE companyid = %s AND receiptno = %s FOR UPDATE",
                (companyid, receiptno),
            )
            existing = cursor.fetchone()
            if existing and str(existing[0] or "N").strip().upper() in {"Y", "YES", "확정"}:
                raise ValueError("수불 확정된 출고전표는 수정할 수 없습니다.")
            if payload.get("is_new") and existing:
                raise ValueError(f"이미 등록된 출고전표번호입니다: {receiptno}")
            if not payload.get("is_new") and not existing:
                raise ValueError("수정할 출고전표가 없습니다. 목록을 새로고침해 주세요.")

            if existing:
                current_stock_module.reverse_document(cursor, companyid, "OUT", receiptno)
                cursor.execute(
                    """UPDATE Outbound01t
                       SET receptdate = %s, customcode = %s, customname = %s,
                           description = %s, updated_at = CURRENT_TIMESTAMP
                       WHERE companyid = %s AND receiptno = %s""",
                    (payload["receptdate"], customcode, customer_name,
                     payload.get("description") or None, companyid, receiptno),
                )
                cursor.execute(
                    "DELETE FROM Outbound02t WHERE companyid = %s AND receiptno = %s",
                    (companyid, receiptno),
                )
            else:
                cursor.execute(
                    """INSERT INTO Outbound01t
                       (companyid, companyname, receiptno, receptdate, customcode,
                        customname, description, subulyn)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, 'N')""",
                    (companyid, companyname, receiptno, payload["receptdate"], customcode,
                     customer_name, payload.get("description") or None),
                )

            source_cache = {}
            demands = {}
            for index, item in enumerate(items, start=1):
                source_key = (
                    item["stocksourcetype"].strip().upper(),
                    item["stocksourceno"].strip(),
                    int(item["stocksourceline"]),
                )
                if source_key[0] not in {"OPENING", "INBOUND"}:
                    raise ValueError(f"{index}행 원천 재고 구분이 올바르지 않습니다.")
                if source_key not in source_cache:
                    cursor.execute(
                        """SELECT sourcetype, sourceno, sourceline, receiptdate, customcode, customname,
                                  itemcode, itemname, productname, materialcode, materialname,
                                  surfacecode, surfacename, myrtle, manager, thickness, width, length,
                                  qty, qtyunit, weight, unit, unitprice, warehousecode, warehousecodename
                           FROM CurrentStock01t
                           WHERE companyid = %s AND sourcetype = %s AND sourceno = %s AND sourceline = %s
                           FOR UPDATE""",
                        (companyid, *source_key),
                    )
                    source_row = cursor.fetchone()
                    if not source_row:
                        raise ValueError(f"{index}행 선택한 원천 재고를 현재 회사에서 찾을 수 없습니다.")
                    source_cache[source_key] = _row_dict(cursor, source_row)
                stock = source_cache[source_key]
                demand = demands.setdefault(source_key, {"qty": Decimal("0"), "weight": Decimal("0"), "stock": stock})
                demand["qty"] += Decimal(str(item["qty"]))
                demand["weight"] += Decimal(str(item["weight"]))

            for source_key, demand in demands.items():
                stock = demand["stock"]
                if demand["qty"] > Decimal(str(stock["qty"])) or demand["weight"] > Decimal(str(stock["weight"])):
                    raise ValueError(
                        f"원천 재고 {source_key[1]}/{source_key[2]} 잔량을 초과했습니다. "
                        f"수량 {stock['qty']}, 중량 {stock['weight']} 안에서 출고해 주세요."
                    )

            detail_values = []
            stock_lines = []
            for line_no, item in enumerate(items, start=1):
                source_key = (item["stocksourcetype"].strip().upper(), item["stocksourceno"].strip(), int(item["stocksourceline"]))
                stock = source_cache[source_key]
                unit = item["unit"].strip()
                qty = Decimal(str(item["qty"]))
                weight = Decimal(str(item["weight"]))
                unitprice = Decimal(str(item["unitprice"]))
                supplyamt = _calculate_unit_amount(weight, unitprice, unit, price_unit_names[unit])
                vat = (supplyamt * Decimal("0.10")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                unitamt = supplyamt + vat
                detail_values.append((
                    companyid, companyname, receiptno, line_no, *source_key,
                    stock["itemcode"], stock["itemname"], stock["productname"],
                    stock["surfacecode"], stock["surfacename"], stock["materialcode"] or "",
                    stock["materialname"] or "", stock["myrtle"], stock["thickness"], stock["width"], stock["length"],
                    qty, stock["qtyunit"], weight, unit, unitprice, supplyamt, vat, unitamt,
                    stock["warehousecode"], stock["warehousecodename"], item.get("description", "").strip() or None,
                    stock["manager"],
                ))
                stock_lines.append({
                    "stocksourcetype": source_key[0], "stocksourceno": source_key[1], "stocksourceline": source_key[2],
                    "lineno": line_no, "itemcode": stock["itemcode"], "itemname": stock["itemname"],
                    "thickness": stock["thickness"], "width": stock["width"], "length": stock["length"],
                    "qty": qty, "qtyunit": stock["qtyunit"], "weight": weight,
                    "warehousecode": stock["warehousecode"], "warehousecodename": stock["warehousecodename"],
                })
            cursor.executemany(
                """INSERT INTO Outbound02t
                   (companyid, companyname, receiptno, lineno, stocksourcetype, stocksourceno, stocksourceline,
                    itemcode, itemname, productname, surfacecode, surfacename, materialcode, materialname, myrtle,
                    thickness, width, length, qty, qtyunit, weight, unit, unitprice, supplyamt, vat, unitamt,
                    warehousecode, warehousecodename, description, manager)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                           %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                detail_values,
            )
            current_stock_module.record_document(
                cursor, companyid, companyname, payload["receptdate"], "OUT", receiptno, stock_lines,
                customcode=customcode, customname=customer_name,
            )
        return {"receiptno": receiptno, "saved_count": len(items)}
    except ValueError:
        raise
    except IntegrityError as error:
        message = str(error).lower()
        if "outbound01t_pkey" in message or "duplicate key" in message:
            raise ValueError(f"이미 등록된 출고전표번호입니다: {receiptno}") from error
        raise
    except Exception:
        logger.exception("Failed to save outbound receipt")
        raise


def delete_receipt(companyid: str, receiptno: str):
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute("SELECT pg_advisory_xact_lock(hashtext(%s)::bigint)", (f"stand-stock:{companyid}",))
        cursor.execute(
            "SELECT COALESCE(subulyn, 'N') FROM Outbound01t WHERE companyid = %s AND receiptno = %s FOR UPDATE",
            (companyid, receiptno),
        )
        row = cursor.fetchone()
        if not row:
            return 0
        if str(row[0] or "N").strip().upper() in {"Y", "YES", "확정"}:
            raise ValueError("수불 확정된 출고전표는 삭제할 수 없습니다.")
        current_stock_module.reverse_document(cursor, companyid, "OUT", receiptno)
        cursor.execute("DELETE FROM Outbound02t WHERE companyid = %s AND receiptno = %s", (companyid, receiptno))
        cursor.execute("DELETE FROM Outbound01t WHERE companyid = %s AND receiptno = %s", (companyid, receiptno))
        return 1
