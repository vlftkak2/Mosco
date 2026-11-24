"""고객사 라이선스 월별 청구 확정 (company_license_charge01t).

달이 넘어가면 전월 청구를 그때의 라이선스 개수(company01t.licensed_seats) × 라이선스 비용(company_license01t.unit_price)으로 한 줄 넣는다.
  - 매달 1일 00:01 (KST): 서버 안의 예약 작업이 전월분을 넣는다 (start_monthly_close, main.py 시작 때 실행).
  - 서버 시작 때: 꺼져 있던 동안 빠진 달을 채운다.
  - 고객사 저장 전: 고치기 전 값으로 지난달까지 먼저 확정 → 고친 값은 이번 달부터만 반영 (1일 00:01 전에 고쳐도 안전)
  - 고객사 저장 후: 과금 기간이 바뀌어 새로 생긴 지난달을 새 값으로 채우고, 기간 밖이 된 청구는 지운다
이번 달은 아직 확정 전이라 넣지 않는다 (화면은 지금 값으로 계산해 보여 준다). 이미 있는 달은 건너뛴다 (여러 번 돌아도 같음).
달 경계는 한국 시간(KST, Asia/Seoul) 기준 — DB 서버 시간대와 상관없다.
"""
import logging
import threading
import time
from datetime import datetime
from zoneinfo import ZoneInfo

import db as _shared_db

KST = ZoneInfo("Asia/Seoul")
logger = logging.getLogger(__name__)
_scheduler_started = False
_scheduler_lock = threading.Lock()

_CLOSE_SQL = """
INSERT INTO company_license_charge01t (companyid, charge_month, quantity, unit_price, amount, created_by)
SELECT c.companyid, m.month::date, c.licensed_seats, l.unit_price, c.licensed_seats * l.unit_price, %(actor)s
FROM company01t c
JOIN company_license01t l ON l.companyid = c.companyid
CROSS JOIN LATERAL generate_series(date_trunc('month', c.license_start),
                                   LEAST(COALESCE(date_trunc('month', c.license_end), 'infinity'::timestamp),
                                         date_trunc('month', (now() AT TIME ZONE 'Asia/Seoul')::date) - interval '1 month'),
                                   interval '1 month') AS m(month)
WHERE c.license_start IS NOT NULL AND COALESCE(c.licensed_seats, 0) * l.unit_price > 0
  AND (%(companyid)s::varchar IS NULL OR c.companyid = %(companyid)s::varchar)
ON CONFLICT (companyid, charge_month) DO NOTHING
"""

_TRIM_SQL = """
DELETE FROM company_license_charge01t x
USING company01t c
WHERE c.companyid = x.companyid AND x.companyid = %(companyid)s
  AND (c.license_start IS NULL OR x.charge_month < date_trunc('month', c.license_start)
       OR (c.license_end IS NOT NULL AND x.charge_month > date_trunc('month', c.license_end)))
"""


def close_months(cursor, companyid: str | None = None, actor: str | None = None) -> int:
    """지난달까지 아직 없는 청구를 지금 설정으로 넣는다. companyid 가 없으면 모든 고객사."""
    cursor.execute(_CLOSE_SQL, {"companyid": companyid, "actor": actor or "auto"})
    return cursor.rowcount


def trim_outside_period(cursor, companyid: str) -> int:
    """과금 기간 밖이 된 청구를 지운다 (기간을 고쳐 줄였을 때)."""
    cursor.execute(_TRIM_SQL, {"companyid": companyid})
    return cursor.rowcount


def save_setting(cursor, companyid: str, unit_price: int, actor: str | None) -> None:
    """지금 단가 저장 (수량은 허용 계정 수). 바뀐 경우에만 수정일자 · 수정자를 남긴다."""
    cursor.execute(
        """INSERT INTO company_license01t (companyid, unit_price, created_by)
           VALUES (%s, %s, %s)
           ON CONFLICT (companyid) DO UPDATE
           SET unit_price = EXCLUDED.unit_price, updatedat = CURRENT_TIMESTAMP, updated_by = %s
           WHERE company_license01t.unit_price IS DISTINCT FROM EXCLUDED.unit_price""",
        (companyid, unit_price, actor or None, actor or None),
    )


def close_all_now(actor: str = "auto") -> int:
    """모든 고객사의 지난달까지 청구를 확정한다 (예약 작업 · 서버 시작 때)."""
    with _shared_db.connect() as connection, connection.cursor() as cursor:
        return close_months(cursor, None, actor)


def _next_run(now: datetime) -> datetime:
    """다음 실행 시각: 매달 1일 00:01 (KST). 이번 달 1일 00:01 전이면 그때, 지났으면 다음 달."""
    this_run = datetime(now.year, now.month, 1, 0, 1, tzinfo=KST)
    if now < this_run:
        return this_run
    year, month = (now.year + 1, 1) if now.month == 12 else (now.year, now.month + 1)
    return datetime(year, month, 1, 0, 1, tzinfo=KST)


def _monthly_loop() -> None:
    try:
        count = close_all_now()
        logger.info("license charges: startup catch-up inserted %s rows", count)
    except Exception:  # 서버는 그대로 뜨고, 다음 실행 때 다시 채운다
        logger.exception("license charges: startup catch-up failed")
    while True:
        target = _next_run(datetime.now(KST))
        while (remaining := (target - datetime.now(KST)).total_seconds()) > 0:
            time.sleep(min(remaining, 3600))  # 한 시간씩 나눠 자서 시계가 바뀌어도 크게 어긋나지 않게
        try:
            count = close_all_now()
            logger.info("license charges: monthly close inserted %s rows", count)
        except Exception:
            logger.exception("license charges: monthly close failed, retry in 10 minutes")
            time.sleep(600)
            continue
        time.sleep(60)  # 같은 1일 00:01 안에서 두 번 돌지 않게


def start_monthly_close() -> None:
    """서버 시작 때 한 번 부른다: 빠진 달 채우기 + 매달 1일 00:01(KST) 전월 확정 예약. 여러 번 불러도 한 번만 돈다."""
    global _scheduler_started
    with _scheduler_lock:
        if _scheduler_started:
            return
        _scheduler_started = True
    threading.Thread(target=_monthly_loop, name="license-monthly-close", daemon=True).start()


_PAUSE_SQL = """
INSERT INTO company_license_charge01t (companyid, charge_month, quantity, unit_price, amount, created_by)
SELECT %(companyid)s, m.month::date, 0, COALESCE(l.unit_price, 0), 0, %(actor)s
FROM generate_series(date_trunc('month', %(old_end)s::date) + interval '1 month',
                     LEAST(COALESCE(date_trunc('month', %(new_end)s::date), 'infinity'::timestamp),
                           date_trunc('month', (now() AT TIME ZONE 'Asia/Seoul')::date) - interval '1 month'),
                     interval '1 month') AS m(month)
LEFT JOIN company_license01t l ON l.companyid = %(companyid)s
ON CONFLICT (companyid, charge_month) DO NOTHING
"""


def mark_paused(cursor, companyid: str, old_end, new_end, actor: str | None = None) -> int:
    """이용정지(과금 종료) 뒤 다시 이용할 때: 예전 종료월 다음 달 ~ 지난달(또는 새 종료월)을 0원 청구로 확정해 소급 청구를 막는다."""
    cursor.execute(_PAUSE_SQL, {"companyid": companyid, "old_end": old_end, "new_end": new_end, "actor": f"pause:{actor or 'auto'}"})
    return cursor.rowcount
