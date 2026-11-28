"""재고 예약 SQL 조각 (승인 통제).

매출 승인요청에 들어간 재고는 그 요청(approval_request01t)의 reservations(JSON)에 담긴다. 요청이 대기(PENDING) ·
처리 중(PROCESSING)일 때만 유효하고, 승인 · 반려 · 취소되면 비운다. 재고를 고르는 화면이 이 조각을 붙여 예약분을 빼고 보여 준다.
통제를 쓰지 않는 고객사는 예약이 없으므로 결과가 지금과 같다.
"""

_ACTIVE_SQL = "('PENDING', 'PROCESSING')"
_RECORD = "jsonb_to_recordset(q.reservations) AS r(sourcetype varchar, sourceno varchar, sourceline integer, qty numeric, weight numeric)"


def reserved_cte(companyid_param: str = "%s") -> str:
    """원천(sourcetype · sourceno · sourceline)별 예약 합계 CTE 본문. 이름은 reserved, 파라미터 하나(companyid)."""
    return f"""reserved AS (
        SELECT r.sourcetype, r.sourceno, r.sourceline,
               SUM(r.qty) AS qty, SUM(r.weight) AS weight,
               STRING_AGG(DISTINCT q.requestno || ' · ' || COALESCE((SELECT u.username FROM user01t u WHERE u.email = q.created_by LIMIT 1), q.created_by, ''), ', ') AS requests
        FROM approval_request01t q CROSS JOIN LATERAL {_RECORD}
        WHERE q.companyid = {companyid_param} AND q.status IN {_ACTIVE_SQL}
        GROUP BY r.sourcetype, r.sourceno, r.sourceline
    )"""


def not_reserved_sql(alias: str) -> str:
    """예약이 걸린 재고 행을 빼는 조건 (재고이동 · 재고가공 · 가공주문 · 가공최적화의 재고 선택)."""
    return f"""NOT EXISTS (
        SELECT 1 FROM approval_request01t q CROSS JOIN LATERAL {_RECORD}
        WHERE q.companyid = {alias}.companyid AND q.status IN {_ACTIVE_SQL}
          AND r.sourcetype = {alias}.sourcetype AND r.sourceno = {alias}.sourceno AND r.sourceline = {alias}.sourceline)"""


# 승인 실행 중인 요청 자신의 예약은 빼고 본다 (Approval.approve 가 같은 트랜잭션에 요청번호를 넣는다)
_NOT_RUNNING = "q.requestno IS DISTINCT FROM NULLIF(current_setting('mosco.approval_request', true), '')"


def reserved_by_others(cursor, companyid: str, keys) -> dict:
    """{(sourcetype, sourceno, sourceline): '요청번호, …'} — 다른(대기 중) 승인요청이 예약한 재고만."""
    keys = sorted({(str(t or "").strip().upper(), str(n or "").strip(), int(l or 0)) for t, n, l in keys})
    if not keys:
        return {}
    cursor.execute(
        f"""SELECT UPPER(r.sourcetype), r.sourceno, r.sourceline, STRING_AGG(DISTINCT q.requestno, ', ')
            FROM approval_request01t q CROSS JOIN LATERAL {_RECORD}
            JOIN unnest(%s::varchar[], %s::varchar[], %s::integer[]) AS k(t, n, l)
              ON UPPER(r.sourcetype) = k.t AND r.sourceno = k.n AND r.sourceline = k.l
            WHERE q.companyid = %s AND q.status IN {_ACTIVE_SQL} AND {_NOT_RUNNING}
            GROUP BY 1, 2, 3""",
        ([k[0] for k in keys], [k[1] for k in keys], [k[2] for k in keys], companyid),
    )
    return {(t, n, int(l)): requests for t, n, l, requests in cursor.fetchall()}


def ensure_not_reserved(cursor, companyid: str, demands: dict, own: dict | None = None):
    """매출 저장: 다른 승인요청에 예약된 재고(LOT)는 새로 쓸 수 없다.
    demands / own = {(sourcetype, sourceno, sourceline): (qty, weight)} — 수정 전표가 원래 쓰던 양(own)까지는 그대로 둘 수 있다."""
    own = own or {}
    taken = reserved_by_others(cursor, companyid, demands.keys())
    for key, requests in taken.items():
        qty, weight = demands.get(key, (0, 0))
        own_qty, own_weight = own.get(key, (0, 0))
        if float(qty) > float(own_qty) + 0.0005 or float(weight) > float(own_weight) + 0.0005:
            raise ValueError(f"재고 {key[1]} / 순번 {key[2]}은(는) 승인 대기 중인 요청({requests})에 예약되어 있어 선택할 수 없습니다.")
