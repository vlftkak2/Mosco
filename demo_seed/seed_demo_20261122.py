"""시연용 데이터 입력 (2026-11-22). 기존 데이터는 건드리지 않고 새 전표만 저장 함수로 추가.
만든 전표번호는 demo_seed/created_20261122.json 에 기록 (삭제 스크립트용)."""
import sys, json, random, datetime as dt
from decimal import Decimal, ROUND_HALF_UP
sys.path.insert(0, 'c:/Mosco/backend'); sys.stdout.reconfigure(encoding='utf-8')
import db
from services.inbound import InboundRegister as IN
from services.outbound import OutboundRegister as OUT
from services.receiptpayment import ReceiptPayment as RP

random.seed(20261122)
CID, CNAME, ACTOR = "001", "모두코", "hmchoi@apr-in.com"
LOG = "c:/Mosco/demo_seed/created_20261122.json"
created = {"inbound": [], "outbound": [], "receiptpayment": []}


def save_log():
    json.dump(created, open(LOG, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


conn = db.open_connection(); cur = conn.cursor()
cur.execute("SELECT code, code_name FROM codemaster01t WHERE companyid=%s AND groupcode='WAREHOUSE' AND use_yn='Y' AND code IN ('78','88','3')", (CID,))
WH = cur.fetchall()
cur.execute("SELECT customercode, customername FROM customer01t WHERE companyid=%s AND useyn='Y'", (CID,))
CUST = dict(cur.fetchall())
conn.close()
assert WH, "창고 코드 없음"

ITEMS = [  # itemcode, itemname, 강종코드, 강종, 표면코드, 표면, 두께, 폭, 길이, kg단가
    ("29", "EGI COIL", "268", "KS-SECC", "", "", "0.800", "1140", None, 1030),
    ("138", "포스맥1.5", "280", "KS-SGMCC", "47", "고내식성강판", "0.780", "1210", None, 1340),
    ("31", "EGI SKELP", "268", "KS-SECC", "51", "내지문", "1.000", "212", None, 1080),
    ("11", "CCGI SHEET", "79", "CGCC", "58", "라미나(UP0B9A)", "0.500", "892", "1407", 1440),
    ("30", "EGI SHEET", "268", "KS-SECC", "100", "인산염", "1.200", "1025", "1752", 1150),
    ("10", "CCGI COIL", "79", "CGCC", "48", "그레이", "0.700", "1219", None, 1500),
]
SUPPLIERS = [c for c in ["Cust-00004", "Cust-00011", "Cust-00014", "Cust-00016", "Cust-00032", "Cust-00035"] if c in CUST]
BUYERS = [(c, w) for c, w in [("Cust-00008", 9), ("Cust-00006", 8), ("Cust-00012", 7), ("Cust-00005", 6), ("Cust-00007", 5),
          ("Cust-00010", 5), ("Cust-00015", 4), ("Cust-00017", 3), ("Cust-00018", 3), ("Cust-00020", 3), ("Cust-00021", 2),
          ("Cust-00022", 2), ("Cust-00026", 2), ("Cust-00027", 2), ("Cust-00028", 2), ("Cust-00029", 1), ("Cust-00033", 1)] if c in CUST]
MARKUP = {c: random.uniform(0.09, 0.19) for c, _ in BUYERS}
MARKUP["Cust-00033"] = -0.03   # 손실 거래처 1곳 (분석 화면 다양성)


def D(v, q="0.01"):
    return Decimal(str(v)).quantize(Decimal(q), rounding=ROUND_HALF_UP)


def month_days(y, m, last_day=None):
    start = dt.date(y, m, 1)
    end = dt.date(y + (m == 12), m % 12 + 1, 1) - dt.timedelta(days=1)
    if last_day:
        end = min(end, last_day)
    out = []
    d = start
    while d <= end:
        if d.weekday() < 5:
            out.append(d)
        d += dt.timedelta(days=1)
    return out


lots = []


def make_inbound(day, supplier, price_factor, n_lines):
    wcode, wname = random.choice(WH)
    items, meta = [], []
    for it in random.sample(ITEMS, n_lines):
        bundles = random.randint(4, 9)
        weight = D(bundles * random.uniform(900, 1300), "1")
        price = D(it[9] * float(price_factor) * random.uniform(0.97, 1.03), "1")
        items.append({"itemcode": it[0], "itemname": it[1], "materialcode": it[2], "materialname": it[3],
                      "surfacecode": it[4], "surfacename": it[5], "thickness": it[6], "width": it[7], "length": it[8],
                      "qtyunit": "2", "qty": bundles, "weight": str(weight), "unit": "1", "unitprice": str(price),
                      "warehousecode": wcode, "warehousecodename": wname})
        meta.append((bundles, weight, price))
    payload = IN.InboundSaveRequest(**{"is_new": True, "receptdate": day.isoformat(), "customcode": supplier,
                                       "customname": CUST[supplier], "items": items}).model_dump()
    res = IN.save_receipt(CID, CNAME, payload, actor=ACTOR)
    no = res["receiptno"]
    created["inbound"].append(no)
    for line, (b, w, p) in enumerate(meta, 1):
        lots.append({"no": no, "line": line, "date": day, "bundles": b, "weight": w, "price": p})
    return sum(w * p for _, w, p in meta)


def make_outbound(day, buyer, picks):
    items, total = [], Decimal(0)
    for lot, b in picks:
        w = lot["weight"] if b == lot["bundles"] else D(lot["weight"] / lot["bundles"] * b, "1")
        sale = D(lot["price"] * Decimal(str(1 + MARKUP[buyer] + random.uniform(-0.02, 0.02))), "1")
        items.append({"stocksourcetype": "INBOUND", "stocksourceno": lot["no"], "stocksourceline": lot["line"],
                      "qty": b, "weight": str(w), "adjweight": 0, "unit": "1", "unitprice": str(sale)})
        lot["bundles"] -= b
        lot["weight"] -= w
        total += w * sale
    payload = OUT.OutboundSaveRequest(**{"is_new": True, "receptdate": day.isoformat(), "customcode": buyer,
                                         "customname": CUST[buyer], "items": items}).model_dump()
    payload["is_new"] = True
    res = OUT.save_receipt(CID, CNAME, payload, actor=ACTOR)
    created["outbound"].append(res.get("receiptno"))
    return total


SEQ = [0]


def money(day, kind, cust, amount, instrument=False):
    amount = D(int(amount / 10000) * 10000, "1")
    if amount <= 0:
        return Decimal(0)
    SEQ[0] += 1
    if instrument:
        item = {"instrumentamt": str(amount), "instrumenttype": "ELECTRONIC", "instrumentno": f"00{day:%Y%m%d}{SEQ[0]:05d}",
                "issuercompany": CUST[cust] if kind == "RECEIPT" else CNAME, "issuekind": "OTHER" if kind == "RECEIPT" else "OWN",
                "issuedate": day.isoformat(), "maturitydate": (day + dt.timedelta(days=random.choice([60, 90, 120]))).isoformat()}
    else:
        item = {"bankamt": str(amount)}
    payload = RP.ReceiptPaymentSaveRequest(**{"receiptno": "", "receiptdate": day.isoformat(), "transactiontype": kind,
                                              "customcode": cust, "customname": CUST[cust], "items": [item]}).model_dump()
    res = RP.save_document(CID, CNAME, payload, actor=ACTOR)
    created["receiptpayment"].append(res.get("receiptno") if isinstance(res, dict) else res)
    return amount


TODAY = dt.date(2026, 11, 21)
months = [(2025, 11), (2025, 12)] + [(2026, m) for m in range(1, 12)]
ar = {c: [] for c, _ in BUYERS}
ap = {c: [] for c in SUPPLIERS}
paid_ar = {c: Decimal(0) for c, _ in BUYERS}
paid_ap = {c: Decimal(0) for c in SUPPLIERS}
for idx, (y, m) in enumerate(months):
    days = month_days(y, m, TODAY if (y, m) == (2026, 11) else None)
    factor = Decimal(str(round(1 + 0.06 * (idx / 12) + random.uniform(-0.02, 0.02), 4)))
    # 매입: 2025-11 은 사전 비축분, 이후 매출 규모에 맞춰 완만히 증가
    target_in = 190e6 if idx == 0 else (78e6 + idx * 5.5e6) * random.uniform(0.92, 1.08)
    in_total = Decimal(0)
    in_days = sorted(random.sample(days[:-2], min(len(days) - 2, 10)))
    k = 0
    while in_total < Decimal(str(target_in)):
        day = in_days[k % len(in_days)]
        k += 1
        sup = random.choice(SUPPLIERS)
        amt = make_inbound(day, sup, factor, random.randint(1, 3))
        in_total += amt
        ap[sup].append((day, amt))
    out_total = Decimal(0)
    if idx > 0:
        target_out = (95e6 + idx * 8.2e6) * random.uniform(0.93, 1.07)
        guard = 0
        while out_total < Decimal(str(target_out)) and guard < 400:
            guard += 1
            day = random.choice(days[1:])
            avail = sorted([l for l in lots if l["bundles"] > 0 and l["date"] <= day], key=lambda l: l["date"])
            if not avail:
                continue
            buyer = random.choices([c for c, _ in BUYERS], [w for _, w in BUYERS])[0]
            head = avail[:12]
            picks = [(lot, random.randint(1, lot["bundles"])) for lot in random.sample(head, min(len(head), random.randint(1, 3)))]
            amt = make_outbound(day, buyer, picks)
            out_total += amt
            ar[buyer].append((day, amt))
        # 수금: 30~45일 지난 매출의 75~100% 회수 (느린 거래처 2곳)
        for c, _ in BUYERS:
            cutoff = days[-1] - dt.timedelta(days=random.choice([30, 40, 45]))
            due = sum((a for d_, a in ar[c] if d_ <= cutoff), Decimal(0)) - paid_ar[c]
            rate = 0.35 if c in ("Cust-00029", "Cust-00028") else random.uniform(0.75, 1.0)
            if due > 1_000_000:
                paid_ar[c] += money(random.choice(days[5:]), "RECEIPT", c, due * Decimal(str(round(rate, 3))), instrument=random.random() < 0.25)
        # 지급: 25~35일 지난 매입의 80~100% 지급
        for c in SUPPLIERS:
            cutoff = days[-1] - dt.timedelta(days=random.choice([25, 35]))
            due = sum((a for d_, a in ap[c] if d_ <= cutoff), Decimal(0)) - paid_ap[c]
            if due > 1_000_000:
                paid_ap[c] += money(random.choice(days[8:]), "PAYMENT", c, due * Decimal(str(round(random.uniform(0.8, 1.0), 3))), instrument=random.random() < 0.2)
    save_log()
    print(f"{y}-{m:02d}", "매입", int(in_total), "매출", int(out_total), flush=True)
save_log()
print("done", {k: len(v) for k, v in created.items()})
