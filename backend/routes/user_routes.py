from fastapi import APIRouter, Depends, HTTPException, Query, status

import User as user_module
import security as security_module


router = APIRouter(prefix="/api/company-users", tags=["company-users"])


def require_account_manager(user: dict = Depends(security_module.get_current_user)) -> dict:
    if user["companyid"] == "001" and user["authority"] == "MASTER":
        return user
    if user["companyid"] != "001" and user["authority"] == "SUBMASTER":
        return user
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="플랫폼 관리자만 고객사 계정을 관리할 수 있습니다.",
    )


@router.get("")
def get_company_users(
    companyid: str = Query(..., min_length=1, max_length=50),
    user: dict = Depends(require_account_manager),
):
    if user["authority"] == "SUBMASTER" and companyid != user["companyid"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only view users in your own company.")
    try:
        return {"success": True, **user_module.list_company_users(companyid)}
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.post("", status_code=status.HTTP_201_CREATED)
def create_company_user(data: user_module.UserCreateInput, user: dict = Depends(require_account_manager)):
    try:
        if user["authority"] == "SUBMASTER":
            if data.companyid != user["companyid"]:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only add users to your own company.")
            if data.authority not in {"USER", "SUBMASTER"}:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Customer administrators can assign only USER or SUBMASTER authority.")
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
        if user["authority"] == "SUBMASTER" and data.companyid != user["companyid"]:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only update accounts in your own company.")
        item = user_module.update_user(data, actor=user if user["authority"] == "SUBMASTER" else None)
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
            actor=user if user["authority"] == "SUBMASTER" else None,
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
