import pyodbc
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

# MS-SQL 접속 문자열 (이 파일 내부에서 사용)
conn_str = (
    f"Driver={DB_CONFIG['Driver']};"
    f"Server={DB_CONFIG['Server']};"
    f"Database={DB_CONFIG['Database']};"
    f"UID={DB_CONFIG['UID']};"
    f"PWD={DB_CONFIG['PWD']};"
    # "TrustServerCertificate=yes;"
    # "Encrypt=yes;"
)


# 브랜드 리스트
def BrandList():
    conn = None
    try:
        conn = pyodbc.connect(conn_str)
        cursor = conn.cursor()

        query = "SELECT Brand,BrandName FROM SAPOutBrand01t ORDER BY SEQ"
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

# 품목코드 리스트
def ItemList():
    conn = None
    try:
        conn = pyodbc.connect(conn_str)
        cursor = conn.cursor()

        query = "SELECT ItemCode,ItemName FROM [Fu_SAPOutList]() ORDER BY ItemCode"
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

# 주차 리스트
def WeekList():
    conn = None
    try:
        conn = pyodbc.connect(conn_str)
        cursor = conn.cursor()

        query = """
            SELECT 주차
            FROM (
                SELECT 
                    CAST([Year] AS VARCHAR(4)) + N'년 ' + CAST([Week] AS VARCHAR(2)) + N'주차' AS 주차,
                    MIN(Outdt) AS Outdt
                FROM SAPOutTotal01t WITH(NOLOCK)
                GROUP BY [Year],[Week]
            ) A
            ORDER BY Outdt DESC
        """
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

# 주별 출고량 차트
def WeekChart(stdt,etdt,itemCode,Brand,itemName):
    conn = None
    try:
        conn = pyodbc.connect(conn_str)
        cursor = conn.cursor()

        query = "SELECT 주차,주차2,출고수량 FROM Fu_OutWeekChart(?,?,?,?,?) ORDER BY 주차2"
        cursor.execute(query,(stdt, etdt,itemCode,Brand,itemName))

        columns = [column[0] for column in cursor.description]

        result = []
        for row in cursor.fetchall():
            result.append(dict(zip(columns,row)))

        return {"success":True,"data":result}

    except Exception as e:
        return {"success":False, "error":str(e)}
    finally:
        if conn:conn.close()             

# 월별 출고량 상세 데이터
def WeekRow(prestdt,etdt,stdt,etdt2,itemCode,Brand,itemName):
    conn = None
    try:
        conn = pyodbc.connect(conn_str)
        cursor = conn.cursor()

        query = "SELECT * FROM Fu_OutWeekDATA(?,?,?,?,?,?,?)"
        cursor.execute(query,(prestdt,etdt,stdt,etdt2,itemCode,Brand,itemName))

        columns = [column[0] for column in cursor.description]

        result = []
        for row in cursor.fetchall():
            result.append(dict(zip(columns,row)))

        return {"success":True,"data":result}

    except Exception as e:
        return {"success":False, "error":str(e)}
    finally:
        if conn:conn.close()             
