import base64
import hashlib
import hmac
import re
import secrets

import db as _shared_db
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
PASSWORD_MIN_LENGTH = 8
PASSWORD_MAX_LENGTH = 128


def validate_new_password(value) -> str:
    """새로 정하는 비밀번호 규칙: 8자 이상, 영문과 숫자를 모두 포함. 기존 비밀번호 로그인에는 적용하지 않는다."""
    value = str(value or "")
    if not value.strip():
        raise ValueError("비밀번호를 입력해 주세요.")
    if len(value) < PASSWORD_MIN_LENGTH or len(value) > PASSWORD_MAX_LENGTH:
        raise ValueError(f"비밀번호는 {PASSWORD_MIN_LENGTH}자 이상 {PASSWORD_MAX_LENGTH}자 이하로 입력해 주세요.")
    if not re.search(r"[A-Za-z]", value) or not re.search(r"\d", value):
        raise ValueError("비밀번호는 영문과 숫자를 모두 포함해야 합니다.")
    return value


class UserCreateInput(BaseModel):
    companyid: str = Field(min_length=1, max_length=50)
    companyname: str = Field(default="", max_length=100)
    username: str = Field(min_length=1, max_length=20)
    email: str = Field(min_length=3, max_length=50)
    password: str = Field(min_length=1, max_length=128)
    authority: str = "USER"

    @field_validator("companyid", "companyname", "username", "email", mode="before")
    @classmethod
    def strip_text(cls, value):
        return str(value or "").strip()

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        return validate_new_password(value)

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
    authority: str = "USER"
    useyn: str = "Y"
    password: str = Field(default="", max_length=128)

    @field_validator("companyid", "companyname", "original_email", "email", "username", mode="before")
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
        # 빈 값이면 비밀번호를 바꾸지 않는다. 값을 넣었으면 새 비밀번호 규칙을 따른다.
        value = str(value or "")
        return validate_new_password(value) if value else ""


def _connect():
    # Borrow from the shared pool; commit/rollback and return on block exit.
    return _shared_db.connect()


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
    if not isinstance(password, str) or not isinstance(stored_value, str) or not password:
        return False
    # 평문으로 저장된 비밀번호는 더 이상 받지 않는다. PBKDF2 해시만 로그인할 수 있다.
    if not is_password_hash(stored_value):
        return False
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
            """SELECT u.companyid, u.usercode, u.username, u.email, u.team, u.authority, u.useyn,
                      u.createdat, u.updatedat,
                      COALESCE((SELECT x.username FROM user01t x WHERE x.email = u.created_by LIMIT 1), u.created_by) AS created_by,
                      COALESCE((SELECT x.username FROM user01t x WHERE x.email = u.updated_by LIMIT 1), u.updated_by) AS updated_by
               FROM user01t u
               WHERE u.companyid = %s
               ORDER BY length(u.usercode), u.usercode""",   # 사용자 코드 순 (001 … 999, 1000 …)
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
        _companyname, licensed_seats = _lock_active_company(cursor, data.companyid)

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
            raise ValueError(f"라이선스 {licensed_seats}개를 모두 사용 중입니다.")

        # 사용자 코드: 회사별 001, 002, … (회사 행을 위에서 FOR UPDATE 로 잠가 같은 회사 등록이 겹치지 않는다)
        cursor.execute(
            """SELECT lpad((COALESCE(MAX(usercode::integer), 0) + 1)::text, 3, '0') AS next_code
               FROM user01t WHERE companyid = %s AND usercode ~ '^[0-9]+$'""",
            (data.companyid,),
        )
        usercode = cursor.fetchone()["next_code"]
        cursor.execute(
            """INSERT INTO user01t
               (companyid, usercode, username, email, password, authority, useyn, created_by)
               VALUES (%s, %s, %s, %s, %s, %s, 'Y', %s)
               RETURNING companyid, usercode, username, email, team, authority, useyn""",
            (data.companyid, usercode, data.username, data.email, hash_password(data.password), data.authority,
             created_by or None),
        )
        created_user = dict(cursor.fetchone())
        # 새 계정은 업무 메뉴 권한 없이 시작한다 (최소 권한). 관리자가 메뉴권한관리에서 필요한 메뉴만 부여한다.
        # 계정을 지우면 메뉴 권한도 FK(ON DELETE CASCADE)로 함께 지워져, 같은 이메일로 다시 만들어도 예전 권한이 살아나지 않는다.
        return created_user


def _active_menuids(cursor, companyid: str, email: str) -> set:
    """로그인했을 때 실제로 쓸 수 있는 메뉴 (security._load_auth_snapshot 과 같은 조건)."""
    cursor.execute(
        """SELECT DISTINCT m.menuid
             FROM usermenupermission01t p
             JOIN menucatalog01t m ON m.menuid = p.menuid
                  AND m.assignable = TRUE AND UPPER(COALESCE(m.useyn, 'N')) = 'Y'
                  AND (m.access_scope = 'COMPANY' OR (m.access_scope = 'PLATFORM' AND p.companyid = '001'))
            WHERE p.companyid = %s AND LOWER(p.useremail) = LOWER(%s) AND UPPER(COALESCE(p.useyn, 'N')) = 'Y'""",
        (companyid, email),
    )
    return {row["menuid"] if isinstance(row, dict) else row[0] for row in cursor.fetchall()}


def update_user(data: UserUpdateInput, *, actor: dict | None = None, actor_email: str | None = None):
    # `actor` (SUBMASTER only) drives permission checks; `actor_email` is recorded as 수정자 for every editor.
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
        if actor:   # 모스코 MASTER 가 아닌 관리자
            actor_companyid = str(actor.get("companyid") or "")
            if actor_companyid != "001" and data.companyid != actor_companyid:
                raise PermissionError("자기 회사 계정만 수정할 수 있습니다.")
            if current_authority not in {"USER", "SUBMASTER"}:
                raise PermissionError("플랫폼 관리자 계정은 수정할 수 없습니다.")
            if data.authority not in {"USER", "SUBMASTER"}:
                raise PermissionError("고객사 관리자는 일반 사용자 · 고객사 관리자 권한만 줄 수 있습니다.")
            actor_login = str(actor.get("email") or "").strip().lower()
            is_self = data.companyid == actor_companyid and data.original_email.strip().lower() == actor_login
            # 권한 상승 방지: 자기 권한은 스스로 바꾸지 못한다
            if is_self and data.authority != current_authority:
                raise PermissionError("자기 계정의 권한은 직접 바꿀 수 없습니다.")
            # 고객사 관리자(SUBMASTER) 계정을 만들거나 고치는 것은 SUBMASTER 만 한다.
            # (계정관리 메뉴만 받은 일반 사용자가 관리자 계정을 만들거나 빼앗지 못하게)
            actor_authority = str(actor.get("authority") or "USER").upper()
            if not is_self and actor_authority != "SUBMASTER" and "SUBMASTER" in {current_authority, data.authority}:
                raise PermissionError("고객사 관리자(SUBMASTER) 계정은 고객사 관리자만 만들거나 수정할 수 있습니다.")
            # 계정 탈취 방지: 남의 비밀번호는 같은 고객사(모스코 제외)의 관리자만 바꿀 수 있다.
            # 다른 회사 계정 · 모스코(001) 직원 계정의 비밀번호는 모스코 최종관리자(MASTER)만 바꾼다.
            if data.password and not is_self and (data.companyid != actor_companyid or actor_companyid == "001"):
                raise PermissionError("이 계정의 비밀번호는 모스코 최종관리자만 바꿀 수 있습니다.")
            # 나보다 메뉴 권한이 많은 계정의 비밀번호는 바꾸지 못한다 (바꾼 뒤 그 계정으로 로그인하면 권한이 늘어나므로)
            if data.password and not is_self:
                extra = _active_menuids(cursor, data.companyid, data.original_email) - set(actor.get("menuids") or ())
                if extra:
                    raise PermissionError("이 계정은 내가 갖지 않은 메뉴 권한이 있어 비밀번호를 바꿀 수 없습니다. "
                                          "그 메뉴 권한을 가진 관리자에게 요청해 주세요.")
        _validate_authority_company(data.companyid, data.authority)
        next_useyn = data.useyn
        # 고객사 관리자(SUBMASTER)가 마지막 남은 활성 관리자를 일반 사용자로 내리거나 중지하면 그 회사를 관리할 사람이 없어진다
        if (data.companyid != "001" and current_authority == "SUBMASTER" and current_useyn == "Y"
                and (data.authority != "SUBMASTER" or next_useyn != "Y")):
            cursor.execute(
                """SELECT COUNT(*)::integer AS admin_count FROM user01t
                   WHERE companyid = %s AND UPPER(COALESCE(authority, '')) = 'SUBMASTER'
                     AND UPPER(COALESCE(useyn, 'N')) = 'Y'
                     AND LOWER(email) <> LOWER(%s)""",
                (data.companyid, data.original_email),
            )
            if cursor.fetchone()["admin_count"] == 0:
                raise ValueError("고객사 관리자 계정은 최소 한 개 이상 사용 상태로 남아 있어야 합니다.")
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
                raise ValueError(f"라이선스 {int(company['licensed_seats'] or 0)}개를 모두 사용 중입니다.")

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
                   SET username = %s, email = %s, authority = %s, useyn = %s, password = %s,
                       session_id = NULL,   -- 비밀번호가 바뀌면 기존 접속(토큰)을 모두 끊는다
                       updatedat = CURRENT_TIMESTAMP, updated_by = %s
                   WHERE companyid = %s AND LOWER(email) = LOWER(%s)
                   RETURNING companyid, usercode, username, email, team, authority, useyn""",
                (data.username, data.email, data.authority, next_useyn, hash_password(data.password),
                 actor_email or None, data.companyid, data.original_email),
            )
        else:
            cursor.execute(
                """UPDATE user01t
                   SET username = %s, email = %s, authority = %s, useyn = %s,
                       session_id = CASE WHEN %s = 'Y' THEN session_id END,   -- 사용 중지하면 접속을 끊는다
                       updatedat = CURRENT_TIMESTAMP, updated_by = %s
                   WHERE companyid = %s AND LOWER(email) = LOWER(%s)
                   RETURNING companyid, usercode, username, email, team, authority, useyn""",
                (data.username, data.email, data.authority, next_useyn, next_useyn, actor_email or None,
                 data.companyid, data.original_email),
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

        if actor:   # 모스코 MASTER 가 아닌 관리자
            actor_companyid = str(actor.get("companyid") or "")
            actor_email = str(actor.get("email") or "").strip().lower()
            if actor_companyid != "001" and companyid != actor_companyid:
                raise PermissionError("자기 회사 계정만 삭제할 수 있습니다.")
            if email.strip().lower() == actor_email:
                raise PermissionError("자기 계정은 삭제할 수 없습니다.")
            if str(target["authority"] or "USER").upper() != "USER":
                raise PermissionError("고객사 관리자는 일반 사용자 계정만 삭제할 수 있습니다.")

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

        if (
            companyid != "001"
            and str(target["authority"] or "").upper() == "SUBMASTER"
            and str(target["useyn"] or "N").upper() == "Y"
        ):
            cursor.execute(
                """SELECT COUNT(*)::integer AS admin_count FROM user01t
                   WHERE companyid = %s AND UPPER(COALESCE(authority, '')) = 'SUBMASTER'
                     AND UPPER(COALESCE(useyn, 'N')) = 'Y'
                     AND LOWER(email) <> LOWER(%s)""",
                (companyid, email),
            )
            if cursor.fetchone()["admin_count"] == 0:
                raise ValueError("고객사 관리자 계정은 최소 한 개 이상 사용 상태로 남아 있어야 합니다.")

        cursor.execute(
            "DELETE FROM user01t WHERE companyid = %s AND LOWER(email) = LOWER(%s)",
            (companyid, email),
        )
        return {"companyid": companyid, "username": target["username"], "email": email}
