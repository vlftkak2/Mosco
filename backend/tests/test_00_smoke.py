from helpers import T01_MASTER, T01_NOMENU, ok, scalar, create_inbound
from integrity import assert_consistent


def test_database_is_test_db(api):
    assert scalar("SELECT current_database()") == "Mosco_test"


def test_auth_and_menu_permission(api):
    ok(api.get("/api/inbound-register/receipts", T01_MASTER))
    assert api.get("/api/inbound-register/receipts", T01_NOMENU).status_code == 403
    assert api.client.get("/api/inbound-register/receipts").status_code == 401


def test_empty_company_is_consistent(api):
    assert_consistent("T01", "fixtures")


def test_auth_snapshot_query_works(api):
    """BUG GUARD: security._load_auth_snapshot must not raise (else every authenticated API call is 503)."""
    from conftest import AUTH_PROBE

    assert AUTH_PROBE["error"] is None, (
        "BUG security.py _load_auth_snapshot: SQL fails -> every API request returns 503 "
        f"({AUTH_PROBE['error']}). Tests ran with a test-only fallback query.")
