from fastapi import FastAPI,APIRouter, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from config import ALLOWED_ORIGINS

# 모듈 임포트 (이름 충돌을 피하기 위해 as 사용)
import InventoryStock as inv_module

router = APIRouter(prefix="/api", tags=["Inventory"])

# SAP 재고데이터 수집 API
@router.get("/get-inventory-collect")
def get_inventory_collect():
    try:
        return inv_module.inventory_collect()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# SAP 재고부족 데이터 조회
@router.get("/sap-monitor-shortage")
def get_inventory_shortagesearch():
    try:
        return inv_module.inventory_shortagesearch()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
# SAP 입고에러 데이터 조회
@router.get("/sap-monitor-instockerror")
def get_inventory_instockerror():
    try:
        return inv_module.inventory_insearch()
    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e))
    
# SAP 출고에러 데이터 조회
@router.get("/sap-monitor-outstockerror")
def get_inventory_outstockerror():
    try:
        return inv_module.inventory_outsearch()
    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e))    
    
# SAP Progress 데이터 조회
@router.get("/sap-monitor-progrestockerror")
def get_inventory_progrestockerror():
    try:
        return inv_module.inventory_progresearch()
    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e))        

# SAP 기타출고 WMS취소→선택마감 데이터 조회
@router.get("/sap-monitor-cancel-etcsearch")
def get_inventory_cancel_etcsearch():
    try:
        return inv_module.inventory_cancel_etcsearch()
    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e))            
    
# SAP 예외주문 WMS취소→선택마감 데이터 조회
@router.get("/sap-monitor-cancel-exceptsearch")
def get_inventory_cancel_exceptsearch():
    try:
        return inv_module.inventory_cancel_exceptsearch()
    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e))                
    

# SAP 재고이전 WMS취소→선택마감 데이터 조회
@router.get("/sap-monitor-cancel-movesearch")
def get_inventory_cancel_movesearch():
    try:
        return inv_module.inventory_cancel_movesearch()
    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e))                    
    

# SAP WMS 입고요청→실적 미수신 조회
@router.get("/sap-monitor-request-notinsearch")
def get_inventory_request_notinsearch():
    try:
        return inv_module.inventory_request_notinsearch()
    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e))                       
    
    
# SAP WMS 출고요청→실적 미수신 조회
@router.get("/sap-monitor-request-notoutsearch")
def get_inventory_request_notoutsearch():
    try:
        return inv_module.inventory_request_notoutsearch()
    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e))   


# SAP 재고부족 데이터 조회ALL
@router.get("/sap-monitor-Allshortage")
def get_inventory_shortageAllsearch():
    try:
        return inv_module.inventory_shortageAllsearch()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
# SAP 입고에러 데이터 조회ALL
@router.get("/sap-monitor-instockAllerror")
def get_inventory_instockAllerror():
    try:
        return inv_module.inventory_inAllsearch()
    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e))
    
# SAP 출고에러 데이터 조회ALL
@router.get("/sap-monitor-outstockAllerror")
def get_inventory_outstockAllerror():
    try:
        return inv_module.inventory_outAllsearch()
    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e))    
    
# SAP Progress 데이터 조회ALL
@router.get("/sap-monitor-progrestockAllerror")
def get_inventory_progrestockAllerror():
    try:
        return inv_module.inventory_progreAllsearch()
    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e))        

# SAP 기타출고 WMS취소→선택마감 데이터 조회 ALL
@router.get("/sap-monitor-cancel-etcAllsearch")
def get_inventory_cancel_etcAllsearch():
    try:
        return inv_module.inventory_cancel_etcAllsearch()
    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e))            
    
# SAP 예외주문 WMS취소→선택마감 데이터 조회 ALL
@router.get("/sap-monitor-cancel-exceptAllsearch")
def get_inventory_cancel_exceptAllsearch():
    try:
        return inv_module.inventory_cancel_exceptAllsearch()
    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e))                
    
# SAP 재고이전 WMS취소→선택마감 데이터 조회 ALL
@router.get("/sap-monitor-cancel-moveAllsearch")
def get_inventory_cancel_moveAllsearch():
    try:
        return inv_module.inventory_cancel_moveAllsearch()
    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e))                    
    
# SAP WMS 입고요청→실적 미수신 조회 ALL
@router.get("/sap-monitor-request-notinAllsearch")
def get_inventory_request_notinAllsearch():
    try:
        return inv_module.inventory_request_notinAllsearch()
    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e))                       
    
# SAP WMS 출고요청→실적 미수신 조회 ALL
@router.get("/sap-monitor-request-notoutAllsearch")
def get_inventory_request_notoutAllsearch():
    try:
        return inv_module.inventory_request_notoutAllsearch()
    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e))   