"""가공 최적화 (메뉴: AI_OPTIMIZATION).

흐름: 주문서 관리에서 보낸 품목(aiorder02t.optimize_status = WAITING) → 이 화면에서
  ① 발주·원자재 확인  발주량 − 선가공재고(연결 재고 중 주문 규격과 같은 것) = 필요량
  ② 원자재 후보       연결 원자재 → 같은 품명·두께의 현재고 → 과거 매입 규격(신규) → 직접 입력
  ③ 원자재·가공방식   폭·중량·두께·기본 로스(4mm), 원샷/등분/일부가공 (시트: 원판 규격·매수·절단방향)
  ④ 추천조합          단독 / 혼합(같은 소재의 다른 대기 품목·추가 폭)  → A·B·C안
  창고: 한 계획은 한 창고에서만. 주문 품목의 창고 = 재고매칭으로 연결한 재고의 창고.
        연결 재고가 여러 창고에 걸치면 함께 계산하지 않고, 원자재 후보도 그 창고 현재고만 쓴다.
  → 임시저장(DRAFT) / 계획 확정(CONFIRMED: 품목 PLANNED, 원자재 현재고 예약) / 계획 취소 / 주문서 관리로 돌려보내기

코일 = 주문 길이 없음(폭으로 슬리팅, kg 기준), 시트 = 길이 있음(원판에서 절단, 매 기준).
계산식은 시안(스틸119 가공최적화 v77)과 같다.
  코일 투입중량: 현재고 = 원코일 실제중량, 신규 = 필요중량 × (후보폭 ÷ 사용폭)
  코일 생산중량 = 투입중량 × (사용폭 ÷ 후보폭),  로스 = 투입 − 생산,  수율 = 생산 ÷ 투입
  시트 로스면적 = 원판면적 × 매수 − 제품면적 합,  중량 = 면적 × 두께 × 7.85e-6
"""
from __future__ import annotations

import json
import re
from contextlib import contextmanager
from datetime import datetime
from decimal import Decimal
from math import ceil, floor
from zoneinfo import ZoneInfo

from psycopg2.extras import RealDictCursor

import db as _shared_db

TRIM_LOSS_DEFAULT = 4.0            # 기본 로스(mm) - 회사 기본값
STEEL_DENSITY = 7.85e-6            # kg / mm³
MAX_MIX_WIDTHS = 6                 # 혼합에 쓰는 서로 다른 폭 수
MAX_CUTS = 60                      # 코일 1개에서 낼 수 있는 칼 수 상한
MAX_SHEETS = 500
PLAN_STATUSES = ("DRAFT", "CONFIRMED", "DONE", "CANCELLED")


@contextmanager
def _connection():
    conn = _shared_db.open_connection()
    try:
        yield conn
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ---------------------------------------------------------------- 공통 숫자 처리
_NUMBER_RE = re.compile(r"[-+]?\d[\d,]*(?:\.\d+)?|[-+]?\.\d+")


def to_number(value) -> float | None:
    """숫자 또는 글자('1,000매', '약 1000 kg')에서 첫 숫자를 읽는다. 없으면 None."""
    if value is None or value == "":
        return None
    if isinstance(value, (int, float, Decimal)):
        return float(value)
    match = _NUMBER_RE.search(str(value))
    if not match:
        return None
    try:
        return float(match.group(0).replace(",", ""))
    except ValueError:
        return None


def _f(value) -> float:
    return float(value) if value is not None else 0.0


def _round(value, digits=3):
    return round(float(value), digits) if value is not None else None


def material_of(length) -> str:
    return "SHEET" if (to_number(length) or 0) > 0 else "COIL"


# ---------------------------------------------------------------- 대기 품목
def _line_row(row: dict) -> dict:
    """주문 품목 한 줄 → 계산에 쓰는 값 + 확인 필요 항목."""
    qty = to_number(row["quantity"]) if row["quantity"] is not None else to_number(row["quantity_raw"])
    weight = to_number(row["weight_kg"]) if row["weight_kg"] is not None else to_number(row["weight_raw"])
    material = material_of(row["length"])
    missing = []
    if not str(row["itemname"] or "").strip():
        missing.append("품명")
    if not (to_number(row["thickness"]) or 0) > 0:
        missing.append("두께")
    if not (to_number(row["width"]) or 0) > 0:
        missing.append("폭")
    if material == "COIL" and not (weight or 0) > 0:
        missing.append("중량")
    if material == "SHEET" and not (qty or 0) > 0:
        missing.append("수량")
    converted = []
    if row["quantity"] is None and row["quantity_raw"] and qty is not None:
        converted.append(f"수량 '{row['quantity_raw']}' → {qty:g}")
    if row["weight_kg"] is None and row["weight_raw"] and weight is not None:
        converted.append(f"중량 '{row['weight_raw']}' → {weight:g}")
    return {
        "orderid": row["orderid"], "lineno": row["lineno"], "key": f"{row['orderid']}|{row['lineno']}",
        "buyer": row.get("buyer"), "orderdate": row.get("orderdate"), "duedate": row.get("duedate"),
        "itemname": row["itemname"], "steelgrade": row["steelgrade"], "surface": row["surface"],
        "thickness": _round(row["thickness"]), "width": _round(row["width"]), "length": _round(row["length"]),
        "quantity": qty, "quantity_unit": row["quantity_unit"], "weight": weight,
        "quantity_raw": row["quantity_raw"], "weight_raw": row["weight_raw"],
        "material": material, "missing": missing, "converted": converted,
        "optimize_status": row["optimize_status"], "notes": row["notes"],
    }


def _load_lines(cur, companyid: str, keys=None, status=None) -> list[dict]:
    where = ["d.companyid = %s"]
    params: list = [companyid]
    if status:
        where.append("d.optimize_status = ANY(%s)")
        params.append(list(status))
    if keys is not None:
        if not keys:
            return []
        where.append("(d.orderid, d.lineno) IN (SELECT * FROM unnest(%s::varchar[], %s::integer[]))")
        params.extend([[k[0] for k in keys], [int(k[1]) for k in keys]])
    cur.execute(f"""
        SELECT d.orderid, d.lineno, d.itemname, d.steelgrade, d.surface, d.thickness, d.width, d.length,
               d.quantity, d.quantity_unit, d.weight_kg, d.quantity_raw, d.weight_raw, d.notes, d.optimize_status,
               h.buyer, h.orderdate, h.duedate
        FROM aiorder02t d
        JOIN aiorder01t h ON h.companyid = d.companyid AND h.orderid = d.orderid
        WHERE {' AND '.join(where)}
        ORDER BY h.duedate NULLS LAST, d.orderid, d.lineno
    """, params)
    return [_line_row(row) for row in cur.fetchall()]


def _linked_stock(cur, companyid: str, lines: list[dict]) -> dict:
    """주문 품목별 연결 재고 (주문서 관리 재고매칭)."""
    if not lines:
        return {}
    cur.execute("""
        SELECT l.orderid, l.lineno, l.stocksourcetype, l.stocksourceno, l.stocksourceline,
               s.itemname, s.thickness, s.width, s.length, s.qty, s.weight, s.warehousecode, s.warehousecodename
        FROM aiorder03t l
        JOIN currentstock01t s ON s.companyid = l.companyid AND s.sourcetype = l.stocksourcetype
                              AND s.sourceno = l.stocksourceno AND s.sourceline = l.stocksourceline
        WHERE l.companyid = %s
          AND (l.orderid, l.lineno) IN (SELECT * FROM unnest(%s::varchar[], %s::integer[]))
          AND (s.qty > 0 OR s.weight > 0)
        ORDER BY l.orderid, l.lineno, l.matchlineno
    """, (companyid, [x["orderid"] for x in lines], [x["lineno"] for x in lines]))
    result: dict = {}
    for row in cur.fetchall():
        result.setdefault(f"{row['orderid']}|{row['lineno']}", []).append({
            "sourcetype": row["stocksourcetype"], "sourceno": row["stocksourceno"], "sourceline": row["stocksourceline"],
            "itemname": row["itemname"], "thickness": _round(row["thickness"]), "width": _round(row["width"]),
            "length": _round(row["length"]), "qty": _f(row["qty"]), "weight": _f(row["weight"]),
            "warehousecode": row["warehousecode"], "warehouse": row["warehousecodename"],
        })
    return result


def _same_size(a, b) -> bool:
    a, b = to_number(a) or 0, to_number(b) or 0
    return abs(a - b) < 1e-6


def _split_stock(line: dict, stocks: list[dict]) -> tuple[list[dict], list[dict]]:
    """연결 재고 → (선가공재고 = 주문과 같은 폭·길이, 원자재 = 그 밖)."""
    ready, raw = [], []
    for stock in stocks:
        same = _same_size(stock["width"], line["width"]) and _same_size(stock["length"], line["length"])
        (ready if same else raw).append(stock)
    return ready, raw


def _with_need(line: dict, stocks: list[dict]) -> dict:
    ready, raw = _split_stock(line, stocks)
    if line["material"] == "COIL":
        order_amount = line["weight"] or 0
        ready_amount = sum(s["weight"] for s in ready)
    else:
        order_amount = line["quantity"] or 0
        ready_amount = sum(s["qty"] for s in ready)
    warehouses = sorted({(s["warehousecode"], s["warehouse"]) for s in stocks if s.get("warehousecode")})
    return {**line, "ready": ready, "raw_links": raw, "order_amount": order_amount,
            "warehouses": [{"code": code, "name": name} for code, name in warehouses],
            "ready_amount": ready_amount, "need_amount": max(0.0, order_amount - ready_amount)}


def list_queue(companyid: str, status: str = "WAITING", buyer: str = "", itemname: str = "") -> dict:
    statuses = {"WAITING": ["WAITING"], "PLANNED": ["PLANNED"], "ALL": ["WAITING", "PLANNED"]}.get(status, ["WAITING"])
    with _connection() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
        lines = _load_lines(cur, companyid, status=statuses)
        if buyer.strip():
            lines = [x for x in lines if buyer.strip().lower() in str(x["buyer"] or "").lower()]
        if itemname.strip():
            lines = [x for x in lines if itemname.strip().lower() in str(x["itemname"] or "").lower()]
        links = _linked_stock(cur, companyid, lines)
        plans = _plans_by_line(cur, companyid, lines)
    items = []
    for line in lines:
        row = _with_need(line, links.get(line["key"], []))
        row["plans"] = plans.get(line["key"], [])
        items.append(row)
    return {"items": items, "trim_loss_default": TRIM_LOSS_DEFAULT}


def _plans_by_line(cur, companyid: str, lines: list[dict]) -> dict:
    if not lines:
        return {}
    cur.execute("""
        SELECT p2.orderid, p2.orderlineno, p1.planno, p1.status
        FROM aiplan02t p2 JOIN aiplan01t p1 ON p1.companyid = p2.companyid AND p1.planno = p2.planno
        WHERE p2.companyid = %s AND p1.status IN ('DRAFT', 'CONFIRMED')
          AND (p2.orderid, p2.orderlineno) IN (SELECT * FROM unnest(%s::varchar[], %s::integer[]))
        ORDER BY p1.planno
    """, (companyid, [x["orderid"] for x in lines], [x["lineno"] for x in lines]))
    result: dict = {}
    for row in cur.fetchall():
        result.setdefault(f"{row['orderid']}|{row['orderlineno']}", []).append({"planno": row["planno"], "status": row["status"]})
    return result


def update_line(companyid: str, orderid: str, lineno: int, values: dict, actor=None) -> bool:
    """최적화 대기 품목의 값 보완 (두께·폭·길이·수량·중량). 숫자를 넣으면 원문 값은 지운다."""
    fields = {k: values[k] for k in ("thickness", "width", "length", "quantity", "weight_kg") if k in values}
    with _connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT optimize_status FROM aiorder02t WHERE companyid=%s AND orderid=%s AND lineno=%s FOR UPDATE",
                    (companyid, orderid, lineno))
        row = cur.fetchone()
        if not row:
            return False
        if row[0] != "WAITING":
            raise ValueError("최적화 대기 상태인 품목만 수정할 수 있습니다.")
        sets, params = [], []
        for key, value in fields.items():
            sets.append(f"{key} = %s")
            params.append(value)
            if key == "quantity" and value is not None:
                sets.append("quantity_raw = NULL")
            if key == "weight_kg" and value is not None:
                sets.append("weight_raw = NULL")
        if sets:
            cur.execute(f"""UPDATE aiorder02t SET {', '.join(sets)}, updated_at = CURRENT_TIMESTAMP,
                            updated_by = COALESCE(%s, updated_by)
                            WHERE companyid = %s AND orderid = %s AND lineno = %s""",
                        (*params, actor or None, companyid, orderid, lineno))
        conn.commit()
    return True


def return_lines(companyid: str, keys: list, actor=None) -> dict:
    """주문서 관리로 돌려보내기: 최적화 대기 → 미전송. 진행 중인 계획에 들어 있으면 거절."""
    keys = sorted({(str(o), int(n)) for o, n in keys})
    if not keys:
        raise ValueError("돌려보낼 품목을 선택해 주세요.")
    with _connection() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
        lines = _load_lines(cur, companyid, keys=keys)
        if len(lines) != len(keys):
            raise ValueError("선택한 품목을 찾을 수 없습니다. 다시 조회해 주세요.")
        planned = _plans_by_line(cur, companyid, lines)
        blocked = [f"{x['orderid']}-{x['lineno']}" for x in lines if x["optimize_status"] != "WAITING" or planned.get(x["key"])]
        if blocked:
            raise ValueError("계획(임시저장·확정)에 들어 있거나 최적화 대기가 아닌 품목은 돌려보낼 수 없습니다: " + ", ".join(blocked[:5]))
        cur.execute("""UPDATE aiorder02t SET optimize_status = 'NONE', updated_at = CURRENT_TIMESTAMP,
                       updated_by = COALESCE(%s, updated_by)
                       WHERE companyid = %s AND (orderid, lineno) IN (SELECT * FROM unnest(%s::varchar[], %s::integer[]))""",
                    (actor or None, companyid, [k[0] for k in keys], [k[1] for k in keys]))
        conn.commit()
    return {"returned": len(keys)}


# ---------------------------------------------------------------- 원자재 후보
def _reserved_sql(alias: str) -> str:
    """다른 주문에 연결됐거나 확정 계획에 잡힌 현재고 (선택 품목 제외)."""
    return f"""(EXISTS (SELECT 1 FROM aiorder03t lk JOIN aiorder02t ln
                          ON ln.companyid = lk.companyid AND ln.orderid = lk.orderid AND ln.lineno = lk.lineno
                        WHERE lk.companyid = {alias}.companyid AND lk.stocksourcetype = {alias}.sourcetype
                          AND lk.stocksourceno = {alias}.sourceno AND lk.stocksourceline = {alias}.sourceline
                          AND ln.optimize_status <> 'DONE'
                          AND (lk.orderid, lk.lineno) NOT IN (SELECT * FROM unnest(%(korders)s::varchar[], %(klines)s::integer[])))
             OR EXISTS (SELECT 1 FROM aiplan01t pl
                        WHERE pl.companyid = {alias}.companyid AND pl.status = 'CONFIRMED' AND pl.rawkind = 'STOCK'
                          AND pl.planno <> %(planno)s
                          AND pl.stocksourcetype = {alias}.sourcetype AND pl.stocksourceno = {alias}.sourceno
                          AND pl.stocksourceline = {alias}.sourceline))"""


def _stock_candidates(cur, companyid, lines, material, min_width, min_length, linked_keys, planno="", warehouse=None):
    base = lines[0]
    params = {"companyid": companyid, "thick": base["thickness"], "name": f"%{str(base['itemname'] or '').strip()}%",
              "minw": min_width, "minl": min_length or 0, "planno": planno or "", "wh": warehouse,
              "korders": [x["orderid"] for x in lines], "klines": [x["lineno"] for x in lines]}
    length_sql = "COALESCE(s.length, 0) = 0" if material == "COIL" else "COALESCE(s.length, 0) >= %(minl)s"
    cur.execute(f"""
        SELECT s.sourcetype, s.sourceno, s.sourceline, s.itemname, s.materialname, s.surfacename,
               s.thickness, s.width, s.length, s.qty, s.weight, s.warehousecode, s.warehousecodename, s.receiptdate,
               {_reserved_sql('s')} AS reserved
        FROM currentstock01t s
        WHERE s.companyid = %(companyid)s AND s.qty > 0 AND s.weight > 0
          AND s.thickness = %(thick)s AND s.itemname ILIKE %(name)s
          AND s.width >= %(minw)s AND {length_sql}
          AND (%(wh)s::varchar IS NULL OR s.warehousecode = %(wh)s)
        ORDER BY s.width, s.receiptdate LIMIT 200
    """, params)
    rows = []
    for row in cur.fetchall():
        key = (row["sourcetype"], row["sourceno"], int(row["sourceline"]))
        if row["reserved"] and key not in linked_keys:
            continue
        rows.append({"kind": "STOCK", "linked": key in linked_keys, "sourcetype": row["sourcetype"], "sourceno": row["sourceno"],
                     "sourceline": row["sourceline"], "itemname": row["itemname"], "steelgrade": row["materialname"],
                     "surface": row["surfacename"], "thickness": _round(row["thickness"]), "width": _round(row["width"]),
                     "length": _round(row["length"]), "qty": _f(row["qty"]), "weight": _f(row["weight"]),
                     "warehousecode": row["warehousecode"], "warehouse": row["warehousecodename"], "receiptdate": row["receiptdate"]})
    return rows


def _purchase_sizes(cur, companyid, base, material, min_width, min_length):
    """과거 매입(입고) 규격: 같은 품명·두께, 자주·최근 산 순."""
    length_sql = "COALESCE(d.length, 0) = 0" if material == "COIL" else "COALESCE(d.length, 0) >= %(minl)s"
    cur.execute(f"""
        SELECT d.width, COALESCE(d.length, 0) AS length, COUNT(*) AS cnt, MAX(h.receptdate) AS lastdate,
               AVG(NULLIF(d.weight, 0) / NULLIF(d.qty, 0)) AS unitweight
        FROM inbound02t d JOIN inbound01t h ON h.companyid = d.companyid AND h.receiptno = d.receiptno
        WHERE d.companyid = %(companyid)s AND d.thickness = %(thick)s AND d.itemname ILIKE %(name)s
          AND d.width >= %(minw)s AND {length_sql}
        GROUP BY d.width, COALESCE(d.length, 0)
        ORDER BY COUNT(*) DESC, MAX(h.receptdate) DESC LIMIT 8
    """, {"companyid": companyid, "thick": base["thickness"], "name": f"%{str(base['itemname'] or '').strip()}%",
          "minw": min_width, "minl": min_length or 0})
    return [{"width": _round(r["width"]), "length": _round(r["length"]) or None, "count": r["cnt"],
             "lastdate": r["lastdate"], "unitweight": _f(r["unitweight"]) or None} for r in cur.fetchall()]


# ---------------------------------------------------------------- 코일 계산
def _coil_single(width_raw, trim, w):
    usable = width_raw - trim
    cuts = int(floor((usable + 1e-7) / w)) if w > 0 else 0
    return min(cuts, MAX_CUTS)


def _coil_candidate_metrics(width_raw, trim, w, need_weight, stock_weight=None):
    cuts = _coil_single(width_raw, trim, w)
    if cuts < 1:
        return None
    used = cuts * w
    if stock_weight is not None:
        input_weight = stock_weight
    else:
        input_weight = need_weight * width_raw / used if used else 0
    production = input_weight * used / width_raw
    loss = input_weight - production
    return {"cuts": cuts, "used_width": _round(used), "remain_width": _round(width_raw - used),
            "input_weight": _round(input_weight, 1), "production_weight": _round(production, 1),
            "loss_weight": _round(loss, 1), "yield_rate": _round(used / width_raw * 100, 2)}


def _coil_combos(usable, widths, primary, combo):
    """widths = [(width, need)], primary = 기준 폭. 반환: [{cuts:{width:n}, used}]"""
    plans = []
    if combo == "SINGLE":
        n = int(floor((usable + 1e-7) / primary))
        if n >= 1:
            plans.append({primary: min(n, MAX_CUTS)})
    else:
        ws = [w for w, _ in widths][:MAX_MIX_WIDTHS]
        if primary not in ws:
            ws = [primary] + ws[:MAX_MIX_WIDTHS - 1]
        found = []

        def visit(i, used, counts):
            if i == len(ws):
                if counts.get(primary, 0) >= 1 and sum(1 for v in counts.values() if v) >= 2:
                    found.append((used, dict(counts)))
                return
            w = ws[i]
            max_n = int(floor((usable - used + 1e-7) / w))
            for n in range(min(max_n, MAX_CUTS), -1, -1):
                counts[w] = n
                visit(i + 1, used + n * w, counts)
            counts.pop(w, None)

        visit(0, 0.0, {})
        need = {w: n for w, n in widths}
        total_need = sum(need.values()) or 1

        def score(item):
            used, counts = item
            # 1) 많이 쓰는 조합  2) 필요량 비율과 비슷한 조합 (폭별 생산 비율 ≈ 필요 비율)
            share = {w: counts.get(w, 0) * w / used for w in counts} if used else {}
            balance = sum(abs(share.get(w, 0) - need.get(w, 0) / total_need) for w in ws)
            return (-round(used, 3), balance)

        found.sort(key=score)
        seen = set()
        for used, counts in found:
            sig = tuple(sorted((w, n) for w, n in counts.items() if n))
            if sig in seen:
                continue
            seen.add(sig)
            plans.append({w: n for w, n in counts.items() if n})
            if len(plans) >= 3:
                break
    return plans


def _analyze_coil(cur, companyid, lines, settings, planno=""):
    primary_line = lines[0]
    w = primary_line["width"]
    trim = float(settings.get("trimloss") if settings.get("trimloss") is not None else TRIM_LOSS_DEFAULT)
    need_total = sum(x["need_amount"] for x in lines if _same_size(x["width"], w))
    linked_keys = {(s["sourcetype"], s["sourceno"], int(s["sourceline"])) for x in lines for s in x["raw_links"]}
    stocks = _stock_candidates(cur, companyid, lines, "COIL", w + trim, 0, linked_keys, planno, settings.get("_warehouse"))
    sizes = _purchase_sizes(cur, companyid, primary_line, "COIL", w + trim, 0)
    manual = [to_number(v) for v in settings.get("newwidths") or [] if (to_number(v) or 0) >= w + trim]

    candidates = []
    for s in stocks:
        m = _coil_candidate_metrics(s["width"], trim, w, need_total, s["weight"])
        if m:
            candidates.append({**s, **m, "label": "연결 원자재" if s["linked"] else "현재고"})
    seen_new = set()
    for size in [*({"width": v, "count": 0, "manual": True} for v in manual), *sizes]:
        if size["width"] in seen_new:
            continue
        seen_new.add(size["width"])
        m = _coil_candidate_metrics(size["width"], trim, w, need_total)
        if m:
            candidates.append({"kind": "NEW", "linked": False, "width": size["width"], "length": None,
                               "itemname": primary_line["itemname"], "steelgrade": primary_line["steelgrade"],
                               "surface": primary_line["surface"], "thickness": primary_line["thickness"],
                               "qty": None, "weight": None, "label": "직접 입력" if size.get("manual") else "신규 (매입이력)",
                               "purchase_count": size.get("count"), "lastdate": size.get("lastdate"), **m})
    candidates.sort(key=lambda c: (0 if c["linked"] else 1 if c["kind"] == "STOCK" else 2, -(c["yield_rate"] or 0)))
    for rank, c in enumerate(candidates, start=1):
        c["rank"] = rank
        c["id"] = (f"STOCK|{c['sourcetype']}|{c['sourceno']}|{c['sourceline']}" if c["kind"] == "STOCK" else f"NEW|{c['width']:g}")

    # ③ 선택 원자재 (없으면 1순위)
    chosen = next((c for c in candidates if c["id"] == settings.get("raw_id")), None) or (candidates[0] if candidates else None)
    result = {"candidates": candidates[:12], "raw": None, "plans": [], "trimloss": trim}
    if not chosen:
        result["message"] = f"폭 {w:g}mm + 기본 로스 {trim:g}mm 이상인 원자재 후보가 없습니다. 원자재 폭을 직접 입력해 주세요."
        return result
    raw_width = float(settings.get("raw_width") or chosen["width"])
    raw_weight = float(settings.get("raw_weight") or (chosen["weight"] if chosen["kind"] == "STOCK" else chosen["input_weight"]) or 0)
    mode = settings.get("processmode") or "ONE"
    if mode == "SPLIT":
        runs = [to_number(v) or 0 for v in settings.get("splitweights") or [raw_weight / 2, raw_weight / 2]]
    elif mode == "PARTIAL":
        runs = [min(to_number(settings.get("partialweight")) or raw_weight, raw_weight)]
    else:
        runs = [raw_weight]
    process_weight = sum(runs)
    warnings = []
    if mode == "SPLIT" and abs(process_weight - raw_weight) > 0.1:
        warnings.append(f"등분 합계 {process_weight:,.1f}kg 이 원코일 {raw_weight:,.1f}kg 과 다릅니다.")
    if chosen["kind"] == "STOCK" and raw_weight > chosen["weight"] + 1e-6:
        warnings.append(f"가공중량이 현재고 {chosen['weight']:,.1f}kg 보다 큽니다.")
    result["raw"] = {**chosen, "raw_width": raw_width, "raw_weight": raw_weight, "processmode": mode,
                     "runs": runs, "process_weight": process_weight, "storage_weight": max(0.0, raw_weight - process_weight)}

    # ④ 조합
    combo = settings.get("combo") or "SINGLE"
    usable = raw_width - trim
    width_need: dict = {}
    for x in lines:
        width_need[x["width"]] = width_need.get(x["width"], 0) + x["need_amount"]
    extras = [to_number(v) for v in settings.get("extrawidths") or [] if (to_number(v) or 0) > 0]
    widths = [(wd, n) for wd, n in width_need.items()] + [(e, 0) for e in extras if e not in width_need]
    for idx, cuts in enumerate(_coil_combos(usable, widths, w, combo)):
        used = sum(wd * n for wd, n in cuts.items())
        pieces = []
        for wd, n in sorted(cuts.items(), key=lambda item: -item[0]):
            produced = process_weight * wd * n / raw_width
            pieces.append({"width": wd, "cuts": n, "produced_weight": _round(produced, 1), "need_weight": _round(width_need.get(wd, 0), 1),
                           "extra": wd not in width_need})
        loss_weight = process_weight * (raw_width - used) / raw_width
        result["plans"].append({
            "id": "ABC"[idx], "combo": combo, "pieces": pieces, "used_width": _round(used), "remain_width": _round(raw_width - used),
            "yield_rate": _round(used / raw_width * 100, 2), "input_weight": _round(process_weight, 1),
            "production_weight": _round(process_weight - loss_weight, 1), "loss_weight": _round(loss_weight, 1),
            "pattern": " + ".join(f"{p['width']:g} × {p['cuts']}칼" for p in pieces),
            "runs": [{"weight": _round(r, 1), "produced": [{"width": p["width"], "weight": _round(r * p["width"] * p["cuts"] / raw_width, 1)} for p in pieces]} for r in runs],
        })
    if not result["plans"]:
        result["message"] = ("선택한 원자재 폭으로 혼합 조합을 만들 수 없습니다. 혼합할 품목이나 추가 폭을 확인해 주세요." if combo == "MIXED"
                             else "선택한 원자재 폭으로 조합을 만들 수 없습니다.")
    if result["plans"] and mode == "ONE":
        first = result["plans"][0]
        made = sum(p["produced_weight"] for p in first["pieces"] if not p["extra"])
        need = sum(width_need.values())
        if need > 0 and made > need * 1.3:
            warnings.append(f"필요량({need:,.0f}kg)보다 {made - need:,.0f}kg 더 생산됩니다. 가공방식을 '일부가공'으로 바꿔 가공중량을 줄일 수 있습니다.")
    result["warnings"] = warnings
    return result


# ---------------------------------------------------------------- 시트 계산
def _sheet_pattern(cap, products, active, mode, style, need):
    """원판 1줄(폭 방향 1스트립)에 놓을 길이별 개수. products = [(length)], need = 품목별 남은 수량."""
    if mode == "SINGLE":
        i = active[0]
        fit = int(floor((cap + 1e-7) / products[i]))
        return {i: fit} if fit >= 1 else None
    minimum = sum(products[i] for i in active)
    if minimum > cap + 1e-8:
        return None
    best = None
    counts = {}

    def visit(pos, used):
        nonlocal best
        if pos == len(active):
            progress = min(counts[i] / max(1, need[i]) for i in active)
            balance = sum((counts[i] / max(1, need[i]) - progress) ** 2 for i in active)
            score = progress * 1e7 - balance * 1e5 + (used if style == "max" else cap - used) * 0.001
            if best is None or score > best[0]:
                best = (score, dict(counts))
            return
        i = active[pos]
        future = sum(products[j] for j in active[pos + 1:])
        max_n = min(int(floor((cap - used - future + 1e-8) / products[i])), 12)
        for n in range(1, max_n + 1):
            counts[i] = n
            visit(pos + 1, used + n * products[i])
        counts.pop(i, None)

    visit(0, 0.0)
    return best[1] if best else None


def _analyze_sheet(cur, companyid, lines, settings, planno=""):
    item_w = lines[0]["width"]
    if any(not _same_size(x["width"], item_w) for x in lines):
        return {"candidates": [], "raw": None, "plans": [], "message": "시트 혼합은 폭이 같은 품목끼리만 할 수 있습니다. 같은 폭 품목을 선택해 주세요."}
    lengths = [x["length"] for x in lines]
    need = [int(ceil(x["need_amount"])) for x in lines]
    thick = lines[0]["thickness"]
    linked_keys = {(s["sourcetype"], s["sourceno"], int(s["sourceline"])) for x in lines for s in x["raw_links"]}
    min_len = min(lengths)
    stocks = _stock_candidates(cur, companyid, lines, "SHEET", item_w, min_len, linked_keys, planno, settings.get("_warehouse"))
    sizes = _purchase_sizes(cur, companyid, lines[0], "SHEET", item_w, min_len)
    manual = settings.get("newsizes") or []
    mode = settings.get("combo") or ("MIXED" if len(lines) > 1 else "SINGLE")
    orientation = settings.get("orientation") or "NORMAL"
    active = list(range(len(lines))) if mode == "MIXED" else [0]

    def evaluate(raw_w, raw_l, style="max"):
        cap = raw_l if orientation == "NORMAL" else raw_w
        across = raw_w if orientation == "NORMAL" else raw_l
        strips = int(floor((across + 1e-7) / item_w))
        if strips < 1:
            return None
        pattern = _sheet_pattern(cap, lengths, active, mode, style, need)
        if not pattern:
            return None
        per_sheet = {i: pattern.get(i, 0) * strips for i in active}
        if any(per_sheet[i] <= 0 for i in active):
            return None
        sheets = max(int(ceil(need[i] / per_sheet[i])) if need[i] > 0 else 0 for i in active)
        sheets = max(sheets, 1)
        if sheets > MAX_SHEETS:
            return None
        produced = {i: per_sheet[i] * sheets for i in active}
        sheet_area = raw_w * raw_l
        product_area = sum(produced[i] * lengths[i] * item_w for i in active)
        loss_area = max(0.0, sheet_area * sheets - product_area)
        return {"strips": strips, "pattern": pattern, "sheets": sheets, "produced": produced,
                "input_weight": _round(sheet_area * sheets * thick * STEEL_DENSITY, 2),
                "production_weight": _round(product_area * thick * STEEL_DENSITY, 2),
                "loss_weight": _round(loss_area * thick * STEEL_DENSITY, 2),
                "yield_rate": _round(product_area / (sheet_area * sheets) * 100, 2),
                "used_across": _round(item_w * strips), "remain_across": _round(across - item_w * strips),
                "used_along": _round(sum(pattern.get(i, 0) * lengths[i] for i in active))}

    candidates = []
    for s in stocks:
        if not s["length"]:
            continue
        m = evaluate(s["width"], s["length"])
        if m:
            short = max(0, m["sheets"] - int(s["qty"]))
            candidates.append({**s, **m, "label": "연결 원자재" if s["linked"] else "현재고", "short_sheets": short})
    seen = set()
    manual_sizes = [{"width": to_number(x.get("width")), "length": to_number(x.get("length")), "manual": True} for x in manual]
    for size in [*manual_sizes, *sizes]:
        if not size["width"] or not size["length"] or (size["width"], size["length"]) in seen:
            continue
        seen.add((size["width"], size["length"]))
        m = evaluate(size["width"], size["length"])
        if m:
            candidates.append({"kind": "NEW", "linked": False, "width": size["width"], "length": size["length"],
                               "itemname": lines[0]["itemname"], "steelgrade": lines[0]["steelgrade"], "surface": lines[0]["surface"],
                               "thickness": thick, "qty": None, "weight": None,
                               "label": "직접 입력" if size.get("manual") else "신규 (매입이력)", "purchase_count": size.get("count"), **m})
    candidates.sort(key=lambda c: (0 if c["linked"] else 1 if c["kind"] == "STOCK" else 2, -(c["yield_rate"] or 0)))
    for rank, c in enumerate(candidates, start=1):
        c["rank"] = rank
        c["id"] = (f"STOCK|{c['sourcetype']}|{c['sourceno']}|{c['sourceline']}" if c["kind"] == "STOCK"
                   else f"NEW|{c['width']:g}x{c['length']:g}")
    chosen = next((c for c in candidates if c["id"] == settings.get("raw_id")), None) or (candidates[0] if candidates else None)
    result = {"candidates": candidates[:12], "raw": None, "plans": [], "orientation": orientation}
    if not chosen:
        result["message"] = f"폭 {item_w:g}mm · 길이 {min_len:g}mm 이상인 원판 후보가 없습니다. 원판 규격을 직접 입력해 주세요."
        return result
    raw_w = float(settings.get("raw_width") or chosen["width"])
    raw_l = float(settings.get("raw_length") or chosen["length"])
    result["raw"] = {**chosen, "raw_width": raw_w, "raw_length": raw_l,
                     "raw_sheets": int(chosen["qty"]) if chosen["kind"] == "STOCK" else None}
    seen_patterns = set()
    for style in ("max", "balanced"):
        m = evaluate(raw_w, raw_l, style)
        if not m:
            continue
        sig = tuple(sorted(m["pattern"].items()))
        if sig in seen_patterns:
            continue
        seen_patterns.add(sig)
        pieces = [{"length": lengths[i], "width": item_w, "per_strip": m["pattern"].get(i, 0), "per_sheet": m["pattern"].get(i, 0) * m["strips"],
                   "produced_qty": m["produced"][i], "need_qty": need[i], "over_qty": m["produced"][i] - need[i],
                   "orderid": lines[i]["orderid"], "lineno": lines[i]["lineno"]} for i in active]
        result["plans"].append({"id": "ABC"[len(result["plans"])], "combo": mode, "orientation": orientation, "pieces": pieces,
                                "pattern": " + ".join(f"{p['length']:g} × {p['per_strip']}" for p in pieces) + (f" (× {m['strips']}줄)" if m["strips"] > 1 else ""),
                                **{k: m[k] for k in ("sheets", "strips", "input_weight", "production_weight", "loss_weight", "yield_rate",
                                                     "used_across", "remain_across", "used_along")}})
    if chosen["kind"] == "STOCK" and result["plans"] and result["plans"][0]["sheets"] > chosen["qty"]:
        result["warnings"] = [f"필요 원판 {result['plans'][0]['sheets']}매 중 현재고는 {int(chosen['qty'])}매입니다. 부족분은 매입이 필요합니다."]
    if not result["plans"]:
        result["message"] = "선택한 원판 규격으로 절단 조합을 만들 수 없습니다."
    return result


# ---------------------------------------------------------------- 분석 (①~④)
def analyze(companyid: str, keys: list, settings: dict | None = None, planno: str = "") -> dict:
    settings = settings or {}
    keys = [(str(o), int(n)) for o, n in keys]
    if not keys:
        raise ValueError("최적화할 품목을 선택해 주세요.")
    with _connection() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
        lines = _load_lines(cur, companyid, keys=keys)
        if len(lines) != len(set(keys)):
            raise ValueError("선택한 품목을 찾을 수 없습니다. 다시 조회해 주세요.")
        order_map = {(x["orderid"], x["lineno"]): x for x in lines}
        lines = [order_map[k] for k in dict.fromkeys(keys)]  # 선택한 순서 유지 (첫 품목 = 기준)
        links = _linked_stock(cur, companyid, lines)
        lines = [_with_need(x, links.get(x["key"], [])) for x in lines]
        problems = [f"{x['orderid']}-{x['lineno']}: {', '.join(x['missing'])}" for x in lines if x["missing"]]
        if problems:
            return {"lines": lines, "summary": None, "candidates": [], "plans": [], "raw": None,
                    "message": "값이 빠진 품목이 있어 계산할 수 없습니다. " + " / ".join(problems[:5])}
        materials = {x["material"] for x in lines}
        if len(materials) > 1:
            raise ValueError("코일(길이 없음)과 시트(길이 있음)를 함께 계산할 수 없습니다.")
        base = lines[0]
        if any(not _same_size(x["thickness"], base["thickness"]) or str(x["itemname"]).strip().lower() != str(base["itemname"]).strip().lower()
               for x in lines):
            raise ValueError("같은 품명·두께의 품목끼리만 함께 계산할 수 있습니다.")
        material = base["material"]
        # 한 계획 = 한 창고 (연결 재고의 창고). 여러 창고면 함께 계산하지 않는다.
        warehouses = {(w["code"], w["name"]) for x in lines for w in x["warehouses"]}
        if len(warehouses) > 1:
            raise ValueError("같은 창고에서만 가공 최적화를 할 수 있습니다. 연결 재고의 창고가 다릅니다: "
                             + ", ".join(sorted(name or code for code, name in warehouses)))
        warehouse = next(iter(warehouses), None)
        settings = {**settings, "_warehouse": warehouse[0] if warehouse else None}
        result = (_analyze_coil if material == "COIL" else _analyze_sheet)(cur, companyid, lines, settings, planno)
        # 연결 재고가 없으면 고른 원자재(현재고)의 창고가 계획 창고
        raw = result.get("raw")
        if not warehouse and raw and raw.get("kind") == "STOCK":
            warehouse = (raw.get("warehousecode"), raw.get("warehouse"))
        result["warehouse"] = {"code": warehouse[0], "name": warehouse[1]} if warehouse else None
    unit = "kg" if material == "COIL" else "매"
    result["lines"] = lines
    result["material"] = material
    result["summary"] = {
        "buyers": sorted({x["buyer"] for x in lines if x["buyer"]}),
        "unit": unit,
        "order_amount": sum(x["order_amount"] for x in lines),
        "ready_amount": sum(x["ready_amount"] for x in lines),
        "need_amount": sum(x["need_amount"] for x in lines),
        "raw_stock_amount": sum((c["weight"] if material == "COIL" else c["qty"]) or 0 for c in result["candidates"] if c["kind"] == "STOCK"),
        "ready": [s for x in lines for s in x["ready"]],
        "raw_stock": [c for c in result["candidates"] if c["kind"] == "STOCK"][:10],
    }
    result.setdefault("warnings", [])
    return result


# ---------------------------------------------------------------- 계획 저장 / 확정 / 취소
def _next_planno(cur, companyid: str) -> str:
    prefix = datetime.now(ZoneInfo("Asia/Seoul")).strftime("PL%Y%m%d")
    cur.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"ai-plan-no:{companyid}:{prefix}",))
    cur.execute("SELECT COALESCE(MAX(CAST(SUBSTRING(planno FROM %s) AS INTEGER)), 0) FROM aiplan01t WHERE companyid = %s AND planno LIKE %s",
                (len(prefix) + 1, companyid, f"{prefix}%"))
    row = cur.fetchone()
    number = (row[0] if not isinstance(row, dict) else list(row.values())[0]) + 1
    return f"{prefix}{number:05d}"


def save_plan(companyid: str, companyname: str, payload: dict, actor=None) -> dict:
    """payload: {planno?, status: DRAFT|CONFIRMED, keys, settings, plan_id}. 서버에서 다시 계산해 저장한다."""
    status = payload.get("status") or "DRAFT"
    if status not in ("DRAFT", "CONFIRMED"):
        raise ValueError("저장 상태를 확인해 주세요.")
    keys = [(str(k[0]), int(k[1])) for k in payload.get("keys") or []]
    planno = str(payload.get("planno") or "").strip()
    settings = payload.get("settings") or {}
    result = analyze(companyid, keys, settings, planno)
    if result.get("message") and not result.get("plans"):
        raise ValueError(result["message"])
    plan = next((p for p in result["plans"] if p["id"] == payload.get("plan_id")), None) or (result["plans"][0] if result["plans"] else None)
    raw = result["raw"]
    if not plan or not raw:
        raise ValueError("저장할 추천조합을 선택해 주세요.")
    material = result["material"]
    with _connection() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"ai-plan:{companyid}",))
        if planno:
            cur.execute("SELECT status FROM aiplan01t WHERE companyid = %s AND planno = %s FOR UPDATE", (companyid, planno))
            row = cur.fetchone()
            if not row:
                raise ValueError("계획을 찾을 수 없습니다. 다시 조회해 주세요.")
            if row["status"] != "DRAFT":
                raise ValueError("임시저장 상태의 계획만 수정할 수 있습니다.")
        lines = _load_lines(cur, companyid, keys=keys)
        bad = [f"{x['orderid']}-{x['lineno']}" for x in lines if x["optimize_status"] != "WAITING"]
        if bad:
            raise ValueError("최적화 대기 상태가 아닌 품목이 있습니다: " + ", ".join(bad[:5]))
        cur.execute("""SELECT DISTINCT p2.orderid, p2.orderlineno, p1.planno FROM aiplan02t p2
                       JOIN aiplan01t p1 ON p1.companyid = p2.companyid AND p1.planno = p2.planno
                       WHERE p2.companyid = %s AND p1.status IN ('DRAFT', 'CONFIRMED') AND p1.planno <> %s
                         AND (p2.orderid, p2.orderlineno) IN (SELECT * FROM unnest(%s::varchar[], %s::integer[]))""",
                    (companyid, planno, [k[0] for k in keys], [k[1] for k in keys]))
        taken = cur.fetchall()
        if taken:
            raise ValueError("다른 계획에 이미 들어 있는 품목이 있습니다: " + ", ".join(f"{r['orderid']}-{r['orderlineno']}({r['planno']})" for r in taken[:5]))
        if raw["kind"] == "STOCK":
            cur.execute("""SELECT planno FROM aiplan01t WHERE companyid = %s AND status = 'CONFIRMED' AND rawkind = 'STOCK'
                             AND stocksourcetype = %s AND stocksourceno = %s AND stocksourceline = %s AND planno <> %s""",
                        (companyid, raw["sourcetype"], raw["sourceno"], raw["sourceline"], planno))
            other = cur.fetchone()
            if other:
                raise ValueError(f"선택한 원자재는 다른 확정 계획({other['planno']})에 잡혀 있습니다.")
        if not planno:
            planno = _next_planno(cur, companyid)
        header = {
            "materialtype": material, "status": status, "rawkind": raw["kind"],
            "stocksourcetype": raw.get("sourcetype") if raw["kind"] == "STOCK" else None,
            "stocksourceno": raw.get("sourceno") if raw["kind"] == "STOCK" else None,
            "stocksourceline": raw.get("sourceline") if raw["kind"] == "STOCK" else None,
            "itemname": raw.get("itemname"), "steelgrade": raw.get("steelgrade"), "surface": raw.get("surface"),
            "thickness": raw.get("thickness"),
            "width": raw.get("raw_width"), "length": raw.get("raw_length") if material == "SHEET" else None,
            "rawweight": raw.get("raw_weight") if material == "COIL" else plan.get("input_weight"),
            "rawsheets": plan.get("sheets") if material == "SHEET" else None,
            "trimloss": result.get("trimloss") if material == "COIL" else None,
            "processmode": raw.get("processmode") if material == "COIL" else None,
            "combo": plan.get("combo"), "orientation": plan.get("orientation") if material == "SHEET" else None,
            "inputweight": plan.get("input_weight"), "productweight": plan.get("production_weight"),
            "lossweight": plan.get("loss_weight"), "yieldrate": plan.get("yield_rate"),
            "pattern": json.dumps({"plan": plan, "settings": settings, "keys": keys, "raw_id": raw.get("id")}, ensure_ascii=False, default=str),
            "description": payload.get("description") or None,
        }
        cur.execute("DELETE FROM aiplan01t WHERE companyid = %s AND planno = %s", (companyid, planno))
        cols = list(header)
        cur.execute(f"""INSERT INTO aiplan01t (companyid, companyname, planno, {', '.join(cols)}, created_by)
                        VALUES (%s, %s, %s, {', '.join(['%s'] * len(cols))}, %s)""",
                    (companyid, companyname, planno, *[header[c] for c in cols], actor or None))
        lineno = 0
        line_by_key = {(x["orderid"], x["lineno"]): x for x in result["lines"]}
        if material == "COIL":
            remaining = {}
            for p in plan["pieces"]:
                remaining[p["width"]] = p["produced_weight"]
            for k in keys:
                x = line_by_key[k]
                give = min(remaining.get(x["width"], 0), x["need_amount"])
                remaining[x["width"]] = remaining.get(x["width"], 0) - give
                cuts = next((p["cuts"] for p in plan["pieces"] if _same_size(p["width"], x["width"])), 0)
                lineno += 1
                cur.execute("""INSERT INTO aiplan02t (companyid, companyname, planno, lineno, linekind, orderid, orderlineno,
                               width, length, cuts, readyweight, plannedweight) VALUES (%s,%s,%s,%s,'ORDER',%s,%s,%s,%s,%s,%s,%s)""",
                            (companyid, companyname, planno, lineno, x["orderid"], x["lineno"], x["width"], None, cuts,
                             x["ready_amount"], _round(give, 1)))
            for p in plan["pieces"]:
                if p["extra"] or remaining.get(p["width"], 0) > 0.05:
                    lineno += 1
                    cur.execute("""INSERT INTO aiplan02t (companyid, companyname, planno, lineno, linekind, width, cuts, plannedweight)
                                   VALUES (%s,%s,%s,%s,'EXTRA',%s,%s,%s)""",
                                (companyid, companyname, planno, lineno, p["width"], p["cuts"], _round(remaining.get(p["width"], p["produced_weight"]), 1)))
        else:
            for p in plan["pieces"]:
                x = line_by_key[(p["orderid"], p["lineno"])]
                lineno += 1
                cur.execute("""INSERT INTO aiplan02t (companyid, companyname, planno, lineno, linekind, orderid, orderlineno,
                               width, length, cuts, readyweight, plannedqty) VALUES (%s,%s,%s,%s,'ORDER',%s,%s,%s,%s,%s,%s,%s)""",
                            (companyid, companyname, planno, lineno, x["orderid"], x["lineno"], p["width"], p["length"], p["per_sheet"],
                             x["ready_amount"], p["produced_qty"]))
        if status == "CONFIRMED":
            cur.execute("""UPDATE aiorder02t SET optimize_status = 'PLANNED', updated_at = CURRENT_TIMESTAMP, updated_by = COALESCE(%s, updated_by)
                           WHERE companyid = %s AND (orderid, lineno) IN (SELECT * FROM unnest(%s::varchar[], %s::integer[]))""",
                        (actor or None, companyid, [k[0] for k in keys], [k[1] for k in keys]))
        conn.commit()
    return {"planno": planno, "status": status}


def list_plans(companyid: str, status: str = "OPEN") -> dict:
    statuses = {"OPEN": ["DRAFT", "CONFIRMED"], "DRAFT": ["DRAFT"], "CONFIRMED": ["CONFIRMED"], "ALL": list(PLAN_STATUSES)}.get(status, ["DRAFT", "CONFIRMED"])
    with _connection() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("""
            SELECT p.planno, p.materialtype, p.status, p.rawkind, p.itemname, p.thickness, p.width, p.length, p.rawweight, p.rawsheets,
                   p.combo, p.yieldrate, p.inputweight, p.lossweight, p.created_at, p.updated_at,
                   COALESCE((SELECT u.username FROM user01t u WHERE u.email = p.created_by LIMIT 1), p.created_by) AS created_by,
                   (SELECT string_agg(DISTINCT d.orderid || '-' || d.orderlineno, ', ') FROM aiplan02t d
                     WHERE d.companyid = p.companyid AND d.planno = p.planno AND d.linekind = 'ORDER') AS lines
            FROM aiplan01t p WHERE p.companyid = %s AND p.status = ANY(%s)
            ORDER BY p.created_at DESC LIMIT 200
        """, (companyid, statuses))
        rows = [{k: (float(v) if isinstance(v, Decimal) else v) for k, v in row.items()} for row in cur.fetchall()]
    return {"items": rows}


def get_plan(companyid: str, planno: str) -> dict | None:
    with _connection() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT * FROM aiplan01t WHERE companyid = %s AND planno = %s", (companyid, planno))
        head = cur.fetchone()
        if not head:
            return None
        cur.execute("SELECT * FROM aiplan02t WHERE companyid = %s AND planno = %s ORDER BY lineno", (companyid, planno))
        lines = cur.fetchall()
    clean = lambda row: {k: (float(v) if isinstance(v, Decimal) else v) for k, v in row.items()}
    head = clean(head)
    pattern = head.get("pattern")
    head["pattern"] = json.loads(pattern) if isinstance(pattern, str) else pattern
    return {"header": head, "lines": [clean(x) for x in lines]}


def cancel_plan(companyid: str, planno: str, actor=None) -> bool:
    """임시저장 계획은 삭제, 확정 계획은 취소(품목은 최적화 대기로)."""
    with _connection() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT status FROM aiplan01t WHERE companyid = %s AND planno = %s FOR UPDATE", (companyid, planno))
        row = cur.fetchone()
        if not row:
            return False
        if row["status"] not in ("DRAFT", "CONFIRMED"):
            raise ValueError("임시저장·확정 상태의 계획만 취소할 수 있습니다.")
        if row["status"] == "CONFIRMED":
            cur.execute("""UPDATE aiorder02t d SET optimize_status = 'WAITING', updated_at = CURRENT_TIMESTAMP, updated_by = COALESCE(%s, d.updated_by)
                           FROM aiplan02t p WHERE p.companyid = %s AND p.planno = %s AND p.linekind = 'ORDER'
                             AND d.companyid = p.companyid AND d.orderid = p.orderid AND d.lineno = p.orderlineno
                             AND d.optimize_status = 'PLANNED'""", (actor or None, companyid, planno))
            cur.execute("UPDATE aiplan01t SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP, updated_by = %s WHERE companyid = %s AND planno = %s",
                        (actor or None, companyid, planno))
        else:
            cur.execute("DELETE FROM aiplan01t WHERE companyid = %s AND planno = %s", (companyid, planno))
        conn.commit()
    return True
