from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

import security as security_module
from services.control import Approval as approval_module


# 통제관리 (어드민 › 통제관리): 통제 설정 · 승인함 · 내 요청 · 이력. 고객사에 통제가 허용된 경우만 쓴다.
router = APIRouter(prefix="/api/control", tags=["control"])


class PolicyInput(BaseModel):
    target: str = Field(max_length=30)
    on_create: bool = False
    on_update: bool = False
    on_delete: bool = False
    # 동작별 금액 조건: 켜짐 AND 이 금액 이상일 때만 승인 (비우면 금액 무관)
    create_min: int | None = Field(default=None, ge=0, le=999_999_999_999)
    update_min: int | None = Field(default=None, ge=0, le=999_999_999_999)
    delete_min: int | None = Field(default=None, ge=0, le=999_999_999_999)


class SettingsInput(BaseModel):
    policies: list[PolicyInput] = Field(default_factory=list, max_length=20)
    approvers: list[str] | None = Field(default=None, max_length=500)   # 승인자 이메일 (None 이면 그대로)


class RejectInput(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


def _call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except PermissionError as error:
        raise HTTPException(status_code=403, detail=str(error)) from error
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.get("/summary")
def get_summary(user: dict = Depends(security_module.get_current_user)):
    """헤더 알림 · 메뉴 표시: 통제 사용 여부, 승인자 여부, 대기 건수."""
    return approval_module.summary(user)


@router.get("/settings")
def get_settings(user: dict = Depends(security_module.get_current_user)):
    return _call(approval_module.get_settings, user)


@router.put("/settings")
def save_settings(data: SettingsInput, user: dict = Depends(security_module.get_current_user)):
    return _call(approval_module.save_settings, user, [p.model_dump() for p in data.policies], data.approvers)


@router.get("/requests")
def list_requests(
    scope: str = Query(default="inbox", pattern="^(inbox|mine)$"),
    status: str = Query(default="", max_length=12),
    target: str = Query(default="", max_length=30),
    q: str = Query(default="", max_length=100),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=30, ge=1, le=200),
    user: dict = Depends(security_module.get_current_user),
):
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=422, detail="시작일은 종료일보다 뒤일 수 없습니다.")
    return _call(approval_module.list_requests, user, scope, status, target, q, page, page_size, date_from, date_to)


@router.get("/requests/{requestno}")
def get_request(requestno: str, user: dict = Depends(security_module.get_current_user)):
    return _call(approval_module.get_request, user, requestno)


@router.post("/requests/{requestno}/approve")
def approve_request(requestno: str, user: dict = Depends(security_module.get_current_user)):
    return _call(approval_module.approve, user, requestno)


@router.post("/requests/{requestno}/reject")
def reject_request(requestno: str, data: RejectInput, user: dict = Depends(security_module.get_current_user)):
    return _call(approval_module.reject, user, requestno, data.reason)


@router.post("/requests/{requestno}/cancel")
def cancel_request(requestno: str, user: dict = Depends(security_module.get_current_user)):
    return _call(approval_module.cancel, user, requestno)
