-- 재고관리 조회 속도용 인덱스 (여러 번 실행해도 안전: IF NOT EXISTS). 데이터·결과는 바뀌지 않는다.
-- 운영 DB 에는 CONCURRENTLY 로 만들면 쓰기를 막지 않는다 (트랜잭션 밖에서 한 줄씩 실행).
--
-- 확인 방법 (2026-11-28, 회사 001, 현재고 551행 중 잔량 있는 행 370행):
--   임시 트랜잭션에서 만들고 EXPLAIN 한 뒤 ROLLBACK.

-- 1) 현재고현황 기본 조회 (잔량 0 제외, 입고일자 순 50행)
--    WHERE companyid = ? AND (qty > 0 OR weight > 0)
--    ORDER BY receiptdate, sourcetype, sourceno, sourceline LIMIT/OFFSET
--    지금: 입고일자 DESC 인덱스를 거꾸로 읽으며 잔량 0 로트를 한 행씩 걸러내고(Filter) 다시 정렬(Incremental Sort).
--          다 쓴 로트가 쌓일수록(보통 대부분) 50행을 찾으려고 읽는 행이 늘어난다.
--    이후: 이 인덱스만 순서대로 읽고 50행에서 멈춘다 (Filter·Sort 없음). 건수(COUNT)도 이 인덱스로 센다.
CREATE INDEX IF NOT EXISTS ix_currentstock01t_company_onhand_order
    ON CurrentStock01t (companyid, receiptdate, sourcetype, sourceno, sourceline)
    WHERE (qty > 0 OR weight > 0);

-- 2) 재고이동등록 [현재고 조회] (출고 창고를 먼저 고른 뒤 그 창고의 이동 가능 재고, 입고일자 순)
--    WHERE companyid = ? AND COALESCE(qty, 0) > 0 AND COALESCE(weight, 0) > 0 AND warehousecode = ? AND (예약 안 된 재고)
--    ORDER BY receiptdate, sourcetype, sourceno, sourceline
--    지금: 조건식이 기존 부분 인덱스(qty > 0 AND weight > 0)와 글자가 달라 쓰지 못하고, 검색용 GIN 인덱스로 창고 행을 모은 뒤 걸러낸다.
--    이후: 이 창고의 이동 가능 로트만 인덱스로 바로 읽는다 (Index Only Scan). 예약 재고 제외(anti join) 뒤 정렬은 그대로 남는다.
--    (조건식을 기존 인덱스에 맞게 고치는 대신 인덱스를 조건식에 맞췄다 → 쿼리·결과는 그대로)
CREATE INDEX IF NOT EXISTS ix_currentstock01t_company_transfer_pick
    ON CurrentStock01t (companyid, warehousecode, receiptdate, sourcetype, sourceno, sourceline)
    WHERE COALESCE(qty, 0) > 0 AND COALESCE(weight, 0) > 0;

-- 재고수불현황 · 재고이동현황 · 기초재고 조회는 이미 정렬 순서와 같은 인덱스가 있어 추가하지 않는다
--   Iniop01t (companyid, iniodate, receiptno, lineno, iniotype) / inoutmove01t (companyid, receptdate, receiptno)
--   inoutmove02t (companyid, receiptno, ...) / StandStock01t (companyid, standdate, lineno).

ANALYZE CurrentStock01t;
