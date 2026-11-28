"""SQL fixtures for the isolated test tenants (Mosco_test only — see conftest.py)."""
import secrets

import db

ALL_TEST_COMPANIES = ("T01", "T02", "T03")

COMPANIES = {
    "T01": "테스트철강1",
    "T02": "테스트철강2",
    "T03": "테스트철강3(통제)",
}

# (companyid, email, name, authority, usercode)
USERS = [
    ("T01", "t01.master@mosco-test.local", "T01마스터", "MASTER", "T01M"),
    ("T01", "t01.user@mosco-test.local", "T01사용자", "USER", "T01U"),
    ("T01", "t01.nomenu@mosco-test.local", "T01권한없음", "USER", "T01N"),
    ("T02", "t02.master@mosco-test.local", "T02마스터", "MASTER", "T02M"),
    ("T03", "t03.approver@mosco-test.local", "T03승인자", "MASTER", "T03A"),
    ("T03", "t03.user@mosco-test.local", "T03요청자", "USER", "T03U"),
]
# users that only get the HOME menu (permission check)
LIMITED_USERS = {"t01.nomenu@mosco-test.local"}

CUSTOMERS = [
    # code, name, opening receivable, opening payable
    ("C001", "매출처A", 0, 0),
    ("C002", "매출처B", 100000, 0),
    ("V001", "매입처A", 0, 50000),
    ("P001", "가공처A", 0, 0),
    ("X001", "운송사A", 0, 0),
]

ITEMS = [("I001", "테스트코일", "1", "COIL"), ("I002", "테스트시트", "3", "SHEET")]

CODES = [
    # groupcode, groupname, code, code_name
    ("PRICE_UNIT", "단가단위", "1", "Kg"),
    ("PRICE_UNIT", "단가단위", "2", "Ton"),
    ("PRICE_UNIT", "단가단위", "3", "수량"),
    ("QTY", "수량단위", "1", "EA"),
    ("QTY", "수량단위", "4", "SH"),
    ("WAREHOUSE", "창고", "W1", "본사창고"),
    ("WAREHOUSE", "창고", "W2", "제2창고"),
    ("MATERIAL", "강종", "1", "SS400"),
    ("SURFACE", "표면", "1", "PO"),
    ("PROCESS", "공정구분", "1", "등분"),
    ("PROCESS", "공정구분", "7", "절단"),
    ("OTHER_COST", "기타비용코드", "49", "운반비"),
]

SESSIONS: dict[str, str] = {}


def purge(companies) -> None:
    """Remove every row of the given test companies from every table that has a companyid column."""
    companies = list(companies)
    assert all(c.startswith("T") or c.startswith("P") for c in companies)
    with db.connect() as connection, connection.cursor() as cursor:
        cursor.execute("SELECT current_database()")
        assert cursor.fetchone()[0] == "Mosco_test"
        cursor.execute(
            """SELECT c.table_name FROM information_schema.columns c
               JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
               WHERE c.table_schema = 'public' AND c.column_name = 'companyid' AND t.table_type = 'BASE TABLE'"""
        )
        tables = [row[0] for row in cursor.fetchall()]
        # month-close DB guard (migration 0001) would refuse deleting documents of closed months: bypass for cleanup only
        cursor.execute("SELECT set_config('mosco.skip_close_check', 'on', true)")
        first = [t for t in ("approval_request01t", "monthclose01t") if t in tables]
        last = ["company01t"] + [t for t in ("audit_log01t", "access_log01t") if t in tables]
        middle = [t for t in tables if t not in first and t not in last]
        # detail tables before headers (FKs are mostly ON DELETE CASCADE, but some are RESTRICT)
        middle.sort(key=lambda name: (0 if name.endswith(("02t", "03t")) or "permission" in name else 1, name))
        for table in first + middle + last:
            cursor.execute(f"DELETE FROM {table} WHERE companyid = ANY(%s)", (companies,))
        cursor.execute("DELETE FROM user01t WHERE companyid = ANY(%s)", (companies,))


def create_all() -> None:
    with db.connect() as connection, connection.cursor() as cursor:
        cursor.execute("SELECT menuid FROM menucatalog01t WHERE access_scope = 'COMPANY' AND assignable AND useyn = 'Y'")
        menus = [row[0] for row in cursor.fetchall()]
        for companyid, name in COMPANIES.items():
            cursor.execute(
                """INSERT INTO company01t (companyid, companyname, company_status, licensed_seats, created_by)
                   VALUES (%s, %s, 'ACTIVE', 10, 'pytest')""",
                (companyid, name),
            )
            for groupcode, groupname, code, code_name in CODES:
                cursor.execute(
                    """INSERT INTO codemaster01t (companyid, companyname, groupcode, groupname, code, code_name, use_yn)
                       VALUES (%s, %s, %s, %s, %s, %s, 'Y')""",
                    (companyid, name, groupcode, groupname, code, code_name),
                )
            for code, cname, recv, pay in CUSTOMERS:
                cursor.execute(
                    """INSERT INTO customer01t (companyid, companyname, customercode, customername, useyn,
                                                openingreceivable, openingpayable)
                       VALUES (%s, %s, %s, %s, 'Y', %s, %s)""",
                    (companyid, name, code, cname, recv, pay),
                )
            for code, iname, typecode, typename in ITEMS:
                cursor.execute(
                    """INSERT INTO itemcode01t (companyid, companyname, itemcode, itemname, itemtypecode, itemtypecodenm, use_yn)
                       VALUES (%s, %s, %s, %s, %s, %s, 'Y')""",
                    (companyid, name, code, iname, typecode, typename),
                )
        for companyid, email, uname, authority, usercode in USERS:
            sid = secrets.token_hex(16)
            SESSIONS[email] = sid
            cursor.execute(
                """INSERT INTO user01t (companyid, email, username, password, authority, useyn, usercode, session_id)
                   VALUES (%s, %s, %s, 'x', %s, 'Y', %s, %s)""",
                (companyid, email, uname, authority, usercode, sid),
            )
            for menuid in (["HOME"] if email in LIMITED_USERS else menus):
                cursor.execute(
                    """INSERT INTO usermenupermission01t (companyid, useremail, menuid, useyn, createdby)
                       VALUES (%s, %s, %s, 'Y', 'pytest')""",
                    (companyid, email, menuid),
                )
        # T03: approval control on (outbound create / inbound delete / receipt-payment create), approver = T03 master
        cursor.execute(
            """INSERT INTO control_approver01t (companyid, companyname, useremail, created_by)
               VALUES ('T03', %s, 't03.approver@mosco-test.local', 'pytest')""",
            (COMPANIES["T03"],),
        )
        for target, on_create, on_delete in (("OUTBOUND", "Y", "N"), ("INBOUND", "N", "Y"), ("RECEIPT_PAYMENT", "Y", "N")):
            cursor.execute(
                """INSERT INTO control_policy01t (companyid, companyname, target, on_create, on_update, on_delete, created_by)
                   VALUES ('T03', %s, %s, %s, 'N', %s, 'pytest')""",
                (COMPANIES["T03"], target, on_create, on_delete),
            )
