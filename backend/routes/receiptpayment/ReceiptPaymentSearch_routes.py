from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query

import security as security_module
from services.receiptpayment import ReceiptPayment as receipt_payment_module


router = APIRouter(
    prefix="/api/receipt-payment-search",
    tags=["receipt-payment-search"],
    dependencies=[Depends(security_module.require_menu_access("RECEIPT_PAYMENT_SEARCH"))],
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
        raise HTTPException(status_code=422, detail="시작일은 종료일보다 늦을 수 없습니다.")
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
        raise HTTPException(status_code=500, detail="수금/지급 현황을 조회하지 못했습니다.") from error


@router.get("/details")
def get_detail_rows(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=15, ge=1, le=200),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    receiptno: str = Query(default="", max_length=100),
    customer: str = Query(default="", max_length=150),
    transactiontype: str = Query(default="", max_length=10),
    instrumentstatus: str = Query(default="", max_length=20),
    instrumenttype: str = Query(default="", max_length=20),
    issuekind: str = Query(default="", max_length=10),
    user: dict = Depends(security_module.get_current_user),
):
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=422, detail="시작일은 종료일보다 뒤일 수 없습니다.")
    if transactiontype and transactiontype not in {"RECEIPT", "PAYMENT"}:
        raise HTTPException(status_code=422, detail="수금/지급 구분 값이 올바르지 않습니다.")
    try:
        return {
            "success": True,
            **receipt_payment_module.list_detail_rows(
                user["companyid"], page, page_size, date_from, date_to,
                receiptno, customer, transactiontype, instrumentstatus.upper(), instrumenttype, issuekind.upper(),
            ),
        }
    except Exception as error:
        raise HTTPException(status_code=500, detail="수금/지급 현황을 조회하지 못했습니다.") from error


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
