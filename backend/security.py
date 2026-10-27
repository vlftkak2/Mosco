from collections import OrderedDict
from datetime import datetime, timedelta, timezone
from threading import RLock
from time import monotonic

import jwt
import psycopg2
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from config import DB_CONFIG, JWT_SECRET_KEY


ALGORITHM = "HS256"
ISSUER = "mosco-api"
AUDIENCE = "mosco-client"
ACCESS_TOKEN_MINUTES = 480
AUTH_CACHE_TTL_SECONDS = 20
AUTH_CACHE_MAX_ENTRIES = 5000
bearer_scheme = HTTPBearer(auto_error=False)

_auth_cache: OrderedDict[tuple[str, str], tuple[float, dict]] = OrderedDict()
_auth_cache_lock = RLock()


def _connect():
    return psycopg2.connect(
        host=DB_CONFIG["host"],
        port=DB_CONFIG["port"],
        dbname=DB_CONFIG["database"],
        user=DB_CONFIG["user"],
        password=DB_CONFIG["password"],
        connect_timeout=5,
    )


def _load_auth_snapshot(companyid: str, email: str) -> dict | None:
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """SELECT u.companyid, c.companyname, u.username, u.email,
                      UPPER(COALESCE(u.authority, 'USER')) AS authority,
                      UPPER(COALESCE(u.useyn, 'N')) AS user_useyn,
                      UPPER(COALESCE(c.company_status, '')) AS company_status,
                      COALESCE(ARRAY_AGG(DISTINCT m.menuid) FILTER (WHERE m.menuid IS NOT NULL), ARRAY[]::varchar[]) AS menuids
               FROM user01t u
               JOIN company01t c ON c.companyid = u.companyid
               LEFT JOIN usermenupermission01t p
                 ON p.companyid = u.companyid
                AND p.useremail = u.email
                AND UPPER(COALESCE(p.useyn, 'N')) = 'Y'
               LEFT JOIN menucatalog01t m
                 ON m.menuid = p.menuid
                AND m.access_scope = 'COMPANY'
                AND m.assignable = TRUE
                AND UPPER(COALESCE(m.useyn, 'N')) = 'Y'
               WHERE u.companyid = %s
                 AND u.email = %s
               GROUP BY u.companyid, c.companyname, u.username, u.email,
                        u.authority, u.useyn, c.company_status
               LIMIT 1""",
            (companyid, email),
        )
        row = cursor.fetchone()
    if not row:
        return None
    companyid_value, companyname, username, db_email, authority, user_useyn, company_status, menuids = row
    if str(user_useyn).upper() != "Y" or str(company_status).upper() != "ACTIVE":
        return None
    return {
        "companyid": str(companyid_value),
        "companyname": companyname or "",
        "username": username or "",
        "email": db_email,
        "authority": str(authority or "USER").upper(),
        "menuids": frozenset(menuids or ()),
    }


def _get_auth_snapshot(companyid: str, email: str) -> dict | None:
    companyid = str(companyid).strip()
    email = str(email).strip()
    key = (companyid, email.lower())
    now = monotonic()
    with _auth_cache_lock:
        cached = _auth_cache.get(key)
        if cached and cached[0] > now:
            _auth_cache.move_to_end(key)
            return cached[1]
        if cached:
            _auth_cache.pop(key, None)

    snapshot = _load_auth_snapshot(companyid, email)
    if snapshot is None:
        return None
    with _auth_cache_lock:
        _auth_cache[key] = (monotonic() + AUTH_CACHE_TTL_SECONDS, snapshot)
        _auth_cache.move_to_end(key)
        while len(_auth_cache) > AUTH_CACHE_MAX_ENTRIES:
            _auth_cache.popitem(last=False)
    return snapshot


def invalidate_user_access_cache(companyid: str, email: str | None = None) -> None:
    companyid = str(companyid or "").strip()
    normalized_email = str(email or "").strip().lower()
    with _auth_cache_lock:
        keys = [
            key for key in _auth_cache
            if key[0] == companyid and (not normalized_email or key[1] == normalized_email)
        ]
        for key in keys:
            _auth_cache.pop(key, None)


def invalidate_all_access_cache() -> None:
    with _auth_cache_lock:
        _auth_cache.clear()


def create_access_token(user: dict) -> str:
    if len(JWT_SECRET_KEY) < 32:
        raise RuntimeError("JWT_SECRET_KEY must be configured with at least 32 characters")

    now = datetime.now(timezone.utc)
    payload = {
        "sub": user["user_email"],
        "companyid": str(user["user_company"]),
        "companyname": user.get("user_companyname", ""),
        "username": user.get("user_name", ""),
        "iat": now,
        "nbf": now,
        "exp": now + timedelta(minutes=ACCESS_TOKEN_MINUTES),
        "iss": ISSUER,
        "aud": AUDIENCE,
    }
    return jwt.encode(payload, JWT_SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> dict:
    if len(JWT_SECRET_KEY) < 32:
        raise HTTPException(status_code=503, detail="인증 키가 서버에 설정되지 않았습니다.")
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="로그인이 필요합니다.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        claims = jwt.decode(
            credentials.credentials,
            JWT_SECRET_KEY,
            algorithms=[ALGORITHM],
            issuer=ISSUER,
            audience=AUDIENCE,
            options={"require": ["exp", "iat", "sub", "companyid"]},
        )
    except jwt.PyJWTError as error:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="로그인 정보가 만료되었거나 유효하지 않습니다.",
            headers={"WWW-Authenticate": "Bearer"},
        ) from error

    try:
        snapshot = _get_auth_snapshot(str(claims["companyid"]), str(claims["sub"]))
    except psycopg2.Error as error:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="계정 권한 확인에 실패했습니다.") from error
    if snapshot is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="계정 또는 회사 이용 상태를 확인해 주세요.")
    return snapshot


def has_platform_admin_role(user: dict) -> bool:
    return user.get("companyid") == "001" and user.get("authority") == "MASTER"


def user_has_menu_access(companyid: str, email: str, menuid: str) -> bool:
    snapshot = _get_auth_snapshot(companyid, email)
    if not snapshot:
        return False
    return has_platform_admin_role(snapshot) or menuid in snapshot["menuids"]


def require_platform_admin(user: dict = Depends(get_current_user)) -> dict:
    if not has_platform_admin_role(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only a Steel119 platform administrator can use this feature.")
    return user


def require_menu_access(menuid: str):
    def dependency(user: dict = Depends(get_current_user)) -> dict:
        # Platform administrators retain platform-wide access; account and company status
        # are still checked by get_current_user before reaching this exception.
        if has_platform_admin_role(user):
            return user
        if menuid not in user["menuids"]:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="이 메뉴에 접근할 권한이 없습니다.")
        return user

    return dependency
