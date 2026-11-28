"""경계 사례: 수량/중량 한쪽만 남는 재고, 원천 재고 바꾸기 수정, 마스터 삭제 가드, 담당자 전파 등."""
import pytest

from helpers import (D, create_inbound, create_outbound, inbound_line, lot, ok, one, outbound_line, outbound_payload, rows,
                     rp_payload, scalar, snapshot)
from integrity import assert_consistent
from test_20_stock_flows import process_payload, transfer
from test_30_receipt_payment import RP, cash, note

C = "T01"


def _ghost_lots():
    return rows("""SELECT sourcetype, sourceno, sourceline, qty, weight FROM currentstock01t
                   WHERE companyid = %s AND ((qty = 0) <> (weight = 0))""", (C,))


# 회귀 방지: 매출 뒤 수량만 0 · 중량만 0 인 잔량이 남는 저장은 거절되어야 한다 (OutboundRegister._ensure_not_half_empty)
@pytest.mark.parametrize("qty,weight", [(10, 990), (5, 1000)], ids=["qty-used-up-weight-left", "weight-used-up-qty-left"])
def test_sale_must_not_leave_half_empty_lot(api, qty, weight):
    inno, (key,) = create_inbound(api, "2026-11-02", lines=[inbound_line(qty="10", weight="1000")])
    response = api.post("/api/outbound-register/receipts", json=outbound_payload("2026-11-05", [outbound_line(key, qty, weight)]))
    ghosts = _ghost_lots()
    stock = lot(C, key)
    if response.status_code == 200:
        ok(api.delete(f"/api/outbound-register/receipts/{response.json()['receiptno']}"))
    ok(api.delete(f"/api/inbound-register/receipts/{inno}"))
    assert response.status_code == 400 or not ghosts, f"lot left as qty={stock['qty']} weight={stock['weight']} cost={stock['costamt']}"


def test_outbound_edit_switching_source_lot(api):
    in1, (k1,) = create_inbound(api, "2026-11-02", lines=[inbound_line(qty="10", weight="1000")])
    in2, (k2,) = create_inbound(api, "2026-11-02", lines=[inbound_line(qty="10", weight="1000", warehouse="W2")])
    outno = create_outbound(api, "2026-11-05", [outbound_line(k1, 3, 300)])
    ok(api.put("/api/outbound-register/receipts", json=outbound_payload(
        "2026-11-05", [outbound_line(k2, 2, 200), outbound_line(k2, 1, 100), outbound_line(k1, 1, 100)], receiptno=outno, is_new=False)))
    assert lot(C, k1)["qty"] == D(9) and lot(C, k2)["qty"] == D(7)
    assert scalar("SELECT COUNT(*) FROM outbound02t WHERE companyid = %s AND receiptno = %s", (C, outno)) == 3
    assert_consistent(C, "outbound lot switch")
    # 수정 중 재고 부족이면 원래 상태 그대로 (원래 판매분 복원 → 재차감이 한 트랜잭션)
    before = snapshot(C)
    response = api.put("/api/outbound-register/receipts", json=outbound_payload(
        "2026-11-05", [outbound_line(k2, 11, 1100)], receiptno=outno, is_new=False))
    assert response.status_code == 400 and snapshot(C) == before
    ok(api.delete(f"/api/outbound-register/receipts/{outno}"))
    ok(api.delete(f"/api/inbound-register/receipts/{in1}"))
    ok(api.delete(f"/api/inbound-register/receipts/{in2}"))
    assert_consistent(C, "cleanup")


def test_process_edit_switching_source_lot(api):
    in1, (k1,) = create_inbound(api, "2026-11-02", lines=[inbound_line(qty="10", weight="1000")])
    in2, (k2,) = create_inbound(api, "2026-11-02", lines=[inbound_line(qty="10", weight="1000")])
    pno = ok(api.post("/api/item-process-register/documents", json=process_payload(k1)))["processno"]
    ok(api.post("/api/item-process-register/documents", json=process_payload(k2, processno=pno)))
    assert lot(C, k1)["qty"] == D(10) and lot(C, k1)["costamt"] == D("1000000.00")
    assert lot(C, k2)["qty"] == D(6)
    assert_consistent(C, "process source switch")
    ok(api.post("/api/item-process-register/documents/delete", json={"processnos": [pno]}))
    ok(api.delete(f"/api/inbound-register/receipts/{in1}"))
    ok(api.delete(f"/api/inbound-register/receipts/{in2}"))
    assert_consistent(C, "cleanup")


def test_adjusted_weight_sale(api):
    inno, (key,) = create_inbound(api, "2026-11-02", lines=[inbound_line(qty="10", weight="1000")])
    outno = create_outbound(api, "2026-11-05", [outbound_line(key, 2, 205, adjweight="5", unitprice="1000")])
    line = one("SELECT weight, adjweight, supplyamt FROM outbound02t WHERE companyid = %s AND receiptno = %s", (C, outno))
    assert (line["weight"], line["adjweight"], line["supplyamt"]) == (D(205), D(5), D("205000.00"))
    assert lot(C, key)["weight"] == D(795)
    assert_consistent(C, "adjweight sale")
    ok(api.delete(f"/api/outbound-register/receipts/{outno}"))
    ok(api.delete(f"/api/inbound-register/receipts/{inno}"))


def test_manager_change_propagates(api):
    inno, (key,) = create_inbound(api, "2026-11-02", lines=[inbound_line()])
    ok(api.patch(f"/api/inbound-register/receipts/{inno}/manager", json={"manager": "새담당"}))
    assert lot(C, key)["manager"] == "새담당"
    assert one("SELECT manager FROM iniop01t WHERE companyid = %s AND receiptno = %s", (C, inno))["manager"] == "새담당"
    outno = create_outbound(api, "2026-11-05", [outbound_line(key, 1, 100)])
    ok(api.patch(f"/api/outbound-register/receipts/{outno}/manager", json={"manager": "매출담당"}))
    assert {r["manager"] for r in rows("SELECT manager FROM outbound02t WHERE companyid = %s AND receiptno = %s", (C, outno))} == {"매출담당"}
    assert one("SELECT manager FROM iniop01t WHERE companyid = %s AND receiptno = %s", (C, outno))["manager"] == "매출담당"
    # 사용된 매입의 담당자 변경은 허용 (재고 · 수불 담당자 함께)
    ok(api.patch(f"/api/inbound-register/receipts/{inno}/manager", json={"manager": "또담당"}))
    assert lot(C, key)["manager"] == "또담당"
    assert_consistent(C, "manager propagation")
    ok(api.delete(f"/api/outbound-register/receipts/{outno}"))
    ok(api.delete(f"/api/inbound-register/receipts/{inno}"))


def test_master_data_in_use_cannot_be_deleted(api):
    """재고 · 전표에 쓰인 품목 · 창고 · 수량단위 · 단가기준 · 강종 코드는 삭제되면 안 된다 (409)."""
    inno, (key,) = create_inbound(api, "2026-11-02", lines=[inbound_line()])
    outno = create_outbound(api, "2026-11-05", [outbound_line(key, 1, 100)])
    before = snapshot(C)
    codes_before = rows("SELECT groupcode, code FROM codemaster01t WHERE companyid = %s ORDER BY 1, 2", (C,))
    results = {
        "item I002": api.delete("/api/item-master/items", json={"itemcodes": ["I002"]}).status_code,
        "warehouse W1": api.delete("/api/code-master/groups/WAREHOUSE/items/W1").status_code,
        "qty unit 1": api.delete("/api/code-master/groups/QTY/items/1").status_code,
        "price unit 1": api.delete("/api/code-master/groups/PRICE_UNIT/items/1").status_code,
        "material 1": api.post("/api/code-master/groups/MATERIAL/items/delete", json={"codes": ["1"]}).status_code,
    }
    still = rows("SELECT groupcode, code FROM codemaster01t WHERE companyid = %s ORDER BY 1, 2", (C,))
    item_left = bool(rows("SELECT 1 FROM itemcode01t WHERE companyid = %s AND itemcode = 'I002'", (C,)))
    assert item_left and still == codes_before, f"in-use master data deleted: {results}"
    assert all(code in (400, 409, 422) for code in results.values()), results
    assert snapshot(C) == before
    ok(api.delete(f"/api/outbound-register/receipts/{outno}"))
    ok(api.delete(f"/api/inbound-register/receipts/{inno}"))


def test_receipt_converted_to_payment_keeps_instrument_rules(api):
    rno = ok(api.put(RP, json=rp_payload("2026-11-10", "RECEIPT", "C001", "매출처A", [note(1000, "CV-1")])))["receiptno"]
    response = api.put(RP, json=rp_payload("2026-11-10", "PAYMENT", "C001", "매출처A", [note(1000, "CV-1")], receiptno=rno))
    assert response.status_code in (200, 400)
    assert_consistent(C, "receipt->payment conversion")
    ok(api.delete(f"{RP}/{rno}"))
