from fastapi import FastAPI,APIRouter, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from config import ALLOWED_ORIGINS

# 모듈 임포트 (이름 충돌을 피하기 위해 as 사용)
import login as auth_module

router = APIRouter(prefix="/api", tags=["login"])

# 로그인 API
# auth_module 안에 있는 LoginRequest 클래스를 데이터 규격으로 사용합니다.
@router.post("/login")
def login_api(data: auth_module.LoginRequest):
    result = auth_module.process_login(data)
    
    # 실패했을 경우 401 에러
    if not result["success"]:
        raise HTTPException(status_code=401, detail=result["message"])
        
    return result

