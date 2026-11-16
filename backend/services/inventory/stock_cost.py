"""재고 원가단가(kg당) 계산 공용 모듈.

CurrentStock01t.costprice = 그 재고 로트의 kg당 원가 (부가세 제외).
  - 매입(INBOUND): (매입 공급가 + 매입 기타비용 배부액) / 중량. 기타비용(운반비 등)은 전표 안에서 중량 비율로 배부한다.
  - 기초(OPENING): 기초재고 공급가 / 중량.
  - 이동(TRANSFER): 원래 재고의 원가단가를 그대로 가져간다.
  - 가공(PROCESS): (원소재 원가 × 투입중량 + 가공비 합계) / 가공품 재고중량. 원재료 원가가 가공품으로 넘어온다.
    여러 단계 가공이면 중간 단계 가공비는 그 아래 최종 가공품에 중량 비율로 나눠 붙는다.

unitprice(입력 단가: 매입단가·가공비)는 전표 금액 그대로 두고, 재고금액·원가는 costprice로 본다.
재고금액 = 현재 중량 × costprice.
"""

from decimal import ROUND_HALF_UP, Decimal

ZERO = Decimal("0")
COST_PLACES = Decimal("0.001")  # CurrentStock01t.costprice numeric(15,3)

STOCK_KINDS = ("OPENING", "INBOUND", "PROCESS", "TRANSFER")


def _dec(value) -> Decimal:
    return Decimal(str(value if value is not None else 0))


def _round(value: Decimal) -> Decimal:
    return value.quantize(COST_PLACES, rounding=ROUND_HALF_UP)


def per_kg(total_cost, weight) -> Decimal:
    weight = _dec(weight)
    return _round(_dec(total_cost) / weight) if weight > 0 else ZERO


def allocate_by_weight(total, weights: list) -> list[Decimal]:
    """total 을 weights 비율로 나눈다. 반올림 차이는 마지막 행이 가져가 합계가 정확히 total 이 된다."""
    total = _dec(total)
    weights = [_dec(weight) for weight in weights]
    weight_sum = sum(weights, ZERO)
    if not weights:
        return []
    if total == 0 or weight_sum <= 0:
        return [ZERO] * len(weights)
    shares = [(total * weight / weight_sum).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) for weight in weights[:-1]]
    shares.append(total - sum(shares, ZERO))
    return shares


def inbound_cost_prices(lines: list[dict], expense_total) -> list[Decimal]:
    """lines: [{supplyamt, weight}] (전표 순서). 기타비용 합계(공급가)를 중량 비율로 배부한 kg당 원가."""
    shares = allocate_by_weight(expense_total, [line.get("weight") for line in lines])
    return [per_kg(_dec(line.get("supplyamt")) + share, line.get("weight")) for line, share in zip(lines, shares)]


def process_product_costs(material_cost, nodes: list[dict]) -> dict:
    """가공 한 원소재 트리의 최종 가공품별 kg당 원가.

    material_cost: 원소재 원가 금액 (원소재 kg당 원가 × 투입중량)
    nodes: [{id, parent (None = 원소재 바로 아래), fee (가공비 금액), weight (재고로 들어가는 중량)}]
    반환: {최종 가공품 id: kg당 원가}. 최종 가공품 원가 합계 = 원소재 원가 + 모든 단계 가공비.
    """
    parents = {node["parent"] for node in nodes if node["parent"] is not None}
    children: dict = {}
    for node in nodes:
        children.setdefault(node["parent"], []).append(node)

    def leaves_under(node_id):
        found = []
        for child in children.get(node_id, []):
            found.extend(leaves_under(child["id"]) if child["id"] in parents else [child])
        return found

    leaves = leaves_under(None)
    totals = {leaf["id"]: ZERO for leaf in leaves}
    for leaf, share in zip(leaves, allocate_by_weight(material_cost, [leaf["weight"] for leaf in leaves])):
        totals[leaf["id"]] += share
    for node in nodes:
        fee = _dec(node.get("fee"))
        if not fee:
            continue
        if node["id"] in parents:
            below = leaves_under(node["id"])
            for leaf, share in zip(below, allocate_by_weight(fee, [leaf["weight"] for leaf in below])):
                totals[leaf["id"]] += share
        else:
            totals[node["id"]] += fee
    return {leaf["id"]: per_kg(totals[leaf["id"]], leaf["weight"]) for leaf in leaves}


def lot_cost_prices(cursor, companyid: str, keys) -> dict:
    """{(sourcetype, sourceno, sourceline): kg당 원가} — 이미 잠근/읽은 재고 로트의 원가단가."""
    keys = sorted(set(keys))
    if not keys:
        return {}
    cursor.execute(
        """SELECT sourcetype, sourceno, sourceline, costprice FROM CurrentStock01t
           WHERE companyid = %s
             AND (sourcetype, sourceno, sourceline) IN (SELECT * FROM unnest(%s::varchar[], %s::varchar[], %s::integer[]))""",
        (companyid, [k[0] for k in keys], [k[1] for k in keys], [int(k[2]) for k in keys]),
    )
    return {(row[0], row[1], int(row[2])): _dec(row[3]) for row in cursor.fetchall()}


def stock_kind_label(kind: str) -> str:
    return {"OPENING": "기초", "INBOUND": "입고", "PROCESS": "가공", "TRANSFER": "이동"}.get(kind or "", kind or "")


# ---------------------------------------------------------------------------
# 기존 데이터 원가단가 재계산 (마이그레이션·점검용). 저장 로직과 같은 규칙을 쓴다.
# ---------------------------------------------------------------------------
def rebuild_cost_prices(cursor, companyid: str) -> dict:
    counts = {"OPENING": 0, "INBOUND": 0, "PROCESS": 0, "TRANSFER": 0}

    # 1) 기초재고
    cursor.execute(
        """UPDATE CurrentStock01t cs
           SET costprice = CASE WHEN s.weight > 0 THEN ROUND(COALESCE(s.supplyamt, 0) / s.weight, 3) ELSE 0 END
           FROM StandStock01t s
           WHERE cs.companyid = %s AND cs.sourcetype = 'OPENING'
             AND s.companyid = cs.companyid AND s.lineno = cs.sourceline""",
        (companyid,),
    )
    counts["OPENING"] = cursor.rowcount

    # 2) 매입 (전표별 기타비용 중량 배부)
    cursor.execute(
        """SELECT d.receiptno, d.lineno, d.supplyamt, d.weight,
                  COALESCE((SELECT SUM(e.supplyamt) FROM Inbound03t e
                            WHERE e.companyid = d.companyid AND e.receiptno = d.receiptno), 0)
           FROM Inbound02t d
           WHERE d.companyid = %s
           ORDER BY d.receiptno, d.lineno""",
        (companyid,),
    )
    receipts: dict = {}
    for receiptno, lineno, supplyamt, weight, expense in cursor.fetchall():
        receipts.setdefault(receiptno, {"expense": expense, "lines": []})["lines"].append(
            {"lineno": lineno, "supplyamt": supplyamt, "weight": weight})
    updates = []
    for receiptno, receipt in receipts.items():
        for line, cost in zip(receipt["lines"], inbound_cost_prices(receipt["lines"], receipt["expense"])):
            updates.append((receiptno, int(line["lineno"]), cost))
    if updates:
        cursor.execute(
            """UPDATE CurrentStock01t cs SET costprice = v.cost
               FROM unnest(%s::varchar[], %s::integer[], %s::numeric[]) AS v(sourceno, sourceline, cost)
               WHERE cs.companyid = %s AND cs.sourcetype = 'INBOUND'
                 AND cs.sourceno = v.sourceno AND cs.sourceline = v.sourceline""",
            ([u[0] for u in updates], [u[1] for u in updates], [u[2] for u in updates], companyid),
        )
        counts["INBOUND"] = cursor.rowcount

    # 3) 가공·이동은 앞 단계 원가가 정해진 뒤에 계산해야 하므로 날짜·등록 순서대로 처리한다
    cursor.execute(
        """SELECT 'PROCESS', processno, processdate, createdat FROM Process01t WHERE companyid = %s
           UNION ALL
           SELECT 'TRANSFER', receiptno, receptdate, created_at FROM Inoutmove01t WHERE companyid = %s
           ORDER BY 3, 4, 2""",
        (companyid, companyid),
    )
    for kind, docno, _date, _created in cursor.fetchall():
        if kind == "PROCESS":
            counts["PROCESS"] += _rebuild_process(cursor, companyid, docno)
        else:
            counts["TRANSFER"] += _rebuild_transfer(cursor, companyid, docno)
    return counts


_PROCESS_LINE_SQL = """SELECT processno, lineno, linetype, parentlineno, sourcelineno,
                             stocksourcetype, stocksourceno, stocksourceline,
                             weight, COALESCE(lossweight, 0), COALESCE(supplyamt, 0)
                      FROM Process02t WHERE companyid = %s AND processno = ANY(%s) ORDER BY processno, lineno"""


def _process_trees(rows) -> list[tuple]:
    """Process02t 행 → [(원소재 행, 가공품 노드 목록)]. 노드 무게 = 최종 가공품은 제품중량 + 배부 로스 (저장 때와 같다)."""
    trees = []
    for source in (row for row in rows if row[2].strip() == "SOURCE"):
        products = [row for row in rows if row[2].strip() == "PRODUCT" and row[0] == source[0] and row[4] == source[1]]
        parent_lines = {row[3] for row in products}
        nodes = [{
            "id": row[1],
            "parent": None if row[3] == source[1] else row[3],
            "fee": row[10],
            "weight": _dec(row[8]) + (_dec(row[9]) if row[1] not in parent_lines else ZERO),
        } for row in products]
        trees.append((source, nodes))
    return trees


def process_fee_rates(cursor, companyid: str, processnos) -> dict:
    """{(가공번호, 최종 가공품 순번): kg당 가공비} — 이 가공의 모든 단계 가공비를 최종 가공품에 나눈 값.
    원가단가(costprice) 중 가공비 몫이며, 나머지는 원재료 원가다 (매출이익 화면의 가공비/원자재원가 구분용)."""
    processnos = sorted({str(no) for no in processnos if no})
    if not processnos:
        return {}
    cursor.execute(_PROCESS_LINE_SQL, (companyid, processnos))
    rows = cursor.fetchall()
    rates = {}
    for processno in processnos:
        for _source, nodes in _process_trees([row for row in rows if row[0] == processno]):
            for lineno, fee_per_kg in process_product_costs(ZERO, nodes).items():
                rates[(processno, int(lineno))] = fee_per_kg
    return rates


def _rebuild_process(cursor, companyid: str, processno: str) -> int:
    cursor.execute(_PROCESS_LINE_SQL, (companyid, [processno]))
    trees = _process_trees(cursor.fetchall())
    lot_costs = lot_cost_prices(cursor, companyid, [(source[5], source[6], source[7]) for source, _ in trees])
    updates = []
    for source, nodes in trees:
        material = lot_costs.get((source[5], source[6], int(source[7])), ZERO) * _dec(source[8])
        for lineno, cost in process_product_costs(material, nodes).items():
            updates.append((int(lineno), cost))
    for lineno, cost in updates:
        cursor.execute(
            """UPDATE CurrentStock01t SET costprice = %s
               WHERE companyid = %s AND sourcetype = 'INBOUND' AND sourceno = %s AND sourceline = %s""",
            (cost, companyid, processno, lineno),
        )
    return len(updates)


def _rebuild_transfer(cursor, companyid: str, receiptno: str) -> int:
    cursor.execute(
        """UPDATE CurrentStock01t dst SET costprice = src.costprice
           FROM Inoutmove02t m
           JOIN CurrentStock01t src
             ON src.companyid = m.companyid AND src.sourcetype = m.stocksourcetype
            AND src.sourceno = m.stocksourceno AND src.sourceline = m.stocksourceline
           WHERE m.companyid = %s AND m.receiptno = %s
             AND dst.companyid = m.companyid AND dst.sourceno = m.receiptno
             AND dst.sourceline = m.lineno * 2   -- 이전 상세 n행 → 도착 재고 순번 2n (저장 규칙)""",
        (companyid, receiptno),
    )
    return cursor.rowcount
