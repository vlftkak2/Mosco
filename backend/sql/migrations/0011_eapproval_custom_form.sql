-- 전자결재 추가 양식 (2026-11-29) · 여러 번 실행해도 같은 결과 · 전자결재 기본 테이블(eappr_form01t)이 있어야 한다
--  결재양식관리에서 [양식 추가]로 만든 양식 (formcode C001, C002 …). 새 테이블 없이 eappr_form01t 에 칸 2개만 더한다.
--   fields   : 입력칸 정의 [{key, label, type, required, options}] — type: text 글자 · textarea 긴글 · number 숫자 · money 금액 · date 날짜 · period 기간 · select 선택
--              기본 양식(LEAVE · TRIP · REPORT)은 빈 배열 (입력칸은 코드가 정한다)
--   template : HTML 서식 (모스코(001) 회사만 쓸 수 있다). 안의 {{입력칸 이름}} 자리에 입력칸이 들어간다. 비어 있으면 '라벨 | 입력' 자동 배치
--  입력 값은 eappr_doc01t.content 에 담고, 신청할 때 그 시점의 입력칸 · 서식을 문서에 함께 저장한다 (양식을 고쳐도 옛 문서는 그대로).
--  등록 · 수정 칸(createdat, updatedat, created_by, updated_by)은 테이블 맨 오른쪽에 둔다 → 새 칸을 넣은 뒤 감사 칸을 뒤로 옮긴다.
ALTER TABLE eappr_form01t ADD COLUMN IF NOT EXISTS fields   jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE eappr_form01t ADD COLUMN IF NOT EXISTS template text  NOT NULL DEFAULT '';

DO $$
DECLARE
    audit_min integer;
    other_max integer;
BEGIN
    SELECT MIN(ordinal_position) INTO audit_min FROM information_schema.columns
     WHERE table_name = 'eappr_form01t' AND column_name IN ('createdat', 'updatedat', 'created_by', 'updated_by');
    SELECT MAX(ordinal_position) INTO other_max FROM information_schema.columns
     WHERE table_name = 'eappr_form01t' AND column_name NOT IN ('createdat', 'updatedat', 'created_by', 'updated_by');
    IF audit_min < other_max THEN
        ALTER TABLE eappr_form01t RENAME COLUMN createdat TO createdat_old;
        ALTER TABLE eappr_form01t RENAME COLUMN updatedat TO updatedat_old;
        ALTER TABLE eappr_form01t RENAME COLUMN created_by TO created_by_old;
        ALTER TABLE eappr_form01t RENAME COLUMN updated_by TO updated_by_old;
        ALTER TABLE eappr_form01t ADD COLUMN createdat timestamptz DEFAULT CURRENT_TIMESTAMP;
        ALTER TABLE eappr_form01t ADD COLUMN updatedat timestamptz;
        ALTER TABLE eappr_form01t ADD COLUMN created_by varchar(100);
        ALTER TABLE eappr_form01t ADD COLUMN updated_by varchar(100);
        UPDATE eappr_form01t SET createdat = createdat_old, updatedat = updatedat_old,
                                 created_by = created_by_old, updated_by = updated_by_old;
        ALTER TABLE eappr_form01t ALTER COLUMN createdat SET NOT NULL;
        ALTER TABLE eappr_form01t DROP COLUMN createdat_old;
        ALTER TABLE eappr_form01t DROP COLUMN updatedat_old;
        ALTER TABLE eappr_form01t DROP COLUMN created_by_old;
        ALTER TABLE eappr_form01t DROP COLUMN updated_by_old;
    END IF;
END $$;
