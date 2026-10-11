from fastapi import FastAPI,APIRouter, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from config import ALLOWED_ORIGINS
from fastapi.responses import StreamingResponse
import io
from datetime import datetime
from fastapi import Response  
from urllib.parse import quote

import D2CStatistics as D2C_Statistics

router = APIRouter(prefix="/api", tags=["D2CStatistics"])

# 일별 출고량
@router.get("/d2c-outday")
def get_d2c_outday():
    try:
        return D2C_Statistics.OutDayDashBoard()
    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e))

# 주별 출고량
@router.get("/d2c-outweek")
def get_d2c_outweek():
    try:
        return D2C_Statistics.OutWeekDashBoard()
    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e))
    
# 월별 출고량    
@router.get("/d2c-outmonth")
def get_d2c_outmonth():
    try:
        return D2C_Statistics.OutMonthDashBoard()
    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e))    
    
# 자사몰 출고현황 D-1, D-2
@router.get("/d2c-outdaycompare")
def get_d2c_outdaycompare():
    try:
        return D2C_Statistics.OutDDayCompareDATA()
    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e))    
    
# 자사몰 D-DAY 출고수량 TOP 10
@router.get("/d2c-outday-top10")
def get_d2c_outday_top10():
    try:
        return D2C_Statistics.OutDDayDATA()
    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e))        


# 자사몰 WEEK 출고수량 TOP 10
@router.get("/d2c-outweek-top10")
def get_d2c_outweek_top10():
    try:
        return D2C_Statistics.OutDDayWeek()
    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e))        
    

# 자사몰 MONTH 출고수량 TOP 10
@router.get("/d2c-outmonth-top10")
def get_d2c_outmonth_top10():
    try:
        return D2C_Statistics.OutDDayMonth()
    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e))            

# 자사몰 WEEK Title
@router.get("/d2c-outweektitle-top10")
def get_d2c_outweektitle_top10():
    try:
        return D2C_Statistics.OutDDayWeekTitle()
    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e))       
    

# 자사몰 MONTH Title
@router.get("/d2c-outmonthtitle-top10")
def get_d2c_outmonthtitletop10():
    try:
        return D2C_Statistics.OutDDayMonthTitle()
    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e))           