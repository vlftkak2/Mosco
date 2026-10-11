from fastapi import APIRouter

import home_dashboard as home_dashboard_module


router = APIRouter(prefix="/api", tags=["home"])


@router.get("/home-market-summary")
def home_market_summary():
    return home_dashboard_module.get_home_market_summary()
