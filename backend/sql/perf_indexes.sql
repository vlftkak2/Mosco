-- 성능용 인덱스 (idempotent: 여러 번 실행해도 안전)
-- 테이블이 작아서 잠금 시간은 짧다. 운영 중 큰 테이블에 적용할 때는 CREATE INDEX CONCURRENTLY 로 바꿔
-- 트랜잭션 밖(psql autocommit)에서 실행한다.

-- 1) 재고 → AI 주문 연결 확인 (services/ai/stock_links.py linked_orders_sql / ensure_not_linked,
--    AIOrderOptimization._reserved_sql). currentstock01t 행마다 (companyid, stocksourcetype, stocksourceno, stocksourceline)
--    로 aiorder03t 를 찾는데, 기존 인덱스는 (companyid, orderid, lineno, ...) 순서라 회사 전체 범위를 훑는다.
CREATE INDEX IF NOT EXISTS aiorder03t_stock_idx
    ON aiorder03t (companyid, stocksourcetype, stocksourceno, stocksourceline);

-- 2) 가공 최적화 대기 목록 (AIOrderOptimization.list_queue / _load_lines: companyid + optimize_status).
--    PK (companyid, orderid, lineno) 로는 회사 전체 품목을 읽은 뒤 상태로 거른다. 가공완료(DONE)가 쌓일수록 커진다.
CREATE INDEX IF NOT EXISTS aiorder02t_optimize_status_idx
    ON aiorder02t (companyid, optimize_status);
