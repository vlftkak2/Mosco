-- =====================================================================
-- 월마감 (메뉴: MONTH_CLOSING)
--   · monthclose01t  : 마감된 달 (회사별, 달 1일로 저장). 행이 있으면 그 달은 마감, 마감 취소 = 행 삭제.
--   · menucatalog01t : '월마감 관리' 메뉴 추가 → 사용자 메뉴권한 화면에서 담당자에게 부여
-- 여러 번 실행해도 안전하다.
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS monthclose01t (
    companyid   VARCHAR(50)  NOT NULL,
    companyname VARCHAR(100) NOT NULL,
    closemonth  DATE         NOT NULL,          -- 마감월의 1일
    closed_at   TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_by   VARCHAR(100),
    CONSTRAINT monthclose01t_pkey PRIMARY KEY (companyid, closemonth),
    CONSTRAINT monthclose01t_first_day CHECK (EXTRACT(DAY FROM closemonth) = 1)
);

INSERT INTO menucatalog01t (menuid, menuname, access_scope, assignable, sort_order, useyn)
VALUES ('MONTH_CLOSING', '월마감 관리', 'COMPANY', TRUE, 31, 'Y')
ON CONFLICT (menuid) DO NOTHING;

COMMIT;
