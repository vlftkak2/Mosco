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
계산식은 시안(스틸119 가공최적화 v10 · 이력 연동 · 주문충족 검증)과 같다.
  코일 칼 1개 중량 = 투입중량 × 제품폭 ÷ 원코일폭,  생산 = Σ칼,  로스 = 투입 − 생산,  수율 = 생산 ÷ 투입
  코일 추천 정렬 = 미생산 폭 수 → 주문충족(±0.5%, 칼 중량 200~3,000kg) → (부족·초과량 + 로스) → 수율
  코일 '나머지'·'전량' 주문 = 목표 중량 없이 남는 만큼 생산 (잔여 생산)
  시트 로스면적 = 원판면적 × 매수 − 제품면적 합,  중량 = 면적 × 두께 × 7.85e-6
"""
from __future__ import annotations

import json
import re
import threading
from contextlib import contextmanager
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal
from math import ceil, floor
from zoneinfo import ZoneInfo

from psycopg2.extras import RealDictCursor

import db as _shared_db
from services.ai.stock_links import allocate_coil_run, plan_outstanding_sql, stock_shares

TRIM_LOSS_DEFAULT = 4.0            # 기본 로스(mm) - 회사 기본값
STEEL_DENSITY = 7.85e-6            # kg / mm³
MAX_MIX_WIDTHS = 6                 # 혼합에 쓰는 서로 다른 폭 수
MAX_CUTS = 60                      # 코일 1개에서 낼 수 있는 칼 수 상한
MAX_SHEETS = 500
MAX_COMBOS = 3000                  # 혼합 조합 탐색 상한 (칼 수 많은 조합부터)
MAX_COMBO_NODES = 300_000          # 혼합 조합 탐색 방문 노드 상한 (안전장치)
MAX_SHEET_NODES = 300_000          # 시트 1줄 배치 탐색 방문 노드 상한 - 호출 1번 (안전장치)
MAX_SHEET_TOTAL_NODES = 1_500_000  # 시트 원자재 후보 전체(분석 1번)의 배치 탐색 방문 노드 상한
MAX_EXTRA_SIZES = 6                # 가공 후보 폭(코일) · 길이(시트) 입력 개수 상한
MIN_EXTRA_WIDTH = 10.0             # 가공 후보 폭 최소값(mm) - 이보다 작은 값은 무시
MIN_EXTRA_LENGTH = 50.0            # 가공 후보 길이 최소값(mm) - 이보다 작은 값은 무시
COIL_RULES = {"tol_pct": 0.5}   # 주문중량 허용오차(%). 소코일 무게 범위 검사(200~3,000kg)는 사용하지 않음
REMAINDER_WORDS = ("나머지", "전량", "잔량", "잔여", "전부")
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
def _is_remainder(text: str) -> bool:
    text = str(text or "").strip()
    return bool(text) and (text in ("-", "–", "—") or any(word in text for word in REMAINDER_WORDS))


def _line_row(row: dict) -> dict:
    """주문 품목 한 줄 → 계산에 쓰는 값 + 확인 필요 항목."""
    qty = to_number(row["quantity"]) if row["quantity"] is not None else to_number(row["quantity_raw"])
    weight = to_number(row["weight_kg"]) if row["weight_kg"] is not None else to_number(row["weight_raw"])
    material = material_of(row["length"])
    converted = []
    unit = str(row["quantity_unit"] or "").strip().upper()
    # 코일 수량 칸이 KG·TON 이면 그 값이 주문 중량
    if material == "COIL" and weight is None and qty is not None and unit in ("KG", "TON", "T", "톤"):
        weight = qty * (1000 if unit != "KG" else 1)
        converted.append(f"수량 {qty:g}{unit} → 중량 {weight:g}kg")
    raw_text = " ".join(str(v) for v in (row["quantity_raw"], row["weight_raw"]) if v)
    remainder = material == "COIL" and weight is None and _is_remainder(raw_text)
    missing = []
    if not str(row["itemname"] or "").strip():
        missing.append("품명")
    if not (to_number(row["thickness"]) or 0) > 0:
        missing.append("두께")
    if not (to_number(row["width"]) or 0) > 0:
        missing.append("폭")
    if material == "COIL" and not (weight or 0) > 0 and not remainder:
        missing.append("중량")
    if material == "SHEET" and not (qty or 0) > 0:
        missing.append("수량")
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
        "material": material, "missing": missing, "converted": converted, "remainder": remainder,
        "remainder_text": raw_text if remainder else None,
        "optimize_status": row["optimize_status"], "notes": row["notes"],
    }


QUEUE_DONE_LIMIT = 500    # 대기 목록 '전체' 에 함께 보여 줄 가공완료(DONE) 품목 수 (최근 수정 순)
QUEUE_MAX_ROWS = 2000     # 대기 목록 한 번 조회 상한 (안전장치)


def _like(text: str) -> str:
    return "%" + text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def _load_lines(cur, companyid: str, keys=None, status=None, buyer: str = "", itemname: str = "",
                done_limit: int | None = None, max_rows: int | None = None) -> list[dict]:
    where = ["d.companyid = %s"]
    params: list = [companyid]
    if status:
        where.append("d.optimize_status = ANY(%s)")
        params.append(list(status))
    if buyer:
        where.append("h.buyer ILIKE %s ESCAPE '\\'")
        params.append(_like(buyer))
    if itemname:
        where.append("d.itemname ILIKE %s ESCAPE '\\'")
        params.append(_like(itemname))
    if done_limit is not None:
        # 가공완료는 계속 쌓이므로 최근 것만 (같은 조건 안에서)
        where.append(f"""(d.optimize_status <> 'DONE' OR (d.orderid, d.lineno) IN (
                            SELECT d.orderid, d.lineno FROM aiorder02t d
                            JOIN aiorder01t h ON h.companyid = d.companyid AND h.orderid = d.orderid
                            WHERE {' AND '.join(where)} AND d.optimize_status = 'DONE'
                            ORDER BY d.updated_at DESC NULLS LAST, d.orderid DESC, d.lineno DESC LIMIT %s))""")
        params.extend([*params, int(done_limit)])
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
        {"LIMIT %s" if max_rows else ""}
    """, [*params, max_rows] if max_rows else params)
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
    rows = cur.fetchall()
    shares = stock_shares(cur, companyid, {(r["stocksourcetype"], r["stocksourceno"], int(r["stocksourceline"])) for r in rows})
    result: dict = {}
    for row in rows:
        share = shares.get((row["stocksourcetype"], row["stocksourceno"], int(row["stocksourceline"])))
        mine = (share or {}).get("lines", {}).get((row["orderid"], int(row["lineno"])))
        if share and share["count"] > 1 and mine:   # 여러 품목이 함께 쓰는 재고 → 이 품목 몫만
            row = {**row, "weight": mine["weight"], "qty": mine["qty"]}
        result.setdefault(f"{row['orderid']}|{row['lineno']}", []).append({
            "share_count": (share or {}).get("count", 1),
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
        order_amount = line["weight"] or 0     # '나머지' 주문은 0 (목표 없이 잔여 생산)
        ready_amount = sum(s["weight"] for s in ready)
    else:
        order_amount = line["quantity"] or 0
        ready_amount = sum(s["qty"] for s in ready)
    warehouses = sorted({(s["warehousecode"], s["warehouse"]) for s in stocks if s.get("warehousecode")})
    return {**line, "ready": ready, "raw_links": raw, "order_amount": order_amount,
            "warehouses": [{"code": code, "name": name} for code, name in warehouses],
            "ready_amount": ready_amount, "need_amount": max(0.0, order_amount - ready_amount)}


def list_queue(companyid: str, status: str = "WAITING", buyer: str = "", itemname: str = "") -> dict:
    # ALL 에 가공완료(DONE)도 넣는다: 가공완료 계획을 열었을 때 최적화 대상 표가 비지 않게
    statuses = {"WAITING": ["WAITING"], "PLANNED": ["PLANNED"], "ALL": ["WAITING", "PLANNED", "DONE"]}.get(status, ["WAITING"])
    with _connection() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
        # 검색어는 SQL 에서 거른다 (대소문자 무시 부분 일치). 가공완료는 최근 QUEUE_DONE_LIMIT 건만
        lines = _load_lines(cur, companyid, status=statuses, buyer=(buyer or "").strip(), itemname=(itemname or "").strip(),
                            done_limit=QUEUE_DONE_LIMIT if "DONE" in statuses else None, max_rows=QUEUE_MAX_ROWS)
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
        WHERE p2.companyid = %s AND p1.status IN ('DRAFT', 'CONFIRMED', 'DONE')
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
                          AND pl.materialtype = 'SHEET' AND pl.planno <> %(planno)s
                          AND pl.stocksourcetype = {alias}.sourcetype AND pl.stocksourceno = {alias}.sourceno
                          AND pl.stocksourceline = {alias}.sourceline)
             -- 코일 계획은 가공중량만 잡는다 → 남는 중량이 없을 때만 숨긴다
             OR {alias}.weight - {plan_outstanding_sql(alias, "%(planno)s")} <= 0.001)"""


def _stock_candidates(cur, companyid, lines, material, min_width, min_length, linked_keys, planno="", warehouse=None):
    base = lines[0]
    params = {"companyid": companyid, "thick": base["thickness"], "name": f"%{str(base['itemname'] or '').strip()}%",
              "minw": min_width, "minl": min_length or 0, "planno": planno or "", "wh": warehouse,
              "korders": [x["orderid"] for x in lines], "klines": [x["lineno"] for x in lines],
              "lt": [k[0] for k in linked_keys], "ln": [k[1] for k in linked_keys], "ll": [int(k[2]) for k in linked_keys]}
    length_sql = "COALESCE(s.length, 0) = 0" if material == "COIL" else "COALESCE(s.length, 0) >= %(minl)s"
    cur.execute(f"""
        SELECT s.sourcetype, s.sourceno, s.sourceline, s.itemname, s.materialname, s.surfacename,
               s.thickness, s.width, s.length, s.qty, s.weight, s.warehousecode, s.warehousecodename, s.receiptdate,
               {_reserved_sql('s')} AS reserved,
               {plan_outstanding_sql('s', "%(planno)s")} AS plan_reserved
        FROM currentstock01t s
        WHERE s.companyid = %(companyid)s AND s.qty > 0 AND s.weight > 0
          AND s.thickness = %(thick)s AND s.itemname ILIKE %(name)s
          AND (s.width >= %(minw)s
               -- 주문서 관리에서 연결한 원자재는 폭이 모자라도 보여 준다 (② 표에 '배치 불가'로)
               OR (s.sourcetype, s.sourceno, s.sourceline) IN (SELECT * FROM unnest(%(lt)s::varchar[], %(ln)s::varchar[], %(ll)s::integer[])))
          AND {length_sql}
          AND (%(wh)s::varchar IS NULL OR s.warehousecode = %(wh)s)
        ORDER BY s.width, s.receiptdate LIMIT 60
    """, params)
    rows = []
    fetched = cur.fetchall()
    shares = stock_shares(cur, companyid, {(r["sourcetype"], r["sourceno"], int(r["sourceline"])) for r in fetched
                                            if (r["sourcetype"], r["sourceno"], int(r["sourceline"])) in linked_keys})
    selected = {(x["orderid"], x["lineno"]) for x in lines}
    for row in fetched:
        key = (row["sourcetype"], row["sourceno"], int(row["sourceline"]))
        if row["reserved"] and key not in linked_keys:
            continue
        share = shares.get(key)
        if share and share["count"] > 1:   # 다른 주문 품목과 함께 쓰는 재고 → 담은 품목 몫만 쓸 수 있음
            mine = [v for k, v in share["lines"].items() if k in selected]
            row = {**row, "weight": sum(v["weight"] for v in mine), "qty": sum(v["qty"] for v in mine)}
        elif material == "COIL" and float(row["plan_reserved"] or 0) > 0:
            # 다른 확정 계획이 가공중량만큼 잡아 둔 코일 → 남은 중량만 쓸 수 있음 (일부가공 · 등분 잔량)
            row = {**row, "weight": max(0.0, float(row["weight"]) - float(row["plan_reserved"]))}
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


# ---------------------------------------------------------------- 코일 계산 (시안 v10 coilEval / coilPlans)
def _w(value) -> float:
    """폭·길이 비교용 키 (소수 셋째 자리)."""
    return round(float(value), 3)


def _new_candidates(settings: dict, material: str) -> list[dict]:
    """직접 입력 · 매입이력에서 고른 신규 원자재 후보. 예전 형식(newwidths / newsizes)도 읽는다."""
    rows = []
    for item in settings.get("newcandidates") or []:
        if not isinstance(item, dict):
            continue
        width, length = to_number(item.get("width")), to_number(item.get("length"))
        if not (width or 0) > 0 or (material == "SHEET" and not (length or 0) > 0):
            continue
        rows.append({"width": _w(width), "length": _w(length) if material == "SHEET" else None,
                     "weight": to_number(item.get("weight")) if material == "COIL" else None,
                     "source": str(item.get("source") or "직접 입력")[:60]})
    if material == "COIL":
        rows += [{"width": _w(v), "length": None, "weight": None, "source": "직접 입력"}
                 for v in (to_number(x) for x in settings.get("newwidths") or []) if (v or 0) > 0]
    else:
        for item in settings.get("newsizes") or []:
            width, length = to_number((item or {}).get("width")), to_number((item or {}).get("length"))
            if (width or 0) > 0 and (length or 0) > 0:
                rows.append({"width": _w(width), "length": _w(length), "weight": None, "source": "직접 입력"})
    return rows


def _coil_demand(lines: list[dict]) -> list[dict]:
    """폭별 주문 수요. target = 필요중량(kg), None = '나머지' (잔여 생산)."""
    demand: dict = {}
    for line in lines:
        item = demand.setdefault(_w(line["width"]), {"width": _w(line["width"]), "target": 0.0, "remainder": False})
        if line.get("remainder"):
            item["remainder"] = True
        else:
            item["target"] += line["need_amount"]
    return [{"width": d["width"], "target": None if d["remainder"] else d["target"]} for d in demand.values()]


def _pass_label(mode: str, index: int) -> str:
    return f"{index + 1}차 가공" if mode == "SPLIT" else "일부가공" if mode == "PARTIAL" else "원샷"


def _cut_sig(cuts: dict) -> str:
    return ",".join(f"{w:g}x{n}" for w, n in sorted(cuts.items()) if n)


def _coil_eval(passes: list[dict], raw_width: float, demand: list[dict]) -> dict:
    """추천안 1개를 주문중량·소코일 중량으로 검증한다 (폭 수율만으로 판단하지 않음)."""
    prod, cnt, issues = {}, {}, []
    total_in = total_out = 0.0
    for run in passes:
        kg = run["kg"]
        if not kg > 0:
            continue
        total_in += kg
        for width, n in run["cuts"].items():
            per = kg * width / raw_width
            prod[width] = prod.get(width, 0.0) + per * n
            cnt[width] = cnt.get(width, 0) + n
            total_out += per * n
    items = []
    for d in demand:
        kg, n, target = prod.get(d["width"], 0.0), cnt.get(d["width"], 0), d["target"]
        state, delta = "ok", None
        if not n:
            state = "none"
        elif target is not None:
            tol = max(1.0, target * COIL_RULES["tol_pct"] / 100)
            delta = kg - target
            state = "short" if delta < -tol else "over" if delta > tol else "ok"
        items.append({"width": d["width"], "target": target, "kg": kg, "n": n, "state": state, "delta": delta})
    demand_widths = {d["width"] for d in demand}
    extras = [{"width": w, "kg": prod[w], "n": cnt[w]} for w in prod if w not in demand_widths]
    bad = sum(1 for it in items if it["state"] == "none")
    miss = sum(-it["delta"] if it["state"] == "short" else it["delta"] if it["state"] == "over"
               else (it["target"] or 0) if it["state"] == "none" else 0 for it in items)
    ok_all = not bad and not issues and all(it["state"] == "ok" for it in items)
    return {"input": total_in, "out": total_out, "loss": total_in - total_out,
            "yield": total_out / total_in if total_in > 0 else 0.0, "items": items, "extras": extras,
            "issues": issues, "bad": bad, "miss": miss, "ok_all": ok_all, "knives": sum(cnt.values())}


_COMBO_CACHE: dict = {}
_COMBO_CACHE_LOCK = threading.Lock()


def _mixed_combos(usable: float, widths: list[float], required: int) -> list[dict]:
    """혼합 칼 조합 전부 (발주 폭은 1칼 이상, 가공 후보 폭은 0칼 이상). 칼 많은 조합부터, MAX_COMBOS 까지.

    결과(순서 포함)는 가지치기 없는 전체 탐색과 같다: 칼 수 합이 MAX_CUTS 를 넘거나 남은 발주 폭을
    1칼씩도 넣을 수 없는 가지는 조합이 하나도 나오지 않으므로 미리 자른다. 안전장치로 방문 노드 수도 제한한다.
    """
    key = (round(usable, 3), tuple(widths), required)
    with _COMBO_CACHE_LOCK:
        cached = _COMBO_CACHE.get(key)
    if cached is not None:
        return cached
    found, counts = [], [0] * len(widths)
    # 위치 i 이후(i 제외)에 반드시 1칼 이상 넣어야 하는 발주 폭의 폭 합 · 개수
    need_width = [sum(widths[j] for j in range(i + 1, len(widths)) if j < required) for i in range(len(widths))]
    need_cuts = [sum(1 for j in range(i + 1, len(widths)) if j < required) for i in range(len(widths))]
    visited = 0

    def walk(i, left, cuts):
        nonlocal visited
        visited += 1
        if len(found) >= MAX_COMBOS or visited > MAX_COMBO_NODES:
            return
        if i == len(widths):
            if cuts <= MAX_CUTS:
                found.append({widths[k]: counts[k] for k in range(len(widths)) if counts[k]})
            return
        low = 1 if i < required else 0
        top = int(floor((left + 1e-7) / widths[i]))
        # 칼 수 상한: 뒤의 발주 폭에 1칼씩 남겨도 MAX_CUTS 이내여야 리프에서 채택될 수 있다 (정수 비교라 정확)
        top = min(top, MAX_CUTS - cuts - need_cuts[i])
        for n in range(top, low - 1, -1):
            rest = left - n * widths[i]
            # 남은 폭에 뒤의 발주 폭을 1칼씩도 못 넣으면 그 아래 조합은 없다 (부동소수 경계는 여유 1e-6 두고 탐색)
            if rest + 1e-7 < need_width[i] - 1e-6:
                continue
            counts[i] = n
            walk(i + 1, rest, cuts + n)
            if len(found) >= MAX_COMBOS or visited > MAX_COMBO_NODES:
                break
        counts[i] = 0

    walk(0, usable, 0)
    with _COMBO_CACHE_LOCK:
        if len(_COMBO_CACHE) > 256:
            _COMBO_CACHE.clear()
        _COMBO_CACHE[key] = found
    return found


def _history_list(settings: dict) -> list[dict]:
    """④ 과거 가공이력 (여러 개). 예전 저장 형식(history_pattern 1개)도 읽는다."""
    items = settings.get("history_patterns")
    if not isinstance(items, list):
        one = settings.get("history_pattern")
        items = [one] if isinstance(one, dict) else []
    return [h for h in items if isinstance(h, dict) and h.get("pattern")]


TOP_CANDIDATES = 5   # ① 원자재 후보 추천은 상위 5개까지만 보여 준다


def _top_candidates(candidates: list[dict], chosen: dict | None) -> list[dict]:
    """상위 5개. 지금 고른 원자재가 5위 밖이면 맨 끝에 붙여서 표에서 사라지지 않게 한다."""
    top = candidates[:TOP_CANDIDATES]
    return top + [chosen] if chosen and all(c is not chosen for c in top) else top


def _drop_excluded(candidates: list[dict], settings: dict) -> list[dict]:
    """② 사용자가 목록에서 뺀 원자재 후보를 제외하고 순위를 다시 매긴다."""
    excluded = {str(x) for x in settings.get("excluded_raw") or []}
    kept = [c for c in candidates if c["id"] not in excluded]
    for rank, c in enumerate(kept, start=1):
        c["rank"] = rank
    return kept


def _coil_plans(raw_width, trim, combo, mode, weights, demand, extras=(), hist=None, limit=2):
    """후보 조합 생성 → 검증 → 정렬 → 상위 안 (시안 coilPlans)."""
    usable = raw_width - trim
    widths = [d["width"] for d in demand]
    extra_ws = [e for e in dict.fromkeys(_w(x) for x in extras) if e not in widths]

    def make(cuts, **extra):
        return {"cuts": cuts, "passes": [{"cuts": cuts, "kg": kg, "label": _pass_label(mode, j)} for j, kg in enumerate(weights)], **extra}

    pool = []
    if usable > 0:
        if combo == "SINGLE":
            total = sum(weights)
            ns = [min(int(floor((usable + 1e-7) / d["width"])), MAX_CUTS) for d in demand]
            if mode == "SPLIT" and len(demand) >= 2 and len(weights) == len(demand) and all(n >= 1 for n in ns):
                # 단독 + 등분: 발주 폭마다 한 차수씩 (1차 = 첫 폭만, 2차 = 둘째 폭만 …), 주문중량에 맞는 차수 중량을 권장
                fixed = [int(ceil(d["target"] * raw_width / (ns[i] * d["width"]))) if d["target"] is not None else None
                         for i, d in enumerate(demand)]
                fixed_sum, rest, rec = sum(v or 0 for v in fixed), sum(1 for v in fixed if v is None), None
                if rest > 0 and total - fixed_sum >= rest:
                    left, r, rec = total - fixed_sum, rest, []
                    for v in fixed:
                        if v is not None:
                            rec.append(v)
                            continue
                        value = left if r == 1 else floor(left / r)
                        left -= value
                        r -= 1
                        rec.append(value)
                pool.append({"cuts": None, "item_pass": True, "rec": rec, "passes": [
                    {"cuts": {d["width"]: ns[i]}, "kg": weights[i], "label": f"{i + 1}차 가공 · {d['width']:g}mm"}
                    for i, d in enumerate(demand)]})
            else:
                for width, n in zip(widths, ns):
                    if n >= 1:
                        pool.append(make({width: n}))
        else:
            options = (widths + extra_ws)[:MAX_MIX_WIDTHS]
            if len(options) >= 2:
                pool += [make(cuts) for cuts in _mixed_combos(usable, options, min(len(widths), len(options)))]
    # 과거 가공이력: 현재 원자재 폭에 들어가면 같은 기준으로 검증해 후보에 넣는다
    hists = hist if isinstance(hist, list) else ([hist] if hist else [])
    hist_used = set()
    for one in hists:
        cuts = {}
        for width, n in one.get("pattern") or []:
            if (to_number(width) or 0) > 0 and int(to_number(n) or 0) > 0:
                cuts[_w(to_number(width))] = cuts.get(_w(to_number(width)), 0) + int(to_number(n))
        if cuts and sum(w * n for w, n in cuts.items()) <= usable + 1e-7:
            hist_used.add(one.get("source"))
            same = next((p for p in pool if p["cuts"] and _cut_sig(p["cuts"]) == _cut_sig(cuts)), None)
            if same:
                same["source"] = same.get("source") or one.get("source")
            else:
                pool.append(make(cuts, source=one.get("source")))
    for plan in pool:
        plan["ev"] = _coil_eval(plan["passes"], raw_width, demand)

    def rank(plan):
        ev = plan["ev"]
        return (ev["bad"], 0 if ev["ok_all"] else 1, round((0 if ev["ok_all"] else ev["miss"]) + ev["loss"]), -round(ev["yield"] * 1e4))

    pool.sort(key=rank)
    seen, uniq = set(), []
    for plan in pool:
        sig = "|".join(_cut_sig(run["cuts"]) for run in plan["passes"])
        if sig not in seen:
            seen.add(sig)
            uniq.append(plan)
    with_extra = next((p for p in uniq if p["cuts"] and any(w in extra_ws for w in p["cuts"])), None)
    from_hist = [p for p in uniq if p.get("source")]
    limit = min(3, max(limit, 1 + len(from_hist)))   # 가공이력 안은 모두 보이게 (A·B·C 최대 3개)
    picked = []
    for plan in [uniq[0] if uniq else None, with_extra, *from_hist, *uniq[1:]]:
        if plan is not None and all(plan is not p for p in picked):
            picked.append(plan)
        if len(picked) >= limit:
            break
    for plan in picked:
        plan["extra_widths"] = extra_ws
    return picked, hist_used


def _group_text(cuts: dict) -> str:
    return " + ".join(f"{w:g} × {n}칼" for w, n in cuts.items() if n)


def _coil_plan_out(plan, index, raw_width, combo, hist, trim=0.0) -> dict:
    ev = plan["ev"]
    runs = []
    for run in plan["passes"]:
        if not run["kg"] > 0:
            continue
        used = sum(w * n for w, n in run["cuts"].items())
        runs.append({"label": run["label"], "weight": _round(run["kg"], 1), "used_width": _round(used), "remain_width": _round(raw_width - used),
                     "spare_width": _round(raw_width - used - trim),   # 잔여폭 = 원코일 − 사용폭 − 기본 로스
                     "pieces": [{"width": w, "cuts": n, "per_cut": _round(run["kg"] * w / raw_width, 1)} for w, n in run["cuts"].items() if n],
                     "produced": [{"width": w, "weight": _round(run["kg"] * w * n / raw_width, 1)} for w, n in run["cuts"].items() if n]})
        # 화면 표시용 kg 정수 배부 (재고가공등록 계획 불러오기와 같은 함수 · 같은 차수 투입중량)
        runs[-1]["alloc"] = allocate_coil_run(runs[-1]["weight"], raw_width, [(w, n) for w, n in run["cuts"].items() if n])
    per_pass = {}
    for run in plan["passes"]:
        for w, n in run["cuts"].items():
            per_pass[w] = max(per_pass.get(w, 0), n)
    candidates = set(plan.get("extra_widths") or [])
    pieces = [{"width": it["width"], "cuts": per_pass.get(it["width"], 0), "knives": it["n"], "produced_weight": _round(it["kg"], 1),
               "need_weight": _round(it["target"], 1) if it["target"] is not None else None, "remainder": it["target"] is None,
               "state": it["state"], "delta": _round(it["delta"], 1) if it["delta"] is not None else None,
               "per_cut": _round(it["kg"] / it["n"], 1) if it["n"] else None, "extra": False} for it in ev["items"]]
    pieces += [{"width": x["width"], "cuts": per_pass.get(x["width"], 0), "knives": x["n"], "produced_weight": _round(x["kg"], 1),
                "need_weight": None, "remainder": False, "state": "extra", "delta": None, "per_cut": _round(x["kg"] / x["n"], 1),
                "extra": True, "candidate": x["width"] in candidates} for x in ev["extras"]]
    # 폭별 정수 합계 (차수 합) · 정수 기준 과부족
    for piece in pieces:
        groups = [g for r in runs for g in r["alloc"]["widths"] if g["width"] == piece["width"]]
        piece["int_produced"] = sum(g["weight"] for g in groups)
        piece["int_loss"] = sum(g["loss"] for g in groups)
        piece["int_delta"] = piece["int_produced"] - piece["need_weight"] if piece.get("need_weight") is not None else None
    pattern = (" / ".join(_group_text(run["cuts"]) for run in plan["passes"]) if plan.get("item_pass")
               else _group_text(plan["cuts"]))
    first = runs[0] if runs else {"used_width": 0, "remain_width": raw_width}
    source = plan.get("source")
    return {
        "id": "ABC"[index], "combo": combo, "item_pass": bool(plan.get("item_pass")), "source": source,
        "actual_loss": next((h.get("actual_loss") for h in (hist or []) if source and h.get("source") == source), None),
        "pieces": pieces, "runs": runs, "pattern": pattern,
        "used_width": first["used_width"], "remain_width": first["remain_width"],
        "used_widths": sorted({r["used_width"] for r in runs}), "remain_widths": sorted({r["remain_width"] for r in runs}),
        "trim_width": _round(trim), "spare_widths": sorted({r["spare_width"] for r in runs}),
        "input_weight": _round(ev["input"], 1), "production_weight": _round(ev["out"], 1), "loss_weight": _round(ev["loss"], 1),
        "int_production": sum(r["alloc"]["produced"] for r in runs), "int_loss": sum(r["alloc"]["loss"] for r in runs),
        "yield_rate": _round(ev["yield"] * 100, 2), "knives": ev["knives"], "ok_all": ev["ok_all"], "issues": ev["issues"],
        "candidate_widths": sorted({w for w in (plan["cuts"] or {}) if w in candidates}),
        "rec_weights": plan.get("rec") if plan.get("item_pass") and plan.get("rec") and not ev["ok_all"] else None,
    }


def _coil_candidate_metrics(raw_width, trim, combo, demand, extras, fixed_weight=None):
    """② 후보표 값 (시안 candidateFill). 중량을 알면 그 중량으로, 모르면 발주를 채우는 최소 투입중량을 계산."""
    if raw_width - trim <= 0:
        return None
    if fixed_weight:
        plans, _ = _coil_plans(raw_width, trim, combo, "ONE", [fixed_weight], demand, extras, limit=1)
        if not plans:
            return None
        input_kg, output_kg = fixed_weight, plans[0]["ev"]["out"]
    else:
        best = None
        plans, _ = _coil_plans(raw_width, trim, combo, "ONE", [1000.0], demand, extras, limit=2)
        for plan in plans:
            need, ok = 0.0, True
            for it in plan["ev"]["items"]:
                if it["target"] is None:
                    continue
                if not it["n"] or not it["kg"] > 0:
                    ok = False
                    break
                need = max(need, it["target"] / (it["kg"] / 1000))
            if not ok or not need > 0:
                continue
            out = plan["ev"]["out"] * need / 1000
            if best is None or need - out < best[0] - best[1]:
                best = (need, out)
        if not best:
            return None
        input_kg, output_kg = best
    # 표시는 kg 정수 (결과 표 · 재고가공등록과 같은 반올림): 생산 = 반올림, 로스 = 투입 − 생산. 수율은 이론값 그대로
    produced_int = float(Decimal(str(output_kg)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    return {"input_weight": _round(input_kg, 1), "production_weight": produced_int,
            "loss_weight": _round(input_kg - produced_int, 1), "yield_rate": _round(output_kg / input_kg * 100, 2) if input_kg else None}


def _coil_trim(settings: dict) -> float:
    return float(settings.get("trimloss") if settings.get("trimloss") is not None else TRIM_LOSS_DEFAULT)


def _extra_sizes(values, minimum: float) -> list[float]:
    """④ 가공 후보 폭·길이 (화면 입력). 중복 제거, 너무 작은 값은 무시, 최대 MAX_EXTRA_SIZES 개."""
    if not isinstance(values, (list, tuple)):
        return []
    sizes = (to_number(x) for x in values[:50])
    return list(dict.fromkeys(_w(v) for v in sizes if v is not None and v >= minimum))[:MAX_EXTRA_SIZES]


def _linked_keys(lines: list[dict]) -> set:
    return {(s["sourcetype"], s["sourceno"], int(s["sourceline"])) for x in lines for s in x["raw_links"]}


def _load_stocks(cur, companyid, lines, settings, planno, material) -> list[dict]:
    """계산 전에 원자재 후보(현재고)를 미리 읽는다 → 무거운 조합 계산은 DB 연결을 반납한 뒤에 한다."""
    if material == "COIL":
        # 원자재 후보 폭 기준 = 담은 품목 중 가장 넓은 폭 + 로스 (그보다 좁은 재고 · 신규 후보는 제외, 연결 원자재는 그대로 보여 줌)
        min_w = max(d["width"] for d in _coil_demand(lines))
        return _stock_candidates(cur, companyid, lines, "COIL", min_w + _coil_trim(settings), 0, _linked_keys(lines), planno,
                                 settings.get("_warehouse"))
    item_w = lines[0]["width"]
    if any(not _same_size(x["width"], item_w) for x in lines):
        return []
    min_len = min(_w(x["length"]) for x in lines)
    return _stock_candidates(cur, companyid, lines, "SHEET", item_w, min_len, _linked_keys(lines), planno, settings.get("_warehouse"))


def _analyze_coil(stocks, lines, settings):
    trim = _coil_trim(settings)
    demand = _coil_demand(lines)
    min_w = max(d["width"] for d in demand)
    extras = _extra_sizes(settings.get("extrawidths"), MIN_EXTRA_WIDTH)
    hist = _history_list(settings)
    # 과거 매입 규격 자동 후보는 당분간 쓰지 않는다 (② 후보 = 연결 원자재 · 현재고 · 사용자가 추가한 후보만)
    sizes = []
    cand_combo = "MIXED" if len(demand) + len(set(extras) - {d["width"] for d in demand}) >= 2 else "SINGLE"

    candidates = []
    for s in stocks:
        m = _coil_candidate_metrics(s["width"], trim, cand_combo, demand, extras, s["weight"])
        candidates.append({**s, **(m or {}), "placeable": bool(m), "weight_tag": None,
                           "label": "연결 원자재" if s["linked"] else "현재고"})
    seen_new = set()
    base = lines[0]
    new_rows = [*_new_candidates(settings, "COIL"),
                *({"width": _w(z["width"]), "weight": None, "source": None, "count": z["count"], "lastdate": z["lastdate"]} for z in sizes)]
    for size in new_rows:
        if size["width"] in seen_new or size["width"] < min_w + trim:
            continue
        seen_new.add(size["width"])
        assumed = size.get("weight") or None
        m = _coil_candidate_metrics(size["width"], trim, cand_combo, demand, extras, assumed)
        label = "직접 입력" if size.get("source") == "직접 입력" else "신규 (매입이력)"
        candidates.append({"kind": "NEW", "linked": False, "width": size["width"], "length": None,
                           "itemname": base["itemname"], "steelgrade": base["steelgrade"], "surface": base["surface"],
                           "thickness": base["thickness"], "qty": None, "weight": None, "label": label,
                           "source": size.get("source"), "assumed_weight": assumed,
                           "purchase_count": size.get("count"), "lastdate": size.get("lastdate"),
                           **(m or {}), "placeable": bool(m), "weight_tag": ("가정" if assumed else "필요") if m else None})
    candidates.sort(key=lambda c: (0 if c["linked"] else 1 if c["kind"] == "STOCK" else 2, 0 if c["placeable"] else 1, -(c.get("yield_rate") or 0)))
    for rank, c in enumerate(candidates, start=1):
        c["rank"] = rank
        c["id"] = (f"STOCK|{c['sourcetype']}|{c['sourceno']}|{c['sourceline']}" if c["kind"] == "STOCK" else f"NEW|{c['width']:g}")
    candidates = _drop_excluded(candidates, settings)

    # ③ 선택 원자재 (없으면 계산되는 첫 후보)
    chosen = (next((c for c in candidates if c["id"] == settings.get("raw_id")), None)
              or next((c for c in candidates if c["placeable"]), None) or (candidates[0] if candidates else None))
    result = {"candidates": _top_candidates(candidates, chosen), "raw": None, "plans": [], "trimloss": trim, "demand": demand,
              "notes": [], "notes_warn": False, "warnings": []}
    if not chosen:
        result["message"] = f"가장 넓은 품목 폭 {min_w:g}mm + 기본 로스 {trim:g}mm 이상인 원자재 후보가 없습니다. 원자재 폭을 직접 입력해 주세요."
        return result
    # 현재고는 실물 값(폭 · 중량, 공유재고면 배분 중량)을 그대로 쓴다. 화면 입력값은 신규 후보에만 적용
    is_stock = chosen["kind"] == "STOCK"
    raw_width = float(chosen["width"] if is_stock else (settings.get("raw_width") or chosen["width"]))
    default_weight = chosen["weight"] if is_stock else (chosen.get("assumed_weight") or chosen.get("input_weight"))
    raw_weight = float(default_weight or 0) if is_stock else float(settings.get("raw_weight") or default_weight or 0)
    mode = settings.get("processmode") or "ONE"
    if mode == "SPLIT":
        runs = [to_number(v) or 0 for v in settings.get("splitweights") or []] or [raw_weight / 2, raw_weight - raw_weight / 2]
    elif mode == "PARTIAL":
        partial = to_number(settings.get("partialweight"))
        runs = [partial if partial is not None else raw_weight]
    else:
        runs = [raw_weight]
    process_weight = sum(runs)
    result["raw"] = {**chosen, "raw_width": raw_width, "raw_weight": raw_weight, "processmode": mode,
                     "runs": runs, "process_weight": process_weight, "storage_weight": max(0.0, raw_weight - process_weight)}
    if chosen["kind"] == "STOCK" and raw_weight > chosen["weight"] + 1e-6:
        result["warnings"].append(f"가공중량이 현재고 {chosen['weight']:,.1f}kg 보다 큽니다.")
    if raw_weight <= 0:
        result["message"] = "② 가공중량을 입력해 주세요. (발주 중량이 없는 '나머지' 품목만 있으면 신규 원자재의 투입중량을 정할 수 없습니다.)"
        return result
    if (raw_width <= 0 or trim < 0 or trim >= raw_width or any(r < 0 for r in runs)
            or (mode == "SPLIT" and abs(process_weight - raw_weight) > 0.1) or (mode == "PARTIAL" and runs[0] > raw_weight + 1e-6)):
        result["message"] = "② 원자재 폭·중량 또는 가공중량을 확인해 주세요. 등분 합계는 원코일 중량과 같아야 하고, 일부가공 중량은 원코일 중량 이하여야 합니다."
        return result

    # ④ 조합
    combo = settings.get("combo") or "SINGLE"
    order_widths = sorted({d["width"] for d in demand})

    if combo == "SINGLE" and len(order_widths) >= 2 and mode != "SPLIT":
        # 단독 = 코일 한 번에 한 폭만 자른다 → 폭이 다른 품목을 원샷·일부가공으로 함께 만들 수 없다
        # 화면은 추천조합 자리에 안내로 보여 준다 (상단 경고 아님)
        result["no_combo"] = {"title": "추천 가능한 조합이 없습니다",
                              "desc": f"단독은 코일 한 번에 한 가지 폭만 자릅니다. 폭이 다른 품목({' · '.join(f'{w:g}' for w in order_widths)}mm)을 함께 만들려면 "
                                      f"혼합을 선택하거나 가공방식을 등분으로 바꿔 주세요."}
        return result
    plans, hist_used = _coil_plans(raw_width, trim, combo, mode, runs, demand, extras, hist)
    result["plans"] = [_coil_plan_out(p, i, raw_width, combo, hist, trim) for i, p in enumerate(plans)]
    for one in hist:
        if one.get("source") not in hist_used:
            result["warnings"].append(f"가공이력 {one.get('source') or ''}의 칼 배치가 현재 원자재 폭({raw_width:g}mm − 로스 {trim:g}mm)에 들어가지 않아 반영하지 못했습니다.")
    if not plans:
        need_more = combo == "MIXED" and len(demand) < 2 and not extras
        result["message"] = ("혼합조합은 2개 이상의 폭이 필요합니다. 같은 소재의 대기 품목을 더 담거나, ③ 과거 가공이력 → 가공매출이력 · 직접 입력으로 가공 후보 폭을 더해 주세요."
                             if need_more else "현재 원자재 폭과 로스 값으로 선택 발주폭 조합을 만들 수 없습니다. 원자재 폭 또는 단독·혼합 선택을 변경해 주세요.")
        return result
    # ④ 하단 안내: 방식 기준 + 미충족 사유
    notes = [("단독" if combo == "SINGLE" else "혼합") + " · " + (f"등분 {len(runs)}차" if mode == "SPLIT" else "일부가공" if mode == "PARTIAL" else "원샷") + " 기준"]
    warn = False
    if not any(p["ev"]["ok_all"] for p in plans) and combo == "SINGLE" and len(demand) >= 2:
        warn = True
        widths_text = "·".join(f"{d['width']:g}" for d in demand)
        if mode != "SPLIT":
            notes.append(f"단독조합은 한 번에 한 폭만 가공하므로 {widths_text}mm를 동시에 생산할 수 없습니다. 등분(품목별 차수) 또는 혼합조합을 선택하세요.")
        elif len(runs) != len(demand):
            notes.append(f"등분 차수({len(runs)})와 발주 폭 수({len(demand)})가 달라 품목별 차수로 계산하지 못했습니다.")
        else:
            warn = False
    over = [it for it in plans[0]["ev"]["items"] if it["state"] == "over"]
    if over and mode == "ONE" and not plans[0]["ev"]["ok_all"]:
        notes.append(" · ".join(f"{it['width']:g}mm {it['delta']:,.0f}kg" for it in over) + " 초과 생산됩니다. "
                     "가공방식을 '일부가공'으로 가공중량을 줄이거나, 단독 + '등분'(품목별 차수)으로 권장 등분중량을 적용하면 주문에 맞출 수 있습니다.")
    if len(plans) < 2 and not plans[0].get("item_pass"):
        notes.append("추천 가능한 조합 1개")
    result["notes"], result["notes_warn"] = notes, warn
    return result


# ---------------------------------------------------------------- 시트 계산 (시안 v10 sheetSolve)
def _sheet_pattern(cap, lengths, active, required, mode, style, need, budget=None):
    """원판 1줄(폭 방향 1스트립)에 놓을 길이별 개수.
    혼합: 선택 품목은 모든 원판에 1개 이상, 한 줄 개수는 남은 발주수량을 넘지 않음. 가공 후보 길이는 0개 이상.

    전체 탐색이 기본이다. 품목·후보 길이가 많아 방문 노드가 상한(MAX_SHEET_NODES, 요청 전체 budget)을 넘으면
    탐색을 멈추고, 그때까지의 최선과 균형 채우기(greedy) 결과 중 점수가 높은 쪽을 쓴다."""
    if mode == "SINGLE":
        i = active[0]
        fit = int(floor((cap + 1e-7) / lengths[i]))
        return {i: fit} if fit >= 1 else None
    if any(need[i] < 1 for i in required):
        return None
    if sum(lengths[i] for i in required) > cap + 1e-8:
        return None
    best, counts = None, {}
    limit = MAX_SHEET_NODES if budget is None else max(1, min(MAX_SHEET_NODES, budget[0]))
    visited = 0

    def score_of(cnt, used):
        progress = min(cnt.get(i, 0) / max(1, need[i]) for i in required)
        balance = sum((cnt.get(i, 0) / need[i] - progress) ** 2 for i in required)
        return progress * 1e7 - balance * 1e5 + (used if style == "max" else cap - used) * 0.001

    def visit(pos, used):
        nonlocal best, visited
        visited += 1
        if visited > limit:
            return
        if pos == len(active):
            score = score_of(counts, used)
            if best is None or score > best[0]:
                best = (score, {k: v for k, v in counts.items() if v})
            return
        i = active[pos]
        extra = i not in required
        future = sum(lengths[j] for j in active[pos + 1:] if j in required)
        top = min(12 if extra else need[i], int(floor((cap - used - future + 1e-8) / lengths[i])), 12)
        for n in range(0 if extra else 1, top + 1):
            counts[i] = n
            visit(pos + 1, used + n * lengths[i])
            if visited > limit:
                break
        counts.pop(i, None)

    visit(0, 0.0)
    if budget is not None:
        budget[0] -= min(visited, limit)
    if visited > limit:
        # 탐색 중단 → 균형 채우기: 발주 대비 비율이 가장 낮은 품목부터 1개씩 (한 줄 최대 12개 · 발주수량 이내)
        greedy = {i: 1 for i in required}
        used = sum(lengths[i] for i in required)
        while True:
            fits = [i for i in required if greedy[i] < min(need[i], 12) and used + lengths[i] <= cap + 1e-8]
            if not fits:
                break
            i = min(fits, key=lambda k: greedy[k] / need[k])
            greedy[i] += 1
            used += lengths[i]
        if style == "max":   # 남는 길이는 가공 후보 길이로 (긴 것부터)
            for i in sorted((k for k in active if k not in required), key=lambda k: -lengths[k]):
                n = min(12, int(floor((cap - used + 1e-8) / lengths[i])))
                if n > 0:
                    greedy[i] = n
                    used += n * lengths[i]
        score = score_of(greedy, used)
        if best is None or score > best[0]:
            best = (score, greedy)
    return best[1] if best else None


def _analyze_sheet(stocks, lines, settings):
    item_w = lines[0]["width"]
    if any(not _same_size(x["width"], item_w) for x in lines):
        return {"candidates": [], "raw": None, "plans": [], "message": "시트 혼합은 폭이 같은 품목끼리만 할 수 있습니다. 같은 폭 품목을 선택해 주세요."}
    order_lengths = [_w(x["length"]) for x in lines]
    extra_lengths = [v for v in _extra_sizes(settings.get("extralengths"), MIN_EXTRA_LENGTH) if v not in order_lengths]
    lengths = order_lengths + extra_lengths
    need = [int(ceil(x["need_amount"])) for x in lines] + [0] * len(extra_lengths)
    thick = lines[0]["thickness"]
    min_len = min(order_lengths)
    sizes = []   # 과거 매입 규격 자동 후보는 당분간 쓰지 않는다
    mode = settings.get("combo") or ("MIXED" if len(lines) > 1 else "SINGLE")
    orientation = settings.get("orientation") or "NORMAL"
    # 단독절단 = 기준 품목(첫 품목)만, 혼합절단 = 담은 품목 전부 + 가공 후보 길이
    required = list(range(len(lines))) if mode == "MIXED" else [0]
    active = required + (list(range(len(lines), len(lengths))) if mode == "MIXED" else [])
    hists = _history_list(settings)
    hist = None   # evaluate(…, "history") 가 쓰는 현재 가공이력

    def hist_counts(strips):
        """과거 절단 패턴(원판 1매 기준 [폭, 길이, 매]) → 이번 원판 1줄 기준 {품목: 개수}. 맞지 않으면 None."""
        if not hist or not hist.get("pattern"):
            return None
        counts = {}
        for row in hist["pattern"]:
            width, length, per_sheet = (to_number(v) for v in (list(row) + [None, None, None])[:3])
            if not (per_sheet or 0) > 0:
                continue
            if not _same_size(width, item_w):
                return None
            index = next((i for i in active if _same_size(lengths[i], length)), None)
            if index is None or int(per_sheet) % strips:
                return None
            counts[index] = counts.get(index, 0) + int(per_sheet) // strips
        return counts or None

    search_budget = [MAX_SHEET_TOTAL_NODES]   # 원자재 후보 전체가 함께 쓰는 탐색 노드 수
    pattern_cache: dict = {}                   # 같은 원판 길이(cap)·방식이면 배치 결과가 같다

    def evaluate(raw_w, raw_l, style="max", budget=search_budget):
        cap = raw_l if orientation == "NORMAL" else raw_w
        across = raw_w if orientation == "NORMAL" else raw_l
        strips = min(int(floor((across + 1e-7) / item_w)), 50)
        if strips < 1:
            return None
        if style == "history":
            pattern = hist_counts(strips)
            if not pattern or sum(n * lengths[i] for i, n in pattern.items()) > cap + 1e-7:
                return None
        else:
            key = (cap, style)
            if key not in pattern_cache:
                pattern_cache[key] = _sheet_pattern(cap, lengths, active, required, mode, style, need, budget)
            pattern = dict(pattern_cache[key]) if pattern_cache[key] else None
        if not pattern:
            return None
        per_sheet = {i: pattern.get(i, 0) * strips for i in active}
        if any(per_sheet[i] <= 0 for i in required):
            return None
        sheets = max([int(ceil(need[i] / per_sheet[i])) for i in required if need[i] > 0] + [1])
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
            candidates.append({**s, **m, "label": "연결 원자재" if s["linked"] else "현재고", "short_sheets": max(0, m["sheets"] - int(s["qty"]))})
    seen = set()
    new_rows = [*_new_candidates(settings, "SHEET"),
                *({"width": _w(z["width"]), "length": _w(z["length"]), "source": None, "count": z["count"]} for z in sizes if z["length"])]
    for size in new_rows:
        if (size["width"], size["length"]) in seen:
            continue
        seen.add((size["width"], size["length"]))
        m = evaluate(size["width"], size["length"])
        if m:
            candidates.append({"kind": "NEW", "linked": False, "width": size["width"], "length": size["length"],
                               "itemname": lines[0]["itemname"], "steelgrade": lines[0]["steelgrade"], "surface": lines[0]["surface"],
                               "thickness": thick, "qty": None, "weight": None, "source": size.get("source"),
                               "label": "직접 입력" if size.get("source") == "직접 입력" else "신규 (매입이력)",
                               "purchase_count": size.get("count"), **m})
    candidates.sort(key=lambda c: (0 if c["linked"] else 1 if c["kind"] == "STOCK" else 2, -(c["yield_rate"] or 0)))
    for rank, c in enumerate(candidates, start=1):
        c["rank"] = rank
        c["placeable"] = True
        c["id"] = (f"STOCK|{c['sourcetype']}|{c['sourceno']}|{c['sourceline']}" if c["kind"] == "STOCK"
                   else f"NEW|{c['width']:g}x{c['length']:g}")
    candidates = _drop_excluded(candidates, settings)
    chosen = next((c for c in candidates if c["id"] == settings.get("raw_id")), None) or (candidates[0] if candidates else None)
    result = {"candidates": _top_candidates(candidates, chosen), "raw": None, "plans": [], "orientation": orientation, "warnings": [], "notes": [], "notes_warn": False}
    if not chosen:
        result["message"] = f"폭 {item_w:g}mm · 길이 {min_len:g}mm 이상인 원판 후보가 없습니다. 원판 규격을 직접 입력해 주세요."
        return result
    # 현재고 원판은 실물 규격 고정, 신규 후보만 화면 입력값 적용
    is_stock = chosen["kind"] == "STOCK"
    raw_w = float(chosen["width"] if is_stock else (settings.get("raw_width") or chosen["width"]))
    raw_l = float(chosen["length"] if is_stock else (settings.get("raw_length") or chosen["length"]))
    stock_sheets = int(chosen["qty"]) if chosen["kind"] == "STOCK" else None
    result["raw"] = {**chosen, "raw_width": raw_w, "raw_length": raw_l, "raw_sheets": stock_sheets}
    seen_patterns = set()
    # 가공이력마다 한 번씩 (history), 그다음 기본 배치 (max · balanced). 가공이력 안은 모두 보이게 (A·B·C 최대 3개)
    max_plans = min(3, max(2, 1 + len(hists)))
    for style, one in [*(("history", h) for h in hists), ("max", None), ("balanced", None)]:
        hist = one
        m = evaluate(raw_w, raw_l, style, budget=None)   # 선택 원판의 추천안은 요청 budget 과 별도로 계산
        if not m:
            continue
        sig = tuple(sorted(m["pattern"].items()))
        if sig in seen_patterns:
            continue
        seen_patterns.add(sig)
        pieces = []
        for i in active:
            extra = i >= len(lines)
            pieces.append({"length": lengths[i], "width": item_w, "per_strip": m["pattern"].get(i, 0), "per_sheet": m["pattern"].get(i, 0) * m["strips"],
                           "produced_qty": m["produced"][i], "need_qty": need[i], "over_qty": 0 if extra else m["produced"][i] - need[i],
                           "extra": extra, "orderid": None if extra else lines[i]["orderid"], "lineno": None if extra else lines[i]["lineno"]})
        result["plans"].append({"id": "ABC"[len(result["plans"])], "combo": mode, "orientation": orientation, "pieces": pieces,
                                "source": one.get("source") if style == "history" else None,
                                "short_sheets": max(0, m["sheets"] - stock_sheets) if stock_sheets is not None else 0,
                                "pattern": " + ".join(f"{p['length']:g} × {p['per_strip']}" for p in pieces if p["per_strip"]) + (f" (× {m['strips']}줄)" if m["strips"] > 1 else ""),
                                **{k: m[k] for k in ("sheets", "strips", "input_weight", "production_weight", "loss_weight", "yield_rate",
                                                     "used_across", "remain_across", "used_along")}})
        if len(result["plans"]) >= max_plans:
            break
    used_sources = {p.get("source") for p in result["plans"]}
    for one in hists:
        if one.get("source") not in used_sources:
            result["warnings"].append(f"가공이력 {one.get('source') or ''}의 절단 패턴이 현재 원판·품목에 맞지 않아 반영하지 못했습니다.")
    if result["plans"] and result["plans"][0]["short_sheets"] > 0:
        result["warnings"].append(f"필요 원판 {result['plans'][0]['sheets']}매 중 현재고는 {stock_sheets}매입니다. {result['plans'][0]['short_sheets']}매는 매입이 필요합니다.")
    if mode == "SINGLE" and len(lines) > 1:
        result["notes"] = ["단독절단은 기준 품목만 계산합니다. 미선택 발주품목(별도 가공): "
                           + " / ".join(f"{x['length']:g}mm {int(ceil(x['need_amount']))}매" for x in lines[1:])]
        result["notes_warn"] = True
    if not result["plans"]:
        result["message"] = ("선택한 품목을 원판 1매에 1개씩 모두 배치할 수 없습니다. 혼합 품목이나 원판 규격을 변경해 주세요."
                             if mode == "MIXED" else "선택한 원판 규격으로 절단 조합을 만들 수 없습니다.")
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
        stocks = _load_stocks(cur, companyid, lines, settings, planno, material)
    # 조합 계산은 CPU 작업 → 풀 연결을 반납한 뒤에 한다
    result = (_analyze_coil if material == "COIL" else _analyze_sheet)(stocks, lines, settings)
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
        "remainder_count": sum(1 for x in lines if x.get("remainder")),
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
    # 확정은 담은 품목이 모두 이 계획에서 생산될 때만 (생산 안 되는 품목까지 '계획확정' 되지 않게)
    if material == "COIL":
        made = {p["width"] for p in plan["pieces"] if not p["extra"] and p["knives"] > 0}
        unmade = [f"{x['orderid']}-{x['lineno']}" for x in result["lines"] if _w(x["width"]) not in made]
    else:
        made = {(p["orderid"], p["lineno"]) for p in plan["pieces"] if not p.get("extra") and p["produced_qty"] > 0}
        unmade = [f"{x['orderid']}-{x['lineno']}" for x in result["lines"] if (x["orderid"], x["lineno"]) not in made]
    if status == "CONFIRMED" and unmade:
        raise ValueError("이 조합으로 생산되지 않는 품목이 있어 확정할 수 없습니다: " + ", ".join(unmade[:5])
                         + ". 조합(혼합·등분)을 바꾸거나 품목을 빼고 따로 계획해 주세요.")
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
            if material == "COIL":
                # 코일: 다른 확정 계획이 아직 잡아 둔 가공중량 + 이번 가공중량 ≤ 현재고 중량이면 함께 쓸 수 있다
                cur.execute(f"""SELECT s.weight, {plan_outstanding_sql('s', '%s')} AS used,
                                       (SELECT string_agg(planno, ', ') FROM aiplan01t pl WHERE pl.companyid = s.companyid
                                           AND pl.status = 'CONFIRMED' AND pl.rawkind = 'STOCK' AND pl.planno <> %s
                                           AND pl.stocksourcetype = s.sourcetype AND pl.stocksourceno = s.sourceno
                                           AND pl.stocksourceline = s.sourceline) AS plans
                                  FROM currentstock01t s
                                 WHERE s.companyid = %s AND s.sourcetype = %s AND s.sourceno = %s AND s.sourceline = %s""",
                            (planno, planno, companyid, raw["sourcetype"], raw["sourceno"], raw["sourceline"]))
                found = cur.fetchone()
                if not found:
                    raise ValueError("선택한 원자재 재고를 찾을 수 없습니다.")
                if float(found["used"] or 0) + float(plan.get("input_weight") or 0) > float(found["weight"] or 0) + 0.05:
                    raise ValueError(f"선택한 원자재는 다른 확정 계획({found['plans']})이 {float(found['used']):,.1f}kg을 잡고 있어 "
                                     f"남은 {max(0.0, float(found['weight']) - float(found['used'])):,.1f}kg로는 가공중량을 채울 수 없습니다.")
            cur.execute("""SELECT string_agg(planno, ', ') AS plans, COALESCE(SUM(rawweight), 0) AS used_weight, COALESCE(SUM(rawsheets), 0) AS used_sheets
                             FROM aiplan01t WHERE companyid = %s AND status = 'CONFIRMED' AND rawkind = 'STOCK' AND materialtype = 'SHEET'
                             AND stocksourcetype = %s AND stocksourceno = %s AND stocksourceline = %s AND planno <> %s""",
                        (companyid, raw["sourcetype"], raw["sourceno"], raw["sourceline"], planno))
            other = cur.fetchone()
            if material == "SHEET" and other and other["plans"]:
                # 공유 재고(여러 주문 품목에 연결)는 배분량만큼 여러 계획이 나눠 쓸 수 있다 · 그 밖에는 한 계획만
                cur.execute("SELECT weight, qty FROM currentstock01t WHERE companyid = %s AND sourcetype = %s AND sourceno = %s AND sourceline = %s",
                            (companyid, raw["sourcetype"], raw["sourceno"], raw["sourceline"]))
                stock = cur.fetchone() or {"weight": 0, "qty": 0}
                shared = stock_shares(cur, companyid, {(raw["sourcetype"], raw["sourceno"], int(raw["sourceline"]))})
                is_shared = any(v["count"] > 1 for v in shared.values())
                if material == "COIL":
                    over = float(other["used_weight"] or 0) + float(raw.get("raw_weight") or 0) > float(stock["weight"] or 0) + 0.05
                else:
                    over = float(other["used_sheets"] or 0) + float(plan.get("sheets") or 0) > float(stock["qty"] or 0) + 1e-6
                if not is_shared or over:
                    raise ValueError(f"선택한 원자재는 다른 확정 계획({other['plans']})에 잡혀 있습니다."
                                     + (" 계획들의 투입량 합계가 재고량을 넘습니다." if is_shared else ""))
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
            # 폭별 생산중량을 주문 품목에 나눈다: 중량 주문 먼저 (필요중량까지), '나머지' 주문이 남은 중량 전부.
            remaining = {p["width"]: p["produced_weight"] for p in plan["pieces"]}
            given = {}
            for k in sorted(keys, key=lambda key: 1 if line_by_key[key].get("remainder") else 0):
                x = line_by_key[k]
                left = remaining.get(_w(x["width"]), 0)
                give = left if x.get("remainder") else min(left, x["need_amount"])
                remaining[_w(x["width"])] = left - give
                given[k] = give
            for k in keys:
                x = line_by_key[k]
                cuts = next((p["cuts"] for p in plan["pieces"] if p["width"] == _w(x["width"])), 0)
                lineno += 1
                cur.execute("""INSERT INTO aiplan02t (companyid, companyname, planno, lineno, linekind, orderid, orderlineno,
                               width, length, cuts, readyweight, plannedweight) VALUES (%s,%s,%s,%s,'ORDER',%s,%s,%s,%s,%s,%s,%s)""",
                            (companyid, companyname, planno, lineno, x["orderid"], x["lineno"], x["width"], None, cuts,
                             x["ready_amount"], _round(given[k], 1)))
            for p in plan["pieces"]:
                if (p["extra"] and p["knives"] > 0) or remaining.get(p["width"], 0) > 0.05:
                    lineno += 1
                    cur.execute("""INSERT INTO aiplan02t (companyid, companyname, planno, lineno, linekind, width, cuts, plannedweight)
                                   VALUES (%s,%s,%s,%s,'EXTRA',%s,%s,%s)""",
                                (companyid, companyname, planno, lineno, p["width"], p["cuts"], _round(remaining.get(p["width"], p["produced_weight"]), 1)))
        else:
            pieces = {(p["orderid"], p["lineno"]): p for p in plan["pieces"] if not p.get("extra")}
            for k in keys:
                x = line_by_key[k]
                p = pieces.get(k)
                lineno += 1
                cur.execute("""INSERT INTO aiplan02t (companyid, companyname, planno, lineno, linekind, orderid, orderlineno,
                               width, length, cuts, readyweight, plannedqty) VALUES (%s,%s,%s,%s,'ORDER',%s,%s,%s,%s,%s,%s,%s)""",
                            (companyid, companyname, planno, lineno, x["orderid"], x["lineno"], x["width"], x["length"],
                             p["per_sheet"] if p else 0, x["ready_amount"], p["produced_qty"] if p else 0))
            for p in plan["pieces"]:
                if p.get("extra") and p["produced_qty"] > 0:
                    lineno += 1
                    cur.execute("""INSERT INTO aiplan02t (companyid, companyname, planno, lineno, linekind, width, length, cuts, plannedqty)
                                   VALUES (%s,%s,%s,%s,'EXTRA',%s,%s,%s,%s)""",
                                (companyid, companyname, planno, lineno, p["width"], p["length"], p["per_sheet"], p["produced_qty"]))
        if status == "CONFIRMED":
            cur.execute("""UPDATE aiorder02t SET optimize_status = 'PLANNED', updated_at = CURRENT_TIMESTAMP, updated_by = COALESCE(%s, updated_by)
                           WHERE companyid = %s AND (orderid, lineno) IN (SELECT * FROM unnest(%s::varchar[], %s::integer[]))""",
                        (actor or None, companyid, [k[0] for k in keys], [k[1] for k in keys]))
        conn.commit()
    return {"planno": planno, "status": status}


def list_plans(companyid: str, status: str = "OPEN") -> dict:
    # OPEN = 계획 불러오기 목록 (취소된 계획만 뺀다 · 가공완료도 조회용으로 보여 준다)
    statuses = {"OPEN": ["DRAFT", "CONFIRMED", "DONE"], "DRAFT": ["DRAFT"], "CONFIRMED": ["CONFIRMED"], "DONE": ["DONE"],
                "ALL": list(PLAN_STATUSES)}.get(status, ["DRAFT", "CONFIRMED", "DONE"])
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
        cur.execute("SELECT string_agg(processno, ', ' ORDER BY processno) AS nos, COUNT(*) AS cnt FROM process01t WHERE companyid = %s AND planno = %s",
                    (companyid, planno))
        registered = cur.fetchone() or {}
        nos = [x for x in str(registered.get("nos") or "").split(", ") if x]
        docs = f"{nos[0]}{f' 외 {len(nos) - 1}건' if len(nos) > 1 else ''}" if nos else ""
        if row["status"] == "CANCELLED":
            raise ValueError("이미 취소된 계획입니다.")
        if row["status"] == "DONE" or nos:
            # 짧게: 무엇 때문에 · 무엇을 하면 되는지
            raise ValueError(f"{'가공완료된 계획입니다' if row['status'] == 'DONE' else '가공등록된 차수가 있습니다'}. "
                             f"재고가공등록에서 {docs}을(를) 먼저 삭제해 주세요.")
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


# ---------------------------------------------------------------- 이력 (② 과거 매입이력 · ④ 과거 가공이력 · ④ 가공 후보 = 매출이력)
HISTORY_KINDS = ("purchase", "sales", "processing")


def history(companyid: str, kind: str, material: str, itemname: str = "", months: int = 0, q: str = "", limit: int = 200) -> dict:
    """같은 품명의 과거 기록. 적합 여부(두께·폭)는 화면이 현재 ③ 값으로 판단하고, 적용 후 서버가 다시 검증한다.

    purchase   : 입고(Inbound01t/02t) 한 줄 = 매입한 원자재 규격 → ② 신규 후보
    sales      : 출고(Outbound01t/02t) 한 줄 = 출고한 제품 규격 → ④ 가공 후보 폭(코일) / 길이(시트)
    processing : 가공등록(Process01t/02t) 원자재(SOURCE) 1줄 + 그 바로 아래 제품(PRODUCT) = 실제 칼 배치 → ④ 추천조합
    """
    if kind not in HISTORY_KINDS:
        raise ValueError("이력 종류를 확인해 주세요.")
    material = "SHEET" if material == "SHEET" else "COIL"
    params = {"companyid": companyid, "name": f"%{str(itemname or '').strip()}%", "months": max(0, int(months or 0)),
              "q": f"%{str(q or '').strip()}%", "limit": max(1, min(500, int(limit)))}
    has_q = bool(str(q or "").strip())
    length_sql = "COALESCE({a}.length, 0) = 0" if material == "COIL" else "COALESCE({a}.length, 0) > 0"
    with _connection() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
        if kind in ("purchase", "sales"):
            head, body = ("inbound01t", "inbound02t") if kind == "purchase" else ("outbound01t", "outbound02t")
            cur.execute(f"""
                SELECT h.receiptno, d.lineno, h.receptdate, h.customname, d.itemname, d.materialname, d.surfacename,
                       d.thickness, d.width, COALESCE(d.length, 0) AS length, d.qty, d.weight, d.unit, d.unitprice, d.warehousecodename
                FROM {body} d JOIN {head} h ON h.companyid = d.companyid AND h.receiptno = d.receiptno
                WHERE d.companyid = %(companyid)s AND d.itemname ILIKE %(name)s AND {length_sql.format(a='d')}
                  AND (%(months)s = 0 OR h.receptdate >= (CURRENT_DATE - make_interval(months => %(months)s)))
                  {"AND (h.customname ILIKE %(q)s OR h.receiptno ILIKE %(q)s OR d.itemname ILIKE %(q)s OR d.materialname ILIKE %(q)s)" if has_q else ""}
                ORDER BY h.receptdate DESC, h.receiptno DESC, d.lineno LIMIT %(limit)s
            """, params)
            rows = [{"id": f"{r['receiptno']}-{r['lineno']}", "no": r["receiptno"], "date": r["receptdate"], "customer": r["customname"],
                     "itemname": r["itemname"], "steelgrade": r["materialname"], "surface": r["surfacename"],
                     "thickness": _round(r["thickness"]), "width": _round(r["width"]), "length": _round(r["length"]) or None,
                     "qty": _f(r["qty"]), "weight": _f(r["weight"]), "unit": r["unit"], "unitprice": _f(r["unitprice"]),
                     "warehouse": r["warehousecodename"]} for r in cur.fetchall()]
            return {"kind": kind, "material": material, "items": rows}
        cur.execute(f"""
            SELECT h.processno, h.processdate, h.customname, s.lineno, s.itemname, s.materialname, s.thickness, s.width,
                   COALESCE(s.length, 0) AS length, s.qty, s.weight,
                   json_agg(json_build_object('width', p.width, 'length', COALESCE(p.length, 0), 'qty', p.qty, 'weight', p.weight) ORDER BY p.lineno) AS products
            FROM process01t h
            JOIN process02t s ON s.companyid = h.companyid AND s.processno = h.processno AND s.linetype = 'SOURCE'
            JOIN process02t p ON p.companyid = s.companyid AND p.processno = s.processno AND p.linetype = 'PRODUCT' AND p.parentlineno = s.lineno
            WHERE h.companyid = %(companyid)s AND s.itemname ILIKE %(name)s AND {length_sql.format(a='s')}
              AND (%(months)s = 0 OR h.processdate >= (CURRENT_DATE - make_interval(months => %(months)s)))
              {"AND (h.customname ILIKE %(q)s OR h.processno ILIKE %(q)s OR s.itemname ILIKE %(q)s)" if has_q else ""}
            GROUP BY h.processno, h.processdate, h.customname, s.lineno, s.itemname, s.materialname, s.thickness, s.width, s.length, s.qty, s.weight
            ORDER BY h.processdate DESC, h.processno DESC, s.lineno LIMIT %(limit)s
        """, params)
        rows = []
        for r in cur.fetchall():
            src_qty = _f(r["qty"]) or 1.0
            src_weight = _f(r["weight"])
            pattern, product_weight = {}, 0.0
            for p in r["products"] or []:
                width, length, qty = to_number(p.get("width")) or 0, to_number(p.get("length")) or 0, to_number(p.get("qty")) or 0
                product_weight += to_number(p.get("weight")) or 0
                if not width > 0 or not qty > 0:
                    continue
                if material == "COIL":
                    if length > 0:        # 코일을 판으로 자른 가공은 슬리팅 패턴이 아니다
                        continue
                    key = _w(width)
                    pattern[key] = pattern.get(key, 0) + max(1, int(round(qty / src_qty)))   # 원코일 1개당 칼 수
                else:
                    if not length > 0:
                        continue
                    key = (_w(width), _w(length))
                    pattern[key] = pattern.get(key, 0) + max(1, int(round(qty / src_qty)))   # 원판 1매당 매수
            if not pattern:
                continue
            row = {"id": f"{r['processno']}-{r['lineno']}", "no": r["processno"], "date": r["processdate"], "customer": r["customname"],
                   "itemname": r["itemname"], "steelgrade": r["materialname"], "thickness": _round(r["thickness"]),
                   "raw_width": _round(r["width"]), "raw_length": _round(r["length"]) or None,
                   "raw_qty": _f(r["qty"]), "raw_weight": src_weight}
            if material == "COIL":
                row["pattern"] = [[w, n] for w, n in pattern.items()]
                row["knives"] = sum(pattern.values())
                row["mode"] = "MIXED" if len(pattern) > 1 else "SINGLE"
                row["actual_loss"] = _round(max(0.0, src_weight - product_weight), 1) if src_weight else None
                row["actual_yield"] = _round(product_weight / src_weight * 100, 2) if src_weight else None
            else:
                row["pattern"] = [[w, l, n] for (w, l), n in pattern.items()]
            rows.append(row)
        return {"kind": kind, "material": material, "items": rows}
