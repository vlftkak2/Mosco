"""승인 통제 (어드민 › 통제관리).

담당자가 거래처 · 매입 · 매출 · 수금/지급을 등록 · 수정 · 삭제할 때, 그 대상 · 동작이 통제로 켜져 있고 금액 기준을 넘으면
바로 저장하지 않고 승인요청(approval_request01t)으로 보관한다. 승인자가 승인하면 보관한 입력 내용을
기존 저장 로직(executors)에 그대로 넘겨 전표 · 거래처를 만든다. 재고 · 원장 · 매출이익 같은 조회는 바꾸지 않는다.

  - 무엇을 승인받을지: control_policy01t (대상 × 등록 · 수정 · 삭제, 금액 기준)
  - 메뉴권한 '통제관리'(CONTROL_MANAGEMENT): 통제관리 화면에 들어와 설정을 바꾸는 권한
  - 승인자: 통제 설정에서 체크한 직원(control_approver01t)만 승인 · 반려. 본인 요청도 승인할 수 있다.
  - 매출 요청의 재고: 요청 한 건의 reservations 에 예약 → 재고 선택 창에서 다른 사람이 못 고름 (대기 중일 때만)
  - 처리 기록: 요청 한 줄에 요청자 · 시각, 처리자 · 시각, 반려 사유, 마지막 승인 실패 사유가 남는다
"""
import json
from collections import defaultdict
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal
from zoneinfo import ZoneInfo

import db as _db
from services.closing import MonthClose as month_close_module

KST = ZoneInfo("Asia/Seoul")
MENU_ID = "CONTROL_MANAGEMENT"
TARGETS = [
    ("CUSTOMER", "거래처등록"),
    ("INBOUND", "매입등록"),
    ("OUTBOUND", "매출등록"),
    ("RECEIPT_PAYMENT", "수금/지급등록"),
]
AMOUNT_TARGETS = {"INBOUND", "OUTBOUND", "RECEIPT_PAYMENT"}   # 금액 기준을 쓸 수 있는 대상
# 요청 · 알림에 쓰는 짧은 이름 ("매출 등록", "거래처 삭제")
TARGET_LABEL = {"CUSTOMER": "거래처", "INBOUND": "매입", "OUTBOUND": "매출", "RECEIPT_PAYMENT": "수금/지급"}
ACTION_LABEL = {"CREATE": "등록", "UPDATE": "수정", "DELETE": "삭제"}
STATUS_LABEL = {"PENDING": "대기", "PROCESSING": "처리 중", "APPROVED": "승인", "REJECTED": "반려", "CANCELED": "취소"}
ZERO = Decimal("0")


def _name(column: str) -> str:
    return f"COALESCE((SELECT u.username FROM user01t u WHERE u.email = {column} LIMIT 1), {column})"


def _rows(cursor):
    columns = [column[0] for column in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


def _num(value) -> Decimal:
    try:
        return Decimal(str(value if value not in (None, "") else 0))
    except Exception:
        return ZERO


def can_manage(user: dict) -> bool:
    """통제 설정 · 승인: 통제관리 메뉴 권한이 있는 직원 (플랫폼 관리자 포함)."""
    return (user.get("companyid") == "001" and str(user.get("authority") or "").upper() == "MASTER") \
        or MENU_ID in (user.get("menuids") or ())


def _require_manager(user: dict, what: str = "이 작업"):
    if not can_manage(user):
        raise PermissionError(f"{what}은(는) 통제관리 권한이 있는 직원만 할 수 있습니다.")


def _is_approver(cursor, companyid: str, email: str | None) -> bool:
    cursor.execute(
        """SELECT 1 FROM control_approver01t a
           JOIN user01t u ON u.companyid = a.companyid AND u.email = a.useremail AND UPPER(COALESCE(u.useyn, 'N')) = 'Y'
           WHERE a.companyid = %s AND a.useremail = %s""",
        (companyid, email),
    )
    return cursor.fetchone() is not None


def _require_approver(cursor, user: dict, what: str):
    if not _is_approver(cursor, user["companyid"], user.get("email")):
        raise PermissionError(f"{what}은(는) 통제 설정에서 지정한 승인자만 할 수 있습니다.")


# ── 금액 ─────────────────────────────────────────────────────────
def _price_units(cursor, companyid: str) -> dict:
    cursor.execute(
        "SELECT code, code_name FROM codemaster01t WHERE companyid = %s AND groupcode = 'PRICE_UNIT'",
        (companyid,),
    )
    return {code: name or "" for code, name in cursor.fetchall()}


def _line_amount(line: dict, units: dict) -> Decimal:
    """매입 · 매출 한 줄 공급가: 직접 넣은 공급가가 있으면 그 값, 없으면 저장 때와 같은 단가기준 계산."""
    if str(line.get("supplyamt") or "").strip() not in ("", "0"):
        return _num(line.get("supplyamt"))
    unit = str(line.get("unit") or "").strip()
    token = f"{unit} {units.get(unit, '')}".upper()
    weight, qty, length, price = _num(line.get("weight")), _num(line.get("qty")), _num(line.get("length")), _num(line.get("unitprice"))
    if "TON" in token or "톤" in token:
        basis = weight / Decimal("1000")
    elif "QTY" in token or "수량" in token or token.strip() in {"EA", "PCS", "COUNT"}:
        basis = qty
    elif "LENGTH" in token or "길이" in token or token.strip() in {"M", "METER"}:
        basis = length
    else:
        basis = weight
    return (basis * price).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _payload_amount(cursor, companyid: str, target: str, item: dict) -> Decimal:
    if target == "RECEIPT_PAYMENT":
        keys = ("cashamt", "instrumentamt", "bankamt", "cardamt", "offsetamt")
        return sum((sum((_num(row.get(k)) for k in keys), ZERO) for row in item.get("items") or []), ZERO)
    units = _price_units(cursor, companyid)
    goods = sum((_line_amount(line, units) for line in item.get("items") or []), ZERO)
    expenses = sum((_num(row.get("supplyamt")) for row in item.get("expenses") or []), ZERO)
    return goods + expenses


def _stored_amount(cursor, companyid: str, target: str, receiptno: str) -> Decimal:
    """수정(담당자 · 단가) · 삭제 요청: 저장된 전표의 금액."""
    if target == "INBOUND":
        sql = "SELECT COALESCE(SUM(supplyamt), 0) FROM inbound02t WHERE companyid = %s AND receiptno = %s"
    elif target == "OUTBOUND":
        sql = "SELECT COALESCE(SUM(supplyamt), 0) FROM outbound02t WHERE companyid = %s AND receiptno = %s"
    elif target == "RECEIPT_PAYMENT":
        sql = """SELECT COALESCE(SUM(COALESCE(cashamt, 0) + COALESCE(instrumentamt, 0) + COALESCE(bankamt, 0)
                                   + COALESCE(cardamt, 0) + COALESCE(offsetamt, 0)), 0)
                 FROM receiptpayment02t WHERE companyid = %s AND receiptno = %s"""
    else:
        return ZERO
    cursor.execute(sql, (companyid, receiptno))
    return _num(cursor.fetchone()[0])


# ── 통제 여부 · 요청 ─────────────────────────────────────────────
ACTION_COLUMNS = {"CREATE": ("on_create", "create_min"), "UPDATE": ("on_update", "update_min"), "DELETE": ("on_delete", "delete_min")}


def _policy(cursor, companyid: str, target: str, action: str):
    """(켜짐, 금액 조건). 금액 조건이 있으면 '켜짐 AND 금액 이상'일 때만 승인 대상."""
    on_column, min_column = ACTION_COLUMNS[action]
    cursor.execute(f"SELECT {on_column} = 'Y', {min_column} FROM control_policy01t WHERE companyid = %s AND target = %s", (companyid, target))
    row = cursor.fetchone()
    return (bool(row and row[0]), _num(row[1]) if row and row[1] else ZERO)


def _next_requestno(cursor, companyid: str) -> str:
    cursor.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"approval-request:{companyid}",))
    prefix = f"APR-{datetime.now(KST):%Y%m%d}-"
    cursor.execute(
        """SELECT COALESCE(MAX(CAST(SUBSTRING(requestno FROM %s) AS integer)), 0)
           FROM approval_request01t WHERE companyid = %s AND requestno LIKE %s""",
        (len(prefix) + 1, companyid, f"{prefix}%"),
    )
    return f"{prefix}{cursor.fetchone()[0] + 1:04d}"


def _outbound_reservations(cursor, companyid: str, item: dict) -> list[dict]:
    """매출 요청의 예약 재고. 다른 대기 요청의 예약을 뺀 남은 재고보다 많이 고르면 거절.
    수정 요청이면 이 전표가 이미 쓰고 있는 양은 빼고, 더 쓰는 만큼만 예약한다."""
    need = defaultdict(lambda: [ZERO, ZERO])
    for line in item.get("items") or []:
        key = (str(line.get("stocksourcetype") or ""), str(line.get("stocksourceno") or ""), int(line.get("stocksourceline") or 0))
        need[key][0] += _num(line.get("qty"))
        need[key][1] += _num(line.get("weight"))
    if not need:
        return []
    keys = list(need)
    arrays = ([k[0] for k in keys], [k[1] for k in keys], [k[2] for k in keys])
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
        (*arrays, companyid),
    )
    stock = {(r[0], r[1], int(r[2])): (_num(r[3]), _num(r[4])) for r in cursor.fetchall()}
    cursor.execute(
        """SELECT r.sourcetype, r.sourceno, r.sourceline, SUM(r.qty), SUM(r.weight)
           FROM approval_request01t q
           CROSS JOIN LATERAL jsonb_to_recordset(q.reservations)
                AS r(sourcetype varchar, sourceno varchar, sourceline integer, qty numeric, weight numeric)
           WHERE q.companyid = %s AND q.status IN ('PENDING', 'PROCESSING')
           GROUP BY r.sourcetype, r.sourceno, r.sourceline""",
        (companyid,),
    )
    reserved = {(r[0], r[1], int(r[2])): (_num(r[3]), _num(r[4])) for r in cursor.fetchall()}
    tolerance = Decimal("0.0005")
    result = []
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
        extra_qty, extra_weight = max(qty - own_qty, ZERO), max(weight - own_weight, ZERO)
        if extra_qty > 0 or extra_weight > 0:
            result.append({"sourcetype": key[0], "sourceno": key[1], "sourceline": key[2],
                           "qty": str(extra_qty), "weight": str(extra_weight)})
    return result


def intercept(user: dict, target: str, action: str, op: str, data: dict, summary: str,
              ref_no: str | None = None, dates: list | None = None) -> dict | None:
    """통제가 켜져 있고 금액 기준을 넘으면 승인요청으로 보관하고 응답을 돌려준다. 아니면 None (그대로 저장)."""
    companyid = user["companyid"]
    with _db.connect() as connection, connection.cursor() as cursor:
        on, min_amount = _policy(cursor, companyid, target, action)
        if not on:
            return None
        if _is_approver(cursor, companyid, user.get("email")):
            return None   # 승인자 본인이 저장하면 통제 없이 바로 저장
        amount = None
        if target in AMOUNT_TARGETS:
            item = data.get("item") or {}
            amount = _payload_amount(cursor, companyid, target, item) if op == "save" else _stored_amount(cursor, companyid, target, ref_no or "")
            if min_amount > 0 and amount < min_amount:
                return None   # 금액 기준 미만: 바로 저장
        actor = user.get("email")
        if dates:
            month_close_module.ensure_open(cursor, companyid, dates, ACTION_LABEL[action])
        requestno = _next_requestno(cursor, companyid)
        reservations = _outbound_reservations(cursor, companyid, data.get("item") or {}) if target == "OUTBOUND" and op == "save" else []
        payload = {"companyname": user.get("companyname") or companyid, "data": data}
        cursor.execute(
            """INSERT INTO approval_request01t (companyid, companyname, requestno, target, action, op, ref_no, summary, amount, payload, reservations, created_by)
               VALUES (%s, (SELECT companyname FROM company01t WHERE companyid = %s), %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s)""",
            (companyid, companyid, requestno, target, action, op, ref_no or None, (summary or "")[:500],
             amount.quantize(Decimal("1"), rounding=ROUND_HALF_UP) if amount is not None else None,
             json.dumps(payload, ensure_ascii=False, default=str), json.dumps(reservations), actor),
        )
    return {
        "success": True, "pending_approval": True, "requestno": requestno, "label": f"{TARGET_LABEL[target]} {ACTION_LABEL[action]}",
        "message": f"{TARGET_LABEL[target]} {ACTION_LABEL[action]}을(를) 승인요청했습니다 ({requestno}). 승인되면 반영됩니다.",
    }


# ── 승인 · 반려 · 취소 ───────────────────────────────────────────
def approve(user: dict, requestno: str) -> dict:
    from services.control import executors  # 저장 모듈들을 늦게 불러 순환 참조를 피한다

    companyid, email = user["companyid"], user.get("email")
    with _db.connect() as connection, connection.cursor() as cursor:
        _require_approver(cursor, user, "승인")
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
                """UPDATE approval_request01t SET status = 'PENDING', last_error = %s, updatedat = CURRENT_TIMESTAMP, updated_by = %s
                   WHERE companyid = %s AND requestno = %s""",
                (message[:500], email, companyid, requestno),
            )
        raise ValueError(message) from error
    with _db.connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """UPDATE approval_request01t
               SET status = 'APPROVED', decided_by = %s, decided_at = CURRENT_TIMESTAMP, result_no = %s, reservations = '[]'::jsonb,
                   updatedat = CURRENT_TIMESTAMP, updated_by = %s
               WHERE companyid = %s AND requestno = %s""",
            (email, result_no[:100] or None, email, companyid, requestno),
        )
    return {"success": True, "requestno": requestno, "result_no": result_no, "self_approved": requester == email}


def reject(user: dict, requestno: str, reason: str) -> dict:
    companyid, email = user["companyid"], user.get("email")
    reason = (reason or "").strip()
    if not reason:
        raise ValueError("반려 사유를 입력해 주세요.")
    with _db.connect() as connection, connection.cursor() as cursor:
        _require_approver(cursor, user, "반려")
        cursor.execute(
            """UPDATE approval_request01t
               SET status = 'REJECTED', decided_by = %s, decided_at = CURRENT_TIMESTAMP, reject_reason = %s, reservations = '[]'::jsonb,
                   updatedat = CURRENT_TIMESTAMP, updated_by = %s
               WHERE companyid = %s AND requestno = %s AND status = 'PENDING'""",
            (email, reason[:500], email, companyid, requestno),
        )
        if not cursor.rowcount:
            raise ValueError("대기 중인 요청만 반려할 수 있습니다.")
    return {"success": True, "requestno": requestno}


def cancel(user: dict, requestno: str) -> dict:
    companyid, email = user["companyid"], user.get("email")
    with _db.connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """UPDATE approval_request01t
               SET status = 'CANCELED', decided_by = %s, decided_at = CURRENT_TIMESTAMP, reservations = '[]'::jsonb,
                   updatedat = CURRENT_TIMESTAMP, updated_by = %s
               WHERE companyid = %s AND requestno = %s AND status = 'PENDING' AND created_by = %s""",
            (email, email, companyid, requestno, email),
        )
        if not cursor.rowcount:
            raise ValueError("본인이 요청한 대기 중인 건만 취소할 수 있습니다.")
    return {"success": True, "requestno": requestno}


# ── 조회 ─────────────────────────────────────────────────────────
def summary(user: dict) -> dict:
    """헤더 알림 · 화면 탭: 통제 사용 중인지(켜진 대상이 있거나 요청이 있음), 관리 권한, 대기 건수."""
    companyid, email = user["companyid"], user.get("email")
    with _db.connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """SELECT EXISTS (SELECT 1 FROM control_policy01t WHERE companyid = %s AND 'Y' IN (on_create, on_update, on_delete)),
                      COUNT(*) FILTER (WHERE status = 'PENDING'),
                      COUNT(*) FILTER (WHERE status = 'PENDING' AND created_by = %s),
                      COUNT(*) FILTER (WHERE status = 'REJECTED' AND created_by = %s AND decided_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'),
                      COUNT(*) FILTER (WHERE created_by = %s)
               FROM approval_request01t WHERE companyid = %s""",
            (companyid, email, email, email, companyid),
        )
        active, pending, my_pending, my_rejected, my_total = cursor.fetchone()
        approver = _is_approver(cursor, companyid, email)
        manager = can_manage(user)
        # 알림 창 목록: 승인자 · 관리자 = 대기 중인 요청, 그 밖 = 최근 2주 내 요청 (최근 순 8건)
        if manager or approver:
            cursor.execute(f"""SELECT {_REQUEST_COLUMNS} FROM {_REQUEST_FROM}
                               WHERE q.companyid = %s AND q.status = 'PENDING' ORDER BY q.createdat DESC LIMIT 8""", (companyid,))
        else:
            cursor.execute(f"""SELECT {_REQUEST_COLUMNS} FROM {_REQUEST_FROM}
                               WHERE q.companyid = %s AND q.created_by = %s
                                 AND COALESCE(q.decided_at, q.createdat) >= CURRENT_TIMESTAMP - INTERVAL '14 days'
                               ORDER BY COALESCE(q.decided_at, q.createdat) DESC LIMIT 8""", (companyid, email))
        items = [_decorate(row, email) for row in _rows(cursor)] if (manager or approver or my_total) else []
    return {
        "active": bool(active) or my_total > 0 or approver, "can_manage": manager, "is_approver": approver,
        "pending": pending if (manager or approver) else 0, "my_pending": my_pending, "my_rejected": my_rejected,
        "items": items,
    }


# 이름은 user01t 를 한 번씩만 붙여 읽는다 (행마다 하위 조회를 돌리지 않게)
_REQUEST_COLUMNS = """q.requestno, q.target, q.action, q.op, q.ref_no, q.summary, q.amount, q.status, q.reject_reason, q.last_error,
    q.result_no, q.createdat AS requested_at, q.created_by AS requested_email, COALESCE(ru.username, q.created_by) AS requested_name,
    q.decided_at, q.decided_by AS decided_email, COALESCE(du.username, q.decided_by) AS decided_name"""
_REQUEST_FROM = """approval_request01t q
    LEFT JOIN user01t ru ON ru.companyid = q.companyid AND ru.email = q.created_by
    LEFT JOIN user01t du ON du.companyid = q.companyid AND du.email = q.decided_by"""


def _decorate(row: dict, email: str) -> dict:
    row["target_label"] = TARGET_LABEL.get(row["target"], row["target"])
    row["action_label"] = ACTION_LABEL.get(row["action"], row["action"])
    row["status_label"] = STATUS_LABEL.get(row["status"], row["status"])
    requester = row.pop("requested_email", None)
    decider = row.pop("decided_email", None)
    row["mine"] = requester == email
    row["self_approved"] = row["status"] == "APPROVED" and bool(decider) and decider == requester
    return row


def list_requests(user: dict, scope: str = "inbox", status: str = "", target: str = "", q: str = "",
                  page: int = 1, page_size: int = 30, date_from=None, date_to=None) -> dict:
    companyid, email = user["companyid"], user.get("email")
    where, params = ["q.companyid = %s"], [companyid]
    if scope == "mine":
        where.append("q.created_by = %s")
        params.append(email)
    elif not can_manage(user):
        with _db.connect() as connection, connection.cursor() as cursor:
            _require_approver(cursor, user, "승인함 조회")
    if status:
        where.append("q.status = %s")
        params.append(status.upper())
    if target:
        where.append("q.target = %s")
        params.append(target.upper())
    # 기간: 요청일 (한국시간)
    if date_from:
        where.append("(q.createdat AT TIME ZONE 'Asia/Seoul')::date >= %s")
        params.append(date_from)
    if date_to:
        where.append("(q.createdat AT TIME ZONE 'Asia/Seoul')::date <= %s")
        params.append(date_to)
    if q.strip():
        pattern = f"%{q.strip()}%"
        where.append("(q.requestno ILIKE %s OR q.summary ILIKE %s OR q.ref_no ILIKE %s OR q.result_no ILIKE %s OR ru.username ILIKE %s)")
        params.extend([pattern] * 5)
    where_sql = " AND ".join(where)
    with _db.connect() as connection, connection.cursor() as cursor:
        # 목록과 전체 건수를 한 번에 (COUNT(*) OVER)
        cursor.execute(
            f"""SELECT {_REQUEST_COLUMNS}, COUNT(*) OVER () AS total_count FROM {_REQUEST_FROM} WHERE {where_sql}
                ORDER BY (q.status = 'PENDING') DESC, q.createdat DESC LIMIT %s OFFSET %s""",
            (*params, page_size, (page - 1) * page_size),
        )
        rows = _rows(cursor)
        total = rows[0]["total_count"] if rows else 0
        if not rows and page > 1:
            cursor.execute(f"SELECT COUNT(*) FROM {_REQUEST_FROM} WHERE {where_sql}", params)
            total = cursor.fetchone()[0]
        items = [_decorate({k: v for k, v in row.items() if k != "total_count"}, email) for row in rows]
    return {"items": items, "total": total, "page": page, "page_size": page_size}


def get_request(user: dict, requestno: str) -> dict:
    companyid, email = user["companyid"], user.get("email")
    with _db.connect() as connection, connection.cursor() as cursor:
        approver = _is_approver(cursor, companyid, email)
        manager = can_manage(user) or approver
        cursor.execute(f"SELECT {_REQUEST_COLUMNS}, q.payload, q.reservations FROM {_REQUEST_FROM} WHERE q.companyid = %s AND q.requestno = %s",
                       (companyid, requestno))
        rows = _rows(cursor)
        if not rows:
            raise LookupError("승인요청을 찾을 수 없습니다.")
        item = _decorate(rows[0], email)
        if not (item["mine"] or manager):
            raise PermissionError("이 요청을 볼 권한이 없습니다.")
        payload = item.pop("payload")
        payload = payload if isinstance(payload, dict) else json.loads(payload)
        item["data"] = payload.get("data") or {}
        reservations = item.pop("reservations")
        reservations = reservations if isinstance(reservations, list) else json.loads(reservations or "[]")
        if reservations:
            cursor.execute(
                """SELECT r.sourcetype, r.sourceno, r.sourceline, r.qty, r.weight, s.itemname, s.thickness, s.width, s.length
                   FROM jsonb_to_recordset(%s::jsonb) AS r(sourcetype varchar, sourceno varchar, sourceline integer, qty numeric, weight numeric)
                   LEFT JOIN currentstock01t s ON s.companyid = %s AND s.sourcetype = r.sourcetype
                    AND s.sourceno = r.sourceno AND s.sourceline = r.sourceline
                   ORDER BY r.sourceno, r.sourceline""",
                (json.dumps(reservations), companyid),
            )
            item["reservations"] = _rows(cursor)
        else:
            item["reservations"] = []
    item["can_approve"] = item["status"] == "PENDING" and approver
    item["can_reject"] = item["status"] == "PENDING" and approver
    item["can_cancel"] = item["status"] == "PENDING" and item["mine"]
    return item


# ── 통제 설정 ────────────────────────────────────────────────────
def get_settings(user: dict) -> dict:
    _require_manager(user, "통제 설정 조회")
    companyid = user["companyid"]
    with _db.connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """SELECT p.target, p.on_create, p.create_min, p.on_update, p.update_min, p.on_delete, p.delete_min,
                      COALESCE(p.updatedat, p.createdat) AS changed_at,
                      COALESCE(u.username, p.updated_by, p.created_by) AS changed_by
               FROM control_policy01t p
               LEFT JOIN user01t u ON u.companyid = p.companyid AND u.email = COALESCE(p.updated_by, p.created_by)
               WHERE p.companyid = %s""",
            (companyid,),
        )
        saved = {row["target"]: row for row in _rows(cursor)}
        policies = []
        for key, label in TARGETS:
            row = saved.get(key) or {}
            policies.append({
                "target": key, "label": label, "amount_enabled": key in AMOUNT_TARGETS,
                "on_create": row.get("on_create") == "Y", "on_update": row.get("on_update") == "Y", "on_delete": row.get("on_delete") == "Y",
                "create_min": int(row["create_min"]) if row.get("create_min") else None,
                "update_min": int(row["update_min"]) if row.get("update_min") else None,
                "delete_min": int(row["delete_min"]) if row.get("delete_min") else None,
                "changed_at": row.get("changed_at"), "changed_by": row.get("changed_by"),
            })
        # 사용 중인 직원 전체 + 승인자 체크 (승인자가 위로)
        cursor.execute(
            """SELECT u.email, u.username, u.team, u.position, u.authority, (a.useremail IS NOT NULL) AS approver
               FROM user01t u
               LEFT JOIN control_approver01t a ON a.companyid = u.companyid AND a.useremail = u.email
               WHERE u.companyid = %s AND UPPER(COALESCE(u.useyn, 'N')) = 'Y'
               ORDER BY (a.useremail IS NULL), u.username, u.email""",
            (companyid,),
        )
        users = _rows(cursor)
    return {"policies": policies, "users": users}


def save_settings(user: dict, policies: list[dict], approvers: list[str] | None = None) -> dict:
    _require_manager(user, "통제 설정 변경")
    companyid, actor = user["companyid"], user.get("email")
    with _db.connect() as connection, connection.cursor() as cursor:
        if approvers is not None:
            emails = sorted({str(e or "").strip() for e in approvers if str(e or "").strip()})
            cursor.execute(
                "SELECT email FROM user01t WHERE companyid = %s AND UPPER(COALESCE(useyn, 'N')) = 'Y' AND email = ANY(%s)",
                (companyid, emails),
            )
            valid = [row[0] for row in cursor.fetchall()]
            cursor.execute("DELETE FROM control_approver01t WHERE companyid = %s AND NOT (useremail = ANY(%s))", (companyid, valid))
            for email in valid:
                cursor.execute(
                    """INSERT INTO control_approver01t (companyid, companyname, useremail, created_by)
                       VALUES (%s, (SELECT companyname FROM company01t WHERE companyid = %s), %s, %s)
                       ON CONFLICT (companyid, useremail) DO NOTHING""",
                    (companyid, companyid, email, actor),
                )
        for policy in policies:
            target = str(policy.get("target") or "").upper()
            if target not in TARGET_LABEL:
                continue
            def amount(key):   # 금액 조건: 금액이 있는 대상만, 0 · 빈칸은 조건 없음
                value = policy.get(key) if target in AMOUNT_TARGETS else None
                return int(value) if value not in (None, "") and int(value) > 0 else None
            row = ("Y" if policy.get("on_create") else "N", amount("create_min"),
                   "Y" if policy.get("on_update") else "N", amount("update_min"),
                   "Y" if policy.get("on_delete") else "N", amount("delete_min"))
            cursor.execute(
                """INSERT INTO control_policy01t (companyid, companyname, target, on_create, create_min, on_update, update_min,
                                                  on_delete, delete_min, created_by)
                   VALUES (%s, (SELECT companyname FROM company01t WHERE companyid = %s), %s, %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (companyid, target) DO UPDATE
                   SET on_create = EXCLUDED.on_create, create_min = EXCLUDED.create_min,
                       on_update = EXCLUDED.on_update, update_min = EXCLUDED.update_min,
                       on_delete = EXCLUDED.on_delete, delete_min = EXCLUDED.delete_min,
                       updatedat = CURRENT_TIMESTAMP, updated_by = %s
                   WHERE (control_policy01t.on_create, control_policy01t.create_min, control_policy01t.on_update, control_policy01t.update_min,
                          control_policy01t.on_delete, control_policy01t.delete_min)
                         IS DISTINCT FROM (EXCLUDED.on_create, EXCLUDED.create_min, EXCLUDED.on_update, EXCLUDED.update_min,
                                           EXCLUDED.on_delete, EXCLUDED.delete_min)""",
                (companyid, companyid, target, *row, actor, actor),
            )
    return get_settings(user)
