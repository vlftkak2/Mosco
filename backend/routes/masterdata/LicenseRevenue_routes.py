from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query

import security as security_module
from services.masterdata import LicenseRevenue as license_revenue_module


# 라이선스 매출현황 (어드민 · 플랫폼 운영사 001 MASTER 전용)
router = APIRouter(
    prefix="/api/license-revenue",
    tags=["license-revenue"],
    dependencies=[Depends(security_module.audit_platform_access), Depends(security_module.require_platform_company), Depends(security_module.require_menu_access("LICENSE_REVENUE"))],   # 모스코 전용 메뉴
)


@router.get("")
def get_license_revenue(date_from: date = Query(...), date_to: date = Query(...),
                        companyid: str | None = Query(default=None, max_length=20)):
    if date_from > date_to:
        raise HTTPException(status_code=422, detail="시작일은 종료일보다 뒤일 수 없습니다.")
    try:
        return {"success": True, **license_revenue_module.report(date_from, date_to, (companyid or "").strip() or None)}
    except Exception as error:
        raise HTTPException(status_code=500, detail="라이선스 매출을 조회하지 못했습니다.") from error


@router.get("/companies")
def search_companies(keyword: str = Query(default="", max_length=100)):
    """고객사 조건 자동완성."""
    try:
        return {"items": license_revenue_module.search_companies(keyword)}
    except Exception as error:
        raise HTTPException(status_code=500, detail="고객사를 찾지 못했습니다.") from error
