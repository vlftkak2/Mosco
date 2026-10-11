-- Run once against the PostgreSQL database before deploying the paginated customer list.
-- pg_trgm enables indexed substring searches for company-scoped customer name/code queries.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS customer01t_company_status_idx
    ON customer01t (companyid, useyn);

CREATE INDEX IF NOT EXISTS customer01t_company_code_idx
    ON customer01t (companyid, customercode);

CREATE INDEX IF NOT EXISTS customer01t_company_sequence_idx
    ON customer01t (companyid, (substring(customercode FROM 6)::bigint))
    WHERE customercode ~* '^Cust-[0-9]+$';

CREATE INDEX IF NOT EXISTS customer01t_company_sequence_order_idx
    ON customer01t (
        companyid,
        (CASE WHEN customercode ~* '^Cust-[0-9]+$'
              THEN substring(customercode FROM 6)::bigint END) DESC,
        customercode DESC
    );

CREATE INDEX IF NOT EXISTS customer01t_customername_trgm_idx
    ON customer01t USING gin (customername gin_trgm_ops);

CREATE INDEX IF NOT EXISTS customer01t_customercode_trgm_idx
    ON customer01t USING gin (customercode gin_trgm_ops);
