-- Matches the tenant-scoped CodeMaster01t table used by the API.
-- PostgreSQL folds this unquoted identifier to codemaster01t.
CREATE TABLE IF NOT EXISTS CodeMaster01t (
    companyid   VARCHAR(50) NOT NULL,
    companyname VARCHAR(50) NOT NULL,
    groupcode   VARCHAR(50) NOT NULL,
    groupname   VARCHAR(100) NOT NULL,
    code        VARCHAR(50) NOT NULL,
    codename    VARCHAR(150) NOT NULL,
    sortorder   INTEGER NOT NULL DEFAULT 0,
    use_yn      CHAR(1) NOT NULL DEFAULT 'Y',
    description VARCHAR(500),
    createdat   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updatedat   TIMESTAMP,
    PRIMARY KEY (companyid, groupcode, code),
    CONSTRAINT ck_codemaster01t_use_yn CHECK (use_yn IN ('Y', 'N'))
);

CREATE INDEX IF NOT EXISTS ix_codemaster01t_group_order
    ON CodeMaster01t (companyid, groupcode, sortorder, code);
