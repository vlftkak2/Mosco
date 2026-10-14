-- Run this statement by itself in PostgreSQL autocommit mode.
-- The index matches CustomerList's tenant filter and numeric customer-code ordering,
-- allowing LIMIT/OFFSET page reads to avoid sorting every row for that company.
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_customer01t_company_customer_code_page
    ON customer01t (
        companyid,
        (CASE
            WHEN customercode ~* '^Cust-[0-9]+$'
            THEN substring(customercode FROM 6)::bigint
        END),
        customercode
    );
