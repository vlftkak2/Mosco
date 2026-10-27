"""Authenticated confirmed-order endpoints."""

import asyncio
import logging
from datetime import date
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

import AIOrder as ai_order_module
import AIOrderConfirm as service
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
    user: dict = Depends(authorized_user),
):
    return await asyncio.to_thread(service.list_orders, user["companyid"], start_date, end_date, buyer, orderid, page, page_size)


@router.get("/{orderid}")
async def get_confirmed(orderid: str, user: dict = Depends(authorized_user)):
    result = await asyncio.to_thread(service.get_order, user["companyid"], orderid)
    if result is None:
        raise HTTPException(404, "확정 주문을 찾을 수 없습니다.")
    return result


@router.delete("/{orderid}")
async def cancel_confirmed(orderid: str, user: dict = Depends(authorized_user)):
    try:
        cancelled = await asyncio.to_thread(service.cancel_order, user["companyid"], orderid)
    except Exception as exc:
        logger.exception("Order cancellation failed company=%s error_type=%s", user["companyid"], type(exc).__name__)
        raise HTTPException(500, "주문확정 취소에 실패했습니다. 다시 시도해주세요.") from exc
    if not cancelled:
        raise HTTPException(404, "확정 주문을 찾을 수 없습니다.")
    return {"orderid": orderid, "cancelled": True}


@router.get("/{orderid}/items/{lineno}/stock-candidates")
async def get_stock_candidates(orderid: str, lineno: int, user: dict = Depends(authorized_user)):
    result = await asyncio.to_thread(service.stock_candidates, user["companyid"], orderid, lineno)
    if result is None:
        raise HTTPException(404, "확정 주문 또는 품목을 찾을 수 없습니다.")
    return result
