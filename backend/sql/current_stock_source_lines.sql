-- Run only after reviewing the existing CurrentStock01t data and its source history.
-- This schema migration never assigns an aggregate balance to an arbitrary source line.
-- Existing rows without source keys cause the transaction to abort without changing data.
BEGIN;

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
    thickness NUMERIC(15,3) NOT NULL DEFAULT 0,
    width NUMERIC(15,3) NOT NULL DEFAULT 0,
    length NUMERIC(15,3) NOT NULL DEFAULT 0,
    originalqty NUMERIC(15,3) NOT NULL,
    qty NUMERIC(15,3) NOT NULL,
    qtyunit VARCHAR(20) NOT NULL,
    originalweight NUMERIC(15,3) NOT NULL,
    weight NUMERIC(15,3) NOT NULL,
    unit VARCHAR(20),
    unitprice NUMERIC(15,2),
    warehousecode VARCHAR(50) NOT NULL,
    warehousecodename VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ,
    CONSTRAINT currentstock01t_pkey PRIMARY KEY (companyid, sourcetype, sourceno, sourceline),
    CONSTRAINT currentstock01t_source_type_check CHECK (sourcetype IN ('OPENING', 'INBOUND')),
    CONSTRAINT currentstock01t_source_qty_check CHECK (originalqty > 0 AND qty >= 0 AND qty <= originalqty),
    CONSTRAINT currentstock01t_source_weight_check CHECK (originalweight >= 0 AND weight >= 0 AND weight <= originalweight)
);

ALTER TABLE CurrentStock01t
    ADD COLUMN IF NOT EXISTS customcode VARCHAR(50),
    ADD COLUMN IF NOT EXISTS customname VARCHAR(100),
    ADD COLUMN IF NOT EXISTS sourcetype VARCHAR(20),
    ADD COLUMN IF NOT EXISTS sourceno VARCHAR(100),
    ADD COLUMN IF NOT EXISTS sourceline INTEGER,
    ADD COLUMN IF NOT EXISTS receiptdate DATE,
    ADD COLUMN IF NOT EXISTS originalqty NUMERIC(15,3),
    ADD COLUMN IF NOT EXISTS originalweight NUMERIC(15,3),
    ADD COLUMN IF NOT EXISTS unit VARCHAR(20),
    ADD COLUMN IF NOT EXISTS unitprice NUMERIC(15,2);

DO $$
DECLARE
    current_pk_name TEXT;
    current_pk_columns TEXT[];
BEGIN
    IF EXISTS (
        SELECT 1 FROM CurrentStock01t
        WHERE sourcetype IS NULL OR sourceno IS NULL OR sourceline IS NULL
           OR receiptdate IS NULL OR originalqty IS NULL OR originalweight IS NULL
    ) THEN
        RAISE EXCEPTION 'CurrentStock01t contains aggregate rows without source keys; review and migrate them separately';
    END IF;

    SELECT con.conname,
           ARRAY(SELECT att.attname
                 FROM unnest(con.conkey) WITH ORDINALITY AS key(attnum, position)
                 JOIN pg_attribute AS att ON att.attrelid = con.conrelid AND att.attnum = key.attnum
                 ORDER BY key.position)
      INTO current_pk_name, current_pk_columns
      FROM pg_constraint AS con
     WHERE con.conrelid = 'currentstock01t'::regclass AND con.contype = 'p';

    IF current_pk_columns IS DISTINCT FROM ARRAY['companyid', 'sourcetype', 'sourceno', 'sourceline']::TEXT[] THEN
        IF current_pk_name IS NOT NULL THEN
            EXECUTE format('ALTER TABLE CurrentStock01t DROP CONSTRAINT %I', current_pk_name);
        END IF;
        ALTER TABLE CurrentStock01t ADD CONSTRAINT currentstock01t_pkey
            PRIMARY KEY (companyid, sourcetype, sourceno, sourceline);
    END IF;
END $$;

ALTER TABLE CurrentStock01t
    ALTER COLUMN sourcetype SET NOT NULL,
    ALTER COLUMN sourceno SET NOT NULL,
    ALTER COLUMN sourceline SET NOT NULL,
    ALTER COLUMN receiptdate SET NOT NULL,
    ALTER COLUMN originalqty SET NOT NULL,
    ALTER COLUMN originalweight SET NOT NULL;

CREATE INDEX IF NOT EXISTS ix_currentstock01t_company_receiptdate
    ON CurrentStock01t (companyid, receiptdate DESC, sourcetype, sourceno, sourceline);
CREATE INDEX IF NOT EXISTS ix_currentstock01t_company_item_warehouse
    ON CurrentStock01t (companyid, itemcode, thickness, width, length, warehousecode, qtyunit);

COMMIT;
