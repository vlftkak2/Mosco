"""수금/지급 (현금 · 어음/수표) · 어음 상태 처리(배서/결제/할인/부도) · 거래처원장 (company T01)."""
import pytest

from helpers import (D, create_inbound, create_outbound, inbound_line, ok, one, outbound_line, rows, rp_payload, scalar,
                     snapshot)
from integrity import assert_consistent, expected_ledger

C = "T01"
RP = "/api/receipt-payment/documents"


def cash(amount="0", **kw):
    line = {"cashamt": str(amount)}
    line.update({k: str(v) for k, v in kw.items()})
    return line


def note(amount, no, kind="OTHER", itype="PROMISSORY", issuer="발행사A", maturity="2027-02-28", **kw):
    line = {"instrumentamt": str(amount), "instrumenttype": itype, "instrumentno": no, "issuercompany": issuer,
            "issuekind": kind, "issuedate": "2026-11-01", "maturitydate": maturity}
    line.update(kw)
    return line


def save_rp(api, payload, expect=200):
    response = api.put(RP, json=payload)
    assert response.status_code == expect, response.text
    return response.json().get("receiptno")


def process(api, receiptno, action, lines, processdate="2026-11-20", expect=200):
    response = api.post(f"{RP}/{receiptno}/instrument-process",
                        json={"action": action, "processdate": processdate if action != "CANCEL" else None,
                              "processmemo": f"pytest {action}", "lines": [{"lineno": n} for n in lines]})
    assert response.status_code == expect, response.text
    return response


def line_status(receiptno, lineno):
    return one("SELECT instrumentstatus, processdate FROM receiptpayment02t WHERE companyid = %s AND receiptno = %s AND lineno = %s",
               (C, receiptno, lineno))


def ledger_of(code):
    return expected_ledger(C).get(code, (D(0), D(0)))


@pytest.fixture
def trade(api):
    """매출(C001 1,000,000) + 매입(V001 1,000,000) 을 만들고 끝나면 지운다."""
    inno, (key,) = create_inbound(api, "2026-11-02", lines=[inbound_line(qty="10", weight="1000", unitprice="1000")])
    outno = create_outbound(api, "2026-11-05", [outbound_line(key, 5, 500, unitprice="2000")])
    yield {"inbound": inno, "outbound": outno, "lot": key}
    ok(api.delete(f"/api/outbound-register/receipts/{outno}"))
    ok(api.delete(f"/api/inbound-register/receipts/{inno}"))
    assert_consistent(C, "trade cleanup")


def test_cash_receipt_payment_and_edit(api, trade):
    recv0, _ = ledger_of("C001")
    rno = save_rp(api, rp_payload("2026-11-10", "RECEIPT", "C001", "매출처A", [cash(300000), cash(99990, lossamt=10)]))
    assert ledger_of("C001")[0] == recv0 - D(400000)
    assert_consistent(C, "cash receipt")

    # 수정: 금액 · 일자 · 거래처 변경 → 원장이 옮겨 간다
    save_rp(api, rp_payload("2026-11-12", "RECEIPT", "C002", "매출처B", [cash("123456.78")], receiptno=rno))
    assert ledger_of("C001")[0] == recv0
    h = one("SELECT receiptdate, customcode FROM receiptpayment01t WHERE companyid = %s AND receiptno = %s", (C, rno))
    assert (h["receiptdate"].isoformat(), h["customcode"]) == ("2026-11-12", "C002")
    assert scalar("SELECT COUNT(*) FROM receiptpayment02t WHERE companyid = %s AND receiptno = %s", (C, rno)) == 1
    assert_consistent(C, "receipt edit")

    # 상계 (양쪽 잔액에서 함께 빠짐) + 잡이익 지급
    pno = save_rp(api, rp_payload("2026-11-13", "PAYMENT", "V001", "매입처A", [cash(100010, chargeamt=10), cash(0, offsetamt=5000)]))
    assert_consistent(C, "payment with offset/charge")
    ok(api.delete(f"{RP}/{pno}"))
    ok(api.delete(f"{RP}/{rno}"))
    assert api.delete(f"{RP}/{rno}").status_code == 404
    assert_consistent(C, "rp delete")


def test_rp_input_rules(api):
    before = snapshot(C)
    # 현금과 어음 한 전표에 혼합 불가 / 금액 없는 행 / 만기 < 발행일 / 소수 3자리
    for items in ([cash(1000), note(1000, "MIX-1")], [cash(0)], [note(1000, "BAD-1", maturity="2026-10-01")],
                  [cash("1.001")], [{"cashamt": "1000", "instrumenttype": "PROMISSORY"}]):
        response = api.put(RP, json=rp_payload("2026-11-10", "RECEIPT", "C001", "매출처A", items))
        assert response.status_code == 422, (items, response.text)
    assert snapshot(C) == before


def test_rp_rejects_unknown_customer_and_uses_master_name(api):
    """원래 BUG (실행 시작 시점 코드): save_document 가 거래처를 마스터로 검증하지 않아 없는 코드 · 다른 이름도 저장됨.
    리드가 수정 중 (ReceiptPayment.py 거래처 검증 추가) → 없는 코드는 400, 이름은 마스터 이름으로 저장되어야 한다."""
    before = snapshot(C)
    r1 = api.put(RP, json=rp_payload("2026-11-10", "RECEIPT", "ZZZ999", "없는거래처", [cash(1000)]))
    if r1.status_code == 200:
        api.delete(f"{RP}/{r1.json()['receiptno']}")
    assert r1.status_code == 400, r1.text
    assert snapshot(C) == before
    r2 = api.put(RP, json=rp_payload("2026-11-10", "RECEIPT", "C001", "엉뚱한이름", [cash(1000)]))
    if r2.status_code == 200:
        receiptno = r2.json()["receiptno"]
        stored = one("SELECT customname FROM receiptpayment01t WHERE companyid = %s AND receiptno = %s", (C, receiptno))["customname"]
        api.delete(f"{RP}/{receiptno}")
        assert stored == "매출처A", f"거래처명이 마스터와 다르게 저장됨: {stored}"
    else:
        assert r2.status_code == 400, r2.text
    assert snapshot(C) == before


def test_instrument_lifecycle_endorse_settle_dishonor(api, trade):
    recv0, _ = ledger_of("C001")
    _, pay0 = ledger_of("V001")
    rno = save_rp(api, rp_payload("2026-11-10", "RECEIPT", "C001", "매출처A",
                                  [note(200000, "N-001"), note(150000, "N-002", itype="ELECTRONIC")]))
    assert line_status(rno, 1)["instrumentstatus"] == "HELD"
    assert ledger_of("C001")[0] == recv0 - D(350000)
    assert_consistent(C, "notes received")

    # 같은 어음번호 · 발행회사 다시 수금 → 막힘
    before = snapshot(C)
    save_rp(api, rp_payload("2026-11-11", "RECEIPT", "C002", "매출처B", [note(1, "n-001", issuer="발행사a")]), expect=400)
    assert snapshot(C) == before

    # 배서: 보유어음 N-001 로 매입처 지급
    held = ok(api.get("/api/receipt-payment/held-instruments"))["items"]
    assert {(h["receiptno"], h["lineno"]) for h in held} >= {(rno, 1), (rno, 2)}
    pno = save_rp(api, rp_payload("2026-11-15", "PAYMENT", "V001", "매입처A",
                                  [{"instrumentamt": "1", "source_receiptno": rno, "source_lineno": 1}]))
    pay_line = one("SELECT * FROM receiptpayment02t WHERE companyid = %s AND receiptno = %s", (C, pno))
    assert pay_line["instrumentamt"] == D(200000), "배서 금액은 서버가 원본 어음에서 복사해야 함"
    assert line_status(rno, 1)["instrumentstatus"] == "ENDORSED"
    assert ledger_of("V001")[1] == pay0 - D(200000)
    assert_consistent(C, "endorse")
    # 같은 어음 두 번 배서 불가
    before = snapshot(C)
    save_rp(api, rp_payload("2026-11-15", "PAYMENT", "X001", "운송사A", [{"instrumentamt": "1", "source_receiptno": rno, "source_lineno": 1}]),
            expect=400)
    assert snapshot(C) == before
    # 배서된 증권이 있는 수금전표는 수정 · 삭제 불가
    assert api.delete(f"{RP}/{rno}").status_code == 409
    save_rp(api, rp_payload("2026-11-10", "RECEIPT", "C001", "매출처A", [note(200000, "N-001")], receiptno=rno), expect=400)
    assert snapshot(C) == before
    # 배서된 증권은 결제 불가 (부도만)
    process(api, rno, "SETTLE", [1], expect=409)

    # 결제 → 원장 변화 없음 → 처리취소
    ledger_before = expected_ledger(C)
    process(api, rno, "SETTLE", [2])
    assert line_status(rno, 2)["instrumentstatus"] == "SETTLED"
    assert expected_ledger(C) == ledger_before
    assert_consistent(C, "settle")
    process(api, rno, "SETTLE", [2], expect=409)          # 두 번 결제 불가
    process(api, rno, "CANCEL", [2])
    assert line_status(rno, 2) == {"instrumentstatus": "HELD", "processdate": None}
    # 할인
    process(api, rno, "DISCOUNT", [2])
    assert line_status(rno, 2)["instrumentstatus"] == "DISCOUNTED"
    process(api, rno, "CANCEL", [2])
    assert_consistent(C, "discount/cancel")

    # 배서된 어음 부도 → 수금 · 지급 둘 다 되살아남
    process(api, rno, "DISHONOR", [1], processdate="2026-11-25")
    assert line_status(rno, 1)["instrumentstatus"] == "DISHONORED"
    assert one("SELECT instrumentstatus FROM receiptpayment02t WHERE companyid = %s AND receiptno = %s", (C, pno))["instrumentstatus"] == "DISHONORED"
    assert ledger_of("C001")[0] == recv0 - D(150000)
    assert ledger_of("V001")[1] == pay0
    assert_consistent(C, "dishonor endorsed")
    # 부도 처리된 지급전표는 삭제 불가
    assert api.delete(f"{RP}/{pno}").status_code == 409
    process(api, rno, "CANCEL", [1])
    assert line_status(rno, 1)["instrumentstatus"] == "ENDORSED"
    assert_consistent(C, "dishonor cancel")

    # 지급 삭제 → 어음은 다시 보관
    ok(api.delete(f"{RP}/{pno}"))
    assert line_status(rno, 1)["instrumentstatus"] == "HELD"
    # 보관 어음 직접 부도 → 원장 반영 → 취소
    process(api, rno, "DISHONOR", [2])
    assert ledger_of("C001")[0] == recv0 - D(200000)
    assert_consistent(C, "dishonor held")
    process(api, rno, "CANCEL", [2])
    ok(api.delete(f"{RP}/{rno}"))
    assert ledger_of("C001")[0] == recv0
    assert_consistent(C, "instrument cleanup")


def test_own_note_payment_settle_only(api, trade):
    pno = save_rp(api, rp_payload("2026-11-16", "PAYMENT", "V001", "매입처A", [note(300000, "OWN-1", kind="OWN")]))
    assert line_status(pno, 1)["instrumentstatus"] == "HELD"
    process(api, pno, "DISHONOR", [1], expect=409)       # 자수 어음은 결제 · 취소만
    process(api, pno, "SETTLE", [1])
    assert line_status(pno, 1)["instrumentstatus"] == "SETTLED"
    assert api.delete(f"{RP}/{pno}").status_code == 409  # 처리된 증권 → 삭제 불가
    process(api, pno, "CANCEL", [1])
    assert_consistent(C, "own note")
    ok(api.delete(f"{RP}/{pno}"))


def test_ledger_api_matches_independent_computation(api, trade):
    rno = save_rp(api, rp_payload("2026-11-10", "RECEIPT", "C001", "매출처A", [cash("250000.5")]))
    expected = expected_ledger(C)
    body = ok(api.get("/api/customer-ledger/balances", params={"date_from": "2000-01-01", "date_to": "2099-12-31"}))
    listed = {r["customcode"]: (D(r["recv_close"]), D(r["pay_close"])) for r in body["items"]}
    for code, (recv, pay) in expected.items():
        assert listed.get(code, (D(0), D(0))) == (recv, pay), code
    single = ok(api.get("/api/customer-ledger/ledger", params={"ckey": "C001", "date_from": "2026-11-06", "date_to": "2099-12-31"}))
    assert D(single["closing"]["recv"]) == expected["C001"][0]
    # 기간 중간부터 조회: 이월 + 기간 증감 == 기말
    assert D(single["opening"]["recv"]) + sum(D(l["sales"]) - D(l["receipt"]) for l in single["lines"]) == D(single["closing"]["recv"])
    # 기간 경계: 11-05 매출은 11-06 조회의 이월에 들어가야 함
    assert D(single["opening"]["recv"]) == D(1000000)
    ok(api.delete(f"{RP}/{rno}"))
    assert_consistent(C, "ledger api")


def test_ledger_start_date_cuts_history_consistently(api, trade):
    """원장 시작일: 그 이전 전표는 빼고 기초잔액만. 목록 · 단일 · 현황판 · 여신 잔액이 모두 같은 규칙이어야 한다."""
    from datetime import date
    from decimal import Decimal

    import db
    from services.receiptpayment import CustomerLedger as ledger

    early = save_rp(api, rp_payload("2026-11-03", "RECEIPT", "C001", "매출처A", [cash(111)]))      # 시작일 이전 → 제외
    late = save_rp(api, rp_payload("2026-11-10", "RECEIPT", "C001", "매출처A", [cash(222)]))       # 포함
    ok(api.put("/api/customer-ledger/settings", json={"ledgerstartdate": "2026-11-05"}))
    try:
        # 기대값: 기초(0) + 11-05 매출 1,000,000 − 11-10 수금 222  (11-02 매입 · 11-03 수금은 제외)
        want_recv = Decimal("1000000") - Decimal("222")
        listed = {r["customcode"]: r for r in ledger.list_balances(C, date(2026, 1, 1), date(2099, 12, 31))["items"]}
        assert Decimal(listed["C001"]["recv_close"]) == want_recv
        assert Decimal(listed["V001"]["pay_close"]) == Decimal("50000"), "시작일 이전 매입은 빠지고 기초 미지급만"
        single = ledger.get_ledger(C, "C001", date(2026, 1, 1), date(2099, 12, 31))
        assert Decimal(single["closing"]["recv"]) == want_recv
        dash = ledger.dashboard(C, date(2099, 12, 31), ckey="C001")
        assert Decimal(dash["summary"]["receivable"]) == want_recv
        with db.connect() as connection, connection.cursor() as cursor:
            assert Decimal(ledger.receivable_balance(cursor, C, "C001")) == want_recv
    finally:
        ok(api.put("/api/customer-ledger/settings", json={"ledgerstartdate": None}))
    ok(api.delete(f"{RP}/{early}"))
    ok(api.delete(f"{RP}/{late}"))
    assert_consistent(C, "ledger start date")
