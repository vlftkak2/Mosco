import db as _shared_db
from psycopg2.extras import RealDictCursor
from pydantic import BaseModel, Field, field_validator, model_validator

from config import DB_CONFIG
from services.inventory.CurrentStock import user_name_sql
# 법인등록번호 검증 · 표시 형식은 사업장관리와 같은 규칙 (같은 company01t.corporationno 칸을 함께 쓴다)
from services.masterdata.Workplace import _format as _format_number, valid_corporationno


conn_str = (
    f"host={DB_CONFIG['host']} "
    f"port={DB_CONFIG['port']} "
    f"dbname={DB_CONFIG['database']} "
    f"user={DB_CONFIG['user']} "
    f"password={DB_CONFIG['password']}"
)


class CompanyInput(BaseModel):
    companyid: str = Field(min_length=1, max_length=50)
    companyname: str = Field(min_length=1, max_length=100)
    businessno: str = Field(default="", max_length=20)
    corporationno: str = Field(default="", max_length=20)
    ceoname: str = Field(default="", max_length=100)
    phone: str = Field(default="", max_length=30)
    zipcode: str = Field(default="", max_length=10)
    address1: str = Field(default="", max_length=300)
    address2: str = Field(default="", max_length=300)
    plan_code: str = "BASIC"
    company_status: str = "PENDING"
    licensed_seats: int = Field(default=0, ge=0)

    @field_validator("companyid", "companyname", "businessno", "corporationno", "ceoname", "phone", "zipcode",
                     "address1", "address2", mode="before")
    @classmethod
    def strip_text(cls, value):
        return str(value or "").strip()

    @field_validator("plan_code")
    @classmethod
    def validate_plan(cls, value: str) -> str:
        value = str(value or "").strip().upper()
        if value not in {"BASIC", "EXTENDED"}:
            raise ValueError("요금제는 BASIC 또는 EXTENDED만 사용할 수 있습니다.")
        return value

    @field_validator("company_status")
    @classmethod
    def validate_status(cls, value: str) -> str:
        value = str(value or "").strip().upper()
        if value not in {"PENDING", "ACTIVE", "SUSPENDED", "CLOSED"}:
            raise ValueError("올바른 고객사 상태를 선택해 주세요.")
        return value

    @model_validator(mode="after")
    def check_corporationno(self):
        # 비워 두면 그대로 저장. 입력하면 사업장관리와 같은 규칙으로 검증하고 000000-0000000 형식으로 맞춘다
        if self.corporationno:
            if not valid_corporationno(self.corporationno):
                raise ValueError("법인등록번호가 올바르지 않습니다. 번호를 다시 확인해 주세요.")
            self.corporationno = _format_number(self.corporationno, (6,))
        return self


def _connect():
    # Borrow from the shared pool; commit/rollback and return on block exit.
    return _shared_db.connect()


def is_master(companyid: str, email: str) -> bool:
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """SELECT 1
               FROM user01t
               WHERE companyid = %s
                 AND LOWER(email) = LOWER(%s)
                 AND UPPER(COALESCE(authority, '')) = 'MASTER'
                 AND UPPER(COALESCE(useyn, 'N')) = 'Y'
               LIMIT 1""",
            (companyid, email),
        )
        return cursor.fetchone() is not None


def is_submaster(companyid: str, email: str) -> bool:
    if not companyid or companyid == "001":
        return False
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """SELECT 1
               FROM user01t u
               JOIN company01t c ON c.companyid = u.companyid
               WHERE u.companyid = %s
                 AND LOWER(u.email) = LOWER(%s)
                 AND UPPER(COALESCE(u.authority, '')) = 'SUBMASTER'
                 AND UPPER(COALESCE(u.useyn, 'N')) = 'Y'
                 AND UPPER(COALESCE(c.company_status, '')) = 'ACTIVE'
               LIMIT 1""",
            (companyid, email),
        )
        return cursor.fetchone() is not None


_COLUMN_NAMES: list[str] | None = None


def _company_columns(cursor) -> list[str]:
    """company01t 의 바이너리가 아닌 칸 이름 (한 번만 읽어 둔다)."""
    global _COLUMN_NAMES
    if _COLUMN_NAMES is None:
        cursor.execute(
            """SELECT column_name FROM information_schema.columns
               WHERE table_schema = current_schema() AND table_name = 'company01t' AND data_type <> 'bytea'
               ORDER BY ordinal_position"""
        )
        _COLUMN_NAMES = [row["column_name"] if isinstance(row, dict) else row[0] for row in cursor.fetchall()]
    return _COLUMN_NAMES


def _returning_sql(cursor) -> str:
    """저장 후 돌려줄 칸 (이미지 BYTEA 제외 — RETURNING * 이면 이미지가 있는 고객사 저장 응답이 500 오류가 난다)."""
    return ", ".join(f'"{name}"' for name in _company_columns(cursor))


def _list_columns_sql(cursor) -> str:
    """목록에 실을 company01t 칸 (바이너리 칸 제외).

    사업장관리에서 올린 로고 · 직인 · 사업자등록증 이미지(BYTEA)를 c.* 로 함께 읽으면
    응답을 JSON 으로 바꾸지 못해 목록이 500 오류가 나고, 이미지만큼 전송량도 커진다. 칸 이름은 한 번만 읽어 둔다.
    """
    return ", ".join(f'c."{name}"' for name in _company_columns(cursor))


def list_companies(q: str = "", plan_code: str = "", company_status: str = "", page: int = 1, page_size: int = 30):
    conditions = ["TRUE"]
    params = []
    q = (q or "").strip()
    if q:
        conditions.append("(c.companyid ILIKE %s OR c.companyname ILIKE %s OR c.businessno ILIKE %s)")
        pattern = f"%{q}%"
        params.extend([pattern, pattern, pattern])
    if plan_code:
        conditions.append("c.plan_code = %s")
        params.append(plan_code.strip().upper())
    if company_status:
        conditions.append("c.company_status = %s")
        params.append(company_status.strip().upper())
    where = " AND ".join(conditions)

    with _connect() as connection, connection.cursor(cursor_factory=RealDictCursor) as cursor:
        cursor.execute(f"SELECT COUNT(*) AS total FROM company01t c WHERE {where}", params)
        total = cursor.fetchone()["total"]
        cursor.execute(
            f"""SELECT {_list_columns_sql(cursor)},
                       {user_name_sql('c.created_by')} AS created_by_name,
                       {user_name_sql('c.updated_by')} AS updated_by_name,
                       COUNT(u.email) FILTER (WHERE UPPER(COALESCE(u.useyn, 'N')) = 'Y')::integer AS active_users,
                       COUNT(u.email)::integer AS total_users
                FROM company01t c
                LEFT JOIN user01t u ON u.companyid = c.companyid
                WHERE {where}
                GROUP BY c.companyid
                ORDER BY c.companyid ASC
                LIMIT %s OFFSET %s""",
            [*params, page_size, (page - 1) * page_size],
        )
        return {"items": list(cursor.fetchall()), "total": total, "page": page, "page_size": page_size}


def create_company(data: CompanyInput, actor: str | None = None):
    with _connect() as connection, connection.cursor(cursor_factory=RealDictCursor) as cursor:
        cursor.execute("SELECT 1 FROM company01t WHERE LOWER(companyid) = LOWER(%s)", (data.companyid,))
        if cursor.fetchone():
            raise ValueError("이미 등록된 고객사 코드입니다.")
        if data.businessno:
            cursor.execute("SELECT 1 FROM company01t WHERE businessno = %s", (data.businessno,))
            if cursor.fetchone():
                raise ValueError("이미 등록된 사업자번호입니다.")
        cursor.execute(
            """INSERT INTO company01t
               (companyid, companyname, businessno, corporationno, ceoname, phone, zipcode,
                address1, address2, plan_code, company_status, licensed_seats, created_by)
               VALUES (%s, %s, NULLIF(%s, ''), NULLIF(%s, ''), NULLIF(%s, ''), NULLIF(%s, ''),
                       NULLIF(%s, ''), NULLIF(%s, ''), NULLIF(%s, ''),
                       %s, %s, %s, %s)
               RETURNING """ + _returning_sql(cursor),
            (data.companyid, data.companyname, data.businessno, data.corporationno, data.ceoname, data.phone,
             data.zipcode, data.address1, data.address2, data.plan_code,
             data.company_status, data.licensed_seats, actor or None),
        )
        return dict(cursor.fetchone())


def update_company(companyid: str, data: CompanyInput, actor: str | None = None):
    with _connect() as connection, connection.cursor(cursor_factory=RealDictCursor) as cursor:
        if companyid != data.companyid:
            raise ValueError("등록된 고객사 코드는 변경할 수 없습니다.")

        cursor.execute(
            """SELECT COUNT(*) FILTER (WHERE UPPER(COALESCE(useyn, 'N')) = 'Y')::integer AS active_users
               FROM user01t WHERE companyid = %s""",
            (companyid,),
        )
        active_users = cursor.fetchone()["active_users"]
        if data.licensed_seats < active_users:
            raise ValueError(f"허용 계정 수는 현재 활성 계정 수({active_users}명)보다 작게 설정할 수 없습니다.")
        if data.businessno:
            cursor.execute(
                "SELECT 1 FROM company01t WHERE businessno = %s AND companyid <> %s",
                (data.businessno, companyid),
            )
            if cursor.fetchone():
                raise ValueError("이미 등록된 사업자번호입니다.")
        cursor.execute(
            """UPDATE company01t
               SET companyid = %s, companyname = %s, businessno = NULLIF(%s, ''), corporationno = NULLIF(%s, ''),
                   ceoname = NULLIF(%s, ''), phone = NULLIF(%s, ''), zipcode = NULLIF(%s, ''),
                   address1 = NULLIF(%s, ''), address2 = NULLIF(%s, ''), plan_code = %s,
                   company_status = %s, licensed_seats = %s, updatedat = CURRENT_TIMESTAMP, updated_by = %s
               WHERE companyid = %s
               RETURNING """ + _returning_sql(cursor),
            (data.companyid, data.companyname, data.businessno, data.corporationno, data.ceoname, data.phone,
             data.zipcode, data.address1, data.address2, data.plan_code,
             data.company_status, data.licensed_seats, actor or None, companyid),
        )
        row = cursor.fetchone()
        if not row:
            raise LookupError("고객사를 찾을 수 없습니다.")
        return dict(row)


# 고객사를 지울 때 함께 지우는 테이블 (계정 · 메뉴권한). 그 밖에 companyid 칸이 있는 테이블에 자료가 있으면 업무 자료로 보고 삭제를 막는다.
_COMPANY_ACCOUNT_TABLES = {"company01t", "user01t", "usermenupermission01t"}


def delete_company(companyid: str) -> bool:
    """고객사 삭제: 플랫폼 운영사(001, MASTER 소속)는 지울 수 없다.
    업무 자료(전표 · 재고 · 거래처 · 코드 · 게시글 등)가 하나라도 있으면 막고 이용상태 '종료'를 안내한다.
    자료가 없으면 메뉴권한 → 계정 → 고객사 순서로 한 번에 지운다."""
    if companyid == "001":
        raise ValueError("플랫폼 운영사(001)는 삭제할 수 없습니다.")
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute("SELECT companyname FROM company01t WHERE companyid = %s FOR UPDATE", (companyid,))
        if not cursor.fetchone():
            return False
        cursor.execute(
            """SELECT c.table_name
               FROM information_schema.columns c
               JOIN information_schema.tables t USING (table_schema, table_name)
               WHERE c.table_schema = 'public' AND c.column_name = 'companyid' AND t.table_type = 'BASE TABLE'
               ORDER BY c.table_name"""
        )
        tables = [row[0] for row in cursor.fetchall()
                  if row[0] not in _COMPANY_ACCOUNT_TABLES and not row[0].endswith("_backup")]
        used = []
        for table in tables:
            cursor.execute(f'SELECT 1 FROM "{table}" WHERE companyid = %s LIMIT 1', (companyid,))
            if cursor.fetchone():
                used.append(table)
        if used:
            raise ValueError(
                "업무 자료가 있는 고객사는 삭제할 수 없습니다. 이용상태를 종료로 변경해 주세요. "
                f"(자료가 있는 곳: {', '.join(used[:5])}{' 외' if len(used) > 5 else ''})"
            )
        cursor.execute("DELETE FROM usermenupermission01t WHERE companyid = %s", (companyid,))
        cursor.execute("DELETE FROM user01t WHERE companyid = %s", (companyid,))
        cursor.execute("DELETE FROM company01t WHERE companyid = %s", (companyid,))
        return cursor.rowcount == 1
