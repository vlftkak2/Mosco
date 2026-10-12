from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from config import ALLOWED_ORIGINS
from pydantic import BaseModel, Field
from typing import List

# 모듈 임포트 (이름 충돌을 피하기 위해 as 사용)
import login as auth_module
import Customer as customer_module
import security as security_module

router = APIRouter(prefix="/api", tags=["customer"])

class CustomerBulkCreateRequest(BaseModel):
    customers: List[customer_module.CustomModifyRequest] = Field(..., min_items=1, max_items=10000)


@router.get("/banks")
def get_customer_banks(user: dict = Depends(security_module.get_current_user)):
    result = customer_module.CustomerBanks(user["companyid"])
    if not result["success"]:
        raise HTTPException(status_code=500, detail=result["message"])
    return result


@router.get("/managers")
def get_customer_managers(user: dict = Depends(security_module.get_current_user)):
    result = customer_module.CustomerManagers(user["companyid"])
    if not result["success"]:
        raise HTTPException(status_code=500, detail=result["message"])
    return result


@router.get("/next-code")
def get_next_customer_code(user: dict = Depends(security_module.get_current_user)):
    result = customer_module.CustomerNextCode(user["companyid"])
    if not result["success"]:
        raise HTTPException(status_code=500, detail=result["message"])
    return result


# 고객 생성 API
# customer_module 안에 있는 CustomModifyRequest 클래스를 데이터 규격으로 사용합니다.
@router.post("/create")
def create_customer(
    data: customer_module.CustomModifyRequest,
    user: dict = Depends(security_module.get_current_user),
):
    trusted_data = data.model_copy(update={"companyid": user["companyid"], "companyname": user["companyname"]})
    result = customer_module.CustomerCreate(trusted_data)
    
    # 실패했을 경우 401 에러
    if not result["success"]:
        raise HTTPException(status_code=401, detail=result["message"])
        
    return result


@router.post("/bulk-create")
def bulk_create_customers(
    data: CustomerBulkCreateRequest,
    user: dict = Depends(security_module.get_current_user),
):
    trusted_customers = [
        item.model_copy(update={"companyid": user["companyid"], "companyname": user["companyname"]})
        for item in data.customers
    ]
    result = customer_module.CustomerBulkCreate(trusted_customers)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["message"])
    return result


# 고객 수정 API
# customer_module 안에 있는 CustomModifyRequest 클래스를 데이터 규격으로 사용합니다.
@router.post("/update")
def update_customer(
    data: customer_module.CustomModifyRequest,
    user: dict = Depends(security_module.get_current_user),
):
    trusted_data = data.model_copy(update={"companyid": user["companyid"], "companyname": user["companyname"]})
    result = customer_module.CustomerModify(trusted_data)
    
    # 실패했을 경우 401 에러
    if not result["success"]:
        raise HTTPException(status_code=401, detail=result["message"])
        
    return result

# 고객 조회 API
# customer_module 안에 있는 CustomerList 함수를 사용합니다.
@router.get("/list")
def get_customers(
    user: dict = Depends(security_module.get_current_user),
    search_keyword: str = Query(None, max_length=200),
    status: str = Query(None),
    tradetype: str = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    result = customer_module.CustomerList(
        companyid=user["companyid"],
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
    user: dict = Depends(security_module.get_current_user),
    search_keyword: str = Query(None, max_length=200),
    status: str = Query(None),
    tradetype: str = Query(None),
):
    result = customer_module.CustomerExport(
        companyid=user["companyid"],
        search_keyword=search_keyword,
        status=status,
        tradetype=tradetype,
    )
    if not result["success"]:
        raise HTTPException(status_code=500, detail=result["error"])
    return result
