-- =====================================================================
-- 메뉴 목록 (menucatalog01t) — 왼쪽 메뉴(MainLayout.jsx)와 1:1로 맞춘다.
--   menuname   = 왼쪽 메뉴 이름, sort_order = 왼쪽 메뉴 순서
--   COMPANY + assignable=TRUE  : 고객사 메뉴권한 화면에서 사용자에게 부여하는 화면
--   assignable=FALSE           : 권한이 아니라 역할(MASTER / SUBMASTER)이나 모든 사용자에게 열리는 화면
--   여러 번 실행해도 안전하다.
-- =====================================================================
BEGIN;

INSERT INTO menucatalog01t (menuid, menuname, access_scope, assignable, sort_order, useyn)
VALUES
    -- 홈
    ('HOME',                       '대시보드',          'COMPANY',  TRUE,   1, 'Y'),
    -- 매입
    ('INBOUND_REGISTER',           '매입등록',          'COMPANY',  TRUE,   2, 'Y'),
    ('INBOUND_SEARCH',             '매입현황',          'COMPANY',  TRUE,   3, 'Y'),
    -- 매출
    ('OUTBOUND_REGISTER',          '매출등록',          'COMPANY',  TRUE,   4, 'Y'),
    ('OUTBOUND_SEARCH',            '매출현황',          'COMPANY',  TRUE,   5, 'Y'),
    ('GROSS_PROFIT',               '매출이익 분석',     'COMPANY',  TRUE,   6, 'Y'),
    ('GROSS_PROFIT_DASHBOARD',     '매출이익 현황',     'COMPANY',  TRUE,   7, 'Y'),
    -- 가공
    ('AI_ORDER_RECOGNITION',       'AI 주문서인식',     'COMPANY',  TRUE,   8, 'Y'),
    ('AI_ORDER_MANAGEMENT',        '주문서관리',        'COMPANY',  TRUE,   9, 'Y'),
    ('AI_OPTIMIZATION',            '가공최적화',        'COMPANY',  TRUE,  10, 'Y'),
    ('ITEM_PROCESS_MASTER',        '가공공정 관리',     'COMPANY',  TRUE,  11, 'Y'),
    ('ITEM_PROCESS_REGISTER',      '재고가공 등록',     'COMPANY',  TRUE,  12, 'Y'),
    ('ITEM_PROCESS_SEARCH',        '재고가공 현황',     'COMPANY',  TRUE,  13, 'Y'),
    -- 재고
    ('STOCK_INITIAL',              '기초재고 등록',     'COMPANY',  TRUE,  14, 'Y'),
    ('STOCK_CURRENT',              '현재고 현황',       'COMPANY',  TRUE,  15, 'Y'),
    ('STOCK_HISTORY',              '재고수불 현황',     'COMPANY',  TRUE,  16, 'Y'),
    ('INOUTMOVE_REGISTER',         '재고이동 등록',     'COMPANY',  TRUE,  17, 'Y'),
    ('INOUTMOVE_SEARCH',           '재고이동 현황',     'COMPANY',  TRUE,  18, 'Y'),
    -- 자금
    ('RECEIPT_PAYMENT',            '수금·지급 등록',    'COMPANY',  TRUE,  19, 'Y'),
    ('RECEIPT_PAYMENT_SEARCH',     '수금·지급 현황',    'COMPANY',  TRUE,  20, 'Y'),
    ('INSTRUMENT_STATUS',          '수표·어음 관리',    'COMPANY',  TRUE,  21, 'Y'),
    ('CUSTOMER_LEDGER',            '거래처원장',        'COMPANY',  TRUE,  22, 'Y'),
    ('CUSTOMER_BALANCE_DASHBOARD', '거래처 잔액 현황',  'COMPANY',  TRUE,  23, 'Y'),
    -- 게시판 (모든 사용자에게 열림 — 부여 대상 아님)
    ('CUSTOMER_SUPPORT',           '상담게시판',        'COMPANY',  FALSE, 24, 'Y'),
    -- 설정 > 기준정보
    ('DATA_CODE',                  '일반코드 관리',     'COMPANY',  TRUE,  25, 'Y'),
    ('DATA_ITEM',                  '품목코드 관리',     'COMPANY',  TRUE,  26, 'Y'),
    ('DATA_CUSTOMER',              '거래처관리',        'COMPANY',  TRUE,  27, 'Y'),
    -- 설정 > 운영정보
    ('WORKPLACE_MANAGEMENT',       '사업장관리',        'COMPANY',  TRUE,  28, 'Y'),
    ('MONTH_CLOSING',              '월마감 관리',       'COMPANY',  TRUE,  29, 'Y'),
    ('USER_MANAGEMENT',            '사용자관리',        'COMPANY',  TRUE,  30, 'Y'),
    -- 어드민 (역할로 접근 — 부여 대상 아님)
    ('COMPANY_REGISTRATION',       '고객사등록',        'PLATFORM', FALSE, 31, 'Y'),
    ('COMPANY_USER_MANAGEMENT',    '고객사관리',        'PLATFORM', FALSE, 32, 'Y'),
    ('USER_MENU_PERMISSION',       '고객사 메뉴권한',   'PLATFORM', FALSE, 33, 'Y')
ON CONFLICT (menuid) DO UPDATE SET
    menuname = EXCLUDED.menuname,
    access_scope = EXCLUDED.access_scope,
    assignable = EXCLUDED.assignable,
    sort_order = EXCLUDED.sort_order,
    useyn = EXCLUDED.useyn;

-- 화면이 없는 메뉴 정리: 가공기준 관리(AI_STANDARDS)는 왼쪽 메뉴 · 화면 · API 어디에도 없다
DELETE FROM usermenupermission01t WHERE menuid = 'AI_STANDARDS';
DELETE FROM menucatalog01t WHERE menuid = 'AI_STANDARDS';

COMMIT;
