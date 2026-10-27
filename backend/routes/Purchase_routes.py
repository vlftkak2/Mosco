from datetime import date
from pydantic import BaseModel, Field

from fastapi import APIRouter, Depends, HTTPException, Query

import Purchase as purchase
import security

router = APIRouter(
    prefix='/api/purchase',
    tags=['purchase'],
    dependencies=[Depends(security.require_menu_access("INBOUND_REGISTER"))],
)


class ResolveRequest(BaseModel):
    kind: str
    values: list[str] = Field(max_length=500)


@router.get('/orders')
def orders(page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200),
           date_from: date | None = None, date_to: date | None = None,
           customname: str = '', purchaseno: str = '', user: dict = Depends(security.get_current_user)):
    if date_from and date_to and date_from > date_to:
        raise HTTPException(422, '시작일이 종료일보다 늦습니다.')
    return purchase.list_purchases(user['companyid'], page, page_size, date_from, date_to,
                                   customname, purchaseno)


@router.get('/orders/{purchaseno}')
def order(purchaseno: str, user: dict = Depends(security.get_current_user)):
    result = purchase.get_purchase(user['companyid'], purchaseno)
    if not result:
        raise HTTPException(404, '매입 전표가 없습니다.')
    return result


@router.get('/inbound-candidates')
def inbound_candidates(q: str = '', user: dict = Depends(security.get_current_user)):
    return {'items': purchase.list_inbound_candidates(user['companyid'], q)}


@router.get('/inbound-candidates/{receiptno}')
def inbound_preview(receiptno: str, user: dict = Depends(security.get_current_user)):
    result = purchase.get_inbound_preview(user['companyid'], receiptno)
    if not result:
        raise HTTPException(404, '입고 전표가 없습니다.')
    return result


@router.get('/resolve/{kind}')
def resolve_master(kind: str, value: str, user: dict = Depends(security.get_current_user)):
    try:
        result = purchase.resolve_token(user['companyid'], kind, value)
    except ValueError as error:
        raise HTTPException(409, str(error)) from error
    if not result:
        raise HTTPException(404, '일치하는 사용 가능 마스터가 없습니다.')
    return result


@router.post('/resolve-bulk')
def resolve_bulk(payload: ResolveRequest, user: dict = Depends(security.get_current_user)):
    if payload.kind not in ('customer', 'item', 'unit', 'qtyunit', 'warehouse'):
        raise HTTPException(422, '마스터 구분이 올바르지 않습니다.')
    result = {}
    for value in set(payload.values):
        try:
            result[value] = purchase.resolve_token(user['companyid'], payload.kind, value)
        except ValueError as error:
            raise HTTPException(409, str(error)) from error
    return {'items': result}


@router.put('/orders')
def save_order(data: purchase.PurchaseInput, user: dict = Depends(security.get_current_user)):
    try:
        return purchase.save_purchase(user['companyid'], str(user.get('companyname') or ''),
                                      str(user.get('username') or ''), data)
    except ValueError as error:
        raise HTTPException(409, str(error)) from error


@router.delete('/orders/{purchaseno}')
def delete_order(purchaseno: str, user: dict = Depends(security.get_current_user)):
    if not purchase.delete_purchase(user['companyid'], purchaseno):
        raise HTTPException(404, '매입 전표가 없습니다.')
    return {'success': True}
