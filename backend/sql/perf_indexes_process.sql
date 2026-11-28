-- 가공관리 조회 속도용 인덱스 (여러 번 실행해도 안전 · 데이터는 바꾸지 않음)
-- 2026-11-28 측정 (회사 001, 로컬 DB): 가공관리 목록 조회는 모두 1~13 ms, 기존 인덱스가 대부분을 덮는다.
-- 데이터가 늘었을 때를 위해 상태로 거르는 가공계획 조회에만 하나 추가한다.
--   · 가공최적화 [계획 불러오기] list_plans: WHERE companyid = ? AND status IN (...)
--   · 재고 예약/계획 확인 EXISTS (... aiplan01t pl WHERE pl.companyid = ? AND pl.status = 'CONFIRMED' AND pl.rawkind = 'STOCK' ...)
--     (원천 재고 조건은 기존 (companyid, stocksourcetype, stocksourceno, stocksourceline) 인덱스가 맡는다)

CREATE INDEX IF NOT EXISTS ix_aiplan01t_company_status
    ON aiplan01t (companyid, status, planno);
