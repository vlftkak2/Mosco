import pyodbc
import psycopg2
from pydantic import BaseModel
from config import DB_CONFIG
from fastapi import HTTPException
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
class PasswordRequest(BaseModel):
    password: str
    changepassword: str

def password_change(item: PasswordRequest, companyid: str, email: str):
    if not companyid.strip() or not email.strip():
        return {"success": False, "message": "회사 정보가 필요합니다."}

    conn = None
    try:
        # DB 연결
        conn = psycopg2.connect(conn_str)
        cursor = conn.cursor()

        check_query = "SELECT Password FROM User01t WHERE Email=%s AND companyid=%s"
        cursor.execute(check_query, (email, companyid))
        row = cursor.fetchone()

        if not row:
            return {"success": False, "message": "현재 회사 정보와 이메일에 해당하는 계정을 찾을 수 없습니다."}
        if not user_module.verify_password(item.password, row[0]):
            return {"success": False, "message": "기존 비밀번호가 일치하지 않습니다."} 

        # 비밀번호는 새 계정과 같은 방식으로 해시해 저장합니다.
        query = "UPDATE USER01T SET Password=%s WHERE Email=%s AND companyid=%s"
        cursor.execute(query, (user_module.hash_password(item.changepassword), email, companyid))
        
        conn.commit()
        
        if cursor.rowcount > 0:
            return {"success": True, "message": "비밀번호가 성공적으로 변경되었습니다."}
        else:
            return {"success": False, "message": "업데이트 실패"} 
            
    finally:
        if conn:
            conn.close()

