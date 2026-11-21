-- 매출등록: 매출 기본(헤더)에 착지 칸 추가
--   outbound01t.destination = 착지 (납품 주소). 송장 출력 시 '받는 곳' 주소로 쓴다 (비어 있으면 거래처 주소).
-- 등록·수정 정보(created_at, updated_at, created_by, updated_by)가 맨 끝에 오도록 표를 다시 만든다.
--   (지금은 manager 가 created_at 과 created_by 사이에 있어 함께 앞으로 옮긴다)
-- outbound03t(기타비용)가 outbound01t 를 FK 로 참조하므로 FK 를 잠시 내렸다가 다시 건다.

BEGIN;

CREATE TABLE public.outbound01t__new (
    companyid character varying(50) NOT NULL,
    companyname character varying(50) NOT NULL,
    receiptno character varying(100) NOT NULL,
    receptdate date NOT NULL,
    customcode character varying(50) NOT NULL,
    customname character varying(100),
    manager character varying(100),
    destination character varying(500),
    description character varying(500),
    subulyn character varying(10) DEFAULT 'N'::character varying,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone,
    created_by character varying(100),
    updated_by character varying(100)
);

INSERT INTO public.outbound01t__new
    (companyid, companyname, receiptno, receptdate, customcode, customname, manager, destination,
     description, subulyn, created_at, updated_at, created_by, updated_by)
SELECT companyid, companyname, receiptno, receptdate, customcode, customname, manager, NULL,
       description, subulyn, created_at, updated_at, created_by, updated_by
FROM public.outbound01t;

ALTER TABLE public.outbound03t DROP CONSTRAINT outbound03t_companyid_receiptno_fkey;
DROP TABLE public.outbound01t;
ALTER TABLE public.outbound01t__new RENAME TO outbound01t;

ALTER TABLE public.outbound01t ADD CONSTRAINT outbound01t_pkey PRIMARY KEY (companyid, receiptno);
CREATE INDEX ix_outbound01t_company_date ON public.outbound01t USING btree (companyid, receptdate DESC, receiptno DESC);
CREATE INDEX ix_outbound01t_search_trgm ON public.outbound01t USING gin (receiptno gin_trgm_ops, customcode gin_trgm_ops, customname gin_trgm_ops);
ALTER TABLE public.outbound03t ADD CONSTRAINT outbound03t_companyid_receiptno_fkey
    FOREIGN KEY (companyid, receiptno) REFERENCES public.outbound01t(companyid, receiptno) ON DELETE CASCADE;

COMMENT ON COLUMN public.outbound01t.destination IS '착지 (송장 받는 곳 주소)';
COMMENT ON COLUMN public.outbound01t.created_by IS '등록자';
COMMENT ON COLUMN public.outbound01t.updated_by IS '수정자';

ANALYZE public.outbound01t;

COMMIT;
