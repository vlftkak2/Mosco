from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query

import security as security_module
from services.receiptpayment import CustomerLedger as ledger_module


# 거래처 잔액 현황 (메뉴: CUSTOMER_BALANCE_DASHBOARD) - 계산은 거래처원장과 같은 로직을 쓴다.
router = APIRouter(
    prefix="/api/customer-balance-dashboard",
    tags=["customer-balance-dashboard"],
    dependencies=[Depends(security_module.require_menu_access("CUSTOMER_BALANCE_DASHBOARD"))],
)


@router.get("")
def get_dashboard(
    as_of: date | None = Query(default=None),
    user: dict = Depends(security_module.get_current_user),
):
    try:
        return {"success": True, **ledger_module.dashboard(user["companyid"], as_of or date.today())}
    except Exception as error:
        raise HTTPException(status_code=500, detail="거래처 잔액 현황을 조회하지 못했습니다.") from error
