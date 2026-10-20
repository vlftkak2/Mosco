import logging
from contextlib import contextmanager

import psycopg2
from psycopg2.pool import ThreadedConnectionPool

from config import DB_CONFIG

logger = logging.getLogger(__name__)

# Each group exposes one property while other legacy property columns remain untouched.
CODE_GROUPS = [
    ("MATERIAL", "강종구분", ("비중",)),
    ("SHAPE", "형태구분", ("속성",)),
    ("PROCESS", "공정구분", ("속성",)),
    ("OTHER_COST", "기타비용코드", ("속성",)),
    ("PRICE_UNIT", "단가단위", ("속성",)),
    ("QTY", "수량단위", ("속성",)),
    ("BANK", "은행코드", ("속성",)),
    ("JOB", "직위구분", ("속성",)),
    ("WAREHOUSE", "창고", ("소속사업장",)),
    ("SURFACE", "표면", ("속성",)),
]
GROUP_NAMES = {code: name for code, name, _ in CODE_GROUPS}
GROUP_PROPERTIES = {code: properties for code, _, properties in CODE_GROUPS}
GROUP_PROPERTY_COLUMNS = {groupcode: 1 for groupcode, _, _ in CODE_GROUPS}
ACTIVE_VALUE = "Y"
INACTIVE_VALUE = "N"
# 단가와 수량 단위는 화면/API에서 조회 전용으로 유지합니다.
READ_ONLY_GROUPS = {"PRICE_UNIT", "QTY"}


def _ensure_group_writable(groupcode: str) -> None:
    if groupcode in READ_ONLY_GROUPS:
        raise CodeMasterConflictError("단가단위와 수량단위 코드는 현재 조회만 가능합니다.")


def _group_property_index(groupcode: str) -> int:
    return GROUP_PROPERTY_COLUMNS[groupcode]


_CONNECTION_POOL = ThreadedConnectionPool(
    minconn=1,
    maxconn=20,
    host=DB_CONFIG["host"],
    port=DB_CONFIG["port"],
    dbname=DB_CONFIG["database"],
    user=DB_CONFIG["user"],
    password=DB_CONFIG["password"],
    connect_timeout=5,
)


@contextmanager
def _connect():
    """Borrow a pooled connection and always return it after the transaction."""
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


class CodeMasterDatabaseError(Exception):
    pass


class CodeMasterConflictError(Exception):
    pass


def list_groups(companyid: str) -> list[dict]:
    try:
        with _connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT groupcode, groupname, code, code_name,
                       property1, property2, property3, property4,
                       sort_order, use_yn, description
                FROM CodeMaster01t
                WHERE companyid = %s AND groupcode = ANY(%s)
                ORDER BY groupcode, sort_order, code
                """,
                (companyid, list(GROUP_NAMES)),
            )
            records = cursor.fetchall()

        groups = {
            code: {
                "id": code,
                "groupcode": code,
                "name": name,
                "property_labels": list(GROUP_PROPERTIES[code]),
                "property_index": _group_property_index(code),
                "description": f"{name} 코드",
                "rows": [],
            }
            for code, name, _ in CODE_GROUPS
        }
        for (groupcode, _groupname, code, codename, property1, property2,
             property3, property4, sortorder, useyn, description) in records:
            groups[groupcode]["rows"].append({
                "id": f"{groupcode}:{code}",
                "code": code,
                "name": codename,
                "properties": [property1 or "", property2 or "", property3 or "", property4 or ""],
                "order": sortorder,
                "use": str(useyn).strip() in (ACTIVE_VALUE, "Y"),
                "description": description or "",
            })
        return list(groups.values())
    except Exception as error:
        logger.exception("Failed to list common code groups")
        raise CodeMasterDatabaseError from error


def list_group_summaries(companyid: str) -> list[dict]:
    """Return per-company counts and the first page for instant group switching."""
    try:
        with _connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT requested.groupcode,
                       COALESCE(summary.row_count, 0)::integer AS row_count,
                       COALESCE(summary.max_order, 0) AS max_order,
                       preview.code, preview.code_name,
                       preview.property1, preview.property2, preview.property3, preview.property4,
                       preview.sort_order, preview.use_yn, preview.description
                FROM unnest(%s::varchar[]) AS requested(groupcode)
                LEFT JOIN LATERAL (
                    SELECT COUNT(*) AS row_count, MAX(sort_order) AS max_order
                    FROM CodeMaster01t
                    WHERE companyid = %s AND groupcode = requested.groupcode
                ) AS summary ON TRUE
                LEFT JOIN LATERAL (
                    SELECT code, code_name, property1, property2, property3, property4,
                           sort_order, use_yn, description
                    FROM CodeMaster01t
                    WHERE companyid = %s AND groupcode = requested.groupcode
                    ORDER BY sort_order, code
                    LIMIT 45
                ) AS preview ON TRUE
                ORDER BY requested.groupcode, preview.sort_order, preview.code
                """,
                (list(GROUP_NAMES), companyid, companyid),
            )
            previews = {}
            for (groupcode, row_count, max_order, code, code_name, property1, property2,
                 property3, property4, sort_order, use_yn, description) in cursor.fetchall():
                group = previews.setdefault(groupcode, {
                    "row_count": row_count,
                    "max_order": max_order,
                    "items": [],
                })
                group["items"].append({
                    "id": f"{groupcode}:{code}",
                    "code": code,
                    "name": code_name,
                    "properties": [property1 or "", property2 or "", property3 or "", property4 or ""],
                    "order": sort_order,
                    "use": str(use_yn).strip() == ACTIVE_VALUE,
                    "description": description or "",
                    "isNew": False,
                    "isDirty": False,
                })

        return [
            {
                "id": groupcode,
                "groupcode": groupcode,
                "name": name,
                "property_labels": list(GROUP_PROPERTIES[groupcode]),
                "property_index": _group_property_index(groupcode),
                "row_count": previews.get(groupcode, {}).get("row_count", 0),
                "max_order": previews.get(groupcode, {}).get("max_order", 0),
                "initial_items": previews.get(groupcode, {}).get("items", []),
            }
            for groupcode, name, _ in CODE_GROUPS
        ]
    except Exception as error:
        logger.exception("Failed to list common code group summaries")
        raise CodeMasterDatabaseError from error


def list_group_items(
    companyid: str,
    groupcode: str,
    page: int,
    page_size: int,
    query: str = "",
    include_total: bool = True,
) -> dict:
    """Return one company-scoped page of code rows and the matching total."""
    if groupcode not in GROUP_NAMES:
        return {"items": [], "total": 0}
    try:
        search = query.strip()
        where = "companyid = %s AND groupcode = %s"
        params: list = [companyid, groupcode]
        if search:
            where += " AND (code ILIKE %s OR code_name ILIKE %s)"
            pattern = f"%{search}%"
            params.extend((pattern, pattern))

        with _connect() as connection, connection.cursor() as cursor:
            total = None
            if include_total:
                cursor.execute(f"SELECT COUNT(*) FROM CodeMaster01t WHERE {where}", params)
                total = cursor.fetchone()[0]
            cursor.execute(
                f"""
                SELECT code, code_name, property1, property2, property3, property4,
                       sort_order, use_yn, description
                FROM CodeMaster01t
                WHERE {where}
                ORDER BY sort_order, code
                LIMIT %s OFFSET %s
                """,
                (*params, page_size, (page - 1) * page_size),
            )
            records = cursor.fetchall()

        items = [{
            "id": f"{groupcode}:{code}",
            "code": code,
            "name": code_name,
            "properties": [property1 or "", property2 or "", property3 or "", property4 or ""],
            "order": sort_order,
            "use": str(use_yn).strip() == ACTIVE_VALUE,
            "description": description or "",
            "isNew": False,
            "isDirty": False,
        } for (code, code_name, property1, property2, property3, property4,
               sort_order, use_yn, description) in records]
        return {"items": items, "total": total}
    except Exception as error:
        logger.exception("Failed to list common codes page")
        raise CodeMasterDatabaseError from error


def save_group(companyid: str, companyname: str, groupcode: str, items: list[dict]) -> bool:
    groupname = GROUP_NAMES.get(groupcode)
    if groupname is None:
        return False
    _ensure_group_writable(groupcode)
    try:
        with _connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT pg_advisory_xact_lock(hashtext(%s)::bigint)",
                (f"{companyid}:{groupcode}",),
            )
            cursor.execute(
                "SELECT code FROM CodeMaster01t WHERE companyid = %s AND groupcode = %s AND code = ANY(%s) FOR UPDATE",
                (companyid, groupcode, [item["code"] for item in items]),
            )
            existing_codes = {row[0] for row in cursor.fetchall()}
            property_column = f"property{_group_property_index(groupcode)}"
            for item in items:
                code = item["code"]
                if item.get("is_new"):
                    if code in existing_codes:
                        raise CodeMasterConflictError(f"코드 {code}가 이미 등록되어 있습니다. 다시 조회해 주세요.")
                    properties = [None, None, None, None]
                    properties[_group_property_index(groupcode) - 1] = item.get("property") or None
                    cursor.execute(
                        """
                        INSERT INTO CodeMaster01t (
                            companyid, companyname, groupcode, groupname, code, code_name,
                            property1, property2, property3, property4,
                            sort_order, use_yn, description, created_at
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                                  CURRENT_TIMESTAMP)
                        ON CONFLICT (companyid, groupcode, code) DO NOTHING
                        """,
                        (companyid, companyname, groupcode, groupname, code, item["codename"],
                         *properties, item["sortorder"], ACTIVE_VALUE if item.get("use", True) else INACTIVE_VALUE,
                         item.get("description") or None),
                    )
                    if cursor.rowcount == 0:
                        raise CodeMasterConflictError(f"코드 {code}가 이미 등록되어 있습니다. 다시 조회해 주세요.")
                    existing_codes.add(code)
                    continue

                if code not in existing_codes:
                    raise CodeMasterConflictError(f"코드 {code}가 변경되었거나 삭제되었습니다. 다시 조회해 주세요.")
                cursor.execute(
                    f"""
                    UPDATE CodeMaster01t
                    SET code_name = %s, {property_column} = %s,
                        sort_order = %s, use_yn = %s, description = %s,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE companyid = %s AND groupcode = %s AND code = %s
                    """,
                    (item["codename"], item.get("property") or None, item["sortorder"],
                     ACTIVE_VALUE if item.get("use", True) else INACTIVE_VALUE,
                     item.get("description") or None, companyid, groupcode, code),
                )
        return True
    except CodeMasterConflictError:
        raise
    except Exception as error:
        logger.exception("Failed to save common code group")
        raise CodeMasterDatabaseError from error


def save_bulk_items(companyid: str, companyname: str, items: list[dict]) -> int:
    """Insert a complete bulk upload atomically across all code groups."""
    if not items:
        return 0

    groupcodes = sorted({item["groupcode"] for item in items})
    if any(groupcode not in GROUP_NAMES for groupcode in groupcodes):
        raise CodeMasterConflictError("정의되지 않은 공통코드 그룹이 포함되어 있습니다.")
    readonly_groups = sorted(set(groupcodes) & READ_ONLY_GROUPS)
    if readonly_groups:
        names = ", ".join(GROUP_NAMES[groupcode] for groupcode in readonly_groups)
        raise CodeMasterConflictError(f"{names} 코드는 현재 조회만 가능합니다.")

    seen: set[tuple[str, str]] = set()
    for item in items:
        if not item["code"]:
            continue
        key = (item["groupcode"], item["code"])
        if key in seen:
            raise CodeMasterConflictError(f"업로드 파일에 중복 코드가 있습니다: {key[0]} / {key[1]}")
        seen.add(key)

    try:
        with _connect() as connection, connection.cursor() as cursor:
            for groupcode in groupcodes:
                cursor.execute(
                    "SELECT pg_advisory_xact_lock(hashtext(%s)::bigint)",
                    (f"{companyid}:{groupcode}",),
                )

            requested_by_group = {
                groupcode: {item["code"] for item in items if item["groupcode"] == groupcode and item["code"]}
                for groupcode in groupcodes
            }
            existing_by_group: dict[str, set[str]] = {}
            for groupcode in groupcodes:
                requested_codes = requested_by_group[groupcode]
                if requested_codes:
                    cursor.execute(
                        "SELECT code FROM CodeMaster01t WHERE companyid = %s AND groupcode = %s AND code = ANY(%s) FOR UPDATE",
                        (companyid, groupcode, list(requested_codes)),
                    )
                else:
                    existing_by_group[groupcode] = set()
                    continue
                existing_by_group[groupcode] = {row[0] for row in cursor.fetchall()}

            reserved_by_group = {groupcode: set(requested_by_group[groupcode]) for groupcode in groupcodes}
            for groupcode, code in seen:
                reserved_by_group[groupcode].add(code)

            prepared_items = []
            code_sequence_by_group: dict[str, tuple[int, int]] = {}
            for item in items:
                prepared = dict(item)
                groupcode = item["groupcode"]
                code = item["code"]
                if not code:
                    if groupcode not in code_sequence_by_group:
                        cursor.execute(
                            "SELECT COALESCE(MAX(code::numeric), 0), COALESCE(MAX(LENGTH(code)), 3) "
                            "FROM CodeMaster01t WHERE companyid = %s AND groupcode = %s AND code ~ '^[0-9]+$'",
                            (companyid, groupcode),
                        )
                        maximum, width = cursor.fetchone()
                        code_sequence_by_group[groupcode] = (int(maximum) + 1, max(3, width))
                    next_number, width = code_sequence_by_group[groupcode]
                    code = str(next_number).zfill(width)
                    while code in reserved_by_group[groupcode]:
                        next_number += 1
                        code = str(next_number).zfill(width)
                    code_sequence_by_group[groupcode] = (next_number + 1, width)
                    prepared["code"] = code
                    reserved_by_group[groupcode].add(code)
                prepared_items.append(prepared)

            for groupcode, code in seen:
                if code in existing_by_group[groupcode]:
                    raise CodeMasterConflictError(f"이미 등록된 코드입니다: {groupcode} / {code}")

            for item in prepared_items:
                groupcode = item["groupcode"]
                properties = [None, None, None, None]
                properties[_group_property_index(groupcode) - 1] = item.get("property") or None
                cursor.execute(
                    """
                    INSERT INTO CodeMaster01t (
                        companyid, companyname, groupcode, groupname, code, code_name,
                        property1, property2, property3, property4,
                        sort_order, use_yn, description, created_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                              CURRENT_TIMESTAMP)
                    ON CONFLICT (companyid, groupcode, code) DO NOTHING
                    """,
                    (
                        companyid, companyname, groupcode, GROUP_NAMES[groupcode], item["code"], item["codename"],
                        *properties, item["sortorder"], ACTIVE_VALUE if item.get("use", True) else INACTIVE_VALUE,
                        item.get("description") or None,
                    ),
                )
                if cursor.rowcount == 0:
                    raise CodeMasterConflictError(f"이미 등록된 코드입니다: {groupcode} / {item['code']}")
        return len(items)
    except CodeMasterConflictError:
        raise
    except Exception as error:
        logger.exception("Failed to bulk insert common codes")
        raise CodeMasterDatabaseError from error


def delete_codes(companyid: str, groupcode: str, codes: list[str]) -> int:
    if groupcode not in GROUP_NAMES or not codes:
        return 0
    _ensure_group_writable(groupcode)
    try:
        with _connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT pg_advisory_xact_lock(hashtext(%s)::bigint)",
                (f"{companyid}:{groupcode}",),
            )
            cursor.execute(
                "DELETE FROM CodeMaster01t WHERE companyid = %s AND groupcode = %s AND code = ANY(%s)",
                (companyid, groupcode, codes),
            )
            return cursor.rowcount
    except Exception as error:
        logger.exception("Failed to delete common codes")
        raise CodeMasterDatabaseError from error


def delete_code(companyid: str, groupcode: str, code: str) -> bool:
    return delete_codes(companyid, groupcode, [code]) > 0
