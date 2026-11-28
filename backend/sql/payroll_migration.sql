-- 급여관리 (2026-11-28) · 여러 번 실행해도 같은 결과
--  테이블은 pay_slip01t 하나: 한 행 = 회사 × 귀속월 × 직원 (그달 급여 · 상여를 한 장에)
--   - 직원별 급여 기준은 따로 두지 않는다. 새 달은 '전월 불러오기'로 지난달 행을 복사해 시작한다.
--   - 지급 · 공제 항목은 칸으로 고정 (항목 설정 테이블 없음). 4대보험 요율 · 간이세액표는 서버 코드(services/payroll)에 있다.
--   - 합계(지급 · 공제 · 실지급)는 저장하지 않고 조회할 때 더한다.
--   - 부서 · 사원번호 · 입사일 · 생년월일은 user01t 에서 조인한다.
--   - 마감(closeyn = 'Y')한 달은 고칠 수 없고, 직원은 마감된 자기 급여만 '내 급여현황'에서 본다.
--  칼럼 규칙: companyid · companyname 맨 앞, 감사 칼럼(createdat · updatedat · created_by · updated_by) 맨 끝
BEGIN;

CREATE TABLE IF NOT EXISTS pay_slip01t (
    companyid      varchar(20)  NOT NULL,
    companyname    varchar(100),
    payym          varchar(7)   NOT NULL CHECK (payym ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),   -- 귀속년월 YYYY-MM
    useremail      varchar(100) NOT NULL,                                               -- 직원 (user01t.email)
    paydate        date         NOT NULL,                                               -- 지급일
    -- 계산 기준 (전월에서 복사)
    base_monthly   bigint       NOT NULL DEFAULT 0 CHECK (base_monthly >= 0),           -- 보수월액 (국민연금 · 건강보험 기준)
    family_cnt     smallint     NOT NULL DEFAULT 1 CHECK (family_cnt BETWEEN 1 AND 20), -- 공제대상가족 수 (본인 포함)
    child_cnt      smallint     NOT NULL DEFAULT 0 CHECK (child_cnt BETWEEN 0 AND 20),  -- 8세 이상 20세 이하 자녀 수
    tax_rate       smallint     NOT NULL DEFAULT 100 CHECK (tax_rate IN (80, 100, 120)),-- 소득세 원천징수 비율(%)
    -- 지급항목
    pay_base       bigint       NOT NULL DEFAULT 0,   -- 기본급
    pay_position   bigint       NOT NULL DEFAULT 0,   -- 직책수당
    pay_duty       bigint       NOT NULL DEFAULT 0,   -- 업무분담수당
    pay_overtime   bigint       NOT NULL DEFAULT 0,   -- 연장근무수당
    pay_bonus      bigint       NOT NULL DEFAULT 0,   -- 상여
    pay_leave      bigint       NOT NULL DEFAULT 0,   -- 연차수당
    pay_etc        bigint       NOT NULL DEFAULT 0,   -- 기타지급 (과세)
    pay_meal       bigint       NOT NULL DEFAULT 0,   -- 식대 (월 20만원까지 비과세)
    pay_car        bigint       NOT NULL DEFAULT 0,   -- 자가운전보조금 (월 20만원까지 비과세)
    pay_childcare  bigint       NOT NULL DEFAULT 0,   -- 보육수당 (월 20만원까지 비과세)
    pay_research   bigint       NOT NULL DEFAULT 0,   -- 연구수당 (월 20만원까지 비과세, 연구원 등 대상자만)
    -- 공제항목 (자동 계산 후 고칠 수 있다)
    ded_pension    bigint       NOT NULL DEFAULT 0,   -- 국민연금
    ded_health     bigint       NOT NULL DEFAULT 0,   -- 건강보험
    ded_care       bigint       NOT NULL DEFAULT 0,   -- 장기요양보험
    ded_employ     bigint       NOT NULL DEFAULT 0,   -- 고용보험
    ded_income     bigint       NOT NULL DEFAULT 0,   -- 소득세
    ded_local      bigint       NOT NULL DEFAULT 0,   -- 지방소득세
    ded_etc        bigint       NOT NULL DEFAULT 0,   -- 기타공제 (가불금 등)
    -- 그 밖
    bankname       varchar(50)  NOT NULL DEFAULT '',
    accountno      varchar(50)  NOT NULL DEFAULT '',
    remark         varchar(200) NOT NULL DEFAULT '',  -- 적요 (명세서에 계산 방법 · 메모)
    closeyn        varchar(1)   NOT NULL DEFAULT 'N' CHECK (closeyn IN ('Y', 'N')),
    createdat      timestamptz  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedat      timestamptz,
    created_by     varchar(100),
    updated_by     varchar(100),
    PRIMARY KEY (companyid, payym, useremail)          -- 급여입력 · 급여대장: 회사 + 귀속월 조회
);
-- 내 급여현황: 회사 + 직원 + 최근 귀속월 순
CREATE INDEX IF NOT EXISTS pay_slip01t_user_idx ON pay_slip01t (companyid, useremail, payym DESC);

-- 메뉴: 급여관리(급여입력 · 급여대장, 관리자) · 내 급여현황(직원 본인)
--  급여대장(PAYROLL_LEDGER)은 급여관리(PAYROLL) 권한을 그대로 쓴다 → 부여 대상 아님 (즐겨찾기 저장용)
INSERT INTO menucatalog01t (menuid, menuname, access_scope, assignable, sort_order, useyn) VALUES
    ('PAYROLL',        '급여입력',    'COMPANY', TRUE,  40, 'Y'),
    ('PAYROLL_LEDGER', '급여대장',    'COMPANY', FALSE, 41, 'Y'),
    ('PAYROLL_MY',     '내 급여현황', 'COMPANY', TRUE,  42, 'Y')
ON CONFLICT (menuid) DO NOTHING;

-- 처음 한 번: 사용 중인 직원 전원에게 내 급여현황, 메뉴권한관리 권한이 있는 직원에게 급여입력
INSERT INTO usermenupermission01t (companyid, useremail, menuid, useyn, createdby)
SELECT u.companyid, u.email, 'PAYROLL_MY', 'Y', 'payroll-migration-20261128'
  FROM user01t u
 WHERE UPPER(COALESCE(u.useyn, 'N')) = 'Y'
ON CONFLICT (companyid, useremail, menuid) DO NOTHING;
INSERT INTO usermenupermission01t (companyid, useremail, menuid, useyn, createdby)
SELECT p.companyid, p.useremail, 'PAYROLL', 'Y', 'payroll-migration-20261128'
  FROM usermenupermission01t p
 WHERE p.menuid = 'USER_MENU_PERMISSION' AND UPPER(COALESCE(p.useyn, 'N')) = 'Y'
ON CONFLICT (companyid, useremail, menuid) DO NOTHING;

COMMIT;
