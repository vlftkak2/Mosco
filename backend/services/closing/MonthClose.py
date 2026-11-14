"""월마감 (메뉴: MONTH_CLOSING)

회사별로 달 단위 마감을 한다. 마감된 달까지의 전표는 등록·수정·삭제할 수 없다.

  규칙
    · 마감은 순서대로만: 처음 마감하는 달은 자유롭게 고르고, 그다음부터는 "마지막 마감월의 다음 달"만 마감할 수 있다.
      → 마감된 달은 항상 끊김 없이 이어지므로 "마감 기준일 = 마지막 마감월의 말일" 하나로 판단한다.
    · 마감 취소는 마지막 마감월만 (거꾸로 한 달씩).
    · 아직 오지 않은 달(다음 달 이후)은 마감할 수 없다.
    · 마감 = monthclose01t 에 그 달 행 추가, 마감 취소 = 그 행 삭제 (별도 이력 테이블은 두지 않는다).

  막는 대상 (전표 일자 <= 마감 기준일)
    입고 · 출고 (기타비용 포함) · 기초재고 · 재고이전 · 가공 · 수금/지급 의 저장 · 수정 · 삭제 · 담당자 수정,
    수표/어음 결제·할인·부도 처리와 처리취소 (처리일 기준).

  동시성
    전표 저장은 같은 키의 공유 advisory lock, 마감·취소는 배타 lock 을 잡는다.
    → 저장 중인 전표가 끝난 뒤에 마감되고, 마감 중에는 그 회사 전표 저장이 잠깐 기다린다.
"""
from datetime import date, datetime
from zoneinfo import ZoneInfo

import db as _shared_db

_connect = _shared_db.connect


def _lock_key(companyid: str) -> str:
    return f"month-close:{companyid}"


def _month_start(value: date) -> date:
    return value.replace(day=1)


def _next_month(value: date) -> date:
    return date(value.year + (value.month == 12), value.month % 12 + 1, 1)


def _month_end(value: date) -> date:
    return date.fromordinal(_next_month(value).toordinal() - 1)


def _to_date(value) -> date | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])


def _today() -> date:
    return datetime.now(ZoneInfo("Asia/Seoul")).date()


def _last_closed_month(cursor, companyid: str) -> date | None:
    cursor.execute("SELECT MAX(closemonth) FROM monthclose01t WHERE companyid = %s", (companyid,))
    return cursor.fetchone()[0]


def closed_through(cursor, companyid: str) -> date | None:
    """마감 기준일 (마지막 마감월의 말일). 마감이 없으면 None."""
    last = _last_closed_month(cursor, companyid)
    return _month_end(last) if last else None


def ensure_open(cursor, companyid: str, dates, action: str = "저장") -> None:
    """전표 일자가 마감된 달에 있으면 ValueError. 전표를 쓰는 트랜잭션 안에서 부른다."""
    cursor.execute("SELECT pg_advisory_xact_lock_shared(hashtextextended(%s, 0))", (_lock_key(companyid),))
    through = closed_through(cursor, companyid)
    if not through:
        return
    closed = sorted({value for value in (_to_date(item) for item in dates) if value and value <= through})
    if closed:
        raise ValueError(
            f"{through:%Y-%m}월까지 마감되어 {closed[0]:%Y-%m-%d} 일자 전표는 {action}할 수 없습니다. "
            f"월마감 관리에서 마감을 취소한 뒤 {action}해 주세요."
        )


# ---------------------------------------------------------------------------
# 화면: 월별 마감 상태 + 전표 건수
# ---------------------------------------------------------------------------
_COUNT_SQL = """
SELECT month, kind, COUNT(*) FROM (
    SELECT date_trunc('month', receptdate)::date AS month, 'inbound' AS kind FROM Inbound01t
     WHERE companyid = %(companyid)s AND receptdate >= %(date_from)s AND receptdate < %(date_to)s
    UNION ALL
    SELECT date_trunc('month', receptdate)::date, 'outbound' FROM Outbound01t
     WHERE companyid = %(companyid)s AND receptdate >= %(date_from)s AND receptdate < %(date_to)s
    UNION ALL
    SELECT date_trunc('month', receptdate)::date, 'transfer' FROM inoutmove01t
     WHERE companyid = %(companyid)s AND receptdate >= %(date_from)s AND receptdate < %(date_to)s
    UNION ALL
    SELECT date_trunc('month', processdate)::date, 'process' FROM Process01t
     WHERE companyid = %(companyid)s AND processdate >= %(date_from)s AND processdate < %(date_to)s
    UNION ALL
    SELECT date_trunc('month', receiptdate)::date, 'receiptpayment' FROM ReceiptPayment01t
     WHERE companyid = %(companyid)s AND receiptdate >= %(date_from)s AND receiptdate < %(date_to)s
    UNION ALL
    SELECT date_trunc('month', standdate)::date, 'opening' FROM StandStock01t
     WHERE companyid = %(companyid)s AND standdate >= %(date_from)s AND standdate < %(date_to)s
) t
GROUP BY month, kind
"""
COUNT_KINDS = ("opening", "inbound", "outbound", "transfer", "process", "receiptpayment")


def list_months(companyid: str, year: int) -> dict:
    date_from = date(year, 1, 1)
    date_to = date(year + 1, 1, 1)
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(_COUNT_SQL, {"companyid": companyid, "date_from": date_from, "date_to": date_to})
        counts = {}
        for month, kind, count in cursor.fetchall():
            counts.setdefault(month, {})[kind] = count
        cursor.execute(
            f"""SELECT m.closemonth, m.closed_at,
                       COALESCE((SELECT u.username FROM user01t u WHERE u.email = m.closed_by LIMIT 1), m.closed_by)
                FROM monthclose01t m
                WHERE m.companyid = %s AND m.closemonth >= %s AND m.closemonth < %s""",
            (companyid, date_from, date_to),
        )
        closed = {row[0]: {"closed_at": row[1], "closed_by": row[2]} for row in cursor.fetchall()}
        last = _last_closed_month(cursor, companyid)

    today = _today()
    next_closable = _next_month(last) if last else None
    months = []
    for index in range(12):
        month = date(year, index + 1, 1)
        info = closed.get(month)
        month_counts = {kind: counts.get(month, {}).get(kind, 0) for kind in COUNT_KINDS}
        if info:
            can_close, can_reopen = False, month == last
        else:
            can_close = month <= _month_start(today) and (next_closable is None or month == next_closable)
            can_reopen = False
        months.append({
            "month": month.strftime("%Y-%m"), "closed": bool(info),
            "closed_at": info["closed_at"] if info else None, "closed_by": info["closed_by"] if info else None,
            "counts": month_counts, "total": sum(month_counts.values()),
            "can_close": can_close, "can_reopen": can_reopen,
        })
    return {
        "year": year, "months": months,
        "last_closed": last.strftime("%Y-%m") if last else None,
        "closed_through": _month_end(last) if last else None,
        "next_closable": next_closable.strftime("%Y-%m") if next_closable else None,
    }


def _parse_month(value: str) -> date:
    try:
        return datetime.strptime(str(value).strip()[:7], "%Y-%m").date()
    except ValueError as error:
        raise ValueError("마감월을 YYYY-MM 형식으로 입력해 주세요.") from error


def close_month(companyid: str, companyname: str, month: str, actor: str | None) -> dict:
    target = _parse_month(month)
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (_lock_key(companyid),))
        if target > _month_start(_today()):
            raise ValueError("아직 오지 않은 달은 마감할 수 없습니다.")
        last = _last_closed_month(cursor, companyid)
        if last and target <= last:
            raise ValueError(f"{target:%Y-%m}월은 이미 마감되었습니다.")
        if last and target != _next_month(last):
            raise ValueError(f"마감은 순서대로 해야 합니다. 먼저 {_next_month(last):%Y-%m}월을 마감해 주세요.")
        cursor.execute(
            "INSERT INTO monthclose01t (companyid, companyname, closemonth, closed_by) VALUES (%s, %s, %s, %s)",
            (companyid, str(companyname or "")[:100], target, actor or None),
        )
    return {"month": target.strftime("%Y-%m"), "closed_through": _month_end(target)}


def reopen_month(companyid: str, month: str) -> dict:
    target = _parse_month(month)
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (_lock_key(companyid),))
        last = _last_closed_month(cursor, companyid)
        if not last or target > last:
            raise ValueError(f"{target:%Y-%m}월은 마감되지 않았습니다.")
        if target != last:
            raise ValueError(f"마감 취소는 마지막 마감월부터 해야 합니다. 먼저 {last:%Y-%m}월 마감을 취소해 주세요.")
        cursor.execute("DELETE FROM monthclose01t WHERE companyid = %s AND closemonth = %s", (companyid, target))
        through = _last_closed_month(cursor, companyid)
    return {"month": target.strftime("%Y-%m"), "closed_through": _month_end(through) if through else None}
