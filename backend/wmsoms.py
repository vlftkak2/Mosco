import pyodbc
from config import DB_CONFIG
from datetime import datetime

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

CACHES = {
    "prev_strange":{"data":[],"last_updated":None},
    "cur_strange":{"data":[],"last_updated":None},
}

# WMSOMS Collect 캐시
def collectWmsOmsAllCaches():
    conn = None
    try:
        # 1. DB 연결
        conn = pyodbc.connect(conn_str)
        cursor = conn.cursor()
        
        # 2. 실행할 쿼리들과 매핑될 캐시 키 정의
        # (캐시 키, 실행할 쿼리) 순서
        targets = [
            ("prev_strange", "SELECT * FROM Fu_PreWMSOMSCompareStrangeList() ORDER BY WMS출고일,주문번호"),
            ("cur_strange", "SELECT * FROM Fu_NowWMSOMSCompareStrangeList() ORDER BY WMS출고일,주문번호")
        ]

        current_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        # 3. 반복문을 돌며 쿼리 실행 및 캐시 저장
        for cache_key, query in targets:
            cursor.execute(query)
            
            # 컬럼명 추출
            columns = [column[0] for column in cursor.description]
            # 데이터 fetch 및 dict 변환
            rows = cursor.fetchall()
            
            # 전역 변수 CACHES 업데이트
            CACHES[cache_key]["data"] = [dict(zip(columns, row)) for row in rows]
            CACHES[cache_key]["last_updated"] = current_time
            
            print(f"--- [{cache_key}] 캐시 완료: {len(CACHES[cache_key]['data'])}건 ---")

        print(f"=== 모든 WMS/OMS 캐시 수집 성공 ({current_time}) ===")

    except Exception as e:
        print(f"!!! WMS/OMS 캐시 업데이트 실패: {e}")
    finally:
        # 4. 연결 해제
        if conn:
            conn.close()

def searchWmsOmsAllCaches(target_type: str):
    try:
        # 요청한 타입이 CACHES에 있는지 확인
        if target_type in CACHES:
            return {
                "success": True,
                "data": CACHES[target_type]["data"],
                "last_updated": CACHES[target_type]["last_updated"]
            }
        else:
            return {
                "success": False,
                "message": f"Invalid type: {target_type}. Choose from prev_all, prev_strange, cur_all, cur_strange"
            }
    except Exception as e:
        return {"success": False, "message": str(e)}


# 전월 WMS/OMS 이상건수
def prevwmsomsverifone():
    conn = None
    try:
        conn = pyodbc.connect(conn_str)
        cursor = conn.cursor()

        query = "SELECT * FROM Fu_PreWMSOMSCompareStrange()"
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

# 전월 WMS/OMS 전체 건수
def prevwmsomsveriftwo():
    conn = None
    try:
        conn = pyodbc.connect(conn_str)
        cursor = conn.cursor()

        query = "SELECT * FROM Fu_PreWMSOMSCompareTotal()"
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

# 전월 WMS/OMS 마켓별 이상일자
def prevwmsomsverifthree():
    conn = None
    try:
        conn = pyodbc.connect(conn_str)
        cursor = conn.cursor()

        query = "SELECT * FROM Fu_PreWMSOMSCompareStrangeDetail()"
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

# 당월 WMS/OMS 이상건수
def nowwmsomsverifone():
    conn = None
    try:
        conn = pyodbc.connect(conn_str)
        cursor = conn.cursor()

        query = "SELECT * FROM Fu_NowWMSOMSCompareStrange()"
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

# 당월 WMS/OMS 전체건수
def nowwmsomsveriftwo():
    conn = None
    try:
        conn = pyodbc.connect(conn_str)
        cursor = conn.cursor()

        query = "SELECT * FROM Fu_NowWMSOMSCompareTotal()"
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

# 당월 WMS/OMS 마켓별 이상일자
def nowwmsomsverifthree():
    conn = None
    try:
        conn = pyodbc.connect(conn_str)
        cursor = conn.cursor()

        query = "SELECT * FROM Fu_NowWMSOMSCompareStrangeDetail()"
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

