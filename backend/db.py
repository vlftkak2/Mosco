"""Shared PostgreSQL connection pool for every backend service.

All services borrow connections from this single pool instead of opening a new
connection per request or keeping a private pool per module. This keeps the
total number of server connections bounded (well under PostgreSQL's
max_connections) and removes the ~100-200 ms connect cost from each request.

Two usage styles are supported so existing service code keeps its behaviour:

    with connect() as connection:          # commit on success, rollback on error,
        ...                                # connection returned to the pool on exit

    connection = open_connection()         # psycopg2-like object; close() rolls back
    try:                                   # anything uncommitted and returns the
        ...                                # connection to the pool (same result as
    finally:                               # closing a direct psycopg2 connection)
        connection.close()
"""

import contextvars
import logging
import os
import threading
from contextlib import contextmanager

import psycopg2
from psycopg2 import extensions

from config import DB_CONFIG

logger = logging.getLogger(__name__)


def _int_env(name: str, default: int, minimum: int) -> int:
    try:
        return max(minimum, int(os.getenv(name, str(default))))
    except ValueError:
        return default


POOL_MIN = _int_env("DB_POOL_MIN", 2, 0)
POOL_MAX = max(POOL_MIN, _int_env("DB_POOL_MAX", 30, 1))
# How long a request waits for a free pooled connection before failing.
ACQUIRE_TIMEOUT_SECONDS = float(os.getenv("DB_POOL_ACQUIRE_TIMEOUT_SECONDS", "15") or 15)
# Safety limits: a single statement / a single lock wait can no longer hang a request forever.
STATEMENT_TIMEOUT_MS = _int_env("DB_STATEMENT_TIMEOUT_MS", 120000, 0)
# 잠금 대기 상한: 다른 저장이 끝나기를 이 시간까지만 기다리고 "잠시 후 다시" 로 알린다 (30초 → 10초).
# 오래 기다리는 요청이 연결 · 스레드를 붙잡아 다른 회사 요청까지 막는 일을 줄인다. 관리 스크립트는 환경변수로 늘린다.
LOCK_TIMEOUT_MS = _int_env("DB_LOCK_TIMEOUT_MS", 10000, 0)
# 무거운 집계(매출이익 · 거래처원장 · 홈)만 그 트랜잭션 동안 정렬 · 해시 메모리를 늘린다 (기본 4MB 면 디스크 임시파일로 넘쳐 2배 느림).
# 전역으로 늘리면 연결 수 × 단계 수만큼 메모리를 쓰므로 보고서 쿼리에만 SET LOCAL 로 건다.
REPORT_WORK_MEM = os.getenv("DB_REPORT_WORK_MEM", "64MB").strip() or "64MB"


def use_report_memory(cursor) -> None:
    """현재 트랜잭션에서만 work_mem 을 늘린다 (커밋 · 롤백 때 원래대로)."""
    cursor.execute("SELECT set_config('work_mem', %s, true)", (REPORT_WORK_MEM,))


# 트랜잭션을 연 채 멈춘 연결(코드 오류 · 끊긴 요청)이 잠금을 계속 쥐지 않도록 서버가 끊는다. 0 이면 끔.
IDLE_IN_TRANSACTION_TIMEOUT_MS = _int_env("DB_IDLE_IN_TRANSACTION_TIMEOUT_MS", 600000, 0)

# Idle connections are kept (up to POOL_MAX) and reused. psycopg2's own pool closes
# every idle connection above `minconn`, which forces a fresh ~100-200 ms connect under
# load, so the pool is managed here directly.
_idle: list = []
_idle_lock = threading.Lock()
_slots = threading.BoundedSemaphore(POOL_MAX)

# ── 회사별 연결 상한 ─────────────────────────────────────────────────────
# 한 회사의 요청이 잠금을 기다리며 연결을 오래 쥐어도 풀 전체(POOL_MAX)를 다 쓰지 못하게 한다 → 다른 회사는 계속 처리된다.
# 회사는 요청 미들웨어(request_context.py)가 로그인 토큰에서 넣는다. 회사가 없는 작업(시작 작업 · 백그라운드 스레드)은 상한 없음.
POOL_MAX_PER_COMPANY = max(1, min(POOL_MAX, _int_env("DB_POOL_MAX_PER_COMPANY", max(5, POOL_MAX // 3), 1)))
current_company: contextvars.ContextVar[str] = contextvars.ContextVar("db_current_company", default="")
_company_slots: dict = {}
_company_slots_lock = threading.Lock()
_borrowed_company_slot: dict = {}   # id(빌려준 연결) → 회사 세마포어


def _company_slot(companyid: str):
    with _company_slots_lock:
        slot = _company_slots.get(companyid)
        if slot is None:
            slot = _company_slots[companyid] = threading.BoundedSemaphore(POOL_MAX_PER_COMPANY)
        return slot


class DatabaseBusyError(ValueError):
    """Raised when no pooled connection becomes free within the acquire timeout.

    Subclasses ValueError so existing routes show the message to the user (HTTP 400)
    instead of a generic server error.
    """


class DatabaseContentionError(ValueError):
    """Lock wait timeout / deadlock / statement timeout, reported with a friendly message."""


_CONTENTION_MESSAGES = {
    "55P03": "다른 사용자가 같은 재고를 저장하고 있습니다. 잠시 후 다시 시도해 주세요.",  # lock_not_available
    "40P01": "다른 사용자의 저장과 겹쳤습니다. 잠시 후 다시 시도해 주세요.",            # deadlock_detected
    "57014": "처리 시간이 너무 길어 중단되었습니다. 조건을 줄이거나 잠시 후 다시 시도해 주세요.",  # query_canceled
}


def _friendly_error(error: Exception) -> Exception | None:
    pgcode = getattr(error, "pgcode", None) or ""
    # DB 규칙(트리거)이 막은 경우: 'MOSCO:' 뒤 문구를 그대로 사용자에게 보여 준다 (예: 승인요청에 예약된 재고)
    if pgcode == "P0001":
        text = str(getattr(getattr(error, "diag", None), "message_primary", None) or error).strip()
        if text.startswith("MOSCO:"):
            return ValueError(text[len("MOSCO:"):].strip())
    message = _CONTENTION_MESSAGES.get(pgcode)
    return DatabaseContentionError(message) if message else None


# ── 한 트랜잭션 공유 (승인 통제의 승인 실행) ─────────────────────────────
# shared_transaction() 안에서는 connect() / open_connection() 이 새 연결을 빌리지 않고 같은 연결을 돌려준다.
# 안쪽 코드의 commit · rollback · close 는 아무 일도 하지 않고(rollback 은 실패로 표시), 바깥에서 한 번에 커밋한다.
# → 승인요청 상태 변경과 실제 전표 저장이 함께 성공하거나 함께 취소된다.
_shared = contextvars.ContextVar("db_shared_connection", default=None)


class _SharedConnection:
    def __init__(self, connection):
        self._connection = connection
        self.failed = False

    def __getattr__(self, name):
        return getattr(self._connection, name)

    def cursor(self, *args, **kwargs):
        return self._connection.cursor(*args, **kwargs)

    def commit(self):
        pass

    def rollback(self):
        self.failed = True

    def close(self):
        pass

    @property
    def closed(self):
        return 0

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        if exc_type is not None:
            self.failed = True
        return False


@contextmanager
def shared_transaction(settings: dict | None = None):
    """바깥 트랜잭션 하나를 열고, 그 안의 모든 connect() / open_connection() 이 이 연결을 같이 쓴다.
    settings: 이 트랜잭션에만 걸 설정값 (SET LOCAL, 예: {"mosco.approval_request": "..."})."""
    if _shared.get() is not None:
        yield _shared.get()
        return
    connection, custom = _acquire()
    shared = _SharedConnection(connection)
    token = _shared.set(shared)
    try:
        with connection.cursor() as cursor:
            for key, value in (settings or {}).items():
                cursor.execute("SELECT set_config(%s, %s, true)", (key, str(value)))
        yield shared
        if shared.failed:
            raise ValueError("저장 중 일부가 실패해 처리하지 못했습니다.")
        connection.commit()
    except psycopg2.Error as error:
        _rollback_quietly(connection)
        friendly = _friendly_error(error)
        if friendly is not None:
            raise friendly from error
        raise
    except BaseException:
        _rollback_quietly(connection)
        raise
    finally:
        _shared.reset(token)
        _release(connection, custom)


def _rollback_quietly(connection):
    try:
        connection.rollback()
    except Exception:
        pass


def _new_connection():
    return psycopg2.connect(
        host=DB_CONFIG["host"],
        port=DB_CONFIG["port"],
        dbname=DB_CONFIG["database"],
        user=DB_CONFIG["user"],
        password=DB_CONFIG["password"],
        connect_timeout=5,
        options=(f"-c statement_timeout={STATEMENT_TIMEOUT_MS} -c lock_timeout={LOCK_TIMEOUT_MS}"
                 f" -c idle_in_transaction_session_timeout={IDLE_IN_TRANSACTION_TIMEOUT_MS}"),
    )


def _take_idle():
    with _idle_lock:
        while _idle:
            connection = _idle.pop()
            if not connection.closed:
                return connection
    return None


# ── 감사 기록의 "누가" (audit_log01t.created_by) ─────────────────────────────
# 요청마다 미들웨어(request_context.py)가 로그인 사용자를 current_actor 에 넣고, 연결을 빌려줄 때
# DB 세션 설정 mosco.actor 로 넘긴다 (값이 바뀔 때만 한 번 실행). 감사 트리거가 이 값을 읽는다.
current_actor: contextvars.ContextVar[str] = contextvars.ContextVar("db_current_actor", default="")
_connection_actor: dict[tuple[int, int], str] = {}


def _apply_actor(connection) -> None:
    actor = current_actor.get()
    key = (id(connection), connection.info.backend_pid)   # 새 연결이 같은 id 를 받아도 서버 프로세스 번호로 구분
    if key in _connection_actor and _connection_actor[key] == actor:
        return
    with connection.cursor() as cursor:
        cursor.execute("SELECT set_config('mosco.actor', %s, false)", (actor,))
    connection.commit()
    _connection_actor[key] = actor


def _acquire(statement_timeout_ms: int | None = None, lock_timeout_ms: int | None = None):
    """Borrow a raw psycopg2 connection, waiting for a free slot instead of failing fast."""
    company = current_company.get()
    company_slot = _company_slot(company) if company else None
    # 순서 고정: 회사 상한 → 전체 풀 (모든 요청이 같은 순서로 잡으므로 서로 엇갈려 기다리지 않는다)
    if company_slot is not None and not company_slot.acquire(timeout=ACQUIRE_TIMEOUT_SECONDS):
        logger.warning("Database pool per-company limit reached", extra={"companyid": company, "limit": POOL_MAX_PER_COMPANY})
        raise DatabaseBusyError("같은 회사에서 처리 중인 요청이 많아 잠시 후 다시 시도해 주세요.")
    if not _slots.acquire(timeout=ACQUIRE_TIMEOUT_SECONDS):
        if company_slot is not None:
            company_slot.release()
        logger.warning("Database pool exhausted", extra={"pool_max": POOL_MAX})
        raise DatabaseBusyError("요청이 많아 잠시 후 다시 시도해 주세요.")
    connection = None
    try:
        connection = _take_idle() or _new_connection()
        if company_slot is not None:
            _borrowed_company_slot[id(connection)] = company_slot
        if connection.autocommit:
            connection.autocommit = False
        _apply_actor(connection)
        custom = statement_timeout_ms is not None or lock_timeout_ms is not None
        if custom:
            with connection.cursor() as cursor:
                if statement_timeout_ms is not None:
                    cursor.execute("SET statement_timeout = %s", (int(statement_timeout_ms),))
                if lock_timeout_ms is not None:
                    cursor.execute("SET lock_timeout = %s", (int(lock_timeout_ms),))
            connection.commit()
        return connection, custom
    except Exception:
        if connection is not None:
            _borrowed_company_slot.pop(id(connection), None)
        _slots.release()
        if company_slot is not None:
            company_slot.release()
        raise


def _release(connection, custom_timeouts: bool = False) -> None:
    """Return a connection to the pool, discarding it if it is broken."""
    # 풀에 다시 넣기 전에 꺼낸다: 넣자마자 다른 요청이 같은 연결을 빌려 자기 회사 표시를 붙일 수 있다
    company_slot = _borrowed_company_slot.pop(id(connection), None)
    try:
        broken = connection.closed or (
            connection.info.transaction_status == extensions.TRANSACTION_STATUS_UNKNOWN
        )
        if not broken:
            try:
                if connection.info.transaction_status != extensions.TRANSACTION_STATUS_IDLE:
                    connection.rollback()
                if custom_timeouts:
                    with connection.cursor() as cursor:
                        cursor.execute("RESET statement_timeout")
                        cursor.execute("RESET lock_timeout")
                    connection.commit()
            except Exception:
                broken = True
        if broken:
            try:
                _connection_actor.pop((id(connection), connection.info.backend_pid), None)
            except Exception:
                pass
            try:
                connection.close()
            except Exception:
                pass
        else:
            with _idle_lock:
                _idle.append(connection)
    except Exception:
        logger.exception("Failed to return database connection to the pool")
    finally:
        _slots.release()
        if company_slot is not None:
            company_slot.release()


@contextmanager
def connect(statement_timeout_ms: int | None = None, lock_timeout_ms: int | None = None):
    """Borrow a pooled connection for one transaction (commit on success, rollback on error)."""
    shared = _shared.get()
    if shared is not None:   # shared_transaction() 안: 같은 연결, 커밋은 바깥에서
        with shared:
            yield shared
        return
    connection, custom = _acquire(statement_timeout_ms, lock_timeout_ms)
    try:
        with connection:
            yield connection
    except psycopg2.Error as error:
        friendly = _friendly_error(error)
        if friendly is not None:
            raise friendly from error
        raise
    finally:
        _release(connection, custom)


class PooledConnection:
    """psycopg2 connection wrapper whose close() returns the connection to the pool.

    Everything else (cursor, commit, rollback, `with connection:` transaction blocks)
    is delegated to the real psycopg2 connection, so existing code is unchanged.
    """

    def __init__(self, statement_timeout_ms: int | None = None, lock_timeout_ms: int | None = None):
        self._connection, self._custom = _acquire(statement_timeout_ms, lock_timeout_ms)
        self._returned = False

    def __getattr__(self, name):
        return getattr(self._connection, name)

    def __enter__(self):
        self._connection.__enter__()
        return self

    def __exit__(self, exc_type, exc, tb):
        return self._connection.__exit__(exc_type, exc, tb)

    @property
    def closed(self):
        return 1 if self._returned else self._connection.closed

    def close(self):
        if not self._returned:
            self._returned = True
            _release(self._connection, self._custom)

    def __del__(self):
        # Safety net: never leak a pool slot if a caller forgot to close().
        try:
            self.close()
        except Exception:
            pass


def open_connection(statement_timeout_ms: int | None = None, lock_timeout_ms: int | None = None) -> PooledConnection:
    """Borrow a pooled connection that must be released with close()."""
    shared = _shared.get()
    if shared is not None:   # shared_transaction() 안: 같은 연결 (close · commit 은 바깥에서)
        return shared
    return PooledConnection(statement_timeout_ms, lock_timeout_ms)
