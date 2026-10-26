from fastapi import APIRouter, Depends, HTTPException, Query, status

import Company as company_module
import security as security_module

router = APIRouter(prefix="/api/companies", tags=["companies"])

def require_master(user: dict = Depends(security_module.get_current_user)) -> dict:
    if user["companyid"] != "001" or not company_module.is_master(user["companyid"], user["email"]):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Steel119 최종관리자만 사용할 수 있습니다.")
    return user


@router.get("")
def get_companies(
    q: str = Query("", max_length=100),
    plan_code: str = Query("", max_length=20),
    company_status: str = Query("", max_length=20),
    page: int = Query(1, ge=1),
    page_size: int = Query(30, ge=1, le=200),
    user: dict = Depends(require_master),
):
    del user
    return {"success": True, **company_module.list_companies(q, plan_code, company_status, page, page_size)}


@router.post("", status_code=status.HTTP_201_CREATED)
def create_company(data: company_module.CompanyInput, user: dict = Depends(require_master)):
    del user
    try:
        return {"success": True, "item": company_module.create_company(data)}
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.put("/{companyid}")
def update_company(companyid: str, data: company_module.CompanyInput, user: dict = Depends(require_master)):
    del user
    try:
        return {"success": True, "item": company_module.update_company(companyid, data)}
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.delete("/{companyid}")
def delete_company(companyid: str, user: dict = Depends(require_master)):
    del user
    try:
        if not company_module.delete_company(companyid):
            raise HTTPException(status_code=404, detail="고객사를 찾을 수 없습니다.")
        return {"success": True}
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
