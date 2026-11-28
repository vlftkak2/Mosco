-- 거래처 여신한도 (2026-11-27) · 여러 번 실행해도 같은 결과
--  creditlimit: 공급가 기준 여신한도 (비우거나 0 = 한도 없음 → 여신 통제 없이 통과)
--  감사 칼럼(createdat · updatedat · createdby · updatedby)은 테이블 맨 끝에 둔다 (회사 규칙).
--  PostgreSQL 은 칼럼 순서를 바꿀 수 없어서, 감사 칼럼을 새로 만들어 값을 옮기고 옛 칼럼을 지운 뒤 이름을 되돌린다.
BEGIN;

ALTER TABLE customer01t ADD COLUMN IF NOT EXISTS creditlimit numeric(15, 0);
COMMENT ON COLUMN customer01t.creditlimit IS '여신한도 (공급가 기준, 비움/0 = 한도 없음). 통제관리 › 여신 통제가 켜져 있으면 매출 등록 · 수정 때 미수 잔액 + 이번 매출이 한도를 넘으면 승인요청';

DO $$
DECLARE
    audit_first integer;
    data_last   integer;
BEGIN
    SELECT MIN(ordinal_position) INTO audit_first FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'customer01t' AND column_name IN ('createdat', 'updatedat', 'createdby', 'updatedby');
    SELECT MAX(ordinal_position) INTO data_last FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'customer01t' AND column_name NOT IN ('createdat', 'updatedat', 'createdby', 'updatedby');
    IF audit_first IS NOT NULL AND audit_first < data_last THEN
        ALTER TABLE customer01t
            ADD COLUMN createdat_new timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
            ADD COLUMN updatedat_new timestamp without time zone,
            ADD COLUMN createdby_new varchar(100),
            ADD COLUMN updatedby_new varchar(100);
        UPDATE customer01t SET createdat_new = createdat, updatedat_new = updatedat, createdby_new = createdby, updatedby_new = updatedby;
        ALTER TABLE customer01t DROP COLUMN createdat, DROP COLUMN updatedat, DROP COLUMN createdby, DROP COLUMN updatedby;
        ALTER TABLE customer01t RENAME COLUMN createdat_new TO createdat;
        ALTER TABLE customer01t RENAME COLUMN updatedat_new TO updatedat;
        ALTER TABLE customer01t RENAME COLUMN createdby_new TO createdby;
        ALTER TABLE customer01t RENAME COLUMN updatedby_new TO updatedby;
    END IF;
END $$;

COMMIT;
