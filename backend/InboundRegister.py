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
    receptdate: date | None = None
    customcode: str = Field(default="", max_length=50)
    customname: str = Field(default="", max_length=100)
    itemcode: str = Field(min_length=1, max_length=100)
    itemname: str = Field(min_length=1, max_length=150)
    productname: str = Field(default="", max_length=100)
    materialcode: str = Field(default="", max_length=50)
    materialname: str = Field(default="", max_length=100)
    surfacecode: str = Field(default="", max_length=50)
    surfacename: str = Field(default="", max_length=100)
    myrtle: Decimal | None = Field(default=None, ge=0, max_digits=15, decimal_places=3)
    manager: str = Field(default="", max_length=100)
    thickness: Decimal | None = Field(default=None, ge=0, max_digits=15, decimal_places=3)
    width: Decimal | None = Field(default=None, ge=0, max_digits=15, decimal_places=3)
    length: Decimal | None = Field(default=None, ge=0, max_digits=15, decimal_places=3)
    qtyunit: str = Field(min_length=1, max_length=20)
    qty: Decimal = Field(gt=0, max_digits=15, decimal_places=3)
    unitprice: Decimal = Field(gt=0, max_digits=15, decimal_places=2)
    supplyamt: Decimal | None = Field(default=None, ge=0, max_digits=15, decimal_places=2)
    vat: Decimal | None = Field(default=None, ge=0, max_digits=15, decimal_places=2)
    weight: Decimal = Field(gt=0, max_digits=15, decimal_places=3)
    warehousecode: str = Field(min_length=1, max_length=50)
    warehousecodename: str = Field(min_length=1, max_length=50)
    unit: str = Field(min_length=1, max_length=20)

    description: str = Field(default="", max_length=500)

    @field_validator("myrtle", "thickness", "width", "length", mode="before")
    @classmethod
    def blank_dimension_to_none(cls, value):
        return None if value is None or not str(value).strip() else value

    @field_validator("supplyamt", "vat", mode="before")
    @classmethod
    def blank_amount_to_none(cls, value):
        return None if value is None or not str(value).strip() else value

    @field_validator("customcode", "customname", "itemcode", "itemname", "productname", "materialcode", "materialname", "surfacecode", "surfacename", "manager", "qtyunit", "warehousecode", "warehousecodename", "unit", "description")
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
    customcode: str = Field(default="", max_length=50)
    customname: str = Field(default="", max_length=100)
    is_new: bool = False
    items: list[InboundDetailInput] = Field(min_length=1, max_length=10000)

    @field_validator("receiptno", "customcode", "customname")
    @classmethod
    def strip_text(cls, value: str) -> str:
        return value.strip()

    @model_validator(mode="after")
    def require_header_fields(self):
        if not self.is_new and not self.receiptno:
            raise ValueError("수정할 입고전표번호가 없습니다.")
        return self


class InboundManagerUpdateLine(BaseModel):
    lineno: int = Field(gt=0)
    manager: str = Field(default="", max_length=100)

    @field_validator("manager")
    @classmethod
    def strip_manager(cls, value: str) -> str:
        return value.strip()


class InboundManagerUpdateRequest(BaseModel):
    items: list[InboundManagerUpdateLine] = Field(min_length=1, max_length=10000)


def _row_dict(cursor, row):
    return dict(zip((column[0] for column in cursor.description), row))


def _calculate_unit_amount(
    weight: Decimal,
    qty: Decimal,
    length: Decimal | None,
    unitprice: Decimal,
    unit_code: str,
    unit_name: str,
) -> Decimal:
    unit_token = f"{unit_code} {unit_name}".strip().upper()
    if "수량" in unit_token or "QTY" in unit_token or unit_token in {"EA", "PCS", "COUNT"}:
        basis = qty
    elif "길이" in unit_token or "LENGTH" in unit_token or unit_token in {"M", "METER"}:
        basis = length or Decimal("0")
    elif "TON" in unit_token or "톤" in unit_token:
        basis = weight / Decimal("1000")
    else:
        basis = weight
    return (basis * unitprice).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def list_receipts(
    companyid: str,
    page: int,
    page_size: int,
    query: str = "",
    date_from: date | None = None,
    date_to: date | None = None,
    receiptno: str = "",
    customer: str = "",
    customcode: str = "",
    customname: str = "",
    warehouse: str = "",
):
    where = ["h.companyid = %s"]
    params: list = [companyid]
    if receiptno.strip():
        where.append("h.receiptno ILIKE %s")
        params.append(f"%{receiptno.strip()}%")
    for column, value in (("h.customcode", customcode), ("h.customname", customname)):
        if value.strip():
            where.append(f"{column} ILIKE %s")
            params.append(f"%{value.strip()}%")
    if customer.strip():
        pattern = f"%{customer.strip()}%"
        where.append("(h.customcode ILIKE %s OR h.customname ILIKE %s)")
        params.extend((pattern, pattern))
    if date_from:
        where.append("h.receptdate >= %s")
        params.append(date_from)
    if date_to:
        where.append("h.receptdate <= %s")
        params.append(date_to)
    if warehouse.strip():
        where.append("EXISTS (SELECT 1 FROM Inbound02t AS wd WHERE wd.companyid = h.companyid AND wd.receiptno = h.receiptno AND (wd.warehousecode ILIKE %s OR wd.warehousecodename ILIKE %s))")
        pattern = f"%{warehouse.strip()}%"
        params.extend((pattern, pattern))
    search = query.strip()
    if search:
        pattern = f"%{search}%"
        where.append("(h.receiptno ILIKE %s OR h.customcode ILIKE %s OR h.customname ILIKE %s)")
        params.extend((pattern, pattern, pattern))
    where_sql = " AND ".join(where)

    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(f"SELECT COUNT(*) FROM Inbound01t AS h WHERE {where_sql}", params)
        total = cursor.fetchone()[0]
        cursor.execute(
            f"""
            SELECT h.receiptno, h.receptdate, h.customcode, h.customname,
                   STRING_AGG(DISTINCT NULLIF(d.description, ''), ', ') AS description,
                   h.subulyn, h.created_at,
                   COUNT(d.lineno)::integer AS line_count,
                   STRING_AGG(DISTINCT NULLIF(d.warehousecode, ''), ', ') AS warehousecode,
                   STRING_AGG(DISTINCT NULLIF(d.warehousecodename, ''), ', ') AS warehousecodename,
                   COALESCE(SUM(d.qty), 0)::numeric(15, 3) AS total_qty,
                   STRING_AGG(DISTINCT NULLIF(d.qtyunit, ''), ', ') AS qtyunit,
                   COALESCE(SUM(d.weight), 0)::numeric(15, 3) AS total_weight,
                   STRING_AGG(DISTINCT NULLIF(d.unit, ''), ', ') AS unit,
                   COALESCE(SUM(COALESCE(d.supplyamt, d.unitamt)), 0)::numeric(15, 2) AS supply_amount,
                   COALESCE(SUM(COALESCE(d.vat, ROUND(COALESCE(d.supplyamt, d.unitamt, 0) * 0.1, 2))), 0)::numeric(15, 2) AS vat_amount,
                   (COALESCE(SUM(COALESCE(d.supplyamt, d.unitamt)), 0) + COALESCE(SUM(COALESCE(d.vat, ROUND(COALESCE(d.supplyamt, d.unitamt, 0) * 0.1, 2))), 0))::numeric(15, 2) AS total_amount
            FROM Inbound01t AS h
            LEFT JOIN Inbound02t AS d
              ON d.companyid = h.companyid AND d.receiptno = h.receiptno
            WHERE {where_sql}
            GROUP BY h.companyid, h.receiptno
            ORDER BY h.receptdate ASC, h.customname ASC, h.receiptno ASC
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
                      COALESCE(subulyn, 'N') AS subulyn,
                      created_at, updated_at
               FROM Inbound01t WHERE companyid = %s AND receiptno = %s""",
            (companyid, receiptno),
        )
        header_row = cursor.fetchone()
        if not header_row:
            return None
        header = _row_dict(cursor, header_row)
        cursor.execute(
            """SELECT d.companyid, d.companyname, d.receiptno, d.lineno, d.itemcode, d.itemname, d.productname,
                      h.receptdate AS receptdate,
                      h.customcode AS customcode,
                      h.customname AS customname,
                      d.thickness, d.width, d.length, d.qty, d.qtyunit,
                      d.weight, d.unit, d.unitprice, d.supplyamt, d.vat, d.unitamt,
                      d.warehousecode, d.warehousecodename, d.materialcode, d.materialname,
                      d.surfacecode, d.surfacename, d.myrtle, d.manager, d.description,
                      d.created_at, d.updated_at
               FROM Inbound02t AS d
               JOIN Inbound01t AS h ON h.companyid = d.companyid AND h.receiptno = d.receiptno
               WHERE d.companyid = %s AND d.receiptno = %s
               ORDER BY d.lineno""",
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
    items = payload["items"]
    default_customcode = (payload.get("customcode") or "").strip()
    default_receptdate = payload.get("receptdate")
    for item in items:
        item["customcode"] = (item.get("customcode") or default_customcode).strip()
        item["customname"] = (item.get("customname") or "").strip()
        item["receptdate"] = item.get("receptdate") or default_receptdate
    missing_rows = [str(index) for index, item in enumerate(items, start=1)
                    if (not item["customcode"] and not item["customname"]) or not item["receptdate"]]
    if missing_rows:
        raise ValueError(f"{', '.join(missing_rows[:5])}행: 입고일자와 거래처를 입력해 주세요.")
    if not default_receptdate and not items[0].get("receptdate"):
        raise ValueError("입고일자를 입력해 주세요.")
    try:
        with _connect() as connection, connection.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_xact_lock(hashtext(%s)::bigint)", (f"stand-stock:{companyid}",))
            customer_codes = list(dict.fromkeys(item["customcode"] for item in items if item["customcode"]))
            customer_tokens = list(dict.fromkeys(
                item["customname"].strip().lower() for item in items if not item["customcode"] and item["customname"].strip()
            ))
            cursor.execute(
                """SELECT customercode, customername FROM customer01t
                   WHERE companyid = %s AND UPPER(BTRIM(useyn)) = 'Y'
                     AND (customercode = ANY(%s) OR LOWER(BTRIM(customername)) = ANY(%s)
                          OR LOWER(BTRIM(customercode)) = ANY(%s))""",
                (companyid, customer_codes, customer_tokens, customer_tokens),
            )
            customer_names = {code: name or "" for code, name in cursor.fetchall()}
            customer_tokens_by_value = {}
            for code, name in customer_names.items():
                for token in (str(code).strip().lower(), str(name).strip().lower()):
                    if token:
                        customer_tokens_by_value.setdefault(token, set()).add(code)
            for index, item in enumerate(items, start=1):
                if not item["customcode"]:
                    matches = customer_tokens_by_value.get(item["customname"].strip().lower(), set())
                    if len(matches) != 1:
                        raise ValueError(f"{index}행 거래처명을 마스터에서 확인할 수 없습니다. 거래처 자동완성에서 등록된 거래처를 선택해 주세요.")
                    item["customcode"] = next(iter(matches))
                customer_name = customer_names.get(item["customcode"])
                if customer_name is None:
                    raise ValueError(f"{index}행 거래처코드를 사용할 수 없습니다. 회사별 거래처 마스터에 등록되어 있고 사용 중인지 확인해 주세요: {item['customcode']}")
                if item["customname"] and item["customname"].strip().lower() not in {
                    customer_name.strip().lower(), item["customcode"].strip().lower()
                }:
                    raise ValueError(f"{index}행 거래처명과 거래처코드가 서로 다른 거래처를 가리킵니다. 거래처 자동완성에서 다시 선택해 주세요: {item['customcode']} / {customer_name}")
                item["customname"] = customer_name
            grouped_items = {}
            for item in items:
                warehousecode = (item.get("warehousecode") or "").strip()
                group_key = (item["receptdate"], item["customcode"], warehousecode)
                grouped_items.setdefault(group_key, []).append(item)

            item_codes = list(dict.fromkeys(item["itemcode"].strip() for item in items))
            cursor.execute(
                """SELECT groupcode, code, code_name FROM CodeMaster01t
                   WHERE companyid = %s AND groupcode = ANY(%s)
                     AND UPPER(BTRIM(use_yn)) = 'Y'""",
                (companyid, ["PRICE_UNIT", "QTY", "WAREHOUSE", "MATERIAL", "SURFACE"]),
            )
            active_units = {groupcode: set() for groupcode in ("PRICE_UNIT", "QTY", "WAREHOUSE", "MATERIAL", "SURFACE")}
            price_unit_names = {}
            active_price_unit_values = set()
            active_quantity_unit_values = set()
            warehouse_names = {}
            general_code_names = {"MATERIAL": {}, "SURFACE": {}}
            for groupcode, code, code_name in cursor.fetchall():
                active_units[groupcode].add(code)
                if groupcode == "PRICE_UNIT":
                    price_unit_names[code] = code_name or ""
                    active_price_unit_values.add(code)
                    if code_name:
                        active_price_unit_values.add(code_name)
                elif groupcode == "QTY":
                    active_quantity_unit_values.add(code)
                    active_quantity_unit_values.add(code_name or code)
                elif groupcode == "WAREHOUSE":
                    warehouse_names[code] = code_name or ""
                elif groupcode in general_code_names:
                    general_code_names[groupcode][code] = code_name or code
            unit_errors = []
            for index, item in enumerate(items, start=1):
                price_unit = item["unit"].strip()
                quantity_unit = item["qtyunit"].strip()
                if price_unit not in active_price_unit_values:
                    unit_errors.append(f"{index}행 단가기준 미등록 또는 사용중지({price_unit})")
                if quantity_unit not in active_quantity_unit_values:
                    unit_errors.append(f"{index}행 수량단위 미등록 또는 사용중지({quantity_unit})")
                warehouse_code = (item.get("warehousecode") or "").strip()
                if warehouse_code and warehouse_code not in active_units["WAREHOUSE"]:
                    unit_errors.append(f"{index}행 창고코드가 일반코드 마스터에 없거나 사용중지 상태입니다. ({warehouse_code})")
                elif warehouse_code and len(warehouse_names.get(warehouse_code, "")) > 50:
                    unit_errors.append(f"{index}행 창고명이 저장 가능 길이(50자)를 초과합니다. ({warehouse_code})")
                for groupcode, code_field, name_field, label in (
                    ("MATERIAL", "materialcode", "materialname", "강판"),
                    ("SURFACE", "surfacecode", "surfacename", "표면"),
                ):
                    submitted_code = (item.get(code_field) or "").strip()
                    submitted_name = (item.get(name_field) or "").strip()
                    if not submitted_code and not submitted_name:
                        continue
                    options = general_code_names[groupcode]
                    def find_option(value):
                        normalized = value.casefold()
                        return next(((code, name) for code, name in options.items()
                                     if normalized in {code.casefold(), name.casefold()}), None) if normalized else None

                    code_match = find_option(submitted_code)
                    name_match = find_option(submitted_name)
                    match = code_match or name_match
                    if not match or (code_match and name_match and code_match[0] != name_match[0]):
                        unit_errors.append(f"{index}행 {label}: 일반코드 마스터에 등록되어 있고 사용 중인 항목을 선택해 주세요. ({submitted_name or submitted_code})")
                    else:
                        item[code_field], item[name_field] = match
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

            created_receipts = []
            for (header_receptdate, customcode, warehousecode), group_items in grouped_items.items():
                receiptno = _next_receiptno(cursor, companyid)
                customer_name = customer_names[customcode]
                cursor.execute(
                    """INSERT INTO Inbound01t
                       (companyid, companyname, receiptno, receptdate, customcode,
                        customname, subulyn)
                       VALUES (%s, %s, %s, %s, %s, %s, 'N')""",
                    (companyid, companyname, receiptno, header_receptdate, customcode,
                     customer_name),
                )

                detail_values = []
                for line_no, item in enumerate(group_items, start=1):
                    weight = Decimal(str(item["weight"]))
                    unitprice = Decimal(str(item["unitprice"]))
                    qty = Decimal(str(item["qty"])) if item.get("qty") is not None else None
                    calculated_supply = _calculate_unit_amount(
                        weight, qty or Decimal("0"),
                        Decimal(str(item.get("length") or 0)), unitprice, item["unit"],
                        price_unit_names.get(item["unit"]) or item["unit"],
                    )
                    supplyamt = item.get("supplyamt")
                    if supplyamt is None:
                        supplyamt = calculated_supply
                    vat = item.get("vat")
                    if vat is None:
                        vat = (supplyamt * Decimal("0.1")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                    unitamt = (supplyamt + vat).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                    detail_values.append((
                        companyid, companyname, receiptno, line_no,
                        item["itemcode"].strip(), item["itemname"].strip(),
                        (item.get("productname") or "").strip() or None,
                        item.get("thickness"), item.get("width"), item.get("length"),
                        # Existing Inbound02t installations may define these as NOT NULL;
                        # keep optional, unselected master fields as empty strings.
                        (item.get("materialcode") or "").strip(),
                        (item.get("materialname") or "").strip(),
                        (item.get("surfacecode") or "").strip() or None,
                        (item.get("surfacename") or "").strip() or None,
                        item.get("myrtle"),
                        (item.get("manager") or "").strip() or None,
                        qty, item["qtyunit"].strip(),
                        weight, item["unit"].strip(), unitprice, supplyamt, vat, unitamt,
                        (item.get("warehousecode") or "").strip() or None,
                        warehouse_names.get((item.get("warehousecode") or "").strip()) or None,
                        item.get("description", "").strip() or None,
                    ))
                cursor.executemany(
                    """INSERT INTO Inbound02t
                       (companyid, companyname, receiptno, lineno, itemcode, itemname, productname,
                        thickness, width, length, materialcode, materialname, surfacecode,
                        surfacename, myrtle, manager, qty, qtyunit, weight, unit, unitprice,
                        supplyamt, vat, unitamt, warehousecode, warehousecodename, description)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                    detail_values,
                )
                stock_lines = [{
                    **item,
                    "lineno": line_no,
                    "itemname": master_items[item["itemcode"].strip()],
                    "thickness": item.get("thickness"),
                    "width": item.get("width"),
                    "length": item.get("length"),
                    "warehousecode": item["warehousecode"].strip(),
                    "warehousecodename": warehouse_names[item["warehousecode"].strip()],
                } for line_no, item in enumerate(group_items, start=1)]
                current_stock_module.record_document(
                    cursor, companyid, companyname, header_receptdate, "IN", receiptno, stock_lines,
                    customcode=customcode, customname=customer_name,
                )
                created_receipts.append({
                    "receiptno": receiptno,
                    "receptdate": header_receptdate.isoformat(),
                    "customcode": customcode,
                    "customname": customer_name,
                    "warehousecode": warehousecode,
                    "warehousecodename": warehouse_names.get(warehousecode, ""),
                    "saved_count": len(group_items),
                })
        return {
            "receiptno": created_receipts[0]["receiptno"],
            "receipt_numbers": [receipt["receiptno"] for receipt in created_receipts],
            "receipts": created_receipts,
            "group_count": len(created_receipts),
            "saved_count": len(items),
        }
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


def update_receipt_managers(companyid: str, receiptno: str, items: list[dict]):
    normalized = {}
    for item in items:
        lineno = int(item["lineno"])
        if lineno in normalized:
            raise ValueError("수정 항목에 중복된 상세 순번이 있습니다.")
        normalized[lineno] = (item.get("manager") or "").strip()

    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute("SELECT pg_advisory_xact_lock(hashtext(%s)::bigint)", (f"stand-stock:{companyid}",))
        cursor.execute(
            """SELECT COALESCE(subulyn, 'N')
               FROM Inbound01t
               WHERE companyid = %s AND receiptno = %s
               FOR UPDATE""",
            (companyid, receiptno),
        )
        receipt = cursor.fetchone()
        if not receipt:
            raise ValueError("수정할 입고전표를 찾을 수 없습니다.")
        if str(receipt[0] or "N").strip().upper() in {"Y", "YES", "확정"}:
            raise ValueError("수불 확정된 입고전표의 담당자는 수정할 수 없습니다.")

        cursor.execute(
            """SELECT lineno
               FROM Inbound02t
               WHERE companyid = %s AND receiptno = %s AND lineno = ANY(%s)
               FOR UPDATE""",
            (companyid, receiptno, list(normalized)),
        )
        found_lines = {row[0] for row in cursor.fetchall()}
        missing_lines = sorted(set(normalized) - found_lines)
        if missing_lines:
            raise ValueError(f"입고상세 {', '.join(map(str, missing_lines[:5]))}행을 찾을 수 없습니다.")

        for lineno, manager in normalized.items():
            cursor.execute(
                """UPDATE Inbound02t
                   SET manager = %s, updated_at = CURRENT_TIMESTAMP
                   WHERE companyid = %s AND receiptno = %s AND lineno = %s""",
                (manager or None, companyid, receiptno, lineno),
            )
            cursor.execute(
                """UPDATE CurrentStock01t
                   SET manager = %s, updated_at = CURRENT_TIMESTAMP
                   WHERE companyid = %s AND sourcetype = 'INBOUND'
                     AND sourceno = %s AND sourceline = %s""",
                (manager or None, companyid, receiptno, lineno),
            )
            if cursor.rowcount != 1:
                raise ValueError(f"현재고 원천 재고 {receiptno}/{lineno}행을 찾을 수 없어 담당자를 수정하지 못했습니다.")
            cursor.execute(
                """UPDATE Iniop01t
                   SET manager = %s, updated_at = CURRENT_TIMESTAMP
                   WHERE companyid = %s AND iniotype = 'IN'
                     AND receiptno = %s AND lineno = %s""",
                (manager or None, companyid, receiptno, lineno),
            )
            if cursor.rowcount != 1:
                raise ValueError(f"재고수불현황 {receiptno}/{lineno}행을 찾을 수 없어 담당자를 수정하지 못했습니다.")

    return len(normalized)


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
