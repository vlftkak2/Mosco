"""시연용 2단계: 기존 + 시연 전표 전체 기준으로 월별 수금 · 지급을 추가해 채권 · 채무 잔액을 정상 수준(약 1~1.5개월분)으로 맞춤.
만든 전표번호는 created_20261122.json 의 receiptpayment 에 이어서 기록."""
import sys, json, random, datetime as dt
from decimal import Decimal
sys.path.insert(0, 'c:/Mosco/backend'); sys.stdout.reconfigure(encoding='utf-8')
import db
from services.receiptpayment import ReceiptPayment as RP

random.seed(1122)
CID, CNAME, ACTOR = "001", "모두코", "hmchoi@apr-in.com"
LOG = "c:/Mosco/demo_seed/created_20261122.json"
created = json.load(open(LOG, encoding="utf-8"))
SLOW = {"Cust-00029", "Cust-00028"}   # 느린 거래처 (연체 구간 표시용)

conn = db.open_connection(); cur = conn.cursor()
cur.execute("SELECT customercode, customername, COALESCE(openingreceivable,0), COALESCE(openingpayable,0) FROM customer01t WHERE companyid=%s AND useyn='Y'", (CID,))
CUST = {r[0]: r for r in cur.fetchall()}


def events(sql):
    cur.execute(sql, (CID,))
    out = {}
    for code, day, amt in cur.fetchall():
        if code in CUST:
            out.setdefault(code, []).append((day, Decimal(amt or 0)))
    return out


sales = events("""SELECT h.customcode, h.receptdate, SUM(d.supplyamt) FROM outbound01t h JOIN outbound02t d USING(companyid, receiptno)
                  WHERE h.companyid=%s GROUP BY 1, 2""")
purch = events("""SELECT h.customcode, h.receptdate, SUM(d.supplyamt) FROM inbound01t h JOIN inbound02t d USING(companyid, receiptno)
                  WHERE h.companyid=%s GROUP BY 1, 2""")
cur.execute("""SELECT h.customcode, h.transactiontype, h.receiptdate, SUM(d.totalamt + COALESCE(d.offsetamt,0)) FROM receiptpayment01t h
               JOIN receiptpayment02t d USING(companyid, receiptno) WHERE h.companyid=%s GROUP BY 1, 2, 3""", (CID,))
paid = {"RECEIPT": {}, "PAYMENT": {}}
for code, kind, day, amt in cur.fetchall():
    paid[kind].setdefault(code, []).append((day, Decimal(amt or 0)))
conn.close()


def weekdays(y, m, last=None):
    d = dt.date(y, m, 1)
    end = dt.date(y + (m == 12), m % 12 + 1, 1) - dt.timedelta(days=1)
    end = min(end, last) if last else end
    out = []
    while d <= end:
        if d.weekday() < 5:
            out.append(d)
        d += dt.timedelta(days=1)
    return out


SEQ = [500]


def money(day, kind, code, amount, instrument):
    amount = Decimal(int(amount / 10000) * 10000)
    if amount < 500000:
        return Decimal(0)
    SEQ[0] += 1
    name = CUST[code][1]
    if instrument:
        item = {"instrumentamt": str(amount), "instrumenttype": "ELECTRONIC", "instrumentno": f"00{day:%Y%m%d}{SEQ[0]:05d}",
                "issuercompany": name if kind == "RECEIPT" else CNAME, "issuekind": "OTHER" if kind == "RECEIPT" else "OWN",
                "issuedate": day.isoformat(), "maturitydate": (day + dt.timedelta(days=random.choice([60, 90]))).isoformat()}
    else:
        item = {"bankamt": str(amount)}
    payload = RP.ReceiptPaymentSaveRequest(**{"receiptno": "", "receiptdate": day.isoformat(), "transactiontype": kind,
                                              "customcode": code, "customname": name, "items": [item]}).model_dump()
    res = RP.save_document(CID, CNAME, payload, actor=ACTOR)
    created["receiptpayment"].append(res.get("receiptno") if isinstance(res, dict) else res)
    return amount


TODAY = dt.date(2026, 11, 21)
months = [(2025, 12)] + [(2026, m) for m in range(1, 12)]
totals = {"RECEIPT": Decimal(0), "PAYMENT": Decimal(0)}
for kind, book, opening_idx, lag, (lo, hi) in (("RECEIPT", sales, 2, 35, (0.92, 1.0)), ("PAYMENT", purch, 3, 30, (0.93, 1.0))):
    for code, rows in book.items():
        done = paid[kind].get(code, [])
        for y, m in months:
            days = weekdays(y, m, TODAY if (y, m) == (2026, 11) else None)
            pay_day = random.choice(days[-12:])
            cutoff = pay_day - dt.timedelta(days=lag)
            owed = CUST[code][opening_idx] + sum((a for d_, a in rows if d_ <= cutoff), Decimal(0))
            settled = sum((a for d_, a in done if d_ <= pay_day), Decimal(0))
            due = owed - settled
            if due <= 1_000_000:
                continue
            rate = 0.45 if code in SLOW else random.uniform(lo, hi)
            amt = money(pay_day, kind, code, due * Decimal(str(round(rate, 3))), instrument=random.random() < 0.2)
            if amt:
                done = done + [(pay_day, amt)]
                totals[kind] += amt
    json.dump(created, open(LOG, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(kind, "추가", int(totals[kind]), flush=True)
print("전표 수", {k: len(v) for k, v in created.items()})
