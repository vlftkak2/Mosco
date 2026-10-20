-- 매입 전표는 입고 전표와 분리합니다. 매입 저장 시 재고 수량은 변경하지 않습니다.
CREATE TABLE IF NOT EXISTS public.Purchase01t (
    companyid VARCHAR(50) NOT NULL,
    companyname VARCHAR(100) NOT NULL DEFAULT '',
    purchaseno VARCHAR(100) NOT NULL,
    receiptno VARCHAR(100), -- 선택 연결: 입고 전표 없이 매입만 등록 가능
    purchasedate DATE NOT NULL,
    customcode VARCHAR(50) NOT NULL,
    customname VARCHAR(150) NOT NULL,
    paymentterms VARCHAR(100) NOT NULL DEFAULT '',
    paymentduedate DATE,
    vattype VARCHAR(20) NOT NULL DEFAULT 'TAXABLE' CHECK (vattype IN ('TAXABLE', 'ZERO', 'EXEMPT')),
    freightamount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (freightamount >= 0),
    otheramount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (otheramount >= 0),
    goodsamount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (goodsamount >= 0),
    supplyamount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (supplyamount >= 0),
    vatamount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (vatamount >= 0),
    totalamount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (totalamount >= 0),
    description TEXT NOT NULL DEFAULT '',
    createdby VARCHAR(100) NOT NULL DEFAULT '',
    updatedby VARCHAR(100) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (companyid, purchaseno),
    UNIQUE (companyid, receiptno)
);

CREATE TABLE IF NOT EXISTS public.Purchase02t (
    companyid VARCHAR(50) NOT NULL,
    companyname VARCHAR(100) NOT NULL DEFAULT '',
    purchaseno VARCHAR(100) NOT NULL,
    lineno INTEGER NOT NULL CHECK (lineno > 0),
    inboundlineno INTEGER CHECK (inboundlineno > 0), -- 입고 연결 시 원본 행번호
    itemcode VARCHAR(100) NOT NULL,
    itemname VARCHAR(150) NOT NULL,
    size VARCHAR(100) NOT NULL DEFAULT '',
    steelgrade VARCHAR(100) NOT NULL DEFAULT '',
    thickness NUMERIC(15,3),
    width NUMERIC(15,3),
    length NUMERIC(15,3),
    qty NUMERIC(15,3) NOT NULL,
    qtyunit VARCHAR(20) NOT NULL,
    weight NUMERIC(15,3) NOT NULL,
    unit VARCHAR(20) NOT NULL,
    unitprice NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (unitprice >= 0),
    supplyamount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (supplyamount >= 0),
    warehousecode VARCHAR(50) NOT NULL DEFAULT '',
    warehousecodename VARCHAR(50) NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (companyid, purchaseno, lineno)
);

CREATE INDEX IF NOT EXISTS ix_purchase01t_company_date ON public.Purchase01t (companyid, purchasedate DESC, purchaseno DESC);

-- 기존 설치 환경의 무자료/기존자료 모두 보존하는 스키마 확장
ALTER TABLE public.Purchase01t ALTER COLUMN receiptno DROP NOT NULL;
ALTER TABLE public.Purchase02t ALTER COLUMN inboundlineno DROP NOT NULL;
ALTER TABLE public.Purchase02t ALTER COLUMN warehousecode SET DEFAULT '';
ALTER TABLE public.Purchase02t ALTER COLUMN warehousecodename SET DEFAULT '';
