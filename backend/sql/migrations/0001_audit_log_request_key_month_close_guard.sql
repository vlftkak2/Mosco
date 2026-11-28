-- 0001: 감사 기록 · 접속 기록 · 전표 중복 저장 방지 · 월마감 DB 강제 · 상세→헤더 FK
-- (트랜잭션 하나로 실행: 중간에 실패하면 전부 취소)

-- ── 1. 전표 중복 저장 방지 키 (backend/idempotency.py) ─────────────────────
CREATE TABLE IF NOT EXISTS request_key01t (
    companyid    varchar(50)  NOT NULL,
    request_key  varchar(64)  NOT NULL,
    doctype      varchar(30)  NOT NULL,
    createdat    timestamptz  NOT NULL DEFAULT now(),
    created_by   varchar(100),
    PRIMARY KEY (companyid, request_key)
);
CREATE INDEX IF NOT EXISTS ix_request_key01t_createdat ON request_key01t (createdat);
COMMENT ON TABLE request_key01t IS '전표 중복 저장 방지: 화면이 새 전표마다 만든 UUID. 오래된 행(예: 30일)은 정리해도 된다.';

-- ── 2. 접속 기록: 로그인 성공 · 실패 · 로그아웃, 운영사(001)의 다른 회사 데이터 접근 ───────────
CREATE TABLE IF NOT EXISTS access_log01t (
    logid             bigserial    PRIMARY KEY,
    companyid         varchar(50),                 -- 행위자 회사 (로그인 실패는 비어 있을 수 있음)
    useremail         varchar(254),
    action            varchar(40)  NOT NULL,       -- LOGIN_SUCCESS / LOGIN_FAIL / LOGOUT / PLATFORM_ACCESS ...
    target_companyid  varchar(50),                 -- 운영사가 들여다본 회사 (해당할 때)
    method            varchar(10),
    path              varchar(300),
    client_ip         varchar(64),
    detail            varchar(500),
    createdat         timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_access_log01t_company_createdat ON access_log01t (companyid, createdat DESC);
CREATE INDEX IF NOT EXISTS ix_access_log01t_email_createdat ON access_log01t (lower(useremail), createdat DESC);
COMMENT ON TABLE access_log01t IS '접속 · 운영사 접근 기록 (보관 기간 정책에 따라 주기적으로 정리)';

-- ── 3. 데이터 변경 기록 (누가 · 언제 · 무엇을 · 바뀌기 전/후 값) ────────────────────
CREATE TABLE IF NOT EXISTS audit_log01t (
    auditid     bigserial    PRIMARY KEY,
    companyid   varchar(50),
    tablename   varchar(63)  NOT NULL,
    operation   varchar(10)  NOT NULL,            -- INSERT / UPDATE / DELETE
    old_data    jsonb,
    new_data    jsonb,
    createdat   timestamptz  NOT NULL DEFAULT now(),
    created_by  varchar(150)                      -- 요청한 사용자 (앱이 mosco.actor 로 넘김, 없으면 행의 수정자)
);
CREATE INDEX IF NOT EXISTS ix_audit_log01t_company_createdat ON audit_log01t (companyid, createdat DESC);
CREATE INDEX IF NOT EXISTS ix_audit_log01t_table_createdat ON audit_log01t (tablename, createdat DESC);
COMMENT ON TABLE audit_log01t IS '전표 · 마스터 변경 이력 (트리거 mosco_audit_row). 비밀번호 · 세션 · 이미지 칸은 남기지 않는다.';

CREATE OR REPLACE FUNCTION mosco_audit_strip(data jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
    SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb)
    FROM jsonb_each(data)
    WHERE key NOT IN ('password', 'session_id') AND key NOT LIKE '%image'
$$;

CREATE OR REPLACE FUNCTION mosco_audit_row() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    old_j jsonb;
    new_j jsonb;
    actor varchar;
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        old_j := mosco_audit_strip(to_jsonb(OLD));
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        new_j := mosco_audit_strip(to_jsonb(NEW));
    END IF;
    IF TG_OP = 'UPDATE' AND old_j = new_j THEN
        RETURN NULL;   -- 남기지 않는 칸(세션 등)만 바뀐 경우
    END IF;
    actor := NULLIF(current_setting('mosco.actor', true), '');
    IF actor IS NULL THEN
        actor := COALESCE(new_j->>'updated_by', new_j->>'updatedby', new_j->>'created_by', new_j->>'createdby',
                          new_j->>'closed_by', old_j->>'updated_by', old_j->>'updatedby');
    END IF;
    INSERT INTO audit_log01t (companyid, tablename, operation, old_data, new_data, created_by)
    VALUES (COALESCE(new_j->>'companyid', old_j->>'companyid'), TG_TABLE_NAME, TG_OP, old_j, new_j, left(actor, 150));
    RETURN NULL;
END
$$;

-- 전표(헤더 · 상세 · 기타비용): 수정 · 삭제 전 값을 남긴다 (새로 넣은 값은 전표 자체에 있다)
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'inbound01t', 'inbound02t', 'inbound03t',
        'outbound01t', 'outbound02t', 'outbound03t',
        'receiptpayment01t', 'receiptpayment02t',
        'inoutmove01t', 'inoutmove02t',
        'process01t', 'process02t',
        'standstock01t',
        'itemcode01t', 'codemaster01t'
    ] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_audit ON %I', t, t);
        EXECUTE format('CREATE TRIGGER trg_%s_audit AFTER UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION mosco_audit_row()', t, t);
    END LOOP;
    -- 거래처 · 계정 · 권한 · 고객사 · 월마감: 등록도 남긴다 (권한 부여 · 마감 이력)
    FOREACH t IN ARRAY ARRAY[
        'customer01t', 'user01t', 'usermenupermission01t', 'company01t', 'monthclose01t'
    ] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_audit ON %I', t, t);
        EXECUTE format('CREATE TRIGGER trg_%s_audit AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION mosco_audit_row()', t, t);
    END LOOP;
END
$$;

-- ── 4. 월마감 DB 강제: 마감된 달의 전표는 어떤 경로(스크립트 포함)로도 등록 · 수정 · 삭제할 수 없다 ─────────
-- 앱(services/closing/MonthClose.ensure_open)과 같은 규칙. 바뀌기 전 · 후 일자 둘 다 검사한다.
-- 관리 스크립트가 일부러 고쳐야 하면 그 트랜잭션에서만: SELECT set_config('mosco.skip_close_check', 'on', true);
CREATE OR REPLACE FUNCTION mosco_check_month_close() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    col      text := TG_ARGV[0];
    cid      varchar;
    d_old    date;
    d_new    date;
    through  date;
BEGIN
    IF current_setting('mosco.skip_close_check', true) = 'on' THEN
        RETURN COALESCE(NEW, OLD);
    END IF;
    IF TG_OP <> 'INSERT' THEN
        cid := OLD.companyid;
        d_old := (to_jsonb(OLD) ->> col)::date;
    END IF;
    IF TG_OP <> 'DELETE' THEN
        cid := NEW.companyid;
        d_new := (to_jsonb(NEW) ->> col)::date;
    END IF;
    SELECT (MAX(closemonth) + INTERVAL '1 month' - INTERVAL '1 day')::date INTO through
    FROM monthclose01t WHERE companyid = cid;
    IF through IS NOT NULL AND (d_old <= through OR d_new <= through) THEN
        RAISE EXCEPTION 'MOSCO:%월까지 마감되어 그 기간의 전표는 등록 · 수정 · 삭제할 수 없습니다. 월마감 관리에서 마감을 취소한 뒤 처리해 주세요.',
            to_char(through, 'YYYY-MM') USING ERRCODE = 'P0001';
    END IF;
    RETURN COALESCE(NEW, OLD);
END
$$;

DROP TRIGGER IF EXISTS trg_inbound01t_month_close ON inbound01t;
CREATE TRIGGER trg_inbound01t_month_close BEFORE INSERT OR UPDATE OR DELETE ON inbound01t
    FOR EACH ROW EXECUTE FUNCTION mosco_check_month_close('receptdate');
DROP TRIGGER IF EXISTS trg_outbound01t_month_close ON outbound01t;
CREATE TRIGGER trg_outbound01t_month_close BEFORE INSERT OR UPDATE OR DELETE ON outbound01t
    FOR EACH ROW EXECUTE FUNCTION mosco_check_month_close('receptdate');
DROP TRIGGER IF EXISTS trg_receiptpayment01t_month_close ON receiptpayment01t;
CREATE TRIGGER trg_receiptpayment01t_month_close BEFORE INSERT OR UPDATE OR DELETE ON receiptpayment01t
    FOR EACH ROW EXECUTE FUNCTION mosco_check_month_close('receiptdate');
DROP TRIGGER IF EXISTS trg_inoutmove01t_month_close ON inoutmove01t;
CREATE TRIGGER trg_inoutmove01t_month_close BEFORE INSERT OR UPDATE OR DELETE ON inoutmove01t
    FOR EACH ROW EXECUTE FUNCTION mosco_check_month_close('receptdate');
DROP TRIGGER IF EXISTS trg_process01t_month_close ON process01t;
CREATE TRIGGER trg_process01t_month_close BEFORE INSERT OR UPDATE OR DELETE ON process01t
    FOR EACH ROW EXECUTE FUNCTION mosco_check_month_close('processdate');
DROP TRIGGER IF EXISTS trg_standstock01t_month_close ON standstock01t;
CREATE TRIGGER trg_standstock01t_month_close BEFORE INSERT OR UPDATE OR DELETE ON standstock01t
    FOR EACH ROW EXECUTE FUNCTION mosco_check_month_close('standdate');

-- ── 5. 상세 → 헤더 FK (03t 와 같은 방식). 기존 행 검사는 VALIDATE 로 짧은 잠금에서 한다 ─────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inbound02t_companyid_receiptno_fkey') THEN
        ALTER TABLE inbound02t ADD CONSTRAINT inbound02t_companyid_receiptno_fkey
            FOREIGN KEY (companyid, receiptno) REFERENCES inbound01t (companyid, receiptno) ON DELETE CASCADE NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'outbound02t_companyid_receiptno_fkey') THEN
        ALTER TABLE outbound02t ADD CONSTRAINT outbound02t_companyid_receiptno_fkey
            FOREIGN KEY (companyid, receiptno) REFERENCES outbound01t (companyid, receiptno) ON DELETE CASCADE NOT VALID;
    END IF;
END
$$;
ALTER TABLE inbound02t VALIDATE CONSTRAINT inbound02t_companyid_receiptno_fkey;
ALTER TABLE outbound02t VALIDATE CONSTRAINT outbound02t_companyid_receiptno_fkey;
