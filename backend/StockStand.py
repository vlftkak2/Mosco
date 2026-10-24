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
    standdate: date | None = None
    itemcode: str = Field(min_length=1, max_length=100)
    itemname: str = Field(min_length=1, max_length=150)
    customcode: str = Field(default="", max_length=50)
    customname: str = Field(default="", max_length=100)
    productname: str = Field(default="", max_length=100)
    surfacecode: str = Field(default="", max_length=100)
    surfacename: str = Field(default="", max_length=100)
    materialcode: str = Field(min_length=1, max_length=100)
    materialname: str = Field(min_length=1, max_length=100)
    myrtle: Decimal | None = Field(default=None, ge=0, max_digits=15, decimal_places=3)
    thickness: Decimal | None = Field(default=None, ge=0, max_digits=15, decimal_places=3)
    width: Decimal | None = Field(default=None, ge=0, max_digits=15, decimal_places=3)
    length: Decimal | None = Field(default=None, ge=0, max_digits=15, decimal_places=3)
    qty: Decimal = Field(gt=0, max_digits=15, decimal_places=3)
    qtyunit: str = Field(min_length=1, max_length=20)
    weight: Decimal = Field(gt=0, max_digits=15, decimal_places=3)
    warehousecode: str = Field(min_length=1, max_length=50)
    warehousecodename: str = Field(min_length=1, max_length=50)
    unit: str = Field(min_length=1, max_length=20)
    unitprice: Decimal | None = Field(default=None, ge=0, max_digits=15, decimal_places=2)
    supplyamt: Decimal | None = Field(default=None, ge=0, max_digits=15, decimal_places=2)
    vat: Decimal | None = Field(default=None, ge=0, max_digits=15, decimal_places=2)
    unitamt: Decimal | None = Field(default=None, ge=0, max_digits=15, decimal_places=2)
    supplyamt_manual: bool = False
    vat_manual: bool = False
    description: str = Field(default="", max_length=500)

    @field_validator("itemcode", "itemname", "customcode", "customname", "productname", "surfacecode", "surfacename", "materialcode", "materialname", "qtyunit", "warehousecode", "warehousecodename", "unit", "description")
    @classmethod
    def strip_text(cls, value: str) -> str:
        return value.strip()

    @model_validator(mode="after")
    def require_base_fields(self):
        if not self.itemcode or not self.itemname or not self.materialcode or not self.materialname or not self.qtyunit or not self.unit or not self.warehousecode or not self.warehousecodename:
            raise ValueError("품목, 강종, 수량단위, 창고는 필수 입력입니다.")
        return self


class StandSaveRequest(BaseModel):
    standdate: date
    items: list[StandItemInput] = Field(min_length=1, max_length=10000)


class StandPriceInput(BaseModel):
    lineno: int = Field(gt=0)
    unit: str = Field(min_length=1, max_length=20)
    unitprice: Decimal | None = Field(default=None, ge=0, max_digits=15, decimal_places=2)
    unitamt: Decimal | None = Field(default=None, ge=0, max_digits=15, decimal_places=2)

    @field_validator("unit")
    @classmethod
    def strip_unit(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("단가기준은 필수 입력입니다.")
        return normalized


class StandPriceSaveRequest(BaseModel):
    items: list[StandPriceInput] = Field(min_length=1, max_length=10000)


class StandItemResolveRequest(BaseModel):
    itemcodes: list[str] = Field(default_factory=list, max_length=10000)
    itemnames: list[str] = Field(default_factory=list, max_length=10000)
    customernames: list[str] = Field(default_factory=list, max_length=10000)

    @field_validator("itemcodes", "itemnames", "customernames")
    @classmethod
    def clean_values(cls, values: list[str]) -> list[str]:
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
    *,
    date_from: date | None = None,
    date_to: date | None = None,
    warehouse: str = "",
):
    where = ["s.companyid = %s"]
    params: list = [companyid]
    if date_from or date_to:
        where.append("s.standdate >= %s AND s.standdate <= %s")
        params.extend((date_from or date_to or standdate, date_to or date_from or standdate))
    else:
        where.append("s.standdate = %s")
        params.append(standdate)
    normalized_query = query.strip()
    if normalized_query:
        where.append("(s.itemcode ILIKE %s OR s.itemname ILIKE %s)")
        params.extend((f"%{normalized_query}%", f"%{normalized_query}%"))
    normalized_warehouse = warehouse.strip()
    if normalized_warehouse:
        where.append("(s.warehousecode ILIKE %s OR s.warehousecodename ILIKE %s)")
        params.extend((f"%{normalized_warehouse}%", f"%{normalized_warehouse}%"))
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
               s.customcode, s.customname,
               s.productname, s.surfacecode, s.surfacename, s.materialcode, s.materialname,
               s.myrtle, s.thickness, s.width, s.length, s.qty, s.qtyunit, s.weight,
               s.warehousecode, s.warehousecodename, s.unit, s.unitprice,
               s.supplyamt, s.vat, s.unitamt, s.description, s.created_at, s.updated_at,
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
        (companyid, ["QTY", "WAREHOUSE", "PRICE_UNIT", "MATERIAL", "SURFACE"]),
    )
    codes = {group: {} for group in ("QTY", "WAREHOUSE", "PRICE_UNIT", "MATERIAL", "SURFACE")}
    for groupcode, code, name in cursor.fetchall():
        codes[groupcode][str(code).strip()] = str(name or "").strip()
    return codes


def resolve_active_items(companyid: str, itemcodes: list[str], itemnames: list[str] | None = None):
    normalized_codes = list(dict.fromkeys(code.strip().lower() for code in itemcodes if code and code.strip()))
    normalized_names = list(dict.fromkeys(name.strip().lower() for name in (itemnames or []) if name and name.strip()))
    if not normalized_codes and not normalized_names:
        return {}, {}
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """SELECT itemcode, itemname FROM ItemCode01t
               WHERE companyid = %s AND UPPER(BTRIM(use_yn)) = 'Y'
                 AND (LOWER(BTRIM(itemcode)) = ANY(%s) OR LOWER(BTRIM(itemname)) = ANY(%s))""",
            (companyid, normalized_codes, normalized_names),
        )
        rows = cursor.fetchall()
    by_code = {str(code).strip().lower(): {"itemcode": str(code).strip(), "itemname": str(name or "").strip()} for code, name in rows}
    by_name: dict[str, list[dict[str, str]]] = {}
    for code, name in rows:
        normalized_name = str(name or "").strip()
        by_name.setdefault(normalized_name.lower(), []).append({"itemcode": str(code).strip(), "itemname": normalized_name})
    return by_code, by_name


def resolve_active_customers(companyid: str, customernames: list[str]):
    values = list(dict.fromkeys(value.strip().lower() for value in customernames if value and value.strip()))
    if not values:
        return {}
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """SELECT customercode, customername FROM customer01t
               WHERE companyid = %s AND UPPER(BTRIM(useyn)) = 'Y'
                 AND (LOWER(BTRIM(customername)) = ANY(%s) OR LOWER(BTRIM(customercode)) = ANY(%s))""",
            (companyid, values, values),
        )
        rows = cursor.fetchall()
    matches: dict[str, list[dict[str, str]]] = {}
    for code, name in rows:
        normalized_name = str(name or "").strip()
        customer = {"customercode": str(code).strip(), "customername": normalized_name}
        for key in {str(code).strip().lower(), normalized_name.lower()}:
            matches.setdefault(key, []).append(customer)
    return matches


def _calculate_unitamt(qty, length, weight, unitprice, unit: str, price_units: dict[str, str]):
    if unitprice is None:
        return None
    unit_price = Decimal(str(unitprice))
    unit_token = f"{unit or ''} {price_units.get(unit or '', '')}".upper()
    if "QTY" in unit_token or "COUNT" in unit_token or "수량" in unit_token or unit_token.strip() in {"EA", "PCS"}:
        basis = qty
    elif "LENGTH" in unit_token or "METER" in unit_token or "길이" in unit_token or unit_token.strip() in {"M", "MTR"}:
        basis = length
    else:
        basis = weight
        if basis is not None and ("TON" in unit_token or "톤" in unit_token):
            basis = Decimal(str(basis)) / Decimal("1000")
    if basis is None:
        return None
    return (Decimal(str(basis)) * unit_price).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _calculate_amounts(qty, length, weight, unitprice, unit: str, price_units: dict[str, str], *, supplyamt=None, vat=None, supplyamt_manual=False, vat_manual=False):
    supply = (Decimal(str(supplyamt or 0)) if supplyamt_manual
              else _calculate_unitamt(qty, length, weight, unitprice, unit, price_units))
    if supply is None:
        return None, None, None
    tax = (Decimal(str(vat or 0)) if vat_manual
           else (supply * Decimal("0.10")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
    return supply, tax, supply + tax


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

            customer_values = list(dict.fromkeys(
                value.strip().lower()
                for item in items
                for value in (item.get("customcode", ""), item.get("customname", ""))
                if value and value.strip()
            ))
            cursor.execute(
                """SELECT customercode, customername FROM customer01t
                   WHERE companyid = %s AND UPPER(BTRIM(useyn)) = 'Y'
                     AND (LOWER(BTRIM(customercode)) = ANY(%s) OR LOWER(BTRIM(customername)) = ANY(%s))""",
                (companyid, customer_values, customer_values),
            )
            active_customers = cursor.fetchall()
            customers_by_code = {str(code).strip().lower(): (str(code).strip(), str(name or "").strip()) for code, name in active_customers}
            customers_by_name: dict[str, list[tuple[str, str]]] = {}
            for code, name in active_customers:
                customer = (str(code).strip(), str(name or "").strip())
                customers_by_name.setdefault(customer[1].lower(), []).append(customer)

            errors = []
            for index, item in enumerate(items, start=1):
                code = item["itemcode"].strip()
                warehousecode = item["warehousecode"].strip()
                customer_code = item.get("customcode", "").strip()
                customer_name = item.get("customname", "").strip()
                if customer_code:
                    customer = customers_by_code.get(customer_code.lower())
                    if not customer:
                        errors.append(f"{index}행 거래처 코드가 없거나 사용 중이 아닙니다: {customer_code}")
                    elif customer_name and customer_name.lower() not in {customer[0].lower(), customer[1].lower()}:
                        errors.append(f"{index}행 거래처 코드와 거래처명이 일치하지 않습니다: {customer_code}")
                    else:
                        item["customcode"], item["customname"] = customer
                elif customer_name:
                    customer_from_code = customers_by_code.get(customer_name.lower())
                    if customer_from_code:
                        item["customcode"], item["customname"] = customer_from_code
                    else:
                        matches = customers_by_name.get(customer_name.lower(), [])
                        if len(matches) == 1:
                            item["customcode"], item["customname"] = matches[0]
                        elif len(matches) > 1:
                            errors.append(f"{index}행 거래처명이 중복됩니다. 거래처 코드를 입력해 주세요.")
                        else:
                            errors.append(f"{index}행 거래처명이 거래처 마스터에 없습니다: {customer_name}")
                if code not in active_items:
                    errors.append(f"{index}행 품목코드가 없거나 사용중지 상태입니다: {code}")
                elif active_items[code] != item["itemname"].strip():
                    errors.append(f"{index}행 품목코드와 품목명이 일치하지 않습니다: {code}")
                for field, group, label in (("qtyunit", "QTY", "수량단위"), ("warehousecode", "WAREHOUSE", "창고"), ("materialcode", "MATERIAL", "강종")):
                    value = item[field].strip()
                    if value not in codes[group]:
                        errors.append(f"{index}행 {label} 코드가 없거나 사용중지 상태입니다: {value}")
                    elif field == "materialcode" and codes[group][value] != item["materialname"].strip():
                        errors.append(f"{index}행 강종 코드와 이름이 일치하지 않습니다: {value}")
                surfacecode = item.get("surfacecode", "").strip()
                surfacename = item.get("surfacename", "").strip()
                if surfacecode and surfacecode not in codes["SURFACE"]:
                    errors.append(
                        f"{index}행 표면 코드 '{surfacecode}'를 찾을 수 없습니다. "
                        "등록된 표면 코드를 입력하거나 표면 선택 버튼에서 항목을 골라 주세요."
                    )
                elif surfacecode and codes["SURFACE"][surfacecode] != surfacename:
                    errors.append(
                        f"{index}행 표면 코드와 표면명이 서로 다릅니다. "
                        "표면 선택 버튼에서 다시 선택해 주세요."
                    )
                unit = item.get("unit", "").strip()
                if unit and unit not in codes["PRICE_UNIT"]:
                    errors.append(f"{index}행 단가기준 코드가 없거나 사용중지 상태입니다: {unit}")
            if errors:
                raise ValueError("기초재고 입력을 확인해 주세요. " + " / ".join(errors[:5]))

            cursor.execute("SELECT COALESCE(MAX(lineno), 0) FROM StandStock01t WHERE companyid = %s", (companyid,))
            next_lineno = cursor.fetchone()[0] + 1
            values = []
            calculated_amounts = []
            for item in items:
                code = item["itemcode"].strip()
                warehousecode = item["warehousecode"].strip()
                unit = item.get("unit", "").strip()
                item_date = item.get("standdate") or standdate
                supplyamt, vat, unitamt = _calculate_amounts(
                    item.get("qty"), item.get("length"), item.get("weight"), item.get("unitprice"), unit, codes["PRICE_UNIT"],
                    supplyamt=item.get("supplyamt"), vat=item.get("vat"),
                    supplyamt_manual=item.get("supplyamt_manual", False), vat_manual=item.get("vat_manual", False),
                )
                calculated_amounts.append((supplyamt, vat, unitamt))
                values.append((
                    companyid, companyname, item_date, next_lineno, code, active_items[code],
                    item.get("customcode", "").strip() or None,
                    item.get("customname", "").strip() or None,
                    item.get("productname", "").strip() or None,
                    item.get("surfacecode", "").strip() or None,
                    item.get("surfacename", "").strip() or None,
                    item["materialcode"].strip(), item["materialname"].strip(), item.get("myrtle"),
                    item.get("thickness"), item.get("width"), item.get("length"),
                    item.get("qty"), item["qtyunit"].strip(), item["weight"],
                    warehousecode, codes["WAREHOUSE"][warehousecode], unit or None, item.get("unitprice"),
                    supplyamt, vat, unitamt, item.get("description", "").strip() or None,
                ))
                next_lineno += 1
            cursor.executemany(
                """INSERT INTO StandStock01t
                   (companyid, companyname, standdate, lineno, itemcode, itemname, customcode, customname, productname,
                    surfacecode, surfacename, materialcode, materialname, myrtle,
                    thickness, width, length, qty, qtyunit, weight, warehousecode, warehousecodename,
                    unit, unitprice, supplyamt, vat, unitamt, description)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                values,
            )
            opening_receiptno = current_stock_module.next_opening_receiptno(cursor, companyid)
            stock_lines = [{
                **item,
                "receptdate": item.get("standdate") or standdate,
                "lineno": values[index][3],
                "itemname": active_items[item["itemcode"].strip()],
                "productname": item.get("productname", "").strip(),
                "surfacecode": item.get("surfacecode", "").strip(),
                "surfacename": item.get("surfacename", "").strip(),
                "materialcode": item.get("materialcode", "").strip(),
                "materialname": item.get("materialname", "").strip(),
                "myrtle": item.get("myrtle"),
                "thickness": item.get("thickness"),
                "width": item.get("width"),
                "length": item.get("length"),
                "unit": item.get("unit"),
                "unitprice": item.get("unitprice"),
                "supplyamt": amounts[0],
                "vat": amounts[1],
                "unitamt": amounts[2],
                "warehousecode": item["warehousecode"].strip(),
                "warehousecodename": codes["WAREHOUSE"][item["warehousecode"].strip()],
            } for index, (item, amounts) in enumerate(zip(items, calculated_amounts))]
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
            "SELECT lineno, qty, length, weight FROM StandStock01t WHERE companyid = %s AND lineno = ANY(%s) FOR UPDATE",
            (companyid, linenos),
        )
        stock_values = {row[0]: row[1:] for row in cursor.fetchall()}
        found = set(stock_values)
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
               SET unit = NULLIF(%s, ''), unitprice = %s, supplyamt = %s, vat = %s, unitamt = %s,
                   updated_at = CURRENT_TIMESTAMP
               WHERE companyid = %s AND lineno = %s""",
            [(
                item["unit"], item["unitprice"],
                *_calculate_amounts(*stock_values[item["lineno"]], item["unitprice"], item["unit"], active_price_units),
                companyid, item["lineno"],
            ) for item in items],
        )
        if current_stock_module._uses_source_lines(cursor):
            for item in items:
                cursor.execute(
                    """UPDATE CurrentStock01t
                       SET unit = NULLIF(%s, ''), unitprice = %s, updated_at = CURRENT_TIMESTAMP
                       WHERE companyid = %s AND sourcetype = 'OPENING' AND sourceline = %s""",
                    (active_price_units[item["unit"]], item["unitprice"], companyid, item["lineno"]),
                )
                if cursor.rowcount != 1:
                    raise ValueError(f"기초재고 현재고 원천 라인을 찾을 수 없습니다: {item['lineno']}")
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
