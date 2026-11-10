"""거래처원장 (메뉴: CUSTOMER_LEDGER).

원장용 테이블을 따로 두지 않고, 전표에서 바로 모아 계산한다 (전표를 고치거나 지우면 즉시 반영).

받을 돈(미수금)
  + 매출      : 매출등록 전표 (공급가 + 부가세) + 매출처 부담 기타비용 (비용여부 ≠ '예')
  - 수금      : 수금·지급 등록 '수금' 전표 (현금 + 증권 + 통장 + 카드 + 상계 + 잡손실)
줄 돈(미지급금)
  + 매입      : 매입등록 전표 (공급가 + 부가세) + 매입처 부담 기타비용 (비용여부 ≠ '예')
  + 비용      : 매입·매출 기타비용 중 비용여부 '예' → 그 기타비용의 거래처(운송사 등)에 줄 돈
  - 지급      : 수금·지급 등록 '지급' 전표 (현금 + 증권 + 통장 + 카드 + 상계 + 잡손실)

회사별 원장 시작일(company01t.ledgerstartdate)이 있으면 그날부터의 전표만 쌓고, 그 이전 잔액은
거래처 기초잔액(customer01t.openingreceivable / openingpayable)으로 본다.
"""
from datetime import date, timedelta
from decimal import Decimal

import db as _shared_db

_connect = _shared_db.connect
ZERO = Decimal("0")

# 거래처 키: 코드가 있으면 코드, 없으면(기타비용에 이름만 적은 경우) 이름으로 묶는다.
_KEY = "COALESCE(NULLIF(BTRIM({code}), ''), 'NAME:' || BTRIM(COALESCE({name}, '')))"

ENTRIES_SQL = f"""
WITH
out_items AS (
    SELECT companyid, receiptno, COUNT(*) AS cnt, SUM(COALESCE(supplyamt, 0) + COALESCE(vat, 0)) AS amt,
           (ARRAY_AGG(itemname ORDER BY lineno))[1] AS firstname
    FROM Outbound02t WHERE companyid = %(companyid)s GROUP BY companyid, receiptno
),
out_exp AS (
    SELECT companyid, receiptno, SUM(COALESCE(totalamt, 0)) AS amt
    FROM Outbound03t
    WHERE companyid = %(companyid)s AND UPPER(COALESCE(purchaseyn, 'N')) <> 'Y'
    GROUP BY companyid, receiptno
),
in_items AS (
    SELECT companyid, receiptno, COUNT(*) AS cnt, SUM(COALESCE(supplyamt, 0) + COALESCE(vat, 0)) AS amt,
           (ARRAY_AGG(itemname ORDER BY lineno))[1] AS firstname
    FROM Inbound02t WHERE companyid = %(companyid)s GROUP BY companyid, receiptno
),
in_exp AS (
    SELECT companyid, receiptno, SUM(COALESCE(totalamt, 0)) AS amt
    FROM Inbound03t
    WHERE companyid = %(companyid)s AND UPPER(COALESCE(purchaseyn, 'N')) <> 'Y'
    GROUP BY companyid, receiptno
),
rp AS (
    SELECT companyid, receiptno,
           SUM(COALESCE(cashamt, 0)) AS cashamt, SUM(COALESCE(instrumentamt, 0)) AS instrumentamt,
           SUM(COALESCE(bankamt, 0)) AS bankamt, SUM(COALESCE(cardamt, 0)) AS cardamt,
           SUM(COALESCE(offsetamt, 0)) AS offsetamt, SUM(COALESCE(lossamt, 0)) AS lossamt,
           SUM(COALESCE(chargeamt, 0)) AS chargeamt,
           COUNT(*) FILTER (WHERE COALESCE(instrumentamt, 0) > 0) AS instrumentcnt,
           (ARRAY_AGG(instrumentno ORDER BY lineno) FILTER (WHERE COALESCE(instrumentamt, 0) > 0))[1] AS instrumentno,
           (ARRAY_AGG(maturitydate ORDER BY lineno) FILTER (WHERE COALESCE(instrumentamt, 0) > 0))[1] AS maturitydate
    FROM ReceiptPayment02t WHERE companyid = %(companyid)s GROUP BY companyid, receiptno
),
entries AS (
    -- 매출 (+ 매출처 부담 기타비용)
    SELECT {_KEY.format(code='h.customcode', name='h.customname')} AS ckey, h.customcode, h.customname,
           h.receptdate AS entrydate, 1 AS kindorder, 'SALES' AS kind, h.receiptno AS docno,
           i.firstname, COALESCE(i.cnt, 0) AS cnt, COALESCE(e.amt, 0) AS extraamt,
           COALESCE(i.amt, 0) + COALESCE(e.amt, 0) AS sales, 0::numeric AS receipt, 0::numeric AS purchase, 0::numeric AS payment,
           NULL::numeric AS cashamt, NULL::numeric AS instrumentamt, NULL::numeric AS bankamt, NULL::numeric AS cardamt,
           NULL::numeric AS offsetamt, NULL::numeric AS lossamt, NULL::numeric AS chargeamt,
           NULL::bigint AS instrumentcnt, NULL::varchar AS instrumentno, NULL::date AS maturitydate, h.description
    FROM Outbound01t h
    LEFT JOIN out_items i ON i.companyid = h.companyid AND i.receiptno = h.receiptno
    LEFT JOIN out_exp e ON e.companyid = h.companyid AND e.receiptno = h.receiptno
    WHERE h.companyid = %(companyid)s
    UNION ALL
    -- 매입 (+ 매입처 부담 기타비용)
    SELECT {_KEY.format(code='h.customcode', name='h.customname')}, h.customcode, h.customname,
           h.receptdate, 3, 'PURCHASE', h.receiptno,
           i.firstname, COALESCE(i.cnt, 0), COALESCE(e.amt, 0),
           0, 0, COALESCE(i.amt, 0) + COALESCE(e.amt, 0), 0,
           NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, h.description
    FROM Inbound01t h
    LEFT JOIN in_items i ON i.companyid = h.companyid AND i.receiptno = h.receiptno
    LEFT JOIN in_exp e ON e.companyid = h.companyid AND e.receiptno = h.receiptno
    WHERE h.companyid = %(companyid)s
    UNION ALL
    -- 기타비용 비용여부 '예' → 그 거래처에 줄 돈 (매출 전표·매입 전표 모두)
    SELECT {_KEY.format(code='x.customcode', name='x.customname')}, MAX(x.customcode), MAX(x.customname),
           h.receptdate, 4, 'COST', h.receiptno,
           (ARRAY_AGG(x.costname ORDER BY x.lineno))[1], COUNT(*), 0,
           0, 0, SUM(COALESCE(x.totalamt, 0)), 0,
           NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
           CASE WHEN x.src = 'OUT' THEN '매출 ' ELSE '매입 ' END || h.receiptno
    FROM (
        SELECT 'OUT' AS src, companyid, receiptno, lineno, customcode, customname, costname, totalamt, purchaseyn FROM Outbound03t
        UNION ALL
        SELECT 'IN', companyid, receiptno, lineno, customcode, customname, costname, totalamt, purchaseyn FROM Inbound03t
    ) x
    JOIN (
        SELECT 'OUT' AS src, companyid, receiptno, receptdate FROM Outbound01t
        UNION ALL
        SELECT 'IN', companyid, receiptno, receptdate FROM Inbound01t
    ) h ON h.src = x.src AND h.companyid = x.companyid AND h.receiptno = x.receiptno
    WHERE x.companyid = %(companyid)s AND UPPER(COALESCE(x.purchaseyn, 'N')) = 'Y'
      AND (NULLIF(BTRIM(x.customcode), '') IS NOT NULL OR NULLIF(BTRIM(x.customname), '') IS NOT NULL)
    GROUP BY 1, h.receptdate, h.receiptno, x.src
    UNION ALL
    -- 수금 / 지급
    SELECT {_KEY.format(code='h.customcode', name='h.customname')}, h.customcode, h.customname,
           h.receiptdate, CASE WHEN h.transactiontype = 'RECEIPT' THEN 2 ELSE 5 END, h.transactiontype, h.receiptno,
           NULL, 0, 0,
           0,
           CASE WHEN h.transactiontype = 'RECEIPT' THEN r.cashamt + r.instrumentamt + r.bankamt + r.cardamt + r.offsetamt + r.lossamt ELSE 0 END,
           0,
           CASE WHEN h.transactiontype = 'PAYMENT' THEN r.cashamt + r.instrumentamt + r.bankamt + r.cardamt + r.offsetamt + r.lossamt ELSE 0 END,
           r.cashamt, r.instrumentamt, r.bankamt, r.cardamt, r.offsetamt, r.lossamt, r.chargeamt,
           r.instrumentcnt, r.instrumentno, r.maturitydate, h.description
    FROM ReceiptPayment01t h
    JOIN rp r ON r.companyid = h.companyid AND r.receiptno = h.receiptno
    WHERE h.companyid = %(companyid)s AND h.transactiontype IN ('RECEIPT', 'PAYMENT')
)
"""

KIND_NAMES = {"SALES": "매출", "RECEIPT": "수금", "PURCHASE": "매입", "PAYMENT": "지급", "COST": "비용"}


def _num(value) -> Decimal:
    return Decimal(str(value)) if value is not None else ZERO


def _money(value) -> str:
    return f"{_num(value):,.0f}"


def _summary(row: dict) -> str:
    kind = row["kind"]
    if kind in ("SALES", "PURCHASE", "COST"):
        name = str(row.get("firstname") or "").strip()
        count = int(row.get("cnt") or 0)
        if kind == "COST":
            text = f"{name or '기타비용'}{f' 외 {count - 1}건' if count > 1 else ''} ({row.get('description') or ''})"
            return text.replace(' ()', '')
        text = f"{name}{f' 외 {count - 1}건' if count > 1 else ''}" if name else "(품목 없음)"
        if _num(row.get("extraamt")) > 0:
            text += f" + 기타비용 {_money(row['extraamt'])}"
        return text
    parts = []
    for field, label in (("cashamt", "현금"), ("bankamt", "통장"), ("cardamt", "카드"), ("offsetamt", "상계"), ("lossamt", "잡손실")):
        if _num(row.get(field)) > 0:
            parts.append(f"{label} {_money(row[field])}")
    if _num(row.get("instrumentamt")) > 0:
        detail = str(row.get("instrumentno") or "").strip()
        maturity = row.get("maturitydate")
        extra = ", ".join(filter(None, [detail, f"만기 {maturity}" if maturity else ""]))
        count = int(row.get("instrumentcnt") or 0)
        more = f" 외 {count - 1}장" if count > 1 else ""
        parts.insert(1, f"증권 {_money(row['instrumentamt'])}{f' ({extra}{more})' if extra or more else ''}")
    if _num(row.get("chargeamt")) > 0:
        parts.append(f"과금 {_money(row['chargeamt'])}")
    return " · ".join(parts)


def _row_dict(cursor, row):
    return dict(zip((column[0] for column in cursor.description), row))


def get_settings(companyid: str) -> dict:
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute("SELECT ledgerstartdate FROM company01t WHERE companyid = %s", (companyid,))
        row = cursor.fetchone()
    return {"ledgerstartdate": row[0] if row else None}


def update_start_date(companyid: str, start: date | None, actor: str) -> dict:
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            "UPDATE company01t SET ledgerstartdate = %s, updatedat = NOW(), updated_by = %s WHERE companyid = %s",
            (start, actor or None, companyid),
        )
    return get_settings(companyid)


def _effective_from(start: date | None, date_from: date) -> date:
    return max(start, date_from) if start else date_from


def list_balances(companyid: str, date_from: date, date_to: date, keyword: str = "", balance_only: bool = False) -> dict:
    """거래처별 기초 · 기간 증감 · 기말 잔액."""
    start = get_settings(companyid)["ledgerstartdate"]
    params = {"companyid": companyid, "start": start, "date_from": date_from, "date_to": date_to,
              "keyword": f"%{keyword.strip().lower()}%"}
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            ENTRIES_SQL + """,
            scoped AS (
                SELECT * FROM entries
                WHERE (%(start)s::date IS NULL OR entrydate >= %(start)s::date) AND entrydate <= %(date_to)s
            ),
            moves AS (
                SELECT ckey, MAX(customcode) AS customcode, MAX(customname) AS customname,
                       SUM(sales - receipt) FILTER (WHERE entrydate < %(date_from)s) AS recv_before,
                       SUM(purchase - payment) FILTER (WHERE entrydate < %(date_from)s) AS pay_before,
                       SUM(sales) FILTER (WHERE entrydate >= %(date_from)s) AS sales,
                       SUM(receipt) FILTER (WHERE entrydate >= %(date_from)s) AS receipt,
                       SUM(purchase) FILTER (WHERE entrydate >= %(date_from)s) AS purchase,
                       SUM(payment) FILTER (WHERE entrydate >= %(date_from)s) AS payment
                FROM scoped GROUP BY ckey
            ),
            customers AS (
                SELECT customercode AS ckey, customercode, customername,
                       COALESCE(openingreceivable, 0) AS openingreceivable, COALESCE(openingpayable, 0) AS openingpayable
                FROM customer01t WHERE companyid = %(companyid)s
            )
            SELECT COALESCE(c.ckey, m.ckey) AS ckey,
                   COALESCE(c.customercode, m.customcode, '') AS customcode,
                   COALESCE(c.customername, m.customname, '') AS customname,
                   COALESCE(c.openingreceivable, 0) + COALESCE(m.recv_before, 0) AS recv_open,
                   COALESCE(m.sales, 0) AS sales, COALESCE(m.receipt, 0) AS receipt,
                   COALESCE(c.openingpayable, 0) + COALESCE(m.pay_before, 0) AS pay_open,
                   COALESCE(m.purchase, 0) AS purchase, COALESCE(m.payment, 0) AS payment
            FROM customers c
            FULL OUTER JOIN moves m ON m.ckey = c.ckey
            WHERE (%(keyword)s = '%%%%' OR LOWER(COALESCE(c.customercode, m.customcode, '')) LIKE %(keyword)s
                   OR LOWER(COALESCE(c.customername, m.customname, '')) LIKE %(keyword)s)
            ORDER BY 3, 2""",
            params,
        )
        rows = [_row_dict(cursor, row) for row in cursor.fetchall()]
    result = []
    totals = {key: ZERO for key in ("recv_open", "sales", "receipt", "recv_close", "pay_open", "purchase", "payment", "pay_close")}
    for row in rows:
        row["recv_close"] = _num(row["recv_open"]) + _num(row["sales"]) - _num(row["receipt"])
        row["pay_close"] = _num(row["pay_open"]) + _num(row["purchase"]) - _num(row["payment"])
        values = [row[key] for key in totals]
        if not any(_num(value) for value in values):
            continue  # 기초도 거래도 없는 거래처는 목록에서 뺀다
        if balance_only and not (_num(row["recv_close"]) or _num(row["pay_close"])):
            continue
        for key in totals:
            totals[key] += _num(row[key])
        result.append(row)
    return {"items": result, "totals": totals, "ledgerstartdate": start}


def get_ledger(companyid: str, ckey: str, date_from: date, date_to: date) -> dict:
    """한 거래처의 원장: 이월 잔액 + 기간 내 전표 (일자순) + 미수·미지급 잔액 누계."""
    start = get_settings(companyid)["ledgerstartdate"]
    params = {"companyid": companyid, "ckey": ckey, "start": start, "date_from": date_from, "date_to": date_to}
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """SELECT customercode, customername, COALESCE(openingreceivable, 0), COALESCE(openingpayable, 0)
               FROM customer01t WHERE companyid = %s AND customercode = %s""",
            (companyid, ckey),
        )
        customer = cursor.fetchone()
        cursor.execute(
            ENTRIES_SQL + """
            SELECT * FROM entries
            WHERE ckey = %(ckey)s AND (%(start)s::date IS NULL OR entrydate >= %(start)s::date) AND entrydate <= %(date_to)s
            ORDER BY entrydate, kindorder, docno""",
            params,
        )
        rows = [_row_dict(cursor, row) for row in cursor.fetchall()]
    recv = _num(customer[2]) if customer else ZERO
    pay = _num(customer[3]) if customer else ZERO
    name = customer[1] if customer else (rows[0]["customname"] if rows else "")
    lines = []
    for row in rows:
        if row["entrydate"] < date_from:
            recv += _num(row["sales"]) - _num(row["receipt"])
            pay += _num(row["purchase"]) - _num(row["payment"])
    # 이월 = 거래처관리 기초잔액(base) + 시작일~조회 시작 전 거래 (화면에서 둘을 나눠 보여준다)
    opening = {"recv": recv, "pay": pay, "base_recv": _num(customer[2]) if customer else ZERO, "base_pay": _num(customer[3]) if customer else ZERO}
    for row in rows:
        if row["entrydate"] < date_from:
            continue
        recv += _num(row["sales"]) - _num(row["receipt"])
        pay += _num(row["purchase"]) - _num(row["payment"])
        lines.append({
            "entrydate": row["entrydate"], "kind": row["kind"], "kindname": KIND_NAMES.get(row["kind"], row["kind"]),
            "docno": row["docno"], "summary": _summary(row), "description": row["description"] if row["kind"] != "COST" else "",
            "sales": row["sales"], "receipt": row["receipt"], "recv_balance": recv,
            "purchase": row["purchase"], "payment": row["payment"], "pay_balance": pay,
        })
    totals = {key: sum((_num(line[key]) for line in lines), ZERO) for key in ("sales", "receipt", "purchase", "payment")}
    return {
        "customer": {"ckey": ckey, "customcode": customer[0] if customer else ("" if ckey.startswith("NAME:") else ckey), "customname": name},
        "ledgerstartdate": start, "opening": opening, "lines": lines, "totals": totals,
        "closing": {"recv": recv, "pay": pay},
    }


# ---------------------------------------------------------------------------
# 거래처 잔액 현황 (메뉴: CUSTOMER_BALANCE_DASHBOARD)
# 원장과 같은 전표 집계(ENTRIES_SQL)를 쓰므로 숫자가 거래처원장과 항상 같다.
# ---------------------------------------------------------------------------
AGING_BUCKETS = [("d30", "30일 이내", 0, 30), ("d60", "31~60일", 31, 60), ("d90", "61~90일", 61, 90), ("over90", "90일 초과", 91, None)]


def _month_start(value: date) -> date:
    return value.replace(day=1)


def _add_months(value: date, months: int) -> date:
    index = value.year * 12 + value.month - 1 + months
    return date(index // 12, index % 12 + 1, 1)


def dashboard(companyid: str, as_of: date, top_n: int = 10) -> dict:
    """기준일 시점의 회사 전체 받을 돈 / 줄 돈 현황."""
    start = get_settings(companyid)["ledgerstartdate"]
    params = {"companyid": companyid, "start": start, "as_of": as_of}
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            ENTRIES_SQL + """
            SELECT ckey, customcode, customname, entrydate, kind, docno, sales, receipt, purchase, payment
            FROM entries
            WHERE (%(start)s::date IS NULL OR entrydate >= %(start)s::date) AND entrydate <= %(as_of)s
            ORDER BY entrydate, kindorder, docno""",
            params,
        )
        entries = [_row_dict(cursor, row) for row in cursor.fetchall()]
        cursor.execute(
            """SELECT customercode, customername, COALESCE(openingreceivable, 0), COALESCE(openingpayable, 0)
               FROM customer01t WHERE companyid = %s""",
            (companyid,),
        )
        customers = {code: {"name": name, "recv": _num(recv), "pay": _num(pay)} for code, name, recv, pay in cursor.fetchall()}

    book = {}

    def account(ckey, code="", name=""):
        if ckey not in book:
            base = customers.get(ckey, {})
            book[ckey] = {
                "ckey": ckey, "customcode": code or ("" if ckey.startswith("NAME:") else ckey),
                "customname": base.get("name") or name or "",
                "opening_recv": base.get("recv", ZERO), "opening_pay": base.get("pay", ZERO),
                "recv": base.get("recv", ZERO), "pay": base.get("pay", ZERO),
                "debits": [], "credit": ZERO, "last": None,
            }
        return book[ckey]

    for ckey, info in customers.items():
        if info["recv"] or info["pay"]:
            account(ckey)

    month_from = _add_months(_month_start(as_of), -11)
    months = {}
    for offset in range(12):
        key = _add_months(month_from, offset)
        months[key] = {"month": key.strftime("%Y-%m"), "sales": ZERO, "receipt": ZERO, "purchase": ZERO, "payment": ZERO}

    for row in entries:
        acc = account(row["ckey"], row["customcode"], row["customname"])
        sales, receipt, purchase, payment = (_num(row[k]) for k in ("sales", "receipt", "purchase", "payment"))
        acc["recv"] += sales - receipt
        acc["pay"] += purchase - payment
        acc["last"] = row["entrydate"]
        if sales:
            acc["debits"].append([row["entrydate"], sales])
        acc["credit"] += receipt
        bucket = months.get(_month_start(row["entrydate"]))
        if bucket:
            bucket["sales"] += sales
            bucket["receipt"] += receipt
            bucket["purchase"] += purchase
            bucket["payment"] += payment

    # 월말 잔액 추이: 요약 카드와 같은 기준 (거래처별 잔액 중 0보다 큰 것만 더한다 = 선수·선급은 빼고)
    month_ends = [(_add_months(key, 1) - timedelta(days=1), key) for key in sorted(months)]
    running = {ckey: [acc["opening_recv"], acc["opening_pay"]] for ckey, acc in book.items()}
    trend = []
    index = 0
    for month_end, key in month_ends:
        while index < len(entries) and entries[index]["entrydate"] <= month_end:
            row = entries[index]
            balance = running.setdefault(row["ckey"], [ZERO, ZERO])
            balance[0] += _num(row["sales"]) - _num(row["receipt"])
            balance[1] += _num(row["purchase"]) - _num(row["payment"])
            index += 1
        trend.append({**months[key],
                      "recv_balance": sum((v[0] for v in running.values() if v[0] > 0), ZERO),
                      "pay_balance": sum((v[1] for v in running.values() if v[1] > 0), ZERO)})

    # 미수금 경과 기간 (선입선출): 수금은 가장 오래된 매출(기초잔액 포함)부터 갚은 것으로 본다.
    aging = {key: ZERO for key, *_ in AGING_BUCKETS}
    aging["unknown"] = ZERO  # 원장 시작일이 없을 때의 기초잔액 (언제 생긴 돈인지 모름)
    overdue = []
    for acc in book.values():
        debits = []
        if acc["opening_recv"] > 0:
            debits.append([start, acc["opening_recv"]])  # 원장 시작일이 없으면 날짜 미상
        debits.extend(acc["debits"])
        remaining_credit = acc["credit"]
        per = {key: ZERO for key in aging}
        for debit_date, amount in debits:
            used = min(amount, remaining_credit)
            remaining_credit -= used
            left = amount - used
            if left <= 0:
                continue
            if debit_date is None:
                per["unknown"] += left
                continue
            days = (as_of - debit_date).days
            for key, _label, low, high in AGING_BUCKETS:
                if days >= low and (high is None or days <= high):
                    per[key] += left
                    break
        for key in aging:
            aging[key] += per[key]
        late = per["d60"] + per["d90"] + per["over90"]
        if late > 0:
            overdue.append({"ckey": acc["ckey"], "customcode": acc["customcode"], "customname": acc["customname"],
                            "recv": acc["recv"], "over30": late, "over90": per["over90"]})

    accounts = list(book.values())
    recv_pos = sum((a["recv"] for a in accounts if a["recv"] > 0), ZERO)
    pay_pos = sum((a["pay"] for a in accounts if a["pay"] > 0), ZERO)
    this_month = months.get(_month_start(as_of), {})

    def top(field):
        rows = sorted((a for a in accounts if a[field] > 0), key=lambda a: a[field], reverse=True)[:top_n]
        return [{"ckey": a["ckey"], "customcode": a["customcode"], "customname": a["customname"], "amount": a[field]} for a in rows]

    attention = []
    for a in accounts:
        if a["recv"] < 0:
            attention.append(("선수금", "매출보다 " + _money(-a["recv"]) + "원 더 수금", a))
        if a["pay"] < 0:
            attention.append(("선급금", "매입보다 " + _money(-a["pay"]) + "원 더 지급", a))
        if (a["recv"] > 0 or a["pay"] > 0) and (a["last"] is None or (as_of - a["last"]).days > 90):
            attention.append(("장기 미정리", "90일 넘게 거래 없이 잔액이 남아 있음" if a["last"] else "기초잔액만 남아 있음", a))
    attention_rows = [{"ckey": a["ckey"], "customcode": a["customcode"], "customname": a["customname"],
                       "kind": kind, "text": text, "recv": a["recv"], "pay": a["pay"], "last": a["last"]}
                      for kind, text, a in attention]

    return {
        "as_of": as_of, "ledgerstartdate": start,
        "summary": {
            "receivable": recv_pos, "payable": pay_pos, "net": recv_pos - pay_pos,
            "receivable_customers": sum(1 for a in accounts if a["recv"] > 0),
            "payable_customers": sum(1 for a in accounts if a["pay"] > 0),
            "month_receipt": this_month.get("receipt", ZERO), "month_payment": this_month.get("payment", ZERO),
            "month_sales": this_month.get("sales", ZERO), "month_purchase": this_month.get("purchase", ZERO),
        },
        "top_receivable": top("recv"), "top_payable": top("pay"),
        "trend": trend,
        "aging": [{"key": key, "label": label, "amount": aging[key]} for key, label, *_ in AGING_BUCKETS]
                 + ([{"key": "unknown", "label": "기초잔액(날짜 미상)", "amount": aging["unknown"]}] if aging["unknown"] else []),
        "overdue": sorted(overdue, key=lambda r: r["over30"], reverse=True)[:top_n],
        "attention": sorted(attention_rows, key=lambda r: (r["kind"], -abs(r["recv"] or r["pay"])))[:30],
    }
