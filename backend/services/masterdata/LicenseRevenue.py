"""라이선스 매출현황 (어드민 · 001 MASTER 전용) - 고객사별 라이선스 청구를 월별로 집계한다.

화면: frontend/src/pages/system/LicenseRevenue.jsx, API: routes/masterdata/LicenseRevenue_routes.py
규칙:
  - 지난달까지: 확정된 월별 청구(company_license_charge01t) 그대로 (매달 1일 00:01 KST 확정: LicenseCharge.py).
  - 이번 달(과 그 뒤): 아직 확정 전 → 지금 라이선스 개수(company01t.licensed_seats) × 라이선스 비용(company_license01t)로 계산 (estimated).
  - 과금 기간: 과금 시작일이 속한 달 ~ 과금 종료일이 속한 달 (종료일이 비면 계속). 일할 계산 없음.
  - 달 경계는 한국 시간(KST). 플랫폼 운영사(001)는 제외. 금액은 부가세 별도.
"""
from datetime import date, datetime
from zoneinfo import ZoneInfo

import db as _shared_db

MAX_MONTHS = 36
KST = ZoneInfo("Asia/Seoul")


def _month(value: date) -> date:
    return value.replace(day=1)


def _add_months(value: date, months: int) -> date:
    index = value.year * 12 + value.month - 1 + months
    return date(index // 12, index % 12 + 1, 1)


def _months_between(first: date, last: date) -> int:
    return (last.year - first.year) * 12 + last.month - first.month + 1


def this_month() -> date:
    return _month(datetime.now(KST).date())


def _load(cursor):
    cursor.execute(
        """SELECT c.companyid, c.companyname, c.plan_code, c.company_status, c.licensed_seats, c.license_start, c.license_end,
                  COALESCE(c.licensed_seats, 0), COALESCE(l.unit_price, 0)
           FROM company01t c LEFT JOIN company_license01t l ON l.companyid = c.companyid
           WHERE c.companyid <> '001' ORDER BY c.companyid"""
    )
    companies = [{"companyid": r[0], "companyname": r[1] or "", "plan_code": r[2], "company_status": r[3],
                  "licensed_seats": r[4] or 0, "start": r[5], "end": r[6],
                  "quantity": int(r[7] or 0), "unit_price": float(r[8] or 0), "charges": {}} for r in cursor.fetchall()]
    by_id = {c["companyid"]: c for c in companies}
    cursor.execute("SELECT companyid, charge_month, quantity, unit_price, amount FROM company_license_charge01t WHERE companyid <> '001'")
    for companyid, month, quantity, unit_price, amount in cursor.fetchall():
        if companyid in by_id:
            by_id[companyid]["charges"][month] = (int(quantity or 0), float(unit_price or 0), float(amount or 0))
    return companies


def _line(company: dict, month: date, current: date):
    """그 달 청구 (수량, 단가, 금액). 지난달까지는 확정 청구, 이번 달부터는 지금 설정. 없으면 None."""
    if month < current:
        line = company["charges"].get(month)
        return line if line and line[2] > 0 else None
    if not company["start"] or _month(company["start"]) > month:
        return None
    if company["end"] is not None and _month(company["end"]) < month:
        return None
    amount = company["quantity"] * company["unit_price"]
    return (company["quantity"], company["unit_price"], amount) if amount > 0 else None


def report(date_from: date, date_to: date, companyid: str | None = None) -> dict:
    """companyid 가 있으면 그 고객사 하나만 (모든 숫자가 그 고객사 기준)."""
    first = _month(min(date_from, date_to))
    last = _month(max(date_from, date_to))
    if _months_between(first, last) > MAX_MONTHS:
        first = _add_months(last, -(MAX_MONTHS - 1))
    months = [_add_months(first, offset) for offset in range(_months_between(first, last))]
    span = len(months)
    current = this_month()

    with _shared_db.connect() as connection, connection.cursor() as cursor:
        companies = _load(cursor)
    if companyid:
        companies = [c for c in companies if c["companyid"] == companyid]

    cache = {}

    def month_stats(month: date) -> dict:
        if month not in cache:
            billed = {c["companyid"]: line for c in companies if (line := _line(c, month, current))}
            cache[month] = {"total": sum(line[2] for line in billed.values()), "count": len(billed),
                            "quantity": sum(line[0] for line in billed.values()), "billed": billed}
        return cache[month]

    plan_of = {c["companyid"]: c["plan_code"] for c in companies}
    trend = []
    for month in months:
        now = month_stats(month)
        prev = month_stats(_add_months(month, -1))
        by_plan = {}
        for cid, line in now["billed"].items():
            by_plan[plan_of[cid]] = by_plan.get(plan_of[cid], 0) + line[2]
        trend.append({
            "month": month.strftime("%Y-%m"), "total": now["total"], "count": now["count"], "quantity": now["quantity"],
            "estimated": month >= current,  # 이번 달부터는 확정 전 (지금 설정으로 계산)
            # 신규 = 이 달부터 청구 시작, 해지 = 지난달까지 청구하고 이 달부터 끊긴 곳, 변경 = 둘 다 청구인데 금액이 바뀐 곳
            "new": sum(1 for cid in now["billed"] if cid not in prev["billed"]),
            "churn": sum(1 for cid in prev["billed"] if cid not in now["billed"]),
            "changed": sum(1 for cid, line in now["billed"].items() if cid in prev["billed"] and prev["billed"][cid][2] != line[2]),
            "by_plan": by_plan,
        })

    # 기준월: 조회 기간 안에 이번 달이 있으면 이번 달 (예: 1~12월 조회 중 11월), 아니면 기간의 마지막 달
    base_month = current if first <= current <= last else last
    base_index = months.index(base_month)

    rows = []
    for c in companies:
        lines = [month_stats(month)["billed"].get(c["companyid"]) for month in months]
        now_line = month_stats(base_month)["billed"].get(c["companyid"])
        rows.append({
            "companyid": c["companyid"], "companyname": c["companyname"], "plan_code": c["plan_code"],
            "company_status": c["company_status"], "licensed_seats": c["licensed_seats"],
            "license_start": c["start"], "license_end": c["end"],
            "setting_quantity": c["quantity"], "setting_unit_price": c["unit_price"],
            "quantity_now": now_line[0] if now_line else 0, "unit_price_now": now_line[1] if now_line else 0,
            "fee_now": now_line[2] if now_line else 0, "billed_now": bool(now_line),
            "amounts": [line[2] if line else 0 for line in lines],
            "quantities": [line[0] if line else 0 for line in lines],
            "total": sum(line[2] for line in lines if line),  # 표의 합계 = 조회 기간 전체 (뒤쪽 예정 달 포함)
            "billed_months": sum(1 for line in lines if line),
            "has_license": bool(c["start"]) and (c["quantity"] * c["unit_price"] > 0 or bool(c["charges"])),
        })
    rows.sort(key=lambda row: (-row["fee_now"], -row["total"], row["companyid"]))

    base = month_stats(base_month)
    prev = month_stats(_add_months(base_month, -1))
    base_trend = trend[base_index]
    mrr = base["total"]
    return {
        "month_from": first.strftime("%Y-%m"), "month_to": last.strftime("%Y-%m"), "months": [row["month"] for row in trend],
        "current_month": current.strftime("%Y-%m"), "base_month": base_month.strftime("%Y-%m"),
        "summary": {
            "mrr": mrr, "prev_mrr": prev["total"], "yoy_mrr": month_stats(_add_months(base_month, -12))["total"], "arr": mrr * 12,
            "base_estimated": base_month >= current,
            "billed_count": base["count"], "prev_billed_count": prev["count"],
            "quantity": base["quantity"], "prev_quantity": prev["quantity"],
            "new_count": base_trend["new"], "churn_count": base_trend["churn"], "changed_count": base_trend["changed"],
            "arpa": mrr / base["count"] if base["count"] else None,
            "prev_arpa": prev["total"] / prev["count"] if prev["count"] else None,
            "unit_avg": mrr / base["quantity"] if base["quantity"] else None,
            # 누적 = 기간 첫 달 ~ 기준월 (아직 오지 않은 달은 빼고)
            "period_total": sum(row["total"] for row in trend[:base_index + 1]),
            "prev_period_total": sum(month_stats(_add_months(first, -span + offset))["total"] for offset in range(span)),
            "registered_count": len(companies),
            "unbilled_count": sum(1 for row in rows if not row["has_license"]),
            "plan_mrr": base_trend["by_plan"],
        },
        "trend": trend,
        "companies": rows,
    }


def search_companies(keyword: str, limit: int = 10) -> list[dict]:
    """라이선스 매출현황 고객사 조건 자동완성 (회사명 · 회사코드)."""
    text = (keyword or "").strip()
    if not text:
        return []
    escaped = text.replace("\\", "\\\\").replace("%", "\%").replace("_", "\_")
    with _shared_db.connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """SELECT companyid, companyname FROM company01t
               WHERE companyid <> '001' AND (companyname ILIKE %(like)s OR companyid ILIKE %(like)s)
               ORDER BY (companyname = %(text)s) DESC, (companyname ILIKE %(prefix)s) DESC, companyname, companyid
               LIMIT %(limit)s""",
            {"like": f"%{escaped}%", "prefix": f"{escaped}%", "text": text, "limit": limit},
        )
        return [{"ckey": cid, "customcode": cid, "customname": name or ""} for cid, name in cursor.fetchall()]
