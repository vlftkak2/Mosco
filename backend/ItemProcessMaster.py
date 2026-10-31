import logging
from contextlib import contextmanager

from psycopg2.pool import ThreadedConnectionPool
from pydantic import BaseModel, Field, field_validator, model_validator

from config import DB_CONFIG


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


class ProcessRuleInput(BaseModel):
    itemcode: str = Field(min_length=1, max_length=100)
    processid: str = Field(min_length=1, max_length=100)
    original_processid: str | None = Field(default=None, max_length=100)
    processnm: str = Field(min_length=1, max_length=100)
    steelgradeyn: str = Field(default="N", max_length=1)
    surfaceyn: str = Field(default="N", max_length=1)
    thicknessyn: str = Field(default="N", max_length=1)
    widthyn: str = Field(default="N", max_length=1)
    lengthyn: str = Field(default="N", max_length=1)
    description: str = Field(default="", max_length=500)
    is_new: bool = False

    @field_validator("itemcode", "processid", "processnm", "description")
    @classmethod
    def strip_text(cls, value: str) -> str:
        return value.strip()

    @field_validator("original_processid")
    @classmethod
    def strip_original_processid(cls, value: str | None) -> str | None:
        return value.strip() if value else None

    @field_validator("steelgradeyn", "surfaceyn", "thicknessyn", "widthyn", "lengthyn")
    @classmethod
    def validate_yes_no(cls, value: str) -> str:
        normalized = value.strip().upper()
        if normalized not in {"Y", "N"}:
            raise ValueError("적용 여부는 Y 또는 N이어야 합니다.")
        return normalized


class ProcessRuleSaveRequest(BaseModel):
    items: list[ProcessRuleInput] = Field(min_length=1, max_length=1000)

    @model_validator(mode="after")
    def require_unique_keys(self):
        keys = [(item.itemcode.upper(), item.processid.upper()) for item in self.items]
        if len(keys) != len(set(keys)):
            raise ValueError("저장 목록에 원소재 품목과 가공공정이 중복되어 있습니다.")
        return self


class ProcessRuleKey(BaseModel):
    itemcode: str = Field(min_length=1, max_length=100)
    processid: str = Field(min_length=1, max_length=100)

    @field_validator("itemcode", "processid")
    @classmethod
    def strip_key(cls, value: str) -> str:
        return value.strip()


class ProcessRuleDeleteRequest(BaseModel):
    items: list[ProcessRuleKey] = Field(min_length=1, max_length=1000)


def _row_to_rule(row):
    keys = (
        "itemcode", "itemname", "itemtypecode", "itemtypecodenm",
        "processid", "processcodename", "processnm", "steelgradeyn",
        "surfaceyn", "thicknessyn", "widthyn", "lengthyn", "description",
        "created_at", "updated_at",
    )
    result = dict(zip(keys, row))
    for key in keys[:-2]:
        if result[key] is None:
            result[key] = ""
    for key in ("steelgradeyn", "surfaceyn", "thicknessyn", "widthyn", "lengthyn"):
        result[key] = str(result[key] or "N").strip().upper()
    result["is_new"] = False
    return result


def list_rules(
    companyid: str,
    query: str = "",
    process_name: str = "",
    itemtype_name: str = "",
    output_name: str = "",
):
    where = ["r.companyid = %s"]
    params: list = [companyid]
    search = query.strip()
    if search:
        pattern = f"%{search}%"
        where.append("(r.itemcode ILIKE %s OR r.itemname ILIKE %s OR r.processnm ILIKE %s)")
        params.extend((pattern, pattern, pattern))
    if process_name.strip():
        where.append("(COALESCE(p.code_name, '') ILIKE %s OR r.processid ILIKE %s)")
        pattern = f"%{process_name.strip()}%"
        params.extend((pattern, pattern))
    if itemtype_name.strip():
        where.append("(COALESCE(r.itemtypecodenm, '') ILIKE %s OR COALESCE(r.itemtypecode, '') ILIKE %s)")
        pattern = f"%{itemtype_name.strip()}%"
        params.extend((pattern, pattern))
    if output_name.strip():
        where.append("r.processnm ILIKE %s")
        params.append(f"%{output_name.strip()}%")

    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            f"""SELECT r.itemcode, r.itemname, r.itemtypecode, r.itemtypecodenm,
                       r.processid, COALESCE(p.code_name, ''), r.processnm,
                       r.steelgradeyn, r.surfaceyn, r.thicknessyn, r.widthyn,
                       r.lengthyn, r.description, r.created_at, r.updated_at
                FROM ItemProcessrule01t r
                LEFT JOIN CodeMaster01t p
                  ON p.companyid = r.companyid
                 AND p.groupcode = 'PROCESS'
                 AND p.code = r.processid
                WHERE {' AND '.join(where)}
                 ORDER BY r.created_at, r.itemcode, r.processid""",
            params,
        )
        return [_row_to_rule(row) for row in cursor.fetchall()]


def list_filter_options(companyid: str):
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """SELECT code, code_name
               FROM CodeMaster01t
               WHERE companyid = %s AND groupcode = 'PROCESS'
                 AND UPPER(BTRIM(use_yn)) = 'Y'
               ORDER BY sort_order, code""",
            (companyid,),
        )
        processes = [{"code": row[0], "name": row[1] or row[0]} for row in cursor.fetchall()]
        cursor.execute(
            """SELECT DISTINCT itemtypecode, itemtypecodenm
               FROM ItemCode01t
               WHERE companyid = %s AND UPPER(BTRIM(use_yn)) = 'Y'
                 AND COALESCE(itemtypecode, '') <> ''
               ORDER BY itemtypecode""",
            (companyid,),
        )
        itemtypes = [{"code": row[0], "name": row[1] or row[0]} for row in cursor.fetchall()]
    return {"processes": processes, "itemtypes": itemtypes}


def search_active_items(companyid: str, query: str, page: int, page_size: int):
    where = "companyid = %s AND UPPER(BTRIM(use_yn)) = 'Y'"
    params: list = [companyid]
    search = query.strip()
    if search:
        pattern = f"%{search}%"
        where += " AND (itemcode ILIKE %s OR itemname ILIKE %s)"
        params.extend((pattern, pattern))
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(f"SELECT COUNT(*) FROM ItemCode01t WHERE {where}", params)
        total = cursor.fetchone()[0]
        cursor.execute(
            f"""SELECT itemcode, itemname, COALESCE(itemtypecode, ''), COALESCE(itemtypecodenm, '')
                FROM ItemCode01t WHERE {where}
                ORDER BY itemcode LIMIT %s OFFSET %s""",
            (*params, page_size, (page - 1) * page_size),
        )
        items = [
            {"itemcode": row[0], "itemname": row[1], "itemtypecode": row[2], "itemtypecodenm": row[3]}
            for row in cursor.fetchall()
        ]
    return {"items": items, "total": total, "page": page, "page_size": page_size}


def suggest_active_items(companyid: str, query: str, limit: int = 8):
    search = query.strip()
    if not search:
        return []
    pattern = f"%{search}%"
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """SELECT itemcode, itemname, COALESCE(itemtypecode, ''), COALESCE(itemtypecodenm, '')
               FROM ItemCode01t
               WHERE companyid = %s AND UPPER(BTRIM(use_yn)) = 'Y'
                 AND (itemcode ILIKE %s OR itemname ILIKE %s)
               ORDER BY
                 CASE
                   WHEN LOWER(BTRIM(itemcode)) = LOWER(%s) THEN 0
                   WHEN LOWER(BTRIM(itemname)) = LOWER(%s) THEN 1
                   WHEN LOWER(BTRIM(itemcode)) LIKE LOWER(%s) THEN 2
                   WHEN LOWER(BTRIM(itemname)) LIKE LOWER(%s) THEN 3
                   ELSE 4
                 END,
                 itemcode
               LIMIT %s""",
            (companyid, pattern, pattern, search, search, f"{search}%", f"{search}%", min(max(limit, 1), 8)),
        )
        return [
            {"itemcode": row[0], "itemname": row[1], "itemtypecode": row[2], "itemtypecodenm": row[3]}
            for row in cursor.fetchall()
        ]


def save_rules(companyid: str, companyname: str, items: list[dict]) -> int:
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"item-process:{companyid}",))
        itemcodes = sorted({item["itemcode"] for item in items})
        processids = sorted({item["processid"] for item in items})

        cursor.execute(
            """SELECT itemcode, itemname, COALESCE(itemtypecode, ''), COALESCE(itemtypecodenm, '')
               FROM ItemCode01t
               WHERE companyid = %s AND itemcode = ANY(%s)
                 AND UPPER(BTRIM(use_yn)) = 'Y'
               FOR SHARE""",
            (companyid, itemcodes),
        )
        item_master = {
            row[0]: {"itemname": row[1], "itemtypecode": row[2], "itemtypecodenm": row[3]}
            for row in cursor.fetchall()
        }
        missing_items = [code for code in itemcodes if code not in item_master]
        if missing_items:
            raise ValueError(f"사용 중인 원소재 품목을 확인해 주세요: {', '.join(missing_items[:5])}")

        cursor.execute(
            """SELECT code
               FROM CodeMaster01t
               WHERE companyid = %s AND groupcode = 'PROCESS' AND code = ANY(%s)
                 AND UPPER(BTRIM(use_yn)) = 'Y'
               FOR SHARE""",
            (companyid, processids),
        )
        active_processes = {row[0] for row in cursor.fetchall()}
        missing_processes = [code for code in processids if code not in active_processes]
        if missing_processes:
            raise ValueError(f"사용 중인 가공공정 코드를 확인해 주세요: {', '.join(missing_processes[:5])}")

        for item in items:
            master = item_master[item["itemcode"]]
            values = (
                item["processnm"], item["steelgradeyn"], item["surfaceyn"],
                item["thicknessyn"], item["widthyn"], item["lengthyn"],
                item.get("description") or None,
            )
            if item.get("is_new"):
                cursor.execute(
                    """INSERT INTO ItemProcessrule01t
                           (companyid, companyname, itemcode, itemname, itemtypecode,
                            itemtypecodenm, processid, processnm, steelgradeyn, surfaceyn,
                            thicknessyn, widthyn, lengthyn, description, created_at)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, clock_timestamp())""",
                    (
                        companyid, companyname, item["itemcode"], master["itemname"],
                        master["itemtypecode"], master["itemtypecodenm"], item["processid"],
                        *values,
                    ),
                )
            else:
                original_processid = item.get("original_processid") or item["processid"]
                cursor.execute(
                    """UPDATE ItemProcessrule01t
                       SET companyname = %s, itemname = %s, itemtypecode = %s,
                           itemtypecodenm = %s, processid = %s, processnm = %s,
                           steelgradeyn = %s, surfaceyn = %s, thicknessyn = %s, widthyn = %s, lengthyn = %s,
                           description = %s, updated_at = CURRENT_TIMESTAMP
                       WHERE companyid = %s AND itemcode = %s AND processid = %s""",
                    (
                        companyname, master["itemname"], master["itemtypecode"],
                        master["itemtypecodenm"], item["processid"], *values, companyid,
                        item["itemcode"], original_processid,
                    ),
                )
                if cursor.rowcount != 1:
                    raise ValueError(
                        f"수정할 가공공정 규칙을 찾을 수 없습니다: {item['itemcode']} / {original_processid}"
                    )
    return len(items)


def delete_rules(companyid: str, items: list[dict]) -> int:
    deleted_count = 0
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"item-process:{companyid}",))
        for item in items:
            cursor.execute(
                "DELETE FROM ItemProcessrule01t WHERE companyid = %s AND itemcode = %s AND processid = %s",
                (companyid, item["itemcode"], item["processid"]),
            )
            deleted_count += cursor.rowcount
    return deleted_count
