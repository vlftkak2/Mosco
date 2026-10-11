import pyodbc
import psycopg2
from config import DB_CONFIG
from datetime import datetime
import time
import jwt
import requests
import math
import httpx
import os
import zipfile
import fitz
import re
#from tkinter import Tk, filedialog 
import pdfkit
import io
from pydantic import BaseModel
from typing import List
import json

# PostgreSQL 접속 문자열
conn_str = (
    f"host={DB_CONFIG['host']} "
    f"port={DB_CONFIG['port']} "
    f"dbname={DB_CONFIG['database']} "
    f"user={DB_CONFIG['user']} "
    f"password={DB_CONFIG['password']}"
)


class PermissionAuth(BaseModel):
    userName:str
    userEmail:str
    addList:List[str]
    removeList:List[str]

# 메뉴 리스트
def MenuMasterList():
    conn = None
    try:
        conn = psycopg2.connect(conn_str)
        cursor = conn.cursor()

        query = "SELECT * FROM Fu_MenuMaster01t() ORDER BY MenuSeq "
        cursor.execute(query)

        columns = [column[0] for column in cursor.description]

        result = []
        for row in cursor.fetchall():
            result.append(dict(zip(columns,row)))

        return {"success":True,"data":result}

    except Exception as e:
        return {"success":False, "error":str(e)}
    finally:
        if conn:conn.close()        

# 팀별 메뉴 권한 리스트
def MenuTeamList():
    conn = None
    try:
        conn = psycopg2.connect(conn_str)
        cursor = conn.cursor()

        query = "SELECT * FROM Fu_MenuTeamAuth01t()  ORDER BY TeamName,MenuID"
        cursor.execute(query)

        columns = [column[0] for column in cursor.description]

        result = []
        for row in cursor.fetchall():
            result.append(dict(zip(columns,row)))

        return {"success":True,"data":result}

    except Exception as e:
        return {"success":False, "error":str(e)}
    finally:
        if conn:conn.close()        

# 사용자별 메뉴 권한 리스트
def MenuUserList():
    conn = None
    try:
        conn = psycopg2.connect(conn_str)
        cursor = conn.cursor()

        query = "SELECT * FROM Fu_MenuUserAuth01t() ORDER BY UserName,MenuID "
        cursor.execute(query)

        columns = [column[0] for column in cursor.description]

        result = []
        for row in cursor.fetchall():
            result.append(dict(zip(columns,row)))

        return {"success":True,"data":result}

    except Exception as e:
        return {"success":False, "error":str(e)}
    finally:
        if conn:conn.close()            

def MenuUserAuthList(manager):
    conn = None
    try:
        conn = psycopg2.connect(conn_str)
        cursor = conn.cursor()
        query = "SELECT * FROM Fu_UserMenuAuth(?) ORDER BY 권한,부서,사용자" 
        cursor.execute(query, (manager,))
        rows = cursor.fetchall()

        final_data = []
        for row in rows:
            # 1. JSON 파싱 안전하게 처리 (문자열이 아니면 빈 배열로)
            def safe_json_load(data):
                if not data or data == 'NULL': return []
                try:
                    return json.loads(data)
                except:
                    return []

            processed_item = {
                "사용자": row[0] if row[0] is not None else "이름없음",
                "이메일": row[1] if row[1] is not None else f"no-email-{row[0]}",
                "부서": row[2] if row[2] is not None else "부서없음",
                "권한": row[3] if row[3] is not None else "USER",
                # 컬럼 순서 주의: 이미지상 5번째(index 4)가 TeamAuths, 6번째(index 5)가 UserExceptions
                "TeamAuths": safe_json_load(row[4]),
                "UserExceptions": safe_json_load(row[5])
            }
            final_data.append(processed_item)

        return {"success": True, "data": final_data}
    except Exception as e:
        return {"success": False, "error": str(e)}
    finally:
        if conn: conn.close()

# 이메일 기준 권한
def MenuUserAuthEmailList(email):
    conn = None
    try:
        conn = psycopg2.connect(conn_str)
        cursor = conn.cursor()
        query = "SELECT * FROM Fu_UserMenuAuth('') WHERE 이메일=? ORDER BY 권한,부서,사용자" 
        cursor.execute(query, (email,))
        rows = cursor.fetchall()

        final_data = []
        for row in rows:
            # 1. JSON 파싱 안전하게 처리 (문자열이 아니면 빈 배열로)
            def safe_json_load(data):
                if not data or data == 'NULL': return []
                try:
                    return json.loads(data)
                except:
                    return []

            processed_item = {
                "사용자": row[0] if row[0] is not None else "이름없음",
                "이메일": row[1] if row[1] is not None else f"no-email-{row[0]}",
                "부서": row[2] if row[2] is not None else "부서없음",
                "권한": row[3] if row[3] is not None else "USER",
                # 컬럼 순서 주의: 이미지상 5번째(index 4)가 TeamAuths, 6번째(index 5)가 UserExceptions
                "TeamAuths": safe_json_load(row[4]),
                "UserExceptions": safe_json_load(row[5])
            }
            final_data.append(processed_item)

        return {"success": True, "data": final_data}
    except Exception as e:
        return {"success": False, "error": str(e)}
    finally:
        if conn: conn.close()        

# 사용자별 권한부여
def UserAuthUpdate(item: PermissionAuth):
    conn = None
    try:
        conn = psycopg2.connect(conn_str)
        cursor = conn.cursor()

        delete_query = "DELETE FROM MenuUserAuth01t WHERE UserEmail = ?"
        cursor.execute(delete_query, (item.userEmail,))

        # 권한 추가
        if item.addList:
            # inital_query = "DELETE FROM MenuUserAuth01t WHERE UserEmail = ? AND MenuID = ?"
            insert_query = """
                INSERT INTO MenuUserAuth01t (UserName, UserEmail, MenuID, AuthType)
                SELECT ?, ?, ?, 'GRANT'
                WHERE NOT EXISTS (
                    SELECT 1 FROM MenuUserAuth01t 
                    WHERE UserEmail = ? AND MenuID = ?)
            """
            
            for menu_id in item.addList:
                # cursor.execute(inital_query, (item.userEmail, menu_id))
                cursor.execute(insert_query, (item.userName, item.userEmail, menu_id, item.userEmail, menu_id))

        # 권한 삭제
        if item.removeList:
            # inital_query = "DELETE FROM MenuUserAuth01t WHERE UserEmail = ? AND MenuID = ?"
            delete_query = """
                INSERT INTO MenuUserAuth01t (UserName, UserEmail, MenuID, AuthType)
                SELECT ?, ?, ?, 'DENY'
                WHERE NOT EXISTS (
                    SELECT 1 FROM MenuUserAuth01t 
                    WHERE UserEmail = ? AND MenuID = ?)
            """
            for menu_id in item.removeList:
                # cursor.execute(inital_query, (item.userEmail, menu_id))
                cursor.execute(delete_query, (item.userName, item.userEmail, menu_id, item.userEmail, menu_id))
            
        conn.commit()
        return {"success": True, "message": "변경사항만 반영되었습니다."}

    except Exception as e:
        if conn: conn.rollback()
        return {"success": False, "error": str(e)}
    finally:
        if conn: conn.close()