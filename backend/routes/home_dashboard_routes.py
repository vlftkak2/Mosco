from fastapi import APIRouter
from fastapi import Depends, HTTPException

import home_dashboard as home_dashboard_module
import home_dashboard_data as dashboard_data_module
import security as security_module


router = APIRouter(
    prefix="/api",
    tags=["home"],
    dependencies=[Depends(security_module.require_menu_access("HOME"))],
)


@router.get("/home-market-summary")
def home_market_summary():
    return home_dashboard_module.get_home_market_summary()


@router.get("/dashboard/summary")
def dashboard_summary(user: dict = Depends(security_module.get_current_user)):
    try:
        return dashboard_data_module.get_dashboard_summary(user["companyid"])
    except Exception as error:
        raise HTTPException(status_code=500, detail="대시보드 실적을 조회하지 못했습니다.") from error


@router.get("/dashboard/news")
def dashboard_news(user: dict = Depends(security_module.get_current_user)):
    del user
    result = home_dashboard_module.get_steel_news()
    return {"success": True, **result}


@router.get("/dashboard/notices")
def dashboard_notices(user: dict = Depends(security_module.get_current_user)):
    return dashboard_data_module.get_dashboard_notices(user["companyid"])
