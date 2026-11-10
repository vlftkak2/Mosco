import pyodbc
import psycopg2
import db as _shared_db
from psycopg2.extras import execute_values
from config import DB_CONFIG
from datetime import datetime
import time
import jwt
import requests
import math
import os
import zipfile
import fitz
import re
#from tkinter import Tk, filedialog 
import pdfkit
import io
from decimal import Decimal, InvalidOperation
from pydantic import BaseModel, Field, field_validator
from typing import List

# PostgreSQL 접속 문자열
conn_str = (
    f"host={DB_CONFIG['host']} "
    f"port={DB_CONFIG['port']} "
    f"dbname={DB_CONFIG['database']} "
    f"user={DB_CONFIG['user']} "
    f"password={DB_CONFIG['password']}"
)

class CustomModifyRequest(BaseModel):
    companyid: str
    companyname: str
    customercode: str
    customername: str
    businessno: str = ""
    corporationno: str = ""
    ceoname: str = ""
    tradetype: str = ""
    businesstype: str = ""
    industry: str = ""
    manager: str = ""
    zipcode: str = ""
    address: str = ""
    phone: str = ""
    fax: str = ""
    email: str = ""
    bankcode: str = ""
    accountno: str = ""
    useryn: str = "Y"
    remark: str = ""
    # 기초 미수금 / 기초 미지급금: 원장 시작일 이전부터 남아 있던 잔액 (MASTER/SUBMASTER만 변경 가능)
    openingreceivable: Decimal = Field(default=Decimal("0"), ge=0, max_digits=15, decimal_places=2)
    openingpayable: Decimal = Field(default=Decimal("0"), ge=0, max_digits=15, decimal_places=2)

    @field_validator("openingreceivable", "openingpayable", mode="before")
    @classmethod
    def _normalize_opening_amount(cls, value):
        # Excel uploads may send "", None or "1,234,000"; treat blanks as 0 and drop thousand separators.
        if value is None:
            return Decimal("0")
        if isinstance(value, str):
            text = value.replace(",", "").strip()
            if not text:
                return Decimal("0")
            try:
                return Decimal(text)
            except InvalidOperation:
                raise ValueError("기초 잔액은 숫자로 입력해 주세요.")
        return value


def _db_useyn(value: str) -> str:
    return "N" if (value or "").strip().upper() in {"N", "미사용", "사용중지"} else "Y"


def _filter_useyn(value: str) -> str:
    normalized = (value or "").strip()
    if normalized in {"사용중", "Y"}:
        return "Y"
    if normalized in {"사용중지", "미사용", "N"}:
        return "N"
    return normalized


def _next_customer_code(cursor, companyid: str) -> str:
    # Serialize code allocation per company so simultaneous registrations cannot get the same preview/save code.
    cursor.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (companyid,))
    cursor.execute(
        """
        SELECT COALESCE(MAX(substring(customercode FROM 6)::bigint), 0)
        FROM customer01t
        WHERE companyid = %s AND customercode ~* '^Cust-[0-9]+$'
        """,
        (companyid,),
    )
    return f"Cust-{cursor.fetchone()[0] + 1:05d}"


def CustomerNextCode(companyid: str):
    conn = None
    try:
        conn = _shared_db.open_connection()
        with conn.cursor() as cursor:
            code = _next_customer_code(cursor, companyid)
        conn.commit()
        return {"success": True, "customercode": code}
    except Exception as e:
        if conn:
            conn.rollback()
        return {"success": False, "message": str(e)}
    finally:
        if conn:
            conn.close()


def BankList(companyid: str):
    conn = None
    try:
        conn = _shared_db.open_connection()
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT code, code_name
                FROM CodeMaster01t
                WHERE companyid = %s
                  AND groupcode = 'BANK'
                  AND BTRIM(use_yn) IN ('Y', '사용중')
                  AND NULLIF(BTRIM(code_name), '') IS NOT NULL
                ORDER BY code_name, code
                """,
                (companyid,),
            )
            return {"success": True, "data": [
                {"bankcode": row[0], "bankname": row[1]} for row in cursor.fetchall()
            ]}
    except Exception as error:
        return {"success": False, "error": str(error)}
    finally:
        if conn:
            conn.close()


def CustomerManagerList(companyid: str):
    """Return active employee names available as customer managers."""
    conn = None
    try:
        conn = _shared_db.open_connection()
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT DISTINCT username
                FROM user01t
                WHERE companyid = %s
                  AND UPPER(BTRIM(COALESCE(useyn, 'N'))) = 'Y'
                  AND NULLIF(BTRIM(username), '') IS NOT NULL
                ORDER BY username
                """,
                (companyid,),
            )
            return {"success": True, "data": [row[0] for row in cursor.fetchall()]}
    except Exception as error:
        return {"success": False, "error": str(error)}
    finally:
        if conn:
            conn.close()


def _validate_customer_references(cursor, item: CustomModifyRequest):
    item.manager = (item.manager or "").strip()
    item.bankcode = (item.bankcode or "").strip()

    if item.manager:
        cursor.execute(
            """
            SELECT 1 FROM user01t
            WHERE companyid = %s AND username = %s
              AND UPPER(BTRIM(COALESCE(useyn, 'N'))) = 'Y'
            LIMIT 1
            """,
            (item.companyid, item.manager),
        )
        if not cursor.fetchone():
            return {"success": False, "message": f"Manager '{item.manager}' is not an active user for this company."}

    if item.bankcode:
        cursor.execute(
            """
            SELECT 1 FROM CodeMaster01t
            WHERE companyid = %s AND groupcode = 'BANK' AND code = %s
              AND BTRIM(use_yn) IN ('Y', '사용중')
            LIMIT 1
            """,
            (item.companyid, item.bankcode),
        )
        if not cursor.fetchone():
            return {"success": False, "message": f"Bank code '{item.bankcode}' is not active for this company."}

    return {"success": True}


def _validate_customer_batch_references(cursor, items: List[CustomModifyRequest], companyid: str):
    bank_values = set()
    manager_values = set()
    for item in items:
        item.manager = (item.manager or "").strip()
        item.bankcode = (item.bankcode or "").strip()
        if item.manager:
            manager_values.add(item.manager)
        if item.bankcode:
            bank_values.add(item.bankcode)

    if manager_values:
        cursor.execute(
            """
            SELECT DISTINCT username FROM user01t
            WHERE companyid = %s
              AND UPPER(BTRIM(COALESCE(useyn, 'N'))) = 'Y'
              AND username = ANY(%s)
            """,
            (companyid, list(manager_values)),
        )
        missing_managers = manager_values - {row[0] for row in cursor.fetchall()}
        if missing_managers:
            names = ", ".join(sorted(missing_managers)[:10])
            return {"success": False, "message": f"사용 중인 회사 계정에 없는 담당자입니다: {names}"}

    if bank_values:
        cursor.execute(
            """
            SELECT DISTINCT code FROM CodeMaster01t
            WHERE companyid = %s AND groupcode = 'BANK'
              AND BTRIM(use_yn) IN ('Y', '사용중') AND code = ANY(%s)
            """,
            (companyid, list(bank_values)),
        )
        missing_banks = bank_values - {row[0] for row in cursor.fetchall()}
        if missing_banks:
            codes = ", ".join(sorted(missing_banks)[:10])
            return {"success": False, "message": f"기본정보관리-은행코드를 입력해주세요"}

    return {"success": True}


# 거래처 등록
def CustomerCreate(item: CustomModifyRequest, actor: str | None = None):

    conn = None
    try:
        # DB 연결
        conn = _shared_db.open_connection()
        cursor = conn.cursor()
        reference_check = _validate_customer_references(cursor, item)
        if not reference_check["success"]:
            return reference_check
        customercode = (item.customercode or "").strip()
        if customercode:
            cursor.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (item.companyid,))
            cursor.execute(
                "SELECT 1 FROM customer01t WHERE companyid = %s AND LOWER(customercode) = LOWER(%s) LIMIT 1",
                (item.companyid, customercode),
            )
            if cursor.fetchone():
                return {"success": False, "message": f"이미 등록된 거래처코드입니다: {customercode}"}
        else:
            customercode = _next_customer_code(cursor, item.companyid)

        # 사용자정보 등록
        query = """
            INSERT INTO customer01t (
                companyid, companyname, customercode, customername, businessno,
                corporationno, ceoname, tradetype, businesstype, industry, manager,
                zipcode, address, phone, fax, email, bankcode, accountno, useyn, remark, createdby,
                openingreceivable, openingpayable
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """
        cursor.execute(query, (
            item.companyid, item.companyname, customercode, item.customername,
            item.businessno, item.corporationno, item.ceoname, item.tradetype,
            item.businesstype, item.industry, item.manager, item.zipcode, item.address, item.phone,
            item.fax, item.email, item.bankcode or None, item.accountno, _db_useyn(item.useryn), item.remark,
            actor or None, item.openingreceivable, item.openingpayable,
        ))

        conn.commit()
        
        if cursor.rowcount > 0:
            return {"success": True, "customercode": customercode, "message": f"거래처 정보 등록 완료! ({customercode})"}
        else:
            return {"success": False, "message": "업데이트 실패"} 

    except Exception as e: # 이 except 블록이 누락되었는지 확인하세요!
        return {"success": False, "message": str(e)}

    finally:
        if conn:
            conn.close() 


def CustomerBulkCreate(items: List[CustomModifyRequest], actor: str | None = None):
    """Insert a customer batch in one database operation and one transaction."""
    if not items:
        return {"success": False, "message": "등록할 거래처가 없습니다."}

    conn = None
    try:
        conn = _shared_db.open_connection()
        with conn.cursor() as cursor:
            company_ids = {item.companyid for item in items}
            if len(company_ids) != 1:
                return {"success": False, "message": "업로드 데이터의 회사 정보가 일치하지 않습니다. 다시 로그인한 뒤 업로드해 주세요."}

            companyid = next(iter(company_ids))
            reference_check = _validate_customer_batch_references(cursor, items, companyid)
            if not reference_check["success"]:
                return reference_check

            cursor.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (companyid,))
            requested_codes = [(item.customercode or "").strip() for item in items]
            if not all(requested_codes):
                return {"success": False, "message": "엑셀 일괄등록은 거래처코드와 거래처명이 필수입니다."}
            if any(not (item.customername or "").strip() for item in items):
                return {"success": False, "message": "엑셀 일괄등록은 거래처코드와 거래처명이 필수입니다."}
            normalized_codes = [code.casefold() for code in requested_codes]
            if len(normalized_codes) != len(set(normalized_codes)):
                return {"success": False, "message": "업로드 파일에 중복된 거래처코드가 있습니다."}

            if normalized_codes:
                cursor.execute(
                    "SELECT customercode FROM customer01t WHERE companyid = %s AND LOWER(customercode) = ANY(%s)",
                    (companyid, normalized_codes),
                )
                duplicates = [row[0] for row in cursor.fetchall()]
                if duplicates:
                    return {"success": False, "message": f"이미 등록된 거래처코드가 있습니다: {', '.join(duplicates[:10])}"}

            assigned_codes = requested_codes
            generated_codes = []

            query = """
                INSERT INTO customer01t
                    (companyid, companyname, customercode, customername, businessno,
                     corporationno, ceoname, tradetype, businesstype, industry, manager,
                     zipcode, address, phone, fax, email, bankcode, accountno, useyn, remark, createdby,
                     openingreceivable, openingpayable)
                VALUES %s
            """
            values = [
                (item.companyid, item.companyname, assigned_code, item.customername,
                 item.businessno, item.corporationno, item.ceoname, item.tradetype,
                 item.businesstype, item.industry, item.manager, item.zipcode, item.address, item.phone,
                 item.fax, item.email, item.bankcode or None, item.accountno, _db_useyn(item.useryn), item.remark,
                 actor or None, item.openingreceivable, item.openingpayable)
                for item, assigned_code in zip(items, assigned_codes)
            ]
            execute_values(cursor, query, values, page_size=1000)
        conn.commit()
        return {"success": True, "count": len(items), "codes": assigned_codes, "generated_codes": generated_codes, "message": f"거래처 {len(items)}건을 일괄 등록했습니다."}
    except Exception as e:
        if conn:
            conn.rollback()
        return {"success": False, "message": str(e)}
    finally:
        if conn:
            conn.close()
            
# 거래처 수정
def CustomerModify(item: CustomModifyRequest, actor: str | None = None, update_opening_balances: bool = True):
    """update_opening_balances=False keeps the stored 기초 미수금/미지급금 (callers without MASTER/SUBMASTER)."""

    conn = None
    try:
        # DB 연결
        conn = _shared_db.open_connection()
        cursor = conn.cursor()
        reference_check = _validate_customer_references(cursor, item)
        if not reference_check["success"]:
            return reference_check

        # 거래처정보 업데이트
        query = """
            UPDATE customer01t
            SET customername=%s, businessno=%s, corporationno=%s, ceoname=%s,
                tradetype=%s, businesstype=%s, industry=%s, manager=%s,
                zipcode=%s, address=%s, phone=%s, fax=%s, email=%s, bankcode=%s, accountno=%s,
                useyn=%s, remark=%s, updatedat=NOW(), updatedby=%s,
                openingreceivable = CASE WHEN %s THEN %s ELSE openingreceivable END,
                openingpayable = CASE WHEN %s THEN %s ELSE openingpayable END
            WHERE companyid=%s AND customercode=%s
        """
        cursor.execute(query, (
            item.customername, item.businessno, item.corporationno, item.ceoname,
            item.tradetype, item.businesstype, item.industry, item.manager,
            item.zipcode, item.address, item.phone, item.fax, item.email, item.bankcode or None, item.accountno,
            _db_useyn(item.useryn), item.remark, actor or None,
            bool(update_opening_balances), item.openingreceivable,
            bool(update_opening_balances), item.openingpayable,
            item.companyid, item.customercode,
        ))
             
        conn.commit()
        
        if cursor.rowcount > 0:
            return {"success": True, "message": "거래처 정보가 성공적으로 변경되었습니다."}
        else:
            return {"success": False, "message": "일치하는 거래처를 찾을 수 없습니다."} 
            
    finally:
        if conn:
            conn.close()           


# 거래처 조회: 회사별 검색 및 서버 페이지 처리
def CustomerList(
    companyid: str,
    search_keyword: str = None,
    status: str = "전체",
    tradetype: str = "전체",
    page: int = 1,
    page_size: int = 50,
    include_total: bool = True,
):
    conn = None
    try:
        conn = _shared_db.open_connection()
        cursor = conn.cursor()

        conditions = ["companyid = %s"]
        params = [companyid]

        # 검색은 거래처명만 대상으로 합니다.
        if search_keyword:
            conditions.append("(customername ILIKE %s OR customercode ILIKE %s)")
            params.extend([f"%{search_keyword}%", f"%{search_keyword}%"])

        if status and status != "전체":
            conditions.append("useyn = %s")
            params.append(_filter_useyn(status))

        if tradetype and tradetype != "전체":
            conditions.append("tradetype = %s")
            params.append(tradetype)

        where_sql = " AND ".join(conditions)
        total = None
        if include_total:
            cursor.execute(f"SELECT COUNT(*) FROM customer01t WHERE {where_sql}", tuple(params))
            total = cursor.fetchone()[0]

        cursor.execute(
            f"""
            SELECT * FROM customer01t
            WHERE {where_sql}
            ORDER BY
              CASE WHEN customercode ~* '^Cust-[0-9]+$'
                   THEN substring(customercode FROM 6)::bigint END ASC NULLS LAST,
              customercode ASC
            LIMIT %s OFFSET %s
            """,
            (*params, page_size, (page - 1) * page_size),
        )

        columns = [column[0] for column in cursor.description]
        result = [dict(zip(columns, row)) for row in cursor.fetchall()]

        # The UI already has the total when paging; only count an empty, stale page to recover.
        if total is None and not result and page > 1:
            cursor.execute(f"SELECT COUNT(*) FROM customer01t WHERE {where_sql}", tuple(params))
            total = cursor.fetchone()[0]

        return {"success": True, "data": result, "total": total, "page": page, "page_size": page_size}

    except Exception as e:
        return {"success": False, "error": str(e)}
    finally:
        if conn:
            conn.close()


def CustomerExport(companyid: str, search_keyword: str = None, status: str = "전체", tradetype: str = "전체"):
    """Return all customers matching the list filters for spreadsheet export."""
    conn = None
    try:
        conn = _shared_db.open_connection()
        cursor = conn.cursor()
        conditions = ["c.companyid = %s"]
        params = [companyid]
        if search_keyword:
            conditions.append("(c.customername ILIKE %s OR c.customercode ILIKE %s)")
            params.extend([f"%{search_keyword}%", f"%{search_keyword}%"])
        if status and status != "전체":
            conditions.append("c.useyn = %s")
            params.append(_filter_useyn(status))
        if tradetype and tradetype != "전체":
            conditions.append("c.tradetype = %s")
            params.append(tradetype)

        cursor.execute(
            f"""SELECT c.*, b.code_name AS bankname,
                       COALESCE((SELECT u.username FROM user01t u WHERE u.email = c.createdby LIMIT 1), c.createdby) AS createdbyname,
                       COALESCE((SELECT u.username FROM user01t u WHERE u.email = c.updatedby LIMIT 1), c.updatedby) AS updatedbyname
                FROM customer01t AS c
                LEFT JOIN CodeMaster01t AS b
                  ON b.companyid = c.companyid
                 AND b.groupcode = 'BANK'
                 AND b.code = c.bankcode
                WHERE {' AND '.join(conditions)}
                ORDER BY CASE WHEN c.customercode ~* '^Cust-[0-9]+$'
                              THEN substring(c.customercode FROM 6)::bigint END ASC NULLS LAST,
                         c.customercode ASC""",
            tuple(params),
        )
        columns = [column[0] for column in cursor.description]
        result = [dict(zip(columns, row)) for row in cursor.fetchall()]
        return {"success": True, "data": result, "total": len(result)}
    except Exception as e:
        return {"success": False, "error": str(e)}
    finally:
        if conn:
            conn.close()


# ---------------------------------------------------------------------------
# 기초잔액 일괄 반영 (거래처원장용)
# 이미 등록된 거래처의 기초 미수금 / 기초 미지급금만 바꾼다. 다른 거래처 정보는 건드리지 않는다.
# 같은 함수로 미리보기(dry_run)와 반영을 처리하므로, 미리보기 결과와 실제 반영 결과가 다를 수 없다.
# ---------------------------------------------------------------------------
OPENING_BALANCE_LIMIT = Decimal("9999999999999.99")


class OpeningBalanceRow(BaseModel):
    customercode: str = Field(..., min_length=1, max_length=50)
    openingreceivable: Decimal = Field(default=Decimal("0"))
    openingpayable: Decimal = Field(default=Decimal("0"))
    rowno: int | None = None  # 엑셀 행 번호 (안내용)

    @field_validator("customercode", mode="before")
    @classmethod
    def strip_code(cls, value):
        return str(value or "").strip()

    @field_validator("openingreceivable", "openingpayable", mode="before")
    @classmethod
    def parse_amount(cls, value):
        text = str(value if value is not None else "").replace(",", "").strip()
        if not text:
            return Decimal("0")  # 빈칸 = 0원
        try:
            amount = Decimal(text)
        except InvalidOperation as error:
            raise ValueError("금액은 숫자로 입력해 주세요.") from error
        if amount < 0:
            raise ValueError("금액은 0 이상이어야 합니다.")
        if amount > OPENING_BALANCE_LIMIT:
            raise ValueError("금액이 너무 큽니다.")
        return amount.quantize(Decimal("0.01"))


def OpeningBalanceList(companyid: str):
    """양식용: 등록된 거래처 전체의 코드 · 이름 · 현재 기초잔액."""
    with _shared_db.connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """SELECT customercode, customername,
                      COALESCE(openingreceivable, 0) AS openingreceivable,
                      COALESCE(openingpayable, 0) AS openingpayable
               FROM customer01t WHERE companyid = %s
               ORDER BY customercode""",
            (companyid,),
        )
        columns = [column[0] for column in cursor.description]
        return [dict(zip(columns, row)) for row in cursor.fetchall()]


def OpeningBalanceApply(companyid: str, rows: List[OpeningBalanceRow], dry_run: bool = True, actor: str | None = None):
    """엑셀 행을 거래처코드로 찾아 기초잔액을 비교하고, dry_run=False 이면 바뀐 거래처만 한 번에 반영한다."""
    seen = {}
    duplicates = []
    for row in rows:
        key = row.customercode.lower()
        if key in seen:
            duplicates.append(row.customercode)
        seen[key] = row
    if duplicates:
        return {"success": False, "message": f"파일에 같은 거래처코드가 두 번 이상 있습니다: {', '.join(sorted(set(duplicates))[:10])}"}

    with _shared_db.connect() as connection, connection.cursor() as cursor:
        if not dry_run:
            # 같은 회사의 기초잔액을 두 사람이 동시에 반영하지 않도록 잠근다.
            cursor.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"opening-balance:{companyid}",))
        cursor.execute(
            """SELECT customercode, customername,
                      COALESCE(openingreceivable, 0), COALESCE(openingpayable, 0)
               FROM customer01t WHERE companyid = %s AND LOWER(customercode) = ANY(%s)""",
            (companyid, list(seen.keys())),
        )
        existing = {code.lower(): (code, name, Decimal(recv), Decimal(pay)) for code, name, recv, pay in cursor.fetchall()}

        changed, unchanged, missing = [], [], []
        for key, row in seen.items():
            current = existing.get(key)
            if not current:
                missing.append({"rowno": row.rowno, "customercode": row.customercode})
                continue
            code, name, recv, pay = current
            if recv == row.openingreceivable and pay == row.openingpayable:
                unchanged.append(code)
                continue
            changed.append({
                "rowno": row.rowno, "customercode": code, "customername": name,
                "before_receivable": recv, "after_receivable": row.openingreceivable,
                "before_payable": pay, "after_payable": row.openingpayable,
            })

        if not dry_run and changed:
            for start in range(0, len(changed), 500):
                chunk = changed[start:start + 500]
                execute_values(
                    cursor,
                    """UPDATE customer01t AS c
                       SET openingreceivable = v.recv, openingpayable = v.pay,
                           updatedat = NOW(), updatedby = v.actor
                       FROM (VALUES %s) AS v(companyid, code, recv, pay, actor)
                       WHERE c.companyid = v.companyid AND c.customercode = v.code""",
                    [(companyid, item["customercode"], item["after_receivable"], item["after_payable"], actor or None) for item in chunk],
                    template="(%s, %s, %s::numeric, %s::numeric, %s)",
                )

    return {
        "success": True,
        "applied": not dry_run,
        "changed_count": len(changed), "unchanged_count": len(unchanged), "missing_count": len(missing),
        "changed": changed[:300], "missing": missing[:100],
    }
