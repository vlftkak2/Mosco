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

JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "")

APP_ENV = os.getenv("APP_ENV", "development").strip().lower()
_cors_origins = os.getenv("CORS_ALLOWED_ORIGINS", "").strip()
ALLOWED_ORIGINS = [
    origin.strip().rstrip("/")
    for origin in _cors_origins.split(",")
    if origin.strip()
]

if APP_ENV in {"production", "prod"}:
    if not ALLOWED_ORIGINS or "*" in ALLOWED_ORIGINS:
        raise RuntimeError("Set CORS_ALLOWED_ORIGINS to explicit production site origins.")
    required_production_settings = {
        "DB_HOST": os.getenv("DB_HOST", "").strip(),
        "DB_NAME": os.getenv("DB_NAME", "").strip(),
        "DB_USER": os.getenv("DB_USER", "").strip(),
        "DB_PASSWORD": os.getenv("DB_PASSWORD", "").strip(),
    }
    missing_production_settings = [name for name, value in required_production_settings.items() if not value]
    if missing_production_settings:
        raise RuntimeError(
            "Missing production database settings: " + ", ".join(missing_production_settings)
        )
    if len(JWT_SECRET_KEY) < 32:
        raise RuntimeError("JWT_SECRET_KEY must be configured with at least 32 characters in production.")
elif not ALLOWED_ORIGINS:
    # Local development defaults; production must supply an explicit allowlist.
    ALLOWED_ORIGINS = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]
