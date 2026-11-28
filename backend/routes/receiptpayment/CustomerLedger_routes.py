from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

import security as security_module
from services.receiptpayment import CustomerLedger as ledger_module


# 거래처원장 (메뉴: CUSTOMER_LEDGER)
router = APIRouter(
    prefix="/api/customer-ledger",
    tags=["customer-ledger"],
    dependencies=[Depends(security_module.require_menu_access("CUSTOMER_LEDGER"))],
)


class StartDateRequest(BaseModel):
    ledgerstartdate: date | None = None


def _check_period(date_from: date, date_to: date):
    if date_from > date_to:
        raise HTTPException(status_code=422, detail="시작일은 종료일보다 뒤일 수 없습니다.")


@router.get("/settings")
def get_settings(user: dict = Depends(security_module.get_current_user)):
    try:
        return {"success": True, **ledger_module.get_settings(user["companyid"])}
    except Exception as error:
        raise HTTPException(status_code=500, detail="원장 설정을 조회하지 못했습니다.") from error


@router.put("/settings")
def update_settings(payload: StartDateRequest, user: dict = Depends(security_module.get_current_user)):
    # 원장 시작일: 전체 잔액이 바뀌므로 관리자(최종관리자 · 고객사 관리자)만 바꾼다 (라우터가 메뉴 권한도 확인)
    if not (security_module.has_platform_admin_role(user) or str(user.get("authority") or "").upper() in {"MASTER", "SUBMASTER"}):
        raise HTTPException(status_code=403, detail="원장 시작일은 관리자만 바꿀 수 있습니다.")
    try:
        return {"success": True, **ledger_module.update_start_date(user["companyid"], payload.ledgerstartdate, user.get("email", ""))}
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail="원장 시작일을 저장하지 못했습니다.") from error


@router.get("/balances")
def get_balances(
    date_from: date = Query(...),
    date_to: date = Query(...),
    keyword: str = Query(default="", max_length=150),
    balance_only: bool = Query(default=False),
    with_vat: bool = Query(default=False),
    user: dict = Depends(security_module.get_current_user),
):
    _check_period(date_from, date_to)
    try:
        return {"success": True, **ledger_module.list_balances(user["companyid"], date_from, date_to, keyword, balance_only, with_vat)}
    except Exception as error:
        raise HTTPException(status_code=500, detail="거래처별 잔액을 조회하지 못했습니다.") from error


@router.get("/ledger")
def get_ledger(
    ckey: str = Query(..., min_length=1, max_length=200),
    date_from: date = Query(...),
    date_to: date = Query(...),
    with_vat: bool = Query(default=False),
    user: dict = Depends(security_module.get_current_user),
):
    _check_period(date_from, date_to)
    try:
        return {"success": True, **ledger_module.get_ledger(user["companyid"], ckey, date_from, date_to, with_vat)}
    except Exception as error:
        raise HTTPException(status_code=500, detail="거래처원장을 조회하지 못했습니다.") from error
