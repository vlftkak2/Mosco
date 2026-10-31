-- Product numbers are stored in Process02t.productname and CurrentStock01t.productname.
-- Remove obsolete uniqueness/index artifacts and the temporary productno column.
DROP INDEX IF EXISTS ux_process02t_company_productno;
ALTER TABLE Process02t DROP COLUMN IF EXISTS productno;

-- Product numbers are suggestions derived from stored product rows; no sequence table is used.
DROP TABLE IF EXISTS ProcessProductSequence01t;

-- Allow the source product name, processing date, and suffix to be stored together.
ALTER TABLE CurrentStock01t ALTER COLUMN productname TYPE VARCHAR(150);
ALTER TABLE Iniop01t ALTER COLUMN productname TYPE VARCHAR(150);
