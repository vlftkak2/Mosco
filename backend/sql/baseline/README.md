# DB 구조 기준선 (baseline)

`schema_baseline_20261128.sql` = 2026-11-28 로컬 Mosco DB의 구조(schema-only, 데이터 없음).

```
pg_dump --schema-only --no-owner --no-privileges -d Mosco -f schema_baseline_20261128.sql
```

새 DB 만드는 방법과 마이그레이션(0001~)과의 관계는 `../migrations/README.md` 를 보세요.
요약: `createdb -T template0 -E UTF8 <새DB>` → `psql -v ON_ERROR_STOP=1 -f schema_baseline_20261128.sql` → `python scripts/migrate.py --db-name <새DB>`.
