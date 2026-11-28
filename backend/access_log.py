"""접속 · 운영사 접근 기록 (access_log01t). 기록 실패가 업무를 막지 않도록 오류는 로그만 남긴다."""
import logging

import db

logger = logging.getLogger(__name__)


def record(action: str, *, companyid: str | None = None, email: str | None = None, client_ip: str | None = None,
           target_companyid: str | None = None, method: str | None = None, path: str | None = None,
           detail: str | None = None) -> None:
    try:
        with db.connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """INSERT INTO access_log01t
                       (companyid, useremail, action, target_companyid, method, path, client_ip, detail)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
                (companyid or None, (email or "")[:254] or None, action[:40], target_companyid or None,
                 (method or "")[:10] or None, (path or "")[:300] or None, (client_ip or "")[:64] or None,
                 (detail or "")[:500] or None),
            )
    except Exception:
        logger.warning("access log write failed: action=%s", action, exc_info=True)
