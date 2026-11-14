-- =====================================================================
-- user01t 다시 만들기 — 쓰는 칼럼만 남기고 순서를 정리한다 (등록 · 수정 이력 4칸은 맨 오른쪽)
--
--   계정 (고객사관리)        : companyid, email, username, password, authority, useyn
--   인사 기본정보 (사용자관리): empno, worktype, team, position, birthdate, mobile, hiredate, retiredate, photoimage, photomime
--   이력                     : createdat, updatedat, created_by, updated_by
--
--   지우는 칼럼 (어디서도 읽지 않음):
--     companyname  — 회사명은 company01t 에서 가져온다 (로그인 · 권한 모두 company01t 조인)
--     startdate, enddate — 코드에서 쓰지 않음
--     nationality, foreignyn, residentyn, last_login_at — 사용자관리에서 빼기로 함
--
--   진행: 백업 테이블(user01t_backup)에 복사 → 메뉴권한 외래키 해제 → 새로 만들기 → 데이터 다시 넣기 → 인덱스 · 외래키 복구
--   확인 후 백업은 DROP TABLE user01t_backup; 으로 지운다.
-- =====================================================================
BEGIN;

-- 0) 아직 없는 칼럼이 있으면 먼저 만들어 둔다 (예전 DB 에서 실행해도 4) 의 복사가 깨지지 않게)
ALTER TABLE user01t ADD COLUMN IF NOT EXISTS empno      VARCHAR(20);
ALTER TABLE user01t ADD COLUMN IF NOT EXISTS worktype   VARCHAR(10);
ALTER TABLE user01t ADD COLUMN IF NOT EXISTS position   VARCHAR(30);
ALTER TABLE user01t ADD COLUMN IF NOT EXISTS birthdate  DATE;
ALTER TABLE user01t ADD COLUMN IF NOT EXISTS mobile     VARCHAR(20);
ALTER TABLE user01t ADD COLUMN IF NOT EXISTS hiredate   DATE;
ALTER TABLE user01t ADD COLUMN IF NOT EXISTS retiredate DATE;
ALTER TABLE user01t ADD COLUMN IF NOT EXISTS photoimage BYTEA;
ALTER TABLE user01t ADD COLUMN IF NOT EXISTS photomime  VARCHAR(50);
ALTER TABLE user01t ADD COLUMN IF NOT EXISTS created_by VARCHAR(100);
ALTER TABLE user01t ADD COLUMN IF NOT EXISTS updated_by VARCHAR(100);

-- 1) 백업
DROP TABLE IF EXISTS user01t_backup;
CREATE TABLE user01t_backup AS SELECT * FROM user01t;

-- 2) user01t 를 가리키는 외래키 해제 후 삭제
ALTER TABLE usermenupermission01t DROP CONSTRAINT IF EXISTS usermenupermission01t_companyid_useremail_fkey;
DROP TABLE user01t;

-- 3) 새로 만들기
CREATE TABLE user01t (
    companyid   VARCHAR(100) NOT NULL,
    email       VARCHAR(50)  NOT NULL,
    username    VARCHAR(20),
    password    VARCHAR(100),
    authority   VARCHAR(50),
    useyn       VARCHAR(50),
    empno       VARCHAR(20),
    worktype    VARCHAR(10)  DEFAULT 'REGULAR',
    team        VARCHAR(50),
    position    VARCHAR(30),
    birthdate   DATE,
    mobile      VARCHAR(20),
    hiredate    DATE,
    retiredate  DATE,
    photoimage  BYTEA,
    photomime   VARCHAR(50),
    createdat   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    updatedat   TIMESTAMP,
    created_by  VARCHAR(100),
    updated_by  VARCHAR(100),
    CONSTRAINT user01t_pkey PRIMARY KEY (companyid, email),
    CONSTRAINT user01t_worktype_chk CHECK (worktype IN ('REGULAR', 'CONTRACT')),
    CONSTRAINT user01t_retiredate_chk CHECK (retiredate IS NULL OR hiredate IS NULL OR retiredate >= hiredate)
);

COMMENT ON TABLE  user01t            IS '사용자 — 계정은 어드민>고객사관리, 인사 기본정보는 설정>사용자관리에서 입력. 메뉴권한은 usermenupermission01t (companyid, email 로 연결)';
COMMENT ON COLUMN user01t.companyid  IS '회사 코드 (company01t.companyid). 001 = 플랫폼 운영사 [고객사관리]';
COMMENT ON COLUMN user01t.email      IS '로그인 ID (이메일, 전체에서 중복 불가) [고객사관리 입력 / 사용자관리 아이디로 보기만]';
COMMENT ON COLUMN user01t.username   IS '사용자명 [고객사관리 입력 / 사용자관리 이름으로 보기만]';
COMMENT ON COLUMN user01t.password   IS '비밀번호 해시 (pbkdf2) [고객사관리 · 비밀번호 변경]';
COMMENT ON COLUMN user01t.authority  IS '권한 MASTER(001 플랫폼 관리자) / SUBMASTER(고객사 관리자) / USER(일반) [고객사관리]';
COMMENT ON COLUMN user01t.useyn      IS '계정 사용 여부 Y/N, N 이면 로그인 불가 [고객사관리 입력 / 사용자관리 계정사용으로 보기만]';
COMMENT ON COLUMN user01t.empno      IS '사원번호 (회사 안에서 중복 불가) [사용자관리]';
COMMENT ON COLUMN user01t.worktype   IS '근무유형 REGULAR 정규직 / CONTRACT 계약직 [사용자관리]';
COMMENT ON COLUMN user01t.team       IS '부서 [사용자관리]';
COMMENT ON COLUMN user01t.position   IS '직급 [사용자관리]';
COMMENT ON COLUMN user01t.birthdate  IS '생년월일 [사용자관리]';
COMMENT ON COLUMN user01t.mobile     IS '휴대폰번호 010-0000-0000 [사용자관리]';
COMMENT ON COLUMN user01t.hiredate   IS '입사일 [사용자관리]';
COMMENT ON COLUMN user01t.retiredate IS '퇴사일, 오늘 이전이면 목록 상태가 퇴사 [사용자관리]';
COMMENT ON COLUMN user01t.photoimage IS '사진 이미지 (JPG · PNG, 500KB 이하) [사용자관리]';
COMMENT ON COLUMN user01t.photomime  IS '사진 형식 image/jpeg, image/png [사용자관리]';
COMMENT ON COLUMN user01t.createdat  IS '등록일시 (계정 생성 시각)';
COMMENT ON COLUMN user01t.updatedat  IS '수정일시 (고객사관리 · 사용자관리 저장 시 갱신)';
COMMENT ON COLUMN user01t.created_by IS '등록자 (계정을 만든 관리자 로그인 이메일)';
COMMENT ON COLUMN user01t.updated_by IS '수정자 (마지막으로 저장한 사람 로그인 이메일)';

-- 4) 데이터 다시 넣기
INSERT INTO user01t (
    companyid, email, username, password, authority, useyn,
    empno, worktype, team, position, birthdate, mobile, hiredate, retiredate, photoimage, photomime,
    createdat, updatedat, created_by, updated_by)
SELECT
    companyid, email, username, password, authority, useyn,
    empno, COALESCE(worktype, 'REGULAR'), team, position, birthdate, mobile, hiredate, retiredate, photoimage, photomime,
    createdat, updatedat, created_by, updated_by
FROM user01t_backup;

-- 5) 인덱스
CREATE UNIQUE INDEX ux_user01t_email_lower ON user01t (LOWER(email)) WHERE email IS NOT NULL AND BTRIM(email) <> '';
CREATE UNIQUE INDEX user01t_empno_uq ON user01t (companyid, empno) WHERE empno IS NOT NULL;
CREATE INDEX ix_user01t_company_user_sort ON user01t (companyid, LOWER(username), LOWER(email));
CREATE INDEX ix_user01t_company_useyn ON user01t (companyid, UPPER(COALESCE(useyn, 'N')));
CREATE INDEX ix_user01t_email ON user01t (email);

-- 6) 메뉴권한 외래키 복구
ALTER TABLE usermenupermission01t
    ADD CONSTRAINT usermenupermission01t_companyid_useremail_fkey
    FOREIGN KEY (companyid, useremail) REFERENCES user01t (companyid, email) ON UPDATE CASCADE ON DELETE CASCADE;

-- 7) 사용자관리 메뉴 등록: 고객사 메뉴(COMPANY), 메뉴권한 화면에서 부여 가능(assignable)
--    새 계정을 만들 때 자동으로 주는 메뉴에서는 빠진다 (services/auth/User.py create_user).
--    고객사 관리자(SUBMASTER)와 플랫폼 관리자(001 MASTER)는 권한 없이도 쓸 수 있다.
INSERT INTO menucatalog01t (menuid, menuname, access_scope, assignable, sort_order, useyn)
VALUES ('USER_MANAGEMENT', '사용자관리', 'COMPANY', TRUE, 32, 'Y')
ON CONFLICT (menuid) DO UPDATE
   SET menuname = EXCLUDED.menuname, access_scope = EXCLUDED.access_scope,
       assignable = EXCLUDED.assignable, useyn = EXCLUDED.useyn;

COMMIT;
