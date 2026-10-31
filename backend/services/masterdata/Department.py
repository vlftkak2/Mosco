import pyodbc
import psycopg2
from config import DB_CONFIG
from datetime import datetime
import time
import jwt
import requests
import math
import os
import zipfile
import fitz
import re
#from tkinter import Tk, filedialog 
import pdfkit
import io
from pydantic import BaseModel
from typing import List
from typing import Optional

# PostgreSQL 접속 문자열
conn_str = (
    f"host={DB_CONFIG['host']} "
    f"port={DB_CONFIG['port']} "
    f"dbname={DB_CONFIG['database']} "
    f"user={DB_CONFIG['user']} "
    f"password={DB_CONFIG['password']}"
)

class DepartmentCreateRequest(BaseModel):
    departmentname: str

class DepartmentModifyRequest(BaseModel):
    departmentname: str
    departid: int

class DepartmentDeleteRequest(BaseModel):
    departid: int  

# Department List
def DepartmentList(departmentname):
    conn = None
    try:
        conn = psycopg2.connect(conn_str)
        cursor = conn.cursor()

        query = "SELECT * FROM Fu_Department01t(?) "
        cursor.execute(query,(departmentname,))

        columns = [column[0] for column in cursor.description]

        result = []
        for row in cursor.fetchall():
            result.append(dict(zip(columns,row)))

        return {"success":True,"data":result}

    except Exception as e:
        return {"success":False, "error":str(e)}
    finally:
        if conn:conn.close()       

# 부서정보 수정
def DepartmentModify(item: DepartmentModifyRequest):
    conn = None
    try:
        # DB 연결
        conn = psycopg2.connect(conn_str)
        cursor = conn.cursor()

        check_query = "SELECT COUNT(*) [COUNT] FROM Department01t WITH(NOLOCK) Where DepartName=?"
        cursor.execute(check_query, (item.departmentname,))

        double_count = cursor.fetchone()[0]
        if double_count>0:
            return {"success":False,"message":"이미 등록된 부서가 있습니다!"}

        query = "UPDATE Department01t SET DepartName=? WHERE DeptID=?"
        cursor.execute(query, (item.departmentname,item.departid,))
             
        conn.commit()
        
        if cursor.rowcount > 0:
            return {"success": True, "message": "부서 정보가 성공적으로 변경되었습니다."}
        else:
            return {"success": False, "message": "업데이트 실패"} 
            
    finally:
        if conn:
            conn.close()

# 부서정보 등록
def DepartmentCreate(item: DepartmentCreateRequest):
    conn = None
    try:
        # DB 연결
        conn = psycopg2.connect(conn_str)
        cursor = conn.cursor()

        # 중복 체크
        check_query = "SELECT COUNT(*) [COUNT] FROM Department01t WITH(NOLOCK) Where DepartName=?"
        cursor.execute(check_query, (item.departmentname,))

        double_count = cursor.fetchone()[0]
        if double_count>0:
            return {"success":False,"message":"이미 등록된 부서가 있습니다!"}

        # 사용자정보 등록
        query = "INSERT INTO Department01t(DepartName) VALUES(?)"
        cursor.execute(query, (item.departmentname))

        conn.commit()
        
        if cursor.rowcount > 0:
            return {"success": True, "message": "부서 정보 등록 완료!"}
        else:
            return {"success": False, "message": "업데이트 실패"} 

    except Exception as e: # 이 except 블록이 누락되었는지 확인하세요!
        return {"success": False, "message": str(e)}

    finally:
        if conn:
            conn.close()            


# 부서정보 삭제
def DepartmentDelete(item: DepartmentDeleteRequest):
    conn = None
    try:
        
        # DB 연결
        conn = psycopg2.connect(conn_str)
        cursor = conn.cursor()

        # 부서정보 삭제
        query = "DELETE FROM Department01t WHERE DeptID=?"
        cursor.execute(query, (item.departid,))

        conn.commit()
        
        if cursor.rowcount > 0:
            return {"success": True, "message": "부서 정보 삭제 완료!"}
        else:
            return {"success": False, "message": "업데이트 실패"} 

    except Exception as e: # 이 except 블록이 누락되었는지 확인하세요!
        return {"success": False, "message": str(e)}

    finally:
        if conn:
            conn.close()            

