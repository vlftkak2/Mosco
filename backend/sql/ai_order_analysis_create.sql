-- 실제 public.aiorderanalysis01t의 컬럼, 기본값, 제약조건, 인덱스를 기준으로 작성했습니다.
-- username만 useremail 앞에 배치했습니다. 기존 테이블이 있으면 먼저 정리한 후 실행하세요.
CREATE TABLE public.aiorderanalysis01t (
    companyid VARCHAR(50) NOT NULL,
    companyname VARCHAR(100) NOT NULL DEFAULT '',
    request_id UUID PRIMARY KEY,
    username VARCHAR(100) NOT NULL DEFAULT '',
    useremail VARCHAR(255) NOT NULL,
    sourcefilename VARCHAR(255) NOT NULL,
    file_sha256 CHAR(64) NOT NULL,
    model VARCHAR(100) NOT NULL,
    status VARCHAR(30) NOT NULL CHECK (
        status IN ('processing', 'response_received', 'succeeded', 'failed_unknown', 'invalid_output')
    ),
    input_tokens BIGINT NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
    output_tokens BIGINT NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
    reasoning_tokens BIGINT NOT NULL DEFAULT 0 CHECK (reasoning_tokens >= 0),
    cached_input_tokens BIGINT NOT NULL DEFAULT 0 CHECK (cached_input_tokens >= 0),
    reserved_cost_usd NUMERIC(15, 8) NOT NULL DEFAULT 0 CHECK (reserved_cost_usd >= 0),
    estimated_cost_usd NUMERIC(15, 8) CHECK (estimated_cost_usd IS NULL OR estimated_cost_usd >= 0),
    extraction JSONB,
    error_type VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMPTZ
);

CREATE INDEX ix_aiorderanalysis01t_company_created
    ON public.aiorderanalysis01t (companyid, created_at DESC);

CREATE INDEX ix_aiorderanalysis01t_company_user_created
    ON public.aiorderanalysis01t (companyid, useremail, created_at DESC);
