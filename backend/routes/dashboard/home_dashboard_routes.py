from fastapi import APIRouter
from datetime import date, datetime
from zoneinfo import ZoneInfo

from fastapi import Depends, HTTPException, Query

from services.dashboard import home_dashboard as home_dashboard_module
from services.dashboard import HomeOverview as home_overview_module
import security as security_module


router = APIRouter(
    prefix="/api",
    tags=["home"],
    dependencies=[Depends(security_module.require_menu_access("HOME"))],
)


@router.get("/dashboard/overview")
def dashboard_overview(
    date_from: date = Query(...),
    date_to: date = Query(...),
    user: dict = Depends(security_module.get_current_user),
):
    """대시보드: 기간 실적 · 최근 전표 · 장기재고 · 미수금 (실제 전표 기준)."""
    if date_from > date_to:
        raise HTTPException(status_code=400, detail="조회 기간을 확인해 주세요.")
    today = datetime.now(ZoneInfo("Asia/Seoul")).date()
    try:
        return home_overview_module.overview(user, date_from, date_to, today, security_module.has_platform_admin_role(user))
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail="대시보드를 조회하지 못했습니다.") from error


@router.get("/dashboard/today")
def dashboard_today(user: dict = Depends(security_module.get_current_user)):
    """대시보드 '오늘' 칸: 서울 날씨 · 철강 뉴스."""
    del user
    return home_dashboard_module.get_today_info()
