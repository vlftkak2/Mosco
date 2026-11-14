-- company01t.email 삭제: 고객사등록 · 사업장관리 화면에서 쓰지 않고, 거래명세서 등 어디에도 쓰이지 않는다.
-- (새로 만들 때는 company01t_full_create.sql 에 이미 빠져 있다) 여러 번 실행해도 안전하다.
ALTER TABLE company01t DROP COLUMN IF EXISTS email;
