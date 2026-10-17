-- CodeMaster01t schema used by backend/CodeMaster.py.
-- PostgreSQL folds this unquoted identifier to codemaster01t.
CREATE TABLE IF NOT EXISTS CodeMaster01t (
    companyid VARCHAR(50) NOT NULL,
    companyname VARCHAR(50) NOT NULL,
    groupcode VARCHAR(50) NOT NULL,
    groupname VARCHAR(100) NOT NULL,
    code VARCHAR(50) NOT NULL,
    code_name VARCHAR(150) NOT NULL,
    property1 VARCHAR(50),
    property2 VARCHAR(50),
    property3 VARCHAR(50),
    property4 VARCHAR(50),
    sort_order INTEGER NOT NULL DEFAULT 0,
    use_yn CHAR(10) NOT NULL DEFAULT 'Y',
    description VARCHAR(500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ,
    PRIMARY KEY (companyid, groupcode, code)
);

CREATE INDEX IF NOT EXISTS ix_codemaster01t_group_order
    ON CodeMaster01t (companyid, groupcode, sort_order, code);

-- Supports the code/code-name contains search used by the paged list API.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS ix_codemaster01t_code_trgm
    ON CodeMaster01t USING GIN (code gin_trgm_ops);

CREATE INDEX IF NOT EXISTS ix_codemaster01t_code_name_trgm
    ON CodeMaster01t USING GIN (code_name gin_trgm_ops);
