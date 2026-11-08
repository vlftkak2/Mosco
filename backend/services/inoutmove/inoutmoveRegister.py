from psycopg2.extras import execute_values
import logging
from contextlib import contextmanager
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
from zoneinfo import ZoneInfo

from psycopg2 import IntegrityError
import db as _shared_db
from pydantic import BaseModel, Field, field_validator, model_validator

from config import DB_CONFIG
from services.inventory.CurrentStock import user_name_sql

logger = logging.getLogger(__name__)
# Connections come from the single shared pool (backend/db.py).
_connect = _shared_db.connect


class TransferStockInput(BaseModel):
    stocksourcetype: str = Field(min_length=1, max_length=20)
    stocksourceno: str = Field(min_length=1, max_length=100)
    stocksourceline: int = Field(gt=0)
    qty: Decimal = Field(gt=0, max_digits=15, decimal_places=3)

    @field_validator("stocksourcetype")
    @classmethod
    def strip_text(cls, value: str) -> str:
        return value.strip().upper()

    @field_validator("stocksourceno")
    @classmethod
    def strip_source_no(cls, value: str) -> str:
        return value.strip()


class TransferSaveRequest(BaseModel):
    receiptno: str = Field(default="", max_length=100)
    receptdate: date
    fromwarehousecode: str = Field(min_length=1, max_length=100)
    towarehousecode: str = Field(min_length=1, max_length=100)
    manager: str = Field(default="", max_length=100)
    description: str = Field(default="", max_length=500)
    items: list[TransferStockInput] = Field(min_length=1, max_length=10000)

    @field_validator("receiptno", "fromwarehousecode", "towarehousecode", "manager", "description")
    @classmethod
    def strip_text(cls, value: str) -> str:
        return value.strip()

    @model_validator(mode="after")
    def validate_transfer(self):
        if self.fromwarehousecode == self.towarehousecode:
            raise ValueError("출발 창고와 도착 창고는 달라야 합니다.")
        keys = [(item.stocksourcetype, item.stocksourceno, item.stocksourceline) for item in self.items]
        if len(keys) != len(set(keys)):
            raise ValueError("같은 현재고를 두 번 선택했습니다.")
        if any(item.stocksourcetype not in {"OPENING", "INBOUND", "PROCESS"} for item in self.items):
            raise ValueError("현재고 원천 구분을 확인해 주세요.")
        return self


def _row_dict(cursor, row):
    return dict(zip((column[0] for column in cursor.description), row))


def _calculate_transfer_amount(qty, length, weight, unitprice, unit: str, unit_name: str):
    if unitprice is None:
        return None, None, None
    unit_token = f"{unit or ''} {unit_name or ''}".upper()
    if "TON" in unit_token or "톤" in unit_token:
        basis = weight / Decimal("1000")
    elif "QTY" in unit_token or "수량" in unit_token or unit_token.strip() in {"EA", "PCS", "COUNT"}:
        basis = qty
    elif "LENGTH" in unit_token or "길이" in unit_token or unit_token.strip() in {"M", "METER"}:
        basis = length or Decimal("0")
    else:
        basis = weight
    supplyamt = (basis * Decimal(str(unitprice))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    vat = (supplyamt * Decimal("0.10")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return supplyamt, vat, supplyamt + vat


def list_warehouses(companyid: str):
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """SELECT code AS warehousecode, code_name AS warehousecodename
               FROM CodeMaster01t
               WHERE companyid = %s AND groupcode = 'WAREHOUSE'
                 AND UPPER(BTRIM(use_yn)) = 'Y'
               ORDER BY code""",
            (companyid,),
        )
        return [_row_dict(cursor, row) for row in cursor.fetchall()]


def list_available_stock(
    companyid: str, page: int = 1, page_size: int = 50,
    item_search: str = "", warehouse_search: str = "", source_type: str = "",
    receiptno: str = "", date_from: date | None = None, date_to: date | None = None,
    thickness: str = "", width: str = "", length: str = "",
):
    where = [
        "stock.companyid = %s",
        "COALESCE(stock.qty, 0) > 0",
        "COALESCE(stock.weight, 0) > 0",
    ]
    params: list = [companyid]
    if item_search.strip():
        pattern = f"%{item_search.strip()}%"
        where.append("(stock.itemcode ILIKE %s OR stock.itemname ILIKE %s OR stock.productname ILIKE %s)")
        params.extend((pattern, pattern, pattern))
    if warehouse_search.strip():
        pattern = f"%{warehouse_search.strip()}%"
        where.append("(stock.warehousecode ILIKE %s OR stock.warehousecodename ILIKE %s)")
        params.extend((pattern, pattern))
    if source_type.strip():
        where.append("stock.sourcetype = %s")
        params.append(source_type.strip().upper())
    if receiptno.strip():
        where.append("stock.sourceno ILIKE %s")
        params.append(f"%{receiptno.strip()}%")
    if date_from:
        where.append("stock.receiptdate >= %s")
        params.append(date_from)
    if date_to:
        where.append("stock.receiptdate <= %s")
        params.append(date_to)
    for column, value in (("thickness", thickness), ("width", width), ("length", length)):
        if value.strip():
            where.append(f"CAST(stock.{column} AS TEXT) ILIKE %s")
            params.append(f"%{value.strip()}%")
    where_sql = " AND ".join(where)
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(f"SELECT COUNT(*) FROM CurrentStock01t AS stock WHERE {where_sql}", params)
        total = cursor.fetchone()[0]
        cursor.execute(
            f"""SELECT stock.sourcetype AS stocksourcetype,
                       stock.sourceno AS stocksourceno,
                       stock.sourceline AS stocksourceline,
                       stock.receiptdate, stock.customname AS sourcecustomname,
                       stock.itemcode, stock.itemname, stock.productname,
                       stock.materialname, stock.surfacename, stock.myrtle,
                       stock.thickness, stock.width, stock.length,
                       stock.qty, COALESCE(qty_code.code_name, stock.qtyunit) AS qtyunit,
                       stock.weight, stock.unit, stock.unitprice,
                       stock.warehousecode, stock.warehousecodename
                FROM CurrentStock01t AS stock
                LEFT JOIN CodeMaster01t AS qty_code
                  ON qty_code.companyid = stock.companyid
                 AND qty_code.groupcode = 'QTY'
                 AND qty_code.code = stock.qtyunit
                WHERE {where_sql}
                ORDER BY stock.receiptdate, stock.sourcetype, stock.sourceno, stock.sourceline
                LIMIT %s OFFSET %s""",
            (*params, page_size, (page - 1) * page_size),
        )
        items = [_row_dict(cursor, row) for row in cursor.fetchall()]
    return {"items": items, "total": total, "page": page, "page_size": page_size}


def list_transfers(
    companyid: str, page: int = 1, page_size: int = 50,
    date_from: date | None = None, date_to: date | None = None,
    receiptno: str = "", warehouse: str = "",
):
    where = ["h.companyid = %s"]
    params: list = [companyid]
    if date_from:
        where.append("h.receptdate >= %s")
        params.append(date_from)
    if date_to:
        where.append("h.receptdate <= %s")
        params.append(date_to)
    if receiptno.strip():
        where.append("h.receiptno ILIKE %s")
        params.append(f"%{receiptno.strip()}%")
    if warehouse.strip():
        pattern = f"%{warehouse.strip()}%"
        where.append("(h.fromwarehousecode ILIKE %s OR h.fromwarehousename ILIKE %s OR h.towarehousecode ILIKE %s OR h.towarehousename ILIKE %s)")
        params.extend((pattern, pattern, pattern, pattern))
    where_sql = " AND ".join(where)
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(f"SELECT COUNT(*) FROM inoutmove01t h WHERE {where_sql}", params)
        total = cursor.fetchone()[0]
        cursor.execute(
            f"""SELECT h.receiptno, h.receptdate,
                       h.fromwarehousecode, h.fromwarehousename,
                       h.towarehousecode, h.towarehousename,
                       h.manager, h.description, h.subulyn, h.created_at, h.updated_at,
                       {user_name_sql('h.created_by')} AS created_by,
                       {user_name_sql('h.updated_by')} AS updated_by,
                       COUNT(d.lineno)::integer AS line_count,
                       COALESCE(SUM(d.qty), 0)::numeric(15, 3) AS total_qty,
                       STRING_AGG(DISTINCT NULLIF(d.qtyunit, ''), ', ') AS qtyunit,
                       COALESCE(SUM(d.weight), 0)::numeric(15, 3) AS total_weight
                FROM inoutmove01t h
                LEFT JOIN inoutmove02t d ON d.companyid = h.companyid AND d.receiptno = h.receiptno
                WHERE {where_sql}
                GROUP BY h.companyid, h.receiptno
                ORDER BY h.receptdate DESC, h.receiptno DESC
                LIMIT %s OFFSET %s""",
            (*params, page_size, (page - 1) * page_size),
        )
        items = [_row_dict(cursor, row) for row in cursor.fetchall()]
    return {"items": items, "total": total, "page": page, "page_size": page_size}


def get_transfer(companyid: str, receiptno: str):
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            f"""SELECT companyid, companyname, receiptno, receptdate,
                      fromwarehousecode, fromwarehousename, towarehousecode, towarehousename,
                      manager, description, subulyn, created_at, updated_at,
                      {user_name_sql('inoutmove01t.created_by')} AS created_by,
                      {user_name_sql('inoutmove01t.updated_by')} AS updated_by
               FROM inoutmove01t WHERE companyid = %s AND receiptno = %s""",
            (companyid, receiptno),
        )
        row = cursor.fetchone()
        if not row:
            return None
        header = _row_dict(cursor, row)
        cursor.execute(
            f"""SELECT detail.lineno, detail.stocksourcetype, detail.stocksourceno, detail.stocksourceline,
                      detail.itemcode, detail.itemname, detail.productname,
                      detail.materialname, detail.surfacename, detail.myrtle,
                      detail.thickness, detail.width, detail.length,
                      detail.qty, detail.qtyunit, detail.weight,
                      stock.customname AS sourcecustomname,
                      stock.receiptdate AS sourcereceiptdate,
                      detail.created_at, detail.updated_at,
                      {user_name_sql('detail.created_by')} AS created_by,
                      {user_name_sql('detail.updated_by')} AS updated_by
               FROM inoutmove02t AS detail
               LEFT JOIN CurrentStock01t AS stock
                 ON stock.companyid = detail.companyid
                AND stock.sourcetype = detail.stocksourcetype
                AND stock.sourceno = detail.stocksourceno
                AND stock.sourceline = detail.stocksourceline
               WHERE detail.companyid = %s AND detail.receiptno = %s
               ORDER BY detail.lineno""",
            (companyid, receiptno),
        )
        header["items"] = [_row_dict(cursor, detail) for detail in cursor.fetchall()]
    return header


def _next_receiptno(cursor, companyid: str) -> str:
    prefix = f"MV{datetime.now(ZoneInfo('Asia/Seoul')).strftime('%Y%m%d')}"
    cursor.execute(
        "SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))",
        (f"inoutmove-sequence:{companyid}:{prefix}",),
    )
    start = len(prefix) + 1
    cursor.execute(
        """SELECT COALESCE(MAX(
               CASE WHEN substring(receiptno FROM %s) ~ '^[0-9]{1,18}$'
                    THEN substring(receiptno FROM %s)::bigint ELSE 0 END
           ), 0)
           FROM inoutmove01t WHERE companyid = %s AND LEFT(receiptno, %s) = %s
        """,
        (start, start, companyid, len(prefix), prefix),
    )
    return f"{prefix}{cursor.fetchone()[0] + 1:05d}"


def save_transfer(companyid: str, companyname: str, payload: dict, actor: str | None = None):
    receiptno = ""
    try:
        with _connect() as connection, connection.cursor() as cursor:
            # Coordinate with inbound, outbound, and processing stock mutations for this tenant.
            cursor.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"stand-stock:{companyid}",))
            codes = [payload["fromwarehousecode"], payload["towarehousecode"]]
            cursor.execute(
                """SELECT code, code_name FROM CodeMaster01t
                   WHERE companyid = %s AND groupcode = 'WAREHOUSE'
                     AND UPPER(BTRIM(use_yn)) = 'Y' AND code = ANY(%s)""",
                (companyid, codes),
            )
            warehouse_names = {str(code).strip(): str(name or code).strip() for code, name in cursor.fetchall()}
            if len(warehouse_names) != 2:
                raise ValueError("출발 창고와 도착 창고를 현재 회사의 사용 중인 창고에서 선택해 주세요.")
            cursor.execute(
                """SELECT code, code_name FROM CodeMaster01t
                   WHERE companyid = %s AND groupcode = 'PRICE_UNIT'""",
                (companyid,),
            )
            price_unit_names = {str(code).strip(): str(name or "").strip() for code, name in cursor.fetchall()}
            from_code, to_code = payload["fromwarehousecode"], payload["towarehousecode"]
            if from_code == to_code:
                raise ValueError("출발 창고와 도착 창고는 달라야 합니다.")
            receiptno = _next_receiptno(cursor, companyid)
            cursor.execute(
                """INSERT INTO inoutmove01t
                   (companyid, companyname, receiptno, receptdate,
                    fromwarehousecode, fromwarehousename, towarehousecode, towarehousename,
                    manager, description, subulyn, created_by)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'Y', %s)""",
                (companyid, companyname, receiptno, payload["receptdate"], from_code,
                 warehouse_names[from_code], to_code, warehouse_names[to_code],
                 payload.get("manager") or None, payload.get("description") or None, actor or None),
            )

            ordered_items = sorted(payload["items"], key=lambda item: (
                item["stocksourcetype"], item["stocksourceno"], item["stocksourceline"],
            ))
            details = []
            ledger_rows = []
            stock_transfers = []
            for lineno, item in enumerate(ordered_items, start=1):
                cursor.execute(
                    """SELECT sourcetype, sourceno, sourceline, receiptdate, customcode, customname,
                              itemcode, itemname, productname, materialcode, materialname,
                              surfacecode, surfacename, myrtle, thickness, width, length,
                              qty, qtyunit, weight, unit, unitprice, warehousecode, warehousecodename,
                              originalqty, originalweight, origintype, originno, originline
                       FROM CurrentStock01t
                       WHERE companyid = %s AND sourcetype = %s AND sourceno = %s AND sourceline = %s
                       FOR UPDATE""",
                    (companyid, item["stocksourcetype"], item["stocksourceno"], item["stocksourceline"]),
                )
                row = cursor.fetchone()
                if not row:
                    raise ValueError("선택한 현재고가 이미 변경되었거나 다른 회사의 재고입니다. 현재고를 다시 조회해 주세요.")
                stock = _row_dict(cursor, row)
                if stock["warehousecode"] != from_code:
                    raise ValueError(f"{stock['itemname']} 재고의 현재 창고가 선택한 출발 창고와 다릅니다.")
                available_qty = Decimal(str(stock["qty"] or 0))
                available_weight = Decimal(str(stock["weight"] or 0))
                qty = Decimal(str(item["qty"]))
                if available_qty <= 0 or available_weight <= 0:
                    raise ValueError(f"{stock['itemname']} 재고의 현재고 수량 또는 중량이 없어 이전할 수 없습니다. 현재고를 다시 조회해 주세요.")
                if qty > available_qty:
                    raise ValueError(f"{stock['itemname']} 이전 수량이 현재고 수량을 초과했습니다.")
                weight = (available_weight * qty / available_qty).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)
                if weight <= 0:
                    raise ValueError(f"{stock['itemname']} 이전 중량이 0이 되어 이전할 수 없습니다.")
                unit_code = str(stock["unit"] or "").strip()
                supplyamt, vat, unitamt = _calculate_transfer_amount(
                    qty, Decimal(str(stock["length"] or 0)), weight,
                    stock["unitprice"], unit_code, price_unit_names.get(unit_code, unit_code),
                )

                details.append((
                    companyid, companyname, receiptno, lineno,
                    stock["sourcetype"], stock["sourceno"], stock["sourceline"],
                    stock["itemcode"], stock["itemname"], stock["productname"],
                    stock["surfacecode"], stock["surfacename"], stock["materialcode"], stock["materialname"], stock["myrtle"],
                    stock["thickness"], stock["width"], stock["length"], qty, stock["qtyunit"], weight,
                    actor or None,
                ))
                stock_transfers.append((lineno, item, stock, qty, weight))
                for movement_type, movement_line, warehouse_code, warehouse_name in (
                    ("OUT", lineno * 2 - 1, from_code, warehouse_names[from_code]),
                    ("IN", lineno * 2, to_code, warehouse_names[to_code]),
                ):
                    ledger_rows.append((
                        companyid, companyname, payload["receptdate"], movement_type,
                        receiptno, movement_line, stock["customcode"], stock["customname"],
                        stock["itemcode"], stock["itemname"], stock["productname"],
                        stock["materialcode"], stock["materialname"], stock["surfacecode"], stock["surfacename"],
                        stock["myrtle"], payload.get("manager") or None,
                        stock["thickness"], stock["width"], stock["length"], qty,
                        stock["qtyunit"], weight, warehouse_code, warehouse_name,
                        stock["unit"], stock["unitprice"], supplyamt, vat, unitamt,
                        actor or None,
                    ))

            execute_values(
                cursor,
                """INSERT INTO inoutmove02t
                   (companyid, companyname, receiptno, lineno, stocksourcetype, stocksourceno,
                    stocksourceline, itemcode, itemname, productname, surfacecode, surfacename,
                    materialcode, materialname, myrtle, thickness, width, length, qty, qtyunit, weight,
                    created_by)
                   VALUES %s""",
                details,
                page_size=1000,
            )
            execute_values(
                cursor,
                """INSERT INTO Iniop01t
                   (companyid, companyname, iniodate, iniotype, receiptno, lineno,
                    customcode, customname, itemcode, itemname, productname,
                    materialcode, materialname, surfacecode, surfacename, myrtle, manager,
                    thickness, width, length, qty, qtyunit, weight, warehousecode, warehousecodename,
                    unit, unitprice, supplyamt, vat, unitamt, created_by)
                   VALUES %s""",
                ledger_rows,
                page_size=1000,
            )
            for lineno, item, stock, moved_qty, moved_weight in stock_transfers:
                movement_line = lineno * 2
                # 원래 출처: 이전 전 재고에 적혀 있으면 그대로, 비어 있으면 이전 전 재고 자신 (여러 번 옮겨도 처음 입고·기초재고·가공을 가리킴)
                origin = ((stock["origintype"], stock["originno"], stock["originline"]) if stock.get("originno")
                          else (stock["sourcetype"], stock["sourceno"], stock["sourceline"]))
                cursor.execute(
                    """INSERT INTO CurrentStock01t
                       (companyid, companyname, customcode, customname, sourcetype, sourceno, sourceline,
                        receiptdate, itemcode, itemname, productname, materialcode, materialname,
                        surfacecode, surfacename, myrtle, manager, thickness, width, length,
                        originalqty, qty, qtyunit, originalweight, weight, unit, unitprice,
                        warehousecode, warehousecodename, created_by, origintype, originno, originline)
                       VALUES (%s, %s, %s, %s, 'INBOUND', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                               %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                    (companyid, companyname, stock["customcode"], stock["customname"], receiptno, movement_line,
                     payload["receptdate"], stock["itemcode"], stock["itemname"], stock["productname"],
                     stock["materialcode"], stock["materialname"], stock["surfacecode"], stock["surfacename"],
                     stock["myrtle"], payload.get("manager") or None, stock["thickness"], stock["width"], stock["length"],
                     moved_qty, moved_qty, stock["qtyunit"], moved_weight, moved_weight, stock["unit"], stock["unitprice"],
                     to_code, warehouse_names[to_code], actor or None, *origin),
                )
                cursor.execute(
                    """UPDATE CurrentStock01t SET qty = qty - %s, weight = weight - %s,
                              updated_at = CURRENT_TIMESTAMP, updated_by = COALESCE(%s, updated_by)
                       WHERE companyid = %s AND sourcetype = %s AND sourceno = %s AND sourceline = %s
                         AND warehousecode = %s AND qty >= %s AND weight >= %s""",
                    (moved_qty, moved_weight, actor or None, companyid, item["stocksourcetype"],
                     item["stocksourceno"], item["stocksourceline"], from_code, moved_qty, moved_weight),
                )
                if cursor.rowcount != 1:
                    raise ValueError("현재고 수량 차감에 실패했습니다. 현재고를 다시 조회해 주세요.")
        return {"receiptno": receiptno, "saved_count": len(payload["items"])}
    except ValueError:
        raise
    except IntegrityError as error:
        logger.exception("Inventory transfer integrity error")
        if "inoutmove01t" in str(error).lower() or "duplicate key" in str(error).lower():
            raise ValueError("재고이전 전표번호가 중복되었습니다. 다시 저장해 주세요.") from error
        raise
    except Exception:
        logger.exception("Failed to save inventory transfer")
        raise


def delete_transfer(companyid: str, receiptno: str, actor: str | None = None):
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"stand-stock:{companyid}",))
        cursor.execute(
            """SELECT fromwarehousecode, fromwarehousename, towarehousecode
               FROM inoutmove01t WHERE companyid = %s AND receiptno = %s FOR UPDATE""",
            (companyid, receiptno),
        )
        header_row = cursor.fetchone()
        if not header_row:
            return 0
        from_code, from_name, to_code = header_row
        cursor.execute(
            """SELECT lineno, stocksourcetype, stocksourceno, stocksourceline,
                      qty, weight FROM inoutmove02t
               WHERE companyid = %s AND receiptno = %s ORDER BY lineno
               FOR UPDATE""",
            (companyid, receiptno),
        )
        details = cursor.fetchall()
        if not details:
            raise ValueError("재고이전 상세가 없어 삭제할 수 없습니다.")
        cursor.execute(
            """SELECT COUNT(*) FROM Iniop01t
               WHERE companyid = %s AND receiptno = %s AND iniotype IN ('IN', 'OUT')""",
            (companyid, receiptno),
        )
        if cursor.fetchone()[0] != len(details) * 2:
            raise ValueError("재고이전 수불 내역이 완전하지 않아 삭제할 수 없습니다.")
        for lineno, source_type, source_no, source_line, qty, weight in details:
            cursor.execute(
                """SELECT qty, weight, originalqty, originalweight, warehousecode
                   FROM CurrentStock01t
                   WHERE companyid = %s AND sourcetype = %s AND sourceno = %s AND sourceline = %s
                   FOR UPDATE""",
                (companyid, source_type, source_no, source_line),
            )
            source_stock = cursor.fetchone()
            if not source_stock:
                raise ValueError("이전한 원천 재고가 없어 전표를 안전하게 되돌릴 수 없습니다.")
            source_qty, source_weight, original_qty, original_weight, source_warehouse = source_stock

            moved_stock_line = lineno * 2
            cursor.execute(
                """SELECT qty, weight, warehousecode FROM CurrentStock01t
                   WHERE companyid = %s AND sourcetype = 'INBOUND' AND sourceno = %s AND sourceline = %s
                   FOR UPDATE""",
                (companyid, receiptno, moved_stock_line),
            )
            moved_stock = cursor.fetchone()
            if not moved_stock:
                # Older transfers moved the original source row between warehouses in place.
                if (source_warehouse == to_code and Decimal(str(source_qty or 0)) == Decimal(str(qty))
                        and Decimal(str(source_weight or 0)) == Decimal(str(weight))):
                    cursor.execute(
                        """UPDATE CurrentStock01t SET warehousecode = %s, warehousecodename = %s,
                                  updated_at = CURRENT_TIMESTAMP, updated_by = COALESCE(%s, updated_by)
                           WHERE companyid = %s AND sourcetype = %s AND sourceno = %s
                             AND sourceline = %s AND warehousecode = %s""",
                        (from_code, from_name, actor or None, companyid, source_type, source_no, source_line, to_code),
                    )
                    if cursor.rowcount != 1:
                        raise ValueError("현재고를 원래 창고로 되돌리지 못했습니다.")
                    continue
                raise ValueError("이전된 입고 현재고가 없어 전표를 안전하게 되돌릴 수 없습니다.")
            moved_qty, moved_weight, moved_warehouse = moved_stock
            if (moved_warehouse != to_code or Decimal(str(moved_qty or 0)) != Decimal(str(qty))
                    or Decimal(str(moved_weight or 0)) != Decimal(str(weight))):
                raise ValueError("이전된 재고가 출고·가공·추가 이동되어 전표를 삭제할 수 없습니다.")
            if (source_warehouse != from_code
                    or Decimal(str(source_qty or 0)) + Decimal(str(qty)) > Decimal(str(original_qty or 0))
                    or Decimal(str(source_weight or 0)) + Decimal(str(weight)) > Decimal(str(original_weight or 0))):
                raise ValueError("원천 재고가 변경되어 이전 전 상태로 되돌릴 수 없습니다.")

            cursor.execute(
                """UPDATE CurrentStock01t SET qty = qty + %s, weight = weight + %s,
                          updated_at = CURRENT_TIMESTAMP, updated_by = COALESCE(%s, updated_by)
                   WHERE companyid = %s AND sourcetype = %s AND sourceno = %s AND sourceline = %s
                     AND warehousecode = %s""",
                (qty, weight, actor or None, companyid, source_type, source_no, source_line, from_code),
            )
            if cursor.rowcount != 1:
                raise ValueError("현재고를 원래 창고로 되돌리지 못했습니다.")
            cursor.execute(
                """DELETE FROM CurrentStock01t
                   WHERE companyid = %s AND sourcetype = 'INBOUND' AND sourceno = %s AND sourceline = %s""",
                (companyid, receiptno, moved_stock_line),
            )
            if cursor.rowcount != 1:
                raise ValueError("이전된 입고 현재고를 삭제하지 못했습니다.")
        cursor.execute("DELETE FROM Iniop01t WHERE companyid = %s AND receiptno = %s AND iniotype IN ('IN', 'OUT')", (companyid, receiptno))
        cursor.execute("DELETE FROM inoutmove01t WHERE companyid = %s AND receiptno = %s", (companyid, receiptno))
        return 1
