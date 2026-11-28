from fastapi import APIRouter, Depends, HTTPException, Query, status

from services.auth import UserMenu as user_menu_module
import security as security_module


router = APIRouter(prefix="/api/user-menu", tags=["user-menu"], dependencies=[Depends(security_module.audit_platform_access)])


def require_menu_manager(user: dict = Depends(security_module.get_current_user)) -> dict:
    """메뉴권한관리(USER_MENU_PERMISSION) 권한. 모스코 직원이면 전체 고객사, 다른 회사 직원이면 자기 회사만."""
    if security_module.has_menu(user, "USER_MENU_PERMISSION"):
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="메뉴권한관리 권한이 없습니다.")


def ensure_company_scope(user: dict, companyid: str):
    if not security_module.is_platform_company(user) and companyid != user["companyid"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="자기 회사의 사용자 메뉴 권한만 관리할 수 있습니다.",
        )


@router.get("/mine")
def get_my_permissions(user: dict = Depends(security_module.get_current_user)):
    return {
        "success": True,
        "menuids": sorted(user["menuids"]),
        "authority": user["authority"],
        "companyid": user["companyid"],
        "username": user["username"],
        "companyname": user["companyname"],
    }


@router.get("/favorites")
def get_my_favorites(user: dict = Depends(security_module.get_current_user)):
    return {"success": True, "menuids": user_menu_module.get_menu_favorites(user["companyid"], user["email"])}


@router.put("/favorites")
def save_my_favorites(
    payload: user_menu_module.MenuFavoriteInput,
    user: dict = Depends(security_module.get_current_user),
):
    return {
        "success": True,
        "menuids": user_menu_module.save_menu_favorites(user["companyid"], user["email"], payload.menuids),
    }


@router.get("/companies")
def get_manageable_companies(user: dict = Depends(require_menu_manager)):
    return {
        "success": True,
        "items": user_menu_module.list_manageable_companies(
            user["companyid"], security_module.is_platform_company(user)
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
            **user_menu_module.list_manageable_users(companyid, security_module.is_platform_company(user)),
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
                companyid, useremail, security_module.is_platform_company(user)
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
        result = user_menu_module.save_user_menu_permissions(
            data,
            user["email"],
            security_module.is_platform_company(user),
            actor=user,
        )
        security_module.invalidate_user_access_cache(data.companyid, result["useremail"])
        return {
            "success": True,
            "item": result,
        }
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except PermissionError as error:
        raise HTTPException(status_code=403, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
