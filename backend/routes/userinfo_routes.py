from fastapi import APIRouter, Depends, HTTPException, status

# 모듈 임포트 (이름 충돌을 피하기 위해 as 사용)
#import backend.userpassword as user_module
import userinfo as userinfo_module
import User as company_user_module
import security as security_module

router = APIRouter(prefix="/api", tags=["user"])


def require_platform_admin(user: dict = Depends(security_module.get_current_user)) -> dict:
    if user["companyid"] != "001" or user["authority"] != "MASTER":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Steel119 최종관리자만 사용할 수 있습니다.")
    return user

# 로그인 API
# auth_module 안에 있는 LoginRequest 클래스를 데이터 규격으로 사용합니다.
@router.get("/user-list")
def get_user_list(username: str, user: dict = Depends(require_platform_admin)):
    del user
    try:
        return userinfo_module.UserList(username)
    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e))


@router.post("/user-modify")
def post_user_modify(data: userinfo_module.UserModifyRequest, user: dict = Depends(require_platform_admin)):
    result = userinfo_module.UserModify(data)
    security_module.invalidate_all_access_cache()
    
    # 실패했을 경우 401 에러
    if not result["success"]:
        raise HTTPException(status_code=401, detail=result["message"])
        
    return result

@router.post("/user-create")
def post_user_create(data: userinfo_module.UserModifyRequest, user: dict = Depends(require_platform_admin)):
    try:
        item = company_user_module.UserCreateInput(
            companyid=data.company,
            username=data.username,
            email=data.email,
            password=data.userpassword,
            team=data.team,
        )
        created = company_user_module.create_user(item)
        security_module.invalidate_user_access_cache(item.companyid, item.email)
        return {"success": True, "item": created}
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error

@router.post("/user-delete")
def post_user_delete(data: userinfo_module.UserDeleteRequest, user: dict = Depends(require_platform_admin)):
    result = userinfo_module.UserDelete(data)
    security_module.invalidate_all_access_cache()
            
    return result
