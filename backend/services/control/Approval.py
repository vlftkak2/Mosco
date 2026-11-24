"""승인 통제 (기준정보 › 통제관리).

담당자가 거래처 · 매입 · 매출 · 수금/지급을 등록 · 수정 · 삭제하면, 그 대상 · 동작에 통제가 켜져 있을 때
바로 저장하지 않고 승인요청(approval_request01t)으로 보관한다. 승인자가 승인하면 보관한 입력 내용을
기존 저장 로직(executors)에 그대로 넘겨 전표 · 거래처를 만든다. 재고 · 원장 · 매출이익 같은 조회는 바꾸지 않는다.

  - 고객사 허용: company01t.approval_yn (플랫폼 운영사가 고객사등록에서)
  - 대상 · 동작별 켜기: control_policy01t, 본인 승인 허용: control_option01t (승인자가 1명일 때만 효력)
  - 승인자: control_approver01t (고객사 관리자가 지정, 본인도 지정 가능)
  - 매출 요청의 재고: stock_reservation01t 에 예약 → 재고 선택 창에서 다른 사람이 못 고름
  - 모든 요청 · 승인 · 반려 · 취소 · 설정 변경은 control_history01t 에 남는다 (지우지 않음)
"""
import json
from collections import defaultdict
from datetime import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

import db as _db
from services.closing import MonthClose as month_close_module

KST = ZoneInfo("Asia/Seoul")
TARGETS = [
    ("CUSTOMER", "거래처등록"),
    ("INBOUND", "매입등록"),
    ("OUTBOUND", "매출등록"),
    ("RECEIPT_PAYMENT", "수금/지급등록"),
]
# 요청 · 이력 · 알림에 쓰는 짧은 이름 ("매출 등록", "거래처 삭제")
TARGET_LABEL = {"CUSTOMER": "거래처", "INBOUND": "매입", "OUTBOUND": "매출", "RECEIPT_PAYMENT": "수금/지급"}
ACTION_LABEL = {"CREATE": "등록", "UPDATE": "수정", "DELETE": "삭제"}
STATUS_LABEL = {"PENDING": "대기", "PROCESSING": "처리 중", "APPROVED": "승인", "REJECTED": "반려", "CANCELED": "취소"}
EVENT_LABEL = {
    "REQUEST": "승인요청", "APPROVED": "승인", "APPROVED_SELF": "본인 승인", "REJECTED": "반려", "CANCELED": "요청 취소",
    "APPROVE_FAILED": "승인 실패", "POLICY": "통제 설정 변경", "APPROVER": "승인자 변경",
}
ADMIN_AUTHORITIES = {"MASTER", "SUBMASTER"}
ZERO = Decimal("0")


def _name(column: str) -> str:
    return f"COALESCE((SELECT u.username FROM user01t u WHERE u.email = {column} LIMIT 1), {column})"


def _rows(cursor):
    columns = [column[0] for column in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


def is_admin(user: dict) -> bool:
    """통제 설정 · 승인자 지정 · 전체 이력: 고객사 관리자(MASTER · SUBMASTER)."""
    return str(user.get("authority") or "").upper() in ADMIN_AUTHORITIES


def _enabled(cursor, companyid: str) -> bool:
    cursor.execute("SELECT approval_yn FROM company01t WHERE companyid = %s", (companyid,))
    row = cursor.fetchone()
    return bool(row and row[0] == "Y")


def _approvers(cursor, companyid: str) -> list[str]:
    cursor.execute(
        """SELECT a.useremail FROM control_approver01t a
           JOIN user01t u ON u.companyid = a.companyid AND u.email = a.useremail AND UPPER(COALESCE(u.useyn, 'N')) = 'Y'
           WHERE a.companyid = %s ORDER BY a.useremail""",
        (companyid,),
    )
    return [row[0] for row in cursor.fetchall()]


def _self_approve_option(cursor, companyid: str) -> bool:
    cursor.execute("SELECT self_approve_yn FROM control_option01t WHERE companyid = %s", (companyid,))
    row = cursor.fetchone()
    return bool(row and row[0] == "Y")


def _history(cursor, companyid: str, event: str, detail: str, actor: str | None, requestno: str | None = None):
    cursor.execute(
        """INSERT INTO control_history01t (companyid, requestno, event, detail, created_by)
           VALUES (%s, %s, %s, %s, %s)""",
        (companyid, requestno, event, (detail or "")[:1000], actor),
    )


def _require_enabled(cursor, companyid: str):
    if not _enabled(cursor, companyid):
        raise PermissionError("이 고객사는 승인 통제를 사용하지 않습니다.")


# ── 통제 여부 · 요청 ─────────────────────────────────────────────
def controlled(companyid: str, target: str, action: str) -> bool:
    column = {"CREATE": "on_create", "UPDATE": "on_update", "DELETE": "on_delete"}[action]
    with _db.connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            f"""SELECT c.approval_yn = 'Y' AND COALESCE(p.{column}, 'N') = 'Y'
                FROM company01t c
                LEFT JOIN control_policy01t p ON p.companyid = c.companyid AND p.target = %s
                WHERE c.companyid = %s""",
            (target, companyid),
        )
        row = cursor.fetchone()
    return bool(row and row[0])


def _next_requestno(cursor, companyid: str) -> str:
    cursor.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"approval-request:{companyid}",))
    prefix = f"APR-{datetime.now(KST):%Y%m%d}-"
    cursor.execute(
        """SELECT COALESCE(MAX(CAST(SUBSTRING(requestno FROM %s) AS integer)), 0)
           FROM approval_request01t WHERE companyid = %s AND requestno LIKE %s""",
        (len(prefix) + 1, companyid, f"{prefix}%"),
    )
    return f"{prefix}{cursor.fetchone()[0] + 1:04d}"


def _num(value) -> Decimal:
    try:
        return Decimal(str(value or 0))
    except Exception:
        return ZERO


def _reserve_outbound(cursor, companyid: str, requestno: str, item: dict, actor: str | None):
    """매출 요청의 재고를 예약한다. 다른 요청의 예약을 뺀 남은 재고보다 많이 고르면 거절.
    수정 요청이면 이 전표가 이미 쓰고 있는 양은 빼고, 더 쓰는 만큼만 예약한다."""
    need = defaultdict(lambda: [ZERO, ZERO])
    for line in item.get("items") or []:
        key = (str(line.get("stocksourcetype") or ""), str(line.get("stocksourceno") or ""), int(line.get("stocksourceline") or 0))
        need[key][0] += _num(line.get("qty"))
        need[key][1] += _num(line.get("weight"))
    if not need:
        return
    keys = list(need)
    types, nos, lines = [k[0] for k in keys], [k[1] for k in keys], [k[2] for k in keys]
    own = {}
    receiptno = "" if item.get("is_new") else str(item.get("receiptno") or "").strip()
    if receiptno:
        cursor.execute(
            """SELECT stocksourcetype, stocksourceno, stocksourceline, SUM(qty), SUM(weight)
               FROM outbound02t WHERE companyid = %s AND receiptno = %s
               GROUP BY stocksourcetype, stocksourceno, stocksourceline""",
            (companyid, receiptno),
        )
        own = {(r[0], r[1], int(r[2])): (_num(r[3]), _num(r[4])) for r in cursor.fetchall()}
    cursor.execute(
        """SELECT s.sourcetype, s.sourceno, s.sourceline, COALESCE(s.qty, 0), COALESCE(s.weight, 0)
           FROM currentstock01t s
           JOIN unnest(%s::varchar[], %s::varchar[], %s::integer[]) AS k(t, n, l)
             ON s.sourcetype = k.t AND s.sourceno = k.n AND s.sourceline = k.l
           WHERE s.companyid = %s""",
        (types, nos, lines, companyid),
    )
    stock = {(r[0], r[1], int(r[2])): (_num(r[3]), _num(r[4])) for r in cursor.fetchall()}
    cursor.execute(
        """SELECT r.sourcetype, r.sourceno, r.sourceline, SUM(r.qty), SUM(r.weight)
           FROM stock_reservation01t r
           JOIN approval_request01t q ON q.companyid = r.companyid AND q.requestno = r.requestno
           JOIN unnest(%s::varchar[], %s::varchar[], %s::integer[]) AS k(t, n, l)
             ON r.sourcetype = k.t AND r.sourceno = k.n AND r.sourceline = k.l
           WHERE r.companyid = %s AND q.status IN ('PENDING', 'PROCESSING')
           GROUP BY r.sourcetype, r.sourceno, r.sourceline""",
        (types, nos, lines, companyid),
    )
    reserved = {(r[0], r[1], int(r[2])): (_num(r[3]), _num(r[4])) for r in cursor.fetchall()}
    tolerance = Decimal("0.0005")
    for key, (qty, weight) in need.items():
        own_qty, own_weight = own.get(key, (ZERO, ZERO))
        stock_qty, stock_weight = stock.get(key, (ZERO, ZERO))
        rsv_qty, rsv_weight = reserved.get(key, (ZERO, ZERO))
        free_weight = stock_weight + own_weight - rsv_weight
        free_qty = stock_qty + own_qty - rsv_qty
        if weight > free_weight + tolerance or (qty > free_qty + tolerance and stock_qty + own_qty > 0):
            raise ValueError(
                f"재고 {key[1]} / 순번 {key[2]}: 다른 승인요청에 예약되었거나 남은 재고가 부족합니다 "
                f"(선택할 수 있는 중량 {max(free_weight, ZERO):,.3f}kg)."
            )
        extra_qty = max(qty - own_qty, ZERO)
        extra_weight = max(weight - own_weight, ZERO)
        if extra_qty > 0 or extra_weight > 0:
            cursor.execute(
                """INSERT INTO stock_reservation01t (companyid, requestno, sourcetype, sourceno, sourceline, qty, weight, created_by)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
                (companyid, requestno, key[0], key[1], key[2], extra_qty, extra_weight, actor),
            )


def intercept(user: dict, target: str, action: str, op: str, data: dict, summary: str,
              ref_no: str | None = None, dates: list | None = None) -> dict | None:
    """통제가 켜진 대상 · 동작이면 승인요청으로 보관하고 응답을 돌려준다. 꺼져 있으면 None (그대로 저장)."""
    companyid = user["companyid"]
    if not controlled(companyid, target, action):
        return None
    actor = user.get("email")
    with _db.connect() as connection, connection.cursor() as cursor:
        if dates:
            month_close_module.ensure_open(cursor, companyid, dates, ACTION_LABEL[action])
        requestno = _next_requestno(cursor, companyid)
        payload = {"companyname": user.get("companyname") or companyid, "data": data}
        cursor.execute(
            """INSERT INTO approval_request01t (companyid, requestno, target, action, op, ref_no, summary, payload, created_by)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s)""",
            (companyid, requestno, target, action, op, ref_no or None, (summary or "")[:500],
             json.dumps(payload, ensure_ascii=False, default=str), actor),
        )
        if target == "OUTBOUND" and op == "save":
            _reserve_outbound(cursor, companyid, requestno, data.get("item") or {}, actor)
        _history(cursor, companyid, "REQUEST", f"{TARGET_LABEL[target]} {ACTION_LABEL[action]} · {summary}", actor, requestno)
    return {
        "success": True, "pending_approval": True, "requestno": requestno,
        "message": f"{TARGET_LABEL[target]} {ACTION_LABEL[action]}을(를) 승인요청했습니다 ({requestno}). 승인되면 반영됩니다.",
    }


# ── 승인 · 반려 · 취소 ───────────────────────────────────────────
def approve(user: dict, requestno: str) -> dict:
    from services.control import executors  # 저장 모듈들을 늦게 불러 순환 참조를 피한다

    companyid, email = user["companyid"], user.get("email")
    with _db.connect() as connection, connection.cursor() as cursor:
        _require_enabled(cursor, companyid)
        cursor.execute(
            """SELECT target, action, op, payload, status, created_by FROM approval_request01t
               WHERE companyid = %s AND requestno = %s FOR UPDATE""",
            (companyid, requestno),
        )
        row = cursor.fetchone()
        if not row:
            raise LookupError("승인요청을 찾을 수 없습니다.")
        target, action, op, payload, status, requester = row
        if status != "PENDING":
            raise ValueError(f"이미 {STATUS_LABEL.get(status, status)} 처리된 요청입니다.")
        approvers = _approvers(cursor, companyid)
        if email not in approvers:
            raise PermissionError("승인자로 지정된 사람만 승인할 수 있습니다.")
        self_approved = requester == email
        if self_approved and not (_self_approve_option(cursor, companyid) and len(approvers) == 1):
            raise PermissionError("본인이 요청한 건은 본인이 승인할 수 없습니다. (승인자가 1명이고 '본인 승인 허용'을 켠 경우만 가능)")
        cursor.execute(
            "UPDATE approval_request01t SET status = 'PROCESSING', updatedat = CURRENT_TIMESTAMP, updated_by = %s WHERE companyid = %s AND requestno = %s",
            (email, companyid, requestno),
        )
    payload = payload if isinstance(payload, dict) else json.loads(payload)
    try:
        result_no = executors.run(target, op, companyid, payload.get("companyname") or companyid, payload.get("data") or {}, requester)
    except Exception as error:
        message = str(error) if isinstance(error, (ValueError, LookupError)) and str(error) else "저장 중 오류가 발생해 승인하지 못했습니다."
        with _db.connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                "UPDATE approval_request01t SET status = 'PENDING', updatedat = CURRENT_TIMESTAMP, updated_by = %s WHERE companyid = %s AND requestno = %s",
                (email, companyid, requestno),
            )
            _history(cursor, companyid, "APPROVE_FAILED", message, email, requestno)
        raise ValueError(message) from error
    with _db.connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """UPDATE approval_request01t
               SET status = 'APPROVED', decided_by = %s, decided_at = CURRENT_TIMESTAMP, result_no = %s, self_approved = %s,
                   updatedat = CURRENT_TIMESTAMP, updated_by = %s
               WHERE companyid = %s AND requestno = %s""",
            (email, result_no[:100] or None, "Y" if self_approved else "N", email, companyid, requestno),
        )
        cursor.execute("DELETE FROM stock_reservation01t WHERE companyid = %s AND requestno = %s", (companyid, requestno))
        _history(cursor, companyid, "APPROVED_SELF" if self_approved else "APPROVED",
                 f"{TARGET_LABEL.get(target, target)} {ACTION_LABEL.get(action, action)} 반영" + (f" · {result_no}" if result_no else ""),
                 email, requestno)
    return {"success": True, "requestno": requestno, "result_no": result_no, "self_approved": self_approved}


def reject(user: dict, requestno: str, reason: str) -> dict:
    companyid, email = user["companyid"], user.get("email")
    reason = (reason or "").strip()
    if not reason:
        raise ValueError("반려 사유를 입력해 주세요.")
    with _db.connect() as connection, connection.cursor() as cursor:
        _require_enabled(cursor, companyid)
        if email not in _approvers(cursor, companyid):
            raise PermissionError("승인자로 지정된 사람만 반려할 수 있습니다.")
        cursor.execute(
            """UPDATE approval_request01t
               SET status = 'REJECTED', decided_by = %s, decided_at = CURRENT_TIMESTAMP, reject_reason = %s,
                   updatedat = CURRENT_TIMESTAMP, updated_by = %s
               WHERE companyid = %s AND requestno = %s AND status = 'PENDING'""",
            (email, reason[:500], email, companyid, requestno),
        )
        if not cursor.rowcount:
            raise ValueError("대기 중인 요청만 반려할 수 있습니다.")
        cursor.execute("DELETE FROM stock_reservation01t WHERE companyid = %s AND requestno = %s", (companyid, requestno))
        _history(cursor, companyid, "REJECTED", reason, email, requestno)
    return {"success": True, "requestno": requestno}


def cancel(user: dict, requestno: str) -> dict:
    companyid, email = user["companyid"], user.get("email")
    with _db.connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """UPDATE approval_request01t SET status = 'CANCELED', updatedat = CURRENT_TIMESTAMP, updated_by = %s
               WHERE companyid = %s AND requestno = %s AND status = 'PENDING' AND created_by = %s""",
            (email, companyid, requestno, email),
        )
        if not cursor.rowcount:
            raise ValueError("본인이 요청한 대기 중인 건만 취소할 수 있습니다.")
        cursor.execute("DELETE FROM stock_reservation01t WHERE companyid = %s AND requestno = %s", (companyid, requestno))
        _history(cursor, companyid, "CANCELED", "요청자가 취소", email, requestno)
    return {"success": True, "requestno": requestno}


# ── 조회 ─────────────────────────────────────────────────────────
def summary(user: dict) -> dict:
    """헤더 알림 · 메뉴 표시용: 통제 사용 여부, 승인자 여부, 대기 건수."""
    companyid, email = user["companyid"], user.get("email")
    with _db.connect() as connection, connection.cursor() as cursor:
        if not _enabled(cursor, companyid):
            return {"enabled": False}
        approvers = _approvers(cursor, companyid)
        cursor.execute(
            """SELECT COUNT(*) FILTER (WHERE status = 'PENDING'),
                      COUNT(*) FILTER (WHERE status = 'PENDING' AND created_by = %s),
                      COUNT(*) FILTER (WHERE status = 'REJECTED' AND created_by = %s AND decided_at >= CURRENT_TIMESTAMP - INTERVAL '7 days')
               FROM approval_request01t WHERE companyid = %s""",
            (email, email, companyid),
        )
        pending, my_pending, my_rejected = cursor.fetchone()
    is_approver = email in approvers
    return {
        "enabled": True, "is_approver": is_approver, "is_admin": is_admin(user),
        "pending": pending if is_approver else 0, "my_pending": my_pending, "my_rejected": my_rejected,
    }


_REQUEST_COLUMNS = f"""q.requestno, q.target, q.action, q.op, q.ref_no, q.summary, q.status, q.reject_reason, q.result_no,
    q.self_approved, q.createdat AS requested_at, q.created_by AS requested_email, {_name('q.created_by')} AS requested_name,
    q.decided_at, {_name('q.decided_by')} AS decided_name"""


def _decorate(row: dict, email: str) -> dict:
    row["target_label"] = TARGET_LABEL.get(row["target"], row["target"])
    row["action_label"] = ACTION_LABEL.get(row["action"], row["action"])
    row["status_label"] = STATUS_LABEL.get(row["status"], row["status"])
    row["mine"] = row.pop("requested_email", None) == email
    return row


def list_requests(user: dict, scope: str = "inbox", status: str = "", target: str = "", q: str = "",
                  page: int = 1, page_size: int = 30) -> dict:
    companyid, email = user["companyid"], user.get("email")
    with _db.connect() as connection, connection.cursor() as cursor:
        _require_enabled(cursor, companyid)
        approver = email in _approvers(cursor, companyid)
        where, params = ["q.companyid = %s"], [companyid]
        if scope == "mine":
            where.append("q.created_by = %s")
            params.append(email)
        elif not (approver or is_admin(user)):
            raise PermissionError("승인함은 승인자만 볼 수 있습니다.")
        if status:
            where.append("q.status = %s")
            params.append(status.upper())
        if target:
            where.append("q.target = %s")
            params.append(target.upper())
        if q.strip():
            pattern = f"%{q.strip()}%"
            where.append(f"(q.requestno ILIKE %s OR q.summary ILIKE %s OR q.ref_no ILIKE %s OR q.result_no ILIKE %s OR {_name('q.created_by')} ILIKE %s)")
            params.extend([pattern] * 5)
        where_sql = " AND ".join(where)
        cursor.execute(f"SELECT COUNT(*) FROM approval_request01t q WHERE {where_sql}", params)
        total = cursor.fetchone()[0]
        cursor.execute(
            f"""SELECT {_REQUEST_COLUMNS} FROM approval_request01t q WHERE {where_sql}
                ORDER BY (q.status = 'PENDING') DESC, q.createdat DESC LIMIT %s OFFSET %s""",
            (*params, page_size, (page - 1) * page_size),
        )
        items = [_decorate(row, email) for row in _rows(cursor)]
    return {"items": items, "total": total, "page": page, "page_size": page_size, "is_approver": approver}


def get_request(user: dict, requestno: str) -> dict:
    companyid, email = user["companyid"], user.get("email")
    with _db.connect() as connection, connection.cursor() as cursor:
        _require_enabled(cursor, companyid)
        approvers = _approvers(cursor, companyid)
        cursor.execute(f"SELECT {_REQUEST_COLUMNS}, q.payload FROM approval_request01t q WHERE q.companyid = %s AND q.requestno = %s",
                       (companyid, requestno))
        rows = _rows(cursor)
        if not rows:
            raise LookupError("승인요청을 찾을 수 없습니다.")
        item = _decorate(rows[0], email)
        if not (item["mine"] or email in approvers or is_admin(user)):
            raise PermissionError("이 요청을 볼 권한이 없습니다.")
        payload = item.pop("payload")
        payload = payload if isinstance(payload, dict) else json.loads(payload)
        item["data"] = payload.get("data") or {}
        cursor.execute(
            """SELECT r.sourcetype, r.sourceno, r.sourceline, r.qty, r.weight, s.itemname, s.thickness, s.width, s.length
               FROM stock_reservation01t r
               LEFT JOIN currentstock01t s ON s.companyid = r.companyid AND s.sourcetype = r.sourcetype
                AND s.sourceno = r.sourceno AND s.sourceline = r.sourceline
               WHERE r.companyid = %s AND r.requestno = %s ORDER BY r.sourceno, r.sourceline""",
            (companyid, requestno),
        )
        item["reservations"] = _rows(cursor)
        cursor.execute(
            f"""SELECT h.event, h.detail, h.createdat, {_name('h.created_by')} AS actor_name
                FROM control_history01t h WHERE h.companyid = %s AND h.requestno = %s ORDER BY h.id""",
            (companyid, requestno),
        )
        item["history"] = [{**row, "event_label": EVENT_LABEL.get(row["event"], row["event"])} for row in _rows(cursor)]
        self_ok = _self_approve_option(cursor, companyid) and len(approvers) == 1
        item["can_approve"] = item["status"] == "PENDING" and email in approvers and (not item["mine"] or self_ok)
        item["can_reject"] = item["status"] == "PENDING" and email in approvers
        item["can_cancel"] = item["status"] == "PENDING" and item["mine"]
    return item


def list_history(user: dict, q: str = "", event: str = "", page: int = 1, page_size: int = 50) -> dict:
    companyid, email = user["companyid"], user.get("email")
    with _db.connect() as connection, connection.cursor() as cursor:
        _require_enabled(cursor, companyid)
        if not (is_admin(user) or email in _approvers(cursor, companyid)):
            raise PermissionError("통제 이력은 관리자 · 승인자만 볼 수 있습니다.")
        where, params = ["h.companyid = %s"], [companyid]
        if event:
            where.append("h.event = %s")
            params.append(event.upper())
        if q.strip():
            pattern = f"%{q.strip()}%"
            where.append(f"(h.requestno ILIKE %s OR h.detail ILIKE %s OR {_name('h.created_by')} ILIKE %s)")
            params.extend([pattern] * 3)
        where_sql = " AND ".join(where)
        cursor.execute(f"SELECT COUNT(*) FROM control_history01t h WHERE {where_sql}", params)
        total = cursor.fetchone()[0]
        cursor.execute(
            f"""SELECT h.id, h.requestno, h.event, h.detail, h.createdat, {_name('h.created_by')} AS actor_name
                FROM control_history01t h WHERE {where_sql} ORDER BY h.id DESC LIMIT %s OFFSET %s""",
            (*params, page_size, (page - 1) * page_size),
        )
        items = [{**row, "event_label": EVENT_LABEL.get(row["event"], row["event"])} for row in _rows(cursor)]
    return {"items": items, "total": total, "page": page, "page_size": page_size}


# ── 통제 설정 · 승인자 ───────────────────────────────────────────
def get_settings(user: dict) -> dict:
    companyid = user["companyid"]
    with _db.connect() as connection, connection.cursor() as cursor:
        _require_enabled(cursor, companyid)
        cursor.execute("SELECT target, on_create, on_update, on_delete FROM control_policy01t WHERE companyid = %s", (companyid,))
        saved = {row[0]: row[1:] for row in cursor.fetchall()}
        policies = [{"target": key, "label": label,
                     "on_create": saved.get(key, ("N", "N", "N"))[0] == "Y",
                     "on_update": saved.get(key, ("N", "N", "N"))[1] == "Y",
                     "on_delete": saved.get(key, ("N", "N", "N"))[2] == "Y"} for key, label in TARGETS]
        approvers = _approvers(cursor, companyid)
        cursor.execute(
            """SELECT email, username, team, position, authority FROM user01t
               WHERE companyid = %s AND UPPER(COALESCE(useyn, 'N')) = 'Y' ORDER BY username, email""",
            (companyid,),
        )
        users = [{**row, "approver": row["email"] in approvers} for row in _rows(cursor)]
        self_approve = _self_approve_option(cursor, companyid)
    return {"policies": policies, "self_approve": self_approve, "approver_count": len(approvers),
            "self_approve_effective": self_approve and len(approvers) == 1, "users": users, "can_edit": is_admin(user)}


def save_settings(user: dict, policies: list[dict], self_approve: bool, approver_emails: list[str]) -> dict:
    companyid, actor = user["companyid"], user.get("email")
    if not is_admin(user):
        raise PermissionError("통제 설정은 관리자(MASTER · SUBMASTER)만 바꿀 수 있습니다.")
    approver_emails = sorted({str(e or "").strip() for e in approver_emails if str(e or "").strip()})
    if self_approve and len(approver_emails) != 1:
        raise ValueError("본인 승인은 승인자가 1명일 때만 허용할 수 있습니다.")
    valid_targets = set(TARGET_LABEL)
    with _db.connect() as connection, connection.cursor() as cursor:
        _require_enabled(cursor, companyid)
        cursor.execute(
            "SELECT email FROM user01t WHERE companyid = %s AND UPPER(COALESCE(useyn, 'N')) = 'Y' AND email = ANY(%s)",
            (companyid, approver_emails),
        )
        found = {row[0] for row in cursor.fetchall()}
        missing = [e for e in approver_emails if e not in found]
        if missing:
            raise ValueError(f"사용 중인 직원만 승인자로 지정할 수 있습니다: {', '.join(missing)}")
        # 설정 변경 이력: 바뀐 것만 문장으로
        cursor.execute("SELECT target, on_create, on_update, on_delete FROM control_policy01t WHERE companyid = %s", (companyid,))
        before = {row[0]: row[1:] for row in cursor.fetchall()}
        changes = []
        for policy in policies:
            target = str(policy.get("target") or "").upper()
            if target not in valid_targets:
                continue
            values = tuple("Y" if policy.get(key) else "N" for key in ("on_create", "on_update", "on_delete"))
            old = before.get(target, ("N", "N", "N"))
            if values != old:
                diff = [f"{ACTION_LABEL[a]} {'켬' if v == 'Y' else '끔'}" for a, v, o in zip(("CREATE", "UPDATE", "DELETE"), values, old) if v != o]
                changes.append(f"{TARGET_LABEL[target]}: {', '.join(diff)}")
            cursor.execute(
                """INSERT INTO control_policy01t (companyid, target, on_create, on_update, on_delete, created_by)
                   VALUES (%s, %s, %s, %s, %s, %s)
                   ON CONFLICT (companyid, target) DO UPDATE
                   SET on_create = EXCLUDED.on_create, on_update = EXCLUDED.on_update, on_delete = EXCLUDED.on_delete,
                       updatedat = CURRENT_TIMESTAMP, updated_by = %s""",
                (companyid, target, *values, actor, actor),
            )
        old_self = _self_approve_option(cursor, companyid)
        cursor.execute(
            """INSERT INTO control_option01t (companyid, self_approve_yn, created_by) VALUES (%s, %s, %s)
               ON CONFLICT (companyid) DO UPDATE SET self_approve_yn = EXCLUDED.self_approve_yn,
                   updatedat = CURRENT_TIMESTAMP, updated_by = %s""",
            (companyid, "Y" if self_approve else "N", actor, actor),
        )
        if old_self != bool(self_approve):
            changes.append(f"본인 승인 {'허용' if self_approve else '불가'}")
        if changes:
            _history(cursor, companyid, "POLICY", " / ".join(changes), actor)
        old_approvers = set(_approvers(cursor, companyid))
        added, removed = sorted(set(approver_emails) - old_approvers), sorted(old_approvers - set(approver_emails))
        cursor.execute("DELETE FROM control_approver01t WHERE companyid = %s AND NOT (useremail = ANY(%s))", (companyid, approver_emails))
        for email in approver_emails:
            cursor.execute(
                """INSERT INTO control_approver01t (companyid, useremail, created_by) VALUES (%s, %s, %s)
                   ON CONFLICT (companyid, useremail) DO NOTHING""",
                (companyid, email, actor),
            )
        if added or removed:
            cursor.execute("SELECT email, username FROM user01t WHERE companyid = %s AND email = ANY(%s)", (companyid, added + removed))
            names = {row[0]: row[1] or row[0] for row in cursor.fetchall()}
            parts = ([f"지정: {', '.join(names.get(e, e) for e in added)}"] if added else []) + \
                    ([f"해제: {', '.join(names.get(e, e) for e in removed)}"] if removed else [])
            self_note = " (본인 지정)" if actor in added else ""
            _history(cursor, companyid, "APPROVER", " / ".join(parts) + self_note, actor)
    return get_settings(user)
