-- Tenant-scoped ordering and lookup indexes for outbound receipts.
ALTER TABLE Outbound02t
    ADD COLUMN IF NOT EXISTS thickness NUMERIC(15,3),
    ADD COLUMN IF NOT EXISTS width NUMERIC(15,3),
    ADD COLUMN IF NOT EXISTS length NUMERIC(15,3),
    ADD COLUMN IF NOT EXISTS stocksourcetype VARCHAR(20),
    ADD COLUMN IF NOT EXISTS stocksourceno VARCHAR(100),
    ADD COLUMN IF NOT EXISTS stocksourceline INTEGER,
    ADD COLUMN IF NOT EXISTS productname VARCHAR(100),
    ADD COLUMN IF NOT EXISTS surfacecode VARCHAR(100),
    ADD COLUMN IF NOT EXISTS surfacename VARCHAR(100),
    ADD COLUMN IF NOT EXISTS materialcode VARCHAR(100) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS materialname VARCHAR(100) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS myrtle NUMERIC(15,3),
    ADD COLUMN IF NOT EXISTS supplyamt NUMERIC(15,2),
    ADD COLUMN IF NOT EXISTS vat NUMERIC(15,2),
    ADD COLUMN IF NOT EXISTS manager VARCHAR(100);

-- Existing outbound rows have no reliable source allocation. Keep the new source
-- keys nullable for those rows; new API saves always provide all three values.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'outbound02t_source_type_check') THEN
        ALTER TABLE Outbound02t ADD CONSTRAINT outbound02t_source_type_check
            CHECK (stocksourcetype IN ('OPENING', 'INBOUND')) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'outbound02t_source_line_check') THEN
        ALTER TABLE Outbound02t ADD CONSTRAINT outbound02t_source_line_check
            CHECK (stocksourceline > 0) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'outbound02t_source_stock_fk') THEN
        ALTER TABLE Outbound02t ADD CONSTRAINT outbound02t_source_stock_fk
            FOREIGN KEY (companyid, stocksourcetype, stocksourceno, stocksourceline)
            REFERENCES CurrentStock01t (companyid, sourcetype, sourceno, sourceline)
            ON DELETE RESTRICT NOT VALID;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_outbound02t_stock_source
    ON Outbound02t (companyid, stocksourcetype, stocksourceno, stocksourceline);

CREATE INDEX IF NOT EXISTS ix_outbound01t_company_date
    ON Outbound01t (companyid, receptdate DESC, receiptno DESC);

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS ix_outbound01t_receiptno_trgm
    ON Outbound01t USING GIN (receiptno gin_trgm_ops);
CREATE INDEX IF NOT EXISTS ix_outbound01t_customcode_trgm
    ON Outbound01t USING GIN (customcode gin_trgm_ops);
CREATE INDEX IF NOT EXISTS ix_outbound01t_customname_trgm
    ON Outbound01t USING GIN (customname gin_trgm_ops);
CREATE INDEX IF NOT EXISTS ix_outbound02t_itemcode_trgm
    ON Outbound02t USING GIN (itemcode gin_trgm_ops);
CREATE INDEX IF NOT EXISTS ix_outbound02t_itemname_trgm
    ON Outbound02t USING GIN (itemname gin_trgm_ops);
