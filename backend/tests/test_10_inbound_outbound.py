"""매입(inbound) → 매출(outbound) 등록 · 수정 · 삭제 data flow (company T01)."""
from decimal import Decimal, ROUND_HALF_UP

import pytest

from helpers import (D, T01_MASTER, T01_USER, create_inbound, create_outbound, inbound_line, inbound_payload, lot, ok,
                     one, outbound_line, outbound_payload, rows, snapshot)
from integrity import assert_consistent

C = "T01"


def q2(value):
    return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def assert_list_totals(api, user=T01_MASTER):
    """화면 목록 합계(헤더 합계) == 상세 합계 (inbound / outbound)."""
    body = ok(api.get("/api/inbound-register/receipts", user, params={"page_size": 200}))
    for receipt in body["receipts"]:
        sums = one("""SELECT COUNT(*) n, COALESCE(SUM(qty),0) q, COALESCE(SUM(weight),0) w, COALESCE(SUM(supplyamt),0) s,
                             COALESCE(SUM(vat),0) v FROM inbound02t WHERE companyid = %s AND receiptno = %s""", (C, receipt["receiptno"]))
        assert receipt["line_count"] == sums["n"]
        assert D(receipt["total_qty"]) == sums["q"] and D(receipt["total_weight"]) == sums["w"]
        assert D(receipt["supply_amount"]) == sums["s"] and D(receipt["vat_amount"]) == sums["v"]
        assert D(receipt["total_amount"]) == sums["s"] + sums["v"]
    body = ok(api.get("/api/outbound-register/receipts", user, params={"page_size": 200}))
    for receipt in body["receipts"]:
        sums = one("""SELECT COUNT(*) n, COALESCE(SUM(qty),0) q, COALESCE(SUM(weight),0) w, COALESCE(SUM(supplyamt),0) s,
                             COALESCE(SUM(vat),0) v, COALESCE(SUM(unitamt),0) t FROM outbound02t WHERE companyid = %s AND receiptno = %s""",
                   (C, receipt["receiptno"]))
        assert receipt["line_count"] == sums["n"]
        assert D(receipt["total_weight"]) == sums["w"] and D(receipt["supply_amount"]) == sums["s"]
        assert D(receipt["vat_amount"]) == sums["v"] and D(receipt["total_amount"]) == sums["t"]


def test_inbound_outbound_full_lifecycle(api):
    # 1) 매입 등록 (기타비용 운반비 포함)
    receiptno, lots = create_inbound(api, "2026-11-02", lines=[inbound_line(qty="10", weight="1000", unitprice="1000")],
                                     expenses=[{"costcode": "49", "costname": "운반비", "supplyamt": "30000", "vat": "3000"}])
    assert len(lots) == 1
    key = lots[0]
    stock = lot(C, key)
    assert (stock["qty"], stock["weight"]) == (D(10), D(1000))
    assert stock["costamt"] == D("1030000.00"), "원가 = 공급가 + 기타비용 배부"
    detail = one("SELECT * FROM inbound02t WHERE companyid = %s AND receiptno = %s", (C, receiptno))
    assert (detail["supplyamt"], detail["vat"], detail["unitamt"]) == (D("1000000.00"), D("100000.00"), D("1100000.00"))
    assert_consistent(C, "inbound create")
    assert_list_totals(api)

    # 2) 그 재고로 일부 매출
    outno = create_outbound(api, "2026-11-05", [outbound_line(key, 4, 400, unitprice="1500")], user=T01_USER)
    stock = lot(C, key)
    assert (stock["qty"], stock["weight"]) == (D(6), D(600))
    assert stock["costamt"] == D("618000.00")
    assert_consistent(C, "outbound create")

    # 3) 사용된 매입 삭제 → 막힘, 아무것도 바뀌지 않음
    before = snapshot(C)
    response = api.delete(f"/api/inbound-register/receipts/{receiptno}")
    assert response.status_code == 409, response.text
    assert snapshot(C) == before
    # 매입 수정(재저장)도 불가
    response = api.put("/api/inbound-register/receipts", json={**inbound_payload("2026-11-02"), "is_new": False, "receiptno": receiptno})
    assert response.status_code == 400
    assert snapshot(C) == before

    # 4) 매출 수정: 수량 · 중량 · 단가
    response = api.put("/api/outbound-register/receipts",
                       json=outbound_payload("2026-11-05", [outbound_line(key, 5, 500, unitprice="1600")], receiptno=outno, is_new=False))
    ok(response)
    stock = lot(C, key)
    assert (stock["qty"], stock["weight"]) == (D(5), D(500))
    line = one("SELECT * FROM outbound02t WHERE companyid = %s AND receiptno = %s", (C, outno))
    assert (line["qty"], line["supplyamt"], line["vat"], line["unitamt"]) == (D(5), D("800000.00"), D("80000.00"), D("880000.00"))
    assert_consistent(C, "outbound qty/price edit")

    # 4b) 단가만 수정 (재고 · 원가 그대로)
    cost_before = lot(C, key)["costamt"]
    ok(api.patch(f"/api/outbound-register/receipts/{outno}/sales-fields", json={"prices": [{"lineno": 1, "unitprice": "1700.55"}],
                                                                              "manager": "김담당", "destination": "부산"}))
    line = one("SELECT * FROM outbound02t WHERE companyid = %s AND receiptno = %s", (C, outno))
    assert line["supplyamt"] == q2(D("500") * D("1700.55"))
    assert line["vat"] == q2(line["supplyamt"] * D("0.1")) and line["unitamt"] == line["supplyamt"] + line["vat"]
    assert lot(C, key)["costamt"] == cost_before
    header = one("SELECT manager, destination FROM outbound01t WHERE companyid = %s AND receiptno = %s", (C, outno))
    assert header == {"manager": "김담당", "destination": "부산"}
    assert_consistent(C, "outbound sales-fields edit")

    # 5) 매출처 변경은 정책상 불가 (400) → 그대로
    before = snapshot(C)
    response = api.put("/api/outbound-register/receipts",
                       json=outbound_payload("2026-11-05", [outbound_line(key, 5, 500, unitprice="1600")], customcode="C002",
                                             receiptno=outno, is_new=False))
    assert response.status_code == 400, response.text
    assert snapshot(C) == before

    # 6) 매출일자 변경 (입고일 이후로) → 헤더 · 수불 일자 함께
    ok(api.put("/api/outbound-register/receipts",
               json=outbound_payload("2026-11-07", [outbound_line(key, 5, 500, unitprice="1600")], receiptno=outno, is_new=False)))
    assert one("SELECT receptdate FROM outbound01t WHERE companyid = %s AND receiptno = %s", (C, outno))["receptdate"].isoformat() == "2026-11-07"
    assert_consistent(C, "outbound date edit")
    # 입고일 이전으로는 불가
    before = snapshot(C)
    response = api.put("/api/outbound-register/receipts",
                       json=outbound_payload("2026-11-01", [outbound_line(key, 5, 500, unitprice="1600")], receiptno=outno, is_new=False))
    assert response.status_code == 400, response.text
    assert snapshot(C) == before

    # 7) 매출 삭제 → 재고 · 원가 원상복구
    ok(api.delete(f"/api/outbound-register/receipts/{outno}"))
    stock = lot(C, key)
    assert (stock["qty"], stock["weight"], stock["costamt"]) == (D(10), D(1000), D("1030000.00"))
    assert not rows("SELECT 1 FROM iniop01t WHERE companyid = %s AND receiptno = %s", (C, outno))
    assert_consistent(C, "outbound delete")

    # 8) 매입 삭제 → 재고 · 수불 · 기타비용 모두 사라짐
    ok(api.delete(f"/api/inbound-register/receipts/{receiptno}"))
    assert lot(C, key) is None
    assert not rows("SELECT 1 FROM iniop01t WHERE companyid = %s AND receiptno = %s", (C, receiptno))
    assert not rows("SELECT 1 FROM inbound03t WHERE companyid = %s AND receiptno = %s", (C, receiptno))
    assert_consistent(C, "inbound delete")
    # 이미 지운 전표 다시 삭제 → 404
    assert api.delete(f"/api/inbound-register/receipts/{receiptno}").status_code == 404


def test_outbound_exceeding_stock_fails_without_partial_writes(api):
    receiptno, (key,) = create_inbound(api, "2026-11-03", lines=[inbound_line(qty="10", weight="1000")])
    before = snapshot(C)
    cases = [
        [outbound_line(key, 11, 1000)],                                   # 수량 초과
        [outbound_line(key, 5, 1000.001)],                                # 중량 초과
        [outbound_line(key, 6, 600), outbound_line(key, 6, 300)],         # 같은 재고 두 줄 합계 초과
        [outbound_line(key, 1, 100), outbound_line(("INBOUND", "NOPE", 1), 1, 1)],  # 없는 재고 (둘째 줄)
        [outbound_line(key, 1, 100), outbound_line(key, 1, 100, unit="ZZ")],         # 둘째 줄 단가기준 오류
    ]
    for lines in cases:
        response = api.post("/api/outbound-register/receipts", json=outbound_payload("2026-11-04", lines))
        assert response.status_code == 400, (lines, response.text)
        assert snapshot(C) == before, f"partial write for {lines}"
    # 다 쓰면 정확히 0 (음수 없음), 한 번 더는 실패
    outno = create_outbound(api, "2026-11-04", [outbound_line(key, 10, 1000)])
    stock = lot(C, key)
    assert (stock["qty"], stock["weight"], stock["costamt"]) == (D(0), D(0), D(0))
    assert api.post("/api/outbound-register/receipts", json=outbound_payload("2026-11-04", [outbound_line(key, 1, 1)])).status_code == 400
    assert_consistent(C, "sell to zero")
    ok(api.delete(f"/api/outbound-register/receipts/{outno}"))
    ok(api.delete(f"/api/inbound-register/receipts/{receiptno}"))
    assert_consistent(C, "cleanup")


def test_inbound_validation_rejects_without_writes(api):
    before = snapshot(C)
    bad = [
        inbound_payload("2026-11-03", lines=[inbound_line(itemcode="NOPE", itemname="없는품목")]),
        inbound_payload("2026-11-03", lines=[inbound_line(), inbound_line(itemname="이름불일치")]),
        inbound_payload("2026-11-03", lines=[inbound_line(warehouse="W9")]),
        inbound_payload("2026-11-03", lines=[inbound_line(unit="ZZ")]),
        inbound_payload("2026-11-03", customcode="NOPE"),
        inbound_payload("2026-11-03", customcode="C001", lines=[inbound_line(), inbound_line(qtyunit="9")]),
    ]
    for payload in bad:
        response = api.put("/api/inbound-register/receipts", json=payload)
        assert response.status_code in (400, 422), response.text
        assert snapshot(C) == before
    # pydantic: 음수 / 0 / 소수 자릿수 초과
    for patch in ({"qty": "0"}, {"weight": "-1"}, {"unitprice": "1.001"}, {"weight": "1.0001"}):
        response = api.put("/api/inbound-register/receipts", json=inbound_payload("2026-11-03", lines=[inbound_line(**patch)]))
        assert response.status_code == 422, (patch, response.text)
    assert snapshot(C) == before


def test_multi_group_inbound_creates_one_receipt_per_warehouse(api):
    body = ok(api.put("/api/inbound-register/receipts", json=inbound_payload(
        "2026-11-03", lines=[inbound_line(warehouse="W1"), inbound_line(warehouse="W2"), inbound_line(warehouse="W1", qty="3", weight="300")])))
    assert body["group_count"] == 2 and body["saved_count"] == 3
    for receiptno in body["receipt_numbers"]:
        assert rows("SELECT 1 FROM inbound02t WHERE companyid = %s AND receiptno = %s", (C, receiptno))
    assert_consistent(C, "multi warehouse inbound")
    assert_list_totals(api)
    for receiptno in body["receipt_numbers"]:
        ok(api.delete(f"/api/inbound-register/receipts/{receiptno}"))
    assert_consistent(C, "multi warehouse inbound delete")


def test_outbound_with_expenses_and_ledger(api):
    receiptno, (key,) = create_inbound(api, "2026-11-03", lines=[inbound_line(qty="10", weight="1000", unitprice="800")])
    outno = create_outbound(api, "2026-11-08", [outbound_line(key, 2, 200, unitprice="1200")], expenses=[
        {"costcode": "49", "costname": "운반비", "supplyamt": "20000", "vat": "2000", "customcode": "X001", "customname": "운송사A", "purchaseyn": "Y"},
        {"costcode": "49", "costname": "운반비", "supplyamt": "5000", "vat": "500", "customcode": "", "customname": "", "purchaseyn": "N"},
    ])
    exp = rows("SELECT customcode, purchaseyn, supplyamt FROM outbound03t WHERE companyid = %s AND receiptno = %s ORDER BY lineno", (C, outno))
    assert [(e["customcode"], e["purchaseyn"]) for e in exp] == [("X001", "Y"), ("", "N")], exp   # N = 매출처 부담 (거래처 칸은 비움)
    assert_consistent(C, "outbound with expenses")   # includes independent ledger check (X001 payable 20,000; C001 +5,000)
    ok(api.delete(f"/api/outbound-register/receipts/{outno}"))
    assert not rows("SELECT 1 FROM outbound03t WHERE companyid = %s AND receiptno = %s", (C, outno))
    ok(api.delete(f"/api/inbound-register/receipts/{receiptno}"))
    assert_consistent(C, "outbound with expenses deleted")


def test_inbound_expense_customer_ledger(api):
    """매입 기타비용: 거래처가 매입처와 다르면 그 거래처(운송사)에 줄 돈, 비었거나 같으면 매입처 매입에 합산.
    재고 원가에는 거래처와 관계없이 전부 들어간다."""
    from datetime import date

    from services.receiptpayment import CustomerLedger as ledger

    def payable(code, with_vat=False):
        items = ledger.list_balances(C, date(2000, 1, 1), date(2099, 12, 31), with_vat=with_vat)["items"]
        return next((D(r["pay_close"]) for r in items if r["customcode"] == code), D(0))

    def breakdown(code):
        return ledger.dashboard(C, date(2099, 12, 31), date_from=date(2026, 11, 4), ckey=code)["breakdown"]

    before = {code: (payable(code), payable(code, True)) for code in ("V001", "X001")}
    base = {code: breakdown(code) for code in ("V001", "X001")}
    receiptno, (key,) = create_inbound(api, "2026-11-04", lines=[inbound_line(qty="10", weight="1000", unitprice="1000")], expenses=[
        {"costcode": "49", "costname": "운반비", "supplyamt": "40000", "vat": "4000", "customcode": "X001", "customname": "운송사A"},
        {"costcode": "49", "costname": "운반비", "supplyamt": "7000", "vat": "700", "customcode": "V001", "customname": "매입처A"},
        {"costcode": "49", "costname": "운반비", "supplyamt": "3000", "vat": "300"},
    ])
    assert lot(C, key)["costamt"] == D("1050000.00"), "원가 = 공급가 + 기타비용 전부 (거래처와 무관)"

    # 잔액: 매입처 = 상품 + 같은/빈 거래처 기타비용, 운송사 = 자기 기타비용만 (공급가 · 합계금액 기준 모두)
    assert payable("V001") - before["V001"][0] == D("1010000")
    assert payable("X001") - before["X001"][0] == D("40000")
    assert payable("V001", True) - before["V001"][1] == D("1111000")
    assert payable("X001", True) - before["X001"][1] == D("44000")

    # 거래처 원장 한 장씩
    v_lines = [l for l in ledger.get_ledger(C, "V001", date(2000, 1, 1), date(2099, 12, 31))["lines"] if l["docno"] == receiptno]
    assert [(l["kind"], D(l["purchase"])) for l in v_lines] == [("PURCHASE", D("1010000"))], v_lines
    x_lines = [l for l in ledger.get_ledger(C, "X001", date(2000, 1, 1), date(2099, 12, 31))["lines"] if l["docno"] == receiptno]
    assert [(l["kind"], l["kindname"], D(l["purchase"])) for l in x_lines] == [("COST", "매입", D("40000"))], x_lines
    assert x_lines[0]["summary"] == f"운반비 (매입 {receiptno})"

    # 채권채무요약 기간 구성: 매입처 쪽 기타비용 / 다른 거래처 기타비용
    v_parts, x_parts = breakdown("V001"), breakdown("X001")
    assert D(v_parts["purchase_exp"]) - D(base["V001"]["purchase_exp"]) == D("10000")
    assert D(v_parts["purchase_exp_other"]) == D(base["V001"]["purchase_exp_other"])
    assert D(x_parts["purchase_exp_other"]) - D(base["X001"]["purchase_exp_other"]) == D("40000")
    assert D(x_parts["purchase_exp"]) == D(base["X001"]["purchase_exp"])

    assert_consistent(C, "inbound expense to other customer")   # 독립 원장 계산 · 목록 · 단건 · 대시보드 일치
    ok(api.delete(f"/api/inbound-register/receipts/{receiptno}"))
    assert payable("V001") == before["V001"][0] and payable("X001") == before["X001"][0]
    assert_consistent(C, "inbound expense to other customer deleted")
