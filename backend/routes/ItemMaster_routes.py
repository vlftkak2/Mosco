from fastapi import APIRouter, Depends, HTTPException, Query, status

import ItemMaster as item_master_module
import security as security_module

router = APIRouter(prefix="/api/item-master", tags=["item-master"])


@router.get("/items")
def get_items(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=200, ge=1, le=500),
    q: str = Query(default="", max_length=150),
    include_total: bool = Query(default=True),
    user: dict = Depends(security_module.get_current_user),
):
    try:
        return {"success": True, **item_master_module.list_items(
            user["companyid"], page, page_size, q, include_total,
        )}
    except Exception as error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="품목 목록을 조회하지 못했습니다.",
        ) from error


@router.get("/items/export")
def export_items(
    q: str = Query(default="", max_length=150),
    user: dict = Depends(security_module.get_current_user),
):
    try:
        return {"success": True, "items": item_master_module.export_items(user["companyid"], q)}
    except Exception as error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="품목 목록을 내보내지 못했습니다.",
        ) from error


@router.post("/items/lookup")
def lookup_items(
    data: item_master_module.ItemLookupRequest,
    user: dict = Depends(security_module.get_current_user),
):
    try:
        return {"success": True, "items": item_master_module.lookup_items(user["companyid"], data.itemcodes)}
    except Exception as error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="품목 정보를 조회하지 못했습니다.",
        ) from error


@router.get("/items/picker")
def search_active_items(
    q: str = Query(default="", max_length=150),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    field: str = Query(default="all", pattern="^(all|name|code|material)$"),
    user: dict = Depends(security_module.get_current_user),
):
    try:
        return {"success": True, **item_master_module.search_active_items(user["companyid"], q, page, page_size, field)}
    except Exception as error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="사용 중인 품목을 조회하지 못했습니다.",
        ) from error


@router.get("/items/suggest")
def suggest_active_items(
    q: str = Query(default="", max_length=150),
    user: dict = Depends(security_module.get_current_user),
):
    try:
        return {"success": True, "items": item_master_module.suggest_active_items(user["companyid"], q)}
    except Exception as error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="품목 자동완성 목록을 조회하지 못했습니다.",
        ) from error


@router.put("/items")
def save_items(
    data: item_master_module.ItemSaveRequest,
    user: dict = Depends(security_module.get_current_user),
):
    try:
        saved_count = item_master_module.save_items(
            user["companyid"],
            user.get("companyname") or user["companyid"],
            [item.model_dump() for item in data.items],
        )
        return {"success": True, "saved_count": saved_count}
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="품목 저장 중 오류가 발생했습니다.",
        ) from error


@router.post("/items/bulk")
def bulk_insert_items(
    data: item_master_module.ItemSaveRequest,
    user: dict = Depends(security_module.get_current_user),
):
    try:
        items = [item.model_dump() | {"is_new": True} for item in data.items]
        inserted_count = item_master_module.save_items(
            user["companyid"],
            user.get("companyname") or user["companyid"],
            items,
        )
        return {"success": True, "inserted_count": inserted_count}
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="품목 일괄 등록 중 오류가 발생했습니다.",
        ) from error


@router.delete("/items")
def delete_items(
    data: item_master_module.ItemDeleteRequest,
    user: dict = Depends(security_module.get_current_user),
):
    try:
        deleted_count = item_master_module.delete_items(user["companyid"], data.itemcodes)
        return {"success": True, "deleted_count": deleted_count}
    except Exception as error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="품목 삭제 중 오류가 발생했습니다.",
        ) from error
