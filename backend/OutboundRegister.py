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
    receptdate: date | None = None
    customcode: str = Field(default="", max_length=50)
    customname: str = Field(default="", max_length=100)
    warehousecode: str = Field(default="", max_length=50)
    warehousecodename: str = Field(default="", max_length=50)
    qty: Decimal = Field(gt=0, max_digits=15, decimal_places=3)
    weight: Decimal = Field(gt=0, max_digits=15, decimal_places=3)
    unit: str = Field(min_length=1, max_length=20)
    unitprice: Decimal = Field(ge=0, max_digits=15, decimal_places=2)
    description: str = Field(default="", max_length=500)

    @field_validator("stocksourcetype", "stocksourceno", "customcode", "customname", "warehousecode", "warehousecodename", "unit", "description")
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
    customcode: str = Field(default="", max_length=50)
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
        return self


class OutboundManagerUpdateLine(BaseModel):
    lineno: int = Field(gt=0)
    manager: str = Field(default="", max_length=100)

    @field_validator("manager")
    @classmethod
    def strip_manager(cls, value: str) -> str:
        return value.strip()


class OutboundManagerUpdateRequest(BaseModel):
    items: list[OutboundManagerUpdateLine] = Field(min_length=1, max_length=10000)


def _row_dict(cursor, row):
    return dict(zip((column[0] for column in cursor.description), row))


def _load_quantity_unit_maps(cursor, companyid: str) -> tuple[dict[str, str], dict[str, str]]:
    cursor.execute(
        """SELECT code, code_name FROM CodeMaster01t
           WHERE companyid = %s AND groupcode = 'QTY'""",
        (companyid,),
    )
    by_code = {}
    by_name = {}
    names_by_code = {}
    for code, name in cursor.fetchall():
        normalized_code = str(code or "").strip()
        normalized_name = str(name or "").strip()
        if normalized_code:
            by_code[normalized_code] = normalized_code
            names_by_code[normalized_code] = normalized_name or normalized_code
        if normalized_name:
            by_name.setdefault(normalized_name, normalized_code)
    return {**by_name, **by_code}, names_by_code


def _calculate_unit_amount(
    weight: Decimal, unitprice: Decimal, unit_code: str, unit_name: str,
    qty: Decimal = Decimal("0"), length: Decimal = Decimal("0"),
) -> Decimal:
    unit_token = f"{unit_code} {unit_name}".upper()
    if "TON" in unit_token or "톤" in unit_token:
        base_quantity = weight / Decimal("1000")
    elif "QTY" in unit_token or "수량" in unit_token or unit_token.strip() == "EA":
        base_quantity = qty
    elif "LENGTH" in unit_token or "길이" in unit_token or unit_token.strip() in {"M", "METER"}:
        base_quantity = length
    else:
        base_quantity = weight
    return (base_quantity * unitprice).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


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
    ):
        if value.strip():
            where += f" AND {column} ILIKE %s"
            params.append(f"%{value.strip()}%")
    for column, value in (("h.customcode", customcode), ("h.customname", customname)):
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
                   STRING_AGG(DISTINCT NULLIF(d.qtyunit, ''), ', ') AS qtyunit,
                   COALESCE(SUM(d.weight), 0)::numeric(15, 3) AS total_weight,
                   STRING_AGG(DISTINCT NULLIF(d.unit, ''), ', ') AS unit,
                   COALESCE(SUM(COALESCE(d.supplyamt, d.unitamt)), 0)::numeric(15, 2) AS supply_amount,
                   COALESCE(SUM(COALESCE(d.vat, ROUND(d.unitamt * 0.10, 2))), 0)::numeric(15, 2) AS vat_amount,
                   COALESCE(SUM(CASE WHEN d.supplyamt IS NULL THEN d.unitamt + ROUND(d.unitamt * 0.10, 2) ELSE d.unitamt END), 0)::numeric(15, 2) AS total_amount
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
            """SELECT d.companyid, d.companyname, d.receiptno, d.lineno,
                      d.stocksourcetype, d.stocksourceno, d.stocksourceline,
                      h.receptdate AS receptdate,
                      h.customcode AS customcode,
                      h.customname AS customname,
                      d.itemcode, d.itemname, d.productname, d.surfacecode, d.surfacename, d.materialcode, d.materialname,
                      d.myrtle, d.thickness, d.width, d.length, d.qty, d.qtyunit, d.warehousecode, d.warehousecodename,
                      d.weight, d.unit, d.unitprice, d.supplyamt, d.vat, d.unitamt, d.description, d.manager,
                      stock.receiptdate, stock.customname AS sourcecustomname,
                      COALESCE(stock.qty, 0) + COALESCE(own.qty, 0) AS current_qty,
                      COALESCE(stock.weight, 0) + COALESCE(own.weight, 0) AS current_weight,
                      d.created_at, d.updated_at
               FROM Outbound02t AS d
               JOIN Outbound01t AS h ON h.companyid = d.companyid AND h.receiptno = d.receiptno
               LEFT JOIN CurrentStock01t AS stock
                 ON stock.companyid = d.companyid
                AND stock.sourcetype = d.stocksourcetype
                AND stock.sourceno = d.stocksourceno
                AND stock.sourceline = d.stocksourceline
               LEFT JOIN (
                   SELECT stocksourcetype, stocksourceno, stocksourceline,
                          SUM(qty) AS qty, SUM(weight) AS weight
                   FROM Outbound02t
                   WHERE companyid = %s AND receiptno = %s
                   GROUP BY stocksourcetype, stocksourceno, stocksourceline
               ) AS own
                 ON own.stocksourcetype = d.stocksourcetype
                AND own.stocksourceno = d.stocksourceno
                AND own.stocksourceline = d.stocksourceline
               WHERE d.companyid = %s AND d.receiptno = %s
               ORDER BY d.lineno""",
            (companyid, receiptno, companyid, receiptno),
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
                       stock.qty AS current_qty,
                       stock.qty + COALESCE(own.qty, 0) AS available_qty,
                       stock.qtyunit, COALESCE(qty_code.code_name, stock.qtyunit) AS qtyunit_name,
                       stock.weight AS current_weight,
                       stock.weight + COALESCE(own.weight, 0) AS available_weight,
                       stock.unit, stock.warehousecode, stock.warehousecodename
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


def _save_new_receipt_groups(companyid: str, companyname: str, payload: dict):
    items = payload["items"]
    default_date = payload.get("receptdate")
    default_code = (payload.get("customcode") or "").strip()
    default_name = (payload.get("customname") or "").strip()
    for index, item in enumerate(items, start=1):
        item["receptdate"] = item.get("receptdate") or default_date
        item["customcode"] = (item.get("customcode") or default_code).strip()
        item["customname"] = (item.get("customname") or default_name).strip()
        if not item["receptdate"] or (not item["customcode"] and not item["customname"]):
            raise ValueError(f"{index}행의 출고일자와 거래처를 확인해 주세요.")

    try:
        with _connect() as connection, connection.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_xact_lock(hashtext(%s)::bigint)", (f"stand-stock:{companyid}",))
            customer_codes = list(dict.fromkeys(item["customcode"] for item in items if item["customcode"]))
            customer_names_input = list(dict.fromkeys(
                item["customname"].strip().lower() for item in items
                if not item["customcode"] and item["customname"].strip()
            ))
            cursor.execute(
                """SELECT customercode, customername FROM customer01t
                   WHERE companyid = %s AND UPPER(BTRIM(useyn)) = 'Y'
                     AND (customercode = ANY(%s) OR LOWER(BTRIM(customername)) = ANY(%s)
                          OR LOWER(BTRIM(customercode)) = ANY(%s))""",
                (companyid, customer_codes, customer_names_input, customer_names_input),
            )
            customers = {code: (name or "").strip() for code, name in cursor.fetchall()}
            customer_tokens = {}
            for code, name in customers.items():
                for token in (str(code).strip().lower(), name.lower()):
                    if token:
                        customer_tokens.setdefault(token, set()).add(code)
            for index, item in enumerate(items, start=1):
                if not item["customcode"]:
                    matches = customer_tokens.get(item["customname"].strip().lower(), set())
                    if len(matches) != 1:
                        raise ValueError(f"{index}행 거래처명을 회사 거래처 마스터에서 확인할 수 없습니다.")
                    item["customcode"] = next(iter(matches))
                customer_name = customers.get(item["customcode"])
                if customer_name is None:
                    raise ValueError(f"{index}행 거래처코드가 회사에서 사용할 수 없는 코드입니다: {item['customcode']}")
                supplied_name = item["customname"].strip().lower()
                if supplied_name and supplied_name not in {customer_name.lower(), item["customcode"].strip().lower()}:
                    raise ValueError(f"{index}행 거래처코드와 거래처명이 서로 다른 거래처를 가리킵니다.")
                item["customname"] = customer_name

            cursor.execute(
                """SELECT code, code_name FROM CodeMaster01t
                   WHERE companyid = %s AND groupcode = 'PRICE_UNIT'
                     AND UPPER(BTRIM(use_yn)) = 'Y'""",
                (companyid,),
            )
            price_unit_names = {code: code_name or "" for code, code_name in cursor.fetchall()}
            invalid_units = [
                f"{index}행 단가기준({item['unit'].strip()})"
                for index, item in enumerate(items, start=1)
                if item["unit"].strip() not in price_unit_names
            ]
            if invalid_units:
                raise ValueError("등록되어 사용 중인 단가기준을 확인해 주세요: " + ", ".join(invalid_units[:5]))

            quantity_unit_codes, quantity_unit_names = _load_quantity_unit_maps(cursor, companyid)
            source_cache = {}
            demands = {}
            for index, item in enumerate(items, start=1):
                source_key = (item["stocksourcetype"].strip().upper(), item["stocksourceno"].strip(), int(item["stocksourceline"]))
                if source_key[0] not in {"OPENING", "INBOUND"}:
                    raise ValueError(f"{index}행의 원천 재고 구분이 올바르지 않습니다.")
                if source_key not in source_cache:
                    cursor.execute(
                        """SELECT sourcetype, sourceno, sourceline, receiptdate, customcode, customname,
                                  itemcode, itemname, productname, materialcode, materialname,
                                  surfacecode, surfacename, myrtle, manager, thickness, width, length,
                                  qty, qtyunit, weight, unit, warehousecode, warehousecodename
                           FROM CurrentStock01t
                           WHERE companyid = %s AND sourcetype = %s AND sourceno = %s AND sourceline = %s
                           FOR UPDATE""",
                        (companyid, *source_key),
                    )
                    source_row = cursor.fetchone()
                    if not source_row:
                        raise ValueError(f"{index}행에서 선택한 원천 재고를 현재 회사에서 찾을 수 없습니다.")
                    source_data = _row_dict(cursor, source_row)
                    source_qtyunit = str(source_data.get("qtyunit") or "").strip()
                    source_data["qtyunit"] = quantity_unit_codes.get(source_qtyunit, source_qtyunit)
                    source_cache[source_key] = source_data
                stock = source_cache[source_key]
                demand = demands.setdefault(source_key, {"qty": Decimal("0"), "weight": Decimal("0"), "stock": stock})
                demand["qty"] += Decimal(str(item["qty"]))
                demand["weight"] += Decimal(str(item["weight"]))
                item["_source_key"] = source_key
                item["_warehousecode"] = (stock.get("warehousecode") or "").strip()

            for source_key, demand in demands.items():
                stock = demand["stock"]
                if demand["qty"] > Decimal(str(stock["qty"])) or demand["weight"] > Decimal(str(stock["weight"])):
                    raise ValueError(f"원천 재고 {source_key[1]}/{source_key[2]}의 출고량이 잔량을 초과합니다.")

            grouped_items = {}
            for item in items:
                group_key = (item["receptdate"], item["customcode"], item["_warehousecode"])
                grouped_items.setdefault(group_key, []).append(item)

            created_receipts = []
            for (receptdate, customcode, warehousecode), group_items in grouped_items.items():
                receiptno = _next_receiptno(cursor, companyid)
                customer_name = customers[customcode]
                cursor.execute(
                    """INSERT INTO Outbound01t
                       (companyid, companyname, receiptno, receptdate, customcode, customname, description, subulyn)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, 'N')""",
                    (companyid, companyname, receiptno, receptdate, customcode, customer_name, payload.get("description") or None),
                )
                detail_values = []
                stock_lines = []
                for line_no, item in enumerate(group_items, start=1):
                    source_key = item["_source_key"]
                    stock = source_cache[source_key]
                    unit = item["unit"].strip()
                    qty = Decimal(str(item["qty"]))
                    weight = Decimal(str(item["weight"]))
                    unitprice = Decimal(str(item["unitprice"]))
                    supplyamt = _calculate_unit_amount(
                        weight, unitprice, unit, price_unit_names[unit], qty=qty,
                        length=Decimal(str(stock["length"] or 0)),
                    )
                    vat = (supplyamt * Decimal("0.10")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                    unitamt = supplyamt + vat
                    detail_values.append((
                        companyid, companyname, receiptno, line_no, *source_key,
                        stock["itemcode"], stock["itemname"], stock["productname"],
                        stock["surfacecode"], stock["surfacename"], stock["materialcode"] or "",
                        stock["materialname"] or "", stock["myrtle"], stock["thickness"], stock["width"], stock["length"],
                        qty, quantity_unit_names.get(stock["qtyunit"], stock["qtyunit"]), weight,
                        price_unit_names.get(unit) or unit, unitprice, supplyamt, vat, unitamt,
                        stock["warehousecode"], stock["warehousecodename"], item.get("description", "").strip() or None,
                        stock["manager"],
                    ))
                    stock_lines.append({
                        "stocksourcetype": source_key[0], "stocksourceno": source_key[1], "stocksourceline": source_key[2],
                        "receptdate": receptdate, "customcode": customcode, "customname": customer_name,
                        "lineno": line_no, "itemcode": stock["itemcode"], "itemname": stock["itemname"],
                        "thickness": stock["thickness"], "width": stock["width"], "length": stock["length"],
                        "qty": qty, "qtyunit": stock["qtyunit"], "weight": weight,
                        "unit": unit, "unitprice": unitprice, "supplyamt": supplyamt, "vat": vat, "unitamt": unitamt,
                        "warehousecode": stock["warehousecode"], "warehousecodename": stock["warehousecodename"],
                    })
                cursor.executemany(
                    """INSERT INTO Outbound02t
                       (companyid, companyname, receiptno, lineno, stocksourcetype, stocksourceno, stocksourceline,
                        itemcode, itemname, productname, surfacecode, surfacename, materialcode, materialname, myrtle,
                        thickness, width, length, qty, qtyunit, weight, unit, unitprice, supplyamt, vat, unitamt,
                        warehousecode, warehousecodename, description, manager)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                               %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                    detail_values,
                )
                current_stock_module.record_document(
                    cursor, companyid, companyname, receptdate, "OUT", receiptno, stock_lines,
                    customcode=customcode, customname=customer_name,
                )
                created_receipts.append({
                    "receiptno": receiptno, "receptdate": receptdate.isoformat(),
                    "customcode": customcode, "customname": customer_name,
                    "warehousecode": warehousecode, "saved_count": len(group_items),
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
        if "outbound01t_pkey" in message or "duplicate key" in message:
            raise ValueError("출고전표 번호가 중복되었습니다. 다시 저장해 주세요.") from error
        raise
    except Exception:
        logger.exception("Failed to save grouped outbound receipts")
        raise


def save_receipt(companyid: str, companyname: str, payload: dict):
    if payload.get("is_new"):
        return _save_new_receipt_groups(companyid, companyname, payload)
    receiptno = (payload.get("receiptno") or "").strip()
    items = payload["items"]
    try:
        with _connect() as connection, connection.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_xact_lock(hashtext(%s)::bigint)", (f"stand-stock:{companyid}",))
            customcode = (payload.get("customcode") or "").strip()
            supplied_customer_name = (payload.get("customname") or "").strip()
            if customcode:
                cursor.execute(
                    """SELECT customername FROM customer01t
                       WHERE companyid = %s AND customercode = %s AND UPPER(BTRIM(useyn)) = 'Y'
                       LIMIT 1""",
                    (companyid, customcode),
                )
                customer_row = cursor.fetchone()
                if not customer_row:
                    raise ValueError(f"사용할 수 없는 거래처 코드입니다: {customcode}")
                customer_name = (customer_row[0] or "").strip()
                if supplied_customer_name and supplied_customer_name.casefold() != customer_name.casefold():
                    raise ValueError("거래처 코드와 거래처명이 일치하지 않습니다.")
            else:
                if not supplied_customer_name:
                    raise ValueError("거래처를 선택해 주세요.")
                cursor.execute(
                    """SELECT customercode, customername FROM customer01t
                       WHERE companyid = %s AND UPPER(BTRIM(useyn)) = 'Y'
                         AND LOWER(BTRIM(customername)) = LOWER(%s)
                       ORDER BY customercode LIMIT 2""",
                    (companyid, supplied_customer_name),
                )
                matching_customers = cursor.fetchall()
                if not matching_customers:
                    raise ValueError(f"사용 중인 거래처를 찾을 수 없습니다: {supplied_customer_name}")
                if len(matching_customers) > 1:
                    raise ValueError(f"거래처명이 중복되어 코드를 결정할 수 없습니다: {supplied_customer_name}")
                customcode, customer_name = matching_customers[0]
                customer_name = (customer_name or "").strip()
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

            quantity_unit_codes, quantity_unit_names = _load_quantity_unit_maps(cursor, companyid)
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
                                  qty, qtyunit, weight, unit, warehousecode, warehousecodename
                           FROM CurrentStock01t
                           WHERE companyid = %s AND sourcetype = %s AND sourceno = %s AND sourceline = %s
                           FOR UPDATE""",
                        (companyid, *source_key),
                    )
                    source_row = cursor.fetchone()
                    if not source_row:
                        raise ValueError(f"{index}행 선택한 원천 재고를 현재 회사에서 찾을 수 없습니다.")
                    source_data = _row_dict(cursor, source_row)
                    source_qtyunit = str(source_data.get("qtyunit") or "").strip()
                    source_data["qtyunit"] = quantity_unit_codes.get(source_qtyunit, source_qtyunit)
                    source_cache[source_key] = source_data
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
                supplyamt = _calculate_unit_amount(
                    weight, unitprice, unit, price_unit_names[unit], qty=qty,
                    length=Decimal(str(stock["length"] or 0)),
                )
                vat = (supplyamt * Decimal("0.10")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                unitamt = supplyamt + vat
                detail_values.append((
                    companyid, companyname, receiptno, line_no, *source_key,
                    stock["itemcode"], stock["itemname"], stock["productname"],
                    stock["surfacecode"], stock["surfacename"], stock["materialcode"] or "",
                    stock["materialname"] or "", stock["myrtle"], stock["thickness"], stock["width"], stock["length"],
                    qty, quantity_unit_names.get(stock["qtyunit"], stock["qtyunit"]), weight,
                    price_unit_names.get(unit) or unit, unitprice, supplyamt, vat, unitamt,
                    stock["warehousecode"], stock["warehousecodename"], item.get("description", "").strip() or None,
                    stock["manager"],
                ))
                stock_lines.append({
                    "stocksourcetype": source_key[0], "stocksourceno": source_key[1], "stocksourceline": source_key[2],
                    "receptdate": payload["receptdate"],
                    "customcode": customcode, "customname": customer_name,
                    "lineno": line_no, "itemcode": stock["itemcode"], "itemname": stock["itemname"],
                    "thickness": stock["thickness"], "width": stock["width"], "length": stock["length"],
                    "qty": qty, "qtyunit": stock["qtyunit"], "weight": weight,
                    "unit": unit, "unitprice": unitprice, "supplyamt": supplyamt, "vat": vat, "unitamt": unitamt,
                    "warehousecode": stock["warehousecode"], "warehousecodename": stock["warehousecodename"],
                })
            cursor.executemany(
                """INSERT INTO Outbound02t
                   (companyid, companyname, receiptno, lineno, stocksourcetype, stocksourceno, stocksourceline,
                    itemcode, itemname, productname, surfacecode, surfacename, materialcode, materialname, myrtle,
                    thickness, width, length, qty, qtyunit, weight, unit, unitprice, supplyamt, vat, unitamt,
                    warehousecode, warehousecodename, description, manager)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                           %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
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
               FROM Outbound01t
               WHERE companyid = %s AND receiptno = %s
               FOR UPDATE""",
            (companyid, receiptno),
        )
        receipt = cursor.fetchone()
        if not receipt:
            raise ValueError("수정할 출고전표를 찾을 수 없습니다.")
        if str(receipt[0] or "N").strip().upper() in {"Y", "YES", "확정"}:
            raise ValueError("수불 확정된 출고전표의 담당자는 수정할 수 없습니다.")

        cursor.execute(
            """SELECT lineno
               FROM Outbound02t
               WHERE companyid = %s AND receiptno = %s AND lineno = ANY(%s)
               FOR UPDATE""",
            (companyid, receiptno, list(normalized)),
        )
        found_lines = {row[0] for row in cursor.fetchall()}
        missing_lines = sorted(set(normalized) - found_lines)
        if missing_lines:
            raise ValueError(f"출고상세 {', '.join(map(str, missing_lines[:5]))}행을 찾을 수 없습니다.")

        for lineno, manager in normalized.items():
            cursor.execute(
                """UPDATE Outbound02t
                   SET manager = %s, updated_at = CURRENT_TIMESTAMP
                   WHERE companyid = %s AND receiptno = %s AND lineno = %s""",
                (manager or None, companyid, receiptno, lineno),
            )
            cursor.execute(
                """UPDATE Iniop01t
                   SET manager = %s, updated_at = CURRENT_TIMESTAMP
                   WHERE companyid = %s AND iniotype = 'OUT'
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
