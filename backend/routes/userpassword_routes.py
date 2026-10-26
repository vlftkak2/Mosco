from fastapi import APIRouter, Depends, HTTPException

import security as security_module
import userpassword as user_module


router = APIRouter(prefix="/passwordapi", tags=["login"])


@router.post("/change-password")
def change_password(
    data: user_module.PasswordRequest,
    user: dict = Depends(security_module.get_current_user),
):
    result = user_module.password_change(data, user["companyid"], user["email"])
    if not result["success"]:
        raise HTTPException(status_code=401, detail=result["message"])
    return result
