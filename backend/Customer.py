import pyodbc
import psycopg2
from psycopg2.extras import execute_values
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


def _next_customer_code(cursor, companyid: str) -> str:
    # Serialize code allocation per company so simultaneous registrations cannot get the same preview/save code.
    cursor.execute("SELECT pg_advisory_xact_lock(hashtext(%s)::bigint)", (companyid,))
    cursor.execute(
        """
        SELECT COALESCE(MAX(substring(customercode FROM 6)::bigint), 0)
        FROM customer01t
        WHERE companyid = %s AND customercode ~* '^Cust-[0-9]+$'
        """,
        (companyid,),
    )
    return f"Cust-{cursor.fetchone()[0] + 1:05d}"


def CustomerNextCode(companyid: str):
    conn = None
    try:
        conn = psycopg2.connect(conn_str)
        with conn.cursor() as cursor:
            code = _next_customer_code(cursor, companyid)
        conn.commit()
        return {"success": True, "customercode": code}
    except Exception as e:
        if conn:
            conn.rollback()
        return {"success": False, "message": str(e)}
    finally:
        if conn:
            conn.close()


# 거래처 등록
def CustomerCreate(item: CustomModifyRequest):

    conn = None
    try:
        # DB 연결
        conn = psycopg2.connect(conn_str)
        cursor = conn.cursor()
        customercode = (item.customercode or "").strip()
        if customercode:
            cursor.execute("SELECT pg_advisory_xact_lock(hashtext(%s)::bigint)", (item.companyid,))
            cursor.execute(
                "SELECT 1 FROM customer01t WHERE companyid = %s AND LOWER(customercode) = LOWER(%s) LIMIT 1",
                (item.companyid, customercode),
            )
            if cursor.fetchone():
                return {"success": False, "message": f"이미 등록된 거래처코드입니다: {customercode}"}
        else:
            customercode = _next_customer_code(cursor, item.companyid)

        # 사용자정보 등록
        query = "INSERT INTO customer01t(companyid, companyname, customercode, customername, businessno, ceoname,tradetype,phone,address,useyn,remark) VALUES(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"
        cursor.execute(query, (item.companyid, item.companyname, customercode, item.customername, item.businessno, item.ceoname, item.tradetype, item.phone, item.address, item.useryn, item.remark))

        conn.commit()
        
        if cursor.rowcount > 0:
            return {"success": True, "customercode": customercode, "message": f"거래처 정보 등록 완료! ({customercode})"}
        else:
            return {"success": False, "message": "업데이트 실패"} 

    except Exception as e: # 이 except 블록이 누락되었는지 확인하세요!
        return {"success": False, "message": str(e)}

    finally:
        if conn:
            conn.close() 


def CustomerBulkCreate(items: List[CustomModifyRequest]):
    """Insert a customer batch in one database operation and one transaction."""
    if not items:
        return {"success": False, "message": "등록할 거래처가 없습니다."}

    conn = None
    try:
        conn = psycopg2.connect(conn_str)
        with conn.cursor() as cursor:
            company_ids = {item.companyid for item in items}
            if len(company_ids) != 1:
                return {"success": False, "message": "업로드 데이터의 회사 정보가 일치하지 않습니다. 다시 로그인한 뒤 업로드해 주세요."}

            companyid = next(iter(company_ids))
            next_number = int(_next_customer_code(cursor, companyid).split("-")[1])
            requested_codes = [(item.customercode or "").strip() for item in items]
            explicit_codes = [code for code in requested_codes if code]
            normalized_codes = [code.casefold() for code in explicit_codes]
            if len(normalized_codes) != len(set(normalized_codes)):
                return {"success": False, "message": "업로드 파일에 중복된 거래처코드가 있습니다."}

            if normalized_codes:
                cursor.execute(
                    "SELECT customercode FROM customer01t WHERE companyid = %s AND LOWER(customercode) = ANY(%s)",
                    (companyid, normalized_codes),
                )
                duplicates = [row[0] for row in cursor.fetchall()]
                if duplicates:
                    return {"success": False, "message": f"이미 등록된 거래처코드가 있습니다: {', '.join(duplicates[:10])}"}

            used_codes = set(normalized_codes)
            assigned_codes = []
            generated_codes = []
            for requested_code in requested_codes:
                if requested_code:
                    assigned_codes.append(requested_code)
                    continue
                while True:
                    candidate = f"Cust-{next_number:05d}"
                    next_number += 1
                    if candidate.casefold() not in used_codes:
                        break
                used_codes.add(candidate.casefold())
                assigned_codes.append(candidate)
                generated_codes.append(candidate)

            query = """
                INSERT INTO customer01t
                    (companyid, companyname, customercode, customername, businessno,
                     ceoname, tradetype, phone, address, useyn, remark)
                VALUES %s
            """
            values = [
                (item.companyid, item.companyname, assigned_code, item.customername,
                 item.businessno, item.ceoname, item.tradetype, item.phone, item.address,
                 item.useryn, item.remark)
                for item, assigned_code in zip(items, assigned_codes)
            ]
            execute_values(cursor, query, values, page_size=1000)
        conn.commit()
        return {"success": True, "count": len(items), "codes": assigned_codes, "generated_codes": generated_codes, "message": f"거래처 {len(items)}건을 일괄 등록했습니다."}
    except Exception as e:
        if conn:
            conn.rollback()
        return {"success": False, "message": str(e)}
    finally:
        if conn:
            conn.close()
            
# 거래처 수정
def CustomerModify(item: CustomModifyRequest):

    conn = None
    try:
        # DB 연결
        conn = psycopg2.connect(conn_str)
        cursor = conn.cursor()

        # 거래처정보 업데이트
        query = "UPDATE customer01t SET customername=%s, businessno=%s, ceoname=%s, tradetype=%s, phone=%s, address=%s, useyn=%s, remark=%s, updatedat=NOW() WHERE companyid=%s and customercode=%s"
        cursor.execute(query, (item.customername, item.businessno, item.ceoname, item.tradetype, item.phone, item.address, item.useryn, item.remark, item.companyid, item.customercode))
             
        conn.commit()
        
        if cursor.rowcount > 0:
            return {"success": True, "message": "거래처 정보가 성공적으로 변경되었습니다."}
        else:
            return {"success": False, "message": "일치하는 거래처를 찾을 수 없습니다."} 
            
    finally:
        if conn:
            conn.close()           


# 거래처 조회: 회사별 검색 및 서버 페이지 처리
def CustomerList(
    companyid: str,
    search_keyword: str = None,
    status: str = "전체",
    tradetype: str = "전체",
    page: int = 1,
    page_size: int = 50,
):
    conn = None
    try:
        conn = psycopg2.connect(conn_str)
        cursor = conn.cursor()

        conditions = ["companyid = %s"]
        params = [companyid]

        # 검색은 거래처명만 대상으로 합니다.
        if search_keyword:
            conditions.append("(customername ILIKE %s OR customercode ILIKE %s)")
            params.extend([f"%{search_keyword}%", f"%{search_keyword}%"])

        if status and status != "전체":
            conditions.append("useyn = %s")
            params.append(status)

        if tradetype and tradetype != "전체":
            conditions.append("tradetype = %s")
            params.append(tradetype)

        where_sql = " AND ".join(conditions)
        cursor.execute(f"SELECT COUNT(*) FROM customer01t WHERE {where_sql}", tuple(params))
        total = cursor.fetchone()[0]

        cursor.execute(
            f"""
            SELECT * FROM customer01t
            WHERE {where_sql}
            ORDER BY
              CASE WHEN customercode ~* '^Cust-[0-9]+$'
                   THEN substring(customercode FROM 6)::bigint END ASC NULLS LAST,
              customercode ASC
            LIMIT %s OFFSET %s
            """,
            (*params, page_size, (page - 1) * page_size),
        )

        columns = [column[0] for column in cursor.description]
        result = [dict(zip(columns, row)) for row in cursor.fetchall()]

        return {"success": True, "data": result, "total": total, "page": page, "page_size": page_size}

    except Exception as e:
        return {"success": False, "error": str(e)}
    finally:
        if conn:
            conn.close()


def CustomerExport(companyid: str, search_keyword: str = None, status: str = "전체", tradetype: str = "전체"):
    """Return all customers matching the list filters for spreadsheet export."""
    conn = None
    try:
        conn = psycopg2.connect(conn_str)
        cursor = conn.cursor()
        conditions = ["companyid = %s"]
        params = [companyid]
        if search_keyword:
            conditions.append("(customername ILIKE %s OR customercode ILIKE %s)")
            params.extend([f"%{search_keyword}%", f"%{search_keyword}%"])
        if status and status != "전체":
            conditions.append("useyn = %s")
            params.append(status)
        if tradetype and tradetype != "전체":
            conditions.append("tradetype = %s")
            params.append(tradetype)

        cursor.execute(
            f"""SELECT * FROM customer01t WHERE {' AND '.join(conditions)}
                ORDER BY CASE WHEN customercode ~* '^Cust-[0-9]+$'
                              THEN substring(customercode FROM 6)::bigint END ASC NULLS LAST,
                         customercode ASC""",
            tuple(params),
        )
        columns = [column[0] for column in cursor.description]
        result = [dict(zip(columns, row)) for row in cursor.fetchall()]
        return {"success": True, "data": result, "total": len(result)}
    except Exception as e:
        return {"success": False, "error": str(e)}
    finally:
        if conn:
            conn.close()
