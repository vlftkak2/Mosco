# DB 접속 정보 따로 저장
# DB_CONFIG = {
#     "Driver": "{SQL Server}",  #SQL Server
#     "Server": "43.203.185.92",
#     "Database": "APR",
#     "UID": "APR",
#     "PWD": "Aa1234!!"
# }

# PostgreSQL DB 접속 정보 설정
DB_CONFIG = {
    "host": "localhost",       # PostgreSQL이 설치된 주소 (로컬이면 localhost 또는 127.0.0.1)
    "port": "5432",            # PostgreSQL 기본 포트
    "database": "Mosco",       # 방금 pgAdmin에서 만드신 데이터베이스 이름 (Mosco)
    "user": "postgres",        # PostgreSQL 접속 아이디 (기본값 postgres 또는 설정하신 계정)
    "password": "1234"  # 설치할 때 입력했던 비밀번호
}

# CORS 허용 리스트
ALLOWED_ORIGINS = [
    "*",
]