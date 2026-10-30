import logging
from contextlib import contextmanager
from datetime import date
from decimal import Decimal, ROUND_HALF_UP

from psycopg2.pool import ThreadedConnectionPool
from pydantic import BaseModel, Field, field_validator, model_validator

from config import DB_CONFIG


logger = logging.getLogger(__name__)
_POOL = ThreadedConnectionPool(
    minconn=1, maxconn=15, host=DB_CONFIG["host"], port=DB_CONFIG["port"],
    dbname=DB_CONFIG["database"], user=DB_CONFIG["user"],
    password=DB_CONFIG["password"], connect_timeout=5,
)


@contextmanager
def _connect():
    connection = _POOL.getconn()
    try:
        with connection:
            yield connection
    except Exception:
        _POOL.putconn(connection, close=True)
        connection = None
        raise
    finally:
        if connection is not None:
            _POOL.putconn(connection)


class ProductInput(BaseModel):
    clientid: str = Field(min_length=1, max_length=80)
    parent_clientid: str | None = Field(default=None, max_length=80)
    processid: str = Field(min_length=1, max_length=100)
    processcodename: str = Field(min_length=1, max_length=100)
    productname: str = Field(min_length=1, max_length=150)
    thickness: Decimal | None = Field(default=None, ge=0, max_digits=18, decimal_places=3)
    width: Decimal | None = Field(default=None, ge=0, max_digits=18, decimal_places=3)
    length: Decimal | None = Field(default=None, ge=0, max_digits=18, decimal_places=3)
    qty: Decimal = Field(gt=0, max_digits=18, decimal_places=3)
    qtyunit: str = Field(min_length=1, max_length=20)
    weight: Decimal = Field(gt=0, max_digits=18, decimal_places=3)
    unit: str = Field(default="KG", max_length=20)
    unitprice: Decimal = Field(default=0, ge=0, max_digits=18, decimal_places=3)
    description: str = Field(default="", max_length=500)

    @field_validator("clientid", "processid", "processcodename", "productname", "qtyunit", "unit", "description")
    @classmethod
    def strip_text(cls, value: str) -> str:
        return value.strip()

    @field_validator("parent_clientid")
    @classmethod
    def strip_parent(cls, value: str | None) -> str | None:
        return value.strip() if value and value.strip() else None

    @field_validator("thickness", "width", "length", mode="before")
    @classmethod
    def blank_dimension(cls, value):
        return None if value is None or str(value).strip() == "" else value


class SourceInput(BaseModel):
    stocksourcetype: str = Field(min_length=1, max_length=20)
    stocksourceno: str = Field(min_length=1, max_length=100)
    stocksourceline: int = Field(gt=0)
    qty: Decimal = Field(gt=0, max_digits=18, decimal_places=3)
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
    processdate: date
    customcode: str = Field(min_length=1, max_length=100)
    customname: str = Field(min_length=1, max_length=150)
    warehousecode: str = Field(min_length=1, max_length=50)
    warehousecodename: str = Field(min_length=1, max_length=100)
    manager: str = Field(default="", max_length=100)
    description: str = Field(default="", max_length=500)
    sources: list[SourceInput] = Field(min_length=1, max_length=1000)

    @field_validator("customcode", "customname", "warehousecode", "warehousecodename", "manager", "description")
    @classmethod
    def strip_text(cls, value: str) -> str:
        return value.strip()

    @model_validator(mode="after")
    def unique_sources(self):
        keys = [(x.stocksourcetype, x.stocksourceno, x.stocksourceline) for x in self.sources]
        if len(keys) != len(set(keys)):
            raise ValueError("동일한 현재고 원천 행을 한 전표에 중복 선택할 수 없습니다.")
        return self


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


def _validate_weight_tree(source: dict):
    tolerance = Decimal("0.001")
    products = source["products"]
    by_parent: dict[str | None, list[dict]] = {}
    for product in products:
        by_parent.setdefault(product.get("parent_clientid"), []).append(product)

    roots = by_parent.get(None, [])
    if not roots:
        raise ValueError("각 원소재에는 바로 아래 가공 결과가 한 개 이상 필요합니다.")
    if abs(sum((Decimal(str(x["weight"])) for x in roots), Decimal("0")) - Decimal(str(source["weight"]))) > tolerance:
        raise ValueError("원소재 투입 중량과 1차 가공품 중량 합계가 일치하지 않습니다.")

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
            child_weight = sum((Decimal(str(x["weight"])) for x in children), Decimal("0"))
            if abs(parent_weight - child_weight) > tolerance:
                raise ValueError(f"{by_id[clientid]['productname']}의 중량과 하위 가공품 중량 합계가 일치하지 않습니다.")
        visited.add(clientid)
        for child in children:
            visit(child["clientid"], path | {clientid})

    for root in roots:
        visit(root["clientid"], set())
    if len(visited) != len(products):
        raise ValueError("원소재와 연결되지 않은 가공 결과가 있습니다.")


def list_available_stock(companyid: str, page: int, page_size: int, q: str = "", warehouse: str = ""):
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
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(f"SELECT COUNT(*) FROM CurrentStock01t WHERE {' AND '.join(where)}", params)
        total = cursor.fetchone()[0]
        cursor.execute(
            f"""SELECT sourcetype, sourceno, sourceline, receiptdate, customcode, customname,
                       itemcode, itemname, productname, materialcode, materialname, surfacecode,
                       surfacename, myrtle, manager, thickness, width, length, qty, qtyunit,
                       weight, unit, unitprice, warehousecode, warehousecodename
                FROM CurrentStock01t WHERE {' AND '.join(where)}
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
            """SELECT r.itemcode, r.processid, COALESCE(c.code_name, r.processid), r.processnm
               FROM ItemProcessrule01t r
               LEFT JOIN CodeMaster01t c ON c.companyid=r.companyid AND c.groupcode='PROCESS' AND c.code=r.processid
               WHERE r.companyid=%s ORDER BY r.itemcode, r.processid""", (companyid,),
        )
        rules = [{"itemcode": r[0], "processid": r[1], "processname": r[2], "productname": r[3]} for r in cursor.fetchall()]
    return {"customers": customers, "warehouses": warehouses, "rules": rules}


def list_documents(companyid: str, date_from: date | None = None, date_to: date | None = None, q: str = ""):
    where = ["h.companyid = %s"]
    params: list = [companyid]
    if date_from:
        where.append("h.processdate >= %s")
        params.append(date_from)
    if date_to:
        where.append("h.processdate <= %s")
        params.append(date_to)
    if q.strip():
        pattern = f"%{q.strip()}%"
        where.append("(h.processno ILIKE %s OR h.customname ILIKE %s)")
        params.extend((pattern, pattern))
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            f"""SELECT h.processno, h.processdate, h.customcode, h.customname,
                       h.warehousecode, h.warehousecodename, h.manager, h.subulyn,
                       COUNT(*) FILTER (WHERE d.linetype='SOURCE') AS source_count,
                       COALESCE(SUM(d.weight) FILTER (WHERE d.linetype='SOURCE'), 0) AS source_weight
                FROM Process01t h LEFT JOIN Process02t d
                  ON d.companyid=h.companyid AND d.processno=h.processno
                WHERE {' AND '.join(where)}
                GROUP BY h.companyid,h.processno,h.processdate,h.customcode,h.customname,
                         h.warehousecode,h.warehousecodename,h.manager,h.subulyn
                ORDER BY h.processdate DESC,h.processno DESC""", params,
        )
        return [_row_dict(cursor, row) for row in cursor.fetchall()]


def get_document(companyid: str, processno: str):
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """SELECT processno,processdate,customcode,customname,warehousecode,warehousecodename,
                      manager,subulyn,description
               FROM Process01t WHERE companyid=%s AND processno=%s""",
            (companyid, processno),
        )
        row = cursor.fetchone()
        if not row:
            return None
        header = _row_dict(cursor, row)
        cursor.execute(
            """SELECT lineno,linetype,levelno,parentlineno,sourcelineno,stocksourcetype,stocksourceno,
                      stocksourceline,sourcewarehousecode,sourcewarehousecodename,itemcode,itemname,
                      productname,materialcode,materialname,surfacecode,surfacename,myrtle,thickness,width,
                      length,qty,qtyunit,weight,processid,processcodename,unit,unitprice,supplyamt,vat,
                      unitamt,description
               FROM Process02t WHERE companyid=%s AND processno=%s ORDER BY lineno""",
            (companyid, processno),
        )
        details = [_row_dict(cursor, detail) for detail in cursor.fetchall()]
    sources = []
    products_by_source = {}
    for detail in details:
        if detail["linetype"] == "SOURCE":
            sources.append({"source": detail, "products": []})
            products_by_source[detail["lineno"]] = sources[-1]["products"]
        else:
            products_by_source.setdefault(detail["sourcelineno"], []).append(detail)
    return {"header": header, "sources": sources}


def save_document(companyid: str, companyname: str, payload: dict):
    companyname = str(companyname)[:50]
    for source in payload["sources"]:
        _validate_weight_tree(source)
    with _connect() as connection, connection.cursor() as cursor:
        # 입고·출고·기초재고와 같은 회사별 재고 잠금을 공유해 동시 차감 순서를 직렬화한다.
        cursor.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"stand-stock:{companyid}",))
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

        cursor.execute(
            """INSERT INTO Process01t
               (companyid,companyname,processno,processdate,customcode,customname,
                warehousecode,warehousecodename,manager,subulyn,description)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,'N',%s)""",
            (companyid, companyname, processno, payload["processdate"], payload["customcode"], customname,
             payload["warehousecode"], warehouse_name, payload.get("manager") or None, payload.get("description") or None),
        )

        line_no = 0
        iniop_out = []
        iniop_in = []
        product_stock = []
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

            requested_processes = sorted({product["processid"] for product in source["products"]})
            cursor.execute(
                """SELECT r.processid,COALESCE(c.code_name,r.processid),r.processnm
                   FROM ItemProcessrule01t r
                   LEFT JOIN CodeMaster01t c
                     ON c.companyid=r.companyid AND c.groupcode='PROCESS' AND c.code=r.processid
                   WHERE r.companyid=%s AND r.itemcode=%s AND r.processid=ANY(%s)""",
                (companyid, stock["itemcode"], requested_processes),
            )
            allowed_rules = {row[0]: {"processname": row[1], "productname": row[2]} for row in cursor.fetchall()}
            if len(allowed_rules) != len(requested_processes):
                raise ValueError(f"{stock['itemname']}에 등록되지 않은 가공공정이 포함되어 있습니다.")
            for product in source["products"]:
                product["processcodename"] = allowed_rules[product["processid"]]["processname"]

            line_no += 1
            source_line = line_no
            cursor.execute(
                """INSERT INTO Process02t
                   (companyid,companyname,processno,lineno,linetype,levelno,parentlineno,sourcelineno,
                    stocksourcetype,stocksourceno,stocksourceline,sourcewarehousecode,sourcewarehousecodename,
                    itemcode,itemname,productname,materialcode,materialname,surfacecode,surfacename,myrtle,
                    thickness,width,length,qty,qtyunit,weight,processid,processcodename,unit,unitprice,
                    supplyamt,vat,unitamt,description)
                   VALUES (%s,%s,%s,%s,'SOURCE',0,NULL,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                           %s,%s,%s,%s,%s,%s,NULL,NULL,%s,0,0,0,0,NULL)""",
                (companyid, companyname, processno, source_line, source_line, *key,
                 stock["warehousecode"], stock["warehousecodename"], stock["itemcode"], stock["itemname"],
                 stock.get("productname"), stock.get("materialcode"), stock.get("materialname"),
                 stock.get("surfacecode"), stock.get("surfacename"), stock.get("myrtle"),
                 stock.get("thickness"), stock.get("width"), stock.get("length"), qty, stock.get("qtyunit"), weight,
                 stock.get("unit")),
            )
            cursor.execute(
                """UPDATE CurrentStock01t SET qty=qty-%s,weight=weight-%s,updated_at=CURRENT_TIMESTAMP
                   WHERE companyid=%s AND sourcetype=%s AND sourceno=%s AND sourceline=%s
                     AND qty>=%s AND weight>=%s""",
                (qty, weight, companyid, *key, qty, weight),
            )
            if cursor.rowcount != 1:
                raise ValueError("원천 재고가 다른 작업에서 변경되었습니다. 현재고를 다시 조회해 주세요.")
            iniop_out.append((source_line, stock, qty, weight))

            products = source["products"]
            by_id = {p["clientid"]: p for p in products}
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
                            thickness,width,length,qty,qtyunit,weight,processid,processcodename,unit,unitprice,
                            supplyamt,vat,unitamt,description)
                           VALUES (%s,%s,%s,%s,'PRODUCT',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                                   %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                        (companyid, companyname, processno, line_no, level, parent_line, source_line,
                         stock["itemcode"], stock["itemname"], product["productname"], stock.get("materialcode"),
                         stock.get("materialname"), stock.get("surfacecode"), stock.get("surfacename"), stock.get("myrtle"),
                         product.get("thickness"), product.get("width"), product.get("length"), product["qty"],
                         product["qtyunit"], product["weight"], product["processid"], product["processcodename"],
                         product["unit"], product["unitprice"], amount, vat, total, product.get("description") or None),
                    )
                    pending.remove(product)
                    progressed = True
                if not progressed:
                    raise ValueError("가공 단계의 부모·자식 순서를 구성할 수 없습니다.")

            parent_ids = {p.get("parent_clientid") for p in products if p.get("parent_clientid")}
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
                    thickness,width,length,qty,qtyunit,weight,warehousecode,warehousecodename,unit,unitprice,supplyamt,vat,unitamt)
                   VALUES (%s,%s,%s,'OUT',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,0,0,0,0)""",
                (companyid, companyname, payload["processdate"], processno, lineno, payload["customcode"], customname,
                 stock["itemcode"], stock["itemname"], stock.get("productname"), stock.get("materialcode"), stock.get("materialname"),
                 stock.get("surfacecode"), stock.get("surfacename"), stock.get("myrtle"), payload.get("manager") or None,
                 stock.get("thickness"), stock.get("width"), stock.get("length"), qty, stock.get("qtyunit"), weight,
                 stock["warehousecode"], stock["warehousecodename"], stock.get("unit")),
            )

        for lineno, stock, product in iniop_in:
            amount = (Decimal(str(product["unitprice"])) * (Decimal(str(product["weight"])) if product["unit"].upper() == "KG" else Decimal(str(product["qty"])))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            vat = (amount * Decimal("0.10")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            cursor.execute(
                """INSERT INTO Iniop01t
                   (companyid,companyname,iniodate,iniotype,receiptno,lineno,customcode,customname,
                    itemcode,itemname,productname,materialcode,materialname,surfacecode,surfacename,myrtle,manager,
                    thickness,width,length,qty,qtyunit,weight,warehousecode,warehousecodename,unit,unitprice,supplyamt,vat,unitamt)
                   VALUES (%s,%s,%s,'IN',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (companyid, companyname, payload["processdate"], processno, lineno, payload["customcode"], customname,
                 stock["itemcode"], stock["itemname"], product["productname"], stock.get("materialcode"), stock.get("materialname"),
                 stock.get("surfacecode"), stock.get("surfacename"), stock.get("myrtle"), payload.get("manager") or None,
                 product.get("thickness"), product.get("width"), product.get("length"), product["qty"], product["qtyunit"],
                 product["weight"], payload["warehousecode"], warehouse_name, product["unit"], product["unitprice"], amount, vat, amount + vat),
            )
            cursor.execute(
                """INSERT INTO CurrentStock01t
                   (companyid,companyname,customcode,customname,sourcetype,sourceno,sourceline,receiptdate,
                    itemcode,itemname,productname,materialcode,materialname,surfacecode,surfacename,myrtle,manager,
                    thickness,width,length,originalqty,qty,qtyunit,originalweight,weight,unit,unitprice,
                    warehousecode,warehousecodename)
                   VALUES (%s,%s,%s,%s,'PROCESS',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (companyid, companyname, payload["customcode"], customname, processno, lineno, payload["processdate"],
                 stock["itemcode"], stock["itemname"], product["productname"], stock.get("materialcode"), stock.get("materialname"),
                 stock.get("surfacecode"), stock.get("surfacename"), stock.get("myrtle"), payload.get("manager") or None,
                 product.get("thickness"), product.get("width"), product.get("length"), product["qty"], product["qty"],
                 product["qtyunit"], product["weight"], product["weight"], product["unit"], product["unitprice"],
                 payload["warehousecode"], warehouse_name),
            )

        cursor.execute("UPDATE Process01t SET subulyn='Y',updatedat=CURRENT_TIMESTAMP WHERE companyid=%s AND processno=%s", (companyid, processno))
        return {"processno": processno, "source_count": len(payload["sources"]), "product_count": len(product_stock)}
