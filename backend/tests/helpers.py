"""Shared helpers: authenticated API client, SQL shortcuts and document payload builders."""
from __future__ import annotations

from decimal import Decimal

from fastapi.testclient import TestClient

import db
import fixtures_data
import security

T01_MASTER = "t01.master@mosco-test.local"
T01_USER = "t01.user@mosco-test.local"
T01_NOMENU = "t01.nomenu@mosco-test.local"
T02_MASTER = "t02.master@mosco-test.local"
T03_APPROVER = "t03.approver@mosco-test.local"
T03_USER = "t03.user@mosco-test.local"

_COMPANY_OF = {email: companyid for companyid, email, *_ in fixtures_data.USERS}


def token_for(email: str) -> str:
    return security.create_access_token({
        "user_email": email,
        "user_company": _COMPANY_OF[email],
        "user_companyname": fixtures_data.COMPANIES[_COMPANY_OF[email]],
        "session_id": fixtures_data.SESSIONS[email],
    })


class Api:
    def __init__(self, app):
        # no `with` block: the app's startup hooks (license scheduler thread) are not started in tests
        self.client = TestClient(app, raise_server_exceptions=False)
        self._tokens: dict[str, str] = {}

    def _headers(self, user: str, extra: dict | None = None) -> dict:
        if user not in self._tokens:
            self._tokens[user] = token_for(user)
        headers = {"Authorization": f"Bearer {self._tokens[user]}"}
        headers.update(extra or {})
        return headers

    def call(self, method: str, path: str, user: str = T01_MASTER, json=None, params=None, headers=None):
        return self.client.request(method, path, json=json, params=params, headers=self._headers(user, headers))

    def get(self, path, user=T01_MASTER, **kw):
        return self.call("GET", path, user, **kw)

    def post(self, path, user=T01_MASTER, **kw):
        return self.call("POST", path, user, **kw)

    def put(self, path, user=T01_MASTER, **kw):
        return self.call("PUT", path, user, **kw)

    def patch(self, path, user=T01_MASTER, **kw):
        return self.call("PATCH", path, user, **kw)

    def delete(self, path, user=T01_MASTER, **kw):
        return self.call("DELETE", path, user, **kw)


def ok(response, status: int = 200) -> dict:
    assert response.status_code == status, f"{response.request.method} {response.request.url} -> {response.status_code}: {response.text[:800]}"
    return response.json()


# ── SQL shortcuts (test DB only) ──────────────────────────────────────────────
def rows(sql: str, params=None) -> list[dict]:
    with db.connect() as connection, connection.cursor() as cursor:
        cursor.execute(sql, params or ())
        if cursor.description is None:
            return []
        columns = [c[0] for c in cursor.description]
        return [dict(zip(columns, row)) for row in cursor.fetchall()]


def one(sql: str, params=None):
    result = rows(sql, params)
    return result[0] if result else None


def scalar(sql: str, params=None):
    with db.connect() as connection, connection.cursor() as cursor:
        cursor.execute(sql, params or ())
        row = cursor.fetchone()
        return row[0] if row else None


def execute(sql: str, params=None) -> int:
    with db.connect() as connection, connection.cursor() as cursor:
        cursor.execute(sql, params or ())
        return cursor.rowcount


def D(value) -> Decimal:
    return Decimal(str(value))


def snapshot(companyid: str) -> dict:
    """Row counts + key sums of every document table for a company (to prove 'no partial writes')."""
    result = {}
    for table, sums in (
        ("inbound01t", ""), ("inbound02t", ", SUM(qty), SUM(weight), SUM(unitamt)"), ("inbound03t", ", SUM(totalamt)"),
        ("outbound01t", ""), ("outbound02t", ", SUM(qty), SUM(weight), SUM(unitamt)"), ("outbound03t", ", SUM(totalamt)"),
        ("inoutmove01t", ""), ("inoutmove02t", ", SUM(qty), SUM(weight)"),
        ("process01t", ""), ("process02t", ", SUM(qty), SUM(weight)"),
        ("standstock01t", ", SUM(qty), SUM(weight), SUM(unitamt)"),
        ("receiptpayment01t", ""), ("receiptpayment02t", ", SUM(totalamt)"),
        ("iniop01t", ", SUM(qty), SUM(weight), SUM(costamt)"),
        ("currentstock01t", ", SUM(qty), SUM(weight), SUM(costamt)"),
        ("approval_request01t", ""), ("monthclose01t", ""),
    ):
        with db.connect() as connection, connection.cursor() as cursor:
            cursor.execute(f"SELECT COUNT(*){sums} FROM {table} WHERE companyid = %s", (companyid,))
            result[table] = tuple(cursor.fetchone())
    result["rp_status"] = tuple(
        (r["receiptno"], r["lineno"], r["instrumentstatus"], r["processdate"])
        for r in rows("""SELECT receiptno, lineno, instrumentstatus, processdate FROM receiptpayment02t
                         WHERE companyid = %s ORDER BY 1, 2""", (companyid,))
    )
    result["headers"] = tuple(
        (r["k"],) for r in rows(
            """SELECT 'IN:' || receiptno || ':' || receptdate || ':' || customcode || ':' || COALESCE(manager, '') AS k FROM inbound01t WHERE companyid = %(c)s
               UNION ALL SELECT 'OUT:' || receiptno || ':' || receptdate || ':' || customcode || ':' || COALESCE(manager, '') || ':' || COALESCE(destination, '') FROM outbound01t WHERE companyid = %(c)s
               UNION ALL SELECT 'RP:' || receiptno || ':' || receiptdate || ':' || customcode || ':' || transactiontype FROM receiptpayment01t WHERE companyid = %(c)s
               UNION ALL SELECT 'PR:' || processno || ':' || processdate FROM process01t WHERE companyid = %(c)s
               UNION ALL SELECT 'MV:' || receiptno || ':' || receptdate FROM inoutmove01t WHERE companyid = %(c)s
               UNION ALL SELECT 'OUTD:' || receiptno || ':' || lineno || ':' || unitprice || ':' || qty FROM outbound02t WHERE companyid = %(c)s
               UNION ALL SELECT 'ST:' || lineno || ':' || COALESCE(unitprice, -1) FROM standstock01t WHERE companyid = %(c)s
               ORDER BY 1""", {"c": companyid})
    )
    return result


# ── payload builders ─────────────────────────────────────────────────────────
def inbound_payload(receptdate: str, customcode: str = "V001", lines: list[dict] | None = None, expenses=None,
                    manager: str = "", description: str = "") -> dict:
    return {
        "receiptno": "", "receptdate": receptdate, "customcode": customcode, "customname": "",
        "manager": manager, "description": description, "is_new": True,
        "items": lines or [inbound_line()], "expenses": expenses or [],
    }


def inbound_line(itemcode="I002", itemname="테스트시트", qty="10", weight="1000", unitprice="1000", unit="1",
                 qtyunit="1", warehouse="W1", thickness="1.2", width="1219", length="2438", **extra) -> dict:
    names = {"W1": "본사창고", "W2": "제2창고"}
    line = {
        "itemcode": itemcode, "itemname": itemname, "productname": extra.pop("productname", ""),
        "materialcode": "1", "materialname": "SS400", "surfacecode": "", "surfacename": "",
        "thickness": thickness, "width": width, "length": length,
        "qtyunit": qtyunit, "qty": qty, "unitprice": unitprice, "weight": weight,
        "warehousecode": warehouse, "warehousecodename": names.get(warehouse, warehouse), "unit": unit,
    }
    line.update(extra)
    return line


def outbound_payload(receptdate: str, lines: list[dict], customcode: str = "C001", receiptno: str = "",
                     is_new: bool = True, manager: str = "", destination: str = "", description: str = "", expenses=None) -> dict:
    return {
        "receiptno": receiptno, "receptdate": receptdate, "customcode": customcode, "customname": "",
        "manager": manager, "destination": destination, "description": description, "is_new": is_new,
        "items": lines, "expenses": expenses or [],
    }


def outbound_line(lot: tuple, qty, weight, unitprice="1500", unit="1", adjweight="0", description="") -> dict:
    return {"stocksourcetype": lot[0], "stocksourceno": lot[1], "stocksourceline": lot[2],
            "qty": str(qty), "weight": str(weight), "adjweight": str(adjweight), "unit": unit,
            "unitprice": str(unitprice), "description": description}


def rp_payload(receiptdate: str, transactiontype: str, customcode: str, customname: str, items: list[dict],
               receiptno: str = "", manager: str = "", description: str = "") -> dict:
    return {"receiptno": receiptno, "receiptdate": receiptdate, "transactiontype": transactiontype,
            "customcode": customcode, "customname": customname, "manager": manager, "description": description,
            "items": items}


def lots_of(companyid: str, sourceno: str) -> list[tuple]:
    return [(r["sourcetype"], r["sourceno"], r["sourceline"]) for r in rows(
        "SELECT sourcetype, sourceno, sourceline FROM currentstock01t WHERE companyid = %s AND sourceno = %s ORDER BY sourceline",
        (companyid, sourceno))]


def lot(companyid: str, key: tuple) -> dict | None:
    return one("""SELECT * FROM currentstock01t WHERE companyid = %s AND sourcetype = %s AND sourceno = %s AND sourceline = %s""",
               (companyid, *key))


def create_inbound(api, receptdate: str, user: str = T01_MASTER, **kw) -> tuple[str, list[tuple]]:
    body = ok(api.put("/api/inbound-register/receipts", user, json=inbound_payload(receptdate, **kw)))
    receiptno = body["receiptno"]
    company = _COMPANY_OF[user]
    return receiptno, lots_of(company, receiptno)


def create_outbound(api, receptdate: str, lines: list[dict], user: str = T01_MASTER, **kw) -> str:
    body = ok(api.post("/api/outbound-register/receipts", user, json=outbound_payload(receptdate, lines, **kw)))
    return body["receiptno"]
