"""Time the main read paths for the bulk company 'P01' (run tests/perf/seed_bulk.py first). Test DB only.

    venv/Scripts/python.exe tests/perf/measure.py [--repeat 3]

Prints one row per call: first (cold-ish) run, median and best of the repeats, in milliseconds.
"""
import argparse
import os
import statistics
import sys
import time
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

HERE = Path(__file__).resolve()
sys.path.insert(0, str(HERE.parents[2]))
os.environ["DB_NAME"] = "Mosco_test"
os.environ.setdefault("DB_HOST", "localhost")
os.environ.setdefault("DB_USER", "postgres")
os.environ.setdefault("DB_PASSWORD", "1234")

import db  # noqa: E402
from services.closing import MonthClose  # noqa: E402
from services.dashboard import HomeOverview  # noqa: E402
from services.inbound import InboundRegister, InboundSearch  # noqa: E402
from services.inventory import CurrentStock, IniopStock  # noqa: E402
from services.outbound import GrossProfit, GrossProfitDashboard, OutboundRegister, OutboundSearch  # noqa: E402
from services.receiptpayment import CustomerLedger, InstrumentStatus, ReceiptPayment  # noqa: E402

C = "P01"
_INIOP = dict(iniotype="", receiptno="", customcode="", customname="", itemcode="", itemname="", thickness="", width="",
              length="", warehousecode="", warehousecodename="")
TODAY = datetime.now(ZoneInfo("Asia/Seoul")).date()
MONTH_FROM, MONTH_TO = date(2026, 11, 1), date(2026, 11, 30)
YEAR_FROM, YEAR_TO = date(2026, 1, 1), date(2026, 12, 31)


def in_rolled_back_tx(fn):
    def run():
        connection = db.open_connection()
        try:
            with connection.cursor() as cursor:
                return fn(cursor)
        finally:
            connection.rollback()
            connection.close()
    return run


CASES = [
    ("거래처원장 목록 (1년, 공급가)", lambda: CustomerLedger.list_balances(C, YEAR_FROM, YEAR_TO)),
    ("거래처원장 목록 (1년, 합계금액)", lambda: CustomerLedger.list_balances(C, YEAR_FROM, YEAR_TO, with_vat=True)),
    ("거래처원장 단일 거래처 (전체기간)", lambda: CustomerLedger.get_ledger(C, "C00001", date(2000, 1, 1), YEAR_TO)),
    ("채권채무 현황판 (dashboard)", lambda: CustomerLedger.dashboard(C, TODAY)),
    ("채권채무 현황판 (기간+거래처)", lambda: CustomerLedger.dashboard(C, TODAY, date_from=YEAR_FROM, ckey="C00007")),
    ("여신용 미수잔액 receivable_balance", in_rolled_back_tx(lambda cur: CustomerLedger.receivable_balance(cur, C, "C00007"))),
    ("홈 대시보드 overview (이번 달)", lambda: HomeOverview._overview(C, MONTH_FROM, MONTH_TO, TODAY, None, True, True)),
    ("홈 대시보드 overview (1년)", lambda: HomeOverview._overview(C, YEAR_FROM, YEAR_TO, TODAY, None, True, True)),
    ("현재고 목록 1쪽", lambda: CurrentStock.list_current_stock(C, 1, 50, itemcode="", itemname="", thickness=None, width=None,
                                                            length=None, warehousecode="", warehousecodename="")),
    ("현재고 검색 (품목 'I00123')", lambda: CurrentStock.list_current_stock(C, 1, 50, itemcode="", itemname="", thickness=None,
                                                                      width=None, length=None, warehousecode="", warehousecodename="",
                                                                      item_search="I00123")),
    ("현재고 목록 마지막 쪽", lambda: CurrentStock.list_current_stock(C, 1000, 50, itemcode="", itemname="", thickness=None, width=None,
                                                                length=None, warehousecode="", warehousecodename="")),
    ("재고수불 목록 (이번 달)", lambda: IniopStock.list_iniop_stock(C, 1, 50, date_from=MONTH_FROM, date_to=MONTH_TO, **_INIOP)),
    ("재고수불 목록 (1년)", lambda: IniopStock.list_iniop_stock(C, 1, 50, date_from=YEAR_FROM, date_to=YEAR_TO, **_INIOP)),
    ("매출용 현재고 선택 목록", lambda: OutboundRegister.list_available_stock(C, 1, 50)),
    ("매입등록 목록 1쪽 (1년)", lambda: InboundRegister.list_receipts(C, 1, 50, date_from=YEAR_FROM, date_to=YEAR_TO)),
    ("매출등록 목록 1쪽 (1년)", lambda: OutboundRegister.list_receipts(C, 1, 50, date_from=YEAR_FROM, date_to=YEAR_TO)),
    ("매입현황 상세 (1년)", lambda: InboundSearch.list_inbound_details(C, 1, 50, YEAR_FROM, YEAR_TO)),
    ("매출현황 상세 (1년)", lambda: OutboundSearch.list_outbound_details(C, 1, 50, YEAR_FROM, YEAR_TO)),
    ("매출현황 상세 (품목 검색)", lambda: OutboundSearch.list_outbound_details(C, 1, 50, YEAR_FROM, YEAR_TO, iteminfo="품목12")),
    ("매출이익분석 (이번 달)", lambda: GrossProfit.analyze(C, MONTH_FROM, MONTH_TO)),
    ("매출이익분석 (1년)", lambda: GrossProfit.analyze(C, YEAR_FROM, YEAR_TO)),
    ("매출이익 현황판 (1년)", lambda: GrossProfitDashboard.dashboard(C, YEAR_FROM, YEAR_TO)),
    ("수금/지급 목록 (1년)", lambda: ReceiptPayment.list_documents(C, 1, 15, YEAR_FROM, YEAR_TO)),
    ("수금/지급 상세행 (1년)", lambda: ReceiptPayment.list_detail_rows(C, 1, 50, YEAR_FROM, YEAR_TO)),
    ("보유어음 목록", lambda: ReceiptPayment.list_held_instruments(C)),
    ("수표/어음 현황", lambda: InstrumentStatus.list_instruments(C)),
    ("월마감 화면 (월별 건수)", lambda: MonthClose.list_months(C, 2026)),
    ("월마감 검사 ensure_open", in_rolled_back_tx(lambda cur: MonthClose.ensure_open(cur, C, [TODAY]))),
    ("채번: 입고번호", in_rolled_back_tx(lambda cur: InboundRegister._next_receiptno(cur, C))),
    ("채번: 출고번호", in_rolled_back_tx(lambda cur: OutboundRegister._next_receiptno(cur, C))),
    ("채번: 수금/지급번호", in_rolled_back_tx(lambda cur: ReceiptPayment._next_receiptno(cur, C, date(2026, 11, 20)))),
]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repeat", type=int, default=3)
    args = parser.parse_args()
    with db.connect() as connection, connection.cursor() as cursor:
        cursor.execute("SELECT current_database()")
        assert cursor.fetchone()[0] == "Mosco_test"
        counts = {}
        for table in ("customer01t", "itemcode01t", "inbound02t", "outbound02t", "iniop01t", "currentstock01t", "receiptpayment01t"):
            cursor.execute(f"SELECT COUNT(*) FROM {table} WHERE companyid = %s", (C,))
            counts[table] = cursor.fetchone()[0]
    print("P01 volume:", ", ".join(f"{k}={v:,}" for k, v in counts.items()))
    print(f"{'call':<36} {'first ms':>10} {'median ms':>10} {'best ms':>10}")
    print("-" * 70)
    for label, fn in CASES:
        timings = []
        error = None
        for _ in range(max(1, args.repeat)):
            started = time.perf_counter()
            try:
                fn()
            except Exception as exc:  # noqa: BLE001
                error = f"{type(exc).__name__}: {str(exc)[:80]}"
                break
            timings.append((time.perf_counter() - started) * 1000)
        if error:
            print(f"{label:<36} ERROR {error}")
            continue
        print(f"{label:<36} {timings[0]:>10.1f} {statistics.median(timings):>10.1f} {min(timings):>10.1f}")


if __name__ == "__main__":
    main()
