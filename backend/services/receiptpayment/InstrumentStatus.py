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
#  유효 상태: 지급어음(지급·자수)의 빈 상태(예전 데이터) = 보관. 그 밖의 빈 상태는 빈값 그대로.
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
    open_sql = "(x.kind IN ('RECEIVABLE', 'PAYABLE') AND x.status = 'HELD')"

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
                       COALESCE(x.processdate, u.receiptdate) AS processdate, x.discountfee, x.processmemo, x.description,
                       (x.maturitydate - CURRENT_DATE) AS days_to_maturity,
                       u.receiptno AS used_receiptno, u.customname AS endorsee
                FROM ({inner}) x
                -- 배서: 넘겨준 지급 전표 (배서처 = 그 거래처, 처리일 = 그 지급 전표 일자)
                LEFT JOIN LATERAL (
                    SELECT p.receiptno, ph.customname, ph.receiptdate FROM ReceiptPayment02t p
                    JOIN ReceiptPayment01t ph ON ph.companyid = p.companyid AND ph.receiptno = p.receiptno
                    WHERE p.companyid = x.companyid AND p.source_receiptno = x.receiptno AND p.source_lineno = x.lineno LIMIT 1
                ) u ON TRUE
                WHERE {where_sql}
                ORDER BY x.maturitydate NULLS LAST, x.receiptdate, x.receiptno, x.lineno
                LIMIT %s OFFSET %s""",
            (*base_params, *params, page_size, (page - 1) * page_size),
        )
        items = [_row_dict(cursor, row) for row in cursor.fetchall()]

        # 요약 카드 · 카드 마우스 올림 · 만기 구간 (거래처·종류·검색어만 반영, 구분·상태·만기 조건과 무관한 현재 기준)
        #  속도: 증권 목록(inner)을 한 번만 읽고(MATERIALIZED), 배서 연결은 지급 행 묶음과 한 번에 붙인다 (행마다 찾지 않음).
        bucket_case = "CASE " + " ".join(f"WHEN {sql.replace('d.', 'x.')} THEN '{name}'" for name, sql in MATURITY_BUCKETS.items()) + " END"
        stats_cte = f"""
            WITH used AS (
                SELECT p.source_receiptno, p.source_lineno, MIN(p.receiptno) AS receiptno,
                       MIN(ph.customname) AS customname, MIN(ph.receiptdate) AS receiptdate
                FROM ReceiptPayment02t p
                JOIN ReceiptPayment01t ph ON ph.companyid = p.companyid AND ph.receiptno = p.receiptno
                WHERE p.companyid = %s AND COALESCE(p.source_receiptno, '') <> ''
                GROUP BY p.source_receiptno, p.source_lineno
            ),
            x AS MATERIALIZED (
                SELECT x.*, u.receiptno AS used_receiptno, u.customname AS payee, u.receiptdate AS used_date,
                       {open_sql} AS is_open,
                       CASE WHEN x.kind = 'PAYABLE' THEN 'OWN' WHEN x.kind = 'ENDORSED_OUT' THEN 'MANUAL'
                            WHEN x.kind = 'RECEIVABLE' AND u.receiptno IS NOT NULL THEN 'ENDORSED' END AS outkind
                FROM ({inner}) x
                LEFT JOIN used u ON u.source_receiptno = x.receiptno AND u.source_lineno = x.lineno
            )"""
        stats_params = (companyid, *base_params)
        cursor.execute(
            stats_cte + f"""
            SELECT x.kind, COALESCE(x.status, ''), x.outkind, CASE WHEN x.is_open THEN {bucket_case} END AS bucket,
                   COUNT(*), COALESCE(SUM(x.instrumentamt), 0)
            FROM x GROUP BY 1, 2, 3, 4""",
            stats_params,
        )
        groups = [{"kind": row[0], "status": row[1], "outkind": row[2], "bucket": row[3], "count": row[4], "amount": row[5]}
                  for row in cursor.fetchall()]

        # (이름 주의: 'total' 은 위 목록 건수 변수라 다른 이름을 쓴다)
        def sum_groups(rows):
            return {"count": sum(row["count"] for row in rows), "amount": sum((row["amount"] for row in rows), 0)}

        due = sum_groups([g for g in groups if g["bucket"] in ("overdue", "d0_30")])
        summary = {
            "held_receivable": sum_groups([g for g in groups if g["kind"] == "RECEIVABLE" and g["status"] == "HELD"]),
            "unpaid_payable": sum_groups([g for g in groups if g["kind"] == "PAYABLE" and g["status"] == "HELD"]),
            "due_30": {**due, "overdue_count": sum(g["count"] for g in groups if g["bucket"] == "overdue")},
            "dishonored": sum_groups([g for g in groups if g["status"] == "DISHONORED"]),
        }
        merged = {}
        for g in groups:
            key = (g["kind"], g["status"])
            merged.setdefault(key, {"kind": g["kind"], "status": g["status"], "count": 0, "amount": 0})
            merged[key]["count"] += g["count"]
            merged[key]["amount"] += g["amount"]
        summary["by_status"] = list(merged.values())
        # 채무 카드: 지급으로 나간 증권 = 발행 어음(자수) + 배서로 넘긴 받은 어음 + 지급에 직접 입력한 타수 (배서는 원래 수금 행으로 센다)
        out_merged = {}
        for g in groups:
            if not g["outkind"]:
                continue
            key = (g["outkind"], g["status"])
            out_merged.setdefault(key, {"outkind": g["outkind"], "status": g["status"], "count": 0, "amount": 0})
            out_merged[key]["count"] += g["count"]
            out_merged[key]["amount"] += g["amount"]
        summary["outgoing_by_status"] = list(out_merged.values())
        summary["outgoing_count"] = sum(row["count"] for row in summary["outgoing_by_status"])
        aging_merged = {}
        for g in groups:
            if not g["bucket"]:
                continue
            key = (g["kind"], g["bucket"])
            aging_merged.setdefault(key, {"kind": g["kind"], "bucket": g["bucket"], "count": 0, "amount": 0})
            aging_merged[key]["count"] += g["count"]
            aging_merged[key]["amount"] += g["amount"]
        aging = list(aging_merged.values())

        # 카드별 어음 목록 (최대 8장씩) — 한 번에
        cursor.execute(
            stats_cte + """,
            cards AS (
                SELECT 'held_receivable' AS card, x.*, ROW_NUMBER() OVER (ORDER BY x.maturitydate NULLS LAST, x.receiptno, x.lineno) AS rn
                FROM x WHERE x.kind = 'RECEIVABLE' AND x.status = 'HELD'
                UNION ALL
                SELECT 'unpaid_payable', x.*, ROW_NUMBER() OVER (ORDER BY x.maturitydate NULLS LAST, x.receiptno, x.lineno)
                FROM x WHERE x.kind = 'PAYABLE' AND x.status = 'HELD'
                UNION ALL
                SELECT 'due_30', x.*, ROW_NUMBER() OVER (ORDER BY x.maturitydate, x.receiptno, x.lineno)
                FROM x WHERE x.is_open AND x.maturitydate <= CURRENT_DATE + 30
                UNION ALL
                SELECT 'dishonored', x.*, ROW_NUMBER() OVER (ORDER BY x.processdate DESC NULLS LAST, x.receiptno, x.lineno)
                FROM x WHERE x.status = 'DISHONORED'
                UNION ALL
                SELECT 'outgoing', x.*, ROW_NUMBER() OVER (
                    ORDER BY CASE WHEN x.outkind = 'OWN' AND x.status = 'HELD' THEN 0 WHEN x.status = 'DISHONORED' THEN 1 ELSE 2 END,
                             x.maturitydate NULLS LAST, x.receiptno, x.lineno)
                FROM x WHERE x.outkind IS NOT NULL
            )
            SELECT card, receiptno, transactiontype, kind, outkind, status,
                   CASE WHEN card = 'outgoing' THEN COALESCE(payee, customname) ELSE customname END AS customname,
                   instrumenttype, instrumentno, instrumentamt, maturitydate,
                   COALESCE(processdate, used_date) AS processdate, processmemo, used_receiptno
            FROM cards WHERE rn <= 8 ORDER BY card, rn""",
            stats_params,
        )
        card_items = {}
        for row in cursor.fetchall():
            item = _row_dict(cursor, row)
            card_items.setdefault(item.pop("card"), []).append(item)
        for key in ("held_receivable", "unpaid_payable", "due_30", "dishonored"):
            summary[key]["items"] = card_items.get(key, [])
        summary["outgoing_items"] = card_items.get("outgoing", [])
    return {"items": items, "total": total, "total_amount": total_amount, "page": page, "page_size": page_size,
            "summary": summary, "aging": aging}
