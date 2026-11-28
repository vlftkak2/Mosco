"""AI 업무비서가 쓰는 조회 도구 (읽기 전용) · 메뉴별 업무 안내.

권한 원칙 (서버가 강제한다 · 모델이 정하지 않는다)
  - 도구마다 필요한 메뉴권한(menus, 하나라도 있으면 됨)을 둔다. 화면 API 와 같은 메뉴다.
  - 사용자에게 권한이 없는 도구는 모델에 아예 보여주지 않고, 실행 직전에 한 번 더 검사한다.
  - 회사는 항상 로그인한 사용자의 companyid. 모델이 회사를 고를 수 있는 인자는 없다.
  - 숫자는 각 화면과 같은 계산 함수 · 같은 조건(_search_conditions 등)을 써서 화면 숫자와 같다.
  - 급여 · 휴가 · 인사(급여등록 · 급여대장 · 내 급여현황 · 휴가현황 · 휴가설정 · 인사기록부 등록)는 권한과 관계없이 도구도 업무 안내도 두지 않는다
    (민감 정보는 AI 로 보내지 않는다 · 모스코 MASTER 도 예외 없음). 다시 열 때는 별도 검토 후 추가한다.
업무 안내(MENU_GUIDES)도 권한이 있는 메뉴 것만 모델에 준다.
"""
from __future__ import annotations

import calendar
import re
from datetime import date, datetime
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo

import db as _shared_db
import security as security_module
from services.ai.AIChatGuides import GUIDES as MENU_GUIDE_DATA   # 메뉴별 업무 안내 (요약 · 상세)

KST = ZoneInfo("Asia/Seoul")
MAX_GROUPS = 30          # 묶음 결과 최대 줄 수 (나머지는 '기타' 합계)
MAX_RANGE_DAYS = 1100    # 기간 조회 상한 (약 3년)


class ToolError(Exception):
    """모델에게 그대로 돌려줄 수 있는 안내 (내부 정보 없음)."""


# ── 공통 ─────────────────────────────────────────────────────────────
def _num(value: Any) -> float | int | None:
    if value is None:
        return None
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(round(value, 4))
    if isinstance(value, float):
        return round(value, 4)
    return value


def to_jsonable(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(k): to_jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_jsonable(v) for v in value]
    if isinstance(value, Decimal):
        return _num(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value


def today_kst() -> date:
    return datetime.now(KST).date()


def _text(value: Any, limit: int = 100) -> str:
    return str(value or "").strip()[:limit]


def _parse_date(value: Any, label: str) -> date:
    text = _text(value, 10)
    try:
        return date.fromisoformat(text)
    except ValueError as error:
        raise ToolError(f"{label}는 YYYY-MM-DD 형식이어야 합니다.") from error


def _period(args: dict) -> tuple[date, date]:
    date_from = _parse_date(args.get("date_from"), "시작일")
    date_to = _parse_date(args.get("date_to"), "종료일")
    if date_from > date_to:
        raise ToolError("시작일이 종료일보다 늦습니다.")
    if (date_to - date_from).days > MAX_RANGE_DAYS:
        raise ToolError("조회 기간은 3년 이내로 지정해 주세요.")
    return date_from, date_to


def _ym(value: Any, label: str) -> str:
    text = _text(value, 7)
    if not re.fullmatch(r"\d{4}-\d{2}", text) or not 1 <= int(text[5:]) <= 12:
        raise ToolError(f"{label}은 YYYY-MM 형식이어야 합니다.")
    return text


def _fold_groups(rows: list[dict], measures: tuple[str, ...]) -> dict:
    """MAX_GROUPS 줄까지 보이고 나머지는 '기타'로 합친다 (합계가 맞게)."""
    shown = rows[:MAX_GROUPS]
    rest = rows[MAX_GROUPS:]
    out = {"group_count": len(rows), "groups": shown}
    if rest:
        out["others"] = {"label": f"기타 {len(rest)}개", **{m: _num(sum((r.get(m) or 0) for r in rest)) for m in measures}}
    return out


# ── 현재고 ───────────────────────────────────────────────────────────
_STOCK_GROUPS = {
    "none": [],
    "item": ["stock.itemname", "stock.materialname"],
    "spec": ["stock.itemname", "stock.materialname", "stock.thickness", "stock.width", "stock.length"],
    "warehouse": ["stock.warehousecodename"],
}
_STOCK_LABELS = {
    "stock.itemname": "itemname", "stock.materialname": "materialname", "stock.thickness": "thickness",
    "stock.width": "width", "stock.length": "length", "stock.warehousecodename": "warehouse",
}


def _stock_summary(user: dict, args: dict) -> dict:
    from services.inventory import CurrentStock as stock_module

    group_by = args.get("group_by") if args.get("group_by") in _STOCK_GROUPS else "none"
    with _shared_db.connect() as connection, connection.cursor() as cursor:
        source_lines = stock_module._uses_source_lines(cursor)
        where, params = stock_module._current_stock_conditions(
            user["companyid"], itemcode="", itemname="", thickness=_text(args.get("thickness"), 30),
            width=_text(args.get("width"), 30), length=_text(args.get("length"), 30),
            warehousecode="", warehousecodename="", source_lines=source_lines,
            item_search=_text(args.get("item_search"), 150), warehouse_search=_text(args.get("warehouse_search"), 100),
        )
        amount_sql = "COALESCE(SUM(stock.costamt), 0)" if source_lines else "NULL::numeric"
        columns = _STOCK_GROUPS[group_by]
        select_cols = "".join(f"{c} AS {_STOCK_LABELS[c]}, " for c in columns)
        group_sql = f"GROUP BY {', '.join(columns)}" if columns else ""
        cursor.execute(
            f"""SELECT {select_cols} COUNT(*) AS lot_count, COALESCE(SUM(stock.qty), 0) AS qty,
                       COALESCE(SUM(stock.weight), 0) AS weight, {amount_sql} AS stock_amount
                  FROM CurrentStock01t AS stock WHERE {where} {group_sql}
                 ORDER BY weight DESC""",
            params,
        )
        names = [c[0] for c in cursor.description]
        rows = [{k: _num(v) for k, v in zip(names, row)} for row in cursor.fetchall()]
    measures = ("lot_count", "qty", "weight", "stock_amount")
    totals = {m: _num(sum((r.get(m) or 0) for r in rows)) for m in measures}
    result = {"as_of": today_kst().isoformat(), "unit_note": "weight 는 kg, stock_amount 는 재고금액(원가, 원)", "totals": totals}
    if columns:
        result.update(_fold_groups(rows, measures))
    return result


# ── 매입 · 매출 현황 ──────────────────────────────────────────────────
_TRADE_GROUPS = {
    "none": None,
    "customer": ("r.customname", "customer"),
    "month": ("TO_CHAR(r.receptdate, 'YYYY-MM')", "month"),
    "item": ("COALESCE(r.itemname, '') || CASE WHEN r.materialname IS NULL THEN '' ELSE ' ' || r.materialname END", "item"),
    "warehouse": ("r.warehousecodename", "warehouse"),
}


def _trade_summary(kind: str, user: dict, args: dict) -> dict:
    date_from, date_to = _period(args)
    group_by = args.get("group_by") if args.get("group_by") in _TRADE_GROUPS else "none"
    customer = _text(args.get("customer"), 150)
    iteminfo = _text(args.get("item_search"), 150)
    warehouse = _text(args.get("warehouse"), 100)
    if kind == "inbound":
        from services.inbound import InboundSearch as search_module
        from services.inbound import InboundRegister as register_module

        rows_sql = search_module._rows_sql(False, False)
        where_sql, params = search_module._search_conditions(
            user["companyid"], date_from, date_to, "", customer, warehouse, "", "", "", "", iteminfo,
        )
        # 매입현황 요약과 같은 합계: 수량 · 중량(톤 단위는 kg 환산) · 합계금액(unitamt)
        measures_sql = ("COUNT(DISTINCT r.receiptno) AS receipt_count, COALESCE(SUM(r.qty), 0) AS qty, "
                        "COALESCE(SUM(r.weight), 0) AS weight, COALESCE(SUM(r.supplyamt), 0) AS supply_amount, "
                        "COALESCE(SUM(r.unitamt), 0) AS total_amount")
        measures = ("receipt_count", "qty", "weight", "supply_amount", "total_amount")
        connect = register_module._connect
        note = "매입현황(INBOUND_SEARCH)과 같은 기준. 매입 상세 + 매입 기타비용. total_amount = 합계금액(공급가+부가세), supply_amount = 공급가, weight 는 kg"
    else:
        from services.outbound import OutboundSearch as search_module
        from services.outbound import OutboundRegister as register_module

        rows_sql = search_module._ROWS_SQL
        where_sql, params = search_module._search_conditions(
            user["companyid"], date_from, date_to, "", "", "", "", "", customer, warehouse, iteminfo,
        )
        # 매출현황 요약과 같은 합계: 중량 = 총중량, 합계금액 = 매출 + 기타비용 '아니오', 비용(-) = 기타비용 '예'
        measures_sql = ("COUNT(DISTINCT r.receiptno) AS receipt_count, COALESCE(SUM(r.qty), 0) AS qty, "
                        "COALESCE(SUM(r.totalweight), 0) AS weight, COALESCE(SUM(r.supplyamt), 0) AS supply_amount, "
                        "COALESCE(SUM(r.unitamt), 0) AS total_amount, COALESCE(SUM(r.costamt), 0) AS cost_amount")
        measures = ("receipt_count", "qty", "weight", "supply_amount", "total_amount", "cost_amount")
        connect = register_module._connect
        note = ("매출현황(OUTBOUND_SEARCH)과 같은 기준. total_amount = 매출 합계금액(공급가+부가세, 기타비용 '아니오' 포함), "
                "supply_amount = 공급가, cost_amount = 비용(-)(기타비용 '예'), weight 는 kg")

    group = _TRADE_GROUPS[group_by]
    with connect() as connection, connection.cursor() as cursor:
        cursor.execute(f"SELECT {measures_sql} FROM ({rows_sql}) AS r WHERE {where_sql}", params)
        names = [c[0] for c in cursor.description]
        totals = {k: _num(v) for k, v in zip(names, cursor.fetchone())}
        groups = []
        if group:
            expr, label = group
            order = f"{label}" if group_by == "month" else "total_amount DESC"
            cursor.execute(
                f"""SELECT {expr} AS {label}, {measures_sql}
                      FROM ({rows_sql}) AS r WHERE {where_sql}
                     GROUP BY 1 ORDER BY {order}""",
                params,
            )
            names = [c[0] for c in cursor.description]
            groups = [{k: _num(v) for k, v in zip(names, row)} for row in cursor.fetchall()]
    result = {"period": {"date_from": date_from.isoformat(), "date_to": date_to.isoformat()},
              "filters": {"customer": customer, "item_search": iteminfo, "warehouse": warehouse},
              "note": note, "totals": totals}
    if group:
        # 월별은 순서가 중요하므로 자르지 않는다 (최대 37개월)
        result.update({"group_count": len(groups), "groups": groups} if group_by == "month" else _fold_groups(groups, measures))
    return result


# ── 매출이익 ─────────────────────────────────────────────────────────
def _gross_profit(user: dict, args: dict) -> dict:
    from services.outbound import GrossProfitDashboard as dashboard_module

    date_from, date_to = _period(args)
    if (date_to - date_from).days > 366:
        raise ToolError("매출이익 조회 기간은 1년 이내로 지정해 주세요.")
    data = dashboard_module.dashboard(user["companyid"], date_from, date_to, None)
    keep = ("sales", "cost", "profit", "margin_rate", "weight", "sales_per_ton", "profit_per_ton")
    pick = lambda row: {k: _num(row.get(k)) for k in keep if k in row}  # noqa: E731
    customer = _text(args.get("customer"), 100)
    customers = [
        {"customcode": r.get("customcode"), "customname": r.get("customname"), **pick(r),
         "prev_sales": _num(r.get("prev_sales")), "prev_profit": _num(r.get("prev_profit")), "share": _num(r.get("share"))}
        for r in data.get("customers") or []
        if not customer or customer in str(r.get("customname") or "") or customer == str(r.get("customcode") or "")
    ]
    total = data.get("total") or {}
    return {
        "period": to_jsonable(data.get("period")),
        "note": "매출이익 현황과 같은 계산. 공급가(부가세 제외) 기준. 매출 = 매출금액+매출비용(+), 비용 = 매입원가+판매비용, "
                "순이익(profit) = 매출 − 비용, margin_rate(%) = 순이익 ÷ 매출 × 100, weight 는 kg, *_per_ton 은 원/톤",
        "total": {**pick(total), "customer_count": total.get("customer_count"),
                  "loss_customer_count": total.get("loss_customer_count"), "loss_amount": _num(total.get("loss_amount"))},
        "prev_total": pick(data.get("prev_total") or {}),
        "yoy_total": pick(data.get("yoy_total") or {}),
        "customer_filter": customer,
        "customers": customers[:MAX_GROUPS],
        "customer_count": len(customers),
        "trend_12_months": [{"month": r.get("month"), **pick(r), "ly_sales": _num(r.get("ly_sales")),
                             "ly_profit": _num(r.get("ly_profit"))} for r in data.get("trend") or []],
    }


# ── 채권 · 채무 ──────────────────────────────────────────────────────
def _receivable_payable(user: dict, args: dict) -> dict:
    from services.receiptpayment import CustomerLedger as ledger_module

    as_of = _parse_date(args["as_of"], "기준일") if args.get("as_of") else today_kst()
    with_vat = bool(args.get("with_vat"))
    data = ledger_module.dashboard(user["companyid"], as_of, with_vat=with_vat, date_from=None, ckey=None)
    data = to_jsonable(data)
    trim = lambda rows, n=15: (rows or [])[:n]  # noqa: E731
    return {
        "as_of": data.get("as_of"),
        "note": ("채권채무 현황과 같은 계산. 금액 기준 = " + ("합계금액(공급가+부가세)" if with_vat else "공급가(부가세 제외)")
                 + ". receivable = 받을 돈(미수금), payable = 줄 돈(미지급금)"),
        "summary": data.get("summary"),
        "top_receivable": trim(data.get("top_receivable")),
        "top_payable": trim(data.get("top_payable")),
        "aging": [{k: v for k, v in (row or {}).items() if k in ("label", "amount", "customer_count")}
                  for row in data.get("aging") or []],
        "overdue": trim(data.get("overdue")),
        "trend": data.get("trend"),
    }


# ── 공통: 목록 · 전표를 모델에 줄 크기로 ──────────────────────────────
_DROP_KEYS = {"companyid", "companyname", "created_at", "updated_at", "createdat", "updatedat", "updated_by",
              "stocksourcetype", "stocksourceno", "stocksourceline", "source_lineno", "subulyn", "edit_lock",
              "min_receptdate", "header_created_at", "header_updated_at"}
MAX_LIST_ROWS = 30
MAX_DOC_LINES = 50


def _slim(row: dict, drop: set[str] = frozenset()) -> dict:
    """빈 값 · 내부 칸을 빼고 JSON 으로 (모델 입력을 줄인다)."""
    out = {}
    for key, value in (row or {}).items():
        if key in _DROP_KEYS or key in drop or value is None or value == "":
            continue
        if isinstance(value, (list, dict)):
            continue
        out[key] = to_jsonable(value)
    return out


def _optional_period(args: dict) -> tuple[date | None, date | None]:
    if not args.get("date_from") and not args.get("date_to"):
        return None, None
    if not args.get("date_from") or not args.get("date_to"):
        raise ToolError("시작일과 종료일을 함께 지정해 주세요.")
    return _period(args)


# ── 수금 · 지급 ─────────────────────────────────────────────────────
_RP_TYPES = {"RECEIPT": "수금", "PAYMENT": "지급"}
_RP_MEASURES = ("totalamt", "settleamt", "ledgeramt", "cashamt", "instrumentamt", "bankamt", "cardamt", "offsetamt")


def _receipt_payment_summary(user: dict, args: dict) -> dict:
    from services.receiptpayment import ReceiptPayment as rp_module

    date_from, date_to = _period(args)
    customer = _text(args.get("customer"), 150)
    kind = args.get("transactiontype") if args.get("transactiontype") in _RP_TYPES else ""
    group_by = args.get("group_by") if args.get("group_by") in {"none", "customer", "month"} else "none"
    # 수금/지급 현황 화면과 같은 함수로 전표를 모두 읽어 묶는다 (전표 5,000장까지)
    docs, summary, page = [], None, 1
    while True:
        data = rp_module.list_documents(user["companyid"], page, 200, date_from, date_to, "", customer, kind)
        summary = summary or data.get("summary")
        docs.extend(data.get("documents") or [])
        if len(docs) >= int(data.get("total") or 0) or not data.get("documents"):
            break
        if len(docs) >= 5000:
            raise ToolError("전표가 너무 많습니다. 기간이나 거래처를 좁혀 주세요.")
        page += 1
    result = {
        "period": {"date_from": date_from.isoformat(), "date_to": date_to.isoformat()},
        "filters": {"customer": customer, "transactiontype": _RP_TYPES.get(kind, "전체")},
        "note": ("수금지급 현황과 같은 기준 (원). totalamt = 자금 합계(현금+수표·어음+은행+카드), settleamt = 상계 · 잡손실 · 잡이익, "
                 "ledgeramt = 전표 합계(= totalamt + settleamt, 채권채무 현황에서 미수/미지급을 줄이는 금액)"),
        "summary": to_jsonable(summary),
        "document_count": len(docs),
    }
    if group_by != "none":
        groups: dict[tuple, dict] = {}
        for doc in docs:
            label = doc.get("customname") if group_by == "customer" else str(doc.get("receiptdate"))[:7]
            key = (label, doc.get("transactiontype"))
            row = groups.setdefault(key, {group_by: label, "type": _RP_TYPES.get(doc.get("transactiontype"), ""), "documents": 0,
                                          **{m: 0 for m in _RP_MEASURES}})
            row["documents"] += 1
            for m in _RP_MEASURES:
                row[m] += float(doc.get(m) or 0)
        rows = [{k: _num(v) if isinstance(v, float) else v for k, v in r.items()} for r in groups.values()]
        if group_by == "month":
            rows.sort(key=lambda r: (r["month"], r["type"]))
            result.update({"group_count": len(rows), "groups": rows})
        else:
            rows.sort(key=lambda r: -(r["ledgeramt"] or 0))
            result.update(_fold_groups(rows, ("documents",) + _RP_MEASURES))
    result["recent_documents"] = [
        {**_slim(doc, {"description", "created_by", "line_count"}), "type": _RP_TYPES.get(doc.get("transactiontype"), "")}
        for doc in sorted(docs, key=lambda d: (str(d.get("receiptdate")), d.get("receiptno")), reverse=True)[:10]
    ]
    return result


# ── 재고수불 (입고 · 출고 · 가공 · 이동) ───────────────────────────────
_INIO_GROUPS = {
    "none": None,
    "item": ("COALESCE(i.itemname, '') || CASE WHEN i.materialname IS NULL THEN '' ELSE ' ' || i.materialname END", "item"),
    "month": ("TO_CHAR(i.iniodate, 'YYYY-MM')", "month"),
    "warehouse": ("i.warehousecodename", "warehouse"),
    "customer": ("i.customname", "customer"),
}


def _stock_movement(user: dict, args: dict) -> dict:
    from services.inventory import IniopStock as iniop_module

    date_from, date_to = _period(args)
    group_by = args.get("group_by") if args.get("group_by") in _INIO_GROUPS else "none"
    where, params = iniop_module._conditions(
        user["companyid"], date_from, date_to, "", "", "", "", "", "", _text(args.get("thickness"), 30),
        _text(args.get("width"), 30), _text(args.get("length"), 30), "", "",
        item_search=_text(args.get("item_search"), 150), warehouse_search=_text(args.get("warehouse_search"), 100),
    )
    group = _INIO_GROUPS[group_by]
    select = f"{group[0]} AS {group[1]}, " if group else ""
    group_sql = "GROUP BY 1, i.iniokind" if group else "GROUP BY i.iniokind"
    with _shared_db.connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            f"""SELECT {select} i.iniokind, COUNT(*) AS lines, COALESCE(SUM(i.qty), 0) AS qty,
                       COALESCE(SUM(i.weight), 0) AS weight, COALESCE(SUM(i.costamt), 0) AS costamt
                  FROM Iniop01t AS i WHERE {where} {group_sql}""",
            params,
        )
        names = [c[0] for c in cursor.description]
        raw = [dict(zip(names, row)) for row in cursor.fetchall()]
    kinds = iniop_module.KIND_NAMES
    by_kind: dict[str, dict] = {}
    for row in raw:
        k = by_kind.setdefault(row["iniokind"], {"kind": kinds.get(row["iniokind"], row["iniokind"]), "lines": 0, "qty": 0, "weight": 0, "costamt": 0})
        for m in ("lines", "qty", "weight", "costamt"):
            k[m] += row[m] or 0
    result = {
        "period": {"date_from": date_from.isoformat(), "date_to": date_to.isoformat()},
        "note": "재고수불 현황과 같은 자료(Iniop01t). 기초 · 매입입고 · 가공입고 · 이동입고는 들어온 것, 매출출고 · 가공투입 · 이동출고는 나간 것. "
                "weight 는 kg, costamt 는 원가(원)",
        "by_kind": [{key: _num(v) if not isinstance(v, str) else v for key, v in row.items()} for row in by_kind.values()],
    }
    if group:
        label = group[1]
        merged: dict[str, dict] = {}
        for row in raw:
            g = merged.setdefault(row[label] or "", {label: row[label] or "", "in_weight": 0, "out_weight": 0, "in_qty": 0, "out_qty": 0})
            direction = "out" if row["iniokind"] in {"OUT", "PROCESS_OUT", "MOVE_OUT"} else "in"
            g[f"{direction}_weight"] += row["weight"] or 0
            g[f"{direction}_qty"] += row["qty"] or 0
        rows = [{k: _num(v) if not isinstance(v, str) else v for k, v in r.items()} for r in merged.values()]
        if group_by == "month":
            rows.sort(key=lambda r: r["month"])
            result.update({"group_count": len(rows), "groups": rows})
        else:
            rows.sort(key=lambda r: -((r["in_weight"] or 0) + (r["out_weight"] or 0)))
            result.update(_fold_groups(rows, ("in_weight", "out_weight", "in_qty", "out_qty")))
    return result


# ── 재고이동 ─────────────────────────────────────────────────────────
def _transfer_summary(user: dict, args: dict) -> dict:
    from services.inoutmove import inoutmoveSearch as move_module

    date_from, date_to = _period(args)
    filters = dict(fromwarehouse=_text(args.get("from_warehouse"), 100), towarehouse=_text(args.get("to_warehouse"), 100),
                   iteminfo=_text(args.get("item_search"), 150))
    details = move_module.list_transfer_details(user["companyid"], 1, 1, date_from, date_to, **filters)
    docs = move_module.list_transfer_documents(user["companyid"], 1, MAX_LIST_ROWS, date_from, date_to, **filters)
    return {
        "period": {"date_from": date_from.isoformat(), "date_to": date_to.isoformat()},
        "note": "재고이동 현황과 같은 자료. weight 는 kg",
        "summary": to_jsonable(details.get("summary")),
        "document_count": docs.get("total"),
        "documents": [_slim(d, {"fromwarehousecode", "towarehousecode", "description"}) for d in docs.get("items") or []],
    }


# ── 전표 검색 · 상세 (종류마다 그 메뉴 권한) ─────────────────────────────
DOC_KINDS = {
    "inbound": ("매입", ("INBOUND_SEARCH", "INBOUND_REGISTER")),
    "outbound": ("매출", ("OUTBOUND_SEARCH", "OUTBOUND_REGISTER")),
    "receipt_payment": ("수금/지급", ("RECEIPT_PAYMENT_SEARCH", "RECEIPT_PAYMENT")),
    "transfer": ("재고이동", ("INOUTMOVE_SEARCH", "INOUTMOVE_REGISTER")),
    "process": ("재고가공", ("ITEM_PROCESS_SEARCH", "ITEM_PROCESS_REGISTER")),
}
_DOC_MENUS = tuple(m for _, menus in DOC_KINDS.values() for m in menus)


def doc_kinds_for(user: dict) -> list[str]:
    return [kind for kind, (_, menus) in DOC_KINDS.items() if allowed(user, menus)]


def _doc_kind(user: dict, args: dict) -> str:
    kind = args.get("kind")
    if kind not in DOC_KINDS:
        raise ToolError("전표 종류를 확인해 주세요.")
    if not allowed(user, DOC_KINDS[kind][1]):
        raise ToolError(f"{DOC_KINDS[kind][0]} 메뉴 권한이 없어 조회할 수 없습니다.")
    return kind


def _trade_documents(kind: str, user: dict, date_from, date_to, customer: str, keyword: str) -> dict:
    """매입 · 매출: 현황 화면과 같은 행(_rows_sql)을 전표번호로 묶는다."""
    if kind == "inbound":
        from services.inbound import InboundSearch as search_module
        from services.inbound import InboundRegister as register_module
        rows_sql = search_module._rows_sql(False, False)
        where_sql, params = search_module._search_conditions(
            user["companyid"], date_from, date_to, keyword if keyword.upper().startswith("IN") else "", customer, "", "", "", "", "",
            "" if keyword.upper().startswith("IN") else keyword)
        weight = "r.weight"
    else:
        from services.outbound import OutboundSearch as search_module
        from services.outbound import OutboundRegister as register_module
        rows_sql = search_module._ROWS_SQL
        where_sql, params = search_module._search_conditions(
            user["companyid"], date_from, date_to, keyword if keyword.upper().startswith("OUT") else "", "", "", "", "", customer, "",
            "" if keyword.upper().startswith("OUT") else keyword)
        weight = "r.totalweight"
    with register_module._connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            f"""SELECT r.receiptno, MIN(r.receptdate) AS date, MAX(r.customname) AS customer, COUNT(*) AS lines,
                       COALESCE(SUM(r.qty), 0) AS qty, COALESCE(SUM({weight}), 0) AS weight,
                       COALESCE(SUM(r.supplyamt), 0) AS supply_amount, COALESCE(SUM(r.unitamt), 0) AS total_amount,
                       COUNT(*) OVER () AS document_count
                  FROM ({rows_sql}) AS r WHERE {where_sql}
                 GROUP BY r.receiptno ORDER BY date DESC, r.receiptno DESC LIMIT %s""",
            (*params, MAX_LIST_ROWS),
        )
        names = [c[0] for c in cursor.description]
        rows = [dict(zip(names, row)) for row in cursor.fetchall()]
    count = rows[0]["document_count"] if rows else 0
    return {"document_count": count, "documents": [_slim({k: v for k, v in r.items() if k != "document_count"}) for r in rows]}


def _document_search(user: dict, args: dict) -> dict:
    kind = _doc_kind(user, args)
    date_from, date_to = _optional_period(args)
    if date_from is None:
        date_to = today_kst()
        date_from = date_to.replace(day=1) if not args.get("keyword") else date(date_to.year - 3, 1, 1)
    customer, keyword = _text(args.get("customer"), 150), _text(args.get("keyword"), 100)
    if kind in {"inbound", "outbound"}:
        data = _trade_documents(kind, user, date_from, date_to, customer, keyword)
    elif kind == "receipt_payment":
        from services.receiptpayment import ReceiptPayment as rp_module
        raw = rp_module.list_documents(user["companyid"], 1, MAX_LIST_ROWS, date_from, date_to, keyword, customer, "")
        data = {"document_count": raw.get("total"),
                "documents": [{**_slim(d, {"description", "line_count"}), "type": _RP_TYPES.get(d.get("transactiontype"), "")}
                              for d in raw.get("documents") or []]}
    elif kind == "transfer":
        from services.inoutmove import inoutmoveSearch as move_module
        raw = move_module.list_transfer_documents(user["companyid"], 1, MAX_LIST_ROWS, date_from, date_to,
                                                  receiptno=keyword, iteminfo="" if keyword.upper().startswith("MV") else "")
        data = {"document_count": raw.get("total"), "documents": [_slim(d, {"fromwarehousecode", "towarehousecode"}) for d in raw.get("items") or []]}
    else:
        from services.process import ItemProcess as process_module
        raw = process_module.list_documents(user["companyid"], 1, MAX_LIST_ROWS, date_from, date_to, keyword, customer)
        data = {"document_count": raw.get("total"), "documents": [_slim(d) for d in raw.get("items") or []]}
    return {"kind": DOC_KINDS[kind][0], "period": {"date_from": date_from.isoformat(), "date_to": date_to.isoformat()},
            "filters": {"customer": customer, "keyword": keyword},
            "note": f"최근 순 최대 {MAX_LIST_ROWS}건. 전표 한 장의 품목은 document_detail 로 본다. weight 는 kg, 금액은 원", **data}


def _document_detail(user: dict, args: dict) -> dict:
    kind = _doc_kind(user, args)
    receiptno = _text(args.get("receiptno"), 100)
    if not receiptno:
        raise ToolError("전표번호를 알려 주세요.")
    companyid = user["companyid"]
    if kind == "inbound":
        from services.inbound import InboundRegister as module
        doc = module.get_receipt(companyid, receiptno)
    elif kind == "outbound":
        from services.outbound import OutboundRegister as module
        doc = module.get_receipt(companyid, receiptno)
    elif kind == "receipt_payment":
        from services.receiptpayment import ReceiptPayment as module
        doc = module.get_document(companyid, receiptno)
    elif kind == "transfer":
        from services.inoutmove import inoutmoveSearch as module
        doc = module.get_transfer_document(companyid, receiptno)
    else:
        from services.process import ItemProcessRegister as module
        doc = module.get_document(companyid, receiptno)
    if not doc:
        return {"error": f"{DOC_KINDS[kind][0]} 전표 {receiptno} 를 찾을 수 없습니다."}
    if kind == "process":
        # 가공: 헤더 + 원소재(source)마다 만든 가공품(products)
        drop = {"levelno", "parentlineno", "sourcelineno", "processid", "can_edit", "planno", "created_by"}
        lines = []
        for group in doc.get("sources") or []:
            source = group.get("source") or {}
            lines.append({**_slim(source, drop), "role": "원소재(투입)"})
            lines.extend({**_slim(product, drop), "role": "가공품"} for product in group.get("products") or [])
        out = {"kind": DOC_KINDS[kind][0], "header": _slim(doc.get("header") or {}, {"can_edit"}),
               "lines": lines[:MAX_DOC_LINES], "note": "재고가공 화면과 같은 자료. 원소재 아래 줄이 그 원소재로 만든 가공품. weight 는 kg, 금액은 원"}
        if len(lines) > MAX_DOC_LINES:
            out["lines_more"] = len(lines) - MAX_DOC_LINES
        return out
    out = {"kind": DOC_KINDS[kind][0], "header": _slim(doc, {"items", "expenses"})}
    for key in ("items", "expenses", "lines", "details", "products", "materials"):
        rows = doc.get(key)
        if isinstance(rows, list) and rows:
            out[key] = [_slim(r, {"receiptno", "processno", "receptdate", "customcode", "customname", "current_qty", "current_weight"})
                        for r in rows[:MAX_DOC_LINES]]
            if len(rows) > MAX_DOC_LINES:
                out[f"{key}_more"] = len(rows) - MAX_DOC_LINES
    out["note"] = "전표 화면과 같은 자료. weight 는 kg, 금액은 원"
    return out


# ── 수표 · 어음 ─────────────────────────────────────────────────────
_INSTRUMENT_KIND_LABELS = {"RECEIVABLE": "받을어음(보유)", "PAYABLE": "지급어음(발행)", "ENDORSED_OUT": "배서양도", "RETURNED_OWN": "회수된 자수어음",
                           "UNSPECIFIED": "미지정"}


def _instrument_summary(user: dict, args: dict) -> dict:
    from services.receiptpayment import InstrumentStatus as instrument_module

    kind = args.get("kind") if args.get("kind") in {"RECEIVABLE", "PAYABLE"} else ""
    maturity_from = _parse_date(args["maturity_from"], "만기 시작일") if args.get("maturity_from") else None
    maturity_to = _parse_date(args["maturity_to"], "만기 종료일") if args.get("maturity_to") else None
    status = "ALL" if args.get("include_closed") else "OPEN"
    data = instrument_module.list_instruments(user["companyid"], 1, MAX_LIST_ROWS, kind=kind, status=status,
                                              maturity_from=maturity_from, maturity_to=maturity_to,
                                              customer=_text(args.get("customer"), 150))
    summary = data.get("summary") or {}
    cards = {key: _slim(summary.get(key) or {}) for key in ("held_receivable", "unpaid_payable", "due_30", "dishonored")}
    return {
        "as_of": today_kst().isoformat(),
        "note": ("어음수표 관리와 같은 자료 (원). held_receivable = 보유 중인 받을어음, unpaid_payable = 결제 전 지급어음, "
                 "due_30 = 30일 안 만기, dishonored = 부도. 목록은 만기 가까운 순"),
        "filters": {"kind": _INSTRUMENT_KIND_LABELS.get(kind, "전체"), "open_only": status == "OPEN"},
        "cards": cards,
        "maturity_buckets": to_jsonable(data.get("aging")),
        "count": data.get("total"), "total_amount": _num(data.get("total_amount")),
        "items": [{**_slim(r, {"custodyaccount", "custodybank", "description", "lineno", "processmemo"}),
                   "kind": _INSTRUMENT_KIND_LABELS.get(r.get("kind"), r.get("kind"))} for r in data.get("items") or []],
    }


# ── 재고가공 · 가공주문 ───────────────────────────────────────────────
def _process_summary(user: dict, args: dict) -> dict:
    from services.process import ItemProcess as process_module

    date_from, date_to = _period(args)
    data = process_module.list_documents(user["companyid"], 1, MAX_LIST_ROWS, date_from, date_to, "",
                                         _text(args.get("customer"), 150), _text(args.get("warehouse"), 100),
                                         _text(args.get("item_search"), 150))
    return {
        "period": {"date_from": date_from.isoformat(), "date_to": date_to.isoformat()},
        "note": "재고가공 현황과 같은 자료. 금액 = 가공금액(원), weight 는 kg. 목록은 최근 순 최대 30건",
        "summary": to_jsonable(data.get("summary")), "document_count": data.get("total"),
        "documents": [_slim(d, {"description"}) for d in data.get("items") or []],
    }


_PROGRESS_LABELS = {"NONE": "미전송", "PARTIAL": "일부 전송", "SENT": "최적화 전송", "DONE": "가공완료"}


def _ai_order_status(user: dict, args: dict) -> dict:
    from services.ai import AIOrderManage as order_module

    date_from, date_to = _optional_period(args)
    progress = args.get("progress") if args.get("progress") in _PROGRESS_LABELS else None
    buyer = _text(args.get("buyer"), 100) or None
    common = dict(start_date=date_from, end_date=date_to, buyer=buyer)
    counts = {label: int(order_module.list_orders(user["companyid"], page=1, page_size=1, progress=key, **common).get("total") or 0)
              for key, label in _PROGRESS_LABELS.items()}
    data = order_module.list_orders(user["companyid"], page=1, page_size=MAX_LIST_ROWS, progress=progress, **common)
    return {
        "period": {"date_from": date_from.isoformat() if date_from else None, "date_to": date_to.isoformat() if date_to else None},
        "note": "주문서 통합관리와 같은 자료. 진행 = 품목들의 최적화 전송 · 가공완료 상태. total_weight 는 kg. 목록은 최근 순 최대 30건",
        "count_by_progress": counts,
        "filter_progress": _PROGRESS_LABELS.get(progress, "전체"),
        "orders": [{**_slim(o, {"useremail", "created_by", "updated_by", "manual"}), "progress": _PROGRESS_LABELS.get(o.get("progress"), o.get("progress"))}
                   for o in data.get("items") or []],
    }


# ── 월마감 · 승인 대기 ──────────────────────────────────────────────
def _month_close_status(user: dict, args: dict) -> dict:
    from services.closing import MonthClose as close_module

    year = args.get("year") or today_kst().year
    if not isinstance(year, int) or not 2000 <= year <= 2100:
        raise ToolError("연도를 확인해 주세요.")
    data = close_module.list_months(user["companyid"], year)
    return {
        "year": year,
        "note": "월마감관리와 같은 자료. closed_through = 이 날짜까지 전표를 고칠 수 없음, next_closable = 다음에 마감할 수 있는 달, "
                "counts = 그달 전표 수(종류별)",
        "last_closed": data.get("last_closed"), "closed_through": to_jsonable(data.get("closed_through")),
        "next_closable": data.get("next_closable"),
        "months": [{"month": m.get("month"), "closed": m.get("closed"), "closed_at": to_jsonable(m.get("closed_at")),
                    "closed_by": m.get("closed_by"), "documents": m.get("total"), "counts": to_jsonable(m.get("counts"))}
                   for m in data.get("months") or []],
    }


def _approval_status(user: dict, args: dict) -> dict:
    from services.control import Approval as approval_module

    data = approval_module.summary(user)
    return {
        "note": "통제관리 승인 현황 (헤더 알림과 같은 자료). 승인자 · 관리자는 대기 중인 요청, 그 밖에는 내 최근 요청. 금액은 원",
        "control_on": data.get("active"), "can_manage": data.get("can_manage"), "is_approver": data.get("is_approver"),
        "pending": data.get("pending"), "my_pending": data.get("my_pending"), "my_rejected_7days": data.get("my_rejected"),
        "items": [{key: to_jsonable(item.get(key)) for key in ("requestno", "target_label", "action_label", "status_label", "party",
                                                               "doc_date", "summary", "amount", "requested_name", "requested_at",
                                                               "decided_name", "reject_reason") if item.get(key) not in (None, "")}
                  for item in data.get("items") or []],
    }


# ── 메뉴별 업무 안내 (AIChatGuides: 요약은 늘 · 상세는 menu_guide 로 · 권한 있는 메뉴만) ─────

# 같은 안내를 다른 메뉴권한으로도 볼 수 있는 경우 (예: 급여대장 = 급여등록 권한) — 지금은 없음
MENU_GUIDES: dict[str, tuple[str, str]] = {menuid: (g["label"], g["summary"]) for menuid, g in MENU_GUIDE_DATA.items()}


def guides_for(user: dict) -> list[tuple[str, str]]:
    """질문마다 AI 에게 주는 요약 (권한 있는 메뉴만)."""
    return [guide for menuid, guide in MENU_GUIDES.items() if security_module.has_menu(user, menuid)]


def guide_labels_for(user: dict) -> list[str]:
    return [g["label"] for menuid, g in MENU_GUIDE_DATA.items() if security_module.has_menu(user, menuid)]


def _menu_guide(user: dict, args: dict) -> dict:
    """메뉴 사용 방법 · 규칙 상세 (권한 있는 메뉴만 · 여러 개 한 번에)."""
    wanted = [str(x).strip() for x in (args.get("menus") or []) if str(x).strip()][:4]
    if not wanted:
        raise ToolError("볼 메뉴 이름을 알려 주세요.")
    by_label = {g["label"]: (menuid, g) for menuid, g in MENU_GUIDE_DATA.items()}
    out, denied, unknown = [], [], []
    for label in wanted:
        hit = by_label.get(label)
        if hit is None:
            unknown.append(label)
        elif not security_module.has_menu(user, hit[0]):
            denied.append(label)
        else:
            out.append({"menu": label, "guide": hit[1]["detail"]})
    result = {"guides": out, "note": "현재 화면 동작 기준 안내. 여기 없는 내용은 모른다고 답한다."}
    if denied:
        result["no_permission"] = denied
    if unknown:
        result["unknown"] = unknown
    return result


# ── 도구 목록 ────────────────────────────────────────────────────────
def _nullable(kind: str, description: str, **extra) -> dict:
    return {"type": [kind, "null"], "description": description, **extra}


_PERIOD_PROPS = {
    "date_from": {"type": "string", "description": "시작일 YYYY-MM-DD"},
    "date_to": {"type": "string", "description": "종료일 YYYY-MM-DD"},
}


def _schema(props: dict) -> dict:
    return {"type": "object", "properties": props, "required": list(props), "additionalProperties": False}


TOOLS: list[dict] = [
    {
        "name": "stock_summary",
        "menus": ("STOCK_CURRENT",),
        "label": "현재고현황",
        "description": "현재고(지금 남은 재고) 합계와 품명 · 규격 · 창고별 묶음. 중량 kg, 재고금액은 원가.",
        "parameters": _schema({
            "item_search": _nullable("string", "품목코드 · 품명 · 규격 일부 (예: SUS304)"),
            "warehouse_search": _nullable("string", "창고코드 또는 창고명 일부"),
            "thickness": _nullable("string", "두께 일부 (예: 1.2)"),
            "width": _nullable("string", "폭 일부"),
            "length": _nullable("string", "길이 일부"),
            "group_by": {"type": "string", "enum": ["none", "item", "spec", "warehouse"], "description": "묶는 기준"},
        }),
        "run": _stock_summary,
    },
    {
        "name": "inbound_summary",
        "menus": ("INBOUND_SEARCH",),
        "label": "매입현황",
        "description": "기간 매입(입고) 합계와 매입처 · 월 · 품목 · 창고별 묶음.",
        "parameters": _schema({
            **_PERIOD_PROPS,
            "customer": _nullable("string", "매입처 코드 또는 이름 일부"),
            "item_search": _nullable("string", "품목코드 또는 품명 일부"),
            "warehouse": _nullable("string", "창고코드 또는 창고명 일부"),
            "group_by": {"type": "string", "enum": ["none", "customer", "month", "item", "warehouse"], "description": "묶는 기준"},
        }),
        "run": lambda user, args: _trade_summary("inbound", user, args),
    },
    {
        "name": "outbound_summary",
        "menus": ("OUTBOUND_SEARCH",),
        "label": "매출현황",
        "description": "기간 매출(출고) 합계와 매출처 · 월 · 품목 · 창고별 묶음.",
        "parameters": _schema({
            **_PERIOD_PROPS,
            "customer": _nullable("string", "매출처 코드 또는 이름 일부"),
            "item_search": _nullable("string", "품목코드 또는 품명 일부"),
            "warehouse": _nullable("string", "창고코드 또는 창고명 일부"),
            "group_by": {"type": "string", "enum": ["none", "customer", "month", "item", "warehouse"], "description": "묶는 기준"},
        }),
        "run": lambda user, args: _trade_summary("outbound", user, args),
    },
    {
        "name": "gross_profit_summary",
        "menus": ("GROSS_PROFIT_DASHBOARD", "GROSS_PROFIT"),
        "label": "매출이익",
        "description": "기간 매출 · 비용 · 순이익 · 마진율, 전월 · 전년 동월 비교, 거래처별 이익, 최근 12개월 추이. 기간 1년 이내.",
        "parameters": _schema({
            **_PERIOD_PROPS,
            "customer": _nullable("string", "특정 거래처만 볼 때 거래처명 일부 또는 코드"),
        }),
        "run": _gross_profit,
    },
    {
        "name": "receivable_payable_summary",
        "menus": ("CUSTOMER_BALANCE_DASHBOARD", "CUSTOMER_LEDGER"),
        "label": "채권채무",
        "description": "기준일의 받을 돈(미수금) · 줄 돈(미지급금) 합계, 많은 거래처, 연령(경과일) 분석, 장기 미수, 월별 추이.",
        "parameters": _schema({
            "as_of": _nullable("string", "기준일 YYYY-MM-DD (없으면 오늘)"),
            "with_vat": {"type": "boolean", "description": "true = 합계금액(부가세 포함) 기준, false = 공급가 기준(기본)"},
        }),
        "run": _receivable_payable,
    },
    {
        "name": "receipt_payment_summary",
        "menus": ("RECEIPT_PAYMENT_SEARCH", "RECEIPT_PAYMENT"),
        "label": "수금지급 현황",
        "description": "기간 수금 · 지급 합계(현금 · 어음 · 은행 · 카드 · 상계), 거래처 · 월별 묶음, 최근 전표 10건.",
        "parameters": _schema({
            **_PERIOD_PROPS,
            "customer": _nullable("string", "거래처 코드 또는 이름 일부"),
            "transactiontype": {"type": "string", "enum": ["ALL", "RECEIPT", "PAYMENT"], "description": "RECEIPT = 수금, PAYMENT = 지급"},
            "group_by": {"type": "string", "enum": ["none", "customer", "month"], "description": "묶는 기준"},
        }),
        "run": _receipt_payment_summary,
    },
    {
        "name": "stock_movement_summary",
        "menus": ("STOCK_HISTORY",),
        "label": "재고수불 현황",
        "description": "기간 재고 입출고(기초 · 매입입고 · 매출출고 · 가공투입/입고 · 이동출고/입고) 수량 · 중량 · 원가. 품목 · 월 · 창고 · 거래처별 입고/출고.",
        "parameters": _schema({
            **_PERIOD_PROPS,
            "item_search": _nullable("string", "품목코드 · 품명 · 규격 일부"),
            "warehouse_search": _nullable("string", "창고코드 또는 창고명 일부"),
            "thickness": _nullable("string", "두께 일부"),
            "width": _nullable("string", "폭 일부"),
            "length": _nullable("string", "길이 일부"),
            "group_by": {"type": "string", "enum": ["none", "item", "month", "warehouse", "customer"], "description": "묶는 기준"},
        }),
        "run": _stock_movement,
    },
    {
        "name": "transfer_summary",
        "menus": ("INOUTMOVE_SEARCH",),
        "label": "재고이동 현황",
        "description": "기간 창고 간 재고이동 합계와 최근 이동 전표 30건.",
        "parameters": _schema({
            **_PERIOD_PROPS,
            "from_warehouse": _nullable("string", "보내는 창고 일부"),
            "to_warehouse": _nullable("string", "받는 창고 일부"),
            "item_search": _nullable("string", "품목코드 또는 품명 일부"),
        }),
        "run": _transfer_summary,
    },
    {
        "name": "document_search",
        "menus": _DOC_MENUS,
        "label": "전표 검색",
        "description": "전표 목록 찾기 (최근 순 30건). 거래처 · 기간 · 전표번호/품목으로 찾는다. 기간이 없으면 이번 달(전표번호로 찾을 땐 최근 3년).",
        "parameters": lambda user: _schema({
            "kind": {"type": "string", "enum": doc_kinds_for(user), "description": "전표 종류 (inbound 매입, outbound 매출, receipt_payment 수금/지급, transfer 재고이동, process 재고가공)"},
            "date_from": _nullable("string", "시작일 YYYY-MM-DD"),
            "date_to": _nullable("string", "종료일 YYYY-MM-DD"),
            "customer": _nullable("string", "거래처 코드 또는 이름 일부"),
            "keyword": _nullable("string", "전표번호 일부 또는 품목코드 · 품명 일부"),
        }),
        "run": _document_search,
    },
    {
        "name": "document_detail",
        "menus": _DOC_MENUS,
        "label": "전표 상세",
        "description": "전표 한 장의 헤더와 품목(최대 50줄) · 기타비용. 전표번호를 모르면 먼저 document_search.",
        "parameters": lambda user: _schema({
            "kind": {"type": "string", "enum": doc_kinds_for(user), "description": "전표 종류"},
            "receiptno": {"type": "string", "description": "전표번호 (가공은 가공번호)"},
        }),
        "run": _document_detail,
    },
    {
        "name": "instrument_summary",
        "menus": ("INSTRUMENT_STATUS",),
        "label": "어음수표 관리",
        "description": "보유 받을어음 · 결제 전 지급어음 · 30일 내 만기 · 부도 요약, 만기 구간별 금액, 만기 가까운 순 목록 30건.",
        "parameters": _schema({
            "kind": {"type": "string", "enum": ["ALL", "RECEIVABLE", "PAYABLE"], "description": "RECEIVABLE = 받을어음, PAYABLE = 지급어음"},
            "maturity_from": _nullable("string", "만기 시작일 YYYY-MM-DD"),
            "maturity_to": _nullable("string", "만기 종료일 YYYY-MM-DD"),
            "customer": _nullable("string", "거래처 코드 또는 이름 일부"),
            "include_closed": {"type": "boolean", "description": "true = 결제 · 할인 · 부도 처리된 것까지, false = 아직 남은 것만(기본)"},
        }),
        "run": _instrument_summary,
    },
    {
        "name": "process_summary",
        "menus": ("ITEM_PROCESS_SEARCH",),
        "label": "재고가공 현황",
        "description": "기간 재고가공 합계(건수 · 수량 · 중량 · 가공금액)와 최근 가공 전표 30건.",
        "parameters": _schema({
            **_PERIOD_PROPS,
            "customer": _nullable("string", "가공처 코드 또는 이름 일부"),
            "warehouse": _nullable("string", "창고 일부"),
            "item_search": _nullable("string", "품목코드 또는 품명 일부"),
        }),
        "run": _process_summary,
    },
    {
        "name": "ai_order_status",
        "menus": ("AI_ORDER_MANAGEMENT",),
        "label": "주문서 통합관리",
        "description": "가공주문(주문서 자동인식 · 직접 등록) 진행 상태별 건수(미전송 · 일부 전송 · 최적화 전송 · 가공완료)와 주문 목록 30건.",
        "parameters": _schema({
            "date_from": _nullable("string", "발주일 시작 YYYY-MM-DD"),
            "date_to": _nullable("string", "발주일 끝 YYYY-MM-DD"),
            "buyer": _nullable("string", "발주처 일부"),
            "progress": {"type": "string", "enum": ["ALL", "NONE", "PARTIAL", "SENT", "DONE"],
                         "description": "NONE 미전송, PARTIAL 일부 전송, SENT 최적화 전송, DONE 가공완료"},
        }),
        "run": _ai_order_status,
    },
    {
        "name": "month_close_status",
        "menus": ("MONTH_CLOSING",),
        "label": "월마감관리",
        "description": "몇 월까지 마감됐는지, 다음에 마감할 달, 연도의 월별 마감 여부 · 전표 수.",
        "parameters": _schema({
            "year": {"type": ["integer", "null"], "description": "연도 (없으면 올해)"},
        }),
        "run": _month_close_status,
    },
    {
        "name": "menu_guide",
        "menus": tuple(MENU_GUIDE_DATA),
        "label": "메뉴 사용 방법",
        "description": "메뉴(화면)의 사용 방법 · 입력 순서 · 저장 규칙 · 막히는 경우 · 수정/삭제 조건 상세 안내. '어떻게 해?', '왜 안 돼?' 같은 질문에 쓴다. 한 번에 최대 4개.",
        "parameters": lambda user: _schema({
            "menus": {"type": "array", "items": {"type": "string", "enum": guide_labels_for(user)}, "description": "메뉴 이름 (최대 4개)"},
        }),
        "run": _menu_guide,
    },
    {
        "name": "approval_status",
        "menus": ("CONTROL_MANAGEMENT",),
        "label": "통제관리 승인",
        "description": "승인 통제 대기 건수와 대기 중인 요청 목록(최근 8건), 내 요청 · 반려 현황.",
        "parameters": _schema({}),
        "run": _approval_status,
    },
]
TOOLS_BY_NAME = {tool["name"]: tool for tool in TOOLS}


def allowed(user: dict, menus: tuple[str, ...]) -> bool:
    return any(security_module.has_menu(user, menuid) for menuid in menus)


def tools_for(user: dict) -> list[dict]:
    return [tool for tool in TOOLS if allowed(user, tool["menus"])]


def openai_tools(tools: list[dict], user: dict) -> list[dict]:
    """도구 정의. 전표 종류처럼 사용자 권한에 따라 고를 수 있는 값이 달라지는 도구는 그 사람 기준으로 만든다."""
    return [{"type": "function", "name": t["name"], "description": t["description"],
             "parameters": t["parameters"](user) if callable(t["parameters"]) else t["parameters"], "strict": True} for t in tools]


def run_tool(user: dict, name: str, args: dict) -> dict:
    """권한 재검사 후 실행. 실패해도 예외 대신 모델이 읽을 안내를 돌려준다."""
    tool = TOOLS_BY_NAME.get(name)
    if tool is None:
        return {"error": "없는 도구입니다."}
    if not allowed(user, tool["menus"]):
        return {"error": f"{tool['label']} 메뉴 권한이 없어 조회할 수 없습니다."}
    try:
        return to_jsonable(tool["run"](user, args if isinstance(args, dict) else {}))
    except ToolError as error:
        return {"error": str(error)}


def month_bounds(value: date) -> tuple[date, date]:
    return value.replace(day=1), value.replace(day=calendar.monthrange(value.year, value.month)[1])
