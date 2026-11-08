from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query

import security as security_module
from services.outbound import GrossProfitDashboard as dashboard_module


# 매출이익 현황판 (메뉴: GROSS_PROFIT_DASHBOARD)
router = APIRouter(
    prefix="/api/gross-profit-dashboard",
    tags=["gross-profit-dashboard"],
    dependencies=[Depends(security_module.require_menu_access("GROSS_PROFIT_DASHBOARD"))],
)


@router.get("/summary")
def get_summary(
    date_from: date = Query(...),
    date_to: date = Query(...),
    user: dict = Depends(security_module.get_current_user),
):
    """거래처·품목·담당자별 매출/비용/순이익 + 전월 비교 + 최근 12개월 추이."""
    if date_from > date_to:
        raise HTTPException(status_code=422, detail="시작일은 종료일보다 뒤일 수 없습니다.")
    if (date_to - date_from).days > 366:
        raise HTTPException(status_code=422, detail="조회 기간은 1년 이내로 지정해 주세요.")
    try:
        return {"success": True, **dashboard_module.dashboard(user["companyid"], date_from, date_to)}
    except Exception as error:
        raise HTTPException(status_code=500, detail="매출이익 현황판을 조회하지 못했습니다.") from error
