from contextlib import contextmanager
from datetime import date
from decimal import Decimal

import db as _shared_db
from pydantic import BaseModel, Field, field_validator, model_validator

from config import DB_CONFIG


# Connections come from the single shared pool (backend/db.py).
_connect = _shared_db.connect

# 수표/어음 고정 선택값: DB에는 코드, 화면에는 이름. (frontend src/utils/instrumentCodes.js 와 같은 목록)
# 발행구분·어음처리상태 코드는 업무 로직(보유어음 불러오기·배서)이 판단에 사용하므로 바꾸지 않는다.
INSTRUMENT_OPTIONS = {
    "instrumenttype": {"RECEIVABLE": "외상매출채권", "ELECTRONIC": "전자어음", "PROMISSORY": "약속어음", "CURRENT_CHECK": "당좌수표",
                       "HOUSEHOLD_CHECK": "가계수표", "CASHIER_CHECK": "자기앞수표", "OTHER": "기타"},
    "issuekind": {"OWN": "자수", "OTHER": "타수"},
    "instrumentstatus": {"HELD": "보관", "ENDORSED": "배서", "DISCOUNTED": "할인", "SETTLED": "결제", "DISHONORED": "부도"},
}
INSTRUMENT_FIELD_LABELS = {"instrumenttype": "수표/어음 종류", "issuekind": "발행구분", "instrumentstatus": "어음처리상태"}


class ReceiptPaymentDetailInput(BaseModel):
    cashamt: Decimal = Field(default=Decimal("0"), ge=0, max_digits=15, decimal_places=3)
    instrumentamt: Decimal = Field(default=Decimal("0"), ge=0, max_digits=15, decimal_places=3)
    instrumenttype: str = Field(default="", max_length=20)
    instrumentno: str = Field(default="", max_length=100)
    issuedate: date | None = None
    issuercompany: str = Field(default="", max_length=150)
    issuer: str = Field(default="", max_length=100)
    issuekind: str = Field(default="", max_length=20)
    maturitydate: date | None = None
    custodyaccount: str = Field(default="", max_length=100)
    custodybank: str = Field(default="", max_length=100)
    instrumentstatus: str = Field(default="", max_length=30)
    bankamt: Decimal = Field(default=Decimal("0"), ge=0, max_digits=15, decimal_places=3)
    cardamt: Decimal = Field(default=Decimal("0"), ge=0, max_digits=15, decimal_places=3)
    offsetamt: Decimal = Field(default=Decimal("0"), ge=0, max_digits=15, decimal_places=3)
    lossamt: Decimal = Field(default=Decimal("0"), ge=0, max_digits=15, decimal_places=3)
    chargeamt: Decimal = Field(default=Decimal("0"), ge=0, max_digits=15, decimal_places=3)
    description: str = Field(default="", max_length=500)
    # 보유증권 불러오기: 지급 행이 사용한 수금 증권(전표번호·순번)
    source_receiptno: str = Field(default="", max_length=30)
    source_lineno: int | None = Field(default=None, gt=0)

    @field_validator(
        "instrumenttype", "instrumentno", "issuercompany", "issuer", "issuekind",
        "custodyaccount", "custodybank", "instrumentstatus", "description", "source_receiptno",
    )
    @classmethod
    def strip_detail_text(cls, value: str) -> str:
        return value.strip()

    @field_validator("instrumenttype", "issuekind", "instrumentstatus")
    @classmethod
    def validate_fixed_code(cls, value: str, info) -> str:
        # Fixed lists: store the code. A Korean label (e.g. from an Excel upload) is accepted and converted.
        if not value:
            return value
        options = INSTRUMENT_OPTIONS[info.field_name]
        if value.upper() in options:
            return value.upper()
        by_label = {label: code for code, label in options.items()}
        if value in by_label:
            return by_label[value]
        raise ValueError(f"{INSTRUMENT_FIELD_LABELS[info.field_name]} 값을 목록에서 선택해 주세요: {value}")


class ReceiptPaymentSaveRequest(BaseModel):
    receiptno: str = Field(default="", max_length=100)
    receiptdate: date
    transactiontype: str = Field(min_length=1, max_length=10)
    customcode: str = Field(min_length=1, max_length=100)
    customname: str = Field(min_length=1, max_length=150)
    manager: str = Field(default="", max_length=100)
    description: str = Field(default="", max_length=500)
    items: list[ReceiptPaymentDetailInput] = Field(min_length=1, max_length=1000)

    @field_validator("receiptno", "transactiontype", "customcode", "customname", "manager", "description")
    @classmethod
    def strip_text(cls, value: str) -> str:
        return value.strip()

    @field_validator("transactiontype")
    @classmethod
    def validate_transaction_type(cls, value: str) -> str:
        normalized = value.upper()
        if normalized not in {"RECEIPT", "PAYMENT"}:
            raise ValueError("수금/지급 구분은 RECEIPT 또는 PAYMENT여야 합니다.")
        return normalized

    @model_validator(mode="after")
    def require_detail_amount(self):
        amount_fields = ("cashamt", "instrumentamt", "bankamt", "cardamt", "offsetamt", "lossamt", "chargeamt")
        for lineno, item in enumerate(self.items, start=1):
            if not any(getattr(item, field) > 0 for field in amount_fields):
                raise ValueError(f"{lineno}행에 금액이 없습니다. 금액을 입력하거나 빈 행을 삭제해 주세요.")
            # 종류를 골랐다면 증권이므로 금액은 '수표/어음' 칸에 있어야 한다 (현금 수금은 종류를 비운다).
            if item.instrumenttype and item.instrumentamt <= 0:
                raise ValueError(f"{lineno}행: 수표/어음 종류를 선택했으면 금액은 '수표/어음' 칸에 입력해 주세요. "
                                 "현금으로 받았다면 종류를 비워 주세요.")
        return self


def _row_dict(cursor, row):
    return dict(zip((column[0] for column in cursor.description), row))


def _where_conditions(companyid: str, date_from: date | None, date_to: date | None,
                      receiptno: str, customer: str, transactiontype: str):
    where = ["h.companyid = %s"]
    params: list = [companyid]
    if date_from:
        where.append("h.receiptdate >= %s")
        params.append(date_from)
    if date_to:
        where.append("h.receiptdate <= %s")
        params.append(date_to)
    if receiptno.strip():
        where.append("h.receiptno ILIKE %s")
        params.append(f"%{receiptno.strip()}%")
    if customer.strip():
        pattern = f"%{customer.strip()}%"
        where.append("(h.customcode ILIKE %s OR h.customname ILIKE %s)")
        params.extend((pattern, pattern))
    if transactiontype in {"RECEIPT", "PAYMENT"}:
        where.append("h.transactiontype = %s")
        params.append(transactiontype)
    return " AND ".join(where), params


def list_documents(companyid: str, page: int, page_size: int, date_from: date | None = None,
                   date_to: date | None = None, receiptno: str = "", customer: str = "",
                   transactiontype: str = ""):
    where_sql, params = _where_conditions(companyid, date_from, date_to, receiptno, customer, transactiontype)
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(f"SELECT COUNT(*) FROM ReceiptPayment01t AS h WHERE {where_sql}", params)
        total = cursor.fetchone()[0]
        cursor.execute(
            f"""
            SELECT COUNT(*)::integer AS document_count,
                   COALESCE(SUM(d.line_count), 0)::integer AS detail_count,
                   COALESCE(SUM(CASE WHEN h.transactiontype = 'RECEIPT' THEN d.totalamt ELSE 0 END), 0)::numeric(18, 3) AS receipt_total,
                   COALESCE(SUM(CASE WHEN h.transactiontype = 'PAYMENT' THEN d.totalamt ELSE 0 END), 0)::numeric(18, 3) AS payment_total,
                   COALESCE(SUM(d.totalamt), 0)::numeric(18, 3) AS total_amount
            FROM ReceiptPayment01t AS h
            LEFT JOIN LATERAL (
                SELECT COUNT(*) AS line_count, COALESCE(SUM(totalamt), 0) AS totalamt
                FROM ReceiptPayment02t AS d
                WHERE d.companyid = h.companyid AND d.receiptno = h.receiptno
            ) AS d ON TRUE
            WHERE {where_sql}
            """,
            params,
        )
        summary = _row_dict(cursor, cursor.fetchone())
        cursor.execute(
            f"""
            SELECT h.receiptno, h.receiptdate, h.transactiontype, h.customcode, h.customname,
                   h.manager, h.description, h.created_at, h.updated_at,
                   COALESCE((SELECT u.username FROM user01t u WHERE u.email = h.created_by LIMIT 1), h.created_by) AS created_by,
                   COALESCE((SELECT u.username FROM user01t u WHERE u.email = h.updated_by LIMIT 1), h.updated_by) AS updated_by,
                   COALESCE(d.line_count, 0)::integer AS line_count,
                   COALESCE(d.cashamt, 0)::numeric(15, 3) AS cashamt,
                   COALESCE(d.instrumentamt, 0)::numeric(15, 3) AS instrumentamt,
                   COALESCE(d.bankamt, 0)::numeric(15, 3) AS bankamt,
                   COALESCE(d.cardamt, 0)::numeric(15, 3) AS cardamt,
                   COALESCE(d.offsetamt, 0)::numeric(15, 3) AS offsetamt,
                   COALESCE(d.lossamt, 0)::numeric(15, 3) AS lossamt,
                   COALESCE(d.chargeamt, 0)::numeric(15, 3) AS chargeamt,
                   COALESCE(d.totalamt, 0)::numeric(15, 3) AS totalamt
            FROM ReceiptPayment01t AS h
            LEFT JOIN LATERAL (
                SELECT COUNT(*) AS line_count,
                       SUM(cashamt) AS cashamt, SUM(instrumentamt) AS instrumentamt,
                       SUM(bankamt) AS bankamt, SUM(cardamt) AS cardamt,
                       SUM(offsetamt) AS offsetamt, SUM(lossamt) AS lossamt,
                       SUM(chargeamt) AS chargeamt, SUM(totalamt) AS totalamt
                FROM ReceiptPayment02t AS d
                WHERE d.companyid = h.companyid AND d.receiptno = h.receiptno
            ) AS d ON TRUE
            WHERE {where_sql}
            ORDER BY h.receiptdate DESC, h.receiptno DESC
            LIMIT %s OFFSET %s
            """,
            (*params, page_size, (page - 1) * page_size),
        )
        documents = [_row_dict(cursor, row) for row in cursor.fetchall()]
    return {"documents": documents, "total": total, "page": page, "page_size": page_size, "summary": summary}


def list_detail_rows(companyid: str, page: int, page_size: int, date_from: date | None = None,
                     date_to: date | None = None, receiptno: str = "", customer: str = "",
                     transactiontype: str = "", instrumentstatus: str = "", instrumenttype: str = "",
                     issuekind: str = ""):
    """Return one row per payment detail, joined with its header for the status grid."""
    where_sql, params = _where_conditions(companyid, date_from, date_to, receiptno, customer, transactiontype)
    if instrumentstatus in INSTRUMENT_STATUS_FILTERS and instrumentstatus != "OPEN":
        where_sql += f" AND ({_EFFECTIVE_STATUS_SQL}) = %s"; params.append(instrumentstatus)
    if instrumenttype.strip():
        where_sql += " AND d.instrumenttype = %s"; params.append(instrumenttype.strip().upper())
    if issuekind in ("OWN", "OTHER"):
        where_sql += " AND d.issuekind = %s"; params.append(issuekind)
    elif issuekind == "NONE":  # 증권인데 발행구분이 빈값
        where_sql += " AND d.instrumentamt > 0 AND COALESCE(d.issuekind, '') = ''"
    join_sql = """
        FROM ReceiptPayment01t AS h
        LEFT JOIN ReceiptPayment02t AS d
          ON d.companyid = h.companyid AND d.receiptno = h.receiptno
    """
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(f"SELECT COUNT(*) {join_sql} WHERE {where_sql}", params)
        total = cursor.fetchone()[0]
        cursor.execute(
            f"""
            SELECT COUNT(DISTINCT h.receiptno)::integer AS receipt_count,
                   COUNT(d.lineno)::integer AS detail_count,
                   COALESCE(SUM(CASE WHEN h.transactiontype = 'RECEIPT' THEN d.totalamt ELSE 0 END), 0)::numeric(18, 3) AS receipt_total,
                   COALESCE(SUM(CASE WHEN h.transactiontype = 'PAYMENT' THEN d.totalamt ELSE 0 END), 0)::numeric(18, 3) AS payment_total
            {join_sql}
            WHERE {where_sql}
            """,
            params,
        )
        summary = _row_dict(cursor, cursor.fetchone())
        cursor.execute(
            f"""
            SELECT h.receiptdate, h.transactiontype, h.receiptno, h.customcode, h.customname,
                   h.manager, h.description AS header_description,
                   h.created_at AS header_created_at, h.updated_at AS header_updated_at,
                   d.lineno, d.cashamt, d.instrumenttype, d.instrumentno, d.instrumentamt,
                   d.issuedate, d.issuercompany, d.issuer, d.issuekind, d.maturitydate,
                   d.custodyaccount, d.custodybank, d.instrumentstatus,
                   d.processdate, d.discountfee, d.processmemo, d.source_receiptno,
                   COALESCE(d.source_receiptno, {_USED_RECEIPTNO_SQL}) AS linked_receiptno,
                   d.bankamt, d.cardamt, d.offsetamt, d.lossamt, d.chargeamt, d.totalamt,
                   d.description AS detail_description,
                   d.created_at, COALESCE(d.updated_at, h.updated_at) AS updated_at,
                   COALESCE((SELECT u.username FROM user01t u WHERE u.email = COALESCE(d.created_by, h.created_by) LIMIT 1), COALESCE(d.created_by, h.created_by)) AS created_by,
                   COALESCE((SELECT u.username FROM user01t u WHERE u.email = COALESCE(d.updated_by, h.updated_by) LIMIT 1), COALESCE(d.updated_by, h.updated_by)) AS updated_by
            {join_sql}
            WHERE {where_sql}
            ORDER BY h.receiptdate DESC, h.receiptno DESC, d.lineno NULLS FIRST
            LIMIT %s OFFSET %s
            """,
            (*params, page_size, (page - 1) * page_size),
        )
        items = [_row_dict(cursor, row) for row in cursor.fetchall()]
    return {"items": items, "total": total, "page": page, "page_size": page_size, "summary": summary}


def get_document(companyid: str, receiptno: str):
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """SELECT companyid, companyname, receiptno, receiptdate, transactiontype,
                      customcode, customname, manager, description, created_at, updated_at,
                      COALESCE((SELECT u.username FROM user01t u WHERE u.email = ReceiptPayment01t.created_by LIMIT 1), ReceiptPayment01t.created_by) AS created_by,
                      COALESCE((SELECT u.username FROM user01t u WHERE u.email = ReceiptPayment01t.updated_by LIMIT 1), ReceiptPayment01t.updated_by) AS updated_by
               FROM ReceiptPayment01t WHERE companyid = %s AND receiptno = %s""",
            (companyid, receiptno),
        )
        row = cursor.fetchone()
        if not row:
            return None
        document = _row_dict(cursor, row)
        cursor.execute(
            """SELECT companyid, companyname, receiptno, lineno, cashamt, instrumentamt,
                      instrumenttype, instrumentno, issuedate, issuercompany, issuer, issuekind,
                      maturitydate, custodyaccount, custodybank, instrumentstatus,
                      bankamt, cardamt, offsetamt, lossamt, chargeamt, totalamt,
                      description, created_at, updated_at, source_receiptno, source_lineno,
                      processdate, discountfee, processmemo,
                      (SELECT p.receiptno FROM ReceiptPayment02t p
                        WHERE p.companyid = ReceiptPayment02t.companyid AND p.source_receiptno = ReceiptPayment02t.receiptno
                          AND p.source_lineno = ReceiptPayment02t.lineno LIMIT 1) AS used_receiptno,
                      COALESCE((SELECT u.username FROM user01t u WHERE u.email = ReceiptPayment02t.created_by LIMIT 1), ReceiptPayment02t.created_by) AS created_by,
                      COALESCE((SELECT u.username FROM user01t u WHERE u.email = ReceiptPayment02t.updated_by LIMIT 1), ReceiptPayment02t.updated_by) AS updated_by
               FROM ReceiptPayment02t
               WHERE companyid = %s AND receiptno = %s
               ORDER BY lineno""",
            (companyid, receiptno),
        )
        document["items"] = [_row_dict(cursor, detail) for detail in cursor.fetchall()]
    return document


# 보유증권: 수금으로 받은 타수 증권(어음·수표·외상매출채권) 중 아직 '보관'이고 어떤 지급에도 쓰이지 않은 것.
# 예전에 처리상태 없이 저장된 수금 증권은 보관으로 본다.
_HELD_CONDITION = """h.transactiontype = 'RECEIPT' AND d.instrumentamt > 0
    AND COALESCE(NULLIF(d.issuekind, ''), 'OTHER') = 'OTHER'
    AND COALESCE(NULLIF(d.instrumentstatus, ''), 'HELD') = 'HELD'"""


def list_held_instruments(companyid: str, page: int = 1, page_size: int = 50, maturity_from: date | None = None,
                          maturity_to: date | None = None, customer: str = "", keyword: str = "", instrumenttype: str = ""):
    where = ["d.companyid = %s", _HELD_CONDITION,
             """NOT EXISTS (SELECT 1 FROM ReceiptPayment02t p WHERE p.companyid = d.companyid
                    AND p.source_receiptno = d.receiptno AND p.source_lineno = d.lineno)"""]
    params: list = [companyid]
    if maturity_from:
        where.append("d.maturitydate >= %s"); params.append(maturity_from)
    if maturity_to:
        where.append("d.maturitydate <= %s"); params.append(maturity_to)
    if customer.strip():
        where.append("(h.customname ILIKE %s OR h.customcode ILIKE %s)"); params += [f"%{customer.strip()}%"] * 2
    if keyword.strip():
        where.append("(d.instrumentno ILIKE %s OR d.issuercompany ILIKE %s OR d.issuer ILIKE %s)"); params += [f"%{keyword.strip()}%"] * 3
    if instrumenttype.strip():
        where.append("d.instrumenttype = %s"); params.append(instrumenttype.strip().upper())
    where_sql = " AND ".join(where)
    join_sql = "FROM ReceiptPayment02t d JOIN ReceiptPayment01t h ON h.companyid = d.companyid AND h.receiptno = d.receiptno"
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(f"SELECT COUNT(*), COALESCE(SUM(d.instrumentamt), 0) {join_sql} WHERE {where_sql}", params)
        total, total_amount = cursor.fetchone()
        cursor.execute(
            f"""SELECT d.receiptno, d.lineno, h.receiptdate, h.customcode, h.customname,
                       d.instrumenttype, d.instrumentno, d.instrumentamt, d.issuedate, d.issuercompany, d.issuer,
                       d.maturitydate, d.custodyaccount, d.custodybank, d.description
                {join_sql} WHERE {where_sql}
                ORDER BY d.maturitydate NULLS LAST, h.receiptdate, d.receiptno, d.lineno
                LIMIT %s OFFSET %s""",
            (*params, page_size, (page - 1) * page_size),
        )
        items = [_row_dict(cursor, row) for row in cursor.fetchall()]
    return {"items": items, "total": total, "total_amount": total_amount, "page": page, "page_size": page_size}


def _restore_used_instruments(cursor, companyid: str, receiptno: str, actor: str | None):
    """Give back (to '보관') every receipt instrument used by this payment document's lines."""
    cursor.execute(
        """UPDATE ReceiptPayment02t r
           SET instrumentstatus = 'HELD', updated_at = CURRENT_TIMESTAMP, updated_by = COALESCE(%s, r.updated_by)
           FROM ReceiptPayment02t p
           WHERE p.companyid = %s AND p.receiptno = %s AND p.source_receiptno IS NOT NULL
             AND r.companyid = p.companyid AND r.receiptno = p.source_receiptno AND r.lineno = p.source_lineno""",
        (actor or None, companyid, receiptno),
    )


def _block_if_instruments_used(cursor, companyid: str, receiptno: str, action: str):
    """A receipt document whose instruments were used by a payment cannot be changed or deleted."""
    cursor.execute(
        """SELECT DISTINCT receiptno FROM ReceiptPayment02t
           WHERE companyid = %s AND source_receiptno = %s AND receiptno <> %s ORDER BY receiptno LIMIT 5""",
        (companyid, receiptno, receiptno),
    )
    used_by = [row[0] for row in cursor.fetchall()]
    if used_by:
        raise ValueError(f"이 전표의 증권이 지급에 사용되어 {action}할 수 없습니다. (지급전표 {', '.join(used_by)}) "
                         "먼저 해당 지급전표를 삭제해 주세요.")
    cursor.execute(
        """SELECT lineno, source_receiptno FROM ReceiptPayment02t
           WHERE companyid = %s AND receiptno = %s AND processdate IS NOT NULL ORDER BY lineno""",
        (companyid, receiptno),
    )
    processed = cursor.fetchall()
    if processed:
        sources = sorted({row[1] for row in processed if row[1]})
        where = f"원본 수금 전표({', '.join(sources)})에서 " if sources else ""
        raise ValueError(f"결제·할인·부도 처리된 증권이 있어 {action}할 수 없습니다. "
                         f"({', '.join(str(row[0]) for row in processed)}행) 먼저 {where}처리취소를 해 주세요.")


def _apply_source_instruments(cursor, companyid: str, receiptno: str, transactiontype: str, items: list[dict]):
    """Lock the receipt instruments chosen with 보유증권 불러오기, verify they are still held and
    copy their details into the payment lines (the server copy is authoritative)."""
    keys = [(item["source_receiptno"], item["source_lineno"]) for item in items if item.get("source_receiptno")]
    if not keys:
        return []
    if transactiontype != "PAYMENT":
        raise ValueError("보유증권은 지급 전표에서만 사용할 수 있습니다.")
    if any(not lineno for _, lineno in keys) or len(keys) != len(set(keys)):
        raise ValueError("같은 증권을 한 전표에 두 번 사용할 수 없습니다.")
    cursor.execute(
        f"""SELECT d.receiptno, d.lineno, d.instrumenttype, d.instrumentno, d.instrumentamt, d.issuedate,
                   d.issuercompany, d.issuer, d.maturitydate, d.custodyaccount, d.custodybank,
                   ({_HELD_CONDITION}) AS held,
                   (SELECT p.receiptno FROM ReceiptPayment02t p WHERE p.companyid = d.companyid
                     AND p.source_receiptno = d.receiptno AND p.source_lineno = d.lineno
                     AND p.receiptno <> %s LIMIT 1) AS used_by
            FROM ReceiptPayment02t d
            JOIN ReceiptPayment01t h ON h.companyid = d.companyid AND h.receiptno = d.receiptno
            WHERE d.companyid = %s AND (d.receiptno, d.lineno) IN (SELECT * FROM unnest(%s::varchar[], %s::integer[]))
            ORDER BY d.receiptno, d.lineno
            FOR UPDATE OF d""",
        (receiptno, companyid, [k[0] for k in keys], [k[1] for k in keys]),
    )
    sources = {(row[0], row[1]): row for row in cursor.fetchall()}
    for index, item in enumerate(items, start=1):
        if not item.get("source_receiptno"):
            continue
        source = sources.get((item["source_receiptno"], item["source_lineno"]))
        label = f"{index}행 증권({item['source_receiptno']}-{item['source_lineno']})"
        if not source:
            raise ValueError(f"{label}을 찾을 수 없습니다. 보유증권을 다시 불러와 주세요.")
        if source[12]:
            raise ValueError(f"{label}은 이미 다른 지급(지급전표 {source[12]})에 사용되었습니다. 보유증권을 다시 불러와 주세요.")
        if not source[11]:
            raise ValueError(f"{label}은 보관 중인 증권이 아닙니다(배서·할인·결제·부도 등). 보유증권을 다시 불러와 주세요.")
        (_, _, item["instrumenttype"], item["instrumentno"], item["instrumentamt"], item["issuedate"],
         item["issuercompany"], item["issuer"], item["maturitydate"], item["custodyaccount"], item["custodybank"], _, _) = source
        for key in ("instrumenttype", "instrumentno", "issuercompany", "issuer", "custodyaccount", "custodybank"):
            item[key] = item[key] or ""
        item["issuekind"] = "OTHER"
        item["instrumentstatus"] = "ENDORSED"
    return keys


# 결제·할인·부도 처리 (마지막 처리만 기록: 처리일·할인료·처리메모 + updated_by)
#  - 받은 증권 (수금, 타수): 보관 → 결제/할인/부도, 처리취소 → 보관
#  - 발행한 어음 (지급, 자수): 미결제(빈값) → 결제, 처리취소 → 미결제
#  - 배서된 증권(지급에 사용)은 부도만: 배서 → 부도 (연결된 지급 행도 부도 표시), 처리취소 → 배서
#    (넘겨준 어음이 부도나서 상환청구를 받은 경우. 재지급·회수는 별도 전표와 처리메모로 관리)
PROCESS_ACTIONS = {"SETTLE": "SETTLED", "DISCOUNT": "DISCOUNTED", "DISHONOR": "DISHONORED", "CANCEL": None}
PROCESS_ACTION_LABELS = {"SETTLE": "결제", "DISCOUNT": "할인", "DISHONOR": "부도", "CANCEL": "처리취소"}
PROCESSED_STATUSES = ("SETTLED", "DISCOUNTED", "DISHONORED")


class InstrumentProcessLine(BaseModel):
    lineno: int = Field(gt=0)
    discountfee: Decimal = Field(default=Decimal("0"), ge=0, max_digits=15, decimal_places=3)


class InstrumentProcessRequest(BaseModel):
    action: str = Field(min_length=1, max_length=10)
    processdate: date | None = None
    processmemo: str = Field(default="", max_length=500)
    lines: list[InstrumentProcessLine] = Field(min_length=1, max_length=1000)

    @field_validator("action")
    @classmethod
    def validate_action(cls, value: str) -> str:
        value = value.strip().upper()
        if value not in PROCESS_ACTIONS:
            raise ValueError("처리 구분이 올바르지 않습니다.")
        return value

    @field_validator("processmemo")
    @classmethod
    def strip_memo(cls, value: str) -> str:
        return value.strip()

    @model_validator(mode="after")
    def check_lines(self):
        if self.action != "CANCEL" and not self.processdate:
            raise ValueError("처리일을 입력해 주세요.")
        linenos = [line.lineno for line in self.lines]
        if len(linenos) != len(set(linenos)):
            raise ValueError("같은 행이 두 번 선택되었습니다.")
        return self


def _process_block_reason(action: str, transactiontype: str, row: dict) -> str | None:
    """Why this line cannot take the action (None = allowed). The screen applies the same rules."""
    status = (row["instrumentstatus"] or "").upper()
    kind = (row["issuekind"] or "").upper()
    if not row["instrumentamt"] or row["instrumentamt"] <= 0:
        return "수표/어음 금액이 없는 행입니다"
    if transactiontype == "RECEIPT":
        if kind == "OWN":
            return "자수 증권은 수금에서 처리할 수 없습니다"
        if row["used_by"] or status == "ENDORSED":
            if action == "DISHONOR":
                return None if status == "ENDORSED" else "이미 부도 처리된 증권입니다"
            if action == "CANCEL":
                return None if status == "DISHONORED" else "배서된 증권은 지급 전표를 삭제해야 되돌릴 수 있습니다"
            return "배서(지급에 사용)된 증권은 부도만 처리할 수 있습니다"
        if action == "CANCEL":
            return None if status in PROCESSED_STATUSES else "처리된 증권이 아닙니다"
        return None if status in ("", "HELD") else "보관 중인 증권이 아닙니다"
    # PAYMENT · 타수 직접 입력(배서양도): 부도만, 처리취소 → 배서. 불러온 행은 원본 수금 전표에서 처리한다.
    if kind == "OTHER":
        if row["source_receiptno"]:
            return f"보유증권 불러오기로 넣은 행은 원본 수금 전표({row['source_receiptno']})에서 처리해 주세요"
        if action == "DISHONOR":
            return None if status in ("", "ENDORSED") else "이미 부도 처리된 증권입니다"
        if action == "CANCEL":
            return None if status == "DISHONORED" else "부도 처리된 증권이 아닙니다"
        return "배서양도한 증권은 부도·처리취소만 할 수 있습니다"
    # PAYMENT · 자수: 결제 또는 처리취소
    if kind != "OWN":
        return "발행구분(자수·타수)이 없는 행은 처리할 수 없습니다"
    if action == "SETTLE":
        return None if status not in PROCESSED_STATUSES else "이미 결제된 어음입니다"
    if action == "CANCEL":
        return None if status == "SETTLED" else "결제된 어음이 아닙니다"
    return "발행한 어음은 결제·처리취소만 할 수 있습니다"


def process_instruments(companyid: str, receiptno: str, payload: dict, actor: str | None = None):
    action = payload["action"]
    lines = {line["lineno"]: line for line in payload["lines"]}
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute("SELECT transactiontype FROM ReceiptPayment01t WHERE companyid = %s AND receiptno = %s FOR SHARE",
                       (companyid, receiptno))
        header = cursor.fetchone()
        if not header:
            raise LookupError("수금/지급 전표를 찾을 수 없습니다.")
        transactiontype = (header[0] or "").upper()
        # Row locks: a concurrent 지급 저장 (보유증권 사용) or another 처리 waits here, then sees the new state.
        cursor.execute(
            """SELECT d.lineno, d.instrumentamt, d.instrumentstatus, d.issuekind, d.source_receiptno,
                      (SELECT p.receiptno FROM ReceiptPayment02t p WHERE p.companyid = d.companyid
                        AND p.source_receiptno = d.receiptno AND p.source_lineno = d.lineno LIMIT 1) AS used_by
               FROM ReceiptPayment02t d
               WHERE d.companyid = %s AND d.receiptno = %s AND d.lineno = ANY(%s)
               ORDER BY d.lineno FOR UPDATE OF d""",
            (companyid, receiptno, list(lines)),
        )
        rows = {row[0]: dict(zip(("lineno", "instrumentamt", "instrumentstatus", "issuekind", "source_receiptno", "used_by"), row))
                for row in cursor.fetchall()}
        problems = []
        for lineno in sorted(lines):
            row = rows.get(lineno)
            reason = "행을 찾을 수 없습니다" if not row else _process_block_reason(action, transactiontype, row)
            if reason:
                problems.append(f"{lineno}행: {reason}")
        if problems:
            raise ValueError(f"{PROCESS_ACTION_LABELS[action]}할 수 없는 행이 있습니다. " + " / ".join(problems[:5]))

        for lineno in sorted(lines):
            endorsed = transactiontype == "RECEIPT" and bool(rows[lineno]["used_by"])
            manual_endorsed = transactiontype == "PAYMENT" and (rows[lineno]["issuekind"] or "").upper() == "OTHER"
            if action == "CANCEL":
                cursor.execute(
                    """UPDATE ReceiptPayment02t
                       SET instrumentstatus = %s, processdate = NULL, discountfee = 0, processmemo = NULL,
                           updated_at = CURRENT_TIMESTAMP, updated_by = COALESCE(%s, updated_by)
                       WHERE companyid = %s AND receiptno = %s AND lineno = %s""",
                    ("ENDORSED" if endorsed or manual_endorsed else "HELD" if transactiontype == "RECEIPT" else None,
                     actor or None, companyid, receiptno, lineno),
                )
            else:
                cursor.execute(
                    """UPDATE ReceiptPayment02t
                       SET instrumentstatus = %s, processdate = %s, discountfee = %s, processmemo = %s,
                           updated_at = CURRENT_TIMESTAMP, updated_by = COALESCE(%s, updated_by)
                       WHERE companyid = %s AND receiptno = %s AND lineno = %s""",
                    (PROCESS_ACTIONS[action], payload["processdate"],
                     lines[lineno]["discountfee"] if action == "DISCOUNT" else 0,
                     payload["processmemo"] or None, actor or None, companyid, receiptno, lineno),
                )
            if endorsed:
                # 이 증권을 넘겨준 지급 행도 같은 표시 (부도 ↔ 배서). 처리일이 있으면 그 지급 전표는 삭제가 막힌다.
                cancel = action == "CANCEL"
                cursor.execute(
                    """UPDATE ReceiptPayment02t
                       SET instrumentstatus = %s, processdate = %s, processmemo = %s,
                           updated_at = CURRENT_TIMESTAMP, updated_by = COALESCE(%s, updated_by)
                       WHERE companyid = %s AND source_receiptno = %s AND source_lineno = %s""",
                    ("ENDORSED" if cancel else "DISHONORED", None if cancel else payload["processdate"],
                     None if cancel else (payload["processmemo"] or None), actor or None, companyid, receiptno, lineno),
                )
    return {"receiptno": receiptno, "action": action, "count": len(lines)}


# 증권 상태 공용 SQL (수금/지급 현황 내역 조회와 수표/어음 현황 InstrumentStatus.py 가 함께 사용)
#  유효 상태: 지급·자수의 빈 상태 = 출금 예정(UNPAID). 그 밖의 빈 상태는 빈값 그대로.
_EFFECTIVE_STATUS_SQL = """CASE
    WHEN d.instrumentamt > 0 AND COALESCE(d.instrumentstatus, '') = ''
         AND h.transactiontype = 'PAYMENT' AND d.issuekind = 'OWN' THEN 'UNPAID'
    ELSE NULLIF(d.instrumentstatus, '') END"""
_USED_RECEIPTNO_SQL = """(SELECT p.receiptno FROM ReceiptPayment02t p WHERE p.companyid = d.companyid
    AND p.source_receiptno = d.receiptno AND p.source_lineno = d.lineno LIMIT 1)"""
INSTRUMENT_STATUS_FILTERS = ("OPEN", "HELD", "UNPAID", "ENDORSED", "SETTLED", "DISCOUNTED", "DISHONORED")


def search_customers(companyid: str, query: str, limit: int = 30):
    with _connect() as connection, connection.cursor() as cursor:
        pattern = f"%{query.strip()}%"
        cursor.execute(
            """SELECT customercode AS customcode, customername AS customname
               FROM customer01t
               WHERE companyid = %s AND useyn = 'Y'
                 AND (%s = '' OR customercode ILIKE %s OR customername ILIKE %s)
               ORDER BY customername, customercode
               LIMIT %s""",
            (companyid, query.strip(), pattern, pattern, limit),
        )
        return [_row_dict(cursor, row) for row in cursor.fetchall()]


def _next_receiptno(cursor, companyid: str, receiptdate: date) -> str:
    prefix = f"RP{receiptdate:%Y%m%d}"
    cursor.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"receipt-payment:{companyid}:{prefix}",))
    cursor.execute(
        """SELECT COALESCE(MAX(substring(receiptno FROM %s)::bigint), 0)
           FROM ReceiptPayment01t
           WHERE companyid = %s AND receiptno LIKE %s""",
        (len(prefix) + 1, companyid, f"{prefix}%"),
    )
    return f"{prefix}{cursor.fetchone()[0] + 1:05d}"


def save_document(companyid: str, companyname: str, payload: dict, actor: str | None = None):
    receiptno = payload.get("receiptno", "").strip()
    is_new = not receiptno
    items = payload["items"]
    with _connect() as connection, connection.cursor() as cursor:
        if is_new:
            receiptno = _next_receiptno(cursor, companyid, payload["receiptdate"])
            cursor.execute(
                """INSERT INTO ReceiptPayment01t
                   (companyid, companyname, receiptno, receiptdate, transactiontype,
                    customcode, customname, manager, description, created_by)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (companyid, companyname, receiptno, payload["receiptdate"], payload["transactiontype"],
                 payload["customcode"], payload["customname"], payload["manager"], payload["description"],
                 actor or None),
            )
            detail_created_by, detail_updated_by = actor or None, None
        else:
            _block_if_instruments_used(cursor, companyid, receiptno, "수정")
            cursor.execute(
                """UPDATE ReceiptPayment01t
                   SET receiptdate = %s, transactiontype = %s, customcode = %s, customname = %s,
                       manager = %s, description = %s, updated_at = CURRENT_TIMESTAMP,
                       updated_by = %s
                   WHERE companyid = %s AND receiptno = %s
                   RETURNING receiptno, created_by""",
                (payload["receiptdate"], payload["transactiontype"], payload["customcode"],
                 payload["customname"], payload["manager"], payload["description"], actor or None,
                 companyid, receiptno),
            )
            updated = cursor.fetchone()
            if not updated:
                raise ValueError("수금/지급 전표를 찾을 수 없습니다.")
            # Details are re-inserted on edit: keep the original creator, record the editor as modifier.
            detail_created_by, detail_updated_by = updated[1] or None, actor or None
            # instruments this payment used go back to '보관' first; the current selection is applied again below
            _restore_used_instruments(cursor, companyid, receiptno, actor)
            cursor.execute("DELETE FROM ReceiptPayment02t WHERE companyid = %s AND receiptno = %s", (companyid, receiptno))

        used_keys = _apply_source_instruments(cursor, companyid, receiptno, payload["transactiontype"], items)

        for lineno, item in enumerate(items, start=1):
            cashamt = item["cashamt"]
            instrumentamt = item["instrumentamt"]
            # 발행구분은 입력한 그대로 저장한다 (빈값이면 빈값, 서버가 채우지 않음).
            # 처리상태를 비워 두면: 수금 증권(자수 제외) = 보관, 지급 타수(넘겨준 증권) = 배서. 지급 자수는 비워 둔다(= 미결제).
            if instrumentamt > 0 and not item["instrumentstatus"]:
                if payload["transactiontype"] == "RECEIPT" and item["issuekind"] != "OWN":
                    item["instrumentstatus"] = "HELD"
                elif payload["transactiontype"] == "PAYMENT" and item["issuekind"] == "OTHER":
                    item["instrumentstatus"] = "ENDORSED"
            bankamt = item["bankamt"]
            cardamt = item["cardamt"]
            totalamt = cashamt + instrumentamt + bankamt + cardamt
            cursor.execute(
                """INSERT INTO ReceiptPayment02t
                   (companyid, companyname, receiptno, lineno, cashamt, instrumentamt,
                    instrumenttype, instrumentno, issuedate, issuercompany, issuer, issuekind,
                    maturitydate, custodyaccount, custodybank, instrumentstatus,
                    bankamt, cardamt, offsetamt, lossamt, chargeamt, totalamt, description,
                    created_by, updated_by, source_receiptno, source_lineno)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                           %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (companyid, companyname, receiptno, lineno, cashamt, instrumentamt,
                 item["instrumenttype"] or None, item["instrumentno"] or None, item["issuedate"],
                 item["issuercompany"] or None, item["issuer"] or None, item["issuekind"] or None,
                 item["maturitydate"], item["custodyaccount"] or None, item["custodybank"] or None,
                 item["instrumentstatus"] or None, bankamt, cardamt, item["offsetamt"],
                 item["lossamt"], item["chargeamt"], totalamt, item["description"],
                 detail_created_by, detail_updated_by,
                 item.get("source_receiptno") or None, item.get("source_lineno") if item.get("source_receiptno") else None),
            )
        if used_keys:
            # the receipt instruments are now 배서(양도)
            cursor.execute(
                """UPDATE ReceiptPayment02t SET instrumentstatus = 'ENDORSED', updated_at = CURRENT_TIMESTAMP,
                          updated_by = COALESCE(%s, updated_by)
                   WHERE companyid = %s AND (receiptno, lineno) IN (SELECT * FROM unnest(%s::varchar[], %s::integer[]))""",
                (actor or None, companyid, [k[0] for k in used_keys], [k[1] for k in used_keys]),
            )
    return {"receiptno": receiptno, "is_new": is_new}


def delete_document(companyid: str, receiptno: str, actor: str | None = None) -> bool:
    with _connect() as connection, connection.cursor() as cursor:
        _block_if_instruments_used(cursor, companyid, receiptno, "삭제")
        _restore_used_instruments(cursor, companyid, receiptno, actor)
        cursor.execute(
            "DELETE FROM ReceiptPayment01t WHERE companyid = %s AND receiptno = %s RETURNING receiptno",
            (companyid, receiptno),
        )
        return cursor.fetchone() is not None
