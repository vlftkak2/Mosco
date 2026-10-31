import pyodbc
from config import DB_CONFIG

# MS-SQL 접속 문자열 (이 파일 내부에서 사용)
conn_str = (
    f"Driver={DB_CONFIG['Driver']};"
    f"Server={DB_CONFIG['Server']};"
    f"Database={DB_CONFIG['Database']};"
    f"UID={DB_CONFIG['UID']};"
    f"PWD={DB_CONFIG['PWD']};"
)

# 국가 맵 정의
COUNTRY_MAP = {
    "1": "미국",
    "2": "홍콩",
    "3": "일본",
    "4": "대만",
    "5": "싱가포르",
    "6": "말레이시아",
    "7": "네덜란드",
}

# 해외 SAP 재고데이터 수집
def inventory_collect():
    conn = None
    try:
        conn = pyodbc.connect(conn_str)
        cursor = conn.cursor()
        cursor.execute("Exec usp_GlobalSapStock")
        conn.commit()
        return {"success": True, "message": "Data collection completed."}
    finally:
        if conn: conn.close()

# 해외 SAP 재고부족 데이터 조회
def inventory_shortagesearch():
    conn = None
    try:
        conn = pyodbc.connect(conn_str)
        cursor = conn.cursor()
        
        query = "SELECT 국가 FROM [fu_GlobalSapAllStock]() GROUP BY 국가"
        cursor.execute(query)
        rows = cursor.fetchall()
            
        countrys = {row[0] for row in rows}
        results = []

        for code, name in COUNTRY_MAP.items():
            errorcountry = name in countrys
            
            results.append({
                "country": name,
                "is_normal": not errorcountry
            })
        return {"success": True, "data": results}
    finally:
        if conn: conn.close()


# 해외 SAP 입고 에러 데이터 조회
def inventory_insearch():
    conn = None
    try:
        conn = pyodbc.connect(conn_str)
        cursor = conn.cursor()
        
        query = "SELECT 국가 FROM [fu_GlobalINRSTAllCheck]() GROUP BY 국가"
        cursor.execute(query)
        rows = cursor.fetchall()
            
        countrys = {row[0] for row in rows}
        results = []

        for code, name in COUNTRY_MAP.items():
            errorcountry = name in countrys
            
            results.append({
                "country": name,
                "is_normal": not errorcountry
            })
        return {"success": True, "data": results}
    finally:
        if conn: conn.close() 

# 해외 SAP 출고 에러 데이터 조회
def inventory_outsearch():
    conn = None
    try:
        conn = pyodbc.connect(conn_str)
        cursor = conn.cursor()
        
        query = "SELECT 국가 FROM [fu_GlobalOutRSTAllCheck]() GROUP BY 국가"
        cursor.execute(query)
        rows = cursor.fetchall()
            
        countrys = {row[0] for row in rows}
        results = []

        for code, name in COUNTRY_MAP.items():
            errorcountry = name in countrys
            
            results.append({
                "country": name,
                "is_normal": not errorcountry
            })
        return {"success": True, "data": results}
    finally:
        if conn: conn.close()         

# 해외 SAP Progress 에러 데이터 조회
def inventory_progresearch():
    conn = None
    try:
        conn = pyodbc.connect(conn_str)
        cursor = conn.cursor()
        
        query = "SELECT 국가 FROM [fu_GlobalRSTProgressAllCheck]() GROUP BY 국가"
        cursor.execute(query)
        rows = cursor.fetchall()
            
        countrys = {row[0] for row in rows}
        results = []

        for code, name in COUNTRY_MAP.items():
            errorcountry = name in countrys
            
            results.append({
                "country": name,
                "is_normal": not errorcountry
            })
        return {"success": True, "data": results}
    finally:
        if conn: conn.close()             

# 해외 SAP 기타출고WMS 취소→선택마감필요
def inventory_cancel_etcsearch():
    conn = None
    try:
        conn = pyodbc.connect(conn_str)
        cursor = conn.cursor()
        
        query = "SELECT 국가 FROM [Fu_GlobalEtcReqAllCheck]() GROUP BY 국가"
        cursor.execute(query)
        rows = cursor.fetchall()
            
        countrys = {row[0] for row in rows}
        results = []

        for code, name in COUNTRY_MAP.items():
            errorcountry = name in countrys
            
            results.append({
                "country": name,
                "is_normal": not errorcountry
            })
        return {"success": True, "data": results}
    finally:
        if conn: conn.close()           

# 해외 SAP 예외주문WMS 취소→선택마감필요
def inventory_cancel_exceptsearch():
    conn = None
    try:
        conn = pyodbc.connect(conn_str)
        cursor = conn.cursor()
        
        query = "SELECT 국가 FROM [Fu_GlobalExceptReqAllCheck]() GROUP BY 국가"
        cursor.execute(query)
        rows = cursor.fetchall()
            
        countrys = {row[0] for row in rows}
        results = []

        for code, name in COUNTRY_MAP.items():
            errorcountry = name in countrys
            
            results.append({
                "country": name,
                "is_normal": not errorcountry
            })
        return {"success": True, "data": results}
    finally:
        if conn: conn.close()          

# 해외 SAP 재고이전WMS 취소→선택마감필요
def inventory_cancel_movesearch():
    conn = None
    try:
        conn = pyodbc.connect(conn_str)
        cursor = conn.cursor()
        
        query = "SELECT 국가 FROM [Fu_GlobalMoveReqAllCheck]() GROUP BY 국가"
        cursor.execute(query)
        rows = cursor.fetchall()
            
        countrys = {row[0] for row in rows}
        results = []

        for code, name in COUNTRY_MAP.items():
            errorcountry = name in countrys
            
            results.append({
                "country": name,
                "is_normal": not errorcountry
            })
        return {"success": True, "data": results}
    finally:
        if conn: conn.close()     

# 해외 SAP 입고요청→실적미수신
def inventory_request_notinsearch():
    conn = None
    try:
        conn = pyodbc.connect(conn_str)
        cursor = conn.cursor()
        
        query = "SELECT 국가 FROM [fu_GlobalWmsInAllCheck]() GROUP BY 국가"
        cursor.execute(query)
        rows = cursor.fetchall()
            
        countrys = {row[0] for row in rows}
        results = []

        for code, name in COUNTRY_MAP.items():
            errorcountry = name in countrys
            
            results.append({
                "country": name,
                "is_normal": not errorcountry
            })
        return {"success": True, "data": results}
    finally:
        if conn: conn.close()                                

# 해외 SAP 출고요청→실적미수신
def inventory_request_notoutsearch():
    conn = None
    try:
        conn = pyodbc.connect(conn_str)
        cursor = conn.cursor()
        
        query = "SELECT 국가 FROM [fu_GlobalWmsOutAllCheck]() GROUP BY 국가"
        cursor.execute(query)
        rows = cursor.fetchall()
            
        countrys = {row[0] for row in rows}
        results = []

        for code, name in COUNTRY_MAP.items():
            errorcountry = name in countrys
            
            results.append({
                "country": name,
                "is_normal": not errorcountry
            })
        return {"success": True, "data": results}
    finally:
        if conn: conn.close()              

# 해외 SAP 재고부족 데이터 조회 All
def inventory_shortageAllsearch():
    conn = None
    try:
        conn = pyodbc.connect(conn_str)
        cursor = conn.cursor()
        
        query = "SELECT * FROM [fu_GlobalSapAllStock]() ORDER BY Seq"
        cursor.execute(query) 

        columns = [column[0] for column in cursor.description]

        rows = cursor.fetchall()
        results = []

        for row in rows:
            results.append(dict(zip(columns, row)))        
            
        return {"success":True, "data":results}

    except Exception as e:
        return {"success":False, "error":str(e)}
    finally:
        if conn: conn.close()

# 해외 SAP 입고 에러 데이터 조회 All
def inventory_inAllsearch():
    conn = None
    try:
        conn = pyodbc.connect(conn_str)
        cursor = conn.cursor()
        
        query = "SELECT * FROM [fu_GlobalINRSTAllCheck]() ORDER BY Seq "
        cursor.execute(query) 

        columns = [column[0] for column in cursor.description]

        rows = cursor.fetchall()
        results = []

        for row in rows:
            results.append(dict(zip(columns, row)))        
            
        return {"success":True, "data":results}

    except Exception as e:
        return {"success":False, "error":str(e)}
    finally:
        if conn: conn.close()        

# 해외 SAP 출고 에러 데이터 조회 All
def inventory_outAllsearch():
    conn = None
    try:
        conn = pyodbc.connect(conn_str)
        cursor = conn.cursor()
        
        query = "SELECT * FROM [fu_GlobalOutRSTAllCheck]() ORDER BY Seq "
        cursor.execute(query) 

        columns = [column[0] for column in cursor.description]

        rows = cursor.fetchall()
        results = []

        for row in rows:
            results.append(dict(zip(columns, row)))        
            
        return {"success":True, "data":results}

    except Exception as e:
        return {"success":False, "error":str(e)}
    finally:
        if conn: conn.close()    


# 해외 SAP Progress 에러 데이터 조회 All
def inventory_progreAllsearch():
    conn = None
    try:
        conn = pyodbc.connect(conn_str)
        cursor = conn.cursor()
        
        query = "SELECT * FROM [fu_GlobalRSTProgressAllCheck]() ORDER BY Seq"
        cursor.execute(query) 

        columns = [column[0] for column in cursor.description]

        rows = cursor.fetchall()
        results = []

        for row in rows:
            results.append(dict(zip(columns, row)))        
            
        return {"success":True, "data":results}

    except Exception as e:
        return {"success":False, "error":str(e)}
    finally:
        if conn: conn.close()    

# 해외 SAP 기타출고WMS 취소→선택마감필요 All
def inventory_cancel_etcAllsearch():
    conn = None
    try:
        conn = pyodbc.connect(conn_str)
        cursor = conn.cursor()
        
        query = "SELECT * FROM [Fu_GlobalEtcReqAllCheck]() ORDER BY SEQ"
        cursor.execute(query) 

        columns = [column[0] for column in cursor.description]

        rows = cursor.fetchall()
        results = []

        for row in rows:
            results.append(dict(zip(columns, row)))        
            
        return {"success":True, "data":results}

    except Exception as e:
        return {"success":False, "error":str(e)}
    finally:
        if conn: conn.close()            


# 해외 SAP 예외주문WMS 취소→선택마감필요 All
def inventory_cancel_exceptAllsearch():
    conn = None
    try:
        conn = pyodbc.connect(conn_str)
        cursor = conn.cursor()
        
        query = "SELECT * FROM [Fu_GlobalExceptReqAllCheck]() ORDER BY SEQ"
        cursor.execute(query) 

        columns = [column[0] for column in cursor.description]

        rows = cursor.fetchall()
        results = []

        for row in rows:
            results.append(dict(zip(columns, row)))        
            
        return {"success":True, "data":results}

    except Exception as e:
        return {"success":False, "error":str(e)}
    finally:
        if conn: conn.close()     

# 해외 SAP 재고이전WMS 취소→선택마감필요 All
def inventory_cancel_moveAllsearch():
    conn = None
    try:
        conn = pyodbc.connect(conn_str)
        cursor = conn.cursor()
        
        query = "SELECT * FROM [Fu_GlobalMoveReqAllCheck]() ORDER BY SEQ"
        cursor.execute(query) 

        columns = [column[0] for column in cursor.description]

        rows = cursor.fetchall()
        results = []

        for row in rows:
            results.append(dict(zip(columns, row)))        
            
        return {"success":True, "data":results}

    except Exception as e:
        return {"success":False, "error":str(e)}
    finally:
        if conn: conn.close()           

# 해외 SAP 입고요청→실적미수신 All
def inventory_request_notinAllsearch():
    conn = None
    try:
        conn = pyodbc.connect(conn_str)
        cursor = conn.cursor()
        
        query = "SELECT * FROM [fu_GlobalWmsInAllCheck]() ORDER BY SEQ "
        cursor.execute(query) 

        columns = [column[0] for column in cursor.description]

        rows = cursor.fetchall()
        results = []

        for row in rows:
            results.append(dict(zip(columns, row)))        
            
        return {"success":True, "data":results}

    except Exception as e:
        return {"success":False, "error":str(e)}
    finally:
        if conn: conn.close()         

# 해외 SAP 출고요청→실적미수신 All
def inventory_request_notoutAllsearch():
    conn = None
    try:
        conn = pyodbc.connect(conn_str)
        cursor = conn.cursor()
        
        query = "SELECT * FROM [fu_GlobalWmsOutAllCheck]() ORDER BY Seq,출고요청일 DESC,문서유형"
        cursor.execute(query) 

        columns = [column[0] for column in cursor.description]

        rows = cursor.fetchall()
        results = []

        for row in rows:
            results.append(dict(zip(columns, row)))        
            
        return {"success":True, "data":results}

    except Exception as e:
        return {"success":False, "error":str(e)}
    finally:
        if conn: conn.close()
