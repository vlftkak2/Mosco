-- 가공 최적화 계획 → 재고가공등록 연결 (2026-11-15)
--  1) Process01t.planno     : 계획확정(aiplan01t)을 불러와 등록한 전표 (계획 1개 = 가공전표 1장)
--  2) Process02t.lossweight : 가공품 줄별로 배부한 로스 중량 (재고에는 들어가지 않음)
--                             원소재 투입중량 = 1차 가공품 (중량 + 로스) 합계, 상위 중량 = 하위 (중량 + 로스) 합계
--  3) 원소재(SOURCE) 수량 0 허용 : 코일이 남는 경우(다른 계획이 같은 코일 일부를 잡고 있을 때) 수량을 빼지 않는다
BEGIN;

ALTER TABLE process01t ADD COLUMN IF NOT EXISTS planno varchar(30);
-- (이전 버전에서 만든 차수 컬럼 · 인덱스 정리)
DROP INDEX IF EXISTS process01t_plan_run_uq;
ALTER TABLE process01t DROP COLUMN IF EXISTS planrun;
CREATE UNIQUE INDEX IF NOT EXISTS process01t_plan_uq
    ON process01t (companyid, planno) WHERE planno IS NOT NULL;

ALTER TABLE process02t ADD COLUMN IF NOT EXISTS lossweight numeric(18,3) NOT NULL DEFAULT 0;
ALTER TABLE process02t DROP CONSTRAINT IF EXISTS process02t_lossweight_check;
ALTER TABLE process02t ADD CONSTRAINT process02t_lossweight_check CHECK (lossweight >= 0);

ALTER TABLE process02t DROP CONSTRAINT IF EXISTS process02t_check;
ALTER TABLE process02t ADD CONSTRAINT process02t_check CHECK (
    ((linetype)::text = 'SOURCE' AND levelno = 0 AND parentlineno IS NULL AND sourcelineno = lineno
      AND stocksourcetype IS NOT NULL AND stocksourceno IS NOT NULL AND stocksourceline IS NOT NULL AND stocksourceline > 0
      AND sourcewarehousecode IS NOT NULL AND sourcewarehousecodename IS NOT NULL
      AND qty >= 0 AND weight > 0 AND processid IS NULL AND lossweight = 0)
    OR
    ((linetype)::text = 'PRODUCT' AND levelno > 0 AND parentlineno IS NOT NULL AND sourcelineno < lineno
      AND stocksourcetype IS NULL AND stocksourceno IS NULL AND stocksourceline IS NULL
      AND sourcewarehousecode IS NULL AND sourcewarehousecodename IS NULL)
);

COMMIT;
