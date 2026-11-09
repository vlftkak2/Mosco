"""가공 최적화 API (메뉴: AI_OPTIMIZATION)."""
import asyncio
import logging
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

import security as security_module
from services.ai import AIOrderOptimization as service

router = APIRouter(prefix="/api/ai-optimization", tags=["ai-optimization"])
logger = logging.getLogger(__name__)
require_access = security_module.require_menu_access("AI_OPTIMIZATION")


class LineKey(BaseModel):
    orderid: str = Field(min_length=1, max_length=100)
    lineno: int = Field(gt=0)


class AnalyzeRequest(BaseModel):
    keys: list[LineKey] = Field(min_length=1, max_length=50)
    settings: dict = Field(default_factory=dict)
    planno: str = Field(default="", max_length=30)


class SavePlanRequest(AnalyzeRequest):
    status: Literal["DRAFT", "CONFIRMED"] = "DRAFT"
    plan_id: str = Field(default="A", max_length=2)
    description: str | None = Field(default=None, max_length=500)


class ReturnRequest(BaseModel):
    keys: list[LineKey] = Field(min_length=1, max_length=200)


class LineUpdate(BaseModel):
    thickness: Decimal | None = Field(default=None, gt=0, max_digits=15, decimal_places=3)
    width: Decimal | None = Field(default=None, gt=0, max_digits=15, decimal_places=3)
    length: Decimal | None = Field(default=None, ge=0, max_digits=15, decimal_places=3)
    quantity: Decimal | None = Field(default=None, gt=0, max_digits=15, decimal_places=3)
    weight_kg: Decimal | None = Field(default=None, gt=0, max_digits=15, decimal_places=3)


def _keys(keys: list[LineKey]):
    return [(k.orderid, k.lineno) for k in keys]


async def _call(fn, *args, fail="처리에 실패했습니다."):
    try:
        return await asyncio.to_thread(fn, *args)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("AI optimization failed fn=%s error_type=%s", getattr(fn, "__name__", fn), type(exc).__name__)
        raise HTTPException(500, fail) from exc


@router.get("/queue")
async def queue(status: Literal["WAITING", "PLANNED", "ALL"] = "WAITING",
                buyer: str = Query(default="", max_length=100), itemname: str = Query(default="", max_length=150),
                user: dict = Depends(require_access)):
    return await _call(service.list_queue, user["companyid"], status, buyer, itemname, fail="최적화 대기 품목을 불러오지 못했습니다.")


@router.post("/analyze")
async def analyze(payload: AnalyzeRequest, user: dict = Depends(require_access)):
    return await _call(service.analyze, user["companyid"], _keys(payload.keys), payload.settings, payload.planno,
                       fail="가공 최적화 계산에 실패했습니다.")


@router.get("/plans")
async def plans(status: Literal["OPEN", "DRAFT", "CONFIRMED", "ALL"] = "OPEN", user: dict = Depends(require_access)):
    return await _call(service.list_plans, user["companyid"], status, fail="가공 계획을 불러오지 못했습니다.")


@router.get("/plans/{planno}")
async def plan_detail(planno: str, user: dict = Depends(require_access)):
    result = await _call(service.get_plan, user["companyid"], planno, fail="가공 계획을 불러오지 못했습니다.")
    if result is None:
        raise HTTPException(404, "가공 계획을 찾을 수 없습니다.")
    return result


@router.post("/plans")
async def save_plan(payload: SavePlanRequest, user: dict = Depends(require_access)):
    body = {"planno": payload.planno, "status": payload.status, "keys": _keys(payload.keys),
            "settings": payload.settings, "plan_id": payload.plan_id, "description": payload.description}
    return await _call(service.save_plan, user["companyid"], str(user.get("companyname") or ""), body, user["email"],
                       fail="가공 계획을 저장하지 못했습니다.")


@router.post("/plans/{planno}/cancel")
async def cancel_plan(planno: str, user: dict = Depends(require_access)):
    done = await _call(service.cancel_plan, user["companyid"], planno, user["email"], fail="가공 계획을 취소하지 못했습니다.")
    if not done:
        raise HTTPException(404, "가공 계획을 찾을 수 없습니다.")
    return {"planno": planno, "cancelled": True}


@router.post("/return")
async def return_lines(payload: ReturnRequest, user: dict = Depends(require_access)):
    return await _call(service.return_lines, user["companyid"], _keys(payload.keys), user["email"],
                       fail="주문서 관리로 돌려보내지 못했습니다.")


@router.put("/lines/{orderid}/{lineno}")
async def update_line(orderid: str, lineno: int, payload: LineUpdate, user: dict = Depends(require_access)):
    values = payload.model_dump(exclude_unset=True)
    done = await _call(service.update_line, user["companyid"], orderid, lineno, values, user["email"], fail="품목 값을 저장하지 못했습니다.")
    if not done:
        raise HTTPException(404, "품목을 찾을 수 없습니다.")
    return {"orderid": orderid, "lineno": lineno, "updated": True}
