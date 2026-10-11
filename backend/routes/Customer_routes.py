from fastapi import FastAPI,APIRouter, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from config import ALLOWED_ORIGINS
from pydantic import BaseModel, Field
from typing import List

# 모듈 임포트 (이름 충돌을 피하기 위해 as 사용)
import login as auth_module
import Customer as customer_module

router = APIRouter(prefix="/api", tags=["customer"])


class CustomerBulkCreateRequest(BaseModel):
    customers: List[customer_module.CustomModifyRequest] = Field(..., min_items=1, max_items=10000)


@router.get("/next-code")
def get_next_customer_code(companyid: str = Query(..., min_length=1)):
    result = customer_module.CustomerNextCode(companyid)
    if not result["success"]:
        raise HTTPException(status_code=500, detail=result["message"])
    return result


# 고객 생성 API
# customer_module 안에 있는 CustomModifyRequest 클래스를 데이터 규격으로 사용합니다.
@router.post("/create")
def create_customer(data: customer_module.CustomModifyRequest):
    result = customer_module.CustomerCreate(data)
    
    # 실패했을 경우 401 에러
    if not result["success"]:
        raise HTTPException(status_code=401, detail=result["message"])
        
    return result


@router.post("/bulk-create")
def bulk_create_customers(data: CustomerBulkCreateRequest):
    result = customer_module.CustomerBulkCreate(data.customers)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["message"])
    return result


# 고객 수정 API
# customer_module 안에 있는 CustomModifyRequest 클래스를 데이터 규격으로 사용합니다.
@router.post("/update")
def update_customer(data: customer_module.CustomModifyRequest):
    result = customer_module.CustomerModify(data)
    
    # 실패했을 경우 401 에러
    if not result["success"]:
        raise HTTPException(status_code=401, detail=result["message"])
        
    return result

# 고객 조회 API
# customer_module 안에 있는 CustomerList 함수를 사용합니다.
@router.get("/list")
def get_customers(
    companyid: str = Query(..., min_length=1),
    search_keyword: str = Query(None, max_length=200),
    status: str = Query(None),
    tradetype: str = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    result = customer_module.CustomerList(
        companyid=companyid,
        search_keyword=search_keyword,
        status=status,
        tradetype=tradetype,
        page=page,
        page_size=page_size,
    )
    
    if not result["success"]:
        raise HTTPException(status_code=404, detail=result["error"])
        
    return result


@router.get("/export")
def export_customers(
    companyid: str = Query(..., min_length=1),
    search_keyword: str = Query(None, max_length=200),
    status: str = Query(None),
    tradetype: str = Query(None),
):
    result = customer_module.CustomerExport(
        companyid=companyid,
        search_keyword=search_keyword,
        status=status,
        tradetype=tradetype,
    )
    if not result["success"]:
        raise HTTPException(status_code=500, detail=result["error"])
    return result
