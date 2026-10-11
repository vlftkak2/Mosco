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

# PostgreSQL 접속 문자열
conn_str = (
    f"host={DB_CONFIG['host']} "
    f"port={DB_CONFIG['port']} "
    f"dbname={DB_CONFIG['database']} "
    f"user={DB_CONFIG['user']} "
    f"password={DB_CONFIG['password']}"
)

class CustomModifyRequest(BaseModel):
    companyid: str
    companyname: str
    customercode: str
    customername: str
    businessno : str
    ceoname:str
    tradetype:str
    phone:str
    address:str
    useryn:str
    remark:str

class UserDeleteRequest(BaseModel):
    company: str
    email: str


# 거래처 등록
def CustomerCreate(item: CustomModifyRequest):
    if not item.company.strip():
        return {"success": False, "message": "회사 정보가 필요합니다."}

    conn = None
    try:
        # DB 연결
        conn = psycopg2.connect(conn_str)
        cursor = conn.cursor()

        # # 거래처 중복 체크
        # check_query = "SELECT COUNT(*) FROM customer01t WHERE Email=%s AND Company=%s"
        # cursor.execute(check_query, (item.email, item.company))

        # email_count = cursor.fetchone()[0]
        # if email_count>0:
        #     return {"success":False,"message":"이미 등록된 이메일이 있습니다!"}

        # 사용자정보 등록
        query = "INSERT INTO customer01t(companyid, companyname, customercode, customername, businessno, ceoname,tradetype,phone,address,useyn,remark) VALUES(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"
        cursor.execute(query, (item.companyid, item.companyname, item.customercode, item.customername, item.businessno, item.ceoname, item.tradetype, item.phone, item.address, item.useryn, item.remark))

        conn.commit()
        
        if cursor.rowcount > 0:
            return {"success": True, "message": "거래처 정보 등록 완료!"}
        else:
            return {"success": False, "message": "업데이트 실패"} 

    except Exception as e: # 이 except 블록이 누락되었는지 확인하세요!
        return {"success": False, "message": str(e)}

    finally:
        if conn:
            conn.close() 
            


# User List
def UserList(username):
    conn = None
    try:
        conn = psycopg2.connect(conn_str)
        cursor = conn.cursor()

        query = "SELECT * FROM FU_USER01T(?)"
        cursor.execute(query,(username,))

        columns = [column[0] for column in cursor.description]

        result = []
        for row in cursor.fetchall():
            result.append(dict(zip(columns,row)))

        return {"success":True,"data":result}

    except Exception as e:
        return {"success":False, "error":str(e)}
    finally:
        if conn:conn.close()       

# 사용자정보 수정
def UserModify(item: CustomModifyRequest):
    if not item.company.strip():
        return {"success": False, "message": "회사 정보가 필요합니다."}

    conn = None
    try:
        # DB 연결
        conn = psycopg2.connect(conn_str)
        cursor = conn.cursor()

        # 사용자정보 업데이트
        if item.userpassword and item.userpassword.strip():
            query = "UPDATE USER01T SET Team=%s, UserName=%s, Password=%s, Authority=%s WHERE Email=%s AND Company=%s"
            cursor.execute(query, (item.team, item.username, item.userpassword, item.authority, item.email, item.company))
        else:
            query = "UPDATE USER01T SET Team=%s, UserName=%s, Authority=%s WHERE Email=%s AND Company=%s"
            cursor.execute(query, (item.team, item.username, item.authority, item.email, item.company))
             
        conn.commit()
        
        if cursor.rowcount > 0:
            return {"success": True, "message": "사용자 정보가 성공적으로 변경되었습니다."}
        else:
            return {"success": False, "message": "회사와 이메일이 일치하는 사용자를 찾을 수 없습니다."} 
            
    finally:
        if conn:
            conn.close()           


# 사용자정보 삭제
def UserDelete(item: UserDeleteRequest):
    if not item.company.strip():
        return {"success": False, "message": "회사 정보가 필요합니다."}

    conn = None
    try:
        
        # DB 연결
        conn = psycopg2.connect(conn_str)
        cursor = conn.cursor()

        # 이메일 중복 체크
        query = "DELETE FROM USER01T WHERE EMAIL=%s AND Company=%s"
        cursor.execute(query, (item.email, item.company))

        conn.commit()
        
        if cursor.rowcount > 0:
            return {"success": True, "message": "사용자 정보 삭제 완료!"}
        else:
            return {"success": False, "message": "업데이트 실패"} 

    except Exception as e: # 이 except 블록이 누락되었는지 확인하세요!
        return {"success": False, "message": str(e)}

    finally:
        if conn:
            conn.close()            

