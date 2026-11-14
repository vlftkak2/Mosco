from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from typing import List
from decimal import Decimal

# 모듈 임포트 (이름 충돌을 피하기 위해 as 사용)
from services.masterdata import Customer as customer_module
import security as security_module

router = APIRouter(
    prefix="/api",
    tags=["customer"],
    dependencies=[Depends(security_module.require_menu_access("DATA_CUSTOMER"))],
)

OPENING_BALANCE_AUTHORITIES = {"MASTER", "SUBMASTER"}


def _can_edit_opening_balances(user: dict) -> bool:
    """기초 미수금/미지급금은 MASTER/SUBMASTER(및 플랫폼 관리자)만 설정·변경할 수 있습니다."""
    return (
        security_module.has_platform_admin_role(user)
        or str(user.get("authority") or "").upper() in OPENING_BALANCE_AUTHORITIES
    )


def _clear_opening_balances(customer: customer_module.CustomModifyRequest) -> None:
    customer.openingreceivable = Decimal("0")
    customer.openingpayable = Decimal("0")


class CustomerBulkCreateRequest(BaseModel):
    customers: List[customer_module.CustomModifyRequest] = Field(..., min_items=1, max_items=10000)


@router.get("/next-code")
def get_next_customer_code(user: dict = Depends(security_module.get_current_user)):
    result = customer_module.CustomerNextCode(user["companyid"])
    if not result["success"]:
        raise HTTPException(status_code=500, detail=result["message"])
    return result


@router.get("/banks")
def get_banks(user: dict = Depends(security_module.get_current_user)):
    result = customer_module.BankList(user["companyid"])
    if not result["success"]:
        raise HTTPException(status_code=500, detail=result["error"])
    return result


@router.get("/managers")
def get_customer_managers(user: dict = Depends(security_module.get_current_user)):
    result = customer_module.CustomerManagerList(user["companyid"])
    if not result["success"]:
        raise HTTPException(status_code=500, detail=result["error"])
    return result


# 고객 생성 API
# customer_module 안에 있는 CustomModifyRequest 클래스를 데이터 규격으로 사용합니다.
@router.post("/create")
def create_customer(
    data: customer_module.CustomModifyRequest,
    user: dict = Depends(security_module.get_current_user),
):
    data.companyid = user["companyid"]
    data.companyname = user.get("companyname") or user["companyid"]
    if not _can_edit_opening_balances(user):
        _clear_opening_balances(data)
    result = customer_module.CustomerCreate(data, actor=user.get("email"))
    
    # 실패했을 경우 401 에러
    if not result["success"]:
        raise HTTPException(status_code=401, detail=result["message"])
        
    return result


@router.post("/bulk-create")
def bulk_create_customers(
    data: CustomerBulkCreateRequest,
    user: dict = Depends(security_module.get_current_user),
):
    companyname = user.get("companyname") or user["companyid"]
    can_edit_opening = _can_edit_opening_balances(user)
    for customer in data.customers:
        customer.companyid = user["companyid"]
        customer.companyname = companyname
        if not can_edit_opening:
            _clear_opening_balances(customer)
    result = customer_module.CustomerBulkCreate(data.customers, actor=user.get("email"))
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
    data.companyid = user["companyid"]
    result = customer_module.CustomerModify(
        data,
        actor=user.get("email"),
        update_opening_balances=_can_edit_opening_balances(user),
    )
    
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
    include_total: bool = Query(True),
):
    result = customer_module.CustomerList(
        companyid=user["companyid"],
        search_keyword=search_keyword,
        status=status,
        tradetype=tradetype,
        page=page,
        page_size=page_size,
        include_total=include_total,
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


# ---------------------------------------------------------------------------
# 기초잔액 일괄 반영: 양식 받기(GET) / 미리보기·반영(POST dry_run)
# ---------------------------------------------------------------------------
class OpeningBalanceApplyRequest(BaseModel):
    rows: List[customer_module.OpeningBalanceRow] = Field(..., min_length=1, max_length=20000)
    dry_run: bool = True


@router.get("/opening-balances")
def get_opening_balances(user: dict = Depends(security_module.get_current_user)):
    try:
        return {"success": True, "items": customer_module.OpeningBalanceList(user["companyid"])}
    except Exception as error:
        raise HTTPException(status_code=500, detail="기초잔액 양식을 만들지 못했습니다.") from error


@router.post("/opening-balances")
def apply_opening_balances(data: OpeningBalanceApplyRequest, user: dict = Depends(security_module.get_current_user)):
    if not _can_edit_opening_balances(user):
        raise HTTPException(status_code=403, detail="기초잔액은 관리자(MASTER·SUBMASTER)만 반영할 수 있습니다.")
    try:
        result = customer_module.OpeningBalanceApply(user["companyid"], data.rows, data.dry_run, user.get("email"))
    except Exception as error:
        raise HTTPException(status_code=500, detail="기초잔액을 반영하지 못했습니다. 변경 사항은 모두 취소했습니다.") from error
    if not result.get("success"):
        raise HTTPException(status_code=422, detail=result.get("message") or "업로드 파일을 확인해 주세요.")
    return result
