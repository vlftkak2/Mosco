-- Link customer bank selections to the company's Bank01t master list.
ALTER TABLE customer01t
    ADD COLUMN IF NOT EXISTS bankcode VARCHAR(50);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_customer01t_bank'
          AND conrelid = 'customer01t'::regclass
    ) THEN
        ALTER TABLE customer01t
            ADD CONSTRAINT fk_customer01t_bank
            FOREIGN KEY (companyid, bankcode)
            REFERENCES Bank01t (companyid, BankCode);
    END IF;
END $$;
