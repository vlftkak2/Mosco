-- 승인 통제 (2026-11-24) · 여러 번 실행해도 같은 결과
--  담당자가 등록 · 수정 · 삭제하면 바로 반영하지 않고 승인요청으로 보관 → 승인자가 승인해야 기존 저장 로직으로 반영.
--  1차 대상: 거래처(CUSTOMER) · 매입(INBOUND) · 매출(OUTBOUND) · 수금/지급(RECEIPT_PAYMENT), 대상 · 동작별로 켜고 끈다.
--  매출 요청에 들어간 재고는 stock_reservation01t 로 예약 → 재고 선택 창에서 다른 사람이 못 고른다.
--  company01t.approval_yn : 고객사에 통제 기능 허용 (플랫폼 운영사가 고객사등록에서 설정)
--  등록 · 수정 칸(createdat, updatedat, created_by, updated_by)은 테이블 맨 오른쪽, 시각은 timestamptz (화면은 KST).
BEGIN;

ALTER TABLE company01t ADD COLUMN IF NOT EXISTS approval_yn char(1) NOT NULL DEFAULT 'N';
ALTER TABLE company01t DROP CONSTRAINT IF EXISTS company01t_approval_yn_check;
ALTER TABLE company01t ADD CONSTRAINT company01t_approval_yn_check CHECK (approval_yn IN ('Y', 'N'));

-- company01t 등록 · 수정 칸을 맨 오른쪽으로
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

-- 통제 설정: 고객사 × 대상별로 등록 · 수정 · 삭제를 승인받을지
CREATE TABLE IF NOT EXISTS control_policy01t (
    companyid   varchar(20) NOT NULL,
    target      varchar(30) NOT NULL,          -- CUSTOMER · INBOUND · OUTBOUND · RECEIPT_PAYMENT
    on_create   char(1) NOT NULL DEFAULT 'N' CHECK (on_create IN ('Y', 'N')),
    on_update   char(1) NOT NULL DEFAULT 'N' CHECK (on_update IN ('Y', 'N')),
    on_delete   char(1) NOT NULL DEFAULT 'N' CHECK (on_delete IN ('Y', 'N')),
    createdat   timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedat   timestamptz,
    created_by  varchar(100),
    updated_by  varchar(100),
    PRIMARY KEY (companyid, target)
);

-- 고객사 공통 옵션: 본인 승인 허용 (승인자가 1명일 때만 효력)
CREATE TABLE IF NOT EXISTS control_option01t (
    companyid        varchar(20) PRIMARY KEY,
    self_approve_yn  char(1) NOT NULL DEFAULT 'N' CHECK (self_approve_yn IN ('Y', 'N')),
    createdat        timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedat        timestamptz,
    created_by       varchar(100),
    updated_by       varchar(100)
);

-- 승인자 (고객사 관리자가 지정, 본인도 지정 가능)
CREATE TABLE IF NOT EXISTS control_approver01t (
    companyid   varchar(20) NOT NULL,
    useremail   varchar(100) NOT NULL,
    createdat   timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedat   timestamptz,
    created_by  varchar(100),
    updated_by  varchar(100),
    PRIMARY KEY (companyid, useremail)
);

-- 승인요청 한 건: 입력 내용(payload)을 그대로 보관했다가 승인 때 기존 저장 로직에 넘긴다
CREATE TABLE IF NOT EXISTS approval_request01t (
    companyid      varchar(20) NOT NULL,
    requestno      varchar(30) NOT NULL,       -- APR-YYYYMMDD-0001 (KST)
    target         varchar(30) NOT NULL,
    action         varchar(10) NOT NULL CHECK (action IN ('CREATE', 'UPDATE', 'DELETE')),
    op             varchar(30) NOT NULL,       -- 실행할 저장 동작 (save · manager · sales_fields · delete · bulk_create …)
    ref_no         varchar(100),               -- 수정 · 삭제 대상 전표번호 / 거래처코드
    summary        varchar(500) NOT NULL DEFAULT '',
    payload        jsonb NOT NULL,
    status         varchar(12) NOT NULL DEFAULT 'PENDING'
                   CHECK (status IN ('PENDING', 'PROCESSING', 'APPROVED', 'REJECTED', 'CANCELED')),
    decided_by     varchar(100),
    decided_at     timestamptz,
    reject_reason  varchar(500),
    result_no      varchar(100),               -- 승인으로 생긴 전표번호 / 거래처코드
    self_approved  char(1) NOT NULL DEFAULT 'N' CHECK (self_approved IN ('Y', 'N')),
    createdat      timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,   -- 요청 시각
    updatedat      timestamptz,
    created_by     varchar(100),                                     -- 요청자
    updated_by     varchar(100),
    PRIMARY KEY (companyid, requestno)
);
CREATE INDEX IF NOT EXISTS approval_request01t_status_idx ON approval_request01t (companyid, status, createdat DESC);
CREATE INDEX IF NOT EXISTS approval_request01t_requester_idx ON approval_request01t (companyid, created_by, createdat DESC);

-- 매출 요청에 들어간 재고 예약 (요청이 대기 · 처리 중일 때만 유효, 승인 · 반려 · 취소되면 지운다)
CREATE TABLE IF NOT EXISTS stock_reservation01t (
    companyid   varchar(20) NOT NULL,
    requestno   varchar(30) NOT NULL,
    sourcetype  varchar(20) NOT NULL,
    sourceno    varchar(100) NOT NULL,
    sourceline  integer NOT NULL,
    qty         numeric(15, 3) NOT NULL DEFAULT 0,
    weight      numeric(15, 3) NOT NULL DEFAULT 0,
    createdat   timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedat   timestamptz,
    created_by  varchar(100),
    updated_by  varchar(100),
    PRIMARY KEY (companyid, requestno, sourcetype, sourceno, sourceline)
);
CREATE INDEX IF NOT EXISTS stock_reservation01t_source_idx ON stock_reservation01t (companyid, sourcetype, sourceno, sourceline);

-- 통제 이력 (지우지 않음): 요청 · 승인 · 반려 · 취소 · 승인 실패 · 설정 변경 · 승인자 지정
CREATE TABLE IF NOT EXISTS control_history01t (
    id          bigserial PRIMARY KEY,
    companyid   varchar(20) NOT NULL,
    requestno   varchar(30),
    event       varchar(30) NOT NULL,
    detail      varchar(1000) NOT NULL DEFAULT '',
    createdat   timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedat   timestamptz,
    created_by  varchar(100),
    updated_by  varchar(100)
);
CREATE INDEX IF NOT EXISTS control_history01t_company_idx ON control_history01t (companyid, createdat DESC);

COMMIT;
