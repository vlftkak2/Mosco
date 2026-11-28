-- 급여 지급항목 설정 (2026-11-28) · 여러 번 실행해도 같은 결과 · 0009 다음
--  pay_item01t: 회사별로 쓰는 지급항목 (급여입력 > 지급항목 설정에서 체크)
--   - 회사에 행이 하나도 없으면 모든 지급항목을 쓴다 (처음 상태)
--   - 기본급(pay_base)은 항상 쓴다
--   - 쓰지 않는 항목도 이미 금액이 있는 급여에서는 그대로 보인다 (숨김은 입력 화면에서만)
--  칼럼 규칙: companyid · companyname 맨 앞, 감사 칼럼(createdat · updatedat · created_by · updated_by) 맨 끝
CREATE TABLE IF NOT EXISTS pay_item01t (
    companyid    varchar(20)  NOT NULL,
    companyname  varchar(100),
    itemkey      varchar(30)  NOT NULL,                          -- pay_slip01t 의 지급 칸 이름 (pay_position 등)
    useyn        varchar(1)   NOT NULL DEFAULT 'Y' CHECK (useyn IN ('Y', 'N')),
    createdat    timestamptz  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedat    timestamptz,
    created_by   varchar(100),
    updated_by   varchar(100),
    PRIMARY KEY (companyid, itemkey)                             -- 회사별 조회 = PK 앞부분
);
