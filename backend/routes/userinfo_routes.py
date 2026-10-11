from fastapi import FastAPI,APIRouter, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from config import ALLOWED_ORIGINS
from fastapi.responses import StreamingResponse
import io
from datetime import datetime
from fastapi import Response  
from urllib.parse import quote

# 모듈 임포트 (이름 충돌을 피하기 위해 as 사용)
#import backend.userpassword as user_module
import userinfo as userinfo_module

router = APIRouter(prefix="/api", tags=["user"])

# 로그인 API
# auth_module 안에 있는 LoginRequest 클래스를 데이터 규격으로 사용합니다.
@router.get("/user-list")
def get_user_list(username:str):
    try:
        return userinfo_module.UserList(username)
    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e))


@router.post("/user-modify")
def post_user_modify(data: userinfo_module.UserModifyRequest):
    result = userinfo_module.UserModify(data)
    
    # 실패했을 경우 401 에러
    if not result["success"]:
        raise HTTPException(status_code=401, detail=result["message"])
        
    return result

@router.post("/user-create")
def post_user_create(data: userinfo_module.UserModifyRequest):
    result = userinfo_module.UserCreate(data)
    
    # # 실패했을 경우 401 에러
    # if not result["success"]:
    #     raise HTTPException(status_code=401, detail=result["message"])
        
    return result

@router.post("/user-delete")
def post_user_delete(data: userinfo_module.UserDeleteRequest):
    result = userinfo_module.UserDelete(data)
            
    return result