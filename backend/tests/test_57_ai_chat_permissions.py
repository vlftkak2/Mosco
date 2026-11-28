"""AI 업무비서: 모스코 전용 + 메뉴권한별 자료 제한 (OpenAI 는 호출하지 않는다).

  - 고객사 계정은 API 자체가 403 (메뉴권한을 어떻게 넣든)
  - 조회 도구는 사용자의 메뉴권한에 맞는 것만 모델에 보이고, 실행 직전에 다시 검사한다
  - 급여 도구는 개인정보 칸(계좌 · 생년월일 · 이메일)을 모델에 넘기지 않는다
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


def test_tools_follow_menu_permissions():
    assert [t["name"] for t in tools.tools_for(_user({"STOCK_CURRENT"}))] == ["stock_summary"]
    assert tools.tools_for(_user(set())) == []
    # 같은 계산을 쓰는 두 메뉴 중 하나만 있어도 된다
    assert [t["name"] for t in tools.tools_for(_user({"GROSS_PROFIT"}))] == ["gross_profit_summary"]
    assert [t["name"] for t in tools.tools_for(_user({"CUSTOMER_LEDGER"}))] == ["receivable_payable_summary"]
    # 급여: 급여입력(PAYROLL) 과 내 급여(PAYROLL_MY) 는 따로
    assert [t["name"] for t in tools.tools_for(_user({"PAYROLL_MY"}))] == ["my_payroll"]
    # 모스코 MASTER 는 전부
    assert len(tools.tools_for(_user(set(), authority="MASTER"))) == len(tools.TOOLS)


def test_run_tool_rechecks_permission_even_if_model_calls_it():
    user = _user({"STOCK_CURRENT"})
    result = tools.run_tool(user, "payroll_summary", {"from_ym": "2026-01", "to_ym": "2026-02", "detail_ym": None})
    assert "권한이 없어" in result["error"]
    assert "error" in tools.run_tool(user, "no_such_tool", {})


def test_process_guides_follow_menu_permissions():
    names = [name for name, _ in tools.guides_for(_user({"STOCK_CURRENT"}))]
    assert names == ["현재고현황"]
    assert not any("급여" in name for name in names)


def test_payroll_fields_exclude_personal_data():
    for field in ("accountno", "bankname", "birthdate", "useremail", "email", "hiredate"):
        assert field not in tools._PAY_SAFE


def test_bad_tool_arguments_return_message_not_exception():
    user = _user({"OUTBOUND_SEARCH"})
    result = tools.run_tool(user, "outbound_summary", {"date_from": "2026-12-01", "date_to": "2026-01-01",
                                                       "customer": None, "item_search": None, "warehouse": None, "group_by": "none"})
    assert result == {"error": "시작일이 종료일보다 늦습니다."}
    result = tools.run_tool(user, "outbound_summary", {"date_from": "x", "date_to": "2026-01-01",
                                                       "customer": None, "item_search": None, "warehouse": None, "group_by": "none"})
    assert "YYYY-MM-DD" in result["error"]
