# DB 접속 정보 따로 저장
# DB_CONFIG = {
#     "Driver": "{SQL Server}",  #SQL Server
#     "Server": "43.203.185.92",
#     "Database": "APR",
#     "UID": "APR",
#     "PWD": "Aa1234!!"
# }

# PostgreSQL DB 접속 정보 설정
import os
from pathlib import Path

local_env_path = Path(__file__).resolve().parent / ".env"
if local_env_path.is_file():
    for env_line in local_env_path.read_text(encoding="utf-8").splitlines():
        env_line = env_line.strip()
        if not env_line or env_line.startswith("#") or "=" not in env_line:
            continue
        env_key, env_value = env_line.split("=", 1)
        os.environ.setdefault(env_key.strip(), env_value.strip().strip('"').strip("'"))

default_db_host = "host.docker.internal" if os.getenv("RUNNING_IN_DOCKER") == "1" else "localhost"

DB_CONFIG = {
    "host": os.getenv("DB_HOST", default_db_host),
    "port": os.getenv("DB_PORT", "5432"),
    "database": os.getenv("DB_NAME", "Mosco"),
    "user": os.getenv("DB_USER", "postgres"),
    "password": os.getenv("DB_PASSWORD", "1234"),
}

# CORS 허용 리스트
ALLOWED_ORIGINS = [
    "*",
]

JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "")
