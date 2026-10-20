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


class InboundDetailInput(BaseModel):
    itemcode: str = Field(min_length=1, max_length=100)
    itemname: str = Field(min_length=1, max_length=150)
    size: str = Field(default="", max_length=100)
    qty: Decimal = Field(gt=0, max_digits=15, decimal_places=3)
    qtyunit: str = Field(min_length=1, max_length=20)
    warehousecode: str = Field(min_length=1, max_length=50)
    warehousecodename: str = Field(min_length=1, max_length=50)
    weight: Decimal = Field(gt=0, max_digits=15, decimal_places=3)
    unit: str = Field(min_length=1, max_length=20)
    unitprice: Decimal = Field(gt=0, max_digits=15, decimal_places=2)
    description: str = Field(default="", max_length=500)

    @field_validator("itemcode", "itemname", "size", "qtyunit", "warehousecode", "warehousecodename", "unit", "description")
    @classmethod
    def strip_text(cls, value: str) -> str:
        return value.strip()

    @model_validator(mode="after")
    def require_item_fields(self):
        if not self.itemcode or not self.itemname or not self.unit or not self.qtyunit or not self.warehousecode:
            raise ValueError("상세의 품목코드, 품목명, 수량, 수량단위, 창고, 단가기준은 필수입니다.")
        return self


class InboundSaveRequest(BaseModel):
    receiptno: str = Field(default="", max_length=100)
    receptdate: date
    customcode: str = Field(min_length=1, max_length=50)
    customname: str = Field(default="", max_length=100)
    description: str = Field(default="", max_length=500)
    is_new: bool = False
    items: list[InboundDetailInput] = Field(min_length=1, max_length=10000)

    @field_validator("receiptno", "customcode", "customname", "description")
    @classmethod
    def strip_text(cls, value: str) -> str:
        return value.strip()

    @model_validator(mode="after")
    def require_header_fields(self):
        if not self.is_new and not self.receiptno:
            raise ValueError("수정할 입고전표번호가 없습니다.")
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
    if search:
        where += " AND (h.receiptno ILIKE %s OR h.customcode ILIKE %s OR h.customname ILIKE %s)"
        pattern = f"%{search}%"
        params.extend((pattern, pattern, pattern))

    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(f"SELECT COUNT(*) FROM Inbound01t AS h WHERE {where}", params)
        total = cursor.fetchone()[0]
        cursor.execute(
            f"""
            SELECT h.receiptno, h.receptdate, h.customcode, h.customname,
                   h.description, h.subulyn, h.created_at,
                   COUNT(d.lineno)::integer AS line_count,
                   COALESCE(SUM(d.unitamt), 0)::numeric(15, 2) AS total_amount
            FROM Inbound01t AS h
            LEFT JOIN Inbound02t AS d
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
               FROM Inbound01t WHERE companyid = %s AND receiptno = %s""",
            (companyid, receiptno),
        )
        header_row = cursor.fetchone()
        if not header_row:
            return None
        header = _row_dict(cursor, header_row)
        cursor.execute(
            """SELECT companyid, companyname, receiptno, lineno, itemcode, itemname, size,
                      qty, qtyunit, warehousecode, warehousecodename,
                      weight, unit, unitprice, unitamt, description,
                      created_at, updated_at
               FROM Inbound02t
               WHERE companyid = %s AND receiptno = %s
               ORDER BY lineno""",
            (companyid, receiptno),
        )
        header["items"] = [_row_dict(cursor, row) for row in cursor.fetchall()]
    return header


def _next_receiptno(cursor, companyid: str) -> str:
    today = datetime.now(ZoneInfo("Asia/Seoul")).date()
    prefix = f"IN{today:%Y%m%d}"
    cursor.execute(
        "SELECT pg_advisory_xact_lock(hashtext(%s)::bigint)",
        (f"inbound-sequence:{companyid}:{prefix}",),
    )
    suffix_start = len(prefix) + 1
    cursor.execute(
        """SELECT COALESCE(MAX(substring(receiptno FROM %s)::bigint), 0)
           FROM Inbound01t
           WHERE companyid = %s
             AND LEFT(receiptno, %s) = %s
             AND substring(receiptno FROM %s) ~ '^[0-9]{1,18}$'""",
        (suffix_start, companyid, len(prefix), prefix, suffix_start),
    )
    next_sequence = cursor.fetchone()[0] + 1
    return f"{prefix}{next_sequence:05d}"


def save_receipt(companyid: str, companyname: str, payload: dict):
    if not payload.get("is_new"):
        raise ValueError("저장된 입고전표는 수정할 수 없습니다. 신규 전표로 등록해 주세요.")
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
                    (f"inbound:{companyid}:{receiptno}",),
                )

            item_codes = list(dict.fromkeys(item["itemcode"].strip() for item in items))
            cursor.execute(
                """SELECT groupcode, code, code_name FROM CodeMaster01t
                   WHERE companyid = %s AND groupcode = ANY(%s)
                     AND UPPER(BTRIM(use_yn)) = 'Y'""",
                (companyid, ["PRICE_UNIT", "QTY", "WAREHOUSE"]),
            )
            active_units = {groupcode: set() for groupcode in ("PRICE_UNIT", "QTY", "WAREHOUSE")}
            price_unit_names = {}
            warehouse_names = {}
            for groupcode, code, code_name in cursor.fetchall():
                active_units[groupcode].add(code)
                if groupcode == "PRICE_UNIT":
                    price_unit_names[code] = code_name or ""
                elif groupcode == "WAREHOUSE":
                    warehouse_names[code] = code_name or ""
            unit_errors = []
            for index, item in enumerate(items, start=1):
                price_unit = item["unit"].strip()
                quantity_unit = item["qtyunit"].strip()
                if price_unit not in active_units["PRICE_UNIT"]:
                    unit_errors.append(f"{index}행 단가기준 미등록 또는 사용중지({price_unit})")
                if quantity_unit not in active_units["QTY"]:
                    unit_errors.append(f"{index}행 수량단위 미등록 또는 사용중지({quantity_unit})")
                warehouse_code = (item.get("warehousecode") or "").strip()
                if warehouse_code and warehouse_code not in active_units["WAREHOUSE"]:
                    unit_errors.append(f"{index}행 창고코드가 일반코드 마스터에 없거나 사용중지 상태입니다. ({warehouse_code})")
                elif warehouse_code and len(warehouse_names.get(warehouse_code, "")) > 50:
                    unit_errors.append(f"{index}행 창고명이 저장 가능 길이(50자)를 초과합니다. ({warehouse_code})")
            if unit_errors:
                raise ValueError("단위 코드를 확인해 주세요: " + " / ".join(unit_errors[:5]))

            cursor.execute(
                "SELECT itemcode, itemname FROM ItemCode01t WHERE companyid = %s AND UPPER(BTRIM(use_yn)) = 'Y' AND itemcode = ANY(%s)",
                (companyid, item_codes),
            )
            master_items = {code: name for code, name in cursor.fetchall()}
            item_errors = []
            for index, item in enumerate(items, start=1):
                code = item["itemcode"].strip()
                name = item["itemname"].strip()
                master_name = master_items.get(code)
                if master_name is None:
                    item_errors.append(f"{index}행 사용중 상태의 품목코드가 아니거나 미등록({code})")
                elif master_name != name:
                    item_errors.append(f"{index}행 품목코드·품목명 불일치({code}: {master_name})")
            if item_errors:
                raise ValueError("품목 정합성을 확인해 주세요: " + " / ".join(item_errors[:5]))

            cursor.execute(
                "SELECT COALESCE(subulyn, 'N') FROM Inbound01t WHERE companyid = %s AND receiptno = %s FOR UPDATE",
                (companyid, receiptno),
            )
            existing = cursor.fetchone()
            if existing and str(existing[0] or "N").strip().upper() in {"Y", "YES", "확정"}:
                raise ValueError("수불 확정된 입고전표는 수정할 수 없습니다.")
            if payload.get("is_new") and existing:
                raise ValueError(f"이미 등록된 입고전표번호입니다: {receiptno}")
            if not payload.get("is_new") and not existing:
                raise ValueError("수정할 입고전표가 없습니다. 목록을 새로고침해 주세요.")

            if existing:
                cursor.execute(
                    """UPDATE Inbound01t
                       SET receptdate = %s, customcode = %s, customname = %s,
                           description = %s, updated_at = CURRENT_TIMESTAMP
                       WHERE companyid = %s AND receiptno = %s""",
                    (payload["receptdate"], customcode, customer_name,
                     payload.get("description") or None, companyid, receiptno),
                )
                cursor.execute(
                    "DELETE FROM Inbound02t WHERE companyid = %s AND receiptno = %s",
                    (companyid, receiptno),
                )
            else:
                cursor.execute(
                    """INSERT INTO Inbound01t
                       (companyid, companyname, receiptno, receptdate, customcode,
                        customname, description, subulyn)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, 'N')""",
                    (companyid, companyname, receiptno, payload["receptdate"], customcode,
                     customer_name, payload.get("description") or None),
                )

            detail_values = []
            for line_no, item in enumerate(items, start=1):
                weight = Decimal(str(item["weight"]))
                unitprice = Decimal(str(item["unitprice"]))
                qty = Decimal(str(item["qty"])) if item.get("qty") is not None else None
                unitamt = _calculate_unit_amount(
                    weight, unitprice, item["unit"], price_unit_names.get(item["unit"], ""),
                )
                detail_values.append((
                    companyid, companyname, receiptno, line_no,
                    item["itemcode"].strip(), item["itemname"].strip(),
                    item.get("size", "").strip() or None, qty, item["qtyunit"].strip(),
                    (item.get("warehousecode") or "").strip() or None,
                    warehouse_names.get((item.get("warehousecode") or "").strip()) or None,
                    weight, item["unit"].strip(), unitprice, unitamt,
                    item.get("description", "").strip() or None,
                ))
            cursor.executemany(
                """INSERT INTO Inbound02t
                   (companyid, companyname, receiptno, lineno, itemcode, itemname,
                    size, qty, qtyunit, warehousecode, warehousecodename,
                    weight, unit, unitprice, unitamt, description)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                detail_values,
            )
            stock_lines = [{
                **item,
                "lineno": line_no,
                "itemname": master_items[item["itemcode"].strip()],
                "size": item.get("size", "").strip(),
                "warehousecode": item["warehousecode"].strip(),
                "warehousecodename": warehouse_names[item["warehousecode"].strip()],
            } for line_no, item in enumerate(items, start=1)]
            current_stock_module.record_document(
                cursor, companyid, companyname, payload["receptdate"], "IN", receiptno, stock_lines,
                customcode=customcode, customname=customer_name,
            )
        return {"receiptno": receiptno, "saved_count": len(items)}
    except ValueError:
        raise
    except IntegrityError as error:
        message = str(error).lower()
        if "inbound01t_pkey" in message or "duplicate key" in message:
            raise ValueError(f"이미 등록된 입고전표번호입니다: {receiptno}") from error
        raise
    except Exception:
        logger.exception("Failed to save inbound receipt")
        raise


def delete_receipt(companyid: str, receiptno: str):
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute("SELECT pg_advisory_xact_lock(hashtext(%s)::bigint)", (f"stand-stock:{companyid}",))
        cursor.execute(
            "SELECT COALESCE(subulyn, 'N') FROM Inbound01t WHERE companyid = %s AND receiptno = %s FOR UPDATE",
            (companyid, receiptno),
        )
        row = cursor.fetchone()
        if not row:
            return 0
        if str(row[0] or "N").strip().upper() in {"Y", "YES", "확정"}:
            raise ValueError("수불 확정된 입고전표는 삭제할 수 없습니다.")
        current_stock_module.reverse_document(cursor, companyid, "IN", receiptno)
        cursor.execute("DELETE FROM Inbound02t WHERE companyid = %s AND receiptno = %s", (companyid, receiptno))
        cursor.execute("DELETE FROM Inbound01t WHERE companyid = %s AND receiptno = %s", (companyid, receiptno))
        return 1
