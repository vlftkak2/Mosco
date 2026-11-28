"""멀티테넌트 격리 (test_50 에 없는 메뉴): 급여 · 전자결재 · 통제관리 · 품목 · 공통코드 · 거래처 · AI 주문 · 게시판 · 월마감 · 사업장.

T02(다른 회사) 사용자가 T01/T03 데이터를 번호(id)로 읽기 · 수정 · 삭제 · 승인할 수 없고, 목록에도 보이지 않으며,
실패한 시도가 원래 회사 데이터를 한 글자도 바꾸지 않는지 확인한다. 같은 회사라도 메뉴 권한이 없으면 막히는지도 함께 본다.
"""
import pytest

from helpers import (T01_MASTER, T01_NOMENU, T01_USER, T02_MASTER, T03_APPROVER, T03_USER, create_inbound, inbound_line,
                     ok, outbound_line, outbound_payload, rows)

DENIED = (400, 403, 404, 409, 422)


def dump(table: str, companyid: str) -> list[str]:
    """회사 한 곳의 테이블 전체 내용 (행 전체를 글자로) — 한 칸이라도 바뀌면 달라진다."""
    return [r["t"] for r in rows(f"SELECT x::text AS t FROM {table} x WHERE companyid = %s ORDER BY 1", (companyid,))]


def dumps(tables, companyid: str) -> dict:
    return {table: dump(table, companyid) for table in tables}


def attempt_all(api, user: str, calls) -> list[str]:
    """모든 시도가 거절(4xx)되어야 한다. 통과한 호출 목록을 돌려준다."""
    leaks = []
    for method, path, body in calls:
        response = api.call(method, path, user, json=body)
        if response.status_code not in DENIED:
            leaks.append(f"{method} {path}: {response.status_code} {response.text[:200]}")
    return leaks


# ── 급여 ──────────────────────────────────────────────────────────────────────
PAY_TABLES = ("pay_slip01t",)
PAYYM = "2026-09"


def test_payroll_other_tenant_and_no_menu(api):
    ok(api.put("/api/payroll/slips", json={"payym": PAYYM, "useremail": T01_USER, "paydate": "2026-09-25",
                                            "slip": {"pay_base": 3100000}}))
    ok(api.post("/api/payroll/close", json={"payym": PAYYM, "close": True}))
    try:
        before = dumps(PAY_TABLES, "T01")
        assert before["pay_slip01t"], "T01 급여 행이 만들어져야 함"

        # 다른 회사: 목록 · 기간대장에 T01 직원이 보이지 않음
        listed = ok(api.get("/api/payroll/slips", T02_MASTER, params={"payym": PAYYM}))
        assert T01_USER not in str(listed)
        ledger = ok(api.get("/api/payroll/ledger-period", T02_MASTER, params={"from_ym": PAYYM, "to_ym": PAYYM}))
        assert T01_USER not in str(ledger)
        assert T01_USER not in str(ok(api.get("/api/payroll/my", T02_MASTER)))

        # 다른 회사: T01 직원 이메일로 저장 · 삭제 · 일괄저장 → 거절 (자기 회사 직원이 아님)
        leaks = attempt_all(api, T02_MASTER, [
            ("PUT", "/api/payroll/slips", {"payym": PAYYM, "useremail": T01_USER, "paydate": "2026-09-25", "slip": {"pay_base": 1}}),
            ("PUT", "/api/payroll/slips/bulk", {"payym": "2026-08", "paydate": "2026-08-25",
                                                "rows": [{"useremail": T01_USER, "slip": {"pay_base": 1}}]}),
        ])
        assert not leaks, "\n".join(leaks)
        # 삭제 · 마감취소는 T02 자기 회사 범위에서만 동작한다 (응답이 성공이어도 T01 은 그대로여야 함)
        api.delete("/api/payroll/slips", T02_MASTER, params={"payym": PAYYM, "useremail": T01_USER})
        api.post("/api/payroll/close", T02_MASTER, json={"payym": PAYYM, "close": False})
        assert dumps(PAY_TABLES, "T01") == before, "T02 요청으로 T01 급여가 바뀌었다"
        assert not [r for r in dump("pay_slip01t", "T02") if T01_USER in r], "T02 에 T01 직원 급여가 생겼다"

        # 같은 회사, 메뉴 권한 없음: 급여대장 · 내 급여 모두 403
        for path, params in (("/api/payroll/slips", {"payym": PAYYM}),
                             ("/api/payroll/ledger-period", {"from_ym": PAYYM, "to_ym": PAYYM}),
                             ("/api/payroll/my", None)):
            assert api.get(path, T01_NOMENU, params=params).status_code == 403, path
        assert api.put("/api/payroll/slips", T01_NOMENU, json={"payym": PAYYM, "useremail": T01_NOMENU,
                                                                "paydate": "2026-09-25", "slip": {}}).status_code == 403

        # 내 급여현황: 본인 것만
        mine = ok(api.get("/api/payroll/my", T01_USER))
        assert "3100000" in str(mine).replace(",", "") or "3100000.0" in str(mine)
        assert T01_USER not in str(ok(api.get("/api/payroll/my", T01_MASTER))).replace(T01_MASTER, "")
    finally:
        ok(api.post("/api/payroll/close", json={"payym": PAYYM, "close": False}))
        api.delete("/api/payroll/slips", params={"payym": PAYYM, "useremail": T01_USER})


# ── 전자결재 ──────────────────────────────────────────────────────────────────
EAPPR_TABLES = ("eappr_doc01t", "eappr_step01t", "eappr_line01t", "eappr_form01t")


def test_eapproval_other_tenant_and_outsider(api):
    ok(api.put("/api/eapproval/admin", json={"forms": [{"formcode": "REPORT", "useyn": True, "line": [T01_USER]}]}))
    report = {"title": "격리테스트 보고", "report_type": "WEEKLY", "done": "실적", "date_from": "2026-11-02", "date_to": "2026-11-06"}
    pending = ok(api.post("/api/eapproval/docs/submit", json={"formcode": "REPORT", "content": report}))
    assert pending["status"] == "PENDING", pending
    draft = ok(api.post("/api/eapproval/docs/draft", json={"formcode": "REPORT", "content": {**report, "title": "임시"}}))
    docnos = [pending["docno"], draft["docno"]]
    try:
        before = dumps(EAPPR_TABLES, "T01")
        calls = []
        for docno in docnos:
            calls += [
                ("GET", f"/api/eapproval/docs/{docno}", None),
                ("POST", f"/api/eapproval/docs/{docno}/approve", {"comment": "해커"}),
                ("POST", f"/api/eapproval/docs/{docno}/reject", {"comment": "해커"}),
                ("POST", f"/api/eapproval/docs/{docno}/withdraw", None),
                ("POST", f"/api/eapproval/admin/docs/{docno}/approver", {"step": 1, "approver": T02_MASTER}),
                ("POST", f"/api/eapproval/admin/docs/{docno}/reject", {"comment": "해커"}),
                ("DELETE", f"/api/eapproval/docs/{docno}", None),
                # 남의 회사 임시저장 번호에 덮어쓰기
                ("POST", "/api/eapproval/docs/draft", {"formcode": "REPORT", "content": report, "docno": docno}),
                ("POST", "/api/eapproval/docs/submit", {"formcode": "REPORT", "content": report, "docno": docno}),
            ]
        leaks = attempt_all(api, T02_MASTER, calls)
        assert not leaks, "\n".join(leaks)
        assert dumps(EAPPR_TABLES, "T01") == before, "T02 요청으로 T01 결재 문서가 바뀌었다"

        for box in ("drafts", "mine", "todo", "done"):
            listed = ok(api.get("/api/eapproval/docs", T02_MASTER, params={"box": box}))
            assert "격리테스트" not in str(listed) and "임시" not in str(listed), box
        assert "격리테스트" not in str(ok(api.get("/api/eapproval/admin/pending", T02_MASTER)))

        # 같은 회사라도 작성자 · 결재선 · 양식관리자가 아니면 열람 · 승인 불가
        leaks = attempt_all(api, T01_NOMENU, [
            ("GET", f"/api/eapproval/docs/{pending['docno']}", None),
            ("POST", f"/api/eapproval/docs/{pending['docno']}/approve", {"comment": ""}),
            ("GET", f"/api/eapproval/docs/{draft['docno']}", None),
        ])
        assert not leaks, "\n".join(leaks)
        # 결재자(T01_USER)도 남의 임시저장은 못 본다
        assert api.get(f"/api/eapproval/docs/{draft['docno']}", T01_USER).status_code == 403
        assert dumps(EAPPR_TABLES, "T01") == before
    finally:
        api.post(f"/api/eapproval/docs/{pending['docno']}/withdraw")
        for docno in docnos:
            api.delete(f"/api/eapproval/docs/{docno}")


# ── 통제관리 (승인요청) ───────────────────────────────────────────────────────
CONTROL_TABLES = ("approval_request01t", "outbound01t", "currentstock01t")


def test_control_request_other_tenant(api):
    inno, (key,) = create_inbound(api, "2026-11-02", user=T03_APPROVER, lines=[inbound_line(qty="5", weight="500")])
    body = ok(api.post("/api/outbound-register/receipts", T03_USER, json=outbound_payload("2026-11-05", [outbound_line(key, 1, 100)])))
    assert body.get("pending_approval") is True, body
    requestno = body["requestno"]
    try:
        before = dumps(CONTROL_TABLES, "T03")
        leaks = attempt_all(api, T02_MASTER, [
            ("GET", f"/api/control/requests/{requestno}", None),
            ("POST", f"/api/control/requests/{requestno}/approve", None),
            ("POST", f"/api/control/requests/{requestno}/reject", {"reason": "해커"}),
            ("POST", f"/api/control/requests/{requestno}/cancel", None),
        ])
        assert not leaks, "\n".join(leaks)
        assert dumps(CONTROL_TABLES, "T03") == before, "T02 요청으로 T03 승인요청 · 재고가 바뀌었다"
        assert requestno not in str(ok(api.get("/api/control/requests", T02_MASTER)))
        # T03 설정(승인자 · 정책)도 T02 에서 보이지 않음
        assert T03_APPROVER not in str(ok(api.get("/api/control/settings", T02_MASTER)))
    finally:
        api.post(f"/api/control/requests/{requestno}/cancel", T03_USER)
        ok(api.delete(f"/api/inbound-register/receipts/{inno}", T03_APPROVER))   # 승인자 본인 저장은 통제 없이 바로 처리


# ── 품목 · 공통코드 · 거래처 ──────────────────────────────────────────────────
MASTER_TABLES = ("itemcode01t", "codemaster01t", "customer01t")


def _customer(code: str, name: str, companyid: str = "T01") -> dict:
    return {"companyid": companyid, "companyname": "", "customercode": code, "customername": name, "useryn": "Y"}


def test_master_data_other_tenant(api):
    if not rows("SELECT 1 FROM codemaster01t WHERE companyid = 'T01' AND groupcode = 'SHAPE' AND code = '1'"):
        ok(api.put("/api/code-master/groups/SHAPE", json={"items": [{"code": "1", "codename": "코일", "is_new": True}]}))
    ok(api.put("/api/item-master/items", json={"items": [{"itemcode": "ISO-T01", "itemname": "T01전용품목", "itemtypecode": "1", "use_yn": "Y", "is_new": True}]}))
    ok(api.put("/api/code-master/groups/WAREHOUSE", json={"items": [{"code": "W9", "codename": "T01전용창고", "is_new": True}]}))
    ok(api.post("/api/create", json=_customer("ISO1", "T01전용거래처")))
    try:
        before = dumps(MASTER_TABLES, "T01")
        # 다른 회사가 같은 코드로 수정 · 삭제 (body 에 companyid=T01 을 넣어도 토큰 회사로 덮어써져야 함)
        for method, path, body in (
            ("PUT", "/api/item-master/items", {"items": [{"itemcode": "ISO-T01", "itemname": "해커", "itemtypecode": "1", "use_yn": "N", "is_new": False}]}),
            ("DELETE", "/api/item-master/items", {"itemcodes": ["ISO-T01"]}),
            ("PUT", "/api/code-master/groups/WAREHOUSE", {"items": [{"code": "W9", "codename": "해커", "is_new": False}]}),
            ("DELETE", "/api/code-master/groups/WAREHOUSE/items/W9", None),
            ("POST", "/api/code-master/groups/WAREHOUSE/items/delete", {"codes": ["W9"]}),
            ("POST", "/api/update", _customer("ISO1", "해커")),
            ("POST", "/api/opening-balances", None),
        ):
            api.call(method, path, T02_MASTER, json=body)
            assert dumps(MASTER_TABLES, "T01") == before, f"{method} {path}: T02 요청으로 T01 기준정보가 바뀌었다"

        # 목록 · 내보내기 · 자동완성에 T01 전용 데이터가 보이지 않음
        for path, params in (
            ("/api/item-master/items", {"page_size": 200}),
            ("/api/item-master/items/suggest", {"q": "ISO"}),
            ("/api/item-master/items/picker", {"q": "ISO"}),
            ("/api/code-master/groups", None),
            ("/api/code-master/groups/WAREHOUSE/items", {"page_size": 200}),
            ("/api/list", None),
        ):
            response = api.get(path, T02_MASTER, params=params)
            assert response.status_code == 200, (path, response.status_code, response.text[:200])
            text = response.text
            assert "T01전용" not in text and "ISO-T01" not in text, path
        # T02 가 만든 같은 코드 거래처는 T02 에만 생긴다
        assert not [r for r in dump("customer01t", "T02") if "해커" in r and "T01" in r.split(",")[0]]
    finally:
        api.delete("/api/item-master/items", json={"itemcodes": ["ISO-T01"]})
        api.delete("/api/code-master/groups/WAREHOUSE/items/W9")
        api.delete("/api/item-master/items", T02_MASTER, json={"itemcodes": ["ISO-T01"]})
        api.delete("/api/code-master/groups/WAREHOUSE/items/W9", T02_MASTER)


# ── AI 주문 관리 ──────────────────────────────────────────────────────────────
AI_TABLES = ("aiorder01t", "aiorder02t")


def test_ai_order_other_tenant(api):
    created = ok(api.post("/api/ai-order/confirmed/manual", json={
        "header": {"buyer": "격리구매처", "due_date": "2026-12-01"},
        "items": [{"source_product_name": "테스트시트", "steel_grade": "SS400", "thickness": "1.2", "width": "1219",
                   "length": "2438", "quantity": "1", "weight_kg": "100"}],
    }))
    orderid = created["orderid"]
    try:
        before = dumps(AI_TABLES, "T01")
        leaks = attempt_all(api, T02_MASTER, [
            ("GET", f"/api/ai-order/confirmed/{orderid}", None),
            ("PUT", f"/api/ai-order/confirmed/{orderid}", {"buyer": "해커", "due_date": "2026-12-31"}),
            ("PUT", f"/api/ai-order/confirmed/{orderid}/items", {"items": []}),
            ("GET", f"/api/ai-order/confirmed/{orderid}/items/1/stock-candidates", None),
            ("PUT", f"/api/ai-order/confirmed/{orderid}/items/1/stock-matches", {"matches": []}),
            ("POST", f"/api/ai-order/confirmed/{orderid}/send-to-optimization", {"linenos": [1]}),
            ("POST", f"/api/ai-order/confirmed/{orderid}/recall-from-optimization", {"linenos": [1]}),
            ("DELETE", f"/api/ai-order/confirmed/{orderid}", None),
        ])
        assert not leaks, "\n".join(leaks)
        assert dumps(AI_TABLES, "T01") == before, "T02 요청으로 T01 AI 주문이 바뀌었다"
        assert "격리구매처" not in api.get("/api/ai-order/confirmed", T02_MASTER).text
        assert api.get(f"/api/ai-order/confirmed/{orderid}", T01_NOMENU).status_code == 403
    finally:
        api.delete(f"/api/ai-order/confirmed/{orderid}")


# ── 상담게시판 ────────────────────────────────────────────────────────────────
def test_board_other_tenant(api):
    post = ok(api.post("/api/board", json={"category": "system", "title": "격리글", "content": "T01 내용"}), 201)["item"]
    post_id = post["id"]
    try:
        before = dump("board01t", "T01")
        leaks = attempt_all(api, T02_MASTER, [
            ("GET", f"/api/board/{post_id}", None),
            ("PUT", f"/api/board/{post_id}", {"category": "system", "title": "해커", "content": "해커"}),
            ("POST", f"/api/board/{post_id}/replies", {"reply": "해커"}),
            ("DELETE", f"/api/board/{post_id}", None),
        ])
        assert not leaks, "\n".join(leaks)
        assert dump("board01t", "T01") == before
        assert not rows("SELECT 1 FROM boardreply01t WHERE board_id = %s", (post_id,))
        assert "격리글" not in api.get("/api/board", T02_MASTER, params={"category": "system"}).text
    finally:
        api.delete(f"/api/board/{post_id}")


# ── 월마감 · 사업장 ───────────────────────────────────────────────────────────
def test_month_close_and_workplace_other_tenant(api):
    before = dump("monthclose01t", "T01")
    company_before = dump("company01t", "T01")
    ok(api.post("/api/month-close/close", T02_MASTER, json={"month": "2026-08"}))
    try:
        assert dump("monthclose01t", "T01") == before, "T02 마감이 T01 에 반영되었다"
        assert "2026-08" not in str(ok(api.get("/api/month-close", T01_MASTER)).get("closed", ""))
    finally:
        ok(api.post("/api/month-close/reopen", T02_MASTER, json={"month": "2026-08"}))

    item = ok(api.get("/api/workplace", T02_MASTER))["item"]
    assert "테스트철강1" not in str(item)
    assert api.get("/api/workplace", T01_NOMENU).status_code == 403
    assert api.put("/api/workplace", T01_NOMENU, json={}).status_code in (403, 422)
    assert dump("company01t", "T01") == company_before


@pytest.mark.parametrize("path", [
    "/api/payroll/slips?payym=2026-09", "/api/eapproval/docs", "/api/control/requests", "/api/item-master/items",
    "/api/code-master/groups", "/api/list", "/api/ai-order/confirmed", "/api/board", "/api/month-close",
    "/api/workplace", "/api/gross-profit/analysis", "/api/customer-ledger/ledger",
])
def test_no_token_is_rejected(api, path):
    assert api.client.get(path).status_code == 401, path
