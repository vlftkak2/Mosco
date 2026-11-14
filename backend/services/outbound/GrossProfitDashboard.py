"""매출이익 현황판 (메뉴: GROSS_PROFIT_DASHBOARD) - 경영자용.

매출이익분석(GrossProfit.py)과 같은 계산(_build_query)을 쓰고 묶는 기준만 바꾼다 → 두 화면의 숫자가 항상 같다.

  매출   = 매출금액(판매) + 매출비용(+)
  비용   = 매입원가(매입금액 + 매입비용 + 가공비 + 원자재원가) + 판매비용(매출비용 −)
  순이익 = 매출 − 비용   (= 매출이익분석의 이익금액)
  마진율 = 순이익 ÷ 매출 × 100
  톤당 매출/이익 = 매출(순이익) ÷ 중량(kg) × 1000  (원/톤, 중량 0 이면 없음)
비교: 전월 = 같은 기간을 한 달 앞으로, 전년 동월 = 같은 기간을 12개월 앞으로.
추이: 조회 종료월까지 최근 12개월 + 각 달의 전년 같은 달.
"""
import calendar
from datetime import date

from services.outbound import GrossProfit as gross_profit

_MEASURES = """
    COALESCE(SUM(sales_amt + sales_plus), 0) AS sales,
    COALESCE(SUM(sales_amt), 0) AS sales_goods,
    COALESCE(SUM(sales_plus), 0) AS sales_plus,
    COALESCE(SUM(purchase_amt + purchase_cost + process_amt + material_amt), 0) AS cost_of_goods,
    COALESCE(SUM(purchase_amt), 0) AS purchase_amt,
    COALESCE(SUM(purchase_cost), 0) AS purchase_cost,
    COALESCE(SUM(process_amt), 0) AS process_amt,
    COALESCE(SUM(material_amt), 0) AS material_amt,
    COALESCE(SUM(sales_minus), 0) AS selling_cost,
    COALESCE(SUM(profit_amt), 0) AS profit,
    COALESCE(SUM(weight), 0) AS weight,
    COUNT(*) AS line_count"""


def _shift_month(value: date, months: int, keep_month_end: bool) -> date:
    month_index = value.year * 12 + value.month - 1 + months
    year, month = divmod(month_index, 12)
    month += 1
    last_day = calendar.monthrange(year, month)[1]
    day = last_day if keep_month_end else min(value.day, last_day)
    return date(year, month, day)


def previous_period(date_from: date, date_to: date, months: int = 1) -> tuple[date, date]:
    """같은 기간을 months 달 앞으로 (월말이면 월말 유지: 11/1~11/30 → 10/1~10/31)."""
    to_is_month_end = date_to.day == calendar.monthrange(date_to.year, date_to.month)[1]
    return _shift_month(date_from, -months, False), _shift_month(date_to, -months, to_is_month_end)


def _finish(entry: dict) -> dict:
    out = {key: (float(value) if hasattr(value, "is_finite") else value) for key, value in entry.items()}
    sales = out.get("sales") or 0
    out["cost"] = (out.get("cost_of_goods") or 0) + (out.get("selling_cost") or 0)
    out["margin_rate"] = round(out["profit"] / sales * 100, 2) if sales else None
    weight = out.get("weight") or 0
    out["sales_per_ton"] = round(sales / weight * 1000) if weight > 0 else None
    out["profit_per_ton"] = round((out.get("profit") or 0) / weight * 1000) if weight > 0 else None
    return out


_EMPTY = {"sales": 0, "profit": 0, "cost_of_goods": 0, "selling_cost": 0, "weight": 0, "line_count": 0}


def dashboard(companyid: str, date_from: date, date_to: date):
    prev_from, prev_to = previous_period(date_from, date_to)
    yoy_from, yoy_to = previous_period(date_from, date_to, 12)
    trend_from = _shift_month(date(date_to.year, date_to.month, 1), -11, False)
    trend_prev_from = _shift_month(trend_from, -12, False)

    with gross_profit._connect() as connection, connection.cursor() as cursor:
        def cte(start, end):
            return gross_profit._build_query({"companyid": companyid, "date_from": start, "date_to": end}, cursor)

        def fetch(sql, params):
            cursor.execute(sql, params)
            columns = [column[0] for column in cursor.description]
            return [dict(zip(columns, row)) for row in cursor.fetchall()]

        # 현재 기간: 거래처 / 전체 (한 번에)
        sql, params = cte(date_from, date_to)
        current = fetch(f"""{sql}
            SELECT CASE WHEN GROUPING(customcode) = 0 THEN 'customer' ELSE 'total' END AS dim,
                   customcode, customname, COUNT(DISTINCT receiptno) AS doc_count, {_MEASURES}
            FROM filtered GROUP BY GROUPING SETS ((customcode, customname), ())""", params)
        # 전월: 거래처 / 전체
        sql, params = cte(prev_from, prev_to)
        previous = fetch(f"""{sql}
            SELECT CASE WHEN GROUPING(customcode) = 0 THEN 'customer' ELSE 'total' END AS dim,
                   customcode, customname, {_MEASURES}
            FROM filtered GROUP BY GROUPING SETS ((customcode, customname), ())""", params)
        # 전년 동월: 전체만
        sql, params = cte(yoy_from, yoy_to)
        yoy = fetch(f"{sql} SELECT {_MEASURES} FROM filtered", params)
        # 최근 12개월 + 그 전년 12개월 (월별)
        sql, params = cte(trend_prev_from, date_to)
        trend = fetch(f"""{sql}
            SELECT TO_CHAR(DATE_TRUNC('month', receptdate), 'YYYY-MM') AS month, {_MEASURES}
            FROM filtered GROUP BY 1 ORDER BY 1""", params)

    def pick(rows, dim):
        return [_finish(row) for row in rows if row["dim"] == dim]

    total = next(iter(pick(current, "total")), _finish(dict(_EMPTY)))
    prev_total = next(iter(pick(previous, "total")), _finish(dict(_EMPTY)))
    yoy_total = _finish(yoy[0]) if yoy and yoy[0]["line_count"] else _finish(dict(_EMPTY))
    prev_by_customer = {row["customcode"]: row for row in pick(previous, "customer")}
    customers = pick(current, "customer")
    for row in customers:
        prev = prev_by_customer.get(row["customcode"])
        row["prev_sales"] = prev["sales"] if prev else 0
        row["prev_profit"] = prev["profit"] if prev else 0
        row["prev_margin_rate"] = prev["margin_rate"] if prev else None
        row["share"] = round(row["sales"] / total["sales"] * 100, 2) if total.get("sales") else 0
    customers.sort(key=lambda row: row["sales"], reverse=True)

    # 12개월을 빈 달까지 채우고, 각 달에 전년 같은 달 매출·순이익을 붙인다
    by_month = {row["month"]: _finish(row) for row in trend}
    months = []
    for offset in range(12):
        month_start = _shift_month(trend_from, offset, False)
        last_year = _shift_month(month_start, -12, False)
        key = f"{month_start.year:04d}-{month_start.month:02d}"
        prev_key = f"{last_year.year:04d}-{last_year.month:02d}"
        row = by_month.get(key) or _finish({"month": key, **_EMPTY})
        prev_row = by_month.get(prev_key)
        row["ly_sales"] = prev_row["sales"] if prev_row else 0
        row["ly_profit"] = prev_row["profit"] if prev_row else 0
        months.append(row)

    total["customer_count"] = len(customers)
    total["loss_customer_count"] = sum(1 for row in customers if row["profit"] < 0)
    total["loss_amount"] = sum(row["profit"] for row in customers if row["profit"] < 0)
    prev_total["customer_count"] = len(prev_by_customer)
    return {
        "period": {"date_from": date_from, "date_to": date_to, "prev_from": prev_from, "prev_to": prev_to,
                   "yoy_from": yoy_from, "yoy_to": yoy_to, "trend_from": trend_from},
        "total": total, "prev_total": prev_total, "yoy_total": yoy_total,
        "customers": customers, "trend": months,
    }
