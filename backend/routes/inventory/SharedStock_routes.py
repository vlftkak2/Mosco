from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query

import security as security_module
from services.inventory import SharedStock as shared_stock_module


# 타사 재고현황 (플랫폼 운영사 001 · 모스코 계정 전용 · 재고 공개에 동의한 고객사만)
router = APIRouter(
    prefix="/api/shared-stock",
    tags=["shared-stock"],
    dependencies=[Depends(security_module.audit_platform_access), Depends(security_module.require_platform_company), Depends(security_module.require_menu_access("SHARED_STOCK"))],   # 모스코 전용 메뉴 (모스코 직원만 받을 수 있음)
)


@router.get("/summary")
def get_summary(
    companyid: str = Query(default="", max_length=50),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    item_search: str = Query(default="", max_length=100),
    material_search: str = Query(default="", max_length=100),
    surface_search: str = Query(default="", max_length=100),
    product_search: str = Query(default="", max_length=100),
    thickness: str = Query(default="", max_length=20),
    width: str = Query(default="", max_length=20),
    length: str = Query(default="", max_length=20),
):
    try:
        return {"success": True, **shared_stock_module.summary(companyid, date_from, date_to, item_search, material_search, surface_search,
                                                               product_search, thickness, width, length)}
    except Exception as error:
        raise HTTPException(status_code=500, detail="타사 재고를 조회하지 못했습니다.") from error


@router.get("/items")
def get_items(
    companyid: str = Query(default="", max_length=50),
    sourcetype: str = Query(default="", max_length=20),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    item_search: str = Query(default="", max_length=100),
    product_search: str = Query(default="", max_length=100),
    material_search: str = Query(default="", max_length=100),
    surface_search: str = Query(default="", max_length=100),
    thickness: str = Query(default="", max_length=20),
    width: str = Query(default="", max_length=20),
    length: str = Query(default="", max_length=20),
    grouped: bool = Query(default=False),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    export: bool = Query(default=False),
):
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=422, detail="기간 시작일은 종료일보다 뒤일 수 없습니다.")
    try:
        return {"success": True, **shared_stock_module.items(companyid, sourcetype, date_from, date_to, item_search, product_search,
                                                             material_search, surface_search, page, page_size, export,
                                                             thickness, width, length, grouped)}
    except Exception as error:
        raise HTTPException(status_code=500, detail="타사 재고를 조회하지 못했습니다.") from error
