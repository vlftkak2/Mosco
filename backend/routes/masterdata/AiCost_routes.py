from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query

import security as security_module
from services.masterdata import AiCost as ai_cost_module


def _platform_only(user: dict = Depends(security_module.get_current_user)) -> dict:
    """모스코(001) 직원만 (메뉴 권한이 어떻게 들어가 있든 다른 회사는 막는다)."""
    if not security_module.is_platform_company(user):
        raise HTTPException(status_code=403, detail="모스코 전용 메뉴입니다.")
    return user


# AI 비용현황 (어드민 · 모스코 전용 메뉴)
router = APIRouter(
    prefix="/api/ai-cost",
    tags=["ai-cost"],
    dependencies=[Depends(security_module.audit_platform_access), Depends(_platform_only), Depends(security_module.require_menu_access("AI_COST"))],
)


@router.get("")
def get_ai_cost(date_from: date = Query(...), date_to: date = Query(...),
                companyid: str | None = Query(default=None, max_length=20)):
    if date_from > date_to:
        raise HTTPException(status_code=422, detail="시작일은 종료일보다 뒤일 수 없습니다.")
    try:
        return {"success": True, **ai_cost_module.report(date_from, date_to, (companyid or "").strip() or None)}
    except Exception as error:
        raise HTTPException(status_code=500, detail="AI 비용을 조회하지 못했습니다.") from error


@router.get("/companies")
def search_companies(keyword: str = Query(default="", max_length=100)):
    """고객사 조건 자동완성."""
    try:
        return {"items": ai_cost_module.search_companies(keyword)}
    except Exception as error:
        raise HTTPException(status_code=500, detail="고객사를 찾지 못했습니다.") from error
