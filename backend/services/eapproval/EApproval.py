"""전자결재 (메뉴: 전자결재 EAPPROVAL · 결재양식관리 EAPPROVAL_FORM).

양식 3종(휴가신청서 · 출장신청서 · 업무보고서)을 작성 → (임시저장) → 신청하면 양식별 기본 결재선(고정)을 문서에 복사하고
1차 → 2차 … 순서로 승인한다. 한 단계라도 반려하면 끝, 아무도 결재하기 전에는 신청자가 회수(임시저장으로 되돌림)할 수 있다.
연차 발생 일수는 관리자가 직원별 · 연도별로 입력하고, 사용 · 결재중 · 잔여는 휴가 문서로 계산한다.

  eappr_form01t  양식 사용 여부 · 순서          eappr_line01t  양식별 기본 결재선
  eappr_doc01t   결재 문서 (내용은 content)      eappr_step01t  문서별 결재선 기록 (승인 · 반려 · 의견)
  eappr_leave01t 연차 발생 일수                  eappr_leavetime01t 반차 · 반반차 시간대 (회사별)
기존 매입 · 매출 · 재고 · 통제 로직과 무관하다.
"""
import json
from datetime import date, datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

import db as _db
from services.eapproval import CustomForm as custom_form

KST = ZoneInfo("Asia/Seoul")
MENU_DOC = "EAPPROVAL"
MENU_FORM = "EAPPROVAL_FORM"

FORMS = [("LEAVE", "휴가신청서", 1), ("TRIP", "출장신청서", 2), ("REPORT", "업무보고서", 3)]
FORM_NAME = {code: name for code, name, _ in FORMS}   # 기본 양식 (입력칸 · 검사를 코드가 정함). 그 밖의 formcode(C001 …)는 추가 양식
PLATFORM_COMPANY = "001"   # HTML 서식은 모스코 회사만
STATUS_LABEL = {"DRAFT": "임시저장", "PENDING": "결재중", "APPROVED": "완료", "REJECTED": "반려"}
STEP_LABEL = {"WAIT": "대기", "APPROVED": "승인", "REJECTED": "반려"}

# 휴가 종류: 연차 · 반차 · 반반차만 연차에서 뺀다
LEAVE_KINDS = {"ANNUAL": "연차휴가", "HALF_AM": "오전반차", "HALF_PM": "오후반차", "QUARTER": "반반차", "FAMILY": "경조휴가",
               "SICK": "병가", "OFFICIAL": "공가", "OTHER": "기타휴가"}
DEDUCT_KINDS = ("ANNUAL", "HALF_AM", "HALF_PM", "QUARTER")
PART_DAYS = {"HALF_AM": Decimal("0.5"), "HALF_PM": Decimal("0.5"), "QUARTER": Decimal("0.25")}   # 하루 안에서 시간으로 쓰는 휴가
# 시간대 기본값 (회사가 결재양식관리에서 바꾸기 전): 오전반차 · 오후반차 1개, 반반차는 고를 수 있는 여러 시간대
TIME_KINDS = ("HALF_AM", "HALF_PM", "QUARTER")
DEFAULT_TIMES = {"HALF_AM": [("09:00", "14:00")], "HALF_PM": [("14:00", "18:00")],
                 "QUARTER": [("09:00", "11:00"), ("11:00", "14:00"), ("14:00", "16:00"), ("16:00", "18:00")]}
REPORT_TYPES = {"DAILY": "일일", "WEEKLY": "주간", "MONTHLY": "월간"}


def _today() -> date:
    return datetime.now(KST).date()


def _rows(cursor):
    cols = [c[0] for c in cursor.description]
    return [dict(zip(cols, row)) for row in cursor.fetchall()]


def _has(user: dict, menuid: str) -> bool:
    return (user.get("companyid") == "001" and user.get("authority") == "MASTER") or menuid in (user.get("menuids") or ())


def _require(user: dict, menuid: str, what: str):
    if not _has(user, menuid):
        raise PermissionError(f"{what} 권한이 없습니다.")


def _ensure_forms(cursor, companyid: str):
    """회사에 양식 행이 없으면 기본 3종을 만든다 (처음 쓸 때 한 번)."""
    for code, name, order in FORMS:
        cursor.execute(
            """INSERT INTO eappr_form01t (companyid, companyname, formcode, formname, sort_order)
               VALUES (%s, (SELECT companyname FROM company01t WHERE companyid = %s), %s, %s, %s)
               ON CONFLICT (companyid, formcode) DO NOTHING""",
            (companyid, companyid, code, name, order),
        )


def _form_def(cursor, companyid: str, formcode: str) -> dict | None:
    """양식 한 개: 이름 · 사용 여부 · (추가 양식) 입력칸 · HTML 서식."""
    cursor.execute("SELECT formname, useyn, fields, template FROM eappr_form01t WHERE companyid = %s AND formcode = %s", (companyid, formcode))
    row = cursor.fetchone()
    if not row:
        return None
    return {"formcode": formcode, "formname": row[0], "useyn": row[1], "fields": row[2] or [], "template": row[3] or "",
            "custom": formcode not in FORM_NAME}


def _prepare(cursor, companyid: str, formcode: str, content: dict, strict: bool) -> tuple[dict, str, str]:
    """작성 내용 정리 → (저장할 content, 제목, 양식 이름). 추가 양식은 그 시점 입력칸 · 서식을 문서에 같이 담는다."""
    if formcode in FORM_NAME:
        normalized, title = _normalize(formcode, content, strict)
        return normalized, title, FORM_NAME[formcode]
    form = _form_def(cursor, companyid, formcode)
    if not form:
        raise ValueError("양식을 선택해 주세요.")
    values = custom_form.normalize_values(form["fields"], (content or {}).get("values"), strict)
    snapshot = {"name": form["formname"], "fields": form["fields"], "template": form["template"]}
    return {"values": values, "_form": snapshot}, custom_form.title_of(form["fields"], values, form["formname"]), form["formname"]


def _user_names(cursor, companyid: str) -> dict:
    cursor.execute("SELECT email, username, team, position, UPPER(COALESCE(useyn, 'N')) FROM user01t WHERE companyid = %s", (companyid,))
    return {email: {"name": name or email, "team": team or "", "position": position or "", "active": useyn == "Y"}
            for email, name, team, position, useyn in cursor.fetchall()}


def _form_lines(cursor, companyid: str) -> dict:
    cursor.execute("SELECT formcode, step, approver FROM eappr_line01t WHERE companyid = %s ORDER BY formcode, step", (companyid,))
    lines = {}
    for code, step, approver in cursor.fetchall():
        lines.setdefault(code, []).append(approver)
    return lines


# ── 휴가 · 연차 ─────────────────────────────────────────────────────
def _weekdays(start: date, end: date) -> int:
    days, current = 0, start
    while current <= end:
        if current.weekday() < 5:
            days += 1
        current += timedelta(days=1)
    return days


def leave_days(kind: str, start: date, end: date) -> Decimal:
    """신청일수: 반차 0.5일 · 반반차 0.25일 (하루만, 평일), 그 밖은 기간 안의 평일 수 (공휴일 달력이 없어 주말만 뺀다)."""
    if kind in PART_DAYS:
        return PART_DAYS[kind] if start.weekday() < 5 else Decimal(0)
    return Decimal(_weekdays(start, end))


def _hhmm(value, label: str) -> str:
    text = str(value or "").strip()
    try:
        hour, minute = (int(x) for x in text.split(":"))
        if not (0 <= hour <= 23 and 0 <= minute <= 59):
            raise ValueError
    except ValueError as error:
        raise ValueError(f"{label} 시간을 확인해 주세요 (예: 09:00).") from error
    return f"{hour:02d}:{minute:02d}"


def leave_times(cursor, companyid: str) -> dict:
    """회사 시간대: {HALF_AM: [{from, to}], HALF_PM: [...], QUARTER: [...]} — 정하지 않은 종류는 기본값."""
    cursor.execute("SELECT kind, time_from, time_to FROM eappr_leavetime01t WHERE companyid = %s ORDER BY kind, slotno", (companyid,))
    saved = {}
    for kind, start, end in cursor.fetchall():
        saved.setdefault(kind, []).append({"from": start, "to": end})
    return {kind: saved.get(kind) or [{"from": a, "to": b} for a, b in DEFAULT_TIMES[kind]] for kind in TIME_KINDS}


def _leave_usage(cursor, companyid: str, email: str, year: int, exclude_docno: str | None = None) -> tuple[Decimal, Decimal]:
    """(사용 = 완료된 연차 · 반차, 결재중 = 대기 중인 연차 · 반차) — 시작일이 그 해인 문서."""
    cursor.execute(
        """SELECT COALESCE(SUM((content->>'days')::numeric) FILTER (WHERE status = 'APPROVED'), 0),
                  COALESCE(SUM((content->>'days')::numeric) FILTER (WHERE status = 'PENDING'), 0)
           FROM eappr_doc01t
           WHERE companyid = %s AND created_by = %s AND formcode = 'LEAVE' AND status IN ('APPROVED', 'PENDING')
             AND content->>'kind' = ANY(%s) AND LEFT(content->>'date_from', 4) = %s
             AND docno IS DISTINCT FROM %s""",
        (companyid, email, list(DEDUCT_KINDS), str(year), exclude_docno),
    )
    used, pending = cursor.fetchone()
    return Decimal(used or 0), Decimal(pending or 0)


def leave_status(user: dict, year: int | None = None, email: str | None = None) -> dict:
    """연차 현황: 발생 · 사용 · 결재중 · 잔여 · 초과사용."""
    companyid = user["companyid"]
    email = email or user.get("email")
    year = year or _today().year
    with _db.connect() as connection, connection.cursor() as cursor:
        cursor.execute("SELECT granted_days FROM eappr_leave01t WHERE companyid = %s AND useremail = %s AND leaveyear = %s",
                       (companyid, email, year))
        row = cursor.fetchone()
        granted = Decimal(row[0]) if row else Decimal(0)
        used, pending = _leave_usage(cursor, companyid, email, year)
    remain = granted - used - pending
    return {"year": year, "granted": float(granted), "used": float(used), "pending": float(pending),
            "remain": float(max(remain, Decimal(0))), "over": float(max(-remain, Decimal(0))), "registered": row is not None}


def my_leave(user: dict, year: int | None = None) -> dict:
    """내 휴가현황: 결재가 끝난(승인) 휴가만. 연도별 발생 · 사용 · 잔여 + 선택한 해의 승인된 휴가 내역.
    연차 차감은 연차 · 반차 · 반반차만, 휴가가 속한 해는 시작일 기준 (연차 현황과 같은 규칙)."""
    _require(user, MENU_DOC, "전자결재")
    companyid, email = user["companyid"], user.get("email")
    today = _today()
    year = int(year or today.year)
    with _db.connect() as connection, connection.cursor() as cursor:
        cursor.execute("SELECT leaveyear, granted_days FROM eappr_leave01t WHERE companyid = %s AND useremail = %s", (companyid, email))
        granted = {int(y): Decimal(g) for y, g in cursor.fetchall()}
        cursor.execute(
            """SELECT docno, content, completed_at FROM eappr_doc01t
               WHERE companyid = %s AND created_by = %s AND formcode = 'LEAVE' AND status = 'APPROVED'
               ORDER BY content->>'date_from' DESC, docno DESC""",
            (companyid, email),
        )
        docs = _rows(cursor)
    used = {}   # 연도 → 연차에서 뺀 일수
    items = []
    for d in docs:
        c = d["content"] or {}
        try:
            start = date.fromisoformat(str(c.get("date_from"))[:10])
        except ValueError:
            continue
        days = Decimal(str(c.get("days") or 0))
        deduct = c.get("kind") in DEDUCT_KINDS
        if deduct:
            used[start.year] = used.get(start.year, Decimal(0)) + days
        if start.year == year:
            items.append({"docno": d["docno"], "kind": c.get("kind"), "kind_label": LEAVE_KINDS.get(c.get("kind"), c.get("kind")),
                          "date_from": c.get("date_from"), "date_to": c.get("date_to"), "time_from": c.get("time_from"), "time_to": c.get("time_to"),
                          "days": float(days), "deduct": deduct, "reason": c.get("reason") or "", "approved_at": d["completed_at"]})
    years = sorted(set(granted) | set(used) | {today.year, year}, reverse=True)
    rows = []
    for y in years:
        g = granted.get(y)
        u = used.get(y, Decimal(0))
        base = g if g is not None else Decimal(0)
        rows.append({"year": y, "registered": g is not None, "granted": float(base), "used": float(u), "remain": float(base - u)})
    return {"year": year, "today": today.isoformat(), "years": rows, "current": next(r for r in rows if r["year"] == year), "items": items}


# ── 양식 내용 검사 ─────────────────────────────────────────────────
def _date(value, label: str) -> date:
    try:
        return date.fromisoformat(str(value or "")[:10])
    except ValueError as error:
        raise ValueError(f"{label}을(를) 입력해 주세요.") from error


def _text(content: dict, key: str, label: str, required: bool = True, limit: int = 2000) -> str:
    text = str(content.get(key) or "").strip()
    if required and not text:
        raise ValueError(f"{label}을(를) 입력해 주세요.")
    return text[:limit]


def _normalize(formcode: str, content: dict, strict: bool) -> tuple[dict, str]:
    """양식 내용 정리 + 제목. strict=False(임시저장)는 빈칸을 허용한다."""
    content = dict(content or {})
    if formcode == "LEAVE":
        kind = str(content.get("kind") or "ANNUAL").upper()
        if kind not in LEAVE_KINDS:
            raise ValueError("휴가 종류를 선택해 주세요.")
        out = {"kind": kind, "reason": _text(content, "reason", "신청사유", strict)}
        if content.get("date_from") or strict:
            start = _date(content.get("date_from"), "시작일")
            end = _date(content.get("date_to") or content.get("date_from"), "종료일")
            if kind in PART_DAYS:
                end = start
            if end < start:
                raise ValueError("종료일이 시작일보다 빠릅니다.")
            days = leave_days(kind, start, end)
            if strict and days <= 0:
                raise ValueError("신청일이 주말입니다." if kind in PART_DAYS else "신청 기간에 평일이 없습니다.")
            out.update({"date_from": start.isoformat(), "date_to": end.isoformat(), "days": str(days)})
            if kind in PART_DAYS and (content.get("time_from") or strict):
                out["time_from"] = _hhmm(content.get("time_from"), "시작")
                out["time_to"] = _hhmm(content.get("time_to"), "종료")
        # 제목: 무엇인지만 (기간 · 일수 · 시간은 상세에)
        return out, LEAVE_KINDS[kind]
    if formcode == "TRIP":
        out = {"title": _text(content, "title", "제목", strict, 100),
               "destination": _text(content, "destination", "출장지", strict, 200), "purpose": _text(content, "purpose", "출장목적", strict),
               "companions": _text(content, "companions", "동행자", False, 200), "memo": _text(content, "memo", "비고", False)}
        cost = str(content.get("cost") or "").replace(",", "").strip()
        out["cost"] = str(Decimal(cost)) if cost else ""
        if content.get("date_from") or strict:
            start = _date(content.get("date_from"), "출장 시작일")
            end = _date(content.get("date_to") or content.get("date_from"), "출장 종료일")
            if end < start:
                raise ValueError("출장 종료일이 시작일보다 빠릅니다.")
            out.update({"date_from": start.isoformat(), "date_to": end.isoformat(), "days": str((end - start).days + 1)})
        # 제목: 작성자가 쓴 제목 그대로 (비어 있는 임시저장만 '출장지 출장')
        return out, out["title"] or (f"{out['destination']} 출장" if out["destination"] else "출장")
    if formcode == "REPORT":
        rtype = str(content.get("report_type") or "WEEKLY").upper()
        if rtype not in REPORT_TYPES:
            raise ValueError("보고 구분을 선택해 주세요.")
        out = {"title": _text(content, "title", "제목", strict, 100),
               "report_type": rtype, "done": _text(content, "done", "업무 실적", strict, 4000), "plan": _text(content, "plan", "업무 계획", False, 4000),
               "issue": _text(content, "issue", "이슈 · 건의", False, 2000)}
        if content.get("date_from") or strict:
            start = _date(content.get("date_from"), "보고 기간")
            end = _date(content.get("date_to") or content.get("date_from"), "보고 기간")
            if end < start:
                raise ValueError("보고 기간 종료일이 시작일보다 빠릅니다.")
            out.update({"date_from": start.isoformat(), "date_to": end.isoformat()})
        return out, out["title"] or f"{REPORT_TYPES[rtype]} 업무보고"
    raise ValueError("양식을 선택해 주세요.")


def _next_docno(cursor, companyid: str) -> str:
    cursor.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"eappr-doc:{companyid}",))
    prefix = f"EA-{_today():%Y}-"
    cursor.execute(
        """SELECT COALESCE(MAX(CAST(SUBSTRING(docno FROM %s) AS integer)), 0) FROM eappr_doc01t
           WHERE companyid = %s AND createdat >= make_timestamptz(%s, 1, 1, 0, 0, 0, 'Asia/Seoul') - INTERVAL '1 day'
             AND LEFT(docno, %s) = %s AND SUBSTRING(docno FROM %s) ~ '^[0-9]+$'""",
        (len(prefix) + 1, companyid, _today().year, len(prefix), prefix, len(prefix) + 1),
    )
    return f"{prefix}{cursor.fetchone()[0] + 1:05d}"


# ── 작성 · 임시저장 · 신청 ──────────────────────────────────────────
def _lock_own_draft(cursor, companyid: str, docno: str, email: str) -> dict:
    cursor.execute("SELECT formcode, status, created_by FROM eappr_doc01t WHERE companyid = %s AND docno = %s FOR UPDATE", (companyid, docno))
    row = cursor.fetchone()
    if not row:
        raise LookupError("문서를 찾을 수 없습니다.")
    if row[2] != email:
        raise PermissionError("본인이 작성한 문서만 고칠 수 있습니다.")
    if row[1] != "DRAFT":
        raise ValueError("임시저장 상태의 문서만 고칠 수 있습니다.")
    return {"formcode": row[0]}


def save_draft(user: dict, formcode: str, content: dict, docno: str | None = None) -> dict:
    _require(user, MENU_DOC, "전자결재")
    companyid, email = user["companyid"], user.get("email")
    formcode = str(formcode or "").upper()
    with _db.connect() as connection, connection.cursor() as cursor:
        normalized, title, _name = _prepare(cursor, companyid, formcode, content, strict=False)
        if docno:
            _lock_own_draft(cursor, companyid, docno, email)
            cursor.execute(
                """UPDATE eappr_doc01t SET formcode = %s, title = %s, content = %s::jsonb, updatedat = CURRENT_TIMESTAMP, updated_by = %s
                   WHERE companyid = %s AND docno = %s""",
                (formcode, title, json.dumps(normalized, ensure_ascii=False), email, companyid, docno),
            )
        else:
            docno = _next_docno(cursor, companyid)
            cursor.execute(
                """INSERT INTO eappr_doc01t (companyid, companyname, docno, formcode, title, status, content, created_by)
                   VALUES (%s, (SELECT companyname FROM company01t WHERE companyid = %s), %s, %s, %s, 'DRAFT', %s::jsonb, %s)""",
                (companyid, companyid, docno, formcode, title, json.dumps(normalized, ensure_ascii=False), email),
            )
    return {"success": True, "docno": docno}


def submit(user: dict, formcode: str, content: dict, docno: str | None = None) -> dict:
    """신청: 내용 검사 → 양식의 기본 결재선(고정)을 문서에 복사 (신청자 본인 단계는 빼고) → 1차 결재 대기."""
    _require(user, MENU_DOC, "전자결재")
    companyid, email = user["companyid"], user.get("email")
    formcode = str(formcode or "").upper()
    content = dict(content or {})
    kind = str(content.get("kind") or "").upper()
    if formcode == "LEAVE" and kind in ("HALF_AM", "HALF_PM") and not content.get("time_from"):
        # 반차는 시간대가 하나뿐이라 비어 있으면 회사 시간대로 채운다
        with _db.connect() as connection, connection.cursor() as cursor:
            slot = leave_times(cursor, companyid)[kind][0]
        content.update({"time_from": slot["from"], "time_to": slot["to"]})
    with _db.connect() as connection, connection.cursor() as cursor:
        _ensure_forms(cursor, companyid)
        normalized, title, formname = _prepare(cursor, companyid, formcode, content, strict=True)
        cursor.execute("SELECT useyn FROM eappr_form01t WHERE companyid = %s AND formcode = %s", (companyid, formcode))
        row = cursor.fetchone()
        if not row or row[0] != "Y":
            raise ValueError(f"{formname}는 지금 사용하지 않는 양식입니다.")
        line = _form_lines(cursor, companyid).get(formcode) or []
        if not line:
            raise ValueError(f"{formname}의 결재선이 없습니다. 결재양식관리에서 결재선을 먼저 정해 주세요.")
        names = _user_names(cursor, companyid)
        inactive = [names.get(a, {}).get("name", a) for a in line if not names.get(a, {}).get("active")]
        if inactive:
            raise ValueError(f"결재선의 {', '.join(inactive)}이(가) 사용할 수 없는 계정입니다. 결재양식관리에서 결재선을 고쳐 주세요.")
        if formcode == "LEAVE":
            kind = normalized["kind"]
            if kind in PART_DAYS:
                slots = leave_times(cursor, companyid)[kind]
                if not any(s["from"] == normalized["time_from"] and s["to"] == normalized["time_to"] for s in slots):
                    raise ValueError(f"{LEAVE_KINDS[kind]} 시간이 회사에서 정한 시간대와 다릅니다. 시간을 다시 선택해 주세요.")
            # 같은 기간에 이미 신청한(결재중 · 완료) 휴가가 있으면 막는다 — 같은 날 시간 휴가끼리는 시간이 겹칠 때만
            cursor.execute(
                """SELECT docno, content->>'kind', content->>'time_from', content->>'time_to' FROM eappr_doc01t
                   WHERE companyid = %s AND created_by = %s AND formcode = 'LEAVE' AND status IN ('PENDING', 'APPROVED')
                     AND docno IS DISTINCT FROM %s
                     AND (content->>'date_from')::date <= %s::date AND (content->>'date_to')::date >= %s::date""",
                (companyid, email, docno, normalized["date_to"], normalized["date_from"]),
            )
            for other, other_kind, other_from, other_to in cursor.fetchall():
                both_timed = kind in PART_DAYS and other_kind in PART_DAYS and other_from and other_to
                if not both_timed or (normalized["time_from"] < other_to and other_from < normalized["time_to"]):
                    raise ValueError(f"같은 기간에 이미 신청한 휴가({other})가 있습니다.")
        if docno:
            _lock_own_draft(cursor, companyid, docno, email)
            cursor.execute(
                """UPDATE eappr_doc01t SET formcode = %s, title = %s, content = %s::jsonb, updatedat = CURRENT_TIMESTAMP, updated_by = %s
                   WHERE companyid = %s AND docno = %s""",
                (formcode, title, json.dumps(normalized, ensure_ascii=False), email, companyid, docno),
            )
        else:
            docno = _next_docno(cursor, companyid)
            cursor.execute(
                """INSERT INTO eappr_doc01t (companyid, companyname, docno, formcode, title, status, content, created_by)
                   VALUES (%s, (SELECT companyname FROM company01t WHERE companyid = %s), %s, %s, %s, 'DRAFT', %s::jsonb, %s)""",
                (companyid, companyid, docno, formcode, title, json.dumps(normalized, ensure_ascii=False), email),
            )
        cursor.execute("DELETE FROM eappr_step01t WHERE companyid = %s AND docno = %s", (companyid, docno))
        current = None
        # 신청자가 결재선에 있으면 그 단계는 빼고 나머지를 순서대로 당긴다 (본인 문서를 본인이 결재하지 않음).
        # 결재선이 본인뿐이면 본인 단계를 자동 승인으로 남기고 바로 완료한다.
        others = [a for a in line if a != email]
        for step, approver in enumerate(others or line[:1], start=1):
            own = approver == email
            cursor.execute(
                """INSERT INTO eappr_step01t (companyid, companyname, docno, step, approver, status, acted_at, comment, created_by)
                   VALUES (%s, (SELECT companyname FROM company01t WHERE companyid = %s), %s, %s, %s, %s, %s, %s, %s)""",
                (companyid, companyid, docno, step, approver, "APPROVED" if own else "WAIT",
                 datetime.now(KST) if own else None, "신청자 본인 단계" if own else None, email),
            )
            if not own and current is None:
                current = step
        cursor.execute(
            """UPDATE eappr_doc01t SET status = %s, current_step = %s, submitted_at = CURRENT_TIMESTAMP,
                      completed_at = CASE WHEN %s IS NULL THEN CURRENT_TIMESTAMP END, updatedat = CURRENT_TIMESTAMP, updated_by = %s
               WHERE companyid = %s AND docno = %s""",
            ("PENDING" if current else "APPROVED", current, current, email, companyid, docno),
        )
    return {"success": True, "docno": docno, "status": "PENDING" if current else "APPROVED"}


def delete_draft(user: dict, docno: str) -> dict:
    _require(user, MENU_DOC, "전자결재")
    with _db.connect() as connection, connection.cursor() as cursor:
        _lock_own_draft(cursor, user["companyid"], docno, user.get("email"))
        cursor.execute("DELETE FROM eappr_step01t WHERE companyid = %s AND docno = %s", (user["companyid"], docno))
        cursor.execute("DELETE FROM eappr_doc01t WHERE companyid = %s AND docno = %s", (user["companyid"], docno))
    return {"success": True}


# ── 결재 · 반려 · 회수 ──────────────────────────────────────────────
def _lock_doc(cursor, companyid: str, docno: str):
    cursor.execute("SELECT status, current_step, created_by FROM eappr_doc01t WHERE companyid = %s AND docno = %s FOR UPDATE", (companyid, docno))
    row = cursor.fetchone()
    if not row:
        raise LookupError("문서를 찾을 수 없습니다.")
    return row


def approve(user: dict, docno: str, comment: str = "") -> dict:
    companyid, email = user["companyid"], user.get("email")
    with _db.connect() as connection, connection.cursor() as cursor:
        status, step, _writer = _lock_doc(cursor, companyid, docno)
        if status != "PENDING":
            raise ValueError(f"이미 {STATUS_LABEL.get(status, status)} 처리된 문서입니다.")
        cursor.execute("SELECT approver FROM eappr_step01t WHERE companyid = %s AND docno = %s AND step = %s", (companyid, docno, step))
        row = cursor.fetchone()
        if not row or row[0] != email:
            raise PermissionError("지금 결재할 차례가 아닙니다.")
        cursor.execute(
            """UPDATE eappr_step01t SET status = 'APPROVED', acted_at = CURRENT_TIMESTAMP, comment = %s, updatedat = CURRENT_TIMESTAMP, updated_by = %s
               WHERE companyid = %s AND docno = %s AND step = %s""",
            ((comment or "").strip()[:500] or None, email, companyid, docno, step),
        )
        cursor.execute("SELECT MIN(step) FROM eappr_step01t WHERE companyid = %s AND docno = %s AND status = 'WAIT'", (companyid, docno))
        nxt = cursor.fetchone()[0]
        cursor.execute(
            """UPDATE eappr_doc01t SET status = %s, current_step = %s, completed_at = CASE WHEN %s IS NULL THEN CURRENT_TIMESTAMP END,
                      updatedat = CURRENT_TIMESTAMP, updated_by = %s
               WHERE companyid = %s AND docno = %s""",
            ("PENDING" if nxt else "APPROVED", nxt, nxt, email, companyid, docno),
        )
    return {"success": True, "status": "PENDING" if nxt else "APPROVED"}


def reject(user: dict, docno: str, comment: str) -> dict:
    companyid, email = user["companyid"], user.get("email")
    comment = (comment or "").strip()
    if not comment:
        raise ValueError("반려 사유를 입력해 주세요.")
    with _db.connect() as connection, connection.cursor() as cursor:
        status, step, _writer = _lock_doc(cursor, companyid, docno)
        if status != "PENDING":
            raise ValueError(f"이미 {STATUS_LABEL.get(status, status)} 처리된 문서입니다.")
        cursor.execute("SELECT approver FROM eappr_step01t WHERE companyid = %s AND docno = %s AND step = %s", (companyid, docno, step))
        row = cursor.fetchone()
        if not row or row[0] != email:
            raise PermissionError("지금 결재할 차례가 아닙니다.")
        cursor.execute(
            """UPDATE eappr_step01t SET status = 'REJECTED', acted_at = CURRENT_TIMESTAMP, comment = %s, updatedat = CURRENT_TIMESTAMP, updated_by = %s
               WHERE companyid = %s AND docno = %s AND step = %s""",
            (comment[:500], email, companyid, docno, step),
        )
        cursor.execute(
            """UPDATE eappr_doc01t SET status = 'REJECTED', current_step = NULL, completed_at = CURRENT_TIMESTAMP,
                      updatedat = CURRENT_TIMESTAMP, updated_by = %s
               WHERE companyid = %s AND docno = %s""",
            (email, companyid, docno),
        )
    return {"success": True, "status": "REJECTED"}


def withdraw(user: dict, docno: str) -> dict:
    """회수: 아직 아무도(신청자 본인 단계 제외) 결재하지 않았을 때만, 임시저장으로 되돌린다."""
    companyid, email = user["companyid"], user.get("email")
    with _db.connect() as connection, connection.cursor() as cursor:
        status, _step, writer = _lock_doc(cursor, companyid, docno)
        if writer != email:
            raise PermissionError("본인이 신청한 문서만 회수할 수 있습니다.")
        if status != "PENDING":
            raise ValueError("결재중인 문서만 회수할 수 있습니다.")
        cursor.execute(
            """SELECT 1 FROM eappr_step01t WHERE companyid = %s AND docno = %s AND status <> 'WAIT' AND approver <> %s LIMIT 1""",
            (companyid, docno, email),
        )
        if cursor.fetchone():
            raise ValueError("이미 결재가 진행된 문서는 회수할 수 없습니다.")
        cursor.execute("DELETE FROM eappr_step01t WHERE companyid = %s AND docno = %s", (companyid, docno))
        cursor.execute(
            """UPDATE eappr_doc01t SET status = 'DRAFT', current_step = NULL, submitted_at = NULL, updatedat = CURRENT_TIMESTAMP, updated_by = %s
               WHERE companyid = %s AND docno = %s""",
            (email, companyid, docno),
        )
    return {"success": True, "status": "DRAFT"}


# ── 조회 ────────────────────────────────────────────────────────────
_DOC_COLUMNS = """d.docno, d.formcode,
    (SELECT f.formname FROM eappr_form01t f WHERE f.companyid = d.companyid AND f.formcode = d.formcode) AS formname, d.title, d.status, d.current_step, d.submitted_at, d.completed_at, d.createdat, d.updatedat,
    d.created_by AS writer, COALESCE(w.username, d.created_by) AS writer_name, w.team AS writer_team,
    (SELECT s.approver FROM eappr_step01t s WHERE s.companyid = d.companyid AND s.docno = d.docno AND s.step = d.current_step) AS current_approver,
    (SELECT COUNT(*) FROM eappr_step01t s WHERE s.companyid = d.companyid AND s.docno = d.docno) AS step_total,
    (SELECT COUNT(*) FROM eappr_step01t s WHERE s.companyid = d.companyid AND s.docno = d.docno AND s.status = 'APPROVED') AS step_done"""
_DOC_FROM = "eappr_doc01t d LEFT JOIN user01t w ON w.companyid = d.companyid AND w.email = d.created_by"


def _decorate(row: dict, names: dict) -> dict:
    row["formname"] = row.get("formname") or FORM_NAME.get(row["formcode"], row["formcode"])
    row["status_label"] = STATUS_LABEL.get(row["status"], row["status"])
    approver = row.get("current_approver")
    row["current_approver_name"] = names.get(approver, {}).get("name", approver) if approver else ""
    return row


def list_docs(user: dict, box: str = "mine", status: str = "", formcode: str = "", q: str = "",
              date_from=None, date_to=None, page: int = 1, page_size: int = 30) -> dict:
    """box: drafts 임시저장함 · mine 신청내역 · todo 결재할 문서(내 차례 + 아직 차례가 오지 않은 대기) · done 내가 결재한 문서."""
    _require(user, MENU_DOC, "전자결재")
    companyid, email = user["companyid"], user.get("email")
    where, params = ["d.companyid = %s"], [companyid]
    if box == "drafts":
        where += ["d.created_by = %s", "d.status = 'DRAFT'"]
        params.append(email)
    elif box == "mine":
        where += ["d.created_by = %s", "d.status <> 'DRAFT'"]
        params.append(email)
    elif box == "todo":
        # 결재중이고 내 단계가 아직 남아 있는(WAIT) 문서 — 내 차례가 먼저, 그다음 대기
        where += ["d.status = 'PENDING'", "EXISTS (SELECT 1 FROM eappr_step01t s WHERE s.companyid = d.companyid AND s.docno = d.docno AND s.approver = %s AND s.status = 'WAIT' AND s.step >= d.current_step)"]
        params.append(email)
    elif box == "done":
        where.append("EXISTS (SELECT 1 FROM eappr_step01t s WHERE s.companyid = d.companyid AND s.docno = d.docno AND s.approver = %s AND s.status <> 'WAIT' AND s.updated_by = s.approver)")   # 본인이 직접 처리한 단계만 (본인 단계 자동 승인 · 관리자 반려 제외)
        params.append(email)
    else:
        raise ValueError("목록 구분이 올바르지 않습니다.")
    if status:
        where.append("d.status = %s")
        params.append(status.upper())
    if formcode:
        where.append("d.formcode = %s")
        params.append(formcode.upper())
    date_col = "d.createdat" if box == "drafts" else "COALESCE(d.submitted_at, d.createdat)"
    if date_from:
        where.append(f"{date_col} >= (%s::date)::timestamp AT TIME ZONE 'Asia/Seoul'")
        params.append(date_from)
    if date_to:
        where.append(f"{date_col} < (%s::date + 1)::timestamp AT TIME ZONE 'Asia/Seoul'")
        params.append(date_to)
    if q.strip():
        where.append("(d.docno ILIKE %s OR d.title ILIKE %s OR w.username ILIKE %s)")
        params += [f"%{q.strip()}%"] * 3
    with _db.connect() as connection, connection.cursor() as cursor:
        names = _user_names(cursor, companyid)
        # 1) 키만으로 조건 · 정렬 · 페이지 + 전체 건수  2) 고른 30건만 작성자 · 결재 단계 등을 붙인다
        key_from = _DOC_FROM if q.strip() else "eappr_doc01t d"
        # 앞쪽 정렬: 결재할 문서 = 내 차례인 문서, 그 밖 = 결재중인 문서
        if box == "todo":
            first_sql = "EXISTS (SELECT 1 FROM eappr_step01t s WHERE s.companyid = d.companyid AND s.docno = d.docno AND s.step = d.current_step AND s.approver = %s)"
            first_params = [email]
        else:
            first_sql, first_params = "(d.status = 'PENDING')", []
        cursor.execute(
            f"""WITH page AS (
                    SELECT d.docno, {first_sql} AS pending_first, COALESCE(d.submitted_at, d.createdat) AS sort_at, COUNT(*) OVER () AS total_count
                      FROM {key_from} WHERE {' AND '.join(where)}
                     ORDER BY 2 DESC, 3 DESC, d.docno DESC LIMIT %s OFFSET %s)
                SELECT {_DOC_COLUMNS},
                       (SELECT MIN(s.step) FROM eappr_step01t s WHERE s.companyid = d.companyid AND s.docno = d.docno AND s.approver = %s AND s.status = 'WAIT') AS my_step,
                       page.total_count
                  FROM page JOIN eappr_doc01t d ON d.companyid = %s AND d.docno = page.docno
                  LEFT JOIN user01t w ON w.companyid = d.companyid AND w.email = d.created_by
                 ORDER BY page.pending_first DESC, page.sort_at DESC, page.docno DESC""",
            (*first_params, *params, page_size, (page - 1) * page_size, email, companyid),
        )
        rows = _rows(cursor)
    total = rows[0]["total_count"] if rows else 0
    return {"items": [_decorate({k: v for k, v in r.items() if k != "total_count"}, names) for r in rows], "total": total}


def get_doc(user: dict, docno: str) -> dict:
    companyid, email = user["companyid"], user.get("email")
    with _db.connect() as connection, connection.cursor() as cursor:
        names = _user_names(cursor, companyid)
        cursor.execute(f"SELECT {_DOC_COLUMNS}, d.content FROM {_DOC_FROM} WHERE d.companyid = %s AND d.docno = %s", (companyid, docno))
        rows = _rows(cursor)
        if not rows:
            raise LookupError("문서를 찾을 수 없습니다.")
        doc = _decorate(rows[0], names)
        cursor.execute(
            """SELECT step, approver, status, acted_at, comment FROM eappr_step01t WHERE companyid = %s AND docno = %s ORDER BY step""",
            (companyid, docno),
        )
        steps = _rows(cursor)
        is_writer = doc["writer"] == email
        in_line = any(s["approver"] == email for s in steps)
        if not (is_writer or in_line or _has(user, MENU_FORM)):
            raise PermissionError("이 문서를 볼 권한이 없습니다.")
        if doc["status"] == "DRAFT" and not is_writer:
            raise PermissionError("임시저장 문서는 작성자만 볼 수 있습니다.")
        for s in steps:
            info = names.get(s["approver"], {})
            s.update({"name": info.get("name", s["approver"]), "team": info.get("team", ""), "position": info.get("position", ""),
                      "status_label": STEP_LABEL.get(s["status"], s["status"])})
        if doc["status"] == "DRAFT":   # 임시저장: 신청하면 쓸 결재선을 미리 보여 준다
            line = _form_lines(cursor, companyid).get(doc["formcode"]) or []
            line = [a for a in line if a != doc["writer"]] or line[:1]   # 신청자 본인 단계는 빠진다
            steps = [{"step": i, "approver": a, "status": "WAIT", "status_label": "예정", "name": names.get(a, {}).get("name", a),
                      "team": names.get(a, {}).get("team", ""), "position": names.get(a, {}).get("position", "")} for i, a in enumerate(line, start=1)]
    doc["steps"] = steps
    doc["writer_position"] = names.get(doc["writer"], {}).get("position", "")
    current = next((s for s in steps if s.get("step") == doc.get("current_step")), None)
    doc["can_approve"] = doc["status"] == "PENDING" and bool(current) and current["approver"] == email
    # 아직 차례가 오지 않은 내 단계 (결재할 문서에 '대기'로 보임 · 결재는 차례가 와야 가능)
    mine_wait = next((s for s in steps if s["approver"] == email and s["status"] == "WAIT"), None) if doc["status"] == "PENDING" else None
    doc["my_wait_step"] = mine_wait["step"] if mine_wait and not doc["can_approve"] else None
    doc["can_withdraw"] = doc["status"] == "PENDING" and is_writer and not any(
        s["status"] != "WAIT" and s["approver"] != email for s in steps)
    doc["can_edit"] = doc["status"] == "DRAFT" and is_writer
    return doc


def summary(user: dict) -> dict:
    """헤더 알림: 내가 결재할 문서 (최근 8건) + 최근 7일 안에 반려된 내 문서 수."""
    companyid, email = user["companyid"], user.get("email")
    if not _has(user, MENU_DOC):
        return {"enabled": False, "todo": 0, "items": [], "my_rejected": 0}
    with _db.connect() as connection, connection.cursor() as cursor:
        names = _user_names(cursor, companyid)
        cursor.execute(
            f"""SELECT {_DOC_COLUMNS} FROM {_DOC_FROM}
                WHERE d.companyid = %s AND d.status = 'PENDING'
                  AND EXISTS (SELECT 1 FROM eappr_step01t s WHERE s.companyid = d.companyid AND s.docno = d.docno AND s.step = d.current_step AND s.approver = %s)
                ORDER BY d.submitted_at DESC""",
            (companyid, email),
        )
        todo = [_decorate(r, names) for r in _rows(cursor)]
        cursor.execute(
            """SELECT COUNT(*) FROM eappr_doc01t WHERE companyid = %s AND created_by = %s AND status = 'REJECTED'
               AND completed_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'""",
            (companyid, email),
        )
        rejected = cursor.fetchone()[0]
    return {"enabled": True, "todo": len(todo), "items": todo[:8], "my_rejected": rejected}


def forms_for_writer(user: dict) -> dict:
    """작성 화면: 사용 중인 양식 + 양식별 결재선(이름) + 내 연차 현황."""
    _require(user, MENU_DOC, "전자결재")
    companyid = user["companyid"]
    with _db.connect() as connection, connection.cursor() as cursor:
        _ensure_forms(cursor, companyid)
        names = _user_names(cursor, companyid)
        lines = _form_lines(cursor, companyid)
        cursor.execute("SELECT formcode, formname, useyn, fields, template FROM eappr_form01t WHERE companyid = %s ORDER BY sort_order, formcode", (companyid,))
        mine = user.get("email")
        own_line = lambda code: [a for a in lines.get(code) or [] if a != mine] or (lines.get(code) or [])[:1]   # noqa: E731 — 신청자 본인 단계는 빠진다
        forms = [{"formcode": code, "formname": name, "custom": code not in FORM_NAME,
                  **({"fields": fields or [], "template": template or ""} if code not in FORM_NAME else {}),
                  "line": [{"step": i, "approver": a, **names.get(a, {"name": a})} for i, a in enumerate(own_line(code), start=1)]}
                 for code, name, useyn, fields, template in cursor.fetchall() if useyn == "Y"]
        me = names.get(user.get("email"), {})
        times = leave_times(cursor, companyid)
    return {"forms": forms, "leave_kinds": LEAVE_KINDS, "leave_times": times, "report_types": REPORT_TYPES, "leave": leave_status(user),
            "me": {"email": user.get("email"), "name": me.get("name") or user.get("username"), "team": me.get("team", ""), "position": me.get("position", "")}}


# ── 결재양식관리 (관리자) ───────────────────────────────────────────
def admin_settings(user: dict, year: int | None = None) -> dict:
    _require(user, MENU_FORM, "결재양식관리")
    companyid = user["companyid"]
    year = year or _today().year
    with _db.connect() as connection, connection.cursor() as cursor:
        _ensure_forms(cursor, companyid)
        lines = _form_lines(cursor, companyid)
        cursor.execute(
            """SELECT f.formcode, f.formname, f.useyn, f.fields, f.template, COALESCE(f.updatedat, f.createdat) AS changed_at,
                      COALESCE(u.username, f.updated_by, f.created_by) AS changed_by,
                      (SELECT COUNT(*) FROM eappr_doc01t d WHERE d.companyid = f.companyid AND d.formcode = f.formcode) AS doc_count
               FROM eappr_form01t f LEFT JOIN user01t u ON u.companyid = f.companyid AND u.email = COALESCE(f.updated_by, f.created_by)
               WHERE f.companyid = %s ORDER BY f.sort_order, f.formcode""",
            (companyid,),
        )
        forms = [{**r, "useyn": r["useyn"] == "Y", "custom": r["formcode"] not in FORM_NAME, "line": lines.get(r["formcode"]) or []}
                 for r in _rows(cursor)]
        cursor.execute(
            """SELECT u.email, u.username, u.team, u.position, u.hiredate, l.granted_days
               FROM user01t u LEFT JOIN eappr_leave01t l ON l.companyid = u.companyid AND l.useremail = u.email AND l.leaveyear = %s
               WHERE u.companyid = %s AND UPPER(COALESCE(u.useyn, 'N')) = 'Y'
               ORDER BY u.username, u.email""",
            (year, companyid),
        )
        users = _rows(cursor)
        for row in users:
            used, pending = _leave_usage(cursor, companyid, row["email"], year)
            granted = Decimal(row["granted_days"]) if row["granted_days"] is not None else None
            row.update({"granted": float(granted) if granted is not None else None, "used": float(used), "pending": float(pending),
                        "remain": float(max((granted or 0) - used - pending, 0)) if granted is not None else None})
            row.pop("granted_days", None)
        times = leave_times(cursor, companyid)
    return {"year": year, "forms": forms, "users": users, "leave_times": times,
            "field_types": custom_form.FIELD_TYPES, "can_template": companyid == PLATFORM_COMPANY}


def _clean_times(times: dict) -> dict:
    """시간대 검사: 오전 · 오후반차는 1개, 반반차는 1 ~ 8개, 시작 < 종료, 반반차끼리 겹치지 않게."""
    out = {}
    for kind in TIME_KINDS:
        label = LEAVE_KINDS[kind]
        slots = []
        for slot in (times or {}).get(kind) or []:
            start, end = _hhmm(slot.get("from"), label), _hhmm(slot.get("to"), label)
            if start >= end:
                raise ValueError(f"{label} 시간대의 종료 시간은 시작 시간보다 늦어야 합니다: {start} ~ {end}")
            slots.append((start, end))
        if kind != "QUARTER" and len(slots) != 1:
            raise ValueError(f"{label} 시간대는 1개를 정해 주세요.")
        if kind == "QUARTER" and not 1 <= len(slots) <= 8:
            raise ValueError("반반차 시간대는 1 ~ 8개까지 정할 수 있습니다.")
        slots.sort()
        for (a1, b1), (a2, _b2) in zip(slots, slots[1:]):
            if a2 < b1:
                raise ValueError(f"반반차 시간대가 겹칩니다: {a1} ~ {b1}, {a2} ~ {_b2}")
            if a1 == a2:
                raise ValueError(f"같은 반반차 시간대가 두 번 있습니다: {a1}")
        out[kind] = slots
    return out


def save_admin(user: dict, forms: list[dict] | None = None, year: int | None = None, leaves: list[dict] | None = None,
               times: dict | None = None) -> dict:
    _require(user, MENU_FORM, "결재양식관리")
    companyid, actor = user["companyid"], user.get("email")
    with _db.connect() as connection, connection.cursor() as cursor:
        _ensure_forms(cursor, companyid)
        names = _user_names(cursor, companyid)
        cursor.execute("SELECT formcode, formname FROM eappr_form01t WHERE companyid = %s", (companyid,))
        form_names = dict(cursor.fetchall())
        for form in forms or []:
            code = str(form.get("formcode") or "").upper()
            if code not in form_names:
                continue
            approvers = [str(a or "").strip() for a in form.get("line") or [] if str(a or "").strip()]
            if len(set(approvers)) != len(approvers):
                raise ValueError(f"{form_names[code]} 결재선에 같은 사람이 두 번 있습니다.")
            bad = [a for a in approvers if not names.get(a, {}).get("active")]
            if bad:
                raise ValueError(f"{form_names[code]} 결재선에 사용할 수 없는 계정이 있습니다: {', '.join(bad)}")
            if form.get("useyn") and not approvers:
                raise ValueError(f"{form_names[code]}을(를) 사용하려면 결재자를 1명 이상 정해 주세요.")
            cursor.execute(
                """UPDATE eappr_form01t SET useyn = %s, updatedat = CURRENT_TIMESTAMP, updated_by = %s
                   WHERE companyid = %s AND formcode = %s AND useyn IS DISTINCT FROM %s""",
                ("Y" if form.get("useyn") else "N", actor, companyid, code, "Y" if form.get("useyn") else "N"),
            )
            cursor.execute("SELECT step, approver FROM eappr_line01t WHERE companyid = %s AND formcode = %s ORDER BY step", (companyid, code))
            if [a for _s, a in cursor.fetchall()] != approvers:   # 바뀐 양식만 결재선을 다시 쓴다
                cursor.execute("DELETE FROM eappr_line01t WHERE companyid = %s AND formcode = %s", (companyid, code))
                for step, approver in enumerate(approvers, start=1):
                    cursor.execute(
                        """INSERT INTO eappr_line01t (companyid, companyname, formcode, step, approver, created_by)
                           VALUES (%s, (SELECT companyname FROM company01t WHERE companyid = %s), %s, %s, %s, %s)""",
                        (companyid, companyid, code, step, approver, actor),
                    )
        if times is not None:
            clean = _clean_times(times)
            cursor.execute("SELECT kind, time_from, time_to FROM eappr_leavetime01t WHERE companyid = %s ORDER BY kind, slotno", (companyid,))
            current = {}
            for kind, start, end in cursor.fetchall():
                current.setdefault(kind, []).append((start, end))
            for kind, slots in clean.items():
                if current.get(kind) == slots:   # 바뀐 종류만 다시 쓴다
                    continue
                cursor.execute("DELETE FROM eappr_leavetime01t WHERE companyid = %s AND kind = %s", (companyid, kind))
                for slotno, (start, end) in enumerate(slots, start=1):
                    cursor.execute(
                        """INSERT INTO eappr_leavetime01t (companyid, companyname, kind, slotno, time_from, time_to, created_by)
                           VALUES (%s, (SELECT companyname FROM company01t WHERE companyid = %s), %s, %s, %s, %s, %s)""",
                        (companyid, companyid, kind, slotno, start, end, actor),
                    )
        if leaves is not None:
            year = int(year or _today().year)
            for row in leaves:
                email = str(row.get("email") or "").strip()
                if email not in names:
                    continue
                value = row.get("granted")
                if value in (None, ""):
                    cursor.execute("DELETE FROM eappr_leave01t WHERE companyid = %s AND useremail = %s AND leaveyear = %s", (companyid, email, year))
                    continue
                days = Decimal(str(value))
                if days < 0 or days > 99:
                    raise ValueError(f"{names[email]['name']}의 발생 일수를 확인해 주세요 (0 ~ 99).")
                cursor.execute(
                    """INSERT INTO eappr_leave01t (companyid, companyname, useremail, leaveyear, granted_days, created_by)
                       VALUES (%s, (SELECT companyname FROM company01t WHERE companyid = %s), %s, %s, %s, %s)
                       ON CONFLICT (companyid, useremail, leaveyear) DO UPDATE
                       SET granted_days = EXCLUDED.granted_days, updatedat = CURRENT_TIMESTAMP, updated_by = %s
                       WHERE eappr_leave01t.granted_days IS DISTINCT FROM EXCLUDED.granted_days""",
                    (companyid, companyid, email, year, days, actor, actor),
                )
    return admin_settings(user, year)


# ── 결재양식관리 · 추가 양식 ────────────────────────────────────────
def _clean_form_input(user: dict, name: str, fields: list, template: str, existing: list | None = None) -> tuple[str, list, str, list]:
    name = str(name or "").strip()[:100]
    if not name:
        raise ValueError("양식 이름을 입력해 주세요.")
    clean = custom_form.clean_fields(fields, existing)
    template = str(template or "")
    if template.strip() and user["companyid"] != PLATFORM_COMPANY:
        raise PermissionError("HTML 서식은 쓸 수 없습니다.")
    template = custom_form.sanitize_template(template) if template.strip() else ""
    return name, clean, template, custom_form.template_problems(template, clean)


def create_form(user: dict, name: str, fields: list, template: str = "") -> dict:
    """양식 추가: C001, C002 … (회사별). 처음에는 사용 안 함 — 결재선을 정하고 켠다."""
    _require(user, MENU_FORM, "결재양식관리")
    companyid, actor = user["companyid"], user.get("email")
    name, clean, template, problems = _clean_form_input(user, name, fields, template)
    with _db.connect() as connection, connection.cursor() as cursor:
        _ensure_forms(cursor, companyid)
        cursor.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"eappr-form:{companyid}",))
        cursor.execute("SELECT 1 FROM eappr_form01t WHERE companyid = %s AND formname = %s", (companyid, name))
        if cursor.fetchone():
            raise ValueError(f"같은 이름의 양식이 있습니다: {name}")
        cursor.execute(
            """SELECT COALESCE(MAX(CAST(SUBSTRING(formcode FROM 2) AS integer)), 0), COALESCE(MAX(sort_order), 0)
               FROM eappr_form01t WHERE companyid = %s AND formcode ~ '^C[0-9]+$'""", (companyid,))
        last_no, _ = cursor.fetchone()
        cursor.execute("SELECT COALESCE(MAX(sort_order), 0) FROM eappr_form01t WHERE companyid = %s", (companyid,))
        order = cursor.fetchone()[0] + 1
        code = f"C{last_no + 1:03d}"
        cursor.execute(
            """INSERT INTO eappr_form01t (companyid, companyname, formcode, formname, useyn, sort_order, fields, template, created_by)
               VALUES (%s, (SELECT companyname FROM company01t WHERE companyid = %s), %s, %s, 'N', %s, %s::jsonb, %s, %s)""",
            (companyid, companyid, code, name, order, json.dumps(clean, ensure_ascii=False), template, actor),
        )
    return {"formcode": code, "problems": problems}


def update_form(user: dict, formcode: str, name: str, fields: list, template: str = "") -> dict:
    """추가 양식 고치기. 이미 신청한 문서는 신청 때 저장한 양식 그대로 보인다."""
    _require(user, MENU_FORM, "결재양식관리")
    companyid, actor = user["companyid"], user.get("email")
    formcode = str(formcode or "").upper()
    if formcode in FORM_NAME:
        raise ValueError("기본 양식은 고칠 수 없습니다.")
    with _db.connect() as connection, connection.cursor() as cursor:
        form = _form_def(cursor, companyid, formcode)
        if not form:
            raise LookupError("양식을 찾을 수 없습니다.")
        if user["companyid"] != PLATFORM_COMPANY:
            template = ""   # 다른 회사는 HTML 서식을 쓰지 않는다 (예전에 있던 것도 비운다)
        name, clean, template, problems = _clean_form_input(user, name, fields, template, form["fields"])
        cursor.execute("SELECT 1 FROM eappr_form01t WHERE companyid = %s AND formname = %s AND formcode <> %s", (companyid, name, formcode))
        if cursor.fetchone():
            raise ValueError(f"같은 이름의 양식이 있습니다: {name}")
        cursor.execute(
            """UPDATE eappr_form01t SET formname = %s, fields = %s::jsonb, template = %s, updatedat = CURRENT_TIMESTAMP, updated_by = %s
               WHERE companyid = %s AND formcode = %s""",
            (name, json.dumps(clean, ensure_ascii=False), template, actor, companyid, formcode),
        )
    return {"formcode": formcode, "problems": problems}


def delete_form(user: dict, formcode: str) -> dict:
    """추가 양식 지우기: 문서가 하나도 없을 때만 (있으면 '사용 안 함'으로 끈다)."""
    _require(user, MENU_FORM, "결재양식관리")
    companyid = user["companyid"]
    formcode = str(formcode or "").upper()
    if formcode in FORM_NAME:
        raise ValueError("기본 양식은 지울 수 없습니다. 사용 여부로 끄세요.")
    with _db.connect() as connection, connection.cursor() as cursor:
        cursor.execute("SELECT COUNT(*) FROM eappr_doc01t WHERE companyid = %s AND formcode = %s", (companyid, formcode))
        if cursor.fetchone()[0]:
            raise ValueError("이 양식으로 작성한 문서가 있어 지울 수 없습니다. 사용 여부로 끄세요.")
        cursor.execute("DELETE FROM eappr_line01t WHERE companyid = %s AND formcode = %s", (companyid, formcode))
        cursor.execute("DELETE FROM eappr_form01t WHERE companyid = %s AND formcode = %s", (companyid, formcode))
        if cursor.rowcount == 0:
            raise LookupError("양식을 찾을 수 없습니다.")
    return {"deleted": formcode}


def preview_template(user: dict, template: str) -> dict:
    """HTML 서식 미리보기용 정리 결과 (모스코만) — 저장 전 화면이 서버와 같은 결과를 보여 준다."""
    _require(user, MENU_FORM, "결재양식관리")
    if user["companyid"] != PLATFORM_COMPANY:
        raise PermissionError("HTML 서식은 쓸 수 없습니다.")
    return {"template": custom_form.sanitize_template(template)}


# ── 결재양식관리 · 진행 문서 (멈춘 문서 풀기) ───────────────────────
def _approver_state(cursor, companyid: str) -> dict:
    """직원별 결재 가능 여부: 사용 중인 계정 + 전자결재 메뉴 권한 (모스코 MASTER 는 항상)."""
    cursor.execute(
        """SELECT u.email, u.username, u.team, u.position, UPPER(COALESCE(u.useyn, 'N')) = 'Y' AS active,
                  (u.companyid = '001' AND UPPER(COALESCE(u.authority, '')) = 'MASTER')
                  OR EXISTS (SELECT 1 FROM usermenupermission01t p WHERE p.companyid = u.companyid AND LOWER(p.useremail) = LOWER(u.email)
                                AND p.menuid = %s AND UPPER(COALESCE(p.useyn, 'N')) = 'Y') AS has_menu
           FROM user01t u WHERE u.companyid = %s""",
        (MENU_DOC, companyid),
    )
    out = {}
    for email, name, team, position, active, has_menu in cursor.fetchall():
        problem = "" if active and has_menu else ("사용 중지 계정" if not active else "전자결재 권한 없음")
        out[email] = {"name": name or email, "team": team or "", "position": position or "", "problem": problem}
    return out


# 결재할 수 있는 직원 (사용 중 계정 + 전자결재 권한 · 모스코 MASTER 는 항상) — u = user01t 별칭
_USABLE_SQL = """UPPER(COALESCE(u.useyn, 'N')) = 'Y' AND ((u.companyid = '001' AND UPPER(COALESCE(u.authority, '')) = 'MASTER')
    OR EXISTS (SELECT 1 FROM usermenupermission01t p WHERE p.companyid = u.companyid AND LOWER(p.useremail) = LOWER(u.email)
                  AND p.menuid = 'EAPPROVAL' AND UPPER(COALESCE(p.useyn, 'N')) = 'Y'))"""


def admin_pending(user: dict, q: str = "", formcode: str = "", date_from=None, date_to=None, page: int = 1, page_size: int = 30) -> dict:
    """결재중인 문서 (결재가 멈춘 문서가 위로) — 조회 조건 · 페이징. 30건만 결재선 · 이름을 붙인다."""
    _require(user, MENU_FORM, "결재양식관리")
    companyid = user["companyid"]
    where, params = ["d.companyid = %s", "d.status = 'PENDING'"], [companyid]
    if formcode:
        where.append("d.formcode = %s")
        params.append(formcode.upper())
    if date_from:   # 신청일 (한국시간) — 시각으로 바꿔 인덱스를 탄다
        where.append("d.submitted_at >= (%s::date)::timestamp AT TIME ZONE 'Asia/Seoul'")
        params.append(date_from)
    if date_to:
        where.append("d.submitted_at < (%s::date + 1)::timestamp AT TIME ZONE 'Asia/Seoul'")
        params.append(date_to)
    if q.strip():   # 문서번호 · 제목 · 신청자 이름 · 신청자 이메일
        where.append("(d.docno ILIKE %s OR d.title ILIKE %s OR w.username ILIKE %s OR d.created_by ILIKE %s)")
        params += [f"%{q.strip()}%"] * 4
    key_from = "eappr_doc01t d" + (" LEFT JOIN user01t w ON w.companyid = d.companyid AND w.email = d.created_by" if q.strip() else "")
    with _db.connect() as connection, connection.cursor() as cursor:
        # 1) 키만: 조건 · '결재 멈춤' 여부 · 정렬 · 페이지 · 전체 건수 · 멈춤 건수
        cursor.execute(
            f"""WITH keys AS (
                    SELECT d.docno, d.submitted_at,
                           NOT EXISTS (SELECT 1 FROM eappr_step01t s JOIN user01t u ON u.companyid = s.companyid AND u.email = s.approver
                                        WHERE s.companyid = d.companyid AND s.docno = d.docno AND s.step = d.current_step AND {_USABLE_SQL}) AS blocked
                      FROM {key_from} WHERE {' AND '.join(where)})
                SELECT docno, blocked, COUNT(*) OVER () AS total, COUNT(*) FILTER (WHERE blocked) OVER () AS blocked_total
                  FROM keys ORDER BY blocked DESC, submitted_at DESC, docno DESC LIMIT %s OFFSET %s""",
            (*params, page_size, (page - 1) * page_size),
        )
        keys = _rows(cursor)
        docnos = [k["docno"] for k in keys]
        total = keys[0]["total"] if keys else 0
        blocked_total = keys[0]["blocked_total"] if keys else 0
        if not keys and page > 1:
            cursor.execute(f"SELECT COUNT(*) FROM {key_from} WHERE {' AND '.join(where)}", params)
            total = cursor.fetchone()[0]
        state = _approver_state(cursor, companyid)
        docs, steps = [], {}
        if docnos:
            # 2) 이 페이지 문서만 내용 · 결재선
            cursor.execute(
                """SELECT d.docno, d.formcode, d.title, d.created_by AS writer, d.current_step, d.submitted_at,
                          (SELECT f.formname FROM eappr_form01t f WHERE f.companyid = d.companyid AND f.formcode = d.formcode) AS formname
                   FROM eappr_doc01t d WHERE d.companyid = %s AND d.docno = ANY(%s)""",
                (companyid, docnos),
            )
            by_no = {r["docno"]: r for r in _rows(cursor)}
            docs = [by_no[n] for n in docnos if n in by_no]
            cursor.execute("SELECT docno, step, approver, status, acted_at FROM eappr_step01t WHERE companyid = %s AND docno = ANY(%s) ORDER BY docno, step",
                           (companyid, docnos))
            for row in _rows(cursor):
                info = state.get(row["approver"], {"name": row["approver"], "team": "", "position": "", "problem": "계정 없음"})
                steps.setdefault(row["docno"], []).append({**row, "name": info["name"], "team": info["team"], "position": info["position"],
                                                           "problem": info["problem"] if row["status"] == "WAIT" else ""})
    for doc in docs:
        doc["formname"] = doc.get("formname") or FORM_NAME.get(doc["formcode"], doc["formcode"])
        doc["writer_name"] = state.get(doc["writer"], {}).get("name", doc["writer"])
        doc["steps"] = steps.get(doc["docno"], [])
        current = next((x for x in doc["steps"] if x["step"] == doc["current_step"]), None)
        doc["current_name"] = current["name"] if current else ""
        doc["blocked"] = bool(current and current["problem"])            # 지금 결재할 사람이 결재할 수 없음
        doc["warn"] = any(x["problem"] for x in doc["steps"])            # 뒤 단계에 결재할 수 없는 사람이 있음
    approvers = [{"email": e, "name": v["name"], "team": v["team"], "position": v["position"]}
                 for e, v in sorted(state.items(), key=lambda kv: kv[1]["name"]) if not v["problem"]]
    return {"docs": docs, "total": total, "blocked_total": blocked_total, "page": page, "page_size": page_size, "approvers": approvers}


def admin_change_approver(user: dict, docno: str, step: int, approver: str) -> dict:
    """아직 결재하지 않은 단계의 결재자를 바꾼다 (퇴사 · 권한 회수 · 장기 부재). 신청자 본인 · 같은 문서에 이미 남은 결재자는 안 됨."""
    _require(user, MENU_FORM, "결재양식관리")
    companyid, actor = user["companyid"], user.get("email")
    approver = str(approver or "").strip()
    with _db.connect() as connection, connection.cursor() as cursor:
        status, _current, writer = _lock_doc(cursor, companyid, docno)
        if status != "PENDING":
            raise ValueError("결재중인 문서만 결재자를 바꿀 수 있습니다.")
        cursor.execute("SELECT approver, status FROM eappr_step01t WHERE companyid = %s AND docno = %s AND step = %s FOR UPDATE", (companyid, docno, step))
        row = cursor.fetchone()
        if not row:
            raise LookupError("결재 단계를 찾을 수 없습니다.")
        if row[1] != "WAIT":
            raise ValueError("이미 결재한 단계는 바꿀 수 없습니다.")
        if row[0] == approver:
            raise ValueError("지금과 같은 결재자입니다.")
        info = _approver_state(cursor, companyid).get(approver)
        if not info:
            raise ValueError("같은 회사의 직원만 결재자로 지정할 수 있습니다.")
        if info["problem"]:
            raise ValueError(f"{info['name']}은(는) 결재자로 지정할 수 없습니다 ({info['problem']}).")
        if approver == writer:
            raise ValueError("신청자 본인은 결재자로 지정할 수 없습니다.")
        cursor.execute("SELECT 1 FROM eappr_step01t WHERE companyid = %s AND docno = %s AND approver = %s AND status = 'WAIT' AND step <> %s",
                       (companyid, docno, approver, step))
        if cursor.fetchone():
            raise ValueError(f"{info['name']}은(는) 이 문서의 다른 단계에 이미 결재자로 있습니다.")
        cursor.execute(
            """UPDATE eappr_step01t SET approver = %s, updatedat = CURRENT_TIMESTAMP, updated_by = %s
               WHERE companyid = %s AND docno = %s AND step = %s""",
            (approver, actor, companyid, docno, step),
        )
        cursor.execute("UPDATE eappr_doc01t SET updatedat = CURRENT_TIMESTAMP, updated_by = %s WHERE companyid = %s AND docno = %s",
                       (actor, companyid, docno))
    return {"success": True}


def admin_force_reject(user: dict, docno: str, reason: str) -> dict:
    """관리자 반려: 결재를 이어갈 수 없는 문서를 끝낸다. 지금 단계에 '관리자 반려'로 사유를 남기고, 신청자는 다시 작성할 수 있다."""
    _require(user, MENU_FORM, "결재양식관리")
    companyid, actor = user["companyid"], user.get("email")
    reason = (reason or "").strip()
    if not reason:
        raise ValueError("반려 사유를 입력해 주세요.")
    with _db.connect() as connection, connection.cursor() as cursor:
        status, step, _writer = _lock_doc(cursor, companyid, docno)
        if status != "PENDING":
            raise ValueError(f"이미 {STATUS_LABEL.get(status, status)} 처리된 문서입니다.")
        name = _user_names(cursor, companyid).get(actor, {}).get("name", actor)
        cursor.execute(
            """UPDATE eappr_step01t SET status = 'REJECTED', acted_at = CURRENT_TIMESTAMP, comment = %s, updatedat = CURRENT_TIMESTAMP, updated_by = %s
               WHERE companyid = %s AND docno = %s AND step = %s""",
            (f"[관리자 반려 · {name}] {reason}"[:500], actor, companyid, docno, step),
        )
        cursor.execute(
            """UPDATE eappr_doc01t SET status = 'REJECTED', current_step = NULL, completed_at = CURRENT_TIMESTAMP, updatedat = CURRENT_TIMESTAMP, updated_by = %s
               WHERE companyid = %s AND docno = %s""",
            (actor, companyid, docno),
        )
    return {"success": True, "status": "REJECTED"}
