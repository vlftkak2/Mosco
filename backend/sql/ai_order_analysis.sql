-- AI 주문서 분석 이력과 회사별 실제 사용량을 보관합니다.
-- 원본 파일 바이트와 OCR 원문은 저장하지 않고, 파일 SHA-256 및 분석 JSON만 저장합니다.
CREATE TABLE IF NOT EXISTS aiorderanalysis01t (
    request_id UUID PRIMARY KEY,
    companyid VARCHAR(50) NOT NULL,
    companyname VARCHAR(100) NOT NULL DEFAULT '',
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

CREATE INDEX IF NOT EXISTS ix_aiorderanalysis01t_company_created
    ON aiorderanalysis01t (companyid, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_aiorderanalysis01t_company_user_created
    ON aiorderanalysis01t (companyid, useremail, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_aiorderanalysis01t_cache_lookup
    ON aiorderanalysis01t (companyid, useremail, file_sha256, model, completed_at DESC)
    WHERE status = 'succeeded' AND extraction IS NOT NULL;

-- 회사(법인)별 분석 건수, 토큰, 실제 응답을 받은 요청의 추정 비용 확인 예시
-- SELECT companyid, companyname,
--        COUNT(*) AS request_count,
--        SUM(input_tokens) AS input_tokens,
--        SUM(output_tokens) AS output_tokens,
--        SUM(reasoning_tokens) AS reasoning_tokens,
--        SUM(estimated_cost_usd) AS estimated_cost_usd,
--        COUNT(*) FILTER (WHERE status = 'failed_unknown') AS unknown_cost_count
-- FROM aiorderanalysis01t
-- GROUP BY companyid, companyname
-- ORDER BY estimated_cost_usd DESC NULLS LAST;
