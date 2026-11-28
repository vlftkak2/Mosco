-- 0004: aichatusage01t 에 companyname 추가 (다른 테이블과 같이 companyid 바로 오른쪽)
--  ADD COLUMN 은 맨 끝(감사 칸 뒤)에 붙으므로, 0003 에서 막 만든 빈 테이블을 같은 구조 + companyname 으로 다시 만든다.
--  안전장치: 이미 행이 있으면 아무것도 지우지 않고 멈춘다 (그때는 따로 옮기는 마이그레이션을 쓴다).

DO $$
BEGIN
    IF to_regclass('public.aichatusage01t') IS NOT NULL AND EXISTS (SELECT 1 FROM aichatusage01t) THEN
        RAISE EXCEPTION 'aichatusage01t has rows; refusing to recreate (write a data-preserving migration instead)';
    END IF;
END
$$;

DROP TABLE IF EXISTS aichatusage01t;

CREATE TABLE aichatusage01t (
    request_id          varchar(36)    NOT NULL PRIMARY KEY,
    companyid           varchar(50)    NOT NULL,
    companyname         varchar(100)   NOT NULL DEFAULT '',
    user_email          varchar(100)   NOT NULL,
    usage_day           date           NOT NULL,                 -- KST
    usage_month         date           NOT NULL,                 -- KST 그달 1일
    status              varchar(20)    NOT NULL,                 -- processing / complete / failed
    model               varchar(50)    NOT NULL,
    reserved_usd        numeric(12, 6) NOT NULL DEFAULT 0,       -- 처리 중 예약 금액 (끝나면 0)
    estimated_cost_usd  numeric(12, 6) NOT NULL DEFAULT 0,       -- 토큰 × 단가 추정 비용
    input_tokens        integer        NOT NULL DEFAULT 0,
    cached_input_tokens integer        NOT NULL DEFAULT 0,
    output_tokens       integer        NOT NULL DEFAULT 0,
    reasoning_tokens    integer        NOT NULL DEFAULT 0,
    api_calls           integer        NOT NULL DEFAULT 0,       -- 질문 1건 안의 OpenAI 호출 수 (도구 단계 포함)
    tool_names          varchar(300),                            -- 사용한 조회 도구 (예: outbound_summary,stock_summary)
    error_type          varchar(100),
    createdat           timestamptz    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedat           timestamptz,
    CONSTRAINT aichatusage01t_status_check CHECK (status IN ('processing', 'complete', 'failed')),
    CONSTRAINT aichatusage01t_tokens_check CHECK (input_tokens >= 0 AND cached_input_tokens >= 0 AND output_tokens >= 0
                                                  AND reasoning_tokens >= 0 AND api_calls >= 0)
);

-- 한도 검사: 회사 · 달 (사용자 일일 · 회사 일일), 월 예산 · AI 비용현황 기간 조회, 처리 중 건수
CREATE INDEX IF NOT EXISTS ix_aichatusage01t_company_month ON aichatusage01t (companyid, usage_month, usage_day);
CREATE INDEX IF NOT EXISTS ix_aichatusage01t_month ON aichatusage01t (usage_month);
CREATE INDEX IF NOT EXISTS ix_aichatusage01t_processing ON aichatusage01t (createdat) WHERE status = 'processing';
