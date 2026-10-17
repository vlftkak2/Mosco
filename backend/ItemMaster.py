import logging
from contextlib import contextmanager

from psycopg2 import IntegrityError
from psycopg2.pool import ThreadedConnectionPool
from pydantic import BaseModel, Field, field_validator, model_validator

from config import DB_CONFIG

logger = logging.getLogger(__name__)

_CONNECTION_POOL = ThreadedConnectionPool(
    minconn=1,
    maxconn=15,
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


class ItemInput(BaseModel):
    itemcode: str = Field(min_length=1, max_length=100)
    itemname: str = Field(min_length=1, max_length=150)
    itemtypecode: str = Field(default="", max_length=100)
    use_yn: str = Field(min_length=1, max_length=10)
    description: str = Field(default="", max_length=500)
    is_new: bool = False

    @field_validator("itemcode", "itemname", "itemtypecode", "use_yn", "description")
    @classmethod
    def strip_text(cls, value: str) -> str:
        return value.strip()

    @field_validator("use_yn")
    @classmethod
    def validate_use_yn(cls, value: str) -> str:
        normalized = value.upper()
        if normalized not in {"Y", "N"}:
            raise ValueError("사용 여부는 Y 또는 N으로 입력해 주세요.")
        return normalized

    @model_validator(mode="after")
    def require_code_and_name(self):
        if not self.itemcode or not self.itemname:
            raise ValueError("품목코드와 품목명은 필수입니다.")
        return self


class ItemSaveRequest(BaseModel):
    items: list[ItemInput] = Field(min_length=1, max_length=10000)

    @model_validator(mode="after")
    def require_unique_codes(self):
        codes = [item.itemcode for item in self.items]
        if len(codes) != len(set(codes)):
            raise ValueError("요청 안에 중복된 품목코드가 있습니다.")
        return self


class ItemDeleteRequest(BaseModel):
    itemcodes: list[str] = Field(min_length=1, max_length=1000)

    @field_validator("itemcodes")
    @classmethod
    def validate_itemcodes(cls, values: list[str]) -> list[str]:
        normalized = [value.strip() for value in values]
        if any(not value or len(value) > 100 for value in normalized):
            raise ValueError("삭제할 품목코드를 확인해 주세요.")
        if len(normalized) != len(set(normalized)):
            raise ValueError("삭제 요청에 중복된 품목코드가 있습니다.")
        return normalized


_SELECT_COLUMNS = """
    itemcode, itemname, itemtypecode, use_yn, description
"""


def _row_to_item(row):
    keys = (
        "itemcode", "itemname", "itemtypecode", "use_yn", "description",
    )
    item = {key: (value or "") for key, value in zip(keys, row)}
    item["use_yn"] = str(item["use_yn"]).strip() or "Y"
    item["is_new"] = False
    return item


def list_items(companyid: str, page: int, page_size: int, query: str = "", include_total: bool = True):
    search = query.strip()
    where = "companyid = %s"
    params: list = [companyid]
    if search:
        where += " AND (itemcode ILIKE %s OR itemname ILIKE %s)"
        pattern = f"%{search}%"
        params.extend((pattern, pattern))

    try:
        with _connect() as connection, connection.cursor() as cursor:
            total = None
            if include_total:
                cursor.execute(f"SELECT COUNT(*) FROM ItemCode01t WHERE {where}", params)
                total = cursor.fetchone()[0]
            cursor.execute(
                f"SELECT {_SELECT_COLUMNS} FROM ItemCode01t WHERE {where} "
                "ORDER BY itemcode LIMIT %s OFFSET %s",
                (*params, page_size, (page - 1) * page_size),
            )
            items = [_row_to_item(row) for row in cursor.fetchall()]
        return {"items": items, "total": total, "page": page, "page_size": page_size}
    except Exception:
        logger.exception("Failed to list items")
        raise


def export_items(companyid: str, query: str = ""):
    search = query.strip()
    where = "companyid = %s"
    params: list = [companyid]
    if search:
        where += " AND (itemcode ILIKE %s OR itemname ILIKE %s)"
        pattern = f"%{search}%"
        params.extend((pattern, pattern))
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            f"SELECT {_SELECT_COLUMNS} FROM ItemCode01t WHERE {where} ORDER BY itemcode",
            params,
        )
        return [_row_to_item(row) for row in cursor.fetchall()]


def save_items(companyid: str, companyname: str, items: list[dict]) -> int:
    try:
        with _connect() as connection, connection.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_xact_lock(hashtext(%s)::bigint)", (f"item:{companyid}",))
            codes = [item["itemcode"] for item in items]
            cursor.execute(
                "SELECT itemcode FROM ItemCode01t WHERE companyid = %s AND itemcode = ANY(%s) FOR UPDATE",
                (companyid, codes),
            )
            existing_codes = {row[0] for row in cursor.fetchall()}

            for item in items:
                code = item["itemcode"]
                values = (
                    item["itemname"], item.get("itemtypecode") or None, item["use_yn"],
                    item.get("description") or None,
                )
                if item.get("is_new"):
                    if code in existing_codes:
                        raise ValueError(f"이미 등록된 품목코드입니다: {code}")
                    cursor.execute(
                        f"INSERT INTO ItemCode01t (companyid, companyname, {_SELECT_COLUMNS}) "
                        "VALUES (%s, %s, %s, %s, %s, %s, %s)",
                        (companyid, companyname, code, *values),
                    )
                    existing_codes.add(code)
                else:
                    if code not in existing_codes:
                        raise ValueError(f"품목을 찾을 수 없거나 회사 정보가 변경되었습니다: {code}")
                    cursor.execute(
                        """
                        UPDATE ItemCode01t SET
                            itemname = %s, itemtypecode = %s,
                            use_yn = %s, description = %s, updated_at = CURRENT_TIMESTAMP
                        WHERE companyid = %s AND itemcode = %s
                        """,
                        (*values, companyid, code),
                    )
        return len(items)
    except (ValueError, IntegrityError):
        raise
    except Exception:
        logger.exception("Failed to save items")
        raise


def delete_items(companyid: str, itemcodes: list[str]) -> int:
    if not itemcodes:
        return 0
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            "DELETE FROM ItemCode01t WHERE companyid = %s AND itemcode = ANY(%s)",
            (companyid, itemcodes),
        )
        return cursor.rowcount
