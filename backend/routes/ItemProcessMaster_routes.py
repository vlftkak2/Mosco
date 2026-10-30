from fastapi import APIRouter, Depends, HTTPException, Query, status
from psycopg2 import IntegrityError

import ItemProcessMaster as item_process_module
import security as security_module


router = APIRouter(
    prefix="/api/item-process-master",
    tags=["item-process-master"],
    dependencies=[Depends(security_module.require_menu_access("ITEM_PROCESS_MASTER"))],
)


@router.get("/rules")
def get_rules(
    q: str = Query(default="", max_length=150),
    process_name: str = Query(default="", max_length=100),
    itemtype_name: str = Query(default="", max_length=100),
    output_name: str = Query(default="", max_length=150),
    user: dict = Depends(security_module.get_current_user),
):
    try:
        items = item_process_module.list_rules(user["companyid"], q, process_name, itemtype_name, output_name)
        return {"success": True, "items": items, "total": len(items)}
    except Exception as error:
        raise HTTPException(status_code=500, detail="가공공정 목록을 조회하지 못했습니다.") from error


@router.get("/options")
def get_filter_options(user: dict = Depends(security_module.get_current_user)):
    try:
        return {"success": True, **item_process_module.list_filter_options(user["companyid"])}
    except Exception as error:
        raise HTTPException(status_code=500, detail="가공공정 조회조건을 불러오지 못했습니다.") from error


@router.get("/items/picker")
def get_item_picker(
    q: str = Query(default="", max_length=150),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    user: dict = Depends(security_module.get_current_user),
):
    try:
        return {"success": True, **item_process_module.search_active_items(
            user["companyid"], q, page, page_size,
        )}
    except Exception as error:
        raise HTTPException(status_code=500, detail="원소재 품목을 조회하지 못했습니다.") from error


@router.get("/items/suggest")
def get_item_suggestions(
    q: str = Query(default="", max_length=150),
    user: dict = Depends(security_module.get_current_user),
):
    try:
        return {"success": True, "items": item_process_module.suggest_active_items(user["companyid"], q)}
    except Exception as error:
        raise HTTPException(status_code=500, detail="원소재 품목 자동완성을 조회하지 못했습니다.") from error


@router.put("/rules")
def save_rules(
    data: item_process_module.ProcessRuleSaveRequest,
    user: dict = Depends(security_module.get_current_user),
):
    try:
        count = item_process_module.save_rules(
            user["companyid"],
            user.get("companyname") or user["companyid"],
            [item.model_dump() for item in data.items],
        )
        return {"success": True, "saved_count": count}
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
    except IntegrityError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="동일한 원소재 품목과 가공공정이 이미 등록되어 있습니다.",
        ) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail="가공공정 저장 중 오류가 발생했습니다.") from error


@router.post("/rules/delete")
def delete_rules(
    data: item_process_module.ProcessRuleDeleteRequest,
    user: dict = Depends(security_module.get_current_user),
):
    try:
        count = item_process_module.delete_rules(
            user["companyid"], [item.model_dump() for item in data.items]
        )
        return {"success": True, "deleted_count": count}
    except Exception as error:
        raise HTTPException(status_code=500, detail="가공공정 삭제 중 오류가 발생했습니다.") from error
