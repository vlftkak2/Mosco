import re
import asyncio
import logging

from fastapi import APIRouter, Depends, File, Header, HTTPException, UploadFile, status
from fastapi.responses import Response

import AIOrder as ai_order_module
import security as security_module

router = APIRouter(prefix="/api/ai-order", tags=["ai-order-test"])
logger = logging.getLogger(__name__)
_IDEMPOTENCY_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{16,120}$")


@router.post("/convert-preview")
async def convert_order_preview(
    file: UploadFile = File(...),
    user: dict = Depends(security_module.get_current_user),
):
    companyid = str(user.get("companyid") or "").strip()
    email = str(user.get("email") or "").strip()
    if not companyid or not email:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="회사 및 사용자 인증 정보가 필요합니다.")
    try:
        has_access = await asyncio.to_thread(ai_order_module.check_user_access, companyid, email)
        if not has_access:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="AI 주문서 인식 메뉴 권한이 없습니다.")
        extension, data, _ = await ai_order_module.read_limited_upload(file)
        if extension not in {".tif", ".tiff", ".heic", ".heif"}:
            raise ai_order_module.AIOrderError(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "HEIC 또는 TIFF 이미지 변환 미리보기만 지원합니다.")
        content, media_type, filename = await asyncio.to_thread(ai_order_module.convert_image_preview, data)
        return Response(
            content=content,
            media_type=media_type,
            headers={"Content-Disposition": f'inline; filename="{filename}"'},
        )
    except ai_order_module.AIOrderError as exc:
        raise HTTPException(status_code=exc.status_code, detail=ai_order_module.safe_error_detail(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("AI order preview endpoint failed error_type=%s", type(exc).__name__)
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="이미지를 변환하지 못했습니다.") from exc
    finally:
        await file.close()


@router.post("/analyze")
async def analyze_order_document(
    file: UploadFile = File(...),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key", max_length=120),
    user: dict = Depends(security_module.get_current_user),
):
    companyid = str(user.get("companyid") or "").strip()
    email = str(user.get("email") or "").strip()
    if not companyid or not email:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="회사 및 사용자 인증 정보가 필요합니다.")
    if not idempotency_key or not _IDEMPOTENCY_PATTERN.fullmatch(idempotency_key):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="분석 요청 키가 올바르지 않습니다. 다시 분석 버튼을 눌러주세요.",
        )
    try:
        has_access = await asyncio.to_thread(ai_order_module.check_user_access, companyid, email)
        if not has_access:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="AI 주문서 인식 메뉴 권한이 없습니다.")
        extension, data, mime_type = await ai_order_module.read_limited_upload(file)
        result = await ai_order_module.analyze_order_document(
            companyid=companyid,
            companyname=str(user.get("companyname") or "").strip(),
            user_email=email,
            idempotency_key=idempotency_key,
            filename=str(file.filename or "order-document").replace("\\", "/").split("/")[-1],
            extension=extension,
            data=data,
            mime_type=mime_type,
        )
        return {"success": True, **result}
    except ai_order_module.AIOrderError as exc:
        raise HTTPException(status_code=exc.status_code, detail=ai_order_module.safe_error_detail(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        # Never return a database exception or connection string to the client.
        logger.error("AI order analyze endpoint failed company=%s error_type=%s", companyid, type(exc).__name__)
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="분석 요청을 처리하지 못했습니다. 서버 설정과 로그를 확인해주세요.") from exc
    finally:
        await file.close()
