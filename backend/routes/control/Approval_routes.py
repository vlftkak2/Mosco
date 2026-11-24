from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

import security as security_module
from services.control import Approval as approval_module


# 통제관리 (기준정보 › 통제관리): 통제 설정 · 승인함 · 내 요청 · 이력. 고객사에 통제가 허용된 경우만 쓴다.
router = APIRouter(prefix="/api/control", tags=["control"])


class PolicyInput(BaseModel):
    target: str = Field(max_length=30)
    on_create: bool = False
    on_update: bool = False
    on_delete: bool = False


class SettingsInput(BaseModel):
    policies: list[PolicyInput] = Field(default_factory=list, max_length=20)
    self_approve: bool = False
    approvers: list[str] = Field(default_factory=list, max_length=200)


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
    return _call(approval_module.save_settings, user, [p.model_dump() for p in data.policies], data.self_approve, data.approvers)


@router.get("/requests")
def list_requests(
    scope: str = Query(default="inbox", pattern="^(inbox|mine)$"),
    status: str = Query(default="", max_length=12),
    target: str = Query(default="", max_length=30),
    q: str = Query(default="", max_length=100),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=30, ge=1, le=200),
    user: dict = Depends(security_module.get_current_user),
):
    return _call(approval_module.list_requests, user, scope, status, target, q, page, page_size)


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


@router.get("/history")
def list_history(
    q: str = Query(default="", max_length=100),
    event: str = Query(default="", max_length=30),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    user: dict = Depends(security_module.get_current_user),
):
    return _call(approval_module.list_history, user, q, event, page, page_size)
