-- =====================================================================
-- 조회 성능 인덱스 (재고수불현황 · 입고/출고 전표목록 · 삭제 검사 · 사용자명 표시)
--
--   CONCURRENTLY 로 만들어 운영 중에도 입력·저장이 막히지 않는다.
--   → 트랜잭션(BEGIN) 안에서 실행하지 말고, 한 문장씩 그대로 실행한다. (psql -f 가능)
--   여러 번 실행해도 안전하다 (IF NOT EXISTS / IF EXISTS).
-- =====================================================================

-- 재고수불현황: 정렬(일자·전표·순번·유형) 그대로 인덱스만 읽고 페이지 키를 고른다.
-- 기존 ix_iniop01t_company_date(companyid, iniodate, receiptno, lineno) 를 대체한다.
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_iniop01t_company_date_key
    ON iniop01t (companyid, iniodate, receiptno, lineno, iniotype);
DROP INDEX CONCURRENTLY IF EXISTS ix_iniop01t_company_date;

-- 재고수불현황: 품목·제품번호·거래처·창고 부분검색 (ILIKE '%..%')
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_iniop01t_search_trgm
    ON iniop01t USING gin (itemcode gin_trgm_ops, itemname gin_trgm_ops, productname gin_trgm_ops,
                           customname gin_trgm_ops, warehousecode gin_trgm_ops, warehousecodename gin_trgm_ops);

-- 입고 전표목록 정렬 (입고일자 → 거래처명 → 전표번호)
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_inbound01t_company_date_customer
    ON inbound01t (companyid, receptdate, customname, receiptno);

-- 등록자/수정자 이름 표시: email 로 바로 찾는다 (행마다 user01t 전체를 읽지 않게)
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_user01t_email
    ON user01t (email);

-- 입고·기초재고 삭제 검사: "이 재고가 가공·재고이전에 쓰였는가" (기존 인덱스는 가공번호/이전번호가 앞이라 못 씀)
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_process02t_stock_source
    ON process02t (companyid, stocksourcetype, stocksourceno, stocksourceline)
    WHERE linetype = 'SOURCE';
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_inoutmove02t_stock_source
    ON inoutmove02t (companyid, stocksourcetype, stocksourceno, stocksourceline);

ANALYZE iniop01t;
ANALYZE inbound01t;
ANALYZE user01t;
ANALYZE process02t;
ANALYZE inoutmove02t;
