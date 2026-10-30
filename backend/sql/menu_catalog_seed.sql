-- 네비게이션 화면별 고유 메뉴 코드 초기 데이터
-- assignable=TRUE인 COMPANY 화면만 일반 사용자 권한 목록에 표시됩니다.
INSERT INTO menucatalog01t (
    menuid, menuname, access_scope, assignable, sort_order, useyn
)
VALUES
    ('HOME',                    '대시보드',          'COMPANY',  TRUE,   1, 'Y'),
    ('DATA_CODE',               '일반코드',          'COMPANY',  TRUE,   2, 'Y'),
    ('DATA_ITEM',               '품목코드',          'COMPANY',  TRUE,   3, 'Y'),
    ('DATA_CUSTOMER',           '거래처관리',        'COMPANY',  TRUE,   4, 'Y'),
    ('INBOUND_REGISTER',        '입고등록',          'COMPANY',  TRUE,   5, 'Y'),
    ('INBOUND_SEARCH',          '입고현황',          'COMPANY',  TRUE,   6, 'Y'),
    ('OUTBOUND_REGISTER',       '출고등록',          'COMPANY',  TRUE,   7, 'Y'),
    ('OUTBOUND_SEARCH',         '출고현황',          'COMPANY',  TRUE,   8, 'Y'),
    ('AI_ORDER_RECOGNITION',    'AI 주문서 인식',    'COMPANY',  TRUE,   9, 'Y'),
    ('AI_ORDER_MANAGEMENT',     '주문서 관리',       'COMPANY',  TRUE,  10, 'Y'),
    ('AI_OPTIMIZATION',         '가공 최적화',       'COMPANY',  TRUE,  11, 'Y'),
    ('AI_STANDARDS',            '가공기준 관리',     'COMPANY',  TRUE,  12, 'Y'),
    ('ITEM_PROCESS_MASTER',     '가공공정 관리',     'COMPANY',  TRUE,  13, 'Y'),
    ('ITEM_PROCESS_REGISTER',   '재고가공',          'COMPANY',  TRUE,  14, 'Y'),
    ('STOCK_INITIAL',           '기초재고등록',      'COMPANY',  TRUE,  15, 'Y'),
    ('STOCK_HISTORY',           '재고수불현황',      'COMPANY',  TRUE,  16, 'Y'),
    ('STOCK_CURRENT',           '현재고현황',        'COMPANY',  TRUE,  17, 'Y'),
    ('CUSTOMER_SUPPORT',        '고객지원',          'PLATFORM', FALSE, 18, 'Y'),

    -- 플랫폼 관리 화면은 역할로 접근하며 고객사 사용자에게 직접 부여하지 않습니다.
    ('COMPANY_REGISTRATION',    '고객사등록',        'PLATFORM', FALSE, 19, 'Y'),
    ('COMPANY_USER_MANAGEMENT', '고객사 계정관리',  'PLATFORM', FALSE, 20, 'Y'),
    ('USER_MENU_PERMISSION',    '메뉴 권한',         'COMPANY',  FALSE, 21, 'Y')
ON CONFLICT (menuid) DO UPDATE SET
    menuname = EXCLUDED.menuname,
    access_scope = EXCLUDED.access_scope,
    assignable = EXCLUDED.assignable,
    sort_order = EXCLUDED.sort_order,
    useyn = EXCLUDED.useyn;
