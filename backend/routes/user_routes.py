from fastapi import APIRouter, Depends, HTTPException, Query, status

import Company as company_module
import User as user_module
import security as security_module


router = APIRouter(prefix="/api/company-users", tags=["company-users"])


def require_platform_admin(user: dict = Depends(security_module.get_current_user)) -> dict:
    if user["companyid"] != "001" or not company_module.is_master(user["companyid"], user["email"]):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Steel119 최종관리자만 고객사 계정을 관리할 수 있습니다.",
        )
    return user


@router.get("")
def get_company_users(
    companyid: str = Query(..., min_length=1, max_length=50),
    user: dict = Depends(require_platform_admin),
):
    del user
    try:
        return {"success": True, **user_module.list_company_users(companyid)}
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.post("", status_code=status.HTTP_201_CREATED)
def create_company_user(data: user_module.UserCreateInput, user: dict = Depends(require_platform_admin)):
    del user
    try:
        return {"success": True, "item": user_module.create_user(data)}
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.put("")
def update_company_user(data: user_module.UserUpdateInput, user: dict = Depends(require_platform_admin)):
    del user
    try:
        return {"success": True, "item": user_module.update_user(data)}
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.delete("")
def delete_company_user(
    companyid: str = Query(..., min_length=1, max_length=50),
    email: str = Query(..., min_length=3, max_length=50),
    user: dict = Depends(require_platform_admin),
):
    if user["companyid"] == companyid and user["email"].strip().lower() == email.strip().lower():
        raise HTTPException(status_code=409, detail="현재 로그인한 최종관리자 계정은 삭제할 수 없습니다.")
    try:
        return {"success": True, "item": user_module.delete_user(companyid, email)}
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
