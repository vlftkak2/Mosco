-- 매출등록: 조정(Kg) 칸 추가
--   outbound02t.weight    = 총중량 (현재고·수불장·원가·매출금액이 쓰는 값, 기존과 같음)
--   outbound02t.adjweight = 조정(Kg) (+/-). 화면의 중량 = weight - adjweight
-- 등록·수정 정보(created_at, updated_at, created_by, updated_by)가 맨 끝에 오도록 표를 다시 만든다.
-- 기존 행은 adjweight = 0 이므로 중량 = 총중량 그대로.

BEGIN;

CREATE TABLE public.outbound02t__new (
    companyid character varying(50) NOT NULL,
    companyname character varying(50) NOT NULL,
    receiptno character varying(100) NOT NULL,
    lineno integer NOT NULL,
    stocksourcetype character varying(20) NOT NULL,
    stocksourceno character varying(100) NOT NULL,
    stocksourceline integer NOT NULL,
    itemcode character varying(100) NOT NULL,
    itemname character varying(150) NOT NULL,
    productname character varying(100),
    surfacecode character varying(100),
    surfacename character varying(100),
    materialcode character varying(100) NOT NULL,
    materialname character varying(100) NOT NULL,
    myrtle numeric(15,3),
    thickness numeric(15,3),
    width numeric(15,3),
    length numeric(15,3),
    qty numeric(15,3),
    qtyunit character varying(20) NOT NULL,
    weight numeric(15,3) NOT NULL,
    adjweight numeric(15,3) DEFAULT 0 NOT NULL,
    unit character varying(20) NOT NULL,
    unitprice numeric(15,2) NOT NULL,
    supplyamt numeric(15,2),
    vat numeric(15,2),
    unitamt numeric(15,2),
    warehousecode character varying(50),
    warehousecodename character varying(50),
    description character varying(500),
    manager character varying(100),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone,
    created_by character varying(100),
    updated_by character varying(100),
    CONSTRAINT outbound02t_qty_check CHECK ((qty > (0)::numeric)),
    CONSTRAINT outbound02t_unitprice_check CHECK ((unitprice >= (0)::numeric)),
    CONSTRAINT outbound02t_weight_check CHECK ((weight > (0)::numeric)),
    -- 조정 전 중량(= 총중량 - 조정)도 0보다 커야 한다
    CONSTRAINT outbound02t_adjweight_check CHECK ((weight - adjweight > (0)::numeric))
);

INSERT INTO public.outbound02t__new (
    companyid, companyname, receiptno, lineno, stocksourcetype, stocksourceno, stocksourceline,
    itemcode, itemname, productname, surfacecode, surfacename, materialcode, materialname,
    myrtle, thickness, width, length, qty, qtyunit, weight, adjweight, unit, unitprice,
    supplyamt, vat, unitamt, warehousecode, warehousecodename, description, manager,
    created_at, updated_at, created_by, updated_by)
SELECT companyid, companyname, receiptno, lineno, stocksourcetype, stocksourceno, stocksourceline,
       itemcode, itemname, productname, surfacecode, surfacename, materialcode, materialname,
       myrtle, thickness, width, length, qty, qtyunit, weight, 0, unit, unitprice,
       supplyamt, vat, unitamt, warehousecode, warehousecodename, description, manager,
       created_at, updated_at, created_by, updated_by
FROM public.outbound02t;

DROP TABLE public.outbound02t;
ALTER TABLE public.outbound02t__new RENAME TO outbound02t;
ALTER TABLE public.outbound02t OWNER TO postgres;

ALTER TABLE ONLY public.outbound02t ADD CONSTRAINT outbound02t_pkey PRIMARY KEY (companyid, receiptno, lineno);
CREATE INDEX ix_outbound02t_company_item_wh ON public.outbound02t USING btree (companyid, itemcode, COALESCE(warehousecode, ''::character varying));
CREATE INDEX ix_outbound02t_search_trgm ON public.outbound02t USING gin (itemcode public.gin_trgm_ops, itemname public.gin_trgm_ops, warehousecode public.gin_trgm_ops, warehousecodename public.gin_trgm_ops);
CREATE INDEX ix_outbound02t_stock_source ON public.outbound02t USING btree (companyid, stocksourcetype, stocksourceno, stocksourceline);

COMMENT ON COLUMN public.outbound02t.weight IS '총중량 (중량 + 조정, 현재고·수불장 반영)';
COMMENT ON COLUMN public.outbound02t.adjweight IS '조정(Kg)';
COMMENT ON COLUMN public.outbound02t.created_by IS '등록자';
COMMENT ON COLUMN public.outbound02t.updated_by IS '수정자';

ANALYZE public.outbound02t;

COMMIT;
