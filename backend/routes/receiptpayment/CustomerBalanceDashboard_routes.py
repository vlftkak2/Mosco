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
    date_from: date | None = Query(default=None),
    with_vat: bool = Query(default=False),
    user: dict = Depends(security_module.get_current_user),
):
    end = as_of or date.today()
    if date_from and date_from > end:
        raise HTTPException(status_code=422, detail="시작일은 종료일보다 뒤일 수 없습니다.")
    try:
        return {"success": True, **ledger_module.dashboard(user["companyid"], end, with_vat=with_vat, date_from=date_from)}
    except Exception as error:
        raise HTTPException(status_code=500, detail="거래처 잔액 현황을 조회하지 못했습니다.") from error
