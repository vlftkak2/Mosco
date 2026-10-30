import base64
import hashlib
import hmac
import re
import secrets

import psycopg2
from psycopg2.extras import RealDictCursor
from pydantic import BaseModel, Field, field_validator

from config import DB_CONFIG


conn_str = (
    f"host={DB_CONFIG['host']} "
    f"port={DB_CONFIG['port']} "
    f"dbname={DB_CONFIG['database']} "
    f"user={DB_CONFIG['user']} "
    f"password={DB_CONFIG['password']}"
)

PASSWORD_SCHEME = "pbkdf2_sha256"
PASSWORD_ITERATIONS = 310_000
EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
AUTHORITY_VALUES = {"USER", "MASTER", "SUBMASTER"}


class UserCreateInput(BaseModel):
    companyid: str = Field(min_length=1, max_length=50)
    companyname: str = Field(default="", max_length=100)
    username: str = Field(min_length=1, max_length=20)
    email: str = Field(min_length=3, max_length=50)
    password: str = Field(min_length=1, max_length=128)
    team: str = Field(default="", max_length=50)
    authority: str = "USER"

    @field_validator("companyid", "companyname", "username", "email", "team", mode="before")
    @classmethod
    def strip_text(cls, value):
        return str(value or "").strip()

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        if not EMAIL_PATTERN.fullmatch(value):
            raise ValueError("올바른 이메일 주소를 입력해 주세요.")
        return value.lower()

    @field_validator("authority")
    @classmethod
    def validate_authority(cls, value: str) -> str:
        value = str(value or "USER").strip().upper()
        if value not in AUTHORITY_VALUES:
            raise ValueError("\uad8c\ud55c\uc740 USER, SUBMASTER \ub610\ub294 MASTER\ub85c \uc124\uc815\ud574 \uc8fc\uc138\uc694.")
        return value


class UserUpdateInput(BaseModel):
    companyid: str = Field(min_length=1, max_length=50)
    companyname: str = Field(default="", max_length=100)
    original_email: str = Field(min_length=3, max_length=50)
    email: str = Field(min_length=3, max_length=50)
    username: str = Field(min_length=1, max_length=20)
    team: str = Field(default="", max_length=50)
    authority: str = "USER"
    useyn: str = "Y"
    password: str = Field(default="", max_length=128)

    @field_validator("companyid", "companyname", "original_email", "email", "username", "team", mode="before")
    @classmethod
    def strip_text(cls, value):
        return str(value or "").strip()

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        if not EMAIL_PATTERN.fullmatch(value):
            raise ValueError("올바른 이메일 주소를 입력해 주세요.")
        return value.lower()

    @field_validator("original_email")
    @classmethod
    def validate_original_email(cls, value: str) -> str:
        if not EMAIL_PATTERN.fullmatch(value):
            raise ValueError("기존 이메일 주소를 확인해 주세요.")
        return value.lower()

    @field_validator("authority")
    @classmethod
    def validate_authority(cls, value: str) -> str:
        value = str(value or "USER").strip().upper()
        if value not in AUTHORITY_VALUES:
            raise ValueError("\uad8c\ud55c\uc740 USER, SUBMASTER \ub610\ub294 MASTER\ub85c \uc124\uc815\ud574 \uc8fc\uc138\uc694.")
        return value

    @field_validator("useyn")
    @classmethod
    def validate_useyn(cls, value: str) -> str:
        value = str(value or "").strip().upper()
        if value not in {"Y", "N"}:
            raise ValueError("사용 여부는 Y 또는 N이어야 합니다.")
        return value

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        return str(value or "")


def _connect():
    return psycopg2.connect(conn_str)


def _validate_authority_company(companyid: str, authority: str):
    if authority == "MASTER" and companyid != "001":
        raise ValueError("\ud50c\ub7ab\ud3fc MASTER \uad8c\ud55c\uc740 \uace0\uac1d\uc0ac\ucf54\ub4dc 001\uc5d0\ub9cc \uc9c0\uc815\ud560 \uc218 \uc788\uc2b5\ub2c8\ub2e4.")
    if authority == "SUBMASTER" and companyid == "001":
        raise ValueError("SUBMASTER \uad8c\ud55c\uc740 \uace0\uac1d\uc0ac \uacc4\uc815\uc5d0\ub9cc \uc9c0\uc815\ud560 \uc218 \uc788\uc2b5\ub2c8\ub2e4.")


def hash_password(password: str) -> str:
    encode = lambda value: base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")
    salt = encode(secrets.token_bytes(16))
    digest = encode(hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), base64.urlsafe_b64decode(salt + "=="), PASSWORD_ITERATIONS
    ))
    return f"{PASSWORD_SCHEME}${PASSWORD_ITERATIONS}${salt}${digest}"


def is_password_hash(value: str) -> bool:
    return isinstance(value, str) and value.startswith(f"{PASSWORD_SCHEME}$")


def verify_password(password: str, stored_value: str) -> bool:
    if not isinstance(password, str) or not isinstance(stored_value, str):
        return False
    if not is_password_hash(stored_value):
        return hmac.compare_digest(password, stored_value)
    try:
        scheme, iterations, salt, expected = stored_value.split("$", 3)
        if scheme != PASSWORD_SCHEME:
            return False
        decode = lambda value: base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
        digest = base64.urlsafe_b64encode(hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), decode(salt), int(iterations)
        )).decode("ascii").rstrip("=")
        return hmac.compare_digest(digest, expected)
    except (ValueError, TypeError):
        return False


def list_company_users(companyid: str):
    with _connect() as connection, connection.cursor(cursor_factory=RealDictCursor) as cursor:
        cursor.execute(
            """SELECT companyid, companyname, company_status, licensed_seats
               FROM company01t WHERE companyid = %s""",
            (companyid,),
        )
        company = cursor.fetchone()
        if not company:
            raise LookupError("고객사를 찾을 수 없습니다.")

        cursor.execute(
            """SELECT COUNT(*) FILTER (WHERE UPPER(COALESCE(useyn, 'N')) = 'Y')::integer AS active_users,
                      COUNT(*)::integer AS total_users
               FROM user01t WHERE companyid = %s""",
            (companyid,),
        )
        counts = cursor.fetchone()
        cursor.execute(
            """SELECT companyid, username, email, team, authority, useyn
               FROM user01t
               WHERE companyid = %s
               ORDER BY LOWER(username), LOWER(email)""",
            (companyid,),
        )
        return {
            "company": dict(company),
            "active_users": counts["active_users"],
            "total_users": counts["total_users"],
            "items": [dict(row) for row in cursor.fetchall()],
        }


def _lock_active_company(cursor, companyid: str):
    cursor.execute(
        """SELECT companyname, company_status, licensed_seats
           FROM company01t WHERE companyid = %s FOR UPDATE""",
        (companyid,),
    )
    company = cursor.fetchone()
    if not company:
        raise LookupError("고객사를 찾을 수 없습니다.")
    companyname = company["companyname"]
    company_status = company["company_status"]
    licensed_seats = company["licensed_seats"]
    if str(company_status or "").upper() != "ACTIVE":
        raise ValueError("이용 상태가 ACTIVE인 고객사에만 계정을 등록하거나 활성화할 수 있습니다.")
    return companyname, int(licensed_seats or 0)


def create_user(
    data: UserCreateInput,
    *,
    created_by: str = "",
):
    _validate_authority_company(data.companyid, data.authority)
    with _connect() as connection, connection.cursor(cursor_factory=RealDictCursor) as cursor:
        companyname, licensed_seats = _lock_active_company(cursor, data.companyid)

        # Serialize registrations for the same email, including across different companies.
        cursor.execute("SELECT pg_advisory_xact_lock(hashtextextended(LOWER(%s), 0))", (data.email,))
        cursor.execute(
            """SELECT 1 FROM user01t WHERE LOWER(email) = LOWER(%s) LIMIT 1""",
            (data.email,),
        )
        if cursor.fetchone():
            raise ValueError("이미 등록된 이메일입니다.")

        cursor.execute(
            """SELECT COUNT(*)::integer AS active_users FROM user01t
               WHERE companyid = %s AND UPPER(COALESCE(useyn, 'N')) = 'Y'""",
            (data.companyid,),
        )
        active_users = cursor.fetchone()["active_users"]
        if active_users >= licensed_seats:
            raise ValueError(f"허용 계정 수({licensed_seats}명)를 모두 사용 중입니다.")

        cursor.execute(
            """INSERT INTO user01t
               (companyid, companyname, username, email, password, team, authority, useyn)
               VALUES (%s, %s, %s, %s, %s, NULLIF(%s, ''), %s, 'Y')
               RETURNING companyid, username, email, team, authority, useyn""",
            (data.companyid, companyname, data.username, data.email, hash_password(data.password), data.team, data.authority),
        )
        created_user = dict(cursor.fetchone())

        if data.authority != "MASTER":
            cursor.execute(
                """INSERT INTO usermenupermission01t
                       (companyid, useremail, menuid, useyn, createdby, updatedby, updatedat)
                   SELECT %s, %s, m.menuid, 'Y', %s, NULL, NULL
                   FROM menucatalog01t m
                   WHERE UPPER(COALESCE(m.useyn, 'N')) = 'Y'
                     AND m.assignable = TRUE
                     AND m.access_scope = 'COMPANY'
                   ON CONFLICT (companyid, useremail, menuid)
                   DO UPDATE SET
                       useyn = 'Y',
                       updatedby = EXCLUDED.createdby,
                       updatedat = CURRENT_TIMESTAMP""",
                (data.companyid, created_user["email"], created_by or None),
            )

        return created_user


def update_user(data: UserUpdateInput, *, actor: dict | None = None):
    with _connect() as connection, connection.cursor(cursor_factory=RealDictCursor) as cursor:
        cursor.execute(
            "SELECT company_status, licensed_seats FROM company01t WHERE companyid = %s FOR UPDATE",
            (data.companyid,),
        )
        company = cursor.fetchone()
        if not company:
            raise LookupError("고객사를 찾을 수 없습니다.")

        cursor.execute(
            """SELECT useyn, authority FROM user01t
               WHERE companyid = %s AND LOWER(email) = LOWER(%s) FOR UPDATE""",
            (data.companyid, data.original_email),
        )
        current = cursor.fetchone()
        if not current:
            raise LookupError("사용자 계정을 찾을 수 없습니다.")

        current_useyn = str(current["useyn"] or "N").upper()
        current_authority = str(current["authority"] or "USER").upper()
        if actor and actor.get("authority") == "SUBMASTER":
            actor_companyid = str(actor.get("companyid") or "")
            if data.companyid != actor_companyid:
                raise PermissionError("Customer administrators can only update accounts in their own company.")
            if current_authority not in {"USER", "SUBMASTER"}:
                raise PermissionError("Customer administrators cannot update platform administrator accounts.")
            if data.authority not in {"USER", "SUBMASTER"}:
                raise PermissionError("Customer administrators can assign only USER or SUBMASTER authority.")
        _validate_authority_company(data.companyid, data.authority)
        next_useyn = data.useyn
        if data.companyid == "001" and current_authority == "MASTER" and (data.authority != "MASTER" or next_useyn != "Y"):
            cursor.execute(
                """SELECT COUNT(*)::integer AS master_count FROM user01t
                   WHERE companyid = '001' AND UPPER(COALESCE(authority, '')) = 'MASTER'
                     AND UPPER(COALESCE(useyn, 'N')) = 'Y'
                     AND LOWER(email) <> LOWER(%s)""",
                (data.original_email,),
            )
            if cursor.fetchone()["master_count"] == 0:
                raise ValueError("최종관리자 계정은 최소 한 개 이상 활성 상태로 유지해야 합니다.")
        if next_useyn == "Y" and current_useyn != "Y":
            if str(company["company_status"] or "").upper() != "ACTIVE":
                raise ValueError("이용 상태가 ACTIVE인 고객사에서만 계정을 활성화할 수 있습니다.")
            cursor.execute(
                """SELECT COUNT(*)::integer AS active_users FROM user01t
                   WHERE companyid = %s AND UPPER(COALESCE(useyn, 'N')) = 'Y'""",
                (data.companyid,),
            )
            active_users = cursor.fetchone()["active_users"]
            if active_users >= int(company["licensed_seats"] or 0):
                raise ValueError(f"허용 계정 수({int(company['licensed_seats'] or 0)}명)를 모두 사용 중입니다.")

        cursor.execute("SELECT pg_advisory_xact_lock(hashtextextended(LOWER(%s), 0))", (data.email,))
        cursor.execute(
            """SELECT 1 FROM user01t
               WHERE LOWER(email) = LOWER(%s)
                 AND NOT (companyid = %s AND LOWER(email) = LOWER(%s))
               LIMIT 1""",
            (data.email, data.companyid, data.original_email),
        )
        if cursor.fetchone():
            raise ValueError("이미 등록된 이메일입니다.")

        if data.password:
            cursor.execute(
                """UPDATE user01t
                   SET username = %s, email = %s, team = NULLIF(%s, ''), authority = %s, useyn = %s, password = %s
                   WHERE companyid = %s AND LOWER(email) = LOWER(%s)
                   RETURNING companyid, username, email, team, authority, useyn""",
                (data.username, data.email, data.team, data.authority, next_useyn, hash_password(data.password), data.companyid, data.original_email),
            )
        else:
            cursor.execute(
                """UPDATE user01t
                   SET username = %s, email = %s, team = NULLIF(%s, ''), authority = %s, useyn = %s
                   WHERE companyid = %s AND LOWER(email) = LOWER(%s)
                   RETURNING companyid, username, email, team, authority, useyn""",
                (data.username, data.email, data.team, data.authority, next_useyn, data.companyid, data.original_email),
            )
        return dict(cursor.fetchone())


def get_user_authority(companyid: str, email: str):
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """SELECT authority FROM user01t
               WHERE companyid = %s AND LOWER(email) = LOWER(%s)""",
            (companyid, email),
        )
        row = cursor.fetchone()
        return str(row[0] or "USER").upper() if row else None


def delete_user(companyid: str, email: str, *, actor: dict | None = None):
    with _connect() as connection, connection.cursor(cursor_factory=RealDictCursor) as cursor:
        cursor.execute(
            "SELECT company_status FROM company01t WHERE companyid = %s FOR UPDATE",
            (companyid,),
        )
        if not cursor.fetchone():
            raise LookupError("고객사를 찾을 수 없습니다.")

        cursor.execute(
            """SELECT username, authority, useyn FROM user01t
               WHERE companyid = %s AND LOWER(email) = LOWER(%s) FOR UPDATE""",
            (companyid, email),
        )
        target = cursor.fetchone()
        if not target:
            raise LookupError("삭제할 사용자 계정을 찾을 수 없습니다.")

        if actor and actor.get("authority") == "SUBMASTER":
            actor_companyid = str(actor.get("companyid") or "")
            actor_email = str(actor.get("email") or "").strip().lower()
            if companyid != actor_companyid:
                raise PermissionError("Customer administrators can only delete accounts in their own company.")
            if email.strip().lower() == actor_email:
                raise PermissionError("You cannot delete your own account.")
            if str(target["authority"] or "USER").upper() != "USER":
                raise PermissionError("Customer administrators can delete ordinary user accounts only.")

        if (
            companyid == "001"
            and str(target["authority"] or "").upper() == "MASTER"
            and str(target["useyn"] or "N").upper() == "Y"
        ):
            cursor.execute(
                """SELECT COUNT(*)::integer AS master_count FROM user01t
                   WHERE companyid = '001' AND UPPER(COALESCE(authority, '')) = 'MASTER'
                     AND UPPER(COALESCE(useyn, 'N')) = 'Y'
                     AND LOWER(email) <> LOWER(%s)""",
                (email,),
            )
            if cursor.fetchone()["master_count"] == 0:
                raise ValueError("최종관리자 계정은 최소 한 개 이상 활성 상태로 유지해야 합니다.")

        cursor.execute(
            "DELETE FROM user01t WHERE companyid = %s AND LOWER(email) = LOWER(%s)",
            (companyid, email),
        )
        return {"companyid": companyid, "username": target["username"], "email": email}
