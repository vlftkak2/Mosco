from fastapi import APIRouter, HTTPException, Request

# 모듈 임포트 (이름 충돌을 피하기 위해 as 사용)
from services.auth import login as auth_module

router = APIRouter(prefix="/api", tags=["login"])


def client_ip(request: Request) -> str:
    # nginx 가 X-Real-IP / X-Forwarded-For 를 붙여 준다. 없으면 직접 연결한 주소를 쓴다.
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
    try:
        result = auth_module.process_login(data, client_ip(request))
    except auth_module.LoginRateLimited as error:
        raise HTTPException(status_code=429, detail=str(error)) from error

    # 실패했을 경우 401 에러
    if not result["success"]:
        raise HTTPException(status_code=401, detail=result["message"])

    return result
