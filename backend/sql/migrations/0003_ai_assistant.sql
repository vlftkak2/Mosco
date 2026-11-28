-- 0003: AI 업무비서 (메뉴 AI_ASSISTANT · 모스코 전용) · 다시 실행해도 안전
--  aichatusage01t : 질문 1건 = 1행. 한도(일일 · 월 예산) · 동시 처리 · 비용 집계용. 질문 · 답 내용은 저장하지 않는다.
--                   주문서인식 사용량(aiorderusage01t)과 따로 센다 → 챗봇 사용이 주문서인식 예산을 줄이지 않는다.
--  달 경계 · 일자는 한국 시간(KST)으로 서버가 넣는다 (usage_day, usage_month).
--  감사 칸(createdat, updatedat)은 맨 오른쪽.

CREATE TABLE IF NOT EXISTS aichatusage01t (
    request_id          varchar(36)    NOT NULL PRIMARY KEY,
    companyid           varchar(50)    NOT NULL,
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

-- 한도 검사: 회사 · 달 (사용자 일일 · 회사 일일), 월 예산, 처리 중 건수
CREATE INDEX IF NOT EXISTS ix_aichatusage01t_company_month ON aichatusage01t (companyid, usage_month, usage_day);
CREATE INDEX IF NOT EXISTS ix_aichatusage01t_month ON aichatusage01t (usage_month);
CREATE INDEX IF NOT EXISTS ix_aichatusage01t_processing ON aichatusage01t (createdat) WHERE status = 'processing';

-- 메뉴: AI 업무비서 (모스코 전용 · 메뉴권한관리에서 모스코 직원에게 부여. 모스코 MASTER 는 부여 없이 사용)
INSERT INTO menucatalog01t (menuid, menuname, access_scope, assignable, sort_order, useyn) VALUES
    ('AI_ASSISTANT', 'AI 업무비서', 'PLATFORM', TRUE, 37, 'Y')
ON CONFLICT (menuid) DO NOTHING;
