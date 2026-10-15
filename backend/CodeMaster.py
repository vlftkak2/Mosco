import logging

import psycopg2

from config import DB_CONFIG

logger = logging.getLogger(__name__)

# Labels describe the four generic property columns for each code group.
CODE_GROUPS = [
    ("MATERIAL", "강종구분", ("대표강종", "비중", "구분", "용도")),
    ("PROCESS", "공정구분", ("수량자동계산", "Slitting", "포밍가공", "제품구분")),
    ("OTHER_COST", "기타비용코드", ("속성1", "속성2", "속성3", "속성4")),
    ("WAREHOUSE", "창고", ("속성1", "속성2", "속성3", "속성4")),
    ("SURFACE", "표면", ("속성1", "속성2", "속성3", "속성4")),
    ("DELIVERY", "착지코드", ("주소", "주소2", "전화", "인수자")),
    ("TRADE_TYPE", "거래구분", ("속성1", "속성2", "속성3", "속성4")),
]
GROUP_NAMES = {code: name for code, name, _ in CODE_GROUPS}
GROUP_PROPERTIES = {code: properties for code, _, properties in CODE_GROUPS}
ACTIVE_VALUE = "사용중"
INACTIVE_VALUE = "미사용"


def _connect():
    return psycopg2.connect(
        host=DB_CONFIG["host"],
        port=DB_CONFIG["port"],
        dbname=DB_CONFIG["database"],
        user=DB_CONFIG["user"],
        password=DB_CONFIG["password"],
    )


class CodeMasterDatabaseError(Exception):
    pass


class CodeMasterConflictError(Exception):
    pass


def list_groups(companyid: str) -> list[dict]:
    try:
        with _connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT groupcode, groupname, code, codename,
                       property1, property2, property3, property4,
                       sortorder, useyn, description
                FROM CodeMaster01t
                WHERE companyid = %s AND groupcode = ANY(%s)
                ORDER BY groupcode, sortorder, code
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
                "use": useyn == ACTIVE_VALUE,
                "description": description or "",
            })
        return list(groups.values())
    except Exception as error:
        logger.exception("Failed to list common code groups")
        raise CodeMasterDatabaseError from error


def save_group(companyid: str, companyname: str, groupcode: str, items: list[dict]) -> bool:
    groupname = GROUP_NAMES.get(groupcode)
    if groupname is None:
        return False
    try:
        with _connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT pg_advisory_xact_lock(hashtext(%s)::bigint)",
                (f"{companyid}:{groupcode}",),
            )
            cursor.execute(
                "SELECT code FROM CodeMaster01t WHERE companyid = %s AND groupcode = %s FOR UPDATE",
                (companyid, groupcode),
            )
            existing_codes = {row[0] for row in cursor.fetchall()}
            for item in items:
                code = item["code"]
                properties = (item.get("property1"), item.get("property2"),
                              item.get("property3"), item.get("property4"))
                if item.get("is_new"):
                    if code in existing_codes:
                        raise CodeMasterConflictError(f"코드 {code}가 이미 등록되어 있습니다. 다시 조회해 주세요.")
                    cursor.execute(
                        """
                        INSERT INTO CodeMaster01t (
                            companyid, companyname, groupcode, groupname, code, codename,
                            property1, property2, property3, property4,
                            sortorder, useyn, description, created_at, updated_at
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                                  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                        ON CONFLICT (companyid, groupcode, code) DO NOTHING
                        """,
                        (companyid, companyname, groupcode, groupname, code, item["codename"],
                         *properties, item["sortorder"], ACTIVE_VALUE if item["use"] else INACTIVE_VALUE,
                         item.get("description") or None),
                    )
                    if cursor.rowcount == 0:
                        raise CodeMasterConflictError(f"코드 {code}가 이미 등록되어 있습니다. 다시 조회해 주세요.")
                    existing_codes.add(code)
                    continue

                if code not in existing_codes:
                    raise CodeMasterConflictError(f"코드 {code}가 변경되었거나 삭제되었습니다. 다시 조회해 주세요.")
                cursor.execute(
                    """
                    UPDATE CodeMaster01t
                    SET companyname = %s, groupname = %s, codename = %s,
                        property1 = %s, property2 = %s, property3 = %s, property4 = %s,
                        sortorder = %s, useyn = %s, description = %s,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE companyid = %s AND groupcode = %s AND code = %s
                    """,
                    (companyname, groupname, item["codename"], *properties, item["sortorder"],
                     ACTIVE_VALUE if item["use"] else INACTIVE_VALUE, item.get("description") or None,
                     companyid, groupcode, code),
                )
        return True
    except CodeMasterConflictError:
        raise
    except Exception as error:
        logger.exception("Failed to save common code group")
        raise CodeMasterDatabaseError from error


def delete_codes(companyid: str, groupcode: str, codes: list[str]) -> int:
    if groupcode not in GROUP_NAMES or not codes:
        return 0
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
