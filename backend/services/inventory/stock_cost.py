"""재고 원가 공용 모듈 — 금액 잔액 방식 (끝전까지 맞는다).

CurrentStock01t.costamt   = 재고 로트에 남아 있는 원가금액 (= 재고금액)
Iniop01t.costamt          = 그 수불 행의 원가금액 (기초·매입입고·가공입고·이동입고: 생긴 원가 / 매출출고·가공투입·이동출고: 빠진 원가)
원가단가(kg)는 저장하지 않고 화면에서 계산한다: 남은 원가금액 ÷ 남은 중량

원가가 생길 때 (부가세 제외)
  기초 : 기초재고 공급가
  매입 : 공급가 + 매입 기타비용 배부액. 기타비용(운반비 등)은 전표 안에서 중량 비율로 원 단위 배부, 끝전은 마지막 라인.
  가공 : 원소재에서 빠진 원가 + 이 가공의 모든 단계 가공비를 최종 가공품에 재고중량(로스 포함) 비율로 원 단위 배부.
         중간 단계 가공비는 그 아래 최종 가공품에만 나눈다. 끝전은 마지막 가공품.
  이동 : 원래 재고에서 빠진 원가 그대로.

원가가 빠질 때 (출고·가공투입·이동)
  남은 원가 × (빼는 중량 ÷ 남은 중량)을 원 단위 반올림. 남은 중량을 다 쓰면 남은 원가 전부.
  → 어떤 순서로 나눠 써도 (빠진 원가 합계 + 남은 원가) = 처음 원가. 삭제·수정 때는 수불장에 적힌 금액을 그대로 되돌린다.
"""

from decimal import ROUND_HALF_UP, Decimal

ZERO = Decimal("0")
WON = Decimal("1")
COST_PLACES = Decimal("0.01")  # kg당 원가 표시 자릿수 (소수 둘째 자리)

STOCK_KINDS = ("OPENING", "INBOUND", "PROCESS", "TRANSFER")


def _dec(value) -> Decimal:
    return Decimal(str(value if value is not None else 0))


def per_kg(total_cost, weight) -> Decimal:
    weight = _dec(weight)
    return (_dec(total_cost) / weight).quantize(COST_PLACES, rounding=ROUND_HALF_UP) if weight > 0 else ZERO


def allocate_by_weight(total, weights: list) -> list[Decimal]:
    """total 을 weights 비율로 원 단위로 나눈다. 끝전은 마지막 행이 가져가 합계가 정확히 total 이 된다."""
    total = _dec(total)
    weights = [_dec(weight) for weight in weights]
    if not weights:
        return []
    weight_sum = sum(weights, ZERO)
    if total == 0 or weight_sum <= 0:
        return [ZERO] * (len(weights) - 1) + [total]
    shares = [(total * weight / weight_sum).quantize(WON, rounding=ROUND_HALF_UP) for weight in weights[:-1]]
    shares.append(total - sum(shares, ZERO))
    return shares


def consume_cost(remaining_cost, remaining_weight, weight) -> Decimal:
    """재고에서 weight 만큼 뺄 때 빠지는 원가. 남은 중량을 다 쓰면 남은 원가 전부."""
    remaining_cost, remaining_weight, weight = _dec(remaining_cost), _dec(remaining_weight), _dec(weight)
    if remaining_weight <= 0 or weight >= remaining_weight:
        return remaining_cost
    return min(remaining_cost, (remaining_cost * weight / remaining_weight).quantize(WON, rounding=ROUND_HALF_UP))


def inbound_cost_amounts(lines: list[dict], expense_total) -> list[Decimal]:
    """lines: [{supplyamt, weight}] (전표 순서). 라인 원가금액 = 공급가 + 기타비용(공급가 합계) 중량 배부액."""
    shares = allocate_by_weight(expense_total, [line.get("weight") for line in lines])
    return [_dec(line.get("supplyamt")) + share for line, share in zip(lines, shares)]


def _leaves(nodes: list[dict]):
    parents = {node["parent"] for node in nodes if node["parent"] is not None}
    children: dict = {}
    for node in nodes:
        children.setdefault(node["parent"], []).append(node)

    def leaves_under(node_id):
        found = []
        for child in children.get(node_id, []):
            found.extend(leaves_under(child["id"]) if child["id"] in parents else [child])
        return found

    return parents, leaves_under


def process_product_amounts(material_cost, nodes: list[dict]) -> dict:
    """가공 한 원소재 트리의 최종 가공품별 원가금액.

    material_cost: 원소재에서 빠진 원가금액
    nodes: [{id, parent (None = 원소재 바로 아래), fee (가공비 금액), weight (재고로 들어가는 중량)}]
    반환: {최종 가공품 id: 원가금액}. 합계 = 원소재 원가 + 모든 단계 가공비 (끝전까지 일치).
    """
    parents, leaves_under = _leaves(nodes)
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
    return totals


def process_product_costs(material_cost, nodes: list[dict]) -> dict:
    """{최종 가공품 id: kg당 원가} (참고용)."""
    weights = {node["id"]: node["weight"] for node in nodes}
    return {key: per_kg(amount, weights[key]) for key, amount in process_product_amounts(material_cost, nodes).items()}


def stock_kind_label(kind: str) -> str:
    return {"OPENING": "기초", "INBOUND": "입고", "PROCESS": "가공", "TRANSFER": "이동"}.get(kind or "", kind or "")


# ---------------------------------------------------------------------------
# 가공 전표 행 → 원소재별 트리
# ---------------------------------------------------------------------------
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
    """{(가공번호, 최종 가공품 순번): kg당 가공비} — 매출이익 화면의 가공비/원자재원가 칸 구분용."""
    processnos = sorted({str(no) for no in processnos if no})
    if not processnos:
        return {}
    cursor.execute(_PROCESS_LINE_SQL, (companyid, processnos))
    rows = cursor.fetchall()
    rates = {}
    for processno in processnos:
        for _source, nodes in _process_trees([row for row in rows if row[0] == processno]):
            weights = {node["id"]: _dec(node["weight"]) for node in nodes}
            # 화면 표시용 반올림(per_kg) 없이 정밀하게: 매출이익에서 kg당 가공비 × 출고중량을 원 단위로 반올림한다
            for lineno, fee in process_product_amounts(ZERO, nodes).items():
                weight = weights[lineno]
                rates[(processno, int(lineno))] = (fee / weight).quantize(Decimal("0.000001")) if weight > 0 else ZERO
    return rates


# ---------------------------------------------------------------------------
# 기존 데이터 원가 다시 계산 (마이그레이션·점검용). 저장 로직과 같은 규칙으로 전표를 날짜·등록 순서대로 다시 돌린다.
# ---------------------------------------------------------------------------
def rebuild_stock_costs(cursor, companyid: str) -> dict:
    lots: dict = {}    # (sourcetype, sourceno, sourceline) → [남은 원가, 남은 중량(모의), 남은 기타비용, 남은 가공금액]
    ledger: dict = {}  # (iniotype, receiptno, lineno) → (원가, 기타비용, 가공금액)

    cursor.execute(
        """SELECT sourcetype, sourceno, sourceline, originalweight, weight
           FROM CurrentStock01t WHERE companyid = %s""",
        (companyid,),
    )
    stock = {(row[0], row[1], int(row[2])): {"original": _dec(row[3]), "weight": _dec(row[4])} for row in cursor.fetchall()}

    def create(key, cost, exp, fee, ledger_key):
        lots[key] = [_dec(cost), stock.get(key, {}).get("original", ZERO), _dec(exp), _dec(fee)]
        ledger[ledger_key] = (_dec(cost), _dec(exp), _dec(fee))

    def consume(key, weight, ledger_key):
        lot = lots.get(key)
        if lot is None:
            raise ValueError(f"원가를 계산할 원천 재고가 없습니다: {key}")
        parts = consume_parts(lot[0], lot[2], lot[3], lot[1], weight)
        lot[0] -= parts[0]
        lot[1] -= _dec(weight)
        lot[2] -= parts[1]
        lot[3] -= parts[2]
        ledger[ledger_key] = parts
        return parts

    # 1) 기초재고 (기타비용·가공금액 없음)
    cursor.execute(
        """SELECT cs.sourceno, cs.sourceline, COALESCE(s.supplyamt, 0)
           FROM CurrentStock01t cs JOIN StandStock01t s ON s.companyid = cs.companyid AND s.lineno = cs.sourceline
           WHERE cs.companyid = %s AND cs.sourcetype = 'OPENING'""",
        (companyid,),
    )
    for sourceno, sourceline, supplyamt in cursor.fetchall():
        create(("OPENING", sourceno, int(sourceline)), supplyamt, ZERO, ZERO, ("ST", sourceno, int(sourceline)))

    # 2) 매입 (전표별 기타비용 중량 배부)
    cursor.execute(
        """SELECT d.receiptno, d.lineno, d.supplyamt, d.weight,
                  COALESCE((SELECT SUM(e.supplyamt) FROM Inbound03t e
                            WHERE e.companyid = d.companyid AND e.receiptno = d.receiptno), 0)
           FROM Inbound02t d WHERE d.companyid = %s ORDER BY d.receiptno, d.lineno""",
        (companyid,),
    )
    receipts: dict = {}
    for receiptno, lineno, supplyamt, weight, expense in cursor.fetchall():
        receipts.setdefault(receiptno, {"expense": expense, "lines": []})["lines"].append(
            {"lineno": int(lineno), "supplyamt": supplyamt, "weight": weight})
    for receiptno, receipt in receipts.items():
        for line, (cost, exp) in zip(receipt["lines"], inbound_cost_parts(receipt["lines"], receipt["expense"])):
            create(("INBOUND", receiptno, line["lineno"]), cost, exp, ZERO, ("IN", receiptno, line["lineno"]))

    # 3) 출고·가공·이동을 날짜·등록 순서대로
    cursor.execute(
        """SELECT 'OUT', receiptno, receptdate, created_at FROM Outbound01t WHERE companyid = %s
           UNION ALL SELECT 'PROCESS', processno, processdate, createdat FROM Process01t WHERE companyid = %s
           UNION ALL SELECT 'MOVE', receiptno, receptdate, created_at FROM Inoutmove01t WHERE companyid = %s
           ORDER BY 3, 4, 2""",
        (companyid, companyid, companyid),
    )
    documents = cursor.fetchall()
    for kind, docno, _date, _created in documents:
        if kind == "OUT":
            cursor.execute(
                """SELECT lineno, stocksourcetype, stocksourceno, stocksourceline, weight FROM Outbound02t
                   WHERE companyid = %s AND receiptno = %s ORDER BY lineno""",
                (companyid, docno),
            )
            for lineno, stype, sno, sline, weight in cursor.fetchall():
                consume((stype, sno, int(sline)), weight, ("OUT", docno, int(lineno)))
        elif kind == "PROCESS":
            cursor.execute(_PROCESS_LINE_SQL, (companyid, [docno]))
            for source, nodes in _process_trees(cursor.fetchall()):
                cost, exp, fee = consume((source[5], source[6], int(source[7])), source[8], ("OUT", docno, int(source[1])))
                for lineno, parts in process_product_parts(cost, exp, fee, nodes).items():
                    create(("INBOUND", docno, int(lineno)), *parts, ("IN", docno, int(lineno)))
        else:
            cursor.execute(
                """SELECT lineno, stocksourcetype, stocksourceno, stocksourceline, weight FROM Inoutmove02t
                   WHERE companyid = %s AND receiptno = %s ORDER BY lineno""",
                (companyid, docno),
            )
            for lineno, stype, sno, sline, weight in cursor.fetchall():
                parts = consume((stype, sno, int(sline)), weight, ("OUT", docno, int(lineno) * 2 - 1))
                create(("INBOUND", docno, int(lineno) * 2), *parts, ("IN", docno, int(lineno) * 2))

    # 4) 저장: 현재고 남은 금액, 수불장 원가 금액
    missing = sorted(set(stock) - set(lots))
    mismatched = sorted(key for key, lot in lots.items() if key in stock and lot[1] != stock[key]["weight"])
    keys = sorted(lots)
    cursor.execute(
        """UPDATE CurrentStock01t cs SET costamt = v.costamt, expamt = v.expamt, feeamt = v.feeamt
           FROM unnest(%s::varchar[], %s::varchar[], %s::integer[], %s::numeric[], %s::numeric[], %s::numeric[])
                AS v(sourcetype, sourceno, sourceline, costamt, expamt, feeamt)
           WHERE cs.companyid = %s AND cs.sourcetype = v.sourcetype AND cs.sourceno = v.sourceno
             AND cs.sourceline = v.sourceline""",
        ([k[0] for k in keys], [k[1] for k in keys], [k[2] for k in keys], [lots[k][0] for k in keys],
         [lots[k][2] for k in keys], [lots[k][3] for k in keys], companyid),
    )
    stock_rows = cursor.rowcount
    ledger_keys = sorted(ledger)
    cursor.execute(
        """UPDATE Iniop01t i SET costamt = v.costamt, expamt = v.expamt, feeamt = v.feeamt
           FROM unnest(%s::varchar[], %s::varchar[], %s::integer[], %s::numeric[], %s::numeric[], %s::numeric[])
                AS v(iniotype, receiptno, lineno, costamt, expamt, feeamt)
           WHERE i.companyid = %s AND i.iniotype = v.iniotype AND i.receiptno = v.receiptno AND i.lineno = v.lineno""",
        ([k[0] for k in ledger_keys], [k[1] for k in ledger_keys], [k[2] for k in ledger_keys],
         [ledger[k][0] for k in ledger_keys], [ledger[k][1] for k in ledger_keys], [ledger[k][2] for k in ledger_keys], companyid),
    )
    return {"documents": len(documents), "stock_rows": stock_rows, "ledger_rows": cursor.rowcount,
            "missing_lots": missing, "weight_mismatch": mismatched}


def recost_opening_lot(cursor, companyid: str, sourceline: int, total_cost) -> None:
    """기초재고 단가를 고쳤을 때: 그 기초재고의 원가를 total_cost 로 바꾸고, 이미 출고된 줄의 원가를 날짜·등록 순서대로 다시 나눈다.
    (가공·이동에 쓰인 기초재고는 호출 전에 막는다 — 원가가 다른 재고로 넘어갔기 때문)"""
    cursor.execute(
        """SELECT sourceno, originalweight FROM CurrentStock01t
           WHERE companyid = %s AND sourcetype = 'OPENING' AND sourceline = %s FOR UPDATE""",
        (companyid, sourceline),
    )
    row = cursor.fetchone()
    if not row:
        raise ValueError(f"기초재고 현재고 원천 라인을 찾을 수 없습니다: {sourceline}")
    sourceno, original_weight = row
    cursor.execute(
        """SELECT d.receiptno, d.lineno, d.weight FROM Outbound02t d
           JOIN Outbound01t h ON h.companyid = d.companyid AND h.receiptno = d.receiptno
           WHERE d.companyid = %s AND d.stocksourcetype = 'OPENING' AND d.stocksourceno = %s AND d.stocksourceline = %s
           ORDER BY h.receptdate, h.created_at, d.receiptno, d.lineno""",
        (companyid, sourceno, sourceline),
    )
    remaining_cost, remaining_weight = _dec(total_cost), _dec(original_weight)
    for receiptno, lineno, weight in cursor.fetchall():
        amount = consume_cost(remaining_cost, remaining_weight, weight)
        remaining_cost -= amount
        remaining_weight -= _dec(weight)
        cursor.execute(
            "UPDATE Iniop01t SET costamt = %s WHERE companyid = %s AND iniotype = 'OUT' AND receiptno = %s AND lineno = %s",
            (amount, companyid, receiptno, lineno),
        )
    cursor.execute(
        """UPDATE CurrentStock01t SET costamt = %s
           WHERE companyid = %s AND sourcetype = 'OPENING' AND sourceline = %s""",
        (remaining_cost, companyid, sourceline),
    )


# ---------------------------------------------------------------------------
# 원가 구성 금액: 원가(costamt) = 실제원가 + 기타비용(expamt) + 가공금액(feeamt)
# ---------------------------------------------------------------------------
def consume_parts(cost, exp, fee, remaining_weight, weight) -> tuple[Decimal, Decimal, Decimal]:
    """재고에서 weight 만큼 뺄 때 빠지는 (원가, 기타비용, 가공금액). 세 금액 모두 같은 비율 · 다 쓰면 남은 금액 전부."""
    cost_out = consume_cost(cost, remaining_weight, weight)
    exp_out = consume_cost(exp, remaining_weight, weight)
    fee_out = consume_cost(fee, remaining_weight, weight)
    over = exp_out + fee_out - cost_out  # 반올림 끝전으로 구성 금액이 빠지는 원가를 넘지 않게
    if over > 0:
        take = min(over, fee_out)
        fee_out -= take
        exp_out -= over - take
    return cost_out, exp_out, fee_out


def inbound_cost_parts(lines: list[dict], expense_total) -> list[tuple[Decimal, Decimal]]:
    """매입 라인별 (원가, 기타비용 배부액)."""
    shares = allocate_by_weight(expense_total, [line.get("weight") for line in lines])
    return [(_dec(line.get("supplyamt")) + share, share) for line, share in zip(lines, shares)]


def process_product_parts(consumed_cost, consumed_exp, consumed_fee, nodes: list[dict]) -> dict:
    """가공 최종 가공품별 (원가, 기타비용, 가공금액).
    원가 = 원소재에서 빠진 원가 + 이번 가공비 배부 (process_product_amounts),
    기타비용 = 원소재에서 빠진 기타비용을 중량 배부, 가공금액 = 원소재에서 넘어온 가공금액 배부 + 이번 가공비."""
    costs = process_product_amounts(consumed_cost, nodes)
    new_fees = process_product_amounts(ZERO, nodes)
    _parents, leaves_under = _leaves(nodes)
    leaves = leaves_under(None)
    weights = [leaf["weight"] for leaf in leaves]
    exps = dict(zip((leaf["id"] for leaf in leaves), allocate_by_weight(consumed_exp, weights)))
    prev_fees = dict(zip((leaf["id"] for leaf in leaves), allocate_by_weight(consumed_fee, weights)))
    return {key: (costs[key], exps[key], prev_fees[key] + new_fees[key]) for key in costs}
