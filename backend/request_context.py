"""요청 단위 문맥: 로그인 사용자를 감사 기록(DB 트리거)에, 회사를 회사별 연결 상한에 넘긴다.

ASGI 미들웨어라 엔드포인트(스레드풀 포함)까지 contextvar 가 전달된다.
토큰 검증은 서명 · 만료만 확인하는 가벼운 디코드이며, 실제 권한 검사는 기존 get_current_user 가 한다.
"""
import jwt

import db
from config import JWT_SECRET_KEY
from security import ALGORITHM, AUDIENCE, ISSUER


def _identity_from_headers(headers) -> tuple[str, str]:
    """(사용자 이메일, 회사 코드). 토큰이 없거나 틀리면 빈 값 (권한 검사는 get_current_user 가 따로 한다)."""
    for name, value in headers:
        if name == b"authorization":
            text = value.decode("latin-1")
            if not text.lower().startswith("bearer "):
                return "", ""
            try:
                claims = jwt.decode(text[7:].strip(), JWT_SECRET_KEY, algorithms=[ALGORITHM],
                                    issuer=ISSUER, audience=AUDIENCE)
            except Exception:
                return "", ""
            return f"{claims.get('sub', '')}"[:150], f"{claims.get('companyid', '')}"[:50]
    return "", ""


class ActorContextMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http" or len(JWT_SECRET_KEY) < 32:
            await self.app(scope, receive, send)
            return
        actor, companyid = _identity_from_headers(scope.get("headers") or [])
        actor_token = db.current_actor.set(actor)
        company_token = db.current_company.set(companyid)   # 회사별 DB 연결 상한 (db.POOL_MAX_PER_COMPANY)
        try:
            await self.app(scope, receive, send)
        finally:
            db.current_company.reset(company_token)
            db.current_actor.reset(actor_token)
