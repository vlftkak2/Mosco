-- 고객사 라이선스 (2026-11-23) · 여러 번 실행해도 같은 결과
--  고객사등록 › 서비스 이용에서 입력하고, 라이선스 매출현황(어드민 · 001 MASTER 전용)이 월별로 집계한다.
--  company01t.licensed_seats                : 라이선스 개수 (= 허용 계정 수, 계정을 이 수만큼 만들 수 있음)
--  company01t.license_start / license_end   : 과금 기간 (시작일이 속한 달 ~ 종료일이 속한 달, 종료일이 비면 계속)
--  company_license01t.unit_price            : 라이선스 비용 (개당 · 월, 부가세 별도)
--  company_license_charge01t                : 월별 청구 (확정). 매달 1일 00:01(KST)에 서버가 전월분을 그때의 개수 × 비용으로 넣는다.
--                                             서버 시작 때 빠진 달을 채우고, 고객사 저장 직전에도 지난달까지 먼저 확정한다
--                                             → 고친 개수 · 비용은 이번 달부터만 반영 (services/masterdata/LicenseCharge.py)
--  등록 · 수정 칸(createdat, updatedat, created_by, updated_by)은 테이블 맨 오른쪽에 둔다.
BEGIN;

ALTER TABLE company01t ADD COLUMN IF NOT EXISTS license_start date;
ALTER TABLE company01t ADD COLUMN IF NOT EXISTS license_end date;
ALTER TABLE company01t DROP CONSTRAINT IF EXISTS company01t_license_period_check;
ALTER TABLE company01t ADD CONSTRAINT company01t_license_period_check
    CHECK (license_end IS NULL OR license_start IS NULL OR license_end >= license_start);

CREATE TABLE IF NOT EXISTS company_license01t (
    companyid  varchar(50)   NOT NULL PRIMARY KEY REFERENCES company01t (companyid) ON DELETE CASCADE,
    unit_price numeric(15,0) NOT NULL DEFAULT 0,     -- 라이선스 비용 (개당 · 월, 원, 부가세 별도)
    createdat  timestamptz   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedat  timestamptz,
    created_by varchar(100),
    updated_by varchar(100),
    CONSTRAINT company_license01t_price_check CHECK (unit_price >= 0)
);
-- (개발 중 잠시 있던 수량 칸 정리: 개수는 company01t.licensed_seats 로 통일)
ALTER TABLE company_license01t DROP CONSTRAINT IF EXISTS company_license01t_value_check;
ALTER TABLE company_license01t DROP COLUMN IF EXISTS quantity;
ALTER TABLE company_license01t DROP CONSTRAINT IF EXISTS company_license01t_price_check;
ALTER TABLE company_license01t ADD CONSTRAINT company_license01t_price_check CHECK (unit_price >= 0);

CREATE TABLE IF NOT EXISTS company_license_charge01t (
    companyid    varchar(50)   NOT NULL REFERENCES company01t (companyid) ON DELETE CASCADE,
    charge_month date          NOT NULL,              -- 청구월 (그 달 1일)
    quantity     integer       NOT NULL,              -- 그 달 라이선스 개수
    unit_price   numeric(15,0) NOT NULL,              -- 그 달 라이선스 비용 (개당, 원, 부가세 별도)
    amount       numeric(15,0) NOT NULL,              -- 청구 금액 = 개수 × 비용
    createdat    timestamptz   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedat    timestamptz,
    created_by   varchar(100),
    updated_by   varchar(100),
    PRIMARY KEY (companyid, charge_month),
    CONSTRAINT company_license_charge01t_month_check CHECK (charge_month = date_trunc('month', charge_month)::date),
    CONSTRAINT company_license_charge01t_value_check CHECK (quantity >= 0 AND unit_price >= 0 AND amount >= 0)
);

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

-- 메뉴 카탈로그: 플랫폼 전용 (고객사에 부여할 수 없음)
INSERT INTO menucatalog01t (menuid, menuname, access_scope, assignable, sort_order, useyn)
VALUES ('LICENSE_REVENUE', '라이선스 매출현황', 'PLATFORM', FALSE, 34, 'Y')
ON CONFLICT (menuid) DO NOTHING;

COMMIT;
