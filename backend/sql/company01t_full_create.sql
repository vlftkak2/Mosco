-- =====================================================================
-- company01t (고객사 · 사업장) 전체 다시 만들기
--   회사 1개 = 사업장 1개. 고객사등록(어드민) · 사업장관리(각 회사) 화면이 쓴다.
--
-- ※ 주의
--   이 파일 하나를 통째로 실행하면 아래 순서가 한 트랜잭션으로 진행됩니다 (중간에 실패하면 전부 되돌림).
--     0) 백업 테이블 company01t_backup 만들기 (지금 데이터 복사)
--     1) usermenupermission01t 외래키 끊기  (이 테이블을 참조하므로 그냥 DROP 하면 실패)
--     2) company01t 지우고 다시 만들기 + 주석
--     3) 백업에서 데이터 다시 넣기
--     4) 외래키 다시 걸기
--   끝나고 확인이 되면 백업 테이블은 지워도 됩니다:  DROP TABLE company01t_backup;
--   ※ company01t_backup 이 이미 있으면 0) 에서 멈춥니다 (예전 백업을 덮어쓰지 않도록).
--
-- 기존 대비 새로 생긴 칼럼 (사업장관리 '추가정보')
--   stampname       직인 파일 이름
--   logoname        회사 로고 파일 이름
--   bizcertimage    사업자등록증 이미지
--   bizcertmime     사업자등록증 이미지 형식
--   bizcertname     사업자등록증 파일 이름
--   + 제약 company01t_ownertype_check (사업자 유형 CORP / INDIV 만 허용 — 화면 · 서버 규칙과 같음)
--
-- 칼럼 순서: 기본 → 사업자 정보 → 연락처 · 주소 → 운영(요금제 · 이용상태 · 계정 수 · 시스템 시작일)
--            → 이미지(직인 · 로고 · 사업자등록증) → 등록 · 수정(맨 뒤)
-- =====================================================================

BEGIN;

-- 0) 백업 (같은 DB 안에 지금 데이터를 복사)
CREATE TABLE company01t_backup AS SELECT * FROM company01t;

-- 1) 참조하는 외래키를 잠시 끊는다
ALTER TABLE usermenupermission01t DROP CONSTRAINT IF EXISTS usermenupermission01t_companyid_fkey;

-- 2) 다시 만들기
DROP TABLE IF EXISTS company01t;

CREATE TABLE company01t (
    -- 기본
    companyid        VARCHAR(50)  NOT NULL,
    companyname      VARCHAR(100) NOT NULL,

    -- 사업자 정보
    ownertype        VARCHAR(10)  NOT NULL DEFAULT 'CORP',
    businessno       VARCHAR(20),
    corporationno    VARCHAR(20),
    ceoname          VARCHAR(100),
    businesstype     VARCHAR(100),
    industry         VARCHAR(100),
    openingdate      DATE,

    -- 연락처 · 주소
    phone            VARCHAR(30),
    zipcode          VARCHAR(10),
    address1         VARCHAR(300),
    address2         VARCHAR(300),

    -- 운영
    plan_code        VARCHAR(20)  NOT NULL DEFAULT 'BASIC',
    company_status   VARCHAR(20)  NOT NULL DEFAULT 'PENDING',
    licensed_seats   INTEGER      NOT NULL DEFAULT 0,
    ledgerstartdate  DATE,

    -- 이미지 (사업장관리 '추가정보')
    logoimage        BYTEA,
    logomime         VARCHAR(50),
    logoname         VARCHAR(255),
    stampimage       BYTEA,
    stampmime        VARCHAR(50),
    stampname        VARCHAR(255),
    bizcertimage     BYTEA,
    bizcertmime      VARCHAR(50),
    bizcertname      VARCHAR(255),

    -- 등록 · 수정
    createdat        TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedat        TIMESTAMPTZ,
    created_by       VARCHAR(100),
    updated_by       VARCHAR(100),

    CONSTRAINT company01t_pkey                 PRIMARY KEY (companyid),
    CONSTRAINT company01t_ownertype_check      CHECK (ownertype IN ('CORP', 'INDIV')),
    CONSTRAINT company01t_plan_code_check      CHECK (plan_code IN ('BASIC', 'EXTENDED')),
    CONSTRAINT company01t_company_status_check CHECK (company_status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSED')),
    CONSTRAINT company01t_licensed_seats_check CHECK (licensed_seats >= 0)
);

-- 2-1) 주석
COMMENT ON TABLE  company01t                 IS '고객사(회사 · 사업장) — 회사 1개 = 사업장 1개. 등록 · 요금제 · 이용상태는 어드민>고객사등록, 사업자 정보 · 이미지는 설정>사업장관리. 계정은 user01t (companyid 로 연결)';
COMMENT ON COLUMN company01t.companyid       IS '회사 코드 (PK) — 모든 업무 테이블의 회사 구분 키. 001 = 플랫폼 운영사(삭제 불가) [고객사등록, 등록 후 변경 불가]';
COMMENT ON COLUMN company01t.companyname     IS '회사명 — 거래명세서 공급자 상호 [고객사등록 입력 / 사업장관리 보기만]';
COMMENT ON COLUMN company01t.ownertype       IS '사업자 유형 CORP 법인사업자 / INDIV 개인사업자 [사업장관리]';
COMMENT ON COLUMN company01t.businessno      IS '사업자등록번호 000-00-00000 (검증번호 확인, 중복 불가) — 거래명세서 공급자 [고객사등록 · 사업장관리]';
COMMENT ON COLUMN company01t.corporationno   IS '법인등록번호 000000-0000000 (법인사업자만) [사업장관리]';
COMMENT ON COLUMN company01t.ceoname         IS '대표자명 — 거래명세서 공급자 [고객사등록 · 사업장관리]';
COMMENT ON COLUMN company01t.businesstype    IS '업태 — 거래명세서 공급자 [사업장관리]';
COMMENT ON COLUMN company01t.industry        IS '종목 — 거래명세서 공급자 [사업장관리]';
COMMENT ON COLUMN company01t.openingdate     IS '개업년월일 [사업장관리]';
COMMENT ON COLUMN company01t.phone           IS '전화번호 — 거래명세서 공급자 연락처 [고객사등록 · 사업장관리]';
COMMENT ON COLUMN company01t.zipcode         IS '우편번호 (카카오 주소 검색) [고객사등록 · 사업장관리]';
COMMENT ON COLUMN company01t.address1        IS '주소 (도로명주소) — 거래명세서 공급자 [고객사등록 · 사업장관리]';
COMMENT ON COLUMN company01t.address2        IS '상세주소 (동 · 호수 · 건물명) — 거래명세서 공급자 주소 뒤에 붙음 [고객사등록 · 사업장관리]';
COMMENT ON COLUMN company01t.plan_code       IS '요금제 BASIC 기본형 / EXTENDED 확장형 [고객사등록, 플랫폼 관리자 전용]';
COMMENT ON COLUMN company01t.company_status  IS '이용상태 PENDING 승인대기 / ACTIVE 이용중 / SUSPENDED 이용정지 / CLOSED 종료 — ACTIVE 가 아니면 소속 계정 로그인 불가 · 계정 등록 불가 [고객사등록]';
COMMENT ON COLUMN company01t.licensed_seats  IS '허용 계정 수 — 사용중 계정 수가 이 값을 넘을 수 없음 (고객사관리 계정 등록 · 사용 전환 때 확인) [고객사등록]';
COMMENT ON COLUMN company01t.ledgerstartdate IS '시스템 시작일 (= 거래처원장 시작일) — 이 날짜 이전 거래는 전기이월(거래처 기초잔액)로 처리 [사업장관리 · 거래처원장]';
COMMENT ON COLUMN company01t.logoimage       IS '회사 로고 이미지 (JPG · PNG, 500KB 이하) [사업장관리]';
COMMENT ON COLUMN company01t.logomime        IS '회사 로고 이미지 형식 image/png, image/jpeg [사업장관리]';
COMMENT ON COLUMN company01t.logoname        IS '회사 로고 파일 이름 (화면 표시용) [사업장관리]';
COMMENT ON COLUMN company01t.stampimage      IS '직인 이미지 (JPG · PNG, 500KB 이하) — 증명서 · 출력물에 찍힘 [사업장관리]';
COMMENT ON COLUMN company01t.stampmime       IS '직인 이미지 형식 image/png, image/jpeg [사업장관리]';
COMMENT ON COLUMN company01t.stampname       IS '직인 파일 이름 (화면 표시용) [사업장관리]';
COMMENT ON COLUMN company01t.bizcertimage    IS '사업자등록증 이미지 (JPG · PNG, 2MB 이하) [사업장관리]';
COMMENT ON COLUMN company01t.bizcertmime     IS '사업자등록증 이미지 형식 image/png, image/jpeg [사업장관리]';
COMMENT ON COLUMN company01t.bizcertname     IS '사업자등록증 파일 이름 (화면 표시용) [사업장관리]';
COMMENT ON COLUMN company01t.createdat       IS '등록일시 (고객사등록 시각)';
COMMENT ON COLUMN company01t.updatedat       IS '수정일시 (고객사등록 · 사업장관리 저장 때 갱신, 수정 전엔 NULL)';
COMMENT ON COLUMN company01t.created_by      IS '등록자 (등록한 플랫폼 관리자 로그인 이메일)';
COMMENT ON COLUMN company01t.updated_by      IS '수정자 (마지막으로 저장한 사람 로그인 이메일)';

-- 3) 백업에서 데이터 다시 넣기 (칼럼 이름으로 맞춰 넣으므로 순서가 달라도 된다)
INSERT INTO company01t (
    companyid, companyname, ownertype, businessno, corporationno, ceoname, businesstype, industry, openingdate,
    phone, zipcode, address1, address2,
    plan_code, company_status, licensed_seats, ledgerstartdate,
    logoimage, logomime, logoname, stampimage, stampmime, stampname, bizcertimage, bizcertmime, bizcertname,
    createdat, updatedat, created_by, updated_by)
SELECT
    companyid, companyname, ownertype, businessno, corporationno, ceoname, businesstype, industry, openingdate,
    phone, zipcode, address1, address2,
    plan_code, company_status, licensed_seats, ledgerstartdate,
    logoimage, logomime, logoname, stampimage, stampmime, stampname, bizcertimage, bizcertmime, bizcertname,
    createdat, updatedat, created_by, updated_by
FROM company01t_backup;

-- 4) 외래키 다시 걸기
ALTER TABLE usermenupermission01t
    ADD CONSTRAINT usermenupermission01t_companyid_fkey
    FOREIGN KEY (companyid) REFERENCES company01t (companyid) ON DELETE RESTRICT;

COMMIT;
