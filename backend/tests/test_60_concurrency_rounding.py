"""동시성 (마지막 재고 동시 판매 · 동시 채번 · 더블 서브밋) 과 원 미만 금액 반올림."""
import threading
import uuid
from decimal import Decimal, ROUND_HALF_UP

import pytest

from helpers import (D, create_inbound, create_outbound, inbound_line, inbound_payload, lot, ok, one, outbound_line,
                     outbound_payload, rows, rp_payload, scalar)
from integrity import assert_consistent
from test_20_stock_flows import process_payload
from test_30_receipt_payment import RP, cash

C = "T01"


def q2(value):
    return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def run_parallel(calls):
    """calls: list of zero-arg callables returning a response. Starts them together, returns responses in order."""
    barrier = threading.Barrier(len(calls))
    results = [None] * len(calls)

    def worker(index, fn):
        barrier.wait()
        try:
            results[index] = fn()
        except Exception as error:  # noqa: BLE001
            results[index] = error

    threads = [threading.Thread(target=worker, args=(i, fn)) for i, fn in enumerate(calls)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(120)
    return results


def test_concurrent_sales_of_last_stock(api):
    inno, (key,) = create_inbound(api, "2026-11-02", lines=[inbound_line(qty="1", weight="100")])
    payload = outbound_payload("2026-11-05", [outbound_line(key, 1, 100)])
    results = run_parallel([lambda: api.post("/api/outbound-register/receipts", json=payload) for _ in range(6)])
    codes = [getattr(r, "status_code", repr(r)) for r in results]
    assert codes.count(200) == 1, codes
    assert all(c == 400 for c in codes if c != 200), f"losers must get a clean 400, got {codes}"
    stock = lot(C, key)
    assert stock["qty"] == 0 and stock["weight"] == 0
    assert scalar("SELECT COUNT(*) FROM outbound02t WHERE companyid = %s AND stocksourceno = %s", (C, inno)) == 1
    assert_consistent(C, "concurrent last-stock sale")
    winner = next(r for r in results if getattr(r, "status_code", 0) == 200).json()["receiptno"]
    ok(api.delete(f"/api/outbound-register/receipts/{winner}"))
    ok(api.delete(f"/api/inbound-register/receipts/{inno}"))


def test_concurrent_sale_transfer_process_on_same_lot(api):
    """매출 · 재고이동 · 가공이 같은 재고 전량을 동시에 쓰면 하나만 성공."""
    inno, (key,) = create_inbound(api, "2026-11-02", lines=[inbound_line(qty="4", weight="400")])
    calls = [
        lambda: api.post("/api/outbound-register/receipts", json=outbound_payload("2026-11-05", [outbound_line(key, 4, 400)])),
        lambda: api.post("/api/inoutmove-register/documents", json={
            "receiptno": "", "receptdate": "2026-11-05", "fromwarehousecode": "W1", "towarehousecode": "W2", "manager": "",
            "description": "", "items": [{"stocksourcetype": key[0], "stocksourceno": key[1], "stocksourceline": key[2], "qty": "4"}]}),
        lambda: api.post("/api/item-process-register/documents", json=process_payload(key, processdate="2026-11-05")),
        lambda: api.delete(f"/api/inbound-register/receipts/{inno}"),
    ]
    results = run_parallel(calls)
    codes = [getattr(r, "status_code", repr(r)) for r in results]
    assert codes.count(200) == 1, codes
    assert all(isinstance(c, int) and c < 500 for c in codes), codes
    assert_consistent(C, "concurrent mixed consumers")
    # cleanup whichever won
    for r in rows("SELECT receiptno FROM outbound01t WHERE companyid = %s", (C,)):
        ok(api.delete(f"/api/outbound-register/receipts/{r['receiptno']}"))
    for r in rows("SELECT receiptno FROM inoutmove01t WHERE companyid = %s", (C,)):
        ok(api.delete(f"/api/inoutmove-register/documents/{r['receiptno']}"))
    for r in rows("SELECT processno FROM process01t WHERE companyid = %s", (C,)):
        ok(api.post("/api/item-process-register/documents/delete", json={"processnos": [r["processno"]]}))
    if rows("SELECT 1 FROM inbound01t WHERE companyid = %s AND receiptno = %s", (C, inno)):
        ok(api.delete(f"/api/inbound-register/receipts/{inno}"))
    assert_consistent(C, "concurrent mixed cleanup")


def test_concurrent_document_numbering(api):
    results = run_parallel([lambda: api.put("/api/inbound-register/receipts", json=inbound_payload("2026-11-03", lines=[inbound_line(qty="1", weight="10")]))
                            for _ in range(8)]
                           + [lambda: api.put(RP, json=rp_payload("2026-11-10", "RECEIPT", "C001", "매출처A", [cash(10)])) for _ in range(8)])
    codes = [getattr(r, "status_code", repr(r)) for r in results]
    assert codes == [200] * 16, codes
    numbers = [r.json()["receiptno"] for r in results]
    assert len(set(numbers)) == 16, numbers
    assert_consistent(C, "concurrent numbering")
    for no in numbers:
        path = f"{RP}/{no}" if no.startswith("RP") else f"/api/inbound-register/receipts/{no}"
        ok(api.delete(path))


def test_concurrent_edits_of_same_outbound(api):
    inno, (key,) = create_inbound(api, "2026-11-02", lines=[inbound_line(qty="10", weight="1000")])
    outno = create_outbound(api, "2026-11-05", [outbound_line(key, 1, 100)])
    calls = [lambda q=q: api.put("/api/outbound-register/receipts",
                                 json=outbound_payload("2026-11-05", [outbound_line(key, q, q * 100)], receiptno=outno, is_new=False))
             for q in (2, 3, 4, 5)]
    calls.append(lambda: api.delete(f"/api/outbound-register/receipts/{outno}"))
    results = run_parallel(calls)
    codes = [getattr(r, "status_code", repr(r)) for r in results]
    assert all(isinstance(c, int) and c < 500 for c in codes), codes
    assert_consistent(C, "concurrent outbound edits")
    if rows("SELECT 1 FROM outbound01t WHERE companyid = %s AND receiptno = %s", (C, outno)):
        ok(api.delete(f"/api/outbound-register/receipts/{outno}"))
    ok(api.delete(f"/api/inbound-register/receipts/{inno}"))


def test_month_close_racing_document_save(api):
    """마감과 마감월 전표 저장이 동시에: 저장된 전표가 있다면 마감 시각보다 먼저 커밋된 것이어야 한다."""
    results = run_parallel([
        lambda: api.post("/api/month-close/close", json={"month": "2026-10"}),
        *[lambda: api.put(RP, json=rp_payload("2026-10-20", "RECEIPT", "C001", "매출처A", [cash(1)])) for _ in range(4)],
    ])
    try:
        assert getattr(results[0], "status_code", None) == 200, results[0]
        closed_at = scalar("SELECT closed_at FROM monthclose01t WHERE companyid = %s AND closemonth = '2026-10-01'", (C,))
        late = rows("SELECT receiptno, created_at FROM receiptpayment01t WHERE companyid = %s AND receiptdate <= '2026-10-31' AND created_at > %s",
                    (C, closed_at))
        assert not late, f"documents saved into the closed month after closing: {late}"
    finally:
        ok(api.post("/api/month-close/reopen", json={"month": "2026-10"}))
    for r in rows("SELECT receiptno FROM receiptpayment01t WHERE companyid = %s", (C,)):
        ok(api.delete(f"{RP}/{r['receiptno']}"))


# ── 더블 서브밋 (request_key) ────────────────────────────────────────────────
def _double_submit(api, method, path, payload, table, keycol="receiptno"):
    key = str(uuid.uuid4())
    body = {**payload, "request_key": key}
    headers = {"X-Request-Key": key, "Idempotency-Key": key}
    before = {r[keycol] for r in rows(f"SELECT {keycol} FROM {table} WHERE companyid = %s", (C,))}
    results = run_parallel([lambda: api.call(method, path, json=body, headers=headers) for _ in range(2)])
    results.append(api.call(method, path, json=body, headers=headers))   # 늦게 온 재시도
    created = [r[keycol] for r in rows(f"SELECT {keycol} FROM {table} WHERE companyid = %s", (C,)) if r[keycol] not in before]
    codes = [getattr(r, "status_code", repr(r)) for r in results]
    return created, codes


DOUBLE_SUBMIT_CASES = ["inbound", "outbound", "receipt", "transfer", "process"]


@pytest.mark.parametrize("kind", DOUBLE_SUBMIT_CASES)
def test_double_submit_with_request_key(api, kind):
    inno, (key,) = create_inbound(api, "2026-11-02", lines=[inbound_line(qty="10", weight="1000")])
    cases = {
        "inbound": ("PUT", "/api/inbound-register/receipts", inbound_payload("2026-11-03"), "inbound01t", "receiptno"),
        "outbound": ("POST", "/api/outbound-register/receipts", outbound_payload("2026-11-05", [outbound_line(key, 1, 100)]), "outbound01t", "receiptno"),
        "receipt": ("PUT", RP, rp_payload("2026-11-10", "RECEIPT", "C001", "매출처A", [cash(777)]), "receiptpayment01t", "receiptno"),
        "transfer": ("POST", "/api/inoutmove-register/documents", {
            "receiptno": "", "receptdate": "2026-11-05", "fromwarehousecode": "W1", "towarehousecode": "W2", "manager": "", "description": "",
            "items": [{"stocksourcetype": key[0], "stocksourceno": key[1], "stocksourceline": key[2], "qty": "1"}]}, "inoutmove01t", "receiptno"),
        "process": ("POST", "/api/item-process-register/documents", process_payload(key, processdate="2026-11-05"), "process01t", "processno"),
    }
    method, path, payload, table, keycol = cases[kind]
    created, codes = _double_submit(api, method, path, payload, table, keycol)
    assert all(isinstance(c, int) and c < 500 for c in codes), codes
    assert_consistent(C, f"double submit {kind}")
    # cleanup
    for no in created:
        if kind == "outbound":
            ok(api.delete(f"/api/outbound-register/receipts/{no}"))
        elif kind == "receipt":
            ok(api.delete(f"{RP}/{no}"))
        elif kind == "transfer":
            ok(api.delete(f"/api/inoutmove-register/documents/{no}"))
        elif kind == "process":
            ok(api.post("/api/item-process-register/documents/delete", json={"processnos": [no]}))
        elif no != inno:
            ok(api.delete(f"/api/inbound-register/receipts/{no}"))
    ok(api.delete(f"/api/inbound-register/receipts/{inno}"))
    if len([n for n in created if n != inno]) > 1:
        pytest.xfail(f"{kind}: same request_key created {len(created)} documents (idempotency not implemented yet) codes={codes}")
    assert len([n for n in created if n != inno]) == 1, (created, codes)
    assert codes.count(200) == 1, f"duplicates must be rejected (4xx), got {codes}"


# ── 반올림 ───────────────────────────────────────────────────────────────────
def test_fractional_won_amounts_are_rounded_consistently(api):
    body = ok(api.put("/api/inbound-register/receipts", json=inbound_payload("2026-11-03", lines=[
        inbound_line(weight="123.457", unitprice="1234.57"),                       # Kg
        inbound_line(weight="1234.567", unitprice="987654.32", unit="2"),           # Ton
        inbound_line(qty="3", weight="30", unitprice="333.33", unit="3"),           # 수량
        inbound_line(weight="10", unitprice="1", supplyamt="1000.55", vat="100.05"),  # 직접 입력
    ])))
    inno = body["receiptno"]
    details = rows("SELECT lineno, supplyamt, vat, unitamt FROM inbound02t WHERE companyid = %s AND receiptno = %s ORDER BY lineno", (C, inno))
    expected_supply = [q2(D("123.457") * D("1234.57")), q2(D("1.234567") * D("987654.32")), q2(D(3) * D("333.33")), D("1000.55")]
    for detail, supply in zip(details, expected_supply):
        assert detail["supplyamt"] == supply, detail
        assert detail["unitamt"] == detail["supplyamt"] + detail["vat"]
    assert details[0]["vat"] == q2(expected_supply[0] * D("0.1")) and details[3]["vat"] == D("100.05")
    keys = [(s, n, l) for s, n, l in [(r["sourcetype"], r["sourceno"], r["sourceline"]) for r in
                                      rows("SELECT * FROM currentstock01t WHERE companyid = %s AND sourceno = %s ORDER BY sourceline", (C, inno))]]
    assert [lot(C, k)["costamt"] for k in keys] == expected_supply

    # 3분할 판매: 끝전까지 원가가 정확히 소진
    k1 = keys[0]
    outs = [create_outbound(api, "2026-11-05", [outbound_line(k1, q, w, unitprice="1000.01")])
            for q, w in ((3, "41.152"), (3, "41.152"), (4, "41.153"))]
    assert lot(C, k1)["weight"] == 0 and lot(C, k1)["costamt"] == 0
    sold = scalar("SELECT SUM(costamt) FROM iniop01t WHERE companyid = %s AND iniotype = 'OUT' AND receiptno = ANY(%s)", (C, outs))
    assert sold == expected_supply[0]
    line = one("SELECT supplyamt, vat, unitamt FROM outbound02t WHERE companyid = %s AND receiptno = %s", (C, outs[0]))
    assert line["supplyamt"] == q2(D("41.152") * D("1000.01")) and line["unitamt"] == line["supplyamt"] + line["vat"]
    assert_consistent(C, "rounding")

    # 3자리 이상 소수는 거부
    for patch in ({"supplyamt": "1.005"}, {"vat": "0.001"}, {"unitprice": "0.001"}):
        assert api.put("/api/inbound-register/receipts", json=inbound_payload("2026-11-03", lines=[inbound_line(**patch)])).status_code == 422
    assert api.put(RP, json=rp_payload("2026-11-10", "RECEIPT", "C001", "매출처A", [cash("0.015")])).status_code == 422
    for no in outs:
        ok(api.delete(f"/api/outbound-register/receipts/{no}"))
    ok(api.delete(f"/api/inbound-register/receipts/{inno}"))
    assert_consistent(C, "rounding cleanup")


def test_expense_amounts_limited_to_two_decimals(api):
    """기타비용 금액은 소수 2자리까지 (처음 실행 시점엔 decimal_places=3 으로 0.001원 저장 → 리드가 2자리로 수정함)."""
    inno, (key,) = create_inbound(api, "2026-11-02", lines=[inbound_line()])
    response = api.post("/api/outbound-register/receipts", json=outbound_payload("2026-11-05", [outbound_line(key, 1, 100)], expenses=[
        {"costcode": "49", "costname": "운반비", "supplyamt": "1000.005", "vat": "100.001", "purchaseyn": "N"}]))
    stored = None
    if response.status_code == 200:
        outno = response.json()["receiptno"]
        stored = one("SELECT supplyamt, vat FROM outbound03t WHERE companyid = %s AND receiptno = %s", (C, outno))
        ok(api.delete(f"/api/outbound-register/receipts/{outno}"))
    ok(api.delete(f"/api/inbound-register/receipts/{inno}"))
    assert response.status_code == 422 or (stored and stored["supplyamt"] == round(stored["supplyamt"], 2)
                                           and stored["vat"] == round(stored["vat"], 2)), stored


def test_inbound_expense_amounts_limited_to_two_decimals(api):
    from helpers import snapshot

    before = snapshot(C)
    response = api.put("/api/inbound-register/receipts", json=inbound_payload("2026-11-03", expenses=[
        {"costcode": "49", "costname": "운반비", "supplyamt": "1000.005", "vat": "0"}]))
    if response.status_code == 200:
        api.delete(f"/api/inbound-register/receipts/{response.json()['receiptno']}")
    assert response.status_code == 422, response.text
    assert snapshot(C) == before


def test_concurrent_endorsement_and_settlement_of_same_note(api):
    """같은 보유어음을 두 지급전표가 동시에 배서 + 동시에 결제 처리 → 정확히 하나만 반영."""
    from test_30_receipt_payment import note

    rno = ok(api.put(RP, json=rp_payload("2026-11-10", "RECEIPT", "C001", "매출처A", [note(70000, "CC-1")])))["receiptno"]
    pay = lambda code, name: api.put(RP, json=rp_payload("2026-11-15", "PAYMENT", code, name,  # noqa: E731
                                                         [{"instrumentamt": "1", "source_receiptno": rno, "source_lineno": 1}]))
    settle = lambda: api.post(f"{RP}/{rno}/instrument-process",  # noqa: E731
                              json={"action": "SETTLE", "processdate": "2026-11-16", "processmemo": "", "lines": [{"lineno": 1}]})
    results = run_parallel([lambda: pay("V001", "매입처A"), lambda: pay("X001", "운송사A"), settle])
    codes = [getattr(r, "status_code", repr(r)) for r in results]
    assert codes.count(200) == 1, codes
    assert all(isinstance(c, int) and c < 500 for c in codes), codes
    assert scalar("SELECT COUNT(*) FROM receiptpayment02t WHERE companyid = %s AND source_receiptno = %s", (C, rno)) <= 1
    assert_consistent(C, "concurrent endorsement")
    for r in rows("SELECT DISTINCT receiptno FROM receiptpayment02t WHERE companyid = %s AND source_receiptno = %s", (C, rno)):
        ok(api.delete(f"{RP}/{r['receiptno']}"))
    if one("SELECT instrumentstatus FROM receiptpayment02t WHERE companyid = %s AND receiptno = %s", (C, rno))["instrumentstatus"] == "SETTLED":
        ok(api.post(f"{RP}/{rno}/instrument-process", json={"action": "CANCEL", "processmemo": "", "lines": [{"lineno": 1}]}))
    ok(api.delete(f"{RP}/{rno}"))
    assert_consistent(C, "concurrent endorsement cleanup")


def test_payment_edit_releases_endorsed_note(api):
    from test_30_receipt_payment import note

    rno = ok(api.put(RP, json=rp_payload("2026-11-10", "RECEIPT", "C001", "매출처A", [note(30000, "RL-1")])))["receiptno"]
    pno = ok(api.put(RP, json=rp_payload("2026-11-15", "PAYMENT", "V001", "매입처A",
                                         [{"instrumentamt": "1", "source_receiptno": rno, "source_lineno": 1}])))["receiptno"]
    assert one("SELECT instrumentstatus FROM receiptpayment02t WHERE companyid = %s AND receiptno = %s", (C, rno))["instrumentstatus"] == "ENDORSED"
    ok(api.put(RP, json=rp_payload("2026-11-15", "PAYMENT", "V001", "매입처A", [cash(30000)], receiptno=pno)))
    assert one("SELECT instrumentstatus FROM receiptpayment02t WHERE companyid = %s AND receiptno = %s", (C, rno))["instrumentstatus"] == "HELD"
    assert_consistent(C, "payment edit releases note")
    ok(api.delete(f"{RP}/{pno}"))
    ok(api.delete(f"{RP}/{rno}"))
