import copy
import json
import logging
import re
import threading
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
_STEEL_NEWS_CACHE = {"expires_at": None, "items": [], "available": False}
_STEEL_NEWS_LOCK = threading.Lock()
logger = logging.getLogger(__name__)

# 지난 값 먼저 (stale-while-revalidate): 30분이 지나 만료된 날씨·뉴스는 지난 값을 바로 돌려주고, 새 값은 뒤에서 받는다.
# → 만료 직후 대시보드를 연 사람이 외부 사이트(1초 이상)를 기다리지 않는다. 서버가 켜진 뒤 첫 요청만 기다린다.
_REFRESHING = set()
_REFRESHING_LOCK = threading.Lock()


def _refresh_in_background(name, refresh):
    """같은 이름의 새로 받기는 한 번에 하나만 돌린다."""
    with _REFRESHING_LOCK:
        if name in _REFRESHING:
            return
        _REFRESHING.add(name)

    def run():
        try:
            refresh()
        except Exception as error:   # 뒤에서 받다 실패해도 지난 값은 그대로 둔다
            logger.warning("Background refresh failed (%s): %s", name, type(error).__name__)
        finally:
            with _REFRESHING_LOCK:
                _REFRESHING.discard(name)

    threading.Thread(target=run, name=f"dashboard-refresh-{name}", daemon=True).start()


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
    data = _fetch_json(url, timeout=4)
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


_STEEL_NEWS_FETCH_LOCK = threading.Lock()


def _news_snapshot(limit):
    with _STEEL_NEWS_LOCK:
        snapshot = {
            "items": copy.deepcopy(_STEEL_NEWS_CACHE["items"][:limit]),
            "available": _STEEL_NEWS_CACHE["available"],
            "cached": True,
        }
        return snapshot, _STEEL_NEWS_CACHE["expires_at"]


def _load_steel_news(limit):
    """외부에서 뉴스를 받아 캐시에 넣는다 (받는 동안에도 다른 요청은 지난 값을 읽는다)."""
    with _STEEL_NEWS_FETCH_LOCK:
        snapshot, expires_at = _news_snapshot(limit)
        now = datetime.now()
        if expires_at and now < expires_at:   # 기다리는 동안 다른 요청이 이미 새로 받음
            return snapshot
        articles = []
        available = False
        try:
            query = quote('철강 OR 철강가격 OR 철광석 OR 철스크랩 OR 철강수급 OR 철강업계')
            rss_url = f"https://news.google.com/rss/search?q={query}&hl=ko&gl=KR&ceid=KR:ko"
            root = ET.fromstring(_fetch_text(rss_url))
            seen = set()
            for item in root.findall("./channel/item"):
                title = _strip_html(item.findtext("title"))
                link = item.findtext("link") or ""
                if not title or not link:
                    continue
                title = re.sub(r"\s+-\s+[^-]+$", "", title).strip()
                identity = re.sub(r"[^0-9a-z가-힣]", "", title.lower())
                if identity in seen:
                    continue
                seen.add(identity)
                pub_date = item.findtext("pubDate")
                published_at = ""
                published_sort = None
                try:
                    published_sort = parsedate_to_datetime(pub_date)
                    published_at = published_sort.isoformat()
                except (TypeError, ValueError, OverflowError):
                    published_at = pub_date or ""
                source = item.findtext("source") or urlparse(link).netloc
                articles.append({
                    "title": title,
                    "source": source,
                    "description": _strip_html(item.findtext("description")),
                    "url": link,
                    "published_at": published_at,
                    "_published_sort": published_sort,
                })
            articles.sort(
                key=lambda article: article["_published_sort"].timestamp() if article["_published_sort"] else 0,
                reverse=True,
            )
            for article in articles:
                article.pop("_published_sort", None)
            articles = articles[:limit]
            available = bool(articles)
        except Exception as error:
            logger.warning("Steel news RSS unavailable: %s", type(error).__name__)

        with _STEEL_NEWS_LOCK:
            _STEEL_NEWS_CACHE.update({
                "expires_at": now + CACHE_TTL,
                "items": copy.deepcopy(articles),
                "available": available,
            })
        return {"items": articles, "available": available, "cached": False}


def get_steel_news(limit=8):
    snapshot, expires_at = _news_snapshot(limit)
    if expires_at and datetime.now() < expires_at:
        return snapshot
    if expires_at is not None:   # 만료: 지난 값을 바로 주고 뒤에서 새로 받는다
        _refresh_in_background("news", lambda: _load_steel_news(limit))
        return snapshot
    return _load_steel_news(limit)   # 서버가 켜진 뒤 처음: 받을 때까지 기다린다





_WEATHER_CACHE = {"expires_at": None, "data": None}
_WEATHER_LOCK = threading.Lock()


# wttr.in 날씨 코드(WWO) → 대시보드가 쓰는 한글 날씨 (아이콘도 이 글자로 고른다)
_WTTR_CONDITIONS = [
    ({113}, "맑음"), ({116}, "구름 조금"), ({119, 122}, "흐림"), ({143, 248, 260}, "안개"),
    ({176, 263, 266, 293, 296, 353}, "약한 비"), ({299, 302, 356}, "비"), ({305, 308, 359}, "강한 비"),
    ({179, 323, 326, 368}, "약한 눈"), ({227, 230, 329, 332, 335, 338, 371}, "눈"),
    ({182, 185, 281, 284, 311, 314, 317, 320, 350, 362, 365, 374, 377}, "진눈깨비"),
    ({200, 386, 389, 392, 395}, "뇌우"),
]


def get_weather_wttr():
    """open-meteo 에 연결이 안 될 때 쓰는 예비 날씨 (wttr.in, 서울). 반환 모양은 get_weather() 와 같다."""
    data = _fetch_json("https://wttr.in/Seoul?format=j1", timeout=4)
    current = (data.get("current_condition") or [{}])[0]
    today = (data.get("weather") or [{}])[0]
    code = int(_safe_float(current.get("weatherCode"), 0) or 0)
    condition = next((label for codes, label in _WTTR_CONDITIONS if code in codes), "날씨 정보")
    rain = [int(_safe_float(hour.get("chanceofrain"), 0) or 0) for hour in today.get("hourly", [])]
    return {
        "location": "서울",
        "temperature": round(_safe_float(current.get("temp_C"), 0)),
        "apparentTemperature": round(_safe_float(current.get("FeelsLikeC"), 0)),
        "humidity": int(_safe_float(current.get("humidity"), 0) or 0),
        "precipitation": _safe_float(current.get("precipMM"), 0),
        "windSpeed": _safe_float(current.get("windspeedKmph"), 0),
        "condition": condition,
        "todayHigh": round(_safe_float(today.get("maxtempC"), 0)),
        "todayLow": round(_safe_float(today.get("mintempC"), 0)),
        "rainProbability": max(rain) if rain else None,
        "updatedAt": datetime.now().isoformat(timespec="minutes"),
        "source": "wttr.in",
    }


def _cached_weather():
    now = datetime.now()
    with _WEATHER_LOCK:
        expires_at, cached = _WEATHER_CACHE["expires_at"], copy.deepcopy(_WEATHER_CACHE["data"])
    if expires_at and now < expires_at:
        return cached
    if expires_at is not None:   # 만료: 지난 값(실패였으면 빈 값)을 바로 주고 뒤에서 새로 받는다
        _refresh_in_background("weather", _load_weather)
        return cached
    return _load_weather()   # 서버가 켜진 뒤 처음: 받을 때까지 기다린다


def _load_weather():
    now = datetime.now()
    data = None
    # open-meteo → 안 되면 wttr.in. 둘 다 안 되면 날씨 칸만 비운다
    for name, getter in (("open-meteo", get_weather), ("wttr.in", get_weather_wttr)):
        try:
            data = getter()
            break
        except Exception as error:
            logger.warning("Weather unavailable (%s): %s", name, type(error).__name__)
    with _WEATHER_LOCK:
        # 실패도 10분은 기억해 매번 기다리지 않게 한다
        _WEATHER_CACHE.update({"expires_at": now + (CACHE_TTL if data else timedelta(minutes=10)), "data": copy.deepcopy(data)})
    return data


def warm_today_info_in_background():
    """서버를 켤 때 날씨·뉴스를 미리 받아 둔다 → 서버를 켠 뒤 처음 대시보드를 연 사람도 기다리지 않는다.
    뒤에서(데몬 스레드) 받으므로 서버 시작은 늦어지지 않는다. 실패해도 첫 요청 때 예전처럼 다시 받는다.
    끄려면 환경변수 DASHBOARD_WARMUP=0."""
    import os

    if os.getenv("DASHBOARD_WARMUP", "1").strip().lower() in {"0", "false", "no", "off"}:
        return

    def run():
        try:
            get_today_info()   # 화면 요청(/today)과 같은 기본값(뉴스 6건) → 같은 캐시를 채운다
        except Exception as error:
            logger.warning("Dashboard warm-up failed: %s", type(error).__name__)

    threading.Thread(target=run, name="dashboard-warmup", daemon=True).start()


def get_today_info(news_limit=6):
    """대시보드 '오늘' 칸: 서울 날씨 + 철강 뉴스 (각각 30분 캐시, 둘을 동시에 받아온다)."""
    result = {}
    threads = [
        threading.Thread(target=lambda: result.__setitem__("weather", _cached_weather())),
        threading.Thread(target=lambda: result.__setitem__("news", get_steel_news(news_limit))),
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=10)
    news = result.get("news") or {"items": [], "available": False}
    return {"weather": result.get("weather"), "news": news.get("items", []), "news_available": news.get("available", False)}
