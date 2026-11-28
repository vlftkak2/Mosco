from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import security as security_module
from services.ai import AIChat as ai_chat_module


def _platform_only(user: dict = Depends(security_module.get_current_user)) -> dict:
    """지금은 모스코(001) 직원만 (고객사에 열 때 이 검사만 빼면 된다 · 자료 권한은 도구마다 메뉴권한으로 따로 본다)."""
    if not security_module.is_platform_company(user):
        raise HTTPException(status_code=403, detail="모스코 전용 기능입니다.")
    return user


# AI 업무비서 (메뉴: AI_ASSISTANT · 모스코 전용)
router = APIRouter(
    prefix="/api/ai-chat",
    tags=["ai-chat"],
    dependencies=[Depends(_platform_only), Depends(security_module.require_menu_access(ai_chat_module.MENU_ID))],
)


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=8000)


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=40)


@router.get("/status")
def get_status(user: dict = Depends(security_module.get_current_user)):
    return {"success": True, **ai_chat_module.status_for(user)}


@router.post("/messages")
async def send_message(data: ChatRequest, user: dict = Depends(security_module.get_current_user)):
    try:
        result = await ai_chat_module.chat(user, [m.model_dump() for m in data.messages])
    except ai_chat_module.AIChatError as error:
        raise HTTPException(status_code=error.status_code, detail=error.detail) from error
    return {"success": True, **result}
