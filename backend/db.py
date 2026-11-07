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
LOCK_TIMEOUT_MS = _int_env("DB_LOCK_TIMEOUT_MS", 30000, 0)

# Idle connections are kept (up to POOL_MAX) and reused. psycopg2's own pool closes
# every idle connection above `minconn`, which forces a fresh ~100-200 ms connect under
# load, so the pool is managed here directly.
_idle: list = []
_idle_lock = threading.Lock()
_slots = threading.BoundedSemaphore(POOL_MAX)


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
    message = _CONTENTION_MESSAGES.get(getattr(error, "pgcode", None) or "")
    return DatabaseContentionError(message) if message else None


def _new_connection():
    return psycopg2.connect(
        host=DB_CONFIG["host"],
        port=DB_CONFIG["port"],
        dbname=DB_CONFIG["database"],
        user=DB_CONFIG["user"],
        password=DB_CONFIG["password"],
        connect_timeout=5,
        options=f"-c statement_timeout={STATEMENT_TIMEOUT_MS} -c lock_timeout={LOCK_TIMEOUT_MS}",
    )


def _take_idle():
    with _idle_lock:
        while _idle:
            connection = _idle.pop()
            if not connection.closed:
                return connection
    return None


def _acquire(statement_timeout_ms: int | None = None, lock_timeout_ms: int | None = None):
    """Borrow a raw psycopg2 connection, waiting for a free slot instead of failing fast."""
    if not _slots.acquire(timeout=ACQUIRE_TIMEOUT_SECONDS):
        logger.warning("Database pool exhausted", extra={"pool_max": POOL_MAX})
        raise DatabaseBusyError("요청이 많아 잠시 후 다시 시도해 주세요.")
    try:
        connection = _take_idle() or _new_connection()
        if connection.autocommit:
            connection.autocommit = False
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
        _slots.release()
        raise


def _release(connection, custom_timeouts: bool = False) -> None:
    """Return a connection to the pool, discarding it if it is broken."""
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


@contextmanager
def connect(statement_timeout_ms: int | None = None, lock_timeout_ms: int | None = None):
    """Borrow a pooled connection for one transaction (commit on success, rollback on error)."""
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
    return PooledConnection(statement_timeout_ms, lock_timeout_ms)
