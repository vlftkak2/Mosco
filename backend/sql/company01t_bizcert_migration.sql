-- =====================================================================
-- 사업장관리 '추가정보' 이미지: 사업자등록증 추가 + 파일 이름 보관
--   · 사업자등록증 이미지 (bizcertimage / bizcertmime / bizcertname)
--   · 직인 · 로고 파일 이름 (stampname / logoname) — 화면 카드 아래에 표시
--   · 등록 · 수정 칼럼(createdat · updatedat · created_by · updated_by)은 다시 맨 뒤로 옮긴다
-- 기존 데이터는 그대로 남는다 (한 트랜잭션).
-- =====================================================================

BEGIN;

ALTER TABLE company01t
    ADD COLUMN stampname    VARCHAR(255),
    ADD COLUMN logoname     VARCHAR(255),
    ADD COLUMN bizcertimage BYTEA,
    ADD COLUMN bizcertmime  VARCHAR(50),
    ADD COLUMN bizcertname  VARCHAR(255);

-- 등록 · 수정 칼럼을 맨 뒤로: 새로 만들고 → 값 복사 → 예전 칼럼 삭제 → 이름 되돌림
ALTER TABLE company01t
    ADD COLUMN createdat_new  TIMESTAMPTZ,
    ADD COLUMN updatedat_new  TIMESTAMPTZ,
    ADD COLUMN created_by_new VARCHAR(100),
    ADD COLUMN updated_by_new VARCHAR(100);
UPDATE company01t SET createdat_new = createdat, updatedat_new = updatedat, created_by_new = created_by, updated_by_new = updated_by;
ALTER TABLE company01t DROP COLUMN createdat, DROP COLUMN updatedat, DROP COLUMN created_by, DROP COLUMN updated_by;
ALTER TABLE company01t RENAME COLUMN createdat_new  TO createdat;
ALTER TABLE company01t RENAME COLUMN updatedat_new  TO updatedat;
ALTER TABLE company01t RENAME COLUMN created_by_new TO created_by;
ALTER TABLE company01t RENAME COLUMN updated_by_new TO updated_by;
ALTER TABLE company01t ALTER COLUMN createdat SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE company01t ALTER COLUMN createdat SET NOT NULL;

COMMENT ON COLUMN company01t.stampname    IS '직인 이미지 파일 이름 (화면 표시용)';
COMMENT ON COLUMN company01t.logoname     IS '회사 로고 이미지 파일 이름 (화면 표시용)';
COMMENT ON COLUMN company01t.bizcertimage IS '사업자등록증 이미지 (JPG · PNG, 2MB 이하)';
COMMENT ON COLUMN company01t.bizcertmime  IS '사업자등록증 이미지 형식 (image/png 등)';
COMMENT ON COLUMN company01t.bizcertname  IS '사업자등록증 파일 이름 (화면 표시용)';
COMMENT ON COLUMN company01t.createdat    IS '등록일시';
COMMENT ON COLUMN company01t.updatedat    IS '수정일시';
COMMENT ON COLUMN company01t.created_by   IS '등록자 (이메일)';
COMMENT ON COLUMN company01t.updated_by   IS '수정자 (이메일)';

COMMIT;
