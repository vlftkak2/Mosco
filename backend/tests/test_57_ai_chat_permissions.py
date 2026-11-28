"""AI 업무비서: 모스코 전용 + 메뉴권한별 자료 제한 (OpenAI 는 호출하지 않는다).

  - 고객사 계정은 API 자체가 403 (메뉴권한을 어떻게 넣든)
  - 조회 도구는 사용자의 메뉴권한에 맞는 것만 모델에 보이고, 실행 직전에 다시 검사한다
  - 급여 · 인사는 권한과 관계없이(모스코 MASTER 포함) 도구도 업무 안내도 없다
"""
from helpers import T01_MASTER, T01_USER

from services.ai import AIChatTools as tools


def _user(menus, companyid="001", authority="USER"):
    return {"companyid": companyid, "authority": authority, "menuids": frozenset(menus), "email": "chat@test.local"}


def test_customer_company_cannot_use_assistant(api):
    for who in (T01_MASTER, T01_USER):
        assert api.get("/api/ai-chat/status", user=who).status_code == 403
        assert api.post("/api/ai-chat/messages", user=who,
                        json={"messages": [{"role": "user", "content": "재고 알려줘"}]}).status_code == 403


def _data_tools(user):
    """자료 조회 도구 (메뉴 사용 방법 menu_guide 는 안내가 있는 메뉴가 하나라도 있으면 같이 보인다)."""
    return [t["name"] for t in tools.tools_for(user) if t["name"] != "menu_guide"]


def test_tools_follow_menu_permissions():
    assert _data_tools(_user({"STOCK_CURRENT"})) == ["stock_summary"]
    assert tools.tools_for(_user(set())) == []
    # 같은 계산을 쓰는 두 메뉴 중 하나만 있어도 된다
    assert _data_tools(_user({"GROSS_PROFIT"})) == ["gross_profit_summary"]
    assert _data_tools(_user({"CUSTOMER_LEDGER"})) == ["receivable_payable_summary"]
    # 급여 · 인사 권한만 있으면 쓸 도구도 안내도 없다
    assert tools.tools_for(_user({"PAYROLL", "PAYROLL_MY", "USER_MANAGEMENT"})) == []
    # 모스코 MASTER 는 전부
    assert len(tools.tools_for(_user(set(), authority="MASTER"))) == len(tools.TOOLS)


def test_run_tool_rechecks_permission_even_if_model_calls_it():
    user = _user({"STOCK_CURRENT"})
    result = tools.run_tool(user, "outbound_summary", {"date_from": "2026-11-01", "date_to": "2026-11-30",
                                                       "customer": None, "item_search": None, "warehouse": None, "group_by": "none"})
    assert "권한이 없어" in result["error"]
    assert "error" in tools.run_tool(user, "no_such_tool", {})


def test_process_guides_follow_menu_permissions():
    names = [name for name, _ in tools.guides_for(_user({"STOCK_CURRENT"}))]
    assert names == ["현재고현황"]
    assert not any("급여" in name for name in names)


def test_payroll_is_blocked_for_everyone():
    master = _user(set(), authority="MASTER")
    names = [t["name"] for t in tools.TOOLS]
    assert not any("payroll" in name for name in names)
    assert not any(menu.startswith("PAYROLL") or menu == "USER_MANAGEMENT" for t in tools.TOOLS for menu in t["menus"])
    assert "error" in tools.run_tool(master, "payroll_summary", {"from_ym": "2026-01", "to_ym": "2026-02", "detail_ym": None})
    assert "error" in tools.run_tool(master, "my_payroll", {})
    guides = " ".join(f"{name} {text}" for name, text in tools.guides_for(master))
    assert "급여" not in guides and "직원관리" not in guides


def test_instructions_refuse_payroll():
    from services.ai import AIChat as chat

    master = {**_user(set(), authority="MASTER"), "companyname": "모스코", "username": "t"}
    text = chat._instructions(master, tools.tools_for(master))
    assert "급여 · 휴가 · 인사 정보는 AI 업무비서에서 안내하지 않습니다" in text


def test_bad_tool_arguments_return_message_not_exception():
    user = _user({"OUTBOUND_SEARCH"})
    result = tools.run_tool(user, "outbound_summary", {"date_from": "2026-12-01", "date_to": "2026-01-01",
                                                       "customer": None, "item_search": None, "warehouse": None, "group_by": "none"})
    assert result == {"error": "시작일이 종료일보다 늦습니다."}
    result = tools.run_tool(user, "outbound_summary", {"date_from": "x", "date_to": "2026-01-01",
                                                       "customer": None, "item_search": None, "warehouse": None, "group_by": "none"})
    assert "YYYY-MM-DD" in result["error"]


def test_no_leave_guide():
    guides = " ".join(f"{name} {text}" for name, text in tools.guides_for(_user(set(), authority="MASTER")))
    assert "휴가" not in guides


def test_new_tools_follow_menu_permissions():
    expect = {
        "RECEIPT_PAYMENT_SEARCH": "receipt_payment_summary", "STOCK_HISTORY": "stock_movement_summary",
        "INOUTMOVE_SEARCH": "transfer_summary", "INSTRUMENT_STATUS": "instrument_summary",
        "ITEM_PROCESS_SEARCH": "process_summary", "AI_ORDER_MANAGEMENT": "ai_order_status",
        "MONTH_CLOSING": "month_close_status", "CONTROL_MANAGEMENT": "approval_status",
    }
    for menu, name in expect.items():
        names = [t["name"] for t in tools.tools_for(_user({menu}))]
        assert name in names, menu
        others = set(expect.values()) - {name}
        assert not others & set(names), menu


def test_document_kinds_follow_menu_permissions():
    user = _user({"INBOUND_SEARCH"})
    specs = {t["name"]: t for t in tools.openai_tools(tools.tools_for(user), user)}
    assert specs["document_search"]["parameters"]["properties"]["kind"]["enum"] == ["inbound"]
    assert specs["document_detail"]["parameters"]["properties"]["kind"]["enum"] == ["inbound"]
    # 모델이 다른 종류를 억지로 넣어도 실행 직전에 막는다
    result = tools.run_tool(user, "document_detail", {"kind": "outbound", "receiptno": "OUT1"})
    assert "권한이 없어" in result["error"]
    result = tools.run_tool(user, "document_search", {"kind": "receipt_payment", "date_from": None, "date_to": None,
                                                      "customer": None, "keyword": None})
    assert "권한이 없어" in result["error"]
    # 전표 메뉴가 하나도 없으면 전표 도구 자체가 없다
    assert not {"document_search", "document_detail"} & {t["name"] for t in tools.tools_for(_user({"STOCK_CURRENT"}))}


def test_menu_guide_follows_menu_permissions():
    user = _user({"STOCK_CURRENT", "INBOUND_REGISTER"})
    spec = {t["name"]: t for t in tools.openai_tools(tools.tools_for(user), user)}["menu_guide"]
    assert set(spec["parameters"]["properties"]["menus"]["items"]["enum"]) == {"현재고현황", "매입등록"}
    result = tools.run_tool(user, "menu_guide", {"menus": ["매입등록", "매출등록", "없는메뉴"]})
    assert [g["menu"] for g in result["guides"]] == ["매입등록"]
    assert result["no_permission"] == ["매출등록"] and result["unknown"] == ["없는메뉴"]
    # 요약은 권한 있는 메뉴만
    assert sorted(name for name, _ in tools.guides_for(user)) == ["매입등록", "현재고현황"]


def test_guides_have_no_sensitive_topics():
    from services.ai.AIChatGuides import GUIDES
    for menuid, guide in GUIDES.items():
        text = guide["summary"] + guide["detail"]
        assert "급여" not in text and "휴가" not in text and "연차" not in text, menuid
    assert not {"PAYROLL", "PAYROLL_MY", "PAYROLL_LEDGER", "USER_MANAGEMENT", "EAPPROVAL_LEAVE"} & set(GUIDES)
