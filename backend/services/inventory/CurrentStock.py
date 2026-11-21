import logging
from datetime import date, datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from services.ai.stock_links import ensure_not_linked
from services.inventory import stock_cost as stock_cost_module

# 원가단가(kg) = 남은 원가금액 ÷ 남은 중량 (화면 표시용, 다 쓴 재고는 빈 값)
LOT_COST_PRICE_SQL = "CASE WHEN stock.weight > 0 THEN ROUND(stock.costamt / stock.weight, 2) END"
import db as _shared_db
from psycopg2.extras import execute_values
from pydantic import BaseModel, Field, field_validator
import xlsxwriter


logger = logging.getLogger(__name__)

# Connections come from the single shared pool (backend/db.py).
_connect = _shared_db.connect


def _row_dict(cursor, row):
    return dict(zip((column[0] for column in cursor.description), row))


def user_name_sql(column: str) -> str:
    """SQL showing the user's name for an email column, falling back to the stored email
    (so rows stay readable after the user is deleted)."""
    return f"COALESCE((SELECT u.username FROM user01t u WHERE u.email = {column} LIMIT 1), {column})"


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


def _load_master_names(cursor, companyid: str, groupcode: str, values: list[str]) -> dict[str, str]:
    normalized_values = list(dict.fromkeys(str(value or "").strip() for value in values if str(value or "").strip()))
    if not normalized_values:
        return {}
    cursor.execute(
        """SELECT code, code_name FROM CodeMaster01t
           WHERE companyid = %s AND groupcode = %s
             AND (code = ANY(%s) OR code_name = ANY(%s))""",
        (companyid, groupcode, normalized_values, normalized_values),
    )
    names = {}
    for code, code_name in cursor.fetchall():
        name = str(code_name or code).strip()
        names[str(code).strip()] = name
        names[name] = name
    return names


def _insert_source_stock(cursor, companyid, companyname, source_type, source_no, source_line,
                         receipt_date, customcode, customname, movement, line,
                         quantity_unit_name: str, price_unit_name: str):
    if source_type not in {"OPENING", "INBOUND", "PROCESS"}:
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
         movement["qty"], movement["qty"], quantity_unit_name,
         movement["weight"], movement["weight"], price_unit_name or None,
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
            """UPDATE CurrentStock01t AS stock
               SET qty = stock.qty - %s,
                   weight = stock.weight - %s,
                   qtyunit = COALESCE((
                       SELECT code_name FROM CodeMaster01t
                       WHERE companyid = stock.companyid AND groupcode = 'QTY'
                         AND (code = stock.qtyunit OR code_name = stock.qtyunit)
                       LIMIT 1
                   ), stock.qtyunit),
                   unit = COALESCE((
                       SELECT code_name FROM CodeMaster01t
                       WHERE companyid = stock.companyid AND groupcode = 'PRICE_UNIT'
                         AND (code = stock.unit OR code_name = stock.unit)
                       LIMIT 1
                   ), stock.unit),
                      updated_at = CURRENT_TIMESTAMP
               WHERE stock.companyid = %s AND stock.sourcetype = %s
                 AND stock.sourceno = %s AND stock.sourceline = %s
                 AND stock.qty >= %s AND stock.weight >= %s""",
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
    created_by: str | None = None,
    updated_by: str | None = None,
):
    """created_by/updated_by: the user emails stored on the new ledger/stock rows (등록자/수정자).
    For an edited document pass the original creator and the editor. The acting user
    (updated_by or created_by) is also stamped as 수정자 on stock rows an OUT document draws from."""
    if iniotype not in {"ST", "IN", "OUT"}:
        raise ValueError("지원하지 않는 수불 유형입니다.")
    movements = [_normalized_movement(line) for line in lines]
    if not _uses_source_lines(cursor):
        raise ValueError("현재고 테이블에 원천 라인 구조가 적용되지 않았습니다.")
    quantity_unit_names = _load_master_names(
        cursor, companyid, "QTY", [movement["qtyunit"] for movement in movements],
    )
    price_unit_names = _load_master_names(
        cursor, companyid, "PRICE_UNIT", [line.get("unit") for line in lines],
    )

    # All lines are written with a fixed number of statements (instead of 2-3 per line).
    # Results are identical to the former line-by-line processing; the whole document
    # still succeeds or fails as one transaction.
    source_keys = []
    if iniotype == "OUT":
        for line in lines:
            source_key = (
                line.get("stocksourcetype"),
                line.get("stocksourceno"),
                int(line.get("stocksourceline") or 0),
            )
            if not all(source_key) or source_key[2] <= 0:
                raise ValueError("출고할 현재고 원천 구분·전표·순번이 필요합니다.")
            source_keys.append(source_key)
        source_metadata = _lock_source_rows(cursor, companyid, source_keys)
        # 줄마다 빠지는 원가: 같은 재고를 여러 줄이 쓰면 앞 줄이 뺀 뒤의 남은 원가·중량으로 계산 (끝전은 다 쓰는 줄이 가져감)
        remaining = {key: [meta["costamt"], meta["weight"], meta["expamt"], meta["feeamt"]] for key, meta in source_metadata.items()}
        for key, movement in zip(source_keys, movements):
            lot = remaining[key]
            cost, exp, fee = stock_cost_module.consume_parts(lot[0], lot[2], lot[3], lot[1], movement["weight"])
            lot[0] -= cost
            lot[1] -= movement["weight"]
            lot[2] -= exp
            lot[3] -= fee
            movement["costamt"], movement["expamt"], movement["feeamt"] = cost, exp, fee
    else:
        # 생긴 원가: 매입은 기타비용을 배부한 금액(그중 기타비용 몫 expamt)을 넘겨받고, 기초재고는 공급가
        for line, movement in zip(lines, movements):
            movement["costamt"] = Decimal(str(line["costamt"] if line.get("costamt") is not None else (line.get("supplyamt") or 0)))
            movement["expamt"] = Decimal(str(line.get("expamt") or 0))
            movement["feeamt"] = Decimal("0")

    ledger_rows = []
    stock_rows = []
    for line_no, movement in enumerate(movements, start=1):
        line = lines[line_no - 1]
        source_lineno = int(line.get("lineno") or line_no)
        movement_date = line.get("receptdate") or iniodate
        movement_customcode = line.get("customcode") or customcode
        movement_customname = line.get("customname") or customname
        metadata = line
        quantity_unit_name = quantity_unit_names.get(movement["qtyunit"], movement["qtyunit"])
        unit_text = str(line.get("unit") or "").strip()
        price_unit_name = price_unit_names.get(unit_text, unit_text)
        if iniotype == "OUT":
            metadata = {**line, **source_metadata[source_keys[line_no - 1]]}
            # Outbound manager belongs to the outbound header. Keep that value
            # for the movement ledger instead of replacing it with the source
            # stock's original manager.
            if "manager" in line:
                metadata["manager"] = line["manager"]
        ledger_rows.append((
            companyid, companyname, movement_date, iniotype, receiptno, source_lineno, movement_customcode, movement_customname or None,
            movement["itemcode"], movement["itemname"],
            (metadata.get("productname") or "").strip() or None,
            (metadata.get("materialcode") or "").strip(), (metadata.get("materialname") or "").strip(),
            (metadata.get("surfacecode") or "").strip() or None,
            (metadata.get("surfacename") or "").strip() or None,
            metadata.get("myrtle"), (metadata.get("manager") or "").strip() or None,
            movement["thickness"], movement["width"], movement["length"], movement["qty"],
            quantity_unit_name,
            movement["weight"], movement["warehousecode"],
            movement["warehousecodename"],
            price_unit_name or None,
            line.get("unitprice"), line.get("supplyamt"), line.get("vat"), line.get("unitamt"),
            created_by or None, updated_by or None,
            iniotype,  # 수불 상세구분: ST 기초 / IN 매입입고 / OUT 매출출고
            movement["costamt"], movement["expamt"], movement["feeamt"],
        ))
        if iniotype != "OUT":
            source_type = "OPENING" if iniotype == "ST" else "INBOUND"
            if not receiptno or source_lineno <= 0:
                raise ValueError("현재고 원천전표와 상세 순번을 확인해 주세요.")
            stock_rows.append((
                companyid, companyname, movement_customcode or None, movement_customname or None,
                source_type, receiptno, source_lineno, movement_date,
                movement["itemcode"], movement["itemname"],
                (line.get("productname") or "").strip() or None,
                (line.get("materialcode") or "").strip(), (line.get("materialname") or "").strip(),
                (line.get("surfacecode") or "").strip() or None,
                (line.get("surfacename") or "").strip() or None,
                line.get("myrtle"), (line.get("manager") or "").strip() or None,
                movement["thickness"], movement["width"], movement["length"],
                movement["qty"], movement["qty"], quantity_unit_name,
                movement["weight"], movement["weight"], price_unit_name or None,
                line.get("unitprice"), movement["warehousecode"], movement["warehousecodename"],
                created_by or None, updated_by or None,
                source_type, movement["costamt"], movement["expamt"], movement["feeamt"],
            ))

    execute_values(
        cursor,
        """INSERT INTO Iniop01t
               (companyid, companyname, iniodate, iniotype, receiptno, lineno, customcode, customname,
                itemcode, itemname, productname, materialcode, materialname, surfacecode, surfacename,
                myrtle, manager, thickness, width, length, qty, qtyunit, weight,
                warehousecode, warehousecodename, unit, unitprice, supplyamt, vat, unitamt,
                created_by, updated_by, iniokind, costamt, expamt, feeamt)
           VALUES %s""",
        ledger_rows,
        page_size=1000,
    )
    if iniotype == "OUT":
        _apply_source_stock_changes(cursor, companyid, source_keys, movements, reverse=False,
                                    actor=updated_by or created_by)
    else:
        inserted = execute_values(
            cursor,
            """INSERT INTO CurrentStock01t
                   (companyid, companyname, customcode, customname, sourcetype, sourceno, sourceline,
                    receiptdate, itemcode, itemname, productname, materialcode, materialname,
                    surfacecode, surfacename, myrtle, manager, thickness, width, length, originalqty, qty, qtyunit,
                    originalweight, weight, unit, unitprice, warehousecode, warehousecodename,
                    created_by, updated_by, stockkind, costamt, expamt, feeamt)
               VALUES %s
               ON CONFLICT (companyid, sourcetype, sourceno, sourceline) DO NOTHING
               RETURNING sourceline""",
            stock_rows,
            page_size=1000,
            fetch=True,
        )
        _raise_first_missing(
            [row[6] for row in stock_rows], [row[0] for row in inserted],
            lambda line_no: (
                f"이미 현재고에 반영된 원천 라인입니다: "
                f"{'OPENING' if iniotype == 'ST' else 'INBOUND'} / {receiptno} / {line_no}"
            ),
        )
    return len(movements)


def _raise_first_missing(expected: list, returned: list, message):
    """Raise for the first expected key (in document order) that the statement did not affect."""
    if len(returned) == len(expected):
        return
    remaining = list(returned)
    for key in expected:
        if key in remaining:
            remaining.remove(key)
        else:
            raise ValueError(message(key))
    raise ValueError(message(expected[-1]))


def _lock_source_rows(cursor, companyid: str, source_keys: list[tuple]) -> dict:
    """Lock every referenced stock source row once (sorted order) and return its metadata."""
    unique_keys = sorted(set(source_keys))
    cursor.execute(
        """SELECT sourcetype, sourceno, sourceline,
                  productname, materialcode, materialname, surfacecode, surfacename, myrtle, manager, costamt, expamt, feeamt, weight
           FROM CurrentStock01t
           WHERE companyid = %s
             AND (sourcetype, sourceno, sourceline) IN (
                 SELECT * FROM unnest(%s::varchar[], %s::varchar[], %s::integer[])
             )
           ORDER BY sourcetype, sourceno, sourceline
           FOR UPDATE""",
        (companyid, [key[0] for key in unique_keys], [key[1] for key in unique_keys],
         [key[2] for key in unique_keys]),
    )
    columns = [column[0] for column in cursor.description]
    found = {}
    for row in cursor.fetchall():
        record = dict(zip(columns, row))
        key = (record.pop("sourcetype"), record.pop("sourceno"), record.pop("sourceline"))
        found[key] = record
    for key in source_keys:
        if key not in found:
            raise ValueError("선택한 원천 재고 행을 현재 회사에서 찾을 수 없습니다.")
    return found


def _lock_rows_sorted(cursor, companyid: str, keys: list[tuple]):
    """Row-lock existing stock source rows in sorted key order (missing rows are ignored)."""
    if not keys:
        return
    unique_keys = sorted(set(keys))
    cursor.execute(
        """SELECT 1 FROM CurrentStock01t
           WHERE companyid = %s
             AND (sourcetype, sourceno, sourceline) IN (
                 SELECT * FROM unnest(%s::varchar[], %s::varchar[], %s::integer[])
             )
           ORDER BY sourcetype, sourceno, sourceline
           FOR UPDATE""",
        (companyid, [key[0] for key in unique_keys], [key[1] for key in unique_keys],
         [key[2] for key in unique_keys]),
    )


def _apply_source_stock_changes(cursor, companyid: str, source_keys: list[tuple],
                                movements: list[dict], reverse: bool, actor: str | None = None):
    """Subtract (or restore) quantities on stock source rows with one statement.

    Several lines may draw from the same source row, so amounts are summed per row first.
    Because every amount is positive, checking the summed amount once is equivalent to the
    former line-by-line checks.
    """
    totals: dict[tuple, list[Decimal]] = {}
    for key, movement in zip(source_keys, movements):
        amount = totals.setdefault(key, [Decimal("0"), Decimal("0"), Decimal("0"), Decimal("0"), Decimal("0")])
        amount[0] += Decimal(str(movement["qty"]))
        amount[1] += Decimal(str(movement["weight"]))
        # 빠진(복원할) 원가금액과 그중 기타비용·가공금액 몫 — 수불장에 적힌 값
        amount[2] += Decimal(str(movement.get("costamt") or 0))
        amount[3] += Decimal(str(movement.get("expamt") or 0))
        amount[4] += Decimal(str(movement.get("feeamt") or 0))
    values = [(key[0], key[1], key[2], *amounts) for key, amounts in totals.items()]
    # Lock the target rows in a fixed (sorted) order first so concurrent saves never deadlock.
    _lock_rows_sorted(cursor, companyid, list(totals))
    if reverse:
        sql = """UPDATE CurrentStock01t AS stock
                 SET qty = stock.qty + v.qty, weight = stock.weight + v.weight, costamt = stock.costamt + v.cost,
                     expamt = stock.expamt + v.exp, feeamt = stock.feeamt + v.fee,
                     updated_at = CURRENT_TIMESTAMP, updated_by = COALESCE({actor}, stock.updated_by)
                 FROM (VALUES %s) AS v(sourcetype, sourceno, sourceline, qty, weight, cost, exp, fee)
                 WHERE stock.companyid = {companyid} AND stock.sourcetype = v.sourcetype
                   AND stock.sourceno = v.sourceno AND stock.sourceline = v.sourceline
                   AND stock.qty + v.qty <= stock.originalqty
                   AND stock.weight + v.weight <= stock.originalweight
                 RETURNING stock.sourcetype, stock.sourceno, stock.sourceline"""
    else:
        sql = """UPDATE CurrentStock01t AS stock
                 SET qty = stock.qty - v.qty,
                     weight = stock.weight - v.weight,
                     costamt = stock.costamt - v.cost,
                     expamt = stock.expamt - v.exp, feeamt = stock.feeamt - v.fee,
                     qtyunit = COALESCE((
                         SELECT code_name FROM CodeMaster01t
                         WHERE companyid = stock.companyid AND groupcode = 'QTY'
                           AND (code = stock.qtyunit OR code_name = stock.qtyunit)
                         LIMIT 1
                     ), stock.qtyunit),
                     unit = COALESCE((
                         SELECT code_name FROM CodeMaster01t
                         WHERE companyid = stock.companyid AND groupcode = 'PRICE_UNIT'
                           AND (code = stock.unit OR code_name = stock.unit)
                         LIMIT 1
                     ), stock.unit),
                     updated_at = CURRENT_TIMESTAMP, updated_by = COALESCE({actor}, stock.updated_by)
                 FROM (VALUES %s) AS v(sourcetype, sourceno, sourceline, qty, weight, cost, exp, fee)
                 WHERE stock.companyid = {companyid} AND stock.sourcetype = v.sourcetype
                   AND stock.sourceno = v.sourceno AND stock.sourceline = v.sourceline
                   AND stock.qty >= v.qty AND stock.weight >= v.weight
                 RETURNING stock.sourcetype, stock.sourceno, stock.sourceline"""
    sql = sql.replace("{companyid}", cursor.mogrify("%s", (companyid,)).decode().replace("%", "%%"))
    sql = sql.replace("{actor}", cursor.mogrify("%s::varchar", (actor or None,)).decode().replace("%", "%%"))
    changed = execute_values(
        cursor, sql, values,
        template="(%s::varchar, %s::varchar, %s::integer, %s::numeric, %s::numeric, %s::numeric, %s::numeric, %s::numeric)",
        page_size=1000, fetch=True,
    )
    if len(changed) != len(values):
        raise ValueError("선택된 원천 재고 라인의 잔량 또는 복원 가능 수량을 확인해 주세요.")


def reverse_document(cursor, companyid: str, iniotype: str, receiptno: str, actor: str | None = None):
    cursor.execute(
        """SELECT companyname, lineno, itemcode, itemname, thickness, width, length, qty, qtyunit, weight,
                  warehousecode, warehousecodename, costamt, expamt, feeamt
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
    # Restore / delete all lines with a fixed number of statements (same result as before).
    if iniotype == "OUT":
        cursor.execute(
            """SELECT lineno, stocksourcetype, stocksourceno, stocksourceline
               FROM Outbound02t
               WHERE companyid = %s AND receiptno = %s AND lineno = ANY(%s)
               ORDER BY lineno
               FOR UPDATE""",
            (companyid, receiptno, [movement["lineno"] for movement in movements]),
        )
        links = {row[0]: (row[1], row[2], row[3]) for row in cursor.fetchall()}
        source_keys = []
        for movement in movements:
            source_key = links.get(movement["lineno"])
            if not source_key or not all(source_key) or int(source_key[2]) <= 0:
                raise ValueError("출고 상세에서 원천 재고 연결 정보를 찾을 수 없습니다.")
            source_keys.append((source_key[0], source_key[1], int(source_key[2])))
        _apply_source_stock_changes(cursor, companyid, source_keys, movements, reverse=True, actor=actor)
    else:
        source_type = "OPENING" if iniotype == "ST" else "INBOUND"
        source_lines = [int(movement["lineno"]) for movement in movements]
        _lock_rows_sorted(cursor, companyid, [(source_type, receiptno, line_no) for line_no in source_lines])
        # 주문에 연결됐거나 확정 계획에 잡힌 재고는 지우지 않는다 (연결·계획이 사라진 재고를 가리키지 않게)
        ensure_not_linked(cursor, companyid, {(source_type, receiptno, line_no) for line_no in source_lines}, action="삭제")
        cursor.execute(
            """DELETE FROM CurrentStock01t
               WHERE companyid = %s AND sourcetype = %s AND sourceno = %s
                 AND sourceline = ANY(%s)
                 AND qty = originalqty AND weight = originalweight
               RETURNING sourceline""",
            (companyid, source_type, receiptno, source_lines),
        )
        _raise_first_missing(
            source_lines, [row[0] for row in cursor.fetchall()],
            lambda line_no: f"출고 이력이 있거나 현재고 원천 라인이 없습니다: {source_type} / {receiptno} / {line_no}",
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
        quantity_unit_names = _load_master_names(
            cursor, companyid, "QTY", [item[-1] for item in requested],
        )
        requested = [
            (*item[:-1], quantity_unit_names.get(item[-1], item[-1]))
            for item in requested
        ]
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
                              product_search="", warehouse_search="", receipt_search="", date_from=None, date_to=None,
                              remark_search=""):
    where = ["stock.companyid = %s"]
    params = [companyid]
    if source_lines:
        if not include_zero:
            where.append("(stock.qty > 0 OR stock.weight > 0)")
        if sourcetype.strip():
            # 재고구분(기초/입고/가공/이동). 가공·이동 재고도 sourcetype 은 INBOUND 이므로 stockkind 로 거른다.
            where.append("stock.stockkind = %s")
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
        if receipt_search.strip():
            where.append("stock.sourceno ILIKE %s")
            params.append(f"%{receipt_search.strip()}%")
        if remark_search.strip():
            # 비고 부분 검색 (trigram 인덱스 ix_currentstock01t_remark_trgm)
            where.append("stock.remark ILIKE %s")
            params.append(f"%{remark_search.strip()}%")
    elif date_from or date_to or receipt_search.strip() or remark_search.strip():
        # The legacy aggregate table has no source receipt date to filter by.
        where.append("FALSE")
    if item_search.strip():
        where.append("(stock.itemcode ILIKE %s OR stock.itemname ILIKE %s OR stock.productname ILIKE %s)")
        params.extend([f"%{item_search.strip()}%", f"%{item_search.strip()}%", f"%{item_search.strip()}%"])
    if product_search.strip():
        where.append("stock.productname ILIKE %s")
        params.append(f"%{product_search.strip()}%")
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
        "COALESCE(price_unit.code_name, stock.unit) AS unit, stock.unitprice, stock.remark"
        if source_lines else
        "NULL::text AS sourcetype, NULL::text AS sourceno, NULL::integer AS sourceline, "
        "NULL::date AS receiptdate, NULL::text AS customcode, NULL::text AS customname, "
        "stock.qty AS originalqty, stock.weight AS originalweight, "
        "NULL::text AS unit, NULL::numeric AS unitprice, NULL::text AS remark"
    )
    # 엑셀은 칸 이름(EXCEL_COLUMNS)으로 값을 찾으므로 순서는 자유
    cost_fields = (
        ", stock.stockkind, " + LOT_COST_PRICE_SQL + " AS costprice, stock.costamt AS stockamt, "
        "stock.costamt - stock.expamt - stock.feeamt AS realamt, stock.expamt, stock.feeamt"
        if source_lines else
        ", NULL::text AS stockkind, NULL::numeric AS costprice, NULL::numeric AS stockamt, "
        "NULL::numeric AS realamt, NULL::numeric AS expamt, NULL::numeric AS feeamt"
    )
    manager_field = (
        # 이 재고를 판 매출 줄 중 가장 최근 전표의 담당자. 원천재고 인덱스(ix_outbound02t_stock_source)로 이 재고의
        # 매출 줄만 먼저 찾고(OFFSET 0 으로 고정) 그다음 정렬한다 → 50만 행에서도 행당 인덱스 조회 1번.
        "COALESCE((SELECT recent.manager FROM ("
        "SELECT NULLIF(BTRIM(header.manager), '') AS manager, header.receptdate, header.receiptno, outbound_detail.lineno "
        "FROM Outbound02t AS outbound_detail "
        "JOIN Outbound01t AS header "
        "ON header.companyid = outbound_detail.companyid "
        "AND header.receiptno = outbound_detail.receiptno "
        "WHERE outbound_detail.companyid = stock.companyid "
        "AND outbound_detail.stocksourcetype = stock.sourcetype "
        "AND outbound_detail.stocksourceno = stock.sourceno "
        "AND outbound_detail.stocksourceline = stock.sourceline "
        "OFFSET 0) AS recent "
        "WHERE recent.manager IS NOT NULL "
        "ORDER BY recent.receptdate DESC, recent.receiptno DESC, recent.lineno DESC "
        "LIMIT 1), stock.manager) AS manager, "
        if source_lines else "stock.manager, "
    )
    return (
        f"{source_fields}, stock.itemcode, stock.itemname, stock.productname, stock.materialcode, "
        "stock.materialname, stock.surfacecode, stock.surfacename, stock.myrtle, "
        f"{manager_field}"
        "stock.thickness, stock.width, "
        "stock.length, stock.qty, COALESCE(qty_code.code_name, stock.qtyunit) AS qtyunit, "
        "stock.weight, stock.warehousecode, stock.warehousecodename, "
        "stock.created_at, stock.updated_at, "
        f"{user_name_sql('stock.created_by')} AS created_by, {user_name_sql('stock.updated_by')} AS updated_by"
        f"{cost_fields}"
    )


class StockRemarkItem(BaseModel):
    sourcetype: str = Field(min_length=1, max_length=20)
    sourceno: str = Field(min_length=1, max_length=100)
    sourceline: int = Field(ge=0)
    remark: str = Field(default="", max_length=500)

    @field_validator("sourcetype", "sourceno", "remark")
    @classmethod
    def strip_text(cls, value: str) -> str:
        return value.strip()


class StockRemarkSaveRequest(BaseModel):
    items: list[StockRemarkItem] = Field(min_length=1, max_length=1000)


def save_lot_remarks(companyid: str, items: list[dict], actor: str | None = None) -> int:
    """현재고 비고만 저장한다 (수량 · 원가 · updated_at 은 건드리지 않는다). 여러 줄을 한 문장으로."""
    keys = [(item["sourcetype"].upper(), item["sourceno"], int(item["sourceline"])) for item in items]
    if len(set(keys)) != len(keys):
        raise ValueError("같은 재고의 비고가 중복되었습니다.")
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """UPDATE CurrentStock01t AS stock
               SET remark = NULLIF(v.remark, ''), remark_updated_at = CURRENT_TIMESTAMP, remark_updated_by = %s
               FROM unnest(%s::text[], %s::text[], %s::integer[], %s::text[]) AS v(sourcetype, sourceno, sourceline, remark)
               WHERE stock.companyid = %s AND stock.sourcetype = v.sourcetype
                 AND stock.sourceno = v.sourceno AND stock.sourceline = v.sourceline""",
            (actor or None, [key[0] for key in keys], [key[1] for key in keys], [key[2] for key in keys],
             [item["remark"] for item in items], companyid),
        )
        if cursor.rowcount != len(items):
            raise ValueError("일부 재고를 찾을 수 없습니다 (삭제되었거나 다시 만들어졌습니다). 다시 조회한 뒤 저장해 주세요.")
        return cursor.rowcount


def list_current_stock(companyid: str, page: int, page_size: int, **filters):
    with _connect() as connection, connection.cursor() as cursor:
        source_lines = _uses_source_lines(cursor)
        where, params = _current_stock_conditions(companyid, source_lines=source_lines, **filters)
        cursor.execute(f"SELECT COUNT(*) FROM CurrentStock01t AS stock WHERE {where}", params)
        total = cursor.fetchone()[0]
        order_sql = ('stock.receiptdate ASC, stock.sourcetype, stock.sourceno, stock.sourceline' if source_lines
                     else 'stock.itemcode, stock.thickness, stock.width, stock.length, stock.warehousecode, stock.qtyunit')
        # 조건·정렬로 이 쪽의 행만 먼저 고른 뒤, 그 행에만 코드명·담당자·사용자명을 붙인다
        # (뒤 쪽으로 가도 건너뛴 행에는 담당자 조회를 하지 않는다)
        cursor.execute(
            f"""SELECT {_current_stock_select(source_lines)}
                FROM (SELECT stock.* FROM CurrentStock01t AS stock
                      WHERE {where}
                      ORDER BY {order_sql}
                      LIMIT %s OFFSET %s) AS stock
                LEFT JOIN CodeMaster01t AS qty_code
                  ON qty_code.companyid = stock.companyid
                 AND qty_code.groupcode = 'QTY'
                 AND qty_code.code = stock.qtyunit
                LEFT JOIN CodeMaster01t AS price_unit
                  ON price_unit.companyid = stock.companyid
                 AND price_unit.groupcode = 'PRICE_UNIT'
                 AND price_unit.code = stock.unit
                ORDER BY {order_sql}""",
            (*params, page_size, (page - 1) * page_size),
        )
        items = [_row_dict(cursor, row) for row in cursor.fetchall()]
    return {"items": items, "total": total, "page": page, "page_size": page_size}


# 엑셀: 행이 이만큼 이하면 메모리에서 바로 만든다 (임시파일로 나눠 쓰는 것보다 2~3배 빠름). 넘으면 메모리를 아끼려고 나눠 쓴다.
IN_MEMORY_EXCEL_ROWS = 60000


def _excel_options(cursor, count_sql: str, params) -> dict:
    cursor.execute(count_sql, params)
    return {"in_memory": True} if cursor.fetchone()[0] <= IN_MEMORY_EXCEL_ROWS else {"constant_memory": True}


# 현재고 엑셀 칸 (key = 조회 칸 이름, 제목, 형식). 화면과 같은 순서 + 코드 칸은 맨 뒤.
# 입력 단가(stock.unitprice)는 넣지 않는다 (재고 가치는 원가단가·재고금액).
EXCEL_COLUMNS = [
    ("stockkind", "재고구분", "kind"),
    ("receiptdate", "입고일자", "date"),
    ("warehousecodename", "창고명", "text"),
    ("itemname", "품명", "text"),
    ("materialname", "강종", "text"),
    ("surfacename", "표면", "text"),
    ("myrtle", "도금량(g/㎡)", "number"),
    ("thickness", "두께", "number"),
    ("width", "폭", "number"),
    ("length", "길이", "number"),
    ("qty", "현재수량", "number"),
    ("weight", "현재중량", "number"),
    ("customname", "매입처", "text"),
    ("productname", "제품번호", "text"),
    ("originalqty", "최초수량", "number"),
    ("originalweight", "최초중량", "number"),
    ("costprice", "원가단가(원/kg)", "number"),
    ("realamt", "매입가액", "number"),
    ("expamt", "매입 부대비", "number"),
    ("feeamt", "가공금액", "number"),
    ("stockamt", "재고금액", "number"),
    ("qtyunit", "수량단위", "text"),
    ("unit", "단가기준", "text"),
    ("manager", "담당자", "text"),
    ("sourceno", "원천전표", "text"),
    ("sourceline", "원천순번", "number"),
    ("created_at", "등록일자", "datetime"),
    ("created_by", "등록자", "text"),
    ("updated_at", "수정일자", "datetime"),
    ("updated_by", "수정자", "text"),
    ("remark", "비고", "text"),
    ("customcode", "매입처코드", "text"),
    ("itemcode", "품목코드", "text"),
    ("materialcode", "강종코드", "text"),
    ("surfacecode", "표면코드", "text"),
    ("warehousecode", "창고코드", "text"),
]


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
                LEFT JOIN CodeMaster01t AS price_unit
                  ON price_unit.companyid = stock.companyid
                 AND price_unit.groupcode = 'PRICE_UNIT'
                 AND price_unit.code = stock.unit
                WHERE {where}
                ORDER BY {('stock.receiptdate ASC, stock.sourcetype, stock.sourceno, stock.sourceline' if source_lines else 'stock.itemcode, stock.thickness, stock.width, stock.length, stock.warehousecode, stock.qtyunit')}"""
    headers = ["No.", *(title for _, title, _ in EXCEL_COLUMNS)]
    with _connect() as connection, connection.cursor() as cursor:
        options = _excel_options(cursor, f"SELECT COUNT(*) FROM CurrentStock01t AS stock WHERE {where}", params)
    workbook = xlsxwriter.Workbook(output_path, options)
    worksheet = workbook.add_worksheet("현재고현황")
    header_format = workbook.add_format({"bold": True, "font_color": "#B4232D", "bg_color": "#FFF3F3", "border": 1, "border_color": "#E5BFC2"})
    integer_format = workbook.add_format({"num_format": "#,##0;[Red]-#,##0;0"})
    number_format = workbook.add_format({"num_format": "#,##0.###"})
    date_format = workbook.add_format({"num_format": "yyyy-mm-dd"})
    datetime_format = workbook.add_format({"num_format": "yyyy-mm-dd hh:mm"})
    worksheet.write_row(0, 0, headers, header_format)
    worksheet.freeze_panes(1, 0)
    worksheet.set_column(0, 0, 8)
    widths = {"kind": 10, "date": 12, "datetime": 18, "number": 13, "text": 16}
    for index, (key, _title, kind) in enumerate(EXCEL_COLUMNS, start=1):
        worksheet.set_column(index, index, 24 if key in ("sourceno", "productname") else widths[kind])
    row_no = 1
    try:
        with _connect() as connection, connection.cursor(name="current_stock_excel_cursor") as cursor:
            cursor.itersize = 2000
            cursor.execute(query, params)
            positions = None
            while rows := cursor.fetchmany(2000):
                if positions is None:
                    # 조회 칸 이름 → 위치 (칸 순서가 바뀌어도 값이 어긋나지 않게)
                    names = [column[0] for column in cursor.description]
                    positions = [names.index(key) for key, _title, _kind in EXCEL_COLUMNS]
                for row in rows:
                    worksheet.write_number(row_no, 0, row_no)
                    for col, ((_key, _title, kind), position) in enumerate(zip(EXCEL_COLUMNS, positions), start=1):
                        value = row[position]
                        if value is None:
                            continue
                        if kind == "kind":
                            worksheet.write(row_no, col, stock_cost_module.stock_kind_label(value))
                        elif kind == "number":
                            numeric_value = float(value)
                            if numeric_value.is_integer():
                                worksheet.write_number(row_no, col, int(numeric_value), integer_format)
                            else:
                                worksheet.write_number(row_no, col, numeric_value, number_format)
                        elif kind == "datetime":
                            worksheet.write_datetime(row_no, col, value.replace(tzinfo=None), datetime_format)
                        elif kind == "date":
                            worksheet.write_datetime(row_no, col, value, date_format)
                        else:
                            worksheet.write(row_no, col, value)
                    row_no += 1
        worksheet.autofilter(0, 0, max(0, row_no - 1), len(headers) - 1)
    finally:
        workbook.close()
    return row_no - 1


# ---------------------------------------------------------------------------
# 재고 로트 원가 이력 (현재고 > 행 더블클릭)
#   origin: 원 전표(매입·기초)부터 재고이전·가공을 거쳐 이 로트가 만들어지기까지의 원가 구성 경로
#   steps : 이 로트에서 출고(매출·가공투입·이동출고)된 내역 — 저장(계산)된 순서
# 금액은 수불장에 기록된 값 그대로이고, 산식은 같은 규칙으로 다시 따라가 표시만 한다.
# ---------------------------------------------------------------------------
_HISTORY_KIND_NAMES = {"ST": "기초", "IN": "매입입고", "OUT": "매출출고", "PROCESS_OUT": "가공투입",
                       "PROCESS_IN": "가공입고", "MOVE_OUT": "이동출고", "MOVE_IN": "이동입고"}
_LOT_COLUMNS = """sourcetype, sourceno, sourceline, stockkind, itemcode, itemname, productname,
                  warehousecodename, receiptdate, originalqty, qty, originalweight, weight,
                  COALESCE(costamt, 0) AS costamt, COALESCE(expamt, 0) AS expamt, COALESCE(feeamt, 0) AS feeamt"""


def _dec0(value) -> Decimal:
    return Decimal(str(value if value is not None else 0))


def _load_lot(cursor, companyid: str, sourcetypes, sourceno: str, sourceline: int):
    cursor.execute(
        f"""SELECT {_LOT_COLUMNS} FROM CurrentStock01t
            WHERE companyid = %s AND sourcetype = ANY(%s) AND sourceno = %s AND sourceline = %s
            LIMIT 1""",
        (companyid, list(sourcetypes), sourceno, sourceline),
    )
    row = cursor.fetchone()
    return _row_dict(cursor, row) if row else None


def _lot_created(cursor, companyid: str, lot: dict):
    """이 로트를 만든 수불 행 (매입입고 · 기초 · 가공입고 · 이동입고)."""
    cursor.execute(
        """SELECT iniodate, COALESCE(iniokind, iniotype) AS kind, receiptno, lineno, customname, qty, weight,
                  COALESCE(supplyamt, 0) AS supplyamt, COALESCE(costamt, 0) AS costamt,
                  COALESCE(expamt, 0) AS expamt, COALESCE(feeamt, 0) AS feeamt
           FROM Iniop01t
           WHERE companyid = %s AND iniotype IN ('IN', 'ST') AND receiptno = %s AND lineno = %s
           LIMIT 1""",
        (companyid, lot["sourceno"], lot["sourceline"]),
    )
    row = cursor.fetchone()
    return _row_dict(cursor, row) if row else None


def _lot_steps(cursor, companyid: str, lot: dict, created: dict | None) -> list[dict]:
    """이 로트에서 빠진 원가 (매출 · 이동출고 · 가공투입)를 저장 순서대로, 산식과 함께."""
    source_types = sorted({str(lot["sourcetype"] or ""), str(lot["stockkind"] or "")} - {""})
    cursor.execute(
        """WITH uses AS (
               SELECT receiptno AS docno, lineno FROM Outbound02t
               WHERE companyid = %(c)s AND stocksourcetype = ANY(%(t)s) AND stocksourceno = %(n)s AND stocksourceline = %(l)s
               UNION
               -- 재고이전 수불은 상세 1행마다 이동출고(순번 × 2 − 1) · 이동입고(순번 × 2) 두 줄
               SELECT receiptno, lineno * 2 - 1 FROM inoutmove02t
               WHERE companyid = %(c)s AND stocksourcetype = ANY(%(t)s) AND stocksourceno = %(n)s AND stocksourceline = %(l)s
               UNION
               SELECT processno, lineno FROM Process02t
               WHERE companyid = %(c)s AND linetype = 'SOURCE'
                 AND stocksourcetype = ANY(%(t)s) AND stocksourceno = %(n)s AND stocksourceline = %(l)s
           )
           SELECT i.iniodate, COALESCE(i.iniokind, i.iniotype) AS kind, i.receiptno, i.lineno, i.customname,
                  i.qty, i.weight, COALESCE(i.costamt, 0) AS costamt, COALESCE(i.expamt, 0) AS expamt,
                  COALESCE(i.feeamt, 0) AS feeamt
           FROM uses u
           JOIN Iniop01t i ON i.companyid = %(c)s AND i.iniotype = 'OUT' AND i.receiptno = u.docno AND i.lineno = u.lineno
           ORDER BY i.created_at, i.receiptno, i.lineno""",
        {"c": companyid, "t": source_types, "n": lot["sourceno"], "l": lot["sourceline"]},
    )
    uses = [_row_dict(cursor, row) for row in cursor.fetchall()]
    base = created or lot
    remain = [_dec0(base["costamt"]), _dec0(base["expamt"]), _dec0(base["feeamt"]), _dec0(lot["originalweight"])]
    steps = []
    for use in uses:
        weight = _dec0(use["weight"])
        before_cost, before_exp, before_fee, before_weight = remain
        raw = (before_cost * weight / before_weight) if before_weight > 0 else before_cost
        expected = stock_cost_module.consume_parts(before_cost, before_exp, before_fee, before_weight, weight)
        recorded = (_dec0(use["costamt"]), _dec0(use["expamt"]), _dec0(use["feeamt"]))
        remain = [before_cost - recorded[0], before_exp - recorded[1], before_fee - recorded[2], before_weight - weight]
        steps.append({
            "iniodate": use["iniodate"], "kind": use["kind"], "kindname": _HISTORY_KIND_NAMES.get(use["kind"], use["kind"]),
            "receiptno": use["receiptno"], "lineno": use["lineno"], "customname": use["customname"],
            "qty": use["qty"], "weight": weight, "before_cost": before_cost, "before_weight": before_weight,
            "takes_all": before_weight <= 0 or weight >= before_weight, "raw_cost": raw.quantize(Decimal("0.01")),
            "costamt": recorded[0], "expamt": recorded[1], "feeamt": recorded[2],
            "realamt": recorded[0] - recorded[1] - recorded[2],
            "matches": tuple(expected) == recorded,
            "after_cost": remain[0], "after_weight": remain[3],
        })
    return steps


def _origin_note(cursor, companyid: str, lot: dict, created: dict | None) -> dict:
    """원 전표(매입 · 기초)에서 이 로트 원가가 어떻게 정해졌는지."""
    cost = _dec0((created or lot)["costamt"])
    exp = _dec0((created or lot)["expamt"])
    if (created or {}).get("kind") == "ST" or lot["stockkind"] == "OPENING":
        return {"basis": "opening", "supplyamt": cost - exp}
    cursor.execute(
        """SELECT COALESCE((SELECT SUM(supplyamt) FROM Inbound03t WHERE companyid = %s AND receiptno = %s), 0),
                  COALESCE((SELECT SUM(weight) FROM Inbound02t WHERE companyid = %s AND receiptno = %s), 0)""",
        (companyid, lot["sourceno"], companyid, lot["sourceno"]),
    )
    expense_total, doc_weight = cursor.fetchone()
    return {"basis": "inbound", "supplyamt": cost - exp, "expense_total": _dec0(expense_total),
            "doc_weight": _dec0(doc_weight), "line_weight": _dec0((created or lot)["weight"])}


def _parent_of(cursor, companyid: str, lot: dict, created: dict | None):
    """재고이전 · 가공으로 만들어진 로트의 바로 앞 로트와, 그 로트에서 빠진 수불 행 · 이 로트로 들어온 원가 구성."""
    kind = (created or {}).get("kind") or ""
    if lot["stockkind"] == "TRANSFER" or kind == "MOVE_IN":
        detail_line = int(lot["sourceline"]) // 2
        cursor.execute(
            """SELECT stocksourcetype, stocksourceno, stocksourceline FROM inoutmove02t
               WHERE companyid = %s AND receiptno = %s AND lineno = %s""",
            (companyid, lot["sourceno"], detail_line),
        )
        source = cursor.fetchone()
        if not source:
            return None
        return {"via": "transfer", "parent_key": source, "out_doc": (lot["sourceno"], int(lot["sourceline"]) - 1)}
    if lot["stockkind"] == "PROCESS" or kind == "PROCESS_IN":
        cursor.execute(stock_cost_module._PROCESS_LINE_SQL, (companyid, [lot["sourceno"]]))
        rows = cursor.fetchall()
        for source, nodes in stock_cost_module._process_trees(rows):
            ids = {node["id"] for node in nodes}
            if int(lot["sourceline"]) not in ids:
                continue
            fees = stock_cost_module.process_product_amounts(Decimal("0"), nodes)
            leaf_ids = set(fees)
            leaf_weight = sum((_dec0(node["weight"]) for node in nodes if node["id"] in leaf_ids), Decimal("0"))
            this_node = next(node for node in nodes if node["id"] == int(lot["sourceline"]))
            cursor.execute(
                "SELECT processcodename FROM Process02t WHERE companyid = %s AND processno = %s AND lineno = %s",
                (companyid, lot["sourceno"], lot["sourceline"]),
            )
            process_name = (cursor.fetchone() or [None])[0]
            fee = fees.get(int(lot["sourceline"]), Decimal("0"))
            return {
                "via": "process", "parent_key": (source[5], source[6], source[7]), "out_doc": (lot["sourceno"], int(source[1])),
                "process_fee": fee, "process_name": process_name, "product_count": len(leaf_ids),
                "product_weight": _dec0(this_node["weight"]), "leaf_weight": leaf_weight,
            }
    return None


def get_lot_cost_history(companyid: str, sourcetype: str, sourceno: str, sourceline: int):
    with _connect() as connection, connection.cursor() as cursor:
        lot = _load_lot(cursor, companyid, [sourcetype], sourceno, sourceline)
        if not lot:
            return None
        created = _lot_created(cursor, companyid, lot)
        steps = _lot_steps(cursor, companyid, lot, created)

        # 원가 구성 경로: 이 로트에서 거꾸로 원 전표까지 따라간 뒤 순서를 뒤집는다
        origin = []
        current, current_created = lot, created
        for _depth in range(20):
            parent = _parent_of(cursor, companyid, current, current_created)
            entry = {
                "kind": (current_created or {}).get("kind") or "", "kindname": _HISTORY_KIND_NAMES.get((current_created or {}).get("kind"), stock_cost_module.stock_kind_label(current["stockkind"])),
                "iniodate": (current_created or {}).get("iniodate") or current["receiptdate"],
                "receiptno": current["sourceno"], "lineno": current["sourceline"],
                "customname": (current_created or {}).get("customname"), "itemname": current["itemname"],
                "productname": current["productname"], "warehousecodename": current["warehousecodename"],
                "weight": _dec0(current["originalweight"]),
                "costamt": _dec0((current_created or current)["costamt"]), "expamt": _dec0((current_created or current)["expamt"]),
                "feeamt": _dec0((current_created or current)["feeamt"]), "is_this": current is lot,
            }
            entry["realamt"] = entry["costamt"] - entry["expamt"] - entry["feeamt"]
            if not parent:
                entry["note"] = _origin_note(cursor, companyid, current, current_created)
                origin.append(entry)
                break
            parent_lot = _load_lot(cursor, companyid, [parent["parent_key"][0], "INBOUND", "OPENING", "PROCESS", "TRANSFER"],
                                   parent["parent_key"][1], int(parent["parent_key"][2]))
            if not parent_lot:
                origin.append(entry)
                break
            parent_created = _lot_created(cursor, companyid, parent_lot)
            out_step = next((step for step in _lot_steps(cursor, companyid, parent_lot, parent_created)
                             if step["receiptno"] == parent["out_doc"][0] and int(step["lineno"]) == parent["out_doc"][1]), None)
            if parent["via"] == "process":
                entry["note"] = {"basis": "process", "material": entry["costamt"] - parent["process_fee"],
                                 "process_fee": parent["process_fee"], "process_name": parent["process_name"],
                                 "product_count": parent["product_count"], "product_weight": parent["product_weight"],
                                 "leaf_weight": parent["leaf_weight"], "input_cost": out_step and out_step["costamt"]}
            else:
                entry["note"] = {"basis": "transfer", "moved": entry["costamt"]}
            origin.append(entry)
            if out_step:
                origin.append({**out_step, "is_out": True})
            current, current_created = parent_lot, parent_created
        origin.reverse()

    start_cost = _dec0((created or lot)["costamt"])
    consumed = sum((step["costamt"] for step in steps), Decimal("0"))
    remaining_weight = steps[-1]["after_weight"] if steps else _dec0(lot["originalweight"])
    return {
        "lot": {**lot, "kindname": stock_cost_module.stock_kind_label(lot["stockkind"])},
        "origin": origin,
        "steps": steps,
        "summary": {
            "in_cost": start_cost, "in_weight": _dec0(lot["originalweight"]),
            "out_cost": consumed, "out_weight": _dec0(lot["originalweight"]) - _dec0(lot["weight"]),
            "stock_cost": _dec0(lot["costamt"]), "stock_weight": _dec0(lot["weight"]),
            "balanced": start_cost - consumed == _dec0(lot["costamt"]) and remaining_weight == _dec0(lot["weight"]),
        },
    }
