-- =====================================================================
-- 상담게시판 테이블 전체 생성 (삭제 후 다시 만들기)
--   board01t      : 게시글 (공지사항 · 재고문의 · AI ERP문의 · 시스템문의)
--   boardreply01t : 게시글에 달린 답글 (대화형, 여러 개)
--
-- ※ 주의: DROP 하므로 기존 게시글 · 답글이 모두 지워집니다.
-- ※ 칼럼 타입은 다른 업무 테이블과 같게 맞춤
--      companyid   VARCHAR(50)  NOT NULL
--      companyname VARCHAR(100) NOT NULL
--      created_at  TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP   (등록일시)
--      updated_at  TIMESTAMPTZ  NULL                                (수정일시, 수정 전엔 비어 있음)
--      created_by  VARCHAR(100)                                     (등록자 = 로그인 이메일)
--      updated_by  VARCHAR(100)                                     (수정자 = 로그인 이메일)
--    + 화면 표시용 이름 created_name / updated_name VARCHAR(100)
--
-- 탭 규칙
--   notice(공지사항) : 운영사(001)만 보고 · 쓰고 · 고정, 답글 없음
--   ai(AI ERP문의)   : 운영사(001)만 봄 (추후 홈페이지에서 접수), 답글 가능
--   stock / system   : 각 회사가 등록 (운영사도 시험 등록 가능), 작성 회사와 운영사만 봄
--   답변 상태(답변대기 · 답변완료 · 추가문의)는 마지막 답글 회사로 계산하므로 칼럼이 따로 없음
-- =====================================================================

BEGIN;

DROP TABLE IF EXISTS boardreply01t;
DROP TABLE IF EXISTS board01t;

-- ---------------------------------------------------------------------
-- 게시글
-- ---------------------------------------------------------------------
CREATE TABLE board01t (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    companyid     VARCHAR(50)  NOT NULL,
    companyname   VARCHAR(100) NOT NULL,
    category      VARCHAR(20)  NOT NULL,
    title         VARCHAR(200) NOT NULL,
    content       TEXT         NOT NULL,
    phone         VARCHAR(50)  NOT NULL DEFAULT '',
    pinned        BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMPTZ,
    created_by    VARCHAR(100),
    updated_by    VARCHAR(100),
    created_name  VARCHAR(100),
    updated_name  VARCHAR(100),
    CONSTRAINT board01t_category_check  CHECK (category IN ('notice', 'stock', 'ai', 'system')),
    CONSTRAINT board01t_notice_owner    CHECK (category <> 'notice' OR companyid = '001'),
    CONSTRAINT board01t_pinned_notice   CHECK (NOT pinned OR category = 'notice')
);

-- 탭 목록: 고정글 먼저, 최신순
CREATE INDEX ix_board01t_category_list ON board01t (category, pinned DESC, id DESC);
-- 회사별 문의 목록 (재고 · 시스템문의는 자기 회사 글만 조회)
CREATE INDEX ix_board01t_company_list  ON board01t (companyid, category, id DESC);

COMMENT ON TABLE  board01t              IS '상담게시판 게시글';
COMMENT ON COLUMN board01t.id           IS '게시글 번호';
COMMENT ON COLUMN board01t.companyid    IS '작성 회사 ID (001 = 운영사)';
COMMENT ON COLUMN board01t.companyname  IS '작성 회사명';
COMMENT ON COLUMN board01t.category     IS '게시판 탭: notice 공지사항, stock 재고문의, ai AI ERP문의, system 시스템문의';
COMMENT ON COLUMN board01t.title        IS '제목';
COMMENT ON COLUMN board01t.content      IS '본문';
COMMENT ON COLUMN board01t.phone        IS '회신 연락처 (공지사항은 사용 안 함)';
COMMENT ON COLUMN board01t.pinned       IS '상단 고정 (공지사항만, 운영사만 설정)';
COMMENT ON COLUMN board01t.created_at   IS '등록일시';
COMMENT ON COLUMN board01t.updated_at   IS '수정일시 (수정 전엔 NULL)';
COMMENT ON COLUMN board01t.created_by   IS '등록자 (로그인 이메일)';
COMMENT ON COLUMN board01t.updated_by   IS '수정자 (로그인 이메일)';
COMMENT ON COLUMN board01t.created_name IS '등록자명 (화면 표시용)';
COMMENT ON COLUMN board01t.updated_name IS '수정자명 (화면 표시용)';

-- ---------------------------------------------------------------------
-- 답글 (게시글을 지우면 함께 지워짐)
-- ---------------------------------------------------------------------
CREATE TABLE boardreply01t (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    board_id      BIGINT       NOT NULL REFERENCES board01t (id) ON DELETE CASCADE,
    companyid     VARCHAR(50)  NOT NULL,
    companyname   VARCHAR(100) NOT NULL,
    content       TEXT         NOT NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMPTZ,
    created_by    VARCHAR(100),
    updated_by    VARCHAR(100),
    created_name  VARCHAR(100),
    updated_name  VARCHAR(100)
);

-- 게시글별 답글 시간순 · 마지막 답글(답변 상태 계산)
CREATE INDEX ix_boardreply01t_board ON boardreply01t (board_id, created_at, id);

COMMENT ON TABLE  boardreply01t              IS '상담게시판 답글';
COMMENT ON COLUMN boardreply01t.id           IS '답글 번호';
COMMENT ON COLUMN boardreply01t.board_id     IS '게시글 번호 (board01t.id)';
COMMENT ON COLUMN boardreply01t.companyid    IS '작성 회사 ID (001 = 운영사 답변)';
COMMENT ON COLUMN boardreply01t.companyname  IS '작성 회사명';
COMMENT ON COLUMN boardreply01t.content      IS '답글 내용';
COMMENT ON COLUMN boardreply01t.created_at   IS '등록일시';
COMMENT ON COLUMN boardreply01t.updated_at   IS '수정일시 (수정 전엔 NULL)';
COMMENT ON COLUMN boardreply01t.created_by   IS '등록자 (로그인 이메일)';
COMMENT ON COLUMN boardreply01t.updated_by   IS '수정자 (로그인 이메일)';
COMMENT ON COLUMN boardreply01t.created_name IS '등록자명 (화면 표시용)';
COMMENT ON COLUMN boardreply01t.updated_name IS '수정자명 (화면 표시용)';

COMMIT;
