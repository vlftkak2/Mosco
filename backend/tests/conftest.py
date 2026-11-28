"""Integration test bootstrap.

SAFETY: every test in this folder runs against the *test* database "Mosco_test" only.
DB_NAME is forced before config/db are imported and the session aborts if the connected
database is anything else. The real development database "Mosco" is never touched.

Test tenants (created fresh at session start, removed at session end):
    T01  main company (all data-flow scenarios)
    T02  second company (tenant isolation)
    T03  company with approval control (control_policy01t) switched on
Set KEEP_TEST_DATA=1 to keep the rows after the run (for debugging).
"""
import os
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
TESTS_DIR = Path(__file__).resolve().parent
if str(TESTS_DIR) not in sys.path:
    sys.path.insert(0, str(TESTS_DIR))

# ── must happen before `config` / `db` are imported anywhere ─────────────────
TEST_DB_NAME = "Mosco_test"
os.environ["DB_NAME"] = TEST_DB_NAME
os.environ.setdefault("DB_HOST", "localhost")
os.environ.setdefault("DB_USER", "postgres")
os.environ.setdefault("DB_PASSWORD", "1234")
os.environ["APP_ENV"] = "development"
os.environ["JWT_SECRET_KEY"] = "integration-test-secret-key-0123456789-abcdefghij"
os.environ.setdefault("DB_POOL_MAX", "40")

import config  # noqa: E402

if config.DB_CONFIG["database"] != TEST_DB_NAME:  # .env must never redirect the tests to another DB
    raise RuntimeError(f"Refusing to run: DB_CONFIG points to {config.DB_CONFIG['database']!r}, not {TEST_DB_NAME!r}")

import db  # noqa: E402
import fixtures_data  # noqa: E402


def _assert_test_database():
    with db.connect() as connection, connection.cursor() as cursor:
        cursor.execute("SELECT current_database()")
        name = cursor.fetchone()[0]
    if name != TEST_DB_NAME:
        pytest.exit(f"ABORT: connected to database {name!r}; tests only run on {TEST_DB_NAME!r}", returncode=3)


@pytest.fixture(scope="session", autouse=True)
def test_database():
    _assert_test_database()
    fixtures_data.purge(fixtures_data.ALL_TEST_COMPANIES)
    fixtures_data.create_all()
    yield
    if os.getenv("KEEP_TEST_DATA") != "1":
        fixtures_data.purge(fixtures_data.ALL_TEST_COMPANIES)


AUTH_PROBE: dict = {"error": None}


def _install_auth_fallback_if_broken():
    """If security._load_auth_snapshot itself is broken (SQL error), every API call returns 503 and no data-flow
    test could run. In that case install a minimal test-only replacement (same columns, same rules) so the rest
    of the suite still exercises the routes; test_00_smoke.test_auth_snapshot_query_works keeps failing to
    report the real bug."""
    import psycopg2
    import security

    try:
        security._load_auth_snapshot("T01", "t01.master@mosco-test.local")
        return
    except psycopg2.Error as error:
        AUTH_PROBE["error"] = f"{type(error).__name__}: {str(error).strip().splitlines()[0]}"
    original = security._load_auth_snapshot

    def fallback(companyid: str, email: str):
        with db.connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """SELECT u.companyid, c.companyname, u.username, u.email, UPPER(COALESCE(u.authority, 'USER')),
                          UPPER(COALESCE(u.useyn, 'N')), UPPER(COALESCE(c.company_status, '')), u.session_id,
                          (c.companyid <> '001' AND c.license_end IS NOT NULL
                           AND c.license_end < (now() AT TIME ZONE 'Asia/Seoul')::date),
                          COALESCE((SELECT ARRAY_AGG(DISTINCT m.menuid) FROM usermenupermission01t p
                                    JOIN menucatalog01t m ON m.menuid = p.menuid AND m.assignable AND UPPER(m.useyn) = 'Y'
                                         AND (m.access_scope = 'COMPANY' OR (m.access_scope = 'PLATFORM' AND u.companyid = '001'))
                                    WHERE p.companyid = u.companyid AND p.useremail = u.email AND UPPER(p.useyn) = 'Y'), ARRAY[]::varchar[])
                   FROM user01t u JOIN company01t c ON c.companyid = u.companyid
                   WHERE u.companyid = %s AND u.email = %s""",
                (companyid, email),
            )
            row = cursor.fetchone()
        if not row:
            return None
        cid, cname, uname, db_email, authority, useyn, status, sid, expired, menuids = row
        if useyn != "Y" or status != "ACTIVE" or expired:
            return None
        return {"companyid": cid, "companyname": cname or "", "username": uname or "", "email": db_email,
                "authority": authority or "USER", "menuids": frozenset(menuids or ()), "session_id": sid or ""}

    fallback.original = original
    security._load_auth_snapshot = fallback


@pytest.fixture(scope="session")
def app():
    import main  # imported lazily so the DB_NAME guard above always runs first

    _install_auth_fallback_if_broken()
    return main.app


@pytest.fixture(scope="session")
def api(app, test_database):
    from helpers import Api

    return Api(app)
