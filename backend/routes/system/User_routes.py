"""사용자관리 API (메뉴: USER_MANAGEMENT) — 자기 회사 사용자의 인사 기본정보를 조회 · 저장한다 (services/system/User.py)."""
from fastapi import APIRouter, Depends, HTTPException, Query, status

import security as security_module
from services.system import User as user_module


def require_user_management(user: dict = Depends(security_module.get_current_user)) -> dict:
    # 관리자(고객사 관리자 · 플랫폼 관리자)는 메뉴 권한 없이도, 그 밖에는 메뉴 권한을 받은 계정만
    if not user_module.can_use_menu(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="이 메뉴에 접근할 권한이 없습니다.")
    return user


router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("")
def list_users(
    keyword: str = Query("", max_length=100),
    useyn: str = Query("", pattern="^(|Y|N)$"),
    user: dict = Depends(require_user_management),
):
    return {"success": True, **user_module.list_users(user, keyword.strip(), useyn)}


@router.get("/detail")
def get_user(email: str = Query(..., min_length=3, max_length=50), user: dict = Depends(require_user_management)):
    try:
        return {"success": True, "item": user_module.get_user(user, email.strip())}
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.put("")
def update_user(data: user_module.UserInfoInput, user: dict = Depends(require_user_management)):
    try:
        return {"success": True, "item": user_module.update_user(user, data)}
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
