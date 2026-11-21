-- 거래처 사업자 유형: 법인(CORP) / 개인(INDIV). 사업장관리(company01t.ownertype)와 같은 값.
--   개인이면 법인번호를 쓰지 않는다 (서버 저장 때 비운다).
--   기존 거래처는 법인(CORP)으로 채우고, 법인번호가 없고 사업자번호만 있는 거래처는 그대로 둔다 (담당자가 화면에서 고친다).

ALTER TABLE public.customer01t ADD COLUMN IF NOT EXISTS ownertype character varying(10) NOT NULL DEFAULT 'CORP';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customer01t_ownertype_check') THEN
        ALTER TABLE public.customer01t
            ADD CONSTRAINT customer01t_ownertype_check CHECK (ownertype IN ('CORP', 'INDIV'));
    END IF;
END $$;
