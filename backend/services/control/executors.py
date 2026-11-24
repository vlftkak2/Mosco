"""승인 시 실행: 보관해 둔 입력 내용(payload)을 기존 저장 로직에 그대로 넘긴다 (승인 통제).

각 실행 함수는 (companyid, companyname, data, actor) 를 받아 생긴 전표번호 / 거래처코드(또는 요약)를 돌려준다.
실패하면 ValueError — 승인은 되지 않고 요청은 대기로 남는다. actor 는 요청자(등록자 = 요청한 담당자).
"""
from services.inbound import InboundRegister as inbound_module
from services.masterdata import Customer as customer_module
from services.outbound import OutboundRegister as outbound_module
from services.receiptpayment import ReceiptPayment as receipt_payment_module


def _customer_create(companyid, companyname, data, actor):
    item = customer_module.CustomModifyRequest.model_validate({**data["item"], "companyid": companyid, "companyname": companyname})
    result = customer_module.CustomerCreate(item, actor=actor)
    if not result.get("success"):
        raise ValueError(result.get("message") or "거래처를 등록하지 못했습니다.")
    return result.get("customercode") or item.customercode


def _customer_bulk_create(companyid, companyname, data, actor):
    items = [customer_module.CustomModifyRequest.model_validate({**row, "companyid": companyid, "companyname": companyname})
             for row in data["items"]]
    result = customer_module.CustomerBulkCreate(items, actor=actor)
    if not result.get("success"):
        raise ValueError(result.get("message") or "거래처를 일괄 등록하지 못했습니다.")
    return f"{len(items)}건"


def _customer_update(companyid, companyname, data, actor):
    item = customer_module.CustomModifyRequest.model_validate({**data["item"], "companyid": companyid})
    result = customer_module.CustomerModify(item, actor=actor, update_opening_balances=bool(data.get("update_opening")))
    if not result.get("success"):
        raise ValueError(result.get("message") or "거래처를 수정하지 못했습니다.")
    return item.customercode


def _inbound_save(companyid, companyname, data, actor):
    request = inbound_module.InboundSaveRequest.model_validate(data["item"])
    result = inbound_module.save_receipt(companyid, companyname, request.model_dump(), actor=actor)
    return ", ".join(result.get("receipt_numbers") or [result.get("receiptno") or ""])


def _inbound_manager(companyid, companyname, data, actor):
    inbound_module.update_receipt_manager(companyid, data["receiptno"], data["manager"], actor=actor)
    return data["receiptno"]


def _inbound_delete(companyid, companyname, data, actor):
    if not inbound_module.delete_receipt(companyid, data["receiptno"]):
        raise ValueError("입고전표를 찾을 수 없습니다.")
    return data["receiptno"]


def _outbound_save(companyid, companyname, data, actor):
    request = outbound_module.OutboundSaveRequest.model_validate(data["item"])
    payload = request.model_dump()
    payload["is_new"] = bool(data["item"].get("is_new"))
    result = outbound_module.save_receipt(companyid, companyname, payload, actor=actor)
    return ", ".join(result.get("receipt_numbers") or [result.get("receiptno") or ""])


def _outbound_manager(companyid, companyname, data, actor):
    outbound_module.update_receipt_manager(companyid, data["receiptno"], data["manager"], actor=actor)
    return data["receiptno"]


def _outbound_sales_fields(companyid, companyname, data, actor):
    request = outbound_module.OutboundSalesFieldsUpdateRequest.model_validate(data["item"])
    outbound_module.update_receipt_sales_fields(companyid, data["receiptno"], request, actor=actor)
    return data["receiptno"]


def _outbound_delete(companyid, companyname, data, actor):
    if not outbound_module.delete_receipt(companyid, data["receiptno"], actor=actor):
        raise ValueError("매출전표를 찾을 수 없습니다.")
    return data["receiptno"]


def _receipt_payment_save(companyid, companyname, data, actor):
    request = receipt_payment_module.ReceiptPaymentSaveRequest.model_validate(data["item"])
    result = receipt_payment_module.save_document(companyid, companyname, request.model_dump(), actor=actor)
    return result.get("receiptno") or ""


def _receipt_payment_delete(companyid, companyname, data, actor):
    if not receipt_payment_module.delete_document(companyid, data["receiptno"], actor=actor):
        raise ValueError("수금/지급 전표를 찾을 수 없습니다.")
    return data["receiptno"]


EXECUTORS = {
    ("CUSTOMER", "create"): _customer_create,
    ("CUSTOMER", "bulk_create"): _customer_bulk_create,
    ("CUSTOMER", "update"): _customer_update,
    ("INBOUND", "save"): _inbound_save,
    ("INBOUND", "manager"): _inbound_manager,
    ("INBOUND", "delete"): _inbound_delete,
    ("OUTBOUND", "save"): _outbound_save,
    ("OUTBOUND", "manager"): _outbound_manager,
    ("OUTBOUND", "sales_fields"): _outbound_sales_fields,
    ("OUTBOUND", "delete"): _outbound_delete,
    ("RECEIPT_PAYMENT", "save"): _receipt_payment_save,
    ("RECEIPT_PAYMENT", "delete"): _receipt_payment_delete,
}


def run(target: str, op: str, companyid: str, companyname: str, data: dict, actor: str | None) -> str:
    executor = EXECUTORS.get((target, op))
    if executor is None:
        raise ValueError("처리할 수 없는 승인요청입니다.")
    return str(executor(companyid, companyname, data, actor) or "")
