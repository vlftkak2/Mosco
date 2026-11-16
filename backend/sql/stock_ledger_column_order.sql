-- currentstock01t / iniop01t 컬럼 순서 정리 (등록·수정 일시/등록자/수정자를 맨 오른쪽으로)
-- PostgreSQL 은 컬럼 순서를 바꿀 수 없어 새 순서로 테이블을 만들고 데이터를 옮긴 뒤 이름을 바꾼다.
-- 인덱스·제약·트리거는 같은 이름으로 다시 만든다. 외래키·뷰·권한 설정은 없음(적용 전 확인).
-- costprice 는 numeric(15,3) 으로 함께 정의한다.
BEGIN;

-- currentstock01t
LOCK TABLE currentstock01t IN ACCESS EXCLUSIVE MODE;
CREATE TABLE currentstock01t__new (
    companyid character varying(50) NOT NULL,
    companyname character varying(50) NOT NULL,
    customcode character varying(50),
    customname character varying(100),
    sourcetype character varying(20) NOT NULL,
    sourceno character varying(100) NOT NULL,
    sourceline integer NOT NULL,
    stockkind character varying(10) DEFAULT 'INBOUND'::character varying NOT NULL,
    origintype character varying(20),
    originno character varying(100),
    originline integer,
    receiptdate date NOT NULL,
    itemcode character varying(100) NOT NULL,
    itemname character varying(150) NOT NULL,
    productname character varying(150),
    materialcode character varying(100) NOT NULL,
    materialname character varying(100) NOT NULL,
    surfacecode character varying(100),
    surfacename character varying(100),
    myrtle numeric(15,3),
    manager character varying(100),
    thickness numeric(15,3) DEFAULT 0 NOT NULL,
    width numeric(15,3) DEFAULT 0 NOT NULL,
    length numeric(15,3) DEFAULT 0 NOT NULL,
    originalqty numeric(15,3) NOT NULL,
    qty numeric(15,3) NOT NULL,
    qtyunit character varying(20) NOT NULL,
    originalweight numeric(15,3) NOT NULL,
    weight numeric(15,3) NOT NULL,
    unit character varying(20),
    unitprice numeric(15,2),
    costprice numeric(15,3) DEFAULT 0 NOT NULL,
    warehousecode character varying(50) NOT NULL,
    warehousecodename character varying(50) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone,
    created_by character varying(100),
    updated_by character varying(100)
);
INSERT INTO currentstock01t__new (companyid, companyname, customcode, customname, sourcetype, sourceno, sourceline, stockkind, origintype, originno, originline, receiptdate, itemcode, itemname, productname, materialcode, materialname, surfacecode, surfacename, myrtle, manager, thickness, width, length, originalqty, qty, qtyunit, originalweight, weight, unit, unitprice, costprice, warehousecode, warehousecodename, created_at, updated_at, created_by, updated_by)
SELECT companyid, companyname, customcode, customname, sourcetype, sourceno, sourceline, stockkind, origintype, originno, originline, receiptdate, itemcode, itemname, productname, materialcode, materialname, surfacecode, surfacename, myrtle, manager, thickness, width, length, originalqty, qty, qtyunit, originalweight, weight, unit, unitprice, costprice, warehousecode, warehousecodename, created_at, updated_at, created_by, updated_by FROM currentstock01t;
DROP TABLE currentstock01t;
ALTER TABLE currentstock01t__new RENAME TO currentstock01t;
ALTER TABLE currentstock01t ADD CONSTRAINT currentstock01t_pkey PRIMARY KEY (companyid, sourcetype, sourceno, sourceline);
ALTER TABLE currentstock01t ADD CONSTRAINT ck_currentstock01t_qty_range CHECK (((qty >= (0)::numeric) AND (qty <= originalqty) AND (weight <= originalweight)));
ALTER TABLE currentstock01t ADD CONSTRAINT ck_currentstock01t_stockkind CHECK (((stockkind)::text = ANY ((ARRAY['OPENING'::character varying, 'INBOUND'::character varying, 'PROCESS'::character varying, 'TRANSFER'::character varying])::text[])));
ALTER TABLE currentstock01t ADD CONSTRAINT currentstock01t_weight_check CHECK ((weight >= (0)::numeric));
CREATE INDEX ix_currentstock01t_company_available_item_warehouse ON currentstock01t USING btree (companyid, itemcode, warehousecode) WHERE (qty > (0)::numeric);
CREATE INDEX ix_currentstock01t_company_receiptdate ON currentstock01t USING btree (companyid, receiptdate DESC, sourcetype, sourceno, sourceline);
CREATE INDEX ix_currentstock01t_process_picker ON currentstock01t USING btree (companyid, receiptdate, sourcetype, sourceno, sourceline) WHERE ((qty > (0)::numeric) AND (weight > (0)::numeric));
CREATE INDEX ix_currentstock01t_search_trgm ON currentstock01t USING gin (itemcode gin_trgm_ops, itemname gin_trgm_ops, warehousecode gin_trgm_ops, warehousecodename gin_trgm_ops, customname gin_trgm_ops);
CREATE UNIQUE INDEX ux_currentstock01t_opening_line ON currentstock01t USING btree (companyid, sourceline) WHERE ((sourcetype)::text = 'OPENING'::text);
ANALYZE currentstock01t;

-- iniop01t
LOCK TABLE iniop01t IN ACCESS EXCLUSIVE MODE;
CREATE TABLE iniop01t__new (
    companyid character varying(50) NOT NULL,
    companyname character varying(50) NOT NULL,
    customcode character varying(50),
    customname character varying(100),
    iniodate date NOT NULL,
    iniotype character varying(50) NOT NULL,
    iniokind character varying(12) NOT NULL,
    receiptno character varying(100) NOT NULL,
    lineno integer NOT NULL,
    itemcode character varying(100) NOT NULL,
    itemname character varying(150) NOT NULL,
    productname character varying(150),
    materialcode character varying(100) NOT NULL,
    materialname character varying(100) NOT NULL,
    surfacecode character varying(100),
    surfacename character varying(100),
    myrtle numeric(15,3),
    manager character varying(100),
    thickness numeric(15,3) DEFAULT 0 NOT NULL,
    width numeric(15,3) DEFAULT 0 NOT NULL,
    length numeric(15,3) DEFAULT 0 NOT NULL,
    qty numeric(15,3) NOT NULL,
    qtyunit character varying(20) NOT NULL,
    unit character varying(20),
    unitprice numeric(15,2),
    supplyamt numeric(15,2),
    vat numeric(15,2),
    unitamt numeric(15,2),
    weight numeric(15,3) NOT NULL,
    warehousecode character varying(50) NOT NULL,
    warehousecodename character varying(50) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone,
    created_by character varying(100),
    updated_by character varying(100)
);
INSERT INTO iniop01t__new (companyid, companyname, customcode, customname, iniodate, iniotype, iniokind, receiptno, lineno, itemcode, itemname, productname, materialcode, materialname, surfacecode, surfacename, myrtle, manager, thickness, width, length, qty, qtyunit, unit, unitprice, supplyamt, vat, unitamt, weight, warehousecode, warehousecodename, created_at, updated_at, created_by, updated_by)
SELECT companyid, companyname, customcode, customname, iniodate, iniotype, iniokind, receiptno, lineno, itemcode, itemname, productname, materialcode, materialname, surfacecode, surfacename, myrtle, manager, thickness, width, length, qty, qtyunit, unit, unitprice, supplyamt, vat, unitamt, weight, warehousecode, warehousecodename, created_at, updated_at, created_by, updated_by FROM iniop01t;
DROP TABLE iniop01t;
ALTER TABLE iniop01t__new RENAME TO iniop01t;
ALTER TABLE iniop01t ADD CONSTRAINT iniop01t_pkey PRIMARY KEY (companyid, iniotype, receiptno, lineno);
ALTER TABLE iniop01t ADD CONSTRAINT ck_iniop01t_iniokind CHECK (((((iniotype)::text = 'ST'::text) AND ((iniokind)::text = 'ST'::text)) OR (((iniotype)::text = 'IN'::text) AND ((iniokind)::text = ANY ((ARRAY['IN'::character varying, 'PROCESS_IN'::character varying, 'MOVE_IN'::character varying])::text[]))) OR (((iniotype)::text = 'OUT'::text) AND ((iniokind)::text = ANY ((ARRAY['OUT'::character varying, 'PROCESS_OUT'::character varying, 'MOVE_OUT'::character varying])::text[])))));
ALTER TABLE iniop01t ADD CONSTRAINT iniop01t_unitprice_check CHECK ((unitprice >= (0)::numeric));
ALTER TABLE iniop01t ADD CONSTRAINT iniop01t_weight_check CHECK ((weight >= (0)::numeric));
CREATE INDEX ix_iniop01t_company_date_key ON iniop01t USING btree (companyid, iniodate, receiptno, lineno, iniotype);
CREATE INDEX ix_iniop01t_company_kind_date ON iniop01t USING btree (companyid, iniokind, iniodate, receiptno, lineno);
CREATE INDEX ix_iniop01t_search_trgm ON iniop01t USING gin (itemcode gin_trgm_ops, itemname gin_trgm_ops, productname gin_trgm_ops, customname gin_trgm_ops, warehousecode gin_trgm_ops, warehousecodename gin_trgm_ops);
CREATE TRIGGER trg_iniop01t_fill_kind BEFORE INSERT ON public.iniop01t FOR EACH ROW EXECUTE FUNCTION iniop01t_fill_kind();
ANALYZE iniop01t;

COMMIT;
