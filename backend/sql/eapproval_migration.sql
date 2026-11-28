-- 전자결재 (2026-11-27) · 여러 번 실행해도 같은 결과
--  양식(휴가신청서 · 출장신청서 · 업무보고서) → 양식별 기본 결재선(고정) → 신청 → 단계별 승인 → 완료 / 반려 / 회수
--  기존 매입 · 매출 · 재고 · 통제 로직과 무관한 새 테이블만 쓴다.
--  칼럼 규칙: companyid · companyname 맨 앞, 감사 칼럼(createdat · updatedat · created_by · updated_by) 맨 끝 (통제관리 테이블과 같은 형식)
BEGIN;

-- 양식: 회사별 사용 여부 · 순서 (양식 내용 칸은 화면 · 서버 코드가 정함)
CREATE TABLE IF NOT EXISTS eappr_form01t (
    companyid    varchar(20)  NOT NULL,
    companyname  varchar(100),
    formcode     varchar(20)  NOT NULL,              -- LEAVE 휴가신청서 · TRIP 출장신청서 · REPORT 업무보고서
    formname     varchar(100) NOT NULL,
    useyn        varchar(1)   NOT NULL DEFAULT 'Y' CHECK (useyn IN ('Y', 'N')),
    sort_order   integer      NOT NULL DEFAULT 0,
    createdat    timestamptz  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedat    timestamptz,
    created_by   varchar(100),
    updated_by   varchar(100),
    PRIMARY KEY (companyid, formcode)
);

-- 양식별 기본 결재선 (고정): 1차 · 2차 … 결재자
CREATE TABLE IF NOT EXISTS eappr_line01t (
    companyid    varchar(20)  NOT NULL,
    companyname  varchar(100),
    formcode     varchar(20)  NOT NULL,
    step         smallint     NOT NULL CHECK (step >= 1),
    approver     varchar(100) NOT NULL,              -- 결재자 이메일 (user01t.email)
    createdat    timestamptz  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedat    timestamptz,
    created_by   varchar(100),
    updated_by   varchar(100),
    PRIMARY KEY (companyid, formcode, step)
);

-- 결재 문서: 신청자 = created_by, 양식 내용은 content(jsonb)
CREATE TABLE IF NOT EXISTS eappr_doc01t (
    companyid     varchar(20)  NOT NULL,
    companyname   varchar(100),
    docno         varchar(30)  NOT NULL,             -- EA-년도(KST)-00001 (회사 · 년도별 일련번호)
    formcode      varchar(20)  NOT NULL,
    title         varchar(200) NOT NULL DEFAULT '',
    status        varchar(12)  NOT NULL DEFAULT 'DRAFT'
                  CHECK (status IN ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED')),
    content       jsonb        NOT NULL DEFAULT '{}'::jsonb,
    current_step  smallint,                          -- 지금 결재할 단계 (대기 중일 때)
    submitted_at  timestamptz,
    completed_at  timestamptz,
    createdat     timestamptz  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedat     timestamptz,
    created_by    varchar(100),                      -- 신청자
    updated_by    varchar(100),
    PRIMARY KEY (companyid, docno)
);
CREATE INDEX IF NOT EXISTS eappr_doc01t_writer_idx ON eappr_doc01t (companyid, created_by, createdat DESC);
CREATE INDEX IF NOT EXISTS eappr_doc01t_status_idx ON eappr_doc01t (companyid, status, formcode);
CREATE INDEX IF NOT EXISTS eappr_doc01t_created_idx ON eappr_doc01t (companyid, createdat DESC);   -- 문서번호 발급 (올해 것만)

-- 문서별 결재선 기록: 신청할 때 기본 결재선을 복사, 단계마다 승인 · 반려 · 일시 · 의견
CREATE TABLE IF NOT EXISTS eappr_step01t (
    companyid    varchar(20)  NOT NULL,
    companyname  varchar(100),
    docno        varchar(30)  NOT NULL,
    step         smallint     NOT NULL,
    approver     varchar(100) NOT NULL,
    status       varchar(10)  NOT NULL DEFAULT 'WAIT' CHECK (status IN ('WAIT', 'APPROVED', 'REJECTED')),
    acted_at     timestamptz,
    comment      varchar(500),
    createdat    timestamptz  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedat    timestamptz,
    created_by   varchar(100),
    updated_by   varchar(100),
    PRIMARY KEY (companyid, docno, step)
);
CREATE INDEX IF NOT EXISTS eappr_step01t_approver_idx ON eappr_step01t (companyid, approver, status);

-- 연차 발생 일수: 관리자가 직원별 · 연도별로 직접 입력 (사용 · 결재중 · 잔여는 휴가 문서로 계산)
CREATE TABLE IF NOT EXISTS eappr_leave01t (
    companyid     varchar(20)   NOT NULL,
    companyname   varchar(100),
    useremail     varchar(100)  NOT NULL,
    leaveyear     smallint      NOT NULL,
    granted_days  numeric(5, 1) NOT NULL DEFAULT 0 CHECK (granted_days >= 0),
    createdat     timestamptz   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedat     timestamptz,
    created_by    varchar(100),
    updated_by    varchar(100),
    PRIMARY KEY (companyid, useremail, leaveyear)
);

-- 반차 · 반반차 시간대: 회사별 (행이 없으면 기본값 오전반차 09:00~14:00 · 오후반차 14:00~18:00 · 반반차 2시간 4개)
CREATE TABLE IF NOT EXISTS eappr_leavetime01t (
    companyid    varchar(20)  NOT NULL,
    companyname  varchar(100),
    kind         varchar(20)  NOT NULL CHECK (kind IN ('HALF_AM', 'HALF_PM', 'QUARTER')),
    slotno       smallint     NOT NULL CHECK (slotno >= 1),
    time_from    varchar(5)   NOT NULL,              -- HH:MM
    time_to      varchar(5)   NOT NULL,
    createdat    timestamptz  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedat    timestamptz,
    created_by   varchar(100),
    updated_by   varchar(100),
    PRIMARY KEY (companyid, kind, slotno)
);

-- 메뉴: 전자결재(모든 직원) · 결재양식관리(관리자) — 모든 회사에서 메뉴권한으로 부여
INSERT INTO menucatalog01t (menuid, menuname, access_scope, assignable, sort_order, useyn) VALUES
    ('EAPPROVAL',      '전자결재',     'COMPANY', TRUE, 37, 'Y'),
    ('EAPPROVAL_FORM', '결재양식관리', 'COMPANY', TRUE, 38, 'Y')
ON CONFLICT (menuid) DO NOTHING;
-- 휴가현황: 권한은 전자결재(EAPPROVAL)를 그대로 쓰므로 부여 대상 아님(assignable = FALSE). 즐겨찾기 저장용으로만 메뉴 목록에 둔다.
INSERT INTO menucatalog01t (menuid, menuname, access_scope, assignable, sort_order, useyn) VALUES
    ('EAPPROVAL_LEAVE', '휴가현황', 'COMPANY', FALSE, 39, 'Y')
ON CONFLICT (menuid) DO NOTHING;

-- 처음 한 번: 사용 중인 직원 전원에게 전자결재, 메뉴권한관리 권한이 있는 직원에게 결재양식관리
INSERT INTO usermenupermission01t (companyid, useremail, menuid, useyn, createdby)
SELECT u.companyid, u.email, 'EAPPROVAL', 'Y', 'eapproval-migration-20261127'
  FROM user01t u
 WHERE UPPER(COALESCE(u.useyn, 'N')) = 'Y'
ON CONFLICT (companyid, useremail, menuid) DO NOTHING;
INSERT INTO usermenupermission01t (companyid, useremail, menuid, useyn, createdby)
SELECT p.companyid, p.useremail, 'EAPPROVAL_FORM', 'Y', 'eapproval-migration-20261127'
  FROM usermenupermission01t p
 WHERE p.menuid = 'USER_MENU_PERMISSION' AND UPPER(COALESCE(p.useyn, 'N')) = 'Y'
ON CONFLICT (companyid, useremail, menuid) DO NOTHING;

COMMIT;
