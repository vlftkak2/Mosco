"""기록 테이블 보관 기간 정리 (매일 또는 매주 실행).

    python scripts/cleanup_logs.py            # 기본 보관 기간으로 삭제
    python scripts/cleanup_logs.py --dry-run  # 지울 건수만 표시

기본 보관 기간 (환경변수로 변경):
  request_key01t  : 30일   (CLEANUP_REQUEST_KEY_DAYS)   — 중복 저장 방지 키, 오래된 것은 필요 없음
  access_log01t   : 730일  (CLEANUP_ACCESS_LOG_DAYS)    — 개인정보 처리시스템 접속기록은 최소 1년(대규모는 2년) 보관 의무
  audit_log01t    : 1825일 (CLEANUP_AUDIT_LOG_DAYS)     — 전표 변경 이력 (회계 증빙 보관 기간에 맞춰 조정)
한 번에 5,000행씩 나눠 지워 오래 잠그지 않는다.
"""
import argparse
import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import db  # noqa: E402

TARGETS = [
    ("request_key01t", "ctid", int(os.getenv("CLEANUP_REQUEST_KEY_DAYS", "30"))),
    ("access_log01t", "logid", int(os.getenv("CLEANUP_ACCESS_LOG_DAYS", "730"))),
    ("audit_log01t", "auditid", int(os.getenv("CLEANUP_AUDIT_LOG_DAYS", "1825"))),
]
BATCH = 5000


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    for table, key, days in TARGETS:
        with db.connect() as connection, connection.cursor() as cursor:
            cursor.execute(f"SELECT COUNT(*) FROM {table} WHERE createdat < now() - make_interval(days => %s)", (days,))
            count = cursor.fetchone()[0]
        print(f"{table}: {count} row(s) older than {days} days")
        if args.dry_run or not count:
            continue
        deleted = 0
        while True:
            with db.connect() as connection, connection.cursor() as cursor:
                cursor.execute(
                    f"""DELETE FROM {table} WHERE {key} IN (
                            SELECT {key} FROM {table} WHERE createdat < now() - make_interval(days => %s) LIMIT %s)""",
                    (days, BATCH),
                )
                batch = cursor.rowcount
            deleted += batch
            if batch < BATCH:
                break
        print(f"  deleted {deleted}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
