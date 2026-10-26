import pyodbc
import psycopg2
from pydantic import BaseModel
from config import DB_CONFIG
from security import ACCESS_TOKEN_MINUTES, create_access_token
import User as user_module


# PostgreSQL 접속 문자열
conn_str = (
    f"host={DB_CONFIG['host']} "
    f"port={DB_CONFIG['port']} "
    f"dbname={DB_CONFIG['database']} "
    f"user={DB_CONFIG['user']} "
    f"password={DB_CONFIG['password']}"
)

# 데이터 규격은 main.py에서 검증을 위해 유지하거나 main으로 옮겨도 됩니다.
class LoginRequest(BaseModel):
    email: str
    password: str

def process_login(item: LoginRequest):
    conn = None
    try:
        # DB 연결
        conn = psycopg2.connect(conn_str)
        cursor = conn.cursor()

        cursor.execute(
            """SELECT u.companyid, c.companyname, u.username, u.email, u.password, u.authority
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
        if len(matches) != 1:
            return {"success": False, "message": "계정 정보가 일치하지 않거나 회사 이용 상태를 확인할 수 없습니다."}

        user = matches[0]
        if user_module.verify_password(item.password, user[4]):
            if not user_module.is_password_hash(user[4]):
                cursor.execute(
                    """UPDATE user01t SET password = %s
                       WHERE companyid = %s AND LOWER(email) = LOWER(%s) AND password = %s""",
                    (user_module.hash_password(item.password), user[0], user[3], user[4]),
                )
                conn.commit()
            result = {
                "success": True,
                "message": "로그인 성공",
                "user_company": user[0],
                "user_companyname": user[1],
                "user_name": user[2],
                "user_email": user[3],
                "user_authority": str(user[5] or "USER").upper(),
            }
            result["access_token"] = create_access_token(result)
            result["token_type"] = "bearer"
            result["expires_in"] = ACCESS_TOKEN_MINUTES * 60
            return result
        return {"success": False, "message": "계정 정보가 일치하지 않거나 회사 이용 상태를 확인할 수 없습니다."}
            
    finally:
        if conn:
            conn.close()
