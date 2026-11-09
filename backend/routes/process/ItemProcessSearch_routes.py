from datetime import date
import os
import tempfile

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from services.process import ItemProcess as process_module
import security as security_module


router = APIRouter(
    prefix="/api/item-process-search",
    tags=["item-process-search"],
    dependencies=[Depends(security_module.require_menu_access("ITEM_PROCESS_SEARCH"))],
)


def _validate_dates(date_from: date | None, date_to: date | None):
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=422, detail="가공 시작일은 종료일보다 늦을 수 없습니다.")


def _filters(
    date_from, date_to, processno, customer, warehouse, iteminfo, processmethod,
):
    return {
        "date_from": date_from,
        "date_to": date_to,
        "processno": processno,
        "customer": customer,
        "warehouse": warehouse,
        "iteminfo": iteminfo,
        "processmethod": processmethod,
    }


@router.get("/documents")
def documents(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=15, ge=1, le=200),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    processno: str = Query(default="", max_length=100),
    customer: str = Query(default="", max_length=150),
    warehouse: str = Query(default="", max_length=150),
    iteminfo: str = Query(default="", max_length=150),
    processmethod: str = Query(default="", max_length=100),
    user: dict = Depends(security_module.get_current_user),
):
    _validate_dates(date_from, date_to)
    try:
        return {
            "success": True,
            **process_module.list_documents(
                user["companyid"], page, page_size,
                **_filters(date_from, date_to, processno, customer, warehouse, iteminfo, processmethod),
            ),
        }
    except Exception as error:
        raise HTTPException(status_code=500, detail="가공현황을 조회하지 못했습니다.") from error


@router.get("/documents/export")
def export_documents(
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    processno: str = Query(default="", max_length=100),
    customer: str = Query(default="", max_length=150),
    warehouse: str = Query(default="", max_length=150),
    iteminfo: str = Query(default="", max_length=150),
    processmethod: str = Query(default="", max_length=100),
    user: dict = Depends(security_module.get_current_user),
):
    _validate_dates(date_from, date_to)
    temp_file = tempfile.NamedTemporaryFile(prefix="item-process-search-", suffix=".xlsx", delete=False)
    temp_file.close()
    try:
        process_module.write_documents_excel(
            user["companyid"], temp_file.name,
            **_filters(date_from, date_to, processno, customer, warehouse, iteminfo, processmethod),
        )
    except Exception as error:
        os.unlink(temp_file.name)
        raise HTTPException(status_code=500, detail="가공현황 엑셀 파일을 만들지 못했습니다.") from error

    filename = f"재고가공현황_{date.today():%Y%m%d}.xlsx"
    return FileResponse(
        temp_file.name,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=filename,
        background=BackgroundTask(os.unlink, temp_file.name),
    )
