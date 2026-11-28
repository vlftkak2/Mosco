--
-- PostgreSQL database dump
--

\restrict hqJge3I2sCTyJfUe5mJWZxfKVC244QgjgDcDRysBb8PBHapKZzfB6DmaEzVU09a

-- Dumped from database version 18.6
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: fn_check_stock_reservation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_check_stock_reservation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    k        record;
    rsv      record;
    stock    record;
    running  text := NULLIF(current_setting('mosco.approval_request', true), '');
BEGIN
    IF TG_OP = 'DELETE' THEN k := OLD; ELSE k := NEW; END IF;
    SELECT COALESCE(SUM(r.qty), 0) AS qty, COALESCE(SUM(r.weight), 0) AS weight,
           STRING_AGG(DISTINCT q.requestno, ', ') AS requests
      INTO rsv
      FROM approval_request01t q
      CROSS JOIN LATERAL jsonb_to_recordset(q.reservations)
           AS r(sourcetype varchar, sourceno varchar, sourceline integer, qty numeric, weight numeric)
     WHERE q.companyid = k.companyid AND q.status IN ('PENDING', 'PROCESSING')
       AND q.requestno IS DISTINCT FROM running
       AND r.sourcetype = k.sourcetype AND r.sourceno = k.sourceno AND r.sourceline = k.sourceline;
    IF rsv.requests IS NULL THEN
        RETURN NULL;
    END IF;
    SELECT COALESCE(SUM(s.qty), 0) AS qty, COALESCE(SUM(s.weight), 0) AS weight
      INTO stock
      FROM currentstock01t s
     WHERE s.companyid = k.companyid AND s.sourcetype = k.sourcetype AND s.sourceno = k.sourceno AND s.sourceline = k.sourceline;
    IF stock.weight + 0.0005 < rsv.weight OR (rsv.qty > 0 AND stock.qty + 0.0005 < rsv.qty) THEN
        RAISE EXCEPTION 'MOSCO:재고 % / 순번 %은(는) 승인 대기 중인 요청(%)에 예약되어 있어 줄이거나 지울 수 없습니다. 요청이 승인 · 반려 · 취소된 뒤 다시 저장해 주세요.',
            k.sourceno, k.sourceline, rsv.requests USING ERRCODE = 'P0001';
    END IF;
    RETURN NULL;
END $$;


--
-- Name: iniop01t_fill_kind(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.iniop01t_fill_kind() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.iniokind IS NULL THEN
        NEW.iniokind := CASE
            WHEN NEW.iniotype = 'ST' THEN 'ST'
            WHEN EXISTS (SELECT 1 FROM process01t p WHERE p.companyid = NEW.companyid AND p.processno = NEW.receiptno)
                 THEN 'PROCESS_' || NEW.iniotype
            WHEN EXISTS (SELECT 1 FROM inoutmove01t m WHERE m.companyid = NEW.companyid AND m.receiptno = NEW.receiptno)
                 THEN 'MOVE_' || NEW.iniotype
            ELSE NEW.iniotype END;
    END IF;
    RETURN NEW;
END $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: aiorder01t; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aiorder01t (
    companyid character varying(50) NOT NULL,
    companyname character varying(50) NOT NULL,
    orderid character varying(100) NOT NULL,
    analysis_request_id uuid,
    username character varying(100) DEFAULT ''::character varying NOT NULL,
    useremail character varying(255) NOT NULL,
    buyer character varying(100),
    recipient character varying(100),
    orderdate date,
    duedate date,
    deliverylocation text,
    sourcefilename character varying(255),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone,
    created_by character varying(100),
    updated_by character varying(100)
);


--
-- Name: aiorder02t; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aiorder02t (
    companyid character varying(50) NOT NULL,
    companyname character varying(100) NOT NULL,
    orderid character varying(100) NOT NULL,
    lineno integer NOT NULL,
    itemname character varying(255),
    steelgrade character varying(100),
    size text,
    thickness numeric(15,3),
    width numeric(15,3),
    length numeric(15,3),
    quantity numeric(15,3),
    quantity_unit character varying(30),
    weight_kg numeric(15,3),
    notes text,
    quantity_raw text,
    weight_raw text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone,
    created_by character varying(100),
    updated_by character varying(100),
    optimize_status character varying(20) DEFAULT 'NONE'::character varying NOT NULL,
    surface character varying(100),
    CONSTRAINT aiorder02t_lineno_check CHECK ((lineno > 0)),
    CONSTRAINT aiorder02t_optimize_status_check CHECK (((optimize_status)::text = ANY ((ARRAY['NONE'::character varying, 'WAITING'::character varying, 'PLANNED'::character varying, 'DONE'::character varying])::text[])))
);


--
-- Name: aiorder03t; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aiorder03t (
    companyid character varying(50) NOT NULL,
    companyname character varying(100) NOT NULL,
    orderid character varying(100) NOT NULL,
    lineno integer NOT NULL,
    matchlineno integer NOT NULL,
    stocksourcetype character varying(20) NOT NULL,
    stocksourceno character varying(100) NOT NULL,
    stocksourceline integer NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone,
    created_by character varying(100)
);


--
-- Name: aiorderanalysis01t; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aiorderanalysis01t (
    companyid character varying(50) NOT NULL,
    companyname character varying(100) DEFAULT ''::character varying NOT NULL,
    request_id uuid NOT NULL,
    username character varying(100) DEFAULT ''::character varying NOT NULL,
    useremail character varying(255) NOT NULL,
    sourcefilename character varying(255) NOT NULL,
    file_sha256 character(64) NOT NULL,
    model character varying(100) NOT NULL,
    status character varying(30) NOT NULL,
    input_tokens bigint DEFAULT 0 NOT NULL,
    output_tokens bigint DEFAULT 0 NOT NULL,
    reasoning_tokens bigint DEFAULT 0 NOT NULL,
    cached_input_tokens bigint DEFAULT 0 NOT NULL,
    reserved_cost_usd numeric(15,8) DEFAULT 0 NOT NULL,
    estimated_cost_usd numeric(15,8),
    extraction jsonb,
    error_type character varying(100),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT aiorderanalysis01t_cached_input_tokens_check CHECK ((cached_input_tokens >= 0)),
    CONSTRAINT aiorderanalysis01t_estimated_cost_usd_check CHECK (((estimated_cost_usd IS NULL) OR (estimated_cost_usd >= (0)::numeric))),
    CONSTRAINT aiorderanalysis01t_input_tokens_check CHECK ((input_tokens >= 0)),
    CONSTRAINT aiorderanalysis01t_output_tokens_check CHECK ((output_tokens >= 0)),
    CONSTRAINT aiorderanalysis01t_reasoning_tokens_check CHECK ((reasoning_tokens >= 0)),
    CONSTRAINT aiorderanalysis01t_reserved_cost_usd_check CHECK ((reserved_cost_usd >= (0)::numeric)),
    CONSTRAINT aiorderanalysis01t_status_check CHECK (((status)::text = ANY ((ARRAY['processing'::character varying, 'response_received'::character varying, 'succeeded'::character varying, 'failed_unknown'::character varying, 'invalid_output'::character varying])::text[])))
);


--
-- Name: aiorderrule01t; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aiorderrule01t (
    ruleid bigint NOT NULL,
    companyid character varying(50) NOT NULL,
    companyname character varying(100),
    issuername character varying(150) NOT NULL,
    rulename character varying(150) NOT NULL,
    source_label character varying(100),
    target_field character varying(50) NOT NULL,
    action character varying(20) DEFAULT 'MAP'::character varying NOT NULL,
    instruction character varying(2000) NOT NULL,
    priority smallint DEFAULT 100 NOT NULL,
    status character varying(20) DEFAULT 'DRAFT'::character varying NOT NULL,
    rule_version integer DEFAULT 1 NOT NULL,
    created_by character varying(100),
    approved_by character varying(100),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone,
    CONSTRAINT aiorderrule01t_action_check CHECK (((action)::text = ANY ((ARRAY['MAP'::character varying, 'IGNORE'::character varying, 'INSTRUCTION'::character varying])::text[]))),
    CONSTRAINT aiorderrule01t_status_check CHECK (((status)::text = ANY ((ARRAY['DRAFT'::character varying, 'ACTIVE'::character varying, 'DISABLED'::character varying])::text[]))),
    CONSTRAINT aiorderrule01t_target_field_check CHECK (((target_field)::text = ANY ((ARRAY['delivery_location'::character varying, 'source_product_name'::character varying, 'steel_grade'::character varying, 'spec_raw'::character varying, 'thickness'::character varying, 'width'::character varying, 'length'::character varying, 'quantity'::character varying, 'quantity_unit'::character varying, 'weight_kg'::character varying, 'notes'::character varying])::text[])))
);


--
-- Name: aiorderrule01t_ruleid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.aiorderrule01t ALTER COLUMN ruleid ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.aiorderrule01t_ruleid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: aiorderusage01t; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aiorderusage01t (
    request_hash character(64) NOT NULL,
    companyid character varying(50) NOT NULL,
    companyname character varying(50) NOT NULL,
    user_hash character(64) NOT NULL,
    usage_day date NOT NULL,
    usage_month date NOT NULL,
    status character varying(20) NOT NULL,
    model character varying(100) NOT NULL,
    reserved_usd numeric(18,10) DEFAULT 0 NOT NULL,
    estimated_cost_usd numeric(18,10) DEFAULT 0 NOT NULL,
    input_tokens bigint DEFAULT 0 NOT NULL,
    output_tokens bigint DEFAULT 0 NOT NULL,
    reasoning_tokens bigint DEFAULT 0 NOT NULL,
    cached_input_tokens bigint DEFAULT 0 NOT NULL,
    request_id uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT aiorderusage01t_cached_input_tokens_check CHECK ((cached_input_tokens >= 0)),
    CONSTRAINT aiorderusage01t_estimated_cost_usd_check CHECK ((estimated_cost_usd >= (0)::numeric)),
    CONSTRAINT aiorderusage01t_input_tokens_check CHECK ((input_tokens >= 0)),
    CONSTRAINT aiorderusage01t_output_tokens_check CHECK ((output_tokens >= 0)),
    CONSTRAINT aiorderusage01t_reasoning_tokens_check CHECK ((reasoning_tokens >= 0)),
    CONSTRAINT aiorderusage01t_reserved_usd_check CHECK ((reserved_usd >= (0)::numeric)),
    CONSTRAINT aiorderusage01t_status_check CHECK (((status)::text = ANY ((ARRAY['queued'::character varying, 'processing'::character varying, 'complete'::character varying, 'failed'::character varying])::text[])))
);


--
-- Name: aiplan01t; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aiplan01t (
    companyid character varying(50) NOT NULL,
    companyname character varying(100) NOT NULL,
    planno character varying(30) NOT NULL,
    materialtype character varying(10) NOT NULL,
    status character varying(10) DEFAULT 'DRAFT'::character varying NOT NULL,
    rawkind character varying(10) NOT NULL,
    stocksourcetype character varying(20),
    stocksourceno character varying(100),
    stocksourceline integer,
    itemname character varying(255),
    steelgrade character varying(100),
    surface character varying(100),
    thickness numeric(15,3),
    width numeric(15,3),
    length numeric(15,3),
    rawweight numeric(15,3),
    rawsheets integer,
    trimloss numeric(15,3),
    processmode character varying(10),
    combo character varying(10),
    orientation character varying(10),
    inputweight numeric(15,3),
    productweight numeric(15,3),
    lossweight numeric(15,3),
    yieldrate numeric(7,3),
    pattern jsonb,
    processno character varying(100),
    description text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone,
    created_by character varying(150),
    updated_by character varying(150),
    CONSTRAINT aiplan01t_materialtype_check CHECK (((materialtype)::text = ANY ((ARRAY['COIL'::character varying, 'SHEET'::character varying])::text[]))),
    CONSTRAINT aiplan01t_rawkind_check CHECK (((rawkind)::text = ANY ((ARRAY['STOCK'::character varying, 'NEW'::character varying])::text[]))),
    CONSTRAINT aiplan01t_status_check CHECK (((status)::text = ANY ((ARRAY['DRAFT'::character varying, 'CONFIRMED'::character varying, 'DONE'::character varying, 'CANCELLED'::character varying])::text[])))
);


--
-- Name: aiplan02t; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aiplan02t (
    companyid character varying(50) NOT NULL,
    companyname character varying(100) NOT NULL,
    planno character varying(30) NOT NULL,
    lineno integer NOT NULL,
    linekind character varying(10) NOT NULL,
    orderid character varying(100),
    orderlineno integer,
    width numeric(15,3),
    length numeric(15,3),
    cuts integer,
    readyweight numeric(15,3),
    plannedweight numeric(15,3),
    plannedqty numeric(15,3),
    CONSTRAINT aiplan02t_linekind_check CHECK (((linekind)::text = ANY ((ARRAY['ORDER'::character varying, 'EXTRA'::character varying])::text[])))
);


--
-- Name: approval_request01t; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.approval_request01t (
    companyid character varying(20) NOT NULL,
    companyname character varying(100),
    requestno character varying(150) NOT NULL,
    target character varying(30) NOT NULL,
    action character varying(10) NOT NULL,
    op character varying(30) NOT NULL,
    ref_no character varying(100),
    summary character varying(500) DEFAULT ''::character varying NOT NULL,
    amount numeric(15,0),
    payload jsonb NOT NULL,
    reservations jsonb DEFAULT '[]'::jsonb NOT NULL,
    status character varying(12) DEFAULT 'PENDING'::character varying NOT NULL,
    decided_by character varying(100),
    decided_at timestamp with time zone,
    reject_reason character varying(500),
    last_error character varying(500),
    result_no character varying(100),
    createdat timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updatedat timestamp with time zone,
    created_by character varying(100),
    updated_by character varying(100),
    CONSTRAINT approval_request01t_action_check CHECK (((action)::text = ANY ((ARRAY['CREATE'::character varying, 'UPDATE'::character varying, 'DELETE'::character varying])::text[]))),
    CONSTRAINT approval_request01t_status_check CHECK (((status)::text = ANY ((ARRAY['PENDING'::character varying, 'PROCESSING'::character varying, 'APPROVED'::character varying, 'REJECTED'::character varying, 'CANCELED'::character varying])::text[])))
);


--
-- Name: COLUMN approval_request01t.requestno; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.approval_request01t.requestno IS '요청번호: 회사명-년도(KST)-00001, 회사 · 년도별 일련번호';


--
-- Name: board01t; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.board01t (
    id bigint NOT NULL,
    companyid character varying(50) NOT NULL,
    companyname character varying(100) NOT NULL,
    category character varying(20) NOT NULL,
    title character varying(200) NOT NULL,
    content text NOT NULL,
    phone character varying(50) DEFAULT ''::character varying NOT NULL,
    pinned boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone,
    created_by character varying(100),
    updated_by character varying(100),
    created_name character varying(100),
    updated_name character varying(100),
    CONSTRAINT board01t_category_check CHECK (((category)::text = ANY ((ARRAY['notice'::character varying, 'stock'::character varying, 'ai'::character varying, 'system'::character varying])::text[]))),
    CONSTRAINT board01t_notice_owner CHECK ((((category)::text <> 'notice'::text) OR ((companyid)::text = '001'::text))),
    CONSTRAINT board01t_pinned_notice CHECK (((NOT pinned) OR ((category)::text = 'notice'::text)))
);


--
-- Name: TABLE board01t; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.board01t IS '상담게시판 게시글';


--
-- Name: COLUMN board01t.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.board01t.id IS '게시글 번호';


--
-- Name: COLUMN board01t.companyid; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.board01t.companyid IS '작성 회사 ID (001 = 운영사)';


--
-- Name: COLUMN board01t.companyname; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.board01t.companyname IS '작성 회사명';


--
-- Name: COLUMN board01t.category; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.board01t.category IS '게시판 탭: notice 공지사항, stock 재고문의, ai AI ERP문의, system 시스템문의';


--
-- Name: COLUMN board01t.title; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.board01t.title IS '제목';


--
-- Name: COLUMN board01t.content; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.board01t.content IS '본문';


--
-- Name: COLUMN board01t.phone; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.board01t.phone IS '회신 연락처 (공지사항은 사용 안 함)';


--
-- Name: COLUMN board01t.pinned; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.board01t.pinned IS '상단 고정 (공지사항만, 운영사만 설정)';


--
-- Name: COLUMN board01t.created_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.board01t.created_at IS '등록일시';


--
-- Name: COLUMN board01t.updated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.board01t.updated_at IS '수정일시 (수정 전엔 NULL)';


--
-- Name: COLUMN board01t.created_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.board01t.created_by IS '등록자 (로그인 이메일)';


--
-- Name: COLUMN board01t.updated_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.board01t.updated_by IS '수정자 (로그인 이메일)';


--
-- Name: COLUMN board01t.created_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.board01t.created_name IS '등록자명 (화면 표시용)';


--
-- Name: COLUMN board01t.updated_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.board01t.updated_name IS '수정자명 (화면 표시용)';


--
-- Name: board01t_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.board01t ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.board01t_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: boardreply01t; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.boardreply01t (
    id bigint NOT NULL,
    board_id bigint NOT NULL,
    companyid character varying(50) NOT NULL,
    companyname character varying(100) NOT NULL,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone,
    created_by character varying(100),
    updated_by character varying(100),
    created_name character varying(100),
    updated_name character varying(100)
);


--
-- Name: TABLE boardreply01t; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.boardreply01t IS '상담게시판 답글';


--
-- Name: COLUMN boardreply01t.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.boardreply01t.id IS '답글 번호';


--
-- Name: COLUMN boardreply01t.board_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.boardreply01t.board_id IS '게시글 번호 (board01t.id)';


--
-- Name: COLUMN boardreply01t.companyid; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.boardreply01t.companyid IS '작성 회사 ID (001 = 운영사 답변)';


--
-- Name: COLUMN boardreply01t.companyname; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.boardreply01t.companyname IS '작성 회사명';


--
-- Name: COLUMN boardreply01t.content; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.boardreply01t.content IS '답글 내용';


--
-- Name: COLUMN boardreply01t.created_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.boardreply01t.created_at IS '등록일시';


--
-- Name: COLUMN boardreply01t.updated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.boardreply01t.updated_at IS '수정일시 (수정 전엔 NULL)';


--
-- Name: COLUMN boardreply01t.created_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.boardreply01t.created_by IS '등록자 (로그인 이메일)';


--
-- Name: COLUMN boardreply01t.updated_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.boardreply01t.updated_by IS '수정자 (로그인 이메일)';


--
-- Name: COLUMN boardreply01t.created_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.boardreply01t.created_name IS '등록자명 (화면 표시용)';


--
-- Name: COLUMN boardreply01t.updated_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.boardreply01t.updated_name IS '수정자명 (화면 표시용)';


--
-- Name: boardreply01t_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.boardreply01t ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.boardreply01t_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: codemaster01t; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.codemaster01t (
    companyid character varying(50) NOT NULL,
    companyname character varying(50) NOT NULL,
    groupcode character varying(50) NOT NULL,
    groupname character varying(100) NOT NULL,
    code character varying(50) NOT NULL,
    code_name character varying(150) NOT NULL,
    property1 character varying(50),
    property2 character varying(50),
    property3 character varying(50),
    property4 character varying(50),
    sort_order integer DEFAULT 0 NOT NULL,
    use_yn character(10) DEFAULT 'Y'::bpchar NOT NULL,
    description character varying(500),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone,
    created_by character varying(100),
    updated_by character varying(100)
);


--
-- Name: COLUMN codemaster01t.created_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.codemaster01t.created_by IS '등록자';


--
-- Name: COLUMN codemaster01t.updated_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.codemaster01t.updated_by IS '수정자';


--
-- Name: company01t; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company01t (
    companyid character varying(50) NOT NULL,
    companyname character varying(100) NOT NULL,
    ownertype character varying(10) DEFAULT 'CORP'::character varying NOT NULL,
    businessno character varying(20),
    corporationno character varying(20),
    ceoname character varying(100),
    businesstype character varying(100),
    industry character varying(100),
    openingdate date,
    phone character varying(30),
    zipcode character varying(10),
    address1 character varying(300),
    address2 character varying(300),
    plan_code character varying(20) DEFAULT 'BASIC'::character varying NOT NULL,
    company_status character varying(20) DEFAULT 'PENDING'::character varying NOT NULL,
    licensed_seats integer DEFAULT 0 NOT NULL,
    ledgerstartdate date,
    logoimage bytea,
    logomime character varying(50),
    logoname character varying(255),
    stampimage bytea,
    stampmime character varying(50),
    stampname character varying(255),
    bizcertimage bytea,
    bizcertmime character varying(50),
    bizcertname character varying(255),
    fax character varying(30),
    license_start date,
    license_end date,
    stock_open_yn character(1) DEFAULT 'N'::bpchar NOT NULL,
    stock_open_date date,
    createdat timestamp with time zone DEFAULT CURRENT_TIMESTAMP CONSTRAINT company01t_createdat_not_null1 NOT NULL,
    updatedat timestamp with time zone,
    created_by character varying(100),
    updated_by character varying(100),
    CONSTRAINT company01t_company_status_check CHECK (((company_status)::text = ANY ((ARRAY['PENDING'::character varying, 'ACTIVE'::character varying, 'SUSPENDED'::character varying, 'CLOSED'::character varying])::text[]))),
    CONSTRAINT company01t_license_period_check CHECK (((license_end IS NULL) OR (license_start IS NULL) OR (license_end >= license_start))),
    CONSTRAINT company01t_licensed_seats_check CHECK ((licensed_seats >= 0)),
    CONSTRAINT company01t_ownertype_check CHECK (((ownertype)::text = ANY ((ARRAY['CORP'::character varying, 'INDIV'::character varying])::text[]))),
    CONSTRAINT company01t_plan_code_check CHECK (((plan_code)::text = ANY ((ARRAY['BASIC'::character varying, 'EXTENDED'::character varying])::text[]))),
    CONSTRAINT company01t_stock_open_yn_check CHECK ((stock_open_yn = ANY (ARRAY['Y'::bpchar, 'N'::bpchar])))
);


--
-- Name: TABLE company01t; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.company01t IS '고객사(회사 · 사업장) — 회사 1개 = 사업장 1개. 등록 · 요금제 · 이용상태는 어드민>고객사등록, 사업자 정보 · 이미지는 설정>사업장관리. 계정은 user01t (companyid 로 연결)';


--
-- Name: COLUMN company01t.companyid; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.company01t.companyid IS '회사 코드 (PK) — 모든 업무 테이블의 회사 구분 키. 001 = 플랫폼 운영사(삭제 불가) [고객사등록, 등록 후 변경 불가]';


--
-- Name: COLUMN company01t.companyname; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.company01t.companyname IS '회사명 — 거래명세서 공급자 상호 [고객사등록 입력 / 사업장관리 보기만]';


--
-- Name: COLUMN company01t.ownertype; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.company01t.ownertype IS '사업자 유형 CORP 법인사업자 / INDIV 개인사업자 [사업장관리]';


--
-- Name: COLUMN company01t.businessno; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.company01t.businessno IS '사업자등록번호 000-00-00000 (검증번호 확인, 중복 불가) — 거래명세서 공급자 [고객사등록 · 사업장관리]';


--
-- Name: COLUMN company01t.corporationno; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.company01t.corporationno IS '법인등록번호 000000-0000000 (법인사업자만) [사업장관리]';


--
-- Name: COLUMN company01t.ceoname; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.company01t.ceoname IS '대표자명 — 거래명세서 공급자 [고객사등록 · 사업장관리]';


--
-- Name: COLUMN company01t.businesstype; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.company01t.businesstype IS '업태 — 거래명세서 공급자 [사업장관리]';


--
-- Name: COLUMN company01t.industry; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.company01t.industry IS '종목 — 거래명세서 공급자 [사업장관리]';


--
-- Name: COLUMN company01t.openingdate; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.company01t.openingdate IS '개업년월일 [사업장관리]';


--
-- Name: COLUMN company01t.phone; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.company01t.phone IS '전화번호 — 거래명세서 공급자 연락처 [고객사등록 · 사업장관리]';


--
-- Name: COLUMN company01t.zipcode; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.company01t.zipcode IS '우편번호 (카카오 주소 검색) [고객사등록 · 사업장관리]';


--
-- Name: COLUMN company01t.address1; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.company01t.address1 IS '주소 (도로명주소) — 거래명세서 공급자 [고객사등록 · 사업장관리]';


--
-- Name: COLUMN company01t.address2; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.company01t.address2 IS '상세주소 (동 · 호수 · 건물명) — 거래명세서 공급자 주소 뒤에 붙음 [고객사등록 · 사업장관리]';


--
-- Name: COLUMN company01t.plan_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.company01t.plan_code IS '요금제 BASIC 기본형 / EXTENDED 확장형 [고객사등록, 플랫폼 관리자 전용]';


--
-- Name: COLUMN company01t.company_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.company01t.company_status IS '이용상태 PENDING 승인대기 / ACTIVE 이용중 / SUSPENDED 이용정지 / CLOSED 종료 — ACTIVE 가 아니면 소속 계정 로그인 불가 · 계정 등록 불가 [고객사등록]';


--
-- Name: COLUMN company01t.licensed_seats; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.company01t.licensed_seats IS '허용 계정 수 — 사용중 계정 수가 이 값을 넘을 수 없음 (고객사관리 계정 등록 · 사용 전환 때 확인) [고객사등록]';


--
-- Name: COLUMN company01t.ledgerstartdate; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.company01t.ledgerstartdate IS '시스템 시작일 (= 거래처원장 시작일) — 이 날짜 이전 거래는 전기이월(거래처 기초잔액)로 처리 [사업장관리 · 거래처원장]';


--
-- Name: COLUMN company01t.logoimage; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.company01t.logoimage IS '회사 로고 이미지 (JPG · PNG, 500KB 이하) [사업장관리]';


--
-- Name: COLUMN company01t.logomime; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.company01t.logomime IS '회사 로고 이미지 형식 image/png, image/jpeg [사업장관리]';


--
-- Name: COLUMN company01t.logoname; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.company01t.logoname IS '회사 로고 파일 이름 (화면 표시용) [사업장관리]';


--
-- Name: COLUMN company01t.stampimage; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.company01t.stampimage IS '직인 이미지 (JPG · PNG, 500KB 이하) — 증명서 · 출력물에 찍힘 [사업장관리]';


--
-- Name: COLUMN company01t.stampmime; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.company01t.stampmime IS '직인 이미지 형식 image/png, image/jpeg [사업장관리]';


--
-- Name: COLUMN company01t.stampname; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.company01t.stampname IS '직인 파일 이름 (화면 표시용) [사업장관리]';


--
-- Name: COLUMN company01t.bizcertimage; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.company01t.bizcertimage IS '사업자등록증 이미지 (JPG · PNG, 2MB 이하) [사업장관리]';


--
-- Name: COLUMN company01t.bizcertmime; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.company01t.bizcertmime IS '사업자등록증 이미지 형식 image/png, image/jpeg [사업장관리]';


--
-- Name: COLUMN company01t.bizcertname; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.company01t.bizcertname IS '사업자등록증 파일 이름 (화면 표시용) [사업장관리]';


--
-- Name: company_ai_quota01t; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company_ai_quota01t (
    companyid character varying(50) NOT NULL,
    monthly_limit integer,
    createdat timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updatedat timestamp with time zone,
    created_by character varying(100),
    updated_by character varying(100),
    CONSTRAINT company_ai_quota01t_limit_check CHECK (((monthly_limit IS NULL) OR ((monthly_limit >= 0) AND (monthly_limit <= 1000000))))
);


--
-- Name: company_license01t; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company_license01t (
    companyid character varying(50) CONSTRAINT company_license01t_companyid_not_null1 NOT NULL,
    unit_price numeric(15,0) DEFAULT 0 CONSTRAINT company_license01t_unit_price_not_null1 NOT NULL,
    createdat timestamp with time zone DEFAULT CURRENT_TIMESTAMP CONSTRAINT company_license01t_createdat_not_null1 NOT NULL,
    updatedat timestamp with time zone,
    created_by character varying(100),
    updated_by character varying(100),
    CONSTRAINT company_license01t_price_check CHECK ((unit_price >= (0)::numeric))
);


--
-- Name: company_license_charge01t; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company_license_charge01t (
    companyid character varying(50) NOT NULL,
    charge_month date NOT NULL,
    quantity integer NOT NULL,
    unit_price numeric(15,0) NOT NULL,
    amount numeric(15,0) NOT NULL,
    createdat timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updatedat timestamp with time zone,
    created_by character varying(100),
    updated_by character varying(100),
    CONSTRAINT company_license_charge01t_month_check CHECK ((charge_month = (date_trunc('month'::text, (charge_month)::timestamp with time zone))::date)),
    CONSTRAINT company_license_charge01t_value_check CHECK (((quantity >= 0) AND (unit_price >= (0)::numeric) AND (amount >= (0)::numeric)))
);


--
-- Name: control_approver01t; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.control_approver01t (
    companyid character varying(20) NOT NULL,
    companyname character varying(100),
    useremail character varying(100) NOT NULL,
    createdat timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updatedat timestamp with time zone,
    created_by character varying(100),
    updated_by character varying(100)
);


--
-- Name: control_policy01t; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.control_policy01t (
    companyid character varying(20) NOT NULL,
    companyname character varying(100),
    target character varying(30) NOT NULL,
    on_create character(1) DEFAULT 'N'::bpchar NOT NULL,
    create_min numeric(15,0),
    on_update character(1) DEFAULT 'N'::bpchar NOT NULL,
    update_min numeric(15,0),
    on_delete character(1) DEFAULT 'N'::bpchar NOT NULL,
    delete_min numeric(15,0),
    createdat timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updatedat timestamp with time zone,
    created_by character varying(100),
    updated_by character varying(100),
    CONSTRAINT control_policy01t_on_create_check CHECK ((on_create = ANY (ARRAY['Y'::bpchar, 'N'::bpchar]))),
    CONSTRAINT control_policy01t_on_delete_check CHECK ((on_delete = ANY (ARRAY['Y'::bpchar, 'N'::bpchar]))),
    CONSTRAINT control_policy01t_on_update_check CHECK ((on_update = ANY (ARRAY['Y'::bpchar, 'N'::bpchar])))
);


--
-- Name: currentstock01t; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.currentstock01t (
    companyid character varying(50) CONSTRAINT currentstock01t__new_companyid_not_null NOT NULL,
    companyname character varying(50) CONSTRAINT currentstock01t__new_companyname_not_null NOT NULL,
    customcode character varying(50),
    customname character varying(100),
    sourcetype character varying(20) CONSTRAINT currentstock01t__new_sourcetype_not_null NOT NULL,
    sourceno character varying(100) CONSTRAINT currentstock01t__new_sourceno_not_null NOT NULL,
    sourceline integer CONSTRAINT currentstock01t__new_sourceline_not_null NOT NULL,
    stockkind character varying(10) DEFAULT 'INBOUND'::character varying CONSTRAINT currentstock01t__new_stockkind_not_null NOT NULL,
    origintype character varying(20),
    originno character varying(100),
    originline integer,
    receiptdate date CONSTRAINT currentstock01t__new_receiptdate_not_null NOT NULL,
    itemcode character varying(100) CONSTRAINT currentstock01t__new_itemcode_not_null NOT NULL,
    itemname character varying(150) CONSTRAINT currentstock01t__new_itemname_not_null NOT NULL,
    productname character varying(150),
    materialcode character varying(100) CONSTRAINT currentstock01t__new_materialcode_not_null NOT NULL,
    materialname character varying(100) CONSTRAINT currentstock01t__new_materialname_not_null NOT NULL,
    surfacecode character varying(100),
    surfacename character varying(100),
    myrtle numeric(15,3),
    manager character varying(100),
    thickness numeric(15,3) DEFAULT 0 CONSTRAINT currentstock01t__new_thickness_not_null NOT NULL,
    width numeric(15,3) DEFAULT 0 CONSTRAINT currentstock01t__new_width_not_null NOT NULL,
    length numeric(15,3) DEFAULT 0 CONSTRAINT currentstock01t__new_length_not_null NOT NULL,
    originalqty numeric(15,3) CONSTRAINT currentstock01t__new_originalqty_not_null NOT NULL,
    qty numeric(15,3) CONSTRAINT currentstock01t__new_qty_not_null NOT NULL,
    qtyunit character varying(20) CONSTRAINT currentstock01t__new_qtyunit_not_null NOT NULL,
    originalweight numeric(15,3) CONSTRAINT currentstock01t__new_originalweight_not_null NOT NULL,
    weight numeric(15,3) CONSTRAINT currentstock01t__new_weight_not_null NOT NULL,
    unit character varying(20),
    unitprice numeric(15,2),
    costamt numeric(15,2) DEFAULT 0 CONSTRAINT currentstock01t__new_costamt_not_null1 NOT NULL,
    expamt numeric(15,2) DEFAULT 0 CONSTRAINT currentstock01t__new_expamt_not_null NOT NULL,
    feeamt numeric(15,2) DEFAULT 0 CONSTRAINT currentstock01t__new_feeamt_not_null NOT NULL,
    warehousecode character varying(50) CONSTRAINT currentstock01t__new_warehousecode_not_null NOT NULL,
    warehousecodename character varying(50) CONSTRAINT currentstock01t__new_warehousecodename_not_null NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP CONSTRAINT currentstock01t__new_created_at_not_null NOT NULL,
    updated_at timestamp with time zone,
    created_by character varying(100),
    updated_by character varying(100),
    remark character varying(500),
    remark_updated_at timestamp with time zone,
    remark_updated_by character varying(100),
    CONSTRAINT ck_currentstock01t_qty_range CHECK (((qty >= (0)::numeric) AND (qty <= originalqty) AND (weight <= originalweight))),
    CONSTRAINT ck_currentstock01t_stockkind CHECK (((stockkind)::text = ANY (ARRAY[('OPENING'::character varying)::text, ('INBOUND'::character varying)::text, ('PROCESS'::character varying)::text, ('TRANSFER'::character varying)::text]))),
    CONSTRAINT currentstock01t_weight_check CHECK ((weight >= (0)::numeric))
);


--
-- Name: customer01t; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer01t (
    companyid character varying(50) NOT NULL,
    companyname character varying(100) NOT NULL,
    customercode character varying(50) NOT NULL,
    customername character varying(100) NOT NULL,
    businessno character varying(30),
    corporationno character varying(30),
    ceoname character varying(50),
    tradetype character varying(20),
    businesstype character varying(20),
    industry character varying(20),
    manager character varying(20),
    zipcode character varying(50),
    address text,
    address2 character varying(300),
    phone character varying(20),
    fax character varying(20),
    email character varying(255),
    bankcode character varying(50),
    accountno character varying(50),
    useyn character varying(10) DEFAULT 'Y'::character varying,
    remark text,
    openingreceivable numeric(15,2) DEFAULT 0 NOT NULL,
    openingpayable numeric(15,2) DEFAULT 0 NOT NULL,
    ownertype character varying(10) DEFAULT 'CORP'::character varying NOT NULL,
    creditlimit numeric(15,0),
    createdat timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updatedat timestamp without time zone,
    createdby character varying(100),
    updatedby character varying(100),
    CONSTRAINT customer01t_ownertype_check CHECK (((ownertype)::text = ANY ((ARRAY['CORP'::character varying, 'INDIV'::character varying])::text[])))
);


--
-- Name: COLUMN customer01t.address; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.customer01t.address IS '주소 (카카오 주소 검색 도로명주소)';


--
-- Name: COLUMN customer01t.address2; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.customer01t.address2 IS '상세주소 (동 · 호수 · 건물명)';


--
-- Name: COLUMN customer01t.email; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.customer01t.email IS '이메일';


--
-- Name: COLUMN customer01t.openingreceivable; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.customer01t.openingreceivable IS '기초 미수금 (원장 시작일 기준)';


--
-- Name: COLUMN customer01t.openingpayable; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.customer01t.openingpayable IS '기초 미지급금 (원장 시작일 기준)';


--
-- Name: COLUMN customer01t.creditlimit; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.customer01t.creditlimit IS '여신한도 (공급가 기준, 비움/0 = 한도 없음). 통제관리 › 여신 통제가 켜져 있으면 매출 등록 · 수정 때 미수 잔액 + 이번 매출이 한도를 넘으면 승인요청';


--
-- Name: eappr_doc01t; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eappr_doc01t (
    companyid character varying(20) NOT NULL,
    companyname character varying(100),
    docno character varying(30) NOT NULL,
    formcode character varying(20) NOT NULL,
    title character varying(200) DEFAULT ''::character varying NOT NULL,
    status character varying(12) DEFAULT 'DRAFT'::character varying NOT NULL,
    content jsonb DEFAULT '{}'::jsonb NOT NULL,
    current_step smallint,
    submitted_at timestamp with time zone,
    completed_at timestamp with time zone,
    createdat timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updatedat timestamp with time zone,
    created_by character varying(100),
    updated_by character varying(100),
    CONSTRAINT eappr_doc01t_status_check CHECK (((status)::text = ANY ((ARRAY['DRAFT'::character varying, 'PENDING'::character varying, 'APPROVED'::character varying, 'REJECTED'::character varying])::text[])))
);


--
-- Name: eappr_form01t; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eappr_form01t (
    companyid character varying(20) NOT NULL,
    companyname character varying(100),
    formcode character varying(20) NOT NULL,
    formname character varying(100) NOT NULL,
    useyn character varying(1) DEFAULT 'Y'::character varying NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    createdat timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updatedat timestamp with time zone,
    created_by character varying(100),
    updated_by character varying(100),
    CONSTRAINT eappr_form01t_useyn_check CHECK (((useyn)::text = ANY ((ARRAY['Y'::character varying, 'N'::character varying])::text[])))
);


--
-- Name: eappr_leave01t; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eappr_leave01t (
    companyid character varying(20) NOT NULL,
    companyname character varying(100),
    useremail character varying(100) NOT NULL,
    leaveyear smallint NOT NULL,
    granted_days numeric(5,1) DEFAULT 0 NOT NULL,
    createdat timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updatedat timestamp with time zone,
    created_by character varying(100),
    updated_by character varying(100),
    CONSTRAINT eappr_leave01t_granted_days_check CHECK ((granted_days >= (0)::numeric))
);


--
-- Name: eappr_leavetime01t; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eappr_leavetime01t (
    companyid character varying(20) NOT NULL,
    companyname character varying(100),
    kind character varying(20) NOT NULL,
    slotno smallint NOT NULL,
    time_from character varying(5) NOT NULL,
    time_to character varying(5) NOT NULL,
    createdat timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updatedat timestamp with time zone,
    created_by character varying(100),
    updated_by character varying(100),
    CONSTRAINT eappr_leavetime01t_kind_check CHECK (((kind)::text = ANY ((ARRAY['HALF_AM'::character varying, 'HALF_PM'::character varying, 'QUARTER'::character varying])::text[]))),
    CONSTRAINT eappr_leavetime01t_slotno_check CHECK ((slotno >= 1))
);


--
-- Name: eappr_line01t; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eappr_line01t (
    companyid character varying(20) NOT NULL,
    companyname character varying(100),
    formcode character varying(20) NOT NULL,
    step smallint NOT NULL,
    approver character varying(100) NOT NULL,
    createdat timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updatedat timestamp with time zone,
    created_by character varying(100),
    updated_by character varying(100),
    CONSTRAINT eappr_line01t_step_check CHECK ((step >= 1))
);


--
-- Name: eappr_step01t; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eappr_step01t (
    companyid character varying(20) NOT NULL,
    companyname character varying(100),
    docno character varying(30) NOT NULL,
    step smallint NOT NULL,
    approver character varying(100) NOT NULL,
    status character varying(10) DEFAULT 'WAIT'::character varying NOT NULL,
    acted_at timestamp with time zone,
    comment character varying(500),
    createdat timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updatedat timestamp with time zone,
    created_by character varying(100),
    updated_by character varying(100),
    CONSTRAINT eappr_step01t_status_check CHECK (((status)::text = ANY ((ARRAY['WAIT'::character varying, 'APPROVED'::character varying, 'REJECTED'::character varying])::text[])))
);


--
-- Name: inbound01t; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inbound01t (
    companyid character varying(50) NOT NULL,
    companyname character varying(50) NOT NULL,
    receiptno character varying(100) NOT NULL,
    receptdate date NOT NULL,
    customcode character varying(50) NOT NULL,
    customname character varying(100),
    description character varying(500),
    subulyn character varying(10) DEFAULT 'N'::character varying,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone,
    manager character varying(100),
    created_by character varying(100),
    updated_by character varying(100)
);


--
-- Name: COLUMN inbound01t.created_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.inbound01t.created_by IS '등록자';


--
-- Name: COLUMN inbound01t.updated_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.inbound01t.updated_by IS '수정자';


--
-- Name: inbound02t; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inbound02t (
    companyid character varying(50) NOT NULL,
    companyname character varying(50) NOT NULL,
    receiptno character varying(100) NOT NULL,
    lineno integer NOT NULL,
    itemcode character varying(100) NOT NULL,
    itemname character varying(150) NOT NULL,
    productname character varying(100),
    surfacecode character varying(100),
    surfacename character varying(100),
    materialcode character varying(100) NOT NULL,
    materialname character varying(100) NOT NULL,
    myrtle numeric(15,3),
    thickness numeric(15,3),
    width numeric(15,3),
    length numeric(15,3),
    qty numeric(15,3),
    qtyunit character varying(20) NOT NULL,
    weight numeric(15,3) NOT NULL,
    unit character varying(20) NOT NULL,
    unitprice numeric(15,2) NOT NULL,
    supplyamt numeric(15,2),
    vat numeric(15,2),
    unitamt numeric(15,2),
    warehousecode character varying(50),
    warehousecodename character varying(50),
    description character varying(500),
    manager character varying(100),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone,
    created_by character varying(100),
    updated_by character varying(100),
    CONSTRAINT inbound02t_qty_check CHECK ((qty > (0)::numeric)),
    CONSTRAINT inbound02t_unitprice_check CHECK ((unitprice >= (0)::numeric)),
    CONSTRAINT inbound02t_weight_check CHECK ((weight > (0)::numeric))
);


--
-- Name: COLUMN inbound02t.created_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.inbound02t.created_by IS '등록자';


--
-- Name: COLUMN inbound02t.updated_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.inbound02t.updated_by IS '수정자';


--
-- Name: inbound03t; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inbound03t (
    companyid character varying(50) NOT NULL,
    companyname character varying(100) NOT NULL,
    receiptno character varying(100) NOT NULL,
    lineno integer NOT NULL,
    costcode character varying(50),
    costname character varying(100) NOT NULL,
    supplyamt numeric(15,3) DEFAULT 0 NOT NULL,
    vat numeric(15,3) DEFAULT 0 NOT NULL,
    totalamt numeric(15,3) DEFAULT 0 NOT NULL,
    customcode character varying(100) NOT NULL,
    customname character varying(150) NOT NULL,
    purchaseyn character(1) DEFAULT 'N'::bpchar NOT NULL,
    description character varying(500),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone,
    created_by character varying(100),
    updated_by character varying(100),
    CONSTRAINT inbound03t_check CHECK ((totalamt = (supplyamt + vat))),
    CONSTRAINT inbound03t_lineno_check CHECK ((lineno > 0)),
    CONSTRAINT inbound03t_purchaseyn_check CHECK ((purchaseyn = ANY (ARRAY['Y'::bpchar, 'N'::bpchar]))),
    CONSTRAINT inbound03t_supplyamt_check CHECK ((supplyamt >= (0)::numeric)),
    CONSTRAINT inbound03t_totalamt_check CHECK ((totalamt >= (0)::numeric)),
    CONSTRAINT inbound03t_vat_check CHECK ((vat >= (0)::numeric))
);


--
-- Name: COLUMN inbound03t.created_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.inbound03t.created_by IS '등록자';


--
-- Name: COLUMN inbound03t.updated_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.inbound03t.updated_by IS '수정자';


--
-- Name: iniop01t; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.iniop01t (
    companyid character varying(50) CONSTRAINT iniop01t__new_companyid_not_null NOT NULL,
    companyname character varying(50) CONSTRAINT iniop01t__new_companyname_not_null NOT NULL,
    customcode character varying(50),
    customname character varying(100),
    iniodate date CONSTRAINT iniop01t__new_iniodate_not_null NOT NULL,
    iniotype character varying(50) CONSTRAINT iniop01t__new_iniotype_not_null NOT NULL,
    iniokind character varying(12) CONSTRAINT iniop01t__new_iniokind_not_null NOT NULL,
    receiptno character varying(100) CONSTRAINT iniop01t__new_receiptno_not_null NOT NULL,
    lineno integer CONSTRAINT iniop01t__new_lineno_not_null NOT NULL,
    itemcode character varying(100) CONSTRAINT iniop01t__new_itemcode_not_null NOT NULL,
    itemname character varying(150) CONSTRAINT iniop01t__new_itemname_not_null NOT NULL,
    productname character varying(150),
    materialcode character varying(100) CONSTRAINT iniop01t__new_materialcode_not_null NOT NULL,
    materialname character varying(100) CONSTRAINT iniop01t__new_materialname_not_null NOT NULL,
    surfacecode character varying(100),
    surfacename character varying(100),
    myrtle numeric(15,3),
    manager character varying(100),
    thickness numeric(15,3) DEFAULT 0 CONSTRAINT iniop01t__new_thickness_not_null NOT NULL,
    width numeric(15,3) DEFAULT 0 CONSTRAINT iniop01t__new_width_not_null NOT NULL,
    length numeric(15,3) DEFAULT 0 CONSTRAINT iniop01t__new_length_not_null NOT NULL,
    qty numeric(15,3) CONSTRAINT iniop01t__new_qty_not_null NOT NULL,
    qtyunit character varying(20) CONSTRAINT iniop01t__new_qtyunit_not_null NOT NULL,
    unit character varying(20),
    unitprice numeric(15,2),
    supplyamt numeric(15,2),
    vat numeric(15,2),
    unitamt numeric(15,2),
    costamt numeric(15,2) DEFAULT 0 CONSTRAINT iniop01t__new_costamt_not_null1 NOT NULL,
    expamt numeric(15,2) DEFAULT 0 CONSTRAINT iniop01t__new_expamt_not_null NOT NULL,
    feeamt numeric(15,2) DEFAULT 0 CONSTRAINT iniop01t__new_feeamt_not_null NOT NULL,
    weight numeric(15,3) CONSTRAINT iniop01t__new_weight_not_null NOT NULL,
    warehousecode character varying(50) CONSTRAINT iniop01t__new_warehousecode_not_null NOT NULL,
    warehousecodename character varying(50) CONSTRAINT iniop01t__new_warehousecodename_not_null NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP CONSTRAINT iniop01t__new_created_at_not_null NOT NULL,
    updated_at timestamp with time zone,
    created_by character varying(100),
    updated_by character varying(100),
    CONSTRAINT ck_iniop01t_iniokind CHECK (((((iniotype)::text = 'ST'::text) AND ((iniokind)::text = 'ST'::text)) OR (((iniotype)::text = 'IN'::text) AND ((iniokind)::text = ANY (ARRAY[('IN'::character varying)::text, ('PROCESS_IN'::character varying)::text, ('MOVE_IN'::character varying)::text]))) OR (((iniotype)::text = 'OUT'::text) AND ((iniokind)::text = ANY (ARRAY[('OUT'::character varying)::text, ('PROCESS_OUT'::character varying)::text, ('MOVE_OUT'::character varying)::text]))))),
    CONSTRAINT iniop01t_unitprice_check CHECK ((unitprice >= (0)::numeric)),
    CONSTRAINT iniop01t_weight_check CHECK ((weight >= (0)::numeric))
);


--
-- Name: inoutmove01t; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inoutmove01t (
    companyid character varying(50) NOT NULL,
    companyname character varying(100) NOT NULL,
    receiptno character varying(100) NOT NULL,
    receptdate date DEFAULT CURRENT_DATE NOT NULL,
    fromwarehousecode character varying(100) NOT NULL,
    fromwarehousename character varying(150) NOT NULL,
    towarehousecode character varying(100) NOT NULL,
    towarehousename character varying(150) NOT NULL,
    manager character varying(100),
    description character varying(500),
    subulyn character(1) DEFAULT 'N'::bpchar NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone,
    created_by character varying(100),
    updated_by character varying(100),
    CONSTRAINT inoutmove01t_check CHECK (((fromwarehousecode)::text <> (towarehousecode)::text)),
    CONSTRAINT inoutmove01t_subulyn_check CHECK ((subulyn = ANY (ARRAY['Y'::bpchar, 'N'::bpchar])))
);


--
-- Name: inoutmove02t; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inoutmove02t (
    companyid character varying(50) NOT NULL,
    companyname character varying(100) NOT NULL,
    receiptno character varying(100) NOT NULL,
    lineno integer NOT NULL,
    stocksourcetype character varying(20) NOT NULL,
    stocksourceno character varying(100) NOT NULL,
    stocksourceline integer NOT NULL,
    itemcode character varying(100) NOT NULL,
    itemname character varying(150) NOT NULL,
    productname character varying(150),
    surfacecode character varying(100),
    surfacename character varying(100),
    materialcode character varying(100),
    materialname character varying(100),
    myrtle numeric(15,3),
    thickness numeric(15,3),
    width numeric(15,3),
    length numeric(15,3),
    qty numeric(15,3) NOT NULL,
    qtyunit character varying(20),
    weight numeric(15,3) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone,
    created_by character varying(100),
    updated_by character varying(100),
    CONSTRAINT inoutmove02t_lineno_check CHECK ((lineno > 0)),
    CONSTRAINT inoutmove02t_qty_check CHECK ((qty > (0)::numeric)),
    CONSTRAINT inoutmove02t_stocksourceline_check CHECK ((stocksourceline > 0)),
    CONSTRAINT inoutmove02t_weight_check CHECK ((weight > (0)::numeric))
);


--
-- Name: itemcode01t; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.itemcode01t (
    companyid character varying(50) NOT NULL,
    companyname character varying(50) NOT NULL,
    itemcode character varying(100) NOT NULL,
    itemname character varying(150) NOT NULL,
    itemtypecode character varying(100),
    itemtypecodenm character varying(100),
    use_yn character(10) DEFAULT 'Y'::bpchar NOT NULL,
    description character varying(500),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone,
    created_by character varying(100),
    updated_by character varying(100)
);


--
-- Name: COLUMN itemcode01t.created_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.itemcode01t.created_by IS '등록자';


--
-- Name: COLUMN itemcode01t.updated_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.itemcode01t.updated_by IS '수정자';


--
-- Name: itemprocessrule01t; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.itemprocessrule01t (
    companyid character varying(50) NOT NULL,
    companyname character varying(50) NOT NULL,
    itemcode character varying(100) NOT NULL,
    itemname character varying(150) NOT NULL,
    itemtypecode character varying(100) NOT NULL,
    itemtypecodenm character varying(100) NOT NULL,
    processid character varying(100) NOT NULL,
    processnm character varying(100) NOT NULL,
    steelgradeyn character(1) DEFAULT 'N'::bpchar NOT NULL,
    surfaceyn character(1) DEFAULT 'N'::bpchar NOT NULL,
    thicknessyn character(1) DEFAULT 'N'::bpchar NOT NULL,
    widthyn character(1) DEFAULT 'N'::bpchar NOT NULL,
    lengthyn character(1) DEFAULT 'N'::bpchar NOT NULL,
    description character varying(500),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone,
    created_by character varying(100),
    updated_by character varying(100),
    CONSTRAINT itemprocessrule01t_lengthyn_check CHECK ((lengthyn = ANY (ARRAY['Y'::bpchar, 'N'::bpchar]))),
    CONSTRAINT itemprocessrule01t_steelgradeyn_check CHECK ((steelgradeyn = ANY (ARRAY['Y'::bpchar, 'N'::bpchar]))),
    CONSTRAINT itemprocessrule01t_surfaceyn_check CHECK ((surfaceyn = ANY (ARRAY['Y'::bpchar, 'N'::bpchar]))),
    CONSTRAINT itemprocessrule01t_thicknessyn_check CHECK ((thicknessyn = ANY (ARRAY['Y'::bpchar, 'N'::bpchar]))),
    CONSTRAINT itemprocessrule01t_widthyn_check CHECK ((widthyn = ANY (ARRAY['Y'::bpchar, 'N'::bpchar])))
);


--
-- Name: menucatalog01t; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.menucatalog01t (
    menuid character varying(60) NOT NULL,
    menuname character varying(100) NOT NULL,
    access_scope character varying(20) DEFAULT 'COMPANY'::character varying NOT NULL,
    assignable boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    useyn character(1) DEFAULT 'Y'::bpchar NOT NULL,
    CONSTRAINT menucatalog01t_access_scope_check CHECK (((access_scope)::text = ANY ((ARRAY['PLATFORM'::character varying, 'COMPANY'::character varying])::text[]))),
    CONSTRAINT menucatalog01t_useyn_check CHECK ((useyn = ANY (ARRAY['Y'::bpchar, 'N'::bpchar])))
);


--
-- Name: monthclose01t; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.monthclose01t (
    companyid character varying(50) NOT NULL,
    companyname character varying(100) NOT NULL,
    closemonth date NOT NULL,
    closed_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    closed_by character varying(100),
    CONSTRAINT monthclose01t_first_day CHECK ((EXTRACT(day FROM closemonth) = (1)::numeric))
);


--
-- Name: outbound01t; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outbound01t (
    companyid character varying(50) CONSTRAINT outbound01t__new_companyid_not_null NOT NULL,
    companyname character varying(50) CONSTRAINT outbound01t__new_companyname_not_null NOT NULL,
    receiptno character varying(100) CONSTRAINT outbound01t__new_receiptno_not_null NOT NULL,
    receptdate date CONSTRAINT outbound01t__new_receptdate_not_null NOT NULL,
    customcode character varying(50) CONSTRAINT outbound01t__new_customcode_not_null NOT NULL,
    customname character varying(100),
    manager character varying(100),
    destination character varying(500),
    description character varying(500),
    subulyn character varying(10) DEFAULT 'N'::character varying,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP CONSTRAINT outbound01t__new_created_at_not_null NOT NULL,
    updated_at timestamp with time zone,
    created_by character varying(100),
    updated_by character varying(100)
);


--
-- Name: COLUMN outbound01t.destination; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.outbound01t.destination IS '착지 (송장 받는 곳 주소)';


--
-- Name: COLUMN outbound01t.created_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.outbound01t.created_by IS '등록자';


--
-- Name: COLUMN outbound01t.updated_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.outbound01t.updated_by IS '수정자';


--
-- Name: outbound02t; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outbound02t (
    companyid character varying(50) CONSTRAINT outbound02t__new_companyid_not_null NOT NULL,
    companyname character varying(50) CONSTRAINT outbound02t__new_companyname_not_null NOT NULL,
    receiptno character varying(100) CONSTRAINT outbound02t__new_receiptno_not_null NOT NULL,
    lineno integer CONSTRAINT outbound02t__new_lineno_not_null NOT NULL,
    stocksourcetype character varying(20) CONSTRAINT outbound02t__new_stocksourcetype_not_null NOT NULL,
    stocksourceno character varying(100) CONSTRAINT outbound02t__new_stocksourceno_not_null NOT NULL,
    stocksourceline integer CONSTRAINT outbound02t__new_stocksourceline_not_null NOT NULL,
    itemcode character varying(100) CONSTRAINT outbound02t__new_itemcode_not_null NOT NULL,
    itemname character varying(150) CONSTRAINT outbound02t__new_itemname_not_null NOT NULL,
    productname character varying(100),
    surfacecode character varying(100),
    surfacename character varying(100),
    materialcode character varying(100) CONSTRAINT outbound02t__new_materialcode_not_null NOT NULL,
    materialname character varying(100) CONSTRAINT outbound02t__new_materialname_not_null NOT NULL,
    myrtle numeric(15,3),
    thickness numeric(15,3),
    width numeric(15,3),
    length numeric(15,3),
    qty numeric(15,3),
    qtyunit character varying(20) CONSTRAINT outbound02t__new_qtyunit_not_null NOT NULL,
    weight numeric(15,3) CONSTRAINT outbound02t__new_weight_not_null NOT NULL,
    adjweight numeric(15,3) DEFAULT 0 CONSTRAINT outbound02t__new_adjweight_not_null NOT NULL,
    unit character varying(20) CONSTRAINT outbound02t__new_unit_not_null NOT NULL,
    unitprice numeric(15,2) CONSTRAINT outbound02t__new_unitprice_not_null NOT NULL,
    supplyamt numeric(15,2),
    vat numeric(15,2),
    unitamt numeric(15,2),
    warehousecode character varying(50),
    warehousecodename character varying(50),
    description character varying(500),
    manager character varying(100),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP CONSTRAINT outbound02t__new_created_at_not_null NOT NULL,
    updated_at timestamp with time zone,
    created_by character varying(100),
    updated_by character varying(100),
    CONSTRAINT outbound02t_adjweight_check CHECK (((weight - adjweight) > (0)::numeric)),
    CONSTRAINT outbound02t_qty_check CHECK ((qty > (0)::numeric)),
    CONSTRAINT outbound02t_unitprice_check CHECK ((unitprice >= (0)::numeric)),
    CONSTRAINT outbound02t_weight_check CHECK ((weight > (0)::numeric))
);


--
-- Name: COLUMN outbound02t.weight; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.outbound02t.weight IS '총중량 (중량 + 조정, 현재고·수불장 반영)';


--
-- Name: COLUMN outbound02t.adjweight; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.outbound02t.adjweight IS '조정(Kg)';


--
-- Name: COLUMN outbound02t.created_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.outbound02t.created_by IS '등록자';


--
-- Name: COLUMN outbound02t.updated_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.outbound02t.updated_by IS '수정자';


--
-- Name: outbound03t; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outbound03t (
    companyid character varying(50) NOT NULL,
    companyname character varying(100) NOT NULL,
    receiptno character varying(100) NOT NULL,
    lineno integer NOT NULL,
    costcode character varying(50),
    costname character varying(100) NOT NULL,
    supplyamt numeric(15,3) DEFAULT 0 NOT NULL,
    vat numeric(15,3) DEFAULT 0 NOT NULL,
    totalamt numeric(15,3) DEFAULT 0 NOT NULL,
    customcode character varying(100) NOT NULL,
    customname character varying(150) NOT NULL,
    purchaseyn character(1) DEFAULT 'N'::bpchar NOT NULL,
    description character varying(500),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone,
    created_by character varying(100),
    updated_by character varying(100),
    CONSTRAINT outbound03t_check CHECK ((totalamt = (supplyamt + vat))),
    CONSTRAINT outbound03t_lineno_check CHECK ((lineno > 0)),
    CONSTRAINT outbound03t_purchaseyn_check CHECK ((purchaseyn = ANY (ARRAY['Y'::bpchar, 'N'::bpchar]))),
    CONSTRAINT outbound03t_supplyamt_check CHECK ((supplyamt >= (0)::numeric)),
    CONSTRAINT outbound03t_totalamt_check CHECK ((totalamt >= (0)::numeric)),
    CONSTRAINT outbound03t_vat_check CHECK ((vat >= (0)::numeric))
);


--
-- Name: COLUMN outbound03t.created_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.outbound03t.created_by IS '등록자';


--
-- Name: COLUMN outbound03t.updated_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.outbound03t.updated_by IS '수정자';


--
-- Name: pay_slip01t; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pay_slip01t (
    companyid character varying(20) NOT NULL,
    companyname character varying(100),
    payym character varying(7) NOT NULL,
    useremail character varying(100) NOT NULL,
    paydate date NOT NULL,
    base_monthly bigint DEFAULT 0 NOT NULL,
    family_cnt smallint DEFAULT 1 NOT NULL,
    child_cnt smallint DEFAULT 0 NOT NULL,
    tax_rate smallint DEFAULT 100 NOT NULL,
    pay_base bigint DEFAULT 0 NOT NULL,
    pay_position bigint DEFAULT 0 NOT NULL,
    pay_overtime bigint DEFAULT 0 NOT NULL,
    pay_bonus bigint DEFAULT 0 NOT NULL,
    pay_leave bigint DEFAULT 0 NOT NULL,
    pay_etc bigint DEFAULT 0 NOT NULL,
    pay_meal bigint DEFAULT 0 NOT NULL,
    pay_car bigint DEFAULT 0 NOT NULL,
    pay_childcare bigint DEFAULT 0 NOT NULL,
    ded_pension bigint DEFAULT 0 NOT NULL,
    ded_health bigint DEFAULT 0 NOT NULL,
    ded_care bigint DEFAULT 0 NOT NULL,
    ded_employ bigint DEFAULT 0 NOT NULL,
    ded_income bigint DEFAULT 0 NOT NULL,
    ded_local bigint DEFAULT 0 NOT NULL,
    ded_etc bigint DEFAULT 0 NOT NULL,
    bankname character varying(50) DEFAULT ''::character varying NOT NULL,
    accountno character varying(50) DEFAULT ''::character varying NOT NULL,
    remark character varying(200) DEFAULT ''::character varying NOT NULL,
    closeyn character varying(1) DEFAULT 'N'::character varying NOT NULL,
    createdat timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updatedat timestamp with time zone,
    created_by character varying(100),
    updated_by character varying(100),
    CONSTRAINT pay_slip01t_base_monthly_check CHECK ((base_monthly >= 0)),
    CONSTRAINT pay_slip01t_child_cnt_check CHECK (((child_cnt >= 0) AND (child_cnt <= 20))),
    CONSTRAINT pay_slip01t_closeyn_check CHECK (((closeyn)::text = ANY ((ARRAY['Y'::character varying, 'N'::character varying])::text[]))),
    CONSTRAINT pay_slip01t_family_cnt_check CHECK (((family_cnt >= 1) AND (family_cnt <= 20))),
    CONSTRAINT pay_slip01t_payym_check CHECK (((payym)::text ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'::text)),
    CONSTRAINT pay_slip01t_tax_rate_check CHECK ((tax_rate = ANY (ARRAY[80, 100, 120])))
);


--
-- Name: process01t; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.process01t (
    companyid character varying(50) NOT NULL,
    companyname character varying(50) NOT NULL,
    processno character varying(100) NOT NULL,
    processdate date NOT NULL,
    customcode character varying(100) NOT NULL,
    customname character varying(150) NOT NULL,
    warehousecode character varying(50) NOT NULL,
    warehousecodename character varying(100) NOT NULL,
    manager character varying(100),
    subulyn character(1) DEFAULT 'N'::bpchar NOT NULL,
    description character varying(500),
    createdat timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updatedat timestamp with time zone,
    created_by character varying(100),
    updated_by character varying(100),
    planno character varying(30),
    CONSTRAINT process01t_processno_check CHECK (((processno)::text ~~ 'PR%'::text)),
    CONSTRAINT process01t_subulyn_check CHECK ((subulyn = ANY (ARRAY['Y'::bpchar, 'N'::bpchar])))
);


--
-- Name: process02t; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.process02t (
    companyid character varying(50) NOT NULL,
    companyname character varying(100) NOT NULL,
    processno character varying(100) NOT NULL,
    lineno integer NOT NULL,
    linetype character varying(12) NOT NULL,
    levelno integer NOT NULL,
    parentlineno integer,
    sourcelineno integer NOT NULL,
    stocksourcetype character varying(20),
    stocksourceno character varying(100),
    stocksourceline integer,
    sourcewarehousecode character varying(50),
    sourcewarehousecodename character varying(50),
    itemcode character varying(100) NOT NULL,
    itemname character varying(150) NOT NULL,
    productname character varying(150),
    materialcode character varying(100),
    materialname character varying(100),
    surfacecode character varying(100),
    surfacename character varying(100),
    myrtle character varying(100),
    thickness numeric(18,3),
    width numeric(18,3),
    length numeric(18,3),
    qty numeric(18,3) DEFAULT 0 NOT NULL,
    qtyunit character varying(20),
    weight numeric(18,3) DEFAULT 0 NOT NULL,
    processid character varying(100),
    processcodename character varying(100),
    unit character varying(20),
    unitprice numeric(18,3) DEFAULT 0 NOT NULL,
    supplyamt numeric(18,2) DEFAULT 0 NOT NULL,
    vat numeric(18,2) DEFAULT 0 NOT NULL,
    unitamt numeric(18,2) DEFAULT 0 NOT NULL,
    description character varying(500),
    createdat timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updatedat timestamp with time zone,
    created_by character varying(100),
    updated_by character varying(100),
    lossweight numeric(18,3) DEFAULT 0 NOT NULL,
    CONSTRAINT process02t_check CHECK (((((linetype)::text = 'SOURCE'::text) AND (levelno = 0) AND (parentlineno IS NULL) AND (sourcelineno = lineno) AND (stocksourcetype IS NOT NULL) AND (stocksourceno IS NOT NULL) AND (stocksourceline IS NOT NULL) AND (stocksourceline > 0) AND (sourcewarehousecode IS NOT NULL) AND (sourcewarehousecodename IS NOT NULL) AND (qty >= (0)::numeric) AND (weight > (0)::numeric) AND (processid IS NULL) AND (lossweight = (0)::numeric)) OR (((linetype)::text = 'PRODUCT'::text) AND (levelno > 0) AND (parentlineno IS NOT NULL) AND (sourcelineno < lineno) AND (stocksourcetype IS NULL) AND (stocksourceno IS NULL) AND (stocksourceline IS NULL) AND (sourcewarehousecode IS NULL) AND (sourcewarehousecodename IS NULL)))),
    CONSTRAINT process02t_check1 CHECK (((parentlineno IS NULL) OR (parentlineno < lineno))),
    CONSTRAINT process02t_check2 CHECK ((((linetype)::text <> 'PRODUCT'::text) OR ((processid IS NOT NULL) AND (processcodename IS NOT NULL)))),
    CONSTRAINT process02t_levelno_check CHECK ((levelno >= 0)),
    CONSTRAINT process02t_lineno_check CHECK ((lineno > 0)),
    CONSTRAINT process02t_linetype_check CHECK (((linetype)::text = ANY ((ARRAY['SOURCE'::character varying, 'PRODUCT'::character varying])::text[]))),
    CONSTRAINT process02t_lossweight_check CHECK ((lossweight >= (0)::numeric)),
    CONSTRAINT process02t_qty_check CHECK ((qty >= (0)::numeric)),
    CONSTRAINT process02t_supplyamt_check CHECK ((supplyamt >= (0)::numeric)),
    CONSTRAINT process02t_unitamt_check CHECK ((unitamt >= (0)::numeric)),
    CONSTRAINT process02t_unitprice_check CHECK ((unitprice >= (0)::numeric)),
    CONSTRAINT process02t_vat_check CHECK ((vat >= (0)::numeric)),
    CONSTRAINT process02t_weight_check CHECK ((weight >= (0)::numeric))
);


--
-- Name: receiptpayment01t; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.receiptpayment01t (
    companyid character varying(50) NOT NULL,
    companyname character varying(100) NOT NULL,
    receiptno character varying(100) NOT NULL,
    receiptdate date NOT NULL,
    transactiontype character varying(10) NOT NULL,
    customcode character varying(100) NOT NULL,
    customname character varying(150) NOT NULL,
    manager character varying(100),
    description character varying(500),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone,
    created_by character varying(100),
    updated_by character varying(100)
);


--
-- Name: COLUMN receiptpayment01t.created_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.receiptpayment01t.created_by IS '등록자';


--
-- Name: COLUMN receiptpayment01t.updated_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.receiptpayment01t.updated_by IS '수정자';


--
-- Name: receiptpayment02t; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.receiptpayment02t (
    companyid character varying(50) NOT NULL,
    companyname character varying(100) NOT NULL,
    receiptno character varying(100) NOT NULL,
    lineno integer NOT NULL,
    cashamt numeric(15,3) DEFAULT 0 NOT NULL,
    instrumentamt numeric(15,3) DEFAULT 0 NOT NULL,
    bankamt numeric(15,3) DEFAULT 0 NOT NULL,
    cardamt numeric(15,3) DEFAULT 0 NOT NULL,
    offsetamt numeric(15,3) DEFAULT 0 NOT NULL,
    lossamt numeric(15,3) DEFAULT 0 NOT NULL,
    chargeamt numeric(15,3) DEFAULT 0 NOT NULL,
    totalamt numeric(15,3) DEFAULT 0 NOT NULL,
    instrumenttype character varying(20),
    instrumentno character varying(100),
    issuedate date,
    issuercompany character varying(150),
    issuer character varying(100),
    issuekind character varying(20),
    maturitydate date,
    custodyaccount character varying(100),
    custodybank character varying(100),
    instrumentstatus character varying(30),
    processdate date,
    discountfee numeric(15,3) DEFAULT 0 NOT NULL,
    processmemo character varying(500),
    description character varying(500),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone,
    created_by character varying(100),
    updated_by character varying(100),
    source_receiptno character varying(30),
    source_lineno integer,
    CONSTRAINT receiptpayment02t_bankamt_check CHECK ((bankamt >= (0)::numeric)),
    CONSTRAINT receiptpayment02t_cardamt_check CHECK ((cardamt >= (0)::numeric)),
    CONSTRAINT receiptpayment02t_cashamt_check CHECK ((cashamt >= (0)::numeric)),
    CONSTRAINT receiptpayment02t_chargeamt_check CHECK ((chargeamt >= (0)::numeric)),
    CONSTRAINT receiptpayment02t_check CHECK ((totalamt = (((cashamt + instrumentamt) + bankamt) + cardamt))),
    CONSTRAINT receiptpayment02t_instrumentamt_check CHECK ((instrumentamt >= (0)::numeric)),
    CONSTRAINT receiptpayment02t_lineno_check CHECK ((lineno > 0)),
    CONSTRAINT receiptpayment02t_lossamt_check CHECK ((lossamt >= (0)::numeric)),
    CONSTRAINT receiptpayment02t_offsetamt_check CHECK ((offsetamt >= (0)::numeric)),
    CONSTRAINT receiptpayment02t_totalamt_check CHECK ((totalamt >= (0)::numeric))
);


--
-- Name: standstock01t; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.standstock01t (
    companyid character varying(50) NOT NULL,
    companyname character varying(50) NOT NULL,
    customcode character varying(50),
    customname character varying(100),
    standdate date NOT NULL,
    lineno integer NOT NULL,
    itemcode character varying(100) NOT NULL,
    itemname character varying(150) NOT NULL,
    productname character varying(100),
    surfacecode character varying(100),
    surfacename character varying(100),
    materialcode character varying(100) NOT NULL,
    materialname character varying(100) NOT NULL,
    myrtle numeric(15,3),
    thickness numeric(15,3),
    width numeric(15,3),
    length numeric(15,3),
    qty numeric(15,3),
    qtyunit character varying(20) NOT NULL,
    weight numeric(15,3) NOT NULL,
    warehousecode character varying(50) NOT NULL,
    warehousecodename character varying(50) NOT NULL,
    unit character varying(20),
    unitprice numeric(15,2),
    supplyamt numeric(15,2),
    vat numeric(15,2),
    unitamt numeric(15,2),
    description character varying(500),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone,
    created_by character varying(100),
    updated_by character varying(100),
    CONSTRAINT standstock01t_qty_check CHECK ((qty > (0)::numeric)),
    CONSTRAINT standstock01t_unitprice_check CHECK ((unitprice >= (0)::numeric)),
    CONSTRAINT standstock01t_weight_check CHECK ((weight > (0)::numeric))
);


--
-- Name: user01t; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user01t (
    companyid character varying(100) NOT NULL,
    email character varying(50) NOT NULL,
    username character varying(20),
    password character varying(100),
    authority character varying(50),
    useyn character varying(50),
    empno character varying(20),
    worktype character varying(10) DEFAULT 'REGULAR'::character varying,
    team character varying(50),
    "position" character varying(30),
    birthdate date,
    mobile character varying(20),
    hiredate date,
    retiredate date,
    photoimage bytea,
    photomime character varying(50),
    createdat timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updatedat timestamp without time zone,
    created_by character varying(100),
    updated_by character varying(100),
    session_id character varying(64),
    usercode character varying(10) NOT NULL,
    CONSTRAINT user01t_retiredate_chk CHECK (((retiredate IS NULL) OR (hiredate IS NULL) OR (retiredate >= hiredate))),
    CONSTRAINT user01t_worktype_chk CHECK (((worktype)::text = ANY ((ARRAY['REGULAR'::character varying, 'CONTRACT'::character varying])::text[])))
);


--
-- Name: TABLE user01t; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.user01t IS '사용자 — 계정은 어드민>고객사관리, 인사 기본정보는 설정>사용자관리에서 입력. 메뉴권한은 usermenupermission01t (companyid, email 로 연결)';


--
-- Name: COLUMN user01t.companyid; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user01t.companyid IS '회사 코드 (company01t.companyid). 001 = 플랫폼 운영사 [고객사관리]';


--
-- Name: COLUMN user01t.email; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user01t.email IS '로그인 ID (이메일, 전체에서 중복 불가) [고객사관리 입력 / 사용자관리 아이디로 보기만]';


--
-- Name: COLUMN user01t.username; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user01t.username IS '사용자명 [고객사관리 입력 / 사용자관리 이름으로 보기만]';


--
-- Name: COLUMN user01t.password; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user01t.password IS '비밀번호 해시 (pbkdf2) [고객사관리 · 비밀번호 변경]';


--
-- Name: COLUMN user01t.authority; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user01t.authority IS '권한 MASTER(001 플랫폼 관리자) / SUBMASTER(고객사 관리자) / USER(일반) [고객사관리]';


--
-- Name: COLUMN user01t.useyn; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user01t.useyn IS '계정 사용 여부 Y/N, N 이면 로그인 불가 [고객사관리 입력 / 사용자관리 계정사용으로 보기만]';


--
-- Name: COLUMN user01t.empno; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user01t.empno IS '사원번호 (회사 안에서 중복 불가) [사용자관리]';


--
-- Name: COLUMN user01t.worktype; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user01t.worktype IS '근무유형 REGULAR 정규직 / CONTRACT 계약직 [사용자관리]';


--
-- Name: COLUMN user01t.team; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user01t.team IS '부서 [사용자관리]';


--
-- Name: COLUMN user01t."position"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user01t."position" IS '직급 [사용자관리]';


--
-- Name: COLUMN user01t.birthdate; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user01t.birthdate IS '생년월일 [사용자관리]';


--
-- Name: COLUMN user01t.mobile; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user01t.mobile IS '휴대폰번호 010-0000-0000 [사용자관리]';


--
-- Name: COLUMN user01t.hiredate; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user01t.hiredate IS '입사일 [사용자관리]';


--
-- Name: COLUMN user01t.retiredate; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user01t.retiredate IS '퇴사일, 오늘 이전이면 목록 상태가 퇴사 [사용자관리]';


--
-- Name: COLUMN user01t.photoimage; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user01t.photoimage IS '사진 이미지 (JPG · PNG, 500KB 이하) [사용자관리]';


--
-- Name: COLUMN user01t.photomime; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user01t.photomime IS '사진 형식 image/jpeg, image/png [사용자관리]';


--
-- Name: COLUMN user01t.createdat; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user01t.createdat IS '등록일시 (계정 생성 시각)';


--
-- Name: COLUMN user01t.updatedat; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user01t.updatedat IS '수정일시 (고객사관리 · 사용자관리 저장 시 갱신)';


--
-- Name: COLUMN user01t.created_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user01t.created_by IS '등록자 (계정을 만든 관리자 로그인 이메일)';


--
-- Name: COLUMN user01t.updated_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user01t.updated_by IS '수정자 (마지막으로 저장한 사람 로그인 이메일)';


--
-- Name: usermenufavorite01t; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.usermenufavorite01t (
    companyid character varying(50) NOT NULL,
    useremail character varying(50) NOT NULL,
    menuid character varying(60) NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: usermenupermission01t; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.usermenupermission01t (
    companyid character varying(50) NOT NULL,
    useremail character varying(50) NOT NULL,
    menuid character varying(60) NOT NULL,
    useyn character(1) DEFAULT 'Y'::bpchar NOT NULL,
    createdby character varying(255),
    createdat timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updatedby character varying(255),
    updatedat timestamp with time zone,
    CONSTRAINT usermenupermission01t_useyn_check CHECK ((useyn = ANY (ARRAY['Y'::bpchar, 'N'::bpchar])))
);


--
-- Name: aiorder01t aiorder01t_companyid_analysis_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aiorder01t
    ADD CONSTRAINT aiorder01t_companyid_analysis_request_id_key UNIQUE (companyid, analysis_request_id);


--
-- Name: aiorder01t aiorder01t_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aiorder01t
    ADD CONSTRAINT aiorder01t_pkey PRIMARY KEY (companyid, orderid);


--
-- Name: aiorder02t aiorder02t_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aiorder02t
    ADD CONSTRAINT aiorder02t_pkey PRIMARY KEY (companyid, orderid, lineno);


--
-- Name: aiorder03t aiorder03t_companyid_orderid_lineno_stocksourcetype_stockso_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aiorder03t
    ADD CONSTRAINT aiorder03t_companyid_orderid_lineno_stocksourcetype_stockso_key UNIQUE (companyid, orderid, lineno, stocksourcetype, stocksourceno, stocksourceline);


--
-- Name: aiorder03t aiorder03t_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aiorder03t
    ADD CONSTRAINT aiorder03t_pkey PRIMARY KEY (companyid, orderid, lineno, matchlineno);


--
-- Name: aiorderanalysis01t aiorderanalysis01t_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aiorderanalysis01t
    ADD CONSTRAINT aiorderanalysis01t_pkey PRIMARY KEY (request_id);


--
-- Name: aiorderrule01t aiorderrule01t_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aiorderrule01t
    ADD CONSTRAINT aiorderrule01t_pkey PRIMARY KEY (ruleid);


--
-- Name: aiorderusage01t aiorderusage01t_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aiorderusage01t
    ADD CONSTRAINT aiorderusage01t_pkey PRIMARY KEY (request_hash);


--
-- Name: aiplan01t aiplan01t_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aiplan01t
    ADD CONSTRAINT aiplan01t_pkey PRIMARY KEY (companyid, planno);


--
-- Name: aiplan02t aiplan02t_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aiplan02t
    ADD CONSTRAINT aiplan02t_pkey PRIMARY KEY (companyid, planno, lineno);


--
-- Name: approval_request01t approval_request01t_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_request01t
    ADD CONSTRAINT approval_request01t_pkey PRIMARY KEY (companyid, requestno);


--
-- Name: board01t board01t_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board01t
    ADD CONSTRAINT board01t_pkey PRIMARY KEY (id);


--
-- Name: boardreply01t boardreply01t_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.boardreply01t
    ADD CONSTRAINT boardreply01t_pkey PRIMARY KEY (id);


--
-- Name: codemaster01t codemaster01t_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.codemaster01t
    ADD CONSTRAINT codemaster01t_pkey PRIMARY KEY (companyid, groupcode, code);


--
-- Name: company01t company01t_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company01t
    ADD CONSTRAINT company01t_pkey PRIMARY KEY (companyid);


--
-- Name: company_ai_quota01t company_ai_quota01t_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_ai_quota01t
    ADD CONSTRAINT company_ai_quota01t_pkey PRIMARY KEY (companyid);


--
-- Name: company_license01t company_license01t_pkey1; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_license01t
    ADD CONSTRAINT company_license01t_pkey1 PRIMARY KEY (companyid);


--
-- Name: company_license_charge01t company_license_charge01t_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_license_charge01t
    ADD CONSTRAINT company_license_charge01t_pkey PRIMARY KEY (companyid, charge_month);


--
-- Name: control_approver01t control_approver01t_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.control_approver01t
    ADD CONSTRAINT control_approver01t_pkey PRIMARY KEY (companyid, useremail);


--
-- Name: control_policy01t control_policy01t_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.control_policy01t
    ADD CONSTRAINT control_policy01t_pkey PRIMARY KEY (companyid, target);


--
-- Name: currentstock01t currentstock01t_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.currentstock01t
    ADD CONSTRAINT currentstock01t_pkey PRIMARY KEY (companyid, sourcetype, sourceno, sourceline);


--
-- Name: customer01t customer01t_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer01t
    ADD CONSTRAINT customer01t_pkey PRIMARY KEY (companyid, customercode);


--
-- Name: eappr_doc01t eappr_doc01t_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eappr_doc01t
    ADD CONSTRAINT eappr_doc01t_pkey PRIMARY KEY (companyid, docno);


--
-- Name: eappr_form01t eappr_form01t_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eappr_form01t
    ADD CONSTRAINT eappr_form01t_pkey PRIMARY KEY (companyid, formcode);


--
-- Name: eappr_leave01t eappr_leave01t_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eappr_leave01t
    ADD CONSTRAINT eappr_leave01t_pkey PRIMARY KEY (companyid, useremail, leaveyear);


--
-- Name: eappr_leavetime01t eappr_leavetime01t_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eappr_leavetime01t
    ADD CONSTRAINT eappr_leavetime01t_pkey PRIMARY KEY (companyid, kind, slotno);


--
-- Name: eappr_line01t eappr_line01t_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eappr_line01t
    ADD CONSTRAINT eappr_line01t_pkey PRIMARY KEY (companyid, formcode, step);


--
-- Name: eappr_step01t eappr_step01t_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eappr_step01t
    ADD CONSTRAINT eappr_step01t_pkey PRIMARY KEY (companyid, docno, step);


--
-- Name: inbound01t inbound01t_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbound01t
    ADD CONSTRAINT inbound01t_pkey PRIMARY KEY (companyid, receiptno);


--
-- Name: inbound02t inbound02t_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbound02t
    ADD CONSTRAINT inbound02t_pkey PRIMARY KEY (companyid, receiptno, lineno);


--
-- Name: inbound03t inbound03t_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbound03t
    ADD CONSTRAINT inbound03t_pkey PRIMARY KEY (companyid, receiptno, lineno);


--
-- Name: iniop01t iniop01t_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iniop01t
    ADD CONSTRAINT iniop01t_pkey PRIMARY KEY (companyid, iniotype, receiptno, lineno);


--
-- Name: inoutmove01t inoutmove01t_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inoutmove01t
    ADD CONSTRAINT inoutmove01t_pkey PRIMARY KEY (companyid, receiptno);


--
-- Name: inoutmove02t inoutmove02t_companyid_receiptno_stocksourcetype_stocksourc_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inoutmove02t
    ADD CONSTRAINT inoutmove02t_companyid_receiptno_stocksourcetype_stocksourc_key UNIQUE (companyid, receiptno, stocksourcetype, stocksourceno, stocksourceline);


--
-- Name: inoutmove02t inoutmove02t_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inoutmove02t
    ADD CONSTRAINT inoutmove02t_pkey PRIMARY KEY (companyid, receiptno, lineno);


--
-- Name: itemcode01t itemcode01t_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.itemcode01t
    ADD CONSTRAINT itemcode01t_pkey PRIMARY KEY (companyid, itemcode);


--
-- Name: itemprocessrule01t itemprocessrule01t_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.itemprocessrule01t
    ADD CONSTRAINT itemprocessrule01t_pkey PRIMARY KEY (companyid, itemcode, processid);


--
-- Name: menucatalog01t menucatalog01t_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.menucatalog01t
    ADD CONSTRAINT menucatalog01t_pkey PRIMARY KEY (menuid);


--
-- Name: monthclose01t monthclose01t_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monthclose01t
    ADD CONSTRAINT monthclose01t_pkey PRIMARY KEY (companyid, closemonth);


--
-- Name: outbound01t outbound01t_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbound01t
    ADD CONSTRAINT outbound01t_pkey PRIMARY KEY (companyid, receiptno);


--
-- Name: outbound02t outbound02t_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbound02t
    ADD CONSTRAINT outbound02t_pkey PRIMARY KEY (companyid, receiptno, lineno);


--
-- Name: outbound03t outbound03t_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbound03t
    ADD CONSTRAINT outbound03t_pkey PRIMARY KEY (companyid, receiptno, lineno);


--
-- Name: pay_slip01t pay_slip01t_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pay_slip01t
    ADD CONSTRAINT pay_slip01t_pkey PRIMARY KEY (companyid, payym, useremail);


--
-- Name: process01t process01t_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process01t
    ADD CONSTRAINT process01t_pkey PRIMARY KEY (companyid, processno);


--
-- Name: process02t process02t_companyid_processno_sourcelineno_lineno_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process02t
    ADD CONSTRAINT process02t_companyid_processno_sourcelineno_lineno_key UNIQUE (companyid, processno, sourcelineno, lineno);


--
-- Name: process02t process02t_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process02t
    ADD CONSTRAINT process02t_pkey PRIMARY KEY (companyid, processno, lineno);


--
-- Name: receiptpayment01t receiptpayment01t_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receiptpayment01t
    ADD CONSTRAINT receiptpayment01t_pkey PRIMARY KEY (companyid, receiptno);


--
-- Name: receiptpayment02t receiptpayment02t_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receiptpayment02t
    ADD CONSTRAINT receiptpayment02t_pkey PRIMARY KEY (companyid, receiptno, lineno);


--
-- Name: standstock01t standstock01t_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.standstock01t
    ADD CONSTRAINT standstock01t_pkey PRIMARY KEY (companyid, lineno);


--
-- Name: user01t user01t_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user01t
    ADD CONSTRAINT user01t_pkey PRIMARY KEY (companyid, email);


--
-- Name: usermenufavorite01t usermenufavorite01t_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usermenufavorite01t
    ADD CONSTRAINT usermenufavorite01t_pkey PRIMARY KEY (companyid, useremail, menuid);


--
-- Name: usermenupermission01t usermenupermission01t_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usermenupermission01t
    ADD CONSTRAINT usermenupermission01t_pkey PRIMARY KEY (companyid, useremail, menuid);


--
-- Name: aiorder02t_optimize_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aiorder02t_optimize_status_idx ON public.aiorder02t USING btree (companyid, optimize_status);


--
-- Name: aiorder03t_stock_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aiorder03t_stock_idx ON public.aiorder03t USING btree (companyid, stocksourcetype, stocksourceno, stocksourceline);


--
-- Name: aiorderanalysis01t_company_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aiorderanalysis01t_company_created_idx ON public.aiorderanalysis01t USING btree (companyid, created_at);


--
-- Name: aiplan01t_stock_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aiplan01t_stock_idx ON public.aiplan01t USING btree (companyid, stocksourcetype, stocksourceno, stocksourceline);


--
-- Name: aiplan02t_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aiplan02t_order_idx ON public.aiplan02t USING btree (companyid, orderid, orderlineno);


--
-- Name: approval_request01t_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX approval_request01t_created_idx ON public.approval_request01t USING btree (companyid, createdat DESC);


--
-- Name: approval_request01t_pending_ref_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX approval_request01t_pending_ref_idx ON public.approval_request01t USING btree (companyid, target, ref_no) WHERE (((status)::text = ANY ((ARRAY['PENDING'::character varying, 'PROCESSING'::character varying])::text[])) AND (ref_no IS NOT NULL));


--
-- Name: approval_request01t_recent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX approval_request01t_recent_idx ON public.approval_request01t USING btree (companyid, created_by, COALESCE(decided_at, createdat) DESC);


--
-- Name: approval_request01t_requester_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX approval_request01t_requester_idx ON public.approval_request01t USING btree (companyid, created_by, createdat DESC);


--
-- Name: approval_request01t_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX approval_request01t_status_idx ON public.approval_request01t USING btree (companyid, status, createdat DESC);


--
-- Name: eappr_doc01t_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX eappr_doc01t_created_idx ON public.eappr_doc01t USING btree (companyid, createdat DESC);


--
-- Name: eappr_doc01t_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX eappr_doc01t_status_idx ON public.eappr_doc01t USING btree (companyid, status, formcode);


--
-- Name: eappr_doc01t_writer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX eappr_doc01t_writer_idx ON public.eappr_doc01t USING btree (companyid, created_by, createdat DESC);


--
-- Name: eappr_step01t_approver_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX eappr_step01t_approver_idx ON public.eappr_step01t USING btree (companyid, approver, status);


--
-- Name: iniop01t_company_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX iniop01t_company_date_idx ON public.iniop01t USING btree (companyid, iniodate);


--
-- Name: ix_aiorder01t_company_created_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_aiorder01t_company_created_order ON public.aiorder01t USING btree (companyid, created_at DESC, orderid DESC);


--
-- Name: ix_aiorder01t_search_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_aiorder01t_search_trgm ON public.aiorder01t USING gin (buyer public.gin_trgm_ops, orderid public.gin_trgm_ops);


--
-- Name: ix_aiorderanalysis01t_cache_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_aiorderanalysis01t_cache_version ON public.aiorderanalysis01t USING btree (companyid, useremail, file_sha256, model, ((extraction ->> '_schema_version'::text)), completed_at DESC NULLS LAST, created_at DESC) WHERE (((status)::text = 'succeeded'::text) AND (extraction IS NOT NULL));


--
-- Name: ix_aiorderanalysis01t_company_lower_email_request; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_aiorderanalysis01t_company_lower_email_request ON public.aiorderanalysis01t USING btree (companyid, lower((useremail)::text), request_id) WHERE ((status)::text = 'succeeded'::text);


--
-- Name: ix_aiorderrule01t_company_issuer_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_aiorderrule01t_company_issuer_status ON public.aiorderrule01t USING btree (companyid, issuername, status, priority);


--
-- Name: ix_aiorderusage01t_company_day; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_aiorderusage01t_company_day ON public.aiorderusage01t USING btree (companyid, usage_day);


--
-- Name: ix_aiorderusage01t_company_month; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_aiorderusage01t_company_month ON public.aiorderusage01t USING btree (companyid, usage_month, status);


--
-- Name: ix_aiorderusage01t_company_user_day; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_aiorderusage01t_company_user_day ON public.aiorderusage01t USING btree (companyid, user_hash, usage_day);


--
-- Name: ix_aiorderusage01t_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_aiorderusage01t_created ON public.aiorderusage01t USING btree (created_at);


--
-- Name: ix_aiorderusage01t_month_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_aiorderusage01t_month_status ON public.aiorderusage01t USING btree (usage_month, status);


--
-- Name: ix_aiorderusage01t_status_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_aiorderusage01t_status_created ON public.aiorderusage01t USING btree (status, created_at);


--
-- Name: ix_aiorderusage01t_user_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_aiorderusage01t_user_status ON public.aiorderusage01t USING btree (companyid, user_hash, status);


--
-- Name: ix_board01t_category_list; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_board01t_category_list ON public.board01t USING btree (category, pinned DESC, id DESC);


--
-- Name: ix_board01t_company_list; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_board01t_company_list ON public.board01t USING btree (companyid, category, id DESC);


--
-- Name: ix_boardreply01t_board; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_boardreply01t_board ON public.boardreply01t USING btree (board_id, created_at, id);


--
-- Name: ix_codemaster01t_group_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_codemaster01t_group_order ON public.codemaster01t USING btree (companyid, groupcode, sort_order, code);


--
-- Name: ix_codemaster01t_search_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_codemaster01t_search_trgm ON public.codemaster01t USING gin (code public.gin_trgm_ops, code_name public.gin_trgm_ops);


--
-- Name: ix_currentstock01t_company_available_item_warehouse; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_currentstock01t_company_available_item_warehouse ON public.currentstock01t USING btree (companyid, itemcode, warehousecode) WHERE (qty > (0)::numeric);


--
-- Name: ix_currentstock01t_company_receiptdate; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_currentstock01t_company_receiptdate ON public.currentstock01t USING btree (companyid, receiptdate DESC, sourcetype, sourceno, sourceline);


--
-- Name: ix_currentstock01t_process_picker; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_currentstock01t_process_picker ON public.currentstock01t USING btree (companyid, receiptdate, sourcetype, sourceno, sourceline) WHERE ((qty > (0)::numeric) AND (weight > (0)::numeric));


--
-- Name: ix_currentstock01t_remark_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_currentstock01t_remark_trgm ON public.currentstock01t USING gin (remark public.gin_trgm_ops) WHERE (remark IS NOT NULL);


--
-- Name: ix_currentstock01t_search_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_currentstock01t_search_trgm ON public.currentstock01t USING gin (itemcode public.gin_trgm_ops, itemname public.gin_trgm_ops, warehousecode public.gin_trgm_ops, warehousecodename public.gin_trgm_ops, customname public.gin_trgm_ops);


--
-- Name: ix_customer01t_company_customer_code_page; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_customer01t_company_customer_code_page ON public.customer01t USING btree (companyid, (
CASE
    WHEN ((customercode)::text ~* '^Cust-[0-9]+$'::text) THEN (SUBSTRING(customercode FROM 6))::bigint
    ELSE NULL::bigint
END), customercode);


--
-- Name: ix_customer01t_company_customercode_lower; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_customer01t_company_customercode_lower ON public.customer01t USING btree (companyid, lower((customercode)::text));


--
-- Name: ix_customer01t_search_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_customer01t_search_trgm ON public.customer01t USING gin (customercode public.gin_trgm_ops, customername public.gin_trgm_ops);


--
-- Name: ix_inbound01t_company_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_inbound01t_company_date ON public.inbound01t USING btree (companyid, receptdate DESC, receiptno DESC);


--
-- Name: ix_inbound01t_company_date_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_inbound01t_company_date_customer ON public.inbound01t USING btree (companyid, receptdate, customname, receiptno);


--
-- Name: ix_inbound01t_search_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_inbound01t_search_trgm ON public.inbound01t USING gin (receiptno public.gin_trgm_ops, customcode public.gin_trgm_ops, customname public.gin_trgm_ops);


--
-- Name: ix_inbound02t_company_item_wh; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_inbound02t_company_item_wh ON public.inbound02t USING btree (companyid, itemcode, COALESCE(warehousecode, ''::character varying));


--
-- Name: ix_inbound02t_search_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_inbound02t_search_trgm ON public.inbound02t USING gin (itemcode public.gin_trgm_ops, itemname public.gin_trgm_ops, warehousecode public.gin_trgm_ops, warehousecodename public.gin_trgm_ops);


--
-- Name: ix_iniop01t_company_date_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_iniop01t_company_date_key ON public.iniop01t USING btree (companyid, iniodate, receiptno, lineno, iniotype);


--
-- Name: ix_iniop01t_company_kind_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_iniop01t_company_kind_date ON public.iniop01t USING btree (companyid, iniokind, iniodate, receiptno, lineno);


--
-- Name: ix_iniop01t_search_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_iniop01t_search_trgm ON public.iniop01t USING gin (itemcode public.gin_trgm_ops, itemname public.gin_trgm_ops, productname public.gin_trgm_ops, customname public.gin_trgm_ops, warehousecode public.gin_trgm_ops, warehousecodename public.gin_trgm_ops);


--
-- Name: ix_inoutmove02t_stock_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_inoutmove02t_stock_source ON public.inoutmove02t USING btree (companyid, stocksourcetype, stocksourceno, stocksourceline);


--
-- Name: ix_itemcode01t_search_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_itemcode01t_search_trgm ON public.itemcode01t USING gin (itemcode public.gin_trgm_ops, itemname public.gin_trgm_ops, itemtypecode public.gin_trgm_ops, itemtypecodenm public.gin_trgm_ops);


--
-- Name: ix_outbound01t_company_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_outbound01t_company_date ON public.outbound01t USING btree (companyid, receptdate DESC, receiptno DESC);


--
-- Name: ix_outbound01t_search_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_outbound01t_search_trgm ON public.outbound01t USING gin (receiptno public.gin_trgm_ops, customcode public.gin_trgm_ops, customname public.gin_trgm_ops);


--
-- Name: ix_outbound02t_company_item_wh; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_outbound02t_company_item_wh ON public.outbound02t USING btree (companyid, itemcode, COALESCE(warehousecode, ''::character varying));


--
-- Name: ix_outbound02t_search_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_outbound02t_search_trgm ON public.outbound02t USING gin (itemcode public.gin_trgm_ops, itemname public.gin_trgm_ops, warehousecode public.gin_trgm_ops, warehousecodename public.gin_trgm_ops);


--
-- Name: ix_outbound02t_stock_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_outbound02t_stock_source ON public.outbound02t USING btree (companyid, stocksourcetype, stocksourceno, stocksourceline);


--
-- Name: ix_process01t_company_date_no; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_process01t_company_date_no ON public.process01t USING btree (companyid, processdate DESC, processno DESC);


--
-- Name: ix_process02_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_process02_parent ON public.process02t USING btree (companyid, processno, sourcelineno, parentlineno) WHERE (parentlineno IS NOT NULL);


--
-- Name: ix_process02t_company_process_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_process02t_company_process_parent ON public.process02t USING btree (companyid, processno, parentlineno) WHERE (parentlineno IS NOT NULL);


--
-- Name: ix_process02t_stock_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_process02t_stock_source ON public.process02t USING btree (companyid, stocksourcetype, stocksourceno, stocksourceline) WHERE ((linetype)::text = 'SOURCE'::text);


--
-- Name: ix_receiptpayment01t_company_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_receiptpayment01t_company_date ON public.receiptpayment01t USING btree (companyid, receiptdate, receiptno);


--
-- Name: ix_receiptpayment01t_list_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_receiptpayment01t_list_order ON public.receiptpayment01t USING btree (companyid, receiptdate, created_at, receiptno);


--
-- Name: ix_receiptpayment02t_held; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_receiptpayment02t_held ON public.receiptpayment02t USING btree (companyid, maturitydate, receiptno, lineno) WHERE ((instrumentamt > (0)::numeric) AND (COALESCE(NULLIF((issuekind)::text, ''::text), 'OTHER'::text) = 'OTHER'::text) AND (COALESCE(NULLIF((instrumentstatus)::text, ''::text), 'HELD'::text) = 'HELD'::text));


--
-- Name: ix_receiptpayment02t_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_receiptpayment02t_source ON public.receiptpayment02t USING btree (companyid, source_receiptno, source_lineno);


--
-- Name: ix_standstock01t_company_date_line; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_standstock01t_company_date_line ON public.standstock01t USING btree (companyid, standdate, lineno);


--
-- Name: ix_standstock01t_search_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_standstock01t_search_trgm ON public.standstock01t USING gin (itemcode public.gin_trgm_ops, itemname public.gin_trgm_ops, warehousecode public.gin_trgm_ops, warehousecodename public.gin_trgm_ops);


--
-- Name: ix_user01t_company_user_sort; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_user01t_company_user_sort ON public.user01t USING btree (companyid, lower((username)::text), lower((email)::text));


--
-- Name: ix_user01t_company_useyn; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_user01t_company_useyn ON public.user01t USING btree (companyid, upper((COALESCE(useyn, 'N'::character varying))::text));


--
-- Name: ix_user01t_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_user01t_email ON public.user01t USING btree (email);


--
-- Name: ix_usermenupermission01t_company_lower_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_usermenupermission01t_company_lower_email ON public.usermenupermission01t USING btree (companyid, lower((useremail)::text));


--
-- Name: ix_usermenupermission01t_menuid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_usermenupermission01t_menuid ON public.usermenupermission01t USING btree (menuid);


--
-- Name: pay_slip01t_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pay_slip01t_user_idx ON public.pay_slip01t USING btree (companyid, useremail, payym DESC);


--
-- Name: process01t_plan_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX process01t_plan_uq ON public.process01t USING btree (companyid, planno) WHERE (planno IS NOT NULL);


--
-- Name: user01t_empno_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX user01t_empno_uq ON public.user01t USING btree (companyid, empno) WHERE (empno IS NOT NULL);


--
-- Name: ux_currentstock01t_opening_line; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_currentstock01t_opening_line ON public.currentstock01t USING btree (companyid, sourceline) WHERE ((sourcetype)::text = 'OPENING'::text);


--
-- Name: ux_process02_source_stock; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_process02_source_stock ON public.process02t USING btree (companyid, processno, stocksourcetype, stocksourceno, stocksourceline) WHERE ((linetype)::text = 'SOURCE'::text);


--
-- Name: ux_user01t_company_usercode; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_user01t_company_usercode ON public.user01t USING btree (companyid, usercode);


--
-- Name: ux_user01t_email_lower; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_user01t_email_lower ON public.user01t USING btree (lower((email)::text)) WHERE ((email IS NOT NULL) AND (btrim((email)::text) <> ''::text));


--
-- Name: currentstock01t trg_currentstock_reservation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER trg_currentstock_reservation AFTER DELETE OR UPDATE OF qty, weight ON public.currentstock01t DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.fn_check_stock_reservation();


--
-- Name: iniop01t trg_iniop01t_fill_kind; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_iniop01t_fill_kind BEFORE INSERT ON public.iniop01t FOR EACH ROW EXECUTE FUNCTION public.iniop01t_fill_kind();


--
-- Name: aiorder02t aiorder02t_companyid_orderid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aiorder02t
    ADD CONSTRAINT aiorder02t_companyid_orderid_fkey FOREIGN KEY (companyid, orderid) REFERENCES public.aiorder01t(companyid, orderid) ON DELETE CASCADE;


--
-- Name: aiorder03t aiorder03t_companyid_orderid_lineno_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aiorder03t
    ADD CONSTRAINT aiorder03t_companyid_orderid_lineno_fkey FOREIGN KEY (companyid, orderid, lineno) REFERENCES public.aiorder02t(companyid, orderid, lineno) ON DELETE CASCADE;


--
-- Name: aiplan02t aiplan02t_companyid_planno_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aiplan02t
    ADD CONSTRAINT aiplan02t_companyid_planno_fkey FOREIGN KEY (companyid, planno) REFERENCES public.aiplan01t(companyid, planno) ON DELETE CASCADE;


--
-- Name: boardreply01t boardreply01t_board_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.boardreply01t
    ADD CONSTRAINT boardreply01t_board_id_fkey FOREIGN KEY (board_id) REFERENCES public.board01t(id) ON DELETE CASCADE;


--
-- Name: company_ai_quota01t company_ai_quota01t_companyid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_ai_quota01t
    ADD CONSTRAINT company_ai_quota01t_companyid_fkey FOREIGN KEY (companyid) REFERENCES public.company01t(companyid) ON DELETE CASCADE;


--
-- Name: company_license01t company_license01t_companyid_fkey1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_license01t
    ADD CONSTRAINT company_license01t_companyid_fkey1 FOREIGN KEY (companyid) REFERENCES public.company01t(companyid) ON DELETE CASCADE;


--
-- Name: company_license_charge01t company_license_charge01t_companyid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_license_charge01t
    ADD CONSTRAINT company_license_charge01t_companyid_fkey FOREIGN KEY (companyid) REFERENCES public.company01t(companyid) ON DELETE CASCADE;


--
-- Name: inbound03t inbound03t_companyid_receiptno_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbound03t
    ADD CONSTRAINT inbound03t_companyid_receiptno_fkey FOREIGN KEY (companyid, receiptno) REFERENCES public.inbound01t(companyid, receiptno) ON DELETE CASCADE;


--
-- Name: inoutmove02t inoutmove02t_companyid_receiptno_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inoutmove02t
    ADD CONSTRAINT inoutmove02t_companyid_receiptno_fkey FOREIGN KEY (companyid, receiptno) REFERENCES public.inoutmove01t(companyid, receiptno) ON DELETE CASCADE;


--
-- Name: outbound03t outbound03t_companyid_receiptno_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbound03t
    ADD CONSTRAINT outbound03t_companyid_receiptno_fkey FOREIGN KEY (companyid, receiptno) REFERENCES public.outbound01t(companyid, receiptno) ON DELETE CASCADE;


--
-- Name: process02t process02t_companyid_processno_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process02t
    ADD CONSTRAINT process02t_companyid_processno_fkey FOREIGN KEY (companyid, processno) REFERENCES public.process01t(companyid, processno) ON DELETE CASCADE;


--
-- Name: process02t process02t_companyid_processno_sourcelineno_parentlineno_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process02t
    ADD CONSTRAINT process02t_companyid_processno_sourcelineno_parentlineno_fkey FOREIGN KEY (companyid, processno, sourcelineno, parentlineno) REFERENCES public.process02t(companyid, processno, sourcelineno, lineno) ON DELETE CASCADE;


--
-- Name: receiptpayment02t receiptpayment02t_companyid_receiptno_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receiptpayment02t
    ADD CONSTRAINT receiptpayment02t_companyid_receiptno_fkey FOREIGN KEY (companyid, receiptno) REFERENCES public.receiptpayment01t(companyid, receiptno) ON DELETE CASCADE;


--
-- Name: usermenufavorite01t usermenufavorite01t_menuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usermenufavorite01t
    ADD CONSTRAINT usermenufavorite01t_menuid_fkey FOREIGN KEY (menuid) REFERENCES public.menucatalog01t(menuid) ON DELETE CASCADE;


--
-- Name: usermenupermission01t usermenupermission01t_companyid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usermenupermission01t
    ADD CONSTRAINT usermenupermission01t_companyid_fkey FOREIGN KEY (companyid) REFERENCES public.company01t(companyid) ON DELETE RESTRICT;


--
-- Name: usermenupermission01t usermenupermission01t_companyid_useremail_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usermenupermission01t
    ADD CONSTRAINT usermenupermission01t_companyid_useremail_fkey FOREIGN KEY (companyid, useremail) REFERENCES public.user01t(companyid, email) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: usermenupermission01t usermenupermission01t_menuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usermenupermission01t
    ADD CONSTRAINT usermenupermission01t_menuid_fkey FOREIGN KEY (menuid) REFERENCES public.menucatalog01t(menuid) ON DELETE RESTRICT;


--
-- PostgreSQL database dump complete
--

\unrestrict hqJge3I2sCTyJfUe5mJWZxfKVC244QgjgDcDRysBb8PBHapKZzfB6DmaEzVU09a

