-- Tenant-scoped ordering and lookup indexes for outbound receipts.
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
