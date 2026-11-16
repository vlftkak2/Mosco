-- 수불장 상세구분(iniokind) 컬럼 · 인덱스 · 안전장치 트리거
-- 적용: 2026-11-16. 여러 번 실행해도 안전하다.
--   ST 기초 / IN 매입입고 / OUT 매출출고 / PROCESS_OUT 가공투입 / PROCESS_IN 가공입고 / MOVE_OUT 이동출고 / MOVE_IN 이동입고
-- 앱은 저장할 때 값을 직접 넣는다. 트리거는 값이 비어 들어오면(이전 버전 서버, 직접 SQL 입력) 전표 종류로 채운다.
BEGIN;

ALTER TABLE iniop01t ADD COLUMN IF NOT EXISTS iniokind varchar(12);

-- 기존 행 채우기: 가공전표·창고이동전표에 있는 번호면 가공/이동, 아니면 원래 유형
UPDATE iniop01t i
   SET iniokind = CASE
       WHEN i.iniotype = 'ST' THEN 'ST'
       WHEN EXISTS (SELECT 1 FROM process01t p WHERE p.companyid = i.companyid AND p.processno = i.receiptno)
            THEN 'PROCESS_' || i.iniotype
       WHEN EXISTS (SELECT 1 FROM inoutmove01t m WHERE m.companyid = i.companyid AND m.receiptno = i.receiptno)
            THEN 'MOVE_' || i.iniotype
       ELSE i.iniotype END
 WHERE i.iniokind IS NULL;

CREATE OR REPLACE FUNCTION iniop01t_fill_kind() RETURNS trigger AS $$
BEGIN
    IF NEW.iniokind IS NULL THEN
        NEW.iniokind := CASE
            WHEN NEW.iniotype = 'ST' THEN 'ST'
            WHEN EXISTS (SELECT 1 FROM process01t p WHERE p.companyid = NEW.companyid AND p.processno = NEW.receiptno)
                 THEN 'PROCESS_' || NEW.iniotype
            WHEN EXISTS (SELECT 1 FROM inoutmove01t m WHERE m.companyid = NEW.companyid AND m.receiptno = NEW.receiptno)
                 THEN 'MOVE_' || NEW.iniotype
            ELSE NEW.iniotype END;
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_iniop01t_fill_kind ON iniop01t;
CREATE TRIGGER trg_iniop01t_fill_kind BEFORE INSERT ON iniop01t
    FOR EACH ROW EXECUTE FUNCTION iniop01t_fill_kind();

ALTER TABLE iniop01t ALTER COLUMN iniokind SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_iniop01t_iniokind') THEN
    ALTER TABLE iniop01t ADD CONSTRAINT ck_iniop01t_iniokind CHECK (
      (iniotype = 'ST' AND iniokind = 'ST')
      OR (iniotype = 'IN'  AND iniokind IN ('IN', 'PROCESS_IN', 'MOVE_IN'))
      OR (iniotype = 'OUT' AND iniokind IN ('OUT', 'PROCESS_OUT', 'MOVE_OUT')));
  END IF;
END $$;

-- 상세구분 필터 + 기간 조회 + 화면 정렬(일자·전표·순번)을 인덱스 하나로
CREATE INDEX IF NOT EXISTS ix_iniop01t_company_kind_date
    ON iniop01t (companyid, iniokind, iniodate, receiptno, lineno);

COMMIT;
