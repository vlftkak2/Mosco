"""헬스체크 API (로그인 불필요) — docker healthcheck · 시연 터널 준비 확인용.

공유 연결 풀로 `SELECT 1` 을 실행해 DB까지 살아 있는지 확인한다.
DB에 닿지 못하면 503 을 돌려 컨테이너가 unhealthy 로 표시되게 한다.
응답에는 오류 내용을 넣지 않는다 (내부 정보 노출 방지) — 원인은 서버 로그에 남긴다.
"""
import logging

from fastapi import APIRouter
from fastapi.responses import JSONResponse

import db

logger = logging.getLogger(__name__)

router = APIRouter(prefix='/api', tags=['health'])


@router.get('/health', include_in_schema=False)
def health():
    try:
        with db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute('SELECT 1')
                cursor.fetchone()
    except Exception:
        logger.exception('Health check failed: database is not reachable')
        return JSONResponse(status_code=503, content={'status': 'unavailable'})
    return {'status': 'ok'}
