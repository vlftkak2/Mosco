import os
import tempfile
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

import IniopStock as iniop_stock_module
import security as security_module

router = APIRouter(prefix="/api/iniop-stock", tags=["iniop-stock"])


def _filters(date_from=None, date_to=None, iniotype="", receiptno="", customcode="", customname="", itemcode="", itemname="", thickness="", width="", length="", warehousecode="", warehousecodename="", item_search="", product_search="", warehouse_search=""):
    return {
        "date_from": date_from, "date_to": date_to, "iniotype": iniotype,
        "receiptno": receiptno, "customcode": customcode, "customname": customname,
        "itemcode": itemcode, "itemname": itemname,
        "thickness": thickness, "width": width, "length": length,
        "warehousecode": warehousecode, "warehousecodename": warehousecodename,
        "item_search": item_search, "product_search": product_search, "warehouse_search": warehouse_search,
    }


@router.get("/items")
def get_iniop_stock(
    page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=500),
    date_from: date | None = Query(None), date_to: date | None = Query(None),
    iniotype: str = Query("", max_length=50), receiptno: str = Query("", max_length=100),
    customcode: str = Query("", max_length=50), customname: str = Query("", max_length=100),
    itemcode: str = Query("", max_length=100), itemname: str = Query("", max_length=150),
    thickness: str = Query("", max_length=30), width: str = Query("", max_length=30),
    length: str = Query("", max_length=30), warehousecode: str = Query("", max_length=50),
    warehousecodename: str = Query("", max_length=50),
    item_search: str = Query("", max_length=150),
    product_search: str = Query("", max_length=100),
    warehouse_search: str = Query("", max_length=100),
    user: dict = Depends(security_module.get_current_user),
):
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=422, detail="수불 시작일은 종료일보다 뒤일 수 없습니다.")
    return {"success": True, **iniop_stock_module.list_iniop_stock(
        user["companyid"], page, page_size,
        **_filters(date_from, date_to, iniotype, receiptno, customcode, customname, itemcode, itemname, thickness, width, length, warehousecode, warehousecodename, item_search, product_search, warehouse_search),
    )}


@router.get("/items/export")
def export_iniop_stock(
    date_from: date | None = Query(None), date_to: date | None = Query(None),
    iniotype: str = Query("", max_length=50), receiptno: str = Query("", max_length=100),
    customcode: str = Query("", max_length=50), customname: str = Query("", max_length=100),
    itemcode: str = Query("", max_length=100), itemname: str = Query("", max_length=150),
    thickness: str = Query("", max_length=30), width: str = Query("", max_length=30),
    length: str = Query("", max_length=30), warehousecode: str = Query("", max_length=50),
    warehousecodename: str = Query("", max_length=50),
    item_search: str = Query("", max_length=150),
    product_search: str = Query("", max_length=100),
    warehouse_search: str = Query("", max_length=100),
    user: dict = Depends(security_module.get_current_user),
):
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=422, detail="수불 시작일은 종료일보다 뒤일 수 없습니다.")
    handle, path = tempfile.mkstemp(prefix="iniop_stock_", suffix=".xlsx")
    os.close(handle)
    iniop_stock_module.write_iniop_stock_excel(
        user["companyid"], path,
        **_filters(date_from, date_to, iniotype, receiptno, customcode, customname, itemcode, itemname, thickness, width, length, warehousecode, warehousecodename, item_search, product_search, warehouse_search),
    )
    return FileResponse(
        path,
        filename="inventory_ledger.xlsx",
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        background=BackgroundTask(os.unlink, path),
    )
