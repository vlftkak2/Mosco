"""AI 비용현황 (어드민 · 모스코 전용 메뉴 AI_COST) - 고객사별 AI 주문서인식 비용을 월별로 집계한다.

화면: frontend/src/pages/system/AiCost.jsx, API: routes/masterdata/AiCost_routes.py
규칙:
  - 자료: aiorderanalysis01t (AI 를 실제로 호출한 분석 기록 · 삭제하지 않음). 같은 파일을 다시 올려 저장된 결과를 쓴 경우는 기록이 없다(비용 0).
  - 비용: 분석마다 저장된 추정 비용(USD) = 토큰 × 그때의 단가 (OpenAI 청구서와 조금 다를 수 있음). 실패한 분석은 비용 0.
  - 호출: 성공한 분석 건수 (고객사등록의 AI 월 호출 한도와 같은 기준). 실패 건수는 따로.
  - 원화: USD × 환율 (기본값 .env AI_COST_USD_KRW, 화면에서 바꿔 볼 수 있음). 달 경계는 한국 시간(KST).
  - 플랫폼 운영사(001)도 포함 (AI 비용은 운영사가 내는 비용).
"""
import os
from datetime import date, datetime
from zoneinfo import ZoneInfo

import db as _shared_db

MAX_MONTHS = 36
KST = ZoneInfo("Asia/Seoul")
DEFAULT_KRW_RATE = max(1.0, float(os.getenv("AI_COST_USD_KRW", "1400")))


def _month(value: date) -> date:
    return value.replace(day=1)


def _add_months(value: date, months: int) -> date:
    index = value.year * 12 + value.month - 1 + months
    return date(index // 12, index % 12 + 1, 1)


def _months_between(first: date, last: date) -> int:
    return (last.year - first.year) * 12 + last.month - first.month + 1


def this_month() -> date:
    return _month(datetime.now(KST).date())


def report(date_from: date, date_to: date, companyid: str | None = None) -> dict:
    """companyid 가 있으면 그 고객사 하나만."""
    first = _month(min(date_from, date_to))
    last = _month(max(date_from, date_to))
    if _months_between(first, last) > MAX_MONTHS:
        first = _add_months(last, -(MAX_MONTHS - 1))
    months = [_add_months(first, offset) for offset in range(_months_between(first, last))]
    index_of = {m: i for i, m in enumerate(months)}
    current = this_month()
    start = datetime(first.year, first.month, 1, tzinfo=KST)
    end = datetime(_add_months(last, 1).year, _add_months(last, 1).month, 1, tzinfo=KST)

    with _shared_db.connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """SELECT c.companyid, c.companyname, c.company_status, q.monthly_limit
               FROM company01t c LEFT JOIN company_ai_quota01t q ON q.companyid = c.companyid
               WHERE (%s::varchar IS NULL OR c.companyid = %s) ORDER BY c.companyid""",
            (companyid, companyid),
        )
        companies = {r[0]: {"companyid": r[0], "companyname": r[1] or r[0], "company_status": r[2], "monthly_limit": r[3]} for r in cursor.fetchall()}
        # 회사 · 월(KST)별 합계 — (companyid, created_at) 인덱스
        cursor.execute(
            """SELECT companyid, MAX(companyname),
                      date_trunc('month', created_at AT TIME ZONE 'Asia/Seoul')::date AS m,
                      COUNT(*) FILTER (WHERE status = 'succeeded'), COUNT(*) FILTER (WHERE status <> 'succeeded'),
                      COALESCE(SUM(input_tokens), 0), COALESCE(SUM(output_tokens), 0), COALESCE(SUM(estimated_cost_usd), 0)
               FROM aiorderanalysis01t
               WHERE created_at >= %s AND created_at < %s AND (%s::varchar IS NULL OR companyid = %s)
               GROUP BY companyid, m""",
            (start, end, companyid, companyid),
        )
        stats = cursor.fetchall()
        # 이번 달 성공 건수 (한도 대비 사용)
        month_start = datetime(current.year, current.month, 1, tzinfo=KST)
        cursor.execute(
            """SELECT companyid, COUNT(*) FROM aiorderanalysis01t
               WHERE created_at >= %s AND status = 'succeeded' AND (%s::varchar IS NULL OR companyid = %s) GROUP BY companyid""",
            (month_start, companyid, companyid),
        )
        used_now = dict(cursor.fetchall())

    span = len(months)
    rows = {}
    for cid, name, m, ok, failed, tin, tout, cost in stats:
        if m not in index_of:
            continue
        info = companies.get(cid) or {"companyid": cid, "companyname": name or cid, "company_status": None, "monthly_limit": None}
        row = rows.setdefault(cid, {**info, "costs": [0.0] * span, "calls": [0] * span, "failed": [0] * span,
                                    "input_tokens": 0, "output_tokens": 0})
        i = index_of[m]
        row["costs"][i] += float(cost)
        row["calls"][i] += int(ok)
        row["failed"][i] += int(failed)
        row["input_tokens"] += int(tin)
        row["output_tokens"] += int(tout)
    # 한도를 정한 고객사는 사용이 없어도 보인다
    for cid, info in companies.items():
        if cid not in rows and info["monthly_limit"] is not None:
            rows[cid] = {**info, "costs": [0.0] * span, "calls": [0] * span, "failed": [0] * span, "input_tokens": 0, "output_tokens": 0}

    base_month = current if first <= current <= last else last
    base = index_of[base_month]
    out = []
    for row in rows.values():
        row["total_cost"] = sum(row["costs"])
        row["total_calls"] = sum(row["calls"])
        row["total_failed"] = sum(row["failed"])
        row["cost_now"] = row["costs"][base]
        row["calls_now"] = row["calls"][base]
        row["used_month"] = int(used_now.get(row["companyid"], 0))
        out.append(row)
    out.sort(key=lambda r: (-r["cost_now"], -r["total_cost"], r["companyid"]))

    trend = []
    for i, m in enumerate(months):
        trend.append({
            "month": m.strftime("%Y-%m"), "current": m == current,
            "cost": sum(r["costs"][i] for r in out), "calls": sum(r["calls"][i] for r in out),
            "failed": sum(r["failed"][i] for r in out), "companies": sum(1 for r in out if r["calls"][i] or r["failed"][i]),
        })
    calls_base = trend[base]["calls"]
    return {
        "month_from": first.strftime("%Y-%m"), "month_to": last.strftime("%Y-%m"), "months": [t["month"] for t in trend],
        "current_month": current.strftime("%Y-%m"), "base_month": base_month.strftime("%Y-%m"), "krw_rate": DEFAULT_KRW_RATE,
        "summary": {
            "cost_now": trend[base]["cost"], "calls_now": calls_base, "companies_now": trend[base]["companies"],
            "cost_per_call": trend[base]["cost"] / calls_base if calls_base else None,
            "period_cost": sum(t["cost"] for t in trend[:base + 1]), "period_calls": sum(t["calls"] for t in trend[:base + 1]),
            "prev_cost": trend[base - 1]["cost"] if base > 0 else None,
        },
        "trend": trend,
        "companies": out,
    }


def search_companies(keyword: str, limit: int = 10) -> list[dict]:
    """고객사 조건 자동완성 (회사명 · 회사코드, 모스코 포함)."""
    text = (keyword or "").strip()
    if not text:
        return []
    escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    with _shared_db.connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """SELECT companyid, companyname FROM company01t
               WHERE companyname ILIKE %(like)s OR companyid ILIKE %(like)s
               ORDER BY (companyname = %(text)s) DESC, (companyname ILIKE %(prefix)s) DESC, companyname, companyid
               LIMIT %(limit)s""",
            {"like": f"%{escaped}%", "prefix": f"{escaped}%", "text": text, "limit": limit},
        )
        return [{"ckey": cid, "customcode": cid, "customname": name or ""} for cid, name in cursor.fetchall()]
