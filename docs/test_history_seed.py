"""가공 최적화 '과거 매입이력 · 과거 가공이력' 확인용 TEST 전표.

기준: 계획 PL2026111500001 (TIN PLATE 0.6T, 원자재 82mm, 로스 4mm, 주문 폭 55mm, 창고 신영정밀금속)
  - 전표번호: 매입 TESTIN…, 가공 PRTEST… (가공번호는 PR 로 시작해야 함) (inbound01t/02t, process01t/02t 만 씀)
  - 현재고(currentstock01t) · 매출 · 회계 테이블은 건드리지 않음

사용:  python docs/test_history_seed.py insert   # 넣기 (이미 있으면 지우고 다시)
       python docs/test_history_seed.py delete   # 지우기
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
import db  # noqa: E402

CO, CONAME, ACTOR = "001", "모스코", "TEST"
ITEM = {"itemcode": "87", "itemname": "TIN PLATE", "materialcode": "537", "materialname": "일반"}
WH = ("74", "신영정밀금속")

# 과거 매입이력: (전표, 일자, 매입처코드, 매입처, [(두께, 폭, 개수, 중량, 단가)])
INBOUND = [
    ("TESTIN2026111501", "2026-10-20", "Cust-00012", "(주)대림스틸", [(0.6, 170, 1, 480, 1850), (0.6, 82, 1, 130, 1850)]),
    ("TESTIN2026111502", "2026-09-12", "Cust-00008", "(주)금강강업", [(0.6, 120, 1, 350, 1820)]),
    ("TESTIN2026111503", "2026-08-03", "Cust-00007", "(주)국보디자인", [(0.5, 170, 1, 400, 1790)]),   # 두께 상이 예시
]
# 과거 가공이력: (전표, 일자, 원자재(두께, 폭, 개수, 중량), [제품(폭, 개수, 중량)])
PROCESS = [
    ("PRTEST2026111501", "2026-10-25", (0.6, 82, 1, 140), [(55, 1, 93), (20, 1, 33)]),   # 55+20+로스4 = 79 ≤ 82 → 적용 가능 (혼합)
    ("PRTEST2026111502", "2026-09-30", (0.6, 82, 1, 135), [(38, 2, 125)]),              # 38×2+4 = 80 ≤ 82 → 적용 가능
    ("PRTEST2026111503", "2026-08-15", (0.6, 170, 1, 470), [(55, 3, 455)]),             # 55×3+4 = 169 > 82 → 폭 초과 예시
]


def delete(cur):
    for t in ("inbound02t", "inbound01t"):
        cur.execute(f"DELETE FROM {t} WHERE companyid=%s AND receiptno LIKE 'TEST%%'", (CO,))
    for t in ("process02t", "process01t"):
        cur.execute(f"DELETE FROM {t} WHERE companyid=%s AND processno LIKE 'PRTEST%%'", (CO,))


def insert(cur):
    for no, date, ccode, cname, lines in INBOUND:
        cur.execute("""INSERT INTO inbound01t (companyid, companyname, receiptno, receptdate, customcode, customname, description, subulyn, created_by)
                       VALUES (%s,%s,%s,%s,%s,%s,'[TEST] 가공최적화 이력 확인용','N',%s)""", (CO, CONAME, no, date, ccode, cname, ACTOR))
        for i, (t, w, q, kg, price) in enumerate(lines, start=1):
            supply = kg * price
            cur.execute("""INSERT INTO inbound02t (companyid, companyname, receiptno, lineno, itemcode, itemname, materialcode, materialname,
                               thickness, width, length, qty, qtyunit, weight, unit, unitprice, supplyamt, vat, unitamt,
                               warehousecode, warehousecodename, description, created_by)
                           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,NULL,%s,'1',%s,'1',%s,%s,%s,%s,%s,%s,'[TEST]',%s)""",
                        (CO, CONAME, no, i, ITEM["itemcode"], ITEM["itemname"], ITEM["materialcode"], ITEM["materialname"],
                         t, w, q, kg, price, supply, supply * 0.1, supply * 1.1, WH[0], WH[1], ACTOR))
    for index, (no, date, (t, w, q, kg), products) in enumerate(PROCESS):
        source_no = INBOUND[min(index, len(INBOUND) - 1)][0]   # 원자재 원천 = TEST 매입 전표 (형식상)
        cur.execute("""INSERT INTO process01t (companyid, companyname, processno, processdate, customcode, customname, warehousecode, warehousecodename,
                           subulyn, description, created_by)
                       VALUES (%s,%s,%s,%s,'Cust-00001','(주)모스코',%s,%s,'N','[TEST] 가공최적화 이력 확인용',%s)""",
                    (CO, CONAME, no, date, WH[0], WH[1], ACTOR))
        cur.execute("""INSERT INTO process02t (companyid, companyname, processno, lineno, linetype, levelno, parentlineno, sourcelineno,
                           stocksourcetype, stocksourceno, stocksourceline,
                           sourcewarehousecode, sourcewarehousecodename, itemcode, itemname, materialcode, materialname,
                           thickness, width, length, qty, qtyunit, weight, unit, description, created_by)
                       VALUES (%s,%s,%s,1,'SOURCE',0,NULL,1,'INBOUND',%s,1,%s,%s,%s,%s,%s,%s,%s,%s,0,%s,'EA',%s,'Kg','[TEST]',%s)""",
                    (CO, CONAME, no, source_no, WH[0], WH[1], ITEM["itemcode"], ITEM["itemname"], ITEM["materialcode"], ITEM["materialname"], t, w, q, kg, ACTOR))
        for i, (pw, pq, pkg) in enumerate(products, start=2):
            cur.execute("""INSERT INTO process02t (companyid, companyname, processno, lineno, linetype, levelno, parentlineno, sourcelineno,
                               itemcode, itemname, materialcode, materialname, thickness, width, length, qty, qtyunit, weight, unit,
                               processid, processcodename, description, created_by)
                           VALUES (%s,%s,%s,%s,'PRODUCT',1,1,1,%s,%s,%s,%s,%s,%s,0,%s,'1',%s,'KG','1','등분','[TEST]',%s)""",
                        (CO, CONAME, no, i, ITEM["itemcode"], ITEM["itemname"], ITEM["materialcode"], ITEM["materialname"], t, pw, pq, pkg, ACTOR))


# ── 선가공재고 (주문과 같은 규격의 현재고) ─────────────────────────────────────
# 주문 AI2026111500001-1 (TIN PLATE 0.6 × 55, 1,000kg) 에 같은 규격 재고 300kg 을 연결 → 필요중량 700kg
ORDER = ("AI2026111500001", 1)
READY = {"sourcetype": "OPENING", "sourceno": "STTEST2026111501", "sourceline": 1,
         "thickness": 0.6, "width": 55, "qty": 1, "weight": 300, "unitprice": 2060}


def _relink(with_ready: bool):
    """화면과 같은 순서: 보내기 취소 → 재고매칭 저장 → 다시 보내기 (보낸 품목은 재고매칭을 바꿀 수 없음)."""
    from services.ai import AIOrderManage as manage

    class Source:
        def __init__(self, t, n, l):
            self.sourcetype, self.sourceno, self.sourceline = t, n, l

    orderid, lineno = ORDER
    detail = manage.get_order(CO, orderid) if hasattr(manage, "get_order") else None
    items = (detail or {}).get("items") or []
    line = next((x for x in items if x.get("lineno") == lineno), None)
    current = [(m["sourcetype"], m["sourceno"], int(m["sourceline"])) for m in (line or {}).get("stock_matches", [])]
    keep = [k for k in current if k[1] != READY["sourceno"]]
    target = keep + ([(READY["sourcetype"], READY["sourceno"], READY["sourceline"])] if with_ready else [])
    was_sent = (line or {}).get("optimize_status") == "WAITING"
    if was_sent:
        manage.set_optimize_status(CO, orderid, [lineno], False, ACTOR)
    manage.save_stock_matches(CO, orderid, lineno, [Source(*k) for k in target], ACTOR)
    if was_sent:
        manage.set_optimize_status(CO, orderid, [lineno], True, ACTOR)
    return target


def insert_ready():
    conn = db.open_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM currentstock01t WHERE companyid=%s AND sourceno=%s", (CO, READY["sourceno"]))
            cur.execute("""INSERT INTO currentstock01t (companyid, companyname, customcode, customname, sourcetype, sourceno, sourceline, receiptdate,
                               itemcode, itemname, productname, materialcode, materialname, thickness, width, length,
                               originalqty, qty, qtyunit, originalweight, weight, unit, unitprice, warehousecode, warehousecodename, created_by)
                           VALUES (%s,%s,'Cust-00020','(주)동아스틸',%s,%s,%s,CURRENT_DATE,%s,%s,'[TEST] 선가공재고',%s,%s,%s,%s,0,%s,%s,'EA',%s,%s,'Kg',%s,%s,%s,%s)""",
                        (CO, CONAME, READY["sourcetype"], READY["sourceno"], READY["sourceline"], ITEM["itemcode"], ITEM["itemname"],
                         ITEM["materialcode"], ITEM["materialname"], READY["thickness"], READY["width"],
                         READY["qty"], READY["qty"], READY["weight"], READY["weight"], READY["unitprice"], WH[0], WH[1], ACTOR))
        conn.commit()
    finally:
        conn.close()
    return _relink(True)


def delete_ready():
    _relink(False)
    conn = db.open_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM currentstock01t WHERE companyid=%s AND sourceno=%s", (CO, READY["sourceno"]))
        conn.commit()
    finally:
        conn.close()


if __name__ == "__main__":
    action = (sys.argv[1:] or ["insert"])[0]
    if action in ("ready", "ready-delete"):
        print(insert_ready() if action == "ready" else delete_ready())
        print(f"{action} 완료")
        sys.exit(0)
    conn = db.open_connection()
    try:
        with conn.cursor() as cur:
            delete(cur)
            if action == "insert":
                insert(cur)
        conn.commit()
        print(f"{action} 완료")
    finally:
        conn.close()
