"""전자결재 API (services/eapproval/EApproval.py)."""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

import security as security_module
from services.eapproval import EApproval as eapproval_module

router = APIRouter(prefix="/api/eapproval", tags=["eapproval"])


def _call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except PermissionError as error:
        raise HTTPException(status_code=403, detail=str(error)) from error
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


class DocInput(BaseModel):
    formcode: str = Field(min_length=1, max_length=20)
    content: dict = Field(default_factory=dict)
    docno: str | None = Field(default=None, max_length=30)


class CommentInput(BaseModel):
    comment: str = Field(default="", max_length=500)


class AdminInput(BaseModel):
    forms: list[dict] | None = Field(default=None, max_length=20)
    year: int | None = Field(default=None, ge=2000, le=2100)
    leaves: list[dict] | None = Field(default=None, max_length=2000)
    times: dict | None = None   # 반차 · 반반차 시간대 {HALF_AM: [{from, to}], HALF_PM: [...], QUARTER: [...]}


@router.get("/summary")
def summary(user: dict = Depends(security_module.get_current_user)):
    return _call(eapproval_module.summary, user)


@router.get("/forms")
def forms(user: dict = Depends(security_module.get_current_user)):
    return _call(eapproval_module.forms_for_writer, user)


@router.get("/leave")
def leave(year: int | None = Query(None, ge=2000, le=2100), user: dict = Depends(security_module.get_current_user)):
    return _call(eapproval_module.leave_status, user, year)


@router.get("/my-leave")
def my_leave(year: int | None = Query(None, ge=2000, le=2100), user: dict = Depends(security_module.get_current_user)):
    return _call(eapproval_module.my_leave, user, year)


@router.get("/docs")
def list_docs(
    box: str = Query("mine", pattern="^(drafts|mine|todo|done)$"),
    status: str = Query("", max_length=12), formcode: str = Query("", max_length=20), q: str = Query("", max_length=100),
    date_from: date | None = Query(None), date_to: date | None = Query(None),
    page: int = Query(1, ge=1), page_size: int = Query(30, ge=1, le=200),
    user: dict = Depends(security_module.get_current_user),
):
    return _call(eapproval_module.list_docs, user, box, status, formcode, q, date_from, date_to, page, page_size)


@router.get("/docs/{docno}")
def get_doc(docno: str, user: dict = Depends(security_module.get_current_user)):
    return _call(eapproval_module.get_doc, user, docno)


@router.post("/docs/draft")
def save_draft(data: DocInput, user: dict = Depends(security_module.get_current_user)):
    return _call(eapproval_module.save_draft, user, data.formcode, data.content, data.docno)


@router.post("/docs/submit")
def submit(data: DocInput, user: dict = Depends(security_module.get_current_user)):
    return _call(eapproval_module.submit, user, data.formcode, data.content, data.docno)


@router.delete("/docs/{docno}")
def delete_draft(docno: str, user: dict = Depends(security_module.get_current_user)):
    return _call(eapproval_module.delete_draft, user, docno)


@router.post("/docs/{docno}/approve")
def approve(docno: str, data: CommentInput, user: dict = Depends(security_module.get_current_user)):
    return _call(eapproval_module.approve, user, docno, data.comment)


@router.post("/docs/{docno}/reject")
def reject(docno: str, data: CommentInput, user: dict = Depends(security_module.get_current_user)):
    return _call(eapproval_module.reject, user, docno, data.comment)


@router.post("/docs/{docno}/withdraw")
def withdraw(docno: str, user: dict = Depends(security_module.get_current_user)):
    return _call(eapproval_module.withdraw, user, docno)


@router.get("/admin")
def admin(year: int | None = Query(None, ge=2000, le=2100), user: dict = Depends(security_module.get_current_user)):
    return _call(eapproval_module.admin_settings, user, year)


@router.put("/admin")
def save_admin(data: AdminInput, user: dict = Depends(security_module.get_current_user)):
    return _call(eapproval_module.save_admin, user, data.forms, data.year, data.leaves, data.times)


class FormInput(BaseModel):
    formname: str = Field(min_length=1, max_length=100)
    fields: list[dict] = Field(default_factory=list, max_length=30)
    template: str = Field(default="", max_length=200_000)


class TemplateInput(BaseModel):
    template: str = Field(default="", max_length=200_000)


@router.post("/admin/forms")
def create_form(data: FormInput, user: dict = Depends(security_module.get_current_user)):
    return _call(eapproval_module.create_form, user, data.formname, data.fields, data.template)


@router.put("/admin/forms/{formcode}")
def update_form(formcode: str, data: FormInput, user: dict = Depends(security_module.get_current_user)):
    return _call(eapproval_module.update_form, user, formcode, data.formname, data.fields, data.template)


@router.delete("/admin/forms/{formcode}")
def delete_form(formcode: str, user: dict = Depends(security_module.get_current_user)):
    return _call(eapproval_module.delete_form, user, formcode)


@router.post("/admin/forms/preview")
def preview_template(data: TemplateInput, user: dict = Depends(security_module.get_current_user)):
    return _call(eapproval_module.preview_template, user, data.template)


class ApproverInput(BaseModel):
    step: int = Field(ge=1, le=50)
    approver: str = Field(min_length=1, max_length=100)


@router.get("/admin/pending")
def admin_pending(
    q: str = Query("", max_length=100), formcode: str = Query("", max_length=20),
    date_from: date | None = Query(None), date_to: date | None = Query(None),
    page: int = Query(1, ge=1), page_size: int = Query(30, ge=1, le=200),
    user: dict = Depends(security_module.get_current_user),
):
    return _call(eapproval_module.admin_pending, user, q, formcode, date_from, date_to, page, page_size)


@router.post("/admin/docs/{docno}/approver")
def admin_change_approver(docno: str, data: ApproverInput, user: dict = Depends(security_module.get_current_user)):
    return _call(eapproval_module.admin_change_approver, user, docno, data.step, data.approver)


@router.post("/admin/docs/{docno}/reject")
def admin_force_reject(docno: str, data: CommentInput, user: dict = Depends(security_module.get_current_user)):
    return _call(eapproval_module.admin_force_reject, user, docno, data.comment)
