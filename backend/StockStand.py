import logging
from contextlib import contextmanager
from datetime import date
from decimal import Decimal, ROUND_HALF_UP

from psycopg2 import IntegrityError
from psycopg2.pool import ThreadedConnectionPool
from pydantic import BaseModel, Field, field_validator, model_validator

from config import DB_CONFIG
import CurrentStock as current_stock_module

logger = logging.getLogger(__name__)

_CONNECTION_POOL = ThreadedConnectionPool(
    minconn=1,
    maxconn=10,
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


class StandItemInput(BaseModel):
    itemcode: str = Field(min_length=1, max_length=100)
    itemname: str = Field(min_length=1, max_length=150)
    size: str = Field(default="", max_length=100)
    qty: Decimal = Field(gt=0, max_digits=15, decimal_places=3)
    qtyunit: str = Field(min_length=1, max_length=20)
    weight: Decimal = Field(gt=0, max_digits=15, decimal_places=3)
    warehousecode: str = Field(min_length=1, max_length=50)
    warehousecodename: str = Field(min_length=1, max_length=50)
    unit: str = Field(default="", max_length=20)
    unitprice: Decimal | None = Field(default=None, ge=0, max_digits=15, decimal_places=2)
    unitamt: Decimal | None = Field(default=None, ge=0, max_digits=15, decimal_places=2)
    description: str = Field(default="", max_length=500)

    @field_validator("itemcode", "itemname", "size", "qtyunit", "warehousecode", "warehousecodename", "unit", "description")
    @classmethod
    def strip_text(cls, value: str) -> str:
        return value.strip()

    @model_validator(mode="after")
    def require_base_fields(self):
        if not self.itemcode or not self.itemname or not self.qtyunit or not self.warehousecode or not self.warehousecodename:
            raise ValueError("품목, 수량단위, 창고는 필수 입력입니다.")
        return self


class StandSaveRequest(BaseModel):
    standdate: date
    items: list[StandItemInput] = Field(min_length=1, max_length=10000)


class StandPriceInput(BaseModel):
    lineno: int = Field(gt=0)
    unit: str = Field(default="", max_length=20)
    unitprice: Decimal | None = Field(default=None, ge=0, max_digits=15, decimal_places=2)
    unitamt: Decimal | None = Field(default=None, ge=0, max_digits=15, decimal_places=2)

    @field_validator("unit")
    @classmethod
    def strip_unit(cls, value: str) -> str:
        return value.strip()


class StandPriceSaveRequest(BaseModel):
    items: list[StandPriceInput] = Field(min_length=1, max_length=10000)


class StandItemResolveRequest(BaseModel):
    itemcodes: list[str] = Field(min_length=1, max_length=10000)

    @field_validator("itemcodes")
    @classmethod
    def clean_itemcodes(cls, values: list[str]) -> list[str]:
        return list(dict.fromkeys(value.strip() for value in values if value and value.strip()))


class StandDeleteRequest(BaseModel):
    delete_all: bool


def _dict_row(cursor, row):
    return dict(zip((column[0] for column in cursor.description), row))


def list_stand_items(
    companyid: str,
    standdate: date,
    query: str = "",
    after_lineno: int = 0,
    page_size: int = 500,
    include_metadata: bool = True,
    page_offset: int | None = None,
):
    where = ["s.companyid = %s", "s.standdate = %s"]
    params: list = [companyid, standdate]
    normalized_query = query.strip()
    if normalized_query:
        where.append("(s.itemcode ILIKE %s OR s.itemname ILIKE %s)")
        params.extend((f"%{normalized_query}%", f"%{normalized_query}%"))
    where_sql = " AND ".join(where)

    page_where_sql = f"{where_sql} AND s.lineno > %s" if page_offset is None else where_sql
    page_params = [*params, after_lineno] if page_offset is None else params
    sql = f"""
        WITH page_keys AS (
            SELECT s.companyid, s.standdate, s.lineno
            FROM StandStock01t s
            WHERE {page_where_sql}
            ORDER BY s.lineno
            LIMIT %s OFFSET %s
        )
        SELECT s.companyid, s.companyname, s.standdate, s.lineno, s.itemcode, s.itemname,
               s.size, s.qty, s.qtyunit, s.weight, s.warehousecode, s.warehousecodename,
               s.unit, s.unitprice, s.unitamt, s.description, s.created_at, s.updated_at,
               (
                   EXISTS (
                       SELECT 1 FROM Inbound01t h
                       JOIN Inbound02t d ON d.companyid = h.companyid AND d.receiptno = h.receiptno
                       WHERE h.companyid = s.companyid AND h.receptdate >= s.standdate
                         AND d.itemcode = s.itemcode AND COALESCE(d.warehousecode, '') = s.warehousecode
                   ) OR EXISTS (
                       SELECT 1 FROM Outbound01t h
                       JOIN Outbound02t d ON d.companyid = h.companyid AND d.receiptno = h.receiptno
                       WHERE h.companyid = s.companyid AND h.receptdate >= s.standdate
                         AND d.itemcode = s.itemcode AND COALESCE(d.warehousecode, '') = s.warehousecode
                   )
               ) AS has_movements
        FROM StandStock01t s
        JOIN page_keys p
          ON p.companyid = s.companyid AND p.standdate = s.standdate AND p.lineno = s.lineno
        ORDER BY s.lineno
    """
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(sql, [*page_params, page_size + 1, max(0, page_offset or 0)])
        fetched_items = [_dict_row(cursor, row) for row in cursor.fetchall()]
        has_more = len(fetched_items) > page_size
        items = fetched_items[:page_size]
        next_cursor = items[-1]["lineno"] if items else after_lineno
        if include_metadata:
            cursor.execute(f"SELECT COUNT(*) FROM StandStock01t s WHERE {where_sql}", params)
            total = cursor.fetchone()[0]
            cursor.execute(
                """SELECT
                       EXISTS (SELECT 1 FROM StandStock01t WHERE companyid = %s),
                       EXISTS (
                           SELECT 1 FROM Inbound01t h
                           JOIN Inbound02t d ON d.companyid = h.companyid AND d.receiptno = h.receiptno
                           WHERE h.companyid = %s
                       ) OR EXISTS (
                           SELECT 1 FROM Outbound01t h
                           JOIN Outbound02t d ON d.companyid = h.companyid AND d.receiptno = h.receiptno
                           WHERE h.companyid = %s
                       ),
                       EXISTS (
                           SELECT 1 FROM StandStock01t s
                           WHERE s.companyid = %s AND (
                               EXISTS (
                                   SELECT 1 FROM Inbound01t h
                                   JOIN Inbound02t d ON d.companyid = h.companyid AND d.receiptno = h.receiptno
                                   WHERE h.companyid = s.companyid AND h.receptdate >= s.standdate
                                     AND d.itemcode = s.itemcode AND COALESCE(d.warehousecode, '') = s.warehousecode
                               ) OR EXISTS (
                                   SELECT 1 FROM Outbound01t h
                                   JOIN Outbound02t d ON d.companyid = h.companyid AND d.receiptno = h.receiptno
                                   WHERE h.companyid = s.companyid AND h.receptdate >= s.standdate
                                     AND d.itemcode = s.itemcode AND COALESCE(d.warehousecode, '') = s.warehousecode
                               )
                           )
                        ),
                        (SELECT MIN(standdate) FROM StandStock01t WHERE companyid = %s)""",
                (companyid, companyid, companyid, companyid, companyid),
            )
            has_stock_rows, has_transactions, has_stock_movements, registered_standdate = cursor.fetchone()
        else:
            total = None
            has_stock_rows = has_transactions = has_stock_movements = registered_standdate = None
    return {
        "items": items,
        "total": total,
        "has_more": has_more,
        "next_cursor": next_cursor if has_more else None,
        "has_stock_rows": has_stock_rows,
        "has_transactions": has_transactions,
        "has_stock_movements": has_stock_movements,
        "registered_standdate": registered_standdate,
    }


def _load_active_codes(cursor, companyid: str):
    cursor.execute(
        """SELECT groupcode, code, code_name FROM CodeMaster01t
           WHERE companyid = %s AND groupcode = ANY(%s)
             AND UPPER(BTRIM(use_yn)) = 'Y'""",
        (companyid, ["QTY", "WAREHOUSE", "PRICE_UNIT"]),
    )
    codes = {group: {} for group in ("QTY", "WAREHOUSE", "PRICE_UNIT")}
    for groupcode, code, name in cursor.fetchall():
        codes[groupcode][str(code).strip()] = str(name or "").strip()
    return codes


def resolve_active_items(companyid: str, itemcodes: list[str]):
    normalized_codes = list(dict.fromkeys(code.strip() for code in itemcodes if code and code.strip()))
    if not normalized_codes:
        return {}
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """SELECT itemcode, itemname FROM ItemCode01t
               WHERE companyid = %s AND UPPER(BTRIM(use_yn)) = 'Y' AND itemcode = ANY(%s)""",
            (companyid, normalized_codes),
        )
        return {str(code): str(name or "") for code, name in cursor.fetchall()}


def _calculate_unitamt(weight, unitprice, unit: str, price_units: dict[str, str]):
    if weight is None or unitprice is None:
        return None
    weight_value = Decimal(str(weight))
    price_value = Decimal(str(unitprice))
    unit_token = f"{unit or ''} {price_units.get(unit or '', '')}".upper()
    quantity = weight_value / Decimal("1000") if "TON" in unit_token or "톤" in unit_token else weight_value
    return (quantity * price_value).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def save_stand_items(companyid: str, companyname: str, standdate: date, items: list[dict]):
    try:
        with _connect() as connection, connection.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_xact_lock(hashtext(%s)::bigint)", (f"stand-stock:{companyid}",))
            cursor.execute(
                """SELECT
                       EXISTS (SELECT 1 FROM StandStock01t WHERE companyid = %s),
                       EXISTS (
                           SELECT 1 FROM Inbound01t h
                           JOIN Inbound02t d ON d.companyid = h.companyid AND d.receiptno = h.receiptno
                           WHERE h.companyid = %s
                       ) OR EXISTS (
                           SELECT 1 FROM Outbound01t h
                           JOIN Outbound02t d ON d.companyid = h.companyid AND d.receiptno = h.receiptno
                           WHERE h.companyid = %s
                       )""",
                (companyid, companyid, companyid),
            )
            has_stock_rows, has_transactions = cursor.fetchone()
            if has_stock_rows:
                raise ValueError("이 회사의 기초재고는 이미 등록되어 있어 추가 등록할 수 없습니다.")
            if has_transactions:
                raise ValueError("입고 또는 출고 수불 이력이 있어 기초재고를 등록할 수 없습니다.")

            codes = _load_active_codes(cursor, companyid)
            item_codes = list(dict.fromkeys(item["itemcode"].strip() for item in items))
            cursor.execute(
                """SELECT itemcode, itemname FROM ItemCode01t
                   WHERE companyid = %s AND UPPER(BTRIM(use_yn)) = 'Y' AND itemcode = ANY(%s)""",
                (companyid, item_codes),
            )
            active_items = {code: name for code, name in cursor.fetchall()}

            errors = []
            for index, item in enumerate(items, start=1):
                code = item["itemcode"].strip()
                warehousecode = item["warehousecode"].strip()
                if code not in active_items:
                    errors.append(f"{index}행 품목코드가 없거나 사용중지 상태입니다: {code}")
                elif active_items[code] != item["itemname"].strip():
                    errors.append(f"{index}행 품목코드와 품목명이 일치하지 않습니다: {code}")
                for field, group, label in (("qtyunit", "QTY", "수량단위"), ("warehousecode", "WAREHOUSE", "창고")):
                    value = item[field].strip()
                    if value not in codes[group]:
                        errors.append(f"{index}행 {label} 코드가 없거나 사용중지 상태입니다: {value}")
                unit = item.get("unit", "").strip()
                if unit and unit not in codes["PRICE_UNIT"]:
                    errors.append(f"{index}행 단가기준 코드가 없거나 사용중지 상태입니다: {unit}")
            if errors:
                raise ValueError("기초재고 입력을 확인해 주세요. " + " / ".join(errors[:5]))

            cursor.execute("SELECT COALESCE(MAX(lineno), 0) FROM StandStock01t WHERE companyid = %s", (companyid,))
            next_lineno = cursor.fetchone()[0] + 1
            values = []
            for item in items:
                code = item["itemcode"].strip()
                warehousecode = item["warehousecode"].strip()
                unit = item.get("unit", "").strip()
                values.append((
                    companyid, companyname, standdate, next_lineno,
                    code, active_items[code], item.get("size", "").strip() or None,
                    item.get("qty"), item["qtyunit"].strip(), item["weight"],
                    warehousecode, codes["WAREHOUSE"][warehousecode],
                    unit or None, item.get("unitprice"), _calculate_unitamt(item["weight"], item.get("unitprice"), unit, codes["PRICE_UNIT"]),
                    item.get("description", "").strip() or None,
                ))
                next_lineno += 1
            cursor.executemany(
                """INSERT INTO StandStock01t
                   (companyid, companyname, standdate, lineno, itemcode, itemname, size, qty, qtyunit,
                    weight, warehousecode, warehousecodename, unit, unitprice, unitamt, description)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                values,
            )
            opening_receiptno = current_stock_module.next_opening_receiptno(cursor, companyid)
            stock_lines = [{
                **item,
                "lineno": values[index][3],
                "itemname": active_items[item["itemcode"].strip()],
                "size": item.get("size", "").strip(),
                "warehousecode": item["warehousecode"].strip(),
                "warehousecodename": codes["WAREHOUSE"][item["warehousecode"].strip()],
            } for index, item in enumerate(items)]
            current_stock_module.record_document(
                cursor, companyid, companyname, standdate, "ST", opening_receiptno, stock_lines,
            )
        return len(items)
    except ValueError:
        raise
    except IntegrityError as error:
        logger.exception("Failed to save opening stock")
        raise ValueError("기초재고 순번이 중복되었습니다. 목록을 새로고침한 뒤 다시 저장해 주세요.") from error
    except Exception:
        logger.exception("Failed to save opening stock")
        raise


def update_stand_prices(companyid: str, items: list[dict]):
    linenos = [item["lineno"] for item in items]
    if len(linenos) != len(set(linenos)):
        raise ValueError("같은 기초재고 행이 여러 번 포함되어 있습니다.")

    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            "SELECT lineno, weight FROM StandStock01t WHERE companyid = %s AND lineno = ANY(%s) FOR UPDATE",
            (companyid, linenos),
        )
        weights = {row[0]: row[1] for row in cursor.fetchall()}
        found = set(weights)
        missing = sorted(set(linenos) - found)
        if missing:
            raise ValueError("수정할 기초재고 행을 찾을 수 없습니다. 목록을 새로고침해 주세요.")

        price_units = list(dict.fromkeys(item["unit"] for item in items if item["unit"]))
        if price_units:
            cursor.execute(
                """SELECT code, code_name FROM CodeMaster01t
                   WHERE companyid = %s AND groupcode = 'PRICE_UNIT'
                     AND UPPER(BTRIM(use_yn)) = 'Y' AND code = ANY(%s)""",
                (companyid, price_units),
            )
            active_price_units = {str(code).strip(): str(name or "").strip() for code, name in cursor.fetchall()}
            valid_units = set(active_price_units)
            invalid_units = [unit for unit in price_units if unit not in valid_units]
            if invalid_units:
                raise ValueError("단가기준 코드가 없거나 사용중지 상태입니다: " + ", ".join(invalid_units[:5]))
        else:
            active_price_units = {}

        cursor.executemany(
            """UPDATE StandStock01t
               SET unit = NULLIF(%s, ''), unitprice = %s, unitamt = %s, updated_at = CURRENT_TIMESTAMP
               WHERE companyid = %s AND lineno = %s""",
            [(
                item["unit"], item["unitprice"],
                _calculate_unitamt(weights[item["lineno"]], item["unitprice"], item["unit"], active_price_units),
                companyid, item["lineno"],
            ) for item in items],
        )
    return len(items)


def delete_stand_items(companyid: str):
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute("SELECT pg_advisory_xact_lock(hashtext(%s)::bigint)", (f"stand-stock:{companyid}",))
        cursor.execute(
            """SELECT s.lineno, s.itemcode, s.warehousecode
               FROM StandStock01t s
               WHERE s.companyid = %s
               FOR UPDATE""",
            (companyid,),
        )
        selected = cursor.fetchall()
        if not selected:
            return 0

        cursor.execute(
            """SELECT EXISTS (
                   SELECT 1 FROM Inbound01t h
                   JOIN Inbound02t d ON d.companyid = h.companyid AND d.receiptno = h.receiptno
                   WHERE h.companyid = %s
               ) OR EXISTS (
                   SELECT 1 FROM Outbound01t h
                   JOIN Outbound02t d ON d.companyid = h.companyid AND d.receiptno = h.receiptno
                   WHERE h.companyid = %s
               )""",
            (companyid, companyid),
        )
        if cursor.fetchone()[0]:
            raise ValueError("입고 또는 출고 수불 내역이 있어 기초재고 전체를 삭제할 수 없습니다.")

        current_stock_module.reverse_all_opening_stock(cursor, companyid)

        cursor.execute(
            "DELETE FROM StandStock01t WHERE companyid = %s",
            (companyid,),
        )
        deleted_count = cursor.rowcount
        return deleted_count
