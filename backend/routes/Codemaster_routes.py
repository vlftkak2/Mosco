from typing import List

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from pydantic import BaseModel, Field, field_validator, model_validator

import CodeMaster as code_master_module
import security as security_module


# 공통코드 API의 URL 접두사와 OpenAPI 문서 그룹을 정의합니다.
router = APIRouter(
    prefix="/api/code-master",
    tags=["common-codes"],
    dependencies=[Depends(security_module.require_menu_access("DATA_CODE"))],
)


class CodeItemInput(BaseModel):
    """저장 요청에 포함되는 코드 한 건의 입력 형식과 필드 제약입니다."""
    code: str = Field(min_length=1, max_length=50)
    codename: str = Field(min_length=1, max_length=150)
    property: str = Field(default="", max_length=100)
    sortorder: int = Field(default=0, ge=0, le=2_147_483_647)
    use: bool = True
    description: str = Field(default="", max_length=500)
    is_new: bool = False

    @field_validator("code", "codename", "property", "description")
    @classmethod
    def strip_text(cls, value: str) -> str:
        """문자열 앞뒤 공백을 제거해 공백 차이로 값이 달라지는 것을 막습니다."""
        return value.strip()

    @model_validator(mode="after")
    def require_nonempty_values(self):
        """공백 제거 후 코드와 코드명이 비어 있지 않은지 확인합니다."""
        if not self.code or not self.codename:
            raise ValueError("코드와 코드명은 필수입니다.")
        return self


class CodeGroupSaveRequest(BaseModel):
    """그룹 항목 저장 요청입니다. 한 번에 최대 1000개를 받습니다."""
    items: List[CodeItemInput] = Field(max_length=1000)

    @model_validator(mode="after")
    def require_unique_codes(self):
        """같은 저장 묶음 안에서 코드 중복을 거부합니다."""
        codes = [item.code for item in self.items]
        if len(codes) != len(set(codes)):
            raise ValueError("같은 그룹 안에 중복된 코드가 있습니다.")
        if len({item.code for item in self.items if item.is_new}) != sum(item.is_new for item in self.items):
            raise ValueError("새 코드의 코드값이 중복되었습니다.")
        return self


class CodeBulkItemInput(BaseModel):
    groupcode: str = Field(min_length=1, max_length=50)
    code: str = Field(default="", max_length=50)
    codename: str = Field(min_length=1, max_length=150)
    property: str = Field(default="", max_length=100)
    sortorder: int = Field(default=0, ge=0, le=2_147_483_647)
    use: bool = True
    description: str = Field(default="", max_length=500)

    @field_validator("groupcode", "code", "codename", "property", "description")
    @classmethod
    def strip_bulk_text(cls, value: str) -> str:
        return value.strip()

    @field_validator("codename")
    @classmethod
    def require_bulk_name(cls, value: str) -> str:
        if not value:
            raise ValueError("코드명은 필수입니다.")
        return value


class CodeBulkSaveRequest(BaseModel):
    items: List[CodeBulkItemInput] = Field(min_length=1, max_length=10000)

    @model_validator(mode="after")
    def require_unique_group_codes(self):
        keys = [(item.groupcode.strip(), item.code) for item in self.items if item.code]
        if len(keys) != len(set(keys)):
            raise ValueError("업로드 파일에 그룹 내 중복 코드가 있습니다.")
        return self


class CodeDeleteRequest(BaseModel):
    """선택 삭제 요청의 코드 목록 형식입니다."""
    codes: List[str] = Field(min_length=1, max_length=1000)

    @field_validator("codes")
    @classmethod
    def normalize_codes(cls, codes: list[str]) -> list[str]:
        """빈 코드, 길이 초과, 중복 코드를 DB 작업 전에 거릅니다."""
        normalized = [code.strip() for code in codes]
        if any(not code or len(code) > 50 for code in normalized):
            raise ValueError("삭제할 코드값을 확인해 주세요.")
        if len(normalized) != len(set(normalized)):
            raise ValueError("삭제 요청에 중복 코드가 있습니다.")
        return normalized


def _database_error(error: Exception) -> HTTPException:
    """DB 예외 상세는 숨기고 API 공통 500 오류로 변환합니다."""
    return HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="공통코드 데이터베이스 처리 중 오류가 발생했습니다.",
    )


def _require_fixed_group(groupcode: str) -> str:
    """허용된 고정 그룹인지 확인하고 화면 표시용 그룹명을 반환합니다."""
    groupname = code_master_module.GROUP_NAMES.get(groupcode.strip())
    if groupname is None:
        raise HTTPException(status_code=404, detail="정의되지 않은 공통코드 그룹입니다.")
    return groupname


@router.get("/groups")
def get_code_groups(user: dict = Depends(security_module.get_current_user)):
    """로그인 사용자의 회사에 속한 코드 그룹과 항목 목록을 조회합니다."""
    # 토큰의 회사 코드로 범위를 제한해 다른 회사 데이터가 섞이지 않게 합니다.
    try:
        groups = code_master_module.list_groups(user["companyid"])
    except code_master_module.CodeMasterDatabaseError as error:
        raise _database_error(error) from error
    return {"success": True, "groups": groups}


@router.get("/groups/summary")
def get_code_group_summaries(user: dict = Depends(security_module.get_current_user)):
    """Return company-scoped group counts without loading their code rows."""
    try:
        groups = code_master_module.list_group_summaries(user["companyid"])
    except code_master_module.CodeMasterDatabaseError as error:
        raise _database_error(error) from error
    return {"success": True, "groups": groups}


@router.get("/groups/{groupcode}/items")
def get_code_group_items(
    groupcode: str = Path(min_length=1, max_length=50),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=15, ge=1, le=200),
    q: str = Query(default="", max_length=100),
    include_total: bool = Query(default=True),
    user: dict = Depends(security_module.get_current_user),
):
    """Return one company-scoped page, optionally filtered by code/name."""
    groupcode = groupcode.strip()
    _require_fixed_group(groupcode)
    try:
        result = code_master_module.list_group_items(user["companyid"], groupcode, page, page_size, q, include_total)
    except code_master_module.CodeMasterDatabaseError as error:
        raise _database_error(error) from error
    return {"success": True, **result}


@router.put("/groups/{groupcode}")
def save_code_group(
    data: CodeGroupSaveRequest,
    groupcode: str = Path(min_length=1, max_length=50),
    user: dict = Depends(security_module.get_current_user),
):
    """선택한 그룹의 행을 생성하거나 갱신하고 저장 후 그룹을 반환합니다."""
    groupcode = groupcode.strip()
    groupname = _require_fixed_group(groupcode)
    try:
        saved = code_master_module.save_group(
            companyid=user["companyid"],
            companyname=user.get("companyname") or user["companyid"],
            groupcode=groupcode,
            items=[item.model_dump() for item in data.items],
        )
        if not saved:
            raise HTTPException(status_code=404, detail="공통코드 그룹을 찾을 수 없습니다.")
        groups = code_master_module.list_group_summaries(user["companyid"])
    except code_master_module.CodeMasterConflictError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except code_master_module.CodeMasterDatabaseError as error:
        raise _database_error(error) from error
    saved_group = next((group for group in groups if group["groupcode"] == groupcode), None)
    return {"success": True, "group": saved_group, "groupname": groupname}


@router.post("/bulk")
def save_bulk_codes(
    data: CodeBulkSaveRequest,
    user: dict = Depends(security_module.get_current_user),
):
    """Validate and insert every item in one database transaction."""
    try:
        inserted_count = code_master_module.save_bulk_items(
            companyid=user["companyid"],
            companyname=user.get("companyname") or user["companyid"],
            items=[item.model_dump() for item in data.items],
        )
    except code_master_module.CodeMasterConflictError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except code_master_module.CodeMasterDatabaseError as error:
        raise _database_error(error) from error
    return {"success": True, "inserted_count": inserted_count}


@router.delete("/groups/{groupcode}/items/{code}")
def delete_code(
    groupcode: str = Path(min_length=1, max_length=50),
    code: str = Path(min_length=1, max_length=50),
    user: dict = Depends(security_module.get_current_user),
):
    """인증 사용자의 회사와 지정 그룹 범위에서 코드 한 건을 삭제합니다."""
    groupcode = groupcode.strip()
    code = code.strip()
    _require_fixed_group(groupcode)
    try:
        deleted = code_master_module.delete_code(user["companyid"], groupcode, code)
    except code_master_module.CodeMasterConflictError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except code_master_module.CodeMasterDatabaseError as error:
        raise _database_error(error) from error
    if not deleted:
        raise HTTPException(status_code=404, detail="공통코드를 찾을 수 없습니다.")
    return {"success": True, "message": "코드를 삭제했습니다."}


@router.post("/groups/{groupcode}/items/delete")
def delete_selected_codes(
    data: CodeDeleteRequest,
    groupcode: str = Path(min_length=1, max_length=50),
    user: dict = Depends(security_module.get_current_user),
):
    """한 그룹에서 여러 코드를 삭제하고 실제 삭제 건수를 반환합니다."""
    # 일괄 삭제 역시 토큰 회사와 고정 그룹으로 범위를 제한합니다.
    groupcode = groupcode.strip()
    _require_fixed_group(groupcode)
    try:
        deleted_count = code_master_module.delete_codes(user["companyid"], groupcode, data.codes)
    except code_master_module.CodeMasterConflictError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except code_master_module.CodeMasterDatabaseError as error:
        raise _database_error(error) from error
    if deleted_count == 0:
        raise HTTPException(status_code=404, detail="삭제할 공통코드를 찾을 수 없습니다.")
    return {"success": True, "deleted_count": deleted_count}
