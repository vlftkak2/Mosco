"""가공계획 → 재고가공등록 예시 TEST 데이터 (PL2026111500004 와 같은 조건 + 선가공 + 등분 2차).

  주문  AITEST2026111501 (주)금영피앤티 · TIN PLATE 0.6T
        1행  55mm  1,000kg  ← 선가공재고 STTEST2026111503-1 (55mm 100kg) 연결 → 필요 900kg
        2행 191mm  2,000kg
  원코일 STTEST2026111502-1 · TIN PLATE 0.6 × 914 · 1 EA · 5,690kg · 신영정밀금속 (현재고)
  계획  혼합(55×6 + 191×3) · 등분 2차 (1차 3,000kg / 2차 2,690kg) · 기본 로스 4mm → 계획확정

사용:  python docs/plan_example_seed.py insert   # 넣기 (이미 있으면 지우고 다시)
       python docs/plan_example_seed.py delete   # 지우기 (등록한 가공전표가 있으면 먼저 삭제해 재고를 되돌린다)
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
import db  # noqa: E402

CO, CONAME, ACTOR = "001", "모두코", "TEST"
ORDERID = "AITEST2026111501"
RAW = ("OPENING", "STTEST2026111502", 1)
READY = ("OPENING", "STTEST2026111503", 1)
COPY_FROM = "AI2026111500001"   # 품명 · 강종 · 표면 · 발주처를 그대로 따온다
SETTINGS = {"combo": "MIXED", "processmode": "SPLIT", "splitweights": [3000, 2690], "trimloss": 4,
            "raw_id": f"STOCK|{RAW[0]}|{RAW[1]}|{RAW[2]}", "orientation": "NORMAL",
            "extrawidths": [], "extralengths": [], "newcandidates": [], "excluded_raw": [], "history_patterns": []}


def _stock_row(cur, key, width, weight, note):
    cur.execute("""INSERT INTO currentstock01t (companyid, companyname, customcode, customname, sourcetype, sourceno, sourceline, receiptdate,
                       itemcode, itemname, productname, materialcode, materialname, thickness, width, length,
                       originalqty, qty, qtyunit, originalweight, weight, unit, unitprice, warehousecode, warehousecodename, created_by)
                   VALUES (%s,%s,'Cust-00020','(주)동아스틸',%s,%s,%s,CURRENT_DATE,'87','TIN PLATE',%s,'537','일반',0.6,%s,0,
                           1,1,'EA',%s,%s,'Kg',2000,'74','신영정밀금속',%s)""",
                (CO, CONAME, *key, note, width, weight, weight, ACTOR))


def delete():
    from services.ai import AIOrderOptimization as opt
    from services.process import ItemProcessRegister as proc
    conn = db.open_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""SELECT DISTINCT p.planno FROM aiplan01t p JOIN aiplan02t d ON d.companyid=p.companyid AND d.planno=p.planno
                            WHERE p.companyid=%s AND d.orderid=%s""", (CO, ORDERID))
            plans = [r[0] for r in cur.fetchall()]
            nos = []
            if plans:
                cur.execute("SELECT processno FROM process01t WHERE companyid=%s AND planno = ANY(%s) ORDER BY processno DESC", (CO, plans))
                nos = [r[0] for r in cur.fetchall()]
        conn.commit()
    finally:
        conn.close()
    if nos:
        proc.delete_documents(CO, nos)              # 재고 원복 · 계획 상태 되돌림
    for planno in plans:
        opt.cancel_plan(CO, planno)                 # 확정 → 취소
    conn = db.open_connection()
    try:
        with conn.cursor() as cur:
            for planno in plans:
                cur.execute("DELETE FROM aiplan02t WHERE companyid=%s AND planno=%s", (CO, planno))
                cur.execute("DELETE FROM aiplan01t WHERE companyid=%s AND planno=%s", (CO, planno))
            for table in ("aiorder03t", "aiorder02t", "aiorder01t"):
                cur.execute(f"DELETE FROM {table} WHERE companyid=%s AND orderid=%s", (CO, ORDERID))
            cur.execute("DELETE FROM currentstock01t WHERE companyid=%s AND sourceno IN (%s, %s)", (CO, RAW[1], READY[1]))
        conn.commit()
    finally:
        conn.close()
    return plans, nos


def insert():
    delete()
    conn = db.open_connection()
    try:
        with conn.cursor() as cur:
            _stock_row(cur, RAW, 914, 5690, "[TEST] 예시 원코일")
            _stock_row(cur, READY, 55, 100, "[TEST] 예시 선가공재고")
            cur.execute("""INSERT INTO aiorder01t (companyid, companyname, orderid, analysis_request_id, username, useremail, buyer, recipient,
                               orderdate, duedate, deliverylocation, sourcefilename, created_by)
                           SELECT companyid, companyname, %s, NULL, username, useremail, buyer, recipient,
                                  CURRENT_DATE, duedate, deliverylocation, '[TEST] 예시', %s
                             FROM aiorder01t WHERE companyid=%s AND orderid=%s""", (ORDERID, ACTOR, CO, COPY_FROM))
            cur.execute("""INSERT INTO aiorder02t (companyid, companyname, orderid, lineno, itemname, steelgrade, surface, size, thickness, width,
                               length, quantity, quantity_unit, weight_kg, notes, optimize_status, created_by)
                           SELECT companyid, companyname, %s, lineno, itemname, steelgrade, surface, size, thickness, width,
                                  length, quantity, quantity_unit, weight_kg, '[TEST] 예시', 'WAITING', %s
                             FROM aiorder02t WHERE companyid=%s AND orderid=%s""", (ORDERID, ACTOR, CO, COPY_FROM))
            cur.execute("""INSERT INTO aiorder03t (companyid, companyname, orderid, lineno, matchlineno, stocksourcetype, stocksourceno, stocksourceline, created_by)
                           VALUES (%s,%s,%s,1,1,%s,%s,%s,%s)""", (CO, CONAME, ORDERID, *READY, ACTOR))
        conn.commit()
    finally:
        conn.close()
    from services.ai import AIOrderOptimization as opt
    saved = opt.save_plan(CO, CONAME, {"keys": [[ORDERID, 1], [ORDERID, 2]], "settings": SETTINGS, "status": "CONFIRMED", "plan_id": "A"}, ACTOR)
    return saved


if __name__ == "__main__":
    action = (sys.argv[1:] or ["insert"])[0]
    print(insert() if action == "insert" else delete())
    print(f"{action} 완료")
