"""사업장관리 API (메뉴: WORKPLACE_MANAGEMENT) — 메뉴 권한이 있는 사람만 자기 회사 사업장 정보를 보고 고친다."""
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from services.masterdata import Workplace as workplace_module
import security as security_module

router = APIRouter(
    prefix="/api/workplace",
    tags=["workplace"],
    dependencies=[Depends(security_module.require_menu_access("WORKPLACE_MANAGEMENT"))],
)


@router.get("")
def get_workplace(user: dict = Depends(security_module.get_current_user)):
    item = workplace_module.get_workplace(user["companyid"])
    if not item:
        raise HTTPException(status_code=404, detail="회사 정보를 찾을 수 없습니다.")
    return {"success": True, "item": item}


@router.put("")
def update_workplace(data: workplace_module.WorkplaceInput, user: dict = Depends(security_module.get_current_user)):
    try:
        item = workplace_module.update_workplace(user["companyid"], data, actor=user.get("email"))
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return {"success": True, "item": item}


def _kind(kind: str) -> str:
    if kind not in workplace_module.IMAGE_KINDS:
        raise HTTPException(status_code=404, detail="직인(stamp) · 로고(logo) · 사업자등록증(bizcert)만 올릴 수 있습니다.")
    return kind


@router.post("/{kind}")
async def upload_image(kind: str, file: UploadFile = File(...), user: dict = Depends(security_module.get_current_user)):
    kind = _kind(kind)
    content = await file.read(workplace_module.IMAGE_MAX_BYTES + 1)
    try:
        item = workplace_module.set_image(user["companyid"], kind, content, file.content_type or "", actor=user.get("email"), filename=file.filename or "")
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return {"success": True, "item": item}


@router.delete("/{kind}")
def delete_image(kind: str, user: dict = Depends(security_module.get_current_user)):
    kind = _kind(kind)
    return {"success": True, "item": workplace_module.delete_image(user["companyid"], kind, actor=user.get("email"))}
