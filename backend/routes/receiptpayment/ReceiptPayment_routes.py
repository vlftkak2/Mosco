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


@router.get("/held-instruments")
def get_held_instruments(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    maturity_from: date | None = Query(default=None),
    maturity_to: date | None = Query(default=None),
    customer: str = Query(default="", max_length=150),
    keyword: str = Query(default="", max_length=150),
    instrumenttype: str = Query(default="", max_length=20),
    user: dict = Depends(security_module.get_current_user),
):
    """보유증권 불러오기: 보관 중인 수금 증권 목록."""
    try:
        return {"success": True, **receipt_payment_module.list_held_instruments(
            user["companyid"], page, page_size, maturity_from, maturity_to, customer, keyword, instrumenttype,
        )}
    except Exception as error:
        raise HTTPException(status_code=500, detail="보유증권을 조회하지 못했습니다.") from error


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
            actor=user.get("email"),
        )
        return {"success": True, **result}
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail="수금/지급 저장 중 오류가 발생했습니다.") from error


@router.post("/documents/{receiptno}/instrument-process")
def process_instruments(
    receiptno: str,
    data: receipt_payment_module.InstrumentProcessRequest,
    user: dict = Depends(security_module.get_current_user),
):
    """결제·할인·부도·처리취소 (저장된 전표의 증권 행)."""
    try:
        return {"success": True, **receipt_payment_module.process_instruments(
            user["companyid"], receiptno, data.model_dump(), actor=user.get("email"),
        )}
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail="증권 처리 중 오류가 발생했습니다.") from error


@router.delete("/documents/{receiptno}")
def delete_document(receiptno: str, user: dict = Depends(security_module.get_current_user)):
    try:
        if not receipt_payment_module.delete_document(user["companyid"], receiptno, actor=user.get("email")):
            raise HTTPException(status_code=404, detail="수금/지급 전표를 찾을 수 없습니다.")
        return {"success": True, "deleted_count": 1}
    except HTTPException:
        raise
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail="수금/지급 전표를 삭제하지 못했습니다.") from error
