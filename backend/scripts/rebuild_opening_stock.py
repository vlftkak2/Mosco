"""기초재고(StandStock01t) 기준으로 기초 수불장(Iniop01t ST)과 현재고(CurrentStock01t OPENING)를 다시 만든다.

- 기초재고 원본(StandStock01t)은 그대로 두고, 거기서 만든 ST 수불 행과 OPENING 현재고 행만 지웠다가 다시 넣는다.
- 원래 기초 전표번호(ST…)와 행번호를 그대로 쓰므로 다른 전표가 참조하는 키는 바뀌지 않는다.
- 출고·가공·이동에 이미 쓰인 기초재고가 있으면 아무것도 하지 않고 멈춘다.
- 마지막에 모든 재고·수불의 원가금액(costamt)을 전표 순서대로 다시 계산한다.

실행 (backend 폴더에서):
    python scripts/rebuild_opening_stock.py 001            # 점검만 (변경 없음)
    python scripts/rebuild_opening_stock.py 001 --apply    # 실제 반영
다른 DB에 하려면 DB_NAME 환경변수를 지정한다 (예: DB_NAME=Mosco_verify).
"""

import sys
from collections import OrderedDict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import db  # noqa: E402
from services.inventory import CurrentStock as current_stock  # noqa: E402
from services.inventory import stock_cost  # noqa: E402

COLUMNS = ("lineno", "standdate", "customcode", "customname", "itemcode", "itemname", "productname",
           "surfacecode", "surfacename", "materialcode", "materialname", "myrtle", "thickness", "width", "length",
           "qty", "qtyunit", "weight", "warehousecode", "warehousecodename", "unit", "unitprice",
           "supplyamt", "vat", "unitamt", "created_by")


def rebuild(companyid: str, apply: bool) -> None:
    with db.connect() as connection, connection.cursor() as cursor:
        cursor.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"stand-stock:{companyid}",))
        cursor.execute("SELECT companyname FROM Company01t WHERE companyid = %s", (companyid,))
        row = cursor.fetchone()
        if not row:
            raise SystemExit(f"회사를 찾을 수 없습니다: {companyid}")
        companyname = row[0]

        # 쓰인 기초재고가 있으면 다시 만들 수 없다 (참조가 끊긴다)
        cursor.execute(
            """SELECT COUNT(*) FROM CurrentStock01t s
               WHERE s.companyid = %s AND s.sourcetype = 'OPENING'
                 AND (s.qty <> s.originalqty OR s.weight <> s.originalweight
                      OR EXISTS (SELECT 1 FROM Outbound02t o WHERE o.companyid = s.companyid AND o.stocksourcetype = 'OPENING'
                                 AND o.stocksourceno = s.sourceno AND o.stocksourceline = s.sourceline)
                      OR EXISTS (SELECT 1 FROM Process02t p WHERE p.companyid = s.companyid AND p.stocksourcetype = 'OPENING'
                                 AND p.stocksourceno = s.sourceno AND p.stocksourceline = s.sourceline)
                      OR EXISTS (SELECT 1 FROM Inoutmove02t m WHERE m.companyid = s.companyid AND m.stocksourcetype = 'OPENING'
                                 AND m.stocksourceno = s.sourceno AND m.stocksourceline = s.sourceline))""",
            (companyid,),
        )
        used = cursor.fetchone()[0]
        if used:
            raise SystemExit(f"출고·가공·이동에 쓰인 기초재고가 {used}건 있어 다시 만들 수 없습니다.")

        # 행번호 → 원래 기초 전표번호
        cursor.execute("SELECT lineno, receiptno FROM Iniop01t WHERE companyid = %s AND iniotype = 'ST'", (companyid,))
        receipt_by_line = {int(lineno): receiptno for lineno, receiptno in cursor.fetchall()}
        cursor.execute(
            f"SELECT {', '.join(COLUMNS)} FROM StandStock01t WHERE companyid = %s ORDER BY lineno",
            (companyid,),
        )
        stand_rows = [dict(zip(COLUMNS, values)) for values in cursor.fetchall()]

        cursor.execute("SELECT COUNT(*), COALESCE(SUM(weight), 0) FROM Iniop01t WHERE companyid = %s AND iniotype = 'ST'", (companyid,))
        before_ledger = cursor.fetchone()
        cursor.execute("SELECT COUNT(*), COALESCE(SUM(weight), 0) FROM CurrentStock01t WHERE companyid = %s AND sourcetype = 'OPENING'", (companyid,))
        before_stock = cursor.fetchone()
        stand_weight = sum((row["weight"] or 0) for row in stand_rows)
        print(f"[{companyid}] 기초재고 {len(stand_rows)}행 / 중량 {stand_weight}")
        print(f"  현재 수불장 ST {before_ledger[0]}행 / {before_ledger[1]},  현재고 OPENING {before_stock[0]}행 / {before_stock[1]}")

        documents: "OrderedDict[str, list[dict]]" = OrderedDict()
        new_receiptno = None
        for row in stand_rows:
            receiptno = receipt_by_line.get(int(row["lineno"]))
            if not receiptno:
                new_receiptno = new_receiptno or current_stock.next_opening_receiptno(cursor, companyid)
                receiptno = new_receiptno
            documents.setdefault(receiptno, []).append(row)

        cursor.execute("DELETE FROM Iniop01t WHERE companyid = %s AND iniotype = 'ST'", (companyid,))
        deleted_ledger = cursor.rowcount
        cursor.execute("DELETE FROM CurrentStock01t WHERE companyid = %s AND sourcetype = 'OPENING'", (companyid,))
        deleted_stock = cursor.rowcount

        for receiptno, rows in documents.items():
            lines = [{
                **row,
                "receptdate": row["standdate"],
                "productname": row["productname"] or "",
                "surfacecode": row["surfacecode"] or "",
                "surfacename": row["surfacename"] or "",
            } for row in rows]
            current_stock.record_document(
                cursor, companyid, companyname, rows[0]["standdate"], "ST", receiptno, lines,
                created_by=rows[0]["created_by"],
            )
        costs = stock_cost.rebuild_stock_costs(cursor, companyid)

        cursor.execute("SELECT COUNT(*), COALESCE(SUM(weight), 0) FROM Iniop01t WHERE companyid = %s AND iniotype = 'ST'", (companyid,))
        after_ledger = cursor.fetchone()
        cursor.execute("SELECT COUNT(*), COALESCE(SUM(weight), 0) FROM CurrentStock01t WHERE companyid = %s AND sourcetype = 'OPENING'", (companyid,))
        after_stock = cursor.fetchone()
        print(f"  삭제: 수불장 ST {deleted_ledger}행, 현재고 OPENING {deleted_stock}행")
        print(f"  생성: 수불장 ST {after_ledger[0]}행 / {after_ledger[1]},  현재고 OPENING {after_stock[0]}행 / {after_stock[1]}")
        print(f"  원가 재계산: {costs}")
        if after_ledger[0] != len(stand_rows) or after_stock[0] != len(stand_rows):
            raise SystemExit("생성 행 수가 기초재고 행 수와 다릅니다. 반영하지 않습니다.")
        if not apply:
            connection.rollback()
            print("  점검만 했습니다 (--apply 를 붙이면 반영).")
        else:
            print("  반영했습니다.")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    rebuild(sys.argv[1], "--apply" in sys.argv[2:])
