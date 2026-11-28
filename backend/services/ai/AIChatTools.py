"""AI 업무비서가 쓰는 조회 도구 (읽기 전용) · 메뉴별 업무 안내.

권한 원칙 (서버가 강제한다 · 모델이 정하지 않는다)
  - 도구마다 필요한 메뉴권한(menus, 하나라도 있으면 됨)을 둔다. 화면 API 와 같은 메뉴다.
  - 사용자에게 권한이 없는 도구는 모델에 아예 보여주지 않고, 실행 직전에 한 번 더 검사한다.
  - 회사는 항상 로그인한 사용자의 companyid. 모델이 회사를 고를 수 있는 인자는 없다.
  - 숫자는 각 화면과 같은 계산 함수 · 같은 조건(_search_conditions 등)을 써서 화면 숫자와 같다.
  - 급여: 계좌 · 생년월일 · 이메일 등 개인정보 칸은 모델에 보내지 않는다.
업무 안내(MENU_GUIDES)도 권한이 있는 메뉴 것만 모델에 준다.
"""
from __future__ import annotations

import calendar
import re
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Callable
from zoneinfo import ZoneInfo

import db as _shared_db
import security as security_module

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
        "note": "매출이익분석과 같은 계산. 공급가(부가세 제외) 기준. 매출 = 매출금액+매출비용(+), 비용 = 매입원가+판매비용, "
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
        "note": ("거래처원장과 같은 계산. 금액 기준 = " + ("합계금액(공급가+부가세)" if with_vat else "공급가(부가세 제외)")
                 + ". receivable = 받을 돈(미수금), payable = 줄 돈(미지급금)"),
        "summary": data.get("summary"),
        "top_receivable": trim(data.get("top_receivable")),
        "top_payable": trim(data.get("top_payable")),
        "aging": [{k: v for k, v in (row or {}).items() if k in ("label", "amount", "customer_count")}
                  for row in data.get("aging") or []],
        "overdue": trim(data.get("overdue")),
        "trend": data.get("trend"),
    }


# ── 급여 (민감) ──────────────────────────────────────────────────────
_PAY_SAFE = ("payym", "username", "empno", "team", "position", "worktype", "paydate", "closeyn",
             "pay_total", "ded_total", "net_pay", "taxable")


def _call_payroll(fn: Callable, *args):
    try:
        return fn(*args)
    except PermissionError as error:
        raise ToolError(str(error)) from error
    except ValueError as error:
        raise ToolError(str(error)) from error


def _payroll_summary(user: dict, args: dict) -> dict:
    from services.payroll import Payroll as payroll_module

    from_ym, to_ym = _ym(args.get("from_ym"), "시작월"), _ym(args.get("to_ym"), "끝월")
    data = _call_payroll(payroll_module.period_ledger, user, from_ym, to_ym)
    months: dict[str, dict] = {}
    for item in data.get("items") or []:
        month = months.setdefault(item["payym"], {"payym": item["payym"], "headcount": 0, "pay_total": 0, "ded_total": 0, "net_pay": 0})
        month["headcount"] += 1
        for key in ("pay_total", "ded_total", "net_pay"):
            month[key] += int(item.get(key) or 0)
    closed = {m["payym"]: m["closed"] for m in data.get("months") or []}
    result = {
        "period": {"from_ym": from_ym, "to_ym": to_ym},
        "note": "급여대장과 같은 자료. pay_total = 지급합계, ded_total = 공제합계, net_pay = 실지급액 (원)",
        "months": [{**m, "closed": closed.get(ym, False)} for ym, m in sorted(months.items())],
    }
    detail_ym = _text(args.get("detail_ym"), 7)
    if detail_ym:
        detail_ym = _ym(detail_ym, "상세월")
        result["detail_ym"] = detail_ym
        result["employees"] = [{k: to_jsonable(item.get(k)) for k in _PAY_SAFE}
                               for item in data.get("items") or [] if item.get("payym") == detail_ym][:200]
    return result


def _my_payroll(user: dict, args: dict) -> dict:
    from services.payroll import Payroll as payroll_module

    data = _call_payroll(payroll_module.my_slips, user)
    fields = _PAY_SAFE + payroll_module.PAY_FIELDS + payroll_module.DED_FIELDS
    return {
        "note": "내 급여현황: 마감된 내 급여만. pay_* = 지급항목, ded_* = 공제항목 (원)",
        "items": [{k: to_jsonable(item.get(k)) for k in fields if k in item} for item in (data.get("items") or [])[:24]],
    }


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
        "name": "payroll_summary",
        "menus": ("PAYROLL",),
        "label": "급여대장",
        "description": "월별 급여 인원 · 지급합계 · 공제합계 · 실지급액. detail_ym 을 주면 그달 직원별 합계.",
        "parameters": _schema({
            "from_ym": {"type": "string", "description": "시작 귀속월 YYYY-MM"},
            "to_ym": {"type": "string", "description": "끝 귀속월 YYYY-MM (최대 36개월)"},
            "detail_ym": _nullable("string", "직원별 상세를 볼 귀속월 YYYY-MM"),
        }),
        "run": _payroll_summary,
    },
    {
        "name": "my_payroll",
        "menus": ("PAYROLL_MY",),
        "label": "내 급여현황",
        "description": "질문한 본인의 마감된 급여 명세 (최근 24개월).",
        "parameters": _schema({}),
        "run": _my_payroll,
    },
]
TOOLS_BY_NAME = {tool["name"]: tool for tool in TOOLS}


def allowed(user: dict, menus: tuple[str, ...]) -> bool:
    return any(security_module.has_menu(user, menuid) for menuid in menus)


def tools_for(user: dict) -> list[dict]:
    return [tool for tool in TOOLS if allowed(user, tool["menus"])]


def openai_tools(tools: list[dict]) -> list[dict]:
    return [{"type": "function", "name": t["name"], "description": t["description"],
             "parameters": t["parameters"], "strict": True} for t in tools]


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


# ── 메뉴별 업무 안내 (프로세스 질문용 · 권한 있는 메뉴만 모델에 준다) ─────
MENU_GUIDES: dict[str, tuple[str, str]] = {
    "INBOUND_REGISTER": ("매입등록", "매입 기본(매입일자 · 매입처 · 창고 필수)과 매입 상세(품명 · 강종 필수, 두께 · 폭 · 길이 · 수량 · 중량 · 단가)를 입력하고 저장한다. "
                         "기타비용 탭에 운반비 등을 넣으면 재고 원가에 배부된다. 엑셀 셀 범위를 붙여넣을 수 있다. 저장하면 재고(현재고)가 생긴다."),
    "INBOUND_SEARCH": ("매입현황", "기간 · 매입처 · 창고 · 품목으로 매입 상세와 기타비용을 조회한다. 매출 비용 · 가공 비용 포함을 켜면 함께 보인다."),
    "OUTBOUND_REGISTER": ("매출등록", "매출처 · 출고일자를 넣고 현재고에서 재고를 골라 매출 상세를 만든다. 기타비용의 비용여부 '예'는 우리가 내는 비용(매출비용 −), "
                          "'아니오'는 매출처에 청구하는 금액(매출에 더함)이다. 통제관리에서 승인 통제가 켜져 있으면 승인요청이 된다."),
    "OUTBOUND_SEARCH": ("매출현황", "기간 · 매출처 · 창고 · 품목으로 매출 상세와 기타비용을 조회한다. 합계금액 = 매출 + 기타비용 '아니오', 비용(−) = 기타비용 '예'."),
    "GROSS_PROFIT": ("매출이익분석", "출고 상세마다 재고에서 빠진 원가를 붙여 이익을 계산한다. 공급가 기준. 이익 = 매출금액 + 매출비용(+) − 매입금액 − 매입비용 − 가공비 − 가공 원재료비 − 매출비용(−). "
                     "마진율 = 이익 ÷ (매출금액 + 매출비용(+)) × 100. 재고 원가는 금액 잔액 방식(출고 = 남은 원가 × 출고중량 ÷ 남은 중량)."),
    "GROSS_PROFIT_DASHBOARD": ("매출이익요약", "매출이익분석과 같은 계산을 거래처 · 월별로 묶어 보여준다. 전월 · 전년 동월 비교, 최근 12개월 추이."),
    "STOCK_INITIAL": ("기초재고등록", "시스템을 처음 쓸 때 가지고 있던 재고를 등록한다. 원가 = 공급가."),
    "STOCK_CURRENT": ("현재고현황", "지금 남은 재고를 로트(입고 · 기초 · 가공 · 이동 출처)별로 본다. 재고금액은 원가 기준."),
    "STOCK_HISTORY": ("재고수불현황", "기간 동안 재고의 입고 · 출고 · 이동 · 가공 수불 내역과 기초 · 기말을 본다."),
    "INOUTMOVE_REGISTER": ("재고이동등록", "재고를 다른 창고로 옮긴다. 옮긴 재고의 원가는 원래 재고에서 빠진 원가를 그대로 가져간다."),
    "INOUTMOVE_SEARCH": ("재고이동현황", "기간별 재고이동 내역을 조회한다."),
    "AI_ORDER_RECOGNITION": ("AI 주문서인식", "주문서 PDF · 이미지를 올리면 AI가 발주처 · 납기 · 품목을 읽어 가공주문 초안을 만든다. 사람이 확인 후 저장한다."),
    "AI_ORDER_MANAGEMENT": ("가공주문관리", "AI 주문서인식으로 만든 가공주문을 모아 보고 상태를 관리한다."),
    "AI_OPTIMIZATION": ("가공최적화", "가공주문에 맞춰 어떤 재고를 어떻게 잘라 쓸지 배치를 계산한다."),
    "ITEM_PROCESS_MASTER": ("가공공정관리", "가공 공정(절단 · 슬리팅 등)과 단가 기준을 관리한다."),
    "ITEM_PROCESS_REGISTER": ("재고가공등록", "원소재 재고를 투입해 가공품을 만든다. 가공품 원가 = 원소재에서 빠진 원가 + 가공비(로스 포함 중량으로 배부)."),
    "ITEM_PROCESS_SEARCH": ("재고가공현황", "기간별 가공 내역을 조회한다."),
    "DATA_CUSTOMER": ("거래처등록", "매입처 · 매출처 등 거래처를 등록한다. 여신 한도를 둘 수 있다."),
    "CUSTOMER_LEDGER": ("거래처원장", "전표에서 바로 계산한다(별도 원장 테이블 없음). 받을 돈 = 매출 − 수금, 줄 돈 = 매입 + 매입(비용) + 가공 − 지급. "
                        "기본은 공급가 기준, '합계금액 기준'을 켜면 부가세 포함. 상계는 받을 돈과 줄 돈 양쪽에서 함께 뺀다."),
    "CUSTOMER_BALANCE_DASHBOARD": ("채권채무요약", "거래처원장과 같은 계산으로 미수 · 미지급 합계, 연령 분석, 장기 미수를 요약한다."),
    "RECEIPT_PAYMENT": ("수금/지급등록", "거래처별 수금 · 지급을 현금 · 증권(어음/수표) · 상계 · 잡손실 · 잡이익으로 등록한다. 어음 부도 처리도 여기서 한다."),
    "RECEIPT_PAYMENT_SEARCH": ("수금/지급현황", "기간별 수금 · 지급 내역을 조회한다."),
    "INSTRUMENT_STATUS": ("수표/어음관리", "받은 · 넘겨준 어음과 수표의 만기 · 결제 · 할인 · 부도 상태를 관리한다."),
    "DATA_CODE": ("공통코드관리", "창고 · 단위 · 비용구분 등 공통코드를 관리한다."),
    "DATA_ITEM": ("품목코드관리", "품명 · 강종 · 표면 등 품목코드를 관리한다."),
    "WORKPLACE_MANAGEMENT": ("사업장관리", "회사의 사업장 정보를 관리한다."),
    "MONTH_CLOSING": ("월마감관리", "달 단위로 마감한다. 마감된 달까지의 입고 · 출고 · 기초재고 · 재고이전 · 가공 · 수금/지급 전표는 등록 · 수정 · 삭제할 수 없다. "
                      "마감은 마지막 마감월의 다음 달만, 마감 취소는 마지막 마감월만 할 수 있다. 아직 오지 않은 달은 마감할 수 없다."),
    "USER_MANAGEMENT": ("직원관리", "직원 계정과 입사 · 퇴사 정보를 관리한다."),
    "EAPPROVAL": ("전자결재", "결재 문서를 작성하고 결재선에 따라 승인 · 반려한다. 휴가 신청도 전자결재로 한다."),
    "PAYROLL": ("급여입력 · 급여대장", "1) 전월 불러오기: 그달 재직자 행을 만들고 고정값(기본급 · 고정수당 · 가족 수)을 복사, 변동분은 0. "
                "2) 변동분 입력 · 저장: 4대보험 · 소득세 공제가 자동 계산된다(직접 고칠 수 있다). 3) 마감: 그달을 잠그고, 마감된 달만 직원이 '내 급여현황'에서 본다."),
    "PAYROLL_MY": ("내 급여현황", "마감된 본인 급여 명세만 볼 수 있다."),
    "CONTROL_MANAGEMENT": ("통제관리", "거래처 · 매입 · 매출 · 수금/지급의 등록 · 수정 · 삭제를 금액 기준으로 승인받게 설정한다. 승인자가 승인하면 그때 실제 저장된다. 여신 통제도 설정한다."),
}


def guides_for(user: dict) -> list[tuple[str, str]]:
    return [guide for menuid, guide in MENU_GUIDES.items() if security_module.has_menu(user, menuid)]


def month_bounds(value: date) -> tuple[date, date]:
    return value.replace(day=1), value.replace(day=calendar.monthrange(value.year, value.month)[1])
