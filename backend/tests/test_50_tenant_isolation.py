"""멀티테넌트 격리: T02 사용자는 T01 전표를 전표번호로 읽기 · 수정 · 삭제 · 재고 사용할 수 없다."""
import jwt
import pytest

import security
from helpers import (T01_MASTER, T01_NOMENU, T02_MASTER, create_inbound, create_outbound, inbound_line, inbound_payload, ok,
                     outbound_line, outbound_payload, rows, rp_payload, snapshot)
from integrity import assert_consistent
from test_20_stock_flows import process_payload, stand_item, transfer
from test_30_receipt_payment import RP, cash, note


@pytest.fixture
def t01_docs(api):
    d = {}
    d["inbound"], (d["lot"],) = create_inbound(api, "2026-11-02", lines=[inbound_line(qty="10", weight="1000")])
    d["outbound"] = create_outbound(api, "2026-11-05", [outbound_line(d["lot"], 1, 100)])
    d["transfer"] = transfer(api, "2026-11-06", "W1", "W2", [(d["lot"], 1)])["receiptno"]
    d["process"] = ok(api.post("/api/item-process-register/documents", json=process_payload(d["lot"])))["processno"]
    d["rp"] = ok(api.put(RP, json=rp_payload("2026-11-10", "RECEIPT", "C001", "매출처A", [note(5000, "ISO-1")])))["receiptno"]
    existing = {r["lineno"] for r in rows("SELECT lineno FROM standstock01t WHERE companyid = 'T01'")}
    ok(api.post("/api/stock-stand/items", json={"standdate": "2026-11-01", "items": [stand_item()]}))
    d["stand"] = next(r["lineno"] for r in rows("SELECT lineno FROM standstock01t WHERE companyid = 'T01'") if r["lineno"] not in existing)
    yield d
    ok(api.delete(f"/api/outbound-register/receipts/{d['outbound']}"))
    ok(api.post("/api/item-process-register/documents/delete", json={"processnos": [d["process"]]}))
    ok(api.delete(f"/api/inoutmove-register/documents/{d['transfer']}"))
    ok(api.delete(f"{RP}/{d['rp']}"))
    ok(api.delete("/api/stock-stand/items", json={"delete_all": False, "linenos": [d["stand"]]}))
    ok(api.delete(f"/api/inbound-register/receipts/{d['inbound']}"))
    assert_consistent("T01", "isolation cleanup")


def test_other_tenant_cannot_read_change_or_use_documents(api, t01_docs):
    d = t01_docs
    lot = d["lot"]
    t01_before, t02_before = snapshot("T01"), snapshot("T02")
    reads = [
        f"/api/inbound-register/receipts/{d['inbound']}",
        f"/api/outbound-register/receipts/{d['outbound']}",
        f"/api/outbound-register/receipts/{d['outbound']}/print",
        f"/api/inoutmove-register/documents/{d['transfer']}",
        f"/api/item-process-register/documents/{d['process']}",
        f"{RP}/{d['rp']}",
    ]
    for path in reads:
        response = api.get(path, T02_MASTER)
        assert response.status_code in (403, 404), (path, response.status_code, response.text[:300])
    writes = [
        ("DELETE", f"/api/inbound-register/receipts/{d['inbound']}", None),
        ("PATCH", f"/api/inbound-register/receipts/{d['inbound']}/manager", {"manager": "해커"}),
        ("DELETE", f"/api/outbound-register/receipts/{d['outbound']}", None),
        ("PUT", "/api/outbound-register/receipts", outbound_payload("2026-11-05", [outbound_line(lot, 1, 100)], receiptno=d["outbound"], is_new=False)),
        ("PATCH", f"/api/outbound-register/receipts/{d['outbound']}/sales-fields", {"prices": [{"lineno": 1, "unitprice": "1"}], "manager": "해커"}),
        ("PATCH", f"/api/outbound-register/receipts/{d['outbound']}/manager", {"manager": "해커"}),
        ("POST", "/api/outbound-register/receipts", outbound_payload("2026-11-07", [outbound_line(lot, 1, 100)])),   # T01 재고 사용
        ("DELETE", f"/api/inoutmove-register/documents/{d['transfer']}", None),
        ("POST", "/api/inoutmove-register/documents", {"receiptno": "", "receptdate": "2026-11-07", "fromwarehousecode": "W1",
                                                       "towarehousecode": "W2", "manager": "", "description": "",
                                                       "items": [{"stocksourcetype": lot[0], "stocksourceno": lot[1], "stocksourceline": lot[2], "qty": "1"}]}),
        ("POST", "/api/item-process-register/documents/delete", {"processnos": [d["process"]]}),
        ("POST", "/api/item-process-register/documents", process_payload(lot, processno=d["process"])),
        ("POST", "/api/item-process-register/documents", process_payload(lot)),
        ("DELETE", f"{RP}/{d['rp']}", None),
        ("PUT", RP, rp_payload("2026-11-10", "RECEIPT", "C001", "매출처A", [cash(1)], receiptno=d["rp"])),
        ("POST", f"{RP}/{d['rp']}/instrument-process", {"action": "SETTLE", "processdate": "2026-11-20", "processmemo": "", "lines": [{"lineno": 1}]}),
        ("PUT", RP, rp_payload("2026-11-15", "PAYMENT", "V001", "매입처A", [{"instrumentamt": "1", "source_receiptno": d["rp"], "source_lineno": 1}])),
        ("PUT", "/api/stock-stand/items/prices", {"items": [{"lineno": d["stand"], "unit": "1", "unitprice": "1"}]}),
        ("DELETE", "/api/stock-stand/items", {"delete_all": False, "linenos": [d["stand"]]}),
    ]
    leaks = []
    for method, path, body in writes:
        response = api.call(method, path, T02_MASTER, json=body)
        if response.status_code < 400:
            leaks.append(f"{method} {path}: {response.status_code} {response.text[:200]}")
        if snapshot("T01") != t01_before:
            leaks.append(f"{method} {path}: T01 data changed!")
            t01_before = snapshot("T01")
    assert not leaks, "\n".join(leaks)
    assert snapshot("T02") == t02_before, "failed attempts must not leave rows in T02 either"

    # 목록 · 원장 · 현재고에 T01 데이터가 보이지 않음
    t01_numbers = {d["inbound"], d["outbound"], d["transfer"], d["process"], d["rp"]}
    listed = set()
    listed |= {r["receiptno"] for r in ok(api.get("/api/inbound-register/receipts", T02_MASTER, params={"page_size": 200}))["receipts"]}
    listed |= {r["receiptno"] for r in ok(api.get("/api/outbound-register/receipts", T02_MASTER, params={"page_size": 200}))["receipts"]}
    listed |= {r["receiptno"] for r in ok(api.get(RP, T02_MASTER, params={"page_size": 200}))["documents"]}
    assert not (listed & t01_numbers)
    ledger = ok(api.get("/api/customer-ledger/ledger", T02_MASTER, params={"ckey": "C001", "date_from": "2000-01-01", "date_to": "2099-12-31"}))
    assert ledger["lines"] == []
    stock = ok(api.get("/api/outbound-register/available-stock", T02_MASTER, params={"page_size": 200}))
    assert not [s for s in stock.get("items", []) if s.get("stocksourceno") == lot[1]]
    held = ok(api.get("/api/receipt-payment/held-instruments", T02_MASTER))["items"]
    assert not [h for h in held if h["receiptno"] == d["rp"]]


def test_same_document_number_in_two_tenants_stays_separate(api, t01_docs):
    """전표번호는 회사별 일련번호 → 두 회사에 같은 번호가 생길 수 있다. 삭제는 자기 회사 것만."""
    t02_no, _ = create_inbound(api, "2026-11-03", user=T02_MASTER, lines=[inbound_line()])
    same = t02_no == t01_docs["inbound"]
    t01_before = snapshot("T01")
    ok(api.delete(f"/api/inbound-register/receipts/{t02_no}", T02_MASTER))
    assert snapshot("T01") == t01_before
    assert rows("SELECT 1 FROM inbound01t WHERE companyid = 'T01' AND receiptno = %s", (t01_docs["inbound"],))
    assert_consistent("T02", "t02 inbound delete")
    if not same:
        pytest.skip(f"numbers differ ({t02_no} vs {t01_docs['inbound']}) — isolation still verified")


def test_token_and_menu_permission_checks(api):
    # 메뉴 권한 없는 사용자: 쓰기 403, 데이터 변화 없음
    before = snapshot("T01")
    for method, path, body in (("PUT", "/api/inbound-register/receipts", inbound_payload("2026-11-03")),
                               ("POST", "/api/outbound-register/receipts", outbound_payload("2026-11-03", [outbound_line(("INBOUND", "X", 1), 1, 1)])),
                               ("PUT", RP, rp_payload("2026-11-10", "RECEIPT", "C001", "매출처A", [cash(1)])),
                               ("POST", "/api/month-close/close", {"month": "2026-10"})):
        assert api.call(method, path, T01_NOMENU, json=body).status_code == 403, path
    assert snapshot("T01") == before

    import fixtures_data

    def forged(email, companyid, sid):
        token = security.create_access_token({"user_email": email, "user_company": companyid, "session_id": sid})
        return api.client.get("/api/inbound-register/receipts", headers={"Authorization": f"Bearer {token}"}).status_code

    assert forged(T02_MASTER, "T01", fixtures_data.SESSIONS[T02_MASTER]) == 401        # 다른 회사 id 로 위조
    assert forged(T01_MASTER, "T01", "stale-session") == 401                           # 다른 곳에서 다시 로그인한 세션
    bad = jwt.encode({"sub": T01_MASTER, "companyid": "T01", "sid": fixtures_data.SESSIONS[T01_MASTER]}, "x" * 40, algorithm="HS256")
    assert api.client.get("/api/inbound-register/receipts", headers={"Authorization": f"Bearer {bad}"}).status_code == 401
