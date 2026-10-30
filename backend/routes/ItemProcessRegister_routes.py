from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query

import ItemProcessRegister as process_module
import security as security_module


router = APIRouter(
    prefix="/api/item-process-register",
    tags=["item-process-register"],
    dependencies=[Depends(security_module.require_menu_access("ITEM_PROCESS_REGISTER"))],
)


@router.get("/documents")
def documents(date_from: date | None = None, date_to: date | None = None,
              q: str = Query(default="", max_length=150),
              user: dict = Depends(security_module.get_current_user)):
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=422, detail="시작일은 종료일보다 늦을 수 없습니다.")
    try:
        return {"success": True, "items": process_module.list_documents(user["companyid"], date_from, date_to, q)}
    except Exception as error:
        raise HTTPException(status_code=500, detail="가공전표 목록을 조회하지 못했습니다.") from error


@router.get("/available-stock")
def available_stock(page: int = Query(default=1, ge=1), page_size: int = Query(default=50, ge=1, le=200),
                    q: str = Query(default="", max_length=150), warehouse: str = Query(default="", max_length=100),
                    user: dict = Depends(security_module.get_current_user)):
    try:
        return {"success": True, **process_module.list_available_stock(user["companyid"], page, page_size, q, warehouse)}
    except Exception as error:
        raise HTTPException(status_code=500, detail="가공 가능한 현재고를 조회하지 못했습니다.") from error


@router.get("/documents/{processno}")
def document(processno: str, user: dict = Depends(security_module.get_current_user)):
    try:
        result = process_module.get_document(user["companyid"], processno)
        if result is None:
            raise HTTPException(status_code=404, detail="가공전표를 찾을 수 없습니다.")
        return {"success": True, **result}
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail="가공전표 상세를 조회하지 못했습니다.") from error


@router.get("/options")
def options(user: dict = Depends(security_module.get_current_user)):
    try:
        return {"success": True, **process_module.get_options(user["companyid"])}
    except Exception as error:
        raise HTTPException(status_code=500, detail="가공 등록 기준정보를 조회하지 못했습니다.") from error


@router.post("/documents")
def save_document(data: process_module.ProcessSaveRequest,
                  user: dict = Depends(security_module.get_current_user)):
    try:
        return {"success": True, **process_module.save_document(
            user["companyid"], user.get("companyname") or user["companyid"], data.model_dump()
        )}
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        process_module.logger.exception("가공전표 저장 실패 company=%s", user.get("companyid"))
        raise HTTPException(status_code=500, detail="가공전표 저장 중 오류가 발생했습니다. 모든 변경을 취소했습니다.") from error
