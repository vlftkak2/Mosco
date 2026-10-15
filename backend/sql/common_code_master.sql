-- CodeMaster01t schema used by backend/CodeMaster.py.
-- PostgreSQL folds this unquoted identifier to codemaster01t.
CREATE TABLE IF NOT EXISTS CodeMaster01t (
    companyid   VARCHAR(50) NOT NULL,
    companyname VARCHAR(50) NOT NULL,
    groupcode   VARCHAR(50) NOT NULL,
    groupname   VARCHAR(100) NOT NULL,
    code        VARCHAR(50) NOT NULL,
    codename    VARCHAR(150) NOT NULL,
    property1   VARCHAR(100),
    property2   VARCHAR(100),
    property3   VARCHAR(100),
    property4   VARCHAR(100),
    sortorder   INTEGER NOT NULL DEFAULT 0,
    useyn       VARCHAR(50) NOT NULL DEFAULT '사용중',
    description VARCHAR(500),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (companyid, groupcode, code),
    CONSTRAINT ck_codemaster01t_useyn CHECK (useyn IN ('사용중', '미사용'))
);

CREATE INDEX IF NOT EXISTS ix_codemaster01t_group_order
    ON CodeMaster01t (companyid, groupcode, sortorder, code);
