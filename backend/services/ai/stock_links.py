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
