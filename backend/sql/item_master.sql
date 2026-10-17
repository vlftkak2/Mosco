-- ItemCode01t schema used by backend/ItemMaster.py.
-- PostgreSQL folds this unquoted identifier to itemcode01t.
CREATE TABLE IF NOT EXISTS ItemCode01t (
    companyid VARCHAR(50) NOT NULL,
    companyname VARCHAR(50) NOT NULL,
    itemcode VARCHAR(100) NOT NULL,
    itemname VARCHAR(150) NOT NULL,
    itemtypecode VARCHAR(100),
    use_yn CHAR(10) NOT NULL DEFAULT 'Y',
    description VARCHAR(500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ,
    PRIMARY KEY (companyid, itemcode)
);

-- Supports the item-code/name substring search used by ItemMaster_routes.py.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS ix_itemcode01t_itemcode_trgm
    ON ItemCode01t USING GIN (itemcode gin_trgm_ops);

CREATE INDEX IF NOT EXISTS ix_itemcode01t_itemname_trgm
    ON ItemCode01t USING GIN (itemname gin_trgm_ops);
