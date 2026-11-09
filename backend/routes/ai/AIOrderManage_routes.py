"""Authenticated confirmed-order endpoints."""

import asyncio
import logging
from datetime import date
from decimal import Decimal
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from services.ai import AIOrder as ai_order_module
from services.ai import AIOrderManage as service
import security as security_module
from security import get_current_user

router = APIRouter(
    prefix="/api/ai-order/confirmed",
    tags=["ai-order-confirmed"],
    dependencies=[Depends(security_module.require_menu_access("AI_ORDER_MANAGEMENT"))],
)
logger = logging.getLogger(__name__)


class Header(BaseModel):
    buyer: str | None = Field(default=None, max_length=100)
    recipient: str | None = Field(default=None, max_length=100)
    order_date: date | None = None
    due_date: date | None = None
    delivery_location: str | None = None


class Line(BaseModel):
    source_product_name: str | None = Field(default=None, max_length=255)
    steel_grade: str | None = Field(default=None, max_length=100)
    surface: str | None = Field(default=None, max_length=100)
    spec_raw: str | None = None
    thickness: Decimal | None = Field(default=None, ge=0, max_digits=15, decimal_places=3)
    width: Decimal | None = Field(default=None, ge=0, max_digits=15, decimal_places=3)
    length: Decimal | None = Field(default=None, ge=0, max_digits=15, decimal_places=3)
    quantity: Decimal | None = Field(default=None, ge=0, max_digits=15, decimal_places=3)
    quantity_unit: str | None = Field(default=None, max_length=30)
    weight_kg: Decimal | None = Field(default=None, ge=0, max_digits=15, decimal_places=3)
    notes: str | None = None
    quantity_raw: str | None = None
    weight_raw: str | None = None


class ConfirmRequest(BaseModel):
    analysis_request_id: UUID
    sourcefilename: str | None = Field(default=None, max_length=255)
    header: Header
    items: list[Line] = Field(min_length=1, max_length=1000)


class ConfirmedOrderUpdate(BaseModel):
    buyer: str | None = Field(default=None, max_length=100)
    recipient: str | None = Field(default=None, max_length=100)
    order_date: date | None = None
    due_date: date
    delivery_location: str | None = Field(default=None, max_length=500)


class ConfirmedItemUpdate(BaseModel):
    # Existing lines keep their DB identity; null marks a newly added UI row.
    lineno: int | None = Field(default=None, gt=0)
    itemname: str | None = Field(default=None, max_length=255)
    steelgrade: str | None = Field(default=None, max_length=100)
    surface: str | None = Field(default=None, max_length=100)
    size: str | None = None
    thickness: Decimal | None = Field(default=None, ge=0, max_digits=15, decimal_places=3)
    width: Decimal | None = Field(default=None, ge=0, max_digits=15, decimal_places=3)
    length: Decimal | None = Field(default=None, ge=0, max_digits=15, decimal_places=3)
    quantity: Decimal | None = Field(default=None, ge=0, max_digits=15, decimal_places=3)
    quantity_unit: str | None = Field(default=None, max_length=30)
    weight_kg: Decimal | None = Field(default=None, ge=0, max_digits=15, decimal_places=3)
    notes: str | None = None
    quantity_raw: str | None = None
    weight_raw: str | None = None


class ConfirmedItemsUpdate(BaseModel):
    items: list[ConfirmedItemUpdate] = Field(max_length=1000)


class StockSource(BaseModel):
    sourcetype: Literal["OPENING", "INBOUND", "PROCESS"]
    sourceno: str = Field(min_length=1, max_length=100)
    sourceline: int = Field(gt=0)


class StockMatchesUpdate(BaseModel):
    # 빈 목록 = 연결 초기화
    sources: list[StockSource] = Field(default_factory=list, max_length=100)


class OptimizeSendRequest(BaseModel):
    linenos: list[int] = Field(min_length=1, max_length=1000)


async def authorized_user(user: dict = Depends(get_current_user)):
    companyid = str(user.get("companyid") or "").strip()
    email = str(user.get("email") or "").strip()
    if not companyid or not email:
        raise HTTPException(401, "로그인 정보가 필요합니다.")
    if not await asyncio.to_thread(ai_order_module.check_user_access, companyid, email, "AI_ORDER_MANAGEMENT"):
        raise HTTPException(403, "AI 주문서 메뉴 권한이 없습니다.")
    return user


@router.post("")
async def confirm(payload: ConfirmRequest, user: dict = Depends(authorized_user)):
    try:
        return await asyncio.to_thread(
            service.confirm_order, user["companyid"], str(user.get("companyname") or ""),
            str(user.get("username") or ""), user["email"], payload,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        logger.exception("Order confirmation failed company=%s error_type=%s", user["companyid"], type(exc).__name__)
        raise HTTPException(500, "주문확정 저장에 실패했습니다. 다시 시도해주세요.") from exc


@router.get("")
async def list_confirmed(
    start_date: date | None = None, end_date: date | None = None,
    buyer: str | None = Query(default=None, max_length=100),
    orderid: str | None = Query(default=None, max_length=100),
    page: int = Query(default=1, ge=1), page_size: int = Query(default=30, ge=1, le=100),
    progress: Literal["NONE", "PARTIAL", "SENT", "DONE"] | None = None,
    user: dict = Depends(authorized_user),
):
    return await asyncio.to_thread(service.list_orders, user["companyid"], start_date, end_date, buyer, orderid, page, page_size, progress)


@router.get("/{orderid}")
async def get_confirmed(orderid: str, user: dict = Depends(authorized_user)):
    result = await asyncio.to_thread(service.get_order, user["companyid"], orderid)
    if result is None:
        raise HTTPException(404, "확정 주문을 찾을 수 없습니다.")
    return result


@router.put("/{orderid}")
async def update_confirmed(orderid: str, payload: ConfirmedOrderUpdate, user: dict = Depends(authorized_user)):
    try:
        updated = await asyncio.to_thread(
            service.update_order, user["companyid"], orderid,
            payload.buyer, payload.recipient, payload.order_date,
            payload.due_date, payload.delivery_location, user["email"],
        )
    except Exception as exc:
        logger.exception("Confirmed order update failed company=%s error_type=%s", user["companyid"], type(exc).__name__)
        raise HTTPException(500, "Confirmed order update failed.") from exc
    if not updated:
        raise HTTPException(404, "Confirmed order not found.")
    return {"orderid": orderid, "updated": True}


@router.put("/{orderid}/items")
async def update_confirmed_items(orderid: str, payload: ConfirmedItemsUpdate, user: dict = Depends(authorized_user)):
    try:
        updated = await asyncio.to_thread(
            service.update_order_items, user["companyid"], orderid, payload.items, user["email"],
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        logger.exception("Confirmed order items update failed company=%s error_type=%s", user["companyid"], type(exc).__name__)
        raise HTTPException(500, "Confirmed order items update failed.") from exc
    if not updated:
        raise HTTPException(404, "Confirmed order not found.")
    return {"orderid": orderid, "updated": True}


@router.delete("/{orderid}")
async def cancel_confirmed(orderid: str, user: dict = Depends(authorized_user)):
    try:
        cancelled = await asyncio.to_thread(service.cancel_order, user["companyid"], orderid)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        logger.exception("Order cancellation failed company=%s error_type=%s", user["companyid"], type(exc).__name__)
        raise HTTPException(500, "주문확정 취소에 실패했습니다. 다시 시도해주세요.") from exc
    if not cancelled:
        raise HTTPException(404, "확정 주문을 찾을 수 없습니다.")
    return {"orderid": orderid, "cancelled": True}


@router.get("/{orderid}/items/{lineno}/stock-candidates")
async def get_stock_candidates(
    orderid: str,
    lineno: int,
    thickness_from: Decimal | None = Query(default=None, ge=0, le=1000),
    thickness_to: Decimal | None = Query(default=None, ge=0, le=1000),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    itemname: str | None = Query(default=None, max_length=150),
    surface: str | None = Query(default=None, max_length=100),
    width: Decimal | None = Query(default=None, ge=0, le=100000),
    length: Decimal | None = Query(default=None, ge=0, le=100000),
    warehouse: str | None = Query(default=None, max_length=100),
    user: dict = Depends(authorized_user),
):
    if thickness_from is not None and thickness_to is not None and thickness_from > thickness_to:
        raise HTTPException(400, "두께 시작값이 끝값보다 클 수 없습니다.")
    result = await asyncio.to_thread(
        service.stock_candidates, user["companyid"], orderid, lineno, thickness_from, thickness_to,
        page, page_size, itemname, surface, width, length, warehouse,
    )
    if result is None:
        raise HTTPException(404, "확정 주문 또는 품목을 찾을 수 없습니다.")
    return result


@router.put("/{orderid}/items/{lineno}/stock-matches")
async def update_stock_matches(orderid: str, lineno: int, payload: StockMatchesUpdate, user: dict = Depends(authorized_user)):
    try:
        updated = await asyncio.to_thread(
            service.save_stock_matches, user["companyid"], orderid, lineno,
            payload.sources, user["email"],
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        logger.exception("AI order stock match update failed company=%s error_type=%s", user["companyid"], type(exc).__name__)
        raise HTTPException(500, "재고매칭 저장에 실패했습니다. 다시 시도해 주세요.") from exc
    if not updated:
        raise HTTPException(404, "확정 주문 또는 품목을 찾을 수 없습니다.")
    return {"orderid": orderid, "lineno": lineno, "linked": len(payload.sources), "updated": True}


async def _set_optimize_status(orderid: str, payload: OptimizeSendRequest, user: dict, send: bool):
    try:
        result = await asyncio.to_thread(
            service.set_optimize_status, user["companyid"], orderid, payload.linenos, send, user["email"],
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        logger.exception("AI order optimize status update failed company=%s error_type=%s", user["companyid"], type(exc).__name__)
        raise HTTPException(500, "가공 최적화 상태 저장에 실패했습니다. 다시 시도해 주세요.") from exc
    if result is None:
        raise HTTPException(404, "확정 주문을 찾을 수 없습니다.")
    changed, skipped = result
    return {"orderid": orderid, "changed": changed, "skipped": skipped}


@router.post("/{orderid}/send-to-optimization")
async def send_to_optimization(orderid: str, payload: OptimizeSendRequest, user: dict = Depends(authorized_user)):
    """선택 품목을 가공 최적화로 보낸다 (미전송 → 최적화 대기)."""
    return await _set_optimize_status(orderid, payload, user, True)


@router.post("/{orderid}/recall-from-optimization")
async def recall_from_optimization(orderid: str, payload: OptimizeSendRequest, user: dict = Depends(authorized_user)):
    """아직 최적화 대기인 품목만 되돌린다 (최적화 대기 → 미전송). 계획확정 이후는 가공 최적화에서 처리."""
    return await _set_optimize_status(orderid, payload, user, False)
