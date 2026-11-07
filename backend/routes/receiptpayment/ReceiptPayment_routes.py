from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query

import security as security_module
from services.receiptpayment import ReceiptPayment as receipt_payment_module


router = APIRouter(
    prefix="/api/receipt-payment",
    tags=["receipt-payment"],
    dependencies=[Depends(security_module.require_menu_access("RECEIPT_PAYMENT"))],
)


@router.get("/documents")
def get_documents(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=15, ge=1, le=200),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    receiptno: str = Query(default="", max_length=100),
    customer: str = Query(default="", max_length=150),
    transactiontype: str = Query(default="", max_length=10),
    user: dict = Depends(security_module.get_current_user),
):
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=422, detail="시작일은 종료일보다 뒤일 수 없습니다.")
    if transactiontype and transactiontype not in {"RECEIPT", "PAYMENT"}:
        raise HTTPException(status_code=422, detail="수금/지급 구분 값이 올바르지 않습니다.")
    try:
        return {
            "success": True,
            **receipt_payment_module.list_documents(
                user["companyid"], page, page_size, date_from, date_to,
                receiptno, customer, transactiontype,
            ),
        }
    except Exception as error:
        raise HTTPException(status_code=500, detail="수금/지급 목록을 조회하지 못했습니다.") from error


@router.get("/customers")
def get_customers(
    q: str = Query(default="", max_length=150),
    user: dict = Depends(security_module.get_current_user),
):
    try:
        return {"success": True, "customers": receipt_payment_module.search_customers(user["companyid"], q)}
    except Exception as error:
        raise HTTPException(status_code=500, detail="거래처 목록을 조회하지 못했습니다.") from error


@router.get("/documents/{receiptno}")
def get_document(receiptno: str, user: dict = Depends(security_module.get_current_user)):
    try:
        document = receipt_payment_module.get_document(user["companyid"], receiptno)
        if document is None:
            raise HTTPException(status_code=404, detail="수금/지급 전표를 찾을 수 없습니다.")
        return {"success": True, "document": document}
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail="수금/지급 상세를 조회하지 못했습니다.") from error


@router.put("/documents")
def save_document(
    data: receipt_payment_module.ReceiptPaymentSaveRequest,
    user: dict = Depends(security_module.get_current_user),
):
    try:
        result = receipt_payment_module.save_document(
            user["companyid"], user.get("companyname") or user["companyid"], data.model_dump(),
        )
        return {"success": True, **result}
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail="수금/지급 저장 중 오류가 발생했습니다.") from error


@router.delete("/documents/{receiptno}")
def delete_document(receiptno: str, user: dict = Depends(security_module.get_current_user)):
    try:
        if not receipt_payment_module.delete_document(user["companyid"], receiptno):
            raise HTTPException(status_code=404, detail="수금/지급 전표를 찾을 수 없습니다.")
        return {"success": True, "deleted_count": 1}
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail="수금/지급 전표를 삭제하지 못했습니다.") from error
