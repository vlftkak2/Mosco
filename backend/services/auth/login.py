import secrets
from collections import OrderedDict, deque
from threading import Lock
from time import monotonic

import db as _shared_db
from pydantic import BaseModel, Field
from config import DB_CONFIG
from security import ACCESS_TOKEN_MINUTES, create_access_token, invalidate_user_access_cache
from services.auth import User as user_module


# PostgreSQL 접속 문자열
conn_str = (
    f"host={DB_CONFIG['host']} "
    f"port={DB_CONFIG['port']} "
    f"dbname={DB_CONFIG['database']} "
    f"user={DB_CONFIG['user']} "
    f"password={DB_CONFIG['password']}"
)

# ── 로그인 시도 제한 (프로세스 메모리, 워커마다 따로 센다) ──
LOGIN_WINDOW_SECONDS = 10 * 60
LOGIN_MAX_FAILURES_PER_EMAIL = 10          # 같은 이메일 + 같은 IP
LOGIN_MAX_FAILURES_PER_EMAIL_ANY_IP = 50   # 같은 이메일, 여러 IP 합계 (분산 대입 방지)
LOGIN_MAX_FAILURES_PER_IP = 30
LOGIN_LIMITER_MAX_KEYS = 20000
LOGIN_LOCKED_MESSAGE = "로그인 실패가 너무 많습니다. 10분 후 다시 시도해 주세요."
LICENSE_EXPIRED_MESSAGE = "이용 기간(라이선스)이 종료되었습니다. 관리자에게 문의해 주세요."
LOGIN_FAILED_MESSAGE = "계정 정보가 일치하지 않거나 회사 이용 상태를 확인할 수 없습니다."


class LoginRateLimiter:
    """키(이메일 · IP)별 최근 실패 시각을 들고 있는 슬라이딩 윈도. 키 개수는 max_keys 로 묶는다."""

    def __init__(self, window_seconds: float, max_keys: int):
        self.window = window_seconds
        self.max_keys = max_keys
        self._failures: OrderedDict[str, deque] = OrderedDict()
        self._lock = Lock()

    def _recent(self, key: str, now: float) -> deque | None:
        bucket = self._failures.get(key)
        if bucket is None:
            return None
        while bucket and bucket[0] <= now - self.window:
            bucket.popleft()
        if not bucket:
            self._failures.pop(key, None)
            return None
        return bucket

    def is_blocked(self, key: str, limit: int) -> bool:
        with self._lock:
            bucket = self._recent(key, monotonic())
            return bucket is not None and len(bucket) >= limit

    def add_failure(self, key: str, limit: int) -> None:
        with self._lock:
            now = monotonic()
            bucket = self._recent(key, now)
            if bucket is None:
                bucket = self._failures[key] = deque(maxlen=limit)
            bucket.append(now)
            self._failures.move_to_end(key)
            while len(self._failures) > self.max_keys:
                self._failures.popitem(last=False)

    def reset(self, key: str) -> None:
        with self._lock:
            self._failures.pop(key, None)

    def clear(self) -> None:
        with self._lock:
            self._failures.clear()


login_limiter = LoginRateLimiter(LOGIN_WINDOW_SECONDS, LOGIN_LIMITER_MAX_KEYS)


class LoginRateLimited(Exception):
    pass


_dummy_password_hash: str | None = None


def _burn_password_check(password: str) -> None:
    # 없는 계정이어도 PBKDF2 한 번을 돌려 응답 시간으로 계정 존재 여부가 드러나지 않게 한다.
    global _dummy_password_hash
    if _dummy_password_hash is None:
        _dummy_password_hash = user_module.hash_password(secrets.token_urlsafe(16))
    user_module.verify_password(password or "x", _dummy_password_hash)


# 데이터 규격은 main.py에서 검증을 위해 유지하거나 main으로 옮겨도 됩니다.
class LoginRequest(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=128)

def process_login(item: LoginRequest, client_ip: str = ""):
    normalized_email = str(item.email or "").strip().lower()
    # 이메일만으로 잠그면 남이 일부러 틀려 정상 사용자를 잠글 수 있으므로 (이메일 + IP) 로 센다.
    email_key = "email:" + normalized_email + "|" + (client_ip or "unknown")
    email_any_key = "email-any:" + normalized_email
    ip_key = "ip:" + (client_ip or "unknown")
    if (login_limiter.is_blocked(email_key, LOGIN_MAX_FAILURES_PER_EMAIL)
            or login_limiter.is_blocked(email_any_key, LOGIN_MAX_FAILURES_PER_EMAIL_ANY_IP)
            or login_limiter.is_blocked(ip_key, LOGIN_MAX_FAILURES_PER_IP)):
        raise LoginRateLimited(LOGIN_LOCKED_MESSAGE)

    def fail():
        login_limiter.add_failure(email_key, LOGIN_MAX_FAILURES_PER_EMAIL)
        login_limiter.add_failure(email_any_key, LOGIN_MAX_FAILURES_PER_EMAIL_ANY_IP)
        login_limiter.add_failure(ip_key, LOGIN_MAX_FAILURES_PER_IP)
        return {"success": False, "message": LOGIN_FAILED_MESSAGE}

    conn = None
    try:
        # DB 연결
        conn = _shared_db.open_connection()
        cursor = conn.cursor()

        cursor.execute(
            """SELECT u.companyid, c.companyname, u.username, u.email, u.password, u.authority,
                      (c.companyid <> '001' AND c.license_end IS NOT NULL
                       AND c.license_end < (now() AT TIME ZONE 'Asia/Seoul')::date) AS license_expired
               FROM user01t u
               JOIN company01t c ON c.companyid = u.companyid
               WHERE LOWER(u.email) = LOWER(%s)
                 AND UPPER(COALESCE(u.useyn, 'N')) = 'Y'
                 AND UPPER(COALESCE(c.company_status, '')) = 'ACTIVE'
               ORDER BY u.companyid
               LIMIT 2""",
            (item.email.strip(),),
        )
        matches = cursor.fetchall()
        if len(matches) != 1 or not user_module.is_password_hash(matches[0][4]):
            _burn_password_check(item.password)
            return fail()

        user = matches[0]
        if user_module.verify_password(item.password, user[4]):
            if user[6]:
                # 비밀번호가 맞은 경우에만 사유를 알려 준다 (계정 존재 여부 노출 방지)
                return {"success": False, "message": LICENSE_EXPIRED_MESSAGE}
            login_limiter.reset(email_key)
            login_limiter.reset(email_any_key)
            # 계정당 활성 세션 1개: 새 세션 ID 를 저장하면 이전에 발급한 토큰은 다음 요청부터 거절된다.
            session_id = secrets.token_urlsafe(32)
            cursor.execute(
                "UPDATE user01t SET session_id = %s WHERE companyid = %s AND email = %s",
                (session_id, user[0], user[3]),
            )
            conn.commit()
            # 이 워커의 권한 캐시를 비운다 (다른 워커는 세션 ID 가 다르면 DB 를 다시 읽어 확인한다).
            invalidate_user_access_cache(user[0], user[3])
            result = {
                "success": True,
                "message": "로그인 성공",
                "user_company": user[0],
                "user_companyname": user[1],
                "user_name": user[2],
                "user_email": user[3],
                "user_authority": str(user[5] or "USER").upper(),
            }
            result["access_token"] = create_access_token({**result, "session_id": session_id})
            result["token_type"] = "bearer"
            result["expires_in"] = ACCESS_TOKEN_MINUTES * 60
            return result
        return fail()

    finally:
        if conn:
            conn.close()


def process_logout(companyid: str, email: str, sid: str) -> None:
    """서버 세션을 끊는다 (이 토큰과 같은 세션일 때만 — 다른 곳에서 새로 로그인한 세션은 건드리지 않는다)."""
    with _shared_db.connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            "UPDATE user01t SET session_id = NULL WHERE companyid = %s AND email = %s AND session_id = %s",
            (companyid, email, sid),
        )
    invalidate_user_access_cache(companyid, email)
