CREATE TABLE IF NOT EXISTS CurrentStock01t (
    companyid VARCHAR(50) NOT NULL,
    companyname VARCHAR(50) NOT NULL,
    customcode VARCHAR(50),
    customname VARCHAR(100),
    sourcetype VARCHAR(20) NOT NULL,
    sourceno VARCHAR(100) NOT NULL,
    sourceline INTEGER NOT NULL,
    receiptdate DATE NOT NULL,
    itemcode VARCHAR(100) NOT NULL,
    itemname VARCHAR(150) NOT NULL,
    productname VARCHAR(100),
    materialcode VARCHAR(100) NOT NULL DEFAULT '',
    materialname VARCHAR(100) NOT NULL DEFAULT '',
    surfacecode VARCHAR(100),
    surfacename VARCHAR(100),
    myrtle NUMERIC(15,3),
    manager VARCHAR(100),
    thickness NUMERIC(15,3) NOT NULL DEFAULT 0,
    width NUMERIC(15,3) NOT NULL DEFAULT 0,
    length NUMERIC(15,3) NOT NULL DEFAULT 0,
    originalqty NUMERIC(15,3) NOT NULL,
    qty NUMERIC(15,3) NOT NULL,
    qtyunit VARCHAR(20) NOT NULL,
    originalweight NUMERIC(15,3) NOT NULL,
    weight NUMERIC(15,3) NOT NULL CHECK (weight >= 0),
    unit VARCHAR(20),
    unitprice NUMERIC(15,2),
    warehousecode VARCHAR(50) NOT NULL,
    warehousecodename VARCHAR(50) NOT NULL,
    stocksourcetype VARCHAR(20),
    stocksourceno VARCHAR(100),
    stocksourceline INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ,
    PRIMARY KEY (companyid, sourcetype, sourceno, sourceline)
);

CREATE TABLE IF NOT EXISTS Iniop01t (
    companyid VARCHAR(50) NOT NULL,
    companyname VARCHAR(50) NOT NULL,
    iniodate DATE NOT NULL,
    iniotype VARCHAR(50) NOT NULL,
    receiptno VARCHAR(100) NOT NULL,
    lineno INTEGER NOT NULL,
    itemcode VARCHAR(100) NOT NULL,
    itemname VARCHAR(150) NOT NULL,
    productname VARCHAR(100),
    materialcode VARCHAR(100) NOT NULL DEFAULT '',
    materialname VARCHAR(100) NOT NULL DEFAULT '',
    surfacecode VARCHAR(100),
    surfacename VARCHAR(100),
    myrtle NUMERIC(15,3),
    manager VARCHAR(100),
    thickness NUMERIC(15,3) NOT NULL DEFAULT 0,
    width NUMERIC(15,3) NOT NULL DEFAULT 0,
    length NUMERIC(15,3) NOT NULL DEFAULT 0,
    qty NUMERIC(15,3) NOT NULL,
    qtyunit VARCHAR(20) NOT NULL,
    weight NUMERIC(15,3) NOT NULL CHECK (weight >= 0),
    warehousecode VARCHAR(50) NOT NULL,
    warehousecodename VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ,
    PRIMARY KEY (companyid, iniotype, receiptno, lineno)
);

ALTER TABLE CurrentStock01t
    ADD COLUMN IF NOT EXISTS thickness NUMERIC(15,3) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS width NUMERIC(15,3) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS length NUMERIC(15,3) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS productname VARCHAR(100),
    ADD COLUMN IF NOT EXISTS materialcode VARCHAR(100) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS materialname VARCHAR(100) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS surfacecode VARCHAR(100),
    ADD COLUMN IF NOT EXISTS surfacename VARCHAR(100),
    ADD COLUMN IF NOT EXISTS myrtle NUMERIC(15,3),
    ADD COLUMN IF NOT EXISTS manager VARCHAR(100);

ALTER TABLE Iniop01t
    ADD COLUMN IF NOT EXISTS thickness NUMERIC(15,3) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS width NUMERIC(15,3) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS length NUMERIC(15,3) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS productname VARCHAR(100),
    ADD COLUMN IF NOT EXISTS materialcode VARCHAR(100) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS materialname VARCHAR(100) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS surfacecode VARCHAR(100),
    ADD COLUMN IF NOT EXISTS surfacename VARCHAR(100),
    ADD COLUMN IF NOT EXISTS myrtle NUMERIC(15,3),
    ADD COLUMN IF NOT EXISTS manager VARCHAR(100);

ALTER TABLE Iniop01t
    ADD COLUMN IF NOT EXISTS customcode VARCHAR(50) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS customname VARCHAR(100),
    ADD COLUMN IF NOT EXISTS stocksourcetype VARCHAR(20),
    ADD COLUMN IF NOT EXISTS stocksourceno VARCHAR(100),
    ADD COLUMN IF NOT EXISTS stocksourceline INTEGER;

-- Existing installations use current_stock_source_lines.sql after their source
-- history has been reviewed. Do not roll up or remove aggregate balances here.

DROP INDEX IF EXISTS ix_iniop01t_size_trgm;
ALTER TABLE Iniop01t DROP COLUMN IF EXISTS size;

UPDATE Iniop01t AS ledger
SET customcode = receipt.customcode,
    customname = receipt.customname
FROM Inbound01t AS receipt
WHERE ledger.companyid = receipt.companyid
  AND ledger.receiptno = receipt.receiptno
  AND ledger.iniotype = 'IN';

UPDATE Iniop01t AS ledger
SET iniodate = receipt.receptdate,
    customcode = detail.customcode,
    customname = detail.customname
FROM Inbound02t AS detail
JOIN Inbound01t AS receipt
  ON receipt.companyid = detail.companyid
 AND receipt.receiptno = detail.receiptno
WHERE ledger.companyid = detail.companyid
  AND ledger.receiptno = detail.receiptno
  AND ledger.lineno = detail.lineno
  AND ledger.iniotype = 'IN';

UPDATE Iniop01t AS ledger
SET customcode = receipt.customcode,
    customname = receipt.customname
FROM Outbound01t AS receipt
WHERE ledger.companyid = receipt.companyid
  AND ledger.receiptno = receipt.receiptno
  AND ledger.iniotype = 'OUT';

DROP INDEX IF EXISTS ix_currentstock01t_company_item;
DROP INDEX IF EXISTS ix_iniop01t_company_item;
DROP INDEX IF EXISTS ix_currentstock01t_dimensions;
DROP INDEX IF EXISTS ix_iniop01t_dimensions;

CREATE INDEX IF NOT EXISTS ix_currentstock01t_company_warehouse
    ON CurrentStock01t (companyid, warehousecode, itemcode);

CREATE INDEX IF NOT EXISTS ix_iniop01t_company_date
    ON Iniop01t (companyid, iniodate DESC, iniotype, receiptno, lineno);

CREATE INDEX IF NOT EXISTS ix_iniop01t_company_item
    ON Iniop01t (companyid, itemcode, thickness, width, length, warehousecode, qtyunit);

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS ix_currentstock01t_itemcode_trgm
    ON CurrentStock01t USING GIN (itemcode gin_trgm_ops);

CREATE INDEX IF NOT EXISTS ix_currentstock01t_itemname_trgm
    ON CurrentStock01t USING GIN (itemname gin_trgm_ops);

CREATE INDEX IF NOT EXISTS ix_currentstock01t_dimensions
    ON CurrentStock01t (companyid, thickness, width, length);

CREATE INDEX IF NOT EXISTS ix_currentstock01t_warehousecode_trgm
    ON CurrentStock01t USING GIN (warehousecode gin_trgm_ops);

CREATE INDEX IF NOT EXISTS ix_currentstock01t_warehousecodename_trgm
    ON CurrentStock01t USING GIN (warehousecodename gin_trgm_ops);

CREATE INDEX IF NOT EXISTS ix_iniop01t_receiptno_trgm
    ON Iniop01t USING GIN (receiptno gin_trgm_ops);

CREATE INDEX IF NOT EXISTS ix_iniop01t_customcode_trgm
    ON Iniop01t USING GIN (customcode gin_trgm_ops);

CREATE INDEX IF NOT EXISTS ix_iniop01t_customname_trgm
    ON Iniop01t USING GIN (customname gin_trgm_ops);

CREATE INDEX IF NOT EXISTS ix_iniop01t_itemcode_trgm
    ON Iniop01t USING GIN (itemcode gin_trgm_ops);

CREATE INDEX IF NOT EXISTS ix_iniop01t_itemname_trgm
    ON Iniop01t USING GIN (itemname gin_trgm_ops);

CREATE INDEX IF NOT EXISTS ix_iniop01t_dimensions
    ON Iniop01t (companyid, thickness, width, length);

CREATE INDEX IF NOT EXISTS ix_iniop01t_warehousecode_trgm
    ON Iniop01t USING GIN (warehousecode gin_trgm_ops);

CREATE INDEX IF NOT EXISTS ix_iniop01t_warehousecodename_trgm
    ON Iniop01t USING GIN (warehousecodename gin_trgm_ops);
