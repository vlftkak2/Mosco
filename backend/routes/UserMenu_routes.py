from fastapi import APIRouter, Depends, HTTPException, Query, status

import Company as company_module
import UserMenu as user_menu_module
import security as security_module


router = APIRouter(prefix="/api/user-menu", tags=["user-menu"])


def require_menu_manager(user: dict = Depends(security_module.get_current_user)) -> dict:
    if user["companyid"] == "001" and company_module.is_master(user["companyid"], user["email"]):
        return {**user, "authority": "MASTER"}
    if company_module.is_submaster(user["companyid"], user["email"]):
        return {**user, "authority": "SUBMASTER"}
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="플랫폼 관리자 또는 고객사 관리자만 메뉴 권한을 관리할 수 있습니다.",
    )


def ensure_company_scope(user: dict, companyid: str):
    if user["authority"] == "SUBMASTER" and companyid != user["companyid"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="자기 회사의 사용자 메뉴 권한만 관리할 수 있습니다.",
        )


@router.get("/mine")
def get_my_permissions(user: dict = Depends(security_module.get_current_user)):
    return {
        "success": True,
        "menuids": user_menu_module.get_my_menuids(user["companyid"], user["email"]),
    }


@router.get("/companies")
def get_manageable_companies(user: dict = Depends(require_menu_manager)):
    return {
        "success": True,
        "items": user_menu_module.list_manageable_companies(
            user["companyid"], user["authority"] == "MASTER"
        ),
    }


@router.get("/users")
def get_manageable_users(
    companyid: str = Query(..., min_length=1, max_length=50),
    user: dict = Depends(require_menu_manager),
):
    ensure_company_scope(user, companyid)
    try:
        return {
            "success": True,
            **user_menu_module.list_manageable_users(companyid, user["authority"] == "MASTER"),
        }
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.get("/permissions")
def get_permissions(
    companyid: str = Query(..., min_length=1, max_length=50),
    useremail: str = Query(..., min_length=3, max_length=50),
    user: dict = Depends(require_menu_manager),
):
    ensure_company_scope(user, companyid)
    try:
        return {
            "success": True,
            **user_menu_module.get_user_menu_permissions(
                companyid, useremail, user["authority"] == "MASTER"
            ),
        }
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except PermissionError as error:
        raise HTTPException(status_code=403, detail=str(error)) from error


@router.put("/permissions")
def update_permissions(
    data: user_menu_module.UserMenuPermissionInput,
    user: dict = Depends(require_menu_manager),
):
    ensure_company_scope(user, data.companyid)
    try:
        return {
            "success": True,
            "item": user_menu_module.save_user_menu_permissions(
                data,
                user["email"],
                user["authority"] == "MASTER",
            ),
        }
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except PermissionError as error:
        raise HTTPException(status_code=403, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
