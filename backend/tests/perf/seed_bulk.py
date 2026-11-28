"""Bulk performance data for company 'P01' in the TEST database (Mosco_test) only.

    venv/Scripts/python.exe tests/perf/seed_bulk.py            # default sizes
    venv/Scripts/python.exe tests/perf/seed_bulk.py --scale 0.1  # 10 % (quick try)
    venv/Scripts/python.exe tests/perf/seed_bulk.py --purge      # remove P01 only

Default volume: 2,000 customers · 5,000 items · 200,000 inbound lines (40,000 receipts)
· 300,000 outbound lines (60,000 receipts) · 100,000 receipt/payment documents, with matching
Iniop01t (IN / OUT) rows and CurrentStock01t lots (remaining = inbound − outbound, cost = supply − cost of sales).
Everything is generated with set-based SQL (generate_series / INSERT … SELECT).

The data respects every CHECK / PK of the schema and the integrity rules of tests/integrity.py
(lot consumption, ledger rows, amounts, cost conservation) — run integrity.check('P01', ledger=False) to verify.
Triggers (audit log, month-close guard, FK triggers) are disabled for this session only
(session_replication_role = replica) so the load takes minutes, not hours.
"""
import argparse
import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve()
sys.path.insert(0, str(HERE.parents[2]))   # backend
sys.path.insert(0, str(HERE.parents[1]))   # tests
os.environ["DB_NAME"] = "Mosco_test"
os.environ.setdefault("DB_HOST", "localhost")
os.environ.setdefault("DB_USER", "postgres")
os.environ.setdefault("DB_PASSWORD", "1234")

import psycopg2  # noqa: E402

import config  # noqa: E402

COMPANY = "P01"
COMPANY_NAME = "성능테스트철강"
LAST_DAY = "2026-11-27"
FIRST_DAY = "2025-01-01"
SPAN_DAYS = 696   # FIRST_DAY .. LAST_DAY


def connect():
    if config.DB_CONFIG["database"] != "Mosco_test":
        raise SystemExit("refusing: not the test database")
    connection = psycopg2.connect(host=config.DB_CONFIG["host"], port=config.DB_CONFIG["port"], dbname="Mosco_test",
                                  user=config.DB_CONFIG["user"], password=config.DB_CONFIG["password"])
    with connection.cursor() as cursor:
        cursor.execute("SELECT current_database()")
        assert cursor.fetchone()[0] == "Mosco_test"
    return connection


def step(cursor, label, sql, params=None):
    started = time.perf_counter()
    cursor.execute(sql, params or {})
    print(f"  {label:<44} {cursor.rowcount:>9,} rows  {time.perf_counter() - started:7.1f}s", flush=True)


def purge(cursor):
    cursor.execute("SET session_replication_role = replica")
    cursor.execute(
        """SELECT c.table_name FROM information_schema.columns c
           JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
           WHERE c.table_schema = 'public' AND c.column_name = 'companyid' AND t.table_type = 'BASE TABLE'""")
    for (table,) in cursor.fetchall():
        cursor.execute(f"DELETE FROM {table} WHERE companyid = %s", (COMPANY,))
        if cursor.rowcount:
            print(f"  purge {table:<30} {cursor.rowcount:>9,}")


def seed(cursor, scale: float):
    n = {
        "customers": max(20, int(2000 * scale)), "items": max(50, int(5000 * scale)),
        "in_headers": max(100, int(40000 * scale)), "out_headers": max(150, int(60000 * scale)),
        "rp": max(100, int(100000 * scale)),
    }
    n["lots"] = n["in_headers"] * 5            # 200,000 inbound lines
    n["out_lines"] = n["out_headers"] * 5      # 300,000 outbound lines (every lot once, every 2nd lot twice)
    assert n["out_lines"] <= n["lots"] * 2
    p = {"c": COMPANY, "cn": COMPANY_NAME, "first": FIRST_DAY, "last": LAST_DAY, "span": SPAN_DAYS, **n}
    print(f"seeding {COMPANY}: {n}")
    cursor.execute("SET session_replication_role = replica")
    cursor.execute("SET LOCAL synchronous_commit = off")

    step(cursor, "company / user / codes", """
        INSERT INTO company01t (companyid, companyname, company_status, licensed_seats, created_by)
        VALUES (%(c)s, %(cn)s, 'ACTIVE', 50, 'perf');
        INSERT INTO user01t (companyid, email, username, password, authority, useyn, usercode, session_id)
        VALUES (%(c)s, 'p01.master@mosco-test.local', 'P01마스터', 'x', 'MASTER', 'Y', 'P01M', 'perf-session');
        INSERT INTO codemaster01t (companyid, companyname, groupcode, groupname, code, code_name, use_yn)
        SELECT %(c)s, %(cn)s, g, n, code, name, 'Y' FROM (VALUES
            ('PRICE_UNIT','단가단위','1','Kg'), ('PRICE_UNIT','단가단위','2','Ton'), ('PRICE_UNIT','단가단위','3','수량'),
            ('QTY','수량단위','1','EA'), ('MATERIAL','강종','1','SS400'), ('SURFACE','표면','1','PO'),
            ('PROCESS','공정구분','7','절단'), ('OTHER_COST','기타비용코드','49','운반비')) v(g, n, code, name)
        UNION ALL
        SELECT %(c)s, %(cn)s, 'WAREHOUSE', '창고', 'W' || lpad(w::text, 2, '0'), '창고' || w, 'Y' FROM generate_series(1, 10) w""", p)
    step(cursor, "customers", """
        INSERT INTO customer01t (companyid, companyname, customercode, customername, useyn, openingreceivable, openingpayable, creditlimit)
        SELECT %(c)s, %(cn)s, 'C' || lpad(g::text, 5, '0'), '거래처' || g, 'Y',
               CASE WHEN g %% 10 = 0 THEN 1000000 ELSE 0 END, CASE WHEN g %% 15 = 0 THEN 500000 ELSE 0 END,
               CASE WHEN g %% 7 = 0 THEN 50000000 END
        FROM generate_series(1, %(customers)s) g""", p)
    step(cursor, "items", """
        INSERT INTO itemcode01t (companyid, companyname, itemcode, itemname, itemtypecode, itemtypecodenm, use_yn)
        SELECT %(c)s, %(cn)s, 'I' || lpad(g::text, 5, '0'), '품목' || g || CASE WHEN g %% 2 = 0 THEN ' SHEET' ELSE ' COIL' END,
               CASE WHEN g %% 2 = 0 THEN '3' ELSE '1' END, CASE WHEN g %% 2 = 0 THEN 'SHEET' ELSE 'COIL' END, 'Y'
        FROM generate_series(1, %(items)s) g""", p)

    # ── inbound: headers (date-ordered numbering per day like the app: IN + yyyymmdd + 5 digits) ──
    step(cursor, "temp inbound headers", """
        CREATE TEMP TABLE perf_in ON COMMIT DROP AS
        SELECT n, d, 'IN' || to_char(d, 'YYYYMMDD') || lpad(ROW_NUMBER() OVER (PARTITION BY d ORDER BY n)::text, 5, '0') AS receiptno,
               'C' || lpad(((n * 13) %% %(customers)s + 1)::text, 5, '0') AS customcode,
               'W' || lpad((n %% 10 + 1)::text, 2, '0') AS wh
        FROM (SELECT g AS n, (%(first)s::date + ((g::bigint * 37) %% %(span)s)::int) AS d FROM generate_series(1, %(in_headers)s) g) x""", p)
    cursor.execute("CREATE INDEX ON perf_in (n); ANALYZE perf_in")
    step(cursor, "temp lots", """
        CREATE TEMP TABLE perf_lot ON COMMIT DROP AS
        SELECT (h.n - 1) * 5 + l AS k, h.n, l AS lineno, h.receiptno, h.d, h.customcode, h.wh,
               'I' || lpad(((((h.n - 1) * 5 + l)::bigint * 7919) %% %(items)s + 1)::text, 5, '0') AS itemcode,
               10::numeric AS qty, (1000 + ((h.n - 1) * 5 + l) %% 500)::numeric AS weight,
               (1000 + ((h.n - 1) * 5 + l) %% 300)::numeric AS unitprice
        FROM perf_in h CROSS JOIN generate_series(1, 5) l""", p)
    cursor.execute("CREATE INDEX ON perf_lot (k); CREATE INDEX ON perf_lot (receiptno, lineno); ANALYZE perf_lot")
    step(cursor, "inbound01t", """
        INSERT INTO inbound01t (companyid, companyname, receiptno, receptdate, customcode, customname, subulyn, created_by, created_at)
        SELECT %(c)s, %(cn)s, h.receiptno, h.d, h.customcode, '거래처' || ltrim(substr(h.customcode, 2), '0'), 'N', 'perf',
               h.d + time '09:00' FROM perf_in h""", p)
    step(cursor, "inbound02t", """
        INSERT INTO inbound02t (companyid, companyname, receiptno, lineno, itemcode, itemname, materialcode, materialname,
                                thickness, width, length, qty, qtyunit, weight, unit, unitprice, supplyamt, vat, unitamt,
                                warehousecode, warehousecodename, created_by, created_at)
        SELECT %(c)s, %(cn)s, l.receiptno, l.lineno, l.itemcode, i.itemname, '1', 'SS400', 1.2, 1219,
               CASE WHEN i.itemtypecode = '3' THEN 2438 ELSE 0 END, l.qty, '1', l.weight, '1', l.unitprice,
               l.weight * l.unitprice, ROUND(l.weight * l.unitprice * 0.1, 2), l.weight * l.unitprice + ROUND(l.weight * l.unitprice * 0.1, 2),
               l.wh, '창고' || ltrim(substr(l.wh, 2), '0'), 'perf', l.d + time '09:00'
        FROM perf_lot l JOIN itemcode01t i ON i.companyid = %(c)s AND i.itemcode = l.itemcode""", p)

    # ── outbound lines: line j uses lot ((j-1) %% lots) + 1 → every lot once, the first half twice ──
    step(cursor, "temp outbound lines", """
        CREATE TEMP TABLE perf_out ON COMMIT DROP AS
        SELECT j, (j - 1) / 5 + 1 AS h, (j - 1) %% 5 + 1 AS lineno, l.k, l.receiptno AS lotno, l.lineno AS lotline, l.d AS lotdate,
               l.itemcode, l.weight AS lotweight, l.unitprice AS lotprice,
               3::numeric AS qty, ROUND(l.weight * 0.3, 3) AS weight, (l.unitprice + 200)::numeric AS unitprice,
               ROUND(l.weight * l.unitprice * 0.3, 2) AS costamt
        FROM generate_series(1, %(out_lines)s) j JOIN perf_lot l ON l.k = (j - 1) %% %(lots)s + 1""", p)
    step(cursor, "temp outbound headers", """
        CREATE TEMP TABLE perf_outh ON COMMIT DROP AS
        SELECT h, d, 'OUT' || to_char(d, 'YYYYMMDD') || lpad(ROW_NUMBER() OVER (PARTITION BY d ORDER BY h)::text, 5, '0') AS receiptno,
               'C' || lpad(((h * 17) %% %(customers)s + 1)::text, 5, '0') AS customcode
        FROM (SELECT h, LEAST(MAX(lotdate) + (h %% 20)::int, %(last)s::date) AS d FROM perf_out GROUP BY h) x""", p)
    cursor.execute("CREATE INDEX ON perf_outh (h); CREATE INDEX ON perf_outh (receiptno); CREATE INDEX ON perf_out (h, lineno); "
                   "CREATE INDEX ON perf_out (lotno, lotline); ANALYZE perf_out; ANALYZE perf_outh")
    cursor.execute("ANALYZE inbound01t; ANALYZE inbound02t")
    step(cursor, "outbound01t", """
        INSERT INTO outbound01t (companyid, companyname, receiptno, receptdate, customcode, customname, subulyn, created_by, created_at)
        SELECT %(c)s, %(cn)s, receiptno, d, customcode, '거래처' || ltrim(substr(customcode, 2), '0'), 'N', 'perf', d + time '14:00'
        FROM perf_outh""", p)
    step(cursor, "outbound02t", """
        INSERT INTO outbound02t (companyid, companyname, receiptno, lineno, stocksourcetype, stocksourceno, stocksourceline,
                                 itemcode, itemname, materialcode, materialname, thickness, width, length, qty, qtyunit, weight,
                                 adjweight, unit, unitprice, supplyamt, vat, unitamt, warehousecode, warehousecodename, created_by, created_at)
        SELECT %(c)s, %(cn)s, h.receiptno, o.lineno, 'INBOUND', o.lotno, o.lotline, d.itemcode, d.itemname, '1', 'SS400',
               d.thickness, d.width, d.length, o.qty, 'EA', o.weight, 0, 'Kg', o.unitprice,
               ROUND(o.weight * o.unitprice, 2), ROUND(ROUND(o.weight * o.unitprice, 2) * 0.1, 2),
               ROUND(o.weight * o.unitprice, 2) + ROUND(ROUND(o.weight * o.unitprice, 2) * 0.1, 2),
               d.warehousecode, d.warehousecodename, 'perf', h.d + time '14:00'
        FROM perf_out o JOIN perf_outh h ON h.h = o.h
        JOIN inbound02t d ON d.companyid = %(c)s AND d.receiptno = o.lotno AND d.lineno = o.lotline""", p)

    # ── ledger rows + lots ──
    cursor.execute("ANALYZE outbound01t; ANALYZE outbound02t")
    step(cursor, "iniop01t IN", """
        INSERT INTO iniop01t (companyid, companyname, customcode, customname, iniodate, iniotype, iniokind, receiptno, lineno,
                              itemcode, itemname, materialcode, materialname, thickness, width, length, qty, qtyunit, unit, unitprice,
                              supplyamt, vat, unitamt, costamt, expamt, feeamt, weight, warehousecode, warehousecodename, created_by)
        SELECT d.companyid, d.companyname, h.customcode, h.customname, h.receptdate, 'IN', 'IN', d.receiptno, d.lineno,
               d.itemcode, d.itemname, d.materialcode, d.materialname, d.thickness, d.width, d.length, d.qty, 'EA', 'Kg', d.unitprice,
               d.supplyamt, d.vat, d.unitamt, d.supplyamt, 0, 0, d.weight, d.warehousecode, d.warehousecodename, 'perf'
        FROM inbound02t d JOIN inbound01t h ON h.companyid = d.companyid AND h.receiptno = d.receiptno
        WHERE d.companyid = %(c)s""", p)
    step(cursor, "iniop01t OUT", """
        INSERT INTO iniop01t (companyid, companyname, customcode, customname, iniodate, iniotype, iniokind, receiptno, lineno,
                              itemcode, itemname, materialcode, materialname, thickness, width, length, qty, qtyunit, unit, unitprice,
                              supplyamt, vat, unitamt, costamt, expamt, feeamt, weight, warehousecode, warehousecodename, created_by)
        SELECT d.companyid, d.companyname, h.customcode, h.customname, h.receptdate, 'OUT', 'OUT', d.receiptno, d.lineno,
               d.itemcode, d.itemname, d.materialcode, d.materialname, d.thickness, d.width, d.length, d.qty, 'EA', 'Kg', d.unitprice,
               d.supplyamt, d.vat, d.unitamt, o.costamt, 0, 0, d.weight, d.warehousecode, d.warehousecodename, 'perf'
        FROM outbound02t d JOIN outbound01t h ON h.companyid = d.companyid AND h.receiptno = d.receiptno
        JOIN perf_outh oh ON oh.receiptno = h.receiptno
        JOIN perf_out o ON o.h = oh.h AND o.lineno = d.lineno
        WHERE d.companyid = %(c)s""", p)
    step(cursor, "currentstock01t", """
        INSERT INTO currentstock01t (companyid, companyname, customcode, customname, sourcetype, sourceno, sourceline, stockkind,
                                     receiptdate, itemcode, itemname, materialcode, materialname, thickness, width, length,
                                     originalqty, qty, qtyunit, originalweight, weight, unit, unitprice, costamt, expamt, feeamt,
                                     warehousecode, warehousecodename, created_by)
        SELECT d.companyid, d.companyname, h.customcode, h.customname, 'INBOUND', d.receiptno, d.lineno, 'INBOUND', h.receptdate,
               d.itemcode, d.itemname, d.materialcode, d.materialname, d.thickness, d.width, d.length,
               d.qty, d.qty - COALESCE(u.qty, 0), 'EA', d.weight, d.weight - COALESCE(u.weight, 0), 'Kg', d.unitprice,
               d.supplyamt - COALESCE(u.cost, 0), 0, 0, d.warehousecode, d.warehousecodename, 'perf'
        FROM inbound02t d JOIN inbound01t h ON h.companyid = d.companyid AND h.receiptno = d.receiptno
        LEFT JOIN (SELECT lotno, lotline, SUM(qty) qty, SUM(weight) weight, SUM(costamt) cost FROM perf_out GROUP BY 1, 2) u
               ON u.lotno = d.receiptno AND u.lotline = d.lineno
        WHERE d.companyid = %(c)s""", p)

    # ── receipt / payment: 70 % cash receipts, 20 % cash payments, 10 % notes (held / settled) ──
    step(cursor, "temp receipt/payment", """
        CREATE TEMP TABLE perf_rp ON COMMIT DROP AS
        SELECT g, d, 'RP' || to_char(d, 'YYYYMMDD') || lpad(ROW_NUMBER() OVER (PARTITION BY d ORDER BY g)::text, 5, '0') AS receiptno,
               CASE WHEN g %% 10 < 7 OR g %% 10 = 9 THEN 'RECEIPT' ELSE 'PAYMENT' END AS t,
               'C' || lpad(((g * 31) %% %(customers)s + 1)::text, 5, '0') AS customcode,
               (100000 + (g %% 1000) * 1000)::numeric AS amt, g %% 10 = 9 AS is_note
        FROM (SELECT g, (%(first)s::date + ((g::bigint * 53) %% %(span)s)::int) AS d FROM generate_series(1, %(rp)s) g) x""", p)
    step(cursor, "receiptpayment01t", """
        INSERT INTO receiptpayment01t (companyid, companyname, receiptno, receiptdate, transactiontype, customcode, customname, created_by, created_at)
        SELECT %(c)s, %(cn)s, receiptno, d, t, customcode, '거래처' || ltrim(substr(customcode, 2), '0'), 'perf', d + time '16:00' FROM perf_rp""", p)
    step(cursor, "receiptpayment02t", """
        INSERT INTO receiptpayment02t (companyid, companyname, receiptno, lineno, cashamt, instrumentamt, totalamt,
                                       instrumenttype, instrumentno, issuedate, issuercompany, issuekind, maturitydate,
                                       instrumentstatus, processdate, created_by)
        SELECT %(c)s, %(cn)s, receiptno, 1, CASE WHEN is_note THEN 0 ELSE amt END, CASE WHEN is_note THEN amt ELSE 0 END, amt,
               CASE WHEN is_note THEN 'PROMISSORY' END, CASE WHEN is_note THEN 'PN-' || g END, CASE WHEN is_note THEN d END,
               CASE WHEN is_note THEN '발행사' || (g %% 50) END, CASE WHEN is_note THEN 'OTHER' END,
               CASE WHEN is_note THEN d + 90 END,
               CASE WHEN is_note AND d + 90 <= %(last)s::date THEN 'SETTLED' WHEN is_note THEN 'HELD' END,
               CASE WHEN is_note AND d + 90 <= %(last)s::date THEN d + 90 END, 'perf'
        FROM perf_rp""", p)
    for table in ("customer01t", "itemcode01t", "inbound01t", "inbound02t", "outbound01t", "outbound02t", "iniop01t",
                  "currentstock01t", "receiptpayment01t", "receiptpayment02t"):
        cursor.execute(f"ANALYZE {table}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--scale", type=float, default=1.0)
    parser.add_argument("--purge", action="store_true", help="only remove P01")
    args = parser.parse_args()
    started = time.perf_counter()
    connection = connect()
    try:
        with connection.cursor() as cursor:
            print("purging previous P01 data ...")
            purge(cursor)
            connection.commit()
            if not args.purge:
                seed(cursor, args.scale)
                connection.commit()
    finally:
        connection.close()
    print(f"done in {time.perf_counter() - started:.1f}s")


if __name__ == "__main__":
    main()
