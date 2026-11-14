import logging

from psycopg2 import IntegrityError
import db as _shared_db
from services.masterdata import CodeUsage as code_usage_module
from pydantic import BaseModel, Field, field_validator, model_validator


logger = logging.getLogger(__name__)

# Connections come from the single shared pool (backend/db.py).
_connect = _shared_db.connect


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
        if self.is_new and not self.itemtypecode:
            raise ValueError("신규 품목의 형태구분은 필수입니다.")
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


class ItemLookupRequest(BaseModel):
    itemcodes: list[str] = Field(min_length=1, max_length=10000)

    @field_validator("itemcodes")
    @classmethod
    def normalize_itemcodes(cls, values: list[str]) -> list[str]:
        normalized = list(dict.fromkeys(value.strip() for value in values if value.strip()))
        if not normalized:
            raise ValueError("조회할 품목코드가 없습니다.")
        if any(len(value) > 100 for value in normalized):
            raise ValueError("품목코드는 100자 이내로 입력해 주세요.")
        return normalized


_SELECT_COLUMNS = """
    itemcode, itemname, itemtypecode, itemtypecodenm, use_yn, description
"""


def _row_to_item(row):
    keys = (
        "itemcode", "itemname", "itemtypecode", "itemtypecodenm", "use_yn", "description",
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
            f"""
            SELECT {_SELECT_COLUMNS},
                   COALESCE((SELECT u.username FROM user01t u WHERE u.email = ItemCode01t.created_by LIMIT 1), created_by),
                   COALESCE((SELECT u.username FROM user01t u WHERE u.email = ItemCode01t.updated_by LIMIT 1), updated_by)
            FROM ItemCode01t WHERE {where} ORDER BY itemcode
            """,
            params,
        )
        items = []
        for row in cursor.fetchall():
            item = _row_to_item(row[:-2])
            item["created_by"] = row[-2] or ""
            item["updated_by"] = row[-1] or ""
            items.append(item)
        return items


def lookup_items(companyid: str, itemcodes: list[str]):
    if not itemcodes:
        return []
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            "SELECT itemcode, itemname FROM ItemCode01t WHERE companyid = %s AND UPPER(BTRIM(use_yn)) = 'Y' AND itemcode = ANY(%s)",
            (companyid, itemcodes),
        )
        return [{"itemcode": code, "itemname": name} for code, name in cursor.fetchall()]


def search_active_items(companyid: str, query: str, page: int, page_size: int, field: str = "all"):
    search = query.strip()
    where = "companyid = %s AND UPPER(BTRIM(use_yn)) = 'Y'"
    params: list = [companyid]
    if search:
        pattern = f"%{search}%"
        if field == "code":
            where += " AND itemcode ILIKE %s"
            params.append(pattern)
        elif field == "name":
            where += " AND itemname ILIKE %s"
            params.append(pattern)
        elif field == "material":
            where += " AND (itemtypecode ILIKE %s OR itemtypecodenm ILIKE %s)"
            params.extend((pattern, pattern))
        else:
            where += " AND (itemcode ILIKE %s OR itemname ILIKE %s OR itemtypecode ILIKE %s OR itemtypecodenm ILIKE %s)"
            params.extend((pattern, pattern, pattern, pattern))
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(f"SELECT COUNT(*) FROM ItemCode01t WHERE {where}", params)
        total = cursor.fetchone()[0]
        cursor.execute(
            f"SELECT itemcode, itemname, COALESCE(itemtypecode, ''), COALESCE(itemtypecodenm, '') FROM ItemCode01t WHERE {where} ORDER BY itemcode LIMIT %s OFFSET %s",
            (*params, page_size, (page - 1) * page_size),
        )
        items = [
            {"itemcode": row[0], "itemname": row[1], "itemtypecode": row[2], "itemtypecodenm": row[3]}
            for row in cursor.fetchall()
        ]
    return {"items": items, "total": total, "page": page, "page_size": page_size}


def suggest_active_items(companyid: str, query: str, limit: int = 8):
    search = query.strip()
    if not search:
        return []
    pattern = f"%{search}%"
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """SELECT itemcode, itemname, COALESCE(itemtypecode, ''), COALESCE(itemtypecodenm, '')
               FROM ItemCode01t
               WHERE companyid = %s AND UPPER(BTRIM(use_yn)) = 'Y'
                 AND (itemcode ILIKE %s OR itemname ILIKE %s
                      OR itemtypecode ILIKE %s OR itemtypecodenm ILIKE %s)
               ORDER BY
                 CASE
                   WHEN LOWER(BTRIM(itemcode)) = LOWER(%s) THEN 0
                   WHEN LOWER(BTRIM(itemname)) = LOWER(%s) THEN 1
                   WHEN LOWER(BTRIM(itemcode)) LIKE LOWER(%s) THEN 2
                   WHEN LOWER(BTRIM(itemname)) LIKE LOWER(%s) THEN 3
                   WHEN LOWER(BTRIM(itemtypecodenm)) = LOWER(%s) OR LOWER(BTRIM(itemtypecode)) = LOWER(%s) THEN 4
                   WHEN LOWER(BTRIM(itemtypecodenm)) LIKE LOWER(%s) OR LOWER(BTRIM(itemtypecode)) LIKE LOWER(%s) THEN 5
                   ELSE 6
                 END,
                 itemcode
               LIMIT %s""",
            (companyid, pattern, pattern, pattern, pattern,
             search, search, f"{search}%", f"{search}%", search, search,
             f"{search}%", f"{search}%", min(max(int(limit), 1), 8)),
        )
        return [
            {"itemcode": code, "itemname": name, "itemtypecode": type_code, "itemtypecodenm": type_name}
            for code, name, type_code, type_name in cursor.fetchall()
        ]


def save_items(companyid: str, companyname: str, items: list[dict], actor: str | None = None) -> int:
    try:
        with _connect() as connection, connection.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"item:{companyid}",))
            codes = [item["itemcode"] for item in items]
            cursor.execute(
                "SELECT itemcode, COALESCE(itemtypecode, ''), COALESCE(itemtypecodenm, '') "
                "FROM ItemCode01t WHERE companyid = %s AND itemcode = ANY(%s) FOR UPDATE",
                (companyid, codes),
            )
            existing_rows = cursor.fetchall()
            existing_shapes = {row[0]: row[1].strip() for row in existing_rows}
            existing_shape_names = {row[0]: row[2].strip() for row in existing_rows}

            for item in items:
                code = item["itemcode"]
                shape_code = str(item.get("itemtypecode") or "").strip()
                previous_shape = existing_shapes.get(code)
                if not shape_code and (item.get("is_new") or previous_shape):
                    raise ValueError(f"품목 {code}의 형태구분은 필수입니다.")

            shape_codes = {
                str(item.get("itemtypecode") or "").strip()
                for item in items
                if str(item.get("itemtypecode") or "").strip()
            }
            shape_names = {}
            active_shape_codes = set()
            if shape_codes:
                cursor.execute(
                    """
                    SELECT code, code_name, UPPER(TRIM(use_yn)) = 'Y'
                    FROM CodeMaster01t
                    WHERE companyid = %s AND groupcode = 'SHAPE' AND code = ANY(%s)
                    FOR SHARE
                    """,
                    (companyid, list(shape_codes)),
                )
                for code, code_name, is_active in cursor.fetchall():
                    shape_names[code] = code_name
                    if is_active:
                        active_shape_codes.add(code)

            for item in items:
                code = item["itemcode"]
                shape_code = str(item.get("itemtypecode") or "").strip()
                previous_shape = existing_shapes.get(code)
                if not shape_code:
                    if item.get("is_new") or previous_shape:
                        raise ValueError(f"품목 {code}의 형태구분은 필수입니다.")
                elif shape_code != previous_shape and shape_code not in active_shape_codes:
                    raise ValueError(f"품목 {code}의 형태구분이 등록되지 않았거나 사용중지 상태입니다: {shape_code}")

                values = (
                    item["itemname"], shape_code or None,
                    shape_names.get(shape_code, existing_shape_names.get(code, "")) or None,
                    item["use_yn"],
                    item.get("description") or None,
                )
                if item.get("is_new"):
                    if code in existing_shapes:
                        raise ValueError(f"이미 등록된 품목코드입니다: {code}")
                    cursor.execute(
                        f"INSERT INTO ItemCode01t (companyid, companyname, {_SELECT_COLUMNS}, created_by) "
                        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
                        (companyid, companyname, code, *values, actor or None),
                    )
                    existing_shapes[code] = shape_code
                    existing_shape_names[code] = values[2] or ""
                else:
                    if code not in existing_shapes:
                        raise ValueError(f"품목을 찾을 수 없거나 회사 정보가 변경되었습니다: {code}")
                    cursor.execute(
                        """
                        UPDATE ItemCode01t SET
                            itemname = %s, itemtypecode = %s, itemtypecodenm = %s,
                            use_yn = %s, description = %s, updated_at = CURRENT_TIMESTAMP,
                            updated_by = %s
                        WHERE companyid = %s AND itemcode = %s
                        """,
                        (*values, actor or None, companyid, code),
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
        # Items still used by stock / documents cannot be deleted (switch them to 사용중지 instead).
        usage_error = code_usage_module.item_code_usage_error(cursor, companyid, itemcodes)
        if usage_error:
            raise ValueError(usage_error)
        cursor.execute(
            "DELETE FROM ItemCode01t WHERE companyid = %s AND itemcode = ANY(%s)",
            (companyid, itemcodes),
        )
        return cursor.rowcount
