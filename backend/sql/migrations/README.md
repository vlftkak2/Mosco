# DB 마이그레이션 (backend/sql/migrations)

DB 구조 변경(테이블·컬럼·인덱스·함수 등)은 이 폴더에 SQL 파일로 추가하고
`backend/scripts/migrate.py` 로 적용합니다. 적용 기록은 DB의 `schema_migrations` 테이블에 남습니다.

## 파일 이름 규칙

```
NNNN_description.sql      예) 0001_add_customer_memo.sql, 0002_idx_outbound_date.sql
```

- `NNNN` 은 4자리 번호, 파일 이름 순서대로 적용됩니다. 번호는 중복되면 안 됩니다.
- 설명은 영문 소문자/숫자/밑줄(`_`)·하이픈(`-`)만 사용합니다.
- 이미 적용된 파일은 **수정하지 않습니다** (체크섬이 달라지면 실행기가 멈춥니다). 고칠 내용은 새 번호 파일로 추가합니다.
- 테이블을 만들 때 감사 컬럼(createdat/updatedat/created_by/updated_by)은 맨 오른쪽에 둡니다.

## 트랜잭션

- 기본: 파일 전체가 **하나의 트랜잭션**으로 실행됩니다. 중간에 오류가 나면 그 파일의 변경은 모두 취소됩니다.
- 첫 줄에 `-- migrate:no-transaction` 을 쓰면 자동 커밋으로 문장별 실행합니다.
  `CREATE INDEX CONCURRENTLY` 처럼 트랜잭션 안에서 실행할 수 없는 문장에 사용합니다.
  - 문장은 줄 끝의 `;` 로 나누므로 `$$ ... $$` 함수 본문을 넣으면 안 됩니다 (함수는 일반 파일로).
  - 실패하면 앞 문장은 이미 적용된 상태로 남으므로 `IF NOT EXISTS` 등으로 **다시 실행해도 안전하게** 작성합니다.
  - `CREATE INDEX CONCURRENTLY` 가 실패하면 INVALID 인덱스가 남을 수 있으니 `DROP INDEX CONCURRENTLY IF EXISTS ...` 후 다시 실행합니다.
- 모든 실행은 `lock_timeout = 5s` 로 실행됩니다. 사용 중인 테이블의 잠금을 5초 안에 얻지 못하면
  ERP 전체를 막지 않고 실패하므로, 한가한 시간에 다시 실행합니다.

## 실행 방법

```powershell
# 개발 PC (backend 폴더에서, backend/.env 의 DB 설정 사용)
venv\Scripts\python.exe scripts\migrate.py --status      # 적용/대기 목록
venv\Scripts\python.exe scripts\migrate.py --dry-run     # 적용될 파일만 표시
venv\Scripts\python.exe scripts\migrate.py               # 대기 중인 파일 적용
venv\Scripts\python.exe scripts\migrate.py --db-name Mosco_test   # 다른 DB에 적용

# 배포 PC: deploy.ps1 -Migrate 가 백업(pg_dump) 후 새 백엔드 이미지로 실행
docker compose run --rm --no-deps -T backend python scripts/migrate.py --status
```

기타 옵션: `--check`(대기 파일이 있으면 종료코드 3), `--mark-applied 0003_xxx`(이미 손으로 적용한 파일을 실행 없이 기록),
`--dir <폴더>`, `--host/--port/--user`. 비밀번호는 명령줄로 받지 않습니다 (`DB_PASSWORD` 또는 `PGPASSWORD`).

## 이전 SQL 파일과 기준선(baseline)

- `backend/sql/*.sql` (ai_cost_migration.sql, approval_control_migration.sql, payroll_migration.sql 등)은
  이 시스템이 생기기 **전에 손으로 적용한** 파일입니다. 이 실행기는 그 파일들을 실행하지 않습니다.
- 그 결과를 포함한 2026-11-28 시점의 전체 구조가 `backend/sql/baseline/schema_baseline_20261128.sql` 입니다.
  (`pg_dump --schema-only --no-owner --no-privileges` 로 로컬 Mosco DB에서 추출)
- `0001` 부터의 마이그레이션은 이 기준선 **이후의 변경**만 담습니다.

### 새 DB를 처음부터 만들 때

```powershell
$env:PGPASSWORD = '<비밀번호>'   # 화면에 남지 않게 입력 후 창을 닫거나 Remove-Item Env:PGPASSWORD
$bin = 'C:\Program Files\PostgreSQL\18\bin'
& "$bin\createdb.exe" -h localhost -U postgres -T template0 -E UTF8 Mosco_new
& "$bin\psql.exe" -X -h localhost -U postgres -d Mosco_new -v ON_ERROR_STOP=1 -f backend\sql\baseline\schema_baseline_20261128.sql
cd backend; venv\Scripts\python.exe scripts\migrate.py --db-name Mosco_new
```

- 기준선은 **구조만** 있습니다. 메뉴·공통코드·관리자 계정 같은 기초 데이터는 별도로 넣어야 합니다.
- 파일 안의 `\restrict` / `\unrestrict` 줄은 pg_dump 18 의 보안 기능이며 `psql` 로 실행해야 합니다 (pgAdmin 쿼리창 X).
- 운영 DB가 이미 기준선 상태라면 기준선은 실행하지 않고 `migrate.py` 만 실행합니다.
