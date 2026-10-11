from fastapi import FastAPI,APIRouter, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from config import ALLOWED_ORIGINS

# 모듈 임포트 (이름 충돌을 피하기 위해 as 사용)
import login as auth_module
import Customer as customer_module

router = APIRouter(prefix="/api", tags=["customer"])

# 고객 생성 API
# customer_module 안에 있는 CustomModifyRequest 클래스를 데이터 규격으로 사용합니다.
@router.post("/create")
def create_customer(data: customer_module.CustomModifyRequest):
    result = customer_module.CustomerCreate(data)
    
    # 실패했을 경우 401 에러
    if not result["success"]:
        raise HTTPException(status_code=401, detail=result["message"])
        
    return result

