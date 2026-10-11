from fastapi import FastAPI,APIRouter, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from config import ALLOWED_ORIGINS
from fastapi.responses import StreamingResponse
import io
from datetime import datetime
from fastapi import Response  
from urllib.parse import quote


import D2CMonth as D2C_Month

router = APIRouter(prefix="/api", tags=["D2CMonth"])

# 브랜드 리스트
@router.get("/d2cmon-brand")
def get_d2cmon_brand():
    try:
        return D2C_Month.OutBrand()
    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e))
    
# 품목코드 코드
@router.get("/d2cmon-itemlist")
def get_d2cmon_itemlist():
    try:
        return D2C_Month.OutItemList()
    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e))            
                
# 월별 출고량 차트
@router.get("/d2cmon-outmonthchart")
def get_d2cmon_Outmonthchart(stdt:str,etdt:str,itemCode:str,Brand:str,itemName:str):
    try:
        return D2C_Month.OutMonthChart(stdt,etdt,itemCode,Brand,itemName)
    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e))                
    
# 월별 출고량 상세데이터
@router.get("/d2cmon-Outmonthrow")
def get_d2cmon_Outmonthrow(prestdt:str,etdt:str,stdt:str,etdt2:str,itemCode:str,Brand:str,itemName:str):
    try:
        return D2C_Month.OutMonthRow(prestdt,etdt,stdt,etdt2,itemCode,Brand,itemName)
    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e))         
    

    