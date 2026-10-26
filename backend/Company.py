import psycopg2
from psycopg2.extras import RealDictCursor
from pydantic import BaseModel, Field, field_validator

from config import DB_CONFIG


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
    ceoname: str = Field(default="", max_length=100)
    phone: str = Field(default="", max_length=30)
    email: str = Field(default="", max_length=255)
    zipcode: str = Field(default="", max_length=10)
    address1: str = Field(default="", max_length=300)
    address2: str = Field(default="", max_length=300)
    plan_code: str = "BASIC"
    company_status: str = "PENDING"
    licensed_seats: int = Field(default=0, ge=0)

    @field_validator("companyid", "companyname", "businessno", "ceoname", "phone", "email", "zipcode", "address1", "address2", mode="before")
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


def _connect():
    return psycopg2.connect(conn_str)


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
            f"""SELECT c.*,
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


def create_company(data: CompanyInput):
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
               (companyid, companyname, businessno, ceoname, phone, email, zipcode,
                address1, address2, plan_code, company_status, licensed_seats)
               VALUES (%s, %s, NULLIF(%s, ''), NULLIF(%s, ''), NULLIF(%s, ''),
                       NULLIF(%s, ''), NULLIF(%s, ''), NULLIF(%s, ''), NULLIF(%s, ''),
                       %s, %s, %s)
               RETURNING *""",
            (data.companyid, data.companyname, data.businessno, data.ceoname, data.phone,
             data.email, data.zipcode, data.address1, data.address2, data.plan_code,
             data.company_status, data.licensed_seats),
        )
        return dict(cursor.fetchone())


def update_company(companyid: str, data: CompanyInput):
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
               SET companyid = %s, companyname = %s, businessno = NULLIF(%s, ''), ceoname = NULLIF(%s, ''),
                   phone = NULLIF(%s, ''), email = NULLIF(%s, ''), zipcode = NULLIF(%s, ''),
                   address1 = NULLIF(%s, ''), address2 = NULLIF(%s, ''), plan_code = %s,
                   company_status = %s, licensed_seats = %s, updatedat = CURRENT_TIMESTAMP
               WHERE companyid = %s
               RETURNING *""",
            (data.companyid, data.companyname, data.businessno, data.ceoname, data.phone, data.email,
             data.zipcode, data.address1, data.address2, data.plan_code,
             data.company_status, data.licensed_seats, companyid),
        )
        row = cursor.fetchone()
        if not row:
            raise LookupError("고객사를 찾을 수 없습니다.")
        return dict(row)


def delete_company(companyid: str) -> bool:
    del companyid
    raise ValueError("등록된 고객사는 삭제할 수 없습니다. 이용상태를 종료로 변경해 주세요.")
