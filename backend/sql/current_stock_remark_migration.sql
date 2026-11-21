-- 현재고 비고: 재고 로트(원천전표 · 순번)마다 담당자가 적는 메모
--   remark            : 비고 (최대 500자)
--   remark_updated_at : 비고를 마지막으로 고친 시각
--   remark_updated_by : 비고를 마지막으로 고친 사람 (이메일)
-- 재고 수량 · 원가 수정 정보(updated_at · updated_by)와 섞이지 않게 따로 둔다.
-- 조회조건 '비고' 부분 검색이 많아져도 빠르도록 trigram 인덱스를 둔다 (비고가 있는 행만).

ALTER TABLE public.CurrentStock01t ADD COLUMN IF NOT EXISTS remark character varying(500);
ALTER TABLE public.CurrentStock01t ADD COLUMN IF NOT EXISTS remark_updated_at timestamp with time zone;
ALTER TABLE public.CurrentStock01t ADD COLUMN IF NOT EXISTS remark_updated_by character varying(100);

CREATE INDEX IF NOT EXISTS ix_currentstock01t_remark_trgm
    ON public.CurrentStock01t USING gin (remark gin_trgm_ops)
    WHERE remark IS NOT NULL;
