-- AI 호출 한도 · AI 비용현황 (2026-11-28) · 여러 번 실행해도 같은 결과
--  company_ai_quota01t.monthly_limit : 고객사별 AI 월 호출 한도 (이번 달 성공한 AI 분석 건수 기준, 비우면 제한 없음)
--                                      고객사등록에서 입력. 실패한 분석은 비용이 0이라 횟수에서 빠진다.
--  AI 비용현황(AI_COST)              : aiorderanalysis01t 를 회사 · 월별로 집계 (모스코 전용 메뉴)
--  등록 · 수정 칸(createdat, updatedat, created_by, updated_by)은 테이블 맨 오른쪽에 둔다.
BEGIN;

CREATE TABLE IF NOT EXISTS company_ai_quota01t (
    companyid     varchar(50)  NOT NULL PRIMARY KEY REFERENCES company01t (companyid) ON DELETE CASCADE,
    monthly_limit integer,                              -- AI 월 호출 한도 (NULL = 제한 없음, 0 = 사용 안 함)
    createdat     timestamptz  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedat     timestamptz,
    created_by    varchar(100),
    updated_by    varchar(100),
    CONSTRAINT company_ai_quota01t_limit_check CHECK (monthly_limit IS NULL OR monthly_limit BETWEEN 0 AND 1000000)
);

-- 회사 · 기간 집계 (AI 비용현황 · 이번 달 호출 건수)
CREATE INDEX IF NOT EXISTS aiorderanalysis01t_company_created_idx ON aiorderanalysis01t (companyid, created_at);

-- 메뉴: AI 비용현황 (모스코 전용 · 라이선스 매출현황 권한이 있는 직원에게 처음 한 번 부여)
INSERT INTO menucatalog01t (menuid, menuname, access_scope, assignable, sort_order, useyn) VALUES
    ('AI_COST', 'AI 비용현황', 'PLATFORM', TRUE, 35, 'Y')
ON CONFLICT (menuid) DO NOTHING;
INSERT INTO usermenupermission01t (companyid, useremail, menuid, useyn, createdby)
SELECT p.companyid, p.useremail, 'AI_COST', 'Y', 'ai-cost-migration-20261128'
  FROM usermenupermission01t p
 WHERE p.companyid = '001' AND p.menuid = 'LICENSE_REVENUE' AND UPPER(COALESCE(p.useyn, 'N')) = 'Y'
ON CONFLICT (companyid, useremail, menuid) DO NOTHING;

COMMIT;
