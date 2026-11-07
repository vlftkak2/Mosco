"""Confirmed AI orders and read-only stock candidates."""

import re
from contextlib import contextmanager
from datetime import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

import psycopg2
from psycopg2.extras import RealDictCursor

from config import DB_CONFIG
import db as _shared_db


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
                   (SELECT COUNT(*) FROM aiorder02t d WHERE d.companyid=h.companyid AND d.orderid=h.orderid) AS item_count,
                   (SELECT COALESCE(SUM(d.weight_kg), 0) FROM aiorder02t d
                    WHERE d.companyid=h.companyid AND d.orderid=h.orderid) AS total_weight,
                   COALESCE((SELECT CASE
                       WHEN COUNT(*) = 0 THEN 'REVIEW_PENDING'
                        WHEN COUNT(*) FILTER (WHERE d.processing_status <> 'CANCELLED') = 0 THEN 'CANCELLED'
                        WHEN BOOL_AND(d.processing_status = 'PROCESSING_DONE')
                             FILTER (WHERE d.processing_status <> 'CANCELLED') THEN 'PROCESSING_DONE'
                        WHEN BOOL_AND(d.processing_status = 'NOT_REQUIRED')
                             FILTER (WHERE d.processing_status <> 'CANCELLED') THEN 'NOT_REQUIRED'
                        WHEN BOOL_OR(d.processing_status = 'PROCESSING_REVIEW')
                             FILTER (WHERE d.processing_status <> 'CANCELLED') THEN 'PROCESSING_REVIEW'
                       ELSE 'REVIEW_PENDING' END
                     FROM aiorder02t d WHERE d.companyid=h.companyid AND d.orderid=h.orderid),
                     'REVIEW_PENDING') AS progress
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
                   quantity, quantity_unit, weight_kg, notes, quantity_raw, weight_raw,
                   stock_match_status, processing_status
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


def update_order(companyid, orderid, buyer, recipient, order_date, due_date, delivery_location):
    """Update editable confirmed-order header fields within the tenant."""
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE aiorder01t
                SET buyer = %s, recipient = %s, orderdate = %s,
                    duedate = %s, deliverylocation = %s
                WHERE companyid = %s AND orderid = %s
            """, (buyer, recipient, order_date, due_date, delivery_location, companyid, orderid))
            updated = cur.rowcount > 0
        conn.commit()
    return updated


def update_order_items(companyid, orderid, items):
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
                "SELECT lineno FROM aiorder02t WHERE companyid=%s AND orderid=%s ORDER BY lineno FOR UPDATE",
                (companyid, orderid),
            )
            existing_lines = [row["lineno"] for row in cur.fetchall()]
            submitted_lines = [item.lineno for item in items if item.lineno is not None]
            if len(set(submitted_lines)) != len(submitted_lines) or not set(submitted_lines).issubset(existing_lines):
                raise ValueError("주문에 포함되지 않은 상세 행이 있습니다. 다시 조회한 뒤 저장해 주세요.")

            removed_lines = set(existing_lines) - set(submitted_lines)
            if removed_lines:
                cur.execute(
                    "DELETE FROM aiorder02t WHERE companyid=%s AND orderid=%s AND lineno = ANY(%s)",
                    (companyid, orderid, list(removed_lines)),
                )

            next_lineno = max(existing_lines, default=0)

            for item in items:
                values = (
                    item.itemname, item.steelgrade, item.size, item.thickness, item.width,
                    item.length, item.quantity, item.quantity_unit, item.weight_kg,
                    item.notes, item.quantity_raw, item.weight_raw,
                )
                if item.lineno is None:
                    next_lineno += 1
                    cur.execute("""
                        INSERT INTO aiorder02t
                            (companyid, companyname, orderid, lineno, itemname, steelgrade, size,
                             thickness, width, length, quantity, quantity_unit, weight_kg, notes,
                             quantity_raw, weight_raw)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """, (companyid, header["companyname"], orderid, next_lineno, *values))
                else:
                    cur.execute("""
                        UPDATE aiorder02t
                        SET itemname=%s, steelgrade=%s, size=%s, thickness=%s, width=%s,
                            length=%s, quantity=%s, quantity_unit=%s, weight_kg=%s,
                            notes=%s, quantity_raw=%s, weight_raw=%s
                        WHERE companyid=%s AND orderid=%s AND lineno=%s
                    """, (*values, companyid, orderid, item.lineno))
                    if cur.rowcount != 1:
                        raise ValueError("주문 상세 행을 찾을 수 없습니다. 다시 조회한 뒤 저장해 주세요.")
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
            cur.execute("DELETE FROM aiorder02t WHERE companyid=%s AND orderid=%s", (companyid, orderid))
            cur.execute("DELETE FROM aiorder01t WHERE companyid=%s AND orderid=%s", (companyid, orderid))
        conn.commit()
    return True


def save_stock_matches(companyid, orderid, lineno, status, sources):
    """Replace the stock links and match state for one tenant-owned order line."""
    status = str(status or "").strip().upper()
    if status not in {"UNREVIEWED", "MATCHED", "NO_STOCK"}:
        raise ValueError("재고매칭 상태를 확인해 주세요.")
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
    if status == "MATCHED" and not normalized:
        raise ValueError("재고 연결을 선택해 주세요.")
    if status != "MATCHED" and normalized:
        raise ValueError("재고를 연결할 때만 선택 재고를 전달해 주세요.")

    with connection() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("""
            SELECT companyname FROM aiorder02t
            WHERE companyid=%s AND orderid=%s AND lineno=%s FOR UPDATE
        """, (companyid, orderid, lineno))
        line = cur.fetchone()
        if not line:
            return False

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
                FOR SHARE
            """, params)
            available = {(row["sourcetype"], row["sourceno"], int(row["sourceline"])) for row in cur.fetchall()}
            missing = set(normalized) - available
            if missing:
                raise ValueError("현재고가 변경되었거나 사용할 수 없는 재고가 있습니다. 현재고를 다시 조회해 주세요.")

        cur.execute("DELETE FROM aiorder03t WHERE companyid=%s AND orderid=%s AND lineno=%s", (companyid, orderid, lineno))
        for matchlineno, (source_type, source_no, source_line) in enumerate(normalized, start=1):
            cur.execute("""
                INSERT INTO aiorder03t
                    (companyid, companyname, orderid, lineno, matchlineno,
                     stocksourcetype, stocksourceno, stocksourceline)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
            """, (companyid, line["companyname"], orderid, lineno, matchlineno,
                  source_type, source_no, source_line))
        cur.execute("""
            UPDATE aiorder02t SET stock_match_status=%s, updated_at=CURRENT_TIMESTAMP
            WHERE companyid=%s AND orderid=%s AND lineno=%s
        """, (status, companyid, orderid, lineno))
        conn.commit()
    return True


def update_processing_status(companyid, orderid, lineno, status):
    allowed = {"REVIEW_PENDING", "PROCESSING_REVIEW", "PROCESSING_DONE", "NOT_REQUIRED", "CANCELLED"}
    status = str(status or "").strip().upper()
    if status not in allowed:
        raise ValueError("가공상태를 확인해 주세요.")
    with connection() as conn, conn.cursor() as cur:
        cur.execute("""
            UPDATE aiorder02t SET processing_status=%s, updated_at=CURRENT_TIMESTAMP
            WHERE companyid=%s AND orderid=%s AND lineno=%s
        """, (status, companyid, orderid, lineno))
        updated = cur.rowcount == 1
        conn.commit()
    return updated


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
                   m.itemtypecode, COUNT(*) OVER () AS total_count
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
        """, {**params, "ot": order_thick, "ow": order_width, "ol": order_length,
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
