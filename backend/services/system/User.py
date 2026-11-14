"""사용자관리 (메뉴: USER_MANAGEMENT) — 로그인한 회사 사용자들의 인사 기본정보를 입력한다.

계정 등록 · 삭제 · 권한 · 비밀번호 · 사용여부는 어드민 > 고객사관리(services/auth/User.py)에서 하고, 여기서는 다루지 않는다.
여기서 저장하는 칸: 사원번호 · 근무유형 · 부서 · 직급 · 생년월일 · 휴대폰 · 입사일 · 퇴사일 · 사진.
  - 쓸 수 있는 사람: 고객사 관리자(SUBMASTER) · 플랫폼 관리자(001 MASTER)는 항상, 그 밖에는 메뉴 권한을 받은 계정.
  - 자기 회사(companyid) 계정만 조회 · 수정한다.
  - 사진은 user01t.photoimage(BYTEA)에 저장하고, 화면에는 상세 조회 때만 data URL 로 내려준다 (목록에는 싣지 않는다).
"""
import base64
import binascii
import re
from datetime import date

from psycopg2 import errors as pg_errors
from psycopg2.extras import RealDictCursor
from pydantic import BaseModel, Field, field_validator, model_validator

import db

PLATFORM_COMPANY = "001"
MENU_ID = "USER_MANAGEMENT"
PHOTO_TYPES = {"image/png", "image/jpeg"}
PHOTO_MAX_BYTES = 500 * 1024
_DATA_URL = re.compile(r"^data:(image/(?:png|jpeg));base64,(.+)$", re.S)
_MOBILE = re.compile(r"^01\d-\d{3,4}-\d{4}$")

# 목록 · 상세 공통 칸 (사진 제외)
_FIELDS_SQL = """username, email, COALESCE(empno, '') AS empno, COALESCE(team, '') AS team,
       COALESCE(position, '') AS position, COALESCE(worktype, 'REGULAR') AS worktype,
       birthdate, COALESCE(mobile, '') AS mobile,
       hiredate, retiredate,
       CASE WHEN retiredate IS NOT NULL AND retiredate <= CURRENT_DATE THEN 'RETIRED' ELSE 'ACTIVE' END AS workstatus,
       UPPER(COALESCE(useyn, 'N')) AS useyn"""


class UserInfoInput(BaseModel):
    email: str = Field(min_length=3, max_length=50)
    empno: str = Field(default="", max_length=20)
    team: str = Field(default="", max_length=50)
    position: str = Field(default="", max_length=30)
    worktype: str = "REGULAR"
    birthdate: date | None = None
    mobile: str = Field(default="", max_length=20)
    hiredate: date | None = None
    retiredate: date | None = None
    # 사진: None = 그대로 둔다, "" = 지운다, "data:image/...;base64,..." = 바꾼다
    photo: str | None = None

    @field_validator("email", "empno", "team", "position", "mobile", mode="before")
    @classmethod
    def strip_text(cls, value):
        return str(value or "").strip()

    @field_validator("birthdate", "hiredate", "retiredate", mode="before")
    @classmethod
    def blank_date(cls, value):
        return value or None

    @field_validator("worktype")
    @classmethod
    def check_worktype(cls, value):
        value = str(value or "").strip().upper()
        if value not in {"REGULAR", "CONTRACT"}:
            raise ValueError("근무유형은 정규직 또는 계약직만 선택할 수 있습니다.")
        return value

    @field_validator("mobile")
    @classmethod
    def check_mobile(cls, value):
        if value and not _MOBILE.fullmatch(value):
            raise ValueError("휴대폰번호는 010-0000-0000 형식으로 입력해 주세요.")
        return value

    @model_validator(mode="after")
    def check_dates(self):
        if self.hiredate and self.retiredate and self.retiredate < self.hiredate:
            raise ValueError("퇴사일은 입사일보다 빠를 수 없습니다.")
        if self.birthdate and self.birthdate > date.today():
            raise ValueError("생년월일이 오늘보다 늦습니다.")
        return self


def can_use_menu(user: dict) -> bool:
    authority = str(user.get("authority") or "").upper()
    if authority == "SUBMASTER" and user.get("companyid") != PLATFORM_COMPANY:
        return True
    if authority == "MASTER" and user.get("companyid") == PLATFORM_COMPANY:
        return True
    return MENU_ID in user.get("menuids", ())


def _decode_photo(value: str) -> tuple[bytes, str]:
    match = _DATA_URL.match(value)
    if not match:
        raise ValueError("사진은 JPG · PNG 이미지만 올릴 수 있습니다.")
    try:
        content = base64.b64decode(match.group(2), validate=True)
    except (binascii.Error, ValueError) as error:
        raise ValueError("사진 파일을 읽지 못했습니다.") from error
    if not content:
        raise ValueError("빈 파일입니다.")
    if len(content) > PHOTO_MAX_BYTES:
        raise ValueError("사진은 500KB 이하로 올려 주세요.")
    return content, match.group(1)


def list_users(user: dict, keyword: str = "", useyn: str = ""):
    where, params = ["companyid = %s"], [user["companyid"]]
    if keyword:
        where.append("(username ILIKE %s OR email ILIKE %s OR empno ILIKE %s OR team ILIKE %s OR position ILIKE %s)")
        params += [f"%{keyword}%"] * 5
    if useyn in {"Y", "N"}:
        where.append("UPPER(COALESCE(useyn, 'N')) = %s")
        params.append(useyn)
    with db.connect() as connection, connection.cursor(cursor_factory=RealDictCursor) as cursor:
        cursor.execute(
            f"""SELECT {_FIELDS_SQL}
                FROM user01t
                WHERE {' AND '.join(where)}
                ORDER BY empno IS NULL, empno, LOWER(username), LOWER(email)""",
            params,
        )
        return {"items": [dict(row) for row in cursor.fetchall()]}


def get_user(user: dict, email: str):
    with db.connect() as connection, connection.cursor(cursor_factory=RealDictCursor) as cursor:
        cursor.execute(
            f"""SELECT {_FIELDS_SQL}, photoimage, photomime
                FROM user01t WHERE companyid = %s AND LOWER(email) = LOWER(%s)""",
            (user["companyid"], email),
        )
        row = cursor.fetchone()
    if not row:
        raise LookupError("사용자 계정을 찾을 수 없습니다.")
    item = dict(row)
    image, mime = item.pop("photoimage"), item.pop("photomime")
    item["photo"] = f"data:{mime};base64,{base64.b64encode(bytes(image)).decode()}" if image and mime else ""
    return item


def update_user(user: dict, data: UserInfoInput):
    photo_sql, photo_params = "", []
    if data.photo is not None:
        if data.photo == "":
            photo_sql = ", photoimage = NULL, photomime = NULL"
        else:
            content, mime = _decode_photo(data.photo)
            photo_sql, photo_params = ", photoimage = %s, photomime = %s", [content, mime]
    try:
        with db.connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                f"""UPDATE user01t
                   SET empno = NULLIF(%s, ''), team = NULLIF(%s, ''), position = NULLIF(%s, ''),
                       worktype = %s,
                       birthdate = %s, mobile = NULLIF(%s, ''), hiredate = %s, retiredate = %s{photo_sql},
                       updatedat = CURRENT_TIMESTAMP, updated_by = %s
                   WHERE companyid = %s AND LOWER(email) = LOWER(%s)""",
                [data.empno, data.team, data.position, data.worktype, data.birthdate, data.mobile, data.hiredate, data.retiredate, *photo_params,
                 user.get("email"), user["companyid"], data.email],
            )
            if cursor.rowcount == 0:
                raise LookupError("사용자 계정을 찾을 수 없습니다.")
    except pg_errors.UniqueViolation as error:
        raise ValueError(f"사원번호 {data.empno} 은(는) 이미 다른 사용자가 쓰고 있습니다.") from error
    return get_user(user, data.email)
