"""사업장관리 (메뉴: WORKPLACE_MANAGEMENT).

회사(법인) 1개 = 사업장 1개 → company01t 의 자기 회사 한 줄을 읽고 고친다.
요금제(plan_code) · 이용상태(company_status) · 허용계정(licensed_seats)은 플랫폼 관리자 전용이라 여기서 다루지 않는다.
시스템 시작일 = ledgerstartdate (거래처원장 시작일과 같은 칸): 이 날짜 이전은 전기이월(거래처 기초잔액)로 본다.
회사명(companyname)은 고객사등록에서 정한 값을 그대로 보여주기만 하고 여기서는 고치지 않는다.
직인 · 회사 로고 · 사업자등록증은 company01t 의 BYTEA 칸에 저장하고 화면에는 data URL 과 파일 이름으로 내려준다.
(직인 · 로고 500KB, 사업자등록증 2MB 이하 · JPG · PNG)
"""
import base64
import re
from datetime import date

from pydantic import BaseModel, Field, field_validator, model_validator

import db as _db

_DIGITS = re.compile(r"\D")


def valid_businessno(value: str) -> bool:
    """사업자등록번호 10자리 검증번호 확인 (국세청 규칙)."""
    digits = _DIGITS.sub("", value or "")
    if len(digits) != 10:
        return False
    weights = [1, 3, 7, 1, 3, 7, 1, 3, 5]
    total = sum(int(d) * w for d, w in zip(digits[:9], weights))
    total += (int(digits[8]) * 5) // 10
    return (10 - total % 10) % 10 == int(digits[9])


def valid_corporationno(value: str) -> bool:
    """법인등록번호 13자리 검증번호 확인."""
    digits = _DIGITS.sub("", value or "")
    if len(digits) != 13:
        return False
    total = sum(int(d) * (1 if i % 2 == 0 else 2) for i, d in enumerate(digits[:12]))
    return (10 - total % 10) % 10 == int(digits[12])


def _format(value: str, cuts: tuple[int, ...]) -> str:
    digits = _DIGITS.sub("", value or "")
    parts, start = [], 0
    for cut in cuts:
        parts.append(digits[start:cut])
        start = cut
    parts.append(digits[start:])
    return "-".join(part for part in parts if part)


IMAGE_TYPES = {"image/png", "image/jpeg"}
# 종류: (이미지 칸, 형식 칸, 파일 이름 칸, 화면 이름, 최대 크기)
IMAGE_KINDS = {
    "stamp": ("stampimage", "stampmime", "stampname", "직인", 500 * 1024),
    "logo": ("logoimage", "logomime", "logoname", "회사 로고", 500 * 1024),
    "bizcert": ("bizcertimage", "bizcertmime", "bizcertname", "사업자등록증", 2 * 1024 * 1024),
}
IMAGE_MAX_BYTES = max(kind[4] for kind in IMAGE_KINDS.values())


def image_data_url(image, mime) -> str | None:
    if not image:
        return None
    return f"data:{mime or 'image/png'};base64,{base64.b64encode(bytes(image)).decode('ascii')}"


class WorkplaceInput(BaseModel):
    ceoname: str = Field(min_length=1, max_length=100)
    ownertype: str = "CORP"
    businessno: str = Field(min_length=1, max_length=20)
    corporationno: str = Field(default="", max_length=20)
    businesstype: str = Field(default="", max_length=100)
    industry: str = Field(default="", max_length=100)
    openingdate: date | None = None
    ledgerstartdate: date
    phone: str = Field(default="", max_length=30)
    zipcode: str = Field(default="", max_length=10)
    address1: str = Field(default="", max_length=300)
    address2: str = Field(default="", max_length=300)

    @field_validator("ceoname", "businessno", "corporationno", "businesstype", "industry",
                     "phone", "zipcode", "address1", "address2", mode="before")
    @classmethod
    def strip_text(cls, value):
        return str(value or "").strip()

    @field_validator("openingdate", mode="before")
    @classmethod
    def blank_date(cls, value):
        return None if value in (None, "") else value

    @field_validator("ownertype", mode="before")
    @classmethod
    def validate_owner(cls, value):
        value = str(value or "CORP").strip().upper()
        if value not in {"CORP", "INDIV"}:
            raise ValueError("사업자 유형은 법인사업자 또는 개인사업자만 선택할 수 있습니다.")
        return value

    @model_validator(mode="after")
    def check_numbers(self):
        if not valid_businessno(self.businessno):
            raise ValueError("사업자등록번호가 올바르지 않습니다. 번호를 다시 확인해 주세요.")
        self.businessno = _format(self.businessno, (3, 5))
        if self.ownertype == "CORP":
            if not self.corporationno:
                raise ValueError("법인사업자는 법인등록번호를 입력해 주세요.")
            if not valid_corporationno(self.corporationno):
                raise ValueError("법인등록번호가 올바르지 않습니다. 번호를 다시 확인해 주세요.")
            self.corporationno = _format(self.corporationno, (6,))
        else:
            self.corporationno = ""
        return self


FIELDS = ["ceoname", "ownertype", "businessno", "corporationno", "businesstype", "industry",
          "openingdate", "ledgerstartdate", "phone", "zipcode", "address1", "address2"]


def get_workplace(companyid: str) -> dict | None:
    with _db.connect() as connection, connection.cursor() as cursor:
        image_columns = ", ".join(f"{image}, {mime}, {name}" for image, mime, name, _label, _max in IMAGE_KINDS.values())
        cursor.execute(f"SELECT companyid, companyname, {', '.join(FIELDS)}, {image_columns}, updatedat, updated_by "
                       "FROM company01t WHERE companyid = %s", (companyid,))
        row = cursor.fetchone()
        if not row:
            return None
        item = dict(zip([column[0] for column in cursor.description], row))
    for key in FIELDS:
        if key not in {"openingdate", "ledgerstartdate"}:
            item[key] = item.get(key) or ""
    item["ownertype"] = item["ownertype"] or "CORP"
    for kind, (image, mime, name, _label, _max) in IMAGE_KINDS.items():
        item[kind] = image_data_url(item.pop(image), item.pop(mime))
        item[f"{kind}name"] = item.pop(name) or ""
    return item


def update_workplace(companyid: str, data: WorkplaceInput, actor: str | None) -> dict:
    values = data.model_dump()
    keep_blank = {"ceoname", "ownertype", "businessno", "ledgerstartdate"}
    params = [values[key] if key in keep_blank else (values[key] or None) for key in FIELDS]
    with _db.connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            f"UPDATE company01t SET {', '.join(f'{key} = %s' for key in FIELDS)}, updatedat = NOW(), updated_by = %s WHERE companyid = %s",
            params + [actor, companyid],
        )
        if cursor.rowcount != 1:
            raise LookupError("회사 정보를 찾을 수 없습니다.")
    return get_workplace(companyid)


def set_image(companyid: str, kind: str, content: bytes, mime: str, actor: str | None, filename: str = "") -> dict:
    image_column, mime_column, name_column, label, max_bytes = IMAGE_KINDS[kind]
    mime = (mime or "").lower()
    if mime not in IMAGE_TYPES:
        raise ValueError(f"{label}은(는) JPG · PNG 이미지만 올릴 수 있습니다.")
    if not content:
        raise ValueError("빈 파일입니다.")
    if len(content) > max_bytes:
        raise ValueError(f"{label} 이미지는 {max_bytes // 1024 // 1024}MB 이하로 올려 주세요." if max_bytes >= 1024 * 1024
                         else f"{label} 이미지는 {max_bytes // 1024}KB 이하로 올려 주세요.")
    name = (filename or "").rsplit("/", 1)[-1].rsplit("\\", 1)[-1][:255]
    with _db.connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            f"UPDATE company01t SET {image_column} = %s, {mime_column} = %s, {name_column} = %s, updatedat = NOW(), updated_by = %s WHERE companyid = %s",
            (content, mime, name or None, actor, companyid),
        )
    return get_workplace(companyid)


def delete_image(companyid: str, kind: str, actor: str | None) -> dict:
    image_column, mime_column, name_column, _label, _max = IMAGE_KINDS[kind]
    with _db.connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            f"UPDATE company01t SET {image_column} = NULL, {mime_column} = NULL, {name_column} = NULL, updatedat = NOW(), updated_by = %s WHERE companyid = %s",
            (actor, companyid),
        )
    return get_workplace(companyid)
