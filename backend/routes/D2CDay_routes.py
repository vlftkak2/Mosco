from fastapi import FastAPI,APIRouter, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from config import ALLOWED_ORIGINS
from fastapi.responses import StreamingResponse
import io
from datetime import datetime
from fastapi import Response  
from urllib.parse import quote

import D2CDay as D2C_Day

router = APIRouter(prefix="/api", tags=["D2CDay"])


# 브랜드 리스트
@router.get("/d2cday-brand")
def get_d2cday_brand():
    try:
        return D2C_Day.OutBrand()
    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e))
    
# 품목코드 코드
@router.get("/d2cday-itemlist")
def get_d2cday_itemlist():
    try:
        return D2C_Day.OutItemList()
    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e))     
    
# 일별 출고량 차트
@router.get("/d2cday-outdaychart")
def get_d2cmon_Outdaychart(stdt:str,etdt:str,itemCode:str,Brand:str,itemName:str):
    try:
        return D2C_Day.OutDayChart(stdt,etdt,itemCode,Brand,itemName)
    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e))                
    
# 일별 출고량 상세데이터
@router.get("/d2cday-Outdayrow")
def get_d2cmon_Outdayrow(prestdt:str,etdt:str,stdt:str,etdt2:str,itemCode:str,Brand:str,itemName:str):
    try:
        return D2C_Day.OutDayRow(prestdt,etdt,stdt,etdt2,itemCode,Brand,itemName)
    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e))         
    