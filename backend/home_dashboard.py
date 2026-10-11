import copy
import json
import re
from datetime import datetime, timedelta
from email.utils import parsedate_to_datetime
from html import unescape
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET


HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    )
}

CACHE_TTL = timedelta(minutes=30)
_HOME_MARKET_CACHE = {
    "expires_at": None,
    "payload": None,
}


def _fetch_text(url, timeout=6, encoding="utf-8"):
    request = Request(url, headers=HEADERS)
    with urlopen(request, timeout=timeout) as response:
        content_type = response.headers.get_content_charset()
        raw = response.read()
    return raw.decode(content_type or encoding, errors="ignore")


def _fetch_json(url, timeout=6):
    return json.loads(_fetch_text(url, timeout=timeout))


def _strip_html(value):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]*>", "", unescape(value or ""))).strip()


def _safe_float(value, default=None):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def get_weather():
    url = (
        "https://api.open-meteo.com/v1/forecast"
        "?latitude=37.5665&longitude=126.9780"
        "&current=temperature_2m,relative_humidity_2m,apparent_temperature,"
        "precipitation,weather_code,wind_speed_10m"
        "&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max"
        "&timezone=Asia%2FSeoul"
    )
    data = _fetch_json(url)
    current = data.get("current", {})
    daily = data.get("daily", {})

    weather_map = {
        0: "맑음",
        1: "대체로 맑음",
        2: "구름 조금",
        3: "흐림",
        45: "안개",
        48: "서리 안개",
        51: "약한 이슬비",
        53: "이슬비",
        55: "강한 이슬비",
        61: "약한 비",
        63: "비",
        65: "강한 비",
        71: "약한 눈",
        73: "눈",
        75: "강한 눈",
        80: "소나기",
        81: "소나기",
        82: "강한 소나기",
        95: "뇌우",
    }

    code = current.get("weather_code")
    return {
        "location": "서울",
        "temperature": round(_safe_float(current.get("temperature_2m"), 0)),
        "apparentTemperature": round(_safe_float(current.get("apparent_temperature"), 0)),
        "humidity": current.get("relative_humidity_2m"),
        "precipitation": current.get("precipitation"),
        "windSpeed": current.get("wind_speed_10m"),
        "condition": weather_map.get(code, "날씨 정보"),
        "todayHigh": round(_safe_float((daily.get("temperature_2m_max") or [None])[0], 0)),
        "todayLow": round(_safe_float((daily.get("temperature_2m_min") or [None])[0], 0)),
        "rainProbability": (daily.get("precipitation_probability_max") or [None])[0],
        "updatedAt": current.get("time"),
    }


def get_stock():
    html = _fetch_text(
        "https://finance.naver.com/item/main.naver?code=278470",
        encoding="euc-kr",
    )
    blinds = re.findall(r'<span class="blind">([^<]+)</span>', html)
    numbers = [item for item in blinds if re.search(r"\d", item)]
    price = numbers[0] if numbers else None

    change = None
    rate = None
    state = "보합"
    exday = re.search(r'<p class="no_exday">(.+?)</p>', html, flags=re.S)
    if exday:
        exday_blinds = re.findall(r'<span class="blind">([^<]+)</span>', exday.group(1))
        if exday_blinds:
            change = exday_blinds[0]
        if len(exday_blinds) > 1:
            rate = exday_blinds[1]
        if "상승" in exday.group(1):
            state = "상승"
        elif "하락" in exday.group(1):
            state = "하락"

    return {
        "name": "에이피알",
        "code": "278470",
        "market": "KOSPI",
        "price": price,
        "change": change,
        "changeRate": rate,
        "state": state,
        "url": "https://finance.naver.com/item/main.naver?code=278470",
        "updatedAt": datetime.now().isoformat(timespec="minutes"),
    }


def _extract_image(url):
    try:
        html = _fetch_text(url, timeout=4)
    except Exception:
        return None

    patterns = [
        r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image["\']',
        r'<meta[^>]+name=["\']twitter:image["\'][^>]+content=["\']([^"\']+)["\']',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+name=["\']twitter:image["\']',
    ]
    for pattern in patterns:
        match = re.search(pattern, html, flags=re.I)
        if match:
            return unescape(match.group(1))
    return None


def get_news(limit=5):
    query = quote("에이피알 OR APR 278470")
    rss_url = f"https://news.google.com/rss/search?q={query}&hl=ko&gl=KR&ceid=KR:ko"
    xml_text = _fetch_text(rss_url)
    root = ET.fromstring(xml_text)

    articles = []
    for item in root.findall("./channel/item"):
        title = _strip_html(item.findtext("title"))
        link = item.findtext("link") or ""
        pub_date = item.findtext("pubDate")
        published_at = pub_date
        try:
            published_at = parsedate_to_datetime(pub_date).isoformat()
        except Exception:
            pass

        source = item.findtext("source") or urlparse(link).netloc
        description = _strip_html(item.findtext("description"))
        title = re.sub(r"\s+-\s+[^-]+$", "", title).strip()

        articles.append(
            {
                "title": title,
                "source": source,
                "description": description,
                "url": link,
                "publishedAt": published_at,
                "image": _extract_image(link),
            }
        )

        if len(articles) >= limit:
            break

    return articles


def get_home_market_summary():
    now = datetime.now()
    cached_payload = _HOME_MARKET_CACHE["payload"]
    cache_expires_at = _HOME_MARKET_CACHE["expires_at"]

    # CODEx HOME_DASHBOARD_CACHE: 30분 동안 외부 날씨/주가/뉴스 재호출 없이 캐시 응답
    if cached_payload and cache_expires_at and now < cache_expires_at:
        payload = copy.deepcopy(cached_payload)
        payload["cached"] = True
        payload["cacheUntil"] = cache_expires_at.isoformat(timespec="minutes")
        return payload

    result = {
        "success": True,
        "cached": False,
        "cacheUntil": (now + CACHE_TTL).isoformat(timespec="minutes"),
        "data": {
            "weather": None,
            "stock": None,
            "news": [],
            "updatedAt": now.isoformat(timespec="minutes"),
        },
        "errors": {},
    }

    for key, getter in (
        ("weather", get_weather),
        ("stock", get_stock),
        ("news", get_news),
    ):
        try:
            result["data"][key] = getter()
        except Exception as exc:
            result["errors"][key] = str(exc)

    if len(result["errors"]) == 3:
        result["success"] = False
    else:
        _HOME_MARKET_CACHE["payload"] = copy.deepcopy(result)
        _HOME_MARKET_CACHE["expires_at"] = now + CACHE_TTL

    return result
