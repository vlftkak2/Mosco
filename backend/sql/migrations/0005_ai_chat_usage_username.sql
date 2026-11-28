-- 0005: aichatusage01t 에 username 추가 (aiorderanalysis01t 처럼 user_email 바로 앞)
--  ADD COLUMN 은 맨 끝(감사 칸 뒤)에 붙으므로 새 구조로 만들고 기존 행을 옮긴다 (행이 있어도 안전 · 한 트랜잭션).
--  기존 행의 username 은 직원 정보(user01t)의 지금 이름으로 채운다 (없으면 빈 문자열).

ALTER TABLE aichatusage01t RENAME TO aichatusage01t_old;
ALTER TABLE aichatusage01t_old RENAME CONSTRAINT aichatusage01t_pkey TO aichatusage01t_old_pkey;
DROP INDEX IF EXISTS ix_aichatusage01t_company_month;
DROP INDEX IF EXISTS ix_aichatusage01t_month;
DROP INDEX IF EXISTS ix_aichatusage01t_processing;

CREATE TABLE aichatusage01t (
    request_id          varchar(36)    NOT NULL PRIMARY KEY,
    companyid           varchar(50)    NOT NULL,
    companyname         varchar(100)   NOT NULL DEFAULT '',
    username            varchar(100)   NOT NULL DEFAULT '',
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

INSERT INTO aichatusage01t
    (request_id, companyid, companyname, username, user_email, usage_day, usage_month, status, model,
     reserved_usd, estimated_cost_usd, input_tokens, cached_input_tokens, output_tokens, reasoning_tokens,
     api_calls, tool_names, error_type, createdat, updatedat)
SELECT o.request_id, o.companyid, o.companyname, LEFT(COALESCE(u.username, ''), 100), o.user_email, o.usage_day, o.usage_month,
       o.status, o.model, o.reserved_usd, o.estimated_cost_usd, o.input_tokens, o.cached_input_tokens, o.output_tokens,
       o.reasoning_tokens, o.api_calls, o.tool_names, o.error_type, o.createdat, o.updatedat
  FROM aichatusage01t_old o
  LEFT JOIN user01t u ON u.companyid = o.companyid AND u.email = o.user_email;

DROP TABLE aichatusage01t_old;

-- 한도 검사: 회사 · 달 (사용자 일일 · 회사 일일), 월 예산 · AI 비용현황 기간 조회, 처리 중 건수
CREATE INDEX ix_aichatusage01t_company_month ON aichatusage01t (companyid, usage_month, usage_day);
CREATE INDEX ix_aichatusage01t_month ON aichatusage01t (usage_month);
CREATE INDEX ix_aichatusage01t_processing ON aichatusage01t (createdat) WHERE status = 'processing';
