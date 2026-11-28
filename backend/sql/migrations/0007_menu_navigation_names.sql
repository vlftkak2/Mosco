-- 0007: 네비 메뉴 명칭 · 순서 변경 (네비 시안 '네비 메뉴 명칭.html') · 다시 실행해도 안전
-- 메뉴 ID 와 권한(usermenupermission01t)은 그대로, 메뉴 카탈로그의 이름(menuname)과 정렬 순서(sort_order)만 바꾼다.
-- 한 화면을 여러 메뉴로 나눈 것(결재 문서 4개 · 휴가설정)은 권한을 원래 메뉴에서 받고, 여기에는 내메뉴 저장용으로만 둔다 (assignable = FALSE).

-- 1) 나뉜 메뉴: 내메뉴(즐겨찾기) 저장용 (권한 부여 대상 아님)
INSERT INTO menucatalog01t (menuid, menuname, access_scope, assignable, sort_order, useyn) VALUES
    ('EAPPROVAL_DRAFTS',        '임시저장함',  'COMPANY', FALSE, 0, 'Y'),
    ('EAPPROVAL_MINE',          '내 결재현황', 'COMPANY', FALSE, 0, 'Y'),
    ('EAPPROVAL_INBOX',         '결재함',      'COMPANY', FALSE, 0, 'Y'),
    ('EAPPROVAL_LEAVE_SETTING', '휴가설정',    'COMPANY', FALSE, 0, 'Y')
ON CONFLICT (menuid) DO NOTHING;

-- 2) 이름 · 순서 (네비 순서: 홈 · 매입 · 매출 · 가공 · 재고 · 자금 · 인사 · 결재 · 소통 · 설정 · 관리)
--    여러 화면에 함께 쓰이는 권한은 이름에 같이 적는다 (메뉴별 권한 화면에서 무엇이 열리는지 보이게)
UPDATE menucatalog01t m
   SET menuname = v.menuname, sort_order = v.ord
  FROM (VALUES
    ('HOME',                       '대시보드',               1),
    ('AI_ASSISTANT',               'AI 업무비서',            2),
    ('INBOUND_REGISTER',           '매입등록',               3),
    ('INBOUND_SEARCH',             '매입현황',               4),
    ('OUTBOUND_REGISTER',          '매출등록',               5),
    ('OUTBOUND_SEARCH',            '매출현황',               6),
    ('GROSS_PROFIT',               '매출이익 현황',          7),
    ('GROSS_PROFIT_DASHBOARD',     '매출이익 분석',          8),
    ('AI_ORDER_RECOGNITION',       '주문서 자동인식',        9),
    ('AI_ORDER_MANAGEMENT',        '주문서 통합관리',       10),
    ('AI_OPTIMIZATION',            'AI 가공최적화',         11),
    ('ITEM_PROCESS_REGISTER',      '재고가공 등록',         12),
    ('ITEM_PROCESS_SEARCH',        '재고가공 현황',         13),
    ('ITEM_PROCESS_MASTER',        '가공공정 관리',         14),
    ('STOCK_CURRENT',              '현재고현황',            15),
    ('STOCK_HISTORY',              '재고수불 현황',         16),
    ('STOCK_INITIAL',              '기초재고 등록',         17),
    ('INOUTMOVE_REGISTER',         '재고이동 등록',         18),
    ('INOUTMOVE_SEARCH',           '재고이동 현황',         19),
    ('RECEIPT_PAYMENT',            '수금지급 등록',         20),
    ('RECEIPT_PAYMENT_SEARCH',     '수금지급 현황',         21),
    ('INSTRUMENT_STATUS',          '어음수표 관리',         22),
    ('CUSTOMER_LEDGER',            '채권채무 현황',         23),
    ('CUSTOMER_BALANCE_DASHBOARD', '채권채무 분석',         24),
    ('USER_MANAGEMENT',            '인사기록부 등록',       25),
    ('EAPPROVAL_LEAVE',            '휴가현황',              26),
    ('EAPPROVAL_LEAVE_SETTING',    '휴가설정',              27),
    ('PAYROLL',                    '급여등록 · 급여대장',   28),
    ('PAYROLL_LEDGER',             '급여대장',              29),
    ('PAYROLL_MY',                 '내 급여현황',           30),
    ('EAPPROVAL',                  '결재 문서 · 휴가현황',  31),
    ('EAPPROVAL_DRAFTS',           '임시저장함',            32),
    ('EAPPROVAL_MINE',             '내 결재현황',           33),
    ('EAPPROVAL_INBOX',            '결재함',                34),
    ('EAPPROVAL_FORM',             '결재설정 · 휴가설정',   35),
    ('CUSTOMER_SUPPORT',           '상담게시판',            36),
    ('DATA_CODE',                  '기초코드 관리',         37),
    ('DATA_ITEM',                  '품목코드 관리',         38),
    ('DATA_CUSTOMER',              '거래처관리',            39),
    ('WORKPLACE_MANAGEMENT',       '사업장관리',            40),
    ('MONTH_CLOSING',              '월마감관리',            41),
    ('COMPANY_REGISTRATION',       '고객사등록',            42),
    ('COMPANY_USER_MANAGEMENT',    '계정관리',              43),
    ('USER_MENU_PERMISSION',       '메뉴별 권한',           44),
    ('CONTROL_MANAGEMENT',         '통제관리',              45),
    ('LICENSE_REVENUE',            '라이선스 현황',         46),
    ('SHARED_STOCK',               '타사재고 현황',         47),
    ('AI_COST',                    'AI 비용현황',           48)
  ) AS v(menuid, menuname, ord)
 WHERE m.menuid = v.menuid;
