from datetime import date
import os
import tempfile

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

import InboundSearch as inbound_search_module
import security as security_module

router = APIRouter(prefix="/api/inbound-search", tags=["inbound-search"])


@router.get("/details/export")
def export_inbound_details(
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    receiptno: str = Query(default="", max_length=100),
    customcode: str = Query(default="", max_length=50),
    customname: str = Query(default="", max_length=100),
    itemcode: str = Query(default="", max_length=100),
    itemname: str = Query(default="", max_length=150),
    user: dict = Depends(security_module.get_current_user),
):
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=422, detail="입고 시작일은 입고 종료일보다 늦을 수 없습니다.")

    temp_file = tempfile.NamedTemporaryFile(prefix="inbound-search-", suffix=".xlsx", delete=False)
    temp_file.close()
    try:
        inbound_search_module.write_inbound_details_excel(
            user["companyid"], temp_file.name,
            date_from=date_from,
            date_to=date_to,
            receiptno=receiptno,
            customcode=customcode,
            customname=customname,
            itemcode=itemcode,
            itemname=itemname,
        )
    except Exception as error:
        os.unlink(temp_file.name)
        raise HTTPException(status_code=500, detail="입고현황 엑셀 파일을 만들지 못했습니다.") from error

    filename = f"입고현황_{date.today():%Y%m%d}.xlsx"
    return FileResponse(
        temp_file.name,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=filename,
        background=BackgroundTask(os.unlink, temp_file.name),
    )


@router.get("/details")
def get_inbound_details(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    receiptno: str = Query(default="", max_length=100),
    customcode: str = Query(default="", max_length=50),
    customname: str = Query(default="", max_length=100),
    itemcode: str = Query(default="", max_length=100),
    itemname: str = Query(default="", max_length=150),
    user: dict = Depends(security_module.get_current_user),
):
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=422, detail="시작일은 종료일보다 뒤일 수 없습니다.")
    try:
        return {
            "success": True,
            **inbound_search_module.list_inbound_details(
                user["companyid"], page, page_size,
                date_from=date_from,
                date_to=date_to,
                receiptno=receiptno,
                customcode=customcode,
                customname=customname,
                itemcode=itemcode,
                itemname=itemname,
            ),
        }
    except Exception as error:
        raise HTTPException(status_code=500, detail="입고현황을 조회하지 못했습니다.") from error
