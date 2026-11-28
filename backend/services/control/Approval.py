"""승인 통제 (어드민 › 통제관리).

담당자가 거래처 · 매입 · 매출 · 수금/지급을 등록 · 수정 · 삭제할 때, 그 대상 · 동작이 통제로 켜져 있고 금액 기준을 넘으면
바로 저장하지 않고 승인요청(approval_request01t)으로 보관한다. 승인자가 승인하면 보관한 입력 내용을
기존 저장 로직(executors)에 그대로 넘겨 전표 · 거래처를 만든다. 재고 · 원장 · 매출이익 같은 조회는 바꾸지 않는다.

  - 무엇을 승인받을지: control_policy01t (대상 × 등록 · 수정 · 삭제, 금액 기준)
  - 메뉴권한 '통제관리'(CONTROL_MANAGEMENT): 통제관리 화면에 들어와 설정을 바꾸는 권한
  - 승인자: 통제 설정에서 체크한 직원(control_approver01t)만 승인 · 반려. 본인 요청도 승인할 수 있다.
  - 매출 요청의 재고: 요청 한 건의 reservations 에 예약 → 재고 선택 창에서 다른 사람이 못 고름 (대기 중일 때만)
  - 매입 수정 · 삭제 요청: 그 매입에서 생긴 재고를 통째로 예약 (승인 전에 팔리거나 옮겨져 승인이 실패하지 않게)
  - 처리 기록: 요청 한 줄에 요청자 · 시각, 처리자 · 시각, 반려 사유, 마지막 승인 실패 사유가 남는다
  - 요청번호: 회사명-년도-00001 (회사 · 년도(KST)별 일련번호)
  - 빈틈 막기
      · 대기 중인 요청이 걸린 전표 · 거래처는 승인 · 반려 · 취소 전까지 누구도(승인자 포함) 다시 수정 · 삭제할 수 없다
      · 예약 재고: 재고 선택 창에서 못 고르고, 매출 저장은 서버에서 다시 막고, 그 밖의 재고 감소(재고이동 · 가공 · 매입
        수정/삭제 등)는 DB 트리거(fn_check_stock_reservation)가 커밋 때 막는다
      · 승인 = 요청 상태 변경 + 실제 저장을 한 트랜잭션으로 (db.shared_transaction) → 반쯤 처리된 상태가 남지 않는다
      · 승인자가 한 명도 없으면 통제 없이 바로 저장한다 (승인자가 한 명이라도 있으면 승인요청)
  - 여신 통제 (control_policy01t target='CREDIT', on_create 칸을 켜기로 씀)
      · 매출 등록 · 수정 · 단가 수정 때, 거래처 여신한도(customer01t.creditlimit, 공급가)가 있으면
        미수 잔액(거래처원장과 같은 계산) + 대기 중인 그 거래처 매출요청 + 이번 매출 > 한도 → 승인요청
      · 한도가 없는 거래처는 통과. 같은 거래처를 동시에 저장하면 순서대로 (거래처 잠금 + 확인과 저장을 한 트랜잭션)
"""
import json
from collections import defaultdict
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal
from zoneinfo import ZoneInfo

import db as _db
from services.closing import MonthClose as month_close_module
from services.control import reservation as reservation_module

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


def _won_text(value) -> str:
    """1,000,000 → '100만원', 120,000,000 → '1억 2,000만원', 35,000 → '3만 5,000원', 9,000 → '9,000원'."""
    amount = int(_num(value).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    if amount < 10000:
        return f"{amount:,}원"
    eok, man, rest = amount // 100000000, (amount % 100000000) // 10000, amount % 10000
    parts = ([f"{eok:,}억"] if eok else []) + ([f"{man:,}만"] if man else []) + ([f"{rest:,}"] if rest and not eok else [])
    return " ".join(parts) + "원"


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
    if _num(line.get("supplyamt")) != 0:
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


def _payload_amounts(cursor, companyid: str, target: str, item: dict) -> tuple[Decimal, Decimal]:
    """(물품 공급가, 기타비용 공급가). 매입 · 매출은 둘을 더한 금액으로 통제한다. 수금/지급은 (결제액, 0)."""
    if target == "RECEIPT_PAYMENT":
        keys = ("cashamt", "instrumentamt", "bankamt", "cardamt", "offsetamt")
        return sum((sum((_num(row.get(k)) for k in keys), ZERO) for row in item.get("items") or []), ZERO), ZERO
    units = _price_units(cursor, companyid)
    goods = sum((_line_amount(line, units) for line in item.get("items") or []), ZERO)
    expenses = sum((_num(row.get("supplyamt")) for row in item.get("expenses") or []), ZERO)
    return goods, expenses


def _stored_amounts(cursor, companyid: str, target: str, receiptno: str) -> tuple[Decimal, Decimal]:
    """수정(담당자 · 단가) · 삭제 요청: 저장된 전표의 (물품 공급가, 기타비용 공급가)."""
    if target in ("INBOUND", "OUTBOUND"):
        table = "inbound" if target == "INBOUND" else "outbound"
        cursor.execute(
            f"""SELECT (SELECT COALESCE(SUM(supplyamt), 0) FROM {table}02t WHERE companyid = %s AND receiptno = %s),
                       (SELECT COALESCE(SUM(supplyamt), 0) FROM {table}03t WHERE companyid = %s AND receiptno = %s)""",
            (companyid, receiptno, companyid, receiptno),
        )
        goods, expenses = cursor.fetchone()
        return _num(goods), _num(expenses)
    if target == "RECEIPT_PAYMENT":
        cursor.execute(
            """SELECT COALESCE(SUM(COALESCE(cashamt, 0) + COALESCE(instrumentamt, 0) + COALESCE(bankamt, 0)
                                   + COALESCE(cardamt, 0) + COALESCE(offsetamt, 0)), 0)
               FROM receiptpayment02t WHERE companyid = %s AND receiptno = %s""",
            (companyid, receiptno),
        )
        return _num(cursor.fetchone()[0]), ZERO
    return ZERO, ZERO


# ── 통제 여부 · 요청 ─────────────────────────────────────────────
ACTION_COLUMNS = {"CREATE": ("on_create", "create_min"), "UPDATE": ("on_update", "update_min"), "DELETE": ("on_delete", "delete_min")}


def _policy(cursor, companyid: str, target: str, action: str):
    """(켜짐, 금액 조건). 금액 조건이 있으면 '켜짐 AND 금액 이상'일 때만 승인 대상."""
    on_column, min_column = ACTION_COLUMNS[action]
    cursor.execute(f"SELECT {on_column} = 'Y', {min_column} FROM control_policy01t WHERE companyid = %s AND target = %s", (companyid, target))
    row = cursor.fetchone()
    return (bool(row and row[0]), _num(row[1]) if row and row[1] else ZERO)


def _next_requestno(cursor, companyid: str) -> str:
    """회사명-년도-00001. 회사명 안의 공백은 뺀다 (예: 대일스틸-2026-00001). 년도가 바뀌면 00001 부터."""
    cursor.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"approval-request:{companyid}",))
    cursor.execute("SELECT companyname FROM company01t WHERE companyid = %s", (companyid,))
    row = cursor.fetchone()
    name = "".join(str((row and row[0]) or companyid).split())[:100] or companyid
    prefix = f"{name}-{datetime.now(KST):%Y}-"
    cursor.execute(
        """SELECT COALESCE(MAX(CAST(SUBSTRING(requestno FROM %s) AS integer)), 0)
           FROM approval_request01t
           WHERE companyid = %s AND createdat >= make_timestamptz(%s, 1, 1, 0, 0, 0, 'Asia/Seoul') - INTERVAL '1 day'
             AND LEFT(requestno, %s) = %s AND SUBSTRING(requestno FROM %s) ~ '^[0-9]+$'""",
        (len(prefix) + 1, companyid, datetime.now(KST).year, len(prefix), prefix, len(prefix) + 1),
    )
    return f"{prefix}{cursor.fetchone()[0] + 1:05d}"


def _outbound_reservations(cursor, companyid: str, item: dict) -> list[dict]:
    """매출 요청의 예약 재고. 다른 대기 요청의 예약을 뺀 남은 재고보다 많이 고르면 거절.
    수정 요청이면 이 전표가 이미 쓰고 있는 양은 빼고, 더 쓰는 만큼만 예약한다."""
    need = defaultdict(lambda: [ZERO, ZERO])
    for line in item.get("items") or []:
        key = (str(line.get("stocksourcetype") or "").strip().upper(), str(line.get("stocksourceno") or "").strip(),
               int(line.get("stocksourceline") or 0))
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
            """SELECT UPPER(stocksourcetype), stocksourceno, stocksourceline, SUM(qty), SUM(weight)
               FROM outbound02t WHERE companyid = %s AND receiptno = %s
               GROUP BY 1, 2, 3""",
            (companyid, receiptno),
        )
        own = {(r[0], r[1], int(r[2])): (_num(r[3]), _num(r[4])) for r in cursor.fetchall()}
    # 재고 행을 잠근다: 같은 재고를 동시에 저장 · 요청하는 일이 순서대로 처리된다
    cursor.execute(
        """SELECT UPPER(s.sourcetype), s.sourceno, s.sourceline, COALESCE(s.qty, 0), COALESCE(s.weight, 0)
           FROM currentstock01t s
           JOIN unnest(%s::varchar[], %s::varchar[], %s::integer[]) AS k(t, n, l)
             ON UPPER(s.sourcetype) = k.t AND s.sourceno = k.n AND s.sourceline = k.l
           WHERE s.companyid = %s
           ORDER BY 1, 2, 3
           FOR UPDATE OF s""",
        (*arrays, companyid),
    )
    stock = {(r[0], r[1], int(r[2])): (_num(r[3]), _num(r[4])) for r in cursor.fetchall()}
    taken = reservation_module.reserved_by_others(cursor, companyid, keys)
    tolerance = Decimal("0.0005")
    result = []
    for key, (qty, weight) in need.items():
        own_qty, own_weight = own.get(key, (ZERO, ZERO))
        stock_qty, stock_weight = stock.get(key, (ZERO, ZERO))
        # 다른 요청이 예약한 재고는 새로 쓸 수 없다 (전표가 원래 쓰던 양까지는 그대로 둘 수 있음)
        if key in taken and (qty > own_qty + tolerance or weight > own_weight + tolerance):
            raise ValueError(f"재고 {key[1]} / 순번 {key[2]}은(는) 승인 대기 중인 요청({taken[key]})에 예약되어 있어 선택할 수 없습니다.")
        free_weight, free_qty = stock_weight + own_weight, stock_qty + own_qty
        if weight > free_weight + tolerance or (qty > free_qty + tolerance and free_qty > 0):
            raise ValueError(f"재고 {key[1]} / 순번 {key[2]}: 남은 재고가 부족합니다 (선택할 수 있는 중량 {max(free_weight, ZERO):,.3f}kg).")
        extra_qty, extra_weight = max(qty - own_qty, ZERO), max(weight - own_weight, ZERO)
        if extra_qty > 0 or extra_weight > 0:
            result.append({"sourcetype": key[0], "sourceno": key[1], "sourceline": key[2],
                           "qty": str(extra_qty), "weight": str(extra_weight)})
    return result


def _has_approver(cursor, companyid: str) -> bool:
    cursor.execute(
        """SELECT 1 FROM control_approver01t a
           JOIN user01t u ON u.companyid = a.companyid AND u.email = a.useremail AND UPPER(COALESCE(u.useyn, 'N')) = 'Y'
           WHERE a.companyid = %s LIMIT 1""",
        (companyid,),
    )
    return cursor.fetchone() is not None


def _credit_on(cursor, companyid: str) -> bool:
    cursor.execute("SELECT on_create = 'Y' FROM control_policy01t WHERE companyid = %s AND target = 'CREDIT'", (companyid,))
    row = cursor.fetchone()
    return bool(row and row[0])


def _sales_credit_amount(cursor, companyid: str, receiptno: str, price_changes: dict | None = None) -> Decimal:
    """저장된 매출전표의 여신 금액 (공급가 + 매출처 부담 기타비용). price_changes={순번: 새 단가} 면 바뀐 단가로 다시 계산."""
    from services.outbound import OutboundRegister as outbound_module   # 순환 참조 방지

    cursor.execute(
        "SELECT lineno, qty, weight, length, unit, unitprice, supplyamt FROM outbound02t WHERE companyid = %s AND receiptno = %s",
        (companyid, receiptno),
    )
    lines = cursor.fetchall()
    unit_codes = {}
    if price_changes:
        cursor.execute("SELECT code, code_name FROM codemaster01t WHERE companyid = %s AND groupcode = 'PRICE_UNIT'", (companyid,))
        for code, code_name in cursor.fetchall():
            code, code_name = str(code or "").strip(), str(code_name or "").strip()
            if code_name:
                unit_codes.setdefault(code_name, code)
            if code:
                unit_codes.setdefault(code, code)
    goods = ZERO
    for lineno, qty, weight, length, unit, old_price, supply in lines:
        new_price = (price_changes or {}).get(int(lineno))
        if new_price is None or (old_price is not None and _num(old_price) == _num(new_price)):
            goods += _num(supply)
            continue
        unit_name = str(unit or "").strip()
        goods += outbound_module._calculate_unit_amount(
            _num(weight), _num(new_price), unit_codes.get(unit_name, unit_name), unit_name, qty=_num(qty), length=_num(length))
    cursor.execute(
        """SELECT COALESCE(SUM(supplyamt), 0) FROM outbound03t
           WHERE companyid = %s AND receiptno = %s AND UPPER(COALESCE(purchaseyn, 'N')) <> 'Y'""",
        (companyid, receiptno),
    )
    return goods + _num(cursor.fetchone()[0])


def _credit_check(cursor, companyid: str, op: str, data: dict, ref_no: str | None) -> dict | None:
    """여신 한도 확인. 한도가 없는 거래처면 None. 결과: 한도 · 미수 잔액 · 대기 중 매출요청 · 이번 매출 · 합계 · 초과액."""
    from services.receiptpayment import CustomerLedger as ledger_module

    item = data.get("item") or {}
    code = ""
    if op == "save":
        code = str(item.get("customcode") or "").strip()
        if not code and str(item.get("customname") or "").strip():
            cursor.execute(
                """SELECT customercode FROM customer01t WHERE companyid = %s AND LOWER(BTRIM(customername)) = LOWER(BTRIM(%s))
                   AND UPPER(BTRIM(COALESCE(useyn, 'Y'))) = 'Y' LIMIT 2""",
                (companyid, item.get("customname")),
            )
            rows = cursor.fetchall()
            code = rows[0][0] if len(rows) == 1 else ""
    elif ref_no:
        cursor.execute("SELECT customcode FROM outbound01t WHERE companyid = %s AND receiptno = %s", (companyid, ref_no))
        row = cursor.fetchone()
        code = str((row and row[0]) or "").strip()
    if not code:
        return None
    # 같은 거래처의 매출 저장 · 요청을 한 줄로 세운다 (확인과 저장이 같은 트랜잭션이라 동시에 한도를 넘지 못함)
    cursor.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"credit:{companyid}:{code}",))
    cursor.execute("SELECT customername, creditlimit FROM customer01t WHERE companyid = %s AND customercode = %s", (companyid, code))
    row = cursor.fetchone()
    limit = _num(row[1]) if row and row[1] is not None else ZERO
    if limit <= 0:
        return None
    existing = ref_no or None   # 수정 · 단가 수정: 그 전표의 지금 금액은 빼고 새 금액으로 본다 (등록은 ref_no 없음)
    if op == "save":
        units = _price_units(cursor, companyid)
        this = sum((_line_amount(line, units) for line in item.get("items") or []), ZERO) + sum(
            (_num(exp.get("supplyamt")) for exp in item.get("expenses") or [] if str(exp.get("purchaseyn") or "N").strip().upper() != "Y"), ZERO)
    else:   # 단가 수정
        prices = {int(p.get("lineno")): p.get("unitprice") for p in (item.get("prices") or []) if p.get("lineno") is not None}
        this = _sales_credit_amount(cursor, companyid, ref_no, prices)
    old = _sales_credit_amount(cursor, companyid, existing) if existing else ZERO
    balance = ledger_module.receivable_balance(cursor, companyid, code, exclude_docno=existing)
    # 대기 중인 같은 거래처 매출요청 (수정 요청은 늘어나는 만큼만)
    cursor.execute(
        """SELECT COALESCE(SUM(COALESCE(NULLIF(q.payload#>>'{credit,delta}', '')::numeric, q.amount, 0)), 0)
           FROM approval_request01t q
           WHERE q.companyid = %s AND q.target = 'OUTBOUND' AND q.op IN ('save', 'sales_fields') AND q.status IN ('PENDING', 'PROCESSING')
             AND COALESCE(q.payload#>>'{credit,customcode}', q.payload#>>'{data,item,customcode}') = %s
             AND q.requestno IS DISTINCT FROM NULLIF(current_setting('mosco.approval_request', true), '')""",
        (companyid, code),
    )
    pending = _num(cursor.fetchone()[0])
    used = balance + pending + this
    q0 = lambda v: str(v.quantize(Decimal("1"), rounding=ROUND_HALF_UP))   # noqa: E731
    return {"customcode": code, "customname": (row and row[0]) or "", "limit": q0(limit), "balance": q0(balance),
            "pending": q0(pending), "this": q0(this), "delta": q0(this - old), "used": q0(used),
            "over": q0(max(used - limit, ZERO)), "is_over": used > limit}


def _lines_and_weight(cursor, companyid: str, target: str, op: str, data: dict, ref_no: str | None):
    """목록의 건수 · 중량. 입력 내용에서 세고, 번호만 오는 요청(삭제 · 담당자 변경 등)은 저장된 전표에서 센다."""
    item = data.get("item") or {}
    if target == "CUSTOMER":
        rows = data.get("items")
        return (len(rows) if rows else 1), None
    if op == "save":
        lines = item.get("items") or []
        weight = sum((_num(line.get("weight")) for line in lines), ZERO) if target in ("INBOUND", "OUTBOUND") else None
        return len(lines), weight
    table = {"INBOUND": "inbound02t", "OUTBOUND": "outbound02t", "RECEIPT_PAYMENT": "receiptpayment02t"}.get(target)
    if not table or not ref_no:
        return None, None
    weight_sql = "COALESCE(SUM(weight), 0)" if target != "RECEIPT_PAYMENT" else "NULL"
    cursor.execute(f"SELECT COUNT(*), {weight_sql} FROM {table} WHERE companyid = %s AND receiptno = %s", (companyid, ref_no))
    count, weight = cursor.fetchone()
    return int(count or 0), (_num(weight) if weight is not None else None)


_HEADER_TABLE = {"INBOUND": ("inbound01t", "receptdate"), "OUTBOUND": ("outbound01t", "receptdate"),
                 "RECEIPT_PAYMENT": ("receiptpayment01t", "receiptdate")}

# ── 수정 요청: 무엇을 바꾸는지 (변경 전 → 변경 후) ─────────────────────────
_CUSTOMER_FIELDS = [
    ("customername", "거래처명"), ("tradetype", "거래구분"), ("ownertype", "사업자유형"), ("businessno", "사업자번호"),
    ("corporationno", "법인번호"), ("ceoname", "대표자"), ("businesstype", "업태"), ("industry", "업종"),
    ("manager", "업체 담당자"), ("phone", "전화"), ("fax", "팩스"), ("email", "이메일"), ("zipcode", "우편번호"),
    ("address", "주소"), ("address2", "상세주소"), ("bankcode", "은행"), ("accountno", "계좌번호"), ("useyn", "사용여부"),
    ("remark", "비고"), ("openingreceivable", "기초 미수금"), ("openingpayable", "기초 미지급금"), ("creditlimit", "여신한도"),
]
_MONEY_FIELDS = {"openingreceivable", "openingpayable", "creditlimit"}
_RP_KEYS = [("cashamt", "현금"), ("instrumentamt", "어음/수표"), ("bankamt", "은행"), ("cardamt", "카드"),
            ("offsetamt", "상계"), ("lossamt", "잡손실"), ("chargeamt", "수수료")]


def _fmt_num(value, digits: int = 3) -> str:
    number = _num(value)
    text = f"{number:,.{digits}f}".rstrip("0").rstrip(".") if digits else f"{number:,.0f}"
    return text or "0"


def _same(before, after) -> bool:
    if isinstance(before, (int, float, Decimal)) or isinstance(after, (int, float, Decimal)):
        return _num(before) == _num(after)
    return str(before or "").strip() == str(after or "").strip()


def _change(label: str, before, after) -> dict:
    blank = lambda v: v if str(v if v is not None else "").strip() else "(없음)"   # noqa: E731
    return {"label": label, "before": blank(before), "after": blank(after)}


def _line_text(qty, weight, price) -> str:
    return f"{_fmt_num(qty, 0)}개 · {_fmt_num(weight, 1)}kg · 단가 {_fmt_num(price, 0)}"


def _spec_text(thickness, width, length) -> str:
    parts = [_fmt_num(v, 3 if i == 0 else 0) for i, v in enumerate((thickness, width, length)) if _num(v) > 0]
    return " × ".join(parts)


def _customer_changes(cursor, companyid: str, data: dict) -> list[dict]:
    item = data.get("item") or {}
    cursor.execute("SELECT * FROM customer01t WHERE companyid = %s AND customercode = %s", (companyid, item.get("customercode")))
    row = cursor.fetchone()
    if not row:
        return []
    old = dict(zip([d[0] for d in cursor.description], row))
    new = {**item, "useyn": "N" if str(item.get("useryn") or "").strip().upper() in {"N", "미사용", "사용중지"} else "Y"}
    banks = {}
    if not _same(old.get("bankcode"), new.get("bankcode")):
        cursor.execute("SELECT code, code_name FROM codemaster01t WHERE companyid = %s AND groupcode = 'BANK'", (companyid,))
        banks = {code: name for code, name in cursor.fetchall()}
    show = {
        "ownertype": lambda v: {"CORP": "법인사업자", "INDIV": "개인사업자"}.get(str(v or "").upper(), v),
        "useyn": lambda v: "사용중지" if str(v or "").upper() == "N" else "사용중",
        "bankcode": lambda v: banks.get(v, v),
    }
    changes = []
    for key, label in _CUSTOMER_FIELDS:
        before, after = old.get(key), new.get(key)
        if key in _MONEY_FIELDS:
            if _num(before) == _num(after):
                continue
            changes.append(_change(label, _fmt_num(before, 0) + "원" if _num(before) else "", _fmt_num(after, 0) + "원" if _num(after) else ""))
        elif not _same(before, after):
            fn = show.get(key, lambda v: v)
            changes.append(_change(label, fn(before), fn(after)))
    return changes


def _document_changes(cursor, companyid: str, target: str, data: dict, ref_no: str) -> list[dict]:
    """매입 · 매출 · 수금/지급 전표 수정: 머리 칸 + 품목 줄(추가 · 삭제 · 수량/중량/단가) + 합계."""
    item = data.get("item") or {}
    header = {"INBOUND": ("inbound01t", "receptdate", ["manager", "description"]),
              "OUTBOUND": ("outbound01t", "receptdate", ["manager", "destination", "description"]),
              "RECEIPT_PAYMENT": ("receiptpayment01t", "receiptdate", ["manager", "description"])}[target]
    table, date_col, cols = header
    cursor.execute(f"SELECT {date_col}, {', '.join(cols)} FROM {table} WHERE companyid = %s AND receiptno = %s", (companyid, ref_no))
    row = cursor.fetchone()
    if not row:
        return []
    labels = {"manager": "담당자", "destination": "착지", "description": "비고"}
    changes = []
    old_date, new_date = str(row[0] or "")[:10], str(item.get(date_col) or "")[:10]
    if old_date != new_date:
        changes.append(_change("일자", old_date, new_date))
    for col, value in zip(cols, row[1:]):
        if col in item and not _same(value, item.get(col)):
            changes.append(_change(labels[col], value, item.get(col)))

    if target == "RECEIPT_PAYMENT":
        cursor.execute(
            f"SELECT {', '.join(f'COALESCE(SUM({k}), 0)' for k, _ in _RP_KEYS)} FROM receiptpayment02t WHERE companyid = %s AND receiptno = %s",
            (companyid, ref_no),
        )
        old_sums = cursor.fetchone()
        for (key, label), before in zip(_RP_KEYS, old_sums):
            after = sum((_num(line.get(key)) for line in item.get("items") or []), ZERO)
            if _num(before) != after:
                changes.append(_change(label, _fmt_num(before, 0) + "원", _fmt_num(after, 0) + "원"))
        return changes

    detail = "inbound02t" if target == "INBOUND" else "outbound02t"
    src_cols = "stocksourcetype, stocksourceno, stocksourceline" if target == "OUTBOUND" else "NULL, NULL, NULL"
    cursor.execute(
        f"""SELECT lineno, itemname, thickness, width, length, qty, weight, unitprice, {src_cols}
            FROM {detail} WHERE companyid = %s AND receiptno = %s ORDER BY lineno""",
        (companyid, ref_no),
    )
    old_lines = cursor.fetchall()
    new_lines = item.get("items") or []
    if target == "OUTBOUND":
        # 매출: 원천 재고(전표번호 · 순번)로 줄을 맞춘다
        old_map = {(str(r[8] or "").upper(), str(r[9] or ""), int(r[10] or 0)): r for r in old_lines}
        new_map = {}
        for line in new_lines:
            key = (str(line.get("stocksourcetype") or "").strip().upper(), str(line.get("stocksourceno") or "").strip(),
                   int(line.get("stocksourceline") or 0))
            new_map[key] = line
        missing = [k for k in new_map if k not in old_map]
        names = {}
        if missing:
            cursor.execute(
                """SELECT UPPER(sourcetype), sourceno, sourceline, itemname, thickness, width, length FROM currentstock01t
                   WHERE companyid = %s AND (UPPER(sourcetype), sourceno, sourceline) IN
                         (SELECT * FROM unnest(%s::varchar[], %s::varchar[], %s::integer[]))""",
                (companyid, [k[0] for k in missing], [k[1] for k in missing], [k[2] for k in missing]),
            )
            names = {(t, n, int(l)): (name, th, wd, ln) for t, n, l, name, th, wd, ln in cursor.fetchall()}
        for key in list(old_map) + [k for k in new_map if k not in old_map]:
            old, new = old_map.get(key), new_map.get(key)
            name, th, wd, ln = (old[1], old[2], old[3], old[4]) if old else names.get(key, ("", None, None, None))
            label = " ".join(x for x in (name or f"{key[1]} · {key[2]}", _spec_text(th, wd, ln)) if x)
            before = _line_text(old[5], old[6], old[7]) if old else "(없음)"
            after = _line_text(new.get("qty"), new.get("weight"), new.get("unitprice")) if new else "(삭제)"
            if not old or not new or before != after:
                changes.append(_change(label, before, after))
    else:
        # 매입: 줄 순서대로 비교 (품목이 바뀌면 품목까지 보여 준다)
        for index in range(max(len(old_lines), len(new_lines))):
            old = old_lines[index] if index < len(old_lines) else None
            new = new_lines[index] if index < len(new_lines) else None
            describe = lambda name, th, wd, ln, q, w, pr: " ".join(x for x in (name or "", _spec_text(th, wd, ln)) if x) + " · " + _line_text(q, w, pr)   # noqa: E731
            before = describe(*old[1:8]) if old else "(없음)"
            after = describe(new.get("itemname"), new.get("thickness"), new.get("width"), new.get("length"),
                             new.get("qty"), new.get("weight"), new.get("unitprice")) if new else "(삭제)"
            if before != after:
                changes.append(_change(f"{index + 1}행", before, after))

    goods_before, exp_before = _stored_amounts(cursor, companyid, target, ref_no)
    goods_after, exp_after = _payload_amounts(cursor, companyid, target, item)
    if (goods_before + exp_before).quantize(Decimal("1")) != (goods_after + exp_after).quantize(Decimal("1")):
        changes.append(_change("금액 합계", _fmt_num(goods_before + exp_before, 0) + "원", _fmt_num(goods_after + exp_after, 0) + "원"))
    return changes


def _compute_changes(cursor, companyid: str, target: str, op: str, action: str, data: dict, ref_no: str | None) -> list[dict]:
    """수정 요청의 변경 내용. 등록 · 삭제는 비어 있다."""
    if action != "UPDATE" or not ref_no:
        return []
    if target == "CUSTOMER":
        return _customer_changes(cursor, companyid, data)
    if op == "save":
        return _document_changes(cursor, companyid, target, data, ref_no)
    if op in ("manager", "sales_fields"):
        table = {"INBOUND": "inbound01t", "OUTBOUND": "outbound01t"}.get(target)
        cols = "manager, destination" if target == "OUTBOUND" else "manager, NULL"
        cursor.execute(f"SELECT {cols} FROM {table} WHERE companyid = %s AND receiptno = %s", (companyid, ref_no))
        row = cursor.fetchone() or (None, None)
        item = data.get("item") or {}
        new_manager = data.get("manager") if op == "manager" else item.get("manager")
        changes = []
        if new_manager is not None and not _same(row[0], new_manager):
            changes.append(_change("담당자", row[0], new_manager))
        if op == "sales_fields":
            if item.get("destination") is not None and not _same(row[1], item.get("destination")):
                changes.append(_change("착지", row[1], item.get("destination")))
            prices = {int(p.get("lineno")): p.get("unitprice") for p in item.get("prices") or [] if p.get("lineno") is not None}
            if prices:
                cursor.execute(
                    """SELECT lineno, itemname, thickness, width, length, unitprice FROM outbound02t
                       WHERE companyid = %s AND receiptno = %s AND lineno = ANY(%s) ORDER BY lineno""",
                    (companyid, ref_no, list(prices)),
                )
                for lineno, name, th, wd, ln, old_price in cursor.fetchall():
                    if _num(old_price) != _num(prices[int(lineno)]):
                        label = " ".join(x for x in (f"{lineno}행 {name or ''}".strip(), _spec_text(th, wd, ln)) if x) + " 단가"
                        changes.append(_change(label, _fmt_num(old_price, 0), _fmt_num(prices[int(lineno)], 0)))
                before = _sales_credit_amount(cursor, companyid, ref_no)
                after = _sales_credit_amount(cursor, companyid, ref_no, prices)
                if before.quantize(Decimal("1")) != after.quantize(Decimal("1")):
                    changes.append(_change("금액 합계", _fmt_num(before, 0) + "원", _fmt_num(after, 0) + "원"))
        return changes
    return []


def _party_and_date(cursor, companyid: str, target: str, op: str, data: dict, ref_no: str | None) -> tuple[str, str]:
    """목록에 보여 줄 (거래처, 전표일자). 입력 내용에서 읽고, 삭제 · 담당자 변경처럼 번호만 오면 저장된 전표에서 읽는다."""
    item = data.get("item") or {}
    if target == "CUSTOMER":
        rows = data.get("items") or []
        if rows:
            first = str(rows[0].get("customername") or "")
            return (f"{first} 외 {len(rows) - 1}곳" if len(rows) > 1 else first), ""
        return str(item.get("customername") or ""), ""
    if op == "save":
        lines = item.get("items") or []
        party = item.get("customname") or (lines[0].get("customname") if lines else "") or ""
        return str(party), str(item.get("receptdate") or item.get("receiptdate") or "")[:10]
    table = _HEADER_TABLE.get(target)
    if table and ref_no:
        cursor.execute(f"SELECT customname, {table[1]} FROM {table[0]} WHERE companyid = %s AND receiptno = %s", (companyid, ref_no))
        row = cursor.fetchone()
        if row:
            return str(row[0] or ""), str(row[1] or "")[:10]
    return "", ""


def _ensure_exists(cursor, companyid: str, target: str, ref_no: str):
    """수정 · 삭제 대상이 실제로 있는지 (없으면 승인요청을 만들지 않고 바로 알려 준다)."""
    if target == "CUSTOMER":
        cursor.execute("SELECT 1 FROM customer01t WHERE companyid = %s AND customercode = %s", (companyid, ref_no))
        missing = "거래처를 찾을 수 없습니다."
    else:
        table = _HEADER_TABLE.get(target, (None,))[0]
        if not table:
            return
        cursor.execute(f"SELECT 1 FROM {table} WHERE companyid = %s AND receiptno = %s", (companyid, ref_no))
        missing = f"전표 {ref_no}을(를) 찾을 수 없습니다. 목록을 새로고침해 주세요."
    if cursor.fetchone() is None:
        raise ValueError(missing)


def ensure_no_pending(cursor, companyid: str, target: str, ref_no: str):
    """이 전표 · 거래처에 대기 중인 승인요청이 있으면 막는다 (승인 실행 중인 그 요청 자신은 제외)."""
    cursor.execute(
        """SELECT requestno FROM approval_request01t
           WHERE companyid = %s AND target = %s AND ref_no = %s AND status IN ('PENDING', 'PROCESSING')
             AND requestno IS DISTINCT FROM NULLIF(current_setting('mosco.approval_request', true), '')
           ORDER BY createdat LIMIT 1""",
        (companyid, target, ref_no),
    )
    row = cursor.fetchone()
    if row:
        raise ValueError(f"{ref_no}은(는) 승인 대기 중인 요청({row[0]})이 있어 수정 · 삭제할 수 없습니다. 요청이 처리된 뒤 다시 시도해 주세요.")


def assert_no_pending(user: dict, target: str, ref_nos) -> None:
    """통제 화면 밖에서 같은 전표 · 거래처를 바꾸는 기능(증권 처리 · 기초잔액 반영 등)도 대기 중인 요청이 있으면 막는다."""
    codes = sorted({str(code or "").strip() for code in ([ref_nos] if isinstance(ref_nos, str) else ref_nos) if str(code or "").strip()})
    if not codes:
        return
    with _db.connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """SELECT ref_no, requestno FROM approval_request01t
               WHERE companyid = %s AND target = %s AND ref_no = ANY(%s) AND status IN ('PENDING', 'PROCESSING')
               ORDER BY createdat LIMIT 1""",
            (user["companyid"], target, codes),
        )
        row = cursor.fetchone()
    if row:
        raise ValueError(f"{row[0]}은(는) 승인 대기 중인 요청({row[1]})이 있어 바꿀 수 없습니다. 요청이 처리된 뒤 다시 시도해 주세요.")


def _inbound_reservations(cursor, companyid: str, receiptno: str) -> list[dict]:
    """매입 수정 · 삭제 요청: 그 매입에서 생긴 재고를 남은 양 그대로 예약한다 (요청이 끝날 때까지 매출 · 이동 · 가공에서 못 씀).
    이미 다른 승인요청(매출 등)이 이 재고를 예약했으면 승인 때 실패하므로 요청을 받지 않는다."""
    cursor.execute(
        """SELECT UPPER(sourcetype), sourceno, sourceline, COALESCE(qty, 0), COALESCE(weight, 0)
           FROM currentstock01t
           WHERE companyid = %s AND UPPER(sourcetype) = 'INBOUND' AND sourceno = %s
           ORDER BY sourceline
           FOR UPDATE""",
        (companyid, receiptno),
    )
    rows = [r for r in cursor.fetchall() if _num(r[3]) > 0 or _num(r[4]) > 0]
    taken = reservation_module.reserved_by_others(cursor, companyid, [(r[0], r[1], r[2]) for r in rows])
    if taken:
        key, requests = next(iter(taken.items()))
        raise ValueError(f"이 매입의 재고({key[1]} / 순번 {key[2]})가 승인 대기 중인 요청({requests})에 예약되어 있어 수정 · 삭제를 요청할 수 없습니다.")
    return [{"sourcetype": t, "sourceno": n, "sourceline": int(l), "qty": str(q), "weight": str(w)} for t, n, l, q, w in rows]


_FINGERPRINT_SQL = {
    "INBOUND": [("inbound01t", "receiptno"), ("inbound02t", "receiptno"), ("inbound03t", "receiptno")],
    "OUTBOUND": [("outbound01t", "receiptno"), ("outbound02t", "receiptno"), ("outbound03t", "receiptno")],
    "RECEIPT_PAYMENT": [("receiptpayment01t", "receiptno"), ("receiptpayment02t", "receiptno")],
    "CUSTOMER": [("customer01t", "customercode")],
}


def _doc_fingerprint(cursor, companyid: str, target: str, ref_no: str | None) -> str | None:
    """수정 · 삭제 대상의 지금 내용 지문 (머리 · 상세 · 기타비용 전부). 요청 때 저장해 두고 승인 때 다시 비교한다
    → 요청 뒤에 다른 곳에서 바뀌었으면 승인으로 덮어쓰지 않는다."""
    tables = _FINGERPRINT_SQL.get(target)
    if not tables or not ref_no:
        return None
    parts = []
    for table, key in tables:
        cursor.execute(
            f"""SELECT COALESCE(string_agg(row_to_json(t)::text, '|' ORDER BY row_to_json(t)::text), '')
                FROM {table} t WHERE t.companyid = %s AND t.{key} = %s""",
            (companyid, ref_no),
        )
        parts.append(cursor.fetchone()[0] or "")
    cursor.execute("SELECT md5(%s)", ("#".join(parts),))
    return cursor.fetchone()[0]


class _TrialRollback(Exception):
    """시험 실행을 되돌리기 위한 신호."""


def _trial_run(target: str, op: str, companyid: str, companyname: str, data: dict, actor: str | None) -> None:
    """수정 · 삭제 요청: 승인 때 할 저장을 지금 한 번 실행해 보고 바로 되돌린다.
    수불 확정 · 사용된 재고 · 주문 연결 · 증권 처리 · 재고 부족 등 할 수 없으면 그 사유(ValueError)를 그대로 올린다
    → 승인할 수 없는 요청은 만들지 않는다. (재고 예약 트리거는 커밋 때 검사하므로 되돌리면 영향 없음)"""
    from services.control import executors   # 순환 참조 방지

    shared = _db._shared.get()
    if shared is not None:
        # 이미 한 트랜잭션 안(매출 저장 · 단가 수정 라우트): 저장 중간 지점까지만 되돌린다 (바깥 저장은 그대로)
        failed_before = shared.failed
        with shared.cursor() as cursor:
            cursor.execute("SAVEPOINT approval_trial")
        try:
            executors.run(target, op, companyid, companyname, data, actor)
        finally:
            with shared.cursor() as cursor:
                cursor.execute("ROLLBACK TO SAVEPOINT approval_trial")
                cursor.execute("RELEASE SAVEPOINT approval_trial")
            shared.failed = failed_before
        return
    try:
        with _db.shared_transaction():
            executors.run(target, op, companyid, companyname, data, actor)
            raise _TrialRollback()
    except _TrialRollback:
        return


def intercept(user: dict, target: str, action: str, op: str, data: dict, summary: str,
              ref_no: str | None = None, dates: list | None = None) -> dict | None:
    """통제가 켜져 있고 금액 기준을 넘으면 승인요청으로 보관하고 응답을 돌려준다. 아니면 None (그대로 저장)."""
    companyid = user["companyid"]
    with _db.connect() as connection, connection.cursor() as cursor:
        # 대기 중인 요청이 걸린 전표 · 거래처는 누구도 다시 고치거나 지울 수 없다 (통제가 꺼져 있어도, 승인자여도)
        if ref_no:
            # 같은 전표 · 거래처에 대한 요청 만들기를 한 줄로 세운다 (동시에 두 요청이 생기지 않게)
            cursor.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"approval-ref:{companyid}:{target}:{ref_no}",))
            ensure_no_pending(cursor, companyid, target, ref_no)
        on, min_amount = _policy(cursor, companyid, target, action)
        if ref_no and (on or target == "OUTBOUND"):
            _ensure_exists(cursor, companyid, target, ref_no)   # 없는 전표 · 거래처로는 요청을 만들지 않는다
        credit_on = (target == "OUTBOUND" and op in ("save", "sales_fields") and action in ("CREATE", "UPDATE")
                     and _credit_on(cursor, companyid))
        if not on and not credit_on:
            return None
        if _is_approver(cursor, companyid, user.get("email")):
            return None   # 승인자 본인이 저장하면 통제 없이 바로 저장
        if not _has_approver(cursor, companyid):
            return None   # 승인자가 한 명도 없으면 통제 없이 바로 저장
        changes = _compute_changes(cursor, companyid, target, op, action, data, ref_no)
        # 바뀐 게 없으면 승인 없이 저장: 모든 칸을 비교하는 거래처 수정 · 담당자 변경 · 매출 단가 수정만
        # (전표 수정은 비교하지 않는 칸(창고 등)이 있어 그대로 승인)
        if action == "UPDATE" and (target == "CUSTOMER" or op in ("manager", "sales_fields")) and not changes:
            return None
        amount, breakdown = None, None
        if target in AMOUNT_TARGETS:
            item = data.get("item") or {}
            goods, expenses = (_payload_amounts(cursor, companyid, target, item) if op == "save"
                               else _stored_amounts(cursor, companyid, target, ref_no or ""))
            amount = goods + expenses   # 매입 · 매출: 물품 + 기타비용 (공급가 기준)
            breakdown = {"goods": str(goods.quantize(Decimal("1"), rounding=ROUND_HALF_UP)),
                         "expenses": str(expenses.quantize(Decimal("1"), rounding=ROUND_HALF_UP))}
        reasons = []
        if on and (target not in AMOUNT_TARGETS or min_amount <= 0 or amount >= min_amount):
            reasons.append("AMOUNT" if target in AMOUNT_TARGETS and min_amount > 0 else "ACTION")
        credit = _credit_check(cursor, companyid, op, data, ref_no) if credit_on else None
        if credit and credit.pop("is_over"):
            reasons.append("CREDIT")
        if not reasons:
            return None   # 금액 기준 미만 · 여신 한도 안: 바로 저장
        # 수정 · 삭제할 수 없는 건(수불 확정 · 사용된 재고 · 주문 연결 · 증권 처리 · 재고 부족 …)은 요청을 만들지 않는다:
        #  승인 때 할 저장을 시험 실행하고 되돌린다 (이 연결은 아직 잠금을 잡지 않아 시험 실행과 서로 기다리지 않는다)
        if action in ("UPDATE", "DELETE"):
            _trial_run(target, op, companyid, user.get("companyname") or companyid, data, user.get("email"))
        actor = user.get("email")
        # 월마감: 승인해도 반영될 수 없는 요청은 만들지 않는다
        #  등록 · 수정 = 입력한 일자, 삭제 · 수정 · 담당자 변경 · 단가 수정 = 저장된 전표의 지금 일자도
        close_dates = list(dates or [])
        if ref_no and target in _HEADER_TABLE:
            stored = _stored_header(cursor, companyid, target, ref_no)
            if stored and stored.get("date"):
                close_dates.append(stored["date"])
        if close_dates:
            month_close_module.ensure_open(cursor, companyid, close_dates, ACTION_LABEL[action])
        requestno = _next_requestno(cursor, companyid)
        if target == "OUTBOUND" and op == "save":
            reservations = _outbound_reservations(cursor, companyid, data.get("item") or {})
        elif target == "INBOUND" and op in ("save", "delete") and action in ("UPDATE", "DELETE") and ref_no:
            reservations = _inbound_reservations(cursor, companyid, ref_no)   # 매입 수정 · 삭제: 그 매입 재고를 잠근다
        else:
            reservations = []
        party, doc_date = _party_and_date(cursor, companyid, target, op, data, ref_no)
        lines, weight = _lines_and_weight(cursor, companyid, target, op, data, ref_no)
        payload = {"companyname": user.get("companyname") or companyid, "data": data, "amounts": breakdown,
                   "party": party, "doc_date": doc_date, "lines": lines,
                   "weight": str(weight.quantize(Decimal("0.001"))) if weight is not None else None,
                   "reasons": reasons, "credit": credit, "changes": changes,
                   "doc_lines": _stored_lines(cursor, companyid, target, ref_no) if op != "save" and ref_no else None,
                   "doc_header": _stored_header(cursor, companyid, target, ref_no) if op != "save" and ref_no else None,
                   "doc_fingerprint": _doc_fingerprint(cursor, companyid, target, ref_no)}
        cursor.execute(
            """INSERT INTO approval_request01t (companyid, companyname, requestno, target, action, op, ref_no, summary, amount, payload, reservations, created_by)
               VALUES (%s, (SELECT companyname FROM company01t WHERE companyid = %s), %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s)""",
            (companyid, companyid, requestno, target, action, op, ref_no or None, (summary or "")[:500],
             amount.quantize(Decimal("1"), rounding=ROUND_HALF_UP) if amount is not None else None,
             json.dumps(payload, ensure_ascii=False, default=str), json.dumps(reservations), actor),
        )
    over_credit = "CREDIT" in reasons
    kind = TARGET_LABEL[target]
    if target == "RECEIPT_PAYMENT":
        kind = RP_TYPE_LABEL.get(str((data.get("item") or {}).get("transactiontype") or ((payload.get("doc_header") or {}).get("transactiontype")) or ""), kind)
    return {
        "success": True, "pending_approval": True, "requestno": requestno, "label": f"{kind} {ACTION_LABEL[action]}",
        "reason": "CREDIT" if over_credit else "AMOUNT",
        "reason_text": (f"여신한도를 {_won_text(credit['over'])} 초과했습니다." if over_credit else ""),
        "message": f"{TARGET_LABEL[target]} {ACTION_LABEL[action]}을(를) 승인요청했습니다 ({requestno}). 승인되면 반영됩니다.",
    }


# ── 승인 · 반려 · 취소 ───────────────────────────────────────────
class _NotApprovable(ValueError):
    """승인할 수 없는 상태 (이미 처리됨 등) — 실패 사유로 남기지 않는다."""


def approve(user: dict, requestno: str) -> dict:
    """요청 잠금 → 보관한 입력으로 실제 저장 → 승인 처리를 한 트랜잭션으로. 하나라도 실패하면 전부 취소되고 요청은 대기로 남는다."""
    from services.control import executors  # 저장 모듈들을 늦게 불러 순환 참조를 피한다

    companyid, email = user["companyid"], user.get("email")
    try:
        # 이 트랜잭션 안의 모든 저장이 같은 연결을 쓰고, 예약 검사에서 이 요청 자신의 예약은 빼고 본다
        with _db.shared_transaction({"mosco.approval_request": requestno}) as connection, connection.cursor() as cursor:
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
                raise _NotApprovable(f"이미 {STATUS_LABEL.get(status, status)} 처리된 요청입니다.")
            payload = payload if isinstance(payload, dict) else json.loads(payload)
            # 요청 뒤에 다른 곳에서 전표 · 거래처가 바뀌었으면 승인하지 않는다 (요청 때 내용으로 덮어쓰지 않게)
            saved_print = payload.get("doc_fingerprint")
            if saved_print:
                ref = (payload.get("data") or {}).get("receiptno") or ((payload.get("data") or {}).get("item") or {}).get("receiptno")                     or ((payload.get("data") or {}).get("item") or {}).get("customercode")
                cursor.execute("SELECT ref_no FROM approval_request01t WHERE companyid = %s AND requestno = %s", (companyid, requestno))
                ref = cursor.fetchone()[0] or ref
                if _doc_fingerprint(cursor, companyid, target, ref) != saved_print:
                    raise ValueError("요청 뒤에 다른 곳에서 내용이 바뀌어 승인할 수 없습니다. 반려한 뒤 다시 요청해 주세요.")
            result_no = executors.run(target, op, companyid, payload.get("companyname") or companyid, payload.get("data") or {}, requester)
            cursor.execute(
                """UPDATE approval_request01t
                   SET status = 'APPROVED', decided_by = %s, decided_at = CURRENT_TIMESTAMP, result_no = %s, reservations = '[]'::jsonb,
                       last_error = NULL, updatedat = CURRENT_TIMESTAMP, updated_by = %s
                   WHERE companyid = %s AND requestno = %s""",
                (email, result_no[:100] or None, email, companyid, requestno),
            )
    except (PermissionError, LookupError, _NotApprovable):
        raise
    except Exception as error:
        message = str(error) if isinstance(error, ValueError) and str(error) else "저장 중 오류가 발생해 승인하지 못했습니다."
        # 실패 사유만 남긴다 (요청은 그대로 대기)
        with _db.connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """UPDATE approval_request01t SET last_error = %s, updatedat = CURRENT_TIMESTAMP, updated_by = %s
                   WHERE companyid = %s AND requestno = %s AND status = 'PENDING'""",
                (message[:500], email, companyid, requestno),
            )
        raise ValueError(message) from error
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
                      (SELECT COUNT(*) FROM approval_request01t WHERE companyid = %s AND status = 'PENDING'),
                      (SELECT COUNT(*) FROM approval_request01t WHERE companyid = %s AND status = 'PENDING' AND created_by = %s),
                      (SELECT COUNT(*) FROM approval_request01t WHERE companyid = %s AND created_by = %s AND status = 'REJECTED'
                          AND COALESCE(decided_at, createdat) >= CURRENT_TIMESTAMP - INTERVAL '7 days'),
                      EXISTS (SELECT 1 FROM approval_request01t WHERE companyid = %s AND created_by = %s)""",
            (companyid, companyid, companyid, email, companyid, email, companyid, email),
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
        my_total = int(bool(my_total))
    return {
        "active": bool(active) or my_total > 0 or approver, "can_manage": manager, "is_approver": approver,
        "pending": pending if (manager or approver) else 0, "my_pending": my_pending, "my_rejected": my_rejected,
        "items": items,
    }


# 이름은 user01t 를 한 번씩만 붙여 읽는다 (행마다 하위 조회를 돌리지 않게)
_PARTY_SQL = """COALESCE(NULLIF(q.payload->>'party', ''), NULLIF(q.payload#>>'{data,item,customname}', ''),
    NULLIF(q.payload#>>'{data,item,customername}', ''), NULLIF(q.payload#>>'{data,items,0,customername}', ''),
    (SELECT c.customername FROM customer01t c WHERE c.companyid = q.companyid AND c.customercode = q.payload#>>'{data,item,customcode}'),
    (SELECT h.customname FROM outbound01t h WHERE q.target = 'OUTBOUND' AND h.companyid = q.companyid AND h.receiptno = q.ref_no),
    (SELECT h.customname FROM inbound01t h WHERE q.target = 'INBOUND' AND h.companyid = q.companyid AND h.receiptno = q.ref_no),
    (SELECT h.customname FROM receiptpayment01t h WHERE q.target = 'RECEIPT_PAYMENT' AND h.companyid = q.companyid AND h.receiptno = q.ref_no),
    (SELECT c.customername FROM customer01t c WHERE q.target = 'CUSTOMER' AND c.companyid = q.companyid AND c.customercode = q.ref_no),
    '')"""
_ITEMS = "q.payload#>'{data,item,items}'"
_REQUEST_COLUMNS = """q.requestno, q.target, q.action, q.op, q.ref_no, q.summary, q.amount, q.status, q.reject_reason, q.last_error,
    """ + _PARTY_SQL + """ AS party,
    COALESCE(NULLIF(q.payload->>'doc_date', ''), LEFT(COALESCE(q.payload#>>'{data,item,receptdate}', q.payload#>>'{data,item,receiptdate}'), 10), '') AS doc_date,
    q.payload->'amounts' AS amounts, q.payload->'credit' AS credit, q.payload->'reasons' AS reasons, q.payload->'changes' AS changes,
    q.payload#>>'{data,item,customercode}' AS item_code,
    CASE WHEN q.target = 'RECEIPT_PAYMENT' THEN COALESCE(NULLIF(q.payload#>>'{data,item,transactiontype}', ''), NULLIF(q.payload#>>'{doc_header,transactiontype}', ''),
         (SELECT h.transactiontype FROM receiptpayment01t h WHERE h.companyid = q.companyid AND h.receiptno = q.ref_no)) END AS rp_type,
    COALESCE(NULLIF(q.payload->>'lines', '')::integer,
             CASE WHEN jsonb_typeof(""" + _ITEMS + """) = 'array' THEN jsonb_array_length(""" + _ITEMS + """)
                  WHEN jsonb_typeof(q.payload#>'{data,items}') = 'array' THEN jsonb_array_length(q.payload#>'{data,items}')
                  WHEN q.target = 'CUSTOMER' THEN 1 END) AS lines,
    COALESCE(NULLIF(q.payload->>'weight', '')::numeric,
             CASE WHEN q.target IN ('INBOUND', 'OUTBOUND') AND jsonb_typeof(""" + _ITEMS + """) = 'array'
                  THEN (SELECT SUM(NULLIF(x->>'weight', '')::numeric) FROM jsonb_array_elements(""" + _ITEMS + """) x) END) AS weight,
    q.result_no, q.createdat AS requested_at, q.created_by AS requested_email, COALESCE(ru.username, q.created_by) AS requested_name,
    q.decided_at, q.decided_by AS decided_email, COALESCE(du.username, q.decided_by) AS decided_name"""
_USER_JOINS = """
    LEFT JOIN user01t ru ON ru.companyid = q.companyid AND ru.email = q.created_by
    LEFT JOIN user01t du ON du.companyid = q.companyid AND du.email = q.decided_by"""
_REQUEST_FROM = "approval_request01t q" + _USER_JOINS


def _note(row: dict) -> str:
    """목록 '내용' 칸: 무엇을 바꾸는지 짧게 (수정 · 삭제 대상 번호, 바꾼 칸, 새 거래처 코드 …)."""
    op, action, ref = row.get("op"), row.get("action"), row.get("ref_no") or ""
    changes = row.get("changes") or []
    if action == "UPDATE" and changes:
        labels = [c.get("label") for c in changes]
        text = " · ".join(labels[:2]) + (f" 외 {len(labels) - 2}" if len(labels) > 2 else "") + " 변경"
        return text + (" · 여신 초과" if "CREDIT" in (row.get("reasons") or []) else "")
    reasons = row.get("reasons") or []
    tail = " · 여신 초과" if "CREDIT" in reasons else ""
    if row.get("target") == "CUSTOMER":
        if op == "bulk_create":
            return "엑셀 일괄 등록" + tail
        if action == "UPDATE":
            return f"{ref} 수정"
        return (row.get("item_code") or "코드 자동") + tail
    if op == "delete":
        return f"{ref} 삭제"
    if op in ("manager", "sales_fields"):
        text = str(row.get("summary") or "")
        return (text[len(ref):].strip() if ref and text.startswith(ref) else text) + tail
    if action == "UPDATE":
        return f"{ref} 수정{tail}"
    return "신규" + tail


RP_TYPE_LABEL = {"RECEIPT": "수금", "PAYMENT": "지급"}


def _decorate(row: dict, email: str) -> dict:
    row["target_label"] = RP_TYPE_LABEL.get(row.pop("rp_type", None) or "", TARGET_LABEL.get(row["target"], row["target"]))
    row["action_label"] = ACTION_LABEL.get(row["action"], row["action"])
    row["status_label"] = STATUS_LABEL.get(row["status"], row["status"])
    requester = row.pop("requested_email", None)
    decider = row.pop("decided_email", None)
    row["mine"] = requester == email
    row["note"] = _note(row)
    row.pop("item_code", None)
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
        where.append("q.createdat >= (%s::date)::timestamp AT TIME ZONE 'Asia/Seoul'")
        params.append(date_from)
    if date_to:
        where.append("q.createdat < (%s::date + 1)::timestamp AT TIME ZONE 'Asia/Seoul'")
        params.append(date_to)
    if q.strip():
        pattern = f"%{q.strip()}%"
        where.append(f"(q.requestno ILIKE %s OR q.summary ILIKE %s OR q.ref_no ILIKE %s OR q.result_no ILIKE %s OR ru.username ILIKE %s OR {_PARTY_SQL} ILIKE %s)")
        params.extend([pattern] * 6)
    where_sql = " AND ".join(where)
    key_from = "approval_request01t q" + (_USER_JOINS if q.strip() else "")
    with _db.connect() as connection, connection.cursor() as cursor:
        # 1) 키만으로 조건 · 정렬 · 페이지 + 전체 건수  2) 고른 30건만 거래처명 · 이름 · 건수 등을 붙인다
        cursor.execute(
            f"""WITH page AS (
                    SELECT q.requestno, (q.status = 'PENDING') AS pending_first, q.createdat AS sort_at, COUNT(*) OVER () AS total_count
                      FROM {key_from} WHERE {where_sql}
                     ORDER BY (q.status = 'PENDING') DESC, q.createdat DESC, q.requestno DESC LIMIT %s OFFSET %s)
                SELECT {_REQUEST_COLUMNS}, page.total_count
                  FROM page JOIN approval_request01t q ON q.companyid = %s AND q.requestno = page.requestno{_USER_JOINS}
                 ORDER BY page.pending_first DESC, page.sort_at DESC, page.requestno DESC""",
            (*params, page_size, (page - 1) * page_size, companyid),
        )
        rows = _rows(cursor)
        total = rows[0]["total_count"] if rows else 0
        if not rows and page > 1:
            cursor.execute(f"SELECT COUNT(*) FROM {key_from} WHERE {where_sql}", params)
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
        item["doc_lines"] = payload.get("doc_lines")
        item["doc_header"] = payload.get("doc_header")
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
        item["lines"] = _detail_lines(cursor, companyid, item)
        if item.get("target") == "CUSTOMER":   # 거래처 상세: 은행은 이름으로
            cursor.execute("SELECT code, code_name FROM codemaster01t WHERE companyid = %s AND groupcode = 'BANK'", (companyid,))
            item["bank_names"] = {code: name for code, name in cursor.fetchall()}
        if item.get("op") != "save" and not item.get("doc_header"):   # 예전 요청: 지금 전표에서
            item["doc_header"] = _stored_header(cursor, companyid, item["target"], item.get("ref_no") or "")
        item.pop("doc_lines", None)
    item["can_approve"] = item["status"] == "PENDING" and approver
    item["can_reject"] = item["status"] == "PENDING" and approver
    item["can_cancel"] = item["status"] == "PENDING" and item["mine"]
    return item


_INSTRUMENT_NAMES = {"RECEIVABLE": "외상매출채권", "ELECTRONIC": "전자어음", "PROMISSORY": "약속어음", "CURRENT_CHECK": "당좌수표",
                     "HOUSEHOLD_CHECK": "가계수표", "CASHIER_CHECK": "자기앞수표", "OTHER": "기타"}


def _rp_line(row: dict) -> dict:
    """수금/지급 한 줄: 결제수단별 금액 · 합계(현금+어음/수표+은행+카드+상계) · 어음 정보 · 비고."""
    methods = [{"label": label, "amount": str(_num(row.get(key)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))}
               for key, label in _RP_KEYS if _num(row.get(key)) != 0]
    total = sum((_num(row.get(k)) for k in ("cashamt", "instrumentamt", "bankamt", "cardamt", "offsetamt")), ZERO)
    instrument = str(row.get("instrumenttype") or "").strip().upper()
    return {"kind": "RP", "methods": methods, "supply": str(total.quantize(Decimal("1"), rounding=ROUND_HALF_UP)),
            "instrumenttype": _INSTRUMENT_NAMES.get(instrument, instrument) if _num(row.get("instrumentamt")) else "",
            "instrumentno": row.get("instrumentno") or "", "maturitydate": str(row.get("maturitydate") or "")[:10],
            "issuer": row.get("issuercompany") or row.get("issuer") or "", "description": row.get("description") or ""}


def _stored_lines(cursor, companyid: str, target: str, receiptno: str) -> list[dict]:
    """저장된 매입 · 매출 전표의 품목 (삭제 · 담당자 변경 · 단가 수정 요청). 승인 뒤 전표가 지워져도 보이게 요청에 같이 보관한다."""
    if target == "RECEIPT_PAYMENT" and receiptno:
        cursor.execute(
            """SELECT cashamt, instrumentamt, bankamt, cardamt, offsetamt, lossamt, chargeamt, instrumenttype, instrumentno,
                      maturitydate, issuercompany, issuer, description
               FROM receiptpayment02t WHERE companyid = %s AND receiptno = %s ORDER BY lineno""",
            (companyid, receiptno),
        )
        cols = [d[0] for d in cursor.description]
        return [_rp_line(dict(zip(cols, row))) for row in cursor.fetchall()]
    if target not in ("INBOUND", "OUTBOUND") or not receiptno:
        return []
    src = "stocksourceno, stocksourceline" if target == "OUTBOUND" else "NULL, NULL"
    cursor.execute(
        f"""SELECT itemname, thickness, width, length, qty, weight, unitprice, supplyamt, {src}
            FROM {target.lower()}02t WHERE companyid = %s AND receiptno = %s ORDER BY lineno""",
        (companyid, receiptno),
    )
    q0 = lambda v: str(v) if v is not None else None   # noqa: E731
    return [{"itemname": name or "", "thickness": q0(th), "width": q0(wd), "length": q0(ln), "qty": q0(qty), "weight": q0(wt),
             "unitprice": q0(price), "supply": str(_num(supply).quantize(Decimal("1"), rounding=ROUND_HALF_UP)),
             "sourceno": srcno or "", "sourceline": srcline or "", "source": f"{srcno} / {srcline}" if srcno else ""}
            for name, th, wd, ln, qty, wt, price, supply, srcno, srcline in cursor.fetchall()]


def _stored_header(cursor, companyid: str, target: str, receiptno: str) -> dict | None:
    """저장된 전표 머리: 전표일자 · 거래처 · 담당자 · 착지 · 비고 · 구분 (번호만 오는 요청의 공용 양식용, 요청에 같이 보관)."""
    cols = {"INBOUND": ("inbound01t", "receptdate", "NULL", "NULL"),
            "OUTBOUND": ("outbound01t", "receptdate", "destination", "NULL"),
            "RECEIPT_PAYMENT": ("receiptpayment01t", "receiptdate", "NULL", "transactiontype")}.get(target)
    if not cols or not receiptno:
        return None
    table, date_col, dest_col, type_col = cols
    cursor.execute(
        f"""SELECT {date_col}, customname, manager, {dest_col}, description, {type_col}
            FROM {table} WHERE companyid = %s AND receiptno = %s""",
        (companyid, receiptno),
    )
    row = cursor.fetchone()
    if not row:
        return None
    return {"date": str(row[0] or "")[:10], "party": row[1] or "", "manager": row[2] or "", "destination": row[3] or "",
            "description": row[4] or "", "transactiontype": row[5] or ""}


def _detail_lines(cursor, companyid: str, item: dict) -> list[dict]:
    """매입 · 매출 요청의 품목 줄: 품명 · 규격 · 수량 · 중량 · 단가 · 공급가 (원천 재고는 툴팁용)."""
    if item.get("target") not in ("INBOUND", "OUTBOUND", "RECEIPT_PAYMENT"):
        return []
    if item.get("target") == "RECEIPT_PAYMENT" and item.get("op") == "save":
        return [_rp_line(line) for line in ((item.get("data") or {}).get("item") or {}).get("items") or []]
    if item.get("op") != "save":   # 삭제 · 담당자 변경 · 단가 수정: 요청 때 보관한 품목 (없으면 지금 전표)
        return item.get("doc_lines") or _stored_lines(cursor, companyid, item["target"], item.get("ref_no") or "")
    lines = ((item.get("data") or {}).get("item") or {}).get("items") or []
    units = _price_units(cursor, companyid)
    names = {}
    if item["target"] == "OUTBOUND" and lines:
        keys = sorted({(str(l.get("stocksourcetype") or "").strip().upper(), str(l.get("stocksourceno") or "").strip(),
                        int(l.get("stocksourceline") or 0)) for l in lines})
        arrays = ([k[0] for k in keys], [k[1] for k in keys], [k[2] for k in keys])
        # 지금 재고 → 없으면(승인 뒤 다 나간 재고) 그 재고를 쓴 매출상세에서
        cursor.execute(
            """SELECT k.t, k.n, k.l,
                      COALESCE(s.itemname, o.itemname), COALESCE(s.thickness, o.thickness), COALESCE(s.width, o.width), COALESCE(s.length, o.length)
               FROM unnest(%s::varchar[], %s::varchar[], %s::integer[]) AS k(t, n, l)
               LEFT JOIN currentstock01t s ON s.companyid = %s AND UPPER(s.sourcetype) = k.t AND s.sourceno = k.n AND s.sourceline = k.l
               LEFT JOIN LATERAL (SELECT itemname, thickness, width, length FROM outbound02t d
                                  WHERE d.companyid = %s AND UPPER(d.stocksourcetype) = k.t AND d.stocksourceno = k.n AND d.stocksourceline = k.l
                                  LIMIT 1) o ON TRUE""",
            (*arrays, companyid, companyid),
        )
        names = {(t, n, int(l)): (name, th, wd, ln) for t, n, l, name, th, wd, ln in cursor.fetchall()}
    result = []
    for line in lines:
        if item["target"] == "OUTBOUND":
            key = (str(line.get("stocksourcetype") or "").strip().upper(), str(line.get("stocksourceno") or "").strip(),
                   int(line.get("stocksourceline") or 0))
            name, thickness, width, length = names.get(key, (None, None, None, None))
            source = f"{key[1]} / {key[2]}"
        else:
            name, thickness, width, length = line.get("itemname"), line.get("thickness"), line.get("width"), line.get("length")
            source = ""
        result.append({
            "itemname": name or "", "thickness": thickness, "width": width, "length": length,
            "qty": line.get("qty"), "weight": line.get("weight"), "unitprice": line.get("unitprice"),
            "supply": str(_line_amount({**line, "length": line.get("length") or length}, units).quantize(Decimal("1"), rounding=ROUND_HALF_UP)),
            "source": source,
            "sourceno": line.get("stocksourceno") or "", "sourceline": line.get("stocksourceline") or "",
        })
    return result


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
        credit_on = _credit_on(cursor, companyid)
    return {"policies": policies, "users": users, "credit": {"on": credit_on}}


def save_settings(user: dict, policies: list[dict], approvers: list[str] | None = None, credit_on: bool | None = None) -> dict:
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
        if credit_on is not None:   # 여신 통제: target 'CREDIT' 한 줄 (on_create = 켜기)
            cursor.execute(
                """INSERT INTO control_policy01t (companyid, companyname, target, on_create, on_update, on_delete, created_by)
                   VALUES (%s, (SELECT companyname FROM company01t WHERE companyid = %s), 'CREDIT', %s, 'N', 'N', %s)
                   ON CONFLICT (companyid, target) DO UPDATE SET on_create = EXCLUDED.on_create, updatedat = CURRENT_TIMESTAMP, updated_by = %s
                   WHERE control_policy01t.on_create IS DISTINCT FROM EXCLUDED.on_create""",
                (companyid, companyid, "Y" if credit_on else "N", actor, actor),
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
                   "Y" if policy.get("on_delete") and target != "CUSTOMER" else "N", amount("delete_min"))   # 거래처는 삭제 기능 없음
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
        # 승인 대상(또는 여신 통제)을 하나라도 켜면 승인자가 한 명은 있어야 한다 (아무도 승인할 수 없는 상태 방지)
        cursor.execute(
            """SELECT EXISTS (SELECT 1 FROM control_policy01t WHERE companyid = %s AND 'Y' IN (on_create, on_update, on_delete))""",
            (companyid,),
        )
        if cursor.fetchone()[0] and not _has_approver(cursor, companyid):
            raise ValueError("승인자 1명 이상 지정 필요")
    return get_settings(user)
