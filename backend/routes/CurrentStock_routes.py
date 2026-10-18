import os
import tempfile

from fastapi import APIRouter, Depends, Query
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

import CurrentStock as current_stock_module
import security as security_module

router = APIRouter(prefix="/api/current-stock", tags=["current-stock"])


def _filters(itemcode="", itemname="", size="", warehousecode="", warehousecodename="", qtyunit=""):
    return {
        "itemcode": itemcode, "itemname": itemname, "size": size,
        "warehousecode": warehousecode, "warehousecodename": warehousecodename, "qtyunit": qtyunit,
    }


@router.get("/items")
def get_current_stock(
    page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=500),
    itemcode: str = Query("", max_length=100), itemname: str = Query("", max_length=150),
    size: str = Query("", max_length=100), warehousecode: str = Query("", max_length=50),
    warehousecodename: str = Query("", max_length=50), qtyunit: str = Query("", max_length=20),
    user: dict = Depends(security_module.get_current_user),
):
    return {"success": True, **current_stock_module.list_current_stock(
        user["companyid"], page, page_size,
        **_filters(itemcode, itemname, size, warehousecode, warehousecodename, qtyunit),
    )}


@router.post("/lookup")
def lookup_current_stock(
    data: current_stock_module.StockLookupRequest,
    user: dict = Depends(security_module.get_current_user),
):
    return {"success": True, "items": current_stock_module.lookup_stock(
        user["companyid"], [item.model_dump() for item in data.items],
    )}


@router.get("/items/export")
def export_current_stock(
    itemcode: str = Query("", max_length=100), itemname: str = Query("", max_length=150),
    size: str = Query("", max_length=100), warehousecode: str = Query("", max_length=50),
    warehousecodename: str = Query("", max_length=50), qtyunit: str = Query("", max_length=20),
    user: dict = Depends(security_module.get_current_user),
):
    handle, path = tempfile.mkstemp(prefix="current_stock_", suffix=".xlsx")
    os.close(handle)
    current_stock_module.write_current_stock_excel(
        user["companyid"], path,
        **_filters(itemcode, itemname, size, warehousecode, warehousecodename, qtyunit),
    )
    return FileResponse(
        path,
        filename="current_stock.xlsx",
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        background=BackgroundTask(os.unlink, path),
    )
