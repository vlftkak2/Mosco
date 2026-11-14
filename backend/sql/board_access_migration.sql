-- 상담게시판 탭 권한 변경 (2026-11-13)
--   · 공지사항   : 운영사(001)만 등록 · 열람, 답글 없음, 상단 고정 가능
--   · AI ERP문의 : 운영사만 열람 (홈페이지 문의가 들어올 탭 → 작성 회사코드 제한 없음)
--   · 재고 · 시스템문의 : 각 회사 + 운영사(시험용)도 등록 가능
--   · 기타문의(etc) 탭 삭제
-- 여러 번 실행해도 안전합니다.
BEGIN;

ALTER TABLE board01t DROP CONSTRAINT IF EXISTS board01t_category_check;
ALTER TABLE board01t DROP CONSTRAINT IF EXISTS board_category_owner;
ALTER TABLE board01t DROP CONSTRAINT IF EXISTS board_pinned_managed;

ALTER TABLE board01t ADD CONSTRAINT board01t_category_check CHECK (category IN ('notice', 'stock', 'ai', 'system'));
-- 공지사항은 운영사 글만
ALTER TABLE board01t ADD CONSTRAINT board_category_owner CHECK (category <> 'notice' OR companyid = '001');
-- 상단 고정은 공지사항만
ALTER TABLE board01t ADD CONSTRAINT board_pinned_managed CHECK (NOT pinned OR category = 'notice');

COMMENT ON COLUMN board01t.category  IS '탭: notice 공지사항(운영사 전용) / stock 재고문의 / ai AI ERP문의(운영사 전용) / system 시스템문의';
COMMENT ON COLUMN board01t.companyid IS '작성 회사코드 (로그인 계정에서 결정). 재고 · 시스템문의는 이 회사와 운영사만, 공지사항 · AI ERP문의는 운영사만 열람';
COMMENT ON COLUMN board01t.pinned    IS '목록 상단 고정 (공지사항만, 운영사만 설정)';
COMMENT ON COLUMN board01t.reply     IS '운영사의 마지막 답글 사본 (예전 화면 호환용, 답글 저장 · 수정 · 삭제 시 자동 갱신). 빈 문자열이면 운영사 답글 없음';

COMMIT;
