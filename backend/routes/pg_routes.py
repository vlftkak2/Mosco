from fastapi import FastAPI,APIRouter, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from config import ALLOWED_ORIGINS

# 모듈 임포트 (이름 충돌을 피하기 위해 as 사용)
import pg as pg_module

router = APIRouter(prefix="/api", tags=["pg"])

# SAP PG 수집
@router.get("/sap-pgmonitor-request-collect")    
def get_pgmonitor_request_collect(yymm:str):
    try:
        return pg_module.pg_collect(yymm)
    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e))   
    
# SAP PG 요약
@router.get("/sap-pgmonitor-request-summary")    
def get_pgmonitor_request_summary():
    try:
        return pg_module.pg_summary()
    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e))
    
# SAP PG AR송장금액
@router.get("/sap-pgmonitor-request-summaryAmt")    
def get_pgmonitor_request_summaryAmt():
    try:
        return pg_module.pg_summaryAmt()
    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e))    
    
# SAP PG 진행상황 All
@router.get("/sap-pgmonitor-request-progressAll")    
def get_pgmonitor_request_progressAll():
    try:
        return pg_module.pg_progressAll()
    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e))    
    

# SAP PG AR금액 UnFinshed
@router.get("/sap-pgmonitor-request-progressUnFinshed")    
def get_pgmonitor_request_progressUnFinshed():
    try:
        return pg_module.pg_progressUnFinshed()
    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e))    