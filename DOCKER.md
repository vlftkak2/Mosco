# Mosco Docker 배포

Docker는 앱 코드를 컨테이너 이미지에 담습니다. 배포 PC는 GitHub의 `mosco` 브랜치를 받아 이미지를 빌드하므로, 소스 파일을 직접 복사할 필요가 없습니다.
PostgreSQL 18은 Docker가 아니라 **배포 PC(호스트)에 설치된 DB**를 그대로 사용합니다.

## 처음 한 번 설정

1. 배포 PC에 Docker Desktop을 설치하고 실행합니다.
2. PowerShell에서 저장소를 받습니다.

   ```powershell
   git clone --branch mosco --single-branch https://github.com/vlftkak2/Mosco.git C:\Mosco
   Set-Location C:\Mosco
   ```

3. 환경 설정 파일을 만들고 엽니다.

   ```powershell
   Copy-Item backend/.env.example backend/.env
   notepad backend/.env
   ```

4. `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `JWT_SECRET_KEY`를 배포 환경 값으로 설정합니다. DB가 배포 PC에 설치되어 있으면 `DB_HOST=host.docker.internal`을 사용합니다. 다른 서버에 있으면 그 서버의 주소를 입력합니다. AI 주문서 분석을 쓰면 `OPENAI_API_KEY`도 입력합니다.
   - 컨테이너는 기본으로 **운영 모드(`APP_ENV=production`)** 로 실행됩니다. 운영 모드에서는 DB 접속 정보 4개가 모두 있어야 하고 `JWT_SECRET_KEY`는 32자 이상이어야 하며, API 문서(`/docs`, `/openapi.json`)는 열리지 않습니다.
   - JWT 키 만들기: `python -c "import secrets; print(secrets.token_urlsafe(48))"`
   - 점검용으로 개발 모드가 필요하면 배포 폴더의 `.env`(저장소 최상위, `backend/.env` 아님)에 `APP_ENV=development` 를 넣습니다.
5. 처음 실행합니다.

   ```powershell
   .\deploy.ps1 -SkipPull
   ```

브라우저에서 `http://localhost`를 열어 확인합니다. 외부 PC에서 접속하려면 배포 PC의 방화벽에서 HTTP 포트 80을 허용하고 `http://배포PC주소`로 접속합니다.

## 코드 업데이트 (deploy.ps1)

개발 PC에서 커밋한 내용을 GitHub `Mosco` 저장소의 `mosco` 브랜치로 푸시한 뒤, 배포 PC의 저장소 폴더에서 다음을 실행합니다.

```powershell
.\deploy.ps1               # 일반 배포
.\deploy.ps1 -Migrate      # DB 마이그레이션이 포함된 배포 (백업 후 적용)
```

`deploy.ps1` 이 하는 일:

1. 브랜치(`mosco`) 확인, `backend/.env` 운영 필수값 검사 (DB_HOST/DB_NAME/DB_USER/DB_PASSWORD, JWT_SECRET_KEY 32자 이상). 빠진 값이 있으면 한글 안내와 함께 멈춥니다.
2. `git pull --ff-only` (`-SkipPull` 로 생략 가능)
3. 이미지 빌드. 태그는 **git 짧은 커밋 해시**(예: `mosco-backend:1a2b3c4`)이고, 성공하면 `:latest` 도 같은 이미지를 가리킵니다.
4. 새 백엔드 이미지로 대기 중인 DB 마이그레이션 확인
   - 대기 파일이 있는데 `-Migrate` 가 없으면 **컨테이너를 바꾸지 않고 멈춥니다**.
   - `-Migrate` 이면 `ops\db_backup.ps1` 로 pg_dump 백업(기본 `C:\MoscoBackup`, `-BackupDir` 로 변경, `-SkipBackup` 로 생략) → 마이그레이션 적용. 실패하면 컨테이너는 이전 버전 그대로입니다.
5. 컨테이너 교체 후 백엔드 헬스체크(`/api/health`)가 정상이 될 때까지 대기. 실패하면 백엔드 로그와 롤백 명령을 보여 줍니다.
6. 배포 기록(`.deploy\history.txt`) 저장, 오래된 이미지 태그 정리(최근 `-KeepTags 5`개 유지)

`backend/.env`는 컨테이너 교체 후에도 그대로 유지됩니다.

## 롤백

```powershell
.\deploy.ps1 -ListTags            # 배포 기록과 남아 있는 이미지 태그
.\deploy.ps1 -Rollback 1a2b3c4    # 빌드 없이 해당 태그 이미지로 컨테이너 재시작
```

- 롤백은 **이미지(코드)만** 되돌립니다. 그 사이 적용된 DB 마이그레이션은 되돌리지 않습니다.
  옛 코드가 새 DB 구조와 맞지 않으면 아래 "DB 복원 절차"로 마이그레이션 전 백업을 복원해야 합니다.
- 롤백 후 다시 최신으로 가려면 `.\deploy.ps1 -SkipPull` (또는 그냥 `.\deploy.ps1`).

## DB 마이그레이션

DB 구조 변경은 `backend/sql/migrations/NNNN_설명.sql` 로 추가하고 `backend/scripts/migrate.py` 로 적용합니다.
규칙(트랜잭션, `-- migrate:no-transaction`, lock_timeout 5초, 체크섬)은 `backend/sql/migrations/README.md` 를 보세요.

```powershell
# 배포 PC (컨테이너 안에서, backend/.env 설정 사용)
docker compose run --rm --no-deps -T backend python scripts/migrate.py --status
docker compose run --rm --no-deps -T backend python scripts/migrate.py --dry-run

# 개발 PC
cd backend; venv\Scripts\python.exe scripts\migrate.py --status
```

- `backend/sql/*.sql` 은 이 시스템 이전에 손으로 적용한 파일이며 실행기가 다시 실행하지 않습니다.
- 2026-11-28 기준 전체 구조: `backend/sql/baseline/schema_baseline_20261128.sql` (새 DB 만들 때 사용).
- **사용자가 없는 시간에 실행합니다.** `0001_audit_log_request_key_month_close_guard.sql` 은 트리거 20여 개와 FK 검사를
  한 트랜잭션으로 적용하므로, 끝날 때까지(데이터량에 따라 수 초) 전표 테이블의 저장이 잠시 멈춥니다 (조회는 가능).
  `0002_performance_indexes.sql` 은 `CREATE INDEX CONCURRENTLY` 라 저장을 막지 않지만 데이터가 많으면 수 분 걸립니다.

### DB 서버 안전 설정 (처음 한 번)

`ops\postgres_settings.sql` 을 DB 관리자 계정으로 실행합니다. 앱 밖 접속(pgAdmin · psql)에서 트랜잭션을 연 채
방치한 세션을 10분 뒤 끊고(`idle_in_transaction_session_timeout`), 1초 넘는 잠금 대기를 서버 로그에 남깁니다(`log_lock_waits`).
파일 아래쪽의 메모리 설정(shared_buffers 등)은 서버 메모리에 맞춰 값을 정한 뒤 적용하고 PostgreSQL 을 재시작합니다.

```powershell
& 'C:\Program Files\PostgreSQL8in\psql.exe' -X -h localhost -U postgres -d Mosco -v ON_ERROR_STOP=1 -f ops\postgres_settings.sql
```

### 잠금 · 연결 관련 백엔드 설정 (backend/.env, 기본값이면 생략)

| 이름 | 기본값 | 의미 |
|---|---|---|
| `DB_LOCK_TIMEOUT_MS` | 10000 | 다른 저장이 끝나기를 기다리는 최대 시간. 넘으면 "잠시 후 다시" 안내 (관리 스크립트는 늘려서 실행) |
| `DB_POOL_MAX` | 30 | 백엔드 한 프로세스의 DB 연결 수 |
| `DB_POOL_MAX_PER_COMPANY` | 10 | 한 회사가 동시에 쓸 수 있는 연결 수 (한 회사의 대기가 다른 회사를 막지 않게) |
| `API_THREADPOOL_SIZE` | 100 | 동기 API 실행 스레드 수 |
| `DB_REPORT_WORK_MEM` | 64MB | 매출이익 · 원장 집계 트랜잭션에만 쓰는 정렬 메모리 |

## DB 백업

`ops\db_backup.ps1` 은 `backend/.env` 의 접속 정보로 `pg_dump -Fc` 백업을 만듭니다 (`host.docker.internal` 은 `localhost` 로 바꿔 접속, 비밀번호는 화면에 출력하지 않음).

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Mosco\ops\db_backup.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Mosco\ops\db_backup.ps1 -BackupDir D:\MoscoBackup -RetentionDays 30 -SecondaryPath E:\MoscoBackupCopy
```

- 파일: `<BackupDir>\Mosco_yyyyMMdd_HHmmss.dump` (작성 중에는 `.partial`, `pg_restore --list` 검증 후 이름 변경)
- `RetentionDays`(기본 30일)보다 오래된 백업은 삭제 (백업이 성공했을 때만, 보조 경로도 동일)
- `-SecondaryPath`: 다른 디스크/NAS 로 한 부 더 복사 (같은 디스크에만 두면 디스크 고장 시 함께 잃음)
- 로그: `<BackupDir>\backup.log` 에 한 줄씩 기록, 실패 시 종료코드 1
- pg_dump 위치는 기본 `C:\Program Files\PostgreSQL\18\bin` (`-PgBin` 으로 변경)

### 매일 자동 백업 (02:30)

관리자 PowerShell 에서 한 번 실행합니다.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Mosco\ops\register_backup_task.ps1 -BackupDir C:\MoscoBackup -SecondaryPath E:\MoscoBackupCopy
Start-ScheduledTask -TaskName 'Mosco DB Backup'      # 시험 실행 → C:\MoscoBackup\backup.log 확인
```

SYSTEM 계정으로 실행됩니다. 보조 경로가 네트워크 공유(`\\NAS\...`)이면 `-RunAsUser <계정>` 을 사용하세요. 해제: `-Unregister`.

### 복원 리허설 (월 1회 권장)

백업이 실제로 복원되는지 확인합니다. 최신 백업을 임시 DB `Mosco_restore_check` 에 복원하고 테이블 수·행 수·함수/트리거/인덱스 수를 확인한 뒤 임시 DB를 삭제합니다. 운영 DB는 읽기만 합니다(행 수 비교).

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Mosco\ops\db_restore_test.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Mosco\ops\db_restore_test.ps1 -DumpFile C:\MoscoBackup\Mosco_20261128_023000.dump -KeepDb
```

결과는 `<BackupDir>\restore_test.log` 에 기록됩니다. "행 수 차이"는 백업 이후 입력된 데이터만큼 생기는 것이 정상입니다.

## DB 복원 절차 (장애 시)

> 운영 DB를 덮어쓰는 작업입니다. 먼저 현재 상태를 한 번 더 백업하고, 가능하면 새 이름으로 복원해 확인한 뒤 교체합니다.

```powershell
$bin  = 'C:\Program Files\PostgreSQL\18\bin'
$dump = 'C:\MoscoBackup\Mosco_20261128_023000.dump'     # 복원할 백업
$env:PGPASSWORD = Read-Host '비밀번호'                  # 화면 기록에 남지 않도록 입력

# 1) 서비스 중지 (DB 접속 차단) + 현재 상태 백업
docker compose stop backend nginx
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Mosco\ops\db_backup.ps1 -BackupDir C:\MoscoBackup\before_restore

# 2) 새 이름의 DB 로 복원하고 확인
& "$bin\createdb.exe" -h localhost -U postgres -T template0 -E UTF8 Mosco_restored
& "$bin\pg_restore.exe" -h localhost -U postgres --no-owner --no-privileges --exit-on-error -d Mosco_restored $dump
#    (psql 로 Mosco_restored 의 주요 데이터 확인)

# 3) 이름 교체 (기존 DB 는 Mosco_old_날짜 로 남겨 둠)
& "$bin\psql.exe" -X -h localhost -U postgres -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'Mosco' AND pid <> pg_backend_pid();"
& "$bin\psql.exe" -X -h localhost -U postgres -d postgres -c 'ALTER DATABASE "Mosco" RENAME TO "Mosco_old_20261128";'
& "$bin\psql.exe" -X -h localhost -U postgres -d postgres -c 'ALTER DATABASE "Mosco_restored" RENAME TO "Mosco";'

# 4) 전용 DB 계정을 쓰면 권한 다시 부여 (--no-owner/--no-privileges 로 복원했으므로)
#    예: GRANT ... ON ALL TABLES IN SCHEMA public TO <앱계정>;  (운영 계정 정책에 맞게)

# 5) 서비스 시작 · 확인
docker compose up --detach --no-build --wait
Remove-Item Env:PGPASSWORD
```

- 백업 시점 이후의 입력은 복원되지 않습니다 (최대 하루치). 복원 후 사용자에게 마지막 입력 확인을 안내합니다.
- 코드도 그 시점 버전이 필요하면 `.\deploy.ps1 -Rollback <태그>` 를 함께 사용합니다.

## 운영 구성

- PostgreSQL은 기존 DB를 계속 사용하며 Docker가 새 DB를 만들거나 초기화하지 않습니다.
- 백엔드는 프론트엔드와 Nginx를 통해서만 접근합니다. 백엔드 컨테이너는 root 가 아닌 `app` 계정으로 실행됩니다.
- 헬스체크: `GET /api/health` (로그인 불필요, DB `SELECT 1` 성공 시 200 `{"status":"ok"}`, 실패 시 503).
- 소스의 `.env` 파일은 이미지에 복사하지 않습니다. 각 배포 PC의 `backend/.env`에서 실행 설정을 전달합니다.
- 기본 웹 포트는 80입니다. 이미 사용 중이면 배포 폴더에 `.env` 파일을 만들고 `HTTP_PORT=8080`처럼 지정할 수 있습니다.
- 컨테이너 로그는 서비스마다 20MB × 5개로 순환됩니다 (디스크가 로그로 가득 차지 않음).
- 로그인(`/api/login`)과 비밀번호 API(`/passwordapi/`)는 IP당 분당 10회(버스트 10)로 제한되며 초과 시 429 입니다.
- AI 주문 사용량은 PostgreSQL 테이블(`aiorderusage01t`)에 저장됩니다. 예전의 `ai_order_usage` Docker 볼륨(SQLite)은 더 이상 쓰지 않아 compose 에서 제거했습니다.
  남아 있는 볼륨은 필요 없으면 `docker volume ls` 로 확인 후 `docker volume rm mosco_ai_order_usage` 로 지울 수 있습니다.
- HTTPS 는 인증서 발급 후 `nginx/default.conf` 아래쪽의 주석 템플릿(HSTS 포함)을 사용합니다.

로그와 상태를 확인하려면 다음을 사용합니다.

```powershell
docker compose ps
docker compose logs -f backend
docker compose logs -f nginx
```

> 주의: `docker compose config` 는 `backend/.env` 의 비밀값(JWT 키, API 키)을 화면에 그대로 출력합니다. 검사만 할 때는 `docker compose config --quiet` 를 사용하세요.

## 주기 작업 (작업 스케줄러 등록 권장)

| 주기 | 작업 | 명령 (배포 PC, 저장소 폴더) | 실패 시 |
|---|---|---|---|
| 매일 02:30 | DB 백업 | `ops\register_backup_task.ps1` 로 등록 (위 "DB 백업") | 종료코드 1 · `backup.log` 확인 |
| 매일 03:30 | 데이터 정합성 점검 (재고 = 수불, 로트 소진량, 전표 ↔ 수불, 원가 보존, 원장 · 여신 잔액) | `docker compose run --rm --no-deps -T backend python scripts/integrity_check.py` | 종료코드 1 + `[FAIL]` 회사 · 규칙 출력 → 즉시 확인 |
| 매주 일요일 | 기록 테이블 정리 (중복방지 키 30일 · 접속기록 2년 · 변경이력 5년) | `docker compose run --rm --no-deps -T backend python scripts/cleanup_logs.py` | 로그 확인 |
| 매월 1회 | 복원 리허설 | `ops\db_restore_test.ps1` | 복원 실패 = 백업 무효, 즉시 점검 |
| 매월 1회 | 의존성 취약점 점검 | `cd frontend; npm audit --omit=dev` / `pip-audit -r backend/requirements.txt` | 결과에 따라 버전 올림 |

- 정합성 점검은 데이터를 바꾸지 않습니다 (매출이익 검사에 임시 테이블만 사용). 데이터가 많으면 수 분 걸리므로 새벽에 돌립니다.
- 감사 기록: `audit_log01t`(전표 · 거래처 · 계정 · 권한 · 월마감 변경 전/후 값, 수행자), `access_log01t`(로그인 성공/실패 · 로그아웃 · 운영사(001)의 고객사 관리 화면 접근).
  관리 스크립트가 마감된 달의 전표를 일부러 고쳐야 하면 그 트랜잭션에서만 `SELECT set_config('mosco.skip_close_check', 'on', true);` 를 실행합니다 (DB 트리거가 막음).
