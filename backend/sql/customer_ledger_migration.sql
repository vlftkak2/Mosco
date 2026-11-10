-- 거래처원장 (메뉴: CUSTOMER_LEDGER)
-- 여러 번 실행해도 안전합니다 (IF NOT EXISTS / ON CONFLICT).

-- 1) 거래처별 기초잔액: 원장 시작일 이전부터 남아 있던 받을 돈 / 줄 돈
ALTER TABLE customer01t
    ADD COLUMN IF NOT EXISTS openingreceivable NUMERIC(15, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS openingpayable    NUMERIC(15, 2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN customer01t.openingreceivable IS '기초 미수금 (원장 시작일 기준)';
COMMENT ON COLUMN customer01t.openingpayable    IS '기초 미지급금 (원장 시작일 기준)';

-- 2) 회사(고객사)별 원장 시작일: 이 날짜부터의 전표만 원장에 쌓고, 이전 잔액은 거래처 기초잔액으로 본다.
--    비어 있으면 첫 거래부터 원장에 쌓는다.
ALTER TABLE company01t
    ADD COLUMN IF NOT EXISTS ledgerstartdate DATE;

COMMENT ON COLUMN company01t.ledgerstartdate IS '거래처원장 시작일 (회사별)';

-- 3) 메뉴 권한 코드
INSERT INTO menucatalog01t (menuid, menuname, access_scope, assignable, sort_order, useyn)
VALUES ('CUSTOMER_LEDGER', '거래처원장', 'COMPANY', TRUE, 28, 'Y'),
       ('CUSTOMER_BALANCE_DASHBOARD', '거래처 잔액 현황', 'COMPANY', TRUE, 29, 'Y')
ON CONFLICT (menuid) DO UPDATE SET
    menuname = EXCLUDED.menuname,
    access_scope = EXCLUDED.access_scope,
    assignable = EXCLUDED.assignable,
    sort_order = EXCLUDED.sort_order,
    useyn = EXCLUDED.useyn;
