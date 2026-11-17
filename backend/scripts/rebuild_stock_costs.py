"""재고·수불 원가금액(costamt)을 전표 순서대로 다시 계산한다 (끝전까지 맞는 금액 잔액 방식).

기초재고·매입으로 원가를 만들고, 출고·가공·창고이동을 날짜·등록 순서대로 다시 돌려 빠진 원가를 수불장에,
남은 원가를 현재고에 적는다. 계산 규칙은 저장할 때와 같다 (services/inventory/stock_cost.py).

실행 (backend 폴더에서):
    python scripts/rebuild_stock_costs.py 001            # 점검만 (변경 없음)
    python scripts/rebuild_stock_costs.py 001 --apply    # 실제 반영
다른 DB에 하려면 DB_NAME 환경변수를 지정한다 (예: DB_NAME=Mosco_verify).
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import db  # noqa: E402
from services.inventory import stock_cost  # noqa: E402


def run(companyid: str, apply: bool) -> None:
    with db.connect() as connection, connection.cursor() as cursor:
        # 입고·출고·가공·이동 저장과 겹치지 않게 회사 재고 잠금을 잡는다
        cursor.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"stand-stock:{companyid}",))
        result = stock_cost.rebuild_stock_costs(cursor, companyid)
        cursor.execute(
            """SELECT COALESCE(SUM(CASE WHEN iniotype IN ('ST', 'IN') THEN costamt ELSE -costamt END), 0)
               FROM Iniop01t WHERE companyid = %s""",
            (companyid,),
        )
        ledger_balance = cursor.fetchone()[0]
        cursor.execute("SELECT COALESCE(SUM(costamt), 0) FROM CurrentStock01t WHERE companyid = %s", (companyid,))
        stock_amount = cursor.fetchone()[0]
        print(f"[{companyid}] 전표 {result['documents']}건, 현재고 {result['stock_rows']}행, 수불장 {result['ledger_rows']}행")
        print(f"  들어온 원가 − 빠진 원가 = {ledger_balance:,},  현재고 재고금액 = {stock_amount:,}")
        if result["missing_lots"]:
            print(f"  원가를 만들지 못한 재고: {result['missing_lots'][:10]}")
        if result["weight_mismatch"]:
            print(f"  다시 돌린 중량이 현재고와 다른 재고: {result['weight_mismatch'][:10]}")
        cursor.execute(
            """SELECT COALESCE(SUM(CASE WHEN iniotype IN ('ST', 'IN') THEN expamt ELSE -expamt END), 0),
                      COALESCE(SUM(CASE WHEN iniotype IN ('ST', 'IN') THEN feeamt ELSE -feeamt END), 0),
                      (SELECT COALESCE(SUM(expamt), 0) FROM CurrentStock01t WHERE companyid = %s),
                      (SELECT COALESCE(SUM(feeamt), 0) FROM CurrentStock01t WHERE companyid = %s),
                      (SELECT COUNT(*) FROM CurrentStock01t WHERE companyid = %s AND (expamt < 0 OR feeamt < 0 OR expamt + feeamt > costamt))
               FROM Iniop01t WHERE companyid = %s""",
            (companyid, companyid, companyid, companyid),
        )
        exp_ledger, fee_ledger, exp_stock, fee_stock, bad_parts = cursor.fetchone()
        print(f"  기타비용: 수불 {exp_ledger:,} / 현재고 {exp_stock:,},  가공금액: 수불 {fee_ledger:,} / 현재고 {fee_stock:,},  구성 이상 {bad_parts}건")
        if exp_ledger != exp_stock or fee_ledger != fee_stock or bad_parts:
            raise SystemExit("원가 구성 금액이 맞지 않아 반영하지 않습니다.")
        if ledger_balance != stock_amount or result["missing_lots"] or result["weight_mismatch"]:
            raise SystemExit("원가가 맞지 않아 반영하지 않습니다.")
        if not apply:
            connection.rollback()
            print("  점검만 했습니다 (--apply 를 붙이면 반영).")
        else:
            print("  반영했습니다.")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    run(sys.argv[1], "--apply" in sys.argv[2:])
