import psycopg2
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
    return psycopg2.connect(conn_str)


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

        allowed_roles = ("USER", "SUBMASTER") if is_master else ("USER",)
        cursor.execute(
            """SELECT companyid, username, email, team,
                      UPPER(COALESCE(authority, 'USER')) AS authority,
                      UPPER(COALESCE(useyn, 'N')) AS useyn
               FROM user01t
               WHERE companyid = %s
                 AND UPPER(COALESCE(authority, 'USER')) = ANY(%s)
               ORDER BY LOWER(username), LOWER(email)""",
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
    allowed_roles = {"USER", "SUBMASTER"} if is_master else {"USER"}
    if target["authority"] not in allowed_roles:
        raise PermissionError("해당 계정의 메뉴 권한을 관리할 수 없습니다.")
    return target


def get_user_menu_permissions(companyid: str, useremail: str, is_master: bool):
    with _connect() as connection, connection.cursor(cursor_factory=RealDictCursor) as cursor:
        target = _get_target_user(cursor, companyid, useremail, is_master)
        cursor.execute(
            """SELECT m.menuid, m.menuname, m.sort_order,
                      UPPER(COALESCE(m.useyn, 'N')) AS useyn,
                      CASE
                          WHEN UPPER(COALESCE(m.useyn, 'N')) = 'Y'
                           AND UPPER(COALESCE(p.useyn, 'N')) = 'Y'
                          THEN TRUE ELSE FALSE
                      END AS granted
               FROM menucatalog01t m
               LEFT JOIN usermenupermission01t p
                 ON p.companyid = %s
                AND LOWER(p.useremail) = LOWER(%s)
                AND p.menuid = m.menuid
               WHERE m.assignable = TRUE
                 AND m.access_scope = 'COMPANY'
               ORDER BY m.sort_order, m.menuname, m.menuid""",
            (companyid, target["email"]),
        )
        return {"target": dict(target), "items": [dict(row) for row in cursor.fetchall()]}


def save_user_menu_permissions(data: UserMenuPermissionInput, manager_email: str, is_master: bool):
    with _connect() as connection, connection.cursor(cursor_factory=RealDictCursor) as cursor:
        target = _get_target_user(cursor, data.companyid, data.useremail, is_master)

        cursor.execute(
            """SELECT menuid
               FROM menucatalog01t
               WHERE UPPER(COALESCE(useyn, 'N')) = 'Y'
                 AND assignable = TRUE
                 AND access_scope = 'COMPANY'"""
        )
        assignable_menuids = {row["menuid"] for row in cursor.fetchall()}
        requested_menuids = set(data.menuids)
        invalid_menuids = sorted(requested_menuids - assignable_menuids)
        if invalid_menuids:
            raise ValueError(f"부여할 수 없는 메뉴가 포함되어 있습니다: {', '.join(invalid_menuids)}")

        cursor.execute(
            """UPDATE usermenupermission01t
               SET useyn = 'N', updatedby = %s, updatedat = CURRENT_TIMESTAMP
               WHERE companyid = %s
                 AND LOWER(useremail) = LOWER(%s)
                 AND UPPER(COALESCE(useyn, 'N')) <> 'N'""",
            (manager_email, data.companyid, target["email"]),
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
                       updatedby = EXCLUDED.updatedby,
                       updatedat = CURRENT_TIMESTAMP""",
                rows,
                template="(%s, %s, %s, 'Y', %s, NULL, NULL)",
            )

        return {
            "companyid": data.companyid,
            "useremail": target["email"],
            "username": target["username"],
            "granted_count": len(requested_menuids),
        }
