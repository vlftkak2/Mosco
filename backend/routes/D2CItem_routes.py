from fastapi import FastAPI,APIRouter, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from config import ALLOWED_ORIGINS
from fastapi.responses import StreamingResponse
import io
from datetime import datetime
from fastapi import Response  
from urllib.parse import quote

import D2CItem as D2C_Item

router = APIRouter(prefix="/api", tags=["D2CItem"])

# 브랜드 리스트
@router.get("/d2citem-brand")
def get_d2citem_brand():
    try:
        return D2C_Item.OutBrand()
    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e))
    
# 품목코드 코드
@router.get("/d2citem-itemlist")
def get_d2citem_itemlist():
    try:
        return D2C_Item.OutItemList()
    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e))     
    
# 바코드 리스트
@router.get("/d2citem-barcodelist")
def get_d2citem_barcodelist():
    try:
        return D2C_Item.OutBarcodeList()
    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e))     

# 품목코드별 차트
@router.get("/d2citem-outitemchart")
def get_d2citem_Outitemchart(
        stdt:str,
        etdt:str,
        itemCode:str,
        itemName:str,
        Barcode:str,
        Brand:str):
    try:
        return D2C_Item.OutItemChart(stdt,etdt,itemCode,itemName,Barcode,Brand)
    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e))            
        
    
# 품목코드별 비교 차트 
@router.get("/d2citem-outitemschart")
def get_d2citem_Outitemschart(stdt:str,etdt:str,itemCode:str,itemName:str,Barcode:str,Brand:str):
    try:
        return D2C_Item.OutItemsChart(stdt,etdt,itemCode,itemName,Barcode,Brand)
    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e))         
    
# 품목코드별 상세데이터
@router.get("/d2citem-outitemrow")
def get_d2citem_Outitemrow(prestdt:str,preetdt:str,stdt:str,etdt:str,itemCode:str,itemName:str,Barcode:str,Brand:str):
    try:
        return D2C_Item.OutItemRow(prestdt,preetdt,stdt,etdt,itemCode,itemName,Barcode,Brand)
    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e))         
    