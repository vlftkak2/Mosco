import db as _shared_db
import secrets

from pydantic import BaseModel, Field, field_validator
from config import DB_CONFIG
from services.auth import User as user_module


# PostgreSQL 접속 문자열
conn_str = (
    f"host={DB_CONFIG['host']} "
    f"port={DB_CONFIG['port']} "
    f"dbname={DB_CONFIG['database']} "
    f"user={DB_CONFIG['user']} "
    f"password={DB_CONFIG['password']}"
)

# 데이터 규격은 main.py에서 검증을 위해 유지하거나 main으로 옮겨도 됩니다.
class PasswordRequest(BaseModel):
    password: str = Field(max_length=128)
    changepassword: str = Field(max_length=128)

    @field_validator("changepassword")
    @classmethod
    def validate_changepassword(cls, value: str) -> str:
        return user_module.validate_new_password(value)

# 현재 비밀번호 대입 방지: 계정별 10분에 5회까지 틀릴 수 있다 (로그인 제한기와 같은 방식)
PASSWORD_CHANGE_MAX_FAILURES = 5


class PasswordChangeRateLimited(Exception):
    pass


def password_change(item: PasswordRequest, companyid: str, email: str):
    """성공하면 새 세션 ID 를 돌려준다 (다른 곳의 기존 접속은 모두 끊긴다)."""
    from services.auth.login import login_limiter, LOGIN_LOCKED_MESSAGE  # 순환 import 방지

    if not companyid.strip() or not email.strip():
        return {"success": False, "message": "회사 정보가 필요합니다."}
    limit_key = f"pwchange:{companyid.strip()}:{email.strip().lower()}"
    if login_limiter.is_blocked(limit_key, PASSWORD_CHANGE_MAX_FAILURES):
        raise PasswordChangeRateLimited(LOGIN_LOCKED_MESSAGE)

    conn = None
    try:
        # DB 연결
        conn = _shared_db.open_connection()
        cursor = conn.cursor()

        check_query = "SELECT Password FROM User01t WHERE Email=%s AND companyid=%s"
        cursor.execute(check_query, (email, companyid))
        row = cursor.fetchone()

        if not row:
            return {"success": False, "message": "현재 회사 정보와 이메일에 해당하는 계정을 찾을 수 없습니다."}
        if not user_module.verify_password(item.password, row[0]):
            login_limiter.add_failure(limit_key, PASSWORD_CHANGE_MAX_FAILURES)
            return {"success": False, "message": "기존 비밀번호가 일치하지 않습니다."}
        login_limiter.reset(limit_key)

        # 비밀번호는 새 계정과 같은 방식으로 해시해 저장합니다.
        # 새 세션 ID 로 바꿔 다른 곳(탈취된 토큰 포함)의 접속을 끊고, 지금 화면에는 새 토큰을 내려 준다.
        session_id = secrets.token_urlsafe(32)
        query = "UPDATE USER01T SET Password=%s, session_id=%s WHERE Email=%s AND companyid=%s"
        cursor.execute(query, (user_module.hash_password(item.changepassword), session_id, email, companyid))
        updated = cursor.rowcount

        conn.commit()

        if updated > 0:
            return {"success": True, "message": "비밀번호가 성공적으로 변경되었습니다.", "session_id": session_id}
        else:
            return {"success": False, "message": "업데이트 실패"} 
            
    finally:
        if conn:
            conn.close()

