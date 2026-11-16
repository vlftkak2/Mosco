-- 현재고 원가단가(kg당) · 재고구분 · 기초재고 행 유일 · 수량 제약
-- 적용: 2026-11-16 (로컬/운영 공용 DB). 여러 번 실행해도 안전하다.
BEGIN;

-- 1) 원가단가: kg당 원가 (매입 기타비용·가공 원재료 원가 포함, 부가세 제외). 재고금액 = weight × costprice
ALTER TABLE currentstock01t ADD COLUMN IF NOT EXISTS costprice numeric(15,3) NOT NULL DEFAULT 0;

-- 2) 재고구분: 이동·가공 재고도 sourcetype 은 'INBOUND' 로 남으므로(출고·가공 전표가 참조하는 키) 구분 컬럼을 따로 둔다
ALTER TABLE currentstock01t ADD COLUMN IF NOT EXISTS stockkind varchar(10) NOT NULL DEFAULT 'INBOUND';
UPDATE currentstock01t cs
   SET stockkind = CASE
       WHEN cs.sourcetype = 'OPENING' THEN 'OPENING'
       WHEN EXISTS (SELECT 1 FROM process01t p WHERE p.companyid = cs.companyid AND p.processno = cs.sourceno) THEN 'PROCESS'
       WHEN EXISTS (SELECT 1 FROM inoutmove01t m WHERE m.companyid = cs.companyid AND m.receiptno = cs.sourceno) THEN 'TRANSFER'
       ELSE 'INBOUND' END;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_currentstock01t_stockkind') THEN
    ALTER TABLE currentstock01t ADD CONSTRAINT ck_currentstock01t_stockkind
      CHECK (stockkind IN ('OPENING', 'INBOUND', 'PROCESS', 'TRANSFER'));
  END IF;
END $$;

-- 3) 기초재고 행번호(StandStock01t.lineno)는 회사 안에서 유일 → OPENING 재고 행도 sourceline 으로 유일해야 한다
CREATE UNIQUE INDEX IF NOT EXISTS ux_currentstock01t_opening_line
    ON currentstock01t (companyid, sourceline) WHERE sourcetype = 'OPENING';

-- 4) 재고 수량·중량 안전장치 (앱 밖에서 잘못 바뀌는 것 방지)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_currentstock01t_qty_range') THEN
    ALTER TABLE currentstock01t ADD CONSTRAINT ck_currentstock01t_qty_range
      CHECK (qty >= 0 AND qty <= originalqty AND weight <= originalweight);
  END IF;
END $$;

COMMIT;

-- 원가단가 값 채우기는 파이썬으로 실행 (저장 로직과 같은 규칙):
--   from services.inventory import stock_cost; stock_cost.rebuild_cost_prices(cursor, companyid)
