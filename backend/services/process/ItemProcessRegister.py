import logging
from datetime import date
from decimal import Decimal, ROUND_FLOOR, ROUND_HALF_UP

import json

from services.ai.stock_links import _allocate, allocate_coil_run, ensure_not_linked, linked_orders_sql, plan_outstanding_sql
import db as _shared_db
from services.closing import MonthClose as month_close_module
from services.inventory.CurrentStock import user_name_sql
from pydantic import BaseModel, Field, field_validator, model_validator



logger = logging.getLogger(__name__)
# Connections come from the single shared pool (backend/db.py).
_connect = _shared_db.connect


class ProductInput(BaseModel):
    clientid: str = Field(min_length=1, max_length=80)
    parent_clientid: str | None = Field(default=None, max_length=80)
    processid: str = Field(min_length=1, max_length=100)
    processcodename: str = Field(min_length=1, max_length=100)
    productno: str | None = Field(default=None, max_length=150)
    productname: str = Field(min_length=1, max_length=150)
    thickness: Decimal | None = Field(default=None, ge=0, max_digits=18, decimal_places=3)
    width: Decimal | None = Field(default=None, ge=0, max_digits=18, decimal_places=3)
    length: Decimal | None = Field(default=None, ge=0, max_digits=18, decimal_places=3)
    qty: Decimal = Field(gt=0, max_digits=18, decimal_places=3)
    qtyunit: str = Field(min_length=1, max_length=20)
    weight: Decimal = Field(gt=0, max_digits=18, decimal_places=3)
    unit: str = Field(default="KG", max_length=20)
    unitprice: Decimal = Field(default=0, ge=0, max_digits=18, decimal_places=3)
    # 로스 배부 중량: 재고에는 들어가지 않고 이 줄의 투입 몫으로만 기록 (상위 중량 = Σ(하위 중량 + 로스))
    lossweight: Decimal = Field(default=0, ge=0, max_digits=18, decimal_places=3)
    description: str = Field(default="", max_length=500)

    @field_validator("clientid", "processid", "processcodename", "productname", "qtyunit", "unit", "description")
    @classmethod
    def strip_text(cls, value: str) -> str:
        return value.strip()

    @field_validator("parent_clientid")
    @classmethod
    def strip_parent(cls, value: str | None) -> str | None:
        return value.strip() if value and value.strip() else None

    @field_validator("productno")
    @classmethod
    def strip_productno(cls, value: str | None) -> str | None:
        return value.strip() if value and value.strip() else None

    @field_validator("thickness", "width", "length", mode="before")
    @classmethod
    def blank_dimension(cls, value):
        return None if value is None or str(value).strip() == "" else value


class SourceInput(BaseModel):
    stocksourcetype: str = Field(min_length=1, max_length=20)
    stocksourceno: str = Field(min_length=1, max_length=100)
    stocksourceline: int = Field(gt=0)
    # 코일은 일부만 가공하면 코일이 남으므로 수량 0 (중량만 차감). 저장할 때 원천 재고로 다시 검사한다
    qty: Decimal = Field(ge=0, max_digits=18, decimal_places=3)
    weight: Decimal = Field(gt=0, max_digits=18, decimal_places=3)
    products: list[ProductInput] = Field(min_length=1, max_length=1000)

    @field_validator("stocksourcetype", "stocksourceno")
    @classmethod
    def strip_source(cls, value: str) -> str:
        return value.strip().upper()

    @model_validator(mode="after")
    def validate_tree(self):
        ids = [item.clientid for item in self.products]
        if len(ids) != len(set(ids)):
            raise ValueError("한 원소재 안에서 가공 결과 행 식별값이 중복되었습니다.")
        known = set(ids)
        for item in self.products:
            if item.parent_clientid and item.parent_clientid not in known:
                raise ValueError("가공 결과의 상위 제품을 찾을 수 없습니다.")
            if item.parent_clientid == item.clientid:
                raise ValueError("가공 결과가 자기 자신을 상위 제품으로 참조할 수 없습니다.")
        return self


class ProcessSaveRequest(BaseModel):
    processno: str | None = Field(default=None, max_length=50)
    processdate: date
    customcode: str = Field(min_length=1, max_length=100)
    customname: str = Field(min_length=1, max_length=150)
    warehousecode: str = Field(min_length=1, max_length=50)
    warehousecodename: str = Field(min_length=1, max_length=100)
    manager: str = Field(default="", max_length=100)
    description: str = Field(default="", max_length=500)
    sources: list[SourceInput] = Field(min_length=1, max_length=1000)
    # 가공 최적화 확정 계획의 몇 차 가공인지 (계획 불러오기로 만든 전표)
    planno: str | None = Field(default=None, max_length=30)   # 계획 1개 = 가공전표 1장 (모든 차수를 한 전표에)

    @field_validator("processno", "customcode", "customname", "warehousecode", "warehousecodename", "manager", "description")
    @classmethod
    def strip_text(cls, value: str | None) -> str | None:
        return value.strip() if value is not None else None

    @model_validator(mode="after")
    def unique_sources(self):
        keys = [(x.stocksourcetype, x.stocksourceno, x.stocksourceline) for x in self.sources]
        if len(keys) != len(set(keys)):
            raise ValueError("동일한 현재고 원천 행을 한 전표에 중복 선택할 수 없습니다.")
        return self


class ProductNumberRequest(BaseModel):
    productdate: date
    source_productname: str = Field(min_length=1, max_length=100)

    @field_validator("source_productname")
    @classmethod
    def strip_source_productname(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("현재고 제품명이 비어 있습니다.")
        return value

class ProcessDeleteRequest(BaseModel):
    processnos: list[str] = Field(min_length=1, max_length=100)

    @field_validator("processnos")
    @classmethod
    def clean_processnos(cls, values: list[str]) -> list[str]:
        cleaned = [value.strip() for value in values if value and value.strip()]
        if not cleaned or len(cleaned) != len(set(cleaned)):
            raise ValueError("삭제할 가공전표를 확인해 주세요.")
        return cleaned


def _row_dict(cursor, row):
    return dict(zip((column[0] for column in cursor.description), row))


def _next_processno(cursor, companyid: str, processdate: date) -> str:
    prefix = f"PR{processdate:%Y%m%d}"
    cursor.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"process-no:{companyid}:{prefix}",))
    cursor.execute(
        """SELECT COALESCE(MAX(CAST(SUBSTRING(processno FROM %s) AS INTEGER)), 0)
           FROM Process01t WHERE companyid = %s AND processno LIKE %s""",
        (len(prefix) + 1, companyid, f"{prefix}%"),
    )
    return f"{prefix}{cursor.fetchone()[0] + 1:05d}"


def _next_productno(cursor, companyid: str, productdate: date, source_productname: str) -> str:
    """Suggest the next product number based on the source product name."""
    prefix = f"{source_productname.strip()}-{productdate:%Y%m%d}"
    cursor.execute(
        """SELECT COALESCE(MAX(
                    CASE WHEN SUBSTRING(productname FROM %s) ~ '^[0-9]+$'
                         THEN CAST(SUBSTRING(productname FROM %s) AS BIGINT) END
                ), 0)
           FROM (
               SELECT productname FROM Process02t
               WHERE companyid=%s AND linetype='PRODUCT' AND LEFT(productname, %s)=%s
               UNION ALL
               SELECT productname FROM CurrentStock01t
               WHERE companyid=%s AND LEFT(productname, %s)=%s
           ) used""",
        (len(prefix) + 1, len(prefix) + 1, companyid, len(prefix), prefix,
         companyid, len(prefix), prefix),
    )
    return f"{prefix}{cursor.fetchone()[0] + 1:05d}"


def _stock_dimensions(product: dict) -> tuple:
    """두께·폭·길이가 비어 있으면 0 (재고수불·현재고는 0이 기본값, 입고등록과 같은 방식).
    가공 상세(Process02t)에는 입력한 그대로(빈값) 저장한다. 코일처럼 길이가 없는 경우가 실제로 있다."""
    return tuple(product.get(key) if product.get(key) is not None else Decimal("0") for key in ("thickness", "width", "length"))


def allocate_productno(companyid: str, productdate: date, source_productname: str) -> str:
    with _connect() as connection, connection.cursor() as cursor:
        return _next_productno(cursor, companyid, productdate, source_productname)


def _validate_weight_tree(source: dict):
    tolerance = Decimal("0")
    products = source["products"]
    by_parent: dict[str | None, list[dict]] = {}
    for product in products:
        by_parent.setdefault(product.get("parent_clientid"), []).append(product)

    roots = by_parent.get(None, [])
    if not roots:
        raise ValueError("각 원소재에는 바로 아래 가공 결과가 한 개 이상 필요합니다.")
    used = lambda x: Decimal(str(x["weight"])) + Decimal(str(x.get("lossweight") or 0))   # 제품 중량 + 배부 로스
    if abs(sum((used(x) for x in roots), Decimal("0")) - Decimal(str(source["weight"]))) > tolerance:
        raise ValueError("원소재 투입 중량과 1차 가공품 (중량 + 로스) 합계가 일치하지 않습니다.")

    by_id = {item["clientid"]: item for item in products}
    visited = set()

    def visit(clientid: str, path: set[str]):
        if clientid in path:
            raise ValueError("가공 단계가 순환 연결되어 있습니다.")
        if clientid in visited:
            return
        children = by_parent.get(clientid, [])
        if children:
            parent_weight = Decimal(str(by_id[clientid]["weight"]))
            child_weight = sum((used(x) for x in children), Decimal("0"))
            if abs(parent_weight - child_weight) > tolerance:
                raise ValueError(f"{by_id[clientid]['productname']}의 중량과 하위 가공품 중량 합계가 일치하지 않습니다.")
        visited.add(clientid)
        for child in children:
            visit(child["clientid"], path | {clientid})

    for root in roots:
        visit(root["clientid"], set())
    if len(visited) != len(products):
        raise ValueError("원소재와 연결되지 않은 가공 결과가 있습니다.")


def list_available_stock(
    companyid: str, page: int, page_size: int, q: str = "", warehouse: str = "",
    thickness: Decimal | None = None, width: Decimal | None = None, length: Decimal | None = None,
):
    where = ["companyid = %s", "qty > 0", "weight > 0"]
    params: list = [companyid]
    if q.strip():
        pattern = f"%{q.strip()}%"
        where.append("(itemcode ILIKE %s OR itemname ILIKE %s OR COALESCE(productname, '') ILIKE %s)")
        params.extend((pattern, pattern, pattern))
    if warehouse.strip():
        pattern = f"%{warehouse.strip()}%"
        where.append("(warehousecode ILIKE %s OR warehousecodename ILIKE %s)")
        params.extend((pattern, pattern))
    for column, value in (("thickness", thickness), ("width", width), ("length", length)):
        if value is not None:
            where.append(f"{column} = %s")
            params.append(value)
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(f"SELECT COUNT(*) FROM CurrentStock01t WHERE {' AND '.join(where)}", params)
        total = cursor.fetchone()[0]
        cursor.execute(
            f"""SELECT sourcetype, sourceno, sourceline, receiptdate, customcode, customname,
                       itemcode, itemname, productname, materialcode, materialname, surfacecode,
                       surfacename, myrtle, manager, thickness, width, length, qty, qtyunit,
                       weight, unit, unitprice, warehousecode, warehousecodename,
                       {linked_orders_sql("stock")} AS linked_orders
                FROM CurrentStock01t AS stock WHERE {' AND '.join(where)}
                ORDER BY receiptdate, sourcetype, sourceno, sourceline
                LIMIT %s OFFSET %s""",
            (*params, page_size, (page - 1) * page_size),
        )
        items = [_row_dict(cursor, row) for row in cursor.fetchall()]
    return {"items": items, "total": total, "page": page, "page_size": page_size}


def get_options(companyid: str):
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """SELECT customercode, customername FROM customer01t
               WHERE companyid = %s AND UPPER(BTRIM(useyn)) = 'Y'
               ORDER BY customername, customercode""", (companyid,),
        )
        customers = [{"code": row[0], "name": row[1]} for row in cursor.fetchall()]
        cursor.execute(
            """SELECT code, code_name FROM CodeMaster01t
               WHERE companyid = %s AND groupcode = 'WAREHOUSE' AND UPPER(BTRIM(use_yn)) = 'Y'
               ORDER BY sort_order, code""", (companyid,),
        )
        warehouses = [{"code": row[0], "name": row[1] or row[0]} for row in cursor.fetchall()]
        cursor.execute(
            """SELECT code, COALESCE(code_name, code) FROM CodeMaster01t
               WHERE companyid = %s AND groupcode = 'PROCESS' AND UPPER(BTRIM(use_yn)) = 'Y'
               ORDER BY sort_order, code""", (companyid,),
        )
        processes = [{"processid": row[0], "processname": row[1]} for row in cursor.fetchall()]
        cursor.execute(
            """SELECT r.itemcode, r.processid, COALESCE(c.code_name, r.processid), r.processnm,
                      r.thicknessyn, r.widthyn, r.lengthyn
               FROM ItemProcessrule01t r
               LEFT JOIN CodeMaster01t c ON c.companyid=r.companyid AND c.groupcode='PROCESS' AND c.code=r.processid
               WHERE r.companyid=%s ORDER BY r.itemcode, r.processid""", (companyid,),
        )
        rules = [{
            "itemcode": r[0], "processid": r[1], "processname": r[2], "productname": r[3],
            "thicknessyn": r[4], "widthyn": r[5], "lengthyn": r[6],
        } for r in cursor.fetchall()]
    return {"customers": customers, "warehouses": warehouses, "processes": processes, "rules": rules}


def list_documents(
    companyid: str,
    date_from: date | None = None,
    date_to: date | None = None,
    customer: str = "",
    warehouse: str = "",
    processno: str = "",
    iteminfo: str = "",
    productinfo: str = "",
    page: int | None = None,
    page_size: int | None = None,
):
    """Process document list. Without `page` it returns every matching document (list, as before);
    with `page`/`page_size` it returns {"items", "total", "page", "page_size"} for one page."""
    where = ["h.companyid = %s"]
    params: list = [companyid]
    if date_from:
        where.append("h.processdate >= %s")
        params.append(date_from)
    if date_to:
        where.append("h.processdate <= %s")
        params.append(date_to)
    for column, value in (
        ("h.customname", customer),
        ("h.warehousecodename", warehouse),
        ("h.processno", processno),
    ):
        normalized = value.strip()
        if normalized:
            where.append(f"{column} ILIKE %s")
            params.append(f"%{normalized}%")
    if iteminfo.strip():
        pattern = f"%{iteminfo.strip()}%"
        where.append(
            "EXISTS (SELECT 1 FROM Process02t d WHERE d.companyid=h.companyid "
            "AND d.processno=h.processno AND d.linetype='SOURCE' "
            "AND (d.itemcode ILIKE %s OR d.itemname ILIKE %s OR d.productname ILIKE %s))"
        )
        params.extend((pattern, pattern, pattern))
    if productinfo.strip():
        normalized_productinfo = productinfo.strip()
        where.append(
            "EXISTS (SELECT 1 FROM Process02t d WHERE d.companyid=h.companyid "
            "AND d.processno=h.processno AND d.linetype='PRODUCT' "
            "AND (d.itemname ILIKE %s OR UPPER(d.productname) = UPPER(%s)))"
        )
        params.extend((f"%{normalized_productinfo}%", normalized_productinfo))
    paged = page is not None and page_size is not None
    limit_sql = "LIMIT %s OFFSET %s" if paged else ""
    page_params = [page_size, (page - 1) * page_size] if paged else []
    with _connect() as connection, connection.cursor() as cursor:
        total = None
        if paged:
            cursor.execute(f"SELECT COUNT(*) FROM Process01t h WHERE {' AND '.join(where)}", params)
            total = cursor.fetchone()[0]
        cursor.execute(
            f"""SELECT h.processno, h.processdate, h.customname, h.warehousecodename, h.description,
                       h.createdat, h.updatedat,
                       {user_name_sql('h.created_by')} AS created_by,
                       {user_name_sql('h.updated_by')} AS updated_by,
                       COALESCE(summary.detail_count, 0) AS detail_count,
                       COALESCE(summary.qty, 0) AS qty,
                       COALESCE(summary.weight, 0) AS weight,
                       COALESCE(summary.supplyamt, 0) AS supplyamt,
                       COALESCE(summary.vat, 0) AS vat,
                       COALESCE(summary.unitamt, 0) AS unitamt
                FROM Process01t h
                LEFT JOIN LATERAL (
                    SELECT COUNT(*) FILTER (WHERE d.linetype='PRODUCT') AS detail_count,
                           SUM(d.qty) FILTER (
                               WHERE d.linetype='PRODUCT' AND NOT EXISTS (
                                   SELECT 1 FROM Process02t child
                                   WHERE child.companyid=d.companyid AND child.processno=d.processno
                                     AND child.parentlineno=d.lineno
                               )
                           ) AS qty,
                           -- 중량 = 최종 제품 중량 + 배부 로스 (= 원소재 투입중량)
                           COALESCE(SUM(d.weight) FILTER (
                               WHERE d.linetype='PRODUCT' AND NOT EXISTS (
                                   SELECT 1 FROM Process02t child
                                   WHERE child.companyid=d.companyid AND child.processno=d.processno
                                     AND child.parentlineno=d.lineno
                               )
                           ), 0) + COALESCE(SUM(d.lossweight) FILTER (WHERE d.linetype='PRODUCT'), 0) AS weight,
                           SUM(d.supplyamt) FILTER (
                               WHERE d.linetype='PRODUCT' AND NOT EXISTS (
                                   SELECT 1 FROM Process02t child
                                   WHERE child.companyid=d.companyid AND child.processno=d.processno
                                     AND child.parentlineno=d.lineno
                               )
                           ) AS supplyamt,
                           SUM(d.vat) FILTER (
                               WHERE d.linetype='PRODUCT' AND NOT EXISTS (
                                   SELECT 1 FROM Process02t child
                                   WHERE child.companyid=d.companyid AND child.processno=d.processno
                                     AND child.parentlineno=d.lineno
                               )
                           ) AS vat,
                           SUM(d.unitamt) FILTER (
                               WHERE d.linetype='PRODUCT' AND NOT EXISTS (
                                   SELECT 1 FROM Process02t child
                                   WHERE child.companyid=d.companyid AND child.processno=d.processno
                                     AND child.parentlineno=d.lineno
                               )
                           ) AS unitamt
                    FROM Process02t d
                    WHERE d.companyid=h.companyid AND d.processno=h.processno
                ) summary ON TRUE
                WHERE {' AND '.join(where)}
                ORDER BY h.processdate DESC,h.processno DESC
                {limit_sql}""", [*params, *page_params],
        )
        items = [_row_dict(cursor, row) for row in cursor.fetchall()]
    if not paged:
        return items
    return {"items": items, "total": total, "page": page, "page_size": page_size}


def get_document(companyid: str, processno: str):
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            f"""SELECT processno,processdate,customcode,customname,warehousecode,warehousecodename,
                      manager,subulyn,description,createdat,updatedat,planno,
                      {user_name_sql('Process01t.created_by')} AS created_by,
                      {user_name_sql('Process01t.updated_by')} AS updated_by
               FROM Process01t WHERE companyid=%s AND processno=%s""",
            (companyid, processno),
        )
        row = cursor.fetchone()
        if not row:
            return None
        header = _row_dict(cursor, row)
        cursor.execute(
            f"""SELECT lineno,linetype,levelno,parentlineno,sourcelineno,stocksourcetype,stocksourceno,
                      stocksourceline,sourcewarehousecode,sourcewarehousecodename,itemcode,itemname,
                      productname,materialcode,materialname,surfacecode,surfacename,myrtle,thickness,width,
                      length,qty,qtyunit,weight,lossweight,processid,processcodename,unit,unitprice,supplyamt,vat,
                      unitamt,description,createdat,updatedat,
                      {user_name_sql('Process02t.created_by')} AS created_by,
                      {user_name_sql('Process02t.updated_by')} AS updated_by
               FROM Process02t WHERE companyid=%s AND processno=%s ORDER BY lineno""",
            (companyid, processno),
        )
        details = [_row_dict(cursor, detail) for detail in cursor.fetchall()]
        cursor.execute(
            """SELECT d.lineno
               FROM Process02t d
               WHERE d.companyid=%s AND d.processno=%s AND d.linetype='PRODUCT'
                 AND NOT EXISTS (
                     SELECT 1 FROM Process02t child
                     WHERE child.companyid=d.companyid AND child.processno=d.processno
                       AND child.parentlineno=d.lineno
                 )
                 AND NOT EXISTS (
                     SELECT 1 FROM CurrentStock01t s
                     WHERE s.companyid=d.companyid AND s.sourceno=d.processno
                       AND s.sourceline=d.lineno AND s.sourcetype IN ('INBOUND','PROCESS')
                       AND s.qty=s.originalqty AND s.weight=s.originalweight
                 )""",
            (companyid, processno),
        )
        blocked_outputs = cursor.fetchall()
        header["can_edit"] = bool(any(detail["linetype"] == "PRODUCT" for detail in details) and not blocked_outputs)
    sources = []
    products_by_source = {}
    for detail in details:
        if detail["linetype"] == "SOURCE":
            sources.append({"source": detail, "products": []})
            products_by_source[detail["lineno"]] = sources[-1]["products"]
        else:
            products_by_source.setdefault(detail["sourcelineno"], []).append(detail)
    return {"header": header, "sources": sources}


def _restore_document_for_edit(cursor, companyid: str, processno: str, actor: str | None = None):
    cursor.execute(
        "SELECT processno FROM Process01t WHERE companyid=%s AND processno=%s FOR UPDATE",
        (companyid, processno),
    )
    if not cursor.fetchone():
        raise ValueError("수정할 가공전표를 찾을 수 없습니다.")

    cursor.execute(
        """SELECT lineno,stocksourcetype,stocksourceno,stocksourceline,qty,weight
           FROM Process02t
           WHERE companyid=%s AND processno=%s AND linetype='SOURCE'
           ORDER BY lineno FOR UPDATE""",
        (companyid, processno),
    )
    source_rows = cursor.fetchall()
    if not source_rows:
        raise ValueError("가공전표의 원소재 내역을 찾을 수 없습니다.")

    cursor.execute(
        """SELECT d.lineno
           FROM Process02t d
           WHERE d.companyid=%s AND d.processno=%s AND d.linetype='PRODUCT'
             AND NOT EXISTS (
                 SELECT 1 FROM Process02t child
                 WHERE child.companyid=d.companyid AND child.processno=d.processno
                   AND child.parentlineno=d.lineno
             )
           ORDER BY d.lineno""",
        (companyid, processno),
    )
    output_lines = [row[0] for row in cursor.fetchall()]
    if not output_lines:
        raise ValueError("가공전표의 가공품 내역을 찾을 수 없습니다.")
    # 가공품이 주문에 연결됐거나 확정 계획에 잡혀 있으면 수정하지 않는다
    ensure_not_linked(cursor, companyid, {(t, processno, line) for line in output_lines for t in ("INBOUND", "PROCESS")}, action="수정")

    for output_line in output_lines:
        cursor.execute(
            """DELETE FROM CurrentStock01t
               WHERE companyid=%s AND sourcetype IN ('INBOUND','PROCESS')
                 AND sourceno=%s AND sourceline=%s
                 AND qty=originalqty AND weight=originalweight""",
            (companyid, processno, output_line),
        )
        if cursor.rowcount != 1:
            raise ValueError("가공품이 출고 또는 후속 가공에 사용되어 수정할 수 없습니다.")

    for _line_no, source_type, source_no, source_line, qty, weight in source_rows:
        cursor.execute(
            """UPDATE CurrentStock01t
               SET qty=qty+%s,weight=weight+%s,updated_at=CURRENT_TIMESTAMP,updated_by=COALESCE(%s,updated_by)
               WHERE companyid=%s AND sourcetype=%s AND sourceno=%s AND sourceline=%s
                 AND qty+%s<=originalqty AND weight+%s<=originalweight""",
            (qty, weight, actor or None, companyid, source_type, source_no, source_line, qty, weight),
        )
        if cursor.rowcount != 1:
            raise ValueError("기존 원소재 재고를 복구할 수 없어 가공전표를 수정하지 못했습니다.")

    cursor.execute(
        "DELETE FROM Iniop01t WHERE companyid=%s AND receiptno=%s AND iniotype IN ('IN','OUT')",
        (companyid, processno),
    )
    cursor.execute("DELETE FROM Process02t WHERE companyid=%s AND processno=%s", (companyid, processno))


# ── 가공 최적화 계획 연동 ────────────────────────────────────────────────────
def _plan_pattern(value) -> dict:
    if isinstance(value, dict):
        return value
    try:
        return json.loads(value or "{}")
    except (TypeError, ValueError):
        return {}


def _plan_runs(pattern: dict) -> list[dict]:
    """계획의 가공 차수 (가공중량이 있는 차수만). 원샷 · 일부가공 = 1개, 등분 = 차수 수."""
    runs = ((pattern.get("plan") or {}).get("runs")) or []
    return [r for r in runs if float(r.get("weight") or 0) > 0]


def _load_plan(cursor, companyid: str, planno: str, editing_processno: str = "") -> dict:
    cursor.execute(
        """SELECT planno, status, materialtype, rawkind, stocksourcetype, stocksourceno, stocksourceline,
                  itemname, thickness, width, pattern, processmode
             FROM aiplan01t WHERE companyid=%s AND planno=%s FOR UPDATE""", (companyid, planno),
    )
    row = cursor.fetchone()
    if not row:
        raise ValueError(f"가공 계획을 찾을 수 없습니다: {planno}")
    plan = _row_dict(cursor, row)
    if plan["materialtype"] != "COIL" or plan["rawkind"] != "STOCK":
        raise ValueError("현재고 원자재를 쓰는 코일 계획만 재고가공등록으로 불러올 수 있습니다.")
    allowed = ("CONFIRMED", "DONE") if editing_processno else ("CONFIRMED",)
    if plan["status"] == "DONE" and not editing_processno:
        cursor.execute("SELECT string_agg(processno, ', ') FROM Process01t WHERE companyid=%s AND planno=%s", (companyid, planno))
        raise ValueError(f"이미 가공등록된 계획입니다 ({cursor.fetchone()[0] or '-'}).")
    if plan["status"] not in allowed:
        raise ValueError(f"{planno} 은(는) 확정 상태가 아니라 가공등록할 수 없습니다.")
    runs = _plan_runs(_plan_pattern(plan["pattern"]))
    if not runs:
        raise ValueError(f"{planno} 계획에 가공 차수가 없습니다.")
    # 계획 1개 = 전표 1장 → 이 계획으로 등록한 다른 전표가 있으면 안 된다
    cursor.execute(
        "SELECT processno FROM Process01t WHERE companyid=%s AND planno=%s AND processno<>%s LIMIT 1",
        (companyid, planno, editing_processno or ""),
    )
    taken = cursor.fetchone()
    if taken:
        raise ValueError(f"{planno} 계획은 이미 {taken[0]} 전표로 등록되어 있습니다.")
    plan["runs"] = runs
    plan["stock_key"] = (plan["stocksourcetype"], plan["stocksourceno"], int(plan["stocksourceline"]))
    return plan


def _ensure_plan_structure(plan: dict, source: dict) -> None:
    """계획 전표는 계획 그대로: 슬리팅 칼(폭 · 개수)과 등분 줄 수가 계획과 같아야 한다 (행 추가 · 삭제 불가)."""
    runs = plan["runs"]
    cuts = sorted(float(p["width"]) for r in runs for p in r.get("pieces") or [] for _ in range(int(p.get("cuts") or 0)))
    products = source["products"]
    parent_ids = {p.get("parent_clientid") for p in products if p.get("parent_clientid")}
    leaves = [p for p in products if p["clientid"] not in parent_ids]
    roots = [p for p in products if not p.get("parent_clientid")]
    raw_width = float(plan.get("width") or 0)
    # 일부가공 보관분: 원소재 바로 아래, 하위 없는 원코일 폭 줄 1개
    keep = [p for p in roots if p["clientid"] not in parent_ids and abs(float(p.get("width") or 0) - raw_width) < 1e-6]         if plan.get("processmode") == "PARTIAL" else []
    slit_widths = sorted(float(p.get("width") or 0) for p in leaves if p not in keep[:1])
    use_split = len(runs) > 1 or bool(keep)
    expected_roots = (len(runs) + (1 if keep else 0)) if use_split else len(cuts)
    if slit_widths != cuts or len(roots) != expected_roots:
        raise ValueError(f"{plan['planno']} 계획과 가공 줄 구성이 다릅니다 (계획 칼 {len(cuts)}줄 · 등록 {len(slit_widths)}줄). "
                         "계획 전표는 행을 추가하거나 지울 수 없습니다. 다르게 가공하려면 가공최적화에서 계획을 다시 확정해 주세요.")


def _ensure_plan_stock_free(cursor, companyid: str, plan: dict) -> None:
    """계획 원자재에 걸린 다른 연결 확인. 이 계획 · 다른 확정 계획(중량으로 따로 검사) · 확정 계획에 들어간 주문 연결은 통과."""
    t, n, l = plan["stock_key"]
    cursor.execute(
        """SELECT string_agg(DISTINCT link.orderid || '-' || link.lineno, ', ')
             FROM aiorder03t link
             JOIN aiorder02t line ON line.companyid=link.companyid AND line.orderid=link.orderid AND line.lineno=link.lineno
            WHERE link.companyid=%s AND link.stocksourcetype=%s AND link.stocksourceno=%s AND link.stocksourceline=%s
              AND line.optimize_status <> 'DONE'
              AND NOT EXISTS (SELECT 1 FROM aiplan02t d JOIN aiplan01t p ON p.companyid=d.companyid AND p.planno=d.planno
                               WHERE d.companyid=link.companyid AND d.orderid=link.orderid AND d.orderlineno=link.lineno
                                 AND p.status IN ('CONFIRMED','DONE'))""",
        (companyid, t, n, l),
    )
    others = cursor.fetchone()[0]
    if others:
        raise ValueError(f"계획 원자재가 아직 계획되지 않은 다른 주문에도 연결되어 있습니다 ({others}). 주문서 관리에서 확인해 주세요.")


def _sync_plan_status(cursor, companyid: str, planno: str, actor: str | None = None) -> None:
    """등록한 차수 수로 계획 상태를 맞춘다. 모든 차수 등록 = 계획 DONE · 주문 품목 가공완료, 아니면 CONFIRMED · 계획확정."""
    cursor.execute("SELECT status, pattern FROM aiplan01t WHERE companyid=%s AND planno=%s FOR UPDATE", (companyid, planno))
    row = cursor.fetchone()
    if not row or row[0] not in ("CONFIRMED", "DONE"):
        return
    cursor.execute("SELECT processno FROM Process01t WHERE companyid=%s AND planno=%s ORDER BY processno", (companyid, planno))
    registered = cursor.fetchall()
    done = bool(registered)   # 계획 전체를 전표 1장으로 등록하므로 등록 = 가공완료
    cursor.execute(
        """UPDATE aiplan01t SET status=%s, processno=%s, updated_at=CURRENT_TIMESTAMP, updated_by=COALESCE(%s, updated_by)
            WHERE companyid=%s AND planno=%s""",
        ("DONE" if done else "CONFIRMED", ", ".join(r[0] for r in registered)[:100] or None, actor or None, companyid, planno),
    )
    cursor.execute(
        """UPDATE aiorder02t d SET optimize_status=%s, updated_at=CURRENT_TIMESTAMP, updated_by=COALESCE(%s, d.updated_by)
             FROM aiplan02t p
            WHERE p.companyid=%s AND p.planno=%s AND p.linekind='ORDER'
              AND d.companyid=p.companyid AND d.orderid=p.orderid AND d.lineno=p.orderlineno
              AND d.optimize_status IN ('PLANNED','DONE')""",
        ("DONE" if done else "PLANNED", actor or None, companyid, planno),
    )


def list_plan_runs(companyid: str):
    """계획 불러오기 목록: 확정된 코일 계획(현재고 원자재)과 차수별 등록 여부."""
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """SELECT p.planno, p.status, p.itemname, p.steelgrade, p.thickness, p.width, p.rawweight, p.inputweight,
                      p.processmode, p.combo, p.pattern, p.created_at,
                      p.stocksourcetype, p.stocksourceno, p.stocksourceline,
                      s.warehousecodename, s.weight AS stockweight,
                      (SELECT string_agg(DISTINCT d.orderid || '-' || d.orderlineno, ', ') FROM aiplan02t d
                        WHERE d.companyid=p.companyid AND d.planno=p.planno AND d.linekind='ORDER') AS lines
                 FROM aiplan01t p
                 LEFT JOIN CurrentStock01t s ON s.companyid=p.companyid AND s.sourcetype=p.stocksourcetype
                      AND s.sourceno=p.stocksourceno AND s.sourceline=p.stocksourceline
                WHERE p.companyid=%s AND p.status IN ('CONFIRMED','DONE') AND p.materialtype='COIL' AND p.rawkind='STOCK'
                ORDER BY (p.status = 'DONE'), p.created_at DESC LIMIT 200""", (companyid,),
        )
        plans = [_row_dict(cursor, row) for row in cursor.fetchall()]
        cursor.execute("SELECT planno, processno FROM Process01t WHERE companyid=%s AND planno IS NOT NULL", (companyid,))
        registered: dict = {}
        for planno_, processno_ in cursor.fetchall():
            registered.setdefault(planno_, []).append(processno_)
    items = []
    for plan in plans:
        runs = _plan_runs(_plan_pattern(plan.pop("pattern")))
        plan["runs"] = [{
            "run": i, "label": r.get("label") or f"{i}차 가공", "weight": r.get("weight"),
            "pattern": " + ".join(f"{float(x['width']):g}×{x['cuts']}" for x in r.get("pieces") or [] if x.get("cuts")),
        } for i, r in enumerate(runs, start=1)]
        plan["processnos"] = sorted(registered.get(plan["planno"], []))
        items.append(plan)
    return {"items": items}


def _process_code(cursor, companyid: str, keyword: str):
    """공정 코드 (이름에 keyword 가 들어간 것 우선)."""
    cursor.execute(
        """SELECT c.code, COALESCE(c.code_name, c.code) FROM CodeMaster01t c
            WHERE c.companyid=%s AND c.groupcode='PROCESS' AND UPPER(BTRIM(c.use_yn))='Y'
            ORDER BY (COALESCE(c.code_name,'') LIKE %s) DESC, c.sort_order, c.code LIMIT 1""", (companyid, f"%{keyword}%"),
    )
    return cursor.fetchone() or ("", "")


def _rule_name(cursor, companyid: str, itemcode, processid):
    if not processid:
        return None
    cursor.execute("SELECT processnm FROM ItemProcessrule01t WHERE companyid=%s AND itemcode=%s AND processid=%s LIMIT 1",
                   (companyid, itemcode, processid))
    found = cursor.fetchone()
    return found[0] if found and found[0] else None


def plan_draft(companyid: str, planno: str):
    """계획 불러오기: 계획 전체를 가공전표 1장 초안으로 만든다 (저장은 하지 않음).

    원소재 (원코일)
      ├ 등분  1차 가공 (차수 투입중량)      ← 등분 계획 · 일부가공일 때만 최상위에 둔다
      │   └ 슬리팅  칼마다 1줄 (제품중량 + 배부 로스)
      ├ 등분  2차 가공 …
      └ 등분  보관분 (일부가공에서 남는 코일 → 새 재고)
    원샷은 등분 없이 원소재 바로 아래 슬리팅."""
    with _connect() as connection, connection.cursor() as cursor:
        plan = _load_plan(cursor, companyid, planno)
        cursor.execute(
            f"""SELECT sourcetype, sourceno, sourceline, receiptdate, customcode, customname,
                       itemcode, itemname, productname, materialcode, materialname, surfacecode,
                       surfacename, myrtle, manager, thickness, width, length, qty, qtyunit,
                       weight, unit, unitprice, warehousecode, warehousecodename,
                       {plan_outstanding_sql("stock", "%s")} AS other_reserved
                  FROM CurrentStock01t AS stock
                 WHERE companyid=%s AND sourcetype=%s AND sourceno=%s AND sourceline=%s""",
            (planno, companyid, *plan["stock_key"]),
        )
        row = cursor.fetchone()
        if not row:
            raise ValueError("계획 원자재 재고를 찾을 수 없습니다.")
        stock = _row_dict(cursor, row)
        slit = _process_code(cursor, companyid, "슬리팅")
        split = _process_code(cursor, companyid, "등분")
        slit_name = _rule_name(cursor, companyid, stock["itemcode"], slit[0]) or stock.get("itemname") or ""
        split_name = _rule_name(cursor, companyid, stock["itemcode"], split[0]) or stock.get("itemname") or ""
    stock_weight = Decimal(str(stock["weight"]))
    other = Decimal(str(stock.pop("other_reserved") or 0))
    raw_width = Decimal(str(plan["width"] or stock["width"] or 0))
    if raw_width <= 0:
        raise ValueError("계획 원자재 폭을 확인해 주세요.")
    runs = plan["runs"]
    weights = [Decimal(str(r.get("weight") or 0)).quantize(Decimal("0.001")) for r in runs]
    total = sum(weights)
    if total > stock_weight - other + Decimal("0.001"):
        raise ValueError(f"계획 가공중량 {total:,.3f}kg이 쓸 수 있는 현재고 {stock_weight - other:,.3f}kg보다 큽니다. 재고를 확인해 주세요.")
    partial = plan.get("processmode") == "PARTIAL"
    left = stock_weight - other - total
    keep = left if partial and left > Decimal("0.001") else Decimal("0")          # 일부가공: 남는 코일 = 보관분
    if not partial and other == 0 and Decimal("0") < left <= Decimal("1"):        # 반올림 자투리는 마지막 차수에 붙인다
        weights[-1] += left
        total = stock_weight
    use_split = len(runs) > 1 or keep > 0
    base = {"thickness": stock.get("thickness"), "length": None, "qty": 1, "qtyunit": stock.get("qtyunit") or "EA"}
    products, loss_total = [], Decimal("0")
    for index, (run, weight) in enumerate(zip(runs, weights), start=1):
        parent = None
        if use_split:
            parent = f"split{index}"
            products.append({**base, "key": parent, "parent": None, "processid": split[0], "processcodename": split[1],
                             "productname": split_name, "width": float(raw_width), "weight": float(weight), "lossweight": 0,
                             "description": "가공분" if partial and len(runs) == 1 else f"{index}차 가공"})
        groups = [(p["width"], int(p.get("cuts") or 0)) for p in run.get("pieces") or [] if int(p.get("cuts") or 0) > 0]
        if not groups:
            raise ValueError(f"{index}차 가공에 칼 배치가 없습니다.")
        # kg 정수 배부 (차수 → 폭 → 칼, 같은 폭의 남는 kg 는 첫 줄) — 가공최적화 결과 표와 같은 함수
        alloc = allocate_coil_run(weight, raw_width, groups)
        loss_total += Decimal(str(alloc["loss"]))
        cuts = [g["width"] for g in alloc["widths"] for _ in range(g["cuts"])]
        product_weights = [x for g in alloc["widths"] for x in g["lines"]]
        losses = [x for g in alloc["widths"] for x in g["losses"]]
        products += [{**base, "key": f"slit{index}-{i}", "parent": parent, "processid": slit[0], "processcodename": slit[1],
                      "productname": slit_name, "width": float(w), "weight": product_weights[i], "lossweight": losses[i],
                      "description": ""} for i, w in enumerate(cuts)]
    if keep > 0:
        products.append({**base, "key": "keep", "parent": None, "processid": split[0], "processcodename": split[1],
                         "productname": split_name, "width": float(raw_width), "weight": float(keep), "lossweight": 0,
                         "description": "보관분 (남는 코일)"})
    source_weight = total + keep
    source_qty = stock["qty"] if stock_weight - source_weight <= Decimal("0.001") else Decimal("0")   # 코일이 남으면 수량 그대로
    return {
        "planno": planno, "runs": len(runs), "processmode": plan.get("processmode"),
        "stock": stock, "source": {"qty": source_qty, "weight": source_weight, "left_weight": stock_weight - source_weight},
        "products": products, "loss": loss_total, "keep": keep,
    }


def save_document(companyid: str, companyname: str, payload: dict, actor: str | None = None):
    companyname = str(companyname)[:50]
    if not payload.get("planno"):   # 계획 전표는 줄 구성(계획과 같은지)을 먼저 본 뒤 중량을 검사한다
        for source in payload["sources"]:
            _validate_weight_tree(source)
    with _connect() as connection, connection.cursor() as cursor:
        # 입고·출고·기초재고와 같은 회사별 재고 잠금을 공유해 동시 차감 순서를 직렬화한다.
        cursor.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"stand-stock:{companyid}",))
        processno = str(payload.get("processno") or "").strip()
        # 수정이면 원래 가공일과 바뀐 가공일 둘 다 마감 전이어야 한다
        original_date = None
        if processno:
            cursor.execute("SELECT processdate FROM Process01t WHERE companyid=%s AND processno=%s", (companyid, processno))
            found = cursor.fetchone()
            original_date = found[0] if found else None
        month_close_module.ensure_open(cursor, companyid, [payload["processdate"], original_date],
                                       "수정" if processno else "등록")
        # 등록자/수정자: a new document is created by `actor`; an edited document keeps its original creator
        # (its detail / ledger / stock rows are deleted and re-inserted below) and records `actor` as modifier.
        detail_created_by, detail_updated_by = actor or None, None
        # 가공 최적화 계획 연동 (계획 불러오기로 만든 전표). 수정이면 원래 연결된 계획도 함께 상태를 맞춘다
        old_planno = None
        if processno:
            cursor.execute("SELECT planno FROM Process01t WHERE companyid=%s AND processno=%s", (companyid, processno))
            found = cursor.fetchone()
            old_planno = found[0] if found else None
        planno = str(payload.get("planno") or "").strip() or None
        plan = _load_plan(cursor, companyid, planno, processno) if planno else None
        if not plan and any(Decimal(str(p.get("lossweight") or 0)) > 0 for s in payload["sources"] for p in s["products"]):
            raise ValueError("로스 배부는 가공계획에서 불러온 전표만 쓸 수 있습니다. 수기가공은 [중량 자동맞춤]으로 맞춰 주세요.")
        if plan:
            keys = {(s["stocksourcetype"], s["stocksourceno"], int(s["stocksourceline"])) for s in payload["sources"]}
            if keys != {plan["stock_key"]}:
                raise ValueError(f"{planno} 계획의 원자재({plan['stocksourceno']}-{plan['stocksourceline']}) 한 줄만 원소재로 쓸 수 있습니다.")
            _ensure_plan_stock_free(cursor, companyid, plan)
            for source in payload["sources"]:
                _ensure_plan_structure(plan, source)
                _validate_weight_tree(source)
        # 주문서 관리에서 주문에 연결된 재고는 가공 원소재로 쓸 수 없다 (수정 중인 문서에 원래 있던 원소재는 허용)
        existing_sources = set()
        if processno:
            cursor.execute(
                """SELECT DISTINCT UPPER(stocksourcetype), stocksourceno, stocksourceline FROM Process02t
                   WHERE companyid=%s AND processno=%s AND linetype='SOURCE'""", (companyid, processno),
            )
            existing_sources = {(t, n, int(l)) for t, n, l in cursor.fetchall()}
        ensure_not_linked(cursor, companyid, {
            (source["stocksourcetype"], source["stocksourceno"], source["stocksourceline"]) for source in payload["sources"]
        }, existing_sources | ({plan["stock_key"]} if plan else set()))
        if processno:
            cursor.execute("SELECT created_by FROM Process01t WHERE companyid=%s AND processno=%s", (companyid, processno))
            original = cursor.fetchone()
            detail_created_by, detail_updated_by = (original[0] if original else None) or None, actor or None
            _restore_document_for_edit(cursor, companyid, processno, actor)
        else:
            processno = _next_processno(cursor, companyid, payload["processdate"])

        cursor.execute(
            """SELECT customercode, customername FROM customer01t
               WHERE companyid=%s AND customercode=%s AND UPPER(BTRIM(useyn))='Y'""",
            (companyid, payload["customcode"]),
        )
        customer = cursor.fetchone()
        if not customer:
            raise ValueError("사용 중인 가공처를 확인해 주세요.")
        cursor.execute(
            """SELECT code, code_name FROM CodeMaster01t
               WHERE companyid=%s AND groupcode='WAREHOUSE' AND code=%s AND UPPER(BTRIM(use_yn))='Y'""",
            (companyid, payload["warehousecode"]),
        )
        warehouse = cursor.fetchone()
        if not warehouse:
            raise ValueError("사용 중인 입고 창고를 확인해 주세요.")
        customname = customer[1] or customer[0]
        warehouse_name = warehouse[1] or warehouse[0]

        if payload.get("processno"):
            cursor.execute(
                """UPDATE Process01t
                   SET companyname=%s,processdate=%s,customcode=%s,customname=%s,
                       warehousecode=%s,warehousecodename=%s,manager=%s,subulyn='N',
                       description=%s,updatedat=CURRENT_TIMESTAMP,updated_by=%s,planno=%s
                   WHERE companyid=%s AND processno=%s""",
                (companyname, payload["processdate"], payload["customcode"], customname,
                 payload["warehousecode"], warehouse_name, payload.get("manager") or None,
                 payload.get("description") or None, actor or None, planno, companyid, processno),
            )
        else:
            cursor.execute(
                """INSERT INTO Process01t
                   (companyid,companyname,processno,processdate,customcode,customname,
                    warehousecode,warehousecodename,manager,subulyn,description,created_by,planno)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,'N',%s,%s,%s)""",
                (companyid, companyname, processno, payload["processdate"], payload["customcode"], customname,
                 payload["warehousecode"], warehouse_name, payload.get("manager") or None, payload.get("description") or None,
                 actor or None, planno),
            )

        line_no = 0
        iniop_out = []
        iniop_in = []
        product_stock = []
        next_product_numbers = {}
        for source in payload["sources"]:
            key = (source["stocksourcetype"], source["stocksourceno"], source["stocksourceline"])
            cursor.execute(
                """SELECT * FROM CurrentStock01t
                   WHERE companyid=%s AND sourcetype=%s AND sourceno=%s AND sourceline=%s
                   FOR UPDATE""", (companyid, *key),
            )
            stock_row = cursor.fetchone()
            if not stock_row:
                raise ValueError("선택한 원천 재고를 현재 회사에서 찾을 수 없습니다.")
            stock = _row_dict(cursor, stock_row)
            qty = Decimal(str(source["qty"]))
            weight = Decimal(str(source["weight"]))
            if qty > Decimal(str(stock["qty"])) or weight > Decimal(str(stock["weight"])):
                raise ValueError(f"{stock['itemname']}의 가공 투입량이 현재고를 초과합니다.")
            # 수량: 코일(길이 없음)은 중량으로 차감하고, 코일을 다 쓸 때만 수량을 뺀다 (일부가공 · 등분 중간 차수 = 수량 0)
            left = Decimal(str(stock["weight"])) - weight
            if not Decimal(str(stock.get("length") or 0)) > 0:
                if left <= 0:
                    qty = Decimal(str(stock["qty"]))
                elif qty >= Decimal(str(stock["qty"])):
                    raise ValueError(f"{stock['itemname']} 코일이 {left:,.3f}kg 남는데 수량이 0이 됩니다. 일부만 가공하면 투입 수량을 0으로 입력해 주세요.")
            elif qty <= 0:
                raise ValueError(f"{stock['itemname']}의 투입 수량을 입력해 주세요.")
            if plan and key == plan["stock_key"]:
                # 다른 확정 계획이 잡아 둔 중량은 쓸 수 없다
                cursor.execute(f"""SELECT {plan_outstanding_sql('s', '%s')} FROM CurrentStock01t s
                                   WHERE companyid=%s AND sourcetype=%s AND sourceno=%s AND sourceline=%s""",
                               (planno, companyid, *key))
                reserved = Decimal(str(cursor.fetchone()[0] or 0))
                if weight > Decimal(str(stock["weight"])) - reserved + Decimal("0.001"):
                    raise ValueError(f"다른 확정 계획이 {reserved:,.3f}kg을 잡고 있어 투입중량 {weight:,.3f}kg을 쓸 수 없습니다.")

            requested_processes = sorted({product["processid"] for product in source["products"]})
            cursor.execute(
                """SELECT code, COALESCE(code_name, code) FROM CodeMaster01t
                   WHERE companyid=%s AND groupcode='PROCESS' AND UPPER(BTRIM(use_yn))='Y'
                     AND code=ANY(%s)""",
                (companyid, requested_processes),
            )
            active_processes = {row[0]: row[1] for row in cursor.fetchall()}
            if len(active_processes) != len(requested_processes):
                raise ValueError("사용 중인 일반코드의 공정구분을 확인해 주세요.")
            parent_ids = {product.get("parent_clientid") for product in source["products"] if product.get("parent_clientid")}
            source_productname = str(stock.get("productname") or stock.get("itemname") or stock["itemcode"]).strip()
            for product in source["products"]:
                product["processcodename"] = active_processes[product["processid"]]
                if product["clientid"] in parent_ids:
                    product["productno"] = None
                elif not product.get("productno"):
                    product_prefix = f"{source_productname}-{payload['processdate']:%Y%m%d}"
                    next_number = next_product_numbers.get(product_prefix)
                    if next_number is None:
                        first_productno = _next_productno(cursor, companyid, payload["processdate"], source_productname)
                        next_number = int(first_productno[-5:])
                    product["productno"] = f"{product_prefix}{next_number:05d}"
                    next_product_numbers[product_prefix] = next_number + 1

            line_no += 1
            source_line = line_no
            cursor.execute(
                """INSERT INTO Process02t
                   (companyid,companyname,processno,lineno,linetype,levelno,parentlineno,sourcelineno,
                    stocksourcetype,stocksourceno,stocksourceline,sourcewarehousecode,sourcewarehousecodename,
                             itemcode,itemname,productname,materialcode,materialname,surfacecode,surfacename,myrtle,
                    thickness,width,length,qty,qtyunit,weight,processid,processcodename,unit,unitprice,
                    supplyamt,vat,unitamt,description,created_by,updated_by)
                   VALUES (%s,%s,%s,%s,'SOURCE',0,NULL,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                           %s,%s,%s,%s,%s,%s,NULL,NULL,%s,0,0,0,0,NULL,%s,%s)""",
                (companyid, companyname, processno, source_line, source_line, *key,
                 stock["warehousecode"], stock["warehousecodename"], stock["itemcode"], stock["itemname"],
                 stock.get("productname"), stock.get("materialcode"), stock.get("materialname"),
                 stock.get("surfacecode"), stock.get("surfacename"), stock.get("myrtle"),
                 stock.get("thickness"), stock.get("width"), stock.get("length"), qty, stock.get("qtyunit"), weight,
                 stock.get("unit"), detail_created_by, detail_updated_by),
            )
            cursor.execute(
                """UPDATE CurrentStock01t SET qty=qty-%s,weight=weight-%s,updated_at=CURRENT_TIMESTAMP,
                          updated_by=COALESCE(%s,updated_by)
                   WHERE companyid=%s AND sourcetype=%s AND sourceno=%s AND sourceline=%s
                     AND qty>=%s AND weight>=%s""",
                (qty, weight, actor or None, companyid, *key, qty, weight),
            )
            if cursor.rowcount != 1:
                raise ValueError("원천 재고가 다른 작업에서 변경되었습니다. 현재고를 다시 조회해 주세요.")
            iniop_out.append((source_line, stock, qty, weight))

            products = source["products"]
            line_by_id = {}
            level_by_id = {}
            pending = list(products)
            while pending:
                progressed = False
                for product in pending[:]:
                    parent_id = product.get("parent_clientid")
                    if parent_id and parent_id not in line_by_id:
                        continue
                    line_no += 1
                    parent_line = line_by_id.get(parent_id, source_line)
                    level = level_by_id.get(parent_id, 0) + 1
                    line_by_id[product["clientid"]] = line_no
                    level_by_id[product["clientid"]] = level
                    amount = (Decimal(str(product["unitprice"])) * (Decimal(str(product["weight"])) if product["unit"].upper() == "KG" else Decimal(str(product["qty"])))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                    vat = (amount * Decimal("0.10")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                    total = amount + vat
                    cursor.execute(
                        """INSERT INTO Process02t
                           (companyid,companyname,processno,lineno,linetype,levelno,parentlineno,sourcelineno,
                             itemcode,itemname,productname,materialcode,materialname,surfacecode,surfacename,myrtle,
                            thickness,width,length,qty,qtyunit,weight,lossweight,processid,processcodename,unit,unitprice,
                            supplyamt,vat,unitamt,description,created_by,updated_by)
                            VALUES (%s,%s,%s,%s,'PRODUCT',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                                    %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                        (companyid, companyname, processno, line_no, level, parent_line, source_line,
                         stock["itemcode"], product["productname"], product["productno"], stock.get("materialcode"),
                         stock.get("materialname"), stock.get("surfacecode"), stock.get("surfacename"), stock.get("myrtle"),
                         product.get("thickness"), product.get("width"), product.get("length"), product["qty"],
                         product["qtyunit"], product["weight"], product.get("lossweight") or 0, product["processid"], product["processcodename"],
                         product["unit"], product["unitprice"], amount, vat, total, product.get("description") or None,
                         detail_created_by, detail_updated_by),
                    )
                    pending.remove(product)
                    progressed = True
                if not progressed:
                    raise ValueError("가공 단계의 부모·자식 순서를 구성할 수 없습니다.")

            for product in products:
                if product["clientid"] in parent_ids:
                    continue
                output_line = line_by_id[product["clientid"]]
                product_stock.append((output_line, stock, product))
                iniop_in.append((output_line, stock, product))

        for lineno, stock, qty, weight in iniop_out:
            cursor.execute(
                """INSERT INTO Iniop01t
                   (companyid,companyname,iniodate,iniotype,receiptno,lineno,customcode,customname,
                    itemcode,itemname,productname,materialcode,materialname,surfacecode,surfacename,myrtle,manager,
                    thickness,width,length,qty,qtyunit,weight,warehousecode,warehousecodename,unit,unitprice,supplyamt,vat,unitamt,
                    created_by,updated_by)
                   VALUES (%s,%s,%s,'OUT',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,0,0,0,0,%s,%s)""",
                (companyid, companyname, payload["processdate"], processno, lineno, payload["customcode"], customname,
                 stock["itemcode"], stock["itemname"], stock.get("productname"), stock.get("materialcode"), stock.get("materialname"),
                 stock.get("surfacecode"), stock.get("surfacename"), stock.get("myrtle"), payload.get("manager") or None,
                 stock.get("thickness"), stock.get("width"), stock.get("length"), qty, stock.get("qtyunit"), weight,
                 stock["warehousecode"], stock["warehousecodename"], stock.get("unit"), detail_created_by, detail_updated_by),
            )

        for lineno, stock, product in iniop_in:
            # 가공입고 중량 = 제품(이론) 중량 + 배부 로스 → 원소재 투입중량이 그대로 가공품 재고로 넘어간다 (실중량은 매출에서 조정)
            stock_weight = Decimal(str(product["weight"])) + Decimal(str(product.get("lossweight") or 0))
            amount = (Decimal(str(product["unitprice"])) * (Decimal(str(product["weight"])) if product["unit"].upper() == "KG" else Decimal(str(product["qty"])))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            vat = (amount * Decimal("0.10")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            cursor.execute(
                """INSERT INTO Iniop01t
                   (companyid,companyname,iniodate,iniotype,receiptno,lineno,customcode,customname,
                    itemcode,itemname,productname,materialcode,materialname,surfacecode,surfacename,myrtle,manager,
                    thickness,width,length,qty,qtyunit,weight,warehousecode,warehousecodename,unit,unitprice,supplyamt,vat,unitamt,
                    created_by,updated_by)
                   VALUES (%s,%s,%s,'IN',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (companyid, companyname, payload["processdate"], processno, lineno, payload["customcode"], customname,
                  stock["itemcode"], product["productname"], product["productno"], stock.get("materialcode"), stock.get("materialname"),
                 stock.get("surfacecode"), stock.get("surfacename"), stock.get("myrtle"), payload.get("manager") or None,
                 *_stock_dimensions(product), product["qty"], product["qtyunit"],
                 stock_weight, payload["warehousecode"], warehouse_name, product["unit"], product["unitprice"], amount, vat, amount + vat,
                 detail_created_by, detail_updated_by),
            )
            cursor.execute(
                """INSERT INTO CurrentStock01t
                   (companyid,companyname,customcode,customname,sourcetype,sourceno,sourceline,receiptdate,
                    itemcode,itemname,productname,materialcode,materialname,surfacecode,surfacename,myrtle,manager,
                    thickness,width,length,originalqty,qty,qtyunit,originalweight,weight,unit,unitprice,
                    warehousecode,warehousecodename,created_by,updated_by)
                    VALUES (%s,%s,%s,%s,'INBOUND',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (companyid, companyname, payload["customcode"], customname, processno, lineno, payload["processdate"],
                  stock["itemcode"], product["productname"], product["productno"], stock.get("materialcode"), stock.get("materialname"),
                 stock.get("surfacecode"), stock.get("surfacename"), stock.get("myrtle"), payload.get("manager") or None,
                 *_stock_dimensions(product), product["qty"], product["qty"],
                 product["qtyunit"], stock_weight, stock_weight, product["unit"], product["unitprice"],
                 payload["warehousecode"], warehouse_name, detail_created_by, detail_updated_by),
            )

        cursor.execute("UPDATE Process01t SET subulyn='Y',updatedat=CURRENT_TIMESTAMP WHERE companyid=%s AND processno=%s", (companyid, processno))
        for linked_plan in {old_planno, planno} - {None}:
            _sync_plan_status(cursor, companyid, linked_plan, actor)
        product_numbers = {
            product["clientid"]: product["productno"]
            for source in payload["sources"] for product in source["products"]
        }
        return {"processno": processno, "source_count": len(payload["sources"]),
                "product_count": len(product_stock), "product_numbers": product_numbers}


def delete_documents(companyid: str, processnos: list[str], actor: str | None = None):
    deleted = []
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"stand-stock:{companyid}",))
        for processno in dict.fromkeys(processnos):
            cursor.execute(
                "SELECT processno, processdate FROM Process01t WHERE companyid=%s AND processno=%s FOR UPDATE",
                (companyid, processno),
            )
            header = cursor.fetchone()
            if not header:
                raise ValueError(f"가공전표를 찾을 수 없습니다: {processno}")
            month_close_module.ensure_open(cursor, companyid, [header[1]], "삭제")
            cursor.execute("SELECT planno FROM Process01t WHERE companyid=%s AND processno=%s", (companyid, processno))
            linked_plan = cursor.fetchone()[0]

            cursor.execute(
                """SELECT lineno, stocksourcetype, stocksourceno, stocksourceline, qty, weight
                   FROM Process02t
                   WHERE companyid=%s AND processno=%s AND linetype='SOURCE'
                   ORDER BY lineno FOR UPDATE""",
                (companyid, processno),
            )
            sources = cursor.fetchall()
            if not sources:
                raise ValueError(f"가공전표의 원소재 내역을 찾을 수 없습니다: {processno}")

            cursor.execute(
                """SELECT d.lineno
                   FROM Process02t d
                   WHERE d.companyid=%s AND d.processno=%s AND d.linetype='PRODUCT'
                     AND NOT EXISTS (
                         SELECT 1 FROM Process02t child
                         WHERE child.companyid=d.companyid AND child.processno=d.processno
                           AND child.parentlineno=d.lineno
                     )
                   ORDER BY d.lineno""",
                (companyid, processno),
            )
            output_lines = [row[0] for row in cursor.fetchall()]
            for output_line in output_lines:
                cursor.execute(
                    """SELECT
                           EXISTS (
                               SELECT 1 FROM Outbound02t
                               WHERE companyid=%s AND stocksourcetype IN ('INBOUND', 'PROCESS')
                                 AND stocksourceno=%s AND stocksourceline=%s
                           )
                           OR EXISTS (
                               SELECT 1 FROM Process02t
                               WHERE companyid=%s AND linetype='SOURCE'
                                 AND stocksourcetype IN ('INBOUND', 'PROCESS')
                                 AND stocksourceno=%s AND stocksourceline=%s
                           )
                           OR EXISTS (
                               SELECT 1 FROM inoutmove02t
                               WHERE companyid=%s AND stocksourcetype IN ('INBOUND', 'PROCESS')
                                 AND stocksourceno=%s AND stocksourceline=%s
                           )""",
                    (
                        companyid, processno, output_line,
                        companyid, processno, output_line,
                        companyid, processno, output_line,
                    ),
                )
                if cursor.fetchone()[0]:
                    raise ValueError(
                        f"{processno} 가공품이 출고·재고이전·후속 가공에 사용되어 전표를 삭제할 수 없습니다."
                    )
            ensure_not_linked(cursor, companyid, {(t, processno, line) for line in output_lines for t in ("INBOUND", "PROCESS")},
                              action="삭제")
            for output_line in output_lines:
                cursor.execute(
                    """DELETE FROM CurrentStock01t
                       WHERE companyid=%s AND sourcetype IN ('INBOUND', 'PROCESS')
                         AND sourceno=%s AND sourceline=%s
                         AND qty=originalqty AND weight=originalweight""",
                    (companyid, processno, output_line),
                )
                if cursor.rowcount != 1:
                    raise ValueError(
                        f"{processno} 가공품 재고가 출고 또는 후속 가공에 사용되어 전표를 삭제할 수 없습니다."
                    )

            for _line_no, source_type, source_no, source_line, qty, weight in sources:
                cursor.execute(
                    """UPDATE CurrentStock01t
                       SET qty=qty+%s, weight=weight+%s, updated_at=CURRENT_TIMESTAMP,
                           updated_by=COALESCE(%s, updated_by)
                       WHERE companyid=%s AND sourcetype=%s AND sourceno=%s AND sourceline=%s
                         AND qty+%s<=originalqty AND weight+%s<=originalweight""",
                    (qty, weight, actor or None, companyid, source_type, source_no, source_line, qty, weight),
                )
                if cursor.rowcount != 1:
                    raise ValueError(
                        f"{processno} 원소재 재고를 복구하지 못했습니다. 현재고를 확인해 주세요."
                    )

            cursor.execute(
                "DELETE FROM Iniop01t WHERE companyid=%s AND receiptno=%s AND iniotype IN ('IN', 'OUT')",
                (companyid, processno),
            )
            cursor.execute("DELETE FROM Process02t WHERE companyid=%s AND processno=%s", (companyid, processno))
            cursor.execute("DELETE FROM Process01t WHERE companyid=%s AND processno=%s", (companyid, processno))
            if cursor.rowcount != 1:
                raise ValueError(f"가공전표 삭제에 실패했습니다: {processno}")
            if linked_plan:
                _sync_plan_status(cursor, companyid, linked_plan, actor)
            deleted.append(processno)
    return deleted
