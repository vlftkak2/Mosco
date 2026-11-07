from contextlib import contextmanager
from datetime import date
from decimal import Decimal

from psycopg2.pool import ThreadedConnectionPool
from pydantic import BaseModel, Field, field_validator, model_validator

from config import DB_CONFIG


_CONNECTION_POOL = ThreadedConnectionPool(
    minconn=1,
    maxconn=10,
    host=DB_CONFIG["host"],
    port=DB_CONFIG["port"],
    dbname=DB_CONFIG["database"],
    user=DB_CONFIG["user"],
    password=DB_CONFIG["password"],
    connect_timeout=5,
)


@contextmanager
def _connect():
    connection = _CONNECTION_POOL.getconn()
    try:
        with connection:
            yield connection
    except Exception:
        _CONNECTION_POOL.putconn(connection, close=True)
        connection = None
        raise
    finally:
        if connection is not None:
            _CONNECTION_POOL.putconn(connection)


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

    @field_validator(
        "instrumenttype", "instrumentno", "issuercompany", "issuer", "issuekind",
        "custodyaccount", "custodybank", "instrumentstatus", "description",
    )
    @classmethod
    def strip_detail_text(cls, value: str) -> str:
        return value.strip()


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
        if not any(getattr(item, field) > 0 for item in self.items for field in amount_fields):
            raise ValueError("금액 상세에 금액을 하나 이상 입력해 주세요.")
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
                     transactiontype: str = ""):
    """Return one row per payment detail, joined with its header for the status grid."""
    where_sql, params = _where_conditions(companyid, date_from, date_to, receiptno, customer, transactiontype)
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
                   d.bankamt, d.cardamt, d.offsetamt, d.lossamt, d.chargeamt, d.totalamt,
                   d.description AS detail_description,
                   d.created_at, d.updated_at
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
                      customcode, customname, manager, description, created_at, updated_at
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
                      description, created_at, updated_at
               FROM ReceiptPayment02t
               WHERE companyid = %s AND receiptno = %s
               ORDER BY lineno""",
            (companyid, receiptno),
        )
        document["items"] = [_row_dict(cursor, detail) for detail in cursor.fetchall()]
    return document


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


def save_document(companyid: str, companyname: str, payload: dict):
    receiptno = payload.get("receiptno", "").strip()
    is_new = not receiptno
    items = payload["items"]
    with _connect() as connection, connection.cursor() as cursor:
        if is_new:
            receiptno = _next_receiptno(cursor, companyid, payload["receiptdate"])
            cursor.execute(
                """INSERT INTO ReceiptPayment01t
                   (companyid, companyname, receiptno, receiptdate, transactiontype,
                    customcode, customname, manager, description)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (companyid, companyname, receiptno, payload["receiptdate"], payload["transactiontype"],
                 payload["customcode"], payload["customname"], payload["manager"], payload["description"]),
            )
        else:
            cursor.execute(
                """UPDATE ReceiptPayment01t
                   SET receiptdate = %s, transactiontype = %s, customcode = %s, customname = %s,
                       manager = %s, description = %s, updated_at = CURRENT_TIMESTAMP
                   WHERE companyid = %s AND receiptno = %s
                   RETURNING receiptno""",
                (payload["receiptdate"], payload["transactiontype"], payload["customcode"],
                 payload["customname"], payload["manager"], payload["description"], companyid, receiptno),
            )
            if not cursor.fetchone():
                raise ValueError("수금/지급 전표를 찾을 수 없습니다.")
            cursor.execute("DELETE FROM ReceiptPayment02t WHERE companyid = %s AND receiptno = %s", (companyid, receiptno))

        for lineno, item in enumerate(items, start=1):
            cashamt = item["cashamt"]
            instrumentamt = item["instrumentamt"]
            bankamt = item["bankamt"]
            cardamt = item["cardamt"]
            totalamt = cashamt + instrumentamt + bankamt + cardamt
            cursor.execute(
                """INSERT INTO ReceiptPayment02t
                   (companyid, companyname, receiptno, lineno, cashamt, instrumentamt,
                    instrumenttype, instrumentno, issuedate, issuercompany, issuer, issuekind,
                    maturitydate, custodyaccount, custodybank, instrumentstatus,
                    bankamt, cardamt, offsetamt, lossamt, chargeamt, totalamt, description)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                           %s, %s, %s, %s, %s, %s, %s)""",
                (companyid, companyname, receiptno, lineno, cashamt, instrumentamt,
                 item["instrumenttype"] or None, item["instrumentno"] or None, item["issuedate"],
                 item["issuercompany"] or None, item["issuer"] or None, item["issuekind"] or None,
                 item["maturitydate"], item["custodyaccount"] or None, item["custodybank"] or None,
                 item["instrumentstatus"] or None, bankamt, cardamt, item["offsetamt"],
                 item["lossamt"], item["chargeamt"], totalamt, item["description"]),
            )
    return {"receiptno": receiptno, "is_new": is_new}


def delete_document(companyid: str, receiptno: str) -> bool:
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            "DELETE FROM ReceiptPayment01t WHERE companyid = %s AND receiptno = %s RETURNING receiptno",
            (companyid, receiptno),
        )
        return cursor.fetchone() is not None
