from fastapi import APIRouter, Depends, HTTPException, Query
from datetime import date

import OutboundRegister as outbound_module
import security as security_module

router = APIRouter(prefix="/api/outbound-register", tags=["outbound-register"])


@router.get("/receipts")
def get_receipts(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    q: str = Query(default="", max_length=150),
    receiptno: str = Query(default="", max_length=100),
    customcode: str = Query(default="", max_length=50),
    customname: str = Query(default="", max_length=100),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    user: dict = Depends(security_module.get_current_user),
):
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=422, detail="\uC2DC\uC791\uC77C\uC740 \uC885\uB8CC\uC77C\uBCF4\uB2E4 \uB4A4\uC5D0 \uC62C \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.")
    try:
        return {"success": True, **outbound_module.list_receipts(
            user["companyid"], page, page_size, q, date_from, date_to,
            receiptno=receiptno, customcode=customcode, customname=customname,
        )}
    except Exception as error:
        raise HTTPException(status_code=500, detail="출고 목록을 조회하지 못했습니다.") from error


@router.get("/receipts/{receiptno}")
def get_receipt(receiptno: str, user: dict = Depends(security_module.get_current_user)):
    try:
        receipt = outbound_module.get_receipt(user["companyid"], receiptno)
        if receipt is None:
            raise HTTPException(status_code=404, detail="출고전표를 찾을 수 없습니다.")
        return {"success": True, "receipt": receipt}
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail="출고 상세를 조회하지 못했습니다.") from error


@router.put("/receipts")
def save_receipt(
    data: outbound_module.OutboundSaveRequest,
    user: dict = Depends(security_module.get_current_user),
):
    try:
        result = outbound_module.save_receipt(
            user["companyid"], user.get("companyname") or user["companyid"],
            data.model_dump(),
        )
        return {"success": True, **result}
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail="출고 저장 중 오류가 발생했습니다.") from error


@router.delete("/receipts/{receiptno}")
def delete_receipt(receiptno: str, user: dict = Depends(security_module.get_current_user)):
    try:
        deleted_count = outbound_module.delete_receipt(user["companyid"], receiptno)
        if not deleted_count:
            raise HTTPException(status_code=404, detail="출고전표를 찾을 수 없습니다.")
        return {"success": True, "deleted_count": deleted_count}
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail="출고 삭제 중 오류가 발생했습니다.") from error
