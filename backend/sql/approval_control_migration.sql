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
-- 목록 기간 조회 · 요청번호 발급 (올해 것만) / 알림: 내 요청 최근 처리 순
CREATE INDEX IF NOT EXISTS approval_request01t_created_idx ON approval_request01t (companyid, createdat DESC);
CREATE INDEX IF NOT EXISTS approval_request01t_recent_idx ON approval_request01t (companyid, created_by, (COALESCE(decided_at, createdat)) DESC);

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

-- 2026-11-27 ── 요청번호 양식: 회사명-년도-00001 (회사명이 길 수 있어 칸을 넓힌다)
ALTER TABLE approval_request01t ALTER COLUMN requestno TYPE varchar(150);
COMMENT ON COLUMN approval_request01t.requestno IS '요청번호: 회사명-년도(KST)-00001, 회사 · 년도별 일련번호';
-- 예전 번호(APR-YYYYMMDD-0001)는 새 양식으로 바꾼다 (요청 순서대로, 같은 회사 · 년도의 새 번호 뒤에 이어서)
WITH old AS (
    SELECT q.companyid, q.requestno,
           REGEXP_REPLACE(COALESCE(c.companyname, q.companyid), '\s', '', 'g') || '-'
             || TO_CHAR(q.createdat AT TIME ZONE 'Asia/Seoul', 'YYYY') || '-' AS prefix,
           q.createdat
    FROM approval_request01t q
    LEFT JOIN company01t c ON c.companyid = q.companyid
    WHERE q.requestno ~ '^APR-[0-9]{8}-[0-9]+$'
), numbered AS (
    SELECT o.companyid, o.requestno,
           o.prefix || LPAD((COALESCE((SELECT MAX(CAST(SUBSTRING(n.requestno FROM LENGTH(o.prefix) + 1) AS integer))
                                       FROM approval_request01t n
                                       WHERE n.companyid = o.companyid AND LEFT(n.requestno, LENGTH(o.prefix)) = o.prefix
                                         AND SUBSTRING(n.requestno FROM LENGTH(o.prefix) + 1) ~ '^[0-9]+$'), 0)
                             + ROW_NUMBER() OVER (PARTITION BY o.companyid, o.prefix ORDER BY o.createdat, o.requestno))::text, 5, '0') AS newno
    FROM old o
)
UPDATE approval_request01t q SET requestno = numbered.newno
FROM numbered WHERE q.companyid = numbered.companyid AND q.requestno = numbered.requestno;

-- 대기 중인 요청이 걸린 전표 · 거래처 찾기 (다른 수정 · 삭제를 막는 데 씀)
CREATE INDEX IF NOT EXISTS approval_request01t_pending_ref_idx
    ON approval_request01t (companyid, target, ref_no) WHERE status IN ('PENDING', 'PROCESSING') AND ref_no IS NOT NULL;

-- 예약 재고 보호: 어떤 화면 · 스크립트에서든 재고(currentstock01t)를 줄이거나 지운 결과가
-- 대기 중인 매출 승인요청의 예약 수량보다 적어지면 저장(커밋)을 막는다.
-- 승인 실행 중인 요청 자신의 예약은 빼고 본다 (실행 트랜잭션이 mosco.approval_request 에 요청번호를 넣는다).
CREATE OR REPLACE FUNCTION fn_check_stock_reservation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    k        record;
    rsv      record;
    stock    record;
    running  text := NULLIF(current_setting('mosco.approval_request', true), '');
BEGIN
    IF TG_OP = 'DELETE' THEN k := OLD; ELSE k := NEW; END IF;
    SELECT COALESCE(SUM(r.qty), 0) AS qty, COALESCE(SUM(r.weight), 0) AS weight,
           STRING_AGG(DISTINCT q.requestno, ', ') AS requests
      INTO rsv
      FROM approval_request01t q
      CROSS JOIN LATERAL jsonb_to_recordset(q.reservations)
           AS r(sourcetype varchar, sourceno varchar, sourceline integer, qty numeric, weight numeric)
     WHERE q.companyid = k.companyid AND q.status IN ('PENDING', 'PROCESSING')
       AND q.requestno IS DISTINCT FROM running
       AND r.sourcetype = k.sourcetype AND r.sourceno = k.sourceno AND r.sourceline = k.sourceline;
    IF rsv.requests IS NULL THEN
        RETURN NULL;
    END IF;
    SELECT COALESCE(SUM(s.qty), 0) AS qty, COALESCE(SUM(s.weight), 0) AS weight
      INTO stock
      FROM currentstock01t s
     WHERE s.companyid = k.companyid AND s.sourcetype = k.sourcetype AND s.sourceno = k.sourceno AND s.sourceline = k.sourceline;
    IF stock.weight + 0.0005 < rsv.weight OR (rsv.qty > 0 AND stock.qty + 0.0005 < rsv.qty) THEN
        RAISE EXCEPTION 'MOSCO:재고 % / 순번 %은(는) 승인 대기 중인 요청(%)에 예약되어 있어 줄이거나 지울 수 없습니다. 요청이 승인 · 반려 · 취소된 뒤 다시 저장해 주세요.',
            k.sourceno, k.sourceline, rsv.requests USING ERRCODE = 'P0001';
    END IF;
    RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_currentstock_reservation ON currentstock01t;
CREATE CONSTRAINT TRIGGER trg_currentstock_reservation
    AFTER UPDATE OF qty, weight OR DELETE ON currentstock01t
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION fn_check_stock_reservation();

COMMIT;
