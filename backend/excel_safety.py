"""엑셀 다운로드 공통 안전 설정.

XlsxWriter 는 기본으로 '=' 로 시작하는 문자열을 수식으로, 'http://' 문자열을 하이퍼링크로 저장한다.
거래처명 · 비고 같은 사용자 입력이 다른 사용자 PC 의 엑셀에서 수식으로 실행되지 않게(수식 인젝션) 모두 문자열로 쓴다.
"""


def safe_workbook_options(options: dict | None = None) -> dict:
    merged = dict(options or {})
    merged["strings_to_formulas"] = False
    merged["strings_to_urls"] = False
    return merged
