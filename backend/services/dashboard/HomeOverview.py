"""대시보드 (메뉴: HOME) - 실제 전표로 계산.

숫자는 각 전용 화면과 같은 계산을 그대로 가져다 쓴다 → 화면끼리 숫자가 항상 같다.
  매출 · 비용 · 매출이익 · 월별 추이 : 매출이익 현황 (GrossProfitDashboard.dashboard)
  미수금 · 오래된 미수금 · 선급금     : 거래처 잔액 현황 (CustomerLedger.dashboard)
  매입                               : 매입 전표 공급가액 합계 (Inbound02t.supplyamt)
  장기재고                           : 현재고(잔량 > 0) 의 입고일 · 기초재고일부터 오늘까지 경과일
                                       재고이전으로 생긴 재고는 처음 출처(입고 · 기초 · 가공)의 날짜를 쓴다.
권한: 매출이익 · 미수금은 그 메뉴 권한이 있는 사용자에게만 내려준다.
"""
from datetime import date
from decimal import Decimal

import db as _db
from services.outbound import GrossProfitDashboard as gross_profit_dashboard
from services.receiptpayment import CustomerLedger as customer_ledger

ZERO = Decimal("0")
STOCK_AGING = [
    ("m6", "6개월 미만", 0, 182),
    ("y1", "6개월~1년", 183, 365),
    ("y2", "1~2년", 366, 730),
    ("y3", "2~3년", 731, 1095),
    ("over3", "3년 이상", 1096, None),
]
LONG_TERM_DAYS = 366  # 1년 넘으면 장기재고

PROFIT_MENUS = {"GROSS_PROFIT_DASHBOARD", "GROSS_PROFIT"}
BALANCE_MENUS = {"CUSTOMER_BALANCE_DASHBOARD", "CUSTOMER_LEDGER"}


def _rows(cursor, sql, params):
    cursor.execute(sql, params)
    columns = [column[0] for column in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


def _num(value) -> float:
    return float(value or 0)


def _plain(value):
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, dict):
        return {key: _plain(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_plain(item) for item in value]
    return value


# 재고 나이 기준일: 재고이전 재고는 처음 출처 행의 입고일(receiptdate), 나머지는 자기 입고일
_STOCK_SQL = """
SELECT s.itemcode, s.itemname, s.productname, s.materialname, s.surfacename,
       s.thickness, s.width, s.length, s.warehousecodename, s.customname,
       COALESCE(s.origintype, s.sourcetype) AS kind,
       COALESCE(o.receiptdate, s.receiptdate) AS agedate,
       s.weight, s.qty, COALESCE(s.weight, 0) * COALESCE(s.unitprice, 0) AS amount
FROM CurrentStock01t s
LEFT JOIN CurrentStock01t o
  ON s.originno IS NOT NULL AND o.companyid = s.companyid
 AND o.sourcetype = s.origintype AND o.sourceno = s.originno AND o.sourceline = s.originline
WHERE s.companyid = %s AND COALESCE(s.weight, 0) > 0
"""


def _stock_aging(cursor, companyid: str, today: date) -> dict:
    lots = _rows(cursor, _STOCK_SQL, (companyid,))
    buckets = {key: {"key": key, "label": label, "weight": ZERO, "amount": ZERO, "lots": 0} for key, label, *_ in STOCK_AGING}
    unknown = {"key": "unknown", "label": "날짜 없음", "weight": ZERO, "amount": ZERO, "lots": 0}
    oldest = []
    total_weight = ZERO
    total_amount = ZERO
    for lot in lots:
        weight = lot["weight"] or ZERO
        amount = lot["amount"] or ZERO
        total_weight += weight
        total_amount += amount
        if lot["agedate"] is None:
            target = unknown
            days = None
        else:
            days = max((today - lot["agedate"]).days, 0)
            target = next(buckets[key] for key, _label, low, high in STOCK_AGING if days >= low and (high is None or days <= high))
        target["weight"] += weight
        target["amount"] += amount
        target["lots"] += 1
        if days is not None and days >= LONG_TERM_DAYS:
            oldest.append({**lot, "days": days})
    oldest.sort(key=lambda row: (-row["days"], -(row["weight"] or 0)))
    long_weight = sum((row["weight"] or ZERO for row in oldest), ZERO)
    long_amount = sum((row["amount"] or ZERO for row in oldest), ZERO)
    return {
        "total_weight": total_weight, "total_amount": total_amount, "lots": len(lots),
        "long_weight": long_weight, "long_amount": long_amount, "long_lots": len(oldest),
        "buckets": list(buckets.values()) + ([unknown] if unknown["lots"] else []),
        "oldest": oldest[:8],
    }


def _purchase_trend(cursor, companyid: str, months: list[str]) -> list[dict]:
    """매출이익 현황 추이와 같은 12개월(YYYY-MM)의 월별 매입 공급가액 · 중량."""
    if not months:
        return []
    first = date(int(months[0][:4]), int(months[0][5:7]), 1)
    last_year, last_month = int(months[-1][:4]), int(months[-1][5:7])
    after = date(last_year + (last_month == 12), last_month % 12 + 1, 1)
    cursor.execute(
        """SELECT TO_CHAR(h.receptdate, 'YYYY-MM') AS month, COALESCE(SUM(d.supplyamt), 0), COALESCE(SUM(d.weight), 0)
           FROM Inbound01t h JOIN Inbound02t d ON d.companyid = h.companyid AND d.receiptno = h.receiptno
           WHERE h.companyid = %s AND h.receptdate >= %s AND h.receptdate < %s
           GROUP BY 1""",
        (companyid, first, after),
    )
    found = {month: (amount, weight) for month, amount, weight in cursor.fetchall()}
    return [{"month": month, "amount": found.get(month, (ZERO, ZERO))[0], "weight": found.get(month, (ZERO, ZERO))[1]} for month in months]


def _purchase(cursor, companyid: str, date_from: date, date_to: date, head: str = "Inbound01t", line: str = "Inbound02t") -> dict:
    cursor.execute(
        f"""SELECT COALESCE(SUM(d.supplyamt), 0), COALESCE(SUM(d.weight), 0), COUNT(DISTINCT h.receiptno)
           FROM {head} h JOIN {line} d ON d.companyid = h.companyid AND d.receiptno = h.receiptno
           WHERE h.companyid = %s AND h.receptdate BETWEEN %s AND %s""",
        (companyid, date_from, date_to),
    )
    amount, weight, count = cursor.fetchone()
    return {"amount": amount, "weight": weight, "count": count}


# 최근 전표: 전표 한 장 = 한 줄 (첫 품목 + 외 N건)
_RECENT_SQL = """
SELECT h.receiptno, h.receptdate, h.customname,
       MIN(d.itemname) FILTER (WHERE d.lineno = first.lineno) AS itemname,
       MIN(CONCAT_WS('×', NULLIF(TRIM(TO_CHAR(NULLIF(d.thickness, 0), 'FM999990.###')), ''),
                          NULLIF(TRIM(TO_CHAR(NULLIF(d.width, 0), 'FM999990.###')), ''),
                          NULLIF(TRIM(TO_CHAR(NULLIF(d.length, 0), 'FM9999990.###')), '')))
         FILTER (WHERE d.lineno = first.lineno) AS spec,
       COUNT(d.lineno)::integer AS line_count,
       COALESCE(SUM(d.weight), 0) AS weight,
       COALESCE(SUM(d.supplyamt), 0) AS amount
FROM {head} h
JOIN {line} d ON d.companyid = h.companyid AND d.receiptno = h.receiptno
JOIN LATERAL (SELECT MIN(x.lineno) AS lineno FROM {line} x WHERE x.companyid = h.companyid AND x.receiptno = h.receiptno) first ON TRUE
WHERE h.companyid = %s AND h.receptdate BETWEEN %s AND %s
GROUP BY h.receiptno, h.receptdate, h.customname
ORDER BY h.receptdate DESC, h.receiptno DESC
LIMIT %s
"""


def _recent(cursor, head: str, line: str, companyid: str, date_from: date, date_to: date, limit: int = 30):
    return _rows(cursor, _RECENT_SQL.format(head=head, line=line), (companyid, date_from, date_to, limit))


def overview(user: dict, date_from: date, date_to: date, today: date, is_admin: bool) -> dict:
    companyid = user["companyid"]
    menus = set(user.get("menuids") or [])
    can_profit = is_admin or bool(menus & PROFIT_MENUS)
    can_balance = is_admin or bool(menus & BALANCE_MENUS)

    with _db.connect() as connection, connection.cursor() as cursor:
        purchase = _purchase(cursor, companyid, date_from, date_to)
        # 비교: 매출이익 현황과 같은 '전월 같은 기간'
        prev_from, prev_to = gross_profit_dashboard.previous_period(date_from, date_to)
        purchase_prev = _purchase(cursor, companyid, prev_from, prev_to)
        sales_slips = _purchase(cursor, companyid, date_from, date_to, "Outbound01t", "Outbound02t")["count"]
        stock = _stock_aging(cursor, companyid, today)
        recent_inbound = _recent(cursor, "Inbound01t", "Inbound02t", companyid, date_from, date_to)
        recent_outbound = _recent(cursor, "Outbound01t", "Outbound02t", companyid, date_from, date_to)

    profit = gross_profit_dashboard.dashboard(companyid, date_from, date_to)
    with _db.connect() as connection, connection.cursor() as cursor:
        purchase_trend = _purchase_trend(cursor, companyid, [row["month"] for row in profit["trend"]])
    sales = {
        "total": {**{key: profit["total"].get(key) for key in ("sales", "weight", "line_count")}, "slips": sales_slips},
        "prev": {key: profit["prev_total"].get(key) for key in ("sales", "weight")},
        "trend": [{"month": row["month"], "sales": row["sales"], "weight": row["weight"]} for row in profit["trend"]],
    }
    result = {
        "period": {"date_from": date_from, "date_to": date_to, "prev_from": prev_from, "prev_to": prev_to, "today": today},
        "permissions": {"profit": can_profit, "balance": can_balance},
        "sales": sales,
        "purchase": {"total": purchase, "prev": purchase_prev, "trend": purchase_trend},
        "stock": stock,
        "recent_inbound": recent_inbound,
        "recent_outbound": recent_outbound,
    }
    if can_profit:
        total = profit["total"]
        losers = sorted((row for row in profit["customers"] if row["profit"] < 0), key=lambda row: row["profit"])
        result["profit"] = {
            "total": {key: total.get(key) for key in ("profit", "margin_rate", "cost", "sales")},
            "prev": {key: profit["prev_total"].get(key) for key in ("profit", "margin_rate")},
            "trend": [{"month": row["month"], "profit": row["profit"], "cost": row["cost"], "sales": row["sales"], "margin_rate": row["margin_rate"]} for row in profit["trend"]],
            "loss_customers": [{"customname": row["customname"], "profit": row["profit"]} for row in losers[:5]],
            "loss_count": len(losers),
        }
    if can_balance:
        ledger = customer_ledger.dashboard(companyid, today, top_n=5)
        late = sum((row["amount"] for row in ledger["aging"] if row["key"] in ("d60", "d90", "over90")), ZERO)
        over90 = sum((row["amount"] for row in ledger["aging"] if row["key"] == "over90"), ZERO)
        prepaid = [row for row in ledger["attention"] if row["kind"] == "선급금"]
        result["balance"] = {
            "receivable": ledger["summary"]["receivable"], "payable": ledger["summary"]["payable"],
            "receivable_customers": ledger["summary"]["receivable_customers"],
            "trend": [{"month": row.get("month"), "recv": row.get("recv_balance")} for row in ledger["trend"]],
            "late": late, "over90": over90,
            "top_receivable": ledger["top_receivable"],
            "prepaid_count": len(prepaid), "prepaid_amount": sum((-(row["pay"] or ZERO) for row in prepaid), ZERO),
        }
    return _plain(result)
