from fastapi import APIRouter, Depends, HTTPException, Query, status

from services.auth import User as user_module
import security as security_module


router = APIRouter(prefix="/api/company-users", tags=["company-users"], dependencies=[Depends(security_module.audit_platform_access)])


def require_account_manager(user: dict = Depends(security_module.get_current_user)) -> dict:
    """계정관리(COMPANY_USER_MANAGEMENT) 권한. 모스코 직원이면 전체 고객사, 다른 회사 직원이면 자기 회사만."""
    if security_module.has_menu(user, "COMPANY_USER_MANAGEMENT"):
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="계정관리 권한이 없습니다.")


def _limited(user: dict) -> bool:
    """모스코 MASTER 가 아니면 제한된 관리자: 일반 · 고객사 관리자 권한만 주고, 최종관리자 계정은 못 건드린다."""
    return not security_module.has_platform_admin_role(user)


def _other_company(user: dict, companyid: str) -> bool:
    return not security_module.is_platform_company(user) and companyid != user["companyid"]


@router.get("")
def get_company_users(
    companyid: str = Query(..., min_length=1, max_length=50),
    user: dict = Depends(require_account_manager),
):
    if _other_company(user, companyid):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="자기 회사 계정만 조회할 수 있습니다.")
    try:
        return {"success": True, **user_module.list_company_users(companyid)}
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.post("", status_code=status.HTTP_201_CREATED)
def create_company_user(data: user_module.UserCreateInput, user: dict = Depends(require_account_manager)):
    try:
        if _limited(user):
            # 다른 회사 계정 생성(= 그 회사에 접속할 비밀번호를 정하는 것)은 모스코 최종관리자만 한다
            if data.companyid != user["companyid"]:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="자기 회사에만 계정을 추가할 수 있습니다.")
            if data.authority not in {"USER", "SUBMASTER"}:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="고객사 관리자는 일반 사용자 · 고객사 관리자 권한만 줄 수 있습니다.")
            # 계정관리 메뉴만 받은 일반 사용자는 관리자(SUBMASTER) 계정을 만들 수 없다
            if data.authority == "SUBMASTER" and user.get("authority") != "SUBMASTER":
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="고객사 관리자(SUBMASTER) 계정은 고객사 관리자만 만들 수 있습니다.")
            data = data.model_copy(update={"companyname": ""})
        item = user_module.create_user(data, created_by=user["email"])
        return {
            "success": True,
            "item": item,
        }
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.put("")
def update_company_user(data: user_module.UserUpdateInput, user: dict = Depends(require_account_manager)):
    try:
        if _other_company(user, data.companyid):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="자기 회사 계정만 수정할 수 있습니다.")
        item = user_module.update_user(data, actor=user if _limited(user) else None, actor_email=user.get("email"))
        security_module.invalidate_user_access_cache(data.companyid, data.original_email)
        security_module.invalidate_user_access_cache(data.companyid, data.email)
        return {
            "success": True,
            "item": item,
        }
    except PermissionError as error:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(error)) from error
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.delete("")
def delete_company_user(
    companyid: str = Query(..., min_length=1, max_length=50),
    email: str = Query(..., min_length=3, max_length=50),
    user: dict = Depends(require_account_manager),
):
    if user["email"].strip().lower() == email.strip().lower() and user["companyid"] == companyid:
        raise HTTPException(status_code=409, detail="현재 로그인한 관리자 계정은 삭제할 수 없습니다.")
    try:
        item = user_module.delete_user(
            companyid,
            email,
            actor=user if _limited(user) else None,
        )
        security_module.invalidate_user_access_cache(companyid, email)
        return {
            "success": True,
            "item": item,
        }
    except PermissionError as error:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(error)) from error
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
