"""재고이동(inoutmove) · 가공(process) · 기초재고(StockStand) data flows (company T01)."""
from decimal import Decimal, ROUND_HALF_UP

from helpers import (D, T01_MASTER, create_inbound, create_outbound, inbound_line, lot, lots_of, ok, one, outbound_line,
                     rows, scalar, snapshot)
from integrity import assert_consistent

C = "T01"


def q2(value):
    return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def transfer(api, date, from_wh, to_wh, items, expect=200):
    response = api.post("/api/inoutmove-register/documents", json={
        "receiptno": "", "receptdate": date, "fromwarehousecode": from_wh, "towarehousecode": to_wh,
        "manager": "", "description": "", "items": [
            {"stocksourcetype": k[0], "stocksourceno": k[1], "stocksourceline": k[2], "qty": str(qty)} for k, qty in items]})
    assert response.status_code == expect, response.text
    return response.json()


# ── 재고이동 ────────────────────────────────────────────────────────────────
def test_transfer_create_use_delete(api):
    inno, (src,) = create_inbound(api, "2026-11-02", lines=[inbound_line(qty="10", weight="1000", warehouse="W1")])
    moved_no = transfer(api, "2026-11-03", "W1", "W2", [(src, 4)])["receiptno"]
    moved = ("INBOUND", moved_no, 2)
    assert lot(C, src)["qty"] == D(6) and lot(C, src)["weight"] == D(600)
    m = lot(C, moved)
    assert (m["qty"], m["weight"], m["warehousecode"], m["stockkind"]) == (D(4), D(400), "W2", "TRANSFER")
    assert (m["origintype"], m["originno"], m["originline"]) == src
    assert lot(C, src)["costamt"] + m["costamt"] == D("1000000.00"), "원가가 이동 전후로 보존되어야 함"
    assert_consistent(C, "transfer create")

    # 이동 출처 매입은 삭제 불가
    before = snapshot(C)
    assert api.delete(f"/api/inbound-register/receipts/{inno}").status_code == 409
    assert snapshot(C) == before

    # 이동된 재고를 팔면 이동 삭제 불가
    outno = create_outbound(api, "2026-11-04", [outbound_line(moved, 1, 100)])
    before = snapshot(C)
    assert api.delete(f"/api/inoutmove-register/documents/{moved_no}").status_code == 409
    assert snapshot(C) == before
    assert_consistent(C, "transfer used by outbound")

    # 매출 삭제 후 이동 삭제 → 원래 창고로 원상복구
    ok(api.delete(f"/api/outbound-register/receipts/{outno}"))
    ok(api.delete(f"/api/inoutmove-register/documents/{moved_no}"))
    s = lot(C, src)
    assert (s["qty"], s["weight"], s["costamt"]) == (D(10), D(1000), D("1000000.00"))
    assert lot(C, moved) is None
    assert not rows("SELECT 1 FROM iniop01t WHERE companyid = %s AND receiptno = %s", (C, moved_no))
    assert_consistent(C, "transfer delete")
    ok(api.delete(f"/api/inbound-register/receipts/{inno}"))
    assert_consistent(C, "cleanup")


def test_transfer_validation_and_chain(api):
    inno, (src,) = create_inbound(api, "2026-11-02", lines=[inbound_line(qty="10", weight="1000", warehouse="W1")])
    before = snapshot(C)
    transfer(api, "2026-11-03", "W1", "W1", [(src, 1)], expect=422)        # 같은 창고
    transfer(api, "2026-11-03", "W2", "W1", [(src, 1)], expect=400)        # 출발 창고가 재고 창고와 다름
    transfer(api, "2026-11-03", "W1", "W2", [(src, 11)], expect=400)       # 수량 초과
    transfer(api, "2026-11-01", "W1", "W2", [(src, 1)], expect=400)        # 입고일 이전
    transfer(api, "2026-11-03", "W1", "W9", [(src, 1)], expect=400)        # 없는 창고
    transfer(api, "2026-11-03", "W1", "W2", [(src, 1), (src, 1)], expect=422)   # 같은 재고 두 번
    assert snapshot(C) == before

    # 체인: W1→W2 (3개, 무게 비율 300) → 다시 W2→W1
    first = transfer(api, "2026-11-03", "W1", "W2", [(src, 3)])["receiptno"]
    moved = ("INBOUND", first, 2)
    second = transfer(api, "2026-11-04", "W2", "W1", [(moved, 3)])["receiptno"]
    back = ("INBOUND", second, 2)
    assert lot(C, back)["originno"] == inno, "여러 번 옮겨도 처음 출처를 가리켜야 함"
    assert_consistent(C, "transfer chain")
    before = snapshot(C)
    assert api.delete(f"/api/inoutmove-register/documents/{first}").status_code == 409
    assert snapshot(C) == before
    ok(api.delete(f"/api/inoutmove-register/documents/{second}"))
    ok(api.delete(f"/api/inoutmove-register/documents/{first}"))
    assert lot(C, src)["qty"] == D(10)
    assert_consistent(C, "transfer chain deleted")
    ok(api.delete(f"/api/inbound-register/receipts/{inno}"))


def test_transfer_fractional_weight_split(api):
    """수량 비율로 나눈 중량 (반올림) 이 원천 + 이동 재고 합계에서 정확히 보존되는지."""
    inno, (src,) = create_inbound(api, "2026-11-02", lines=[inbound_line(qty="3", weight="1000", warehouse="W1")])
    m1 = transfer(api, "2026-11-03", "W1", "W2", [(src, 1)])["receiptno"]
    m2 = transfer(api, "2026-11-03", "W1", "W2", [(src, 1)])["receiptno"]
    m3 = transfer(api, "2026-11-03", "W1", "W2", [(src, 1)])["receiptno"]
    weights = [lot(C, ("INBOUND", m, 2))["weight"] for m in (m1, m2, m3)]
    assert sum(weights) + lot(C, src)["weight"] == D(1000)
    s = lot(C, src)
    assert s["qty"] == 0 and s["weight"] == 0, f"모든 수량을 옮기면 중량도 0이어야 함: {s['weight']}"
    costs = [lot(C, ("INBOUND", m, 2))["costamt"] for m in (m1, m2, m3)]
    assert sum(costs) + s["costamt"] == D("1000000.00")
    assert_consistent(C, "fractional transfer")
    for m in (m3, m2, m1):
        ok(api.delete(f"/api/inoutmove-register/documents/{m}"))
    ok(api.delete(f"/api/inbound-register/receipts/{inno}"))
    assert_consistent(C, "fractional transfer cleanup")


# ── 가공 ─────────────────────────────────────────────────────────────────────
def process_payload(src, processdate="2026-11-10", processno=None, qty="4", weight="400", fee_a="50", manual_b="7000",
                    child_weights=("100", "100")):
    return {
        "processno": processno, "processdate": processdate, "customcode": "P001", "customname": "가공처A",
        "warehousecode": "W2", "warehousecodename": "제2창고", "manager": "", "description": "",
        "sources": [{
            "stocksourcetype": src[0], "stocksourceno": src[1], "stocksourceline": src[2], "qty": qty, "weight": weight,
            "products": [
                {"clientid": "A", "processid": "1", "processcodename": "등분", "productname": "가공품A", "thickness": "1.2",
                 "width": "600", "length": "2438", "qty": "4", "qtyunit": "EA", "weight": str(D(weight) / 2), "unit": "KG",
                 "unitprice": fee_a},
                {"clientid": "A1", "parent_clientid": "A", "processid": "7", "processcodename": "절단", "productname": "가공품A1",
                 "thickness": "1.2", "width": "600", "length": "1219", "qty": "2", "qtyunit": "EA", "weight": child_weights[0],
                 "unit": "KG", "unitprice": "10"},
                {"clientid": "A2", "parent_clientid": "A", "processid": "7", "processcodename": "절단", "productname": "가공품A2",
                 "thickness": "1.2", "width": "600", "length": "1219", "qty": "2", "qtyunit": "EA", "weight": child_weights[1],
                 "unit": "KG", "unitprice": "10"},
                {"clientid": "B", "processid": "7", "processcodename": "절단", "productname": "가공품B", "thickness": "1.2",
                 "width": "619", "length": "2438", "qty": "4", "qtyunit": "EA", "weight": str(D(weight) / 2), "unit": "KG",
                 "unitprice": "0", "supplyamt": manual_b},
            ],
        }],
    }


def test_process_create_sell_edit_delete(api):
    inno, (src,) = create_inbound(api, "2026-11-02", lines=[inbound_line(qty="10", weight="1000", unitprice="1000")])
    before = snapshot(C)
    bad = process_payload(src)
    bad["sources"][0]["products"][1]["weight"] = "99"           # 하위 합계 ≠ 상위 중량
    assert api.post("/api/item-process-register/documents", json=bad).status_code == 400
    assert api.post("/api/item-process-register/documents", json=process_payload(src, qty="11", weight="1100")).status_code in (400, 422)
    assert api.post("/api/item-process-register/documents", json=process_payload(src, processdate="2026-11-01")).status_code == 400
    assert snapshot(C) == before

    body = ok(api.post("/api/item-process-register/documents", json=process_payload(src)))
    processno = body["processno"]
    assert body["product_count"] == 3
    s = lot(C, src)
    assert (s["qty"], s["weight"], s["costamt"]) == (D(6), D(600), D("600000.00"))
    products = rows("""SELECT sourceline, qty, weight, costamt, feeamt, warehousecode, stockkind FROM currentstock01t
                       WHERE companyid = %s AND sourceno = %s ORDER BY sourceline""", (C, processno))
    assert len(products) == 3 and all(p["warehousecode"] == "W2" and p["stockkind"] == "PROCESS" for p in products)
    assert sum(p["weight"] for p in products) == D(400)
    fees = scalar("SELECT SUM(supplyamt) FROM process02t WHERE companyid = %s AND processno = %s", (C, processno))
    assert fees == D("200") * D("50") + D("100") * D("10") * 2 + D("7000")
    assert sum(p["costamt"] for p in products) == D("400000.00") + fees, "가공품 원가 = 투입 원가 + 모든 단계 가공비"
    assert_consistent(C, "process create")   # includes P001 payable == fees (ledger)

    # 가공품 판매 → 가공 삭제 · 수정 막힘
    a1 = ("INBOUND", processno, products[0]["sourceline"])
    outno = create_outbound(api, "2026-11-11", [outbound_line(a1, 1, 50)])
    assert_consistent(C, "sell process product")
    before = snapshot(C)
    assert api.post("/api/item-process-register/documents/delete", json={"processnos": [processno]}).status_code == 400
    assert api.post("/api/item-process-register/documents", json=process_payload(src, processno=processno)).status_code == 400
    assert snapshot(C) == before
    # 가공 원소재(매입)도 삭제 불가
    assert api.delete(f"/api/inbound-register/receipts/{inno}").status_code == 409
    assert snapshot(C) == before

    # 매출 삭제 후 가공 수정 (투입량 · 가공비 변경)
    ok(api.delete(f"/api/outbound-register/receipts/{outno}"))
    ok(api.post("/api/item-process-register/documents",
                json=process_payload(src, processno=processno, qty="5", weight="500", fee_a="60", manual_b="8000",
                                     child_weights=("125", "125"))))
    s = lot(C, src)
    assert (s["qty"], s["weight"]) == (D(5), D(500))
    assert scalar("SELECT SUM(weight) FROM currentstock01t WHERE companyid = %s AND sourceno = %s", (C, processno)) == D(500)
    assert scalar("SELECT COUNT(*) FROM process01t WHERE companyid = %s AND processno = %s", (C, processno)) == 1
    assert_consistent(C, "process edit")

    # 가공 삭제 → 원소재 원상복구, 가공품 · 수불 삭제
    ok(api.post("/api/item-process-register/documents/delete", json={"processnos": [processno]}))
    s = lot(C, src)
    assert (s["qty"], s["weight"], s["costamt"]) == (D(10), D(1000), D("1000000.00"))
    assert not rows("SELECT 1 FROM currentstock01t WHERE companyid = %s AND sourceno = %s", (C, processno))
    assert not rows("SELECT 1 FROM iniop01t WHERE companyid = %s AND receiptno = %s", (C, processno))
    assert_consistent(C, "process delete")
    ok(api.delete(f"/api/inbound-register/receipts/{inno}"))
    assert_consistent(C, "cleanup")


def test_process_product_moved_blocks_process_delete(api):
    inno, (src,) = create_inbound(api, "2026-11-02", lines=[inbound_line(qty="10", weight="1000")])
    processno = ok(api.post("/api/item-process-register/documents", json=process_payload(src)))["processno"]
    product = ("INBOUND", processno, scalar("SELECT MIN(sourceline) FROM currentstock01t WHERE companyid = %s AND sourceno = %s", (C, processno)))
    moved = transfer(api, "2026-11-12", "W2", "W1", [(product, 1)])["receiptno"]
    before = snapshot(C)
    assert api.post("/api/item-process-register/documents/delete", json={"processnos": [processno]}).status_code == 400
    assert snapshot(C) == before
    assert_consistent(C, "process product transferred")
    ok(api.delete(f"/api/inoutmove-register/documents/{moved}"))
    ok(api.post("/api/item-process-register/documents/delete", json={"processnos": [processno]}))
    ok(api.delete(f"/api/inbound-register/receipts/{inno}"))
    assert_consistent(C, "cleanup")


# ── 기초재고 ─────────────────────────────────────────────────────────────────
def stand_item(**kw):
    item = {"itemcode": "I001", "itemname": "테스트코일", "materialcode": "1", "materialname": "SS400", "thickness": "2.0",
            "width": "1219", "length": None, "qty": "1", "qtyunit": "1", "weight": "5000", "warehousecode": "W1",
            "warehousecodename": "본사창고", "unit": "1", "unitprice": "900"}
    item.update(kw)
    return item


def test_stock_stand_create_reprice_delete(api):
    before_lines = {r["lineno"] for r in rows("SELECT lineno FROM standstock01t WHERE companyid = %s", (C,))}
    ok(api.post("/api/stock-stand/items", json={"standdate": "2026-11-01", "items": [
        stand_item(qty="4"), stand_item(itemcode="I002", itemname="테스트시트", qty="7", weight="1234.567", unit="2", unitprice="950000.55",
                                 length="2438", warehousecode="W2", warehousecodename="제2창고")]}))
    lines = sorted(r["lineno"] for r in rows("SELECT lineno FROM standstock01t WHERE companyid = %s", (C,)) if r["lineno"] not in before_lines)
    l1, l2 = lines
    st2 = one("SELECT * FROM standstock01t WHERE companyid = %s AND lineno = %s", (C, l2))
    assert st2["supplyamt"] == q2(D("1.234567") * D("950000.55")), "톤 단가 = 중량/1000 × 단가 (원 미만 2자리 반올림)"
    assert st2["unitamt"] == st2["supplyamt"] + st2["vat"]
    k1 = ("OPENING", one("SELECT sourceno FROM currentstock01t WHERE companyid = %s AND sourcetype = 'OPENING' AND sourceline = %s", (C, l1))["sourceno"], l1)
    k2 = (k1[0], k1[1], l2)
    assert lot(C, k1)["costamt"] == D("4500000.00")
    assert_consistent(C, "opening stock create")

    # 단가 수정 → 기초재고 · 현재고 단가 · 수불(ST) · 원가 함께
    ok(api.put("/api/stock-stand/items/prices", json={"items": [{"lineno": l1, "unit": "1", "unitprice": "1000"}]}))
    assert lot(C, k1)["unitprice"] == D("1000") and lot(C, k1)["costamt"] == D("5000000.00")
    assert_consistent(C, "opening price edit")

    # 일부 판매 후 단가 재수정 → 판매분 원가 재배분 (lot 잔여 + 판매 원가 = 새 공급가)
    outno = create_outbound(api, "2026-11-05", [outbound_line(k1, 1, 1234.5)])
    ok(api.put("/api/stock-stand/items/prices", json={"items": [{"lineno": l1, "unit": "1", "unitprice": "1100.33"}]}))
    new_supply = q2(D(5000) * D("1100.33"))
    sold_cost = scalar("SELECT SUM(costamt) FROM iniop01t WHERE companyid = %s AND iniotype = 'OUT' AND receiptno = %s", (C, outno))
    assert lot(C, k1)["costamt"] + sold_cost == new_supply, (lot(C, k1)["costamt"], sold_cost, new_supply)
    assert_consistent(C, "opening reprice after sale")

    # 사용된 기초재고 행 삭제 불가
    before = snapshot(C)
    assert api.delete("/api/stock-stand/items", json={"delete_all": False, "linenos": [l1]}).status_code == 409
    assert snapshot(C) == before
    ok(api.delete(f"/api/outbound-register/receipts/{outno}"))
    assert lot(C, k1)["costamt"] == new_supply

    # 이동에 쓰인 기초재고는 단가 수정 불가 (변경 없음)
    moved = transfer(api, "2026-11-06", "W2", "W1", [(k2, 2)])["receiptno"]
    before = snapshot(C)
    assert api.put("/api/stock-stand/items/prices", json={"items": [{"lineno": l2, "unit": "2", "unitprice": "1"}]}).status_code == 409
    assert snapshot(C) == before
    assert api.delete("/api/stock-stand/items", json={"delete_all": True, "linenos": []}).status_code == 409
    assert snapshot(C) == before
    ok(api.delete(f"/api/inoutmove-register/documents/{moved}"))
    assert_consistent(C, "opening with transfer")

    ok(api.delete("/api/stock-stand/items", json={"delete_all": False, "linenos": [l1, l2]}))
    assert lot(C, k1) is None and lot(C, k2) is None
    assert not rows("SELECT 1 FROM iniop01t WHERE companyid = %s AND iniotype = 'ST' AND lineno = ANY(%s)", (C, [l1, l2]))
    assert_consistent(C, "opening delete")
