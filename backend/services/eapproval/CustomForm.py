"""전자결재 추가 양식 (결재양식관리 > [양식 추가]) — 입력칸 정의 검사 · HTML 서식 정리 · 입력 값 검사.

  입력칸 종류: text 글자 · textarea 긴글 · number 숫자 · money 금액 · date 날짜 · period 기간 · select 선택
  HTML 서식(template)은 모스코(001) 회사만 쓸 수 있다 (EApproval.py 가 회사를 확인).
  서식 안의 {{입력칸 이름}} 자리에 입력칸(작성) · 값(보기)이 들어간다. 허용한 태그 · 속성 · 스타일만 남기고 나머지는 지운다.
"""
import re
from datetime import date
from decimal import Decimal, InvalidOperation

try:   # HTML 서식 정리 라이브러리 — 없어도 서버는 뜨고, HTML 서식 저장만 막는다 (pip install -r requirements.txt)
    import nh3
except ImportError:   # pragma: no cover
    nh3 = None

FIELD_TYPES = {"text": "글자", "textarea": "긴글", "number": "숫자", "money": "금액", "date": "날짜", "period": "기간", "select": "선택"}
MAX_FIELDS = 30
MAX_OPTIONS = 20
MAX_TEMPLATE = 200_000   # 글자 수
PLACEHOLDER = re.compile(r"\{\{\s*([^{}]+?)\s*\}\}")

# 서식에 허용하는 것 (표 · 글자 꾸밈 · 테두리 · 색). 스크립트 · 이벤트 · iframe · 외부 주소(이미지 · 링크)는 모두 지운다.
_TAGS = {"table", "thead", "tbody", "tfoot", "tr", "th", "td", "colgroup", "col", "caption",
         "div", "span", "p", "br", "hr", "b", "strong", "i", "em", "u", "s", "small", "sub", "sup",
         "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "pre"}
_ATTRS = {"*": {"style", "align", "title"}, "td": {"colspan", "rowspan", "width", "height", "valign"},
          "th": {"colspan", "rowspan", "width", "height", "valign"}, "col": {"span", "width"}, "colgroup": {"span", "width"},
          "table": {"width", "border", "cellpadding", "cellspacing"}}
_STYLES = {"color", "background-color", "background", "border", "border-top", "border-right", "border-bottom", "border-left",
           "border-color", "border-width", "border-style", "border-collapse", "border-spacing", "border-radius",
           "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
           "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
           "width", "min-width", "max-width", "height", "min-height", "text-align", "vertical-align", "line-height",
           "font-size", "font-weight", "font-style", "text-decoration", "letter-spacing", "white-space", "word-break", "table-layout", "display"}


def sanitize_template(html: str) -> str:
    """허용한 태그 · 속성 · 스타일만 남긴다 (url(...) 이 든 스타일 값은 지운다)."""
    text = str(html or "")
    if len(text) > MAX_TEMPLATE:
        raise ValueError(f"HTML 서식이 너무 깁니다 ({MAX_TEMPLATE:,}자까지).")
    if nh3 is None:
        raise ValueError("서버에 HTML 정리 라이브러리(nh3)가 설치되지 않아 HTML 서식을 저장할 수 없습니다. 관리자에게 'pip install -r requirements.txt'를 요청해 주세요.")
    cleaned = nh3.clean(text, tags=_TAGS, attributes=_ATTRS, filter_style_properties=_STYLES,
                        strip_comments=True, link_rel=None, url_schemes=set())
    # 배경 등에 url(...) · expression(...) 이 남지 않게 (외부 주소 불러오기 차단)
    return re.sub(r"(url|expression)\s*\(", "blocked(", cleaned, flags=re.I).strip()


def clean_fields(fields: list, existing: list | None = None) -> list:
    """입력칸 정의 검사. key 는 기존 칸(같은 key)을 유지하고 새 칸은 f1, f2 … 로 붙인다."""
    if not isinstance(fields, list) or not fields:
        raise ValueError("입력칸을 1개 이상 추가해 주세요.")
    if len(fields) > MAX_FIELDS:
        raise ValueError(f"입력칸은 {MAX_FIELDS}개까지 만들 수 있습니다.")
    used = {str(f.get("key")) for f in existing or [] if f.get("key")}
    next_no = max([int(k[1:]) for k in used if re.fullmatch(r"f\d+", k)] + [0]) + 1
    out, labels = [], set()
    for raw in fields:
        label = str((raw or {}).get("label") or "").strip()[:50]
        kind = str((raw or {}).get("type") or "text")
        if not label:
            raise ValueError("입력칸 이름을 입력해 주세요.")
        if "{" in label or "}" in label or "|" in label:
            raise ValueError(f"입력칸 이름에 {{ }} | 는 쓸 수 없습니다: {label}")
        if label in labels:
            raise ValueError(f"같은 이름의 입력칸이 있습니다: {label}")
        if kind not in FIELD_TYPES:
            raise ValueError(f"입력칸 종류를 확인해 주세요: {label}")
        labels.add(label)
        key = str(raw.get("key") or "")
        if not (key in used and re.fullmatch(r"f\d+", key)) or any(f["key"] == key for f in out):
            key = f"f{next_no}"
            next_no += 1
        field = {"key": key, "label": label, "type": kind, "required": bool(raw.get("required"))}
        if kind == "select":
            options = [str(o).strip()[:50] for o in raw.get("options") or [] if str(o).strip()]
            options = list(dict.fromkeys(options))
            if not options:
                raise ValueError(f"'{label}' 선택 칸의 보기를 1개 이상 입력해 주세요.")
            if len(options) > MAX_OPTIONS:
                raise ValueError(f"'{label}' 선택 칸의 보기는 {MAX_OPTIONS}개까지입니다.")
            field["options"] = options
        out.append(field)
    return out


def template_problems(template: str, fields: list) -> list:
    """서식 안의 {{이름}} 중 입력칸에 없는 이름 (저장은 되지만 알려 준다)."""
    labels = {f["label"] for f in fields}
    return sorted({name for name in PLACEHOLDER.findall(template or "") if name not in labels})


def _date(value, label: str) -> str:
    try:
        return date.fromisoformat(str(value)[:10]).isoformat()
    except ValueError as error:
        raise ValueError(f"{label} 날짜를 확인해 주세요.") from error


def _number(value, label: str, money: bool) -> str:
    text = str(value).replace(",", "").strip()
    try:
        number = Decimal(text)
    except InvalidOperation as error:
        raise ValueError(f"{label}에는 숫자를 입력해 주세요.") from error
    if not number.is_finite() or abs(number) >= Decimal("1e15"):
        raise ValueError(f"{label} 값을 확인해 주세요.")
    if money and number < 0:
        raise ValueError(f"{label}은(는) 0 이상으로 입력해 주세요.")
    if money or number == number.to_integral_value():
        return str(number.quantize(Decimal(1)))   # 금액은 원 단위 (100 → '100', 지수 표기 없이)
    return format(number.normalize(), "f")


def normalize_values(fields: list, values: dict, strict: bool) -> dict:
    """입력 값 검사 · 정리. strict=False(임시저장)는 빈칸을 허용한다."""
    values = values if isinstance(values, dict) else {}
    out = {}
    for field in fields:
        key, label, kind = field["key"], field["label"], field["type"]
        raw = values.get(key)
        if kind == "period":
            raw = raw if isinstance(raw, dict) else {}
            start, end = str(raw.get("from") or "").strip(), str(raw.get("to") or "").strip()
            if not start and not end:
                if strict and field.get("required"):
                    raise ValueError(f"{label}을(를) 입력해 주세요.")
                continue
            if not start or not end:
                if strict:
                    raise ValueError(f"{label}의 시작일과 종료일을 모두 입력해 주세요.")
            start = _date(start, label) if start else ""
            end = _date(end, label) if end else ""
            if start and end and end < start:
                raise ValueError(f"{label}의 종료일이 시작일보다 빠릅니다.")
            out[key] = {"from": start, "to": end}
            continue
        text = str(raw if raw is not None else "").strip()
        if not text:
            if strict and field.get("required"):
                raise ValueError(f"{label}을(를) 입력해 주세요.")
            continue
        if kind == "text":
            out[key] = text[:200]
        elif kind == "textarea":
            out[key] = text[:4000]
        elif kind in ("number", "money"):
            out[key] = _number(text, label, kind == "money")
        elif kind == "date":
            out[key] = _date(text, label)
        elif kind == "select":
            if text not in field.get("options", []):
                raise ValueError(f"{label}의 보기에서 골라 주세요.")
            out[key] = text
    return out


def title_of(fields: list, values: dict, formname: str) -> str:
    """문서 제목: 첫 번째 글자 칸 값, 없으면 양식 이름."""
    for field in fields:
        if field["type"] == "text" and values.get(field["key"]):
            return str(values[field["key"]])[:200]
    return formname
