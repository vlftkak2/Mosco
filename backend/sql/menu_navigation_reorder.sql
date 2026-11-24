-- 네비 디자인 최종 (2026-11-24): 대메뉴 순서(대시보드 · 매입관리 · 매출관리 · 재고관리 · 가공관리 · 거래처관리 · 자금관리 · 기준정보 · 게시판 · 어드민)에 맞춰
-- 메뉴 카탈로그 정렬 순서와 '거래처관리' 화면 이름(→ 거래처등록)을 맞춘다. 권한(usermenupermission01t)은 그대로.
BEGIN;
UPDATE menucatalog01t m SET sort_order = v.ord
FROM (VALUES
  ('HOME', 1), ('INBOUND_REGISTER', 2), ('INBOUND_SEARCH', 3),
  ('OUTBOUND_REGISTER', 4), ('OUTBOUND_SEARCH', 5), ('GROSS_PROFIT', 6), ('GROSS_PROFIT_DASHBOARD', 7),
  ('STOCK_INITIAL', 8), ('STOCK_CURRENT', 9), ('STOCK_HISTORY', 10), ('INOUTMOVE_REGISTER', 11), ('INOUTMOVE_SEARCH', 12),
  ('AI_ORDER_RECOGNITION', 13), ('AI_ORDER_MANAGEMENT', 14), ('AI_OPTIMIZATION', 15),
  ('ITEM_PROCESS_MASTER', 16), ('ITEM_PROCESS_REGISTER', 17), ('ITEM_PROCESS_SEARCH', 18),
  ('DATA_CUSTOMER', 19), ('CUSTOMER_LEDGER', 20), ('CUSTOMER_BALANCE_DASHBOARD', 21),
  ('RECEIPT_PAYMENT', 22), ('RECEIPT_PAYMENT_SEARCH', 23), ('INSTRUMENT_STATUS', 24),
  ('DATA_CODE', 25), ('DATA_ITEM', 26), ('WORKPLACE_MANAGEMENT', 27), ('MONTH_CLOSING', 28), ('USER_MANAGEMENT', 29),
  ('CUSTOMER_SUPPORT', 30)
) AS v(menuid, ord)
WHERE m.menuid = v.menuid;
UPDATE menucatalog01t SET menuname = '거래처등록' WHERE menuid = 'DATA_CUSTOMER';
COMMIT;
