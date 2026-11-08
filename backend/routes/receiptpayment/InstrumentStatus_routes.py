from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query

import security as security_module
from services.receiptpayment import InstrumentStatus as instrument_status_module


# 수표/어음 현황 (메뉴: INSTRUMENT_STATUS)
router = APIRouter(
    prefix="/api/instrument-status",
    tags=["instrument-status"],
    dependencies=[Depends(security_module.require_menu_access("INSTRUMENT_STATUS"))],
)


@router.get("/instruments")
def get_instruments(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=500),
    kind: str = Query(default="", max_length=20),
    status: str = Query(default="OPEN", max_length=20),
    bucket: str = Query(default="", max_length=10),
    maturity_from: date | None = Query(default=None),
    maturity_to: date | None = Query(default=None),
    customer: str = Query(default="", max_length=150),
    instrumenttype: str = Query(default="", max_length=20),
    keyword: str = Query(default="", max_length=150),
    user: dict = Depends(security_module.get_current_user),
):
    """수표/어음 현황: 현재 상태 기준 증권 목록 + 요약 카드 + 만기 구간."""
    if maturity_from and maturity_to and maturity_from > maturity_to:
        raise HTTPException(status_code=422, detail="만기 시작일은 종료일보다 뒤일 수 없습니다.")
    try:
        return {"success": True, **instrument_status_module.list_instruments(
            user["companyid"], page, page_size, kind.upper(), status.upper(), bucket, maturity_from, maturity_to,
            customer, instrumenttype, keyword,
        )}
    except Exception as error:
        raise HTTPException(status_code=500, detail="수표/어음 현황을 조회하지 못했습니다.") from error
