import pyodbc
import psycopg2
from pydantic import BaseModel
from config import DB_CONFIG


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
        
        # 쿼리 실행
        query = "SELECT CompanyID, UserName, Email FROM User01t WHERE Email = %s AND Password = %s"
        cursor.execute(query, (item.email, item.password))
        user = cursor.fetchone()
        
        if user:
            return {
                "success": True,
                "message": "로그인 성공",
                "user_company": user[0],
                "user_name": user[1],
                "user_email": user[2],
            }
        else:
            return {"success": False, "message": "계정 정보가 일치하지 않습니다."}
            
    finally:
        if conn:
            conn.close()
