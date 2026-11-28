-- PostgreSQL 잠금 · 세션 안전 설정 (DB 관리자 계정으로 1회 실행, 다시 실행해도 안전)
--   psql -X -h <호스트> -U postgres -d Mosco -v ON_ERROR_STOP=1 -f ops\postgres_settings.sql
--
-- 앱(backend/db.py)은 자기 연결에 statement_timeout · lock_timeout · idle_in_transaction_session_timeout 을 따로 건다.
-- 아래는 앱 밖의 접속(pgAdmin · psql · 스크립트)까지 지키는 DB 단위 기본값이다.
-- 새로 접속하는 세션부터 적용된다 (이미 열린 pgAdmin 창은 다시 접속해야 함).

-- 1) 트랜잭션을 연 채 방치된 세션 자동 종료 (예: pgAdmin 에서 BEGIN; UPDATE ... 후 창을 열어 둔 채 자리 비움 → 그 행을 쓰는 저장이 계속 막힘)
DO $$
BEGIN
    EXECUTE format('ALTER DATABASE %I SET idle_in_transaction_session_timeout = %L', current_database(), '10min');
    -- 2) 잠금을 deadlock_timeout(1초) 넘게 기다리면 서버 로그에 누가 무엇을 기다리는지 남긴다 (원인 추적용)
    EXECUTE format('ALTER DATABASE %I SET log_lock_waits = on', current_database());
END
$$;

-- 확인
SELECT d.datname, s.setconfig
FROM pg_db_role_setting s JOIN pg_database d ON d.oid = s.setdatabase
WHERE d.datname = current_database() AND s.setrole = 0;

-- 3) (권장, 서버 전체 · 재시작 필요) 메모리 설정. 서버 메모리에 맞춰 값을 정한 뒤 주석을 풀고 실행 → PostgreSQL 서비스 재시작.
--    기본 shared_buffers 128MB 는 대량 데이터에서 디스크 읽기가 많아 매출이익 · 원장 집계가 느려진다.
-- ALTER SYSTEM SET shared_buffers = '2GB';          -- 서버 메모리의 약 25% (예: 8GB 서버 → 2GB)
-- ALTER SYSTEM SET effective_cache_size = '6GB';    -- 서버 메모리의 약 75%
-- ALTER SYSTEM SET maintenance_work_mem = '256MB';  -- 인덱스 생성 · VACUUM 속도
