"""현재고가 AI 주문(주문서 관리 재고매칭)에 연결되어 있는지 알려 주는 SQL 조각.

출고등록 · 재고이전 · 가공등록에서 주문에 연결된 재고는 선택·저장할 수 없다
(주문서 관리에서 연결을 해제해야 사용 가능). 가공 최적화에서 확정한 계획(CONFIRMED)의 원자재도 같다.
가공완료(DONE)된 주문 품목의 연결은 끝난 것으로 보고 제외한다.
"""


def linked_orders_sql(alias: str) -> str:
    """`alias` = CurrentStock01t 의 별칭. 연결된 주문번호들을 ', ' 로 묶은 문자열 (없으면 NULL)."""
    return f"""(SELECT string_agg(DISTINCT ref, ', ' ORDER BY ref) FROM (
                SELECT link.orderid AS ref
                  FROM aiorder03t AS link
                  JOIN aiorder02t AS line
                    ON line.companyid = link.companyid AND line.orderid = link.orderid AND line.lineno = link.lineno
                 WHERE link.companyid = {alias}.companyid
                   AND link.stocksourcetype = {alias}.sourcetype
                   AND link.stocksourceno = {alias}.sourceno
                   AND link.stocksourceline = {alias}.sourceline
                   AND line.optimize_status <> 'DONE'
                UNION
                SELECT plan.planno
                  FROM aiplan01t AS plan
                 WHERE plan.companyid = {alias}.companyid AND plan.status = 'CONFIRMED' AND plan.rawkind = 'STOCK'
                   AND plan.stocksourcetype = {alias}.sourcetype
                   AND plan.stocksourceno = {alias}.sourceno
                   AND plan.stocksourceline = {alias}.sourceline) AS refs)"""


def plan_outstanding_sql(alias: str, exclude_sql: str = "''") -> str:
    """코일 확정 계획이 `alias` 현재고에 아직 잡아 둔 중량 (kg).

    계획마다 가공중량(inputweight) − 이미 가공등록한 투입중량. 일부가공 · 등분이면 원코일 전체가 아니라
    가공할 만큼만 잡히고, 남는 중량은 다른 계획이 쓸 수 있다. exclude_sql = 빼고 셀 계획번호 (SQL 식)."""
    return f"""(SELECT COALESCE(SUM(GREATEST(pl.inputweight - COALESCE((
                    SELECT SUM(d.weight) FROM process02t d
                      JOIN process01t h ON h.companyid = d.companyid AND h.processno = d.processno
                     WHERE h.companyid = pl.companyid AND h.planno = pl.planno AND d.linetype = 'SOURCE'
                       AND d.stocksourcetype = pl.stocksourcetype AND d.stocksourceno = pl.stocksourceno
                       AND d.stocksourceline = pl.stocksourceline), 0), 0)), 0)
                  FROM aiplan01t pl
                 WHERE pl.companyid = {alias}.companyid AND pl.status = 'CONFIRMED' AND pl.rawkind = 'STOCK'
                   AND pl.materialtype = 'COIL' AND pl.planno <> {exclude_sql}
                   AND pl.stocksourcetype = {alias}.sourcetype AND pl.stocksourceno = {alias}.sourceno
                   AND pl.stocksourceline = {alias}.sourceline)"""


def ensure_not_linked(cursor, companyid: str, keys, allowed=frozenset(), action: str = "사용") -> None:
    """keys = {(sourcetype, sourceno, sourceline)}. 주문에 연결된 재고가 있으면 ValueError.

    allowed = 수정 중인 전표에 이미 들어 있던 재고 (기존 전표는 그대로 수정할 수 있게).
    """
    targets = sorted({(str(t).strip().upper(), str(n).strip(), int(l)) for t, n, l in keys} - set(allowed))
    if not targets:
        return
    cursor.execute(
        """WITH target(t, n, l) AS (SELECT * FROM unnest(%s::varchar[], %s::varchar[], %s::integer[])),
                refs AS (
                  SELECT link.stocksourcetype AS t, link.stocksourceno AS n, link.stocksourceline AS l, link.orderid AS ref
                    FROM aiorder03t AS link
                    JOIN aiorder02t AS line
                      ON line.companyid = link.companyid AND line.orderid = link.orderid AND line.lineno = link.lineno
                   WHERE link.companyid = %s AND line.optimize_status <> 'DONE'
                  UNION
                  SELECT plan.stocksourcetype, plan.stocksourceno, plan.stocksourceline, plan.planno
                    FROM aiplan01t AS plan
                   WHERE plan.companyid = %s AND plan.status = 'CONFIRMED' AND plan.rawkind = 'STOCK')
           SELECT r.t, r.n, r.l, string_agg(DISTINCT r.ref, ', ' ORDER BY r.ref)
             FROM refs r JOIN target USING (t, n, l)
            GROUP BY 1, 2, 3
            ORDER BY 1, 2, 3""",
        ([k[0] for k in targets], [k[1] for k in targets], [k[2] for k in targets], companyid, companyid),
    )
    rows = cursor.fetchall()
    if rows:
        detail = " / ".join(f"{no}-{line} ({orders})" for _, no, line, orders in rows[:3])
        raise ValueError(f"주문 연결 또는 가공 계획에 잡힌 재고는 {action}할 수 없습니다: {detail}. "
                         f"주문서 관리에서 연결을 해제하거나 가공 최적화에서 계획을 취소한 뒤 {action}해 주세요.")


# ── 공유 재고 배분 ───────────────────────────────────────────────────────────
# 현재고 1건을 여러 주문 품목에 연결하면, 재고량을 연결된 품목들의 주문 중량 비율로 나눈다.
# (주문 중량이 없으면 수량, 둘 다 없으면 똑같이) · 반올림 차이는 큰 나머지 순으로 보정해 합계 = 재고량 (로스 없음)
from decimal import Decimal, ROUND_FLOOR  # noqa: E402


def _allocate(total, bases, step):
    """total 을 bases 비율로 step 단위로 나눈다. 합계는 total 과 정확히 같다."""
    total = Decimal(str(total or 0))
    step = Decimal(str(step))
    units = int((total / step).to_integral_value(rounding=ROUND_FLOOR))
    bases = [Decimal(str(b or 0)) for b in bases]
    if not bases:
        return []
    if sum(bases) <= 0:
        bases = [Decimal(1)] * len(bases)
    whole = sum(bases)
    raw = [units * b / whole for b in bases]
    floors = [int(r.to_integral_value(rounding=ROUND_FLOOR)) for r in raw]
    left = units - sum(floors)
    order = sorted(range(len(raw)), key=lambda i: (raw[i] - floors[i]), reverse=True)
    for i in order[:left]:
        floors[i] += 1
    shares = [Decimal(f) * step for f in floors]
    rest = total - sum(shares)   # step 보다 작은 자투리는 가장 큰 몫에 붙인다
    if rest:
        shares[order[0] if order else -1] += rest
    return [float(s) for s in shares]


def stock_shares(cursor, companyid: str, keys) -> dict:
    """keys = {(sourcetype, sourceno, sourceline)} → {키: {"count", "weight", "qty", "lines": {(orderid, lineno): {"weight", "qty", "ratio"}}}}

    가공완료(DONE) 품목의 연결은 끝난 것으로 보고 빼고 나눈다. 시트(길이 있음)는 매수를 정수로 나눈다.
    """
    targets = sorted({(str(t), str(n), int(l)) for t, n, l in keys})
    if not targets:
        return {}
    cursor.execute(
        """SELECT s.sourcetype, s.sourceno, s.sourceline, s.weight, s.qty, COALESCE(s.length, 0) AS length,
                  link.orderid, link.lineno, line.weight_kg, line.quantity
             FROM currentstock01t s
             JOIN aiorder03t link ON link.companyid = s.companyid AND link.stocksourcetype = s.sourcetype
                                 AND link.stocksourceno = s.sourceno AND link.stocksourceline = s.sourceline
             JOIN aiorder02t line ON line.companyid = link.companyid AND line.orderid = link.orderid AND line.lineno = link.lineno
            WHERE s.companyid = %s AND line.optimize_status <> 'DONE'
              AND (s.sourcetype, s.sourceno, s.sourceline) IN (SELECT * FROM unnest(%s::varchar[], %s::varchar[], %s::integer[]))
            ORDER BY s.sourcetype, s.sourceno, s.sourceline, link.orderid, link.lineno""",
        (companyid, [k[0] for k in targets], [k[1] for k in targets], [k[2] for k in targets]),
    )
    grouped: dict = {}
    for row in cursor.fetchall():
        get = (lambda name, i: row[name] if isinstance(row, dict) else row[i])
        key = (get("sourcetype", 0), get("sourceno", 1), int(get("sourceline", 2)))
        item = grouped.setdefault(key, {"weight": float(get("weight", 3) or 0), "qty": float(get("qty", 4) or 0),
                                        "sheet": float(get("length", 5) or 0) > 0, "lines": []})
        item["lines"].append(((get("orderid", 6), int(get("lineno", 7))), float(get("weight_kg", 8) or 0), float(get("quantity", 9) or 0)))
    result = {}
    for key, item in grouped.items():
        line_keys = [k for k, _, _ in item["lines"]]
        by_weight = [w for _, w, _ in item["lines"]]
        bases = by_weight if any(by_weight) else [q for _, _, q in item["lines"]]
        weights = _allocate(item["weight"], bases, "0.001")
        qtys = _allocate(item["qty"], bases, "1" if item["sheet"] else "0.001")
        whole = sum(bases) or len(bases)
        result[key] = {"count": len(line_keys), "weight": item["weight"], "qty": item["qty"], "lines": {
            k: {"weight": weights[i], "qty": qtys[i], "ratio": (bases[i] / whole) if sum(bases) else 1 / len(bases)}
            for i, k in enumerate(line_keys)}}
    return result


def allocate_coil_run(weight, raw_width, groups) -> dict:
    """코일 한 차수의 kg 정수 배부 (가공최적화 결과 표 · 재고가공등록 계획 불러오기가 같은 규칙을 쓴다).

    groups = [(폭, 칼수)].  ① 제품 합계 = 투입 × 사용폭 ÷ 원코일 폭 (반올림), 로스 = 투입 − 제품
    ② 폭별 몫 = 폭 × 칼수 비율 (정수, 남는 kg 는 끝수 큰 폭부터 1kg 씩), 로스도 폭별 제품 비율로
    ③ 같은 폭 안에서는 똑같이 나누고, 나누어 떨어지지 않는 kg 는 그 폭의 첫 줄에 몰아준다."""
    from decimal import ROUND_HALF_UP
    weight, raw = Decimal(str(weight)), Decimal(str(raw_width))
    groups = [(Decimal(str(w)), int(n)) for w, n in groups if int(n) > 0]
    used = sum(w * n for w, n in groups)
    produced = (weight * used / raw).quantize(Decimal("1"), rounding=ROUND_HALF_UP) if raw > 0 else Decimal("0")
    loss = weight - produced
    group_weights = _allocate(produced, [w * n for w, n in groups], "1")
    group_losses = _allocate(loss, group_weights, "1") if loss > 0 else [0.0] * len(groups)

    def spread(total, count):
        total = Decimal(str(total))
        each = (total / count).quantize(Decimal("1"), rounding=ROUND_FLOOR)
        return [float(total - each * (count - 1))] + [float(each)] * (count - 1)
    return {"weight": float(weight), "produced": float(produced), "loss": float(loss), "widths": [
        {"width": float(w), "cuts": n, "weight": g, "loss": l, "lines": spread(g, n), "losses": spread(l, n)}
        for (w, n), g, l in zip(groups, group_weights, group_losses)]}
