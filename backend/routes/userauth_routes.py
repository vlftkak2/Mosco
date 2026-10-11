from fastapi import FastAPI,APIRouter, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from config import ALLOWED_ORIGINS
from fastapi.responses import StreamingResponse
import io
from datetime import datetime
from fastapi import Response  
from urllib.parse import quote

# 모듈 임포트 (이름 충돌을 피하기 위해 as 사용)
import userauth as userauth_module

router = APIRouter(prefix="/api", tags=["userauth"])

# 로그인 API
@router.get("/menu-list")
def get_menu_list():
    try:
        return userauth_module.MenuMasterList()
    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e))


@router.get("/menu-team-list")
def get_menu_team_list():
    result = userauth_module.MenuTeamList()
    
    # 실패했을 경우 401 에러
    if not result["success"]:
        raise HTTPException(status_code=401, detail=result["message"])
        
    return result

@router.get("/menu-user-list")
def get_menu_user_list():
    result = userauth_module.MenuUserList()
            
    return result

@router.get("/menu-user-Authlist")
def get_menu_user_Authlist(manager:str):
    result = userauth_module.MenuUserAuthList(manager)
            
    return result

@router.post("/user-AuthUpdate")
def post_userAuth_Update(data: userauth_module.PermissionAuth):
    result = userauth_module.UserAuthUpdate(data)
            
    return result


@router.get("/menu-user-Authemaillist")
def get_menu_user_Authemaillist(email:str):
    result = userauth_module.MenuUserAuthEmailList(email)
            
    return result