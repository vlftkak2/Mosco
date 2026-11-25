-- 승인 통제 (2026-11-25 정리판) · 여러 번 실행해도 같은 결과
--  담당자가 등록 · 수정 · 삭제하면 바로 반영하지 않고 승인요청으로 보관 → 승인자가 승인해야 기존 저장 로직으로 반영.
--  대상: 거래처(CUSTOMER) · 매입(INBOUND) · 매출(OUTBOUND) · 수금/지급(RECEIPT_PAYMENT), 대상 · 동작별로 켜고 끈다.
--  메뉴권한 '통제관리'(CONTROL_MANAGEMENT) = 통제관리 화면에 들어와 설정을 바꾸는 권한.
--  승인 · 반려는 통제 설정에서 체크한 승인자(control_approver01t)만 (본인 요청도 승인 가능).
--  테이블 3개:
--    control_policy01t   : 무엇을 승인받을지 (고객사 × 대상, 등록 · 수정 · 삭제별 켜기 + 금액 조건)
--    control_approver01t : 승인자 (고객사 × 직원)
--    approval_request01t : 승인요청 한 건 — 입력 내용 · 예약 재고 · 요청자 · 처리자 · 결과를 한 줄에
--  등록 · 수정 칸(createdat, updatedat, created_by, updated_by)은 테이블 맨 오른쪽, 시각은 timestamptz (화면은 KST).
BEGIN;

CREATE TABLE IF NOT EXISTS control_policy01t (
    companyid   varchar(20) NOT NULL,
    companyname varchar(100),
    target      varchar(30) NOT NULL,          -- CUSTOMER · INBOUND · OUTBOUND · RECEIPT_PAYMENT
    -- 동작별: 켜면 그 동작은 승인 대상. 금액 조건을 넣으면 '켜짐 AND 금액(공급가 · 수금지급액) 이상'일 때만 (비우면 금액 무관)
    on_create   char(1) NOT NULL DEFAULT 'N' CHECK (on_create IN ('Y', 'N')),
    create_min  numeric(15, 0),
    on_update   char(1) NOT NULL DEFAULT 'N' CHECK (on_update IN ('Y', 'N')),
    update_min  numeric(15, 0),
    on_delete   char(1) NOT NULL DEFAULT 'N' CHECK (on_delete IN ('Y', 'N')),
    delete_min  numeric(15, 0),
    createdat   timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedat   timestamptz,
    created_by  varchar(100),
    updated_by  varchar(100),
    PRIMARY KEY (companyid, target)
);

CREATE TABLE IF NOT EXISTS control_approver01t (
    companyid   varchar(20) NOT NULL,
    companyname varchar(100),
    useremail   varchar(100) NOT NULL,
    createdat   timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedat   timestamptz,
    created_by  varchar(100),
    updated_by  varchar(100),
    PRIMARY KEY (companyid, useremail)
);

CREATE TABLE IF NOT EXISTS approval_request01t (
    companyid      varchar(20) NOT NULL,
    companyname    varchar(100),
    requestno      varchar(30) NOT NULL,       -- APR-YYYYMMDD-0001 (KST)
    target         varchar(30) NOT NULL,       -- CUSTOMER · INBOUND · OUTBOUND · RECEIPT_PAYMENT
    action         varchar(10) NOT NULL CHECK (action IN ('CREATE', 'UPDATE', 'DELETE')),
    op             varchar(30) NOT NULL,       -- 실행할 저장 동작 (save · manager · sales_fields · delete · create · bulk_create · update)
    ref_no         varchar(100),               -- 수정 · 삭제 대상 전표번호 / 거래처코드
    summary        varchar(500) NOT NULL DEFAULT '',
    amount         numeric(15, 0),             -- 요청 금액 (매입 · 매출 공급가 합계, 수금/지급액)
    payload        jsonb NOT NULL,             -- 담당자가 입력한 내용 그대로 (승인 때 기존 저장 로직에 넘김)
    reservations   jsonb NOT NULL DEFAULT '[]', -- 매출 요청의 예약 재고 [{sourcetype, sourceno, sourceline, qty, weight}] (대기 중일 때만 유효)
    status         varchar(12) NOT NULL DEFAULT 'PENDING'
                   CHECK (status IN ('PENDING', 'PROCESSING', 'APPROVED', 'REJECTED', 'CANCELED')),
    decided_by     varchar(100),               -- 승인 · 반려한 사람 (취소면 요청자)
    decided_at     timestamptz,
    reject_reason  varchar(500),
    last_error     varchar(500),               -- 마지막 승인 실패 사유 (월마감 · 재고 부족 등)
    result_no      varchar(100),               -- 승인으로 생긴 전표번호 / 거래처코드
    createdat      timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,   -- 요청 시각
    updatedat      timestamptz,
    created_by     varchar(100),                                     -- 요청자
    updated_by     varchar(100),
    PRIMARY KEY (companyid, requestno)
);
CREATE INDEX IF NOT EXISTS approval_request01t_status_idx ON approval_request01t (companyid, status, createdat DESC);
CREATE INDEX IF NOT EXISTS approval_request01t_requester_idx ON approval_request01t (companyid, created_by, createdat DESC);

-- 메뉴 카탈로그: 통제관리 (고객사에 부여 가능 · 이 권한이 있으면 통제 설정 + 승인)
INSERT INTO menucatalog01t (menuid, menuname, access_scope, assignable, sort_order, useyn)
VALUES ('CONTROL_MANAGEMENT', '통제관리', 'COMPANY', TRUE, 36, 'Y')
ON CONFLICT (menuid) DO NOTHING;

-- 1차 설계에서 만들었다가 뺀 것 (개발 DB 정리용, 없으면 아무 일 없음)
DROP TABLE IF EXISTS control_option01t;
DROP TABLE IF EXISTS stock_reservation01t;
DROP TABLE IF EXISTS control_history01t;
ALTER TABLE company01t DROP CONSTRAINT IF EXISTS company01t_approval_yn_check;
ALTER TABLE company01t DROP COLUMN IF EXISTS approval_yn;

COMMIT;
