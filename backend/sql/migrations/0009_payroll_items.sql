-- 급여 지급항목 추가 (2026-11-28) · 여러 번 실행해도 같은 결과 · 0008 다음
--  pay_duty     업무분담수당 (과세)
--  pay_research 연구수당     (월 20만원까지 비과세 — 기업부설연구소 연구원 등 비과세 대상자에게만 지급)
--  등록 · 수정 칸(createdat, updatedat, created_by, updated_by)은 테이블 맨 오른쪽에 둔다 → 새 칸을 넣은 뒤 감사 칸을 뒤로 옮긴다.
ALTER TABLE pay_slip01t ADD COLUMN IF NOT EXISTS pay_duty     bigint NOT NULL DEFAULT 0;
ALTER TABLE pay_slip01t ADD COLUMN IF NOT EXISTS pay_research bigint NOT NULL DEFAULT 0;

-- 감사 칸이 맨 끝이 아니면 뒤로 옮긴다 (이름 바꿈 → 새로 추가 → 값 복사 → 옛 칸 삭제)
DO $$
DECLARE
    audit_min integer;
    other_max integer;
BEGIN
    SELECT MIN(ordinal_position) INTO audit_min FROM information_schema.columns
     WHERE table_name = 'pay_slip01t' AND column_name IN ('createdat', 'updatedat', 'created_by', 'updated_by');
    SELECT MAX(ordinal_position) INTO other_max FROM information_schema.columns
     WHERE table_name = 'pay_slip01t' AND column_name NOT IN ('createdat', 'updatedat', 'created_by', 'updated_by');
    IF audit_min < other_max THEN
        ALTER TABLE pay_slip01t RENAME COLUMN createdat TO createdat_old;
        ALTER TABLE pay_slip01t RENAME COLUMN updatedat TO updatedat_old;
        ALTER TABLE pay_slip01t RENAME COLUMN created_by TO created_by_old;
        ALTER TABLE pay_slip01t RENAME COLUMN updated_by TO updated_by_old;
        ALTER TABLE pay_slip01t ADD COLUMN createdat timestamptz DEFAULT CURRENT_TIMESTAMP;
        ALTER TABLE pay_slip01t ADD COLUMN updatedat timestamptz;
        ALTER TABLE pay_slip01t ADD COLUMN created_by varchar(100);
        ALTER TABLE pay_slip01t ADD COLUMN updated_by varchar(100);
        UPDATE pay_slip01t SET createdat = createdat_old, updatedat = updatedat_old,
                               created_by = created_by_old, updated_by = updated_by_old;
        ALTER TABLE pay_slip01t ALTER COLUMN createdat SET NOT NULL;
        ALTER TABLE pay_slip01t DROP COLUMN createdat_old;
        ALTER TABLE pay_slip01t DROP COLUMN updatedat_old;
        ALTER TABLE pay_slip01t DROP COLUMN created_by_old;
        ALTER TABLE pay_slip01t DROP COLUMN updated_by_old;
    END IF;
END $$;
