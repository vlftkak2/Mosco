"""수표/어음 현황 (메뉴: INSTRUMENT_STATUS) - 어음·수표·외상매출채권을 현재 상태 기준으로 조회.
화면: frontend/src/pages/receiptpayment/InstrumentStatus.jsx, API: routes/receiptpayment/InstrumentStatus_routes.py
"""
from datetime import date

import db as _shared_db
from services.receiptpayment.ReceiptPayment import _EFFECTIVE_STATUS_SQL, INSTRUMENT_STATUS_FILTERS, _row_dict

_connect = _shared_db.connect

#  구분: 받을어음 = 수금·타수, 지급어음 = 지급·자수,
#        넘겨준 증권 = 지급·타수 직접 입력(시스템에 원본 없음), 돌아온 자수 = 수금·자수,
#        발행구분 미지정 = 발행구분이 빈값 (현황에서는 추정하지 않고 빈값 그대로 따로 보여 준다).
#  보유증권 불러오기로 넣은 지급 행은 원본 수금 행과 같은 증권이므로 제외한다 (원본 행의 '연결 전표'로 보인다).
#  유효 상태: 지급어음(지급·자수)의 빈 상태 = 미결제(UNPAID). 그 밖의 빈 상태는 빈값 그대로.
_INSTRUMENT_KIND_SQL = """CASE
    WHEN COALESCE(d.issuekind, '') = '' THEN 'UNSPECIFIED'
    WHEN h.transactiontype = 'RECEIPT' AND d.issuekind = 'OTHER' THEN 'RECEIVABLE'
    WHEN h.transactiontype = 'PAYMENT' AND d.issuekind = 'OWN' THEN 'PAYABLE'
    WHEN h.transactiontype = 'PAYMENT' THEN 'ENDORSED_OUT'
    ELSE 'RETURNED_OWN' END"""
INSTRUMENT_KINDS = ("RECEIVABLE", "PAYABLE", "ENDORSED_OUT", "RETURNED_OWN", "UNSPECIFIED")
MATURITY_BUCKETS = {  # 만기 구간 (오늘 기준)
    "overdue": "d.maturitydate < CURRENT_DATE",
    "d0_30": "d.maturitydate BETWEEN CURRENT_DATE AND CURRENT_DATE + 30",
    "d31_60": "d.maturitydate BETWEEN CURRENT_DATE + 31 AND CURRENT_DATE + 60",
    "d61_90": "d.maturitydate BETWEEN CURRENT_DATE + 61 AND CURRENT_DATE + 90",
    "d91": "d.maturitydate > CURRENT_DATE + 90",
    "none": "d.maturitydate IS NULL",
}


def list_instruments(companyid: str, page: int = 1, page_size: int = 50, kind: str = "", status: str = "OPEN",
                     bucket: str = "", maturity_from: date | None = None, maturity_to: date | None = None,
                     customer: str = "", instrumenttype: str = "", keyword: str = ""):
    base = ["d.companyid = %s", "d.instrumentamt > 0",
            "NOT (h.transactiontype = 'PAYMENT' AND d.source_receiptno IS NOT NULL)"]
    base_params: list = [companyid]
    # customer / type / keyword also narrow the summary cards and the maturity chart
    if customer.strip():
        base.append("(h.customcode ILIKE %s OR h.customname ILIKE %s)"); base_params += [f"%{customer.strip()}%"] * 2
    if instrumenttype.strip():
        base.append("d.instrumenttype = %s"); base_params.append(instrumenttype.strip().upper())
    if keyword.strip():
        base.append("(d.instrumentno ILIKE %s OR d.issuercompany ILIKE %s OR d.issuer ILIKE %s OR d.receiptno ILIKE %s)")
        base_params += [f"%{keyword.strip()}%"] * 4
    inner = f"""SELECT d.*, h.receiptdate, h.transactiontype, h.customcode, h.customname,
                       {_INSTRUMENT_KIND_SQL} AS kind, {_EFFECTIVE_STATUS_SQL} AS status
                FROM ReceiptPayment02t d
                JOIN ReceiptPayment01t h ON h.companyid = d.companyid AND h.receiptno = d.receiptno
                WHERE {" AND ".join(base)}"""
    open_sql = "((x.kind = 'RECEIVABLE' AND x.status = 'HELD') OR (x.kind = 'PAYABLE' AND x.status = 'UNPAID'))"

    where = ["TRUE"]; params: list = []
    if kind in INSTRUMENT_KINDS:
        where.append("x.kind = %s"); params.append(kind)
    if status == "OPEN":
        where.append(open_sql)
    elif status in INSTRUMENT_STATUS_FILTERS:
        where.append("x.status = %s"); params.append(status)
    if bucket in MATURITY_BUCKETS:
        where.append(MATURITY_BUCKETS[bucket].replace("d.", "x."))
    if maturity_from:
        where.append("x.maturitydate >= %s"); params.append(maturity_from)
    if maturity_to:
        where.append("x.maturitydate <= %s"); params.append(maturity_to)
    where_sql = " AND ".join(where)

    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(f"SELECT COUNT(*), COALESCE(SUM(x.instrumentamt), 0) FROM ({inner}) x WHERE {where_sql}",
                       (*base_params, *params))
        total, total_amount = cursor.fetchone()
        cursor.execute(
            f"""SELECT x.receiptno, x.lineno, x.receiptdate, x.transactiontype, x.customcode, x.customname,
                       x.kind, x.status, x.instrumenttype, x.instrumentno, x.instrumentamt, x.issuedate,
                       x.issuercompany, x.issuer, x.issuekind, x.maturitydate, x.custodyaccount, x.custodybank,
                       x.processdate, x.discountfee, x.processmemo, x.description,
                       (x.maturitydate - CURRENT_DATE) AS days_to_maturity,
                       (SELECT p.receiptno FROM ReceiptPayment02t p WHERE p.companyid = x.companyid
                         AND p.source_receiptno = x.receiptno AND p.source_lineno = x.lineno LIMIT 1) AS used_receiptno
                FROM ({inner}) x WHERE {where_sql}
                ORDER BY x.maturitydate NULLS LAST, x.receiptdate, x.receiptno, x.lineno
                LIMIT %s OFFSET %s""",
            (*base_params, *params, page_size, (page - 1) * page_size),
        )
        items = [_row_dict(cursor, row) for row in cursor.fetchall()]

        # 요약 카드 (거래처·종류·검색어만 반영, 구분·상태·만기 조건과 무관한 현재 기준)
        cursor.execute(
            f"""SELECT
                  COUNT(*) FILTER (WHERE x.kind = 'RECEIVABLE' AND x.status = 'HELD'),
                  COALESCE(SUM(x.instrumentamt) FILTER (WHERE x.kind = 'RECEIVABLE' AND x.status = 'HELD'), 0),
                  COUNT(*) FILTER (WHERE x.kind = 'PAYABLE' AND x.status = 'UNPAID'),
                  COALESCE(SUM(x.instrumentamt) FILTER (WHERE x.kind = 'PAYABLE' AND x.status = 'UNPAID'), 0),
                  COUNT(*) FILTER (WHERE {open_sql} AND x.maturitydate <= CURRENT_DATE + 30),
                  COALESCE(SUM(x.instrumentamt) FILTER (WHERE {open_sql} AND x.maturitydate <= CURRENT_DATE + 30), 0),
                  COUNT(*) FILTER (WHERE {open_sql} AND x.maturitydate < CURRENT_DATE),
                  COUNT(*) FILTER (WHERE x.status = 'DISHONORED'),
                  COALESCE(SUM(x.instrumentamt) FILTER (WHERE x.status = 'DISHONORED'), 0)
                FROM ({inner}) x""",
            base_params,
        )
        r = cursor.fetchone()
        summary = {
            "held_receivable": {"count": r[0], "amount": r[1]},
            "unpaid_payable": {"count": r[2], "amount": r[3]},
            "due_30": {"count": r[4], "amount": r[5], "overdue_count": r[6]},
            "dishonored": {"count": r[7], "amount": r[8]},
        }
        # 만기 구간 (진행 중인 받을어음·지급어음)
        bucket_case = "CASE " + " ".join(f"WHEN {sql.replace('d.', 'x.')} THEN '{name}'" for name, sql in MATURITY_BUCKETS.items()) + " END"
        cursor.execute(
            f"""SELECT x.kind, {bucket_case} AS bucket, COUNT(*), COALESCE(SUM(x.instrumentamt), 0)
                FROM ({inner}) x WHERE {open_sql} GROUP BY 1, 2""",
            base_params,
        )
        aging = [{"kind": row[0], "bucket": row[1], "count": row[2], "amount": row[3]} for row in cursor.fetchall()]
    return {"items": items, "total": total, "total_amount": total_amount, "page": page, "page_size": page_size,
            "summary": summary, "aging": aging}
