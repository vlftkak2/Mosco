from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

import security as security_module
from services.closing import MonthClose as month_close_module


# 월마감 관리 (메뉴: MONTH_CLOSING)
router = APIRouter(
    prefix="/api/month-close",
    tags=["month-close"],
    dependencies=[Depends(security_module.require_menu_access("MONTH_CLOSING"))],
)


class MonthCloseRequest(BaseModel):
    month: str = Field(min_length=7, max_length=7, pattern=r"^\d{4}-\d{2}$")


@router.get("")
def get_months(
    year: int | None = Query(default=None, ge=2000, le=2100),
    user: dict = Depends(security_module.get_current_user),
):
    try:
        target_year = year or datetime.now(ZoneInfo("Asia/Seoul")).year
        return {"success": True, **month_close_module.list_months(user["companyid"], target_year)}
    except Exception as error:
        raise HTTPException(status_code=500, detail="월마감 현황을 조회하지 못했습니다.") from error


@router.post("/close")
def close_month(data: MonthCloseRequest, user: dict = Depends(security_module.get_current_user)):
    try:
        return {"success": True, **month_close_module.close_month(user["companyid"], user.get("companyname") or "", data.month, user.get("email"))}
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail="월마감을 처리하지 못했습니다.") from error


@router.post("/reopen")
def reopen_month(data: MonthCloseRequest, user: dict = Depends(security_module.get_current_user)):
    try:
        return {"success": True, **month_close_module.reopen_month(user["companyid"], data.month)}
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail="월마감을 취소하지 못했습니다.") from error
