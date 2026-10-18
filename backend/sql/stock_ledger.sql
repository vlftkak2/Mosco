CREATE TABLE IF NOT EXISTS CurrentStock01t (
    companyid VARCHAR(50) NOT NULL,
    companyname VARCHAR(50) NOT NULL,
    itemcode VARCHAR(100) NOT NULL,
    itemname VARCHAR(150) NOT NULL,
    size VARCHAR(100) NOT NULL DEFAULT '',
    qty NUMERIC(15,3) NOT NULL,
    qtyunit VARCHAR(20) NOT NULL,
    weight NUMERIC(15,3) NOT NULL CHECK (weight >= 0),
    warehousecode VARCHAR(50) NOT NULL,
    warehousecodename VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ,
    PRIMARY KEY (companyid, itemcode, size, warehousecode, qtyunit)
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
    size VARCHAR(100) NOT NULL DEFAULT '',
    qty NUMERIC(15,3) NOT NULL,
    qtyunit VARCHAR(20) NOT NULL,
    weight NUMERIC(15,3) NOT NULL CHECK (weight >= 0),
    warehousecode VARCHAR(50) NOT NULL,
    warehousecodename VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ,
    PRIMARY KEY (companyid, iniotype, receiptno, lineno)
);

ALTER TABLE Iniop01t
    ADD COLUMN IF NOT EXISTS size VARCHAR(100) NOT NULL DEFAULT '';

ALTER TABLE Iniop01t
    ADD COLUMN IF NOT EXISTS customcode VARCHAR(50) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS customname VARCHAR(100);

UPDATE Iniop01t AS ledger
SET customcode = receipt.customcode,
    customname = receipt.customname
FROM Inbound01t AS receipt
WHERE ledger.companyid = receipt.companyid
  AND ledger.receiptno = receipt.receiptno
  AND ledger.iniotype = 'IN';

UPDATE Iniop01t AS ledger
SET customcode = receipt.customcode,
    customname = receipt.customname
FROM Outbound01t AS receipt
WHERE ledger.companyid = receipt.companyid
  AND ledger.receiptno = receipt.receiptno
  AND ledger.iniotype = 'OUT';

CREATE INDEX IF NOT EXISTS ix_currentstock01t_company_item
    ON CurrentStock01t (companyid, itemcode, size, warehousecode, qtyunit);

CREATE INDEX IF NOT EXISTS ix_currentstock01t_company_warehouse
    ON CurrentStock01t (companyid, warehousecode, itemcode);

CREATE INDEX IF NOT EXISTS ix_iniop01t_company_date
    ON Iniop01t (companyid, iniodate DESC, iniotype, receiptno, lineno);

CREATE INDEX IF NOT EXISTS ix_iniop01t_company_item
    ON Iniop01t (companyid, itemcode, size, warehousecode, qtyunit);

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS ix_currentstock01t_itemcode_trgm
    ON CurrentStock01t USING GIN (itemcode gin_trgm_ops);

CREATE INDEX IF NOT EXISTS ix_currentstock01t_itemname_trgm
    ON CurrentStock01t USING GIN (itemname gin_trgm_ops);

CREATE INDEX IF NOT EXISTS ix_currentstock01t_size_trgm
    ON CurrentStock01t USING GIN (size gin_trgm_ops);

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

CREATE INDEX IF NOT EXISTS ix_iniop01t_size_trgm
    ON Iniop01t USING GIN (size gin_trgm_ops);

CREATE INDEX IF NOT EXISTS ix_iniop01t_warehousecode_trgm
    ON Iniop01t USING GIN (warehousecode gin_trgm_ops);

CREATE INDEX IF NOT EXISTS ix_iniop01t_warehousecodename_trgm
    ON Iniop01t USING GIN (warehousecodename gin_trgm_ops);
