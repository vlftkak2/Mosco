from fastapi import APIRouter, Depends, HTTPException

import security as security_module
from services.auth import userpassword as user_module


router = APIRouter(prefix="/passwordapi", tags=["login"])


@router.post("/change-password")
def change_password(
    data: user_module.PasswordRequest,
    user: dict = Depends(security_module.get_current_user),
):
    try:
        result = user_module.password_change(data, user["companyid"], user["email"])
    except user_module.PasswordChangeRateLimited as error:
        raise HTTPException(status_code=429, detail=str(error)) from error
    if not result["success"]:
        # 400: 입력 오류 (401 은 로그인 만료로 처리되므로 쓰지 않는다)
        raise HTTPException(status_code=400, detail=result["message"])
    security_module.invalidate_user_access_cache(user["companyid"], user["email"])
    session_id = result.pop("session_id")
    result["access_token"] = security_module.create_access_token({
        "user_email": user["email"],
        "user_company": user["companyid"],
        "user_companyname": user.get("companyname", ""),
        "user_name": user.get("username", ""),
        "session_id": session_id,
    })
    result["token_type"] = "bearer"
    return result
