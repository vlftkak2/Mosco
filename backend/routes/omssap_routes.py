from fastapi import FastAPI,APIRouter, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from config import ALLOWED_ORIGINS

# 모듈 임포트 (이름 충돌을 피하기 위해 as 사용)
import omssap as omssap_module

router = APIRouter(prefix="/api", tags=["omssap"])

# OMSSAP 검증 수집
@router.get("/sap-omssap-request-omssapsummary")
def get_omssap_request_verif():
    try:
        return omssap_module.omssapverifCollectCacheSearch()
    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e))
    
# OMSSAP 검증 상세 - 주문건수
@router.get("/sap-omssap-request-omssapdetailone")    
def get_omssap_request_omssapdetailone(divi:str):
    try:
        return omssap_module.omssaporderdetailOne(divi)
    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e))

# OMSSAP 검증 상세 - 주문번호별 수량 및 금액
@router.get("/sap-omssap-request-omssapdetailtwo")    
def get_omssap_request_omssapdetailtwo(divi:str):
    try:
        return omssap_module.omssaporderdetailTwo(divi)
    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e)) 



