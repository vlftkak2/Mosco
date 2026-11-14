-- =====================================================================
-- 메뉴 즐겨찾기 (사용자별)
--   · usermenufavorite01t : 사용자가 왼쪽 메뉴에서 ☆로 등록한 화면
--     (회사 + 이메일 + 메뉴ID 한 줄, sort_order = 즐겨찾기 표시 순서)
--   · 메뉴가 메뉴 목록(menucatalog01t)에서 지워지면 즐겨찾기도 같이 지워진다.
-- 여러 번 실행해도 안전하다.
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS usermenufavorite01t (
    companyid  VARCHAR(50)  NOT NULL,
    useremail  VARCHAR(50)  NOT NULL,
    menuid     VARCHAR(60)  NOT NULL REFERENCES menucatalog01t (menuid) ON DELETE CASCADE,
    sort_order INTEGER      NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT usermenufavorite01t_pkey PRIMARY KEY (companyid, useremail, menuid)
);

COMMIT;
