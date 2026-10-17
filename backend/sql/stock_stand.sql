CREATE TABLE IF NOT EXISTS StandStock01t (
    companyid VARCHAR(50) NOT NULL,
    companyname VARCHAR(50) NOT NULL,
    StandDate DATE NOT NULL,
    lineno INTEGER NOT NULL,
    itemcode VARCHAR(100) NOT NULL,
    itemname VARCHAR(150) NOT NULL,
    size VARCHAR(100),
    qty NUMERIC(15,3) CHECK (qty > 0),
    qtyunit VARCHAR(20) NOT NULL,
    weight NUMERIC(15,3) NOT NULL CHECK (weight > 0),
    warehousecode VARCHAR(50) NOT NULL,
    warehousecodename VARCHAR(50) NOT NULL,
    unit VARCHAR(20),
    unitprice NUMERIC(15,2) CHECK (unitprice >= 0),
    unitamt NUMERIC(15,2),
    description VARCHAR(500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ,
    PRIMARY KEY (companyid, lineno)
);

-- Remove the old auxiliary marker table; registration state is derived from StandStock01t.
DROP TABLE IF EXISTS StandStockSetup01t;

CREATE INDEX IF NOT EXISTS ix_standstock01t_company_date_line
    ON StandStock01t (companyid, StandDate, lineno);

CREATE INDEX IF NOT EXISTS ix_inbound02t_company_item_warehouse_receipt
    ON Inbound02t (companyid, itemcode, warehousecode, receiptno);

CREATE INDEX IF NOT EXISTS ix_outbound02t_company_item_warehouse_receipt
    ON Outbound02t (companyid, itemcode, warehousecode, receiptno);
