import re
import asyncio

from fastapi import APIRouter, Depends, File, Header, HTTPException, UploadFile, status

import AIOrder as ai_order_module
import security as security_module

router = APIRouter(prefix="/api/ai-order", tags=["ai-order-test"])
_IDEMPOTENCY_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{16,120}$")


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
            user_email=email,
            idempotency_key=idempotency_key,
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
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="권한을 확인할 수 없습니다. 잠시 후 다시 시도해주세요.") from exc
    finally:
        await file.close()
