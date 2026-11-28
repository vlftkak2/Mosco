"""Mosco DB migration runner.

Applies backend/sql/migrations/NNNN_description.sql files in filename order and
records each one in the table ``schema_migrations``.

    python scripts/migrate.py --status          # list applied / pending files
    python scripts/migrate.py --dry-run         # show what would run, change nothing
    python scripts/migrate.py                   # apply all pending files
    python scripts/migrate.py --check           # exit code 3 if anything is pending
    python scripts/migrate.py --mark-applied 0003_x   # record without running (already applied by hand)

Connection settings come from config.DB_CONFIG (backend/.env / environment);
--host/--port/--db-name/--user override them. The password is taken from
config (DB_PASSWORD) or the PGPASSWORD environment variable, never from the
command line, so it does not show up in process lists or shell history.

File rules
- Normal files run inside ONE transaction together with their
  schema_migrations row: either everything is applied or nothing is.
- Files whose FIRST line contains ``-- migrate:no-transaction`` run in
  autocommit mode, statement by statement (needed for CREATE INDEX
  CONCURRENTLY). Statements are split on ``;`` at the end of a line, so such
  files must not contain $$ function bodies. Write them idempotently
  (IF NOT EXISTS ...): if one statement fails, the earlier ones stay applied
  and the file is NOT recorded, so it can be fixed and re-run.
- Every session uses ``SET lock_timeout = '5s'`` (change with
  --lock-timeout) so a migration waits at most 5 seconds for a busy table
  instead of blocking the whole ERP behind it.
- The SHA-256 checksum of each applied file is stored. If an applied file is
  edited later, the runner stops with an error: add a new file instead.
"""
import argparse
import hashlib
import os
import re
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import psycopg2  # noqa: E402

from config import DB_CONFIG  # noqa: E402

DEFAULT_DIR = BACKEND_DIR / "sql" / "migrations"
FILE_PATTERN = re.compile(r"^\d{4}_[A-Za-z0-9_\-]+\.sql$")
NO_TRANSACTION_MARK = "-- migrate:no-transaction"
# Any constant works; it only has to be the same for every runner instance.
ADVISORY_LOCK_KEY = 74_210_001

CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    version    varchar(255) PRIMARY KEY,
    checksum   varchar(64)  NOT NULL,
    applied_at timestamptz  NOT NULL DEFAULT now()
)
"""


class MigrationError(Exception):
    pass


class Migration:
    def __init__(self, path: Path):
        self.path = path
        self.version = path.stem
        raw = path.read_bytes()
        self.checksum = hashlib.sha256(raw).hexdigest()
        self.text = raw.decode("utf-8-sig")
        first_line = self.text.splitlines()[0] if self.text else ""
        self.no_transaction = NO_TRANSACTION_MARK in first_line


def load_migrations(directory: Path) -> list:
    if not directory.is_dir():
        raise MigrationError(f"Migration folder not found: {directory}")
    migrations = []
    for path in sorted(directory.glob("*.sql"), key=lambda p: p.name):
        if not FILE_PATTERN.match(path.name):
            print(f"  [skip] {path.name}: name must look like NNNN_description.sql")
            continue
        migrations.append(Migration(path))
    versions = [m.version[:4] for m in migrations]
    duplicates = sorted({v for v in versions if versions.count(v) > 1})
    if duplicates:
        raise MigrationError("Duplicate migration numbers: " + ", ".join(duplicates))
    return migrations


def split_statements(sql_text: str) -> list:
    """Split a no-transaction file on ';' at line ends (no $$ bodies allowed)."""
    statements, current = [], []
    for line in sql_text.splitlines():
        current.append(line)
        stripped = line.strip()
        if stripped.endswith(";") and not stripped.startswith("--"):
            statements.append("\n".join(current))
            current = []
    if current:
        statements.append("\n".join(current))

    def has_code(statement: str) -> bool:
        return any(l.strip() and not l.strip().startswith("--") for l in statement.splitlines())

    return [s.strip() for s in statements if has_code(s)]


def connect(args):
    settings = dict(DB_CONFIG)
    for key, value in (("host", args.host), ("port", args.port), ("database", args.db_name), ("user", args.user)):
        if value:
            settings[key] = value
    password = settings.get("password") or os.getenv("PGPASSWORD", "")
    print(f"Database: {settings['user']}@{settings['host']}:{settings['port']}/{settings['database']}")
    return psycopg2.connect(
        host=settings["host"],
        port=settings["port"],
        dbname=settings["database"],
        user=settings["user"],
        password=password,
        connect_timeout=10,
        application_name="mosco-migrate",
    )


def table_exists(connection) -> bool:
    with connection.cursor() as cursor:
        cursor.execute("SELECT to_regclass('public.schema_migrations') IS NOT NULL")
        return bool(cursor.fetchone()[0])


def applied_versions(connection) -> dict:
    if not table_exists(connection):
        return {}
    with connection.cursor() as cursor:
        cursor.execute("SELECT version, checksum, applied_at FROM schema_migrations ORDER BY version")
        return {row[0]: (row[1], row[2]) for row in cursor.fetchall()}


def set_session_limits(cursor, lock_timeout: str) -> None:
    cursor.execute("SET lock_timeout = %s", (lock_timeout,))
    # Migrations may legitimately run long (big UPDATE / index build).
    cursor.execute("SET statement_timeout = 0")


def apply_transactional(connection, migration: Migration, lock_timeout: str) -> None:
    connection.autocommit = False
    try:
        with connection.cursor() as cursor:
            set_session_limits(cursor, lock_timeout)
            cursor.execute(migration.text)
            cursor.execute(
                "INSERT INTO schema_migrations (version, checksum) VALUES (%s, %s)",
                (migration.version, migration.checksum),
            )
        connection.commit()
    except Exception:
        connection.rollback()
        raise


def apply_no_transaction(connection, migration: Migration, lock_timeout: str) -> None:
    if "$$" in migration.text:
        raise MigrationError(f"{migration.path.name}: no-transaction files must not contain $$ bodies")
    connection.autocommit = True
    statements = split_statements(migration.text)
    with connection.cursor() as cursor:
        set_session_limits(cursor, lock_timeout)
        for index, statement in enumerate(statements, start=1):
            print(f"    statement {index}/{len(statements)}")
            cursor.execute(statement)
        cursor.execute(
            "INSERT INTO schema_migrations (version, checksum) VALUES (%s, %s)",
            (migration.version, migration.checksum),
        )


def ensure_table(connection) -> None:
    connection.autocommit = True
    with connection.cursor() as cursor:
        cursor.execute(CREATE_TABLE_SQL)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Apply pending Mosco SQL migrations.")
    parser.add_argument("--dir", default=str(DEFAULT_DIR), help="migration folder (default: backend/sql/migrations)")
    parser.add_argument("--host")
    parser.add_argument("--port")
    parser.add_argument("--db-name")
    parser.add_argument("--user")
    parser.add_argument("--lock-timeout", default="5s", help="lock_timeout for migration sessions (default 5s)")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--status", action="store_true", help="list applied and pending migrations")
    mode.add_argument("--dry-run", action="store_true", help="show pending migrations without applying")
    mode.add_argument("--check", action="store_true", help="exit 3 if migrations are pending")
    mode.add_argument("--mark-applied", metavar="VERSION", action="append",
                      help="record VERSION as applied without running it (repeatable)")
    args = parser.parse_args(argv)

    try:
        migrations = load_migrations(Path(args.dir).resolve())
        connection = connect(args)
    except (MigrationError, psycopg2.Error) as error:
        print(f"ERROR: {error}")
        return 1

    try:
        read_only = args.status or args.dry_run or args.check
        if not read_only:
            ensure_table(connection)
            connection.autocommit = True
            with connection.cursor() as cursor:
                cursor.execute("SELECT pg_try_advisory_lock(%s)", (ADVISORY_LOCK_KEY,))
                if not cursor.fetchone()[0]:
                    print("ERROR: another migration run is in progress")
                    return 1

        applied = applied_versions(connection)
        by_version = {m.version: m for m in migrations}

        changed = [m for m in migrations if m.version in applied and applied[m.version][0] != m.checksum]
        if changed:
            for m in changed:
                print(f"ERROR: {m.path.name} was changed after it was applied (checksum mismatch). "
                      "Do not edit applied migrations; add a new file instead.")
            return 1

        pending = [m for m in migrations if m.version not in applied]
        unknown = sorted(v for v in applied if v not in by_version)

        if args.status:
            for m in migrations:
                if m.version in applied:
                    print(f"  [applied {applied[m.version][1]:%Y-%m-%d %H:%M}] {m.path.name}")
                else:
                    flag = " (no-transaction)" if m.no_transaction else ""
                    print(f"  [pending] {m.path.name}{flag}")
            for v in unknown:
                print(f"  [applied, file missing] {v}")
            print(f"{len(applied)} applied, {len(pending)} pending")
            return 0

        if args.check:
            print(f"{len(pending)} pending migration(s)")
            for m in pending:
                print(f"  - {m.path.name}")
            return 3 if pending else 0

        if args.mark_applied:
            for version in args.mark_applied:
                version = Path(version).stem
                if version not in by_version:
                    print(f"ERROR: no migration file named {version}.sql")
                    return 1
                if version in applied:
                    print(f"  already recorded: {version}")
                    continue
                with connection.cursor() as cursor:
                    cursor.execute(
                        "INSERT INTO schema_migrations (version, checksum) VALUES (%s, %s)",
                        (version, by_version[version].checksum),
                    )
                print(f"  recorded without running: {version}")
            return 0

        if not pending:
            print("Nothing to apply: database is up to date.")
            return 0

        for m in pending:
            kind = "no-transaction" if m.no_transaction else "transaction"
            if args.dry_run:
                print(f"  would apply ({kind}): {m.path.name}")
                continue
            print(f"  applying ({kind}): {m.path.name}")
            try:
                if m.no_transaction:
                    apply_no_transaction(connection, m, args.lock_timeout)
                else:
                    apply_transactional(connection, m, args.lock_timeout)
            except (psycopg2.Error, MigrationError) as error:
                print(f"ERROR in {m.path.name}: {error}".rstrip())
                if m.no_transaction:
                    print("  Note: statements before the failing one stay applied (no transaction).")
                else:
                    print("  Rolled back: nothing from this file was applied.")
                return 1
        if args.dry_run:
            print(f"{len(pending)} migration(s) would be applied (dry run, nothing changed).")
        else:
            print(f"Applied {len(pending)} migration(s).")
        return 0
    finally:
        connection.close()


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(errors="replace")
    except Exception:
        pass
    sys.exit(main())
