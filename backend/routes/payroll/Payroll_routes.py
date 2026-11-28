"""급여관리 API (services/payroll/Payroll.py). 모든 요청은 로그인한 회사(companyid) 급여만 다룬다."""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

import security as security_module
from services.payroll import Payroll as payroll_module

router = APIRouter(prefix="/api/payroll", tags=["payroll"])

_YM = r"^\d{4}-\d{2}$"


def _call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except PermissionError as error:
        raise HTTPException(status_code=403, detail=str(error)) from error
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


class CalcInput(BaseModel):
    payym: str = Field(pattern=_YM)
    slip: dict = Field(default_factory=dict)


class SaveInput(BaseModel):
    payym: str = Field(pattern=_YM)
    useremail: str = Field(min_length=1, max_length=100)
    paydate: date
    slip: dict = Field(default_factory=dict)


class GenerateInput(BaseModel):
    payym: str = Field(pattern=_YM)
    paydate: date


class CloseInput(BaseModel):
    payym: str = Field(pattern=_YM)
    close: bool


class BulkInput(BaseModel):
    payym: str = Field(pattern=_YM)
    paydate: date
    rows: list[dict] = Field(min_length=1, max_length=1000)   # [{useremail, slip}]


class ItemsInput(BaseModel):
    keys: list[str] = Field(default_factory=list, max_length=50)


@router.put("/slips/bulk")
def save_bulk(data: BulkInput, user: dict = Depends(security_module.get_current_user)):
    return _call(payroll_module.save_bulk, user, data.payym, data.paydate, data.rows)


@router.put("/items")
def save_items(data: ItemsInput, user: dict = Depends(security_module.get_current_user)):
    return _call(payroll_module.save_items, user, data.keys)


@router.get("/slips")
def list_slips(payym: str = Query(..., pattern=_YM), user: dict = Depends(security_module.get_current_user)):
    return _call(payroll_module.list_slips, user, payym)


@router.get("/ledger-period")
def period_ledger(from_ym: str = Query(..., pattern=_YM), to_ym: str = Query(..., pattern=_YM),
                  user: dict = Depends(security_module.get_current_user)):
    return _call(payroll_module.period_ledger, user, from_ym, to_ym)


@router.post("/calc")
def calc(data: CalcInput, user: dict = Depends(security_module.get_current_user)):
    return _call(payroll_module.calc, user, data.payym, data.slip)


@router.post("/generate")
def generate(data: GenerateInput, user: dict = Depends(security_module.get_current_user)):
    return _call(payroll_module.generate, user, data.payym, data.paydate)


@router.put("/slips")
def save(data: SaveInput, user: dict = Depends(security_module.get_current_user)):
    return _call(payroll_module.save, user, data.payym, data.useremail, data.paydate, data.slip)


@router.delete("/slips")
def delete(payym: str = Query(..., pattern=_YM), useremail: str = Query(..., min_length=1, max_length=100),
           user: dict = Depends(security_module.get_current_user)):
    return _call(payroll_module.delete, user, payym, useremail)


@router.post("/close")
def close(data: CloseInput, user: dict = Depends(security_module.get_current_user)):
    return _call(payroll_module.set_close, user, data.payym, data.close)


@router.get("/my")
def my_slips(user: dict = Depends(security_module.get_current_user)):
    return _call(payroll_module.my_slips, user)
