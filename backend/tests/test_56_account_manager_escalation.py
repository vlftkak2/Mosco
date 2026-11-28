"""계정관리 권한 상승 방지: 계정관리 메뉴만 받은 사용자가 관리자(SUBMASTER) · 권한 많은 계정을 만들거나 빼앗지 못한다."""
import secrets

import pytest

import security
from helpers import execute, one

C = "T01"
ACTOR = "iso.acct@mosco-test.local"        # USER + 계정관리 메뉴만
SUB = "iso.sub@mosco-test.local"           # SUBMASTER + 계정관리 메뉴
RICH = "iso.rich@mosco-test.local"         # USER + 급여 메뉴 (ACTOR 에게 없는 메뉴)
PLAIN = "iso.plain@mosco-test.local"       # USER, 메뉴 없음
NEW = "iso.new@mosco-test.local"
PW = "Passw0rd!x"


def _user(email, authority, menus):
    sid = secrets.token_hex(16)
    execute("""INSERT INTO user01t (companyid, email, username, password, authority, useyn, usercode, session_id)
               VALUES (%s, %s, %s, 'x', %s, 'Y', %s, %s)""", (C, email, email.split("@")[0][:20], authority, email[:8], sid))
    for menuid in menus:
        execute("""INSERT INTO usermenupermission01t (companyid, useremail, menuid, useyn, createdby)
                   VALUES (%s, %s, %s, 'Y', 'pytest')""", (C, email, menuid))
    return sid


@pytest.fixture
def accounts(api):
    emails = (ACTOR, SUB, RICH, PLAIN, NEW)
    execute("DELETE FROM user01t WHERE companyid = %s AND email = ANY(%s)", (C, list(emails)))
    sids = {
        ACTOR: _user(ACTOR, "USER", ["HOME", "COMPANY_USER_MANAGEMENT"]),
        SUB: _user(SUB, "SUBMASTER", ["HOME", "COMPANY_USER_MANAGEMENT"]),
        RICH: _user(RICH, "USER", ["HOME", "PAYROLL"]),
        PLAIN: _user(PLAIN, "USER", []),
    }
    security.invalidate_all_access_cache()

    def call(method, actor, json=None, params=None):
        token = security.create_access_token({"user_email": actor, "user_company": C, "session_id": sids[actor]})
        return api.client.request(method, "/api/company-users", json=json, params=params,
                                  headers={"Authorization": f"Bearer {token}"})

    yield call
    execute("DELETE FROM user01t WHERE companyid = %s AND email = ANY(%s)", (C, list(emails)))
    security.invalidate_all_access_cache()


def _update(email, authority="USER", password="", username="변경"):
    return {"companyid": C, "original_email": email, "email": email, "username": username,
            "authority": authority, "useyn": "Y", "password": password}


def _password(email):
    return one("SELECT password FROM user01t WHERE companyid = %s AND email = %s", (C, email))["password"]


def test_plain_account_manager_cannot_create_or_take_over_admins(accounts):
    call = accounts
    # 관리자(SUBMASTER) 계정 생성 불가, 일반 계정 생성은 가능
    assert call("POST", ACTOR, json={"companyid": C, "username": "새관리자", "email": NEW, "password": PW,
                                     "authority": "SUBMASTER"}).status_code == 403
    assert not one("SELECT 1 FROM user01t WHERE email = %s", (NEW,))
    assert call("POST", ACTOR, json={"companyid": C, "username": "새직원", "email": NEW, "password": PW}).status_code == 201

    # SUBMASTER 계정: 비밀번호 · 이름 수정 불가, 일반 계정을 SUBMASTER 로 올리기 불가
    before = _password(SUB)
    assert call("PUT", ACTOR, json=_update(SUB, "SUBMASTER", PW)).status_code == 403
    assert call("PUT", ACTOR, json=_update(SUB, "SUBMASTER")).status_code == 403
    assert call("PUT", ACTOR, json=_update(PLAIN, "SUBMASTER")).status_code == 403
    assert _password(SUB) == before
    assert one("SELECT authority FROM user01t WHERE email = %s", (PLAIN,))["authority"] == "USER"

    # 나에게 없는 메뉴(급여)를 가진 계정의 비밀번호는 못 바꾼다 / 메뉴가 같거나 적은 계정은 바꿀 수 있다
    before = _password(RICH)
    assert call("PUT", ACTOR, json=_update(RICH, password=PW)).status_code == 403
    assert _password(RICH) == before
    assert call("PUT", ACTOR, json=_update(PLAIN, password=PW)).status_code == 200
    assert _password(PLAIN) != "x"


def test_submaster_keeps_admin_rights_but_not_beyond_own_menus(accounts):
    call = accounts
    assert call("POST", SUB, json={"companyid": C, "username": "새관리자", "email": NEW, "password": PW,
                                   "authority": "SUBMASTER"}).status_code == 201
    assert call("PUT", SUB, json=_update(PLAIN, "SUBMASTER")).status_code == 200
    # SUBMASTER 라도 자기에게 없는 메뉴를 가진 계정의 비밀번호는 못 바꾼다
    assert call("PUT", SUB, json=_update(RICH, password=PW)).status_code == 403
    # 이름 · 사용여부 같은 일반 수정은 그대로 가능
    assert call("PUT", SUB, json=_update(RICH, username="이름만")).status_code == 200
