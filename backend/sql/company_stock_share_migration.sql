-- 타사 재고 공개 (2026-11-24) · 여러 번 실행해도 같은 결과
--  서면 계약으로 재고 공개에 동의한 고객사만, 플랫폼 운영사(001 · 모스코) 계정이 '타사 재고현황'에서 본다.
--  company01t.stock_open_yn   : 재고 공개 동의 (Y / N, 고객사등록에서 001 MASTER 가 입력)
--  company01t.stock_open_date : 공개 동의일 (서면 계약일)
--  보여 주는 것: 회사명(company01t) · 품목 · 규격 · 수량 · 중량 · 입고일 / 빼는 것: 창고 · 단가 · 원가 · 매입처 · 전표번호
--  등록 · 수정 칸(createdat, updatedat, created_by, updated_by)은 테이블 맨 오른쪽에 둔다.
BEGIN;

ALTER TABLE company01t ADD COLUMN IF NOT EXISTS stock_open_yn char(1) NOT NULL DEFAULT 'N';
ALTER TABLE company01t ADD COLUMN IF NOT EXISTS stock_open_date date;
ALTER TABLE company01t DROP CONSTRAINT IF EXISTS company01t_stock_open_yn_check;
ALTER TABLE company01t ADD CONSTRAINT company01t_stock_open_yn_check CHECK (stock_open_yn IN ('Y', 'N'));

-- company01t 등록 · 수정 칸을 맨 오른쪽으로 (PostgreSQL 은 칸 순서를 못 바꾸므로 새로 만들어 값을 옮긴다)
DO $$
DECLARE
    first_audit integer;
    last_other integer;
BEGIN
    SELECT MIN(ordinal_position) INTO first_audit FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = 'company01t'
       AND column_name IN ('createdat', 'updatedat', 'created_by', 'updated_by');
    SELECT MAX(ordinal_position) INTO last_other FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = 'company01t'
       AND column_name NOT IN ('createdat', 'updatedat', 'created_by', 'updated_by');
    IF first_audit < last_other THEN
        ALTER TABLE company01t RENAME COLUMN createdat TO createdat_old;
        ALTER TABLE company01t RENAME COLUMN updatedat TO updatedat_old;
        ALTER TABLE company01t RENAME COLUMN created_by TO created_by_old;
        ALTER TABLE company01t RENAME COLUMN updated_by TO updated_by_old;
        ALTER TABLE company01t ADD COLUMN createdat timestamptz DEFAULT CURRENT_TIMESTAMP;
        ALTER TABLE company01t ADD COLUMN updatedat timestamptz;
        ALTER TABLE company01t ADD COLUMN created_by varchar(100);
        ALTER TABLE company01t ADD COLUMN updated_by varchar(100);
        UPDATE company01t SET createdat = createdat_old, updatedat = updatedat_old,
                              created_by = created_by_old, updated_by = updated_by_old;
        ALTER TABLE company01t ALTER COLUMN createdat SET NOT NULL;
        ALTER TABLE company01t DROP COLUMN createdat_old;
        ALTER TABLE company01t DROP COLUMN updatedat_old;
        ALTER TABLE company01t DROP COLUMN created_by_old;
        ALTER TABLE company01t DROP COLUMN updated_by_old;
    END IF;
END $$;

-- 월말 재고 추이 계산용 (수불을 회사 · 일자 순으로 읽는다)
CREATE INDEX IF NOT EXISTS iniop01t_company_date_idx ON iniop01t (companyid, iniodate);

-- 메뉴 카탈로그: 플랫폼 전용 (고객사에 부여할 수 없음 · 001 계정만)
INSERT INTO menucatalog01t (menuid, menuname, access_scope, assignable, sort_order, useyn)
VALUES ('SHARED_STOCK', '타사 재고현황', 'PLATFORM', FALSE, 35, 'Y')
ON CONFLICT (menuid) DO NOTHING;

COMMIT;
