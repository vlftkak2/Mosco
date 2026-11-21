import os
import tempfile

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from services.inventory import CurrentStock as current_stock_module
import security as security_module

router = APIRouter(
    prefix="/api/current-stock",
    tags=["current-stock"],
    dependencies=[Depends(security_module.require_menu_access("STOCK_CURRENT"))],
)


def _filters(itemcode="", itemname="", thickness="", width="", length="", warehousecode="", warehousecodename="",
             sourcetype="", customname="", include_zero=False, item_search="", product_search="", warehouse_search="",
             receipt_search="", date_from=None, date_to=None, remark_search=""):
    return {
        "itemcode": itemcode, "itemname": itemname,
        "thickness": thickness, "width": width, "length": length,
        "warehousecode": warehousecode, "warehousecodename": warehousecodename,
        "sourcetype": sourcetype, "customname": customname, "include_zero": include_zero,
        "item_search": item_search, "product_search": product_search, "warehouse_search": warehouse_search,
        "receipt_search": receipt_search, "remark_search": remark_search,
        "date_from": date_from, "date_to": date_to,
    }


@router.get("/items")
def get_current_stock(
    page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=500),
    itemcode: str = Query("", max_length=100), itemname: str = Query("", max_length=150),
    thickness: str = Query("", max_length=30), width: str = Query("", max_length=30),
    length: str = Query("", max_length=30), warehousecode: str = Query("", max_length=50),
    warehousecodename: str = Query("", max_length=50),
    sourcetype: str = Query("", pattern="^(|OPENING|INBOUND|PROCESS|TRANSFER)$"), customname: str = Query("", max_length=100),
    item_search: str = Query("", max_length=150), product_search: str = Query("", max_length=100),
    warehouse_search: str = Query("", max_length=100), receipt_search: str = Query("", max_length=100),
    remark_search: str = Query("", max_length=100),
    date_from: str = Query("", max_length=10), date_to: str = Query("", max_length=10),
    include_zero: bool = Query(False),
    user: dict = Depends(security_module.get_current_user),
):
    return {"success": True, **current_stock_module.list_current_stock(
        user["companyid"], page, page_size,
        **_filters(itemcode, itemname, thickness, width, length, warehousecode, warehousecodename,
                   sourcetype, customname, include_zero, item_search, product_search, warehouse_search, receipt_search, date_from, date_to,
                   remark_search),
    )}


@router.get("/lots/cost-history")
def get_lot_cost_history(
    sourcetype: str = Query(..., min_length=1, max_length=20),
    sourceno: str = Query(..., min_length=1, max_length=100),
    sourceline: int = Query(..., ge=0),
    user: dict = Depends(security_module.get_current_user),
):
    history = current_stock_module.get_lot_cost_history(user["companyid"], sourcetype.strip().upper(), sourceno.strip(), sourceline)
    if history is None:
        raise HTTPException(status_code=404, detail="재고 로트를 찾을 수 없습니다. 목록을 새로고침해 주세요.")
    return {"success": True, **history}


@router.patch("/lots/remarks")
def save_lot_remarks(
    data: current_stock_module.StockRemarkSaveRequest,
    user: dict = Depends(security_module.get_current_user),
):
    """현재고 비고 저장 (여러 줄 한 번에). 수량 · 원가에는 영향 없음."""
    try:
        saved = current_stock_module.save_lot_remarks(
            user["companyid"], [item.model_dump() for item in data.items], actor=user.get("email"),
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return {"success": True, "saved_count": saved}


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
    thickness: str = Query("", max_length=30), width: str = Query("", max_length=30),
    length: str = Query("", max_length=30), warehousecode: str = Query("", max_length=50),
    warehousecodename: str = Query("", max_length=50),
    sourcetype: str = Query("", pattern="^(|OPENING|INBOUND|PROCESS|TRANSFER)$"), customname: str = Query("", max_length=100),
    item_search: str = Query("", max_length=150), product_search: str = Query("", max_length=100),
    warehouse_search: str = Query("", max_length=100), receipt_search: str = Query("", max_length=100),
    remark_search: str = Query("", max_length=100),
    date_from: str = Query("", max_length=10), date_to: str = Query("", max_length=10),
    include_zero: bool = Query(False),
    user: dict = Depends(security_module.get_current_user),
):
    handle, path = tempfile.mkstemp(prefix="current_stock_", suffix=".xlsx")
    os.close(handle)
    current_stock_module.write_current_stock_excel(
        user["companyid"], path,
        **_filters(itemcode, itemname, thickness, width, length, warehousecode, warehousecodename,
                   sourcetype, customname, include_zero, item_search, product_search, warehouse_search, receipt_search, date_from, date_to,
                   remark_search),
    )
    return FileResponse(
        path,
        filename="current_stock.xlsx",
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        background=BackgroundTask(os.unlink, path),
    )
