"""월마감: 마감한 달의 전표는 모든 문서 유형에서 등록 · 수정 · 삭제(일자를 마감월 안으로/밖으로 옮기기 포함)가 막혀야 한다."""
import pytest

from helpers import (create_inbound, create_outbound, inbound_line, inbound_payload, lot, ok, one, outbound_line,
                     outbound_payload, rows, rp_payload, scalar, snapshot)
from integrity import assert_consistent
from test_20_stock_flows import process_payload, stand_item, transfer
from test_30_receipt_payment import RP, cash, note

C = "T01"
CLOSED = "2026-10"
OCT, OCT2, NOV, NOV2 = "2026-10-15", "2026-10-20", "2026-11-05", "2026-11-06"


@pytest.fixture
def docs(api):
    d = {}
    d["in_oct"], (d["lot_oct"],) = create_inbound(api, "2026-10-10", lines=[inbound_line(qty="20", weight="2000")])
    d["in_oct_unused"], _ = create_inbound(api, "2026-10-11", lines=[inbound_line(qty="1", weight="100")])
    d["in_nov"], (d["lot_nov"],) = create_inbound(api, "2026-11-02", lines=[inbound_line(qty="10", weight="1000")])
    d["out_oct"] = create_outbound(api, OCT, [outbound_line(d["lot_oct"], 1, 100)])
    d["out_nov"] = create_outbound(api, NOV, [outbound_line(d["lot_oct"], 1, 100)])
    d["mv_oct"] = transfer(api, OCT2, "W1", "W2", [(d["lot_oct"], 1)])["receiptno"]
    d["pr_oct"] = ok(api.post("/api/item-process-register/documents", json=process_payload(d["lot_oct"], processdate="2026-10-25")))["processno"]
    d["pr_nov"] = ok(api.post("/api/item-process-register/documents", json=process_payload(d["lot_nov"], processdate=NOV2)))["processno"]
    existing = {r["lineno"] for r in rows("SELECT lineno FROM standstock01t WHERE companyid = %s", (C,))}
    ok(api.post("/api/stock-stand/items", json={"standdate": "2026-10-01", "items": [stand_item()]}))
    d["st_oct"] = next(r["lineno"] for r in rows("SELECT lineno FROM standstock01t WHERE companyid = %s", (C,)) if r["lineno"] not in existing)
    d["rp_oct"] = ok(api.put(RP, json=rp_payload("2026-10-28", "RECEIPT", "C001", "매출처A", [cash(1000)])))["receiptno"]
    d["rp_nov"] = ok(api.put(RP, json=rp_payload("2026-11-10", "RECEIPT", "C001", "매출처A", [cash(2000)])))["receiptno"]
    d["rp_note_oct"] = ok(api.put(RP, json=rp_payload("2026-10-28", "RECEIPT", "C002", "매출처B",
                                                      [note(5000, "MC-1"), note(6000, "MC-2")])))["receiptno"]
    ok(api.post(f"{RP}/{d['rp_note_oct']}/instrument-process",
                json={"action": "DISHONOR", "processdate": "2026-10-30", "processmemo": "", "lines": [{"lineno": 2}]}))
    assert_consistent(C, "month-close fixtures")
    yield d
    # cleanup (month reopened by the test's finally)
    for no in (d["out_nov"], d["out_oct"]):
        api.delete(f"/api/outbound-register/receipts/{no}")
    api.post("/api/item-process-register/documents/delete", json={"processnos": [d["pr_nov"]]})
    api.post("/api/item-process-register/documents/delete", json={"processnos": [d["pr_oct"]]})
    api.delete(f"/api/inoutmove-register/documents/{d['mv_oct']}")
    api.post(f"{RP}/{d['rp_note_oct']}/instrument-process", json={"action": "CANCEL", "processmemo": "", "lines": [{"lineno": 2}]})
    for no in (d["rp_oct"], d["rp_nov"], d["rp_note_oct"]):
        api.delete(f"{RP}/{no}")
    api.delete("/api/stock-stand/items", json={"delete_all": False, "linenos": [d["st_oct"]]})
    for no in (d["in_oct"], d["in_oct_unused"], d["in_nov"]):
        api.delete(f"/api/inbound-register/receipts/{no}")
    assert scalar("SELECT COUNT(*) FROM inbound01t WHERE companyid = %s", (C,)) == 0
    assert scalar("SELECT COUNT(*) FROM receiptpayment01t WHERE companyid = %s", (C,)) == 0
    assert_consistent(C, "month-close cleanup")


def _blocked_calls(d):
    """(label, method, path, body) — every one must be rejected while 2026-10 is closed."""
    lot_oct, lot_nov = d["lot_oct"], d["lot_nov"]
    return [
        ("inbound create in closed month", "PUT", "/api/inbound-register/receipts", inbound_payload("2026-10-31")),
        ("inbound delete", "DELETE", f"/api/inbound-register/receipts/{d['in_oct_unused']}", None),
        ("inbound manager edit", "PATCH", f"/api/inbound-register/receipts/{d['in_oct_unused']}/manager", {"manager": "x"}),
        ("outbound create in closed month", "POST", "/api/outbound-register/receipts", outbound_payload(OCT, [outbound_line(lot_oct, 1, 100)])),
        ("outbound edit (closed doc)", "PUT", "/api/outbound-register/receipts",
         outbound_payload(OCT, [outbound_line(lot_oct, 2, 200)], receiptno=d["out_oct"], is_new=False)),
        ("outbound date OUT of closed month", "PUT", "/api/outbound-register/receipts",
         outbound_payload(NOV, [outbound_line(lot_oct, 1, 100)], receiptno=d["out_oct"], is_new=False)),
        ("outbound date INTO closed month", "PUT", "/api/outbound-register/receipts",
         outbound_payload(OCT, [outbound_line(lot_oct, 1, 100)], receiptno=d["out_nov"], is_new=False)),
        ("outbound price edit", "PATCH", f"/api/outbound-register/receipts/{d['out_oct']}/sales-fields", {"prices": [{"lineno": 1, "unitprice": "1"}]}),
        ("outbound manager edit", "PATCH", f"/api/outbound-register/receipts/{d['out_oct']}/manager", {"manager": "x"}),
        ("outbound delete", "DELETE", f"/api/outbound-register/receipts/{d['out_oct']}", None),
        ("transfer create in closed month", "POST", "/api/inoutmove-register/documents",
         {"receiptno": "", "receptdate": OCT2, "fromwarehousecode": "W1", "towarehousecode": "W2", "manager": "", "description": "",
          "items": [{"stocksourcetype": lot_oct[0], "stocksourceno": lot_oct[1], "stocksourceline": lot_oct[2], "qty": "1"}]}),
        ("transfer delete", "DELETE", f"/api/inoutmove-register/documents/{d['mv_oct']}", None),
        ("process create in closed month", "POST", "/api/item-process-register/documents", process_payload(lot_oct, processdate="2026-10-26")),
        ("process edit (closed doc)", "POST", "/api/item-process-register/documents", process_payload(lot_oct, processdate="2026-10-25", processno=d["pr_oct"])),
        ("process date OUT of closed month", "POST", "/api/item-process-register/documents", process_payload(lot_oct, processdate=NOV2, processno=d["pr_oct"])),
        ("process date INTO closed month", "POST", "/api/item-process-register/documents", process_payload(lot_nov, processdate="2026-11-03", processno=d["pr_nov"]) | {"processdate": "2026-10-30"}),
        ("process delete", "POST", "/api/item-process-register/documents/delete", {"processnos": [d["pr_oct"]]}),
        ("opening stock create", "POST", "/api/stock-stand/items", {"standdate": "2026-10-02", "items": [stand_item()]}),
        ("opening stock price edit", "PUT", "/api/stock-stand/items/prices", {"items": [{"lineno": d["st_oct"], "unit": "1", "unitprice": "1"}]}),
        ("opening stock delete", "DELETE", "/api/stock-stand/items", {"delete_all": False, "linenos": [d["st_oct"]]}),
        ("opening stock delete all", "DELETE", "/api/stock-stand/items", {"delete_all": True, "linenos": []}),
        ("receipt create in closed month", "PUT", RP, rp_payload("2026-10-29", "RECEIPT", "C001", "매출처A", [cash(1)])),
        ("receipt edit (closed doc)", "PUT", RP, rp_payload("2026-10-28", "RECEIPT", "C001", "매출처A", [cash(9)], receiptno=d["rp_oct"])),
        ("receipt date OUT of closed month", "PUT", RP, rp_payload("2026-11-11", "RECEIPT", "C001", "매출처A", [cash(1000)], receiptno=d["rp_oct"])),
        ("receipt date INTO closed month", "PUT", RP, rp_payload("2026-10-29", "RECEIPT", "C001", "매출처A", [cash(2000)], receiptno=d["rp_nov"])),
        ("receipt delete", "DELETE", f"{RP}/{d['rp_oct']}", None),
        ("instrument settle dated in closed month", "POST", f"{RP}/{d['rp_note_oct']}/instrument-process",
         {"action": "SETTLE", "processdate": "2026-10-31", "processmemo": "", "lines": [{"lineno": 1}]}),
        ("instrument cancel of closed-month processing", "POST", f"{RP}/{d['rp_note_oct']}/instrument-process",
         {"action": "CANCEL", "processmemo": "", "lines": [{"lineno": 2}]}),
    ]


def test_month_close_blocks_every_document_type(api, docs):
    d = docs
    ok(api.post("/api/month-close/close", json={"month": CLOSED}))
    try:
        months = ok(api.get("/api/month-close", params={"year": 2026}))
        assert months["last_closed"] == CLOSED and months["next_closable"] == "2026-11"
        before = snapshot(C)
        leaks = []
        for label, method, path, body in _blocked_calls(d):
            response = api.call(method, path, json=body)
            if response.status_code < 400:
                leaks.append(f"{label}: {response.status_code} {response.text[:200]}")
            elif "마감" not in response.json().get("detail", "") if isinstance(response.json().get("detail"), str) else True:
                leaks.append(f"{label}: rejected for another reason ({response.status_code} {response.text[:200]})")
            after = snapshot(C)
            if after != before:
                leaks.append(f"{label}: data changed although {response.status_code}")
                before = after
        assert not leaks, "closed month was modified:\n  " + "\n  ".join(leaks)
        assert_consistent(C, "attempts on closed month")

        # 마감 이후 달은 계속 가능: 마감월 재고(10월 입고)를 11월에 판매 · 11월 어음 결제
        extra = create_outbound(api, "2026-11-20", [outbound_line(d["lot_oct"], 1, 100)])
        ok(api.post(f"{RP}/{d['rp_note_oct']}/instrument-process",
                    json={"action": "SETTLE", "processdate": "2026-11-20", "processmemo": "", "lines": [{"lineno": 1}]}))
        ok(api.post(f"{RP}/{d['rp_note_oct']}/instrument-process", json={"action": "CANCEL", "processmemo": "", "lines": [{"lineno": 1}]}))
        ok(api.delete(f"/api/outbound-register/receipts/{extra}"))
        assert_consistent(C, "open month while previous closed")

        # 마감 규칙: 중복 · 건너뛰기 · 미래 · 중간 취소 불가
        assert api.post("/api/month-close/close", json={"month": CLOSED}).status_code == 409
        assert api.post("/api/month-close/close", json={"month": "2027-01"}).status_code == 409
        assert api.post("/api/month-close/close", json={"month": "2026-12"}).status_code == 409   # 아직 오지 않은 달 / 건너뛰기
        assert api.post("/api/month-close/reopen", json={"month": "2026-09"}).status_code == 409
    finally:
        ok(api.post("/api/month-close/reopen", json={"month": CLOSED}))

    # 마감 취소 후에는 다시 수정 가능
    ok(api.put("/api/outbound-register/receipts",
               json=outbound_payload(OCT, [outbound_line(d["lot_oct"], 2, 200)], receiptno=d["out_oct"], is_new=False)))
    ok(api.put(RP, json=rp_payload("2026-10-28", "RECEIPT", "C001", "매출처A", [cash(9)], receiptno=d["rp_oct"])))
    ok(api.patch(f"/api/inbound-register/receipts/{d['in_oct_unused']}/manager", json={"manager": "재오픈"}))
    assert_consistent(C, "after reopen")


def test_month_close_db_guard_blocks_direct_sql(api, docs):
    """migration 0001 의 DB 트리거: 앱을 거치지 않은 SQL 로도 마감월 헤더를 바꿀 수 없어야 한다 (상세 · 수불 · 재고 행은 대상 아님)."""
    from helpers import execute

    if not scalar("SELECT COUNT(*) FROM pg_trigger WHERE tgname = 'trg_outbound01t_month_close'"):
        pytest.skip("month-close DB guard (migration 0001) not installed in Mosco_test")
    ok(api.post("/api/month-close/close", json={"month": CLOSED}))
    try:
        with pytest.raises(Exception):
            execute("UPDATE outbound01t SET manager = 'sql' WHERE companyid = %s AND receiptno = %s", (C, docs["out_oct"]))
        with pytest.raises(Exception):
            execute("UPDATE receiptpayment01t SET receiptdate = '2026-11-15' WHERE companyid = %s AND receiptno = %s", (C, docs["rp_oct"]))
    finally:
        ok(api.post("/api/month-close/reopen", json={"month": CLOSED}))
