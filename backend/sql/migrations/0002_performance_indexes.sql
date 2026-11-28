-- migrate:no-transaction
-- 0002: 대량 데이터용 인덱스 (운영 중에도 테이블을 막지 않도록 CONCURRENTLY, 다시 실행해도 안전)
-- 실패하면 INVALID 인덱스가 남을 수 있다 → DROP INDEX CONCURRENTLY IF EXISTS <이름>; 후 다시 실행.

-- ① 거래처원장 단건 · 여신 통제 · 홈 거래처 필터 (CustomerLedger._customer_match: BTRIM(customcode) = 거래처)
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_outbound01t_company_custkey_date ON outbound01t (companyid, btrim(customcode), receptdate);
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_inbound01t_company_custkey_date ON inbound01t (companyid, btrim(customcode), receptdate);
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_receiptpayment01t_company_custkey_date ON receiptpayment01t (companyid, btrim(customcode), receiptdate);
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_process01t_company_custkey_date ON process01t (companyid, btrim(customcode), processdate);
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_outbound03t_company_cost_custkey ON outbound03t (companyid, btrim(customcode)) WHERE upper(COALESCE(purchaseyn, 'N')) = 'Y';

-- ② 전표번호 채번 (receiptno LIKE '접두어%'): DB 정렬규칙이 Korean_Korea.949 라 PK 인덱스로는 LIKE 를 못 쓴다
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_inbound01t_company_receiptno_pattern ON inbound01t (companyid, receiptno varchar_pattern_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_outbound01t_company_receiptno_pattern ON outbound01t (companyid, receiptno varchar_pattern_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_inoutmove01t_company_receiptno_pattern ON inoutmove01t (companyid, receiptno varchar_pattern_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_receiptpayment01t_company_receiptno_pattern ON receiptpayment01t (companyid, receiptno varchar_pattern_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_process01t_company_processno_pattern ON process01t (companyid, processno varchar_pattern_ops);

-- ③ 재고이전 검색 · 월마감 건수 (날짜 인덱스가 없어 회사 전체를 읽고 정렬하던 곳)
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_inoutmove01t_company_date ON inoutmove01t (companyid, receptdate, receiptno);

-- ④ 현재고 검색: 품명 · 규격 OR 검색에 productname 만 trgm 인덱스가 없어 회사 전체를 읽었다
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_currentstock01t_productname_trgm ON currentstock01t USING gin (productname gin_trgm_ops);

-- ⑤ 홈 재고 · 타사 재고: 재고가 남은 로트만 (쿼리 조건 weight > 0 과 같은 부분 인덱스)
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_currentstock01t_company_instock ON currentstock01t (companyid, receiptdate) WHERE weight > 0;

-- ⑥ 전표 저장 때 거래처명으로 거래처 찾기 (LOWER(BTRIM(customername)) = ...)
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_customer01t_company_name_norm ON customer01t (companyid, lower(btrim(customername)));

-- ⑦ 중복 인덱스 정리: iniop01t_company_date_idx (companyid, iniodate) 는 iniop01t_company_date_key 의 앞부분과 같다
DROP INDEX CONCURRENTLY IF EXISTS iniop01t_company_date_idx;
