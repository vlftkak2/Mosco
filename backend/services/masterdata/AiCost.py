"""AI 비용현황 (어드민 · 모스코 전용 메뉴 AI_COST) - 고객사별 AI 비용(주문서인식 + 업무비서)을 월별로 집계한다.

화면: frontend/src/pages/system/AiCost.jsx, API: routes/masterdata/AiCost_routes.py
규칙:
  - 자료: aiorderanalysis01t (AI 를 실제로 호출한 분석 기록 · 삭제하지 않음). 같은 파일을 다시 올려 저장된 결과를 쓴 경우는 기록이 없다(비용 0).
  - 비용: 분석마다 저장된 추정 비용(USD) = 토큰 × 그때의 단가 (OpenAI 청구서와 조금 다를 수 있음). 실패한 분석은 비용 0.
  - 호출: 성공한 분석 건수 (고객사등록의 AI 월 호출 한도와 같은 기준). 실패 건수는 따로.
  - 원화: USD × 환율 (기본값 .env AI_COST_USD_KRW, 화면에서 바꿔 볼 수 있음). 달 경계는 한국 시간(KST).
  - 플랫폼 운영사(001)도 포함 (AI 비용은 운영사가 내는 비용).
  - 업무비서(챗봇): aichatusage01t (질문 1건 = 1행 · 삭제하지 않음). 비용 = 성공 · 실패 모두 쓴 토큰만큼, 달 = usage_month(KST).
    · 비용(costs · cost)은 주문서인식 + 업무비서 합계. 나눠 본 값은 order_* / chat_* 칸.
    · 호출(calls)은 지금처럼 주문서인식 성공 건수만 (고객사 AI 월 호출 한도와 같은 기준). 업무비서 질문 수는 chat_calls.
    · 테이블이 아직 없으면(마이그레이션 0003 전) 업무비서는 0 으로 본다.
  - 사용자별(users): 회사 · 사용자(이메일)마다 조회 기간 합계와 이번 달 합계. 이름은 직원 정보(user01t)의 지금 이름, 없으면 기록된 이름.
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
        # 업무비서 (챗봇) 회사 · 월별 합계 — ix_aichatusage01t_month
        chat_stats = []
        cursor.execute("SELECT to_regclass('aichatusage01t') IS NOT NULL")
        has_chat = bool(cursor.fetchone()[0])
        if has_chat:
            cursor.execute(
                """SELECT companyid, MAX(companyname), usage_month,
                          COUNT(*) FILTER (WHERE status = 'complete'), COUNT(*) FILTER (WHERE status = 'failed'),
                          COALESCE(SUM(input_tokens), 0), COALESCE(SUM(output_tokens), 0), COALESCE(SUM(estimated_cost_usd), 0)
                   FROM aichatusage01t
                   WHERE usage_month >= %s AND usage_month < %s AND (%s::varchar IS NULL OR companyid = %s)
                   GROUP BY companyid, usage_month""",
                (first, _add_months(last, 1), companyid, companyid),
            )
            chat_stats = cursor.fetchall()
        # 사용자별 (회사 · 이메일) — 주문서인식: (companyid, created_at) 인덱스 / 업무비서: usage_month 인덱스
        cursor.execute(
            """SELECT a.companyid, MAX(a.companyname), LOWER(a.useremail), MAX(a.useremail), MAX(a.username),
                      COUNT(*) FILTER (WHERE a.status = 'succeeded'), COUNT(*) FILTER (WHERE a.status <> 'succeeded'),
                      COALESCE(SUM(a.estimated_cost_usd), 0),
                      COUNT(*) FILTER (WHERE a.status = 'succeeded' AND a.created_at >= %s),
                      COALESCE(SUM(a.estimated_cost_usd) FILTER (WHERE a.created_at >= %s), 0)
               FROM aiorderanalysis01t a
               WHERE a.created_at >= %s AND a.created_at < %s AND (%s::varchar IS NULL OR a.companyid = %s)
               GROUP BY a.companyid, LOWER(a.useremail)""",
            (month_start, month_start, start, end, companyid, companyid),
        )
        user_order = cursor.fetchall()
        user_chat = []
        if has_chat:
            cursor.execute(
                """SELECT companyid, MAX(companyname), LOWER(user_email), MAX(user_email), MAX(NULLIF(username, '')),
                          COUNT(*) FILTER (WHERE status = 'complete'), COUNT(*) FILTER (WHERE status = 'failed'),
                          COALESCE(SUM(estimated_cost_usd), 0),
                          COUNT(*) FILTER (WHERE status = 'complete' AND usage_month = %s),
                          COALESCE(SUM(estimated_cost_usd) FILTER (WHERE usage_month = %s), 0)
                   FROM aichatusage01t
                   WHERE usage_month >= %s AND usage_month < %s AND (%s::varchar IS NULL OR companyid = %s)
                   GROUP BY companyid, LOWER(user_email)""",
                (current, current, first, _add_months(last, 1), companyid, companyid),
            )
            user_chat = cursor.fetchall()
        # 지금 직원 이름 · 부서 · 직급 (회사 · 이메일로 한 번에)
        keys = sorted({(r[0], r[2]) for r in user_order} | {(r[0], r[2]) for r in user_chat})
        people = {}
        if keys:
            cursor.execute(
                """SELECT u.companyid, LOWER(u.email), u.username, COALESCE(u.team, ''), COALESCE(u.position, ''), UPPER(COALESCE(u.useyn, 'N'))
                   FROM user01t u
                   JOIN UNNEST(%s::varchar[], %s::varchar[]) AS k(cid, mail) ON u.companyid = k.cid AND LOWER(u.email) = k.mail""",
                ([k[0] for k in keys], [k[1] for k in keys]),
            )
            people = {(r[0], r[1]): {"username": r[2], "team": r[3], "position": r[4], "active": r[5] == "Y"} for r in cursor.fetchall()}

    span = len(months)
    rows = {}

    def company_row(cid, name=None):
        info = companies.get(cid) or {"companyid": cid, "companyname": name or cid, "company_status": None, "monthly_limit": None}
        return rows.setdefault(cid, {**info, "costs": [0.0] * span, "order_costs": [0.0] * span, "chat_costs": [0.0] * span,
                                     "calls": [0] * span, "failed": [0] * span, "chat_calls": [0] * span, "chat_failed": [0] * span,
                                     "input_tokens": 0, "output_tokens": 0})

    for cid, name, m, ok, failed, tin, tout, cost in stats:
        if m not in index_of:
            continue
        row = company_row(cid, name)
        i = index_of[m]
        row["costs"][i] += float(cost)
        row["order_costs"][i] += float(cost)
        row["calls"][i] += int(ok)
        row["failed"][i] += int(failed)
        row["input_tokens"] += int(tin)
        row["output_tokens"] += int(tout)
    for cid, name, m, ok, failed, tin, tout, cost in chat_stats:
        if m not in index_of:
            continue
        row = company_row(cid, name)
        i = index_of[m]
        row["costs"][i] += float(cost)
        row["chat_costs"][i] += float(cost)
        row["chat_calls"][i] += int(ok)
        row["chat_failed"][i] += int(failed)
        row["input_tokens"] += int(tin)
        row["output_tokens"] += int(tout)
    # 한도를 정한 고객사는 사용이 없어도 보인다
    for cid, info in companies.items():
        if cid not in rows and info["monthly_limit"] is not None:
            company_row(cid)

    base_month = current if first <= current <= last else last
    base = index_of[base_month]
    out = []
    for row in rows.values():
        row["total_cost"] = sum(row["costs"])
        row["total_calls"] = sum(row["calls"])
        row["total_failed"] = sum(row["failed"])
        row["total_order_cost"] = sum(row["order_costs"])
        row["total_chat_cost"] = sum(row["chat_costs"])
        row["total_chat_calls"] = sum(row["chat_calls"])
        row["total_chat_failed"] = sum(row["chat_failed"])
        row["cost_now"] = row["costs"][base]
        row["calls_now"] = row["calls"][base]
        row["used_month"] = int(used_now.get(row["companyid"], 0))
        out.append(row)
    out.sort(key=lambda r: (-r["cost_now"], -r["total_cost"], r["companyid"]))

    # 사용자별: (회사, 이메일) 로 주문서인식 · 업무비서를 합친다
    users = {}
    for kind, source in (("order", user_order), ("chat", user_chat)):
        for cid, cname, key, mail, uname, ok, failed, cost, ok_now, cost_now in source:
            row = users.get((cid, key))
            if row is None:
                person = people.get((cid, key)) or {}
                row = users[(cid, key)] = {
                    "companyid": cid, "companyname": (companies.get(cid) or {}).get("companyname") or cname or cid,
                    "email": mail, "username": person.get("username") or uname or "", "team": person.get("team", ""),
                    "position": person.get("position", ""), "active": person.get("active", False),
                    "order_calls": 0, "order_failed": 0, "order_cost": 0.0, "chat_calls": 0, "chat_failed": 0, "chat_cost": 0.0,
                    "calls_now": 0, "cost_now": 0.0,
                }
            row[f"{kind}_calls"] += int(ok)
            row[f"{kind}_failed"] += int(failed)
            row[f"{kind}_cost"] += float(cost)
            row["calls_now"] += int(ok_now)
            row["cost_now"] += float(cost_now)
    user_rows = list(users.values())
    for row in user_rows:
        row["total_cost"] = row["order_cost"] + row["chat_cost"]
    user_rows.sort(key=lambda r: (-r["total_cost"], -(r["order_calls"] + r["chat_calls"]), r["companyid"], r["email"]))

    trend = []
    for i, m in enumerate(months):
        trend.append({
            "month": m.strftime("%Y-%m"), "current": m == current,
            "cost": sum(r["costs"][i] for r in out), "calls": sum(r["calls"][i] for r in out),
            "failed": sum(r["failed"][i] for r in out),
            "order_cost": sum(r["order_costs"][i] for r in out), "chat_cost": sum(r["chat_costs"][i] for r in out),
            "chat_calls": sum(r["chat_calls"][i] for r in out), "chat_failed": sum(r["chat_failed"][i] for r in out),
            "companies": sum(1 for r in out if r["calls"][i] or r["failed"][i] or r["chat_calls"][i] or r["chat_failed"][i]),
        })
    calls_base = trend[base]["calls"]
    return {
        "month_from": first.strftime("%Y-%m"), "month_to": last.strftime("%Y-%m"), "months": [t["month"] for t in trend],
        "current_month": current.strftime("%Y-%m"), "base_month": base_month.strftime("%Y-%m"), "krw_rate": DEFAULT_KRW_RATE,
        "summary": {
            "cost_now": trend[base]["cost"], "calls_now": calls_base, "companies_now": trend[base]["companies"],
            # 건당 비용 = 주문서인식 비용 ÷ 주문서인식 성공 건수 (업무비서 비용은 빼고 계산)
            "cost_per_call": trend[base]["order_cost"] / calls_base if calls_base else None,
            "order_cost_now": trend[base]["order_cost"], "chat_cost_now": trend[base]["chat_cost"], "chat_calls_now": trend[base]["chat_calls"],
            "period_cost": sum(t["cost"] for t in trend[:base + 1]), "period_calls": sum(t["calls"] for t in trend[:base + 1]),
            "prev_cost": trend[base - 1]["cost"] if base > 0 else None,
        },
        "trend": trend,
        "companies": out,
        "users": user_rows,
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


QUESTION_PAGE_SIZE = 30


def user_questions(companyid: str, email: str, date_from: date, date_to: date, page: int = 1) -> dict:
    """사용자별 AI 업무비서 질문 기록 (최근 순 · 30건씩). 답변은 저장하지 않으므로 질문 · 결과 · 쓴 조회 기능만."""
    start = datetime(date_from.year, date_from.month, date_from.day, tzinfo=KST)
    end_day = date.fromordinal(date_to.toordinal() + 1)
    end = datetime(end_day.year, end_day.month, end_day.day, tzinfo=KST)
    page = max(1, int(page or 1))
    with _shared_db.connect() as connection, connection.cursor() as cursor:
        cursor.execute("SELECT to_regclass('aichatusage01t') IS NOT NULL")
        if not cursor.fetchone()[0]:
            return {"items": [], "total": 0, "page": 1, "page_size": QUESTION_PAGE_SIZE}
        where = "companyid = %s AND lower(user_email) = lower(%s) AND createdat >= %s AND createdat < %s"
        params = (companyid, email, start, end)
        cursor.execute(f"SELECT COUNT(*) FROM aichatusage01t WHERE {where}", params)
        total = int(cursor.fetchone()[0] or 0)
        cursor.execute(
            f"""SELECT request_id, createdat, question, status, tool_names, error_type, api_calls, estimated_cost_usd
                  FROM aichatusage01t WHERE {where}
                 ORDER BY createdat DESC LIMIT %s OFFSET %s""",
            (*params, QUESTION_PAGE_SIZE, (page - 1) * QUESTION_PAGE_SIZE),
        )
        rows = cursor.fetchall()
    from services.ai.AIChatTools import TOOLS_BY_NAME   # 조회 기능 이름 → 화면 이름 (예: outbound_summary → 매출현황)
    labels = {name: tool["label"] for name, tool in TOOLS_BY_NAME.items()}
    items = [{"request_id": r[0], "asked_at": r[1].astimezone(KST).strftime("%Y-%m-%d %H:%M"), "question": r[2] or "",
              "status": r[3], "tools": list(dict.fromkeys(labels.get(t, t) for t in (r[4] or "").split(",") if t)), "error_type": r[5],
              "api_calls": r[6], "cost": float(r[7] or 0)} for r in rows]
    return {"items": items, "total": total, "page": page, "page_size": QUESTION_PAGE_SIZE}
