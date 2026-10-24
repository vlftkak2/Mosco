from fastapi import APIRouter, Depends, HTTPException, Query
from datetime import date

import InboundRegister as inbound_module
import security as security_module

router = APIRouter(prefix="/api/inbound-register", tags=["inbound-register"])


@router.get("/receipts")
def get_receipts(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    q: str = Query(default="", max_length=150),
    receiptno: str = Query(default="", max_length=100),
    customer: str = Query(default="", max_length=100),
    customcode: str = Query(default="", max_length=50),
    customname: str = Query(default="", max_length=100),
    warehouse: str = Query(default="", max_length=100),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    user: dict = Depends(security_module.get_current_user),
):
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=422, detail="시작일은 종료일보다는 뒤에 올 수 없습니다.")
    try:
        return {"success": True, **inbound_module.list_receipts(
            user["companyid"], page, page_size, q, date_from, date_to,
            receiptno=receiptno, customer=customer, customcode=customcode, customname=customname, warehouse=warehouse,
        )}
    except Exception as error:
        raise HTTPException(status_code=500, detail="입고 목록을 조회하지 못했습니다.") from error


@router.get("/receipts/{receiptno}")
def get_receipt(receiptno: str, user: dict = Depends(security_module.get_current_user)):
    try:
        receipt = inbound_module.get_receipt(user["companyid"], receiptno)
        if receipt is None:
            raise HTTPException(status_code=404, detail="입고전표를 찾을 수 없습니다.")
        return {"success": True, "receipt": receipt}
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail="입고 상세를 조회하지 못했습니다.") from error


@router.put("/receipts")
def save_receipt(
    data: inbound_module.InboundSaveRequest,
    user: dict = Depends(security_module.get_current_user),
):
    try:
        result = inbound_module.save_receipt(
            user["companyid"], user.get("companyname") or user["companyid"],
            data.model_dump(),
        )
        return {"success": True, **result}
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail="입고 저장 중 오류가 발생했습니다.") from error


@router.patch("/receipts/{receiptno}/manager")
def update_receipt_managers(
    receiptno: str,
    data: inbound_module.InboundManagerUpdateRequest,
    user: dict = Depends(security_module.get_current_user),
):
    try:
        updated_count = inbound_module.update_receipt_managers(
            user["companyid"], receiptno, [item.model_dump() for item in data.items],
        )
        return {"success": True, "updated_count": updated_count}
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail="담당자 수정 중 오류가 발생했습니다.") from error


@router.delete("/receipts/{receiptno}")
def delete_receipt(receiptno: str, user: dict = Depends(security_module.get_current_user)):
    try:
        deleted_count = inbound_module.delete_receipt(user["companyid"], receiptno)
        if not deleted_count:
            raise HTTPException(status_code=404, detail="입고전표를 찾을 수 없습니다.")
        return {"success": True, "deleted_count": deleted_count}
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail="입고 삭제 중 오류가 발생했습니다.") from error
