from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from config import JWT_SECRET_KEY


ALGORITHM = "HS256"
ISSUER = "mosco-api"
AUDIENCE = "mosco-client"
ACCESS_TOKEN_MINUTES = 480
bearer_scheme = HTTPBearer(auto_error=False)


def create_access_token(user: dict) -> str:
    if len(JWT_SECRET_KEY) < 32:
        raise RuntimeError("JWT_SECRET_KEY must be configured with at least 32 characters")

    now = datetime.now(timezone.utc)
    payload = {
        "sub": user["user_email"],
        "companyid": str(user["user_company"]),
        "companyname": user.get("user_companyname", ""),
        "username": user.get("user_name", ""),
        "iat": now,
        "nbf": now,
        "exp": now + timedelta(minutes=ACCESS_TOKEN_MINUTES),
        "iss": ISSUER,
        "aud": AUDIENCE,
    }
    return jwt.encode(payload, JWT_SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> dict:
    if len(JWT_SECRET_KEY) < 32:
        raise HTTPException(status_code=503, detail="인증 키가 서버에 설정되지 않았습니다.")
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="로그인이 필요합니다.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        claims = jwt.decode(
            credentials.credentials,
            JWT_SECRET_KEY,
            algorithms=[ALGORITHM],
            issuer=ISSUER,
            audience=AUDIENCE,
            options={"require": ["exp", "iat", "sub", "companyid"]},
        )
    except jwt.PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="로그인 정보가 만료되었거나 유효하지 않습니다.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # JWT signature, issuer, audience, and expiry were verified above.
    # Use signed claims directly to avoid a database round trip per API request.
    return {
        "companyid": str(claims["companyid"]),
        "companyname": claims.get("companyname", ""),
        "username": claims.get("username", ""),
        "email": claims["sub"],
    }
