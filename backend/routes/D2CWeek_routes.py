from fastapi import FastAPI,APIRouter, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from config import ALLOWED_ORIGINS
from fastapi.responses import StreamingResponse
import io
from datetime import datetime
from fastapi import Response  
from urllib.parse import quote

import D2CWeek as D2C_Week

router = APIRouter(prefix="/api", tags=["D2CWeek"])

# 브랜드 리스트
@router.get("/d2cweek-brand")
def get_d2cmon_brand():
    try:
        return D2C_Week.BrandList()
    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e))
    
# 품목코드 리스트
@router.get("/d2cweek-itemlist")
def get_d2cmon_itemlist():
    try:
        return D2C_Week.ItemList()
    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e))   
    
# 주차 리스트
@router.get("/d2cweek-weeklist")
def get_d2cmon_weeklist():
    try:
        return D2C_Week.WeekList()
    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e))       
                
# 월별 출고량 차트
@router.get("/d2cweek-WeekChart")
def get_d2cmon_WeekChart(stdt:str,etdt:str,itemCode:str,Brand:str,itemName:str):
    try:
        return D2C_Week.WeekChart(stdt,etdt,itemCode,Brand,itemName)
    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e))                
    
# 월별 출고량 상세데이터
@router.get("/d2cweek-WeekRow")
def WeekRow(prestdt:str,etdt:str,stdt:str,etdt2:str,itemCode:str,Brand:str,itemName:str):
    try:
        return D2C_Week.WeekRow(prestdt,etdt,stdt,etdt2,itemCode,Brand,itemName)
    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e))         
    

    