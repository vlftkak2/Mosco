from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query

from services.inoutmove import inoutmoveRegister as transfer_module
import security as security_module

router = APIRouter(
    prefix="/api/inoutmove-register",
    tags=["inoutmove-register"],
    dependencies=[Depends(security_module.require_menu_access("INOUTMOVE_REGISTER"))],
)


@router.get("/warehouses")
def get_warehouses(user: dict = Depends(security_module.get_current_user)):
    try:
        return {"success": True, "items": transfer_module.list_warehouses(user["companyid"])}
    except Exception as error:
        raise HTTPException(status_code=500, detail="회사 창고 목록을 조회하지 못했습니다.") from error


@router.get("/available-stock")
def get_available_stock(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=500),
    item_search: str = Query(default="", max_length=150),
    warehouse_search: str = Query(default="", max_length=100),
    sourcetype: str = Query(default="", pattern="^(|OPENING|INBOUND|PROCESS)$"),
    receiptno: str = Query(default="", max_length=100),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    thickness: str = Query(default="", max_length=30),
    width: str = Query(default="", max_length=30),
    length: str = Query(default="", max_length=30),
    user: dict = Depends(security_module.get_current_user),
):
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=422, detail="조회 시작일은 종료일보다 늦을 수 없습니다.")
    try:
        return {"success": True, **transfer_module.list_available_stock(
            user["companyid"], page, page_size, item_search, warehouse_search,
            sourcetype, receiptno, date_from, date_to, thickness, width, length,
        )}
    except Exception as error:
        raise HTTPException(status_code=500, detail="이전 가능한 현재고를 조회하지 못했습니다.") from error


@router.get("/documents")
def get_documents(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    receiptno: str = Query(default="", max_length=100),
    warehouse: str = Query(default="", max_length=100),
    user: dict = Depends(security_module.get_current_user),
):
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=422, detail="조회 시작일은 종료일보다 늦을 수 없습니다.")
    try:
        return {"success": True, **transfer_module.list_transfers(
            user["companyid"], page, page_size, date_from, date_to, receiptno, warehouse,
        )}
    except Exception as error:
        raise HTTPException(status_code=500, detail="재고이전 목록을 조회하지 못했습니다.") from error


@router.get("/documents/{receiptno}")
def get_document(receiptno: str, user: dict = Depends(security_module.get_current_user)):
    try:
        document = transfer_module.get_transfer(user["companyid"], receiptno)
        if document is None:
            raise HTTPException(status_code=404, detail="재고이전 전표를 찾을 수 없습니다.")
        return {"success": True, "document": document}
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail="재고이전 상세를 조회하지 못했습니다.") from error


@router.post("/documents")
def create_document(data: transfer_module.TransferSaveRequest, user: dict = Depends(security_module.get_current_user)):
    try:
        return {"success": True, **transfer_module.save_transfer(
            user["companyid"], user.get("companyname") or user["companyid"], data.model_dump(),
        )}
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail="재고이전 저장에 실패했습니다. 변경 사항은 모두 취소했습니다.") from error


@router.delete("/documents/{receiptno}")
def delete_document(receiptno: str, user: dict = Depends(security_module.get_current_user)):
    try:
        deleted = transfer_module.delete_transfer(user["companyid"], receiptno)
        if not deleted:
            raise HTTPException(status_code=404, detail="재고이전 전표를 찾을 수 없습니다.")
        return {"success": True, "deleted_count": deleted}
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail="재고이전 삭제에 실패했습니다. 변경 사항은 모두 취소했습니다.") from error
