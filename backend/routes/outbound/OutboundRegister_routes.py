from fastapi import APIRouter, Depends, HTTPException, Query
from datetime import date
from decimal import Decimal

from services.outbound import OutboundRegister as outbound_module
import security as security_module
import db as shared_db
from services.control import Approval as approval_module

router = APIRouter(
    prefix="/api/outbound-register",
    tags=["outbound-register"],
    dependencies=[Depends(security_module.require_menu_access("OUTBOUND_REGISTER"))],
)


@router.get("/available-stock")
def get_available_stock(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=500),
    item_search: str = Query(default="", max_length=150),
    warehouse_search: str = Query(default="", max_length=100),
    customname: str = Query(default="", max_length=100),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    sourcetype: str = Query(default="", pattern="^(|OPENING|INBOUND|PROCESS|TRANSFER)$"),
    receiptno: str = Query(default="", max_length=100),
    materialname: str = Query(default="", max_length=100),
    thickness: Decimal | None = Query(default=None, ge=0, max_digits=15, decimal_places=3),
    width: Decimal | None = Query(default=None, ge=0, max_digits=15, decimal_places=3),
    length: Decimal | None = Query(default=None, ge=0, max_digits=15, decimal_places=3),
    user: dict = Depends(security_module.get_current_user),
):
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=422, detail="재고 시작일은 종료일보다 뒤일 수 없습니다.")
    try:
        return {"success": True, **outbound_module.list_available_stock(
            user["companyid"], page, page_size, item_search, warehouse_search,
            customname, date_from, date_to, sourcetype, receiptno,
            materialname=materialname, thickness=thickness, width=width, length=length,
        )}
    except Exception as error:
        raise HTTPException(status_code=500, detail="매출 가능한 현재고를 조회하지 못했습니다.") from error


@router.get("/receipts")
def get_receipts(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    q: str = Query(default="", max_length=150),
    receiptno: str = Query(default="", max_length=100),
    customcode: str = Query(default="", max_length=50),
    customname: str = Query(default="", max_length=100),
    warehouse: str = Query(default="", max_length=100),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    focus_receiptno: str = Query(default="", max_length=100),
    user: dict = Depends(security_module.get_current_user),
):
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=422, detail="시작일은 종료일보다는 뒤에 올 수 없습니다.")
    try:
        return {"success": True, **outbound_module.list_receipts(
            user["companyid"], page, page_size, q, date_from, date_to,
            receiptno=receiptno, customcode=customcode, customname=customname, warehouse=warehouse,
            focus_receiptno=focus_receiptno,
        )}
    except Exception as error:
        raise HTTPException(status_code=500, detail="매출 목록을 조회하지 못했습니다.") from error


@router.get("/receipts/{receiptno}")
def get_receipt(receiptno: str, user: dict = Depends(security_module.get_current_user)):
    try:
        receipt = outbound_module.get_receipt(user["companyid"], receiptno)
        if receipt is None:
            raise HTTPException(status_code=404, detail="매출전표를 찾을 수 없습니다.")
        return {"success": True, "receipt": receipt}
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail="매출 상세를 조회하지 못했습니다.") from error


@router.get("/receipts/{receiptno}/print")
def get_print_document(receiptno: str, user: dict = Depends(security_module.get_current_user)):
    try:
        document = outbound_module.get_print_document(user["companyid"], receiptno)
        if document is None:
            raise HTTPException(status_code=404, detail="매출전표를 찾을 수 없습니다.")
        return {"success": True, "document": document}
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail="출력할 전표 정보를 조회하지 못했습니다.") from error


def _save_receipt(data: outbound_module.OutboundSaveRequest, user: dict, is_new: bool):
    try:
        payload = data.model_dump()
        payload["is_new"] = is_new
        # 승인 통제: 매출이 통제 대상이면 승인요청으로 보관하고 고른 재고를 예약 (승인되면 전표 생성)
        item = data.model_dump(mode="json")
        item["is_new"] = is_new
        weight = sum((line.weight or 0) for line in data.items)
        # 통제 확인(여신 · 예약 · 대기 전표)과 저장을 한 트랜잭션으로: 확인한 뒤 저장 사이에 다른 저장이 끼어들지 못한다
        with shared_db.shared_transaction():
            pending = approval_module.intercept(
                user, "OUTBOUND", "CREATE" if is_new else "UPDATE", "save", {"item": item},
                f"{data.customname or data.items[0].customname} · {data.receptdate} · {len(data.items)}건 · {weight:,.0f}kg"
                + ("" if is_new else f" ({data.receiptno} 수정)"),
                ref_no=None if is_new else data.receiptno,
                dates=[data.receptdate, *[line.receptdate for line in data.items if line.receptdate]],
            )
            if pending:
                return pending
            result = outbound_module.save_receipt(
                user["companyid"], user.get("companyname") or user["companyid"],
                payload,
                actor=user.get("email"),
            )
        return {"success": True, **result}
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail="매출 저장 중 오류가 발생했습니다.") from error


@router.post("/receipts")
def create_receipt(
    data: outbound_module.OutboundSaveRequest,
    user: dict = Depends(security_module.get_current_user),
):
    return _save_receipt(data, user, is_new=True)


@router.put("/receipts")
def update_receipt(
    data: outbound_module.OutboundSaveRequest,
    user: dict = Depends(security_module.get_current_user),
):
    if not data.receiptno.strip():
        raise HTTPException(status_code=422, detail="수정할 매출전표번호가 없습니다.")
    return _save_receipt(data, user, is_new=False)


@router.patch("/receipts/{receiptno}/manager")
def update_receipt_managers(
    receiptno: str,
    data: outbound_module.OutboundManagerUpdateRequest,
    user: dict = Depends(security_module.get_current_user),
):
    try:
        pending = approval_module.intercept(user, "OUTBOUND", "UPDATE", "manager", {"receiptno": receiptno, "manager": data.manager},
                                            f"{receiptno} 담당자 → {data.manager or '(없음)'}", ref_no=receiptno)
        if pending:
            return pending
        updated_count = outbound_module.update_receipt_manager(
            user["companyid"], receiptno, data.manager,
            actor=user.get("email"),
        )
        return {"success": True, "updated_count": updated_count}
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail="담당자 수정 중 오류가 발생했습니다.") from error


@router.patch("/receipts/{receiptno}/sales-fields")
def update_receipt_sales_fields(
    receiptno: str,
    data: outbound_module.OutboundSalesFieldsUpdateRequest,
    user: dict = Depends(security_module.get_current_user),
):
    """저장된 매출전표의 담당자 · 착지 · 판매단가만 수정 (재고·원가는 그대로)."""
    try:
        changed = [label for label, value in (("담당자", data.manager), ("착지", data.destination)) if value is not None]
        if data.prices:
            changed.append(f"단가 {len(data.prices)}건")
        with shared_db.shared_transaction():   # 여신 확인과 단가 수정을 한 트랜잭션으로
            pending = approval_module.intercept(user, "OUTBOUND", "UPDATE", "sales_fields",
                                                {"receiptno": receiptno, "item": data.model_dump(mode="json")},
                                                f"{receiptno} 수정 ({', '.join(changed)})", ref_no=receiptno)
            if pending:
                return pending
            result = outbound_module.update_receipt_sales_fields(
                user["companyid"], receiptno, data, actor=user.get("email"),
            )
        return {"success": True, **result}
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail="매출전표 수정 중 오류가 발생했습니다.") from error


@router.delete("/receipts/{receiptno}")
def delete_receipt(receiptno: str, user: dict = Depends(security_module.get_current_user)):
    try:
        pending = approval_module.intercept(user, "OUTBOUND", "DELETE", "delete", {"receiptno": receiptno}, f"{receiptno} 삭제", ref_no=receiptno)
        if pending:
            return pending
        deleted_count = outbound_module.delete_receipt(user["companyid"], receiptno, actor=user.get("email"))
        if not deleted_count:
            raise HTTPException(status_code=404, detail="매출전표를 찾을 수 없습니다.")
        return {"success": True, "deleted_count": deleted_count}
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail="매출 삭제 중 오류가 발생했습니다.") from error
