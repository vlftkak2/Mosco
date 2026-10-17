-- Inbound receipt header. PostgreSQL folds these unquoted names to lowercase.
CREATE TABLE IF NOT EXISTS Inbound01t (
    companyid VARCHAR(50) NOT NULL,
    companyname VARCHAR(50) NOT NULL,
    receiptno VARCHAR(100) NOT NULL,
    receptdate DATE NOT NULL,
    customcode VARCHAR(50) NOT NULL,
    customname VARCHAR(100),
    description VARCHAR(500),
    subulyn VARCHAR(10) DEFAULT 'N',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ,
    PRIMARY KEY (companyid, receiptno)
);

-- Detail lines are stored under the same company and receipt key.
CREATE TABLE IF NOT EXISTS Inbound02t (
    companyid VARCHAR(50) NOT NULL,
    companyname VARCHAR(50) NOT NULL,
    receiptno VARCHAR(100) NOT NULL,
    lineno INTEGER NOT NULL,
    itemcode VARCHAR(100) NOT NULL,
    itemname VARCHAR(150) NOT NULL,
    size VARCHAR(100),
    qty NUMERIC(15,3) CHECK (qty > 0), -- 수량(선택 입력)
    qtyunit VARCHAR(20) NOT NULL, -- 수량단위 코드
    warehousecode VARCHAR(50),
    warehousecodename VARCHAR(50),
    weight NUMERIC(15,3) NOT NULL CHECK (weight > 0), -- 입고중량
    unit VARCHAR(20) NOT NULL, -- 단가기준 코드(KG/TON)
    unitprice NUMERIC(15,2) NOT NULL CHECK (unitprice > 0), -- 매입단가
    unitamt NUMERIC(15,2),
    description VARCHAR(500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ,
    PRIMARY KEY (companyid, receiptno, lineno)
);

-- 기존 테이블에도 수량과 수량단위 코드를 저장할 수 있도록 컬럼을 추가합니다.
ALTER TABLE Inbound02t
    ADD COLUMN IF NOT EXISTS qty NUMERIC(15,3),
    ADD COLUMN IF NOT EXISTS qtyunit VARCHAR(20),
    ADD COLUMN IF NOT EXISTS warehousecode VARCHAR(50),
    ADD COLUMN IF NOT EXISTS warehousecodename VARCHAR(50);

-- Ensure zero or negative purchase prices cannot be added to existing installations.
ALTER TABLE Inbound02t
    DROP CONSTRAINT IF EXISTS inbound02t_unitprice_check;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'inbound02t'::regclass
          AND conname = 'inbound02t_unitprice_positive_check'
    ) THEN
        ALTER TABLE Inbound02t
            ADD CONSTRAINT inbound02t_unitprice_positive_check CHECK (unitprice > 0) NOT VALID;
    END IF;
END $$;

-- 이전 버전에서 quantityunit 이름으로 추가한 값이 있으면 새 qtyunit으로 옮깁니다.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'inbound02t'
          AND column_name = 'quantityunit'
    ) THEN
        EXECUTE 'UPDATE Inbound02t SET qtyunit = quantityunit WHERE qtyunit IS NULL';
    END IF;
END $$;

-- Supports tenant-scoped receipt searches ordered by receipt date.
CREATE INDEX IF NOT EXISTS ix_inbound01t_company_date
    ON Inbound01t (companyid, receptdate DESC, receiptno DESC);

-- Supports the ILIKE '%value%' filters in inbound registration and status queries.
-- PostgreSQL can combine these GIN indexes with the tenant/date B-tree indexes.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS ix_inbound01t_receiptno_trgm
    ON Inbound01t USING GIN (receiptno gin_trgm_ops);

CREATE INDEX IF NOT EXISTS ix_inbound01t_customcode_trgm
    ON Inbound01t USING GIN (customcode gin_trgm_ops);

CREATE INDEX IF NOT EXISTS ix_inbound01t_customname_trgm
    ON Inbound01t USING GIN (customname gin_trgm_ops);

CREATE INDEX IF NOT EXISTS ix_inbound02t_itemcode_trgm
    ON Inbound02t USING GIN (itemcode gin_trgm_ops);

CREATE INDEX IF NOT EXISTS ix_inbound02t_itemname_trgm
    ON Inbound02t USING GIN (itemname gin_trgm_ops);
