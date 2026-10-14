import logging
import psycopg2
from config import DB_CONFIG

logger = logging.getLogger(__name__)

# UI/API와 동기화하는 지원 그룹 목록입니다. 각 항목은 (그룹 코드, 표시명)입니다.

# 공통코드 그룹은 화면과 API에서 이 목록만 사용합니다.
CODE_GROUPS = [
    ("MATERIAL", "강종"),
    ("PROCESS", "공정"),
    ("OTHER_COST", "기타비용"),
    ("WAREHOUSE", "창고"),
    ("SURFACE", "표면"),
    ("DELIVERY", "착지"),
    ("TRADE_TYPE", "거래구분"),
]
GROUP_NAMES = dict(CODE_GROUPS)


def _connect():
    """설정된 PostgreSQL 접속 정보로 새 DB 연결을 엽니다."""
    return psycopg2.connect(
        host=DB_CONFIG["host"],
        port=DB_CONFIG["port"],
        dbname=DB_CONFIG["database"],
        user=DB_CONFIG["user"],
        password=DB_CONFIG["password"],
    )


class CodeMasterDatabaseError(Exception):
    """라우터가 DB 내부 오류와 입력/충돌 오류를 구분할 때 쓰는 예외입니다."""
    pass


class CodeMasterConflictError(Exception):
    """요청 시점에 코드 상태가 달라졌거나 새 코드가 겹칠 때 발생합니다."""
    pass


def list_groups(companyid: str) -> list[dict]:
    """한 회사의 코드를 조회하고 비어 있는 그룹도 포함한 화면 응답으로 만듭니다."""
    try:
        with _connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT groupcode, groupname, code, codename, sortorder,
                       use_yn, description
                FROM CodeMaster01t
                WHERE companyid = %s AND groupcode = ANY(%s)
                ORDER BY sortorder, code
                """,
                (companyid, [code for code, _ in CODE_GROUPS]),
            )
            records = cursor.fetchall()

        # 고정 그룹 목록을 반환하므로 아직 코드가 없는 그룹도 화면에 표시됩니다.
        groups = {
            code: {
                "id": code,
                "groupcode": code,
                "name": name,
                "description": f"{name} 회사 공통 코드",
                "rows": [],
            }
            for code, name in CODE_GROUPS
        }
        for groupcode, _groupname, code, codename, sortorder, use_yn, description in records:
            groups[groupcode]["rows"].append(
                {
                    "id": f"{groupcode}:{code}",
                    "code": code,
                    "name": codename,
                    "order": sortorder,
                    "use": use_yn == "Y",
                    "description": description or "",
                }
            )
        return list(groups.values())
    except Exception as error:
        logger.exception("Failed to list common code groups")
        raise CodeMasterDatabaseError from error


def save_group(companyid: str, companyname: str, groupcode: str, items: list[dict]) -> bool:
    """그룹 내 항목을 생성/갱신합니다. 삭제는 별도 delete 함수에서 처리합니다."""
    groupname = GROUP_NAMES.get(groupcode)
    if groupname is None:
        return False
    try:
        with _connect() as connection, connection.cursor() as cursor:
            # 같은 회사·그룹의 동시 저장이 서로 덮어쓰지 않도록 잠급니다.
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
                if item.get("is_new"):
                    if code in existing_codes:
                        raise CodeMasterConflictError(f"코드 {code}가 이미 등록되어 있습니다. 다시 조회해 주세요.")
                    cursor.execute(
                        """
                        INSERT INTO CodeMaster01t (
                            companyid, companyname, groupcode, groupname, code,
                            codename, sortorder, use_yn, description, createdat
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP)
                        ON CONFLICT (companyid, groupcode, code) DO NOTHING
                        """,
                        (
                            companyid, companyname, groupcode, groupname, code,
                            item["codename"], item["sortorder"], "Y" if item["use"] else "N",
                            item.get("description") or None,
                        ),
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
                    SET companyname = %s, groupname = %s, codename = %s, sortorder = %s,
                        use_yn = %s, description = %s, updatedat = CURRENT_TIMESTAMP
                    WHERE companyid = %s AND groupcode = %s AND code = %s
                    """,
                    (
                        companyname, groupname, item["codename"], item["sortorder"],
                        "Y" if item["use"] else "N", item.get("description") or None,
                        companyid, groupcode, code,
                    ),
                )
        return True
    except CodeMasterConflictError:
        raise
    except Exception as error:
        logger.exception("Failed to save common code group")
        raise CodeMasterDatabaseError from error


def delete_codes(companyid: str, groupcode: str, codes: list[str]) -> int:
    """회사와 그룹으로 범위를 제한해 코드 목록을 삭제하고 삭제 건수를 돌려줍니다."""
    if groupcode not in GROUP_NAMES or not codes:
        return 0
    try:
        with _connect() as connection, connection.cursor() as cursor:
            # 삭제도 회사와 그룹 범위를 잠그고 PK 기준으로만 처리합니다.
            cursor.execute(
                "SELECT pg_advisory_xact_lock(hashtext(%s)::bigint)",
                (f"{companyid}:{groupcode}",),
            )
            cursor.execute(
                """
                DELETE FROM CodeMaster01t
                WHERE companyid = %s AND groupcode = %s AND code = ANY(%s)
                """,
                (companyid, groupcode, codes),
            )
            return cursor.rowcount
    except Exception as error:
        logger.exception("Failed to delete common codes")
        raise CodeMasterDatabaseError from error


def delete_code(companyid: str, groupcode: str, code: str) -> bool:
    """단일 삭제 편의 함수로, 공통 삭제 처리를 호출해 성공 여부를 반환합니다."""
    deleted_count = delete_codes(companyid, groupcode, [code])
    return deleted_count > 0
