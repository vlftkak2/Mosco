"""Confirmed AI orders and read-only stock candidates.

주문 품목 진행상태 (aiorder02t.optimize_status) 는 가공 최적화가 관리한다.
  NONE(미전송) → WAITING(최적화 대기) → PLANNED(계획확정) → DONE(가공완료)
주문서 관리는 NONE ↔ WAITING (보내기 / 보내기 취소) 만 바꾸고, NONE 이 아닌 품목은 수정·재고매칭·삭제를 막는다.
연결 재고를 그대로 쓸지 잘라서 쓸지는 가공 최적화가 규격(폭·길이)으로 판단한다.
"""

import re
from contextlib import contextmanager
from datetime import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

import psycopg2
from psycopg2.extras import RealDictCursor

from config import DB_CONFIG
import db as _shared_db

OPTIMIZE_STATUSES = ("NONE", "WAITING", "PLANNED", "DONE")
LOCKED_MESSAGE = "가공 최적화로 보낸 품목은 수정할 수 없습니다. 가공 최적화에서 돌려받은 뒤 수정해 주세요."
ORDER_PROGRESS = ("NONE", "PARTIAL", "SENT", "DONE")
# 주문 진행: NONE 전부 미전송 / PARTIAL 일부 전송 / SENT 전부 전송 / DONE 전부 가공완료
_PROGRESS_SQL = """COALESCE((SELECT CASE
        WHEN COUNT(*) = 0 OR BOOL_AND(d.optimize_status = 'NONE') THEN 'NONE'
        WHEN BOOL_AND(d.optimize_status = 'DONE') THEN 'DONE'
        WHEN BOOL_OR(d.optimize_status = 'NONE') THEN 'PARTIAL'
        ELSE 'SENT' END
      FROM aiorder02t d WHERE d.companyid=h.companyid AND d.orderid=h.orderid), 'NONE')"""


@contextmanager
def connection():
    # Borrowed from the shared pool; close() rolls back anything uncommitted and returns it.
    conn = _shared_db.open_connection()
    try:
        yield conn
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def as_dict(row):
    result = dict(row)
    for key, value in result.items():
        if isinstance(value, Decimal):
            result[key] = float(value)
    return result


def confirm_order(companyid, companyname, username, email, payload):
    request_id = str(payload.analysis_request_id)
    with connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # The analysis record proves that this file was analyzed for this tenant and user.
            cur.execute("""
                SELECT request_id FROM aiorderanalysis01t
                WHERE companyid = %s AND lower(useremail) = lower(%s)
                  AND request_id = %s AND status = 'succeeded'
            """, (companyid, email, request_id))
            if not cur.fetchone():
                raise ValueError("확인 가능한 분석 결과가 없습니다. 이 사용자로 발주서를 다시 분석해주세요.")
            cur.execute("""
                SELECT orderid FROM aiorder01t
                WHERE companyid = %s AND analysis_request_id = %s
            """, (companyid, request_id))
            existing = cur.fetchone()
            if existing:
                return {"orderid": existing["orderid"], "already_confirmed": True}

            # 주문서 관리 저장과 같은 필수값: 품명 · 수량 · 중량 (숫자 또는 AI 원문 값)
            missing_rows = []
            for position, item in enumerate(payload.items, start=1):
                missing = [label for label, present in (
                    ("품명", str(item.source_product_name or "").strip()),
                    ("수량", item.quantity is not None or str(item.quantity_raw or "").strip()),
                    ("중량", item.weight_kg is not None or str(item.weight_raw or "").strip()),
                ) if not present]
                if missing:
                    missing_rows.append(f"{position}행 {', '.join(missing)}")
            if missing_rows:
                raise ValueError("필수값을 입력해 주세요: " + " / ".join(missing_rows[:5]))

            prefix = datetime.now(ZoneInfo("Asia/Seoul")).strftime("AI%Y%m%d")
            # Advisory transaction lock serializes numbering only within this company.
            cur.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"ai-order-sequence:{companyid}",))
            # Another request may have confirmed the same analysis while this one waited.
            cur.execute("""
                SELECT orderid FROM aiorder01t
                WHERE companyid = %s AND analysis_request_id = %s
            """, (companyid, request_id))
            existing = cur.fetchone()
            if existing:
                return {"orderid": existing["orderid"], "already_confirmed": True}
            cur.execute("""
                SELECT COALESCE(MAX(substring(orderid from %s)::integer), 0) AS last_number
                FROM aiorder01t WHERE companyid = %s AND orderid ~ %s
            """, (r"[0-9]{5}$", companyid, f"^{prefix}[0-9]{{5}}$"))
            # The regex above limits the sequence to today's company orders.
            number = cur.fetchone()["last_number"] + 1
            if number > 99999:
                raise ValueError("오늘의 주문번호 한도를 초과했습니다.")
            orderid = f"{prefix}{number:05d}"
            h = payload.header
            cur.execute("""
                INSERT INTO aiorder01t
                    (companyid, companyname, orderid, analysis_request_id, username, useremail,
                     buyer, recipient, orderdate, duedate, deliverylocation, sourcefilename, created_by)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (companyid, companyname, orderid, request_id, username, email,
                  h.buyer, h.recipient, h.order_date, h.due_date, h.delivery_location,
                  payload.sourcefilename, email or None))
            for lineno, item in enumerate(payload.items, start=1):
                cur.execute("""
                    INSERT INTO aiorder02t
                        (companyid, companyname, orderid, lineno, itemname, steelgrade, surface, size,
                         thickness, width, length, quantity, quantity_unit, weight_kg, notes,
                         quantity_raw, weight_raw, created_by)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, (companyid, companyname, orderid, lineno, item.source_product_name,
                      item.steel_grade, item.surface, item.spec_raw, item.thickness, item.width, item.length,
                      item.quantity, item.quantity_unit, item.weight_kg, item.notes,
                      item.quantity_raw, item.weight_raw, email or None))
        conn.commit()
    return {"orderid": orderid, "already_confirmed": False}


def list_orders(companyid, start_date=None, end_date=None, buyer=None, orderid=None, page=1, page_size=30, progress=None):
    clauses = ["h.companyid = %s"]
    args = [companyid]
    for condition, value in (
        ("h.orderdate >= %s", start_date), ("h.orderdate <= %s", end_date),
        ("h.buyer ILIKE %s", f"%{buyer}%" if buyer else None),
        ("h.orderid ILIKE %s", f"%{orderid}%" if orderid else None),
    ):
        if value is not None:
            clauses.append(condition)
            args.append(value)
    if progress in ORDER_PROGRESS:
        clauses.append(f"{_PROGRESS_SQL} = %s")
        args.append(progress)
    where = " AND ".join(clauses)
    with connection() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(f"SELECT COUNT(*) AS total FROM aiorder01t h WHERE {where}", args)
        total = cur.fetchone()["total"]
        cur.execute(f"""
            SELECT h.orderid, h.buyer, h.recipient, h.orderdate, h.duedate, h.deliverylocation,
                   h.username, h.useremail, h.created_at, h.updated_at,
                   COALESCE((SELECT u.username FROM user01t u WHERE u.email = COALESCE(h.created_by, h.useremail) LIMIT 1),
                            COALESCE(h.created_by, h.useremail)) AS created_by,
                   COALESCE((SELECT u.username FROM user01t u WHERE u.email = h.updated_by LIMIT 1), h.updated_by) AS updated_by,
                   (SELECT COUNT(*) FROM aiorder02t d WHERE d.companyid=h.companyid AND d.orderid=h.orderid) AS item_count,
                   (SELECT COALESCE(SUM(d.weight_kg), 0) FROM aiorder02t d
                    WHERE d.companyid=h.companyid AND d.orderid=h.orderid) AS total_weight,
                   {_PROGRESS_SQL} AS progress
            FROM aiorder01t h WHERE {where}
            ORDER BY h.created_at DESC, h.orderid DESC LIMIT %s OFFSET %s
        """, args + [page_size, (page - 1) * page_size])
        return {"total": total, "items": [as_dict(row) for row in cur.fetchall()]}


def get_order(companyid, orderid):
    with connection() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT * FROM aiorder01t WHERE companyid=%s AND orderid=%s", (companyid, orderid))
        header = cur.fetchone()
        if not header:
            return None
        header = dict(header)
        cur.execute("""SELECT COALESCE((SELECT username FROM user01t WHERE email = %(c)s LIMIT 1), %(c)s) AS created_by_name,
                              COALESCE((SELECT username FROM user01t WHERE email = %(u)s LIMIT 1), %(u)s) AS updated_by_name""",
                    {"c": header.get("created_by") or header.get("useremail"), "u": header.get("updated_by")})
        header.update(cur.fetchone())
        cur.execute("""
            SELECT lineno, itemname, steelgrade, surface, size, thickness, width, length,
                   quantity, quantity_unit, weight_kg, notes, quantity_raw, weight_raw,
                   optimize_status, created_at, updated_at,
                   COALESCE((SELECT u.username FROM user01t u WHERE u.email = aiorder02t.created_by LIMIT 1), aiorder02t.created_by) AS created_by,
                   COALESCE((SELECT u.username FROM user01t u WHERE u.email = aiorder02t.updated_by LIMIT 1), aiorder02t.updated_by) AS updated_by
            FROM aiorder02t WHERE companyid=%s AND orderid=%s ORDER BY lineno
        """, (companyid, orderid))
        items = [as_dict(row) for row in cur.fetchall()]
        matches = {}
        cur.execute("""
            SELECT l.lineno, l.matchlineno, l.stocksourcetype, l.stocksourceno, l.stocksourceline,
                   s.itemname AS stock_itemname, s.productname AS stock_productname,
                   s.thickness AS stock_thickness, s.width AS stock_width, s.length AS stock_length,
                   s.qty AS stock_qty, s.qtyunit AS stock_qtyunit, s.weight AS stock_weight,
                   s.warehousecodename AS stock_warehouse
            FROM aiorder03t l
            LEFT JOIN currentstock01t s
              ON s.companyid=l.companyid
             AND s.sourcetype=l.stocksourcetype
             AND s.sourceno=l.stocksourceno
             AND s.sourceline=l.stocksourceline
            WHERE l.companyid=%s AND l.orderid=%s
            ORDER BY l.lineno, l.matchlineno
        """, (companyid, orderid))
        for row in cur.fetchall():
            match = as_dict(row)
            matches.setdefault(match["lineno"], []).append({
                "matchlineno": match["matchlineno"],
                "sourcetype": match["stocksourcetype"],
                "sourceno": match["stocksourceno"],
                "sourceline": match["stocksourceline"],
                "itemname": match["stock_itemname"],
                "productname": match["stock_productname"],
                "thickness": match["stock_thickness"],
                "width": match["stock_width"],
                "length": match["stock_length"],
                "quantity": match["stock_qty"],
                "quantity_unit": match["stock_qtyunit"],
                "weight_kg": match["stock_weight"],
                "warehouse": match["stock_warehouse"],
            })
        for item in items:
            item["stock_matches"] = matches.get(item["lineno"], [])
        return {"header": as_dict(header), "items": items}


def update_order(companyid, orderid, buyer, recipient, order_date, due_date, delivery_location, actor=None):
    """Update editable confirmed-order header fields within the tenant."""
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE aiorder01t
                SET buyer = %s, recipient = %s, orderdate = %s,
                    duedate = %s, deliverylocation = %s,
                    updated_at = CURRENT_TIMESTAMP, updated_by = COALESCE(%s, updated_by)
                WHERE companyid = %s AND orderid = %s
            """, (buyer, recipient, order_date, due_date, delivery_location, actor or None, companyid, orderid))
            updated = cur.rowcount > 0
        conn.commit()
    return updated


def update_order_items(companyid, orderid, items, actor=None):
    """Save editable order rows, retaining existing line IDs and appending new IDs."""
    with connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT orderid, companyname FROM aiorder01t WHERE companyid=%s AND orderid=%s FOR UPDATE",
                (companyid, orderid),
            )
            header = cur.fetchone()
            if header is None:
                return False

            cur.execute(
                "SELECT lineno, optimize_status FROM aiorder02t WHERE companyid=%s AND orderid=%s ORDER BY lineno FOR UPDATE",
                (companyid, orderid),
            )
            line_status = {row["lineno"]: row["optimize_status"] for row in cur.fetchall()}
            existing_lines = list(line_status)
            locked_lines = {lineno for lineno, status in line_status.items() if status != "NONE"}
            submitted_lines = [item.lineno for item in items if item.lineno is not None]
            if len(set(submitted_lines)) != len(submitted_lines) or not set(submitted_lines).issubset(existing_lines):
                raise ValueError("주문에 포함되지 않은 상세 행이 있습니다. 다시 조회한 뒤 저장해 주세요.")

            removed_lines = set(existing_lines) - set(submitted_lines)
            if removed_lines & locked_lines:
                raise ValueError(LOCKED_MESSAGE)
            if removed_lines:
                cur.execute(
                    "DELETE FROM aiorder02t WHERE companyid=%s AND orderid=%s AND lineno = ANY(%s)",
                    (companyid, orderid, list(removed_lines)),
                )

            # 필수값: 품명 · 수량 · 중량 (숫자 또는 AI 원문 값). 보낸 품목은 잠겨 있어 검사하지 않는다
            missing_rows = []
            for position, item in enumerate(items, start=1):
                if item.lineno in locked_lines:
                    continue
                missing = [label for label, present in (
                    ("품명", str(item.itemname or "").strip()),
                    ("수량", item.quantity is not None or str(item.quantity_raw or "").strip()),
                    ("중량", item.weight_kg is not None or str(item.weight_raw or "").strip()),
                ) if not present]
                if missing:
                    missing_rows.append(f"{position}행 {', '.join(missing)}")
            if missing_rows:
                raise ValueError("필수값을 입력해 주세요: " + " / ".join(missing_rows[:5]))

            next_lineno = max(existing_lines, default=0)

            for item in items:
                if item.lineno in locked_lines:
                    continue  # 보낸 품목은 그대로 둔다 (화면에서도 잠김)
                text = lambda value: (str(value).strip() or None) if value is not None else None  # 빈칸은 NULL 로
                values = (
                    text(item.itemname), text(item.steelgrade), text(item.surface), text(item.size), item.thickness, item.width,
                    item.length, item.quantity, text(item.quantity_unit), item.weight_kg,
                    text(item.notes), text(item.quantity_raw), text(item.weight_raw),
                )
                if item.lineno is None:
                    next_lineno += 1
                    cur.execute("""
                        INSERT INTO aiorder02t
                            (companyid, companyname, orderid, lineno, itemname, steelgrade, surface, size,
                             thickness, width, length, quantity, quantity_unit, weight_kg, notes,
                             quantity_raw, weight_raw, created_by)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """, (companyid, header["companyname"], orderid, next_lineno, *values, actor or None))
                else:
                    cur.execute("""
                        UPDATE aiorder02t
                        SET itemname=%s, steelgrade=%s, surface=%s, size=%s, thickness=%s, width=%s,
                            length=%s, quantity=%s, quantity_unit=%s, weight_kg=%s,
                            notes=%s, quantity_raw=%s, weight_raw=%s,
                            updated_at=CURRENT_TIMESTAMP, updated_by=COALESCE(%s, updated_by)
                        WHERE companyid=%s AND orderid=%s AND lineno=%s
                    """, (*values, actor or None, companyid, orderid, item.lineno))
                    if cur.rowcount != 1:
                        raise ValueError("주문 상세 행을 찾을 수 없습니다. 다시 조회한 뒤 저장해 주세요.")
            cur.execute(
                "UPDATE aiorder01t SET updated_at=CURRENT_TIMESTAMP, updated_by=COALESCE(%s, updated_by) WHERE companyid=%s AND orderid=%s",
                (actor or None, companyid, orderid),
            )
        conn.commit()
    return True


def cancel_order(companyid, orderid):
    """Cancel a confirmation, leaving its original AI analysis available for review."""
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT orderid FROM aiorder01t WHERE companyid=%s AND orderid=%s FOR UPDATE",
                (companyid, orderid),
            )
            if cur.fetchone() is None:
                return False
            cur.execute("SELECT 1 FROM aiorder02t WHERE companyid=%s AND orderid=%s AND optimize_status <> 'NONE' LIMIT 1",
                        (companyid, orderid))
            if cur.fetchone():
                raise ValueError("가공 최적화로 보낸 품목이 있어 주문을 삭제할 수 없습니다.")
            cur.execute("DELETE FROM aiorder02t WHERE companyid=%s AND orderid=%s", (companyid, orderid))
            cur.execute("DELETE FROM aiorder01t WHERE companyid=%s AND orderid=%s", (companyid, orderid))
        conn.commit()
    return True


def save_stock_matches(companyid, orderid, lineno, sources, actor=None):
    """Replace the stock links for one tenant-owned order line. Empty = 연결 초기화."""
    normalized = []
    for source in sources:
        source_type = str(source.sourcetype or "").strip().upper()
        source_no = str(source.sourceno or "").strip()
        source_line = int(source.sourceline)
        if source_type not in {"OPENING", "INBOUND", "PROCESS"} or not source_no or source_line <= 0:
            raise ValueError("선택한 현재고 원천 정보를 확인해 주세요.")
        normalized.append((source_type, source_no, source_line))
    if len(normalized) != len(set(normalized)):
        raise ValueError("같은 현재고를 중복 선택할 수 없습니다.")

    with connection() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("""
            SELECT companyname, optimize_status FROM aiorder02t
            WHERE companyid=%s AND orderid=%s AND lineno=%s FOR UPDATE
        """, (companyid, orderid, lineno))
        line = cur.fetchone()
        if not line:
            return False
        if line["optimize_status"] != "NONE":
            raise ValueError(LOCKED_MESSAGE)

        if normalized:
            tuples_sql = ",".join(["(%s,%s,%s)"] * len(normalized))
            params = [companyid]
            for source in normalized:
                params.extend(source)
            cur.execute(f"""
                SELECT sourcetype, sourceno, sourceline
                FROM currentstock01t
                WHERE companyid=%s AND (qty > 0 OR weight > 0)
                  AND (sourcetype, sourceno, sourceline) IN ({tuples_sql})
                ORDER BY sourcetype, sourceno, sourceline
                FOR UPDATE
            """, params)
            available = {(row["sourcetype"], row["sourceno"], int(row["sourceline"])) for row in cur.fetchall()}
            if set(normalized) - available:
                raise ValueError("현재고가 변경되었거나 사용할 수 없는 재고가 있습니다. 현재고를 다시 조회해 주세요.")

            source_params = [value for source in normalized for value in source]
            cur.execute(f"""
                SELECT 1 FROM aiorder03t
                WHERE companyid=%s
                  AND NOT (orderid=%s AND lineno=%s)
                  AND (stocksourcetype, stocksourceno, stocksourceline) IN ({tuples_sql})
                LIMIT 1
            """, [companyid, orderid, lineno, *source_params])
            if cur.fetchone():
                raise ValueError("선택한 현재고는 다른 주문 품목에 이미 연결되어 있습니다. 다른 현재고를 선택해 주세요.")

        cur.execute("DELETE FROM aiorder03t WHERE companyid=%s AND orderid=%s AND lineno=%s", (companyid, orderid, lineno))
        for matchlineno, key in enumerate(normalized, start=1):
            cur.execute("""
                INSERT INTO aiorder03t
                    (companyid, companyname, orderid, lineno, matchlineno,
                     stocksourcetype, stocksourceno, stocksourceline, created_by)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """, (companyid, line["companyname"], orderid, lineno, matchlineno, *key, actor or None))
        cur.execute("""
            UPDATE aiorder02t SET updated_at=CURRENT_TIMESTAMP, updated_by=COALESCE(%s, updated_by)
            WHERE companyid=%s AND orderid=%s AND lineno=%s
        """, (actor or None, companyid, orderid, lineno))
        conn.commit()
    return True


def set_optimize_status(companyid, orderid, linenos, send, actor=None):
    """주문서 관리의 '가공 최적화로 보내기'(NONE → WAITING) / '보내기 취소'(WAITING → NONE).

    계획확정·가공완료 상태는 여기서 바꾸지 않는다 (가공 최적화 담당).
    Returns (changed linenos, skipped linenos) or None if the order does not exist.
    """
    linenos = sorted({int(n) for n in linenos})
    if not linenos:
        raise ValueError("품목을 선택해 주세요.")
    source, target = ("NONE", "WAITING") if send else ("WAITING", "NONE")
    with connection() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT 1 FROM aiorder01t WHERE companyid=%s AND orderid=%s FOR UPDATE", (companyid, orderid))
        if cur.fetchone() is None:
            return None
        cur.execute("""
            SELECT lineno, optimize_status FROM aiorder02t
            WHERE companyid=%s AND orderid=%s AND lineno = ANY(%s) ORDER BY lineno FOR UPDATE
        """, (companyid, orderid, linenos))
        rows = cur.fetchall()
        if len(rows) != len(linenos):
            raise ValueError("주문에 포함되지 않은 품목이 있습니다. 다시 조회해 주세요.")
        changed = [row["lineno"] for row in rows if row["optimize_status"] == source]
        skipped = [row["lineno"] for row in rows if row["optimize_status"] != source]
        if not send and changed:
            # 가공 최적화에서 임시저장·확정한 계획에 들어 있는 품목은 되돌리지 않는다 (계획이 고아가 되지 않게)
            cur.execute("""SELECT DISTINCT d.orderlineno, p.planno FROM aiplan02t d
                           JOIN aiplan01t p ON p.companyid = d.companyid AND p.planno = d.planno
                           WHERE d.companyid = %s AND d.orderid = %s AND d.orderlineno = ANY(%s)
                             AND p.status IN ('DRAFT', 'CONFIRMED')""", (companyid, orderid, changed))
            planned = cur.fetchall()
            if planned:
                raise ValueError("가공 최적화의 계획에 들어 있는 품목은 되돌릴 수 없습니다: "
                                 + ", ".join(f"{r['orderlineno']}행({r['planno']})" for r in planned[:5])
                                 + ". 가공 최적화에서 계획을 삭제·취소한 뒤 되돌려 주세요.")
        if changed:
            cur.execute("""
                UPDATE aiorder02t SET optimize_status=%s, updated_at=CURRENT_TIMESTAMP, updated_by=COALESCE(%s, updated_by)
                WHERE companyid=%s AND orderid=%s AND lineno = ANY(%s)
            """, (target, actor or None, companyid, orderid, changed))
            cur.execute(
                "UPDATE aiorder01t SET updated_at=CURRENT_TIMESTAMP, updated_by=COALESCE(%s, updated_by) WHERE companyid=%s AND orderid=%s",
                (actor or None, companyid, orderid),
            )
        conn.commit()
    return changed, skipped


def dimensions(size):
    text = str(size or "").replace(",", "")
    match = re.search(r"(?<![\d.])(\d+(?:\.\d+)?)\s*[xX×*]\s*(\d+(?:\.\d+)?)(?:\s*[xX×*]\s*(\d+(?:\.\d+)?))?", text)
    return tuple(Decimal(part) if part else None for part in match.groups()) if match else (None, None, None)


def form_of(value):
    text = str(value or "").upper()
    for form in ("COIL", "SKELP", "SHEET"):
        if re.search(rf"\b{form}\b", text):
            return form
    return None


def _like_pattern(text):
    """LIKE %text% pattern with the user's text matched literally (\\, %, _ escaped)."""
    return "%" + text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def stock_candidates(companyid, orderid, lineno, thickness_from=None, thickness_to=None, page=1, page_size=50,
                     itemname=None, surface=None, width=None, length=None, warehouse=None):
    """Current stock list for the matching modal; the person in charge chooses the rows.

    Optional filters entered in the modal: item name (LIKE %품명%; defaults to the order item
    name when not sent, empty = no name filter) and thickness from/to (each only when entered).
    """
    order = get_order(companyid, orderid)
    if not order:
        return None
    item = next((row for row in order["items"] if row["lineno"] == lineno), None)
    if not item:
        return None
    order_name = str(item["itemname"] or "").strip()
    search_name = order_name if itemname is None else str(itemname).strip()
    order_thick = Decimal(str(item["thickness"])) if item["thickness"] is not None else dimensions(item["size"])[0]
    order_width = Decimal(str(item["width"])) if item["width"] is not None else dimensions(item["size"])[1]
    order_length = Decimal(str(item["length"])) if item["length"] is not None else dimensions(item["size"])[2]
    page = max(1, int(page or 1))
    page_size = max(1, min(200, int(page_size or 50)))
    base = {"orderid": orderid, "lineno": lineno, "page": page, "page_size": page_size,
            "itemname": search_name,
            "thickness_from": float(thickness_from) if thickness_from is not None else None,
            "thickness_to": float(thickness_to) if thickness_to is not None else None}
    # Only fixed SQL fragments are added here; every value stays a bound parameter.
    filters = ["s.companyid=%(companyid)s", "(s.qty>0 OR s.weight>0)"]
    params = {"companyid": companyid}
    if search_name:
        filters.append("(s.itemname ILIKE %(pattern)s ESCAPE '\\' OR m.itemname ILIKE %(pattern)s ESCAPE '\\')")
        params["pattern"] = "%" + search_name.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    if thickness_from is not None:
        filters.append("s.thickness >= %(t_from)s")
        params["t_from"] = thickness_from
    if thickness_to is not None:
        filters.append("s.thickness <= %(t_to)s")
        params["t_to"] = thickness_to
    surface_text = str(surface or "").strip()
    if surface_text:
        filters.append("(s.surfacename ILIKE %(surface)s ESCAPE '\\' OR s.surfacecode ILIKE %(surface)s ESCAPE '\\')")
        params["surface"] = _like_pattern(surface_text)
    if width is not None:
        filters.append("s.width = %(width)s")
        params["width"] = width
    if length is not None:
        filters.append("COALESCE(s.length, 0) = %(length)s")
        params["length"] = length
    warehouse_text = str(warehouse or "").strip()
    if warehouse_text:
        filters.append("(s.warehousecodename ILIKE %(warehouse)s ESCAPE '\\' OR s.warehousecode ILIKE %(warehouse)s ESCAPE '\\')")
        params["warehouse"] = _like_pattern(warehouse_text)
    where_sql = " AND ".join(filters)
    with connection() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
        # Filtered, ordered and paged in the database (tenant scoped on both sides of the join).
        # Order: same size first, then same thickness, then nearest thickness, then larger quantity.
        cur.execute(f"""
            SELECT s.sourcetype AS stocksourcetype, s.sourceno AS stocksourceno,
                   s.sourceline AS stocksourceline,
                   s.itemcode, s.itemname, s.productname, s.materialcode, s.materialname,
                   s.surfacecode, s.surfacename, s.receiptdate,
                   s.thickness, s.width, s.length, s.qty, s.qtyunit, s.weight,
                   s.warehousecode, s.warehousecodename, m.itemname AS master_itemname,
                   m.itemtypecode,
                   EXISTS (
                     SELECT 1 FROM aiorder03t linked
                     WHERE linked.companyid=s.companyid
                       AND linked.stocksourcetype=s.sourcetype
                       AND linked.stocksourceno=s.sourceno
                       AND linked.stocksourceline=s.sourceline
                       AND NOT (linked.orderid=%(orderid)s AND linked.lineno=%(lineno)s)
                   ) AS matched_elsewhere,
                   COUNT(*) OVER () AS total_count
            FROM currentstock01t s LEFT JOIN itemcode01t m
              ON m.companyid=s.companyid AND m.itemcode=s.itemcode
            WHERE {where_sql}
            ORDER BY
              CASE WHEN %(ot)s::numeric IS NOT NULL AND s.thickness = %(ot)s::numeric
                         AND (%(ow)s::numeric IS NULL OR s.width IS NULL OR s.width = %(ow)s::numeric)
                         AND (%(ol)s::numeric IS NULL OR s.length IS NULL OR s.length = %(ol)s::numeric) THEN 1
                   WHEN %(ot)s::numeric IS NOT NULL AND s.thickness = %(ot)s::numeric THEN 2
                   ELSE 3 END,
              ABS(s.thickness - COALESCE(%(ot)s::numeric, 0)),
              s.qty DESC, s.width, s.itemcode, s.warehousecode, s.sourcetype, s.sourceno, s.sourceline
            LIMIT %(limit)s OFFSET %(offset)s
        """, {**params, "orderid": orderid, "lineno": lineno,
              "ot": order_thick, "ow": order_width, "ol": order_length,
              "limit": page_size, "offset": (page - 1) * page_size})
        rows = cur.fetchall()
        total = rows[0]["total_count"] if rows else 0
        if not rows and page > 1:
            # Requested page is past the end (e.g. after narrowing the filters): report the real total.
            cur.execute(f"""
                SELECT COUNT(*) AS total_count
                FROM currentstock01t s LEFT JOIN itemcode01t m
                  ON m.companyid=s.companyid AND m.itemcode=s.itemcode
                WHERE {where_sql}
            """, params)
            total = cur.fetchone()["total_count"]
    candidates = []
    for row in rows:
        row.pop("total_count", None)
        thick, width, length = row["thickness"], row["width"], row["length"]
        row["size"] = " × ".join(format(value.normalize(), "f") for value in (thick, width, length) if value is not None)
        same_size = order_thick is not None and thick == order_thick and all(
            a is None or b is None or a == b for a, b in ((order_width, width), (order_length, length)))
        if same_size:
            category, reason, priority = "동일 규격", "주문 두께와 확인 가능한 치수가 일치", 1
        elif order_thick is not None and thick is not None and thick == order_thick:
            category, reason, priority = "두께 일치", "주문 두께 일치 · 폭/길이 확인 필요", 2
        else:
            category, priority = "현재고", 3
            reason = (f"주문 두께와 {format((thick - order_thick).normalize(), '+f')}mm 차이"
                      if order_thick is not None and thick is not None else "")
        candidates.append({**as_dict(row), "category": category, "reason": reason, "priority": priority,
                           "source_form": form_of(row["itemtypecode"]) or form_of(row["master_itemname"] or row["itemname"])})
    return {**base, "candidates": candidates, "total_candidates": int(total)}
