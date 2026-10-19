"""Confirmed AI orders and read-only stock candidates."""

import re
from contextlib import contextmanager
from datetime import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

import psycopg2
from psycopg2.extras import RealDictCursor

from config import DB_CONFIG


@contextmanager
def connection():
    conn = psycopg2.connect(
        host=DB_CONFIG["host"], port=DB_CONFIG["port"], dbname=DB_CONFIG["database"],
        user=DB_CONFIG["user"], password=DB_CONFIG["password"], connect_timeout=5,
    )
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
                     buyer, recipient, orderdate, duedate, deliverylocation, sourcefilename)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (companyid, companyname, orderid, request_id, username, email,
                  h.buyer, h.recipient, h.order_date, h.due_date, h.delivery_location,
                  payload.sourcefilename))
            for lineno, item in enumerate(payload.items, start=1):
                cur.execute("""
                    INSERT INTO aiorder02t
                        (companyid, companyname, orderid, lineno, itemname, steelgrade, size,
                         thickness, width, length, quantity, quantity_unit, weight_kg, notes,
                         quantity_raw, weight_raw)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, (companyid, companyname, orderid, lineno, item.source_product_name,
                      item.steel_grade, item.spec_raw, item.thickness, item.width, item.length,
                      item.quantity, item.quantity_unit, item.weight_kg, item.notes,
                      item.quantity_raw, item.weight_raw))
        conn.commit()
    return {"orderid": orderid, "already_confirmed": False}


def list_orders(companyid, start_date=None, end_date=None, buyer=None, orderid=None, page=1, page_size=30):
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
    where = " AND ".join(clauses)
    with connection() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(f"SELECT COUNT(*) AS total FROM aiorder01t h WHERE {where}", args)
        total = cur.fetchone()["total"]
        cur.execute(f"""
            SELECT h.orderid, h.buyer, h.recipient, h.orderdate, h.duedate, h.deliverylocation,
                   h.username, h.useremail, h.created_at,
                   (SELECT COUNT(*) FROM aiorder02t d WHERE d.companyid=h.companyid AND d.orderid=h.orderid) AS item_count
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
        cur.execute("""
            SELECT lineno, itemname, steelgrade, size, thickness, width, length,
                   quantity, quantity_unit, weight_kg, notes, quantity_raw, weight_raw
            FROM aiorder02t WHERE companyid=%s AND orderid=%s ORDER BY lineno
        """, (companyid, orderid))
        return {"header": as_dict(header), "items": [as_dict(row) for row in cur.fetchall()]}


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
            cur.execute("DELETE FROM aiorder02t WHERE companyid=%s AND orderid=%s", (companyid, orderid))
            cur.execute("DELETE FROM aiorder01t WHERE companyid=%s AND orderid=%s", (companyid, orderid))
        conn.commit()
    return True


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


def stock_candidates(companyid, orderid, lineno):
    order = get_order(companyid, orderid)
    if not order:
        return None
    item = next((row for row in order["items"] if row["lineno"] == lineno), None)
    if not item:
        return None
    grade_verified = bool(str(item["steelgrade"] or "").strip())
    material_name = str(item["steelgrade"] or item["itemname"] or "").strip().upper()
    order_thick = Decimal(str(item["thickness"])) if item["thickness"] is not None else dimensions(item["size"])[0]
    order_width = Decimal(str(item["width"])) if item["width"] is not None else dimensions(item["size"])[1]
    order_length = Decimal(str(item["length"])) if item["length"] is not None else dimensions(item["size"])[2]
    target_form = form_of(item["itemname"])
    matches = []
    with connection() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
        # Both the stock and master join are explicitly tenant scoped.
        cur.execute("""
            SELECT s.itemcode, s.itemname, s.size, s.qty, s.qtyunit, s.weight,
                   s.warehousecode, s.warehousecodename, m.itemname AS master_itemname,
                   m.itemtypecode
            FROM currentstock01t s LEFT JOIN itemcode01t m
              ON m.companyid=s.companyid AND m.itemcode=s.itemcode
            WHERE s.companyid=%s AND s.qty>0
            ORDER BY s.itemcode, s.warehousecode
        """, (companyid,))
        rows = cur.fetchall()
    process_paths = {("COIL", "SKELP"), ("COIL", "SHEET"), ("SKELP", "SHEET"), ("SHEET", "SHEET")}
    for row in rows:
        name = str(row["master_itemname"] or row["itemname"] or "")
        if not material_name or not re.search(rf"(?<![A-Z0-9]){re.escape(material_name)}(?![A-Z0-9])", name.upper()):
            continue
        thick, width, length = dimensions(row["size"])
        source_form = form_of(row["itemtypecode"]) or form_of(name)
        if order_thick is None or thick is None:
            category, reason = "규격 확인 필요", "품목명 일치 · 재고 규격 확인 필요"
            priority = 4
        elif thick == order_thick and all(a is None or b is None or a == b for a, b in ((order_width, width), (order_length, length))):
            if order_width is not None and width is not None and (order_length is None or length is not None):
                category, reason, priority = "동일 규격 후보", "품목명과 확인 가능한 규격 치수가 일치", 1
            else:
                category, reason, priority = "규격 확인 필요", "품목명·두께 일치 · 폭/길이 확인 필요", 4
        elif thick == order_thick and width is not None and order_width is not None and width > order_width and (order_length is None or (length is not None and length >= order_length)) and (source_form, target_form) in process_paths:
            category, reason, priority = "가공 검토 후보", f"{source_form} → {target_form} · 치수상 검토 가능 (설비·공정 확인 필요)", 2
        elif thick == order_thick and width is not None and order_width is not None and width > order_width and order_length is None and source_form in {"COIL", "SKELP", "SHEET"} and target_form is None:
            category, reason, priority = "가공 검토 후보", f"{source_form} 재고 폭이 주문 폭보다 큼 · 주문 형태·설비 확인 필요", 2
        elif (Decimal("0") < abs(thick - order_thick) <= Decimal("0.05")
              and (order_width is None or (width is not None and width >= order_width))
              and (order_length is None or (length is not None and length >= order_length))):
            category, reason, priority = "두께 대체 검토", "품목명 일치 · 두께 차이 ±0.05mm 이내 (승인 필요)", 3
        else:
            continue
        if not grade_verified:
            reason += " · 주문 강종 미기재"
        matches.append({**as_dict(row), "category": category, "reason": reason, "priority": priority, "source_form": source_form})
    matches.sort(key=lambda row: (row["priority"], -float(row["qty"])))
    return {"orderid": orderid, "lineno": lineno, "candidates": matches[:100], "total_candidates": len(matches),
            "notice": "후보 조회 전용입니다. 규격·설비·공정·로스율을 검증한 뒤 가공 가능 여부를 판단하세요."}
