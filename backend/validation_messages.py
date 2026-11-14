"""입력값 검증 오류(422)를 한글로 바꾼다.

FastAPI 기본 응답은 Pydantic 영어 문구("String should have at least 3 characters")를 그대로 내려준다.
응답 모양(detail 배열의 loc · type · msg)은 그대로 두고 msg 만 한글로 바꾼다.
(항목 이름은 화면마다 붙이는 방식이 달라서 msg 에는 넣지 않는다 — 화면이 loc 으로 항목 이름을 붙인다)
"""
from fastapi import Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


def _ctx(error: dict, key: str, default=""):
    return (error.get("ctx") or {}).get(key, default)


def korean_message(error: dict) -> str:
    kind = error.get("type", "")
    if kind == "value_error":
        # 우리 코드가 직접 낸 ValueError — 이미 한글 문구다
        return str(error.get("msg", "")).removeprefix("Value error, ").strip() or "입력값을 확인해 주세요."
    if kind == "assertion_error":
        return str(error.get("msg", "")).removeprefix("Assertion failed, ").strip() or "입력값을 확인해 주세요."
    if kind == "missing":
        return "필수 입력 항목입니다."
    if kind == "string_too_short":
        size = _ctx(error, "min_length", 1)
        return "값을 입력해 주세요." if size == 1 else f"{size}자 이상 입력해 주세요."
    if kind == "string_too_long":
        return f"{_ctx(error, 'max_length')}자 이하로 입력해 주세요."
    if kind == "string_pattern_mismatch":
        return "형식이 올바르지 않습니다."
    if kind in {"string_type", "str_type"}:
        return "글자로 입력해 주세요."
    if kind in {"int_parsing", "int_type", "int_from_float"}:
        return "정수로 입력해 주세요."
    if kind in {"float_parsing", "float_type", "decimal_parsing", "decimal_type"}:
        return "숫자로 입력해 주세요."
    if kind == "greater_than_equal":
        return f"{_ctx(error, 'ge')} 이상으로 입력해 주세요."
    if kind == "greater_than":
        return f"{_ctx(error, 'gt')}보다 큰 값을 입력해 주세요."
    if kind in {"less_than_equal", "less_than"}:
        return f"{_ctx(error, 'le')} 이하로 입력해 주세요." if kind == "less_than_equal" else f"{_ctx(error, 'lt')}보다 작은 값을 입력해 주세요."
    if kind.startswith("date") or kind.startswith("datetime"):
        return "날짜 형식(YYYY-MM-DD)으로 입력해 주세요."
    if kind in {"bool_parsing", "bool_type"}:
        return "예/아니오 값으로 입력해 주세요."
    if kind in {"list_type", "too_short", "too_long"}:
        if kind == "too_long":
            return f"최대 {_ctx(error, 'max_length')}개까지 보낼 수 있습니다."
        if kind == "too_short":
            return f"최소 {_ctx(error, 'min_length')}개가 필요합니다."
        return "목록 형식이 올바르지 않습니다."
    if kind in {"literal_error", "enum"}:
        return "허용되지 않은 값입니다."
    if kind in {"json_invalid", "model_attributes_type", "dict_type", "model_type"}:
        return "요청 형식이 올바르지 않습니다."
    if kind == "uuid_parsing":
        return "형식이 올바르지 않습니다."
    return "입력값을 확인해 주세요."


async def validation_exception_handler(_request: Request, exc: RequestValidationError):
    details = []
    for error in exc.errors():
        item = {key: value for key, value in error.items() if key not in {"ctx", "url", "input"}}
        item["msg"] = korean_message(error)
        details.append(item)
    return JSONResponse(status_code=422, content={"detail": jsonable_encoder(details)})
