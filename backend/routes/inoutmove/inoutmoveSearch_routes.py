from datetime import date
import os
import tempfile

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from services.inoutmove import inoutmoveSearch as search_module
import security as security_module

router = APIRouter(
    prefix="/api/inoutmove-search",
    tags=["inoutmove-search"],
    dependencies=[Depends(security_module.require_menu_access("INOUTMOVE_SEARCH"))],
)


def _validate_date_range(date_from: date | None, date_to: date | None):
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=422, detail="조회 시작일은 종료일보다 늦을 수 없습니다.")


@router.get("/documents")
def get_transfer_documents(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=15, ge=1, le=200),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    receiptno: str = Query(default="", max_length=100),
    fromwarehouse: str = Query(default="", max_length=150),
    towarehouse: str = Query(default="", max_length=150),
    iteminfo: str = Query(default="", max_length=200),
    productinfo: str = Query(default="", max_length=200),
    user: dict = Depends(security_module.get_current_user),
):
    _validate_date_range(date_from, date_to)
    return {"success": True, **search_module.list_transfer_documents(
        user["companyid"], page, page_size, date_from, date_to,
        receiptno, fromwarehouse, towarehouse, iteminfo, productinfo,
    )}


@router.get("/documents/{receiptno}")
def get_transfer_document(receiptno: str, user: dict = Depends(security_module.get_current_user)):
    document = search_module.get_transfer_document(user["companyid"], receiptno)
    if not document:
        raise HTTPException(status_code=404, detail="재고이전 전표를 찾을 수 없습니다.")
    return {"success": True, "item": document}


@router.get("/details")
def get_transfer_details(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=15, ge=1, le=200),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    receiptno: str = Query(default="", max_length=100),
    fromwarehouse: str = Query(default="", max_length=150),
    towarehouse: str = Query(default="", max_length=150),
    iteminfo: str = Query(default="", max_length=200),
    productinfo: str = Query(default="", max_length=200),
    user: dict = Depends(security_module.get_current_user),
):
    _validate_date_range(date_from, date_to)
    try:
        return {
            "success": True,
            **search_module.list_transfer_details(
                user["companyid"], page, page_size,
                date_from=date_from,
                date_to=date_to,
                receiptno=receiptno,
                fromwarehouse=fromwarehouse,
                towarehouse=towarehouse,
                iteminfo=iteminfo,
                productinfo=productinfo,
            ),
        }
    except Exception as error:
        raise HTTPException(status_code=500, detail="재고이전현황을 조회하지 못했습니다.") from error


@router.get("/details/export")
def export_transfer_details(
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    receiptno: str = Query(default="", max_length=100),
    fromwarehouse: str = Query(default="", max_length=150),
    towarehouse: str = Query(default="", max_length=150),
    iteminfo: str = Query(default="", max_length=200),
    productinfo: str = Query(default="", max_length=200),
    user: dict = Depends(security_module.get_current_user),
):
    _validate_date_range(date_from, date_to)
    temp_file = tempfile.NamedTemporaryFile(prefix="inoutmove-search-", suffix=".xlsx", delete=False)
    temp_file.close()
    try:
        search_module.write_transfer_details_excel(
            user["companyid"], temp_file.name,
            date_from=date_from,
            date_to=date_to,
            receiptno=receiptno,
            fromwarehouse=fromwarehouse,
            towarehouse=towarehouse,
            iteminfo=iteminfo,
            productinfo=productinfo,
        )
    except Exception as error:
        os.unlink(temp_file.name)
        raise HTTPException(status_code=500, detail="재고이동현황 엑셀 파일을 만들지 못했습니다.") from error

    filename = f"재고이동현황_{date.today():%Y%m%d}.xlsx"
    return FileResponse(
        temp_file.name,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=filename,
        background=BackgroundTask(os.unlink, temp_file.name),
    )
