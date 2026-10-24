from datetime import date, datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

import InboundRegister as inbound_register_module


SEOUL = ZoneInfo("Asia/Seoul")


def _number(value):
    return float(value or 0)


def _dashboard_rows(cursor, query, params):
    cursor.execute(query, params)
    columns = [column[0] for column in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


def get_dashboard_summary(companyid: str):
    today = datetime.now(SEOUL).date()
    month_start = today.replace(day=1)
    yesterday = today - timedelta(days=1)
    chart_from = today - timedelta(days=13)
    monthly_chart_from = (month_start - timedelta(days=150)).replace(day=1)

    with inbound_register_module._connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            "SELECT COALESCE(SUM(weight), 0) FROM CurrentStock01t WHERE companyid = %s",
            (companyid,),
        )
        current_stock = _number(cursor.fetchone()[0])

        cursor.execute(
            """SELECT COALESCE(SUM(d.unitamt), 0), COALESCE(SUM(d.weight), 0)
               FROM Inbound01t h JOIN Inbound02t d
                 ON d.companyid = h.companyid AND d.receiptno = h.receiptno
               WHERE h.companyid = %s AND h.receptdate >= %s AND h.receptdate <= %s""",
            (companyid, month_start, today),
        )
        month_purchase, _ = cursor.fetchone()

        cursor.execute(
            """SELECT COALESCE(SUM(d.unitamt), 0), COALESCE(SUM(d.weight), 0)
               FROM Outbound01t h JOIN Outbound02t d
                 ON d.companyid = h.companyid AND d.receiptno = h.receiptno
               WHERE h.companyid = %s AND h.receptdate >= %s AND h.receptdate <= %s""",
            (companyid, month_start, today),
        )
        month_sales, _ = cursor.fetchone()

        cursor.execute(
            """SELECT COALESCE(SUM(d.unitamt - COALESCE(cost.unit_cost * d.weight, 0)), 0)
               FROM Outbound01t h JOIN Outbound02t d
                 ON d.companyid = h.companyid AND d.receiptno = h.receiptno
               LEFT JOIN LATERAL (
                 SELECT purchase_detail.unitamt / NULLIF(purchase_detail.weight, 0) AS unit_cost
                 FROM Inbound01t purchase_header
                 JOIN Inbound02t purchase_detail
                   ON purchase_detail.companyid = purchase_header.companyid
                  AND purchase_detail.receiptno = purchase_header.receiptno
                 WHERE purchase_header.companyid = h.companyid
                   AND purchase_header.receptdate <= h.receptdate
                   AND purchase_detail.itemcode = d.itemcode
                   AND COALESCE(purchase_detail.size, '') = COALESCE(d.size, '')
                 ORDER BY purchase_header.receptdate DESC, purchase_header.receiptno DESC,
                          purchase_detail.lineno DESC
                 LIMIT 1
               ) cost ON TRUE
               WHERE h.companyid = %s AND h.receptdate >= %s AND h.receptdate <= %s""",
            (companyid, month_start, today),
        )
        month_profit_estimate = cursor.fetchone()[0]

        cursor.execute(
            """SELECT h.receptdate,
                      COALESCE(SUM(d.unitamt - COALESCE(cost.unit_cost * d.weight, 0)), 0)
               FROM Outbound01t h JOIN Outbound02t d
                 ON d.companyid = h.companyid AND d.receiptno = h.receiptno
               LEFT JOIN LATERAL (
                 SELECT purchase_detail.unitamt / NULLIF(purchase_detail.weight, 0) AS unit_cost
                 FROM Inbound01t purchase_header
                 JOIN Inbound02t purchase_detail
                   ON purchase_detail.companyid = purchase_header.companyid
                  AND purchase_detail.receiptno = purchase_header.receiptno
                 WHERE purchase_header.companyid = h.companyid
                   AND purchase_header.receptdate <= h.receptdate
                   AND purchase_detail.itemcode = d.itemcode
                   AND COALESCE(purchase_detail.size, '') = COALESCE(d.size, '')
                 ORDER BY purchase_header.receptdate DESC, purchase_header.receiptno DESC,
                          purchase_detail.lineno DESC
                 LIMIT 1
               ) cost ON TRUE
               WHERE h.companyid = %s AND h.receptdate >= %s AND h.receptdate <= %s
               GROUP BY h.receptdate""",
            (companyid, yesterday, today),
        )
        profit_by_date = {row[0]: _number(row[1]) for row in cursor.fetchall()}

        cursor.execute(
            """SELECT COALESCE(SUM(d.unitamt), 0)
               FROM Inbound01t h JOIN Inbound02t d
                 ON d.companyid = h.companyid AND d.receiptno = h.receiptno
               WHERE h.companyid = %s AND h.receptdate = %s""",
            (companyid, today),
        )
        purchase_today = cursor.fetchone()[0]
        cursor.execute(
            """SELECT COALESCE(SUM(d.unitamt), 0)
               FROM Inbound01t h JOIN Inbound02t d
                 ON d.companyid = h.companyid AND d.receiptno = h.receiptno
               WHERE h.companyid = %s AND h.receptdate = %s""",
            (companyid, yesterday),
        )
        purchase_yesterday = cursor.fetchone()[0]
        cursor.execute(
            """SELECT COALESCE(SUM(d.unitamt), 0)
               FROM Outbound01t h JOIN Outbound02t d
                 ON d.companyid = h.companyid AND d.receiptno = h.receiptno
               WHERE h.companyid = %s AND h.receptdate = %s""",
            (companyid, today),
        )
        sales_today = cursor.fetchone()[0]
        cursor.execute(
            """SELECT COALESCE(SUM(d.unitamt), 0)
               FROM Outbound01t h JOIN Outbound02t d
                 ON d.companyid = h.companyid AND d.receiptno = h.receiptno
               WHERE h.companyid = %s AND h.receptdate = %s""",
            (companyid, yesterday),
        )
        sales_yesterday = cursor.fetchone()[0]

        cursor.execute(
            """SELECT COALESCE(SUM(CASE WHEN iniotype IN ('IN', 'ST') THEN weight
                                         WHEN iniotype = 'OUT' THEN -weight ELSE 0 END), 0)
               FROM Iniop01t WHERE companyid = %s AND iniodate = %s""",
            (companyid, today),
        )
        stock_change_today = cursor.fetchone()[0]

        trend_rows = _dashboard_rows(
            cursor,
            """SELECT transaction_date,
                      SUM(purchase_amount) AS purchase_amount,
                      SUM(sales_amount) AS sales_amount
               FROM (
                  SELECT h.receptdate AS transaction_date, SUM(d.unitamt) AS purchase_amount,
                        0::numeric AS sales_amount
                 FROM Inbound01t h JOIN Inbound02t d
                   ON d.companyid = h.companyid AND d.receiptno = h.receiptno
                  WHERE h.companyid = %s AND h.receptdate >= %s AND h.receptdate <= %s
                  GROUP BY h.receptdate
                 UNION ALL
                 SELECT h.receptdate AS transaction_date, 0::numeric AS purchase_amount,
                        SUM(d.unitamt) AS sales_amount
                 FROM Outbound01t h JOIN Outbound02t d
                   ON d.companyid = h.companyid AND d.receiptno = h.receiptno
                 WHERE h.companyid = %s AND h.receptdate >= %s AND h.receptdate <= %s
                 GROUP BY h.receptdate
               ) transactions
               GROUP BY transaction_date ORDER BY transaction_date""",
            (companyid, chart_from, today, companyid, chart_from, today),
        )

        monthly_trend_rows = _dashboard_rows(
            cursor,
            """SELECT month_date,
                      SUM(purchase_amount) AS purchase_amount,
                      SUM(sales_amount) AS sales_amount
               FROM (
                  SELECT date_trunc('month', h.receptdate)::date AS month_date,
                        SUM(d.unitamt) AS purchase_amount, 0::numeric AS sales_amount
                 FROM Inbound01t h JOIN Inbound02t d
                   ON d.companyid = h.companyid AND d.receiptno = h.receiptno
                  WHERE h.companyid = %s AND h.receptdate >= %s AND h.receptdate <= %s
                  GROUP BY date_trunc('month', h.receptdate)::date
                 UNION ALL
                 SELECT date_trunc('month', h.receptdate)::date AS month_date,
                        0::numeric AS purchase_amount, SUM(d.unitamt) AS sales_amount
                 FROM Outbound01t h JOIN Outbound02t d
                   ON d.companyid = h.companyid AND d.receiptno = h.receiptno
                 WHERE h.companyid = %s AND h.receptdate >= %s AND h.receptdate <= %s
                 GROUP BY date_trunc('month', h.receptdate)::date
               ) transactions
               GROUP BY month_date ORDER BY month_date""",
            (companyid, monthly_chart_from, today, companyid, monthly_chart_from, today),
        )

        recent_inbound = _dashboard_rows(
            cursor,
             """SELECT h.receiptno, h.receptdate,
                       STRING_AGG(DISTINCT d.customname, ', ') AS customname,
                      COUNT(d.lineno)::integer AS detail_count,
                      COALESCE(SUM(d.weight), 0) AS total_weight,
                      COALESCE(SUM(d.unitamt), 0) AS total_amount
               FROM Inbound01t h LEFT JOIN Inbound02t d
                 ON d.companyid = h.companyid AND d.receiptno = h.receiptno
               WHERE h.companyid = %s GROUP BY h.companyid, h.receiptno
                ORDER BY h.receptdate DESC, h.receiptno DESC LIMIT 5""",
            (companyid,),
        )
        recent_outbound = _dashboard_rows(
            cursor,
            """SELECT h.receiptno, h.receptdate, h.customname,
                      COUNT(d.lineno)::integer AS detail_count,
                      COALESCE(SUM(d.weight), 0) AS total_weight,
                      COALESCE(SUM(d.unitamt), 0) AS total_amount
               FROM Outbound01t h LEFT JOIN Outbound02t d
                 ON d.companyid = h.companyid AND d.receiptno = h.receiptno
               WHERE h.companyid = %s GROUP BY h.companyid, h.receiptno
               ORDER BY h.receptdate DESC, h.receiptno DESC LIMIT 5""",
            (companyid,),
        )

    current_stock_previous = current_stock - _number(stock_change_today)
    return {
        "success": True,
        "as_of": today.isoformat(),
        "kpis": {
            "current_stock_weight": current_stock,
            "month_purchase_amount": _number(month_purchase),
            "month_sales_amount": _number(month_sales),
            "month_profit_estimate": _number(month_profit_estimate),
            "changes": {
                "current_stock_weight": _change(current_stock, current_stock_previous),
                "month_purchase_amount": _change(_number(purchase_today), _number(purchase_yesterday)),
                "month_sales_amount": _change(_number(sales_today), _number(sales_yesterday)),
                "month_profit_estimate": _change(profit_by_date.get(today, 0), profit_by_date.get(yesterday, 0)),
            },
        },
        "trend": [
            {
                "date": row["transaction_date"].isoformat(),
                "purchase_amount": _number(row["purchase_amount"]),
                "sales_amount": _number(row["sales_amount"]),
            }
            for row in trend_rows
        ],
        "monthly_trend": [
            {
                "date": row["month_date"].isoformat(),
                "purchase_amount": _number(row["purchase_amount"]),
                "sales_amount": _number(row["sales_amount"]),
            }
            for row in monthly_trend_rows
        ],
        "recent_inbound": [_json_row(row) for row in recent_inbound],
        "recent_outbound": [_json_row(row) for row in recent_outbound],
    }


def _change(current, previous):
    difference = current - previous
    percent = (difference / abs(previous) * 100) if previous else None
    return {"difference": difference, "percent": percent}


def _json_row(row):
    return {
        key: value.isoformat() if hasattr(value, "isoformat") else _number(value) if isinstance(value, Decimal) else value
        for key, value in row.items()
    }


def get_dashboard_notices(companyid: str):
    # There is no notice table or notice-management feature in this project yet.
    # Tell the UI the data source is not implemented so it can show labeled preview rows.
    return {"success": True, "available": False, "items": [], "companyid": companyid}
