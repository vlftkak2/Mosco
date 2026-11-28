"""승인 통제 (control/Approval.py): 정책이 켜진 회사(T03)에서 요청 · 예약 · 승인 · 반려 · 취소가 데이터를 지키는지."""
import json

from helpers import (D, T03_APPROVER, T03_USER, create_inbound, execute, inbound_line, ok, one, outbound_line,
                     outbound_payload, rows, rp_payload, scalar, snapshot)
from integrity import assert_consistent, expected_ledger
from test_20_stock_flows import process_payload
from test_30_receipt_payment import RP, cash

C = "T03"


def request_row(requestno):
    return one("SELECT * FROM approval_request01t WHERE companyid = %s AND requestno = %s", (C, requestno))


def test_outbound_request_reserves_stock_until_decided(api):
    inno, (key,) = create_inbound(api, "2026-11-02", user=T03_APPROVER, lines=[inbound_line(qty="10", weight="1000")])
    before = snapshot(C)
    body = ok(api.post("/api/outbound-register/receipts", T03_USER, json=outbound_payload("2026-11-05", [outbound_line(key, 6, 600)])))
    assert body.get("pending_approval") is True, body
    requestno = body["requestno"]
    assert scalar("SELECT COUNT(*) FROM outbound01t WHERE companyid = %s", (C,)) == 0, "요청만 만들고 전표는 아직 없어야 함"
    req = request_row(requestno)
    assert req["status"] == "PENDING" and req["reservations"], req["reservations"]
    assert snapshot(C)["currentstock01t"] == before["currentstock01t"], "예약은 재고 수량을 바꾸지 않는다"

    # 예약된 6개를 다른 경로로 가져갈 수 없다 (승인자 본인 저장 · 이동 · 가공) — 남은 4개까지만
    after_request = snapshot(C)
    for method, path, payload in (
        ("POST", "/api/outbound-register/receipts", outbound_payload("2026-11-06", [outbound_line(key, 5, 500)])),
        ("POST", "/api/inoutmove-register/documents", {"receiptno": "", "receptdate": "2026-11-06", "fromwarehousecode": "W1",
                                                       "towarehousecode": "W2", "manager": "", "description": "",
                                                       "items": [{"stocksourcetype": key[0], "stocksourceno": key[1], "stocksourceline": key[2], "qty": "5"}]}),
        ("POST", "/api/item-process-register/documents", process_payload(key, processdate="2026-11-06", qty="5", weight="500")),
    ):
        response = api.call(method, path, T03_APPROVER, json=payload)
        assert response.status_code == 400, (path, response.status_code, response.text[:300])
        assert snapshot(C) == after_request, f"{path} changed data while stock was reserved"
    # 마감: 대기 요청이 있는 달은 마감 불가
    assert api.post("/api/month-close/close", T03_APPROVER, json={"month": "2026-11"}).status_code == 409
    # 요청자는 승인 불가, 승인자는 승인
    assert api.post(f"/api/control/requests/{requestno}/approve", T03_USER).status_code in (400, 403)
    result = ok(api.post(f"/api/control/requests/{requestno}/approve", T03_APPROVER))
    outno = result["result_no"]
    assert request_row(requestno)["status"] == "APPROVED" and request_row(requestno)["reservations"] == []
    line = one("SELECT qty, weight FROM outbound02t WHERE companyid = %s AND receiptno = %s", (C, outno))
    assert (line["qty"], line["weight"]) == (D(6), D(600))
    assert api.post(f"/api/control/requests/{requestno}/approve", T03_APPROVER).status_code == 400   # 두 번 승인 불가
    assert scalar("SELECT COUNT(*) FROM outbound01t WHERE companyid = %s", (C,)) == 1
    assert_consistent(C, "approved outbound")

    # 반려 → 예약 해제, 전표 없음
    body = ok(api.post("/api/outbound-register/receipts", T03_USER, json=outbound_payload("2026-11-07", [outbound_line(key, 4, 400)])))
    ok(api.post(f"/api/control/requests/{body['requestno']}/reject", T03_APPROVER, json={"reason": "테스트 반려"}))
    assert request_row(body["requestno"])["status"] == "REJECTED"
    assert scalar("SELECT COUNT(*) FROM outbound01t WHERE companyid = %s", (C,)) == 1
    # 취소 → 예약 해제
    body = ok(api.post("/api/outbound-register/receipts", T03_USER, json=outbound_payload("2026-11-07", [outbound_line(key, 4, 400)])))
    assert api.post(f"/api/control/requests/{body['requestno']}/cancel", T03_APPROVER).status_code == 400   # 남의 요청 취소 불가
    ok(api.post(f"/api/control/requests/{body['requestno']}/cancel", T03_USER))
    # 이제 남은 4개는 누구나 사용 가능
    out2 = ok(api.post("/api/outbound-register/receipts", T03_APPROVER, json=outbound_payload("2026-11-08", [outbound_line(key, 4, 400)])))["receiptno"]
    assert_consistent(C, "after reject/cancel")
    ok(api.delete(f"/api/outbound-register/receipts/{out2}", T03_APPROVER))
    ok(api.delete(f"/api/outbound-register/receipts/{outno}", T03_APPROVER))
    ok(api.delete(f"/api/inbound-register/receipts/{inno}", T03_APPROVER))
    assert_consistent(C, "approval cleanup")


def test_inbound_delete_request_and_fingerprint(api):
    inno, (key,) = create_inbound(api, "2026-11-02", user=T03_APPROVER, lines=[inbound_line(qty="10", weight="1000")])
    body = ok(api.delete(f"/api/inbound-register/receipts/{inno}", T03_USER))
    assert body.get("pending_approval") is True, body
    requestno = body["requestno"]
    assert rows("SELECT 1 FROM inbound01t WHERE companyid = %s AND receiptno = %s", (C, inno)), "요청만, 삭제는 승인 후"
    # 삭제 요청 중인 매입의 재고는 쓸 수 없음
    before = snapshot(C)
    assert api.post("/api/outbound-register/receipts", T03_APPROVER, json=outbound_payload("2026-11-05", [outbound_line(key, 1, 100)])).status_code == 400
    assert snapshot(C) == before
    # 대기 중인 전표는 누구도 다시 고치거나 지울 수 없음
    assert api.patch(f"/api/inbound-register/receipts/{inno}/manager", T03_APPROVER, json={"manager": "x"}).status_code == 400
    assert api.delete(f"/api/inbound-register/receipts/{inno}", T03_APPROVER).status_code == 409
    assert snapshot(C) == before
    # 요청 뒤에 (통제 밖 경로로) 바뀌면 승인 거부 — 지문 비교
    execute("UPDATE inbound01t SET description = 'changed elsewhere' WHERE companyid = %s AND receiptno = %s", (C, inno))
    response = api.post(f"/api/control/requests/{requestno}/approve", T03_APPROVER)
    assert response.status_code == 400, response.text
    assert rows("SELECT 1 FROM inbound01t WHERE companyid = %s AND receiptno = %s", (C, inno))
    assert request_row(requestno)["status"] == "PENDING" and request_row(requestno)["last_error"]
    ok(api.post(f"/api/control/requests/{requestno}/reject", T03_APPROVER, json={"reason": "변경됨"}))
    # 다시 요청 → 승인 → 삭제
    requestno = ok(api.delete(f"/api/inbound-register/receipts/{inno}", T03_USER))["requestno"]
    ok(api.post(f"/api/control/requests/{requestno}/approve", T03_APPROVER))
    assert not rows("SELECT 1 FROM inbound01t WHERE companyid = %s AND receiptno = %s", (C, inno))
    assert_consistent(C, "approved inbound delete")


def test_receipt_request_and_credit_check(api):
    inno, (key,) = create_inbound(api, "2026-11-02", user=T03_APPROVER, lines=[inbound_line(qty="10", weight="1000")])
    out = ok(api.post("/api/outbound-register/receipts", T03_APPROVER, json=outbound_payload("2026-11-05", [outbound_line(key, 2, 200, unitprice="1000")])))["receiptno"]
    body = ok(api.put(RP, T03_USER, json=rp_payload("2026-11-10", "RECEIPT", "C001", "매출처A", [cash(50000)])))
    assert body.get("pending_approval") is True
    assert scalar("SELECT COUNT(*) FROM receiptpayment01t WHERE companyid = %s", (C,)) == 0
    rpno = ok(api.post(f"/api/control/requests/{body['requestno']}/approve", T03_APPROVER))["result_no"]
    assert one("SELECT created_by FROM receiptpayment01t WHERE companyid = %s AND receiptno = %s", (C, rpno))["created_by"] == T03_USER
    assert_consistent(C, "approved receipt")

    # 여신 통제: 한도를 넘는 매출 요청에 기록된 미수 잔액 == 원장 잔액
    execute("UPDATE customer01t SET creditlimit = 200000 WHERE companyid = %s AND customercode = 'C001'", (C,))
    execute("""INSERT INTO control_policy01t (companyid, companyname, target, on_create, created_by)
               VALUES (%s, 'T03', 'CREDIT', 'Y', 'pytest') ON CONFLICT (companyid, target) DO UPDATE SET on_create = 'Y'""", (C,))
    try:
        body = ok(api.post("/api/outbound-register/receipts", T03_USER, json=outbound_payload("2026-11-11", [outbound_line(key, 1, 100, unitprice="1000")])))
        assert body.get("pending_approval") is True and body["reason"] == "CREDIT", body
        payload = request_row(body["requestno"])["payload"]
        payload = payload if isinstance(payload, dict) else json.loads(payload)
        ledger_recv = expected_ledger(C)["C001"][0]
        assert D(payload["credit"]["balance"]) == ledger_recv.quantize(D(1)), (payload["credit"], ledger_recv)
        assert D(payload["credit"]["this"]) == D(100000)
        ok(api.post(f"/api/control/requests/{body['requestno']}/reject", T03_APPROVER, json={"reason": "한도"}))
    finally:
        execute("DELETE FROM control_policy01t WHERE companyid = %s AND target = 'CREDIT'", (C,))
        execute("UPDATE customer01t SET creditlimit = NULL WHERE companyid = %s AND customercode = 'C001'", (C,))
    ok(api.delete(f"{RP}/{rpno}", T03_APPROVER))
    ok(api.delete(f"/api/outbound-register/receipts/{out}", T03_APPROVER))
    ok(api.delete(f"/api/inbound-register/receipts/{inno}", T03_APPROVER))
    assert_consistent(C, "credit cleanup")


def test_concurrent_double_approval(api):
    from test_60_concurrency_rounding import run_parallel

    inno, (key,) = create_inbound(api, "2026-11-02", user=T03_APPROVER, lines=[inbound_line(qty="10", weight="1000")])
    requestno = ok(api.post("/api/outbound-register/receipts", T03_USER, json=outbound_payload("2026-11-05", [outbound_line(key, 6, 600)])))["requestno"]
    results = run_parallel([lambda: api.post(f"/api/control/requests/{requestno}/approve", T03_APPROVER) for _ in range(3)])
    codes = [getattr(r, "status_code", repr(r)) for r in results]
    assert codes.count(200) == 1 and all(c in (200, 400) for c in codes), codes
    assert scalar("SELECT COUNT(*) FROM outbound01t WHERE companyid = %s", (C,)) == 1
    assert_consistent(C, "double approval")
    outno = next(r.json()["result_no"] for r in results if r.status_code == 200)
    ok(api.delete(f"/api/outbound-register/receipts/{outno}", T03_APPROVER))
    ok(api.delete(f"/api/inbound-register/receipts/{inno}", T03_APPROVER))
