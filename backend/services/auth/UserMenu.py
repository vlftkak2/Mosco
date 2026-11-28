import db as _shared_db
from psycopg2.extras import RealDictCursor, execute_values
from pydantic import BaseModel, Field, field_validator

from config import DB_CONFIG


conn_str = (
    f"host={DB_CONFIG['host']} "
    f"port={DB_CONFIG['port']} "
    f"dbname={DB_CONFIG['database']} "
    f"user={DB_CONFIG['user']} "
    f"password={DB_CONFIG['password']}"
)


class UserMenuPermissionInput(BaseModel):
    companyid: str = Field(min_length=1, max_length=50)
    useremail: str = Field(min_length=3, max_length=50)
    menuids: list[str] = Field(default_factory=list, max_length=500)

    @field_validator("companyid", "useremail", mode="before")
    @classmethod
    def strip_text(cls, value):
        return str(value or "").strip()

    @field_validator("useremail")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return value.lower()

    @field_validator("menuids", mode="before")
    @classmethod
    def normalize_menuids(cls, value):
        if not isinstance(value, list):
            return []
        return list(dict.fromkeys(str(item or "").strip() for item in value if str(item or "").strip()))


def _connect():
    # Borrow from the shared pool; commit/rollback and return on block exit.
    return _shared_db.connect()


def list_manageable_companies(manager_companyid: str, is_master: bool):
    with _connect() as connection, connection.cursor(cursor_factory=RealDictCursor) as cursor:
        if is_master:
            cursor.execute(
                """SELECT companyid, companyname, company_status
                   FROM company01t
                   ORDER BY companyid"""
            )
        else:
            cursor.execute(
                """SELECT companyid, companyname, company_status
                   FROM company01t
                   WHERE companyid = %s
                   ORDER BY companyid""",
                (manager_companyid,),
            )
        return [dict(row) for row in cursor.fetchall()]


def list_manageable_users(companyid: str, is_master: bool):
    with _connect() as connection, connection.cursor(cursor_factory=RealDictCursor) as cursor:
        cursor.execute(
            """SELECT companyid, companyname, company_status
               FROM company01t
               WHERE companyid = %s""",
            (companyid,),
        )
        company = cursor.fetchone()
        if not company:
            raise LookupError("고객사를 찾을 수 없습니다.")

        # 플랫폼 관리자 · 고객사 관리자 모두 고객사 계정(USER · SUBMASTER, 자기 포함)의 메뉴를 정한다. 회사 범위는 라우트에서 제한한다.
        allowed_roles = ("USER", "SUBMASTER")
        cursor.execute(
            """SELECT companyid, usercode, username, email, team,
                      UPPER(COALESCE(authority, 'USER')) AS authority,
                      UPPER(COALESCE(useyn, 'N')) AS useyn
               FROM user01t
               WHERE companyid = %s
                 AND UPPER(COALESCE(authority, 'USER')) = ANY(%s)
               ORDER BY length(usercode), usercode, LOWER(username), LOWER(email)""",
            (companyid, list(allowed_roles)),
        )
        return {"company": dict(company), "items": [dict(row) for row in cursor.fetchall()]}


def _get_target_user(cursor, companyid: str, useremail: str, is_master: bool):
    cursor.execute(
        """SELECT companyid, username, email, team,
                  UPPER(COALESCE(authority, 'USER')) AS authority,
                  UPPER(COALESCE(useyn, 'N')) AS useyn
           FROM user01t
           WHERE companyid = %s AND LOWER(email) = LOWER(%s)""",
        (companyid, useremail),
    )
    target = cursor.fetchone()
    if not target:
        raise LookupError("사용자 계정을 찾을 수 없습니다.")
    allowed_roles = {"USER", "SUBMASTER"}
    if target["authority"] not in allowed_roles:
        raise PermissionError("해당 계정의 메뉴 권한을 관리할 수 없습니다.")
    return target


def get_user_menu_permissions(companyid: str, useremail: str, is_master: bool):
    with _connect() as connection, connection.cursor(cursor_factory=RealDictCursor) as cursor:
        target = _get_target_user(cursor, companyid, useremail, is_master)
        cursor.execute(
            """SELECT m.menuid, m.menuname, m.sort_order, m.access_scope,
                      UPPER(COALESCE(m.useyn, 'N')) AS useyn,
                      CASE
                          WHEN UPPER(COALESCE(p.useyn, 'N')) = 'Y'
                          THEN TRUE ELSE FALSE
                      END AS granted,
                      p.createdat AS created_at, p.updatedat AS updated_at,
                      COALESCE((SELECT u.username FROM user01t u WHERE u.email = p.createdby LIMIT 1), p.createdby) AS created_by,
                      COALESCE((SELECT u.username FROM user01t u WHERE u.email = p.updatedby LIMIT 1), p.updatedby) AS updated_by
               FROM menucatalog01t m
               LEFT JOIN usermenupermission01t p
                 ON p.companyid = %s
                AND LOWER(p.useremail) = LOWER(%s)
                AND p.menuid = m.menuid
               WHERE m.assignable = TRUE
                 AND (m.access_scope = 'COMPANY' OR (m.access_scope = 'PLATFORM' AND %s = '001'))
               ORDER BY m.sort_order, m.menuname, m.menuid""",
            (companyid, target["email"], companyid),
        )
        return {"target": dict(target), "items": [dict(row) for row in cursor.fetchall()]}


def get_my_menuids(companyid: str, useremail: str):
    with _connect() as connection, connection.cursor(cursor_factory=RealDictCursor) as cursor:
        cursor.execute(
            """SELECT m.menuid
               FROM menucatalog01t m
               JOIN usermenupermission01t p
                 ON p.menuid = m.menuid
                AND p.companyid = %s
                AND LOWER(p.useremail) = LOWER(%s)
               WHERE m.assignable = TRUE
                 AND (m.access_scope = 'COMPANY' OR (m.access_scope = 'PLATFORM' AND %s = '001'))
                 AND UPPER(COALESCE(m.useyn, 'N')) = 'Y'
                 AND UPPER(COALESCE(p.useyn, 'N')) = 'Y'
               ORDER BY m.sort_order, m.menuid""",
            (companyid, useremail, companyid),
        )
        return [row["menuid"] for row in cursor.fetchall()]


def save_user_menu_permissions(data: UserMenuPermissionInput, manager_email: str, is_master: bool,
                               actor: dict | None = None):
    actor = actor or {}
    actor_is_platform_admin = actor.get("companyid") == "001" and str(actor.get("authority") or "").upper() == "MASTER"
    # 권한 상승 방지 ① 자기 메뉴 권한은 스스로 바꾸지 못한다
    if (str(actor.get("companyid") or "") == data.companyid
            and str(actor.get("email") or manager_email).strip().lower() == data.useremail.strip().lower()):
        raise PermissionError("자기 계정의 메뉴 권한은 직접 바꿀 수 없습니다. 다른 관리자에게 요청해 주세요.")
    # 권한 상승 방지 ② 모스코(001) 직원의 권한(플랫폼 메뉴 포함)은 모스코 최종관리자만 바꾼다
    if data.companyid == "001" and not actor_is_platform_admin:
        raise PermissionError("모스코 직원의 메뉴 권한은 최종관리자(MASTER)만 바꿀 수 있습니다.")
    with _connect() as connection, connection.cursor(cursor_factory=RealDictCursor) as cursor:
        target = _get_target_user(cursor, data.companyid, data.useremail, is_master)

        # 모스코(001) 직원에게만 모스코 전용(PLATFORM) 메뉴를 줄 수 있다
        cursor.execute(
            """SELECT menuid
               FROM menucatalog01t
               WHERE assignable = TRUE
                 AND (access_scope = 'COMPANY' OR (access_scope = 'PLATFORM' AND %s = '001'))""",
            (data.companyid,),
        )
        assignable_menuids = {row["menuid"] for row in cursor.fetchall()}
        requested_menuids = set(data.menuids)
        invalid_menuids = sorted(requested_menuids - assignable_menuids)
        if invalid_menuids:
            raise ValueError(f"부여할 수 없는 메뉴가 포함되어 있습니다: {', '.join(invalid_menuids)}")

        # 바뀐 메뉴만 수정일자 · 수정자를 남긴다: 해제는 '이번에 빠진 메뉴'만, 부여는 '새로 켜진 메뉴'만.
        cursor.execute(
            """UPDATE usermenupermission01t
               SET useyn = 'N', updatedby = %s, updatedat = CURRENT_TIMESTAMP
               WHERE companyid = %s
                 AND LOWER(useremail) = LOWER(%s)
                 AND menuid IN (
                     SELECT menuid FROM menucatalog01t
                     WHERE assignable = TRUE AND (access_scope = 'COMPANY' OR (access_scope = 'PLATFORM' AND companyid = '001'))
                 )
                 AND NOT (menuid = ANY(%s))
                 AND UPPER(COALESCE(useyn, 'N')) <> 'N'""",
            (manager_email, data.companyid, target["email"], sorted(requested_menuids)),
        )

        rows = [
            (data.companyid, target["email"], menuid, manager_email)
            for menuid in sorted(requested_menuids)
        ]
        if rows:
            execute_values(
                cursor,
                """INSERT INTO usermenupermission01t
                       (companyid, useremail, menuid, useyn, createdby, updatedby, updatedat)
                   VALUES %s
                   ON CONFLICT (companyid, useremail, menuid)
                   DO UPDATE SET
                       useyn = 'Y',
                       -- the new-row template leaves updatedby NULL; an existing row is updated BY the manager
                       updatedby = EXCLUDED.createdby,
                       updatedat = CURRENT_TIMESTAMP
                   -- 이미 켜져 있던 메뉴는 건드리지 않는다 (수정일자 · 수정자 그대로)
                   WHERE UPPER(COALESCE(usermenupermission01t.useyn, 'N')) <> 'Y'""",
                rows,
                template="(%s, %s, %s, 'Y', %s, NULL, NULL)",
            )

        # 잠김 방지: 모스코가 아닌 회사는 메뉴권한관리 권한을 가진 활성 직원이 한 명은 남아야 한다
        if data.companyid != "001":
            cursor.execute(
                """SELECT 1 FROM usermenupermission01t p
                   JOIN user01t u ON u.companyid = p.companyid AND u.email = p.useremail AND UPPER(COALESCE(u.useyn, 'N')) = 'Y'
                   WHERE p.companyid = %s AND p.menuid = 'USER_MENU_PERMISSION' AND UPPER(COALESCE(p.useyn, 'N')) = 'Y'
                   LIMIT 1""",
                (data.companyid,),
            )
            if cursor.fetchone() is None:
                raise ValueError("메뉴권한관리 권한을 가진 직원이 한 명은 있어야 합니다. 다른 직원에게 먼저 부여해 주세요.")

        return {
            "companyid": data.companyid,
            "useremail": target["email"],
            "username": target["username"],
            "granted_count": len(requested_menuids),
        }


# ── 메뉴 즐겨찾기 (사용자별) ─────────────────────────────────────────────
# 왼쪽 메뉴의 ☆. 목록 전체를 한 번에 바꿔 저장한다 (순서 = 전달한 순서).

class MenuFavoriteInput(BaseModel):
    menuids: list[str] = Field(default_factory=list, max_length=200)

    @field_validator("menuids", mode="before")
    @classmethod
    def normalize_menuids(cls, value):
        if not isinstance(value, list):
            return []
        return list(dict.fromkeys(str(item or "").strip() for item in value if str(item or "").strip()))


def get_menu_favorites(companyid: str, useremail: str) -> list[str]:
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """SELECT menuid
               FROM usermenufavorite01t
               WHERE companyid = %s AND useremail = %s
               ORDER BY sort_order, created_at""",
            (companyid, useremail.lower()),
        )
        return [row[0] for row in cursor.fetchall()]


def save_menu_favorites(companyid: str, useremail: str, menuids: list[str]) -> list[str]:
    email = useremail.lower()
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            "DELETE FROM usermenufavorite01t WHERE companyid = %s AND useremail = %s",
            (companyid, email),
        )
        if menuids:
            # 메뉴 목록에 있는 메뉴만 저장한다 (없는 ID는 조용히 버림)
            cursor.execute(
                """INSERT INTO usermenufavorite01t (companyid, useremail, menuid, sort_order)
                   SELECT %s, %s, item.menuid, item.ord::int
                   FROM unnest(%s::varchar[]) WITH ORDINALITY AS item(menuid, ord)
                   JOIN menucatalog01t m ON m.menuid = item.menuid""",
                (companyid, email, menuids),
            )
    return get_menu_favorites(companyid, email)
