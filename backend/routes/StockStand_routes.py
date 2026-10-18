from datetime import date
import logging

from fastapi import APIRouter, Depends, HTTPException, Query

import StockStand as stock_stand_module
import security as security_module

router = APIRouter(prefix="/api/stock-stand", tags=["stock-stand"])
logger = logging.getLogger(__name__)


@router.get("/items")
def get_stand_items(
    standdate: date = Query(...),
    q: str = Query(default="", max_length=150),
    cursor: int = Query(default=0, ge=0),
    limit: int = Query(default=500, ge=1, le=1000),
    offset: int | None = Query(default=None, ge=0),
    include_metadata: bool = Query(default=True),
    user: dict = Depends(security_module.get_current_user),
):
    try:
        return {
            "success": True,
            **stock_stand_module.list_stand_items(user["companyid"], standdate, q, cursor, limit, include_metadata, offset),
        }
    except Exception as error:
        logger.exception(
            "Failed to query opening stock items (companyid=%s, standdate=%s)",
            user.get("companyid"), standdate,
        )
        raise HTTPException(status_code=500, detail="기초재고를 조회하지 못했습니다.") from error


@router.post("/items/resolve")
def resolve_stand_items(
    data: stock_stand_module.StandItemResolveRequest,
    user: dict = Depends(security_module.get_current_user),
):
    try:
        items = stock_stand_module.resolve_active_items(user["companyid"], data.itemcodes)
        return {"success": True, "items": items}
    except Exception as error:
        logger.exception("Failed to resolve opening stock item codes (companyid=%s)", user.get("companyid"))
        raise HTTPException(status_code=500, detail="품목 마스터 정보를 확인하지 못했습니다.") from error


@router.post("/items")
def save_stand_items(
    data: stock_stand_module.StandSaveRequest,
    user: dict = Depends(security_module.get_current_user),
):
    try:
        saved_count = stock_stand_module.save_stand_items(
            user["companyid"], user.get("companyname") or user["companyid"],
            data.standdate, [item.model_dump() for item in data.items],
        )
        return {"success": True, "saved_count": saved_count}
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail="기초재고 저장 중 오류가 발생했습니다.") from error


@router.put("/items/prices")
def update_stand_prices(
    data: stock_stand_module.StandPriceSaveRequest,
    user: dict = Depends(security_module.get_current_user),
):
    try:
        updated_count = stock_stand_module.update_stand_prices(
            user["companyid"], [item.model_dump() for item in data.items],
        )
        return {"success": True, "updated_count": updated_count}
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except Exception as error:
        logger.exception("Failed to update opening stock price fields (companyid=%s)", user.get("companyid"))
        raise HTTPException(status_code=500, detail="기초재고 단가정보 수정 중 오류가 발생했습니다.") from error


@router.delete("/items")
def delete_stand_items(
    data: stock_stand_module.StandDeleteRequest,
    user: dict = Depends(security_module.get_current_user),
):
    try:
        if not data.delete_all:
            raise ValueError("기초재고는 전체 삭제만 가능합니다.")
        deleted_count = stock_stand_module.delete_stand_items(user["companyid"])
        return {"success": True, "deleted_count": deleted_count}
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail="기초재고 삭제 중 오류가 발생했습니다.") from error
