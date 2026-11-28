import ipaddress

from fastapi import APIRouter, Depends, HTTPException, Request

import access_log
import security as security_module

# 모듈 임포트 (이름 충돌을 피하기 위해 as 사용)
from services.auth import login as auth_module

router = APIRouter(prefix="/api", tags=["login"])


def _from_trusted_proxy(request: Request) -> bool:
    """X-Real-IP 는 우리 nginx(도커 내부망 = 사설 IP)가 붙여 줄 때만 믿는다.
    클라이언트가 직접 붙인 헤더(시연 터널 · 직접 접속)로 IP 제한을 피하지 못하게 한다."""
    host = request.client.host if request.client else ""
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return False
    return address.is_private and not address.is_loopback


def client_ip(request: Request) -> str:
    # nginx 가 X-Real-IP / X-Forwarded-For 를 붙여 준다. 없으면 직접 연결한 주소를 쓴다.
    if not _from_trusted_proxy(request):
        return request.client.host if request.client else ""
    real_ip = (request.headers.get("x-real-ip") or "").strip()
    if real_ip:
        return real_ip
    forwarded = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    if forwarded:
        return forwarded
    return request.client.host if request.client else ""


# 로그인 API
# auth_module 안에 있는 LoginRequest 클래스를 데이터 규격으로 사용합니다.
@router.post("/login")
def login_api(data: auth_module.LoginRequest, request: Request):
    ip = client_ip(request)
    try:
        result = auth_module.process_login(data, ip)
    except auth_module.LoginRateLimited as error:
        access_log.record("LOGIN_LOCKED", email=data.email, client_ip=ip)
        raise HTTPException(status_code=429, detail=str(error)) from error

    # 실패했을 경우 401 에러
    if not result["success"]:
        access_log.record("LOGIN_FAIL", email=data.email, client_ip=ip, detail=result["message"][:100])
        raise HTTPException(status_code=401, detail=result["message"])
    access_log.record("LOGIN_SUCCESS", companyid=result.get("user_company"), email=result.get("user_email"), client_ip=ip)

    return result


# 로그아웃: 서버 세션을 끊어 이 토큰을 바로 못 쓰게 한다 (브라우저 저장소만 지우면 토큰이 8시간 살아 있다)
@router.post("/logout")
def logout_api(request: Request, user: dict = Depends(security_module.get_current_user)):
    access_log.record("LOGOUT", companyid=user["companyid"], email=user["email"], client_ip=client_ip(request))
    auth_module.process_logout(user["companyid"], user["email"], user.get("session_id", ""))
    return {"success": True}
