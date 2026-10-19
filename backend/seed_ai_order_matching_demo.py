"""One-time, identifiable inbound demo for company 001's confirmed ET order.

Run from backend: python seed_ai_order_matching_demo.py
The inbound register service creates its receipt, stock and movement together.
"""

import psycopg2

from config import DB_CONFIG
from InboundRegister import save_receipt


COMPANY_ID = "001"
ORDER_ID = "AI2026101900001"
DEMO_CUSTOMER = "AI-DEMO"
MARKER = "AI 주문 재고매칭 예시"
SAMPLES = [
    ("AI-DEMO-ET-S55", "ET SHEET", "0.6 X 55", 100, 480),
    ("AI-DEMO-ET-K78", "ET SKELP", "0.6 X 78", 80, 520),
    ("AI-DEMO-ET-C500", "ET COIL", "0.6 X 500", 5, 2500),
    ("AI-DEMO-ET-S220", "ET SHEET", "0.6 X 220", 60, 840),
    ("AI-DEMO-ET-C055", "ET COIL", "0.64 X 55", 15, 400),
    ("AI-DEMO-ET-NONE", "ET COIL", "", 3, 900),
    ("AI-DEMO-ET-C070", "ET COIL", "0.7 X 500", 4, 1900),
]


def main():
    params = dict(host=DB_CONFIG["host"], port=DB_CONFIG["port"], dbname=DB_CONFIG["database"],
                  user=DB_CONFIG["user"], password=DB_CONFIG["password"], connect_timeout=5)
    with psycopg2.connect(**params) as conn, conn.cursor() as cur:
        cur.execute("SELECT companyname FROM aiorder01t WHERE companyid=%s AND orderid=%s", (COMPANY_ID, ORDER_ID))
        order = cur.fetchone()
        if order is None:
            raise RuntimeError("대상 확정 주문이 없어 예시 입고를 생성하지 않았습니다.")
        companyname = order[0]
        cur.execute("SELECT receiptno FROM inbound01t WHERE companyid=%s AND description=%s", (COMPANY_ID, MARKER))
        existing = cur.fetchone()
        if existing:
            print(f"기존 예시 입고전표: {existing[0]}")
            return
        cur.execute("""
            INSERT INTO customer01t (companyid, companyname, customercode, customername, useyn, remark)
            VALUES (%s, %s, %s, %s, 'Y', %s)
            ON CONFLICT (companyid, customercode) DO NOTHING
        """, (COMPANY_ID, companyname, DEMO_CUSTOMER, "AI 재고매칭 예시 거래처", MARKER))
        for code, name, *_ in SAMPLES:
            cur.execute("""
                INSERT INTO itemcode01t (companyid, companyname, itemcode, itemname, use_yn, description)
                VALUES (%s, %s, %s, %s, 'Y', %s)
                ON CONFLICT (companyid, itemcode) DO NOTHING
            """, (COMPANY_ID, companyname, code, name, MARKER))

    payload = {
        "is_new": True,
        "receptdate": "2026-10-19",
        "customcode": DEMO_CUSTOMER,
        "customname": "AI 재고매칭 예시 거래처",
        "description": MARKER,
        "items": [
            {"itemcode": code, "itemname": name, "size": size, "qty": qty, "qtyunit": "1",
             "warehousecode": "00", "weight": weight, "unit": "1", "unitprice": "1",
             "description": f"{MARKER} · {code}"}
            for code, name, size, qty, weight in SAMPLES
        ],
    }
    result = save_receipt(COMPANY_ID, companyname, payload)
    print(f"예시 입고전표 {result['receiptno']} · {result['saved_count']}행 생성")


if __name__ == "__main__":
    main()
