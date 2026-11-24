"""재고 예약 SQL 조각 (승인 통제).

매출 승인요청에 들어간 재고는 stock_reservation01t 에 예약된다. 요청이 대기(PENDING) · 처리 중(PROCESSING)일 때만
유효하고, 승인 · 반려 · 취소되면 지운다. 재고를 고르는 화면이 이 조각을 붙여 예약분을 빼고 보여 준다.
통제를 쓰지 않는 고객사는 예약이 없으므로 결과가 지금과 같다.
"""

ACTIVE_STATUSES = ("PENDING", "PROCESSING")
_ACTIVE_SQL = "('PENDING', 'PROCESSING')"


def reserved_cte(companyid_param: str = "%s") -> str:
    """원천(sourcetype · sourceno · sourceline)별 예약 합계 CTE 본문. 이름은 reserved, 파라미터 하나(companyid)."""
    return f"""reserved AS (
        SELECT r.sourcetype, r.sourceno, r.sourceline,
               SUM(r.qty) AS qty, SUM(r.weight) AS weight,
               STRING_AGG(DISTINCT r.requestno || ' · ' || COALESCE((SELECT u.username FROM user01t u WHERE u.email = q.created_by LIMIT 1), q.created_by, ''), ', ') AS requests
        FROM stock_reservation01t r
        JOIN approval_request01t q ON q.companyid = r.companyid AND q.requestno = r.requestno
        WHERE r.companyid = {companyid_param} AND q.status IN {_ACTIVE_SQL}
        GROUP BY r.sourcetype, r.sourceno, r.sourceline
    )"""


def not_reserved_sql(alias: str) -> str:
    """예약이 걸린 재고 행을 빼는 조건 (재고이동 · 재고가공 · 가공주문 · 가공최적화의 재고 선택)."""
    return f"""NOT EXISTS (
        SELECT 1 FROM stock_reservation01t r
        JOIN approval_request01t q ON q.companyid = r.companyid AND q.requestno = r.requestno
        WHERE r.companyid = {alias}.companyid AND r.sourcetype = {alias}.sourcetype
          AND r.sourceno = {alias}.sourceno AND r.sourceline = {alias}.sourceline
          AND q.status IN {_ACTIVE_SQL})"""
