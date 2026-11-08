from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query

import security as security_module
from services.outbound import GrossProfit as gross_profit_module


# 매출이익분석 (메뉴: GROSS_PROFIT)
router = APIRouter(
    prefix="/api/gross-profit",
    tags=["gross-profit"],
    dependencies=[Depends(security_module.require_menu_access("GROSS_PROFIT"))],
)


@router.get("/analysis")
def get_analysis(
    date_from: date = Query(...),
    date_to: date = Query(...),
    customer: str = Query(default="", max_length=150),
    keyword: str = Query(default="", max_length=150),
    material: str = Query(default="", max_length=100),
    warehouse: str = Query(default="", max_length=100),
    origin: str = Query(default="", max_length=10),
    profit: str = Query(default="", max_length=10),
    user: dict = Depends(security_module.get_current_user),
):
    """출고 행별 매출·원가·이익 + 매출처 소계 + 총계."""
    if date_from > date_to:
        raise HTTPException(status_code=422, detail="시작일은 종료일보다 뒤일 수 없습니다.")
    if (date_to - date_from).days > 366:
        raise HTTPException(status_code=422, detail="조회 기간은 1년 이내로 지정해 주세요.")
    origin = origin.strip().upper()
    profit = profit.strip().upper()
    if origin and origin not in gross_profit_module.ORIGIN_KINDS:
        raise HTTPException(status_code=422, detail="원가 구분 값이 올바르지 않습니다.")
    if profit and profit not in gross_profit_module.PROFIT_FILTERS:
        raise HTTPException(status_code=422, detail="손익 구분 값이 올바르지 않습니다.")
    try:
        return {"success": True, **gross_profit_module.analyze(
            user["companyid"], date_from, date_to, customer, keyword, material, warehouse, origin, profit,
        )}
    except Exception as error:
        raise HTTPException(status_code=500, detail="매출이익분석을 조회하지 못했습니다.") from error
