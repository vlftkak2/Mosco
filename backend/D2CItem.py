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
def OutBrand():
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
def OutItemList():
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

# 바코드 리스트
def OutBarcodeList():
    conn = None
    try:
        conn = pyodbc.connect(conn_str)
        cursor = conn.cursor()

        query = "SELECT CodeBars FROM [Fu_SAPOutItemCodebarList]() WHERE CodeBars NOT LIKE '' ORDER BY CodeBars ASC"
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

# 품목코드별 차트 데이터
def OutItemChart(stdt,etdt,itemCode,itemName,Barcode,Brand):
    conn = None
    try:
        conn = pyodbc.connect(conn_str)
        cursor = conn.cursor()

        query = "SELECT 출고일자,출고수량 FROM Fu_OutItemChart(?,?,?,?,?,?) ORDER BY 출고일자 ASC"
        cursor.execute(query,(stdt,etdt,itemCode,itemName,Barcode,Brand))

        columns = [column[0] for column in cursor.description]

        result = []
        for row in cursor.fetchall():
            result.append(dict(zip(columns,row)))

        return {"success":True,"data":result}

    except Exception as e:
        return {"success":False, "error":str(e)}
    finally:
        if conn:conn.close()  


# 품목코드별 출고량 차트 데이터
def OutItemsChart(stdt,etdt,itemCode,itemName,Barcode,Brand):
    conn = None
    try:
        conn = pyodbc.connect(conn_str)
        cursor = conn.cursor()

        query = "SELECT 출고일자,품목코드,출고수량 FROM Fu_OutItemsChart(?,?,?,?,?,?) ORDER BY 출고일자 ASC,품목코드 ASC"
        cursor.execute(query,(stdt,etdt,itemCode,itemName,Barcode,Brand))

        columns = [column[0] for column in cursor.description]

        result = []
        for row in cursor.fetchall():
            result.append(dict(zip(columns,row)))

        return {"success":True,"data":result}

    except Exception as e:
        return {"success":False, "error":str(e)}
    finally:
        if conn:conn.close()   

# 품목코드별 상세 데이터
def OutItemRow(prestdt,preetdt,stdt,etdt,itemCode,itemName,Barcode,Brand):
    conn = None
    try:
        conn = pyodbc.connect(conn_str)
        cursor = conn.cursor()

        query = "SELECT * FROM Fu_OutItemDATA(?,?,?,?,?,?,?,?) "
        cursor.execute(query,(prestdt,preetdt,stdt,etdt,itemCode,itemName,Barcode,Brand))

        columns = [column[0] for column in cursor.description]

        result = []
        for row in cursor.fetchall():
            result.append(dict(zip(columns,row)))

        return {"success":True,"data":result}

    except Exception as e:
        return {"success":False, "error":str(e)}
    finally:
        if conn:conn.close()           