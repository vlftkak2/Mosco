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
import userpassword as user_module

router = APIRouter(prefix="/passwordapi", tags=["login"])

# 로그인 API
# auth_module 안에 있는 LoginRequest 클래스를 데이터 규격으로 사용합니다.
@router.post("/change-password")
def change_password(data: user_module.PasswordRequest):
    result = user_module.password_change(data)
    
    # 실패했을 경우 401 에러
    if not result["success"]:
        raise HTTPException(status_code=401, detail=result["message"])
        
    return result


